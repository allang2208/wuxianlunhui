import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { ProjectileFactory } from '../../utils/projectile-factory.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { Geom } from 'phaser';
import { EffectManager } from '../../effects/effect-manager.js';
import { VenomSprayEffect } from '../../effects/venom-spray-effect.js';

/**
 * 毒蛆（精英，僵尸 family）
 * - 行动迟缓，仅使用「毒液喷射」一种攻击
 * - 3s 播放 spitting 动画，在配置帧窗内持续发射绿色毒球（间隔/扇形/每次个数均配置驱动）
 * - 毒球命中造成魔法攻击 ×0.33 伤害，33% 几率叠加 1 层中毒
 * - 攻击时不可移动
 */
export class PoisonMaggot extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.poisonMaggot,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 关闭 CombatSystem 的通用攻击触发，攻击完全自管
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        this._animState = 'idle';
        this._attackState = 'idle'; // 'idle' | 'spitting'
        this._attackTimer = 0;
        this._spitEmitTimer = 0;
        this._spitCooldown = 0;
        this._spitSprayVisualDone = false;

        this._preserveCorpse = true;
        this._deathStarted = false;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
    }

    _getSkillConfigs() {
        return this.config?.attackSkills || {};
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathAnimation(dt);
            return;
        }

        super.update(dt, entities);

        // 冷却推进
        if (this._spitCooldown > 0) this._spitCooldown -= this.getAttackIntervalDelta(dt);

        // 眩晕时中断攻击
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            this._attackState = 'idle';
            this._attackTimer = 0;
            this._spitEmitTimer = 0;
            this._spitSprayVisualDone = false;
            return;
        }

        // 恐惧时中断喷射决策（移动由 MovementSystem 恐惧分支接管逃跑）
        if (this.hasStatusEffect && this.hasStatusEffect('fear')) {
            return;
        }

        // 朝向目标（喷射毒液期间锁定朝向，不可转向）
        const t = this.target && this.target.active ? this.target : null;
        if (t && this._attackState !== 'spitting') this.rotation = Math.atan2(t.y - this.y, t.x - this.x);

        if (this._attackState === 'spitting') {
            this._attackTimer -= dt;
            this._attackAnimTimer = 100; // MovementSystem 锁定移动
            this._updateSpitting(dt, entities);
            this._animState = 'spitting';
            if (this._attackTimer <= 0) {
                this._attackState = 'idle';
                this._spitEmitTimer = 0;
                this._spitSprayVisualDone = false;
            }
        } else {
            this._attackAnimTimer = 0;
            this._animState = this.isMoving ? 'walk' : 'idle';

            // 进入射程且冷却就绪则开始喷射
            if (t && this._spitCooldown <= 0) {
                const dist = Math.hypot(t.x - this.x, t.y - this.y);
                const cfg = this._getSkillConfigs().spit;
                if (dist <= (cfg.range ?? 600)) {
                    this._startSpit(t);
                }
            }
        }
    }

    _startSpit(target) {
        const cfg = this._getSkillConfigs().spit;
        this._attackState = 'spitting';
        this._attackTimer = cfg.duration ?? 3000;
        this._spitCooldown = cfg.cooldown ?? 8000;
        this._spitEmitTimer = 0;
        this._spitSprayVisualDone = false;
        this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
        // 喷射期间锁定朝向与翻转（不可转向）
        this._spitFlipX = target.x < this.x;
    }

    _updateSpitting(dt, entities) {
        const cfg = this._getSkillConfigs().spit;
        const duration = cfg.duration ?? 3000;
        const frames = cfg.frames ?? 33;
        const startFrame = cfg.startFrame ?? 14;
        const stopFrame = cfg.stopFrame ?? 27;
        const frameTime = duration / Math.max(1, frames);
        const elapsed = duration - this._attackTimer;

        // 只在第 startFrame ~ stopFrame 之间发射
        if (elapsed < startFrame * frameTime || elapsed >= stopFrame * frameTime) return;

        if (!this._spitSprayVisualDone) {
            this._spitSprayVisualDone = true;
            this._emitSpitSprayVisual();
        }

        this._spitEmitTimer -= dt;
        if (this._spitEmitTimer > 0) return;
        this._spitEmitTimer = cfg.intervalMs ?? 150;

        // 每次发射 burstCount 个毒球，各自在面向目标扇形内随机方向
        const halfFan = (cfg.fanAngle ?? Math.PI / 2) / 2;
        const burst = Math.max(1, cfg.burstCount ?? 1);
        for (let i = 0; i < burst; i++) {
            const angle = this.rotation + (Math.random() * halfFan * 2 - halfFan);
            this._firePoisonBall(angle, entities);
        }
    }

    /** 一次性喷雾只负责视觉；实际命中仍由连续毒球与既有 ProjectileFactory 管线结算。 */
    _emitSpitSprayVisual() {
        const cfg = this._getSkillConfigs().spit || {};
        const visual = cfg.sprayVisual || {};
        const head = this._getHeadWorldPosition();
        EffectManager.add(new VenomSprayEffect({
            x: head.x,
            y: head.y,
            angle: this.rotation,
            range: visual.range ?? 360,
            arcDegrees: visual.arcDegrees ?? 36,
            durationMs: visual.durationMs ?? 700,
            particleCount: visual.particleCount ?? 64,
            colors: [0x205913, 0x347d1b, 0x55a829, 0x7bdc3d, 0xa7f45a, 0x3d8f22],
            hazeColor: 0x3f8f22,
            coreColor: 0xc8ff83,
        }));
    }

    _firePoisonBall(angle, entities) {
        const cfg = this._getSkillConfigs().spit;
        const matk = this.data?.matk || 0;
        const damage = Math.max(1, Math.round(matk * (cfg.damageMul ?? 0.33)));
        const head = this._getHeadWorldPosition();

        // 喷射音效（配置 sounds.spit，与毒液僵尸攻击同款：每发射一个投射物播放一次）
        const spitSound = this.config?.sounds?.spit;
        if (spitSound && SoundManager && typeof SoundManager.play === 'function') {
            SoundManager.play(spitSound);
        }

        const startZ = (Number(this.z) || 0) + (this.collider?.height || this.bodyHeight || 60) * 0.58;
        const p = ProjectileFactory.create({
            x: head.x,
            y: head.y,
            angle,
            z: startZ,
            groundY: head.y + startZ,
            speed: cfg.projectileSpeed ?? 320,
            maxRange: cfg.projectileRange ?? 600,
            size: cfg.projectileSize ?? 10,
            damage: { min: damage, max: damage },
            piercing: 0,
            source: this,
            entities,
            textureKey: 'projectile_poison_maggot',
            damageType: cfg.damageType || 'magic',
            poisonChance: cfg.poisonChance ?? 0.33,
            poisonStacks: cfg.poisonStacks ?? 1,
            depthBonus: cfg.depthBonus ?? 0,
            knockback: 0
        });

        this._attachPoisonTrail(p);
    }

    /** 喷雾/毒球共用正式喷毒帧的逐帧口器锚点，并按最终显示态与 flipX 换算。 */
    _getHeadWorldPosition() {
        const cfg = this._getSkillConfigs().spit || {};
        const frameIndex = this._getCurrentSpitFrameIndex(cfg);
        const anchor = cfg.muzzleAnchors?.frames?.[frameIndex];
        if (Array.isArray(anchor) && anchor.length >= 2) {
            const layout = this._getFrameLayout('spitting');
            const frameWidth = layout.frameWidth ?? 640;
            const frameHeight = layout.frameHeight ?? 512;
            const sprite = this._phaserSprite?.active ? this._phaserSprite : null;
            const referenceCell = this.config?.textures?.referenceCell ?? 512;
            const baseSpriteSize = this.config?.render?.spriteSize || 100;
            const pixelScale = baseSpriteSize / referenceCell;
            const displayWidth = sprite?.displayWidth || frameWidth * pixelScale;
            const displayHeight = sprite?.displayHeight || frameHeight * pixelScale;
            const originX = sprite?.originX ?? 0.5;
            const originY = sprite?.originY ?? 0.5;
            const flipX = this._attackState === 'spitting'
                ? !!this._spitFlipX
                : !!sprite?.flipX;
            const localX = (anchor[0] - frameWidth * originX)
                * (displayWidth / frameWidth) * (flipX ? -1 : 1);
            const localY = (anchor[1] - frameHeight * originY)
                * (displayHeight / frameHeight);
            const centerX = sprite?.x ?? this.x;
            const configuredFoot = this.footOffsetY ?? this.config?.render?.footOffsetY;
            const centerY = sprite?.y
                ?? (this.y - (typeof configuredFoot === 'number' ? configuredFoot : displayHeight * 0.5));
            return { x: centerX + localX, y: centerY + localY };
        }

        // 兼容未提供逐帧口器锚点的外部覆盖配置。
        const opts = this._getPhaserOptions();
        const dirX = opts.flipX ? -1 : 1;
        const forward = cfg.muzzleForward ?? (this.config?.render?.spriteSize || 100) / 2;
        const upY = cfg.muzzleUpY ?? 8;
        let mx = this.x + dirX * forward;
        let my = this.y - upY;
        // 面朝右时的额外微调（配置驱动，左移/上移用负值）
        if (!opts.flipX) {
            mx += cfg.muzzleRightDx ?? 0;
            my += cfg.muzzleRightDy ?? 0;
        }
        return { x: mx, y: my };
    }

    _getCurrentSpitFrameIndex(cfg = this._getSkillConfigs().spit || {}) {
        const duration = Math.max(1, cfg.duration ?? 3000);
        const frames = Math.max(1, cfg.frames ?? 33);
        const elapsed = Math.max(0, duration - Math.max(0, this._attackTimer));
        return Math.min(frames - 1, Math.floor(elapsed / duration * frames));
    }

    /** 给毒球附加绿色彗尾粒子 + 环绕粒子（环绕参数配置驱动 spit.orbit） */
    _attachPoisonTrail(projectile) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !projectile || !projectile._phaserSprite) return;

        const trail = scene.add.particles(0, 0, 'projectile_poison_maggot', {
            scale: { start: 0.32, end: 0.06 },
            alpha: { start: 0.55, end: 0 },
            speed: 0,
            lifespan: 320,
            tint: 0x7aff7a,
            quantity: 1,
            frequency: 55,
            follow: projectile._phaserSprite
        });
        trail.addToUpdateList();
        trail.setDepth((projectile._phaserSprite.depth || 0) + 1);

        // 环绕粒子：投射物圆周上持续生成短生命周期绿点
        const orbit = this._getSkillConfigs().spit?.orbit || {};
        const ring = scene.add.particles(0, 0, 'projectile_poison_maggot', {
            scale: { start: orbit.scaleStart ?? 0.3, end: orbit.scaleEnd ?? 0.05 },
            alpha: { start: 0.7, end: 0 },
            speed: 0,
            lifespan: orbit.lifespan ?? 280,
            tint: typeof orbit.tint === 'string' ? parseInt(orbit.tint, 16) : (orbit.tint ?? 0x7aff7a),
            quantity: 1,
            frequency: orbit.frequency ?? 60,
            emitZone: {
                type: 'edge',
                source: new Geom.Circle(0, 0, orbit.radius ?? 18),
                quantity: 32,
                yoyo: false
            },
            follow: projectile._phaserSprite
        });
        ring.addToUpdateList();
        ring.setDepth((projectile._phaserSprite.depth || 0) + 1);

        // 投射物销毁时同步清理拖尾与环绕粒子
        projectile._onBeforeDestroy = () => {
            for (const fx of [trail, ring]) {
                if (fx && fx.active) {
                    fx.stop();
                    fx.destroy();
                }
            }
        };
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'death':    return 'enemy_poison_maggot_death';
            case 'spitting': return 'enemy_poison_maggot_spitting';
            case 'walk':     return 'enemy_poison_maggot_walk';
            default:         return 'enemy_poison_maggot_idle';
        }
    }

    _getFrameLayout(state = this._animState) {
        const layouts = this.config?.textures?.frameLayouts || {};
        return layouts[state] || layouts.idle || {
            frameWidth: 512,
            frameHeight: 512,
            frameCount: 1,
            footY: 357,
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
        this._attackState = 'idle';
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._spitEmitTimer = 0;
        this._spitSprayVisualDone = false;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.target = null;
        this._tacticalTarget = null;
        this._animState = 'death';
        const death = this._getDeathConfig();
        const duration = death.duration ?? 1800;
        const holdMs = death.holdMs ?? 1000;
        this._deathAnimTimer = duration;
        this._corpseTimer = 0;
        this._deathRemoveDelay = duration + holdMs + 500;
        super.onDeath(source);
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        const layout = this._getFrameLayout();
        const referenceCell = this.config?.textures?.referenceCell ?? 512;
        const frameWidth = layout.frameWidth ?? referenceCell;
        const frameHeight = layout.frameHeight ?? referenceCell;
        const baseSpriteSize = renderCfg.spriteSize || 100;
        const spriteSize = Math.max(frameWidth, frameHeight) * baseSpriteSize / referenceCell;
        const phaserAnimState = this._animState === 'spitting' ? 'attack' : this._animState;
        let flipX = false;
        // 喷射期间锁定翻转（不可转向，与 _spitFlipX 一致）
        if (this._attackState === 'spitting') {
            flipX = !!this._spitFlipX;
        } else if (this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 40,
            collisionHeight: renderCfg.collisionHeight || 60,
            textOffsetY: -baseSpriteSize / 2 - 10,
            flipX,
            // Phaser 将 attack/death 视为一次性动画，避免 3 秒喷毒结束瞬间重播首帧。
            animState: phaserAnimState,
            animKey: `enemy_poison_maggot_${this._animState}_v2`,
            dynamicSpriteSize: true,
        };
    }
}
