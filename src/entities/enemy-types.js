import { WallSystem } from '../world/wall-system.js';
import { Enemy } from './enemy.js';

import enemyConfigData from '../../data/enemy-config.json';
import { ANIMATION_CONFIG } from '../config/animation-config.js';
import { loadImage } from '../utils/image-loader.js';
import { ZombieWizard } from './enemy-types/zombie-wizard.js';
import { Mutant3 } from './enemy-types/mutant-3.js';
import { SpitterZombie } from './enemy-types/spitter-zombie.js';
import { FatZombie } from './enemy-types/fat-zombie.js';
import { Zombie } from './enemy-types/zombie.js';
import { AmalgamZombie } from './enemy-types/amalgam-zombie.js';
import { ArmoredKnight } from './enemy-types/armored-knight.js';
import { Shounao } from './enemy-types/shounao.js';
import { FlySwarm } from './enemy-types/fly-swarm.js';
import { FlyHand } from './enemy-types/fly-hand.js';
import { TimeAgentAssault } from './enemy-types/time-agent-assault.js';
import { TimeAgentShield } from './enemy-types/time-agent-shield.js';
import { PoisonMaggot } from './enemy-types/poison-maggot.js';
import { MinerZombie } from './enemy-types/miner-zombie.js';
import { LanternMinerZombie } from './enemy-types/lantern-miner-zombie.js';
import { ForemanZombie } from './enemy-types/foreman-zombie.js';
import { MineCave } from './enemy-types/mine-cave.js';
import { Tombstone } from './enemy-types/tombstone.js';
import { OreSpider } from './enemy-types/ore-spider.js';
import { Witch } from './enemy-types/witch.js';
import { Cauldron } from './enemy-types/cauldron.js';

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
            side: loadImage(spritePaths.side || 'assets/enemies/black_wolf_walk.png'),
            walk: loadImage(spritePaths.walk || 'assets/enemies/black_wolf_walk.png'),
            run: loadImage(spritePaths.run || 'assets/enemies/black_wolf_run.png'),
            front: loadImage(spritePaths.front || 'assets/enemies/black_wolf_updown.png'),
            back: loadImage(spritePaths.back || 'assets/enemies/black_wolf_updown.png'),
            attack: loadImage(spritePaths.attack || 'assets/enemies/black_wolf_bite.png'),
            bite: loadImage(spritePaths.bite || 'assets/enemies/black_wolf_bite.png'),
            pounce: loadImage(spritePaths.pounce || 'assets/enemies/black_wolf_pounce.png'),
            pacing: loadImage(spritePaths.pacing || 'assets/enemies/black_wolf_pacing.png'),
            idle: loadImage(spritePaths.idle || 'assets/enemies/black_wolf_idle.png')
        };
        
        // 当前 facing 方向
        this._facing = 'right'; // right, left, up, down
        this._lastHorizontalFacing = 'right'; // 供垂直移动/idle时保持水平朝向
        
        // 动画状态
        this._animState = 'idle'; // idle, walk, run, attack, pacing
        this._attackDuration = anim.attackDuration ?? 1600; // 攻击动画总时长(ms)
        this._attackTypes = anim.attackTypes || {}; // 双攻击：bite(撕咬) / pounce(飞扑)
        this._attackType = 'bite'; // 当前攻击类型
        this._dashDistance = config.dashDistance || 200; // 从配置读取突进距离
        // 帧动画
        const frameLayout = anim.frameLayout || {};
        this._frameW = frameLayout.width ?? 512;
        this._frameH = frameLayout.height ?? 512;
        this._cols = frameLayout.cols ?? 4;
        this._rows = frameLayout.rows ?? 4;
        this._frameLayouts = anim.frameLayouts || {};
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
                if (WallSystem && WallSystem.resolve) {
                    const resolved = WallSystem.resolve(this.x, this.y, targetX, targetY, this.groundRadius);
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
        const durKey = this._animState === 'attack' ? (this._attackType || 'bite') : this._animState;
        const frameDuration = this._frameDurations[durKey] || this._frameDurations[this._animState] || 150;
        if (this._animTimer >= frameDuration) {
            this._animTimer = 0;
            this._animFrame = (this._animFrame + 1) % this._getStateFrameCount();
        }
    }

    triggerWeaponAnim() {
        if (this._attackTimer > 0) return;
        // 双攻击：近距离撕咬 / 中距离飞扑（按攻击时与目标的距离选择）
        let type = 'bite';
        if (this.target && this.target.active) {
            const d = Math.hypot(this.target.x - this.x, this.target.y - this.y);
            const biteRange = this._attackTypes?.bite?.range ?? 170;
            if (d > biteRange) type = 'pounce';
        }
        this._attackType = type;
        const atk = this._attackTypes?.[type] || {};
        if (atk.duration) this._attackDuration = atk.duration;
        super.triggerWeaponAnim();
        // 按攻击类型限制冲刺距离（bite 短扑、pounce 大跳）
        const dashCap = atk.dash ?? (type === 'bite' ? 60 : 240);
        if (this._dashDistance > dashCap) this._dashDistance = dashCap;
    }

    _getTextureKey() {
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            return 'enemy_black_wolf_idle';
        }
        if (this._animState === 'attack') {
            return this._attackType === 'pounce' ? 'enemy_black_wolf_pounce' : 'enemy_black_wolf_bite';
        }
        if (this._animState === 'pacing') {
            return 'enemy_black_wolf_walk';
        }
        if (this._animState === 'run') {
            return 'enemy_black_wolf_run';
        }
        if (this._animState === 'idle') {
            return 'enemy_black_wolf_idle';
        }
        return 'enemy_black_wolf_walk';
    }

    // 当前状态（含攻击子类型）的精灵图网格与帧数
    _getFrameLayout(state) {
        const layouts = this._frameLayouts || {};
        const key = state === 'attack' ? (this._attackType || 'bite') : state;
        return layouts[key] || layouts.walk || { cols: 4, rows: 4 };
    }

    _getStateFrameCount() {
        const layouts = this._frameLayouts || {};
        if (this._animState === 'attack') {
            return layouts[this._attackType]?.frames || (this._attackType === 'pounce' ? 11 : 8);
        }
        return layouts[this._animState]?.frames || (this._animState === 'run' ? 14 : (this._animState === 'walk' ? 16 : 8));
    }

    _getPhaserOptions() {
        let flipX;
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
        let staticImage = false;
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            // 眩晕状态：显示 idle 图片（被弹反后）
            currentSprite = this._sprites.idle;
            staticImage = true;
        } else if (this._animState === 'attack') {
            currentSprite = this._attackType === 'pounce'
                ? (this._sprites.pounce || this._sprites.attack)
                : (this._sprites.bite || this._sprites.attack);
        } else if (this._animState === 'pacing') {
            currentSprite = this._sprites.pacing;
        } else if (this._animState === 'run') {
            currentSprite = this._sprites.run || this._sprites.side;
        } else if (this._animState === 'idle') {
            currentSprite = this._sprites.idle;
            staticImage = true;
        } else {
            currentSprite = this._sprites.walk || this._sprites.side;
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
            if (staticImage) {
                // idle / 眩晕冻结图片：单张，直接绘制，缩放至 151x151
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
                const layout = this._getFrameLayout(this._animState);
                const frameW = currentSprite.naturalWidth / layout.cols;
                const frameH = currentSprite.naturalHeight / layout.rows;
                const col = this._animFrame % layout.cols;
                const row = Math.floor(this._animFrame / layout.cols);
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

    _drawShadow(ctx, x, y, _size) {
        // 阴影绑定碰撞体积位置：使用碰撞半径，随冲刺同步
        const r = this.groundRadius;
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

/**
 * 红狼王（elite，2026-08-06 贴图升级重建，H3 视频→精灵图管线）：
 * - 狼形态：idle / walk / run + 双攻击（飞扑挥爪 pounceClaw / 飞扑撕咬 pounceBite）+ 变身 transform；
 * - HP ≤ 阈值（默认 0.5）触发变身：2s transform 动画 → 红狼人形态（伤害 ×2、回血），
 *   变身完成先仰天嚎叫（howl）；
 * - 红狼人形态：idle / run / 挥爪攻击 attack / 嚎叫 howl；
 * - 动画走 Phaser setFrame 帧索引路径（同黑狼），贴图/网格由 animation-config redWolfKing 驱动。
 */
class RedWolfKing extends BlackWolf {
    constructor(x, y, config = {}) {
        super(x, y, { ...enemyConfigData.redWolfKing, ...config });
        this._animCfg = getAnimConfig('redWolfKing');
        const anim = this._animCfg.animation || {};
        const spritePaths = this._animCfg.sprites || {};
        const tPaths = this._animCfg.transformedSprites || {};
        // 狼形态贴图
        this._wolfSprites = {
            side: loadImage(spritePaths.side || 'assets/enemies/red_wolf_king_run.png'),
            walk: loadImage(spritePaths.walk || 'assets/enemies/red_wolf_king_pacing.png'),
            run: loadImage(spritePaths.run || 'assets/enemies/red_wolf_king_run.png'),
            attack: loadImage(spritePaths.attack || 'assets/enemies/red_wolf_king_attack.png'),
            pounceClaw: loadImage(spritePaths.pounceClaw || 'assets/enemies/red_wolf_king_pounce_claw.png'),
            pounceBite: loadImage(spritePaths.pounceBite || 'assets/enemies/red_wolf_king_pounce_bite.png'),
            pacing: loadImage(spritePaths.pacing || 'assets/enemies/red_wolf_king_pacing.png'),
            idle: loadImage(spritePaths.idle || 'assets/enemies/red_wolf_king_idle.png'),
            transform: loadImage(spritePaths.transform || 'assets/enemies/red_wolf_king_change.png'),
            howl: loadImage(spritePaths.howl || 'assets/enemies/red_wolf_king_howl.png'),
        };
        // 红狼人形态贴图
        this._humanSprites = {
            idle: loadImage(tPaths.idle || 'assets/enemies/red_wolf_king_transformed_idle.png'),
            run: loadImage(tPaths.run || tPaths.side || 'assets/enemies/red_wolf_king_changed_run.png'),
            attack: loadImage(tPaths.attack || 'assets/enemies/red_wolf_king_changed_attack.png'),
            howl: loadImage(tPaths.howl || 'assets/enemies/red_wolf_king_howl.png'),
        };
        this._sprites = this._wolfSprites;
        // 变身配置
        this._transformCfg = this._animCfg.transform || {};
        this._isTransforming = false;
        this._isTransformed = false;
        this._transformTriggered = false;
        this._transformTimer = 0;
        this._howlTimer = 0;
        // 狼形态双攻击（近咬 / 中距离飞扑挥爪）
        this._attackTypes = anim.attackTypes || {
            pounceClaw: { range: 210, duration: 1100, dash: 220 },
            pounceBite: { range: 170, duration: 1000, dash: 60 },
        };
        this._attackType = 'pounceBite';
    }

    update(dt, entities) {
        // 变身触发：HP 阈值
        if (!this._transformTriggered && this.maxHp > 0 && this.hp / this.maxHp <= (this._transformCfg.hpThreshold ?? 0.5)) {
            this._transformTriggered = true;
            this._isTransforming = true;
            this._transformTimer = this._transformCfg.duration ?? 2000;
        }
        if (this._isTransforming) {
            this.vx = 0;
            this.vy = 0;
            this._transformTimer -= dt;
            if (this._transformTimer <= 0) {
                this._isTransforming = false;
                this._isTransformed = true;
                this._applyTransform();
                this._howlTimer = this._transformCfg.howlDuration ?? 2000;
            }
        }
        if (this._howlTimer > 0) {
            this._howlTimer -= dt;
            this.vx = 0;
            this.vy = 0;
        }
        super.update(dt, entities);
        // 覆盖动画状态：变身/嚎叫期间锁定
        if (this._isTransforming) {
            this._animState = 'transform';
            this._animFrame = this._timerFrame(this._transformTimer, this._transformCfg.duration ?? 2000);
        } else if (this._howlTimer > 0) {
            this._animState = 'howl';
            this._animFrame = this._timerFrame(this._howlTimer, this._transformCfg.howlDuration ?? 2000);
        }
        // 红狼人形态切换贴图组
        this._sprites = this._isTransformed ? this._humanSprites : this._wolfSprites;
    }

    _timerFrame(remaining, total) {
        const n = this._getStateFrameCount();
        const progress = 1 - Math.max(0, remaining) / Math.max(1, total);
        return Math.max(0, Math.min(n - 1, Math.floor(progress * n)));
    }

    _applyTransform() {
        // 伤害 ×2（transform.damageMultiplier）
        const atk = this.attacks && this.attacks.melee;
        if (atk && atk.config && atk.config.damage) {
            const d = atk.config.damage;
            atk.config.damage = typeof d === 'object'
                ? { min: (d.min || 0) * 2, max: (d.max || 0) * 2 }
                : (typeof d === 'number' ? d * 2 : d);
        }
        // 回血（hpRecover 比例，1=回满）
        const recover = this._transformCfg.hpRecover ?? 0;
        if (recover && this.maxHp) {
            this.hp = Math.min(this.maxHp, this.hp + this.maxHp * recover);
        }
    }

    triggerWeaponAnim() {
        if (this._attackTimer > 0) return;
        let type = 'pounceBite';
        if (this.target && this.target.active) {
            const d = Math.hypot(this.target.x - this.x, this.target.y - this.y);
            const clawRange = this._attackTypes?.pounceClaw?.range ?? 210;
            if (d > clawRange) type = 'pounceClaw';
        }
        this._attackType = type;
        const atk = this._attackTypes?.[type] || {};
        if (atk.duration) this._attackDuration = atk.duration;
        super.triggerWeaponAnim();
        const dashCap = atk.dash ?? 220;
        if (this._dashDistance > dashCap) this._dashDistance = dashCap;
    }

    _getTextureKey() {
        const frozen = this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'));
        if (this._isTransforming) return 'enemy_red_wolf_king_change';
        if (this._isTransformed) {
            if (frozen) return 'enemy_red_wolf_king_transformed_idle';
            if (this._howlTimer > 0) return 'enemy_red_wolf_king_howl';
            if (this._animState === 'attack') return 'enemy_red_wolf_king_changed_attack';
            if (this._animState === 'run') return 'enemy_red_wolf_king_changed_run';
            return 'enemy_red_wolf_king_transformed_idle';
        }
        if (frozen) return 'enemy_red_wolf_king_idle';
        if (this._animState === 'attack') {
            return this._attackType === 'pounceClaw'
                ? 'enemy_red_wolf_king_pounce_claw'
                : 'enemy_red_wolf_king_pounce_bite';
        }
        if (this._animState === 'pacing') return 'enemy_red_wolf_king_pacing';
        if (this._animState === 'run') return 'enemy_red_wolf_king_run';
        if (this._animState === 'idle') return 'enemy_red_wolf_king_idle';
        return 'enemy_red_wolf_king_pacing';
    }

    _getFrameLayout(state) {
        const layouts = this._frameLayouts || {};
        if (this._isTransformed) {
            const tf = this._animCfg?.render?.transformedFrameLayout || {};
            const key = state === 'attack' ? 'attack' : state;
            return tf[key] || { cols: 4, rows: 2, frames: 8 };
        }
        if (this._animState === 'transform') return layouts.transform || { cols: 4, rows: 2, frames: 8 };
        if (this._animState === 'howl') return layouts.howl || { cols: 4, rows: 2, frames: 8 };
        if (this._animState === 'attack') {
            return layouts[this._attackType] || layouts.pounceBite || { cols: 4, rows: 2, frames: 8 };
        }
        return super._getFrameLayout(state);
    }

    _getStateFrameCount() {
        const layouts = this._frameLayouts || {};
        if (this._isTransformed) {
            const tf = this._animCfg?.render?.transformedFrameLayout || {};
            const key = this._animState === 'attack' ? 'attack' : this._animState;
            return (tf[key] && tf[key].frames) || (tf[key] && tf[key].cols * tf[key].rows) || 8;
        }
        if (this._animState === 'transform') return (layouts.transform && layouts.transform.frames) || 8;
        if (this._animState === 'howl') return (layouts.howl && layouts.howl.frames) || 8;
        if (this._animState === 'attack') {
            return (layouts[this._attackType] && layouts[this._attackType].frames) || 8;
        }
        return super._getStateFrameCount();
    }

    _drawBody(ctx) {
        if (this._isTransforming) {
            this._drawSheetFrame(ctx, this._wolfSprites.transform, this._frameLayouts.transform);
            return;
        }
        if (this._howlTimer > 0 && this._isTransformed) {
            this._drawSheetFrame(ctx, this._humanSprites.howl, this._frameLayouts.howl);
            return;
        }
        super._drawBody(ctx);
    }

    _drawSheetFrame(ctx, img, layout) {
        if (!img || !img.complete || !img.naturalWidth) return;
        const lay = layout || { cols: 4, rows: 2 };
        const frameW = img.naturalWidth / lay.cols;
        const frameH = img.naturalHeight / lay.rows;
        const col = this._animFrame % lay.cols;
        const row = Math.floor(this._animFrame / lay.cols);
        const renderCfg = this._animCfg?.render || {};
        const spriteSize = renderCfg.spriteSize ?? 151;
        const spriteOffset = renderCfg.spriteOffset ?? -76;
        ctx.drawImage(img, col * frameW, row * frameH, frameW, frameH, spriteOffset, spriteOffset, spriteSize, spriteSize);
    }
}

function hexToNumber(hex) {
    if (typeof hex === 'number') return hex;
    hex = hex.replace('#', '');
    return parseInt(hex, 16);
}

class CircleEnemy extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._circleColor = config.color || this._color || '#8a8a4a';
    }

    _getTextureKey() {
        return 'enemy_circle';
    }

    _getPhaserOptions() {
        return {
            spriteSize: (this.size || 14) * 4,
            textOffsetY: -(this.size || 14) - 10,
            tint: hexToNumber(this._circleColor)
        };
    }

    _drawBody(ctx) {
        ctx.save();
        ctx.fillStyle = this._circleColor;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class ZombieDogEnemy extends CircleEnemy {
    constructor(x, y, config = {}) {
        super(x, y, config);
        this._animState = 'idle';
        this._lastHorizontalFacing = 'right';
        // [FIX] 僵尸犬攻击动画时长，与 BootScene 中 zombie_dog_attack 动画匹配
        // 6 帧 @ 10fps = 600ms
        this._attackDuration = 600;
    }

    update(dt, entities) {
        super.update(dt, entities);
        // 递减攻击动画计时器；计时器归零后不再显示 attack 动画
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._attackTimer < 0) this._attackTimer = 0;
        }
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (this._attackTimer <= 0 && Math.abs(this.vx) >= 0.1) {
            this._lastHorizontalFacing = this.vx > 0 ? 'right' : 'left';
        }

        // [FIX] 动画状态优先级：攻击动画 > 奔跑追击 > 近距离调整位置 > 待机
        // 使用相对于 maxSpeed 的阈值，并加入滞后（hysteresis）与最小保持时间，
        // 避免在攻击范围边缘因摩擦导致 run/walk/idle 高频切换，使奔跑贴图看起来“卡住”。
        let nextState = this._animState;
        if (this._attackTimer > 0) {
            nextState = 'attack';
        } else {
            const maxSpd = this.maxSpeed || this.speed || 250;
            const runThreshold = maxSpd * 0.30;
            const walkThreshold = maxSpd * 0.05;
            // 滞后：从 run 降到 walk 需要速度低于 runThreshold 一定比例
            const runToWalkThreshold = runThreshold * 0.65;
            const walkToRunThreshold = runThreshold * 1.05;

            if (this._animState === 'run') {
                if (speed < runToWalkThreshold) nextState = speed < walkThreshold ? 'idle' : 'walk';
            } else if (this._animState === 'walk') {
                if (speed > walkToRunThreshold) nextState = 'run';
                else if (speed < walkThreshold * 0.6) nextState = 'idle';
            } else {
                // idle -> run/walk
                if (speed > walkToRunThreshold) nextState = 'run';
                else if (speed > walkThreshold) nextState = 'walk';
                else nextState = 'idle';
            }
        }

        // 状态变化时重置保持计时器；未变化时累计时间
        this._animStateTimer = (this._animStateTimer || 0) + dt;
        const minHoldTime = 80; // ms，防止每帧在阈值边缘抖动
        if (nextState !== this._animState) {
            if (this._animStateTimer >= minHoldTime) {
                this._animState = nextState;
                this._animStateTimer = 0;
            }
        }
    }

    /**
     * 僵尸犬攻击动画触发入口。
     * 只在 CombatSystem 真正触发攻击后调用；若当前仍处于上一段 attack 动画（600ms）中，
     * 则忽略重复触发，因此不会以 600ms 为周期循环播放攻击动画。
     */
    triggerWeaponAnim() {
        if (this._attackTimer > 0) return;
        super.triggerWeaponAnim();
        this._attackTimer = this._attackDuration || 600;
        this._animFrame = 0;
        this._animTimer = 0;
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'attack': return 'enemy_zombie_dog_attack';
            case 'run':    return 'enemy_zombie_dog_run';
            case 'walk':   return 'enemy_zombie_dog_walk';
            default:       return 'enemy_zombie_dog_idle';
        }
    }

    _getPhaserOptions() {
        const spriteSize = 90;
        return {
            spriteSize,
            textOffsetY: -spriteSize / 2 - 10,
            flipX: this._lastHorizontalFacing === 'left',
            animState: this._animState
        };
    }
}

export { BlackWolf, RedWolfKing, CircleEnemy, ZombieDogEnemy, ZombieWizard, Mutant3, SpitterZombie, FatZombie, Zombie, AmalgamZombie, ArmoredKnight, Shounao, FlySwarm, FlyHand, TimeAgentAssault, TimeAgentShield, PoisonMaggot, MinerZombie, LanternMinerZombie, ForemanZombie, MineCave, Tombstone, OreSpider, Witch, Cauldron };
