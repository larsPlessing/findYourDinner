/* Liest und skaliert Zutatenmengen aus Rezepten.
   Der Importer liefert Mengen als Text – unter anderem „1/2“, „2,5“ oder „200-300“.
   Alles, was hier nicht eindeutig als Zahl erkannt wird, bleibt unverändert. */

/** Liest eine Menge als Zahl. Erkennt ganze Zahlen, Dezimalkomma („2,5“), Bruch („1/2“)
 *  und gemischte Brüche („1 1/2“). Liefert null, wenn der Text nicht verstanden wird. */
function parseIngredientAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;

    const text = value.trim();
    if (!text) return null;

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

    if (/^\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(',', '.'));
    return null;
}

/** Formatiert eine skalierte Menge: höchstens zwei Nachkommastellen,
 *  ohne Nachkommastellen bei ganzen Zahlen. */
function formatIngredientAmount(value) {
    return (Math.round(value * 100) / 100).toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 2 });
}

/** Skaliert eine Menge inklusive Bereich („200-300“). Unverstandene Mengen
 *  werden unverändert zurückgegeben. */
function scaleIngredientAmount(value, scaleFactor) {
    const amount = parseIngredientAmount(value);
    if (amount === null) {
        // Vielleicht ein Bereich wie „200-300“.
        const range = typeof value === 'string' ? value.trim().match(/^(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)$/) : null;
        if (!range) return value;
        const lower = parseIngredientAmount(range[1]);
        const upper = parseIngredientAmount(range[2]);
        if (lower === null || upper === null) return value;
        return `${formatIngredientAmount(lower * scaleFactor)}-${formatIngredientAmount(upper * scaleFactor)}`;
    }
    return formatIngredientAmount(amount * scaleFactor);
}

export { formatIngredientAmount, parseIngredientAmount, scaleIngredientAmount };
