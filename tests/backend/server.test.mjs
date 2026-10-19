import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
let createServer;

test.before(async () => {
    ({ createServer } = await import('../../server.mjs'));
});

test('localhost save API writes image files and recipes.json into the project', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const server = createServer({ rootDirectory: projectDirectory });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const imageBytes = Buffer.from('test-image-bytes');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/save-recipes`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: `http://127.0.0.1:${address.port}`
        },
        body: JSON.stringify({
            version: 1,
            recipes: [{ id: 7, name: 'Apfel Kuchen', images: [{ src: `data:image/jpeg;base64,${imageBytes.toString('base64')}` }] }]
        })
    });

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.savedImages, 1);
    assert.match(result.revision, /^[0-9a-f]{16}$/);
    assert.equal(result.recipes[0].images[0].src, 'images/recipes/apfel-kuchen-7-1.jpg');
    assert.deepEqual(fs.readFileSync(path.join(projectDirectory, result.recipes[0].images[0].src)), imageBytes);
    const stored = JSON.parse(fs.readFileSync(path.join(projectDirectory, 'recipes.json'), 'utf8'));
    assert.equal(stored.version, 1);
    assert.equal(stored.revision, result.revision);
    assert.deepEqual(stored.recipes, result.recipes);
    // Ohne vorherige Datei gibt es noch keine Sicherung.
    assert.equal(fs.existsSync(path.join(projectDirectory, 'recipes.json.bak')), false);
});

test('localhost save API writes no images when a later recipe has an invalid image list', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const server = createServer({ rootDirectory: projectDirectory });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${baseUrl}/api/save-recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({
            recipes: [
                { id: 1, name: 'Erstes Rezept', images: [{ src: `data:image/jpeg;base64,${Buffer.from('image').toString('base64')}` }] },
                { id: 2, name: 'Ungültiges Rezept', images: 'not-an-array' }
            ]
        })
    });

    assert.equal(response.status, 400);
    assert.deepEqual(fs.readdirSync(path.join(projectDirectory, 'images', 'recipes')), []);
});

test('oversized JSON requests receive HTTP 413 without destroying the request before the response', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const server = createServer({ rootDirectory: projectDirectory });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const bodySize = 50 * 1024 * 1024 + 1;
    const statusCode = await new Promise((resolve, reject) => {
        const request = http.request({
            hostname: '127.0.0.1',
            port: address.port,
            path: '/api/save-recipes',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': bodySize,
                Origin: `http://127.0.0.1:${address.port}`
            }
        }, response => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        const chunk = Buffer.alloc(1024 * 1024);
        for (let sent = 0; sent < bodySize; sent += chunk.length) {
            request.write(sent + chunk.length > bodySize ? chunk.subarray(0, bodySize - sent) : chunk);
        }
        request.end();
    });

    assert.equal(statusCode, 413);
});

test('localhost save API keeps existing images when a new image is moved to the front', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const server = createServer({ rootDirectory: projectDirectory });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'Content-Type': 'application/json', Origin: baseUrl };
    const originalBytes = Buffer.from('original-image');
    const coverBytes = Buffer.from('new-cover-image');
    const toDataUrl = bytes => `data:image/jpeg;base64,${bytes.toString('base64')}`;

    const first = await fetch(`${baseUrl}/api/save-recipes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: 1, recipes: [{ id: 7, name: 'Apfel Kuchen', images: [{ src: toDataUrl(originalBytes) }] }] })
    });
    assert.equal(first.status, 200);
    const firstResult = await first.json();
    const storedImagePath = firstResult.recipes[0].images[0].src;
    assert.equal(storedImagePath, 'images/recipes/apfel-kuchen-7-1.jpg');

    // Neue Aufnahme als Titelbild nach vorne sortieren und das bestehende Bild erhalten.
    const second = await fetch(`${baseUrl}/api/save-recipes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            version: 1,
            revision: firstResult.revision,
            recipes: [{ id: 7, name: 'Apfel Kuchen', images: [{ src: toDataUrl(coverBytes) }, { src: storedImagePath }] }]
        })
    });
    assert.equal(second.status, 200);
    const images = (await second.json()).recipes[0].images;
    assert.notEqual(images[0].src, storedImagePath, 'the new cover image must not reuse the existing file name');
    assert.equal(images[1].src, storedImagePath, 'the existing image keeps its file');
    assert.deepEqual(fs.readFileSync(path.join(projectDirectory, images[0].src)), coverBytes);
    assert.deepEqual(fs.readFileSync(path.join(projectDirectory, images[1].src)), originalBytes, 'the existing image file must not be overwritten');
});

test('localhost save API rejects cross-origin, missing-origin and non-JSON requests', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const server = createServer({ rootDirectory: projectDirectory });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const url = `http://127.0.0.1:${server.address().port}/api/save-recipes`;
    const body = JSON.stringify({ recipes: [] });
    const requests = [
        { headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, status: 403 },
        { headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${server.address().port + 1}` }, status: 403 },
        { headers: { 'Content-Type': 'application/json' }, status: 403 },
        { headers: { 'Content-Type': 'text/plain', Origin: `http://127.0.0.1:${server.address().port}` }, status: 415 }
    ];

    for (const request of requests) {
        const response = await fetch(url, { method: 'POST', headers: request.headers, body });
        assert.equal(response.status, request.status);
    }
    assert.deepEqual(fs.existsSync(path.join(projectDirectory, 'recipes.json')), false);
});

test('static server does not serve dotfiles or files inside hidden directories', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    fs.writeFileSync(path.join(projectDirectory, '.env'), 'SECRET=test');
    fs.mkdirSync(path.join(projectDirectory, '.hidden'));
    fs.writeFileSync(path.join(projectDirectory, '.hidden', 'secret.txt'), 'SECRET=test');
    fs.writeFileSync(path.join(projectDirectory, 'index.html'), 'public page');
    const server = createServer({ rootDirectory: projectDirectory });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const hiddenPath of ['/.env', '/.hidden/secret.txt']) {
        const response = await fetch(`${baseUrl}${hiddenPath}`);
        assert.equal(response.status, 404, `${hiddenPath} should not be served`);
        assert.doesNotMatch(await response.text(), /SECRET=test/);
    }
    const publicPage = await fetch(`${baseUrl}/`);
    assert.equal(publicPage.status, 200);
    assert.equal(await publicPage.text(), 'public page');
});

test('static server serves mjs files with a JavaScript MIME type', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    fs.writeFileSync(path.join(projectDirectory, 'app.mjs'), 'export default true;');
    const server = createServer({ rootDirectory: projectDirectory });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const response = await fetch(`http://127.0.0.1:${server.address().port}/app.mjs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/javascript\b/);
    assert.equal(await response.text(), 'export default true;');
});

test('localhost import API always offers both categories, including with an empty recipe list', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    fs.writeFileSync(path.join(projectDirectory, 'recipes.json'), JSON.stringify({ recipes: [] }));
    let passedCategories;
    const server = createServer({
        rootDirectory: projectDirectory,
        importRecipe: async payload => {
            passedCategories = payload.categories;
            return { categories: payload.categories };
        }
    });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/import-recipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${server.address().port}` },
        body: JSON.stringify({ url: 'https://example.com/recipe' })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(passedCategories, ['Salzig', 'Süß']);
    assert.deepEqual((await response.json()).recipe.categories, ['Salzig', 'Süß']);
});

test('localhost import API stores recipe videos, streams byte ranges and removes unreferenced files', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    fs.writeFileSync(path.join(projectDirectory, 'recipes.json'), JSON.stringify({
        recipes: [{ category: 'Salzig' }]
    }));
    const videoBytes = Buffer.from('test-video-content');
    const server = createServer({
        rootDirectory: projectDirectory,
        importRecipe: async () => ({
            name: 'Asia-Udon-Salat',
            video: { mimeType: 'video/mp4', data: videoBytes.toString('base64') }
        })
    });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const origin = { Origin: baseUrl, 'Content-Type': 'application/json' };
    const importResponse = await fetch(`${baseUrl}/api/import-recipe`, {
        method: 'POST',
        headers: origin,
        body: JSON.stringify({ url: 'https://www.instagram.com/reel/example/' })
    });
    assert.equal(importResponse.status, 200);
    const recipe = (await importResponse.json()).recipe;
    assert.match(recipe.video.src, /^videos\/recipes\/asia-udon-salat-[\w-]+\.mp4$/);
    assert.deepEqual(fs.readFileSync(path.join(projectDirectory, recipe.video.src)), videoBytes);

    const videoResponse = await fetch(`${baseUrl}/${recipe.video.src}`, { headers: { Range: 'bytes=2-6' } });
    assert.equal(videoResponse.status, 206);
    assert.equal(videoResponse.headers.get('content-type'), 'video/mp4');
    assert.equal(videoResponse.headers.get('content-range'), `bytes 2-6/${videoBytes.length}`);
    assert.deepEqual(Buffer.from(await videoResponse.arrayBuffer()), videoBytes.subarray(2, 7));
    const suffixResponse = await fetch(`${baseUrl}/${recipe.video.src}`, { headers: { Range: 'bytes=-4' } });
    assert.equal(suffixResponse.status, 206);
    assert.equal(suffixResponse.headers.get('content-range'), `bytes ${videoBytes.length - 4}-${videoBytes.length - 1}/${videoBytes.length}`);
    assert.deepEqual(Buffer.from(await suffixResponse.arrayBuffer()), videoBytes.subarray(-4));

    const saveResponse = await fetch(`${baseUrl}/api/save-recipes`, {
        method: 'POST',
        headers: origin,
        body: JSON.stringify({ version: 1, recipes: [recipe] })
    });
    assert.equal(saveResponse.status, 200);
    const saveResult = await saveResponse.json();
    assert.equal(saveResult.deletedVideos, 0);
    assert.equal(fs.existsSync(path.join(projectDirectory, recipe.video.src)), true);

    const deleteResponse = await fetch(`${baseUrl}/api/save-recipes`, {
        method: 'POST',
        headers: origin,
        body: JSON.stringify({ version: 1, revision: saveResult.revision, recipes: [] })
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal((await deleteResponse.json()).deletedVideos, 1);
    assert.equal(fs.existsSync(path.join(projectDirectory, recipe.video.src)), false);
});

test('localhost save API rejects a stale revision and protects newer files and media', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const imageDirectory = path.join(projectDirectory, 'images', 'recipes');
    fs.mkdirSync(imageDirectory, { recursive: true });
    const currentFile = {
        version: 1,
        revision: 'neuer-stand',
        recipes: [{ id: 1, name: 'Neues Rezept', images: [{ src: 'images/recipes/neu-1-1.jpg' }] }]
    };
    fs.writeFileSync(path.join(projectDirectory, 'recipes.json'), JSON.stringify(currentFile));
    fs.writeFileSync(path.join(imageDirectory, 'neu-1-1.jpg'), 'neues-bild');
    const server = createServer({ rootDirectory: projectDirectory });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'Content-Type': 'application/json', Origin: baseUrl };

    // Veralteter Browserstand (andere Rezepte als auf der Platte) darf nichts überschreiben.
    const staleRequest = await fetch(`${baseUrl}/api/save-recipes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: 1, revision: 'veraltet', recipes: [{ id: 2, name: 'Altes Rezept', images: [] }] })
    });
    assert.equal(staleRequest.status, 409);
    assert.match((await staleRequest.json()).error, /git pull|neu/i);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projectDirectory, 'recipes.json'), 'utf8')), currentFile);
    assert.equal(fs.existsSync(path.join(imageDirectory, 'neu-1-1.jpg')), true, 'neuere Medien dürfen nicht gelöscht werden');
    assert.equal(fs.existsSync(path.join(projectDirectory, 'recipes.json.bak')), false);

    // Passende Revision wird gespeichert und sichert den vorherigen Stand.
    const saveRequest = await fetch(`${baseUrl}/api/save-recipes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: 1, revision: 'neuer-stand', recipes: [{ id: 2, name: 'Altes Rezept', images: [] }] })
    });
    assert.equal(saveRequest.status, 200);
    const saved = await saveRequest.json();
    assert.match(saved.revision, /^[0-9a-f]{16}$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projectDirectory, 'recipes.json.bak'), 'utf8')), currentFile);
});
