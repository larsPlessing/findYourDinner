const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

test('homepage provides the DOM elements used by recipe browsing', () => {
    for (const id of ['searchInput', 'categoryFilter', 'masonryGrid', 'loadingState']) {
        assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
    }
});

test('homepage wires search, category filtering and recipe navigation', () => {
    assert.match(html, /searchInput\.addEventListener\(['"]input['"],\s*handleSearch\)/);
    assert.match(html, /onclick="filterByCategory\(/);
    assert.match(html, /onclick="openRecipe\(/);
    assert.match(html, /localStorage\.setItem\(['"]currentRecipe['"],\s*recipeName\)/);
});

test('homepage uses the JSON source and offers local file selection', () => {
    assert.match(html, /loadFromURL\(['"]recipes\.json['"]\)/);
    assert.match(html, /id=["']chooseRecipesJson["']/);
    assert.match(html, /recipesJsonInput\.click\(\)/);
    assert.match(html, /loadRecipesFile\(file\)/);
});

test('homepage does not contain mojibake text', () => {
    const mojibakePattern = /(?:Ãƒ|Ã.|Â.|ðŸ|â€|ï¸)/u;
    assert.doesNotMatch(html, mojibakePattern, 'found text that appears to have been decoded with the wrong character encoding');
});
