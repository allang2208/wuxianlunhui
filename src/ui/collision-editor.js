/**
 * 碰撞体积编辑器（浮动面板 + 场景内拖拽）
 *
 * 入口：交互开发工具（T 键）→「碰撞」页签 →「打开碰撞体积编辑器」。
 *
 * 功能：
 * - 列表导入 data/enemy-config.json 全部怪物 + data/game-config.json npcs 全部 NPC，
 *   选中后在主神空间玩家右侧生成一只冻结的预览体（不索敌、不移动、不可受击）。
 * - 🟩 绿色矩形（怪物=躯干判定 projectileHitbox；NPC=矩形 footprint）：四角+边中八点拖拽。
 * - 🟧 橙色圆柱体：底部椭圆右缘手柄等比缩放半径（rx/ry 统一），顶缘手柄调节高矮。
 * - ✥ 在矩形或底部椭圆内按住拖动：整体平移碰撞体（colliderOffsetX/Y）对齐贴图。
 * - 重置：回退到选中时的配置快照；保存：直写 data/enemy-config.json / data/game-config.json
 *   （Electron IPC → Vite __save-json 中间件双写 → 下载兜底，与 wall-prefabs 同管道）。
 *
 * 注意：项目 Phaser 配置 input.mouse=false，指针交互一律走 DOM window 事件
 * （与 wall-editor.js 相同套路，_clientToWorld 换算世界坐标）。
 */
import enemyConfigData from '../../data/enemy-config.json';
import { GAME_CONFIG } from '../config/game-config.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { getTorsoRect } from '../physics/torso-hitbox.js';
import { Enemy } from '../entities/enemy.js';
import { NPC } from '../entities/npc.js';
import { BlackWolf, AmalgamZombie } from '../entities/enemy-types.js';
import { ZOMBIE_FACTORY_MAP } from '../world/zombie-dungeon.js';

// 无地牢工厂但有专属类的怪物：补充类映射（其余老怪走通用 Enemy 圆形占位预览）
const EXTRA_CLASS_MAP = {
    blackWolf: BlackWolf,
    amalgamZombie: AmalgamZombie,
};

// 预览体在 Game.entities 中的固定键
const PREVIEW_KEY = 'collision_preview';

// 拖拽约束（世界像素）
const MIN_RECT = 4;      // 矩形最小宽/高
const MIN_RADIUS = 4;    // 圆柱最小半径
const MAX_RADIUS = 600;
const MIN_HEIGHT = 4;    // 圆柱最小高度
const MAX_HEIGHT = 1200;

// 手柄屏幕尺寸（px，随相机缩放换算到世界）
const HANDLE_SCREEN = 9;

export const CollisionEditor = {
    active: false,
    _panel: null,
    _gfx: null,          // Phaser Graphics 覆盖层
    _selectEl: null,
    _infoEl: null,
    _toastEl: null,
    _toastTimer: 0,

    _kind: null,         // 'enemy' | 'npc'
    _key: null,          // 配置键
    _entity: null,       // 预览实体
    _edit: null,         // 当前编辑值 {radius,height,offsetX,offsetY,rect:{width,height,offsetX,bottom}}
    _baseline: null,     // 选中时的配置快照（重置用）
    _defaultHeight: 0,   // 选中时 collider 推导高度（决定保存时是否落 height 键）

    _drag: null,         // 拖拽状态 {mode:'rect'|'radius'|'height'|'move', handle, startPt, startEdit, anchor}
    _downFn: null,
    _moveFn: null,
    _upFn: null,
    _keyFn: null,

    // ==================== 开关 ====================

    open() {
        const scene = window.__phaserScene;
        const Game = window.Game;
        if (!scene || !Game || !Game.player || this.active) return;
        this.active = true;
        Game._collisionEditMode = true; // 抑制游戏内攻击/按键（input.js 检查）
        this._buildPanel();
        this._gfx = scene.add.graphics().setDepth(999999);
        this._downFn = (e) => this._onMouseDown(e);
        this._moveFn = (e) => this._onMouseMove(e);
        this._upFn = (e) => this._onMouseUp(e);
        this._keyFn = (e) => { if (e.code === 'Escape') this.close(); };
        window.addEventListener('mousedown', this._downFn);
        window.addEventListener('mousemove', this._moveFn);
        window.addEventListener('mouseup', this._upFn);
        window.addEventListener('keydown', this._keyFn, true);
        scene.events.on('update', this._redraw, this);
        // 默认选中第一只怪物，立即给出可拖拽的预览
        const firstEnemy = Object.keys(enemyConfigData)[0];
        if (firstEnemy) {
            this._selectEl.value = `enemy:${firstEnemy}`;
            this.select('enemy', firstEnemy);
        }
    },

    close() {
        const scene = window.__phaserScene;
        if (!this.active) return;
        this.active = false;
        if (window.Game) window.Game._collisionEditMode = false;
        this._removePreview();
        if (scene) scene.events.off('update', this._redraw, this);
        if (this._downFn) {
            window.removeEventListener('mousedown', this._downFn);
            window.removeEventListener('mousemove', this._moveFn);
            window.removeEventListener('mouseup', this._upFn);
            this._downFn = this._moveFn = this._upFn = null;
        }
        if (this._keyFn) { window.removeEventListener('keydown', this._keyFn, true); this._keyFn = null; }
        if (this._gfx) { this._gfx.destroy(); this._gfx = null; }
        if (this._panel) { this._panel.remove(); this._panel = null; }
        this._selectEl = this._infoEl = this._toastEl = null;
        this._drag = this._edit = this._baseline = null;
        clearTimeout(this._toastTimer);
    },

    // ==================== 面板 DOM ====================

    _buildPanel() {
        const panel = document.createElement('div');
        panel.className = 'collision-editor-panel';

        // 标题栏
        const title = document.createElement('div');
        title.className = 'ce-title';
        title.innerHTML = '<span>🎯 碰撞体积编辑器</span>';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ce-close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => this.close());
        title.appendChild(closeBtn);
        panel.appendChild(title);

        // 实体列表（怪物 / NPC 分组）
        const select = document.createElement('select');
        select.className = 'ce-select';
        const grpEnemy = document.createElement('optgroup');
        grpEnemy.label = '怪物';
        for (const [key, cfg] of Object.entries(enemyConfigData)) {
            const opt = document.createElement('option');
            opt.value = `enemy:${key}`;
            opt.textContent = `${cfg.name || key}（${key}）`;
            grpEnemy.appendChild(opt);
        }
        select.appendChild(grpEnemy);
        const grpNpc = document.createElement('optgroup');
        grpNpc.label = 'NPC';
        for (const [key, cfg] of Object.entries(GAME_CONFIG.npcs || {})) {
            const opt = document.createElement('option');
            opt.value = `npc:${key}`;
            opt.textContent = `${cfg.name || key}（${key}）`;
            grpNpc.appendChild(opt);
        }
        select.appendChild(grpNpc);
        select.addEventListener('change', () => {
            const [kind, key] = select.value.split(':');
            this.select(kind, key);
        });
        panel.appendChild(select);
        this._selectEl = select;

        // 当前数值
        const info = document.createElement('div');
        info.className = 'ce-info';
        panel.appendChild(info);
        this._infoEl = info;

        // 按钮行：重置 / 保存
        const btns = document.createElement('div');
        btns.className = 'ce-btns';
        const resetBtn = document.createElement('button');
        resetBtn.className = 'ce-btn';
        resetBtn.textContent = '🔄 重置';
        resetBtn.title = '回退到选中时的配置值（未保存的修改全部丢弃）';
        resetBtn.addEventListener('click', () => this._reset());
        btns.appendChild(resetBtn);
        const saveBtn = document.createElement('button');
        saveBtn.className = 'ce-btn ce-btn-save';
        saveBtn.textContent = '💾 保存';
        saveBtn.title = '写入 data/enemy-config.json / data/game-config.json（刷新仍生效）';
        saveBtn.addEventListener('click', () => this._save());
        btns.appendChild(saveBtn);
        panel.appendChild(btns);

        // 操作提示
        const hint = document.createElement('div');
        hint.className = 'ce-hint';
        hint.innerHTML = '<div>🟩 绿矩形：八点拖拽改宽高</div>'
            + '<div>🟧 圆柱：右缘点=缩放半径，顶缘点=调高矮</div>'
            + '<div>✥ 矩形/椭圆内拖动：整体平移对齐贴图</div>'
            + '<div>Esc 关闭编辑器</div>';
        panel.appendChild(hint);

        // 提示消息
        const toast = document.createElement('div');
        toast.className = 'ce-toast';
        panel.appendChild(toast);
        this._toastEl = toast;

        document.body.appendChild(panel);
        this._panel = panel;
    },

    _toast(msg) {
        if (!this._toastEl) return;
        this._toastEl.textContent = msg;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { if (this._toastEl) this._toastEl.textContent = ''; }, 3000);
    },

    _updateInfo() {
        if (!this._infoEl || !this._edit) return;
        const s = this._edit;
        const r1 = (v) => Math.round(v * 10) / 10;
        this._infoEl.innerHTML = `<div>圆柱半径: ${r1(s.radius)} 高: ${r1(s.height)}</div>`
            + `<div>矩形: ${r1(s.rect.width)} × ${r1(s.rect.height)}</div>`
            + `<div>偏移: X ${r1(s.offsetX)} / Y ${r1(s.offsetY)}</div>`;
    },

    // ==================== 选择与预览生成 ====================

    select(kind, key) {
        this._removePreview();
        this._kind = kind;
        this._key = key;
        this._snapshotBaseline();
        this._spawnPreview();
        if (this._entity) {
            this._initEditFromEntity();
            this._updateInfo();
        }
    },

    _spawnPreview() {
        const Game = window.Game;
        if (!Game || !Game.player) return;
        // 生成在玩家右侧（相机跟随玩家，必在视野内）
        const px = Game.player.x + 170;
        const py = Game.player.y;
        let e = null;
        if (this._kind === 'enemy') {
            const factory = ZOMBIE_FACTORY_MAP[this._key];
            if (factory) {
                e = factory(px, py);
            } else {
                // 无地牢工厂的怪：专属类或通用 Enemy 圆形占位（碰撞编辑不受影响）
                const cfg = JSON.parse(JSON.stringify(enemyConfigData[this._key] || {}));
                const Cls = EXTRA_CLASS_MAP[this._key] || Enemy;
                e = new Cls(px, py, cfg);
            }
            // 冻结预览体：不索敌（警戒范围压到 1px）、不移动、不可受击
            e._alertRange = 1;
            e._aggroRange = 1;
            e._frozenForCast = true;
            e.speed = 0;
            e.maxSpeed = 0;
            e.hittable = false;
            e._collisionPreview = true;
        } else {
            const cfg = JSON.parse(JSON.stringify(GAME_CONFIG.npcs[this._key] || {}));
            delete cfg.wander;      // 预览体不游走
            delete cfg.offset;      // 位置由编辑器决定，不用主神空间布局偏移
            delete cfg.relativeTo;
            cfg.noSeparation = true; // 玩家撞上来时预览体不动
            e = new NPC(px, py, cfg);
            e.npcType = null;        // 预览体不响应「左键对话」
            e._collisionPreview = true;
        }
        Game.entities.set(PREVIEW_KEY, e);
        this._entity = e;
    },

    _removePreview() {
        const Game = window.Game;
        const e = this._entity;
        if (e) {
            e.active = false;
            if (e._phaserSprite) { e._phaserSprite.destroy(); e._phaserSprite = null; }
        }
        if (Game) Game.entities.delete(PREVIEW_KEY);
        this._entity = null;
    },

    // ==================== 编辑值 <-> 实体 / 配置 ====================

    /** 从预览实体当前碰撞状态初始化编辑值 */
    _initEditFromEntity() {
        const e = this._entity;
        const c = e.collider;
        this._defaultHeight = c.height;
        let rect;
        if (this._kind === 'enemy') {
            // 绿色矩形 = 躯干判定（getTorsoRect 同一口径：projectileHitbox 或缺省回退）
            const t = getTorsoRect(e);
            rect = t
                ? { width: t.halfW * 2, height: t.halfH * 2, offsetX: t.cx - c.x, bottom: c.y - (t.cy + t.halfH) }
                : { width: c.radius * 2, height: c.height, offsetX: 0, bottom: 0 };
        } else {
            // NPC 绿色矩形 = 矩形 footprint（中心与 collider 重合，见 GameScene 矩形 footprint 调试）
            rect = {
                width: e.collisionWidth > 0 ? e.collisionWidth : c.radius * 2,
                height: e.collisionHeight > 0 ? e.collisionHeight : c.height,
                offsetX: 0, bottom: 0,
            };
        }
        this._edit = {
            radius: e.collisionRadius > 0 ? e.collisionRadius : c.radius,
            height: c.height,
            offsetX: e.colliderOffsetX || 0,
            offsetY: e.colliderOffsetY || 0,
            rect,
        };
    },

    /** 把编辑值应用到预览实体（立即生效）并同步运行时配置对象 */
    _applyEdit() {
        const e = this._entity;
        const s = this._edit;
        if (!e || !s) return;
        e.collisionRadius = s.radius;
        e.colliderOffsetX = s.offsetX;
        e.colliderOffsetY = s.offsetY;
        // Collider._deriveHeight 最高优先级读 cfg.height，圆柱高矮由此驱动
        if (e.config) e.config.height = s.height;
        if (this._kind === 'enemy') {
            e.config.render = e.config.render || {};
            e.config.render.projectileHitbox = {
                width: s.rect.width, height: s.rect.height,
                offsetX: s.rect.offsetX, bottom: s.rect.bottom,
            };
            e.collisionWidth = s.rect.width;
            e.collisionHeight = s.rect.height;
        } else {
            e.collisionShape = 'rect';
            e.collisionWidth = s.rect.width;
            e.collisionHeight = s.rect.height;
        }
        e.rebuildCollider();
        this._syncConfig();
        this._updateInfo();
    },

    /** 编辑值同步到运行时配置对象（enemyConfigData / GAME_CONFIG.npcs，保存即落盘这份） */
    _syncConfig() {
        const s = this._edit;
        if (!s) return;
        const r1 = (v) => Math.round(v * 10) / 10;
        if (this._kind === 'enemy') {
            const cfg = enemyConfigData[this._key];
            if (!cfg) return;
            cfg.collisionRadius = r1(s.radius);
            // 高度与默认推导值（spriteSize 等）一致时不落 height 键，保持配置简洁
            if (Math.abs(s.height - this._defaultHeight) > 0.5) cfg.height = r1(s.height);
            else delete cfg.height;
            cfg.render = cfg.render || {};
            cfg.render.colliderOffsetX = r1(s.offsetX);
            cfg.render.colliderOffsetY = r1(s.offsetY);
            cfg.render.projectileHitbox = {
                width: r1(s.rect.width), height: r1(s.rect.height),
                offsetX: r1(s.rect.offsetX), bottom: r1(s.rect.bottom),
            };
            // collisionWidth/Height 与 projectileHitbox 保持同源
            // （配置完整性校验要求 collisionHeight === projectileHitbox.height）
            cfg.render.collisionWidth = r1(s.rect.width);
            cfg.render.collisionHeight = r1(s.rect.height);
        } else {
            const n = (GAME_CONFIG.npcs || {})[this._key];
            if (!n) return;
            n.collisionRadius = r1(s.radius);
            if (Math.abs(s.height - this._defaultHeight) > 0.5) n.height = r1(s.height);
            else delete n.height;
            n.collisionShape = 'rect';
            n.collisionWidth = r1(s.rect.width);
            n.collisionHeight = r1(s.rect.height);
            n.colliderOffsetX = r1(s.offsetX);
            n.colliderOffsetY = r1(s.offsetY);
        }
    },

    // ==================== 基线快照 / 重置 / 保存 ====================

    /** 选中时快照相关配置字段（重置回退用） */
    _snapshotBaseline() {
        if (this._kind === 'enemy') {
            const cfg = enemyConfigData[this._key] || {};
            const r = cfg.render || {};
            this._baseline = JSON.parse(JSON.stringify({
                collisionRadius: cfg.collisionRadius,
                height: cfg.height,
                render: {
                    collisionWidth: r.collisionWidth,
                    collisionHeight: r.collisionHeight,
                    colliderOffsetX: r.colliderOffsetX,
                    colliderOffsetY: r.colliderOffsetY,
                    projectileHitbox: r.projectileHitbox,
                },
            }));
        } else {
            const n = (GAME_CONFIG.npcs || {})[this._key] || {};
            this._baseline = JSON.parse(JSON.stringify({
                collisionRadius: n.collisionRadius,
                height: n.height,
                collisionShape: n.collisionShape,
                collisionWidth: n.collisionWidth,
                collisionHeight: n.collisionHeight,
                colliderOffsetX: n.colliderOffsetX,
                colliderOffsetY: n.colliderOffsetY,
            }));
        }
    },

    /** 把基线值写回配置对象；基线中不存在的键删除（编辑新增的键可移除） */
    _restoreFields(obj, baseline) {
        for (const [k, v] of Object.entries(baseline)) {
            if (v === undefined || v === null) delete obj[k];
            else obj[k] = v;
        }
    },

    _reset() {
        if (!this._baseline || !this._key) return;
        if (this._kind === 'enemy') {
            const cfg = enemyConfigData[this._key];
            if (cfg) {
                cfg.render = cfg.render || {};
                this._restoreFields(cfg.render, this._baseline.render);
                this._restoreFields(cfg, { collisionRadius: this._baseline.collisionRadius, height: this._baseline.height });
            }
        } else {
            const n = (GAME_CONFIG.npcs || {})[this._key];
            if (n) this._restoreFields(n, this._baseline);
        }
        // 重新生成预览体：实体字段全部按配置重新推导
        this._removePreview();
        this._spawnPreview();
        if (this._entity) {
            this._initEditFromEntity();
            this._updateInfo();
        }
        this._toast('🔄 已重置为配置值');
    },

    async _save() {
        if (!this._edit || !this._key) return;
        this._syncConfig();
        const rel = this._kind === 'enemy' ? 'data/enemy-config.json' : 'data/game-config.json';
        const data = this._kind === 'enemy' ? enemyConfigData : GAME_CONFIG;
        const ok = await this._persistJson(rel, data);
        // 保存成功后基线推进到当前值（再重置即回到本次保存点）
        this._snapshotBaseline();
        this._toast(ok ? `✅ 已保存到 ${rel}` : '⚠️ 文件写入失败（已尝试下载兜底）');
    },

    /** 保存管道：Electron IPC → Vite __save-json 中间件 → 下载兜底（与 wall-prefabs._persistJson 同规格） */
    async _persistJson(rel, data) {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveJson) {
            await window.electronAPI.saveJson(rel, data);
            return true;
        }
        try {
            const r = await fetch('/__save-json', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ rel, data }),
            });
            if (r.ok) return true;
        } catch {
            // 落到下载兜底
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = rel.split('/').pop();
        a.click();
        URL.revokeObjectURL(a.href);
        return false;
    },

    // ==================== 坐标换算 ====================

    /** 客户端坐标 → 世界坐标（含是否在画布内的判定；与 wall-editor 同口径） */
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

    _zoom() {
        const scene = window.__phaserScene;
        return (scene && scene.cameras.main.zoom) || 1;
    },

    // ==================== 几何 ====================

    /** 绿色矩形当前世界几何 {left,right,top,bottom} */
    _rectGeom() {
        const c = this._entity.collider;
        const r = this._edit.rect;
        if (this._kind === 'enemy') {
            const cx = c.x + r.offsetX;
            const by = c.y - r.bottom;
            return { left: cx - r.width / 2, right: cx + r.width / 2, top: by - r.height, bottom: by };
        }
        // NPC：footprint 矩形，中心与 collider 重合
        return { left: c.x - r.width / 2, right: c.x + r.width / 2, top: c.y - r.height / 2, bottom: c.y + r.height / 2 };
    },

    /** 矩形八点手柄（nw/n/ne/e/se/s/sw/w）世界坐标 */
    _rectHandles() {
        const g = this._rectGeom();
        const cx = (g.left + g.right) / 2;
        const cy = (g.top + g.bottom) / 2;
        return [
            { id: 'nw', x: g.left, y: g.top },
            { id: 'n', x: cx, y: g.top },
            { id: 'ne', x: g.right, y: g.top },
            { id: 'e', x: g.right, y: cy },
            { id: 'se', x: g.right, y: g.bottom },
            { id: 's', x: cx, y: g.bottom },
            { id: 'sw', x: g.left, y: g.bottom },
            { id: 'w', x: g.left, y: cy },
        ];
    },

    /** 圆柱半径手柄（底部椭圆右缘）与高度手柄（顶部椭圆右缘） */
    _radiusHandlePos() {
        const c = this._entity.collider;
        return { x: c.x + this._edit.radius, y: c.y };
    },

    _heightHandlePos() {
        const c = this._entity.collider;
        return { x: c.x + this._edit.radius, y: c.y - this._edit.height };
    },

    // ==================== 鼠标交互 ====================

    _onMouseDown(e) {
        if (e.button !== 0 || !this._entity || !this._edit) return;
        if (!(e.target instanceof Element)) return;
        if (e.target.closest('.collision-editor-panel, .wall-editor-panel, button, input, select, .invincible-toggle, .attack-range-toggle, .dev-tool-trigger, .quick-slot, .side-menu-btn')) return;
        const pt = this._clientToWorld(e);
        if (!pt || !pt.overCanvas) return;

        const hs = HANDLE_SCREEN / this._zoom();
        // 1) 矩形八点手柄
        for (const h of this._rectHandles()) {
            if (Math.abs(pt.x - h.x) <= hs && Math.abs(pt.y - h.y) <= hs) {
                const g = this._rectGeom();
                this._drag = {
                    mode: 'rect', handle: h.id,
                    // 锚定被拖边/角的对面（拖拽过程中不动）
                    anchor: { left: g.left, right: g.right, top: g.top, bottom: g.bottom },
                };
                return;
            }
        }
        // 2) 圆柱半径手柄
        const rh = this._radiusHandlePos();
        if (Math.abs(pt.x - rh.x) <= hs && Math.abs(pt.y - rh.y) <= hs) {
            this._drag = { mode: 'radius' };
            return;
        }
        // 3) 圆柱高度手柄
        const hh = this._heightHandlePos();
        if (Math.abs(pt.x - hh.x) <= hs && Math.abs(pt.y - hh.y) <= hs) {
            this._drag = { mode: 'height' };
            return;
        }
        // 4) 矩形内部 / 底部椭圆内部 → 整体拖动（colliderOffset）
        const g = this._rectGeom();
        const inRect = pt.x >= g.left && pt.x <= g.right && pt.y >= g.top && pt.y <= g.bottom;
        const c = this._entity.collider;
        const rx = this._edit.radius;
        const ry = rx * PERSPECTIVE_SCALE_Y;
        const inEllipse = rx > 0 && (((pt.x - c.x) / rx) ** 2 + ((pt.y - c.y) / ry) ** 2) <= 1;
        if (inRect || inEllipse) {
            this._drag = {
                mode: 'move',
                startPt: { x: pt.x, y: pt.y },
                startOffset: { x: this._edit.offsetX, y: this._edit.offsetY },
            };
        }
    },

    _onMouseMove(e) {
        if (!this._drag || !this._entity || !this._edit) return;
        const pt = this._clientToWorld(e);
        if (!pt) return;
        const s = this._edit;
        const c = this._entity.collider;
        const d = this._drag;

        if (d.mode === 'rect') {
            // 以对侧为锚调整边/角（PhotoShop 八点缩放）
            let { left, right, top, bottom } = d.anchor;
            if (d.handle.includes('w')) left = Math.min(pt.x, right - MIN_RECT);
            if (d.handle.includes('e')) right = Math.max(pt.x, left + MIN_RECT);
            if (d.handle.includes('n')) top = Math.min(pt.y, bottom - MIN_RECT);
            if (d.handle.includes('s')) bottom = Math.max(pt.y, top + MIN_RECT);
            s.rect.width = right - left;
            s.rect.height = bottom - top;
            if (this._kind === 'enemy') {
                s.rect.offsetX = (left + right) / 2 - c.x;
                s.rect.bottom = c.y - bottom;
            } else {
                // NPC 矩形中心 = collider：非对称拖拽转化为 collider 偏移
                s.offsetX = (left + right) / 2 - this._entity.x;
                s.offsetY = (top + bottom) / 2 - this._entity.y;
            }
            this._applyEdit();
        } else if (d.mode === 'radius') {
            // 底部椭圆等比缩放：rx/ry 统一由半径驱动（ry = radius × 透视压缩）
            s.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.abs(pt.x - c.x)));
            this._applyEdit();
        } else if (d.mode === 'height') {
            s.height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, c.y - pt.y));
            this._applyEdit();
        } else if (d.mode === 'move') {
            s.offsetX = d.startOffset.x + (pt.x - d.startPt.x);
            s.offsetY = d.startOffset.y + (pt.y - d.startPt.y);
            this._applyEdit();
        }
    },

    _onMouseUp() {
        this._drag = null;
    },

    // ==================== 覆盖层绘制 ====================

    _redraw() {
        if (!this._gfx || !this._entity || !this._edit) return;
        const e = this._entity;
        if (!e.active || !e.collider) { this._gfx.clear(); return; }
        const g = this._gfx;
        const c = e.collider;
        const s = this._edit;
        const zoom = this._zoom();
        const hs = HANDLE_SCREEN / zoom;
        const r = s.radius;
        const ry = r * PERSPECTIVE_SCALE_Y;
        const topY = c.y - s.height;

        g.clear();

        // ---- 橙色圆柱体（底面椭圆 + 顶面椭圆 + 侧壁，与 GameScene 调试同口径）----
        g.fillStyle(0xff6600, 0.10);
        g.fillEllipse(c.x, c.y, r * 2, ry * 2);
        g.fillEllipse(c.x, topY, r * 2, ry * 2);
        g.fillRect(c.x - r, topY, r * 2, c.y - topY);
        g.lineStyle(1.5 / zoom, 0xff8800, 0.85);
        g.strokeEllipse(c.x, c.y, r * 2, ry * 2);
        g.strokeEllipse(c.x, topY, r * 2, ry * 2);
        g.beginPath();
        g.moveTo(c.x - r, topY); g.lineTo(c.x - r, c.y);
        g.moveTo(c.x + r, topY); g.lineTo(c.x + r, c.y);
        g.strokePath();

        // ---- 绿色矩形 ----
        const rg = this._rectGeom();
        g.fillStyle(0x00ff66, 0.08);
        g.fillRect(rg.left, rg.top, rg.right - rg.left, rg.bottom - rg.top);
        g.lineStyle(1.5 / zoom, 0x00ff66, 0.9);
        g.strokeRect(rg.left, rg.top, rg.right - rg.left, rg.bottom - rg.top);

        // ---- collider 中心十字 ----
        g.lineStyle(1 / zoom, 0xffffff, 0.5);
        g.beginPath();
        g.moveTo(c.x - hs, c.y); g.lineTo(c.x + hs, c.y);
        g.moveTo(c.x, c.y - hs); g.lineTo(c.x, c.y + hs);
        g.strokePath();

        // ---- 手柄：矩形八点（白）+ 半径/高度（橙）----
        g.fillStyle(0xffffff, 1);
        g.lineStyle(1 / zoom, 0x333333, 1);
        for (const h of this._rectHandles()) {
            g.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
            g.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
        }
        g.fillStyle(0xffaa00, 1);
        const rh = this._radiusHandlePos();
        g.fillRect(rh.x - hs / 2, rh.y - hs / 2, hs, hs);
        g.strokeRect(rh.x - hs / 2, rh.y - hs / 2, hs, hs);
        g.fillStyle(0xff5500, 1);
        const hh = this._heightHandlePos();
        g.fillRect(hh.x - hs / 2, hh.y - hs / 2, hs, hs);
        g.strokeRect(hh.x - hs / 2, hh.y - hs / 2, hs, hs);
    },
};

export default CollisionEditor;
