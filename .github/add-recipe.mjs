// scripts/add-recipe.mjs
// Quellen für neue Rezepte:
//   1. Bilder in inbox/
//   2. URLs in inbox/urls.txt (eine pro Zeile)
//   3. Eine einzelne URL über die Umgebungsvariable RECIPE_URL (manueller Workflow-Start)
// Die Rezepte werden per Gemini ins JSON-Schema gebracht und an recipes.json angehängt.
// Keine Abhängigkeiten nötig (Node 20+, eingebautes fetch).

import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const INBOX = process.env.INBOX_DIR ?? "inbox";
const URLS_FILE = path.join(INBOX, "urls.txt");
const RECIPES_FILE = process.env.RECIPES_FILE ?? "recipes.json";
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const API_KEY = process.env.GEMINI_API_KEY;
const SINGLE_URL = (process.env.RECIPE_URL ?? "").trim();

const MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

const RULES = `Extrahiere das Rezept als JSON nach dem vorgegebenen Schema.
Regeln:
- Behalte die Originalsprache des Rezepts bei.
- Erfinde nichts. Fehlende Angaben bleiben leer (null bzw. leeres Array).
- Zutaten einzeln aufführen: amount (als Text, z. B. "1/2" oder "200"), unit und name getrennt.
- Zubereitungsschritte in der richtigen Reihenfolge, ein Schritt pro Eintrag.
- Zeiten gut lesbar angeben (z. B. "30 Min." statt "PT30M").
- tags: 2-5 passende Schlagworte (z. B. "vegetarisch", "Pasta", "Dessert").`;

const PROMPT_IMAGE = `Du bekommst ein Foto oder einen Screenshot eines Rezepts.\n${RULES}`;
const PROMPT_URL = `Du bekommst die Daten einer Rezeptseite (strukturierte Rezeptdaten oder Seitentext).\nIgnoriere Werbung, Kommentare und Navigation.\n${RULES}`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    description: { type: "STRING", nullable: true },
    servings: { type: "STRING", nullable: true },
    prepTime: { type: "STRING", nullable: true },
    cookTime: { type: "STRING", nullable: true },
    ingredients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          amount: { type: "STRING", nullable: true },
          unit: { type: "STRING", nullable: true },
          name: { type: "STRING" },
        },
        required: ["name"],
      },
    },
    steps: { type: "ARRAY", items: { type: "STRING" } },
    tags: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["title", "ingredients", "steps"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------- Gemini ----------

async function callGemini(parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0.1,
    },
  };

  // Bis zu 3 Versuche bei Rate-Limit / Überlastung
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Leere Antwort von Gemini");
      return JSON.parse(text);
    }

    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = attempt * 20_000;
      console.log(`API-Status ${res.status}, neuer Versuch in ${wait / 1000}s ...`);
      await sleep(wait);
      continue;
    }

    throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  }
}

// ---------- Bild ----------

async function extractFromImage(filePath) {
  const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()];
  const data = (await readFile(filePath)).toString("base64");
  return callGemini([{ text: PROMPT_IMAGE }, { inline_data: { mime_type: mimeType, data } }]);
}

// ---------- URL ----------

function findRecipeNode(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findRecipeNode(item);
      if (hit) return hit;
    }
    return null;
  }
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("Recipe")) return node;
  return findRecipeNode(node["@graph"]);
}

function extractJsonLdRecipe(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const hit = findRecipeNode(JSON.parse(match[1].trim()));
      if (hit) return JSON.stringify(hit);
    } catch {
      // kaputtes JSON-LD ignorieren
    }
  }
  return null;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|nav|footer|header|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30_000);
}

async function extractFromUrl(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RecipeImporter/1.0)",
      "Accept-Language": "de,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`Seite nicht abrufbar (HTTP ${res.status})`);
  const html = await res.text();

  // Die meisten Rezeptseiten liefern strukturierte Daten (schema.org/Recipe) mit.
  const content = extractJsonLdRecipe(html) ?? htmlToText(html);
  if (content.length < 100) throw new Error("Kein Rezeptinhalt auf der Seite gefunden");

  const recipe = await callGemini([{ text: `${PROMPT_URL}\n\n${content}` }]);
  return { ...recipe, source: url };
}

// ---------- Dateien ----------

async function loadRecipes() {
  try {
    const parsed = JSON.parse(await readFile(RECIPES_FILE, "utf8"));
    // Unterstützt [ ... ] und { "recipes": [ ... ] }
    if (Array.isArray(parsed)) return { root: parsed, list: parsed };
    if (Array.isArray(parsed.recipes)) return { root: parsed, list: parsed.recipes };
    throw new Error(`${RECIPES_FILE} hat ein unerwartetes Format`);
  } catch (err) {
    if (err.code === "ENOENT") {
      const list = [];
      return { root: list, list };
    }
    throw err;
  }
}

async function listImages() {
  try {
    return (await readdir(INBOX)).filter((f) => MIME_TYPES[path.extname(f).toLowerCase()]).sort();
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function readUrlsFile() {
  try {
    return (await readFile(URLS_FILE, "utf8")).split(/\r?\n/);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);

// ---------- Main ----------

async function main() {
  if (!API_KEY) {
    console.error("::error::GEMINI_API_KEY fehlt (Repo-Secret anlegen).");
    process.exit(1);
  }

  const jobs = [];

  for (const file of await listImages()) {
    const filePath = path.join(INBOX, file);
    jobs.push({ kind: "image", label: file, run: () => extractFromImage(filePath), cleanup: () => unlink(filePath) });
  }

  const urlLines = await readUrlsFile();
  const failedLines = new Set();
  const seen = new Set();
  const addUrlJob = (url, fromFile) => {
    if (seen.has(url)) return;
    seen.add(url);
    jobs.push({
      kind: "url",
      label: url,
      run: () => extractFromUrl(url),
      onFail: fromFile ? () => failedLines.add(url) : null,
    });
  };

  if (SINGLE_URL) {
    if (isUrl(SINGLE_URL)) addUrlJob(SINGLE_URL, false);
    else console.error(`::error::Ungültige URL: ${SINGLE_URL}`);
  }
  for (const line of urlLines ?? []) {
    const trimmed = line.trim();
    if (isUrl(trimmed)) addUrlJob(trimmed, true);
  }

  if (jobs.length === 0) {
    console.log("Keine Bilder oder URLs vorhanden, nichts zu tun.");
    return;
  }

  const { root, list } = await loadRecipes();
  const usedIds = new Set(list.map((r) => r.id));
  let added = 0;

  for (const [i, job] of jobs.entries()) {
    console.log(`Verarbeite ${job.label} ...`);
    try {
      const recipe = await job.run();

      let id = slugify(recipe.title) || `rezept-${Date.now()}`;
      const base = id;
      let n = 2;
      while (usedIds.has(id)) id = `${base}-${n++}`;
      usedIds.add(id);

      list.push({ id, ...recipe, addedAt: new Date().toISOString().slice(0, 10) });
      await writeFile(RECIPES_FILE, JSON.stringify(root, null, 2) + "\n");
      await job.cleanup?.();
      added++;
      console.log(`✔ "${recipe.title}" hinzugefügt (id: ${id})`);
    } catch (err) {
      // Bild bzw. URL bleibt erhalten, die anderen werden trotzdem verarbeitet
      console.error(`::error::${job.label}: ${err.message}`);
      job.onFail?.();
      process.exitCode = 1;
    }

    // Free-Tier-Limit schonen
    if (i < jobs.length - 1) await sleep(6_000);
  }

  // urls.txt aufräumen: erledigte URLs entfernen, fehlgeschlagene + Kommentare behalten
  if (urlLines) {
    const remaining = urlLines.filter((line) => {
      const t = line.trim();
      return !isUrl(t) || failedLines.has(t);
    });
    await writeFile(URLS_FILE, remaining.join("\n").replace(/\n+$/, "") + (remaining.length ? "\n" : ""));
  }

  console.log(`Fertig: ${added} von ${jobs.length} Rezepten hinzugefügt.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
