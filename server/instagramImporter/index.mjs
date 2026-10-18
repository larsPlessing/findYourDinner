import { getInstagramEmbedUrl, getInstagramVideoUrl, hasPostContent, isInstagramUrl } from './postUtils.mjs';
import { downloadPublicVideo } from './videoDownloader.mjs';
import { loadAuthenticatedInstagramPost } from './browserSession.mjs';

let browserQueue = Promise.resolve();

export { isInstagramUrl };

function isVideoPostUrl(source) {
    return /^\/(?:reel|tv)\//i.test(new URL(source).pathname);
}

function queueAuthenticatedLoad(source, loader) {
    const load = browserQueue.then(() => loader(source));
    browserQueue = load.then(() => undefined, () => undefined);
    return load;
}

/** Liest ein öffentliches Instagram-Posting und nutzt bei Bedarf eine lokale Browser-Sitzung. */
export async function fetchInstagramPost(source, { fetchImpl = fetch, authenticatedLoader = loadAuthenticatedInstagramPost } = {}) {
    if (!isInstagramUrl(source)) throw new Error('Der Instagram-Importer benötigt einen instagram.com-Link.');
    const expectedVideo = isVideoPostUrl(source);
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
    };
    let lastPublicError = null;
    let publicPost = null;
    let publicVideoFound = false;

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
                    publicVideoFound = true;
                    try {
                        video = await downloadPublicVideo(new URL(videoUrl, candidateUrl).href, fetchImpl);
                    } catch (error) {
                        console.warn(`Öffentliches Instagram-Video konnte nicht geladen werden: ${error.message}`);
                        lastPublicError = error;
                    }
                }
                publicPost ||= { html, url: response.url || candidateUrl, video };
                if (video) return { html, url: response.url || candidateUrl, video };
                if (!expectedVideo && !publicVideoFound) return publicPost;
                continue;
            }
            lastPublicError = new Error('Instagram lieferte keine auslesbaren Beitragsdaten.');
        } catch (error) {
            lastPublicError = error;
        }
    }

    try {
        const authenticatedPost = await queueAuthenticatedLoad(source, authenticatedLoader);
        if (authenticatedPost?.video) return authenticatedPost;
        if (expectedVideo || publicVideoFound) {
            throw new Error('Instagram hat kein abspielbares Video geliefert. Prüfe, ob der Beitrag abspielbar und dein Konto angemeldet ist.');
        }
        return publicPost || authenticatedPost;
    } catch (error) {
        if (error.message.includes('kein abspielbares Video geliefert')) throw error;
        if (publicPost && !expectedVideo && !publicVideoFound) return publicPost;
        const publicDetails = lastPublicError ? ` Anonymer Abruf: ${lastPublicError.message}` : '';
        throw new Error(`${error.message}${publicDetails}`, { cause: error });
    }
}
