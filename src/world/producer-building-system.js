// ============================================================
// 通用产兵建筑（世界-122，2026-08-17）
// - 配置驱动：出兵时间 / 出品种类 / 造价 / 显示尺寸 / 升级模块全部读
//   data/producer-buildings.json（唯一真源），换建筑只需改配置 + 贴图；
// - 逻辑参考仓鼠兵营（hamster-barracks-system.js）：每 spawnIntervalMs
//   生成一个军事单位；单位类型面板可切换；模块升级同步现有单位；
// - 单位基准值沿用 data/hamster-*-config.json（与兵营同源）。
// ============================================================
import { Game } from '../game.js';
import { DamageableEntity } from '../entities/damageable-entity.js';
import { HamsterWarrior } from '../entities/hamster-warrior.js';
import { HamsterShooter } from '../entities/hamster-shooter.js';
import { HamsterGuard } from '../entities/hamster-guard.js';
import { HamsterMilitia } from '../entities/hamster-militia.js';
import { HamsterScout } from '../entities/hamster-scout.js';
import { HamsterMusketeer } from '../entities/hamster-musketeer.js';
import { HamsterPriest } from '../entities/hamster-priest.js';
import { HamsterKnight } from '../entities/hamster-knight.js';
import { HamsterLightCavalry } from '../entities/hamster-light-cavalry.js';
import { HamsterExplorer } from '../entities/hamster-explorer.js';
import { HamsterBountyHunter } from '../entities/hamster-bounty-hunter.js';
import { JaguarWarrior } from '../entities/jaguar-warrior.js';
import { JunglePriest } from '../entities/jungle-priest.js';
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { BuildingSinkEffect } from '../effects/building-sink.js';
import { SoundManager } from '../ui/sound-manager.js';
import { BasePanel } from '../ui/panels/base-panel.js';
import { renderBuildingDetailHeader } from '../ui/panels/building-detail-header.js';
import { renderBuildingUpgradeCard, renderBuildingUpgradeIcon } from '../ui/panels/building-upgrade-card.js';
import { mountRightSidebarPanel } from '../ui/right-sidebar-panel-layer.js';
import { TechnologyGate } from '../ui/technology-gate.js';
import {
    ensureBuildingUpgradeTooltip,
    hideBuildingUpgradeTooltip,
    moveBuildingUpgradeTooltip,
    showBuildingUpgradeTooltip,
} from '../ui/panels/building-upgrade-tooltip.js';
import { SceneManager } from './scene-manager.js';
import { WorldProgressionSystem } from './world-progression-system.js';
import { WallSystem } from './wall-system.js';
import { setupStructureDepth } from './structure-depth.js';
import { BUILDING_FOUNDATION_CONFIG } from './building-footprint.js';
import { Renderer } from './renderer.js';
import producerBuildings from '../../data/producer-buildings.json';
import warriorCfg from '../../data/hamster-warrior-config.json';
import shooterCfg from '../../data/hamster-shooter-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import militiaCfg from '../../data/hamster-militia-config.json';
import scoutCfg from '../../data/hamster-scout-config.json';
import musketeerCfg from '../../data/hamster-musketeer-config.json';
import priestCfg from '../../data/hamster-priest-config.json';
import knightCfg from '../../data/hamster-knight-config.json';
import lightCavalryCfg from '../../data/hamster-light-cavalry-config.json';
import explorerCfg from '../../data/hamster-explorer-config.json';
import bountyHunterCfg from '../../data/hamster-bounty-hunter-config.json';
import jaguarWarriorCfg from '../../data/jaguar-warrior-config.json';
import junglePriestCfg from '../../data/jungle-priest-config.json';
import {
    applyGlobalUpgradesToKind,
    applyUnitUpgradePatch,
    getUpgradeMultsFromLevels,
    getUnitUpgradeLevel,
    getUnitUpgradeMults,
    getUnitUpgradePatch,
    getUnitKind,
    raiseUnitUpgradeLevel,
} from './unit-upgrade-store.js';
import { getAbilityLevel, getAbilityValue, raiseAbilityLevel } from './ability-store.js';
import {
    DEFAULT_BUILDING_UPGRADE_TIME_MS, getBuildingModuleUpgradeCost, getUpgradeModulesForUnitKind,
    isBuildingUpgradeProgressOccupied, resolveBuildingUpgradeProject,
} from './building-upgrade-projects.js';
import { ResearchSystem } from './research-system.js';
import { applyBuildingFootprint } from './building-footprint.js';
import { SpawnPlacement } from './spawn-placement.js';
import { RECRUIT_MODE, normalizeRecruitMode, recruitModeLabel, recruitStatusText } from './recruit-mode.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TroopLineSystem } from './troop-line-system.js';
import { isInfiniteResourcesEnabled } from '../config/dev-cheats.js';
import { TechnologySystem } from './technology-system.js';
import { hasBackgroundBuildingUpgrade } from './world122-snapshot.js';
import { PopulationEconomySystem, populationEconomyConfig } from './population-economy-system.js';
import { HamsterFarmerVisualSystem } from './hamster-farmer-visual-system.js';
import { HamsterBankerVisualSystem } from './hamster-banker-visual-system.js';
import { WorkshopEconomySystem } from './workshop-economy-system.js';
import { BankEconomySystem } from './bank-economy-system.js';
import { WarehouseEconomySystem } from './warehouse-economy-system.js';
import { CrossPlaneResourceSystem } from './cross-plane-resource-system.js';
import { World122TributeSystem } from './world122-tribute-system.js';
import { getRecruitCountMul } from '../config/tribute-effects.js';

const ABILITY_TARGET_NAMES = Object.freeze({
    warrior: '仓鼠战士',
    shooter: '仓鼠射手',
    guard: '仓鼠盾卫',
    militia: '仓鼠民兵',
    scout: '仓鼠斥候',
    musketeer: '仓鼠火枪',
    priest: '仓鼠牧师',
    knight: '仓鼠骑士',
    light_cavalry: '仓鼠轻骑',
    explorer: '仓鼠探险家',
    bounty_hunter: '仓鼠赏金猎人',
    jaguar_warrior: '美洲豹战士',
    jungle_priest: '丛林祭司',
});

function moduleAppliesToUnit(module, unitType) {
    return !Array.isArray(module?.unitKinds) || module.unitKinds.includes(unitType);
}

function cloneProducerRuntimeConfig(cfg) {
    return {
        ...cfg,
        shadowCaster: cfg.shadowCaster ? {
            ...cfg.shadowCaster,
            contactPolygon: (cfg.shadowCaster.contactPolygon || []).map((point) => (
                Array.isArray(point) ? [...point] : { ...point }
            )),
            parts: (cfg.shadowCaster.parts || []).map((part) => ({
                ...part,
                polygon: (part.polygon || []).map((point) => (
                    Array.isArray(point) ? [...point] : { ...point }
                )),
            })),
        } : undefined,
        unitTypes: (cfg.unitTypes || []).map((unit) => ({ ...unit })),
        modules: Object.fromEntries(
            Object.entries(cfg.modules || {}).map(([key, module]) => [key, { ...module }])
        ),
        abilities: Object.fromEntries(
            Object.entries(cfg.abilities || {}).map(([key, ability]) => [key, { ...ability }])
        ),
        destinations: (cfg.destinations || []).map((destination) => ({ ...destination })),
    };
}

/** 建筑结构数据与独立升级项目合并后的运行时配置。 */
export const PRODUCER_BUILDINGS = Object.fromEntries(
    Object.entries(producerBuildings).map(([key, cfg]) => [key, resolveBuildingUpgradeProject(cfg)])
);

/** 单位 key → 基准配置（data/hamster-*-config.json，与仓鼠兵营同源） */
const PRODUCER_UNIT_CFG = {
    warrior: warriorCfg,
    shooter: shooterCfg,
    guard: guardCfg,
    militia: militiaCfg,
    scout: scoutCfg,
    musketeer: musketeerCfg,
    priest: priestCfg,
    knight: knightCfg,
    light_cavalry: lightCavalryCfg,
    explorer: explorerCfg,
    bounty_hunter: bountyHunterCfg,
    jaguar_warrior: jaguarWarriorCfg,
    jungle_priest: junglePriestCfg,
};

/** 单位 key → 实体类 */
const PRODUCER_UNIT_CLASS = {
    warrior: HamsterWarrior,
    shooter: HamsterShooter,
    guard: HamsterGuard,
    militia: HamsterMilitia,
    scout: HamsterScout,
    musketeer: HamsterMusketeer,
    priest: HamsterPriest,
    knight: HamsterKnight,
    light_cavalry: HamsterLightCavalry,
    explorer: HamsterExplorer,
    bounty_hunter: HamsterBountyHunter,
    jaguar_warrior: JaguarWarrior,
    jungle_priest: JunglePriest,
};

/** 跨位面增援的统一军事单位工厂；不归属任何当地生产建筑。 */
export function createMilitaryUnit(kind, x, y, options = {}) {
    const UnitClass = PRODUCER_UNIT_CLASS[kind];
    const base = PRODUCER_UNIT_CFG[kind];
    if (!UnitClass || !base) return null;
    const patch = getUnitUpgradePatch(kind, getUpgradeModulesForUnitKind(kind));
    const baseAi = base.ai || {};
    const ai = {
        ...baseAi,
        attackInterval: patch.attackInterval,
        attackDamage: patch.attackDamage,
        attackRange: patch.attackRange,
        castRange: patch.castRange,
        walkSpeed: patch.walkSpeed,
        holyLightCooldownMult: patch.holyLightCooldownMult,
        holyLightLevel: patch.holyLightLevel,
        chargeDamageMult: patch.chargeDamageMult,
        holyLightRangeBonus: patch.holyLightRangeBonus,
        titheEnergyPerTick: patch.titheEnergyPerTick,
        titheIntervalMs: patch.titheIntervalMs,
    };
    const unit = new UnitClass(x, y, {
        id: options.id,
        ai,
        baseMaxHp: patch.baseMaxHp,
    });
    applyUnitUpgradePatch(unit, patch);
    const hpRatio = Math.max(0.01, Math.min(1, Number(options.hpRatio) || 1));
    if (unit.data) unit.data.hp = Math.max(1, Math.round((unit.data.maxHp || patch.baseMaxHp) * hpRatio));
    return unit;
}

/** 后台驻军结算使用的配置化战斗档案；与前台实体读取同一兵种/升级真源。 */
export function getMilitaryUnitProfile(kind) {
    const base = PRODUCER_UNIT_CFG[kind];
    if (!base) return null;
    const patch = getUnitUpgradePatch(kind, getUpgradeModulesForUnitKind(kind));
    const damage = Math.max(0, Number(patch.attackDamage ?? base.ai?.attackDamage) || 0);
    const interval = Math.max(300, Number(patch.attackInterval ?? base.ai?.attackInterval) || 2000);
    return {
        maxHp: Math.max(1, Number(patch.baseMaxHp ?? base.baseMaxHp) || 1),
        dps: kind === 'explorer' ? 0 : damage * 1000 / interval,
    };
}

export function getProducerConfig(key) {
    return PRODUCER_BUILDINGS[key] || null;
}

/** 模块升级费用（统一）：升级费用从配置读 */
export function getProducerModuleCost(cfg, moduleId, _currentLevel) {
    return getBuildingModuleUpgradeCost(cfg, moduleId, _currentLevel);
}

/** 面板用：模块当前/下一级描述文本 */
export function getProducerModuleDesc(cfg, moduleId, level) {
    const mod = cfg?.modules?.[moduleId];
    if (!mod) return '';
    const pct = Math.abs(mod.per) * 100;
    const pctAt = (atLevel) => Number((pct * atLevel).toFixed(1)).toString();
    const fill = (atLevel) => (mod.desc || '')
        .replace('{pct}', pctAt(atLevel))
        .replace('{value}', `${Math.round(mod.per * atLevel)}`)
        .replace('{level}', `${(mod.base ?? 0) + Math.round(mod.per * atLevel)}`)
        .replace('{tickSeconds}', `${Math.round((mod.tickMs ?? 0) / 1000)}`);
    return {
        current: fill(level),
        next: fill(level + 1),
    };
}

/** 当前模块倍率表 */
export function getProducerMults(cfg, modules) {
    return getUpgradeMultsFromLevels(cfg?.modules, modules);
}

// ==================== 产兵建筑实体 ====================

export class ProducerBuilding extends DamageableEntity {
    constructor(x, y, config = {}) {
        const sourceCfg = getProducerConfig(config.cfgKey);
        if (!sourceCfg) throw new Error(`producer-building: 未知配置 ${config.cfgKey}`);
        // 每栋建筑持有独立运行时配置副本，禁止面板选择或后续扩展误写共享模板后串联同类建筑。
        const cfg = cloneProducerRuntimeConfig(sourceCfg);
        const hp = config.hp ?? cfg.hp;
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: cfg.displayW,
            collisionRadius: cfg.radius,
            name: config.name ?? cfg.name,
        });
        this.cfgKey = config.cfgKey;
        this._cfg = cfg;
        this.id = config.id || `${cfg.id}_${Math.random().toString(36).slice(2, 8)}`;
        this._isProducerBuilding = true;
        this._isWorld122TributeAltar = cfg.panelMode === 'tribute';
        this._isDefenseStructure = true;
        this.noSeparation = true;
        this.immovable = true;
        this._noShadow = true;
        this.def = cfg.def;
        this.mdef = cfg.mdef;
        this.spriteCfg = {
            idleKey: cfg.tex,
            size: cfg.displayW,
            sizeH: cfg.displayH,
            footOffsetY: cfg.footOffsetY,
            // Per-asset correction applied after alpha-ground fitting.  This
            // keeps the logical 2x2 footprint fixed while compensating for a
            // visible plinth thickness or an asymmetric generated canvas.
            anchorAdjustX: Number(cfg.anchorAdjustX) || 0,
            anchorAdjustY: Number(cfg.anchorAdjustY) || 0,
            foundation: cfg.foundation === false ? null : {
                ...BUILDING_FOUNDATION_CONFIG,
                ...(cfg.foundation || {}),
            },
            // 统一贴图后默认固定标准2×2；仅未来明确声明 true 的异形建筑允许像素拟合物理体。
            autoFootprint: cfg.autoFootprint === true,
            // 阴影投射体只影响视觉，不参与建造占格、碰撞或寻路。
            shadowCaster: cfg.shadowCaster,
        };
        this.footOffsetY = cfg.footOffsetY;
        applyBuildingFootprint(this, 2);
        setupStructureDepth(this);
        this.level = 1;
        this.maxLevel = 10;
        this.modules = {};            // { moduleId: level }
        const configuredUnitType = cfg.defaultUnitType || (cfg.unitTypes?.[0]?.key) || 'shooter';
        const firstUnlockedUnitType = (cfg.unitTypes || []).find((unit) =>
            TechnologySystem.isUnlocked('unit', unit.key))?.key;
        this.unitType = TechnologySystem.isUnlocked('unit', configuredUnitType)
            ? configuredUnitType
            : (firstUnlockedUnitType || configuredUnitType);
        this.units = [];              // 本建筑拥有的军事单位
        this._unitSeq = 0;
        this._spawnTimer = 0;
        this._baseSpawnIntervalMs = cfg.spawnIntervalMs;
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        this._spawnFoodBlocked = false;
        this.spawnEnabled = cfg.spawnEnabled !== false; // 铁匠铺等能力建筑不产兵
        this._isTroopProducer = this.spawnEnabled && (cfg.unitTypes || []).some((unit) => !!unit?.key);
        this._recruitMode = RECRUIT_MODE.PAUSED;
        this._parallelProduction = cfg.parallelProduction === true;
        this._parallelQueues = {};
        if (this._parallelProduction) {
            for (const unit of cfg.unitTypes || []) {
                if (!unit?.key) continue;
                this._parallelQueues[unit.key] = {
                    recruitMode: RECRUIT_MODE.PAUSED,
                    timer: 0,
                    retryTimer: 0,
                    blocked: false,
                    foodBlocked: false,
                };
                this._parallelQueues[unit.key].timer = this.recruitIntervalMs(unit.key);
            }
        }
        if (this.spawnEnabled) this._spawnTimer = this.recruitIntervalMs();
        this._upgrade = null;         // 升级读条：abilityId 或 unitType + moduleId
        this._continuous = null;      // 持续升级的能力 id（资源足够自动续升）
        this._isEnergyWarehouse = cfg.workshopType === 'warehouse';
        WarehouseEconomySystem.initializeBuilding(this, config);
        if (this._isEnergyWarehouse && EnergyManager) {
            this.storedEnergy = 0;
            this.storedFood = 0;
            EnergyManager.registerWarehouse(this, this.storageCapacity ?? cfg.storageCapacity ?? 5000);
        }
        PopulationEconomySystem.initializeBuilding(this, config);
        BankEconomySystem.initializeBuilding(this, config);
        WorkshopEconomySystem.initializeBuilding(this, config);
        this.rebuildCollider();
    }

    /** 当前兵种全局倍率（2026-08-17 起按兵种全局共享，不再按建筑实例） */
    mults(kind = this.unitType) {
        return getUnitUpgradeMults(kind, this._cfg.modules);
    }

    /** 目标军事单位数量：配置 unitCap（初始即有，无需升级） */
    unitCount() {
        if (this._parallelProduction) {
            return (this._cfg.unitTypes || []).reduce((sum, unit) =>
                sum + Math.max(0, Math.floor(Number(unit.unitCap) || 0)), 0);
        }
        return this._cfg.unitCap ?? 5;
    }

    /** 当前存活单位数 */
    aliveUnitCount(kind = null) {
        if (kind) {
            return this.units.filter((unit) => unit?.active !== false && !unit?._dying
                && getUnitKind(unit) === kind).length;
        }
        return TroopLineSystem.countAssignedToProducer(this);
    }

    /** 配置里该单位 key 的展示名 */
    unitName(key) {
        const u = (this._cfg.unitTypes || []).find((t) => t.key === key);
        return u ? u.name : key;
    }

    /** 当前兵种生产周期：unitTypes 条目可按兵种覆盖 spawnIntervalMs，缺省用建筑级配置（2026-08-18） */
    _unitSpawnIntervalMs(kind = this.unitType) {
        const u = (this._cfg.unitTypes || []).find((t) => t.key === kind);
        return (u && Number.isFinite(u.spawnIntervalMs)) ? u.spawnIntervalMs : this._baseSpawnIntervalMs;
    }

    _unitSpawnFoodCost(kind = this.unitType) {
        const unit = (this._cfg.unitTypes || []).find((entry) => entry.key === kind);
        return Math.max(0, Math.floor(Number(unit?.spawnFoodCost) || 0));
    }

    /** 切换生成的单位类型；下一次生成生效（key 必须在配置 unitTypes 里）。
     *  2026-08-18：切换兵种重新计时——按新兵种周期从头读条（原来保留计时且同建筑各兵种同周期）；
     *  切换为当前兵种视为无操作（返回 false，不打断计时、不发通知）。 */
    setUnitType(type) {
        if (!(this._cfg.unitTypes || []).some((t) => t.key === type)) return false;
        if (!TechnologySystem.isUnlocked('unit', type)) return false;
        if (type === this.unitType) return false;
        this.unitType = type;
        this._spawnTimer = this.recruitIntervalMs();
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        return true;
    }

    setRecruitMode(mode) {
        if (!this._isTroopProducer) return { ok: false, reason: '该建筑不能招募单位' };
        const next = normalizeRecruitMode(mode);
        if (next === RECRUIT_MODE.SINGLE) {
            if (this.aliveUnitCount() >= this.unitCount()) return { ok: false, reason: '单位数量已达上限' };
            const cost = CrossPlaneResourceSystem.quote({ food: this._unitSpawnFoodCost() }).food;
            if (cost > 0 && !isInfiniteResourcesEnabled()
                && CrossPlaneResourceSystem.getAvailable('food') < cost) {
                return { ok: false, reason: `粮食不足，单次招募需要 ${cost} 粮食` };
            }
        }
        this._recruitMode = next;
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        this._spawnFoodBlocked = false;
        if (next === RECRUIT_MODE.SINGLE || !(this._spawnTimer > 0)) {
            this._spawnTimer = this.recruitIntervalMs();
        } else if (next === RECRUIT_MODE.CONTINUOUS) {
            this._spawnTimer = Math.min(this._spawnTimer, this.recruitIntervalMs());
        }
        return { ok: true, mode: next };
    }

    parallelUnitCap(kind) {
        const unit = (this._cfg.unitTypes || []).find((entry) => entry.key === kind);
        return Math.max(0, Math.floor(Number(unit?.unitCap) || 0));
    }

    setParallelRecruitMode(kind, mode) {
        const queue = this._parallelQueues?.[kind];
        if (!this._parallelProduction || !queue) return { ok: false, reason: '未知生产通道' };
        const next = normalizeRecruitMode(mode);
        if (next === RECRUIT_MODE.SINGLE) {
            if (this.aliveUnitCount(kind) >= this.parallelUnitCap(kind)) return { ok: false, reason: '该单位数量已达上限' };
            const cost = CrossPlaneResourceSystem.quote({ food: this._unitSpawnFoodCost(kind) }).food;
            if (cost > 0 && !isInfiniteResourcesEnabled()
                && CrossPlaneResourceSystem.getAvailable('food') < cost) {
                return { ok: false, reason: `粮食不足，单次招募需要 ${cost} 粮食` };
            }
        }
        queue.recruitMode = next;
        queue.retryTimer = 0;
        queue.blocked = false;
        queue.foodBlocked = false;
        if (next === RECRUIT_MODE.SINGLE || !(queue.timer > 0)) queue.timer = this.recruitIntervalMs(kind);
        return { ok: true, mode: next, kind };
    }

    /** 固定出口槽位：墙体、建筑 footprint、动态单位与出口预约全部通过才返回。 */
    _findUnitSpawn() {
        const sourceSceneId = SceneManager.currentScene;
        return SpawnPlacement.findAndReserve(this, {
            unitRadius: 24,
            entities: Game?.entities,
            wallSystem: WallSystem,
            preferredTarget: TroopLineSystem.getSpawnDirectionTarget(sourceSceneId, this),
        });
    }

    /** 生成一个军事单位（当前 unitType），应用模块倍率 */
    spawnUnit(payFood = false, options = {}) {
        if (!Game || !Game.entities) return null;
        if (!TechnologySystem.isUnlocked('unit', this.unitType)) return null;
        const unitCfg = PRODUCER_UNIT_CFG[this.unitType];
        const UnitClass = PRODUCER_UNIT_CLASS[this.unitType];
        if (!unitCfg || !UnitClass) return null;
        const base = unitCfg || {};
        const baseAi = base.ai || {};
        const mults = this.mults();
        const spot = this._findUnitSpawn();
        if (!spot) return null;
        const spawnCost = this._unitSpawnFoodCost();
        if (payFood && spawnCost > 0 && !isInfiniteResourcesEnabled()
            && !CrossPlaneResourceSystem.pay({ food: spawnCost }).ok) {
            this._spawnFoodBlocked = true;
            return null;
        }
        this._spawnFoodBlocked = false;
        const id = `${this.id}_unit_${++this._unitSeq}`;
        const ai = {
            ...baseAi,
            attackInterval: Math.max(300, Math.round((baseAi.attackInterval ?? 2000) * mults.attackIntervalMult)),
            attackDamage: Math.max(1, Math.round((baseAi.attackDamage ?? 50) * mults.attackDamageMult)),
            attackRange: Math.max(0, Math.round((baseAi.attackRange ?? 0) + mults.attackRangeBonus)),
            castRange: Math.max(0, Math.round((baseAi.castRange ?? 0) + mults.holyLightRangeBonus)),
            walkSpeed: Math.max(20, Math.round((baseAi.walkSpeed ?? 120) * mults.moveSpeedMult)),
            holyLightCooldownMult: mults.holyLightCooldownMult,
            holyLightLevel: mults.holyLightLevel,
            chargeDamageMult: mults.chargeDamageMult,
            holyLightRangeBonus: mults.holyLightRangeBonus,
            titheEnergyPerTick: mults.titheEnergyPerTick,
            titheIntervalMs: Number(Object.values(this._cfg.modules || {}).find(
                (module) => module?.effect === 'titheEnergyPerTick'
            )?.tickMs) || 0,
        };
        const baseMaxHp = Math.max(1, Math.round((base.baseMaxHp ?? 300) * mults.hpMult));
        const unit = new UnitClass(spot.x, spot.y, { id, ai, baseMaxHp });
        if (this.unitType === 'priest' && Number.isFinite(this._restoredTitheTimer)
            && unit._ai && '_titheTimer' in unit._ai) {
            unit._ai._titheTimer = Math.max(0, this._restoredTitheTimer);
        }
        applyUnitUpgradePatch(unit, getUnitUpgradePatch(this.unitType, this._cfg.modules));
        if (this.unitType === 'explorer' && Array.isArray(this._restoreExplorerRuns)
            && this._restoreExplorerRuns.length > 0) {
            const run = this._restoreExplorerRuns.shift();
            unit._command = { mode: 'explore' };
            unit._ai?.restoreExploration?.(run);
        }
        unit._barracks = this;
        unit._spawnEgress = { x: spot.egressX, y: spot.egressY };
        this.units.push(unit);
        Game.entities.set(id, unit);
        if (Array.isArray(Game.friendlyUnits)) Game.friendlyUnits.push(unit);
        TroopLineSystem.onUnitProduced(
            unit,
            this,
            options.sourceSceneId || SceneManager.currentScene,
            options
        );
        // 双身翡翠神像「双身」（2026-08-22 工艺品祭品）：每次出兵数量 ×N，额外单位不再收取食物
        if (!options._noRecruitMul) {
            const recruitMul = Math.max(1, Math.floor(getRecruitCountMul()));
            for (let extra = 1; extra < recruitMul; extra++) {
                this.spawnUnit(false, { ...options, _noRecruitMul: true });
            }
        }
        return unit;
    }

    spawnUnitFor(kind, payFood = false, options = {}) {
        const selected = this.unitType;
        this.unitType = kind;
        const unit = this.spawnUnit(payFood, options);
        this.unitType = selected;
        return unit;
    }

    /** 把该兵种全局升级同步给场景内所有该兵种单位（2026-08-17 起跨建筑全局生效） */
    applyUpgradesToUnits() {
        applyGlobalUpgradesToKind(this.unitType, this._cfg.modules);
    }

    /** 模块是否可升级（未满级即可） */
    canUpgradeModule(moduleId) {
        const mod = this._cfg.modules?.[moduleId];
        if (!mod || !moduleAppliesToUnit(mod, this.unitType)) return false;
        return getUnitUpgradeLevel(this.unitType, moduleId) < mod.maxLevel;
    }

    getModuleCost(moduleId) {
        return getProducerModuleCost(this._cfg, moduleId, getUnitUpgradeLevel(this.unitType, moduleId));
    }

    /** 能力配置（铁匠铺专属，2026-08-17） */
    getAbility(abilityId) {
        return (this._cfg.abilities || {})[abilityId] || null;
    }

    /** 能力当前全局等级 */
    abilityLevel(abilityId) {
        return getAbilityLevel(abilityId);
    }

    /** 能力是否可升级（存在且未满级） */
    canUpgradeAbility(abilityId) {
        const a = this.getAbility(abilityId);
        if (!a) return false;
        return this.abilityLevel(abilityId) < (a.maxLevel ?? 10);
    }

    /**
     * 能力升级资源/读条公式（2026-08-17）：
     * 金币 = goldBase × goldGrowth^lv；能源 = energyBase × energyGrowth^lv；
     * 读条 = timeBaseMs + timeGrowthMs × lv（lv = 当前等级，下一级费用）。
     */
    getAbilityCost(abilityId) {
        const a = this.getAbility(abilityId);
        if (!a) return null;
        const lv = this.abilityLevel(abilityId);
        const c = this._cfg.abilityUpgrade || {};
        return {
            gold: Math.round((c.goldBase ?? 150) * Math.pow(c.goldGrowth ?? 1.3, lv)),
            energy: Math.round((c.energyBase ?? 200) * Math.pow(c.energyGrowth ?? 1.35, lv)),
            timeMs: (c.timeBaseMs ?? DEFAULT_BUILDING_UPGRADE_TIME_MS) + (c.timeGrowthMs ?? 0) * lv,
        };
    }

    /**
     * 开始一次能力升级读条（读条开始时扣资源，完成时等级 +1）。
     * continuous=true：本项目完成后自动续升下一级（资源足够且未满级）。
     */
    startAbilityUpgrade(abilityId, continuous = false) {
        if (!TechnologySystem.isUnlocked('upgrade', abilityId)) return { ok: false, reason: '该研究项目尚未通过科技解锁' };
        const a = this.getAbility(abilityId);
        if (!a) return { ok: false, reason: '未知能力' };
        if (!this.canUpgradeAbility(abilityId)) return { ok: false, reason: '能力已满级' };
        if (this._upgrade) return { ok: false, reason: '已有升级在读条中' };
        const pending = { kind: 'ability', abilityId };
        const occupied = isBuildingUpgradeProgressOccupied(this, pending, Game?.entities)
            || hasBackgroundBuildingUpgrade(pending);
        if (occupied) return { ok: false, reason: '该全局能力正在其他建筑或后台位面中升级' };
        const cost = this.getAbilityCost(abilityId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        this._upgrade = { ...pending, totalMs: cost.timeMs, remainMs: cost.timeMs };
        if (continuous) this._continuous = abilityId;
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, abilityId };
    }

    /** 推进能力/模块升级读条；完成后统一结算全局等级。 */
    _updateUpgrade(dt) {
        if (!this._upgrade) return;
        this._upgrade.remainMs -= dt;
        if (this._upgrade.remainMs > 0) return;
        const completed = this._upgrade;
        this._upgrade = null;
        if (completed.moduleId) {
            const { moduleId, unitType } = completed;
            const mod = this._cfg.modules?.[moduleId];
            const level = raiseUnitUpgradeLevel(unitType, moduleId);
            applyGlobalUpgradesToKind(unitType, this._cfg.modules);
            if (mod && EffectManager) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `${mod.name} Lv.${level}`, '#8ad0ff'));
            }
            if (ProducerBuildingSystem?._panel?.isOpen
                && ProducerBuildingSystem._panel.building === this) {
                ProducerBuildingSystem._panel.refresh();
            }
            return;
        }
        const { abilityId } = completed;
        const a = this.getAbility(abilityId);
        const previousLevel = getAbilityLevel(abilityId);
        const level = raiseAbilityLevel(abilityId, a?.maxLevel ?? 10);
        if (level > previousLevel) ResearchSystem.onResearchLeveled(abilityId);
        if (a && EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `${a.name} Lv.${level}`, '#c9a0ff'));
        }
        // 完成后面板立即刷新（否则进度条停在最后一次 100ms tick 的 99%，2026-08-17 用户反馈）
        if (ProducerBuildingSystem && ProducerBuildingSystem._panel && ProducerBuildingSystem._panel.isOpen
            && ProducerBuildingSystem._panel.building === this) {
            ProducerBuildingSystem._panel.refresh();
        }
        // 持续升级：资源足够且未满级 → 自动开始下一级
        if (this._continuous === abilityId && this.canUpgradeAbility(abilityId)) {
            const res = this.startAbilityUpgrade(abilityId, true);
            if (!res.ok) this._continuous = null; // 资源不足/异常 → 停止持续
        } else if (this._continuous === abilityId) {
            this._continuous = null;
        }
    }

    /** 开始兵种模块升级：开始时扣资源，读条完成后才提升等级并同步单位。 */
    startModuleUpgrade(moduleId) {
        const mod = this._cfg.modules?.[moduleId];
        if (!mod) return { ok: false, reason: '未知模块' };
        if (!moduleAppliesToUnit(mod, this.unitType)) return { ok: false, reason: '当前兵种不适用该模块' };
        if (!this.canUpgradeModule(moduleId)) return { ok: false, reason: '模块已满级' };
        if (this._upgrade) return { ok: false, reason: '已有升级在读条中' };
        const cost = this.getModuleCost(moduleId);
        if (!cost) return { ok: false, reason: '升级费用配置缺失' };
        const pending = { kind: 'module', moduleId, unitType: this.unitType };
        if (isBuildingUpgradeProgressOccupied(this, pending, Game?.entities)
            || hasBackgroundBuildingUpgrade(pending)) {
            return { ok: false, reason: '该兵种的全局模块正在其他建筑或后台位面中升级' };
        }
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        this._upgrade = { ...pending, totalMs: cost.timeMs, remainMs: cost.timeMs };
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, moduleId, unitType: this.unitType };
    }

    upgradeModule(moduleId, _player) {
        return this.startModuleUpgrade(moduleId);
    }

    /** 主循环：按当前兵种生产周期生成一个军事单位（存活数低于上限时）；
     *  周期 = 兵种配置 spawnIntervalMs（缺省建筑级）再经研究院快速募兵缩放（2026-08-18） */
    recruitIntervalMs(kind = this.unitType) {
        const base = this._unitSpawnIntervalMs(kind);
        return ResearchSystem.getRecruitIntervalMs
            ? ResearchSystem.getRecruitIntervalMs(base)
            : base;
    }

    update(dt) {
        if (!this.active) return;
        this._updateUpgrade(dt);
        WarehouseEconomySystem.updateBuilding(this, dt);
        BankEconomySystem.updateBuilding(this, dt);
        PopulationEconomySystem.updateBuilding(this, dt);
        HamsterFarmerVisualSystem.updateBuilding(this, dt);
        WorkshopEconomySystem.updateBuilding(this, dt);
        HamsterBankerVisualSystem.updateBuilding(this, dt);
        if (!this.spawnEnabled) return;
        if (this._parallelProduction) {
            this._updateParallelProduction(dt);
            return;
        }
        const restoring = (this._restoreRosterQueue?.length || 0) > 0 || this._restoreTopUp > 0;
        if (!restoring && this._recruitMode === RECRUIT_MODE.PAUSED) return;
        if (this.aliveUnitCount() < this.unitCount()) {
            this._spawnTimer = Math.max(0, this._spawnTimer - dt);
            if (this._spawnTimer <= 0) {
                this._spawnRetryTimer -= dt;
                if (this._spawnRetryTimer > 0) return;
                let unit;
                if (Array.isArray(this._restoreRosterQueue) && this._restoreRosterQueue.length > 0) {
                    const selectedType = this.unitType;
                    this.unitType = this._restoreRosterQueue[0];
                    unit = this.spawnUnit(false, { restoring: true });
                    this.unitType = selectedType;
                    if (unit) this._restoreRosterQueue.shift();
                } else {
                    unit = this.spawnUnit(!restoring, { restoring });
                }
                if (unit) {
                    // 快照恢复补员（_restoreTopUp>0）：绕过完整产兵周期快速补齐，800ms/个
                    this._spawnTimer = restoring ? 800 : this.recruitIntervalMs();
                    if (this._restoreTopUp > 0) this._restoreTopUp--;
                    this._spawnRetryTimer = 0;
                    this._spawnBlocked = false;
                    this._spawnFoodBlocked = false;
                    if (!restoring && this._recruitMode === RECRUIT_MODE.SINGLE) {
                        this._recruitMode = RECRUIT_MODE.PAUSED;
                    }
                } else if (this._spawnFoodBlocked) {
                    this._spawnTimer = 0;
                    this._spawnRetryTimer = 1000;
                    this._spawnBlocked = false;
                    if (EffectManager) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - 66,
                            `粮食不足，生产暂停（需 ${this._unitSpawnFoodCost()}）`, '#ffcc55'));
                    }
                } else {
                    this._spawnTimer = 0;
                    this._spawnRetryTimer = SpawnPlacement.retryMs;
                    if (!this._spawnBlocked && EffectManager) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - 66, '出口被阻挡，等待空位', '#ff8855'));
                    }
                    this._spawnBlocked = true;
                }
                if (unit && EffectManager) {
                    const name = this.unitName(this.unitType);
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `${name} 报到！`, '#8ad0ff'));
                }
            }
        } else {
            this._spawnTimer = this.recruitIntervalMs();
            this._spawnRetryTimer = 0;
            this._spawnBlocked = false;
            this._spawnFoodBlocked = false;
        }
    }

    _updateParallelProduction(dt) {
        for (const [kind, queue] of Object.entries(this._parallelQueues || {})) {
            const restoring = Array.isArray(this._restoreRosterQueue)
                && this._restoreRosterQueue.includes(kind);
            if (!restoring && normalizeRecruitMode(queue.recruitMode) === RECRUIT_MODE.PAUSED) continue;
            if (this.aliveUnitCount(kind) >= this.parallelUnitCap(kind)) {
                queue.timer = this.recruitIntervalMs(kind);
                queue.retryTimer = 0; queue.blocked = false; queue.foodBlocked = false;
                continue;
            }
            queue.timer = Math.max(0, queue.timer - dt);
            if (queue.timer > 0) continue;
            queue.retryTimer -= dt;
            if (queue.retryTimer > 0) continue;
            this._spawnFoodBlocked = false;
            const unit = this.spawnUnitFor(kind, !restoring, { restoring });
            queue.foodBlocked = !!this._spawnFoodBlocked;
            if (unit) {
                queue.timer = restoring ? 800 : this.recruitIntervalMs(kind);
                queue.retryTimer = 0; queue.blocked = false; queue.foodBlocked = false;
                if (restoring) {
                    const index = this._restoreRosterQueue.indexOf(kind);
                    if (index >= 0) this._restoreRosterQueue.splice(index, 1);
                } else if (normalizeRecruitMode(queue.recruitMode) === RECRUIT_MODE.SINGLE) {
                    queue.recruitMode = RECRUIT_MODE.PAUSED;
                }
                EffectManager?.add?.(new FloatingTextEffect(this.x, this.y - 56, `${this.unitName(kind)} 报到！`, '#8ad0ff'));
            } else {
                queue.timer = 0;
                queue.retryTimer = queue.foodBlocked ? 1000 : SpawnPlacement.retryMs;
                queue.blocked = !queue.foodBlocked;
            }
        }
    }

    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        this._destroyCleanup();
        if (EffectManager) {
            EffectManager.add(new BuildingSinkEffect(this));
        }
    }

    /** 建筑专属清理（单位/列表/面板）；实体失效与移除由 BuildingSinkEffect 负责 */
    _destroyCleanup() {
        this._upgrade = null;
        this._continuous = null;
        HamsterFarmerVisualSystem.clearBuilding(this);
        HamsterBankerVisualSystem.clearBuilding(this);
        BankEconomySystem.unregisterBuilding(this);
        WorkshopEconomySystem.unregisterBuilding(this);
        WarehouseEconomySystem.unregisterBuilding(this);
        PopulationEconomySystem.unregisterBuilding(this);
        TroopLineSystem.clearProducerRally(this);
        World122TributeSystem.detachAltar(this);
        this._despawnUnits();
        if (this._isEnergyWarehouse && EnergyManager) {
            const lostFood = Math.max(0, Math.floor(Number(this.storedFood) || 0));
            const lost = EnergyManager.unregisterWarehouse(this);
            if ((lost > 0 || lostFood > 0) && EffectManager) {
                const losses = [lost > 0 ? `${lost} 能源` : '', lostFood > 0 ? `${lostFood} 粮食` : '']
                    .filter(Boolean).join('、');
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 62, `仓库被毁，损失 ${losses}`, '#ff5555'));
            }
        }
        if (ProducerBuildingSystem && ProducerBuildingSystem.buildings) {
            const i = ProducerBuildingSystem.buildings.indexOf(this);
            if (i >= 0) ProducerBuildingSystem.buildings.splice(i, 1);
        }
        if (ProducerBuildingSystem && ProducerBuildingSystem._panel && ProducerBuildingSystem._panel.isOpen
            && ProducerBuildingSystem._panel.building === this) {
            ProducerBuildingSystem._panel.close();
        }
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, `${this._cfg.name}被摧毁`, '#ff8855'));
        }
    }

    _despawnUnits() {
        for (const u of this.units) {
            if (!u) continue;
            u.active = false;
            if (Game && Game.entities && u.id) Game.entities.delete(u.id);
            if (Array.isArray(Game.friendlyUnits)) {
                const i = Game.friendlyUnits.indexOf(u);
                if (i >= 0) Game.friendlyUnits.splice(i, 1);
            }
        }
        this.units = [];
    }

    /** 出售：返还 50% 建造能源，单位一并拆除 */
    sell() {
        if (this._isWorldPortalCore || this._isMainHubPortalBuilding) {
            return { ok: false, reason: '世界核心传送门不可出售' };
        }
        if (this._isEnergyWarehouse && ((this.storedEnergy || 0) > 0 || (this.storedFood || 0) > 0)) {
            return { ok: false, reason: '仓库中仍有能源或粮食，无法出售' };
        }
        const buildCost = Math.max(0, Number(this._buildCost ?? this._cfg.cost) || 0);
        const buildCurrency = this._buildCurrency || (this._cfg.currency === 'gold' ? 'gold' : 'energy');
        const durability = Math.max(0, Math.min(1, Number(this.hp) / Math.max(1, Number(this.maxHp) || 1)));
        const refund = Math.floor(buildCost * (this._cfg.sellRefundRatio ?? 0.5) * durability);
        if (buildCurrency !== 'gold' && (!EnergyManager || !EnergyManager.canStore(refund))) {
            return { ok: false, reason: '仓库空间不足，无法接收出售返还能源' };
        }
        this.hittable = false;
        this._sinking = true;
        this._upgrade = null;
        this._continuous = null;
        HamsterFarmerVisualSystem.clearBuilding(this);
        HamsterBankerVisualSystem.clearBuilding(this);
        BankEconomySystem.unregisterBuilding(this);
        WorkshopEconomySystem.unregisterBuilding(this);
        WarehouseEconomySystem.unregisterBuilding(this);
        PopulationEconomySystem.unregisterBuilding(this);
        TroopLineSystem.clearProducerRally(this);
        World122TributeSystem.detachAltar(this);
        this._despawnUnits();
        if (this._isEnergyWarehouse && EnergyManager) EnergyManager.unregisterWarehouse(this);
        if (ProducerBuildingSystem && ProducerBuildingSystem.buildings) {
            const i = ProducerBuildingSystem.buildings.indexOf(this);
            if (i >= 0) ProducerBuildingSystem.buildings.splice(i, 1);
        }
        if (buildCurrency === 'gold') {
            if (GoldManager) GoldManager.addGold(refund);
        } else if (EnergyManager) {
            EnergyManager.addEnergy(refund);
        }
        if (ProducerBuildingSystem && ProducerBuildingSystem._panel && ProducerBuildingSystem._panel.isOpen
            && ProducerBuildingSystem._panel.building === this) {
            ProducerBuildingSystem._panel.close();
        }
        if (EffectManager) EffectManager.add(new BuildingSinkEffect(this).start());
        return { ok: true, refund };
    }
}

// ==================== 产兵建筑面板 ====================

class ProducerBuildingPanel extends BasePanel {
    constructor() {
        super({
            id: 'producerBuildingPanel',
            className: 'producer-building-panel bp-right-column',
            stateKey: 'producerBuilding',
            panelGroup: 'buildingDetail',
            closeOnEscape: true,
            closeOnOutsidePointer: true,
            mountElement: (el) => mountRightSidebarPanel(el, 'panel', { bringToFront: true }),
        });
        this.building = null;
        this.player = null;
        this._tickTimer = null;   // 出兵进度实时刷新定时器（100ms）
    }

    buildContent(el) {
        el.style.cssText = [
            'position:fixed;right:26px;top:50%;transform:translateY(-50%);width:400px;',
            'max-height:88vh;overflow-y:auto;',
            'background:rgba(16,15,13,0.97);border:2px solid #6a5a3a;border-radius:10px;',
            'padding:16px 18px;color:#d4c5a9;font-family:SimHei,"Microsoft YaHei",sans-serif;',
            'box-shadow:0 8px 30px rgba(0,0,0,0.65);z-index:9000;',
        ].join('');
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div id="pbTitle" style="font-size:18px;font-weight:700;color:#ffd700;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="pbSell" type="button" style="background:#3a2820;color:#ffc9a0;border:1px solid #6a4a2a;border-radius:6px;padding:4px 10px;cursor:pointer;">出售</button>
                    <button id="pbClose" type="button" aria-label="关闭建筑详情" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:pointer;">关闭</button>
                </div>
            </div>
            <div id="pbBuildingDetail"></div>
            <div id="pbFunctionTitle" class="troop-panel-section-title" style="margin:2px 0 6px;"></div>
            <div id="pbStatus" style="border:1px solid #4a4a2a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(60,50,20,0.18);"></div>
            <div id="pbUnitType" style="border:1px solid #3a6a5a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(20,50,40,0.18);"></div>
            <div id="pbModules" style="border:1px solid #3a4a5a;border-radius:8px;padding:10px;background:rgba(20,40,60,0.18);"></div>
        `;
        // 升级说明浮窗：研究/能力与出兵模块共用，独立挂在 document.body，
        // 避免被面板 overflow 裁剪或撑出滚动条。
        ensureBuildingUpgradeTooltip();
        el.querySelector('#pbClose').addEventListener('click', () => this.close());
    }

    openFor(building, player) {
        BankEconomySystem.hideRange();
        WorkshopEconomySystem.hideRange();
        this.building = building;
        this.player = player;
        this.open();
        if (building?._economyType === 'bank') BankEconomySystem.showRange(building);
        if (building?._economyType === 'workshop') WorkshopEconomySystem.showRange(building);
        this.refresh();
        this._startTicking();
    }

    onOpen() {
        this.refresh();
        this._startTicking();
    }

    onClose() {
        this._stopTicking();
        this._hideAbilityTip();
        this.el?.classList.remove('is-troop-producer');
        this.el?.classList.remove('is-economy-building');
        BankEconomySystem.hideRange();
        WorkshopEconomySystem.hideRange();
        this.building = null;
        this.player = null;
    }

    /** 打开期间每 100ms 实时刷新出兵进度（只更新进度条，不重建 DOM） */
    _startTicking() {
        this._stopTicking();
        this._tickTimer = setInterval(() => this._tickProgress(), 100);
    }

    _stopTicking() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
    }

    /** 只更新进度条宽度/百分比/剩余秒数——配合 CSS transition 形成平滑增长效果 */
    _tickProgress() {
        const el = this.el;
        if (!el || !this.building) return;
        const b = this.building;
        if (b._economyType) {
            const population = PopulationEconomySystem.getPopulationSnapshot();
            const workforce = PopulationEconomySystem.getWorkerSnapshot(b);
            const populationEl = el.querySelector('#pbEconomyPopulation');
            const workersEl = el.querySelector('#pbEconomyWorkers');
            if (populationEl) {
                populationEl.textContent = `${population.used}/${population.capacity} · 空余 ${population.free}`
                    + (population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : '');
            }
            if (workersEl && workforce) {
                workersEl.textContent = `${workforce.assigned}/${workforce.slots} · 人口效率 ${Math.round(workforce.laborEfficiency * 100)}%`;
                el.querySelectorAll('[data-worker-delta]').forEach((button) => {
                    const delta = Number(button.dataset.workerDelta) || 0;
                    button.disabled = delta < 0
                        ? workforce.assigned <= 0
                        : (workforce.freeSlots <= 0 || population.free <= 0);
                });
                const maxButton = el.querySelector('[data-worker-max]');
                if (maxButton) maxButton.disabled = workforce.freeSlots <= 0 || population.free <= 0;
            }
            if (workforce) {
                const workforcePct = workforce.slots > 0
                    ? Math.round(workforce.assigned / workforce.slots * 100)
                    : 0;
                const workforceBar = el.querySelector('#pbEconomyWorkforceBar');
                const workforcePctEl = el.querySelector('#pbEconomyWorkforcePct');
                if (workforceBar) workforceBar.style.width = `${workforcePct}%`;
                if (workforcePctEl) workforcePctEl.textContent = `${workforcePct}%`;
            }
            const secondaryProgress = this._getEconomySecondaryProgress(b, workforce);
            const productionBar = el.querySelector('#pbEconomyProductionBar');
            const productionPctEl = el.querySelector('#pbEconomyProductionPct');
            if (productionBar) productionBar.style.width = `${secondaryProgress.pct}%`;
            if (productionPctEl) productionPctEl.textContent = secondaryProgress.text;
            if (b._economyType === 'bank') {
                const snapshot = PopulationEconomySystem.getBankSnapshot(b);
                const effectivePopulation = snapshot.effectiveServicePopulation.toFixed(2);
                const values = {
                    pbBankRange: `${Math.round(snapshot.range)}px`,
                    pbBankHouses: `${snapshot.coveredHouseCount}`,
                    pbBankServicePopulation: `${snapshot.servicePopulation}`,
                    pbBankEffectivePopulation: effectivePopulation,
                    pbBankOverlap: `${snapshot.overlappedHouseCount} 栋 / 最高 ${snapshot.maxBankOverlapCount} 家`,
                    pbBankPerPopulation: `${(snapshot.goldPerPopulation * 100).toFixed(0)}%`,
                    pbBankInterval: `${(snapshot.settlementIntervalMs / 1000).toFixed(2)} 秒`,
                    pbBankSettlementGold: `${snapshot.goldPerSettlement.toFixed(2)} 金币`,
                    pbEconomyOutput: `${snapshot.goldPerSecond.toFixed(2)} 金币/秒`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const status = el.querySelector('#pbBankStatus');
                if (status) {
                    const overlapBlocked = snapshot.servicePopulation > 0
                        && snapshot.effectiveServicePopulation <= 0;
                    const operating = snapshot.assignedWorkers > 0
                        && snapshot.effectiveServicePopulation > 0;
                    status.textContent = operating
                        ? `有效 ${effectivePopulation} 人`
                        : (overlapBlocked ? '三家重叠：无收益' : '等待职员与服务人口');
                    status.classList.toggle('is-blocked', !operating);
                }
                const upgrade = b._bankUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-bank-upgrading="true"]')) {
                    this.refresh();
                }
            } else if (b._economyType === 'housing') {
                const upgradeState = el.querySelector('#pbHouseUpgradeState');
                if (b._economyUpgrade && upgradeState) {
                    const progress = Math.round((1 - b._economyUpgrade.remainMs / b._economyUpgrade.totalMs) * 100);
                    upgradeState.textContent = `升级中 ${progress}%（${Math.ceil(b._economyUpgrade.remainMs / 1000)}s）`;
                } else if (!b._economyUpgrade && upgradeState?.dataset.upgrading === 'true') {
                    this.refresh();
                }
            } else if (b._economyType === 'windmill') {
                const output = el.querySelector('#pbEconomyOutput');
                const food = el.querySelector('#pbEconomyFood');
                if (output) output.textContent = `${PopulationEconomySystem.getWindmillFoodPerSecond(b).toFixed(2)} 粮食/秒`;
                if (food) food.textContent = `${Math.floor(PopulationEconomySystem.getFoodStored())}`;
            } else if (b._economyType === 'market') {
                const quote = PopulationEconomySystem.getMarketQuote(b);
                const buyBatch = populationEconomyConfig.market.buyEnergyBatch;
                const sellBatch = populationEconomyConfig.market.sellGoldBatch;
                const buyGold = Math.floor(buyBatch / quote.buyEnergyPerGold);
                const buyEnergy = Math.ceil(buyGold * quote.buyEnergyPerGold);
                const values = {
                    pbEconomyMarketMid: quote.midEnergyPerGold.toFixed(2),
                    pbEconomyMarketBuy: quote.buyEnergyPerGold.toFixed(2),
                    pbEconomyMarketSell: quote.sellEnergyPerGold.toFixed(2),
                    pbEconomyMarketPressure: quote.pressure.toFixed(3),
                    pbEconomyMarketSpread: `${(quote.spread * 100).toFixed(1)}%`,
                    pbEconomyMarketLoss: `买 +${(quote.minimumTradeLossRate * 100).toFixed(0)}% / 卖 -${(quote.minimumTradeLossRate * 100).toFixed(0)}%`,
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const canTrade = PopulationEconomySystem.canMarketTrade(b);
                const buyButton = el.querySelector('[data-market-buy]');
                const sellButton = el.querySelector('[data-market-sell]');
                if (buyButton) {
                    buyButton.disabled = !canTrade;
                    buyButton.innerHTML = `${buyEnergy} 能源 → <span class="economy-unit-gold">${buyGold} 金币</span>`;
                }
                if (sellButton) {
                    sellButton.disabled = !canTrade;
                    sellButton.innerHTML = `${sellBatch} <span class="economy-unit-gold">金币</span> → ${Math.floor(sellBatch * quote.sellEnergyPerGold)} 能源`;
                }
            } else if (b._economyType === 'workshop') {
                const snapshot = WorkshopEconomySystem.getSnapshot(b);
                const values = {
                    pbWorkshopRange: `${Math.round(snapshot.range)}px`,
                    pbWorkshopEfficiency: `+${(snapshot.actualEfficiency * 100).toFixed(1)}%`,
                    pbWorkshopRepair: `${(snapshot.repairRate * 100).toFixed(1)}%/秒`,
                    pbWorkshopStaffed: `${snapshot.staffedEngineerCount}/${snapshot.engineerCount}`,
                    pbWorkshopEngineers: `${snapshot.assignedCount}`,
                    pbWorkshopRepairing: `${snapshot.repairingCount}`,
                    pbWorkshopSafety: snapshot.enemyBlocked ? '敌情封锁，维修暂停' : '范围安全，可自动维修',
                };
                Object.entries(values).forEach(([id, value]) => {
                    const node = el.querySelector(`#${id}`);
                    if (node) node.textContent = value;
                });
                const safety = el.querySelector('#pbWorkshopSafety');
                safety?.classList.toggle('is-blocked', snapshot.enemyBlocked);
                const upgrade = b._workshopUpgrade;
                if (upgrade) {
                    const pct = Math.max(0, Math.min(100,
                        Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                    const bar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                    const text = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                    if (bar) bar.style.width = `${pct}%`;
                    if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
                } else if (el.querySelector('[data-workshop-upgrading="true"]')) {
                    this.refresh();
                }
            }
            return;
        }
        if (b._isEnergyWarehouse) {
            const ownEnergy = Math.floor(b.storedEnergy || 0);
            const ownFood = Math.floor(b.storedFood || 0);
            const own = EnergyManager ? EnergyManager.getWarehouseUsedCapacity(b) : ownEnergy + ownFood;
            const ownCap = Math.floor(b.storageCapacity || b._cfg.storageCapacity || 5000);
            const totalEnergy = EnergyManager ? EnergyManager.getEnergy() : 0;
            const totalFood = EnergyManager ? EnergyManager.getFood() : 0;
            const totalCap = EnergyManager ? EnergyManager.getCapacity() : 0;
            const totalUsed = totalCap - (EnergyManager ? EnergyManager.getFreeCapacity() : 0);
            const pct = ownCap > 0 ? Math.round(own / ownCap * 100) : 0;
            const totalPct = totalCap > 0 ? Math.round(totalUsed / totalCap * 100) : 0;
            const ownEl = el.querySelector('#pbWarehouseOwn');
            const totalEl = el.querySelector('#pbWarehouseTotal');
            const pctEl = el.querySelector('#pbWarehousePct');
            const barEl = el.querySelector('#pbWarehouseBar');
            const totalPctEl = el.querySelector('#pbWarehouseTotalPct');
            const totalBarEl = el.querySelector('#pbWarehouseTotalBar');
            if (ownEl) ownEl.textContent = `${Math.round(own)}/${ownCap}（能 ${ownEnergy} / 粮 ${ownFood}）`;
            if (totalEl) totalEl.textContent = `${Math.round(totalUsed)}/${totalCap}（能 ${totalEnergy} / 粮 ${totalFood}）`;
            if (pctEl) pctEl.textContent = `${pct}%`;
            if (barEl) barEl.style.width = `${pct}%`;
            if (totalPctEl) totalPctEl.textContent = `${totalPct}%`;
            if (totalBarEl) totalBarEl.style.width = `${totalPct}%`;
            const upgrade = b._warehouseUpgrade;
            if (upgrade) {
                const upgradePct = Math.max(0, Math.min(100,
                    Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
                const upgradeBar = el.querySelector(`#pbUpgradeBar_${upgrade.moduleId}`);
                const upgradeText = el.querySelector(`#pbUpgradeText_${upgrade.moduleId}`);
                if (upgradeBar) upgradeBar.style.width = `${upgradePct}%`;
                if (upgradeText) upgradeText.textContent = `升级中 ${upgradePct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
            } else if (el.querySelector('[data-warehouse-upgrading="true"]')) {
                this.refresh();
            }
            return;
        }
        if (b._parallelProduction) {
            for (const [kind, queue] of Object.entries(b._parallelQueues || {})) {
                const interval = b.recruitIntervalMs(kind);
                const progress = queue.blocked ? 1 : Math.max(0, Math.min(1, 1 - queue.timer / interval));
                const pctValue = Math.round(progress * 100);
                const bar = el.querySelector(`[data-parallel-bar="${kind}"]`);
                const pct = el.querySelector(`[data-parallel-pct="${kind}"]`);
                const next = el.querySelector(`[data-parallel-next="${kind}"]`);
                if (bar) bar.style.width = `${pctValue}%`;
                if (pct) pct.textContent = `${pctValue}%`;
                if (next) next.textContent = normalizeRecruitMode(queue.recruitMode) === RECRUIT_MODE.PAUSED
                    ? '已暂停' : queue.foodBlocked ? '粮食不足' : queue.blocked ? '出口阻塞'
                        : `${Math.max(0, Math.ceil(queue.timer / 1000))}s`;
            }
            return;
        }
        const spawnMs = b.recruitIntervalMs();
        const recruitMode = normalizeRecruitMode(b._recruitMode);
        const paused = recruitMode === RECRUIT_MODE.PAUSED;
        const spawnProgress = b._spawnBlocked ? 1 : Math.max(0, Math.min(1, 1 - b._spawnTimer / spawnMs));
        const spawnPct = Math.round(spawnProgress * 100);
        const spawnBarColor = paused ? '#727981' : (b._spawnFoodBlocked ? '#ffcc55' : (b._spawnBlocked ? '#ff7755'
            : (spawnProgress < 0.5 ? '#ffd700' : (spawnProgress < 0.8 ? '#ff9d45' : '#7fe0c8'))));
        const bar = el.querySelector('#pbSpawnBar');
        const pct = el.querySelector('#pbSpawnPct');
        const next = el.querySelector('#pbSpawnNext');
        if (bar) {
            bar.style.width = `${spawnPct}%`;
            bar.style.background = `linear-gradient(90deg, ${spawnBarColor}, #7fe0c8)`;
        }
        if (pct) {
            pct.textContent = `${spawnPct}%`;
            pct.style.color = spawnBarColor;
        }
        if (next) next.textContent = paused
            ? '已暂停'
            : (b._spawnFoodBlocked ? '粮食不足'
                : (b._spawnBlocked ? '出口阻塞' : `${Math.max(0, Math.ceil(b._spawnTimer / 1000))}s`));
        const modeText = el.querySelector('#pbRecruitMode');
        if (modeText) modeText.textContent = `${recruitModeLabel(recruitMode)} · ${recruitStatusText(b)}`;
        el.querySelectorAll('[data-recruit-mode]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.recruitMode === recruitMode);
        });
        // 研究/能力与出兵模块共用升级读条进度。
        if (b._upgrade) {
            const up = b._upgrade;
            const upPct = Math.max(0, Math.min(100, Math.round((1 - up.remainMs / up.totalMs) * 100)));
            const projectId = up.abilityId || up.moduleId;
            const bar = el.querySelector(`#pbUpgradeBar_${projectId}`);
            const txt = el.querySelector(`#pbUpgradeText_${projectId}`);
            if (bar) bar.style.width = `${upPct}%`;
            if (txt) txt.textContent = `升级中 ${upPct}%（剩余 ${Math.max(0, Math.ceil(up.remainMs / 1000))}s）`;
        }
    }

    _notify(text, color) {
        const player = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        if (player) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, text, color || '#d4c5a9'));
        }
    }

    _abilityValueText(ability, level) {
        const value = getAbilityValue(ability, level);
        if (ability.displayMode === 'seconds') {
            const seconds = value / 1000;
            return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}秒`;
        }
        return ability.displayMode === 'flat'
            ? String(Math.round(value))
            : `${Math.round(value * 1000) / 10}%`;
    }

    _fillAbilityDesc(ability, level) {
        const text = this._abilityValueText(ability, level);
        return (ability.desc || '')
            .replace('{chance}', text)
            .replace('{dmg}', text)
            .replace('{pct}', text)
            .replace('{value}', text)
            .replace('{radius}', String(ability.radius ?? 0))
            .replace('{cooldown}', String(Math.round((ability.cooldownMs ?? 0) / 1000)));
    }

    _abilityTargetText(target) {
        return ABILITY_TARGET_NAMES[target] || target || '—';
    }

    refresh() {
        const el = this.el;
        if (!el || !this.building) return;
        const b = this.building;
        const cfg = b._cfg;
        const energy = CrossPlaneResourceSystem.getAvailable('energy');
        const food = CrossPlaneResourceSystem.getAvailable('food');
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const isWarehouse = cfg.workshopType === 'warehouse';
        const isPortal = cfg.panelMode === 'portal';
        const isPassive = cfg.panelMode === 'detail';
        const isEconomy = !!cfg.economyType;
        const isAbilityShop = cfg.spawnEnabled === false && !isWarehouse && !isPassive && !isEconomy;
        el.classList.toggle('is-troop-producer', !!b._isTroopProducer);
        el.classList.toggle('is-economy-building', isEconomy || isWarehouse);
        const applicableModules = isEconomy ? [] : Object.entries(cfg.modules || {})
            .filter(([, module]) => moduleAppliesToUnit(module, b.unitType));
        const upgradeSummary = applicableModules.map(([, module]) => module.name).join(' / ') || '无单位升级项目';
        el.querySelector('#pbTitle').textContent = '建筑详情';
        const detail = el.querySelector('#pbBuildingDetail');
        const functionTitle = el.querySelector('#pbFunctionTitle');
        const economyMode = {
            housing: '人口容量与房屋升级',
            bank: '范围人口金融服务',
            market: '商人动态交易',
            windmill: '农夫粮食生产',
            workshop: '自动维修与经济增效',
        }[cfg.economyType];
        const mode = isPortal ? '跨世界传送'
            : (isEconomy ? economyMode
                : (isPassive ? '基础建筑详情'
                : (isWarehouse ? '仓储与能源汇总'
                    : (isAbilityShop ? (cfg.workshopType === 'research' ? '研究与结构强化' : '能力工坊升级') : '募兵与单位生产'))));
        if (detail) {
            detail.innerHTML = renderBuildingDetailHeader({
                texture: b.spriteCfg?.idleKey || cfg.tex,
                name: cfg.name,
                hp: b.hp,
                maxHp: b.maxHp,
                accent: isWarehouse ? '#7fd4ff' : (isAbilityShop ? '#c9a0ff' : '#7fe0c8'),
                status: mode,
            });
        }
        if (functionTitle) functionTitle.textContent = `特殊功能 · ${mode}`;
        const unitTypeEl = el.querySelector('#pbUnitType');
        if (unitTypeEl) unitTypeEl.style.display = (isAbilityShop || isWarehouse || isPassive || isPortal || isEconomy) ? 'none' : '';

        const st = el.querySelector('#pbStatus');
        if (b._parallelProduction) {
            st.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span class="troop-panel-primary-label">双通道独立募兵</span>
                    <span class="troop-panel-resource-summary">金币 <span style="color:#ffd700;">${gold}</span> · 粮食 <span style="color:#d9b84f;">${Math.floor(food)}</span></span>
                </div>
                <div class="troop-panel-copy">两种单位分别计时、分别暂停，任一通道受阻不会重置另一条进度。</div>`;
            unitTypeEl.style.display = '';
            unitTypeEl.innerHTML = (cfg.unitTypes || []).map((unit) => {
                const queue = b._parallelQueues[unit.key];
                const mode = normalizeRecruitMode(queue.recruitMode);
                const interval = b.recruitIntervalMs(unit.key);
                const progress = queue.blocked ? 1 : Math.max(0, Math.min(1, 1 - queue.timer / interval));
                const pct = Math.round(progress * 100);
                return `<div style="padding:9px 0;border-bottom:1px solid rgba(127,224,200,.18);">
                    <div style="display:flex;justify-content:space-between;"><b style="color:#7fe0c8;">${unit.name}</b><span>${b.aliveUnitCount(unit.key)}/${b.parallelUnitCap(unit.key)} · ${CrossPlaneResourceSystem.quote({ food: unit.spawnFoodCost || 0 }).food} 粮食</span></div>
                    <div style="display:flex;justify-content:space-between;margin-top:5px;"><span data-parallel-next="${unit.key}">${mode === RECRUIT_MODE.PAUSED ? '已暂停' : `${Math.ceil(queue.timer / 1000)}s`}</span><span data-parallel-pct="${unit.key}">${pct}%</span></div>
                    <div style="height:9px;background:rgba(255,255,255,.1);border-radius:5px;overflow:hidden;"><div data-parallel-bar="${unit.key}" style="height:100%;width:${pct}%;background:linear-gradient(90deg,#ffd700,#7fe0c8);transition:width .2s linear;"></div></div>
                    <div class="recruit-control-row">
                        <button class="recruit-mode-btn ${mode === RECRUIT_MODE.SINGLE ? 'is-active' : ''}" data-parallel-kind="${unit.key}" data-parallel-mode="single">单次招募</button>
                        <button class="recruit-mode-btn ${mode === RECRUIT_MODE.CONTINUOUS ? 'is-active' : ''}" data-parallel-kind="${unit.key}" data-parallel-mode="continuous">持续招募</button>
                        <button class="recruit-mode-btn ${mode === RECRUIT_MODE.PAUSED ? 'is-active' : ''}" data-parallel-kind="${unit.key}" data-parallel-mode="paused">暂停</button>
                    </div>
                </div>`;
            }).join('');
            unitTypeEl.querySelectorAll('[data-parallel-kind]').forEach((button) => {
                button.addEventListener('click', () => this._setParallelRecruitMode(
                    button.dataset.parallelKind, button.dataset.parallelMode));
            });
            const modBox = el.querySelector('#pbModules');
            modBox.innerHTML = '<div class="troop-panel-empty">特色单位使用全局科技与铁匠铺能力；本建筑没有额外升级模块。</div>';
            const sellBtn = el.querySelector('#pbSell');
            if (sellBtn) {
                const durability = Math.max(0, Math.min(1, Number(b.hp) / Math.max(1, Number(b.maxHp) || 1)));
                const refund = Math.floor((b._buildCost ?? cfg.cost) * (cfg.sellRefundRatio ?? .5) * durability);
                const refundUnit = (b._buildCurrency || cfg.currency) === 'gold' ? '金币' : '能源';
                sellBtn.style.display = '';
                sellBtn.title = `出售返还 ${refund} ${refundUnit}（特色单位一并拆除）`;
                sellBtn.onclick = () => {
                    const result = b.sell();
                    this._notify(result.ok ? `已出售（+${result.refund} ${refundUnit}）` : result.reason, result.ok ? '#ffd700' : '#ff5555');
                    if (result.ok) this.close();
                };
            }
            return;
        }
        const curType = b.unitName(b.unitType);
        const spawnMs = b.recruitIntervalMs();
        const nextIn = Math.max(0, Math.ceil(b._spawnTimer / 1000));
        const recruitMode = normalizeRecruitMode(b._recruitMode);
        const paused = recruitMode === RECRUIT_MODE.PAUSED;
        // 出兵进度 = 已等待时间 / 当前兵种生成周期（2026-08-18 起切换单位类型重置 _spawnTimer 重新计时）
        const spawnProgress = b._spawnBlocked ? 1 : Math.max(0, Math.min(1, 1 - b._spawnTimer / spawnMs));
        const spawnPct = Math.round(spawnProgress * 100);
        const spawnBarColor = paused ? '#727981' : (b._spawnFoodBlocked ? '#ffcc55' : (b._spawnBlocked ? '#ff7755'
            : (spawnProgress < 0.5 ? '#ffd700' : (spawnProgress < 0.8 ? '#ff9d45' : '#7fe0c8'))));
        const nextText = paused ? '已暂停'
            : (b._spawnFoodBlocked ? '粮食不足' : (b._spawnBlocked ? '出口阻塞' : `${nextIn}s`));
        st.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div><span class="troop-panel-primary-label">等级 ${b.level}</span></div>
                <div class="troop-panel-resource-summary">金币 <span style="color:#ffd700;">${gold}</span> · 能源 <span style="color:#7fd4ff;">${energy}</span> · 粮食 <span style="color:#d9b84f;">${Math.floor(food)}</span></div>
            </div>
            <div class="troop-panel-copy">
                军事单位 <span style="color:#8ad0ff;">${b.aliveUnitCount()}/${b.unitCount()}</span> ·
                当前生成 <b style="color:#7fe0c8;">${curType}</b>（每名 ${CrossPlaneResourceSystem.quote({ food: b._unitSpawnFoodCost() }).food} 粮食）<br>
                招募状态 <b id="pbRecruitMode" style="color:${paused ? '#aab0b6' : '#7fe0c8'};">${recruitModeLabel(recruitMode)} · ${recruitStatusText(b)}</b> ·
                下次生成 <b id="pbSpawnNext" style="color:${b._spawnBlocked ? '#ff7755' : '#7fd4ff'};">${nextText}</b>（当前周期 ${(spawnMs / 1000).toFixed(1)}s）<br>
                ${upgradeSummary}
            </div>
            <div style="margin-top:8px;">
                <div class="troop-panel-progress-label" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                    <span>🚀 出兵进度</span>
                    <span id="pbSpawnPct" style="color:${spawnBarColor};font-weight:700;">${spawnPct}%</span>
                </div>
                <div style="position:relative;height:10px;background:rgba(255,255,255,0.10);border-radius:5px;overflow:hidden;">
                    <div id="pbSpawnBar" style="position:absolute;left:0;top:0;bottom:0;width:${spawnPct}%;background:linear-gradient(90deg, ${spawnBarColor}, #7fe0c8);border-radius:5px;transition:width 0.2s linear;"></div>
                </div>
                <div class="troop-panel-caption" style="margin-top:2px;">默认暂停；单次只完成一名，持续模式在粮食和空位满足时循环招募</div>
            </div>`;

        const ut = el.querySelector('#pbUnitType');
        const btn = (u) => {
            const active = b.unitType === u.key;
            return `<button class="troop-panel-unit-button ${active ? 'is-active' : ''}" data-unit-type="${u.key}"
                data-technology-gate-type="unit" data-technology-gate-id="${u.key}"
                style="flex:1;padding:7px 0;cursor:pointer;">${u.name}<br><small>${CrossPlaneResourceSystem.quote({ food: u.spawnFoodCost || 0 }).food} 粮食</small></button>`;
        };
        ut.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span class="troop-panel-section-title">🎖 生成单位类型</span>
                <span class="troop-panel-caption">切换后按新兵种周期重新计时</span>
            </div>
            <div style="display:flex;gap:8px;">${(cfg.unitTypes || []).map(btn).join('')}</div>
            <div class="recruit-control-row">
                <button class="recruit-mode-btn ${recruitMode === RECRUIT_MODE.SINGLE ? 'is-active' : ''}" data-recruit-mode="single">单次招募</button>
                <button class="recruit-mode-btn ${recruitMode === RECRUIT_MODE.CONTINUOUS ? 'is-active' : ''}" data-recruit-mode="continuous">持续招募</button>
                <button class="recruit-mode-btn ${recruitMode === RECRUIT_MODE.PAUSED ? 'is-active' : ''}" data-recruit-mode="paused">暂停招募</button>
            </div>`;
        TechnologyGate.bindTree(ut);
        ut.querySelectorAll('[data-unit-type]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._setUnitType(btnEl.dataset.unitType));
        });
        ut.querySelectorAll('[data-recruit-mode]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._setRecruitMode(btnEl.dataset.recruitMode));
        });

        const modBox = el.querySelector('#pbModules');
        const rows = applicableModules.map(([mid, mod]) => {
            const lv = getUnitUpgradeLevel(b.unitType, mid);
            const maxedMod = lv >= mod.maxLevel;
            const canBuy = b.canUpgradeModule(mid);
            const cost = b.getModuleCost(mid);
            const inProgress = !!(b._upgrade
                && b._upgrade.moduleId === mid
                && b._upgrade.unitType === b.unitType);
            const progPct = inProgress
                ? Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100)
                : 0;
            const btnHtml = maxedMod
                ? '<span style="color:#8a8a8a;font-size:12px;">已满级</span>'
                : canBuy
                    ? `<button class="troop-panel-upgrade-button" data-mod="${mid}" style="width:86px;white-space:nowrap;padding:3px 0;cursor:pointer;">升级</button>`
                    : '<span class="troop-panel-caption">🔒 未知模块</span>';
            return renderBuildingUpgradeCard({
                rowAttribute: 'data-module-row', projectId: mid,
                icon: mod.icon, iconImage: mod.iconImage, name: mod.name, level: lv, maxLevel: mod.maxLevel,
                cost, maxed: maxedMod, inProgress, progressPct: progPct,
                remainMs: inProgress ? b._upgrade.remainMs : 0,
                barId: `pbUpgradeBar_${mid}`, textId: `pbUpgradeText_${mid}`,
                actionsHtml: btnHtml, accent: '#8ad0ff',
            });
        }).join('');
        modBox.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span class="troop-panel-section-title">✨ 单位升级（读条完成后全局生效）</span>
                <span class="troop-panel-section-meta">持有 ${gold} 金 / ${energy} 能</span>
            </div>
            ${rows || '<div class="troop-panel-empty">暂无模块</div>'}`;
        modBox.querySelectorAll('[data-mod]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._upgrade(btnEl.dataset.mod));
        });
        modBox.querySelectorAll('[data-module-row]').forEach((rowEl) => {
            const moduleId = rowEl.dataset.moduleRow;
            rowEl.addEventListener('mouseenter', (ev) => this._showModuleTip(moduleId, ev));
            rowEl.addEventListener('mousemove', (ev) => this._moveAbilityTip(ev));
            rowEl.addEventListener('mouseleave', () => this._hideAbilityTip());
        });

        const sellBtn = el.querySelector('#pbSell');
        if (sellBtn) {
            sellBtn.style.display = '';
            const durability = Math.max(0, Math.min(1,
                Number(b.hp) / Math.max(1, Number(b.maxHp) || 1)));
            const refund = Math.floor((b._buildCost ?? cfg.cost)
                * (cfg.sellRefundRatio ?? 0.5) * durability);
            const refundUnit = (b._buildCurrency || cfg.currency) === 'gold' ? '金币' : '能源';
            sellBtn.title = `出售返还 ${refund} ${refundUnit}${isAbilityShop || isWarehouse || isPassive || isPortal || isEconomy ? '' : '（军事单位一并拆除）'}`;
            sellBtn.onclick = () => {
                const res = b.sell();
                this._notify(res.ok ? `已出售（+${res.refund} ${refundUnit}）` : (res.reason || '出售失败'), res.ok ? '#ffd700' : '#ff5555');
                if (res.ok) this.close();
            };
        }
        if (isEconomy) {
            const population = PopulationEconomySystem.getPopulationSnapshot();
            if (cfg.economyType === 'workshop') {
                const snapshot = WorkshopEconomySystem.getSnapshot(b);
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🔧 自动化经济工坊</span><span class="economy-panel-badge ${snapshot.enemyBlocked ? 'is-blocked' : ''}" id="pbWorkshopSafety">${snapshot.enemyBlocked ? '敌情封锁，维修暂停' : '范围安全，可自动维修'}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>影响半径</span><b id="pbWorkshopRange">${Math.round(snapshot.range)}px</b></div>
                        <div><span>实际增效</span><b id="pbWorkshopEfficiency">+${(snapshot.actualEfficiency * 100).toFixed(1)}%</b></div>
                        <div><span>维修速度</span><b id="pbWorkshopRepair">${(snapshot.repairRate * 100).toFixed(1)}%/秒</b></div>
                        <div><span>上岗 / 容量</span><b id="pbWorkshopStaffed">${snapshot.staffedEngineerCount}/${snapshot.engineerCount}</b></div>
                        <div><span>派遣 / 维修中</span><b><span id="pbWorkshopEngineers">${snapshot.assignedCount}</span> / <span id="pbWorkshopRepairing">${snapshot.repairingCount}</span></b></div>
                    </div>
                    <p class="economy-panel-note">范围内存在敌方单位时停止自动维修；只有已安排人口的工程师才会生成并工作，抵达目标后才恢复生命。每名上岗工程师发挥 20% 配置效果，同一建筑只取最强工坊光环。</p>`;
                const upgrade = b._workshopUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = WorkshopEconomySystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-workshop-upgrade="${moduleId}" ${upgrade ? 'disabled' : ''}>升级</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-workshop-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name, level, maxLevel: module.maxLevel,
                        cost: WorkshopEconomySystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#77c8d9',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-workshop-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>工坊升级项目</span><span class="economy-panel-meta">持有 <span class="economy-unit-gold">${gold} 金</span> / <span class="economy-unit-energy">${energy} 能</span></span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-workshop-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeWorkshop(button.dataset.workshopUpgrade));
                });
                modBox.querySelectorAll('[data-workshop-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showWorkshopTip(row.dataset.workshopRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
            } else if (cfg.economyType === 'housing') {
                const current = populationEconomyConfig.house?.levels?.find((entry) => entry.level === b._economyLevel);
                const next = PopulationEconomySystem.getHouseUpgrade(b);
                const upgrade = b._economyUpgrade;
                const progress = upgrade ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100) : 0;
                st.innerHTML = `
                <div class="economy-panel-heading">
                    <span>🏠 房屋</span>
                    <span class="economy-panel-meta">Lv.${b._economyLevel}</span>
                </div>
                <div class="economy-stat-grid">
                    <div><span>本栋容纳</span><b>${current?.populationCapacity || 0}</b></div>
                    <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                </div>
                <p class="economy-panel-note">本栋只提供人口容量；超额人口会降低所有经济岗位的人口效率。</p>`;
                modBox.innerHTML = next ? `
                <div class="economy-panel-heading"><span>房屋升级</span><span class="economy-panel-meta">当前 Lv.${b._economyLevel}</span></div>
                <div class="economy-stat-grid">
                    <div><span>升级到</span><b>Lv.${next.level}</b></div>
                    <div><span>容量变化</span><b>${current?.populationCapacity || 0} → ${next.populationCapacity}</b></div>
                    <div><span>升级费用</span><b><span class="economy-unit-gold">${next.upgradeCost.gold || 0} 金币</span> + <span class="economy-unit-energy">${next.upgradeCost.energy || 0} 能源</span></b></div>
                    <div><span>升级耗时</span><b>${Math.round((next.upgradeCost.timeMs || 0) / 1000)} 秒</b></div>
                </div>
                ${upgrade ? `<div id="pbHouseUpgradeState" class="economy-workforce-note" data-upgrading="true">升级中 ${progress}%（${Math.ceil(upgrade.remainMs / 1000)}s）</div>`
                        : '<button class="troop-panel-upgrade-button" data-house-upgrade>升级房屋并更换贴图</button>'}`
                : '<div class="economy-panel-note">房屋已达到当前配置最高等级。</div>';
                modBox.querySelector('[data-house-upgrade]')?.addEventListener('click', () => this._upgradeHouse());
            } else if (cfg.economyType === 'bank') {
                const snapshot = PopulationEconomySystem.getBankSnapshot(b);
                const effectivePopulation = snapshot.effectiveServicePopulation.toFixed(2);
                const overlapBlocked = snapshot.servicePopulation > 0
                    && snapshot.effectiveServicePopulation <= 0;
                const operating = snapshot.assignedWorkers > 0
                    && snapshot.effectiveServicePopulation > 0;
                st.innerHTML = `
                    <div class="economy-panel-heading"><span>🏦 银行服务档案</span><span class="economy-panel-badge ${operating ? '' : 'is-blocked'}" id="pbBankStatus">${operating ? `有效 ${effectivePopulation} 人` : (overlapBlocked ? '三家重叠：无收益' : '等待职员与服务人口')}</span></div>
                    <div class="economy-stat-grid">
                        <div><span>服务半径</span><b id="pbBankRange">${Math.round(snapshot.range)}px</b></div>
                        <div><span>覆盖房屋</span><b id="pbBankHouses">${snapshot.coveredHouseCount}</b></div>
                        <div><span>原始服务人口</span><b id="pbBankServicePopulation">${snapshot.servicePopulation}</b></div>
                        <div><span>折算有效人口</span><b id="pbBankEffectivePopulation">${effectivePopulation}</b></div>
                        <div><span>重叠房屋</span><b id="pbBankOverlap">${snapshot.overlappedHouseCount} 栋 / 最高 ${snapshot.maxBankOverlapCount} 家</b></div>
                        <div><span>每人每轮</span><b id="pbBankPerPopulation" class="economy-unit-gold">${(snapshot.goldPerPopulation * 100).toFixed(0)}%</b></div>
                        <div><span>结算周期</span><b id="pbBankInterval">${(snapshot.settlementIntervalMs / 1000).toFixed(2)} 秒</b></div>
                        <div><span>本轮金币</span><b id="pbBankSettlementGold" class="economy-unit-gold">${snapshot.goldPerSettlement.toFixed(2)} 金币</b></div>
                        <div><span>平均产出</span><b id="pbEconomyOutput" class="economy-unit-gold">${snapshot.goldPerSecond.toFixed(2)} 金币/秒</b></div>
                        <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    </div>
                    <p class="economy-panel-note">只统计服务范围内存活房屋的当前人口容量；单轮金币同时受上岗职员、人口效率和经济工坊增效影响。</p>
                    <p class="economy-panel-note is-danger">同一房屋每多被 1 家银行覆盖，该房屋对每家银行的收益 -33%；2 家为 67%，3 家及以上为 0。</p>`;
                const upgrade = b._bankUpgrade;
                const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                    const level = BankEconomySystem.getModuleLevel(b, moduleId);
                    const maxed = level >= module.maxLevel;
                    const inProgress = upgrade?.moduleId === moduleId;
                    const progressPct = inProgress
                        ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                        : 0;
                    const actionsHtml = maxed
                        ? '<span class="troop-panel-caption">已满级</span>'
                        : `<button class="troop-panel-upgrade-button" data-bank-upgrade="${moduleId}" ${upgrade ? 'disabled' : ''}>升级</button>`;
                    return renderBuildingUpgradeCard({
                        rowAttribute: 'data-bank-row', projectId: moduleId,
                        icon: module.icon, iconImage: module.iconImage, name: module.name, level, maxLevel: module.maxLevel,
                        cost: BankEconomySystem.getUpgradeCost(b, moduleId), maxed,
                        inProgress, progressPct,
                        remainMs: inProgress ? upgrade.remainMs : 0,
                        barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                        actionsHtml, accent: '#e4bd55',
                    }).replace('class="building-upgrade-card"',
                        `class="building-upgrade-card" data-bank-upgrading="${inProgress}"`);
                }).join('');
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-heading"><span>银行升级项目</span><span class="economy-panel-meta">持有 <span class="economy-unit-gold">${gold} 金</span> / <span class="economy-unit-energy">${energy} 能</span></span></div>${rows}`;
                this._bindWorkforceControls(modBox);
                modBox.querySelectorAll('[data-bank-upgrade]').forEach((button) => {
                    button.addEventListener('click', () => this._upgradeBank(button.dataset.bankUpgrade));
                });
                modBox.querySelectorAll('[data-bank-row]').forEach((row) => {
                    row.addEventListener('mouseenter', (event) => this._showBankTip(row.dataset.bankRow, event));
                    row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                    row.addEventListener('mouseleave', () => this._hideAbilityTip());
                });
            } else if (cfg.economyType === 'market') {
                const quote = PopulationEconomySystem.getMarketQuote(b);
                const buyBatch = populationEconomyConfig.market.buyEnergyBatch;
                const sellBatch = populationEconomyConfig.market.sellGoldBatch;
                const buyGold = Math.floor(buyBatch / quote.buyEnergyPerGold);
                const buyEnergy = Math.ceil(buyGold * quote.buyEnergyPerGold);
                const sellEnergy = Math.floor(sellBatch * quote.sellEnergyPerGold);
                st.innerHTML = `
                <div class="economy-panel-heading">⚖ 动态市场</div>
                <div class="economy-stat-grid">
                    <div><span>中间价</span><b>1 金币 = <span id="pbEconomyMarketMid" class="economy-unit-energy">${quote.midEnergyPerGold.toFixed(2)}</span> 能源</b></div>
                    <div><span>买入</span><b><span id="pbEconomyMarketBuy" class="economy-unit-energy">${quote.buyEnergyPerGold.toFixed(2)}</span> 能源 → <span class="economy-unit-gold">1 金币</span></b></div>
                    <div><span>卖出</span><b><span class="economy-unit-gold">1 金币</span> → <span id="pbEconomyMarketSell" class="economy-unit-energy">${quote.sellEnergyPerGold.toFixed(2)}</span> 能源</b></div>
                    <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    <div><span>压力</span><b id="pbEconomyMarketPressure">${quote.pressure.toFixed(3)}</b></div>
                    <div><span>价差</span><b id="pbEconomyMarketSpread">${(quote.spread * 100).toFixed(1)}%</b></div>
                    <div><span>最低交易损耗</span><b id="pbEconomyMarketLoss">买 +${(quote.minimumTradeLossRate * 100).toFixed(0)}% / 卖 -${(quote.minimumTradeLossRate * 100).toFixed(0)}%</b></div>
                </div>
                <p class="economy-panel-note">至少安排 1 名商人才能交易；更多商人会缩小动态价差并略微加快价格回归，但不能消除固定交易损耗。</p>`;
                const canTrade = PopulationEconomySystem.canMarketTrade(b);
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                <div class="economy-trade-actions">
                    <button class="troop-panel-unit-button" data-market-buy ${canTrade ? '' : 'disabled'}>${buyEnergy} 能源 → ${buyGold} <span class="economy-unit-gold">金币</span></button>
                    <button class="troop-panel-unit-button" data-market-sell ${canTrade ? '' : 'disabled'}>${sellBatch} <span class="economy-unit-gold">金币</span> → ${sellEnergy} 能源</button>
                </div>
                <div class="economy-panel-note">市场用于应急周转：买入金币至少溢价 15%，卖出金币至多获得基准价 85%；连续同向兑换还会恶化价格。</div>`;
                this._bindWorkforceControls(modBox);
                modBox.querySelector('[data-market-buy]')?.addEventListener('click', () => this._marketBuy());
                modBox.querySelector('[data-market-sell]')?.addEventListener('click', () => this._marketSell());
            } else {
                const rate = PopulationEconomySystem.getWindmillFoodPerSecond(b);
                st.innerHTML = `
                <div class="economy-panel-heading">🌾 麦田风车</div>
                <div class="economy-stat-grid">
                    <div><span>粮食产量</span><b id="pbEconomyOutput" class="economy-unit-food">${rate.toFixed(2)} 粮食/秒</b></div>
                    <div><span>位面库存</span><b id="pbEconomyFood" class="economy-unit-food">${Math.floor(PopulationEconomySystem.getFoodStored())}</b></div>
                    <div><span>位面人口</span><b id="pbEconomyPopulation">${population.used}/${population.capacity} · 空余 ${population.free}${population.overcrowded > 0 ? ` · 超额 ${population.overcrowded}` : ''}</b></div>
                    <div><span>占地</span><b>2×2（外围 12 格为田地占位符）</b></div>
                </div>
                <p class="economy-panel-note">产出进入位面共享粮食库存。</p>`;
                modBox.innerHTML = `${this._renderWorkforceControls(b)}
                    <div class="economy-panel-note">岗位有人时最多显示 ${populationEconomyConfig.windmill.visualWorkerCap || 0} 只仓鼠农民；它们只有精灵动画，不创建平民实体。</div>`;
                this._bindWorkforceControls(modBox);
            }
            return;
        }
        if (isWarehouse) {
            const ownEnergy = Math.floor(b.storedEnergy || 0);
            const ownFood = Math.floor(b.storedFood || 0);
            const own = EnergyManager ? EnergyManager.getWarehouseUsedCapacity(b) : ownEnergy + ownFood;
            const ownCap = Math.floor(b.storageCapacity || cfg.storageCapacity || 5000);
            const totalEnergy = EnergyManager ? EnergyManager.getEnergy() : 0;
            const totalFood = EnergyManager ? EnergyManager.getFood() : 0;
            const totalCap = EnergyManager ? EnergyManager.getCapacity() : 0;
            const totalUsed = totalCap - (EnergyManager ? EnergyManager.getFreeCapacity() : 0);
            const warehouseCount = EnergyManager ? EnergyManager.getWarehouseCount() : 0;
            const pct = ownCap > 0 ? Math.round(own / ownCap * 100) : 0;
            const totalPct = totalCap > 0 ? Math.round(totalUsed / totalCap * 100) : 0;
            const energySaving = Math.round((1 - WarehouseEconomySystem.getEnergyFactor(b)) * 100);
            const foodSaving = Math.round((1 - WarehouseEconomySystem.getFoodFactor(b)) * 100);
            const protocolSurcharge = Math.round(WarehouseEconomySystem.getProtocolSurcharge(b) * 100);
            st.innerHTML = `
                <div class="economy-panel-heading">
                    <span>📦 位面仓库</span><span class="economy-panel-meta">本位面 ${warehouseCount} 座</span>
                </div>
                <div class="economy-stat-grid">
                    <div><span>本仓占用</span><b id="pbWarehouseOwn" class="economy-unit-energy">${Math.round(own)}/${ownCap}（能 ${ownEnergy} / 粮 ${ownFood}）</b></div>
                    <div><span>位面总占用</span><b id="pbWarehouseTotal" class="economy-unit-energy">${Math.round(totalUsed)}/${totalCap}（能 ${totalEnergy} / 粮 ${totalFood}）</b></div>
                    <div><span>能源压缩</span><b>-${energySaving}% 容量占用</b></div>
                    <div><span>粮食压缩</span><b>-${foodSaving}% 容量占用</b></div>
                    <div><span>跨位面损耗</span><b>${protocolSurcharge > 0 ? `+${protocolSurcharge}%` : '0%'}</b></div>
                </div>
                <div class="economy-progress-label"><span>仓储容量</span><b id="pbWarehousePct">${pct}%</b></div>
                <div class="economy-progress"><div id="pbWarehouseBar" style="width:${pct}%"></div></div>
                <div class="economy-progress-label"><span>位面总容量</span><b id="pbWarehouseTotalPct">${totalPct}%</b></div>
                <div class="economy-progress"><div id="pbWarehouseTotalBar" style="width:${totalPct}%"></div></div>
                <p class="economy-panel-note">能源与粮食共享物理容量；压缩升级只降低对应资源的容量占用，不凭空增加库存。</p>`;
            const upgrade = b._warehouseUpgrade;
            const rows = Object.entries(cfg.modules || {}).map(([moduleId, module]) => {
                const level = WarehouseEconomySystem.getModuleLevel(b, moduleId);
                const maxed = level >= module.maxLevel;
                const inProgress = upgrade?.moduleId === moduleId;
                const progressPct = inProgress
                    ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                    : 0;
                const actionsHtml = maxed
                    ? '<span class="troop-panel-caption">已满级</span>'
                    : `<button class="troop-panel-upgrade-button" data-warehouse-upgrade="${moduleId}" ${upgrade ? 'disabled' : ''}>升级</button>`;
                return renderBuildingUpgradeCard({
                    rowAttribute: 'data-warehouse-row', projectId: moduleId,
                    icon: module.icon, iconImage: module.iconImage, name: module.name, level, maxLevel: module.maxLevel,
                    cost: WarehouseEconomySystem.getUpgradeCost(b, moduleId), maxed,
                    inProgress, progressPct,
                    remainMs: inProgress ? upgrade.remainMs : 0,
                    barId: `pbUpgradeBar_${moduleId}`, textId: `pbUpgradeText_${moduleId}`,
                    actionsHtml, accent: '#7fd4ff',
                }).replace('class="building-upgrade-card"',
                    `class="building-upgrade-card" data-warehouse-upgrading="${inProgress}"`);
            }).join('');
            modBox.innerHTML = `<div class="economy-panel-heading"><span>仓库升级项目</span><span class="economy-panel-meta">持有 ${gold} 金 / ${energy} 能</span></div>${rows}`;
            modBox.querySelectorAll('[data-warehouse-upgrade]').forEach((button) => {
                button.addEventListener('click', () => this._upgradeWarehouse(button.dataset.warehouseUpgrade));
            });
            modBox.querySelectorAll('[data-warehouse-row]').forEach((row) => {
                row.addEventListener('mouseenter', (event) => this._showWarehouseTip(row.dataset.warehouseRow, event));
                row.addEventListener('mousemove', (event) => this._moveAbilityTip(event));
                row.addEventListener('mouseleave', () => this._hideAbilityTip());
            });
            return;
        }
        if (isPortal) {
            if (sellBtn && (b._isWorldPortalCore || b._isMainHubPortalBuilding)) sellBtn.style.display = 'none';
            const currentScene = SceneManager.currentScene;
            const sourceOperational = !b._portalDestroyed && b.hp > 0;
            const travelWorlds = WorldProgressionSystem.getTravelWorlds()
                .filter((entry) => entry.sceneId !== currentScene);
            const destinations = sourceOperational
                ? [...(currentScene === 'main' ? [] : [{ sceneId: 'main', name: '主神空间', icon: '🏛️' }]), ...travelWorlds]
                : [];
            const constructable = WorldProgressionSystem.getConstructableWorlds();
            st.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                    <div style="font-size:13px;font-weight:700;color:#b8a8ff;">跨世界传送</div>
                    <button id="pbPortalConstructToggle" style="background:#47385f;color:#f2e8ff;border:1px solid #8870ae;border-radius:6px;padding:5px 9px;cursor:pointer;">构造传送门</button>
                </div>
                <div style="font-size:12px;color:#c8b98a;line-height:1.8;">
                    ${sourceOperational
                        ? '选择已接入传送网络的世界。所有世界的建筑、时间与入侵状态会持续保存。'
                        : '<span style="color:#ff7766;">该世界传送门已被摧毁，必须先重建才能传送。</span>'}
                </div>`;
            const travelHtml = destinations.length
                ? `<div style="display:grid;grid-template-columns:1fr;gap:8px;">${destinations.map((entry) => `
                    <button data-portal-destination="${entry.sceneId}" style="background:#302a58;color:#e8e0ff;border:1px solid #7566b0;border-radius:7px;padding:9px 10px;cursor:pointer;text-align:left;">
                        <b style="font-size:14px;">${entry.icon || '🌀'} ${entry.name || entry.label || entry.sceneId}</b>
                        <span style="display:block;font-size:11px;color:#b8a8d8;margin-top:2px;">点击传送</span>
                    </button>`).join('')}</div>`
                : '<div style="font-size:12px;color:#8a8a8a;">暂无可用的传送目的地。</div>';
            const constructHtml = !this._portalBuildOpen ? '' : `
                <div style="margin-top:10px;padding-top:10px;border-top:1px solid #453b58;">
                    <div style="font-size:12px;font-weight:700;color:#d8c8ff;margin-bottom:7px;">可构造世界</div>
                    ${constructable.length ? constructable.map((entry) => {
                        const costText = entry.firstConstruction
                            ? '首次构造免费'
                            : `重建：${entry.cost.gold || 0} 金币 + ${entry.cost.energy || 0} 能源`;
                        return `<button data-portal-construct="${entry.sceneId}" style="display:block;width:100%;margin-top:6px;background:#3d3428;color:#ffe4ba;border:1px solid #8a704d;border-radius:7px;padding:9px 10px;cursor:pointer;text-align:left;">
                            <b>${entry.icon || '🌀'} ${entry.name || entry.sceneId}</b>
                            <span style="display:block;font-size:11px;color:#cdb58f;margin-top:2px;">${costText}</span>
                        </button>`;
                    }).join('') : '<div style="font-size:12px;color:#8a8a8a;">暂无可以构造传送门的世界</div>'}
                </div>`;
            modBox.innerHTML = travelHtml + constructHtml;
            st.querySelector('#pbPortalConstructToggle')?.addEventListener('click', () => {
                this._portalBuildOpen = !this._portalBuildOpen;
                this.refresh();
            });
            modBox.querySelectorAll('[data-portal-destination]').forEach((button) => {
                button.addEventListener('click', () => this._teleport(button.dataset.portalDestination));
            });
            modBox.querySelectorAll('[data-portal-construct]').forEach((button) => {
                button.addEventListener('click', () => this._constructPortal(button.dataset.portalConstruct));
            });
            return;
        }
        if (isPassive) {
            st.innerHTML = `
                <div style="font-size:13px;font-weight:700;color:#d4e8ff;margin-bottom:6px;">基础建筑属性</div>
                <div style="font-size:12px;color:#c8b98a;line-height:1.8;">
                    物理防御：<b style="color:#7ab8ff;">${b.def ?? cfg.def ?? 0}</b> ·
                    魔法防御：<b style="color:#c9a0ff;">${b.mdef ?? cfg.mdef ?? 0}</b><br>
                    ${cfg.panelDescription || '暂无额外功能。'}
                </div>`;
            modBox.innerHTML = '<div style="font-size:12px;color:#8a8a8a;">该建筑暂未配置额外功能。</div>';
            return;
        }
        // ===== 铁匠铺：能力工坊版（覆盖上方出兵版渲染，2026-08-17）=====
        if (isAbilityShop) {
            const workshopTitle = cfg.workshopTitle || '能力工坊';
            const workshopDesc = cfg.workshopDesc || '不生成兵种，为仓鼠单位解锁特殊能力';
            const scopeText = cfg.workshopType === 'research'
                ? '研究完成后立即作用于场上与后续新建结构'
                : '升级完成后能力全局生效（所有对应兵种）';
            st.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div><span style="color:#ffd700;font-weight:700;">${workshopTitle}</span></div>
                    <div style="font-size:12px;color:#9a9a9a;">金币 <span style="color:#ffd700;">${gold}</span> · 能源 <span style="color:#7fd4ff;">${energy}</span></div>
                </div>
                <div style="font-size:12px;color:#c8b98a;line-height:1.7;">
                    ${workshopDesc}<br>
                    升级需要读条，${scopeText}
                </div>`;
            const modBoxEl = el.querySelector('#pbModules');
            const rows = Object.entries(cfg.abilities || {}).map(([aid, a]) => {
                const lv = b.abilityLevel(aid);
                const maxed = lv >= (a.maxLevel ?? 10);
                const inProgress = !!(b._upgrade && b._upgrade.abilityId === aid);
                const progPct = inProgress ? Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100) : 0;
                const cont = b._continuous === aid;
                const cost = b.getAbilityCost(aid);
                const btnHtml = maxed
                    ? '<span style="color:#8a8a8a;font-size:12px;width:86px;display:inline-block;text-align:center;">已满级</span>'
                    : `<div style="display:flex;gap:4px;flex-shrink:0;">
                        <button data-ability-up="${aid}" style="width:86px;white-space:nowrap;background:#4a5a2a;color:#e8ffc8;border:1px solid #7a9a4a;border-radius:6px;padding:3px 0;cursor:pointer;font-size:12px;">升级</button>
                        <button data-ability-cont="${aid}" style="width:86px;white-space:nowrap;background:${cont ? '#2a6a5a' : '#263a32'};color:${cont ? '#e8fff5' : '#9ab8ac'};border:1px solid ${cont ? '#4aa88a' : '#3a6a5a'};border-radius:6px;padding:3px 0;cursor:pointer;font-size:12px;">${cont ? '持续中' : '持续升级'}</button>
                    </div>`;
                return renderBuildingUpgradeCard({
                    rowAttribute: 'data-ability-row', projectId: aid,
                    icon: a.icon, iconImage: a.iconImage, name: a.name, level: lv, maxLevel: a.maxLevel ?? 10,
                    cost, maxed, inProgress, progressPct: progPct,
                    remainMs: inProgress ? b._upgrade.remainMs : 0,
                    barId: `pbUpgradeBar_${aid}`, textId: `pbUpgradeText_${aid}`,
                    actionsHtml: btnHtml, accent: '#c9a0ff',
                    technologyGateType: 'upgrade', technologyGateId: aid,
                });
            }).join('');
            modBoxEl.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="font-size:13px;font-weight:700;color:#c9a0ff;">✨ 特殊能力（读条升级，全局生效）</span>
                    <span style="font-size:12px;color:#9a9a9a;">持有 ${gold} 金 / ${energy} 能</span>
                </div>
                ${rows || '<div style="font-size:12px;color:#8a8a8a;">暂无能力</div>'}`;
            TechnologyGate.bindTree(modBoxEl);
            modBoxEl.querySelectorAll('[data-ability-up]').forEach((btnEl) => {
                btnEl.addEventListener('click', () => this._upgradeAbility(btnEl.dataset.abilityUp, false));
            });
            modBoxEl.querySelectorAll('[data-ability-cont]').forEach((btnEl) => {
                btnEl.addEventListener('click', () => this._upgradeAbility(btnEl.dataset.abilityCont, true));
            });
            modBoxEl.querySelectorAll('[data-ability-row]').forEach((rowEl) => {
                const aid = rowEl.dataset.abilityRow;
                rowEl.addEventListener('mouseenter', (ev) => this._showAbilityTip(aid, ev));
                rowEl.addEventListener('mousemove', (ev) => this._moveAbilityTip(ev));
                rowEl.addEventListener('mouseleave', () => this._hideAbilityTip());
            });
        }
    }

    _setUnitType(type) {
        if (!this.building) return;
        if (this.building.setUnitType(type)) {
            const name = this.building.unitName(type);
            this._notify(`${this.building._cfg.name}改为生成 ${name}`, '#7fe0c8');
        }
        this.refresh();
    }

    _setRecruitMode(mode) {
        if (!this.building) return;
        const result = this.building.setRecruitMode(mode);
        if (result.ok) {
            this._notify(`${this.building._cfg.name}：${recruitModeLabel(result.mode)}`, '#7fe0c8');
        } else {
            this._notify(result.reason, '#ff7755');
        }
        this.refresh();
    }

    _setParallelRecruitMode(kind, mode) {
        if (!this.building) return;
        const result = this.building.setParallelRecruitMode(kind, mode);
        this._notify(result.ok
            ? `${this.building.unitName(kind)}：${recruitModeLabel(result.mode)}`
            : result.reason, result.ok ? '#7fe0c8' : '#ff7755');
        this.refresh();
    }

    _upgrade(moduleId) {
        if (!this.building) return;
        const res = this.building.upgradeModule(moduleId, this.player);
        if (res.ok) {
            this._notify(`${this.building._cfg.modules[moduleId].name} 开始升级（读条 ${Math.round(res.cost.timeMs / 1000)}s）`, '#8ad0ff');
        } else {
            this._notify(res.reason, '#ff5555');
        }
        this.refresh();
    }

    _getEconomySecondaryProgress(building, workforce) {
        if (!building || !workforce) return { label: '本轮生产', pct: 0, text: '0%' };
        if (building._economyType === 'workshop') {
            const snapshot = WorkshopEconomySystem.getSnapshot(building);
            const configured = Math.max(0, Number(snapshot.configuredEfficiency) || 0);
            const actual = Math.max(0, Number(snapshot.actualEfficiency) || 0);
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return { label: '增效发挥', pct, text: `${pct}% · 实际 +${(actual * 100).toFixed(1)}%` };
        }
        if (building._economyType === 'market') {
            const quote = PopulationEconomySystem.getMarketQuote(building);
            const pct = workforce.slots > 0
                ? Math.round(Math.max(0, Math.min(1, quote.effectiveWorkers / workforce.slots)) * 100)
                : 0;
            return { label: '交易效率', pct, text: `${pct}% · ${quote.effectiveWorkers.toFixed(2)} 人效` };
        }
        if (building._economyType === 'windmill') {
            const actual = Math.max(0, PopulationEconomySystem.getWindmillFoodPerSecond(building));
            const configured = Math.max(0,
                workforce.slots * (Number(populationEconomyConfig.windmill?.foodPerWorkerPerSecond) || 0)
            );
            const pct = configured > 0
                ? Math.round(Math.max(0, Math.min(1, actual / configured)) * 100)
                : 0;
            return { label: '粮食产量', pct, text: `${pct}% · ${actual.toFixed(2)} 粮食/秒` };
        }
        if (building._economyType === 'bank') {
            const snapshot = PopulationEconomySystem.getBankSnapshot(building);
            const operating = snapshot.goldPerSettlement > 0;
            const progress = operating && snapshot.settlementIntervalMs > 0
                ? Math.max(0, Math.min(1, (Number(building._economyTickMs) || 0) / snapshot.settlementIntervalMs))
                : 0;
            const pct = Math.round(progress * 100);
            const remainSeconds = Math.max(0, snapshot.settlementIntervalMs
                - (Number(building._economyTickMs) || 0)) / 1000;
            return {
                label: '金币结算',
                pct,
                text: operating
                    ? `${pct}% · ${remainSeconds.toFixed(1)}s · 本轮 ${snapshot.goldPerSettlement.toFixed(2)} 金币`
                    : '待命',
            };
        }
        return { label: '本轮生产', pct: 0, text: '0%' };
    }

    _renderWorkforceControls(building) {
        const workforce = PopulationEconomySystem.getWorkerSnapshot(building);
        if (!workforce) return '';
        const population = workforce.population;
        const workforcePct = workforce.slots > 0 ? Math.round(workforce.assigned / workforce.slots * 100) : 0;
        const secondaryProgress = this._getEconomySecondaryProgress(building, workforce);
        return `<div class="economy-workforce">
            <div class="economy-workforce-copy">
                <div class="economy-workforce-label"><span>${workforce.label}岗位</span><b id="pbEconomyWorkers">${workforce.assigned}/${workforce.slots} · 人口效率 ${Math.round(workforce.laborEfficiency * 100)}%</b></div>
                <div class="economy-progress-label"><span>岗位安排</span><b id="pbEconomyWorkforcePct">${workforcePct}%</b></div>
                <div class="economy-progress"><div id="pbEconomyWorkforceBar" style="width:${workforcePct}%"></div></div>
                <div class="economy-progress-label"><span>${secondaryProgress.label}</span><b id="pbEconomyProductionPct">${secondaryProgress.text}</b></div>
                <div class="economy-progress"><div id="pbEconomyProductionBar" style="width:${secondaryProgress.pct}%"></div></div>
                <div class="economy-workforce-note">${population.overcrowded > 0 ? `<span class="is-warning">人口超额 ${population.overcrowded}，所有岗位按比例降效</span>` : '岗位只占用人口数值，不创建平民实体'}</div>
            </div>
            <div class="economy-workforce-actions">
                <button class="troop-panel-unit-button" data-worker-delta="-1" ${workforce.assigned <= 0 ? 'disabled' : ''}>−1</button>
                <button class="troop-panel-unit-button" data-worker-delta="1" ${workforce.freeSlots <= 0 || population.free <= 0 ? 'disabled' : ''}>+1</button>
                <button class="troop-panel-unit-button" data-worker-max ${workforce.freeSlots <= 0 || population.free <= 0 ? 'disabled' : ''}>最大</button>
            </div>
        </div>`;
    }

    _upgradeWorkshop(moduleId) {
        if (!this.building) return;
        const result = WorkshopEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#77c8d9' : '#ff5555');
        this.refresh();
    }

    _showWorkshopTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = WorkshopEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => module.effect === 'workshopRange'
            ? `${Math.round(value)}px`
            : (module.effect === 'workshopEngineerCount'
                ? `${Math.round(value)} 名`
                : `${(value * 100).toFixed(1)}%`);
        const cost = WorkshopEconomySystem.getUpgradeCost(this.building, moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋工坊独立升级；出售后不保留等级</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>
            <div>${maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeBank(moduleId) {
        if (!this.building) return;
        const result = BankEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#e4bd55' : '#ff5555');
        this.refresh();
    }

    _showBankTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = BankEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'bankSettlementSpeed') {
                const baseInterval = Math.max(100, Number(populationEconomyConfig.bank?.settlementIntervalMs) || 10000);
                return `速度 +${Math.round(value * 100)}%（${(baseInterval / (1 + value) / 1000).toFixed(2)}秒/轮）`;
            }
            if (module.effect === 'bankStaffCapacity') return `${Math.round(value)} 名`;
            if (module.effect === 'bankServiceRange') return `${Math.round(value)}px`;
            return `${(value * 100).toFixed(0)}% 金币/人/轮`;
        };
        const cost = BankEconomySystem.getUpgradeCost(this.building, moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋银行独立升级；出售后不保留等级</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>
            <div>${maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _upgradeWarehouse(moduleId) {
        if (!this.building) return;
        const result = WarehouseEconomySystem.startUpgrade(this.building, moduleId);
        const name = this.building._cfg.modules?.[moduleId]?.name || moduleId;
        this._notify(result.ok ? `${name}开始升级（${Math.round(result.cost.timeMs / 1000)}秒）` : result.reason,
            result.ok ? '#7fd4ff' : '#ff5555');
        this.refresh();
    }

    _showWarehouseTip(moduleId, event) {
        if (!this.building) return;
        const module = this.building._cfg.modules?.[moduleId];
        if (!module) return;
        const level = WarehouseEconomySystem.getModuleLevel(this.building, moduleId);
        const maxed = level >= module.maxLevel;
        const valueAt = (atLevel) => (Number(module.base) || 0) + (Number(module.per) || 0) * atLevel;
        const format = (value) => {
            if (module.effect === 'warehouseCapacity') return `${Math.round(value)} 容量`;
            if (module.effect === 'warehouseCrossPlaneSurcharge') {
                return `额外消耗 +${Math.max(0, Math.round(value * 100))}%`;
            }
            return `容量占用 -${Math.max(0, Math.round(-value * 100))}%`;
        };
        const cost = WarehouseEconomySystem.getUpgradeCost(this.building, moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(module.icon, module.iconImage, 'building-upgrade-tooltip-icon')}<span>${module.name}</span> <span style="color:#8a5a00;">Lv.${level}/${module.maxLevel}</span></div>
            <div>${format(valueAt(level))}${maxed ? '' : ` → ${format(valueAt(level + 1))}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">本栋仓库独立升级；出售或被毁后不保留等级</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>
            <div>${maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, event);
    }

    _bindWorkforceControls(root) {
        root?.querySelectorAll('[data-worker-delta]').forEach((button) => {
            button.addEventListener('click', () => this._adjustWorkers(Number(button.dataset.workerDelta) || 0));
        });
        root?.querySelector('[data-worker-max]')?.addEventListener('click', () => this._assignMaxWorkers());
    }

    _adjustWorkers(delta) {
        if (!this.building) return;
        const result = PopulationEconomySystem.adjustAssignedWorkers(this.building, delta);
        this._notify(result.ok ? `岗位人口调整为 ${result.assigned}/${result.slots}` : result.reason, result.ok ? '#7fe0c8' : '#ff5555');
        this.refresh();
    }

    _assignMaxWorkers() {
        if (!this.building) return;
        const result = PopulationEconomySystem.assignMaxWorkers(this.building);
        this._notify(result.ok ? `已分配 ${result.assigned}/${result.slots} 人` : result.reason, result.ok ? '#7fe0c8' : '#ff5555');
        this.refresh();
    }

    _upgradeHouse() {
        if (!this.building) return;
        const result = PopulationEconomySystem.startHouseUpgrade(this.building);
        this._notify(result.ok ? `房屋开始升级到 Lv.${result.targetLevel}` : result.reason, result.ok ? '#ffe08a' : '#ff5555');
        this.refresh();
    }

    _marketBuy() {
        if (!this.building) return;
        const result = PopulationEconomySystem.buyGold(this.building);
        this._notify(result.ok ? `市场成交：-${result.energy} 能源，+${result.gold} 金币` : result.reason, result.ok ? '#7fd4ff' : '#ff5555');
        this.refresh();
    }

    _marketSell() {
        if (!this.building) return;
        const result = PopulationEconomySystem.sellGold(this.building);
        this._notify(result.ok ? `市场成交：-${result.gold} 金币，+${result.energy} 能源` : result.reason, result.ok ? '#ffe08a' : '#ff5555');
        this.refresh();
    }

    /** 铁匠铺能力升级（读条）或持续升级切换（2026-08-17） */
    _upgradeAbility(abilityId, continuous) {
        if (!this.building) return;
        const b = this.building;
        if (continuous) {
            // 持续升级：目标能力切换持续状态；已持续则取消
            if (b._continuous === abilityId) {
                b._continuous = null;
                this._notify(`${b.getAbility(abilityId)?.name || abilityId} 停止持续升级`, '#ffd700');
            } else {
                // 读条中禁止改挂另一能力，避免旧读条完成后留下“持续中但未启动”的悬空状态
                if (b._upgrade) {
                    this._notify('当前能力正在升级，请完成后再切换持续升级', '#ffb86a');
                    this.refresh();
                    return;
                }
                const res = b.startAbilityUpgrade(abilityId, true);
                if (res.ok) {
                    this._notify(`${b.getAbility(abilityId)?.name || abilityId} 持续升级开启（资源足够自动续升）`, '#c9a0ff');
                } else {
                    b._continuous = null;
                    this._notify(res.reason, '#ff5555');
                }
            }
        } else {
            const res = b.startAbilityUpgrade(abilityId, false);
            if (res.ok) {
                this._notify(`${b.getAbility(abilityId)?.name || abilityId} 开始升级（读条 ${Math.round(res.cost.timeMs / 1000)}s）`, '#c9a0ff');
            } else {
                this._notify(res.reason, '#ff5555');
            }
        }
        this.refresh();
    }

    _teleport(sceneId) {
        const player = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        if (!player || !sceneId || SceneManager.isLoading) return;
        if (this.building?._portalDestroyed || !(this.building?.hp > 0)) {
            this._notify('传送门已被摧毁，重建后才能传送', '#ff5555');
            return;
        }
        if (sceneId !== 'main' && !WorldProgressionSystem.isPortalConstructed(sceneId)) {
            this._notify('目标世界尚未接入传送网络', '#ff5555');
            return;
        }
        if (SceneManager.currentScene === sceneId) {
            this._notify('已经在该世界中', '#ffd700');
            return;
        }
        this.close();
        return SceneManager.switchScene(sceneId, player, undefined, { portalTravel: true }).catch((err) => {
            console.error('[portal building] switchScene error:', err);
            this._notify('传送失败，请稍后重试', '#ff5555');
        });
    }

    _constructPortal(sceneId) {
        if (!TechnologySystem.isUnlocked('building', 'portal')) {
            this._notify('需要先研发位面工程', '#ffb35c');
            return;
        }
        const result = WorldProgressionSystem.constructPortal(sceneId);
        if (!result.ok) {
            this._notify(result.reason || '传送门构造失败', '#ff5555');
            return;
        }
        if (sceneId === SceneManager.currentScene && this.building?._isWorldPortalCore) {
            WorldProgressionSystem.revivePortalEntity(sceneId, this.building);
        }
        const world = WorldProgressionSystem.getWorldConfig(sceneId);
        this._notify(`${world?.name || sceneId}传送门${result.firstConstruction ? '构造完成' : '重建完成'}`, '#b8a8ff');
        this.refresh();
    }

    /** 出兵建筑模块说明：复用研究院/铁匠铺的白色悬停浮窗。 */
    _showModuleTip(moduleId, ev) {
        if (!this.building) return;
        const b = this.building;
        const mod = b._cfg.modules?.[moduleId];
        if (!mod || !moduleAppliesToUnit(mod, b.unitType)) return;
        const lv = getUnitUpgradeLevel(b.unitType, moduleId);
        const maxed = lv >= mod.maxLevel;
        const desc = getProducerModuleDesc(b._cfg, moduleId, lv);
        const cost = b.getModuleCost(moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(mod.icon, mod.iconImage, 'building-upgrade-tooltip-icon')}<span>${mod.name}</span> <span style="color:#8a5a00;">Lv.${lv}/${mod.maxLevel}</span></div>
            <div>${maxed ? desc.current : `${desc.current} → ${desc.next}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">适用兵种：${b.unitName(b.unitType)}</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>`, ev);
    }

    /** 能力说明浮窗（类似装备栏白色浮窗，2026-08-17）：悬停能力行时显示 */
    _showAbilityTip(abilityId, ev) {
        if (!this.building) return;
        const b = this.building;
        const a = b.getAbility(abilityId);
        if (!a) return;
        const lv = b.abilityLevel(abilityId);
        const maxed = lv >= (a.maxLevel ?? 10);
        const cost = b.getAbilityCost(abilityId);
        const isResearch = b._cfg.workshopType === 'research';
        const targetLabel = isResearch ? '目标效果' : '目标兵种';
        const targetText = isResearch ? (a.target || '—') : this._abilityTargetText(a.target);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(a.icon, a.iconImage, 'building-upgrade-tooltip-icon')}<span>${a.name}</span> <span style="color:#8a5a00;">Lv.${lv}/${a.maxLevel ?? 10}</span></div>
            <div>${maxed ? this._fillAbilityDesc(a, lv) : `${this._fillAbilityDesc(a, lv)} → ${this._fillAbilityDesc(a, lv + 1)}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">${targetLabel}：${targetText}</div>
            <div style="margin-top:2px;">升级费用：${cost.gold} 金币 + ${cost.energy} 能源</div>
            <div>读条时间：${Math.round(cost.timeMs / 1000)} 秒</div>`, ev);
    }

    /** 浮窗跟随鼠标（右侧优先，越界翻转到左侧/上方） */
    _moveAbilityTip(ev) {
        moveBuildingUpgradeTooltip(ev);
    }

    _hideAbilityTip() {
        hideBuildingUpgradeTooltip();
    }
}

// ==================== 系统 ====================

export const ProducerBuildingSystem = {
    active: false,
    buildings: [],
    _panel: null,
    _seq: 0,

    _ensurePanel() {
        if (!this._panel) this._panel = new ProducerBuildingPanel();
        return this._panel;
    },

    setup() {
        this.teardown();
        this.active = true;
        this.buildings = [];
        ResearchSystem.resetTimer();
        if (EnergyManager) {
            EnergyManager.setCallbacks({
                onFull: (text) => {
                    if (Game && Game.player && EffectManager) {
                        EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 64, text, '#ff8855'));
                    }
                },
            });
        }
    },

    teardown() {
        this.active = false;
        ResearchSystem.resetTimer();
        for (const b of this.buildings) {
            if (b) {
                if (b._isEnergyWarehouse && EnergyManager) {
                    // 粮食已逐仓写入位面快照，不能再放入跨场景 pending 队列造成重复/串位面。
                    EnergyManager.unregisterWarehouse(b, { preserve: true, preserveFood: false });
                }
                b.active = false;
                HamsterFarmerVisualSystem.clearBuilding(b);
                HamsterBankerVisualSystem.clearBuilding(b);
                BankEconomySystem.unregisterBuilding(b);
                WorkshopEconomySystem.unregisterBuilding(b);
                WarehouseEconomySystem.unregisterBuilding(b);
                b._despawnUnits();
                if (Game && Game.entities && b.id) Game.entities.delete(b.id);
            }
        }
        this.buildings = [];
        HamsterFarmerVisualSystem.reset();
        HamsterBankerVisualSystem.reset();
        BankEconomySystem.reset();
        WorkshopEconomySystem.reset();
        WarehouseEconomySystem.reset();
        PopulationEconomySystem.reset();
        if (this._panel) {
            if (this._panel.isOpen) this._panel.close();
            this._panel.building = null;
            this._panel.player = null;
        }
    },

    update(dt) {
        if (!this.active) return;
        ResearchSystem.update(dt);
        for (const b of this.buildings) {
            if (b && b.active) b.update(dt);
        }
    },

    /** 点击产兵建筑 → 打开面板（再次点击关闭） */
    tryInteract(mx, my, player) {
        if (!this.active || !player) return false;
        const mw = Renderer.screenToWorld(mx, my);
        const buildMode = !!(Game && Game._buildMode);   // 建设模式无视距离
        let picked = null;
        let pickedScore = Infinity;
        for (const b of this.buildings) {
            if (!b || !b.active) continue;
            const pdx = b.x - player.x;
            const pdy = b.y - player.y;
            if (!buildMode && Math.sqrt(pdx * pdx + pdy * pdy) > 260) continue;
            const cfg = b._cfg;
            const displayW = Number(b.spriteCfg?.size) || cfg.displayW;
            const displayH = Number(b.spriteCfg?.sizeH) || cfg.displayH;
            const hit = { cx: 0, cy: -Math.round(displayH * 0.4), hw: Math.round(displayW / 2), hh: Math.round(displayH * 0.44) };
            const visualX = b.x + (b._visualFootOffsetX || 0);
            if (mw.x < visualX + hit.cx - hit.hw || mw.x > visualX + hit.cx + hit.hw
                || mw.y < b.y + hit.cy - hit.hh || mw.y > b.y + hit.cy + hit.hh) continue;
            // 同类2×2建筑相邻时命中盒可能重叠；选择离点击点最近的实例，
            // 禁止数组中的第一栋建筑抢走交互，造成“所有同类建筑同步切兵种”的错觉。
            const dx = (mw.x - (visualX + hit.cx)) / Math.max(1, hit.hw);
            const dy = (mw.y - (b.y + hit.cy)) / Math.max(1, hit.hh);
            const score = dx * dx + dy * dy;
            if (score < pickedScore) {
                picked = b;
                pickedScore = score;
            }
        }
        if (!picked) return false;
        if (picked._cfg?.panelMode === 'tribute') {
            if (World122TributeSystem.isOpenFor(picked)) World122TributeSystem.closePanel();
            else World122TributeSystem.openFor(picked, player);
            return true;
        }
        const panel = this._ensurePanel();
        if (panel.isOpen && panel.building === picked) panel.close();
        else panel.openFor(picked, player);
        return true;
    },

    closePanel() {
        if (this._panel && this._panel.isOpen) this._panel.close();
    },
};
