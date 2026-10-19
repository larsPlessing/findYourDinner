import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    decryptAssetBytes,
    decryptRecipeEnvelope,
    deriveKey,
    encryptAssetBytes,
    encryptRecipeEnvelope,
    getSaltFromEnvelope,
    prepareEncryptedRecipeSave
} from '../../js/recipeCrypto.mjs';
import { migrateRecipeData } from '../../scripts/encrypt-recipe-data.mjs';
import { restoreEncryptedFiles } from '../../scripts/decrypt-recipe-data.mjs';

const password = 'ein-langes-passwort-mit-mehreren-worten';

test('recipe envelopes and media use authenticated encryption', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const recipes = [{ id: 3, name: 'Geheimes Rezept', ingredients: [{ product: 'Zutat' }] }];
    const envelope = await encryptRecipeEnvelope(recipes, key, salt, 'revision-1');

    assert.equal(envelope.algorithm, 'AES-GCM');
    assert.equal(envelope.kdf, 'PBKDF2-SHA-256');
    assert.equal(envelope.iterations, 600_000);
    assert.doesNotMatch(JSON.stringify(envelope), /Geheimes Rezept|Zutat/);
    assert.deepEqual(await decryptRecipeEnvelope(envelope, key), recipes);

    const bytes = new TextEncoder().encode('private image bytes');
    const encryptedBytes = await encryptAssetBytes(bytes, key);
    assert.notDeepEqual(encryptedBytes, bytes);
    assert.equal(await (await decryptAssetBytes(encryptedBytes, key, 'image/jpeg')).text(), 'private image bytes');
    await assert.rejects(decryptRecipeEnvelope(envelope, await deriveKey('another-long-password-with-words', salt)));
});

test('editor save encrypts new media while maintaining local plaintext copies', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const imageBytes = new TextEncoder().encode('new image');
    const videoBytes = new TextEncoder().encode('new video');
    const toDataUrl = (mimeType, bytes) => `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
    const result = await prepareEncryptedRecipeSave([{
        name: 'Testrezept',
        images: [{ src: toDataUrl('image/jpeg', imageBytes) }],
        video: { src: toDataUrl('video/mp4', videoBytes), mimeType: 'video/mp4' }
    }], key, salt);

    assert.match(result.recipes[0].images[0].src, /^images\/recipes\/[0-9a-f-]+\.jpg\.enc$/);
    assert.match(result.plainRecipes[0].images[0].src, /^images\/recipes\/[0-9a-f-]+\.jpg$/);
    assert.match(result.recipes[0].video.src, /^videos\/recipes\/[0-9a-f-]+\.mp4\.enc$/);
    assert.match(result.plainRecipes[0].video.src, /^videos\/recipes\/[0-9a-f-]+\.mp4$/);
    assert.equal(result.mediaFiles.length, 2);
    assert.equal(result.plainMediaFiles.length, 2);
    assert.deepEqual(result.referencedFiles, [result.recipes[0].images[0].src, result.recipes[0].video.src]);
    assert.deepEqual(result.plainReferencedFiles, [result.plainRecipes[0].images[0].src, result.plainRecipes[0].video.src]);
    const image = await decryptAssetBytes(Buffer.from(result.mediaFiles[0].data, 'base64'), key, 'image/jpeg');
    assert.equal(await image.text(), 'new image');
});

test('resaving recipes with legacy extensionless enc names restores plaintext extensions', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const result = await prepareEncryptedRecipeSave([{
        name: 'Testrezept',
        images: [{ src: 'images/recipes/11111111-2222-3333-4444-555555555555.enc', mimeType: 'image/jpeg' }],
        video: { src: 'videos/recipes/66666666-7777-8888-9999-000000000000.enc', mimeType: 'video/mp4' }
    }], key, salt);

    assert.equal(result.plainRecipes[0].images[0].src, 'images/recipes/11111111-2222-3333-4444-555555555555.jpg');
    assert.equal(result.plainRecipes[0].video.src, 'videos/recipes/66666666-7777-8888-9999-000000000000.mp4');
    assert.deepEqual(result.plainReferencedFiles, [
        'images/recipes/11111111-2222-3333-4444-555555555555.jpg',
        'videos/recipes/66666666-7777-8888-9999-000000000000.mp4'
    ]);
    assert.equal(result.mediaFiles.length, 0);
    assert.equal(result.plainMediaFiles.length, 0);
});

test('restore derives missing plaintext extensions from media mime types', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'find-your-dinner-crypto-legacy-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const legacyImagePath = path.join(root, 'images', 'recipes', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    const legacyVideoPath = path.join(root, 'videos', 'recipes', 'ffffffff-0000-1111-2222-333333333333');
    await mkdir(path.dirname(legacyImagePath), { recursive: true });
    await mkdir(path.dirname(legacyVideoPath), { recursive: true });
    const salt = new Uint8Array(16).fill(1);
    const key = await deriveKey(password, salt);
    await writeFile(`${legacyImagePath}.enc`, await encryptAssetBytes(new TextEncoder().encode('legacy image'), key));
    await writeFile(`${legacyVideoPath}.enc`, await encryptAssetBytes(new TextEncoder().encode('legacy video'), key));
    const envelope = await encryptRecipeEnvelope([{
        id: 1,
        name: 'Legacy',
        images: [{ src: 'images/recipes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.enc', mimeType: 'image/jpeg' }],
        video: { src: 'videos/recipes/ffffffff-0000-1111-2222-333333333333.enc', mimeType: 'video/mp4' }
    }], key, salt, 'revision-legacy');
    await writeFile(path.join(root, 'recipes.enc'), JSON.stringify(envelope));
    await writeFile(path.join(root, 'AGENTS.md.enc'), await encryptAssetBytes(new TextEncoder().encode('# Private'), key));

    const result = await restoreEncryptedFiles({ root, passphrase: password });
    const restoredRecipes = JSON.parse(await readFile(path.join(root, 'recipes.json'), 'utf8'));

    assert.equal(result.mediaFiles, 2);
    assert.equal(restoredRecipes.recipes[0].images[0].src, 'images/recipes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg');
    assert.equal(restoredRecipes.recipes[0].video.src, 'videos/recipes/ffffffff-0000-1111-2222-333333333333.mp4');
    assert.equal(await readFile(`${legacyImagePath}.jpg`, 'utf8'), 'legacy image');
    assert.equal(await readFile(`${legacyVideoPath}.mp4`, 'utf8'), 'legacy video');
});

test('initial migration encrypts recipe and asset files but keeps plaintext files locally', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'find-your-dinner-crypto-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const imagePath = path.join(root, 'images', 'recipes', 'soup.jpg');
    const videoPath = path.join(root, 'videos', 'recipes', 'reel.mp4');
    const recipes = {
        version: 1,
        recipes: [{
            id: 1,
            name: 'Geheime Suppe',
            images: [{ src: 'images/recipes/soup.jpg' }],
            video: { src: 'videos/recipes/reel.mp4', mimeType: 'video/mp4' }
        }]
    };
    await mkdir(path.dirname(imagePath), { recursive: true });
    await mkdir(path.dirname(videoPath), { recursive: true });
    await writeFile(imagePath, 'plain image');
    await writeFile(videoPath, 'plain video');
    await writeFile(path.join(root, 'recipes.json'), JSON.stringify(recipes));

    const progressUpdates = [];
    const result = await migrateRecipeData({
        root,
        passphrase: password,
        onProgress: progress => progressUpdates.push(progress)
    });
    const envelope = JSON.parse(await readFile(path.join(root, 'recipes.enc'), 'utf8'));
    const key = await deriveKey(password, getSaltFromEnvelope(envelope), envelope.iterations);
    const encryptedRecipes = await decryptRecipeEnvelope(envelope, key);

    assert.equal(result.recipes, 1);
    assert.equal(result.mediaFiles, 2);
    assert.deepEqual(progressUpdates.at(-1), { completed: 4, total: 4 });
    assert.equal(encryptedRecipes[0].name, 'Geheime Suppe');
    assert.equal(encryptedRecipes[0].images[0].mimeType, 'image/jpeg');
    assert.match(encryptedRecipes[0].images[0].src, /\.jpg\.enc$/);
    assert.match(encryptedRecipes[0].video.src, /\.mp4\.enc$/);
    assert.equal(await (await decryptAssetBytes(await readFile(`${imagePath}.enc`), key, 'image/jpeg')).text(), 'plain image');
    assert.equal(await (await decryptAssetBytes(await readFile(`${videoPath}.enc`), key, 'video/mp4')).text(), 'plain video');
    assert.equal(await readFile(imagePath, 'utf8'), 'plain image');
    assert.equal(await readFile(videoPath, 'utf8'), 'plain video');
    assert.equal(await readFile(path.join(root, 'recipes.json'), 'utf8'), JSON.stringify(recipes));
});

test('initial migration deletes plaintext sources only when explicitly requested', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'find-your-dinner-crypto-delete-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const imagePath = path.join(root, 'images', 'recipes', 'soup.jpg');
    const recipesPath = path.join(root, 'recipes.json');
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(imagePath, 'plain image');
    await writeFile(recipesPath, JSON.stringify({
        version: 1,
        recipes: [{ id: 1, name: 'Geheime Suppe', images: [{ src: 'images/recipes/soup.jpg' }] }]
    }));

    await migrateRecipeData({ root, passphrase: password, deletePlaintext: true });

    await assert.rejects(readFile(recipesPath), { code: 'ENOENT' });
    await assert.rejects(readFile(imagePath), { code: 'ENOENT' });
    await readFile(path.join(root, 'recipes.enc'));
    await readFile(`${imagePath}.enc`);
});

test('migration can be rerun to update existing encrypted files', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'find-your-dinner-crypto-repeat-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const imagePath = path.join(root, 'images', 'recipes', 'soup.jpg');
    const recipesPath = path.join(root, 'recipes.json');
    const recipeData = name => ({
        version: 1,
        recipes: [{ id: 1, name, images: [{ src: 'images/recipes/soup.jpg' }] }]
    });
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(imagePath, 'first image');
    await writeFile(recipesPath, JSON.stringify(recipeData('Erste Suppe')));
    await migrateRecipeData({ root, passphrase: password });

    await writeFile(imagePath, 'updated image');
    await writeFile(recipesPath, JSON.stringify(recipeData('Neue Suppe')));
    const result = await migrateRecipeData({ root, passphrase: password });

    const envelope = JSON.parse(await readFile(path.join(root, 'recipes.enc'), 'utf8'));
    const key = await deriveKey(password, getSaltFromEnvelope(envelope), envelope.iterations);
    const recipes = await decryptRecipeEnvelope(envelope, key);
    const decryptedImage = await decryptAssetBytes(await readFile(`${imagePath}.enc`), key, 'image/jpeg');
    assert.equal(result.recipes, 1);
    assert.equal(recipes[0].name, 'Neue Suppe');
    assert.equal(await decryptedImage.text(), 'updated image');
    assert.equal(await readFile(imagePath, 'utf8'), 'updated image');
});

test('migration encrypts local documentation with the recipe archive key', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'find-your-dinner-crypto-docs-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sourceDocuments = {
        'AGENTS.md': '# Private agent instructions'
    };
    await writeFile(path.join(root, 'recipes.json'), JSON.stringify({ version: 1, recipes: [] }));
    for (const [filename, content] of Object.entries(sourceDocuments)) {
        await writeFile(path.join(root, filename), content);
    }

    const result = await migrateRecipeData({
        root,
        passphrase: password,
        documentFiles: Object.keys(sourceDocuments)
    });
    const envelope = JSON.parse(await readFile(path.join(root, 'recipes.enc'), 'utf8'));
    const key = await deriveKey(password, getSaltFromEnvelope(envelope), envelope.iterations);

    assert.equal(result.documents, 1);
    for (const [filename, content] of Object.entries(sourceDocuments)) {
        const encryptedDocument = await readFile(path.join(root, `${filename}.enc`));
        assert.equal(await (await decryptAssetBytes(encryptedDocument, key, 'text/plain')).text(), content);
        assert.equal(await readFile(path.join(root, filename), 'utf8'), content);
    }
});

test('local restore decrypts recipe data, media and docs without changing ciphertext', async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'find-your-dinner-crypto-restore-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const imagePath = path.join(root, 'images', 'recipes', 'soup.jpg');
    const sourceDocuments = {
        'AGENTS.md': '# Private agent instructions'
    };
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(imagePath, 'plain image');
    await writeFile(path.join(root, 'recipes.json'), JSON.stringify({
        version: 1,
        recipes: [{ id: 1, name: 'Suppe', images: [{ src: 'images/recipes/soup.jpg' }] }]
    }));
    for (const [filename, content] of Object.entries(sourceDocuments)) {
        await writeFile(path.join(root, filename), content);
    }

    await migrateRecipeData({
        root,
        passphrase: password,
        documentFiles: Object.keys(sourceDocuments)
    });
    const encryptedRecipesBefore = await readFile(path.join(root, 'recipes.enc'));
    const encryptedImageBefore = await readFile(`${imagePath}.enc`);
    await rm(path.join(root, 'recipes.json'));
    await rm(imagePath);
    for (const filename of Object.keys(sourceDocuments)) await rm(path.join(root, filename));

    const result = await restoreEncryptedFiles({ root, passphrase: password });
    const restoredRecipes = JSON.parse(await readFile(path.join(root, 'recipes.json'), 'utf8'));

    assert.equal(result.recipes, 1);
    assert.equal(result.mediaFiles, 1);
    assert.equal(result.documents, 1);
    assert.equal(restoredRecipes.recipes[0].name, 'Suppe');
    assert.equal(restoredRecipes.recipes[0].images[0].src, 'images/recipes/soup.jpg');
    assert.equal(await readFile(imagePath, 'utf8'), 'plain image');
    for (const [filename, content] of Object.entries(sourceDocuments)) {
        assert.equal(await readFile(path.join(root, filename), 'utf8'), content);
    }
    assert.deepEqual(await readFile(path.join(root, 'recipes.enc')), encryptedRecipesBefore);
    assert.deepEqual(await readFile(`${imagePath}.enc`), encryptedImageBefore);
    await assert.rejects(restoreEncryptedFiles({ root, passphrase: password }), /bereits/);
});
