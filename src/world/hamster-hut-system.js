// ============================================================
// 矿工营地（世界-122 建筑，2026-08-15）
// - B 建筑面板放置；作为经济建筑，由人口岗位决定仓鼠矿工数量；
// - 原采矿/工作/移动/增援升级保留，另有 5 级背包扩容；
// - 矿工死亡后营地在 respawnMs 后按当前已分配岗位补员。
// ============================================================
import { Game } from '../game.js';
import { DamageableEntity } from '../entities/damageable-entity.js';
import { HamsterMiner } from '../entities/hamster-miner.js';
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
import {
    ensureBuildingUpgradeTooltip,
    hideBuildingUpgradeTooltip,
    moveBuildingUpgradeTooltip,
    showBuildingUpgradeTooltip,
} from '../ui/panels/building-upgrade-tooltip.js';
import { WallSystem } from './wall-system.js';
import { setupStructureDepth } from './structure-depth.js';
import { Renderer } from './renderer.js';
import { TWO_BY_TWO_BUILDING_FOOT, applyBuildingFootprint } from './building-footprint.js';
import { SpawnPlacement } from './spawn-placement.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { isInfiniteResourcesEnabled } from '../config/dev-cheats.js';
import minerCfg from '../../data/hamster-miner-config.json';
import { MINER_CAMP_CONFIG, getMinerEconomyStats } from './miner-economy.js';
import { CrossPlaneResourceSystem } from './cross-plane-resource-system.js';
import { PopulationEconomySystem } from './population-economy-system.js';

// ==================== 配置 ====================

export const HAMSTER_CONFIG = {
    hut: {
        ...MINER_CAMP_CONFIG,
        radius: TWO_BY_TWO_BUILDING_FOOT.collisionRadius,
        maxLevel: 10,
        maxHp: MINER_CAMP_CONFIG.hp,
    },
    miner: {
        radius: 26,
        ...(minerCfg.ai || {}),
    },
    upgradeProject: MINER_CAMP_CONFIG.upgradeProject,
    upgradeCost: MINER_CAMP_CONFIG.upgradeCost || {},
    modules: MINER_CAMP_CONFIG.modules || {},
};

/** 模块升级费用（统一）：1000 金币 + 500 能源，每级固定 */
export function getHutModuleCost(moduleId, _currentLevel) {
    return getBuildingModuleUpgradeCost(MINER_CAMP_CONFIG, moduleId, _currentLevel);
}

/** 面板用：模块当前/下一级描述文本 */
export function getHutModuleDesc(moduleId, level) {
    const mod = HAMSTER_CONFIG.modules?.[moduleId];
    if (!mod) return '';
    const pct = Math.abs(mod.per) * 100;
    const pctAt = (atLevel) => Number((pct * atLevel).toFixed(1)).toString();
    const valueAt = (atLevel) => Math.round(
        (Number(mod.base) || 0) + (Number(mod.per) || 0) * atLevel
    );
    const fill = (atLevel) => (mod.desc || '')
        .replace('{pct}', pctAt(atLevel))
        .replace('{value}', `${valueAt(atLevel)}`);
    return {
        current: fill(level),
        next: fill(level + 1),
    };
}

/** 小屋当前模块倍率表 */
export function getHutMults(modules) {
    return getMinerEconomyStats(modules);
}

/** 矿工营地命中盒（世界坐标，相对脚底） */
const HUT_HIT = { cx: 0, cy: -60, hw: 75, hh: 65 };

function pointHitsHut(wx, wy, h) {
    const visualX = h.x + (h._visualFootOffsetX || 0);
    return wx >= visualX + HUT_HIT.cx - HUT_HIT.hw && wx <= visualX + HUT_HIT.cx + HUT_HIT.hw
        && wy >= h.y + HUT_HIT.cy - HUT_HIT.hh && wy <= h.y + HUT_HIT.cy + HUT_HIT.hh;
}

// ==================== 矿工营地建筑 ====================

export class HamsterHut extends DamageableEntity {
    constructor(x, y, config = {}) {
        const hp = config.hp ?? HAMSTER_CONFIG.hut.hp;
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: HAMSTER_CONFIG.hut.displayW,
            collisionRadius: HAMSTER_CONFIG.hut.radius,
            name: config.name ?? '矿工营地',
        });
        this.id = config.id || `hamster_hut_${Math.random().toString(36).slice(2, 8)}`;
        this._isHamsterHut = true;
        this._isEconomicBuilding = true;
        this._cfg = HAMSTER_CONFIG.hut;
        this._isDefenseStructure = true;
        this.noSeparation = true;
        this.immovable = true;
        this._noShadow = true;
        this.def = HAMSTER_CONFIG.hut.def;
        this.mdef = HAMSTER_CONFIG.hut.mdef;
        this.spriteCfg = {
            idleKey: HAMSTER_CONFIG.hut.tex,
            size: HAMSTER_CONFIG.hut.displayW,
            sizeH: HAMSTER_CONFIG.hut.displayH,
            footOffsetY: HAMSTER_CONFIG.hut.footOffsetY,
            visualFootprint: HAMSTER_CONFIG.hut.visualFootprint
                ? { ...HAMSTER_CONFIG.hut.visualFootprint } : null,
            autoFootprint: false,
        };
        this.footOffsetY = HAMSTER_CONFIG.hut.footOffsetY;
        applyBuildingFootprint(this, 2);
        // 统一遮挡锚线（2026-08-16 全建筑同口径）：底边线按贴图显示半宽，
        // 注册进 junctionCorrectedDepth 后，前/同线实体被抬到屋上、后实体被压到屋下
        // （此前用 footprint 半径 40，比贴图半宽 75 窄，屋角后方单位不被遮挡）。
        setupStructureDepth(this);
        this.level = 1;
        this.maxLevel = HAMSTER_CONFIG.hut.maxLevel;
        this.modules = { ...(config.modules || {}) }; // { moduleId: level }
        this._upgrade = config.upgrade ? {
            moduleId: config.upgrade.moduleId,
            totalMs: Math.max(1, Number(config.upgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(config.upgrade.remainMs) || 0),
        } : null;
        this.miners = [];             // 本小屋拥有的仓鼠矿工
        this._minerSeq = 0;
        this._respawnTimer = 0;
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        this._spawnEnergyBlocked = false;
        this._storedEnergy = Math.max(0, Number(config.storedEnergy) || 0); // 旧存档迁移暂存
        this._pendingMinerEnergy = Math.max(0, Number(config.pendingMinerEnergy) || 0);
        PopulationEconomySystem.initializeBuilding(this, {
            assignedWorkers: config.assignedWorkers,
        });
        if (!config.skipInitialSpawn) this._spawnInitialMiners();
        this.rebuildCollider();
    }

    /** 当前模块倍率 */
    mults() {
        return getHutMults(this.modules);
    }

    /** 当前在岗人口 = 目标矿工数量。 */
    minerCount() {
        return PopulationEconomySystem.getWorkerSnapshot(this)?.assigned || 0;
    }

    /** 当前岗位容量由配置基础值与“矿工增援”等级共同决定。 */
    minerCapacity() {
        return PopulationEconomySystem.getWorkerSnapshot(this)?.slots || this.mults().count;
    }

    /** 当前存活矿工数 */
    aliveMinerCount() {
        return this.miners.filter((m) => m && m.active && !m._dying && m.data.hp > 0).length;
    }

    /** 建造时按已分配岗位生成矿工；新营地默认不自动占用人口。 */
    _spawnInitialMiners() {
        for (let i = 0; i < this.minerCount(); i++) {
            if (!this.spawnMiner()) break;
        }
    }

    /** 生成一只仓鼠矿工（挂到本小屋，注册实体表 + 友方单位表），出生点在小屋附近 */
    spawnMiner(payEnergy = false) {
        if (!Game || !Game.entities) return null;
        const spot = this._findMinerSpawn();
        if (!spot) return null;
        const spawnCost = Math.max(0, Number(HAMSTER_CONFIG.hut.respawnEnergyCost) || 0);
        const freeMinimum = Math.max(0, Number(HAMSTER_CONFIG.hut.freeMinimumCount) || 0);
        const shouldPay = payEnergy && this.aliveMinerCount() >= freeMinimum && spawnCost > 0
            && !isInfiniteResourcesEnabled();
        if (shouldPay && !CrossPlaneResourceSystem.pay({ energy: spawnCost }).ok) {
            this._spawnEnergyBlocked = true;
            return null;
        }
        this._spawnEnergyBlocked = false;
        const mults = this.mults();
        const miner = new HamsterMiner(spot.x, spot.y, {
            id: `${this.id}_miner_${++this._minerSeq}`,
            ai: {
                walkSpeed: mults.walkSpeed,
                attackInterval: mults.attackInterval,
                attackDamage: mults.attackDamage,
                miningMult: mults.miningMult,
                miningRange: HAMSTER_CONFIG.miner.miningRange,
                engageRange: HAMSTER_CONFIG.miner.engageRange,
                attackRange: HAMSTER_CONFIG.miner.attackRange,
                backpackCapacity: mults.backpackCapacity,
                energyGatherRatio: mults.gatherRatio,
                decisionMs: HAMSTER_CONFIG.miner.decisionMs,
            },
        });
        miner._hut = this;
        if (this._pendingMinerEnergy > 0) {
            const restored = Math.min(miner._energyCapacity, this._pendingMinerEnergy);
            miner._energyCarried = restored;
            this._pendingMinerEnergy -= restored;
            if (restored >= miner._energyCapacity) miner._ai._phase = 'unload_return';
        }
        miner._spawnEgress = { x: spot.egressX, y: spot.egressY };
        this.miners.push(miner);
        Game.entities.set(miner.id, miner);
        if (Array.isArray(Game.friendlyUnits)) Game.friendlyUnits.push(miner);
        return miner;
    }

    /** 营地提交入口：只扣除仓库本次实际接收量，放不下的继续留在矿工背包。 */
    unloadMiner(miner) {
        const total = Math.max(0, Number(miner?._energyCarried) || 0);
        const added = total > 0 && EnergyManager ? EnergyManager.depositEnergy(total) : 0;
        if (miner) miner._energyCarried = Math.max(0, total - added);
        if (EffectManager) {
            if (added > 0) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `+${added} 能源`, '#7fd4ff'));
            }
        }
        return { added, remaining: miner?._energyCarried || 0 };
    }

    /** 人口岗位变化：新增岗位进入补员链；撤销岗位的矿工返营提交后离岗。 */
    onAssignedWorkersChanged() {
        this._syncMinerWorkforce(true);
    }

    _syncMinerWorkforce(startImmediately = false) {
        const desired = this.minerCount();
        const workers = this.miners.filter((m) => m && m.active && !m._dying && m.data.hp > 0);
        let activeWorkers = workers.filter((m) => !m._retireRequested);
        if (activeWorkers.length > desired) {
            for (const miner of activeWorkers.slice(desired)) {
                miner._retireRequested = true;
                miner._ai?._startUnloadReturn?.();
            }
            activeWorkers = activeWorkers.slice(0, desired);
        } else if (activeWorkers.length < desired) {
            for (const miner of workers) {
                if (!miner._retireRequested) continue;
                miner._retireRequested = false;
                if (miner._energyCarried <= 0 && miner._ai) miner._ai._phase = 'work';
                activeWorkers.push(miner);
                if (activeWorkers.length >= desired) break;
            }
        }
        if (startImmediately && activeWorkers.length < desired) {
            this._respawnTimer = 0;
            this._spawnRetryTimer = 0;
        }
    }

    /** 固定出口槽位：墙体、建筑 footprint、动态单位与出口预约全部通过才返回。 */
    _findMinerSpawn() {
        return SpawnPlacement.findAndReserve(this, {
            unitRadius: 24,
            entities: Game?.entities,
            wallSystem: WallSystem,
            preferredTarget: this._rallyPoint || (Game && Game._observerMode ? { x: this.x, y: this.y } : Game?.player), // 观察模式：玩家不在场，集结兜底回建筑自身
        });
    }

    /** 模块是否可升级（未满级即可；能源在支付时扣） */
    canUpgradeModule(moduleId) {
        const mod = HAMSTER_CONFIG.modules?.[moduleId];
        if (!mod) return false;
        return (this.modules[moduleId] || 0) < mod.maxLevel;
    }

    getModuleCost(moduleId) {
        return getHutModuleCost(moduleId, this.modules[moduleId] || 0);
    }

    /** 升级开始时扣费，读条完成后才提升本栋营地等级。 */
    startModuleUpgrade(moduleId) {
        const mod = HAMSTER_CONFIG.modules?.[moduleId];
        if (!mod) return { ok: false, reason: '未知模块' };
        if (!this.canUpgradeModule(moduleId)) return { ok: false, reason: '模块已满级' };
        if (this._upgrade) return { ok: false, reason: '已有营地项目正在升级' };
        const cost = this.getModuleCost(moduleId);
        if (!cost) return { ok: false, reason: '升级费用配置缺失' };
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        const timeMs = Math.max(1, Number(cost.timeMs) || 1);
        this._upgrade = { moduleId, totalMs: timeMs, remainMs: timeMs };
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, moduleId };
    }

    upgradeModule(moduleId) {
        return this.startModuleUpgrade(moduleId);
    }

    _updateUpgrade(dt) {
        if (!this._upgrade) return;
        this._upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (this._upgrade.remainMs > 0) return;
        const moduleId = this._upgrade.moduleId;
        const mod = HAMSTER_CONFIG.modules?.[moduleId];
        if (mod) {
            this.modules[moduleId] = Math.min(
                Math.max(0, Math.floor(Number(mod.maxLevel) || 0)),
                Math.max(0, Math.floor(Number(this.modules[moduleId]) || 0)) + 1
            );
            // “矿工增援”只增加人口岗位容量；玩家分配人口后才会生成矿工。
            this.applyUpgradesToMiners();
        }
        this._upgrade = null;
    }

    /** 把当前模块倍率同步给所有存活矿工 */
    applyUpgradesToMiners() {
        const mults = this.mults();
        const u = {
            attackInterval: mults.attackInterval,
            attackDamage: mults.attackDamage,
            walkSpeed: mults.walkSpeed,
            miningMult: mults.miningMult,
            backpackCapacity: mults.backpackCapacity,
        };
        for (const m of this.miners) {
            if (m && m.active && !m._dying && typeof m.applyHutUpgrades === 'function') {
                m.applyHutUpgrades(u);
            }
        }
    }

    /** 矿工死亡补员（小屋存活且数量不足时） */
    update(dt) {
        this._updateUpgrade(dt);
        this._syncMinerWorkforce();
        if (this.active && this.aliveMinerCount() < this.minerCount()) {
            this._respawnTimer = Math.max(0, this._respawnTimer - dt);
            if (this._respawnTimer <= 0) {
                this._spawnRetryTimer -= dt;
                if (this._spawnRetryTimer <= 0) {
                    const restoring = this._restoreTopUp > 0;
                    const miner = this.spawnMiner(!restoring);
                    if (miner) {
                        // 快照恢复补员（_restoreTopUp>0）：绕过 60s 补员周期快速补齐，800ms/个
                        this._respawnTimer = this._restoreTopUp > 0 ? 800 : HAMSTER_CONFIG.hut.respawnMs;
                        if (this._restoreTopUp > 0) this._restoreTopUp--;
                        this._spawnRetryTimer = 0;
                        this._spawnBlocked = false;
                    } else if (this._spawnEnergyBlocked) {
                        this._respawnTimer = 0;
                        this._spawnRetryTimer = 1000;
                        this._spawnBlocked = false;
                        if (EffectManager) {
                            EffectManager.add(new FloatingTextEffect(this.x, this.y - 66,
                                `能源不足，矿工补员暂停（需 ${HAMSTER_CONFIG.hut.respawnEnergyCost}）`, '#ffcc55'));
                        }
                    } else {
                        this._respawnTimer = 0;
                        this._spawnRetryTimer = SpawnPlacement.retryMs;
                        if (!this._spawnBlocked && EffectManager) {
                            EffectManager.add(new FloatingTextEffect(this.x, this.y - 66, '出口被阻挡，矿工等待出发', '#ff8855'));
                        }
                        this._spawnBlocked = true;
                    }
                }
            }
        } else {
            this._respawnTimer = HAMSTER_CONFIG.hut.respawnMs;
            this._spawnRetryTimer = 0;
            this._spawnBlocked = false;
            this._spawnEnergyBlocked = false;
        }
        // 快照恢复时若岗位已减少，多出的旧矿工携带量视为已完成返营，转入营地提交队列。
        if (this._pendingMinerEnergy > 0 && this.aliveMinerCount() >= this.minerCount()) {
            this._storedEnergy += this._pendingMinerEnergy;
            this._pendingMinerEnergy = 0;
        }
        // 暂存能量自动补入玩家背包（背包腾出空间即转交；"暂存"语义）
        if (this._storedEnergy > 0 && EnergyManager) {
            const added = EnergyManager.depositEnergy(this._storedEnergy);
            if (added > 0) {
                this._storedEnergy = Math.max(0, this._storedEnergy - added);
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `暂存移交 +${added} 能源`, '#7fd4ff'));
                }
            }
        }
    }

    /** 矿工营地被摧毁：矿工随建筑消失 */
    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        // 沉陷死亡由 onDeath 接管
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 矿工营地沉陷死亡：矿工随拆 + 建筑清理 + 沉陷清除 */
    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        this._destroyHutCleanup();
        if (EffectManager) {
            EffectManager.add(new BuildingSinkEffect(this));
        }
    }

    /** 矿工营地专属清理（矿工/列表/面板）；实体失效与移除由 BuildingSinkEffect 负责 */
    _destroyHutCleanup() {
        const lost = this._storedEnergy || 0;
        this._despawnMiners();
        PopulationEconomySystem.unregisterBuilding(this);
        if (HamsterHutSystem && HamsterHutSystem.huts) {
            const i = HamsterHutSystem.huts.indexOf(this);
            if (i >= 0) HamsterHutSystem.huts.splice(i, 1);
        }
        if (HamsterHutSystem && HamsterHutSystem._panel && HamsterHutSystem._panel.isOpen
            && HamsterHutSystem._panel.hut === this) {
            HamsterHutSystem._panel.close();
        }
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 40,
                lost > 0 ? `矿工营地被摧毁（暂存 ${lost} 能源丢失）` : '矿工营地被摧毁', '#ff8855'));
        }
    }

    _despawnMiners() {
        for (const m of this.miners) {
            if (!m) continue;
            m.active = false;
            if (Game && Game.entities && m.id) Game.entities.delete(m.id);
            if (Array.isArray(Game.friendlyUnits)) {
                const i = Game.friendlyUnits.indexOf(m);
                if (i >= 0) Game.friendlyUnits.splice(i, 1);
            }
        }
        this.miners = [];
    }

    /** 出售：返还 50% 建造能源，矿工一并拆除 */
    sell() {
        const buildCost = Math.max(0, Number(this._buildCost ?? HAMSTER_CONFIG.hut.cost) || 0);
        const durability = Math.max(0, Math.min(1, Number(this.hp) / Math.max(1, Number(this.maxHp) || 1)));
        const refund = Math.floor(buildCost * (HAMSTER_CONFIG.hut.sellRefundRatio ?? 0.5) * durability);
        if (!EnergyManager || !EnergyManager.canStore(refund)) {
            return { ok: false, reason: '仓库空间不足，无法接收出售返还能源' };
        }
        this.hittable = false;
        this._sinking = true;
        this._despawnMiners();
        PopulationEconomySystem.unregisterBuilding(this);
        if (HamsterHutSystem && HamsterHutSystem.huts) {
            const i = HamsterHutSystem.huts.indexOf(this);
            if (i >= 0) HamsterHutSystem.huts.splice(i, 1);
        }
        if (EnergyManager) EnergyManager.addEnergy(refund);
        if (HamsterHutSystem && HamsterHutSystem._panel && HamsterHutSystem._panel.isOpen
            && HamsterHutSystem._panel.hut === this) {
            HamsterHutSystem._panel.close();
        }
        if (EffectManager) EffectManager.add(new BuildingSinkEffect(this).start());
        return { ok: true, refund };
    }
}

// ==================== 矿工营地升级面板 ====================

class HamsterHutPanel extends BasePanel {
    constructor() {
        super({
            id: 'hamsterHutPanel',
            className: 'hamster-hut-panel bp-right-column is-economy-building',
            stateKey: 'hamsterHut',
            panelGroup: 'buildingDetail',
            closeOnEscape: true,
            closeOnOutsidePointer: true,
            mountElement: (el) => mountRightSidebarPanel(el, 'panel', { bringToFront: true }),
        });
        this.hut = null;
        this.player = null;
        this._refreshTimer = null; // 面板打开期间 500ms 实时刷新（暂存能量/矿工背包）
        this._progressTimer = null;
    }

    buildContent(el) {
        el.innerHTML = `
            <div class="economy-detail-toolbar">
                <div id="hhTitle"></div>
                <div class="economy-detail-toolbar-actions">
                    <button id="hhSell" type="button">出售</button>
                    <button id="hhClose" type="button" aria-label="关闭矿工营地详情">关闭</button>
                </div>
            </div>
            <div id="hhBuildingDetail"></div>
            <div id="hhFunctionTitle" class="troop-panel-section-title">经济功能 · 人口岗位与采矿物流</div>
            <div id="hhStatus"></div>
            <div id="hhModules"></div>
        `;
        ensureBuildingUpgradeTooltip();
        el.querySelector('#hhClose').addEventListener('click', () => this.close());
    }

    openFor(hut, player) {
        this.hut = hut;
        this.player = player;
        this.open();
        this.refresh();
        if (this._refreshTimer) clearInterval(this._refreshTimer);
        this._refreshTimer = setInterval(() => {
            if (this.isOpen && this.hut && this.hut.active) {
                this.refresh();
            } else {
                clearInterval(this._refreshTimer);
                this._refreshTimer = null;
            }
        }, 500);
        if (this._progressTimer) clearInterval(this._progressTimer);
        this._progressTimer = setInterval(() => this._tickProgress(), 100);
    }

    onOpen() {
        this.refresh();
    }

    onClose() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._progressTimer) {
            clearInterval(this._progressTimer);
            this._progressTimer = null;
        }
        hideBuildingUpgradeTooltip();
        this.hut = null;
        this.player = null;
    }

    _tickProgress() {
        const el = this.el;
        const h = this.hut;
        if (!el || !h) return;
        const upgrade = h._upgrade;
        if (upgrade) {
            const pct = Math.max(0, Math.min(100,
                Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)));
            const bar = el.querySelector(`#hhUpgradeBar_${upgrade.moduleId}`);
            const text = el.querySelector(`#hhUpgradeText_${upgrade.moduleId}`);
            if (bar) bar.style.width = `${pct}%`;
            if (text) text.textContent = `升级中 ${pct}%（剩余 ${Math.ceil(upgrade.remainMs / 1000)}s）`;
        } else if (el.querySelector('[data-miner-upgrading="true"]')) {
            this.refresh();
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
        if (!el || !this.hut) return;
        const h = this.hut;
        const energy = CrossPlaneResourceSystem.getAvailable('energy');
        el.querySelector('#hhTitle').textContent = '建筑详情';
        const detail = el.querySelector('#hhBuildingDetail');
        if (detail) {
            detail.innerHTML = renderBuildingDetailHeader({
                texture: h.spriteCfg?.idleKey || HAMSTER_CONFIG.hut.tex,
                name: '矿工营地',
                hp: h.hp,
                maxHp: h.maxHp,
                accent: '#8ad0ff',
                status: `经济建筑 · 在岗 ${h.aliveMinerCount()}/${h.minerCount()} · 岗位 ${h.minerCapacity()}`,
            });
        }

        const st = el.querySelector('#hhStatus');
        const mults = h.mults();
        const workforce = PopulationEconomySystem.getWorkerSnapshot(h);
        const population = workforce?.population || PopulationEconomySystem.getPopulationSnapshot();
        const carried = h.miners.reduce((sum, miner) => sum + Math.max(0, Number(miner?._energyCarried) || 0), 0)
            + Math.max(0, Number(h._pendingMinerEnergy) || 0);
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const storageCapacity = EnergyManager ? EnergyManager.getCapacity() : 0;
        const workforcePct = workforce?.slots > 0
            ? Math.round((workforce.assigned || 0) / workforce.slots * 100)
            : 0;
        const readyPct = workforce?.assigned > 0
            ? Math.round(h.aliveMinerCount() / workforce.assigned * 100)
            : 0;
        st.innerHTML = `
            <div class="economy-panel-heading">
                <span>⛏️ 采矿物流档案</span>
                <span class="economy-panel-badge${h._spawnBlocked ? ' is-blocked' : ''}">${h._spawnBlocked ? '出口阻塞' : `在岗 ${h.aliveMinerCount()}/${h.minerCount()}`}</span>
            </div>
            <div class="economy-stat-grid">
                <div><span>采矿攻击力</span><b>${Math.round(mults.attackDamage * mults.miningMult)}</b></div>
                <div><span>基础伤害 / 效率</span><b>${mults.attackDamage} / +${Math.round((mults.miningMult - 1) * 100)}%</b></div>
                <div><span>攻击间隔</span><b>${mults.attackInterval}ms</b></div>
                <div><span>移动速度</span><b>${mults.walkSpeed}</b></div>
                <div><span>单人背包</span><b>${mults.backpackCapacity}</b></div>
                <div><span>携带中</span><b>${carried}</b></div>
                <div><span>仓库能源</span><b class="economy-unit-energy">${energy}/${storageCapacity}</b></div>
                <div><span>空闲人口</span><b>${population.free}</b></div>
            </div>
            <div class="economy-workforce">
                <div class="economy-workforce-copy">
                    <div class="economy-workforce-label"><span>矿工岗位</span><b>${workforce?.assigned || 0}/${workforce?.slots || 0} · 人口效率 ${Math.round((workforce?.laborEfficiency || 0) * 100)}%</b></div>
                    <div class="economy-progress-label"><span>岗位安排</span><b>${workforcePct}%</b></div>
                    <div class="economy-progress"><div style="width:${workforcePct}%"></div></div>
                    <div class="economy-progress-label"><span>矿工就绪</span><b>${Math.min(100, readyPct)}%</b></div>
                    <div class="economy-progress"><div style="width:${Math.min(100, readyPct)}%"></div></div>
                    <div class="economy-workforce-note">能源只在矿工返营提交后进入仓库。${h._spawnBlocked ? '<span class="is-warning">出口腾空后会自动补员。</span>' : ''}</div>
                </div>
                <div class="economy-workforce-actions">
                    <button class="troop-panel-unit-button" data-hh-worker="-1" ${!workforce || workforce.assigned <= 0 ? 'disabled' : ''}>−1</button>
                    <button class="troop-panel-unit-button" data-hh-worker="1" ${!workforce || workforce.freeSlots <= 0 || population.free <= 0 ? 'disabled' : ''}>+1</button>
                    <button class="troop-panel-unit-button" data-hh-worker-max ${!workforce || workforce.freeSlots <= 0 || population.free <= 0 ? 'disabled' : ''}>最大</button>
                </div>
            </div>
            `;
        st.querySelectorAll('[data-hh-worker]').forEach((button) => {
            button.addEventListener('click', () => {
                const result = PopulationEconomySystem.adjustAssignedWorkers(h, Number(button.dataset.hhWorker) || 0);
                this._notify(result.ok ? `矿工岗位调整为 ${result.assigned}/${result.slots}` : result.reason,
                    result.ok ? '#7fe0c8' : '#ff5555');
                this.refresh();
            });
        });
        st.querySelector('[data-hh-worker-max]')?.addEventListener('click', () => {
            const result = PopulationEconomySystem.assignMaxWorkers(h);
            this._notify(result.ok ? `已分配 ${result.assigned}/${result.slots} 名矿工` : result.reason,
                result.ok ? '#7fe0c8' : '#ff5555');
            this.refresh();
        });

        const modBox = el.querySelector('#hhModules');
        const upgrade = h._upgrade;
        const rows = Object.entries(HAMSTER_CONFIG.modules || {}).map(([mid, mod]) => {
            const lv = h.modules[mid] || 0;
            const maxedMod = lv >= mod.maxLevel;
            const cost = h.getModuleCost(mid);
            const inProgress = upgrade?.moduleId === mid;
            const progressPct = inProgress
                ? Math.round((1 - upgrade.remainMs / upgrade.totalMs) * 100)
                : 0;
            const actionsHtml = maxedMod
                ? '<span class="troop-panel-caption">已满级</span>'
                : `<button class="troop-panel-upgrade-button" data-mod="${mid}" ${upgrade ? 'disabled' : ''}>升级</button>`;
            return renderBuildingUpgradeCard({
                rowAttribute: 'data-module-row', projectId: mid,
                icon: mod.icon, iconImage: mod.iconImage, name: mod.name,
                level: lv, maxLevel: mod.maxLevel, cost, maxed: maxedMod,
                inProgress, progressPct, remainMs: inProgress ? upgrade.remainMs : 0,
                barId: `hhUpgradeBar_${mid}`, textId: `hhUpgradeText_${mid}`,
                actionsHtml, accent: '#7fd4ff',
            }).replace('class="building-upgrade-card"',
                `class="building-upgrade-card" data-miner-upgrading="${inProgress}"`);
        }).join('');
        modBox.innerHTML = `
            <div class="economy-panel-heading">
                <span>矿工营地升级项目</span>
                <span class="economy-panel-meta">持有 <span class="economy-unit-gold">${gold} 金</span> / <span class="economy-unit-energy">${energy} 能</span></span>
            </div>
            ${rows || '<div style="font-size:12px;color:#8a8a8a;">暂无模块</div>'}`;
        modBox.querySelectorAll('[data-mod]').forEach((btn) => {
            btn.addEventListener('click', () => this._upgrade(btn.dataset.mod));
        });
        modBox.querySelectorAll('[data-module-row]').forEach((rowEl) => {
            const moduleId = rowEl.dataset.moduleRow;
            rowEl.addEventListener('mouseenter', (ev) => this._showModuleTip(moduleId, ev));
            rowEl.addEventListener('mousemove', moveBuildingUpgradeTooltip);
            rowEl.addEventListener('mouseleave', hideBuildingUpgradeTooltip);
        });

        const sellBtn = el.querySelector('#hhSell');
        if (sellBtn) {
            const durability = Math.max(0, Math.min(1, Number(h.hp) / Math.max(1, Number(h.maxHp) || 1)));
            const refund = Math.floor((h._buildCost ?? HAMSTER_CONFIG.hut.cost)
                * (HAMSTER_CONFIG.hut.sellRefundRatio ?? 0.5) * durability);
            sellBtn.title = `出售返还 ${refund} 能源（仓鼠矿工一并拆除）`;
            sellBtn.onclick = () => {
                const res = h.sell();
                this._notify(res.ok ? `已出售（+${res.refund} 能源）` : (res.reason || '出售失败'), res.ok ? '#ffd700' : '#ff5555');
                if (res.ok) this.close();
            };
        }
    }

    _upgrade(moduleId) {
        if (!this.hut) return;
        const res = this.hut.startModuleUpgrade(moduleId);
        if (res.ok) {
            this._notify(`${HAMSTER_CONFIG.modules[moduleId].name}开始升级（${Math.round(res.cost.timeMs / 1000)}秒）`, '#8ad0ff');
        } else {
            this._notify(res.reason, '#ff5555');
        }
        this.refresh();
    }

    _showModuleTip(moduleId, ev) {
        if (!this.hut) return;
        const h = this.hut;
        const mod = HAMSTER_CONFIG.modules?.[moduleId];
        if (!mod) return;
        const lv = h.modules[moduleId] || 0;
        const maxed = lv >= mod.maxLevel;
        const desc = getHutModuleDesc(moduleId, lv);
        const cost = h.getModuleCost(moduleId);
        showBuildingUpgradeTooltip(`
            <div class="building-upgrade-tooltip-title">${renderBuildingUpgradeIcon(mod.icon, mod.iconImage, 'building-upgrade-tooltip-icon')}<span>${mod.name}</span> <span style="color:#8a5a00;">Lv.${lv}/${mod.maxLevel}</span></div>
            <div>${maxed ? desc.current : `${desc.current} → ${desc.next}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">适用单位：仓鼠矿工</div>
            <div style="margin-top:2px;">${maxed ? '已达到最高等级' : `升级费用：${cost.gold} 金币 + ${cost.energy} 能源`}</div>
            <div>${maxed ? '' : `读条时间：${Math.round(cost.timeMs / 1000)} 秒`}</div>`, ev);
    }
}

// ==================== 系统 ====================

export const HamsterHutSystem = {
    active: false,
    huts: [],
    _panel: null,
    _seq: 0,

    _ensurePanel() {
        if (!this._panel) this._panel = new HamsterHutPanel();
        return this._panel;
    },

    setup() {
        this.teardown();
        this.active = true;
        this.huts = [];
    },

    teardown() {
        this.active = false;
        for (const h of this.huts) {
            if (h) {
                h.active = false;
                h._despawnMiners();
                PopulationEconomySystem.unregisterBuilding(h);
                if (Game && Game.entities && h.id) Game.entities.delete(h.id);
            }
        }
        this.huts = [];
        if (this._panel) {
            if (this._panel.isOpen) this._panel.close();
            this._panel.hut = null;
            this._panel.player = null;
        }
    },

    update(dt) {
        if (!this.active) return;
        for (const h of this.huts) {
            if (h && h.active) h.update(dt);
        }
    },

    /** 点击矿工营地 → 打开升级面板（再次点击关闭） */
    tryInteract(mx, my, player) {
        if (!this.active || !player) return false;
        const panel = this._ensurePanel();
        const mw = Renderer.screenToWorld(mx, my);
        const buildMode = !!(Game && Game._buildMode);   // 建设模式无视距离（2026-08-16）
        for (const h of this.huts) {
            if (!h || !h.active) continue;
            const pdx = h.x - player.x;
            const pdy = h.y - player.y;
            if (!buildMode && Math.sqrt(pdx * pdx + pdy * pdy) > 260) continue;
            if (!pointHitsHut(mw.x, mw.y, h)) continue;
            if (panel.isOpen && panel.hut === h) {
                panel.close();
            } else {
                panel.openFor(h, player);
            }
            return true;
        }
        return false;
    },

    /** 面板关闭/场景离场时兜底（防御塔面板关闭后切小屋面板不残留） */
    closePanel() {
        if (this._panel && this._panel.isOpen) this._panel.close();
    },
};
