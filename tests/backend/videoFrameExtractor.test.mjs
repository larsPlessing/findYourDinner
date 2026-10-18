import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const { test } = require('node:test');

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        const stderr = [];
        child.stderr.on('data', chunk => stderr.push(chunk));
        child.once('error', reject);
        child.once('close', code => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(Buffer.concat(stderr).toString('utf8')));
        });
    });
}

test('extracts chronologically distributed JPEG frames from video for Gemini', async () => {
    const { extractVideoFrames } = await import('../../server/instagramImporter/videoFrameExtractor.mjs');
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'find-dinner-video-test-'));
    const videoPath = path.join(temporaryDirectory, 'sample.mp4');

    try {
        await runFfmpeg([
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10',
            '-t', '3', '-pix_fmt', 'yuv420p', '-y', videoPath
        ]);
        const frames = await extractVideoFrames({
            mimeType: 'video/mp4',
            data: (await readFile(videoPath)).toString('base64')
        });

        assert.equal(frames.length, 3);
        assert.ok(frames.every(frame => frame.mimeType === 'image/jpeg' && frame.data.length > 0));
        assert.deepEqual(frames.map(frame => frame.timestampSeconds), [...frames.map(frame => frame.timestampSeconds)].sort((a, b) => a - b));
        assert.ok(frames.at(-1).timestampSeconds < 3);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});
