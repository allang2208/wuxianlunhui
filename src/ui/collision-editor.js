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
 * - 墙/门/障碍物（ISO_WALL_GEO 按类型编辑，2026-07-30 整合）：
 *   墙=face 线段两端点拖拽 + 碰撞厚度手柄；障碍物=foot 矩形八点拖拽；
 *   门=打开/关闭两状态切换，打开态门洞（金色高亮）两侧边缘拖拽调通行宽度 + 厚度手柄。
 *   保存写 data/wall-geo-overrides.json 覆盖层（ISO_WALL_GEO 在源码里，JSON 管道只能写 data/），
 *   启动时 WallSystem.applyGeoOverrides 合并生效；编辑时内存同步改 ISO_WALL_GEO + rebuildIsoCollision 立即生效。
 * - 陷阱（zombieDungeon.traps 配置）：触发半径圈右缘手柄 + 数量/伤害/冷却数值输入，
 *   保存写 data/dungeon-config.json。
 * - 重置：回退到选中时的配置快照；保存：直写 data/*.json
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
import { WallSystem, ISO_WALL_GEO, ISO_WALL_HEIGHT, slopeFixOf, isoGateHole, isoHalfThick } from '../world/wall-system.js';
import { getWallGeoOverrides, saveWallGeoOverrides } from '../world/wall-prefabs.js';
import { DungeonConfig } from '../config/dungeon-config.js';

// 无地牢工厂但有专属类的怪物：补充类映射（其余老怪走通用 Enemy 圆形占位预览）
const EXTRA_CLASS_MAP = {
    blackWolf: BlackWolf,
    amalgamZombie: AmalgamZombie,
};

// ===== 墙/门/障碍物类型清单（ISO_WALL_GEO 按规则归类；新增类型自动进列表）=====
// 墙类：有 face 底边线且非门非障碍物；门类：带门洞（gateX/states）；障碍物：category==='obstacle'
const GEO_WALL_KEYS = Object.keys(ISO_WALL_GEO).filter(k => {
    const g = ISO_WALL_GEO[k];
    return g.face && !g.gateX && !g.states && g.category !== 'obstacle';
});
const GEO_GATE_KEYS = Object.keys(ISO_WALL_GEO).filter(k => {
    const g = ISO_WALL_GEO[k];
    return !!(g.gateX || g.states) && g.category !== 'obstacle';
});
const GEO_OBSTACLE_KEYS = Object.keys(ISO_WALL_GEO).filter(k => ISO_WALL_GEO[k].category === 'obstacle');
// 陷阱编辑对象：data/dungeon-config.json zombieDungeon.traps（目前仅僵尸地牢高级一档）
const TRAP_KEY = 'zombieDungeon';

// 预览体在 Game.entities 中的固定键
const PREVIEW_KEY = 'collision_preview';

// 拖拽约束（世界像素）
const MIN_RECT = 4;      // 矩形最小宽/高
const MIN_RADIUS = 4;    // 圆柱最小半径
const MAX_RADIUS = 600;
const MIN_HEIGHT = 4;    // 圆柱最小高度
const MAX_HEIGHT = 1200;
const MIN_HALF_THICK = 2;    // 墙/门碰撞半厚范围
const MAX_HALF_THICK = 60;
const MIN_FOOT = 8;          // 障碍物 footprint 最小宽/深
const MAX_FOOT = 1200;
const MIN_TRIGGER = 10;      // 陷阱触发半径范围
const MAX_TRIGGER = 400;

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

    _kind: null,         // 'enemy' | 'npc' | 'wall' | 'gate' | 'obstacle' | 'trap'
    _key: null,          // 配置键（实体=配置键；墙/门/障碍物=ISO_WALL_GEO 键；陷阱='zombieDungeon'）
    _entity: null,       // 预览实体（怪物/NPC）
    _edit: null,         // 当前编辑值（实体：{radius,height,offsetX,offsetY,rect}；geo 类见 _initEditFromGeo）
    _baseline: null,     // 选中时的配置快照（重置用）
    _defaultHeight: 0,   // 选中时 collider 推导高度（决定保存时是否落 height 键）

    _gateState: 'open',  // 门类编辑状态：open（门洞可通行）| closed（全跨度实心）
    _previewSprite: null, // 墙/门/障碍物/陷阱的预览贴图（非实体预览，不进 isoVisuals）
    _previewPiece: null,  // 墙/门/障碍物预览通用件（texPointToWorld 变换载体）
    _stateRowEl: null,   // 门状态切换行
    _inputsEl: null,     // 数值输入区（陷阱）
    _hintEl: null,       // 操作提示区

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
        this._stateRowEl = this._inputsEl = this._hintEl = null;
        this._gateState = 'open';
        this._drag = this._edit = this._baseline = null;
        clearTimeout(this._toastTimer);
    },

    /** 是否为 geo 类编辑（墙/门/障碍物/陷阱，非实体预览） */
    _isGeoKind() {
        return this._kind === 'wall' || this._kind === 'gate' || this._kind === 'obstacle' || this._kind === 'trap';
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
        // 墙 / 门 / 障碍物（ISO_WALL_GEO 按类型编辑）+ 陷阱（zombieDungeon.traps 配置）
        const addGeoGroup = (label, kind, keys) => {
            if (!keys.length) return;
            const grp = document.createElement('optgroup');
            grp.label = label;
            for (const key of keys) {
                const g = ISO_WALL_GEO[key];
                const opt = document.createElement('option');
                opt.value = `${kind}:${key}`;
                opt.textContent = `${g.editor || key}（${key}）`;
                grp.appendChild(opt);
            }
            select.appendChild(grp);
        };
        addGeoGroup('墙', 'wall', GEO_WALL_KEYS);
        addGeoGroup('门', 'gate', GEO_GATE_KEYS);
        addGeoGroup('障碍物', 'obstacle', GEO_OBSTACLE_KEYS);
        const grpTrap = document.createElement('optgroup');
        grpTrap.label = '陷阱';
        const trapOpt = document.createElement('option');
        trapOpt.value = `trap:${TRAP_KEY}`;
        trapOpt.textContent = '地刺陷阱（zombieDungeon.traps）';
        grpTrap.appendChild(trapOpt);
        select.appendChild(grpTrap);
        select.addEventListener('change', () => {
            const [kind, key] = select.value.split(':');
            this.select(kind, key);
        });
        panel.appendChild(select);
        this._selectEl = select;

        // 门类「打开/关闭」状态切换行（仅选中门类时显示）
        const stateRow = document.createElement('div');
        stateRow.className = 'ce-states';
        stateRow.style.display = 'none';
        panel.appendChild(stateRow);
        this._stateRowEl = stateRow;

        // 数值输入区（陷阱等按类型动态生成）
        const inputs = document.createElement('div');
        inputs.className = 'ce-inputs';
        inputs.style.display = 'none';
        panel.appendChild(inputs);
        this._inputsEl = inputs;

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

        // 操作提示（按选中类型动态切换，见 _refreshHint）
        const hint = document.createElement('div');
        hint.className = 'ce-hint';
        panel.appendChild(hint);
        this._hintEl = hint;

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
        if (this._kind === 'enemy' || this._kind === 'npc') {
            this._infoEl.innerHTML = `<div>圆柱半径: ${r1(s.radius)} 高: ${r1(s.height)}</div>`
                + `<div>矩形: ${r1(s.rect.width)} × ${r1(s.rect.height)}</div>`
                + `<div>偏移: X ${r1(s.offsetX)} / Y ${r1(s.offsetY)}</div>`;
        } else if (this._kind === 'wall') {
            this._infoEl.innerHTML = `<div>face: (${r1(s.face[0][0])},${r1(s.face[0][1])}) → (${r1(s.face[1][0])},${r1(s.face[1][1])})</div>`
                + `<div>碰撞半厚: ${r1(s.halfThick)}</div>`;
        } else if (this._kind === 'gate') {
            this._infoEl.innerHTML = `<div>状态: ${this._gateState === 'open' ? '打开（门洞可通行）' : '关闭（全跨度实心）'}</div>`
                + `<div>门洞: ${r1(s.hole[0])} ~ ${r1(s.hole[1])}（宽 ${r1(s.hole[1] - s.hole[0])}）</div>`
                + `<div>碰撞半厚: ${r1(s.halfThick)}</div>`;
        } else if (this._kind === 'obstacle') {
            this._infoEl.innerHTML = `<div>footprint: ${r1(s.foot.w)} × ${r1(s.foot.d)}</div>`;
        } else if (this._kind === 'trap') {
            this._infoEl.innerHTML = `<div>触发半径: ${r1(s.triggerRadius)} 数量: ${s.count}</div>`
                + `<div>伤害: ${r1(s.damagePercent * 100)}% 冷却: ${s.cooldownMs}ms</div>`;
        }
    },

    /** 门类「打开/关闭」状态切换行（仅门类显示；两状态分别配置碰撞） */
    _buildStateRow() {
        if (!this._stateRowEl) return;
        this._stateRowEl.innerHTML = '';
        this._stateRowEl.style.display = this._kind === 'gate' ? 'flex' : 'none';
        if (this._kind !== 'gate') return;
        for (const [st, label] of [['open', '🚪 打开'], ['closed', '⛔ 关闭']]) {
            const btn = document.createElement('button');
            btn.className = 'ce-btn ce-state-btn' + (this._gateState === st ? ' ce-state-active' : '');
            btn.textContent = label;
            btn.title = st === 'open' ? '打开状态：碰撞=两侧墙身+中间门洞（可通行），门洞宽度可拖边缘微调'
                : '关闭状态：碰撞=全跨度实心（门洞闭合），可调整厚度';
            btn.addEventListener('click', () => {
                this._gateState = st;
                this._syncGateFrame();
                this._buildStateRow();
                this._updateInfo();
            });
            this._stateRowEl.appendChild(btn);
        }
    },

    /** 数值输入区（陷阱：触发半径/数量/伤害/冷却；其余类型隐藏） */
    _buildInputs() {
        if (!this._inputsEl) return;
        this._inputsEl.innerHTML = '';
        if (this._kind !== 'trap' || !this._edit) { this._inputsEl.style.display = 'none'; return; }
        this._inputsEl.style.display = 'block';
        // [标签, 字段, 步进, 最小, 最大, 是否百分数显示]
        const rows = [
            ['触发半径', 'triggerRadius', 1, MIN_TRIGGER, MAX_TRIGGER, false],
            ['数量', 'count', 1, 0, 20, false],
            ['伤害(最大生命%)', 'damagePercent', 1, 0, 100, true],
            ['冷却(ms)', 'cooldownMs', 100, 0, 60000, false],
        ];
        for (const [label, field, step, min, max, isPercent] of rows) {
            const row = document.createElement('div');
            row.className = 'ce-input-row';
            const lab = document.createElement('span');
            lab.textContent = label;
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.step = String(step);
            inp.value = isPercent ? String(Math.round(this._edit[field] * 1000) / 10) : String(this._edit[field]);
            inp.addEventListener('change', () => {
                let v = parseFloat(inp.value);
                if (!Number.isFinite(v)) v = min;
                v = Math.max(min, Math.min(max, v));
                if (isPercent) v = v / 100;
                if (field === 'count') v = Math.round(v);
                this._edit[field] = v;
                this._applyGeoEdit();
            });
            row.appendChild(lab);
            row.appendChild(inp);
            this._inputsEl.appendChild(row);
        }
    },

    /** 操作提示按选中类型切换 */
    _refreshHint() {
        if (!this._hintEl) return;
        const HINTS = {
            entity: '<div>🟩 绿矩形：八点拖拽改宽高</div>'
                + '<div>🟧 圆柱：右缘点=缩放半径，顶缘点=调高矮</div>'
                + '<div>✥ 矩形/椭圆内拖动：整体平移对齐贴图</div>'
                + '<div>Esc 关闭编辑器</div>',
            wall: '<div>🟩 绿线段：拖两端点改墙碰撞跨度（face）</div>'
                + '<div>🟧 橙点：拖离墙线距离=碰撞厚度</div>'
                + '<div>按类型生效：所有同型墙件立即重建</div>'
                + '<div>Esc 关闭编辑器</div>',
            gate: '<div>面板切换 打开/关闭 两状态分别调整</div>'
                + '<div>🟨 金门洞（打开态）：拖两侧边缘调通行宽度</div>'
                + '<div>🟧 橙点：拖离墙线距离=碰撞厚度</div>'
                + '<div>Esc 关闭编辑器</div>',
            obstacle: '<div>🟩 绿矩形：八点拖拽改 footprint 宽/深</div>'
                + '<div>按类型生效：所有同型障碍物立即重建</div>'
                + '<div>Esc 关闭编辑器</div>',
            trap: '<div>🟧 橙圈：右缘手柄调触发半径</div>'
                + '<div>面板数值：数量/伤害/冷却</div>'
                + '<div>Esc 关闭编辑器</div>',
        };
        const k = (this._kind === 'enemy' || this._kind === 'npc') ? 'entity' : this._kind;
        this._hintEl.innerHTML = HINTS[k] || HINTS.entity;
    },

    // ==================== 选择与预览生成 ====================

    select(kind, key) {
        this._removePreview();
        this._kind = kind;
        this._key = key;
        this._gateState = 'open';
        this._snapshotBaseline();
        if (this._isGeoKind()) {
            this._spawnGeoPreview();
            this._initEditFromGeo();
        } else {
            this._spawnPreview();
            if (this._entity) this._initEditFromEntity();
        }
        this._buildStateRow();
        this._buildInputs();
        this._refreshHint();
        this._updateInfo();
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
        // 墙/门/障碍物/陷阱的预览贴图
        if (this._previewSprite) { this._previewSprite.destroy(); this._previewSprite = null; }
        this._previewPiece = null;
    },

    // ==================== 墙/门/障碍物/陷阱：预览与编辑值 ====================

    /** 墙/门/障碍物/陷阱预览：主神空间玩家右侧放一件同尺度贴图（不进 isoVisuals，仅显示） */
    _spawnGeoPreview() {
        const scene = window.__phaserScene;
        const Game = window.Game;
        if (!scene || !Game || !Game.player) return;
        const tx = Game.player.x + 170;
        const ty = Game.player.y;
        if (this._kind === 'trap') {
            // 陷阱：trap_idle 贴图（显示尺寸与运行时同口径 2.6×触发半径）
            const r = (((DungeonConfig.raw[TRAP_KEY] || {}).traps) || {}).triggerRadius ?? 45;
            const sp = scene.add.sprite(tx, ty, 'trap_idle');
            sp.setOrigin(0.5, 0.5);
            sp.setDisplaySize(r * 2.6, r * 2.6);
            sp.setDepth(ty + 0.5);
            this._previewSprite = sp;
            return;
        }
        const g = ISO_WALL_GEO[this._key];
        if (!g || !scene.textures.exists(g.tex)) return;
        let piece;
        if (this._kind === 'obstacle') {
            // 障碍物：与摆墙编辑器同口径的默认显示高度（obstacleH）
            const s = (g.obstacleH ?? 120) / g.h;
            piece = { tex: g.tex, x: tx, y: ty, scaleX: s, scaleY: s, flipX: false };
        } else {
            // 墙/门：与运行时同尺度（ISO_WALL_HEIGHT/wallH + 角度补偿），face 中点锚定目标点
            const s = ISO_WALL_HEIGHT / g.wallH;
            const sy = s * slopeFixOf(g);
            piece = { tex: g.tex, x: tx, y: ty, scaleX: s, scaleY: sy, flipX: false };
            const base = g.face || g.base;
            const fm = WallSystem.texPointToWorld(piece, (base[0][0] + base[1][0]) / 2, (base[0][1] + base[1][1]) / 2);
            piece.x += tx - fm.x;
            piece.y += ty - fm.y;
        }
        this._previewPiece = piece;
        const sp = scene.add.sprite(piece.x, piece.y, piece.tex);
        sp.setOrigin(0.5, 0.5);
        sp.setScale(piece.scaleX, piece.scaleY);
        sp.setDepth(ty + 0.5);
        this._previewSprite = sp;
        this._syncGateFrame();
    },

    /** 门类预览帧跟随编辑状态（16 帧门闸：帧0=关 帧15=开；单帧装饰门无操作） */
    _syncGateFrame() {
        const g = ISO_WALL_GEO[this._key];
        if (this._kind !== 'gate' || !g || !g.frames || !this._previewSprite) return;
        this._previewSprite.setFrame(this._gateState === 'open' ? g.frames - 1 : 0);
    },

    /** 从 ISO_WALL_GEO / 陷阱配置初始化编辑值（含覆盖层合并后的运行时值） */
    _initEditFromGeo() {
        if (this._kind === 'trap') {
            const t = ((DungeonConfig.raw[TRAP_KEY] || {}).traps) || {};
            this._edit = {
                triggerRadius: t.triggerRadius ?? 45,
                count: t.count ?? 3,
                damagePercent: t.damagePercent ?? 0.10,
                cooldownMs: t.cooldownMs ?? 2000,
            };
            return;
        }
        const g = ISO_WALL_GEO[this._key];
        if (!g) { this._edit = null; return; }
        if (this._kind === 'wall') {
            this._edit = {
                face: JSON.parse(JSON.stringify(g.face || g.base)),
                halfThick: isoHalfThick(g),
            };
        } else if (this._kind === 'gate') {
            this._edit = {
                hole: [...(isoGateHole(g) || [0, 0])],
                halfThick: isoHalfThick(g),
            };
        } else if (this._kind === 'obstacle') {
            this._edit = { foot: { w: g.foot.w, d: g.foot.d } };
        }
    },

    /**
     * 编辑值写回运行时配置（ISO_WALL_GEO / 陷阱配置）并重建碰撞立即生效。
     * 注意：拖拽中只重建线段模型（rebuildIsoCollision，纯 JS 开销小）；
     * Phaser 静态体重建（_syncWallsToPhaser）在 mouseup/保存/重置时做一次。
     */
    _applyGeoEdit() {
        const s = this._edit;
        if (!s) return;
        if (this._kind === 'trap') {
            const zd = DungeonConfig.raw[TRAP_KEY] || (DungeonConfig.raw[TRAP_KEY] = {});
            zd.traps = {
                ...(zd.traps || {}),
                triggerRadius: s.triggerRadius, count: s.count,
                damagePercent: s.damagePercent, cooldownMs: s.cooldownMs,
            };
            if (this._previewSprite) this._previewSprite.setDisplaySize(s.triggerRadius * 2.6, s.triggerRadius * 2.6);
            this._updateInfo();
            return;
        }
        const g = ISO_WALL_GEO[this._key];
        if (!g) return;
        if (this._kind === 'wall') {
            g.face = [[s.face[0][0], s.face[0][1]], [s.face[1][0], s.face[1][1]]];
            g.halfThick = s.halfThick;
        } else if (this._kind === 'gate') {
            g.halfThick = s.halfThick;
            // 门洞写两状态模型 states.open.hole，并同步旧 gateX（门闸/宝箱房门/发光裁剪同读）
            g.states = g.states || {};
            g.states.open = { hole: [s.hole[0], s.hole[1]] };
            g.states.closed = { hole: null };
            g.gateX = [s.hole[0], s.hole[1]];
        } else if (this._kind === 'obstacle') {
            g.foot = { w: s.foot.w, d: s.foot.d };
        }
        WallSystem.rebuildIsoCollision();
        this._updateInfo();
    },

    /** 生成该类型的覆盖层条目（写 data/wall-geo-overrides.json；仅含可编辑字段） */
    _buildOverrideEntry() {
        const s = this._edit;
        const r1 = (v) => Math.round(v * 10) / 10;
        if (this._kind === 'wall') {
            return {
                face: [[r1(s.face[0][0]), r1(s.face[0][1])], [r1(s.face[1][0]), r1(s.face[1][1])]],
                halfThick: r1(s.halfThick),
            };
        }
        if (this._kind === 'gate') {
            const hole = [r1(s.hole[0]), r1(s.hole[1])];
            return {
                halfThick: r1(s.halfThick),
                gateX: hole,
                states: { open: { hole }, closed: { hole: null } },
            };
        }
        // 障碍物
        return { foot: { w: r1(s.foot.w), d: r1(s.foot.d) } };
    },

    /** 世界点 → 贴图坐标（texPointToWorld 逆变换） */
    _worldToTex(wx, wy) {
        const g = ISO_WALL_GEO[this._key];
        const p = this._previewPiece;
        let u = (wx - p.x) / (p.scaleX ?? 1);
        let v = (wy - p.y) / (p.scaleY ?? p.scaleX ?? 1);
        if (p.flipX) u = -u;
        if (p.flipY) v = -v;
        return { x: u + g.w / 2, y: v + g.h / 2 };
    },

    /** 墙/门预览的碰撞线段世界几何 { A, B, holeA, holeB }（face/门洞映射，与 _pieceBaseSegments 同口径） */
    _geoSegGeom() {
        const g = ISO_WALL_GEO[this._key];
        const p = this._previewPiece;
        const face = this._kind === 'wall' ? this._edit.face : (g.face || g.base);
        const A = WallSystem.texPointToWorld(p, face[0][0], face[0][1]);
        const B = WallSystem.texPointToWorld(p, face[1][0], face[1][1]);
        let holeA = null, holeB = null;
        if (this._kind === 'gate') {
            const at = (tx) => WallSystem.texPointToWorld(p, tx, face[0][1] + (tx - face[0][0]) * g.slope);
            holeA = at(this._edit.hole[0]);
            holeB = at(this._edit.hole[1]);
        }
        return { A, B, holeA, holeB };
    },

    /** 线段法向单位向量（厚度手柄定位用） */
    _segNormal(A, B) {
        const dx = B.x - A.x, dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: -dy / len, y: dx / len };
    },

    /** 障碍物 footprint 矩形世界几何（锚贴图底边中心，与 _addPieceCollision 同口径） */
    _obstacleRectGeom() {
        const g = ISO_WALL_GEO[this._key];
        const p = this._previewPiece;
        const sx = Math.abs(p.scaleX ?? 1), sy = (p.scaleY ?? p.scaleX ?? 1);
        const fw = this._edit.foot.w * sx, fd = this._edit.foot.d * sy;
        const bottomY = p.y + (g.h * sy) / 2;
        return { left: p.x - fw / 2, right: p.x + fw / 2, top: bottomY - fd, bottom: bottomY };
    },

    /** 障碍物矩形八点手柄（nw/n/ne/e/se/s/sw/w） */
    _obstacleHandles() {
        const g = this._obstacleRectGeom();
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

    /** 陷阱预览中心 */
    _trapCenter() {
        return this._previewSprite ? { x: this._previewSprite.x, y: this._previewSprite.y } : { x: 0, y: 0 };
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
        } else if (this._kind === 'npc') {
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
        } else if (this._kind === 'trap') {
            this._baseline = JSON.parse(JSON.stringify(((DungeonConfig.raw[TRAP_KEY] || {}).traps) || {}));
        } else {
            // 墙/门/障碍物：ISO_WALL_GEO 可编辑字段（含覆盖层合并后的值）
            const g = ISO_WALL_GEO[this._key] || {};
            this._baseline = JSON.parse(JSON.stringify({
                face: g.face, halfThick: g.halfThick, foot: g.foot, gateX: g.gateX, states: g.states,
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
        if (this._kind === 'trap') {
            const zd = DungeonConfig.raw[TRAP_KEY] || (DungeonConfig.raw[TRAP_KEY] = {});
            zd.traps = JSON.parse(JSON.stringify(this._baseline));
            this._initEditFromGeo();
            this._buildInputs();
            this._updateInfo();
            if (this._previewSprite && this._edit) {
                this._previewSprite.setDisplaySize(this._edit.triggerRadius * 2.6, this._edit.triggerRadius * 2.6);
            }
            this._toast('🔄 已重置为配置值');
            return;
        }
        if (this._kind === 'wall' || this._kind === 'gate' || this._kind === 'obstacle') {
            // 基线写回 ISO_WALL_GEO（基线中不存在的键删除=回默认值）并重建碰撞
            const g = ISO_WALL_GEO[this._key];
            if (g) {
                for (const k of ['face', 'halfThick', 'foot', 'gateX', 'states']) {
                    if (this._baseline[k] === undefined || this._baseline[k] === null) delete g[k];
                    else g[k] = JSON.parse(JSON.stringify(this._baseline[k]));
                }
                WallSystem.rebuildIsoCollision();
                if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
            }
            this._initEditFromGeo();
            this._updateInfo();
            this._toast('🔄 已重置为配置值');
            return;
        }
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
        // 墙/门/障碍物/陷阱：geo 覆盖层 / 地牢陷阱配置
        if (this._isGeoKind()) {
            this._applyGeoEdit();
            let rel, ok;
            if (this._kind === 'trap') {
                rel = 'data/dungeon-config.json';
                ok = await this._persistJson(rel, DungeonConfig.raw);
            } else {
                // 内存 ISO_WALL_GEO 已在拖拽时同步；落盘写几何覆盖层（启动时合并生效）
                if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
                const ov = { ...(getWallGeoOverrides() || {}) };
                ov[this._key] = this._buildOverrideEntry();
                rel = 'data/wall-geo-overrides.json';
                ok = await saveWallGeoOverrides(ov);
            }
            // 保存成功后基线推进到当前值（再重置即回到本次保存点）
            this._snapshotBaseline();
            this._toast(ok ? `✅ 已保存到 ${rel}` : '⚠️ 文件写入失败（已尝试下载兜底）');
            return;
        }
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
        if (e.button !== 0 || !this._edit) return;
        if (!(e.target instanceof Element)) return;
        if (e.target.closest('.collision-editor-panel, .wall-editor-panel, button, input, select, .invincible-toggle, .attack-range-toggle, .dev-tool-trigger, .quick-slot, .side-menu-btn')) return;
        const pt = this._clientToWorld(e);
        if (!pt || !pt.overCanvas) return;
        // 墙/门/障碍物/陷阱：geo 类手柄
        if (this._isGeoKind()) { this._onGeoMouseDown(pt); return; }
        if (!this._entity) return;

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

    /** 墙/门/障碍物/陷阱的场景内手柄命中 */
    _onGeoMouseDown(pt) {
        const hs = HANDLE_SCREEN / this._zoom();
        if (this._kind === 'trap') {
            if (!this._previewSprite) return;
            const c = this._trapCenter();
            const rh = { x: c.x + this._edit.triggerRadius, y: c.y };
            if (Math.abs(pt.x - rh.x) <= hs && Math.abs(pt.y - rh.y) <= hs) {
                this._drag = { mode: 'trapRadius' };
            }
            return;
        }
        if (!this._previewPiece) return;
        if (this._kind === 'obstacle') {
            for (const h of this._obstacleHandles()) {
                if (Math.abs(pt.x - h.x) <= hs && Math.abs(pt.y - h.y) <= hs) {
                    this._drag = { mode: 'obstacleRect', handle: h.id };
                    return;
                }
            }
            return;
        }
        // 墙/门：线段类手柄
        const { A, B, holeA, holeB } = this._geoSegGeom();
        // 1) 门洞边缘（仅打开状态可调通行宽度）
        if (this._kind === 'gate' && this._gateState === 'open') {
            if (Math.abs(pt.x - holeA.x) <= hs && Math.abs(pt.y - holeA.y) <= hs) { this._drag = { mode: 'holeEdge', edge: 0 }; return; }
            if (Math.abs(pt.x - holeB.x) <= hs && Math.abs(pt.y - holeB.y) <= hs) { this._drag = { mode: 'holeEdge', edge: 1 }; return; }
        }
        // 2) 墙 face 端点
        if (this._kind === 'wall') {
            if (Math.abs(pt.x - A.x) <= hs && Math.abs(pt.y - A.y) <= hs) { this._drag = { mode: 'faceEnd', end: 0 }; return; }
            if (Math.abs(pt.x - B.x) <= hs && Math.abs(pt.y - B.y) <= hs) { this._drag = { mode: 'faceEnd', end: 1 }; return; }
        }
        // 3) 厚度手柄（线段中点 ± 法向×半厚）
        const n = this._segNormal(A, B);
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        const ht = this._edit.halfThick;
        for (const sign of [1, -1]) {
            const hx = mx + n.x * ht * sign, hy = my + n.y * ht * sign;
            if (Math.abs(pt.x - hx) <= hs && Math.abs(pt.y - hy) <= hs) {
                this._drag = { mode: 'thickness' };
                return;
            }
        }
    },

    _onMouseMove(e) {
        if (!this._drag || !this._edit) return;
        const pt = this._clientToWorld(e);
        if (!pt) return;
        // 墙/门/障碍物/陷阱：geo 类拖拽
        if (this._isGeoKind()) { this._onGeoMouseMove(pt); return; }
        if (!this._entity) return;
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

    /** geo 类拖拽：trapRadius / obstacleRect / faceEnd / holeEdge / thickness */
    _onGeoMouseMove(pt) {
        const s = this._edit;
        const d = this._drag;
        if (d.mode === 'trapRadius') {
            const c = this._trapCenter();
            s.triggerRadius = Math.max(MIN_TRIGGER, Math.min(MAX_TRIGGER, Math.abs(pt.x - c.x)));
            this._applyGeoEdit();
            return;
        }
        if (d.mode === 'obstacleRect') {
            const p = this._previewPiece;
            const sx = Math.abs(p.scaleX ?? 1), sy = (p.scaleY ?? p.scaleX ?? 1);
            const rg = this._obstacleRectGeom();
            // 宽：中心锚定（2×到中心距）；深：锚贴图底边（n=底边到点；s=点到顶边，底边不动）
            if (d.handle.includes('e') || d.handle.includes('w')) {
                s.foot.w = Math.max(MIN_FOOT, Math.min(MAX_FOOT, (2 * Math.abs(pt.x - p.x)) / sx));
            }
            if (d.handle.includes('n')) {
                s.foot.d = Math.max(MIN_FOOT, Math.min(MAX_FOOT, (rg.bottom - pt.y) / sy));
            } else if (d.handle.includes('s')) {
                s.foot.d = Math.max(MIN_FOOT, Math.min(MAX_FOOT, (pt.y - rg.top) / sy));
            }
            this._applyGeoEdit();
            return;
        }
        const g = ISO_WALL_GEO[this._key];
        if (d.mode === 'faceEnd') {
            // face 端点：世界→贴图坐标，钳制贴图范围内 + 两端最小间距 20px
            const t = this._worldToTex(pt.x, pt.y);
            t.x = Math.max(0, Math.min(g.w, t.x));
            t.y = Math.max(0, Math.min(g.h, t.y));
            if (d.end === 0) t.x = Math.min(t.x, s.face[1][0] - 20);
            else t.x = Math.max(t.x, s.face[0][0] + 20);
            s.face[d.end] = [t.x, t.y];
            this._applyGeoEdit();
            return;
        }
        if (d.mode === 'holeEdge') {
            // 门洞边缘：只沿贴图 x 调，钳制在 face 跨度内且保序（最小门洞 10px）
            const face = g.face || g.base;
            const t = this._worldToTex(pt.x, pt.y);
            let tx = Math.max(face[0][0] + 4, Math.min(face[1][0] - 4, t.x));
            if (d.edge === 0) tx = Math.min(tx, s.hole[1] - 10);
            else tx = Math.max(tx, s.hole[0] + 10);
            s.hole[d.edge] = tx;
            this._applyGeoEdit();
            return;
        }
        if (d.mode === 'thickness') {
            // 点到墙线距离 = 新碰撞半厚
            const { A, B } = this._geoSegGeom();
            const dist = WallSystem._pointSegDist(pt.x, pt.y, A.x, A.y, B.x, B.y);
            s.halfThick = Math.max(MIN_HALF_THICK, Math.min(MAX_HALF_THICK, dist));
            this._applyGeoEdit();
        }
    },

    _onMouseUp() {
        // 墙/门/障碍物拖拽结束：Phaser 静态体同步一次（拖拽中只重建线段模型，避免每帧重建物理体）
        if (this._drag && this._edit && this._isGeoKind() && this._kind !== 'trap') {
            if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
        }
        this._drag = null;
    },

    // ==================== 覆盖层绘制 ====================

    _redraw() {
        if (!this._gfx || !this._edit) return;
        // 墙/门/障碍物/陷阱：geo 类覆盖层
        if (this._isGeoKind()) { this._redrawGeo(); return; }
        const e = this._entity;
        if (!e || !e.active || !e.collider) { this._gfx.clear(); return; }
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

    /** 墙/门/障碍物/陷阱覆盖层绘制（绿=碰撞区、金=门洞可通行区、橙=厚度/半径手柄） */
    _redrawGeo() {
        const g = this._gfx;
        const zoom = this._zoom();
        const hs = HANDLE_SCREEN / zoom;
        g.clear();

        // ---- 陷阱：触发半径圈 + 右缘半径手柄 ----
        if (this._kind === 'trap') {
            if (!this._previewSprite) return;
            const c = this._trapCenter();
            const r = this._edit.triggerRadius;
            g.fillStyle(0xff6600, 0.10);
            g.fillCircle(c.x, c.y, r);
            g.lineStyle(1.5 / zoom, 0xff8800, 0.9);
            g.strokeCircle(c.x, c.y, r);
            g.lineStyle(1 / zoom, 0xffffff, 0.5);
            g.beginPath();
            g.moveTo(c.x - hs, c.y); g.lineTo(c.x + hs, c.y);
            g.moveTo(c.x, c.y - hs); g.lineTo(c.x, c.y + hs);
            g.strokePath();
            g.fillStyle(0xffaa00, 1);
            g.lineStyle(1 / zoom, 0x333333, 1);
            g.fillRect(c.x + r - hs / 2, c.y - hs / 2, hs, hs);
            g.strokeRect(c.x + r - hs / 2, c.y - hs / 2, hs, hs);
            return;
        }
        if (!this._previewPiece) return;

        // ---- 障碍物：footprint 绿矩形 + 八点手柄 ----
        if (this._kind === 'obstacle') {
            const rg = this._obstacleRectGeom();
            g.fillStyle(0x00ff66, 0.08);
            g.fillRect(rg.left, rg.top, rg.right - rg.left, rg.bottom - rg.top);
            g.lineStyle(1.5 / zoom, 0x00ff66, 0.9);
            g.strokeRect(rg.left, rg.top, rg.right - rg.left, rg.bottom - rg.top);
            g.fillStyle(0xffffff, 1);
            g.lineStyle(1 / zoom, 0x333333, 1);
            for (const h of this._obstacleHandles()) {
                g.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
                g.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
            }
            return;
        }

        // ---- 墙/门：碰撞线段 + 厚度带 + 手柄 ----
        const { A, B, holeA, holeB } = this._geoSegGeom();
        const ht = this._edit.halfThick;
        const drawSeg = (P, Q, color, fillAlpha) => {
            // 厚度带（半透粗线）+ 中心线（细线）
            g.lineStyle(ht * 2, color, fillAlpha);
            g.beginPath(); g.moveTo(P.x, P.y); g.lineTo(Q.x, Q.y); g.strokePath();
            g.lineStyle(1.5 / zoom, color, 0.95);
            g.beginPath(); g.moveTo(P.x, P.y); g.lineTo(Q.x, Q.y); g.strokePath();
        };
        if (this._kind === 'gate' && this._gateState === 'open') {
            // 打开状态：两侧墙身绿 + 门洞金色高亮（可通行区）
            drawSeg(A, holeA, 0x00ff66, 0.18);
            drawSeg(holeB, B, 0x00ff66, 0.18);
            drawSeg(holeA, holeB, 0xffd700, 0.22);
            g.fillStyle(0xffd700, 1);
            g.lineStyle(1 / zoom, 0x333333, 1);
            for (const h of [holeA, holeB]) {
                g.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
                g.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
            }
        } else {
            // 墙 / 门关闭状态：全跨度实心（绿）
            drawSeg(A, B, 0x00ff66, 0.18);
            if (this._kind === 'wall') {
                // face 端点手柄（白）
                g.fillStyle(0xffffff, 1);
                g.lineStyle(1 / zoom, 0x333333, 1);
                for (const h of [A, B]) {
                    g.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
                    g.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
                }
            }
        }
        // 厚度手柄（橙，线段中点 ± 法向×半厚）
        const n = this._segNormal(A, B);
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        g.fillStyle(0xff8800, 1);
        g.lineStyle(1 / zoom, 0x333333, 1);
        for (const sign of [1, -1]) {
            const hx = mx + n.x * ht * sign, hy = my + n.y * ht * sign;
            g.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
            g.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
        }
    },
};

export default CollisionEditor;
