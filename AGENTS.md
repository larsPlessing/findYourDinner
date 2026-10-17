# AGENTS.md - Developer Guide for findYourDinner

Coding standards and commands for AI agents working in this repository.

## Project Overview

**findYourDinner** is a Pinterest-style recipe finder PWA that:
- Extracts recipes/images from Excel files (`Rezepte.xlsx`) using SheetJS + JSZip
- Displays them in a masonry grid with lazy loading (IntersectionObserver)
- Stores data offline (LocalStorage + IndexedDB)
- Optimized for iOS Safari and mobile-first design

**Tech Stack:** JavaScript ES-Modules (`.mjs`), HTML5, CSS3, IndexedDB, SheetJS, JSZip

## Build/Lint/Test Commands

### No Build System
There is no bundler or install-time dependency. The project uses native JavaScript ES modules:
- **Run locally:** `npm run serve`, then open `http://localhost:4004`
- **Tests:** `npm test`, `npm run test:backend`, or `npm run test:ui`
- **No linter/formatter:** No ESLint or Prettier configured

### Git Workflow
```bash
git status                    # Check working tree
git diff                      # View unstaged changes
git log --oneline -10         # View recent commits
git add . && git commit -m "message"  # Stage and commit
```

**CRITICAL Git Safety Rules:**
- ❌ **NEVER** run `git push` directly without creating a PR first
- ✅ **ALWAYS** create feature branch → commit → create PR → wait for review
- All changes must go through pull request workflow

### Manual Testing
Since no automated tests exist:
1. Open `index.html` in Chrome, Firefox, Safari
2. Test mobile: Chrome DevTools device simulator or real iPhone
3. Upload `Rezepte.xlsx` and verify recipes load correctly
4. Check IndexedDB: DevTools > Application > IndexedDB > RecipeImagesDB
5. Test keyboard shortcut: Press 'R' for random recipe

## Code Style Guidelines

### File Organization
Core structure:
- `index.html` - Main Pinterest-style homepage
- `pages/recipe-detail.html` - Recipe detail page
- `js/recipeGenerator.mjs` - Main recipe loader/manager
- `js/imageStore.mjs` - IndexedDB image manager
- `js/xmlParser.mjs` - Excel XML parser for images
- `css/*.css` - Modular styles (main, pinterest, detail, mobile, chrome-ios)

### JavaScript Standards

**Naming Conventions:**
- Classes: PascalCase (`RecipeGenerator`, `ImageStore`)
- Functions/Variables: camelCase (`loadExcelFile`, `allRecipes`)
- Constants: UPPER_SNAKE_CASE (rare in codebase)

**Code Structure:**
- ES6 Classes for major components
- async/await over raw Promises
- Arrow functions for callbacks
- Template literals for strings

**Documentation:**
- JSDoc comments for all public methods
- German comments (match existing style)
- Explain what, not how

**Error Handling:**
- Try-catch for async operations
- `console.warn()` for non-critical issues
- `console.error()` for errors with context
- User-facing errors in German: `throw new Error(\`Fehler beim Laden: \${error.message}\`);`

**Imports/Dependencies:**
- Use native ES modules and `.mjs` extensions; HTML entry scripts use `type="module"`.
- Browser globals required by inline HTML handlers are explicitly attached to `globalThis`.
- Script load order in HTML:
  1. External libraries (SheetJS CDN, JSZip)
  2. Utilities (`xmlParser.mjs`)
  3. Core classes (`imageStore.mjs`, `recipeGenerator.mjs`)
  4. Page-specific module scripts

### CSS Standards

**Organization:**
- Mobile-first approach
- Responsive breakpoints: 768px, 1024px, 1400px
- CSS Grid for masonry layout
- 8 predefined gradient backgrounds (.gradient-1 through .gradient-8)

**Naming:**
- BEM-like descriptive classes (`masonry-grid`, `recipe-pin`, `recipe-pin-image`)
- State classes: `.active`, `.loading`, `.error`

**Browser Compatibility:**
- Include `-webkit-` prefixes for iOS Safari
- Use CSS Grid, Flexbox (modern browsers)
- Progressive enhancement approach

### HTML Standards

- Semantic HTML5 elements (`<header>`, `<nav>`, `<main>`, `<section>`)
- Include `alt` attributes and ARIA labels
- Mobile meta tags and iOS-specific tags required
- Inline onclick handlers acceptable for simple interactions
- Use addEventListener for complex interactions

### Language Conventions

- **UI text:** All German ("Was koche ich heute?", "Rezepte laden")
- **Code/variables:** Mix of German and English (existing pattern)
- **Comments:** German for explanatory comments
- **Commit messages:** English (see git history)

## Common Patterns

### Recipe Data Structure
```javascript
{
  id: 0, name: "Rezeptname", category: "Mittagessen - Hauptgericht",
  hasImage: true, imageCount: 1, servings: "4 Personen",
  ingredients: [{ amount: "200", unit: "g", product: "Mehl", note: "" }],
  instructions: [{ step: 1, text: "Mehl in eine Schüssel geben..." }],
  notes: ["https://example.com/recipe"],
  createdDate: "2024-01-01", modifiedDate: "2024-02-09"
}
```

### IndexedDB Pattern
```javascript
// Always check and initialize
if (!this.db) await this.init();

// Wrap in Promise for IDB operations
return new Promise((resolve, reject) => {
    const transaction = this.db.transaction([storeName], 'readwrite');
    const request = transaction.objectStore(storeName).put(data);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('message'));
});
```

### Progress Callback Pattern
```javascript
if (progressCallback) {
    progressCallback({ phase: 'images', progress: 50, message: 'Extrahiere Bilder...' });
}
```

## Architecture Notes

**Data Flow:**
1. User uploads `Rezepte.xlsx`
2. SheetJS extracts recipe data → JSZip opens Excel as ZIP → xmlParser maps sheets to images
3. imageStore saves images to IndexedDB, recipe data to LocalStorage
4. UI displays recipes in masonry grid with lazy-loaded images (IntersectionObserver)

**Key Classes:**
- **RecipeGenerator:** Main controller (loads Excel, manages recipes)
- **ImageStore:** IndexedDB wrapper for recipe images
- **XMLParser:** Static utility for parsing Excel XML internals

**Performance:** Lazy loading (IntersectionObserver), IndexedDB caching, LocalStorage caching, iOS optimizations

## Debugging Tips

**Console Commands:**
```javascript
generator.getStats().then(console.log);        // View stats
imageStore.getAllRecipeNames().then(console.log);  // View all image names
generator.clearAllData();                      // Clear all data
```

**Browser DevTools:**
- Application tab: Check LocalStorage and IndexedDB contents
- Network tab: Verify JSZip and SheetJS load correctly
- Console: Watch for image extraction progress logs

## Important Notes for Agents

1. **No bundler or third-party npm dependencies:** preserve the native ES-module workflow
2. **German UI:** Keep all user-facing text in German
3. **Mobile-first:** Always test mobile responsive behavior
4. **Excel-dependent:** Core functionality requires specific Excel structure
5. **Offline-first:** Changes should preserve offline functionality
6. **Git history:** Check recent commits for conventions (`git log --oneline`)
