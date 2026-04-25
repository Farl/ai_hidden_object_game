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
    
    setButtonState(elements.fileInput, null, false);
    setButtonState(elements.generateImageButton, 'Generate Image', false);
    setButtonState(elements.startGameButton, 'Start New Game', true);
}

/**
 * Shows the game image and executes a callback after it loads.
 * @param {string} dataUrl - The image data URL.
 * @param {Function} onLoadCallback - Function to call after the image is loaded.
 */
export function showImage(dataUrl, onLoadCallback) {
    elements.imagePreview.src = dataUrl;
    elements.imageContainer.style.display = 'block';

    if (elements.imagePreview.complete) {
        onLoadCallback();
    } else {
        elements.imagePreview.onload = onLoadCallback;
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
export function showError(message) {
    elements.gameStatusContainer.innerHTML = `<p style="color: red;">${message}</p>`;
    setButtonState(elements.fileInput, null, false);
    setButtonState(elements.generateImageButton, 'Generate Image', false);
    setButtonState(elements.startGameButton, 'Start New Game', !!elements.imagePreview.src);
    elements.giveUpButton.style.display = 'none';
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