import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseIngredientAmount, scaleIngredientAmount } = await import('../../js/ingredientAmount.mjs');

const detailJs = fs.readFileSync(path.resolve(import.meta.dirname, '../../js/recipeDetail.mjs'), 'utf8');

test('parses fractions, German decimal commas and plain numbers', () => {
    assert.equal(parseIngredientAmount('1/2'), 0.5);
    assert.equal(parseIngredientAmount('3/4'), 0.75);
    assert.equal(parseIngredientAmount('1 1/2'), 1.5);
    assert.equal(parseIngredientAmount('½'), 0.5);
    assert.equal(parseIngredientAmount('1 ½'), 1.5);
    assert.equal(parseIngredientAmount('1½'), 1.5);
    assert.equal(parseIngredientAmount('1.000'), 1000);
    assert.equal(parseIngredientAmount('2,5'), 2.5);
    assert.equal(parseIngredientAmount('1.5'), 1.5);
    assert.equal(parseIngredientAmount('4'), 4);
    assert.equal(parseIngredientAmount(4), 4);
    assert.equal(parseIngredientAmount(' 4 '), 4);
});

test('leaves amounts it cannot understand unparsed', () => {
    for (const value of ['200-300', 'etwas', '', null, undefined, 'eine Prise', '1/0', '1,2,3', '1.']) {
        assert.equal(parseIngredientAmount(value), null, `expected ${JSON.stringify(value)} to stay unparsed`);
    }
});

test('scales amounts without turning small fractions into rounded-up values', () => {
    assert.equal(scaleIngredientAmount(1, 0.25), '0,25');
    assert.equal(scaleIngredientAmount('1/2', 2), '1');
    assert.equal(scaleIngredientAmount('2,5', 2), '5');
    assert.equal(scaleIngredientAmount(100, 1.5), '150');
    assert.equal(scaleIngredientAmount('1 1/2', 2), '3');
    assert.equal(scaleIngredientAmount(1, 2 / 3), '0,67');
});

test('scales both ends of a range and keeps unknown amounts unchanged', () => {
    assert.equal(scaleIngredientAmount('200-300', 2), '400-600');
    assert.equal(scaleIngredientAmount('200 - 300', 0.5), '100-150');
    assert.equal(scaleIngredientAmount('2,5-3', 2), '5-6');
    assert.equal(scaleIngredientAmount('1–2', 2), '2-4');
    assert.equal(scaleIngredientAmount('1—2', 2), '2-4');
    assert.equal(scaleIngredientAmount('½–1 ½', 2), '1-3');
    assert.equal(scaleIngredientAmount('eine Prise', 2), 'eine Prise');
    assert.equal(scaleIngredientAmount(undefined, 2), undefined);
    assert.equal(scaleIngredientAmount(null, 2), null);
});

test('detail page scales ingredients with the shared amount helper', () => {
    assert.match(detailJs, /import \{ scaleIngredientAmount \} from ['"]\.\/ingredientAmount\.mjs['"]/);
    assert.match(detailJs, /amount: scaleIngredientAmount\(ingredient\.amount, scaleFactor\)/);
    assert.match(detailJs, /originalServings = \/\^\\d\+\(\?:\[.,\]\\d\+\)\?\$\/.test\(servingsText\)/);
    assert.doesNotMatch(detailJs, /parseFloat\(ingredient\.amount\)/);
    assert.doesNotMatch(detailJs, /\.toFixed\(1\)/);
});
