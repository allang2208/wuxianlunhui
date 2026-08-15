// ============================================================
// CompanionAI 决策纯函数（2026-08-14）
// 零依赖（不 import 任何 Phaser/技能模块），供单测与运行时共用。
// 输出行动：'idle' | 'follow' | 'advance' | 'flee' | 'cast'
// ============================================================

/** 远程法师默认参数（companion-config.ai 可覆盖） */
export const DEFAULT_MAGE_AI = {
    role: 'ranged_mage',
    followOffset: 150,      // 跟随点距玩家水平偏移（px）
    followArriveDist: 55,   // 距离跟随点小于此值即停步
    combatRange: 640,       // 施法射程（技能自身 maxRange 更大时以技能为准）
    safeDistance: 230,      // 近战威胁安全距离
    castFrozenMs: 650,      // 施法站定时长（前摇+后摇）
    castCooldown: 350,      // AI 施法节流
    walkSpeed: 115,
    runSpeed: 185,
    decisionMs: 120,
    // 移动动画切换（2026-08-14）：移动距离超过 runDist 用 run（长距离奔袭/逃避/站位），
    // 小范围调整用 walk；flee 永远 run。
    runDist: 260,
    // 掉队瞬移理智判定：离玩家超过 teleportDist 且非正常远离（flee/站位/施法/追赶中）→ 瞬移回身边；
    // 超过 teleportHardDist 无条件瞬移（彻底跑丢兜底）。
    teleportDist: 700,
    teleportHardDist: 1100,
};

/**
 * 状态机决策（纯函数）
 * @param {object} input
 * @returns {'idle'|'follow'|'advance'|'flee'|'cast'}
 */
export function decideCompanionAction(input) {
    const {
        casting,          // bool：施法锁定中
        hasEnemy,         // bool：存在活动敌人
        threatDist,       // number|null：最近近战威胁距离
        safeDistance,     // number
        targetDist,       // number|null：当前攻击目标距离
        combatRange,      // number
        spellReady,       // bool：有技能就绪（冷却+MP+射程）
        followDist,       // number|null：到跟随点距离
        followArriveDist, // number
    } = input;

    // 1. 近战威胁贴脸 → 撤退（最高优先级，可打断施法：法师保命优先，2026-08-15）
    if (threatDist !== null && threatDist < safeDistance) return 'flee';

    // 2. 施法站定
    if (casting) return 'cast';

    // 3. 战斗：射程内且技能就绪 → 施法；否则推进到施法站位
    if (hasEnemy) {
        if (spellReady && targetDist !== null && targetDist <= combatRange) return 'cast';
        return 'advance';
    }

    // 4. 无战斗：跟随玩家（到位即 idle）
    if (followDist !== null && followDist > followArriveDist) return 'follow';
    return 'idle';
}

/**
 * 技能选择（纯函数）
 * 优先级：闪电（范围+眩晕，多目标/扎堆）→ 火球（范围伤害）→ 冰锥（单体稳定）。
 * @param {object} input
 * @returns {string|null} 技能 key（fireball / iceSpike / lightningStrike）
 */
export function pickCompanionSpell(input) {
    const {
        cds,          // { fireball, iceSpike, lightningStrike } 剩余冷却 ms
        mp,           // 当前法力
        mpCosts,      // { fireball, iceSpike, lightningStrike } MP 消耗
        targetDist,   // 目标距离
        ranges,       // { fireball, iceSpike, lightningStrike } 射程
        targetCount,  // 目标总数
        grouped,      // 是否有 ≥2 目标扎堆（可 AOE）
    } = input;
    const ready = (k) => (cds[k] ?? 0) <= 0 && targetDist <= (ranges[k] ?? 0) && mp >= (mpCosts[k] ?? 0);

    if (grouped || targetCount >= 2) {
        if (ready('lightningStrike')) return 'lightningStrike';
        if (ready('fireball')) return 'fireball';
    }
    if (ready('fireball')) return 'fireball';
    if (ready('iceSpike')) return 'iceSpike';
    return null;
}

/**
 * walk/run 切换判定（2026-08-14 用户需求）：
 * flee（逃避敌人）永远 run；其余按移动距离——超过 runDist 用 run（长距离奔袭/寻找输出位置），
 * 小范围移动用 walk。
 * @param {string} mode 'flee' | 'advance' | 'follow'
 * @param {number} dist 实际移动距离（优先用预寻路剩余路径长度）
 * @param {object} cfg { runDist }
 * @returns {boolean} true=run
 */
export function shouldUseRun(mode, dist, cfg) {
    if (mode === 'flee') return true;
    const runDist = cfg?.runDist ?? 260;
    return dist > runDist;
}

/**
 * 剑盾护卫防御触发判定（2026-08-15 伊莉丝）：
 * 半径 range 内敌方单位超过 enemyCount（>3）或存在远程敌方 → 释放防御。
 * 远程判定：attacks.ranged / rangedType / attack.projectileSpeed /
 * attackRange ≥ rangedRange（兜底，350 以上才是真远程——僵尸工头 320 鞭击近战、手脑/飞手 300 不算）。
 * @param {object} input
 * @returns {boolean} true=需要举盾防御
 */
export function shouldWarriorDefend(input) {
    const {
        enemies = [],           // 敌方实体数组 {x,y,attacks?,rangedType?,attackRange?}
        cx = 0, cy = 0,         // 队友位置
        range = 400,            // 判定半径
        enemyCount = 3,         // 超过该数量（>n）即触发
        rangedRange = 350,      // attackRange ≥ 该值视为远程（兜底）
    } = input;
    let near = 0;
    let hasRanged = false;
    for (const e of enemies) {
        if (!e) continue;
        if (Math.hypot(e.x - cx, e.y - cy) > range) continue;
        near++;
        const ranged = !!(e.attacks && e.attacks.ranged)
            || !!e.rangedType
            || !!(e.attack && e.attack.projectileSpeed)
            || (e.attackRange && e.attackRange >= rangedRange);
        if (ranged) hasRanged = true;
    }
    return near > enemyCount || hasRanged;
}

/**
 * 掉队瞬移理智判定（2026-08-14 用户需求）：
 * 区分 被卡住/卡门外导致的距离过远（瞬移） 与 正常 AI 运作导致的距离过远（不瞬移）。
 * 正常远离（合法，不瞬移）：①flee 逃离近战威胁（retreat 点含朝玩家分量，会自动收敛）
 *                          ②advance 去战斗站位输出（站位点离玩家在 maxFollow 允许范围）
 *                          ③施法锁定中 ④正在有效追赶（与玩家距离在缩小）
 * 掉队证据（瞬移）：①距离超 teleportHardDist（无条件兜底，彻底跑丢）
 *                  ②距离超 teleportDist 且非合法状态 ③撞墙 ④PathManager stuckCount ≥ 2
 * @param {object} input
 * @returns {boolean} true=需要瞬移回玩家身边
 */
export function shouldRelocateCompanion(input) {
    const {
        dist,                 // 与玩家距离
        teleportDist = 700,
        teleportHardDist = 1100,
        lastAction,           // 'idle'|'follow'|'advance'|'flee'|'cast'
        tacticalTarget,       // 当前战术目标（站位/撤退点）
        player,               // {x,y} 玩家位置
        followOffset = 150,
        lastPlayerDist,       // 上一帧与玩家距离（null=无记录）
        casting = false,      // 施法锁定中
        inWall = false,       // 当前位置撞墙
        pathStuck = false,    // PathManager stuckCount ≥ 2
    } = input;

    if (dist <= teleportDist) return false;
    if (dist > teleportHardDist) return true;

    // 正常远离（不瞬移）
    const fleeing = lastAction === 'flee';
    const inBattleStance = lastAction === 'advance' && tacticalTarget
        && Math.hypot(tacticalTarget.x - player.x, tacticalTarget.y - player.y) <= followOffset * 3.3;
    if (fleeing || inBattleStance || casting) return false;

    // 有效追赶中（距离在缩小）→ 正常跟随
    if (lastPlayerDist !== null && dist < lastPlayerDist - 15) return false;

    // 卡住证据（预寻路整合）：路径反复失败 / 撞墙
    if (pathStuck || inWall) return true;

    // 距离过远且不在合法远离/追赶状态 → 掉队/卡门外
    return true;
}

// ============================================================
// 队员指挥指令层纯函数（2026-08-14 轮盘五指令）
// 指令模式：'follow' | 'aggressive' | 'patrol' | 'gather' | 'hold'
// ============================================================

/** 指令是否脱离默认跟随状态（脱离时禁用掉队瞬移，允许远离玩家执行任务） */
export function isCommandActive(command) {
    return !!(command && command.mode && command.mode !== 'follow');
}

/**
 * 巡逻点选择（纯函数）：在指令中心 radius 半径圆内随机取点，并钳制在世界边界内。
 * @param {object} input { center:{x,y}, radius, bounds:{w,h}, rand }
 * @returns {{x:number,y:number}}
 */
export function pickPatrolPoint(input) {
    const { center, radius = 1200, bounds = { w: 4096, h: 4096 }, rand = Math.random } = input;
    const r = radius * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const x = center.x + Math.cos(a) * r;
    const y = center.y + Math.sin(a) * r;
    const margin = 40;
    return {
        x: Math.max(margin, Math.min(bounds.w - margin, x)),
        y: Math.max(margin, Math.min(bounds.h - margin, y)),
    };
}

/**
 * 采集目标选择（纯函数）：返回距参考点最近的有效资源点。
 * @param {Array<{x,y,active,_depleted}>} nodes 资源点列表
 * @param {{x,y}} ref 参考点（指令点，缺省玩家位置）
 * @returns {object|null}
 */
export function pickNearestNode(nodes, ref) {
    let best = null;
    let bestD = Infinity;
    for (const n of nodes) {
        if (!n || !n.active || n._depleted) continue;
        const d = Math.hypot(n.x - ref.x, n.y - ref.y);
        if (d < bestD) { best = n; bestD = d; }
    }
    return best;
}
