const PBKDF2_ITERATIONS = 600_000;
const MIN_PASSPHRASE_LENGTH = 20;
const keyDatabaseName = 'find-your-dinner-vault';
const keyStoreName = 'keys';
let keyDatabasePromise;

function toBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function fromBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function getCrypto() {
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto wird von diesem Browser nicht unterstützt.');
    return globalThis.crypto;
}

function openKeyDatabase() {
    if (!globalThis.indexedDB) throw new Error('Dieser Browser unterstützt keinen sicheren Schlüsselspeicher.');
    if (!keyDatabasePromise) {
        keyDatabasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(keyDatabaseName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(keyStoreName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Der Schlüsselspeicher konnte nicht geöffnet werden.'));
        });
    }
    return keyDatabasePromise;
}

async function readStoredKey() {
    const database = await openKeyDatabase();
    return new Promise((resolve, reject) => {
        const request = database.transaction(keyStoreName).objectStore(keyStoreName).get('recipe-key');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Der gespeicherte Schlüssel konnte nicht gelesen werden.'));
    });
}

async function writeStoredKey(key) {
    const database = await openKeyDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(keyStoreName, 'readwrite');
        transaction.objectStore(keyStoreName).put(key, 'recipe-key');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('Der Schlüssel konnte nicht gespeichert werden.'));
        transaction.onabort = () => reject(transaction.error || new Error('Der Schlüssel konnte nicht gespeichert werden.'));
    });
}

async function deleteStoredKey() {
    const database = await openKeyDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(keyStoreName, 'readwrite');
        transaction.objectStore(keyStoreName).delete('recipe-key');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('Der ungültige Schlüssel konnte nicht entfernt werden.'));
        transaction.onabort = () => reject(transaction.error || new Error('Der ungültige Schlüssel konnte nicht entfernt werden.'));
    });
}

export async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
    const crypto = getCrypto();
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function decryptRecipeEnvelope(envelope, key) {
    const crypto = getCrypto();
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
        key,
        fromBase64(envelope.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
}

function requestPassphraseDialog(message = '') {
    return new Promise((resolve, reject) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'recipe-unlock-dialog';
        const form = document.createElement('form');
        form.method = 'dialog';
        const heading = document.createElement('h1');
        heading.textContent = 'Rezeptarchiv entsperren';
        const description = document.createElement('p');
        description.textContent = 'Gib das Passwort ein, um Rezepte und Bilder zu entschlüsseln.';
        const password = document.createElement('input');
        password.type = 'password';
        password.autocomplete = 'current-password';
        password.required = true;
        password.setAttribute('aria-label', 'Passwort');
        const status = document.createElement('p');
        status.className = 'recipe-unlock-error';
        status.setAttribute('role', 'alert');
        status.textContent = message;
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Entsperren';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'recipe-unlock-cancel';
        cancel.textContent = 'Abbrechen';
        form.append(heading, description, password, status, submit, cancel);
        dialog.appendChild(form);

        const cleanup = () => dialog.remove();
        cancel.addEventListener('click', () => {
            cleanup();
            reject(new Error('Das Rezeptarchiv wurde nicht entsperrt.'));
        }, { once: true });
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            cleanup();
            reject(new Error('Das Rezeptarchiv wurde nicht entsperrt.'));
        }, { once: true });
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (password.value.length < MIN_PASSPHRASE_LENGTH) {
                status.textContent = `Das Passwort muss mindestens ${MIN_PASSPHRASE_LENGTH} Zeichen lang sein.`;
                password.focus();
                return;
            }
            resolve({
                passphrase: password.value,
                showError(errorMessage) {
                    status.textContent = errorMessage;
                    password.value = '';
                    password.focus();
                },
                close: cleanup
            });
        });
        document.body.appendChild(dialog);
        dialog.showModal();
        password.focus();
    });
}

export async function unlockRecipeEnvelope(envelope) {
    if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'AES-GCM'
        || envelope.kdf !== 'PBKDF2-SHA-256' || !Number.isInteger(envelope.iterations)
        || envelope.iterations < 600_000 || typeof envelope.salt !== 'string'
        || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
        throw new Error('Die verschlüsselte Rezeptdatei hat ein ungültiges Format.');
    }

    let storedKey = await readStoredKey();
    if (storedKey) {
        try {
            const recipes = await decryptRecipeEnvelope(envelope, storedKey);
            return { key: storedKey, recipes };
        } catch {
            await deleteStoredKey();
            storedKey = null;
        }
    }

    let message = '';
    while (true) {
        const dialog = await requestPassphraseDialog(message);
        const key = await deriveKey(dialog.passphrase, fromBase64(envelope.salt), envelope.iterations);
        let recipes;
        try {
            recipes = await decryptRecipeEnvelope(envelope, key);
        } catch {
            dialog.close();
            message = 'Das Passwort ist falsch oder die Rezeptdatei ist beschädigt.';
            continue;
        }
        await writeStoredKey(key);
        dialog.close();
        return { key, recipes };
    }
}

export async function encryptRecipeEnvelope(recipes, key, salt, revision = crypto.randomUUID()) {
    const crypto = getCrypto();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(recipes));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
        version: 1,
        algorithm: 'AES-GCM',
        kdf: 'PBKDF2-SHA-256',
        iterations: PBKDF2_ITERATIONS,
        salt: toBase64(salt),
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(ciphertext)),
        revision
    };
}

export async function encryptAssetBytes(bytes, key) {
    const crypto = getCrypto();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    const result = new Uint8Array(iv.length + encrypted.length);
    result.set(iv);
    result.set(encrypted, iv.length);
    return result;
}

export function extensionForMimeType(mimeType) {
    return {
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
        'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov'
    }[mimeType] || '';
}

export function plainSrcForEncryptedSrc(src, mimeType) {
    const plainSrc = src.endsWith('.enc') ? src.slice(0, -4) : src;
    if (/\.(?:jpe?g|png|webp|mp4|mov|webm)$/i.test(plainSrc)) return plainSrc;
    return `${plainSrc}${extensionForMimeType(mimeType)}`;
}

export async function prepareEncryptedRecipeSave(recipes, key, salt) {
    const crypto = getCrypto();
    const updatedRecipes = structuredClone(recipes);
    const plainRecipes = structuredClone(recipes);
    const mediaFiles = [];
    const plainMediaFiles = [];
    const prepareDataUrl = async (dataUrl, directory, expectedMime) => {
        const match = dataUrl.match(/^data:([a-z][a-z\d+.-]+\/[a-z\d+.-]+);base64,([A-Za-z0-9+/=]+)$/i);
        if (!match || !match[1].startsWith(expectedMime)) throw new Error('Ein neues Medium hat ein ungültiges Format.');
        const extension = extensionForMimeType(match[1]);
        if (!extension) throw new Error('Ein neues Medium hat ein nicht unterstütztes Format.');
        const filename = crypto.randomUUID();
        const src = `${directory}/${filename}${extension}.enc`;
        const plainSrc = `${directory}/${filename}${extension}`;
        const encrypted = await encryptAssetBytes(fromBase64(match[2]), key);
        mediaFiles.push({ src, data: toBase64(encrypted) });
        plainMediaFiles.push({ src: plainSrc, data: match[2] });
        return { src, mimeType: match[1], plainSrc };
    };

    for (const [recipeIndex, recipe] of updatedRecipes.entries()) {
        const plainRecipe = plainRecipes[recipeIndex];
        for (const [imageIndex, image] of (Array.isArray(recipe.images) ? recipe.images : []).entries()) {
            if (typeof image?.src !== 'string' || !image.src.startsWith('data:')) continue;
            const prepared = await prepareDataUrl(image.src, 'images/recipes', 'image/');
            Object.assign(image, { src: prepared.src, mimeType: prepared.mimeType });
            Object.assign(plainRecipe.images[imageIndex], { src: prepared.plainSrc, mimeType: prepared.mimeType });
        }
        if (typeof recipe.video?.src === 'string' && recipe.video.src.startsWith('data:')) {
            const prepared = await prepareDataUrl(recipe.video.src, 'videos/recipes', 'video/');
            recipe.video = { ...recipe.video, src: prepared.src, mimeType: prepared.mimeType };
            plainRecipe.video = { ...plainRecipe.video, src: prepared.plainSrc, mimeType: prepared.mimeType };
        } else if (typeof recipe.video?.src === 'string' && recipe.video.src.endsWith('.enc')) {
            plainRecipe.video.src = plainSrcForEncryptedSrc(recipe.video.src, recipe.video.mimeType);
        }
        for (const [imageIndex, image] of (Array.isArray(recipe.images) ? recipe.images : []).entries()) {
            if (typeof image?.src === 'string' && image.src.endsWith('.enc')
                && typeof plainRecipe.images?.[imageIndex]?.src === 'string'
                && plainRecipe.images[imageIndex].src === image.src) {
                plainRecipe.images[imageIndex].src = plainSrcForEncryptedSrc(image.src, image.mimeType);
            }
        }
    }

    const revision = crypto.randomUUID();
    const envelope = await encryptRecipeEnvelope(updatedRecipes, key, salt, revision);
    const referencedFiles = updatedRecipes.flatMap(recipe => [
        ...(Array.isArray(recipe.images) ? recipe.images.map(image => image?.src) : []),
        recipe.video?.src
    ]).filter(src => typeof src === 'string' && /^(?:images|videos)\/recipes\/[^/\\]+\.enc$/.test(src));
    const plainReferencedFiles = plainRecipes.flatMap(recipe => [
        ...(Array.isArray(recipe.images) ? recipe.images.map(image => image?.src) : []),
        recipe.video?.src
    ]).filter(src => typeof src === 'string' && /^(?:images|videos)\/recipes\/[^/\\]+\.(?:jpe?g|png|webp|mp4|webm|mov)$/i.test(src));
    return { envelope, mediaFiles, plainMediaFiles, recipes: updatedRecipes, plainRecipes, referencedFiles, plainReferencedFiles, revision };
}

export async function decryptAssetBytes(bytes, key, mimeType = 'application/octet-stream') {
    if (bytes.byteLength <= 12) throw new Error('Die verschlüsselte Mediendatei ist ungültig.');
    const crypto = getCrypto();
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: data.subarray(0, 12) },
        key,
        data.subarray(12)
    );
    return new Blob([plaintext], { type: mimeType });
}

export function decodeBase64(value) {
    return fromBase64(value);
}

export function encodeBase64(value) {
    return toBase64(value);
}

export function getSaltFromEnvelope(envelope) {
    return fromBase64(envelope.salt);
}
