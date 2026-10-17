# Was koche ich heute? 🍳

Ein mobiler Rezeptfinder mit Suche, Kategorien, Rezeptdetailseiten und einem Editor für die Daten aus `recipes.json`. Die App kann als GitHub-Pages-Seite veröffentlicht und lokal mit Schreibzugriff auf die Projektdateien ausgeführt werden.

## Funktionen

- Rezeptübersicht mit Suche, Kategorien, Zufallsauswahl und gemischter Sortierung
- Rezeptdetailseite mit Zutaten, Zubereitung, Bildern und Portionsanpassung
- Editor auf der Startseite und direkt auf der Detailseite
- Kategorienauswahl mit vorhandenen Kategorien und Möglichkeit, neue Kategorien hinzuzufügen
- Strukturierte Zutatenzeilen mit Menge, Einheit, Produkt und Notiz
- Strukturierte Zubereitungsschritte mit Hinzufügen, Entfernen und Umsortieren
- Bilder per Dateiauswahl oder Drag-and-drop hinzufügen und im Editor entfernen
- Lokale Speicherung von Änderungen im Browser
- Direkter Schreibzugriff auf `recipes.json` und `images/recipes/` über den lokalen Node-Server
- Offlinefreundliche Rezeptdaten und zwischengespeicherte Bilder

## Lokal starten

Voraussetzung ist eine aktuelle Node.js-Installation. Zusätzliche npm-Pakete müssen nicht installiert werden.

```bash
npm run serve
```

Öffne anschließend <http://localhost:4004>. Der Server bindet nur an die lokale Loopback-Adresse.

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
      "category": "Mittagessen - Salzig",
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
├── css/
│   ├── main.css                  # Basisstile
│   ├── pinterest.css             # Rezeptübersicht
│   ├── detail.css                # Detailansicht
│   └── recipe-editor.css         # Editor und Formulare
├── js/
│   ├── recipeGenerator.js        # Laden, Suche und Rezeptdaten
│   ├── recipeEditor.js           # Editor, lokale Speicherung und Bildauswahl
│   ├── imageStore.js             # IndexedDB für Bilder
│   └── xmlParser.js              # Excel-XML-Hilfsfunktionen
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

Der Live-Server-Test in `tests/backend/live-server.test.js` prüft die laufende Speicher-API auf `http://127.0.0.1:4004`. Er wird übersprungen, wenn dort kein Server erreichbar ist. Ist ein alter statischer Server aktiv, schlägt der Test mit `405 Method Not Allowed` fehl.

## Browserhinweise

- Für den lokalen Dateischreibzugriff muss `npm run serve` laufen.
- Auf GitHub Pages ist kein Schreibzugriff auf das Repository möglich; Änderungen bleiben dort browserlokal.
- `localStorage` und IndexedDB sind an den jeweiligen Browser und die Website-Adresse gebunden.
- Der Server benötigt eine aktuelle Node.js-Version und verwendet ausschließlich integrierte Node-Module.
