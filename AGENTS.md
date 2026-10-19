# AGENTS.md – find-your-dinner ("Was koche ich heute?")

# Root RULES
- You MUST use scoop or npm to install tools.
- Use "S:\" as the target for all installations.
- Do NOT use "C:\". Only use this if "S:\" is not an option.

## Befehle
- `npm run serve` – lokaler Server auf http://localhost:4004 (lädt `.env`, Node 22.9+)
- `npm test` – alle Tests (`node --test`); `npm run test:backend`, `npm run test:ui`
- `npm run install:instagram-browser` – Chromium für den Instagram-Import
- Nach Änderungen nur die passenden Tests laufen lassen (Backend- oder UI-Tests), nicht immer alle.

## Struktur
- `index.html` – Rezeptübersicht (kein Inline-JS/CSS, alles in `js/` und `css/`)
- `pages/recipe-detail.html` – Detailseite (kein Inline-JS/CSS)
- `js/indexPage.mjs` – Logik der Übersicht (Laden, Suche, Filter, Kacheln)
- `js/recipeDetail.mjs` – Logik der Detailseite (Bilder, Zutaten, Portionen-Scaler, Dock, Wake Lock)
- `js/recipeGenerator.mjs` – Laden, Suche, Filter, Speicherung
- `js/recipeDisplayUtils.mjs` – gemeinsame Rezept-Emojis, Platzhalterbilder und Bildtransformationen
- `js/recipeEditor.mjs` – Editor, Import-Aufrufe, Bildkomprimierung
- `server.mjs` – statischer Server und Schreib-API
- `server/recipeImporter.mjs` – URL-/Bildimport über Gemini, Modell-Fallback bei Token-Limit
- `server/instagramImporter/` – Abruf, Browser-Sitzung, Video-Download, Frame-Extraktion
- `css/` – main, pinterest, detail, mobile, chrome-ios, recipe-editor, index, recipe-detail
- `tests/backend/`, `tests/ui/` – Tests

## Datenformat (`recipes.json`)
`{ "version": 1, "recipes": [ { id, name, category ("Salzig"|"Süß"), healthy, servings, ingredients: [{amount, unit, product, note}], instructions: [{step, text}], images: [{src}], video?: {src}, notes?: [] } ] }`

## Nie komplett lesen (zu groß, kein Code)
- `recipes.json` – nur gezielt mit grep nach einem Rezeptnamen oder einer ID suchen
- `images/`, `videos/`, `node_modules/`

## Regeln
- Nur ES-Module (`.mjs`), keine Build-Tools. Relative URLs verwenden, damit GitHub Pages funktioniert.
- Keine neuen Abhängigkeiten ohne Rückfrage. Es werden nur kostenlose Lösungen gewünscht.
- `.env` und `GEMINI_API_KEY` nie ausgeben, loggen oder committen.
- Die README ist öffentlich: kurz halten (Was ist es, Installation, Tests) und keine sensiblen oder internen Details eintragen.
- Nutzereingaben und Importdaten nie per `innerHTML` einfügen, sondern `textContent` oder DOM-Methoden.
- Kein Inline-JS und kein Inline-CSS in den HTML-Dateien: Skripte als `js/*.mjs` mit `<script type="module" src=…>`, Styles als `css/*.css` mit `<link rel="stylesheet">` (Seiten-Stylesheet zuletzt im Head, damit die Cascade gleich bleibt). Tests erzwingen das.
- `getRecipeEmoji`, `generatePlaceholderImage` und `applyImageTransform` liegen gemeinsam in `js/recipeDisplayUtils.mjs`.
- Browser-Speicher: `localStorage` Keys `recipes_user_edits` und `recipes_revision`; Rezeptdetails werden über `?id=` verlinkt (`currentRecipe` bleibt als Abwärtskompatibilität).

## Arbeitsweise (Tokens sparen)
- Erst mit grep/Suche die passende Stelle finden, dann nur diese Datei bzw. diesen Abschnitt lesen.
- Dateien nicht komplett neu ausgeben, nur die geänderten Stellen bearbeiten.
- Antworten kurz halten, ohne lange Erklärungen zu bereits Bekanntem.
- Vor jedem Git-Push `npm run encrypt:recipes` ausführen und die aktualisierten verschlüsselten Rezept- und Mediendateien mitpushen. Das Skript darf wiederholt ausgeführt werden; lokale Klartextdateien bleiben standardmäßig erhalten.
