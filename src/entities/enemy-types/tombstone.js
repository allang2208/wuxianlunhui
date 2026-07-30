import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { WallSystem } from '../../world/wall-system.js';

/**
 * 墓碑（普通级，僵尸 family）——站桩召唤器（参考矿洞 mine-cave.js）
 * - 不移动、不可推动（speed 0 + noSeparation + 击退免疫 + 出生点锚定）
 * - 常驻状态免疫：不吃任何 buff/debuff（DamageableEntity 统一拦截）
 * - 不进普通刷怪池（enemy-config noPool: true + zombie-dungeon 池过滤排除），
 *   仅在僵尸地牢普通战斗事件中按 33% 概率由 DungeonMapSystem 显式生成
 * - 每 intervalMs 生成 1 只普通僵尸，每 spitterIntervalMs 生成 1 只毒液僵尸
 *   （生成工厂注入，避免实体层反向依赖 world 层；召唤物 _summoned：击杀无经验/金币/掉落）
 */
export class Tombstone extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.tombstone,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 无攻击行为：关闭 CombatSystem 的通用近战触发
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 站桩锁死（矿洞同款）
        this.noSeparation = true;
        // 贴图自带底座：不生成脚下阴影（GameScene._syncEntityShadows 跳过）
        this._noShadow = true;
        // 常驻状态免疫：免疫一切 buff/debuff（DamageableEntity 统一拦截）
        this.applyStatusImmune(Number.MAX_SAFE_INTEGER);
        this._anchorX = x;
        this._anchorY = y;

        // 生成普通僵尸/毒液僵尸（双计时器，配置驱动）
        const spawnCfg = this.config?.attackSkills?.spawn || {};
        this._spawnInterval = spawnCfg.intervalMs ?? 10000;
        this._spitterSpawnInterval = spawnCfg.spitterIntervalMs ?? 30000;
        this._spawnTimer = this._spawnInterval;
        this._spitterSpawnTimer = this._spitterSpawnInterval;
        this._spawnFactory = config.spawnFactory || null;
        this._spitterSpawnFactory = config.spitterSpawnFactory || null;
        this._spawnSeq = 0;
        this._spitterSpawnSeq = 0;
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

        // 定时生成普通僵尸（默认每 10s）
        this._spawnTimer -= dt;
        if (this._spawnTimer <= 0) {
            this._spawnTimer = this._spawnInterval;
            this._spawnSummoned(this._spawnFactory, 'zombie', this._spawnSeq++);
        }
        // 定时生成毒液僵尸（默认每 30s）
        this._spitterSpawnTimer -= dt;
        if (this._spitterSpawnTimer <= 0) {
            this._spitterSpawnTimer = this._spitterSpawnInterval;
            this._spawnSummoned(this._spitterSpawnFactory, 'spitter', this._spitterSpawnSeq++);
        }
    }

    /**
     * 在墓碑四周找一个可行走的落点生成召唤物（8 向 × 递近距离）；
     * 全部失败则放弃本 tick（顺延下个周期），保证召唤物不卡墙、能走出寻敌
     */
    _spawnSummoned(factory, tag, seq) {
        if (typeof factory !== 'function') return;
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game || !game.entities) return;

        // 先在墓碑周围找安全落点，再生成（避免先生成再挪动的抖动）
        const probeRadius = 15; // 普通僵尸 groundRadius 量级
        let sx = 0, sy = 0, found = false;
        outer:
        for (const dist of [90, 130, 170]) {
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const tx = this.x + Math.cos(angle) * dist;
                const ty = this.y + Math.sin(angle) * dist;
                if (WallSystem && typeof WallSystem.canMoveTo === 'function'
                    && !WallSystem.canMoveTo(tx, ty, probeRadius)) continue;
                sx = tx; sy = ty; found = true;
                break outer;
            }
        }
        if (!found) return; // 本 tick 无可行走落点，顺延下个生成周期

        const summoned = factory(sx, sy);
        if (!summoned) return;
        // 落点墙壁解析（防卡墙，与召唤物同口径）
        if (WallSystem && typeof WallSystem.resolve === 'function') {
            const r = WallSystem.resolve(this.x, this.y, summoned.x, summoned.y, summoned.groundRadius || 10);
            summoned.x = r.x;
            summoned.y = r.y;
        }
        // 唯一键（防 Map 覆盖）+ 召唤物标签（击杀无金币/经验/技能计数/掉落物）
        summoned._summoned = true;
        const key = `tombstone_${tag}_${Date.now()}_${seq}_${Math.floor(Math.random() * 1000)}`;
        game.entities.set(key, summoned);
        this._playSpawnFx(summoned.x, summoned.y);
    }

    /** 召唤物生成点黑色粒子（地牢刷怪同款 playDungeonSpawnParticles） */
    _playSpawnFx(x, y) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && typeof scene.playDungeonSpawnParticles === 'function') {
            scene.playDungeonSpawnParticles(x, y);
        }
    }

    _getTextureKey() {
        return 'enemy_tombstone';
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 256;
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 120,
            collisionHeight: renderCfg.collisionHeight || 60,
            textOffsetY: -spriteSize / 2 - 10,
            flipX: false,
            animState: 'idle',
            animKey: '__none__', // 静态贴图，无动画（GameScene 找不到动画键会保持纹理）
        };
    }
}
