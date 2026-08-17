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
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { BuildingSinkEffect } from '../effects/building-sink.js';
import { SoundManager } from '../ui/sound-manager.js';
import { BasePanel } from '../ui/panels/base-panel.js';
import { WallSystem } from './wall-system.js';
import { setupStructureDepth } from './structure-depth.js';
import { Renderer } from './renderer.js';
import producerBuildings from '../../data/producer-buildings.json';
import warriorCfg from '../../data/hamster-warrior-config.json';
import shooterCfg from '../../data/hamster-shooter-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import militiaCfg from '../../data/hamster-militia-config.json';
import scoutCfg from '../../data/hamster-scout-config.json';
import {
    applyGlobalUpgradesToKind,
    getUnitUpgradeLevel,
    getUnitUpgradeMults,
    raiseUnitUpgradeLevel,
} from './unit-upgrade-store.js';
import { getAbilityLevel, raiseAbilityLevel } from './ability-store.js';

/** 产兵建筑配置表（唯一真源，building-system.js 也据此生成可建条目） */
export const PRODUCER_BUILDINGS = producerBuildings;

/** 单位 key → 基准配置（data/hamster-*-config.json，与仓鼠兵营同源） */
const PRODUCER_UNIT_CFG = {
    warrior: warriorCfg,
    shooter: shooterCfg,
    guard: guardCfg,
    militia: militiaCfg,
    scout: scoutCfg,
};

/** 单位 key → 实体类 */
const PRODUCER_UNIT_CLASS = {
    warrior: HamsterWarrior,
    shooter: HamsterShooter,
    guard: HamsterGuard,
    militia: HamsterMilitia,
    scout: HamsterScout,
};

export function getProducerConfig(key) {
    return PRODUCER_BUILDINGS[key] || null;
}

/** 模块升级费用（统一）：升级费用从配置读 */
export function getProducerModuleCost(cfg, moduleId, _currentLevel) {
    if (!cfg || !cfg.modules?.[moduleId]) return null;
    return { gold: cfg.upgradeCost.gold, energy: cfg.upgradeCost.energy };
}

/** 面板用：模块当前/下一级描述文本 */
export function getProducerModuleDesc(cfg, moduleId, level) {
    const mod = cfg?.modules?.[moduleId];
    if (!mod) return '';
    const pct = Math.round(Math.abs(mod.per) * 100);
    return {
        current: mod.desc.replace('{pct}', `${pct * level}`),
        next: mod.desc.replace('{pct}', `${pct * (level + 1)}`),
    };
}

/** 当前模块倍率表 */
export function getProducerMults(cfg, modules) {
    const m = modules || {};
    const mods = cfg?.modules || {};
    const out = {
        attackIntervalMult: 1,
        attackDamageMult: 1,
        moveSpeedMult: 1,
        count: 1,
        hpMult: 1,
    };
    if (mods.attackSpd && m.attackSpd) out.attackIntervalMult = 1 + mods.attackSpd.per * m.attackSpd;
    if (mods.damage && m.damage) out.attackDamageMult = 1 + mods.damage.per * m.damage;
    if (mods.moveSpd && m.moveSpd) out.moveSpeedMult = 1 + mods.moveSpd.per * m.moveSpd;
    if (mods.count && m.count) out.count = 1 + m.count;
    if (mods.hp && m.hp) out.hpMult = 1 + mods.hp.per * m.hp;
    return out;
}

// ==================== 产兵建筑实体 ====================

export class ProducerBuilding extends DamageableEntity {
    constructor(x, y, config = {}) {
        const cfg = getProducerConfig(config.cfgKey);
        if (!cfg) throw new Error(`producer-building: 未知配置 ${config.cfgKey}`);
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
        };
        this.footOffsetY = cfg.footOffsetY;
        setupStructureDepth(this, cfg.displayW / 2);
        this.level = 1;
        this.maxLevel = 10;
        this.modules = {};            // { moduleId: level }
        this.unitType = cfg.defaultUnitType || (cfg.unitTypes?.[0]?.key) || 'shooter';
        this.units = [];              // 本建筑拥有的军事单位
        this._unitSeq = 0;
        this._spawnTimer = 0;
        this.spawnEnabled = cfg.spawnEnabled !== false; // 铁匠铺等能力建筑不产兵
        this._upgrade = null;         // 能力升级读条 { abilityId, totalMs, remainMs }
        this._continuous = null;      // 持续升级的能力 id（资源足够自动续升）
        this.rebuildCollider();
    }

    /** 当前兵种全局倍率（2026-08-17 起按兵种全局共享，不再按建筑实例） */
    mults() {
        return getUnitUpgradeMults(this.unitType, this._cfg.modules);
    }

    /** 目标军事单位数量：配置 unitCap（初始即有，无需升级） */
    unitCount() {
        return this._cfg.unitCap ?? 5;
    }

    /** 当前存活单位数 */
    aliveUnitCount() {
        return this.units.filter((u) => u && u.active && !u._dying && u.data && u.data.hp > 0).length;
    }

    /** 配置里该单位 key 的展示名 */
    unitName(key) {
        const u = (this._cfg.unitTypes || []).find((t) => t.key === key);
        return u ? u.name : key;
    }

    /** 切换生成的单位类型；下一次生成生效（key 必须在配置 unitTypes 里） */
    setUnitType(type) {
        if (!(this._cfg.unitTypes || []).some((t) => t.key === type)) return false;
        this.unitType = type;
        return true;
    }

    /** 附近合法落点（WallSystem 校验，兜底建筑脚下） */
    _findUnitSpawn() {
        const r = this._cfg.spawnRadius;
        const halfW = this._cfg.displayW / 2;
        for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = (halfW + 20) + Math.random() * r;   // 建筑外沿起算，防生成点落在屋内
            const x = this.x + Math.cos(a) * d;
            const y = this.y + Math.sin(a) * d;
            if (!WallSystem || !WallSystem.canMoveTo || WallSystem.canMoveTo(x, y, 24)) {
                return { x, y };
            }
        }
        return { x: this.x + halfW + 20, y: this.y + 20 };
    }

    /** 生成一个军事单位（当前 unitType），应用模块倍率 */
    spawnUnit() {
        if (!Game || !Game.entities) return null;
        const unitCfg = PRODUCER_UNIT_CFG[this.unitType];
        const UnitClass = PRODUCER_UNIT_CLASS[this.unitType];
        if (!unitCfg || !UnitClass) return null;
        const base = unitCfg || {};
        const baseAi = base.ai || {};
        const mults = this.mults();
        const spot = this._findUnitSpawn();
        const id = `${this.id}_unit_${++this._unitSeq}`;
        const ai = {
            ...baseAi,
            attackInterval: Math.max(300, Math.round((baseAi.attackInterval ?? 2000) * mults.attackIntervalMult)),
            attackDamage: Math.max(1, Math.round((baseAi.attackDamage ?? 50) * mults.attackDamageMult)),
            walkSpeed: Math.max(20, Math.round((baseAi.walkSpeed ?? 120) * mults.moveSpeedMult)),
        };
        const baseMaxHp = Math.max(1, Math.round((base.baseMaxHp ?? 300) * mults.hpMult));
        const unit = new UnitClass(spot.x, spot.y, { id, ai, baseMaxHp });
        unit._barracks = this;
        this.units.push(unit);
        Game.entities.set(id, unit);
        if (Array.isArray(Game.friendlyUnits)) Game.friendlyUnits.push(unit);
        return unit;
    }

    /** 把该兵种全局升级同步给场景内所有该兵种单位（2026-08-17 起跨建筑全局生效） */
    applyUpgradesToUnits() {
        applyGlobalUpgradesToKind(this.unitType, this._cfg.modules);
    }

    /** 模块是否可升级（未满级即可） */
    canUpgradeModule(moduleId) {
        const mod = this._cfg.modules?.[moduleId];
        if (!mod) return false;
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
            timeMs: (c.timeBaseMs ?? 3000) + (c.timeGrowthMs ?? 500) * lv,
        };
    }

    /**
     * 开始一次能力升级读条（读条开始时扣资源，完成时等级 +1）。
     * continuous=true：本项目完成后自动续升下一级（资源足够且未满级）。
     */
    startAbilityUpgrade(abilityId, continuous = false) {
        const a = this.getAbility(abilityId);
        if (!a) return { ok: false, reason: '未知能力' };
        if (!this.canUpgradeAbility(abilityId)) return { ok: false, reason: '能力已满级' };
        if (this._upgrade) return { ok: false, reason: '已有升级在读条中' };
        const cost = this.getAbilityCost(abilityId);
        const free = !!(Game && Game._devInfiniteResources);
        if (!free) {
            if (!GoldManager || !EnergyManager) return { ok: false, reason: '货币系统不可用' };
            if (GoldManager.getGold() < cost.gold) return { ok: false, reason: `金币不足（需 ${cost.gold} 金币）` };
            if (EnergyManager.getEnergy() < cost.energy) return { ok: false, reason: `能源不足（需 ${cost.energy} 能源）` };
            GoldManager.deductGold(cost.gold);
            EnergyManager.deductEnergy(cost.energy);
        }
        this._upgrade = { abilityId, totalMs: cost.timeMs, remainMs: cost.timeMs };
        if (continuous) this._continuous = abilityId;
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, abilityId };
    }

    /** 推进能力升级读条；完成时升级并（若持续）自动续下一级 */
    _updateUpgrade(dt) {
        if (!this._upgrade) return;
        this._upgrade.remainMs -= dt;
        if (this._upgrade.remainMs > 0) return;
        const { abilityId } = this._upgrade;
        this._upgrade = null;
        const level = raiseAbilityLevel(abilityId);
        const a = this.getAbility(abilityId);
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

    /** 玩家支付升级费用升级模块；升级后同步现有单位 */
    upgradeModule(moduleId, _player) {
        const mod = this._cfg.modules?.[moduleId];
        if (!mod) return { ok: false, reason: '未知模块' };
        if (!this.canUpgradeModule(moduleId)) return { ok: false, reason: '模块已满级' };
        const cost = this.getModuleCost(moduleId);
        const free = !!(Game && Game._devInfiniteResources);
        if (!free) {
            if (!GoldManager || !EnergyManager) return { ok: false, reason: '货币系统不可用' };
            if (!cost || GoldManager.getGold() < cost.gold) return { ok: false, reason: `金币不足（每级需 ${cost.gold} 金币）` };
            if (EnergyManager.getEnergy() < cost.energy) return { ok: false, reason: `能源不足（每级需 ${cost.energy} 能源）` };
            GoldManager.deductGold(cost.gold);
            EnergyManager.deductEnergy(cost.energy);
        }
        const level = raiseUnitUpgradeLevel(this.unitType, moduleId);
        this.applyUpgradesToUnits();
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, moduleId, level };
    }

    /** 主循环：每 spawnIntervalMs 生成一个军事单位（存活数低于上限时） */
    update(dt) {
        if (!this.active) return;
        this._updateUpgrade(dt);
        if (!this.spawnEnabled) return;
        if (this.aliveUnitCount() < this.unitCount()) {
            this._spawnTimer -= dt;
            if (this._spawnTimer <= 0) {
                this._spawnTimer = this._cfg.spawnIntervalMs;
                const unit = this.spawnUnit();
                if (unit && EffectManager) {
                    const name = this.unitName(this.unitType);
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `${name} 报到！`, '#8ad0ff'));
                }
            }
        } else {
            this._spawnTimer = this._cfg.spawnIntervalMs;
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
        this._despawnUnits();
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
        const refund = Math.floor(this._cfg.cost * (this._cfg.sellRefundRatio ?? 0.5));
        this.active = false;
        this._upgrade = null;
        this._continuous = null;
        this._despawnUnits();
        if (Game && Game.entities && this.id) Game.entities.delete(this.id);
        if (ProducerBuildingSystem && ProducerBuildingSystem.buildings) {
            const i = ProducerBuildingSystem.buildings.indexOf(this);
            if (i >= 0) ProducerBuildingSystem.buildings.splice(i, 1);
        }
        if (EnergyManager) EnergyManager.addEnergy(refund);
        if (ProducerBuildingSystem && ProducerBuildingSystem._panel && ProducerBuildingSystem._panel.isOpen
            && ProducerBuildingSystem._panel.building === this) {
            ProducerBuildingSystem._panel.close();
        }
        return { ok: true, refund };
    }
}

// ==================== 产兵建筑面板 ====================

class ProducerBuildingPanel extends BasePanel {
    constructor() {
        super({ id: 'producerBuildingPanel', className: 'producer-building-panel', stateKey: 'producerBuilding' });
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
                    <button id="pbSell" style="background:#3a2820;color:#ffc9a0;border:1px solid #6a4a2a;border-radius:6px;padding:4px 10px;cursor:pointer;">出售</button>
                    <button id="pbClose" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:pointer;">关闭</button>
                </div>
            </div>
            <div id="pbStatus" style="border:1px solid #4a4a2a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(60,50,20,0.18);"></div>
            <div id="pbUnitType" style="border:1px solid #3a6a5a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(20,50,40,0.18);"></div>
            <div id="pbModules" style="border:1px solid #3a4a5a;border-radius:8px;padding:10px;background:rgba(20,40,60,0.18);"></div>
        `;
        // 能力说明浮窗：独立图层挂在 document.body（不放进面板，避免被面板
        // overflow 容器裁剪/撑出滚动条），层级高于铁匠铺面板（2026-08-17 用户口径）
        if (!document.getElementById('pbAbilityTip')) {
            const tip = document.createElement('div');
            tip.id = 'pbAbilityTip';
            tip.style.cssText = 'display:none;position:fixed;z-index:10000;background:#fff;color:#222;'
                + 'border:1px solid #d8d2c4;border-radius:6px;padding:8px 10px;font-size:12px;'
                + 'line-height:1.6;box-shadow:0 4px 12px rgba(0,0,0,0.35);pointer-events:none;max-width:320px;';
            document.body.appendChild(tip);
        }
        el.querySelector('#pbClose').addEventListener('click', () => this.close());
    }

    openFor(building, player) {
        this.building = building;
        this.player = player;
        this.open();
        this.refresh();
        this._startTicking();
    }

    onOpen() {
        this.refresh();
        this._startTicking();
        if (this.el) this.el.style.display = 'block';
    }

    onClose() {
        this._stopTicking();
        this._hideAbilityTip();
        if (this.el) this.el.style.display = 'none';
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
        const spawnMs = b._cfg.spawnIntervalMs;
        const spawnProgress = Math.max(0, Math.min(1, 1 - b._spawnTimer / spawnMs));
        const spawnPct = Math.round(spawnProgress * 100);
        const spawnBarColor = spawnProgress < 0.5 ? '#ffd700' : (spawnProgress < 0.8 ? '#ff9d45' : '#7fe0c8');
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
        if (next) next.textContent = `${Math.max(0, Math.ceil(b._spawnTimer / 1000))}s`;
        // 铁匠铺能力升级读条进度（2026-08-17）
        if (b._upgrade) {
            const up = b._upgrade;
            const upPct = Math.max(0, Math.min(100, Math.round((1 - up.remainMs / up.totalMs) * 100)));
            const bar = el.querySelector(`#pbUpgradeBar_${up.abilityId}`);
            const txt = el.querySelector(`#pbUpgradeText_${up.abilityId}`);
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
        if (!el || !this.building) return;
        const b = this.building;
        const cfg = b._cfg;
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const isAbilityShop = cfg.spawnEnabled === false; // 铁匠铺等能力建筑（2026-08-17）
        el.querySelector('#pbTitle').textContent = `🏠 ${cfg.name}`;
        const unitTypeEl = el.querySelector('#pbUnitType');
        if (unitTypeEl) unitTypeEl.style.display = isAbilityShop ? 'none' : '';

        const st = el.querySelector('#pbStatus');
        const curType = b.unitName(b.unitType);
        const spawnMs = cfg.spawnIntervalMs;
        const nextIn = Math.max(0, Math.ceil(b._spawnTimer / 1000));
        // 出兵进度 = 已等待时间 / 生成周期（切换单位类型不重置 _spawnTimer，进度不受影响）
        const spawnProgress = Math.max(0, Math.min(1, 1 - b._spawnTimer / spawnMs));
        const spawnPct = Math.round(spawnProgress * 100);
        const spawnBarColor = spawnProgress < 0.5 ? '#ffd700' : (spawnProgress < 0.8 ? '#ff9d45' : '#7fe0c8');
        st.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div><span style="color:#ffd700;font-weight:700;">等级 ${b.level}</span></div>
                <div style="font-size:12px;color:#9a9a9a;">耐久 ${Math.ceil(b.hp)}/${b.maxHp} · 金币 <span style="color:#ffd700;">${gold}</span> · 能源 <span style="color:#7fd4ff;">${energy}</span></div>
            </div>
            <div style="font-size:12px;color:#c8b98a;line-height:1.7;">
                军事单位 <span style="color:#8ad0ff;">${b.aliveUnitCount()}/${b.unitCount()}</span> ·
                当前生成 <b style="color:#7fe0c8;">${curType}</b><br>
                下次生成 <b id="pbSpawnNext" style="color:#7fd4ff;">${nextIn}s</b>（每 ${spawnMs / 1000}s 一单位）·
                攻击间隔/伤害/移速/生命随模块升级
            </div>
            <div style="margin-top:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#9a9a9a;margin-bottom:3px;">
                    <span>🚀 出兵进度</span>
                    <span id="pbSpawnPct" style="color:${spawnBarColor};font-weight:700;">${spawnPct}%</span>
                </div>
                <div style="position:relative;height:10px;background:rgba(255,255,255,0.10);border-radius:5px;overflow:hidden;">
                    <div id="pbSpawnBar" style="position:absolute;left:0;top:0;bottom:0;width:${spawnPct}%;background:linear-gradient(90deg, ${spawnBarColor}, #7fe0c8);border-radius:5px;transition:width 0.2s linear;"></div>
                </div>
                <div style="font-size:10px;color:#6a7a6a;margin-top:2px;">切换单位类型不影响出兵进度</div>
            </div>`;

        const ut = el.querySelector('#pbUnitType');
        const btn = (u) => {
            const active = b.unitType === u.key;
            return `<button data-unit-type="${u.key}" style="flex:1;padding:7px 0;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;${active
                ? 'background:#2a6a5a;color:#e8fff5;border:2px solid #4aa88a;'
                : 'background:#263a32;color:#9ab8ac;border:1px solid #3a6a5a;'}">${u.name}</button>`;
        };
        ut.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:13px;font-weight:700;color:#7fe0c8;">🎖 生成单位类型</span>
                <span style="font-size:11px;color:#6a9a92;">切换后下一次生成生效</span>
            </div>
            <div style="display:flex;gap:8px;">${(cfg.unitTypes || []).map(btn).join('')}</div>`;
        ut.querySelectorAll('[data-unit-type]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._setUnitType(btnEl.dataset.unitType));
        });

        const modBox = el.querySelector('#pbModules');
        const rows = Object.entries(cfg.modules || {}).map(([mid, mod]) => {
            const lv = getUnitUpgradeLevel(b.unitType, mid);
            const desc = getProducerModuleDesc(cfg, mid, lv);
            const maxedMod = lv >= mod.maxLevel;
            const canBuy = b.canUpgradeModule(mid);
            const cost = b.getModuleCost(mid);
            const btnHtml = maxedMod
                ? '<span style="color:#8a8a8a;font-size:12px;">已满级</span>'
                : canBuy
                    ? `<button data-mod="${mid}" style="background:#4a5a2a;color:#e8ffc8;border:1px solid #7a9a4a;border-radius:6px;padding:3px 10px;cursor:pointer;">升级 ${cost.gold}金+${cost.energy}能</button>`
                    : '<span style="color:#7a6a5a;font-size:11px;">🔒 未知模块</span>';
            return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #22303a;gap:8px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;color:#d4e8ff;">${mod.icon} ${mod.name} <span style="color:#8ad0ff;">Lv.${lv}/${mod.maxLevel}</span></div>
                        <div style="font-size:11px;color:#8a9a9a;">${maxedMod ? desc.current : `${desc.current} → ${desc.next}`}</div>
                    </div>
                    <div style="flex-shrink:0;">${btnHtml}</div>
                </div>`;
        }).join('');
        const uc = cfg.upgradeCost || {};
        modBox.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:13px;font-weight:700;color:#8ad0ff;">升级（每级 ${uc.gold ?? 1000} 金币 + ${uc.energy ?? 500} 能源）</span>
                <span style="font-size:12px;color:#9a9a9a;">持有 ${gold} 金 / ${energy} 能</span>
            </div>
            ${rows || '<div style="font-size:12px;color:#8a8a8a;">暂无模块</div>'}`;
        modBox.querySelectorAll('[data-mod]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._upgrade(btnEl.dataset.mod));
        });

        const sellBtn = el.querySelector('#pbSell');
        if (sellBtn) {
            const refund = Math.floor(cfg.cost * (cfg.sellRefundRatio ?? 0.5));
            sellBtn.title = `出售返还 ${refund} 能源${isAbilityShop ? '' : '（军事单位一并拆除）'}`;
            sellBtn.onclick = () => {
                const res = b.sell();
                this._notify(res.ok ? `已出售（+${res.refund} 能源）` : '出售失败', res.ok ? '#ffd700' : '#ff5555');
                this.close();
            };
        }
        // ===== 铁匠铺：能力工坊版（覆盖上方出兵版渲染，2026-08-17）=====
        if (isAbilityShop) {
            st.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div><span style="color:#ffd700;font-weight:700;">能力工坊</span></div>
                    <div style="font-size:12px;color:#9a9a9a;">耐久 ${Math.ceil(b.hp)}/${b.maxHp} · 金币 <span style="color:#ffd700;">${gold}</span> · 能源 <span style="color:#7fd4ff;">${energy}</span></div>
                </div>
                <div style="font-size:12px;color:#c8b98a;line-height:1.7;">
                    不生成兵种，为仓鼠单位解锁特殊能力<br>
                    升级需要读条，完成后能力全局生效（所有对应兵种）
                </div>`;
            const modBoxEl = el.querySelector('#pbModules');
            const rows = Object.entries(cfg.abilities || {}).map(([aid, a]) => {
                const lv = b.abilityLevel(aid);
                const maxed = lv >= (a.maxLevel ?? 10);
                const inProgress = !!(b._upgrade && b._upgrade.abilityId === aid);
                const progPct = inProgress ? Math.round((1 - b._upgrade.remainMs / b._upgrade.totalMs) * 100) : 0;
                const cont = b._continuous === aid;
                const btnHtml = maxed
                    ? '<span style="color:#8a8a8a;font-size:12px;width:86px;display:inline-block;text-align:center;">已满级</span>'
                    : `<div style="display:flex;gap:4px;flex-shrink:0;">
                        <button data-ability-up="${aid}" style="width:86px;white-space:nowrap;background:#4a5a2a;color:#e8ffc8;border:1px solid #7a9a4a;border-radius:6px;padding:3px 0;cursor:pointer;font-size:12px;">升级</button>
                        <button data-ability-cont="${aid}" style="width:86px;white-space:nowrap;background:${cont ? '#2a6a5a' : '#263a32'};color:${cont ? '#e8fff5' : '#9ab8ac'};border:1px solid ${cont ? '#4aa88a' : '#3a6a5a'};border-radius:6px;padding:3px 0;cursor:pointer;font-size:12px;">${cont ? '持续中' : '持续升级'}</button>
                    </div>`;
                return `
                    <div data-ability-row="${aid}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #22303a;gap:8px;cursor:help;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;color:#d4e8ff;">${a.icon} ${a.name} <span style="color:#8ad0ff;">Lv.${lv}/${a.maxLevel ?? 10}</span> <span style="font-size:10px;color:#6a7a6a;">（悬停查看说明）</span></div>
                            <div style="position:relative;height:8px;background:rgba(255,255,255,0.10);border-radius:4px;overflow:hidden;margin-top:4px;">
                                <div id="pbUpgradeBar_${aid}" style="position:absolute;left:0;top:0;bottom:0;width:${progPct}%;background:linear-gradient(90deg,#ffd700,#c9a0ff);border-radius:4px;transition:width 0.2s linear;"></div>
                            </div>
                            <div id="pbUpgradeText_${aid}" style="font-size:10px;color:#c9a0ff;margin-top:2px;min-height:12px;">${inProgress ? `升级中 ${progPct}%（剩余 ${Math.ceil(b._upgrade.remainMs / 1000)}s）` : ''}</div>
                        </div>
                        <div style="flex-shrink:0;">${btnHtml}</div>
                    </div>`;
            }).join('');
            modBoxEl.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="font-size:13px;font-weight:700;color:#c9a0ff;">✨ 特殊能力（读条升级，全局生效）</span>
                    <span style="font-size:12px;color:#9a9a9a;">持有 ${gold} 金 / ${energy} 能</span>
                </div>
                ${rows || '<div style="font-size:12px;color:#8a8a8a;">暂无能力</div>'}`;
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

    _upgrade(moduleId) {
        if (!this.building) return;
        const res = this.building.upgradeModule(moduleId, this.player);
        if (res.ok) {
            this._notify(`已升级：${this.building._cfg.modules[moduleId].name} Lv.${res.level}`, '#8ad0ff');
        } else {
            this._notify(res.reason, '#ff5555');
        }
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

    /** 能力说明浮窗（类似装备栏白色浮窗，2026-08-17）：悬停能力行时显示 */
    _showAbilityTip(abilityId, ev) {
        if (!this.building) return;
        const tip = document.getElementById('pbAbilityTip');
        if (!tip) return;
        const b = this.building;
        const a = b.getAbility(abilityId);
        if (!a) return;
        const lv = b.abilityLevel(abilityId);
        const maxed = lv >= (a.maxLevel ?? 10);
        const cost = b.getAbilityCost(abilityId);
        const value = (a.base ?? 0) + (a.per ?? 0) * lv;
        const nextValue = value + (a.per ?? 0);
        const pct = Math.round(value * 100);
        const nextPct = Math.round(nextValue * 100);
        const fill = (s) => s.replace('{chance}', `${pct}%`).replace('{dmg}', `${pct}%`);
        const fillNext = (s) => s.replace('{chance}', `${nextPct}%`).replace('{dmg}', `${nextPct}%`);
        tip.innerHTML = `
            <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${a.icon} ${a.name} <span style="color:#8a5a00;">Lv.${lv}/${a.maxLevel ?? 10}</span></div>
            <div>${maxed ? fill(a.desc || '') : `${fill(a.desc || '')} → ${fillNext(a.desc || '')}`}</div>
            <div style="margin-top:4px;color:#5a4a2a;">目标兵种：${a.target}</div>
            <div style="margin-top:2px;">升级费用：${cost.gold} 金币 + ${cost.energy} 能源</div>
            <div>读条时间：${Math.round(cost.timeMs / 1000)} 秒</div>`;
        tip.style.display = 'block';
        this._moveAbilityTip(ev);
    }

    /** 浮窗跟随鼠标（右侧优先，越界翻转到左侧/上方） */
    _moveAbilityTip(ev) {
        const tip = document.getElementById('pbAbilityTip');
        if (!tip || tip.style.display === 'none') return;
        const w = tip.offsetWidth || 300;
        const h = tip.offsetHeight || 100;
        let left = ev.clientX + 14;
        let top = ev.clientY + 14;
        if (left + w > window.innerWidth - 10) left = ev.clientX - w - 14;
        if (top + h > window.innerHeight - 10) top = ev.clientY - h - 14;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    }

    _hideAbilityTip() {
        const tip = document.getElementById('pbAbilityTip');
        if (tip) tip.style.display = 'none';
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
    },

    teardown() {
        this.active = false;
        for (const b of this.buildings) {
            if (b) {
                b.active = false;
                b._despawnUnits();
                if (Game && Game.entities && b.id) Game.entities.delete(b.id);
            }
        }
        this.buildings = [];
        if (this._panel) {
            if (this._panel.isOpen) this._panel.close();
            this._panel.building = null;
            this._panel.player = null;
        }
    },

    update(dt) {
        if (!this.active) return;
        for (const b of this.buildings) {
            if (b && b.active) b.update(dt);
        }
    },

    /** 点击产兵建筑 → 打开面板（再次点击关闭） */
    tryInteract(mx, my, player) {
        if (!this.active || !player) return false;
        const panel = this._ensurePanel();
        const mw = Renderer.screenToWorld(mx, my);
        const buildMode = !!(Game && Game._buildMode);   // 建设模式无视距离
        for (const b of this.buildings) {
            if (!b || !b.active) continue;
            const pdx = b.x - player.x;
            const pdy = b.y - player.y;
            if (!buildMode && Math.sqrt(pdx * pdx + pdy * pdy) > 260) continue;
            const cfg = b._cfg;
            const hit = { cx: 0, cy: -Math.round(cfg.displayH * 0.4), hw: Math.round(cfg.displayW / 2), hh: Math.round(cfg.displayH * 0.44) };
            if (mw.x < b.x + hit.cx - hit.hw || mw.x > b.x + hit.cx + hit.hw
                || mw.y < b.y + hit.cy - hit.hh || mw.y > b.y + hit.cy + hit.hh) continue;
            if (panel.isOpen && panel.building === b) {
                panel.close();
            } else {
                panel.openFor(b, player);
            }
            return true;
        }
        return false;
    },

    closePanel() {
        if (this._panel && this._panel.isOpen) this._panel.close();
    },
};
