import { Enemy } from '../enemy.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { SoundManager } from '../../ui/sound-manager.js';
import enemyConfigData from '../../../data/enemy-config.json';

/**
 * 蝇群（普通）
 * - 虚化虫体：noCollision 常驻（碰撞体积为 0，实体互相穿过；墙壁仍由 WallSystem 解析，不可穿墙）
 * - 三位一体碰撞区（配置 hitCircles 品字形三圆）：目标触碰任一子圆，
 *   每 contactDamage.intervalMs 受到 atk×damageMul 伤害
 * - 远程减伤：受到的远程伤害 ×rangedDamageTakenMul（物理/魔法统一）
 */
export class FlySwarm extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.flySwarm,
            ...config
        });
        this._useStickFigure = false;
        this._animState = 'idle';
        // 碰撞体积为 0（骑士冲锋同款：实体分离跳过，墙体仍解析）
        this.noCollision = this.config?.noCollision ?? true;
        // 伤害完全由触碰自管：关闭 CombatSystem 的通用近战触发（同集合体模式），无默认普攻
        this.aiInterval = Number.MAX_SAFE_INTEGER;
        this._contactTickTimer = 0;
        // 循环音轨（idleing 持续循环，音量随与玩家距离 50%→150%）
        this._loopSoundId = 'flyswarm_' + Math.random().toString(36).slice(2, 10);
        this._loopSoundStarted = false;
    }

    /** 循环音轨同步：持续循环；音量按与玩家距离在 base~max 间线性插值 */
    _syncLoopSound() {
        const s = this.config?.sounds;
        if (!s || !s.loop || this.hp <= 0) {
            if (this._loopSoundStarted) {
                SoundManager.stopLoop(this._loopSoundId);
                this._loopSoundStarted = false;
            }
            return;
        }
        if (!this._loopSoundStarted) {
            this._loopSoundStarted = true;
            SoundManager.playLoop(this._loopSoundId, s.loop, s.loopVolumeBase ?? 0.5);
        }
        const base = s.loopVolumeBase ?? 0.5;
        const max = s.loopVolumeMax ?? 1.5;
        const near = s.loopNearDist ?? 150;
        const far = s.loopFarDist ?? 600;
        let vol = base;
        const p = (typeof window !== 'undefined' && window.Game && window.Game.player) || null;
        if (p && p.active) {
            const d = Math.hypot(p.x - this.x, p.y - this.y);
            const t = Math.max(0, Math.min(1, (far - d) / Math.max(1, far - near)));
            vol = base + (max - base) * t;
        }
        SoundManager.setLoopVolume(this._loopSoundId, vol);
    }

    _destroyCustomEffects() {
        if (this._loopSoundStarted) {
            SoundManager.stopLoop(this._loopSoundId);
            this._loopSoundStarted = false;
        }
    }

    update(dt, entities) {
        this.updateStatusEffects(dt);
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            return;
        }
        // 恐惧时动作中断（移动由 MovementSystem 恐惧分支接管逃跑）
        if (this.hasStatusEffect && this.hasStatusEffect('fear')) {
            return;
        }
        super.update(dt, entities);
        this._animState = this.isMoving ? 'walk' : 'idle';

        // 循环音轨：idleing 持续循环，音量随与玩家距离变化
        this._syncLoopSound();

        // 触碰伤害 tick：目标在任一三位一体子圆内时按间隔结算
        this._contactTickTimer -= dt;
        if (this._contactTickTimer <= 0) {
            const cfg = this.config?.contactDamage || {};
            this._contactTickTimer = cfg.intervalMs ?? 500;
            this._dealContactDamage(entities);
        }
    }

    _dealContactDamage(entities) {
        const cfg = this.config?.contactDamage || {};
        const circles = this.config?.hitCircles || [];
        if (circles.length === 0) return;
        const atk = this.data?.atk || 0;
        for (const e of this._hostiles(entities)) {
            if (!this._touchingAnyCircle(e, circles)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 1))), this, cfg.damageType || 'physical', true);
        }
    }

    /** 目标是否与任一三位一体子圆相交（地面 footprint 椭圆，2:1 透视） */
    _touchingAnyCircle(target, circles) {
        for (const c of circles) {
            const shape = new GroundEllipse(this.x + (c.x || 0), this.y + (c.y || 0), c.r, c.r * PERSPECTIVE_SCALE_Y);
            if (shape.intersectsEntity(target)) return true;
        }
        return false;
    }

    /** 远程减伤 50%（isMelee=false 的远程伤害按配置倍率削减；近战不受影响） */
    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        if (!isMelee) {
            const mul = this.config?.rangedDamageTakenMul ?? 1;
            damage = Math.max(1, Math.round(damage * mul));
        }
        super.takeDamage(damage, source, damageType, isMelee);
    }

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

    // ========== 渲染 ==========

    _getTextureKey() {
        // 仅一组 32 帧循环动画
        return 'enemy_flyswarm_idle';
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
            spriteSize: renderCfg.spriteSize || 120,
            flipX,
            animState: this._animState,
            animKey: this._getTextureKey(),
        };
    }
}
