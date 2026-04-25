// api.js - Handles interactions with the AI services.
import { urlToDataUrl } from './utils.js';

/**
 * Generates an image using AI.
 * @param {string} prompt - The text prompt for image generation.
 * @returns {Promise<string>} A promise that resolves with the Data URL of the generated image.
 */
export async function generateImage(prompt) {
    const result = await websim.imageGen({
        prompt: prompt,
        aspect_ratio: "16:9",
    });
    return await urlToDataUrl(result.url);
}

/**
 * Analyzes an image to find objects using AI.
 * @param {string} imageDataUrl - The Data URL of the image to analyze.
 * @param {number} width - The width of the image.
 * @param {number} height - The height of the image.
 * @returns {Promise<object>} A promise that resolves with the parsed JSON analysis from the AI.
 */
export async function analyzeImage(imageDataUrl, width, height) {
    const completion = await websim.chat.completions.create({
        messages: [{
            role: "system",
            content: `You are an expert of object detection. The input image has dimensions 1024x1024 pixels. Your task is to identify 3 to 10 distinct, findable objects within the input image. For each object you identify, you must provide its name and a highly accurate bounding box.

The bounding box coordinates must be in ABSOLUTE PIXELS, relative to the top-left corner of the image (0,0). The format is [top, left, bottom, right], where each value is an integer.

Respond ONLY with a JSON object that adheres strictly to the following schema. Do not include any explanatory text or markdown formatting.
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`
        }, {
            role: "user",
            content: [
                { type: "image_url", image_url: { url: imageDataUrl } },
                { type: "text", text: `List 3 to 10 main objects in this image.` },
            ],
        }, ],
        json: true,
    });

    try {
        return JSON.parse(completion.content);
    } catch (jsonError) {
        console.error("Failed to parse AI response as JSON:", jsonError);
        console.log("Raw AI response:", completion.content);
        throw new Error("Failed to parse JSON response from AI.");
    }
}