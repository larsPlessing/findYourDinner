import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKey, encryptAssetBytes, encryptRecipeEnvelope } from '../js/recipeCrypto.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm'
};
const minimumPassphraseLength = 20;

function loadAppPassword() {
    try {
        process.loadEnvFile(path.join(rootDirectory, '.env'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    return process.env.APP_PASSWORD?.trim() || null;
}

function readPassword(promptText) {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
        throw new Error('Bitte starte den Befehl in einem interaktiven Terminal, damit das Passwort verdeckt eingegeben wird.');
    }
    return new Promise((resolve, reject) => {
        const input = process.stdin;
        const output = process.stdout;
        let value = '';
        let escapeSequence = 0;
        output.write(promptText);
        input.setRawMode(true);
        input.resume();
        const restore = () => {
            input.setRawMode(false);
            input.pause();
            input.removeListener('data', onData);
        };
        const onData = buffer => {
            for (const character of buffer.toString('utf8')) {
                if (escapeSequence === 1) {
                    escapeSequence = character === '[' || character === 'O' ? 2 : 0;
                    continue;
                }
                if (escapeSequence === 2) {
                    if (character >= '@' && character <= '~') escapeSequence = 0;
                    continue;
                }
                if (character === '\u001b') {
                    escapeSequence = 1;
                    continue;
                }
                if (character === '\u0003') {
                    restore();
                    output.write('\n');
                    reject(new Error('Abgebrochen.'));
                    return;
                }
                if (character === '\r' || character === '\n') {
                    restore();
                    output.write('\n');
                    resolve(value);
                    return;
                }
                if (character === '\u007f' || character === '\b') {
                    if (value.length) {
                        value = value.slice(0, -1);
                        output.write('\b \b');
                    }
                    continue;
                }
                if (character >= ' ') {
                    value += character;
                    output.write('*');
                }
            }
        };
        input.on('data', onData);
    });
}

function mimeTypeForPath(filePath) {
    const mimeType = mimeTypes[path.extname(filePath).toLowerCase()];
    if (!mimeType) throw new Error(`Nicht unterstütztes Medienformat: ${path.extname(filePath) || '(ohne Endung)'}`);
    return mimeType;
}

function safeRecipeAssetPath(root, src, expectedDirectory) {
    if (typeof src !== 'string' || !src.startsWith(`${expectedDirectory}/`)) {
        throw new Error(`Medienpfad außerhalb von ${expectedDirectory} kann nicht sicher migriert werden.`);
    }
    const normalized = path.posix.normalize(src);
    if (normalized !== src || normalized.split('/').some(segment => segment === '..')) {
        throw new Error('Ein Medienpfad enthält ungültige Pfadbestandteile.');
    }
    return path.join(root, ...normalized.split('/'));
}

async function stageEncryptedFile(finalPath, bytes, stagedFiles) {
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    const temporaryPath = `${finalPath}.tmp-${randomUUID()}`;
    await fs.writeFile(temporaryPath, bytes, { flag: 'wx' });
    stagedFiles.push({ finalPath, temporaryPath });
}

async function commitStagedFiles(stagedFiles) {
    const committedFiles = [];
    try {
        for (const stagedFile of stagedFiles) {
            const backupPath = `${stagedFile.finalPath}.bak-${randomUUID()}`;
            let backedUp = false;
            try {
                await fs.rename(stagedFile.finalPath, backupPath);
                backedUp = true;
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            try {
                await fs.rename(stagedFile.temporaryPath, stagedFile.finalPath);
                committedFiles.push({ finalPath: stagedFile.finalPath, backupPath: backedUp ? backupPath : null });
            } catch (error) {
                if (backedUp) await fs.rename(backupPath, stagedFile.finalPath);
                throw error;
            }
        }
    } catch (error) {
        for (const committedFile of committedFiles.reverse()) {
            await fs.unlink(committedFile.finalPath);
            if (committedFile.backupPath) await fs.rename(committedFile.backupPath, committedFile.finalPath);
        }
        throw error;
    }
    return committedFiles;
}

async function encryptReferencedAsset(root, src, mimeType, key, stagedFiles, encryptedAssets, onEncrypted) {
    if (encryptedAssets.has(src)) return encryptedAssets.get(src);
    const target = safeRecipeAssetPath(root, src, src.startsWith('images/') ? 'images/recipes' : 'videos/recipes');
    const encryptedPath = `${target}.enc`;
    await fs.access(target);
    const bytes = await fs.readFile(target);
    const encrypted = await encryptAssetBytes(bytes, key);
    await stageEncryptedFile(encryptedPath, encrypted, stagedFiles);
    onEncrypted();
    const result = { src: `${src}.enc`, mimeType: mimeType || mimeTypeForPath(src) };
    encryptedAssets.set(src, result);
    return result;
}

async function listMediaFiles(directory, relativeDirectory = '') {
    let entries;
    try {
        entries = await fs.readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const files = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const relativePath = path.posix.join(relativeDirectory.replaceAll(path.sep, '/'), entry.name);
        if (entry.isDirectory()) files.push(...await listMediaFiles(directory, relativePath));
        else if (entry.isFile() && mimeTypes[path.extname(entry.name).toLowerCase()]) files.push(relativePath);
    }
    return files;
}

const plaintextBootstrapScripts = new Set([
    'scripts/encrypt-recipe-data.mjs',
    'scripts/decrypt-recipe-data.mjs'
]);

async function listDocumentFiles(root, directory, relativeDirectory = '') {
    let entries;
    try {
        entries = await fs.readdir(path.join(root, directory, relativeDirectory), { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const files = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const relativePath = path.posix.join(relativeDirectory.replaceAll(path.sep, '/'), entry.name);
        if (entry.isDirectory()) files.push(...await listDocumentFiles(root, directory, relativePath));
        else if (entry.isFile() && !entry.name.endsWith('.enc')) {
            const filename = path.posix.join(directory, relativePath);
            if (!plaintextBootstrapScripts.has(filename)) files.push(filename);
        }
    }
    return files;
}

function safeDocumentPath(root, filename) {
    if (typeof filename !== 'string' || !filename || filename.startsWith('/') || filename.includes('\\')) {
        throw new Error(`Ungültiger Dokumentpfad: ${filename}`);
    }
    const normalized = path.posix.normalize(filename);
    if (normalized !== filename || normalized.split('/').some(segment => segment === '..')) {
        throw new Error(`Ungültiger Dokumentpfad: ${filename}`);
    }
    return path.join(root, ...normalized.split('/'));
}

async function migrateRecipeData({
    root = rootDirectory,
    passphrase,
    recipesPath,
    documentFiles = [],
    deletePlaintext = false,
    onProgress = () => {}
} = {}) {
    if (typeof passphrase !== 'string' || passphrase.length < minimumPassphraseLength) {
        throw new Error(`Das Passwort muss mindestens ${minimumPassphraseLength} Zeichen lang sein.`);
    }
    const sourceRecipesPath = recipesPath || path.join(root, 'recipes.json');
    const destinationRecipesPath = path.join(root, 'recipes.enc');
    const sourceData = JSON.parse(await fs.readFile(sourceRecipesPath, 'utf8'));
    if (!Array.isArray(sourceData.recipes)) throw new Error('recipes.json enthält keine gültige Rezeptliste.');
    const salt = randomBytes(16);
    const key = await deriveKey(passphrase, salt);
    const encryptedAssets = new Map();
    const stagedFiles = [];
    let archiveCommitted = false;
    const recipes = structuredClone(sourceData.recipes);
    const mediaFiles = [];
    for (const directory of ['images/recipes', 'videos/recipes']) {
        for (const relativeFile of await listMediaFiles(path.join(root, directory))) {
            mediaFiles.push(`${directory}/${relativeFile.replaceAll(path.sep, '/')}`);
        }
    }
    const embeddedAssetCount = recipes.reduce((count, recipe) => {
        const imageCount = (Array.isArray(recipe.images) ? recipe.images : [])
            .filter(image => typeof image?.src === 'string' && image.src.startsWith('data:image/')).length;
        const videoCount = typeof recipe.video?.src === 'string' && recipe.video.src.startsWith('data:video/') ? 1 : 0;
        return count + imageCount + videoCount;
    }, 0);
    const total = recipes.length + mediaFiles.length + embeddedAssetCount + documentFiles.length + 1;
    let completed = 0;
    const advanceProgress = () => onProgress({ completed: ++completed, total });
    onProgress({ completed, total });
    try {
        for (const recipe of recipes) {
            for (const image of Array.isArray(recipe.images) ? recipe.images : []) {
                if (!image || typeof image.src !== 'string') continue;
                if (image.src.startsWith('data:image/')) {
                    const match = image.src.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
                    if (!match) throw new Error('Ein eingebettetes Rezeptbild hat ein ungültiges Format.');
                    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[match[1]];
                    const filename = `${randomUUID()}${extension}`;
                    const target = path.join(root, 'images', 'recipes', filename);
                    const encryptedPath = `${target}.enc`;
                    const encrypted = await encryptAssetBytes(Buffer.from(match[2], 'base64'), key);
                    await stageEncryptedFile(encryptedPath, encrypted, stagedFiles);
                    advanceProgress();
                    image.src = `images/recipes/${filename}.enc`;
                    image.mimeType = match[1];
                } else if (image.src.startsWith('images/recipes/')) {
                    const updated = await encryptReferencedAsset(root, image.src, image.mimeType, key, stagedFiles, encryptedAssets, advanceProgress);
                    Object.assign(image, updated);
                } else if (/^(?:https?:|blob:|data:)/i.test(image.src)) {
                    throw new Error('Externe Rezeptbilder müssen vor der Migration ins Repository importiert werden.');
                }
            }

            const video = recipe.video;
            if (typeof video?.src === 'string' && video.src.startsWith('data:video/')) {
                const match = video.src.match(/^data:(video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/=]+)$/);
                if (!match) throw new Error('Ein eingebettetes Rezeptvideo hat ein ungültiges Format.');
                const extension = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' }[match[1]];
                const filename = `${randomUUID()}${extension}`;
                const target = path.join(root, 'videos', 'recipes', filename);
                const encryptedPath = `${target}.enc`;
                const encrypted = await encryptAssetBytes(Buffer.from(match[2], 'base64'), key);
                await stageEncryptedFile(encryptedPath, encrypted, stagedFiles);
                advanceProgress();
                recipe.video = { src: `videos/recipes/${filename}.enc`, mimeType: match[1] };
            } else if (typeof video?.src === 'string' && video.src.startsWith('videos/recipes/')) {
                const updated = await encryptReferencedAsset(root, video.src, video.mimeType, key, stagedFiles, encryptedAssets, advanceProgress);
                recipe.video = { ...video, ...updated };
            } else if (typeof video?.src === 'string' && /^(?:https?:|blob:)/i.test(video.src)) {
                throw new Error('Externe Rezeptvideos müssen vor der Migration ins Repository importiert werden.');
            }
            advanceProgress();
        }

        for (const src of mediaFiles) {
            await encryptReferencedAsset(root, src, null, key, stagedFiles, encryptedAssets, advanceProgress);
        }

        for (const filename of documentFiles) {
            const sourcePath = safeDocumentPath(root, filename);
            const bytes = await fs.readFile(sourcePath);
            const encrypted = await encryptAssetBytes(bytes, key);
            await stageEncryptedFile(`${sourcePath}.enc`, encrypted, stagedFiles);
            advanceProgress();
        }

        const envelope = await encryptRecipeEnvelope(recipes, key, salt, randomUUID());
        await stageEncryptedFile(destinationRecipesPath, `${JSON.stringify(envelope)}\n`, stagedFiles);
        const committedFiles = await commitStagedFiles(stagedFiles);
        archiveCommitted = true;
        advanceProgress();
        if (deletePlaintext) {
            await fs.unlink(sourceRecipesPath);
            for (const src of mediaFiles) {
                await fs.unlink(safeRecipeAssetPath(root, src, src.startsWith('images/') ? 'images/recipes' : 'videos/recipes'));
            }
            for (const filename of documentFiles) {
                await fs.unlink(safeDocumentPath(root, filename));
            }
        }
        for (const committedFile of committedFiles) {
            if (committedFile.backupPath) await fs.unlink(committedFile.backupPath);
        }
        return {
            mediaFiles: stagedFiles.length - documentFiles.length - 1,
            documents: documentFiles.length,
            recipes: recipes.length
        };
    } catch (error) {
        if (!archiveCommitted) {
            for (const file of stagedFiles) {
                try { await fs.unlink(file.temporaryPath); } catch (cleanupError) {
                    if (cleanupError.code !== 'ENOENT') throw cleanupError;
                }
            }
        }
        throw error;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const deletePlaintext = args.includes('--delete-plaintext');
    const unknownArgs = args.filter(argument => argument !== '--delete-plaintext');
    if (unknownArgs.length) throw new Error(`Unbekannte Option: ${unknownArgs[0]}`);

    const configuredPassword = loadAppPassword();
    const first = configuredPassword || await readPassword('Passwort (mind. 20 Zeichen): ');
    const second = configuredPassword || await readPassword('Passwort wiederholen: ');
    if (first !== second) throw new Error('Die eingegebenen Passwörter stimmen nicht überein.');
    const confirmation = await new Promise(resolve => {
        process.stdout.write('Verschlüsselte Dateien erstellen? [j/N] ');
        process.stdin.once('data', data => {
            process.stdin.pause();
            resolve(data.toString('utf8').trim().toLowerCase());
        });
        process.stdin.resume();
    });
    if (!['j', 'ja', 'y', 'yes'].includes(confirmation)) {
        process.stdout.write('Abgebrochen; es wurde nichts geändert.\n');
        return;
    }
    if (deletePlaintext) {
        const deleteConfirmation = await new Promise(resolve => {
            process.stdout.write('ACHTUNG: Alle lokalen Klartext-Rezept- und Mediendateien löschen? [j/N] ');
            process.stdin.once('data', data => {
                process.stdin.pause();
                resolve(data.toString('utf8').trim().toLowerCase());
            });
            process.stdin.resume();
        });
        if (!['j', 'ja', 'y', 'yes'].includes(deleteConfirmation)) {
            process.stdout.write('Abgebrochen; die lokalen Klartextdateien wurden nicht gelöscht.\n');
            return;
        }
    }
    const progressBarWidth = 30;
    let progressDisplayed = false;
    let result;
    try {
        const documentFiles = [];
        try {
            await fs.access(path.join(rootDirectory, 'AGENTS.md'));
            documentFiles.push('AGENTS.md');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        documentFiles.push(...await listDocumentFiles(rootDirectory, 'server'));
        documentFiles.push(...await listDocumentFiles(rootDirectory, 'scripts'));
        result = await migrateRecipeData({
            passphrase: first,
            deletePlaintext,
            documentFiles,
            onProgress: ({ completed, total }) => {
                progressDisplayed = true;
                const percentage = total === 0 ? 100 : Math.floor(completed / total * 100);
                const filled = Math.round(percentage / 100 * progressBarWidth);
                const bar = `${'#'.repeat(filled)}${'-'.repeat(progressBarWidth - filled)}`;
                process.stdout.write(`\r[${bar}] ${percentage}% (${completed}/${total})`);
                if (completed === total) process.stdout.write('\n');
            }
        });
    } catch (error) {
        if (progressDisplayed) process.stdout.write('\n');
        throw error;
    }
    const plaintextMessage = deletePlaintext
        ? 'Die lokalen Klartext-Quelldateien wurden gelöscht.'
        : 'Die lokalen Klartext-Quelldateien blieben erhalten.';
    process.stdout.write(`Verschlüsselung abgeschlossen: ${result.recipes} Rezepte, ${result.mediaFiles} Mediendateien und ${result.documents} interne Dokumente. ${plaintextMessage}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(`Verschlüsselung fehlgeschlagen: ${error.message}`);
        process.exitCode = 1;
    });
}

export { migrateRecipeData };
