import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
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

test('homepage defaults to the salty category', () => {
    assert.match(html, /let currentCategory = ['"]Salzig['"]/);
    assert.match(html, /let healthyOnly = false/);
    assert.match(html, /healthyOnly = !healthyOnly/);
    assert.match(html, /currentCategory = currentCategory === category \? null : category/);
    assert.match(html, /applyFilters\(searchInput\.value\)/);
});

test('homepage wires search, category filtering and recipe navigation', () => {
    assert.match(html, /searchInput\.addEventListener\(['"]input['"],\s*handleSearch\)/);
    assert.match(html, /button\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*filterByCategory\(category\)\)/);
    assert.match(html, /pin\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*openRecipe\(recipe\.name\)\)/);
    assert.match(html, /localStorage\.setItem\(['"]currentRecipe['"],\s*recipeName\)/);
});

test('homepage renders recipe and category data without HTML interpolation', () => {
    assert.doesNotMatch(html, /item\.innerHTML\s*=/);
    assert.doesNotMatch(html, /categoryFilter\.innerHTML\s*=/);
    assert.match(html, /title\.textContent\s*=\s*recipe\.name/);
    assert.match(html, /button\.textContent\s*=\s*category/);
});

test('homepage uses the JSON source and offers local file selection', () => {
    assert.match(html, /loadFromURL\(['"]recipes\.json['"]\)/);
    assert.match(html, /<label for=["']recipesJsonInput["'][^>]*class=["']file-label["']/);
    assert.match(html, /recipesJsonInput\.addEventListener\(['"]change['"],\s*handleLocalJsonFile\)/);
    assert.match(html, /loadRecipesFile\(file\)/);
});

test('homepage provides the same upload dialog flow for choosing or reloading a file', () => {
    assert.match(html, /id=["']uploadOverlay["']/);
    assert.match(html, /onclick=["']showUploadDialog\(\)["']/);
    assert.match(html, /onclick=["']loadDefaultRecipes\(\)["']/);
    assert.match(html, /onclick=["']closeUploadOverlay\(\)["']/);
});

test('homepage does not contain mojibake text', () => {
    const mojibakePattern = /(?:Ãƒ|Ã.|Â.|ðŸ|â€|ï¸)/u;
    assert.doesNotMatch(html, mojibakePattern, 'found text that appears to have been decoded with the wrong character encoding');
});
