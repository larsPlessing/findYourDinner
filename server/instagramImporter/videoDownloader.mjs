const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

function validateInstagramVideoUrl(value, baseUrl) {
    const url = new URL(value, baseUrl);
    const hostname = url.hostname.toLowerCase();
    const isInstagramMediaHost = hostname === 'instagram.com'
        || hostname.endsWith('.instagram.com')
        || hostname.endsWith('.cdninstagram.com')
        || hostname.endsWith('.fbcdn.net');
    if (url.protocol !== 'https:' || !isInstagramMediaHost) {
        throw new Error('Instagram hat eine ungültige Videoquelle geliefert.');
    }
    return url.href;
}

function validateVideoMimeType(mimeType, videoUrl) {
    if (mimeType === 'application/octet-stream') {
        const extension = new URL(videoUrl).pathname.match(/\.(mp4|webm|mov)$/i)?.[1]?.toLowerCase();
        const inferredMimeType = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }[extension];
        if (inferredMimeType) return inferredMimeType;
    }
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(mimeType)) {
        throw new Error('Das Instagram-Video hat ein nicht unterstütztes Format.');
    }
    return mimeType;
}

export async function downloadPublicVideo(url, fetchImpl) {
    url = validateInstagramVideoUrl(url, 'https://www.instagram.com');
    let response;
    for (let redirects = 0; redirects <= 10; redirects++) {
        response = await fetchImpl(url, { redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location || redirects === 10) throw new Error('Instagram hat zu viele oder ungültige Video-Weiterleitungen geliefert.');
        await response.body?.cancel();
        url = validateInstagramVideoUrl(location, url);
    }
    if (!response.ok) throw new Error(`Instagram-Video nicht abrufbar (HTTP ${response.status}).`);
    const mimeType = validateVideoMimeType(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(), url);

    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > MAX_VIDEO_BYTES) throw new Error('Das Instagram-Video ist größer als 20 MB.');
    const chunks = [];
    let totalBytes = 0;
    if (response.body) {
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_VIDEO_BYTES) {
                await reader.cancel();
                throw new Error('Das Instagram-Video ist größer als 20 MB.');
            }
            chunks.push(Buffer.from(value));
        }
    } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        totalBytes = buffer.length;
        if (totalBytes > MAX_VIDEO_BYTES) throw new Error('Das Instagram-Video ist größer als 20 MB.');
        chunks.push(buffer);
    }
    if (!totalBytes) throw new Error('Das Instagram-Video ist leer.');
    return { mimeType, data: Buffer.concat(chunks).toString('base64') };
}

export async function downloadAuthenticatedVideo(context, videoUrl) {
    videoUrl = validateInstagramVideoUrl(videoUrl, 'https://www.instagram.com');
    const response = await context.request.get(videoUrl, { timeout: 30000 });
    if (!response.ok()) throw new Error(`Instagram-Video nicht abrufbar (HTTP ${response.status()}).`);
    const mimeType = validateVideoMimeType(
        response.headers()['content-type']?.split(';')[0].trim().toLowerCase(),
        videoUrl
    );
    const contentLength = Number(response.headers()['content-length']);
    if (contentLength > MAX_VIDEO_BYTES) throw new Error('Das Instagram-Video ist größer als 20 MB.');
    const body = await response.body();
    if (!body.length) throw new Error('Das Instagram-Video ist leer.');
    if (body.length > MAX_VIDEO_BYTES) throw new Error('Das Instagram-Video ist größer als 20 MB.');
    return { mimeType, data: body.toString('base64') };
}
