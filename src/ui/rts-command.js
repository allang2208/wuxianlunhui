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

const DRAG_THRESHOLD = 6; // 屏幕 px：超过判定为拖框

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

    init() {
        this._createButton();
        this._createPanel();
        this._enemyRings = new Map();
        this._allyRings = new Map();
        window.addEventListener('mousedown', (e) => this._onMouseDown(e));
        window.addEventListener('mousemove', (e) => this._onMouseMove(e));
        window.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.setEnabled(false);
    },

    /** game.js 每帧调用（所有场景）：同步场景、非 scene8 自动退出、刷新渲染/面板。
     *  Input 由 game.js 传入（模块实例；window.Input 未挂载，勿依赖全局） */
    tick(sceneId, Input) {
        this._scene = sceneId;
        if (this._btn) this._btn.style.display = sceneId === 'scene8' ? '' : 'none';
        if (sceneId !== 'scene8' && this.enabled) this.setEnabled(false);
        if (!this.enabled) return;
        const input = Input || this._input();
        if (input && input.mouse && input.mouse.rightPressed) {
            this._handleRightClick(input.mouse.x, input.mouse.y);
            input.mouse.rightPressed = false;
        }
        this._pruneSelection();
        this._renderSelectionFx();
        this._refreshPanel();
    },

    _input() {
        // input.js 模块未静态 import（避免与 game.js 循环），经全局访问
        return (typeof window !== 'undefined' && window.Input) ? window.Input : null;
    },

    setEnabled(on) {
        this.enabled = !!on;
        if (this._btn) this._btn.classList.toggle('active', this.enabled);
        if (!this.enabled) {
            this._clearSelection();
            this._hidePanel();
            this._clearDrag();
        }
        this._renderSelectionFx();
    },

    // ==================== 按钮 / 面板 DOM ====================

    _createButton() {
        if (this._btn) return;
        const btn = document.createElement('button');
        btn.id = 'rtsCommandBtn';
        btn.className = 'rts-command-btn';
        btn.textContent = '⚔ 指挥模式';
        btn.title = '进入 RTS 指挥模式：左键选择/框选，右键移动/攻击，单击空地取消';
        btn.addEventListener('click', () => this.setEnabled(!this.enabled));
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
        this._selection = this._selection.filter((s) => s.ref && s.ref.active);
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
        for (const m of PartySystem.members) {
            if (!m || !m.active) continue;
            allies.push(m);
            seen.add(m);
        }
        const g = _game();
        if (!g || !g.entities) return allies;
        for (const e of g.entities.values()) {
            if (!e || !e.active || seen.has(e) || e === g.player) continue;
            const f = e._faction;
            if (f !== 'player' && f !== 'companion' && f !== 'ally' && f !== 'friendly') continue;
            if (e._isDefenseStructure || e._isFiringPlatform || e._isEnergyNode) continue;
            if (e.itemData || e.targetScene || e.npcType || e._isNPC) continue;
            allies.push(e);
        }
        return allies;
    },

    _hitUnitAt(sx, sy) {
        const w = Renderer.screenToWorld(sx, sy);
        if (!w) return null;
        let best = null;
        let bestD = Infinity;
        for (const m of this._collectAllies()) {
            const d = Math.hypot(m.x - w.x, m.y - w.y);
            const r = (m.collisionRadius || 26) + 6;
            if (d <= r && d < bestD) { bestD = d; best = { kind: 'ally', ref: m }; }
        }
        const g = _game();
        if (g && g.entities) {
            for (const e of g.entities.values()) {
                if (!e || !e.active) continue;
                if (e._faction !== 'enemy' && e._faction !== 'agent') continue;
                const d = Math.hypot(e.x - w.x, e.y - w.y);
                const r = (e.collisionRadius || 26) + 6;
                if (d <= r && d < bestD) { bestD = d; best = { kind: 'enemy', ref: e }; }
            }
        }
        return best;
    },

    _selectInRect(sx0, sy0, sx1, sy1) {
        const x0 = Math.min(sx0, sx1), y0 = Math.min(sy0, sy1);
        const x1 = Math.max(sx0, sx1), y1 = Math.max(sy0, sy1);
        const sel = [];
        for (const m of this._collectAllies()) {
            const p = Renderer.worldToScreen(m.x, m.y);
            if (p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) sel.push({ kind: 'ally', ref: m });
        }
        const g = _game();
        if (g && g.entities) {
            for (const e of g.entities.values()) {
                if (!e || !e.active) continue;
                if (e._faction !== 'enemy' && e._faction !== 'agent') continue;
                const p = Renderer.worldToScreen(e.x, e.y);
                if (p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) sel.push({ kind: 'enemy', ref: e });
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
            if (g.DefenseTrapSystem && g.DefenseTrapSystem.tryInteract && g.DefenseTrapSystem.tryInteract(sx, sy, p)) return true;
            if (g.DefenseSystem && g.DefenseSystem.active && g.DefenseSystem.tryInteract && g.DefenseSystem.tryInteract(sx, sy, p)) return true;
            if (g.HamsterHutSystem && g.HamsterHutSystem.active && g.HamsterHutSystem.tryInteract && g.HamsterHutSystem.tryInteract(sx, sy, p)) return true;
            if (g.HamsterBarracksSystem && g.HamsterBarracksSystem.active && g.HamsterBarracksSystem.tryInteract && g.HamsterBarracksSystem.tryInteract(sx, sy, p)) return true;
            if (g.ProducerBuildingSystem && g.ProducerBuildingSystem.active && g.ProducerBuildingSystem.tryInteract && g.ProducerBuildingSystem.tryInteract(sx, sy, p)) return true;
        } finally {
            g._buildMode = prevBuild;
        }
        // 掩体/铁栅栏门：BuildingSystem 详情（原本要求 B 面板 active；指挥模式下直接弹）
        const bs = g.BuildingSystem;
        const mw = Renderer.screenToWorld(sx, sy);
        if (bs && mw && typeof bs._hitTestCover === 'function' && typeof bs._showDetail === 'function') {
            const hit = bs._hitTestCover(mw.x, mw.y);
            if (hit) {
                if (!bs._panel && typeof bs._buildPanel === 'function') bs._buildPanel();
                bs.active = true; // 保持打开，用户可查看/关闭
                bs._showDetail(hit);
                return true;
            }
        }
        return false;
    },

    // ==================== 鼠标事件 ====================

    _onMouseDown(e) {
        if (!this.enabled || this._scene !== 'scene8') return;
        if (e.target && e.target.closest && e.target.closest('.system-panel, .panel-overlay, .side-menu, .party-bar, .rts-unit-panel, .rts-command-btn, .companion-overlay, .recruit-overlay')) return;
        if (e.button !== 0) return;
        this._down = true;
        this._downX = e.clientX;
        this._downY = e.clientY;
        this._dragging = false;
    },

    _onMouseMove(e) {
        if (!this.enabled || this._scene !== 'scene8' || !this._down) return;
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
        if (!this.enabled || this._scene !== 'scene8' || !this._down) return;
        this._down = false;
        if (e.button !== 0) return;
        if (this._dragging) {
            this._setSelection(this._selectInRect(this._downX, this._downY, e.clientX, e.clientY));
        } else {
            // 单击：单位 → 建筑 → 空地取消
            const hit = this._hitUnitAt(e.clientX, e.clientY);
            if (hit) {
                this._setSelection([hit]);
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

    /** 右键：空地 = 选中友军移动；命中敌人 = 选中友军对其进攻 */
    _handleRightClick(sx, sy) {
        const w = Renderer.screenToWorld(sx, sy);
        if (!w) return;
        const hit = this._hitUnitAt(sx, sy);
        const phaser = _scene();
        if (hit && hit.kind === 'enemy') {
            if (this._selection.some((s) => s.kind === 'ally')) {
                this._issueCommandToAllies('attack', null, hit.ref);
                if (phaser && typeof phaser.showMoveMarker === 'function') phaser.showMoveMarker(hit.ref.x, hit.ref.y);
            } else {
                // 无友军选中：右键敌人 = 选中并查看属性
                this._setSelection([hit]);
            }
        } else if (this._selection.some((s) => s.kind === 'ally')) {
            this._issueCommandToAllies('move', { x: w.x, y: w.y }, null);
            if (phaser && typeof phaser.showMoveMarker === 'function') phaser.showMoveMarker(w.x, w.y);
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
        if (memberIds.length) PartySystem.setCommand(memberIds, mode, point, target);
        for (const u of directUnits) {
            u._command = {
                mode,
                point: point ? { x: point.x, y: point.y } : null,
                target: (mode === 'attack' && target) ? target : null,
            };
        }
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
            ring.setPosition(e.x, e.y);
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
            ring.setPosition(e.x, e.y);
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
        if (e.ai && typeof e.ai.attackDamage === 'number') atk = String(Math.round(e.ai.attackDamage));
        else if (typeof d.atk === 'number' && d.atk > 0) atk = String(Math.round(d.atk));
        else atk = this._enemyAttackText(e);
        const matk = typeof d.matk === 'number' ? Math.round(d.matk) : '—';
        const def = typeof d.def === 'number' ? Math.round(d.def) : (e.def ?? e.mdef ?? '—');
        const speed = Math.round(e.maxSpeed ?? e.speed ?? 0) || '—';
        return {
            name: e.name || d.name || (isEnemy ? '敌人' : '友军'),
            level: e.level ?? d.level ?? 1,
            type: isEnemy ? (e.type || '敌人') : (e.title || '友军'),
            hp, maxHp, mp, maxMp,
            str: num('str'), dex: num('dex'), int: num('int'),
            con: num('con'), wis: num('wis'), luck: num('luck'),
            atk, matk, def, speed,
        };
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
