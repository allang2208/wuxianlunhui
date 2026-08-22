/**
 * 队员指挥轮盘（CompanionCommandWheel，2026-08-14）。
 *
 * - 长按鼠标中键 ≥300ms 弹出轮盘（以鼠标为中心）；松开时选中悬停指令，移出轮盘松开 = 取消；
 * - 通用指令：跟随（默认）/ 移动攻击 / 巡逻 / 采集 / 待命；仅选中探险家时追加探险；
 * - 指令点 = 打开轮盘瞬间的鼠标世界坐标（移动攻击终点 / 巡逻另一端 / 采集就近资源点）；
 * - 目标：组队栏选中的队员（点击=单选、Shift+点击=多选）；无选中时兜底队员面板当前队员 / 第一名；
 * - 挂载：Game 启动时 init()（见 game.js）；DOM overlay，样式随 game-style.css。
 */
import { Game } from '../game.js';
import { PartySystem } from '../systems/party-system.js';
import { UIState } from './ui-state.js';
import { RTSCommand } from './rts-command.js';
import { Camera } from '../world/camera.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';

export const CompanionCommandWheel = {
    LONG_PRESS_MS: 300,

    _el: null,
    _open: false,
    _holding: false,
    _pressTimer: null,
    _worldPoint: null,
    _openAt: null,
    _hovered: null,
    _targetIds: [],
    _targetRefs: [],
    _targetLabel: '',
    _inited: false,

    commands: [
        { id: 'follow', name: '跟随', icon: '🧭', color: '#9dff9d' },
        { id: 'attack_move', name: '移动攻击', icon: '⚔️', color: '#ff9d9d' },
        { id: 'patrol', name: '巡逻', icon: '🚶', color: '#ffd77f' },
        { id: 'gather', name: '采集', icon: '⛏️', color: '#7fd4ff' },
        { id: 'explore', name: '探险', icon: '🗺️', color: '#c9a0ff' },
        { id: 'hold', name: '待命', icon: '🛑', color: '#c5b89a' },
    ],

    init() {
        if (this._inited) return;
        this._inited = true;
        window.addEventListener('mousedown', (e) => this._onDown(e), true);
        window.addEventListener('mouseup', (e) => this._onUp(e), true);
        window.addEventListener('blur', () => this._cancel());
        // 屏蔽中键默认行为（自动滚动/粘贴）
        window.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); }, true);
    },

    /** 世界坐标（与 building-system._clientToWorld 同口径） */
    _clientToWorld(e) {
        const scene = window.__phaserScene;
        if (!scene) return null;
        const canvas = scene.game.canvas;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const p = scene.cameras.main.getWorldPoint(sx, sy);
        return { x: p.x, y: p.y, overCanvas: e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom };
    },

    /** 中键按下是否可触发轮盘（系统 UI / 编辑模式 / 无队员不触发） */
    _canOpen(e) {
        if (e.button !== 1) return false;
        if (!Game || !Game.isRunning || Game._paused) return false;
        if (Game._wallEditMode || Game._collisionEditMode || Game._buildMode) return false;
        // 指挥模式统一（2026-08-19）：指挥模式下选中单位（仓鼠部队/队友）即可下达，不再只限队友
        const rtsActive = !!(RTSCommand && RTSCommand.enabled && RTSCommand.hasAllySelection && RTSCommand.hasAllySelection());
        if (!rtsActive && (!PartySystem || !PartySystem.members.length)) return false;
        // 不再做全局“任一系统面板打开即禁用”：面板状态残留会永久卡死轮盘。
        // 改为按按下时鼠标悬停的目标拦截（下一条 closest 判断），面板开着但不
        // 悬停在面板上时仍可下达指令。
        if (e.target && typeof e.target.closest === 'function'
            && e.target.closest('.system-panel, .panel-overlay, .side-menu, .menu-btn, .back-menu-btn, .wall-editor-panel, .rts-command-bar, .companion-panel-wrap, .companion-overlay')) return false;
        return true;
    },

    _onDown(e) {
        if (!this._canOpen(e)) return;
        e.preventDefault();
        const p = this._clientToWorld(e);
        if (!p || !p.overCanvas) return;
        this._holding = true;
        this._worldPoint = { x: p.x, y: p.y };
        this._openAt = { x: e.clientX, y: e.clientY };
        clearTimeout(this._pressTimer);
        this._pressTimer = setTimeout(() => {
            if (!this._holding) return;
            this._openWheel();
        }, this.LONG_PRESS_MS);
    },

    _onUp(e) {
        if (e.button !== 1 || !this._holding) return;
        this._holding = false;
        clearTimeout(this._pressTimer);
        this._pressTimer = null;
        if (this._open) {
            // 多选已由“Shift+点击组队栏名字”承担；松开时不再覆盖为全队
            if (this._hovered) this._execute(this._hovered);
        }
        this._close();
    },

    _cancel() {
        this._holding = false;
        clearTimeout(this._pressTimer);
        this._pressTimer = null;
        this._close();
    },

    /** 指令目标：组队栏选中队员（多选）；无选中时兜底队员面板当前队员 / 第一名；all=true 为全队 */
    _resolveTargets(all) {
        // 指挥模式：目标 = RTSCommand 当前选中单位（标签只用于轮盘中心显示）
        if (RTSCommand && RTSCommand.enabled && RTSCommand.hasAllySelection && RTSCommand.hasAllySelection()) {
            this._targetRefs = RTSCommand._selection
                .filter((s) => s.kind === 'ally')
                .map((s) => s.ref)
                .filter(Boolean);
            const n = this._targetRefs.length;
            this._targetIds = [];
            this._targetLabel = `选中 ${n} 个单位`;
            return n;
        }
        const members = PartySystem.members;
        if (!members.length) { this._targetIds = []; this._targetRefs = []; this._targetLabel = ''; return 0; }
        if (all) {
            this._targetIds = members.map((m) => m.id);
            this._targetRefs = members.slice();
            this._targetLabel = `全队（${members.length} 人）`;
            return this._targetIds.length;
        }
        // 组队栏选中优先（单选/多选）：只命令被选中的单位
        const selected = PartySystem.selectedIds;
        if (selected.length) {
            this._targetIds = selected.slice();
            this._targetRefs = selected.map((id) => PartySystem.getMember(id)).filter(Boolean);
            if (selected.length === 1) {
                const m = PartySystem.getMember(selected[0]);
                this._targetLabel = m ? m.name || m.id : selected[0];
            } else {
                this._targetLabel = `选中 ${selected.length} 人`;
            }
            return this._targetIds.length;
        }
        // 兜底：队员面板当前队员（老行为），无则第一名
        const panel = Game && Game.CompanionPanel;
        let member = null;
        if (panel && panel._memberId) member = PartySystem.getMember(panel._memberId);
        if (!member) member = members[0];
        this._targetIds = [member.id];
        this._targetRefs = [member];
        this._targetLabel = member.name || member.id;
        return 1;
    },

    _openWheel() {
        if (this._open) return;
        const targetCount = this._resolveTargets(false);
        if (!targetCount) return;

        const el = document.createElement('div');
        el.className = 'companion-wheel';
        el.style.left = `${this._openAt.x}px`;
        el.style.top = `${this._openAt.y}px`;
        el.innerHTML = `<div class="cw-center">${this._targetLabel}<br><em>移动到指令上松开 · 移出取消</em></div>`;
        const R = 88;
        const commands = this.commands.filter((cmd) => cmd.id !== 'explore'
            || this._targetRefs.some((unit) => unit?._isHamsterExplorer));
        commands.forEach((cmd, i) => {
            const ang = (-90 + i * (360 / commands.length)) * Math.PI / 180;
            const btn = document.createElement('div');
            btn.className = 'cw-item';
            btn.dataset.cmd = cmd.id;
            btn.style.left = `${Math.round(Math.cos(ang) * R)}px`;
            btn.style.top = `${Math.round(Math.sin(ang) * R)}px`;
            btn.style.borderColor = cmd.color;
            btn.innerHTML = `<span class="cw-icon">${cmd.icon}</span><span class="cw-name" style="color:${cmd.color};">${cmd.name}</span>`;
            btn.addEventListener('mouseenter', () => { this._hovered = cmd.id; btn.classList.add('cw-hover'); });
            btn.addEventListener('mouseleave', () => { if (this._hovered === cmd.id) this._hovered = null; btn.classList.remove('cw-hover'); });
            el.appendChild(btn);
        });
        document.body.appendChild(el);
        this._el = el;
        this._open = true;
    },

    _close() {
        this._open = false;
        this._hovered = null;
        this._targetRefs = [];
        if (this._el) {
            this._el.remove();
            this._el = null;
        }
    },

    _execute(cmdId) {
        const cmd = this.commands.find((c) => c.id === cmdId);
        if (!cmd) return;
        // 指挥模式统一出口（2026-08-19）：所有选中单位执行（队友视同仓鼠友军）
        if (RTSCommand && RTSCommand.enabled && RTSCommand.hasAllySelection && RTSCommand.hasAllySelection()) {
            const n = RTSCommand.issueWheelCommand(cmd.id, this._worldPoint);
            if (n > 0 && EffectManager) {
                EffectManager.add(new FloatingTextEffect(Camera.x, Camera.y - 100, `指令：${cmd.icon} ${cmd.name}（${n} 单位）`, cmd.color));
            }
            return;
        }
        const n = PartySystem.setCommand(this._targetIds, cmd.id, this._worldPoint);
        if (n > 0 && Game.player && EffectManager) {
            const label = n > 1 ? `（全队 ${n} 人）` : '';
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 50, `指令：${cmd.icon} ${cmd.name}${label}`, cmd.color));
        }
    },
};
