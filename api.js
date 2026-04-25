// api.js - Handles interactions with the AI services through provider adapters.

const DEFAULT_CONFIG = {
    AI_PROVIDER: 'pollinations',
    IMAGE_PROVIDER: 'pollinations',
    ANALYSIS_PROVIDER: 'pollinations',
    POLLINATIONS_API_BASE_URL: 'https://gen.pollinations.ai',
    POLLINATIONS_IMAGE_BASE_URL: 'https://image.pollinations.ai/prompt',
    POLLINATIONS_API_KEY: '',
    POLLINATIONS_IMAGE_MODEL: 'flux',
    POLLINATIONS_TEXT_MODEL: 'openai',
    GITHUB_MODELS_BASE_URL: 'https://models.github.ai',
    GITHUB_TOKEN: '',
    GITHUB_MODEL: 'openai/gpt-4.1-mini',
    GITHUB_API_VERSION: '2026-03-10'
};

const OBJECT_DETECTION_SYSTEM_PROMPT = `You are an expert object detector. Your task is to identify 3 to 10 distinct, visually findable objects within the input image.

For each object, provide a bounding box in a NORMALIZED 0-1000 coordinate space where (0, 0) is the top-left corner and (1000, 1000) is the bottom-right corner of the image. The format is [top, left, bottom, right], where each value is an integer between 0 and 1000.

Respond ONLY with a JSON object that adheres strictly to the following schema. Do not include explanatory text or markdown formatting.
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`;

function getConfig() {
    if (typeof window === 'undefined') {
        return { ...DEFAULT_CONFIG };
    }

    return {
        ...DEFAULT_CONFIG,
        ...(window.AI_HIDDEN_OBJECT_CONFIG || {})
    };
}

function getProvider(kind) {
    const config = getConfig();
    const kindKey = `${kind.toUpperCase()}_PROVIDER`;
    return config[kindKey] || config.AI_PROVIDER;
}

function normalizeBaseUrl(url) {
    return url.replace(/\/$/, '');
}

function buildPollinationsHeaders(config) {
    const headers = {
        'Content-Type': 'application/json'
    };

    if (config.POLLINATIONS_API_KEY) {
        headers.Authorization = `Bearer ${config.POLLINATIONS_API_KEY}`;
    }

    return headers;
}

function buildGitHubHeaders(config) {
    if (!config.GITHUB_TOKEN) {
        throw new Error('GitHub Models requires GITHUB_TOKEN with models:read permission.');
    }

    return {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': config.GITHUB_API_VERSION
    };
}

async function parseErrorResponse(response) {
    try {
        const data = await response.json();
        return data?.error?.message || data?.message || `${response.status} ${response.statusText}`;
    } catch (error) {
        return `${response.status} ${response.statusText}`;
    }
}

async function postJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(await parseErrorResponse(response));
    }

    return await response.json();
}

function extractTextContent(messageContent) {
    if (typeof messageContent === 'string') {
        return messageContent;
    }

    if (Array.isArray(messageContent)) {
        return messageContent
            .map(part => {
                if (typeof part === 'string') {
                    return part;
                }

                if (part && typeof part.text === 'string') {
                    return part.text;
                }

                return '';
            })
            .join('')
            .trim();
    }

    return '';
}

function parseModelJson(rawContent) {
    try {
        return JSON.parse(rawContent);
    } catch (error) {
        const match = rawContent.match(/\{[\s\S]*\}/);
        if (match) {
            return JSON.parse(match[0]);
        }

        throw error;
    }
}

async function generateImageWithPollinations(prompt, config) {
    const baseUrl = normalizeBaseUrl(config.POLLINATIONS_IMAGE_BASE_URL);
    const imageUrl = new URL(`${baseUrl}/${encodeURIComponent(prompt)}`);
    imageUrl.searchParams.set('model', config.POLLINATIONS_IMAGE_MODEL);
    // Fix: seed makes the URL deterministic so the browser display and the
    // AI analysis call both receive exactly the same generated image.
    imageUrl.searchParams.set('seed', String(Math.floor(Math.random() * 1_000_000)));

    return imageUrl.toString();
}

async function analyzeWithPollinations(imageDataUrl, width, height, config) {
    const baseUrl = normalizeBaseUrl(config.POLLINATIONS_API_BASE_URL);
    const payload = {
        model: config.POLLINATIONS_TEXT_MODEL,
        messages: [
            {
                role: 'system',
                content: OBJECT_DETECTION_SYSTEM_PROMPT
            },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: imageDataUrl } },
                    { type: 'text', text: 'List 3 to 10 main objects in this image with their bounding boxes in normalized 0-1000 coordinates.' }
                ]
            }
        ],
        response_format: {
            type: 'json_object'
        },
        stream: false
    };

    const result = await postJson(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: buildPollinationsHeaders(config),
        body: JSON.stringify(payload)
    });

    return parseModelJson(extractTextContent(result?.choices?.[0]?.message?.content || ''));
}

async function analyzeWithGitHubModels(imageDataUrl, width, height, config) {
    const baseUrl = normalizeBaseUrl(config.GITHUB_MODELS_BASE_URL);
    const payload = {
        model: config.GITHUB_MODEL,
        messages: [
            {
                role: 'system',
                content: OBJECT_DETECTION_SYSTEM_PROMPT
            },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: imageDataUrl } },
                    { type: 'text', text: 'List 3 to 10 main objects in this image with their bounding boxes in normalized 0-1000 coordinates.' }
                ]
            }
        ],
        response_format: {
            type: 'json_object'
        },
        max_tokens: 1000,
        temperature: 0.2,
        stream: false
    };

    const result = await postJson(`${baseUrl}/inference/chat/completions`, {
        method: 'POST',
        headers: buildGitHubHeaders(config),
        body: JSON.stringify(payload)
    });

    return parseModelJson(extractTextContent(result?.choices?.[0]?.message?.content || ''));
}

/**
 * Generates an image using the configured image provider.
 * @param {string} prompt - The text prompt for image generation.
 * @returns {Promise<string>} A promise that resolves with the Data URL of the generated image.
 */
export async function generateImage(prompt) {
    const config = getConfig();
    const provider = getProvider('image');

    switch (provider) {
        case 'pollinations':
            return await generateImageWithPollinations(prompt, config);
        case 'github':
            throw new Error('GitHub Models image generation is not configured for this project. Keep IMAGE_PROVIDER set to pollinations.');
        default:
            throw new Error(`Unsupported image provider: ${provider}`);
    }
}

/**
 * Analyzes an image to find objects using the configured analysis provider.
 * @param {string} imageDataUrl - The Data URL of the image to analyze.
 * @param {number} width - The width of the image.
 * @param {number} height - The height of the image.
 * @returns {Promise<object>} A promise that resolves with the parsed JSON analysis from the AI.
 */
export async function analyzeImage(imageDataUrl, width, height) {
    const config = getConfig();
    const provider = getProvider('analysis');

    try {
        switch (provider) {
            case 'pollinations':
                return await analyzeWithPollinations(imageDataUrl, width, height, config);
            case 'github':
                return await analyzeWithGitHubModels(imageDataUrl, width, height, config);
            default:
                throw new Error(`Unsupported analysis provider: ${provider}`);
        }
    } catch (error) {
        console.error(`AI analysis failed via ${provider}:`, error);
        throw error;
    }
}

export function getActiveProviders() {
    return {
        image: getProvider('image'),
        analysis: getProvider('analysis')
    };
}

export function getAnalysisConfigurationError() {
    const config = getConfig();
    const provider = getProvider('analysis');

    switch (provider) {
        case 'pollinations':
            if (!config.POLLINATIONS_API_KEY) {
                return 'AI analysis is not configured. Add POLLINATIONS_API_KEY in config.js, or switch ANALYSIS_PROVIDER to github and provide GITHUB_TOKEN.';
            }
            return '';
        case 'github':
            if (!config.GITHUB_TOKEN) {
                return 'GitHub Models analysis is selected, but GITHUB_TOKEN is missing. Add a token with models:read permission in config.js.';
            }
            return '';
        default:
            return `Unsupported analysis provider: ${provider}`;
    }
}