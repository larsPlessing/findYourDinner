import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const homepageJs = fs.readFileSync(path.resolve(__dirname, '../../js/indexPage.mjs'), 'utf8');

test('homepage provides the DOM elements used by recipe browsing', () => {
    for (const id of ['searchInput', 'categoryFilter', 'masonryGrid', 'loadingState']) {
        assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
    }
});

test('category filters are inside the search container', () => {
    const searchContainer = html.match(/<div class="search-container">([\s\S]*?)<\/div>\s*<\/div>/)?.[1];
    assert.ok(searchContainer, 'search container should exist');
    assert.match(searchContainer, /id="categoryFilter"/);
});

test('homepage defaults to the salty category', () => {
    assert.match(homepageJs, /let currentCategory = ['"]Salzig['"]/);
    assert.match(homepageJs, /let healthyOnly = false/);
    assert.match(homepageJs, /healthyOnly = !healthyOnly/);
    assert.match(homepageJs, /currentCategory = currentCategory === category \? null : category/);
    assert.match(homepageJs, /applyFilters\(searchInput\.value\)/);
});

test('homepage wires search, category filtering and recipe navigation', () => {
    assert.match(homepageJs, /searchInput\.addEventListener\(['"]input['"],\s*handleSearch\)/);
    assert.match(homepageJs, /button\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*filterByCategory\(category\)\)/);
    assert.match(homepageJs, /pin\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*openRecipe\(recipe\)\)/);
    assert.match(homepageJs, /localStorage\.setItem\(['"]currentRecipe['"],\s*recipeKey\)/);
});

test('homepage renders recipe and category data without HTML interpolation', () => {
    assert.doesNotMatch(homepageJs, /item\.innerHTML\s*=/);
    assert.doesNotMatch(homepageJs, /categoryFilter\.innerHTML\s*=/);
    assert.doesNotMatch(homepageJs, /img\.style\.objectFit\s*=/,
        'recipe card images should inherit object-fit from the shared cover style');
    assert.match(homepageJs, /title\.textContent\s*=\s*recipe\.name/);
    assert.match(homepageJs, /button\.textContent\s*=\s*category/);
});

test('homepage uses the JSON source and offers local file selection', () => {
    assert.match(homepageJs, /loadFromURL\(['"]recipes\.json['"]\)/);
    assert.match(html, /<label for=["']recipesJsonInput["'][^>]*class=["']file-label["']/);
    assert.match(homepageJs, /recipesJsonInput\.addEventListener\(['"]change['"],\s*handleLocalJsonFile\)/);
    assert.match(homepageJs, /loadRecipesFile\(file\)/);
});

test('homepage provides the same upload dialog flow for choosing or reloading a file', () => {
    assert.match(html, /id=["']uploadOverlay["']/);
    for (const id of ['uploadRecipesBtn', 'loadDefaultRecipesBtn', 'closeUploadOverlayBtn', 'shuffleBtn', 'openEditorBtn', 'categoryChipAll']) {
        assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
    }
    assert.match(homepageJs, /getElementById\(["']uploadRecipesBtn["']\)\.addEventListener\(["']click["'], \(\) => showUploadDialog\(\)\)/);
    assert.match(homepageJs, /getElementById\(["']loadDefaultRecipesBtn["']\)\.addEventListener\(["']click["'], \(\) => loadDefaultRecipes\(\)\)/);
    assert.match(homepageJs, /getElementById\(["']closeUploadOverlayBtn["']\)\.addEventListener\(["']click["'], closeUploadOverlay\)/);
    assert.ok(html.indexOf('id="uploadOverlay"') > html.indexOf('</div>\n\n    <div id="recipeEditor"'),
        'the viewport-fixed upload overlay should be outside the transformed page container');
});

test('homepage HTML carries no inline JavaScript', () => {
    assert.doesNotMatch(html, /onclick=/);
    assert.doesNotMatch(html, /<script type=["']module["']\s*>/);
});

test('homepage does not contain mojibake text', () => {
    const mojibakePattern = /(?:Ãƒ|Ã.|Â.|ðŸ|â€|ï¸)/u;
    assert.doesNotMatch(html, mojibakePattern, 'found text that appears to have been decoded with the wrong character encoding');
});
