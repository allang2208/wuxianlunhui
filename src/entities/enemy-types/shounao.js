import { Enemy } from '../enemy.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import enemyConfigData from '../../../data/enemy-config.json';

/**
 * 手脑（领主 lord）
 * 技能（数值全部由 enemy-config.json 的 attackSkills 驱动）：
 * - 砸地（slam）：2s 动画，hitFrames 帧时点判定，300px 范围物理攻击 ×damageMul；攻击时不可移动
 * - 嚎叫（howl）：3s 持续动画（动画时长=技能时长），600px 范围每 tickMs 受到魔法攻击 ×damageMul 的魔法伤害
 */
export class Shounao extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.shounao,
            ...config
        });
        this._useStickFigure = false;
        this._animState = 'idle'; // idle | walk | slam | howl
        // 动作期间锁定 MovementSystem（与集合体/骑士同机制）：>0 时外部系统不驱动移动
        this._attackAnimTimer = 0;

        // 砸地状态
        this._slamTimer = 0;
        this._slamCooldown = 0;
        this._slamHitsDone = new Set();

        // 嚎叫状态
        this._howlTimer = 0;
        this._howlCooldown = 0;
        this._howlTickTimer = 0;
        // 嚎叫冲击波 graphics（扩散圈特效，统一清理用）
        this._howlGraphics = [];
        // 砸地冲击白线 graphics（统一清理用）
        this._slamGraphics = [];
    }

    _getSkillConfigs() {
        return (this.config && this.config.attackSkills) || {};
    }

    update(dt, entities) {
        if (this._slamCooldown > 0) this._slamCooldown -= dt;
        if (this._howlCooldown > 0) this._howlCooldown -= dt;
        if (this._attackAnimTimer > 0) this._attackAnimTimer = Math.max(0, this._attackAnimTimer - dt);
        this.updateStatusEffects(dt);

        // 眩晕时强制中断所有动作
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            this._endSlam();
            this._endHowl();
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            this._animState = 'idle';
            return;
        }

        // 动作状态推进（进行中的动作优先）
        if (this._animState === 'slam') { this._updateSlam(dt, entities); return; }
        if (this._animState === 'howl') { this._updateHowl(dt, entities); return; }

        // 普通 AI 移动
        super.update(dt, entities);

        // 技能决策：砸地（近程优先） > 嚎叫（远程）
        if (this.target && this.target.active) {
            this._decideSkills();
        }
        if (this._animState !== 'slam' && this._animState !== 'howl') {
            this._animState = this.isMoving ? 'walk' : 'idle';
        }
    }

    _decideSkills() {
        const t = this.target;
        const cfg = this._getSkillConfigs();

        // 砸地：周围 300px 有目标就触发
        if (this._slamCooldown <= 0 && cfg.slam && cfg.slam.duration) {
            if (this._isTargetInRange(t, cfg.slam.triggerRange ?? 300)) {
                this._startSlam();
                return;
            }
        }

        // 嚎叫：600px 内有目标且 CD 就绪
        if (this._howlCooldown <= 0 && cfg.howl && cfg.howl.duration) {
            if (this._isTargetInRange(t, cfg.howl.triggerRange ?? 600)) {
                this._startHowl();
            }
        }
    }

    // ========== 砸地 ==========

    _startSlam() {
        const cfg = this._getSkillConfigs().slam;
        this._animState = 'slam';
        this._slamTimer = cfg.duration ?? 2000;
        this._attackAnimTimer = cfg.duration ?? 2000; // 锁定 MovementSystem，砸地期间不可移动
        this._slamCooldown = cfg.cooldown ?? 6000;
        this._slamHitsDone = new Set();
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        // 面向目标起跳砸地
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    _updateSlam(dt, entities) {
        const cfg = this._getSkillConfigs().slam;
        this._slamTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        // 命中帧时点判定（hitFrames 为 1 起始帧号，对齐动画进度）
        const duration = cfg.duration ?? 2000;
        const elapsed = duration - this._slamTimer;
        const frames = cfg.frames || 1;
        const hitFrames = cfg.hitFrames || [];
        for (let i = 0; i < hitFrames.length; i++) {
            if (this._slamHitsDone.has(i)) continue;
            const t = ((hitFrames[i] - 1) / frames) * duration;
            if (elapsed >= t) {
                this._slamHitsDone.add(i);
                this._dealSlamHit(entities);
            }
        }
        if (this._slamTimer <= 0) this._endSlam();
    }

    _dealSlamHit(entities) {
        const cfg = this._getSkillConfigs().slam;
        const range = cfg.range ?? 300;
        const atk = this.data?.atk || 0;
        // 砸地落点特效：烟尘四周扩散轻微上浮 + 白色放射冲击线
        this._fireSlamDust();
        this._fireSlamImpactLines();
        // 椭圆判定（2:1 平面透视），与地面视觉圈一致
        const shape = new GroundEllipse(this.x, this.y, range, range * PERSPECTIVE_SCALE_Y);
        for (const e of this._hostiles(entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 2))), this, 'physical', true);
        }
    }

    /** 砸地特效锚点：朝向右时下移 25px 右移 50px（朝左镜像） */
    _slamFxAnchor() {
        const faceDir = Math.cos(this.rotation ?? 0) >= 0 ? 1 : -1;
        return { x: this.x + faceDir * 50, y: this.y + 25 };
    }

    /** 砸地烟尘：绕落点四周扩散生成（粒子自带轻微上浮分量） */
    _fireSlamDust() {
        const a = this._slamFxAnchor();
        const count = 8;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const ox = Math.cos(angle) * 30;
            const oy = Math.sin(angle) * 30 * PERSPECTIVE_SCALE_Y;
            EffectFactory.createDustEffect(a.x + ox, a.y + oy + 6, 0.9);
        }
    }

    /** 砸地冲击白线：落点向外放射的白色线条，快速扩散淡出 */
    _fireSlamImpactLines() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.tweens) return;
        const g = scene.add.graphics();
        g.setDepth(this.y + 50);
        this._slamGraphics.push(g);
        const wave = { t: 0 };
        const self = this;
        const lineCount = 8;
        scene.tweens.add({
            targets: wave,
            t: 1,
            duration: 280,
            ease: 'Cubic.easeOut',
            onUpdate() {
                const t = wave.t;
                g.clear();
                const alpha = (1 - t) * 0.9;
                g.lineStyle(3, 0xffffff, alpha);
                // 线条长度延长 50%
                const inner = (20 + t * 50) * 1.5;
                const outer = (50 + t * 90) * 1.5;
                const a = self._slamFxAnchor();
                for (let i = 0; i < lineCount; i++) {
                    const angle = (Math.PI * 2 * i) / lineCount + Math.PI / lineCount;
                    // 平面透视：y 分量按 PERSPECTIVE_SCALE_Y 压缩
                    const cos = Math.cos(angle), sin = Math.sin(angle) * PERSPECTIVE_SCALE_Y;
                    g.beginPath();
                    g.moveTo(a.x + cos * inner, a.y + sin * inner);
                    g.lineTo(a.x + cos * outer, a.y + sin * outer);
                    g.strokePath();
                }
            },
            onComplete() {
                if (g.active) g.destroy();
                const idx = self._slamGraphics.indexOf(g);
                if (idx >= 0) self._slamGraphics.splice(idx, 1);
            }
        });
    }

    _endSlam() {
        if (this._animState === 'slam') this._animState = 'idle';
        this._slamTimer = 0;
        this._slamHitsDone = new Set();
        this._attackAnimTimer = 0;
    }

    // ========== 嚎叫 ==========

    _startHowl() {
        const cfg = this._getSkillConfigs().howl;
        this._animState = 'howl';
        this._howlTimer = cfg.duration ?? 3000;
        this._attackAnimTimer = cfg.duration ?? 3000; // 锁定 MovementSystem，嚎叫期间不可移动
        this._howlCooldown = cfg.cooldown ?? 30000;
        this._howlTickTimer = 0; // 立即判定第一跳
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
    }

    /**
     * 嚎叫冲击波：释放时从手脑中心释放一个紫色椭圆圈，
     * 由中心扩散到嚎叫影响范围并淡出（复刻集合体 _fireSlamShockwave 模式，平面透视 2:1）。
     */
    _fireHowlShockwave() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.tweens) return;
        const cfg = this._getSkillConfigs().howl;
        const maxRadius = cfg.range ?? 600;
        const g = scene.add.graphics();
        g.setDepth(this.y + 50);
        this._howlGraphics.push(g);
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
                g.lineStyle(8, 0xa060ff, (1 - t) * 0.9 * flicker);
                g.strokeEllipse(self.x, self.y, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);
                g.fillStyle(0xb080ff, (1 - t) * 0.12 * flicker);
                g.fillEllipse(self.x, self.y, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);
            },
            onComplete() {
                if (g.active) g.destroy();
                const idx = self._howlGraphics.indexOf(g);
                if (idx >= 0) self._howlGraphics.splice(idx, 1);
            }
        });
    }

    /** 统一特效清理（game.js removeEntity 约定入口） */
    _destroyCustomEffects() {
        for (const g of this._howlGraphics) {
            if (g && g.active) g.destroy();
        }
        this._howlGraphics = [];
        for (const g of this._slamGraphics) {
            if (g && g.active) g.destroy();
        }
        this._slamGraphics = [];
    }

    _updateHowl(dt, entities) {
        const cfg = this._getSkillConfigs().howl;
        this._howlTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        // 持续判定：每 tickMs 对范围内敌对单位造成一次魔法伤害
        this._howlTickTimer -= dt;
        if (this._howlTickTimer <= 0) {
            this._howlTickTimer = cfg.tickMs ?? 500;
            this._dealHowlTick(entities);
        }
        if (this._howlTimer <= 0) this._endHowl();
    }

    _dealHowlTick(entities) {
        const cfg = this._getSkillConfigs().howl;
        const range = cfg.range ?? 600;
        const matk = this.data?.matk || 0;
        // 每次伤害判定同步播放一次冲击波扩散
        this._fireHowlShockwave();
        // 椭圆判定（2:1 平面透视），与紫色扩散圈视觉一致
        const shape = new GroundEllipse(this.x, this.y, range, range * PERSPECTIVE_SCALE_Y);
        for (const e of this._hostiles(entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(matk * (cfg.damageMul ?? 0.5))), this, 'magic', false);
        }
    }

    _endHowl() {
        if (this._animState === 'howl') this._animState = 'idle';
        this._howlTimer = 0;
        this._howlTickTimer = 0;
        this._attackAnimTimer = 0;
        this._destroyCustomEffects();
    }

    // ========== 工具 ==========

    /** 范围内敌对可击单位（与集合体 _hostiles 同语义：非本阵营、active、hittable） */
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
            case 'walk': return 'enemy_shounao_walk';
            case 'slam': return 'enemy_shounao_slam';
            case 'howl': return 'enemy_shounao_howl';
            default: return 'enemy_shounao_idle';
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
            spriteSize: renderCfg.spriteSize || 220,
            flipX,
            animState: this._animState,
            animKey: this._getTextureKey(),
        };
    }
}
