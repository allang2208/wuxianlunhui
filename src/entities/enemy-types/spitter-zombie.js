import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { ProjectileFactory } from '../../utils/projectile-factory.js';
import { AimHelper } from '../../utils/aim-helper.js';
import { COMBAT_CONFIG } from '../../config/combat-config.js';
import { SoundManager } from '../../ui/sound-manager.js';

/**
 * 毒液僵尸（SpitterZombie）
 * - 远程毒液喷射
 * - 使用 assets/enemies/spitter_zombie/ 下的 idle/walking/attacking 精灵图
 */
export class SpitterZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.spitterZombie,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false; // 禁用 pacing 导致的冲刺，保持远程站位
        this._animState = 'idle';
        this._animStateTimer = 0;
        this._attackTimer = 0;
        this._attackAnimTimer = 0; // MovementSystem 用，攻击期间冻结移动
        this._attackDuration = 1000; // 与 BootScene 中攻击动画时长一致

        // 毒液投射物在攻击动画第 12 帧（0 基）发射
        this._spitFireFrame = 12;
        this._spitTotalFrames = 22;
        this._pendingSpit = null;

        // 头部发射点：基于 90px 显示尺寸与精灵构图估算，向下偏移 20px
        this._headOffset = { x: 24, y: -8 };

        this._setupRangedAttackWrapper();
    }

    /**
     * 重写远程攻击执行：不立即发射，而是延迟到攻击动画第 12 帧从头部射出
     */
    _setupRangedAttackWrapper() {
        const ranged = this.attacks && this.attacks.ranged;
        if (!ranged) return;
        ranged.execute = (source, targetX, targetY, entities) => {
            // 不在这里发射，由 update 按帧触发，保证与动画同步
            source._pendingSpit = {
                targetX,
                targetY,
                entities: entities ? (Array.isArray(entities) ? entities.slice() : Array.from(entities)) : [],
                fired: false
            };
            return true;
        };
    }

    update(dt, entities) {
        super.update(dt, entities);

        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._attackTimer < 0) this._attackTimer = 0;
        }
        if (this._attackAnimTimer > 0) {
            this._attackAnimTimer -= dt;
            if (this._attackAnimTimer < 0) this._attackAnimTimer = 0;
        }

        // 攻击动画第 12 帧发射毒液
        if (this._pendingSpit && !this._pendingSpit.fired && this._attackTimer > 0) {
            const elapsed = this._attackDuration - this._attackTimer;
            const fireElapsed = this._attackDuration * (this._spitFireFrame / this._spitTotalFrames);
            if (elapsed >= fireElapsed) {
                this._fireSpit(this._pendingSpit);
                this._pendingSpit.fired = true;
            }
        }
        if (this._attackTimer <= 0) {
            this._pendingSpit = null;
        }

        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let nextState;
        if (this._attackTimer > 0) {
            nextState = 'attack';
        } else {
            const maxSpd = this.maxSpeed || this.speed || 250;
            const walkThreshold = maxSpd * 0.05;
            if (speed > walkThreshold) {
                nextState = 'walk';
            } else {
                nextState = 'idle';
            }
        }

        // 状态切换加入最小保持时间，防止阈值边缘抖动
        this._animStateTimer = (this._animStateTimer || 0) + dt;
        const minHoldTime = 80;
        if (nextState !== this._animState) {
            if (this._animStateTimer >= minHoldTime) {
                this._animState = nextState;
                this._animStateTimer = 0;
            }
        }

        // 朝向：攻击时面向目标，移动时面向移动方向
        if (this._attackTimer > 0 && this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }
    }

    triggerWeaponAnim() {
        if (this._attackTimer > 0) return;
        // 不调用 super.triggerWeaponAnim，避免 pacingAI 的冲刺逻辑
        this._attackTimer = this._attackDuration;
        this._attackAnimTimer = this._attackDuration;
        this._animState = 'attack';
        this._animStateTimer = 0;
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    /**
     * 估算头部世界坐标（基于精灵朝向 flipX）
     * 说明：当前没有逐帧骨骼/锚点数据，只能根据 90px 显示尺寸和精灵构图估算。
     */
    _getHeadWorldPosition() {
        const options = this._getPhaserOptions();
        const dirX = options.flipX ? -1 : 1;
        return {
            x: this.x + dirX * this._headOffset.x,
            y: this.y + this._headOffset.y
        };
    }

    _fireSpit(pending) {
        const attack = this.attacks && this.attacks.ranged;
        if (!attack) return;
        const cfg = attack.config;

        const baseDamage = this.getCurrentWeaponAtk
            ? this.getCurrentWeaponAtk()
            : Math.floor((cfg.damage.min + cfg.damage.max) / 2);
        const damage = { min: baseDamage, max: baseDamage };

        let piercing = cfg.piercing;
        if (this.getCurrentWeapon) {
            const weapon = this.getCurrentWeapon();
            if (weapon) {
                if (weapon._enchantEffects && weapon._enchantEffects.piercingBonus) {
                    piercing = (piercing || 0) + weapon._enchantEffects.piercingBonus;
                }
            }
        }

        const projDefaults = COMBAT_CONFIG.projectile?.defaults || { speed: 10, range: 625, size: 6 };
        const projectileSpeed = cfg.projectileSpeed || projDefaults.speed;
        const projectileRange = cfg.projectileRange || projDefaults.range;
        const projectileSize = cfg.projectileSize || projDefaults.size;

        const head = this._getHeadWorldPosition();
        let aimX = pending.targetX;
        let aimY = pending.targetY;
        if (this.target && this.target.active && this.target.vx !== undefined) {
            const lead = AimHelper.lead(
                head.x, head.y,
                this.target.x, this.target.y,
                this.target.vx || 0, this.target.vy || 0,
                projectileSpeed
            );
            aimX = lead.x;
            aimY = lead.y;
        }
        const angle = Math.atan2(aimY - head.y, aimX - head.x);

        SoundManager.play('bow_fire');
        ProjectileFactory.create({
            x: head.x,
            y: head.y,
            angle,
            speed: projectileSpeed,
            maxRange: projectileRange,
            size: projectileSize,
            damage,
            piercing,
            source: this,
            entities: pending.entities,
            image: this.arrowImage,
            damageType: cfg.damageType || 'physical',
            isSpit: true
        });
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'attack': return 'enemy_spitter_zombie_attack';
            case 'walk': return 'enemy_spitter_zombie_walk';
            default: return 'enemy_spitter_zombie_idle';
        }
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 90;
        let flipX = false;
        if (this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 30,
            collisionHeight: renderCfg.collisionHeight || 90,
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState: this._animState,
            animKey: `enemy_spitter_zombie_${this._animState}`,
        };
    }
}
