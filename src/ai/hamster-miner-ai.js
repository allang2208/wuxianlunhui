// ============================================================
// HamsterMinerAI — 仓鼠矿工 AI（2026-08-15）
// 玩家友方单位：在世界-122 自动寻找最近能源矿点并采矿。
// - 只攻击能源矿点（_isEnergyNode），绝不攻击任何单位/建筑；
// - 移动复用 MovementSystem（寻路/墙碰撞），移速 80 px/s；
// - 每 attackInterval（2s）对矿点造成 attackDamage（100）物理伤害；
// - 动画状态：walk（移动）/ mining（采矿）/ idle（无矿点待机）。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { pickNearestNode } from './companion-ai-decision.js';

export class HamsterMinerAI {
    constructor(miner) {
        this.m = miner;
        this.cfg = miner.aiConfig || {};
        this._decisionTimer = 0;
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2000;
        this._attackDamage = this.cfg.attackDamage ?? 100;
        this._miningRange = this.cfg.miningRange ?? 80;
    }

    /**
     * 每帧入口（由 HamsterMiner.update 调用）。
     * @param {number} dt 毫秒
     * @param {Map|Array} entities Game.entities
     */
    update(dt, entities, _player) {
        const m = this.m;
        if (m.data.hp <= 0 || m._dying) return;

        this._attackTimer = Math.max(0, this._attackTimer - dt);
        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities);
        }

        // 采矿中：站定（不调用 MovementSystem 移动），持续播采矿动画
        if (m._animState === 'mining') {
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            m.maxSpeed = 0;
            this._tryAttack();
            return;
        }

        // 移动中：交给 MovementSystem 寻路推进
        MovementSystem.update(m, dt, entities);
    }

    /**
     * 决策 tick：维护目标矿点并设置移动/采矿状态。
     * 只认 _isEnergyNode 且 active 且未枯竭的矿点；矿点枯竭/消失自动换下一个。
     */
    _tick(entities) {
        const m = this.m;
        // 当前目标失效（枯竭/被清）→ 放弃，重新寻找
        const t = m.target;
        if (t && (!t.active || t.hp <= 0 || t._depleted)) {
            m.target = null;
            m._tacticalTarget = null;
        }

        const nodes = this._energyNodes(entities);
        if (nodes.length === 0) {
            m.target = null;
            m._tacticalTarget = null;
            m._animState = 'idle';
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            m.maxSpeed = 0;
            return;
        }

        if (!m.target) {
            m.target = pickNearestNode(nodes, m);
            if (!m.target) {
                m._animState = 'idle';
                m.vx = 0;
                m.vy = 0;
                m.isMoving = false;
                m.maxSpeed = 0;
                return;
            }
        }

        const node = m.target;
        const dist = Math.hypot(node.x - m.x, node.y - m.y);
        const range = this._miningRange + (node.groundRadius || 45);
        if (dist <= range) {
            // 到矿点：站定采矿
            m._tacticalTarget = null;
            m._animState = 'mining';
            m.maxSpeed = 0;
            m.rotation = Math.atan2(node.y - m.y, node.x - m.x);
            m._lastFaceRight = node.x >= m.x;
            return;
        }
        // 赶路：朝矿点移动（移速 80）
        m._tacticalTarget = { x: node.x, y: node.y };
        m._animState = 'walk';
        m.maxSpeed = this.cfg.walkSpeed ?? 80;
    }

    /** 采矿攻击：间隔到点即对矿点造成固定伤害（只打矿点） */
    _tryAttack() {
        const m = this.m;
        const node = m.target;
        if (!node || !node.active || node.hp <= 0 || node._depleted) return;
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackInterval;
        if (typeof node.takeDamage === 'function') {
            node.takeDamage(this._attackDamage, m, 'physical', true);
        }
    }

    /** 收集有效能源矿点（只认 _isEnergyNode，不收集任何单位/建筑） */
    _energyNodes(entities) {
        const out = [];
        const iter = entities && entities.values ? entities.values() : entities || [];
        for (const e of iter) {
            if (!e || !e.active || e.hp <= 0) continue;
            if (!e._isEnergyNode || e._depleted) continue;
            out.push(e);
        }
        return out;
    }
}
