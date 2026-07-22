import { DungeonConfig } from '../config/dungeon-config.js';
import { createTimeAgentAssault } from './zombie-dungeon.js';
import invasionConfig from '../../data/agent-invasion.json';

/**
 * 时空特工追击机制（配置：data/agent-invasion.json，勿硬编码）
 *
 * - 仅 D 级及以上难度地牢触发（minGrade）；
 * - 回合制：玩家每进入一个节点 = 1 回合；
 * - 达到"达到 Boss 房间最少房间数"（minRoomsToBoss）回合后开始判定：
 *   初始 25%，每 2 回合 +5%（地图左侧小鼠商店上方显示，浅绿→深红渐变）；
 * - 判定成功：特工出现在起始点，沿最短路线追击（默认 2 格/回合，不触发沿途事件）；
 * - 特工与玩家节点重叠（追上）后，玩家进入的下一节点触发入侵战斗：
 *   情况1 随机事件节点 → 先强制特工战（4096 场地，仅特工），胜利后进入原事件；
 *   情况2 战斗节点 → 原怪物 + 随机自由边刷特工（特工与全场敌对，最近优先）；
 *   情况3 BOSS/奖励节点 → 同情况1，胜利后正常进入 BOSS/奖励房间。
 */

const GRADE_ORDER = ['F', 'E', 'D', 'C', 'B', 'A'];

export const AgentInvasionSystem = {
    active: false,
    eligible: false,
    turnCount: 0,
    chance: 0,
    triggered: false,
    caught: false,
    invasionsUsed: 0,
    agentNodeId: null,
    _dms: null,
    _label: null,

    get config() { return invasionConfig; },

    init(dms) {
        this._dms = dms;
        this.turnCount = 0;
        this.chance = 0;
        this.triggered = false;
        this.caught = false;
        this.invasionsUsed = 0;
        this.agentNodeId = null;
        const list = DungeonConfig.getDungeonList();
        const grade = (list[dms.dungeonType] && list[dms.dungeonType].grade) || 'F';
        const minGrade = invasionConfig.minGrade || 'D';
        this.eligible = invasionConfig.enabled !== false
            && GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(minGrade);
        this.active = true;
        this._removeLabel();
    },

    reset() {
        this.active = false;
        this.eligible = false;
        this._dms = null;
        this._removeLabel();
    },

    /** 达到 Boss 房间最少房间数（判定起始回合） */
    _getStartTurns() {
        const cfg = DungeonConfig.getZombieDungeonConfig(this._dms.dungeonType);
        return cfg.minRoomsToBoss ?? Infinity;
    },

    /** 玩家每进入一个节点调用（= 1 回合） */
    onPlayerEnterNode(_node) {
        if (!this.active || !this.eligible) return;
        this.turnCount++;
        const startTurns = this._getStartTurns();
        if (this.turnCount < startTurns) {
            this._removeLabel();
            return;
        }
        // 几率推进：初始 25%，每 2 回合 +5%
        const turnsActive = this.turnCount - startTurns;
        const stepTurns = invasionConfig.chanceStepTurns || 2;
        this.chance = Math.min(1,
            (invasionConfig.initialChance ?? 0.25) + Math.floor(turnsActive / stepTurns) * (invasionConfig.chanceStep ?? 0.05));
        this._updateLabel();

        if (this.invasionsUsed >= (invasionConfig.maxInvasionsPerRun ?? 1)) return;

        if (!this.triggered) {
            // 每回合判定入侵
            if (Math.random() < this.chance) {
                this.triggered = true;
                this.invasionsUsed++;
                const startNode = this._dms.nodes.find(n => n.type === 'start');
                this.agentNodeId = startNode ? startNode.id : this._dms.currentNodeId;
                this._updateLabel();
            }
        } else if (!this.caught) {
            // 特工沿最短路线追击（不触发沿途事件）
            const path = this._findPath(this.agentNodeId, this._dms.currentNodeId);
            if (path.length > 1) {
                const steps = Math.min(invasionConfig.agentMovesPerTurn ?? 2, path.length - 1);
                this.agentNodeId = path[steps];
            }
            // 追上：与玩家当前节点重叠 → 玩家下一节点触发入侵战斗
            if (this.agentNodeId === this._dms.currentNodeId) {
                this.caught = true;
                this._removeLabel();
            }
        }
    },

    /** 追上后是否拦截该节点（强制入侵战斗） */
    shouldIntercept(node) {
        return this.caught && node && node.type !== 'empty' && node.type !== 'start';
    },

    /** 当前地牢难度等级 */
    getGrade() {
        const list = DungeonConfig.getDungeonList();
        return (list[this._dms.dungeonType] && list[this._dms.dungeonType].grade) || 'D';
    },

    /** 入侵战斗刷新特工数量（按难度配置） */
    getAgentCount() {
        const byGrade = invasionConfig.agentCountByGrade || {};
        return byGrade[this.getGrade()] ?? 1;
    },

    getArenaSize() { return invasionConfig.arenaSize || 4096; },
    getEdgeSpawnMargin() { return invasionConfig.edgeSpawnMargin || 200; },

    /** 供 CombatRoomSystem.spawnMonsters 使用的特工类工厂（其内部 new 调用等价工厂调用） */
    spawnAgentClass() { return createTimeAgentAssault; },

    /** 生成一只入侵特工（全场敌对：faction=agent + 自管最近目标） */
    spawnAgent(x, y) {
        const agent = createTimeAgentAssault(x, y);
        this.markAsInvasion(agent);
        return agent;
    },

    /** 标记为入侵特工（faction=agent 与全场敌对，类内自管最近目标） */
    markAsInvasion(agent) {
        if (!agent) return;
        agent._invasionAgent = true;
        agent._faction = 'agent';
    },

    /** 节点图 BFS 最短路径（返回 id 数组，含起点终点） */
    _findPath(fromId, toId) {
        if (fromId === toId) return [fromId];
        const edges = this._dms.edges;
        const prev = new Map([[fromId, null]]);
        const queue = [fromId];
        while (queue.length > 0) {
            const cur = queue.shift();
            if (cur === toId) break;
            for (const e of edges) {
                let next = null;
                if (e.from === cur) next = e.to;
                else if (e.to === cur) next = e.from;
                if (next && !prev.has(next)) {
                    prev.set(next, cur);
                    queue.push(next);
                }
            }
        }
        if (!prev.has(toId)) return [fromId];
        const path = [];
        let cur = toId;
        while (cur !== null) { path.unshift(cur); cur = prev.get(cur); }
        return path;
    },

    // ========== 几率显示（地图左侧，小鼠商店上方） ==========

    _lerpColor(t) {
        const hex = (s) => {
            const m = String(s || '').replace('#', '');
            return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
        };
        const a = hex(invasionConfig.display?.colorStart);
        const b = hex(invasionConfig.display?.colorEnd);
        const r = Math.round(a.r + (b.r - a.r) * t);
        const g = Math.round(a.g + (b.g - a.g) * t);
        const bl = Math.round(a.b + (b.b - a.b) * t);
        return `rgb(${r},${g},${bl})`;
    },

    _updateLabel() {
        const d = invasionConfig.display || {};
        if (!this._label) {
            const el = document.createElement('div');
            el.id = 'invasionChanceLabel';
            el.style.cssText = `
                position: fixed;
                left: ${d.left ?? 20}px;
                bottom: ${d.bottomCss || 'calc(18.84vh + 85px)'};
                z-index: 9000;
                pointer-events: none;
                user-select: none;
                font-family: SimHei, "Microsoft YaHei", "黑体", sans-serif;
                font-size: 18px;
                font-weight: 700;
                text-shadow: 0 2px 4px rgba(0,0,0,0.8);
            `;
            document.body.appendChild(el);
            this._label = el;
        }
        const initial = invasionConfig.initialChance ?? 0.25;
        const t = Math.max(0, Math.min(1, (this.chance - initial) / (1 - initial)));
        this._label.style.color = this._lerpColor(t);
        const pct = Math.round(this.chance * 100);
        this._label.textContent = this.triggered
            ? `${d.label || '时空特工入侵几率'}：已入侵！`
            : `${d.label || '时空特工入侵几率'}：${pct}%`;
    },

    _removeLabel() {
        if (this._label) {
            this._label.remove();
            this._label = null;
        }
    },
};
