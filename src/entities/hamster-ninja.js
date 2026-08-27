// ============================================================
// HamsterNinja — 仓鼠忍者
// 雪原学院城堡特色步兵：低生命、高物伤，首击拔刀 200%，持续攻击改用
// 连续斩动画；停止攻击 4 秒后重新蓄好拔刀首击。主动烟遁会播放投弹动作，
// 随后进入半透明、敌人不可锁定、单位间无碰撞且移动速度 +30% 的隐身状态。
// ============================================================
import { Companion } from './companion.js';
import { HamsterNinjaAI } from '../ai/hamster-ninja-ai.js';
import hamsterNinjaConfig from '../../data/hamster-ninja-config.json';

const DYING_DURATION_MS = 1360;

export class HamsterNinja extends Companion {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterNinjaConfig,
            ...overrides,
            ai: { ...(hamsterNinjaConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterNinjaConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterNinjaConfig.render || {}), ...(overrides.render || {}) },
        };
        super(archive);

        this._isHamsterNinja = true;
        this.animId = 'hamster_ninja';
        this._skipNeutralSprite = true;
        this._enemyTargetable = true;
        this.x = x;
        this.y = y;
        this.groundRadius = Number(archive.groundRadius) || 20;
        this.collisionRadius = Number(archive.collisionRadius) || this.groundRadius;
        this.bodyHeight = Number(archive.bodyHeight) || 100;
        this.size = Number(archive.size) || 64;
        this.hittable = true;
        this.hitFlash = 0;
        const renderConfig = archive.render || {};
        this.footOffsetY = Math.max(0, Number(renderConfig.footOffsetY) || 100.921875);
        this.config = {
            render: {
                ...renderConfig,
                hudOffsetY: Math.max(0, Number(renderConfig.hudOffsetY) || 146),
                footOffsetY: this.footOffsetY,
            },
        };

        this._openingStrikeArmed = true;
        this._attackVariant = 'opening';
        this._attackSwingSeq = 0;
        this._isStealthed = false;
        this._stealthCastActive = false;
        this._stealthCastSeq = 0;
        this._stealthCooldownLeft = 0;
        this._stealthPreviousNoCollision = false;
        this._dying = false;
        this._deathTimer = 0;
        this._animState = 'idle';
        this._ai = new HamsterNinjaAI(this);
        this.configureCollisionFromArchive(archive);
    }

    get hp() { return this.data.hp; }
    get maxHp() { return this.data.maxHp; }

    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        if (this._dying || this.data.hp <= 0) return { damage: 0, parried: false, critical: false };
        const result = super.takeDamage(damage, source, damageType, isMelee);
        if (this.data.hp <= 0) this._startDying();
        return result;
    }

    /** 左下指令栏能力入口。enable 省略时按当前状态切换。 */
    setStealth(enable = !this._isStealthed && !this._stealthCastActive) {
        return this._ai?.setStealth?.(!!enable) || { ok: false, reason: '烟遁不可用' };
    }

    _applyStealthState(active) {
        if (active === this._isStealthed) return;
        if (active) {
            this._stealthPreviousNoCollision = !!this.noCollision;
            this._isStealthed = true;
            this.noCollision = true;
            this._enemyTargetable = false;
            this._dropExistingEnemyLocks();
        } else {
            this._isStealthed = false;
            this.noCollision = this._stealthPreviousNoCollision;
            this._enemyTargetable = true;
        }
    }

    /** 已经锁住本单位的敌人也必须立即丢失目标，避免只阻止后续重新选中。 */
    _dropExistingEnemyLocks() {
        const game = (typeof window !== 'undefined' && window.Game) || null;
        const entities = game?.entities;
        const iterable = entities?.values?.() || entities || [];
        for (const entity of iterable) {
            if (!entity || entity._faction !== 'enemy') continue;
            if (entity.target === this) {
                entity.target = null;
                entity._lastKnownTargetPos = null;
                entity._lostSightTimer = 0;
            }
            entity._threatTable?.delete?.(this.id);
        }
    }

    _startDying() {
        this._applyStealthState(false);
        this._stealthCastActive = false;
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

    applyBarracksUpgrades(upgrades = {}) {
        if (this._ai) {
            if (upgrades.attackInterval) this._ai._attackInterval = upgrades.attackInterval;
            if (upgrades.attackDamage) this._ai._attackDamage = upgrades.attackDamage;
            if (upgrades.attackRange) this._ai._attackRange = upgrades.attackRange;
        }
        if (this.aiConfig) {
            if (upgrades.attackInterval) this.aiConfig.attackInterval = upgrades.attackInterval;
            if (upgrades.attackDamage) this.aiConfig.attackDamage = upgrades.attackDamage;
            if (upgrades.attackRange) this.aiConfig.attackRange = upgrades.attackRange;
            if (upgrades.walkSpeed) {
                this.aiConfig.walkSpeed = upgrades.walkSpeed;
                this.aiConfig.runSpeed = upgrades.walkSpeed;
            }
        }
        if (upgrades.baseMaxHp && this._maxHpOverride !== upgrades.baseMaxHp) {
            this._maxHpOverride = upgrades.baseMaxHp;
            this.updateMaxStats?.();
        }
    }

    update(dt, entities) {
        if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
        this._stealthCooldownLeft = Math.max(0, this._stealthCooldownLeft - dt);
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
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            return;
        }
        const game = (typeof window !== 'undefined' && window.Game) || null;
        this._ai?.update(dt, entities, (game?.player && !game._observerMode) ? game.player : null);
    }

    _removeFromScene() {
        this.active = false;
        this.detachFromOwner();
        const game = (typeof window !== 'undefined' && window.Game) || null;
        if (!game) return;
        if (game.entities && this.id) game.entities.delete(this.id);
        if (Array.isArray(game.friendlyUnits)) {
            const index = game.friendlyUnits.indexOf(this);
            if (index >= 0) game.friendlyUnits.splice(index, 1);
        }
    }
}
