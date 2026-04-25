// api.js - Handles interactions with the AI services through provider adapters.

// Timeout for all AI API requests (60 s)
const API_TIMEOUT_MS = 60_000;

const DEFAULT_CONFIG = {
    AI_PROVIDER: 'pollinations',
    IMAGE_PROVIDER: 'pollinations',
    ANALYSIS_PROVIDER: 'pollinations',
    POLLINATIONS_API_BASE_URL: 'https://gen.pollinations.ai',
    POLLINATIONS_IMAGE_BASE_URL: 'https://gen.pollinations.ai/image',
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(await parseErrorResponse(response));
        }
        return await response.json();
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Request timed out after 60 s. Check your connection and try again.');
        }
        throw err;
    }
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
    // New unified endpoint requires the API key as a query parameter.
    // Without a key it returns 401; old endpoint (image.pollinations.ai) ignored the model param.
    if (config.POLLINATIONS_API_KEY) {
        imageUrl.searchParams.set('key', config.POLLINATIONS_API_KEY);
    }

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

export function getImageConfigurationError() {
    const config = getConfig();
    const provider = getProvider('image');

    if (provider === 'pollinations' && !config.POLLINATIONS_API_KEY) {
        return 'Image generation requires a Pollinations API key. Get one at enter.pollinations.ai and add POLLINATIONS_API_KEY in config.js.';
    }
    return '';
}

export function getAnalysisConfigurationError() {
    const config = getConfig();
    const provider = getProvider('analysis');

    switch (provider) {
        case 'pollinations':
            if (!config.POLLINATIONS_API_KEY) {
                return 'AI analysis requires a Pollinations API key. Get one at enter.pollinations.ai and add POLLINATIONS_API_KEY in config.js.';
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

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

const POLLINATIONS_IMAGE_MODELS_ENDPOINT = 'https://gen.pollinations.ai/image/models';
const POLLINATIONS_TEXT_MODELS_ENDPOINT = 'https://gen.pollinations.ai/text/models';

// Conservative fallback used only when discovery endpoints fail.
const FALLBACK_IMAGE_MODELS = [
    { value: 'flux', label: 'flux' },
    { value: 'kontext', label: 'kontext' },
    { value: 'gptimage', label: 'gptimage' },
];

// Conservative fallback used only when discovery endpoints fail.
const FALLBACK_ANALYSIS_MODELS = [
    { value: 'openai', label: 'openai' },
    { value: 'openai-fast', label: 'openai-fast' },
    { value: 'openai-large', label: 'openai-large' },
    { value: 'mistral', label: 'mistral' },
    { value: 'qwen-vision', label: 'qwen-vision' },
];

const IMAGE_MODEL_PREFERENCE = ['flux', 'kontext', 'gptimage', 'gpt-image-2', 'qwen-image'];
const ANALYSIS_MODEL_PREFERENCE = ['openai', 'openai-fast', 'openai-large', 'mistral', 'qwen-vision'];

function parseCostNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function getModelCostInfo(pricing) {
    if (!pricing || typeof pricing !== 'object') {
        return { score: Number.POSITIVE_INFINITY, label: 'cost: n/a' };
    }

    const promptCost = parseCostNumber(pricing.promptTextTokens);
    const completionCost = parseCostNumber(pricing.completionTextTokens);

    if (promptCost !== null && completionCost !== null) {
        const score = promptCost + completionCost;
        return {
            score,
            label: `${score.toExponential(2)} pollen/token`
        };
    }

    const numericCosts = Object.entries(pricing)
        .filter(([key]) => key !== 'currency')
        .map(([, value]) => parseCostNumber(value))
        .filter(value => value !== null);

    if (numericCosts.length === 0) {
        return { score: Number.POSITIVE_INFINITY, label: 'cost: n/a' };
    }

    const score = Math.min(...numericCosts);
    return {
        score,
        label: `${score.toExponential(2)} pollen/unit`
    };
}

function byCostThenPreference(ids) {
    return (a, b) => {
        const aCost = Number.isFinite(a.costScore) ? a.costScore : Number.POSITIVE_INFINITY;
        const bCost = Number.isFinite(b.costScore) ? b.costScore : Number.POSITIVE_INFINITY;

        if (aCost !== bCost) {
            return aCost - bCost;
        }

        const ai = ids.indexOf(a.value);
        const bi = ids.indexOf(b.value);

        if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    };
}

function dedupeModels(models) {
    const seen = new Set();
    return models.filter(model => {
        if (!model?.value || seen.has(model.value)) {
            return false;
        }
        seen.add(model.value);
        return true;
    });
}

/**
 * Fetches image generation models from Pollinations.
 * Falls back to a hardcoded list if the endpoint is unavailable or incomplete.
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
export async function fetchImageModels() {
    try {
        const res = await fetch(POLLINATIONS_IMAGE_MODELS_ENDPOINT);
        if (!res.ok) {
            throw new Error(`Image model fetch failed: ${res.status}`);
        }

        const catalog = await res.json();
        if (!Array.isArray(catalog)) {
            throw new Error('Unexpected image model response.');
        }

        const models = catalog
            // Exclude paid-only models
            .filter(m => m.paid_only !== true)
            // Exclude video models (no image output)
            .filter(m => {
                const out = m.output_modalities || [];
                return out.includes('image') && !out.includes('video');
            })
            .map(m => {
                const pricing = m.pricing || {};
                const completionCost = parseCostNumber(pricing.completionImageTokens);
                const description = typeof m.description === 'string' ? m.description : m.name;
                const costLabel = completionCost !== null
                    ? `${completionCost.toExponential(2)} pollen/img`
                    : 'n/a';
                return {
                    value: m.name,
                    label: `${description} (${costLabel})`,
                    costScore: completionCost !== null ? completionCost : Number.POSITIVE_INFINITY
                };
            });

        const deduped = dedupeModels(models)
            .sort(byCostThenPreference(IMAGE_MODEL_PREFERENCE))
            .map(({ value, label }) => ({ value, label }));

        if (deduped.length > 0) {
            return deduped;
        }

        return FALLBACK_IMAGE_MODELS.map(m => ({
            value: m.value,
            label: `${m.value} (cost: n/a)`
        }));
    } catch {
        return FALLBACK_IMAGE_MODELS.map(m => ({
            value: m.value,
            label: `${m.value} (cost: n/a)`
        }));
    }
}

/**
 * Fetches vision-capable text models from Pollinations.
 * Filters to only models that accept image input.
 * Falls back to a hardcoded list if the endpoint is unavailable.
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
export async function fetchAnalysisModels() {
    try {
        const res = await fetch(POLLINATIONS_TEXT_MODELS_ENDPOINT);
        if (!res.ok) {
            return FALLBACK_ANALYSIS_MODELS.map(m => ({
                value: m.value,
                label: `${m.value} (cost: n/a)`
            }));
        }

        const models = await res.json();
        if (!Array.isArray(models)) {
            return FALLBACK_ANALYSIS_MODELS.map(m => ({
                value: m.value,
                label: `${m.value} (cost: n/a)`
            }));
        }

        // Keep only chat-capable, vision-capable text models for image object detection.
        const visionModels = models
            .filter(m => Array.isArray(m.input_modalities) && m.input_modalities.includes('image'))
            .filter(m => Array.isArray(m.output_modalities) && m.output_modalities.includes('text'))
            .filter(m => m.paid_only !== true)
            .filter(m => {
                const endpoints = m.supported_endpoints;
                if (!Array.isArray(endpoints) || endpoints.length === 0) {
                    return true;
                }
                return endpoints.includes('/v1/chat/completions');
            })
            .map(m => {
                const cost = getModelCostInfo(m.pricing);
                return {
                    value: m.name,
                    label: `${m.name} (${cost.label})`,
                    costScore: cost.score
                };
            });

        const deduped = dedupeModels(visionModels)
            .sort(byCostThenPreference(ANALYSIS_MODEL_PREFERENCE))
            .map(({ value, label }) => ({ value, label }));

        if (deduped.length > 0) {
            return deduped;
        }

        return FALLBACK_ANALYSIS_MODELS.map(m => ({
            value: m.value,
            label: `${m.value} (cost: n/a)`
        }));
    } catch {
        return FALLBACK_ANALYSIS_MODELS.map(m => ({
            value: m.value,
            label: `${m.value} (cost: n/a)`
        }));
    }
}