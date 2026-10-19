import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    decodeBase64,
    decryptAssetBytes,
    decryptRecipeEnvelope,
    deriveKey,
    plainSrcForEncryptedSrc
} from '../js/recipeCrypto.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

async function listEncryptedMedia(directory, relativeDirectory = '') {
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
        if (entry.isDirectory()) {
            files.push(...await listEncryptedMedia(directory, relativePath));
        } else if (entry.isFile() && entry.name.endsWith('.enc')) {
            files.push(relativePath);
        }
    }
    return files;
}

async function listEncryptedDocuments(root, relativeDirectory = '') {
    const directory = path.join(root, 'server', relativeDirectory);
    let entries;
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const files = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const relativePath = path.posix.join(relativeDirectory.replaceAll(path.sep, '/'), entry.name);
        if (entry.isDirectory()) files.push(...await listEncryptedDocuments(root, relativePath));
        else if (entry.isFile() && entry.name.endsWith('.enc')) {
            files.push(`server/${relativePath.slice(0, -'.enc'.length)}`);
        }
    }
    return files;
}

async function restoreEncryptedFiles({ root = rootDirectory, passphrase, overwrite = false, onProgress = () => {} } = {}) {
    if (typeof passphrase !== 'string' || passphrase.length < minimumPassphraseLength) {
        throw new Error(`Das Passwort muss mindestens ${minimumPassphraseLength} Zeichen lang sein.`);
    }

    const envelopePath = path.join(root, 'recipes.enc');
    const envelope = JSON.parse(await fs.readFile(envelopePath, 'utf8'));
    if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'AES-GCM'
        || envelope.kdf !== 'PBKDF2-SHA-256' || !Number.isInteger(envelope.iterations)
        || envelope.iterations < 600_000 || typeof envelope.salt !== 'string') {
        throw new Error('Die verschlüsselte Rezeptdatei hat ein ungültiges Format.');
    }
    const key = await deriveKey(passphrase, decodeBase64(envelope.salt), envelope.iterations);
    const recipes = await decryptRecipeEnvelope(envelope, key);
    if (!Array.isArray(recipes)) throw new Error('Die entschlüsselte Datei enthält keine gültige Rezeptliste.');
    const documentFiles = [];
    try {
        await fs.access(path.join(root, 'AGENTS.md.enc'));
        documentFiles.push('AGENTS.md');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    documentFiles.push(...await listEncryptedDocuments(root));

    const mediaFiles = [];
    for (const directory of ['images/recipes', 'videos/recipes']) {
        for (const relativePath of await listEncryptedMedia(path.join(root, directory))) {
            mediaFiles.push(`${directory}/${relativePath.replaceAll(path.sep, '/')}`);
        }
    }

    const mediaMimeType = new Map();
    for (const recipe of recipes) {
        for (const image of Array.isArray(recipe.images) ? recipe.images : []) {
            if (typeof image?.src === 'string' && image.src.endsWith('.enc') && typeof image.mimeType === 'string') {
                mediaMimeType.set(image.src, image.mimeType);
            }
        }
        if (typeof recipe.video?.src === 'string' && recipe.video.src.endsWith('.enc') && typeof recipe.video.mimeType === 'string') {
            mediaMimeType.set(recipe.video.src, recipe.video.mimeType);
        }
    }

    const outputFiles = [];
    const decryptedMediaPaths = new Map();
    for (const src of mediaFiles) {
        const encryptedPath = path.join(root, ...src.split('/'));
        const plainSrc = plainSrcForEncryptedSrc(src, mediaMimeType.get(src));
        const plainPath = path.join(root, ...plainSrc.split('/'));
        const mimeType = mediaMimeType.get(src);
        const blob = await decryptAssetBytes(await fs.readFile(encryptedPath), key, mimeType);
        outputFiles.push({ path: plainPath, bytes: new Uint8Array(await blob.arrayBuffer()) });
        decryptedMediaPaths.set(src, plainSrc);
    }

    for (const recipe of recipes) {
        for (const image of Array.isArray(recipe.images) ? recipe.images : []) {
            if (typeof image?.src !== 'string' || !image.src.endsWith('.enc')) continue;
            if (!decryptedMediaPaths.has(image.src)) throw new Error(`Verschlüsseltes Rezeptbild fehlt: ${image.src}`);
            image.src = decryptedMediaPaths.get(image.src);
        }
        if (typeof recipe.video?.src === 'string' && recipe.video.src.endsWith('.enc')) {
            if (!decryptedMediaPaths.has(recipe.video.src)) throw new Error(`Verschlüsseltes Rezeptvideo fehlt: ${recipe.video.src}`);
            recipe.video.src = decryptedMediaPaths.get(recipe.video.src);
        }
    }

    for (const filename of documentFiles) {
        const encryptedPath = path.join(root, ...`${filename}.enc`.split('/'));
        const blob = await decryptAssetBytes(await fs.readFile(encryptedPath), key, 'text/markdown');
        outputFiles.push({ path: path.join(root, filename), bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    outputFiles.push({
        path: path.join(root, 'recipes.json'),
        bytes: Buffer.from(`${JSON.stringify({ version: 1, recipes }, null, 2)}\n`, 'utf8')
    });

    if (!overwrite) {
        for (const outputFile of outputFiles) {
            try {
                await fs.access(outputFile.path);
                throw new Error(`Die lokale Datei existiert bereits: ${path.relative(root, outputFile.path)}. Nutze --overwrite, um sie zu ersetzen.`);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    }

    const stagedFiles = [];
    try {
        for (const outputFile of outputFiles) {
            await fs.mkdir(path.dirname(outputFile.path), { recursive: true });
            const temporaryPath = `${outputFile.path}.tmp-${crypto.randomUUID()}`;
            await fs.writeFile(temporaryPath, outputFile.bytes, { flag: 'wx' });
            stagedFiles.push({ ...outputFile, temporaryPath });
            onProgress({ completed: stagedFiles.length, total: outputFiles.length });
        }
    } catch (error) {
        for (const stagedFile of stagedFiles) {
            try { await fs.unlink(stagedFile.temporaryPath); } catch (cleanupError) {
                if (cleanupError.code !== 'ENOENT') throw cleanupError;
            }
        }
        throw error;
    }

    const committedFiles = [];
    try {
        for (const stagedFile of stagedFiles) {
            let backupPath = null;
            if (overwrite) {
                backupPath = `${stagedFile.path}.bak-${crypto.randomUUID()}`;
                try {
                    await fs.rename(stagedFile.path, backupPath);
                } catch (error) {
                    if (error.code === 'ENOENT') backupPath = null;
                    else throw error;
                }
            }
            try {
                await fs.rename(stagedFile.temporaryPath, stagedFile.path);
                committedFiles.push({ path: stagedFile.path, backupPath });
            } catch (error) {
                if (backupPath) await fs.rename(backupPath, stagedFile.path);
                throw error;
            }
        }
    } catch (error) {
        for (const committedFile of committedFiles.reverse()) {
            await fs.unlink(committedFile.path);
            if (committedFile.backupPath) await fs.rename(committedFile.backupPath, committedFile.path);
        }
        for (const stagedFile of stagedFiles) {
            try { await fs.unlink(stagedFile.temporaryPath); } catch (cleanupError) {
                if (cleanupError.code !== 'ENOENT') throw cleanupError;
            }
        }
        throw error;
    }
    for (const committedFile of committedFiles) {
        if (committedFile.backupPath) await fs.unlink(committedFile.backupPath);
    }
    return { recipes: recipes.length, mediaFiles: mediaFiles.length, documents: documentFiles.length, files: outputFiles.length };
}

async function main() {
    const args = process.argv.slice(2);
    const overwrite = args.includes('--overwrite');
    const unknownArgs = args.filter(argument => argument !== '--overwrite');
    if (unknownArgs.length) throw new Error(`Unbekannte Option: ${unknownArgs[0]}`);
    const passphrase = loadAppPassword() || await readPassword('Passwort: ');
    const progressBarWidth = 30;
    let progressDisplayed = false;
    let result;
    try {
        result = await restoreEncryptedFiles({
            passphrase,
            overwrite,
            onProgress: ({ completed, total }) => {
                progressDisplayed = true;
                const percentage = Math.floor(completed / total * 100);
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
    process.stdout.write(`Entschlüsselung abgeschlossen: ${result.recipes} Rezepte, ${result.mediaFiles} Mediendateien und ${result.documents} interne Dokumente lokal wiederhergestellt.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(`Entschlüsselung fehlgeschlagen: ${error.message}`);
        process.exitCode = 1;
    });
}

export { restoreEncryptedFiles };
