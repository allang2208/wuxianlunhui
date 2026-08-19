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
    getWorld122Snapshot, resetWorld122Snapshot, isWorld122Live,
} from './world122-snapshot.js';
import { settleWorld122 } from './world122-sim.js';

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
        if (isWorld122Live()) return; // 前台全真，不重复结算（离场捕获会重置 capturedAt 锚点）
        const snap = getWorld122Snapshot();
        if (!snap || !snap.wave) return;
        // 锚点 = 快照 capturedAt（settle 提交时推进到 now）：
        // 读档离线数小时/探针回拨等场景都能完整结算，不依赖驱动器自身时钟
        const elapsed = Date.now() - (snap.capturedAt || Date.now());
        if (elapsed < 500) return; // 结算最小粒度
        let report;
        try {
            report = settleWorld122(snap, elapsed, {
                commit: true,
                grant: (reward) => {
                    if (reward.gold && GoldManager && typeof GoldManager.addGold === 'function') {
                        GoldManager.addGold(reward.gold);
                    }
                },
            });
        } catch (err) {
            console.error('[WorldSimDriver] 后台结算异常:', err);
            return;
        }
        this._notify(report);
    },

    /** 后台事件通知（浮字，任意场景可见） */
    _notify(report) {
        if (!report) return;
        const player = Game.player;
        const lines = [];
        if (report.defeated) {
            lines.push(['⚠ 世界-122 失守！基地被摧毁，防守将重新开局', '#ff5555']);
        } else {
            for (const w of report.wavesCleared || []) {
                lines.push([`世界-122 击退第 ${w} 波`, '#8ad0ff']);
            }
            if (report.victory) lines.push(['🏆 世界-122 防守胜利！奖励已发放', '#ffd700']);
            if (report.structuresLost > 0) lines.push([`世界-122 离线损失建筑 ${report.structuresLost} 座`, '#ff8855']);
        }
        if (!lines.length || !player) return;
        lines.forEach(([text, color], i) => {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 70 - i * 24, text, color));
        });
        if (report.defeated) resetWorld122Snapshot(); // 失守快照作废（与回场结算同口径）
    },
};
