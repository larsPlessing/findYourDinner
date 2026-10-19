export function isInstagramUrl(value) {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'instagram.com' || hostname === 'www.instagram.com';
}

export function htmlToText(html) {
    return html
        .replace(/<(script|style|noscript|nav|footer|header|svg)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

export function hasPostContent(html) {
    if (!html || /"pageID"\s*:\s*"httpErrorPage"|Sorry,\s*this page isn't available|content isn't available/i.test(html)) return false;
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    const descriptions = metaTags.flatMap(tag => {
        const key = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
        if (!['og:description', 'description', 'twitter:description'].includes(key)) return [];
        return [tag.match(/content=["']([^"']*)["']/i)?.[1] || ''];
    });
    const visibleText = htmlToText(html);
    const postText = [...descriptions, visibleText].join(' ');
    if (/Log in to Instagram|Log in to see photos|Sign up to see photos|create an account or log in|login_required/i.test(postText)) return false;
    return descriptions.some(description => description.length > 30)
        || visibleText.length > 100
        || /<video\b[^>]*>/i.test(html);
}

export function getInstagramEmbedUrl(source) {
    const url = new URL(source);
    const match = url.pathname.match(/^\/(reel|p|tv)\/([^/]+)/i);
    if (!match) throw new Error('Bitte gib einen Instagram-Reel- oder Beitragslink an.');
    return `https://${url.hostname}/${match[1]}/${match[2]}/embed/captioned/`;
}

export function getInstagramVideoUrl(html) {
    const value = html.match(/<meta\b[^>]*(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|twitter:player:stream)["'][^>]*>/i)?.[0]
        ?.match(/content=["']([^"']+)/i)?.[1];
    return value ? decodeHtmlAttribute(value) : null;
}

export function decodeHtmlAttribute(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}
