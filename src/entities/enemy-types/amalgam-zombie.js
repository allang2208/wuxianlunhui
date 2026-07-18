import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { WallSystem } from '../../world/wall-system.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { AimHelper } from '../../utils/aim-helper.js';

/**
 * 集合体（AmalgamZombie，首领）
 * - 站桩 Boss（speed 0），不会移动，面朝目标
 * - 攻击状态一（投掷 throw）：播放 25 帧投掷动画，第 16 帧向锁定落点抛出投射物；
 *   投掷前至落地在落点显示红色椭圆警示（impactRadius）；落地造成椭圆范围物理伤害，
 *   并在落点生成一只胖子僵尸（工厂由生成方注入 this._createFatZombie）
 * - 攻击状态二（砸地 slam）：播放 32 帧砸地动画，在 hitFrames 各帧对周围椭圆区域
 *   分圈结算物理伤害（各自判定不叠加：取目标所在最小圈）
 * - 特殊技能（召唤 summon）：冷却到期且在非攻击状态时，于下方 offsetY 处召唤 count 只僵尸
 *   （工厂由生成方注入 this._createBasicZombie）；释放时不打断当前动画（播放 idle）
 * - 死亡：播放 28 帧 melting，停最后一帧 corpseHold 毫秒后销毁
 *
 * 所有数值（冷却/帧时机/半径/倍率/召唤参数）均来自 enemy-config.json 的
 * amalgamZombie.attackSkills / deathAnim / render，类内不硬编码。
 */
export class AmalgamZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.amalgamZombie,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;

        // 强制显性编码：站桩首领，移动/击退/分离全部锁死为 0
        this.speed = 0;
        this.maxSpeed = 0;
        this.vx = 0;
        this.vy = 0;
        this.knockbackX = 0;
        this.knockbackY = 0;
        // 锚定出生点：任何残留位移通道都无法让其离开锚点（见 update 末尾）
        this._anchorX = this.x;
        this._anchorY = this.y;
        // 实体分离中不可被推开（对方承担全部重叠位移，见 game.js resolveCollisions）
        this.noSeparation = true;
        // footprint 判定圆上移（配置 render.colliderOffsetY，配合贴图身体上移）
        this.colliderOffsetY = (this.config?.render?.colliderOffsetY) ?? 0;
        // 弹反免疫（配置 parryImmune）：弹反不造成眩晕/打断/击退，仅玩家侧收益正常
        this._parryImmune = this.config?.parryImmune ?? false;

        // 攻击/召唤完全由本类自管：关闭 CombatSystem 的通用近战触发（同 mutant-3 模式）
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 动画状态：idle | attack | death；攻击细分 throw | slam
        this._animState = 'idle';
        this._attackKind = null;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._hitsDone = new Set();

        // 技能冷却（开局即可用）
        const skills = this._getSkillConfigs();
        this._slamCd = 0;
        this._throwCd = 0;
        this._summonCd = skills.summon.cooldown;

        // 投掷状态
        this._throwTarget = null;
        this._throwFired = false;
        this._throwWarning = null;
        this._throwSprite = null;

        // 音效：待机环境音计时（间隔由配置 sounds.idleInterval 驱动）
        this._idleSoundTimer = 0;

        // 死亡动画（ melting 播完停最后一帧 corpseHold ms 后销毁 ）
        const deathCfg = this._getDeathConfig();
        this._preserveCorpse = true;
        this._deathAnimDuration = deathCfg.duration;
        this._corpseDuration = deathCfg.corpseHold;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._deathAnimPlayed = false;
    }

    _getSkillConfigs() {
        const s = this.config?.attackSkills || {};
        return {
            slam: s.slam || {},
            throw: s.throw || {},
            summon: s.summon || {},
        };
    }

    _getDeathConfig() {
        return this.config?.deathAnim || {};
    }

    /**
     * 播放配置音效（enemy-config.json 的 sounds 块驱动）
     * @param {string} key 音效键：idle / throw / impact / slamHit / death
     */
    _playSound(key) {
        const path = this.config?.sounds?.[key];
        if (path && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(path);
        }
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateCorpse(dt);
            return;
        }

        super.update(dt, entities);

        // 强制显性编码：每帧锁死一切位移通道（移动/击退速度/击退累积）
        this.vx = 0;
        this.vy = 0;
        this.knockbackX = 0;
        this.knockbackY = 0;
        // 锚定出生点：无论何种系统写入位置，每帧强制归位
        this.x = this._anchorX;
        this.y = this._anchorY;

        // 冷却推进
        if (this._slamCd > 0) this._slamCd = Math.max(0, this._slamCd - dt);
        if (this._throwCd > 0) this._throwCd = Math.max(0, this._throwCd - dt);
        if (this._summonCd > 0) this._summonCd = Math.max(0, this._summonCd - dt);

        if (this._attackTimer > 0) {
            // 攻击动画推进中
            this._attackTimer = Math.max(0, this._attackTimer - dt);
            if (this._attackAnimTimer > 0) this._attackAnimTimer = Math.max(0, this._attackAnimTimer - dt);
            const cfg = this._getSkillConfigs()[this._attackKind] || {};
            const elapsed = (cfg.duration || 0) - this._attackTimer;
            if (this._attackKind === 'slam') {
                this._updateSlamHits(elapsed, entities);
            } else if (this._attackKind === 'throw') {
                this._updateThrowFire(elapsed);
            }
            if (this._attackTimer <= 0) {
                this._animState = 'idle';
                // 砸地结束：取消范围显示
                if (this._attackKind === 'slam') this._destroySlamZoneDisplay();
                this._attackKind = null;
            }
        } else {
            this._decideAttack();
            this._updateSummon();
        }

        // 站桩 Boss：始终面朝目标
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }

        // 待机环境音：idle 状态下按间隔循环播放（有目标且非攻击状态时）
        if (this._animState === 'idle' && this.target && this.target.active) {
            this._idleSoundTimer -= dt;
            if (this._idleSoundTimer <= 0) {
                this._idleSoundTimer = this.config?.sounds?.idleInterval ?? 3000;
                this._playSound('idle');
            }
        } else {
            this._idleSoundTimer = 0;
        }

        // 投掷警示圈保活
        this._refreshWarning();
    }

    // ========== 攻击决策 ==========

    _decideAttack() {
        if (!this.target || !this.target.active) return;
        const skills = this._getSkillConfigs();
        // 砸地攻击：CD 一旦满足立即释放（有目标即可，不再受 triggerRange 限制——
        // 此前 footprint 扩大后玩家无法进入 250 触发范围，导致砸地永远放不出来）
        if (this._slamCd <= 0 && skills.slam.duration) {
            this._startAttack('slam');
        } else if (this._throwCd <= 0 && skills.throw.duration) {
            this._startAttack('throw');
        }
    }

    _startAttack(kind) {
        const cfg = this._getSkillConfigs()[kind];
        this._attackKind = kind;
        this._attackTimer = cfg.duration;
        this._attackAnimTimer = cfg.duration; // 冻结 MovementSystem 朝向覆盖
        this._animState = 'attack';
        this._hitsDone = new Set();
        if (kind === 'slam') {
            this._slamCd = cfg.cooldown ?? 7000;
            // 砸地的范围提示改为每个伤害帧释放的冲击波动画（见 _applySlamDamage → _fireSlamShockwave）
        } else {
            this._throwCd = cfg.cooldown ?? 15000;
            // 预判目标移动轨迹（与僵尸巫师/毒液僵尸同一 AimHelper.lead 实现）：
            // 延迟 = 出手帧时间 + 投射物飞行时间；落点与警示圈均按预判点显示
            const t = this.target && this.target.active ? this.target : null;
            if (t) {
                const dx = t.x - this.x, dy = t.y - this.y;
                const dist = Math.hypot(dx, dy);
                const flyS = (cfg.flyDuration ?? 600) / 1000;
                const fireDelayS = (((cfg.fireFrame || 1) - 1) / (cfg.frames || 1)) * (cfg.duration || 0) / 1000;
                const projSpeed = flyS > 0 ? dist / flyS : 1000;
                const lead = AimHelper.lead(this.x, this.y, t.x, t.y, t.vx || 0, t.vy || 0, projSpeed, fireDelayS);
                this._throwTarget = { x: lead.x, y: lead.y };
            } else {
                this._throwTarget = { x: this.x, y: this.y };
            }
            this._throwFired = false;
            this._createWarning(this._throwTarget.x, this._throwTarget.y, cfg.impactRadius || 45);
        }
    }

    // ========== 攻击状态二：砸地（slam） ==========

    _updateSlamHits(elapsed, entities) {
        const cfg = this._getSkillConfigs().slam;
        const hitFrames = cfg.hitFrames || [];
        for (let i = 0; i < hitFrames.length; i++) {
            if (this._hitsDone.has(i)) continue;
            const t = ((hitFrames[i] - 1) / (cfg.frames || 1)) * (cfg.duration || 0);
            if (elapsed >= t) {
                this._hitsDone.add(i);
                this._applySlamDamage(entities);
            }
        }
    }

    /**
     * 分圈结算：目标只承受其所在最小圈的伤害（各自判定，不叠加）
     */
    _applySlamDamage(entities) {
        const cfg = this._getSkillConfigs().slam;
        const zones = cfg.zones || [];
        const atk = this.data?.atk || 0;
        this._playSound('slamHit');
        // 每个伤害帧释放一次冲击波（红色椭圆圈由中心扩散）
        this._fireSlamShockwave();
        for (const e of this._hostiles(entities)) {
            for (const zone of zones) {
                const shape = new GroundEllipse(this.x, this.y, zone.radius, zone.radius * PERSPECTIVE_SCALE_Y);
                if (shape.intersectsEntity(e)) {
                    e.takeDamage(atk * (zone.damageMul ?? 1), this, 'physical', true);
                    break;
                }
            }
        }
    }

    // ========== 攻击状态一：投掷（throw） ==========

    _updateThrowFire(elapsed) {
        const cfg = this._getSkillConfigs().throw;
        const fireT = (((cfg.fireFrame || 1) - 1) / (cfg.frames || 1)) * (cfg.duration || 0);
        if (!this._throwFired && elapsed >= fireT) {
            this._throwFired = true;
            this._playSound('throw');
            this._launchProjectile(this._throwTarget.x, this._throwTarget.y);
        }
    }

    _launchProjectile(tx, ty) {
        const cfg = this._getSkillConfigs().throw;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add) {
            // 无渲染场景时直接结算（防御性回退）
            this._impactThrow(tx, ty);
            return;
        }
        const size = cfg.projectileSize || 48;
        const sx = this.x;
        const sy = this.y - (this.footOffsetY || 0);
        const sprite = scene.add.sprite(sx, sy, 'enemy_amalgam_project');
        sprite.setDisplaySize(size, size);
        sprite.setDepth(this.y + 15);
        this._throwSprite = sprite;
        const arcH = cfg.arcHeight ?? 120;
        const self = this;
        scene.tweens.add({
            targets: { t: 0 },
            t: 1,
            duration: cfg.flyDuration ?? 600,
            ease: 'Linear',
            onUpdate(tw) {
                const t = tw.getValue();
                sprite.x = sx + (tx - sx) * t;
                sprite.y = sy + (ty - sy) * t - arcH * 4 * t * (1 - t);
            },
            onComplete() {
                if (sprite.active) sprite.destroy();
                if (self._throwSprite === sprite) self._throwSprite = null;
                self._impactThrow(tx, ty);
            }
        });
    }

    _impactThrow(tx, ty) {
        this._destroyWarning();
        this._playSound('impact');
        const cfg = this._getSkillConfigs().throw;
        const radius = cfg.impactRadius || 45;
        const atk = this.data?.atk || 0;
        // 落点椭圆范围伤害
        const shape = new GroundEllipse(tx, ty, radius, radius * PERSPECTIVE_SCALE_Y);
        for (const e of this._hostiles()) {
            if (shape.intersectsEntity(e)) {
                e.takeDamage(atk * (cfg.damageMul ?? 1), this, 'physical', false);
            }
        }
        // 落点黄褐色冲击粒子（更大更多，持续 1.5 秒）
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && typeof scene.playTanImpactParticles === 'function') {
            scene.playTanImpactParticles(tx, ty);
        }
        // 在落点生成一只胖子僵尸（工厂由生成方注入）
        if (typeof this._createFatZombie === 'function') {
            let sx = tx, sy = ty;
            try {
                // 落点被墙阻挡时，沿螺旋外推到最近合法位置
                if (WallSystem && typeof WallSystem.canMoveTo === 'function' && !WallSystem.canMoveTo(tx, ty, 30)) {
                    const r = WallSystem.findSafeSpawn(tx, ty, 30);
                    if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) { sx = r.x; sy = r.y; }
                }
            } catch (_e) { /* 墙体校验失败时使用原落点 */ }
            const fat = this._createFatZombie(sx, sy);
            if (fat) {
                // 召唤物统一标签：不掉金币/经验/技能修炼值（不影响地牢原有怪物）
                fat._summoned = true;
            }
            if (fat && typeof window !== 'undefined' && window.Game && window.Game.entities) {
                window.Game.entities.set(`amalgam_fat_${Date.now()}_${Math.floor(Math.random() * 10000)}`, fat);
            }
        }
    }

    _createWarning(x, y, radius) {
        this._destroyWarning();
        // 红色椭圆警示（与 footprint 椭圆同 2:1 透视），逐帧保活至落地
        const warn = new AttackRangeEffect(x, y, 0, radius, radius * PERSPECTIVE_SCALE_Y, 'ellipse', 100, 0.5, true);
        warn.maxLife = 100;
        EffectManager.add(warn);
        this._throwWarning = warn;
    }

    /**
     * 砸地冲击波：每次伤害判定时从集合体中心释放一个红色椭圆圈，
     * 由中心扩散到最大伤害圈半径并淡出（平面透视 2:1，地面扩散方案）。
     */
    _fireSlamShockwave() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.tweens) return;
        const zones = this._getSkillConfigs().slam.zones || [];
        const maxRadius = zones.length ? Math.max(...zones.map(z => z.radius)) : 500;
        const g = scene.add.graphics();
        g.setDepth(this.y + 50);
        if (!Array.isArray(this._slamZoneGraphics)) this._slamZoneGraphics = [];
        this._slamZoneGraphics.push(g);
        const wave = { t: 0 };
        const self = this;
        scene.tweens.add({
            targets: wave,
            t: 1,
            duration: 600,
            ease: 'Cubic.easeOut',
            onUpdate() {
                const t = wave.t;
                const r = Math.max(1, maxRadius * t);
                g.clear();
                // 闪烁：高频正弦叠加在淡出曲线上，冲击波呈脉冲感
                const flicker = 0.55 + 0.45 * Math.sin(t * Math.PI * 8);
                // 加粗冲击波描边（随扩散淡出 × 闪烁）+ 极淡填充
                g.lineStyle(8, 0xff3030, (1 - t) * 0.9 * flicker);
                g.strokeEllipse(self.x, self.y, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);
                g.fillStyle(0xff4040, (1 - t) * 0.12 * flicker);
                g.fillEllipse(self.x, self.y, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);
            },
            onComplete() {
                if (g.active) g.destroy();
                if (Array.isArray(self._slamZoneGraphics)) {
                    const idx = self._slamZoneGraphics.indexOf(g);
                    if (idx >= 0) self._slamZoneGraphics.splice(idx, 1);
                }
            }
        });
    }

    _destroySlamZoneDisplay() {
        if (this._slamZoneGraphics) {
            for (const g of this._slamZoneGraphics) {
                if (g && g.active) g.destroy();
            }
            this._slamZoneGraphics = null;
        }
    }

    /**
     * 自定义特效统一清理（怪物死亡/被 removeEntity 移除时调用，防特效残留）
     */
    _destroyCustomEffects() {
        this._destroyWarning();
        this._destroySlamZoneDisplay();
        if (this._throwSprite && this._throwSprite.active) {
            this._throwSprite.destroy();
        }
        this._throwSprite = null;
    }

    _refreshWarning() {
        if (!this._throwWarning) return;
        if (!this._throwWarning.active) {
            this._throwWarning = null;
            return;
        }
        this._throwWarning.life = this._throwWarning.maxLife;
    }

    _destroyWarning() {
        if (this._throwWarning) {
            this._throwWarning.active = false;
            // 立即销毁 Phaser 图形：EffectManager 移除后不会再触发 update 的延迟销毁，
            // 仅靠 active=false 会让警示圈永久残留（必须在落地事件中销毁）
            if (typeof this._throwWarning._destroyPhaserGraphics === 'function') {
                this._throwWarning._destroyPhaserGraphics();
            }
            this._throwWarning = null;
        }
    }

    // ========== 特殊技能：召唤 ==========

    _updateSummon() {
        const cfg = this._getSkillConfigs().summon;
        if (this._summonCd > 0) return;
        if (!this.target || !this.target.active) return;
        if (this._attackTimer > 0) return; // 攻击动作中不召唤（保持 idle 动画）
        this._summonCd = cfg.cooldown ?? 15000;
        if (typeof this._createBasicZombie !== 'function') return;
        const count = cfg.count ?? 2;
        const offsetY = cfg.offsetY ?? 150;
        const spreadX = cfg.spreadX ?? 40;
        for (let i = 0; i < count; i++) {
            const rawX = this.x + (i - (count - 1) / 2) * spreadX * 2;
            const rawY = this.y + offsetY;
            let sx = rawX, sy = rawY;
            try {
                // 落点被墙阻挡时，沿螺旋外推到最近合法位置
                if (WallSystem && typeof WallSystem.canMoveTo === 'function' && !WallSystem.canMoveTo(rawX, rawY, 15)) {
                    const r = WallSystem.findSafeSpawn(rawX, rawY, 15);
                    if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) { sx = r.x; sy = r.y; }
                }
            } catch (_e) { /* 墙体校验失败时使用原始位置 */ }
            const z = this._createBasicZombie(sx, sy);
            if (z) {
                // 召唤物统一标签：不掉金币/经验/技能修炼值（不影响地牢原有僵尸）
                z._summoned = true;
                // 召唤点脚下生成地牢刷怪同款黑色粒子效果
                const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
                if (scene && typeof scene.playDungeonSpawnParticles === 'function') {
                    scene.playDungeonSpawnParticles(sx, sy);
                }
            }
            if (z && typeof window !== 'undefined' && window.Game && window.Game.entities) {
                window.Game.entities.set(`amalgam_zombie_${Date.now()}_${i}_${Math.floor(Math.random() * 10000)}`, z);
            }
        }
    }

    // ========== 敌对目标 ==========

    /**
     * 站桩首领：免疫一切击退（强制显性编码，击退通道永不累积）
     */
    applyKnockback(_angle, _totalPx) {
        // 故意为空
    }

    _hostiles(entities) {
        const list = Array.isArray(entities)
            ? entities
            : (entities ? Array.from(entities.values()) : []);
        const src = list.length > 0
            ? list
            : (typeof window !== 'undefined' && window.Game && window.Game.entities
                ? Array.from(window.Game.entities.values()) : []);
        const out = [];
        for (const e of src) {
            if (!e || e === this || !e.active || !e.hittable) continue;
            if (e._faction === this._faction) continue;
            out.push(e);
        }
        return out;
    }

    // ========== 死亡 ==========

    _updateCorpse(dt) {
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer -= dt;
            if (this._deathAnimTimer <= 0) {
                this._deathAnimTimer = 0;
                this._corpseTimer = this._corpseDuration;
            }
        } else if (this._corpseTimer > 0) {
            this._corpseTimer -= dt;
            if (this._corpseTimer <= 0) {
                this._corpseTimer = 0;
                if (this._phaserSprite && this._phaserSprite.active) {
                    this._phaserSprite.destroy();
                    this._phaserSprite = null;
                }
            }
        }
    }

    onDeath(source) {
        // 清理进行中的投掷物/警示/范围显示（含砸地范围圈）
        this._destroyCustomEffects();
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        // 死亡音效
        this._playSound('death');

        this.active = false;
        this._animState = 'death';
        this._deathAnimTimer = this._deathAnimDuration;
        this._corpseTimer = 0;
        this._deathAnimPlayed = false;
        this._deathTime = Date.now();
        this._deathRemoveDelay = this._deathAnimDuration + this._corpseDuration + 500;

        if (typeof super.onDeath === 'function') {
            const preserve = this._preserveCorpse;
            this._preserveCorpse = true;
            super.onDeath(source);
            this._preserveCorpse = preserve;
        }
    }

    // ========== 渲染 ==========

    _getTextureKey() {
        if (this._animState === 'attack') {
            return this._attackKind === 'throw' ? 'enemy_amalgam_attack_throw' : 'enemy_amalgam_attack_slam';
        }
        if (this._animState === 'death') return 'enemy_amalgam_melt';
        return 'enemy_amalgam_idle';
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 200;
        let flipX = false;
        if (this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }
        let animKey = 'enemy_amalgam_idle';
        if (this._animState === 'attack') {
            animKey = this._attackKind === 'throw' ? 'enemy_amalgam_attack_throw' : 'enemy_amalgam_attack_slam';
        } else if (this._animState === 'death') {
            animKey = 'enemy_amalgam_death';
        }
        const options = {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 100,
            collisionHeight: renderCfg.collisionHeight || 180,
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState: this._animState,
            animKey,
        };
        // 死亡动画结束后停在最后一帧
        const deathCfg = this._getDeathConfig();
        if (this._animState === 'death' && this._deathAnimTimer <= 0 && this._corpseTimer > 0 && deathCfg.lastFrame !== undefined) {
            options.frame = deathCfg.lastFrame;
        }
        return options;
    }
}
