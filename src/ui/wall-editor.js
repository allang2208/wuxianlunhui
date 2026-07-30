/**
 * 墙壁可视化编辑器（摆墙模式）
 *
 * 面板（右侧）两栏：
 * - 标准组件：环境组件（墙壁 family）缩略图，拖入场景按默认大小放置；
 *   滚轮调整大小，Ctrl+滚轮水平镜像
 * - 预制组件：自己保存的预设方案，一键放置/删除
 *
 * 框选模式：「框选」按钮开启后长按拖动出选框，选中范围内环境组件（墙壁），
 * 选中件黑白交替闪烁；选中后可整组拖动、滚轮统一缩放、Ctrl+滚轮整组镜像，
 * 支持命名存为预设方案 / 一键删除。
 */
import { WallSystem, ISO_WALL_GEO, ISO_WALL_HEIGHT, slopeFixOf } from '../world/wall-system.js';
import { loadWallPrefabs, getWallPrefabLibrary, saveWallPrefabs, saveObstacleLayout, getObstacleDefaults, saveObstacleDefaults, saveGameConfig } from '../world/wall-prefabs.js';
import { GAME_CONFIG } from '../config/game-config.js';
import { CONFIG } from '../config/config.js';

// 标准组件库（三大分类页签：墙类 / 门类 / 障碍物类）
// 墙壁组件自动生成：ISO_WALL_GEO 条目带 editor 显示名即进面板（新墙/门组件加 editor 字段即可，无需改本文件）
// 分类规则：category==='obstacle' → 障碍物类；gateX → 门类；其余 → 墙类
const _GEO_EDITORS = Object.values(ISO_WALL_GEO).filter(g => g.editor);
const STD_COMPONENTS = [
    {
        family: '墙类', id: 'wall',
        items: _GEO_EDITORS.filter(g => g.category !== 'obstacle' && !g.gateX)
            .map(g => ({ tex: g.tex, name: g.editor })),
    },
    {
        family: '门类', id: 'gate',
        items: _GEO_EDITORS.filter(g => g.category !== 'obstacle' && g.gateX)
            .map(g => ({ tex: g.tex, name: g.editor })),
    },
    {
        family: '障碍物类', id: 'obstacle',
        items: _GEO_EDITORS.filter(g => g.category === 'obstacle')
            .map(g => ({ tex: g.tex, name: g.editor })),
    },
];

// 贴图键 → 图层命名前缀（ISO_WALL_GEO.editor 自动生成 + 旧贴图补充）
const TEX_NAMES = {
    wall_diag: '直墙',
    ...Object.fromEntries(Object.values(ISO_WALL_GEO).filter(g => g.editor).map(g => [g.tex, g.editor])),
};

// 拼接吸附叠合量（世界像素）：B 沿走向回退，保证接缝只叠不缺（face 锚点有拟合公差）
const SNAP_OVERLAP = 8;

/** 深拷贝件并剔除运行时引用 */
function cleanPiece(p) {
    const c = { ...p };
    delete c._sprite;
    return c;
}

export const WallEditor = {
    active: false,
    sel: [],               // 当前选中件（单选/框选统一为集合）
    _boxMode: false,       // 框选模式开关
    _boxing: false,
    _boxStart: { x: 0, y: 0 },
    _boxGfx: null,
    _dragging: false,
    _dragStart: { x: 0, y: 0 },
    _dragOrig: [],
    _pendingPiece: null,   // 缩略图拖放中的临时件
    _ghost: null,
    _panel: null,
    _layersEl: null,
    _layerList: null,
    _wheelFn: null,
    _keyFn: null,
    _placeUpFn: null,
    _commitTimer: 0,
    _blinkT: 0,
    _blinkOn: false,
    // ===== NPC 拖动 / NPC 位置编辑器（摆墙模式下单选一个 NPC）=====
    _npcSel: null,         // 当前选中的 NPC 实体（与墙件选中互斥）
    _draggingNpc: false,
    _npcDragOrig: { x: 0, y: 0 },
    _npcEl: null,          // NPC 位置编辑器面板 DOM

    toggle() {
        if (this.active) this.close();
        else this.open();
    },

    open() {
        const scene = window.__phaserScene;
        if (!scene || this.active) return;
        this.active = true;
        if (window.Game) window.Game._wallEditMode = true;
        loadWallPrefabs().then(() => this._refreshPrefabList());
        this._buildPanel();
        this._boxGfx = scene.add.graphics().setDepth(999999);
        // 注意：项目 Phaser 配置 input.mouse=false（鼠标插件禁用），指针事件必须走 DOM
        this._downFn = (e) => this._onMouseDown(e);
        this._moveFn = (e) => this._onMouseMove(e);
        this._upFn = (e) => this._onMouseUp(e);
        window.addEventListener('mousedown', this._downFn);
        window.addEventListener('mousemove', this._moveFn);
        window.addEventListener('mouseup', this._upFn);
        scene.events.on('update', this._onTick, this);
        this._wheelFn = (e) => this._onWheel(e);
        window.addEventListener('wheel', this._wheelFn, { passive: false });
        this._keyFn = (e) => this._onKey(e);
        window.addEventListener('keydown', this._keyFn, true);
    },

    close() {
        const scene = window.__phaserScene;
        if (!this.active) return;
        this.active = false;
        if (window.Game) window.Game._wallEditMode = false;
        this._cancelPlacement();
        if (scene) {
            scene.events.off('update', this._onTick, this);
        }
        if (this._downFn) {
            window.removeEventListener('mousedown', this._downFn);
            window.removeEventListener('mousemove', this._moveFn);
            window.removeEventListener('mouseup', this._upFn);
            this._downFn = this._moveFn = this._upFn = null;
        }
        if (this._wheelFn) window.removeEventListener('wheel', this._wheelFn);
        if (this._keyFn) window.removeEventListener('keydown', this._keyFn, true);
        clearTimeout(this._commitTimer);
        this._setSelection([]);
        this._clearNpcSel();
        this._draggingNpc = false;
        if (this._npcEl) { this._npcEl.remove(); this._npcEl = null; }
        if (this._boxGfx) { this._boxGfx.destroy(); this._boxGfx = null; }
        if (this._panel) { this._panel.remove(); this._panel = null; }
        if (this._obstacleEl) { this._obstacleEl.remove(); this._obstacleEl = null; }
        if (this._layersEl) { this._layersEl.remove(); this._layersEl = null; }
        this._layerList = null;
        this._boxMode = false;
        const btn = document.getElementById('wallEditorToggle');
        if (btn) btn.classList.remove('active');
    },

    /** 客户端坐标 → 世界坐标（含是否在画布内的判定；画布隐藏/尺寸为 0 时返回 null） */
    _clientToWorld(e) {
        const scene = window.__phaserScene;
        if (!scene) return null;
        const canvas = scene.game.canvas;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const p = scene.cameras.main.getWorldPoint(sx, sy);
        return {
            x: p.x, y: p.y,
            overCanvas: e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom,
        };
    },

    // ===== 选择与闪烁 =====
    _setSelection(arr) {
        for (const p of this.sel) {
            if (p._sprite) p._sprite.clearTint();
        }
        this.sel = arr;
        if (arr.length && this._npcSel) this._clearNpcSel(); // 墙件与 NPC 选中互斥
        this._blinkT = 0;
        this._updateInfo();
        this._refreshLayers();
        this._updateObstacleEditor();
    },

    _onTick(time) {
        if (!this.sel.length && !this._npcSel) return;
        if (time - this._blinkT > 250) {
            this._blinkT = time;
            this._blinkOn = !this._blinkOn;
            for (const p of this.sel) {
                if (p._sprite) p._sprite.setTint(this._blinkOn ? 0xffffff : 0x111111);
            }
            // 选中 NPC 同步闪烁（贴图 NPC 有效；纯色圆 NPC 每帧被 _syncNeutralEntities 重染色，闪烁被覆盖）
            const sp = this._npcSel ? this._npcSpriteOf(this._npcSel) : null;
            if (sp) sp.setTint(this._blinkOn ? 0xffffff : 0x111111);
        }
    },

    _hitTest(wx, wy) {
        let best = null;
        for (const p of WallSystem.isoVisuals) {
            if (!p._sprite) continue;
            if (p._sprite.getBounds().contains(wx, wy)) {
                if (!best || (p.depth ?? 0) > (best.depth ?? 0)) best = p;
            }
        }
        return best;
    },

    /** NPC 命中检测：Game.entities 里 npcType 非空、且有无专属贴图的 Phaser 精灵（_neutralSprites） */
    _hitTestNpc(wx, wy) {
        const scene = window.__phaserScene;
        const game = window.Game;
        if (!scene || !scene._neutralSprites || !game || !game.entities) return null;
        let best = null, bestDepth = -Infinity;
        for (const e of game.entities.values()) {
            if (!e || !e.npcType) continue;
            const sp = this._npcSpriteOf(e);
            if (!sp || !sp.active || !sp.visible) continue;
            if (sp.getBounds().contains(wx, wy) && sp.depth >= bestDepth) {
                best = e;
                bestDepth = sp.depth;
            }
        }
        return best;
    },

    /** NPC 实体 → 场景中的 Phaser 精灵（无则 null） */
    _npcSpriteOf(e) {
        const scene = window.__phaserScene;
        if (!scene || !scene._neutralSprites) return null;
        const data = scene._neutralSprites.get(e);
        return data ? data.sprite : null;
    },

    /** 清除 NPC 选中（还原贴图染色 + 隐藏 NPC 编辑器） */
    _clearNpcSel() {
        if (this._npcSel) {
            const sp = this._npcSpriteOf(this._npcSel);
            if (sp) sp.clearTint();
        }
        this._npcSel = null;
        this._updateNpcEditor();
    },

    /** 设置 NPC 选中（与墙件选中互斥；null=仅清除） */
    _setNpcSelection(npc) {
        if (npc) {
            for (const p of this.sel) {
                if (p._sprite) p._sprite.clearTint();
            }
            this.sel = [];
            this._updateInfo();
            this._refreshLayers();
            this._updateObstacleEditor();
        }
        this._clearNpcSel();
        this._npcSel = npc || null;
        this._updateNpcEditor();
    },

    _selCenter() {
        if (!this.sel.length) return { x: 0, y: 0 };
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of this.sel) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    },

    // ===== 鼠标（DOM 事件）：拖动 / 框选 / 放置跟随 =====
    _onMouseDown(e) {
        if (e.button !== 0 || this._pendingPiece) return;
        if (!(e.target instanceof Element)) return;
        if (e.target.closest('.wall-editor-panel, .wall-editor-layers, .obstacle-editor, .npc-editor')) return; // 面板/编辑器自有交互
        if (e.target.closest('button, input, select, .invincible-toggle, .attack-range-toggle, .dev-tool-trigger, .quick-slot, .side-menu-btn')) return;
        const pt = this._clientToWorld(e);
        if (!pt || !pt.overCanvas) return;
        if (this._boxMode) {
            this._boxing = true;
            this._boxStart.x = pt.x;
            this._boxStart.y = pt.y;
            return;
        }
        const hit = this._hitTest(pt.x, pt.y);
        if (hit) {
            if (e.shiftKey && !this.sel.includes(hit)) this._setSelection([...this.sel, hit]); // Shift 加选
            else if (!this.sel.includes(hit)) this._setSelection([hit]);
            this._dragging = true;
            this._dragStart.x = pt.x;
            this._dragStart.y = pt.y;
            this._dragOrig = this.sel.map(p => ({ p, x: p.x, y: p.y }));
            return;
        }
        // 墙件未命中再测 NPC（npcType 非空的实体精灵；noSeparation 固定 NPC 也允许拖动）
        const npc = this._hitTestNpc(pt.x, pt.y);
        if (npc) {
            this._setNpcSelection(npc);
            this._draggingNpc = true;
            this._dragStart.x = pt.x;
            this._dragStart.y = pt.y;
            this._npcDragOrig.x = npc.x;
            this._npcDragOrig.y = npc.y;
        } else {
            this._setSelection([]);
            this._setNpcSelection(null);
        }
    },

    _onMouseMove(e) {
        const pt = this._clientToWorld(e);
        if (!pt) return;
        if (this._pendingPiece && this._ghost) {
            this._pendingPiece.x = pt.x;
            this._pendingPiece.y = pt.y;
            this._applyGhost();
            return;
        }
        if (this._boxing && this._boxGfx) {
            const g = this._boxGfx;
            g.clear();
            const x = Math.min(this._boxStart.x, pt.x);
            const y = Math.min(this._boxStart.y, pt.y);
            const w = Math.abs(pt.x - this._boxStart.x);
            const h = Math.abs(pt.y - this._boxStart.y);
            g.fillStyle(0x88ccff, 0.12);
            g.fillRect(x, y, w, h);
            g.lineStyle(2, 0x88ccff, 0.9);
            g.strokeRect(x, y, w, h);
            return;
        }
        if (this._dragging) {
            const dx = pt.x - this._dragStart.x;
            const dy = pt.y - this._dragStart.y;
            for (const o of this._dragOrig) {
                o.p.x = o.x + dx;
                o.p.y = o.y + dy;
                this._applyToSprite(o.p);
            }
            this._updateInfo();
            return;
        }
        // NPC 拖动：改实体坐标（精灵位置由 GameScene._syncNeutralEntities 每帧同步）；
        // 游走 NPC 同步挪家，防止松手后 wander 把它拉回旧生成点
        if (this._draggingNpc && this._npcSel) {
            const e2 = this._npcSel;
            e2.x = this._npcDragOrig.x + (pt.x - this._dragStart.x);
            e2.y = this._npcDragOrig.y + (pt.y - this._dragStart.y);
            if (e2._wanderHome) {
                e2._wanderHome.x = e2.x;
                e2._wanderHome.y = e2.y;
            }
            this._updateNpcInfo();
        }
    },

    _onMouseUp(e) {
        const pt = this._clientToWorld(e);
        if (this._boxing) {
            this._boxing = false;
            if (this._boxGfx) this._boxGfx.clear();
            if (!pt) return;
            const x1 = Math.min(this._boxStart.x, pt.x), x2 = Math.max(this._boxStart.x, pt.x);
            const y1 = Math.min(this._boxStart.y, pt.y), y2 = Math.max(this._boxStart.y, pt.y);
            if (x2 - x1 < 5 && y2 - y1 < 5) return; // 误触
            const hit = WallSystem.isoVisuals.filter(p => {
                if (!p._sprite) return false;
                const b = p._sprite.getBounds();
                return b.x < x2 && b.x + b.width > x1 && b.y < y2 && b.y + b.height > y1;
            });
            this._setSelection(hit);
            return;
        }
        if (this._dragging) {
            this._dragging = false;
            this._commit();
        }
        // NPC 拖动落位：实体坐标已在拖动中写好，无碰撞重建（位置保存走 NPC 编辑器「保存」）
        if (this._draggingNpc) {
            this._draggingNpc = false;
            this._updateNpcInfo();
        }
    },

    _onWheel(e) {
        const pt = this._clientToWorld(e);
        if (!pt || !pt.overCanvas) return;
        // NPC 编辑器面板上的滚轮留给滑条交互，不波及场景选中件
        if (e.target instanceof Element && e.target.closest('.npc-editor')) return;
        e.preventDefault();
        // 放置中的临时件：滚轮缩放 / Ctrl+滚轮镜像 / Shift+滚轮旋转（障碍物）
        if (this._pendingPiece) {
            const p = this._pendingPiece;
            if (e.ctrlKey) p.flipX = !p.flipX;
            else if (e.shiftKey) {
                if (p.family === 'obstacle') p.rotation = ((p.rotation || 0) + (e.deltaY < 0 ? 5 : -5) * Math.PI / 180);
            } else {
                const f = e.deltaY < 0 ? 1.05 : 1 / 1.05;
                p.scaleX *= f;
                p.scaleY *= f;
            }
            this._applyGhost();
            return;
        }
        // 选中 NPC：滚轮=大小，Shift+滚轮=旋转（贴图 NPC）
        if (this._npcSel) {
            if (e.shiftKey) this._applyNpcRotation((this._npcSel.spriteCfg?.rotation || 0) + (e.deltaY < 0 ? 5 : -5));
            else this._applyNpcSize(this._npcCurSize() * (e.deltaY < 0 ? 1.05 : 1 / 1.05));
            return;
        }
        if (!this.sel.length) return;
        if (e.ctrlKey) {
            // 整组水平镜像（绕组中心）
            const c = this._selCenter();
            for (const p of this.sel) {
                p.x = 2 * c.x - p.x;
                p.flipX = !p.flipX;
                this._applyToSprite(p);
            }
        } else if (e.shiftKey) {
            // Shift+滚轮：障碍物旋转 ±5°（墙件不受影响，防止误转破坏拼接）
            for (const p of this.sel) {
                if (p.family !== 'obstacle') continue;
                p.rotation = ((p.rotation || 0) + (e.deltaY < 0 ? 5 : -5) * Math.PI / 180);
                this._applyToSprite(p);
            }
        } else {
            // 整组缩放（绕组中心，位置同步缩放）
            const f = e.deltaY < 0 ? 1.05 : 1 / 1.05;
            const c = this._selCenter();
            for (const p of this.sel) {
                p.x = c.x + (p.x - c.x) * f;
                p.y = c.y + (p.y - c.y) * f;
                p.scaleX = (p.scaleX ?? 1) * f;
                p.scaleY = (p.scaleY ?? 1) * f;
                this._applyToSprite(p);
            }
        }
        this._updateInfo();
        this._scheduleCommit();
    },

    // ===== 键盘 =====
    _onKey(e) {
        if (!this.active) return;
        let handled = true;
        if (e.code === 'Escape') {
            if (this._pendingPiece) this._cancelPlacement();
            else this.close();
        } else if ((e.code === 'Delete' || e.code === 'Backspace') && this.sel.length) {
            this._deleteSelection();
        } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
            const d = (e.shiftKey ? 10 : 1) * (e.code === 'KeyE' ? 1 : -1);
            for (const p of this.sel) {
                p.depth = (p.depth ?? p.y) + d;
                this._applyToSprite(p);
            }
            this._refreshLayers();
        } else handled = false;
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
            this._updateInfo();
        }
    },

    // ===== 缩略图拖放 =====
    _startPlacement(comp) {
        this._cancelPlacement();
        const g = WallSystem._geoForTex(comp.tex) || { wallH: 800 };
        const isObstacle = g.category === 'obstacle';
        // 缩放：墙件=ISO_WALL_HEIGHT/wallH；障碍物无 wallH，用 geo.obstacleH（默认显示高度，缺省 120）
        const s = isObstacle ? ((g.obstacleH ?? 120) / g.h) : (ISO_WALL_HEIGHT / g.wallH);
        this._pendingPiece = {
            tex: comp.tex, x: -9999, y: -9999,
            // 障碍物是 billboard 道具：不做 30° 角度补偿（scaleY=scaleX），支持 rotation
            scaleX: s, scaleY: isObstacle ? s : s * slopeFixOf(g),
            flipX: false, flipY: false, rotation: 0,
            depth: 0, family: isObstacle ? 'obstacle' : 'wall',
        };
        // 障碍物：有类型默认状态（obstacle-defaults.json）则整套套用，覆盖 obstacleH 基准
        if (isObstacle) {
            const def = getObstacleDefaults()[this._obstacleGeoKey(comp.tex)];
            if (def) {
                this._pendingPiece.scaleX = def.scaleX ?? s;
                this._pendingPiece.scaleY = def.scaleY ?? def.scaleX ?? s;
                this._pendingPiece.rotation = def.rotation || 0;
                this._pendingPiece.flipX = !!def.flipX;
                this._pendingPiece.flipY = !!def.flipY;
            }
        }
        const scene = window.__phaserScene;
        this._ghost = scene.add.sprite(-9999, -9999, comp.tex).setOrigin(0.5, 0.5).setAlpha(0.6).setDepth(999998);
        this._placeUpFn = (e) => this._finishPlacement(e);
        window.addEventListener('mouseup', this._placeUpFn, true);
    },

    _applyGhost() {
        if (!this._ghost || !this._pendingPiece) return;
        const p = this._pendingPiece;
        this._ghost.setPosition(p.x, p.y);
        this._ghost.setScale(p.scaleX, p.scaleY);
        this._ghost.setFlipX(p.flipX);
        this._ghost.setRotation(p.rotation || 0);
    },

    _finishPlacement(e) {
        const pt = this._clientToWorld(e);
        const overCanvas = pt && pt.overCanvas;
        if (overCanvas && this._pendingPiece) {
            const p = this._pendingPiece;
            // 障碍物 depth 锚贴图底边（前墙规则）；墙件沿用 y（编辑器/图层后续可再调）
            const g = WallSystem._geoForTex(p.tex);
            p.depth = (g && g.category === 'obstacle')
                ? p.y + (g.h * (p.scaleY ?? p.scaleX ?? 1)) / 2
                : p.y;
            WallSystem.isoVisuals.push(p);
            this._pendingPiece = null;
            this._destroyGhost();
            this._commit();
            this._setSelection([p]);
        } else {
            this._cancelPlacement();
        }
    },

    _cancelPlacement() {
        this._pendingPiece = null;
        this._destroyGhost();
    },

    _destroyGhost() {
        if (this._placeUpFn) {
            window.removeEventListener('mouseup', this._placeUpFn, true);
            this._placeUpFn = null;
        }
        if (this._ghost) {
            this._ghost.destroy();
            this._ghost = null;
        }
    },

    // ===== 删除 / 保存预设 =====
    _deleteSelection() {
        if (!this.sel.length) return;
        const set = new Set(this.sel);
        WallSystem.isoVisuals = WallSystem.isoVisuals.filter(p => !set.has(p));
        this._setSelection([]);
        this._commit();
    },

    // ===== 障碍物编辑器（仅单选一个障碍物时显示，位于墙壁编辑器下方） =====
    _updateObstacleEditor() {
        const single = this.sel.length === 1 ? this.sel[0] : null;
        const isOb = !!(single && (WallSystem._geoForTex(single.tex) || {}).category === 'obstacle');
        if (!this._obstacleEl) {
            const el = document.createElement('div');
            el.className = 'obstacle-editor';
            el.innerHTML = `
                <div class="oe-title">障碍物编辑器</div>
                <div class="oe-hints">滚轮=缩放 Ctrl+滚轮=镜像 Shift+滚轮=旋转</div>
                <div class="oe-row">
                    <button class="oe-reset">↺ 重置</button>
                    <button class="oe-save">💾 保存</button>
                </div>`;
            document.body.appendChild(el);
            this._obstacleEl = el;
            el.querySelector('.oe-reset').addEventListener('click', () => this._resetObstacle());
            el.querySelector('.oe-save').addEventListener('click', () => this._saveObstacleLayout());
        }
        this._obstacleEl.style.display = isOb ? 'block' : 'none'; // 注意不能用 ''（CSS 类默认 display:none，空串会回落隐藏）
        // 跟随墙壁编辑器面板下缘（面板高度随内容变化，固定 top 会飘出视口）
        if (isOb && this._panel) {
            const r = this._panel.getBoundingClientRect();
            this._obstacleEl.style.top = Math.min(r.bottom + 8, window.innerHeight - 120) + 'px';
        }
    },

    /** 障碍物贴图键 → ISO_WALL_GEO 键（geoKey，如 barrel/pillar/candle；非障碍物返回 null） */
    _obstacleGeoKey(tex) {
        for (const k of Object.keys(ISO_WALL_GEO)) {
            const g = ISO_WALL_GEO[k];
            if (g.tex === tex && g.category === 'obstacle') return k;
        }
        return null;
    },

    /** 重置：选中障碍物恢复类型默认状态（obstacle-defaults 记录值；无记录回 obstacleH 基准） */
    _resetObstacle() {
        const p = this.sel.length === 1 ? this.sel[0] : null;
        if (!p) return;
        const g = WallSystem._geoForTex(p.tex) || { wallH: 800, h: 800 };
        const def = (g.category === 'obstacle') ? getObstacleDefaults()[this._obstacleGeoKey(p.tex)] : null;
        if (def) {
            p.scaleX = def.scaleX ?? 1;
            p.scaleY = def.scaleY ?? def.scaleX ?? 1;
            p.rotation = def.rotation || 0;
            p.flipX = !!def.flipX;
            p.flipY = !!def.flipY;
        } else {
            const s = (g.category === 'obstacle') ? ((g.obstacleH ?? 120) / g.h) : (ISO_WALL_HEIGHT / g.wallH);
            p.scaleX = s;
            p.scaleY = s;
            p.flipX = false;
            p.flipY = false;
            p.rotation = 0;
        }
        this._applyToSprite(p);
        this._commit();
    },

    /**
     * 保存（双写）：
     * ① 选中件的变换写入 data/obstacle-defaults.json 对应类型（geoKey）——
     *    之后摆墙拖新件 / 地牢地板装饰 / 重置都套用该类型默认状态；
     * ② 场景内全部障碍物写入 data/obstacle-layout.json（回城按布局重建，免手工抄改）
     */
    async _saveObstacleLayout() {
        const p = this.sel.length === 1 ? this.sel[0] : null;
        const geoKey = p ? this._obstacleGeoKey(p.tex) : null;
        if (geoKey) {
            const defs = { ...getObstacleDefaults() };
            defs[geoKey] = {
                scaleX: p.scaleX ?? 1,
                scaleY: p.scaleY ?? p.scaleX ?? 1,
                rotation: p.rotation || 0,
                flipX: !!p.flipX,
                flipY: !!p.flipY,
            };
            await saveObstacleDefaults(defs);
        }
        const list = WallSystem.isoVisuals
            .filter(q => (WallSystem._geoForTex(q.tex) || {}).category === 'obstacle')
            .map(cleanPiece);
        const ok = await saveObstacleLayout(list);
        const btn = this._obstacleEl && this._obstacleEl.querySelector('.oe-save');
        if (btn) {
            const old = btn.textContent;
            btn.textContent = ok ? '✓ 已写入文件' : '⚠ 已下载';
            setTimeout(() => { btn.textContent = old; }, 1200);
        }
    },

    // ===== NPC 位置编辑器（摆墙模式单选一个 NPC 时显示，样式同障碍物编辑器，位于其下方） =====
    _updateNpcEditor() {
        const e = this._npcSel;
        if (!this._npcEl) {
            const el = document.createElement('div');
            el.className = 'obstacle-editor npc-editor';
            el.innerHTML = `
                <div class="oe-title">NPC 编辑器</div>
                <div class="oe-hints">拖动=移动 滚轮=大小 Shift+滚轮=旋转</div>
                <div class="ne-info"></div>
                <div class="ne-row">
                    <label>大小</label>
                    <input type="range" class="ne-size">
                    <span class="ne-val ne-size-val"></span>
                </div>
                <div class="ne-row">
                    <label>角度</label>
                    <input type="range" class="ne-rot" min="-180" max="180" step="1">
                    <span class="ne-val ne-rot-val"></span>
                </div>
                <div class="oe-row">
                    <button class="oe-reset ne-reset">↺ 重置</button>
                    <button class="oe-save ne-save">💾 保存</button>
                </div>`;
            document.body.appendChild(el);
            this._npcEl = el;
            el.querySelector('.ne-size').addEventListener('input', (ev) => this._applyNpcSize(Number(ev.target.value)));
            el.querySelector('.ne-rot').addEventListener('input', (ev) => this._applyNpcRotation(Number(ev.target.value)));
            el.querySelector('.ne-reset').addEventListener('click', () => this._resetNpc());
            el.querySelector('.ne-save').addEventListener('click', () => this._saveNpc());
        }
        const el = this._npcEl;
        el.style.display = e ? 'block' : 'none';
        if (!e) return;
        // 大小滑条量程：贴图 NPC=16~512（sprite.size 显示边长）；纯色圆 NPC=4~128（半径 size）
        const isTex = !!e.spriteCfg;
        const sizeSlider = el.querySelector('.ne-size');
        sizeSlider.min = isTex ? 16 : 4;
        sizeSlider.max = isTex ? 512 : 128;
        // 角度仅贴图 NPC 有意义（纯色圆旋转对称）
        el.querySelector('.ne-rot').disabled = !isTex;
        // 跟随障碍物编辑器/墙壁编辑器面板下缘（与障碍物编辑器同一定位策略）
        if (this._panel) {
            let top = this._panel.getBoundingClientRect().bottom + 8;
            if (this._obstacleEl && this._obstacleEl.style.display !== 'none') {
                top = this._obstacleEl.getBoundingClientRect().bottom + 8;
            }
            el.style.top = Math.min(top, window.innerHeight - 220) + 'px';
        }
        this._updateNpcInfo();
    },

    /** 刷新 NPC 编辑器名称/坐标/数值显示（拖动中高频调用；滑条值同步但避开正在拖的那个） */
    _updateNpcInfo() {
        const e = this._npcSel;
        const el = this._npcEl;
        if (!e || !el) return;
        el.querySelector('.oe-title').textContent = `NPC 编辑器 - ${e.name || 'NPC'}`;
        el.querySelector('.ne-info').textContent = `位置 ${Math.round(e.x)}, ${Math.round(e.y)}`;
        el.querySelector('.ne-size-val').textContent = Math.round(this._npcCurSize());
        el.querySelector('.ne-rot-val').textContent = `${Math.round(e.spriteCfg ? (e.spriteCfg.rotation || 0) : 0)}°`;
        const sizeSlider = el.querySelector('.ne-size');
        if (document.activeElement !== sizeSlider) sizeSlider.value = this._npcCurSize();
        const rotSlider = el.querySelector('.ne-rot');
        if (document.activeElement !== rotSlider) rotSlider.value = e.spriteCfg ? (e.spriteCfg.rotation || 0) : 0;
    },

    /** 当前 NPC 显示大小（贴图=sprite.size 显示边长；纯色圆=半径 size） */
    _npcCurSize() {
        const e = this._npcSel;
        if (!e) return 0;
        return e.spriteCfg ? (e.spriteCfg.size || 128) : (e.size || 16);
    },

    /** 调整 NPC 显示大小（立即作用到场景精灵；保存才落盘） */
    _applyNpcSize(v) {
        const e = this._npcSel;
        if (!e || !isFinite(v)) return;
        const sp = this._npcSpriteOf(e);
        if (e.spriteCfg) {
            const size = Math.round(Math.min(512, Math.max(16, v)));
            e.spriteCfg.size = size;
            if (sp) sp.setDisplaySize(size, size);
        } else {
            const size = Math.round(Math.min(128, Math.max(4, v)));
            e.size = size;
            if (sp) sp.setDisplaySize(size * 2, size * 2);
        }
        this._updateNpcInfo();
    },

    /** 调整 NPC 旋转角（度数，归一 -180~180；仅贴图 NPC，渲染由 _syncNeutralEntities 每帧套用） */
    _applyNpcRotation(deg) {
        const e = this._npcSel;
        if (!e || !e.spriteCfg || !isFinite(deg)) return;
        e.spriteCfg.rotation = Math.round((((deg + 180) % 360) + 360) % 360) - 180;
        this._updateNpcInfo();
    },

    /** NPC 实体 → game-config.json npcs 配置键（实体 id 直查，退回按名称匹配） */
    _npcCfgKey(e) {
        if (!e) return null;
        const byId = {
            npc_mouse_king: 'shopMouseKing',
            npc_mouse_attendant: 'mouseAttendant',
            npc_warehouse: 'warehouse',
            npc_altar: 'altar',
        };
        if (byId[e.id]) return byId[e.id];
        for (const [k, cfg] of Object.entries(GAME_CONFIG.npcs || {})) {
            if (cfg && cfg.name === e.name) return k;
        }
        return null;
    },

    /** NPC 位置基准点：relativeTo='shopMouseKing' → 小鼠大王【配置锚点】（世界中心+大王配置 offset）；
     *  必须用配置锚点而非大王实时位置——大王会游走，按实时位置算 offset 会在下次生成时整体平移
     * （"调整 NPC 位置保存后重启回原位"根因）；否则世界中心 */
    _npcBasePos(cfg) {
        if (cfg && cfg.relativeTo === 'shopMouseKing') {
            const kingCfg = (GAME_CONFIG.npcs || {}).shopMouseKing || {};
            return {
                x: CONFIG.WORLD_WIDTH / 2 + ((kingCfg.offset && kingCfg.offset.x) || 0),
                y: CONFIG.WORLD_HEIGHT / 2 + ((kingCfg.offset && kingCfg.offset.y) || 0),
            };
        }
        return { x: CONFIG.WORLD_WIDTH / 2, y: CONFIG.WORLD_HEIGHT / 2 };
    },

    /** 重置：位置按配置 offset 重算、大小/角度回配置值（保存后 GAME_CONFIG 已同步，即回到最近保存点） */
    _resetNpc() {
        const e = this._npcSel;
        const key = this._npcCfgKey(e);
        if (!e || !key) return;
        const cfg = (GAME_CONFIG.npcs || {})[key] || {};
        const base = this._npcBasePos(cfg);
        e.x = base.x + ((cfg.offset && cfg.offset.x) || 0);
        e.y = base.y + ((cfg.offset && cfg.offset.y) || 0);
        if (e._wanderHome) { e._wanderHome.x = e.x; e._wanderHome.y = e.y; }
        const sp = this._npcSpriteOf(e);
        if (e.spriteCfg) {
            const c = cfg.sprite || {};
            if (typeof c.size === 'number') e.spriteCfg.size = c.size;
            e.spriteCfg.rotation = c.rotation || 0;
            if (sp && e.spriteCfg.size) sp.setDisplaySize(e.spriteCfg.size, e.spriteCfg.size);
        } else if (typeof cfg.size === 'number') {
            e.size = cfg.size;
            if (sp) sp.setDisplaySize(e.size * 2, e.size * 2);
        }
        this._updateNpcEditor();
    },

    /** 保存：写回 data/game-config.json 对应 npcs.*（位置=offset、大小、角度），运行时 GAME_CONFIG 同步生效 */
    async _saveNpc() {
        const e = this._npcSel;
        const key = this._npcCfgKey(e);
        if (!e || !key) return;
        const cfg = GAME_CONFIG.npcs[key];
        // 位置：relativeTo='shopMouseKing' 的写 offset = NPC 当前位置 − 小鼠大王当前位置；
        // 主 NPC（shopMouseKing 自身）写 offset = 当前位置 − 世界中心
        const base = this._npcBasePos(cfg);
        cfg.offset = { x: Math.round(e.x - base.x), y: Math.round(e.y - base.y) };
        if (e.spriteCfg) {
            cfg.sprite = cfg.sprite || {};
            if (typeof e.spriteCfg.size === 'number') cfg.sprite.size = e.spriteCfg.size;
            const rot = e.spriteCfg.rotation || 0;
            if (rot) cfg.sprite.rotation = rot;
            else delete cfg.sprite.rotation;
        } else if (typeof e.size === 'number') {
            cfg.size = e.size;
        }
        const ok = await saveGameConfig(GAME_CONFIG);
        console.log(`[WallEditor] NPC(${key}) 位置已保存: offset=(${cfg.offset.x},${cfg.offset.y}) base=(${base.x},${base.y}) → 实体(${Math.round(e.x)},${Math.round(e.y)})`);
        const btn = this._npcEl && this._npcEl.querySelector('.ne-save');
        if (btn) {
            const old = btn.textContent;
            btn.textContent = ok ? '✓ 已写入文件' : '⚠ 已下载';
            setTimeout(() => { btn.textContent = old; }, 1200);
        }
    },

    /** 角度补偿：选中件的显示斜率对齐地板线 30°（scaleY 按比例重设，宽度/墙高不动） */
    _alignSlope() {
        for (const p of this.sel) {
            p.scaleY = (p.scaleX ?? 1) * slopeFixOf(WallSystem._geoForTex(p.tex));
            this._applyToSprite(p);
        }
        this._updateInfo();
        this._scheduleCommit();
    },

    /**
     * 拼接吸附（选中恰好 2 件时可用）：
     * B(sel[1]) 继承 A(sel[0]) 的缩放/翻转（同缩放=同墙高），
     * B 的正面墙底边起点(face)吸附到 A 的正面墙底边终点——正面墙无缝对接，
     * 两端端帽互相重叠藏进相邻件体内（接缝处呈壁柱观感）
     */
    _snapJoin() {
        if (this.sel.length !== 2) return;
        const [A, B] = this.sel;
        const gB = WallSystem._geoForTex(B.tex);
        if (!gB || !(gB.face || gB.base)) return; // 仅直墙件支持
        const faceB = gB.face || gB.base;
        B.scaleX = A.scaleX;
        B.scaleY = A.scaleY;
        B.flipX = A.flipX;
        B.flipY = A.flipY;
        const segA = WallSystem._pieceBaseSegments(A)[0];
        const endA = segA[1]; // face 终点（已是世界坐标）
        // 沿 A 走向回退 SNAP_OVERLAP：接缝只叠不缺（face 锚点拟合公差兜底）
        const runLen = Math.hypot(segA[1].x - segA[0].x, segA[1].y - segA[0].y) || 1;
        const ux = (segA[1].x - segA[0].x) / runLen, uy = (segA[1].y - segA[0].y) / runLen;
        const targetX = endA.x - ux * SNAP_OVERLAP;
        const targetY = endA.y - uy * SNAP_OVERLAP;
        const startB = WallSystem.texPointToWorld(B, faceB[0][0], faceB[0][1]);
        B.x += targetX - startB.x;
        B.y += targetY - startB.y;
        const segB = WallSystem._pieceBaseSegments(B)[0];
        B.depth = Math.max(segB[0].y, segB[1].y);
        this._applyToSprite(B);
        this._commit();
        this._setSelection([B]); // 选中 B，可继续 Shift 加选下一件接龙
    },

    async _savePrefab() {
        const input = this._panel ? this._panel.querySelector('.we-name') : null;
        const name = input ? input.value.trim() : '';
        if (!name || !this.sel.length) return;
        const c = this._selCenter();
        const lib = { ...getWallPrefabLibrary() };
        lib[name] = { name, cx: Math.round(c.x), cy: Math.round(c.y), pieces: this.sel.map(cleanPiece) };
        await saveWallPrefabs(lib);
        if (input) input.value = '';
        this._refreshPrefabList();
    },

    _placePrefab(key) {
        const lib = getWallPrefabLibrary();
        const def = lib[key];
        if (!def || !Array.isArray(def.pieces)) return;
        const pieces = def.pieces.map(p => ({ ...p }));
        WallSystem.isoVisuals.push(...pieces);
        this._commit();
        this._setSelection(pieces);
    },

    _deletePrefab(key) {
        const lib = { ...getWallPrefabLibrary() };
        delete lib[key];
        saveWallPrefabs(lib).then(() => this._refreshPrefabList());
    },

    // ===== 渲染同步 =====
    _applyToSprite(p) {
        if (!p._sprite) return;
        p._sprite.setPosition(p.x, p.y);
        p._sprite.setScale(p.scaleX ?? 1, p.scaleY ?? p.scaleX ?? 1);
        p._sprite.setFlipX(!!p.flipX);
        p._sprite.setFlipY(!!p.flipY);
        p._sprite.setRotation(p.rotation || 0);
        // 障碍物：depth 锚贴图底边（前墙规则——后方实体被正确遮挡；
        // 之前 depth=中心点，背后人物脚线大于中心仍盖在柱子上"背后显示"）
        const g = WallSystem._geoForTex(p.tex);
        const depth = (g && g.category === 'obstacle')
            ? p.y + (g.h * (p.scaleY ?? p.scaleX ?? 1)) / 2
            : (p.depth ?? p.y);
        p._sprite.setDepth(depth);
    },

    /** 全量重建：阶梯碰撞 + Phaser 重同步（重建物理体与贴图） */
    _commit() {
        clearTimeout(this._commitTimer);
        WallSystem.rebuildIsoCollision();
        WallSystem._syncWallsToPhaser();
        for (const p of this.sel) {
            if (p._sprite) p._sprite.setTint(0xffffff);
        }
        this._refreshLayers();
    },

    _scheduleCommit() {
        clearTimeout(this._commitTimer);
        this._commitTimer = setTimeout(() => this._commit(), 300);
    },

    // ===== 图层面板（编辑器左侧，仿 Photoshop 图层） =====
    _ensureLabel(p) {
        if (p.label) return;
        const base = TEX_NAMES[p.tex] || p.tex;
        let n = 1;
        for (const q of WallSystem.isoVisuals) {
            if (q !== p && q.label && q.label.startsWith(base + ' ')) {
                const m = q.label.match(/(\d+)$/);
                if (m) n = Math.max(n, Number(m[1]) + 1);
            }
        }
        p.label = `${base} ${n}`;
    },

    _buildLayersPanel() {
        if (this._layersEl) this._layersEl.remove();
        const el = document.createElement('div');
        el.className = 'wall-editor-layers';
        el.innerHTML = '<div class="wl-title">图层（拖动排序，上盖下）</div><div class="wl-list"></div>';
        document.body.appendChild(el);
        this._layersEl = el;
        this._refreshLayers();
    },

    _refreshLayers() {
        if (!this._layersEl) return;
        for (const p of WallSystem.isoVisuals) this._ensureLabel(p);
        // 顶层在前（depth 大 = 靠前 = 盖住下面的）
        const list = WallSystem.isoVisuals.slice().sort((a, b) => (b.depth ?? b.y) - (a.depth ?? a.y));
        this._layerList = list;
        const el = this._layersEl.querySelector('.wl-list');
        el.innerHTML = list.map((p, i) => `
            <div class="wl-item${this.sel.includes(p) ? ' active' : ''}" data-i="${i}" draggable="true">
                <span class="wl-name">${p.label}</span>
                <span class="wl-depth">${Math.round(p.depth ?? p.y)}</span>
            </div>`).join('');
        for (const item of el.querySelectorAll('.wl-item')) {
            item.addEventListener('click', () => {
                const p = this._layerList[Number(item.dataset.i)];
                if (p) this._setSelection([p]);
            });
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', item.dataset.i);
                e.dataTransfer.effectAllowed = 'move';
            });
            item.addEventListener('dragover', (e) => e.preventDefault());
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData('text/plain'));
                const to = Number(item.dataset.i);
                this._reorderLayer(from, to);
            });
        }
    },

    /** 图层重排：把 from 项移到 to 位置，depth 取新邻居中值（局部调整，不影响其他件） */
    _reorderLayer(from, to) {
        const list = this._layerList;
        if (!list || from === to || from < 0 || to < 0) return;
        const moved = list[from];
        if (!moved) return;
        const arr = list.filter(p => p !== moved);
        arr.splice(to, 0, moved);
        const above = arr[to - 1]; // depth 更大（更靠前）
        const below = arr[to + 1]; // depth 更小
        if (above && below) moved.depth = ((above.depth ?? above.y) + (below.depth ?? below.y)) / 2;
        else if (above) moved.depth = (above.depth ?? above.y) - 1;
        else if (below) moved.depth = (below.depth ?? below.y) + 1;
        this._applyToSprite(moved);
        this._scheduleCommit();
        this._refreshLayers();
    },

    // ===== 面板 DOM =====
    _buildPanel() {
        if (this._panel) this._panel.remove();
        const el = document.createElement('div');
        el.className = 'wall-editor-panel';

        // 标准组件缩略图（三大分类页签；滚动区拉高+滚动条，组件多了可滚动）
        const stdHtml = `
            <div class="we-cat-tabs">${STD_COMPONENTS.map((g, i) => `
                <button class="we-cat-tab${i === 0 ? ' active' : ''}" data-cat="${g.id}">${g.family}</button>`).join('')}
            </div>
            <div class="we-std-scroll">${STD_COMPONENTS.map((g, i) => `
                <div class="we-cat-page" data-cat="${g.id}"${i !== 0 ? ' style="display:none"' : ''}>
                    <div class="we-grid">${g.items.map(it => `
                        <div class="we-thumb" data-tex="${it.tex}" title="${it.name}（拖入场景放置）">
                            <img src="assets/terrain/${it.tex}.png" draggable="false" alt="${it.name}">
                            <span>${it.name}</span>
                        </div>`).join('') || '<div class="we-pf-empty">（暂无组件）</div>'}
                    </div>
                </div>`).join('')}
            </div>`;

        el.innerHTML = `
            <div class="we-title">墙壁编辑器 <span class="we-close">×</span></div>
            <div class="we-tabs">
                <button class="we-tab we-tab-std active">标准组件</button>
                <button class="we-tab we-tab-pre">预制组件</button>
            </div>
            <div class="we-page we-page-std">${stdHtml}</div>
            <div class="we-page we-page-pre" style="display:none">
                <div class="we-prefab-list"></div>
            </div>
            <div class="we-row">
                <button class="we-box" title="框选模式：长按拖出选框选中范围内墙壁">框选</button>
                <button class="we-align" title="选中件的显示角度对齐地板线 30°">对齐地板角</button>
                <button class="we-join" title="选中恰好 2 件：B 继承 A 缩放/翻转并底边无缝对接（先点 A，Shift 加选 B）">拼接吸附</button>
                <span class="we-selinfo">未选中</span>
            </div>
            <div class="we-row">
                <input class="we-name" placeholder="预设方案名称">
                <button class="we-save" title="把选中件存为预设方案">存为预设</button>
                <button class="we-delete" title="删除全部选中件">删除选中</button>
            </div>
            <div class="we-hints">
                拖缩略图放入场景 | 滚轮=缩放 Ctrl+滚轮=镜像<br>
                Shift+点击=加选 | 拼接吸附=先点A再Shift选B<br>
                整组拖动=拖任一选中件 | Q/E=深度 Del=删除 Esc=退出
            </div>`;
        document.body.appendChild(el);
        this._panel = el;

        // 页签切换
        const tabStd = el.querySelector('.we-tab-std');
        const tabPre = el.querySelector('.we-tab-pre');
        const pageStd = el.querySelector('.we-page-std');
        const pagePre = el.querySelector('.we-page-pre');
        tabStd.addEventListener('click', () => {
            tabStd.classList.add('active'); tabPre.classList.remove('active');
            pageStd.style.display = ''; pagePre.style.display = 'none';
        });
        tabPre.addEventListener('click', () => {
            tabPre.classList.add('active'); tabStd.classList.remove('active');
            pagePre.style.display = ''; pageStd.style.display = 'none';
            this._refreshPrefabList();
        });

        // 分类页签切换（墙类/门类/障碍物类）
        for (const tab of el.querySelectorAll('.we-cat-tab')) {
            tab.addEventListener('click', () => {
                for (const t of el.querySelectorAll('.we-cat-tab')) t.classList.toggle('active', t === tab);
                for (const pg of el.querySelectorAll('.we-cat-page')) {
                    pg.style.display = pg.dataset.cat === tab.dataset.cat ? '' : 'none';
                }
            });
        }

        // 缩略图拖放（mousedown 启动放置，mouseup 在画布上落位）
        for (const thumb of el.querySelectorAll('.we-thumb')) {
            thumb.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const tex = thumb.dataset.tex;
                const comp = STD_COMPONENTS.flatMap(g => g.items).find(it => it.tex === tex);
                if (comp) this._startPlacement(comp);
            });
        }

        el.querySelector('.we-box').addEventListener('click', () => {
            this._boxMode = !this._boxMode;
            el.querySelector('.we-box').classList.toggle('active', this._boxMode);
        });
        el.querySelector('.we-align').addEventListener('click', () => this._alignSlope());
        el.querySelector('.we-join').addEventListener('click', () => this._snapJoin());
        el.querySelector('.we-close').addEventListener('click', () => this.close());
        el.querySelector('.we-save').addEventListener('click', () => this._savePrefab());
        el.querySelector('.we-delete').addEventListener('click', () => this._deleteSelection());
        this._refreshPrefabList();
        this._buildLayersPanel();
    },

    _refreshPrefabList() {
        if (!this._panel) return;
        const list = this._panel.querySelector('.we-prefab-list');
        const lib = getWallPrefabLibrary();
        const keys = Object.keys(lib);
        list.innerHTML = keys.length
            ? keys.map(k => `
                <div class="we-pf" data-key="${k}">
                    <span title="${k}">${lib[k].name || k}</span>
                    <button class="we-pf-place">放置</button>
                    <button class="we-pf-del">删</button>
                </div>`).join('')
            : '<div class="we-pf-empty">（暂无预设方案，框选后命名保存）</div>';
        for (const row of list.querySelectorAll('.we-pf')) {
            row.querySelector('.we-pf-place').addEventListener('click', () => this._placePrefab(row.dataset.key));
            row.querySelector('.we-pf-del').addEventListener('click', () => this._deletePrefab(row.dataset.key));
        }
    },

    _updateInfo() {
        if (!this._panel) return;
        const info = this._panel.querySelector('.we-selinfo');
        if (this._npcSel) {
            info.textContent = `已选 NPC：${this._npcSel.name || 'NPC'}`;
            return;
        }
        if (!this.sel.length) {
            info.textContent = `未选中（共 ${WallSystem.isoVisuals.length} 件）`;
            return;
        }
        const c = this._selCenter();
        info.textContent = `已选 ${this.sel.length} 件 | 中心 ${Math.round(c.x)},${Math.round(c.y)}`;
    },
};
