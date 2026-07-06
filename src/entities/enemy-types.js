import { Enemy } from './enemy.js';
import { Player } from './player.js';
import { ThrustAttack } from '../combat/attack.js';
import { RangedAttack } from '../combat/attack.js';
import { Renderer } from '../world/renderer.js';
import { MathUtils } from '../config/math-utils.js';
import enemyConfigData from '../../data/enemy-config.json';

class BlackWolf extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.blackWolf,
            ...config
        });
        // 加载精灵图
        this._sprites = {
            side: new Image(),     // 侧视图（奔跑/正常移动）
            front: new Image(),    // 正面（向下移动）
            back: new Image(),     // 背面（向上移动）
            attack: new Image(),   // 攻击动画（8帧撕咬）
            pacing: new Image(),   // 踱步动画（慢速移动）
            idle: new Image(),     // 眩晕/待机动画（单张）
        };
        this._sprites.side.src = 'assets/enemies/black_wolf.png';
        this._sprites.front.src = 'assets/enemies/black_wolf_updown.png';
        this._sprites.back.src = 'assets/enemies/black_wolf_updown.png';
        this._sprites.attack.src = 'assets/enemies/black_wolf_attack.png';
        this._sprites.pacing.src = 'assets/enemies/black_wolf_pacing.png';
        this._sprites.idle.src = 'assets/enemies/black_wolf_idle.png';
        
        // 当前 facing 方向
        this._facing = 'right'; // right, left, up, down
        this._lastHorizontalFacing = 'right'; // 供垂直移动/idle时保持水平朝向
        
        // 动画状态
        this._animState = 'idle'; // idle, walk, run, attack, pacing
        this._attackTimer = 0;
        this._attackDuration = 1600; // 攻击动画总时长(ms)，匹配 8帧 × 200ms/帧
        this._attackDashOffset = 0; // 攻击冲刺位移
        this._dashDistance = config.dashDistance || 200; // 从配置读取突进距离
        // 帧动画
        this._animFrame = 0;
        this._animTimer = 0;
        this._frameW = 250;
        this._frameH = 215;
        this._cols = 4;
        this._rows = 2;
        // 帧率配置 (ms/帧)
        this._frameDurations = {
            idle: 200,
            walk: 120,
            run: 80,
            attack: 100,
            pacing: 160
        };
        // 动画速度阈值
        this._speedThresholds = {
            run: 1.2,
            walk: 0.1
        };

        // ===== AI 状态机 =====
        this._aiState = 'pacing'; // pacing, chasing, lost
        this._pacingOrigin = { x: x, y: y }; // 踱步中心点
        this._pacingTarget = { x: x, y: y }; // 当前踱步目标
        this._pacingTimer = 0;       // 踱步目标切换计时
        this._pacingInterval = 1000 + Math.random() * 1000; // 1-2s 切换一次
        this._aggroRange = config.ai?.aggroRange || enemyConfigData.blackWolf?.ai?.aggroRange || 800;
        this._pacingRange = config.ai?.pacingRange || enemyConfigData.blackWolf?.ai?.pacingRange || 200;
        this._loseTimeout = config.ai?.loseTimeout || enemyConfigData.blackWolf?.ai?.loseTimeout || 2000;
        this._lostTimer = 0;         // 丢失目标计时
        this._aiScanTimer = 0;       // 索敌扫描计时
        this._aiScanInterval = 200;  // 200ms 扫描一次
        this._lastKnownTargetPos = null; // 最后已知目标位置
    }

    update(dt, entities) {
        super.update(dt, entities);
        
        // === AI 扫描与状态切换 ===
        this._aiScanTimer += dt;
        if (this._aiScanTimer >= this._aiScanInterval) {
            this._aiScanTimer = 0;
            this._updateAIState(dt, entities);
        }
        // 执行当前 AI 状态（设置 target / _tacticalTarget / maxSpeed）
        this._executeAI(dt, entities);
        
        // === 根据主导速度方向确定 facing（攻击期间锁定）===
        if (this._attackTimer <= 0) {
            const absVx = Math.abs(this.vx);
            const absVy = Math.abs(this.vy);
            const threshold = 0.5;
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
                if (progress < 0.125) {
                    this._attackDashOffset = this._dashDistance * (progress / 0.125);
                } else {
                    this._attackDashOffset = this._dashDistance;
                }
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

    // ===== AI 状态机：扫描与状态切换 =====
    _updateAIState(dt, entities) {
        // 寻找最近玩家
        let nearestPlayer = null;
        let nearestDist = Infinity;
        const arr = entities.values ? Array.from(entities.values()) : entities;
        for (const e of arr) {
            if (e && e._faction === 'player' && e.active) {
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < nearestDist) {
                    nearestDist = d;
                    nearestPlayer = e;
                }
            }
        }

        switch (this._aiState) {
            case 'pacing':
                if (nearestPlayer && nearestDist <= this._aggroRange) {
                    this._aiState = 'chasing';
                    this.target = nearestPlayer;
                    this._lostTimer = 0;
                    this._lastKnownTargetPos = { x: nearestPlayer.x, y: nearestPlayer.y };
                    // 清除踱步战术目标，让 MovementSystem 跟随 target
                    this._tacticalTarget = null;
                }
                break;

            case 'chasing':
                if (nearestPlayer && nearestDist <= this._aggroRange) {
                    // 目标仍在范围内，更新目标
                    this.target = nearestPlayer;
                    this._lastKnownTargetPos = { x: nearestPlayer.x, y: nearestPlayer.y };
                    this._lostTimer = 0;
                } else {
                    // 目标跑出范围，开始丢失计时
                    this._lostTimer += this._aiScanInterval;
                    if (this._lostTimer >= this._loseTimeout) {
                        // 持续2s超出范围，放弃追击，回踱步
                        this._aiState = 'pacing';
                        this.target = null;
                        this._lastKnownTargetPos = null;
                        this._pacingOrigin = { x: this.x, y: this.y };
                        this._lostTimer = 0;
                        this._pacingTimer = 0;
                        this._pacingInterval = 1000 + Math.random() * 1000;
                    }
                }
                break;
        }
    }

    // ===== AI 执行：设置目标与速度 =====
    _executeAI(dt, entities) {
        switch (this._aiState) {
            case 'pacing': {
                // 踱步速度 = 正常 1/2
                this.maxSpeed = this._baseSpeed * 0.5;
                // 更新踱步目标
                this._pacingTimer += dt;
                if (this._pacingTimer >= this._pacingInterval) {
                    this._pacingTimer = 0;
                    this._pacingInterval = 1000 + Math.random() * 1000;
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * this._pacingRange;
                    this._pacingTarget = {
                        x: this._pacingOrigin.x + Math.cos(angle) * dist,
                        y: this._pacingOrigin.y + Math.sin(angle) * dist
                    };
                }
                // 设置战术目标，让 MovementSystem 读取
                this._tacticalTarget = this._pacingTarget;
                // 清除追击相关状态
                this.target = null;
                this._lastKnownTargetPos = null;
                break;
            }

            case 'chasing': {
                // 正常奔跑速度
                this.maxSpeed = this._baseSpeed;
                // 清除战术目标，让 MovementSystem 读取 this.target
                this._tacticalTarget = null;
                break;
            }
        }
    }

    triggerWeaponAnim() {
        super.triggerWeaponAnim();
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackDuration;
        this._animFrame = 0;
        this._animTimer = 0;
        this._attackDashOffset = 0;
        
        // 精确朝向目标冲刺
        if (this.target && this.target.active) {
            const targetX = this.target.x;
            const targetY = this.target.y;
            this._dashAngle = Math.atan2(targetY - this.y, targetX - this.x);
            // 冲刺距离 = 到目标距离（精确到目标位置）
            this._dashDistance = Math.sqrt((targetX - this.x)**2 + (targetY - this.y)**2);
            // 更新面向以匹配冲刺角度
            const absCos = Math.abs(Math.cos(this._dashAngle));
            const absSin = Math.abs(Math.sin(this._dashAngle));
            if (absSin > absCos) {
                this._dashStartFacing = Math.sin(this._dashAngle) > 0 ? 'down' : 'up';
            } else {
                this._dashStartFacing = Math.cos(this._dashAngle) > 0 ? 'right' : 'left';
            }
            this._facing = this._dashStartFacing;
            this._facingDir = this._dashStartFacing;
        } else {
            // 无目标：fallback 到当前面向
            this._dashAngle = this._facingToAngle(this._facing);
        }
        
        // 预判：检查冲刺路线是否通畅，如果被墙阻挡则原地攻击
        const dx = Math.cos(this._dashAngle) * this._dashDistance;
        const dy = Math.sin(this._dashAngle) * this._dashDistance;
        if (typeof WallSystem !== 'undefined' && WallSystem.blocked) {
            this._dashBlocked = WallSystem.blocked(this.x, this.y, this.x + dx, this.y + dy);
        } else {
            this._dashBlocked = false;
        }
    }
    
    _getDashOffset() {
        if (this._attackDashOffset <= 0) return { x: 0, y: 0 };
        if (this._dashAngle !== undefined) {
            return {
                x: Math.cos(this._dashAngle) * this._attackDashOffset,
                y: Math.sin(this._dashAngle) * this._attackDashOffset
            };
        }
        // fallback: 4方向
        switch (this._dashStartFacing) {
            case 'right': return { x: this._attackDashOffset, y: 0 };
            case 'left':  return { x: -this._attackDashOffset, y: 0 };
            case 'down':  return { x: 0, y: this._attackDashOffset };
            case 'up':    return { x: 0, y: -this._attackDashOffset };
            default:      return { x: 0, y: 0 };
        }
    }
    _facingToAngle(facing) {
        switch (facing) {
            case 'right': return 0;
            case 'left':  return Math.PI;
            case 'down':  return Math.PI / 2;
            case 'up':    return -Math.PI / 2;
            default:      return 0;
        }
    }

    _getDashWorldPos() {
        const offset = this._getDashOffset();
        return { x: this.x + offset.x, y: this.y + offset.y };
    }

    renderHealthBar(ctx) {
        if (this.hp >= this.maxHp) return;
        const worldPos = this._getDashWorldPos();
        const screenPos = Renderer.worldToScreen(worldPos.x, worldPos.y);
        const barWidth = 28, barHeight = 4, border = 1;
        const x = screenPos.x - barWidth / 2, y = screenPos.y - this.size - 30;
        const hpPercent = this.hp / this.maxHp;
        ctx.fillStyle = '#1a0a0a';
        ctx.fillRect(x - border, y - border, barWidth + border * 2, barHeight + border * 2);
        ctx.fillStyle = '#5a1010';
        ctx.fillRect(x, y, barWidth, barHeight);
        ctx.fillStyle = hpPercent > 0.5 ? '#c04040' : hpPercent > 0.25 ? '#a03030' : '#8a1a1a';
        ctx.fillRect(x, y, barWidth * hpPercent, barHeight);
    }

    renderCollisionRadius(ctx) {
        if (this.hitbox) {
            this.hitbox.renderDebug(ctx);
            return;
        }
        const radius = this.collisionRadius || this.size * 0.6 || 10;
        const worldPos = this._getDashWorldPos();
        const screenPos = Renderer.worldToScreen(worldPos.x, worldPos.y);
        ctx.save();
        ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    _getRenderPosition() {
        const offset = this._getDashOffset();
        return Renderer.worldToScreen(this.x + offset.x, this.y + offset.y);
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

        return {
            spriteSize: 151,
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
        let bounceY = 0; let scaleX = 1, scaleY = 1; let leanAngle = 0; let swayX = 0;
        const t = this.animTime;
        if (this._animState === 'attack') {
            const progress = 1 - Math.max(0, this._attackTimer) / 300;
            const scale = 1 + Math.sin(progress * Math.PI) * 0.15;
            scaleX = scale; scaleY = scale;
            bounceY = -Math.sin(progress * Math.PI) * 5;
            leanAngle = 0.1;
        } else if (this._animState === 'run') {
            const runPhase = t * 2;
            bounceY = Math.sin(runPhase) * 4;
            leanAngle = Math.sin(runPhase) * 0.12;
            swayX = Math.sin(runPhase + Math.PI / 4) * 2;
            const stretch = Math.sin(runPhase * 2) * 0.015;
            scaleX = 1 + stretch; scaleY = 1 - stretch * 0.3;
        } else if (this._animState === 'walk' || this._animState === 'pacing') {
            bounceY = Math.sin(t) * 2;
        }
        
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
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, -76, -76, 151, 151);
                ctx.restore();
            } else {
                // 正常帧动画
                const frameW = currentSprite.naturalWidth / this._cols;
                const frameH = currentSprite.naturalHeight / this._rows;
                const col = this._animFrame % this._cols;
                const row = Math.floor(this._animFrame / this._cols);
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, col * frameW, row * frameH, frameW, frameH, -76, -76, 151, 151);
                ctx.restore();
            }
        } else {
            super._drawBody(ctx);
        }
    }

    _drawShadow(ctx, x, y, size) {
        // 阴影绑定碰撞体积位置：使用碰撞半径，随冲刺同步
        const r = this.collisionRadius || size;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.5 + 15, r, r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

export { BlackWolf };

class RedWolfKing extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.redWolfKing,
            ...config
        });
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
        this._sprites.side.src = 'assets/enemies/red_wolf_king_run.png';
        this._sprites.front.src = 'assets/enemies/red_wolf_king_run.png';
        this._sprites.back.src = 'assets/enemies/red_wolf_king_run.png';
        this._sprites.attack.src = 'assets/enemies/red_wolf_king_attack.png';
        this._sprites.pacing.src = 'assets/enemies/red_wolf_king_pacing.png';
        this._sprites.idle.src = 'assets/enemies/red_wolf_king_idle.png';
        this._sprites.transform.src = 'assets/enemies/red_wolf_king_change.png';
        this._sprites.howl.src = 'assets/enemies/red_wolf_king_howl.png';
        this._sprites.transformedIdle.src = 'assets/enemies/red_wolf_king_changed_idle.png';
        this._sprites.transformedRun.src = 'assets/enemies/red_wolf_king_changed_run.png';
        
        // 当前 facing 方向
        this._facing = 'right';
        this._lastHorizontalFacing = 'right'; // 供垂直移动/idle时保持水平朝向
        
        // ===== 变身系统 =====
        const transformConfig = enemyConfigData.redWolfKing?.transform || {};
        this._transformHpThreshold = transformConfig.hpThreshold || 0.5;
        this._transformDuration = transformConfig.duration || 2000;
        this._howlDuration = transformConfig.howlDuration || 2000;
        this._transformDamageMultiplier = transformConfig.damageMultiplier || 2;
        this._transformHpRecover = transformConfig.hpRecover !== undefined ? transformConfig.hpRecover : 1;
        this._isTransformed = false;      // 是否已完成变身
        this._isTransforming = false;     // 是否正在变身动画中
        this._isHowling = false;          // 是否正在嚎叫动画中
        this._transformTimer = 0;         // 变身动画计时器
        this._howlTimer = 0;              // 嚎叫动画计时器
        this._transformTriggered = false; // 变身是否已触发过（只触发一次）
        
        // 动画状态
        this._animState = 'idle';
        this._attackTimer = 0;
        this._attackDuration = 800;
        this._attackDashOffset = 0;
        this._dashDistance = config.dashDistance || 200; // 从配置读取突进距离（默认200px）
        // 帧动画
        this._animFrame = 0;
        this._animTimer = 0;
        this._frameW = 250;
        this._frameH = 215;
        this._cols = 4;
        this._rows = 2;
        // 帧率配置（减慢50%：即时长翻倍）
        this._frameDurations = {
            idle: 400,
            walk: 240,
            run: 160,
            attack: 100, // 等比例缩减：8帧 × 100ms = 800ms
            pacing: 320
        };
        // 动画速度阈值
        this._speedThresholds = {
            run: 1.2,
            walk: 0.1
        };

        // ===== AI 状态机 =====
        this._aiState = 'pacing';
        this._pacingOrigin = { x: x, y: y };
        this._pacingTarget = { x: x, y: y };
        this._pacingTimer = 0;
        this._pacingInterval = 1000 + Math.random() * 1000;
        this._aggroRange = config.ai?.aggroRange || enemyConfigData.redWolfKing?.ai?.aggroRange || 1200;
        this._pacingRange = config.ai?.pacingRange || enemyConfigData.redWolfKing?.ai?.pacingRange || 300;
        this._loseTimeout = config.ai?.loseTimeout || enemyConfigData.redWolfKing?.ai?.loseTimeout || 2000;
        this._lostTimer = 0;
        this._aiScanTimer = 0;
        this._aiScanInterval = 200;
        this._lastKnownTargetPos = null;
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
            console.log(`[${this.name}] 开始变身！`);
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
                console.log(`[${this.name}] 变身动画完成，开始嚎叫！`);
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
                this._sprites.side.src = 'assets/enemies/red_wolf_king_changed_run.png';
                this._sprites.front.src = 'assets/enemies/red_wolf_king_changed_run.png';
                this._sprites.back.src = 'assets/enemies/red_wolf_king_changed_run.png';
                this._sprites.idle.src = 'assets/enemies/red_wolf_king_changed_idle.png';
                // 变身后动画状态重置
                this._animState = 'idle';
                this._animFrame = 0;
                this._animTimer = 0;
                console.log(`[${this.name}] 嚎叫完成！HP恢复，攻击力翻倍！`);
            }
            // 嚎叫期间不执行正常 update
            return;
        }
        
        super.update(dt, entities);
        
        // === AI 扫描与状态切换 ===
        this._aiScanTimer += dt;
        if (this._aiScanTimer >= this._aiScanInterval) {
            this._aiScanTimer = 0;
            this._updateAIState(dt, entities);
        }
        this._executeAI(dt, entities);
        
        // === 根据主导速度方向确定 facing（攻击期间锁定）===
        if (this._attackTimer <= 0) {
            const absVx = Math.abs(this.vx);
            const absVy = Math.abs(this.vy);
            const threshold = 0.5;
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
        if (this._attackTimer > 0) {
            this._animState = 'attack';
        } else if (this._aiState === 'pacing') {
            this._animState = 'pacing';
        } else if (this._animState === 'run' ? speed > 0.8 : speed > this._speedThresholds.run) {
            this._animState = 'run';
        } else if (this._animState === 'idle' ? speed > this._speedThresholds.walk : speed > 0.05) {
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
                // 0-200ms准备（帧0-1），不冲刺
                if (progress < 0.25) {
                    this._attackDashOffset = 0;
                } else if (progress < 0.5) {
                    // 200-400ms加速（帧2-3），200ms内加速到最大
                    const dashProgress = (progress - 0.25) / 0.25;
                    this._attackDashOffset = this._dashDistance * dashProgress;
                } else {
                    // 400ms后最大冲刺（帧4起）
                    this._attackDashOffset = this._dashDistance;
                }
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

    // ===== AI 状态机：扫描与状态切换 =====
    _updateAIState(dt, entities) {
        let nearestPlayer = null;
        let nearestDist = Infinity;
        const arr = entities.values ? Array.from(entities.values()) : entities;
        for (const e of arr) {
            if (e && e._faction === 'player' && e.active) {
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < nearestDist) {
                    nearestDist = d;
                    nearestPlayer = e;
                }
            }
        }

        switch (this._aiState) {
            case 'pacing':
                if (nearestPlayer && nearestDist <= this._aggroRange) {
                    this._aiState = 'chasing';
                    this.target = nearestPlayer;
                    this._lostTimer = 0;
                    this._lastKnownTargetPos = { x: nearestPlayer.x, y: nearestPlayer.y };
                    this._tacticalTarget = null;
                }
                break;

            case 'chasing':
                if (nearestPlayer && nearestDist <= this._aggroRange) {
                    this.target = nearestPlayer;
                    this._lastKnownTargetPos = { x: nearestPlayer.x, y: nearestPlayer.y };
                    this._lostTimer = 0;
                } else {
                    this._lostTimer += this._aiScanInterval;
                    if (this._lostTimer >= this._loseTimeout) {
                        this._aiState = 'pacing';
                        this.target = null;
                        this._lastKnownTargetPos = null;
                        this._pacingOrigin = { x: this.x, y: this.y };
                        this._lostTimer = 0;
                        this._pacingTimer = 0;
                        this._pacingInterval = 1000 + Math.random() * 1000;
                    }
                }
                break;
        }
    }

    // ===== AI 执行：设置目标与速度 =====
    _executeAI(dt, entities) {
        switch (this._aiState) {
            case 'pacing': {
                this.maxSpeed = this._baseSpeed * 0.5;
                this._pacingTimer += dt;
                if (this._pacingTimer >= this._pacingInterval) {
                    this._pacingTimer = 0;
                    this._pacingInterval = 1000 + Math.random() * 1000;
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * this._pacingRange;
                    this._pacingTarget = {
                        x: this._pacingOrigin.x + Math.cos(angle) * dist,
                        y: this._pacingOrigin.y + Math.sin(angle) * dist
                    };
                }
                this._tacticalTarget = this._pacingTarget;
                this.target = null;
                this._lastKnownTargetPos = null;
                break;
            }

            case 'chasing': {
                this.maxSpeed = this._baseSpeed;
                this._tacticalTarget = null;
                break;
            }
        }
    }

    triggerWeaponAnim() {
        // 变身/嚎叫期间禁止攻击
        if (this._isTransforming || this._isHowling) return;
        super.triggerWeaponAnim();
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackDuration;
        this._animFrame = 0;
        this._animTimer = 0;
        this._attackDashOffset = 0;
        
        if (this.target && this.target.active) {
            const targetX = this.target.x;
            const targetY = this.target.y;
            this._dashAngle = Math.atan2(targetY - this.y, targetX - this.x);
            this._dashDistance = Math.sqrt((targetX - this.x)**2 + (targetY - this.y)**2);
            const absCos = Math.abs(Math.cos(this._dashAngle));
            const absSin = Math.abs(Math.sin(this._dashAngle));
            if (absSin > absCos) {
                this._dashStartFacing = Math.sin(this._dashAngle) > 0 ? 'down' : 'up';
            } else {
                this._dashStartFacing = Math.cos(this._dashAngle) > 0 ? 'right' : 'left';
            }
            this._facing = this._dashStartFacing;
            this._facingDir = this._dashStartFacing;
        } else {
            this._dashAngle = this._facingToAngle(this._facing);
        }
        
        const dx = Math.cos(this._dashAngle) * this._dashDistance;
        const dy = Math.sin(this._dashAngle) * this._dashDistance;
        if (typeof WallSystem !== 'undefined' && WallSystem.blocked) {
            this._dashBlocked = WallSystem.blocked(this.x, this.y, this.x + dx, this.y + dy);
        } else {
            this._dashBlocked = false;
        }
    }
    
    _getDashOffset() {
        if (this._attackDashOffset <= 0) return { x: 0, y: 0 };
        if (this._dashAngle !== undefined) {
            return {
                x: Math.cos(this._dashAngle) * this._attackDashOffset,
                y: Math.sin(this._dashAngle) * this._attackDashOffset
            };
        }
        switch (this._dashStartFacing || this._facing) {
            case 'right': return { x: this._attackDashOffset, y: 0 };
            case 'left':  return { x: -this._attackDashOffset, y: 0 };
            case 'down':  return { x: 0, y: this._attackDashOffset };
            case 'up':    return { x: 0, y: -this._attackDashOffset };
            default:      return { x: 0, y: 0 };
        }
    }
    _facingToAngle(facing) {
        switch (facing) {
            case 'right': return 0;
            case 'left':  return Math.PI;
            case 'down':  return Math.PI / 2;
            case 'up':    return -Math.PI / 2;
            default:      return 0;
        }
    }

    _getDashWorldPos() {
        const offset = this._getDashOffset();
        return { x: this.x + offset.x, y: this.y + offset.y };
    }

    renderHealthBar(ctx) {
        if (this.hp >= this.maxHp) return;
        const worldPos = this._getDashWorldPos();
        const screenPos = Renderer.worldToScreen(worldPos.x, worldPos.y);
        const barWidth = 28, barHeight = 4, border = 1;
        const x = screenPos.x - barWidth / 2, y = screenPos.y - this.size - 30;
        const hpPercent = this.hp / this.maxHp;
        ctx.fillStyle = '#1a0a0a';
        ctx.fillRect(x - border, y - border, barWidth + border * 2, barHeight + border * 2);
        ctx.fillStyle = '#5a1010';
        ctx.fillRect(x, y, barWidth, barHeight);
        ctx.fillStyle = hpPercent > 0.5 ? '#c04040' : hpPercent > 0.25 ? '#a03030' : '#8a1a1a';
        ctx.fillRect(x, y, barWidth * hpPercent, barHeight);
    }

    renderCollisionRadius(ctx) {
        if (this.hitbox) {
            this.hitbox.renderDebug(ctx);
            return;
        }
        const radius = this.collisionRadius || this.size * 0.6 || 10;
        const worldPos = this._getDashWorldPos();
        const screenPos = Renderer.worldToScreen(worldPos.x, worldPos.y);
        ctx.save();
        ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    _getRenderPosition() {
        const offset = this._getDashOffset();
        return Renderer.worldToScreen(this.x + offset.x, this.y + offset.y);
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
        // 最后2帧（帧6、7）额外补偿
        if (this._isHowling) {
            offsetY -= 16;
            if (this._animFrame >= 6) {
                offsetY -= (this._animFrame === 6 ? 12 : 4);
            }
        }

        return {
            spriteSize: 151,
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
        let bounceY = 0; let scaleX = 1, scaleY = 1; let leanAngle = 0; let swayX = 0;
        const t = this.animTime;
        if (this._animState === 'attack') {
            const progress = 1 - Math.max(0, this._attackTimer) / 300;
            const scale = 1 + Math.sin(progress * Math.PI) * 0.15;
            scaleX = scale; scaleY = scale;
            bounceY = -Math.sin(progress * Math.PI) * 5;
            leanAngle = 0.1;
        } else if (this._animState === 'run') {
            const runPhase = t * 2;
            // 变身后去掉上下弹跳，避免精灵图抖动（保留左右摇摆和拉伸效果）
            if (!this._isTransformed) {
                bounceY = Math.sin(runPhase) * 4;
            }
            leanAngle = Math.sin(runPhase) * 0.12;
            swayX = Math.sin(runPhase + Math.PI / 4) * 2;
            const stretch = Math.sin(runPhase * 2) * 0.015;
            scaleX = 1 + stretch; scaleY = 1 - stretch * 0.3;
        } else if (this._animState === 'walk' || this._animState === 'pacing') {
            if (!this._isTransformed) {
                bounceY = Math.sin(t) * 2;
            }
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
                let howlOffsetY = this._isHowling ? -16 : 0;
                if (this._isHowling && this._animFrame >= 6) {
                    howlOffsetY -= (this._animFrame === 6 ? 12 : 4);
                }
                ctx.drawImage(currentSprite, col * frameW, row * frameH, frameW, frameH, -76, -76 + howlOffsetY, 151, 151);
                ctx.restore();
            } else if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, -76, -76, 151, 151);
                ctx.restore();
            } else {
                // 变身后精灵图布局：idle 1x4, run 1x16, attack 4x2
                let cols, rows;
                if (this._isTransformed) {
                    if (this._animState === 'idle') {
                        cols = 4; rows = 1;
                    } else if (this._animState === 'attack') {
                        cols = 4; rows = 2;
                    } else {
                        cols = 16; rows = 1;
                    }
                } else {
                    cols = this._cols; rows = this._rows;
                }
                const frameW = currentSprite.naturalWidth / cols;
                const frameH = currentSprite.naturalHeight / rows;
                const col = this._animFrame % cols;
                const row = Math.floor(this._animFrame / cols);
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, col * frameW, row * frameH, frameW, frameH, -76, -76, 151, 151);
                ctx.restore();
            }
        } else {
            super._drawBody(ctx);
        }
    }

    _drawShadow(ctx, x, y, size) {
        const r = this.collisionRadius || size;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.5 + 15, r, r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

export { RedWolfKing };
