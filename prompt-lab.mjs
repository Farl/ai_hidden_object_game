/**
 * prompt-lab.mjs
 * Batch prompt experiment runner for object-detection quality.
 *
 * What it does:
 * 1. Downloads or copies a source image locally
 * 2. Runs multiple analysis prompts against the same image
 * 3. Draws bounding boxes on top of the image
 * 4. Sends the overlaid image back to the model for box review and correction
 * 5. Writes a report with the highest-scoring prompt
 *
 * Usage:
 *   node prompt-lab.mjs
 *   node prompt-lab.mjs ./my-image.png --model openai
 *   node prompt-lab.mjs https://.../image.png --model openai-large --prompt coord-visible
 *   node prompt-lab.mjs ./my-image.png --model openai,openai-large --review-model openai-large --prompt coord-baseline,coord-grid
 *   node prompt-lab.mjs benchmark/matrix-benchmark.png --ground-truth benchmark/matrix-benchmark.ground-truth.json --model openai,openai-large --prompt bench-matrix-baseline,bench-matrix-visible
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { basename, extname, join, resolve } from 'path';
import { spawnSync } from 'child_process';

const DEFAULT_IMAGE = 'https://image.pollinations.ai/prompt/a%20cozy%20living%20room%20with%20a%20sofa%2C%20lamp%2C%20coffee%20table%2C%20bookshelf%2C%20plant%20and%20rug?model=flux&seed=42&width=1024&height=1024&nologo=true';
const DEFAULT_MODEL = 'openai';
const OUTPUT_ROOT = resolve(import.meta.dirname, 'lab-output');
const FONT_FILE = '/System/Library/Fonts/Supplemental/Arial.ttf';

loadEnv(resolve(import.meta.dirname, '.env'));

const API_KEY = process.env.POLLINATIONS_API_KEY || '';
if (!API_KEY) {
    console.error('POLLINATIONS_API_KEY not found in .env');
    process.exit(1);
}

const PROMPTS = {
    'coord-baseline': {
        label: 'Coordinate baseline',
        system: `You are an expert object detector.

Identify 4 to 6 prominent visible objects in the image. Your only goal is accurate localization.

For each object:
- return one tight bounding box around the visible object extent
- do not include large background margins
- do not merge multiple objects into one box
- do not return scene regions like wall, floor, or window area

Use NORMALIZED 0-1000 coordinates in [top, left, bottom, right].

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Return 4 to 6 prominent visible objects with tight normalized bounding boxes.'
    },
    'coord-visible': {
        label: 'Visible extent only',
        system: `You are evaluating bounding-box accuracy.

Identify 4 to 6 visible objects and draw each box around only the visible pixels of that object. If part of an object is hidden, do not include the hidden portion. Each box should hug the visible outline as closely as a rectangle allows.

Rules:
- no tiny objects
- no duplicate objects
- no background regions
- no extra padding unless needed to include the visible object

Use NORMALIZED 0-1000 coordinates in [top, left, bottom, right].

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Return 4 to 6 objects with boxes covering only their visible extent.'
    },
    'coord-grid': {
        label: 'Grid checked coordinates',
        system: `You are an expert at precise image localization.

The image is mapped to a 1000 by 1000 grid. For each object, think about the top, left, bottom, and right boundary separately, then return a tight box.

Choose 4 to 6 clear objects. Prefer medium or large objects with obvious edges. Avoid ambiguous scene regions.

Use NORMALIZED 0-1000 coordinates in [top, left, bottom, right].

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Return 4 to 6 clear objects with precise 0-1000 bounding boxes. Check each edge separately.'
    },
    'coord-verify': {
        label: 'Self-checked coordinates',
        system: `You are an expert object detector.

Identify 4 to 6 visible objects. For each object, estimate a tight box, mentally verify whether each of the four sides is touching the visible object, and then output the final coordinates.

Avoid:
- scene regions
- tiny objects
- highly overlapping object groups
- boxes with large empty margins

Use NORMALIZED 0-1000 coordinates in [top, left, bottom, right].

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Return 4 to 6 objects with tight normalized boxes after checking each box edge for extra padding.'
    },
    'bench-matrix-baseline': {
        label: 'Benchmark matrix baseline',
        system: `You are evaluating localization on a synthetic benchmark image.

The image contains exactly 9 large colored geometric shapes arranged in a 3 by 3 matrix. Detect all 9 shapes.

Use these labels exactly:
- red circle
- blue square
- green triangle
- orange diamond
- purple star
- teal hexagon
- yellow rounded rectangle
- pink plus
- black ring

Return one tight box around the visible colored shape only. Do not include grid lines or background.

Use NORMALIZED 0-1000 coordinates in [top, left, bottom, right].

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Return all 9 colored shapes with the exact labels listed in the system prompt and tight normalized boxes.'
    },
    'bench-matrix-visible': {
        label: 'Benchmark matrix visible extent',
        system: `You are evaluating precise object localization on a synthetic benchmark image.

The image contains exactly 9 large colored geometric shapes in a 3 by 3 matrix. Detect all 9 shapes and use these labels exactly:
- red circle
- blue square
- green triangle
- orange diamond
- purple star
- teal hexagon
- yellow rounded rectangle
- pink plus
- black ring

For each shape, return a tight box around only the visible colored shape extent:
- exclude the pale grid lines
- exclude background margins
- do not merge shapes
- each of the four sides should touch the shape as closely as a rectangle allows

Use NORMALIZED 0-1000 coordinates in [top, left, bottom, right].

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Return all 9 benchmark shapes with exact labels and tight normalized boxes around the visible colored shape only.'
    },
    baseline: {
        label: 'Baseline normalized',
        system: `You are an expert object detector. Your task is to identify 3 to 10 distinct, visually findable objects within the input image.

For each object, provide a bounding box in a NORMALIZED 0-1000 coordinate space where (0, 0) is the top-left corner and (1000, 1000) is the bottom-right corner of the image. The format is [top, left, bottom, right], where each value is an integer between 0 and 1000.

Respond ONLY with a JSON object that adheres strictly to the following schema. Do not include explanatory text or markdown formatting.
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'List 3 to 8 main objects in this image with their bounding boxes in normalized 0-1000 coordinates.'
    },
    'tight-normalized': {
        label: 'Tight normalized',
        system: `You are an expert object detector for hidden-object gameplay.

Identify 3 to 8 distinct objects that are easy for a player to click. Prefer medium or large, clearly visible, non-overlapping objects.

For every object, return one tight bounding box around the visible object only. Do not include nearby furniture, empty background, shadows, or large padding. Avoid tiny decorative details. Avoid duplicate boxes for the same object.

Use NORMALIZED 0-1000 coordinates, where [top, left, bottom, right] maps to the full image. Every coordinate must be an integer from 0 to 1000.

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Return 3 to 8 clickable objects with tight normalized boxes. Choose objects whose boundaries are visually clear.'
    },
    'grid-anchored': {
        label: 'Grid anchored',
        system: `You are an expert object detector.

The image uses a normalized 1000 by 1000 grid. Think carefully about the object edges before answering. Each returned box must tightly match the visible object silhouette, not the surrounding scene.

Rules:
- Return 3 to 8 distinct objects
- Prefer clearly visible objects near the foreground or midground
- No duplicate objects
- No giant scene-spanning boxes
- Every box must stay inside the image bounds
- Format is [top, left, bottom, right]

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Find 3 to 8 prominent objects and give precise 0-1000 boxes.'
    },
    'clickable-objects': {
        label: 'Clickable gameplay objects',
        system: `You are preparing objects for a hidden-object game.

Choose 3 to 8 objects that would be fair and satisfying to click. Each object must be visually separable from its surroundings. Prefer a whole object with a recognizable outline.

Return a tight bounding box for each object in NORMALIZED 0-1000 coordinates. Format: [top, left, bottom, right].

Do not return:
- tiny clutter
- partially cut-off objects
- broad regions like "wall", "floor", "background"
- boxes with much extra padding

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Choose the best gameplay objects and return tight normalized boxes.'
    },
    'stable-furniture': {
        label: 'Stable furniture only',
        system: `You are preparing bounding boxes for a hidden-object game.

Only choose objects that can be boxed accurately with one simple rectangle. Prefer solid furniture or decor with clear outer boundaries.

Good choices:
- coffee table
- bookshelf
- sofa
- lampshade
- large pillow
- planter or pot

Bad choices:
- floor lamp stand
- cups or very small objects
- leaves or plant parts
- windows, curtains, walls, or background areas
- oversized regions like the entire rug unless the rug boundary is very clear

Return exactly 4 to 6 objects. Every box must be tight and clickable, with minimal empty padding.

Use NORMALIZED 0-1000 coordinates in [top, left, bottom, right].

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Choose 4 to 6 stable, easy-to-box furniture or decor objects. Avoid thin, tiny, or ambiguous objects.'
    },
    'low-risk-boxes': {
        label: 'Low risk boxes',
        system: `You are selecting objects for accurate rectangular boxing.

Return only objects that satisfy all of these:
- clearly visible
- mostly unoccluded
- medium or large size
- easy to separate from the background
- can be enclosed by an axis-aligned rectangle with little wasted space

Reject objects that are thin, tiny, partially hidden, or visually merged with other objects.
Prefer 4 to 6 objects total.

Use NORMALIZED 0-1000 coordinates in [top, left, bottom, right].

Respond ONLY with JSON:
{
  "objects": [
    {
      "box_2d": [number, number, number, number],
      "label": string
    }
  ]
}`,
        user: 'Return 4 to 6 low-risk objects with accurate, tight boxes. Skip anything uncertain.'
    }
};

const REVIEW_SYSTEM_PROMPT = `You are reviewing bounding boxes that are already drawn on an image. Each box has an integer id printed near the top-left corner, and each id corresponds to a label given by the user.

Inspect whether each drawn box tightly encloses the intended object. Correct the box if needed. Keep the same ids and labels. Do not invent new objects.

Use NORMALIZED 0-1000 coordinates in [top, left, bottom, right].

Scoring rubric:
- 5 = tightly fits the visible object
- 4 = mostly correct, minor padding or slight cutoff
- 3 = object is right but box needs clear adjustment
- 2 = poor fit or partially on wrong object
- 1 = wrong object or unusable

Respond ONLY with JSON:
{
  "objects": [
    {
      "id": number,
      "label": string,
      "score": number,
      "box_2d": [number, number, number, number],
      "notes": string
    }
  ],
  "average_score": number
}`;

async function main() {
    const args = process.argv.slice(2);
    const sourceArg = getPositionalArgs(args)[0] || DEFAULT_IMAGE;
    const models = parseCsvFlag(args, '--model', DEFAULT_MODEL);
    const reviewModel = getFlagValue(args, '--review-model') || 'openai-large';
    const promptFilter = getFlagValue(args, '--prompt');
    const groundTruthPath = getFlagValue(args, '--ground-truth');
    const selectedPrompts = promptFilter ? pickPrompts(promptFilter) : Object.entries(PROMPTS);

    if (selectedPrompts.length === 0) {
        console.error(`Unknown prompt name: ${promptFilter}`);
        console.error(`Available prompts: ${Object.keys(PROMPTS).join(', ')}`);
        process.exit(1);
    }

    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = join(OUTPUT_ROOT, runId);
    mkdirSync(runDir, { recursive: true });

    const sourceImagePath = await prepareImage(sourceArg, runDir);
    const dimensions = probeImageDimensions(sourceImagePath);
    const imageDataUrl = await toDataUrl(sourceImagePath);
    const groundTruth = groundTruthPath ? loadGroundTruth(groundTruthPath) : null;

    console.log(`Source image: ${sourceImagePath}`);
    console.log(`Dimensions: ${dimensions.width}x${dimensions.height}`);
    console.log(`Models: ${models.join(', ')}`);
    console.log(`Reviewer model: ${reviewModel}`);
    console.log(`Prompts: ${selectedPrompts.map(([name]) => name).join(', ')}`);
    if (groundTruth) {
        console.log(`Ground truth: ${groundTruthPath}`);
    }

    const results = [];

    for (const model of models) {
        for (const [promptName, promptDef] of selectedPrompts) {
            console.log(`\nRunning model=${model} prompt=${promptName}`);
            const detected = await callPollinations({
                model,
                systemPrompt: promptDef.system,
                userText: promptDef.user,
                imageUrlOrDataUrl: imageDataUrl
            });

            const normalizedObjects = normalizeObjects(detected.objects || []);
            const fileStem = `${model}.${promptName}`;
            const rawPath = join(runDir, `${fileStem}.raw.json`);
            writeJson(rawPath, { prompt: promptName, label: promptDef.label, model, objects: normalizedObjects });

            const benchmarkMetrics = groundTruth
                ? evaluateAgainstGroundTruth(normalizedObjects, groundTruth)
                : null;
            const metricsPath = benchmarkMetrics
                ? join(runDir, `${fileStem}.metrics.json`)
                : '';
            if (benchmarkMetrics) {
                writeJson(metricsPath, benchmarkMetrics);
            }

            const overlayPath = join(runDir, `${fileStem}.overlay.png`);
            renderOverlayImage({
                sourceImagePath,
                outputImagePath: overlayPath,
                objects: normalizedObjects,
                width: dimensions.width,
                height: dimensions.height
            });

            const overlayDataUrl = await toDataUrl(overlayPath);
            const review = await callPollinations({
                model: reviewModel,
                systemPrompt: REVIEW_SYSTEM_PROMPT,
                userText: buildReviewUserText(normalizedObjects),
                imageUrlOrDataUrl: overlayDataUrl
            });

            const reviewedObjects = normalizeReviewedObjects(review.objects || [], normalizedObjects);
            const reviewedPath = join(runDir, `${fileStem}.review.json`);
            writeJson(reviewedPath, {
                prompt: promptName,
                model,
                review_model: reviewModel,
                average_score: getAverageScore(reviewedObjects),
                objects: reviewedObjects
            });

            const correctedOverlayPath = join(runDir, `${fileStem}.corrected.png`);
            renderOverlayImage({
                sourceImagePath,
                outputImagePath: correctedOverlayPath,
                objects: reviewedObjects,
                width: dimensions.width,
                height: dimensions.height
            });

            results.push({
                model,
                reviewModel,
                promptName,
                label: promptDef.label,
                rawPath,
                metricsPath,
                overlayPath,
                reviewedPath,
                correctedOverlayPath,
                objects: reviewedObjects,
                averageScore: getAverageScore(reviewedObjects),
                benchmarkMetrics
            });

            console.log(`Average review score: ${getAverageScore(reviewedObjects).toFixed(2)}`);
            if (benchmarkMetrics) {
                console.log(`Ground-truth mean IoU: ${benchmarkMetrics.mean_iou.toFixed(3)} (${benchmarkMetrics.matched_count}/${benchmarkMetrics.total_ground_truth} matched)`);
            }
        }
    }

    results.sort((a, b) => getPrimarySortScore(b) - getPrimarySortScore(a));
    const summaryPath = join(runDir, 'summary.md');
    writeFileSync(summaryPath, buildSummary({
        sourceArg,
        sourceImagePath,
        dimensions,
        groundTruthPath,
        results
    }));

    console.log('\nFinished.');
    console.log(`Report: ${summaryPath}`);
    if (results[0]) {
        if (results[0].benchmarkMetrics) {
            console.log(`Best result: ${results[0].model} / ${results[0].promptName} (mean IoU ${results[0].benchmarkMetrics.mean_iou.toFixed(3)})`);
        } else {
            console.log(`Best result: ${results[0].model} / ${results[0].promptName} (${results[0].averageScore.toFixed(2)})`);
        }
    }
}

function loadEnv(envPath) {
    if (!existsSync(envPath)) {
        return;
    }

    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) {
            continue;
        }
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (key && !(key in process.env)) {
            process.env[key] = value;
        }
    }
}

function getFlagValue(args, flag) {
    const index = args.indexOf(flag);
    return index === -1 ? '' : args[index + 1];
}

function parseCsvFlag(args, flag, fallback) {
    const value = getFlagValue(args, flag) || fallback;
    return value.split(',').map(item => item.trim()).filter(Boolean);
}

function getPositionalArgs(args) {
    const flagsWithValue = new Set(['--model', '--prompt', '--review-model', '--ground-truth']);
    const positional = [];

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (flagsWithValue.has(arg)) {
            index += 1;
            continue;
        }
        if (!arg.startsWith('--')) {
            positional.push(arg);
        }
    }

    return positional;
}

function pickPrompts(value) {
    return value
        .split(',')
        .map(name => name.trim())
        .filter(Boolean)
        .map(name => [name, PROMPTS[name]])
        .filter(([, config]) => Boolean(config));
}

function loadGroundTruth(filePath) {
    const resolved = resolve(process.cwd(), filePath);
    if (!existsSync(resolved)) {
        throw new Error(`Ground truth file not found: ${resolved}`);
    }

    const parsed = JSON.parse(readFileSync(resolved, 'utf8'));
    return {
        ...parsed,
        objects: Array.isArray(parsed.objects)
            ? parsed.objects
                .map(object => ({
                    ...object,
                    label: sanitizeLabel(object.label || ''),
                    aliases: Array.isArray(object.aliases) ? object.aliases.map(sanitizeLabel) : [],
                    box_2d: normalizeBox(object.box_2d)
                }))
                .filter(object => object.label && object.box_2d)
            : []
    };
}

async function prepareImage(sourceArg, runDir) {
    const sourceDir = join(runDir, 'source');
    mkdirSync(sourceDir, { recursive: true });

    if (/^https?:\/\//i.test(sourceArg)) {
        const response = await fetch(sourceArg);
        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
        }

        const url = new URL(sourceArg);
        const guessedName = basename(url.pathname) || 'image.png';
        const extension = extname(guessedName) || '.png';
        const outputPath = join(sourceDir, `downloaded${extension}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(outputPath, buffer);
        return outputPath;
    }

    const localSource = resolve(process.cwd(), sourceArg);
    if (!existsSync(localSource)) {
        throw new Error(`Local image not found: ${localSource}`);
    }

    const extension = extname(localSource) || '.png';
    const outputPath = join(sourceDir, `copied${extension}`);
    copyFileSync(localSource, outputPath);
    return outputPath;
}

function probeImageDimensions(imagePath) {
    const result = spawnSync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'json',
        imagePath
    ], { encoding: 'utf8' });

    if (result.status !== 0) {
        throw new Error(`ffprobe failed: ${result.stderr || result.stdout}`);
    }

    const parsed = JSON.parse(result.stdout);
    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream?.height) {
        throw new Error('Unable to detect image dimensions.');
    }
    return { width: stream.width, height: stream.height };
}

async function toDataUrl(imagePath) {
    const extension = extname(imagePath).toLowerCase();
    const mimeType = extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.webp'
            ? 'image/webp'
            : 'image/png';
    const bytes = readFileSync(imagePath);
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

async function callPollinations({ model, systemPrompt, userText, imageUrlOrDataUrl }) {
    const payload = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: imageUrlOrDataUrl } },
                    { type: 'text', text: userText }
                ]
            }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        stream: false
    };

    const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Pollinations error ${response.status}: ${body}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
            ? content.map(part => part?.text || '').join('').trim()
            : '';

    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error(`Could not parse JSON from response: ${text}`);
        }
        return JSON.parse(match[0]);
    }
}

function normalizeObjects(objects) {
    return objects
        .map((object, index) => {
            const box = normalizeBox(object.box_2d || object.box2d);
            if (!box) {
                return null;
            }

            return {
                id: index + 1,
                label: sanitizeLabel(object.label || `object_${index + 1}`),
                box_2d: box
            };
        })
        .filter(Boolean);
}

function normalizeReviewedObjects(reviewedObjects, originalObjects) {
    const originalById = new Map(originalObjects.map(object => [object.id, object]));

    return reviewedObjects
        .map(review => {
            const fallback = originalById.get(Number(review.id));
            if (!fallback) {
                return null;
            }

            return {
                id: fallback.id,
                label: sanitizeLabel(review.label || fallback.label),
                score: clampNumber(review.score, 1, 5, 1),
                notes: String(review.notes || '').trim(),
                box_2d: normalizeBox(review.box_2d || fallback.box_2d) || fallback.box_2d
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.id - b.id);
}

function normalizeLabelKey(value) {
    return sanitizeLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function evaluateAgainstGroundTruth(predictedObjects, groundTruth) {
    const gtObjects = groundTruth.objects || [];
    const unmatchedPredictions = new Set(predictedObjects.map(object => object.id));
    const details = [];
    let iouSum = 0;
    let centerErrorSum = 0;
    let matchedCount = 0;

    for (const gt of gtObjects) {
        const gtKeys = new Set([gt.label, ...(gt.aliases || [])].map(normalizeLabelKey));
        let matchedPrediction = null;

        for (const predicted of predictedObjects) {
            if (!unmatchedPredictions.has(predicted.id)) {
                continue;
            }
            if (gtKeys.has(normalizeLabelKey(predicted.label))) {
                matchedPrediction = predicted;
                unmatchedPredictions.delete(predicted.id);
                break;
            }
        }

        if (!matchedPrediction) {
            details.push({
                ground_truth_label: gt.label,
                predicted_label: '',
                iou: 0,
                center_error: null,
                matched: false
            });
            continue;
        }

        const iou = computeIoU(gt.box_2d, matchedPrediction.box_2d);
        const centerError = computeCenterError(gt.box_2d, matchedPrediction.box_2d);
        iouSum += iou;
        centerErrorSum += centerError;
        matchedCount += 1;

        details.push({
            ground_truth_label: gt.label,
            predicted_label: matchedPrediction.label,
            iou,
            center_error: centerError,
            matched: true
        });
    }

    return {
        total_ground_truth: gtObjects.length,
        total_predictions: predictedObjects.length,
        matched_count: matchedCount,
        missing_count: gtObjects.length - matchedCount,
        extra_prediction_count: unmatchedPredictions.size,
        mean_iou: gtObjects.length ? iouSum / gtObjects.length : 0,
        mean_iou_matched: matchedCount ? iouSum / matchedCount : 0,
        mean_center_error: matchedCount ? centerErrorSum / matchedCount : null,
        details
    };
}

function computeIoU(boxA, boxB) {
    const top = Math.max(boxA[0], boxB[0]);
    const left = Math.max(boxA[1], boxB[1]);
    const bottom = Math.min(boxA[2], boxB[2]);
    const right = Math.min(boxA[3], boxB[3]);

    const intersection = Math.max(0, bottom - top) * Math.max(0, right - left);
    const areaA = Math.max(0, boxA[2] - boxA[0]) * Math.max(0, boxA[3] - boxA[1]);
    const areaB = Math.max(0, boxB[2] - boxB[0]) * Math.max(0, boxB[3] - boxB[1]);
    const union = areaA + areaB - intersection;

    return union > 0 ? intersection / union : 0;
}

function computeCenterError(boxA, boxB) {
    const aY = (boxA[0] + boxA[2]) / 2;
    const aX = (boxA[1] + boxA[3]) / 2;
    const bY = (boxB[0] + boxB[2]) / 2;
    const bX = (boxB[1] + boxB[3]) / 2;
    return Math.hypot(aX - bX, aY - bY);
}

function normalizeBox(box) {
    if (!Array.isArray(box) || box.length !== 4) {
        return null;
    }

    const top = clampNumber(box[0], 0, 1000, 0);
    const left = clampNumber(box[1], 0, 1000, 0);
    const bottom = clampNumber(box[2], 0, 1000, 0);
    const right = clampNumber(box[3], 0, 1000, 0);

    if (bottom <= top || right <= left) {
        return null;
    }

    return [top, left, bottom, right];
}

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(number)));
}

function sanitizeLabel(value) {
    return String(value).replace(/\s+/g, ' ').trim() || 'object';
}

function buildReviewUserText(objects) {
    const lines = objects.map(object => `${object.id}: ${object.label} ${JSON.stringify(object.box_2d)}`);
    return [
        'Review these drawn boxes and correct them if needed.',
        'Keep the same ids and labels.',
        'Objects:',
        ...lines
    ].join('\n');
}

function normalizedToPixels(box, width, height) {
    return {
        top: Math.round((box[0] / 1000) * height),
        left: Math.round((box[1] / 1000) * width),
        bottom: Math.round((box[2] / 1000) * height),
        right: Math.round((box[3] / 1000) * width)
    };
}

function renderOverlayImage({ sourceImagePath, outputImagePath, objects, width, height }) {
    const filters = [];

    for (const object of objects) {
        const box = normalizedToPixels(object.box_2d, width, height);
        const boxWidth = Math.max(1, box.right - box.left);
        const boxHeight = Math.max(1, box.bottom - box.top);
        const textX = box.left + 8;
        const textY = Math.max(24, box.top + 24);
        const scoreText = typeof object.score === 'number' ? ` (${object.score})` : '';
        const labelText = escapeFfmpegText(`${object.id}${scoreText}`);

        filters.push(`drawbox=x=${box.left}:y=${box.top}:w=${boxWidth}:h=${boxHeight}:color=yellow@0.95:t=4`);
        filters.push(`drawbox=x=${Math.max(0, textX - 6)}:y=${Math.max(0, textY - 22)}:w=44:h=28:color=black@0.65:t=fill`);
        filters.push(`drawtext=fontfile=${FONT_FILE}:text='${labelText}':x=${textX}:y=${textY - 20}:fontsize=20:fontcolor=white`);
    }

    if (filters.length === 0) {
        copyFileSync(sourceImagePath, outputImagePath);
        return;
    }

    const result = spawnSync('ffmpeg', [
        '-y',
        '-i', sourceImagePath,
        '-vf', filters.join(','),
        outputImagePath
    ], { encoding: 'utf8' });

    if (result.status !== 0) {
        throw new Error(`ffmpeg overlay failed: ${result.stderr || result.stdout}`);
    }
}

function escapeFfmpegText(text) {
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'")
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

function getAverageScore(objects) {
    if (!objects.length) {
        return 0;
    }
    return objects.reduce((sum, object) => sum + clampNumber(object.score, 1, 5, 1), 0) / objects.length;
}

function writeJson(filePath, data) {
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function getPrimarySortScore(result) {
    return result.benchmarkMetrics ? result.benchmarkMetrics.mean_iou : result.averageScore;
}

function buildSummary({ sourceArg, sourceImagePath, dimensions, groundTruthPath, results }) {
    const lines = [
        '# Prompt Lab Summary',
        '',
        `- Source input: \`${sourceArg}\``,
        `- Local source image: \`${sourceImagePath}\``,
        `- Dimensions: \`${dimensions.width}x${dimensions.height}\``,
        ''
    ];

    if (groundTruthPath) {
        lines.splice(lines.length - 1, 0, `- Ground truth: \`${groundTruthPath}\``);
    }

    for (const result of results) {
        lines.push(`## ${result.model} / ${result.promptName}`);
        lines.push('');
        lines.push(`- Model: \`${result.model}\``);
        lines.push(`- Reviewer: \`${result.reviewModel}\``);
        lines.push(`- Label: ${result.label}`);
        lines.push(`- Average score: ${result.averageScore.toFixed(2)}`);
        if (result.benchmarkMetrics) {
            lines.push(`- Mean IoU: ${result.benchmarkMetrics.mean_iou.toFixed(3)}`);
            lines.push(`- Mean IoU (matched only): ${result.benchmarkMetrics.mean_iou_matched.toFixed(3)}`);
            lines.push(`- Matched ground-truth objects: ${result.benchmarkMetrics.matched_count}/${result.benchmarkMetrics.total_ground_truth}`);
            lines.push(`- Extra predictions: ${result.benchmarkMetrics.extra_prediction_count}`);
            if (typeof result.benchmarkMetrics.mean_center_error === 'number') {
                lines.push(`- Mean center error: ${result.benchmarkMetrics.mean_center_error.toFixed(1)}`);
            }
        }
        lines.push(`- Raw boxes: \`${basename(result.rawPath)}\``);
        if (result.metricsPath) {
            lines.push(`- Benchmark metrics: \`${basename(result.metricsPath)}\``);
        }
        lines.push(`- Overlay image: \`${basename(result.overlayPath)}\``);
        lines.push(`- Review JSON: \`${basename(result.reviewedPath)}\``);
        lines.push(`- Corrected overlay: \`${basename(result.correctedOverlayPath)}\``);
        lines.push('');

        for (const object of result.objects) {
            lines.push(`- #${object.id} ${object.label}: score ${object.score}, box ${JSON.stringify(object.box_2d)}${object.notes ? `, ${object.notes}` : ''}`);
        }
        if (result.benchmarkMetrics) {
            lines.push('');
            for (const detail of result.benchmarkMetrics.details) {
                lines.push(`- GT ${detail.ground_truth_label}: ${detail.matched ? `matched ${detail.predicted_label}, IoU ${detail.iou.toFixed(3)}, center error ${detail.center_error.toFixed(1)}` : 'missing'}`);
            }
        }
        lines.push('');
    }

    if (results[0]) {
        lines.push(`## Best Prompt`);
        lines.push('');
        if (results[0].benchmarkMetrics) {
            lines.push(`\`${results[0].model} / ${results[0].promptName}\` scored highest at mean IoU \`${results[0].benchmarkMetrics.mean_iou.toFixed(3)}\`.`);
        } else {
            lines.push(`\`${results[0].model} / ${results[0].promptName}\` scored highest at \`${results[0].averageScore.toFixed(2)}\`.`);
        }
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
