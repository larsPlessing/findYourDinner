import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '../../pages/recipe-detail.html'), 'utf8');
const detailCss = fs.readFileSync(path.resolve(__dirname, '../../css/detail.css'), 'utf8');

describe('recipe detail page', () => {
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
            const actions = buttons.map(([, attributes]) => attributes.match(/onclick="([^"]+)"/)?.[1]);

            assert.ok(buttons.length >= 8, 'expected back, print, wake lock, random, portion controls and random FAB buttons');
            for (const action of [
                'goBack()',
                'printRecipe()',
                'toggleWakeLock()',
                'selectRandomRecipe()',
                'adjustPortions(-1)',
                'adjustPortions(1)',
                'resetPortions()',
                'toggleIngredientDock()',
                'selectRandomRecipe()'
            ]) assert.ok(actions.includes(action), `missing action ${action}`);

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
            assert.match(html, /loadFromURL\(['"]\.\.\/recipes\.json['"]\)/);
            assert.match(html, /localStorage\.getItem\(['"]currentRecipe['"]\)/);
            assert.match(html, /getRecipeByName\(recipeName\)/);
            assert.match(html, /recipeTitle['"]\)\.textContent\s*=\s*currentRecipe\.name/);
        });

        it('renders ingredients, instructions and the image gallery', () => {
            assert.match(html, /currentRecipe\.ingredients/);
            assert.match(html, /currentRecipe\.instructions/);
            assert.match(html, /getAllRecipeImageURLs\(currentRecipe\.name\)/);
            assert.match(html, /displayThumbnails\(\)/);
            assert.match(html, /function createIngredientItem\(ingredient\)/);
            assert.match(html, /function renderIngredientLists\(ingredients\)[\s\S]*?visibleIngredients\.map\(createIngredientItem\)/);
            assert.match(html, /function scaleIngredients\(\)[\s\S]*?renderIngredientLists\(scaledIngredients\)/);
        });

        it('shows a responsive video player below the preparation steps only when a recipe has a video', () => {
            assert.match(html, /id="instructionsList"[\s\S]*?id="recipeVideoSection"[^>]*hidden[\s\S]*?id="recipeVideo"[^>]*controls[^>]*playsinline/);
            assert.match(html, /displayInstructions\(\);\s*displayRecipeVideo\(\);/);
            assert.match(html, /function displayRecipeVideo\(\)[\s\S]*?if \(!src\)[\s\S]*?section\.hidden = true/);
            assert.match(html, /video\.src =/);
            assert.match(detailCss, /\.recipe-video-section video[\s\S]*?width: 100%[\s\S]*?aspect-ratio: 16 \/ 9/);
        });

        it('shows a collapsible ingredient dock on mobile without a preview list', () => {
            assert.match(html, /aria-controls="ingredientDockFullList" onclick="toggleIngredientDock\(\)"/);
            assert.doesNotMatch(html, /id="ingredientDockPreview"/);
            assert.doesNotMatch(html, /id="ingredientDockHint"/);
            assert.match(detailCss, /@media \(max-width: 768px\)[\s\S]*?\.ingredient-dock:not\(\[hidden\]\)[\s\S]*?position: fixed/);
            assert.doesNotMatch(detailCss, /\.ingredient-dock-preview/);
            assert.match(detailCss, /\.ingredient-dock-full\[hidden\][\s\S]*?display: none/);
            assert.match(detailCss, /padding-bottom: calc\(var\(--ingredient-dock-space, 120px\)/);
            assert.match(html, /function updateIngredientDockSpace\(\)[\s\S]*?dock\.offsetHeight \+ 20/);
            assert.match(html, /ingredientSectionObserver = new IntersectionObserver/);
        });

        it('renders untrusted recipe fields as text and creates note links safely', () => {
            assert.doesNotMatch(html, /li\.innerHTML\s*=/);
            assert.doesNotMatch(html, /noteEl\.innerHTML\s*=/);
            assert.doesNotMatch(html, /metaEl\.innerHTML\s*\+/);
            assert.match(html, /span\.textContent\s*=\s*value/);
            assert.match(html, /text\.textContent\s*=\s*instruction\.text/);
            assert.match(html, /link\.href\s*=\s*url\.href/);
            assert.match(html, /link\.textContent\s*=/);
        });
    });
});
