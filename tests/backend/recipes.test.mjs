import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../..');
const data = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'recipes.json'), 'utf8'));

test('recipe JSON has a supported version and a non-empty recipe list', () => {
    assert.equal(data.version, 1);
    assert.ok(Array.isArray(data.recipes));
    assert.ok(data.recipes.length > 0);
});

test('every recipe has the fields used by the application', () => {
    const ids = new Set();
    for (const recipe of data.recipes) {
        assert.ok(Number.isInteger(recipe.id), `${recipe.name} needs an integer id`);
        assert.ok(!ids.has(recipe.id), `duplicate recipe id ${recipe.id}`);
        ids.add(recipe.id);
        assert.equal(typeof recipe.name, 'string');
        assert.ok(recipe.name.trim().length > 0);
        assert.equal(typeof recipe.category, 'string');
        assert.ok(['Salzig', 'Süß'].includes(recipe.category), `${recipe.name} has unsupported category ${recipe.category}`);
        assert.equal(typeof recipe.healthy, 'boolean', `${recipe.name} needs a healthy boolean`);
        assert.ok(Array.isArray(recipe.ingredients));
        assert.ok(Array.isArray(recipe.instructions));
        assert.ok(Array.isArray(recipe.notes));
        assert.ok(Array.isArray(recipe.images));
    }
});

test('healthy is set only on recipes with a clearly lighter overall composition', () => {
    const healthyRecipes = data.recipes.filter(recipe => recipe.healthy).map(recipe => recipe.id);
    assert.deepEqual(healthyRecipes, [7, 10, 12, 14, 15, 17, 25, 38, 39, 40, 44, 45, 47, 49, 50, 60]);
});

test('recipe text does not contain common mojibake sequences', () => {
    const mojibake = /(?:Ãƒ|Ã.|Â.|ðŸ|â€|ï¸)/u;

    function checkStrings(value, location) {
        if (typeof value === 'string') {
            assert.doesNotMatch(value, mojibake, `mojibake in ${location}: ${value}`);
        } else if (Array.isArray(value)) {
            value.forEach((item, index) => checkStrings(item, `${location}[${index}]`));
        } else if (value && typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) {
                checkStrings(item, `${location}.${key}`);
            }
        }
    }

    checkStrings(data.recipes, 'recipes');
});

test('all recipe image references resolve to repository files', () => {
    for (const recipe of data.recipes) {
        for (const image of recipe.images) {
            assert.equal(typeof image.src, 'string', `${recipe.name} image needs a src`);
            assert.ok(!path.isAbsolute(image.src), `${recipe.name} image path must be relative`);
            const imagePath = path.resolve(repositoryRoot, image.src);
            assert.ok(imagePath.startsWith(repositoryRoot + path.sep), `${recipe.name} image path escapes repository`);
            assert.ok(fs.existsSync(imagePath), `missing image for ${recipe.name}: ${image.src}`);
        }
    }
});
