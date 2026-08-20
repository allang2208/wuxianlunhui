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
import { GoldManager } from '../systems/gold-manager.js';
import {
    getWorldSnapshots, isWorldLive, isWorldSnapshotCurrent,
} from './world122-snapshot.js';
import { settleWorld122 } from './world122-sim.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { TroopLineSystem } from './troop-line-system.js';
import { TechnologySystem } from './technology-system.js';
import { applyGlobalUpgradesToKind } from './unit-upgrade-store.js';
import { getUpgradeModulesForUnitKind } from './building-upgrade-projects.js';

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
                        if (reward.gold && GoldManager && typeof GoldManager.addGold === 'function') {
                            GoldManager.addGold(reward.gold);
                        }
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
            if (report.modulesCompleted?.length > 0) lines.push([`${sceneId} 兵种升级完成 ${report.modulesCompleted.length} 项`, '#8ad0ff']);
        }
        if (!lines.length || !player) return;
        lines.forEach(([text, color], i) => {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 70 - i * 24, text, color));
        });
    },
};
