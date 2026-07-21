import { Enemy } from '../enemy.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { FlySwarm } from './fly-swarm.js';
import { SoundManager } from '../../ui/sound-manager.js';
import enemyConfigData from '../../../data/enemy-config.json';
/**
 * 蝇手（领主 lord，僵尸 family）
 * 无默认普攻（aiInterval=MAX），三技能（数值全部由 enemy-config.json attackSkills 驱动）：
 * - 锤击（hammer）：1.5s 动画，hitFrames 帧判定 100px 单体伤害，命中击退 knockback px
 * - 砸地（slam）：2s 动画，hitFrames 帧判定 300px 范围 ×damageMul，命中眩晕 stunMs
 * - 灭世重砸（grandSlam）：同砸地但 ×2 伤害；判定帧无论命中与否，
 *   在周围 spreadRadius 随机位置召唤 count 只蝇群（_summoned 标签 + 地牢刷怪黑色粒子）
 */
export class FlyHand extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.flyHand,
            ...config
        });
        this._useStickFigure = false;
        this._animState = 'idle'; // idle | walk | hammer | slam | grandSlam
        // 攻击完全由本类技能自管：关闭 CombatSystem 通用近战触发（同集合体模式）
        this.aiInterval = Number.MAX_SAFE_INTEGER;
        // 动作期间锁定 MovementSystem（>0 时外部系统不驱动移动）
        this._attackAnimTimer = 0;

        this._actionTimer = 0;
        this._actionHitsDone = new Set();
        this._cooldowns = { hammer: 0, slam: 0, grandSlam: 0 };
        // 砸地冲击波 graphics（红圈扩散特效，统一清理用）
        this._slamGraphics = [];
    }

    _getSkillConfigs() {
        return (this.config && this.config.attackSkills) || {};
    }

    /** 播放配置音效（与手脑/骑士同工作流） */
    _playSound(key) {
        let path = this.config?.sounds?.[key];
        if (Array.isArray(path)) path = path[Math.floor(Math.random() * path.length)];
        if (path && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(path);
        }
    }

    update(dt, entities) {
        // 朝向驱动碰撞偏移（render.colliderOffsetFacing）：朝右 +N、朝左 -N（镜像），叠加在基础 offsetX 上
        const facing = this.config?.render?.colliderOffsetFacing || 0;
        if (facing) {
            const faceDir = Math.cos(this.rotation ?? 0) >= 0 ? 1 : -1;
            this.colliderOffsetX = (this.config.render.colliderOffsetX ?? 0) + faceDir * facing;
        }
        for (const k of Object.keys(this._cooldowns)) {
            if (this._cooldowns[k] > 0) this._cooldowns[k] -= dt;
        }
        if (this._attackAnimTimer > 0) this._attackAnimTimer = Math.max(0, this._attackAnimTimer - dt);
        this.updateStatusEffects(dt);

        // 眩晕时强制中断所有动作
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            this._endAction();
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            this._animState = 'idle';
            return;
        }
        // 恐惧时技能/动作中断（移动由 MovementSystem 恐惧分支接管逃跑）
        if (this.hasStatusEffect && this.hasStatusEffect('fear')) {
            return;
        }

        // 动作状态推进（进行中的动作优先）
        if (this._animState === 'hammer' || this._animState === 'slam' || this._animState === 'grandSlam') {
            this._updateAction(dt, entities);
            return;
        }

        // 普通 AI 移动
        super.update(dt, entities);

        // 技能决策：灭世重砸（大技能） > 砸地 > 锤击
        if (this.target && this.target.active) {
            this._decideSkills();
        }
        if (this._animState !== 'hammer' && this._animState !== 'slam' && this._animState !== 'grandSlam') {
            this._animState = this.isMoving ? 'walk' : 'idle';
        }
    }

    _decideSkills() {
        const t = this.target;
        const cfg = this._getSkillConfigs();
        // 灭世重砸：300px 有目标且 CD 就绪（精英预警后再启动）
        if (this._cooldowns.grandSlam <= 0 && cfg.grandSlam && this._isTargetInRange(t, cfg.grandSlam.triggerRange ?? 300)) {
            this._tryAttackTelegraph(() => this._startAction('grandSlam'));
            return;
        }
        // 砸地：300px 有目标且 CD 就绪（精英预警后再启动）
        if (this._cooldowns.slam <= 0 && cfg.slam && this._isTargetInRange(t, cfg.slam.triggerRange ?? 300)) {
            this._tryAttackTelegraph(() => this._startAction('slam'));
            return;
        }
        // 锤击：100px 近身且 CD 就绪（精英预警后再启动）
        if (this._cooldowns.hammer <= 0 && cfg.hammer && this._isTargetInRange(t, cfg.hammer.triggerRange ?? 100)) {
            this._tryAttackTelegraph(() => this._startAction('hammer'));
        }
    }

    // ========== 技能通用驱动 ==========

    _startAction(kind) {
        const cfg = this._getSkillConfigs()[kind];
        this._animState = kind;
        this._actionTimer = cfg.duration ?? 2000;
        this._attackAnimTimer = cfg.duration ?? 2000; // 锁定 MovementSystem，攻击时不可移动
        this._cooldowns[kind] = cfg.cooldown ?? 8000;
        this._actionHitsDone = new Set();
        this._summonDone = false;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        // 面向目标
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    _updateAction(dt, entities) {
        const kind = this._animState;
        const cfg = this._getSkillConfigs()[kind];
        this._actionTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        // 命中帧时点判定（hitFrames 为 1 起始帧号，对齐动画进度）
        const duration = cfg.duration ?? 2000;
        const elapsed = duration - this._actionTimer;
        const frames = cfg.frames || 1;
        const hitFrames = cfg.hitFrames || [];
        for (let i = 0; i < hitFrames.length; i++) {
            if (this._actionHitsDone.has(i)) continue;
            const t = ((hitFrames[i] - 1) / frames) * duration;
            if (elapsed >= t) {
                this._actionHitsDone.add(i);
                this._dealHit(kind, cfg, entities);
            }
        }
        if (this._actionTimer <= 0) this._endAction();
    }

    _dealHit(kind, cfg, entities) {
        const range = cfg.range ?? 100;
        const atk = this.data?.atk || 0;
        const damage = Math.max(1, Math.round(atk * (cfg.damageMul ?? 1)));
        // 攻击判定帧播放打击音（三技能统一）
        this._playSound('attack');
        // 灭世重砸：无论是否命中，判定帧召唤蝇群
        if (kind === 'grandSlam' && cfg.summon && !this._summonDone) {
            this._summonDone = true;
            this._summonFlySwarms(cfg.summon);
        }
        if (kind === 'hammer') {
            // 单体近战：目标在判定距离内才结算
            const t = this.target;
            if (t && t.active && t.hittable && this._isTargetInRange(t, range)) {
                t.takeDamage(damage, this, cfg.damageType || 'physical', true);
                if (cfg.knockback && t.applyKnockback) {
                    const angle = Math.atan2(t.y - this.y, t.x - this.x);
                    t.applyKnockback(angle, cfg.knockback);
                }
            }
            return;
        }
        // 范围技能：椭圆判定（2:1 平面透视）
        const shape = new GroundEllipse(this.x, this.y, range, range * PERSPECTIVE_SCALE_Y);
        // 砸地红圈扩散特效（判定帧触发，扩散到攻击影响范围）
        this._fireSlamShockwave(range);
        for (const e of this._hostiles(entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(damage, this, cfg.damageType || 'physical', true);
            if (cfg.stunMs && typeof e.applyStun === 'function') e.applyStun(cfg.stunMs);
        }
    }

    /**
     * 砸地冲击波：判定帧从蝇手中心释放红色椭圆圈，
     * 扩散到攻击影响范围并淡出（复刻手脑/集合体模式，平面透视 2:1）
     */
    _fireSlamShockwave(maxRadius) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.tweens) return;
        const g = scene.add.graphics();
        g.setDepth(this.y + 50);
        this._slamGraphics.push(g);
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
                const idx = self._slamGraphics.indexOf(g);
                if (idx >= 0) self._slamGraphics.splice(idx, 1);
            }
        });
    }

    /** 统一特效清理（game.js removeEntity / onDeath 约定入口） */
    _destroyCustomEffects() {
        for (const g of this._slamGraphics) {
            if (g && g.active) g.destroy();
        }
        this._slamGraphics = [];
    }

    /** 召唤蝇群：周围 spreadRadius 随机位置 count 只（_summoned 标签 + 地牢刷怪黑色粒子） */
    _summonFlySwarms(summon) {
        const count = summon.count ?? 3;
        const spread = summon.spreadRadius ?? 50;
        const spawnScene = typeof window !== 'undefined' ? window.__phaserScene : null;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * spread;
            const sx = this.x + Math.cos(angle) * dist;
            const sy = this.y + Math.sin(angle) * dist;
            const fly = new FlySwarm(sx, sy, { showWeapon: false });
            // 召唤物统一标签：不掉金币/经验/技能修炼值
            fly._summoned = true;
            if (typeof window !== 'undefined' && window.Game && window.Game.entities) {
                window.Game.entities.set(`flyhand_fly_${Date.now()}_${i}_${Math.floor(Math.random() * 10000)}`, fly);
            }
            // 地牢刷怪同款黑色粒子（脚下）
            if (spawnScene && typeof spawnScene.playDungeonSpawnParticles === 'function') {
                spawnScene.playDungeonSpawnParticles(sx, sy);
            }
        }
    }

    _endAction() {
        if (this._animState === 'hammer' || this._animState === 'slam' || this._animState === 'grandSlam') {
            this._animState = 'idle';
        }
        this._actionTimer = 0;
        this._actionHitsDone = new Set();
        this._attackAnimTimer = 0;
    }

    // ========== 工具 ==========

    /** 范围内敌对可击单位（与集合体 _hostiles 同语义） */
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

    /** 判定目标是否在指定范围内（统一使用 Collider 地面 footprint 半径） */
    _isTargetInRange(target, range) {
        if (!target) return false;
        const r = Math.max(0, range);
        const targetR = target.groundRadius || target.collisionRadius || target.size * 0.6 || 0;
        const dist = Math.hypot(target.x - this.x, target.y - this.y);
        return dist <= r + targetR;
    }

    // ========== 渲染 ==========

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_flyhand_walk';
            case 'hammer': return 'enemy_flyhand_hammer';
            case 'slam': return 'enemy_flyhand_slam';
            case 'grandSlam': return 'enemy_flyhand_grand_slam';
            default: return 'enemy_flyhand_idle';
        }
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        let flipX = false;
        if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }
        return {
            spriteSize: renderCfg.spriteSize || 260,
            flipX,
            animState: this._animState,
            animKey: this._getTextureKey(),
        };
    }
}
