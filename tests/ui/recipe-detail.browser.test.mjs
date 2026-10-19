import { createRequire } from 'node:module';
import { deriveKey, encryptAssetBytes, encryptRecipeEnvelope } from '../../js/recipeCrypto.mjs';

const require = createRequire(import.meta.url);
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const port = 43117;
const baseUrl = `http://127.0.0.1:${port}`;
const testPassword = 'test-password-with-several-words';
const testSalt = new Uint8Array(16).fill(7);
const testKeyPromise = deriveKey(testPassword, testSalt);

async function makeEnvelope(recipes, revision) {
    return encryptRecipeEnvelope(recipes, await testKeyPromise, testSalt, revision);
}

async function seedRecipeKey(page, baseUrl) {
    await page.route('**/recipe-test-bootstrap', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head></head><body></body></html>'
    }));
    await page.goto(`${baseUrl}/recipe-test-bootstrap`);
    await page.evaluate(async ({ password, saltBase64 }) => {
        const salt = Uint8Array.from(atob(saltBase64), character => character.charCodeAt(0));
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
        await new Promise((resolve, reject) => {
            const request = indexedDB.open('find-your-dinner-vault', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('keys');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const transaction = request.result.transaction('keys', 'readwrite');
                transaction.objectStore('keys').put(key, 'recipe-key');
                transaction.oncomplete = resolve;
                transaction.onerror = () => reject(transaction.error);
            };
        });
    }, { password: testPassword, saltBase64: Buffer.from(testSalt).toString('base64') });
}

async function waitForServer(process, url = baseUrl) {
    for (let attempt = 0; attempt < 40; attempt++) {
        if (process.exitCode !== null) throw new Error('Lokaler Testserver konnte nicht gestartet werden.');
        try {
            const response = await fetch(`${url}/`);
            if (response.ok) return;
        } catch { /* Server startet noch. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Lokaler Testserver hat nicht rechtzeitig geantwortet.');
}

test('ingredient dock appears after the ingredient list, expands and keeps portions synchronized on mobile', async t => {
    const server = spawn(process.execPath, ['server.mjs'], {
        cwd: new URL('../..', import.meta.url),
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore'
    });

    await t.test('wake-lock request failure alerts once and does not retry on visibility changes', async t => {
        const testPort = port + 1;
        const testUrl = `http://127.0.0.1:${testPort}`;
        const server = spawn(process.execPath, ['server.mjs'], {
            cwd: new URL('../..', import.meta.url),
            env: { ...process.env, PORT: String(testPort) },
            stdio: 'ignore'
        });
        t.after(() => server.kill());
        await waitForServer(server, testUrl);

        const browser = await chromium.launch({ headless: true });
        t.after(() => browser.close());
        const page = await browser.newPage();
        const envelope = await makeEnvelope([{
            id: 1, name: 'Wake-Lock-Test', ingredients: [], instructions: [], images: []
        }], 'wake-revision');
        await page.route('**/recipes.enc', route => route.fulfill({ json: envelope }));
        await seedRecipeKey(page, testUrl);
        const alerts = [];
        page.on('dialog', dialog => {
            alerts.push(dialog.message());
            dialog.dismiss();
        });
        await page.addInitScript(() => {
            window.wakeLockRequests = 0;
            Object.defineProperty(navigator, 'wakeLock', {
                configurable: true,
                value: {
                    async request() {
                        window.wakeLockRequests++;
                        throw new Error('Power saving mode');
                    }
                }
            });
            localStorage.setItem('currentRecipe', '1');
            localStorage.setItem('recipes_revision', 'wake-revision');
            localStorage.setItem('recipes_user_edits', JSON.stringify([
                { id: 1, name: 'Wake-Lock-Test', category: 'Salzig', ingredients: [], instructions: [], images: [] }
            ]));
        });

        await page.goto(`${testUrl}/pages/recipe-detail.html?id=1`);
        await page.locator('#wakeLockBtn').click();
        await page.waitForFunction(() => window.wakeLockRequests === 1);
        for (let attempt = 0; attempt < 20 && alerts.length === 0; attempt++) await page.waitForTimeout(50);
        assert.equal(alerts.length, 1, 'the failed request should be handled before changing visibility');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForTimeout(100);

        assert.equal(await page.evaluate(() => window.wakeLockRequests), 1);
        assert.equal(alerts.length, 1);
        assert.match(alerts[0], /Display-Sperre konnte nicht aktiviert werden/);
        assert.doesNotMatch(alerts[0], /nicht unterstützt/);
    });

    await t.test('slow image load from the previous recipe cannot replace the current recipe image', async t => {
        const testPort = port + 2;
        const testUrl = `http://127.0.0.1:${testPort}`;
        const server = spawn(process.execPath, ['server.mjs'], {
            cwd: new URL('../..', import.meta.url),
            env: { ...process.env, PORT: String(testPort) },
            stdio: 'ignore'
        });
        t.after(() => server.kill());
        await waitForServer(server, testUrl);

        const browser = await chromium.launch({ headless: true });
        t.after(() => browser.close());
        const page = await browser.newPage();
        const recipes = [
            { id: 1, name: 'Altes Rezept', category: 'Salzig', ingredients: [], instructions: [], images: [{ src: 'images/recipes/old.jpg' }] },
            { id: 2, name: 'Neues Rezept', category: 'Salzig', ingredients: [], instructions: [], images: [{ src: 'images/recipes/new.jpg' }] }
        ];
        const envelope = await makeEnvelope(recipes, 'image-revision');
        await page.route('**/recipes.enc', route => route.fulfill({ json: envelope }));
        await seedRecipeKey(page, testUrl);
        await page.route('**/images/recipes/old.jpg', async route => {
            await new Promise(resolve => setTimeout(resolve, 400));
            await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=', 'base64') });
        });
        await page.route('**/images/recipes/new.jpg', route => route.fulfill({
            contentType: 'image/png',
            body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=', 'base64')
        }));
        await page.addInitScript(() => {
            localStorage.setItem('currentRecipe', '1');
            localStorage.setItem('recipes_user_edits', JSON.stringify([
                { id: 1, name: 'Altes Rezept', category: 'Salzig', ingredients: [], instructions: [], images: [{ src: 'images/recipes/old.jpg' }] },
                { id: 2, name: 'Neues Rezept', category: 'Salzig', ingredients: [], instructions: [], images: [{ src: 'images/recipes/new.jpg' }] }
            ]));
        });

        await page.goto(`${testUrl}/pages/recipe-detail.html?id=1`);
        await page.waitForFunction(() => document.getElementById('recipeTitle').textContent === 'Altes Rezept');
        await page.locator('#selectRandomRecipeBtn').click();
        await page.waitForFunction(() => document.getElementById('recipeTitle').textContent === 'Neues Rezept');
        await page.waitForFunction(() => document.querySelector('#recipeImageMain img')?.src.endsWith('/new.jpg'));
        await page.waitForTimeout(500);

        assert.match(await page.locator('#recipeImageMain img').getAttribute('src'), /new\.jpg$/);
    });

    await t.test('reloads encrypted media with the current archive revision', async t => {
        const testPort = port + 4;
        const testUrl = `http://127.0.0.1:${testPort}`;
        const server = spawn(process.execPath, ['server.mjs'], {
            cwd: new URL('../..', import.meta.url),
            env: { ...process.env, PORT: String(testPort) },
            stdio: 'ignore'
        });
        t.after(() => server.kill());
        await waitForServer(server, testUrl);

        const browser = await chromium.launch({ headless: true });
        t.after(() => browser.close());
        const page = await browser.newPage();
        const revision = 'fresh-media-revision';
        const recipe = {
            id: 1,
            name: 'Cache-Test-Rezept',
            category: 'Salzig',
            ingredients: [],
            instructions: [],
            images: [{ src: 'images/recipes/cache-test.png.enc', mimeType: 'image/png' }]
        };
        const envelope = await makeEnvelope([recipe], revision);
        const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=', 'base64');
        const encryptedImage = await encryptAssetBytes(imageBytes, await testKeyPromise);
        const mediaRequests = [];

        await page.route('**/recipes.enc', route => route.fulfill({ json: envelope }));
        await page.route('**/images/recipes/cache-test.png.enc*', async route => {
            mediaRequests.push(route.request().url());
            await route.fulfill({ contentType: 'application/octet-stream', body: Buffer.from(encryptedImage) });
        });
        await seedRecipeKey(page, testUrl);
        await page.addInitScript(({ cachedRecipe, cachedRevision }) => {
            localStorage.setItem('currentRecipe', '1');
            localStorage.setItem('recipes_revision', cachedRevision);
            localStorage.setItem('recipes_user_edits', JSON.stringify([cachedRecipe]));
        }, { cachedRecipe: recipe, cachedRevision: revision });

        await page.goto(`${testUrl}/pages/recipe-detail.html?id=1`);
        await page.waitForFunction(() => document.querySelector('#recipeImageMain img')?.complete);

        assert.equal(mediaRequests.length, 1);
        assert.equal(new URL(mediaRequests[0]).searchParams.get('v'), revision);
    });

    await t.test('browser back restores the previous recipe after random navigation', async t => {
        const testPort = port + 3;
        const testUrl = `http://127.0.0.1:${testPort}`;
        const server = spawn(process.execPath, ['server.mjs'], {
            cwd: new URL('../..', import.meta.url),
            env: { ...process.env, PORT: String(testPort) },
            stdio: 'ignore'
        });
        t.after(() => server.kill());
        await waitForServer(server, testUrl);

        const browser = await chromium.launch({ headless: true });
        t.after(() => browser.close());
        const page = await browser.newPage();
        const recipes = [
            { id: 1, name: 'Erstes Rezept', category: 'Salzig', ingredients: [], instructions: [], images: [] },
            { id: 2, name: 'Zweites Rezept', category: 'Salzig', ingredients: [], instructions: [], images: [] }
        ];
        const envelope = await makeEnvelope(recipes, 'popstate-revision');
        await page.route('**/recipes.enc', route => route.fulfill({ json: envelope }));
        await seedRecipeKey(page, testUrl);
        await page.addInitScript(() => {
            localStorage.setItem('currentRecipe', '1');
            localStorage.setItem('recipes_user_edits', JSON.stringify([
                { id: 1, name: 'Erstes Rezept', category: 'Salzig', ingredients: [], instructions: [], images: [] },
                { id: 2, name: 'Zweites Rezept', category: 'Salzig', ingredients: [], instructions: [], images: [] }
            ]));
        });

        await page.goto(`${testUrl}/pages/recipe-detail.html?id=1`);
        await page.waitForFunction(() => document.getElementById('recipeTitle').textContent === 'Erstes Rezept');
        await page.locator('#selectRandomRecipeBtn').click();
        await page.waitForFunction(() => document.getElementById('recipeTitle').textContent === 'Zweites Rezept');
        assert.equal(new URL(page.url()).searchParams.get('id'), '2');

        await page.goBack();
        await page.waitForFunction(() => document.getElementById('recipeTitle').textContent === 'Erstes Rezept');
        assert.equal(new URL(page.url()).searchParams.get('id'), '1');
    });
    t.after(() => server.kill());
    await waitForServer(server);

    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    const serverEnvelope = await makeEnvelope([{ id: 1, name: 'Neue Serverversion' }], 'published-revision');
    await page.route('**/recipes.enc', route => route.fulfill({ json: serverEnvelope }));
    await seedRecipeKey(page, baseUrl);
    let updateNotice = '';
    page.on('dialog', dialog => {
        if (dialog.message().includes('wirklich löschen')) {
            dialog.accept();
            return;
        }
        updateNotice = dialog.message();
        dialog.dismiss();
    });
    await page.route('**/api/save-recipes', route => route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Testweise blockiertes Projektspeichern' })
    }));
    await page.addInitScript(() => {
        window.wakeLockRequestCount = 0;
        Object.defineProperty(navigator, 'wakeLock', {
            configurable: true,
            value: {
                async request() {
                    window.wakeLockRequestCount++;
                    return {
                        addEventListener(type, listener) {
                            if (type === 'release') window.releaseWakeLock = listener;
                        },
                        async release() {}
                    };
                }
            }
        });
        localStorage.setItem('currentRecipe', '1');
        localStorage.setItem('recipes_user_edits', JSON.stringify([{
            id: 1,
            name: 'Dock-Test',
            category: 'Salzig',
            servings: 2,
            ingredients: [
                { amount: 100, unit: 'g', product: 'Mehl', note: '' },
                { amount: 2, unit: 'Stück', product: 'Eier', note: '' },
                { amount: 50, unit: 'ml', product: 'Milch', note: '' }
            ],
            instructions: Array.from({ length: 24 }, (_, index) => ({ step: 24 - index, text: `Schritt ${24 - index}` })),
            notes: [{ source: 'unchanged object note' }],
            images: [
                { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=' },
                { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=' }
            ]
        }]));
    });
    await page.goto(`${baseUrl}/pages/recipe-detail.html?id=1`);
    await page.waitForFunction(() => document.getElementById('recipeTitle').textContent === 'Dock-Test');
    assert.match(updateNotice, /Neue Rezeptversion verfügbar/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('recipes_user_edits'))[0].name), 'Dock-Test');
    assert.equal(await page.locator('#instructionsList li').first().textContent(), 'Schritt 1');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('recipes_user_edits'))[0].instructions[0].step), 24);
    assert.doesNotMatch(await page.locator('#notesList').textContent(), /\[object Object\]/);
    await page.locator('#ingredientDock').waitFor({ state: 'attached' });
    await page.locator('#ingredientsSection').scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await page.evaluate(() => {
        const instructions = document.getElementById('instructionsList');
        window.scrollTo(0, instructions.offsetTop + 120);
    });
    await page.waitForSelector('#ingredientDock:not([hidden])');

    const collapsedSpace = await page.evaluate(() => document.documentElement.style.getPropertyValue('--ingredient-dock-space'));
    assert.match(collapsedSpace, /^\d+px$/);

    await page.locator('#ingredientDockToggle').click();
    await page.waitForSelector('#ingredientDock.is-expanded');
    assert.equal(await page.locator('#ingredientDockToggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#ingredientDockIngredients .ingredient-item').count(), 3);

    const expandedSpace = await page.evaluate(() => Number.parseInt(document.documentElement.style.getPropertyValue('--ingredient-dock-space'), 10));
    assert.ok(expandedSpace > Number.parseInt(collapsedSpace, 10));

    await page.locator('.portion-btn').last().click();
    await page.waitForFunction(() => document.querySelector('#ingredientsList .ingredient-amount')?.textContent === '150');
    for (const selector of ['#ingredientsList', '#ingredientDockIngredients']) {
        assert.equal(await page.locator(`${selector} .ingredient-amount`).first().textContent(), '150');
    }

    await page.locator('#ingredientsSection').scrollIntoViewIfNeeded();
    await page.waitForSelector('#ingredientDock[hidden]', { state: 'attached' });

    await page.locator('#wakeLockBtn').click();
    await page.waitForFunction(() => window.wakeLockRequestCount === 1);
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        window.releaseWakeLock();
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.wakeLockRequestCount === 2);

    await page.locator('#editCurrentRecipeBtn').click();
    await page.locator('#recipeEditForm [name="name"]').fill('Ungespeicherte Änderung');
    await page.locator('.editor-ingredient-row [name="product"]').first().fill('Ungespeicherte Zutat');
    await page.locator('.editor-instruction-row textarea').first().fill('Ungespeicherter Schritt');
    await page.locator('#recipeEditForm [name="notes"]').fill('Ungespeicherte Notiz');
    await page.getByRole('button', { name: 'Als Titelbild' }).click();
    assert.equal(await page.locator('#recipeEditForm [name="name"]').inputValue(), 'Ungespeicherte Änderung');
    assert.equal(await page.locator('.editor-ingredient-row [name="product"]').first().inputValue(), 'Ungespeicherte Zutat');
    assert.equal(await page.locator('.editor-instruction-row textarea').first().inputValue(), 'Ungespeicherter Schritt');
    assert.equal(await page.locator('#recipeEditForm [name="notes"]').inputValue(), 'Ungespeicherte Notiz');

    await page.locator('.editor-image-remove-btn').first().click();
    assert.equal(await page.locator('#recipeEditForm [name="name"]').inputValue(), 'Ungespeicherte Änderung');
    assert.equal(await page.locator('.editor-ingredient-row [name="product"]').first().inputValue(), 'Ungespeicherte Zutat');
    assert.equal(await page.locator('.editor-instruction-row textarea').first().inputValue(), 'Ungespeicherter Schritt');
    assert.equal(await page.locator('#recipeEditForm [name="notes"]').inputValue(), 'Ungespeicherte Notiz');

    await page.locator('.editor-image-section input[type="file"]').setInputFiles({
        name: 'new-image.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=', 'base64')
    });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('recipes_user_edits'))[0].images.length === 2);
    assert.equal(await page.locator('#recipeEditForm [name="name"]').inputValue(), 'Ungespeicherte Änderung');
    assert.equal(await page.locator('.editor-ingredient-row [name="product"]').first().inputValue(), 'Ungespeicherte Zutat');
    assert.equal(await page.locator('.editor-instruction-row textarea').first().inputValue(), 'Ungespeicherter Schritt');
    assert.equal(await page.locator('#recipeEditForm [name="notes"]').inputValue(), 'Ungespeicherte Notiz');

    await page.locator('#recipeEditForm [name="name"]').fill('Dock-Test aktualisiert');
    await page.locator('#recipeEditForm [name="servings"]').fill('2-4');
    await page.locator('#recipeEditForm [name="notes"]').fill('Neue Notiz');
    await page.locator('#recipeEditForm button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('recipeTitle').textContent === 'Dock-Test aktualisiert');
    assert.equal(await page.locator('#recipeImageMain img').count(), 1);
    assert.equal(await page.locator('#ingredientsList .ingredient-item').count(), 3);
    assert.equal(await page.locator('#instructionsList li').count(), 24);
    assert.equal((await page.locator('#recipeMeta').textContent()).includes('2-4 Portionen'), true);
    assert.equal(await page.evaluate(() => new URLSearchParams(location.search).get('id')), '1');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('recipes_user_edits'))[0].notes), [
        { source: 'unchanged object note' },
        'Neue Notiz'
    ]);

    await page.locator('.editor-delete').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('recipes_user_edits'))?.[0]?.name === 'Dock-Test aktualisiert');
    assert.equal(await page.locator('#recipeEditForm [name="name"]').inputValue(), 'Dock-Test aktualisiert');
    assert.equal(await page.locator('.editor-recipe-option').count(), 1);
});
