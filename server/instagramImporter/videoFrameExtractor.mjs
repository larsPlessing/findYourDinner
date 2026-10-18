import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const MAX_FRAMES = 24;
const MAX_FRAME_BYTES = 12 * 1024 * 1024;

function run(program, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(program, args, { windowsHide: true });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', chunk => stdout.push(chunk));
        child.stderr.on('data', chunk => stderr.push(chunk));
        child.once('error', reject);
        child.once('close', code => {
            if (code === 0) {
                resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
                return;
            }
            reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `${path.basename(program)} wurde mit Code ${code} beendet.`));
        });
    });
}

function videoExtension(mimeType) {
    return {
        'video/mp4': '.mp4',
        'video/webm': '.webm',
        'video/quicktime': '.mov'
    }[mimeType];
}

/** Extrahiert repräsentative, zeitlich verteilte Videobilder für die Analyse durch Gemini. */
export async function extractVideoFrames({ mimeType, data }) {
    const extension = videoExtension(mimeType);
    if (!extension) throw new Error('Das Instagram-Video hat ein nicht unterstütztes Format.');
    if (!ffmpegPath || !ffprobeStatic.path) throw new Error('FFmpeg oder ffprobe ist für die lokale Videoverarbeitung nicht verfügbar.');

    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'find-your-dinner-video-'));
    const videoPath = path.join(temporaryDirectory, `instagram${extension}`);
    const outputPattern = path.join(temporaryDirectory, 'frame-%03d.jpg');

    try {
        await writeFile(videoPath, Buffer.from(data, 'base64'));
        const probe = await run(ffprobeStatic.path, [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            videoPath
        ]);
        const duration = Number.parseFloat(probe.stdout.trim());
        if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error('Die Videolänge konnte nicht ermittelt werden.');
        }
        const frameCount = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(duration)));

        await run(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-i', videoPath,
            '-vf', `fps=${frameCount}/${duration},scale=1024:1024:force_original_aspect_ratio=decrease:force_divisible_by=2`,
            '-frames:v', String(frameCount),
            '-q:v', '3',
            outputPattern
        ]);

        const frameFiles = (await readdir(temporaryDirectory))
            .filter(file => /^frame-\d+\.jpg$/.test(file))
            .sort();
        if (!frameFiles.length) throw new Error('Aus dem Instagram-Video konnten keine Bilder extrahiert werden.');

        const frames = [];
        let totalFrameBytes = 0;
        for (const [index, file] of frameFiles.entries()) {
            const frame = await readFile(path.join(temporaryDirectory, file));
            totalFrameBytes += frame.length;
            if (totalFrameBytes > MAX_FRAME_BYTES) {
                throw new Error('Die extrahierten Videobilder überschreiten das Größenlimit für die Gemini-Anfrage.');
            }
            frames.push({
                mimeType: 'image/jpeg',
                data: frame.toString('base64'),
                timestampSeconds: Math.round(index * duration / frameFiles.length * 10) / 10
            });
        }
        return frames;
    } catch (error) {
        throw new Error(`Instagram-Video konnte lokal nicht für Gemini vorbereitet werden: ${error.message}`, { cause: error });
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
}
