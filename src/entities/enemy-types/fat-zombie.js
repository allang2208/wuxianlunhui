import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { playSoundFrom } from './_shared/enemy-utils.js';
import { createGroundWarning, destroyWarning } from '../../effects/combat-fx.js';

/**
 * 胖子僵尸（FatZombie）
 * - 近战重击，移动缓慢
 * - 腐蚀区域的伤害、节拍与尺寸统一读取 enemy-config.json
 * - 死亡动画结束后，尸体会留下更大的持续伤害区域
 */
export class FatZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.fatZombie,
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
        this._attackDuration = 1000; // 攻击动画持续 1s

        const corrosionAura = this.config?.attackSkills?.corrosionAura || {};

        // 死亡动画/尸体保留
        this._preserveCorpse = true;
        this._deathAnimDuration = corrosionAura.deathAnimMs ?? 1500;
        this._corpseDuration = corrosionAura.corpseDuration ?? 6000;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._deathAnimPlayed = false;

        // 腐蚀区域
        this._auraTimer = 0;
        this._auraInterval = corrosionAura.intervalMs ?? 500;
        this._auraWidth = corrosionAura.width ?? 50;
        this._auraHeight = corrosionAura.height ?? 25;
        this._auraDamage = corrosionAura.damage ?? 8;
        // 尸体阶段腐蚀区域更大；中心对齐尸体脚底（entity.y），不再向下偏移，
        // 之前 offsetY=70 导致判定区域与尸体贴图错开。
        // 死亡后腐蚀半径增加一倍（rx=100, ry=25）。
        this._corpseAuraWidth = corrosionAura.corpseWidth ?? 200;
        this._corpseAuraHeight = corrosionAura.corpseHeight ?? 50;
        this._corpseAuraOffsetY = corrosionAura.corpseOffsetY ?? 0;

        // 前倾/攻击时的 footprint 重心偏移（屏幕 X 方向），可在 enemy-config.json render 中覆盖
        const render = this.config?.render || {};
        this._walkLeanOffset = render.walkLeanOffset ?? 22;
        this._attackLeanOffset = render.attackLeanOffset ?? 28;

        // 范围提示可视化
        this._auraRangeEffect = null;
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateCorpse(dt);
            // 尸体保留期间继续对周围造成腐蚀伤害
            if (this._corpseTimer > 0) {
                this._updateAura(dt, entities);
            }
            this._updateAuraRangeEffect();
            // 尸体阶段阴影/footprint 回到脚底，不再跟随 collider 偏移
            this.colliderOffsetX = 0;
            this.colliderOffsetY = 0;
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

        // 活体腐蚀属于持续攻击节拍，接入雾潮攻击时钟；尸体残留在上方分支保持原速。
        this._updateAura(this.getAttackIntervalDelta(dt), entities);

        // 腐蚀区域范围提示
        this._updateAuraRangeEffect();

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

        // 移动音效（配置 sounds.walk，按 walkInterval 间隔循环播放）
        if (this._animState === 'walk') {
            this._walkSoundTimer = (this._walkSoundTimer || 0) - dt;
            if (this._walkSoundTimer <= 0) {
                this._walkSoundTimer = this.config?.sounds?.walkInterval ?? 500;
                playSoundFrom(this, 'walk');
            }
        } else {
            this._walkSoundTimer = 0;
        }

        // 朝向
        if (this._attackTimer > 0 && this._pendingThrust?.basicMeleeSnapshot) {
            this.rotation = this._pendingThrust.basicMeleeSnapshot.worldAngle;
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }

        // 根据动画状态更新 footprint 重心偏移，让阴影/受击体积对齐视觉身体
        this._updateLeanOffset();
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

    onBasicMeleeContact() {
        playSoundFrom(this, 'attack');
    }

    _getAuraDimensions() {
        const isCorpse = !this.active && this._corpseTimer > 0;
        return {
            width: isCorpse ? this._corpseAuraWidth : this._auraWidth,
            height: isCorpse ? this._corpseAuraHeight : this._auraHeight,
            offsetY: isCorpse ? this._corpseAuraOffsetY : 0,
        };
    }

    _updateAura(dt, entities) {
        this._auraTimer -= dt;
        if (this._auraTimer > 0) return;
        this._auraTimer = this._auraInterval;

        const dims = this._getAuraDimensions();
        const cx = this.x;
        const cy = this.y + dims.offsetY;
        const shape = new GroundEllipse(
            cx,
            cy,
            dims.width / 2,
            dims.height / 2,
            surfaceEffectFromEntity(this)
        );

        const list = Array.isArray(entities) ? entities : (entities ? Array.from(entities.values()) : []);
        for (const entity of list) {
            if (!entity || entity === this || !entity.active || !entity.hittable) continue;
            if (entity._faction === this._faction) continue;
            if (shape.intersectsEntity(entity)) {
                entity.takeDamage(this._auraDamage, this, 'magic', false);
            }
        }
    }

    _updateAuraRangeEffect() {
        const showRange = typeof window !== 'undefined' && window.Game && window.Game.showAttackRange;
        const keepAlive = this.active || this._corpseTimer > 0;

        if (!showRange || !keepAlive) {
            // 共享件 destroyWarning：active=false + 显式销毁图形（防残留）
            this._auraRangeEffect = destroyWarning(this._auraRangeEffect);
            return;
        }

        const dims = this._getAuraDimensions();
        const rx = dims.width / 2;
        const ry = dims.height / 2;
        if (!this._auraRangeEffect ||
            this._auraRangeEffect.range !== rx ||
            this._auraRangeEffect.width !== ry) {
            // 尺寸变化重建（外壳保留；创建口诀换共享件，ry 比例独立需显式传入）
            destroyWarning(this._auraRangeEffect);
            this._auraRangeEffect = createGroundWarning(this.x, this.y + dims.offsetY, rx, ry);
        }
        this._auraRangeEffect.x = this.x;
        this._auraRangeEffect.y = this.y + dims.offsetY;
        this._auraRangeEffect.life = 100;
        this._auraRangeEffect.active = true;
    }

    _updateCorpse(dt) {
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer -= dt;
            if (this._deathAnimTimer <= 0) {
                this._deathAnimTimer = 0;
                this._corpseTimer = this._corpseDuration;
                // 停在最后一帧由 GameScene 处理
            }
        } else if (this._corpseTimer > 0) {
            this._corpseTimer -= dt;
            if (this._corpseTimer <= 0) {
                this._corpseTimer = 0;
                // 尸体时间到，销毁 Phaser Sprite
                if (this._phaserSprite && this._phaserSprite.active) {
                    this._phaserSprite.destroy();
                    this._phaserSprite = null;
                }
            }
        }
    }

    onDeath(source) {
        this.active = false;
        this._animState = 'death';
        this._deathAnimTimer = this._deathAnimDuration;
        this._corpseTimer = 0;
        this._deathAnimPlayed = false;
        // 延迟删除：死亡动画 + 尸体毒域持续时间 + 缓冲
        this._deathTime = Date.now();
        this._deathRemoveDelay = this._deathAnimDuration + this._corpseDuration + 500;

        // 死亡音效（配置 sounds.death，死亡时播放一次）
        playSoundFrom(this, 'death');

        // 调用父类除 Sprite 销毁外的逻辑
        // 金币/经验掉落、声音、特效
        if (typeof super.onDeath === 'function') {
            // 临时阻止父类销毁 Sprite
            const preserve = this._preserveCorpse;
            this._preserveCorpse = true;
            super.onDeath(source);
            this._preserveCorpse = preserve;
        }
    }

    _getFacingSign() {
        if (this._attackTimer > 0 && this.target && this.target.active) {
            return this.target.x < this.x ? -1 : 1;
        }
        if (this.isMoving && Math.abs(this.vx) > 0.1) {
            return this.vx < 0 ? -1 : 1;
        }
        if (this.rotation !== undefined) {
            return Math.cos(this.rotation) < 0 ? -1 : 1;
        }
        return 1;
    }

    _updateLeanOffset() {
        const sign = this._getFacingSign();
        if (this._animState === 'walk') {
            // walking 前倾：重心/阴影相对脚底向后偏移
            this.colliderOffsetX = -this._walkLeanOffset * sign;
        } else {
            // 攻击/待机/尸体：脚下阴影与 footprint 椭圆判定保持在脚底，不做位移（2026-07-17 调整）
            this.colliderOffsetX = 0;
        }
        this.colliderOffsetY = 0;
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_fat_zombie_walk';
            case 'attack': return 'enemy_fat_zombie_attack';
            case 'death': return 'enemy_fat_zombie_melt';
            default: return 'enemy_fat_zombie_idle';
        }
    }

    _getPhaserOptions() {
        let flipX = false;
        if (this._attackTimer > 0 && this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }

        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 120;
        const collisionWidth = renderCfg.collisionWidth || 50;
        const collisionHeight = renderCfg.collisionHeight || 25;

        const options = {
            spriteSize,
            collisionWidth,
            collisionHeight,
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState: this._animState,
            animKey: `enemy_fat_zombie_${this._animState}`,
        };
        // 死亡动画结束后停在最后一帧（melting 共 21 帧，索引 20）
        if (this._animState === 'death' && this._deathAnimTimer <= 0 && this._corpseTimer > 0) {
            options.frame = 20;
        }
        return options;
    }
}
