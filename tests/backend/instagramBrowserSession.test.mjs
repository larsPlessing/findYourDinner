import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { downloadBrowserVideo, readInstagramPageSnapshot } = await import('../../server/instagramImporter/browserSession.mjs');
const { downloadAuthenticatedVideo, downloadPublicVideo } = await import('../../server/instagramImporter/videoDownloader.mjs');
const { fetchInstagramPost } = await import('../../server/instagramImporter/index.mjs');
const { getInstagramEmbedUrl, getInstagramVideoUrl } = await import('../../server/instagramImporter/postUtils.mjs');

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

test('octet-stream video response is accepted when the media URL ends in mp4', async () => {
    const video = await downloadPublicVideo(
        'https://scontent.cdninstagram.com/video.mp4?signature=test',
        async () => new Response(Buffer.from('abcd'), {
            headers: { 'Content-Type': 'application/octet-stream' }
        })
    );

    assert.equal(video.mimeType, 'video/mp4');
    assert.equal(Buffer.from(video.data, 'base64').toString(), 'abcd');
});

test('authenticated octet-stream video uses its URL extension to infer the media type', async () => {
    const context = {
        request: {
            get: async () => ({
                ok: () => true,
                headers: () => ({ 'content-type': 'application/octet-stream', 'content-length': '4' }),
                body: async () => Buffer.from('abcd')
            })
        }
    };

    const video = await downloadAuthenticatedVideo(context, 'https://scontent.cdninstagram.com/video.mp4?signature=test');

    assert.equal(video.mimeType, 'video/mp4');
});

test('Instagram-Video-URLs decodieren HTML-Entities in signierten Querystrings', () => {
    assert.equal(
        getInstagramVideoUrl('<meta property="og:video" content="https://cdn.instagram.test/video.mp4?x=1&amp;oe=2">'),
        'https://cdn.instagram.test/video.mp4?x=1&oe=2'
    );
});

test('Instagram-Seitensnapshot wartet nach zerstörtem Ausführungskontext und setzt den Abruf fort', async () => {
    let attempts = 0;
    let waited = 0;
    const page = {
        async evaluate() {
            attempts++;
            if (attempts === 1) throw new Error('Execution context was destroyed');
            return { html: '<html>Rezept</html>', videoUrl: null };
        },
        async waitForTimeout(milliseconds) { waited += milliseconds; }
    };

    assert.equal(await readInstagramPageSnapshot(page), null);
    assert.equal(waited, 1000);
    assert.deepEqual(await readInstagramPageSnapshot(page), { html: '<html>Rezept</html>', videoUrl: null });
    assert.equal(attempts, 2);
});

test('Instagram-Seitensnapshot wirft unerwartete Fehler erneut', async () => {
    const page = {
        async evaluate() { throw new Error('Browser process crashed'); },
        async waitForTimeout() { assert.fail('unexpected errors must not be swallowed'); }
    };

    await assert.rejects(readInstagramPageSnapshot(page), /Browser process crashed/);
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

test('Instagram-Embed-URLs akzeptieren Nutzerpfade und normalisieren reels', () => {
    assert.equal(getInstagramEmbedUrl('https://www.instagram.com/foodie/reels/AbC123/?x=1'), 'https://www.instagram.com/reel/AbC123/embed/captioned/');
    assert.equal(getInstagramEmbedUrl('https://www.instagram.com/share/reel/AbC123/'), 'https://www.instagram.com/reel/AbC123/embed/captioned/');
});

test('Instagram-Share-Links werden vor dem Embed-Abruf weitergeleitet', async () => {
    const source = 'https://www.instagram.com/share/reel/AbC123/';
    const resolved = 'https://www.instagram.com/foodie/reel/AbC123/';
    const calls = [];
    const result = await fetchInstagramPost(source, {
        fetchImpl: async input => {
            const url = String(input);
            calls.push(url);
            if (url === source) return { ok: true, url: resolved, text: async () => '' };
            if (url === 'https://www.instagram.com/reel/AbC123/embed/captioned/') {
                return new Response('<html><meta property="og:description" content="A complete recipe caption with enough detail to describe the dish and its preparation steps."></html>');
            }
            if (url === resolved) return new Response('<html></html>');
            throw new Error(`Unexpected URL: ${url}`);
        },
        authenticatedLoader: async () => ({ html: '<html></html>', url: resolved, video: null }),
        ytDlpDownloader: async () => ({ mimeType: 'video/mp4', data: 'd28=' })
    });

    assert.equal(calls[0], source);
    assert.equal(calls[1], 'https://www.instagram.com/reel/AbC123/embed/captioned/');
    assert.equal(result.video.mimeType, 'video/mp4');
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
