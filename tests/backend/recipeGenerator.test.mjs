import assert from 'node:assert/strict';
import { test } from 'node:test';
import RecipeGenerator from '../../js/recipeGenerator.mjs';

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

function createGenerator(t, { protocol = 'https:', storage = {}, fetchImplementation = async () => {
    throw new Error('Unexpected fetch call');
} } = {}) {
    const localStorage = {
        getItem: t.mock.fn(key => Object.hasOwn(storage, key) ? storage[key] : null),
        setItem: t.mock.fn((key, value) => { storage[key] = String(value); }),
        removeItem: t.mock.fn(key => { delete storage[key]; })
    };
    return new RecipeGenerator({
        windowObject: { location: { protocol } },
        storage: localStorage,
        fetchImpl: t.mock.fn(fetchImplementation)
    });
}

test('loads recipe JSON and reports completion', async t => {
    const generator = createGenerator(t, {
        fetchImplementation: async url => ({
            ok: true,
            json: async () => ({ version: 1, recipes: sampleRecipes })
        })
    });
    const progress = [];
    const result = await generator.loadFromURL('recipes.json', item => progress.push(item));
    assert.equal(result.length, 2);
    assert.equal(generator.hasImages, true);
    assert.equal(progress.at(-1).progress, 100);
    assert.equal(generator.fetch.mock.callCount(), 1);
    assert.equal(generator.fetch.mock.calls[0].arguments[0], 'recipes.json');
});

test('calls the default fetch implementation with the global object as its receiver', async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async function (url) {
        assert.equal(this, globalThis);
        return {
            ok: true,
            json: async () => ({ version: 1, recipes: sampleRecipes })
        };
    });
    const generator = new RecipeGenerator({
        windowObject: { location: { protocol: 'https:' } },
        storage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        }
    });

    await generator.loadFromURL('recipes.json');
    assert.equal(fetch.mock.callCount(), 1);
});

test('does not fetch JSON from file URLs', async t => {
    const generator = createGenerator(t, { protocol: 'file:' });
    await assert.rejects(generator.loadFromURL('recipes.json'), /file:\/\//);
    assert.equal(generator.fetch.mock.callCount(), 0);
});

test('rejects failed HTTP responses and malformed recipe data', async t => {
    await t.test('HTTP error', async t => {
        const generator = createGenerator(t, { fetchImplementation: async () => ({ ok: false, status: 404 }) });
        await assert.rejects(generator.loadFromURL('recipes.json'), /404/);
    });
    await t.test('invalid schema', async t => {
        const generator = createGenerator(t, { fetchImplementation: async () => ({ ok: true, json: async () => ({ recipes: 'invalid' }) }) });
        await assert.rejects(generator.loadFromURL('recipes.json'), /gültige Rezeptliste/);
    });
});

test('searches, filters and returns recipe images', async t => {
    const generator = createGenerator(t);
    generator.recipes = sampleRecipes;
    assert.deepEqual(generator.searchRecipes(' APFEL '), [sampleRecipes[0]]);
    assert.deepEqual(generator.filterByCategory('Süß'), [sampleRecipes[0]]);
    assert.deepEqual(generator.filterByCategory('Salzig', true), []);
    assert.deepEqual(generator.filterByCategory('healthy'), [sampleRecipes[0]]);
    assert.deepEqual(generator.getAllCategories(), ['Salzig', 'Süß', 'healthy']);
    assert.equal(generator.getRecipeById(1), sampleRecipes[0]);
    assert.equal(generator.getRecipeById('2'), sampleRecipes[1]);
    assert.equal(generator.getRecipeById(99), null);
    assert.equal(generator.getRecipeById(null), null);
    assert.equal((await generator.getRecipeImageURL('Apfelkuchen')).dataUrl, 'images/recipes/apfelkuchen.jpg');
    assert.deepEqual(await generator.getAllRecipeImageURLs('Kartoffelsuppe'), []);
    assert.equal(await generator.hasRecipeImage('Apfelkuchen'), true);
});

test('normalizes legacy category labels from saved recipes', t => {
    const generator = createGenerator(t, { storage: { recipes: JSON.stringify([
        { name: 'Kuchen', category: 'Nachtisch - Süß', healthy: true },
        { name: 'Suppe', category: 'Mittagessen - Salzig' }
    ]) } });
    assert.equal(generator.loadFromLocalStorage(), true);
    assert.deepEqual(generator.recipes.map(recipe => recipe.category), ['Süß', 'Salzig']);
    assert.deepEqual(generator.recipes.map(recipe => recipe.healthy), [true, false]);
});

test('syncs newly classified healthy recipes into existing browser caches', async t => {
    const storage = {
        recipes: JSON.stringify([{ id: 0, name: 'Apfel Oatmeal', category: 'Süß', healthy: false }]),
        recipes_user_edits: JSON.stringify([{ id: 0, name: 'Apfel Oatmeal', category: 'Süß', healthy: false, notes: ['Eigene Notiz'] }])
    };
    const generator = createGenerator(t, {
        storage,
        fetchImplementation: async () => ({
            ok: true,
            json: async () => ({ recipes: [{ id: 0, healthy: true }] })
        })
    });
    generator.recipes = JSON.parse(storage.recipes_user_edits);

    assert.equal(await generator.syncHealthyClassifications('recipes.json'), true);
    assert.equal(generator.recipes[0].healthy, true);
    assert.deepEqual(generator.recipes[0].notes, ['Eigene Notiz']);
    assert.deepEqual(JSON.parse(storage.recipes_user_edits), generator.recipes);
    assert.equal(storage.healthy_classification_version, '1');
    assert.equal(await generator.syncHealthyClassifications('recipes.json'), false);
});

test('filters combine one exclusive base category with optional healthy', async t => {
    const generator = createGenerator(t);
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
    const storage = {};
    const generator = createGenerator(t, { storage });
    generator.recipes = sampleRecipes;
    assert.equal(generator.saveToLocalStorage(), true);
    const restored = createGenerator(t, { storage });
    assert.equal(restored.loadFromLocalStorage(), true);
    assert.deepEqual(restored.getAllRecipes(), sampleRecipes);
});
