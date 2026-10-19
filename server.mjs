import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { importRecipe } from './server/contentImporter.mjs';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4004);
const maxRequestBytes = 128 * 1024 * 1024;

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

function persistImportedVideo(recipe) {
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

    recipe.video = { src: `data:${mimeType};base64,${bytes.toString('base64')}`, mimeType };
    return recipe;
}

function normalizeHostName(hostHeader) {
    try {
        return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    } catch {
        return '';
    }
}

function isAllowedLocalHost(hostHeader) {
    return ['localhost', '127.0.0.1', '::1'].includes(normalizeHostName(hostHeader));
}

function isSameLocalOrigin(origin, hostHeader) {
    if (!origin || !hostHeader) return false;
    try {
        const originUrl = new URL(origin);
        const requestUrl = new URL(`http://${hostHeader}`);
        return originUrl.protocol === 'http:'
            && originUrl.origin === requestUrl.origin
            && isAllowedLocalHost(originUrl.hostname);
    } catch {
        return false;
    }
}

function readJsonRequest(request, response) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let requestSize = 0;
        let oversized = false;
        request.on('data', chunk => {
            if (oversized || response.writableEnded) return;
            requestSize += chunk.length;
            if (requestSize > maxRequestBytes) {
                oversized = true;
                sendJson(response, 413, { error: 'Die Anfrage ist zu groß.' });
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (oversized || response.writableEnded) return resolve(null);
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Die Anfrage enthält kein gültiges JSON.')); }
        });
        request.on('error', reject);
    });
}

function getRecipeCategories(root) {
    return ['Salzig', 'Süß'];
}

/** Liest die unverschlüsselte, zufällige Revisionskennung aus dem verschlüsselten Archiv. */
function readRecipesRevision(recipesPath) {
    try {
        const data = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
        return typeof data?.revision === 'string' && data.revision ? data.revision : null;
    } catch {
        return null;
    }
}

function isSafeEncryptedPath(value) {
    return typeof value === 'string'
        && /^(?:images|videos)\/recipes\/[A-Za-z0-9._-]+\.enc$/.test(value)
        && !value.split('/').some(segment => segment === '.' || segment === '..');
}

function isSafePlainMediaPath(value) {
    return typeof value === 'string'
        && /^(?:images\/recipes\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)|videos\/recipes\/[A-Za-z0-9._-]+\.(?:mp4|mov|webm))$/i.test(value)
        && !value.split('/').some(segment => segment === '.' || segment === '..');
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
                    sendJson(response, 200, { recipe: persistImportedVideo(recipe), warnings });
                    return;
                }
                const envelope = payload?.envelope;
                if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'AES-GCM'
                    || envelope.kdf !== 'PBKDF2-SHA-256' || !Number.isInteger(envelope.iterations)
                    || envelope.iterations < 600_000 || !/^[A-Za-z0-9+/]+=*$/.test(envelope.salt || '')
                    || !/^[A-Za-z0-9+/]+=*$/.test(envelope.iv || '')
                    || !/^[A-Za-z0-9+/]+=*$/.test(envelope.ciphertext || '')
                    || typeof envelope.revision !== 'string' || envelope.revision.length > 100) {
                    throw new Error('Die Anfrage enthält kein gültiges verschlüsseltes Rezeptarchiv.');
                }
                if (!Array.isArray(payload.mediaFiles) || !Array.isArray(payload.referencedFiles)
                    || !Array.isArray(payload.plainRecipes) || !Array.isArray(payload.plainMediaFiles)
                    || !Array.isArray(payload.plainReferencedFiles)) {
                    throw new Error('Die Anfrage enthält keine gültige Medienliste.');
                }

                const recipeFile = path.join(root, 'recipes.enc');
                const currentRevision = readRecipesRevision(recipeFile);
                const baseRevision = typeof payload.revision === 'string' && payload.revision ? payload.revision : null;
                if (currentRevision !== null && baseRevision !== currentRevision) {
                    sendJson(response, 409, {
                        error: 'recipes.enc wurde außerhalb der App geändert (z. B. durch git pull). '
                            + 'Es wurde nichts gespeichert. Bitte lade die Rezepte neu („Standardrezepte laden“) und wiederhole die Änderung.'
                    });
                    return;
                }

                const referencedFiles = new Set(payload.referencedFiles);
                if (referencedFiles.size !== payload.referencedFiles.length
                    || payload.referencedFiles.some(src => !isSafeEncryptedPath(src))) {
                    throw new Error('Die Anfrage enthält ungültige Medienpfade.');
                }
                const plainReferencedFiles = new Set(payload.plainReferencedFiles);
                if (plainReferencedFiles.size !== payload.plainReferencedFiles.length
                    || payload.plainReferencedFiles.some(src => !isSafePlainMediaPath(src))) {
                    throw new Error('Die Anfrage enthält ungültige lokale Medienpfade.');
                }
                const mediaToWrite = [];
                const pendingMediaPaths = new Set();
                for (const media of payload.mediaFiles) {
                    if (!media || !isSafeEncryptedPath(media.src) || !referencedFiles.has(media.src)
                        || typeof media.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(media.data)) {
                        throw new Error('Eine verschlüsselte Mediendatei hat ein ungültiges Format.');
                    }
                    const bytes = Buffer.from(media.data, 'base64');
                    if (bytes.length < 29 || bytes.length > 20 * 1024 * 1024 + 64) {
                        throw new Error('Eine verschlüsselte Mediendatei ist leer, ungültig oder größer als 20 MB.');
                    }
                    if (pendingMediaPaths.has(media.src)) throw new Error('Ein Medienpfad kommt mehrfach vor.');
                    pendingMediaPaths.add(media.src);
                    mediaToWrite.push({ src: media.src, bytes });
                }
                const plainMediaToWrite = [];
                const pendingPlainMediaPaths = new Set();
                for (const media of payload.plainMediaFiles) {
                    if (!media || !isSafePlainMediaPath(media.src) || !plainReferencedFiles.has(media.src)
                        || typeof media.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(media.data)) {
                        throw new Error('Eine lokale Mediendatei hat ein ungültiges Format.');
                    }
                    const bytes = Buffer.from(media.data, 'base64');
                    if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
                        throw new Error('Eine lokale Mediendatei ist leer oder größer als 20 MB.');
                    }
                    if (pendingPlainMediaPaths.has(media.src)) throw new Error('Ein lokaler Medienpfad kommt mehrfach vor.');
                    pendingPlainMediaPaths.add(media.src);
                    plainMediaToWrite.push({ src: media.src, bytes });
                }

                const writtenMedia = [];
                let archiveCommitted = false;
                let encryptedArchiveWritten = false;
                let plaintextRecipesWritten = false;
                const plaintextRecipesPath = path.join(root, 'recipes.json');
                const hadEncryptedArchive = fs.existsSync(recipeFile);
                const hadPlaintextRecipes = fs.existsSync(plaintextRecipesPath);
                try {
                    for (const { src, bytes } of [...mediaToWrite, ...plainMediaToWrite]) {
                        const filePath = path.resolve(root, src);
                        if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Ungültiger Medienpfad.');
                        fs.mkdirSync(path.dirname(filePath), { recursive: true });
                        fs.writeFileSync(filePath, bytes, { flag: 'wx' });
                        writtenMedia.push(filePath);
                    }

                    if (hadEncryptedArchive) fs.copyFileSync(recipeFile, `${recipeFile}.bak`);
                    const temporaryFile = `${recipeFile}.tmp`;
                    fs.writeFileSync(temporaryFile, `${JSON.stringify(envelope)}\n`, { flag: 'w' });
                    fs.renameSync(temporaryFile, recipeFile);
                    encryptedArchiveWritten = true;

                    if (hadPlaintextRecipes) fs.copyFileSync(plaintextRecipesPath, `${plaintextRecipesPath}.bak`);
                    const plainTemporaryFile = `${plaintextRecipesPath}.tmp`;
                    fs.writeFileSync(plainTemporaryFile, `${JSON.stringify({ version: 1, recipes: payload.plainRecipes }, null, 2)}\n`, 'utf8');
                    fs.renameSync(plainTemporaryFile, plaintextRecipesPath);
                    plaintextRecipesWritten = true;
                    archiveCommitted = true;

                    let deletedEncryptedMedia = 0;
                    let deletedPlainMedia = 0;
                    for (const directory of [path.join(root, 'images', 'recipes'), path.join(root, 'videos', 'recipes')]) {
                        if (!fs.existsSync(directory)) continue;
                        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                            const src = `${path.basename(path.dirname(directory))}/recipes/${entry.name}`;
                            if (!entry.isFile()) continue;
                            if (entry.name.endsWith('.enc') && !referencedFiles.has(src)) {
                                fs.unlinkSync(path.join(directory, entry.name));
                                deletedEncryptedMedia++;
                            } else if (/\.(?:jpe?g|png|webp|mp4|mov|webm)$/i.test(entry.name)
                                && !plainReferencedFiles.has(src)) {
                                fs.unlinkSync(path.join(directory, entry.name));
                                deletedPlainMedia++;
                            }
                        }
                    }
                    sendJson(response, 200, {
                        revision: envelope.revision,
                        savedMedia: mediaToWrite.length,
                        deletedMedia: deletedEncryptedMedia + deletedPlainMedia
                    });
                } catch (error) {
                    if (!archiveCommitted) {
                        if (encryptedArchiveWritten) {
                            if (hadEncryptedArchive) fs.copyFileSync(`${recipeFile}.bak`, recipeFile);
                            else fs.unlinkSync(recipeFile);
                        }
                        if (plaintextRecipesWritten) {
                            if (hadPlaintextRecipes) fs.copyFileSync(`${plaintextRecipesPath}.bak`, plaintextRecipesPath);
                            else fs.unlinkSync(plaintextRecipesPath);
                        }
                        for (const filePath of writtenMedia) {
                            try { fs.unlinkSync(filePath); } catch (cleanupError) {
                                if (cleanupError.code !== 'ENOENT') console.error('Mediendatei konnte nicht zurückgerollt werden:', cleanupError);
                            }
                        }
                    }
                    for (const temporaryFile of [`${recipeFile}.tmp`, `${plaintextRecipesPath}.tmp`]) {
                        try { fs.unlinkSync(temporaryFile); } catch (cleanupError) {
                            if (cleanupError.code !== 'ENOENT') console.error('Temporäre Rezeptdatei konnte nicht entfernt werden:', cleanupError);
                        }
                    }
                    throw error;
                }
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

        if (!isAllowedLocalHost(request.headers.host)) {
            response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Forbidden');
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
                pipeline(fs.createReadStream(filePath, { start, end }), response, error => {
                    if (error) response.destroy();
                });
                return;
            }
            response.writeHead(200, {
                'Accept-Ranges': contentType.startsWith('video/') ? 'bytes' : 'none',
                'Content-Length': stats.size,
                'Content-Type': contentType,
                'X-Content-Type-Options': 'nosniff'
            });
            if (request.method === 'HEAD') { response.end(); return; }
            pipeline(fs.createReadStream(filePath), response, error => {
                if (error) response.destroy();
            });
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
