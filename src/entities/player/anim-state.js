// ============================================================
// 动画通道仲裁层（玩家动画优化 Phase 2 / 步骤 2.0）
// 把 GameScene._updatePlayerAnimation 的 6 级 if 守卫收敛为"优先级查表"：
// - 谓词只读，条件与顺序同原 if 链逐字等价（行为等价为第一原则）；
// - 写副作用（近战卡死复位、dash 到点触发、hold/recover 状态推进等）
//   仍留在 GameScene 各 case 分支内原样执行，不在本模块。
// ============================================================

import { isGunWeapon } from '../../config/gun-ammo.js';
import { getPlayerAnimDef } from '../../config/player-anim.js';
import { COMBAT_CONFIG } from '../../config/combat-config.js';

// 动画通道枚举：resolveAnimChannel 按下列声明顺序（优先级高 → 低）返回第一个 owns 为真的通道
export const AnimChannel = Object.freeze({
    DEAD: 'DEAD',
    CAST: 'CAST',
    MELEE_ATTACK: 'MELEE_ATTACK',
    DODGE: 'DODGE',
    SKILL: 'SKILL',
    DASH_RECOVER: 'DASH_RECOVER',
    ATTACK_HOLD: 'ATTACK_HOLD',
    GUN_POSE: 'GUN_POSE',
    LOCOMOTION: 'LOCOMOTION',
});

// 统一时间源收口点：本模块及玩家动画链路的时间逻辑一律走这里。
// Phase 3（2026-08-13）起，玩家动画相关的 Date.now()（墙钟）/performance.now() 调用点
// 已逐字段整体迁移到本函数——语义从"墙钟"变为"单调时钟"（有意改进：
// 消除系统校时/休眠导致的时序跳变；同一字段的写者与全部读者已核实同口径）。
// 未迁移项（自洽或与非动画系统共享，见 Phase 3 报告）：命中音效节流、眩晕/光环/过热条闪烁等。
export function nowMs() {
    return performance.now();
}

// 持枪姿态解析（原 GameScene._updatePlayerAnimation 内联闭包 _resolveGunPose，逐字搬入模块以便谓词复用）：
// 双持手枪（副手为手枪）→ gun_idle_dual；单持手枪 → gun_idle_pistol；
// 其余枪械 → gun_idle；配置缺失逐级回退
export function resolveGunPose(player) {
    const currentItem = player.equipments[player.weaponMode];
    if (!currentItem || !isGunWeapon(currentItem)) return null;
    const offhandSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
    const offhandItem = player.equipments[offhandSlot];
    const isDualPistol = offhandItem && offhandItem.name
        && (offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol');
    const isPistolMain = currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol';
    if (isDualPistol) {
        const dualDef = getPlayerAnimDef('gun_idle_dual');
        if (dualDef) return { poseKey: 'gun_idle_dual', def: dualDef };
    }
    if (isPistolMain) {
        const pistolDef = getPlayerAnimDef('gun_idle_pistol');
        if (pistolDef) return { poseKey: 'gun_idle_pistol', def: pistolDef };
    }
    const def = getPlayerAnimDef('gun_idle');
    return def ? { poseKey: 'gun_idle', def } : null;
}

// ============================================================
// 三段连段（挥击×2 + 突刺×1，2026-08-13）段数映射与时长梯度
// 段序：1 大幅过顶下劈 → 2 肩高快劈 → 3 弓步突刺（终结段）→ 窗口内再攻击回 1。
// 时长梯度收口 data/combat-config.json meleeCombo（JSON 无注释，语义在此登记）：
// - stageNHoldMs：N 段末帧定格 = 连段窗口（窗口内再攻击派生下一段，超时播收势）。
//   stage3HoldMs=0（2026-08-16 用户指定）：终结段后**不留定格窗口**——播完直接收势回 idle，
//   三连击严格 1→2→3→收势（不再有 3→1 回环）；想恢复回环改回 300 即可。
// - stageNRecoverMs：收势动画固定时长（0 = recover sheet 配置自然时长）。
//   stage3RecoverMs=400：终结段收势稍长，突出收招顿挫。
// ============================================================
export const MELEE_COMBO_STAGES = 3;
export const MELEE_STAGE_ANIM_KEYS = Object.freeze(['attack_sword', 'attack_sword_2', 'attack_sword_3']);

// 段数 → 武器轨迹块键（配置缺失逐级回退：stage3 → attack2 → attack）
export function meleeStageCfgKey(wacCfg, stage) {
    const keys = ['attack', 'attack2', 'attack3'];
    for (let s = Math.min(Math.max(stage || 1, 1), MELEE_COMBO_STAGES); s >= 1; s--) {
        if (wacCfg && wacCfg[keys[s - 1]]) return keys[s - 1];
    }
    return 'attack';
}

// 段数 → 末帧定格/连段窗口时长（combat-config.meleeCombo.stageNHoldMs，缺省梯度 500/200/300）
export function meleeStageHoldMs(stage) {
    const mc = COMBAT_CONFIG.meleeCombo || {};
    const fallbacks = [500, 200, 300];
    const s = Math.min(Math.max(stage || 1, 1), MELEE_COMBO_STAGES);
    return mc[`stage${s}HoldMs`] ?? fallbacks[s - 1];
}

// 段数 → 收势动画固定时长（0 = 用 recover sheet 配置自然时长；stage2 300 / stage3 400）
export function meleeStageRecoverMs(stage) {
    const mc = COMBAT_CONFIG.meleeCombo || {};
    const fallbacks = [0, 300, 400];
    const s = Math.min(Math.max(stage || 1, 1), MELEE_COMBO_STAGES);
    return mc[`stage${s}RecoverMs`] ?? fallbacks[s - 1];
}

/**
 * 通道仲裁：按优先级返回第一个 owns 为真的通道。
 * 谓词严格复刻 GameScene._updatePlayerAnimation 原 if 链（约 1967-2124 行）的条件与顺序；
 * 全部为 player 字段只读推导，无任何写副作用。
 * @param {object} player 玩家实体（逻辑层）
 * @param {object} [_ctx] 预留上下文注入点（未来把场景依赖/时间源从 player 字段迁出时使用），当前未消费
 * @returns {string} AnimChannel 之一
 */
export function resolveAnimChannel(player, _ctx) {
    // #1 DEAD：死亡后一切动画切换停止
    if (player._isDead) return AnimChannel.DEAD;

    // #2 CAST：施法动画期间不被移动/状态机覆盖
    if (player._castState && player._castState !== 'idle') return AnimChannel.CAST;

    // #3 MELEE_ATTACK：攻击/特殊动画期间不覆盖。
    // 条件与原守卫 `if (!_isGunPose && (weaponAnim.isAttacking || (weaponAnim.state && weaponAnim.state !== 'idle'))) return;`
    // 逐字等价——注意原守卫不要求近战武器：任何非枪武器（含空手 currentItem 为 undefined）
    // 攻击中都成立；通道名取语义主线（近战剑动画在 playerSprite 上需防覆盖）。
    // 枪械姿态下不成立（放行腿层）：枪的攻击动画在武器贴图层，playerSprite 只承载腿/躯干层，
    // 冻结会导致冲刺开火时 runlegs 切不回 walklegs。
    const weaponAnim = player.weaponAnim || {};
    const currentItem = player.equipments[player.weaponMode];
    const _isGunPose = currentItem && isGunWeapon(currentItem);
    if (!_isGunPose && (weaponAnim.isAttacking || (weaponAnim.state && weaponAnim.state !== 'idle'))) {
        return AnimChannel.MELEE_ATTACK;
    }

    // #4 DODGE：闪避翻滚动画播放期间不被移动状态机覆盖。
    // 排在 MELEE_ATTACK 之后是安全的：triggerDodge 会 clearAttackTweens()
    // （weaponAnim.isAttacking/state 复位 idle），闪避不会被 #3 遮蔽。
    if (player.isDodging) return AnimChannel.DODGE;

    // #5 SKILL：风车/冲刺/夜与火特殊攻击期间冻结身体层。
    // 这三个技能都不注册专门的玩家身体动画（player-anim-config.json 无对应键）：
    // 身体层表现 = 冻结当前姿态 + 武器贴图程序偏移（GameScene syncWeapon 的 extraOffset/extraAngle）
    // + 特效（AttackRangeEffect / NightFlameBeamEffect）；dash 攻击的身体动画（dash_attack）
    // 由 dash-system.trigger 通过 scene.setPlayerAnimation 播放，此处防被 walk/idle 覆盖。
    // _isPushStrike 保持现状不进表：推击要求持有远程武器（quick-bar.js 校验），
    // 持枪时 #3 的枪械放行分支本就不冻结身体层（GUN_POSE 腿层/持枪姿态照常驱动，现状即正确表现）；
    // 持弓开火时 weaponAnim.state==='attacking' 由 #3 拦住。两种情形重构前后行为一致。
    if (player._isWhirlwind || player._isDashing || player._specialAttackActive) return AnimChannel.SKILL;

    // #6 DASH_RECOVER：冲刺攻击末帧定格/到点恢复（时间推进在 GameScene case 内）
    if (player._dashRecoverAt) return AnimChannel.DASH_RECOVER;

    // #7 ATTACK_HOLD：攻击后定格保持（连段窗口）与收势动画
    if (player._attackHoldUntil || player._attackRecovering) return AnimChannel.ATTACK_HOLD;

    // #8 GUN_POSE：持枪姿态（腿层走/跑 + 躯干扭转层），姿态解析与原 _resolveGunPose 逐字等价
    const gunPose = resolveGunPose(player);
    if (gunPose) {
        // Phase 4：解析结果写进 ctx，GameScene 的 GUN_POSE case 直接复用，消除每帧第二次解析
        if (_ctx) _ctx.gunPose = gunPose;
        return AnimChannel.GUN_POSE;
    }

    // #9 LOCOMOTION：兜底（idle/walk/run，含 80ms 防抖缓冲，缓冲逻辑在 GameScene case 内）
    return AnimChannel.LOCOMOTION;
}

// ============================================================
// Pose Session API（玩家动画优化 Phase 2 / 步骤 2.3）
// 定格/收势字段的集中写入口：字段实体仍留在 player 上（存档/调试兼容），
// 所有写路径必须走这里以维持不变量；只读判定（GameScene/update.js/dash-system 等）保持直读。
// 涉及字段：_attackHoldUntil、_attackHoldAnimKey、_attackRecovering、
//           _attackRecoverStart、_recoverCfgKey、_dashRecoverAt
// （_lastMeleeAttackEnd、_meleeComboStage 本轮不动——weapon-anim.js 与 GameScene 双端读，波及面大）
// ============================================================

// 进入攻击后定格保持（连段窗口）。不变量：hold 与 recover 互斥——写 hold 同时清 recover
// （收势中被新攻击打断时解除收势标记）。
// 注意 weapon-anim.js 的"预写 → Tween onComplete 复写"两次写序列靠两次调用本函数实现，
// 次序与位置不得合成为一次写（animationcomplete 早于 onComplete，GameScene 完成回调依赖预写值）。
export function enterAttackHold(player, { animKey, untilMs }) {
    player._attackRecovering = false;
    player._attackHoldAnimKey = animKey;
    player._attackHoldUntil = untilMs;
}

// 进入收势（recover/dash_recover 播放）。不变量：必须同时清 hold。
// cfgKey：武器滑回轨迹块（'dash' = 冲刺轨迹末帧滑回；null = 近战按段回退 attack/attack2）；
// startMs：收势起点，武器线性滑回 idle 位的时间基准（performance.now() 口径）。
export function enterRecover(player, { cfgKey, startMs }) {
    player._attackHoldUntil = 0;
    player._attackRecovering = true;
    player._attackRecoverStart = startMs;
    player._recoverCfgKey = cfgKey;
}

// 进入冲刺末帧定格：atMs 到点后由 GameScene DASH_RECOVER case 触发恢复动画
export function enterDashFreeze(player, atMs) {
    player._dashRecoverAt = atMs;
}

// 全清姿态字段（移动取消定格/收势、收势动画播完、新攻击启动等"回到自由态"路径）
export function clearPose(player) {
    player._attackHoldUntil = 0;
    player._attackHoldAnimKey = null;
    player._attackRecovering = false;
    player._attackRecoverStart = 0;
    player._recoverCfgKey = null;
    player._dashRecoverAt = 0;
}

// 姿态字段快照（调试/测试断言用；只读）
export function queryPose(player) {
    return {
        holdUntil: player._attackHoldUntil || 0,
        holdAnimKey: player._attackHoldAnimKey || null,
        recovering: !!player._attackRecovering,
        recoverStart: player._attackRecoverStart || 0,
        recoverCfgKey: player._recoverCfgKey || null,
        dashRecoverAt: player._dashRecoverAt || 0,
    };
}

// ============================================================
// 卡死兜底 watchdog 清单（Phase 3 登记，纯文档性常量表——逻辑与阈值各在原地，本表不改行为）
// 登记时已逐条核对与现状一致；新增兜底请先在这里登记。
// ============================================================
export const ANIM_WATCHDOGS = Object.freeze([
    {
        id: 'weapon-anim-stuck-idle',
        location: 'src/entities/player/weapon-anim.js updateWeaponAnim（约 46-50 行）',
        condition: "anim.state !== 'idle' && anim.timer > 5000（timer 为逻辑帧累计，非墙钟）",
        action: '强制回 idle（state/timer/isAttacking 复位），防体力回复等逻辑被永久阻塞',
        thresholdMs: 5000,
    },
    {
        id: 'cast-softlock',
        location: 'GameScene._updatePlayerAnimation CAST case（施法软锁兜底）',
        condition: '_castState 非 idle 但施法动画未在播（注册失败/被外部打断）',
        action: '_endPlayerCast() 自动收尾，防施法状态软锁',
        thresholdMs: null, // 帧检测，非时长阈值
    },
    {
        id: 'dash-wall-stuck',
        location: 'src/entities/components/dash-system.js update 挥砍位移窗口（撞墙反弹分支）',
        condition: '_dashBounceApplied 且 progress > 0.1 后累计位移 < 2px',
        action: '结束冲刺（_isDashing=false 等）并 enterDashFreeze(nowMs() + 500)',
        thresholdMs: null, // 位移阈值 2px，非时长阈值
    },
    {
        id: 'melee-attack-stuck',
        location: 'GameScene._updatePlayerAnimation MELEE_ATTACK case',
        condition: '近战武器 isAttacking=true 但 attack_sword/attack_sword_2 动画已停播',
        action: '复位 weaponAnim 为 idle 并按新状态重新仲裁（递归等价落闸）',
        thresholdMs: null, // 帧检测，非时长阈值
    },
]);
