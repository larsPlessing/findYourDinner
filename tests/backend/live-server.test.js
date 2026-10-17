const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const serverUrl = process.env.LOCAL_RECIPE_SERVER_URL || 'http://127.0.0.1:4004';
const editorSource = fs.readFileSync(path.resolve(__dirname, '../../js/recipeEditor.js'), 'utf8');

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
                if (id === 'recipeImportImageInput') return { addEventListener() {} };
                throw new Error(`Unerwartetes Element: ${id}`);
            }
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
