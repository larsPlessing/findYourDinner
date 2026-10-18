import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { importRecipe } from './server/recipeImporter.mjs';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4004);
const maxRequestBytes = 50 * 1024 * 1024;

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.manifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function sendJson(response, statusCode, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(body);
}

function safeSlug(value) {
    return String(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 45) || 'recipe';
}

function removeUnusedRecipeImages(imageDirectory, recipes) {
    const referencedFiles = new Set();
    for (const recipe of recipes) {
        for (const image of Array.isArray(recipe.images) ? recipe.images : []) {
            if (!image || typeof image.src !== 'string') continue;
            const match = image.src.match(/^images\/recipes\/([^/\\]+)$/);
            if (match) referencedFiles.add(match[1]);
        }
    }

    let deletedImages = 0;
    for (const entry of fs.readdirSync(imageDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || referencedFiles.has(entry.name)) continue;
        fs.unlinkSync(path.join(imageDirectory, entry.name));
        deletedImages++;
    }
    return deletedImages;
}

function removeUnusedRecipeVideos(videoDirectory, recipes) {
    const referencedFiles = new Set();
    for (const recipe of recipes) {
        const src = recipe?.video?.src;
        if (typeof src !== 'string') continue;
        const match = src.match(/^videos\/recipes\/([^/\\]+)$/);
        if (match) referencedFiles.add(match[1]);
    }

    let deletedVideos = 0;
    if (!fs.existsSync(videoDirectory)) return deletedVideos;
    for (const entry of fs.readdirSync(videoDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || referencedFiles.has(entry.name)) continue;
        fs.unlinkSync(path.join(videoDirectory, entry.name));
        deletedVideos++;
    }
    return deletedVideos;
}

function persistImportedVideo(root, recipe) {
    if (!recipe?.video) return recipe;
    const supportedTypes = {
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov'
    };
    const mimeType = recipe.video.mimeType;
    const extension = supportedTypes[mimeType];
    const base64 = recipe.video.data;
    if (!extension || typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        throw new Error('Das importierte Video hat ein ungültiges Format.');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
        throw new Error('Das importierte Video ist leer oder größer als 20 MB.');
    }

    const videoDirectory = path.join(root, 'videos', 'recipes');
    fs.mkdirSync(videoDirectory, { recursive: true });
    const filename = `${safeSlug(recipe.name)}-${randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(videoDirectory, filename), bytes);
    recipe.video = { src: `videos/recipes/${filename}`, mimeType };
    return recipe;
}

function isSameLocalOrigin(origin, hostHeader) {
    if (!origin || !hostHeader) return false;
    try {
        const originUrl = new URL(origin);
        const requestUrl = new URL(`http://${hostHeader}`);
        return originUrl.protocol === 'http:'
            && originUrl.origin === requestUrl.origin
            && ['localhost', '127.0.0.1', '::1'].includes(originUrl.hostname);
    } catch {
        return false;
    }
}

function readJsonRequest(request, response) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let requestSize = 0;
        request.on('data', chunk => {
            requestSize += chunk.length;
            if (requestSize > maxRequestBytes) {
                sendJson(response, 413, { error: 'Die Anfrage ist zu groß.' });
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (response.writableEnded) return resolve(null);
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Die Anfrage enthält kein gültiges JSON.')); }
        });
        request.on('error', reject);
    });
}

function getRecipeCategories(root) {
    const recipesPath = path.join(root, 'recipes.json');
    let recipeData;
    try {
        recipeData = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
    } catch (error) {
        throw new Error(`Rezeptkategorien konnten nicht aus recipes.json geladen werden: ${error.message}`);
    }

    const availableCategories = new Set(
        (Array.isArray(recipeData.recipes) ? recipeData.recipes : [])
            .map(recipe => typeof recipe?.category === 'string' ? recipe.category.trim() : '')
            .filter(Boolean)
    );
    const categories = ['Salzig', 'Süß'].filter(category => availableCategories.has(category));
    if (!categories.length) throw new Error('In recipes.json wurden keine Rezeptkategorien gefunden.');
    return categories;
}

function createServer(options = {}) {
    const root = path.resolve(options.rootDirectory || rootDirectory);
    const recipeImporter = options.importRecipe || importRecipe;

    return http.createServer(async (request, response) => {
        const requestUrl = new URL(request.url, `http://${host}`);

        if (request.method === 'POST') {
            if (!['/api/save-recipes', '/api/import-recipe'].includes(requestUrl.pathname)) {
                sendJson(response, 404, { error: 'Unbekannter API-Endpunkt.' });
                return;
            }

            if (!isSameLocalOrigin(request.headers.origin, request.headers.host)) {
                sendJson(response, 403, { error: 'Nur gleich-originige lokale Anfragen sind erlaubt.' });
                return;
            }

            if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
                sendJson(response, 415, { error: 'Content-Type muss application/json sein.' });
                return;
            }

            try {
                const payload = await readJsonRequest(request, response);
                if (response.writableEnded) return;
                if (requestUrl.pathname === '/api/import-recipe') {
                    const recipe = await recipeImporter({ ...(payload || {}), categories: getRecipeCategories(root) });
                    const warnings = Array.isArray(recipe.importWarnings) ? recipe.importWarnings : [];
                    delete recipe.importWarnings;
                    sendJson(response, 200, { recipe: persistImportedVideo(root, recipe), warnings });
                    return;
                }
                if (!payload || !Array.isArray(payload.recipes)) throw new Error('Die Anfrage enthält keine Rezeptliste.');

                const imageDirectory = path.join(root, 'images', 'recipes');
                fs.mkdirSync(imageDirectory, { recursive: true });
                // Von bereits gespeicherten Bildern belegte Dateinamen dürfen nicht von
                // neu geschriebenen Bildern überschrieben werden (z. B. nach Umsortieren).
                const reservedImageFiles = new Set();
                for (const recipe of payload.recipes) {
                    for (const image of Array.isArray(recipe?.images) ? recipe.images : []) {
                        const match = typeof image?.src === 'string' ? image.src.match(/^images\/recipes\/([^/\\]+)$/) : null;
                        if (match) reservedImageFiles.add(match[1]);
                    }
                }
                let savedImages = 0;
                payload.recipes.forEach((recipe, recipeIndex) => {
                    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new Error(`Rezept ${recipeIndex + 1} ist ungültig.`);
                    if (recipe.images === undefined) recipe.images = [];
                    if (!Array.isArray(recipe.images)) throw new Error(`Bilderliste in Rezept ${recipeIndex + 1} ist ungültig.`);
                    recipe.images.forEach((image, imageIndex) => {
                        if (!image || typeof image.src !== 'string') return;
                        const match = image.src.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
                        if (!match) return;
                        const bytes = Buffer.from(match[2], 'base64');
                        if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Ein Bild ist leer oder größer als 15 MB.');
                        const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
                        const id = String(recipe.id ?? recipeIndex).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30) || String(recipeIndex);
                        const baseName = `${safeSlug(recipe.name)}-${id}-${imageIndex + 1}`;
                        let filename = `${baseName}.${extension}`;
                        for (let suffix = 1; reservedImageFiles.has(filename); suffix++) {
                            filename = `${baseName}-${suffix}.${extension}`;
                        }
                        reservedImageFiles.add(filename);
                        fs.writeFileSync(path.join(imageDirectory, filename), bytes);
                        image.src = `images/recipes/${filename}`;
                        savedImages++;
                    });
                });

                const recipeFile = path.join(root, 'recipes.json');
                const temporaryFile = `${recipeFile}.tmp`;
                fs.writeFileSync(temporaryFile, `${JSON.stringify({ version: 1, recipes: payload.recipes }, null, 2)}\n`, 'utf8');
                fs.renameSync(temporaryFile, recipeFile);
                const deletedImages = removeUnusedRecipeImages(imageDirectory, payload.recipes);
                const deletedVideos = removeUnusedRecipeVideos(path.join(root, 'videos', 'recipes'), payload.recipes);
                sendJson(response, 200, { recipes: payload.recipes, savedImages, deletedImages, deletedVideos });
            } catch (error) {
                if (!response.writableEnded) sendJson(response, 400, { error: error.message });
            }
            return;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { Allow: 'GET, HEAD, POST' });
            response.end('Method not allowed');
            return;
        }

        let requestedPath;
        try {
            requestedPath = decodeURIComponent(requestUrl.pathname);
        } catch {
            response.writeHead(400);
            response.end('Bad request');
            return;
        }

        const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1);
        const filePath = path.resolve(root, relativePath);
        const pathFromRoot = path.relative(root, filePath);
        if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(pathFromRoot)) {
            response.writeHead(403);
            response.end('Forbidden');
            return;
        }
        if (pathFromRoot.split(path.sep).some(segment => segment.startsWith('.'))) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }

        fs.stat(filePath, (statError, stats) => {
            if (statError || !stats.isFile()) {
                response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end('Not found');
                return;
            }
            const contentType = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
            const range = request.headers.range;
            const rangeMatch = range && /^bytes=(\d*)-(\d*)$/.exec(range);
            if (rangeMatch && contentType.startsWith('video/')) {
                const suffixLength = rangeMatch[1] ? null : Number(rangeMatch[2]);
                const start = suffixLength === null
                    ? Number(rangeMatch[1])
                    : Math.max(0, stats.size - suffixLength);
                const end = suffixLength === null && rangeMatch[2]
                    ? Math.min(Number(rangeMatch[2]), stats.size - 1)
                    : stats.size - 1;
                if ((!rangeMatch[1] && (!suffixLength || suffixLength < 0))
                    || start >= stats.size || end < start) {
                    response.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
                    response.end();
                    return;
                }
                response.writeHead(206, {
                    'Accept-Ranges': 'bytes',
                    'Content-Length': end - start + 1,
                    'Content-Range': `bytes ${start}-${end}/${stats.size}`,
                    'Content-Type': contentType,
                    'X-Content-Type-Options': 'nosniff'
                });
                if (request.method === 'HEAD') { response.end(); return; }
                fs.createReadStream(filePath, { start, end }).pipe(response);
                return;
            }
            response.writeHead(200, {
                'Accept-Ranges': contentType.startsWith('video/') ? 'bytes' : 'none',
                'Content-Length': stats.size,
                'Content-Type': contentType,
                'X-Content-Type-Options': 'nosniff'
            });
            if (request.method === 'HEAD') { response.end(); return; }
            fs.createReadStream(filePath).pipe(response);
        });
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const server = createServer();
    server.listen(port, host, () => {
        console.log(`Rezeptfinder läuft auf http://localhost:${port}`);
        console.log('Zum Beenden Strg+C drücken.');
    });
    server.on('error', error => {
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${port} wird bereits verwendet. Starte mit PORT=4005 node server.mjs für einen anderen Port.`);
        } else {
            console.error('Server konnte nicht gestartet werden:', error.message);
        }
        process.exitCode = 1;
    });
}

export { createServer };
