import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { hostilesOf, playSoundFrom, inMeleeRange } from './_shared/enemy-utils.js';

/**
 * 矿石蜘蛛（精英，僵尸 family）
 * - 投掷晶石：距离判定 600px，1.5s 28 帧（第 21 帧发射）；晶石 1s 抛物线落地
 *   （每秒旋转 360°），落地椭圆 200px 物理 ×1.25；冷却 5.5s；攻击时不可移动
 * - 起跳下砸：2s 18 帧（第 10 帧判定）；阶梯伤害取最小圈不叠加：200px ×2 / 350px ×1；冷却 8s
 * - 死亡：释放一次起跳下砸（attacking-2 播到第 14 帧定格，含第 10 帧判定）
 *   → 接 dying 12 帧 → 定格 1s → 淡出销毁
 * 所有数值均来自 enemy-config.json oreSpider，类内不硬编码
 */
export class OreSpider extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.oreSpider,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 攻击决策完全自定义（投掷/下砸二选一）：关闭 CombatSystem 的通用近战触发
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 动画状态：idle | walk | attack(投掷) | slam(下砸) | deathSlam(临终下砸) | death
        this._animState = 'idle';
        this._animStateTimer = 0;

        // 攻击状态
        this._attackType = null;   // 'throw' | 'slam'
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._throwCd = 0;
        this._slamCd = 0;
        this._throwTakeSoundDone = false;
        this._throwLaunchSoundDone = false;
        this._throwFired = false;
        this._slamHitDone = false;

        // 晶石投射物与落点警示圈（用于统一清理）
        this._crystalSprite = null;
        this._crystalTween = null;
        this._crystalWarning = null;
        this._slamWarning = null;

        // 移动音效计时
        this._walkSoundTimer = 0;

        // 死亡序列：临终下砸（含判定）→ dying 动画 → 定格 → 淡出
        // 字段名与矿工/通用尸体机制对齐（_deathAnimTimer/_corpseTimer/_fadeTimer）——
        // game.js 实体循环与 isPreservedCorpse 只认这三个字段，自定义字段名会导致
        // 死亡后 update 被跳过（下砸+死亡动画不生效的根因）
        this._preserveCorpse = true; // 让 Game 循环在死亡期间继续调用 update
        this._deathPhase = null;     // 'slam' | 'dying'
        this._deathAnimTimer = 0;    // slam + dying 动画总时长
        this._slamPhaseMs = 0;       // slam 阶段时长（到时切 dying）
        this._corpseTimer = 0;       // 定格保留
        this._fadeTimer = 0;         // 淡出
        this._deathSlamHitDone = false;
    }

    _getThrowConfig() {
        return this.config?.attackSkills?.throw || {};
    }

    _getSlamConfig() {
        return this.config?.attackSkills?.slam || {};
    }

    _getDeathConfig() {
        return this.config?.death || {};
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathSequence(dt, entities);
            return;
        }

        super.update(dt, entities);

        // 计时器
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._attackTimer <= 0) {
                this._attackTimer = 0;
                this._attackType = null;
            }
        }
        if (this._attackAnimTimer > 0) {
            this._attackAnimTimer -= dt;
            if (this._attackAnimTimer < 0) this._attackAnimTimer = 0;
        }
        if (this._throwCd > 0) this._throwCd -= dt;
        if (this._slamCd > 0) this._slamCd -= dt;

        // 落点/范围警示圈保活（集合体同款：EffectManager 生命周期短，每帧重置 life 续命；
        // 注意是重置 life 不是 maxLife——只刷 maxLife 会在 100ms 后自然消亡）
        for (const key of ['_crystalWarning', '_slamWarning']) {
            const warn = this[key];
            if (!warn) continue;
            if (!warn.active) this[key] = null;
            else warn.life = warn.maxLife;
        }

        // 攻击帧触发
        if (this._attackTimer > 0 && this._attackType) {
            this._updateAttackFrames(entities);
        }

        // 攻击决策：近身优先下砸，否则投掷（精英经攻击预警延迟）
        const t = this.target;
        if (!this._attackType && t && t.active) {
            const slam = this._getSlamConfig();
            const thr = this._getThrowConfig();
            if (this._slamCd <= 0 && inMeleeRange(this, t, slam.range ?? this.attackDistance ?? 350)) {
                this._tryAttackTelegraph(() => this._startSlam());
            } else if (this._throwCd <= 0 && inMeleeRange(this, t, thr.range ?? this.attackDistance ?? 600)) {
                this._tryAttackTelegraph(() => this._startThrow());
            }
        }

        // 动画状态切换（攻击期间锁定）
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let nextState;
        if (this._attackType === 'throw') {
            nextState = 'attack';
        } else if (this._attackType === 'slam') {
            nextState = 'slam';
        } else {
            const maxSpd = this.maxSpeed ?? this.speed ?? 150;
            nextState = speed > maxSpd * 0.05 ? 'walk' : 'idle';
        }
        this._animStateTimer = (this._animStateTimer || 0) + dt;
        if (nextState !== this._animState && this._animStateTimer >= 80) {
            this._animState = nextState;
            this._animStateTimer = 0;
        }

        // 移动音效（配置 sounds.walk，按 walkInterval 间隔循环播放）
        if (this._animState === 'walk') {
            this._walkSoundTimer -= dt;
            if (this._walkSoundTimer <= 0) {
                this._walkSoundTimer = this.config?.sounds?.walkInterval ?? 400;
                playSoundFrom(this, 'walk');
            }
        } else {
            this._walkSoundTimer = 0;
        }

        // 朝向
        if (this._attackType && this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }
    }

    /** 攻击帧触发：投掷（取石/掷出音效 + 发射帧）；下砸（判定帧 + 音效） */
    _updateAttackFrames(entities) {
        const isThrow = this._attackType === 'throw';
        const cfg = isThrow ? this._getThrowConfig() : this._getSlamConfig();
        const duration = cfg.duration ?? 1500;
        const frames = cfg.frames ?? 28;
        const elapsed = duration - this._attackTimer;
        const sounds = this.config?.sounds || {};
        if (isThrow) {
            if (!this._throwTakeSoundDone && typeof sounds.throwTakeFrame === 'number'
                && elapsed >= (sounds.throwTakeFrame / frames) * duration) {
                this._throwTakeSoundDone = true;
                playSoundFrom(this, 'throwTake');
            }
            if (!this._throwLaunchSoundDone && typeof sounds.throwLaunchFrame === 'number'
                && elapsed >= (sounds.throwLaunchFrame / frames) * duration) {
                this._throwLaunchSoundDone = true;
                playSoundFrom(this, 'throwLaunch');
            }
            if (!this._throwFired && elapsed >= ((cfg.fireFrame ?? 21) / frames) * duration) {
                this._throwFired = true;
                this._fireCrystal();
            }
        } else {
            if (!this._slamHitDone && elapsed >= ((cfg.hitFrame ?? 10) / frames) * duration) {
                this._slamHitDone = true;
                // 判定音效（attacking.mp3）
                playSoundFrom(this, 'slam');
                this._dealSlamHit(entities);
            }
        }
    }

    // ========== 投掷晶石 ==========

    _startThrow() {
        if (this._attackType) return;
        const cfg = this._getThrowConfig();
        const duration = cfg.duration ?? 1500;
        this._attackType = 'throw';
        this._attackTimer = duration;
        this._attackAnimTimer = duration; // MovementSystem 锁定（攻击时不可移动）
        this._throwCd = cfg.cooldown ?? 5500;
        this._throwTakeSoundDone = false;
        this._throwLaunchSoundDone = false;
        this._throwFired = false;
        this.vx = 0; this.vy = 0; this.isMoving = false;
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    /** 发射晶石：抛物线 1s 落地，落地前每秒 360° 旋转（参考提灯抛物线模式） */
    _fireCrystal() {
        const cfg = this._getThrowConfig();
        const t = this.target && this.target.active ? this.target : null;
        // 预判落点：抛物线固定飞行时间 flyS，直接线性外推目标在 flyS 秒后的位置
        const flyS = (cfg.flyDuration ?? 1000) / 1000;
        let tx = this.x, ty = this.y;
        if (t) {
            tx = t.x + (t.vx || 0) * flyS;
            ty = t.y + (t.vy || 0) * flyS;
        }
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.tweens) {
            this._crystalImpact(tx, ty);
            return;
        }
        const size = cfg.projectileSize ?? 40;
        // 落点红色椭圆警示（集合体同款 AttackRangeEffect；飞行期间每帧保活，落地销毁）
        this._destroyCrystalWarning();
        const radius = cfg.impactRadius ?? 200;
        const warn = new AttackRangeEffect(tx, ty, 0, radius, radius * PERSPECTIVE_SCALE_Y, 'ellipse', 100, 0.5, true);
        warn.maxLife = 100;
        EffectManager.add(warn);
        this._crystalWarning = warn;
        const sx = this.x;
        const sy = this.y - (this.config?.render?.collisionHeight || 110) * 0.5;
        const sprite = scene.add.sprite(sx, sy, 'enemy_ore_spider_projectile');
        sprite.setDisplaySize(size, size);
        sprite.setDepth(this.y + 15);
        this._crystalSprite = sprite;
        const arcH = cfg.arcHeight ?? 100;
        const flyDuration = cfg.flyDuration ?? 1000;
        const self = this;
        this._crystalTween = scene.tweens.add({
            targets: { t: 0 },
            t: 1,
            duration: flyDuration,
            ease: 'Linear',
            onUpdate(tw) {
                const p = tw.getValue();
                sprite.x = sx + (tx - sx) * p;
                sprite.y = sy + (ty - sy) * p - arcH * 4 * p * (1 - p);
                // 落地前每秒 360° 旋转
                sprite.rotation = p * Math.PI * 2 * (flyDuration / 1000);
            },
            onComplete() {
                if (sprite.active) sprite.destroy();
                if (self._crystalSprite === sprite) self._crystalSprite = null;
                self._crystalTween = null;
                self._crystalImpact(tx, ty);
            }
        });
    }

    /** 晶石落地：椭圆范围物理 ×damageMul + 落地扩散圈 */
    _crystalImpact(tx, ty) {
        this._destroyCrystalWarning();
        const cfg = this._getThrowConfig();
        const radius = cfg.impactRadius ?? 200;
        const atk = this.data?.atk || 0;
        const shape = new GroundEllipse(tx, ty, radius, radius * PERSPECTIVE_SCALE_Y);
        for (const e of hostilesOf(this)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 1.25))), this, 'physical', false);
        }
        // 落地烟尘：灰色烟雾向上扩散（NORMAL 混合；发射器留 (0,0)，explode 传世界坐标）
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && scene.add && scene.tweens) {
            if (scene.textures.exists('smoke_particle')) {
                const smoke = scene.add.particles(0, 0, 'smoke_particle', {
                    speed: { min: 40, max: 120 },
                    angle: { min: 200, max: 340 }, // 向上扩散
                    scale: { start: 0.4, end: 1.4 },
                    alpha: { start: 0.65, end: 0 },
                    tint: 0x9a9290,
                    lifespan: 700,
                    blendMode: 'NORMAL',
                    emitting: false,
                });
                smoke.addToUpdateList();
                smoke.setDepth(ty + 1);
                smoke.explode(12, tx, ty);
                scene.time.delayedCall(800, () => { if (smoke && smoke.active) smoke.destroy(); });
            }
            const g = scene.add.graphics();
            g.setDepth(ty - 998); // 地面特效层（实体之下）
            scene.tweens.add({
                targets: { p: 0 },
                p: 1,
                duration: 300,
                ease: 'Cubic.easeOut',
                onUpdate(tw) {
                    const p = tw.getValue();
                    g.clear();
                    g.lineStyle(3, 0xb8a8c8, 0.8 * (1 - p));
                    g.strokeEllipse(tx, ty, radius * 2 * p, radius * 2 * PERSPECTIVE_SCALE_Y * p);
                },
                onComplete() { if (g.active) g.destroy(); }
            });
        }
    }

    // ========== 起跳下砸 ==========

    _startSlam() {
        if (this._attackType) return;
        const cfg = this._getSlamConfig();
        const duration = cfg.duration ?? 2000;
        this._attackType = 'slam';
        this._attackTimer = duration;
        this._attackAnimTimer = duration; // MovementSystem 锁定（攻击时不可移动）
        this._slamCd = cfg.cooldown ?? 8000;
        this._slamHitDone = false;
        this.vx = 0; this.vy = 0; this.isMoving = false;
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
        // 下砸范围红圈提示（最大判定圈，出手即显示，判定帧销毁）
        this._destroySlamWarning();
        const zones = (cfg.zones && cfg.zones.length) ? cfg.zones : [{ radius: 200 }, { radius: 350 }];
        const maxR = Math.max(...zones.map(z => z.radius));
        const warn = new AttackRangeEffect(this.x, this.y, 0, maxR, maxR * PERSPECTIVE_SCALE_Y, 'ellipse', 100, 0.5, true);
        warn.maxLife = 100;
        EffectManager.add(warn);
        this._slamWarning = warn;
    }

    /** 下砸判定：阶梯伤害取最小圈不叠加（集合体同款），+ 地面冲击扩散圈 */
    _dealSlamHit(entities) {
        this._destroySlamWarning();
        const cfg = this._getSlamConfig();
        const zones = (cfg.zones && cfg.zones.length)
            ? [...cfg.zones].sort((a, b) => a.radius - b.radius)
            : [{ radius: 200, damageMul: 2 }, { radius: 350, damageMul: 1 }];
        const atk = this.data?.atk || 0;
        for (const e of hostilesOf(this, entities)) {
            // 取最小命中圈（不叠加）
            for (const z of zones) {
                const shape = new GroundEllipse(this.x, this.y, z.radius, z.radius * PERSPECTIVE_SCALE_Y);
                if (!shape.intersectsEntity(e)) continue;
                e.takeDamage(Math.max(1, Math.round(atk * (z.damageMul ?? 1))), this, 'physical', true);
                // 命中眩晕（配置 stunMs；状态免疫目标由 applyStun 内部拦截）
                if (cfg.stunMs && typeof e.applyStun === 'function') e.applyStun(cfg.stunMs);
                break;
            }
        }
        // 冲击扩散圈（扩散到最大判定圈，400ms 淡出）
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && scene.add && scene.tweens) {
            const maxR = zones[zones.length - 1].radius;
            const cx = this.x, cy = this.y;
            const g = scene.add.graphics();
            g.setDepth(cy - 998); // 地面特效层（实体之下）
            scene.tweens.add({
                targets: { p: 0 },
                p: 1,
                duration: 400,
                ease: 'Cubic.easeOut',
                onUpdate(tw) {
                    const p = tw.getValue();
                    g.clear();
                    g.lineStyle(4, 0xc8b8d8, 0.85 * (1 - p));
                    g.strokeEllipse(cx, cy, maxR * 2 * p, maxR * 2 * PERSPECTIVE_SCALE_Y * p);
                },
                onComplete() { if (g.active) g.destroy(); }
            });
        }
    }

    // ========== 死亡序列（临终下砸 → dying → 定格 → 淡出） ==========

    onDeath(source) {
        this.active = false;
        // 死亡时释放一次起跳下砸：attacking-2 播到第 slamFrames 帧后切 dying
        const slam = this._getSlamConfig();
        const death = this._getDeathConfig();
        const slamFrames = death.slamFrames ?? 14;
        const frames = slam.frames ?? 18;
        const duration = slam.duration ?? 2000;
        this._animState = 'deathSlam';
        this._animStateTimer = 0;
        this._attackType = null;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._deathPhase = 'slam';
        this._slamPhaseMs = (slamFrames / frames) * duration;
        // 尸体机制字段（game.js 循环识别口径）：动画总时长 = slam 段 + dying 段
        this._deathAnimTimer = this._slamPhaseMs + (death.dyingMs ?? 1200);
        this._deathSlamHitDone = false;
        this.vx = 0; this.vy = 0; this.isMoving = false;
        if (typeof super.onDeath === 'function') {
            super.onDeath(source);
        }
    }

    _updateDeathSequence(dt, entities) {
        const slam = this._getSlamConfig();
        const death = this._getDeathConfig();
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer -= dt;
            const frames = slam.frames ?? 18;
            const duration = slam.duration ?? 2000;
            // slam 阶段：第 hitFrame 帧伤害判定（可配置关闭）
            if (this._deathPhase === 'slam') {
                const elapsed = this._slamPhaseMs + (death.dyingMs ?? 1200) - this._deathAnimTimer;
                if (!this._deathSlamHitDone && death.slamDamage !== false
                    && elapsed >= ((slam.hitFrame ?? 10) / frames) * duration) {
                    this._deathSlamHitDone = true;
                    playSoundFrom(this, 'slam');
                    this._dealSlamHit(entities);
                }
                if (elapsed >= this._slamPhaseMs) {
                    // 切换 dying 动画（dying.mp3 同步播放）
                    this._deathPhase = 'dying';
                    this._animState = 'death';
                    this._animStateTimer = 0;
                    playSoundFrom(this, 'death');
                }
            }
            if (this._deathAnimTimer <= 0) {
                this._deathAnimTimer = 0;
                this._corpseTimer = death.holdMs ?? 1000; // 动画播完 → 定格保留
            }
            return;
        }
        if (this._corpseTimer > 0) {
            this._corpseTimer -= dt;
            if (this._corpseTimer <= 0) {
                this._corpseTimer = 0;
                this._fadeTimer = death.fadeMs ?? 300; // 定格结束 → 淡出
            }
            return;
        }
        if (this._fadeTimer > 0) {
            this._fadeTimer -= dt;
            const fadeMs = death.fadeMs ?? 300;
            if (this._phaserSprite && this._phaserSprite.active) {
                this._phaserSprite.setAlpha(Math.max(0, this._fadeTimer / fadeMs));
            }
            if (this._fadeTimer <= 0) {
                this._deathPhase = null;
                if (this._phaserSprite && this._phaserSprite.active) {
                    this._phaserSprite.destroy();
                    this._phaserSprite = null;
                }
            }
        }
    }

    /** 销毁落点警示圈（必须显式 destroy Phaser 图形，active=false 只会残留——集合体同款教训） */
    _destroyCrystalWarning() {
        if (this._crystalWarning) {
            this._crystalWarning.active = false;
            if (typeof this._crystalWarning._destroyPhaserGraphics === 'function') {
                this._crystalWarning._destroyPhaserGraphics();
            }
            this._crystalWarning = null;
        }
    }

    /** 销毁下砸范围警示圈（与 _destroyCrystalWarning 同口径：active=false + 显式销毁图形） */
    _destroySlamWarning() {
        if (this._slamWarning) {
            this._slamWarning.active = false;
            if (typeof this._slamWarning._destroyPhaserGraphics === 'function') {
                this._slamWarning._destroyPhaserGraphics();
            }
            this._slamWarning = null;
        }
    }

    /** 统一特效清理（game.js removeEntity / onDeath 约定入口） */
    _destroyCustomEffects() {
        this._destroyCrystalWarning();
        this._destroySlamWarning();
        if (this._crystalTween) {
            this._crystalTween.stop();
            this._crystalTween = null;
        }
        if (this._crystalSprite) {
            if (this._crystalSprite.active) this._crystalSprite.destroy();
            this._crystalSprite = null;
        }
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_ore_spider_walk';
            case 'attack': return 'enemy_ore_spider_attack';
            case 'slam': return 'enemy_ore_spider_slam';
            case 'deathSlam': return 'enemy_ore_spider_slam';
            case 'death': return 'enemy_ore_spider_death';
            default: return 'enemy_ore_spider_idle';
        }
    }

    _getPhaserOptions() {
        // 原始素材面向右，目标/移动方向朝左时翻转（矿工同款规则）
        let flipX = false;
        if (this._attackType && this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }

        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 260;
        // deathSlam 复用 slam 动画键
        const animSuffix = this._animState === 'deathSlam' ? 'slam' : this._animState;
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 120,
            collisionHeight: renderCfg.collisionHeight || 110,
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState: this._animState,
            animKey: `enemy_ore_spider_${animSuffix}`,
        };
    }
}
