// ============================================================
// HamsterWarriorAI — 仓鼠战士 AI（2026-08-16）
// 玩家友方近战单位：在世界-122 自动寻找最近敌人攻击。
// - 只认 _faction==='enemy' 的单位，能源矿点（_isEnergyNode）一律不攻击；
// - 每 2s 对攻击范围内目标造成 50 伤害（attackDamage）；
// - 无敌人时跟随玩家（保持 followOffset 站位，到位清路径/归零速度防滑步）；
// - 移动复用 MovementSystem（寻路/墙碰撞/避障），攻击中站定（不移动）。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';

export class HamsterWarriorAI {
    constructor(warrior) {
        this.m = warrior;
        this.cfg = warrior.aiConfig || {};
        this._decisionTimer = 0;
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2000;
        this._attackDamage = this.cfg.attackDamage ?? 50;
        this._attackRange = this.cfg.attackRange ?? 55;
        this._engageRange = this.cfg.engageRange ?? 900;
        this._followOffset = this.cfg.followOffset ?? 140;
        this._followArriveDist = this.cfg.followArriveDist ?? 40;
        // 卡死看门狗（复用矿工同款兜底，防寻路顶墙/被障碍卡住）
        this._stuckTimer = 0;
        this._lastPosX = 0;
        this._lastPosY = 0;
        this._stuckStreak = 0;
    }

    /**
     * 每帧入口（由 HamsterWarrior.update 调用）。
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

        // 攻击中：站定（不调用 MovementSystem），间隔对目标造成伤害
        if (m._animState === 'attack') {
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            m.maxSpeed = 0;
            this._tryAttack();
            return;
        }

        // 移动中：交给 MovementSystem 寻路推进
        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);
    }

    /** 决策 tick：有敌追击/攻击，无敌跟随玩家 */
    _tick(entities, player) {
        const m = this.m;
        const enemy = this._nearestEnemy(entities, m);
        if (enemy) {
            m.target = enemy;
            const dist = Math.hypot(enemy.x - m.x, enemy.y - m.y);
            const range = this._attackRange + (enemy.groundRadius || 24);
            if (dist <= range) {
                // 进入攻击范围：站定攻击（动画由渲染层两段式播放）
                m._tacticalTarget = null;
                m._animState = 'attack';
                m.maxSpeed = 0;
                m.rotation = Math.atan2(enemy.y - m.y, enemy.x - m.x);
                m._lastFaceRight = enemy.x >= m.x;
                return;
            }
            // 追击：以敌人当前位置为寻路目标
            m._tacticalTarget = { x: enemy.x, y: enemy.y };
            m._animState = 'walk';
            m.maxSpeed = this.cfg.walkSpeed ?? 120;
            return;
        }

        // 无敌人：跟随玩家（保持 followOffset 左侧站位）
        m.target = null;
        if (player) {
            const fx = player.x - this._followOffset;
            const fy = player.y;
            const dist = Math.hypot(fx - m.x, fy - m.y);
            if (dist <= this._followArriveDist) {
                // 到达：清战术目标 + 归零速度（防"到达后待机姿态滑行"，见 lessons #46）
                m._tacticalTarget = null;
                m._animState = 'idle';
                m.vx = 0;
                m.vy = 0;
                m.isMoving = false;
                m.maxSpeed = 0;
                if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
                    m._pathManager._clearPath();
                }
            } else {
                m._tacticalTarget = { x: fx, y: fy };
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 120;
            }
        } else {
            m._tacticalTarget = null;
            m._animState = 'idle';
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            m.maxSpeed = 0;
        }
    }

    /** 收集最近有效敌人：只认 enemy 阵营且不是能源矿点（engageRange 内） */
    _nearestEnemy(entities, m) {
        let best = null;
        let bestD = Infinity;
        const iter = entities && entities.values ? entities.values() : entities || [];
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

    /** 攻击：间隔到点且目标仍在攻击范围内 → 造成 attackDamage 伤害 */
    _tryAttack() {
        const m = this.m;
        const e = m.target;
        if (!e || !e.active || e.hp <= 0) return;
        if (e._isEnergyNode) return;
        const dist = Math.hypot(e.x - m.x, e.y - m.y);
        const range = this._attackRange + (e.groundRadius || 24);
        if (dist > range) return;
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackInterval;
        if (typeof e.takeDamage === 'function') {
            e.takeDamage(this._attackDamage, m, 'physical', true);
        }
    }

    /** 卡死看门狗：行走 500ms 位移 <3px 累计 2 次 → 重选目标/传送到合法点（矿工同款兜底） */
    _checkStuck(dt) {
        const m = this.m;
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
        if (WallSystem && typeof WallSystem.findSafeSpawn === 'function') {
            const sp = WallSystem.findSafeSpawn(m.x, m.y, m.groundRadius || 20);
            if (sp && Number.isFinite(sp.x) && Number.isFinite(sp.y)
                && Math.hypot(sp.x - m.x, sp.y - m.y) > 5) {
                m.x = sp.x;
                m.y = sp.y;
            }
        }
        m.target = null;
        m._tacticalTarget = null;
        if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
            m._pathManager._clearPath();
        }
    }
}
