import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const homepageJs = fs.readFileSync(path.resolve(__dirname, '../../js/indexPage.mjs'), 'utf8');
const generatorJs = fs.readFileSync(path.resolve(__dirname, '../../js/recipeGenerator.mjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8'));
const maskableIcon = fs.readFileSync(path.resolve(__dirname, '../../images/icon-maskable.svg'), 'utf8');
const recipes = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../recipes.json'), 'utf8')).recipes;

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
    assert.match(homepageJs, /url\.searchParams\.set\(['"]id['"],\s*recipeKey\)/);
    assert.match(homepageJs, /window\.location\.href\s*=\s*url\.href/);
    assert.match(homepageJs, /pin\.addEventListener\(['"]pointerenter['"],\s*\(\)\s*=>\s*prefetchRecipeDetail\(recipe\)/);
    assert.match(homepageJs, /link\.rel\s*=\s*['"]prefetch['"]/);
});

test('homepage renders recipe and category data without HTML interpolation', () => {
    assert.doesNotMatch(homepageJs, /item\.innerHTML\s*=/);
    assert.doesNotMatch(homepageJs, /categoryFilter\.innerHTML\s*=/);
    assert.doesNotMatch(homepageJs, /img\.style\.objectFit\s*=/,
        'recipe card images should inherit object-fit from the shared cover style');
    assert.match(homepageJs, /title\.textContent\s*=\s*recipe\.name/);
    assert.match(homepageJs, /button\.textContent\s*=\s*category/);
});

test('homepage uses the encrypted source and offers local file selection', () => {
    assert.match(homepageJs, /loadFromURL\(['"]recipes\.enc['"]\)/);
    assert.match(homepageJs, /syncWithRemote\(['"]recipes\.enc['"]/);
    assert.match(generatorJs, /Neue Rezeptversion verfügbar/);
    assert.match(homepageJs, /Lokale Änderungen gehen verloren\. Fortfahren\?/);
    assert.match(html, /<label for=["']recipesJsonInput["'][^>]*class=["']file-label["']/);
    assert.match(html, /recipes\.enc/);
    assert.match(homepageJs, /recipesJsonInput\.addEventListener\(['"]change['"],\s*handleLocalJsonFile\)/);
    assert.match(homepageJs, /loadRecipesFile\(file\)/);
});

test('homepage preloads real recipe images before displaying them', () => {
    assert.match(homepageJs, /const recipeCardCache = new Map\(\)/);
    assert.match(homepageJs, /const cachedItem = recipeCardCache\.get\(recipeKey\)/);
    assert.match(homepageJs, /masonryGrid\.replaceChildren\(\)/);
    assert.match(homepageJs, /Promise\.all\(imageElements\.map/);
    assert.match(homepageJs, /img\.loading = ['"]eager['"]/);
    assert.match(homepageJs, /imageEl\.querySelector\(['"]img['"]\)/);
    assert.match(homepageJs, /imageEl\.dataset\.imageLoading === ['"]true['"]/);
    assert.match(homepageJs, /img\.onload = \(\) => \{/);
    assert.match(homepageJs, /img\.src = imageData\.dataUrl/);
    assert.match(homepageJs, /imageEl\.replaceChildren\(img\)/);
    assert.doesNotMatch(homepageJs, /Bild für \$\{recipeName\}/);
});

test('every checked-in recipe image is a valid app asset', () => {
    const recipeImageRoot = path.resolve(__dirname, '../../images/recipes');
    const imageReferences = recipes.flatMap(recipe => Array.isArray(recipe.images) ? recipe.images : [])
        .map(image => image?.src)
        .filter(Boolean);

    assert.ok(imageReferences.length > 0, 'recipes.json should reference at least one image');

    for (const source of new Set(imageReferences)) {
        assert.match(source, /^images\/recipes\/[^/\\]+\.(?:jpe?g|png|webp|enc)$/i,
            `unsupported recipe image source: ${source}`);

        const assetPath = path.resolve(__dirname, '../..', source);
        assert.equal(assetPath.startsWith(`${recipeImageRoot}${path.sep}`), true,
            `recipe image must stay inside images/recipes: ${source}`);
        assert.equal(fs.existsSync(assetPath), true, `missing recipe image: ${source}`);

        const bytes = fs.readFileSync(assetPath);
        assert.ok(bytes.length > 0, `empty recipe image: ${source}`);

        if (source.endsWith('.enc')) {
            assert.ok(bytes.length > 12, `encrypted recipe image has no ciphertext: ${source}`);
        } else if (/\.png$/i.test(source)) {
            assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10],
                `invalid PNG image: ${source}`);
        } else if (/\.jpe?g$/i.test(source)) {
            assert.deepEqual([...bytes.subarray(0, 3)], [255, 216, 255],
                `invalid JPEG image: ${source}`);
        } else {
            assert.deepEqual([...bytes.subarray(0, 4)], [82, 73, 70, 70],
                `invalid WebP image: ${source}`);
            assert.deepEqual([...bytes.subarray(8, 12)], [87, 69, 66, 80],
                `invalid WebP image: ${source}`);
        }
    }
});

test('manifest reserves maskable purpose for a dedicated non-emoji icon', () => {
    const maskable = manifest.icons.filter(icon => icon.purpose === 'maskable');
    assert.deepEqual(maskable.map(icon => icon.src), ['images/icon-maskable.svg']);
    assert.doesNotMatch(maskableIcon, /<text\b|[\u{1F300}-\u{1FAFF}]/u);
});

test('homepage provides the same upload dialog flow for choosing or reloading a file', () => {
    assert.match(html, /id=["']uploadOverlay["']/);
    for (const id of ['uploadRecipesBtn', 'loadDefaultRecipesBtn', 'closeUploadOverlayBtn', 'shuffleBtn', 'openEditorBtn', 'categoryChipAll']) {
        assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
    }
    assert.match(homepageJs, /getElementById\(["']uploadRecipesBtn["']\)\.addEventListener\(["']click["'], \(\) => showUploadDialog\(\)\)/);
    assert.match(homepageJs, /getElementById\(["']loadDefaultRecipesBtn["']\)\.addEventListener\(["']click["'], \(\) => loadDefaultRecipes\(\)\)/);
    assert.match(homepageJs, /getElementById\(["']closeUploadOverlayBtn["']\)\.addEventListener\(["']click["'], closeUploadOverlay\)/);
    const containerEnd = html.search(/<\/div>\s*<div id="uploadOverlay"/);
    assert.ok(html.indexOf('id="uploadOverlay"') > containerEnd,
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
