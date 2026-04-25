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