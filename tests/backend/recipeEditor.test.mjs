import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compressImportedRecipeImages, dataUrlToBlob, findMatchingInstagramRecipeIndex, readIngredientRows, setCoverImage } from '../../js/recipeEditor.mjs';

test('re-import matches an existing Instagram recipe by post path despite different query parameters', () => {
    const recipes = [
        { name: 'Pasta', notes: ['https://www.instagram.com/reel/other123/'] },
        {
            name: 'Brown Butter Brookies',
            notes: [
                'https://www.instagram.com/reel/C_gp9oXPMNq/?old-query=1',
                'Original caption'
            ]
        }
    ];

    assert.equal(
        findMatchingInstagramRecipeIndex(recipes, 'https://www.instagram.com/reel/C_gp9oXPMNq/?rpxt=cnJyd2VraHBpdXg0'),
        1
    );
});

test('Instagram source matching ignores unrelated links and malformed URLs', () => {
    const recipes = [
        { name: 'Other source', notes: ['https://example.com/reel/C_gp9oXPMNq/'] },
        { name: 'Malformed note', notes: [{ url: 'https://www.instagram.com/reel/C_gp9oXPMNq/' }] }
    ];

    assert.equal(findMatchingInstagramRecipeIndex(recipes, 'not-a-url'), -1);
    assert.equal(findMatchingInstagramRecipeIndex(recipes, 'https://www.instagram.com/reel/C_gp9oXPMNq/'), -1);
});

test('setCoverImage moves the chosen image to the front without mutating the original', () => {
    const images = [{ src: 'a.jpg' }, { src: 'b.jpg' }, { src: 'c.jpg' }];
    const result = setCoverImage(images, 2);
    assert.deepEqual(result.map(image => image.src), ['c.jpg', 'a.jpg', 'b.jpg']);
    assert.deepEqual(images.map(image => image.src), ['a.jpg', 'b.jpg', 'c.jpg']);
});

test('setCoverImage keeps the image list unchanged for invalid selections', () => {
    const images = [{ src: 'a.jpg' }, { src: 'b.jpg' }];
    assert.equal(setCoverImage(images, 0), images);
    assert.equal(setCoverImage(images, 5), images);
    assert.equal(setCoverImage(images, -1), images);
    assert.equal(setCoverImage(undefined, 1), undefined);
});

test('URL-imported base64 images are compressed before they enter the saved recipe list', async () => {
    const inputImage = `data:image/png;base64,${Buffer.from('original').toString('base64')}`;
    const recipe = { images: [{ src: inputImage }, { src: 'images/recipes/existing.jpg' }] };
    const compressedInputs = [];

    await compressImportedRecipeImages(recipe, async blob => {
        compressedInputs.push(blob);
        return 'data:image/jpeg;base64,Y29tcHJlc3NlZA==';
    });

    assert.equal(compressedInputs.length, 1);
    assert.equal(compressedInputs[0].type, 'image/png');
    assert.equal(await compressedInputs[0].text(), 'original');
    assert.equal(recipe.images[0].src, 'data:image/jpeg;base64,Y29tcHJlc3NlZA==');
    assert.equal(recipe.images[1].src, 'images/recipes/existing.jpg');
});

test('imported image conversion rejects unsupported or malformed data URLs', () => {
    assert.throws(() => dataUrlToBlob('data:image/svg+xml;base64,PHN2Zz4='), /ungültiges Format/);
});

test('ingredient amount parsing converts only plain decimal numbers', () => {
    const ingredient = amount => ({
        querySelector(selector) {
            const values = { amount, unit: '', product: 'Zutat', note: '' };
            return { value: values[selector.match(/name="([^"]+)"/)[1]] };
        }
    });
    const rows = { querySelectorAll: () => ['0x10', '1e3', '2,5', '2-4'].map(ingredient) };

    assert.deepEqual(readIngredientRows(rows).map(item => item.amount), ['0x10', '1e3', 2.5, '2-4']);
});
