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
    const imageContainer = document.getElementById('imageContainer');
    const imagePreview = document.getElementById('imagePreview');
    const boundingBoxCanvas = document.getElementById('boundingBoxCanvas');
    const startGameButton = document.getElementById('startGameButton');
    const giveUpButton = document.getElementById('giveUpButton');
    const objectListContainer = document.getElementById('objectListContainer');
    const gameStatusContainer = document.getElementById('gameStatus');

    // --- Initialization ---
    canvas.init(boundingBoxCanvas, imagePreview);
    ui.init({
        fileInput,
        generateImageButton,
        startGameButton,
        giveUpButton,
        imageContainer,
        imagePreview,
        objectListContainer,
        gameStatusContainer
    });

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
                ui.enableStartButton();
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
                ui.showReadyToStartState();
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

    // Handle starting or restarting the game
    startGameButton.addEventListener('click', async () => {
        if (!game.getImageDataUrl()) {
            alert('Please select or generate an image first!');
            return;
        }
        if (game.isGameActive()) {
            game.reset();
            ui.reset();
            canvas.clear();
            ui.showReadyToStartState();
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