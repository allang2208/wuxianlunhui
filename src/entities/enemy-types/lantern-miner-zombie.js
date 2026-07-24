import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { hostilesOf, playSoundFrom } from './_shared/enemy-utils.js';
import { AimHelper } from '../../utils/aim-helper.js';

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

        // 眩晕时中断攻击动作
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            this._attackType = null;
            this._attackTimer = 0;
            this._attackAnimTimer = 0;
            this.vx = 0; this.vy = 0; this.isMoving = false;
            this._updateBurnZones(dt, entities);
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

    /** 砸击：以自身为中心的椭圆范围，物理 ×damageMul */
    _dealSlamHit(entities) {
        const slam = this._getSlamConfig();
        const range = slam.range ?? 120;
        const atk = this.data?.atk || 0;
        const shape = new GroundEllipse(this.x, this.y, range, range * PERSPECTIVE_SCALE_Y);
        for (const e of hostilesOf(this, entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (slam.damageMul ?? 1.5))), this, 'physical', true);
        }
    }

    // ========== 提灯攻击（参考突击特工闪光弹：抛物线 + 落地判定） ==========

    _throwLantern(_entities) {
        const L = this._getLanternConfig();
        const t = this.target && this.target.active ? this.target : null;
        // 预判落点（飞行时间内的目标移动）
        const flyS = (L.flyDuration ?? 1500) / 1000;
        let tx = this.x, ty = this.y;
        if (t) {
            const lead = AimHelper.lead(this.x, this.y, t.x, t.y, t.vx || 0, t.vy || 0,
                flyS > 0 ? Math.hypot(t.x - this.x, t.y - this.y) / flyS : 1000, 0);
            tx = lead.x; ty = lead.y;
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
        const sprite = scene.add.sprite(sx, sy, 'enemy_lantern_miner_projectile');
        sprite.setDisplaySize(size, size);
        sprite.setDepth(this.y + 15);
        this._lanternSprite = sprite;
        const arcH = L.arcHeight ?? 100;
        const self = this;
        scene.tweens.add({
            targets: { t: 0 },
            t: 1,
            duration: L.flyDuration ?? 1500,
            ease: 'Linear',
            onUpdate(tw) {
                const p = tw.getValue();
                sprite.x = sx + (tx - sx) * p;
                sprite.y = sy + (ty - sy) * p - arcH * 4 * p * (1 - p);
                // 落地前每秒 360° 旋转（1.5s 共 540°）
                sprite.rotation = p * Math.PI * 3 * ((L.flyDuration ?? 1500) / 1500);
            },
            onComplete() {
                if (sprite.active) sprite.destroy();
                if (self._lanternSprite === sprite) self._lanternSprite = null;
                self._lanternImpact(tx, ty);
            }
        });
    }

    /** 矿灯落地：创建燃烧区（300px 椭圆，4s，每 0.5s 魔法伤害；油脂地面 + 火焰按特工射速频率变幻） */
    _lanternImpact(tx, ty) {
        const L = this._getLanternConfig();
        const zone = {
            x: tx, y: ty,
            timer: L.burnDuration ?? 4000,
            tickTimer: 0,
            flameTimer: 0,
            flames: [],
        };
        // 油脂地面贴花：深黄色半透明椭圆（NORMAL 混合——暗色在 ADD 下不可见），
        // 从落地点 growMs 内迅速向外扩散到最大范围；随燃烧区销毁
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && scene.add) {
            const radius = L.impactRadius ?? 300;
            const oilCfg = L.oil || {};
            const oilColor = typeof oilCfg.color === 'string' ? parseInt(oilCfg.color, 16) : (oilCfg.color ?? 0x8a6d1f);
            const oilAlpha = oilCfg.alpha ?? 0.5;
            zone.oilFrac = 0.05; // 扩散进度（_updateBurnZones 中 0.3s 内推到 1）
            const oil = scene.add.graphics();
            oil.fillStyle(oilColor, oilAlpha);
            oil.fillEllipse(0, 0, radius * 2, radius * 2 * PERSPECTIVE_SCALE_Y);
            oil.setPosition(tx, ty);
            oil.setScale(zone.oilFrac);
            oil.setDepth(ty - 1000); // 油脂图层最低（在所有实体之下）
            zone.flames.push(oil);
            zone.oilGfx = oil;
            // 油脂呼吸（明暗起伏加深，湿润感）
            scene.tweens.add({
                targets: oil,
                alpha: { from: 1, to: 0.55 },
                duration: 600,
                yoyo: true,
                repeat: -1,
            });
            // 反光层：只保留最外圈边缘反光（ADD 混合），错相位呼吸
            const glossCfg = oilCfg.gloss || {};
            const glossColor = typeof glossCfg.color === 'string' ? parseInt(glossCfg.color, 16) : (glossCfg.color ?? 0xffe9a0);
            const glossAlpha = glossCfg.alpha ?? 0.35;
            const gloss = scene.add.graphics();
            gloss.lineStyle(10, glossColor, glossAlpha);
            gloss.strokeEllipse(0, 0, radius * 2, radius * 2 * PERSPECTIVE_SCALE_Y);
            gloss.setPosition(tx, ty);
            gloss.setScale(zone.oilFrac);
            gloss.setBlendMode('ADD');
            gloss.setDepth(ty - 999);
            zone.flames.push(gloss);
            zone.glossGfx = gloss;
            scene.tweens.add({
                targets: gloss,
                alpha: { from: 1, to: 0.3 },
                duration: 450,
                yoyo: true,
                repeat: -1,
            });
        }
        this._burnZones.push(zone);
    }

    /**
     * 燃烧火焰（Phaser 粒子火焰，无贴图）：
     * impact_dot 软圆点 + ADD 发光混合，白→黄→橙随机 tint，向上漂移（焰尖向上），
     * 按 flameMorphMs 频率成簇喷发——柔软无像素描边的真火焰观感
     */
    _spawnBurnFlame(zone) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add) return;
        if (!scene.textures.exists('impact_dot') && typeof scene._ensureImpactDotTexture === 'function') {
            scene._ensureImpactDotTexture();
        }
        if (!scene.textures.exists('impact_dot')) return;
        const L = this._getLanternConfig();
        const radius = L.impactRadius ?? 300;
        // 只在油脂范围内喷发（跟随当前扩散进度）
        const spawnR = radius * (zone.oilFrac !== undefined ? zone.oilFrac : 1);
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * spawnR;
        const fx = zone.x + Math.cos(a) * rr;
        const fy = zone.y + Math.sin(a) * rr * PERSPECTIVE_SCALE_Y;
        const em = scene.add.particles(0, 0, 'impact_dot', {
            // 随机方向浮动（无统一上升偏向），自然散开成不规则火团
            speed: { min: 20, max: 70 },
            angle: { min: 0, max: 360 },
            scale: { start: 3.3, end: 0.3 },
            alpha: { start: 0.85, end: 0 },
            lifespan: 550,
            tint: [0xffffff, 0xffcc55, 0xff8833],
            blendMode: 'ADD',
            emitting: false,
        });
        // [Phaser 粒子坐标陷阱] 发射器必须留在 (0,0)，explode 传世界坐标；
        // setPosition(fx,fy) 后再 explode(fx,fy) 会双倍偏移到 (2fx,2fy) 飞出屏幕
        em.setDepth(fy + 1000);
        em.addToUpdateList();
        // 不规则火团：每颗粒子在喷发点周围 ±40px 随机偏移位置单独生成
        const count = L.flameBurstCount ?? 20;
        for (let i = 0; i < count; i++) {
            const jx = fx + (Math.random() - 0.5) * 80;
            const jy = fy + (Math.random() - 0.5) * 40 * PERSPECTIVE_SCALE_Y;
            em.explode(1, jx, jy);
        }
        // 一次性喷射器：喷完即销毁（不进 zone.flames，避免累积）
        scene.time.delayedCall(700, () => {
            if (em && em.active) em.destroy();
        });
    }

    _updateBurnZones(dt, entities) {
        for (let i = this._burnZones.length - 1; i >= 0; i--) {
            const zone = this._burnZones[i];
            zone.timer -= dt;
            if (zone.timer <= 0) {
                this._destroyBurnZone(zone);
                this._burnZones.splice(i, 1);
                continue;
            }
            zone.tickTimer -= dt;
            if (zone.tickTimer <= 0) {
                zone.tickTimer = this._getLanternConfig().tickMs ?? 500;
                this._dealBurnTick(zone, entities);
            }
            // 油脂扩散：growMs 内从落地点扩到最大范围（贴花与反光环同步缩放）
            if (zone.oilFrac !== undefined && zone.oilFrac < 1) {
                const growMs = this._getLanternConfig().oil?.growMs ?? 300;
                zone.oilFrac = Math.min(1, zone.oilFrac + dt / growMs);
                if (zone.oilGfx && zone.oilGfx.active) zone.oilGfx.setScale(zone.oilFrac);
                if (zone.glossGfx && zone.glossGfx.active) zone.glossGfx.setScale(zone.oilFrac);
            }
            // 火焰变幻：按 flameMorphMs 频率每 tick 在油脂区内 3 个点同时喷发
            zone.flameTimer -= dt;
            if (zone.flameTimer <= 0) {
                zone.flameTimer = this._getLanternConfig().flameMorphMs ?? 70;
                const burstPoints = this._getLanternConfig().flamePoints ?? 3;
                for (let n = 0; n < burstPoints; n++) {
                    this._spawnBurnFlame(zone);
                }
            }
        }
    }

    _dealBurnTick(zone, entities) {
        const L = this._getLanternConfig();
        const radius = L.impactRadius ?? 300;
        const matk = this.data?.matk || 0;
        const shape = new GroundEllipse(zone.x, zone.y, radius, radius * PERSPECTIVE_SCALE_Y);
        for (const e of hostilesOf(this, entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(matk * (L.damageMul ?? 0.75))), this, 'magic', false);
        }
    }

    _destroyBurnZone(zone) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        for (const flame of zone.flames) {
            if (flame && flame.active) {
                if (scene && scene.tweens) scene.tweens.killTweensOf(flame);
                if (typeof flame.stop === 'function') flame.stop();
                if (typeof flame.destroy === 'function') flame.destroy();
            }
        }
        zone.flames = [];
    }

    /** 统一特效清理（game.js removeEntity / onDeath 约定入口） */
    _destroyCustomEffects() {
        for (const zone of this._burnZones) this._destroyBurnZone(zone);
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
