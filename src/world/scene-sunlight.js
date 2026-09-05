import { GAME_CONFIG } from '../config/game-config.js';

/** 位面固有日照资格，与当前白天/夜晚、天气和屏幕亮度无关。 */
export function hasNaturalSunlight(sceneId = null) {
    const scene = GAME_CONFIG.scenes?.[sceneId || globalThis.SceneManager?.currentScene];
    return !!scene && (scene.hasSunlight ?? (scene.type !== 'dungeon'));
}
