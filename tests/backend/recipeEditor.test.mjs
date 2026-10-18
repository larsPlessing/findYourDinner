import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findMatchingInstagramRecipeIndex } from '../../js/recipeEditor.mjs';

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
