// ============================================================
// HamsterGuardAI — 仓鼠盾卫 AI（2026-08-16）
// 玩家友方近战单位：在世界-122 自动寻找最近敌人攻击。
// - 只认 _faction==='enemy' 的单位，能源矿点（_isEnergyNode）一律不攻击；
// - 插帧后攻击动画 23 帧 @24fps 单次播，**第 19 帧判定伤害**：
//   伤害延迟 = (attackDamageFrame-1)/fps = 750ms，每挥一次 30 物理伤害，间隔 2s；
// - 无敌人时跟随玩家（保持 followOffset 站位，到位清路径/归零速度防滑步）；
// - 移动复用 MovementSystem（寻路/墙碰撞/避障），挥击中站定（不移动）。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { SoundManager } from '../ui/sound-manager.js';
import { clearRtsSurfaceRoute, finishRtsCommandAtHold, resolveRtsMoveDestination, RTS_DEFAULT_ACQUIRE_RANGE } from './rts-command-utils.js';
import { canMeleeReachTarget } from '../combat/melee-reach.js';
import { queryNearbyEntities, stableAiPhase } from './friendly-spatial-query.js';

export class HamsterGuardAI {
    constructor(guard) {
        this.m = guard;
        this.cfg = guard.aiConfig || {};
        this._decisionTimer = stableAiPhase(guard, this.cfg.decisionMs ?? 120);
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2000;
        this._attackDamage = this.cfg.attackDamage ?? 30;
        this._attackRange = this.cfg.attackRange ?? 55;
        this._engageRange = RTS_DEFAULT_ACQUIRE_RANGE;
        this._followOffset = this.cfg.followOffset ?? 140;
        this._followArriveDist = this.cfg.followArriveDist ?? 40;
        // 攻击动画第 N 帧伤害判定（用户口径）：整段 12 帧 @12fps = 1.0s，
        // 插帧后第 19 帧（索引 18）→ 伤害延迟 = (19-1)/24 × 1000 = 750ms
        const animCfg = (guard.animations && guard.animations.attack) || {};
        const fps = this.cfg.attackAnimFps ?? animCfg.frameRate ?? 12;
        const damageFrame = this.cfg.attackDamageFrame ?? 19;
        const frameCount = animCfg.frameCount || 23;
        this._damageDelayMs = Math.max(0, (damageFrame - 1) / fps * 1000);
        this._swingAnimMs = frameCount / fps * 1000 + 60; // +60ms 余量：动画播完再切 idle，防攻击动画被打断
        // 挥击状态：_swingActive=true 期间站定播攻击动画（单次），到伤害延迟出伤，动画播完回 idle
        this._swingActive = false;
        this._swingTimer = 0;
        this._swingAnimLeft = 0;
        // 卡死看门狗（矿工/战士/射手同款兜底）
        this._stuckTimer = 0;
        this._lastPosX = 0;
        this._lastPosY = 0;
        this._stuckStreak = 0;
    }

    /** RTS 移动/待命立即打断当前挥击，避免命令延迟到动画结束。 */
    cancelForCommand() {
        this._swingActive = false;
        this._swingTimer = 0;
        this._swingAnimLeft = 0;
        this.m._attackSwing = false;
        this.m._animState = 'idle';
        this.m.vx = 0;
        this.m.vy = 0;
        this.m.isMoving = false;
    }

    /**
     * 每帧入口（由 HamsterGuard.update 调用）。
     * @param {number} dt 毫秒
     * @param {Map|Array} entities Game.entities
     * @param {object|null} player 玩家（无敌人时跟随目标）
     */
    update(dt, entities, player) {
        const m = this.m;
        if (m.data.hp <= 0 || m._dying) return;

        this._attackTimer = Math.max(0, this._attackTimer - dt);
        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities, player);
        }

        // 挥击中：站定 → 到第 10 帧延迟出伤（一次）→ 动画播完回 idle
        if (this._swingActive) {
            // 平滑站定：速度指数衰减（≈0.85/帧），代替瞬时清零的急停
            const damp = Math.pow(0.85, dt / 16.67);
            m.vx *= damp;
            m.vy *= damp;
            if (Math.abs(m.vx) < 1 && Math.abs(m.vy) < 1) { m.vx = 0; m.vy = 0; }
            m.isMoving = false;
            m.maxSpeed = 0;
            m._animState = 'attack';
            this._swingTimer -= dt;
            if (this._swingTimer <= 0) {
                this._applyDamage();
                this._swingTimer = Number.POSITIVE_INFINITY; // 每挥只出一次伤
            }
            this._swingAnimLeft -= dt;
            if (this._swingAnimLeft <= 0) {
                this._swingActive = false;
                m._attackSwing = false; // 挥击结束主动清标记（防动画被打断时渲染层残留）
                m._animState = 'idle';
            }
            return;
        }

        // 防御性复位：非挥击中不允许残留攻击状态
        if (m._animState === 'attack') {
            m._animState = 'idle';
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            m.maxSpeed = 0;
        }

        // 移动中：交给 MovementSystem 寻路推进
        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);
        // 缓停滑行（maxSpeed=0 后速度沿摩擦/加速度渐近归零）期间保持 walk 动画，
        // 避免站着播 idle 却还在滑行的"滑冰"感
        if (m._animState === 'idle' && Math.hypot(m.vx || 0, m.vy || 0) > 25) {
            m._animState = 'walk';
        }
    }

    /** 决策 tick：有敌追击/挥击，无敌跟随玩家 */
    _tick(entities, player) {
        const m = this.m;
        if (this._swingActive) {
            m._animState = 'attack';
            return;
        }
        // RTS 指挥命令优先（2026-08-16）：move 走到指令点，attack 锁定指定目标
        const cmd = m._command;
        if (cmd && cmd.mode && cmd.mode !== 'follow') {
            this._applyCommand(cmd);
            return;
        }
        const enemy = this._nearestEnemy(entities, m);
        if (enemy) {
            m.target = enemy;
            const dist = Math.hypot(enemy.x - m.x, enemy.y - m.y);
            const range = this._attackRange + (enemy.groundRadius || 24);
            if (dist <= range && canMeleeReachTarget(m, enemy)) {
                // 进入攻击范围：站定；挥击节奏由 attackTimer 控制
                m._tacticalTarget = null;
                m.maxSpeed = 0;
                m.rotation = Math.atan2(enemy.y - m.y, enemy.x - m.x);
                m._lastFaceRight = enemy.x >= m.x;
                if (this._attackTimer <= 0) {
                    // 开始一次挥击（攻击动画播一遍，第 10 帧判定伤害）
                    this._attackTimer = this._attackInterval;
                    this._swingActive = true;
                    this._swingTimer = this._damageDelayMs;
                    this._swingAnimLeft = this._swingAnimMs;
                    m._animState = 'attack';
                    m._attackSwing = true; // 渲染层播攻击动画
                } else {
                    m._animState = 'idle'; // 间隔期待机（速度不清零，交给 MovementSystem 渐近减速）
                }
                return;
            }
            // 目标在交战半径内但超出攻击范围：追击拉近距离
            m._tacticalTarget = { x: enemy.x, y: enemy.y };
            m._animState = 'walk';
            m.maxSpeed = this.cfg.walkSpeed ?? 100;
            return;
        }

        // 无敌人：跟随玩家（保持 followOffset 左侧站位）
        m.target = null;
        if (player) {
            const fx = player.x - this._followOffset;
            const fy = player.y;
            const dist = Math.hypot(fx - m.x, fy - m.y);
            if (dist <= this._followArriveDist) {
                m._tacticalTarget = null;
                m._animState = 'idle';
                // 不再瞬时清零速度：由 MovementSystem 摩擦衰减完成缓停
                m.maxSpeed = 0;
                if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
                    m._pathManager._clearPath();
                }
            } else {
                m._tacticalTarget = { x: fx, y: fy, _surfaceTarget: player };
                m._animState = 'walk';
                // 接近站位点缓出减速（120px 内速度随距离线性衰减，ease-out 到达）
                const walkSpeed = this.cfg.walkSpeed ?? 100;
                const slow = Math.min(1, dist / 120);
                m.maxSpeed = walkSpeed * Math.max(0.3, slow);
            }
        } else {
            m._tacticalTarget = null;
            m._animState = 'idle';
            // 速度不清零，由 MovementSystem 摩擦衰减缓停
            m.maxSpeed = 0;
        }
    }

    /** RTS 命令：move（走到点，到位清指令）/ attack（锁定目标，进范围站定挥击）/ hold（待命） */
    _applyCommand(cmd) {
        const m = this.m;
        if (cmd.mode !== 'move' && !m._surfaceNavCommand) clearRtsSurfaceRoute(m);
        if (cmd.mode === 'move') {
            m.target = null;
            const move = resolveRtsMoveDestination(m, cmd);
            if (!move.arrived) {
                m._tacticalTarget = move.destination;
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 100;
            } else {
                finishRtsCommandAtHold(m);
                m._tacticalTarget = null;
                clearRtsSurfaceRoute(m);
                m._animState = 'idle';
                m.maxSpeed = 0;
                // 速度不清零，由 MovementSystem 摩擦衰减完成缓停
            }
            return;
        }
        if (cmd.mode === 'attack') {
            const t = cmd.target;
            if (!t || !t.active || t.hp <= 0) {
                finishRtsCommandAtHold(m);
                m.target = null;
                m._animState = 'idle';
                return;
            }
            m.target = t;
            const dist = Math.hypot(t.x - m.x, t.y - m.y);
            const range = this._attackRange + (t.groundRadius || 24);
            if (dist <= range && canMeleeReachTarget(m, t)) {
                // 进范围：站定 + 启动一次挥击（与索敌分支同口径）
                m._tacticalTarget = null;
                m.maxSpeed = 0;
                m.rotation = Math.atan2(t.y - m.y, t.x - m.x);
                m._lastFaceRight = t.x >= m.x;
                if (this._attackTimer <= 0) {
                    this._attackTimer = this._attackInterval;
                    this._swingActive = true;
                    this._swingTimer = this._damageDelayMs;
                    this._swingAnimLeft = this._swingAnimMs;
                    m._animState = 'attack';
                    m._attackSwing = true;
                } else {
                    m._animState = 'idle'; // 间隔期待机（速度不清零，渐近减速）
                }
            } else {
                m._tacticalTarget = { x: t.x, y: t.y };
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 100;
            }
            return;
        }
        // hold / 其它：待命（速度不清零，由 MovementSystem 摩擦衰减缓停）
        m.target = null;
        m._tacticalTarget = null;
        m._animState = 'idle';
        m.maxSpeed = 0;
    }

    /** 收集最近有效敌人：只认 enemy 阵营且不是能源矿点（engageRange 内） */
    _nearestEnemy(entities, m) {
        let best = null;
        let bestD = Infinity;
        const iter = queryNearbyEntities(entities, m, this._engageRange);
        for (const e of iter) {
            if (!e || !e.active || e.hp <= 0) continue;
            if (e._faction !== 'enemy') continue;
            if (e._isEnergyNode) continue; // 不攻击矿点（用户口径）
            const d = Math.hypot(e.x - m.x, e.y - m.y);
            if (d < bestD && d <= this._engageRange) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    /** 第 10 帧伤害判定：目标仍存活且在攻击范围内 → 造成 attackDamage 物理伤害 */
    _applyDamage() {
        const m = this.m;
        const e = m.target;
        if (!e || !e.active || e.hp <= 0) return;
        if (e._isEnergyNode) return;
        const dist = Math.hypot(e.x - m.x, e.y - m.y);
        const range = this._attackRange + (e.groundRadius || 24);
        if (dist > range || !canMeleeReachTarget(m, e)) return;
        if (typeof e.takeDamage === 'function') {
            e.takeDamage(m.getPhysicalAttackDamage(this._attackDamage, e), m, 'physical', true);
            this._playSound('attack'); // 攻击音效（2026-08-16 用户素材，与战士共用）
        }
    }

    /** 事件音效：世界内发声走 playWorld（坐标衰减），无则 playFile 兜底（路径来自配置 m.sounds） */
    _playSound(key) {
        const m = this.m;
        const path = m && m.sounds && m.sounds[key];
        if (!path || !SoundManager) return;
        if (typeof SoundManager.playWorld === 'function') {
            SoundManager.playWorld(path, m.x, m.y);
        } else if (typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(path);
        }
    }

    /** 卡死看门狗：只清理旧路径，坐标位移统一交给 MovementSystem/WallSystem。 */
    _checkStuck(dt) {
        const m = this.m;
        if (m._surfaceNavWaiting || m._surfaceRouteActive
            || m._surfaceKind === 'stairs' || m._surfaceKind === 'wall_walk') {
            this._stuckTimer = 0;
            this._stuckStreak = 0;
            this._lastPosX = m.x;
            this._lastPosY = m.y;
            return;
        }
        if (m._animState !== 'walk') {
            this._stuckTimer = 0;
            this._lastPosX = m.x;
            this._lastPosY = m.y;
            return;
        }
        this._stuckTimer += dt;
        if (this._stuckTimer < 500) return;
        this._stuckTimer = 0;
        const moved = Math.hypot(m.x - this._lastPosX, m.y - this._lastPosY);
        this._lastPosX = m.x;
        this._lastPosY = m.y;
        if (moved > 3) {
            this._stuckStreak = 0;
            return;
        }
        this._stuckStreak++;
        if (this._stuckStreak < 2) return;
        this._stuckStreak = 0;
        if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
            m._pathManager._clearPath();
        }
    }
}
