// canvas.js - Manages all canvas drawing and coordinate logic.

let ctx;
let canvasEl;
let imageEl;
let renderedImage = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Initializes the canvas module.
 * @param {HTMLCanvasElement} canvasElement - The canvas element.
 * @param {HTMLImageElement} imageElement - The image element for size reference.
 */
export function init(canvasElement, imageElement) {
    canvasEl = canvasElement;
    imageEl = imageElement;
    ctx = canvasEl.getContext('2d');
}

/**
 * Clears the entire canvas.
 */
export function clear() {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
}

/**
 * Recalculates the position and size of the letterboxed image and resizes the canvas.
 */
export function resizeCanvas() {
    if (!imageEl.naturalWidth) return;

    // Set canvas resolution to match the image's natural resolution for 1:1 drawing.
    if (canvasEl.width !== imageEl.naturalWidth) {
        canvasEl.width = imageEl.naturalWidth;
    }
    if (canvasEl.height !== imageEl.naturalHeight) {
        canvasEl.height = imageEl.naturalHeight;
    }

    // Calculate the rendered position and dimensions of the image within its container
    const container = imageEl.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const imgAspectRatio = imageEl.naturalWidth / imageEl.naturalHeight;
    const containerAspectRatio = containerWidth / containerHeight;

    let renderWidth, renderHeight, x, y;

    if (imgAspectRatio > containerAspectRatio) {
        renderWidth = containerWidth;
        renderHeight = containerWidth / imgAspectRatio;
        x = 0;
        y = (containerHeight - renderHeight) / 2;
    } else {
        renderHeight = containerHeight;
        renderWidth = containerHeight * imgAspectRatio;
        y = 0;
        x = (containerWidth - renderWidth) / 2;
    }
    renderedImage = { x, y, width: renderWidth, height: renderHeight };
}

/**
 * Converts mouse event coordinates to canvas-local coordinates.
 * @param {MouseEvent} event - The mouse event.
 * @returns {{x: number, y: number}|null} The coordinates on the canvas, or null if outside the image.
 */
export function getMousePosition(event) {
    // Use the image element's bounding rect as the source of truth for display dimensions
    const imageRect = imageEl.getBoundingClientRect();
    const clickX = event.clientX;
    const clickY = event.clientY;

    // Check if the click is outside the visible bounds of the image
    if (clickX < imageRect.left || clickX > imageRect.right ||
        clickY < imageRect.top || clickY > imageRect.bottom) {
        return null;
    }

    // Calculate click position as a ratio (0 to 1) of the image's displayed size
    const xRatio = (clickX - imageRect.left) / imageRect.width;
    const yRatio = (clickY - imageRect.top) / imageRect.height;

    // Scale the ratio by the canvas's actual resolution (which matches the natural image size)
    const canvasX = xRatio * canvasEl.width;
    const canvasY = yRatio * canvasEl.height;

    return { x: canvasX, y: canvasY };
}

/**
 * Draws the bounding box and label for a single found object.
 * @param {object} object - The game object to draw.
 */
function drawFoundBox(object) {
    if (!object.found) return;

    const [top, left, bottom, right] = object.box_2d;
    const label = object.label;

    // Bounding box
    ctx.strokeStyle = 'rgba(40, 167, 69, 0.9)';
    ctx.lineWidth = 4;
    ctx.strokeRect(left, top, right - left, bottom - top);

    // Label
    ctx.font = 'bold 16px Arial';
    ctx.textBaseline = 'bottom';
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    const textHeight = 16;
    const textX = left;
    const textY = top > 20 ? top - 5 : top + textHeight + 5;

    ctx.fillStyle = 'rgba(40, 167, 69, 0.8)';
    ctx.fillRect(textX - 2, textY - textHeight, textWidth + 4, textHeight + 4);
    ctx.fillStyle = 'white';
    ctx.fillText(label, textX, textY);
}

/**
 * Redraws all found object boxes on the canvas.
 * @param {Array<object>} gameObjects - The list of all game objects.
 */
export function redraw(gameObjects = []) {
    clear();
    gameObjects.forEach(drawFoundBox);
}