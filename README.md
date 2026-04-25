# AI Hidden Object Game

Static browser hidden object game, prepared for GitHub Pages.

## Current baseline

- Upload your own image or generate one with AI
- Use AI vision to detect objects and bounding boxes
- Click objects to mark them as found

## AI provider abstraction

The app now supports runtime-configured providers through `window.AI_HIDDEN_OBJECT_CONFIG` in `config.js`.

- `IMAGE_PROVIDER`: currently `pollinations`
- `ANALYSIS_PROVIDER`: `pollinations` or `github`

### GitHub Models

GitHub Models currently offers a free, rate-limited API for experimentation, but it requires a personal access token with `models:read` permission.

That means:

- it can be used for local testing
- it should not be hardcoded into a public GitHub Pages site
- for public Pages, the safe default remains Pollinations or another non-secret public endpoint

## Configuration

Edit `config.js` for safe public defaults and provider selection.

If you want to test GitHub Models locally, copy the values from `config.local.example.js` into your local `config.js` without committing the token.

## GitHub variables and secrets

The reference project uses a GitHub Actions workflow to inject secrets into `config.js` at deploy time. This project now follows the same pattern, but also supports repo variables for non-sensitive provider settings.

Inspect current configuration with GitHub CLI:

```bash
gh variable list -R Farl/ai_hidden_object_game
gh secret list -R Farl/ai_hidden_object_game
```

Set the common values with GitHub CLI:

```bash
gh secret set POLLINATIONS_API_KEY -R Farl/ai_hidden_object_game
gh secret set GITHUB_MODELS_TOKEN -R Farl/ai_hidden_object_game

gh variable set ANALYSIS_PROVIDER -b pollinations -R Farl/ai_hidden_object_game
gh variable set IMAGE_PROVIDER -b pollinations -R Farl/ai_hidden_object_game
gh variable set POLLINATIONS_TEXT_MODEL -b openai -R Farl/ai_hidden_object_game
gh variable set GITHUB_MODEL -b openai/gpt-4.1-mini -R Farl/ai_hidden_object_game
```

Recommended setup for a public Pages site:

- use `IMAGE_PROVIDER=pollinations`
- use `ANALYSIS_PROVIDER=pollinations` only when `POLLINATIONS_API_KEY` is set
- use `ANALYSIS_PROVIDER=github` only when `GITHUB_MODELS_TOKEN` is set

## GitHub Pages

Published site:

- https://farl.github.io/ai_hidden_object_game/

## Validation pipeline

This repository now includes a formal validation workflow at `.github/workflows/validate.yml`.

- `static-checks`: runs `node --check` on all runtime files and `test-analysis.mjs`

To run the same smoke test locally:

```bash
node test-analysis.mjs --model openai-fast --prompt normalized
```

## Prompt lab

For repeated prompt experiments with overlaid bounding boxes and a second review pass:

```bash
node prompt-lab.mjs
node prompt-lab.mjs ./my-image.png --model gemini-fast
node prompt-lab.mjs ./my-image.png --model gemini-fast --prompt coord-visible
node prompt-lab.mjs ./my-image.png --model openai,gemini-fast --review-model gemini-fast --prompt coord-baseline,coord-visible,coord-grid,coord-verify
```

The script writes JSON reports and overlaid images into `lab-output/`, so you can compare which prompt produces the most accurate boxes on the same source image.

## Synthetic benchmark

For a controlled localization benchmark with known ground truth:

```bash
node prompt-lab.mjs benchmark/matrix-benchmark.png \
  --ground-truth benchmark/matrix-benchmark.ground-truth.json \
  --model openai-fast \
  --review-model openai-fast \
  --prompt bench-matrix-baseline,bench-matrix-visible
```

The benchmark image contains a 3x3 matrix of colored geometric shapes with exact labels and normalized ground-truth boxes, so the lab can compute mean IoU in addition to model-reviewed box scores.
