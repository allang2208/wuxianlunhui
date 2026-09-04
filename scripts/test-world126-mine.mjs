/** World-126 废弃矿洞模板、实例隔离与环境散布合同回归。 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const bytes = (rel) => fs.readFileSync(path.join(ROOT, rel));
const gameBytes = bytes('data/game-config.json');
const publicGameBytes = bytes('public/data/game-config.json');
const terrainBytes = bytes('data/abandoned-mine-terrain.json');
const publicTerrainBytes = bytes('public/data/abandoned-mine-terrain.json');
const worldBytes = bytes('data/world-system.json');
const publicWorldBytes = bytes('public/data/world-system.json');
const fogBytes = bytes('data/fog-of-war.json');
const publicFogBytes = bytes('public/data/fog-of-war.json');
const gameConfig = JSON.parse(gameBytes);
const terrain = JSON.parse(terrainBytes);
const worldSystem = JSON.parse(worldBytes);
const fog = JSON.parse(fogBytes);
const audio = JSON.parse(read('data/audio-config.json'));
const sceneSource = read('src/world/scene-manager.js');
const environmentSource = read('src/world/world126-environment.js');
const gameSceneSource = read('src/phaser/scenes/GameScene.js');
const obstacleSpawnSource = read('src/world/obstacle-spawn-system.js');

let pass = 0;
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (condition) pass++; else fail++;
}

const scene = gameConfig.scenes?.scene12;
check('game/terrain/world/fog 双份配置一致',
    gameBytes.equals(publicGameBytes)
    && terrainBytes.equals(publicTerrainBytes)
    && worldBytes.equals(publicWorldBytes)
    && fogBytes.equals(publicFogBytes));
check('scene12 使用标准大世界尺寸、菱形和中心原点',
    scene?.width === 12288 && scene?.height === 8192
    && scene.diamondFloor?.enabled === true
    && scene.origin?.x === 6144 && scene.origin?.y === 4096);
check('矿洞是可生成模板，固定 scene12 只作预览且不进入新局初始池',
    worldSystem.templates?.mine?.storyEnabled === true
    && worldSystem.templates.mine.runtimeSceneId === 'scene12'
    && worldSystem.worlds?.scene12?.templatePreviewOnly === true
    && !worldSystem.storyGeneration?.initialInstance?.templateIds?.includes('mine'));
check('加载器使用逻辑 worldId 分槽地面、障碍和持久状态',
    /_loadScene12\(player\)/.test(sceneSource)
    && /_worldIdForLoader\('scene12'\)/.test(sceneSource)
    && /getAbandonedMineFloorProfile\('plane'\)/.test(sceneSource)
    && /getWorldGenerationSeed\(worldId, 'floor_deco'\)/.test(sceneSource)
    && /createWorldRandom\(worldId, 'obstacles'\)/.test(sceneSource)
    && /_setupPersistentWorld\(worldId, player, diamond\)/.test(sceneSource));
check('五款障碍配置、正式图与真 Alpha 完整',
    terrain.obstacles?.assets?.length === 5
    && terrain.obstacles.assets.every((asset) => {
        const assetPath = path.join(ROOT, asset.src);
        if (!fs.existsSync(assetPath)) return false;
        const imageBytes = fs.readFileSync(assetPath);
        const png = PNG.sync.read(imageBytes);
        return [4, 6].includes(imageBytes[25]) && png.width > 0 && png.height > 0;
    }));
check('障碍保持视角并走 footprint 前缘深度与世界散布清除合同',
    /rotation: 0/.test(environmentSource)
    && /flipX: false/.test(environmentSource)
    && /_scatter: true/.test(environmentSource)
    && /obstacleFootprintDepthOf/.test(environmentSource)
    && /getObstacleFootprintRect/.test(environmentSource)
    && /clearOfWallCollision/.test(environmentSource));
check('地牢零障碍合同未被位面复用破坏',
    /spawnForRoom\(\) \{\s*return 0;/.test(obstacleSpawnSource)
    && /spawnForPassages\(\) \{\s*return 0;/.test(obstacleSpawnSource));
check('scene12 接入 BGM、战争迷雾和广角镜头',
    audio.bgm?.scene12 === 'assets/sounds/music/幽洞回声.wav'
    && fog.enabledScenes?.includes('scene12')
    && /ZOOMED_OUT_WORLD_SCENES = new Set\(\['scene8', 'scene9', 'scene10', 'scene11', 'scene12'\]\)/
        .test(gameSceneSource));

const { WallSystem } = await import('../src/world/wall-system.js');
const { scatterWorld126MineEnvironment } = await import('../src/world/world126-environment.js');
const oldState = {
    isoVisuals: WallSystem.isoVisuals,
    walls: WallSystem.walls,
    isoSegments: WallSystem.isoSegments,
    canMoveTo: WallSystem.canMoveTo,
    rebuildIsoCollision: WallSystem.rebuildIsoCollision,
    syncWalls: WallSystem._syncWallsToPhaser,
};
WallSystem.isoVisuals = [];
WallSystem.walls = [];
WallSystem.isoSegments = [];
WallSystem.canMoveTo = () => true;
WallSystem.rebuildIsoCollision = () => {};
WallSystem._syncWallsToPhaser = () => {};
const deterministicRolls = [
    0, 0, 0, 0, 0,
    0.5, 0.5,
    0.45, 0.5,
    0.55, 0.5,
    0.5, 0.45,
    0.5, 0.55,
];
let deterministicRollIndex = 0;
const simulated = scatterWorld126MineEnvironment({
    width: 12288,
    height: 8192,
    mineObstacleScatter: {
        count: 5,
        edgeInset: 80,
        playerExclusion: 0,
        portalExclusion: 0,
        minDist: 0,
        footprintGap: 0,
    },
}, { cx: 6144, cy: 4096, rx: 6144, ry: 3072 }, null, null, {
    random: () => deterministicRolls[deterministicRollIndex++] ?? 0.5,
});
check('环境散布可放满并覆盖五种障碍',
    simulated.placed === 5
    && Object.keys(simulated.byType).length === 5
    && WallSystem.isoVisuals.every((piece) => piece._world126Environment && piece.depthManual));
Object.assign(WallSystem, {
    isoVisuals: oldState.isoVisuals,
    walls: oldState.walls,
    isoSegments: oldState.isoSegments,
    canMoveTo: oldState.canMoveTo,
    rebuildIsoCollision: oldState.rebuildIsoCollision,
    _syncWallsToPhaser: oldState.syncWalls,
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
