const assert = require('node:assert/strict');
const { test } = require('node:test');

test('URL recipe imports always have a category and download recipe or metadata images', async () => {
    const { importRecipe } = await import('../../server/recipeImporter.mjs');
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    const requestedImages = [];
    const recipe = {
        title: 'Importiertes Rezept',
        ingredients: [{ name: 'Mehl' }],
        steps: ['Mehl verrühren.'],
        tags: []
    };

    globalThis.fetch = async input => {
        const url = String(input);
        if (url.includes('generativelanguage.googleapis.com')) {
            return new Response(JSON.stringify({
                candidates: [{ content: { parts: [{ text: JSON.stringify(recipe) }] } }]
            }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (url === 'https://example.com/images/recipe.jpg' || url === 'https://example.com/og-recipe.jpg') {
            requestedImages.push(url);
            return new Response(Buffer.from('recipe image'), { headers: { 'Content-Type': 'image/jpeg' } });
        }
        if (url === 'https://example.com/jsonld') {
            return new Response('<html><script type="application/ld+json">{"@type":"Recipe","name":"Kuchen","image":"https://example.com/images/recipe.jpg","recipeIngredient":["Mehl","Zucker"],"recipeInstructions":["Alles verrühren und backen."]}</script></html>');
        }
        if (url === 'https://example.com/metadata') {
            return new Response('<html><meta content="/og-recipe.jpg" property="og:image"><body>Ein einfaches Rezept mit Mehl, Zucker und frischen Eiern. Die Zutaten in einer Schüssel vermischen und anschließend im vorgeheizten Ofen goldbraun backen.</body></html>');
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
    };

    try {
        const jsonLdImport = await importRecipe({ url: 'https://example.com/jsonld' });
        assert.equal(jsonLdImport.category, 'Sonstiges');
        assert.equal(jsonLdImport.images[0].src, `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`);

        const metadataImport = await importRecipe({ url: 'https://example.com/metadata' });
        assert.equal(metadataImport.category, 'Sonstiges');
        assert.equal(metadataImport.images[0].src, `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`);
        assert.deepEqual(requestedImages, [
            'https://example.com/images/recipe.jpg',
            'https://example.com/og-recipe.jpg'
        ]);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalApiKey;
    }
});
