// ============================================================
// HamsterMilitia — 仓鼠民兵（2026-08-17）
// 玩家友方单位：复用 Companion 数据模型（data.hp/六维/动画配置），
// 由 HamsterMilitiaAI 驱动在世界-122 自动寻找最近敌人近战输出。
// - 生命 125（baseMaxHp 覆盖：con=6 ×10 + base 100 = 160 → 125）；
// - _faction='companion'（友方阵营，与玩家互不误伤）；
// - _enemyTargetable=true：防守怪可锁定/攻击它，因此提供 hp/maxHp/takeDamage；
// - 攻击：每 2s 一次，攻击动画第 8 帧判定 20 物理伤害，绝不攻击能源矿点；
// - 死亡：播 dying 动画（14 帧 @12fps = 1167ms）后自动从场景移除。
// ============================================================
import { Companion } from './companion.js';
import { HamsterMilitiaAI } from '../ai/hamster-militia-ai.js';
import hamsterMilitiaConfig from '../../data/hamster-militia-config.json';

const DYING_DURATION_MS = 1167; // dying 14 帧 @12fps = 1167ms

export class HamsterMilitia extends Companion {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterMilitiaConfig,
            ...overrides,
            ai: { ...(hamsterMilitiaConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterMilitiaConfig.animations || {}), ...(overrides.animations || {}) },
        };
        super(archive);

        this._isHamsterMilitia = true;
        this.animId = 'hamster_militia'; // 多实例共用素材动画键（渲染按 animId 取键）
        this._skipNeutralSprite = true;   // 由侍从渲染管线接管，禁止 _syncNeutralEntities 画兜底圆
        this._enemyTargetable = true;     // 防守怪可锁定（与仓鼠矿工/战士同口径）
        this.x = x;
        this.y = y;
        // 碰撞/体积：与仓鼠战士同量级（世界-122 门洞/掩体间通行顺畅）
        this.groundRadius = 20;
        this.collisionRadius = 20;
        this.bodyHeight = 100;
        this.size = 64;
        this.hittable = true;
        this.hitFlash = 0;
        // 素材帧内脚底在 ~350/512（非 480）；displaySize 与仓鼠斥候统一为 460 后，
        // 脚底距帧中心约 84px。spriteOffsetY=-84 负责贴地，footOffsetY=84 保持深度线
        // 等于逻辑脚底；HUD 偏移同步放大，避免名字/血条压到增大的角色贴图。
        this.footOffsetY = 84;
        this.config = { render: { hudOffsetY: 195, footOffsetY: 84 } };
        this._dying = false;
        this._deathTimer = 0;
        this._ai = new HamsterMilitiaAI(this);
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
        super.takeDamage(damage, source, _damageType, _isMelee);
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

    /** 仓鼠兵营/产兵建筑升级同步（2026-08-16）：攻击间隔/伤害/移速/生命实时生效 */
    applyBarracksUpgrades(u = {}) {
        if (this._ai) {
            if (u.attackInterval) this._ai._attackInterval = u.attackInterval;
            if (u.attackDamage) this._ai._attackDamage = u.attackDamage;
        }
        if (this.aiConfig) {
            if (u.attackInterval) this.aiConfig.attackInterval = u.attackInterval;
            if (u.attackDamage) this.aiConfig.attackDamage = u.attackDamage;
            if (u.walkSpeed) this.aiConfig.walkSpeed = u.walkSpeed;
        }
        if (u.baseMaxHp && this._maxHpOverride !== u.baseMaxHp) {
            this._maxHpOverride = u.baseMaxHp;
            if (typeof this.updateMaxStats === 'function') this.updateMaxStats();
        }
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
