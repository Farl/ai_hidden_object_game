/**
 * test-analysis.mjs
 * Local analysis accuracy tester.
 * Usage: node test-analysis.mjs [imageUrl] [--model openai|openai-large|gemini] [--prompt absolute|normalized]
 *
 * Reads POLLINATIONS_API_KEY from .env automatically.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------- load .env ----------
const envPath = resolve(import.meta.dirname, '.env');
try {
    const envLines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of envLines) {
        const [key, ...rest] = line.split('=');
        if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    }
} catch { /* .env optional */ }

const API_KEY = process.env.POLLINATIONS_API_KEY || '';
if (!API_KEY) {
    console.error('❌  POLLINATIONS_API_KEY not found in .env');
    process.exit(1);
}

// ---------- CLI args ----------
const args = process.argv.slice(2);
const modelFlag = args.indexOf('--model');
const MODEL = modelFlag !== -1 ? args[modelFlag + 1] : 'openai';

const promptFlag = args.indexOf('--prompt');
const PROMPT_MODE = promptFlag !== -1 ? args[promptFlag + 1] : 'absolute'; // absolute | normalized

// A known stable public test image (classic "living room" scene)
const DEFAULT_IMAGE = 'https://image.pollinations.ai/prompt/a%20colorful%20living%20room%20with%20furniture%20and%20objects?model=flux&seed=42&width=1024&height=1024&nologo=true';
const IMAGE_URL = args.find(a => a.startsWith('http')) || DEFAULT_IMAGE;

// ---------- prompts ----------
const PROMPTS = {
    // Current game prompt: claims absolute pixels but processObjects() scales from 1024
    absolute: `You are an expert of object detection. The input image dimensions are provided by the user. Your task is to identify 3 to 10 distinct, visually findable objects within the input image. For each object you identify, you must provide its name and a highly accurate bounding box.

The bounding box coordinates must be in ABSOLUTE PIXELS, relative to the top-left corner of the image (0,0). The format is [top, left, bottom, right], where each value is an integer.

Respond ONLY with a JSON object that adheres strictly to the following schema. Do not include explanatory text or markdown formatting.
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,

    // Alternative: explicitly request 0-1000 normalized space (then scale by /1000 * dimension)
    normalized: `You are an expert object detector. Your task is to identify 3 to 10 distinct, visually findable objects in the image.

For each object, provide a bounding box in a NORMALIZED 0-1000 coordinate space where (0,0) is the top-left and (1000,1000) is the bottom-right of the image. The format is [top, left, bottom, right].

Respond ONLY with valid JSON. No markdown, no explanation.
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,

    // Google-style: explicitly 1024x1024 space
    space1024: `You are an expert object detector. Identify 3 to 10 distinct objects in the image.

Return bounding boxes in a 1024x1024 coordinate space where (0,0) is top-left. Format: [top, left, bottom, right].

Respond ONLY with valid JSON:
{
  "objects": [
    { "box_2d": [number, number, number, number], "label": string }
  ]
}`
};

// ---------- fetch image dimensions via HTTP HEAD / img load ----------
async function fetchImageDimensions(url) {
    // We can't get dimensions from a URL without downloading in Node; assume 1024x1024 for Flux
    return { width: 1024, height: 1024 };
}

// ---------- call Pollinations ----------
async function callPollinations(imageUrl, systemPrompt, model, imageWidth, imageHeight) {
    const userText = `The image dimensions are ${imageWidth}x${imageHeight}. List 3 to 10 main objects in this image.`;
    const payload = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: imageUrl } },
                    { type: 'text', text: userText }
                ]
            }
        ],
        response_format: { type: 'json_object' },
        stream: false
    };

    const res = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const text = typeof raw === 'string' ? raw : raw.map(p => p.text || '').join('');

    // extract JSON
    try {
        return JSON.parse(text);
    } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
        throw new Error('Could not parse JSON from response:\n' + text);
    }
}

// ---------- evaluate ----------
function evaluateBoxes(objects, imageWidth, imageHeight, promptMode) {
    console.log(`\n=== Raw model response (${objects.length} objects) ===`);
    let suspectCount = 0;

    for (const obj of objects) {
        const [top, left, bottom, right] = obj.box_2d;
        const w = right - left;
        const h = bottom - top;
        const area = w * h;
        const imgArea = imageWidth * imageHeight;
        const areaPct = ((area / imgArea) * 100).toFixed(1);

        // Heuristic: if model said "absolute pixels" but returned values all ≤ 1000
        // AND image is bigger than 1000px, coordinates are likely in normalized space.
        const looksNormalized = [top, left, bottom, right].every(v => v >= 0 && v <= 1000);
        const looksAbsolute = [top, left, bottom, right].some(v => v > 1000);

        const flag = (promptMode === 'absolute' && looksNormalized && imageWidth > 1000) ? ' ⚠️ LOOKS NORMALIZED' : '';

        console.log(`  [${top}, ${left}, ${bottom}, ${right}]  "${obj.label}"  ${areaPct}% of image${flag}`);

        if (flag) suspectCount++;
    }

    console.log('\n=== Diagnosis ===');
    if (promptMode === 'absolute' && suspectCount > 0) {
        console.log(`⚠️  ${suspectCount}/${objects.length} objects returned values ≤ 1000 despite "ABSOLUTE PIXELS" prompt.`);
        console.log('   → Model is likely returning coordinates in a 0-1000 normalized space.');
        console.log('   → processObjects() scaling from 1024 will produce WRONG results.');
        console.log('   → FIX: Use --prompt normalized and adjust processObjects() to scale by /1000.');
    } else if (promptMode === 'absolute') {
        console.log('✅  Coordinates look like absolute pixels in the actual image dimensions.');
        console.log('   → processObjects() should NOT scale (or scale factor = 1.0).');
        console.log('   → FIX: Remove the /1024 scaling in processObjects().');
    } else {
        console.log('✅  Normalized prompt used — scale by /1000 × dimension in processObjects().');
    }
}

// ---------- main ----------
async function main() {
    const systemPrompt = PROMPTS[PROMPT_MODE] || PROMPTS.absolute;
    const { width, height } = await fetchImageDimensions(IMAGE_URL);

    console.log('=== Analysis Test ===');
    console.log(`  Image:       ${IMAGE_URL}`);
    console.log(`  Dimensions:  ${width}x${height}`);
    console.log(`  Model:       ${MODEL}`);
    console.log(`  Prompt mode: ${PROMPT_MODE}`);
    console.log('');
    console.log('Calling Pollinations...');

    let result;
    try {
        result = await callPollinations(IMAGE_URL, systemPrompt, MODEL, width, height);
    } catch (err) {
        console.error('❌  API call failed:', err.message);
        process.exit(1);
    }

    if (!result?.objects?.length) {
        console.error('❌  No objects returned. Raw result:', JSON.stringify(result, null, 2));
        process.exit(1);
    }

    evaluateBoxes(result.objects, width, height, PROMPT_MODE);

    console.log('\n=== Quick comparison across prompt modes ===');
    console.log('Run with --prompt normalized   to test normalized 0-1000 prompt');
    console.log('Run with --prompt space1024    to test explicit 1024x1024 space prompt');
    console.log('Run with --model openai-large  to test with a larger model');
    console.log('Run with --model gemini        to test Google Gemini via Pollinations');
}

main();
