# Was koche ich heute? 🍳

Ein interaktiver Pinterest-Style Rezeptfinder mit **automatischer Bild-Extraktion** aus Excel-Dateien.

## ✨ Hauptfeatures

- 🎨 **Pinterest-Masonry-Layout** - Schöne, responsive Karten-Ansicht
- 🖼️ **Automatische Bild-Extraktion** - Lädt Bilder direkt aus der Excel-Datei
- 💾 **Offline-fähig** - Alle Daten und Bilder in IndexedDB gespeichert
- 🎲 **Zufallsauswahl** - Lass dich überraschen!
- 🔍 **Echtzeit-Suche** - Finde Rezepte sofort
- 📱 **Responsive Design** - Funktioniert auf allen Geräten
- 👨‍🍳 **Detaillierte Rezepte** - Zutaten, Anleitung, Portionen

## 🚀 Quick Start

1. Starte für den lokalen Rezepteditor `npm run serve` im Projektordner
2. Öffne `http://localhost:4004` im Browser. Der Editor kann so Rezepte und Bilder direkt in `recipes.json` und `images/recipes/` speichern.
3. Lade deine `Rezepte.xlsx` hoch
4. Warte kurz während Bilder extrahiert werden
5. Fertig! Alle Rezepte sind nun offline verfügbar

## 📁 Projektstruktur

```
findYourDinner/
├── index.html                    # Pinterest-Style Hauptseite
├── Rezepte.xlsx                 # Deine Excel-Datei mit Rezepten
├── css/
│   ├── main.css                 # Basis-Styles
│   ├── pinterest.css            # Masonry Grid Layout
│   └── detail.css               # Rezept-Detail-Seite
├── js/
│   ├── recipeGenerator.js       # Haupt-Generator (mit Bild-Extraktion)
│   ├── imageStore.js            # IndexedDB Manager für Bilder
│   ├── xmlParser.js             # XML-Parser für Excel-Struktur
│   └── lib/
│       └── jszip.min.js         # JSZip Library (lokal)
├── pages/
│   └── recipe-detail.html       # Detail-Ansicht mit Zutaten & Anleitung
└── images/                      # (Optional) Zusätzliche Bilder
```

## 🛠️ Technologie-Stack

### Frontend
- **Vanilla JavaScript** (ES6+)
- **HTML5** + **CSS3**
- **CSS Grid** für Masonry-Layout

### Libraries
- **SheetJS (xlsx.js)** - Excel-Daten lesen
- **JSZip** - Excel als ZIP öffnen, Bilder extrahieren
- **IndexedDB** (nativ) - Offline-Speicherung von Bildern

### Architektur
- **XMLParser** - Parst Excel-XML-Struktur für Sheet→Image Mapping
- **ImageStore** - Verwaltet Bilder in IndexedDB
- **RecipeGenerator** - Koordiniert alles (Daten + Bilder)

## 📊 Excel-Format

Die Excel-Datei sollte folgende Struktur haben:

### Sheet-Struktur
- Jedes **Sheet** = Ein Rezept
- **Sheet-Name** = Rezeptname
- Sheets "Inhaltsverzeichnis" und "Vorlage" werden ignoriert

### Rezept-Aufbau (pro Sheet)
```
Zeile 7:  Anzahl Personen/Liter: [Wert]
Zeile 10: Menge | Einheit | Produkt | Bemerkung
Zeile 11+: [Zutaten-Daten]
...
Zeile X:  Zubereitung
Zeile X+1: 1 | [Schritt 1 Text]
Zeile X+2: 2 | [Schritt 2 Text]
...
```

### Bilder
- Bilder werden automatisch aus `xl/media/` extrahiert
- Zuordnung erfolgt über XML-Parsing (Sheet → Drawing → Image)
- Unterstützte Formate: PNG, JPEG, GIF

## 🔄 Workflow beim Import

1. **User wählt Excel-Datei** 
2. **Phase 1: Daten-Extraktion** (SheetJS)
   - Rezeptnamen, Zutaten, Anleitungen
3. **Phase 2: Bild-Extraktion** (JSZip + XMLParser)
   - Excel als ZIP öffnen
   - XML-Dateien parsen für Mapping
   - Bilder extrahieren und in IndexedDB speichern
4. **Anzeige**
   - Zunächst Emoji-Platzhalter
   - Dann asynchron echte Bilder laden

## 🎨 Features im Detail

### Pinterest-Layout
- **Masonry Grid**: 4 Spalten (Desktop) → 3 → 2 → 1 (Mobil)
- **Variable Höhen**: Für natürlichen Pinterest-Look
- **8 Farbverläufe**: Als Fallback wenn kein Bild
- **Hover-Effekt**: "Rezept ansehen" Button erscheint

### Rezept-Detail-Seite
- **Großes Bild** (aus Excel extrahiert)
- **Zutaten-Liste** mit Mengen & Einheiten
- **Schritt-für-Schritt Anleitung**
- **Meta-Infos**: Portionen, Anzahl Zutaten/Schritte
- **Drucken-Funktion**
- **Zufalls-Button** für nächstes Rezept

### Offline-Funktionalität
- **LocalStorage**: Rezept-Daten (Name, Zutaten, Anleitung)
- **IndexedDB**: Bilder (bis ~50MB)
- Einmal laden → dauerhaft verfügbar
- Kein Internet nötig nach erstem Import

### Performance
- **Lazy Image Loading**: Bilder werden asynchron geladen
- **Caching**: Alles in IndexedDB
- **Progress Bar**: Zeigt Fortschritt beim Import

## 🎯 Tastatur-Shortcuts

- `R` - Zufälliges Rezept auswählen
- `ESC` - Zurücksetzen / Zurück

## 📱 Browser-Kompatibilität

Getestet und funktioniert in:
- ✅ Chrome/Edge (empfohlen)
- ✅ Firefox
- ✅ Safari (Desktop + iOS)

Benötigt:
- IndexedDB Support
- ES6+ Support
- FileReader API

## 🔧 Entwicklung

### Neue Features hinzufügen

**Neues Emoji hinzufügen:**
```javascript
// In index.html und recipe-detail.html
function getRecipeEmoji(recipeName) {
    if (name.includes('dein-rezept')) return '🍕';
    // ...
}
```

**Neuen Gradient hinzufügen:**
```css
/* In css/pinterest.css */
.gradient-9 { background: linear-gradient(135deg, #color1 0%, #color2 100%); }
```

### Debugging

**Console-Befehle:**
```javascript
// Zeige Statistiken
generator.getStats().then(console.log);

// Zeige alle gespeicherten Bilder
imageStore.getAllRecipeNames().then(console.log);

// Lösche alle Daten
generator.clearAllData();
```

## 🐛 Bekannte Limitierungen

- **Maximale Bildgröße**: ~50MB gesamt (IndexedDB-Limit)
- **Nur erste Bild**: Falls Sheet mehrere Bilder hat, wird nur das erste verwendet
- **Excel-Version**: Getestet mit Excel 2007+ (.xlsx)

## 📝 Changelog

### Version 2.0 (Aktuell)
- ✅ Automatische Bild-Extraktion aus Excel
- ✅ IndexedDB für Offline-Speicherung
- ✅ Pinterest-Masonry-Layout
- ✅ XMLParser für Sheet→Image Mapping
- ✅ Progress Bar beim Import
- ✅ Aufgeräumte Projekt-Struktur

### Version 1.0
- ✅ Basis-Funktionalität mit Emoji-Platzhaltern
- ✅ Excel-Import mit SheetJS
- ✅ Rezept-Details (Zutaten, Anleitung)

## 🤝 Beitragen

Du hast Ideen oder gefundene Bugs? Super!

**Verbesserungsvorschläge:**
- Kategorien/Tags für Rezepte
- Favoriten-System
- Export-Funktion (PDF, Shopping-Liste)
- Nährwertangaben
- Rezept-Bewertungen

## 📄 Lizenz

Dieses Projekt ist für den persönlichen Gebrauch.

---

**Viel Spaß beim Kochen! 👨‍🍳**
