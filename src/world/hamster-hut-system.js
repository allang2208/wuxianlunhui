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
import { SoundManager } from '../ui/sound-manager.js';
import { BasePanel } from '../ui/panels/base-panel.js';
import { WallSystem } from './wall-system.js';
import { Renderer } from './renderer.js';

// ==================== 配置 ====================

export const HAMSTER_CONFIG = {
    hut: {
        cost: 1000,
        hp: 1500,
        radius: 40,
        def: 60,
        mdef: 60,
        maxLevel: 10,
        maxHp: 1500,
        tex: 'hamster_hut',
        displayW: 150,
        displayH: 147,
        footOffsetY: 74,
        sellRefundRatio: 0.5,
        minerSpawnRadius: 70,
        respawnMs: 60000,        // 矿工死亡后 1 分钟才补员
    },
    miner: {
        hp: 200,
        radius: 26,
        baseDamage: 100,          // 每次攻击伤害基准（采矿与近战共用）
        attackIntervalMs: 2000,   // 攻击间隔基准
        walkSpeed: 80,            // 移动速度基准（升级 +5%/级）
        miningRange: 80,
        engageRange: 340,
        attackRange: 48,
        miningMult: 1,            // 采矿效率倍率（升级 +15%/级）
        backpackCapacity: 500,    // 矿工隐藏背包默认容量（升级 +100/级，满级 10）
    },
    // 升级统一费用：每升一级消耗 1000 金币 + 500 能源（2026-08-15 用户口径）
    upgradeCost: { gold: 1000, energy: 500 },
    // 升级模块（per = 每级效果量；旧 baseCost/costGrowth 已弃用，费用统一走 upgradeCost）
    modules: {
        mining:    { name: '采矿效率',   icon: '⛏️', per: 0.15, maxLevel: 10, desc: '采矿产出 +{pct}%' },
        attackSpd: { name: '攻击加速',   icon: '⚡', per: -0.06, maxLevel: 10, desc: '攻击间隔 -{pct}%' },
        damage:    { name: '攻击强化',   icon: '⚔️', per: 0.12, maxLevel: 10, desc: '每次攻击伤害 +{pct}%' },
        moveSpd:   { name: '机动强化',   icon: '👟', per: 0.05, maxLevel: 10, desc: '移动速度 +{pct}%（每级 +5%）' },
        count:     { name: '仓鼠增援',   icon: '🐹', per: 1,    maxLevel: 5,  desc: '仓鼠矿工数量 +1' },
        backpack:  { name: '背包扩容',   icon: '🎒', per: 1,    maxLevel: 10, desc: '矿工背包容量 +{pct}' },
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
    if (cfg.backpack && m.backpack) out.backpackCapacity = HAMSTER_CONFIG.miner.backpackCapacity + m.backpack * 100;
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
        this.level = 1;
        this.maxLevel = HAMSTER_CONFIG.hut.maxLevel;
        this.modules = {};            // { moduleId: level }
        this.miners = [];             // 本小屋拥有的仓鼠矿工
        this._minerSeq = 0;
        this._respawnTimer = 0;
        this._doorState = 'closed';   // 'closed' | 'opening' | 'open' | 'closing'
        this._pendingSpawn = false;   // 门动画结束后是否要生成矿工
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
        for (let i = 0; i < this.minerCount(); i++) this.spawnMiner();
    }

    /** 生成一只仓鼠矿工（挂到本小屋，注册实体表 + 友方单位表）
     *  atDoor=true：出生在门前方（矿工从门口走出）；否则随机落在小屋附近 */
    spawnMiner(atDoor = false) {
        if (!Game || !Game.entities) return null;
        const spot = atDoor ? { x: this.x, y: this.y + 42 } : this._findMinerSpawn();
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
        this.miners.push(miner);
        Game.entities.set(miner.id, miner);
        if (Array.isArray(Game.friendlyUnits)) Game.friendlyUnits.push(miner);
        return miner;
    }

    /** 补员/增援：先播开门动画，开门完成后在门口生成矿工，再关门 */
    _spawnWithDoor() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const data = scene && scene._neutralSprites ? scene._neutralSprites.get(this) : null;
        const sprite = data && data.sprite;
        const anims = scene && scene.anims;
        // 无精灵/无动画素材：直接生成，不卡补员
        if (!sprite || !anims || !anims.exists('hamster_hut_door_open')) {
            this.spawnMiner();
            return;
        }
        if (this._doorState === 'opening' || this._doorState === 'open') {
            this._pendingSpawn = true; // 开门中，等开门完成再生成
            return;
        }
        this._pendingSpawn = true;
        this._doorState = 'opening';
        sprite.setTexture('hamster_hut_door');
        sprite.setDisplaySize(this.spriteCfg.size, this.spriteCfg.sizeH);
        sprite.play('hamster_hut_door_open', true);
        sprite.once('animationcomplete', () => this._onDoorOpened(sprite));
    }

    _onDoorOpened(sprite) {
        if (!this.active) return;
        this._doorState = 'open';
        if (this._pendingSpawn) {
            this._pendingSpawn = false;
            this.spawnMiner(true); // 门口出生
        }
        // 关门
        this._doorState = 'closing';
        if (sprite && sprite.scene && sprite.scene.anims && sprite.scene.anims.exists('hamster_hut_door_close')) {
            sprite.play('hamster_hut_door_close', true);
            sprite.once('animationcomplete', () => this._onDoorClosed(sprite));
        } else {
            this._doorState = 'closed';
        }
    }

    _onDoorClosed(sprite) {
        if (!this.active) return;
        this._doorState = 'closed';
        if (sprite && sprite.scene && sprite.scene.textures.exists('hamster_hut')) {
            sprite.setTexture('hamster_hut');
            sprite.setDisplaySize(this.spriteCfg.size, this.spriteCfg.sizeH);
        }
    }

    /** 矿工回屋卸货：开门动画（卸货期间保持开，由 AI 2s 后调 closeDoor） */
    openDoor() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const data = scene && scene._neutralSprites ? scene._neutralSprites.get(this) : null;
        const sprite = data && data.sprite;
        const anims = scene && scene.anims;
        if (!sprite || !anims || !anims.exists('hamster_hut_door_open')) return;
        if (this._doorState === 'opening' || this._doorState === 'open') return;
        this._doorState = 'opening';
        sprite.setTexture('hamster_hut_door');
        sprite.setDisplaySize(this.spriteCfg.size, this.spriteCfg.sizeH);
        sprite.play('hamster_hut_door_open', true);
        sprite.once('animationcomplete', () => {
            if (this._doorState !== 'opening') return;
            this._doorState = 'open';
            // 顺带处理门开后待生成矿工（与 _spawnWithDoor 同口径）
            if (this._pendingSpawn) {
                this._pendingSpawn = false;
                this.spawnMiner(true);
            }
        });
    }

    /** 卸货结束：关门动画，门关闭后恢复小屋贴图 */
    closeDoor() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const data = scene && scene._neutralSprites ? scene._neutralSprites.get(this) : null;
        const sprite = data && data.sprite;
        if (this._doorState !== 'open' && this._doorState !== 'opening') return;
        this._doorState = 'closing';
        if (sprite && sprite.scene && sprite.scene.anims && sprite.scene.anims.exists('hamster_hut_door_close')) {
            sprite.play('hamster_hut_door_close', true);
            sprite.once('animationcomplete', () => this._onDoorClosed(sprite));
        } else {
            this._doorState = 'closed';
        }
    }

    /**
     * 矿工卸货：携带能量 → 玩家背包（EnergyManager = 玩家背包物品）；
     * 玩家背包满则剩余暂存小屋（_storedEnergy），小屋被毁即丢失。
     */
    unloadMiner(miner) {
        const total = (miner && miner._energyCarried) || 0;
        miner._energyCarried = 0;
        let added = 0;
        let stored = 0;
        if (total > 0 && EnergyManager) {
            const before = EnergyManager.getEnergy();
            EnergyManager.addEnergy(total);
            added = EnergyManager.getEnergy() - before;
            stored = Math.max(0, total - added);
            if (stored > 0) this._storedEnergy += stored;
        }
        if (EffectManager) {
            if (added > 0) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 56, `+${added} 能源`, '#7fd4ff'));
            }
            if (stored > 0) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 76, `背包满：${stored} 暂存小屋`, '#ffaa55'));
            }
        }
        this.openDoor();
    }

    /** 小屋附近合法落点（优先随机偏移，WallSystem 校验，兜底小屋脚下） */
    _findMinerSpawn() {
        const r = HAMSTER_CONFIG.hut.minerSpawnRadius;
        for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 30 + Math.random() * r;
            const x = this.x + Math.cos(a) * d;
            const y = this.y + Math.sin(a) * d;
            if (!WallSystem || !WallSystem.canMoveTo || WallSystem.canMoveTo(x, y, 24)) {
                return { x, y };
            }
        }
        return { x: this.x + 40, y: this.y + 20 };
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
            this._spawnWithDoor();
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
            this._respawnTimer -= dt;
            if (this._respawnTimer <= 0) {
                this._respawnTimer = HAMSTER_CONFIG.hut.respawnMs;
                this._spawnWithDoor();
            }
        } else {
            this._respawnTimer = HAMSTER_CONFIG.hut.respawnMs;
        }
        // 暂存能量自动补入玩家背包（背包腾出空间即转交；"暂存"语义）
        if (this._storedEnergy > 0 && EnergyManager) {
            const before = EnergyManager.getEnergy();
            EnergyManager.addEnergy(this._storedEnergy);
            const added = EnergyManager.getEnergy() - before;
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
        const before = this.hp;
        const dealt = super.takeDamage(damage, source, damageType, isMelee);
        if (before > 0 && this.hp <= 0) {
            this._destroyHut();
        }
        return dealt;
    }

    _destroyHut() {
        const lost = this._storedEnergy || 0;
        this.active = false;
        this._despawnMiners();
        if (Game && Game.entities && this.id) Game.entities.delete(this.id);
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
        el.querySelector('#hhTitle').textContent = `🐹 仓鼠小屋`;

        const st = el.querySelector('#hhStatus');
        const mults = h.mults();
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const carriedTotal = h.miners.reduce((s, mn) => s + ((mn && mn._energyCarried) || 0), 0);
        const capTotal = h.miners.reduce((s, mn) => s + ((mn && mn._energyCapacity) || 0), 0);
        st.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div><span style="color:#ffd700;font-weight:700;">等级 ${h.level}</span></div>
                <div style="font-size:12px;color:#9a9a9a;">耐久 ${Math.ceil(h.hp)}/${h.maxHp} · 金币 <span style="color:#ffd700;">${gold}</span> · 能源 <span style="color:#7fd4ff;">${energy}</span></div>
            </div>
            <div style="font-size:12px;color:#c8b98a;line-height:1.7;">
                仓鼠矿工 <span style="color:#8ad0ff;">${h.aliveMinerCount()}/${h.minerCount()}</span> ·
                每次攻击伤害 <b style="color:#ff9d7a;">${mults.attackDamage}</b> ·
                攻击间隔 <b style="color:#ff9d7a;">${mults.attackInterval}ms</b><br>
                移动速度 <b style="color:#ff9d7a;">${mults.walkSpeed}</b> ·
                采矿效率 <b style="color:#7fd4ff;">+${Math.round((mults.miningMult - 1) * 100)}%</b><br>
                矿工背包 <b style="color:#8ad0ff;">${carriedTotal}/${capTotal}</b>
            </div>
            <div style="margin-top:8px;padding:7px 10px;border:1px solid #8a6a2a;border-radius:8px;background:rgba(110,80,30,0.22);display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:13px;color:#ffd7a0;">📦 暂存能量</span>
                <span style="font-size:15px;font-weight:700;color:#ffcc66;">${h._storedEnergy || 0}</span>
            </div>`;

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
                this._notify(res.ok ? `已出售（+${res.refund} 能源）` : '出售失败', res.ok ? '#ffd700' : '#ff5555');
                this.close();
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
        for (const h of this.huts) {
            if (!h || !h.active) continue;
            const pdx = h.x - player.x;
            const pdy = h.y - player.y;
            if (Math.sqrt(pdx * pdx + pdy * pdy) > 260) continue;
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
