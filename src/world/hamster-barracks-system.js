// ============================================================
// 仓鼠兵营旧兼容模块（游戏运行时已于2026-08-23迁入 ProducerBuildingSystem）
// 仅供历史诊断脚本继续导入；主流程禁止重新 setup 或创建本类。
// - B 建筑面板放置，价格 1600 能源；每 45 秒自动生成一个仓鼠军事单位（2026-08-18 由 30s 调整为 45s）；
// - 单位类型可在面板切换：仓鼠战士（近战）/ 仓鼠盾卫（近战·第 10 帧判定）
//   （2026-08-18 收口：射手迁靶场、民兵迁草屋，兵营只保留战士/盾卫；切换兵种重新计时）；
// - 升级参考仓鼠小屋（1000 金币 + 500 能源/级）：攻击加速 / 攻击强化 /
//   机动强化 / 生命强化（采矿/背包/数量模块不复制——兵营数量上限固定 5，
//   2026-08-16 用户口径：初始上限就有 5 个）；
// - 单位死亡后兵营按 45s 节奏补员，直到达到数量上限。
// ============================================================
import { Game } from '../game.js';
import { DamageableEntity } from '../entities/damageable-entity.js';
import { HamsterWarrior } from '../entities/hamster-warrior.js';
import { HamsterGuard } from '../entities/hamster-guard.js';
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { BuildingSinkEffect } from '../effects/building-sink.js';
import { SoundManager } from '../ui/sound-manager.js';
import { BasePanel } from '../ui/panels/base-panel.js';
import { renderBuildingDetailHeader } from '../ui/panels/building-detail-header.js';
import { renderBuildingUpgradeCard, renderBuildingUpgradeIcon } from '../ui/panels/building-upgrade-card.js';
import { releaseLightweightProjectImages } from '../ui/dom-project-image.js';
import { mountRightSidebarPanel } from '../ui/right-sidebar-panel-layer.js';
import { TechnologyGate } from '../ui/technology-gate.js';
import {
    refreshProducerRallySection,
    renderProducerRallySection,
} from '../ui/panels/producer-rally-section.js';
import {
    ensureBuildingUpgradeTooltip,
    hideBuildingUpgradeTooltip,
    moveBuildingUpgradeTooltip,
    showBuildingUpgradeTooltip,
} from '../ui/panels/building-upgrade-tooltip.js';
import { WallSystem } from './wall-system.js';
import { setupStructureDepth } from './structure-depth.js';
import { Renderer } from './renderer.js';
import warriorCfg from '../../data/hamster-warrior-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import barracksBuildingCfg from '../../data/hamster-barracks-building.json';
import { TWO_BY_TWO_BUILDING_FOOT, applyBuildingFootprint } from './building-footprint.js';
import { ResearchSystem } from './research-system.js';
import { SpawnPlacement } from './spawn-placement.js';
import { RECRUIT_MODE, normalizeRecruitMode, recruitModeLabel, recruitStatusText } from './recruit-mode.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { TroopLineSystem } from './troop-line-system.js';
import { SceneManager } from './scene-manager.js';
import { TechnologySystem } from './technology-system.js';
import { hasBackgroundBuildingUpgrade, hasBackgroundContinuousUpgrade } from './world122-snapshot.js';
import { PopulationEconomySystem } from './population-economy-system.js';
import { CrossPlaneResourceSystem } from './cross-plane-resource-system.js';
import {
    applyGlobalUpgradesToKind,
    getUpgradeMultsFromLevels,
    getUnitUpgradeLevel,
    getUnitUpgradeMults,
    raiseUnitUpgradeLevel,
} from './unit-upgrade-store.js';
import {
    buildingContinuousTargetMatches,
    getBuildingContinuousCategory,
    getBuildingModuleUpgradeCost,
    getBuildingUpgradeProject,
    isBuildingContinuousUpgradeOccupied,
    isBuildingUpgradeProgressOccupied,
    normalizeBuildingContinuousTarget,
} from './building-upgrade-projects.js';
import { getHamsterUnitIcon } from '../config/hamster-unit-icons.js';

// ==================== 配置 ====================

const BARRACKS_UPGRADE_PROJECT = getBuildingUpgradeProject('barracks_defense') || {};

export const BARRACKS_CONFIG = {
    barracks: {
        ...barracksBuildingCfg,
        radius: TWO_BY_TWO_BUILDING_FOOT.collisionRadius,
    },
    // 可生成的军事单位（基准值读 data/hamster-*-config.json，此处只做展示名；
    // 2026-08-18 清理死注册：射手迁靶场、民兵迁草屋，兵营只保留战士/盾卫）
    unit: {
        warrior: { key: 'warrior', name: '仓鼠战士', cfg: warriorCfg },
        guard: { key: 'guard', name: '仓鼠盾卫', cfg: guardCfg },
    },
    // 兵营与常规产兵建筑复用同一独立升级项目。
    upgradeProject: barracksBuildingCfg.upgradeProject,
    upgradeCost: BARRACKS_UPGRADE_PROJECT.moduleUpgrade || {},
    modules: BARRACKS_UPGRADE_PROJECT.modules || {},
};

function renderTroopUnitIcon(unitKind, modifier = '') {
    const iconPath = getHamsterUnitIcon(unitKind);
    if (!iconPath) return '';
    const modifierClass = modifier ? ` troop-unit-icon--${modifier}` : '';
    return `<img class="troop-unit-icon${modifierClass}" src="${iconPath}" alt="" draggable="false">`;
}

function renderBarracksUpgradeActions(options = {}) {
    const { moduleId, maxed, inProgress, continuous, upgradeBusy } = options;
    if (maxed) return '<span class="troop-panel-caption">已满级</span>';
    return `<div class="building-upgrade-action-group">
        <button class="troop-panel-upgrade-button" data-mod="${moduleId}" ${upgradeBusy || inProgress ? 'disabled' : ''}>升级</button>
        <button class="troop-panel-upgrade-button building-upgrade-continuous-button ${continuous ? 'is-active' : ''}"
            data-module-cont="${moduleId}" ${upgradeBusy && !continuous ? 'disabled' : ''}>${continuous ? '持续中' : '持续升级'}</button>
    </div>`;
}

/** 模块升级费用（统一）：1000 金币 + 500 能源 */
export function getBarracksModuleCost(moduleId, currentLevel) {
    return getBuildingModuleUpgradeCost(BARRACKS_CONFIG, moduleId, currentLevel);
}

/** 面板用：模块当前/下一级描述文本 */
export function getBarracksModuleDesc(moduleId, level) {
    const mod = BARRACKS_CONFIG.modules?.[moduleId];
    if (!mod) return '';
    const pct = Math.abs(mod.per) * 100;
    const pctAt = (atLevel) => Number((pct * atLevel).toFixed(1)).toString();
    return {
        current: mod.desc.replace('{pct}', pctAt(level)),
        next: mod.desc.replace('{pct}', pctAt(level + 1)),
    };
}

/** 兵营当前模块倍率表 */
export function getBarracksMults(modules) {
    return getUpgradeMultsFromLevels(BARRACKS_CONFIG.modules, modules);
}

/** 兵营命中盒（世界坐标，相对脚底）：贴图 170×147，覆盖整屋（同小屋口径） */
const BARRACKS_HIT = { cx: 0, cy: -60, hw: 85, hh: 65 };

function pointHitsBarracks(wx, wy, b) {
    const visualX = b.x + (b._visualFootOffsetX || 0);
    return wx >= visualX + BARRACKS_HIT.cx - BARRACKS_HIT.hw && wx <= visualX + BARRACKS_HIT.cx + BARRACKS_HIT.hw
        && wy >= b.y + BARRACKS_HIT.cy - BARRACKS_HIT.hh && wy <= b.y + BARRACKS_HIT.cy + BARRACKS_HIT.hh;
}

// ==================== 仓鼠兵营建筑 ====================

export class HamsterBarracks extends DamageableEntity {
    constructor(x, y, config = {}) {
        const hp = config.hp ?? BARRACKS_CONFIG.barracks.hp;
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: BARRACKS_CONFIG.barracks.displayW,
            collisionRadius: BARRACKS_CONFIG.barracks.radius,
            name: config.name ?? '仓鼠兵营',
        });
        this.id = config.id || `hamster_barracks_${Math.random().toString(36).slice(2, 8)}`;
        this._isHamsterBarracks = true;
        this._isDefenseStructure = true;
        this.noSeparation = true;
        this.immovable = true;
        this._noShadow = true;
        this.def = BARRACKS_CONFIG.barracks.def;
        this.mdef = BARRACKS_CONFIG.barracks.mdef;
        this.spriteCfg = {
            idleKey: BARRACKS_CONFIG.barracks.tex,
            size: BARRACKS_CONFIG.barracks.displayW,
            sizeH: BARRACKS_CONFIG.barracks.displayH,
            footOffsetY: BARRACKS_CONFIG.barracks.footOffsetY,
            visualFootprint: BARRACKS_CONFIG.barracks.visualFootprint
                ? { ...BARRACKS_CONFIG.barracks.visualFootprint } : null,
            autoFootprint: false,
        };
        this.footOffsetY = BARRACKS_CONFIG.barracks.footOffsetY;
        applyBuildingFootprint(this, 2);
        setupStructureDepth(this);
        this.level = 1;
        this.maxLevel = 10;
        this.modules = {};            // { moduleId: level }
        this.unitType = BARRACKS_CONFIG.barracks.defaultUnitType
            || BARRACKS_CONFIG.barracks.unitTypes?.[0]
            || 'warrior';
        this.units = [];              // 本兵营拥有的军事单位
        this._unitSeq = 0;
        this._spawnTimer = 0;
        this._baseSpawnIntervalMs = BARRACKS_CONFIG.barracks.spawnIntervalMs;
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        this._spawnFoodBlocked = false;
        this.spawnEnabled = true;
        this._isTroopProducer = true;
        this._recruitMode = RECRUIT_MODE.PAUSED;
        this._spawnTimer = this.recruitIntervalMs();
        this._upgrade = null;         // 模块升级读条：unitType + moduleId
        this._continuous = null;
        this._continuousRetryMs = 0;
        this._continuousUpgradeCategory = 'producer:hamster_barracks';
        this.rebuildCollider();
    }

    /** 当前兵种全局倍率（2026-08-17 起按兵种全局共享，不再按建筑实例） */
    mults() {
        return getUnitUpgradeMults(this.unitType, BARRACKS_CONFIG.modules);
    }

    /** 目标军事单位数量：固定上限 unitCap=5（初始即有，无需升级） */
    unitCount() {
        return BARRACKS_CONFIG.barracks.unitCap ?? 5;
    }

    /** 当前存活单位数 */
    aliveUnitCount() {
        return TroopLineSystem.countAssignedToProducer(this);
    }

    /** 切换生成的单位类型（战士/盾卫）；下一次生成生效。
     *  2026-08-18：切换兵种重新计时（原来保留 _spawnTimer 进度不变）；
     *  切换为当前兵种视为无操作（返回 false，不打断计时、不发通知）。 */
    setUnitType(type) {
        if (!(BARRACKS_CONFIG.barracks.unitTypes || []).includes(type)) return false;
        if (!TechnologySystem.isUnlocked('unit', type)) return false;
        if (type === this.unitType) return false;
        this.unitType = type;
        this._spawnTimer = this.recruitIntervalMs();
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        return true;
    }

    _unitSpawnFoodCost() {
        return Math.max(0, Math.floor(Number(
            BARRACKS_CONFIG.barracks.unitSpawnFoodCost?.[this.unitType]
        ) || 0));
    }

    setRecruitMode(mode) {
        const next = normalizeRecruitMode(mode);
        if (next === RECRUIT_MODE.SINGLE) {
            if (this.aliveUnitCount() >= this.unitCount()) return { ok: false, reason: '单位数量已达上限' };
            const cost = CrossPlaneResourceSystem.quote({ food: this._unitSpawnFoodCost() }).food;
            if (cost > 0 && CrossPlaneResourceSystem.getAvailable('food') < cost) {
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

    /** 固定出口槽位：墙体、建筑 footprint、动态单位与出口预约全部通过才返回。 */
    _findUnitSpawn() {
        return SpawnPlacement.findAndReserve(this, {
            unitRadius: 24,
            entities: Game?.entities,
            wallSystem: WallSystem,
            preferredTarget: TroopLineSystem.getSpawnDirectionTarget(SceneManager.getCurrentWorldId(), this),
        });
    }

    /** 生成一个军事单位（当前 unitType），应用兵营模块倍率 */
    spawnUnit(payFood = false, options = {}) {
        if (!Game || !Game.entities) return null;
        if (!(BARRACKS_CONFIG.barracks.unitTypes || []).includes(this.unitType)) {
            this.unitType = BARRACKS_CONFIG.barracks.defaultUnitType || 'warrior';
        }
        if (!TechnologySystem.isUnlocked('unit', this.unitType)) return null;
        const unitCfg = BARRACKS_CONFIG.unit[this.unitType];
        const base = unitCfg.cfg || {};
        const baseAi = base.ai || {};
        const mults = this.mults();
        const spot = this._findUnitSpawn();
        if (!spot) return null;
        const spawnCost = this._unitSpawnFoodCost();
        if (payFood && spawnCost > 0 && !PopulationEconomySystem.consumeFood(spawnCost)) {
            this._spawnFoodBlocked = true;
            return null;
        }
        this._spawnFoodBlocked = false;
        const id = `${this.id}_unit_${++this._unitSeq}`;
        const ai = {
            ...baseAi,
            attackInterval: Math.max(300, Math.round((baseAi.attackInterval ?? 2000) * mults.attackIntervalMult)),
            attackDamage: Math.max(1, Math.round((baseAi.attackDamage ?? 50) * mults.attackDamageMult)),
            walkSpeed: Math.max(20, Math.round((baseAi.walkSpeed ?? 120) * mults.moveSpeedMult)),
        };
        const baseMaxHp = Math.max(1, Math.round((base.baseMaxHp ?? 300) * mults.hpMult));
        // 上行已把旧档非战士/盾卫 unitType 纠正为战士，此处只剩两种
        const unit = this.unitType === 'guard'
            ? new HamsterGuard(spot.x, spot.y, { id, ai, baseMaxHp })
            : new HamsterWarrior(spot.x, spot.y, { id, ai, baseMaxHp });
        unit._barracks = this;
        unit._spawnEgress = { x: spot.egressX, y: spot.egressY };
        this.units.push(unit);
        Game.entities.set(id, unit);
        if (Array.isArray(Game.friendlyUnits)) Game.friendlyUnits.push(unit);
        TroopLineSystem.onUnitProduced(
            unit,
            this,
            options.sourceSceneId || SceneManager.getCurrentWorldId(),
            options
        );
        return unit;
    }

    /** 把该兵种全局升级同步给场景内所有该兵种单位（2026-08-17 起跨建筑全局生效） */
    applyUpgradesToUnits() {
        applyGlobalUpgradesToKind(this.unitType, BARRACKS_CONFIG.modules);
    }

    /** 模块是否可升级（未满级即可） */
    canUpgradeModule(moduleId) {
        const mod = BARRACKS_CONFIG.modules?.[moduleId];
        if (!mod) return false;
        return getUnitUpgradeLevel(this.unitType, moduleId) < mod.maxLevel;
    }

    getModuleCost(moduleId) {
        return getBarracksModuleCost(moduleId, getUnitUpgradeLevel(this.unitType, moduleId));
    }

    isContinuousUpgrade(moduleId, unitType = this.unitType) {
        return buildingContinuousTargetMatches(this._continuous, 'module', moduleId, unitType);
    }

    setContinuousUpgrade(moduleId) {
        const target = normalizeBuildingContinuousTarget({
            kind: 'module', moduleId, unitType: this.unitType, unitTypes: [this.unitType],
        });
        if (!target || !BARRACKS_CONFIG.modules?.[moduleId]) {
            return { ok: false, reason: '未知持续升级项目' };
        }
        if (this.isContinuousUpgrade(moduleId, this.unitType)) {
            this._continuous = null;
            this._continuousRetryMs = 0;
            return { ok: true, stopped: true };
        }
        if (this._upgrade) return { ok: false, reason: '当前项目完成后才能切换持续升级' };
        if (isBuildingContinuousUpgradeOccupied(this, Game?.entities)
            || hasBackgroundContinuousUpgrade(getBuildingContinuousCategory(this))) {
            return { ok: false, reason: '同类别建筑已有一个持续升级项目' };
        }
        if (!this.canUpgradeModule(moduleId)) return { ok: false, reason: '模块已满级' };
        this._continuous = target;
        this._continuousRetryMs = 0;
        const result = this._tryStartContinuousUpgrade();
        return result.ok ? { ...result, continuous: true } : {
            ok: true, continuous: true, waiting: true, waitReason: result.reason,
        };
    }

    _tryStartContinuousUpgrade() {
        const target = normalizeBuildingContinuousTarget(this._continuous);
        if (!target || target.kind !== 'module' || !BARRACKS_CONFIG.modules?.[target.moduleId]) {
            return { ok: false, reason: '持续升级目标已失效', permanent: true };
        }
        const selected = this.unitType;
        this.unitType = target.unitType;
        const canUpgrade = this.canUpgradeModule(target.moduleId);
        const result = canUpgrade
            ? this.startModuleUpgrade(target.moduleId, { fromContinuous: true })
            : { ok: false, reason: '模块已满级', permanent: true };
        this.unitType = selected;
        return result;
    }

    _updateContinuousUpgrade(dt) {
        if (!this._continuous || this._upgrade) return;
        this._continuousRetryMs = Math.max(0, (Number(this._continuousRetryMs) || 0) - dt);
        if (this._continuousRetryMs > 0) return;
        const result = this._tryStartContinuousUpgrade();
        if (result.permanent) {
            this._continuous = null;
            this._continuousRetryMs = 0;
        } else if (!result.ok) {
            this._continuousRetryMs = 1000;
        }
        if ((result.ok || result.permanent) && HamsterBarracksSystem?._panel?.isOpen
            && HamsterBarracksSystem._panel.barracks === this) {
            HamsterBarracksSystem._panel.refresh();
        }
    }

    /** 开始模块升级：开始时扣资源，读条完成后才提升等级并同步单位。 */
    startModuleUpgrade(moduleId, options = {}) {
        const mod = BARRACKS_CONFIG.modules?.[moduleId];
        if (!mod) return { ok: false, reason: '未知模块' };
        if (!this.canUpgradeModule(moduleId)) return { ok: false, reason: '模块已满级' };
        if (this._upgrade) return { ok: false, reason: '已有升级在读条中' };
        if (!options.fromContinuous && this._continuous
            && !this.isContinuousUpgrade(moduleId, this.unitType)) {
            return { ok: false, reason: '请先停止当前持续升级项目' };
        }
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

    _updateUpgrade(dt) {
        if (!this._upgrade) {
            this._updateContinuousUpgrade(dt);
            return;
        }
        this._upgrade.remainMs -= dt;
        if (this._upgrade.remainMs > 0) return;
        const { moduleId, unitType } = this._upgrade;
        this._upgrade = null;
        const mod = BARRACKS_CONFIG.modules?.[moduleId];
        const level = raiseUnitUpgradeLevel(unitType, moduleId);
        applyGlobalUpgradesToKind(unitType, BARRACKS_CONFIG.modules);
        if (mod && EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `${mod.name} Lv.${level}`, '#8ad0ff'));
        }
        if (HamsterBarracksSystem?._panel?.isOpen
            && HamsterBarracksSystem._panel.barracks === this) {
            HamsterBarracksSystem._panel.refresh();
        }
        this._continuousRetryMs = 0;
        this._updateContinuousUpgrade(0);
    }

    /** 主循环：每 45s 生成一个军事单位（存活数低于上限时） */
    recruitIntervalMs() {
        return ResearchSystem.getRecruitIntervalMs
            ? ResearchSystem.getRecruitIntervalMs(this._baseSpawnIntervalMs)
            : this._baseSpawnIntervalMs;
    }

    update(dt) {
        if (!this.active) return;
        this._updateUpgrade(dt);
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
                        const cost = BARRACKS_CONFIG.barracks.unitSpawnFoodCost?.[this.unitType] || 0;
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - 66,
                            `粮食不足，生产暂停（需 ${cost}）`, '#ffcc55'));
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
                    const name = (BARRACKS_CONFIG.unit[this.unitType] || {}).name || '仓鼠单位';
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

    /** 兵营被摧毁：单位随兵营消失 */
    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        this._destroyBarracksCleanup();
        if (EffectManager) {
            EffectManager.add(new BuildingSinkEffect(this));
        }
    }

    /** 兵营专属清理（单位/列表/面板）；实体失效与移除由 BuildingSinkEffect 负责 */
    _destroyBarracksCleanup() {
        this._upgrade = null;
        this._continuous = null;
        TroopLineSystem.clearProducerRally(this);
        this._despawnUnits();
        if (HamsterBarracksSystem && HamsterBarracksSystem.barracks) {
            const i = HamsterBarracksSystem.barracks.indexOf(this);
            if (i >= 0) HamsterBarracksSystem.barracks.splice(i, 1);
        }
        if (HamsterBarracksSystem && HamsterBarracksSystem._panel && HamsterBarracksSystem._panel.isOpen
            && HamsterBarracksSystem._panel.barracks === this) {
            HamsterBarracksSystem._panel.close();
        }
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '仓鼠兵营被摧毁', '#ff8855'));
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
        const buildCost = Math.max(0, Number(this._buildCost ?? BARRACKS_CONFIG.barracks.cost) || 0);
        const durability = Math.max(0, Math.min(1, Number(this.hp) / Math.max(1, Number(this.maxHp) || 1)));
        const refund = Math.floor(buildCost * (BARRACKS_CONFIG.barracks.sellRefundRatio ?? 0.5) * durability);
        if (!EnergyManager || !EnergyManager.canStore(refund)) {
            return { ok: false, reason: '仓库空间不足，无法接收出售返还能源' };
        }
        this.hittable = false;
        this._sinking = true;
        this._upgrade = null;
        this._continuous = null;
        TroopLineSystem.clearProducerRally(this);
        this._despawnUnits();
        if (HamsterBarracksSystem && HamsterBarracksSystem.barracks) {
            const i = HamsterBarracksSystem.barracks.indexOf(this);
            if (i >= 0) HamsterBarracksSystem.barracks.splice(i, 1);
        }
        if (EnergyManager) EnergyManager.addEnergy(refund);
        if (HamsterBarracksSystem && HamsterBarracksSystem._panel && HamsterBarracksSystem._panel.isOpen
            && HamsterBarracksSystem._panel.barracks === this) {
            HamsterBarracksSystem._panel.close();
        }
        if (EffectManager) EffectManager.add(new BuildingSinkEffect(this).start());
        return { ok: true, refund };
    }
}

// ==================== 仓鼠兵营面板 ====================

class HamsterBarracksPanel extends BasePanel {
    constructor() {
        super({
            id: 'hamsterBarracksPanel',
            className: 'hamster-barracks-panel',
            stateKey: 'hamsterBarracks',
            panelGroup: 'buildingDetail',
            closeOnEscape: true,
            closeOnOutsidePointer: true,
            shouldCloseOnOutsidePointer: (event) =>
                !window.Game?.BuildingSystem?._eventHitsBuilding?.(event),
            mountElement: (el) => mountRightSidebarPanel(el, 'panel', { bringToFront: true }),
        });
        this.barracks = null;
        this.player = null;
        this._tickTimer = null;   // 出发进度实时刷新定时器（100ms）
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
                <div id="hbTitle" style="font-size:18px;font-weight:700;color:#ffd700;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="hbSell" style="background:#3a2820;color:#ffc9a0;border:1px solid #6a4a2a;border-radius:6px;padding:4px 10px;cursor:var(--bp-cursor-pointer, pointer);">出售</button>
                    <button id="hbClose" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:var(--bp-cursor-pointer, pointer);">关闭</button>
                </div>
            </div>
            <div id="hbBuildingDetail"></div>
            <div class="troop-panel-section-title" style="margin:2px 0 6px;">特殊功能 · 募兵与兵种训练</div>
            <div id="hbStatus" style="border:1px solid #4a4a2a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(60,50,20,0.18);"></div>
            ${renderProducerRallySection()}
            <div id="hbUnitType" style="border:1px solid #3a6a5a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(20,50,40,0.18);"></div>
            <div id="hbModules" style="border:1px solid #3a4a5a;border-radius:8px;padding:10px;background:rgba(20,40,60,0.18);"></div>
        `;
        ensureBuildingUpgradeTooltip();
        el.querySelector('#hbClose').addEventListener('click', () => this.close());
    }

    openFor(barracks, player) {
        this.barracks = barracks;
        this.player = player;
        this.open();
        this.refresh();
        this._startTicking();
    }

    onOpen() {
        this.refresh();
        this._startTicking();
    }

    onClose() {
        this._stopTicking();
        hideBuildingUpgradeTooltip();
        releaseLightweightProjectImages(this.el);
        this.barracks = null;
        this.player = null;
    }

    /** 打开期间每 100ms 实时刷新出发进度（只更新进度条，不重建 DOM） */
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
        if (!el || !this.barracks) return;
        const b = this.barracks;
        refreshProducerRallySection(el, b, SceneManager.getCurrentWorldId());
        const spawnMs = b.recruitIntervalMs();
        const recruitMode = normalizeRecruitMode(b._recruitMode);
        const paused = recruitMode === RECRUIT_MODE.PAUSED;
        const spawnProgress = b._spawnBlocked ? 1 : Math.max(0, Math.min(1, 1 - b._spawnTimer / spawnMs));
        const spawnPct = Math.round(spawnProgress * 100);
        const spawnBarColor = paused ? '#727981' : (b._spawnFoodBlocked ? '#ffcc55' : (b._spawnBlocked ? '#ff7755'
            : (spawnProgress < 0.5 ? '#ffd700' : (spawnProgress < 0.8 ? '#ff9d45' : '#7fe0c8'))));
        const bar = el.querySelector('#hbSpawnBar');
        const pct = el.querySelector('#hbSpawnPct');
        const next = el.querySelector('#hbSpawnNext');
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
        const modeText = el.querySelector('#hbRecruitMode');
        if (modeText) modeText.textContent = `${recruitModeLabel(recruitMode)} · ${recruitStatusText(b)}`;
        el.querySelectorAll('[data-recruit-mode]').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.recruitMode === recruitMode);
        });
        if (b._upgrade) {
            const up = b._upgrade;
            const upPct = Math.max(0, Math.min(100, Math.round((1 - up.remainMs / up.totalMs) * 100)));
            const bar = el.querySelector(`#hbUpgradeBar_${up.moduleId}`);
            const txt = el.querySelector(`#hbUpgradeText_${up.moduleId}`);
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

    refresh() {
        const el = this.el;
        if (!el || !this.barracks) return;
        const b = this.barracks;
        const energy = CrossPlaneResourceSystem.getAvailable('energy');
        const food = CrossPlaneResourceSystem.getAvailable('food');
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const cfg = BARRACKS_CONFIG;
        refreshProducerRallySection(el, b, SceneManager.getCurrentWorldId());
        el.querySelector('#hbTitle').textContent = '建筑详情';
        const detail = el.querySelector('#hbBuildingDetail');
        if (detail) {
            detail.innerHTML = renderBuildingDetailHeader({
                texture: b.spriteCfg?.idleKey || 'barracks',
                name: '仓鼠兵营',
                hp: b.hp,
                maxHp: b.maxHp,
                accent: '#7fe0c8',
                status: `Lv.${b.level} · 军事单位 ${b.aliveUnitCount()}/${b.unitCount()}`,
            });
        }

        const st = el.querySelector('#hbStatus');
        const curType = cfg.unit[b.unitType] || {};
        const spawnMs = b.recruitIntervalMs();
        const nextIn = Math.max(0, Math.ceil(b._spawnTimer / 1000));
        const recruitMode = normalizeRecruitMode(b._recruitMode);
        const paused = recruitMode === RECRUIT_MODE.PAUSED;
        // 出发进度 = 已等待时间 / 45s 生成周期（2026-08-18 起切换单位类型重置 _spawnTimer 重新计时）
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
                当前生成 <span class="troop-panel-inline-unit">${renderTroopUnitIcon(b.unitType, 'inline')}<b>${curType.name || '—'}</b></span>
                （每名 ${CrossPlaneResourceSystem.quote({ food: cfg.barracks.unitSpawnFoodCost?.[b.unitType] || 0 }).food} 粮食）<br>
                招募状态 <b id="hbRecruitMode" style="color:${paused ? '#aab0b6' : '#7fe0c8'};">${recruitModeLabel(recruitMode)} · ${recruitStatusText(b)}</b> ·
                下次生成 <b id="hbSpawnNext" style="color:${b._spawnBlocked ? '#ff7755' : '#7fd4ff'};">${nextText}</b>（当前周期 ${(spawnMs / 1000).toFixed(1)}s）<br>
                攻击间隔/伤害/移速/生命随模块升级
            </div>
            <div style="margin-top:8px;">
                <div class="troop-panel-progress-label" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                    <span>🚀 出发进度</span>
                    <span id="hbSpawnPct" style="color:${spawnBarColor};font-weight:700;">${spawnPct}%</span>
                </div>
                <div style="position:relative;height:10px;background:rgba(255,255,255,0.10);border-radius:5px;overflow:hidden;">
                    <div id="hbSpawnBar" style="position:absolute;left:0;top:0;bottom:0;width:${spawnPct}%;background:linear-gradient(90deg, ${spawnBarColor}, #7fe0c8);border-radius:5px;transition:width 0.2s linear;"></div>
                </div>
                <div class="troop-panel-caption" style="margin-top:2px;">默认暂停；单次只完成一名，持续模式在粮食和空位满足时循环招募</div>
            </div>`;

        const ut = el.querySelector('#hbUnitType');
        const btn = (key) => {
            const u = cfg.unit[key];
            const active = b.unitType === key;
            return `<button class="troop-panel-unit-button ${active ? 'is-active' : ''}" data-unit-type="${key}"
                data-technology-gate-type="unit" data-technology-gate-id="${key}"
                style="flex:1;cursor:var(--bp-cursor-pointer, pointer);">
                    <span class="troop-panel-unit-button-main">
                        ${renderTroopUnitIcon(key)}
                        <span class="troop-panel-unit-button-copy"><span>${u.name}</span><small>${CrossPlaneResourceSystem.quote({ food: cfg.barracks.unitSpawnFoodCost?.[key] || 0 }).food} 粮食</small></span>
                    </span>
                </button>`;
        };
        ut.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span class="troop-panel-section-title">🎖 生成单位类型</span>
                <span class="troop-panel-caption">切换后按新兵种周期重新计时</span>
            </div>
            <div style="display:flex;gap:8px;">${(BARRACKS_CONFIG.barracks.unitTypes || []).map(btn).join('')}</div>
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

        const modBox = el.querySelector('#hbModules');
        const rows = Object.entries(cfg.modules || {}).map(([mid, mod]) => {
            const lv = getUnitUpgradeLevel(b.unitType, mid);
            const maxedMod = lv >= mod.maxLevel;
            const canBuy = b.canUpgradeModule(mid);
            const cost = b.getModuleCost(mid);
            const inProgress = !!(b._upgrade
                && b._upgrade.moduleId === mid
                && b._upgrade.unitType === b.unitType);
            const continuous = b.isContinuousUpgrade(mid, b.unitType);
            const progPct = inProgress
                ? Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100)
                : 0;
            const btn = canBuy || maxedMod
                ? renderBarracksUpgradeActions({
                    moduleId: mid, maxed: maxedMod, inProgress,
                    continuous, upgradeBusy: !!b._upgrade,
                })
                : '<span class="troop-panel-caption">🔒 未知模块</span>';
            return renderBuildingUpgradeCard({
                rowAttribute: 'data-module-row', projectId: mid,
                icon: mod.icon, iconImage: mod.iconImage, name: mod.name, level: lv, maxLevel: mod.maxLevel,
                cost, maxed: maxedMod, inProgress, progressPct: progPct,
                remainMs: inProgress ? b._upgrade.remainMs : 0,
                statusText: continuous && !inProgress ? '持续升级已开启 · 等待条件与资源' : '',
                barId: `hbUpgradeBar_${mid}`, textId: `hbUpgradeText_${mid}`,
                actionsHtml: btn, accent: '#8ad0ff',
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
        modBox.querySelectorAll('[data-module-cont]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._toggleModuleContinuous(btnEl.dataset.moduleCont));
        });
        modBox.querySelectorAll('[data-module-row]').forEach((rowEl) => {
            const moduleId = rowEl.dataset.moduleRow;
            rowEl.addEventListener('mouseenter', (ev) => this._showModuleTip(moduleId, ev));
            rowEl.addEventListener('mousemove', moveBuildingUpgradeTooltip);
            rowEl.addEventListener('mouseleave', hideBuildingUpgradeTooltip);
        });

        const sellBtn = el.querySelector('#hbSell');
        if (sellBtn) {
            const durability = Math.max(0, Math.min(1,
                Number(b.hp) / Math.max(1, Number(b.maxHp) || 1)));
            const refund = Math.floor((b._buildCost ?? cfg.barracks.cost)
                * (cfg.barracks.sellRefundRatio ?? 0.5) * durability);
            sellBtn.title = `出售返还 ${refund} 能源（军事单位一并拆除）`;
            sellBtn.onclick = () => {
                const res = b.sell();
                this._notify(res.ok ? `已出售（+${res.refund} 能源）` : (res.reason || '出售失败'), res.ok ? '#ffd700' : '#ff5555');
                if (res.ok) this.close();
            };
        }
    }

    _setUnitType(type) {
        if (!this.barracks) return;
        if (this.barracks.setUnitType(type)) {
            const name = (BARRACKS_CONFIG.unit[type] || {}).name || type;
            this._notify(`兵营改为生成 ${name}`, '#7fe0c8');
        }
        this.refresh();
    }

    _setRecruitMode(mode) {
        if (!this.barracks) return;
        const result = this.barracks.setRecruitMode(mode);
        if (result.ok) {
            this._notify(`仓鼠兵营：${recruitModeLabel(result.mode)}`, '#7fe0c8');
        } else {
            this._notify(result.reason, '#ff7755');
        }
        this.refresh();
    }

    _showModuleTip(moduleId, ev) {
        if (!this.barracks) return;
        const b = this.barracks;
        const mod = BARRACKS_CONFIG.modules?.[moduleId];
        if (!mod) return;
        const lv = getUnitUpgradeLevel(b.unitType, moduleId);
        const maxed = lv >= mod.maxLevel;
        const desc = getBarracksModuleDesc(moduleId, lv);
        const cost = b.getModuleCost(moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(mod.icon, mod.iconImage, 'building-upgrade-tooltip-icon')}<span>${mod.name}</span> <span style="color:#8a5a00;">Lv.${lv}/${mod.maxLevel}</span></div>
            <div>${maxed ? desc.current : `${desc.current} → ${desc.next}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">适用兵种：${BARRACKS_CONFIG.unit[b.unitType]?.name || b.unitType}</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>`, ev);
    }

    _upgrade(moduleId) {
        if (!this.barracks) return;
        const res = this.barracks.upgradeModule(moduleId, this.player);
        if (res.ok) {
            this._notify(`${BARRACKS_CONFIG.modules[moduleId].name} 开始升级（读条 ${Math.round(res.cost.timeMs / 1000)}s）`, '#8ad0ff');
        } else {
            this._notify(res.reason, '#ff5555');
        }
        this.refresh();
    }

    _toggleModuleContinuous(moduleId) {
        if (!this.barracks) return;
        const wasActive = this.barracks.isContinuousUpgrade(moduleId, this.barracks.unitType);
        const result = this.barracks.setContinuousUpgrade(moduleId);
        const name = BARRACKS_CONFIG.modules[moduleId]?.name || moduleId;
        if (!result.ok) this._notify(result.reason, '#ff5555');
        else if (wasActive || result.stopped) this._notify(`${name} 停止持续升级`, '#ffd700');
        else if (result.waiting) this._notify(`${name} 持续升级已开启，等待条件与资源`, '#c9a0ff');
        else this._notify(`${name} 持续升级已开启`, '#c9a0ff');
        this.refresh();
    }
}

// ==================== 系统 ====================

export const HamsterBarracksSystem = {
    active: false,
    barracks: [],
    _panel: null,
    _seq: 0,

    _ensurePanel() {
        if (!this._panel) this._panel = new HamsterBarracksPanel();
        return this._panel;
    },

    setup() {
        this.teardown();
        this.active = true;
        this.barracks = [];
    },

    teardown() {
        this.active = false;
        for (const b of this.barracks) {
            if (b) {
                b.active = false;
                b._despawnUnits();
                if (Game && Game.entities && b.id) Game.entities.delete(b.id);
            }
        }
        this.barracks = [];
        if (this._panel) {
            if (this._panel.isOpen) this._panel.close();
            this._panel.barracks = null;
            this._panel.player = null;
        }
    },

    update(dt) {
        if (!this.active) return;
        for (const b of this.barracks) {
            if (b && b.active) b.update(dt);
        }
    },

    /** 点击仓鼠兵营 → 打开面板（再次点击关闭） */
    tryInteract(mx, my, player) {
        if (!this.active || !player) return false;
        const panel = this._ensurePanel();
        const mw = Renderer.screenToWorld(mx, my);
        const buildMode = !!(Game && Game._buildMode);   // 建设模式无视距离（2026-08-16）
        let picked = null;
        let pickedScore = Infinity;
        for (const b of this.barracks) {
            if (!b || !b.active) continue;
            const pdx = b.x - player.x;
            const pdy = b.y - player.y;
            if (!buildMode && Math.sqrt(pdx * pdx + pdy * pdy) > 260) continue;
            if (!pointHitsBarracks(mw.x, mw.y, b)) continue;
            const visualX = b.x + (b._visualFootOffsetX || 0);
            const dx = (mw.x - (visualX + BARRACKS_HIT.cx)) / Math.max(1, BARRACKS_HIT.hw);
            const dy = (mw.y - (b.y + BARRACKS_HIT.cy)) / Math.max(1, BARRACKS_HIT.hh);
            const score = dx * dx + dy * dy;
            if (score < pickedScore) {
                picked = b;
                pickedScore = score;
            }
        }
        if (!picked) return false;
        if (panel.isOpen && panel.barracks === picked) panel.close();
        else panel.openFor(picked, player);
        Game?.BuildingSystem?._keepOnlyBuildingDetailPanel?.(panel.isOpen ? panel : null);
        return true;
    },

    closePanel() {
        if (this._panel && this._panel.isOpen) this._panel.close();
    },
};
