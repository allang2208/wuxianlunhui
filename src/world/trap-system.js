/**
 * 陷阱系统（僵尸地牢战斗房，2026-07-30）
 *
 * 机制（用户规格）：
 * - 无碰撞体积（可踩上去）；**不做"进入"判定，做"占用"判定**——每帧检查触发半径内
 *   是否有玩家或敌对目标（active && hittable），有则进入触发流程
 * - 占用 → 0.5s 延迟 → 0.5s 播完地刺动画（13 帧，命中帧对半径内所有目标造成
 *   各自最大生命值 10% 物理伤害）→ 0.5s 倒放还原 → 2s 冷却；
 *   冷却结束仍被占用则再次触发（站在上面每 ~3.5s 循环一次）
 * - 贴图层级：depth = y - 998（地板层，实体从上方走过盖在陷阱上）
 * - 随战斗房生成/清理（cleanupRoom 统一销毁）
 */
import { Game } from '../game.js';
import { SoundManager } from '../ui/sound-manager.js';

const DEFAULTS = {
    count: 3,
    triggerRadius: 45,
    delayMs: 500,
    animMs: 500,
    reverseMs: 500,
    cooldownMs: 2000,
    damagePercent: 0.10,
    hitFrame: 6, // 命中判定帧（13 帧中地刺完全伸出附近）
};

export const TrapSystem = {
    _traps: [],
    _cfg: null,

    /** 战斗房生成时调用：在菱形房内随机摆 cfg.count 个陷阱（拒绝采样避开中心与墙边） */
    spawnForRoom(bounds, cfg) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !bounds) return;
        this._cfg = { ...DEFAULTS, ...(cfg || {}) };
        const C = this._cfg;
        const { cx, cy, rx, ry } = bounds;
        let placed = 0, tries = 0;
        while (placed < C.count && tries < 60) {
            tries++;
            const a = Math.random() * Math.PI * 2;
            const r = 0.25 + Math.random() * 0.55; // 距中心 25%~80%，避开中心与墙边
            const x = cx + Math.cos(a) * rx * r;
            const y = cy + Math.sin(a) * ry * r;
            if (this._traps.some(t => Math.hypot(t.x - x, t.y - y) < C.triggerRadius * 2.5)) continue;
            const sprite = scene.add.sprite(x, y, 'trap_idle');
            sprite.setOrigin(0.5, 0.5);
            sprite.setDisplaySize(C.triggerRadius * 2.6, C.triggerRadius * 2.6);
            sprite.setDepth(y - 998); // 地板层：实体走过盖在陷阱上
            this._traps.push({
                x, y, sprite,
                state: 'idle',      // idle | delay | playing | reversing | cooldown
                timer: 0,
                damaged: false,     // 本次触发是否已结算伤害
            });
            placed++;
        }
    },

    /** 每帧（CombatRoomSystem.update 驱动） */
    update(dt) {
        if (!this._traps.length) return;
        const C = this._cfg || DEFAULTS;
        for (const t of this._traps) {
            t.timer += dt;
            const occupied = this._isOccupied(t, C);
            switch (t.state) {
                case 'idle':
                    if (occupied) { t.state = 'delay'; t.timer = 0; }
                    break;
                case 'delay':
                    if (t.timer >= C.delayMs) {
                        t.state = 'playing'; t.timer = 0; t.damaged = false;
                        if (t.sprite) t.sprite.setTexture('trap_anim', 0); // 帧由 timer 逐帧驱动（门闸同款 tween 教训：不依赖 anims 链）
                        // 触发音效（地刺弹出）
                        if (typeof SoundManager !== 'undefined' && SoundManager.playFile) {
                            SoundManager.playFile('assets/sounds/environment/trap.mp3');
                        }
                    }
                    break;
                case 'playing': {
                    const frame = Math.min(12, Math.floor(t.timer / C.animMs * 13));
                    if (t.sprite && t.sprite.anims && t.sprite.frame.name !== frame) t.sprite.setFrame(frame);
                    if (!t.damaged && frame >= C.hitFrame) {
                        t.damaged = true;
                        this._dealDamage(t, C);
                    }
                    if (t.timer >= C.animMs) {
                        t.state = 'reversing'; t.timer = 0;
                    }
                    break;
                }
                case 'reversing': {
                    const frame = Math.max(0, 12 - Math.floor(t.timer / C.reverseMs * 13));
                    if (t.sprite && t.sprite.frame.name !== frame) t.sprite.setFrame(frame);
                    if (t.timer >= C.reverseMs) {
                        t.state = 'cooldown'; t.timer = 0;
                        if (t.sprite) t.sprite.setTexture('trap_idle');
                    }
                    break;
                }
                case 'cooldown':
                    if (t.timer >= C.cooldownMs) {
                        if (occupied) { t.state = 'delay'; t.timer = 0; }
                        else { t.state = 'idle'; t.timer = 0; }
                    }
                    break;
            }
        }
    },

    /** 占用判定：触发半径内有玩家或敌对目标（active && hittable && 地面单位） */
    _isOccupied(t, C) {
        if (typeof Game === 'undefined' || !Game.entities) return false;
        for (const e of Game.entities.values()) {
            if (!e || !e.active || !e.hittable) continue;
            if (Math.hypot(e.x - t.x, e.y - t.y) <= C.triggerRadius + (e.groundRadius || 0)) return true;
        }
        return false;
    },

    /** 伤害结算：半径内所有目标各吃自身最大生命值 10% 物理伤害 */
    _dealDamage(t, C) {
        if (typeof Game === 'undefined' || !Game.entities) return;
        for (const e of Game.entities.values()) {
            if (!e || !e.active || !e.hittable) continue;
            if (Math.hypot(e.x - t.x, e.y - t.y) > C.triggerRadius + (e.groundRadius || 0)) continue;
            const maxHp = (e === Game.player)
                ? (e.data && e.data.maxHp) || e.maxHp || 100
                : e.maxHp || (e.data && e.data.maxHp) || 100;
            const dmg = Math.max(1, Math.floor(maxHp * C.damagePercent));
            if (typeof e.takeDamage === 'function') e.takeDamage(dmg, null, false);
        }
    },

    /** 战斗房清理（cleanupRoom 调用） */
    cleanup() {
        for (const t of this._traps) {
            if (t.sprite) { t.sprite.destroy(); }
        }
        this._traps = [];
        this._cfg = null;
    },
};
