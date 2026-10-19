// Seitenlogik der Startseite (index.html). Früher als Inline-<script> in der HTML.
import { applyImageTransform, generatePlaceholderImage, getRecipeEmoji } from './recipeDisplayUtils.mjs';

globalThis.generator = new RecipeGenerator();
let allRecipes = [];
let filteredRecipes = [];
let currentCategory = 'Salzig';
let healthyOnly = false;
let recipeImageObserver = null;

const searchInput = document.getElementById('searchInput');
const masonryGrid = document.getElementById('masonryGrid');
const loadingState = document.getElementById('loadingState');
const categoryFilter = document.getElementById('categoryFilter');
const uploadOverlay = document.getElementById('uploadOverlay');
const recipesJsonInput = document.getElementById('recipesJsonInput');
const uploadStatus = document.getElementById('uploadStatus');

searchInput.addEventListener('input', handleSearch);
recipesJsonInput.addEventListener('change', handleLocalJsonFile);

window.addEventListener('load', () => loadRecipes());

async function loadRecipes(forceRemote = false, confirmed = false) {
    try {
        loadingState.textContent = 'Lade Rezepte...';
        if (forceRemote) {
            if (!confirmed && !window.confirm('Lokale Änderungen gehen verloren. Fortfahren?')) return;
            await generator.loadFromURL('recipes.enc');
            if (localStorage.getItem('recipes_user_edits') !== null
                && !generator.saveRemoteRecipesToLocalStorage()) {
                throw new Error('Die neue Standardversion konnte nicht gespeichert werden. Lokale Änderungen wurden beibehalten.');
            }
            if (localStorage.getItem('recipes_user_edits') === null) generator.saveToLocalStorage();
            allRecipes = generator.getAllRecipes();
            filteredRecipes = [...allRecipes];
            initializeCategoryFilter();
            applyFilters('');
            uploadOverlay.style.display = 'none';
            uploadStatus.textContent = '';
            uploadStatus.classList.remove('error');
            return;
        }
        const savedRecipes = forceRemote ? null : localStorage.getItem('recipes_user_edits');
        let loadedFromCache = false;
        let hasLocalEdits = false;
        if (savedRecipes) {
            const parsed = JSON.parse(savedRecipes);
            if (!Array.isArray(parsed)) throw new Error('Lokal gespeicherte Rezeptdaten sind ungültig.');
            generator.recipes = parsed;
            generator.revision = localStorage.getItem('recipes_revision') || null;
            generator.normalizeCategories();
            localStorage.removeItem('recipes');
            loadedFromCache = true;
            hasLocalEdits = true;
        } else if (!forceRemote && generator.loadFromLocalStorage()) {
            loadedFromCache = true;
        }
        if (window.location.protocol !== 'file:') {
            try {
                await generator.syncWithRemote('recipes.enc', {
                    hasLocalEdits,
                    hasCachedRecipes: loadedFromCache
                });
            } catch (error) {
                if (!loadedFromCache) throw error;
                console.warn(`Neue Rezeptversion konnte nicht geprüft werden: ${error.message}`);
            }
        } else if (!loadedFromCache) {
            await generator.loadFromURL('recipes.enc');
            generator.saveToLocalStorage();
        }
        allRecipes = generator.getAllRecipes();
        filteredRecipes = [...allRecipes];
        initializeCategoryFilter();
        applyFilters('');
        uploadOverlay.style.display = 'none';
        uploadStatus.textContent = '';
        uploadStatus.classList.remove('error');
    } catch (error) {
        loadingState.style.display = 'none';
        showUploadDialog();
        uploadStatus.textContent = `Rezepte konnten nicht automatisch geladen werden: ${error.message}`;
        uploadStatus.classList.add('error');
    }
}

async function loadRecipesFile(file) {
    const data = JSON.parse(await file.text());
    if (data?.kdf === 'PBKDF2-SHA-256') {
        const unlocked = await generator.loadEncryptedEnvelope(data);
        generator.recipes = unlocked.recipes;
        generator.revision = unlocked.revision || null;
    } else {
        if (!Array.isArray(data.recipes)) throw new Error('Die Datei enthält keine Rezeptliste.');
        generator.recipes = data.recipes;
    }
    // Eine lokal gewählte Datei hat keine Server-Revision.
    generator.revision = null;
    generator.normalizeCategories();
    if (generator.saveUserEditsToLocalStorage() === false) {
        throw new Error('Der Browser-Speicher ist voll. Entferne Bilder oder lösche nicht benötigte Rezepte.');
    }
    if (generator.saveToLocalStorage() === false) {
        throw new Error('Der Browser-Speicher ist voll. Entferne Bilder oder lösche nicht benötigte Rezepte.');
    }
    allRecipes = generator.getAllRecipes();
    filteredRecipes = [...allRecipes];
    uploadOverlay.style.display = 'none';
    uploadStatus.textContent = '';
    loadingState.style.display = 'none';
    initializeCategoryFilter();
    applyFilters('');
}

async function handleLocalJsonFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        if (!/\.(?:json|enc)$/i.test(file.name)) throw new Error('Bitte eine Rezeptdatei (.enc oder .json) auswählen.');
        await loadRecipesFile(file);
    } catch (error) {
        uploadStatus.textContent = `JSON-Datei konnte nicht geladen werden: ${error.message}`;
        uploadStatus.classList.add('error');
    }
}

function showUploadDialog() {
    uploadStatus.textContent = '';
    uploadStatus.classList.remove('error');
    uploadOverlay.style.display = 'flex';
}

function closeUploadOverlay() {
    uploadOverlay.style.display = 'none';
    if (allRecipes.length > 0) displayRecipes();
}

async function loadDefaultRecipes() {
    uploadStatus.textContent = '';
    uploadStatus.classList.remove('error');
    try {
        await loadRecipes(true);
        if (allRecipes.length === 0) uploadOverlay.style.display = 'flex';
    } catch (error) {
        uploadStatus.textContent = `Rezepte konnten nicht geladen werden: ${error.message}`;
        uploadStatus.classList.add('error');
    }
}

async function displayRecipes() {
    loadingState.style.display = 'none';
    masonryGrid.innerHTML = '';

    if (filteredRecipes.length === 0) {
        masonryGrid.innerHTML = '<div class="no-results">Keine Rezepte gefunden</div>';
        return;
    }

    // Zeige zunächst Platzhalter
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < filteredRecipes.length; index++) {
        const recipe = filteredRecipes[index];
        const item = document.createElement('div');
        item.className = 'masonry-item';

        const emoji = getRecipeEmoji(recipe.name);
        const gradient = `gradient-${(index % 8) + 1}`;
        const heightClass = getRandomHeight(recipe.name);

        const pin = document.createElement('div');
        pin.className = 'recipe-pin';
        pin.addEventListener('click', () => openRecipe(recipe));

        const image = document.createElement('div');
        image.className = `recipe-pin-image ${gradient} ${heightClass}`;
        if (recipe.id !== undefined && recipe.id !== null) image.dataset.recipeId = String(recipe.id);
        else image.dataset.recipeName = recipe.name;
        image.textContent = emoji;

        const content = document.createElement('div');
        content.className = 'recipe-pin-content';
        const title = document.createElement('div');
        title.className = 'recipe-pin-title';
        title.textContent = recipe.name;
        content.appendChild(title);

        if (recipe.category) {
            const category = document.createElement('div');
            category.className = 'recipe-category-badge';
            category.textContent = recipe.healthy ? `${recipe.category} · healthy` : recipe.category;
            content.appendChild(category);
        }

        if (recipe.isPlaceholder) {
            const placeholder = document.createElement('div');
            placeholder.className = 'recipe-placeholder-badge';
            placeholder.textContent = '⏳ In Vorbereitung';
            content.appendChild(placeholder);
        }

        const info = document.createElement('div');
        info.className = 'recipe-pin-info';
        if (recipe.servings) {
            const servings = document.createElement('div');
            servings.className = 'recipe-pin-info-item';
            servings.textContent = `👥 ${recipe.servings} Portionen`;
            info.appendChild(servings);
        }
        if (recipe.ingredients && !recipe.isPlaceholder) {
            const ingredientCount = document.createElement('div');
            ingredientCount.className = 'recipe-pin-info-item';
            ingredientCount.textContent = `📝 ${recipe.ingredients.length} Zutaten`;
            info.appendChild(ingredientCount);
        }
        content.appendChild(info);

        const overlay = document.createElement('div');
        overlay.className = 'recipe-pin-overlay';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Rezept ansehen';
        overlay.appendChild(button);

        pin.append(image, content, overlay);
        item.appendChild(pin);

        fragment.appendChild(item);
    }

    masonryGrid.appendChild(fragment);

    // Lade echte Bilder asynchron
    loadRecipeImages();
}

async function loadRecipeImages() {
    // Chrome iOS optimization: Load images in batches with IntersectionObserver
    recipeImageObserver?.disconnect();
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const imageEl = entry.target;
                const recipe = imageEl.dataset.recipeId
                    ? generator.getRecipeById(imageEl.dataset.recipeId)
                    : generator.getRecipeByName(imageEl.dataset.recipeName);
                if (recipe) loadSingleRecipeImage(recipe, imageEl);
                observer.unobserve(imageEl);
            }
        });
    }, {
        root: null,
        rootMargin: '50px', // Start loading 50px before visible
        threshold: 0.01
    });
    recipeImageObserver = observer;

    // Observe all recipe images
    const recipeImages = document.querySelectorAll('[data-recipe-id], [data-recipe-name]');
    recipeImages.forEach(img => observer.observe(img));
}

async function loadSingleRecipeImage(recipe, imageEl) {
    try {
        const imageData = await generator.getRecipeImageURL(recipe);

        if (!imageEl || !recipe) return;

        if (imageData && imageData.dataUrl) {
            // Verwende echtes Bild mit Transformationen
            const img = document.createElement('img');
            img.src = imageData.dataUrl;
            img.alt = recipe.name;
            img.loading = 'lazy';
            img.style.width = '100%';
            img.style.height = '100%';
            // Wende Transformationen an
            applyImageTransform(img, imageData.transform);

            imageEl.innerHTML = '';
            imageEl.appendChild(img);
            imageEl.classList.remove('gradient-1', 'gradient-2', 'gradient-3', 'gradient-4', 'gradient-5', 'gradient-6', 'gradient-7', 'gradient-8');
        } else {
            // Generiere Placeholder
            const placeholder = generatePlaceholderImage(recipe.name, getRecipeEmoji(recipe.name));
            const img = document.createElement('img');
            img.src = placeholder;
            img.alt = recipe.name;
            img.loading = 'lazy';
            img.style.width = '100%';
            img.style.height = '100%';

            imageEl.innerHTML = '';
            imageEl.appendChild(img);
        }
    } catch (error) {
        console.warn(`Bild für ${recipe.name} konnte nicht geladen werden:`, error);
    }
}

/**
 * Wendet CSS-Transformationen auf ein Bild-Element an
 * @param {HTMLImageElement} imgElement - Das Bild-Element
 * @param {Object} transform - Transformations-Objekt
 */
function getRandomHeight(seed) {
    // Konsistente Höhe basierend auf Namen
    const hash = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const heights = ['tall', 'short'];
    return heights[hash % heights.length];
}

function handleSearch(e) {
    const searchTerm = e.target.value;
    applyFilters(searchTerm);
}

function filterByCategory(category) {
    if (category === 'Alle') {
        currentCategory = null;
        healthyOnly = false;
    } else if (category === 'healthy') {
        healthyOnly = !healthyOnly;
    } else {
        currentCategory = currentCategory === category ? null : category;
    }
    updateCategoryFilterState();
    applyFilters(searchInput.value);
}

function applyFilters(searchTerm) {
    let recipes = currentCategory
        ? generator.filterByCategory(currentCategory, healthyOnly)
        : healthyOnly ? generator.filterByCategory('healthy') : allRecipes;

    // Dann nach Suchbegriff filtern
    if (searchTerm && searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase().trim();
        recipes = recipes.filter(recipe => 
            recipe.name.toLowerCase().includes(term)
        );
    }

    filteredRecipes = recipes;
    displayRecipes();
}

function initializeCategoryFilter() {
    const categories = generator.getAllCategories();

    if (categories.length === 0) {
        categoryFilter.style.display = 'none';
        return;
    }

    const allCategoriesButton = document.createElement('button');
    allCategoriesButton.type = 'button';
    allCategoriesButton.className = 'category-chip';
    allCategoriesButton.dataset.category = 'Alle';
    allCategoriesButton.textContent = 'Alle';
    allCategoriesButton.addEventListener('click', () => filterByCategory('Alle'));
    categoryFilter.replaceChildren(allCategoriesButton);

    categories.forEach(category => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category-chip';
        button.dataset.category = category;
        button.textContent = category;
        button.addEventListener('click', () => filterByCategory(category));
        categoryFilter.appendChild(button);
    });

    updateCategoryFilterState();
    categoryFilter.style.display = 'flex';
}

function updateCategoryFilterState() {
    document.querySelectorAll('.category-chip').forEach(chip => {
        const category = chip.dataset.category;
        const active = category === 'Alle'
            ? !currentCategory && !healthyOnly
            : category === 'healthy'
                ? healthyOnly
                : category === currentCategory;
        chip.classList.toggle('active', active);
        chip.setAttribute('aria-pressed', String(active));
    });
}

function shuffleRecipes() {
    // Fisher-Yates shuffle algorithm
    filteredRecipes = [...filteredRecipes];
    for (let i = filteredRecipes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [filteredRecipes[i], filteredRecipes[j]] = [filteredRecipes[j], filteredRecipes[i]];
    }
    displayRecipes();
}

function openRecipe(recipe) {
    // Die ID im URL-Query macht Deep Links tab- und reloadsicher.
    const recipeKey = recipe && recipe.id !== undefined && recipe.id !== null ? String(recipe.id) : recipe.name;
    localStorage.setItem('currentRecipe', recipeKey);
    const url = new URL('pages/recipe-detail.html', window.location.href);
    url.searchParams.set('id', recipeKey);
    window.location.href = url.href;
}

globalThis.refreshRecipesAfterEdit = () => {
    allRecipes = generator.recipes;
    initializeCategoryFilter();
    applyFilters(searchInput.value);
};
// Früher für onclick-Attribute nötig – wird nur noch von recipeEditor.mjs genutzt (refreshRecipesAfterEdit oben).

// --- Event-Wiring (ersetzt die onclick-Attribute aus index.html) ---
document.getElementById('shuffleBtn').addEventListener('click', shuffleRecipes);
document.getElementById('uploadRecipesBtn').addEventListener('click', () => showUploadDialog());
document.getElementById('openEditorBtn').addEventListener('click', () => openRecipeEditor());
document.getElementById('categoryChipAll').addEventListener('click', () => filterByCategory('Alle'));
document.getElementById('loadDefaultRecipesBtn').addEventListener('click', () => loadDefaultRecipes());
document.getElementById('closeUploadOverlayBtn').addEventListener('click', closeUploadOverlay);
