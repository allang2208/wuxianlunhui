import { WallSystem } from '../world/wall-system.js';
import { Enemy } from './enemy.js';
import { Player } from './player.js';
import { ThrustAttack } from '../combat/attack.js';
import { RangedAttack } from '../combat/attack.js';
import { Renderer } from '../world/renderer.js';
import { MathUtils } from '../config/math-utils.js';
import enemyConfigData from '../../data/enemy-config.json';
import { ANIMATION_CONFIG } from '../config/animation-config.js';

function getAnimConfig(key) {
    return ANIMATION_CONFIG[key] || {};
}

class BlackWolf extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.blackWolf,
            usePacingAI: true,
            ...config
        });
        // 加载动画配置
        this._animCfg = getAnimConfig('blackWolf');
        const anim = this._animCfg.animation || {};
        const spritePaths = this._animCfg.sprites || {};

        // 加载精灵图
        this._sprites = {
            side: new Image(),     // 侧视图（奔跑/正常移动）
            front: new Image(),    // 正面（向下移动）
            back: new Image(),     // 背面（向上移动）
            attack: new Image(),   // 攻击动画（8帧撕咬）
            pacing: new Image(),   // 踱步动画（慢速移动）
            idle: new Image(),     // 眩晕/待机动画（单张）
        };
        this._sprites.side.src = spritePaths.side || 'assets/enemies/black_wolf.png';
        this._sprites.front.src = spritePaths.front || 'assets/enemies/black_wolf_updown.png';
        this._sprites.back.src = spritePaths.back || 'assets/enemies/black_wolf_updown.png';
        this._sprites.attack.src = spritePaths.attack || 'assets/enemies/black_wolf_attack.png';
        this._sprites.pacing.src = spritePaths.pacing || 'assets/enemies/black_wolf_pacing.png';
        this._sprites.idle.src = spritePaths.idle || 'assets/enemies/black_wolf_idle.png';
        
        // 当前 facing 方向
        this._facing = 'right'; // right, left, up, down
        this._lastHorizontalFacing = 'right'; // 供垂直移动/idle时保持水平朝向
        
        // 动画状态
        this._animState = 'idle'; // idle, walk, run, attack, pacing
        this._attackDuration = anim.attackDuration ?? 1600; // 攻击动画总时长(ms)，匹配 8帧 × 200ms/帧
        this._dashDistance = config.dashDistance || 200; // 从配置读取突进距离
        // 帧动画
        const frameLayout = anim.frameLayout || {};
        this._frameW = frameLayout.width ?? 250;
        this._frameH = frameLayout.height ?? 215;
        this._cols = frameLayout.cols ?? 4;
        this._rows = frameLayout.rows ?? 2;
        // 帧率配置 (ms/帧)
        this._frameDurations = anim.frameDurations || {
            idle: 200,
            walk: 120,
            run: 80,
            attack: 100,
            pacing: 160
        };
        // 动画速度阈值
        this._speedThresholds = anim.speedThresholds || {
            run: 1.2,
            walk: 0.1
        };
        this._facingThreshold = anim.facingThreshold ?? 0.5;

    }

    update(dt, entities) {
        super.update(dt, entities);
        
        // === 根据主导速度方向确定 facing（攻击期间锁定）===
        if (this._attackTimer <= 0) {
            const absVx = Math.abs(this.vx);
            const absVy = Math.abs(this.vy);
            const threshold = this._facingThreshold;
            if (absVx >= threshold || absVy >= threshold) {
                if (absVy > absVx) {
                    this._facing = this.vy > 0 ? 'down' : 'up';
                } else {
                    this._facing = this.vx > 0 ? 'right' : 'left';
                }
            }
            // 保存最后一次水平朝向，供垂直移动/idle时保留
            if (this._facing === 'left' || this._facing === 'right') {
                this._lastHorizontalFacing = this._facing;
            }
        } else {
            // 攻击期间：facing 锁定为攻击开始时的方向
            this._facing = this._dashStartFacing;
        }
        // 同步 _facingDir（供 ThrustAttack.checkTriangleHit 使用）
        this._facingDir = this._facing;
        
        // === 根据速度和 AI 状态确定动画状态 ===
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (this._attackTimer > 0) {
            this._animState = 'attack';
        } else if (this._aiState === 'pacing') {
            this._animState = 'pacing';
        } else if (speed > this._speedThresholds.run) {
            this._animState = 'run';
        } else if (speed > this._speedThresholds.walk) {
            this._animState = 'walk';
        } else {
            this._animState = 'idle';
        }

        // === 攻击动画计时 + 冲刺位移 ===
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._dashBlocked) {
                // 路线被墙阻挡：原地攻击，不冲刺
                this._attackDashOffset = 0;
            } else {
                const progress = 1 - (this._attackTimer / this._attackDuration); // 0 → 1
                this._attackDashOffset = this._dashDistance * this._getDashOffsetProgress(progress);
            }
        } else {
            // 攻击动画结束：将突进位移转化为实际位置（仅在未阻挡时）
            if (this._attackDashOffset > 0 && !this._dashBlocked) {
                const offset = this._getDashOffset();
                const targetX = this.x + offset.x;
                const targetY = this.y + offset.y;
                // [FIX] 冲刺终点碰撞检测：防止卡到墙/树内
                if (typeof WallSystem !== 'undefined' && WallSystem.resolve) {
                    const resolved = WallSystem.resolve(this.x, this.y, targetX, targetY, this.collisionRadius || 12);
                    this.x = resolved.x;
                    this.y = resolved.y;
                } else {
                    this.x = targetX;
                    this.y = targetY;
                }
                // 更新踱步中心（如果正在踱步）
                if (this._aiState === 'pacing') {
                    this._pacingOrigin.x = this.x;
                    this._pacingOrigin.y = this.y;
                }
            }
            this._attackDashOffset = 0;
            this._dashBlocked = false; // 重置
            if (this._animState === 'attack') {
                this._animFrame = 0;
            }
        }

        // === 更新帧动画 ===
        this._animTimer += dt;
        const frameDuration = this._frameDurations[this._animState] || 150;
        if (this._animState === 'attack') {
            if (this._animTimer >= frameDuration) {
                this._animTimer = 0;
                this._animFrame = (this._animFrame + 1) % 8;
            }
        } else {
            if (this._animTimer >= frameDuration) {
                this._animTimer = 0;
                const totalFrames = (this._animState === 'run' || this._animState === 'pacing') ? 8 : 4;
                this._animFrame = (this._animFrame + 1) % totalFrames;
            }
        }
    }

    triggerWeaponAnim() {
        super.triggerWeaponAnim();
    }

    _getTextureKey() {
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            return 'enemy_black_wolf_idle';
        }
        if (this._animState === 'attack') {
            return 'enemy_black_wolf_attack';
        }
        if (this._animState === 'pacing') {
            return 'enemy_black_wolf_pacing';
        }
        return 'enemy_black_wolf';
    }

    _getPhaserOptions() {
        let flipX = false;
        if (this._facing === 'left') {
            flipX = true;
        } else if (this._facing === 'right') {
            flipX = false;
        } else {
            // up/down：没有上下精灵图
            if (this._attackTimer > 0 && this._dashAngle !== undefined) {
                // 攻击期间使用冲刺方向决定水平朝向
                flipX = Math.cos(this._dashAngle) < 0;
            } else if (Math.abs(this.vx) > 0.1) {
                flipX = this.vx < 0;
            } else {
                // 纯垂直移动/idle：保持上次水平朝向
                flipX = this._lastHorizontalFacing === 'left';
            }
        }

        let offsetX = 0, offsetY = 0;
        if (this._attackDashOffset > 0) {
            switch (this._facing) {
                case 'right': offsetX = this._attackDashOffset; break;
                case 'left':  offsetX = -this._attackDashOffset; break;
                case 'down':  offsetY = this._attackDashOffset; break;
                case 'up':    offsetY = -this._attackDashOffset; break;
            }
        }

        const renderCfg = this._animCfg?.render || {};
        return {
            spriteSize: renderCfg.spriteSize ?? 151,
            rotation: 0,
            frame: this._animFrame,
            flipX: flipX,
            flipY: false,
            textOffsetY: -64,
            nameColor: 'rgba(255, 60, 60, 0.9)',
            offsetX: offsetX,
            offsetY: offsetY
        };
    }

    _drawBody(ctx) {
        const params = this._getBodyAnimationParams();
        let { bounceY, scaleX, scaleY, leanAngle, swayX } = params;

        let currentSprite;
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            // 眩晕状态：显示 idle 图片（被弹反后）
            currentSprite = this._sprites.idle;
        } else if (this._animState === 'attack') {
            currentSprite = this._sprites.attack;
        } else if (this._animState === 'pacing') {
            currentSprite = this._sprites.pacing;
        } else {
            currentSprite = this._sprites.side;
        }

        const shouldFlip = this._facing === 'left' ||
            ((this._facing === 'up' || this._facing === 'down') && (
                (this._attackTimer > 0 && this._dashAngle !== undefined && Math.cos(this._dashAngle) < 0) ||
                (Math.abs(this.vx) > 0.1 && this.vx < 0) ||
                (Math.abs(this.vx) <= 0.1 && this._lastHorizontalFacing === 'left')
            ));
        if (shouldFlip) ctx.scale(-1, 1);
        ctx.rotate(leanAngle);
        if (currentSprite && currentSprite.complete && currentSprite.naturalWidth > 0) {
            if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
                // 眩晕 idle 图片：单张，直接绘制，缩放至 151x151
                const renderCfg = this._animCfg?.render || {};
                const spriteSize = renderCfg.spriteSize ?? 151;
                const spriteOffset = renderCfg.spriteOffset ?? -76;
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, spriteOffset, spriteOffset, spriteSize, spriteSize);
                ctx.restore();
            } else {
                // 正常帧动画
                const frameW = currentSprite.naturalWidth / this._cols;
                const frameH = currentSprite.naturalHeight / this._rows;
                const col = this._animFrame % this._cols;
                const row = Math.floor(this._animFrame / this._cols);
                const renderCfg = this._animCfg?.render || {};
                const spriteSize = renderCfg.spriteSize ?? 151;
                const spriteOffset = renderCfg.spriteOffset ?? -76;
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, col * frameW, row * frameH, frameW, frameH, spriteOffset, spriteOffset, spriteSize, spriteSize);
                ctx.restore();
            }
        } else {
            super._drawBody(ctx);
        }
    }

    _drawShadow(ctx, x, y, size) {
        // 阴影绑定碰撞体积位置：使用碰撞半径，随冲刺同步
        const r = this.collisionRadius || size;
        const shadowCfg = this._animCfg?.render?.shadow || {};
        ctx.fillStyle = shadowCfg.color || 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.ellipse(x, y + r * (shadowCfg.yFactor ?? 0.5) + (shadowCfg.yOffset ?? 15), r * (shadowCfg.rxFactor ?? 1), r * (shadowCfg.ryFactor ?? 0.35), 0, 0, Math.PI * 2);
        ctx.fill();
    }

    _resetPacingInterval() {
        const cfg = this._animCfg?.animation?.pacingInterval || { min: 1000, max: 2000 };
        this._pacingInterval = cfg.min + Math.random() * (cfg.max - cfg.min);
    }

    _getDashOffsetProgress(progress) {
        const phases = this._animCfg?.animation?.dashEasing?.phases;
        if (!phases) return progress;
        for (const phase of phases) {
            if (progress <= phase.until) {
                if (phase.mode === 'constant') return phase.value;
                if (phase.mode === 'linear') {
                    const range = phase.until - phase.from;
                    const local = range > 0 ? (progress - phase.from) / range : 0;
                    return phase.fromValue + (phase.toValue - phase.fromValue) * local;
                }
            }
        }
        return 1;
    }

    _getBodyAnimationParams() {
        const cfg = this._animCfg?.render?.body || {};
        const t = this.animTime;
        let bounceY = 0, scaleX = 1, scaleY = 1, leanAngle = 0, swayX = 0;
        if (this._animState === 'attack') {
            const attackCfg = cfg.attack || {};
            const progress = 1 - Math.max(0, this._attackTimer) / (attackCfg.duration ?? 300);
            const scale = 1 + Math.sin(progress * Math.PI) * (attackCfg.scaleAmplitude ?? 0.15);
            scaleX = scale; scaleY = scale;
            bounceY = -Math.sin(progress * Math.PI) * (attackCfg.bounceAmplitude ?? 5);
            leanAngle = attackCfg.leanAngle ?? 0.1;
        } else if (this._animState === 'run') {
            const runCfg = cfg.run || {};
            const runPhase = t * (runCfg.phaseSpeed ?? 2);
            bounceY = Math.sin(runPhase) * (runCfg.bounceAmplitude ?? 4);
            leanAngle = Math.sin(runPhase) * (runCfg.leanAmplitude ?? 0.12);
            swayX = Math.sin(runPhase + (runCfg.swayPhaseOffset ?? Math.PI / 4)) * (runCfg.swayAmplitude ?? 2);
            const stretch = Math.sin(runPhase * 2) * (runCfg.stretchAmplitude ?? 0.015);
            scaleX = 1 + stretch; scaleY = 1 - stretch * (runCfg.stretchYFactor ?? 0.3);
        } else if (this._animState === 'walk' || this._animState === 'pacing') {
            const stateCfg = cfg[this._animState] || cfg.walk || {};
            bounceY = Math.sin(t) * (stateCfg.bounceAmplitude ?? 2);
        }
        return { bounceY, scaleX, scaleY, leanAngle, swayX };
    }
}

export { BlackWolf };

class RedWolfKing extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.redWolfKing,
            usePacingAI: true,
            ...config
        });
        // 加载动画配置
        this._animCfg = getAnimConfig('redWolfKing');
        const anim = this._animCfg.animation || {};
        const spritePaths = this._animCfg.sprites || {};

        // 加载精灵图
        this._sprites = {
            side: new Image(),     // 侧视图（奔跑/正常移动）
            front: new Image(),    // 正面（向下移动）
            back: new Image(),     // 背面（向上移动）
            attack: new Image(),   // 攻击动画（复用奔跑图）
            pacing: new Image(),   // 踱步动画（慢速移动）
            idle: new Image(),     // 眩晕/待机动画（单张）
            transform: new Image(), // 变身动画（8帧）
            howl: new Image(),      // 嚎叫动画（8帧）
            transformedIdle: new Image(), // 变身后待机动画
            transformedRun: new Image(),    // 变身后奔跑动画
        };
        this._sprites.side.src = spritePaths.side || 'assets/enemies/red_wolf_king_run.png';
        this._sprites.front.src = spritePaths.front || 'assets/enemies/red_wolf_king_run.png';
        this._sprites.back.src = spritePaths.back || 'assets/enemies/red_wolf_king_run.png';
        this._sprites.attack.src = spritePaths.attack || 'assets/enemies/red_wolf_king_attack.png';
        this._sprites.pacing.src = spritePaths.pacing || 'assets/enemies/red_wolf_king_pacing.png';
        this._sprites.idle.src = spritePaths.idle || 'assets/enemies/red_wolf_king_idle.png';
        this._sprites.transform.src = spritePaths.transform || 'assets/enemies/red_wolf_king_change.png';
        this._sprites.howl.src = spritePaths.howl || 'assets/enemies/red_wolf_king_howl.png';
        this._sprites.transformedIdle.src = spritePaths.transformedIdle || 'assets/enemies/red_wolf_king_transformed_idle.png';
        this._sprites.transformedRun.src = spritePaths.transformedRun || 'assets/enemies/red_wolf_king_changed_run.png';
        
        // 当前 facing 方向
        this._facing = 'right';
        this._lastHorizontalFacing = 'right'; // 供垂直移动/idle时保持水平朝向
        
        // ===== 变身系统 =====
        const transformConfig = this._animCfg.transform || {};
        this._transformHpThreshold = transformConfig.hpThreshold ?? 0.5;
        this._transformDuration = transformConfig.duration ?? 2000;
        this._howlDuration = transformConfig.howlDuration ?? 2000;
        this._transformDamageMultiplier = transformConfig.damageMultiplier ?? 2;
        this._transformHpRecover = transformConfig.hpRecover ?? 1;
        this._isTransformed = false;      // 是否已完成变身
        this._isTransforming = false;     // 是否正在变身动画中
        this._isHowling = false;          // 是否正在嚎叫动画中
        this._transformTimer = 0;         // 变身动画计时器
        this._howlTimer = 0;              // 嚎叫动画计时器
        this._transformTriggered = false; // 变身是否已触发过（只触发一次）
        
        // 动画状态
        this._animState = 'idle';
        this._attackDuration = anim.attackDuration ?? 800;
        this._dashDistance = config.dashDistance || 200; // 从配置读取突进距离（默认200px）
        // 帧动画
        const frameLayout = anim.frameLayout || {};
        this._frameW = frameLayout.width ?? 250;
        this._frameH = frameLayout.height ?? 215;
        this._cols = frameLayout.cols ?? 4;
        this._rows = frameLayout.rows ?? 2;
        // 帧率配置（减慢50%：即时长翻倍）
        this._frameDurations = anim.frameDurations || {
            idle: 400,
            walk: 240,
            run: 160,
            attack: 100, // 等比例缩减：8帧 × 100ms = 800ms
            pacing: 320
        };
        // 动画速度阈值
        this._speedThresholds = anim.speedThresholds || {
            run: 1.2,
            walk: 0.1
        };
        this._facingThreshold = anim.facingThreshold ?? 0.5;
        this._animStateHysteresis = anim.animStateHysteresis || { run: 0.8, walkFromIdle: 0.05 };

    }

    update(dt, entities) {
        // === 变身检测：HP 低于阈值时触发（只触发一次） ===
        if (!this._transformTriggered && this.hp > 0 && this.hp < this.maxHp * this._transformHpThreshold) {
            this._transformTriggered = true;
            this._isTransforming = true;
            this._transformTimer = this._transformDuration;
            this._animState = 'transform';
            this._animFrame = 0;
            this._animTimer = 0;
            // 变身期间：锁定移动、清除攻击状态
            this.vx = 0; this.vy = 0;
            this._attackTimer = 0;
            this._attackDashOffset = 0;
        }
        
        // === 变身动画进行中 ===
        if (this._isTransforming) {
            this._transformTimer -= dt;
            // 更新变身帧动画（8帧，2秒内播完）
            this._animTimer += dt;
            const transformFrameDuration = this._transformDuration / 8;
            if (this._animTimer >= transformFrameDuration) {
                this._animTimer = 0;
                this._animFrame = (this._animFrame + 1) % 8;
            }
            // 变身完成 → 进入嚎叫阶段
            if (this._transformTimer <= 0) {
                this._isTransforming = false;
                this._isHowling = true;
                this._howlTimer = this._howlDuration;
                this._animState = 'howl';
                this._animFrame = 0;
                this._animTimer = 0;
            }
            // 变身期间不执行正常 update
            return;
        }
        
        // === 嚎叫动画进行中 ===
        if (this._isHowling) {
            this._howlTimer -= dt;
            // 更新嚎叫帧动画（8帧，2秒内播完，底部对齐后脚不动）
            this._animTimer += dt;
            const howlFrameDuration = this._howlDuration / 8;
            if (this._animTimer >= howlFrameDuration) {
                this._animTimer = 0;
                this._animFrame = (this._animFrame + 1) % 8;
            }
            // 嚎叫完成
            if (this._howlTimer <= 0) {
                this._isHowling = false;
                this._isTransformed = true;
                // 恢复 HP
                this.hp = this.maxHp * this._transformHpRecover;
                // 攻击力翻倍：修改攻击配置
                if (this.attacks && this.attacks.melee) {
                    const dmg = this.attacks.melee.config.damage;
                    if (!this._originalDamage) {
                        this._originalDamage = { min: dmg.min, max: dmg.max };
                    }
                    dmg.min = Math.floor(this._originalDamage.min * this._transformDamageMultiplier);
                    dmg.max = Math.floor(this._originalDamage.max * this._transformDamageMultiplier);
                }
                // 切换精灵图
                const transformedSprites = this._animCfg.transformedSprites || {};
                this._sprites.side.src = transformedSprites.side || 'assets/enemies/red_wolf_king_changed_run.png';
                this._sprites.front.src = transformedSprites.front || 'assets/enemies/red_wolf_king_changed_run.png';
                this._sprites.back.src = transformedSprites.back || 'assets/enemies/red_wolf_king_changed_run.png';
                this._sprites.idle.src = transformedSprites.idle || 'assets/enemies/red_wolf_king_transformed_idle.png';
                // 变身后动画状态重置
                this._animState = 'idle';
                this._animFrame = 0;
                this._animTimer = 0;
            }
            // 嚎叫期间不执行正常 update
            return;
        }
        
        super.update(dt, entities);
        
        // === 根据主导速度方向确定 facing（攻击期间锁定）===
        if (this._attackTimer <= 0) {
            const absVx = Math.abs(this.vx);
            const absVy = Math.abs(this.vy);
            const threshold = this._facingThreshold;
            if (absVx >= threshold || absVy >= threshold) {
                if (absVy > absVx) {
                    this._facing = this.vy > 0 ? 'down' : 'up';
                } else {
                    this._facing = this.vx > 0 ? 'right' : 'left';
                }
            }
            // 保存最后一次水平朝向，供垂直移动/idle时保留
            if (this._facing === 'left' || this._facing === 'right') {
                this._lastHorizontalFacing = this._facing;
            }
        } else {
            this._facing = this._dashStartFacing;
        }
        this._facingDir = this._facing;
        
        // === 根据速度和 AI 状态确定动画状态（添加 hysteresis 缓冲防止阈值附近卡帧）===
        const prevAnimState = this._animState;
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        const hysteresis = this._animStateHysteresis || {};
        if (this._attackTimer > 0) {
            this._animState = 'attack';
        } else if (this._aiState === 'pacing') {
            this._animState = 'pacing';
        } else if (this._animState === 'run' ? speed > (hysteresis.run ?? 0.8) : speed > this._speedThresholds.run) {
            this._animState = 'run';
        } else if (this._animState === 'idle' ? speed > this._speedThresholds.walk : speed > (hysteresis.walkFromIdle ?? 0.05)) {
            this._animState = 'walk';
        } else {
            this._animState = 'idle';
        }
        // 动画状态切换时重置帧索引，避免帧越界/跳帧
        if (prevAnimState !== this._animState) {
            this._animFrame = 0;
            this._animTimer = 0;
        }

        // === 攻击动画计时 + 冲刺位移 ===
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._dashBlocked) {
                this._attackDashOffset = 0;
            } else {
                const progress = 1 - (this._attackTimer / this._attackDuration);
                this._attackDashOffset = this._dashDistance * this._getDashOffsetProgress(progress);
            }
        } else {
            if (this._attackDashOffset > 0 && !this._dashBlocked) {
                const offset = this._getDashOffset();
                const targetX = this.x + offset.x;
                const targetY = this.y + offset.y;
                if (typeof WallSystem !== 'undefined' && WallSystem.resolve) {
                    const resolved = WallSystem.resolve(this.x, this.y, targetX, targetY, this.collisionRadius || 12);
                    this.x = resolved.x;
                    this.y = resolved.y;
                } else {
                    this.x = targetX;
                    this.y = targetY;
                }
                if (this._aiState === 'pacing') {
                    this._pacingOrigin.x = this.x;
                    this._pacingOrigin.y = this.y;
                }
            }
            this._attackDashOffset = 0;
            this._dashBlocked = false;
            if (this._animState === 'attack') {
                this._animFrame = 0;
            }
        }

        // === 更新帧动画 ===
        this._animTimer += dt;
        const frameDuration = this._frameDurations[this._animState] || 150;
        if (this._animState === 'attack') {
            if (this._animTimer >= frameDuration) {
                this._animTimer = 0;
                this._animFrame = (this._animFrame + 1) % 8;
            }
        } else if (this._isTransformed && this._animState === 'idle') {
            // 变身后 idle：固定第 0 帧，不循环（避免精灵图帧偏移导致的抖动）
            this._animFrame = 0;
        } else {
            if (this._animTimer >= frameDuration) {
                this._animTimer = 0;
                let totalFrames;
                if (this._animState === 'run' || this._animState === 'pacing') {
                    totalFrames = this._isTransformed ? 16 : 8;
                } else {
                    totalFrames = 4;
                }
                this._animFrame = (this._animFrame + 1) % totalFrames;
            }
        }
    }

    triggerWeaponAnim() {
        // 变身/嚎叫期间禁止攻击
        if (this._isTransforming || this._isHowling) return;
        super.triggerWeaponAnim();
    }

    _getTextureKey() {
        if (this._isTransforming) {
            return 'enemy_red_wolf_king_change';
        }
        if (this._isHowling) {
            return 'enemy_red_wolf_king_howl';
        }
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            return 'enemy_red_wolf_king_idle';
        }
        if (this._animState === 'attack') {
            return 'enemy_red_wolf_king_attack';
        }
        if (this._animState === 'pacing') {
            return 'enemy_red_wolf_king_pacing';
        }
        if (this._isTransformed) {
            if (this._animState === 'idle') {
                return 'enemy_red_wolf_king_changed_idle';
            } else {
                return 'enemy_red_wolf_king_changed_run';
            }
        }
        return 'enemy_red_wolf_king';
    }

    _getPhaserOptions() {
        let flipX = false;
        if (this._facing === 'left') {
            flipX = true;
        } else if (this._facing === 'right') {
            flipX = false;
        } else {
            // up/down：没有上下精灵图
            if (this._attackTimer > 0 && this._dashAngle !== undefined) {
                // 攻击期间使用冲刺方向决定水平朝向
                flipX = Math.cos(this._dashAngle) < 0;
            } else if (Math.abs(this.vx) > 0.1) {
                flipX = this.vx < 0;
            } else {
                // 纯垂直移动/idle：保持上次水平朝向
                flipX = this._lastHorizontalFacing === 'left';
            }
        }

        let offsetX = 0, offsetY = 0;
        if (this._attackDashOffset > 0) {
            switch (this._facing) {
                case 'right': offsetX = this._attackDashOffset; break;
                case 'left':  offsetX = -this._attackDashOffset; break;
                case 'down':  offsetY = this._attackDashOffset; break;
                case 'up':    offsetY = -this._attackDashOffset; break;
            }
        }
        // 嚎叫精灵图内容中心比变身低约 16px，通过 offsetY 补偿对齐
        // 最后2帧（帧6、7）额外垂直补偿
        // 帧6额外水平偏移（质心偏左约79px，显示后约18px）
        if (this._isHowling) {
            const howlOffset = this._getHowlOffset();
            offsetY += howlOffset.y;
            offsetX += howlOffset.x;
        }

        const renderCfg = this._animCfg?.render || {};
        return {
            spriteSize: renderCfg.spriteSize ?? 151,
            rotation: 0,
            frame: this._isTransformed && this._animState === 'idle' ? 0 : this._animFrame,
            flipX: flipX,
            flipY: false,
            textOffsetY: -64,
            nameColor: 'rgba(255, 60, 60, 0.9)',
            offsetX: offsetX,
            offsetY: offsetY,
            scale: 1
        };
    }

    _drawBody(ctx) {
        const params = this._getBodyAnimationParams();
        let { bounceY, scaleX, scaleY, leanAngle, swayX } = params;
        // 变身后去掉上下弹跳，避免精灵图抖动（保留左右摇摆和拉伸效果）
        if (this._isTransformed && (this._animState === 'run' || this._animState === 'walk' || this._animState === 'pacing')) {
            bounceY = 0;
        }

        let currentSprite;
        if (this._isTransforming) {
            currentSprite = this._sprites.transform;
        } else if (this._isHowling) {
            currentSprite = this._sprites.howl;
        } else if (this._isTransformed) {
            if (this._animState === 'idle') {
                currentSprite = this._sprites.transformedIdle;
            } else if (this._animState === 'attack') {
                currentSprite = this._sprites.attack;
            } else {
                currentSprite = this._sprites.transformedRun;
            }
        } else if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            currentSprite = this._sprites.idle;
        } else if (this._animState === 'attack') {
            currentSprite = this._sprites.attack;
        } else if (this._animState === 'pacing') {
            currentSprite = this._sprites.pacing;
        } else {
            currentSprite = this._sprites.side;
        }

        const shouldFlip = this._facing === 'left' ||
            ((this._facing === 'up' || this._facing === 'down') && (
                (this._attackTimer > 0 && this._dashAngle !== undefined && Math.cos(this._dashAngle) < 0) ||
                (Math.abs(this.vx) > 0.1 && this.vx < 0) ||
                (Math.abs(this.vx) <= 0.1 && this._lastHorizontalFacing === 'left')
            ));
        if (shouldFlip) ctx.scale(-1, 1);
        ctx.rotate(leanAngle);
        if (currentSprite && currentSprite.complete && currentSprite.naturalWidth > 0) {
            if (this._isTransforming || this._isHowling) {
                // 变身/嚎叫动画：8帧，4x2 排列
                const frameW = currentSprite.naturalWidth / 4;
                const frameH = currentSprite.naturalHeight / 2;
                const col = this._animFrame % 4;
                const row = Math.floor(this._animFrame / 4);
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                // 嚎叫上移 16px 补偿内容中心差异，最后2帧额外补偿
                // 帧6额外水平偏移（质心偏左约79px，显示后约18px）
                const renderCfg = this._animCfg?.render || {};
                const spriteSize = renderCfg.spriteSize ?? 151;
                const spriteOffset = renderCfg.spriteOffset ?? -76;
                const howlOffset = this._getHowlOffset();
                ctx.drawImage(currentSprite, col * frameW, row * frameH, frameW, frameH, spriteOffset + howlOffset.x, spriteOffset + howlOffset.y, spriteSize, spriteSize);
                ctx.restore();
            } else if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
                const renderCfg = this._animCfg?.render || {};
                const spriteSize = renderCfg.spriteSize ?? 151;
                const spriteOffset = renderCfg.spriteOffset ?? -76;
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, spriteOffset, spriteOffset, spriteSize, spriteSize);
                ctx.restore();
            } else {
                // 变身后精灵图布局：idle 1x4, run 1x16, attack 4x2
                const transformedLayout = this._animCfg?.render?.transformedFrameLayout || {};
                let cols, rows;
                if (this._isTransformed) {
                    const layout = transformedLayout[this._animState] || { cols: this._cols, rows: this._rows };
                    cols = layout.cols; rows = layout.rows;
                } else {
                    cols = this._cols; rows = this._rows;
                }
                const frameW = currentSprite.naturalWidth / cols;
                const frameH = currentSprite.naturalHeight / rows;
                const col = this._animFrame % cols;
                const row = Math.floor(this._animFrame / cols);
                const renderCfg = this._animCfg?.render || {};
                const spriteSize = renderCfg.spriteSize ?? 151;
                const spriteOffset = renderCfg.spriteOffset ?? -76;
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, col * frameW, row * frameH, frameW, frameH, spriteOffset, spriteOffset, spriteSize, spriteSize);
                ctx.restore();
            }
        } else {
            super._drawBody(ctx);
        }
    }

    _drawShadow(ctx, x, y, size) {
        const r = this.collisionRadius || size;
        const shadowCfg = this._animCfg?.render?.shadow || {};
        // 图片显示大小为 151x151，狼脚在底部 y + 75 处
        const shadowY = y + (shadowCfg.fixedYOffset ?? 75);
        ctx.fillStyle = shadowCfg.color || 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.ellipse(x, shadowY, r * (shadowCfg.rxFactor ?? 1), r * (shadowCfg.ryFactor ?? 0.35), 0, 0, Math.PI * 2);
        ctx.fill();
    }

    _resetPacingInterval() {
        const cfg = this._animCfg?.animation?.pacingInterval || { min: 1000, max: 2000 };
        this._pacingInterval = cfg.min + Math.random() * (cfg.max - cfg.min);
    }

    _getDashOffsetProgress(progress) {
        const phases = this._animCfg?.animation?.dashEasing?.phases;
        if (!phases) return progress;
        for (const phase of phases) {
            if (progress <= phase.until) {
                if (phase.mode === 'constant') return phase.value;
                if (phase.mode === 'linear') {
                    const range = phase.until - phase.from;
                    const local = range > 0 ? (progress - phase.from) / range : 0;
                    return phase.fromValue + (phase.toValue - phase.fromValue) * local;
                }
            }
        }
        return 1;
    }

    _getBodyAnimationParams() {
        const cfg = this._animCfg?.render?.body || {};
        const t = this.animTime;
        let bounceY = 0, scaleX = 1, scaleY = 1, leanAngle = 0, swayX = 0;
        if (this._animState === 'attack') {
            const attackCfg = cfg.attack || {};
            const progress = 1 - Math.max(0, this._attackTimer) / (attackCfg.duration ?? 300);
            const scale = 1 + Math.sin(progress * Math.PI) * (attackCfg.scaleAmplitude ?? 0.15);
            scaleX = scale; scaleY = scale;
            bounceY = -Math.sin(progress * Math.PI) * (attackCfg.bounceAmplitude ?? 5);
            leanAngle = attackCfg.leanAngle ?? 0.1;
        } else if (this._animState === 'run') {
            const runCfg = cfg.run || {};
            const runPhase = t * (runCfg.phaseSpeed ?? 2);
            bounceY = Math.sin(runPhase) * (runCfg.bounceAmplitude ?? 4);
            leanAngle = Math.sin(runPhase) * (runCfg.leanAmplitude ?? 0.12);
            swayX = Math.sin(runPhase + (runCfg.swayPhaseOffset ?? Math.PI / 4)) * (runCfg.swayAmplitude ?? 2);
            const stretch = Math.sin(runPhase * 2) * (runCfg.stretchAmplitude ?? 0.015);
            scaleX = 1 + stretch; scaleY = 1 - stretch * (runCfg.stretchYFactor ?? 0.3);
        } else if (this._animState === 'walk' || this._animState === 'pacing') {
            const stateCfg = cfg[this._animState] || cfg.walk || {};
            bounceY = Math.sin(t) * (stateCfg.bounceAmplitude ?? 2);
        }
        return { bounceY, scaleX, scaleY, leanAngle, swayX };
    }

    _getHowlOffset() {
        const cfg = this._animCfg?.render?.howlOffset || { baseY: -16, frames: {} };
        let x = 0, y = cfg.baseY ?? -16;
        const frameCfg = cfg.frames?.[String(this._animFrame)];
        if (frameCfg) {
            x += frameCfg.x ?? 0;
            y += frameCfg.y ?? 0;
        }
        return { x, y };
    }
}

export { RedWolfKing };

class SpitterZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            id: 'spitterZombie',
            name: 'Spitter Zombie',
            hp: 80,
            maxHp: 80,
            size: 12,
            collisionRadius: 14,
            speed: 25,
            level: 3,
            color: '#4a9a4a',
            highlightColor: 'rgba(74, 154, 74, 0.3)',
            str: 12,
            dex: 10,
            con: 12,
            int: 4,
            wis: 4,
            luck: 6,
            rank: 'normal',
            attackRange: 600,
            aiInterval: 1500,
            _alertRange: Infinity, // 无限索敌距离
            ...config
        });

        // Set stick figure rendering colors
        this._color = '#4a9a4a';
        this._headColor = '#8a30a0';
        this._useStickFigure = false;  // 使用图片贴图
        this._showWeapon = false;
        this._circleRadius = 600; // 绕圈战斗距离：在目标周围 600px 绕圈移动，不贴身

        // Replace base melee attack with ranged spit attack
        this.attacks = {
            ranged: new RangedAttack({
                cooldown: 1500,
                range: 300,
                projectileSpeed: 150,
                projectileRange: 1200,
                projectileSize: 10,
                damage: { min: 5, max: 12 },
                isSpit: true
            })
        };
    }
}

export { SpitterZombie };

class FatZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.fatZombie,
            ...config
        });
        this._headColor = '#8B4513';
        this._color = '#5a7a5a';
        this._useStickFigure = false;  // 使用图片贴图
        this._showWeapon = false;
        this._alertRange = Infinity;
        this._rangedDamageReduction = 0.5; // 50%远程伤害减免
    }
}

export { FatZombie };

class FastZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.fastZombie,
            ...config
        });
        this._headColor = '#c03030'; // 红色头
        this._color = '#4a9a4a';     // 绿色身体
        this._useStickFigure = false;  // 使用图片贴图
        this._showWeapon = false;
        this._alertRange = Infinity;
    }
}

export { FastZombie };

class ZombieDog extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.fastZombie,
            name: 'Zombie Dog', // 覆盖 fastZombie 的默认名称
            ...config
        });
        this._headColor = '#e8e0c8'; // 骨骼色头部
        this._color = '#d4cfc0';     // 骨骼灰白身体
        this._useStickFigure = false;  // 使用图片贴图
        this._showWeapon = false;
        this._alertRange = Infinity;
        // 命中后施加致残 debuff（减速 50%，持续 3 秒）
        this._onHitEntity = (entity) => {
            if (typeof entity.applyCripple === 'function') {
                entity.applyCripple(3000);
            }
        };
    }

    // 覆盖 _drawEnemyStickFigure，绘制四足骨骼狗
    _drawEnemyStickFigure(ctx) {
        const hitWhite = this.hitFlash > 0;
        const headColor = hitWhite ? '#ffffff' : (this._headColor || '#e8e0c8');
        const bodyColor = hitWhite ? '#ffffff' : (this._color || '#d4cfc0');
        const lw = hitWhite ? 4 : 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = lw;

        const t = this.animTime;
        const walking = this.isMoving;
        const s = walking ? Math.sin(t * 8) : 0;
        const bob = walking ? Math.sin(t * 16) * 1.5 : Math.sin(t * 2) * 0.3;

        // 四足骨骼狗的关键关节（侧视图，右侧面）
        // 缩放比例适配 enemy size
        const sc = 0.9;
        // 头部：长嘴兽头骨
        const skull = { x: 0, y: -18 + bob };
        const snout = { x: 10, y: -14 + bob };
        const jaw = { x: 9, y: -10 + bob };
        // 颈部 → 脊柱
        const neck = { x: -3, y: -14 + bob };
        const spine = { x: -12, y: -10 + bob };  // 胸椎
        const hip = { x: -22, y: -10 + bob };
        // 肋骨
        const ribTop = { x: -8, y: -16 + bob };
        const ribBottom = { x: -8, y: -4 + bob };
        const rib2Top = { x: -14, y: -16 + bob };
        const rib2Bottom = { x: -14, y: -4 + bob };
        // 前腿（肩膀）
        const fShoulder = { x: -6 + s * 3, y: -9 + bob };
        const fElbow = { x: -6 + s * 5, y: 2 + bob };
        const fPaw = { x: -6 + s * 6, y: 12 + bob };
        // 后腿（髋部）
        const bHip = { x: -20 - s * 3, y: -9 + bob };
        const bKnee = { x: -20 - s * 5, y: 2 + bob };
        const bPaw = { x: -20 - s * 6, y: 12 + bob };
        // 尾巴
        const tail1 = { x: -26, y: -11 + bob };
        const tail2 = { x: -32, y: -5 + bob };
        const tail3 = { x: -36, y: -2 + bob };

        // 绘制头骨（圆形 + 嘴）
        ctx.fillStyle = headColor;
        ctx.beginPath(); ctx.arc(skull.x, skull.y, 5, 0, Math.PI * 2); ctx.fill();
        // 嘴部
        ctx.strokeStyle = bodyColor;
        ctx.beginPath(); ctx.moveTo(skull.x, skull.y); ctx.lineTo(snout.x, snout.y); ctx.lineTo(jaw.x, jaw.y); ctx.stroke();
        // 下颚
        ctx.beginPath(); ctx.moveTo(skull.x, skull.y); ctx.lineTo(jaw.x, jaw.y); ctx.stroke();
        // 牙齿小点
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.arc(snout.x, snout.y, 1.5, 0, Math.PI * 2); ctx.fill();

        // 脊柱
        ctx.strokeStyle = bodyColor;
        ctx.beginPath(); ctx.moveTo(neck.x, neck.y); ctx.lineTo(hip.x, hip.y); ctx.stroke();
        // 肋骨（两根弧线）
        ctx.beginPath(); ctx.moveTo(ribTop.x, ribTop.y); ctx.lineTo(ribBottom.x, ribBottom.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rib2Top.x, rib2Top.y); ctx.lineTo(rib2Bottom.x, rib2Bottom.y); ctx.stroke();
        // 髋部
        ctx.beginPath(); ctx.arc(hip.x, hip.y, 3, 0, Math.PI * 2); ctx.fill();

        // 前腿（肩膀 → 肘 → 爪）
        ctx.beginPath(); ctx.moveTo(fShoulder.x, fShoulder.y); ctx.lineTo(fElbow.x, fElbow.y); ctx.lineTo(fPaw.x, fPaw.y); ctx.stroke();
        // 后腿（髋 → 膝 → 爪）
        ctx.beginPath(); ctx.moveTo(bHip.x, bHip.y); ctx.lineTo(bKnee.x, bKnee.y); ctx.lineTo(bPaw.x, bPaw.y); ctx.stroke();

        // 尾巴（三段，带摆动）
        const ts = walking ? Math.sin(t * 12) * 2 : 0;
        ctx.beginPath(); ctx.moveTo(hip.x, hip.y);
        ctx.lineTo(tail1.x + ts, tail1.y); ctx.lineTo(tail2.x + ts * 1.5, tail2.y); ctx.lineTo(tail3.x + ts * 2, tail3.y); ctx.stroke();

        // 关节点
        ctx.fillStyle = bodyColor;
        [fShoulder, fElbow, fPaw, bHip, bKnee, bPaw].forEach(j => {
            ctx.beginPath(); ctx.arc(j.x, j.y, 1.5, 0, Math.PI * 2); ctx.fill();
        });
        // 爪
        ctx.beginPath(); ctx.arc(fPaw.x, fPaw.y, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(bPaw.x, bPaw.y, 2, 0, Math.PI * 2); ctx.fill();
    }
}

export { ZombieDog };
