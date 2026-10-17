/**
 * ImageStore - IndexedDB Manager für Rezeptbilder
 * Speichert und lädt Bilder offline-fähig
 */

export default class ImageStore {
    constructor() {
        this.dbName = 'RecipeImagesDB';
        this.dbVersion = 1;
        this.storeName = 'images';
        this.db = null;
    }

    /**
     * Initialisiert die IndexedDB
     * @returns {Promise<void>}
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                reject(new Error('IndexedDB konnte nicht geöffnet werden'));
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Erstelle Object Store falls nicht vorhanden
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'recipeName' });
                }
            };
        });
    }

    /**
     * Speichert ein oder mehrere Bilder für ein Rezept mit Transformationen
     * @param {string} recipeName - Name des Rezepts
     * @param {Blob|Blob[]} imageBlob - Bild als Blob oder Array von Blobs
     * @param {Object|Object[]} transforms - Transformations-Daten (optional)
     * @returns {Promise<void>}
     */
    async saveImage(recipeName, imageBlob, transforms = null) {
        if (!this.db) {
            await this.init();
        }

        // Normalisiere zu Array
        const imageBlobs = Array.isArray(imageBlob) ? imageBlob : [imageBlob];
        const transformsArray = transforms ? (Array.isArray(transforms) ? transforms : [transforms]) : [];

        // Fülle fehlende Transformationen mit Default-Werten
        while (transformsArray.length < imageBlobs.length) {
            transformsArray.push(this.getDefaultTransform());
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            const request = store.put({
                recipeName: recipeName,
                imageBlobs: imageBlobs,
                transforms: transformsArray, // NEU: Transformations-Metadaten
                timestamp: new Date().toISOString()
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(new Error(`Fehler beim Speichern von ${recipeName}`));
        });
    }

    /**
     * Lädt ein Bild für ein Rezept (erstes Bild)
     * @param {string} recipeName - Name des Rezepts
     * @returns {Promise<Blob|null>} Erstes Bild als Blob oder null wenn nicht gefunden
     */
    async getImage(recipeName) {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(recipeName);

            request.onsuccess = () => {
                const result = request.result;
                if (!result) {
                    resolve(null);
                    return;
                }
                
                // Unterstütze alte (imageBlob) und neue (imageBlobs[]) Struktur
                if (result.imageBlobs && result.imageBlobs.length > 0) {
                    resolve(result.imageBlobs[0]);
                } else if (result.imageBlob) {
                    resolve(result.imageBlob);
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => reject(new Error(`Fehler beim Laden von ${recipeName}`));
        });
    }

    /**
     * Lädt ALLE Bilder für ein Rezept
     * @param {string} recipeName - Name des Rezepts
     * @returns {Promise<Blob[]>} Array von Blobs oder leeres Array
     */
    async getAllImages(recipeName) {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(recipeName);

            request.onsuccess = () => {
                const result = request.result;
                if (!result) {
                    resolve([]);
                    return;
                }
                
                // Unterstütze alte (imageBlob) und neue (imageBlobs[]) Struktur
                if (result.imageBlobs && result.imageBlobs.length > 0) {
                    resolve(result.imageBlobs);
                } else if (result.imageBlob) {
                    resolve([result.imageBlob]);
                } else {
                    resolve([]);
                }
            };

            request.onerror = () => reject(new Error(`Fehler beim Laden von ${recipeName}`));
        });
    }

    /**
     * Gibt ein Bild als Data URL zurück (erstes Bild) mit Transformation
     * @param {string} recipeName - Name des Rezepts
     * @returns {Promise<{dataUrl: string, transform: Object}|null>} Objekt mit dataUrl und transform oder null
     */
    async getImageDataURL(recipeName) {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(recipeName);

            request.onsuccess = () => {
                const result = request.result;
                if (!result) {
                    resolve(null);
                    return;
                }
                
                let blob = null;
                let transform = this.getDefaultTransform();
                
                // Unterstütze alte (imageBlob) und neue (imageBlobs[]) Struktur
                if (result.imageBlobs && result.imageBlobs.length > 0) {
                    blob = result.imageBlobs[0];
                    if (result.transforms && result.transforms.length > 0) {
                        transform = result.transforms[0];
                    }
                } else if (result.imageBlob) {
                    blob = result.imageBlob;
                    transform = result.transform || this.getDefaultTransform();
                }
                
                if (!blob) {
                    resolve(null);
                    return;
                }
                
                const reader = new FileReader();
                reader.onloadend = () => resolve({
                    dataUrl: reader.result,
                    transform: transform
                });
                reader.readAsDataURL(blob);
            };

            request.onerror = () => reject(new Error(`Fehler beim Laden von ${recipeName}`));
        });
    }

    /**
     * Gibt Standard-Transformation zurück (keine Änderungen)
     * @returns {Object} Standard-Transformations-Objekt
     */
    getDefaultTransform() {
        return {
            rotation: 0,
            flipH: false,
            flipV: false,
            crop: {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0
            }
        };
    }

    /**
     * Gibt ALLE Bilder als Data URLs zurück mit Transformationen
     * @param {string} recipeName - Name des Rezepts
     * @returns {Promise<Array<{dataUrl: string, transform: Object}>>} Array von Objekten mit dataUrl und transform
     */
    async getAllImageDataURLs(recipeName) {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(recipeName);

            request.onsuccess = async () => {
                const result = request.result;
                if (!result) {
                    resolve([]);
                    return;
                }
                
                // Hole Blobs und Transformationen
                let blobs = [];
                let transforms = [];
                
                if (result.imageBlobs && result.imageBlobs.length > 0) {
                    blobs = result.imageBlobs;
                    transforms = result.transforms || [];
                } else if (result.imageBlob) {
                    blobs = [result.imageBlob];
                    transforms = [result.transform || this.getDefaultTransform()];
                }
                
                // Fülle fehlende Transformationen
                while (transforms.length < blobs.length) {
                    transforms.push(this.getDefaultTransform());
                }
                
                // Konvertiere Blobs zu Data URLs
                const dataURLPromises = blobs.map((blob, index) => {
                    return new Promise((resolveUrl) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolveUrl({
                            dataUrl: reader.result,
                            transform: transforms[index]
                        });
                        reader.readAsDataURL(blob);
                    });
                });

                const results = await Promise.all(dataURLPromises);
                resolve(results);
            };

            request.onerror = () => reject(new Error(`Fehler beim Laden von ${recipeName}`));
        });
    }

    /**
     * Prüft ob ein Bild existiert
     * @param {string} recipeName - Name des Rezepts
     * @returns {Promise<boolean>}
     */
    async hasImage(recipeName) {
        const image = await this.getImage(recipeName);
        return image !== null;
    }

    /**
     * Löscht ein Bild
     * @param {string} recipeName - Name des Rezepts
     * @returns {Promise<void>}
     */
    async deleteImage(recipeName) {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(recipeName);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(new Error(`Fehler beim Löschen von ${recipeName}`));
        });
    }

    /**
     * Löscht alle Bilder
     * @returns {Promise<void>}
     */
    async clearAll() {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(new Error('Fehler beim Löschen aller Bilder'));
        });
    }

    /**
     * Gibt die Anzahl gespeicherter Bilder zurück
     * @returns {Promise<number>}
     */
    async getCount() {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('Fehler beim Zählen der Bilder'));
        });
    }

    /**
     * Gibt alle gespeicherten Rezeptnamen zurück
     * @returns {Promise<string[]>}
     */
    async getAllRecipeNames() {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAllKeys();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('Fehler beim Abrufen der Rezeptnamen'));
        });
    }

    /**
     * Speichert mehrere Bilder auf einmal
     * @param {Object} imageMap - Map von recipeName → {blobs, transforms}
     * @param {Function} progressCallback - Fortschritts-Callback (optional)
     * @returns {Promise<{success: number, failed: number}>}
     */
    async saveMultiple(imageMap, progressCallback = null) {
        let success = 0;
        let failed = 0;
        const total = Object.keys(imageMap).length;

        for (const [recipeName, data] of Object.entries(imageMap)) {
            try {
                // data kann {blobs, transforms} oder direkt Blob/Blob[] sein
                if (data.blobs) {
                    await this.saveImage(recipeName, data.blobs, data.transforms);
                } else {
                    await this.saveImage(recipeName, data);
                }
                success++;
            } catch (error) {
                console.error(`Fehler beim Speichern von ${recipeName}:`, error);
                failed++;
            }

            if (progressCallback) {
                progressCallback({
                    current: success + failed,
                    total: total,
                    success: success,
                    failed: failed,
                    recipeName: recipeName
                });
            }
        }

        return { success, failed };
    }
}

// Globale Instanz erstellen
globalThis.imageStore = new ImageStore();
