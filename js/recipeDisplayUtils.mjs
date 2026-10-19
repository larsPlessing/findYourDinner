export function applyImageTransform(imgElement, transform) {
    if (!transform) return;

    const transforms = [];
    if (transform.rotation && transform.rotation !== 0) transforms.push(`rotate(${transform.rotation}deg)`);

    const scaleX = transform.flipH ? -1 : 1;
    const scaleY = transform.flipV ? -1 : 1;
    if (scaleX !== 1 || scaleY !== 1) transforms.push(`scale(${scaleX}, ${scaleY})`);
    if (transforms.length) imgElement.style.transform = transforms.join(' ');

    if (transform.crop && (transform.crop.left > 0 || transform.crop.top > 0
        || transform.crop.right > 0 || transform.crop.bottom > 0)) {
        const { left, top, right, bottom } = transform.crop;
        imgElement.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
    }
}

export function generatePlaceholderImage(recipeName, emoji, { size = 400, nameLimit = 25 } = {}) {
    const hash = recipeName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colors = [
        ['#667eea', '#764ba2'], ['#f093fb', '#f5576c'], ['#4facfe', '#00f2fe'],
        ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'], ['#30cfd0', '#330867'],
        ['#a8edea', '#fed6e3'], ['#ff9a56', '#ff6a88']
    ];
    const colorPair = colors[hash % colors.length];
    const displayName = recipeName.length > nameLimit ? `${recipeName.substring(0, nameLimit - 3)}...` : recipeName;
    const safeDisplayName = displayName.replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[character]);
    const center = size / 2;
    const svg = `
        <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${colorPair[0]};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${colorPair[1]};stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="${size}" height="${size}" fill="url(#grad${hash})"/>
            <text x="${center}" y="${center - 20}" font-size="${size * 0.3}" text-anchor="middle" fill="white" opacity="0.9">${emoji}</text>
            <text x="${center}" y="${center + size * 0.2}" font-size="${size * 0.06}" text-anchor="middle" fill="white" font-weight="600" opacity="0.95">${safeDisplayName}</text>
        </svg>
    `;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

export function getRecipeEmoji(recipeName) {
    const name = recipeName.toLocaleLowerCase('de');
    const hasWord = word => new RegExp(`(?:^|[^\\p{L}\\p{N}_])${word}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(name);
    if (hasWord('pizza')) return '🍕';
    if (hasWord('burger')) return '🍔';
    if (hasWord('pasta') || hasWord('nudel')) return '🍝';
    if (hasWord('salat')) return '🥗';
    if (hasWord('suppe')) return '🍲';
    if (hasWord('kuchen') || hasWord('torte')) return '🍰';
    if (hasWord('brot')) return '🍞';
    if (hasWord('hähnchen') || hasWord('chicken')) return '🍗';
    if (hasWord('fisch')) return '🐟';
    if (hasWord('reis')) return '🍚';
    if (hasWord('curry')) return '🍛';
    if (hasWord('sandwich') || hasWord('subway')) return '🥪';
    if (hasWord('taco')) return '🌮';
    if (hasWord('sushi')) return '🍣';
    if (hasWord('steak')) return '🥩';
    if (/(?:^|[\s-])ei(?:er)?(?:$|[\s-])/.test(name)
        || /(?:rührei|spiegelei|omelett)/.test(name)) return '🍳';
    if (hasWord('auflauf')) return '🥘';
    if (hasWord('dessert') || hasWord('nachtisch')) return '🍮';
    if (hasWord('kartoffel')) return '🥔';
    if (hasWord('pute')) return '🦃';
    if (hasWord('gnocchi')) return '🥟';
    if (hasWord('nacho')) return '🌮';
    if (hasWord('punsch')) return '🍷';
    if (hasWord('tiramisu')) return '🍰';
    if (hasWord('kaiserschmarrn')) return '🥞';
    if (hasWord('apfel')) return '🍎';
    if (hasWord('oatmeal') || hasWord('haferflocken')) return '🥣';
    if (hasWord('naan')) return '🫓';
    if (hasWord('mac')) return '🧀';
    return '🍽️';
}
