import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readText = (path) => readFile(resolve(root, path), 'utf8');
const readJson = async (path) => JSON.parse(await readText(path));

const [sourceConfig, publicConfig] = await Promise.all([
    readJson('data/fog-of-war.json'),
    readJson('public/data/fog-of-war.json'),
]);

assert.deepEqual(publicConfig, sourceConfig, 'data/ 与 public/data/ 的迷雾配置不一致');
assert.equal(sourceConfig.version, 1, '不支持的迷雾配置版本');
assert.ok(Array.isArray(sourceConfig.enabledScenes) && sourceConfig.enabledScenes.length > 0,
    'enabledScenes 必须是非空数组');
assert.equal(new Set(sourceConfig.enabledScenes).size, sourceConfig.enabledScenes.length,
    'enabledScenes 中存在重复场景');
assert.ok(Number(sourceConfig.cellSize) >= 32, 'cellSize 过小');
assert.ok(Number(sourceConfig.updateIntervalMs) >= 16, 'updateIntervalMs 过小');
assert.ok(Number(sourceConfig.visibilitySyncIntervalMs) >= 16, 'visibilitySyncIntervalMs 过小');
assert.equal(typeof sourceConfig.occlusion?.enabled, 'boolean', 'occlusion.enabled 必须是布尔值');
assert.equal(sourceConfig.occlusion?.gateDoorsBlockVision, false,
    '城门门扇必须保持不阻挡视野');
assert.ok(Number(sourceConfig.occlusion?.rebuildIntervalMs) >= 100, 'occlusion.rebuildIntervalMs 过小');
assert.ok(Number(sourceConfig.occlusion?.cellPaddingRatio) >= 0
    && Number(sourceConfig.occlusion?.cellPaddingRatio) <= 1, 'occlusion.cellPaddingRatio 必须位于 0～1');
for (const key of ['defaultWallHeight', 'defaultStructureHeight', 'observerEyeHeightRatio', 'observerEyeHeightFallback']) {
    assert.ok(Number(sourceConfig.occlusion?.[key]) > 0, `occlusion.${key} 必须是正数`);
}
assert.ok(Number(sourceConfig.occlusion?.heightClearance) >= 0,
    'occlusion.heightClearance 不能为负数');

for (const key of ['unexploredAlpha', 'exploredAlpha']) {
    const value = Number(sourceConfig.overlay?.[key]);
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${key} 必须位于 0～1`);
}
assert.ok(sourceConfig.overlay.unexploredAlpha >= sourceConfig.overlay.exploredAlpha,
    '未探索区域不能比已探索区域更透明');

for (const key of ['player', 'companion', 'militaryUnit', 'scout', 'cavalry', 'portal', 'troopProducer', 'defenseTower']) {
    assert.ok(Number(sourceConfig.vision?.[key]) > 0, `缺少有效视野半径：${key}`);
}

assert.equal(Number(sourceConfig.vision?.wallWalkMultiplier), 2,
    'wallWalkMultiplier must remain 2');
assert.ok(Number(sourceConfig.vision?.stairsMultiplier) > 0,
    'stairsMultiplier must be positive');

const contractChecks = [
    ['src/world/fog-of-war-system.js', 'VisionSourceRegistry.getSources'],
    ['src/world/fog-of-war-system.js', 'revealWithOcclusion'],
    ['src/world/fog-occlusion-grid.js', 'WallSystem?.isoSegments'],
    ['src/world/fog-occlusion-grid.js', 'sourceOcclusionContext'],
    ['src/world/fog-occlusion-grid.js', 'rayBlockedFromOrigin'],
    ['src/phaser/scenes/GameScene.js', 'new FogMaskRenderer'],
    ['src/phaser/scenes/GameScene.js', 'new FogMinimapLayer'],
    ['src/phaser/scenes/GameScene.js', 'new FogDebugOverlay'],
    ['src/phaser/scenes/GameScene.js', 'new FogVisibilityController'],
    ['src/effects/fog-visual-adapter.js', 'syncAll(sceneId, fogSystem)'],
    ['src/ui/panels/dev-tools.js', "tabFog.textContent = '迷雾'"],
];

for (const [path, marker] of contractChecks) {
    const source = await readText(path);
    assert.ok(source.includes(marker), `${path} 缺少迷雾契约：${marker}`);
}

console.log('[fog-check] 配置副本、数值范围和核心接线均有效');
