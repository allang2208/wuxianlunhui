// ============================================================
// RTS 指挥模式（RTSCommand，2026-08-16）
// 需求（用户）：世界-122 组队栏下方 5px 新增「指挥模式」按钮，点击进入后像 RTS 操作：
//  - 左键单击选择目标（友军/敌人），显示属性面板（生命/魔法/六维/攻击/防御/移速）；
//  - 右键空地 = 选中友军移动到目标区域；右键敌方目标 = 选中友军对其发起进攻；
//  - 单击空地取消选择；长按左键拖框 = 框选区域内单位（不含建筑）；
//  - 左键单击建筑仍走既有建筑详情面板。
// 集成：game.js Game.init() 调 init()；Game.update 每帧调 tick(sceneId)（scene8 启用时
// 接管输入并禁用玩家攻击/瞄准）。避免循环 import：建筑/防守系统全部经 window.Game 惰性访问。
// ============================================================

import { PartySystem } from '../systems/party-system.js';
import { Renderer } from '../world/renderer.js';
import { Camera } from '../world/camera.js';
import { CONFIG } from '../config/config.js';
import { getUnitKind } from '../world/unit-upgrade-store.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';

const DRAG_THRESHOLD = 6; // 屏幕 px：超过判定为拖框
const POINTER_BLOCK_SELECTOR = [
    '.system-panel', '.panel-overlay', '.side-menu', '.back-menu-btn', '.menu-btn',
    '.party-bar', '.rts-unit-panel', '.rts-command-btn', '.companion-overlay',
    '.recruit-overlay', '.wall-editor-panel', '.world-switch-panel',
    '.hamster-hut-panel', '.hamster-barracks-panel', '.producer-building-panel',
].join(', ');

const _game = () => (typeof window !== 'undefined' ? window.Game : null);
const _scene = () => (typeof window !== 'undefined' ? window.__phaserScene : null);

export const RTSCommand = {
    enabled: false,
    _btn: null,
    _panel: null,
    _selection: [],        // [{ kind: 'ally' | 'enemy', ref }]
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
    _domSig: null,         // 属性面板 DOM 签名（目标变化才重建；数值每帧原地更新）
    _dom: null,            // 属性面板 DOM 引用（hp/mp 条、六维、战斗属性 span）
    _lastClick: null,      // 双击同类复选（{at, ref}）
    _flatHitCycle: null,   // 压平视图同屏重叠单位轮换（墙上/墙下候选保持固定次序）
    _mouseSeen: false,       // 见过真实鼠标移动才允许边缘平移（无头/未动鼠标防漂）
    _pointerOverUi: false,
    _groups: null,         // 编队：digit -> [友军 ref]（Ctrl+数字编 / Shift+数字加 / 数字选中）
    _pendingRightClick: null, // RTS 自己捕获右键，避免依赖 Input 边沿标志而漏命令

    init() {
        this._createButton();
        this._createPanel();
        this._enemyRings = new Map();
        this._allyRings = new Map();
        window.addEventListener('mousedown', (e) => this._onMouseDown(e));
        window.addEventListener('mousemove', (e) => this._onMouseMove(e));
        window.addEventListener('mouseup', (e) => this._onMouseUp(e));
        window.addEventListener('keydown', (e) => this._onKeyDown(e), true); // capture：先于快捷栏数字键
        window.addEventListener('mousemove', () => { this._mouseSeen = true; }, { passive: true });
        this._groups = new Map();
        this.setEnabled(false);
    },

    /** game.js 每帧调用（所有场景）：同步场景、非 scene8 自动退出、刷新渲染/面板。
     *  Input 由 game.js 传入（模块实例；window.Input 未挂载，勿依赖全局） */
    tick(sceneId, Input, dt) {
        const g = _game();
        const observer = !!(g && g._observerMode);
        // 指挥模式可用域：世界-122 或观察模式下的任意世界（2026-08-19）
        const commandable = sceneId === 'scene8' || observer;
        const leavingScene8 = this._scene === 'scene8' && sceneId !== 'scene8';
        this._scene = sceneId;
        if (this._btn) this._btn.style.display = commandable ? '' : 'none';
        if (leavingScene8 && !observer) this._resetPartyCommandsForSceneExit();
        if (!commandable && this.enabled) this.setEnabled(false);
        if (!this.enabled) return;
        this._pruneSelection();
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
    },

    _input() {
        // input.js 模块未静态 import（避免与 game.js 循环），经全局访问
        return (typeof window !== 'undefined' && window.Input) ? window.Input : null;
    },

    setEnabled(on) {
        if (on) this._closeBuildingUI();
        this.enabled = !!on;
        // 模式切换前可能已有 Space 留在 Input.keys（例如键盘激活仍聚焦的指挥按钮）；
        // 无论进入还是退出都先清掉，禁止角色把同一次空格解释成翻滚。
        const input = _game()?.Input || this._input();
        input?.keys?.delete?.('Space');
        if (this._btn) this._btn.classList.toggle('active', this.enabled);
        if (!this.enabled) {
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
    },

    /** 跨场景时清除 scene8 世界坐标/实体引用，防止队员在新场景继续执行旧命令。 */
    _resetPartyCommandsForSceneExit() {
        if (!PartySystem) return;
        PartySystem.setCommand('all', 'follow');
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
        this._placeButton();
        // 组队栏/窗口尺寸变化时重新定位（下方 5px）
        window.addEventListener('resize', () => this._placeButton());
    },

    _placeButton() {
        if (!this._btn) return;
        const bar = document.getElementById('partyBar');
        const top = bar ? bar.getBoundingClientRect().bottom + 5 : 225;
        this._btn.style.top = `${top}px`;
        this._btn.style.left = '10px';
        this._btn.style.width = '220px';
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
    },

    _hidePanel() {
        if (this._panel) this._panel.style.display = 'none';
    },

    /** 互斥接口：面板当前是否显示（供 game.js 仲裁：建筑界面打开时关闭本面板） */
    hasPanel() {
        return !!(this._panel && this._panel.style.display !== 'none');
    },

    /** 互斥接口：仅隐藏单位/复数面板（保留选择与选中光圈） */
    closePanel() {
        this._hidePanel();
    },

    /** 关闭全部建筑选择/详情界面（B 面板 / 防御塔 / 陷阱 / 小屋 / 兵营） */
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
        this._selection = this._selection.filter((s) => {
            if (!s.ref || !s.ref.active) return false;
            return s.kind === 'ally' ? allies.has(s.ref) : worldEntities.has(s.ref);
        });
        if (before !== this._selection.length) {
            this._syncPartySelection();
            this._renderSelectionFx();
            this._domSig = null;
        }
    },

    _setSelection(list) {
        this._selection = (list || []).filter((s) => s && s.ref && s.ref.active);
        // 互斥（2026-08-16）：单位详细 / 复数选择界面打开时，关闭建筑选择界面
        this._closeBuildingUI();
        this._syncPartySelection();
        this._renderSelectionFx();
        this._domSig = null;
        this._refreshPanel();
    },

    _clearSelection() {
        if (!this._selection.length) return;
        this._selection = [];
        this._syncPartySelection();
        this._renderSelectionFx();
        this._hidePanel();
        this._domSig = null;
    },

    /** 友军选中同步组队栏（PartySystem.selectedIds → 组队栏高亮 + GameScene 金色光圈） */
    _syncPartySelection() {
        if (!PartySystem) return;
        const allyIds = this._selection.filter((s) => s.kind === 'ally').map((s) => s.ref.id);
        PartySystem.setSelected(allyIds);
    },

    // ==================== 命中 / 框选 ====================

    /** 全部友军单位：PartySystem 侍从 + 场上 player/companion 阵营实体（仓鼠单位等），
     *  排除玩家本人 / 建筑 / 掉落物 / 传送门 / NPC / 能源点 */
    _collectAllies() {
        const allies = [];
        const seen = new Set();
        const g = _game();
        // 观察世界没有玩家本体及随行队员，不能把本体世界的 PartySystem 对象当作幽灵单位选中。
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
            // 同一屏幕位置优先墙顶/较高单位；后续重复点击可在固定候选序列中轮换。
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

    /** 可见单位点击/框选矩形：覆盖身体而不只认逻辑脚底小圆。 */
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

    /** 建筑点击（2026-08-16 指挥模式无视距离）：复用既有详情面板——防御塔/陷阱/
     *  小屋/兵营临时以建设模式口径调用（内部 buildMode 跳过 260px 距离检查）；
     *  掩体/门走 BuildingSystem 详情（确保 B 面板 DOM 存在并置 active）。 */
    _tryBuildingClick(sx, sy) {
        const g = _game();
        const p = g ? g.player : null;
        if (!g) return false;
        const prevBuild = g._buildMode;
        g._buildMode = true; // 指挥模式无视距离（try/finally 恢复）
        try {
            if (g.DefenseTrapSystem && g.DefenseTrapSystem.tryInteract && g.DefenseTrapSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
            if (g.DefenseSystem && g.DefenseSystem.active && g.DefenseSystem.tryInteract && g.DefenseSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
            if (g.HamsterHutSystem && g.HamsterHutSystem.active && g.HamsterHutSystem.tryInteract && g.HamsterHutSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
            if (g.HamsterBarracksSystem && g.HamsterBarracksSystem.active && g.HamsterBarracksSystem.tryInteract && g.HamsterBarracksSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
            if (g.ProducerBuildingSystem && g.ProducerBuildingSystem.active && g.ProducerBuildingSystem.tryInteract && g.ProducerBuildingSystem.tryInteract(sx, sy, p)) { this.setEnabled(false); return true; }
        } finally {
            g._buildMode = prevBuild;
        }
        // 掩体/铁栅栏门：BuildingSystem 详情（原本要求 B 面板 active；指挥模式下直接弹）
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

    // ==================== 鼠标事件 ====================

    _isCommandable() {
        const g = _game();
        return this._scene === 'scene8' || !!g?._observerMode;
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
            // 单击：单位（双击同类全选）→ 建筑 → 空地取消
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
            } else if (this._tryBuildingClick(e.clientX, e.clientY)) {
                // 互斥：打开建筑界面 → 关闭单位/复数面板（保留选择）
                this._hidePanel();
            } else {
                this._clearSelection();
                this._hidePanel();
            }
        }
        this._clearDrag();
    },

    _clearDrag() {
        this._down = false;
        this._dragging = false;
        if (this._boxG) this._boxG.clear();
    },

    // ==================== 边缘平移 / 双击复选 / 编队（2026-08-19 RTS 化） ====================

    /** 边缘平移：鼠标贴屏幕四缘（24px）→ 相机平移（900 world px/s，dt 缩放）。 */
    _edgePan(dt, Input) {
        const input = Input || this._input();
        const m = input && input.mouse;
        if (!this._mouseSeen) return; // 无头环境/未动鼠标：默认 (0,0) 会被误判成贴左上缘
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

    /** 编队键（Ctrl+数字编 / Shift+数字加选 / 数字选中；capture 阶段先于快捷栏） */
    _onKeyDown(e) {
        if (!this.enabled) return;
        const g = _game();
        if (!g || !(g._observerMode || this._scene === 'scene8')) return;
        const m = /^Digit([0-9])$/.exec(e.code);
        if (!m) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        const d = m[1];
        if (e.ctrlKey || e.metaKey) {
            const refs = this._selection.filter((s) => s.kind === 'ally').map((s) => s.ref);
            if (!refs.length) return;
            this._groups.set(d, refs);
            this._groupNotify(d, refs.length, '编入');
            e.preventDefault(); e.stopImmediatePropagation();
        } else if (e.shiftKey) {
            const add = this._selection.filter((s) => s.kind === 'ally').map((s) => s.ref);
            if (!add.length) return;
            const cur = this._groups.get(d) || [];
            const merged = [...new Set([...cur, ...add])];
            this._groups.set(d, merged);
            this._groupNotify(d, merged.length, '加编');
            e.preventDefault(); e.stopImmediatePropagation();
        } else {
            const selectable = new Set(this._collectAllies());
            const grp = (this._groups.get(d) || []).filter((u) => u && u.active && selectable.has(u));
            if (!grp.length) return;
            this._groups.set(d, grp); // 顺手清死
            this._setSelection(grp.map((ref) => ({ kind: 'ally', ref })));
            this._groupNotify(d, grp.length, '选中');
            e.preventDefault(); e.stopImmediatePropagation();
        }
    },

    _groupNotify(digit, n, verb) {
        EffectManager.add(new FloatingTextEffect(Camera.x, Camera.y - 120, `${verb}编队 ${digit}（${n} 单位）`, '#8ad0ff'));
    },

    /** 双击同类复选（SC2 口径）：屏幕上所有同类型友军全选 */
    _selectSameTypeOnScreen(ref) {
        const key = this._unitTypeKey(ref);
        if (!key) { this._setSelection([{ kind: 'ally', ref }]); return; }
        const vw = window.innerWidth, vh = window.innerHeight;
        const list = [];
        for (const u of this._collectAllies()) {
            if (this._unitTypeKey(u) !== key) continue;
            const r = this._unitScreenRect(u);
            if (!r) continue;
            if (r.x1 < 0 || r.y1 < 0 || r.x0 > vw || r.y0 > vh) continue; // 屏幕外不选
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

    /** 轮盘指令统一出口（指挥模式）：队友走 PartySystem，仓鼠等非成员按映射直写 _command。
     *  返回生效单位数（供轮盘通知）。 */
    issueWheelCommand(mode, point) {
        const memberIds = [];
        const direct = [];
        for (const s of this._selection) {
            if (s.kind !== 'ally') continue;
            if (PartySystem.members.includes(s.ref)) memberIds.push(s.ref.id);
            else direct.push(s.ref);
        }
        let n = 0;
        if (memberIds.length) n += PartySystem.setCommand(memberIds, mode, point);
        for (const u of direct) {
            const mapped = this._mapWheelModeForUnit(u, mode, point);
            if (!mapped) continue;
            if (u._ai && typeof u._ai.cancelForCommand === 'function') u._ai.cancelForCommand();
            u._command = mapped;
            n++;
        }
        return n;
    },

    /** 轮盘五指令 → 仓鼠单位指令映射（仓鼠 AI 只消费 move/attack/hold/follow）：
     *  aggressive（自由索敌）= 仓鼠默认行为 → follow；patrol ≈ move 到指令点驻守；
     *  gather 仅矿工有意义（回默认自动采矿），战斗单位忽略。 */
    _mapWheelModeForUnit(u, mode, point) {
        if (mode === 'follow' || mode === 'aggressive') return { mode: 'follow' };
        if (mode === 'hold') return { mode: 'hold', point: null, target: null };
        if (mode === 'patrol') return { mode: 'move', point: point ? { x: point.x, y: point.y } : null, target: null };
        if (mode === 'gather') return u._isHamsterMiner ? { mode: 'follow' } : null;
        return null;
    },

    /** 右键：空地 = 选中友军移动；命中敌人 = 选中友军对其进攻 */
    _handleRightClick(sx, sy) {
        const w = Renderer.screenToWorld(sx, sy);
        if (!w) return;
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
                // 无友军选中：右键敌人 = 选中并查看属性
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
     *  仓鼠等非成员单位直接写 _command（hamster-*-ai 消费） */
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

    /** 右键攻击指令反馈：目标贴图短暂红/白交替闪现。实际 tint 由 GameScene 每帧统一应用。 */
    _flashAttackTarget(target) {
        if (!target || !target.active) return;
        const now = Date.now();
        target._rtsAttackFlashStartedAt = now;
        target._rtsAttackFlashUntil = now + 720;
    },

    // ==================== 渲染（拖框 + 敌人选中光圈） ====================

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

        // 敌人选中红圈（脚下椭圆，深度跟随精灵）
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
            // 深度：优先跟随精灵（精灵-0.1，与脚下光圈同口径）；无精灵引用兜底按世界 y
            ring.setDepth(sp && sp.active ? sp.depth - 0.1 : e.y);
        }
        for (const [e, ring] of this._enemyRings) {
            if (!alive.has(e)) { ring.destroy(); this._enemyRings.delete(e); }
        }

        // 友军选中金圈（2026-08-16 用户口径：与组队栏选中同款黄圈）。组队侍从由
        // GameScene._selectionRings（PartySystem.isSelected）负责；这里只给非成员
        // 友军（仓鼠战士/盾卫/射手/矿工等）补同款金圈，避免成员脚下双圈重影。
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
    },

    // ==================== 属性面板 ====================

    /** 每帧刷新：目标变化才重建 DOM，数值（HP/MP/六维/战斗属性）原地实时更新，
     *  友军每帧重算战斗属性（calculateCombatStats 幂等，含装备/等级/建筑加成实时反显） */
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
        // 友军每帧重算（装备/等级/属性加成实时反显）；敌人不可重算（会重置 HP）
        if (!isEnemy && typeof e.calculateCombatStats === 'function') {
            try { e.calculateCombatStats(); } catch (_err) { /* 重算失败读旧值 */ }
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
        if (this._selection.length > 1) {
            this._dom.count.textContent = `已选择 ${this._selection.length} 个单位`;
            // 按单位类型分组统计（2026-08-16 用户口径：仓鼠战士 ×5 / 仓鼠盾卫 ×3 …）
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
                this._dom.multi.textContent += ` ｜ 层级：${surfaceText}`;
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
