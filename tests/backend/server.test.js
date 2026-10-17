const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
    assert.equal(result.recipes[0].images[0].src, 'images/recipes/apfel-kuchen-7-1.jpg');
    assert.deepEqual(fs.readFileSync(path.join(projectDirectory, result.recipes[0].images[0].src)), imageBytes);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projectDirectory, 'recipes.json'), 'utf8')), {
        version: 1,
        recipes: result.recipes
    });
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

test('localhost import API passes current recipe categories to the importer', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    fs.writeFileSync(path.join(projectDirectory, 'recipes.json'), JSON.stringify({
        recipes: [
            { category: 'Nachtisch - Süß' },
            { category: ' Mittagessen - Salzig ' },
            { category: 'Nachtisch - Süß' }
        ]
    }));
    const server = createServer({
        rootDirectory: projectDirectory,
        importRecipe: async payload => ({ categories: payload.categories })
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
    assert.deepEqual((await response.json()).recipe.categories, ['Nachtisch - Süß', 'Mittagessen - Salzig']);
});
