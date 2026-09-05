import { Renderer } from './renderer.js';
import { SceneManager } from './scene-manager.js';
import { FogOfWarSystem } from './fog-of-war-system.js';
import { getVisibleSpriteWorldBounds } from './sprite-depth-profile.js';

const candidatesByScene = new WeakMap();

/** 共享建筑拾取：只按看得到的贴图范围与当前渲染深度裁决，不混用地面碰撞范围。 */
export function pickStructureAtWorld(game, x, y) {
    const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
    if (!scene?.getStructurePickVisuals || !game?.entities
        || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const frame = scene.game?.loop?.frame;
    let cache = candidatesByScene.get(scene);
    if (!cache || !Number.isFinite(frame) || cache.frame !== frame
        || cache.entities !== game.entities || cache.size !== game.entities.size
        || cache.sceneId !== SceneManager.currentScene) {
        const candidates = [];
        for (const entity of game.entities.values()) {
            if (entity?._isDefenseStructure) candidates.push(entity);
        }
        cache = { frame, entities: game.entities, size: game.entities.size,
            sceneId: SceneManager.currentScene, candidates };
        candidatesByScene.set(scene, cache);
    }
    let picked = null;
    let bestDepth = -Infinity;
    let bestDistance = Infinity;
    for (const entity of cache.candidates) {
        if (!entity.active || entity._sinking || Number(entity.hp) <= 0
            || FogOfWarSystem.shouldHideEntity(SceneManager.currentScene, entity)) continue;
        for (const visual of scene.getStructurePickVisuals(entity)) {
            // 粗筛后才取缓存的 alpha 包围盒；不逐次读取像素，也不创建像素级命中掩码。
            const broad = visual.getBounds?.();
            if (!broad?.contains?.(x, y)) continue;
            const bounds = getVisibleSpriteWorldBounds(visual);
            if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
            const depth = Number(visual.depth) || 0;
            const distance = Math.hypot(x - (bounds.minX + bounds.maxX) * 0.5,
                y - (bounds.minY + bounds.maxY) * 0.5);
            if (depth > bestDepth || (depth === bestDepth && distance < bestDistance)) {
                picked = entity;
                bestDepth = depth;
                bestDistance = distance;
            }
        }
    }
    // 先确定最前方可见部件，再映射门组根实体，不能用组内未命中的高层部件抢点击。
    return picked?._buildGroupRoot?.active ? picked._buildGroupRoot : picked;
}

export function pickStructureAtScreen(game, x, y) {
    const point = Renderer.screenToWorld(x, y);
    return point ? pickStructureAtWorld(game, point.x, point.y) : null;
}
