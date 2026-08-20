// ============================================================
// RTS 指挥模式（RTSCommand，2026-08-16）
// 左键选择或框选单位，右键移动或攻击；建筑详情仍复用现有系统。
// 通过 game.js 初始化并逐帧 tick；跨系统依赖使用 window.Game 惰性访问以避免循环 import。
// ============================================================

import { PartySystem } from '../systems/party-system.js';
import { Renderer } from '../world/renderer.js';
import { Camera } from '../world/camera.js';
import { CONFIG } from '../config/config.js';
import { getUnitKind } from '../world/unit-upgrade-store.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { TroopLineSystem } from '../world/troop-line-system.js';
import { RTS_DEFAULT_ACQUIRE_RANGE } from '../ai/rts-command-utils.js';
import { pathFinder } from '../ai/pathfinder.js';
import { TechnologySystem } from '../world/technology-system.js';
import { isoFootprintVertices } from '../physics/iso-footprint.js';
import { TechnologyGate } from './technology-gate.js';

const DRAG_THRESHOLD = 6; // 屏幕 px：超过判定为拖框
const PERSISTENT_WORLDS = new Set(['scene8', 'scene9', 'scene10', 'scene11']);
const POINTER_BLOCK_SELECTOR = [
    '.system-panel', '.panel-overlay', '.side-menu', '.back-menu-btn', '.menu-btn',
    '.party-bar', '.rts-unit-panel', '.rts-command-btn', '.companion-overlay',
    '.recruit-overlay', '.wall-editor-panel', '.world-switch-panel', '.technology-tree-panel',
    '.hamster-hut-panel', '.hamster-barracks-panel', '.producer-building-panel',
    '.troop-line-panel', '.rts-command-bar',
].join(', ');

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
    _pendingRightClick: null, // RTS 自己捕获右键，避免依赖 Input 边沿标志而漏命令
    _troopLinePanel: null,
    _commandBar: null,
    _rallyPicking: false,
    _troopLineRevision: -1,

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
        this._scene = sceneId;
        const commandButtonWasVisible = !!(this._btn && this._btn.style.display !== 'none');
        if (this._btn) TechnologyGate.refresh(this._btn);
        if (commandable && !commandButtonWasVisible) this._placeButton();
        if (this._troopLinePanel) this._troopLinePanel.style.display = (commandable && this.enabled) ? '' : 'none';
        if (leavingWorld && !observer) this._resetPartyCommandsForSceneExit();
        if (!commandable && this.enabled) this.setEnabled(false);
        if (!this.enabled) return;
        this._pruneSelection();
        this._syncCommandBarVisibility();
        this._edgePan(dt, Input);
        const input = Input || this._input();
        const pendingRightClick = this._pendingRightClick;
        this._pendingRightClick = null;
        if (pendingRightClick) {
            this._handleRightClick(pendingRightClick.x, pendingRightClick.y);
            if (input?.mouse) input.mouse.rightPressed = false;
        } else if (input && input.mouse && input.mouse.rightPressed) {
            this._handleRightClick(input.mouse.x, input.mouse.y);
            input.mouse.rightPressed = false;
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
        if (on && !TechnologySystem.isUnlocked('mechanic', 'rts_command')) {
            this.enabled = false;
            if (this._btn) this._btn.classList.remove('active');
            return false;
        }
        if (on) this._closeBuildingUI();
        this.enabled = !!on;
        // 切换前清掉 Space，避免角色把同一次按键解释成翻滚。
        const input = _game()?.Input || this._input();
        input?.keys?.delete?.('Space');
        if (this._btn) this._btn.classList.toggle('active', this.enabled);
        if (this._troopLinePanel) this._troopLinePanel.style.display = this.enabled ? '' : 'none';
        this._syncCommandBarVisibility();
        if (!this.enabled) {
            this._rallyPicking = false;
            this._pendingRightClick = null;
            this._flatHitCycle = null;
            this._clearSelection();
            this._hidePanel();
            this._clearDrag();
            // 退出指挥模式：镜头回归玩家（观察模式无玩家在场，不动镜头）
            const g = _game();
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
        btn.title = '进入 RTS 指挥模式：左键选择/框选，右键移动/攻击，单击空地取消';
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
            <div style="font-size:13px;font-weight:700;color:#f0cf78;margin-bottom:8px;">兵线控制</div>
            <div class="troop-line-actions" style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;">
                <button data-mode="follow">跟随</button>
                <button data-mode="hold">待命</button>
                <button data-mode="rally">自订</button>
            </div>
            <div data-role="status" style="font-size:12px;line-height:1.55;color:#aeb9c8;margin-top:8px;height:76px;overflow:hidden;box-sizing:border-box;white-space:pre-line;"></div>
        `;
        for (const button of el.querySelectorAll('[data-mode]')) {
            button.style.cssText = 'padding:6px 2px;border:1px solid #586474;border-radius:5px;background:#29313c;color:#d8dfeb;cursor:pointer;font-size:12px;';
            if (button.dataset.mode === 'hold') {
                TechnologyGate.bind(button, { type: 'mechanic', id: 'troop_hold' });
            } else if (button.dataset.mode === 'rally') {
                TechnologyGate.bind(button, { type: 'mechanic', id: 'troop_rally' });
            }
            button.addEventListener('click', () => {
                const mode = button.dataset.mode;
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
        this._commandBar.style.top = `${troopBottom + 6}px`;
    },

    _syncCommandBarVisibility() {
        if (!this._commandBar) return;
        const show = this.enabled && this._selection.some((entry) => entry.kind !== 'producer');
        this._commandBar.style.display = show ? '' : 'none';
        if (show) this._placeCommandBar();
    },

    _placeUnitPanel() {
        if (!this._panel) return;
        const clock = document.querySelector('.game-time');
        const clockBottom = clock?.getBoundingClientRect?.().bottom || 84;
        this._panel.style.top = `${clockBottom + 8}px`;
        this._panel.style.right = '100px';
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
            button.style.background = active ? '#536d42' : '#29313c';
            button.style.borderColor = active ? '#a8cf78' : '#586474';
            button.style.color = active ? '#f1f7e8' : '#d8dfeb';
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

    /** 关闭全部建筑选择与详情界面。 */
    _closeBuildingUI() {
        const g = _game();
        if (!g) return;
        if (g.BuildingSystem && g.BuildingSystem.active && typeof g.BuildingSystem.close === 'function') {
            g.BuildingSystem.close();
        }
        const closeIfOpen = (sys) => {
            if (sys && sys._panel && sys._panel.isOpen && typeof sys._panel.close === 'function') sys._panel.close();
        };
        closeIfOpen(g.DefenseSystem);
        closeIfOpen(g.DefenseTrapSystem);
        closeIfOpen(g.HamsterHutSystem);
        closeIfOpen(g.HamsterBarracksSystem);
        closeIfOpen(g.ProducerBuildingSystem);
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
            return s.kind === 'ally' ? allies.has(s.ref) : worldEntities.has(s.ref);
        });
        if (before !== this._selection.length) {
            this._syncPartySelection();
            this._renderSelectionFx();
            this._domSig = null;
            this._syncCommandBarVisibility();
        }
    },

    _setSelection(list) {
        this._selection = (list || []).filter((s) => s && s.ref && s.ref.active);
        // 打开单位详情或复数选择面板时，关闭建筑选择界面。
        this._closeBuildingUI();
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

    /** 友军选中同步至组队栏高亮与场景选中光圈。 */
    _syncPartySelection() {
        if (!PartySystem) return;
        const allyIds = this._selection.filter((s) => s.kind === 'ally').map((s) => s.ref.id);
        PartySystem.setSelected(allyIds);
    },

    // ==================== 命中 / 框选 ====================

    /** 全部友军单位：PartySystem 侍从 + 场上 player/companion 阵营实体（仓鼠单位等），
     * 排除玩家本人、建筑、掉落物、传送门、NPC 与能源节点。 */
    _collectAllies() {
        const allies = [];
        const seen = new Set();
        const g = _game();
        // 观察世界没有玩家本体及随行队员，不读取本体世界的 PartySystem 对象。
        if (!g?._observerMode) {
            for (const m of PartySystem.members) {
                if (!m || !m.active) continue;
                allies.push(m);
                seen.add(m);
            }
        }
        if (!g || !g.entities) return allies;
        for (const e of g.entities.values()) {
            if (!e || !e.active || seen.has(e) || e === g.player) continue;
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
            const hit = producer._isHamsterBarracks
                ? { cx: 0, cy: -60, hw: 85, hh: 65 }
                : {
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
                const r = this._unitScreenRect(e);
                if (r && r.x1 >= x0 && r.x0 <= x1 && r.y1 >= y0 && r.y0 <= y1) {
                    sel.push({ kind: 'enemy', ref: e });
                }
            }
        }
        return sel;
    },

    /** 建筑点击在指挥模式下忽略交互距离，并复用既有详情面板。 */
    _tryBuildingClick(sx, sy) {
        const g = _game();
        const p = g ? g.player : null;
        if (!g) return false;
        const prevBuild = g._buildMode;
        g._buildMode = true;
        try {
            if (g.DefenseTrapSystem && g.DefenseTrapSystem.tryInteract && g.DefenseTrapSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
            if (g.DefenseSystem && g.DefenseSystem.active && g.DefenseSystem.tryInteract && g.DefenseSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
            if (g.HamsterHutSystem && g.HamsterHutSystem.active && g.HamsterHutSystem.tryInteract && g.HamsterHutSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
            if (g.HamsterBarracksSystem && g.HamsterBarracksSystem.active && g.HamsterBarracksSystem.tryInteract && g.HamsterBarracksSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
            if (g.ProducerBuildingSystem && g.ProducerBuildingSystem.active && g.ProducerBuildingSystem.tryInteract && g.ProducerBuildingSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
        } finally {
            g._buildMode = prevBuild;
        }
        // 掩体与铁栅栏门复用 BuildingSystem 详情。
        const bs = g.BuildingSystem;
        const mw = Renderer.screenToWorld(sx, sy);
        if (bs && mw && typeof bs._hitTestCover === 'function' && typeof bs._showDetail === 'function') {
            const hit = bs._hitTestCover(mw.x, mw.y);
            if (hit) {
                this.setEnabled(false);
                if (!bs.active && typeof bs.open === 'function') bs.open();
                bs._showDetail(hit);
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
        return !!(e?.target?.closest && e.target.closest(POINTER_BLOCK_SELECTOR));
    },

    _onMouseDown(e) {
        if (!this.enabled || !this._isCommandable()) return;
        if (this._isPointerBlocked(e)) return;
        if (e.button === 0 && this._tryMinimapCameraJump(e.clientX, e.clientY)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this._clearDrag();
            return;
        }
        if (e.button === 2) {
            this._pendingRightClick = { x: e.clientX, y: e.clientY };
            return;
        }
        if (e.button !== 0) return;
        this._down = true;
        this._downX = e.clientX;
        this._downY = e.clientY;
        this._dragging = false;
    },

    _tryMinimapCameraJump(clientX, clientY) {
        const scene = _scene();
        if (!scene || typeof scene.minimapWorldPointAt !== 'function') return false;
        const point = scene.minimapWorldPointAt(clientX, clientY);
        if (!point) return false;
        Camera.x = point.x;
        Camera.y = point.y;
        scene._minimapNextAt = 0;
        return true;
    },

    _onMouseMove(e) {
        this._pointerOverUi = this._isPointerBlocked(e);
        if (!this.enabled || !this._isCommandable() || !this._down) return;
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
        if (!this.enabled || !this._isCommandable() || !this._down) return;
        this._down = false;
        if (e.button !== 0) return;
        if (this._dragging) {
            this._setSelection(this._selectInRect(this._downX, this._downY, e.clientX, e.clientY));
        } else {
            // 单击单位（双击同类全选）、建筑，或点击空地取消。
            const hit = this._hitUnitAt(e.clientX, e.clientY, { cycle: true });
            if (hit) {
                const now = Date.now();
                const dbl = this._lastClick && now - this._lastClick.at <= 350 && this._lastClick.ref === hit.ref;
                this._lastClick = { at: now, ref: hit.ref };
                if (dbl && hit.kind === 'ally') {
                    this._selectSameTypeOnScreen(hit.ref);
                } else {
                    this._setSelection([hit]);
                }
            } else {
                const producer = this._hitTroopProducerAt(e.clientX, e.clientY);
                if (producer) {
                    this._lastClick = null;
                    this._setSelection([producer]);
                } else if (this._tryBuildingClick(e.clientX, e.clientY)) {
                    // 打开非产兵建筑界面时关闭单位/复数面板，保留选择。
                    this._hidePanel();
                } else {
                    this._clearSelection();
                    this._hidePanel();
                }
            }
        }
        this._clearDrag();
    },

    _clearDrag() {
        this._down = false;
        this._dragging = false;
        if (this._boxG) this._boxG.clear();
    },

    // ==================== 边缘平移 / 双击复选 / 编队 ====================

    /** 边缘平移：鼠标贴近屏幕四缘时平移相机。 */
    _edgePan(dt, Input) {
        const input = Input || this._input();
        const m = input && input.mouse;
        if (!this._mouseSeen) return;
        if (this._pointerOverUi) return;
        if (!m || typeof m.x !== 'number') return;
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
        if (!this.enabled) return;
        const g = _game();
        if (!g || !(g._observerMode || PERSISTENT_WORLDS.has(this._scene))) return;
        if (this._rallyPicking && e.code === 'Escape') {
            this._cancelRallyPick();
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        const m = /^Digit([0-9])$/.exec(e.code);
        if (!m) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        const d = m[1];
        if (e.ctrlKey || e.metaKey) {
            const ids = this._selection.filter((s) => s.kind === 'ally')
                .map((s) => s.ref?.id).filter(Boolean);
            if (!ids.length) return;
            this._groups.set(d, [...new Set(ids)]);
            this._groupNotify(d, ids.length, '编入');
            e.preventDefault(); e.stopImmediatePropagation();
        } else if (e.shiftKey) {
            const add = this._selection.filter((s) => s.kind === 'ally')
                .map((s) => s.ref?.id).filter(Boolean);
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
            this._groups.set(d, grp.map((unit) => unit.id));
            this._setSelection(grp.map((ref) => ({ kind: 'ally', ref })));
            this._groupNotify(d, grp.length, '选中');
            e.preventDefault(); e.stopImmediatePropagation();
        }
    },

    _groupNotify(digit, n, verb) {
        EffectManager.add(new FloatingTextEffect(Camera.x, Camera.y - 120, `${verb}编队 ${digit}（${n} 单位）`, '#8ad0ff'));
    },

    _resolveGroupUnits(entries) {
        const allies = new Map(this._collectAllies()
            .filter((unit) => unit?.active && unit.id)
            .map((unit) => [unit.id, unit]));
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
        return getUnitKind(u) || u.configId || u.id || u.name || null;
    },

    /** 指挥模式轮盘统一出口前置判定：有友军选中即可 */
    hasAllySelection() {
        return this._selection.some((s) => s.kind === 'ally');
    },

    /** 轮盘指令统一出口：队友走 PartySystem，其他友军按映射写入 _command。 */
    issueWheelCommand(mode, point) {
        const members = [];
        const direct = [];
        for (const s of this._selection) {
            if (s.kind !== 'ally') continue;
            if (PartySystem.members.includes(s.ref)) members.push(s.ref);
            else direct.push(s.ref);
        }
        let n = 0;
        if (mode === 'aggressive') {
            for (const member of members) {
                const target = this._nearestCommandEnemy(member);
                n += PartySystem.setCommand(
                    [member.id],
                    target ? 'attack' : 'hold',
                    null,
                    target
                );
            }
        } else if (members.length) {
            n += PartySystem.setCommand(members.map((member) => member.id), mode, point);
        }
        for (const u of direct) {
            const mapped = this._mapWheelModeForUnit(u, mode, point);
            if (!mapped) continue;
            if (u._ai && typeof u._ai.cancelForCommand === 'function') u._ai.cancelForCommand();
            delete u._troopLineTransit;
            delete u._troopLineRally;
            u._command = mapped;
            n++;
        }
        return n;
    },

    /** 将轮盘指令映射为仓鼠单位支持的 move/attack/hold/follow 指令。 */
    _mapWheelModeForUnit(u, mode, point) {
        if (mode === 'follow') return { mode: 'follow' };
        if (mode === 'aggressive') {
            const target = this._nearestCommandEnemy(u);
            return target
                ? { mode: 'attack', point: null, target }
                : { mode: 'hold', point: null, target: null };
        }
        if (mode === 'hold') return { mode: 'hold', point: null, target: null };
        if (mode === 'patrol') return { mode: 'move', point: point ? { x: point.x, y: point.y } : null, target: null };
        if (mode === 'gather') return u._isHamsterMiner ? { mode: 'follow' } : null;
        return null;
    },

    _nearestCommandEnemy(unit) {
        const entities = _game()?.entities;
        if (!unit || !entities) return null;
        let nearest = null;
        let nearestDistance = RTS_DEFAULT_ACQUIRE_RANGE;
        for (const entity of entities.values()) {
            if (!entity || !entity.active || entity.hp <= 0 || entity._isEnergyNode) continue;
            if (entity._faction !== 'enemy' && entity._faction !== 'agent') continue;
            const distance = Math.hypot(entity.x - unit.x, entity.y - unit.y);
            if (distance <= nearestDistance) {
                nearest = entity;
                nearestDistance = distance;
            }
        }
        return nearest;
    },

    /** 右键空地移动选中友军，右键敌方目标发起进攻。 */
    _handleRightClick(sx, sy) {
        const w = Renderer.screenToWorld(sx, sy);
        if (!w) {
            this._cancelRallyPick();
            return;
        }
        if (this._rallyPicking) {
            const defenseSystem = _game()?.DefenseSystem;
            const point = defenseSystem?.resolveSurfaceTarget
                ? defenseSystem.resolveSurfaceTarget(w.x, w.y)
                : { x: w.x, y: w.y, z: 0, surfaceKind: 'ground', route: [] };
            if (point.unreachable) {
                EffectManager.add(new FloatingTextEffect(point.x, point.y, point.reason || '该位置无法集结', '#ff8855'));
                this._cancelRallyPick();
                return;
            }
            if (!TroopLineSystem.setRally(this._scene, point)) {
                EffectManager.add(new FloatingTextEffect(point.x, point.y, '当前位面未接入传送网络', '#ff8855'));
                this._cancelRallyPick();
                return;
            }
            this._rallyPicking = false;
            this._refreshTroopLinePanel(true);
            EffectManager.add(new FloatingTextEffect(point.x, point.y - (point.z || 0), '集结点已保存', '#8ad0ff'));
            return;
        }
        const producer = this._selectedTroopProducer();
        if (producer) {
            if (!TechnologySystem.isUnlocked('mechanic', 'troop_rally')) {
                EffectManager.add(new FloatingTextEffect(producer.x, producer.y - 64, '需要先研发集结战术', '#ffb35c'));
                return;
            }
            const defenseSystem = _game()?.DefenseSystem;
            const point = defenseSystem?.resolveSurfaceTarget
                ? defenseSystem.resolveSurfaceTarget(w.x, w.y)
                : { x: w.x, y: w.y, z: 0, surfaceKind: 'ground', route: [] };
            const reachable = this._producerRallyPoint(producer, point);
            if (reachable.unreachable) {
                EffectManager.add(new FloatingTextEffect(
                    reachable.x,
                    reachable.y - (reachable.z || 0),
                    reachable.reason || '该位置无法从建筑出口到达',
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
        const hit = this._hitUnitAt(sx, sy);
        const phaser = _scene();
        if (hit && hit.kind === 'enemy') {
            if (this._selection.some((s) => s.kind === 'ally')) {
                const attackers = this._issueCommandToAllies('attack', null, hit.ref);
                if (attackers > 0) {
                    this._flashAttackTarget(hit.ref);
                    _game()?.FlatViewSystem?.notifyCommandTarget?.(
                        'attack',
                        hit.ref,
                        this._selection.filter((s) => s.kind === 'ally').map((s) => s.ref)
                    );
                    if (phaser && typeof phaser.showMoveMarker === 'function') {
                        phaser.showMoveMarker(hit.ref.x, hit.ref.y - (Number(hit.ref.z) || 0));
                    }
                } else {
                    EffectManager.add(new FloatingTextEffect(hit.ref.x, hit.ref.y - (Number(hit.ref.z) || 0), '选中单位无法攻击', '#ff8855'));
                }
            } else {
                // 无友军选中时，右键敌人仅选中并查看属性。
                this._setSelection([hit]);
            }
        } else if (this._selection.some((s) => s.kind === 'ally')) {
            const defenseSystem = _game()?.DefenseSystem;
            const point = defenseSystem?.resolveSurfaceTarget
                ? defenseSystem.resolveSurfaceTarget(w.x, w.y)
                : { x: w.x, y: w.y, z: 0, surfaceKind: 'ground', route: [] };
            if (point.unreachable) {
                EffectManager.add(new FloatingTextEffect(
                    point.x,
                    point.y - (point.z || 0),
                    point.reason || '目标不可达',
                    '#ff8855'
                ));
                return;
            }
            const commanded = this._issueCommandToAllies('move', point, null);
            if (commanded > 0) {
                _game()?.FlatViewSystem?.notifyCommandTarget?.(
                    'move',
                    point,
                    this._selection.filter((s) => s.kind === 'ally').map((s) => s.ref)
                );
                if (phaser && typeof phaser.showMoveMarker === 'function') {
                    phaser.showMoveMarker(point.x, point.y - (point.z || 0));
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
    _issueCommandToAllies(mode, point, target) {
        const memberIds = [];
        const directUnits = [];
        for (const s of this._selection) {
            if (s.kind !== 'ally') continue;
            if (PartySystem.members.includes(s.ref)) memberIds.push(s.ref.id);
            else directUnits.push(s.ref);
        }
        let commanded = 0;
        this._lastCommandRejectReason = null;
        for (const memberId of memberIds) {
            const member = PartySystem.getMember(memberId);
            const commandPoint = mode === 'move' ? this._movePointForUnit(member, point) : point;
            if (commandPoint?.unreachable) {
                this._lastCommandRejectReason ||= commandPoint.reason || '目标不可达';
                continue;
            }
            commanded += PartySystem.setCommand(memberId, mode, commandPoint, target);
        }
        for (const u of directUnits) {
            if (mode === 'attack' && u._rtsCanAttack === false) {
                if (u._ai && typeof u._ai.cancelForCommand === 'function') u._ai.cancelForCommand();
                delete u._troopLineTransit;
                delete u._troopLineRally;
                u._command = { mode: 'hold', point: null, target: null };
                continue;
            }
            if ((mode === 'move' || mode === 'hold') && u._ai && typeof u._ai.cancelForCommand === 'function') {
                u._ai.cancelForCommand();
            }
            const commandPoint = mode === 'move' ? this._movePointForUnit(u, point) : point;
            if (commandPoint?.unreachable) {
                this._lastCommandRejectReason ||= commandPoint.reason || '目标不可达';
                continue;
            }
            // 显式 RTS 指令优先于出生时继承的全局兵线命令。
            delete u._troopLineTransit;
            delete u._troopLineRally;
            u._command = {
                mode,
                point: commandPoint ? {
                    ...commandPoint,
                    route: Array.isArray(commandPoint.route) ? commandPoint.route.map((step) => ({ ...step })) : [],
                } : null,
                target: (mode === 'attack' && target) ? target : null,
            };
            commanded++;
        }
        return commanded;
    },

    _movePointForUnit(unit, point) {
        const defenseSystem = _game()?.DefenseSystem;
        if (!point || !defenseSystem?.routeSurfaceMoveForUnit) return point;
        return defenseSystem.routeSurfaceMoveForUnit(unit, point);
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
            const sp = e._phaserSprite;
            ring.setDepth(sp && sp.active ? sp.depth - 0.1 : e.y);
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
        if (this._selection.length === 1 && this._selection[0].kind === 'producer') {
            this._panel.innerHTML = `
                <div class="rts-up-head">
                    <span class="rts-up-name" data-ref="name"></span>
                    <span class="rts-up-type">出兵建筑</span>
                </div>
                <div class="rts-up-row"><span>HP</span><div class="rts-up-track"><div class="rts-up-fill" data-ref="hpFill" style="background:#e04a3a;"></div></div><span class="rts-up-num" data-ref="hp"></span></div>
                <div data-ref="unitType" style="margin-top:9px;color:#c7d0dc;font-size:12px;"></div>
                <div data-ref="rally" style="margin-top:8px;color:#f0cf78;font-size:12px;line-height:1.5;"></div>
                <div data-ref="hint" style="margin-top:7px;color:#8f9bad;font-size:11px;"></div>`;
            const attr = (key) => this._panel.querySelector(`[data-ref="${key}"]`);
            this._dom = {
                producer: true,
                name: attr('name'),
                hpFill: attr('hpFill'),
                hp: attr('hp'),
                unitType: attr('unitType'),
                rally: attr('rally'),
                hint: attr('hint'),
            };
            return;
        }
        if (this._selection.length > 1) {
            this._panel.innerHTML = `<div class="rts-up-head"><span class="rts-up-name" data-ref="count"></span></div>
                <div class="rts-up-multi" data-ref="multi"></div>`;
            this._dom = {
                count: this._panel.querySelector('[data-ref="count"]'),
                multi: this._panel.querySelector('[data-ref="multi"]'),
            };
            return;
        }
        this._panel.innerHTML = `
            <div class="rts-up-head">
                <span class="rts-up-name" data-ref="name"></span>
                <span class="rts-up-lv" data-ref="lv"></span>
                <span class="rts-up-type" data-ref="type"></span>
            </div>
            <div class="rts-up-row"><span>HP</span><div class="rts-up-track"><div class="rts-up-fill" data-ref="hpFill" style="background:#e04a3a;"></div></div><span class="rts-up-num" data-ref="hp"></span></div>
            <div class="rts-up-row"><span>MP</span><div class="rts-up-track"><div class="rts-up-fill" data-ref="mpFill" style="background:#3a7fe0;"></div></div><span class="rts-up-num" data-ref="mp"></span></div>
            <div class="rts-up-grid">
                <span data-ref="s:str"></span><span data-ref="s:dex"></span>
                <span data-ref="s:int"></span><span data-ref="s:con"></span>
                <span data-ref="s:wis"></span><span data-ref="s:luck"></span>
            </div>
            <div class="rts-up-stats">
                <span data-ref="atk"></span> · <span data-ref="matk"></span> · <span data-ref="def"></span> · <span data-ref="spd"></span>
            </div>`;
        const q = (r) => this._panel.querySelector(r);
        const attr = (k) => q(`[data-ref="${k}"]`);
        this._dom = {
            name: attr('name'), lv: attr('lv'), type: attr('type'),
            hpFill: attr('hpFill'), hp: attr('hp'),
            mpFill: attr('mpFill'), mp: attr('mp'),
            stats: {
                str: attr('s:str'), dex: attr('s:dex'), int: attr('s:int'),
                con: attr('s:con'), wis: attr('s:wis'), luck: attr('s:luck'),
            },
            atk: attr('atk'), matk: attr('matk'), def: attr('def'), spd: attr('spd'),
        };
    },

    /** 实时数值提取：HP/MP 每帧读实体；友军（Companion）每帧重算战斗属性（幂等）；
     *  攻击优先读单位实际攻击配置（仓鼠 ai.attackDamage），回落公式 atk */
    _readStats(e) {
        const d = e.data || {};
        const isEnemy = e._faction === 'enemy' || e._faction === 'agent';
        // 友军每帧重算装备与等级加成；敌人保持当前战斗状态。
        if (!isEnemy && typeof e.calculateCombatStats === 'function') {
            try { e.calculateCombatStats(); } catch (_err) { /* 重算失败时读取旧值 */ }
        }
        const hp = Math.max(0, Math.round(e.hp ?? d.hp ?? 0));
        const maxHp = Math.round(e.maxHp ?? d.maxHp ?? hp);
        const mp = Math.max(0, Math.round(e.mp ?? d.mp ?? 0));
        const maxMp = Math.round(e.maxMp ?? d.maxMp ?? mp);
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
        const surface = this._surfaceLabel(e);
        return {
            name: e.name || d.name || (isEnemy ? '敌人' : '友军'),
            level: e.level ?? d.level ?? 1,
            type: surface ? `${baseType} · ${surface}` : baseType,
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
        if (this._selection.length === 1 && this._selection[0].kind === 'producer') {
            const producer = this._selection[0].ref;
            const hp = Math.max(0, Math.round(producer.hp ?? producer.data?.hp ?? 0));
            const maxHp = Math.max(1, Math.round(producer.maxHp ?? producer.data?.maxHp ?? hp));
            const rally = TroopLineSystem.getProducerRally(producer, this._scene);
            this._dom.name.textContent = producer.name || producer._cfg?.name || '出兵建筑';
            this._dom.hpFill.style.width = `${Math.max(0, Math.min(100, Math.round(hp / maxHp * 100)))}%`;
            this._dom.hp.textContent = `${hp}/${maxHp}`;
            const unitName = typeof producer.unitName === 'function'
                ? producer.unitName(producer.unitType)
                : producer.unitType;
            this._dom.unitType.textContent = `当前出兵：${unitName || '未配置'}`;
            this._dom.rally.textContent = rally
                ? `独立集结：(${Math.round(rally.x)}, ${Math.round(rally.y)}) · 优先于全局兵线`
                : '独立集结：未设置（沿用左侧兵线控制）';
            this._dom.hint.textContent = TechnologySystem.isUnlocked('mechanic', 'troop_rally')
                ? '右键可达位置设置本建筑独立集结点'
                : '需要先研发集结战术';
            return;
        }
        if (this._selection.length > 1) {
            this._dom.count.textContent = `已选择 ${this._selection.length} 个单位`;
            // 按单位类型分组统计。
            const groups = new Map();
            for (const s of this._selection) {
                const e = s.ref;
                const label = s.kind === 'ally'
                    ? (e.name || e.title || '友军')
                    : (e.name || e.type || '敌人');
                groups.set(label, (groups.get(label) || 0) + 1);
            }
            this._dom.multi.textContent = Array.from(groups.entries())
                .map(([label, n]) => `${label} ×${n}`)
                .join(' · ');
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
                this._dom.multi.textContent += ` · 层级：${surfaceText}`;
            }
            return;
        }
        const st = this._readStats(this._selection[0].ref);
        const d = this._dom;
        d.name.textContent = st.name;
        d.lv.textContent = `Lv.${st.level}`;
        d.type.textContent = st.type;
        const hpPct = st.maxHp > 0 ? Math.round((st.hp / st.maxHp) * 100) : 0;
        const mpPct = st.maxMp > 0 ? Math.round((st.mp / st.maxMp) * 100) : 0;
        d.hpFill.style.width = `${Math.max(0, Math.min(100, hpPct))}%`;
        d.mpFill.style.width = `${Math.max(0, Math.min(100, mpPct))}%`;
        d.hp.textContent = `${st.hp}/${st.maxHp}`;
        d.mp.textContent = `${st.mp}/${st.maxMp}`;
        d.stats.str.textContent = `力量 ${st.str}`;
        d.stats.dex.textContent = `敏捷 ${st.dex}`;
        d.stats.int.textContent = `智力 ${st.int}`;
        d.stats.con.textContent = `体质 ${st.con}`;
        d.stats.wis.textContent = `精神 ${st.wis}`;
        d.stats.luck.textContent = `幸运 ${st.luck}`;
        d.atk.textContent = `攻击 ${st.atk}`;
        d.matk.textContent = `魔攻 ${st.matk}`;
        d.def.textContent = `防御 ${st.def}`;
        d.spd.textContent = `移速 ${st.speed}`;
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
