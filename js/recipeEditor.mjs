/* Lokaler Rezepteditor für die GitHub-Pages-Version. */
let editingRecipeIndex = -1;

function openRecipeEditor(recipeName = null) {
    document.getElementById('recipeEditor').hidden = false;
    document.getElementById('editorSearch').value = '';
    renderEditorRecipeList();
    const selectedIndex = recipeName
        ? generator.recipes.findIndex(recipe => recipe.name === recipeName || recipe.sheetName === recipeName)
        : -1;
    if (generator.recipes.length) selectRecipeForEdit(selectedIndex >= 0 ? selectedIndex : 0);
    else newRecipe();
}

function closeRecipeEditor() {
    document.getElementById('recipeEditor').hidden = true;
}

async function importRecipeFromUrl() {
    const url = prompt('Adresse der Rezeptseite eingeben:')?.trim();
    if (!url) return;
    await importRecipe({ url });
}

async function importRecipeFromImage(file) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setImportStatus('error', 'Bitte wähle ein JPEG-, PNG- oder WebP-Bild aus.');
        return;
    }
    await importRecipe({ imageFile: file });
}

async function importRecipe(payload) {
    const status = document.getElementById('editorSaveStatus');
    const controls = getImportControls();
    setImportControlsDisabled(controls, true);
    try {
        if (payload.imageFile) {
            setImportStatus('loading', 'Bild wird vorbereitet …');
            payload = { image: await compressRecipeImage(payload.imageFile) };
        }
        const isInstagramUrl = typeof payload.url === 'string' && /^https?:\/\/(?:www\.)?instagram\.com\//i.test(payload.url);
        setImportStatus('loading', payload.url
            ? isInstagramUrl
                ? 'Instagram-Reel wird geprüft … Falls sich ein Browserfenster öffnet, melde dich dort an und bestätige gegebenenfalls den Cookie-Hinweis.'
                : 'Rezeptseite wird geladen und analysiert …'
            : 'Rezept wird mit Gemini analysiert …');
        const response = await fetch('/api/import-recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error(response.ok
                ? 'Der Importserver hat eine ungültige Antwort gesendet.'
                : `Der Importserver antwortet mit HTTP ${response.status}.`);
        }
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        const id = Math.max(-1, ...generator.recipes.map(recipe => Number(recipe.id) || 0)) + 1;
        generator.recipes.push({ ...result.recipe, id });
        editingRecipeIndex = generator.recipes.length - 1;
        persistRecipeEdits();
        selectRecipeForEdit(editingRecipeIndex);
        setImportStatus('success', 'Importiert. Bitte prüfe das Rezept und speichere es anschließend.');
    } catch (error) {
        setImportStatus('error', formatImportError(error));
    } finally {
        setImportControlsDisabled(controls, false);
    }
}

function getImportControls() {
    const controls = Array.from(document.querySelectorAll('[data-local-recipe-import]'));
    const imageInput = document.getElementById('recipeImportImageInput');
    if (imageInput) controls.push(imageInput);
    return controls;
}

function setImportControlsDisabled(controls, disabled) {
    controls.forEach(control => { control.disabled = disabled; });
}

function setImportStatus(state, message) {
    const status = document.getElementById('editorSaveStatus');
    status.textContent = message;
    status.classList.remove('editor-status--loading', 'editor-status--success', 'editor-status--error');
    if (state) status.classList.add(`editor-status--${state}`);
    status.setAttribute('aria-busy', String(state === 'loading'));
    status.setAttribute('role', state === 'error' ? 'alert' : 'status');
    status.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
}

function formatImportError(error) {
    const message = typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Unbekannter Fehler.';
    if (/failed to fetch|fetch failed|networkerror|load failed/i.test(message)) {
        return 'Der lokale Importserver ist nicht erreichbar. Starte ihn mit „npm run serve“ und öffne die App über http://localhost:4004.';
    }
    if (/GEMINI_API_KEY fehlt/i.test(message)) {
        return 'Der Gemini-API-Schlüssel fehlt. Trage GEMINI_API_KEY in die lokale .env-Datei ein und starte den Server neu.';
    }

    const apiError = message.match(/Gemini API (\d+):\s*([\s\S]*)/i);
    if (!apiError) return `Import fehlgeschlagen: ${message}`;
    let details = apiError[2].trim();
    try {
        const parsed = JSON.parse(details);
        details = parsed.error?.message || details;
    } catch {
        details = details.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const statusCode = Number(apiError[1]);
    if (statusCode === 401 || statusCode === 403) {
        return 'Gemini hat den API-Schlüssel abgelehnt. Prüfe GEMINI_API_KEY in der .env-Datei und starte den Server neu.';
    }
    if (statusCode === 429) {
        return 'Das Gemini-Kontingent ist vorübergehend ausgeschöpft. Prüfe dein API-Kontingent und versuche es später erneut.';
    }
    if (statusCode === 404) {
        return `Das konfigurierte Gemini-Modell ist nicht verfügbar. Prüfe GEMINI_MODEL in der .env-Datei.${details ? ` ${details}` : ''}`;
    }
    return `Gemini-Import fehlgeschlagen (HTTP ${statusCode}).${details ? ` ${details}` : ''}`;
}

function renderEditorRecipeList() {
    const query = document.getElementById('editorSearch').value.trim().toLocaleLowerCase('de');
    const list = document.getElementById('editorRecipeList');
    list.replaceChildren();
    generator.recipes.forEach((recipe, index) => {
        if (query && !recipe.name.toLocaleLowerCase('de').includes(query)) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `editor-recipe-option${index === editingRecipeIndex ? ' active' : ''}`;
        button.textContent = recipe.name || '(Ohne Namen)';
        button.addEventListener('click', () => selectRecipeForEdit(index));
        list.appendChild(button);
    });
}

function selectRecipeForEdit(index) {
    editingRecipeIndex = index;
    renderEditorRecipeList();
    const recipe = generator.recipes[index];
    if (!recipe) return;
    const form = document.getElementById('recipeEditForm');
    form.innerHTML = '';
    addEditorField(form, 'Name', 'name', recipe.name || '');
    addCategoryField(form, recipe.category || '', recipe.healthy);
    addEditorField(form, 'Portionen', 'servings', recipe.servings ?? '', 'number');
    addIngredientsEditor(form, recipe.ingredients || []);
    addInstructionsEditor(form, recipe.instructions || []);
    addEditorField(form, 'Notizen oder Links (eine pro Zeile)', 'notes', (recipe.notes || []).map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n'), 'textarea');
    const placeholder = document.createElement('label');
    placeholder.className = 'editor-checkbox';
    placeholder.innerHTML = '<input name="isPlaceholder" type="checkbox"> In Vorbereitung';
    placeholder.querySelector('input').checked = Boolean(recipe.isPlaceholder);
    form.appendChild(placeholder);
    addRecipeImageControls(form, recipe);
    const actions = document.createElement('div');
    actions.className = 'editor-actions';
    actions.innerHTML = '<button type="submit" class="primary-btn">Änderungen speichern</button><button type="button" class="editor-delete">Rezept löschen</button>';
    actions.querySelector('.editor-delete').addEventListener('click', deleteCurrentRecipe);
    form.appendChild(actions);
    form.onsubmit = saveEditedRecipe;
}

function addRecipeImageControls(form, recipe) {
    const section = document.createElement('section');
    section.className = 'editor-image-section';
    const title = document.createElement('h3');
    title.textContent = 'Rezeptbilder';
    section.appendChild(title);
    const dropzone = document.createElement('div');
    dropzone.className = 'editor-image-dropzone';
    dropzone.tabIndex = 0;
    dropzone.setAttribute('role', 'button');
    dropzone.setAttribute('aria-label', 'Bild auswählen oder hier ablegen');
    dropzone.innerHTML = '<span>Bild hier ablegen</span><small>oder klicken, um ein Bild auszuwählen</small>';
    const picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'image/*'; picker.multiple = true; picker.hidden = true;
    picker.addEventListener('change', async () => { await addRecipeImages(picker.files); picker.value = ''; });
    dropzone.addEventListener('click', () => picker.click());
    dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); picker.click(); } });
    dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', async event => { event.preventDefault(); dropzone.classList.remove('drag-over'); await addRecipeImages(event.dataTransfer.files); });
    section.append(dropzone, picker);
    const gallery = document.createElement('div');
    gallery.className = 'editor-image-gallery';
    (recipe.images || []).forEach((image, index) => {
        if (!image || !image.src) return;
        const card = document.createElement('div'); card.className = 'editor-image-card';
        const preview = document.createElement('img');
        preview.src = resolveEditorImageURL(image.src); preview.alt = `Rezeptbild ${index + 1}`;
        preview.onerror = () => { preview.alt = 'Bildvorschau nicht verfügbar'; };
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Entfernen';
        remove.addEventListener('click', async () => {
            const current = generator.recipes[editingRecipeIndex];
            current.images.splice(index, 1);
            await commitRecipeChanges(current, editingRecipeIndex);
            selectRecipeForEdit(editingRecipeIndex);
        });
        card.append(preview, remove); gallery.appendChild(card);
    });
    section.appendChild(gallery);
    form.appendChild(section);
}

function resolveEditorImageURL(src) {
    if (/^(?:data:|blob:|https?:|\/)/i.test(src)) return src;
    const pageBase = window.location.pathname.includes('/pages/') ? '../' : './';
    return new URL(`${pageBase}${src}`, window.location.href).href;
}

async function addRecipeImages(fileList) {
    const files = Array.from(fileList || []).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    try {
        const recipe = generator.recipes[editingRecipeIndex];
        for (const file of files) {
            recipe.images = recipe.images || [];
            recipe.images.push({ src: await compressRecipeImage(file) });
        }
        persistRecipeEdits();
        selectRecipeForEdit(editingRecipeIndex);
    } catch (error) {
        document.getElementById('editorSaveStatus').textContent = `Bild konnte nicht gespeichert werden: ${error.message}`;
    }
}

function compressRecipeImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('Datei ist kein lesbares Bild.'));
            image.onload = () => {
                const maxDimension = 1400;
                const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                const context = canvas.getContext('2d');
                context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function addEditorField(form, labelText, name, value, type = 'text') {
    const label = document.createElement('label');
    label.className = 'editor-field';
    const title = document.createElement('span');
    title.textContent = labelText;
    const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    if (type !== 'textarea') input.type = type;
    input.name = name;
    input.value = value;
    label.append(title, input);
    form.appendChild(label);
}

function addCategoryField(form, selectedCategory, isHealthy) {
    const label = document.createElement('label');
    label.className = 'editor-field';
    const title = document.createElement('span');
    title.textContent = 'Kategorie';
    const select = document.createElement('select');
    select.name = 'category';
    ['Salzig', 'Süß'].forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
    });
    select.value = selectedCategory === 'Süß' ? 'Süß' : 'Salzig';
    label.append(title, select);
    form.appendChild(label);

    const healthyLabel = document.createElement('label');
    healthyLabel.className = 'editor-checkbox';
    const healthyInput = document.createElement('input');
    healthyInput.type = 'checkbox';
    healthyInput.name = 'healthy';
    healthyInput.checked = isHealthy === true;
    healthyLabel.append(healthyInput, document.createTextNode(' healthy'));
    form.appendChild(healthyLabel);
}

function addIngredientsEditor(form, ingredients) {
    const section = document.createElement('section');
    section.className = 'editor-ingredients-section';
    const heading = document.createElement('h3');
    heading.textContent = 'Zutaten';
    const rows = document.createElement('div');
    rows.className = 'editor-ingredient-list';
    ingredients.forEach(ingredient => addIngredientRow(rows, ingredient));
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'editor-add-ingredient';
    addButton.textContent = '＋ Zutat hinzufügen';
    addButton.addEventListener('click', () => {
        const row = addIngredientRow(rows);
        row.querySelector('[name="amount"]').focus();
    });
    section.append(heading, rows, addButton);
    form.appendChild(section);
}

function addIngredientRow(container, ingredient = {}) {
    const row = document.createElement('div');
    row.className = 'editor-ingredient-row';
    const fields = [
        ['Menge', 'amount', ingredient.amount ?? '', 'z. B. 200'],
        ['Einheit', 'unit', ingredient.unit || '', 'g, EL, Stück'],
        ['Produkt', 'product', ingredient.product || '', 'Zutat'],
        ['Notiz', 'note', ingredient.note || '', 'optional']
    ];
    fields.forEach(([labelText, name, value, placeholder]) => {
        const label = document.createElement('label');
        label.className = 'editor-ingredient-field';
        const title = document.createElement('span');
        title.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'text';
        input.name = name;
        input.value = value;
        input.placeholder = placeholder;
        if (name === 'amount') input.inputMode = 'decimal';
        label.append(title, input);
        row.appendChild(label);
    });
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'editor-remove-ingredient';
    removeButton.textContent = 'Entfernen';
    removeButton.setAttribute('aria-label', 'Zutat entfernen');
    removeButton.addEventListener('click', () => row.remove());
    row.appendChild(removeButton);
    container.appendChild(row);
    return row;
}

function readIngredientRows(form) {
    return Array.from(form.querySelectorAll('.editor-ingredient-row')).map(row => {
        const amount = row.querySelector('[name="amount"]').value.trim();
        const unit = row.querySelector('[name="unit"]').value.trim();
        const product = row.querySelector('[name="product"]').value.trim();
        const note = row.querySelector('[name="note"]').value.trim();
        return { amount: amount && !Number.isNaN(Number(amount)) ? Number(amount) : amount, unit, product, note };
    }).filter(ingredient => ingredient.amount || ingredient.unit || ingredient.product || ingredient.note);
}

function addInstructionsEditor(form, instructions) {
    const section = document.createElement('section');
    section.className = 'editor-instructions-section';
    const heading = document.createElement('h3');
    heading.textContent = 'Zubereitung';
    const rows = document.createElement('div');
    rows.className = 'editor-instruction-list';
    instructions.forEach(instruction => addInstructionRow(rows, instruction.text || ''));
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'editor-add-instruction';
    addButton.textContent = '＋ Schritt hinzufügen';
    addButton.addEventListener('click', () => {
        const row = addInstructionRow(rows);
        updateInstructionNumbers(rows);
        row.querySelector('textarea').focus();
    });
    section.append(heading, rows, addButton);
    form.appendChild(section);
}

function addInstructionRow(container, text = '') {
    const row = document.createElement('div');
    row.className = 'editor-instruction-row';
    const number = document.createElement('span');
    number.className = 'editor-instruction-number';
    const textarea = document.createElement('textarea');
    textarea.name = 'instruction';
    textarea.value = text;
    textarea.rows = 3;
    textarea.placeholder = 'Beschreibe diesen Zubereitungsschritt …';
    textarea.setAttribute('aria-label', 'Zubereitungsschritt');
    const controls = document.createElement('div');
    controls.className = 'editor-instruction-controls';
    const moveUp = document.createElement('button');
    moveUp.type = 'button'; moveUp.textContent = '↑'; moveUp.title = 'Schritt nach oben'; moveUp.setAttribute('aria-label', 'Schritt nach oben');
    moveUp.addEventListener('click', () => {
        if (row.previousElementSibling) container.insertBefore(row, row.previousElementSibling);
        updateInstructionNumbers(container);
    });
    const moveDown = document.createElement('button');
    moveDown.type = 'button'; moveDown.textContent = '↓'; moveDown.title = 'Schritt nach unten'; moveDown.setAttribute('aria-label', 'Schritt nach unten');
    moveDown.addEventListener('click', () => {
        if (row.nextElementSibling) container.insertBefore(row.nextElementSibling, row);
        updateInstructionNumbers(container);
    });
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = 'Entfernen'; remove.className = 'editor-remove-instruction';
    remove.addEventListener('click', () => { row.remove(); updateInstructionNumbers(container); });
    controls.append(moveUp, moveDown, remove);
    row.append(number, textarea, controls);
    container.appendChild(row);
    updateInstructionNumbers(container);
    return row;
}

function updateInstructionNumbers(container) {
    Array.from(container.children).forEach((row, index) => {
        row.querySelector('.editor-instruction-number').textContent = `Schritt ${index + 1}`;
        row.querySelector('[aria-label="Schritt nach oben"]').disabled = index === 0;
        row.querySelector('[aria-label="Schritt nach unten"]').disabled = index === container.children.length - 1;
    });
}

function readInstructionRows(form) {
    return Array.from(form.querySelectorAll('.editor-instruction-row textarea'))
        .map((textarea, index) => ({ step: index + 1, text: textarea.value.trim() }))
        .filter(instruction => instruction.text);
}

function parseEditorLines(text) { return text.split('\n').map(line => line.trim()).filter(Boolean); }

async function saveEditedRecipe(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const original = generator.recipes[editingRecipeIndex] || {};
    const updated = { ...original };
    updated.name = form.elements.name.value.trim();
    if (!updated.name) { form.elements.name.focus(); return; }
    updated.category = form.elements.category.value.trim();
    updated.healthy = form.elements.healthy.checked;
    updated.servings = form.elements.servings.value ? Number(form.elements.servings.value) : null;
    updated.ingredients = readIngredientRows(form);
    updated.instructions = readInstructionRows(form);
    updated.notes = parseEditorLines(form.elements.notes.value);
    updated.isPlaceholder = form.elements.isPlaceholder.checked;
    if (!Array.isArray(updated.images)) updated.images = [];
    await commitRecipeChanges(updated, editingRecipeIndex);
    selectRecipeForEdit(editingRecipeIndex);
}

async function commitRecipeChanges(recipe, index) {
    generator.recipes[index] = recipe;
    persistRecipeEdits();
    await saveRecipeProjectToFolder();
    if (typeof globalThis.onRecipeEditorSaved === 'function') {
        globalThis.onRecipeEditorSaved(generator.recipes[index]);
    }
}

function newRecipe() {
    const recipe = { id: Math.max(-1, ...generator.recipes.map(item => Number(item.id) || 0)) + 1, name: 'Neues Rezept', category: 'Salzig', healthy: false, servings: null, ingredients: [], instructions: [], notes: [], images: [], isPlaceholder: false };
    generator.recipes.push(recipe);
    editingRecipeIndex = generator.recipes.length - 1;
    persistRecipeEdits();
    selectRecipeForEdit(editingRecipeIndex);
    const nameInput = document.querySelector('#recipeEditForm [name="name"]');
    nameInput.focus(); nameInput.select();
}

async function deleteCurrentRecipe() {
    if (!confirm(`„${generator.recipes[editingRecipeIndex].name}“ wirklich löschen?`)) return;
    generator.recipes.splice(editingRecipeIndex, 1);
    editingRecipeIndex = generator.recipes.length ? 0 : -1;
    persistRecipeEdits();
    await saveRecipeProjectToFolder();
    renderEditorRecipeList();
    if (editingRecipeIndex >= 0) selectRecipeForEdit(editingRecipeIndex);
    else document.getElementById('recipeEditForm').innerHTML = '<p class="editor-empty">Noch keine Rezepte. Lege ein neues an.</p>';
}

function persistRecipeEdits() {
    try {
        localStorage.setItem('recipes_user_edits', JSON.stringify(generator.recipes));
        generator.saveToLocalStorage();
        globalThis.refreshRecipesAfterEdit?.();
        document.getElementById('editorSaveStatus').textContent = `Lokal gespeichert · ${generator.recipes.length} Rezepte`;
        renderEditorRecipeList();
    } catch (error) {
        document.getElementById('editorSaveStatus').textContent = `Speichern fehlgeschlagen: ${error.message}`;
    }
}

async function saveRecipeProjectToFolder() {
    const status = document.getElementById('editorSaveStatus');
    if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
        status.textContent = 'Änderungen sind auf diesem Gerät gespeichert. Direktes Speichern in Projektdateien ist nur lokal möglich.';
        return;
    }
    try {
        status.textContent = 'Speichere Rezepte und Bilder im Projektordner …';
        const response = await fetch('/api/save-recipes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: 1, recipes: generator.recipes })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        generator.recipes = result.recipes;
        persistRecipeEdits();
        selectRecipeForEdit(editingRecipeIndex);
        status.textContent = `Gespeichert: recipes.json, ${result.savedImages} Bild(er) hinzugefügt und ${result.deletedImages || 0} nicht mehr verwendete Bild(er) aus images/recipes entfernt.`;
    } catch (error) {
        status.textContent = `Dateien konnten nicht geschrieben werden: ${error.message}. Starte den Projektserver mit „node server.mjs“ und öffne die App über http://127.0.0.1:4004.`;
    }
}
if (typeof document !== 'undefined') {
    document.getElementById('editorSearch').addEventListener('input', renderEditorRecipeList);
    const isLocalServer = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    document.querySelectorAll('[data-local-recipe-import]').forEach(control => { control.hidden = !isLocalServer; });
    const imageInput = document.getElementById('recipeImportImageInput');
    imageInput?.addEventListener('change', async event => {
        await importRecipeFromImage(event.target.files[0]);
        event.target.value = '';
    });
}

globalThis.openRecipeEditor = openRecipeEditor;
globalThis.closeRecipeEditor = closeRecipeEditor;
globalThis.importRecipeFromUrl = importRecipeFromUrl;
globalThis.newRecipe = newRecipe;

export { commitRecipeChanges, deleteCurrentRecipe, importRecipe, persistRecipeEdits, saveRecipeProjectToFolder };
