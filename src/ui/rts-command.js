// ============================================================
// RTS 指挥模式（RTSCommand，2026-08-16）
// 左键选择或框选单位，右键移动或攻击；建筑详情仍复用现有系统。
// 通过 game.js 初始化并逐帧 tick；跨系统依赖使用 window.Game 惰性访问以避免循环 import。
// ============================================================

import { PartySystem } from '../systems/party-system.js';
import { Renderer } from '../world/renderer.js';
import { Camera } from '../world/camera.js';
import { CONFIG } from '../config/config.js';
import { GAME_CONFIG } from '../config/game-config.js';
import { UIState } from './ui-state.js';
import { getUnitKind } from '../world/unit-upgrade-store.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { TroopLineSystem } from '../world/troop-line-system.js';
import { RtsTacticalOrderSystem } from '../systems/rts-tactical-order-system.js';
import { pathFinder } from '../ai/pathfinder.js';
import { TechnologySystem } from '../world/technology-system.js';
import {
    isoFootprintVertices,
    isoLocalToWorldDelta,
    worldDeltaToIsoLocal,
} from '../physics/iso-footprint.js';
import { TechnologyGate } from './technology-gate.js';
import { FogOfWarSystem } from '../world/fog-of-war-system.js';
import { canExploreScene } from '../config/explorer-rewards.js';
import { getHamsterUnitIcon } from '../config/hamster-unit-icons.js';
import { getHamsterUnitCategoryLabel } from '../config/hamster-unit-categories.js';
import { getUnitStatusRows, getUnitUpgradeRows } from './rts-unit-detail-model.js';
import { isGameplayPointerEvent } from './gameplay-pointer-boundary.js';
import { TechnologyTreePanel } from './technology-tree-panel.js';
import { RTS_ORDER_UI, rtsOrderIcon } from './rts-command-presentation.js';

const DRAG_THRESHOLD = 6; // 屏幕 px：超过判定为拖框
const PERSISTENT_WORLDS = new Set(['scene8', 'scene9', 'scene10', 'scene11']);
const QUEUED_MODES = new Set(['move', 'attack', 'attack_move', 'patrol']);
const ORDER_HOTKEYS = GAME_CONFIG.rtsCommand?.hotkeys || {
    attack_move: 'KeyA', patrol: 'KeyP', stop: 'KeyS', hold: 'KeyH',
};

const _game = () => (typeof window !== 'undefined' ? window.Game : null);
const _scene = () => (typeof window !== 'undefined' ? window.__phaserScene : null);

export const RTSCommand = {
    enabled: false,
    _btn: null,
    _panel: null,
    _selection: [],        // [{ kind: 'ally' | 'enemy' | 'producer', ref }]
    _scene: null,          // 当前逻辑场景 id（game.js tick 传入）
    _down: false,
    _downX: 0,
    _downY: 0,
    _dragging: false,
    _minimapDragging: false,
    _dragX: 0,
    _dragY: 0,
    _boxG: null,           // 拖框 graphics（世界空间，盖在单位之上）
    _enemyRings: null,     // Map<enemy, Phaser.Ellipse> 选中敌人脚下红圈
    _allyRings: null,      // Map<unit, Phaser.Ellipse> 非组队友军（仓鼠等）脚下金色光圈
    _producerRings: null,  // Map<building, Phaser.Graphics> 建筑真实 footprint 选中提示
    _rallyGuideG: null,    // 从屏幕外天空沿视觉 Z 轴落到集结点的金色虚线
    _rallyGuideScene: null,
    _domSig: null,         // 属性面板 DOM 签名（目标变化才重建；数值每帧原地更新）
    _dom: null,            // 属性面板 DOM 引用（HP/MP 条、六维、战斗属性 span）
    _lastClick: null,      // 双击同类复选（{at, ref}）
    _flatHitCycle: null,   // 压平视图同屏重叠单位轮换
    _mouseSeen: false,     // 见过真实鼠标移动才允许边缘平移
    _pointerOverUi: false,
    _groups: null,         // 编队：digit -> [友军 ref]
    _lastGroupRecall: null,
    _orderQueues: new Map(), // unit -> { current, orders, sceneId }；仅运行时，不写存档。
    _commandPickQueue: false,
    _pendingRightClick: null, // RTS 唯一右键入口：DOM 捕获后下一 tick 消费一次
    _troopLinePanel: null,
    _commandBar: null,
    _commandBarSig: '',
    _commandPicking: null,
    _consumeNormalCommandPointer: false,
    _rallyPicking: false,
    _troopLineRevision: -1,
    _hoverBuilding: null,  // 指挥态鼠标悬停的可交互建筑（GameScene 读取并绘制金色轮廓）
    _hoverElevatedTarget: null, // 已选友军可登上的墙顶/塔楼表面（GameScene 读取并替换鼠标贴图）

    init() {
        this._createButton();
        this._createPanel();
        this._createTroopLinePanel();
        this._createCommandBar();
        this._enemyRings = new Map();
        this._allyRings = new Map();
        this._producerRings = new Map();
        window.addEventListener('mousedown', (e) => this._onMouseDown(e));
        window.addEventListener('mousemove', (e) => this._onMouseMove(e));
        window.addEventListener('mouseup', (e) => this._onMouseUp(e));
        window.addEventListener('blur', () => {
            this._minimapDragging = false;
            this._pendingRightClick = null;
            this._clearDrag();
        });
        window.addEventListener('keydown', (e) => this._onKeyDown(e), true); // capture：先于快捷栏数字键
        window.addEventListener('mousemove', () => { this._mouseSeen = true; }, { passive: true });
        this._groups = new Map();
        this.setEnabled(false);
    },

    /** game.js 每帧调用：同步场景、处理输入并刷新渲染与面板。 */
    tick(sceneId, Input, dt) {
        const g = _game();
        const observer = !!(g && g._observerMode);
        // 指挥模式可用于所有持久世界，以及观察模式下的世界。
        const commandable = (PERSISTENT_WORLDS.has(sceneId) || observer)
            && TechnologySystem.isUnlocked('mechanic', 'rts_command');
        const leavingWorld = PERSISTENT_WORLDS.has(this._scene) && this._scene !== sceneId;
        const sceneChanged = this._scene !== null && this._scene !== sceneId;
        this._scene = sceneId;
        const commandButtonWasVisible = !!(this._btn && this._btn.style.display !== 'none');
        if (this._btn) TechnologyGate.refresh(this._btn);
        if (commandable && !commandButtonWasVisible) this._placeButton();
        if (this._troopLinePanel) this._troopLinePanel.style.display = (commandable && this.enabled) ? '' : 'none';
        if (sceneChanged) {
            this._orderQueues.clear();
            this._pendingRightClick = null;
            this.cancelPendingCommand();
            if (leavingWorld && !observer) this._resetPartyCommandsForSceneExit();
        }
        if (!commandable && this.enabled) this.setEnabled(false);
        if (!g?._paused && g?.isRunning) this._advanceCommandQueues();
        // 普通模式也要随组队栏选中状态刷新左下指令框。
        this._syncCommandBarVisibility();
        if (this._consumeNormalCommandPointer && Input?.mouse) {
            Input.mouse.leftDown = false;
            Input.mouse.rightDown = false;
            Input.mouse.leftPressed = false;
            Input.mouse.rightPressed = false;
            this._consumeNormalCommandPointer = false;
        }
        if (!this.enabled) {
            this._setElevatedHover(null);
            this._setHoverBuilding(null);
            return;
        }
        this._pruneSelection();
        this._syncBuildingHover(Input?.mouse?.x, Input?.mouse?.y);
        this._syncElevatedHover(Input?.mouse?.x, Input?.mouse?.y);
        this._edgePan(dt, Input);
        const input = Input || this._input();
        const pendingRightClick = this._pendingRightClick;
        this._pendingRightClick = null;
        if (pendingRightClick) {
            this._handleRightClick(pendingRightClick.x, pendingRightClick.y, pendingRightClick);
            if (input?.mouse) input.mouse.rightPressed = false;
        }
        this._renderSelectionFx();
        this._refreshPanel();
        this._refreshTroopLinePanel();
    },

    _input() {
        // input.js 模块不静态 import，避免与 game.js 循环依赖。
        return (typeof window !== 'undefined' && window.Input) ? window.Input : null;
    },

    setEnabled(on) {
        _game()?.CompanionCommandWheel?._cancel?.();
        if (on && !TechnologySystem.isUnlocked('mechanic', 'rts_command')) {
            this.enabled = false;
            if (this._btn) this._btn.classList.remove('active');
            return false;
        }
        if (on) this._closeBuildingUI();
        this.enabled = !!on;
        // 指挥模式切换统一锁定/恢复玩家控制，并清除进入前遗留的按键与鼠标状态。
        const input = _game()?.Input || this._input();
        input?.setPlayerControlLocked?.(this.enabled);
        if (this._btn) this._btn.classList.toggle('active', this.enabled);
        if (this._troopLinePanel) this._troopLinePanel.style.display = this.enabled ? '' : 'none';
        this._syncCommandBarVisibility();
        if (!this.enabled) {
            this._setElevatedHover(null);
            this._rallyPicking = false;
            this._commandPicking = null;
            this._commandPickQueue = false;
            this._pendingRightClick = null;
            this._flatHitCycle = null;
            this._minimapDragging = false;
            this._clearSelection();
            this._hidePanel();
            this._clearDrag();
            // 退出指挥模式：镜头回归玩家（观察模式无玩家在场，不动镜头）
            const g = _game();
            this._orderQueues.delete(g?.player);
            g?.player?._rtsController?.cancel?.();
            if (g && g.player && !g._observerMode && g.entities && g.entities.get('player') === g.player) {
                Camera.follow(g.player);
            }
        }
        this._renderSelectionFx();
        this._refreshTroopLinePanel(true);
        return this.enabled;
    },

    /** 跨场景时清除旧世界坐标与实体引用。 */
    _resetPartyCommandsForSceneExit() {
        if (!PartySystem) return;
        for (const m of PartySystem.members) {
            if (!m) continue;
            PartySystem.setCommand(m.id, 'follow');
            m.target = null;
            m._tacticalTarget = null;
            m.vx = 0;
            m.vy = 0;
            m.isMoving = false;
            if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
                m._pathManager._clearPath();
            }
        }
    },

    // ==================== 按钮 / 面板 DOM ====================

    _createButton() {
        if (this._btn) return;
        const btn = document.createElement('button');
        btn.id = 'rtsCommandBtn';
        btn.className = 'rts-command-btn';
        btn.textContent = '⚔ 指挥模式';
        btn.title = 'F1 进入/退出指挥模式：左键选择/框选，右键移动/攻击，单击空地取消';
        btn.addEventListener('click', () => {
            btn.blur();
            this.setEnabled(!this.enabled);
        });
        const container = document.getElementById('gameContainer');
        container.appendChild(btn);
        this._btn = btn;
        TechnologyGate.bind(btn, {
            type: 'mechanic',
            id: 'rts_command',
            preserveLayout: false,
            when: () => PERSISTENT_WORLDS.has(this._scene) || !!(_game()?._observerMode),
        });
        this._placeButton();
        // 组队栏或窗口尺寸变化时重新定位。
        window.addEventListener('resize', () => this._placeButton());
    },

    _placeButton() {
        if (!this._btn) return;
        const bar = document.getElementById('partyBar');
        const top = bar ? bar.getBoundingClientRect().bottom + 5 : 225;
        this._btn.style.top = `${top}px`;
        this._btn.style.left = '10px';
        this._btn.style.width = '252px';
        this._placeTroopLinePanel();
    },

    _createPanel() {
        if (this._panel) return;
        const el = document.createElement('div');
        el.id = 'rtsUnitPanel';
        el.className = 'rts-unit-panel';
        el.style.display = 'none';
        const container = document.getElementById('gameContainer');
        container.appendChild(el);
        this._panel = el;
        this._placeUnitPanel();
        window.addEventListener('resize', () => this._placeUnitPanel());
    },

    _createTroopLinePanel() {
        if (this._troopLinePanel) return;
        const el = document.createElement('div');
        el.id = 'troopLinePanel';
        el.className = 'troop-line-panel';
        el.style.cssText = [
            'display:none;position:fixed;left:10px;width:252px;height:164px;z-index:4700;',
            'background:rgba(18,20,24,.94);border:2px solid #6d7b8d;border-radius:8px;',
            'padding:10px 14px;color:#d8dfeb;box-shadow:0 5px 18px rgba(0,0,0,.5);box-sizing:border-box;',
            'font-family:SimHei,"Microsoft YaHei",sans-serif;pointer-events:auto;',
        ].join('');
        el.innerHTML = `
            <div class="troop-line-title">兵线部署 · 新生产士兵</div>
            <div class="troop-line-actions" style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;">
                <button type="button" data-mode="follow" title="新生产士兵跟随玩家">${rtsOrderIcon('follow')}<span>跟随</span></button>
                <button type="button" data-mode="hold" title="新生产士兵在建筑出口待命">${rtsOrderIcon('hold')}<span>待命</span></button>
                <button type="button" data-mode="rally" title="右键设置新生产士兵的集结点">${rtsOrderIcon('rally')}<span>自订</span></button>
            </div>
            <div data-role="status" style="font-size:12px;line-height:1.55;color:#aeb9c8;margin-top:8px;height:76px;overflow:hidden;box-sizing:border-box;white-space:pre-line;"></div>
        `;
        for (const button of el.querySelectorAll('[data-mode]')) {
            if (button.dataset.mode === 'hold') {
                TechnologyGate.bind(button, { type: 'mechanic', id: 'troop_hold' });
            } else if (button.dataset.mode === 'rally') {
                TechnologyGate.bind(button, { type: 'mechanic', id: 'troop_rally' });
            }
            button.addEventListener('click', () => {
                const mode = button.dataset.mode;
                this._cancelCommandPick();
                if (mode === 'rally') {
                    if (!TechnologySystem.isUnlocked('mechanic', 'troop_rally')) return;
                    if (this._rallyPicking) {
                        this._cancelRallyPick();
                    } else {
                        this._rallyPicking = true;
                        this._refreshTroopLinePanel(true);
                    }
                    return;
                } else {
                    if (mode === 'hold' && !TechnologySystem.isUnlocked('mechanic', 'troop_hold')) return;
                    this._rallyPicking = false;
                    TroopLineSystem.setMode(mode);
                }
                this._refreshTroopLinePanel(true);
            });
        }
        document.getElementById('gameContainer')?.appendChild(el);
        this._troopLinePanel = el;
        this._placeTroopLinePanel();
        window.addEventListener('resize', () => this._placeTroopLinePanel());
    },

    _placeTroopLinePanel() {
        if (!this._troopLinePanel) return;
        const buttonRect = this._btn?.getBoundingClientRect?.();
        // 科技门禁可能让按钮处于 display:none，此时 DOMRect 全为 0。
        // 位置仍必须按按钮原预设槽位计算，不能把兵线面板吸到画面顶部。
        const presetTop = Number.parseFloat(this._btn?.style?.top);
        const presetHeight = Number.parseFloat(
            typeof window !== 'undefined' && this._btn
                ? window.getComputedStyle(this._btn).height
                : ''
        ) || 32;
        const buttonBottom = buttonRect?.height > 0
            ? buttonRect.bottom
            : (Number.isFinite(presetTop) ? presetTop + presetHeight : 270);
        this._troopLinePanel.style.top = `${buttonBottom + 6}px`;
        this._placeCommandBar();
    },

    _createCommandBar() {
        if (this._commandBar) return;
        const el = document.createElement('div');
        el.id = 'rtsCommandBar';
        el.className = 'rts-command-bar';
        el.style.display = 'none';
        el.setAttribute('aria-label', '指令栏');
        el.addEventListener('click', (event) => this._onCommandBarClick(event));
        document.getElementById('gameContainer')?.appendChild(el);
        this._commandBar = el;
        this._placeCommandBar();
        window.addEventListener('resize', () => this._placeCommandBar());
    },

    _placeCommandBar() {
        if (!this._commandBar) return;
        const troopRect = this._troopLinePanel?.getBoundingClientRect?.();
        const presetTop = Number.parseFloat(this._troopLinePanel?.style?.top);
        const presetHeight = Number.parseFloat(this._troopLinePanel?.style?.height) || 164;
        const troopBottom = troopRect?.height > 0
            ? troopRect.bottom
            : (Number.isFinite(presetTop) ? presetTop + presetHeight : 440);
        const top = troopBottom + 6;
        this._commandBar.style.top = `${top}px`;
        this._commandBar.style.maxHeight = `max(0px, calc(100dvh - ${top + 16}px))`;
    },

    _syncCommandBarVisibility() {
        if (!this._commandBar) return;
        const show = !_game()?.BuildingSystem?.active && this._commandBarAllies().length > 0;
        this._commandBar.style.display = show ? '' : 'none';
        if (show) {
            this._refreshCommandBar();
            this._placeCommandBar();
        } else {
            this._commandPicking = null;
            this._commandPickQueue = false;
            this._commandBarSig = '';
            this._commandBar.replaceChildren();
        }
    },

    _refreshCommandBar() {
        if (!this._commandBar) return;
        const allies = this._commandBarAllies();
        if (!allies.length) return;
        const explorers = allies.filter((unit) => unit?._isHamsterExplorer);
        const ninjas = allies.filter((unit) => unit?._isHamsterNinja && !unit._dying && unit.hp > 0);
        const active = explorers.filter((unit) => unit._exploreActive || unit._command?.mode === 'explore');
        const orders = ['move', 'attack', 'attack_move', 'patrol', 'stop', 'hold', 'follow'];
        if (allies.some((unit) => PartySystem.members.includes(unit) || unit._isHamsterMiner)) orders.push('gather');
        const counts = Object.fromEntries(orders.map((mode) =>
            [mode, allies.filter((unit) => this.supportsCommand(unit, mode)).length]));
        if (this._commandPicking && !counts[this._commandPicking]) {
            this._commandPicking = null;
            this._commandPickQueue = false;
        }
        const queuedCount = allies.reduce((sum, unit) => sum + (this._orderQueues.get(unit)?.orders.length || 0), 0);
        const eligible = canExploreScene(this._scene);
        const exploreReady = explorers.filter((unit) => this.supportsCommand(unit, 'explore')).length;
        const remainingSec = active.length
            ? Math.max(0, Math.ceil(Math.min(...active.map((unit) =>
                Number(unit._exploreRemainingMs) || 0)) / 1000))
            : 0;
        const stealthing = ninjas.filter((unit) => unit._isStealthed || unit._stealthCastActive);
        const stealthReady = ninjas.filter((unit) => !unit._isStealthed && !unit._stealthCastActive
            && (Number(unit._stealthCooldownLeft) || 0) <= 0);
        const coolingNinjas = ninjas.filter((unit) => !unit._isStealthed && !unit._stealthCastActive);
        const stealthCooldownSec = coolingNinjas.length
            ? Math.max(0, Math.ceil(Math.min(...coolingNinjas.map((unit) =>
                Number(unit._stealthCooldownLeft) || 0)) / 1000))
            : 0;
        const signature = JSON.stringify([
            allies.map((unit) => this._commandUnitId(unit)), counts, explorers.length, active.length,
            exploreReady, eligible, remainingSec, queuedCount, ninjas.length, stealthing.length,
            stealthReady.length, stealthCooldownSec, this._commandPicking, this.enabled,
        ]);
        if (signature === this._commandBarSig) return;
        this._commandBarSig = signature;
        const focusedOrder = this._commandBar.contains(document.activeElement)
            ? document.activeElement.dataset?.order : null;
        const scrollTop = this._commandBar.scrollTop;
        const minutes = Math.floor(remainingSec / 60);
        const seconds = String(remainingSec % 60).padStart(2, '0');
        const picking = RTS_ORDER_UI[this._commandPicking];
        const pickingLabel = picking
            ? `${picking.name}：${picking.target === 'enemy' ? '左键点击可见敌人' : '左键地图确认'} · 右键/Esc取消`
            : null;
        const buttonMarkup = (mode, count, total = allies.length) => {
            const item = RTS_ORDER_UI[mode];
            const key = this.enabled ? (ORDER_HOTKEYS[mode] || '').replace(/^Key/, '') : '';
            return `<button type="button" class="rts-command-bar__order${this._commandPicking === mode ? ' is-active' : ''}" data-order="${mode}" ${count <= 0 ? 'disabled' : ''} ${item.target ? `aria-pressed="${this._commandPicking === mode}"` : ''}>
                ${rtsOrderIcon(mode)}
                ${key ? `<kbd class="rts-command-bar__key-hint">${key}</kbd>` : ''}
                <span class="rts-command-bar__name">${item.name}</span>
                ${count < total ? `<span class="rts-command-bar__count">${count}/${total}</span>` : ''}
            </button>`;
        };
        this._commandBar.innerHTML = `
            <div class="rts-command-bar__header"><div class="rts-command-bar__title">选中单位 · ${allies.length}</div>
                ${picking ? '<button type="button" class="rts-command-bar__cancel" data-order="cancel">取消</button>' : ''}
            </div>
            <div class="rts-command-bar__grid${this.enabled ? ' has-hotkeys' : ''}">${orders.map((mode) => buttonMarkup(mode, counts[mode])).join('')}</div>
            <div class="rts-command-bar__status">${pickingLabel || (counts.move > 0
                ? '悬停查看规则 · Shift追加移动/攻击/巡逻'
                : '选中单位暂不能接令；探险中可停止探险')}${queuedCount ? ` · 排队 ${queuedCount} 条` : ''}</div>
            ${explorers.length ? `
                <div class="rts-command-bar__section">
                    <div class="rts-command-bar__subtitle">探险家 · ${explorers.length}</div>
                    <div class="rts-command-bar__grid">${buttonMarkup('explore', exploreReady, explorers.length)}${active.length ? buttonMarkup('stop_explore', active.length, explorers.length) : ''}</div>
                    <div class="rts-command-bar__status">${active.length ? `探险中 ${active.length} · 最早剩余 ${minutes}:${seconds}` : (eligible ? '耗时12:00 · 完成后结算一次' : '当前位面没有对应祭品池')}</div>
                </div>
            ` : ''}
            ${ninjas.length ? `
                <div class="rts-command-bar__section">
                    <div class="rts-command-bar__subtitle">忍者 · ${ninjas.length}</div>
                    <div class="rts-command-bar__grid">${buttonMarkup('stealth', stealthReady.length, ninjas.length)}${stealthing.length ? buttonMarkup('reveal', stealthing.length, ninjas.length) : ''}</div>
                    <div class="rts-command-bar__status">隐身中 ${stealthing.length} · ${stealthReady.length ? `可施放 ${stealthReady.length}` : (coolingNinjas.length ? `最短冷却 ${stealthCooldownSec}s` : '攻击会解除')}</div>
                </div>
            ` : ''}
        `;
        for (const button of this._commandBar.querySelectorAll('[data-order]')) {
            const mode = button.dataset.order;
            const item = RTS_ORDER_UI[mode];
            if (!item) { button.title = '取消目标选择（Esc）'; continue; }
            const count = counts[mode];
            const reason = count === 0 ? this._commandRejectReason(allies[0], mode) : null;
            button.title = `${item.hint}${count !== undefined ? ` 可执行 ${count}/${allies.length}。` : ''}${reason || ''}`;
            if (mode === 'explore' && !eligible) button.title += ' 当前位面没有对应祭品池。';
            if (mode === 'stealth' && !stealthReady.length) button.title += coolingNinjas.length ? ` 最短冷却 ${stealthCooldownSec}s。` : ' 选中忍者已经隐身。';
            button.setAttribute('aria-label', `${item.name}。${button.title}`);
        }
        if (focusedOrder) this._commandBar.querySelector(`[data-order="${focusedOrder}"]:not(:disabled)`)?.focus({ preventScroll: true });
        this._commandBar.scrollTop = scrollTop;
    },

    _onCommandBarClick(event) {
        const button = event.target.closest?.('button[data-order]');
        if (!button || button.disabled || _game()?._paused || TechnologyTreePanel.isOpen
            || UIState.isOpen('worldSwitch') || UIState.isOpen('strategicExpedition')) return;
        if (event.detail > 0) button.blur();
        const mode = button.dataset.order;
        if (RTS_ORDER_UI[mode]?.target) {
            this._beginCommandPick(mode, event.shiftKey && QUEUED_MODES.has(mode));
            return;
        }
        this.cancelPendingCommand();
        if (mode === 'stop_explore') this.stopSelectedExplorers();
        else if (mode === 'stealth' || mode === 'reveal') {
            // 点击时读取当前选择，不持有上次重绘的单位数组。
            for (const unit of this._commandBarAllies()) {
                if (!unit._isHamsterNinja || unit._dying || unit.hp <= 0) continue;
                const hidden = unit._isStealthed || unit._stealthCastActive;
                if (mode === 'reveal' && hidden) unit.setStealth?.(false);
                else if (mode === 'stealth' && !hidden && (Number(unit._stealthCooldownLeft) || 0) <= 0) unit.setStealth?.(true);
            }
        } else if (mode !== 'cancel') this.issueWheelCommand(mode);
        this._commandBarSig = '';
        this._refreshCommandBar();
    },

    _beginCommandPick(mode, queue = false) {
        if (!RTS_ORDER_UI[mode]?.target) return;
        if (!this._commandBarAllies().some((unit) => this.supportsCommand(unit, mode))) return;
        if (this._rallyPicking) this._cancelRallyPick();
        this._commandPicking = this._commandPicking === mode ? null : mode;
        this._commandPickQueue = !!this._commandPicking && queue && QUEUED_MODES.has(mode);
        this._commandBarSig = '';
        this._refreshCommandBar();
    },

    _cancelCommandPick() {
        this._commandPickQueue = false;
        if (!this._commandPicking) return;
        this._commandPicking = null;
        this._commandBarSig = '';
        this._refreshCommandBar();
    },

    /** 键盘和 Electron 转发的 Esc 共用，返回是否消费本次取消。 */
    cancelPendingCommand() {
        const wheel = _game()?.CompanionCommandWheel;
        const pending = !!(this._commandPicking || this._rallyPicking || wheel?._holding || wheel?._open);
        if (wheel?._holding || wheel?._open) wheel._cancel();
        if (this._commandPicking) this._cancelCommandPick();
        if (this._rallyPicking) this._cancelRallyPick();
        if (pending) { this._pendingRightClick = null; this._clearDrag(); }
        return pending;
    },

    /** 左下指令框目标：指挥模式读 RTS 选中；普通模式读组队栏选中的正式队友。 */
    _commandBarAllies() {
        if (this.enabled) {
            return this._selection
                .filter((entry) => entry.kind === 'ally' && entry.ref?.active !== false)
                .map((entry) => entry.ref);
        }
        return PartySystem.selectedIds
            .map((id) => PartySystem.getMember(id))
            .filter((member) => member && member.active !== false);
    },

    _placeUnitPanel() {
        if (!this._panel) return;
        const clock = document.querySelector('.game-time');
        const clockBottom = clock?.getBoundingClientRect?.().bottom || 84;
        const top = clockBottom + 8;
        this._panel.style.top = `${top}px`;
        this._panel.style.right = window.innerWidth <= 720 ? '8px' : '100px';
        this._panel.style.setProperty('--rts-panel-top', `${top}px`);
    },

    _cancelRallyPick() {
        if (!this._rallyPicking) return;
        this._rallyPicking = false;
        this._refreshTroopLinePanel(true);
    },

    _refreshTroopLinePanel(force = false) {
        const el = this._troopLinePanel;
        if (!el) return;
        const state = TroopLineSystem.getState();
        if (!force && !this._rallyPicking && state.revision === this._troopLineRevision) return;
        this._troopLineRevision = state.revision;
        for (const button of el.querySelectorAll('[data-mode]')) {
            const active = this._rallyPicking
                ? button.dataset.mode === 'rally'
                : button.dataset.mode === state.mode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        }
        const status = el.querySelector('[data-role="status"]');
        if (!status) return;
        if (this._rallyPicking) {
            status.textContent = '请在当前位面右键选择集结点；可按 Esc 或再次点击“自订”取消。';
        } else if (state.mode === 'rally' && state.rally) {
            const worldName = window.WorldProgressionSystem?.getWorldConfig?.(state.rally.sceneId)?.name || state.rally.sceneId;
            status.textContent = `自订集结：${worldName}（${Math.round(state.rally.x)}, ${Math.round(state.rally.y)}）`;
        } else if (state.mode === 'hold') {
            status.textContent = '新生产士兵将在建筑出口原地待命。';
        } else {
            status.textContent = '新生产士兵跟随玩家；传送时跟随部队与队友一同通过。';
        }
        status.style.whiteSpace = 'pre-line';
        if (state.independentRallyCount > 0) {
            status.textContent += `\n独立集结 ${state.independentRallyCount} 座（优先）`;
        }
        status.textContent += `\n驻军 ${state.garrisoned} · 途中 ${state.transit} · 编制 ${state.assigned}/${state.capacity}`;
    },

    _hidePanel() {
        if (this._panel) this._panel.style.display = 'none';
    },

    /** 互斥接口：面板当前是否显示，供 game.js 仲裁。 */
    hasPanel() {
        return !!(this._panel && this._panel.style.display !== 'none');
    },

    /** 互斥接口：仅隐藏单位/复数面板，保留选择与选中光圈。 */
    closePanel() {
        this._hidePanel();
    },

    /** 关闭建筑详情；切换建筑时可保留刚接管内容的目标面板。 */
    _buildingDetailPanels() {
        const g = _game();
        if (!g) return [];
        return [...new Set([
            ...(g.BuildingSystem?._buildingDetailPanels?.() || []),
            g.DefenseSystem?._panel,
            g.HamsterHutSystem?._panel,
            g.ProducerBuildingSystem?._panel,
        ].filter(Boolean))];
    },

    _closeBuildingUIExcept(keepPanel = null, { keepStructureDetail = false } = {}) {
        const g = _game();
        if (!g) return;
        if (g.BuildingSystem?.active && typeof g.BuildingSystem.close === 'function') {
            g.BuildingSystem.close();
        } else if (!keepStructureDetail && g.BuildingSystem?._detail
            && typeof g.BuildingSystem._closeDetail === 'function') {
            g.BuildingSystem._closeDetail();
        }
        for (const panel of this._buildingDetailPanels()) {
            if (panel === keepPanel || !panel.isOpen || typeof panel.close !== 'function') continue;
            panel.close();
        }
    },

    /** 关闭全部建筑选择与详情界面。 */
    _closeBuildingUI() {
        this._closeBuildingUIExcept();
    },

    // ==================== 选择 ====================

    _pruneSelection() {
        const before = this._selection.length;
        const allies = new Set(this._collectAllies());
        const g = _game();
        const worldEntities = new Set(g?.entities?.values ? g.entities.values() : []);
        const liveProducers = new Set(TroopLineSystem.getLiveProducers());
        this._selection = this._selection.filter((s) => {
            if (!s.ref || !s.ref.active) return false;
            if (s.kind === 'producer') return liveProducers.has(s.ref);
            if (s.kind === 'enemy' && FogOfWarSystem.shouldHideEntity(this._scene, s.ref)) return false;
            return s.kind === 'ally' ? allies.has(s.ref) : worldEntities.has(s.ref);
        });
        if (before !== this._selection.length) {
            this._syncPartySelection();
            this._renderSelectionFx();
            this._domSig = null;
            this._syncCommandBarVisibility();
        }
    },

    _setSelection(list, { preserveBuildingUI = false } = {}) {
        const seen = new Set();
        this._selection = (list || []).filter((s) => {
            if (!s?.ref?.active || seen.has(s.ref)
                || (s.kind === 'ally' && s.ref._rtsSelectable === false)) return false;
            seen.add(s.ref);
            return true;
        });
        // 打开单位详情或复数选择面板时，关闭建筑选择界面。
        if (!preserveBuildingUI) this._closeBuildingUI();
        this._syncPartySelection();
        this._renderSelectionFx();
        this._domSig = null;
        this._refreshPanel();
        this._syncCommandBarVisibility();
    },

    _clearSelection() {
        if (!this._selection.length) return;
        this._selection = [];
        this._syncPartySelection();
        this._renderSelectionFx();
        this._hidePanel();
        this._domSig = null;
        this._syncCommandBarVisibility();
    },

    _applyPointerSelection(list, event, toggle = false) {
        const remove = event.ctrlKey || event.metaKey;
        if (remove) {
            const refs = new Set(list.map((item) => item.ref));
            this._setSelection(this._selection.filter((item) => !refs.has(item.ref)));
            return;
        }
        let result = list;
        if (event.shiftKey) {
            const refs = new Set(list.map((item) => item.ref));
            const selected = new Set(this._selection.map((item) => item.ref));
            result = toggle
                ? [...this._selection.filter((item) => !refs.has(item.ref)), ...list.filter((item) => !selected.has(item.ref))]
                : [...this._selection, ...list];
        }
        // 框选优先友军；敌方详情不会混进可下令队伍。
        if (result.some((item) => item.kind === 'ally')) result = result.filter((item) => item.kind === 'ally');
        this._setSelection(result);
    },

    /** 友军选中同步至组队栏高亮与场景选中光圈。 */
    _syncPartySelection() {
        if (!PartySystem) return;
        const allyIds = this._selection
            .filter((s) => s.kind === 'ally' && PartySystem.members.includes(s.ref))
            .map((s) => s.ref.id);
        PartySystem.setSelected(allyIds);
    },

    _isPlayerUnit(unit) {
        const g = _game();
        return !!(g && unit === g.player && !g._observerMode
            && g.entities?.get?.('player') === g.player);
    },

    _commandUnitId(unit) {
        return this._isPlayerUnit(unit) ? '__player__' : unit?.id;
    },

    // ==================== 命中 / 框选 ====================

    /** 全部可指挥友军：本体世界玩家 + PartySystem 侍从 + 仓鼠等场上友军；
     * 观察世界不注入异世界玩家本体。 */
    _collectAllies() {
        const allies = [];
        const seen = new Set();
        const g = _game();
        // 观察世界没有玩家本体及随行队员，不读取本体世界的 PartySystem 对象。
        if (!g?._observerMode) {
            if (g?.player?.active && g.entities?.get?.('player') === g.player) {
                allies.push(g.player);
                seen.add(g.player);
            }
            for (const m of PartySystem.members) {
                if (!m || !m.active || m._rtsSelectable === false) continue;
                allies.push(m);
                seen.add(m);
            }
        }
        if (!g || !g.entities) return allies;
        for (const e of g.entities.values()) {
            if (!e || !e.active || seen.has(e)) continue;
            if (e._rtsSelectable === false) continue;
            const f = e._faction;
            if (f !== 'player' && f !== 'companion' && f !== 'ally' && f !== 'friendly') continue;
            if (e._isDefenseStructure || e._isWallStaircase || e._isEnergyNode) continue;
            if (e.itemData || e.targetScene || e.npcType || e._isNPC) continue;
            allies.push(e);
        }
        return allies;
    },

    _hitUnitAt(sx, sy, { cycle = false } = {}) {
        const candidates = [];
        const addCandidate = (kind, ref) => {
            const rect = this._unitScreenRect(ref);
            if (!rect || sx < rect.x0 || sx > rect.x1 || sy < rect.y0 || sy > rect.y1) return;
            candidates.push({
                kind,
                ref,
                distance: Math.hypot(sx - rect.cx, sy - rect.cy),
                z: Number(ref.z) || 0,
                layer: this._surfaceLayerKey(ref),
            });
        };
        for (const m of this._collectAllies()) {
            addCandidate('ally', m);
        }
        const g = _game();
        if (g && g.entities) {
            for (const e of g.entities.values()) {
                if (!e || !e.active) continue;
                if (e._faction !== 'enemy' && e._faction !== 'agent') continue;
                if (FogOfWarSystem.shouldHideEntity(this._scene, e)) continue;
                addCandidate('enemy', e);
            }
        }
        if (!candidates.length) return null;

        const flat = !!g?.FlatViewSystem?.enabled;
        const selectedLayers = new Set(this._selection.map((entry) => this._surfaceLayerKey(entry.ref)));
        candidates.sort((left, right) => {
            if (flat && selectedLayers.size) {
                const leftSelected = selectedLayers.has(left.layer) ? 0 : 1;
                const rightSelected = selectedLayers.has(right.layer) ? 0 : 1;
                if (leftSelected !== rightSelected) return leftSelected - rightSelected;
            }
            const distanceDelta = left.distance - right.distance;
            if (Math.abs(distanceDelta) > 0.5) return distanceDelta;
            // 同一屏幕位置优先墙顶或较高单位。
            return right.z - left.z;
        });
        if (!flat || !cycle || candidates.length === 1) {
            return { kind: candidates[0].kind, ref: candidates[0].ref };
        }

        const candidateKey = (candidate) => `${candidate.kind}:${candidate.ref.id ?? candidate.ref.name ?? 'unit'}:${candidate.layer}`;
        const signature = candidates.map(candidateKey).sort().join('|');
        const now = Date.now();
        const previous = this._flatHitCycle;
        const sameCycle = previous
            && previous.signature === signature
            && now - previous.at <= 650
            && Math.hypot(sx - previous.x, sy - previous.y) <= 10;
        const order = sameCycle
            ? previous.order.filter((old) => candidates.some((candidate) => candidate.ref === old.ref && candidate.kind === old.kind))
            : candidates;
        const completeOrder = [
            ...order,
            ...candidates.filter((candidate) => !order.some((old) => old.ref === candidate.ref && old.kind === candidate.kind)),
        ];
        const index = sameCycle ? (previous.index + 1) % completeOrder.length : 0;
        this._flatHitCycle = { x: sx, y: sy, at: now, signature, order: completeOrder, index };
        return { kind: completeOrder[index].kind, ref: completeOrder[index].ref };
    },

    /** 指挥模式只允许单选一个军事产兵建筑；命中范围与既有建筑详情面板一致。 */
    _hitTroopProducerAt(sx, sy) {
        const point = Renderer.screenToWorld(sx, sy);
        if (!point) return null;
        let picked = null;
        let pickedScore = Infinity;
        for (const producer of TroopLineSystem.getLiveProducers()) {
            const visualX = producer.x + (producer._visualFootOffsetX || 0);
            const cfg = producer._cfg || producer.spriteCfg || {};
            const displayW = Number(cfg.displayW ?? cfg.size) || 170;
            const displayH = Number(cfg.displayH ?? cfg.sizeH) || 147;
            const hit = {
                cx: 0,
                cy: -Math.round(displayH * 0.4),
                hw: Math.round(displayW / 2),
                hh: Math.round(displayH * 0.44),
            };
            if (point.x < visualX + hit.cx - hit.hw || point.x > visualX + hit.cx + hit.hw
                || point.y < producer.y + hit.cy - hit.hh || point.y > producer.y + hit.cy + hit.hh) continue;
            const dx = (point.x - (visualX + hit.cx)) / Math.max(1, hit.hw);
            const dy = (point.y - (producer.y + hit.cy)) / Math.max(1, hit.hh);
            const score = dx * dx + dy * dy;
            if (score < pickedScore) {
                picked = producer;
                pickedScore = score;
            }
        }
        return picked ? { kind: 'producer', ref: picked } : null;
    },

    _buildingVisuals(entity) {
        const scene = _scene();
        if (!scene || !entity) return [];
        const neutral = scene._neutralSprites?.get?.(entity);
        const tower = scene._defenseSprites?.get?.(entity);
        return [...new Set([
            ...(Array.isArray(neutral?.segmentSprites) ? neutral.segmentSprites : []),
            neutral?.sprite,
            neutral?.overlaySprite,
            tower?.base,
            tower?.arm,
            tower?.weapon,
            entity._phaserSprite,
        ].filter((visual) => visual?.active && visual.visible !== false && Number(visual.alpha ?? 1) > 0))];
    },

    /** 按实际 Phaser 建筑贴图命中，轮廓与玩家看到的主体保持一致。 */
    _hitBuildingAt(sx, sy) {
        const g = _game();
        const point = Renderer.screenToWorld(sx, sy);
        if (!g?.entities || !point) return null;
        const hits = [];
        for (const entity of g.entities.values()) {
            if (!entity?.active || !entity._isDefenseStructure || Number(entity.hp) <= 0) continue;
            if (FogOfWarSystem.shouldHideEntity(this._scene, entity)) continue;
            for (const visual of this._buildingVisuals(entity)) {
                if (typeof visual.getBounds !== 'function') continue;
                const bounds = visual.getBounds();
                if (!bounds?.contains?.(point.x, point.y)) continue;
                const cx = Number(bounds.centerX) || (bounds.x + bounds.width * 0.5);
                const cy = Number(bounds.centerY) || (bounds.y + bounds.height * 0.5);
                hits.push({
                    entity,
                    depth: Number(visual.depth) || 0,
                    distance: Math.hypot(point.x - cx, point.y - cy),
                });
            }
        }
        hits.sort((left, right) => right.depth - left.depth || left.distance - right.distance);
        return hits[0]?.entity || null;
    },

    _syncBuildingHover(sx, sy) {
        const invalidPointer = this._pointerOverUi || !Number.isFinite(sx) || !Number.isFinite(sy)
            || !!_scene()?.minimapWorldPointAt?.(sx, sy);
        this._setHoverBuilding(invalidPointer ? null : this._hitBuildingAt(sx, sy));
    },

    _setHoverBuilding(building) {
        const next = building || null;
        if (this._hoverBuilding === next) return;
        this._hoverBuilding = next;
        this._applyCanvasCursor();
    },

    /** 只在普通移动语义下提示“可登高”；攻击移动、巡逻、集结和拖框各自保留原指令状态。 */
    _syncElevatedHover(sx, sy) {
        const selectedAllies = this._selection
            .filter((entry) => entry?.kind === 'ally' && entry.ref && entry.ref.active !== false)
            .map((entry) => entry.ref);
        const invalidPointer = this._pointerOverUi
            || !Number.isFinite(sx)
            || !Number.isFinite(sy)
            || selectedAllies.length === 0
            || !!this._commandPicking
            || this._rallyPicking
            || this._dragging
            || this._minimapDragging;
        if (invalidPointer) {
            this._setElevatedHover(null);
            return;
        }
        const point = this._resolveCommandPoint(sx, sy);
        if (point?.surfaceKind !== 'wall_walk') {
            this._setElevatedHover(null);
            return;
        }
        const reachable = this._isCommandPointRoutable(point, selectedAllies);
        this._setElevatedHover(reachable ? point : null);
    },

    _setElevatedHover(point) {
        const wasActive = !!this._hoverElevatedTarget;
        this._hoverElevatedTarget = point || null;
        if (wasActive !== !!this._hoverElevatedTarget) this._applyCanvasCursor();
    },

    /** GameScene 是唯一鼠标图形绘制方；这里仅公开已完成的 RTS 语义判定。 */
    elevatedCursorTarget() {
        return this.enabled ? this._hoverElevatedTarget : null;
    },

    _commandCursorAllies() {
        return (this.enabled
            ? this._selection
                .filter((entry) => entry?.kind === 'ally')
                .map((entry) => entry.ref)
            : this._commandBarAllies()
        ).filter((unit) => unit && unit.active !== false);
    },

    _isCommandPointRoutable(point, units) {
        if (!point || point.unreachable) return false;
        const candidates = (units || []).filter((unit) => unit && unit.active !== false
            && !this._isExplorationLocked(unit));
        if (!candidates.length) return false;
        return candidates.some((unit) => {
            const routed = this._movePointForUnit(unit, point);
            return !!routed && !routed.unreachable;
        });
    },

    _validatePickedCommand(mode, point, { queue = false, target = null } = {}) {
        if (!RTS_ORDER_UI[mode]?.target) {
            return { valid: false, point, reason: '未知指令' };
        }
        const allies = this._commandCursorAllies().filter((unit) => this.supportsCommand(unit, mode));
        if (!allies.length) return { valid: false, point, reason: '没有可接收指令的单位' };
        if (mode === 'attack') {
            if (!target?.active || target._dying || target.hp <= 0
                || FogOfWarSystem.shouldHideEntity(this._scene, target)) {
                return { valid: false, point, reason: '请在主画面点击可见敌人' };
            }
            // 攻击沿用目标实体，不把目标脚下不可站立的建筑/墙面当成移动门禁。
            return { valid: true, target, point: { x: target.x, y: target.y, z: Number(target.z) || 0 }, reason: '' };
        }
        if (!point || point.unreachable) {
            return { valid: false, point, reason: point?.reason || '目标不可达' };
        }
        // 采集选择的是资源搜索区域，不要求走到资源节点中心。
        if (mode !== 'gather' && !queue && !this._isCommandPointRoutable(point, allies)) {
            return { valid: false, point, reason: '选中单位均无法到达该位置' };
        }
        return { valid: true, point, reason: '' };
    },

    _validateRallyPoint(point, producer = null) {
        if (!point || point.unreachable) {
            return { valid: false, point, reason: point?.reason || '该位置无法集结' };
        }
        if (producer) {
            const reachable = this._producerRallyPoint(producer, point);
            if (!reachable || reachable.unreachable) {
                return {
                    valid: false,
                    point: reachable || point,
                    reason: reachable?.reason || '该位置无法从建筑出口到达',
                };
            }
            if (!TroopLineSystem.canSetProducerRally?.(producer, this._scene, reachable)) {
                return { valid: false, point: reachable, reason: '独立集结点设置失败' };
            }
            return { valid: true, point: reachable, reason: '' };
        }
        if (!TroopLineSystem.canSetRally?.(this._scene, point)) {
            return { valid: false, point, reason: '当前位面未接入传送网络' };
        }
        return { valid: true, point, reason: '' };
    },

    _canUnitAttackFromCursor(unit) {
        if (!unit || unit.active === false || unit._rtsCanAttack === false
            || this._isExplorationLocked(unit)) return false;
        if (this._isPlayerUnit(unit)) return typeof unit._rtsController?.issueAttack === 'function';
        return true;
    },

    /**
     * GameScene 的唯一游标仲裁输入。这里只返回指令语义，不直接写 canvas/body cursor。
     * 返回值与正式提交共用同一套目标解析和门禁，避免显示、点击两套判断漂移。
     */
    commandCursorState(sx, sy) {
        const hasModalCommand = !!this._commandPicking || this._rallyPicking;
        const hasProducerRally = this.enabled && !!this._selectedTroopProducer();
        if (!this.enabled && !hasModalCommand) return null;
        if (this._pointerOverUi) return (hasModalCommand || hasProducerRally) ? 'ui' : null;
        if (!Number.isFinite(sx) || !Number.isFinite(sy) || this._dragging || this._minimapDragging) {
            return null;
        }

        const point = this._resolveCommandPoint(sx, sy);
        if (this._commandPicking) {
            const hit = this._commandPicking === 'attack' && !point?.fromMinimap ? this._hitUnitAt(sx, sy) : null;
            const validation = this._validatePickedCommand(this._commandPicking, point, {
                queue: this._commandPickQueue, target: hit?.kind === 'enemy' ? hit.ref : null,
            });
            return validation.valid ? RTS_ORDER_UI[this._commandPicking].cursor : 'invalid';
        }
        if (this._rallyPicking) {
            return this._validateRallyPoint(point).valid ? 'rally' : 'invalid';
        }

        const producer = this._selectedTroopProducer();
        if (producer) {
            return this._validateRallyPoint(point, producer).valid ? 'rally' : 'invalid';
        }

        const allies = this._commandCursorAllies();
        if (!allies.length) return null;
        const hit = point?.fromMinimap ? null : this._hitUnitAt(sx, sy);
        if (hit?.kind === 'enemy') {
            return allies.some((unit) => this._canUnitAttackFromCursor(unit))
                ? 'attack_target'
                : 'invalid';
        }
        if (!point || point.unreachable) return 'invalid';
        const elevatedPoint = (point.surfaceKind && point.surfaceKind !== 'ground')
            || Number(point.z) > 0;
        if (elevatedPoint && !this._isCommandPointRoutable(point, allies)) return 'invalid';
        return null;
    },

    _applyCanvasCursor() {
        // 鼠标图形由 GameScene._syncCrosshair 每帧统一仲裁；RTS 只维护语义状态。
    },

    _surfaceLayerKey(entity) {
        if (!entity) return 'ground';
        const kind = entity._surfaceKind || ((Number(entity.z) || 0) > 1 ? 'elevated' : 'ground');
        if (kind === 'wall_walk') {
            const walls = Array.isArray(entity._surfaceWalls) && entity._surfaceWalls.length
                ? entity._surfaceWalls
                : [entity._surfaceWall].filter(Boolean);
            const wallIds = walls.map((wall) => wall?.id || wall?._topologyId || 'wall').sort().join(',');
            return `wall_walk:${wallIds || Math.round((Number(entity.z) || 0) / 8)}`;
        }
        if (kind === 'stairs') {
            const staircase = entity._surfaceStaircase;
            return `stairs:${staircase?.id || Math.round((Number(entity.z) || 0) / 8)}`;
        }
        return kind === 'ground' ? 'ground' : `${kind}:${Math.round((Number(entity.z) || 0) / 8)}`;
    },

    /** 可见单位点击/框选矩形覆盖身体，而不只认逻辑脚底小圆。 */
    _unitScreenRect(e) {
        if (!e) return null;
        const halfW = Math.max(
            (e.collisionRadius || e.groundRadius || 20) + 6,
            (e.collisionWidth || 0) * 0.5,
            (e.size || 0) * 0.5
        );
        const bodyH = Math.max(
            e.bodyHeight || 0,
            e.collisionHeight || 0,
            (e.size || 20) * 1.5,
            48
        );
        const bottomPad = Math.max(6, (e.groundRadius || e.collisionRadius || 20) * 0.35);
        const visualY = e.y - (Number(e.z) || 0);
        const a = Renderer.worldToScreen(e.x - halfW, visualY - bodyH);
        const b = Renderer.worldToScreen(e.x + halfW, visualY + bottomPad);
        if (!a || !b) return null;
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
        const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        return { x0, x1, y0, y1, cx: (x0 + x1) * 0.5, cy: (y0 + y1) * 0.5 };
    },

    _selectInRect(sx0, sy0, sx1, sy1) {
        const x0 = Math.min(sx0, sx1), y0 = Math.min(sy0, sy1);
        const x1 = Math.max(sx0, sx1), y1 = Math.max(sy0, sy1);
        const sel = [];
        for (const m of this._collectAllies()) {
            const r = this._unitScreenRect(m);
            if (r && r.x1 >= x0 && r.x0 <= x1 && r.y1 >= y0 && r.y0 <= y1) {
                sel.push({ kind: 'ally', ref: m });
            }
        }
        const g = _game();
        if (g && g.entities) {
            for (const e of g.entities.values()) {
                if (!e || !e.active) continue;
                if (e._faction !== 'enemy' && e._faction !== 'agent') continue;
                if (FogOfWarSystem.shouldHideEntity(this._scene, e)) continue;
                const r = this._unitScreenRect(e);
                if (r && r.x1 >= x0 && r.x0 <= x1 && r.y1 >= y0 && r.y0 <= y1) {
                    sel.push({ kind: 'enemy', ref: e });
                }
            }
        }
        return sel;
    },

    /** 建筑点击在指挥模式下忽略交互距离，并复用既有详情面板；保持指挥态与当前选择。 */
    _tryBuildingClick(sx, sy) {
        const g = _game();
        const p = g ? g.player : null;
        if (!g) return false;
        const openBefore = new Set(this._buildingDetailPanels().filter((panel) => panel.isOpen));
        const finishPanelSwitch = (preferredPanel = null) => {
            const newlyOpened = this._buildingDetailPanels().find((panel) => panel.isOpen && !openBefore.has(panel));
            const keepPanel = newlyOpened || (preferredPanel?.isOpen ? preferredPanel : null);
            this._closeBuildingUIExcept(keepPanel);
        };
        const prevBuild = g._buildMode;
        g._buildMode = true;
        try {
            if (g.DefenseSystem?.active && g.DefenseSystem.tryInteract?.(sx, sy, p)) {
                finishPanelSwitch(g.DefenseSystem._panel);
                return true;
            }
            if (g.HamsterHutSystem?.active && g.HamsterHutSystem.tryInteract?.(sx, sy, p)) {
                finishPanelSwitch(g.HamsterHutSystem._panel);
                return true;
            }
            if (g.ProducerBuildingSystem?.active && g.ProducerBuildingSystem.tryInteract?.(sx, sy, p)) {
                finishPanelSwitch(g.ProducerBuildingSystem._panel);
                return true;
            }
        } finally {
            g._buildMode = prevBuild;
        }
        // 掩体与铁栅栏门复用 BuildingSystem 详情。
        const bs = g.BuildingSystem;
        const mw = Renderer.screenToWorld(sx, sy);
        if (bs && mw && typeof bs._hitTestCover === 'function' && typeof bs._showDetail === 'function') {
            const hit = bs._hitTestCover(mw.x, mw.y);
            if (hit) {
                if (typeof bs.showRemoteDetail === 'function') bs.showRemoteDetail(hit);
                else bs._showDetail(hit);
                this._closeBuildingUIExcept(null, { keepStructureDetail: true });
                return true;
            }
        }
        return false;
    },

    // ==================== 榧犳爣浜嬩欢 ====================

    _isCommandable() {
        const g = _game();
        return (PERSISTENT_WORLDS.has(this._scene) || !!g?._observerMode)
            && TechnologySystem.isUnlocked('mechanic', 'rts_command');
    },

    _isPointerBlocked(e) {
        return !isGameplayPointerEvent(e);
    },

    /** RTS 的屏幕点只在这里转换一次；压平视图输出的就是物理地面坐标。 */
    _resolveCommandPoint(sx, sy) {
        const minimap = _scene()?.minimapWorldPointAt?.(sx, sy);
        if (minimap) return { ...minimap, z: 0, surfaceKind: 'ground', route: [], fromMinimap: true };
        const world = Renderer.screenToWorld(sx, sy);
        if (!world) return null;
        const game = _game();
        const defenseSystem = game?.DefenseSystem;
        return defenseSystem?.resolveSurfaceTarget
            ? defenseSystem.resolveSurfaceTarget(world.x, world.y, {
                coordinateSpace: game?.FlatViewSystem?.enabled ? 'physical' : 'screen',
            })
            : { x: world.x, y: world.y, z: 0, surfaceKind: 'ground', route: [] };
    },

    /** RTS 捕获右键后同步清掉 Input 边沿，确保一次点击只进入一个指令入口。 */
    _consumeRightCommandPointer(e) {
        const input = _game()?.Input || this._input();
        if (input?.mouse) {
            input.mouse.rightDown = false;
            input.mouse.rightPressed = false;
        }
        e?.preventDefault?.();
        e?.stopImmediatePropagation?.();
    },

    _onMouseDown(e) {
        if (_game()?._paused || TechnologyTreePanel.isOpen) return;
        const normalCommandPick = !this.enabled && this._commandPicking
            && this._commandBarAllies().length > 0;
        if ((!this.enabled || !this._isCommandable()) && !normalCommandPick) return;
        if (this._isPointerBlocked(e)) return;
        if (this._commandPicking && e.button === 2) {
            this._cancelCommandPick();
            if (normalCommandPick) this._consumeNormalCommandPointer = true;
            this._consumeRightCommandPointer(e);
            return;
        }
        if (this._commandPicking && e.button === 0) {
            this._commandPickQueue ||= e.shiftKey;
            this._down = true;
            this._downX = e.clientX;
            this._downY = e.clientY;
            this._dragging = false;
            if (normalCommandPick) this._consumeNormalCommandPointer = true;
            e.preventDefault();
            return;
        }
        if (e.button === 0 && this._tryMinimapCameraJump(e.clientX, e.clientY)) {
            this._minimapDragging = true;
            e.preventDefault();
            e.stopImmediatePropagation();
            this._clearDrag();
            return;
        }
        if (e.button === 2) {
            // 按下时固定目标，避免下一帧边缘卷屏改变同一次点击的世界位置。
            const point = this._resolveCommandPoint(e.clientX, e.clientY);
            this._pendingRightClick = { x: e.clientX, y: e.clientY, point,
                hit: point?.fromMinimap ? null : this._hitUnitAt(e.clientX, e.clientY), queue: e.shiftKey };
            this._consumeRightCommandPointer(e);
            return;
        }
        if (e.button !== 0) return;
        this._down = true;
        this._downX = e.clientX;
        this._downY = e.clientY;
        this._dragging = false;
    },

    _tryMinimapCameraJump(clientX, clientY, { clampToContent = false } = {}) {
        const scene = _scene();
        if (!scene || typeof scene.minimapWorldPointAt !== 'function') return false;
        const point = scene.minimapWorldPointAt(clientX, clientY, { clampToContent });
        if (!point) return false;
        Camera.x = point.x;
        Camera.y = point.y;
        scene._minimapNextAt = 0;
        return true;
    },

    _onMouseMove(e) {
        this._pointerOverUi = this._isPointerBlocked(e);
        if (this._minimapDragging) {
            this._tryMinimapCameraJump(e.clientX, e.clientY, { clampToContent: true });
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        const normalCommandPick = !this.enabled && this._commandPicking
            && this._commandBarAllies().length > 0;
        if (((!this.enabled || !this._isCommandable()) && !normalCommandPick) || !this._down) return;
        if (!this._dragging && Math.hypot(e.clientX - this._downX, e.clientY - this._downY) > DRAG_THRESHOLD) {
            this._dragging = true;
        }
        if (this._dragging) {
            this._dragX = e.clientX;
            this._dragY = e.clientY;
            this._renderSelectionFx();
        }
    },

    _onMouseUp(e) {
        if (this._minimapDragging) {
            if (e.button === 0) this._tryMinimapCameraJump(e.clientX, e.clientY, { clampToContent: true });
            this._minimapDragging = false;
            this._clearDrag();
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        const normalCommandPick = !this.enabled && this._commandPicking
            && this._commandBarAllies().length > 0;
        if (((!this.enabled || !this._isCommandable()) && !normalCommandPick) || !this._down) return;
        this._down = false;
        if (e.button !== 0) return;
        // 指令必须在游戏画面内完成。若从画面拖到任意 DOM 栏目后松开，取消本次
        // 指针过程但保留待选指令，避免把栏目坐标转换成世界攻击/巡逻目标。
        if (this._isPointerBlocked(e)) {
            this._clearDrag();
            return;
        }
        if (this._commandPicking) {
            const mode = this._commandPicking;
            const queue = this._commandPickQueue || e.shiftKey;
            this._commandPicking = null;
            this._commandPickQueue = false;
            if (!this._dragging) this._issuePickedCommand(mode, e.clientX, e.clientY, { queue });
            if (normalCommandPick) this._consumeNormalCommandPointer = true;
            this._clearDrag();
            this._commandBarSig = '';
            this._refreshCommandBar();
            e.preventDefault();
            return;
        }
        if (this._dragging) {
            this._applyPointerSelection(this._selectInRect(this._downX, this._downY, e.clientX, e.clientY), e);
        } else {
            // 单击单位（双击同类全选）、建筑，或点击空地取消。
            const hit = this._hitUnitAt(e.clientX, e.clientY, { cycle: true });
            if (hit) {
                const now = Date.now();
                const dbl = !e.shiftKey && !e.ctrlKey && !e.metaKey
                    && this._lastClick && now - this._lastClick.at <= 350 && this._lastClick.ref === hit.ref;
                this._lastClick = { at: now, ref: hit.ref };
                if (dbl && hit.kind === 'ally') {
                    this._selectSameTypeOnScreen(hit.ref);
                } else {
                    this._applyPointerSelection([hit], e, true);
                }
            } else {
                if (e.shiftKey || e.ctrlKey || e.metaKey) { this._clearDrag(); return; }
                const producer = this._hitTroopProducerAt(e.clientX, e.clientY);
                if (producer) {
                    this._lastClick = null;
                    this._setSelection([producer], { preserveBuildingUI: true });
                    this._tryBuildingClick(e.clientX, e.clientY);
                } else if (this._tryBuildingClick(e.clientX, e.clientY)) {
                    // 打开非产兵建筑界面时关闭单位/复数面板，保留选择。
                    this._hidePanel();
                } else {
                    this._closeBuildingUI();
                    this._clearSelection();
                    this._hidePanel();
                }
            }
        }
        this._clearDrag();
    },

    _issuePickedCommand(mode, sx, sy, options = {}) {
        const point = this._resolveCommandPoint(sx, sy);
        const hit = mode === 'attack' && !point?.fromMinimap ? this._hitUnitAt(sx, sy) : null;
        const target = hit?.kind === 'enemy' ? hit.ref : null;
        const validation = this._validatePickedCommand(mode, point, { ...options, target });
        if (!validation.valid) {
            const rejectedPoint = validation.point || point;
            if (!rejectedPoint) return 0;
            EffectManager.add(new FloatingTextEffect(
                rejectedPoint.x,
                rejectedPoint.y - (rejectedPoint.z || 0),
                validation.reason || '目标不可达',
                '#ff8855'
            ));
            return 0;
        }
        const commandPoint = validation.point;
        const commanded = this._issueCommandToAllies(mode, mode === 'attack' ? null : commandPoint, target, options);
        if (commanded > 0) {
            if (mode === 'attack') this._flashAttackTarget(target);
            if (mode === 'attack' || mode === 'move') {
                _game()?.FlatViewSystem?.notifyCommandTarget?.(mode, target || commandPoint, this._commandCursorAllies());
            }
            _scene()?.showMoveMarker?.(
                commandPoint.x,
                commandPoint.y,
                commandPoint.z,
                commandPoint.renderDepth
            );
            const label = RTS_ORDER_UI[mode].name;
            EffectManager.add(new FloatingTextEffect(
                commandPoint.x,
                commandPoint.y - (Number(commandPoint.z) || 0) - 36,
                `${label}（${commanded} 单位）`,
                mode === 'attack' || mode === 'attack_move' ? '#ff9d9d' : '#c9d4dc'
            ));
        } else {
            EffectManager.add(new FloatingTextEffect(
                commandPoint.x,
                commandPoint.y - (Number(commandPoint.z) || 0),
                this._lastCommandRejectReason || '选中单位均未接受该指令',
                '#ff8855'
            ));
        }
        return commanded;
    },

    _clearDrag() {
        this._down = false;
        this._dragging = false;
        if (this._boxG) this._boxG.clear();
    },

    // ==================== 边缘平移 / 双击复选 / 编队 ====================

    /** 边缘平移：鼠标贴近屏幕四缘时平移相机。 */
    _edgePan(dt, Input) {
        if (this._minimapDragging) return;
        const input = Input || this._input();
        const m = input && input.mouse;
        if (!this._mouseSeen) return;
        if (this._pointerOverUi) return;
        if (!m || typeof m.x !== 'number') return;
        if (_scene()?.minimapWorldPointAt?.(m.x, m.y)) return;
        const g = _game();
        if (!g) return;
        const w = window.innerWidth, h = window.innerHeight;
        const EDGE = 24;
        let dx = 0, dy = 0;
        if (m.x <= EDGE) dx -= 1;
        if (m.x >= w - EDGE) dx += 1;
        if (m.y <= EDGE) dy -= 1;
        if (m.y >= h - EDGE) dy += 1;
        if (!dx && !dy) return;
        const step = 900 * (dt || 16.7) / 1000;
        const W = CONFIG.WORLD_WIDTH || 4096;
        const H = CONFIG.WORLD_HEIGHT || 4096;
        Camera.x = Math.max(0, Math.min(W, Camera.x + dx * step));
        Camera.y = Math.max(0, Math.min(H, Camera.y + dy * step));

    },

    /** 编队键：Ctrl+数字编队，Shift+数字追加，数字选中。 */
    _onKeyDown(e) {
        if (UIState.isOpen('worldSwitch') || UIState.isOpen('strategicExpedition')) return;
        if (TechnologyTreePanel.isOpen || _game()?._paused) return;
        if (e.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
        if (e.code === CONFIG.KEYS.RTS_COMMAND) {
            if (!this.enabled && !this._isCommandable()) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!e.repeat && (this.enabled || this._isCommandable())) {
                this.setEnabled(!this.enabled);
            }
            return;
        }
        if (!this.enabled) {
            if (this._commandPicking && e.code === 'Escape') {
                this.cancelPendingCommand();
                e.preventDefault();
                e.stopImmediatePropagation();
            }
            return;
        }
        const g = _game();
        if (!g || !(g._observerMode || PERSISTENT_WORLDS.has(this._scene))) return;
        if ((this._rallyPicking || this._commandPicking) && e.code === 'Escape') {
            this.cancelPendingCommand();
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        const order = !e.ctrlKey && !e.metaKey && !e.altKey
            ? Object.keys(ORDER_HOTKEYS).find((mode) => ORDER_HOTKEYS[mode] === e.code) : null;
        if (order) {
            (_game()?.Input || this._input())?.keys?.delete(e.code);
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.repeat) return;
            if (order === 'attack_move' || order === 'patrol') this._beginCommandPick(order, e.shiftKey);
            else {
                this.cancelPendingCommand();
                this.issueWheelCommand(order);
            }
            return;
        }
        const m = /^Digit([0-9])$/.exec(e.code);
        if (!m) return;
        if (e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        (_game()?.Input || this._input())?.keys?.delete(e.code);
        const d = m[1];
        if (e.ctrlKey || e.metaKey) {
            this._lastGroupRecall = null;
            const ids = this._selection.filter((s) => s.kind === 'ally')
                .map((s) => this._commandUnitId(s.ref)).filter(Boolean);
            if (!ids.length) return;
            this._groups.set(d, [...new Set(ids)]);
            this._groupNotify(d, ids.length, '编入');
            e.preventDefault(); e.stopImmediatePropagation();
        } else if (e.shiftKey) {
            this._lastGroupRecall = null;
            const add = this._selection.filter((s) => s.kind === 'ally')
                .map((s) => this._commandUnitId(s.ref)).filter(Boolean);
            if (!add.length) return;
            const cur = (this._groups.get(d) || []).map((entry) => (
                typeof entry === 'string' ? entry : entry?.id
            )).filter(Boolean);
            const merged = [...new Set([...cur, ...add])];
            this._groups.set(d, merged);
            this._groupNotify(d, merged.length, '加编');
            e.preventDefault(); e.stopImmediatePropagation();
        } else {
            const grp = this._resolveGroupUnits(this._groups.get(d) || []);
            if (!grp.length) return;
            this._groups.set(d, grp.map((unit) => this._commandUnitId(unit)).filter(Boolean));
            this._setSelection(grp.map((ref) => ({ kind: 'ally', ref })));
            const now = Date.now();
            if (this._lastGroupRecall?.digit === d && now - this._lastGroupRecall.at <= 350) {
                Camera.x = grp.reduce((sum, unit) => sum + unit.x, 0) / grp.length;
                Camera.y = grp.reduce((sum, unit) => sum + unit.y
                    - (_game()?.FlatViewSystem?.enabled ? 0 : Number(unit.z) || 0), 0) / grp.length;
                this._lastGroupRecall = null;
            } else this._lastGroupRecall = { digit: d, at: now };
            this._groupNotify(d, grp.length, '选中');
            e.preventDefault(); e.stopImmediatePropagation();
        }
    },

    _groupNotify(digit, n, verb) {
        EffectManager.add(new FloatingTextEffect(Camera.x, Camera.y - 120, `${verb}编队 ${digit}（${n} 单位）`, '#8ad0ff'));
    },

    _resolveGroupUnits(entries) {
        const allies = new Map(this._collectAllies()
            .filter((unit) => unit?.active && this._commandUnitId(unit))
            .map((unit) => [this._commandUnitId(unit), unit]));
        return entries.map((entry) => allies.get(typeof entry === 'string' ? entry : entry?.id))
            .filter(Boolean);
    },

    /** 双击同类复选：选中屏幕上所有同类型友军。 */
    _selectSameTypeOnScreen(ref) {
        const key = this._unitTypeKey(ref);
        if (!key) { this._setSelection([{ kind: 'ally', ref }]); return; }
        const vw = window.innerWidth, vh = window.innerHeight;
        const list = [];
        for (const u of this._collectAllies()) {
            if (this._unitTypeKey(u) !== key) continue;
            const r = this._unitScreenRect(u);
            if (!r) continue;
            if (r.x1 < 0 || r.y1 < 0 || r.x0 > vw || r.y0 > vh) continue;
            list.push({ kind: 'ally', ref: u });
        }
        if (!list.some((s) => s.ref === ref)) list.push({ kind: 'ally', ref });
        this._setSelection(list);
    },

    /** 单位类型键：仓鼠兵种用全局登记表，队员回退档案 id */
    _unitTypeKey(u) {
        if (this._isPlayerUnit(u)) return '__player__';
        return getUnitKind(u) || u.configId || u.id || u.name || null;
    },

    /** 指挥模式轮盘统一出口前置判定：有友军选中即可 */
    hasAllySelection() {
        return this._selection.some((s) => s.kind === 'ally');
    },

    /** 轮盘指令统一出口：队友走 PartySystem，其他友军按映射写入 _command。 */
    issueWheelCommand(mode, point, options = {}) {
        return this._dispatchCommands(options.units || this._commandBarAllies(), mode, point, null, options);
    },

    supportsCommand(unit, mode) {
        return !this._commandRejectReason(unit, mode);
    },

    _commandRejectReason(unit, mode) {
        if (!unit?.active || unit._dying || unit.hp <= 0) return '单位已不可用';
        if (this._isExplorationLocked(unit)) return '探险中，仅可使用停止探险指令';
        if (this._isPlayerUnit(unit)) {
            if (!['move', 'attack', 'hold', 'stop'].includes(mode)) return '玩家暂不支持该指令';
            if (!unit._rtsController) return '玩家控制器未就绪';
        }
        if (mode === 'attack' && unit._rtsCanAttack === false) return '该单位不能攻击';
        if (mode === 'explore' && (!unit._isHamsterExplorer || !canExploreScene(this._scene))) {
            return '该单位或当前位面不支持探险';
        }
        if (mode === 'gather' && !PartySystem.members.includes(unit) && !unit._isHamsterMiner) {
            return '该单位不能采集';
        }
        return null;
    },

    _orderToken(unit) {
        return unit._rtsTacticalOrder || unit._rtsController?.command || unit._command;
    },

    _queueOwnsCommand(unit, entry) {
        const current = this._orderToken(unit);
        if (!entry.current) return current === entry.idleCommand || !!current?._guardFromHold;
        const completed = unit._rtsCompletedCommand;
        return current === entry.current
            || (completed?.command === entry.current && completed.result === current);
    },

    _dispatchCommands(units, mode, point, target, { queue = false } = {}) {
        mode = mode === 'aggressive' ? 'attack_move' : mode;
        const all = [...new Set(units)].filter(Boolean);
        const moving = mode === 'move' || RtsTacticalOrderSystem.isOrderMode(mode);
        const eligible = all.filter((unit) => this.supportsCommand(unit, mode));
        const slots = moving ? this._formationMovePoints(eligible, point) : new Map();
        const reservations = slots.size ? [] : null;
        let accepted = 0;
        this._lastCommandRejectReason = null;
        for (const unit of all) {
            const reason = this._commandRejectReason(unit, mode);
            if (reason) { this._lastCommandRejectReason ||= reason; continue; }
            const destination = slots.get(unit) || point;
            const current = this._orderToken(unit);
            let entry = this._orderQueues.get(unit);
            if (entry && !this._queueOwnsCommand(unit, entry)) entry = null;
            const busy = entry?.orders.length || (current && (unit._rtsTacticalOrder
                || (current.mode !== 'hold' && current.mode !== 'follow' && !current._guardFromHold)));
            if (queue && QUEUED_MODES.has(mode) && busy) {
                if (moving && !destination) { this._lastCommandRejectReason ||= '缺少目标位置'; continue; }
                entry ||= { current, orders: [], sceneId: this._scene };
                const limit = Math.max(1, Number(GAME_CONFIG.rtsCommand?.commandQueueLimit) || 32);
                if (entry.orders.length >= limit) {
                    this._lastCommandRejectReason ||= `指令队列已满（最多 ${limit} 条）`;
                    continue;
                }
                // 不预先寻路或占位；同批命令只共享各单位实际执行后接受的地面终点。
                const semantic = destination ? {
                    x: destination.x, y: destination.y, z: Number(destination.z) || 0,
                    surfaceKind: destination.surfaceKind || 'ground',
                    wallId: destination.wallId, staircaseId: destination.staircaseId,
                    stairGroupId: destination.stairGroupId, formationSlot: destination.formationSlot,
                } : null;
                entry.orders.push({ mode, point: semantic, target, formationReservations: reservations });
                this._orderQueues.set(unit, entry);
                accepted++;
                continue;
            }
            if (!this._dispatchUnitCommand(unit, mode, destination, target, reservations)) continue;
            this._orderQueues.delete(unit);
            delete unit._rtsCompletedCommand;
            accepted++;
        }
        this._commandBarSig = '';
        if (accepted > 0 && accepted < all.length) {
            EffectManager.add(new FloatingTextEffect(Camera.x, Camera.y - 110,
                `已接受 ${accepted}/${all.length}：${this._lastCommandRejectReason || '部分单位不可用'}`, '#ffcf78'));
        } else if (queue && accepted > 0) {
            EffectManager.add(new FloatingTextEffect(Camera.x, Camera.y - 110,
                `追加指令（${accepted} 单位；空闲单位立即执行）`, '#8ad0ff'));
        }
        return accepted;
    },

    _dispatchUnitCommand(unit, mode, point, target, reservations = null) {
        const reservationStart = reservations?.length || 0;
        const accepted = this._applyUnitCommand(unit, mode, point, target, reservations);
        if (reservations && reservations.length > reservationStart) {
            if (!accepted) reservations.splice(reservationStart);
            else {
                const command = this._orderToken(unit);
                for (let i = reservationStart; i < reservations.length; i++) {
                    Object.assign(reservations[i], { unit, command });
                }
            }
        }
        return accepted;
    },

    _applyUnitCommand(unit, mode, point, target, reservations = null) {
        const reject = this._commandRejectReason(unit, mode);
        if (reject) { this._lastCommandRejectReason = reject; return false; }
        if (mode === 'attack' && (!target?.active || target.hp <= 0
            || FogOfWarSystem.shouldHideEntity(this._scene, target))) {
            this._lastCommandRejectReason = '攻击目标已失效或不可见';
            return false;
        }
        const tactical = RtsTacticalOrderSystem.isOrderMode(mode);
        const destination = mode === 'move' || tactical
            ? this._movePointForUnit(unit, point, reservations) : point;
        if ((mode === 'move' || tactical) && (!destination || destination.unreachable)) {
            this._lastCommandRejectReason = destination?.reason || '目标不可达';
            return false;
        }
        // 至此新命令已经通过全部检查；拒绝命令不会取消原动作、巡逻或队列。
        if (this._isPlayerUnit(unit)) {
            if (mode === 'attack') return !!unit._rtsController.issueAttack(target);
            if (mode === 'move') return !!unit._rtsController.issueMove(destination);
            unit._rtsController.hold();
            return true;
        }
        unit._ai?.cancelForCommand?.(mode);
        let accepted;
        if (PartySystem.members.includes(unit)) {
            accepted = PartySystem.setCommand(unit.id, mode === 'stop' ? 'hold' : mode, destination, target) > 0;
        } else if (tactical) {
            accepted = RtsTacticalOrderSystem.issue(unit, mode, destination);
        } else {
            RtsTacticalOrderSystem.clear(unit);
            unit._command = {
                mode: mode === 'stop' ? 'hold' : (mode === 'gather' && unit._isHamsterMiner ? 'follow' : mode),
                point: destination ? { ...destination,
                    route: (destination.route || []).map((step) => ({ ...step })) } : null,
                target: mode === 'attack' ? target : null,
            };
            accepted = true;
        }
        if (!accepted) return false;
        delete unit._troopLineTransit;
        delete unit._troopLineRally;
        if (mode === 'stop') unit._command._rtsStop = true;
        if (mode === 'stop' || mode === 'hold') {
            unit.target = null;
            unit._tacticalTarget = null;
            unit._pathManager?._clearPath?.();
            unit.vx = 0;
            unit.vy = 0;
            unit.maxSpeed = 0;
            unit.isMoving = false;
        }
        return true;
    },

    _advanceCommandQueues() {
        const game = _game();
        for (const [unit, entry] of this._orderQueues) {
            if (entry.sceneId !== this._scene || !unit.active || unit.hp <= 0 || unit._dying
                || !(game?.entities?.get(unit.id) === unit || PartySystem.members.includes(unit)
                    || (this._isPlayerUnit(unit) && game?.entities?.get('player') === unit))
                || (this._isPlayerUnit(unit) && !this.enabled)) {
                this._orderQueues.delete(unit);
                continue;
            }
            if (!this._queueOwnsCommand(unit, entry)) {
                this._orderQueues.delete(unit);
                continue;
            }
            if (entry.current) {
                const completed = unit._rtsCompletedCommand;
                if (completed?.command === entry.current) {
                    if (completed.failed) {
                        EffectManager.add(new FloatingTextEffect(unit.x, unit.y - (unit.z || 0) - 48,
                            `跳过队列指令：${completed.reason || '目标不可达'}`, '#ff8855'));
                    }
                    delete unit._rtsCompletedCommand;
                    entry.idleCommand = this._orderToken(unit);
                    entry.current = null;
                } else {
                    continue;
                }
            }
            const next = entry.orders.shift();
            if (!next) { this._orderQueues.delete(unit); continue; }
            const reservations = next.formationReservations || null;
            this._pruneFormationReservations(reservations);
            if (this._dispatchUnitCommand(unit, next.mode, next.point, next.target, reservations)) {
                entry.current = this._orderToken(unit);
                delete unit._rtsCompletedCommand;
            } else {
                EffectManager.add(new FloatingTextEffect(unit.x, unit.y - (unit.z || 0) - 48,
                    `跳过队列指令：${this._lastCommandRejectReason || '目标不可达'}`, '#ff8855'));
            }
            if (!entry.orders.length) this._orderQueues.delete(unit);
            this._commandBarSig = '';
        }
    },

    /** 只在下一条群体移动开始时回收预约，兼容同批单位跨帧执行，不增加逐帧队形调整。 */
    _pruneFormationReservations(reservations) {
        if (!reservations) return;
        const game = _game();
        for (let i = reservations.length - 1; i >= 0; i--) {
            const reserved = reservations[i];
            const unit = reserved.unit;
            const present = unit?.active && !unit._dying && unit.hp > 0
                && (game?.entities?.get(unit.id) === unit || PartySystem.members.includes(unit)
                    || (this._isPlayerUnit(unit) && game?.entities?.get('player') === unit));
            // 仍在执行该目标的单位预留终点；已经到位的单位在离开前继续占用。
            const atPoint = present && (!unit._surfaceKind || unit._surfaceKind === 'ground')
                && Math.abs(Number(unit.z) || 0) <= 12
                && Math.hypot(unit.x - reserved.x, unit.y - reserved.y) <= Math.max(12, reserved.radius);
            if (!present || (this._orderToken(unit) !== reserved.command && !atPoint)) {
                reservations.splice(i, 1);
            }
        }
    },

    /** 探险锁定状态的唯一人工退出入口。 */
    stopSelectedExplorers() {
        let stopped = 0;
        for (const selected of this._selection) {
            const unit = selected.kind === 'ally' ? selected.ref : null;
            if (!this._isExplorationLocked(unit)) continue;
            RtsTacticalOrderSystem.clear(unit);
            if (unit._ai?.stopExploration?.()) stopped++;
        }
        return stopped;
    },

    _isExplorationLocked(unit) {
        return !!(unit?._isHamsterExplorer
            && (unit._exploreActive || unit._command?.mode === 'explore'));
    },

    /** 右键空地移动选中友军，右键敌方目标发起进攻。 */
    _handleRightClick(sx, sy, options = {}) {
        const point = 'point' in options ? options.point : this._resolveCommandPoint(sx, sy);
        if (!point) {
            this._cancelRallyPick();
            return;
        }
        if (this._rallyPicking) {
            const validation = this._validateRallyPoint(point);
            if (!validation.valid) {
                const rejectedPoint = validation.point || point;
                EffectManager.add(new FloatingTextEffect(
                    rejectedPoint.x,
                    rejectedPoint.y - (rejectedPoint.z || 0),
                    validation.reason || '该位置无法集结',
                    '#ff8855'
                ));
                this._cancelRallyPick();
                return;
            }
            const rallyPoint = validation.point;
            if (!TroopLineSystem.setRally(this._scene, rallyPoint)) {
                EffectManager.add(new FloatingTextEffect(
                    rallyPoint.x,
                    rallyPoint.y - (rallyPoint.z || 0),
                    '当前位面未接入传送网络',
                    '#ff8855'
                ));
                this._cancelRallyPick();
                return;
            }
            this._rallyPicking = false;
            this._refreshTroopLinePanel(true);
            EffectManager.add(new FloatingTextEffect(
                rallyPoint.x,
                rallyPoint.y - (rallyPoint.z || 0),
                '集结点已保存',
                '#8ad0ff'
            ));
            return;
        }
        const producer = this._selectedTroopProducer();
        if (producer) {
            if (!TechnologySystem.isUnlocked('mechanic', 'troop_rally')) {
                EffectManager.add(new FloatingTextEffect(producer.x, producer.y - 64, '需要先研发集结战术', '#ffb35c'));
                return;
            }
            const validation = this._validateRallyPoint(point, producer);
            const reachable = validation.point || point;
            if (!validation.valid) {
                EffectManager.add(new FloatingTextEffect(
                    reachable.x,
                    reachable.y - (reachable.z || 0),
                    validation.reason || '该位置无法从建筑出口到达',
                    '#ff8855'
                ));
                return;
            }
            if (!TroopLineSystem.setProducerRally(producer, this._scene, reachable)) {
                EffectManager.add(new FloatingTextEffect(
                    reachable.x,
                    reachable.y - (reachable.z || 0),
                    '独立集结点设置失败',
                    '#ff8855'
                ));
                return;
            }
            EffectManager.add(new FloatingTextEffect(
                reachable.x,
                reachable.y - (reachable.z || 0),
                '独立集结点已设置',
                '#f0cf78'
            ));
            this._domSig = null;
            this._refreshPanel();
            this._refreshTroopLinePanel(true);
            return;
        }
        const hit = point.fromMinimap ? null : ('hit' in options ? options.hit : this._hitUnitAt(sx, sy));
        const phaser = _scene();
        if (hit && hit.kind === 'enemy') {
            if (this._selection.some((s) => s.kind === 'ally')) {
                const attackers = this._issueCommandToAllies('attack', null, hit.ref, options);
                if (attackers > 0) {
                    this._flashAttackTarget(hit.ref);
                    _game()?.FlatViewSystem?.notifyCommandTarget?.(
                        'attack',
                        hit.ref,
                        this._selection.filter((s) => s.kind === 'ally').map((s) => s.ref)
                    );
                    if (phaser && typeof phaser.showMoveMarker === 'function') {
                        phaser.showMoveMarker(
                            hit.ref.x,
                            hit.ref.y,
                            hit.ref.z,
                            hit.ref._surfaceRenderDepth
                        );
                    }
                } else {
                    EffectManager.add(new FloatingTextEffect(
                        hit.ref.x,
                        hit.ref.y - (Number(hit.ref.z) || 0),
                        this._lastCommandRejectReason || '选中单位无法攻击',
                        '#ff8855'
                    ));
                }
            } else {
                // 无友军选中时，右键敌人仅选中并查看属性。
                this._setSelection([hit]);
            }
        } else if (this._selection.some((s) => s.kind === 'ally')) {
            if (point.unreachable) {
                EffectManager.add(new FloatingTextEffect(
                    point.x,
                    point.y - (point.z || 0),
                    point.reason || '目标不可达',
                    '#ff8855'
                ));
                return;
            }
            const commanded = this._issueCommandToAllies('move', point, null, options);
            if (commanded > 0) {
                _game()?.FlatViewSystem?.notifyCommandTarget?.(
                    'move',
                    point,
                    this._selection.filter((s) => s.kind === 'ally').map((s) => s.ref)
                );
                if (phaser && typeof phaser.showMoveMarker === 'function') {
                    phaser.showMoveMarker(point.x, point.y, point.z, point.renderDepth);
                }
            } else if (commanded === 0 && this._lastCommandRejectReason) {
                EffectManager.add(new FloatingTextEffect(
                    point.x,
                    point.y - (point.z || 0),
                    this._lastCommandRejectReason,
                    '#ff8855'
                ));
            }
        }
    },

    /** 命令下发到所有选中友军：组队侍从走 PartySystem（CompanionAI 消费），
     * 仓鼠等非成员单位直接写入 _command。 */
    _issueCommandToAllies(mode, point, target, options = {}) {
        return this._dispatchCommands(this._commandCursorAllies(), mode, point, target, options);
    },

    _movePointForUnit(unit, point, groundReservations = null) {
        if (!point) return point;
        let resolvedPoint = point;
        let pendingReservation = null;
        const route = Array.isArray(point.route) ? point.route : [];
        const isGroundPoint = route.length === 0
            && (!point.surfaceKind || point.surfaceKind === 'ground')
            && !(Number(point.z) > 0);
        if (isGroundPoint && pathFinder?.findNearestWalkablePoint) {
            pathFinder.syncEntityFootprintObstacles?.(_game()?.entities);
            const radius = Number(unit?.groundRadius) || Number(unit?.collisionRadius) || 20;
            const projected = this._formationGroundPoint(point, radius, groundReservations);
            if (!projected) {
                const reason = groundReservations
                    ? '目标附近没有足够的编队空间'
                    : '目标附近没有可站立位置';
                return { ...point, unreachable: true, reason };
            }
            resolvedPoint = { ...point, x: projected.x, y: projected.y, route: [] };
            if (groundReservations) pendingReservation = { x: projected.x, y: projected.y, radius };
        }
        const defenseSystem = _game()?.DefenseSystem;
        const routedPoint = defenseSystem?.routeSurfaceMoveForUnit
            ? defenseSystem.routeSurfaceMoveForUnit(unit, resolvedPoint)
            : resolvedPoint;
        if (pendingReservation && !routedPoint?.unreachable) groundReservations.push(pendingReservation);
        return routedPoint;
    },

    _formationGroundPoint(point, radius, reservations) {
        const projected = pathFinder.findNearestWalkablePoint(point.x, point.y, radius, 360);
        if (!projected || !reservations) return projected;
        const conflicts = (candidate) => reservations.some((reserved) => {
            const safeDistance = radius + reserved.radius + 16;
            return Math.hypot(candidate.x - reserved.x, candidate.y - reserved.y) < safeDistance;
        });
        if (!conflicts(projected)) return projected;

        // 只在下令瞬间围绕原槽位寻找替代点；不建立逐帧队形约束或共享路径。
        const step = Math.max(40, radius * 2 + 16);
        const phase = reservations.length * Math.PI * (3 - Math.sqrt(5));
        for (let distance = step; distance <= 360; distance += step) {
            const samples = Math.max(12, Math.ceil(Math.PI * 2 * distance / step));
            for (let sample = 0; sample < samples; sample++) {
                const angle = phase + sample / samples * Math.PI * 2;
                const candidate = {
                    x: point.x + Math.cos(angle) * distance,
                    y: point.y + Math.sin(angle) * distance,
                };
                if (pathFinder.isPointBlocked?.(candidate.x, candidate.y, radius)) continue;
                if (!conflicts(candidate)) return candidate;
            }
        }
        return null;
    },

    /**
     * 多选地面移动在下令时一次性分配朝向目的地的方阵槽位。
     * 不维持逐帧刚性队形：各单位仍独立寻路、避障，受阻后在终点重新成阵。
     * 高架目标继续由统一高架导航逐单位规划，不改写楼梯/墙顶路线。
     */
    _formationMovePoints(units, point) {
        const result = new Map();
        const validUnits = [...new Set(units)].filter((unit) => unit?.active !== false);
        if (!point || validUnits.length <= 1) return result;
        const route = Array.isArray(point.route) ? point.route : [];
        if (route.length > 0 || (point.surfaceKind && point.surfaceKind !== 'ground') || Number(point.z) > 0) {
            return result;
        }

        const maxRadius = validUnits.reduce((max, unit) => Math.max(
            max,
            Number(unit.groundRadius) || Number(unit.collisionRadius) || 20
        ), 20);
        const spacing = Math.max(56, maxRadius * 2 + 16);
        const center = validUnits.reduce((sum, unit) => ({
            x: sum.x + (Number(unit.x) || 0),
            y: sum.y + (Number(unit.y) || 0),
        }), { x: 0, y: 0 });
        center.x /= validUnits.length;
        center.y /= validUnits.length;

        // 在真实地面 u/v 坐标中确定前进轴，避免屏幕 Y 压缩把方阵视觉拉斜。
        const travel = worldDeltaToIsoLocal(point.x - center.x, point.y - center.y);
        const travelLength = Math.hypot(travel.u, travel.v);
        const forward = travelLength > 1
            ? { u: travel.u / travelLength, v: travel.v / travelLength }
            : { u: Math.SQRT1_2, v: Math.SQRT1_2 };
        const lateral = { u: -forward.v, v: forward.u };
        const columns = Math.ceil(Math.sqrt(validUnits.length));
        const rows = Math.ceil(validUnits.length / columns);
        const slots = [];

        for (let row = 0, remaining = validUnits.length; row < rows; row++) {
            const rowCount = Math.min(columns, remaining);
            const forwardOffset = ((rows - 1) * 0.5 - row) * spacing;
            for (let column = 0; column < rowCount; column++) {
                const lateralOffset = (column - (rowCount - 1) * 0.5) * spacing;
                slots.push({ forwardOffset, lateralOffset });
            }
            remaining -= rowCount;
        }

        // 末排不满时仍让整个方阵的几何中心精确落在玩家点击点。
        const meanForward = slots.reduce((sum, slot) => sum + slot.forwardOffset, 0) / slots.length;
        const meanLateral = slots.reduce((sum, slot) => sum + slot.lateralOffset, 0) / slots.length;
        for (const slot of slots) {
            slot.forwardOffset -= meanForward;
            slot.lateralOffset -= meanLateral;
            const delta = isoLocalToWorldDelta(
                forward.u * slot.forwardOffset + lateral.u * slot.lateralOffset,
                forward.v * slot.forwardOffset + lateral.v * slot.lateralOffset
            );
            slot.point = { ...point, x: point.x + delta.x, y: point.y + delta.y, route: [] };
        }

        // 中心槽优先，逐槽选择最近单位。O(n^2) 仅在下令瞬间执行，减少换位交叉且无每帧成本。
        slots.sort((left, right) => {
            const leftCenter = left.forwardOffset ** 2 + left.lateralOffset ** 2;
            const rightCenter = right.forwardOffset ** 2 + right.lateralOffset ** 2;
            return leftCenter - rightCenter
                || right.forwardOffset - left.forwardOffset
                || left.lateralOffset - right.lateralOffset;
        });
        const remainingUnits = validUnits.slice().sort((left, right) =>
            String(this._commandUnitId(left) || '').localeCompare(String(this._commandUnitId(right) || ''))
        );
        for (const slot of slots) {
            let bestIndex = 0;
            let bestDistanceSq = Infinity;
            for (let i = 0; i < remainingUnits.length; i++) {
                const unit = remainingUnits[i];
                const dx = slot.point.x - unit.x;
                const dy = slot.point.y - unit.y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq < bestDistanceSq) {
                    bestDistanceSq = distanceSq;
                    bestIndex = i;
                }
            }
            const unit = remainingUnits.splice(bestIndex, 1)[0];
            if (unit) result.set(unit, slot.point);
        }
        return result;
    },

    _selectedTroopProducer() {
        if (this._selection.length !== 1 || this._selection[0].kind !== 'producer') return null;
        const producer = this._selection[0].ref;
        return TroopLineSystem.isTroopProducer(producer) && producer.active !== false ? producer : null;
    },

    /** 同时校验高架路线和建筑出口到路线入口的地面连通性。 */
    _producerRallyPoint(producer, point) {
        if (!point || point.unreachable) return point || { unreachable: true, reason: '目标不可达' };
        const routed = this._movePointForUnit(producer, point);
        if (!routed || routed.unreachable) return routed || { ...point, unreachable: true, reason: '目标不可达' };
        const route = Array.isArray(routed.route) ? routed.route : [];
        const groundGoal = route[0] || (routed.surfaceKind === 'ground' ? routed : null);
        if (groundGoal && pathFinder?.isReachable
            && !pathFinder.isReachable(producer.x, producer.y, groundGoal.x, groundGoal.y, 24)) {
            return { ...point, unreachable: true, reason: '该位置无法从建筑出口到达' };
        }
        return point;
    },

    /** 右键攻击指令反馈：目标贴图短暂红白交替闪现。 */
    _flashAttackTarget(target) {
        if (!target || !target.active) return;
        const now = Date.now();
        target._rtsAttackFlashStartedAt = now;
        target._rtsAttackFlashUntil = now + 720;
    },

    // ==================== 渲染（拖框 + 选中光圈） ====================

    _renderSelectionFx() {
        const scene = _scene();
        if (!scene) return;
        // 拖框（世界空间）
        if (!this._boxG) this._boxG = scene.add.graphics();
        this._boxG.clear();
        if (this._dragging) {
            const a = Renderer.screenToWorld(this._downX, this._downY);
            const b = Renderer.screenToWorld(this._dragX, this._dragY);
            if (a && b) {
                const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
                const wdt = Math.abs(a.x - b.x), hgt = Math.abs(a.y - b.y);
                this._boxG.fillStyle(0x4da6ff, 0.12);
                this._boxG.fillRect(x, y, wdt, hgt);
                this._boxG.lineStyle(1.5, 0x4da6ff, 0.9);
                this._boxG.strokeRect(x, y, wdt, hgt);
            }
        }
        this._boxG.setDepth(99990);

        // 敌人选中红圈，深度跟随精灵。
        const alive = new Set();
        for (const s of this._selection) {
            if (s.kind !== 'enemy') continue;
            const e = s.ref;
            if (!e.active) continue;
            alive.add(e);
            const r = (e.collisionRadius || 24) + 8;
            let ring = this._enemyRings.get(e);
            if (!ring) {
                ring = scene.add.ellipse(e.x, e.y, r * 2, r * 0.9, 0xff5050, 0.14);
                ring.setStrokeStyle(2, 0xff5050, 1);
                this._enemyRings.set(e, ring);
            }
            ring.setPosition(e.x, e.y - (Number(e.z) || 0));
            ring.setVisible(true);
            const sp = e._phaserSprite;
            // 优先跟随精灵深度；无精灵引用时按世界 y 兜底。
            ring.setDepth(sp && sp.active ? sp.depth - 0.1 : e.y);
        }
        for (const [e, ring] of this._enemyRings) {
            if (!alive.has(e)) { ring.destroy(); this._enemyRings.delete(e); }
        }

        // 组队侍从光圈由 GameScene 负责；这里只为非成员友军补金色光圈。
        const memberSet = new Set(PartySystem.members);
        const allyAlive = new Set();
        for (const s of this._selection) {
            if (s.kind !== 'ally' || memberSet.has(s.ref)) continue;
            const e = s.ref;
            if (!e.active) continue;
            allyAlive.add(e);
            const r = (e.collisionRadius || 24) + 8;
            let ring = this._allyRings.get(e);
            if (!ring) {
                ring = scene.add.ellipse(e.x, e.y, r * 2, r * 0.9, 0xd4af37, 0.15);
                ring.setStrokeStyle(2, 0xd4af37, 1);
                this._allyRings.set(e, ring);
            }
            ring.setPosition(e.x, e.y - (Number(e.z) || 0));
            ring.setVisible(true);
            // 建筑产出的友军由 GameScene._companionSprites 渲染，并不一定持有
            // _phaserSprite；必须跟随真实显示精灵，不能退回 e.y 盖到单位身上。
            const sp = e._phaserSprite?.active
                ? e._phaserSprite
                : scene._companionSprites?.[e.id];
            ring.setDepth(sp?.active ? sp.depth - 0.2 : e.y - 0.2);
        }
        for (const [e, ring] of this._allyRings) {
            if (!allyAlive.has(e)) { ring.destroy(); this._allyRings.delete(e); }
        }

        const producerAlive = new Set();
        for (const s of this._selection) {
            if (s.kind !== 'producer' || !s.ref.active) continue;
            const building = s.ref;
            const points = building.collisionShape === 'iso_rect'
                ? isoFootprintVertices(building)
                : [];
            if (points.length < 3) continue;
            producerAlive.add(building);
            let marker = this._producerRings.get(building);
            if (!marker || typeof marker.clear !== 'function') {
                marker?.destroy?.();
                marker = scene.add.graphics();
                this._producerRings.set(building, marker);
            }
            marker.clear();
            const zoom = Math.max(0.01, Number(scene.cameras?.main?.zoom) || 1);
            const pulse = 0.11 + (Math.sin(Date.now() / 260) + 1) * 0.025;
            marker.fillStyle(0xf0cf78, pulse);
            marker.fillPoints(points, true);
            const strokeFootprint = (width, color, alpha) => {
                marker.lineStyle(width / zoom, color, alpha);
                marker.beginPath();
                marker.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) marker.lineTo(points[i].x, points[i].y);
                marker.closePath();
                marker.strokePath();
            };
            strokeFootprint(7, 0xf0cf78, 0.17);
            strokeFootprint(2.4, 0xffe69a, 0.98);
            marker.setVisible(true);
            const sprite = building._phaserSprite;
            marker.setDepth(sprite && sprite.active ? sprite.depth - 0.15 : building.y - 0.15);
        }
        for (const [building, marker] of this._producerRings) {
            if (!producerAlive.has(building)) { marker.destroy(); this._producerRings.delete(building); }
        }
        this._renderRallyGuide(scene);
    },

    /** GameScene 完成单位当帧遮挡仲裁后回写黄圈，确保黄圈低于贴图与脚底阴影。 */
    syncAllyRingDepth(unit, unitDepth) {
        const ring = this._allyRings?.get(unit);
        if (ring?.active && Number.isFinite(unitDepth)) ring.setDepth(unitDepth - 0.2);
    },

    _activeRallyGuideTarget() {
        const producer = this._selectedTroopProducer();
        if (producer) {
            const independent = TroopLineSystem.getProducerRally(producer, this._scene);
            if (independent?.sceneId === this._scene) return independent;
        }
        const globalRally = TroopLineSystem.mode === 'rally' ? TroopLineSystem.rally : null;
        return globalRally?.sceneId === this._scene ? globalRally : null;
    },

    /**
     * 集结点天空指引：起点固定在画布上沿外，终点读取真实承载面显示高度。
     * 虚线相位持续向下滚动，让视觉方向始终从天空指向集结点。
     */
    _renderRallyGuide(scene) {
        if (!scene) return;
        if (!this._rallyGuideG || this._rallyGuideScene !== scene) {
            this._rallyGuideG?.destroy?.();
            this._rallyGuideG = scene.add.graphics();
            this._rallyGuideG.setDepth(99989);
            this._rallyGuideScene = scene;
        }
        const graphics = this._rallyGuideG;
        graphics.clear();
        if (!this.enabled) return;
        const target = this._activeRallyGuideTarget();
        if (!target) return;

        const endWorld = {
            x: Number(target.x),
            y: Number(target.y) - (Number(target.z) || 0),
        };
        const endScreen = Renderer.worldToScreen(endWorld.x, endWorld.y);
        const canvasRect = scene.game?.canvas?.getBoundingClientRect?.();
        if (!endScreen || !canvasRect) return;
        const startWorld = Renderer.screenToWorld(endScreen.x, canvasRect.top - 72);
        if (!startWorld || endWorld.y <= startWorld.y) return;

        const zoom = Math.max(0.01, Number(scene.cameras?.main?.zoom) || 1);
        const dash = 14 / zoom;
        const gap = 9 / zoom;
        const arrowHeight = 15 / zoom;
        const lineEndY = endWorld.y - arrowHeight * 0.75;
        const phase = (Date.now() / 55) % (dash + gap);
        const segments = [];
        for (let y = startWorld.y - phase; y < lineEndY; y += dash + gap) {
            const fromY = Math.max(startWorld.y, y);
            const toY = Math.min(lineEndY, y + dash);
            if (toY > fromY) segments.push({ fromY, toY });
        }
        graphics.lineStyle(6 / zoom, 0xffd24a, 0.18);
        for (const segment of segments) {
            graphics.lineBetween(endWorld.x, segment.fromY, endWorld.x, segment.toY);
        }
        graphics.lineStyle(2.4 / zoom, 0xffd24a, 0.96);
        for (const segment of segments) {
            graphics.lineBetween(endWorld.x, segment.fromY, endWorld.x, segment.toY);
        }

        const halfArrow = 8 / zoom;
        graphics.fillStyle(0xffd24a, 0.96);
        graphics.fillTriangle(
            endWorld.x,
            endWorld.y,
            endWorld.x - halfArrow,
            endWorld.y - arrowHeight,
            endWorld.x + halfArrow,
            endWorld.y - arrowHeight
        );
        graphics.lineStyle(5 / zoom, 0xffd24a, 0.18);
        graphics.strokeEllipse(endWorld.x, endWorld.y, 25 / zoom, 12 / zoom);
        graphics.lineStyle(1.8 / zoom, 0xffe98a, 0.95);
        graphics.strokeEllipse(endWorld.x, endWorld.y, 25 / zoom, 12 / zoom);
    },

    // ==================== 属性面板 ====================

    /** 目标变化时重建 DOM，其余帧只刷新实时数值。 */
    _refreshPanel() {
        if (!this._panel) return;
        if (!this._selection.length) { this._hidePanel(); return; }
        if (this._selection.length === 1 && this._selection[0].kind === 'producer') {
            this._hidePanel();
            return;
        }
        const sig = this._selection.length > 1
            ? 'multi'
            : `one:${this._selection[0].kind}:${this._selection[0].ref.id ?? this._selection[0].ref.name}`;
        if (sig !== this._domSig) {
            this._buildPanelDom();
            this._domSig = sig;
        }
        this._updatePanelValues();
        this._panel.style.display = '';
    },

    _buildPanelDom() {
        if (!this._panel) return;
        this._panel.classList.remove(
            'rts-unit-panel--single',
            'rts-unit-panel--multi'
        );
        if (this._selection.length > 1) {
            this._placeUnitPanel();
            this._panel.classList.add('rts-unit-panel--multi');
            this._panel.innerHTML = `
                <div class="rts-up-head rts-up-head--multi">
                    <div class="rts-up-heading-copy">
                        <span class="rts-up-kicker">指挥编组</span>
                        <span class="rts-up-name">已选单位</span>
                    </div>
                    <span class="rts-up-count-badge" data-ref="count"></span>
                </div>
                <div class="rts-up-multi" data-ref="multi"></div>
                <div class="rts-up-surface-summary" data-ref="surface" hidden></div>`;
            this._dom = {
                count: this._panel.querySelector('[data-ref="count"]'),
                multi: this._panel.querySelector('[data-ref="multi"]'),
                surface: this._panel.querySelector('[data-ref="surface"]'),
                multiSig: '',
            };
            return;
        }
        this._panel.classList.add('rts-unit-panel--single');
        this._placeUnitPanel();
        this._panel.innerHTML = `
            <header class="rts-up-head rts-up-head--identity">
                <img class="rts-up-icon" data-ref="icon" alt="" draggable="false" hidden>
                <div class="rts-up-heading-copy">
                    <div class="rts-up-title-line">
                        <span class="rts-up-name" data-ref="name"></span>
                        <span class="rts-up-lv" data-ref="lv"></span>
                    </div>
                    <span class="rts-up-type" data-ref="type"></span>
                </div>
            </header>
            <section class="rts-up-section rts-up-section--overview" aria-label="单位属性">
                <div class="rts-up-section-head">
                    <span class="rts-up-section-title">作战数据</span>
                    <span class="rts-up-section-meta">实时</span>
                </div>
                <div class="rts-up-vitals">
                    <div class="rts-up-row"><span>HP</span><div class="rts-up-track"><div class="rts-up-fill rts-up-fill--hp" data-ref="hpFill"></div></div><span class="rts-up-num" data-ref="hp"></span></div>
                    <div class="rts-up-row" data-ref="mpRow"><span>MP</span><div class="rts-up-track"><div class="rts-up-fill rts-up-fill--mp" data-ref="mpFill"></div></div><span class="rts-up-num" data-ref="mp"></span></div>
                </div>
                <div class="rts-up-grid">
                    <div><span>力量</span><strong data-ref="s:str"></strong></div>
                    <div><span>敏捷</span><strong data-ref="s:dex"></strong></div>
                    <div><span>智力</span><strong data-ref="s:int"></strong></div>
                    <div><span>体质</span><strong data-ref="s:con"></strong></div>
                    <div><span>精神</span><strong data-ref="s:wis"></strong></div>
                    <div><span>幸运</span><strong data-ref="s:luck"></strong></div>
                </div>
                <div class="rts-up-combat-grid">
                    <div><span>攻击</span><strong data-ref="atk"></strong></div>
                    <div><span>魔攻</span><strong data-ref="matk"></strong></div>
                    <div><span>防御</span><strong data-ref="def"></strong></div>
                    <div><span>基础移速</span><strong data-ref="spd"></strong></div>
                </div>
            </section>
            <section class="rts-up-section" aria-label="兵种升级">
                <div class="rts-up-section-head">
                    <span class="rts-up-section-title">兵种升级</span>
                    <span class="rts-up-section-meta" data-ref="upgradeCount"></span>
                </div>
                <div class="rts-up-upgrade-list" data-ref="upgradeList" role="list"></div>
                <div class="rts-up-empty" data-ref="upgradeEmpty"></div>
            </section>
            <section class="rts-up-section" aria-label="Buff 与 Debuff">
                <div class="rts-up-section-head">
                    <span class="rts-up-section-title">BUFF / DEBUFF</span>
                    <span class="rts-up-section-meta" data-ref="statusCount"></span>
                </div>
                <div class="rts-up-effect-list" data-ref="statusList" role="list"></div>
                <div class="rts-up-empty" data-ref="statusEmpty">当前无状态影响</div>
            </section>`;
        const q = (r) => this._panel.querySelector(r);
        const attr = (k) => q(`[data-ref="${k}"]`);
        this._dom = {
            identity: q('.rts-up-head--identity'),
            icon: attr('icon'), name: attr('name'), lv: attr('lv'), type: attr('type'),
            hpFill: attr('hpFill'), hp: attr('hp'),
            mpRow: attr('mpRow'), mpFill: attr('mpFill'), mp: attr('mp'),
            stats: {
                str: attr('s:str'), dex: attr('s:dex'), int: attr('s:int'),
                con: attr('s:con'), wis: attr('s:wis'), luck: attr('s:luck'),
            },
            atk: attr('atk'), matk: attr('matk'), def: attr('def'), spd: attr('spd'),
            upgradeCount: attr('upgradeCount'),
            upgradeList: attr('upgradeList'),
            upgradeEmpty: attr('upgradeEmpty'),
            upgradeNodes: new Map(),
            upgradeSig: '',
            statusCount: attr('statusCount'),
            statusList: attr('statusList'),
            statusEmpty: attr('statusEmpty'),
            statusNodes: new Map(),
            statusSig: '',
        };
    },

    /** 实时数值提取：只读实体当前值，不从 UI 触发属性重算；
     *  攻击优先读单位实际攻击配置（仓鼠 ai.attackDamage），回落公式 atk。 */
    _readStats(e) {
        const d = e.data || {};
        const isEnemy = e._faction === 'enemy' || e._faction === 'agent';
        const isPlayer = this._isPlayerUnit(e);
        const hp = Math.max(0, Math.round(isPlayer ? (d.hp ?? e.hp ?? 0) : (e.hp ?? d.hp ?? 0)));
        const maxHp = Math.round(isPlayer ? (d.maxHp ?? e.maxHp ?? hp) : (e.maxHp ?? d.maxHp ?? hp));
        const mp = Math.max(0, Math.round(isPlayer ? (d.mp ?? e.mp ?? 0) : (e.mp ?? d.mp ?? 0)));
        const maxMp = Math.round(isPlayer ? (d.maxMp ?? e.maxMp ?? mp) : (e.maxMp ?? d.maxMp ?? mp));
        const num = (k) => (typeof d[k] === 'number' ? d[k] : '—');
        let atk;
        const actualAttack = e._ai && typeof e._ai._attackDamage === 'number'
            ? e._ai._attackDamage
            : (e.aiConfig && typeof e.aiConfig.attackDamage === 'number'
                ? e.aiConfig.attackDamage
                : (e.ai && typeof e.ai.attackDamage === 'number' ? e.ai.attackDamage : null));
        if (actualAttack !== null && typeof e.getPhysicalAttackDamagePreview === 'function') {
            atk = String(e.getPhysicalAttackDamagePreview(actualAttack));
        } else if (actualAttack !== null) atk = String(Math.round(actualAttack));
        else if (typeof d.atk === 'number' && d.atk > 0) atk = String(Math.round(d.atk));
        else atk = this._enemyAttackText(e);
        const matk = typeof d.matk === 'number' ? Math.round(d.matk) : '—';
        const def = typeof d.def === 'number' ? Math.round(d.def) : (e.def ?? e.mdef ?? '—');
        const configuredSpeed = e.aiConfig?.walkSpeed ?? e.ai?.walkSpeed ?? e.aiConfig?.runSpeed;
        const speed = Math.round(configuredSpeed ?? e.maxSpeed ?? e.speed ?? 0) || '—';
        const baseType = isEnemy ? (e.type || '敌人') : (e.title || '友军');
        const categoryLabel = isEnemy ? '' : getHamsterUnitCategoryLabel(getUnitKind(e));
        const classifiedType = categoryLabel ? `${baseType} · ${categoryLabel}` : baseType;
        const surface = this._surfaceLabel(e);
        return {
            name: e.name || d.name || (isEnemy ? '敌人' : '友军'),
            level: e.level ?? d.level ?? 1,
            type: surface ? `${classifiedType} · ${surface}` : classifiedType,
            hp, maxHp, mp, maxMp,
            str: num('str'), dex: num('dex'), int: num('int'),
            con: num('con'), wis: num('wis'), luck: num('luck'),
            atk, matk, def, speed,
        };
    },

    _surfaceLabel(entity) {
        if (entity?._surfaceKind === 'wall_walk') return `墙顶 +${Math.round(Number(entity.z) || 0)}`;
        if (entity?._surfaceKind === 'stairs') return `楼梯 +${Math.round(Number(entity.z) || 0)}`;
        return '';
    },

    _updatePanelValues() {
        if (!this._dom || !this._panel) return;
        if (this._selection.length > 1) {
            this._dom.count.textContent = String(this._selection.length);
            // 按单位类型分组统计。
            const groups = new Map();
            for (const s of this._selection) {
                const e = s.ref;
                const unitKind = s.kind === 'ally' ? getUnitKind(e) : '';
                const label = s.kind === 'ally'
                    ? (e.name || e.title || '友军')
                    : (e.name || e.type || '敌人');
                const groupKey = `${s.kind}:${unitKind || label}`;
                const group = groups.get(groupKey) || {
                    label,
                    count: 0,
                    iconPath: getHamsterUnitIcon(unitKind),
                    fallback: s.kind === 'enemy' ? '!' : '◆',
                };
                group.count += 1;
                groups.set(groupKey, group);
            }
            const groupList = Array.from(groups.values());
            const multiSig = groupList
                .map((group) => `${group.label}:${group.count}:${group.iconPath}`)
                .join('|');
            if (this._dom.multiSig !== multiSig) {
                const fragment = document.createDocumentFragment();
                for (const group of groupList) {
                    const row = document.createElement('div');
                    row.className = 'rts-up-multi-item';
                    if (group.iconPath) {
                        const icon = document.createElement('img');
                        icon.className = 'rts-up-multi-icon';
                        icon.src = group.iconPath;
                        icon.alt = '';
                        icon.draggable = false;
                        row.appendChild(icon);
                    } else {
                        const fallback = document.createElement('span');
                        fallback.className = 'rts-up-multi-icon rts-up-multi-icon--fallback';
                        fallback.textContent = group.fallback;
                        fallback.setAttribute('aria-hidden', 'true');
                        row.appendChild(fallback);
                    }
                    const name = document.createElement('span');
                    name.className = 'rts-up-multi-name';
                    name.textContent = group.label;
                    const count = document.createElement('strong');
                    count.className = 'rts-up-multi-count';
                    count.textContent = `×${group.count}`;
                    row.append(name, count);
                    fragment.appendChild(row);
                }
                this._dom.multi.replaceChildren(fragment);
                this._dom.multiSig = multiSig;
            }
            const surfaceGroups = new Map();
            for (const s of this._selection) {
                const kind = s.ref?._surfaceKind || ((Number(s.ref?.z) || 0) > 1 ? 'elevated' : 'ground');
                const label = kind === 'wall_walk'
                    ? '墙顶'
                    : (kind === 'stairs' ? '楼梯' : (kind === 'ground' ? '地面' : '高层'));
                surfaceGroups.set(label, (surfaceGroups.get(label) || 0) + 1);
            }
            if (surfaceGroups.size > 1 || !surfaceGroups.has('地面')) {
                const surfaceText = Array.from(surfaceGroups.entries())
                    .map(([label, n]) => `${label} ×${n}`)
                    .join(' · ');
                this._dom.surface.textContent = `所在层级 · ${surfaceText}`;
                this._dom.surface.hidden = false;
            } else {
                this._dom.surface.textContent = '';
                this._dom.surface.hidden = true;
            }
            return;
        }
        const selected = this._selection[0];
        const st = this._readStats(selected.ref);
        const d = this._dom;
        const iconPath = selected.kind === 'ally'
            ? getHamsterUnitIcon(getUnitKind(selected.ref))
            : '';
        d.identity.classList.toggle('rts-up-head--no-icon', !iconPath);
        if (iconPath) {
            if (d.icon.src !== new URL(iconPath, document.baseURI).href) d.icon.src = iconPath;
            d.icon.hidden = false;
        } else {
            d.icon.hidden = true;
            d.icon.removeAttribute('src');
        }
        d.name.textContent = st.name;
        d.lv.textContent = `Lv.${st.level}`;
        d.type.textContent = st.type;
        const hpPct = st.maxHp > 0 ? Math.round((st.hp / st.maxHp) * 100) : 0;
        const mpPct = st.maxMp > 0 ? Math.round((st.mp / st.maxMp) * 100) : 0;
        d.hpFill.style.width = `${Math.max(0, Math.min(100, hpPct))}%`;
        d.mpFill.style.width = `${Math.max(0, Math.min(100, mpPct))}%`;
        d.mpRow.hidden = st.maxMp <= 0;
        d.hp.textContent = `${st.hp}/${st.maxHp}`;
        d.mp.textContent = `${st.mp}/${st.maxMp}`;
        d.stats.str.textContent = st.str;
        d.stats.dex.textContent = st.dex;
        d.stats.int.textContent = st.int;
        d.stats.con.textContent = st.con;
        d.stats.wis.textContent = st.wis;
        d.stats.luck.textContent = st.luck;
        d.atk.textContent = st.atk;
        d.matk.textContent = st.matk;
        d.def.textContent = st.def;
        d.spd.textContent = st.speed;
        this._syncUnitUpgradeRows(selected.ref);
        this._syncUnitStatusRows(selected.ref);
    },

    _writePanelText(node, value) {
        if (!node) return;
        const text = String(value ?? '');
        if (node.textContent !== text) node.textContent = text;
    },

    _createPanelListIcon(model, className) {
        if (model.iconImage) {
            const image = document.createElement('img');
            image.className = className;
            image.src = model.iconImage;
            image.alt = '';
            image.draggable = false;
            image.addEventListener('error', () => {
                if (!image.isConnected) return;
                const fallback = document.createElement('span');
                fallback.className = `${className} ${className}--fallback`;
                fallback.textContent = model.icon || '◆';
                fallback.setAttribute('aria-hidden', 'true');
                image.replaceWith(fallback);
            }, { once: true });
            return image;
        }
        const fallback = document.createElement('span');
        fallback.className = `${className} ${className}--fallback`;
        fallback.textContent = model.icon || '◆';
        fallback.setAttribute('aria-hidden', 'true');
        return fallback;
    },

    _syncUnitUpgradeRows(entity) {
        const d = this._dom;
        if (!d?.upgradeList) return;
        const rows = getUnitUpgradeRows(entity);
        const signature = rows.map((row) => row.id).join('|');
        if (signature !== d.upgradeSig) {
            const fragment = document.createDocumentFragment();
            const nodes = new Map();
            for (const row of rows) {
                const item = document.createElement('div');
                item.className = 'rts-up-upgrade-item';
                item.setAttribute('role', 'listitem');
                item.appendChild(this._createPanelListIcon(row, 'rts-up-list-icon'));

                const copy = document.createElement('div');
                copy.className = 'rts-up-list-copy';
                const title = document.createElement('div');
                title.className = 'rts-up-list-title';
                const name = document.createElement('strong');
                name.textContent = row.name;
                const source = document.createElement('span');
                source.textContent = row.source;
                title.append(name, source);
                const detail = document.createElement('span');
                detail.className = 'rts-up-list-detail';
                copy.append(title, detail);

                const level = document.createElement('span');
                level.className = 'rts-up-list-level';
                item.append(copy, level);
                fragment.appendChild(item);
                nodes.set(row.id, { detail, level });
            }
            d.upgradeList.replaceChildren(fragment);
            d.upgradeNodes = nodes;
            d.upgradeSig = signature;
        }
        for (const row of rows) {
            const nodes = d.upgradeNodes.get(row.id);
            if (!nodes) continue;
            this._writePanelText(nodes.level, `Lv.${row.level}`);
            this._writePanelText(nodes.detail, row.detail);
        }
        const hasRows = rows.length > 0;
        d.upgradeList.hidden = !hasRows;
        d.upgradeEmpty.hidden = hasRows;
        this._writePanelText(d.upgradeCount, hasRows ? `已生效 ${rows.length}` : '未强化');
        this._writePanelText(
            d.upgradeEmpty,
            entity?._isHamsterMiner
                ? '暂无已生效的所属营地升级'
                : (getUnitKind(entity) ? '暂无已生效的兵种升级' : '此目标不使用兵种升级')
        );
    },

    _syncUnitStatusRows(entity) {
        const d = this._dom;
        if (!d?.statusList) return;
        const rows = getUnitStatusRows(entity);
        const signature = rows.map((row) => `${row.id}:${row.tone}`).join('|');
        if (signature !== d.statusSig) {
            const fragment = document.createDocumentFragment();
            const nodes = new Map();
            for (const row of rows) {
                const item = document.createElement('div');
                item.className = `rts-up-effect-item rts-up-effect-item--${row.tone}`;
                item.setAttribute('role', 'listitem');

                const icon = document.createElement('span');
                icon.className = 'rts-up-effect-icon';
                icon.textContent = row.icon;
                icon.setAttribute('aria-hidden', 'true');
                const copy = document.createElement('div');
                copy.className = 'rts-up-list-copy';
                const title = document.createElement('div');
                title.className = 'rts-up-list-title';
                const name = document.createElement('strong');
                name.textContent = row.name;
                const stacks = document.createElement('span');
                stacks.className = 'rts-up-effect-stacks';
                title.append(name, stacks);
                const detail = document.createElement('span');
                detail.className = 'rts-up-list-detail';
                copy.append(title, detail);
                const remaining = document.createElement('span');
                remaining.className = 'rts-up-effect-time';
                item.append(icon, copy, remaining);
                fragment.appendChild(item);
                nodes.set(row.id, { stacks, detail, remaining });
            }
            d.statusList.replaceChildren(fragment);
            d.statusNodes = nodes;
            d.statusSig = signature;
        }
        for (const row of rows) {
            const nodes = d.statusNodes.get(row.id);
            if (!nodes) continue;
            this._writePanelText(nodes.stacks, row.stacks > 1 ? `×${row.stacks}` : '');
            this._writePanelText(nodes.detail, row.detail);
            this._writePanelText(nodes.remaining, row.remaining);
        }
        const buffCount = rows.filter((row) => row.tone === 'buff').length;
        const debuffCount = rows.filter((row) => row.tone === 'debuff').length;
        const neutralCount = rows.length - buffCount - debuffCount;
        const counts = [];
        if (buffCount) counts.push(`增益 ${buffCount}`);
        if (debuffCount) counts.push(`减益 ${debuffCount}`);
        if (neutralCount) counts.push(`状态 ${neutralCount}`);
        const hasRows = rows.length > 0;
        d.statusList.hidden = !hasRows;
        d.statusEmpty.hidden = hasRows;
        this._writePanelText(d.statusCount, counts.join(' · ') || '无状态');
    },

    _enemyAttackText(e) {
        const a = e.attacks && Object.values(e.attacks)[0];
        const dmg = a && a.config ? a.config.damage : (a && a.damage);
        if (typeof dmg === 'number') return String(dmg);
        if (dmg && typeof dmg === 'object' && (dmg.min !== undefined || dmg.max !== undefined)) {
            const lo = dmg.min ?? dmg.max;
            const hi = dmg.max ?? dmg.min;
            return `${lo}~${hi}`;
        }
        const cfgDmg = e.config && e.config.attack && e.config.attack.damage;
        if (typeof cfgDmg === 'number') return String(cfgDmg);
        return '—';
    },
};

export default RTSCommand;
