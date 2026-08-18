// ============================================================
// 仓鼠小屋（世界-122 建筑，2026-08-15）
// - B 建筑面板放置，价格 1000 能源；建造后生成一只仓鼠矿工；
// - 升级参考防御塔面板（能源货币），5 个模块：
//   采矿效率 / 攻击间隔 / 攻击力 / 移动速度(+5%/级) / 仓鼠数量(+1/级)；
// - 矿工死亡后小屋在 respawnMs 后补员（数量 = 1 + 数量模块等级）。
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
import { WallSystem } from './wall-system.js';
import { setupStructureDepth } from './structure-depth.js';
import { Renderer } from './renderer.js';
import { TWO_BY_TWO_BUILDING_FOOT, applyBuildingFootprint } from './building-footprint.js';
import { SpawnPlacement } from './spawn-placement.js';

// ==================== 配置 ====================

export const HAMSTER_CONFIG = {
    hut: {
        cost: 1000,
        hp: 1500,
        radius: TWO_BY_TWO_BUILDING_FOOT.collisionRadius,
        def: 60,
        mdef: 60,
        maxLevel: 10,
        maxHp: 1500,
        tex: 'mine',
        // 2026-08-17 回退：显示尺寸统一到草屋同款 144×147（不再放大）
        displayW: 288,
        displayH: 294,
        footOffsetY: 147,
        sellRefundRatio: 0.5,
        minerSpawnRadius: 70,
        respawnMs: 60000,        // 矿工死亡后 1 分钟才补员
    },
    miner: {
        // HP 不在此配置：唯一真源 data/hamster-miner-config.json baseMaxHp（2026-08-16 口径 100）
        radius: 26,
        baseDamage: 100,          // 每次攻击伤害基准（采矿与近战共用）
        attackIntervalMs: 2000,   // 攻击间隔基准
        walkSpeed: 80,            // 移动速度基准（升级 +5%/级）
        miningRange: 50,
        engageRange: 340,
        attackRange: 48,
        miningMult: 1,            // 采矿效率倍率（升级 +15%/级）
        backpackCapacity: 500,    // 旧存档兼容；新采矿不再经过矿工背包
    },
    // 升级统一费用：每升一级消耗 1000 金币 + 500 能源（2026-08-15 用户口径）
    upgradeCost: { gold: 1000, energy: 500 },
    // 升级模块（per = 每级效果量；旧 baseCost/costGrowth 已弃用，费用统一走 upgradeCost）
    modules: {
        mining:    { name: '采矿效率',   icon: '⛏️', per: 0.15, maxLevel: 10, desc: '采矿攻击力 +{pct}%' },
        attackSpd: { name: '攻击加速',   icon: '⚡', per: -0.06, maxLevel: 10, desc: '攻击间隔 -{pct}%' },
        damage:    { name: '攻击强化',   icon: '⚔️', per: 0.12, maxLevel: 10, desc: '每次攻击伤害 +{pct}%' },
        moveSpd:   { name: '机动强化',   icon: '👟', per: 0.05, maxLevel: 10, desc: '移动速度 +{pct}%（每级 +5%）' },
        count:     { name: '仓鼠增援',   icon: '🐹', per: 1,    maxLevel: 5,  desc: '仓鼠矿工数量 +1' },
    },
};

/** 模块升级费用（统一）：1000 金币 + 500 能源，每级固定 */
export function getHutModuleCost(moduleId, _currentLevel) {
    if (!HAMSTER_CONFIG.modules?.[moduleId]) return null;
    return { gold: HAMSTER_CONFIG.upgradeCost.gold, energy: HAMSTER_CONFIG.upgradeCost.energy };
}

/** 面板用：模块当前/下一级描述文本 */
export function getHutModuleDesc(moduleId, level) {
    const mod = HAMSTER_CONFIG.modules?.[moduleId];
    if (!mod) return '';
    const pct = Math.round(Math.abs(mod.per) * 100);
    return {
        current: mod.desc.replace('{pct}', `${pct * level}`),
        next: mod.desc.replace('{pct}', `${pct * (level + 1)}`),
    };
}

/** 小屋当前模块倍率表 */
export function getHutMults(modules) {
    const m = modules || {};
    const cfg = HAMSTER_CONFIG.modules || {};
    const out = {
        miningMult: 1,
        attackInterval: HAMSTER_CONFIG.miner.attackIntervalMs,
        attackDamage: HAMSTER_CONFIG.miner.baseDamage,
        walkSpeed: HAMSTER_CONFIG.miner.walkSpeed,
        count: 1,
        backpackCapacity: HAMSTER_CONFIG.miner.backpackCapacity,
    };
    if (cfg.mining && m.mining) out.miningMult = 1 + cfg.mining.per * m.mining;
    if (cfg.attackSpd && m.attackSpd) out.attackInterval = Math.max(300, Math.round(out.attackInterval * (1 + cfg.attackSpd.per * m.attackSpd)));
    if (cfg.damage && m.damage) out.attackDamage = Math.round(out.attackDamage * (1 + cfg.damage.per * m.damage));
    if (cfg.moveSpd && m.moveSpd) out.walkSpeed = Math.round(out.walkSpeed * (1 + cfg.moveSpd.per * m.moveSpd));
    if (cfg.count && m.count) out.count = 1 + m.count;
    return out;
}

/** 仓鼠小屋命中盒（世界坐标，相对脚底）：贴图 150×130，覆盖整屋 */
const HUT_HIT = { cx: 0, cy: -60, hw: 75, hh: 65 };

function pointHitsHut(wx, wy, h) {
    return wx >= h.x + HUT_HIT.cx - HUT_HIT.hw && wx <= h.x + HUT_HIT.cx + HUT_HIT.hw
        && wy >= h.y + HUT_HIT.cy - HUT_HIT.hh && wy <= h.y + HUT_HIT.cy + HUT_HIT.hh;
}

// ==================== 仓鼠小屋建筑 ====================

export class HamsterHut extends DamageableEntity {
    constructor(x, y, config = {}) {
        const hp = config.hp ?? HAMSTER_CONFIG.hut.hp;
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: HAMSTER_CONFIG.hut.displayW,
            collisionRadius: HAMSTER_CONFIG.hut.radius,
            name: config.name ?? '仓鼠小屋',
        });
        this.id = config.id || `hamster_hut_${Math.random().toString(36).slice(2, 8)}`;
        this._isHamsterHut = true;
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
        };
        this.footOffsetY = HAMSTER_CONFIG.hut.footOffsetY;
        applyBuildingFootprint(this, 2);
        // 统一遮挡锚线（2026-08-16 全建筑同口径）：底边线按贴图显示半宽，
        // 注册进 junctionCorrectedDepth 后，前/同线实体被抬到屋上、后实体被压到屋下
        // （此前用 footprint 半径 40，比贴图半宽 75 窄，屋角后方单位不被遮挡）。
        setupStructureDepth(this);
        this.level = 1;
        this.maxLevel = HAMSTER_CONFIG.hut.maxLevel;
        this.modules = {};            // { moduleId: level }
        this.miners = [];             // 本小屋拥有的仓鼠矿工
        this._minerSeq = 0;
        this._respawnTimer = 0;
        this._spawnRetryTimer = 0;
        this._spawnBlocked = false;
        this._storedEnergy = 0;       // 玩家背包满时暂存的能量（小屋被毁即丢失）
        this._spawnInitialMiners();
        this.rebuildCollider();
    }

    /** 当前模块倍率 */
    mults() {
        return getHutMults(this.modules);
    }

    /** 目标矿工数量 = 1 + 数量模块等级 */
    minerCount() {
        return this.mults().count;
    }

    /** 当前存活矿工数 */
    aliveMinerCount() {
        return this.miners.filter((m) => m && m.active && !m._dying && m.data.hp > 0).length;
    }

    /** 建造时生成初始矿工（1 只） */
    _spawnInitialMiners() {
        for (let i = 0; i < this.minerCount(); i++) {
            if (!this.spawnMiner()) break;
        }
    }

    /** 生成一只仓鼠矿工（挂到本小屋，注册实体表 + 友方单位表），出生点在小屋附近 */
    spawnMiner() {
        if (!Game || !Game.entities) return null;
        const spot = this._findMinerSpawn();
        if (!spot) return null;
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
                decisionMs: 120,
            },
        });
        miner._hut = this;
        miner._spawnEgress = { x: spot.egressX, y: spot.egressY };
        this.miners.push(miner);
        Game.entities.set(miner.id, miner);
        if (Array.isArray(Game.friendlyUnits)) Game.friendlyUnits.push(miner);
        return miner;
    }

    /** 旧运行状态兼容：矿工残留携带量直接转入仓库。新采矿已在命中时直接入库。 */
    unloadMiner(miner) {
        const total = (miner && miner._energyCarried) || 0;
        miner._energyCarried = 0;
        const added = total > 0 && EnergyManager ? EnergyManager.depositEnergy(total) : 0;
        const stored = Math.max(0, total - added);
        if (stored > 0) this._storedEnergy += stored;
        if (EffectManager) {
            if (added > 0) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `+${added} 能源`, '#7fd4ff'));
            }
            if (stored > 0) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 76, `仓库已满：${stored} 暂存小屋`, '#ffaa55'));
            }
        }
    }

    /** 固定出口槽位：墙体、建筑 footprint、动态单位与出口预约全部通过才返回。 */
    _findMinerSpawn() {
        return SpawnPlacement.findAndReserve(this, {
            unitRadius: 24,
            entities: Game?.entities,
            wallSystem: WallSystem,
            preferredTarget: this._rallyPoint || Game?.player,
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

    /** 玩家支付 1000 金币 + 500 能源升级模块；数量模块升级时多生成一只仓鼠 */
    upgradeModule(moduleId, _player) {
        const mod = HAMSTER_CONFIG.modules?.[moduleId];
        if (!mod) return { ok: false, reason: '未知模块' };
        if (!this.canUpgradeModule(moduleId)) return { ok: false, reason: '模块已满级' };
        const cost = this.getModuleCost(moduleId);
        // 开发工具「无限资源」开启时升级不消耗金币/能源（2026-08-15）
        const free = !!(Game && Game._devInfiniteResources);
        if (!free) {
            if (!GoldManager || !EnergyManager) return { ok: false, reason: '货币系统不可用' };
            if (!cost || GoldManager.getGold() < cost.gold) return { ok: false, reason: '金币不足（每级需 1000 金币）' };
            if (EnergyManager.getEnergy() < cost.energy) return { ok: false, reason: '能源不足（每级需 500 能源）' };
            GoldManager.deductGold(cost.gold);
            EnergyManager.deductEnergy(cost.energy);
        }
        this.modules[moduleId] = (this.modules[moduleId] || 0) + 1;
        // 数量模块：立即多生成一只
        if (moduleId === 'count') {
            if (!this.spawnMiner()) {
                this._respawnTimer = 0;
                this._spawnRetryTimer = SpawnPlacement.retryMs;
            }
        }
        // 其余模块：同步到现有矿工（间隔/伤害/移速/采矿效率）
        this.applyUpgradesToMiners();
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, moduleId, level: this.modules[moduleId] };
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
        if (this.active && this.aliveMinerCount() < this.minerCount()) {
            this._respawnTimer = Math.max(0, this._respawnTimer - dt);
            if (this._respawnTimer <= 0) {
                this._spawnRetryTimer -= dt;
                if (this._spawnRetryTimer <= 0) {
                    const miner = this.spawnMiner();
                    if (miner) {
                        this._respawnTimer = HAMSTER_CONFIG.hut.respawnMs;
                        this._spawnRetryTimer = 0;
                        this._spawnBlocked = false;
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

    /** 小屋被摧毁：矿工随小屋消失 */
    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        // 沉陷死亡由 onDeath 接管
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 小屋沉陷死亡（2026-08-16 推广）：矿工随拆 + 小屋清理 + 沉陷清除 */
    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        this._destroyHutCleanup();
        if (EffectManager) {
            EffectManager.add(new BuildingSinkEffect(this));
        }
    }

    /** 小屋专属清理（矿工/列表/面板）；实体失效与移除由 BuildingSinkEffect 负责 */
    _destroyHutCleanup() {
        const lost = this._storedEnergy || 0;
        this._despawnMiners();
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
                lost > 0 ? `仓鼠小屋被摧毁（暂存 ${lost} 能源丢失）` : '仓鼠小屋被摧毁', '#ff8855'));
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
        const refund = Math.floor(HAMSTER_CONFIG.hut.cost * (HAMSTER_CONFIG.hut.sellRefundRatio ?? 0.5));
        if (!EnergyManager || !EnergyManager.canStore(refund)) {
            return { ok: false, reason: '仓库空间不足，无法接收出售返还能源' };
        }
        this.active = false;
        this._despawnMiners();
        if (Game && Game.entities && this.id) Game.entities.delete(this.id);
        if (HamsterHutSystem && HamsterHutSystem.huts) {
            const i = HamsterHutSystem.huts.indexOf(this);
            if (i >= 0) HamsterHutSystem.huts.splice(i, 1);
        }
        if (EnergyManager) EnergyManager.addEnergy(refund);
        if (HamsterHutSystem && HamsterHutSystem._panel && HamsterHutSystem._panel.isOpen
            && HamsterHutSystem._panel.hut === this) {
            HamsterHutSystem._panel.close();
        }
        return { ok: true, refund };
    }
}

// ==================== 仓鼠小屋升级面板 ====================

class HamsterHutPanel extends BasePanel {
    constructor() {
        super({ id: 'hamsterHutPanel', className: 'hamster-hut-panel', stateKey: 'hamsterHut' });
        this.hut = null;
        this.player = null;
        this._refreshTimer = null; // 面板打开期间 500ms 实时刷新（暂存能量/矿工背包）
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
                <div id="hhTitle" style="font-size:18px;font-weight:700;color:#ffd700;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="hhSell" style="background:#3a2820;color:#ffc9a0;border:1px solid #6a4a2a;border-radius:6px;padding:4px 10px;cursor:pointer;">出售</button>
                    <button id="hhClose" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:pointer;">关闭</button>
                </div>
            </div>
            <div id="hhBuildingDetail"></div>
            <div style="font-size:13px;font-weight:700;color:#8ad0ff;margin:2px 0 6px;">特殊功能 · 矿工生产与采矿</div>
            <div id="hhStatus" style="border:1px solid #4a4a2a;border-radius:8px;padding:10px;margin-bottom:12px;background:rgba(60,50,20,0.18);"></div>
            <div id="hhModules" style="border:1px solid #3a4a5a;border-radius:8px;padding:10px;background:rgba(20,40,60,0.18);"></div>
        `;
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
    }

    onOpen() {
        this.refresh();
        if (this.el) this.el.style.display = 'block';
    }

    onClose() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this.el) this.el.style.display = 'none';
        this.hut = null;
        this.player = null;
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
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        el.querySelector('#hhTitle').textContent = '建筑详情';
        const detail = el.querySelector('#hhBuildingDetail');
        if (detail) {
            detail.innerHTML = renderBuildingDetailHeader({
                texture: h.spriteCfg?.idleKey || HAMSTER_CONFIG.hut.tex,
                name: '仓鼠小屋',
                hp: h.hp,
                maxHp: h.maxHp,
                accent: '#8ad0ff',
                status: `Lv.${h.level} · 矿工 ${h.aliveMinerCount()}/${h.minerCount()}`,
            });
        }

        const st = el.querySelector('#hhStatus');
        const mults = h.mults();
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const storageCapacity = EnergyManager ? EnergyManager.getCapacity() : 0;
        st.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div><span style="color:#ffd700;font-weight:700;">等级 ${h.level}</span></div>
                <div style="font-size:12px;color:#9a9a9a;">金币 <span style="color:#ffd700;">${gold}</span> · 能源 <span style="color:#7fd4ff;">${energy}</span></div>
            </div>
            <div style="font-size:12px;color:#c8b98a;line-height:1.7;">
                仓鼠矿工 <span style="color:#8ad0ff;">${h.aliveMinerCount()}/${h.minerCount()}</span> ·
                对敌伤害 <b style="color:#ff9d7a;">${mults.attackDamage}</b> ·
                采矿攻击力 <b style="color:#ff9d7a;">${Math.round(mults.attackDamage * mults.miningMult)}</b>（含效率 +${Math.round((mults.miningMult - 1) * 100)}%）<br>
                攻击间隔 <b style="color:#ff9d7a;">${mults.attackInterval}ms</b> ·
                移动速度 <b style="color:#ff9d7a;">${mults.walkSpeed}</b> ·
                仓库能源 <b style="color:#8ad0ff;">${energy}/${storageCapacity}</b><br>
                ${h._spawnBlocked ? '<span style="color:#ff7755;">⚠ 出口阻塞，缺员将在出口腾空后自动补充</span><br>' : ''}
            </div>
            `;

        const modBox = el.querySelector('#hhModules');
        const rows = Object.entries(HAMSTER_CONFIG.modules || {}).map(([mid, mod]) => {
            const lv = h.modules[mid] || 0;
            const desc = getHutModuleDesc(mid, lv);
            const maxedMod = lv >= mod.maxLevel;
            const canBuy = h.canUpgradeModule(mid);
            const cost = h.getModuleCost(mid);
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
        modBox.querySelectorAll('[data-mod]').forEach((btn) => {
            btn.addEventListener('click', () => this._upgrade(btn.dataset.mod));
        });

        const sellBtn = el.querySelector('#hhSell');
        if (sellBtn) {
            const refund = Math.floor(HAMSTER_CONFIG.hut.cost * (HAMSTER_CONFIG.hut.sellRefundRatio ?? 0.5));
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
        const res = this.hut.upgradeModule(moduleId, this.player);
        if (res.ok) {
            this._notify(`已升级：${HAMSTER_CONFIG.modules[moduleId].name} Lv.${res.level}`, '#8ad0ff');
        } else {
            this._notify(res.reason, '#ff5555');
        }
        this.refresh();
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

    /** 点击仓鼠小屋 → 打开升级面板（再次点击关闭） */
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
