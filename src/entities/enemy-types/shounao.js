import { Enemy } from '../enemy.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { SoundManager } from '../../ui/sound-manager.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { hostilesOf } from './_shared/enemy-utils.js';
import {
    createGroundWarning,
    destroyWarning,
    fireGroundShockwave,
    fireRadialLines,
    keepWarningAlive,
} from '../../effects/combat-fx.js';
import { canMeleeShareSurface } from '../../combat/melee-surface.js';

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
        // 攻击完全由本类技能自管（slam/howl）：关闭 CombatSystem 的通用近战触发（同集合体模式），无默认普攻
        this.aiInterval = Number.MAX_SAFE_INTEGER;
        // 动作期间锁定 MovementSystem（与集合体/骑士同机制）：>0 时外部系统不驱动移动
        this._attackAnimTimer = 0;

        // 砸地状态
        this._slamTimer = 0;
        this._slamCooldown = 0;
        this._slamHitsDone = new Set();
        this._slamWarning = null;

        // 嚎叫状态
        this._howlTimer = 0;
        this._howlCooldown = 0;
        this._howlTickTimer = 0;
        // 嚎叫冲击波 graphics（扩散圈特效，统一清理用）
        this._howlGraphics = [];
        // 砸地冲击白线 graphics（统一清理用）
        this._slamGraphics = [];
        // 移动音效计时（sounds.walk 两文件随机，间隔 walkInterval）
        this._walkSoundTimer = 0;
    }

    /** 播放配置音效（数组则随机选一，如移动脚步两个文件随机） */
    _playSound(key) {
        let path = this.config?.sounds?.[key];
        if (Array.isArray(path)) path = path[Math.floor(Math.random() * path.length)];
        if (path && SoundManager && typeof SoundManager.playWorld === 'function') {
            SoundManager.playWorld(path, this.x, this.y);
        } else if (path && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(path);
        }
    }

    _getSkillConfigs() {
        return (this.config && this.config.attackSkills) || {};
    }

    update(dt, entities) {
        const attackDt = this.getAttackIntervalDelta(dt);
        if (this._slamCooldown > 0) this._slamCooldown -= attackDt;
        if (this._howlCooldown > 0) this._howlCooldown -= attackDt;
        if (this._attackAnimTimer > 0) this._attackAnimTimer = Math.max(0, this._attackAnimTimer - dt);

        // 基类链统一推进状态效果/受击反馈（每帧一次）；
        // 原在此直接调 updateStatusEffects 会与基类 update 重复推进，导致眩晕/恐惧等双倍流速
        super.update(dt, entities);

        // 眩晕/冻结时强制中断所有动作
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            this._endSlam();
            this._endHowl();
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
        if (this._animState === 'slam') { this._updateSlam(dt, entities); return; }
        if (this._animState === 'howl') { this._updateHowl(dt, entities); return; }

        // 技能决策：砸地（近程优先） > 嚎叫（远程）
        if (this.target && this.target.active) {
            this._decideSkills();
        }
        if (this._animState !== 'slam' && this._animState !== 'howl') {
            this._animState = this.isMoving ? 'walk' : 'idle';
        }

        // 移动音效：walk 状态按间隔随机播放两个脚步声之一
        if (this._animState === 'walk') {
            this._walkSoundTimer -= dt;
            if (this._walkSoundTimer <= 0) {
                this._walkSoundTimer = this.config?.sounds?.walkInterval ?? 500;
                this._playSound('walk');
            }
        } else {
            this._walkSoundTimer = 0;
        }
    }

    _decideSkills() {
        const t = this.target;
        const cfg = this._getSkillConfigs();

        // 砸地：周围 300px 有目标就触发（精英预警后再启动）
        if (this._slamCooldown <= 0 && cfg.slam && cfg.slam.duration) {
            if (this._isTargetInRange(t, cfg.slam.triggerRange ?? 300)) {
                this._tryAttackTelegraph(() => this._startSlam());
                return;
            }
        }

        // 嚎叫：600px 内有目标且 CD 就绪（精英预警后再启动）
        if (this._howlCooldown <= 0 && cfg.howl && cfg.howl.duration) {
            if (this._isTargetInRange(t, cfg.howl.triggerRange ?? 600)) {
                this._tryAttackTelegraph(() => this._startHowl());
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
        const anchor = this._slamFxAnchor();
        this._slamWarning = destroyWarning(this._slamWarning);
        this._slamWarning = createGroundWarning(anchor.x, anchor.y, cfg.range ?? 300);
    }

    _updateSlam(dt, entities) {
        const cfg = this._getSkillConfigs().slam;
        this._slamTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (!keepWarningAlive(this._slamWarning)) this._slamWarning = null;

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
        const range = cfg.range ?? this.attackDistance ?? 300;
        const atk = this.data?.atk || 0;
        const anchor = this._slamFxAnchor();
        this._slamWarning = destroyWarning(this._slamWarning);
        // 砸地判定伤害时播放 hitting
        this._playSound('slam');
        // 伤害、烟尘与冲击圈统一使用触手实际落点；2:1 椭圆与地面透视一致。
        this._fireSlamDust(anchor);
        this._fireSlamImpactLines(anchor, range);
        const shockwave = fireGroundShockwave({
            x: anchor.x,
            y: anchor.y,
            maxRadius: range,
            strokeColor: 0xffffff,
            fillColor: 0x8a4a5a,
            lineWidth: 4,
            duration: 420,
            flicker: false,
            strokeAlpha: 0.9,
            fillAlpha: 0.08,
        });
        if (shockwave) this._slamGraphics.push(shockwave);
        const shape = new GroundEllipse(
            anchor.x,
            anchor.y,
            range,
            range * PERSPECTIVE_SCALE_Y,
            surfaceEffectFromEntity(this)
        );
        for (const e of hostilesOf(this, entities)) {
            if (!shape.intersectsEntity(e)) continue;
            if (!canMeleeShareSurface(this, e)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 2))), this, 'physical', true);
        }
    }

    /** 砸地特效锚点：朝向右时下移 25px 右移 50px（朝左镜像） */
    _slamFxAnchor() {
        const faceDir = Math.cos(this.rotation ?? 0) >= 0 ? 1 : -1;
        return { x: this.x + faceDir * 50, y: this.y + 25 };
    }

    /** 砸地烟尘：绕落点四周扩散生成（粒子自带轻微上浮分量） */
    _fireSlamDust(a = this._slamFxAnchor()) {
        const count = 8;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const ox = Math.cos(angle) * 30;
            const oy = Math.sin(angle) * 30 * PERSPECTIVE_SCALE_Y;
            EffectFactory.createDustEffect(a.x + ox, a.y + oy + 6, 0.9);
        }
    }

    /** 砸地冲击白线：落点向外放射的白色线条，快速扩散淡出（共享件；长度延长 50% 已折算进 inner/outer） */
    _fireSlamImpactLines(a = this._slamFxAnchor(), range = 300) {
        // 放射线外沿与真实判定半径一致，避免只画到210px却伤到300px。
        const g = fireRadialLines({
            x: a.x, y: a.y, count: 8,
            innerFrom: range * 0.1,
            innerTo: range * 0.35,
            outerFrom: range * 0.25,
            outerTo: range,
        });
        if (g) this._slamGraphics.push(g);
    }

    _endSlam() {
        if (this._animState === 'slam') this._animState = 'idle';
        this._slamTimer = 0;
        this._slamHitsDone = new Set();
        this._attackAnimTimer = 0;
        this._slamWarning = destroyWarning(this._slamWarning);
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
        // 嚎叫攻击时播放 howling
        this._playSound('howl');
    }

    /**
     * 嚎叫冲击波：释放时从手脑中心释放一个紫色椭圆圈，
     * 由中心扩散到嚎叫影响范围并淡出（共享件：600ms 闪烁扩散，depth y+50，平面透视 2:1）。
     */
    _fireHowlShockwave() {
        const cfg = this._getSkillConfigs().howl;
        const g = fireGroundShockwave({
            x: this.x, y: this.y,
            maxRadius: cfg.range ?? 600,
            strokeColor: 0xa060ff, fillColor: 0xb080ff,
        });
        if (g) this._howlGraphics.push(g);
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
        this._slamWarning = destroyWarning(this._slamWarning);
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
        const shape = new GroundEllipse(
            this.x,
            this.y,
            range,
            range * PERSPECTIVE_SCALE_Y,
            surfaceEffectFromEntity(this)
        );
        for (const e of hostilesOf(this, entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(matk * (cfg.damageMul ?? 0.5))), this, 'magic', false);
            // 嚎叫恐惧：每次伤害对目标附加恐惧（层数叠加、孰长刷新由 applyFear 处理）
            if (typeof e.applyFear === 'function') e.applyFear(cfg.fearMs ?? 3000, this);
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
            collisionWidth: renderCfg.collisionWidth || 60,
            collisionHeight: renderCfg.collisionHeight || 100,
            flipX,
            animState: this._animState,
            animKey: this._getTextureKey(),
        };
    }
}
