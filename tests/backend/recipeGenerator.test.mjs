import { createRequire } from 'node:module';
import RecipeGenerator from '../../js/recipeGenerator.mjs';
const require = createRequire(import.meta.url);
const test = require('node:test');
const assert = require('node:assert/strict');

const sampleRecipes = [
    {
        id: 1,
        name: 'Apfelkuchen',
        category: 'Süß',
        healthy: true,
        images: [{ src: 'images/recipes/apfelkuchen.jpg' }],
        ingredients: [],
        instructions: []
    },
    {
        id: 2,
        name: 'Kartoffelsuppe',
        category: 'Salzig',
        healthy: false,
        images: [],
        ingredients: [],
        instructions: []
    }
];

function installBrowserMocks(t, { protocol = 'https:', storage = {} } = {}) {
    const previous = {
        window: global.window,
        localStorage: global.localStorage
    };
    global.window = { location: { protocol } };
    global.localStorage = {
        getItem: t.mock.fn(key => Object.hasOwn(storage, key) ? storage[key] : null),
        setItem: t.mock.fn((key, value) => { storage[key] = String(value); }),
        removeItem: t.mock.fn(key => { delete storage[key]; })
    };
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete global[key];
            else global[key] = value;
        }
    });
}

test('loads recipe JSON and reports completion', async t => {
    installBrowserMocks(t);
    const fetch = t.mock.method(globalThis, 'fetch', async url => ({
        ok: true,
        json: async () => ({ version: 1, recipes: sampleRecipes })
    }));
    const generator = new RecipeGenerator();
    const progress = [];
    const result = await generator.loadFromURL('recipes.json', item => progress.push(item));
    assert.equal(result.length, 2);
    assert.equal(generator.hasImages, true);
    assert.equal(progress.at(-1).progress, 100);
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(fetch.mock.calls[0].arguments[0], 'recipes.json');
});

test('does not fetch JSON from file URLs', async t => {
    installBrowserMocks(t, { protocol: 'file:' });
    const fetch = t.mock.method(globalThis, 'fetch', async () => {});
    await assert.rejects(new RecipeGenerator().loadFromURL('recipes.json'), /file:\/\//);
    assert.equal(fetch.mock.callCount(), 0);
});

test('rejects failed HTTP responses and malformed recipe data', async t => {
    installBrowserMocks(t);
    await t.test('HTTP error', async t => {
        t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 }));
        await assert.rejects(new RecipeGenerator().loadFromURL('recipes.json'), /404/);
    });
    await t.test('invalid schema', async t => {
        t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ recipes: 'invalid' }) }));
        await assert.rejects(new RecipeGenerator().loadFromURL('recipes.json'), /gültige Rezeptliste/);
    });
});

test('searches, filters and returns recipe images', async t => {
    installBrowserMocks(t);
    const generator = new RecipeGenerator();
    generator.recipes = sampleRecipes;
    assert.deepEqual(generator.searchRecipes(' APFEL '), [sampleRecipes[0]]);
    assert.deepEqual(generator.filterByCategory('Süß'), [sampleRecipes[0]]);
    assert.deepEqual(generator.filterByCategory('Salzig', true), []);
    assert.deepEqual(generator.filterByCategory('healthy'), [sampleRecipes[0]]);
    assert.deepEqual(generator.getAllCategories(), ['Salzig', 'Süß', 'healthy']);
    assert.equal((await generator.getRecipeImageURL('Apfelkuchen')).dataUrl, 'images/recipes/apfelkuchen.jpg');
    assert.deepEqual(await generator.getAllRecipeImageURLs('Kartoffelsuppe'), []);
    assert.equal(await generator.hasRecipeImage('Apfelkuchen'), true);
});

test('normalizes legacy category labels from saved recipes', t => {
    installBrowserMocks(t, { storage: { recipes: JSON.stringify([
        { name: 'Kuchen', category: 'Nachtisch - Süß', healthy: true },
        { name: 'Suppe', category: 'Mittagessen - Salzig' }
    ]) } });
    const generator = new RecipeGenerator();
    assert.equal(generator.loadFromLocalStorage(), true);
    assert.deepEqual(generator.recipes.map(recipe => recipe.category), ['Süß', 'Salzig']);
    assert.deepEqual(generator.recipes.map(recipe => recipe.healthy), [true, false]);
});

test('syncs newly classified healthy recipes into existing browser caches', async t => {
    const storage = {
        recipes: JSON.stringify([{ id: 0, name: 'Apfel Oatmeal', category: 'Süß', healthy: false }]),
        recipes_user_edits: JSON.stringify([{ id: 0, name: 'Apfel Oatmeal', category: 'Süß', healthy: false, notes: ['Eigene Notiz'] }])
    };
    installBrowserMocks(t, { storage });
    const generator = new RecipeGenerator();
    generator.recipes = JSON.parse(storage.recipes_user_edits);
    t.mock.method(globalThis, 'fetch', async () => ({
        ok: true,
        json: async () => ({ recipes: [{ id: 0, healthy: true }] })
    }));

    assert.equal(await generator.syncHealthyClassifications('recipes.json'), true);
    assert.equal(generator.recipes[0].healthy, true);
    assert.deepEqual(generator.recipes[0].notes, ['Eigene Notiz']);
    assert.deepEqual(JSON.parse(storage.recipes_user_edits), generator.recipes);
    assert.equal(storage.healthy_classification_version, '1');
    assert.equal(await generator.syncHealthyClassifications('recipes.json'), false);
});

test('filters combine one exclusive base category with optional healthy', () => {
    const generator = new RecipeGenerator();
    generator.recipes = [
        { name: 'Salziger Salat', category: 'Salzig', healthy: true },
        { name: 'Süßer Kuchen', category: 'Süß', healthy: true },
        { name: 'Salzige Pommes', category: 'Salzig', healthy: false }
    ];
    assert.deepEqual(generator.filterByCategory('Salzig', true), [generator.recipes[0]]);
    assert.deepEqual(generator.filterByCategory('Süß', true), [generator.recipes[1]]);
    assert.deepEqual(generator.filterByCategory('Alle', true), generator.recipes.slice(0, 2));
});

test('stores and restores recipes in local storage', t => {
    installBrowserMocks(t);
    const generator = new RecipeGenerator();
    generator.recipes = sampleRecipes;
    assert.equal(generator.saveToLocalStorage(), true);
    const restored = new RecipeGenerator();
    assert.equal(restored.loadFromLocalStorage(), true);
    assert.deepEqual(restored.getAllRecipes(), sampleRecipes);
});
