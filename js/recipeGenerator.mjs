/** Lädt Rezeptdaten aus dem verschlüsselten Archiv im Repository. */
import { decryptAssetBytes, getSaltFromEnvelope, unlockRecipeEnvelope } from './recipeCrypto.mjs';

export default class RecipeGenerator {
    constructor({
        windowObject = globalThis.window,
        storage = globalThis.localStorage,
        fetchImpl = (...args) => globalThis.fetch(...args),
        unlockEnvelopeImpl = unlockRecipeEnvelope,
        getSaltImpl = getSaltFromEnvelope
    } = {}) {
        this.recipes = [];
        this.revision = null;
        this.window = windowObject;
        this.storage = storage;
        this.fetch = fetchImpl;
        this.unlockEnvelope = unlockEnvelopeImpl;
        this.getSalt = getSaltImpl;
        this.cryptoKey = null;
        this.encryptionSalt = null;
        this.mediaUrls = new Map();
    }

    async loadFromURL(url, progressCallback = null) {
        try {
            if (this.window.location.protocol === 'file:') {
                throw new Error('Bei file:// muss recipes.enc über die Dateiauswahl geladen werden.');
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
        const envelope = await response.json();
        return this.loadEncryptedEnvelope(envelope);
    }

    async loadEncryptedEnvelope(envelope) {
        const unlocked = await this.unlockEnvelope(envelope);
        if (!Array.isArray(unlocked.recipes)) throw new Error('Die entschlüsselte Datei enthält keine gültige Rezeptliste.');
        this.cryptoKey = unlocked.key;
        this.encryptionSalt = this.getSalt(envelope);
        return { recipes: unlocked.recipes, revision: envelope.revision };
    }

    async syncWithRemote(url, { hasLocalEdits = false, hasCachedRecipes = false } = {}) {
        const remote = await this.fetchRecipeData(url);
        const remoteRevision = remote.revision ?? null;
        const dismissedRevision = this.storage.getItem('recipes_dismissed_revision');
        const hasNewRevision = remoteRevision !== this.revision;
        const dismissedCurrentRevision = dismissedRevision === (remoteRevision ?? '');
        const shouldPrompt = hasLocalEdits
            && hasNewRevision
            && !dismissedCurrentRevision;

        if (shouldPrompt && !this.window.confirm(
            'Neue Rezeptversion verfügbar. Lokale Änderungen bleiben erhalten. Möchtest du die lokale Liste durch die neue Standardversion ersetzen?'
        )) {
            this.storage.setItem('recipes_dismissed_revision', remoteRevision ?? '');
            return { updated: false, remoteRevision };
        }

        if ((hasNewRevision && (!hasLocalEdits || !dismissedCurrentRevision)) || !hasCachedRecipes) {
            this.recipes = remote.recipes;
            this.revision = remoteRevision;
            this.normalizeCategories();
            const saved = hasLocalEdits
                ? this.saveRemoteRecipesToLocalStorage()
                : this.saveToLocalStorage();
            if (!saved) {
                throw new Error('Die neue Rezeptversion konnte nicht gespeichert werden. Lokale Änderungen wurden beibehalten.');
            }
            if (shouldPrompt) this.storage.removeItem('recipes_dismissed_revision');
            return { updated: true, remoteRevision };
        }

        return { updated: false, remoteRevision };
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
            return Promise.all(recipe.images.filter(image => image && image.src).map(async image => ({
                dataUrl: await this.getMediaURL(image.src, image.mimeType),
                transform: image.transform || this.defaultTransform()
            })));
        }
        return [];
    }
    async getMediaURL(src, mimeType = 'application/octet-stream') {
        if (/^(?:data:|blob:|https?:|\/)/i.test(src) || !src.endsWith('.enc')) return src;
        if (this.mediaUrls.has(src)) return this.mediaUrls.get(src);
        if (!this.cryptoKey) throw new Error('Das Rezeptarchiv ist nicht entsperrt.');
        const pagePath = this.window?.location?.pathname || '';
        const prefix = /\/pages\/[^/]+$/.test(pagePath) ? '../' : './';
        const response = await this.fetch(new URL(`${prefix}${src}`, this.window.location.href), { cache: 'force-cache' });
        if (!response.ok) throw new Error(`HTTP-Fehler beim Laden eines verschlüsselten Mediums: ${response.status}`);
        const encryptedBytes = await response.arrayBuffer();
        const blob = await decryptAssetBytes(encryptedBytes, this.cryptoKey, mimeType);
        const url = URL.createObjectURL(blob);
        this.mediaUrls.set(src, url);
        return url;
    }
    async getRecipeVideoURL(recipe) {
        const video = recipe?.video;
        if (!video || typeof video.src !== 'string') return null;
        return this.getMediaURL(video.src, video.mimeType);
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
        this.storage.removeItem('recipes_dismissed_revision');
    }
}

globalThis.RecipeGenerator = RecipeGenerator;
