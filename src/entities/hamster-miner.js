// ============================================================
// HamsterMiner — 仓鼠矿工（2026-08-15）
// 玩家友方单位：复用 Companion 数据模型（data.hp/六维/动画配置），
// 由 HamsterMinerAI 驱动在世界-122 自动采矿。
// - 生命 200（con=10 × 10 + base 100）；
// - _faction='companion'（友方阵营，与玩家互不误伤）；
// - _enemyTargetable=true：区别于露娜（不拉仇恨），防守怪可锁定/攻击它，
//   因此提供 hp/maxHp/takeDamage 供 DamagePipeline/CombatSystem 消费；
// - 死亡：播 dying 动画（11 帧）后自动从场景移除。
// ============================================================
import { Companion } from './companion.js';
import { HamsterMinerAI } from '../ai/hamster-miner-ai.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import hamsterMinerConfig from '../../data/hamster-miner-config.json';

const DYING_DURATION_MS = 1000; // dying 11 帧 @12fps ≈ 917ms，留余量

export class HamsterMiner extends Companion {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterMinerConfig,
            ...overrides,
            ai: { ...(hamsterMinerConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterMinerConfig.animations || {}), ...(overrides.animations || {}) },
        };
        super(archive);

        this._isHamsterMiner = true;
        // 自动矿工使用自身配置的经济倍率；玩家与普通队友仍回退全局采集倍率。
        this._energyGatherRatio = Number(this.aiConfig?.energyGatherRatio);
        this._rtsCanAttack = false;
        this._rtsSelectable = false; // 经济平民：保留实体采集/受击能力，但不进入玩家选取与指挥体系
        this.animId = 'hamster_miner'; // 多实例共用素材动画键（渲染按 animId 取键）
        this._skipNeutralSprite = true; // 由侍从渲染管线接管，禁止 _syncNeutralEntities 画兜底棕圆
        this._enemyTargetable = true; // 防守怪可锁定（露娜无此标记，保持不拉仇恨）
        this.x = x;
        this.y = y;
        // 贴图/碰撞体积缩小 25%（2026-08-15）：显示 132→99（displaySize 由配置驱动），
        // 碰撞 groundRadius 26→19.5、bodyHeight 130→97.5、size 84→63
        this.groundRadius = Math.round(26 * 0.75 * 10) / 10;      // 19.5
        this.collisionRadius = this.groundRadius;
        this.bodyHeight = Math.round(130 * 0.75 * 10) / 10;       // 97.5
        this.size = Math.round(84 * 0.75);                        // 63（distanceToEntityShape 兜底）
        this.hittable = true;
        this.hitFlash = 0;
        // 经济背包：矿点产出先进入矿工背包，返回所属营地提交后才进入仓库。
        this._energyCarried = 0;
        this._energyCapacity = this.aiConfig?.backpackCapacity || 100;
        this._miningSwingSeq = 0;
        this._retireRequested = false;
        this._dying = false;
        this._deathTimer = 0;
        this._ai = new HamsterMinerAI(this);
        this._animState = 'idle';
        this.configureCollisionFromArchive(archive);
    }

    get hp() { return this.data.hp; }
    get maxHp() { return this.data.maxHp; }

    /** 矿点采集入口：只装入个人背包，返回矿工营地前不会改变仓库库存。 */
    addMinedEnergy(amount) {
        const requested = Math.max(0, Math.floor(Number(amount) || 0));
        const free = Math.max(0, this._energyCapacity - this._energyCarried);
        const added = Math.min(requested, free);
        this._energyCarried += added;
        return added;
    }

    getMinedEnergyFreeCapacity() {
        return Math.max(0, this._energyCapacity - this._energyCarried);
    }

    /**
     * 受击入口（CombatSystem / DamagePipeline / 投射物统一调用）。
     * 死亡 → 播 dying 动画，结束后由 update 自清理。
     */
    takeDamage(damage, source, _damageType = 'physical', _isMelee = true, hitContext = null) {
        if (this._dying || this.data.hp <= 0) return { damage: 0, parried: false, critical: false };
        const result = super.takeDamage(damage, source, _damageType, _isMelee, hitContext);
        if (this.data.hp <= 0) {
            this._startDying();
        }
        return result;
    }

    _startDying() {
        this._dying = true;
        this._animState = 'dying';
        this.target = null;
        this._tacticalTarget = null;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.maxSpeed = 0;
        this._deathTimer = DYING_DURATION_MS;
        // 被击杀：携带能量全部丢失（不返还、不掉落）
        if (this._energyCarried > 0 && EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 46, `丢失 ${this._energyCarried} 能量`, '#ff8855'));
            this._energyCarried = 0;
        }
    }

    /** 仓鼠小屋升级后刷新本矿工参数（间隔/伤害/移速/采矿效率/背包容量） */
    applyHutUpgrades(u) {
        if (typeof u.backpackCapacity === 'number' && u.backpackCapacity > 0) {
            this._energyCapacity = u.backpackCapacity;
            if (this._energyCarried > this._energyCapacity) {
                this._energyCarried = this._energyCapacity;
            }
        }
        if (this._ai) this._ai.applyUpgrades(u);
    }

    /** 主循环入口（Game.entities 每帧调用） */
    update(dt, entities) {
        if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
        this.updateStatusEffects(dt);
        if (this._dying) {
            this._deathTimer -= dt;
            if (this._deathTimer <= 0) this._removeFromScene();
            return;
        }
        if (this.data.hp <= 0) {
            this._startDying();
            return;
        }
        if (this.hasStatusEffect('petrified')) {
            this.vx = 0; this.vy = 0; this.isMoving = false;
            return;
        }
        if (this._ai) {
            const game = (typeof window !== 'undefined' && window.Game) || null;
            this._ai.update(dt, entities, (game && game.player && !game._observerMode) ? game.player : null); // 观察模式：仓鼠部队不跟随不在场的玩家
        }
    }

    /** 死亡结算：从实体表与友方单位表移除（Phaser 精灵由 GameScene 同步循环清理） */
    _removeFromScene() {
        this.active = false;
        this.detachFromOwner();
        const game = (typeof window !== 'undefined' && window.Game) || null;
        if (game) {
            if (game.entities && this.id) game.entities.delete(this.id);
            if (Array.isArray(game.friendlyUnits)) {
                const i = game.friendlyUnits.indexOf(this);
                if (i >= 0) game.friendlyUnits.splice(i, 1);
            }
        }
    }
}
