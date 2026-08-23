import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { ProjectileFactory } from '../../utils/projectile-factory.js';
import { AimHelper } from '../../utils/aim-helper.js';
import { COMBAT_CONFIG } from '../../config/combat-config.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { getTorsoRect } from '../../physics/torso-hitbox.js';

/**
 * 毒液僵尸（SpitterZombie）
 * - 远程毒液喷射
 * - 使用 assets/enemies/spitter_zombie/v2/ 下的四动作精灵图
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
        this._syncRenderFootAnchor('idle');
        this._attackTimer = 0;
        this._attackAnimTimer = 0; // MovementSystem 用，攻击期间冻结移动
        const attackLayout = this._getFrameLayout('attack');
        this._attackDuration = attackLayout.duration ?? 1000;

        // 新攻击母版在第 9 格出现毒液喷射（0 基索引 8）。
        this._spitFireFrame = attackLayout.spitFireFrame ?? 8;
        this._spitTotalFrames = attackLayout.frameCount ?? 24;
        this._pendingSpit = null;

        // 死亡动画与短暂保尸；Game/GameScene 已识别同名计时字段。
        this._preserveCorpse = true;
        this._deathStarted = false;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;

        // 头部发射点兜底偏移（主路径 = 躯干矩形顶边前方，见 _getHeadWorldPosition）
        this._headOffset = { x: 24, y: -8 };

        this._setupRangedAttackWrapper();
    }

    /**
     * 重写远程攻击执行：不立即发射，而是延迟到攻击动画配置的出手帧从头部射出
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
        if (!this.active) {
            this._updateDeathAnimation(dt);
            return;
        }
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
        // 脚线必须在 GameScene 同步 Sprite 位置之前更新；旧逻辑只在随后读取
        // _getPhaserOptions 时更新，宽格攻击/死亡切换首帧会沿用上一动作的脚线。
        this._syncRenderFootAnchor(this._animState);

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
        this._syncRenderFootAnchor('attack');
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
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

    /** 四动作共用同一逻辑落地点；不同帧格只换算 Sprite 中心到脚线的距离。 */
    _syncRenderFootAnchor(state = this._animState) {
        const layout = this._getFrameLayout(state);
        const referenceCell = this.config?.textures?.referenceCell ?? 512;
        const frameHeight = layout.frameHeight ?? referenceCell;
        const baseSpriteSize = this.config?.render?.spriteSize || 90;
        const pixelScale = baseSpriteSize / referenceCell;
        const footY = layout.footY ?? frameHeight;
        this.footOffsetY = (footY - frameHeight / 2) * pixelScale;
        return this.footOffsetY;
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
        this._pendingSpit = null;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.target = null;
        this._tacticalTarget = null;
        this._animState = 'death';
        this._animStateTimer = 0;
        this._syncRenderFootAnchor('death');
        const death = this._getDeathConfig();
        const duration = death.duration ?? 2000;
        const holdMs = death.holdMs ?? 1000;
        this._deathAnimTimer = duration;
        this._corpseTimer = 0;
        this._deathRemoveDelay = duration + holdMs + 500;
        super.onDeath(source);
    }

    /**
     * 头部世界坐标：优先使用攻击母版中检测到的紫色毒液基点，按当前显示比例和
     * flipX 映射到世界坐标；贴图尚未创建时才回退躯干矩形前缘。
     */
    _getHeadWorldPosition() {
        const sprite = this._phaserSprite;
        const attackLayout = this._getFrameLayout('attack');
        const origin = attackLayout.spitOrigin;
        if (sprite?.active && origin && sprite.texture?.key === 'enemy_spitter_zombie_attack') {
            const frameWidth = attackLayout.frameWidth || sprite.frame?.width || 1;
            const frameHeight = attackLayout.frameHeight || sprite.frame?.height || 1;
            const scaleX = sprite.displayWidth / Math.max(1, frameWidth);
            const scaleY = sprite.displayHeight / Math.max(1, frameHeight);
            const localX = (origin.x - frameWidth * (sprite.originX ?? 0.5)) * scaleX;
            const localY = (origin.y - frameHeight * (sprite.originY ?? 0.5)) * scaleY;
            return {
                x: sprite.x + (sprite.flipX ? -localX : localX),
                y: sprite.y + localY,
            };
        }

        const options = this._getPhaserOptions();
        const dirX = options.flipX ? -1 : 1;
        const t = (typeof getTorsoRect === 'function') ? getTorsoRect(this) : null;
        if (t) {
            // 绿色矩形上 25% 位置（顶边往下 1/4 高处）的前缘
            return {
                x: t.cx + dirX * (t.halfW + 6),
                y: t.cy - t.halfH * 0.5
            };
        }
        // 兜底：旧固定偏移（无躯干判定配置时）
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
        const startZ = (Number(this.z) || 0) + (this.collider?.height || this.bodyHeight || 80) * 0.58;
        const groundY = head.y + startZ;
        const targetZ = this.target?.collider?.centerZ ?? ((Number(this.target?.z) || 0) + 24);
        let aimX = pending.targetX;
        let aimY = pending.targetY;
        if (this.target && this.target.active && this.target.vx !== undefined) {
            const lead = AimHelper.lead(
                head.x, groundY,
                this.target.x, this.target.y,
                this.target.vx || 0, this.target.vy || 0,
                projectileSpeed
            );
            aimX = lead.x;
            aimY = lead.y;
        }
        const groundAngle = Math.atan2(aimY - groundY, aimX - head.x);
        const angle = Math.atan2((aimY - targetZ) - head.y, aimX - head.x);

        SoundManager.play('bow_fire');
        ProjectileFactory.create({
            x: head.x,
            y: head.y,
            angle,
            z: startZ,
            targetZ,
            groundY,
            groundAngle,
            aimDistance: Math.max(1, Math.hypot(aimX - head.x, aimY - groundY)),
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
            case 'death': return 'enemy_spitter_zombie_death';
            case 'attack': return 'enemy_spitter_zombie_attack';
            case 'walk': return 'enemy_spitter_zombie_walk';
            default: return 'enemy_spitter_zombie_idle';
        }
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        const layout = this._getFrameLayout();
        const referenceCell = this.config?.textures?.referenceCell ?? 512;
        const frameWidth = layout.frameWidth ?? referenceCell;
        const frameHeight = layout.frameHeight ?? referenceCell;
        const baseSpriteSize = renderCfg.spriteSize || 90;
        // 宽格攻击和 640 格死亡继续使用与 512 格待机/移动相同的源像素比例；
        // spriteSize 传最长边给 GameScene，脚线则直接按源像素比例换算，兼容非正方形帧。
        const pixelScale = baseSpriteSize / referenceCell;
        const spriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
        this._syncRenderFootAnchor(this._animState);
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
            textOffsetY: -baseSpriteSize / 2 - 10,
            flipX,
            animState: this._animState,
            // v2 母版逐帧已统一锚点，不复用旧动画键对应的 sprite-offsets。
            animKey: `enemy_spitter_zombie_${this._animState}_v2`,
        };
    }
}
