/**
 * 经验系统（唯一口径，2026-07-28 重构；配置：data/combat-formulas.json enemy.expValue，勿硬编码）
 *
 * pacing 闭环：每场经验产出预算 = 升级曲线段成本 / pacingRuns（2.5 场/段），
 * 按地牢配置的"加权击杀"（普通×1/精英×2/领主×4/首领×10）分摊到每只怪物——
 * 同级地牢 2~3 场升一段是构造出来的；探索越多升级越快（全清≈2 场，直奔 Boss≈3.5 场）。
 *
 * 压级衰减：玩家等级超怪物有效等级 graceLevels 级后每级 -slope，下限 floor[rank]。
 * 怪物有效等级：L_m = anchors[grade] + (配置等级 - 3)（保留种间相对差异）。
 *
 * 本模块保持 config 层纯净（只引 JSON），node 单测可直接导入；
 * 当前地牢类型由 DungeonMapSystem init/shutdown 经 setCurrentDungeonType 注入。
 */
import combatFormulasData from '../../data/combat-formulas.json';
import dungeonConfigData from '../../data/dungeon-config.json';
import invasionConfig from '../../data/agent-invasion.json';

const GRADE_ORDER = ['F', 'E', 'D', 'C', 'B', 'A'];

// 地牢 type → 配置块键（与 src/config/dungeon-config.js _keyFor 保持一致的登记点；
// 本模块不引 dungeon-config.js 以保持 config 层纯净/可单测，漂移由 test-regressions 断言拦截）
const DUNGEON_BLOCK_KEY = {
    zombie: 'zombieDungeon',
    zombieBeginner: 'zombieDungeonBeginner',
    zombieMid: 'zombieDungeonMid',
    swamp: 'swampDungeon',
};

let _currentDungeonType = null;
export function setCurrentDungeonType(t) { _currentDungeonType = t; }
export function getCurrentDungeonType() { return _currentDungeonType; }

const _cfg = () => combatFormulasData.enemy?.expValue || {};

/** 升级曲线（与 player/base.js getExpForLevel 同公式，唯一来源：combat-formulas player.expPerLevel） */
export function computeMaxExp(level) {
    const f = combatFormulasData.player?.expPerLevel || {};
    return ((f.base ?? 20) + level * (f.levelMultiplier ?? 20) + level * (f.levelSquareMultiplier ?? 12))
        * (f.finalMultiplier ?? 2) * (f.globalMultiplier ?? 1);
}

export function getGradeForDungeon(dungeonType) {
    return (dungeonConfigData.dungeonList?.[dungeonType]?.grade) || 'F';
}

/** 段成本：段内等级升级经验之和（升级曲线不变） */
export function getBandCost(grade) {
    const bands = _cfg().bands || { F: [1, 10], E: [10, 25], D: [25, 40], C: [40, 55], B: [55, 70], A: [70, 85] };
    const [a, b] = bands[grade] || bands.F;
    let sum = 0;
    for (let L = a; L < b; L++) sum += computeMaxExp(L);
    return sum;
}

/** 单场遭遇的 tier 构成统计：优先 waveComposition 逐波求和，缺省 combatWaves × monsterComposition（无 comp 视为全普通） */
function _fightCounts(enc, defaultPerWave = 5) {
    const counts = { normal: 0, elite: 0, lord: 0, boss: 0 };
    if (!enc) return counts;
    if (Array.isArray(enc.waveComposition)) {
        for (const comp of enc.waveComposition) {
            for (const [tier, n] of Object.entries(comp || {})) counts[tier] = (counts[tier] || 0) + n;
        }
        return counts;
    }
    const waves = enc.combatWaves ?? 1;
    const comp = enc.monsterComposition || { normal: enc.monstersPerWave ?? defaultPerWave };
    for (const [tier, n] of Object.entries(comp)) counts[tier] = (counts[tier] || 0) + n * waves;
    return counts;
}

/** 地牢结构解析（加权击杀/战斗节点数共用，带缓存）：由 dungeon-config 机械算出 */
const _structCache = new Map();
function _analyzeDungeon(dungeonType) {
    const key = dungeonType || '_hub';
    if (_structCache.has(key)) return _structCache.get(key);
    const cfg = dungeonConfigData[DUNGEON_BLOCK_KEY[dungeonType]] || dungeonConfigData.zombieDungeonBeginner;
    const grade = getGradeForDungeon(dungeonType);
    const gradeIdx = Math.max(0, GRADE_ORDER.indexOf(grade));

    // nodeCount 口径含宝箱岔路（见 zombie-dungeon.js generate）——先减岔路预算再算网格战斗节点，
    // 否则岔路节点被网格/岔路两边重复计入
    const branches = (cfg.chestBranches?.count !== undefined)
        ? cfg.chestBranches.count : 2 + gradeIdx * 2;
    const branchPlanned = Math.round(branches * 2.5);

    // 战斗节点数 ≈ (网格 nodeCount 中值 - 3) × 战斗比例
    const nodeMid = ((cfg.nodeCount?.min ?? 20) + (cfg.nodeCount?.max ?? 25)) / 2 - branchPlanned;
    const combatNodes = Math.max(1, nodeMid - 3) * (cfg.typeRatios?.combat ?? 0.5);
    const eliteChance = cfg.eliteCombatChance ?? 0;

    // 单场战斗构成（支持 waveComposition 逐波配比：普通战尾波定刷精英、精英战尾波定刷领主）
    const normFight = _fightCounts(cfg.encounters?.normal);
    const eliteFight = _fightCounts(cfg.encounters?.elite);

    let N = 0, E = 0, L = 0, B = 0;
    const normFights = combatNodes * (1 - eliteChance);
    const eliteFights = combatNodes * eliteChance;
    N += normFights * normFight.normal + eliteFights * eliteFight.normal;
    E += normFights * normFight.elite + eliteFights * eliteFight.elite;
    L += normFights * normFight.lord + eliteFights * eliteFight.lord;
    B += normFights * normFight.boss + eliteFights * eliteFight.boss;

    // 宝箱岔路：每支路 1 场战斗，精英率固定 50%（F 级岔路固定普通，见 zombie-dungeon.js）
    const branchEliteRate = grade === 'F' ? 0 : 0.5;
    N += branches * ((1 - branchEliteRate) * normFight.normal + branchEliteRate * eliteFight.normal);
    E += branches * ((1 - branchEliteRate) * normFight.elite + branchEliteRate * eliteFight.elite);
    L += branches * ((1 - branchEliteRate) * normFight.lord + branchEliteRate * eliteFight.lord);
    B += branches * ((1 - branchEliteRate) * normFight.boss + branchEliteRate * eliteFight.boss);

    // Boss：bossEncounter 独立构成（支持 waveComposition），缺省 = 集合体（首领）
    const be = cfg.bossEncounter;
    if (be) {
        const bc = _fightCounts(be);
        N += bc.normal; E += bc.elite; L += bc.lord; B += bc.boss;
    } else {
        B += 1;
    }

    // 时空特工入侵（D 级及以上，领主 rank，按满额计入——保守压低基础经验）
    if (invasionConfig.enabled !== false
        && gradeIdx >= GRADE_ORDER.indexOf(invasionConfig.minGrade || 'D')) {
        L += (invasionConfig.agentCountByGrade?.[grade]) ?? 1;
    }

    const mul = _cfg().rankMul || { normal: 1, elite: 2, lord: 4, boss: 20 };
    const w = (c) => (c.normal || 0) * (mul.normal ?? 1) + (c.elite || 0) * (mul.elite ?? 2)
        + (c.lord || 0) * (mul.lord ?? 4) + (c.boss || 0) * (mul.boss ?? 20);
    const s = {
        N, E, L, B,
        W: N * (mul.normal ?? 1) + E * (mul.elite ?? 2) + L * (mul.lord ?? 4) + B * (mul.boss ?? 20),
        // 战斗节点总数（网格战斗 + 岔路战斗 + Boss 房），清剿奖分摊口径
        combatNodeCount: combatNodes + branches + 1,
        // 单场遭遇构成与加权值（悬停预估/测试断言用）
        normFight, eliteFight,
        bossFight: be ? _fightCounts(be) : { normal: 0, elite: 0, lord: 0, boss: 1 },
        normFightW: w(normFight),
        eliteFightW: w(eliteFight),
        bossFightW: be ? w(_fightCounts(be)) : w({ boss: 1 }),
    };
    _structCache.set(key, s);
    return s;
}

/** 地牢各档战斗的单场加权经验（单位：普通怪基础经验的倍数） */
export function getDungeonFightWeights(dungeonType) {
    const s = _analyzeDungeon(dungeonType);
    return { normal: s.normFightW, elite: s.eliteFightW, boss: s.bossFightW };
}

/** 地牢加权击杀 W_g：由 dungeon-config 机械解析（新地牢/改配置自动重算） */
export function getWeightedKills(dungeonType) {
    return _analyzeDungeon(dungeonType).W;
}

/** 地牢战斗节点数（网格战斗 + 宝箱岔路 + Boss 房） */
export function getCombatNodeCount(dungeonType) {
    return _analyzeDungeon(dungeonType).combatNodeCount;
}

const _baseCache = new Map();
/** 地牢普通怪基础经验 base_g = (1-share) × 段成本 / (pacingRuns × exploreFactor × W_g)
 * （方案A：share 部分改按战斗节点清算，见 getRoomClearBonus） */
export function getDungeonExpBase(dungeonType) {
    const key = dungeonType || '_hub';
    if (_baseCache.has(key)) return _baseCache.get(key);
    const grade = getGradeForDungeon(dungeonType);
    const cfg = _cfg();
    const runs = cfg.pacingRuns ?? 5.0;
    const explore = cfg.exploreFactor ?? 0.8;
    const share = cfg.roomBonus?.share ?? 0;
    const base = (1 - share) * getBandCost(grade) / (runs * explore * getWeightedKills(dungeonType));
    _baseCache.set(key, base);
    return base;
}

/** 战斗节点清剿奖（开门时一次性发放）= share × 段成本 / (pacingRuns × exploreFactor × 战斗节点数) */
export function getRoomClearBonus(dungeonType) {
    const grade = getGradeForDungeon(dungeonType);
    const cfg = _cfg();
    const share = cfg.roomBonus?.share ?? 0;
    if (share <= 0) return 0;
    const runs = cfg.pacingRuns ?? 5.0;
    const explore = cfg.exploreFactor ?? 0.8;
    return (share * getBandCost(grade)) / (runs * explore * getCombatNodeCount(dungeonType));
}

/** 单场战斗节点经验预估（地图悬停显示用）：清剿奖 + 预估击杀经验（按 waveComposition 构成加权） */
export function getRoomExpEstimate(dungeonType, isElite = false) {
    const s = _analyzeDungeon(dungeonType);
    const base = getDungeonExpBase(dungeonType);
    const killExp = base * (isElite ? s.eliteFightW : s.normFightW);
    return Math.round(killExp + getRoomClearBonus(dungeonType));
}

/** 连战奖励倍率：第 startAt 连战起 +startBonus，每多 1 场 +stepBonus，封顶 cap */
export function getStreakMultiplier(streak) {
    const cfg = _cfg().combatStreak || {};
    const startAt = cfg.startAt ?? 3;
    if (streak < startAt) return 1;
    const startBonus = cfg.startBonus ?? 0.15;
    const stepBonus = cfg.stepBonus ?? 0.05;
    const cap = cfg.cap ?? 1.5;
    return Math.min(cap, 1 + startBonus + stepBonus * (streak - startAt));
}

/** 怪物有效等级：锚定 + 种间偏移（offset = 配置等级 - 3） */
export function getMonsterEffectiveLevel(monster, dungeonType) {
    const anchors = _cfg().anchors || { F: 3, E: 13, D: 28, C: 43, B: 58, A: 73 };
    const grade = getGradeForDungeon(dungeonType);
    const anchor = anchors[grade] ?? 3;
    const configLevel = monster?.level ?? monster?.data?.level ?? 3;
    return anchor + (configLevel - 3);
}

/** 等级差倍率（双向）：压级衰减（diff>grace 每级 -slope，下限 floor[rank]）
 *  + 越级加成（diff<-grace 每级 +underdog.slope，封顶 underdog.cap） */
export function getExpLevelMultiplier(playerLevel, monsterEffLevel, rank) {
    const cfg = _cfg();
    const d = cfg.decay || {};
    const grace = d.graceLevels ?? 5;
    const diff = (playerLevel ?? 1) - monsterEffLevel;
    if (diff > grace) {
        const slope = d.slope ?? 0.15;
        const floor = (d.floor && d.floor[rank]) ?? 0.01;
        return Math.max(floor, 1 - slope * (diff - grace));
    }
    const u = cfg.underdog || {};
    const uGrace = u.graceLevels ?? grace;
    if (diff < -uGrace) {
        const uSlope = u.slope ?? 0.10;
        const cap = u.cap ?? 1.5;
        return Math.min(cap, 1 + uSlope * (-diff - uGrace));
    }
    return 1;
}

/** 压级衰减倍率（旧名兼容，等价 getExpLevelMultiplier 的衰减方向） */
export function getExpDecayMultiplier(playerLevel, monsterEffLevel, rank) {
    return getExpLevelMultiplier(playerLevel, monsterEffLevel, rank);
}

/** 单怪经验明细（唯一入口）：base_g × rankMul × 等级差倍率；tag 供飘字标注 */
export function getMonsterExpDetail(monster, playerLevel, dungeonType) {
    const rank = monster?.rank || 'normal';
    const rankMul = (_cfg().rankMul && _cfg().rankMul[rank]) ?? 1;
    const base = getDungeonExpBase(dungeonType);
    const effLevel = getMonsterEffectiveLevel(monster, dungeonType);
    const mult = getExpLevelMultiplier(playerLevel, effLevel, rank);
    return {
        exp: Math.max(1, Math.floor(base * rankMul * mult)),
        mult,
        effLevel,
        tag: mult > 1 ? 'underdog' : (mult < 1 ? 'decay' : null),
    };
}

/** 单怪经验（唯一入口）：base_g × rankMul × 等级差倍率 */
export function getMonsterExp(monster, playerLevel, dungeonType) {
    return getMonsterExpDetail(monster, playerLevel, dungeonType).exp;
}
