import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { hostilesOf, playSoundFrom, inMeleeRange } from './_shared/enemy-utils.js';
import { launchArcProjectile } from '../../effects/combat-fx.js';
import { GroundZone } from '../../effects/ground-zone.js';

/**
 * 矿工提灯僵尸（精英，僵尸 family）
 * - 砸击：距离判定 120px，1.5s 播放 30 帧（第 16 帧伤害判定，物理 ×1.5），冷却 4.5s，攻击时不可移动
 * - 提灯攻击：1.5s 播放 22 帧（第 11 帧掷出矿灯），矿灯 1.5s 抛物线落地（每秒 360° 旋转），
 *   落点 300px 椭圆持续燃烧 4s（枪口火焰特效填满），每 0.5s 魔法伤害 ×0.75，冷却 8s
 * - 死亡：dying 15 帧 → 定格 1s → 淡出消失；死亡音效在第 8 帧播放
 * 所有数值均来自 enemy-config.json lanternMinerZombie.attackSkills，类内不硬编码
 */
export class LanternMinerZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.lanternMinerZombie,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 攻击决策完全自管：关闭 CombatSystem 的通用近战触发（同 mutant-3 模式）
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 动画状态：idle | walk | slam | lantern | death
        this._animState = 'idle';
        this._animStateTimer = 0;

        // 攻击状态：null | 'slam' | 'lantern'
        this._attackType = null;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._hitDone = false;      // 砸击判定 / 提灯出手
        this._soundDone = false;    // 攻击音效
        this._slamCd = 0;
        this._lanternCd = 0;

        // 提灯投射物与燃烧区
        this._lanternSprite = null;
        this._burnZones = [];       // [{x, y, timer, tickTimer, flames: []}]

        // 移动音效计时
        this._walkSoundTimer = 0;

        // 死亡三段式 + 死亡音效帧
        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._deathSoundDone = false;
    }

    _getSlamConfig() {
        return this.config?.attackSkills?.slam || {};
    }

    _getLanternConfig() {
        return this.config?.attackSkills?.lantern || {};
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

        // 冷却推进
        if (this._slamCd > 0) this._slamCd -= dt;
        if (this._lanternCd > 0) this._lanternCd -= dt;

        // 眩晕或冰冻时中断攻击动作
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            this._attackType = null;
            this._attackTimer = 0;
            this._attackAnimTimer = 0;
            this.vx = 0; this.vy = 0; this.isMoving = false;
            this._updateBurnZones(dt, entities);
            return;
        }

        // 恐惧时中断攻击决策（移动由 MovementSystem 恐惧分支接管逃跑）
        if (this.hasStatusEffect && this.hasStatusEffect('fear')) {
            return;
        }

        // 攻击帧推进（砸击判定 / 提灯出手 / 攻击音效帧）
        if (this._attackType) {
            this._updateAttack(dt, entities);
        } else {
            this._attackAnimTimer = 0;
        }

        // 状态切换
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let nextState;
        if (this._attackType === 'slam') {
            nextState = 'slam';
        } else if (this._attackType === 'lantern') {
            nextState = 'lantern';
        } else {
            const maxSpd = this.maxSpeed ?? this.speed ?? 140;
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
                this._walkSoundTimer = this.config?.sounds?.walkInterval ?? 500;
                playSoundFrom(this, 'walk');
            }
        } else {
            this._walkSoundTimer = 0;
        }

        // 攻击决策：砸击优先（贴身），其次提灯（中远程）
        if (!this._attackType && t) {
            const dist = Math.hypot(t.x - this.x, t.y - this.y);
            const slam = this._getSlamConfig();
            const lantern = this._getLanternConfig();
            if (this._slamCd <= 0 && dist <= (slam.range ?? 120)) {
                this._tryAttackTelegraph(() => this._startAttack('slam'));
            } else if (this._lanternCd <= 0 && dist <= (lantern.throwRange ?? 600)) {
                this._tryAttackTelegraph(() => this._startAttack('lantern'));
            }
        }

        // 燃烧区 tick 与清理
        this._updateBurnZones(dt, entities);
    }

    // ========== 攻击 ==========

    _startAttack(type) {
        const cfg = type === 'slam' ? this._getSlamConfig() : this._getLanternConfig();
        const duration = cfg.duration ?? 1500;
        this._attackType = type;
        this._attackTimer = duration;
        this._attackAnimTimer = duration; // MovementSystem 锁定（攻击时不可移动）
        this._hitDone = false;
        this._soundDone = false;
        this._animState = type;
        this._animStateTimer = 0;
        this.vx = 0; this.vy = 0; this.isMoving = false;
        if (type === 'slam') {
            this._slamCd = cfg.cooldown ?? 4500;
        } else {
            this._lanternCd = cfg.cooldown ?? 8000;
        }
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    _updateAttack(dt, entities) {
        this._attackTimer -= dt;
        this._attackAnimTimer = Math.max(0, this._attackTimer);
        this.vx = 0; this.vy = 0; this.isMoving = false;

        const isSlam = this._attackType === 'slam';
        const cfg = isSlam ? this._getSlamConfig() : this._getLanternConfig();
        const duration = cfg.duration ?? 1500;
        const frames = cfg.frames ?? (isSlam ? 30 : 22);
        const elapsed = duration - this._attackTimer;

        // 攻击音效帧（配置 sounds.slamFrame / lanternFrame）
        const soundFrame = isSlam ? this.config?.sounds?.slamFrame : this.config?.sounds?.lanternFrame;
        if (!this._soundDone && typeof soundFrame === 'number' && elapsed >= (soundFrame / frames) * duration) {
            this._soundDone = true;
            playSoundFrom(this, isSlam ? 'slam' : 'lantern');
        }

        // 帧事件：砸击伤害判定 / 提灯出手
        const eventFrame = isSlam ? (cfg.hitFrame ?? 16) : (cfg.fireFrame ?? 11);
        if (!this._hitDone && elapsed >= (eventFrame / frames) * duration) {
            this._hitDone = true;
            if (isSlam) this._dealSlamHit(entities);
            else this._throwLantern(entities);
        }

        if (this._attackTimer <= 0) {
            this._attackTimer = 0;
            this._attackType = null;
        }
    }

    /** 砸击：统一口径圆形边缘距离判定，物理 ×damageMul */
    _dealSlamHit(entities) {
        const slam = this._getSlamConfig();
        const range = slam.range ?? this.attackDistance ?? 120;
        const atk = this.data?.atk || 0;
        for (const e of hostilesOf(this, entities)) {
            if (!inMeleeRange(this, e, range)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (slam.damageMul ?? 1.5))), this, 'physical', true);
        }
    }

    // ========== 提灯攻击（参考突击特工闪光弹：抛物线 + 落地判定） ==========

    _throwLantern(_entities) {
        const L = this._getLanternConfig();
        const t = this.target && this.target.active ? this.target : null;
        // 预判落点：抛物线固定飞行时间 flyS，直接线性外推目标在 flyS 秒后的位置。
        // 不再用 AimHelper.lead（它解的是匀速直线弹体拦截点，与固定时长抛物线模型不匹配，会导致落点严重偏离）。
        const flyS = (L.flyDuration ?? 1500) / 1000;
        let tx = this.x, ty = this.y;
        if (t) {
            tx = t.x + (t.vx || 0) * flyS;
            ty = t.y + (t.vy || 0) * flyS;
        }
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.tweens) {
            this._lanternImpact(tx, ty);
            return;
        }
        const dirX = (this._getPhaserOptions().flipX) ? -1 : 1;
        const size = L.projectileSize || 48;
        let sx = this.x + dirX * (L.muzzleForward ?? 30);
        let sy = this.y - (L.muzzleUpY ?? 60);
        // 面朝右时的额外微调（配置驱动，右移/下移用正值）
        if (dirX > 0) {
            sx += L.muzzleRightDx ?? 0;
            sy += L.muzzleRightDy ?? 0;
        }
        // 抛物线投射物（共享件；枪口偏移已在上方算好 sx/sy 传入）
        const flyDuration = L.flyDuration ?? 1500;
        const handle = launchArcProjectile({
            textureKey: 'enemy_lantern_miner_projectile',
            size,
            sx, sy, tx, ty,
            arcHeight: L.arcHeight ?? 100,
            duration: flyDuration,
            // 原公式 rotation=p*3π*(flyDuration/1500)，折算角速度恒为 2π rad/s（落地前每秒 360°）
            spin: Math.PI * 2,
            depth: this.y + 15,
            onImpact: (ix, iy) => {
                this._lanternSprite = null;
                this._lanternImpact(ix, iy);
            },
        });
        // scene 已在上方确认存在，handle 必非 null
        this._lanternSprite = handle.sprite;
    }

    /** 矿灯落地：创建燃烧区（200px 椭圆，4s，每 0.5s 魔法伤害；GroundZone 模板：油脂地面 + 火焰簇） */
    _lanternImpact(tx, ty) {
        const L = this._getLanternConfig();
        // 燃烧音效（投射物落地后播放）
        playSoundFrom(this, 'burn');
        const zone = new GroundZone({
            x: tx, y: ty,
            radius: L.impactRadius ?? 300,
            duration: L.burnDuration ?? 4000,
            tickMs: L.tickMs ?? 500,
            oil: L.oil || {}, // 色值/透明度/growMs/反光子配置全走 enemy-config（缺省=基类默认）
            flame: {
                morphMs: L.flameMorphMs ?? 70,
                points: L.flamePoints ?? 3,
                burstCount: L.flameBurstCount ?? 20,
            },
            onTick: (z, entities) => {
                const matk = this.data?.matk || 0;
                const shape = new GroundEllipse(z.x, z.y, z.radius, z.radius * PERSPECTIVE_SCALE_Y);
                for (const e of hostilesOf(this, entities)) {
                    if (!shape.intersectsEntity(e)) continue;
                    e.takeDamage(Math.max(1, Math.round(matk * (L.damageMul ?? 0.75))), this, 'magic', false);
                }
            },
        });
        this._burnZones.push(zone);
    }

    _updateBurnZones(dt, entities) {
        for (let i = this._burnZones.length - 1; i >= 0; i--) {
            // GroundZone 自管生命周期，到期/销毁返回 false
            if (!this._burnZones[i].update(dt, entities)) {
                this._burnZones.splice(i, 1);
            }
        }
    }

    /** 统一特效清理（game.js removeEntity / onDeath 约定入口） */
    _destroyCustomEffects() {
        for (const zone of this._burnZones) zone.destroy();
        this._burnZones = [];
        if (this._lanternSprite && this._lanternSprite.active) {
            this._lanternSprite.destroy();
        }
        this._lanternSprite = null;
    }

    // ========== 死亡三段式（动画 → 定格 → 淡出；死亡音效在第 8 帧） ==========

    _updateDeathSequence(dt) {
        const D = this._getDeathConfig();
        const animMs = D.animMs ?? 1500;
        // 死亡音效：动画第 deathFrame 帧播放一次
        if (!this._deathSoundDone && this._deathAnimTimer > 0) {
            const soundFrame = this.config?.sounds?.deathFrame;
            if (typeof soundFrame === 'number') {
                const frames = 15; // dying.png 帧数（与 BootScene endFrame 14 对齐）
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
        this._deathAnimTimer = this._getDeathConfig().animMs ?? 1500;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._deathSoundDone = false;
        if (typeof super.onDeath === 'function') {
            super.onDeath(source);
        }
    }

    // ========== 动画 ==========

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_lantern_miner_walk';
            case 'slam': return 'enemy_lantern_miner_attack';
            case 'lantern': return 'enemy_lantern_miner_attack2';
            case 'death': return 'enemy_lantern_miner_death';
            default: return 'enemy_lantern_miner_idle';
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
        const spriteSize = renderCfg.spriteSize || 200;
        // animState 映射：攻击/死亡均为一次性动画（GameScene 依 isLoopAnim 规则不重播；
        // 提灯攻击也必须报 'attack'，否则会被当循环动画重播）
        const animStateMap = { slam: 'attack', lantern: 'attack', death: 'death' };
        const animState = animStateMap[this._animState] || this._animState;
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 50,
            collisionHeight: renderCfg.collisionHeight || 110,
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState,
            animKey: this._getTextureKey(),
        };
    }
}
