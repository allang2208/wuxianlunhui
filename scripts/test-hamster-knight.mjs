/**
 * 仓鼠骑士契约测试：
 * - 配置：六维/HP/普攻 31 帧 1.5 秒第 16 帧/冲刺 30 帧第 15~22 帧窗口；
 * - 素材：重采样后无空白帧，且每个动作锚定 running 的稳定脚底线；
 * - 接线：世界-122 通用产兵、全局升级、BootScene、GameScene 和后台结算。
 *
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-hamster-knight.mjs
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: cfg } = await import('../data/hamster-knight-config.json');
const { Companion } = await import('../src/entities/companion.js');

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
    if (condition) {
        pass++;
        console.log(`   ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        fail++;
        console.error(`   ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
}

function alphaFrames(name) {
    const file = path.join(ROOT, 'assets/companions/hamster_knight', name);
    const png = PNG.sync.read(fs.readFileSync(file));
    const frames = [];
    for (let index = 0; index < 32; index++) {
        const ox = (index % 8) * 512;
        const oy = Math.floor(index / 8) * 512;
        let minY = 512;
        let maxY = -1;
        for (let y = 0; y < 512; y++) {
            for (let x = 0; x < 512; x++) {
                if (png.data[((oy + y) * png.width + ox + x) * 4 + 3] <= 10) continue;
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
        if (maxY >= 0) frames.push({ index, height: maxY - minY + 1, bottom: maxY + 1 });
    }
    return frames;
}

const knight = new Companion(cfg);
check('生命值 = 600', knight.data.maxHp === 600 && knight.data.hp === 600, `maxHp=${knight.data.maxHp}`);
check('六维初始值符合需求',
    knight.data.str === 30 && knight.data.dex === 15 && knight.data.int === 5
    && knight.data.con === 20 && knight.data.wis === 3 && knight.data.luck === 5);
check('六维走怪物公式并派生数值',
    cfg.statFormula === 'enemy' && knight.data.atk === 23 && knight.data.def === 39
    && knight.data.matk === 4 && knight.data.mdef === 5 && knight.data.crit === 7
    && knight.data.critRes === 20,
`atk=${knight.data.atk} def=${knight.data.def} matk=${knight.data.matk} mdef=${knight.data.mdef}`);
check('移动速度 = 210px/s',
    cfg.ai.walkSpeed === 210 && cfg.ai.runSpeed === 210);
check('显示尺寸放大 30%，脚底与 HUD 偏移同步',
    cfg.displaySize === 390 && cfg.spriteOffsetY === -74);
check('普攻 = 100 物理伤害 / 2 秒 / 第 16 帧',
    cfg.ai.attackDamage === 100 && cfg.ai.attackInterval === 2000
    && cfg.ai.attackDamageFrame === 16 && Math.abs(cfg.ai.attackAnimFps - 31 / 1.5) < 1e-6);
check('攻击动画 = 31 帧单次播放 / 1.5 秒',
    cfg.animations.attack.frameCount === 31 && cfg.animations.attack.frames[1] === 30
    && cfg.animations.attack.repeat === 0 && Math.abs(cfg.animations.attack.frameRate - 31 / 1.5) < 1e-6);
check('冲刺配置复用铠甲骑士参数，冷却 15 秒',
    cfg.ai.charge.cooldown === 15000 && cfg.ai.charge.maxSpeed === 700
    && cfg.ai.charge.accelDuration === 1500 && cfg.ai.charge.maxDuration === 4500
    && cfg.ai.charge.maxDistance === 1800 && cfg.ai.charge.triggerRange === 550
    && cfg.ai.charge.hitRange === 60 && cfg.ai.charge.damageMul === 2
    && cfg.ai.charge.knockback === 200 && cfg.ai.charge.stunMs === 2500);
check('冲刺伤害窗口 = 第 15~22 帧',
    cfg.ai.charge.frames === 30 && cfg.ai.charge.hitStartFrame === 15
    && cfg.ai.charge.hitEndFrame === 22 && cfg.ai.charge.frameRate === 12);

const expectedFrames = {
    'idle.png': 11, 'running.png': 12, 'attacking.png': 31, 'dying.png': 14, 'charging.png': 30,
};
for (const [file, expected] of Object.entries(expectedFrames)) {
    const frames = alphaFrames(file);
    check(`${file} 有 ${expected} 个有效 Alpha 帧`,
        frames.length === expected && frames.every((f, i) => f.index === i),
        `frames=${frames.map((f) => f.index).join(',')}`);
}
const running = alphaFrames('running.png');
const stableRunning = running.slice(2).map((f) => f.bottom);
const stableBottom = stableRunning.sort((a, b) => a - b)[Math.floor(stableRunning.length / 2)];
const idle = alphaFrames('idle.png');
const attack = alphaFrames('attacking.png');
check('静态/攻击脚底与 running 基线统一',
    Math.abs(idle[0].bottom - stableBottom) <= 4
    && attack.every((f) => Math.abs(f.bottom - idle[0].bottom) <= 1),
    `running≈${stableBottom}, idle=${idle[0].bottom}, attack=${attack[0].bottom}`);

const aiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-knight-ai.js'), 'utf-8');
check('AI 仅攻击 enemy 且跳过矿点', /_faction === 'enemy'/.test(aiSrc) && /!entity\._isEnergyNode/.test(aiSrc));
check('普攻延迟按第 16 帧计算且走物理近战伤害',
    /_attackHitDelay = Math\.max\(0, \(attackFrame - 1\) \/ attackFps \* 1000\)/.test(aiSrc)
    && /target\.takeDamage\(this\._attackDamage, m, 'physical', true\)/.test(aiSrc));
check('冲刺只在第 15~22 帧窗口结算一次双倍伤害',
    /hitStartFrame/.test(aiSrc) && /hitEndFrame/.test(aiSrc)
    && /this\._chargeDamaged = true/.test(aiSrc)
    && /this\._attackDamage \* \(cfg\.damageMul \?\? 2\)/.test(aiSrc));
check('冲刺经 WallSystem.resolve 且恢复实体碰撞',
    /WallSystem\.resolve/.test(aiSrc) && /m\.noCollision = this\._prevNoCollision/.test(aiSrc));

const entitySrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-knight.js'), 'utf-8');
check('实体接入友军渲染/仇恨/死亡链', /_isHamsterKnight = true/.test(entitySrc)
    && /_skipNeutralSprite = true/.test(entitySrc) && /_enemyTargetable = true/.test(entitySrc)
    && /DYING_DURATION_MS = 1167/.test(entitySrc) && /footOffsetY = 74/.test(entitySrc)
    && /hudOffsetY: 180/.test(entitySrc));

const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf-8');
const upgradesSrc = fs.readFileSync(path.join(ROOT, 'src/world/unit-upgrade-store.js'), 'utf-8');
const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf-8');
const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf-8');
const simSrc = fs.readFileSync(path.join(ROOT, 'src/world/world122-sim.js'), 'utf-8');
const producerCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf-8'));
check('通用产兵建筑注册骑士', /knight: knightCfg/.test(producerSrc) && /knight: HamsterKnight/.test(producerSrc));
check('全局兵种升级表识别骑士', /knight: knightCfg/.test(upgradesSrc) && /_isHamsterKnight\) return 'knight'/.test(upgradesSrc));
check('骑兵学校专属生产仓鼠骑士，草屋不再生产骑士',
    producerCfg.cavalry_school?.defaultUnitType === 'knight'
    && (producerCfg.cavalry_school.unitTypes || []).some((u) => u.key === 'knight')
    && !(producerCfg.thatch_hut?.unitTypes || []).some((u) => u.key === 'knight'));
check('BootScene 加载骑士五套动画', /hamsterKnightConfig/.test(bootSrc));
check('GameScene 有骑士攻击、冲刺、移动朝向与烟尘渲染分支',
    /member\._isHamsterKnight/.test(sceneSrc)
    && /knightAttackPlaying/.test(sceneSrc)
    && /knightChargePlaying/.test(sceneSrc));
check('后台世界-122 DPS 结算注册骑士', /knight: knightCfg/.test(simSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
