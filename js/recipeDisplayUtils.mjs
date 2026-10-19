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
    if (name.includes('pizza')) return '🍕';
    if (name.includes('burger')) return '🍔';
    if (name.includes('pasta') || name.includes('nudel')) return '🍝';
    if (name.includes('salat')) return '🥗';
    if (name.includes('suppe')) return '🍲';
    if (name.includes('kuchen') || name.includes('torte')) return '🍰';
    if (name.includes('brot')) return '🍞';
    if (name.includes('hähnchen') || name.includes('chicken')) return '🍗';
    if (name.includes('fisch')) return '🐟';
    if (name.includes('reis')) return '🍚';
    if (name.includes('curry')) return '🍛';
    if (name.includes('sandwich') || name.includes('subway')) return '🥪';
    if (name.includes('taco')) return '🌮';
    if (name.includes('sushi')) return '🍣';
    if (name.includes('steak')) return '🥩';
    if (/(?:^|[\s-])ei(?:er)?(?:$|[\s-])/.test(name)
        || /(?:rührei|spiegelei|omelett)/.test(name)) return '🍳';
    if (name.includes('auflauf')) return '🥘';
    if (name.includes('dessert') || name.includes('nachtisch')) return '🍮';
    if (name.includes('kartoffel')) return '🥔';
    if (name.includes('pute')) return '🦃';
    if (name.includes('gnocchi')) return '🥟';
    if (name.includes('nacho')) return '🌮';
    if (name.includes('punsch')) return '🍷';
    if (name.includes('tiramisu')) return '🍰';
    if (name.includes('kaiserschmarn')) return '🥞';
    if (name.includes('apfel')) return '🍎';
    if (name.includes('oatmeal') || name.includes('haferflocken')) return '🥣';
    if (name.includes('naan')) return '🫓';
    if (name.includes('mac')) return '🧀';
    return '🍽️';
}
