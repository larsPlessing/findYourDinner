// Seitenlogik der Startseite (index.html). Früher als Inline-<script> in der HTML.
globalThis.generator = new RecipeGenerator();
let allRecipes = [];
let filteredRecipes = [];
let currentCategory = 'Salzig';
let healthyOnly = false;

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

async function loadRecipes(forceRemote = false) {
    try {
        loadingState.textContent = 'Lade Rezepte...';
        if (forceRemote) {
            localStorage.removeItem('recipes_user_edits');
            localStorage.removeItem('recipes_revision');
        }
        const savedRecipes = forceRemote ? null : localStorage.getItem('recipes_user_edits');
        let loadedFromCache = false;
        if (savedRecipes) {
            const parsed = JSON.parse(savedRecipes);
            if (!Array.isArray(parsed)) throw new Error('Lokal gespeicherte Rezeptdaten sind ungültig.');
            generator.recipes = parsed;
            generator.revision = localStorage.getItem('recipes_revision') || null;
            generator.normalizeCategories();
            generator.hasImages = parsed.some(recipe => recipe.images && recipe.images.length);
            loadedFromCache = true;
        } else if (!forceRemote && generator.loadFromLocalStorage()) {
            generator.hasImages = generator.recipes.some(recipe => recipe.images && recipe.images.length);
            loadedFromCache = true;
        } else {
            await generator.loadFromURL('recipes.json');
            generator.saveToLocalStorage();
        }
        if (loadedFromCache && window.location.protocol !== 'file:') {
            try {
                await generator.syncHealthyClassifications('recipes.json');
            } catch (error) {
                console.warn(`Healthy-Kennzeichnungen konnten nicht aktualisiert werden: ${error.message}`);
            }
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
    if (!Array.isArray(data.recipes)) throw new Error('Die Datei enthält keine Rezeptliste.');
    generator.recipes = data.recipes;
    // Eine lokal gewählte Datei hat keine Server-Revision.
    generator.revision = null;
    generator.normalizeCategories();
    generator.hasImages = data.recipes.some(recipe => recipe.images && recipe.images.length > 0);
    localStorage.setItem('recipes_user_edits', JSON.stringify(generator.recipes));
    generator.saveToLocalStorage();
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
        if (!file.name.toLowerCase().endsWith('.json')) throw new Error('Bitte eine JSON-Datei auswählen.');
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
        item.dataset.recipeName = recipe.name;

        const emoji = getRecipeEmoji(recipe.name);
        const gradient = `gradient-${(index % 8) + 1}`;
        const heightClass = getRandomHeight(recipe.name);

        const pin = document.createElement('div');
        pin.className = 'recipe-pin';
        pin.addEventListener('click', () => openRecipe(recipe));

        const image = document.createElement('div');
        image.className = `recipe-pin-image ${gradient} ${heightClass}`;
        image.dataset.recipe = recipe.name;
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
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const imageEl = entry.target;
                const recipeName = imageEl.dataset.recipe;
                loadSingleRecipeImage(recipeName, imageEl);
                observer.unobserve(imageEl);
            }
        });
    }, {
        root: null,
        rootMargin: '50px', // Start loading 50px before visible
        threshold: 0.01
    });

    // Observe all recipe images
    const recipeImages = document.querySelectorAll('[data-recipe]');
    recipeImages.forEach(img => observer.observe(img));
}

async function loadSingleRecipeImage(recipeName, imageEl) {
    try {
        const imageData = await generator.getRecipeImageURL(recipeName);
        const recipe = filteredRecipes.find(r => r.name === recipeName);

        if (!imageEl || !recipe) return;

        if (imageData && imageData.dataUrl) {
            // Verwende echtes Bild mit Transformationen
            const img = document.createElement('img');
            img.src = imageData.dataUrl;
            img.alt = recipe.name;
            img.loading = 'lazy';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';

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
            img.style.objectFit = 'contain';

            imageEl.innerHTML = '';
            imageEl.appendChild(img);
        }
    } catch (error) {
        console.warn(`Bild für ${recipeName} konnte nicht geladen werden:`, error);
    }
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

        // Verwende object-position für Cropping-Effekt
        imgElement.style.clipPath = `inset(${top}% ${100-right}% ${100-bottom}% ${left}%)`;
    }
}

function generatePlaceholderImage(recipeName, emoji) {
    // Erstelle SVG Placeholder mit Emoji und Rezeptname
    const hash = recipeName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const gradients = [
        'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
        'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
        'linear-gradient(135deg, #ff9a56 0%, #ff6a88 100%)'
    ];

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
    const displayName = recipeName.length > 25 ? recipeName.substring(0, 22) + '...' : recipeName;
    const safeDisplayName = displayName.replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;'
    })[character]);

    const svg = `
        <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${colorPair[0]};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${colorPair[1]};stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="400" height="400" fill="url(#grad${hash})"/>
            <text x="200" y="180" font-size="120" text-anchor="middle" fill="white" opacity="0.9">${emoji}</text>
            <text x="200" y="280" font-size="24" text-anchor="middle" fill="white" font-weight="600" opacity="0.95">${safeDisplayName}</text>
        </svg>
    `;

    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
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

    return '🍽️';
}

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
    // Speichere die Rezept-ID (Fallback: Name) und öffne Detail-Seite
    const recipeKey = recipe && recipe.id !== undefined && recipe.id !== null ? String(recipe.id) : recipe.name;
    localStorage.setItem('currentRecipe', recipeKey);
    window.location.href = 'pages/recipe-detail.html';
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
