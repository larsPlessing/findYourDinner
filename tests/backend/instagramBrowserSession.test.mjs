import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { downloadBrowserVideo } = await import('../../server/instagramImporter/browserSession.mjs');
const { downloadPublicVideo } = await import('../../server/instagramImporter/videoDownloader.mjs');
const { fetchInstagramPost } = await import('../../server/instagramImporter/index.mjs');

function createContextStub() {
    return {
        request: {
            get: async () => ({
                ok: () => true,
                headers: () => ({ 'content-type': 'video/mp4', 'content-length': '4' }),
                body: async () => Buffer.from('abcd')
            })
        }
    };
}

test('blob:-Videoquelle aus currentSrc bricht den Browser-Abruf nicht ab', async () => {
    const video = await downloadBrowserVideo(createContextStub(), 'blob:https://www.instagram.com/9f1c-abc');
    assert.equal(video, null);
});

test('echte Instagram-Media-URL wird weiterhin geladen', async () => {
    const video = await downloadBrowserVideo(createContextStub(), 'https://scontent.cdninstagram.com/v/video.mp4');
    assert.equal(video.mimeType, 'video/mp4');
    assert.equal(Buffer.from(video.data, 'base64').toString(), 'abcd');
});

test('ohne Browser-Video (blob:-Fallback) wird yt-dlp als Fallback versucht', async () => {
    const source = 'https://www.instagram.com/reel/AbC123/';
    let ytDlpTried = false;
    const result = await fetchInstagramPost(source, {
        fetchImpl: async () => new Response('', { status: 404 }),
        authenticatedLoader: async () => ({ html: '<html></html>', url: source, video: null }),
        ytDlpDownloader: async () => {
            ytDlpTried = true;
            return { mimeType: 'video/mp4', data: 'd28=' };
        }
    });
    assert.equal(ytDlpTried, true);
    assert.equal(result.video.mimeType, 'video/mp4');
    assert.equal(result.url, source);
});

test('öffentliche Video-Weiterleitungen werden vor dem Abruf erneut gegen Instagram-Hosts geprüft', async () => {
    let fetchCount = 0;
    await assert.rejects(downloadPublicVideo('https://scontent.cdninstagram.com/video.mp4', async () => {
        fetchCount++;
        return new Response(null, {
            status: 302,
            headers: { Location: 'https://example.com/video.mp4' }
        });
    }), /ungültige Videoquelle/);
    assert.equal(fetchCount, 1, 'the redirected non-Instagram host must not be requested');
});
