// utils.js - Contains shared helper functions.

/**
 * Converts any URL (including blob URLs) to a base64 Data URL.
 * This is useful for passing generated images to the AI for analysis.
 * @param {string} url - The URL to convert.
 * @returns {Promise<string>} A promise that resolves with the Data URL.
 */
export const urlToDataUrl = async (url) => {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            let detail = '';
            try {
                const data = await response.json();
                detail = data?.error?.message || data?.message || '';
            } catch {
                try {
                    detail = await response.text();
                } catch {
                    detail = '';
                }
            }
            const suffix = detail ? `: ${detail}` : '';
            throw new Error(`HTTP error ${response.status}${suffix}`);
        }
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error("Failed to convert URL to Data URL:", error);
        throw error;
    }
};

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not load image for overlay rendering.'));
        image.src = src;
    });
}

/**
 * Draws bounding boxes on top of an image and returns the result as a Data URL.
 * @param {string} imageDataUrl - Original image as a Data URL.
 * @param {Array<{id?: number, box_2d: number[]}>} objects - Normalized 0-1000 boxes.
 * @param {number} width - Natural image width.
 * @param {number} height - Natural image height.
 * @returns {Promise<string>}
 */
export async function drawBoundingBoxOverlayDataUrl(imageDataUrl, objects, width, height) {
    const image = await loadImage(imageDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width || image.naturalWidth || image.width;
    canvas.height = height || image.naturalHeight || image.height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    ctx.lineWidth = Math.max(3, Math.round(Math.min(canvas.width, canvas.height) * 0.005));
    ctx.font = `bold ${Math.max(18, Math.round(Math.min(canvas.width, canvas.height) * 0.03))}px Arial`;
    ctx.textBaseline = 'top';

    for (const object of objects) {
        const box = object?.box_2d;
        if (!Array.isArray(box) || box.length !== 4) {
            continue;
        }

        const top = Math.round((box[0] / 1000) * canvas.height);
        const left = Math.round((box[1] / 1000) * canvas.width);
        const bottom = Math.round((box[2] / 1000) * canvas.height);
        const right = Math.round((box[3] / 1000) * canvas.width);
        const widthPx = Math.max(1, right - left);
        const heightPx = Math.max(1, bottom - top);

        ctx.strokeStyle = '#fff200';
        ctx.strokeRect(left, top, widthPx, heightPx);

        const badgeText = String(object.id ?? '');
        if (!badgeText) {
            continue;
        }

        const textWidth = ctx.measureText(badgeText).width;
        const badgeWidth = Math.ceil(textWidth + 16);
        const badgeHeight = Math.ceil(parseInt(ctx.font, 10) + 10);
        const badgeX = Math.max(0, left);
        const badgeY = Math.max(0, top);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
        ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(badgeText, badgeX + 8, badgeY + 5);
    }

    return canvas.toDataURL('image/png');
}
