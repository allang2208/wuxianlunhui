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
import { loadWallPrefabs, getWallPrefabLibrary, saveWallPrefabs, saveObstacleLayout } from '../world/wall-prefabs.js';

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
        this._blinkT = 0;
        this._updateInfo();
        this._refreshLayers();
        this._updateObstacleEditor();
    },

    _onTick(time) {
        if (!this.sel.length) return;
        if (time - this._blinkT > 250) {
            this._blinkT = time;
            this._blinkOn = !this._blinkOn;
            for (const p of this.sel) {
                if (p._sprite) p._sprite.setTint(this._blinkOn ? 0xffffff : 0x111111);
            }
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
        if (e.target.closest('.wall-editor-panel, .wall-editor-layers')) return; // 面板/图层栏自有交互
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
        } else {
            this._setSelection([]);
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
    },

    _onWheel(e) {
        const pt = this._clientToWorld(e);
        if (!pt || !pt.overCanvas) return;
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
            p.depth = p.y;
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
        this._obstacleEl.style.display = isOb ? '' : 'none';
    },

    /** 重置：选中障碍物恢复初始变换（默认缩放/无旋转/无镜像） */
    _resetObstacle() {
        const p = this.sel.length === 1 ? this.sel[0] : null;
        if (!p) return;
        const g = WallSystem._geoForTex(p.tex) || { wallH: 800, h: 800 };
        const s = (g.category === 'obstacle') ? ((g.obstacleH ?? 120) / g.h) : (ISO_WALL_HEIGHT / g.wallH);
        p.scaleX = s;
        p.scaleY = s;
        p.flipX = false;
        p.flipY = false;
        p.rotation = 0;
        this._applyToSprite(p);
        this._commit();
    },

    /** 保存：场景内全部障碍物写入 data/obstacle-layout.json（回城按布局重建，免手工抄改） */
    async _saveObstacleLayout() {
        const list = WallSystem.isoVisuals
            .filter(p => (WallSystem._geoForTex(p.tex) || {}).category === 'obstacle')
            .map(cleanPiece);
        const ok = await saveObstacleLayout(list);
        const btn = this._obstacleEl && this._obstacleEl.querySelector('.oe-save');
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
        p._sprite.setDepth(p.depth ?? p.y);
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
        if (!this.sel.length) {
            info.textContent = `未选中（共 ${WallSystem.isoVisuals.length} 件）`;
            return;
        }
        const c = this._selCenter();
        info.textContent = `已选 ${this.sel.length} 件 | 中心 ${Math.round(c.x)},${Math.round(c.y)}`;
    },
};
