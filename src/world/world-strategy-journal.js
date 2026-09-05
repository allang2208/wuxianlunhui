import { strategicNow } from './strategic-march.js';
import { strategicCell } from './world-map-cells.js';
import { EventBus } from '../core/event-bus.js';

export const STRATEGY_EVENT_LIMIT = 40;
const REPORT_MERGE_WINDOW_MS = 10000;
const kinds = new Set(['arrival', 'blocked', 'target_lost', 'battle', 'battle_result', 'base_entry', 'siege', 'siege_ended', 'order_rejected', 'invasion_warning', 'engineering_report', 'expedition_report']);

function reportLabels(value) {
    return (Array.isArray(value) ? value : [])
        .map((entry) => String(entry || '').trim()).filter(Boolean).slice(-20);
}

function cleanEngineeringReport(value = {}) {
    return {
        buildingUpgrades: reportLabels(value.buildingUpgrades),
        continuousStages: reportLabels(value.continuousStages),
        portals: reportLabels(value.portals),
        recruits: Math.max(0, Math.floor(Number(value.recruits) || 0)),
    };
}

function mergeEngineeringReports(previous, incoming) {
    const left = cleanEngineeringReport(previous), right = cleanEngineeringReport(incoming);
    return cleanEngineeringReport({
        buildingUpgrades: [...left.buildingUpgrades, ...right.buildingUpgrades],
        continuousStages: [...left.continuousStages, ...right.continuousStages],
        portals: [...left.portals, ...right.portals],
        recruits: left.recruits + right.recruits,
    });
}

function engineeringSummary(report) {
    const parts = [];
    if (report.buildingUpgrades.length) parts.push(`建筑升级 ${report.buildingUpgrades.length} 项`);
    if (report.continuousStages.length) parts.push(`持续升级 ${report.continuousStages.length} 阶段`);
    if (report.recruits) parts.push(`新兵 ${report.recruits} 名`);
    if (report.portals.length) parts.push(report.portals.at(-1));
    return parts.join(' · ') || '工程记录已归档';
}

function cleanExpeditionReport(value = {}) {
    return {
        runs: Math.max(0, Math.floor(Number(value.runs) || 0)),
        itemCount: Math.max(0, Math.floor(Number(value.itemCount) || 0)),
        gold: Math.max(0, Math.floor(Number(value.gold) || 0)),
        mailed: Math.max(0, Math.floor(Number(value.mailed) || 0)),
    };
}

function mergeExpeditionReports(previous, incoming) {
    const left = cleanExpeditionReport(previous), right = cleanExpeditionReport(incoming);
    return cleanExpeditionReport({
        runs: left.runs + right.runs,
        itemCount: left.itemCount + right.itemCount,
        gold: left.gold + right.gold,
        mailed: left.mailed + right.mailed,
    });
}

function expeditionSummary(report) {
    const parts = [`探险归来 ${report.runs} 次`];
    if (report.itemCount) parts.push(`战利品 ${report.itemCount} 件`);
    if (report.gold) parts.push(`金币 ${report.gold}`);
    if (report.mailed) parts.push(`信箱附件 ${report.mailed} 项`);
    return parts.join(' · ');
}

// Persistent history, not a second toast queue. Recording/reading never executes an order.
export const StrategicJournal = {
    recordEvent(kind, title, detail = '', extra = {}, { announce = true } = {}) {
        const event = { ...extra, id: this.state.nextEventId++, kind, title, detail,
            at: strategicNow(), createdAt: Date.now(), read: false,
            armyId: extra.armyId || this.state.army?.id || null };
        this.state.events.push(event);
        if (this.state.events.length > STRATEGY_EVENT_LIMIT) this.state.events.splice(0, this.state.events.length - STRATEGY_EVENT_LIMIT);
        if (announce) this._announceJournalEvent(event);
        return event;
    },
    updateEvent(id, patch, { announce = true } = {}) {
        const event = this.state.events.find((item) => item.id === id);
        if (event) {
            const oldPhase = event.phase;
            Object.assign(event, patch, { read: false });
            if (announce && event.kind === 'base_entry' && oldPhase !== event.phase) this._announceJournalEvent(event);
        }
        return event;
    },
    _announceJournalEvent(event, { silent = false } = {}) {
        // Presentation failure must never interrupt a committed order/transfer.
        // Restoring or opening history does not pass through this live event boundary.
        try { EventBus.emit('strategy:journal-event', { eventId: event.id, kind: event.kind, phase: event.phase, silent }); }
        catch (_) { /* The authoritative journal and troop ledger remain intact. */ }
    },
    announceEvent(id, options = {}) {
        const event = this.state.events.find((item) => item.id === id);
        if (event) this._announceJournalEvent(event, options);
    },
    announceJournalRestore() {
        try { EventBus.emit('strategy:journal-restored'); }
        catch (_) { /* The restored journal remains authoritative. */ }
    },
    recordEngineeringReport({ sceneId, worldName = sceneId, report } = {}, options = {}) {
        if (!sceneId) return null;
        const now = Date.now();
        const incoming = cleanEngineeringReport(report);
        if (!incoming.buildingUpgrades.length && !incoming.continuousStages.length
            && !incoming.portals.length && !incoming.recruits) return null;
        const existing = this.state.events.slice().reverse().find((event) =>
            event.kind === 'engineering_report' && event.sceneId === sceneId && !event.read
            && now - Math.max(0, Number(event.createdAt) || 0) <= REPORT_MERGE_WINDOW_MS);
        if (existing) {
            existing.report = mergeEngineeringReports(existing.report, incoming);
            existing.title = `${worldName}工程报告`;
            existing.detail = engineeringSummary(existing.report);
            existing.createdAt = now;
            existing.revision = Math.max(1, Math.floor(Number(existing.revision) || 1)) + 1;
            existing.read = false;
            if (options.announce !== false) this._announceJournalEvent(existing);
            return existing;
        }
        return this.recordEvent('engineering_report', `${worldName}工程报告`, engineeringSummary(incoming), {
            sceneId, phase: 'complete', report: incoming, revision: 1,
        }, options);
    },
    recordExpeditionReport({ sceneId, worldName = sceneId, report } = {}, options = {}) {
        if (!sceneId) return null;
        const now = Date.now();
        const incoming = cleanExpeditionReport(report);
        if (!incoming.runs) return null;
        const existing = this.state.events.slice().reverse().find((event) =>
            event.kind === 'expedition_report' && event.sceneId === sceneId && !event.read
            && now - Math.max(0, Number(event.createdAt) || 0) <= REPORT_MERGE_WINDOW_MS);
        if (existing) {
            existing.report = mergeExpeditionReports(existing.report, incoming);
            existing.title = `${worldName}探险回报`;
            existing.detail = expeditionSummary(existing.report);
            existing.createdAt = now;
            existing.revision = Math.max(1, Math.floor(Number(existing.revision) || 1)) + 1;
            existing.read = false;
            if (options.announce !== false) this._announceJournalEvent(existing);
            return existing;
        }
        return this.recordEvent('expedition_report', `${worldName}探险回报`, expeditionSummary(incoming), {
            sceneId, phase: 'complete', report: incoming, revision: 1,
        }, options);
    },
    readEvent(id) {
        const event = this.state.events.find((item) => item.id === id);
        if (event) {
            event.read = true;
            try { EventBus.emit('strategy:journal-read', { eventIds: [id] }); } catch (_) { /* journal state already committed */ }
        }
    },
    readAllEvents() {
        const eventIds = this.state.events.filter((event) => !event.read).map((event) => event.id);
        this.state.events.forEach((event) => { event.read = true; });
        try { EventBus.emit('strategy:journal-read', { eventIds }); } catch (_) { /* journal state already committed */ }
    },
    clearJournal() {
        this.state.events = []; this.state.nextEventId = 1; this._observedWars = null;
        this.announceJournalRestore();
    },
    entryRetryReason(event) {
        const army = this.state.army;
        if (event?.kind !== 'base_entry' || event.phase !== 'failed') return '此记录无需重试。';
        if (!this.inMap || this._busy || window.SceneManager?.isLoading) return '请先结束战斗或场景加载。';
        if (event.armyId !== army?.id || army.cellId !== event.cellId || army.march) return '军团已变化或离开此格，请重新选择基地。';
        if (event.sceneId === 'main') return !army.defeated && this.baseEntry(army.originSceneId)?.worldEpoch === army.originEpoch
            ? '出发基地已可用，请使用返回出发基地。' : '';
        if (army.defeated) return '亲征已失败，请撤回主神空间。';
        const target = this.baseEntry(event.sceneId);
        if (!target || target.worldEpoch !== event.worldEpoch || target.cellId !== event.cellId) return '基地已失效或重建，请重新选择基地。';
        return this.baseEntryBlockReason(target);
    },
    async retryEntryEvent(id) {
        const event = this.state.events.find((item) => item.id === id);
        const reason = this.entryRetryReason(event);
        if (reason) return { ok: false, reason };
        const result = event.sceneId === 'main' ? { ok: await this.returnHome() } : this.orderBaseEntry(event.sceneId);
        if (result.ok) this.updateEvent(id, { phase: 'reissued', resolved: true, detail: '已重新下达返回命令，最终结果见后续接收记录。' });
        return result.ok ? result : { ok: false, reason: result.reason || '接收仍未完成，请查看最新记录。' };
    },
    restoreJournal() {
        this.state.events = (Array.isArray(this.state.events) ? this.state.events : [])
            .filter((event) => event && Number.isSafeInteger(event.id) && event.id > 0 && kinds.has(event.kind))
            .slice(-STRATEGY_EVENT_LIMIT).map((event) => ({ ...event,
                title: String(event.title || '').slice(0, 160), detail: String(event.detail || '').slice(0, 1200),
                at: Math.max(0, Number(event.at) || 0), createdAt: Math.max(0, Number(event.createdAt) || 0), read: event.read === true,
                revision: ['engineering_report', 'expedition_report'].includes(event.kind)
                    ? Math.max(1, Math.floor(Number(event.revision) || 1)) : event.revision,
                report: event.kind === 'engineering_report' ? cleanEngineeringReport(event.report)
                    : event.kind === 'expedition_report' ? cleanExpeditionReport(event.report) : event.report,
                cellId: strategicCell(event.cellId)?.id || null }));
        this.state.nextEventId = Math.max(0, ...this.state.events.map((event) => event.id)) + 1;
        this._observedWars = null;
    },
    observeWarEvents() {
        const current = new Map(this.getWars().map((war) => [war.id, {
            id: war.id, cellId: war.cellId, name: war.name || '基地', source: war.source, sceneId: war.targetWorld || null,
        }]));
        if (this._observedWars) {
            for (const [id, war] of current) if (!this._observedWars.has(id)) {
                this.recordEvent('siege', `${war.name}遭到围攻`, '点击定位战事；查看不会改变当前行军命令。', war);
            }
            for (const [id, war] of this._observedWars) if (!current.has(id)) {
                this.recordEvent('siege_ended', `${war.name}的战事已结束`, '请查看基地当前状态；战事结束不等于守城胜利。', war);
            }
        }
        this._observedWars = current;
    },
};
