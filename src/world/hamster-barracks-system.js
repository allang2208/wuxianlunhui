// ============================================================
// 仓鼠兵营（世界-122 建筑，2026-08-16）
// - B 建筑面板放置，价格 1500 能源；每 45 秒自动生成一个仓鼠军事单位（2026-08-18 由 30s 调整为 45s）；
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
import { WallSystem } from './wall-system.js';
import { setupStructureDepth } from './structure-depth.js';
import { Renderer } from './renderer.js';
import warriorCfg from '../../data/hamster-warrior-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import { TWO_BY_TWO_BUILDING_FOOT, applyBuildingFootprint } from './building-footprint.js';
import { ResearchSystem } from './research-system.js';
import { SpawnPlacement } from './spawn-placement.js';
import {
    applyGlobalUpgradesToKind,
    getUnitUpgradeLevel,
    getUnitUpgradeMults,
    raiseUnitUpgradeLevel,
} from './unit-upgrade-store.js';

// ==================== 配置 ====================

export const BARRACKS_CONFIG = {
    barracks: {
        cost: 1500,
        hp: 2000,
        radius: TWO_BY_TWO_BUILDING_FOOT.collisionRadius,
        def: 60,
        mdef: 60,
        tex: 'barracks',
        // 2026-08-18：素材库兵营.png 紧身裁剪为 987×967，按 displayW=288 等比标定。
        displayW: 288,
        displayH: 282,
        footOffsetY: 141,
        sellRefundRatio: 0.5,
        spawnIntervalMs: 45000,   // 45 秒生成一个军事单位（2026-08-18 由 30s 调整）
        spawnRadius: 90,
        unitCap: 5,          // 每个兵营的仓鼠兵数量上限（2026-08-16 用户口径）
    },
    // 可生成的军事单位（基准值读 data/hamster-*-config.json，此处只做展示名；
    // 2026-08-18 清理死注册：射手迁靶场、民兵迁草屋，兵营只保留战士/盾卫）
    unit: {
        warrior: { key: 'warrior', name: '仓鼠战士', cfg: warriorCfg },
        guard: { key: 'guard', name: '仓鼠盾卫', cfg: guardCfg },
    },
    // 升级统一费用：每升一级 1000 金币 + 500 能源（同仓鼠小屋口径）
    upgradeCost: { gold: 1000, energy: 500 },
        // 升级模块（per = 每级效果量；复制仓鼠小屋的战斗类模块 + 生命强化；
        // 矿工专属的采矿效率/背包扩容不复制；仓鼠增援（数量）也不需要——
        // 兵营数量上限固定 5（unitCap），初始即有）
        modules: {
            attackSpd: { name: '攻击加速', icon: '⚡', per: -0.06, maxLevel: 10, desc: '攻击间隔 -{pct}%' },
            damage:    { name: '攻击强化', icon: '⚔️', per: 0.12, maxLevel: 10, desc: '每次攻击伤害 +{pct}%' },
            moveSpd:   { name: '机动强化', icon: '👟', per: 0.05, maxLevel: 10, desc: '移动速度 +{pct}%（每级 +5%）' },
            hp:        { name: '生命强化', icon: '❤️', per: 0.10, maxLevel: 10, desc: '单位生命 +{pct}%' },
        },
};

/** 模块升级费用（统一）：1000 金币 + 500 能源 */
export function getBarracksModuleCost(moduleId, _currentLevel) {
    if (!BARRACKS_CONFIG.modules?.[moduleId]) return null;
    return { gold: BARRACKS_CONFIG.upgradeCost.gold, energy: BARRACKS_CONFIG.upgradeCost.energy };
}

/** 面板用：模块当前/下一级描述文本 */
export function getBarracksModuleDesc(moduleId, level) {
    const mod = BARRACKS_CONFIG.modules?.[moduleId];
    if (!mod) return '';
    const pct = Math.round(Math.abs(mod.per) * 100);
    return {
        current: mod.desc.replace('{pct}', `${pct * level}`),
        next: mod.desc.replace('{pct}', `${pct * (level + 1)}`),
    };
}

/** 兵营当前模块倍率表 */
export function getBarracksMults(modules) {
    const m = modules || {};
    const cfg = BARRACKS_CONFIG.modules || {};
    const out = {
        attackIntervalMult: 1,
        attackDamageMult: 1,
        moveSpeedMult: 1,
        count: 1,
        hpMult: 1,
    };
    if (cfg.attackSpd && m.attackSpd) out.attackIntervalMult = 1 + cfg.attackSpd.per * m.attackSpd;
    if (cfg.damage && m.damage) out.attackDamageMult = 1 + cfg.damage.per * m.damage;
    if (cfg.moveSpd && m.moveSpd) out.moveSpeedMult = 1 + cfg.moveSpd.per * m.moveSpd;
    if (cfg.count && m.count) out.count = 1 + m.count;
    if (cfg.hp && m.hp) out.hpMult = 1 + cfg.hp.per * m.hp;
    return out;
}

/** 兵营命中盒（世界坐标，相对脚底）：贴图 170×147，覆盖整屋（同小屋口径） */
const BARRACKS_HIT = { cx: 0, cy: -60, hw: 85, hh: 65 };

function pointHitsBarracks(wx, wy, b) {
    return wx >= b.x + BARRACKS_HIT.cx - BARRACKS_HIT.hw && wx <= b.x + BARRACKS_HIT.cx + BARRACKS_HIT.hw
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
        };
        this.footOffsetY = BARRACKS_CONFIG.barracks.footOffsetY;
        applyBuildingFootprint(this, 2);
        setupStructureDepth(this);
        this.level = 1;
        this.maxLevel = 10;
        this.modules = {};            // { moduleId: level }
        this.unitType = 'warrior';    // 'warrior' | 'guard'（面板可切换；旧档射手/民兵在 spawnUnit 纠正为战士）
        this.units = [];              // 本兵营拥有的军事单位
        this._unitSeq = 0;
        this._spawnTimer = 0;
        this._baseSpawnIntervalMs = BARRACKS_CONFIG.barracks.spawnIntervalMs;
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
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
        return this.units.filter((u) => u && u.active && !u._dying && u.data && u.data.hp > 0).length;
    }

    /** 切换生成的单位类型（战士/盾卫）；下一次生成生效。
     *  2026-08-18：切换兵种重新计时（原来保留 _spawnTimer 进度不变）；
     *  切换为当前兵种视为无操作（返回 false，不打断计时、不发通知）。 */
    setUnitType(type) {
        if (!['warrior', 'guard'].includes(type)) return false;
        if (type === this.unitType) return false;
        this.unitType = type;
        this._spawnTimer = this.recruitIntervalMs();
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        return true;
    }

    /** 固定出口槽位：墙体、建筑 footprint、动态单位与出口预约全部通过才返回。 */
    _findUnitSpawn() {
        return SpawnPlacement.findAndReserve(this, {
            unitRadius: 24,
            entities: Game?.entities,
            wallSystem: WallSystem,
            preferredTarget: this._rallyPoint || Game?.player,
        });
    }

    /** 生成一个军事单位（当前 unitType），应用兵营模块倍率 */
    spawnUnit() {
        if (!Game || !Game.entities) return null;
        if (!['warrior', 'guard'].includes(this.unitType)) this.unitType = 'warrior';
        const unitCfg = BARRACKS_CONFIG.unit[this.unitType];
        const base = unitCfg.cfg || {};
        const baseAi = base.ai || {};
        const mults = this.mults();
        const spot = this._findUnitSpawn();
        if (!spot) return null;
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

    /** 玩家支付 1000 金币 + 500 能源升级模块；升级后同步现有单位 */
    upgradeModule(moduleId, _player) {
        const mod = BARRACKS_CONFIG.modules?.[moduleId];
        if (!mod) return { ok: false, reason: '未知模块' };
        if (!this.canUpgradeModule(moduleId)) return { ok: false, reason: '模块已满级' };
        const cost = this.getModuleCost(moduleId);
        const free = !!(Game && Game._devInfiniteResources);
        if (!free) {
            if (!GoldManager || !EnergyManager) return { ok: false, reason: '货币系统不可用' };
            if (!cost || GoldManager.getGold() < cost.gold) return { ok: false, reason: '金币不足（每级需 1000 金币）' };
            if (EnergyManager.getEnergy() < cost.energy) return { ok: false, reason: '能源不足（每级需 500 能源）' };
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

    /** 主循环：每 45s 生成一个军事单位（存活数低于上限时） */
    recruitIntervalMs() {
        return ResearchSystem.getRecruitIntervalMs
            ? ResearchSystem.getRecruitIntervalMs(this._baseSpawnIntervalMs)
            : this._baseSpawnIntervalMs;
    }

    update(dt) {
        if (!this.active) return;
        if (this.aliveUnitCount() < this.unitCount()) {
            this._spawnTimer = Math.max(0, this._spawnTimer - dt);
            if (this._spawnTimer <= 0) {
                this._spawnRetryTimer -= dt;
                if (this._spawnRetryTimer > 0) return;
                const unit = this.spawnUnit();
                if (unit) {
                    this._spawnTimer = this.recruitIntervalMs();
                    this._spawnRetryTimer = 0;
                    this._spawnBlocked = false;
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
        const refund = Math.floor(BARRACKS_CONFIG.barracks.cost * (BARRACKS_CONFIG.barracks.sellRefundRatio ?? 0.5));
        if (!EnergyManager || !EnergyManager.canStore(refund)) {
            return { ok: false, reason: '仓库空间不足，无法接收出售返还能源' };
        }
        this.active = false;
        this._despawnUnits();
        if (Game && Game.entities && this.id) Game.entities.delete(this.id);
        if (HamsterBarracksSystem && HamsterBarracksSystem.barracks) {
            const i = HamsterBarracksSystem.barracks.indexOf(this);
            if (i >= 0) HamsterBarracksSystem.barracks.splice(i, 1);
        }
        if (EnergyManager) EnergyManager.addEnergy(refund);
        if (HamsterBarracksSystem && HamsterBarracksSystem._panel && HamsterBarracksSystem._panel.isOpen
            && HamsterBarracksSystem._panel.barracks === this) {
            HamsterBarracksSystem._panel.close();
        }
        return { ok: true, refund };
    }
}

// ==================== 仓鼠兵营面板 ====================

class HamsterBarracksPanel extends BasePanel {
    constructor() {
        super({ id: 'hamsterBarracksPanel', className: 'hamster-barracks-panel', stateKey: 'hamsterBarracks' });
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
                    <button id="hbSell" style="background:#3a2820;color:#ffc9a0;border:1px solid #6a4a2a;border-radius:6px;padding:4px 10px;cursor:pointer;">出售</button>
                    <button id="hbClose" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:pointer;">关闭</button>
                </div>
            </div>
            <div id="hbBuildingDetail"></div>
            <div style="font-size:13px;font-weight:700;color:#7fe0c8;margin:2px 0 6px;">特殊功能 · 募兵与兵种训练</div>
            <div id="hbStatus" style="border:1px solid #4a4a2a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(60,50,20,0.18);"></div>
            <div id="hbUnitType" style="border:1px solid #3a6a5a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(20,50,40,0.18);"></div>
            <div id="hbModules" style="border:1px solid #3a4a5a;border-radius:8px;padding:10px;background:rgba(20,40,60,0.18);"></div>
        `;
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
        if (this.el) this.el.style.display = 'block';
    }

    onClose() {
        this._stopTicking();
        if (this.el) this.el.style.display = 'none';
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
        const spawnMs = b.recruitIntervalMs();
        const spawnProgress = b._spawnBlocked ? 1 : Math.max(0, Math.min(1, 1 - b._spawnTimer / spawnMs));
        const spawnPct = Math.round(spawnProgress * 100);
        const spawnBarColor = b._spawnBlocked ? '#ff7755'
            : (spawnProgress < 0.5 ? '#ffd700' : (spawnProgress < 0.8 ? '#ff9d45' : '#7fe0c8'));
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
        if (next) next.textContent = b._spawnBlocked
            ? '出口阻塞'
            : `${Math.max(0, Math.ceil(b._spawnTimer / 1000))}s`;
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
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const cfg = BARRACKS_CONFIG;
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
        // 出发进度 = 已等待时间 / 45s 生成周期（2026-08-18 起切换单位类型重置 _spawnTimer 重新计时）
        const spawnProgress = b._spawnBlocked ? 1 : Math.max(0, Math.min(1, 1 - b._spawnTimer / spawnMs));
        const spawnPct = Math.round(spawnProgress * 100);
        const spawnBarColor = b._spawnBlocked ? '#ff7755'
            : (spawnProgress < 0.5 ? '#ffd700' : (spawnProgress < 0.8 ? '#ff9d45' : '#7fe0c8'));
        const nextText = b._spawnBlocked ? '出口阻塞' : `${nextIn}s`;
        st.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div><span style="color:#ffd700;font-weight:700;">等级 ${b.level}</span></div>
                <div style="font-size:12px;color:#9a9a9a;">金币 <span style="color:#ffd700;">${gold}</span> · 能源 <span style="color:#7fd4ff;">${energy}</span></div>
            </div>
            <div style="font-size:12px;color:#c8b98a;line-height:1.7;">
                军事单位 <span style="color:#8ad0ff;">${b.aliveUnitCount()}/${b.unitCount()}</span> ·
                当前生成 <b style="color:#7fe0c8;">${curType.name || '—'}</b><br>
                下次生成 <b id="hbSpawnNext" style="color:${b._spawnBlocked ? '#ff7755' : '#7fd4ff'};">${nextText}</b>（当前周期 ${(spawnMs / 1000).toFixed(1)}s）·
                攻击间隔/伤害/移速/生命随模块升级
            </div>
            <div style="margin-top:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#9a9a9a;margin-bottom:3px;">
                    <span>🚀 出发进度</span>
                    <span id="hbSpawnPct" style="color:${spawnBarColor};font-weight:700;">${spawnPct}%</span>
                </div>
                <div style="position:relative;height:10px;background:rgba(255,255,255,0.10);border-radius:5px;overflow:hidden;">
                    <div id="hbSpawnBar" style="position:absolute;left:0;top:0;bottom:0;width:${spawnPct}%;background:linear-gradient(90deg, ${spawnBarColor}, #7fe0c8);border-radius:5px;transition:width 0.2s linear;"></div>
                </div>
                <div style="font-size:10px;color:#6a7a6a;margin-top:2px;">切换单位类型不影响出发进度</div>
            </div>`;

        const ut = el.querySelector('#hbUnitType');
        const btn = (key) => {
            const u = cfg.unit[key];
            const active = b.unitType === key;
            return `<button data-unit-type="${key}" style="flex:1;padding:7px 0;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;${active
                ? 'background:#2a6a5a;color:#e8fff5;border:2px solid #4aa88a;'
                : 'background:#263a32;color:#9ab8ac;border:1px solid #3a6a5a;'}">${u.name}</button>`;
        };
        ut.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:13px;font-weight:700;color:#7fe0c8;">🎖 生成单位类型</span>
                <span style="font-size:11px;color:#6a9a92;">切换后下一次生成生效</span>
            </div>
            <div style="display:flex;gap:8px;">${btn('warrior')}${btn('guard')}</div>`;
        ut.querySelectorAll('[data-unit-type]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._setUnitType(btnEl.dataset.unitType));
        });

        const modBox = el.querySelector('#hbModules');
        const rows = Object.entries(cfg.modules || {}).map(([mid, mod]) => {
            const lv = getUnitUpgradeLevel(b.unitType, mid);
            const desc = getBarracksModuleDesc(mid, lv);
            const maxedMod = lv >= mod.maxLevel;
            const canBuy = b.canUpgradeModule(mid);
            const cost = b.getModuleCost(mid);
            const btn = maxedMod
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
                    <div style="flex-shrink:0;">${btn}</div>
                </div>`;
        }).join('');
        modBox.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:13px;font-weight:700;color:#8ad0ff;">升级（每级 1000 金币 + 500 能源）</span>
                <span style="font-size:12px;color:#9a9a9a;">持有 ${gold} 金 / ${energy} 能</span>
            </div>
            ${rows || '<div style="font-size:12px;color:#8a8a8a;">暂无模块</div>'}`;
        modBox.querySelectorAll('[data-mod]').forEach((btnEl) => {
            btnEl.addEventListener('click', () => this._upgrade(btnEl.dataset.mod));
        });

        const sellBtn = el.querySelector('#hbSell');
        if (sellBtn) {
            const refund = Math.floor(cfg.barracks.cost * (cfg.barracks.sellRefundRatio ?? 0.5));
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

    _upgrade(moduleId) {
        if (!this.barracks) return;
        const res = this.barracks.upgradeModule(moduleId, this.player);
        if (res.ok) {
            this._notify(`已升级：${BARRACKS_CONFIG.modules[moduleId].name} Lv.${res.level}`, '#8ad0ff');
        } else {
            this._notify(res.reason, '#ff5555');
        }
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
        for (const b of this.barracks) {
            if (!b || !b.active) continue;
            const pdx = b.x - player.x;
            const pdy = b.y - player.y;
            if (!buildMode && Math.sqrt(pdx * pdx + pdy * pdy) > 260) continue;
            if (!pointHitsBarracks(mw.x, mw.y, b)) continue;
            if (panel.isOpen && panel.barracks === b) {
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
