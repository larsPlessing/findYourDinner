/** Lädt Rezeptdaten aus der JSON-Datei im Repository. */
export default class RecipeGenerator {
    constructor({ windowObject = globalThis.window, storage = globalThis.localStorage, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
        this.recipes = [];
        this.revision = null;
        this.window = windowObject;
        this.storage = storage;
        this.fetch = fetchImpl;
    }

    async loadFromURL(url, progressCallback = null) {
        try {
            if (this.window.location.protocol === 'file:') {
                throw new Error('Bei file:// muss recipes.json über die Dateiauswahl geladen werden.');
            }
            const data = await this.fetchRecipeData(url);
            this.recipes = data.recipes;
            this.revision = typeof data.revision === 'string' ? data.revision : null;
            this.normalizeCategories();
            if (progressCallback) progressCallback({ phase: 'complete', progress: 100, message: 'Rezepte geladen' });
            return this.recipes;
        } catch (error) {
            throw new Error(`Fehler beim Laden der Rezepte: ${error.message}`);
        }
    }

    async fetchRecipeData(url) {
        const response = await this.fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP-Fehler: ${response.status}`);
        const data = await response.json();
        if (!data || !Array.isArray(data.recipes)) throw new Error('Die JSON-Datei enthält keine gültige Rezeptliste.');
        return data;
    }

    getRecipeById(id) {
        if (id === null || id === undefined || id === '') return null;
        return this.recipes.find(recipe => String(recipe.id) === String(id)) || null;
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
    saveUserEditsToLocalStorage({ notify = true } = {}) {
        let previousRecipes = null;
        let legacyCacheRemoved = false;
        try {
            previousRecipes = this.storage.getItem('recipes');
            if (previousRecipes !== null) {
                this.storage.removeItem('recipes');
                legacyCacheRemoved = true;
            }
            this.storage.setItem('recipes_user_edits', JSON.stringify(this.recipes));
            return true;
        } catch (error) {
            if (legacyCacheRemoved) {
                try {
                    this.storage.setItem('recipes', previousRecipes);
                } catch (restoreError) {
                    console.error('Der vorherige Rezeptcache konnte nicht wiederhergestellt werden:', restoreError);
                }
            }
            console.error('Fehler beim Speichern der Rezeptänderungen:', error);
            if (notify) {
                this.window?.alert?.('Änderungen konnten nicht im Browser gespeichert werden. Der Speicher ist möglicherweise voll; entferne Bilder oder lösche nicht benötigte Rezepte.');
            }
            return false;
        }
    }
    saveToLocalStorage({ notify = true } = {}) {
        try {
            if (this.storage.getItem('recipes_user_edits') !== null) {
                this.storage.removeItem('recipes');
            } else {
                this.storage.setItem('recipes', JSON.stringify(this.recipes));
            }
            this.storage.setItem('recipes_timestamp', new Date().toISOString());
            if (this.revision) this.storage.setItem('recipes_revision', this.revision);
            else this.storage.removeItem('recipes_revision');
            return true;
        } catch (error) {
            console.error('Fehler beim Speichern:', error);
            if (notify) {
                this.window?.alert?.('Änderungen konnten nicht im Browser gespeichert werden. Der Speicher ist möglicherweise voll; entferne Bilder oder lösche nicht benötigte Rezepte.');
            }
            return false;
        }
    }
    saveRemoteRecipesToLocalStorage({ notify = true } = {}) {
        try {
            this.storage.setItem('recipes', JSON.stringify(this.recipes));
            this.storage.setItem('recipes_timestamp', new Date().toISOString());
            if (this.revision) this.storage.setItem('recipes_revision', this.revision);
            else this.storage.removeItem('recipes_revision');
            this.storage.removeItem('recipes_user_edits');
            return true;
        } catch (error) {
            console.error('Fehler beim Speichern der Standard-Rezeptversion:', error);
            if (notify) this.window?.alert?.('Die neue Rezeptversion konnte nicht im Browser gespeichert werden. Lokale Änderungen bleiben erhalten.');
            return false;
        }
    }
    loadFromLocalStorage() {
        try {
            const stored = this.storage.getItem('recipes');
            if (!stored) return false;
            this.recipes = JSON.parse(stored);
            if (!Array.isArray(this.recipes)) return false;
            this.revision = this.storage.getItem('recipes_revision') || null;
            this.normalizeCategories();
            return true;
        } catch (error) {
            console.error('Fehler beim Laden:', error);
            return false;
        }
    }
    async getRecipeImageURL(recipeOrIdOrName) {
        const images = await this.getAllRecipeImageURLs(recipeOrIdOrName);
        return images[0] || null;
    }
    async getAllRecipeImageURLs(recipeOrIdOrName) {
        const recipe = recipeOrIdOrName && typeof recipeOrIdOrName === 'object'
            ? recipeOrIdOrName
            : this.getRecipeById(recipeOrIdOrName) || this.getRecipeByName(recipeOrIdOrName);
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
    async hasRecipeImage(recipeOrIdOrName) {
        const recipe = recipeOrIdOrName && typeof recipeOrIdOrName === 'object'
            ? recipeOrIdOrName
            : this.getRecipeById(recipeOrIdOrName) || this.getRecipeByName(recipeOrIdOrName);
        return Boolean(recipe && recipe.images && recipe.images.length);
    }
    async clearAllData() {
        this.clearLocalStorage();
        this.recipes = [];
    }
    clearLocalStorage() {
        this.storage.removeItem('recipes');
        this.storage.removeItem('recipes_timestamp');
        this.storage.removeItem('recipes_revision');
    }
}

globalThis.RecipeGenerator = RecipeGenerator;
