// Seitenlogik der Rezeptdetail-Seite (pages/recipe-detail.html). Früher als Inline-<script> in der HTML.
globalThis.generator = new RecipeGenerator();
let currentRecipe = null;
let allImages = [];
let currentImageIndex = 0;

function resolveRecipeImageURL(imageURL) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(imageURL)) return imageURL;
    return new URL(`../${imageURL}`, window.location.href).href;
}

// Portion Scaler State
let originalServings = null;
let currentServings = null;
let originalIngredients = [];
let ingredientDockObserver = null;
let ingredientSectionObserver = null;
let ingredientDockHasIngredients = false;
let ingredientSectionVisible = true;
let ingredientSectionWasVisible = false;

// Wake Lock State
let wakeLock = null;
let wakeLockSupported = 'wakeLock' in navigator;

window.addEventListener('load', async () => {
    try {
        const savedEdits = localStorage.getItem('recipes_user_edits');
        let loadedFromCache = false;
        if (savedEdits) {
            generator.recipes = JSON.parse(savedEdits);
            if (!Array.isArray(generator.recipes)) throw new Error('Lokale Rezeptdaten sind ungültig.');
            generator.normalizeCategories();
            loadedFromCache = true;
        } else if (generator.loadFromLocalStorage()) {
            // Verwende denselben Rezept-Cache wie die Übersicht.
            loadedFromCache = true;
        } else {
            await generator.loadFromURL('../recipes.json');
            generator.saveToLocalStorage();
        }
        if (loadedFromCache && window.location.protocol !== 'file:') {
            try {
                await generator.syncHealthyClassifications('../recipes.json');
            } catch (error) {
                console.warn(`Healthy-Kennzeichnungen konnten nicht aktualisiert werden: ${error.message}`);
            }
        }
    } catch (error) {
        if (window.location.protocol === 'file:') {
            try {
                const data = await selectLocalRecipesJson();
                generator.recipes = data.recipes;
                generator.normalizeCategories();
                generator.saveToLocalStorage();
            } catch (fileError) {
                alert(`Rezeptdaten konnten nicht geladen werden: ${fileError.message}`);
                goBack();
                return;
            }
        } else {
            alert('Fehler beim Laden der Rezepte. Bitte gehe zurück zur Startseite.');
            goBack();
            return;
        }
    }
    // Hole aktuelles Rezept
    const recipeName = localStorage.getItem('currentRecipe');
    if (!recipeName) {
        alert('Kein Rezept ausgewählt');
        goBack();
        return;
    }

    currentRecipe = generator.getRecipeByName(recipeName);
    if (!currentRecipe) {
        alert('Rezept nicht gefunden');
        goBack();
        return;
    }

    await displayRecipe();
});

function selectLocalRecipesJson() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
            if (!input.files.length) return reject(new Error('Keine Datei ausgewählt.'));
            try {
                const data = JSON.parse(await input.files[0].text());
                if (!Array.isArray(data.recipes)) throw new Error('Die Datei enthält keine Rezeptliste.');
                resolve(data);
            } catch (error) {
                reject(error);
            }
        }, { once: true });
        input.click();
    });
}

async function displayRecipe() {
    if (!currentRecipe) return;

    // Titel
    document.getElementById('recipeTitle').textContent = currentRecipe.name;
    document.title = currentRecipe.name + ' - Rezept';

    // Kategorie
    const categoryEl = document.getElementById('recipeCategory');
    if (currentRecipe.category) {
        categoryEl.textContent = currentRecipe.healthy ? `${currentRecipe.category} · healthy` : currentRecipe.category;
        categoryEl.style.display = 'inline-block';
    }

    // Zeige Hinweis wenn Placeholder-Rezept
    if (currentRecipe.isPlaceholder) {
        const infoEl = document.getElementById('recipeMeta');
        const notice = document.createElement('div');
        notice.style.cssText = 'background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 8px; margin-bottom: 20px;';
        const noticeTitle = document.createElement('strong');
        noticeTitle.textContent = 'ℹ️ Hinweis:';
        notice.append(noticeTitle, document.createTextNode(' Dieses Rezept ist noch nicht vollständig erfasst.'));
        infoEl.replaceChildren(notice);
    }

    // Bild/Emoji
    const imageEl = document.getElementById('recipeImageMain');
    const thumbnailsEl = document.getElementById('imageThumbnails');
    const emoji = getRecipeEmoji(currentRecipe.name);
    const gradient = getGradientForRecipe(currentRecipe.name);

    // Setze zunächst Emoji + Gradient
    imageEl.className = `detail-image-main ${gradient}`;
    imageEl.querySelector('.emoji-placeholder').textContent = emoji;

    // Versuche alle Bilder zu laden
    try {
        const imageDataArray = await generator.getAllRecipeImageURLs(currentRecipe.name);

        if (imageDataArray && imageDataArray.length > 0) {
            allImages = imageDataArray; // Jetzt Array von {dataUrl, transform}
            currentImageIndex = 0;

            // Zeige erstes Bild
            displayImage(0);

            // Wenn mehrere Bilder vorhanden, zeige Thumbnails
            if (imageDataArray.length > 1) {
                displayThumbnails();
            }
        } else {
            // Kein Bild vorhanden - generiere Placeholder
            const placeholder = generatePlaceholderImage(currentRecipe.name, emoji);
            const img = document.createElement('img');
            img.src = placeholder;
            img.alt = currentRecipe.name;
            img.onload = () => {
                imageEl.innerHTML = '';
                imageEl.appendChild(img);
                imageEl.classList.remove('gradient-1', 'gradient-2', 'gradient-3', 'gradient-4', 'gradient-5', 'gradient-6', 'gradient-7', 'gradient-8');
            };
        }
    } catch (error) {
        console.warn('Bilder konnten nicht geladen werden:', error);
        // Bei Fehler auch Placeholder verwenden
        const placeholder = generatePlaceholderImage(currentRecipe.name, emoji);
        const img = document.createElement('img');
        img.src = placeholder;
        img.alt = currentRecipe.name;
        imageEl.innerHTML = '';
        imageEl.appendChild(img);
        imageEl.classList.remove('gradient-1', 'gradient-2', 'gradient-3', 'gradient-4', 'gradient-5', 'gradient-6', 'gradient-7', 'gradient-8');
    }

    // Meta-Informationen
    const metaEl = document.getElementById('recipeMeta');
    if (!currentRecipe.isPlaceholder) metaEl.replaceChildren();

    if (currentRecipe.servings) {
        const servings = document.createElement('div');
        servings.className = 'detail-meta-item';
        const servingsValue = document.createElement('strong');
        servingsValue.textContent = currentRecipe.servings;
        servings.append(document.createTextNode('👥 '), servingsValue, document.createTextNode(' Portionen'));
        metaEl.appendChild(servings);
    }

    if (currentRecipe.ingredients && currentRecipe.ingredients.length > 0 && !currentRecipe.isPlaceholder) {
        const ingredientCount = document.createElement('div');
        ingredientCount.className = 'detail-meta-item';
        const count = document.createElement('strong');
        count.textContent = currentRecipe.ingredients.length;
        ingredientCount.append(document.createTextNode('📝 '), count, document.createTextNode(' Zutaten'));
        metaEl.appendChild(ingredientCount);
    }

    if (currentRecipe.instructions && currentRecipe.instructions.length > 0 && !currentRecipe.isPlaceholder) {
        const instructionCount = document.createElement('div');
        instructionCount.className = 'detail-meta-item';
        const count = document.createElement('strong');
        count.textContent = currentRecipe.instructions.length;
        instructionCount.append(document.createTextNode('👨‍🍳 '), count, document.createTextNode(' Schritte'));
        metaEl.appendChild(instructionCount);
    }

    // Zutaten
    displayIngredients();

    // Initialisiere Portion Scaler
    initializePortionScaler();

    // Anleitung
    displayInstructions();
    displayRecipeVideo();

    // Notizen/Links
    displayNotes();
}

function displayImage(index) {
    if (index < 0 || index >= allImages.length) return;

    currentImageIndex = index;
    const imageEl = document.getElementById('recipeImageMain');

    // Hole Bild-Daten mit Transformation
    const imageData = allImages[index];

    // Ersetze mit echtem Bild
    const img = document.createElement('img');
    img.src = resolveRecipeImageURL(imageData.dataUrl);
    img.alt = currentRecipe.name;
    img.onload = () => {
        imageEl.innerHTML = '';
        imageEl.appendChild(img);
        imageEl.classList.remove('gradient-1', 'gradient-2', 'gradient-3', 'gradient-4', 'gradient-5', 'gradient-6', 'gradient-7', 'gradient-8');

        // Wende Transformationen an
        applyImageTransform(img, imageData.transform);
    };
}

/**
 * Wendet CSS-Transformationen auf ein Bild-Element an
 * @param {HTMLImageElement} imgElement - Das Bild-Element
 * @param {Object} transform - Transformations-Objekt
 */
function applyImageTransform(imgElement, transform) {
    if (!transform) return;

    const transforms = [];

    // Rotation
    if (transform.rotation && transform.rotation !== 0) {
        transforms.push(`rotate(${transform.rotation}deg)`);
    }

    // Spiegelung
    let scaleX = transform.flipH ? -1 : 1;
    let scaleY = transform.flipV ? -1 : 1;
    if (scaleX !== 1 || scaleY !== 1) {
        transforms.push(`scale(${scaleX}, ${scaleY})`);
    }

    // CSS Transform anwenden
    if (transforms.length > 0) {
        imgElement.style.transform = transforms.join(' ');
    }

    // Cropping mit clip-path
    if (transform.crop && (transform.crop.left > 0 || transform.crop.top > 0 || 
        transform.crop.right > 0 || transform.crop.bottom > 0)) {

        const left = transform.crop.left;
        const top = transform.crop.top;
        const right = 100 - transform.crop.right;
        const bottom = 100 - transform.crop.bottom;

        imgElement.style.clipPath = `inset(${top}% ${100-right}% ${100-bottom}% ${left}%)`;
    }
}

function displayThumbnails() {
    const thumbnailsEl = document.getElementById('imageThumbnails');
    thumbnailsEl.innerHTML = '';
    thumbnailsEl.style.display = 'flex';

    allImages.forEach((imageData, index) => {
        const thumbnail = document.createElement('div');
        thumbnail.className = 'image-thumbnail';
        if (index === currentImageIndex) {
            thumbnail.classList.add('active');
        }

        const img = document.createElement('img');
        img.src = resolveRecipeImageURL(imageData.dataUrl);
        img.alt = `Bild ${index + 1}`;
        img.onclick = () => {
            displayImage(index);
            updateThumbnailSelection(index);
        };

        // Wende auch auf Thumbnails die Transformation an (kleinere Version)
        applyImageTransform(img, imageData.transform);

        thumbnail.appendChild(img);
        thumbnailsEl.appendChild(thumbnail);
    });
}

function updateThumbnailSelection(index) {
    const thumbnails = document.querySelectorAll('.image-thumbnail');
    thumbnails.forEach((thumb, i) => {
        if (i === index) {
            thumb.classList.add('active');
        } else {
            thumb.classList.remove('active');
        }
    });
}

function createIngredientItem(ingredient) {
    const li = document.createElement('li');
    li.className = 'ingredient-item';
    for (const [className, value] of [
        ['ingredient-amount', ingredient.amount || ''],
        ['ingredient-unit', ingredient.unit || ''],
        ['ingredient-product', ingredient.product || '']
    ]) {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = value;
        li.appendChild(span);
    }
    if (ingredient.note) {
        const note = document.createElement('span');
        note.className = 'ingredient-note';
        note.textContent = ingredient.note;
        li.appendChild(note);
    }
    return li;
}

function displayIngredients() {
    renderIngredientLists(currentRecipe.ingredients || []);
}

function renderIngredientLists(ingredients) {
    const listEl = document.getElementById('ingredientsList');
    const dock = document.getElementById('ingredientDock');
    const fullList = document.getElementById('ingredientDockIngredients');
    const visibleIngredients = Array.isArray(ingredients) ? ingredients : [];

    if (visibleIngredients.length === 0) {
        listEl.replaceChildren();
        const empty = document.createElement('li');
        empty.className = 'no-data';
        empty.textContent = 'Keine Zutaten verfügbar';
        listEl.appendChild(empty);
    } else {
        listEl.replaceChildren(...visibleIngredients.map(createIngredientItem));
    }
    fullList.replaceChildren(...visibleIngredients.map(createIngredientItem));

    ingredientDockHasIngredients = visibleIngredients.length > 0;
    document.getElementById('ingredientDockCount').textContent = `${visibleIngredients.length} Zutaten`;

    if (visibleIngredients.length === 0) {
        collapseIngredientDock();
    }
    updateIngredientDockVisibility();
    requestAnimationFrame(updateIngredientDockSpace);
}

function collapseIngredientDock() {
    const dock = document.getElementById('ingredientDock');
    document.getElementById('ingredientDockToggle').setAttribute('aria-expanded', 'false');
    document.getElementById('ingredientDockToggleLabel').textContent = 'Zutaten anzeigen';
    const panel = document.getElementById('ingredientDockFullList');
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    dock.classList.remove('is-expanded');
}

function updateIngredientDockVisibility() {
    const dock = document.getElementById('ingredientDock');
    const shouldShowDock = ingredientDockHasIngredients && ingredientSectionWasVisible && !ingredientSectionVisible;
    if (!shouldShowDock) collapseIngredientDock();
    dock.hidden = !shouldShowDock;
    requestAnimationFrame(updateIngredientDockSpace);
}

function updateIngredientDockSpace() {
    const dock = document.getElementById('ingredientDock');
    const dockSpace = !dock.hidden ? dock.offsetHeight + 20 : 0;
    document.documentElement.style.setProperty('--ingredient-dock-space', `${dockSpace}px`);
}

function initializeIngredientDock() {
    const dock = document.getElementById('ingredientDock');
    ingredientDockObserver?.disconnect();
    ingredientDockObserver = new ResizeObserver(updateIngredientDockSpace);
    ingredientDockObserver.observe(dock);
    ingredientSectionObserver?.disconnect();
    ingredientSectionObserver = new IntersectionObserver(([entry]) => {
        ingredientSectionVisible = entry.isIntersecting;
        if (entry.isIntersecting) ingredientSectionWasVisible = true;
        updateIngredientDockVisibility();
    });
    ingredientSectionObserver.observe(document.getElementById('ingredientsSection'));
    window.addEventListener('resize', updateIngredientDockSpace);
    updateIngredientDockSpace();
}

function toggleIngredientDock() {
    const toggle = document.getElementById('ingredientDockToggle');
    const panel = document.getElementById('ingredientDockFullList');
    const isExpanded = toggle.getAttribute('aria-expanded') !== 'true';

    toggle.setAttribute('aria-expanded', String(isExpanded));
    document.getElementById('ingredientDockToggleLabel').textContent =
        isExpanded ? 'Zutaten einklappen' : 'Zutaten anzeigen';
    panel.hidden = !isExpanded;
    panel.setAttribute('aria-hidden', String(!isExpanded));
    const dock = document.getElementById('ingredientDock');
    dock.classList.toggle('is-expanded', isExpanded);
    requestAnimationFrame(updateIngredientDockSpace);
}

function displayInstructions() {
    const listEl = document.getElementById('instructionsList');

    if (!currentRecipe.instructions || currentRecipe.instructions.length === 0) {
        listEl.innerHTML = '<li class="no-data">Keine Anleitung verfügbar</li>';
        return;
    }

    listEl.innerHTML = '';
    currentRecipe.instructions
        .sort((a, b) => a.step - b.step)
        .forEach(instruction => {
            const li = document.createElement('li');
            li.className = 'instruction-item';
            const text = document.createElement('div');
            text.className = 'instruction-text';
            text.textContent = instruction.text;
            li.appendChild(text);
            listEl.appendChild(li);
        });
}

function displayRecipeVideo() {
    const section = document.getElementById('recipeVideoSection');
    const video = document.getElementById('recipeVideo');
    const error = document.getElementById('recipeVideoError');
    const recipeVideo = currentRecipe.video;
    const src = typeof recipeVideo?.src === 'string' ? recipeVideo.src.trim() : '';
    if (!src) {
        video.removeAttribute('src');
        video.load();
        error.hidden = true;
        section.hidden = true;
        return;
    }

    if (!/^videos\/recipes\/[^/\\]+\.(?:mp4|webm|mov)$/i.test(src)) {
        console.warn('Ungültige Videoquelle im Rezept.');
        video.removeAttribute('src');
        error.hidden = true;
        section.hidden = true;
        return;
    }
    const pageBase = window.location.pathname.includes('/pages/') ? '../' : './';
    error.hidden = true;
    video.src = new URL(`${pageBase}${src}`, window.location.href).href;
    video.onerror = () => { error.hidden = false; };
    section.hidden = false;
}

function displayNotes() {
    const sectionEl = document.getElementById('notesSection');
    const listEl = document.getElementById('notesList');

    if (!currentRecipe.notes || currentRecipe.notes.length === 0) {
        sectionEl.style.display = 'none';
        return;
    }

    sectionEl.style.display = 'block';
    listEl.innerHTML = '';

    currentRecipe.notes.forEach(note => {
        const noteEl = document.createElement('div');
        noteEl.className = 'note-item';

        const value = String(note);
        const urlPattern = /https?:\/\/[^\s]+/g;
        let lastIndex = 0;
        for (const match of value.matchAll(urlPattern)) {
            noteEl.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
            let link;
            try {
                const url = new URL(match[0]);
                if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported link protocol');
                link = document.createElement('a');
                link.href = url.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.className = 'note-link';
                link.textContent = `${match[0]} 🔗`;
            } catch {
                noteEl.appendChild(document.createTextNode(match[0]));
            }
            if (link) noteEl.appendChild(link);
            lastIndex = match.index + match[0].length;
        }
        noteEl.appendChild(document.createTextNode(value.slice(lastIndex)));

        listEl.appendChild(noteEl);
    });
}

function getRecipeEmoji(recipeName) {
    const name = recipeName.toLowerCase();

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
    if (name.includes('ei')) return '🍳';
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

    return '🍽️';
}

function getGradientForRecipe(recipeName) {
    const hash = recipeName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return `gradient-${(hash % 8) + 1}`;
}

function goBack() {
    window.location.href = '../index.html';
}

function editCurrentRecipe() {
    if (!currentRecipe) return;
    openRecipeEditor(currentRecipe.name);
}

async function onRecipeEditorSaved(recipe) {
    if (!recipe) return;
    currentRecipe = recipe;
    await displayRecipe();
}

function printRecipe() {
    window.print();
}

function selectRandomRecipe() {
    const random = generator.getRandomRecipe();
    if (random) {
        localStorage.setItem('currentRecipe', random.name);
        window.location.reload();
    }
}

function generatePlaceholderImage(recipeName, emoji) {
    // Erstelle SVG Placeholder mit Emoji und Rezeptname
    const hash = recipeName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

    const colors = [
        ['#667eea', '#764ba2'],
        ['#f093fb', '#f5576c'],
        ['#4facfe', '#00f2fe'],
        ['#43e97b', '#38f9d7'],
        ['#fa709a', '#fee140'],
        ['#30cfd0', '#330867'],
        ['#a8edea', '#fed6e3'],
        ['#ff9a56', '#ff6a88']
    ];

    const colorPair = colors[hash % colors.length];
    const displayName = recipeName.length > 30 ? recipeName.substring(0, 27) + '...' : recipeName;
    const safeDisplayName = displayName.replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;'
    })[character]);

    const svg = `
        <svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${colorPair[0]};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${colorPair[1]};stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="600" height="400" fill="url(#grad${hash})"/>
            <text x="300" y="200" font-size="140" text-anchor="middle" fill="white" opacity="0.9">${emoji}</text>
            <text x="300" y="310" font-size="28" text-anchor="middle" fill="white" font-weight="600" opacity="0.95">${safeDisplayName}</text>
        </svg>
    `;

    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// ========================================
// Wake Lock Funktionalität
// ========================================

/**
 * Toggle Wake Lock on/off
 */
async function toggleWakeLock() {
    if (wakeLock !== null) {
        // Bereits aktiv - deaktiviere
        await releaseWakeLock();
    } else {
        // Aktiviere Wake Lock
        await requestWakeLock();
    }
}

/**
 * Aktiviert Wake Lock
 */
async function requestWakeLock() {
    if (!wakeLockSupported) {
        // Fallback für Browser ohne Wake Lock API
        showWakeLockFallbackMessage();
        return;
    }

    try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock aktiviert');

        // Update UI
        updateWakeLockButton(true);

        // Event Listener für automatische Freigabe (Tab-Wechsel, etc.)
        wakeLock.addEventListener('release', () => {
            console.log('Wake Lock automatisch freigegeben');
            wakeLock = null;
            updateWakeLockButton(false);
        });

    } catch (err) {
        console.error('Wake Lock Fehler:', err);
        showWakeLockFallbackMessage();
    }
}

/**
 * Deaktiviert Wake Lock
 */
async function releaseWakeLock() {
    if (wakeLock !== null) {
        await wakeLock.release();
        wakeLock = null;
        updateWakeLockButton(false);
        console.log('Wake Lock deaktiviert');
    }
}

/**
 * Update Button UI
 */
function updateWakeLockButton(active) {
    const btn = document.getElementById('wakeLockBtn');
    const icon = document.getElementById('wakeLockIcon');
    const text = document.getElementById('wakeLockText');

    if (active) {
        icon.textContent = '🔆';
        text.textContent = 'Display aktiv';
        btn.style.background = 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)';
        btn.style.color = 'white';
    } else {
        icon.textContent = '☀️';
        text.textContent = 'Display wach';
        btn.style.background = '';
        btn.style.color = '';
    }
}

/**
 * Fallback Nachricht für Browser ohne Wake Lock Support
 */
function showWakeLockFallbackMessage() {
    alert('Wake Lock wird von deinem Browser nicht unterstützt.\n\nTipp: Gehe zu deinen Geräteeinstellungen und stelle die Display-Timeout Zeit manuell ein.');
}

// Cleanup beim Verlassen der Seite
window.addEventListener('beforeunload', () => {
    if (wakeLock !== null) {
        wakeLock.release();
    }
});

/**
 * Passt Portionen an (+1 oder -1)
 */
function adjustPortions(delta) {
    if (currentServings === null || originalServings === null) return;

    const newServings = currentServings + delta;

    // Minimum 1 Portion
    if (newServings < 1) return;

    currentServings = newServings;
    updatePortionsDisplay();
    scaleIngredients();
}

/**
 * Setzt Portionen auf Original zurück
 */
function resetPortions() {
    if (originalServings === null) return;

    currentServings = originalServings;
    updatePortionsDisplay();
    scaleIngredients();
}

/**
 * Update Portion Display
 */
function updatePortionsDisplay() {
    const display = document.getElementById('currentPortions');
    if (display) {
        display.textContent = currentServings;
    }
}

/**
 * Skaliert Zutaten basierend auf aktuellen Portionen
 */
function scaleIngredients() {
    if (originalServings === null || currentServings === null) return;

    const scaleFactor = currentServings / originalServings;
    const scaledIngredients = originalIngredients.map(ingredient => {
        // Skaliere Menge wenn numerisch
        let scaledAmount = ingredient.amount;
        if (ingredient.amount) {
            const amountNum = parseFloat(ingredient.amount);
            if (!isNaN(amountNum)) {
                scaledAmount = (amountNum * scaleFactor).toFixed(1);
                // Entferne .0 bei ganzen Zahlen
                if (scaledAmount.endsWith('.0')) {
                    scaledAmount = scaledAmount.slice(0, -2);
                }
            }
        }

        return { ...ingredient, amount: scaledAmount };
    });
    renderIngredientLists(scaledIngredients);
}

/**
 * Initialisiert Portion Scaler
 */
function initializePortionScaler() {
    if (!currentRecipe || !currentRecipe.servings) {
        // Kein Servings-Info vorhanden
        document.getElementById('portionScaler').style.display = 'none';
        return;
    }

    originalServings = currentRecipe.servings

    if (originalServings === null) {
        // Konnte keine Zahl extrahieren
        document.getElementById('portionScaler').style.display = 'none';
        return;
    }

    currentServings = originalServings;
    originalIngredients = JSON.parse(JSON.stringify(currentRecipe.ingredients || []));

    // Zeige Scaler
    document.getElementById('portionScaler').style.display = 'flex';
    updatePortionsDisplay();
}
// onRecipeEditorSaved wird von recipeEditor.mjs über globalThis aufgerufen.
globalThis.onRecipeEditorSaved = onRecipeEditorSaved;
initializeIngredientDock();

// --- Event-Wiring (ersetzt die onclick-Attribute aus recipe-detail.html) ---
document.getElementById('detailBackBtn').addEventListener('click', goBack);
document.getElementById('editCurrentRecipeBtn').addEventListener('click', editCurrentRecipe);
document.getElementById('printRecipeBtn').addEventListener('click', printRecipe);
document.getElementById('wakeLockBtn').addEventListener('click', () => toggleWakeLock());
document.getElementById('selectRandomRecipeBtn').addEventListener('click', selectRandomRecipe);
document.getElementById('portionMinusBtn').addEventListener('click', () => adjustPortions(-1));
document.getElementById('portionPlusBtn').addEventListener('click', () => adjustPortions(1));
document.getElementById('portionResetBtn').addEventListener('click', resetPortions);
document.getElementById('ingredientDockToggle').addEventListener('click', toggleIngredientDock);
document.getElementById('editorCloseBtn').addEventListener('click', () => closeRecipeEditor());
document.getElementById('recipeImportUrlBtn').addEventListener('click', () => importRecipeFromUrl());
document.getElementById('recipeImportImageBtn').addEventListener('click', () => document.getElementById('recipeImportImageInput').click());
document.getElementById('newRecipeBtn').addEventListener('click', () => newRecipe());
