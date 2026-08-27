import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { applyBuildingFootprint } from '../../world/building-footprint.js';
import { setupStructureDepth } from '../../world/structure-depth.js';
import { summonMonster } from './_shared/summon-helper.js';

/**
 * 矿洞（次级，其他 family）——站桩生成器（参考集合体站桩锁死）
 * - 不移动、不可推动（speed 0 + noSeparation + 击退免疫 + 出生点锚定）
 * - 每 intervalMs 在前方 forwardX px 生成一只矿工僵尸（spawnFactory 注入，避免实体层反向依赖）
 * - 洞口绿烟粒子（ADD 混合，白色烟雾纹理 + 绿色 tint，正交无透视）
 */
export class MineCave extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.mineCave,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 无攻击行为：关闭 CombatSystem 的通用近战触发
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 站桩锁死（集合体同款）
        this.noSeparation = true;
        this.immovable = true;
        // 贴图自带底座：不生成脚下阴影（GameScene._syncEntityShadows 跳过）
        this._noShadow = true;
        // 保留 Enemy 的可受伤/刷怪生命周期，只把最终物理体与遮挡切到统一建筑协议。
        // 旧 collisionRadius + render.collisionWidth/Height/colliderOffset 机制已从配置删除。
        const renderCfg = this.config?.render || {};
        this.spriteCfg = {
            idleKey: 'enemy_mine_cave',
            size: renderCfg.spriteSize || 128,
            sizeH: renderCfg.spriteHeight || 102,
            footOffsetY: renderCfg.footOffsetY ?? 52,
            visualFootprint: renderCfg.visualFootprint
                ? { ...renderCfg.visualFootprint }
                : null,
            autoFootprint: false,
        };
        this.footOffsetY = this.spriteCfg.footOffsetY;
        applyBuildingFootprint(this, 1);
        setupStructureDepth(this);
        this.rebuildCollider();
        // 常驻状态免疫：免疫一切 buff/debuff（DamageableEntity 统一拦截）
        this.applyStatusImmune(Number.MAX_SAFE_INTEGER);
        this._anchorX = x;
        this._anchorY = y;

        // 生成矿工/提灯（双计时器）
        const spawnCfg = this.config?.attackSkills?.spawn || {};
        this._spawnInterval = spawnCfg.intervalMs ?? 10000;
        this._lanternSpawnInterval = spawnCfg.lanternIntervalMs ?? 45000;
        this._spawnForwardX = spawnCfg.forwardX ?? 50;
        // 召唤方向（1=右 / -1=左，由生成工厂按墙面朝向镜像注入，防召唤物卡墙角）
        this._spawnDirX = config.spawnDirX ?? 1;
        this._spawnTimer = this._spawnInterval;
        this._lanternSpawnTimer = this._lanternSpawnInterval;
        this._spawnFactory = config.spawnFactory || null;
        this._lanternSpawnFactory = config.lanternSpawnFactory || null;

        // 绿烟粒子（首次 update 惰性创建）
        this._smokeEmitter = null;
    }

    // 击退免疫（站桩）
    applyKnockback() {}

    update(dt, entities) {
        if (!this.active) {
            super.update(dt, entities);
            return;
        }
        super.update(dt, entities);

        // 站桩：位置钉死 + 速度归零
        this.x = this._anchorX;
        this.y = this._anchorY;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        // 受控（眩晕/冻结/恐惧）时中断生成（站桩怪移动由 MovementSystem 兜底）
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen') || this.hasStatusEffect('fear'))) {
            return;
        }

        // 洞口绿烟
        this._ensureSmoke();
        if (this._smokeEmitter?.active) {
            const caveDepth = Number.isFinite(this._structureRenderDepth)
                ? this._structureRenderDepth
                : (Number.isFinite(this._faceDepth) ? this._faceDepth : this.y + 11);
            this._smokeEmitter.setDepth(caveDepth + 0.01);
        }

        // 定时生成矿工（每 10s）
        this._spawnTimer -= dt;
        if (this._spawnTimer <= 0) {
            this._spawnTimer = this._spawnMiner() ? this._spawnInterval : 500;
        }
        // 定时生成提灯（每 45s）
        this._lanternSpawnTimer -= dt;
        if (this._lanternSpawnTimer <= 0) {
            this._lanternSpawnTimer = this._spawnLanternMiner() ? this._lanternSpawnInterval : 500;
        }
    }

    _spawnMiner() {
        if (typeof this._spawnFactory !== 'function') return true;
        return summonMonster(this, {
            factory: this._spawnFactory,
            count: 1,
            mode: 'forward',
            radius: enemyConfigData.minerZombie?.collisionRadius ?? 36.3,
            forwardX: this._spawnForwardX,
            forwardDirX: this._spawnDirX,
            tag: 'mineCave_miner',
            playFx: true,
        }).length > 0;
    }

    _spawnLanternMiner() {
        if (typeof this._lanternSpawnFactory !== 'function') return true;
        return summonMonster(this, {
            factory: this._lanternSpawnFactory,
            count: 1,
            mode: 'forward',
            radius: enemyConfigData.lanternMinerZombie?.collisionRadius ?? 38.75,
            forwardX: this._spawnForwardX,
            forwardDirX: this._spawnDirX,
            tag: 'mineCave_lantern',
            playFx: true,
        }).length > 0;
    }

    /** 召唤物生成点黑色粒子（地牢刷怪同款 playDungeonSpawnParticles） */
    _playSpawnFx(x, y) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && typeof scene.playDungeonSpawnParticles === 'function') {
            scene.playDungeonSpawnParticles(x, y);
        }
    }

    /** 洞口绿烟粒子（smoke 配置驱动；ADD 混合；深度高于矿洞贴图、低于前景实体） */
    _ensureSmoke() {
        if (this._smokeEmitter) return;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.textures.exists('smoke_particle')) return;
        const cfg = this.config?.smoke || {};
        const tint = typeof cfg.tint === 'string' ? parseInt(cfg.tint, 16) : (cfg.tint ?? 0x62cc62);
        const mx = this.x + (cfg.offsetX ?? 50) * this._spawnDirX;
        const my = this.y - (cfg.offsetY ?? 45);
        const em = scene.add.particles(0, 0, 'smoke_particle', {
            x: mx,
            y: my,
            frequency: cfg.frequency ?? 120,
            speedX: { min: -15, max: 15 },
            speedY: { min: -40, max: -80 },
            scale: { start: cfg.scaleStart ?? 0.3, end: cfg.scaleEnd ?? 1.2 },
            alpha: { start: cfg.alpha ?? 0.6, end: 0 },
            tint,
            lifespan: cfg.lifespan ?? 4000,
            blendMode: 'ADD',
        });
        // 绿烟跟随标准建筑主体 depth；不再假设旧单位脚底 y+10。
        const caveDepth = Number.isFinite(this._structureRenderDepth)
            ? this._structureRenderDepth
            : (Number.isFinite(this._faceDepth) ? this._faceDepth : this.y + 11);
        em.setDepth(caveDepth + 0.01);
        em.addToUpdateList();
        this._smokeEmitter = em;
    }

    /** 统一特效清理（game.js removeEntity / onDeath 约定入口） */
    _destroyCustomEffects() {
        if (this._smokeEmitter) {
            if (this._smokeEmitter.active) {
                this._smokeEmitter.stop();
                this._smokeEmitter.destroy();
            }
            this._smokeEmitter = null;
        }
    }

    _getTextureKey() {
        return 'enemy_mine_cave';
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 128;
        return {
            spriteSize,
            textOffsetY: -spriteSize / 2 - 10,
            flipX: this._spawnDirX < 0, // 召唤方向朝左时镜像贴图（洞口朝向与出怪一致）
            animState: 'idle',
            animKey: '__none__', // 静态贴图，无动画（GameScene 找不到动画键会保持纹理）
        };
    }
}
