import path from 'node:path';
import os from 'node:os';
import { hasPostContent } from './postUtils.mjs';
import { downloadAuthenticatedVideo } from './videoDownloader.mjs';

const INSTAGRAM_USER_DATA_DIRECTORY = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'),
    'find-your-dinner',
    'instagram-session'
);

/** Lädt einen Beitrag in einer sichtbaren, persistenten lokalen Instagram-Sitzung. */
export async function loadAuthenticatedInstagramPost(source) {
    let chromium;
    try {
        ({ chromium } = await import('playwright'));
    } catch (error) {
        throw new Error(`Playwright konnte nicht geladen werden. Installiere Abhängigkeiten mit „npm install“ und Chromium mit „npm run install:instagram-browser“. Details: ${error.message}`);
    }

    let context;
    try {
        context = await chromium.launchPersistentContext(INSTAGRAM_USER_DATA_DIRECTORY, {
            headless: false,
            viewport: { width: 1280, height: 900 }
        });
    } catch (error) {
        throw new Error(`Der Instagram-Browser konnte nicht gestartet werden. Installiere Chromium mit „npm run install:instagram-browser“. Details: ${error.message}`);
    }

    try {
        const page = context.pages()[0] || await context.newPage();
        try {
            await page.goto(source, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (error) {
            throw new Error(`Instagram konnte im lokalen Browser nicht geöffnet werden: ${error.message}`);
        }
        const deadline = Date.now() + 180000;
        let html = '';
        let finalUrl = source;
        let videoUrl = null;
        while (Date.now() < deadline) {
            finalUrl = page.url();
            const snapshot = await page.evaluate(() => ({
                html: document.documentElement?.outerHTML || '',
                videoUrl: document.querySelector('video')?.currentSrc || document.querySelector('video')?.src || null
            }));
            html = snapshot.html;
            videoUrl = snapshot.videoUrl;
            if (!/\/accounts\/login(?:\/|$)/i.test(new URL(finalUrl).pathname) && (hasPostContent(html) || videoUrl)) break;
            await page.waitForTimeout(1000);
        }

        if (/\/accounts\/login(?:\/|$)/i.test(new URL(finalUrl).pathname) || (!hasPostContent(html) && !videoUrl)) {
            throw new Error('Instagram hat den Beitrag im angemeldeten Browser nicht angezeigt. Melde dich im geöffneten Instagram-Fenster an, akzeptiere gegebenenfalls den Cookie-Hinweis und versuche den Link erneut.');
        }

        let video = null;
        if (videoUrl) {
            video = await downloadAuthenticatedVideo(context, videoUrl);
        }
        return { html, url: finalUrl, video };
    } finally {
        await context.close();
    }
}
