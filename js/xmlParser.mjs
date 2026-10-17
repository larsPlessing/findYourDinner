/**
 * XMLParser - Helper für XML-Parsing in Excel-Dateien
 */

export default class XMLParser {
    /**
     * Parst XML-String zu DOM
     * @param {string} xmlString - XML als String
     * @returns {Document} XML Document
     */
    static parseXML(xmlString) {
        const parser = new DOMParser();
        return parser.parseFromString(xmlString, 'text/xml');
    }

    /**
     * Extrahiert Sheet-Namen und IDs aus workbook.xml
     * @param {string} workbookXML - Inhalt von xl/workbook.xml
     * @returns {Array<{name: string, sheetId: string, index: number}>}
     */
    static extractSheetInfo(workbookXML) {
        const doc = this.parseXML(workbookXML);
        const sheets = doc.getElementsByTagName('sheet');
        const sheetInfo = [];

        for (let i = 0; i < sheets.length; i++) {
            const sheet = sheets[i];
            sheetInfo.push({
                name: sheet.getAttribute('name'),
                sheetId: sheet.getAttribute('sheetId'),
                rId: sheet.getAttribute('r:id'),
                index: i + 1
            });
        }

        return sheetInfo;
    }

    /**
     * Extrahiert Drawing-Referenz aus Sheet-Relationships
     * @param {string} relsXML - Inhalt von xl/worksheets/_rels/sheet*.xml.rels
     * @returns {string|null} Drawing-Pfad oder null
     */
    static extractDrawingPath(relsXML) {
        const doc = this.parseXML(relsXML);
        const relationships = doc.getElementsByTagName('Relationship');

        for (let i = 0; i < relationships.length; i++) {
            const rel = relationships[i];
            const target = rel.getAttribute('Target');
            
            if (target && target.includes('drawing')) {
                // Konvertiere relativen Pfad zu absolutem
                return 'xl/' + target.replace('../', '');
            }
        }

        return null;
    }

    /**
     * Extrahiert Bild-Referenzen aus Drawing-Relationships
     * @param {string} drawingRelsXML - Inhalt von xl/drawings/_rels/drawing*.xml.rels
     * @returns {Array<string>} Array von Bild-Pfaden
     */
    static extractImagePaths(drawingRelsXML) {
        const doc = this.parseXML(drawingRelsXML);
        const relationships = doc.getElementsByTagName('Relationship');
        const imagePaths = [];

        for (let i = 0; i < relationships.length; i++) {
            const rel = relationships[i];
            const target = rel.getAttribute('Target');
            const type = rel.getAttribute('Type');

            if (target && (target.includes('image') || type && type.includes('image'))) {
                // Konvertiere relativen Pfad zu absolutem
                const imagePath = 'xl/' + target.replace('../', '');
                imagePaths.push(imagePath);
            }
        }

        return imagePaths;
    }

    /**
     * Erstellt vollständiges Sheet → Image Mapping mit Transformationen
     * @param {JSZip} zip - JSZip Instanz der Excel-Datei
     * @returns {Promise<Object>} Map von SheetName → Array von {path, transform}
     */
    static async createSheetImageMapping(zip) {
        const mapping = {};

        try {
            // 1. Lese workbook.xml für Sheet-Namen
            const workbookXML = await zip.file('xl/workbook.xml').async('text');
            const sheets = this.extractSheetInfo(workbookXML);

            // 2. Für jedes Sheet: Finde zugehöriges Bild
            for (const sheet of sheets) {
                const sheetIndex = sheet.index;
                const relsPath = `xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`;

                // Prüfe ob Relationships existieren
                const relsFile = zip.file(relsPath);
                if (!relsFile) continue;

                // 3. Lese Sheet-Relationships
                const relsXML = await relsFile.async('text');
                const drawingPath = this.extractDrawingPath(relsXML);
                
                if (!drawingPath) continue;

                // 4. Lese Drawing XML für Transformationen
                const drawingFile = zip.file(drawingPath);
                if (!drawingFile) continue;
                
                const drawingXML = await drawingFile.async('text');

                // 5. Lese Drawing-Relationships für Bild-Pfade
                const drawingRelsPath = drawingPath.replace('/drawings/', '/drawings/_rels/') + '.rels';
                const drawingRelsFile = zip.file(drawingRelsPath);
                
                if (!drawingRelsFile) continue;

                const drawingRelsXML = await drawingRelsFile.async('text');
                const imagePaths = this.extractImagePaths(drawingRelsXML);

                // 6. Extrahiere Transformationen aus Drawing XML
                const imageTransforms = this.extractImageTransforms(drawingXML, imagePaths.length);

                // 7. Kombiniere Pfade mit Transformationen
                if (imagePaths.length > 0) {
                    mapping[sheet.name] = imagePaths.map((path, index) => ({
                        path: path,
                        transform: imageTransforms[index] || this.getDefaultTransform()
                    }));
                }
            }

        } catch (error) {
            console.error('Fehler beim Erstellen des Sheet-Image-Mappings:', error);
        }

        return mapping;
    }

    /**
     * Hilfsfunktion: Gibt alle verfügbaren Bilder im ZIP zurück
     * @param {JSZip} zip - JSZip Instanz
     * @returns {Array<string>} Liste aller Bildpfade
     */
    static getAllImagePaths(zip) {
        const imagePaths = [];
        
        zip.folder('xl/media').forEach((relativePath, file) => {
            if (!file.dir) {
                imagePaths.push('xl/media/' + relativePath);
            }
        });

        return imagePaths;
    }

    /**
     * Extrahiert Dateiendung aus Pfad
     * @param {string} path - Dateipfad
     * @returns {string} Dateiendung (z.B. 'png', 'jpeg')
     */
    static getFileExtension(path) {
        const parts = path.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    }

    /**
     * Bestimmt MIME-Type basierend auf Dateiendung
     * @param {string} extension - Dateiendung
     * @returns {string} MIME-Type
     */
    static getMimeType(extension) {
        const mimeTypes = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'bmp': 'image/bmp',
            'webp': 'image/webp'
        };

        return mimeTypes[extension.toLowerCase()] || 'image/png';
    }

    /**
     * Extrahiert Bild-Transformationen aus Drawing XML
     * @param {string} drawingXML - Inhalt von xl/drawings/drawing*.xml
     * @param {number} imageCount - Anzahl der erwarteten Bilder
     * @returns {Array<Object>} Array von Transformations-Objekten
     */
    static extractImageTransforms(drawingXML, imageCount) {
        const transforms = [];
        const doc = this.parseXML(drawingXML);
        
        // Suche alle <xdr:pic> Elemente (einzelne Bilder)
        const pics = doc.getElementsByTagName('xdr:pic');
        
        for (let i = 0; i < pics.length && i < imageCount; i++) {
            const pic = pics[i];
            const transform = this.extractSingleImageTransform(pic);
            transforms.push(transform);
        }
        
        return transforms;
    }

    /**
     * Extrahiert Transformation eines einzelnen Bildes
     * @param {Element} picElement - <xdr:pic> XML Element
     * @returns {Object} Transformations-Objekt
     */
    static extractSingleImageTransform(picElement) {
        const transform = this.getDefaultTransform();
        
        try {
            // 1. Suche <xdr:spPr> für Shape-Properties (enthält Rotation/Flip)
            const spPr = picElement.getElementsByTagName('xdr:spPr')[0];
            if (spPr) {
                const xfrm = spPr.getElementsByTagName('a:xfrm')[0];
                if (xfrm) {
                    // Rotation aus rot attribute
                    if (xfrm.hasAttribute('rot')) {
                        const rotValue = parseInt(xfrm.getAttribute('rot'));
                        // Excel speichert Rotation in 60000stel Grad
                        transform.rotation = rotValue / 60000;
                    }
                    
                    // Flip aus flipH und flipV attributes
                    if (xfrm.hasAttribute('flipH')) {
                        transform.flipH = xfrm.getAttribute('flipH') === '1';
                    }
                    if (xfrm.hasAttribute('flipV')) {
                        transform.flipV = xfrm.getAttribute('flipV') === '1';
                    }
                }
            }
            
            // 2. Cropping aus <xdr:blipFill> oder <a:blipFill>
            const blipFill = picElement.getElementsByTagName('xdr:blipFill')[0];
            
            if (blipFill) {
                const srcRect = blipFill.getElementsByTagName('a:srcRect')[0];
                if (srcRect && srcRect.attributes.length > 0) {
                    // srcRect attributes: l, t, r, b (left, top, right, bottom)
                    // Werte sind in Prozent * 1000 (z.B. 10000 = 10%)
                    if (srcRect.hasAttribute('l')) {
                        transform.crop.left = parseInt(srcRect.getAttribute('l')) / 1000;
                    }
                    if (srcRect.hasAttribute('t')) {
                        transform.crop.top = parseInt(srcRect.getAttribute('t')) / 1000;
                    }
                    if (srcRect.hasAttribute('r')) {
                        transform.crop.right = parseInt(srcRect.getAttribute('r')) / 1000;
                    }
                    if (srcRect.hasAttribute('b')) {
                        transform.crop.bottom = parseInt(srcRect.getAttribute('b')) / 1000;
                    }
                }
            }
            
        } catch (error) {
            console.warn('Fehler beim Extrahieren der Transformation:', error);
        }
        
        return transform;
    }

    /**
     * Gibt Standard-Transformation zurück (keine Änderungen)
     * @returns {Object} Standard-Transformations-Objekt
     */
    static getDefaultTransform() {
        return {
            rotation: 0,        // Grad (0-360)
            flipH: false,       // Horizontal gespiegelt
            flipV: false,       // Vertikal gespiegelt
            crop: {
                left: 0,        // Prozent von links
                top: 0,         // Prozent von oben
                right: 0,       // Prozent von rechts
                bottom: 0       // Prozent von unten
            }
        };
    }
}

globalThis.XMLParser = XMLParser;
