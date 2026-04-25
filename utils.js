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
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
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