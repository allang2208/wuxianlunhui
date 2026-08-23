/**
 * 世界-123 雪地场景回归：
 * - 保持世界-122的 12288×8192 菱形地图尺寸；
 * - 三张雪地纹理均为 1024² 且边缘连续；
 * - 场景九只加载地块与返回门，不绑定世界-122防守系统。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
    if (condition) {
        pass++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
}

const cfgBytes = fs.readFileSync(path.join(ROOT, 'data/game-config.json'));
const publicCfgBytes = fs.readFileSync(path.join(ROOT, 'public/data/game-config.json'));
const cfg = JSON.parse(cfgBytes);
const scene9 = cfg.scenes?.scene9;

check('data/public 双份场景配置一致', cfgBytes.equals(publicCfgBytes));
check('世界-123尺寸与世界-122一致',
    scene9?.width === 12288 && scene9?.height === 8192
    && scene9.width === cfg.scenes?.scene8?.width
    && scene9.height === cfg.scenes?.scene8?.height);
check('世界-123启用菱形地块', scene9?.diamondFloor?.enabled === true);
check('世界-123启用五姿态高瘦雪松散布',
    scene9?.snowPineScatter?.enabled === true
    && scene9.snowPineScatter.count === 38
    && scene9.snowPineScatter.minDist >= 300);
check('主神空间传送门可进入世界-123',
    cfg.portals?.mainHub?.entries?.some((entry) => entry.targetScene === 'scene9' && entry.label === '世界-123·雪原'));

const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/world/scene-manager.js'), 'utf8');
const floorSrc = fs.readFileSync(path.join(ROOT, 'src/world/dungeon-floor-texture.js'), 'utf8');
const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
const gameSceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf8');
const scene9Body = (sceneSrc.split('_loadScene9(player) {')[1] || '').split('_loadScene7(')[0];

check('世界-123镜头缩放与世界-122一致为70%',
    /ZOOMED_OUT_WORLD_SCENES = new Set\(\['scene8', 'scene9', 'scene10', 'scene11'\]\)/.test(gameSceneSrc)
    && /const sceneBaseZoom = zoomedOutWorld \? 0\.7 : 1/.test(gameSceneSrc));

check('世界-123使用分块连续地面与三张雪纹理',
    /applyDungeonFloorChunked\(w, h, 2048, diamond\)/.test(scene9Body)
    && /floor_snow_fresh_seamless/.test(scene9Body)
    && /floor_snow_packed_seamless/.test(scene9Body)
    && /floor_snow_wind_seamless/.test(scene9Body));
check('地面系统支持多层表面补丁且保留旧沙地接口',
    /sandPatches: profile\.sandPatches \|\| null/.test(floorSrc)
    && /surfacePatches: Array\.isArray\(profile\.surfacePatches\)/.test(floorSrc)
    && /_drawSurfacePatchLayer/.test(floorSrc));
check('世界-123不接入世界-122防守/采矿/生产系统',
    !/DefenseSystem\.setup|EnergyNodeSystem\.setup|HamsterHutSystem\.setup|ProducerBuildingSystem\.setup/.test(scene9Body));
check('世界-123散布五姿态雪松并排除玩家和返回门',
    /_scatterSnowPinesScene9\(player, diamond\)/.test(scene9Body)
    && /const variants = \['01', '02', '03', '04', '05'\]/.test(sceneSrc)
    && /playerExclusion/.test(sceneSrc)
    && /portalExclusion/.test(sceneSrc));
check('世界-123雪草/蕨层缩至荒漠数量的50%且每次入场换布局',
    /textures: \['deco_snow_1', 'deco_snow_2', 'deco_snow_3', 'deco_snow_4', 'deco_snow_5'\]/.test(scene9Body)
    && /seed: \(Math\.random\(\) \* 0x100000000\) >>> 0/.test(scene9Body)
    && /perChunk: 14/.test(scene9Body)
    && /size: 55/.test(scene9Body)
    && /minDist: 120/.test(scene9Body));

const textures = [
    'floor_snow_fresh_seamless.png',
    'floor_snow_packed_seamless.png',
    'floor_snow_wind_seamless.png',
];
for (const file of textures) {
    const assetPath = path.join(ROOT, 'assets/terrain', file);
    check(`${file} 已由 BootScene 加载`,
        bootSrc.includes(`this.load.image('${file.replace('.png', '')}', 'assets/terrain/${file}')`));
    if (!fs.existsSync(assetPath)) {
        check(`${file} 已生成`, false, '文件不存在');
        continue;
    }
    const png = PNG.sync.read(fs.readFileSync(assetPath));
    check(`${file} 为 1024²`, png.width === 1024 && png.height === 1024, `${png.width}×${png.height}`);

    let horizontal = 0;
    let vertical = 0;
    for (let i = 0; i < 1024; i++) {
        const left = (i * 1024) * 4;
        const right = (i * 1024 + 1023) * 4;
        const top = i * 4;
        const bottom = ((1023 * 1024) + i) * 4;
        for (let c = 0; c < 3; c++) {
            horizontal += Math.abs(png.data[left + c] - png.data[right + c]);
            vertical += Math.abs(png.data[top + c] - png.data[bottom + c]);
        }
    }
    horizontal /= 1024 * 3;
    vertical /= 1024 * 3;
    check(`${file} 边缘无明显接缝`,
        horizontal < 20 && vertical < 20,
        `H=${horizontal.toFixed(1)}, V=${vertical.toFixed(1)}`);
}

for (let i = 1; i <= 5; i++) {
    const id = String(i).padStart(2, '0');
    const file = `obstacle_snow_pine_${id}.png`;
    const assetPath = path.join(ROOT, 'assets/terrain', file);
    check(`${file} 已由 BootScene 加载`,
        bootSrc.includes(`this.load.image(\`obstacle_snow_pine_\${id}\`, \`assets/terrain/obstacle_snow_pine_\${id}.png\`)`));
    check(`${file} 透明 PNG 已入库`, fs.existsSync(assetPath));
    if (fs.existsSync(assetPath)) {
        const png = PNG.sync.read(fs.readFileSync(assetPath));
        check(`${file} 保持高瘦轮廓`, png.height / png.width >= 2.0, `${png.width}×${png.height}`);
    }
}

for (let i = 1; i <= 5; i++) {
    const file = `deco_snow_${i}.png`;
    const assetPath = path.join(ROOT, 'assets/terrain', file);
    check(`${file} 已由 BootScene 加载`,
        bootSrc.includes(`this.load.image(\`deco_snow_\${i}\`, \`assets/terrain/deco_snow_\${i}.png\`)`));
    check(`${file} 为缩小50%的 128² 透明装饰`, fs.existsSync(assetPath)
        && PNG.sync.read(fs.readFileSync(assetPath)).width === 128
        && PNG.sync.read(fs.readFileSync(assetPath)).height === 128);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
