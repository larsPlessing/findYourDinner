/** Lädt Rezeptdaten aus der JSON-Datei im Repository. */
export default class RecipeGenerator {
    constructor() {
        this.recipes = [];
        this.imageStore = typeof imageStore !== 'undefined' ? imageStore : null;
        this.hasImages = false;
    }

    async loadFromURL(url, progressCallback = null) {
        try {
            if (window.location.protocol === 'file:') {
                throw new Error('Bei file:// muss recipes.json über die Dateiauswahl geladen werden.');
            }
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) throw new Error(`HTTP-Fehler: ${response.status}`);
            const data = await response.json();
            if (!data || !Array.isArray(data.recipes)) throw new Error('Die JSON-Datei enthält keine gültige Rezeptliste.');
            this.recipes = data.recipes;
            this.normalizeCategories();
            this.hasImages = this.recipes.some(recipe => recipe.images && recipe.images.length > 0);
            if (progressCallback) progressCallback({ phase: 'complete', progress: 100, message: 'Rezepte geladen' });
            return this.recipes;
        } catch (error) {
            throw new Error(`Fehler beim Laden der Rezepte: ${error.message}`);
        }
    }

    getRecipeByName(name) { return this.recipes.find(recipe => recipe.name === name || recipe.sheetName === name) || null; }
    getAllRecipes() { return this.recipes; }
    normalizeCategories() {
        this.recipes = this.recipes.map(recipe => {
            const legacyCategories = Array.isArray(recipe.categories) ? recipe.categories : [];
            const categoryLabels = [recipe.category, ...legacyCategories].filter(value => typeof value === 'string');
            const categoryText = categoryLabels.join(' ').toLocaleLowerCase('de');
            const { categories, ...normalizedRecipe } = recipe;
            return {
                ...normalizedRecipe,
                category: /süß|süss|sweet|nachtisch|dessert/.test(categoryText) ? 'Süß' : 'Salzig',
                healthy: recipe.healthy === true || categoryLabels.some(value => value.toLocaleLowerCase('de') === 'healthy')
            };
        });
    }
    async syncHealthyClassifications(url) {
        const migrationKey = 'healthy_classification_version';
        if (localStorage.getItem(migrationKey) === '1') return false;

        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP-Fehler: ${response.status}`);
        const data = await response.json();
        if (!data || !Array.isArray(data.recipes)) throw new Error('Die JSON-Datei enthält keine gültige Rezeptliste.');

        const healthyIds = new Set(data.recipes.filter(recipe => recipe.healthy === true).map(recipe => String(recipe.id)));
        this.recipes = this.recipes.map(recipe => ({
            ...recipe,
            healthy: recipe.healthy === true || healthyIds.has(String(recipe.id))
        }));
        if (localStorage.getItem('recipes_user_edits') !== null) {
            localStorage.setItem('recipes_user_edits', JSON.stringify(this.recipes));
        }
        this.saveToLocalStorage();
        localStorage.setItem(migrationKey, '1');
        return true;
    }
    searchRecipes(term) {
        if (!term || !term.trim()) return this.recipes;
        const query = term.toLocaleLowerCase('de').trim();
        return this.recipes.filter(recipe => recipe.name.toLocaleLowerCase('de').includes(query));
    }
    filterByCategory(category, healthyOnly = false) {
        return this.recipes.filter(recipe =>
            (!category || category === 'Alle' || category === 'healthy' || recipe.category === category)
            && (category !== 'healthy' || recipe.healthy)
            && (!healthyOnly || recipe.healthy)
        );
    }
    getAllCategories() {
        return ['Salzig', 'Süß', 'healthy'];
    }
    getRandomRecipe(list = this.recipes) {
        return list.length ? list[Math.floor(Math.random() * list.length)] : null;
    }
    getRandomRecipes(count) { return [...this.recipes].sort(() => Math.random() - 0.5).slice(0, count); }
    saveToLocalStorage() {
        try {
            localStorage.setItem('recipes', JSON.stringify(this.recipes));
            localStorage.setItem('recipes_timestamp', new Date().toISOString());
            return true;
        } catch (error) {
            console.error('Fehler beim Speichern:', error);
            return false;
        }
    }
    loadFromLocalStorage() {
        try {
            const stored = localStorage.getItem('recipes');
            if (!stored) return false;
            this.recipes = JSON.parse(stored);
            if (!Array.isArray(this.recipes)) return false;
            this.normalizeCategories();
            return true;
        } catch (error) {
            console.error('Fehler beim Laden:', error);
            return false;
        }
    }
    async getRecipeImageURL(name) {
        const images = await this.getAllRecipeImageURLs(name);
        return images[0] || null;
    }
    async getAllRecipeImageURLs(name) {
        const recipe = this.getRecipeByName(name);
        if (recipe && Array.isArray(recipe.images)) {
            return recipe.images.filter(image => image && image.src).map(image => ({
                dataUrl: image.src,
                transform: image.transform || this.defaultTransform()
            }));
        }
        return [];
    }
    defaultTransform() {
        return { rotation: 0, flipH: false, flipV: false, crop: { left: 0, top: 0, right: 0, bottom: 0 } };
    }
    async hasRecipeImage(name) {
        const recipe = this.getRecipeByName(name);
        return Boolean(recipe && recipe.images && recipe.images.length);
    }
    async clearAllData() {
        this.clearLocalStorage();
        this.recipes = [];
        this.hasImages = false;
    }
    async getStats() {
        const withImages = this.recipes.filter(recipe => recipe.images && recipe.images.length).length;
        return { total: this.recipes.length, withImages, timestamp: localStorage.getItem('recipes_timestamp'), hasImages: withImages > 0 };
    }
    clearLocalStorage() {
        localStorage.removeItem('recipes');
        localStorage.removeItem('recipes_timestamp');
    }
}

globalThis.RecipeGenerator = RecipeGenerator;
