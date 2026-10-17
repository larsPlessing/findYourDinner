import { createRequire } from 'node:module';
import RecipeGenerator from '../../js/recipeGenerator.mjs';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '../..');
const homeHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const detailHtml = fs.readFileSync(path.join(projectRoot, 'pages/recipe-detail.html'), 'utf8');
const recipes = JSON.parse(fs.readFileSync(path.join(projectRoot, 'recipes.json'), 'utf8')).recipes;

test('homepage and detail page use the same existing image files for every recipe in recipes.json', async () => {
    assert.match(homeHtml, /generator\.getRecipeImageURL\(recipeName\)/,
        'homepage should load each card image through RecipeGenerator');
    assert.match(homeHtml, /img\.src\s*=\s*imageData\.dataUrl/,
        'homepage should display the image URL returned by RecipeGenerator');
    assert.match(detailHtml, /generator\.getAllRecipeImageURLs\(currentRecipe\.name\)/,
        'detail page should load images for the selected recipe through RecipeGenerator');
    assert.match(detailHtml, /img\.src\s*=\s*resolveRecipeImageURL\(imageData\.dataUrl\)/,
        'detail page should resolve the same recipe image URL from its nested page');
    assert.match(detailHtml, /return new URL\(`\.\.\/\$\{imageURL\}`, window\.location\.href\)\.href/,
        'detail page should resolve relative image paths from the project root');

    const recipesWithImages = recipes.filter(recipe => Array.isArray(recipe.images) && recipe.images.length > 0);
    assert.ok(recipesWithImages.length > 0, 'recipes.json should include recipes with images');

    let checkedImageCount = 0;
    const generator = new RecipeGenerator();

    for (const recipe of recipesWithImages) {
        generator.recipes = [recipe];
        const homepageImage = await generator.getRecipeImageURL(recipe.name);
        const detailImages = await generator.getAllRecipeImageURLs(recipe.name);

        assert.equal(detailImages.length, recipe.images.length, `${recipe.name}: detail image count`);
        assert.equal(homepageImage.dataUrl, detailImages[0].dataUrl,
            `${recipe.name}: homepage and detail should use the same first image`);

        for (const [index, image] of recipe.images.entries()) {
            const label = `${recipe.name}, image ${index + 1}`;
            const homeURL = new URL(image.src, 'http://localhost/index.html');
            const detailURL = new URL(`../${detailImages[index].dataUrl}`, 'http://localhost/pages/recipe-detail.html');
            const assetPath = path.resolve(projectRoot, decodeURIComponent(homeURL.pathname.slice(1)));

            assert.equal(detailURL.href, homeURL.href, `${label}: both pages should resolve to the same URL`);
            assert.ok(fs.existsSync(assetPath), `${label}: image file should exist at ${assetPath}`);
            checkedImageCount++;
        }
    }

    assert.ok(checkedImageCount > 0, 'the test should check at least one image file');
});

test('homepage and detail-page modules use existing relative mjs paths', () => {
    for (const [pagePath, html] of [['index.html', homeHtml], ['pages/recipe-detail.html', detailHtml]]) {
        const modulePaths = [...html.matchAll(/<script\s+type=["']module["']\s+src=["']([^"']+)["']/g)]
            .map(([, source]) => source);
        assert.ok(modulePaths.length > 0, `${pagePath} should load at least one ES module`);

        for (const source of modulePaths) {
            assert.ok(source.endsWith('.mjs'), `${pagePath} should use .mjs module files`);
            assert.ok(!source.startsWith('/'), `${pagePath} module paths must work under a GitHub Pages project URL`);
            const modulePath = path.resolve(projectRoot, path.dirname(pagePath), source);
            assert.ok(fs.existsSync(modulePath), `${pagePath} references missing module ${source}`);
        }
    }
});
