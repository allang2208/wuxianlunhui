/**
 * 世界-125 地牢遗迹回归：
 * - 与世界-122/123同尺寸、同菱形边界；
 * - 复用僵尸地牢高级 blackbrick_7/8 地面；
 * - 随机散布石柱、烛台与摆墙预制障碍组合；
 * - 主神空间、世界切换面板和建筑传送门均可进入。
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const cfgBytes = fs.readFileSync(path.join(ROOT, 'data/game-config.json'));
const publicCfgBytes = fs.readFileSync(path.join(ROOT, 'public/data/game-config.json'));
const cfg = JSON.parse(cfgBytes);
const buildings = JSON.parse(read('data/producer-buildings.json'));
const audio = JSON.parse(read('data/audio-config.json'));
const prefabs = JSON.parse(read('public/data/wall-prefabs.json'));
const worldSystem = JSON.parse(read('data/world-system.json'));
const scene = cfg.scenes?.scene11;
const sceneSrc = read('src/world/scene-manager.js');
const envSrc = read('src/world/world125-environment.js');
const switchSrc = read('src/ui/world-switch-panel.js');
const bootSrc = read('src/phaser/scenes/BootScene.js');
const gameSceneSrc = read('src/phaser/scenes/GameScene.js');

let pass = 0;
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (condition) pass++; else fail++;
}

check('data/public 双份场景配置一致', cfgBytes.equals(publicCfgBytes));
check('世界-125与世界-122/123同尺寸',
    scene?.width === 12288 && scene?.height === 8192
    && scene.width === cfg.scenes?.scene8?.width
    && scene.height === cfg.scenes?.scene9?.height);
check('世界-125启用同规格菱形地块',
    scene?.diamondFloor?.enabled === true
    && scene.origin?.x === 6144 && scene.origin?.y === 4096);
check('场景十一使用遗迹大石板地砖池并使用2048分块',
    /async _loadScene11\(player\)/.test(sceneSrc)
    && /tiles: \['ruinslab_1', 'ruinslab_2'\]/.test(sceneSrc)
    && /applyDungeonFloorChunked\(w, h, 2048, diamond\)/.test(sceneSrc)
    && bootSrc.includes("this.load.image('ruinslab_1'")
    && bootSrc.includes("this.load.image('ruinslab_2'"));
check('世界-125接入 scene8~scene11 共用建筑、采矿、生产与入侵运行时',
    /this\._setupPersistentWorld\('scene11', player, diamond\)/.test(sceneSrc)
    && /_setupPersistentWorld\(sceneId, player, diamond\)/.test(sceneSrc)
    && /DefenseSystem\.setup\(player, \{ managedExternally: true, worldId: sceneId \}\)/.test(sceneSrc)
    && /window\.WorldInvasionSystem\?\.onWorldLoaded/.test(sceneSrc));
check('环境散布配置包含石柱和预制组合（装饰烛台已移除，2026-08-22 守夜烛台玩法化）',
    scene?.dungeonObstacleScatter?.enabled === true
    && scene.dungeonObstacleScatter.pillarCount > 0
    && scene.dungeonObstacleScatter.candleCount === 0
    && scene.dungeonObstacleScatter.prefabCount > 0
    && /_placeSingles\([\s\S]*?'pillar'/.test(envSrc)
    && /const PREFAB_POOL_START = '火把墙'/.test(envSrc));
check('障碍物沿用摆墙 footprint、碰撞和图层数据',
    /WallSystem\.getObstacleFootprintRect/.test(envSrc)
    && /WallSystem\.canMoveTo/.test(envSrc)
    && /WallSystem\.rebuildIsoCollision/.test(envSrc)
    && /depthManual: true/.test(envSrc));
check('摆墙预制库含可供世界-125抽取的纯障碍组合',
    Object.keys(prefabs).includes('火把墙')
    && Object.keys(prefabs).includes('烛台+铁链')
    && Object.keys(prefabs).includes('木桶组合'));
check('世界切换面板已添加世界-125按钮',
    /\{ id: 'scene11', icon: '🕯️'/.test(switchSrc));
check('主神空间传送门已添加世界-125入口',
    cfg.portals?.mainHub?.entries?.some((entry) =>
        entry.targetScene === 'scene11' && entry.label === '世界-125·地牢遗迹'));
check('建筑传送门已添加世界-125按钮',
    buildings.portal?.destinations?.some((entry) =>
        entry.sceneId === 'scene11' && entry.label === '世界-125·地牢遗迹'));
check('世界-125构造资格由僵尸初级地牢完成状态解锁',
    worldSystem.worlds?.scene11?.constructionEnabled === true
    && worldSystem.worlds.scene11.requirements?.completedDungeons?.includes('zombieBeginner'));
check('世界-125使用幽洞回声环境音乐',
    audio.bgm?.scene11 === 'assets/sounds/music/幽洞回声.wav');
check('世界-125镜头缩放与世界-122一致为70%',
    /SceneManager\.currentScene === 'scene8' \|\| SceneManager\.currentScene === 'scene11'/.test(gameSceneSrc)
    && /const sceneBaseZoom = zoomedOutWorld \? 0\.7 : 1/.test(gameSceneSrc));

// 运行散布函数本体：用真实几何和真实预制库，只隔离 Phaser 同步接口。
const { setWallPrefabLibrary } = await import('../src/world/wall-prefabs.js');
const { WallSystem } = await import('../src/world/wall-system.js');
const { scatterWorld125Environment } = await import('../src/world/world125-environment.js');
setWallPrefabLibrary(prefabs);
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
const simulated = scatterWorld125Environment({
    width: 12288,
    height: 8192,
    dungeonObstacleScatter: {
        enabled: true,
        pillarCount: 3,
        candleCount: 4,
        prefabCount: 2,
        minDist: 0,
        edgeInset: 80,
        playerExclusion: 0,
        portalExclusion: 0,
        scaleJitter: 0,
    },
}, { cx: 6144, cy: 4096, rx: 6144, ry: 3072 });
check('环境散布函数实际生成石柱和两组预制（烛台不再由散布生成）',
    simulated.pillars === 3
    && simulated.candles === 0
    && simulated.prefabs === 2
    && WallSystem.isoVisuals.some((piece) => piece.tex === 'obstacle_pillar')
    && !WallSystem.isoVisuals.some((piece) => piece.tex === 'obstacle_candle')
    && WallSystem.isoVisuals.some((piece) => piece._prefabKey));
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
