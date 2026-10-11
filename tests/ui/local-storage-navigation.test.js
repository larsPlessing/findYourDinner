const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');
const homepage = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const detailPage = fs.readFileSync(path.join(projectRoot, 'pages/recipe-detail.html'), 'utf8');
const recipeEditor = fs.readFileSync(path.join(projectRoot, 'js/recipeEditor.js'), 'utf8');

test('recipe data stays available across navigation on a GitHub Pages project URL', () => {
    const githubPagesHome = new URL('https://example.github.io/findYourDinner/');
    const detailUrl = new URL('pages/recipe-detail.html', githubPagesHome);
    const backUrl = new URL('../index.html', detailUrl);

    // GitHub Pages serves both documents from the same origin, so browser localStorage is shared.
    assert.equal(detailUrl.origin, githubPagesHome.origin);
    assert.equal(backUrl.origin, githubPagesHome.origin);
    assert.equal(backUrl.pathname, '/findYourDinner/index.html');

    // Opening a recipe stores its key before following a relative URL.
    assert.match(homepage, /localStorage\.setItem\(['"]currentRecipe['"],\s*recipeName\)/);
    assert.match(homepage, /window\.location\.href\s*=\s*['"]pages\/recipe-detail\.html['"]/);
    assert.match(detailPage, /localStorage\.getItem\(['"]currentRecipe['"]\)/);
    assert.match(detailPage, /window\.location\.href\s*=\s*['"]\.\.\/index\.html['"]/);

    // Each page prefers locally saved edits and falls back to the shared recipe cache.
    assert.match(homepage, /localStorage\.getItem\(['"]recipes_user_edits['"]\)/);
    assert.match(homepage, /generator\.loadFromLocalStorage\(\)/);
    assert.match(detailPage, /localStorage\.getItem\(['"]recipes_user_edits['"]\)/);
    assert.match(detailPage, /generator\.loadFromLocalStorage\(\)/);
    assert.doesNotMatch(homepage, /localStorage\.clear\s*\(/);
    assert.doesNotMatch(detailPage, /localStorage\.clear\s*\(/);
});

test('detail page opens the editor in place with the current recipe selected', () => {
    assert.match(detailPage, /onclick=["']editCurrentRecipe\(\)["']/);
    assert.match(detailPage, /id=["']recipeEditor["']/);
    assert.match(detailPage, /<script src=["']\.\.\/js\/recipeEditor\.js["']/);
    assert.match(detailPage, /function editCurrentRecipe\(\)\s*\{\s*if\s*\(!currentRecipe\)\s*return;\s*openRecipeEditor\(currentRecipe\.name\);\s*\}/);
    assert.match(detailPage, /async function onRecipeEditorSaved\(recipe\)[\s\S]*?currentRecipe = recipe;[\s\S]*?await displayRecipe\(\);/);
    assert.match(recipeEditor, /function openRecipeEditor\(recipeName = null\)/);
    assert.match(recipeEditor, /generator\.recipes\.findIndex\(recipe => recipe\.name === recipeName \|\| recipe\.sheetName === recipeName\)/);
    assert.doesNotMatch(detailPage, /function editCurrentRecipe\(\)\s*\{[^}]*window\.location\.href/s);
});
