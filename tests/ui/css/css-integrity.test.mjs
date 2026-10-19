import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../../..');
const pages = [
    { name: 'homepage', file: 'index.html', stylesheet: 'css/index.css' },
    { name: 'recipe detail page', file: 'pages/recipe-detail.html', stylesheet: '../css/recipe-detail.css' }
];

function stripCssComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function countBraces(css) {
    let depth = 0;

    for (const character of stripCssComments(css)) {
        if (character === '{') depth++;
        if (character === '}') depth--;
        assert.ok(depth >= 0, 'CSS should not close a block before opening it');
    }

    return depth;
}

const stylesheets = new Map();
for (const page of pages) {
    const html = fs.readFileSync(path.join(projectRoot, page.file), 'utf8');
    const hrefs = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]
        .map(match => match[1]);

    // Support pages where href appears before rel as well.
    for (const match of html.matchAll(/<link\b(?=[^>]*rel=["']stylesheet["'])[^>]*>/gi)) {
        const href = match[0].match(/href=["']([^"']+)["']/i)?.[1];
        if (href && !hrefs.includes(href)) hrefs.push(href);
    }

    assert.ok(hrefs.length > 0, `${page.name} should link its stylesheets`);
    for (const href of hrefs) {
        const cssPath = path.resolve(path.dirname(path.join(projectRoot, page.file)), href);
        assert.ok(fs.existsSync(cssPath), `${page.name} stylesheet should exist: ${href}`);
        stylesheets.set(cssPath, fs.readFileSync(cssPath, 'utf8'));
    }
}

test.describe('page stylesheet integrity', () => {
    test('all referenced stylesheets exist and have balanced CSS blocks', () => {
        assert.ok(stylesheets.size > 0, 'the pages should load at least one stylesheet');

        for (const [cssPath, css] of stylesheets) {
            assert.equal(countBraces(css), 0, `${path.relative(projectRoot, cssPath)} should close every CSS block`);
        }
    });
});

test.describe('stylesheets live in the css folder', () => {
    test('pages carry no inline styles or style attributes', () => {
        for (const page of pages) {
            const html = fs.readFileSync(path.join(projectRoot, page.file), 'utf8');

            assert.doesNotMatch(html, /<style[\s>]/i, `${page.name} should not contain an inline <style> block`);
            assert.doesNotMatch(html, /\sstyle=["']/i, `${page.name} should not contain style attributes`);
        }
    });

    test('each page links its own page stylesheet', () => {
        for (const page of pages) {
            const html = fs.readFileSync(path.join(projectRoot, page.file), 'utf8');

            assert.ok(html.includes(`href="${page.stylesheet}"`), `${page.name} should link ${page.stylesheet}`);
        }
    });
});

test.describe('recipe card readability', () => {
    test('text and photos retain readable styles across screen sizes', () => {
        const pinterestCss = stylesheets.get(path.join(projectRoot, 'css/pinterest.css'));
        const mainCss = stylesheets.get(path.join(projectRoot, 'css/main.css'));

        assert.ok(pinterestCss, 'homepage should include pinterest.css');
        assert.ok(mainCss, 'homepage should include main.css');
        assert.match(pinterestCss, /\.recipe-pin-title\s*\{[^}]*font-size:\s*1(?:\.0)?em/i,
            'recipe titles should use a readable base font size');
        assert.match(pinterestCss, /\.recipe-pin-title\s*\{[^}]*line-height:\s*1\.3/i,
            'recipe titles should have enough line spacing');
        assert.match(pinterestCss, /\.recipe-pin-title\s*\{[^}]*color:\s*#333/i,
            'recipe titles should have strong contrast on white cards');
        assert.match(pinterestCss, /\.recipe-pin-image\s+img\s*\{[^}]*object-fit:\s*cover/i,
            'recipe photos should fill their card area without distortion');
        assert.match(pinterestCss, /@media\s*\(max-width:\s*576px\)[\s\S]*?\.recipe-pin-title\s*\{/i,
            'mobile title styles should remain inside the small-screen rules');
        assert.match(mainCss, /\.card\s*\{[^}]*background:\s*white/i,
            'content cards should keep a readable light background');
    });
});
