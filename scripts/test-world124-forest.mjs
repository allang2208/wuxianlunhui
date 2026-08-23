/**
 * 世界-124林地回归：草地无缝地板、草簇点缀、五姿态林地树与场景入口。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgBytes = fs.readFileSync(path.join(ROOT, 'data/game-config.json'));
const cfg = JSON.parse(cfgBytes);
const publicBytes = fs.readFileSync(path.join(ROOT, 'public/data/game-config.json'));
const scene = cfg.scenes?.scene10;
const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/world/scene-manager.js'), 'utf8');
const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
const wallSrc = fs.readFileSync(path.join(ROOT, 'src/world/wall-system.js'), 'utf8');
const gameSceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf8');
let fail = 0;
function check(name, ok) {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok) fail++;
}

check('data/public 双份场景配置一致', cfgBytes.equals(publicBytes));
check('世界-124与世界-122同尺寸', scene?.width === 12288 && scene?.height === 8192
    && scene.width === cfg.scenes.scene8.width && scene.height === cfg.scenes.scene8.height);
check('世界-124已注册主神空间入口与菱形地块',
    scene?.diamondFloor?.enabled === true
    && cfg.portals?.mainHub?.entries?.some((entry) => entry.targetScene === 'scene10'));
check('世界-124镜头缩放与世界-122一致为70%',
    /ZOOMED_OUT_WORLD_SCENES = new Set\(\['scene8', 'scene9', 'scene10', 'scene11'\]\)/.test(gameSceneSrc)
    && /const sceneBaseZoom = zoomedOutWorld \? 0\.7 : 1/.test(gameSceneSrc));
check('场景十加载草地地板、草簇与林地树散布',
    /_loadScene10\(player\)/.test(sceneSrc)
    && /floor_grass_forest_seamless/.test(sceneSrc)
    && /textures: \['deco_forest_grass_1', 'deco_forest_grass_2', 'deco_forest_grass_3', 'deco_forest_grass_4'\]/.test(sceneSrc)
    && /_scatterForestPinesScene10\(player, diamond\)/.test(sceneSrc));
check('林地树碰撞几何已注册', (wallSrc.match(/forest_pine_0[1-5]/g) || []).length >= 5);

const floor = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'assets/terrain/floor_grass_forest_seamless.png')));
check('草地无缝纹理为1024²', floor.width === 1024 && floor.height === 1024);
check('林地使用四张同系列独立草贴图',
    [1, 2, 3, 4].every((i) => fs.existsSync(path.join(ROOT, 'assets/terrain', `deco_forest_grass_${i}.png`)))
    && /for \(let i = 1; i <= 4; i\+\+\)/.test(bootSrc)
    && bootSrc.includes('deco_forest_grass_${i}')
    && !bootSrc.includes('deco_grass_1')
    && !bootSrc.includes('deco_grass_2'));
for (let i = 1; i <= 5; i++) {
    const id = String(i).padStart(2, '0');
    const file = `obstacle_forest_pine_${id}.png`;
    const assetPath = path.join(ROOT, 'assets/terrain', file);
    check(`${file} 已入库且由BootScene加载`,
        fs.existsSync(assetPath)
        && bootSrc.includes(`this.load.image(\`obstacle_forest_pine_\${id}\`, \`assets/terrain/obstacle_forest_pine_\${id}.png\`)`));
    if (fs.existsSync(assetPath)) {
        const png = PNG.sync.read(fs.readFileSync(assetPath));
        check(`${file} 保持高瘦树形`, png.height / png.width >= 1.8);
    }
}

console.log(`\n结果: ${8 + 2 * 5 - fail} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
