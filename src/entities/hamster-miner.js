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
        this._enemyTargetable = true; // 防守怪可锁定（露娜无此标记，保持不拉仇恨）
        this.x = x;
        this.y = y;
        this.collisionRadius = this.groundRadius || 26;
        this.size = 84; // distanceToEntityShape 兜底
        this.hittable = true;
        this.hitFlash = 0;
        this._dying = false;
        this._deathTimer = 0;
        this._ai = new HamsterMinerAI(this);
        this._animState = 'idle';
    }

    get hp() { return this.data.hp; }
    get maxHp() { return this.data.maxHp; }

    /**
     * 受击入口（CombatSystem / DamagePipeline / 投射物统一调用）。
     * 死亡 → 播 dying 动画，结束后由 update 自清理。
     */
    takeDamage(damage, source, _damageType = 'physical', _isMelee = true) {
        if (this._dying || this.data.hp <= 0) return 0;
        const before = this.data.hp;
        this.data.hp = Math.max(0, this.data.hp - damage);
        this.hitFlash = 120;
        if (this.data.hp <= 0) {
            this._startDying();
        }
        return before - this.data.hp;
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
    }

    /** 仓鼠小屋升级后刷新本矿工参数（间隔/伤害/移速/采矿效率） */
    applyHutUpgrades(u) {
        if (this._ai) this._ai.applyUpgrades(u);
    }

    /** 主循环入口（Game.entities 每帧调用） */
    update(dt, entities) {
        if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
        if (this._dying) {
            this._deathTimer -= dt;
            if (this._deathTimer <= 0) this._removeFromScene();
            return;
        }
        if (this.data.hp <= 0) {
            this._startDying();
            return;
        }
        if (this._ai) {
            const game = (typeof window !== 'undefined' && window.Game) || null;
            this._ai.update(dt, entities, game && game.player);
        }
    }

    /** 死亡结算：从实体表与友方单位表移除（Phaser 精灵由 GameScene 同步循环清理） */
    _removeFromScene() {
        this.active = false;
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
