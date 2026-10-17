import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('URL recipe import uses the provided category enum and imports a webpage image', async () => {
    const { importRecipe } = await import('../../server/recipeImporter.mjs');
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    const categories = ['Nachtisch - Süß', 'Mittagessen - Salzig'];
    const recipe = {
        title: 'Importierter Kuchen',
        category: categories[0],
        ingredients: [{ name: 'Mehl' }],
        steps: ['Mehl verrühren.']
    };

    globalThis.fetch = async (input, options) => {
        const url = String(input);
        if (url.includes('generativelanguage.googleapis.com')) {
            const request = JSON.parse(options.body);
            assert.deepEqual(request.generationConfig.responseSchema.properties.category.enum, categories);
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(recipe) }] } }] }));
        }
        if (url === 'https://example.com/recipe') {
            return new Response('<html><meta property="og:image" content="/recipe.jpg"><body>Ein einfaches Kuchenrezept mit Mehl und Zucker. Zutaten gut vermengen, in eine Form geben und im vorgeheizten Ofen backen, bis der Kuchen goldbraun ist.</body></html>', { url });
        }
        if (url === 'https://example.com/recipe.jpg') {
            return new Response(Buffer.from('recipe image'), { headers: { 'Content-Type': 'image/jpeg' } });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    try {
        const imported = await importRecipe({ url: 'https://example.com/recipe', categories });
        assert.equal(imported.category, categories[0]);
        assert.equal(imported.images[0].src, `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalApiKey;
    }
});

test('image recipe import falls back to an existing category if Gemini returns an unknown one', async () => {
    const { importRecipe } = await import('../../server/recipeImporter.mjs');
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    const categories = ['Snacks - Süß', 'Mittagessen - Salzig'];

    globalThis.fetch = async (input, options) => {
        const request = JSON.parse(options.body);
        assert.deepEqual(request.generationConfig.responseSchema.properties.category.enum, categories);
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify({
                title: 'Importiertes Rezept',
                category: 'Ungültig',
                ingredients: [{ name: 'Mehl' }],
                steps: ['Mehl verrühren.']
            }) }] } }]
        }));
    };

    try {
        const image = `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`;
        const imported = await importRecipe({ image, categories });
        assert.equal(imported.category, categories[0]);
        assert.equal(imported.images[0].src, image);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalApiKey;
    }
});
