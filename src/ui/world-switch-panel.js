// ============================================================
// 世界切换面板（2026-08-18，多世界并行 M1 配套）
// - 侧边菜单注入「🌐 世界」按钮，随时打开；列出各世界与状态，一键传送。
// - 世界-122 行显示快照概况 + 离线预估战报（previewWorld122Report，纯预览无副作用）。
// - 传送 = SceneManager.switchScene（离场捕获/入场恢复由快照系统自动完成）。
// ============================================================
import { BasePanel } from './panels/base-panel.js';
import { SceneManager } from '../world/scene-manager.js';
import { Game } from '../game.js';
import { RTSCommand } from './rts-command.js';
import { getWorldSnapshot, previewWorld122Report } from '../world/world122-snapshot.js';
import { WorldProgressionSystem } from '../world/world-progression-system.js';
import { mountRightSidebarPanel } from './right-sidebar-panel-layer.js';
import { EventBus } from '../core/event-bus.js';

const WORLDS = [
    { id: 'main', icon: '🏛️', desc: '轮回者营地' },
    { id: 'scene8', icon: '🏜️', desc: '基地防守 · 能源采集' },
    { id: 'scene9', icon: '❄️', desc: '雪原（观景）' },
    { id: 'scene10', icon: '🌲', desc: '林地（观景）' },
    { id: 'scene11', icon: '🕯️', desc: '地牢遗迹（观景）' },
];

export const WorldSwitchPanel = {
    _panel: null,

    _getPanel() {
        if (!this._panel) {
            this._panel = new BasePanel({
                id: 'worldSwitchPanel',
                className: 'world-switch-panel',
                stateKey: 'worldSwitch',
                panelGroup: 'rightSidebar',
                closeOnEscape: true,
                closeOnOutsidePointer: true,
            });
            this._panel.buildContent = (el) => this._buildContent(el);
            this._panel.onOpen = () => {
                mountRightSidebarPanel(this._panel.el, 'panel');
                EventBus.emit('ui:panel-open', { panel: 'worldSwitch' });
                this._setPanelChrome(true);
                // 打开面板时才把连续经济结算到“现在”；之后仅重绘到期事件推送后的快照。
                window.WorldSimDriver?.flushAll?.({ notify: false, reason: 'world-panel-open' });
                window.WorldInvasionSystem?.settleBackgroundNow?.();
                this._render();
                this._onOpenRefresh();
            };
            this._panel.onClose = () => {
                this._clearRefresh();
                this._setPanelChrome(false);
            };
        }
        return this._panel;
    },

    _hasOtherActiveRightPanel() {
        const layer = document.getElementById('rightSidebarPanelLayer');
        if (!layer) return false;
        return Array.from(layer.querySelectorAll('.right-sidebar-layer-item--panel')).some((item) => {
            if (item === this._panel?.el) return false;
            if (item.matches('.system-panel.active, .quest-panel.active, .world-switch-panel.active')) return true;
            return !!item.querySelector('.system-panel.active, .quest-panel.active, .world-switch-panel.active');
        });
    },

    _setPanelChrome(open) {
        const overlay = document.getElementById('panelOverlay');
        if (open) {
            overlay?.classList.add('active');
            document.querySelectorAll('.side-menu').forEach((menu) => menu.classList.add('hidden'));
            return;
        }
        if (this._hasOtherActiveRightPanel()) return;
        overlay?.classList.remove('active');
        document.querySelectorAll('.side-menu').forEach((menu) => menu.classList.remove('hidden'));
    },

    /** 侧边菜单按钮已由 hud-panels-misc.js 静态构建（2026-08-19 侧栏改版，
     *  图标 assets/ui/icons/world_switch.png + O 快捷键徽标），本模块不再注入。 */

    toggle() { this._getPanel().toggle(); },
    open() { this._getPanel().open(); },
    close() { this._getPanel().close(); },
    get isOpen() { return this._getPanel().isOpen; },

    /** 前往世界（2026-08-19 口径：仅相机跳转，玩家不瞬移）：
     *  目标 ≠ 本体所在世界 → 观察模式（该世界不生成玩家）+ 自动进入指挥模式；
     *  目标 = 本体所在世界 → 返回本体（正常生成玩家 + 世界坐标记忆原位恢复）。 */
    async _travel(target) {
        if (!target || target === SceneManager.currentScene) return true;
        if (!SceneManager.scenes?.[target]) {
            SceneManager.showTopNotification('目标世界不存在，无法切换', { color: '#ff7766' });
            return false;
        }
        if (WorldProgressionSystem.getWorldConfig(target)
            && !WorldProgressionSystem.isPortalConstructed(target)) {
            SceneManager.showTopNotification('该世界位面尚未搭建传送门', { color: '#ff7766' });
            return false;
        }
        if (SceneManager.isLoading) {
            SceneManager.showTopNotification('世界正在切换，请稍候', { color: '#d8a26a' });
            return false;
        }
        this.close();
        const home = Game._observerMode ? Game._observerHomeScene : SceneManager.currentScene;
        const observer = target !== home;
        try {
            const switched = await SceneManager.switchScene(target, Game.player, undefined, { observer });
            if (!switched || SceneManager.currentScene !== target) {
                SceneManager.showTopNotification('世界切换未完成，请重试', { color: '#ff7766' });
                return false;
            }
            // 只有真实切场成功后才同步指挥模式；失败回滚时保持原状态。
            RTSCommand.setEnabled(!!Game._observerMode);
            return true;
        } catch (_err) {
            SceneManager.showTopNotification('世界加载失败，已返回原世界', { color: '#ff7766' });
            return false;
        }
    },

    /** 入侵支援是明确的本体转移，不沿用世界面板的观察模式。 */
    async supportActiveInvasion() {
        if (SceneManager.isDungeonRunActive()) {
            SceneManager.showDungeonIsolationNotice();
            return false;
        }
        const active = window.WorldInvasionSystem?.getState?.().active;
        const target = active?.targetWorld;
        if (!target || target === SceneManager.currentScene) return false;
        if (!WorldProgressionSystem.isPortalConstructed(target)) return false;
        if (SceneManager.isLoading) return false;
        this.close();
        try {
            const switched = await SceneManager.switchScene(target, Game.player, undefined, { observer: false });
            if (!switched || SceneManager.currentScene !== target) return false;
            RTSCommand.setEnabled(false);
            return true;
        } catch (_err) {
            SceneManager.showTopNotification('支援世界加载失败，已返回原世界', { color: '#ff7766' });
            return false;
        }
    },

    _buildContent(el) {
        el.innerHTML = `
            <div class="ws-header">
                <span class="ws-title">🌐 世界传送</span>
                <button class="ws-close" id="wsClose">✕</button>
            </div>
            <div class="ws-list" id="wsList"></div>`;
        el.querySelector('#wsClose').onclick = () => this.close();
    },

    /** 打开期间 1.2s 只刷新显示；后台账本没有到期事件时不会为面板反复扫描位面。 */
    _onOpenRefresh() {
        this._clearRefresh();
        this._refreshTimer = setInterval(() => { if (this._panel?.isOpen) this._render(); }, 1200);
    },
    _clearRefresh() {
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    },

    _worldName(id) {
        if (id === 'scene7' && window.DungeonMapSystem?.active) {
            return window.DungeonMapSystem.dungeonName || SceneManager.scenes?.scene7?.name || id;
        }
        return SceneManager.scenes?.[id]?.name || id;
    },

    /** 常驻世界状态文案（当前/快照实况/传送门状态）。 */
    _worldStatus(sceneId, current) {
        if (current) return '<span class="ws-current">当前所在</span>';
        const portal = WorldProgressionSystem.getPortalState(sceneId);
        if (portal.destroyed) return '<b style="color:#ff5555">传送门已摧毁，等待重建</b>';
        const protection = WorldProgressionSystem.getPortalProtection(sceneId);
        const protectionText = protection.active
            ? `<b style="color:#7fe0c8">新生保护 ${protection.remainingDays.toFixed(1)} 天</b> · `
            : '';
        const snap = getWorldSnapshot(sceneId);
        if (!snap) return '<span class="ws-dim">尚未建设（首次进入从零开始）</span>';
        const structures = snap.structures || [];
        const buildings = structures.length;
        const lost = structures.filter((s) => !(s.hp > 0)).length;
        const energy = structures.reduce((sum, s) => sum + (s.storedEnergy || 0), 0);
        const invasion = window.WorldInvasionSystem?.getState?.().active;
        const invasionText = invasion?.targetWorld === sceneId
            ? `<b style="color:#ff775f">入侵第 ${invasion.waveIndex}/${invasion.waveCount} 波</b> · `
            : '';
        let html = `<span>${protectionText}${invasionText}建筑 ${buildings} 座${lost ? `（损 ${lost}）` : ''} · 仓库能源 ${Math.round(energy)}</span>`;
        const preview = sceneId === 'scene8' ? previewWorld122Report() : null;
        if (preview) {
            const parts = [];
            if (preview.defeated) parts.push('<b style="color:#ff5555">⚠ 预估已失守</b>');
            if (preview.wavesCleared.length) parts.push(`预估击退至第 ${Math.max(...preview.wavesCleared)} 波`);
            if (preview.victory) parts.push('预估防守胜利');
            if (preview.energyMined > 0) parts.push(`离线采矿 +${Math.round(preview.energyMined)}`);
            if (preview.resonatorEnergyProduced > 0) {
                parts.push(`位面谐振 +${preview.resonatorEnergyProduced}`);
            }
            if (preview.titheEnergy > 0) parts.push(`什一税 +${preview.titheEnergy}`);
            if (preview.unitsProduced > 0) parts.push(`新兵 +${preview.unitsProduced}`);
            if (preview.abilitiesCompleted.length) parts.push(`研究完成 ${preview.abilitiesCompleted.length} 项`);
            if (preview.modulesCompleted?.length) parts.push(`兵种升级完成 ${preview.modulesCompleted.length} 项`);
            if (preview.structuresLost > 0) parts.push(`<span style="color:#ff8855">预估损失建筑 ${preview.structuresLost}</span>`);
            if (parts.length) html += `<div class="ws-preview">⏱ ${parts.join('；')}</div>`;
        }
        return html;
    },

    _emergencyRebuild(sceneId) {
        const result = WorldProgressionSystem.constructPortal(sceneId);
        if (!result.ok) {
            SceneManager.showTopNotification(result.reason || '传送门重建失败', { color: '#ff5555' });
            this._render();
            return;
        }
        Game.syncMainHubWorldPortals?.();
        const world = WorldProgressionSystem.getWorldConfig(sceneId);
        SceneManager.showTopNotification(`${world?.name || sceneId}传送门重建完成`, { color: '#b8a8ff' });
        this._render();
    },

    _render() {
        const el = this._panel && this._panel.el;
        if (!el) return;
        const list = el.querySelector('#wsList');
        const current = SceneManager.currentScene;
        const home = Game._observerMode ? Game._observerHomeScene : current;
        const candidates = SceneManager.isDungeonRunActive()
            ? [{ id: 'scene7', icon: '🗺️', desc: '当前地牢探险' }, ...WORLDS]
            : WORLDS;
        const visibleWorlds = candidates.filter((w) => w.id === 'scene7' || w.id === 'main'
            || w.id === current
            || WorldProgressionSystem.isPortalConstructed(w.id));
        const worldRows = visibleWorlds.map((w) => {
            const isCurrent = current === w.id;
            const isHome = Game._observerMode && home === w.id && !isCurrent;
            const status = w.id === 'scene7'
                ? (isCurrent
                    ? '<span class="ws-current">探险进行中</span>'
                    : '<span class="ws-dim">地牢现场已保留，可随时返回</span>')
                : w.id === 'main'
                ? (isCurrent ? '<span class="ws-current">当前所在</span>' : `<span class="ws-dim">${w.desc}</span>`)
                : this._worldStatus(w.id, isCurrent);
            const head = isCurrent
                ? ''
                : (isHome
                    ? `<button class="ws-go home" data-world="${w.id}">⟲ 返回本体</button>`
                    : `<button class="ws-go" data-world="${w.id}">前往 →</button>`);
            const invasionTarget = window.WorldInvasionSystem?.getState?.().active?.targetWorld === w.id;
            const support = !SceneManager.isDungeonRunActive() && !isCurrent && invasionTarget
                ? `<button class="ws-support" data-support-world="${w.id}" style="margin-left:6px;background:#7a3028;color:#ffe5df;border:1px solid #d85d50;border-radius:5px;padding:5px 8px;cursor:pointer;">⚔ 本体支援</button>`
                : '';
            return `
                <div class="ws-row${isCurrent ? ' current' : ''}">
                    <div class="ws-row-head">
                        <span class="ws-icon">${w.icon}</span>
                        <span class="ws-name">${this._worldName(w.id)}</span>
                        ${isHome ? '<span class="ws-home-badge">本体所在</span>' : ''}
                        ${head}${support}
                    </div>
                    <div class="ws-status">${status}</div>
                </div>`;
        }).join('');
        // 所有已建传送门都被毁时，正常的“在传送门建筑中重建”会形成死锁。
        // 主城只提供旧传送门的应急重建，不开放任何世界的首次构造资格。
        const emergencyRebuilds = current === 'main' && WorldProgressionSystem.getTravelWorlds().length === 0
            ? WorldProgressionSystem.getConstructableWorlds().filter((entry) => entry.rebuild)
            : [];
        const emergencyHtml = emergencyRebuilds.length ? `
            <div class="ws-row" style="border-color:#7a5838;background:rgba(78,48,28,0.72);">
                <div class="ws-row-head"><span class="ws-icon">🛠️</span><span class="ws-name">传送网络应急重建</span></div>
                <div class="ws-status"><span style="color:#d6b98a;">所有已搭建位面均已断线，只能在主城重建曾经搭建过的传送门。</span></div>
                ${emergencyRebuilds.map((entry) => `
                    <button class="ws-rebuild" data-rebuild-world="${entry.sceneId}" style="width:100%;margin-top:7px;background:#4b3828;color:#ffe2b8;border:1px solid #94704d;border-radius:6px;padding:8px;cursor:pointer;text-align:left;">
                        <b>${entry.icon || '🌀'} ${entry.name || entry.sceneId}</b>
                        <span style="display:block;font-size:11px;margin-top:2px;">${entry.cost.gold || 0} 金币 + ${entry.cost.energy || 0} 能源</span>
                    </button>`).join('')}
            </div>` : '';
        list.innerHTML = worldRows + emergencyHtml;
        list.querySelectorAll('.ws-go').forEach((btn) => {
            btn.onclick = async () => {
                const target = btn.dataset.world;
                await this._travel(target);
            };
        });
        list.querySelectorAll('.ws-rebuild').forEach((btn) => {
            btn.onclick = () => this._emergencyRebuild(btn.dataset.rebuildWorld);
        });
        list.querySelectorAll('.ws-support').forEach((btn) => {
            btn.onclick = () => this.supportActiveInvasion();
        });
    },
};
