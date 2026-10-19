import { getInstagramEmbedUrl, getInstagramVideoUrl, hasPostContent, isInstagramUrl } from './postUtils.mjs';
import { downloadPublicVideo } from './videoDownloader.mjs';
import { loadAuthenticatedInstagramPost } from './browserSession.mjs';
import { downloadInstagramVideoWithYtDlp } from './ytDlpDownloader.mjs';

let browserQueue = Promise.resolve();

export { isInstagramUrl };

const MISSING_VIDEO_WARNING = 'Für diesen Instagram-Beitrag wurde kein abspielbares Video gefunden. Das Rezept wurde nur anhand der verfügbaren Beschreibung importiert.';

function isVideoPostUrl(source) {
    try {
        return /\/(?:reels?|tv)\/[^/?#]+/i.test(new URL(source).pathname);
    } catch {
        return false;
    }
}

function isShareUrl(source) {
    try {
        return /\/share\//i.test(new URL(source).pathname);
    } catch {
        return false;
    }
}

function queueAuthenticatedLoad(source, loader) {
    const load = browserQueue.then(() => loader(source));
    browserQueue = load.then(() => undefined, () => undefined);
    return load;
}

async function tryYtDlpDownload(source, downloader) {
    try {
        return await downloader(source);
    } catch (error) {
        console.warn(`Instagram-Video konnte nicht mit yt-dlp geladen werden: ${error.message}`);
        return null;
    }
}

/** Liest ein öffentliches Instagram-Posting und nutzt bei Bedarf eine lokale Browser-Sitzung. */
export async function fetchInstagramPost(source, {
    fetchImpl = fetch,
    authenticatedLoader = loadAuthenticatedInstagramPost,
    ytDlpDownloader = downloadInstagramVideoWithYtDlp
} = {}) {
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

    let candidateUrls = [getInstagramEmbedUrl(source), source];
    if (isShareUrl(source)) {
        try {
            const redirectResponse = await fetchImpl(source, { redirect: 'follow', headers });
            const resolvedUrl = redirectResponse.url || source;
            if (resolvedUrl !== source) candidateUrls = [getInstagramEmbedUrl(resolvedUrl), resolvedUrl];
        } catch (error) {
            lastPublicError = error;
        }
    }

    for (const candidateUrl of candidateUrls) {
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
            const post = authenticatedPost || publicPost;
            const video = await tryYtDlpDownload(source, ytDlpDownloader);
            if (post && video) return { ...post, video };
            if (post) {
                console.warn(MISSING_VIDEO_WARNING);
                return { ...post, warnings: [MISSING_VIDEO_WARNING] };
            }
        }
        return publicPost || authenticatedPost;
    } catch (error) {
        if (publicPost && (expectedVideo || publicVideoFound)) {
            const video = await tryYtDlpDownload(source, ytDlpDownloader);
            if (video) return { ...publicPost, video };
            console.warn(MISSING_VIDEO_WARNING);
            return { ...publicPost, warnings: [MISSING_VIDEO_WARNING] };
        }
        if (publicPost && !expectedVideo && !publicVideoFound) return publicPost;
        const publicDetails = lastPublicError ? ` Anonymer Abruf: ${lastPublicError.message}` : '';
        throw new Error(`${error.message}${publicDetails}`, { cause: error });
    }
}
