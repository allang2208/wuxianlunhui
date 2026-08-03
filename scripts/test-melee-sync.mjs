/**
 * 近战攻击动画同步守卫（scripts/test-melee-sync.mjs）
 *
 * 保护 2026-08-03 攻击跟手调参沉淀的三条耦合：
 * 1. 精灵帧边界（frameWeights/frameDurations）是"阶梯映射"的唯一数据源——
 *    改动画节奏（权重/帧数/帧率）会改变边界，必须重新运行生成脚本重烘焙轨迹；
 * 2. 一段 30 点轨迹与 attack_sword 8 帧的权重分布必须保持对齐（当前权重 [1×7,3] → 0.1 网格）；
 * 3. 近战连段/定格/收势时长已收口到 combat-config.meleeCombo，散落魔法数不得漂移。
 *
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-melee-sync.mjs
 */
import {
    getSpriteFrameBounds,
    getSpriteFrameAtProgress,
    getPlayerAnimDurationMs,
    PLAYER_ANIMS,
} from '../src/config/player-anim.js';
import { COMBAT_CONFIG } from '../src/config/combat-config.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const assert = (cond, msg) => {
    if (cond) {
        console.log(`PASS: ${msg}`);
    } else {
        console.error(`FAIL: ${msg}`);
        failed++;
    }
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------- 1. attack_sword 帧边界 = 0.1 网格（权重 [1,1,1,1,1,1,1,3] 总 10） ----------
const swordBounds = getSpriteFrameBounds('attack_sword');
assert(swordBounds && swordBounds.length === 8, 'attack_sword 帧边界数量 = 8');
if (swordBounds) {
    const expected = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0];
    const ok = swordBounds.every((b, i) => close(b, expected[i], 1e-9));
    assert(ok, `attack_sword 帧边界 = 0.1 网格（当前 ${swordBounds.map(b => b.toFixed(2)).join(',')}）——改权重后必须重跑 prep-sword-attack-hand.py`);
    assert(getSpriteFrameAtProgress('attack_sword', 0.09) === 0, 'p=0.09 → 帧 0');
    assert(getSpriteFrameAtProgress('attack_sword', 0.11) === 1, 'p=0.11 → 帧 1');
    assert(getSpriteFrameAtProgress('attack_sword', 0.69) === 6, 'p=0.69 → 帧 6');
    assert(getSpriteFrameAtProgress('attack_sword', 0.7) === 7, 'p=0.7 → 帧 7（f7 覆盖 [0.7,1]）');
    assert(getSpriteFrameAtProgress('attack_sword', 0.99) === 7, 'p=0.99 → 帧 7');
    assert(getSpriteFrameAtProgress('attack_sword', 1) === 7, 'p=1 → 末帧 7');
}

// ---------- 2. attack_sword_2 等时长 30 帧 → 边界 k/30 ----------
const a2Bounds = getSpriteFrameBounds('attack_sword_2');
assert(a2Bounds && a2Bounds.length === 30, 'attack_sword_2 帧边界数量 = 30');
if (a2Bounds) {
    const ok = a2Bounds.every((b, i) => close(b, (i + 1) / 30, 1e-9));
    assert(ok, 'attack_sword_2 帧边界 = 1/30 等分（与 30 点轨迹一一对应）');
    assert(getSpriteFrameAtProgress('attack_sword_2', 0.5) === 15, 'attack_sword_2 p=0.5 → 帧 15（命中帧区间）');
}

// ---------- 3. 动画时长口径（Tween 与贴图同步的基准） ----------
assert(getPlayerAnimDurationMs('attack_sword') === 667, 'attack_sword 自然时长 667ms（8帧@12fps）');
assert(getPlayerAnimDurationMs('attack_sword_2') === 1500, 'attack_sword_2 自然时长 1500ms（30×50ms）');
assert(Math.round(getPlayerAnimDurationMs('recover')) === 330, 'recover 自然时长 ≈330ms（13×25.4ms）');

// ---------- 4. 30 点轨迹与动画帧数耦合（一段/二段） ----------
const weaponCfg = JSON.parse(readFileSync(path.join(ROOT, 'public/data/weapon-anim-config.json'), 'utf-8'));
assert(weaponCfg.sword.attack.frames.length === 30, 'sword.attack 轨迹 = 30 点');
assert(weaponCfg.sword.attack2.frames.length === 30, 'sword.attack2 轨迹 = 30 点');
assert(typeof weaponCfg.sword.gripOffset === 'number', 'sword.gripOffset 已配置（握把距中心，生成脚本读取）');

// ---------- 5. 连段/定格/收势时长收口到 combat-config ----------
const mc = COMBAT_CONFIG.meleeCombo || {};
assert(mc.stage1HoldMs === 500, 'meleeCombo.stage1HoldMs = 500（一段定格/连段窗口）');
assert(mc.stage2HoldMs === 200, 'meleeCombo.stage2HoldMs = 200（二段定格/连段窗口）');
assert(mc.stage2RecoverMs === 300, 'meleeCombo.stage2RecoverMs = 300（二段收势）');

// ---------- 6. player-anim-config 双份同步 ----------
const dataCfg = readFileSync(path.join(ROOT, 'data/player-anim-config.json'));
const pubCfg = readFileSync(path.join(ROOT, 'public/data/player-anim-config.json'));
assert(dataCfg.equals(pubCfg), 'data/ 与 public/data/ 的 player-anim-config.json 一致');

// ---------- 7. 关键动画键必须存在 ----------
assert(!!PLAYER_ANIMS.attack_sword, 'attack_sword 动画定义存在');
assert(!!PLAYER_ANIMS.attack_sword_2, 'attack_sword_2 动画定义存在');
assert(!!PLAYER_ANIMS.recover, 'recover 动画定义存在');
assert(!!PLAYER_ANIMS.staff_cast, 'staff_cast 动画定义存在');

if (failed > 0) {
    console.error(`\n近战动画同步守卫：${failed} 项失败`);
    process.exit(1);
}
console.log('\n近战动画同步守卫全部通过。');
