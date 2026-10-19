import { fetchInstagramPost, isInstagramUrl } from './instagramImporter/index.mjs';
import { extractVideoFrames } from './instagramImporter/videoFrameExtractor.mjs';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// Modelle, auf die gewechselt wird, wenn das Token-Kontingent des Vorgängermodells erschöpft ist.
const GEMINI_FALLBACK_MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash'];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const RULES = `Extrahiere das Rezept als JSON nach dem vorgegebenen Schema.
Regeln:
- Übertrage Beschreibung, Zutaten, Zubereitung, Zeiten, Portionen und Tags natürlich ins Deutsche, unabhängig von der Sprache der Quelle. Lasse einen vorhandenen Rezepttitel in seiner Originalsprache und übersetze ihn nicht.
- Denglisch ist erlaubt: Geläufige englische Begriffe aus Küche und Rezepten (z. B. Brownies, Cookies, BBQ, Topping, One-Pot oder Smoothie Bowl) dürfen stehen bleiben. Vermeide künstliche Eindeutschungen; formuliere den übrigen Text idiomatisch auf Deutsch.
- Übersetze jede Einheit in eine in Deutschland gebräuchliche Einheitenangabe. Verwende z. B. g, kg, ml, l, °C, TL, EL, Prise und Tasse; übernimm keine fremdsprachigen Einheiten oder Abkürzungen wie "oz", "lb", "cups", "tsp" oder "tbsp". Rechne fremde Maßeinheiten in passende metrische oder deutsche Rezeptmaße um und passe die Menge korrekt an. Verwende für Temperaturen Grad Celsius.
- Erhalte Zahlen und Mengen, außer wenn für die Umrechnung einer Einheit eine angepasste Menge erforderlich ist.
- Erfinde nichts. Fehlende Angaben bleiben leer (null bzw. leeres Array).
- Zutaten einzeln aufführen: amount (als Text, z. B. "1/2" oder "200"), unit und name getrennt.
- Zubereitungsschritte in der richtigen Reihenfolge, ein Schritt pro Eintrag.
- category exakt aus der vorgegebenen Liste wählen; jedes Rezept ist entweder "Salzig" oder "Süß".
- healthy ist true, wenn Zutaten und Zubereitung insgesamt eine kalorienärmere, zum Abnehmen geeignete Variante ergeben; bewerte allgemein, ohne Portionsangaben oder Kalorienberechnung. Sonst false.
- Wenn kein Rezeptname angegeben oder lesbar ist, einen kurzen passenden deutschen Namen aus Zutaten und Zubereitung bilden.
- Zeiten gut lesbar angeben (z. B. "30 Min." statt "PT30M").
- tags: 2-5 passende Schlagworte.`;

const schema = {
    type: 'OBJECT',
    properties: {
        title: { type: 'STRING' },
        category: { type: 'STRING' },
        healthy: {
            type: 'BOOLEAN',
            description: 'True, wenn Zutaten und Zubereitung insgesamt kalorienärmer und zum Abnehmen geeignet sind; ohne Portionsangaben oder Kalorienberechnung beurteilen. Sonst false.'
        },
        description: { type: 'STRING', nullable: true },
        servings: { type: 'STRING', nullable: true },
        prepTime: { type: 'STRING', nullable: true },
        cookTime: { type: 'STRING', nullable: true },
        ingredients: { type: 'ARRAY', items: { type: 'OBJECT', properties: { amount: { type: 'STRING', nullable: true }, unit: { type: 'STRING', nullable: true }, name: { type: 'STRING' } }, required: ['name'] } },
        steps: { type: 'ARRAY', items: { type: 'STRING' } },
        tags: { type: 'ARRAY', items: { type: 'STRING' } }
    },
    required: ['title', 'category', 'healthy', 'ingredients', 'steps']
};

function extractRecipeNode(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.map(extractRecipeNode).find(Boolean) || null;
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    return types.includes('Recipe') ? node : extractRecipeNode(node['@graph']);
}

function extractJsonLdRecipe(html) {
    const scripts = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(scripts)) {
        try {
            const recipe = extractRecipeNode(JSON.parse(match[1].trim()));
            if (recipe) return recipe;
        } catch {
            // Ungültiges JSON-LD wird ignoriert.
        }
    }
    return null;
}

function decodeHtmlAttribute(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function parseHtmlAttributes(tag) {
    return Object.fromEntries([...tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map(match => [match[1].toLowerCase(), decodeHtmlAttribute(match[2] ?? match[3] ?? match[4])]));
}

function extractMetaImage(html) {
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of metaTags) {
        const attributes = parseHtmlAttributes(tag);
        const key = (attributes.property || attributes.name || '').toLowerCase();
        if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key) && attributes.content) {
            return attributes.content;
        }
    }
    return null;
}

function extractMetaContent(html, keys) {
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of metaTags) {
        const attributes = parseHtmlAttributes(tag);
        const key = (attributes.property || attributes.name || '').toLowerCase();
        if (keys.includes(key) && attributes.content) return attributes.content;
    }
    return null;
}

function extractRecipeImage(recipe) {
    const images = Array.isArray(recipe?.image) ? recipe.image : [recipe?.image];
    for (const image of images) {
        const candidate = typeof image === 'string' ? image : image?.url || image?.contentUrl;
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
}

function resolveImageUrl(value, baseUrl) {
    if (!value) return null;
    try {
        const imageUrl = new URL(value, baseUrl);
        return ['http:', 'https:'].includes(imageUrl.protocol) ? imageUrl.href : null;
    } catch {
        return null;
    }
}

async function downloadRecipeImage(imageUrl, fetchImpl = fetch) {
    const response = await fetchImpl(imageUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Bild nicht abrufbar (HTTP ${response.status}).`);

    const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const supportedMimeTypes = { 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
    const imageType = supportedMimeTypes[mimeType];
    if (!imageType) throw new Error('Das Webseitenbild hat ein nicht unterstütztes Format.');

    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('Das Webseitenbild ist größer als 15 MB.');

    const chunks = [];
    let totalBytes = 0;
    if (response.body) {
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_IMAGE_BYTES) {
                await reader.cancel();
                throw new Error('Das Webseitenbild ist größer als 15 MB.');
            }
            chunks.push(Buffer.from(value));
        }
    } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        totalBytes = buffer.length;
        if (totalBytes > MAX_IMAGE_BYTES) throw new Error('Das Webseitenbild ist größer als 15 MB.');
        chunks.push(buffer);
    }
    if (!totalBytes) throw new Error('Das Webseitenbild ist leer.');

    return `data:image/${imageType};base64,${Buffer.concat(chunks).toString('base64')}`;
}

function htmlToText(html) {
    return html
        .replace(/<(script|style|noscript|nav|footer|header|svg)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30000);
}

function validateUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Nur HTTP- und HTTPS-URLs können importiert werden.');
    return url.href;
}

function validateImageDataUrl(value) {
    const match = typeof value === 'string' && value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Das Bild muss ein JPEG-, PNG- oder WebP-Bild sein.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Das Bild ist leer oder größer als 15 MB.');
    return { mimeType: `image/${match[1]}`, data: match[2], dataUrl: value };
}

// Erkennt Fehler, die durch ein überschreiten des Token-Kontingents entstehen (429 oder passende Fehlermeldung).
function isTokenLimitError(error) {
    if (error.status === 429) return true;
    return /RESOURCE_EXHAUSTED|TOKEN_EXHAUSTED|token.{0,80}(limit|exceed)|(limit|exceed).{0,80}token|Quota|Kontingent/i.test(error.message);
}

async function requestGemini(model, parts, categories, fetchImpl, apiKey) {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    ...schema,
                    properties: { ...schema.properties, category: { type: 'STRING', enum: categories } }
                },
                temperature: 0.1
            }
        })
    });
    if (!response.ok) {
        const error = new Error(`Gemini API ${response.status}: ${await response.text()}`);
        error.status = response.status;
        throw error;
    }
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini hat kein Rezept zurückgegeben.');
    return JSON.parse(text);
}

async function callGemini(parts, categories, fetchImpl = fetch, apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) throw new Error('GEMINI_API_KEY fehlt. Lege ihn in der Datei .env im Projektordner ab oder setze ihn als Umgebungsvariable.');
    const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.filter(model => model !== GEMINI_MODEL)];
    let lastError = null;
    for (const [index, model] of models.entries()) {
        try {
            return await requestGemini(model, parts, categories, fetchImpl, apiKey);
        } catch (error) {
            lastError = error;
            const nextModel = models[index + 1];
            if (!isTokenLimitError(error) || !nextModel) throw error;
            console.warn(`Token-Kontingent von Gemini-Modell ${model} erschöpft, wechsle zu ${nextModel}: ${error.message}`);
        }
    }
    throw lastError;
}

function normalizeRecipe(recipe, source, categories, imageDataUrl) {
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.map(ingredient => ({
        amount: ingredient.amount || '', unit: ingredient.unit || '', product: ingredient.name || '', note: ''
    })).filter(ingredient => ingredient.product) : [];
    const instructions = Array.isArray(recipe.steps) ? recipe.steps.filter(Boolean).map((text, index) => ({ step: index + 1, text })) : [];
    if (!ingredients.length || !instructions.length) throw new Error('Die extrahierten Daten sind unvollständig.');
    const title = typeof recipe.title === 'string' && recipe.title.trim()
        ? recipe.title.trim()
        : `Rezept mit ${ingredients.slice(0, 2).map(ingredient => ingredient.product).join(' und ')}`;
    return {
        name: title,
        category: categories.includes(recipe.category) ? recipe.category : categories[0],
        healthy: recipe.healthy === true,
        servings: Number.parseFloat(recipe.servings) || null,
        ingredients,
        instructions,
        notes: [source, recipe.description, recipe.prepTime && `Vorbereitung: ${recipe.prepTime}`, recipe.cookTime && `Kochzeit: ${recipe.cookTime}`].filter(Boolean),
        tags: Array.isArray(recipe.tags) ? recipe.tags.filter(Boolean) : [],
        images: imageDataUrl ? [{ src: imageDataUrl }] : [],
        ...(recipe.video ? { video: recipe.video } : {}),
        isPlaceholder: false
    };
}

/** Extrahiert einen kompatiblen Rezeptentwurf aus einer Rezept-URL oder einem Bild. */
export async function importRecipe({ url, image, categories }, dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl || fetch;
    const apiKey = dependencies.apiKey ?? process.env.GEMINI_API_KEY;
    const validCategories = Array.isArray(categories) ? [...new Set(categories.filter(category => typeof category === 'string' && category.trim()).map(category => category.trim()))] : [];
    if (!validCategories.length) throw new Error('Für den Import wurden keine gültigen Rezeptkategorien gefunden.');
    if (url && image) throw new Error('Bitte importiere entweder eine URL oder ein Bild.');
    if (image) {
        const imageInput = validateImageDataUrl(image);
        const recipe = await callGemini([
            { text: `Du bekommst ein Foto oder einen Screenshot eines Rezepts. Lies den Text unabhängig von seiner Ausgangssprache. Übertrage den Rezeptinhalt ins Deutsche, aber lasse einen erkennbaren Rezepttitel in der Originalsprache. Falls kein Titel lesbar ist, erstelle einen kurzen passenden deutschen Namen anhand des Gerichts, der Zutaten und der Zubereitung.\n${RULES}` },
            { inline_data: { mime_type: imageInput.mimeType, data: imageInput.data } }
        ], validCategories, fetchImpl, apiKey);
        return normalizeRecipe(recipe, 'Importiert aus Bild', validCategories, imageInput.dataUrl);
    }
    if (!url) throw new Error('Bitte gib eine Rezept-URL an oder wähle ein Bild aus.');
    const source = validateUrl(url);
    const isInstagram = isInstagramUrl(source);
    let html;
    let pageUrl = source;
    let instagramPost = null;
    if (isInstagram) {
        instagramPost = await fetchInstagramPost(source, {
            fetchImpl,
            authenticatedLoader: dependencies.authenticatedInstagramLoader,
            ytDlpDownloader: dependencies.ytDlpDownloader
        });
        html = instagramPost.html;
        pageUrl = instagramPost.url || source;
    } else {
        const response = await fetchImpl(source, {
            redirect: 'follow',
            headers: { 'User-Agent': 'findYourDinner Recipe Importer', 'Accept-Language': 'de,en;q=0.8' }
        });
        if (!response.ok) throw new Error(`Seite nicht abrufbar (HTTP ${response.status}).`);
        html = await response.text();
        pageUrl = response.url || source;
    }
    const jsonLdRecipe = extractJsonLdRecipe(html);
    const instagramContent = isInstagram
        ? [
            extractMetaContent(html, ['og:title', 'twitter:title']),
            extractMetaContent(html, ['og:description', 'description', 'twitter:description']),
            htmlToText(html)
        ].filter(Boolean).join('\n')
        : null;
    const content = jsonLdRecipe ? JSON.stringify(jsonLdRecipe) : instagramContent || htmlToText(html);
    if (content.length < 100 && !(isInstagram && instagramPost?.video)) {
        if (isInstagram) throw new Error('Instagram stellt keine öffentlich lesbare Caption für diesen Beitrag bereit. Prüfe, ob der Beitrag öffentlich und noch verfügbar ist.');
        throw new Error('Kein Rezeptinhalt auf der Seite gefunden.');
    }
    const parts = [{
        text: `Du bekommst ${isInstagram ? 'die Caption und bis zu 24 chronologisch angeordnete Standbilder eines Instagram-Videos' : 'die Daten einer Rezeptseite'}. Lies alle eingeblendeten Zutaten, Mengen und Zubereitungsschritte genau ab. Erfasse auch Gewürze, Öle, Saucen und Toppings. Fasse über mehrere Bilder verteilte Zutatenlisten zusammen, übernimm keine Dopplungen und ordne Zubereitungsschritte anhand der Zeitstempel. Wenn eine Angabe nicht lesbar ist, lass sie offen statt sie zu erraten. Die Caption kann unvollständig sein; ergänze sie mit den Videobildern. Ignoriere Werbung, Kommentare und Navigation. Übertrage den Rezeptinhalt ins Deutsche, auch wenn Caption, Text oder Sprache des Videos in einer anderen Sprache sind. Lasse einen vorhandenen Rezepttitel in der Originalsprache und übersetze ihn nicht.\n${RULES}\n\n${content}`
    }];
    if (instagramPost?.video) {
        const frameExtractor = dependencies.instagramVideoFrameExtractor || extractVideoFrames;
        const frames = await frameExtractor(instagramPost.video);
        if (!Array.isArray(frames) || !frames.length || frames.some(frame => frame.mimeType !== 'image/jpeg' || !frame.data)) {
            throw new Error('Aus dem Instagram-Video konnten keine gültigen Bilder für die Rezeptanalyse erstellt werden.');
        }
        for (const frame of frames) {
            parts.push({ text: `Videobild bei etwa ${frame.timestampSeconds} Sekunden:` });
            parts.push({ inline_data: { mime_type: frame.mimeType, data: frame.data } });
        }
    }
    const recipe = await callGemini(parts, validCategories, fetchImpl, apiKey);
    let imageDataUrl = null;
    const imageUrl = resolveImageUrl(extractRecipeImage(jsonLdRecipe) || extractMetaImage(html), pageUrl);
    if (imageUrl) {
        try {
            imageDataUrl = await downloadRecipeImage(imageUrl, fetchImpl);
        } catch (error) {
            console.warn(`Webseitenbild konnte nicht importiert werden (${imageUrl}): ${error.message}`);
        }
    }
    const importedRecipe = normalizeRecipe(recipe, source, validCategories, imageDataUrl);
    if (isInstagram && instagramPost?.video) {
        importedRecipe.video = {
            mimeType: instagramPost.video.mimeType,
            data: instagramPost.video.data
        };
    }
    if (isInstagram && Array.isArray(instagramPost?.warnings) && instagramPost.warnings.length) {
        importedRecipe.importWarnings = instagramPost.warnings;
    }
    return importedRecipe;
}
