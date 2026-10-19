import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const port = 43117;
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForServer(process) {
    for (let attempt = 0; attempt < 40; attempt++) {
        if (process.exitCode !== null) throw new Error('Lokaler Testserver konnte nicht gestartet werden.');
        try {
            const response = await fetch(`${baseUrl}/recipes.json`);
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
    t.after(() => server.kill());
    await waitForServer(server);

    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
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
            instructions: Array.from({ length: 24 }, (_, index) => ({ step: index + 1, text: `Schritt ${index + 1}` })),
            notes: [],
            images: []
        }]));
    });
    await page.goto(`${baseUrl}/pages/recipe-detail.html`);
    await page.waitForSelector('#ingredientDock[hidden]', { state: 'attached' });
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
});
