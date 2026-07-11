import { Game } from '../../game.js';
/**
 * Game Layer Panel
 * Creates the game canvas container DOM structure.
 * Corresponds to: <!-- ===== 游戏层 ===== --> in index.html
 */

export function createGameLayer() {
    // Root container: <div id="gameLayer" style="display: none;">
    const gameLayer = document.createElement('div');
    gameLayer.id = 'gameLayer';
    gameLayer.style.display = 'none';

    // Canvas: <canvas id="gameCanvas"></canvas>
    const gameCanvas = document.createElement('canvas');
    gameCanvas.id = 'gameCanvas';

    // Nest
    gameLayer.appendChild(gameCanvas);

    return gameLayer;
}
