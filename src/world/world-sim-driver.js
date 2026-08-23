// ============================================================
// 世界后台模拟驱动器（2026-08-19，多世界并行 M2 阶段一）
//
// 玩家不在世界-122 时，按 1Hz 真实时间 tick 增量推进 122 快照（world122-sim 结算引擎），
// 世界在后台"活着"：面板状态实时可见、失守/胜利/波次事件即时通知；
// 回场时 applyWorld122Snapshot 的结算只补 tick 间隙（秒级），物化状态与后台一致。
//
// 口径：TimerManager 计时（菜单/暂停时冻结，与全局暂停口径一致）；
// 玩家在世界-122 内（前台全真模拟）时停 tick 并刷新锚点。
// ============================================================
import { Game } from '../game.js';
import { TimerManager } from '../utils/timer-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { routeProducedGold, createGoldItem } from './economy-gold-routing.js';
import { WarehouseSystem } from '../ui/warehouse-system.js';
import {
    getWorldSnapshots, isWorldLive, isWorldSnapshotCurrent,
} from './world122-snapshot.js';
import { settleWorld122 } from './world122-sim.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { TroopLineSystem } from './troop-line-system.js';
import { TechnologySystem } from './technology-system.js';
import { applyGlobalUpgradesToKind } from './unit-upgrade-store.js';
import { getUpgradeModulesForUnitKind } from './building-upgrade-projects.js';
import { routeBakeryPlantTributes } from './bakery-tribute-routing.js';
import { routeArmoryEnhancementStones } from './armory-reward-routing.js';

const TICK_MS = 1000;

export const WorldSimDriver = {
    _timer: null,

    /** main.js 启动时调用一次 */
    init() {
        if (this._timer) return;
        this._timer = TimerManager.setInterval(() => this._tick(), TICK_MS);
    },

    _tick() {
        if (!Game || !Game.isRunning) return;
        // 地牢探险仍使用同一世界时钟：后台位面、资源生产与全局科技继续结算。
        const nowGame = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
        const entries = Object.entries(getWorldSnapshots())
            .filter(([sceneId, snapshot]) => isWorldSnapshotCurrent(sceneId, snapshot));
        const liveInstitutes = (Game.ProducerBuildingSystem?.buildings || []).filter((building) =>
            building?.active !== false
            && building?.cfgKey === 'research_institute'
            && Number(building?.data?.hp ?? building?.hp ?? 1) > 0).length;
        const backgroundInstitutes = entries.reduce((total, [sceneId, snapshot]) => {
            if (isWorldLive(sceneId)) return total;
            return total + (snapshot?.structures || []).filter((structure) =>
                structure?.kind === 'producer'
                && structure?.cfgKey === 'research_institute'
                && Number(structure?.hp ?? 1) > 0).length;
        }, 0);
        TechnologySystem.update(TICK_MS, liveInstitutes + backgroundInstitutes);
        const hasLiveWorld = entries.some(([sceneId]) => isWorldLive(sceneId));
        const background = entries.filter(([sceneId, snap]) => snap?.wave && !isWorldLive(sceneId));
        const passiveTarget = hasLiveWorld ? null : background.reduce((best, entry) => {
            if (!best) return entry;
            return (entry[1]?.capturedGameTimeMs || 0) > (best[1]?.capturedGameTimeMs || 0) ? entry : best;
        }, null)?.[0];
        for (const [sceneId, snap] of entries) {
            if (!snap?.wave || isWorldLive(sceneId)) continue;
            const elapsed = Math.max(0, nowGame - (snap.capturedGameTimeMs || nowGame));
            if (elapsed < 500) continue;
            let report;
            TroopLineSystem.syncSnapshotAssignments(sceneId, snap);
            const productionBaseline = TroopLineSystem.captureProductionBaseline(snap);
            try {
                report = settleWorld122(snap, elapsed, {
                    commit: true,
                    skipWaves: true,
                    // 全局被动能源只结算一次：前台世界优先，否则落到最近离开的后台世界。
                    includePassiveEnergy: sceneId === passiveTarget,
                    gameTimeMs: nowGame,
                    grant: (reward) => {
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
                });
            } catch (err) {
                console.error(`[WorldSimDriver] ${sceneId} 后台结算异常:`, err);
                continue;
            }
            for (const completed of report.modulesCompleted || []) {
                const [kind] = String(completed).split(':');
                if (kind) applyGlobalUpgradesToKind(kind, getUpgradeModulesForUnitKind(kind));
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
            this._notify(sceneId, report);
        }
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
            if (report.goldProduced > 0) lines.push([`${sceneId} 银行服务 +${report.goldProduced} 金币`, '#ffd700']);
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
