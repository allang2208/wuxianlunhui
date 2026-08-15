// ============================================================
// HamsterMinerAI — 仓鼠矿工 AI（2026-08-15，2026-08-15 仓鼠小屋扩展）
// 玩家友方单位：在世界-122 自动采矿，并在附近有敌人时近战自卫。
// - 优先交战：发现 engageRange 内敌人 → 走近近战（复用攻击间隔/攻击力）；
// - 无敌人：自动找最近能源矿点采矿（_isEnergyNode），间隔攻击产出能源；
// - 采矿效率：miningMult > 1 时每次采矿按效率加成额外注入背包能源；
// - 移动复用 MovementSystem（寻路/墙碰撞），移速 walkSpeed（小屋升级 +5%/级）；
// - 动画状态：walk（移动）/ mining（采矿或近战）/ idle（待机）。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { ENERGY_CONFIG } from '../config/energy-config.js';
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
        this._engageRange = this.cfg.engageRange ?? 340;   // 发现敌人半径（仓鼠小屋防御）
        this._attackRange = this.cfg.attackRange ?? 48;    // 近战贴脸距离
        this.miningMult = this.cfg.miningMult ?? 1;        // 采矿效率倍率（小屋升级）
    }

    /** 仓鼠小屋升级后刷新战斗参数（间隔/伤害/移速/采矿效率） */
    applyUpgrades(u) {
        if (typeof u.attackInterval === 'number' && u.attackInterval > 0) {
            this._attackInterval = u.attackInterval;
            this.cfg.attackInterval = u.attackInterval;
        }
        if (typeof u.attackDamage === 'number' && u.attackDamage > 0) {
            this._attackDamage = u.attackDamage;
            this.cfg.attackDamage = u.attackDamage;
        }
        if (typeof u.walkSpeed === 'number' && u.walkSpeed > 0) {
            this.cfg.walkSpeed = u.walkSpeed;
        }
        if (typeof u.miningMult === 'number' && u.miningMult > 0) {
            this.miningMult = u.miningMult;
            this.cfg.miningMult = u.miningMult;
        }
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

        // 敌人交战/采矿中：站定（不调用 MovementSystem 移动），持续攻击
        if (m._animState === 'mining') {
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            m.maxSpeed = 0;
            if (m._enemyTarget && m._enemyTarget.active && m._enemyTarget.hp > 0) {
                this._tryAttackEnemy();
            } else {
                this._tryAttack();
            }
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
        // 敌人优先（仓鼠小屋防御）：发现敌人 → 追击近战
        const enemy = this._nearestEnemy(entities, this._engageRange);
        if (enemy) {
            m._enemyTarget = enemy;
            m.target = null;
            const dist = Math.hypot(enemy.x - m.x, enemy.y - m.y);
            const range = this._attackRange + (enemy.groundRadius || 26);
            if (dist <= range) {
                m._tacticalTarget = null;
                m._animState = 'mining';
                m.maxSpeed = 0;
                m.rotation = Math.atan2(enemy.y - m.y, enemy.x - m.x);
                m._lastFaceRight = enemy.x >= m.x;
            } else {
                m._tacticalTarget = { x: enemy.x, y: enemy.y };
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 80;
            }
            return;
        }
        m._enemyTarget = null;

        // 当前矿点目标失效（枯竭/被清）→ 放弃，重新寻找
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

    /** 近战攻击敌人（间隔复用采矿攻击间隔；伤害 = 攻击力 × 伤害倍率） */
    _tryAttackEnemy() {
        const m = this.m;
        const enemy = m._enemyTarget;
        if (!enemy || !enemy.active || enemy.hp <= 0 || enemy._dying) return;
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackInterval;
        if (typeof enemy.takeDamage === 'function') {
            enemy.takeDamage(this._attackDamage, m, 'physical', true);
        }
    }

    /** 采矿攻击：间隔到点即对矿点造成固定伤害（只打矿点） */
    _tryAttack() {
        const m = this.m;
        const node = m.target;
        if (!node || !node.active || node.hp <= 0 || node._depleted) return;
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackInterval;
        if (typeof node.takeDamage === 'function') {
            const dealt = node.takeDamage(this._attackDamage, m, 'physical', true) || 0;
            // 采矿效率：矿点按 gatherRatio 掉能源之外，效率加成直接注入背包
            if (this.miningMult > 1.001 && EnergyManager) {
                const bonus = Math.round(dealt * (ENERGY_CONFIG.gatherRatio || 0.5) * (this.miningMult - 1));
                if (bonus > 0 && EnergyManager.addEnergy(bonus)) {
                    if (EffectManager) {
                        EffectManager.add(new FloatingTextEffect(m.x, m.y - 28, `+${bonus}⚡`, '#7fd4ff'));
                    }
                }
            }
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

    /** 收集交战半径内的敌人（_faction==='enemy'，存活） */
    _nearestEnemy(entities, range) {
        let best = null;
        let bestD = range;
        const iter = entities && entities.values ? entities.values() : entities || [];
        for (const e of iter) {
            if (!e || !e.active) continue;
            if (e._faction !== 'enemy') continue;
            if (e.hp <= 0 || e._dying) continue;
            const d = Math.hypot(e.x - this.m.x, e.y - this.m.y);
            if (d <= bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }
}
