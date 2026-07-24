import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { WallSystem } from '../../world/wall-system.js';

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
        this._anchorX = x;
        this._anchorY = y;

        // 生成矿工/提灯（双计时器）
        const spawnCfg = this.config?.attackSkills?.spawn || {};
        this._spawnInterval = spawnCfg.intervalMs ?? 10000;
        this._lanternSpawnInterval = spawnCfg.lanternIntervalMs ?? 45000;
        this._spawnForwardX = spawnCfg.forwardX ?? 50;
        this._spawnTimer = this._spawnInterval;
        this._lanternSpawnTimer = this._lanternSpawnInterval;
        this._spawnFactory = config.spawnFactory || null;
        this._lanternSpawnFactory = config.lanternSpawnFactory || null;
        this._spawnSeq = 0;
        this._lanternSpawnSeq = 0;

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

        // 洞口绿烟
        this._ensureSmoke();

        // 定时生成矿工（每 10s）
        this._spawnTimer -= dt;
        if (this._spawnTimer <= 0) {
            this._spawnTimer = this._spawnInterval;
            this._spawnMiner();
        }
        // 定时生成提灯（每 45s）
        this._lanternSpawnTimer -= dt;
        if (this._lanternSpawnTimer <= 0) {
            this._lanternSpawnTimer = this._lanternSpawnInterval;
            this._spawnLanternMiner();
        }
    }

    _spawnMiner() {
        if (typeof this._spawnFactory !== 'function') return;
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game || !game.entities) return;
        const miner = this._spawnFactory(this.x + this._spawnForwardX, this.y);
        if (!miner) return;
        // 落点墙壁解析（防卡墙，与召唤物同口径）
        if (WallSystem && typeof WallSystem.resolve === 'function') {
            const r = WallSystem.resolve(this.x, this.y, miner.x, miner.y, miner.groundRadius || 10);
            miner.x = r.x;
            miner.y = r.y;
        }
        // 唯一键（防 Map 覆盖）+ 召唤物标签（击杀无金币/经验/技能计数/掉落物）
        miner._summoned = true;
        const key = `mineCave_miner_${Date.now()}_${this._spawnSeq++}_${Math.floor(Math.random() * 1000)}`;
        game.entities.set(key, miner);
    }

    _spawnLanternMiner() {
        if (typeof this._lanternSpawnFactory !== 'function') return;
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game || !game.entities) return;
        const lantern = this._lanternSpawnFactory(this.x + this._spawnForwardX, this.y);
        if (!lantern) return;
        // 落点墙壁解析（防卡墙，与召唤物同口径）
        if (WallSystem && typeof WallSystem.resolve === 'function') {
            const r = WallSystem.resolve(this.x, this.y, lantern.x, lantern.y, lantern.groundRadius || 10);
            lantern.x = r.x;
            lantern.y = r.y;
        }
        // 唯一键（防 Map 覆盖）+ 召唤物标签（击杀无金币/经验/技能计数/掉落物）
        lantern._summoned = true;
        const key = `mineCave_lantern_${Date.now()}_${this._lanternSpawnSeq++}_${Math.floor(Math.random() * 1000)}`;
        game.entities.set(key, lantern);
    }

    /** 洞口绿烟粒子（smoke 配置驱动；ADD 混合；深度高于矿洞贴图、低于前景实体） */
    _ensureSmoke() {
        if (this._smokeEmitter) return;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.textures.exists('smoke_particle')) return;
        const cfg = this.config?.smoke || {};
        const tint = typeof cfg.tint === 'string' ? parseInt(cfg.tint, 16) : (cfg.tint ?? 0x62cc62);
        const mx = this.x + (cfg.offsetX ?? 50);
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
        // 高于矿洞贴图（实体 depth = 脚底 Y+10），低于前景实体
        em.setDepth(this.y + 11);
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
        const spriteSize = renderCfg.spriteSize || 400;
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 200,
            collisionHeight: renderCfg.collisionHeight || 100,
            textOffsetY: -spriteSize / 2 - 10,
            flipX: false,
            animState: 'idle',
            animKey: '__none__', // 静态贴图，无动画（GameScene 找不到动画键会保持纹理）
        };
    }
}
