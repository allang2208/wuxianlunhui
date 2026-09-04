// ============================================================
// HamsterMinerAI — 仓鼠矿工 AI（2026-08-15，2026-08-15 仓鼠小屋扩展）
// 经济平民：在世界-122 自动采矿，不接受 RTS 指令。
// - 只采矿：自动找最近能源矿点（_isEnergyNode）采矿，间隔攻击产出能源；
//   （2026-08-16 用户口径回归：只能对能源矿点攻击、不攻击其他单位——矿工不参与
//   基地防御，被怪打也不还手，仅靠 _enemyTargetable 拉仇恨 + 可被击杀）
// - 采矿效率：miningMult 直接乘到采矿攻击伤害（进入个人背包的能源随之提升）；
// - 移动复用 MovementSystem（寻路/墙碰撞），移速 walkSpeed（小屋升级 +5%/级）；
// - 动画状态：walk（移动）/ mining（采矿或近战）/ idle（待机）。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { pickNearestNode } from './companion-ai-decision.js';
import { SoundManager } from '../ui/sound-manager.js';
import { stableAiPhase } from './friendly-spatial-query.js';
import {
    distanceToIsoFootprint,
    isoFootprintCenter,
    isoFootprintHalfExtents,
    isoLocalToWorldDelta,
    resolveCircleFromIsoFootprint,
    worldDeltaToIsoLocal,
} from '../physics/iso-footprint.js';
import { WallSystem } from '../world/wall-system.js';

// 营地的 x/y 是菱形前顶点，不能再用旧圆形小屋的64px半径作为返营目标。
function hutUnloadApproach(miner, hut) {
    const radius = Math.max(1, Number(miner.groundRadius) || 20);
    const center = isoFootprintCenter(hut);
    const { halfU, halfV } = isoFootprintHalfExtents(hut);
    const local = worldDeltaToIsoLocal(miner.x - center.x, miner.y - center.y);
    const u = Math.max(-halfU, Math.min(halfU, local.u));
    const v = Math.max(-halfV, Math.min(halfV, local.v));
    const distance = Math.hypot(local.u - u, local.v - v);
    let point;
    if (distance > 0) {
        const margin = radius + 12;
        const delta = isoLocalToWorldDelta(
            u + (local.u - u) / distance * margin,
            v + (local.v - v) / distance * margin
        );
        point = { x: center.x + delta.x, y: center.y + delta.y };
    } else {
        const push = resolveCircleFromIsoFootprint(miner.x, miner.y, radius + 12, hut);
        point = { x: miner.x + (push?.x || 0), y: miner.y + (push?.y || 0) };
    }
    const arrived = distanceToIsoFootprint(miner.x, miner.y, hut) <= radius + 36
        && !WallSystem.blocked(miner.x, miner.y, point.x, point.y);
    return { point, arrived };
}

export class HamsterMinerAI {
    constructor(miner) {
        this.m = miner;
        this.cfg = miner.aiConfig || {};
        this._decisionTimer = stableAiPhase(miner, this.cfg.decisionMs ?? 120);
        this._attackTimer = 0;
        this._baseAttackInterval = this.cfg.attackInterval ?? 2000;
        this._laborEfficiency = Math.max(0, Math.min(1,
            Number.isFinite(Number(this.cfg.laborEfficiency))
                ? Number(this.cfg.laborEfficiency) : 1));
        this._refreshAttackInterval();
        this._attackDamage = this.cfg.attackDamage ?? 25;
        this._miningRange = this.cfg.miningRange ?? 80;
        this.miningMult = this.cfg.miningMult ?? 1;        // 采矿效率倍率（小屋升级）
        // 物流：矿点产出先装个人背包；背包满或岗位撤销后返回营地提交。
        this._phase = 'work';          // 'work' | 'unload_return' | 'storage_wait'
        // 卡死看门狗：走路长时间位移≈0 → 清旧路径并重新规划。
        this._stuckTimer = 0;
        this._lastPosX = 0;
        this._lastPosY = 0;
        this._stuckStreak = 0;
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
            this._baseAttackInterval = u.attackInterval;
            this.cfg.attackInterval = u.attackInterval;
        }
        if (typeof u.laborEfficiency === 'number') {
            this._laborEfficiency = Math.max(0, Math.min(1, u.laborEfficiency));
            this.cfg.laborEfficiency = this._laborEfficiency;
        }
        this._refreshAttackInterval();
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

    /** 前台与后台统一按“基础攻击间隔 ÷ 人口效率”结算工作节拍。 */
    _refreshAttackInterval() {
        this._attackInterval = this._laborEfficiency > 0
            ? this._baseAttackInterval / this._laborEfficiency
            : Number.MAX_SAFE_INTEGER;
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

        // 矿工不进入玩家选择体系；清理旧存档/旧指挥模式可能遗留的命令。
        if (m._command?.mode && m._command.mode !== 'follow') m._command = { mode: 'follow' };

        // 仓库暂时放不下：停在营地，容量恢复后继续提交；岗位撤销则提交完离岗。
        if (this._phase === 'storage_wait') {
            if (this._decisionTimer <= 0) {
                this._decisionTimer = this.cfg.decisionMs ?? 120;
                this._tryUnloadAtHut();
            }
            m._animState = 'idle';
            m._tacticalTarget = null;
            m.target = null;
            m._enemyTarget = null;
            // 平滑站定：速度指数衰减（≈0.85/帧），代替瞬时清零的急停
            const damp = Math.pow(0.85, dt / 16.67);
            m.vx *= damp;
            m.vy *= damp;
            if (Math.abs(m.vx) < 1 && Math.abs(m.vy) < 1) { m.vx = 0; m.vy = 0; }
            m.isMoving = false;
            m.maxSpeed = 0;
            return;
        }

        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities);
        }
        if (!m.active) return;

        // 采矿中：站定（不调用 MovementSystem 移动），间隔对矿点攻击
        if (m._animState === 'mining') {
            // 平滑站定：速度指数衰减（≈0.85/帧），代替瞬时清零的急停
            const damp = Math.pow(0.85, dt / 16.67);
            m.vx *= damp;
            m.vy *= damp;
            if (Math.abs(m.vx) < 1 && Math.abs(m.vy) < 1) { m.vx = 0; m.vy = 0; }
            m.isMoving = false;
            m.maxSpeed = 0;
            this._tryAttack();
            return;
        }

        // 移动中：交给 MovementSystem 寻路推进
        MovementSystem.update(m, dt, entities);
        this._checkOscillation(dt);
        // 卡死看门狗：只请求重新规划，运行中不直接改写坐标。
        this._checkStuck(dt);
        // 缓停滑行（maxSpeed=0 后速度沿摩擦/加速度渐近归零）期间保持 walk 动画，
        // 避免站着播 idle 却还在滑行的"滑冰"感
        if (m._animState === 'idle' && Math.hypot(m.vx || 0, m.vy || 0) > 25) {
            m._animState = 'walk';
        }
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
        // 背包满或岗位撤销后直奔营地提交。
        if (this._phase === 'unload_return') {
            const hut = m._hut;
            if (!hut || !hut.active) {
                this._phase = 'storage_wait';
                m._animState = 'idle';
                m._tacticalTarget = null;
                m.maxSpeed = 0;
            } else {
                const approach = hutUnloadApproach(m, hut);
                m._spawnEgress = null;
                if (approach.arrived) {
                    this._tryUnloadAtHut();
                    m._tacticalTarget = null;
                    m._animState = 'idle';
                    m.maxSpeed = 0;
                } else {
                    m.target = null;
                    m._tacticalTarget = approach.point;
                    m._animState = 'walk';
                    m.maxSpeed = this.cfg.walkSpeed ?? 80;
                }
            }
            return;
        }

        if (m._retireRequested || m._energyCarried >= m._energyCapacity) {
            this._startUnloadReturn();
            return;
        }

        // 当前矿点目标失效（枯竭/被清）→ 放弃，重新寻找
        const t = m.target;
        if (t && (!t.active || t.hp <= 0 || t._depleted)) {
            m.target = null;
            m._tacticalTarget = null;
        }

        const nodes = this._energyNodes(entities);
        if (nodes.length === 0) {
            // 工会专家在最后一处矿脉耗尽后也交付未满背包，避免余矿留在野外。
            if (m._isHamsterMiningExpert && m._energyCarried > 0) {
                this._startUnloadReturn();
                return;
            }
            m.target = null;
            m._tacticalTarget = null;
            m._animState = 'idle';
            // 速度不清零，由 MovementSystem 摩擦衰减缓停
            m.maxSpeed = 0;
            return;
        }

        if (m._restoredMiningTarget) {
            const restored = nodes.find((node) =>
                node.x === m._restoredMiningTarget.x && node.y === m._restoredMiningTarget.y);
            delete m._restoredMiningTarget;
            if (restored) m.target = restored;
        }
        if (!m.target) {
            m.target = pickNearestNode(nodes, m);
            if (!m.target) {
                m._animState = 'idle';
                // 速度不清零，由 MovementSystem 摩擦衰减缓停
                m.maxSpeed = 0;
                return;
            }
        }

        const node = m.target;
        const dist = Math.hypot(node.x - m.x, node.y - m.y);
        const range = this._miningRange + (node.gatherRadius ?? node.groundRadius ?? 45);
        if (dist <= range) {
            // 到矿点：站定采矿
            m._tacticalTarget = null;
            m._animState = 'mining';
            m.maxSpeed = 0;
            m.rotation = Math.atan2(node.y - m.y, node.x - m.x);
            m._lastFaceRight = node.x >= m.x;
            return;
        }
        // 赶路：矿体不再是 A* / 实体碰撞障碍，但仍保留独立采集半径。
        // 接近点只需避开矿工自己的站位抖动，并保持在采矿范围内。
        const nodeR = node.gatherRadius ?? node.groundRadius ?? 45;
        const physicalNodeR = node.noCollision ? 0 : (node.groundRadius || 0);
        const miningRange = this._miningRange + nodeR;
        const approachDist = Math.max(
            physicalNodeR + (m.groundRadius || 26) + 5,
            Math.min(Math.max(this._miningRange, physicalNodeR + (m.groundRadius || 26) + 40), miningRange - 15)
        );
        const dx = m.x - node.x;
        const dy = m.y - node.y;
        const dd = Math.hypot(dx, dy) || 1;
        m._tacticalTarget = { x: node.x + (dx / dd) * approachDist, y: node.y + (dy / dd) * approachDist };
        m._animState = 'walk';
        m.maxSpeed = this.cfg.walkSpeed ?? 80;
    }

    /** 卡死看门狗：走路 500ms 位移 <3px 累计 2 次 → 清旧路径并重新规划。 */
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
        // 保留当前矿点/返营目标，下一帧由 MovementSystem 的 PathManager 重新计算合法路线。
        if (m._pathManager) m._pathManager._clearPath();
    }

    /** 采矿攻击：间隔到点对矿点造成伤害；采矿效率（miningMult）直接乘在攻击力上 */
    _tryAttack() {
        const m = this.m;
        const node = m.target;
        if (!node || !node.active || node.hp <= 0 || node._depleted) return;
        if (!(this._laborEfficiency > 0)) return;
        if (this._attackTimer > 0) return;
        this._attackTimer = this._attackInterval;
        if (typeof node.takeDamage === 'function') {
            const miningDamage = Math.max(1, Math.round(this._attackDamage * this.miningMult));
            const dealt = node.takeDamage(m.getPhysicalAttackDamage(miningDamage, node), m, 'physical', true);
            if (dealt > 0) {
                // 单调序号避免 animationcomplete 丢失后布尔锁永久卡住；渲染层每次新序号必播一次。
                m._miningSwingSeq = (Number(m._miningSwingSeq) || 0) + 1;
                this._playSound('mining');
            }
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

    /** 背包满或岗位撤销 → 返回矿工营地提交。 */
    _startUnloadReturn() {
        const m = this.m;
        if (this._phase === 'unload_return' || this._phase === 'storage_wait') return;
        this._phase = 'unload_return';
        m.target = null;
        m._enemyTarget = null;
        m._tacticalTarget = null;
        m._animState = 'idle';
        m.maxSpeed = 0;
        if (m._pathManager) m._pathManager._clearPath();
    }

    /** 抵达营地后提交背包；仓库满则原地等待，全部提交后复工或离岗。 */
    _tryUnloadAtHut() {
        const m = this.m;
        const hut = m._hut;
        if (!hut?.active || typeof hut.unloadMiner !== 'function') {
            this._phase = 'storage_wait';
            return;
        }
        if (!hutUnloadApproach(m, hut).arrived) {
            this._phase = 'unload_return';
            return;
        }
        hut.unloadMiner(m);
        if (m._energyCarried > 0) {
            this._phase = 'storage_wait';
            return;
        }
        if (m._retireRequested) {
            m._removeFromScene?.();
            return;
        }
        this._phase = 'work';
        if (m._pathManager) m._pathManager._clearPath();
    }

    /** 旧调用兼容：统一进入返营提交链。 */
    _startUnload() {
        this._startUnloadReturn();
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
