import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { hostilesOf } from './_shared/enemy-utils.js';
import { throwVenomBottle, updateVenomZones, destroyVenomZones } from './_shared/venom-bottle.js';

/**
 * 煮锅（其他 family）——巫婆伴生站桩（参考墓碑 tombstone / 矿洞 mine-cave 静态站桩实现）
 * - 不移动、不可推动（speed 0 + noSeparation + 击退免疫 + 出生点锚定）
 * - 常驻状态免疫：不吃任何 buff/debuff（DamageableEntity 统一拦截）
 * - 不进任何刷怪池（enemy-config noPool: true + family 非僵尸），仅由巫婆生成时伴生
 * - 每 intervalMs 向玩家方向投掷 2 个巫婆毒液瓶（完全复用巫婆攻击 2 机制，
 *   _shared/venom-bottle.js 单一实现；伤害按煮锅自身 matk×damageMul，与巫婆同口径）
 */
export class Cauldron extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.cauldron,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 无攻击行为：关闭 CombatSystem 的通用近战触发
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 站桩锁死（墓碑/矿洞同款）
        this.noSeparation = true;
        // 贴图自带底座：不生成脚下阴影（GameScene._syncEntityShadows 跳过）
        this._noShadow = true;
        // 常驻状态免疫：免疫一切 buff/debuff（DamageableEntity 统一拦截）
        this.applyStatusImmune(Number.MAX_SAFE_INTEGER);
        this._anchorX = x;
        this._anchorY = y;

        // 定时投掷毒液瓶（配置驱动）
        const bottleCfg = this.config?.attackSkills?.bottle || {};
        this._bottleInterval = bottleCfg.intervalMs ?? 30000;
        this._bottleTimer = this._bottleInterval;

        // 毒液区（_shared/venom-bottle.js 管理）
        this._venomZones = [];

        // 锅口绿烟粒子（惰性创建，见 _ensureSmoke）
        this._smokeEmitter = null;
    }

    // 击退免疫（站桩）
    applyKnockback() {}

    _getBottleConfig() {
        return this.config?.attackSkills?.bottle || {};
    }

    update(dt, entities) {
        if (!this.active) {
            super.update(dt, entities);
            return;
        }
        super.update(dt, entities);

        // 锅口绿烟（矿洞同款机制，惰性创建）
        this._ensureSmoke();

        // 站桩：位置钉死 + 速度归零
        this.x = this._anchorX;
        this.y = this._anchorY;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        // 定时投掷 2 个毒液瓶（默认每 30s；玩家在射程内才出手）
        this._bottleTimer -= dt;
        if (this._bottleTimer <= 0) {
            this._bottleTimer = this._bottleInterval;
            this._throwBottles(entities);
        }

        // 毒液区 tick 与清理
        updateVenomZones(this, dt, entities);
    }

    /**
     * 向最近敌对目标（玩家）方向投掷 bottleCount 个毒液瓶：
     * 第 1 个打预判落点（固定飞行时间线性外推，巫婆同口径），
     * 其余在目标点 scatterRadius 内随机散落；射程内无目标则本轮不出手
     */
    _throwBottles(entities) {
        const cfg = this._getBottleConfig();
        const range = cfg.range ?? 800;
        // 射程内最近敌对目标
        let target = null, bestD = Infinity;
        for (const e of hostilesOf(this, entities)) {
            const d = Math.hypot(e.x - this.x, e.y - this.y);
            if (d < bestD) { bestD = d; target = e; }
        }
        if (!target || bestD > range) return;

        const flyS = (cfg.flyDuration ?? 1500) / 1000;
        const count = Math.max(1, cfg.bottleCount ?? 2);
        const scatter = cfg.scatterRadius ?? 150;
        for (let i = 0; i < count; i++) {
            // 预判落点：抛物线固定飞行时间线性外推
            let tx = target.x + (target.vx || 0) * flyS;
            let ty = target.y + (target.vy || 0) * flyS;
            if (i > 0) {
                // 后续瓶在目标点附近随机散落
                const a = Math.random() * Math.PI * 2;
                const r = Math.sqrt(Math.random()) * scatter;
                tx += Math.cos(a) * r;
                ty += Math.sin(a) * r;
            }
            throwVenomBottle(this, cfg, tx, ty);
        }
    }

    /** 锅口绿烟粒子（矿洞 _ensureSmoke 同款，smoke 配置驱动；ADD 混合亮绿） */
    _ensureSmoke() {
        if (this._smokeEmitter) return;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.textures.exists('smoke_particle')) return;
        const cfg = this.config?.smoke || {};
        const tint = typeof cfg.tint === 'string' ? parseInt(cfg.tint, 16) : (cfg.tint ?? 0x62cc62);
        const em = scene.add.particles(0, 0, 'smoke_particle', {
            x: this.x + (cfg.offsetX ?? 0),
            y: this.y - (cfg.offsetY ?? 70),
            frequency: cfg.frequency ?? 200,
            speedX: { min: -10, max: 10 },
            speedY: { min: -20, max: -50 },
            scale: { start: cfg.scaleStart ?? 0.3, end: cfg.scaleEnd ?? 1.0 },
            alpha: { start: cfg.alpha ?? 0.5, end: 0 },
            tint,
            lifespan: cfg.lifespan ?? 3000,
            blendMode: 'ADD',
        });
        // 高于煮锅贴图（实体 depth = 脚底 Y+10），低于前景实体
        em.setDepth(this.y + 11);
        em.addToUpdateList();
        this._smokeEmitter = em;
    }

    /** 统一特效清理（game.js removeEntity / onDeath 约定入口） */
    _destroyCustomEffects() {
        destroyVenomZones(this);
        if (this._smokeEmitter) {
            if (this._smokeEmitter.active) {
                this._smokeEmitter.stop();
                this._smokeEmitter.destroy();
            }
            this._smokeEmitter = null;
        }
    }

    _getTextureKey() {
        return 'enemy_cauldron';
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 220;
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 150,
            collisionHeight: renderCfg.collisionHeight || 90,
            textOffsetY: -spriteSize / 2 - 10,
            flipX: false,
            animState: 'idle',
            animKey: '__none__', // 静态贴图，无动画（GameScene 找不到动画键会保持纹理）
        };
    }
}
