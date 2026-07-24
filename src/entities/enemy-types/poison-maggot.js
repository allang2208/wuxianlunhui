import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { ProjectileFactory } from '../../utils/projectile-factory.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { Geom } from 'phaser';

/**
 * 毒蛆（精英，僵尸 family）
 * - 行动迟缓，仅使用「毒液喷射」一种攻击
 * - 3s 播放 spitting 16 帧，第 6~14 帧在面向目标扇形内持续发射绿色毒球（间隔/扇形/每次个数均配置驱动）
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
    }

    _getSkillConfigs() {
        return this.config?.attackSkills || {};
    }

    update(dt, entities) {
        if (!this.active) {
            super.update(dt, entities);
            return;
        }

        super.update(dt, entities);

        // 冷却推进
        if (this._spitCooldown > 0) this._spitCooldown -= dt;

        // 眩晕时中断攻击
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            this._attackState = 'idle';
            this._attackTimer = 0;
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
        this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
        // 喷射期间锁定朝向与翻转（不可转向）
        this._spitFlipX = target.x < this.x;
    }

    _updateSpitting(dt, entities) {
        const cfg = this._getSkillConfigs().spit;
        const duration = cfg.duration ?? 3000;
        const frames = cfg.frames ?? 16;
        const startFrame = cfg.startFrame ?? 6;
        const stopFrame = cfg.stopFrame ?? 14;
        const frameTime = duration / Math.max(1, frames);
        const elapsed = duration - this._attackTimer;

        // 只在第 startFrame ~ stopFrame 之间发射
        if (elapsed < startFrame * frameTime || elapsed >= stopFrame * frameTime) return;

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

        const p = ProjectileFactory.create({
            x: head.x,
            y: head.y,
            angle,
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

    /** 毒球发射口：贴图最前端（朝向方向上的贴图边缘，如朝右=贴图最右边），数值配置驱动 */
    _getHeadWorldPosition() {
        const opts = this._getPhaserOptions();
        const dirX = opts.flipX ? -1 : 1;
        const cfg = this._getSkillConfigs().spit || {};
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
            case 'spitting': return 'enemy_poison_maggot_spitting';
            case 'walk':     return 'enemy_poison_maggot_walk';
            default:         return 'enemy_poison_maggot_idle';
        }
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 100;
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
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState: this._animState,
            animKey: this._getTextureKey(),
        };
    }
}
