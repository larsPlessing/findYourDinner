const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../server.js');

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
            Origin: `http://localhost:${address.port}`
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

test('localhost save API rejects non-local origins', async t => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'find-your-dinner-'));
    const server = createServer({ rootDirectory: projectDirectory });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(projectDirectory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/save-recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
        body: JSON.stringify({ recipes: [] })
    });
    assert.equal(response.status, 403);
    assert.deepEqual(fs.existsSync(path.join(projectDirectory, 'recipes.json')), false);
});
