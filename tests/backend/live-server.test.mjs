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
    .replace(/^import .*?;\r?\n/gm, '')
    .replace(/^export \{[^}]+\};$/m, '');

test('recipe import controls are shown only on localhost', () => {
    for (const [hostname, expectedHidden] of [['localhost', false], ['[::1]', false], ['my-recipes.github.io', true]]) {
        const controls = [{ hidden: true, disabled: false }, { hidden: true, disabled: false }];
        const imageInput = { hidden: true, disabled: false, addEventListener() {} };
        const sandbox = {
            window: { location: { hostname } },
            document: {
                getElementById(id) {
                    if (id === 'editorSearch') return { value: '', addEventListener() {} };
                    if (id === 'recipeImportImageInput') return imageInput;
                    if (['editorCloseBtn', 'newRecipeBtn', 'recipeImportUrlBtn', 'recipeImportImageBtn'].includes(id)) return null;
                    throw new Error(`Unerwartetes Element: ${id}`);
                },
                querySelectorAll() { return controls; }
            }
        };
        vm.runInNewContext(editorSource, sandbox);
        assert.deepEqual(controls.map(control => control.hidden), [expectedHidden, expectedHidden]);
        assert.equal(imageInput.hidden, true);
        assert.equal(imageInput.disabled, expectedHidden);
    }
});

test('recipe import cannot be triggered outside localhost', async () => {
    const status = { textContent: '', classList: { add() {}, remove() {} }, setAttribute() {} };
    let networkRequests = 0;
    const sandbox = {
        window: { location: { hostname: 'my-recipes.github.io' } },
        document: {
            getElementById(id) {
                if (id === 'editorSearch') return { addEventListener() {} };
                if (id === 'editorSaveStatus') return status;
                if (id === 'recipeImportImageInput') return null;
                if (['editorCloseBtn', 'newRecipeBtn', 'recipeImportUrlBtn', 'recipeImportImageBtn'].includes(id)) return null;
                throw new Error(`Unerwartetes Element: ${id}`);
            },
            querySelectorAll() { return []; }
        },
        fetch() { networkRequests++; throw new Error('Import darf nicht gestartet werden'); }
    };
    vm.runInNewContext(editorSource, sandbox);

    assert.equal(await sandbox.importRecipe({ url: 'https://example.com/recipe' }), false);
    assert.equal(networkRequests, 0);
    assert.match(status.textContent, /nur über den lokalen Projektserver/i);
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
    const status = { textContent: '', setAttribute() {} };
    const sandbox = {
        window: { location: { hostname: 'my-recipes.github.io' } },
        document: {
            getElementById(id) {
                if (id === 'editorSearch') return { value: '', addEventListener() {} };
                if (id === 'editorSaveStatus') return status;
                if (id === 'recipeImportImageInput') return null;
                if (id === 'editorRecipeList') return { replaceChildren() {}, appendChild() {} };
                if (['editorCloseBtn', 'newRecipeBtn', 'recipeImportUrlBtn', 'recipeImportImageBtn'].includes(id)) return null;
                throw new Error(`Unerwartetes Element: ${id}`);
            },
            createElement() { return { addEventListener() {} }; },
            querySelectorAll() { return []; }
        },
        localStorage: {
            setItem(key, value) { storage[key] = String(value); }
        },
        generator: {
            recipes: [],
            saveUserEditsToLocalStorage() {
                storage.recipes_user_edits = JSON.stringify(this.recipes);
                return true;
            },
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
    assert.match(status.textContent, /Nur im Browser gespeichert/i);
});

test('localStorage quota failures are announced as an accessible save error', () => {
    const status = {
        textContent: '',
        attributes: {},
        setAttribute(name, value) { status.attributes[name] = value; }
    };
    const sandbox = {
        window: { location: { hostname: 'my-recipes.github.io' } },
        document: {
            getElementById(id) {
                if (id === 'editorSearch') return { value: '', addEventListener() {} };
                if (id === 'editorSaveStatus') return status;
                if (['recipeImportImageInput', 'editorCloseBtn', 'newRecipeBtn', 'recipeImportUrlBtn', 'recipeImportImageBtn'].includes(id)) return null;
                throw new Error(`Unerwartetes Element: ${id}`);
            },
            querySelectorAll() { return []; }
        },
        localStorage: { setItem() { throw new DOMException('Quota exceeded', 'QuotaExceededError'); } },
        generator: {
            recipes: [{ name: 'Rezept' }],
            saveUserEditsToLocalStorage() { return false; },
            saveToLocalStorage() { return false; }
        },
        renderEditorRecipeList() {}
    };
    vm.runInNewContext(editorSource, sandbox);

    assert.equal(sandbox.persistRecipeEdits(), false);
    assert.match(status.textContent, /Speichern fehlgeschlagen.*Speicherplatz|Speichern fehlgeschlagen.*Speicher/i);
    assert.equal(status.attributes.role, 'alert');
    assert.equal(status.attributes['aria-live'], 'assertive');
});

test('recipe import shows an accessible loading state and a clear server error', async () => {
    const status = {
        textContent: '',
        attributes: {},
        classes: new Set(),
        classList: {
            add(name) { status.classes.add(name); },
            remove(...names) { names.forEach(name => status.classes.delete(name)); }
        },
        setAttribute(name, value) { status.attributes[name] = value; }
    };
    const importButtons = [{ disabled: false }, { disabled: false }];
    const imageInput = { disabled: false, addEventListener() {} };
    let rejectFetch;
    const sandbox = {
        window: { location: { hostname: 'localhost' } },
        document: {
            getElementById(id) {
                if (id === 'editorSearch') return { addEventListener() {} };
                if (id === 'editorSaveStatus') return status;
                if (id === 'recipeImportImageInput') return imageInput;
                if (['editorCloseBtn', 'newRecipeBtn', 'recipeImportUrlBtn', 'recipeImportImageBtn'].includes(id)) return null;
                throw new Error(`Unerwartetes Element: ${id}`);
            },
            querySelectorAll() { return importButtons; }
        },
        fetch() {
            return new Promise((resolve, reject) => { rejectFetch = reject; });
        }
    };
    vm.runInNewContext(editorSource, sandbox);

    const importPromise = sandbox.importRecipe({ url: 'https://example.com/recipe' });
    assert.match(status.textContent, /Rezeptseite wird geladen und analysiert/);
    assert.equal(status.attributes['aria-busy'], 'true');
    assert.equal(status.attributes.role, 'status');
    assert.ok(status.classes.has('editor-status--loading'));
    assert.deepEqual(importButtons.map(button => button.disabled), [true, true]);
    assert.equal(imageInput.disabled, true);

    rejectFetch(new TypeError('fetch failed'));
    await importPromise;

    assert.match(status.textContent, /lokale Importserver ist nicht erreichbar/i);
    assert.equal(status.attributes['aria-busy'], 'false');
    assert.equal(status.attributes.role, 'alert');
    assert.ok(status.classes.has('editor-status--error'));
    assert.deepEqual(importButtons.map(button => button.disabled), [false, false]);
    assert.equal(imageInput.disabled, false);
});

test('Gemini API errors are translated into actionable German messages', () => {
    const sandbox = {
        document: {
            getElementById(id) {
                if (id === 'editorSearch') return { addEventListener() {} };
                if (id === 'recipeImportImageInput') return null;
                if (['editorCloseBtn', 'newRecipeBtn', 'recipeImportUrlBtn', 'recipeImportImageBtn'].includes(id)) return null;
                throw new Error(`Unerwartetes Element: ${id}`);
            },
            querySelectorAll() { return []; }
        },
        window: { location: { hostname: 'localhost' } }
    };
    vm.runInNewContext(editorSource, sandbox);

    assert.match(sandbox.formatImportError(new Error('GEMINI_API_KEY fehlt.')), /API-Schlüssel fehlt/i);
    assert.match(sandbox.formatImportError(new Error('Gemini API 429: {"error":{"message":"quota"}}')), /Kontingent ist vorübergehend ausgeschöpft/i);
    assert.match(sandbox.formatImportError(new Error('Gemini API 400: {"error":{"message":"Ungültige Anfrage"}}')), /Ungültige Anfrage/);
});

test('failed local import persistence rolls back the pushed recipe', async () => {
    const status = {
        textContent: '',
        classList: { add() {}, remove() {} },
        setAttribute() {}
    };
    const sandbox = {
        window: { location: { hostname: 'localhost' } },
        document: {
            getElementById(id) {
                if (id === 'editorSearch') return { value: '', addEventListener() {} };
                if (id === 'editorSaveStatus') return status;
                if (id === 'recipeImportImageInput') return null;
                if (['editorCloseBtn', 'newRecipeBtn', 'recipeImportUrlBtn', 'recipeImportImageBtn'].includes(id)) return null;
                throw new Error(`Unerwartetes Element: ${id}`);
            },
            querySelectorAll() { return []; }
        },
        generator: {
            recipes: [],
            cryptoKey: { type: 'secret' },
            encryptionSalt: new Uint8Array(16),
            saveUserEditsToLocalStorage() { return false; },
            saveToLocalStorage() { return false; }
        },
        fetch: async url => {
            requests.push(url);
            return {
                ok: true,
                async json() {
                    return url === '/api/import-recipe'
                        ? { recipe: { name: 'Instagram-Rezept', video: { src: 'data:video/mp4;base64,AAAA' } } }
                        : { revision: 'saved', savedMedia: 1, deletedMedia: 0 };
                }
            };
        }
    };
    const requests = [];
    sandbox.prepareEncryptedRecipeSave = async recipes => ({
        recipes,
        plainRecipes: recipes,
        envelope: {},
        mediaFiles: [],
        referencedFiles: [],
        plainMediaFiles: [],
        plainReferencedFiles: []
    });
    vm.runInNewContext(editorSource, sandbox);

    await sandbox.importRecipe({ url: 'https://www.instagram.com/reel/example/' });

    assert.deepEqual(requests, ['/api/import-recipe', '/api/save-recipes']);
    assert.deepEqual(sandbox.generator.recipes, []);
    assert.match(status.textContent, /Speicher/i);
});

test('deleting the last recipe saves the empty recipe list to the local server', async () => {
    const storage = {};
    let savedPayload;
    const status = { textContent: '', setAttribute() {} };
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
                if (['editorCloseBtn', 'newRecipeBtn', 'recipeImportUrlBtn', 'recipeImportImageBtn'].includes(id)) return null;
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
            cryptoKey: { type: 'secret' },
            encryptionSalt: new Uint8Array(16),
            saveUserEditsToLocalStorage() {
                storage.recipes_user_edits = JSON.stringify(this.recipes);
                return true;
            },
            saveToLocalStorage() { return true; }
        },
        fetch: async (url, options) => {
            assert.equal(url, '/api/save-recipes');
            savedPayload = JSON.parse(options.body);
            return {
                ok: true,
                async json() { return { revision: 'saved-revision', savedMedia: 0, deletedMedia: 0 }; }
            };
        }
    };
    sandbox.prepareEncryptedRecipeSave = async recipes => ({
        recipes,
        plainRecipes: recipes,
        envelope: { revision: 'saved-revision' },
        mediaFiles: [],
        referencedFiles: [],
        plainMediaFiles: [],
        plainReferencedFiles: []
    });
    vm.runInNewContext(editorSource, sandbox);
    vm.runInNewContext('editingRecipeIndex = 0;', sandbox);

    await sandbox.deleteCurrentRecipe();

    assert.deepEqual(savedPayload.plainRecipes, []);
    assert.deepEqual(JSON.parse(storage.recipes_user_edits), []);
    assert.deepEqual(sandbox.generator.recipes, []);
    assert.match(status.textContent, /Im Projekt gespeichert: recipes\.enc/);
    assert.match(recipeForm.innerHTML, /Noch keine Rezepte/);
});
