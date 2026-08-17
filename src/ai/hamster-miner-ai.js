// ============================================================
// HamsterMinerAI — 仓鼠矿工 AI（2026-08-15，2026-08-15 仓鼠小屋扩展）
// 玩家友方单位：在世界-122 自动采矿，并在附近有敌人时近战自卫。
// - 只采矿：自动找最近能源矿点（_isEnergyNode）采矿，间隔攻击产出能源；
//   （2026-08-16 用户口径回归：只能对能源矿点攻击、不攻击其他单位——矿工不参与
//   基地防御，被怪打也不还手，仅靠 _enemyTargetable 拉仇恨 + 可被击杀）
// - 采矿效率：miningMult 直接乘到采矿攻击伤害（矿点掉落的能源随之提升）；
// - 移动复用 MovementSystem（寻路/墙碰撞），移速 walkSpeed（小屋升级 +5%/级）；
// - 动画状态：walk（移动）/ mining（采矿或近战）/ idle（待机）。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { pickNearestNode } from './companion-ai-decision.js';
import { SoundManager } from '../ui/sound-manager.js';

export class HamsterMinerAI {
    constructor(miner) {
        this.m = miner;
        this.cfg = miner.aiConfig || {};
        this._decisionTimer = 0;
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2000;
        this._attackDamage = this.cfg.attackDamage ?? 100;
        this._miningRange = this.cfg.miningRange ?? 80;
        this.miningMult = this.cfg.miningMult ?? 1;        // 采矿效率倍率（小屋升级）
        // 隐藏背包物流（2026-08-15）：work 采矿 → return 回小屋 → unload 卸货（idle 2s + 门开关）
        this._phase = 'work';          // 'work' | 'return' | 'unload'
        this._unloadTimer = 0;
        this._pickupTimer = 0;
        this._returnTriggered = false; // 满载只触发一次返回（防小屋消失后振荡）
        // 卡死看门狗（2026-08-15）：走路长时间位移≈0 → 重新选点/传送到目标附近
        this._stuckTimer = 0;
        this._lastPosX = 0;
        this._lastPosY = 0;
        this._stuckStreak = 0;
        this._stuckEscalation = 0; // 连续卡死升级：先原地脱困，再直接传送到目标附近
        // 路径振荡守卫（2026-08-16）：走路但航点被反复重算成另一条路线（幽灵路径/
        // 双路线翻转）→ 2.5s 窗口内当前航点跳变 >150px 且矿工没沿任何一条走远 →
        // 清路径强制用当前 A* 重算（正确绕行路线），不做传送。
        this._oscTimer = 0;
        this._oscPrevWp = null;
        this._oscPrevX = 0;
        this._oscPrevY = 0;
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
        if (typeof u.backpackCapacity === 'number' && u.backpackCapacity > 0) {
            this.m._energyCapacity = u.backpackCapacity;
            if (this.m._energyCarried > this.m._energyCapacity) {
                this.m._energyCarried = this.m._energyCapacity;
            }
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

        // 卸货阶段：小屋门口 idle 2s（不移动不交战），结束后关门并重新出发
        if (this._phase === 'unload') {
            this._unloadTimer -= dt;
            m._animState = 'idle';
            m._tacticalTarget = null;
            m.target = null;
            m._enemyTarget = null;
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            m.maxSpeed = 0;
            if (this._unloadTimer <= 0) {
                this._phase = 'work';
                if (m._hut && typeof m._hut.closeDoor === 'function') m._hut.closeDoor();
            }
            return;
        }

        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities);
        }

        // 工作阶段：自动拾取地面能量进隐藏背包（150ms 节流）
        this._pickupTimer -= dt;
        if (this._phase === 'work' && this._pickupTimer <= 0) {
            this._pickupTimer = 150;
            this._pickupEnergyDrops(entities);
        }

        // 采矿中：站定（不调用 MovementSystem 移动），间隔对矿点攻击
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
        this._checkOscillation(dt);
        // 卡死看门狗：复用怪物避障机制外的兜底（重新规划/传送），避免被障碍卡死找不到目标
        this._checkStuck(dt);
    }

    /** 路径振荡守卫：检测寻路双路线翻转（原地左右摆动/幽灵路径），清路径强制重算 */
    _checkOscillation(dt) {
        const m = this.m;
        if (m._animState !== 'walk') {
            this._oscTimer = 0;
            this._oscPrevWp = null;
            this._oscPrevX = m.x;
            this._oscPrevY = m.y;
            return;
        }
        this._oscTimer += dt;
        if (this._oscTimer < 2500) return;
        this._oscTimer = 0;
        const pm = m._pathManager;
        const wp = pm && pm.path && pm.path[pm.pathIdx] ? pm.path[pm.pathIdx] : null;
        const moved = Math.hypot(m.x - this._oscPrevX, m.y - this._oscPrevY);
        this._oscPrevX = m.x;
        this._oscPrevY = m.y;
        let flipped = false;
        if (this._oscPrevWp && wp) {
            // 当前航点相对上次检查跳变 >150px = 路径被重算成另一条路线（东/西两条）
            flipped = Math.hypot(wp.x - this._oscPrevWp.x, wp.y - this._oscPrevWp.y) > 150;
        }
        this._oscPrevWp = wp ? { x: wp.x, y: wp.y } : null;
        // 航点翻转 + 矿工没沿任何一条路线走远（<120px）→ 原地振荡，清路径重算
        if (flipped && moved < 120) {
            if (pm) pm._clearPath();
            m._tacticalTarget = null;
            this._oscPrevWp = null;
        }
    }

    /**
     * 决策 tick：维护目标矿点并设置移动/采矿状态。
     * 只认 _isEnergyNode 且 active 且未枯竭的矿点；矿点枯竭/消失自动换下一个。
     */
    _tick(entities) {
        const m = this.m;
        // 卸货阶段：保持 idle（不进入战斗）
        if (this._phase === 'unload') {
            m._animState = 'idle';
            m._tacticalTarget = null;
            m.target = null;
            m._enemyTarget = null;
            m.maxSpeed = 0;
            return;
        }

        // 返回小屋卸货：背包满后直奔小屋门口
        if (this._phase === 'return') {
            const hut = m._hut;
            if (!hut || !hut.active) {
                this._phase = 'work'; // 小屋没了（防御性兜底，正常随小屋销毁）
                this._returnTriggered = true; // 背包仍满：不再反复触发返回
            } else {
                const dist = Math.hypot(hut.x - m.x, hut.y - m.y);
                if (dist <= 70) {
                    this._startUnload();
                } else {
                    m.target = null;
                    // 走到小屋边缘可达点（小屋中心是碰撞体，直接寻路到中心可能失败）
                    const dx = m.x - hut.x;
                    const dy = m.y - hut.y;
                    const d = Math.hypot(dx, dy) || 1;
                    const approach = 64; // 小屋半径 40 + 矿工半径 26 = 66，取 64 贴近门边
                    m._tacticalTarget = { x: hut.x + (dx / d) * approach, y: hut.y + (dy / d) * approach };
                    m._animState = 'walk';
                    m.maxSpeed = this.cfg.walkSpeed ?? 80;
                }
            }
            return;
        }

        // 工作阶段：隐藏背包满 → 返回小屋卸货
        const capacity = m._energyCapacity || 500;
        if (m._energyCarried >= capacity) {
            if (!this._returnTriggered) {
                this._returnTriggered = true;
                this._startReturn();
            }
            return;
        }
        this._returnTriggered = false;

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
        // 赶路：朝矿点移动（移速 80）——目标用矿点边缘可达点（矿点本身是 A* 障碍，
        // 直接寻路到中心会失败/卡住；接近点须在 障碍半径+自身半径 之外且进入采矿范围）
        // 接近点再外扩 40px：路径终点避开矿点 A* 实体障碍（45+26=71），
        // 并远离墙体死区——否则路径末段节点贴近障碍会被 _checkValidity 判阻挡反复修复
        // 接近点必须：① 在矿点 A* 实体障碍之外（可到达）；② 在采矿范围之内（到位即触发采矿）。
        // 采矿距离收到 50 后，采矿范围 = 50 + 节点半径(45) = 95，接近点夹到 ~80
        const nodeR = node.groundRadius || 45;
        const miningRange = this._miningRange + nodeR;
        const approachDist = Math.max(
            nodeR + (m.groundRadius || 26) + 5,
            Math.min(Math.max(this._miningRange, nodeR + (m.groundRadius || 26) + 40), miningRange - 15)
        );
        const dx = m.x - node.x;
        const dy = m.y - node.y;
        const dd = Math.hypot(dx, dy) || 1;
        m._tacticalTarget = { x: node.x + (dx / dd) * approachDist, y: node.y + (dy / dd) * approachDist };
        m._animState = 'walk';
        m.maxSpeed = this.cfg.walkSpeed ?? 80;
    }

    /** 卡死看门狗（2026-08-15）：走路 500ms 位移 <3px 累计 2 次 → 重新规划/传送 */
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
            this._stuckEscalation = 0;
            return;
        }
        this._stuckStreak++;
        if (this._stuckStreak < 2) return;
        this._stuckStreak = 0;
        if (this._phase === 'work') {
            // 卡死脱困：可能卡进墙体死区（MovementSystem resolve 反复 clear 路径）。
            // 第一次先原地脱离 + 重选矿点；连续卡死（升级）→ 直接传送到矿点附近合法点，
            // 终结「顶墙 → 清路径 → 直线顶墙」死循环（与 CompanionAI 卡死瞬移同款兜底）
            this._stuckEscalation++;
            const near = this._stuckEscalation >= 2 ? (m.target || null) : null;
            const anchor = near && near.active ? near : m;
            if (WallSystem && typeof WallSystem.findSafeSpawn === 'function') {
                let sp = null;
                if (near && near.active) {
                    // 传送到矿点旁 95px 合法点（避免落在矿点中心/障碍上）
                    for (let i = 0; i < 8; i++) {
                        const a = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
                        const px = near.x + Math.cos(a) * 95;
                        const py = near.y + Math.sin(a) * 95;
                        if (!WallSystem.canMoveTo || WallSystem.canMoveTo(px, py, m.groundRadius || 24)) {
                            sp = { x: px, y: py };
                            break;
                        }
                    }
                }
                if (!sp) sp = WallSystem.findSafeSpawn(anchor.x, anchor.y, m.groundRadius || 24);
                if (sp && Number.isFinite(sp.x) && Number.isFinite(sp.y)
                    && Math.hypot(sp.x - m.x, sp.y - m.y) > 5) {
                    m.x = sp.x;
                    m.y = sp.y;
                }
            }
            if (near) this._stuckEscalation = 0;
            m.target = null;
            m._tacticalTarget = null;
            if (m._pathManager) m._pathManager._clearPath();
        } else if (this._phase === 'return' && m._hut && m._hut.active) {
            // 传送到小屋附近合法点
            if (WallSystem && typeof WallSystem.findSafeSpawn === 'function') {
                const sp = WallSystem.findSafeSpawn(m._hut.x, m._hut.y, m.groundRadius || 24);
                if (sp && Number.isFinite(sp.x) && Number.isFinite(sp.y)) {
                    m.x = sp.x;
                    m.y = sp.y;
                }
            }
        }
    }

    /** 采矿攻击：间隔到点对矿点造成伤害；采矿效率（miningMult）直接乘在攻击力上 */
    _tryAttack() {
        const m = this.m;
        const node = m.target;
        if (!node || !node.active || node.hp <= 0 || node._depleted) return;
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackInterval;
        if (typeof node.takeDamage === 'function') {
            const miningDamage = Math.max(1, Math.round(this._attackDamage * this.miningMult));
            node.takeDamage(miningDamage, m, 'physical', true);
            m._miningSwing = true; // 攻击命中 → 渲染层播一次挥锄动画（2026-08-15）
            this._playSound('mining'); // 采矿音效（2026-08-16 用户素材）
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

    /** 自动拾取地面能源掉落进隐藏背包（上限=背包容量；已满不再拾取，留给玩家） */
    _pickupEnergyDrops(entities) {
        const m = this.m;
        const capacity = m._energyCapacity || 500;
        if (m._energyCarried >= capacity) return;
        const radius = 100;
        const pick = (key, e) => {
            if (!e || !e.active) return false;
            if (!e.itemData || e.itemData.category !== 'energy') return false;
            if (Math.hypot(e.x - m.x, e.y - m.y) > radius) return false;
            const amount = e.itemData.stack || 1;
            const take = Math.min(amount, capacity - m._energyCarried);
            if (take <= 0) return true; // 已满，不处理
            m._energyCarried += take;
            e.active = false;
            if (typeof e._destroyPhaserSprite === 'function') e._destroyPhaserSprite();
            if (key !== null && entities && typeof entities.delete === 'function') entities.delete(key);
            return m._energyCarried >= capacity;
        };
        if (entities && typeof entities.entries === 'function') {
            for (const [key, e] of entities.entries()) {
                if (pick(key, e)) break;
            }
        } else {
            for (const e of (entities || [])) {
                if (pick(null, e)) break;
            }
        }
    }

    /** 背包满 → 进入返回小屋阶段 */
    _startReturn() {
        const m = this.m;
        this._phase = 'return';
        m.target = null;
        m._enemyTarget = null;
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(m.x, m.y - 32, '背包已满，返回小屋', '#ffaa55'));
        }
    }

    /** 到达小屋 → 卸货：能量移交玩家背包（满则暂存小屋），门开 + idle 2s */
    _startUnload() {
        const m = this.m;
        this._phase = 'unload';
        this._unloadTimer = 2000;
        m._animState = 'idle';
        m._tacticalTarget = null;
        m.target = null;
        m._enemyTarget = null;
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        m.maxSpeed = 0;
        if (m._hut && typeof m._hut.unloadMiner === 'function') {
            m._hut.unloadMiner(m);
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
