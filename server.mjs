import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.manifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
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

function createServer(options = {}) {
    const root = path.resolve(options.rootDirectory || rootDirectory);

    return http.createServer((request, response) => {
        const requestUrl = new URL(request.url, `http://${host}`);

        if (request.method === 'POST') {
            if (requestUrl.pathname !== '/api/save-recipes') {
                sendJson(response, 404, { error: 'Unbekannter API-Endpunkt.' });
                return;
            }

            const origin = request.headers.origin;
            if (origin) {
                let originHost;
                try { originHost = new URL(origin).hostname; } catch { originHost = ''; }
                if (!['localhost', '127.0.0.1', '::1'].includes(originHost)) {
                    sendJson(response, 403, { error: 'Nur lokale Anfragen sind erlaubt.' });
                    return;
                }
            }

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
                if (response.writableEnded) return;
                try {
                    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (!payload || !Array.isArray(payload.recipes)) throw new Error('Die Anfrage enthält keine Rezeptliste.');

                    const imageDirectory = path.join(root, 'images', 'recipes');
                    fs.mkdirSync(imageDirectory, { recursive: true });
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
                            const filename = `${safeSlug(recipe.name)}-${id}-${imageIndex + 1}.${extension}`;
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
                    sendJson(response, 200, { recipes: payload.recipes, savedImages, deletedImages });
                } catch (error) {
                    sendJson(response, 400, { error: error.message });
                }
            });
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

        fs.stat(filePath, (statError, stats) => {
            if (statError || !stats.isFile()) {
                response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end('Not found');
                return;
            }
            response.writeHead(200, {
                'Content-Length': stats.size,
                'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
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
