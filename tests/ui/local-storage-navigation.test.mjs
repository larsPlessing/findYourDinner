import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');
const homepage = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const detailPage = fs.readFileSync(path.join(projectRoot, 'pages/recipe-detail.html'), 'utf8');
const recipeEditor = fs.readFileSync(path.join(projectRoot, 'js/recipeEditor.mjs'), 'utf8');
const homepageJs = fs.readFileSync(path.join(projectRoot, 'js/indexPage.mjs'), 'utf8');
const detailJs = fs.readFileSync(path.join(projectRoot, 'js/recipeDetail.mjs'), 'utf8');

test('recipe data stays available across navigation on a GitHub Pages project URL', () => {
    const githubPagesHome = new URL('https://example.github.io/findYourDinner/');
    const detailUrl = new URL('pages/recipe-detail.html', githubPagesHome);
    const backUrl = new URL('../index.html', detailUrl);

    // GitHub Pages serves both documents from the same origin, so browser localStorage is shared.
    assert.equal(detailUrl.origin, githubPagesHome.origin);
    assert.equal(backUrl.origin, githubPagesHome.origin);
    assert.equal(backUrl.pathname, '/findYourDinner/index.html');

    // Opening a recipe stores its key before following a relative URL.
    assert.match(homepageJs, /localStorage\.setItem\(['"]currentRecipe['"],\s*recipeKey\)/);
    assert.match(homepageJs, /url\.searchParams\.set\(['"]id['"],\s*recipeKey\)/);
    assert.match(homepageJs, /window\.location\.href\s*=\s*url\.href/);
    assert.match(detailJs, /new URLSearchParams\(window\.location\.search\)\.get\(['"]id['"]\)/);
    assert.match(detailJs, /localStorage\.getItem\(['"]currentRecipe['"]\)/);
    assert.match(detailJs, /generator\.getRecipeById\(recipeKey\)\s*\|\|\s*generator\.getRecipeByName\(recipeKey\)/);
    assert.match(detailJs, /function goBack\(\)[\s\S]*?document\.referrer[\s\S]*?window\.history\.back\(\)/);
    assert.match(detailJs, /window\.location\.href\s*=\s*homeUrl\.href/);

    // Each page prefers locally saved edits and falls back to the shared recipe cache.
    assert.match(homepageJs, /localStorage\.getItem\(['"]recipes_user_edits['"]\)/);
    assert.match(homepageJs, /generator\.loadFromLocalStorage\(\)/);
    assert.match(homepageJs, /syncWithRemote\(['"]recipes\.enc['"]/);
    assert.match(detailJs, /syncWithRemote\(['"]\.\.\/recipes\.enc['"]/);
    assert.match(detailJs, /localStorage\.getItem\(['"]recipes_user_edits['"]\)/);
    assert.match(homepageJs, /localStorage\.removeItem\(['"]recipes['"]\)/);
    assert.match(detailJs, /localStorage\.removeItem\(['"]recipes['"]\)/);
    assert.match(detailJs, /generator\.loadFromLocalStorage\(\)/);
    assert.doesNotMatch(homepageJs, /localStorage\.clear\s*\(/);
    assert.doesNotMatch(detailJs, /localStorage\.clear\s*\(/);
});

test('local recipe file validation accepts encrypted envelopes and plain recipe lists', () => {
    assert.match(detailJs, /data\?\.kdf !== ['"]PBKDF2-SHA-256['"]\s*&&\s*!Array\.isArray\(data\?\.recipes\)/);
});

test('detail page opens the editor in place with the current recipe selected', () => {
    assert.match(detailPage, /id=["']editCurrentRecipeBtn["']/);
    assert.match(detailJs, /getElementById\(["']editCurrentRecipeBtn["']\)\.addEventListener\(["']click["'], editCurrentRecipe\)/);
    assert.match(detailPage, /id=["']recipeEditor["']/);
    assert.match(detailPage, /<script type=["']module["'] src=["']\.\.\/js\/recipeEditor\.mjs["']/);
    assert.match(detailJs, /function editCurrentRecipe\(\)\s*\{\s*if\s*\(!currentRecipe\)\s*return;\s*openRecipeEditor\(currentRecipe\.id\);\s*\}/);
    assert.match(detailJs, /async function onRecipeEditorSaved\(recipe\)[\s\S]*?currentRecipe = recipe;[\s\S]*?await displayRecipe\(\);/);
    assert.match(detailJs, /window\.history\.replaceState\(null,\s*'',\s*url\)/);
    assert.match(recipeEditor, /function openRecipeEditor\(recipeKey = null\)/);
    assert.match(recipeEditor, /generator\.recipes\.findIndex\(recipe => String\(recipe\.id\) === String\(recipeKey\)/);
    assert.doesNotMatch(detailJs, /function editCurrentRecipe\(\)\s*\{[^}]*window\.location\.href/s);
});

test('editor sends encrypted archive and identifies the revision it edits', () => {
    assert.match(recipeEditor, /revision: generator\.revision \?\? null/);
    assert.match(recipeEditor, /generator\.revision = result\.revision/);
    assert.match(recipeEditor, /envelope: encrypted\.envelope/);
    assert.match(recipeEditor, /plainRecipes: encrypted\.plainRecipes/);
    assert.match(detailJs, /localStorage\.getItem\(['"]recipes_revision['"]\)/);
    assert.match(homepageJs, /localStorage\.getItem\(['"]recipes_revision['"]\)/);
    assert.match(recipeEditor, /response\.status === 409/);
});

test('recipe editor restricts base categories and offers healthy as an optional flag', () => {
    assert.match(recipeEditor, /\['Salzig', 'Süß'\]/);
    assert.match(recipeEditor, /name: 'Neues Rezept', category: 'Salzig', healthy: false/);
    assert.match(recipeEditor, /healthyInput\.name = 'healthy'/);
    assert.match(recipeEditor, /updated\.healthy = form\.elements\.healthy\.checked/);
    assert.doesNotMatch(recipeEditor, /editor-add-category|Neue Kategorie/);
});
