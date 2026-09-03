// ============================================================
// 世界后台模拟驱动器（2026-08-24，多世界并行 M3）
//
// 1Hz 只汇总科研贡献并检查事件期限；后台位面自身按事件、读取、保存或入场边界
// 调用 world122-sim 一次性推进，不再每秒扫描所有建筑。入侵由独立阶段窗口批量结算。
//
// 口径：TimerManager 计时（菜单/暂停时冻结，与全局暂停口径一致）；
// 玩家在世界-122 内（前台全真模拟）时停 tick 并刷新锚点。
// ============================================================
import { Game } from '../game.js';
import { TimerManager } from '../utils/timer-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import {
    createGoldItem,
    getPlayerTotalGold,
    routeProducedGold,
} from './economy-gold-routing.js';
import { WarehouseSystem } from '../ui/warehouse-system.js';
import {
    getWorldSnapshots, isWorldLive, isWorldSnapshotCurrent,
} from './world122-snapshot.js';
import { getWorld122ResearchSummary, settleWorld122 } from './world122-sim.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { TroopLineSystem } from './troop-line-system.js';
import { TechnologySystem } from './technology-system.js';
import { routeBakeryPlantTributes } from './bakery-tribute-routing.js';
import { routeArmoryEnhancementStones } from './armory-reward-routing.js';
import { PopulationEconomySystem } from './population-economy-system.js';
import { WorldInstanceSystem } from './world-instance-system.js';
import {
    ensureWorldBackgroundLedger,
    invalidateWorldBackgroundLedger,
    isWorldBackgroundLedgerDue,
    refreshWorldBackgroundLedger,
} from './world-background-ledger.js';

const TICK_MS = 1000;

export const WorldSimDriver = {
    _timer: null,

    /** main.js 启动时调用一次 */
    init() {
        if (this._timer) return;
        this._timer = TimerManager.setInterval(() => this._tick(), TICK_MS);
    },

    _entries() {
        return Object.entries(getWorldSnapshots())
            .filter(([sceneId, snapshot]) => isWorldSnapshotCurrent(sceneId, snapshot));
    },

    _backgroundEntries(entries = this._entries()) {
        return entries.filter(([sceneId, snap]) => snap?.wave && !isWorldLive(sceneId));
    },

    _passiveTarget(entries) {
        const hasLiveWorld = entries.some(([sceneId]) => isWorldLive(sceneId));
        if (hasLiveWorld) return null;
        return this._backgroundEntries(entries).reduce((best, entry) => {
            if (!best) return entry;
            return (entry[1]?.capturedGameTimeMs || 0) > (best[1]?.capturedGameTimeMs || 0)
                ? entry : best;
        }, null)?.[0] || null;
    },

    _ensureLedger(snapshot, nowGame, reason = 'ensure') {
        const ledger = ensureWorldBackgroundLedger(
            snapshot,
            nowGame,
            (snap) => getWorld122ResearchSummary(snap)
        );
        if (ledger && reason !== 'ensure' && ledger.lastReason !== reason) ledger.lastReason = reason;
        return ledger;
    },

    _tick() {
        if (!Game || !Game.isRunning) return;
        // 地牢探险仍使用同一世界时钟：后台位面、资源生产与全局科技继续结算。
        const nowGame = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
        const entries = this._entries();
        const background = this._backgroundEntries(entries);
        for (const [, snapshot] of background) this._ensureLedger(snapshot, nowGame);

        const liveResearch = PopulationEconomySystem.getLiveResearchSummary();
        let backgroundResearch = background.reduce((total, [, snapshot]) => {
            const summary = snapshot.backgroundLedger?.research || { count: 0, rate: 0 };
            return {
                count: total.count + Math.max(0, Number(summary.count) || 0),
                rate: total.rate + Math.max(0, Number(summary.rate) || 0),
            };
        }, { count: 0, rate: 0 });
        const rawResearchRate = liveResearch.rate + backgroundResearch.rate;
        const effectiveResearchRate = TechnologySystem.getEffectiveResearchRate(rawResearchRate);
        const secondsToResearchBoundary = TechnologySystem.getEstimatedSeconds?.(
            null,
            effectiveResearchRate
        );
        const researchMode = TechnologySystem.getResearchMode?.() || 'idle';
        // 全局科技若将在本次 1Hz 窗口完成，先把所有后台账本结算到旧科技状态的末端，
        // 避免长时间休眠后把新能力错误回溯到整段离线时间。
        if (researchMode !== 'idle'
            && Number.isFinite(secondsToResearchBoundary)
            && secondsToResearchBoundary * 1000 <= TICK_MS) {
            this.flushAll({ nowGame, notify: false, reason: 'research-boundary' });
            for (const [, snapshot] of background) this._ensureLedger(snapshot, nowGame);
            backgroundResearch = background.reduce((total, [, snapshot]) => {
                const summary = snapshot.backgroundLedger?.research || { count: 0, rate: 0 };
                return {
                    count: total.count + Math.max(0, Number(summary.count) || 0),
                    rate: total.rate + Math.max(0, Number(summary.rate) || 0),
                };
            }, { count: 0, rate: 0 });
        }
        const finalRawResearchRate = liveResearch.rate + backgroundResearch.rate;
        const finalEffectiveResearchRate = TechnologySystem.getEffectiveResearchRate(
            finalRawResearchRate
        );
        const completedTechnology = TechnologySystem.update(
            TICK_MS,
            liveResearch.count + backgroundResearch.count,
            finalEffectiveResearchRate,
            finalRawResearchRate
        );
        if (completedTechnology) this.invalidateAll('technology-completed');

        const passiveTarget = this._passiveTarget(entries);
        for (const [sceneId, snap] of background) {
            if (!isWorldBackgroundLedgerDue(snap, nowGame)) continue;
            this._settleEntry(sceneId, snap, nowGame, {
                notify: true,
                reason: 'scheduled-event',
                passiveTarget,
            });
        }
    },

    _grantReward(reward) {
        if (reward.gold) return routeProducedGold(reward.gold);
        if (reward.tributeItemIds?.length) {
            const routed = routeBakeryPlantTributes(reward.tributeItemIds);
            return { acceptedTributes: routed.accepted };
        }
        if (reward.enhancementStones > 0) {
            const routed = routeArmoryEnhancementStones(reward.enhancementStones);
            return { acceptedEnhancementStones: routed.accepted };
        }
        return { remaining: 0 };
    },

    _settleEntry(sceneId, snap, nowGame, {
        notify = false,
        reason = 'manual',
        passiveTarget = null,
    } = {}) {
        if (!snap?.wave || isWorldLive(sceneId) || !isWorldSnapshotCurrent(sceneId, snap)) return null;
        // 0 是新档合法的世界时间锚点，不能用 || 回退，否则第一次离场时段会被吞掉。
        const capturedGameTimeMs = Number(snap.capturedGameTimeMs);
        const elapsed = Math.max(0, nowGame - (
            Number.isFinite(capturedGameTimeMs) ? capturedGameTimeMs : nowGame
        ));
        if (elapsed < 1) {
            refreshWorldBackgroundLedger(
                snap, nowGame, getWorld122ResearchSummary(snap), reason
            );
            return null;
        }

        let report;
        TroopLineSystem.syncSnapshotAssignments(sceneId, snap);
        const productionBaseline = TroopLineSystem.captureProductionBaseline(snap);
        try {
            report = settleWorld122(snap, elapsed, {
                commit: true,
                skipWaves: true,
                sceneId,
                runtimeSceneId: WorldInstanceSystem.resolveRuntimeSceneId(sceneId),
                includePassiveEnergy: sceneId === passiveTarget,
                gameTimeMs: nowGame,
                isRecruitmentTierUnlocked: (id) =>
                    TechnologySystem.isUnlocked('recruitmentTier', id),
                isUnitUnlocked: (id) => TechnologySystem.isUnlocked('unit', id),
                getPlayerTotalGold: () => getPlayerTotalGold(),
                grant: (reward) => this._grantReward(reward),
            });
        } catch (err) {
            console.error(`[WorldSimDriver] ${sceneId} 后台结算异常:`, err);
            invalidateWorldBackgroundLedger(snap, 'settlement-error');
            return null;
        }
        for (const reward of report.explorerRewards || []) {
            const structure = (snap.structures || []).find((entry) =>
                entry.id === reward.structureId || (entry.x === reward.x && entry.y === reward.y));
            const pending = structure ? (structure.pendingExplorerDrops ||= []) : null;
            for (const rewardItem of reward.items || []) {
                const item = JSON.parse(JSON.stringify(rewardItem));
                const count = Math.max(0, Math.floor(Number(item.stack) || 0));
                if (count <= 0) continue;
                const accepted = WarehouseSystem.depositItemAmount(item);
                if (pending && accepted < count) pending.push({ ...item, stack: count - accepted });
            }
            const gold = Math.max(0, Math.floor(Number(reward.gold) || 0));
            const routed = gold > 0 ? routeProducedGold(gold) : { remaining: 0 };
            if (pending && routed.remaining > 0) pending.push(createGoldItem(routed.remaining));
        }
        TroopLineSystem.onBackgroundProduction(sceneId, snap, productionBaseline);
        refreshWorldBackgroundLedger(snap, nowGame, getWorld122ResearchSummary(snap), reason);
        if (notify) this._notify(sceneId, report);
        return report;
    },

    flushWorld(sceneId, { nowGame = null, notify = false, reason = 'read' } = {}) {
        const snap = getWorldSnapshots()[sceneId];
        if (!snap || !isWorldSnapshotCurrent(sceneId, snap) || isWorldLive(sceneId)) return null;
        const now = Number.isFinite(nowGame)
            ? nowGame : (EnvironmentLightingSystem.serializeTime().elapsedMs || 0);
        return this._settleEntry(sceneId, snap, now, {
            notify,
            reason,
            passiveTarget: this._passiveTarget(this._entries()),
        });
    },

    flushAll({ nowGame = null, notify = false, reason = 'flush-all' } = {}) {
        const now = Number.isFinite(nowGame)
            ? nowGame : (EnvironmentLightingSystem.serializeTime().elapsedMs || 0);
        const entries = this._entries();
        const passiveTarget = this._passiveTarget(entries);
        const reports = {};
        for (const [sceneId, snap] of this._backgroundEntries(entries)) {
            const report = this._settleEntry(sceneId, snap, now, {
                notify,
                reason,
                passiveTarget,
            });
            if (report) reports[sceneId] = report;
        }
        return reports;
    },

    invalidateAll(reason = 'external-change') {
        for (const [sceneId, snapshot] of this._backgroundEntries()) {
            invalidateWorldBackgroundLedger(snapshot, `${reason}:${sceneId}`);
        }
    },

    getDebugModel() {
        const nowGame = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
        return this._backgroundEntries().map(([sceneId, snapshot]) => {
            const ledger = this._ensureLedger(snapshot, nowGame);
            return {
                sceneId,
                worldEpoch: snapshot.worldEpoch,
                settledAtGameTimeMs: snapshot.capturedGameTimeMs || 0,
                nextWakeAtGameTimeMs: ledger?.nextWakeAtGameTimeMs ?? null,
                sleeping: !isWorldBackgroundLedgerDue(snapshot, nowGame),
                structureCount: ledger?.structureCount || 0,
                unitCount: ledger?.unitCount || 0,
                settlementCount: ledger?.settlementCount || 0,
            };
        });
    },

    /** 后台事件通知（浮字，任意场景可见） */
    _notify(sceneId, report) {
        if (!report) return;
        const player = Game.player;
        const lines = [];
        if (report.defeated) {
            lines.push([`⚠ ${sceneId} 后台结算异常失守`, '#ff5555']);
        } else {
            if (report.unitsProduced > 0) lines.push([`${sceneId} 新兵 +${report.unitsProduced}`, '#8ad0ff']);
            if (report.energyMined > 0) lines.push([`${sceneId} 采集 +${Math.round(report.energyMined)} 能源`, '#7fd4ff']);
            if (report.deepDrillEnergyMined > 0) {
                lines.push([`${sceneId} 深钻采掘 +${Math.round(report.deepDrillEnergyMined)} 能源`, '#72d8d0']);
            }
            if (report.resonatorEnergyProduced > 0) {
                lines.push([`${sceneId} 位面谐振 +${report.resonatorEnergyProduced} 能源`, '#a892ff']);
            }
            if (report.steamEnergyProduced > 0) {
                lines.push([`${sceneId} 蒸汽发电 +${report.steamEnergyProduced} 能源`, '#e6a45f']);
            }
            if (report.goldProduced > 0) lines.push([`${sceneId} 经济建筑金币 +${report.goldProduced} 金币`, '#ffd700']);
            if (report.foodProduced > 0) lines.push([`${sceneId} 风车 +${report.foodProduced} 粮食`, '#d9b84f']);
            if (report.enhancementStonesProduced > 0) {
                lines.push([`${sceneId} 军械整理 +${report.enhancementStonesProduced} 强化石`, '#d8ad62']);
            }
            const explorerCount = (report.explorerRewards || []).length;
            if (explorerCount > 0) lines.push([`${sceneId} 探险完成 ${explorerCount} 次`, '#c9a0ff']);
            if (report.modulesCompleted?.length > 0) lines.push([`${sceneId} 兵种升级完成 ${report.modulesCompleted.length} 项`, '#8ad0ff']);
        }
        if (!lines.length || !player) return;
        lines.forEach(([text, color], i) => {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 70 - i * 24, text, color));
        });
    },
};
