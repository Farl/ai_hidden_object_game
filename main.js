// main.js - Application Entry Point
import * as api from './api.js';
import * as canvas from './canvas.js';
import * as game from './game.js';
import * as ui from './ui.js';

// Image generation models available on image.pollinations.ai
const IMAGE_MODELS = [
    { value: 'flux',           label: 'Flux (default)' },
    { value: 'flux-realism',   label: 'Flux Realism' },
    { value: 'flux-anime',     label: 'Flux Anime' },
    { value: 'flux-3d',        label: 'Flux 3D' },
    { value: 'turbo',          label: 'Turbo (fast)' },
    { value: 'sana',           label: 'Sana' },
];

// Vision-capable analysis models available on gen.pollinations.ai
const ANALYSIS_MODELS = [
    { value: 'openai',         label: 'OpenAI GPT-4o' },
    { value: 'openai-large',   label: 'OpenAI GPT-4o Large' },
    { value: 'gemini',         label: 'Gemini' },
    { value: 'gemini-fast',    label: 'Gemini Flash' },
    { value: 'gemini-large',   label: 'Gemini Large' },
    { value: 'claude',         label: 'Claude' },
    { value: 'claude-large',   label: 'Claude Large' },
    { value: 'qwen-vision',    label: 'Qwen Vision' },
];

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

    // Populate model dropdowns
    const defaultImageModel = (window.AI_HIDDEN_OBJECT_CONFIG || {}).POLLINATIONS_IMAGE_MODEL || 'flux';
    const defaultAnalysisModel = (window.AI_HIDDEN_OBJECT_CONFIG || {}).POLLINATIONS_TEXT_MODEL || 'openai';
    ui.populateModelSelect(imageModelSelect, IMAGE_MODELS, defaultImageModel);
    ui.populateModelSelect(analysisModelSelect, ANALYSIS_MODELS, defaultAnalysisModel);

    // Sync model selections into runtime config
    function applyModelSelections() {
        window.AI_HIDDEN_OBJECT_CONFIG = {
            ...(window.AI_HIDDEN_OBJECT_CONFIG || {}),
            POLLINATIONS_IMAGE_MODEL: imageModelSelect.value,
            POLLINATIONS_TEXT_MODEL: analysisModelSelect.value,
        };
    }
    applyModelSelections();
    imageModelSelect.addEventListener('change', applyModelSelections);
    analysisModelSelect.addEventListener('change', applyModelSelections);

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
            ui.showImage(dataUrl, () => {
                canvas.resizeCanvas();
                canvas.clear();
                refreshReadyState();
            });
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
            const dataUrl = await api.generateImage(prompt);
            game.setImage(dataUrl);
            ui.showImage(dataUrl, () => {
                canvas.resizeCanvas();
                canvas.clear();
                refreshReadyState();
            });
        } catch (error) {
            console.error('Error generating image:', error);
            ui.showError(`Error generating image: ${error.message}`);
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

        ui.showLoadingState('Analyzing image...');
        try {
            const analysisResult = await api.analyzeImage(game.getImageDataUrl(), imagePreview.naturalWidth, imagePreview.naturalHeight);

            if (!analysisResult || !analysisResult.objects || analysisResult.objects.length === 0) {
                ui.showError('AI could not find enough objects. Please try another image.');
                return;
            }

            const scaledObjects = game.processObjects(analysisResult.objects, imagePreview.naturalWidth, imagePreview.naturalHeight);

            if (scaledObjects.length === 0) {
                 ui.showError('AI returned object data in an unexpected format. Please try another image.');
                 return;
            }
            
            game.start(scaledObjects);
            ui.startGameUI(game.getObjects());

            // Recalculate canvas dimensions after UI transition to fullscreen
            canvas.resizeCanvas();

        } catch (error) {
            console.error('Error starting game:', error);
            const errorMessage = error.message.includes('JSON')
                ? 'The AI returned an invalid response. Please try again.'
                : `Error starting game: ${error.message}`;
            ui.showError(errorMessage);
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

    // Handle mouse leaving the canvas
    boundingBoxCanvas.addEventListener('mouseleave', () => {
        // Future hover effects could be cleared here.
    });

    // Handle window resizing
    window.addEventListener('resize', () => {
        if (game.getImageDataUrl()) {
            canvas.resizeCanvas();
            canvas.redraw(game.getObjects());
        }
    });
});