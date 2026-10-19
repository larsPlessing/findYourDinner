import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { applyImageTransform, generatePlaceholderImage, getRecipeEmoji } from '../../js/recipeDisplayUtils.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../..');

test('shared emoji mapping does not treat unrelated "ei" substrings as eggs', () => {
    assert.equal(getRecipeEmoji('Feierabend'), '🍽️');
    assert.equal(getRecipeEmoji('Ei im Glas'), '🍳');
    assert.equal(getRecipeEmoji('Spiegelei'), '🍳');
});

test('emoji mapping does not match food words inside unrelated words', () => {
    assert.equal(getRecipeEmoji('Preiselbeer-Kompott'), '🍽️');
    assert.equal(getRecipeEmoji('Computer-Reparatur'), '🍽️');
});

test('emoji mapping recognizes inflected and compound food names', () => {
    assert.equal(getRecipeEmoji('Nudeln mit Gemüse'), '🍝');
    assert.equal(getRecipeEmoji('Kartoffelauflauf'), '🥔');
    assert.equal(getRecipeEmoji('Hähnchen-Pasta'), '🍝');
});

test('shared placeholder safely escapes recipe names and allows detail-sized images', () => {
    const dataUrl = generatePlaceholderImage('<script>& Kuchen', '🍰', { size: 600, nameLimit: 30 });
    const svg = Buffer.from(dataUrl.split(',')[1], 'base64').toString('utf8');
    assert.match(svg, /width="600" height="600"/);
    assert.match(svg, /&lt;script&gt;&amp; Kuchen/);
});

test('shared image transforms keep rotation, flips and crop values', () => {
    const image = { style: {} };
    applyImageTransform(image, {
        rotation: 90,
        flipH: true,
        flipV: false,
        crop: { left: 1, top: 2, right: 3, bottom: 4 }
    });
    assert.equal(image.style.transform, 'rotate(90deg) scale(-1, 1)');
    assert.equal(image.style.clipPath, 'inset(2% 3% 4% 1%)');
});

test('both recipe pages use the shared display helpers instead of duplicated copies', () => {
    for (const filename of ['indexPage.mjs', 'recipeDetail.mjs']) {
        const source = fs.readFileSync(path.join(projectRoot, 'js', filename), 'utf8');
        assert.match(source, /from ['"]\.\/recipeDisplayUtils\.mjs['"]/);
        assert.doesNotMatch(source, /function (?:getRecipeEmoji|generatePlaceholderImage|applyImageTransform)\(/);
    }
});
