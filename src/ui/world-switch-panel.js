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
import { getWorld122Snapshot, previewWorld122Report } from '../world/world122-snapshot.js';

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
            this._panel = new BasePanel({ id: 'worldSwitchPanel', className: 'world-switch-panel', stateKey: 'worldSwitch' });
            this._panel.buildContent = (el) => this._buildContent(el);
            this._panel.onOpen = () => { this._render(); this._onOpenRefresh(); };
            this._panel.onClose = () => this._clearRefresh();
        }
        return this._panel;
    },

    /** 主入口初始化（main.js）：注入侧边菜单按钮 */
    init() {
        const menu = document.querySelector('.side-menu');
        if (!menu || document.getElementById('worldSwitchBtn')) return;
        const btn = document.createElement('div');
        btn.className = 'side-menu-btn';
        btn.id = 'worldSwitchBtn';
        btn.title = '世界传送（随时切换世界查看）';
        btn.innerHTML = '<span class="side-menu-emoji">🌐</span><span class="panel-label">世界传送</span>';
        btn.onclick = () => this.toggle();
        menu.appendChild(btn);
    },

    toggle() { this._getPanel().toggle(); },
    open() { this._getPanel().open(); },
    close() { this._getPanel().close(); },
    get isOpen() { return this._getPanel().isOpen; },

    /** 前往世界（2026-08-19 口径：仅相机跳转，玩家不瞬移）：
     *  目标 ≠ 本体所在世界 → 观察模式（该世界不生成玩家）+ 自动进入指挥模式；
     *  目标 = 本体所在世界 → 返回本体（正常生成玩家 + 世界坐标记忆原位恢复）。 */
    async _travel(target) {
        if (!target || target === SceneManager.currentScene) return;
        this.close();
        const home = Game._observerMode ? Game._observerHomeScene : SceneManager.currentScene;
        const observer = target !== home;
        await SceneManager.switchScene(target, Game.player, undefined, { observer });
        // 切完自动进/出指挥模式（观察世界用 RTS 操作查看/指挥）
        RTSCommand.setEnabled(observer);
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

    /** 打开期间 1.2s 自动刷新（后台驱动 tick 推进快照，面板实时反映） */
    _onOpenRefresh() {
        this._clearRefresh();
        this._refreshTimer = setInterval(() => { if (this._panel?.isOpen) this._render(); }, 1200);
    },
    _clearRefresh() {
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    },

    _worldName(id) {
        return SceneManager.scenes?.[id]?.name || id;
    },

    /** 世界-122 行状态文案（当前/快照实况/离线预估） */
    _world122Status(current) {
        if (current) return '<span class="ws-current">当前所在</span>';
        const snap = getWorld122Snapshot();
        if (!snap) return '<span class="ws-dim">尚未建设（首次进入从零开始）</span>';
        const structures = snap.structures || [];
        const buildings = structures.length;
        const lost = structures.filter((s) => !(s.hp > 0)).length;
        const energy = structures.reduce((sum, s) => sum + (s.storedEnergy || 0), 0);
        const wave = snap.wave || {};
        const waveText = wave.victory ? '已防守胜利'
            : (wave.wave > 0 ? `第 ${wave.wave} 波${wave.phase === 'wave' ? '·交战中' : '·休整'}` : '备战期');
        let html = `<span>战况 ${waveText} · 建筑 ${buildings} 座${lost ? `（损 ${lost}）` : ''} · 仓库能源 ${Math.round(energy)}</span>`;
        const preview = previewWorld122Report();
        if (preview) {
            const parts = [];
            if (preview.defeated) parts.push('<b style="color:#ff5555">⚠ 预估已失守</b>');
            if (preview.wavesCleared.length) parts.push(`预估击退至第 ${Math.max(...preview.wavesCleared)} 波`);
            if (preview.victory) parts.push('预估防守胜利');
            if (preview.energyMined > 0) parts.push(`离线采矿 +${Math.round(preview.energyMined)}`);
            if (preview.unitsProduced > 0) parts.push(`新兵 +${preview.unitsProduced}`);
            if (preview.abilitiesCompleted.length) parts.push(`研究完成 ${preview.abilitiesCompleted.length} 项`);
            if (preview.structuresLost > 0) parts.push(`<span style="color:#ff8855">预估损失建筑 ${preview.structuresLost}</span>`);
            if (parts.length) html += `<div class="ws-preview">⏱ ${parts.join('；')}</div>`;
        }
        return html;
    },

    _render() {
        const el = this._panel && this._panel.el;
        if (!el) return;
        const list = el.querySelector('#wsList');
        const current = SceneManager.currentScene;
        const home = Game._observerMode ? Game._observerHomeScene : current;
        list.innerHTML = WORLDS.map((w) => {
            const isCurrent = current === w.id;
            const isHome = Game._observerMode && home === w.id && !isCurrent;
            const status = w.id === 'scene8'
                ? this._world122Status(isCurrent)
                : (isCurrent ? '<span class="ws-current">当前所在</span>' : `<span class="ws-dim">${w.desc}</span>`);
            const head = isCurrent
                ? ''
                : (isHome
                    ? `<button class="ws-go home" data-world="${w.id}">⟲ 返回本体</button>`
                    : `<button class="ws-go" data-world="${w.id}">前往 →</button>`);
            return `
                <div class="ws-row${isCurrent ? ' current' : ''}">
                    <div class="ws-row-head">
                        <span class="ws-icon">${w.icon}</span>
                        <span class="ws-name">${this._worldName(w.id)}</span>
                        ${isHome ? '<span class="ws-home-badge">本体所在</span>' : ''}
                        ${head}
                    </div>
                    <div class="ws-status">${status}</div>
                </div>`;
        }).join('');
        list.querySelectorAll('.ws-go').forEach((btn) => {
            btn.onclick = async () => {
                const target = btn.dataset.world;
                this.close();
                await this._travel(target);
            };
        });
    },
};
