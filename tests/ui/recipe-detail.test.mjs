import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '../../pages/recipe-detail.html'), 'utf8');
const detailCss = fs.readFileSync(path.resolve(__dirname, '../../css/detail.css'), 'utf8');
const detailJs = fs.readFileSync(path.resolve(__dirname, '../../js/recipeDetail.mjs'), 'utf8');

describe('recipe detail page', () => {
    it('rejects local recipe file selection when the picker is cancelled', () => {
        assert.match(detailJs, /input\.addEventListener\(['"]cancel['"],\s*\(\) => reject\(new Error\(['"]Dateiauswahl wurde abgebrochen\./);
    });

    describe('layout and controls', () => {
        it('provides the DOM elements used to render a recipe', () => {
            for (const id of [
                'recipeTitle', 'recipeCategory', 'recipeMeta', 'recipeImageMain', 'imageThumbnails',
                'ingredientsSection', 'ingredientsList', 'instructionsList', 'notesSection', 'notesList', 'portionScaler',
                'recipeVideoSection', 'recipeVideo', 'recipeVideoError',
                'currentPortions', 'wakeLockBtn', 'wakeLockIcon', 'wakeLockText',
                'ingredientDock', 'ingredientDockToggle',
                'ingredientDockFullList', 'ingredientDockIngredients'
            ]) {
                assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
            }
        });

        it('includes every button and connects it to its action', () => {
            const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];

            assert.ok(buttons.length >= 8, 'expected back, print, wake lock, random, portion controls and random FAB buttons');
            for (const [id, call] of [
                ['detailBackBtn', 'goBack'],
                ['printRecipeBtn', 'printRecipe'],
                ['wakeLockBtn', 'toggleWakeLock'],
                ['selectRandomRecipeBtn', 'selectRandomRecipe'],
                ['portionMinusBtn', 'adjustPortions\\(-1\\)'],
                ['portionPlusBtn', 'adjustPortions\\(1\\)'],
                ['portionResetBtn', 'resetPortions'],
                ['ingredientDockToggle', 'toggleIngredientDock']
            ]) {
                assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
                assert.match(detailJs, new RegExp(`getElementById\\(["']${id}["']\\)\\.addEventListener\\(["']click["'],.*${call}`), `#${id} is not wired to ${call}`);
            }

            const buttonText = buttons.map(([, , body]) => body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).join(' ');
            for (const label of ['Zur', 'Drucken', 'Display wach', 'Anderes Rezept']) {
                assert.ok(buttonText.includes(label), `missing button label containing "${label}"`);
            }
            assert.match(html, /id="currentPortions"[^>]*>\s*4\s*<\/span>\s*Portionen/);
        });

        it('includes the recipe, ingredient, instruction, notes and image sections', () => {
            for (const text of ['Zutaten', 'Zubereitung', 'Bemerkungen', 'Links']) {
                assert.ok(html.includes(text), `missing visible section text "${text}"`);
            }
            assert.match(html, /class="detail-image-gallery"/);
            assert.match(html, /id="recipeCategory"/);
            assert.match(html, /id="recipeMeta"/);
        });

        it('does not contain mojibake text', () => {
            const mojibakePattern = /(?:Ãƒ|Ã.|Â.|ðŸ|â€|ï¸)/u;
            assert.doesNotMatch(html, mojibakePattern, 'found text that appears to have been decoded with the wrong character encoding');
        });
    });

    describe('recipe data and rendering', () => {
        it('loads repository JSON and restores the selected recipe', () => {
            assert.match(detailJs, /syncWithRemote\(['"]\.\.\/recipes\.enc['"]/);
            assert.match(detailJs, /localStorage\.getItem\(['"]currentRecipe['"]\)/);
            assert.match(detailJs, /generator\.getRecipeById\(recipeKey\)\s*\|\|\s*generator\.getRecipeByName\(recipeKey\)/);
            assert.match(detailJs, /recipeTitle['"]\)\.textContent\s*=\s*currentRecipe\.name/);
        });

        it('renders ingredients, instructions and the image gallery', () => {
            assert.match(detailJs, /currentRecipe\.ingredients/);
            assert.match(detailJs, /currentRecipe\.instructions/);
            assert.match(detailJs, /getAllRecipeImageURLs\(currentRecipe\)/);
            assert.match(detailJs, /document\.addEventListener\(['"]visibilitychange['"]/);
            assert.match(detailJs, /wakeLockRequested && wakeLock === null/);
            assert.match(detailJs, /displayThumbnails\(\)/);
            assert.match(detailJs, /function createIngredientItem\(ingredient\)/);
            assert.match(detailJs, /function renderIngredientLists\(ingredients\)[\s\S]*?visibleIngredients\.map\(createIngredientItem\)/);
            assert.match(detailJs, /function scaleIngredients\(\)[\s\S]*?renderIngredientLists\(scaledIngredients\)/);
            assert.match(detailJs, /thumbnailsEl\.replaceChildren\(\);\s*thumbnailsEl\.style\.display = ['"]none['"]/,
                'old image thumbnails should be cleared when a recipe has fewer images');
            assert.match(detailJs, /const alternatives = generator\.recipes\.filter\(recipe => recipe !== currentRecipe\)/,
                'random navigation should choose a different recipe where possible');
        });

        it('guards asynchronous recipe image renders against stale navigation', () => {
            assert.match(detailJs, /let renderToken = 0/);
            assert.match(detailJs, /async function displayRecipe\(\)[\s\S]*?const token = \+\+renderToken;[\s\S]*?await generator\.getAllRecipeImageURLs\(currentRecipe\);[\s\S]*?if \(token !== renderToken\) return/);
            assert.match(detailJs, /img\.onload = \(\) => \{\s*if \(token !== renderToken\) return;/);
        });

        it('keeps stored instruction order intact and renders only string notes', () => {
            assert.match(detailJs, /\[\.\.\.currentRecipe\.instructions\]\s*\.sort/);
            assert.match(detailJs, /currentRecipe\.notes\.forEach\(note => \{\s*if \(typeof note !== ['"]string['"]\) return/);
        });

        it('clears invalid video sources and reports wake-lock request failures accurately', () => {
            assert.match(detailJs, /if \(!\/\^videos[\s\S]*?video\.pause\(\);\s*video\.removeAttribute\(['"]src['"]\);\s*video\.load\(\)/);
            assert.match(detailJs, /catch \(err\)[\s\S]*?wakeLockRequested = false;[\s\S]*?Display-Sperre konnte nicht aktiviert werden/);
            assert.match(detailJs, /recipeVideoError/);
            assert.match(detailCss, /\.recipe-video-error\s*\{[\s\S]*?background:/);
        });

        it('returns to the recipe list after deleting the current detail recipe', () => {
            assert.match(detailJs, /globalThis\.onRecipeEditorDeleted = goBack/);
            assert.match(fs.readFileSync(path.resolve(__dirname, '../../js/recipeEditor.mjs'), 'utf8'),
                /globalThis\.onRecipeEditorDeleted\?\.\(\)/);
        });

        it('shows a responsive video player below the preparation steps only when a recipe has a video', () => {
            assert.match(html, /id="instructionsList"[\s\S]*?id="recipeVideoSection"[^>]*hidden[\s\S]*?id="recipeVideo"[^>]*controls[^>]*playsinline/);
            assert.match(detailJs, /displayInstructions\(\);\s*void displayRecipeVideo\(token\);/);
            assert.match(detailJs, /async function displayRecipeVideo\(token\)[\s\S]*?if \(!src\)[\s\S]*?section\.hidden = true/);
            assert.match(detailJs, /video\.src =/);
            assert.match(detailCss, /\.recipe-video-section video[\s\S]*?width: 100%[\s\S]*?aspect-ratio: 16 \/ 9/);
        });

        it('shows a collapsible ingredient dock on mobile without a preview list', () => {
            assert.match(html, /aria-controls="ingredientDockFullList"/);
            assert.match(detailJs, /getElementById\(["']ingredientDockToggle["']\)\.addEventListener\(["']click["'], toggleIngredientDock\)/);
            assert.doesNotMatch(html, /id="ingredientDockPreview"/);
            assert.doesNotMatch(html, /id="ingredientDockHint"/);
            assert.match(detailCss, /@media \(max-width: 768px\)[\s\S]*?\.ingredient-dock:not\(\[hidden\]\)[\s\S]*?position: fixed/);
            assert.doesNotMatch(detailCss, /\.ingredient-dock-preview/);
            assert.match(detailCss, /\.ingredient-dock-full\[hidden\][\s\S]*?display: none/);
            assert.match(detailCss, /padding-bottom: calc\(var\(--ingredient-dock-space, 120px\)/);
            assert.match(detailJs, /function updateIngredientDockSpace\(\)[\s\S]*?dock\.offsetHeight \+ 20/);
            assert.match(detailJs, /ingredientSectionObserver = new IntersectionObserver/);
        });

        it('renders untrusted recipe fields as text and creates note links safely', () => {
            assert.doesNotMatch(detailJs, /li\.innerHTML\s*=/);
            assert.doesNotMatch(detailJs, /noteEl\.innerHTML\s*=/);
            assert.doesNotMatch(detailJs, /metaEl\.innerHTML\s*\+/);
            assert.match(detailJs, /span\.textContent\s*=\s*value/);
            assert.match(detailJs, /text\.textContent\s*=\s*instruction\.text/);
            assert.match(detailJs, /link\.href\s*=\s*url\.href/);
            assert.match(detailJs, /link\.textContent\s*=/);
        });

        it('detail page HTML carries no inline JavaScript', () => {
            assert.doesNotMatch(html, /onclick=/);
            assert.doesNotMatch(html, /<script type=["']module["']\s*>/);
        });
    });
});
