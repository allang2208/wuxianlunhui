// ============================================================
// 世界-122 场景快照（2026-08-18，多世界并行 M0）
// 目标：离开世界-122 不再归零——离场捕获、入场恢复、主存档持久化。
//
// 口径（M0 冻结语义，M1 将在此基础上加后台时间结算）：
// - 只存"玩家建设 + 世界进度"：基地 HP、波次、玩家建筑（含读条/兵种/单位数）、矿点状态。
//   怪物/投射物/特效等 transient 一律不入快照；波次进行中离开 → 回场在 break 阶段重开本波。
// - 计时器按"剩余毫秒"冻结保存（dt 语义不变，回场原样续跑）。
// - 单位（矿工/兵种）只记兵种与存活数量，回场在建筑旁重新生成（全局升级等级自动生效）；
//   单位位置与战斗状态不保留。
// - 败北（defeated）不持久化：下次进入重新开局（与 roguelike 轮回口径一致）。
// ============================================================
// 不能在这里静态导入 Game / 建筑类：该模块会被 GameUIManager 在游戏启动阶段加载，
// 而建筑类继承 DamageableEntity，后者又依赖 Game，形成 TDZ 循环。
// 由 SceneManager.init() 在 Game 初始化完成后注入运行时依赖。
import { settleWorld122 } from './world122-sim.js'; // 纯数据结算（无 Game 依赖链），可静态导入

let Game = null;
let DefenseSystem = null;
let DefenseTower = null;
let DefenseCover = null;
let BuildableGate = null;
let FiringPlatform = null;
let DEFENSE_CONFIG = null;
let HamsterHutSystem = null;
let HamsterHut = null;
let HamsterBarracksSystem = null;
let HamsterBarracks = null;
let ProducerBuildingSystem = null;
let ProducerBuilding = null;
let getProducerConfig = null;
let EnergyNodeSystem = null;
let EnergyManager = null;
let ResearchSystem = null;
let GoldManager = null;

export function configureWorld122SnapshotRuntime(deps = {}) {
    ({
        Game,
        DefenseSystem,
        DefenseTower,
        DefenseCover,
        BuildableGate,
        FiringPlatform,
        DEFENSE_CONFIG,
        HamsterHutSystem,
        HamsterHut,
        HamsterBarracksSystem,
        HamsterBarracks,
        ProducerBuildingSystem,
        ProducerBuilding,
        getProducerConfig,
        EnergyNodeSystem,
        EnergyManager,
        ResearchSystem,
        GoldManager,
    } = deps);
}

const SNAPSHOT_VERSION = 1;

// 内存驻留：本局内离开 122 即捕获，重进恢复；主存档读写同一数据。
let _stored = null;

const _clone = (o) => JSON.parse(JSON.stringify(o));

/** 塔 DPS（实机口径入快照：武器伤害×模块×芯片已由 _recalcDamage 写入 attacks.config.damage） */
function _towerDps(t) {
    const cfg = t._attackKey && t.attacks ? t.attacks[t._attackKey]?.config : null;
    if (!cfg || !cfg.damage) return 0;
    const dmg = ((cfg.damage.min ?? 0) + (cfg.damage.max ?? 0)) / 2;
    const cd = cfg.cooldown > 0 ? cfg.cooldown : 0;
    return dmg > 0 && cd > 0 ? Math.round(dmg * 1000 / cd) : 0;
}

/** 军事单位合计 DPS（读存活单位 AI 实参，含全局升级生效值） */
function _unitsDps(units) {
    let sum = 0;
    for (const u of units || []) {
        if (!u || u.active === false || u._dying) continue;
        const dmg = u._ai?._attackDamage ?? 0;
        const interval = Math.max(300, u._ai?._attackInterval ?? 2000);
        sum += dmg * 1000 / interval;
    }
    return Math.round(sum);
}

/** 捕获当前世界-122 实况（要求 DefenseSystem.active，即玩家在 122 内） */
export function captureWorld122() {
    if (!DefenseSystem || !DefenseSystem.active) return null;
    if (DefenseSystem.defeated) return null; // 败北不持久化

    // 系统持有的建筑（小屋/兵营/产兵）单独遍历，实体表扫描时跳过防双计
    const systemOwned = new Set();
    for (const h of HamsterHutSystem.huts || []) systemOwned.add(h);
    for (const b of HamsterBarracksSystem.barracks || []) systemOwned.add(b);
    for (const p of ProducerBuildingSystem.buildings || []) systemOwned.add(p);

    const structures = [];
    const alive = (e) => e && e.active !== false && (e.hp === undefined || e.hp > 0);

    // ---- 防御侧：塔/方块墙/4格门/射击台（扫描实体表，仅玩家建造）----
    for (const e of Game.entities.values()) {
        if (!alive(e) || !e._builtByPlayer || systemOwned.has(e)) continue;
        if (e._isDefenseTower) {
            structures.push({
                kind: 'tower', x: e.x, y: e.y, hp: Math.ceil(e.hp),
                mirror: !!e._mirrored,
                chip: e.chip ? { ...e.chip } : null,
                modules: e.modules ? { ...e.modules } : {},
                weaponItem: e.weaponItem ? _clone(e.weaponItem) : null,
                dps: _towerDps(e),
                buildCost: e._buildCost ?? null, buildCurrency: e._buildCurrency ?? null,
            });
        } else if (e._isGate4 && e._buildGroupRoot === e) {
            // 4格门整组：门主体 + 石柱（整组回收口径的镜像）
            const pillars = (e._buildGroup || [])
                .filter((p) => p && p._isBlockCover && alive(p))
                .map((p) => ({ x: p.x, y: p.y, hp: Math.ceil(p.hp) }));
            structures.push({
                kind: 'gate4', x: e.x, y: e.y, hp: Math.ceil(e.hp),
                mirror: !!e.mirror, dir: e.mirror ? 'e1' : 'e2',
                pillars,
                buildCost: e._buildCost ?? null, buildCurrency: e._buildCurrency ?? null,
            });
        } else if (e._isBlockCover && !e._buildGroupRoot) {
            structures.push({
                kind: 'block', x: e.x, y: e.y, hp: Math.ceil(e.hp),
                grade: e.grade || 'C',
                buildCost: e._buildCost ?? null, buildCurrency: e._buildCurrency ?? null,
            });
        } else if (e._isFiringPlatform) {
            structures.push({
                kind: 'platform', x: e.x, y: e.y, hp: Math.ceil(e.hp),
                mirror: !!e._facingLeft,
                buildCost: e._buildCost ?? null, buildCurrency: e._buildCurrency ?? null,
            });
        }
    }

    // ---- 仓鼠矿场 ----
    for (const h of HamsterHutSystem.huts || []) {
        if (!alive(h)) continue;
        structures.push({
            kind: 'hut', x: h.x, y: h.y, hp: Math.ceil(h.hp),
            modules: { ...(h.modules || {}) },
            storedEnergy: h._storedEnergy || 0,
            miners: h.aliveMinerCount(),
            respawnTimer: h._respawnTimer || 0,
            rally: h._rallyPoint ? { x: h._rallyPoint.x, y: h._rallyPoint.y } : null,
            buildCost: h._buildCost ?? null, buildCurrency: h._buildCurrency ?? null,
        });
    }

    // ---- 仓鼠军营 ----
    for (const b of HamsterBarracksSystem.barracks || []) {
        if (!alive(b)) continue;
        structures.push({
            kind: 'barracks', x: b.x, y: b.y, hp: Math.ceil(b.hp),
            unitType: b.unitType, spawnTimer: b._spawnTimer,
            units: b.aliveUnitCount(), unitDps: _unitsDps(b.units),
            rally: b._rallyPoint ? { x: b._rallyPoint.x, y: b._rallyPoint.y } : null,
            buildCost: b._buildCost ?? null, buildCurrency: b._buildCurrency ?? null,
        });
    }

    // ---- 配置产兵/功能建筑（草屋/靶场/铁匠铺/研究院/仓库/教堂/传送门…）----
    for (const p of ProducerBuildingSystem.buildings || []) {
        if (!alive(p)) continue;
        structures.push({
            kind: 'producer', cfgKey: p.cfgKey, x: p.x, y: p.y, hp: Math.ceil(p.hp),
            unitType: p.unitType || '', spawnTimer: p._spawnTimer || 0,
            units: p.spawnEnabled ? p.aliveUnitCount() : 0,
            unitDps: p.spawnEnabled ? _unitsDps(p.units) : 0,
            upgrade: p._upgrade ? { abilityId: p._upgrade.abilityId, totalMs: p._upgrade.totalMs, remainMs: p._upgrade.remainMs } : null,
            continuous: p._continuous || null,
            storedEnergy: p._isEnergyWarehouse ? (p.storedEnergy || 0) : undefined,
            rally: p._rallyPoint ? { x: p._rallyPoint.x, y: p._rallyPoint.y } : null,
            buildCost: p._buildCost ?? null, buildCurrency: p._buildCurrency ?? null,
        });
    }

    // ---- 波次：进行中离开 → 回场在 break 阶段重开本波（不逐怪存档）----
    const spawnCfg = DEFENSE_CONFIG.spawn || {};
    let wave = {
        wave: DefenseSystem._wave || 0,
        phase: DefenseSystem._phase || 'prep',
        phaseTimer: DefenseSystem._phaseTimer ?? (spawnCfg.prepMs ?? 30000),
        victory: !!DefenseSystem.victory,
    };
    if (wave.phase === 'wave') {
        wave = { wave: wave.wave, phase: 'break', phaseTimer: spawnCfg.waveBreakMs ?? 10000, victory: false };
    }

    // ---- 基地核心 ----
    const base = DefenseSystem.base && DefenseSystem.base.active !== false
        ? { hp: Math.max(1, Math.ceil(DefenseSystem.base.hp)) }
        : null;

    // ---- 能源矿点（位置/余量/枯竭计时；位置每局随机，必须入快照）----
    const nodes = (EnergyNodeSystem.nodes || []).filter(alive).map((n) => ({
        x: n.x, y: n.y, hp: Math.ceil(n.hp), maxHp: n.maxHp,
        depleted: !!n._depleted, respawnTimer: n._respawnTimer || 0,
        variant: n._variant || 1,
    }));

    return {
        version: SNAPSHOT_VERSION,
        capturedAt: Date.now(),
        // 波次/结算参数随快照封存（后台结算与配置同生命周期，防版本间口径漂移）
        config: {
            prepMs: spawnCfg.prepMs ?? 30000,
            waveBreakMs: spawnCfg.waveBreakMs ?? 10000,
            victoryWave: spawnCfg.victoryWave ?? 10,
            victoryReward: spawnCfg.victoryReward || { gold: 500, energy: 500 },
            waveBudgetBase: spawnCfg.waveBudgetBase ?? 26,
            waveBudgetGrowth: spawnCfg.waveBudgetGrowth ?? 1.15,
            hpPerWave: spawnCfg.hpPerWave ?? 0.16,
            atkPerWave: spawnCfg.atkPerWave ?? 0.08,
        },
        base, wave, structures, nodes,
    };
}

/** 捕获并驻留内存（场景离场钩子调用） */
export function captureAndStoreWorld122() {
    const snap = captureWorld122();
    if (snap) _stored = snap;
    return snap;
}

/** 读取驻留快照（不消费） */
export function getWorld122Snapshot() {
    return _stored;
}

/** 清空快照（新游戏重置） */
export function resetWorld122Snapshot() {
    _stored = null;
}

/** 主存档序列化：在 122 内取实况，否则取驻留 */
export function serializeWorld122Scene() {
    if (DefenseSystem && DefenseSystem.active) {
        const live = captureWorld122();
        if (live) { _stored = live; return live; }
    }
    return _stored;
}

/** 主存档恢复：写入驻留（进入 122 时才真正物化） */
export function restoreWorld122Scene(data) {
    _stored = (data && data.version === SNAPSHOT_VERSION) ? data : null;
}

/** 世界切换面板预览：不回写快照、无全局副作用（commit=false）；
 *  玩家在 122 内或无快照时返回 null。 */
export function previewWorld122Report() {
    if (!_stored) return null;
    if (DefenseSystem && DefenseSystem.active) return null;
    const elapsed = Date.now() - (_stored.capturedAt || Date.now());
    if (elapsed < 1000) return null;
    return settleWorld122(_stored, elapsed, { commit: false });
}

// ==================== 恢复（_loadScene8 尾部调用） ====================

let _seq = 0;

function _markRestored(entity, entry) {
    entity._builtByPlayer = true;
    if (entry.buildCost != null) entity._buildCost = entry.buildCost;
    if (entry.buildCurrency) entity._buildCurrency = entry.buildCurrency;
    if (entry.hp != null) entity.hp = Math.min(entry.hp, entity.maxHp ?? entry.hp);
}

function _restoreTower(s) {
    const tower = new DefenseTower(s.x, s.y, { id: s.id || `built_tower_r${++_seq}` });
    _markRestored(tower, s);
    tower._mirrored = !!s.mirror;
    if (s.chip) Object.assign(tower.chip, s.chip);
    if (s.modules) tower.modules = { ...s.modules };
    if (s.weaponItem) tower.equipWeapon(_clone(s.weaponItem)); // 内部会按模块重算武器参数
    else if (typeof tower._applyModuleWeaponParams === 'function') tower._applyModuleWeaponParams();
    Game.entities.set(tower.id, tower);
    DefenseSystem.towers.push(tower);
}

function _restoreBlock(s) {
    const cover = new DefenseCover(s.x, s.y, {
        grade: s.grade || 'C', orient: 'v', mirror: false, block: true,
        id: s.id || `built_block_r${++_seq}`,
    });
    _markRestored(cover, s);
    Game.entities.set(cover.id, cover);
    return cover;
}

function _restoreGate4(s) {
    // 先石柱后门（与 _placeGate4 同序），整组回收链路重建
    const group = [];
    for (const p of s.pillars || []) {
        const cover = _restoreBlock({ kind: 'block', x: p.x, y: p.y, hp: p.hp, grade: 'C' });
        cover._buildCost = 0; // 石柱成本计入门主体
        group.push(cover);
    }
    const gate = new BuildableGate(s.x, s.y, {
        grade: 'D',                       // 视觉沿用已验收 D 级素材
        hp: DEFENSE_CONFIG.covers.hp.C ?? 1600,
        isGate4: true, orient: 'v', mirror: !!s.mirror, barCells: 2, barsOnly: true,
        id: s.id || `built_gate4_r${++_seq}`,
    });
    gate.grade = 'C';                     // 详情/数值显示 C 级
    _markRestored(gate, s);
    Game.entities.set(gate.id, gate);
    if (DefenseSystem.gates) DefenseSystem.gates.push(gate);
    group.push(gate);
    for (const part of group) {
        part._buildGroup = group;
        part._buildGroupRoot = gate;
    }
}

function _restorePlatform(s) {
    const platform = new FiringPlatform(s.x, s.y, {
        mirror: !!s.mirror, id: s.id || `built_platform_r${++_seq}`,
    });
    _markRestored(platform, s);
    Game.entities.set(platform.id, platform);
    if (DefenseSystem.platforms) DefenseSystem.platforms.push(platform);
}

function _restoreHut(s) {
    const hut = new HamsterHut(s.x, s.y, { id: s.id || `built_hut_r${++_seq}` });
    _markRestored(hut, s);
    hut.modules = { ...(s.modules || {}) };        // 先挂模块再补员，矿工吃到升级
    hut._storedEnergy = Math.max(0, s.storedEnergy || 0);
    if (s.rally) hut._rallyPoint = { x: s.rally.x, y: s.rally.y };
    Game.entities.set(hut.id, hut);
    HamsterHutSystem.huts.push(hut);
    const want = Math.max(0, Math.min(s.miners || 0, hut.minerCount()));
    for (let i = 0; i < want; i++) hut.spawnMiner();
    // 仍有缺员时按原剩余时间续跑补员计时
    if (hut.aliveMinerCount() < hut.minerCount()) hut._respawnTimer = Math.max(0, s.respawnTimer || 0);
}

function _restoreBarracks(s) {
    const barracks = new HamsterBarracks(s.x, s.y, { id: s.id || `built_barracks_r${++_seq}` });
    _markRestored(barracks, s);
    if (!['warrior', 'guard'].includes(s.unitType)) s.unitType = 'warrior'; // 旧档纠偏
    barracks.unitType = s.unitType;
    barracks._spawnTimer = Math.max(0, s.spawnTimer || 0);
    if (s.rally) barracks._rallyPoint = { x: s.rally.x, y: s.rally.y };
    Game.entities.set(barracks.id, barracks);
    HamsterBarracksSystem.barracks.push(barracks);
    const want = Math.max(0, Math.min(s.units || 0, barracks.unitCount()));
    for (let i = 0; i < want; i++) barracks.spawnUnit();
}

function _restoreProducer(s) {
    const cfg = getProducerConfig(s.cfgKey);
    if (!cfg) return; // 配置已移除的建筑跳过（版本兼容）
    const producer = new ProducerBuilding(s.x, s.y, { id: s.id || `built_${s.cfgKey}_r${++_seq}`, cfgKey: s.cfgKey });
    _markRestored(producer, s);
    if ((cfg.unitTypes || []).some((t) => t.key === s.unitType)) producer.unitType = s.unitType;
    producer._spawnTimer = Math.max(0, s.spawnTimer || 0);
    if (s.rally) producer._rallyPoint = { x: s.rally.x, y: s.rally.y };
    // 能力/研究读条续跑（等级全局共享，读条属建筑实例）
    if (s.upgrade && cfg.abilities && cfg.abilities[s.upgrade.abilityId]) {
        producer._upgrade = {
            abilityId: s.upgrade.abilityId,
            totalMs: Math.max(1, s.upgrade.totalMs || 1),
            remainMs: Math.max(0, s.upgrade.remainMs || 0),
        };
        producer._continuous = s.continuous && cfg.abilities[s.continuous] ? s.continuous : null;
    }
    Game.entities.set(producer.id, producer);
    ProducerBuildingSystem.buildings.push(producer);
    // 仓库：构造时已向 EnergyManager 注册（pending 能源会先行灌入），此处按快照覆盖回本仓原量
    if (producer._isEnergyWarehouse && s.storedEnergy != null && EnergyManager) {
        producer.storedEnergy = Math.max(0, Math.min(producer.storageCapacity || 0, Math.floor(s.storedEnergy)));
    }
    if (producer.spawnEnabled) {
        const want = Math.max(0, Math.min(s.units || 0, producer.unitCount()));
        for (let i = 0; i < want; i++) producer.spawnUnit();
    }
}

/** 入场恢复（各系统 setup 完成后调用；无快照或版本不符则跳过）。
 *  M1：先按离场时长做后台抽象结算（settleWorld122），再物化；
 *  返回 false（未恢复）/ 结算报告对象（含 report；defeated 时快照作废）。 */
export function applyWorld122Snapshot(snap = _stored) {
    if (!snap || snap.version !== SNAPSHOT_VERSION) return false;
    if (!DefenseSystem || !DefenseSystem.active) return false;

    // ---- M1 后台结算（离场 >1s 才结算，避免同场秒切空跑）----
    const elapsed = Date.now() - (snap.capturedAt || Date.now());
    let report = null;
    if (elapsed > 1000) {
        report = settleWorld122(snap, elapsed, {
            commit: true,
            grant: (reward) => {
                if (reward.energy && EnergyManager) EnergyManager.depositEnergy(reward.energy);
                if (reward.gold && GoldManager && typeof GoldManager.addGold === 'function') GoldManager.addGold(reward.gold);
            },
        });
        if (report.defeated) {
            _stored = null; // 后台失守：快照作废，世界重新开局（与 M0 败北口径一致）
            return { defeated: true, report };
        }
        // 结算后仍进行中的波次重开（实体不留档，M0 口径）
        if (snap.wave && snap.wave.phase === 'wave') {
            snap.wave.phase = 'break';
            snap.wave.phaseTimer = (DEFENSE_CONFIG?.spawn?.waveBreakMs ?? 10000);
        }
    }

    // 基地核心血量
    if (snap.base && DefenseSystem.base) {
        DefenseSystem.base.hp = Math.max(1, Math.min(snap.base.hp, DefenseSystem.base.maxHp));
        if (DefenseSystem.base.data) DefenseSystem.base.data.hp = DefenseSystem.base.hp;
    }

    // 波次状态
    if (snap.wave) {
        DefenseSystem._wave = snap.wave.wave || 0;
        DefenseSystem._phase = snap.wave.phase || 'prep';
        DefenseSystem._phaseTimer = Math.max(0, snap.wave.phaseTimer || 0);
        if (snap.wave.victory) {
            DefenseSystem.victory = true;
            DefenseSystem._victoryGranted = true; // 奖励已在结算时发放，回场不重复
        }
    }

    // 玩家建筑（顺序：墙/门/台/塔先行，产兵建筑随后——单位出生校验依赖墙体碰撞已注册）
    let restored = 0;
    for (const s of snap.structures || []) {
        if (!(s.hp > 0)) continue; // 后台战斗被毁建筑不复活
        try {
            if (s.kind === 'tower') _restoreTower(s);
            else if (s.kind === 'block') _restoreBlock(s);
            else if (s.kind === 'gate4') _restoreGate4(s);
            else if (s.kind === 'platform') _restorePlatform(s);
            else if (s.kind === 'hut') _restoreHut(s);
            else if (s.kind === 'barracks') _restoreBarracks(s);
            else if (s.kind === 'producer') _restoreProducer(s);
            else continue;
            restored++;
        } catch (err) {
            console.error('[World122Snapshot] 建筑恢复失败:', s.kind, err);
        }
    }

    // 能源矿点（快照含位置，不走随机重铺）
    if (Array.isArray(snap.nodes) && snap.nodes.length > 0
        && typeof EnergyNodeSystem.restoreNodes === 'function') {
        EnergyNodeSystem.restoreNodes(snap.nodes);
    }

    // 研究 HP 对新建结构兜底刷新（构造时已各自 applyResearchHp，这里防漏）
    if (ResearchSystem && typeof ResearchSystem.refreshWorld === 'function') {
        ResearchSystem.refreshWorld();
    }
    return { restored: restored > 0, report };
}
