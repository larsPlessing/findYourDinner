# Was koche ich heute? 🍳

Ein mobiler Rezeptfinder: statische Seite (GitHub Pages) plus lokaler Node-Server mit Schreibzugriff auf `recipes.json`, Bilder und Medien. Enthält Suche, Filter, Rezeptdetailseiten mit Portionsanpassung und einen Editor.

## Funktionen

- Rezeptübersicht mit Suche und Filtern (Kategorie „Salzig“/„Süß“, „healthy“)
- Rezeptdetailseite mit Zutaten, Zubereitung, Bildern und Portionsanpassung
- Editor auf der Startseite und direkt auf der Detailseite
- Bilder per Dateiauswahl oder Drag-and-drop hinzufügen
- Rezeptdaten werden im Browser zwischengespeichert; zum Abrufen neuer Versionen ist eine Internetverbindung erforderlich

## Lokal starten

Voraussetzung ist Node.js 22.9 oder neuer.

```bash
npm install
npm run serve
```

## Datenformat

Die Datei `recipes.json` enthält ein Objekt mit Versionsnummer und Rezeptliste:

```json
{
  "version": 1,
  "recipes": [
    {
      "id": 12,
      "name": "Beispielrezept",
      "category": "Salzig",
      "healthy": true,
      "servings": 4,
      "ingredients": [
        { "amount": 200, "unit": "g", "product": "Mehl", "note": "gesiebt" }
      ],
      "instructions": [
        { "step": 1, "text": "Alle Zutaten vermengen." }
      ],
      "images": [
        { "src": "images/recipes/beispielrezept-12-1.jpg" }
      ]
    }
  ]
}
```

## Tests

```bash
npm test              # alle Tests
npm run test:ui       # nur UI-Tests
npm run test:backend  # nur Backend-Tests
```

## Projektstruktur

```text
findYourDinner/
├── index.html          # Rezeptübersicht und Editor
├── pages/              # Rezeptdetailseite
├── recipes.json        # Rezeptdaten
├── server.mjs          # Lokaler statischer Server und Schreib-API
├── server/             # Serverseitige Logik
├── js/                 # Frontend-Logik (ES-Module)
├── css/                # Stylesheets
├── images/recipes/     # Rezeptbilder
└── tests/              # Backend- und UI-Tests
```
