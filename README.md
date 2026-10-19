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
├── recipes.enc         # Verschlüsselte Rezeptdaten für das Repo
├── recipes.json        # Lokale Klartext-Arbeitskopie (Git-ignoriert)
├── server.mjs          # Lokaler statischer Server und Schreib-API
├── server/             # Serverseitige Logik
├── js/                 # Frontend-Logik (ES-Module)
├── css/                # Stylesheets
├── images/recipes/     # Bilder
├── videos/recipes/     # Videos
└── tests/              # Backend- und UI-Tests
```
