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

    assert.match(result.recipes[0].images[0].src, /^images\/recipes\/.*\.enc$/);
    assert.match(result.plainRecipes[0].images[0].src, /^images\/recipes\/.*\.jpg$/);
    assert.match(result.recipes[0].video.src, /^videos\/recipes\/.*\.enc$/);
    assert.match(result.plainRecipes[0].video.src, /^videos\/recipes\/.*\.mp4$/);
    assert.equal(result.mediaFiles.length, 2);
    assert.equal(result.plainMediaFiles.length, 2);
    const image = await decryptAssetBytes(Buffer.from(result.mediaFiles[0].data, 'base64'), key, 'image/jpeg');
    assert.equal(await image.text(), 'new image');
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
