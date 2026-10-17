import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const serverUrl = process.env.LOCAL_RECIPE_SERVER_URL || 'http://127.0.0.1:4004';
const editorSource = fs.readFileSync(path.resolve(__dirname, '../../js/recipeEditor.mjs'), 'utf8')
    .replace(/^export \{[^}]+\};$/m, '');

test('recipe import controls are shown only on localhost', () => {
    for (const [hostname, expectedHidden] of [['localhost', false], ['my-recipes.github.io', true]]) {
        const controls = [{ hidden: true }, { hidden: true }];
        const sandbox = {
            window: { location: { hostname } },
            document: {
                getElementById(id) {
                    if (id === 'editorSearch') return { addEventListener() {} };
                    if (id === 'recipeImportImageInput') return null;
                    throw new Error(`Unerwartetes Element: ${id}`);
                },
                querySelectorAll() { return controls; }
            }
        };
        vm.runInNewContext(editorSource, sandbox);
        assert.deepEqual(controls.map(control => control.hidden), [expectedHidden, expectedHidden]);
    }
});

test('running localhost server exposes the recipe save API', async t => {
    let response;
    try {
        response = await fetch(`${serverUrl}/api/save-recipes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: new URL(serverUrl).origin
            },
            // Ungültige Nutzlast darf keine Dateien verändern. Die API muss sie
            // mit 400 ablehnen; ein statischer Server antwortet dagegen mit 405.
            body: JSON.stringify({})
        });
    } catch (error) {
        t.skip(`Kein lokaler Rezeptserver unter ${serverUrl}: ${error.message}`);
        return;
    }

    assert.equal(response.status, 400, `Save API antwortete mit ${response.status}: ${await response.text()}`);
});

test('non-localhost save stores the edited recipe in browser localStorage', async () => {
    const storage = {};
    let networkRequests = 0;
    let legacyStorageSaves = 0;
    const status = { textContent: '' };
    const sandbox = {
        window: { location: { hostname: 'my-recipes.github.io' } },
        document: {
            getElementById(id) {
                if (id === 'editorSearch') return { addEventListener() {} };
                if (id === 'editorSaveStatus') return status;
                if (id === 'recipeImportImageInput') return null;
                throw new Error(`Unerwartetes Element: ${id}`);
            },
            querySelectorAll() { return []; }
        },
        localStorage: {
            setItem(key, value) { storage[key] = String(value); }
        },
        generator: {
            recipes: [],
            saveToLocalStorage() { legacyStorageSaves++; return true; }
        },
        searchInput: { value: '' },
        initializeCategoryFilter() {},
        applyFilters() {},
        renderEditorRecipeList() {},
        fetch() { networkRequests++; throw new Error('Kein Serveraufruf außerhalb von localhost erwartet'); }
    };
    vm.runInNewContext(editorSource, sandbox);

    const editedRecipe = { id: 17, name: 'Linsensuppe', category: 'Mittagessen', images: [] };
    await sandbox.commitRecipeChanges(editedRecipe, 0);

    assert.deepEqual(JSON.parse(storage.recipes_user_edits), [editedRecipe]);
    assert.equal(legacyStorageSaves, 1, 'RecipeGenerator localStorage cache should also be updated');
    assert.equal(networkRequests, 0, 'non-localhost saves must not call the filesystem API');
    assert.match(status.textContent, /auf diesem Gerät gespeichert/i);
});

test('deleting the last recipe saves the empty recipe list to the local server', async () => {
    const storage = {};
    let savedPayload;
    const status = { textContent: '' };
    const recipeList = { replaceChildren() {} };
    const recipeForm = { innerHTML: '' };
    const sandbox = {
        window: { location: { hostname: 'localhost' } },
        document: {
            getElementById(id) {
                if (id === 'editorSearch') return { value: '', addEventListener() {} };
                if (id === 'editorSaveStatus') return status;
                if (id === 'editorRecipeList') return recipeList;
                if (id === 'recipeEditForm') return recipeForm;
                if (id === 'recipeImportImageInput') return null;
                throw new Error(`Unerwartetes Element: ${id}`);
            },
            querySelectorAll() { return []; }
        },
        localStorage: {
            setItem(key, value) { storage[key] = String(value); }
        },
        confirm: () => true,
        generator: {
            recipes: [{ id: 4, name: 'Zu löschendes Rezept', images: [] }],
            saveToLocalStorage() { return true; }
        },
        fetch: async (url, options) => {
            assert.equal(url, '/api/save-recipes');
            savedPayload = JSON.parse(options.body);
            return {
                ok: true,
                async json() { return { recipes: savedPayload.recipes, savedImages: 0, deletedImages: 0 }; }
            };
        }
    };
    vm.runInNewContext(editorSource, sandbox);
    vm.runInNewContext('editingRecipeIndex = 0;', sandbox);

    await sandbox.deleteCurrentRecipe();

    assert.deepEqual(savedPayload.recipes, []);
    assert.deepEqual(JSON.parse(storage.recipes_user_edits), []);
    assert.deepEqual(sandbox.generator.recipes, []);
    assert.match(status.textContent, /Gespeichert: recipes\.json/);
    assert.match(recipeForm.innerHTML, /Noch keine Rezepte/);
});
