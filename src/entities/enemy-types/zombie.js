import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { playSoundFrom } from './_shared/enemy-utils.js';

/**
 * 普通僵尸（Zombie）
 * - 近战突刺，行动迟缓
 * - 精灵图：idle / walking / attacking / dying 四动作（v2）
 * - 攻击动画持续 1s，攻击间隔 2s（attack.cooldown），92px内起手、80px接触帧前向判定
 */
export class Zombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.zombie,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        this._usesDirectedBasicMelee = true;

        // 动画状态：idle | walk | attack | death
        this._animState = 'idle';
        this._animStateTimer = 0;

        // 攻击动画控制
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._attackDuration = this._getFrameLayout('attack').duration ?? 1000;

        // idle 音轨与 24 帧 / 5 FPS 动画循环同步；路径与间隔均由配置驱动。
        this._idleSoundTimer = 0;

        // 死亡动画与短暂保尸；Game/GameScene 已识别同名计时字段。
        this._preserveCorpse = true;
        this._deathStarted = false;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathAnimation(dt);
            return;
        }
        super.update(dt, entities);

        // 更新计时器
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._attackTimer < 0) this._attackTimer = 0;
        }
        if (this._attackAnimTimer > 0) {
            this._attackAnimTimer -= dt;
            if (this._attackAnimTimer < 0) this._attackAnimTimer = 0;
        }

        // 状态切换
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let nextState;
        if (this._attackTimer > 0) {
            nextState = 'attack';
        } else {
            const maxSpd = this.maxSpeed || this.speed || 110;
            const walkThreshold = maxSpd * 0.05;
            nextState = speed > walkThreshold ? 'walk' : 'idle';
        }

        this._animStateTimer = (this._animStateTimer || 0) + dt;
        const minHoldTime = 80;
        if (nextState !== this._animState) {
            if (this._animStateTimer >= minHoldTime) {
                this._animState = nextState;
                this._animStateTimer = 0;
            }
        }

        // 只在真正静止待机时播放世界位置音效；移动/攻击会清零，回到 idle 首帧重新同步。
        if (this._animState === 'idle' && nextState === 'idle') {
            this._idleSoundTimer -= dt;
            if (this._idleSoundTimer <= 0) {
                const idleLayout = this._getFrameLayout('idle');
                const loopMs = Math.max(
                    250,
                    ((idleLayout.frameCount || 1) / (idleLayout.frameRate || 5)) * 1000,
                );
                this._idleSoundTimer = this.config?.sounds?.idleInterval ?? loopMs;
                playSoundFrom(this, 'idle');
            }
        } else {
            this._idleSoundTimer = 0;
        }

        // 朝向
        if (this._attackTimer > 0 && this._pendingThrust?.basicMeleeSnapshot) {
            this.rotation = this._pendingThrust.basicMeleeSnapshot.worldAngle;
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }
    }

    triggerWeaponAnim() {
        // 正在攻击时不插队
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackDuration;
        this._attackAnimTimer = this._attackDuration;
        this._animState = 'attack';
        this._animStateTimer = 0;
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
        // 必须触发通用武器动画状态机，才能在 swing 阶段执行 ThrustAttack.checkTriangleHit
        super.triggerWeaponAnim();
    }

    _getFrameLayout(state = this._animState) {
        const layouts = this.config?.textures?.frameLayouts || {};
        return layouts[state] || layouts.idle || {
            frameWidth: 512,
            frameHeight: 512,
            frameCount: 1,
            footY: 489,
        };
    }

    _getDeathConfig() {
        return this.config?.deathAnim || {};
    }

    _updateDeathAnimation(dt) {
        if (!this._deathStarted) return;
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer = Math.max(0, this._deathAnimTimer - dt);
            if (this._deathAnimTimer <= 0) {
                this._corpseTimer = this._getDeathConfig().holdMs ?? 1000;
            }
        } else if (this._corpseTimer > 0) {
            this._corpseTimer = Math.max(0, this._corpseTimer - dt);
            if (this._corpseTimer <= 0 && this._phaserSprite?.active) {
                this._phaserSprite.destroy();
                this._phaserSprite = null;
            }
        }
    }

    onDeath(source) {
        if (this._deathStarted) return;
        this._deathStarted = true;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.target = null;
        this._tacticalTarget = null;
        this._animState = 'death';
        this._animStateTimer = 0;
        const death = this._getDeathConfig();
        const duration = death.duration ?? 2000;
        const holdMs = death.holdMs ?? 1000;
        this._deathAnimTimer = duration;
        this._corpseTimer = 0;
        this._deathRemoveDelay = duration + holdMs + 500;
        super.onDeath(source);
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'death': return 'enemy_zombie_death';
            case 'walk': return 'enemy_zombie_walk';
            case 'attack': return 'enemy_zombie_attack';
            default: return 'enemy_zombie_idle';
        }
    }

    _getPhaserOptions() {
        // 原始素材面向右，目标/移动方向朝左时翻转
        let flipX = false;
        if (this._attackTimer > 0 && this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }

        const renderCfg = this.config?.render || {};
        const layout = this._getFrameLayout();
        const referenceCell = this.config?.textures?.referenceCell ?? 512;
        const frameWidth = layout.frameWidth ?? referenceCell;
        const frameHeight = layout.frameHeight ?? referenceCell;
        const baseSpriteSize = renderCfg.spriteSize || 120;
        const pixelScale = baseSpriteSize / referenceCell;
        const spriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
        const footY = layout.footY ?? frameHeight;
        this.footOffsetY = (footY - frameHeight / 2) * pixelScale;
        const collisionWidth = renderCfg.collisionWidth || 30;
        const collisionHeight = renderCfg.collisionHeight || 50;

        return {
            spriteSize,
            collisionWidth,
            collisionHeight,
            textOffsetY: -baseSpriteSize / 2 - 10,
            flipX,
            animState: this._animState,
            // v2 母版已统一锚点，不复用旧动画键对应的 sprite-offsets。
            animKey: `enemy_zombie_${this._animState}_v2`,
        };
    }
}
