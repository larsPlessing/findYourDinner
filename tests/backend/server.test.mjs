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

function makeEnvelope(revision = 'revision-1') {
    return {
        version: 1,
        algorithm: 'AES-GCM',
        kdf: 'PBKDF2-SHA-256',
        iterations: 600_000,
        salt: Buffer.alloc(16, 1).toString('base64'),
        iv: Buffer.alloc(12, 2).toString('base64'),
        ciphertext: Buffer.from('encrypted recipe bytes').toString('base64'),
        revision
    };
}

function makeSavePayload({
    revision = null,
    envelopeRevision = 'revision-1',
    mediaFiles = [],
    referencedFiles = [],
    plainRecipes = [],
    plainMediaFiles = [],
    plainReferencedFiles = []
} = {}) {
    return {
        revision,
        envelope: makeEnvelope(envelopeRevision),
        mediaFiles,
        referencedFiles,
        plainRecipes,
        plainMediaFiles,
        plainReferencedFiles
    };
}

async function startTestServer(t, rootDirectory, options = {}) {
    const server = createServer({ rootDirectory, ...options });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(rootDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return { server, origin, headers: { 'Content-Type': 'application/json', Origin: origin } };
}

test('save API writes ciphertext to the repo and plaintext working copies locally', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const encryptedImage = Buffer.alloc(35, 4);
    const plainImage = Buffer.from('local plaintext image');
    const recipe = {
        id: 7,
        name: 'Lokales Rezept',
        images: [{ src: 'images/recipes/recipe.enc', mimeType: 'image/jpeg' }]
    };
    const plainRecipe = {
        id: 7,
        name: 'Lokales Rezept',
        images: [{ src: 'images/recipes/recipe.jpg', mimeType: 'image/jpeg' }]
    };
    const { origin, headers } = await startTestServer(t, root);
    const response = await fetch(`${origin}/api/save-recipes`, {
        method: 'POST',
        headers,
        body: JSON.stringify(makeSavePayload({
            envelopeRevision: 'revision-saved',
            mediaFiles: [{ src: recipe.images[0].src, data: encryptedImage.toString('base64') }],
            referencedFiles: [recipe.images[0].src],
            plainRecipes: [plainRecipe],
            plainMediaFiles: [{ src: plainRecipe.images[0].src, data: plainImage.toString('base64') }],
            plainReferencedFiles: [plainRecipe.images[0].src]
        }))
    });

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.revision, 'revision-saved');
    assert.equal(result.savedMedia, 1);
    assert.equal(fs.readFileSync(path.join(root, 'images/recipes/recipe.enc')).equals(encryptedImage), true);
    assert.equal(fs.readFileSync(path.join(root, 'images/recipes/recipe.jpg')).equals(plainImage), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'recipes.enc'), 'utf8')), makeEnvelope('revision-saved'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'recipes.json'), 'utf8')), {
        version: 1,
        recipes: [plainRecipe]
    });
});

test('save API rejects malformed encrypted media before creating files', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const { origin, headers } = await startTestServer(t, root);
    const response = await fetch(`${origin}/api/save-recipes`, {
        method: 'POST',
        headers,
        body: JSON.stringify(makeSavePayload({
            mediaFiles: [{ src: '../recipes.json', data: Buffer.alloc(35).toString('base64') }],
            referencedFiles: ['../recipes.json']
        }))
    });

    assert.equal(response.status, 400);
    assert.deepEqual(fs.readdirSync(root), []);
});

test('save API cleans only orphaned media and preserves dotfiles', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const imageDirectory = path.join(root, 'images', 'recipes');
    fs.mkdirSync(imageDirectory, { recursive: true });
    fs.writeFileSync(path.join(imageDirectory, '.gitkeep'), '');
    fs.writeFileSync(path.join(imageDirectory, 'orphan.jpg'), 'local');
    fs.writeFileSync(path.join(imageDirectory, 'orphan.enc'), Buffer.alloc(35));
    const { origin, headers } = await startTestServer(t, root);
    const response = await fetch(`${origin}/api/save-recipes`, {
        method: 'POST',
        headers,
        body: JSON.stringify(makeSavePayload())
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).deletedMedia, 2);
    assert.equal(fs.existsSync(path.join(imageDirectory, '.gitkeep')), true);
    assert.equal(fs.existsSync(path.join(imageDirectory, 'orphan.jpg')), false);
    assert.equal(fs.existsSync(path.join(imageDirectory, 'orphan.enc')), false);
});

test('oversized requests receive HTTP 413 without destroying the request before the response', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const { server } = await startTestServer(t, root);
    const bodySize = 128 * 1024 * 1024 + 1;
    const statusCode = await new Promise((resolve, reject) => {
        const request = http.request({
            hostname: '127.0.0.1',
            port: server.address().port,
            path: '/api/save-recipes',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': bodySize,
                Origin: `http://127.0.0.1:${server.address().port}`
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

test('save API accepts two 20 MB videos with encrypted and plaintext copies', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const { origin, headers } = await startTestServer(t, root);
    const videoBytes = Buffer.alloc(20 * 1024 * 1024, 7);
    const encodedVideo = videoBytes.toString('base64');
    const encryptedFiles = ['videos/recipes/first.enc', 'videos/recipes/second.enc'];
    const plainFiles = ['videos/recipes/first.mp4', 'videos/recipes/second.mp4'];
    const body = JSON.stringify(makeSavePayload({
        envelopeRevision: 'large-save',
        mediaFiles: encryptedFiles.map(src => ({ src, data: encodedVideo })),
        referencedFiles: encryptedFiles,
        plainMediaFiles: plainFiles.map(src => ({ src, data: encodedVideo })),
        plainReferencedFiles: plainFiles
    }));

    assert.ok(Buffer.byteLength(body) > 60 * 1024 * 1024);
    assert.ok(Buffer.byteLength(body) < 128 * 1024 * 1024);
    const response = await fetch(`${origin}/api/save-recipes`, { method: 'POST', headers, body });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).savedMedia, 2);
    for (const relativePath of [...encryptedFiles, ...plainFiles]) {
        assert.equal(fs.statSync(path.join(root, relativePath)).size, videoBytes.length);
    }
});

test('save API rejects cross-origin, missing-origin and non-JSON requests', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const { origin } = await startTestServer(t, root);
    const url = `${origin}/api/save-recipes`;
    const body = JSON.stringify({});
    const requests = [
        { headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, status: 403 },
        { headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${new URL(origin).port + 1}` }, status: 403 },
        { headers: { 'Content-Type': 'application/json' }, status: 403 },
        { headers: { 'Content-Type': 'text/plain', Origin: origin }, status: 415 }
    ];

    for (const request of requests) {
        const response = await fetch(url, { method: 'POST', headers: request.headers, body });
        assert.equal(response.status, request.status);
    }
    assert.equal(fs.existsSync(path.join(root, 'recipes.enc')), false);
});

test('save API rejects a stale archive revision without changing recipes or media', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const imageDirectory = path.join(root, 'images', 'recipes');
    fs.mkdirSync(imageDirectory, { recursive: true });
    fs.writeFileSync(path.join(root, 'recipes.enc'), JSON.stringify(makeEnvelope('new-revision')));
    fs.writeFileSync(path.join(imageDirectory, 'new.enc'), Buffer.alloc(35, 7));
    const { origin, headers } = await startTestServer(t, root);

    const response = await fetch(`${origin}/api/save-recipes`, {
        method: 'POST',
        headers,
        body: JSON.stringify(makeSavePayload({
            revision: 'stale-revision',
            envelopeRevision: 'stale-next'
        }))
    });

    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /git pull|neu/i);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'recipes.enc'), 'utf8')).revision, 'new-revision');
    assert.equal(fs.existsSync(path.join(imageDirectory, 'new.enc')), true);
});

test('static server does not serve dotfiles or files inside hidden directories', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=test');
    fs.mkdirSync(path.join(root, '.hidden'));
    fs.writeFileSync(path.join(root, '.hidden', 'secret.txt'), 'SECRET=test');
    fs.writeFileSync(path.join(root, 'index.html'), 'public page');
    const { origin } = await startTestServer(t, root);
    for (const hiddenPath of ['/.env', '/.hidden/secret.txt']) {
        const response = await fetch(`${origin}${hiddenPath}`);
        assert.equal(response.status, 404, `${hiddenPath} should not be served`);
        assert.doesNotMatch(await response.text(), /SECRET=test/);
    }
    const publicPage = await fetch(`${origin}/`);
    assert.equal(publicPage.status, 200);
    assert.equal(await publicPage.text(), 'public page');
});

test('static server serves mjs files with a JavaScript MIME type', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    fs.writeFileSync(path.join(root, 'app.mjs'), 'export default true;');
    const { origin } = await startTestServer(t, root);
    const response = await fetch(`${origin}/app.mjs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/javascript\b/);
    assert.equal(await response.text(), 'export default true;');
});

test('import API offers both categories and returns videos for client-side encryption', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const videoBytes = Buffer.from('test-video-content');
    let passedCategories;
    const { origin, headers } = await startTestServer(t, root, {
        importRecipe: async payload => {
            passedCategories = payload.categories;
            return {
                name: 'Asia-Udon-Salat',
                categories: payload.categories,
                video: { mimeType: 'video/mp4', data: videoBytes.toString('base64') }
            };
        }
    });
    const response = await fetch(`${origin}/api/import-recipe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'https://www.instagram.com/reel/example/' })
    });

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(passedCategories, ['Salzig', 'Süß']);
    assert.deepEqual(result.recipe.categories, ['Salzig', 'Süß']);
    assert.equal(result.recipe.video.src, `data:video/mp4;base64,${videoBytes.toString('base64')}`);
    assert.deepEqual(fs.readdirSync(root), []);
});
