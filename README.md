# Was koche ich heute? 🍳

Ein mobiler Rezeptfinder mit Suche, Kategorien, Rezeptdetailseiten und einem Editor für die Daten aus `recipes.json`. Die App kann als GitHub-Pages-Seite veröffentlicht und lokal mit Schreibzugriff auf die Projektdateien ausgeführt werden.

## Funktionen

- Rezeptübersicht mit Suche und kombinierbaren Filtern: genau eine Hauptkategorie („Salzig“ oder „Süß“, Standard: „Salzig“) sowie optional „healthy“
- URL- und Bildimport klassifizieren Rezepte zusätzlich optional als „healthy“; die Kennzeichnung lässt sich im Editor anpassen
- Rezeptdetailseite mit Zutaten, Zubereitung, Bildern und Portionsanpassung
- Editor auf der Startseite und direkt auf der Detailseite
- Kategorienauswahl mit vorhandenen Kategorien und Möglichkeit, neue Kategorien hinzuzufügen
- Strukturierte Zutatenzeilen mit Menge, Einheit, Produkt und Notiz
- Strukturierte Zubereitungsschritte mit Hinzufügen, Entfernen und Umsortieren
- Bilder per Dateiauswahl oder Drag-and-drop hinzufügen und im Editor entfernen
- Lokale Speicherung von Änderungen im Browser
- Direkter Schreibzugriff auf `recipes.json` und `images/recipes/` über den lokalen Node-Server
- Offlinefreundliche Rezeptdaten und zwischengespeicherte Bilder
- JavaScript-ES-Module (`.mjs`), die auch unter GitHub Pages mit relativen URLs geladen werden

## Lokal starten

Voraussetzung ist Node.js 22.9 oder neuer.

Der URL- und Bildimport ist nur lokal verfügbar. Installiere zuerst die Abhängigkeiten und den Chromium-Browser für den Instagram-Import:

```bash
npm install
npm run install:instagram-browser
```

Lege anschließend den Gemini-Schlüssel in einer `.env`-Datei im Projekt-Hauptordner ab:

```text
GEMINI_API_KEY=dein_api_key
```

Die `.env`-Datei wird beim lokalen Start automatisch geladen und ist in `.gitignore` eingetragen. Der Schlüssel wird nicht an GitHub Pages ausgeliefert.

```bash
npm run serve
```

Öffne anschließend <http://localhost:4004>. Der Server bindet nur an die lokale Loopback-Adresse.

Die Schaltflächen zum Importieren per URL oder Bild erscheinen nur bei lokalem Aufruf über `localhost`.
Bei Instagram versucht der Import zuerst den öffentlichen Abruf. Falls Instagram die Daten nicht öffentlich bereitstellt, öffnet sich ein lokales Browserfenster. Melde dich dort beim ersten Import einmalig an und bestätige bei Bedarf den Cookie-Hinweis. Die Sitzung bleibt im lokalen Benutzerprofil auf diesem Gerät; Cookies werden weder ausgelesen noch an Gemini gesendet. Videos bis 20 MB werden lokal mit FFmpeg in bis zu 24 zeitlich verteilte Standbilder umgewandelt. Caption und Standbilder werden an Gemini gesendet, damit Gemini eingeblendete Zutaten und Zubereitungsschritte analysiert; eine lokale Bilderkennung findet nicht statt. Private oder gelöschte Beiträge bleiben unzugänglich. Die lokale Browser-Sitzung wird unter `%LOCALAPPDATA%\find-your-dinner\instagram-session` gespeichert.

Beim Speichern im Editor schreibt der lokale Server die Rezeptdaten direkt nach `recipes.json` und neue Bilder nach `images/recipes/`. In der JSON-Datei werden die Bilder mit relativen Pfaden wie `images/recipes/rezept-12-1.jpg` referenziert. Der Browser-Editor sendet die Änderungen an die lokale Speicher-API in [server.mjs](./server.mjs).

Wenn der Servercode geändert wurde und Port 4004 noch von einer alten Serverinstanz belegt ist, beende diese Instanz im Terminal mit `Ctrl+C` und starte `npm run serve` erneut.

## GitHub Pages

GitHub Pages stellt die App und `recipes.json` statisch bereit. Änderungen, die im Editor auf der veröffentlichten Seite vorgenommen werden, bleiben im `localStorage` dieses Browsers und sind nach einem Neustart dort weiterhin vorhanden. Sie ändern nicht automatisch das GitHub-Repository und werden nicht mit anderen Nutzern geteilt.

Für Änderungen an der veröffentlichten Datenquelle lokal starten, Rezepte im Editor bearbeiten und speichern. Anschließend `recipes.json` und neue Dateien unter `images/recipes/` wie gewohnt committen und veröffentlichen.

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

Der Editor erhält weitere Rezeptfelder, die er nicht selbst bearbeitet, soweit sie im Rezeptobjekt vorhanden sind. Hochgeladene Bilder werden im Browser vor dem Speichern verkleinert und komprimiert.

## Projektstruktur

```text
findYourDinner/
├── index.html                    # Rezeptübersicht und Editor
├── recipes.json                  # Rezeptdaten
├── server.mjs                    # Lokaler statischer Server und Schreib-API
├── server/
│   ├── instagramImporter/         # Getrennter Instagram-Abruf und Videoverarbeitung
│   │   ├── index.mjs              # Öffentlicher Abruf und Fallback-Orchestrierung
│   │   ├── browserSession.mjs     # Persistente lokale Instagram-Sitzung
│   │   ├── postUtils.mjs          # URL- und HTML-Hilfsfunktionen
│   │   ├── videoDownloader.mjs    # Validierter Video-Download
│   │   └── videoFrameExtractor.mjs # Lokale FFmpeg-Frames für Gemini
│   └── recipeImporter.mjs         # URL-, Bild- und Rezeptimport
├── css/
│   ├── main.css                  # Basisstile
│   ├── pinterest.css             # Rezeptübersicht
│   ├── detail.css                # Detailansicht
│   └── recipe-editor.css         # Editor und Formulare
├── js/
│   ├── recipeGenerator.mjs       # Laden, Suche und Rezeptdaten
│   ├── recipeEditor.mjs          # Editor, lokale Speicherung und Bildauswahl
│   ├── imageStore.mjs            # IndexedDB für Bilder
│   └── xmlParser.mjs             # Excel-XML-Hilfsfunktionen
├── pages/
│   └── recipe-detail.html        # Rezeptdetails mit Editorzugriff
├── images/recipes/               # Rezeptbilder
└── tests/                         # Backend- und UI-Tests
```

## Tests

Alle Tests ausführen:

```bash
npm test
```

Nur die UI-Tests ausführen:

```bash
npm run test:ui
```

Nur die Backend-Tests ausführen:

```bash
npm run test:backend
```

Der Live-Server-Test in `tests/backend/live-server.test.mjs` prüft die laufende Speicher-API auf `http://127.0.0.1:4004`. Er wird übersprungen, wenn dort kein Server erreichbar ist. Ist ein alter statischer Server aktiv, schlägt der Test mit `405 Method Not Allowed` fehl.

## Browserhinweise

- Für den lokalen Dateischreibzugriff muss `npm run serve` laufen.
- Auf GitHub Pages ist kein Schreibzugriff auf das Repository möglich; Änderungen bleiben dort browserlokal.
- `localStorage` und IndexedDB sind an den jeweiligen Browser und die Website-Adresse gebunden.
- Der Server benötigt eine aktuelle Node.js-Version und verwendet ausschließlich integrierte Node-Module.
