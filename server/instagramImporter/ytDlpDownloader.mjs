import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import youtubeDl from 'youtube-dl-exec';
import { INSTAGRAM_USER_DATA_DIRECTORY } from './browserSession.mjs';
import { isInstagramUrl } from './postUtils.mjs';

const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const VIDEO_MIME_TYPES = new Map([
    ['.mp4', 'video/mp4'],
    ['.webm', 'video/webm'],
    ['.mov', 'video/quicktime']
]);

function validateInstagramSource(source) {
    const url = new URL(source);
    if (url.protocol !== 'https:' || !isInstagramUrl(url.href)) {
        throw new Error('Der Video-Downloader akzeptiert nur HTTPS-Links von instagram.com.');
    }
    return url.href;
}

/** Lädt ein Instagram-Video mit yt-dlp und dem lokalen Instagram-Browserprofil. */
export async function downloadInstagramVideoWithYtDlp(source) {
    source = validateInstagramSource(source);
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'find-your-dinner-yt-dlp-'));
    const outputTemplate = path.join(temporaryDirectory, 'instagram.%(ext)s');

    try {
        await youtubeDl.exec(source, {
            noPlaylist: true,
            format: 'best[filesize<20M]/best',
            maxFilesize: '20M',
            output: outputTemplate,
            restrictFilenames: true,
            cookiesFromBrowser: `chromium:${INSTAGRAM_USER_DATA_DIRECTORY}`
        }, {
            timeout: DOWNLOAD_TIMEOUT_MS,
            windowsHide: true
        });

        const files = await fs.readdir(temporaryDirectory, { withFileTypes: true });
        const videoFiles = files.filter(file => file.isFile() && VIDEO_MIME_TYPES.has(path.extname(file.name).toLowerCase()));
        if (videoFiles.length !== 1) throw new Error('yt-dlp hat keine einzelne unterstützte Videodatei erstellt.');

        const videoPath = path.join(temporaryDirectory, videoFiles[0].name);
        const video = await fs.readFile(videoPath);
        if (!video.length) throw new Error('yt-dlp hat ein leeres Video erstellt.');
        if (video.length > MAX_VIDEO_BYTES) throw new Error('Das Instagram-Video ist größer als 20 MB.');

        return {
            mimeType: VIDEO_MIME_TYPES.get(path.extname(videoPath).toLowerCase()),
            data: video.toString('base64')
        };
    } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
}
