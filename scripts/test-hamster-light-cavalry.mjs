/**
 * 仓鼠轻骑契约测试。
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-hamster-light-cavalry.mjs
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: cfg } = await import('../data/hamster-light-cavalry-config.json');
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

function validAlphaFrames(file) {
    const png = PNG.sync.read(fs.readFileSync(path.join(
        ROOT, 'assets/companions/hamster_light_cavalry', file
    )));
    const frames = [];
    const capacity = (png.width / 512) * (png.height / 512);
    for (let index = 0; index < capacity; index++) {
        const ox = (index % 8) * 512;
        const oy = Math.floor(index / 8) * 512;
        let found = false;
        for (let y = 0; y < 512 && !found; y++) {
            for (let x = 0; x < 512; x++) {
                if (png.data[((oy + y) * png.width + ox + x) * 4 + 3] > 10) {
                    found = true;
                    break;
                }
            }
        }
        if (found) frames.push(index);
    }
    return { width: png.width, height: png.height, frames };
}

const unit = new Companion(cfg);
check('生命值 = 250', unit.data.maxHp === 250 && unit.data.hp === 250);
check('六维符合需求',
    unit.data.str === 20 && unit.data.dex === 15 && unit.data.int === 3
    && unit.data.con === 20 && unit.data.wis === 3 && unit.data.luck === 5);
check('六维使用怪物公式',
    cfg.statFormula === 'enemy' && unit.data.atk === 18 && unit.data.def === 36
    && unit.data.matk === 3 && unit.data.mdef === 4 && unit.data.crit === 7
    && unit.data.critRes === 20);
check('近战参数 = 230移速 / 60物伤 / 2秒 / 插帧后第17帧',
    cfg.ai.walkSpeed === 230 && cfg.ai.runSpeed === 230
    && cfg.ai.attackDamage === 60 && cfg.ai.attackInterval === 2000
    && cfg.ai.attackDamageFrame === 17 && cfg.ai.attackAnimFps === 24);

for (const [file, expected] of Object.entries({
    'idle.png': { count: 16, height: 1024 },
    'running.png': { count: 22, height: 1536 },
    'attacking.png': { count: 23, height: 1536 },
    'dying.png': { count: 21, height: 1536 },
})) {
    const sheet = validAlphaFrames(file);
    check(`${file} 为8列透明插帧表且有效帧=${expected.count}`,
        sheet.width === 4096 && sheet.height === expected.height
        && sheet.frames.length === expected.count
        && sheet.frames.every((frame, index) => frame === index),
    `frames=${sheet.frames.join(',')}`);
}

const aiSrc = fs.readFileSync(path.join(ROOT, 'src/ai/hamster-light-cavalry-ai.js'), 'utf8');
const entitySrc = fs.readFileSync(path.join(ROOT, 'src/entities/hamster-light-cavalry.js'), 'utf8');
const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');
const upgradeSrc = fs.readFileSync(path.join(ROOT, 'src/world/unit-upgrade-store.js'), 'utf8');
const defenseSrc = fs.readFileSync(path.join(ROOT, 'src/ai/defense-target-priority.js'), 'utf8');
const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf8');
const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf8');
const simSrc = fs.readFileSync(path.join(ROOT, 'src/world/world122-sim.js'), 'utf8');
const producerCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));

check('AI复用最近敌人近战状态机（含矿点过滤）',
    /extends HamsterGuardAI/.test(aiSrc));
check('实体接入友军、仇恨、渲染与死亡链',
    /_isHamsterLightCavalry = true/.test(entitySrc)
    && /_enemyTargetable = true/.test(entitySrc)
    && /animId = 'hamster_light_cavalry'/.test(entitySrc));
check('骑兵学校 = 轻骑60秒、骑士90秒',
    producerCfg.cavalry_school?.unitTypes?.some(
        (entry) => entry.key === 'light_cavalry' && entry.spawnIntervalMs === 60000
    )
    && producerCfg.cavalry_school?.unitTypes?.some(
        (entry) => entry.key === 'knight' && entry.spawnIntervalMs === 90000
    ));
check('生产、升级、仇恨和后台结算均登记轻骑',
    /light_cavalry: lightCavalryCfg/.test(producerSrc)
    && /light_cavalry: HamsterLightCavalry/.test(producerSrc)
    && /_isHamsterLightCavalry/.test(upgradeSrc)
    && /_isHamsterLightCavalry/.test(defenseSrc)
    && /light_cavalry: lightCavalryCfg/.test(simSrc));
check('BootScene与GameScene接入四套动画',
    /hamsterLightCavalryConfig/.test(bootSrc)
    && /member\._isHamsterLightCavalry/.test(sceneSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
