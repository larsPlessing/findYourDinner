import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importRecipe } from '../../server/recipeImporter.mjs';

const categories = ['Salzig', 'Süß'];
const testApiKey = 'test-key';

function recipeResponse(recipe) {
    return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(recipe) }] } }]
    }));
}

function dependencies(t, fetchImplementation, extras = {}) {
    return {
        fetchImpl: t.mock.fn(fetchImplementation),
        apiKey: testApiKey,
        ytDlpDownloader: t.mock.fn(async () => null),
        ...extras
    };
}

test('URL recipe import uses the provided category enum and imports a webpage image', async t => {
    const recipe = {
        title: 'Classic Apple Cake',
        category: categories[0],
        healthy: true,
        ingredients: [{ name: 'Mehl' }],
        steps: ['Mehl verrühren.']
    };
    const deps = dependencies(t, async (input, options) => {
        const url = String(input);
        if (url.includes('generativelanguage.googleapis.com')) {
            const request = JSON.parse(options.body);
            assert.match(request.contents[0].parts[0].text, /Übertrage Beschreibung, Zutaten, Zubereitung, Zeiten, Portionen und Tags natürlich ins Deutsche/);
            assert.match(request.contents[0].parts[0].text, /Lasse einen vorhandenen Rezepttitel in seiner Originalsprache und übersetze ihn nicht/);
            assert.match(request.contents[0].parts[0].text, /Denglisch ist erlaubt/);
            assert.match(request.contents[0].parts[0].text, /jede Einheit in eine in Deutschland gebräuchliche Einheitenangabe/);
            assert.match(request.contents[0].parts[0].text, /keine fremdsprachigen Einheiten oder Abkürzungen wie "oz", "lb", "cups", "tsp" oder "tbsp"/);
            assert.match(request.contents[0].parts[0].text, /Rechne fremde Maßeinheiten in passende metrische oder deutsche Rezeptmaße um und passe die Menge korrekt an/);
            assert.deepEqual(request.generationConfig.responseSchema.properties.category.enum, categories);
            assert.equal(request.generationConfig.responseSchema.properties.healthy.type, 'BOOLEAN');
            assert.match(request.generationConfig.responseSchema.properties.healthy.description, /kalorienärmer und zum Abnehmen geeignet.*ohne Portionsangaben oder Kalorienberechnung/i);
            assert.match(request.contents[0].parts[0].text, /healthy ist true, wenn Zutaten und Zubereitung insgesamt eine kalorienärmere, zum Abnehmen geeignete Variante ergeben/i);
            assert.match(request.contents[0].parts[0].text, /ohne Portionsangaben oder Kalorienberechnung/i);
            assert.doesNotMatch(request.contents[0].parts[0].text, /Linsen mit Wasser|Nudeln oder Spätzle/);
            assert.ok(request.generationConfig.responseSchema.required.includes('healthy'));
            return recipeResponse(recipe);
        }
        if (url === 'https://example.com/recipe') {
            return new Response('<html><meta property="og:image" content="/recipe.jpg"><body>Ein einfaches Kuchenrezept mit Mehl und Zucker. Zutaten gut vermengen, in eine Form geben und im vorgeheizten Ofen backen, bis der Kuchen goldbraun ist.</body></html>', { url });
        }
        if (url === 'https://example.com/recipe.jpg') {
            return new Response(Buffer.from('recipe image'), { headers: { 'Content-Type': 'image/jpeg' } });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const imported = await importRecipe({ url: 'https://example.com/recipe', categories }, deps);
    assert.equal(imported.name, 'Classic Apple Cake');
    assert.equal(imported.category, categories[0]);
    assert.equal(imported.healthy, true);
    assert.equal(imported.images[0].src, `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`);
    assert.equal(deps.fetchImpl.mock.callCount(), 3);
});

test('webpage image redirects are validated before requesting the next address', async t => {
    const calls = [];
    const deps = dependencies(t, async (input, options) => {
        const url = String(input);
        calls.push({ url, options });
        if (url === 'https://example.com/recipe') {
            return new Response('<html><meta property="og:image" content="https://example.com/recipe.jpg"><body>Ein Rezept mit Mehl und Zucker. Zutaten vermengen und den Teig anschließend goldbraun im Ofen backen.</body></html>');
        }
        if (url.includes('generativelanguage.googleapis.com')) {
            return recipeResponse({
                title: 'Kuchen',
                category: 'Süß',
                healthy: false,
                ingredients: [{ name: 'Mehl' }],
                steps: ['Backen.']
            });
        }
        if (url === 'https://example.com/recipe.jpg') {
            return new Response(null, { status: 302, headers: { Location: 'javascript:alert(1)' } });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const imported = await importRecipe({ url: 'https://example.com/recipe', categories }, deps);

    assert.deepEqual(imported.images, []);
    assert.equal(calls.some(call => call.url.startsWith('javascript:')), false);
    assert.equal(calls.find(call => call.url === 'https://example.com/recipe.jpg').options.redirect, 'manual');
});

test('Instagram reel imports its public caption, frames and preview image in German', async t => {
    const caption = 'Ingredients: 200 g flour, 2 eggs and 100 ml milk. Mix everything and bake at 180 degrees for 25 minutes. Let the cake cool completely before serving.';
    const deps = dependencies(t, async (input, options) => {
        const requestUrl = String(input);
        if (requestUrl.includes('generativelanguage.googleapis.com')) {
            const request = JSON.parse(options.body);
            assert.match(request.contents[0].parts[0].text, new RegExp(caption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
            assert.match(request.contents[0].parts[0].text, /Übertrage den Rezeptinhalt ins Deutsche, auch wenn Caption, Text oder Sprache des Videos in einer anderen Sprache sind/);
            assert.match(request.contents[0].parts[0].text, /Lasse einen vorhandenen Rezepttitel in der Originalsprache und übersetze ihn nicht/);
            assert.match(request.contents[0].parts[0].text, /Denglisch ist erlaubt/);
            assert.match(request.contents[0].parts[0].text, /Lies alle eingeblendeten Zutaten, Mengen und Zubereitungsschritte genau ab/);
            assert.deepEqual(request.contents[0].parts.filter(part => part.inline_data).map(part => part.inline_data), [
                { mime_type: 'image/jpeg', data: Buffer.from('frame 1').toString('base64') },
                { mime_type: 'image/jpeg', data: Buffer.from('frame 2').toString('base64') }
            ]);
            assert.match(request.contents[0].parts[1].text, /bei etwa 0 Sekunden/);
            assert.match(request.contents[0].parts[3].text, /bei etwa 5 Sekunden/);
            return recipeResponse({
                title: 'Kuchen',
                category: 'Süß',
                healthy: false,
                ingredients: [{ amount: '200', unit: 'g', name: 'Mehl' }, { amount: '2', unit: '', name: 'Eier' }],
                steps: ['Alles verrühren und backen.']
            });
        }
        if (requestUrl === 'https://www.instagram.com/reel/DaC-aG0sbbE/embed/captioned/') {
            assert.match(options.headers['User-Agent'], /Mozilla\/5\.0/);
            return new Response(`<html><meta property="og:description" content="${caption}"><meta property="og:image" content="https://example.com/instagram.jpg"><meta property="og:video" content="https://scontent.cdninstagram.com/reel.mp4"></html>`);
        }
        if (requestUrl === 'https://example.com/instagram.jpg') {
            return new Response(Buffer.from('instagram preview'), { headers: { 'Content-Type': 'image/jpeg' } });
        }
        if (requestUrl === 'https://scontent.cdninstagram.com/reel.mp4') {
            return new Response(Buffer.from('instagram video'), { headers: { 'Content-Type': 'video/mp4' } });
        }
        throw new Error(`Unexpected fetch URL: ${requestUrl}`);
    }, {
        instagramVideoFrameExtractor: t.mock.fn(async video => {
            assert.deepEqual(video, { mimeType: 'video/mp4', data: Buffer.from('instagram video').toString('base64') });
            return [
                { mimeType: 'image/jpeg', data: Buffer.from('frame 1').toString('base64'), timestampSeconds: 0 },
                { mimeType: 'image/jpeg', data: Buffer.from('frame 2').toString('base64'), timestampSeconds: 5 }
            ];
        })
    });

    const source = 'https://www.instagram.com/reel/DaC-aG0sbbE/?obrf=MTF0NHZieHpkbWJ2eA%3D%3D';
    const imported = await importRecipe({ url: source, categories }, deps);
    assert.equal(imported.name, 'Kuchen');
    assert.equal(imported.category, 'Süß');
    assert.equal(imported.notes[0], source);
    assert.equal(imported.images[0].src, `data:image/jpeg;base64,${Buffer.from('instagram preview').toString('base64')}`);
});

test('Instagram recipe in video can be imported in German when the caption is short and English', async t => {
    const caption = 'Fresh udon salad with mango and chili oil yogurt.';
    const recipe = {
        title: 'Asia Udon Salad with Mango, Edamame & Chili Oil Yogurt',
        category: 'Salzig',
        healthy: true,
        ingredients: [
            { amount: '1', unit: 'Packung', name: 'Udon-Nudeln' },
            { amount: '1', unit: 'gute Hand', name: 'Chinakohl, fein geschnitten' },
            { amount: '1/2', unit: '', name: 'Gurke, in feine Streifen geschnitten' },
            { amount: '1', unit: '', name: 'Karotte, in feine Streifen geschnitten' },
            { amount: '1/2', unit: '', name: 'Mango, in Streifen geschnitten' },
            { amount: '1', unit: 'gute Hand', name: 'Edamame' },
            { amount: '2', unit: '', name: 'Lauchzwiebeln, in feine Ringe geschnitten' },
            { amount: '1', unit: 'TL', name: 'Sesam' },
            { amount: '200', unit: 'g', name: 'Joghurt' },
            { amount: '', unit: '', name: 'Chiliöl' },
            { amount: '1', unit: 'Schuss', name: 'Sojasauce' },
            { amount: '1', unit: 'Schuss', name: 'Ahornsirup' },
            { amount: '', unit: '', name: 'Salz' }
        ],
        steps: [
            'Udon-Nudeln nach Packungsanweisung kochen, abgießen und abkühlen lassen.',
            'Die abgekühlten Nudeln mit Chinakohl, Gurke, Karotte, Mango, Edamame und Lauchzwiebeln in eine große Schüssel geben.',
            'Sesam darüberstreuen.',
            'Für das Dressing Joghurt mit Chiliöl, Sojasauce, Ahornsirup und Salz verrühren.',
            'Das Dressing über den Salat geben, alles gut vermengen und direkt servieren.'
        ]
    };
    const deps = dependencies(t, async (input, options) => {
        const requestUrl = String(input);
        if (requestUrl.includes('generativelanguage.googleapis.com')) {
            const request = JSON.parse(options.body);
            assert.match(request.contents[0].parts[0].text, /Übertrage den Rezeptinhalt ins Deutsche, auch wenn Caption, Text oder Sprache des Videos in einer anderen Sprache sind/);
            assert.match(request.contents[0].parts[0].text, /Die Caption kann unvollständig sein; ergänze sie mit den Videobildern/);
            assert.equal(request.contents[0].parts.filter(part => part.inline_data).length, 1);
            return recipeResponse(recipe);
        }
        if (requestUrl === 'https://scontent.cdninstagram.com/reel.mp4') {
            return new Response(Buffer.from('instagram video'), { headers: { 'Content-Type': 'video/mp4' } });
        }
        return new Response(`<html><meta property="og:description" content="${caption}"><meta property="og:video" content="https://scontent.cdninstagram.com/reel.mp4"></html>`);
    }, {
        instagramVideoFrameExtractor: t.mock.fn(async () => [
            { mimeType: 'image/jpeg', data: Buffer.from('recipe overlay frame').toString('base64'), timestampSeconds: 1 }
        ])
    });

    const imported = await importRecipe({
        url: 'https://www.instagram.com/reel/DaC-aG0sbbE/?obrf=MTF0NHZieHpkbWJ2eA%3D%3D',
        categories
    }, deps);
    assert.equal(imported.name, 'Asia Udon Salad with Mango, Edamame & Chili Oil Yogurt');
    assert.equal(imported.ingredients.length, 13);
    assert.equal(imported.instructions.length, 5);
    assert.equal(imported.ingredients[11].product, 'Ahornsirup');
    assert.deepEqual(imported.video, {
        mimeType: 'video/mp4',
        data: Buffer.from('instagram video').toString('base64')
    });
});

test('Instagram reel retries video download with the authenticated session when public media is blocked', async t => {
    const videoData = Buffer.from('authenticated reel video').toString('base64');
    const authLoader = t.mock.fn(async url => ({
        html: '<html><meta property="og:description" content="A complete recipe caption with ingredients and cooking instructions that is long enough to be processed."></html>',
        url,
        video: { mimeType: 'video/mp4', data: videoData }
    }));
    const deps = dependencies(t, async (input, options) => {
        const requestUrl = String(input);
        if (requestUrl.includes('generativelanguage.googleapis.com')) {
            return recipeResponse({
                title: 'Brown Butter Brookies',
                category: 'Süß',
                healthy: false,
                ingredients: [{ name: 'Mehl' }],
                steps: ['Backen.']
            });
        }
        if (requestUrl === 'https://scontent.cdninstagram.com/reel.mp4') {
            return new Response('Media blocked', { status: 403 });
        }
        return new Response('<html><meta property="og:description" content="A complete recipe caption with ingredients and cooking instructions that is long enough to be processed."><meta property="og:video" content="https://scontent.cdninstagram.com/reel.mp4"></html>');
    }, {
        authenticatedInstagramLoader: authLoader,
        instagramVideoFrameExtractor: t.mock.fn(async () => [
            { mimeType: 'image/jpeg', data: Buffer.from('authenticated frame').toString('base64'), timestampSeconds: 1 }
        ])
    });

    const imported = await importRecipe({
        url: 'https://www.instagram.com/reel/C_gp9oXPMNq/?rpxt=cnJyd2VraHBpdXg0',
        categories
    }, deps);

    assert.equal(authLoader.mock.callCount(), 1);
    assert.deepEqual(imported.video, { mimeType: 'video/mp4', data: videoData });
});

test('Instagram reel imports the available caption and returns a warning without a playable video', async t => {
    const authLoader = t.mock.fn(async url => ({
        html: '<html><meta property="og:description" content="A complete recipe caption with ingredients and cooking instructions that is long enough to be processed."></html>',
        url,
        video: null
    }));
    const deps = dependencies(t, async input => String(input).includes('generativelanguage.googleapis.com')
        ? recipeResponse({
            title: 'Instagram-Rezept',
            category: 'Salzig',
            healthy: false,
            ingredients: [{ name: 'Mehl' }],
            steps: ['Backen.']
        })
        : new Response('<html><meta property="og:description" content="A complete recipe caption with ingredients and cooking instructions that is long enough to be processed."></html>'), {
        authenticatedInstagramLoader: authLoader
    });

    const imported = await importRecipe({
        url: 'https://www.instagram.com/reel/C_gp9oXPMNq/?rpxt=cnJyd2VraHBpdXg0',
        categories
    }, deps);

    assert.equal(imported.video, undefined);
    assert.deepEqual(imported.importWarnings, [
        'Für diesen Instagram-Beitrag wurde kein abspielbares Video gefunden. Das Rezept wurde nur anhand der verfügbaren Beschreibung importiert.'
    ]);
});

test('Instagram imports use the authenticated loader if anonymous access is unavailable', async t => {
    let authenticatedUrl;
    let geminiCalled = false;
    const deps = dependencies(t, async (input, options) => {
        const requestUrl = String(input);
        if (requestUrl.includes('instagram.com')) {
            return new Response('<html><body>Log in to Instagram. Create an account or log in to see photos and videos. This is a long sign-in page without information about the post.</body></html>');
        }
        if (requestUrl.includes('generativelanguage.googleapis.com')) {
            geminiCalled = true;
            const request = JSON.parse(options.body);
            assert.deepEqual(request.contents[0].parts[2].inline_data, {
                mime_type: 'image/jpeg',
                data: Buffer.from('authenticated frame').toString('base64')
            });
            return recipeResponse({
                title: 'Instagram-Rezept',
                category: 'Salzig',
                healthy: false,
                ingredients: [{ name: 'Mehl' }],
                steps: ['Im Ofen backen.']
            });
        }
        throw new Error(`Unexpected fetch URL: ${requestUrl}`);
    }, {
        authenticatedInstagramLoader: t.mock.fn(async url => {
            authenticatedUrl = url;
            return {
                html: '<html><meta property="og:description" content="Ein Rezept mit Mehl und Eiern, das im Ofen goldbraun gebacken wird. Eine klare Caption mit ausreichender Länge, damit das Rezept beschrieben ist."></html>',
                url,
                video: { mimeType: 'video/mp4', data: Buffer.from('authenticated video').toString('base64') }
            };
        }),
        instagramVideoFrameExtractor: t.mock.fn(async video => {
            assert.deepEqual(video, { mimeType: 'video/mp4', data: Buffer.from('authenticated video').toString('base64') });
            return [{ mimeType: 'image/jpeg', data: Buffer.from('authenticated frame').toString('base64'), timestampSeconds: 3 }];
        })
    });
    const imported = await importRecipe({
        url: 'https://www.instagram.com/reel/DaC-aG0sbbE/',
        categories
    }, deps);
    assert.equal(authenticatedUrl, 'https://www.instagram.com/reel/DaC-aG0sbbE/');
    assert.equal(imported.name, 'Instagram-Rezept');
    assert.equal(geminiCalled, true);
});

test('Instagram import reports video frame extraction failures instead of using only the caption', async t => {
    let geminiCalled = false;
    const deps = dependencies(t, async input => {
        if (String(input).includes('generativelanguage.googleapis.com')) {
            geminiCalled = true;
            throw new Error('Gemini must not be called without video frames');
        }
        if (String(input) === 'https://scontent.cdninstagram.com/reel.mp4') {
            return new Response(Buffer.from('instagram video'), { headers: { 'Content-Type': 'video/mp4' } });
        }
        return new Response('<html><meta property="og:description" content="Ein langes Rezept mit Zutaten und einer klaren Zubereitung, die vollständig in der Videobeschreibung erklärt wird."><meta property="og:video" content="https://scontent.cdninstagram.com/reel.mp4"></html>');
    }, {
        instagramVideoFrameExtractor: t.mock.fn(async () => {
            throw new Error('FFmpeg konnte das Video nicht lesen.');
        })
    });

    await assert.rejects(
        importRecipe({ url: 'https://www.instagram.com/reel/DaC-aG0sbbE/', categories }, deps),
        /FFmpeg konnte das Video nicht lesen/
    );
    assert.equal(geminiCalled, false);
});

test('Instagram import returns actionable guidance when local session cannot open the reel', async t => {
    const deps = dependencies(t, async () => new Response('<html><script>window.route={"pageID":"httpErrorPage"}</script></html>'), {
        authenticatedInstagramLoader: t.mock.fn(async () => {
            throw new Error('Melde dich im geöffneten Instagram-Fenster an und versuche es erneut.');
        })
    });

    await assert.rejects(
        importRecipe({ url: 'https://www.instagram.com/reel/DaC-aG0sbbE/', categories }, deps),
        /Melde dich im geöffneten Instagram-Fenster.*Anonymer Abruf/
    );
});

test('image recipe import falls back to an existing category if Gemini returns an unknown one', async t => {
    const deps = dependencies(t, async (input, options) => {
        const request = JSON.parse(options.body);
        assert.match(request.contents[0].parts[0].text, /Übertrage den Rezeptinhalt ins Deutsche/);
        assert.match(request.contents[0].parts[0].text, /Verwende für Temperaturen Grad Celsius/);
        assert.deepEqual(request.generationConfig.responseSchema.properties.category.enum, categories);
        assert.match(request.contents[0].parts[0].text, /healthy ist true, wenn Zutaten und Zubereitung insgesamt eine kalorienärmere, zum Abnehmen geeignete Variante ergeben/i);
        assert.match(request.contents[0].parts[0].text, /erstelle einen kurzen passenden deutschen Namen anhand des Gerichts, der Zutaten und der Zubereitung/i);
        return recipeResponse({
            title: ' ',
            category: 'Ungültig',
            healthy: true,
            ingredients: [{ name: 'Mehl' }, { name: 'Zucker' }],
            steps: ['Mehl verrühren.']
        });
    });
    const image = `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`;

    const imported = await importRecipe({ image, categories }, deps);
    assert.equal(imported.name, 'Rezept mit Mehl und Zucker');
    assert.equal(imported.category, 'Salzig');
    assert.equal(imported.healthy, true);
    assert.equal(imported.images[0].src, image);
});

test('import falls back to the next Gemini model when the token quota of the first one is exhausted', async t => {
    const calledModels = [];
    const deps = dependencies(t, async (input, options) => {
        calledModels.push(String(input).match(/models\/([^:]+):generateContent/)[1]);
        if (calledModels.length === 1) {
            return new Response('{"error":{"code":429,"message":"RESOURCE_EXHAUSTED: Quota exceeded for quota metric"}}', { status: 429 });
        }
        return recipeResponse({ title: 'Kuchen', category: 'Süß', healthy: false, ingredients: [{ name: 'Mehl' }], steps: ['Rühren.'] });
    });
    const image = `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`;

    const imported = await importRecipe({ image, categories }, deps);
    assert.deepEqual(calledModels, ['gemini-3.8-flash', 'gemini-3.7-flash']);
    assert.equal(imported.name, 'Kuchen');
});

test('import walks through both Gemini fallback models when their token limits are exceeded', async t => {
    const calledModels = [];
    const deps = dependencies(t, async (input, options) => {
        calledModels.push(String(input).match(/models\/([^:]+):generateContent/)[1]);
        if (calledModels.length === 1) {
            return new Response('{"error":{"code":429,"message":"Quota exceeded"}}', { status: 429 });
        }
        if (calledModels.length === 2) {
            return new Response('{"error":{"code":400,"message":"The input token count exceeds the maximum number of tokens allowed"}}', { status: 400 });
        }
        return recipeResponse({ title: 'Kuchen', category: 'Süß', healthy: false, ingredients: [{ name: 'Mehl' }], steps: ['Rühren.'] });
    });
    const image = `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`;

    const imported = await importRecipe({ image, categories }, deps);
    assert.deepEqual(calledModels, ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']);
    assert.equal(imported.name, 'Kuchen');
});

test('import reports token quota errors when every Gemini model is exhausted', async t => {
    const deps = dependencies(t, async () => new Response('{"error":{"code":429,"message":"Quota exceeded"}}', { status: 429 }));
    const image = `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`;

    await assert.rejects(importRecipe({ image, categories }, deps), /Gemini API 429: .*Quota exceeded/);
    assert.equal(deps.fetchImpl.mock.callCount(), 3);
});

test('import does not fall back to another Gemini model for unrelated errors', async t => {
    const deps = dependencies(t, async () => new Response('{"error":{"code":400,"message":"Ungültige Anfrage"}}', { status: 400 }));
    const image = `data:image/jpeg;base64,${Buffer.from('recipe image').toString('base64')}`;

    await assert.rejects(importRecipe({ image, categories }, deps), /Gemini API 400: .*Ungültige Anfrage/);
    assert.equal(deps.fetchImpl.mock.callCount(), 1);
});
