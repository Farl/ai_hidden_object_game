// game.js - Manages the core game state and logic.

let state = {
    imageDataUrl: null,
    gameObjects: [],
    gameActive: false,
};

/** Resets the game state to its initial values. */
export function reset() {
    state.imageDataUrl = null;
    state.gameObjects = [];
    state.gameActive = false;
}

/** Reveals all remaining objects and ends the game. */
export function giveUp() {
    state.gameObjects.forEach(obj => {
        if (!obj.found) {
            obj.found = true;
        }
    });
    state.gameActive = false;
}

/** Starts a new game with the provided objects. */
export function start(objects) {
    state.gameObjects = objects;
    state.gameActive = true;
}

/** Sets the main image for the game. */
export function setImage(dataUrl) {
    reset(); // Reset game state when a new image is set
    state.imageDataUrl = dataUrl;
}

/** Processes raw AI object data, preparing it for the game. */
export function processObjects(rawObjects, imageWidth, imageHeight) {
    const scaleX = imageWidth / 1024;
    const scaleY = imageHeight / 1024;

    return rawObjects.map((obj, index) => {
        const box = obj.box_2d || obj.box2d;
        if (!box || box.length !== 4) {
            console.warn('Skipping invalid object from AI:', obj);
            return null;
        }
        
        // Scale coordinates from a 1024x1024 space to the actual image dimensions
        const scaledBox = [
            Math.round(box[0] * scaleY), // top
            Math.round(box[1] * scaleX), // left
            Math.round(box[2] * scaleY), // bottom
            Math.round(box[3] * scaleX)  // right
        ];

        return {
            ...obj,
            id: `game-object-${index}`,
            box_2d: scaledBox,
            found: false
        };
    }).filter(Boolean); // Remove null entries
}

/** Finds the first unfound object at a given canvas coordinate. */
export function findObjectAt({ x, y }) {
    // Iterate backwards to prioritize objects on top (rendered last if overlapping)
    for (let i = state.gameObjects.length - 1; i >= 0; i--) {
        const obj = state.gameObjects[i];
        if (obj.found) continue;

        const [top, left, bottom, right] = obj.box_2d;
        if (x >= left && x <= right && y >= top && y <= bottom) {
            return obj;
        }
    }
    return null;
}

/** Marks a specific object as found. */
export function markObjectAsFound(objectToFind) {
    if (objectToFind) {
        objectToFind.found = true;
    }
}

/** Checks if all objects have been found. */
export function checkWinCondition() {
    return state.gameObjects.length > 0 && state.gameObjects.every(o => o.found);
}

// --- Getters to access state from other modules ---
export const getImageDataUrl = () => state.imageDataUrl;
export const getObjects = () => state.gameObjects;
export const isGameActive = () => state.gameActive;