// ============================================================
// 后台位面账本（M3）
//
// 永久位面离场后不保留任何运行时实体。本模块只在快照上维护：
// - 缓存科研贡献与军力摘要；
// - 下一次真正需要推进纯数据结算的游戏时间；
// - 调度失效原因和结算统计，供存档/调试观察。
//
// 连续资源不需要 1Hz 扫描；它们在离散事件、面板读取、保存或入场前按时间差一次结算。
// ============================================================

export const WORLD_BACKGROUND_LEDGER_VERSION = 1;

const MIN_WAKE_DELAY_MS = 250;
const BLOCKED_RETRY_MS = 10000;
const BAKERY_RETRY_MS = 10000;

const UPGRADE_FIELDS = Object.freeze([
    'upgrade',
    'economyUpgrade',
    'workshopUpgrade',
    'windmillUpgrade',
    'mintUpgrade',
    'armoryUpgrade',
    'hospitalUpgrade',
    'bankUpgrade',
    'grandMallUpgrade',
    'bakeryUpgrade',
    'chainRestaurantUpgrade',
    'cheeseFarmUpgrade',
    'windPowerUpgrade',
    'resonatorUpgrade',
    'weatherUpgrade',
    'warehouseUpgrade',
    'candleUpgrade',
]);

function finiteNonNegative(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function minPositive(current, candidate) {
    const value = Number(candidate);
    if (!Number.isFinite(value) || value < 0) return current;
    return Math.min(current, Math.max(MIN_WAKE_DELAY_MS, value));
}

function rosterCount(structure) {
    return Object.values(structure?.unitRoster || {}).reduce(
        (sum, count) => sum + Math.max(0, Math.floor(Number(count) || 0)),
        0
    );
}

/** 只扫描紧凑快照字段，不读取 Game/Phaser 运行时。 */
export function getWorldBackgroundNextDelay(snapshot) {
    let nextDelay = Number.POSITIVE_INFINITY;
    for (const structure of snapshot?.structures || []) {
        if (!structure || !(Number(structure.hp ?? 1) > 0)) continue;

        for (const field of UPGRADE_FIELDS) {
            const timer = structure[field];
            if (timer && Number.isFinite(Number(timer.remainMs))) {
                nextDelay = minPositive(nextDelay, timer.remainMs);
            }
        }

        if (structure.kind === 'hut') {
            const assigned = Math.max(0, Math.floor(Number(
                structure.assignedWorkers == null ? structure.miners : structure.assignedWorkers
            ) || 0));
            const miners = Math.max(0, Math.floor(Number(structure.miners) || 0));
            if (assigned > miners) {
                nextDelay = minPositive(nextDelay,
                    finiteNonNegative(structure.respawnTimer, BLOCKED_RETRY_MS) || BLOCKED_RETRY_MS);
            }
        }

        if (structure.parallelQueues && typeof structure.parallelQueues === 'object') {
            for (const queue of Object.values(structure.parallelQueues)) {
                if (!queue || queue.recruitMode === 'paused') continue;
                const blocked = queue.blocked || queue.foodBlocked || queue.populationBlocked;
                nextDelay = minPositive(nextDelay, blocked
                    ? BLOCKED_RETRY_MS
                    : finiteNonNegative(queue.timer, MIN_WAKE_DELAY_MS));
            }
        } else if (structure.unitType && structure.recruitMode !== 'paused') {
            nextDelay = minPositive(nextDelay, structure.populationBlocked || structure.foodBlocked
                ? BLOCKED_RETRY_MS
                : finiteNonNegative(structure.spawnTimer, MIN_WAKE_DELAY_MS));
        }

        for (const run of structure.explorerState?.runs || []) {
            nextDelay = minPositive(nextDelay, run?.remainingMs);
        }

        if (structure.bakeryJob && Number(structure.assignedWorkers) > 0) {
            const processRemainMs = Number(structure.bakeryJob.processRemainMs);
            nextDelay = minPositive(nextDelay,
                Number.isFinite(processRemainMs) && processRemainMs > 0
                    ? processRemainMs : BAKERY_RETRY_MS);
        }
        if (structure.chainRestaurantJob && Number(structure.assignedWorkers) > 0) {
            const processRemainMs = Number(structure.chainRestaurantJob.processRemainMs);
            nextDelay = minPositive(nextDelay,
                Number.isFinite(processRemainMs) && processRemainMs > 0
                    ? processRemainMs : BAKERY_RETRY_MS);
        }
        if (structure.cheeseFarmJob && Number(structure.assignedWorkers) > 0) {
            const processRemainMs = Number(structure.cheeseFarmJob.processRemainMs);
            nextDelay = minPositive(nextDelay,
                Number.isFinite(processRemainMs) && processRemainMs > 0
                    ? processRemainMs : BAKERY_RETRY_MS);
        }
    }

    for (const node of snapshot?.nodes || []) {
        if (node?.depleted && Number(node.respawnTimer) > 0) {
            nextDelay = minPositive(nextDelay, node.respawnTimer);
        }
    }
    return Number.isFinite(nextDelay) ? nextDelay : null;
}

/** 后台入侵只消费这份聚合摘要，不为驻军创建实体。 */
export function buildWorldCombatDigest(snapshot) {
    const digest = {
        structureDps: 0,
        towerDps: 0,
        garrisonDps: 0,
        garrisonUnits: 0,
        wallHp: 0,
        buildingHp: 0,
        portalHp: 0,
        damageOrder: [],
        portalIndex: -1,
    };
    const walls = [];
    const buildings = [];
    for (const [index, structure] of (snapshot?.structures || []).entries()) {
        if (!structure || !(Number(structure.hp) > 0)) continue;
        if (structure.kind === 'tower') {
            const dps = finiteNonNegative(structure.dps);
            digest.towerDps += dps;
            digest.structureDps += dps;
        } else if (structure.kind === 'barracks' || structure.kind === 'producer') {
            const dps = finiteNonNegative(structure.unitDps);
            digest.garrisonDps += dps;
            digest.structureDps += dps;
            digest.garrisonUnits += rosterCount(structure);
        }

        if (structure.kind === 'block' || structure.kind === 'gate4') {
            walls.push(index);
            digest.wallHp += finiteNonNegative(structure.hp);
            for (const pillar of structure.pillars || []) {
                digest.wallHp += finiteNonNegative(pillar?.hp);
            }
        } else if (structure.kind === 'producer' && structure.cfgKey === 'portal') {
            digest.portalIndex = index;
            digest.portalHp = finiteNonNegative(structure.hp);
        } else {
            buildings.push(index);
            digest.buildingHp += finiteNonNegative(structure.hp);
        }
    }
    digest.damageOrder = [...walls, ...buildings];
    return digest;
}

export function refreshWorldBackgroundLedger(snapshot, nowGameTimeMs, researchSummary = null, reason = 'settled') {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const now = finiteNonNegative(nowGameTimeMs,
        finiteNonNegative(snapshot.capturedGameTimeMs));
    const delay = getWorldBackgroundNextDelay(snapshot);
    const previous = snapshot.backgroundLedger && typeof snapshot.backgroundLedger === 'object'
        ? snapshot.backgroundLedger : {};
    const research = researchSummary && typeof researchSummary === 'object'
        ? {
            count: Math.max(0, Math.floor(Number(researchSummary.count) || 0)),
            rate: finiteNonNegative(researchSummary.rate),
        }
        : previous.research || { count: 0, rate: 0 };
    snapshot.backgroundLedger = {
        version: WORLD_BACKGROUND_LEDGER_VERSION,
        settledAtGameTimeMs: finiteNonNegative(snapshot.capturedGameTimeMs, now),
        nextWakeAtGameTimeMs: delay == null ? null : now + delay,
        research,
        combat: buildWorldCombatDigest(snapshot),
        structureCount: Array.isArray(snapshot.structures) ? snapshot.structures.length : 0,
        unitCount: (snapshot.structures || []).reduce((sum, structure) => sum + rosterCount(structure), 0),
        settlementCount: Math.max(0, Math.floor(Number(previous.settlementCount) || 0))
            + (!['ensure', 'invasion-damage'].includes(reason) ? 1 : 0),
        lastReason: reason,
        dirty: false,
    };
    return snapshot.backgroundLedger;
}

export function ensureWorldBackgroundLedger(snapshot, nowGameTimeMs, researchFactory = null) {
    const ledger = snapshot?.backgroundLedger;
    if (ledger?.version === WORLD_BACKGROUND_LEDGER_VERSION && !ledger.dirty) return ledger;
    const research = typeof researchFactory === 'function' ? researchFactory(snapshot) : ledger?.research;
    return refreshWorldBackgroundLedger(snapshot, nowGameTimeMs, research, 'ensure');
}

export function invalidateWorldBackgroundLedger(snapshot, reason = 'external-change') {
    if (!snapshot || typeof snapshot !== 'object') return;
    const ledger = snapshot.backgroundLedger && typeof snapshot.backgroundLedger === 'object'
        ? snapshot.backgroundLedger : {};
    snapshot.backgroundLedger = {
        ...ledger,
        version: WORLD_BACKGROUND_LEDGER_VERSION,
        nextWakeAtGameTimeMs: 0,
        lastReason: reason,
        dirty: true,
    };
}

export function isWorldBackgroundLedgerDue(snapshot, nowGameTimeMs) {
    const ledger = snapshot?.backgroundLedger;
    if (!ledger || ledger.version !== WORLD_BACKGROUND_LEDGER_VERSION || ledger.dirty) return true;
    if (ledger.nextWakeAtGameTimeMs == null) return false;
    const wakeAt = Number(ledger.nextWakeAtGameTimeMs);
    return Number.isFinite(wakeAt) && wakeAt <= finiteNonNegative(nowGameTimeMs);
}
