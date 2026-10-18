import { getInstagramEmbedUrl, getInstagramVideoUrl, hasPostContent, isInstagramUrl } from './postUtils.mjs';
import { downloadPublicVideo } from './videoDownloader.mjs';
import { loadAuthenticatedInstagramPost } from './browserSession.mjs';

let browserQueue = Promise.resolve();

export { isInstagramUrl };

function queueAuthenticatedLoad(source, loader) {
    const load = browserQueue.then(() => loader(source));
    browserQueue = load.then(() => undefined, () => undefined);
    return load;
}

/** Liest ein öffentliches Instagram-Posting und nutzt bei Bedarf eine lokale Browser-Sitzung. */
export async function fetchInstagramPost(source, { fetchImpl = fetch, authenticatedLoader = loadAuthenticatedInstagramPost } = {}) {
    if (!isInstagramUrl(source)) throw new Error('Der Instagram-Importer benötigt einen instagram.com-Link.');
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
    };
    let lastPublicError = null;

    for (const candidateUrl of [getInstagramEmbedUrl(source), source]) {
        try {
            const response = await fetchImpl(candidateUrl, { redirect: 'follow', headers });
            if (!response.ok) {
                lastPublicError = new Error(`HTTP ${response.status}`);
                continue;
            }
            const html = await response.text();
            if (hasPostContent(html)) {
                let video = null;
                const videoUrl = getInstagramVideoUrl(html);
                if (videoUrl) {
                    try {
                        video = await downloadPublicVideo(new URL(videoUrl, candidateUrl).href, fetchImpl);
                    } catch (error) {
                        console.warn(`Öffentliches Instagram-Video konnte nicht geladen werden: ${error.message}`);
                    }
                }
                return { html, url: response.url || candidateUrl, video };
            }
            lastPublicError = new Error('Instagram lieferte keine auslesbaren Beitragsdaten.');
        } catch (error) {
            lastPublicError = error;
        }
    }

    try {
        return await queueAuthenticatedLoad(source, authenticatedLoader);
    } catch (error) {
        const publicDetails = lastPublicError ? ` Anonymer Abruf: ${lastPublicError.message}` : '';
        throw new Error(`${error.message}${publicDetails}`, { cause: error });
    }
}
