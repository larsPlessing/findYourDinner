// Seitenlogik der Rezeptdetail-Seite (pages/recipe-detail.html). Früher als Inline-<script> in der HTML.
import { scaleIngredientAmount } from './ingredientAmount.mjs';
import { applyImageTransform, generatePlaceholderImage, getRecipeEmoji } from './recipeDisplayUtils.mjs';

globalThis.generator = new RecipeGenerator();
let currentRecipe = null;
let allImages = [];
let currentImageIndex = 0;
let renderToken = 0;

function resolveRecipeImageURL(imageURL) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(imageURL)) return imageURL;
    return new URL(`../${imageURL}`, window.location.href).href;
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLockRequested && wakeLock === null) {
        requestWakeLock();
    }
});

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
let wakeLockRequested = false;

window.addEventListener('load', async () => {
    try {
        const savedEdits = localStorage.getItem('recipes_user_edits');
        let loadedFromCache = false;
        let hasLocalEdits = false;
        if (savedEdits) {
            generator.recipes = JSON.parse(savedEdits);
            if (!Array.isArray(generator.recipes)) throw new Error('Lokale Rezeptdaten sind ungültig.');
            generator.revision = localStorage.getItem('recipes_revision') || null;
            generator.normalizeCategories();
            localStorage.removeItem('recipes');
            loadedFromCache = true;
            hasLocalEdits = true;
        } else if (generator.loadFromLocalStorage()) {
            // Verwende denselben Rezept-Cache wie die Übersicht.
            loadedFromCache = true;
        }
        if (window.location.protocol !== 'file:') {
            try {
                await generator.syncWithRemote('../recipes.enc', {
                    hasLocalEdits,
                    hasCachedRecipes: loadedFromCache
                });
            } catch (error) {
                if (!loadedFromCache) throw error;
                console.warn(`Neue Rezeptversion konnte nicht geprüft werden: ${error.message}`);
            }
        } else if (!loadedFromCache) {
            await generator.loadFromURL('../recipes.enc');
            generator.saveToLocalStorage();
        }
    } catch (error) {
        if (window.location.protocol === 'file:') {
            try {
                const data = await selectLocalRecipesJson();
                if (data?.kdf === 'PBKDF2-SHA-256') {
                    const unlocked = await generator.loadEncryptedEnvelope(data);
                    generator.recipes = unlocked.recipes;
                    generator.revision = unlocked.revision || null;
                } else {
                    generator.recipes = data.recipes;
                }
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
    const recipeKey = new URLSearchParams(window.location.search).get('id')
        || localStorage.getItem('currentRecipe');
    if (!recipeKey) {
        alert('Kein Rezept ausgewählt');
        goBack();
        return;
    }

    currentRecipe = generator.getRecipeById(recipeKey) || generator.getRecipeByName(recipeKey);
    if (!currentRecipe) {
        alert('Rezept nicht gefunden');
        goBack();
        return;
    }

    await displayRecipe();
});

window.addEventListener('popstate', () => {
    const key = new URLSearchParams(location.search).get('id');
    const r = generator.getRecipeById(key) || generator.getRecipeByName(key);
    if (r) {
        currentRecipe = r;
        void displayRecipe();
    }
});

function selectLocalRecipesJson() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.enc,.json,application/json';
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
    const token = ++renderToken;
    allImages = [];
    currentImageIndex = 0;

    // Titel
    document.getElementById('recipeTitle').textContent = currentRecipe.name;
    document.title = currentRecipe.name + ' - Rezept';

    // Kategorie
    const categoryEl = document.getElementById('recipeCategory');
    if (currentRecipe.category) {
        categoryEl.textContent = currentRecipe.healthy ? `${currentRecipe.category} · healthy` : currentRecipe.category;
        categoryEl.style.display = 'inline-block';
    } else {
        categoryEl.style.display = 'none';
    }

    // Zeige Hinweis wenn Placeholder-Rezept
    const metaEl = document.getElementById('recipeMeta');
    metaEl.replaceChildren();
    if (currentRecipe.isPlaceholder) {
        const notice = document.createElement('div');
        notice.style.cssText = 'background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 8px; margin-bottom: 20px;';
        const noticeTitle = document.createElement('strong');
        noticeTitle.textContent = 'ℹ️ Hinweis:';
        notice.append(noticeTitle, document.createTextNode(' Dieses Rezept ist noch nicht vollständig erfasst.'));
        metaEl.appendChild(notice);
    }

    // Bild/Emoji
    const imageEl = document.getElementById('recipeImageMain');
    const thumbnailsEl = document.getElementById('imageThumbnails');
    thumbnailsEl.replaceChildren();
    thumbnailsEl.style.display = 'none';
    const emoji = getRecipeEmoji(currentRecipe.name);
    const gradient = getGradientForRecipe(currentRecipe.name);

    // Setze zunächst Emoji + Gradient
    imageEl.className = `detail-image-main ${gradient}`;
    const emojiEl = document.createElement('div');
    emojiEl.className = 'emoji-placeholder';
    emojiEl.textContent = emoji;
    imageEl.replaceChildren(emojiEl);

    // Versuche alle Bilder zu laden
    try {
        const imageDataArray = await generator.getAllRecipeImageURLs(currentRecipe);
        if (token !== renderToken) return;

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
            const placeholder = generatePlaceholderImage(currentRecipe.name, emoji, { size: 600, nameLimit: 30 });
            const img = document.createElement('img');
            img.src = placeholder;
            img.alt = currentRecipe.name;
            img.onload = () => {
                if (token !== renderToken) return;
                imageEl.replaceChildren(img);
                imageEl.classList.remove('gradient-1', 'gradient-2', 'gradient-3', 'gradient-4', 'gradient-5', 'gradient-6', 'gradient-7', 'gradient-8');
            };
        }
    } catch (error) {
        if (token !== renderToken) return;
        console.warn('Bilder konnten nicht geladen werden:', error);
        // Bei Fehler auch Placeholder verwenden
        const placeholder = generatePlaceholderImage(currentRecipe.name, emoji, { size: 600, nameLimit: 30 });
        const img = document.createElement('img');
        img.src = placeholder;
        img.alt = currentRecipe.name;
        imageEl.replaceChildren(img);
        imageEl.classList.remove('gradient-1', 'gradient-2', 'gradient-3', 'gradient-4', 'gradient-5', 'gradient-6', 'gradient-7', 'gradient-8');
    }

    // Meta-Informationen
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
    void displayRecipeVideo(token);

    // Notizen/Links
    displayNotes();
}

function displayImage(index) {
    if (index < 0 || index >= allImages.length) return;

    currentImageIndex = index;
    const token = renderToken;
    const imageEl = document.getElementById('recipeImageMain');

    // Hole Bild-Daten mit Transformation
    const imageData = allImages[index];

    // Ersetze mit echtem Bild
    const img = document.createElement('img');
    img.src = resolveRecipeImageURL(imageData.dataUrl);
    img.alt = currentRecipe.name;
    img.onload = () => {
        if (token !== renderToken) return;
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
    [...currentRecipe.instructions]
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

async function displayRecipeVideo(token) {
    const section = document.getElementById('recipeVideoSection');
    const video = document.getElementById('recipeVideo');
    const error = document.getElementById('recipeVideoError');
    const recipeVideo = currentRecipe.video;
    const src = typeof recipeVideo?.src === 'string' ? recipeVideo.src.trim() : '';
    if (!src) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        error.hidden = true;
        section.hidden = true;
        return;
    }

    if (!/^videos\/recipes\/[^/\\]+(?:\.(?:mp4|webm|mov))?\.enc$/i.test(src)
        && !/^videos\/recipes\/[^/\\]+\.(?:mp4|webm|mov)$/i.test(src)) {
        console.warn('Ungültige Videoquelle im Rezept.');
        video.pause();
        video.removeAttribute('src');
        video.load();
        error.hidden = true;
        section.hidden = true;
        return;
    }
    error.hidden = true;
    section.hidden = false;
    try {
        const videoUrl = await generator.getRecipeVideoURL(currentRecipe);
        if (token !== renderToken) return;
        video.src = /^(?:blob:|data:|https?:|\/)/i.test(videoUrl)
            ? videoUrl
            : new URL(`${window.location.pathname.includes('/pages/') ? '../' : './'}${videoUrl}`, window.location.href).href;
        video.onerror = () => { error.hidden = false; };
    } catch (loadError) {
        if (token !== renderToken) return;
        console.error('Rezeptvideo konnte nicht entschlüsselt werden:', loadError);
        error.hidden = false;
    }
}

function displayNotes() {
    const sectionEl = document.getElementById('notesSection');
    const listEl = document.getElementById('notesList');

    if (!currentRecipe.notes || !currentRecipe.notes.some(note => typeof note === 'string')) {
        listEl.replaceChildren();
        sectionEl.style.display = 'none';
        return;
    }

    sectionEl.style.display = 'block';
    listEl.innerHTML = '';

    currentRecipe.notes.forEach(note => {
        if (typeof note !== 'string') return;
        const noteEl = document.createElement('div');
        noteEl.className = 'note-item';

        const value = note;
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

function getGradientForRecipe(recipeName) {
    const hash = recipeName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return `gradient-${(hash % 8) + 1}`;
}

function goBack() {
    window.location.href = '../index.html';
}

function editCurrentRecipe() {
    if (!currentRecipe) return;
    openRecipeEditor(currentRecipe.id);
}

async function onRecipeEditorSaved(recipe) {
    if (!recipe) return;
    currentRecipe = recipe;
    const recipeKey = recipe.id !== undefined && recipe.id !== null ? String(recipe.id) : recipe.name;
    localStorage.setItem('currentRecipe', recipeKey);
    const url = new URL(window.location.href);
    url.searchParams.set('id', recipeKey);
    window.history.replaceState(null, '', url);
    await displayRecipe();
}

globalThis.onRecipeEditorDeleted = goBack;

function printRecipe() {
    window.print();
}

function selectRandomRecipe() {
    const alternatives = generator.recipes.filter(recipe => recipe !== currentRecipe);
    const random = generator.getRandomRecipe(alternatives);
    if (random) {
        const recipeKey = random.id !== undefined && random.id !== null ? String(random.id) : random.name;
        localStorage.setItem('currentRecipe', recipeKey);
        const url = new URL(window.location.href);
        url.searchParams.set('id', recipeKey);
        window.history.pushState(null, '', url);
        currentRecipe = random;
        void displayRecipe();
    }
}

// ========================================
// Wake Lock Funktionalität
// ========================================

/**
 * Toggle Wake Lock on/off
 */
async function toggleWakeLock() {
    if (wakeLock !== null) {
        wakeLockRequested = false;
        await releaseWakeLock();
    } else {
        wakeLockRequested = true;
        await requestWakeLock();
    }
}

/**
 * Aktiviert Wake Lock
 */
async function requestWakeLock() {
    if (!wakeLockSupported) {
        wakeLockRequested = false;
        // Fallback für Browser ohne Wake Lock API
        showWakeLockFallbackMessage();
        return;
    }

    try {
        if (document.visibilityState !== 'visible') return;
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock aktiviert');

        // Update UI
        updateWakeLockButton(true);

        // Event Listener für automatische Freigabe (Tab-Wechsel, etc.)
        wakeLock.addEventListener('release', () => {
            console.log('Wake Lock automatisch freigegeben');
            wakeLock = null;
            updateWakeLockButton(false);
            if (wakeLockRequested && document.visibilityState === 'visible') requestWakeLock();
        });

    } catch (err) {
        console.error('Wake Lock Fehler:', err);
        wakeLockRequested = false;
        updateWakeLockButton(false);
        showWakeLockFallbackMessage('Display-Sperre konnte nicht aktiviert werden.');
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
function showWakeLockFallbackMessage(message = 'Wake Lock wird von deinem Browser nicht unterstützt.') {
    alert(`${message}\n\nTipp: Gehe zu deinen Geräteeinstellungen und stelle die Display-Timeout Zeit manuell ein.`);
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
    const scaledIngredients = originalIngredients.map(ingredient => ({
        ...ingredient,
        amount: scaleIngredientAmount(ingredient.amount, scaleFactor)
    }));
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

    // Portionsangaben können Strings sein („4“, „2-4“) – erst hier in eine Zahl umwandeln.
    originalServings = Number(currentRecipe.servings);

    if (!Number.isFinite(originalServings) || originalServings <= 0) {
        // Konnte keine gültige Portionsanzahl ermitteln
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
