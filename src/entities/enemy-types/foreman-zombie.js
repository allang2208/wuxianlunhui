import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { hostilesOf, playSoundFrom } from './_shared/enemy-utils.js';

/** 用线段近似绘制二次贝塞尔曲线（Phaser Graphics 无内置 quadraticCurveTo） */
function _drawQuadraticBezier(g, x0, y0, x1, y1, x2, y2, segments = 12) {
    g.beginPath();
    g.moveTo(x0, y0);
    const n = Math.max(2, Math.floor(segments));
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const x = u * u * x0 + 2 * u * t * x1 + t * t * x2;
        const y = u * u * y0 + 2 * u * t * y1 + t * t * y2;
        g.lineTo(x, y);
    }
    g.strokePath();
}

/**
 * 僵尸工头（领主，僵尸 family）
 * - 鞭击：距离判定 320px，1.5s 播放 31 帧（第 18 帧伤害判定，物理 ×2 + 1 层流血），
 *   深棕色弧线抽向目标（鞭子观感），冷却 4.5s，攻击时不可移动
 * - 号召：3s 播放 24 帧，释放后场上全体僵尸方怪物获得激励（移速 ×1.33、物攻 ×1.5，15s），冷却 30s
 * - 死亡：dying 14 帧 → 定格 1s → 淡出；死亡音效第 8 帧
 * 所有数值均来自 enemy-config.json foremanZombie.attackSkills，类内不硬编码
 */
export class ForemanZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.foremanZombie,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 攻击决策完全自管：关闭 CombatSystem 的通用近战触发
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 动画状态：idle | walk | whip | howl | death
        this._animState = 'idle';
        this._animStateTimer = 0;

        // 攻击状态：null | 'whip' | 'howl'
        this._attackType = null;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._hitDone = false;
        this._soundDone = false;
        this._whipCd = 0;
        this._howlCd = 0;

        // 移动音效计时
        this._walkSoundTimer = 0;

        // 死亡三段式 + 死亡音效帧
        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._deathSoundDone = false;
    }

    _getWhipConfig() {
        return this.config?.attackSkills?.whip || {};
    }

    _getHowlConfig() {
        return this.config?.attackSkills?.howl || {};
    }

    _getDeathConfig() {
        return this.config?.death || {};
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathSequence(dt);
            return;
        }

        super.update(dt, entities);

        if (this._whipCd > 0) this._whipCd -= dt;
        if (this._howlCd > 0) this._howlCd -= dt;

        // 眩晕时中断攻击动作
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            this._attackType = null;
            this._attackTimer = 0;
            this._attackAnimTimer = 0;
            this.vx = 0; this.vy = 0; this.isMoving = false;
            return;
        }

        // 攻击帧推进
        if (this._attackType) {
            this._updateAttack(dt, entities);
        } else {
            this._attackAnimTimer = 0;
        }

        // 状态切换
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let nextState;
        if (this._attackType === 'whip') {
            nextState = 'whip';
        } else if (this._attackType === 'howl') {
            nextState = 'howl';
        } else {
            const maxSpd = this.maxSpeed ?? this.speed ?? 160;
            nextState = speed > maxSpd * 0.05 ? 'walk' : 'idle';
        }
        this._animStateTimer = (this._animStateTimer || 0) + dt;
        if (nextState !== this._animState && this._animStateTimer >= 80) {
            this._animState = nextState;
            this._animStateTimer = 0;
        }

        // 朝向
        const t = this.target && this.target.active ? this.target : null;
        if (this._attackType && t) {
            this.rotation = Math.atan2(t.y - this.y, t.x - this.x);
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }

        // 移动音效（配置 sounds.walk，按 walkInterval 间隔循环播放）
        if (this._animState === 'walk') {
            this._walkSoundTimer -= dt;
            if (this._walkSoundTimer <= 0) {
                this._walkSoundTimer = this.config?.sounds?.walkInterval ?? 700;
                playSoundFrom(this, 'walk');
            }
        } else {
            this._walkSoundTimer = 0;
        }

        // 攻击决策：号召（冷却就绪且有敌对目标）优先，其次鞭击（320px 内）
        if (!this._attackType && t) {
            const dist = Math.hypot(t.x - this.x, t.y - this.y);
            if (this._howlCd <= 0) {
                this._tryAttackTelegraph(() => this._startHowl(entities));
            } else if (this._whipCd <= 0 && dist <= (this._getWhipConfig().range ?? 320)) {
                this._tryAttackTelegraph(() => this._startAttack('whip'));
            }
        }
    }

    // ========== 鞭击 ==========

    _startAttack(type) {
        const cfg = this._getWhipConfig();
        const duration = cfg.duration ?? 1500;
        this._attackType = type;
        this._attackTimer = duration;
        this._attackAnimTimer = duration; // MovementSystem 锁定（攻击时不可移动）
        this._hitDone = false;
        this._soundDone = false;
        this._animState = type;
        this._animStateTimer = 0;
        this.vx = 0; this.vy = 0; this.isMoving = false;
        this._whipCd = cfg.cooldown ?? 4500;
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    _updateAttack(dt, entities) {
        this._attackTimer -= dt;
        this._attackAnimTimer = Math.max(0, this._attackTimer);
        this.vx = 0; this.vy = 0; this.isMoving = false;

        if (this._attackType === 'howl') {
            if (this._attackTimer <= 0) {
                this._attackTimer = 0;
                this._attackType = null;
            }
            return;
        }

        const cfg = this._getWhipConfig();
        const duration = cfg.duration ?? 1500;
        const frames = cfg.frames ?? 31;
        const elapsed = duration - this._attackTimer;

        // 鞭击音效帧（配置 sounds.whipFrame）
        const soundFrame = this.config?.sounds?.whipFrame;
        if (!this._soundDone && typeof soundFrame === 'number' && elapsed >= (soundFrame / frames) * duration) {
            this._soundDone = true;
            playSoundFrom(this, 'whip');
        }

        // 第 hitFrame 帧伤害判定
        if (!this._hitDone && elapsed >= ((cfg.hitFrame ?? 18) / frames) * duration) {
            this._hitDone = true;
            this._dealWhipHit(entities);
        }

        if (this._attackTimer <= 0) {
            this._attackTimer = 0;
            this._attackType = null;
        }
    }

    /** 鞭击：320px 椭圆判定，物理 ×damageMul + 流血，深棕色弧线抽向目标 */
    _dealWhipHit(entities) {
        const cfg = this._getWhipConfig();
        const range = cfg.range ?? 320;
        const atk = this.data?.atk || 0;
        const bleedStacks = cfg.bleedStacks ?? 1;
        const shape = new GroundEllipse(this.x, this.y, range, range * PERSPECTIVE_SCALE_Y);
        for (const e of hostilesOf(this, entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 2))), this, 'physical', true);
            if (typeof e.applyBleeding === 'function') {
                e.applyBleeding(bleedStacks);
            }
            // 鞭子弧线：深棕色弧线抽向被击中的目标
            this._fireWhipArc(e);
        }
    }

    /**
     * 鞭子抽击弧线：深棕色二次贝塞尔弧线从手部抽到目标（双线描边，随进度伸展后淡出）
     */
    _fireWhipArc(target) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.tweens) return;
        const g = scene.add.graphics();
        g.setDepth(this.y + 50);
        const sx = this.x;
        const sy = this.y - (this.config?.render?.collisionHeight || 120) * 0.5;
        const tx = target.x;
        const ty = (target.collider ? target.collider.y : target.y) - 20;
        // 控制点：中段向侧上方隆起，形成鞭子甩动的弧度
        const midX = (sx + tx) / 2;
        const midY = Math.min(sy, ty) - Math.hypot(tx - sx, ty - sy) * 0.35;
        const wave = { t: 0 };
        scene.tweens.add({
            targets: wave,
            t: 1,
            duration: 400,
            ease: 'Cubic.easeOut',
            onUpdate() {
                const p = wave.t;
                g.clear();
                // 随进度伸展：终点按 p 截断
                const ex = sx + (tx - sx) * p;
                const ey = sy + (ty - sy) * p;
                const cx = sx + (midX - sx) * p;
                const cy = sy + (midY - sy) * p;
                // 双线描边：深棕外圈 + 亮棕内核
                g.lineStyle(4, 0x4a2a10, 0.85 * (1 - p * 0.5));
                _drawQuadraticBezier(g, sx, sy, cx, cy, ex, ey, 14);
                g.lineStyle(2, 0x7a4a22, 0.9 * (1 - p * 0.5));
                _drawQuadraticBezier(g, sx, sy, cx, cy, ex, ey, 14);
            },
            onComplete() {
                if (g.active) g.destroy();
            }
        });
    }

    // ========== 号召 ==========

    _startHowl(entities) {
        const cfg = this._getHowlConfig();
        const duration = cfg.duration ?? 3000;
        this._attackType = 'howl';
        this._attackTimer = duration;
        this._attackAnimTimer = duration; // MovementSystem 锁定
        this._animState = 'howl';
        this._animStateTimer = 0;
        this.vx = 0; this.vy = 0; this.isMoving = false;
        this._howlCd = cfg.cooldown ?? 30000;
        // 号召音效（直接播放）
        playSoundFrom(this, 'howl');
        // 场上全体僵尸方怪物获得激励（含自身）
        const list = Array.isArray(entities) ? entities : (entities ? Array.from(entities.values()) : []);
        for (const e of list) {
            if (!e || !e.active || e._faction !== 'enemy') continue;
            if (typeof e.applyInspire === 'function') {
                e.applyInspire(cfg.buffDuration ?? 15000, {
                    speedMul: cfg.speedMul ?? 1.33,
                    atkMul: cfg.atkMul ?? 1.5,
                });
            }
        }
    }

    // ========== 死亡三段式（动画 → 定格 → 淡出；死亡音效在第 8 帧） ==========

    _updateDeathSequence(dt) {
        const D = this._getDeathConfig();
        const animMs = D.animMs ?? 1400;
        if (!this._deathSoundDone && this._deathAnimTimer > 0) {
            const soundFrame = this.config?.sounds?.deathFrame;
            if (typeof soundFrame === 'number') {
                const frames = 14; // dying.png 帧数（与 BootScene endFrame 13 对齐）
                const elapsed = animMs - this._deathAnimTimer;
                if (elapsed >= (soundFrame / frames) * animMs) {
                    this._deathSoundDone = true;
                    playSoundFrom(this, 'death');
                }
            } else {
                this._deathSoundDone = true;
            }
        }
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer -= dt;
            if (this._deathAnimTimer <= 0) {
                this._deathAnimTimer = 0;
                this._corpseTimer = D.holdMs ?? 1000;
            }
        } else if (this._corpseTimer > 0) {
            this._corpseTimer -= dt;
            if (this._corpseTimer <= 0) {
                this._corpseTimer = 0;
                this._fadeTimer = D.fadeMs ?? 300;
            }
        } else if (this._fadeTimer > 0) {
            this._fadeTimer -= dt;
            const fadeMs = D.fadeMs ?? 300;
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
    }

    onDeath(source) {
        this.active = false;
        this._animState = 'death';
        this._attackType = null;
        this._deathAnimTimer = this._getDeathConfig().animMs ?? 1400;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._deathSoundDone = false;
        // 工头死亡：同步杀死场上所有矿洞（矿洞死亡不影响工头，单向联动）
        this._killAllMineCaves(source);
        if (typeof super.onDeath === 'function') {
            super.onDeath(source);
        }
    }

    _killAllMineCaves(source) {
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game || !game.entities) return;
        for (const e of game.entities.values()) {
            if (!e || !e.active || e.id !== 'mineCave') continue;
            // 矿洞同步死亡（走正常死亡流程，避免残留）
            if (typeof e.onDeath === 'function') {
                e.onDeath(source);
            } else if (typeof e.takeDamage === 'function') {
                e.takeDamage(99999, source, 'physical', true);
            }
        }
    }

    // ========== 动画 ==========

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_foreman_walk';
            case 'whip': return 'enemy_foreman_attack';
            case 'howl': return 'enemy_foreman_howl';
            case 'death': return 'enemy_foreman_death';
            default: return 'enemy_foreman_idle';
        }
    }

    _getPhaserOptions() {
        // 原始素材面向右，目标/移动方向朝左时翻转
        let flipX = false;
        if (this._attackType && this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }

        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 240;
        // animState 映射：攻击/号召/死亡均为一次性动画（防重播）
        const animStateMap = { whip: 'attack', howl: 'attack', death: 'death' };
        const animState = animStateMap[this._animState] || this._animState;
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 60,
            collisionHeight: renderCfg.collisionHeight || 120,
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState,
            animKey: this._getTextureKey(),
        };
    }
}
