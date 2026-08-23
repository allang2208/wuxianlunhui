import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { playSoundFrom } from './_shared/enemy-utils.js';
import {
    canImpactBasicMelee,
    canStartBasicMelee,
    createBasicMeleeSnapshot,
} from '../../combat/melee-attack-resolver.js';

/**
 * 矿工僵尸（普通，僵尸 family）
 * - 近战砸击：方向性单目标判定 160px，1.5s 播放 24 帧（第 17 帧伤害判定），命中击退 75px
 * - 冷却 4s（attack.cooldown），攻击时不可移动
 * - 死亡播放 dying 13 帧一次性动画后销毁
 * 所有数值均来自 enemy-config.json 的 minerZombie 配置，类内不硬编码
 */
export class MinerZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.minerZombie,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 继续借用通用 Attack 的冷却/预警/起手调度，但真正伤害只由第17帧砸击结算。
        // ThrustAttack 只负责创建锁定主目标和方向的快照，triggerWeaponAnim 会关闭其通用命中。
        this._usesDirectedBasicMelee = true;

        // 动画状态：idle | walk | attack | death
        this._animState = 'idle';
        this._animStateTimer = 0;

        // 攻击动画控制
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._slamHitDone = false;
        this._slamSoundDone = false;
        this._slamTarget = null;
        this._slamSnapshot = null;

        // 移动音效计时
        this._walkSoundTimer = 0;

        // 死亡三段式：动画 → 定格保留 → 淡出销毁
        this._preserveCorpse = true; // 让 Game 循环在死亡期间继续调用 update
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
    }

    _getSlamConfig() {
        return this.config?.attackSkills?.slam || {};
    }

    _getDeathConfig() {
        return this.config?.death || {};
    }

    update(dt, entities) {
        if (!this.active) {
            // 死亡三段式：①动画播放 → ②定格保留 holdMs → ③淡出 fadeMs 后销毁
            if (this._deathAnimTimer > 0) {
                this._deathAnimTimer -= dt;
                if (this._deathAnimTimer <= 0) {
                    this._deathAnimTimer = 0;
                    this._corpseTimer = this._getDeathConfig().holdMs ?? 1000;
                }
            } else if (this._corpseTimer > 0) {
                this._corpseTimer -= dt;
                if (this._corpseTimer <= 0) {
                    this._corpseTimer = 0;
                    this._fadeTimer = this._getDeathConfig().fadeMs ?? 300;
                }
            } else if (this._fadeTimer > 0) {
                this._fadeTimer -= dt;
                const fadeMs = this._getDeathConfig().fadeMs ?? 300;
                if (this._phaserSprite && this._phaserSprite.active) {
                    this._phaserSprite.setAlpha(Math.max(0, this._fadeTimer / fadeMs));
                }
                if (this._fadeTimer <= 0) {
                    this._fadeTimer = 0;
                    if (this._phaserSprite && this._phaserSprite.active) {
                        this._phaserSprite.destroy();
                        this._phaserSprite = null;
                    }
                }
            }
            return;
        }

        super.update(dt, entities);

        // 眩晕/冻结时中断攻击动作（同工头/提灯矿工：清攻击状态并停步，恢复后重新决策）
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            this._attackTimer = 0;
            this._attackAnimTimer = 0;
            this._clearSlamLock();
            this.vx = 0; this.vy = 0; this.isMoving = false;
            return;
        }

        // 更新计时器
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._attackTimer <= 0) {
                this._attackTimer = 0;
                this._clearSlamLock();
            }
        }
        if (this._attackAnimTimer > 0) {
            this._attackAnimTimer -= dt;
            if (this._attackAnimTimer < 0) this._attackAnimTimer = 0;
        }

        // 砸击帧判定：第 hitFrame 帧进行伤害判定；攻击音效在 sounds.attackFrame 帧播放一次
        if (this._attackTimer > 0) {
            const slam = this._getSlamConfig();
            const duration = slam.duration ?? 1500;
            const frames = slam.frames ?? 24;
            const elapsed = duration - this._attackTimer;
            const soundFrame = this.config?.sounds?.attackFrame;
            if (!this._slamSoundDone && typeof soundFrame === 'number' && elapsed >= (soundFrame / frames) * duration) {
                this._slamSoundDone = true;
                playSoundFrom(this, 'attack');
            }
            if (!this._slamHitDone && elapsed >= ((slam.hitFrame ?? 17) / frames) * duration) {
                this._slamHitDone = true;
                this._dealSlamHit();
            }
        }

        // 状态切换
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let nextState;
        if (this._attackTimer > 0) {
            nextState = 'attack';
        } else {
            const maxSpd = this.maxSpeed ?? this.speed ?? 140;
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
            this._walkSoundTimer -= dt;
            if (this._walkSoundTimer <= 0) {
                this._walkSoundTimer = this.config?.sounds?.walkInterval ?? 500;
                playSoundFrom(this, 'walk');
            }
        } else {
            this._walkSoundTimer = 0;
        }

        // 朝向
        if (this._attackTimer > 0 && this._slamSnapshot) {
            this.rotation = this._slamSnapshot.worldAngle;
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }
    }

    triggerWeaponAnim() {
        // 正在攻击时不插队
        if (this._attackTimer > 0) return false;
        const pending = this._pendingThrust?.active ? this._pendingThrust : null;
        let target = pending?.primaryTarget;
        let snapshot = pending?.basicMeleeSnapshot;
        const attackConfig = this.attacks?.melee?.config || this._getSlamConfig();
        if (!target || !snapshot) {
            target = this.target;
            if (!canStartBasicMelee(this, target, attackConfig)) return false;
            snapshot = createBasicMeleeSnapshot(this, target, attackConfig);
        }
        // 通用 Attack 只提供冷却和锁定快照；伤害由自定义第17帧唯一结算，防止双伤。
        if (pending) pending.active = false;
        const slam = this._getSlamConfig();
        const duration = slam.duration ?? 1500;
        this._attackTimer = duration;
        this._attackAnimTimer = duration; // MovementSystem 锁定（攻击时不可移动）
        this._slamHitDone = false;
        this._slamSoundDone = false;
        this._slamTarget = target;
        this._slamSnapshot = snapshot;
        this._animState = 'attack';
        this._animStateTimer = 0;
        this.rotation = snapshot.worldAngle;
        // 不走 super.triggerWeaponAnim()：砸击为自定义帧判定，不由通用突刺结算
        return true;
    }

    _clearSlamLock() {
        this._slamTarget = null;
        this._slamSnapshot = null;
    }

    /** 砸击伤害判定：只结算起手锁定目标，命中物理伤害 + 击退 */
    _dealSlamHit() {
        const slam = this._getSlamConfig();
        const target = this._slamTarget;
        if (!canImpactBasicMelee(this, target, this._slamSnapshot)) return;
        const atk = this.data?.atk || 0;
        target.takeDamage(Math.max(1, Math.round(atk)), this, 'physical', true);
        const parried = target.shieldSystem && target.shieldSystem._lastParried;
        const knockback = slam.knockback ?? 75;
        if (!parried && knockback > 0 && typeof target.applyKnockback === 'function') {
            target.applyKnockback(this._slamSnapshot.worldAngle, knockback);
        }
    }

    onDeath(source) {
        this.active = false;
        this._animState = 'death';
        this._clearSlamLock();
        // 死亡三段式：动画 animMs（与 BootScene duration 对齐）→ 定格 holdMs → 淡出 fadeMs
        this._deathAnimTimer = this._getDeathConfig().animMs ?? 1300;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        // 死亡音效（配置 sounds.death，播放一次）
        playSoundFrom(this, 'death');
        if (typeof super.onDeath === 'function') {
            super.onDeath(source);
        }
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_miner_zombie_walk';
            case 'attack': return 'enemy_miner_zombie_attack';
            case 'death': return 'enemy_miner_zombie_death';
            default: return 'enemy_miner_zombie_idle';
        }
    }

    _getPhaserOptions() {
        // 原始素材面向右，目标/移动方向朝左时翻转
        let flipX = false;
        if (this._attackTimer > 0 && this._slamSnapshot) {
            flipX = Math.cos(this._slamSnapshot.worldAngle) < 0;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }

        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 200;
        const collisionWidth = renderCfg.collisionWidth || 50;
        const collisionHeight = renderCfg.collisionHeight || 110;

        return {
            spriteSize,
            collisionWidth,
            collisionHeight,
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState: this._animState,
            animKey: `enemy_miner_zombie_${this._animState}`,
        };
    }
}
