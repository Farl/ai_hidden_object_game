// ui.js - Manages all interactions with the DOM.

let elements = {};

/**
 * Initializes the UI module by caching DOM element references.
 */
export function init(domElements) {
    elements = domElements;
    reset();
}

/**
 * Resets the UI to its initial pre-game state.
 */
export function reset() {
    document.body.classList.remove('game-active');
    elements.imageContainer.style.display = 'none';
    elements.imagePreview.src = '';
    elements.objectListContainer.innerHTML = '<h3>Objects to Find:</h3><ul id="objectList"></ul>';
    elements.gameStatusContainer.innerHTML = '<p>First, upload or generate an image, then click "Start New Game" to begin!</p>';
    setButtonState(elements.giveUpButton, null, true);
    elements.giveUpButton.style.display = 'none';
    elements.newImageButton.style.display = 'none';
    
    setButtonState(elements.fileInput, null, false);
    setButtonState(elements.generateImageButton, 'Generate Image', false);
    setButtonState(elements.startGameButton, 'Start New Game', true);
}

/**
 * Shows the game image and executes a callback after it loads.
 * @param {string} dataUrl - The image data URL.
 * @param {Function} onLoadCallback - Function to call after the image is loaded.
 */
/**
 * Shows the game image and executes callbacks after load or error.
 * @param {string} dataUrl - The image URL or data URL.
 * @param {Function} onLoadCallback - Called after successful load.
 * @param {Function} [onErrorCallback] - Called if the image fails to load.
 */
export function showImage(dataUrl, onLoadCallback, onErrorCallback) {
    const img = elements.imagePreview;

    const cleanup = () => {
        img.onload = null;
        img.onerror = null;
    };

    img.onload = () => { cleanup(); onLoadCallback(); };
    img.onerror = () => {
        cleanup();
        if (onErrorCallback) onErrorCallback();
    };

    img.src = dataUrl;
    elements.imageContainer.style.display = 'block';

    // Image might already be cached and complete before handlers attach
    if (img.complete && img.naturalWidth > 0) {
        cleanup();
        onLoadCallback();
    } else if (img.complete && img.naturalWidth === 0 && dataUrl) {
        // complete but broken (e.g. cached 404)
        cleanup();
        if (onErrorCallback) onErrorCallback();
    }
}

/**
 * Updates the UI to a loading state.
 * @param {string} message - The loading message to display.
 */
export function showLoadingState(message) {
    elements.gameStatusContainer.innerHTML = `<p>${message}</p>`;
    setButtonState(elements.fileInput, null, true);
    setButtonState(elements.generateImageButton, 'Working...', true);
    setButtonState(elements.startGameButton, 'Working...', true);
    setButtonState(elements.giveUpButton, 'Working...', true);
}

/**
 * Updates the UI to show an error message.
 * @param {string} message - The error message to display.
 */
/**
 * Shows an error message and restores the UI to an operable state.
 * @param {string} message - The error message.
 * @param {boolean} [hasValidImage=false] - Whether a valid image is still loaded.
 */
export function showError(message, hasValidImage = false) {
    elements.gameStatusContainer.innerHTML = `<p style="color: #d9534f;">${message}</p>`;
    setButtonState(elements.fileInput, null, false);
    setButtonState(elements.generateImageButton, 'Generate Image', false);
    setButtonState(elements.startGameButton, 'Start New Game', !hasValidImage);
    elements.giveUpButton.style.display = 'none';
    elements.giveUpButton.disabled = true;
}

/**
 * Updates the UI to the "Ready to Start" state after an image is loaded.
 */
export function showReadyToStartState() {
    elements.gameStatusContainer.innerHTML = '<p>Image loaded! Click "Start New Game" to begin.</p>';
    setButtonState(elements.fileInput, null, false);
    setButtonState(elements.generateImageButton, 'Generate Image', false);
    setButtonState(elements.startGameButton, 'Start New Game', false);
}

/**
 * Shows a configuration-required state when AI analysis is not ready to use.
 * @param {string} message - The configuration message to display.
 */
export function showConfigurationRequiredState(message) {
    elements.gameStatusContainer.innerHTML = `<p style="color: #b26a00;">${message}</p>`;
    setButtonState(elements.fileInput, null, false);
    setButtonState(elements.generateImageButton, 'Generate Image', false);
    setButtonState(elements.startGameButton, 'Start New Game', true);
    elements.giveUpButton.style.display = 'none';
}

/**
 * Sets up the UI for an active game session.
 * @param {Array<object>} gameObjects - The list of objects to find.
 */
export function startGameUI(gameObjects) {
    document.body.classList.add('game-active');
    populateObjectList(gameObjects);
    elements.gameStatusContainer.innerHTML = '<p>Game started! Click on the objects in the image to find them.</p>';
    setButtonState(elements.startGameButton, 'Restart Game', false);
    elements.giveUpButton.style.display = 'block';
    setButtonState(elements.giveUpButton, 'Give Up', false);
    elements.newImageButton.style.display = 'block';
}

/**
 * Displays the win message and finalizes the UI.
 */
export function showWinState() {
    elements.gameStatusContainer.innerHTML = '<p class="win-message">Congratulations! You found all the objects!</p>';
    elements.giveUpButton.style.display = 'none';
}

/**
 * Displays the "gave up" message and finalizes the UI.
 */
export function showGiveUpState() {
    elements.gameStatusContainer.innerHTML = '<p>Here are the remaining objects. Click "Restart Game" to play again.</p>';
    setButtonState(elements.giveUpButton, 'Give Up', true);
    elements.giveUpButton.style.display = 'none';
}

/**
 * Populates the "Objects to Find" list in the UI.
 * @param {Array<object>} gameObjects - The list of objects.
 */
function populateObjectList(gameObjects) {
    const list = document.createElement('ul');
    list.id = 'objectList';
    gameObjects.forEach(obj => {
        const li = document.createElement('li');
        li.id = obj.id;
        li.textContent = obj.label;
        list.appendChild(li);
    });
    elements.objectListContainer.innerHTML = '<h3>Objects to Find:</h3>';
    elements.objectListContainer.appendChild(list);
}

/**
 * Marks an object in the list as found by adding a 'found' class.
 * @param {string} objectId - The ID of the list item to update.
 */
export function markObjectAsFoundInList(objectId) {
    const listItem = document.getElementById(objectId);
    if (listItem) {
        listItem.classList.add('found');
    }
}

/** Helper to enable/disable a button and set its text. */
function setButtonState(button, text, disabled) {
    if (text) {
        button.textContent = text;
    }
    button.disabled = disabled;
}

/** Enables the start game button. */
export function enableStartButton() {
     setButtonState(elements.startGameButton, 'Start New Game', false);
}

/**
 * Populates a <select> element with model options.
 * @param {HTMLSelectElement} selectEl
 * @param {Array<{value: string, label: string}>} models
 * @param {string} defaultValue
 */
export function populateModelSelect(selectEl, models, defaultValue) {
    selectEl.innerHTML = '';
    models.forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        if (value === defaultValue) opt.selected = true;
        selectEl.appendChild(opt);
    });
}