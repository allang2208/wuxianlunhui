// ============================================================
// HamsterGuard — 仓鼠盾卫（2026-08-16）
// 玩家友方单位：复用 Companion 数据模型（data.hp/六维/动画配置），
// 由 HamsterGuardAI 驱动在世界-122 自动寻找最近敌人近战输出。
// - 生命 300（baseMaxHp 覆盖：con=25 ×10 + base 100 = 350 → 300）；
// - _faction='companion'（友方阵营，与玩家互不误伤）；
// - _enemyTargetable=true：防守怪可锁定/攻击它，因此提供 hp/maxHp/takeDamage；
// - 攻击：每 2s 一次，攻击动画第 10 帧判定 30 物理伤害，绝不攻击能源矿点；
// - 死亡：播 dying 动画（15 帧 @12fps = 1250ms）后自动从场景移除。
// ============================================================
import { Companion } from './companion.js';
import { updateFriendlyMovementSound } from '../utils/friendly-movement-sound.js';
import { HamsterGuardAI } from '../ai/hamster-guard-ai.js';
import hamsterGuardConfig from '../../data/hamster-guard-config.json';
import { getAbilityLevel, getAbilityValue } from '../world/ability-store.js';
import { getBuildingUpgradeAbility } from '../world/building-upgrade-projects.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { canMeleeShareSurface } from '../combat/melee-surface.js';

const DYING_DURATION_MS = 1250; // dying 15 帧 @12fps = 1250ms

export class HamsterGuard extends Companion {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterGuardConfig,
            ...overrides,
            ai: { ...(hamsterGuardConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterGuardConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterGuardConfig.render || {}), ...(overrides.render || {}) },
        };
        super(archive);

        this._isHamsterGuard = true;
        this.animId = 'hamster_guard'; // 多实例共用素材动画键（渲染按 animId 取键）
        this._skipNeutralSprite = true;   // 由侍从渲染管线接管，禁止 _syncNeutralEntities 画兜底圆
        this._enemyTargetable = true;     // 防守怪可锁定（与仓鼠矿工/战士同口径）
        this.x = x;
        this.y = y;
        // 步兵默认与仓鼠牧师共用 20×100 碰撞标准。
        this.groundRadius = Number(archive.groundRadius) || 20;
        this.collisionRadius = Number(archive.collisionRadius) || this.groundRadius;
        this.bodyHeight = Number(archive.bodyHeight) || 100;
        this.size = Number(archive.size) || 64;
        this.hittable = true;
        this.hitFlash = 0;
        const renderConfig = archive.render || {};
        this.footOffsetY = Math.max(0, Number(renderConfig.footOffsetY) || 43.862083);
        this.config = {
            render: {
                ...renderConfig,
                hudOffsetY: Math.max(0, Number(renderConfig.hudOffsetY) || 119),
                footOffsetY: this.footOffsetY,
            },
        };
        this._dying = false;
        this._deathTimer = 0;
        this._ai = new HamsterGuardAI(this);
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
        if (_isMelee && source && !canMeleeShareSurface(source, this)) {
            return { damage: 0, parried: false, critical: false, blockedBySurface: true };
        }
        // 铁匠铺能力：自动防御（2026-08-17）——受击 25%+5%/级 概率触发，减免 50% 伤害
        const guardLv = getAbilityLevel('auto_guard');
        const guardAbility = getBuildingUpgradeAbility('auto_guard');
        if (guardLv > 0 && guardAbility && Math.random() < getAbilityValue(guardAbility, guardLv)) {
            damage = Math.round(damage * (1 - guardAbility.damageReduction));
            if (EffectManager) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 34, '🛡️ 防御', '#7fd4ff'));
            }
        }
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
    }

    /** 仓鼠兵营升级同步（2026-08-16）：攻击间隔/伤害/移速/生命实时生效 */
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
        if (this.hasStatusEffect('petrified')) {
            this.vx = 0; this.vy = 0; this.isMoving = false;
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
