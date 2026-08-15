/**
 * 近战攻击动画同步守卫（scripts/test-melee-sync.mjs）
 *
 * 保护攻击跟手调参沉淀的耦合（2026-08-13 三段连段化后口径）：
 * 1. 精灵帧边界（frameDurations）是"阶梯映射"的唯一数据源——改动画节奏（帧数/逐帧时长）
 *    会改变边界，武器轨迹必须同步重采样（12/12/16 帧 ↔ 轨迹 12/12/16 点一一对应）；
 * 2. 三段连段：一段过顶下劈 12 帧 / 二段肩高快劈 12 帧 / 三段弓步突刺 16 帧（终结段），
 *    sheet 格规格 512×512（dash_recover 同规格先例；格规格决策见 CHANGELOG 2026-08-13）；
 * 3. 近战连段/定格/收势时长收口到 combat-config.meleeCombo（stageN 梯度），散落魔法数不得漂移。
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

// ---------- 1. 三段 sheet 帧边界 = 等分网格（frameDurations 全 50ms） ----------
const STAGES = [
    { key: 'attack_sword', frames: 12, cols: 4, rows: 3, w: 2048, h: 1536, ms: 600 },
    { key: 'attack_sword_2', frames: 12, cols: 4, rows: 3, w: 2048, h: 1536, ms: 600 },
    { key: 'attack_sword_3', frames: 16, cols: 4, rows: 4, w: 2048, h: 2048, ms: 800 },
];
for (const { key, frames, ms } of STAGES) {
    const bounds = getSpriteFrameBounds(key);
    assert(bounds && bounds.length === frames, `${key} 帧边界数量 = ${frames}`);
    if (bounds) {
        const ok = bounds.every((b, i) => close(b, (i + 1) / frames, 1e-9));
        assert(ok, `${key} 帧边界 = 1/${frames} 等分（与 ${frames} 点轨迹一一对应）`);
        assert(getSpriteFrameAtProgress(key, 0.99) === frames - 1, `${key} p=0.99 → 末帧`);
        assert(getSpriteFrameAtProgress(key, 1) === frames - 1, `${key} p=1 → 末帧`);
    }
    assert(getPlayerAnimDurationMs(key) === ms, `${key} 自然时长 ${ms}ms（${frames}×50ms）`);
}
// hitCheck 帧区间锚点：三段判定帧 10/16 → 帧索引 9（p∈[9/16,10/16)）
assert(getSpriteFrameAtProgress('attack_sword_3', 0.6) === 9, 'attack_sword_3 p=0.6 → 帧 9（hitCheck.frame=10 的 0 基索引）');
assert(Math.round(getPlayerAnimDurationMs('recover')) === 330, 'recover 自然时长 ≈330ms（13×25.4ms，未动）');

// ---------- 2. sheet 实物与配置一致（PNG IHDR 尺寸 vs frameWidth/Height × cols/rows） ----------
for (const { key, frames, cols, rows, w, h } of STAGES) {
    const def = PLAYER_ANIMS[key];
    assert(!!def, `${key} 动画定义存在`);
    const png = readFileSync(path.join(ROOT, def.src));
    const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20); // IHDR 宽高（固定偏移）
    assert(pw === w && ph === h, `${key} sheet 实物 ${pw}×${ph} = 预期 ${w}×${h}`);
    assert(def.frameWidth * cols === pw && def.frameHeight * rows === ph,
        `${key} 格规格 ${def.frameWidth}×${def.frameHeight} × ${cols}×${rows} 与实物一致`);
    assert(def.frameCount === frames && def.repeat === 0 && !def.frameWeights,
        `${key} frameCount=${frames}、repeat=0、frameWeights 已退役（frameDurations 口径）`);
    assert(def.displayScale === 1.0956, `${key} displayScale=1.0956（屏显身高追平 idle：432/512 × 1.0956 ≈ 477/516）`);
    assert(def.displayScale >= 1.05 && def.displayScale <= 1.15, `${key} displayScale 在合理区间 [1.05,1.15]`);
}
// 旧手绘素材（512×516 格，比率与 idle 一致）不得加缩放
assert(!PLAYER_ANIMS.recover.displayScale && !PLAYER_ANIMS.walk.displayScale,
    'recover/walk 无 displayScale（手绘 512×516 素材比率已与 idle 一致）');

// ---------- 3. 武器轨迹与动画帧数耦合（三段） ----------
const weaponCfg = JSON.parse(readFileSync(path.join(ROOT, 'public/data/weapon-anim-config.json'), 'utf-8'));
assert(weaponCfg.sword.attack.frames.length === 12, 'sword.attack 轨迹 = 12 点（与 attack_sword 12 帧对应）');
assert(weaponCfg.sword.attack2.frames.length === 12, 'sword.attack2 轨迹 = 12 点（与 attack_sword_2 12 帧对应）');
assert(weaponCfg.sword.attack3.frames.length === 16, 'sword.attack3 轨迹 = 16 点（与 attack_sword_3 16 帧对应）');
assert(typeof weaponCfg.sword.gripOffset === 'number', 'sword.gripOffset 已配置（握把距中心，生成脚本读取）');
assert(weaponCfg.sword.dashHand && weaponCfg.sword.dashHand.type === 'gripArc', 'sword.dashHand gripArc 模式已配置（剑柄锚手）');
assert(weaponCfg.sword.dashHand && weaponCfg.sword.dashHand.fromRotation === -90
    && weaponCfg.sword.dashHand.toRotation === 90,
    '冲刺攻击剑身 -90°→+90° 扫击（后→前 180° 扇形）');
assert(weaponCfg.sword.dashLerp && weaponCfg.sword.dashLerp.from.rotation === -90
    && weaponCfg.sword.dashLerp.to.rotation === 90,
    'dashLerp 回退块同步为 -90°→+90° 扫击');
assert(weaponCfg.sword.aura && weaponCfg.sword.aura.enabled === false,
    'sword.aura 已停用（旧剑气，代码保留可回滚）');
assert(weaponCfg.sword.arc && weaponCfg.sword.arc.enabled === false,
    'sword.arc 已停用（用户暂停平滑弧形刀光，代码保留可回滚）');

// ---------- 4. hitCheck 帧号在帧数范围内（帧号 1 基，阈值换算 (frame-1)/(n-1)） ----------
{
    const hc1 = weaponCfg.sword.attack.hitCheck;
    const hc2 = weaponCfg.sword.attack2.hitCheck;
    const hc3 = weaponCfg.sword.attack3.hitCheck;
    assert(hc1.frame >= 1 && hc1.frame <= 12, `attack hitCheck.frame=${hc1.frame} ∈ [1,12]（下劈到底附近）`);
    assert(hc2.frame >= 1 && hc2.frame <= 12, `attack2 hitCheck.frame=${hc2.frame} ∈ [1,12]`);
    assert(hc3.frame >= 1 && hc3.frame <= 16, `attack3 hitCheck.frame=${hc3.frame} ∈ [1,16]（伸展到位帧）`);
    assert(hc3.shape === 'rect' && hc3.damageMul === 2.0,
        'attack3 终结段：rect 长矩形判定 + damageMul 2.0（梯度 1.0/1.5/2.0）');
    // 三段轨迹闭环：attack3 末帧 = attack 首帧（连段回一段姿态相接）
    const a0 = weaponCfg.sword.attack.frames[0];
    const a3end = weaponCfg.sword.attack3.frames[15];
    assert(close(a3end.offsetX, a0.offsetX, 0.01) && close(a3end.offsetY, a0.offsetY, 0.01)
        && close(a3end.rotation, a0.rotation, 0.01),
        'attack3 末帧 = attack 首帧（连段闭环回一段）');
}

// ---------- 5. 连段/定格/收势时长收口到 combat-config（stageN 梯度） ----------
const mc = COMBAT_CONFIG.meleeCombo || {};
assert(mc.stage1HoldMs === 500, 'meleeCombo.stage1HoldMs = 500（一段定格/连段窗口）');
assert(mc.stage2HoldMs === 200, 'meleeCombo.stage2HoldMs = 200（二段定格/连段窗口）');
assert(mc.stage2RecoverMs === 300, 'meleeCombo.stage2RecoverMs = 300（二段收势）');
assert(mc.stage3HoldMs === 300, 'meleeCombo.stage3HoldMs = 300（三段终结后重开窗口，回一段）');
assert(mc.stage3RecoverMs === 400, 'meleeCombo.stage3RecoverMs = 400（三段终结收势）');

// ---------- 6. player-anim-config 双份同步 ----------
const dataCfg = readFileSync(path.join(ROOT, 'data/player-anim-config.json'));
const pubCfg = readFileSync(path.join(ROOT, 'public/data/player-anim-config.json'));
assert(dataCfg.equals(pubCfg), 'data/ 与 public/data/ 的 player-anim-config.json 一致');

// ---------- 7. 关键动画键必须存在 ----------
assert(!!PLAYER_ANIMS.attack_sword, 'attack_sword 动画定义存在');
assert(!!PLAYER_ANIMS.attack_sword_2, 'attack_sword_2 动画定义存在');
assert(!!PLAYER_ANIMS.attack_sword_3, 'attack_sword_3 动画定义存在');
assert(!!PLAYER_ANIMS.recover, 'recover 动画定义存在');
assert(!!PLAYER_ANIMS.staff_cast, 'staff_cast 动画定义存在');

if (failed > 0) {
    console.error(`\n近战动画同步守卫：${failed} 项失败`);
    process.exit(1);
}
console.log('\n近战动画同步守卫全部通过。');
