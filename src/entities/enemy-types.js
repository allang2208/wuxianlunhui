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
            pounce: loadImage(spritePaths.pounce || 'assets/enemies/black_wolf_pounce.png'),
            pacing: loadImage(spritePaths.pacing || 'assets/enemies/black_wolf_pacing.png'),
            idle: loadImage(spritePaths.idle || 'assets/enemies/black_wolf_idle.png')
        };
        
        // 当前 facing 方向
        this._facing = 'right'; // right, left, up, down
        this._lastHorizontalFacing = 'right'; // 供垂直移动/idle时保持水平朝向
        
        // 动画状态
        this._animState = 'idle'; // idle, walk, run, attack, pacing
        this._attackTypes = anim.attackTypes || {}; // 飞扑：prepare + charge 阶段（参照 mutant-3）
        this._attackType = 'pounce'; // 只保留飞扑一种攻击
        // 飞扑状态机（参照 mutant-3：idle → prepare 蓄力 → charge 冲锋）
        this._pounceState = 'idle'; // idle | prepare | charge
        this._pounceAnimPhase = null; // null | prepare | charge
        this._pounceTimer = 0;
        this._pounceCooldown = 0;
        this._pounceTarget = null;
        this._pounceTargetPos = null;
        this._pounceDir = { x: 0, y: 0 };
        this._pounceSpeed = 0;
        this._pounceDamaged = false;
        this._pounceGhostTimer = 0;
        // 只保留飞扑：关闭通用 CombatSystem 攻击决策，飞扑由本类状态机自主触发（参照 mutant-3）
        this.aiInterval = Number.MAX_SAFE_INTEGER;
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
        // 飞扑冷却计时
        if (this._pounceCooldown > 0) this._pounceCooldown -= dt;

        // 眩晕/冰冻：中断飞扑、禁止移动（参照 mutant-3）
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            if (this._pounceState !== 'idle') this._endPounce();
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            return;
        }

        // ===== 飞扑状态机（参照 mutant-3：idle → prepare 蓄力 → charge 冲锋）=====
        if (this._pounceState === 'idle') {
            if (this._pounceCooldown <= 0 && this.target && this.target.active) {
                const dist = Math.hypot(this.target.x - this.x, this.target.y - this.y);
                if (dist <= (this.config?.pounceRange ?? 500)) {
                    this._startPounce();
                    return;
                }
            }
            this._updateNormalState();
        } else if (this._pounceState === 'prepare') {
            this._pounceTimer -= dt;
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            this._animState = 'attack';
            // 蓄力期间面向目标
            if (this.target && this.target.active) {
                this._facing = this.target.x >= this.x ? 'right' : 'left';
                this._lastHorizontalFacing = this._facing;
            }
            if (this._pounceTimer <= 0) {
                this._startCharge();
            }
        } else if (this._pounceState === 'charge') {
            this._updatePounceCharge(dt);
        }

        // ===== 更新帧动画（攻击按阶段帧区间推进，其余按状态）=====
        this._updateAnimFrame(dt);
    }

    triggerWeaponAnim() {
        // 黑狼只保留飞扑（自定义状态机自主触发），不使用通用攻击动画触发
    }

    // 正常移动态：facing + 动画状态
    _updateNormalState() {
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
        if (this._facing === 'left' || this._facing === 'right') {
            this._lastHorizontalFacing = this._facing;
        }
        this._facingDir = this._facing;

        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (this._aiState === 'pacing') {
            this._animState = 'pacing';
        } else if (speed > this._speedThresholds.run) {
            this._animState = 'run';
        } else if (speed > this._speedThresholds.walk) {
            this._animState = 'walk';
        } else {
            this._animState = 'idle';
        }
    }

    // 飞扑冲锋阶段：锁方向位移 + 命中检测 + 残影（参照 mutant-3）
    _updatePounceCharge(dt) {
        const dtSec = dt / 1000;
        this._facing = this._pounceDir.x >= 0 ? 'right' : 'left';
        this._lastHorizontalFacing = this._facing;
        this._facingDir = this._facing;
        this._animState = 'attack';

        // 向终点移动（穿过目标 overshoot 或最远 maxDist），冲锋阶段固定 1 秒
        const distToEnd = this._pounceTargetPos
            ? Math.hypot(this._pounceTargetPos.x - this.x, this._pounceTargetPos.y - this.y)
            : 0;
        if (distToEnd > 10 && this._pounceSpeed > 0) {
            const step = Math.min(this._pounceSpeed * dtSec, distToEnd);
            const nextX = this.x + this._pounceDir.x * step;
            const nextY = this.y + this._pounceDir.y * step;
            const resolved = WallSystem.resolve(this.x, this.y, nextX, nextY, this.groundRadius);
            this.x = resolved.x;
            this.y = resolved.y;
        }

        // 命中检测（飞扑专用判定距离 pounceHitDistance）
        const hitTarget = this._pounceTarget && this._pounceTarget.active ? this._pounceTarget : this.target;
        if (!this._pounceDamaged && hitTarget && hitTarget.active && hitTarget.hittable) {
            if (this._isTargetInRange(hitTarget, this.config?.pounceHitDistance ?? 100)) {
                hitTarget.takeDamage(this._getPounceDamage(), this, 'physical', true);
                this._pounceDamaged = true;
                // 盾牌弹反：不再眩晕，弹反本身已处理（参照 mutant-3）
                const parried = hitTarget.shieldSystem && hitTarget.shieldSystem._lastParried;
                if (parried) {
                    this._endPounce();
                    return;
                }
                if (hitTarget.applyStun) {
                    hitTarget.applyStun(this.config?.pounceStunMs ?? 2000);
                    this._endPounce();
                    return;
                }
            }
        }

        // 飞扑残影
        this._pounceGhostTimer -= dt;
        if (this._pounceGhostTimer <= 0) {
            this._spawnPounceGhost();
            this._pounceGhostTimer = 60;
        }

        this._pounceTimer -= dt;
        this._attackAnimTimer = Math.max(0, this._pounceTimer); // 阻止 MovementSystem 转向（参照 mutant-3）
        if (this._pounceTimer <= 0 || distToEnd <= 10) {
            this._endPounce();
        }
    }

    // 帧动画推进：攻击按 prepare/charge 阶段帧区间，其余按状态帧率
    _updateAnimFrame(dt) {
        this._animTimer += dt;
        if (this._animState === 'attack') {
            const pounceCfg = this._attackTypes?.pounce || {};
            const total = this._getStateFrameCount();
            const prepareFrames = pounceCfg.prepareFrames ?? 4;
            if (this._pounceState === 'prepare') {
                const frameDur = (pounceCfg.prepareMs ?? 1000) / Math.max(1, prepareFrames);
                if (this._animTimer >= frameDur) {
                    this._animTimer = 0;
                    this._animFrame = Math.min(this._animFrame + 1, prepareFrames - 1);
                }
            } else if (this._pounceState === 'charge') {
                const chargeFrames = Math.max(1, total - prepareFrames);
                const frameDur = (pounceCfg.chargeMs ?? 1000) / chargeFrames;
                if (this._animTimer >= frameDur) {
                    this._animTimer = 0;
                    this._animFrame = Math.min(this._animFrame + 1, total - 1);
                }
            }
        } else {
            const frameDuration = this._frameDurations[this._animState] || 150;
            if (this._animTimer >= frameDuration) {
                this._animTimer = 0;
                this._animFrame = (this._animFrame + 1) % this._getStateFrameCount();
            }
        }
    }

    // ===== 飞扑（参照 mutant-3）=====
    _startPounce() {
        if (this._pounceState !== 'idle') return;
        this._pounceState = 'prepare';
        this._pounceAnimPhase = 'prepare';
        this._animState = 'attack';
        this._frozenForCast = true;
        this._pounceTimer = this._attackTypes?.pounce?.prepareMs ?? 1000;
        this._pounceCooldown = this.config?.pounceCooldown ?? 12000;
        this._pounceTarget = this.target;
        this._animFrame = 0;
        this._animTimer = 0;
        if (this.target && this.target.active) {
            this._facing = this.target.x >= this.x ? 'right' : 'left';
            this._lastHorizontalFacing = this._facing;
        }
    }

    _startCharge() {
        if (this._pounceState !== 'prepare') return;
        this._pounceState = 'charge';
        this._pounceAnimPhase = 'charge';
        this._frozenForCast = false;
        this._pounceGhostTimer = 0;
        this._pounceDamaged = false;

        const maxDist = this.config?.pounceMaxDist ?? 1000;
        const overshoot = this.config?.pounceOvershoot ?? 200;
        const target = this._pounceTarget && this._pounceTarget.active ? this._pounceTarget : this.target;
        if (target && target.active) {
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
                this._pounceDir = { x: dx / dist, y: dy / dist };
                const clamped = Math.min(dist + overshoot, maxDist);
                this._pounceTargetPos = {
                    x: this.x + this._pounceDir.x * clamped,
                    y: this.y + this._pounceDir.y * clamped
                };
                this._pounceChargeDistance = clamped;
            } else {
                this._pounceDir = { x: 1, y: 0 };
                this._pounceTargetPos = { x: this.x + Math.min(overshoot, maxDist), y: this.y };
                this._pounceChargeDistance = Math.min(overshoot, maxDist);
            }
        } else {
            this._pounceDir = { x: 1, y: 0 };
            this._pounceTargetPos = { x: this.x + Math.min(overshoot, maxDist), y: this.y };
            this._pounceChargeDistance = Math.min(overshoot, maxDist);
        }

        // 冲锋阶段固定 1 秒，速度按距离自动调整
        this._pounceTimer = this._attackTypes?.pounce?.chargeMs ?? 1000;
        this._attackAnimTimer = 1000;
        this._pounceSpeed = this._pounceChargeDistance / 1;

        // 帧从蓄力区切到冲锋区（保持视觉连续）
        const prepareFrames = this._attackTypes?.pounce?.prepareFrames ?? 4;
        this._animFrame = Math.max(this._animFrame, prepareFrames - 1);
    }

    _endPounce() {
        this._pounceState = 'idle';
        this._pounceAnimPhase = null;
        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._pounceTimer = 0;
        this._pounceGhostTimer = 0;
        this._pounceTargetPos = null;
        this._pounceDamaged = false;
        this._pounceTarget = null;
        this._animState = 'idle';
        this._animFrame = 0;
    }

    _getPounceDamage() {
        // 飞扑只造成一次等于物理攻击的伤害（参照 mutant-3）
        return this.data.atk || this.data.str || 20;
    }

    _isTargetInRange(target, range) {
        if (!target) return false;
        const r = Math.max(0, range);
        const targetR = target.groundRadius || target.collisionRadius || target.size * 0.6 || 0;
        const dist = Math.hypot(target.x - this.x, target.y - this.y);
        return dist <= r + targetR;
    }

    _spawnPounceGhost() {
        const sprite = this._phaserSprite;
        const scene = window.__phaserScene;
        if (!sprite || !scene) return;
        const textureKey = this._getTextureKey();
        if (!scene.textures.exists(textureKey)) return;
        const frame = sprite.frame ? sprite.frame.name : 0;
        const ghost = scene.add.sprite(this.x, this.y, textureKey, frame)
            .setAlpha(0.5)
            .setDisplaySize(sprite.displayWidth, sprite.displayHeight)
            .setFlipX(sprite.flipX)
            .setDepth((sprite.depth || 0) - 1);
        scene.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: 250,
            onComplete: () => { if (ghost && ghost.active) ghost.destroy(); }
        });
    }

    _getTextureKey() {
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            return 'enemy_black_wolf_idle';
        }
        if (this._animState === 'attack') {
            return 'enemy_black_wolf_pounce';
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

    // 当前状态的精灵图网格与帧数
    _getFrameLayout(state) {
        const layouts = this._frameLayouts || {};
        const key = state === 'attack' ? 'pounce' : state;
        return layouts[key] || layouts.walk || { cols: 4, rows: 4 };
    }

    _getStateFrameCount() {
        const layouts = this._frameLayouts || {};
        if (this._animState === 'attack') {
            return layouts.pounce?.frames || 11;
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
            if (Math.abs(this.vx) > 0.1) {
                flipX = this.vx < 0;
            } else {
                // 纯垂直移动/idle：保持上次水平朝向
                flipX = this._lastHorizontalFacing === 'left';
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
            nameColor: 'rgba(255, 60, 60, 0.9)'
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
            currentSprite = this._sprites.pounce;
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
