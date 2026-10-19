import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptAssetBytes, deriveKey } from '../../js/recipeCrypto.mjs';
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

function createGenerator(t, { protocol = 'https:', storage = {}, confirmImplementation = () => false, fetchImplementation = async () => {
    throw new Error('Unexpected fetch call');
}, readStoredKeyImplementation = async () => null } = {}) {
    const localStorage = {
        getItem: t.mock.fn(key => Object.hasOwn(storage, key) ? storage[key] : null),
        setItem: t.mock.fn((key, value) => { storage[key] = String(value); }),
        removeItem: t.mock.fn(key => { delete storage[key]; })
    };
    return new RecipeGenerator({
        windowObject: { location: { protocol }, confirm: t.mock.fn(confirmImplementation) },
        storage: localStorage,
        fetchImpl: t.mock.fn(fetchImplementation),
        unlockEnvelopeImpl: async envelope => ({
            key: { type: 'secret' },
            recipes: envelope.recipes
        }),
        getSaltImpl: () => new Uint8Array(16),
        readStoredKeyImpl: readStoredKeyImplementation
    });
}

test('restores the stored key and salt before loading encrypted media', async t => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey('ein-langes-passwort-mit-mehreren-worten', salt);
    const encryptedBytes = await encryptAssetBytes(new TextEncoder().encode('cached image'), key);
    const generator = createGenerator(t, {
        readStoredKeyImplementation: async () => ({ key, salt }),
        fetchImplementation: async () => ({ ok: true, arrayBuffer: async () => encryptedBytes })
    });
    generator.window.location = { protocol: 'https:', pathname: '/', href: 'https://example.test/' };
    const createObjectURL = t.mock.method(URL, 'createObjectURL', () => 'blob:cached-image');

    assert.equal(await generator.getMediaURL('images/recipes/cached.jpg.enc', 'image/jpeg'), 'blob:cached-image');
    assert.equal(generator.cryptoKey, key);
    assert.deepEqual(generator.encryptionSalt, salt);
    assert.equal(createObjectURL.mock.callCount(), 1);
});

test('loads recipe JSON and reports completion', async t => {
    const generator = createGenerator(t, {
        fetchImplementation: async url => ({
            ok: true,
            json: async () => ({ version: 1, revision: 'rev-1', recipes: sampleRecipes })
        })
    });
    const progress = [];
    const result = await generator.loadFromURL('recipes.enc', item => progress.push(item));
    assert.equal(result.length, 2);
    assert.equal(generator.revision, 'rev-1');
    assert.equal(progress.at(-1).progress, 100);
    assert.equal(generator.fetch.mock.callCount(), 1);
    assert.equal(generator.fetch.mock.calls[0].arguments[0], 'recipes.enc');
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
        },
        unlockEnvelopeImpl: async envelope => ({ key: { type: 'secret' }, recipes: envelope.recipes }),
        getSaltImpl: () => new Uint8Array(16)
    });

    await generator.loadFromURL('recipes.enc');
    assert.equal(fetch.mock.callCount(), 1);
});

test('does not fetch JSON from file URLs', async t => {
    const generator = createGenerator(t, { protocol: 'file:' });
    await assert.rejects(generator.loadFromURL('recipes.enc'), /file:\/\//);
    assert.equal(generator.fetch.mock.callCount(), 0);
});

test('rejects failed HTTP responses and malformed recipe data', async t => {
    await t.test('HTTP error', async t => {
        const generator = createGenerator(t, { fetchImplementation: async () => ({ ok: false, status: 404 }) });
        await assert.rejects(generator.loadFromURL('recipes.enc'), /404/);
    });
    await t.test('invalid schema', async t => {
        const generator = createGenerator(t, { fetchImplementation: async () => ({ ok: true, json: async () => ({ recipes: 'invalid' }) }) });
        await assert.rejects(generator.loadFromURL('recipes.enc'), /gültige Rezeptliste/);
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

test('resolves images by recipe object or id when recipe names are duplicated', async t => {
    const generator = createGenerator(t);
    const first = { id: 10, name: 'Doppelname', images: [{ src: 'first.jpg' }] };
    const second = { id: 20, name: 'Doppelname', images: [{ src: 'second.jpg' }] };
    generator.recipes = [first, second];

    assert.equal((await generator.getRecipeImageURL(second)).dataUrl, 'second.jpg');
    assert.equal((await generator.getRecipeImageURL(20)).dataUrl, 'second.jpg');
    assert.equal((await generator.getAllRecipeImageURLs(second))[0].dataUrl, 'second.jpg');
});

test('fetches recipe data without cache when checking the published revision', async t => {
    const generator = createGenerator(t, {
        fetchImplementation: async () => ({
            ok: true,
            json: async () => ({ revision: 'fresh', recipes: sampleRecipes })
        })
    });

    await t.test('normalizes a missing remote revision to null and does not prompt repeatedly', async t => {
        const generator = createGenerator(t, {
            fetchImplementation: async () => ({
                ok: true,
                json: async () => ({ recipes: sampleRecipes })
            })
        });
        generator.recipes = sampleRecipes;
        generator.revision = null;

        const result = await generator.syncWithRemote('recipes.enc', { hasLocalEdits: true, hasCachedRecipes: true });

        assert.equal(result.remoteRevision, null);
        assert.equal(generator.window.confirm.mock.callCount(), 0);
        assert.equal(generator.revision, null);
    });

    await t.test('declining a remote revision records it so later page syncs do not ask again', async t => {
        const storage = {};
        const generator = createGenerator(t, {
            storage,
            fetchImplementation: async () => ({
                ok: true,
                json: async () => ({ revision: 'rev-new', recipes: sampleRecipes })
            })
        });
        generator.recipes = [{ id: 99, name: 'Lokale Änderung' }];
        generator.revision = 'rev-old';

        await generator.syncWithRemote('recipes.enc', { hasLocalEdits: true, hasCachedRecipes: true });
        await generator.syncWithRemote('recipes.enc', { hasLocalEdits: true, hasCachedRecipes: true });

        assert.equal(generator.window.confirm.mock.callCount(), 1);
        assert.equal(storage.recipes_dismissed_revision, 'rev-new');
        assert.deepEqual(generator.recipes, [{ id: 99, name: 'Lokale Änderung' }]);
    });

    const data = await generator.fetchRecipeData('recipes.enc');
    assert.equal(data.revision, 'fresh');
    assert.deepEqual(generator.fetch.mock.calls[0].arguments, ['recipes.enc', { cache: 'no-cache' }]);
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
    generator.revision = 'rev-1';
    assert.equal(generator.saveToLocalStorage(), true);
    const restored = createGenerator(t, { storage });
    assert.equal(restored.loadFromLocalStorage(), true);
    assert.deepEqual(restored.getAllRecipes(), sampleRecipes);
    assert.equal(restored.revision, 'rev-1');
});

test('saves the editable recipe list only once instead of duplicating the full cache', t => {
    const storage = {
        recipes_user_edits: JSON.stringify(sampleRecipes),
        recipes: JSON.stringify(sampleRecipes)
    };
    const generator = createGenerator(t, { storage });
    generator.recipes = sampleRecipes;

    assert.equal(generator.saveToLocalStorage(), true);
    assert.equal(Object.hasOwn(storage, 'recipes'), false);
    assert.deepEqual(JSON.parse(storage.recipes_user_edits), sampleRecipes);
});

test('writes the latest published cache before removing local user edits', t => {
    const storage = { recipes_user_edits: JSON.stringify([{ name: 'Meine Änderungen' }]) };
    const generator = createGenerator(t, { storage });
    generator.recipes = sampleRecipes;
    generator.revision = 'rev-2';

    assert.equal(generator.saveRemoteRecipesToLocalStorage(), true);
    assert.equal(Object.hasOwn(storage, 'recipes_user_edits'), false);
    assert.deepEqual(JSON.parse(storage.recipes), sampleRecipes);
    assert.equal(storage.recipes_revision, 'rev-2');
});

test('keeps local user edits when saving a replacement cache fails', t => {
    const edited = JSON.stringify([{ name: 'Meine Änderungen' }]);
    const storage = {
        recipes_user_edits: edited,
        getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; },
        setItem(key) {
            if (key === 'recipes') throw new DOMException('Quota exceeded', 'QuotaExceededError');
        },
        removeItem(key) { delete this[key]; }
    };
    const generator = new RecipeGenerator({
        windowObject: { location: { protocol: 'https:' } },
        storage
    });
    generator.recipes = sampleRecipes;
    const alert = t.mock.fn();
    generator.window.alert = alert;

    assert.equal(generator.saveRemoteRecipesToLocalStorage(), false);
    assert.equal(storage.recipes_user_edits, edited);
    assert.equal(alert.mock.callCount(), 1);
});

test('removes the legacy recipe cache before writing the full editable list', () => {
    const storage = {
        recipes: JSON.stringify(sampleRecipes),
        getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; },
        setItem(key, value) {
            if (key === 'recipes_user_edits') assert.equal(Object.hasOwn(this, 'recipes'), false);
            this[key] = String(value);
        },
        removeItem(key) { delete this[key]; }
    };
    const generator = new RecipeGenerator({
        windowObject: { location: { protocol: 'https:' } },
        storage
    });
    generator.recipes = sampleRecipes;

    assert.equal(generator.saveUserEditsToLocalStorage(), true);
    assert.equal(Object.hasOwn(storage, 'recipes'), false);
    assert.deepEqual(JSON.parse(storage.recipes_user_edits), sampleRecipes);
});

test('reports a localStorage quota failure instead of claiming the recipe cache was saved', t => {
    const storage = {};
    const generator = createGenerator(t, {
        storage,
    });
    generator.recipes = sampleRecipes;
    generator.storage.setItem.mock.mockImplementation((key, value) => {
        if (key === 'recipes') throw new DOMException('Quota exceeded', 'QuotaExceededError');
        storage[key] = String(value);
    });

    assert.equal(generator.saveToLocalStorage(), false);
});

test('shows a visible warning when an automatic recipe cache write exceeds localStorage quota', t => {
    const storage = {
        setItem() { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
        getItem() { return null; },
        removeItem() {}
    };
    const alert = t.mock.fn();
    const generator = new RecipeGenerator({
        windowObject: { location: { protocol: 'https:' }, alert },
        storage
    });
    generator.recipes = sampleRecipes;

    assert.equal(generator.saveToLocalStorage(), false);
    assert.match(alert.mock.calls[0].arguments[0], /Speicher ist möglicherweise voll/i);
});
