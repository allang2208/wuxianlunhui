// ============================================================
// HamsterScout — 仓鼠斥候（2026-08-17）
// 玩家友方单位：复用 Companion 数据模型（data.hp/六维/动画配置），
// 由 HamsterScoutAI 驱动在世界-122 自动寻找最近敌人远程输出。
// - 生命 100（baseMaxHp 覆盖：con=7 ×10 + base 100 = 170 → 100）；
// - _faction='companion'（友方阵营，与玩家互不误伤）；
// - _enemyTargetable=true：防守怪可锁定/攻击它，因此提供 hp/maxHp/takeDamage；
// - 攻击：每 2.5s 发射一支投射物（攻击动画第 11 帧出膛），造成 25 物理伤害，
//   瞄准目标贴图中心 + AimHelper 提前量，绝不攻击能源矿点；
// - 死亡：播 dying 动画（11 帧）后自动从场景移除。
// ============================================================
import { Companion } from './companion.js';
import { updateFriendlyMovementSound } from '../utils/friendly-movement-sound.js';
import { HamsterScoutAI } from '../ai/hamster-scout-ai.js';
import hamsterScoutConfig from '../../data/hamster-scout-config.json';

const MIN_DYING_DURATION_MS = 1000;

export class HamsterScout extends Companion {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterScoutConfig,
            ...overrides,
            ai: { ...(hamsterScoutConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterScoutConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterScoutConfig.render || {}), ...(overrides.render || {}) },
        };
        super(archive);

        this._isHamsterScout = true;
        this.animId = 'hamster_scout'; // 多实例共用素材动画键（渲染按 animId 取键）
        this._skipNeutralSprite = true;   // 由侍从渲染管线接管，禁止 _syncNeutralEntities 画兜底圆
        this._enemyTargetable = true;     // 防守怪可锁定（与矿工/战士/射手同口径）
        this.x = x;
        this.y = y;
        this.groundRadius = Number(archive.groundRadius) || 20;
        this.collisionRadius = Number(archive.collisionRadius) || this.groundRadius;
        this.bodyHeight = Number(archive.bodyHeight) || 100;
        this.size = Number(archive.size) || 64;
        const hasExplicitFogProfile = Object.prototype.hasOwnProperty.call(
            overrides, 'fogVisionProfile'
        );
        const hasExplicitFogRadius = Object.prototype.hasOwnProperty.call(
            overrides, 'fogSightRadius'
        );
        if ((archive.id === hamsterScoutConfig.id || hasExplicitFogProfile)
            && archive.fogVisionProfile) {
            this.fogVisionProfile = archive.fogVisionProfile;
        }
        const configuredFogSightRadius = Number(archive.fogSightRadius);
        if ((archive.id === hamsterScoutConfig.id || hasExplicitFogRadius)
            && Number.isFinite(configuredFogSightRadius) && configuredFogSightRadius > 0) {
            this.fogSightRadius = configuredFogSightRadius;
        }
        this.hittable = true;
        this.hitFlash = 0;
        const renderConfig = archive.render || {};
        this.footOffsetY = Math.max(0, Number(renderConfig.footOffsetY) || 23);
        this.config = {
            render: {
                ...renderConfig,
                hudOffsetY: Math.max(0, Number(renderConfig.hudOffsetY) || 119),
                footOffsetY: this.footOffsetY,
            },
        };
        this._dying = false;
        this._deathTimer = 0;
        const dyingAnim = archive.animations?.dying || {};
        const dyingFrameCount = Math.max(1, Number(dyingAnim.frameCount) || 1);
        const dyingFrameRate = Math.max(1, Number(dyingAnim.frameRate) || 12);
        this._dyingDurationMs = Math.max(MIN_DYING_DURATION_MS, dyingFrameCount / dyingFrameRate * 1000 + 60);
        this._ai = new HamsterScoutAI(this);
        this._animState = 'idle';
        this.configureCollisionFromArchive(archive);
    }

    get hp() { return this.data.hp; }
    get maxHp() { return this.data.maxHp; }

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
        this._basic = null;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.maxSpeed = 0;
        this._deathTimer = this._dyingDurationMs;
    }

    /** 产兵建筑/兵营升级同步（2026-08-17）：攻击间隔/伤害/射程/移速/生命实时生效 */
    applyBarracksUpgrades(u = {}) {
        if (this._ai) {
            if (u.attackInterval) this._ai._attackInterval = u.attackInterval;
            if (u.attackDamage) this._ai._attackDamage = u.attackDamage;
            if (u.attackRange) this._ai._attackRange = u.attackRange;
        }
        if (this.aiConfig) {
            if (u.attackInterval) this.aiConfig.attackInterval = u.attackInterval;
            if (u.attackDamage) this.aiConfig.attackDamage = u.attackDamage;
            if (u.attackRange) this.aiConfig.attackRange = u.attackRange;
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
        if (this.isCombatActionBlocked()) {
            this._updateBlockedCombat(dt, entities);
            return;
        }
        if (this._ai) {
            const game = (typeof window !== 'undefined' && window.Game) || null;
            this._ai.update(dt, entities, (game && game.player && !game._observerMode) ? game.player : null); // 观察模式：仓鼠部队不跟随不在场的玩家
            updateFriendlyMovementSound(this, dt);
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
