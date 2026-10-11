const test = require('node:test');
const assert = require('node:assert/strict');
const RecipeGenerator = require('../../js/recipeGenerator.js');

const sampleRecipes = [
    {
        id: 1,
        name: 'Apfelkuchen',
        category: 'Nachtisch',
        images: [{ src: 'images/recipes/apfelkuchen.jpg' }],
        ingredients: [],
        instructions: []
    },
    {
        id: 2,
        name: 'Kartoffelsuppe',
        category: 'Mittagessen - Salzig',
        images: [],
        ingredients: [],
        instructions: []
    }
];

function installBrowserMocks({ protocol = 'https:', storage = {} } = {}) {
    const previous = {
        window: global.window,
        fetch: global.fetch,
        localStorage: global.localStorage
    };
    global.window = { location: { protocol } };
    global.localStorage = {
        getItem: key => Object.hasOwn(storage, key) ? storage[key] : null,
        setItem: (key, value) => { storage[key] = String(value); },
        removeItem: key => { delete storage[key]; }
    };
    return () => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete global[key];
            else global[key] = value;
        }
    };
}

test('loads recipe JSON and reports completion', async () => {
    const restore = installBrowserMocks();
    global.fetch = async url => ({
        ok: true,
        json: async () => ({ version: 1, recipes: sampleRecipes })
    });
    try {
        const generator = new RecipeGenerator();
        const progress = [];
        const result = await generator.loadFromURL('recipes.json', item => progress.push(item));
        assert.equal(result.length, 2);
        assert.equal(generator.hasImages, true);
        assert.equal(progress.at(-1).progress, 100);
    } finally {
        restore();
    }
});

test('does not fetch JSON from file URLs', async () => {
    const restore = installBrowserMocks({ protocol: 'file:' });
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; };
    try {
        await assert.rejects(new RecipeGenerator().loadFromURL('recipes.json'), /file:\/\//);
        assert.equal(fetchCalled, false);
    } finally {
        restore();
    }
});

test('rejects failed HTTP responses and malformed recipe data', async t => {
    const restore = installBrowserMocks();
    try {
        await t.test('HTTP error', async () => {
            global.fetch = async () => ({ ok: false, status: 404 });
            await assert.rejects(new RecipeGenerator().loadFromURL('recipes.json'), /404/);
        });
        await t.test('invalid schema', async () => {
            global.fetch = async () => ({ ok: true, json: async () => ({ recipes: 'invalid' }) });
            await assert.rejects(new RecipeGenerator().loadFromURL('recipes.json'), /gültige Rezeptliste/);
        });
    } finally {
        restore();
    }
});

test('searches, filters and returns recipe images', async () => {
    const restore = installBrowserMocks();
    try {
        const generator = new RecipeGenerator();
        generator.recipes = sampleRecipes;
        assert.deepEqual(generator.searchRecipes(' APFEL '), [sampleRecipes[0]]);
        assert.deepEqual(generator.filterByCategory('Nachtisch'), [sampleRecipes[0]]);
        assert.deepEqual(generator.getAllCategories(), ['Mittagessen - Salzig', 'Nachtisch']);
        assert.equal((await generator.getRecipeImageURL('Apfelkuchen')).dataUrl, 'images/recipes/apfelkuchen.jpg');
        assert.deepEqual(await generator.getAllRecipeImageURLs('Kartoffelsuppe'), []);
        assert.equal(await generator.hasRecipeImage('Apfelkuchen'), true);
    } finally {
        restore();
    }
});

test('stores and restores recipes in local storage', () => {
    const restore = installBrowserMocks();
    try {
        const generator = new RecipeGenerator();
        generator.recipes = sampleRecipes;
        assert.equal(generator.saveToLocalStorage(), true);
        const restored = new RecipeGenerator();
        assert.equal(restored.loadFromLocalStorage(), true);
        assert.deepEqual(restored.getAllRecipes(), sampleRecipes);
    } finally {
        restore();
    }
});
