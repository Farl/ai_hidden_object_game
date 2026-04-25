// main.js - Application Entry Point
import * as api from './api.js';
import * as canvas from './canvas.js';
import * as game from './game.js';
import * as ui from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element Selection ---
    const fileInput = document.getElementById('fileInput');
    const genPromptInput = document.getElementById('genPromptInput');
    const generateImageButton = document.getElementById('generateImageButton');
    const imageModelSelect = document.getElementById('imageModelSelect');
    const analysisModelSelect = document.getElementById('analysisModelSelect');
    const imageContainer = document.getElementById('imageContainer');
    const imagePreview = document.getElementById('imagePreview');
    const boundingBoxCanvas = document.getElementById('boundingBoxCanvas');
    const startGameButton = document.getElementById('startGameButton');
    const giveUpButton = document.getElementById('giveUpButton');
    const newImageButton = document.getElementById('newImageButton');
    const objectListContainer = document.getElementById('objectListContainer');
    const gameStatusContainer = document.getElementById('gameStatus');

    // --- Initialization ---
    canvas.init(boundingBoxCanvas, imagePreview);
    ui.init({
        fileInput,
        generateImageButton,
        startGameButton,
        giveUpButton,
        newImageButton,
        imageContainer,
        imagePreview,
        objectListContainer,
        gameStatusContainer
    });

    // Sync model selections into runtime config whenever they change
    function applyModelSelections() {
        window.AI_HIDDEN_OBJECT_CONFIG = {
            ...(window.AI_HIDDEN_OBJECT_CONFIG || {}),
            POLLINATIONS_IMAGE_MODEL: imageModelSelect.value,
            POLLINATIONS_TEXT_MODEL: analysisModelSelect.value,
        };
    }
    imageModelSelect.addEventListener('change', applyModelSelections);
    analysisModelSelect.addEventListener('change', applyModelSelections);

    // Show placeholder while models load, then fetch live lists from the API
    const defaultImageModel = (window.AI_HIDDEN_OBJECT_CONFIG || {}).POLLINATIONS_IMAGE_MODEL || 'flux';
    const defaultAnalysisModel = (window.AI_HIDDEN_OBJECT_CONFIG || {}).POLLINATIONS_TEXT_MODEL || 'openai';
    ui.populateModelSelect(imageModelSelect, [{ value: defaultImageModel, label: 'Loading...' }], defaultImageModel);
    ui.populateModelSelect(analysisModelSelect, [{ value: defaultAnalysisModel, label: 'Loading...' }], defaultAnalysisModel);
    applyModelSelections();

    Promise.all([api.fetchImageModels(), api.fetchAnalysisModels()])
        .then(([imgModels, analysisModels]) => {
            ui.populateModelSelect(imageModelSelect, imgModels, defaultImageModel);
            ui.populateModelSelect(analysisModelSelect, analysisModels, defaultAnalysisModel);
            applyModelSelections();
        })
        .catch(() => { /* keep placeholder selection on fetch failure */ });

    function refreshReadyState() {
        const configError = api.getAnalysisConfigurationError();
        if (configError) {
            ui.showConfigurationRequiredState(configError);
            return;
        }
        ui.showReadyToStartState();
    }

    // --- Event Listeners ---

    // Handle image selection via file input
    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) {
            game.reset();
            ui.reset();
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            game.setImage(dataUrl);
            ui.showImage(
                dataUrl,
                () => { canvas.resizeCanvas(); canvas.clear(); refreshReadyState(); },
                () => { game.reset(); ui.showError('Could not load the selected image file.', false); }
            );
        };
        reader.readAsDataURL(file);
    });

    // Handle AI image generation
    generateImageButton.addEventListener('click', async () => {
        const prompt = genPromptInput.value.trim();
        if (!prompt) {
            alert('Please enter a prompt for image generation!');
            return;
        }

        ui.showLoadingState('Generating image...');
        try {
            const imageUrl = await api.generateImage(prompt);
            game.setImage(imageUrl);
            ui.showImage(
                imageUrl,
                () => { canvas.resizeCanvas(); canvas.clear(); refreshReadyState(); },
                () => {
                    // URL returned OK but browser could not load the image (service busy, etc.)
                    game.reset();
                    ui.showError('Image failed to load. The generation service may be busy -- please try again.', false);
                }
            );
        } catch (error) {
            console.error('Error generating image:', error);
            game.reset();
            ui.showError(`Image generation failed: ${error.message}`, false);
        }
    });

    // Handle giving up
    giveUpButton.addEventListener('click', () => {
        if (!game.isGameActive()) return;

        game.giveUp();
        canvas.redraw(game.getObjects());
        ui.showGiveUpState();
    });

    // Handle going back to the setup screen
    newImageButton.addEventListener('click', () => {
        game.reset();
        canvas.clear();
        ui.reset();
    });

    // Handle starting or restarting the game
    startGameButton.addEventListener('click', async () => {
        if (!game.getImageDataUrl()) {
            alert('Please select or generate an image first!');
            return;
        }

        const configError = api.getAnalysisConfigurationError();
        if (configError) {
            ui.showConfigurationRequiredState(configError);
            return;
        }

        if (game.isGameActive()) {
            game.reset();
            ui.reset();
            canvas.clear();
            refreshReadyState();
            return;
        }

        ui.showLoadingState('Analyzing image... (this may take up to 60 s)');
        try {
            const analysisResult = await api.analyzeImage(
                game.getImageDataUrl(),
                imagePreview.naturalWidth,
                imagePreview.naturalHeight
            );

            if (!analysisResult || !analysisResult.objects || analysisResult.objects.length === 0) {
                ui.showError('AI could not find any objects. Try a different image or analysis model.', true);
                return;
            }

            const scaledObjects = game.processObjects(
                analysisResult.objects,
                imagePreview.naturalWidth,
                imagePreview.naturalHeight
            );

            if (scaledObjects.length === 0) {
                ui.showError('AI returned data in an unexpected format. Please try again.', true);
                return;
            }

            game.start(scaledObjects);
            ui.startGameUI(game.getObjects());

            // Recalculate canvas dimensions after UI transition to fullscreen
            canvas.resizeCanvas();

        } catch (error) {
            console.error('Error starting game:', error);
            const errorMessage = error.message.includes('JSON')
                ? 'The AI returned an invalid response. Try a different model or image.'
                : `Analysis failed: ${error.message}`;
            // hasValidImage=true keeps Start button enabled so user can retry
            ui.showError(errorMessage, true);
        }
    });

    // Handle clicking on the canvas to find objects
    boundingBoxCanvas.addEventListener('click', (event) => {
        if (!game.isGameActive()) return;

        const pos = canvas.getMousePosition(event);
        if (!pos) return;

        const foundObject = game.findObjectAt(pos);
        if (foundObject) {
            game.markObjectAsFound(foundObject);
            ui.markObjectAsFoundInList(foundObject.id);
            canvas.redraw(game.getObjects());

            if (game.checkWinCondition()) {
                ui.showWinState();
            }
        }
    });

    // Handle window resizing
    window.addEventListener('resize', () => {
        if (game.getImageDataUrl()) {
            canvas.resizeCanvas();
            canvas.redraw(game.getObjects());
        }
    });
});
