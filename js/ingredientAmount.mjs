/* Liest und skaliert Zutatenmengen aus Rezepten. */

const unicodeFractions = new Map([
    ['\u00bd', 1 / 2], ['\u2153', 1 / 3], ['\u2154', 2 / 3], ['\u00bc', 1 / 4], ['\u00be', 3 / 4],
    ['\u2155', 1 / 5], ['\u2156', 2 / 5], ['\u2157', 3 / 5], ['\u2158', 4 / 5], ['\u2159', 1 / 6],
    ['\u215a', 5 / 6], ['\u215b', 1 / 8], ['\u215c', 3 / 8], ['\u215d', 5 / 8], ['\u215e', 7 / 8]
]);

function parseIngredientAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;

    const unicodeFraction = text.match(/^(\d+)?\s*([\u00bd\u2153\u2154\u00bc\u00be\u2155\u2156\u2157\u2158\u2159\u215a\u215b\u215c\u215d\u215e])$/u);
    if (unicodeFraction) return Number(unicodeFraction[1] || 0) + unicodeFractions.get(unicodeFraction[2]);

    const mixedFraction = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixedFraction) {
        const denominator = Number(mixedFraction[3]);
        return denominator ? Number(mixedFraction[1]) + Number(mixedFraction[2]) / denominator : null;
    }
    const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction) {
        const denominator = Number(fraction[2]);
        return denominator ? Number(fraction[1]) / denominator : null;
    }

    const germanThousands = text.match(/^(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/);
    if (germanThousands) {
        return Number(germanThousands[1].replaceAll('.', '') + (germanThousands[2] ? `.${germanThousands[2]}` : ''));
    }
    if (/^\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(',', '.'));
    return null;
}

function formatIngredientAmount(value) {
    return (Math.round(value * 100) / 100).toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 2 });
}

function scaleIngredientAmount(value, scaleFactor) {
    const amount = parseIngredientAmount(value);
    if (amount === null) {
        const range = typeof value === 'string'
            ? value.trim().match(/^(.+?)\s*[-–—]\s*(.+)$/u)
            : null;
        if (!range) return value;
        const lower = parseIngredientAmount(range[1]);
        const upper = parseIngredientAmount(range[2]);
        if (lower === null || upper === null) return value;
        return `${formatIngredientAmount(lower * scaleFactor)}-${formatIngredientAmount(upper * scaleFactor)}`;
    }
    return formatIngredientAmount(amount * scaleFactor);
}

export { formatIngredientAmount, parseIngredientAmount, scaleIngredientAmount };
