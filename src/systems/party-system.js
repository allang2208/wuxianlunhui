// ============================================================
// 队伍系统（PartySystem，2026-08-12 框架）
// 需求：最多 4 人组队；队员经验 = 战斗击杀时获取、与玩家同额、无平分机制；
//       UI 通过 onChange 订阅刷新（组队栏 / 出征队员栏 / 队员面板）。
// 单例挂载：src/game.js PartySystem.init()
// 队员档案化：解除招募（移出队伍）时保留完整状态（等级/属性/装备/背包/技能），
// 下次再招募从档案恢复继承（_roster[archiveId] = serialize()）。
// ============================================================

import { Companion } from '../entities/companion.js';
import companionConfigData from '../../data/companion-config.json';

export const PartySystem = {
    _members: [],       // Companion[]
    _listeners: [],     // fn() 状态变化通知
    _maxSize: 4,
    _selectedIds: [],   // 组队栏选中队员 id（点击选中 / Shift+点击多选；指令轮盘以此为目标）
    _roster: {},        // 已解锁队员档案库：archiveId → Companion.serialize()（移出后保留，再招募恢复）
    _aiFactories: {},   // archiveId → (companion) => CompanionAI（浏览器运行时由 Game 注册）
    _aiInstances: {},   // archiveId → CompanionAI 实例缓存

    init() {
        this._maxSize = companionConfigData.maxPartySize || 4;
        this._members = [];
        this._listeners = [];
        this._selectedIds = [];
        this._roster = {};
        this._aiFactories = {};
        this._aiInstances = {};
    },

    /** 注册队员 AI 工厂（保持本模块无 Phaser 依赖，可单测） */
    registerAI(archiveId, factory) {
        if (typeof factory === 'function') this._aiFactories[archiveId] = factory;
    },

    /** 战斗/跟随 AI 主循环（Game.update 每帧调用） */
    updateCombat(dt, entities, player) {
        if (!this._members.length) return;
        for (const m of this._members) {
            if (!this._aiFactories[m.id]) continue;
            if (!this._aiInstances[m.id]) this._aiInstances[m.id] = this._aiFactories[m.id](m);
            const ai = this._aiInstances[m.id];
            if (ai) ai.update(dt, entities, player);
        }
    },

    get members() { return this._members; },
    get maxSize() { return this._maxSize; },
    get size() { return this._members.length; },
    get isFull() { return this._members.length >= this._maxSize; },

    /** 候选档案列表（招募界面数据源） */
    get candidates() {
        return (companionConfigData.companions || []).map(a => ({
            ...a,
            unlocked: !!this._roster[a.id],
            inParty: this._members.some(m => m.id === a.id),
        }));
    },

    /** 按档案 id 加入队伍；满员/未知/已在队返回 false。已解锁队员从档案恢复继承状态 */
    addCompanion(archiveId) {
        if (this.isFull) return false;
        const archive = (companionConfigData.companions || []).find(a => a.id === archiveId);
        if (!archive) return false;
        if (this._members.some(m => m.id === archiveId)) return false;
        const companion = this._roster[archiveId]
            ? Companion.fromSerialized(this._roster[archiveId])
            : new Companion(archive);
        this._members.push(companion);
        this._notify();
        return true;
    },

    /** 按 id 移出队伍（释放名额；状态存入档案库，再招募继承） */
    removeCompanion(companionId) {
        const i = this._members.findIndex(m => m.id === companionId);
        if (i < 0) return false;
        const member = this._members[i];
        this._members.splice(i, 1);
        // 移出队伍的队员同时退出选中（避免轮盘目标指向已离队单位）
        const si = this._selectedIds.indexOf(companionId);
        if (si >= 0) this._selectedIds.splice(si, 1);
        // 档案化：保留完整状态（等级/属性/装备/背包/技能），下次招募从档案恢复
        this._roster[companionId] = member.serialize();
        delete this._aiInstances[companionId];
        this._notify();
        return true;
    },

    /**
     * 组队栏选中（2026-08-16）：点击名字=单选、Shift+点击=多选切换。
     * 数据与 UI 解耦：PartyUI 渲染槽位高亮、CompanionCommandWheel 以此为目标、
     * GameScene 按此高亮模型精灵。选中只作用于当前在队队员。
     */
    get selectedIds() {
        // 惰性过滤：离队/失效的 id 不进入结果（removeCompanion 也会主动清理）
        return this._selectedIds.filter(id => this._members.some(m => m.id === id));
    },

    isSelected(companionId) {
        return this._selectedIds.includes(companionId)
            && this._members.some(m => m.id === companionId);
    },

    /** 单选（或整体替换为给定集合） */
    setSelected(ids) {
        const list = (Array.isArray(ids) ? ids : [ids])
            .filter(id => this._members.some(m => m.id === id));
        const changed = list.length !== this._selectedIds.length
            || list.some((id, idx) => this._selectedIds[idx] !== id);
        this._selectedIds = list;
        if (changed) this._notify();
    },

    /** Shift+点击：切换单个队员的选中状态 */
    toggleSelected(companionId) {
        if (!this._members.some(m => m.id === companionId)) return;
        const idx = this._selectedIds.indexOf(companionId);
        if (idx >= 0) this._selectedIds.splice(idx, 1);
        else this._selectedIds.push(companionId);
        this._notify();
    },

    /** 清空选中（点组队栏玩家槽位等） */
    clearSelection() {
        if (!this._selectedIds.length) return;
        this._selectedIds = [];
        this._notify();
    },

    /** 档案库（供存档系统持久化；serialize 与恢复接口预留） */
    serializeRoster() {
        return JSON.parse(JSON.stringify(this._roster));
    },

    restoreRoster(roster) {
        if (roster && typeof roster === 'object') this._roster = JSON.parse(JSON.stringify(roster));
    },

    getMember(companionId) {
        return this._members.find(m => m.id === companionId) || null;
    },

    /**
     * 队员指令（2026-08-14 指挥轮盘）：写在队员对象上，CompanionAI 每 tick 读取。
     * @param {string|string[]|'all'} target 队员 id / id 数组 / 'all'
     * @param {'follow'|'aggressive'|'patrol'|'gather'|'hold'} mode
     * @param {{x:number,y:number}|null} point 指令点（巡逻圆心/采集目标附近，世界坐标）
     * @returns {number} 生效的队员数
     */
    setCommand(target, mode, point = null) {
        const ids = target === 'all'
            ? this._members.map(m => m.id)
            : (Array.isArray(target) ? target : [target]);
        let n = 0;
        for (const m of this._members) {
            if (!ids.includes(m.id)) continue;
            m._command = {
                mode,
                point: point ? { x: point.x, y: point.y } : null,
            };
            n++;
        }
        return n;
    },

    /** 查询某队员当前指令（默认 follow） */
    getCommand(companionId) {
        const m = this.getMember(companionId);
        return (m && m._command) || { mode: 'follow', point: null };
    },

    /**
     * 战斗经验分发：与玩家同额、不设平分机制，每位在队队员全量获得。
     * 由击杀结算（damageable-entity）在给玩家经验的同时调用。
     */
    grantCombatExp(amount) {
        if (amount <= 0) return;
        for (const m of this._members) m.gainExp(amount);
        if (this._members.length) this._notify();
    },

    /** 订阅 UI 刷新；返回取消函数 */
    onChange(fn) {
        this._listeners.push(fn);
        return () => {
            const i = this._listeners.indexOf(fn);
            if (i >= 0) this._listeners.splice(i, 1);
        };
    },

    _notify() {
        for (const fn of this._listeners) {
            try { fn(); } catch (err) { console.warn('[PartySystem] listener error:', err); }
        }
    },
};
