/**
 * 动画通道仲裁层守卫（scripts/test-anim-state.mjs）
 *
 * 保护玩家动画优化 Phase 2 步骤 2.0 沉淀的通道优先级契约：
 * resolveAnimChannel 的谓词必须与 GameScene._updatePlayerAnimation 原 if 链逐字等价，
 * 任何优先级/条件漂移都会在这里失败。
 *
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-anim-state.mjs
 */
import { AnimChannel, resolveAnimChannel, resolveGunPose, nowMs,
    enterAttackHold, enterRecover, enterDashFreeze, clearPose, queryPose } from '../src/entities/player/anim-state.js';
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

// ---------- 假 player 工厂：只放谓词消费的字段 ----------
function makePlayer(overrides = {}) {
    return {
        _isDead: false,
        _castState: 'idle',
        weaponAnim: { isAttacking: false, state: 'idle' },
        equipments: { weapon: null, offhand: null, ring1: null, ring2: null },
        weaponMode: 'weapon',
        isDodging: false,
        _isWhirlwind: false,
        _isDashing: false,
        _specialAttackActive: false,
        _dashRecoverAt: 0,
        _attackHoldUntil: 0,
        _attackRecovering: false,
        ...overrides,
    };
}

const SWORD = { name: '铁剑', category: 'weapon_melee', weaponType: 'sword' };
const PISTOL = { name: 'G18', category: 'weapon_ranged', weaponType: 'pistol' };
const RIFLE = { name: 'M416', category: 'weapon_ranged', weaponType: 'm416' };

// ---------- 1. 死亡 → DEAD（最高优先级，压过施法/攻击） ----------
{
    const p = makePlayer({
        _isDead: true,
        _castState: 'casting',
        weaponAnim: { isAttacking: true, state: 'attacking' },
        equipments: { weapon: SWORD, offhand: null },
    });
    assert(resolveAnimChannel(p) === AnimChannel.DEAD, '死亡（叠加施法+攻击）→ DEAD');
}

// ---------- 2. 施法中 → CAST（压过攻击/闪避/技能等一切非死亡状态） ----------
{
    const p = makePlayer({
        _castState: 'casting',
        weaponAnim: { isAttacking: true, state: 'attacking' },
        equipments: { weapon: SWORD, offhand: null },
        isDodging: true,
        _isWhirlwind: true,
    });
    assert(resolveAnimChannel(p) === AnimChannel.CAST, '施法中（叠加攻击/闪避/风车）→ CAST 压过一切非死亡状态');
}

// ---------- 3. 近战 attacking → MELEE_ATTACK ----------
{
    const p = makePlayer({
        weaponAnim: { isAttacking: true, state: 'attacking' },
        equipments: { weapon: SWORD, offhand: null },
    });
    assert(resolveAnimChannel(p) === AnimChannel.MELEE_ATTACK, '近战武器 attacking → MELEE_ATTACK');
}

// ---------- 4. 枪械 + isAttacking=true → 非 MELEE_ATTACK（枪械放行，落到 GUN_POSE） ----------
{
    const p = makePlayer({
        weaponAnim: { isAttacking: true, state: 'attacking' },
        equipments: { weapon: RIFLE, offhand: null },
    });
    const ch = resolveAnimChannel(p);
    assert(ch !== AnimChannel.MELEE_ATTACK, '枪械 + isAttacking=true → 非 MELEE_ATTACK（枪械放行腿层）');
    assert(ch === AnimChannel.GUN_POSE, '枪械 + isAttacking=true → GUN_POSE');
}

// ---------- 5. 闪避 → DODGE（triggerDodge 已 clearAttackTweens，weaponAnim 为 idle） ----------
{
    const p = makePlayer({ isDodging: true });
    assert(resolveAnimChannel(p) === AnimChannel.DODGE, 'isDodging → DODGE');
}

// ---------- 6. 风车/冲刺/特殊攻击 → SKILL ----------
{
    assert(resolveAnimChannel(makePlayer({ _isWhirlwind: true })) === AnimChannel.SKILL, '_isWhirlwind → SKILL');
    assert(resolveAnimChannel(makePlayer({ _isDashing: true })) === AnimChannel.SKILL, '_isDashing → SKILL');
    assert(resolveAnimChannel(makePlayer({ _specialAttackActive: true })) === AnimChannel.SKILL, '_specialAttackActive → SKILL');
}

// ---------- 7. _dashRecoverAt 未来时刻 → DASH_RECOVER ----------
{
    const p = makePlayer({ _dashRecoverAt: nowMs() + 500 });
    assert(resolveAnimChannel(p) === AnimChannel.DASH_RECOVER, '_dashRecoverAt 未来时刻 → DASH_RECOVER');
}

// ---------- 8. _attackHoldUntil 未来时刻 → ATTACK_HOLD；_attackRecovering 同理 ----------
{
    const p = makePlayer({ _attackHoldUntil: nowMs() + 300 });
    assert(resolveAnimChannel(p) === AnimChannel.ATTACK_HOLD, '_attackHoldUntil 未来时刻 → ATTACK_HOLD');
    const p2 = makePlayer({ _attackRecovering: true });
    assert(resolveAnimChannel(p2) === AnimChannel.ATTACK_HOLD, '_attackRecovering → ATTACK_HOLD');
}

// ---------- 9. 双持手枪 → GUN_POSE（gun_idle_dual）；单持手枪/步枪 → GUN_POSE ----------
{
    const p = makePlayer({ equipments: { weapon: PISTOL, offhand: PISTOL } });
    assert(resolveAnimChannel(p) === AnimChannel.GUN_POSE, '双持手枪移动 → GUN_POSE');
    const pose = resolveGunPose(p);
    assert(pose && pose.poseKey === 'gun_idle_dual', '双持手枪姿态解析 → gun_idle_dual');
    const p2 = makePlayer({ equipments: { weapon: PISTOL, offhand: null } });
    const pose2 = resolveGunPose(p2);
    assert(resolveAnimChannel(p2) === AnimChannel.GUN_POSE && pose2 && pose2.poseKey === 'gun_idle_pistol',
        '单持手枪 → GUN_POSE（gun_idle_pistol）');
}

// ---------- 10. 空手静止 → LOCOMOTION（兜底） ----------
{
    const p = makePlayer();
    assert(resolveAnimChannel(p) === AnimChannel.LOCOMOTION, '空手静止 → LOCOMOTION');
}

// ---------- 11. 空手 attacking → MELEE_ATTACK（原守卫不要求近战武器，逐字等价） ----------
{
    const p = makePlayer({ weaponAnim: { isAttacking: true, state: 'attacking' } });
    assert(resolveAnimChannel(p) === AnimChannel.MELEE_ATTACK, '空手 attacking → MELEE_ATTACK（原守卫对非枪武器一视同仁）');
}

// ---------- 12. beretta93r 防回归（步骤 2.2）：GameScene.js 不再出现内联枪械类型数组 ----------
{
    const gs = readFileSync(path.join(ROOT, 'src/phaser/scenes/GameScene.js'), 'utf-8');
    const inlineGunArrays = (gs.match(/\[[^\]]*\]/g) || [])
        .filter(m => m.includes("'pkm'") && m.includes("'deagle'"));
    assert(inlineGunArrays.length === 0, 'GameScene.js 无内联枪械类型数组（已收口 GUN_FAMILY，beretta93r 不再漏判）');
    assert(gs.includes('const isGunR = GUN_FAMILY.includes(wt)')
        && gs.includes('const isGunSpecial = GUN_FAMILY.includes(wt)'),
        '收势滑回（isGunR）/特殊缩放（isGunSpecial）两处 isGun 判定均走 GUN_FAMILY');
}

// ---------- 13. pose session API 不变量（步骤 2.3） ----------
{
    // enterRecover 必须同时清 hold
    const p = makePlayer();
    p._attackHoldUntil = nowMs() + 500;
    p._attackHoldAnimKey = 'attack_sword';
    enterRecover(p, { cfgKey: 'dash', startMs: 12345 });
    const q = queryPose(p);
    assert(q.holdUntil === 0 && q.recovering === true && q.recoverStart === 12345 && q.recoverCfgKey === 'dash',
        'enterRecover 同时清 hold，并置位 recovering/recoverStart/recoverCfgKey');
}
{
    // enterAttackHold 清 recover
    const p = makePlayer();
    p._attackRecovering = true;
    p._attackRecoverStart = 100;
    p._recoverCfgKey = 'dash';
    enterAttackHold(p, { animKey: 'attack_sword_2', untilMs: 99999 });
    const q = queryPose(p);
    assert(q.recovering === false && q.holdUntil === 99999 && q.holdAnimKey === 'attack_sword_2',
        'enterAttackHold 同时清 recover，并置位 holdUntil/holdAnimKey');
}
{
    // enterDashFreeze 置位
    const p = makePlayer();
    enterDashFreeze(p, 54321);
    assert(p._dashRecoverAt === 54321 && queryPose(p).dashRecoverAt === 54321,
        'enterDashFreeze 置位 _dashRecoverAt');
}
{
    // clearPose 全清
    const p = makePlayer();
    p._attackHoldUntil = 1; p._attackHoldAnimKey = 'attack_sword'; p._attackRecovering = true;
    p._attackRecoverStart = 2; p._recoverCfgKey = 'dash'; p._dashRecoverAt = 3;
    clearPose(p);
    const q = queryPose(p);
    assert(!q.holdUntil && !q.holdAnimKey && !q.recovering && !q.recoverStart && !q.recoverCfgKey && !q.dashRecoverAt,
        'clearPose 全清六个姿态字段');
}

// ---------- 14. ctx 附带产物（Phase 4）：GUN_POSE 时携带 gunPose，其余通道不携带 ----------
{
    const ctx = {};
    const p = makePlayer({ equipments: { weapon: PISTOL, offhand: PISTOL } });
    assert(resolveAnimChannel(p, ctx) === AnimChannel.GUN_POSE
        && ctx.gunPose && ctx.gunPose.poseKey === 'gun_idle_dual',
        'GUN_POSE 通道：ctx.gunPose 携带解析结果（GameScene case 复用，消除每帧第二次解析）');
    const ctx2 = {};
    assert(resolveAnimChannel(makePlayer(), ctx2) === AnimChannel.LOCOMOTION
        && ctx2.gunPose === undefined,
        '非 GUN_POSE 通道：ctx 不携带 gunPose');
}

if (failed > 0) {
    console.error(`\n${failed} 项断言失败`);
    process.exit(1);
}
console.log('\n全部断言通过');
