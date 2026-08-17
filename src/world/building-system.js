/**
 * 世界-122 建筑面板（B 键开关，参考摆墙面板）。
 *
 * - 仅世界-122（scene8）可用；
 * - 花钱摆放：防御塔 + 六档掩体（水平/垂直）；
 * - 不能调大小，只能镜像调整方向（F 切换预览镜像）；
 * - 摆放后即生成可被怪物攻击的实体（DefenseTower / DefenseCover）。
 */
import { Game } from '../game.js';
import { WallSystem } from './wall-system.js';
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { SoundManager } from '../ui/sound-manager.js';
import { UIState } from '../ui/ui-state.js';
import { CONFIG } from '../config/config.js';
import { SceneManager } from './scene-manager.js';
import { Renderer } from './renderer.js';
import {
    DefenseSystem, DefenseTower, DefenseCover, BuildableGate, FiringPlatform,
    DEFENSE_CONFIG, COVER_FACE, COVER_FOOT, GATE_GEOM, GATE4_VISUAL,
    BLOCK_FACE, BLOCK_FOOT, BLOCK_FOOT_OFFSET,
} from './defense-system.js';
import { DefenseTrap, TRAP_CONFIG, TRAP_GRADES, TRAP_SPACING, getTrapDef, DefenseTrapSystem } from './defense-trap-system.js';
import { HamsterHut, HamsterHutSystem, HAMSTER_CONFIG } from './hamster-hut-system.js';
import { HamsterBarracks, HamsterBarracksSystem, BARRACKS_CONFIG } from './hamster-barracks-system.js';
import { ProducerBuilding, ProducerBuildingSystem, PRODUCER_BUILDINGS } from './producer-building-system.js';

// ==================== 可建造项 ====================

/**
 * 掩体墙段两端锚点（相对掩体脚底 x/y 的偏移，世界像素），按级别标定。
 * 与 DefenseCover 的底边线（COVER_FACE）同源；吸附时新件/既有件各自读自己的 grade。
 */
const COVER_SNAP = {};
for (const g of Object.keys(COVER_FACE)) {
    if (!COVER_FACE[g] || !COVER_FACE[g].v) continue;
    COVER_SNAP[g] = {
        v: { L: COVER_FACE[g].v.A, R: COVER_FACE[g].v.B },
        h: { L: COVER_FACE[g].h.A, R: COVER_FACE[g].h.B },
    };
}
// 兼容旧访问（COVER_SNAP.v / COVER_SNAP.h）= D 级
COVER_SNAP.v = COVER_SNAP.D.v;
COVER_SNAP.h = COVER_SNAP.D.h;
export { COVER_SNAP };

/** 铁栅栏门两端锚点（相对门脚底 x/y，世界像素，与 GATE_GEOM.worldFaceLen 同源）：
 *  门作为墙段参与掩体吸附——左右端点贴相邻墙段端点（SNAP_RADIUS 内自动吸附）。 */
const GATE_SNAP = (() => {
    const half = GATE_GEOM.worldFaceLen / 2;
    return {
        v: { L: { x: -half, y: -65 + half * 0.5 }, R: { x: half, y: -65 - half * 0.5 } },
        h: { L: { x: -half, y: -65 - half * 0.5 }, R: { x: half, y: -65 + half * 0.5 } },
    };
})();

/** 吸附触发距离（世界像素）：鼠标预览的墙端锚点与既有墙端锚点在此距离内即吸附 */
const SNAP_RADIUS = 60;
/**
 * 门拼接重叠（世界像素，2026-08-16 一格门改版）：门已缩放到「一格 = 一堵墙」，
 * 端柱即墙的端帽，拼接口径与掩体墙一致（SNAP_OVERLAP=40，端帽完全叠合互盖）。
 */
const GATE_SNAP_OVERLAP = 40;
/** 门拼接允许的端部叠合余量（minGap 用，世界像素）：门端柱叠合最多 ~24px
 * 视为合法端部接触，更深的端叠/中段重叠仍拒绝。 */
const GATE_JOIN_ALLOW = 24;
/**
 * 接缝叠合量（世界像素）：吸附后新件沿走向回退，保证接缝只叠不缺。
 * 2026-08-05 从 8 加大到 40：完整 box 端帽（端面宽 ≈52）在 8px 重叠下未被
 * 完全覆盖，实机拼接处端帽 V 形开口透空（用户反馈"非常明显间隙"）。
 * 40px ≥ 端帽宽度，两端帽完全叠合互盖（skill #25 覆盖区互盖无害），无缝隙。
 */
const SNAP_OVERLAP = 40;

/**
 * 有效朝向：镜像（F）只翻贴图，视觉方向 = 逻辑方向 h/v 互换。
 * 吸附端点、碰撞 footprint、面线统一按有效朝向取，镜像后拼接吸附才生效。
 */
function effOrient(itemOrOrient, mirror) {
    const o = typeof itemOrOrient === 'string' ? itemOrOrient : itemOrOrient.orient;
    return mirror ? (o === 'v' ? 'h' : 'v') : o;
}

/** 产兵建筑可建项判定（小屋/兵营/通用产兵建筑：草屋、铁匠铺等） */
function isProducerKind(item) {
    return item && (item.kind === 'hamster_hut' || item.kind === 'hamster_barracks' || item.kind === 'producer');
}

/** 产兵建筑实体判定（已放置的小屋/兵营/草屋/铁匠铺等） */
function isProducerEntity(e) {
    return e && e.active && (e._isHamsterHut || e._isHamsterBarracks || e._isProducerBuilding);
}

export const BUILD_ITEMS = [
    { id: 'tower', name: '防御塔', cost: 300, tex: 'obstacle_defense_tower', kind: 'tower', currency: 'energy' },
    // 2026-08-17：1×1 方格块（用户方向；价格先 0，网格吸附拼装测试用）
    { id: 'cover_block', name: '方块墙', cost: 0, tex: 'obstacle_block', kind: 'block', grade: 'D', orient: 'v', currency: 'energy' },
    // 2026-08-17：4 格门（左右石柱各 1 格 + 中间 2 格铁栅栏；价格先 0）
    { id: 'gate_4cell', name: '4格门', cost: 0, tex: 'gate_4cell', icon: 'gate_4cell', kind: 'gate4', grade: 'D', orient: 'v', currency: 'energy' },
    { id: 'hamster_hut', name: '仓鼠矿场', cost: 1000, tex: 'mine', kind: 'hamster_hut', currency: 'energy' },
    { id: 'hamster_barracks', name: '仓鼠军营', cost: 1500, tex: 'barracks', kind: 'hamster_barracks', currency: 'energy' },
    { id: 'firing_platform', name: '射击台', cost: 400, tex: 'firing_platform', kind: 'platform', currency: 'energy' },
];
// 产兵建筑（配置驱动，data/producer-buildings.json 唯一真源——出兵时间/出品种类/造价
// 全部在配置里，后续替换建筑只改配置+贴图，不用动代码）
for (const pc of Object.values(PRODUCER_BUILDINGS || {})) {
    // 过滤配置表顶层的 _comment 等非建筑条目（否则生成 { id: undefined, name: undefined }
    // 的“undefined”建筑，2026-08-17 用户反馈建筑面板出现 undefined）
    if (!pc || typeof pc !== 'object' || !pc.id) continue;
    BUILD_ITEMS.push({
        id: pc.id,
        name: pc.name,
        cost: pc.cost,
        tex: pc.tex,
        kind: 'producer',
        currency: 'energy',
    });
}
for (const grade of ['F', 'E', 'D', 'C', 'B', 'A']) {
    // 只保留一种掩体条目（垂直 "/" 向）；F 键镜像即得水平 "\" 向（mirror → eff 交换），
    // 贴图/碰撞/face 线全部跟随镜像，无需水平/垂直两个条目（2026-08-05 简化）。
    BUILD_ITEMS.push({
        id: `cover_${grade}_v`,
        name: `掩体·${grade}级`,
        grade,
        orient: 'v',
        kind: 'cover',
        cost: DEFENSE_CONFIG.covers.hp[grade] * 0.25,
        tex: `obstacle_cover_${grade}_v`,
        currency: 'energy', // 掩体/防御塔用世界-122 能源修建（2026-08-14）
    });
}
// 铁栅栏门（F→A 六档，2026-08-15）：与掩体同口径可被攻击/修理；
// 建筑面板内点击放置，参与墙段吸附；默认关闭，友军靠近自动开门。
for (const grade of ['F', 'E', 'D', 'C', 'B', 'A']) {
    BUILD_ITEMS.push({
        id: `gate_${grade}_v`,
        name: `铁栅栏门·${grade}级`,
        grade,
        orient: 'v',
        kind: 'gate',
        cost: DEFENSE_CONFIG.covers.hp[grade] * 0.25,
        tex: `cover_gate_${grade}`,
        icon: `cover_gate_${grade}_icon`,
        currency: 'energy',
    });
}
// 陷阱：4 类 × F~A 六档（数据源 TRAP_CONFIG，唯一真源）——陷阱维持金币购买
for (const type of Object.keys(TRAP_CONFIG)) {
    const t = TRAP_CONFIG[type];
    for (const grade of TRAP_GRADES) {
        const d = getTrapDef(type, grade);
        if (!d) continue;
        BUILD_ITEMS.push({
            id: `trap_${type}_${grade}`,
            name: `${t.displayName}·${grade}级`,
            grade,
            trapType: type,
            kind: 'trap',
            cost: d.gradeCfg.cost,
            tex: t.tex,
            trapW: t.w,
            trapH: t.h,
            currency: 'gold',
        });
    }
}

// ==================== 建筑系统 ====================

export const BuildingSystem = {
    active: false,
    _placing: null,       // { item, mirror }
    _detail: null,        // 建筑详情视图：当前查看的掩体实体（2026-08-15）
    _ghost: null,
    _guide: null,         // 产兵建筑对齐线（Phaser Graphics，2026-08-17）
    _snapEnabled: true,   // 产兵建筑自动吸附开关（G 键切换，2026-08-17）
    _snapInside: false,   // 墙段吸附位置：false=外部（端到端，默认）/ true=内部（端帽重叠，H 键切换，2026-08-17）
    _snapped: null,        // 当前吸附到的放置坐标 { x, y, e }（无吸附为 null）
    _wallDrag: null,       // 方块墙拖墙状态 { si, sj }（2026-08-17 帝国时代式拖墙）
    _rowPreview: [],       // 拖墙预览精灵（主幽灵之外的行内方块）
    _gatePreviewParts: null, // 4格门实际组件预览 { pillars:[Sprite], bars:Sprite }
    _gatePreviewHiddenBlocks: [], // 替换4连墙时临时隐藏的中间两块实际精灵
    _gate4Dir: null,       // 4 格门最近方向（e1/e2 死区滞回，2026-08-17 二修）
    _gateDrag: null,       // 4 格门拖拽定方向 { ax, ay, dir }（2026-08-17 三修）
    _panel: null,
    _downFn: null,
    _moveFn: null,
    _keyFn: null,
    _seq: 0,
    _refreshTimer: null,

    toggle() {
        if (this.active) this.close();
        else this.open();
    },

    open() {
        if (this.active || !Game.isRunning) return;
        this.active = true;
        Game._buildMode = true;
        // 塔升级面板与建筑面板互斥
        if (DefenseSystem && DefenseSystem._panel && DefenseSystem._panel.isOpen) {
            DefenseSystem._panel.close();
        }
        // 陷阱面板与建筑面板互斥
        if (DefenseTrapSystem && DefenseTrapSystem._panel && DefenseTrapSystem._panel.isOpen) {
            DefenseTrapSystem._panel.close();
        }
        this._buildPanel();
        this._downFn = (e) => this._onMouseDown(e);
        this._moveFn = (e) => this._onMouseMove(e);
        this._upFn = (e) => this._onMouseUp(e);
        this._keyFn = (e) => this._onKey(e);
        window.addEventListener('mousedown', this._downFn);
        window.addEventListener('mousemove', this._moveFn);
        window.addEventListener('mouseup', this._upFn);
        window.addEventListener('keydown', this._keyFn, true);
        // 面板顶行货币实时刷新（采集能源/击杀金币时数字即时跳动，2026-08-14）
        clearInterval(this._refreshTimer);
        this._refreshTimer = setInterval(() => { this._refreshCurrencies(); this._refreshDetail(); }, 500);
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 50, '建筑面板（B 关闭）', '#9acd9a'));
        }
    },

    close() {
        if (!this.active) return;
        this.active = false;
        Game._buildMode = false;
        clearInterval(this._refreshTimer);
        this._refreshTimer = null;
        this._cancelPlacement();
        this._detail = null;
        if (this._downFn) window.removeEventListener('mousedown', this._downFn);
        if (this._moveFn) window.removeEventListener('mousemove', this._moveFn);
        if (this._upFn) window.removeEventListener('mouseup', this._upFn);
        if (this._keyFn) window.removeEventListener('keydown', this._keyFn, true);
        this._downFn = this._moveFn = this._upFn = this._keyFn = null;
        if (this._panel) {
            this._panel.remove();
            this._panel = null;
        }
    },

    /** 点击掩体/铁栅栏门 → 打开建筑详情（2026-08-16 用户口径调整）：
     *  - 只有按 B 打开建设页面（this.active）时才响应，其他时候不弹出；
     *  - 建设模式下无视距离，无论多远都能点击对应建筑打开详情。
     *  由 game.js 点击分发调用；屏幕坐标 → 世界坐标（与防御塔 tryInteract 同口径）。 */
    tryInteract(mx, my, _player) {
        if (!this.active) return false;
        if (!Game || !Game.isRunning || !Game.entities) return false;
        const mw = (Renderer && Renderer.screenToWorld) ? Renderer.screenToWorld(mx, my) : null;
        if (!mw) return false;
        const hit = this._hitTestCover(mw.x, mw.y);
        if (!hit) return false;
        this._showDetail(hit);
        return true;
    },

    // ==================== 面板 ====================

    _buildPanel() {
        if (this._panel) this._panel.remove();
        const el = document.createElement('div');
        // build-panel 专属类（2026-08-15）：拉伸宽度 + 固定三列网格，不影响摆墙编辑器共享样式
        el.className = 'wall-editor-panel build-panel';
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        el.innerHTML = `
            <div class="we-title">建筑面板（世界-122） <span class="we-close" id="bpClose">×</span></div>
            <div class="we-hotkeys" id="bpHotkeys" style="font-size:12px;color:#ffd700;background:rgba(90,70,20,0.25);border:1px solid #6a5a2a;border-radius:4px;padding:4px 8px;margin-bottom:8px;">
                镜像翻转 <b>F</b> ｜ 取消吸附 <b>G</b>（<span id="bpSnapState">开</span>）｜ 墙吸附 <b>H</b>（<span id="bpWallSnap">外部</span>）
            </div>
            <div class="we-info" id="bpCur">
                金币：<b style="color:#ffd700;">${gold}</b>&nbsp;&nbsp;能源：<b style="color:#7fd4ff;">${energy}</b>（点击建筑后到场景里放置）
            </div>
            <div class="we-grid we-std-scroll" id="bpGrid" style="max-height:62vh;overflow-y:auto;">
                ${BUILD_ITEMS.filter((it) => it.kind !== 'trap').map((it) => {
                    const cur = it.currency === 'energy' ? '能' : '金';
                    const thumb = it.icon || it.tex;
                    return `
                    <div class="we-thumb" data-id="${it.id}" title="${it.name} — ${it.cost} ${cur}">
                        <img src="assets/terrain/${thumb}.png" draggable="false" alt="${it.name}">
                        <span>${it.name}<br><em style="color:${it.currency === 'energy' ? '#7fd4ff' : '#ffd700'};font-style:normal;">${it.cost}${cur}</em></span>
                    </div>`;
                }).join('')}
            </div>
            <div id="bpDetail" style="display:none;"></div>
            <div class="we-row" id="bpRow">
                <button id="bpMirror" title="镜像翻转摆放方向（F）">镜像 F</button>
                <button id="bpCancel" title="取消放置（右键/Esc）">取消</button>
                <span class="we-selinfo" id="bpSel">未选择建筑</span>
            </div>
            <div class="we-hints" id="bpHints">
                B=开/关面板 | 点击建筑后移动鼠标预览<br>
                左键放置（掩体/塔扣能源）| F=镜像（垂直↔水平）| 右键/Esc=取消<br>
                点击已建掩体查看详情（耐久/消耗）| Esc=返回/关闭<br>
                掩体靠近已有掩体端点自动吸附（变绿=已吸附）<br>
                墙段只能端点拼接，不能重叠摆放<br>
                H=切换墙段吸附位置（外部=端到端 / 内部=端帽重叠）<br>
                小屋/兵营/铁匠铺/草屋靠近已有同类建筑按地面 30° 地板线轴对齐（F=镜像，G=取消吸附）
            </div>`;
        document.body.appendChild(el);
        this._panel = el;
        el.querySelector('#bpClose').addEventListener('click', () => this.close());
        el.querySelector('#bpMirror').addEventListener('click', () => this._toggleMirror());
        el.querySelector('#bpCancel').addEventListener('click', () => this._cancelPlacement());
        el.querySelector('#bpMirror').addEventListener('click', () => this._updateSnapHint());
        this._updateSnapHint();
        el.querySelectorAll('.we-thumb').forEach((t) => {
            t.addEventListener('click', () => {
                const item = BUILD_ITEMS.find((it) => it.id === t.dataset.id);
                if (item) this._selectItem(item);
            });
        });
    },

    _refreshCurrencies() {
        if (!this._panel) return;
        const el = this._panel.querySelector('#bpCur');
        if (el) {
            el.innerHTML = `金币：<b style="color:#ffd700;">${GoldManager ? GoldManager.getGold() : 0}</b>&nbsp;&nbsp;能源：<b style="color:#7fd4ff;">${EnergyManager ? EnergyManager.getEnergy() : 0}</b>（点击建筑后到场景里放置）`;
        }
    },

    // 兼容旧调用名（面板货币显示统一走 _refreshCurrencies）
    _refreshGold() {
        this._refreshCurrencies();
    },

    _selectItem(item) {
        this._cancelPlacement();
        this._placing = { item, mirror: false };
        const scene = window.__phaserScene;
        if (scene && !this._ghost) {
            this._ghost = scene.add.sprite(0, 0, item.tex);
            this._ghost.setOrigin(0.5, 0.5);
            this._ghost.setAlpha(0.55);
            this._ghost.setDepth(999998);
        }
        // 产兵建筑对齐线（2026-08-17）：吸附时画水平/垂直参考线
        if (scene && !this._guide) {
            this._guide = scene.add.graphics();
            this._guide.setDepth(999997);
            this._guide.setVisible(false);
        }
        if (this._ghost) {
            this._ghost.setTexture(item.tex);
            this._ghost.setVisible(true);
            this._ghost.setFlipX(false);
            // 显示尺寸 = 实体显示尺寸（塔 170×262；掩体 260 宽等比）
            if (item.kind === 'tower') {
                this._ghost.setDisplaySize(170, 262);
            } else if (item.kind === 'hamster_hut') {
                this._ghost.setDisplaySize(HAMSTER_CONFIG.hut.displayW, HAMSTER_CONFIG.hut.displayH);
            } else if (item.kind === 'hamster_barracks') {
                this._ghost.setDisplaySize(BARRACKS_CONFIG.barracks.displayW, BARRACKS_CONFIG.barracks.displayH);
            } else if (item.kind === 'producer') {
                const pc = PRODUCER_BUILDINGS[item.id];
                this._ghost.setDisplaySize(pc.displayW, pc.displayH);
            } else if (item.kind === 'trap') {
                this._ghost.setDisplaySize(item.trapW || 72, item.trapH || 52);
            } else if (item.kind === 'gate') {
                this._ghost.setDisplaySize(GATE_GEOM.cellW * GATE_GEOM.displayScale, GATE_GEOM.cellH * GATE_GEOM.displayScale);
            } else if (item.kind === 'gate4') {
                // 4 格门不用近似合成图：预览由两块真实方块墙 + 实际栅栏帧组成
                this._ghost.setVisible(false);
                this._createGate4Preview(scene);
            } else if (item.kind === 'platform') {
                // 射击台：显示 297×225（八版贴图内容 684×519）——与实体渲染一致
                this._ghost.setDisplaySize(297, 225);
            } else {
                this._ghost.setDisplaySize(260, Math.round(260 / (this._coverAspect(item) || 1)));
            }
        }
        const sel = this._panel && this._panel.querySelector('#bpSel');
        if (sel) sel.textContent = `${item.name}（${item.cost}${item.currency === 'energy' ? '能' : '金'}）— 左键放置 / F 镜像`;
    },

    _coverAspect(item) {
        // 掩体显示宽高比（与 DefenseCover 同源：COVER_ASPECT 表）
        const table = { F: { h: 1.004, v: 1.004 }, E: { h: 1.004, v: 1.004 }, D: { h: 1.004, v: 1.004 }, C: { h: 1.004, v: 1.004 }, B: { h: 1.004, v: 1.004 }, A: { h: 1.004, v: 1.004 } };
        return (table[item.grade] && table[item.grade][item.orient]) || 1;
    },

    _toggleMirror() {
        if (!this._placing) return;
        this._placing.mirror = !this._placing.mirror;
        if (this._placing.item.kind === 'gate4') {
            if (this._snapped) {
                const next = this._snapGate4Grid(this._snapped.x, this._snapped.y);
                if (next) {
                    this._snapped = next;
                    this._updateGate4Preview(next.x, next.y, next.dir);
                }
            }
        } else if (this._ghost) {
            this._ghost.setFlipX(this._placing.mirror);
        }
    },

    /**
     * 产兵建筑对齐吸附（2026-08-17）：以已有建筑的 footprint（地面碰撞体积中心
     * e.x/e.y）为基准，沿地面 30° 地板线轴（SKILL「等距投影素材规范」：地板线
     * 30°、斜率 ±0.5774）做水平/垂直对齐——水平地线（同 v 投影）或垂直地线
     * （同 u 投影），而非贴图边框意义上的屏幕水平/垂直线。
     */
    _snapProducerAlign(x, y) {
        if (!this._snapEnabled) return null;
        const TH = 48; // 吸附阈值（投影差，世界像素）
        const m = 0.5773502691896258; // tan30°：地板线斜率（SKILL「等距投影素材规范」）
        const K = 1 + m * m; // ≈1.3333，沿法向平移的归一化系数
        // 以「视觉中心」（贴图中心 = 逻辑坐标 − footOffsetY）为对齐基准——
        // 不同建筑 footOffsetY 不同（草屋 58 / 兵营 73.5），若按逻辑坐标对齐，
        // 贴图会错开 footOffsetY 差值（用户反馈"吸附错开"的根因，2026-08-17）。
        const newFoot = this._ghostFootOffset() || 0;
        const vy = y - newFoot; // 新建筑贴图中心 y
        // 地面两轴（斜率 ±0.5774）：
        // 水平地线 y = m·x + b → h = y − m·x 相同（沿 +30° 地板线）
        // 垂直地线 y = −m·x + b → w = y + m·x 相同（沿 −30° 地板线）
        const h = vy - m * x;   // 水平地线坐标
        const w = vy + m * x;   // 垂直地线坐标
        let best = null;
        for (const e of Game.entities.values()) {
            if (!isProducerEntity(e)) continue;
            const eFoot = e.footOffsetY || 0;
            const eY = e.y - eFoot; // 已有建筑贴图中心 y
            const eh = eY - m * e.x;
            const ew = eY + m * e.x;
            // 水平对齐：同一水平地线（h 相同），沿法向（−m, 1）平移修正
            const dh = Math.abs(h - eh);
            if (dh <= TH) {
                const t = (eh - h) / K;
                const cand = { x: x - m * t, y: vy + t + newFoot, e, axis: 'h', d: dh };
                if (!best || cand.d < best.d) best = cand;
            }
            // 垂直对齐：同一垂直地线（w 相同），沿法向（m, 1）平移修正
            const dw = Math.abs(w - ew);
            if (dw <= TH) {
                const t = (ew - w) / K;
                const cand = { x: x + m * t, y: vy + t + newFoot, e, axis: 'v', d: dw };
                if (!best || cand.d < best.d) best = cand;
            }
        }
        return best;
    },

    /**
     * 对齐参考线渲染（2026-08-17 v3，按 SKILL 30° 地板线口径改）：
     * 命中时画沿地面 30° 地板线（斜率 ±0.5774）的贯穿轴线 + 落点处的
     * 地面十字坐标轴（两臂沿 ±30° 斜轴），贴合等距地面的透视方向。
     */
    _updateGuide(snap, item, ghostX, ghostY) {
        if (!this._guide) return;
        if (!snap || !isProducerKind(item) || !this._snapEnabled) {
            this._guide.setVisible(false);
            return;
        }
        const g = this._guide;
        g.clear();
        g.lineStyle(2, 0xffd700, 0.9);
        const m = 0.5773502691896258; // tan30°：地板线斜率
        const R = 6000;  // 贯穿轴线半长（世界像素，覆盖视口）
        const L = 120;   // 十字坐标轴臂长（世界像素）
        if (snap.axis === 'h') {
            // 水平地线：沿 +30°（斜率 +m）贯穿，经过 ghost 贴图中心
            // 以 ghost 视觉中心（ghostX/ghostY）为基准，保证轴线穿过贴图中心
            g.lineBetween(ghostX - R, ghostY - m * R, ghostX + R, ghostY + m * R);
        } else {
            // 垂直地线：沿 -30°（斜率 -m）贯穿
            g.lineBetween(ghostX - R, ghostY + m * R, ghostX + R, ghostY - m * R);
        }
        // 落点地面十字坐标轴：两臂分别沿 +30° / -30° 地板线（贴合地面）
        g.lineBetween(ghostX - L, ghostY - m * L, ghostX + L, ghostY + m * L);
        g.lineBetween(ghostX - L, ghostY + m * L, ghostX + L, ghostY - m * L);
        g.setVisible(true);
    },

    /** G 键：切换产兵建筑自动吸附（2026-08-17） */
    _toggleSnap() {
        this._snapEnabled = !this._snapEnabled;
        this._snapped = null; // 切换后清残留吸附位，避免鼠标不动时点落旧吸附点
        if (!this._snapEnabled && this._guide) {
            this._guide.setVisible(false);
        }
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(
                Game.player.x, Game.player.y - 50,
                `自动吸附：${this._snapEnabled ? '开' : '关'}`,
                this._snapEnabled ? '#9dff9d' : '#ff8855'
            ));
        }
        this._updateSnapHint();
    },

    /** H 键：切换墙段吸附位置——外部（端到端）↔ 内部（端帽重叠）（2026-08-17） */
    _toggleSnapInside() {
        this._snapInside = !this._snapInside;
        this._snapped = null; // 切换后清残留吸附点，让 _onMouseMove 按新模式重算
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(
                Game.player.x, Game.player.y - 50,
                `墙段吸附：${this._snapInside ? '内部（端帽重叠）' : '外部（端到端）'}`,
                this._snapInside ? '#9dff9d' : '#ffd700'
            ));
        }
        this._updateSnapHint();
    },

    /** 顶部快捷键提示行：吸附开关 / 墙段吸附位置状态同步（2026-08-17） */
    _updateSnapHint() {
        if (!this._panel) return;
        const st = this._panel.querySelector('#bpSnapState');
        if (st) {
            st.textContent = this._snapEnabled ? '开' : '关';
            st.style.color = this._snapEnabled ? '#9dff9d' : '#ff8855';
        }
        const ws = this._panel.querySelector('#bpWallSnap');
        if (ws) {
            ws.textContent = this._snapInside ? '内部' : '外部';
            ws.style.color = this._snapInside ? '#9dff9d' : '#ffd700';
        }
    },

    _cancelPlacement() {
        this._snapped = null;
        this._wallDrag = null;
        this._gateDrag = null;
        this._clearWallPreview();
        this._destroyGate4Preview();
        if (this._ghost) {
            this._ghost.destroy();
            this._ghost = null;
        }
        if (this._guide) {
            this._guide.destroy();
            this._guide = null;
        }
        this._placing = null;
        const sel = this._panel && this._panel.querySelector('#bpSel');
        if (sel) sel.textContent = '未选择建筑';
    },

    // ==================== 鼠标 / 键盘 ====================

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
            x: p.x,
            y: p.y,
            overCanvas: e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom,
        };
    },

    _onMouseMove(e) {
        if (!this._placing || !this._ghost) return;
        const p = this._clientToWorld(e);
        if (!p || !p.overCanvas) return;
        // 拖墙中：预览一行方块（不吸附单个格）
        if (this._wallDrag) {
            this._updateWallPreview(p.x, p.y);
            return;
        }
        const snap = this._snapPosition(p.x, p.y);
        const item = this._placing.item;
        // 4 格门：幽灵用门图标，按方向翻转（F 镜像换 e1/e2）
        if (item.kind === 'gate4') {
            if (snap && this._canPlaceGate4(snap.x, snap.y, snap.dir)) {
                this._snapped = snap;
                this._updateGate4Preview(snap.x, snap.y, snap.dir);
            } else {
                this._snapped = null;
                this._restoreGate4HiddenBlocks();
                this._setGate4PreviewVisible(false);
            }
            return;
        }
        if (snap && this._canPlace(snap.x, snap.y)) {
            this._snapped = snap;
            const sp = this._ghostAnchor(snap.x, snap.y);
            this._ghost.setPosition(sp.x, sp.y);
            this._ghost.setTint(0x9dff9d); // 吸附成功：绿色提示
        } else {
            this._snapped = null;
            const sp = this._ghostAnchor(p.x, p.y);
            this._ghost.setPosition(sp.x, sp.y);
            // 吸附落点被占用（如门洞另一侧门柱）时不显示吸附；
            // 当前位置本身不可放置则红色提示
            if (this._canPlace(p.x, p.y)) {
                // 自由放置建筑（射击台）可放置时给绿色反馈（无吸附目标，位置合法即绿）
                if (item.kind === 'platform') this._ghost.setTint(0x9dff9d);
                else this._ghost.clearTint();
            }
            else this._ghost.setTint(0xff7777);
        }
        this._updateGuide(snap, item, this._ghost.x, this._ghost.y);
    },

    /** 幽灵锚点：与实体渲染完全一致（精灵中心 = 锚点 + offsetX/footOffsetY） */
    _ghostAnchor(x, y) {
        if (this._placing && this._placing.item.kind === 'platform') {
            // 射击台八版标定：offsetX=-25.6 / footOffsetY=49
            return { x: x - 25.6, y: y - 49 };
        }
        if (this._placing && this._placing.item.kind === 'gate4') {
            return { x, y }; // 4 格门锚点 = 栅栏中点，幽灵直接居中
        }
        return { x, y: y - this._ghostFootOffset() };
    },

    _ghostFootOffset() {
        if (!this._placing) return 0;
        if (this._placing.item.kind === 'tower') return 131;
        if (this._placing.item.kind === 'hamster_hut') return HAMSTER_CONFIG.hut.footOffsetY;
        if (this._placing.item.kind === 'hamster_barracks') return BARRACKS_CONFIG.barracks.footOffsetY;
        if (this._placing.item.kind === 'producer') {
            const pc = PRODUCER_BUILDINGS[this._placing.item.id];
            return pc.footOffsetY;
        }
        if (this._placing.item.kind === 'platform') return 49; // 射击台 footOffsetY（八版标定）
        if (this._placing.item.kind === 'block') return BLOCK_FOOT_OFFSET; // 方块墙：61（与实体一致）
        return this._ghost.displayHeight / 2;
    },

    _onMouseDown(e) {
        if (e.button === 2) {
            // 右键取消放置
            this._cancelPlacement();
            return;
        }
        if (e.button !== 0) return;
        // 点击落在面板自身 DOM 上不穿透到场景
        if (this._panel && e.target && this._panel.contains(e.target)) return;
        // 非放置状态：点击已建掩体 → 详情视图（2026-08-15；
        // 防御塔/陷阱维持原有各自面板，由 game.js 点击分发处理，不在此拦截）
        if (!this._placing) {
            const p = this._clientToWorld(e);
            if (!p || !p.overCanvas) return;
            const cover = this._hitTestCover(p.x, p.y);
            if (cover) this._showDetail(cover);
            return;
        }
        const p = this._clientToWorld(e);
        if (!p || !p.overCanvas) return;
        // 方块墙：按下开始拖墙（帝国时代式：长按拖动沿一条方向铺一排），
        // 松开时才统一放置（普通单击 = 只放起点一块）
        if (this._placing.item.kind === 'block') {
            const snap = this._snapPosition(p.x, p.y) || { x: p.x, y: p.y };
            const [si, sj] = this._blockCellOf(snap.x, snap.y);
            this._wallDrag = { si, sj };
            this._updateWallPreview(snap.x, snap.y);
            return;
        }
        // 落点 = 幽灵已确认可放的吸附位（_onMouseMove 已过滤 canPlace）；
        // 否则用鼠标原始位置。避免"吸附显示绿但点击落点被拒"（右边吸附放不下）
        const snapped = (this._snapped && this._canPlace(this._snapped.x, this._snapped.y))
            ? this._snapped : null;
        this._place(snapped ? snapped.x : p.x, snapped ? snapped.y : p.y);
    },

    /** 松开鼠标：结束拖墙，统一放置预览行（帝国时代式）。 */
    _onMouseUp(e) {
        if (e.button !== 0) return;
        if (!this._wallDrag) return;
        const cells = this._wallRow || [];
        this._wallDrag = null;
        this._clearWallPreview();
        if (cells.length) this._placeBlockRow(cells);
    },

    _onKey(e) {
        // Esc 分层（2026-08-15 用户要求）：放置中 → 取消放置；详情视图 → 返回列表；列表 → 关闭面板
        if (e.code === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (this._placing) { this._cancelPlacement(); return; }
            if (this._detail) { this._closeDetail(); return; }
            this.close();
            return;
        }
        if (!this._placing) return;
        if (e.code === 'KeyF') {
            e.preventDefault();
            this._toggleMirror();
        }
        if (e.code === 'KeyG') {
            e.preventDefault();
            this._toggleSnap();
        }
        if (e.code === 'KeyH') {
            e.preventDefault();
            this._toggleSnapInside();
        }
    },

    // ==================== 摆放 ====================

    /**
     * 掩体端点吸附：找最近的一个既有掩体墙端锚点，把新件对应端贴上去。
     * 掩体/铁栅栏门参与吸附（防御塔不拼接）；同向（v-v / h-h）优先，跨向（v-h 转角）次之。
     * 射击台（2026-08-16 九版）：贴墙拼接吸附——台面边与墙 face 线对齐（见
     * _snapPlatformToWall）；无墙时回退自由放置。
     * @returns {null|{x:number,y:number,e:object}}
     */
    _snapPosition(x, y) {
        const item = this._placing && this._placing.item;
        if (!item) return null;
        // 方块墙：网格吸附（2026-08-17）——1 格 = 64×32 菱形格，贴格心/邻格拼接
        if (item.kind === 'block') return this._snapBlockGrid(x, y);
        // 4 格门：锚点吸附到格网半格位（栅栏跨 2 格的中点），方向跟随主导轴
        if (item.kind === 'gate4') return this._snapGate4Grid(x, y);
        if (item.kind === 'platform') return this._snapPlatformToWall(x, y);
        // 产兵建筑（小屋/兵营/草屋/铁匠铺）：附近同类建筑沿地面 30° 地板线轴对齐（2026-08-17）
        if (isProducerKind(item)) return this._snapProducerAlign(x, y);
        if (item.kind !== 'cover' && item.kind !== 'gate') return null;
        const eff = effOrient(item, this._placing.mirror);
        const off = item.kind === 'gate'
            ? GATE_SNAP[eff]
            : ((COVER_SNAP[item.grade] && COVER_SNAP[item.grade][eff])
                || COVER_SNAP.D[eff] || COVER_SNAP.D.v);
        if (!off) return null;
        const newEnds = [
            { key: 'L', x: x + off.L.x, y: y + off.L.y },
            { key: 'R', x: x + off.R.x, y: y + off.R.y },
        ];
        let best = null;
        for (const e of Game.entities.values()) {
            if (!e || !e._isDefenseStructure || !e.active) continue;
            if (e.orient !== 'h' && e.orient !== 'v') continue;
            const eEff = effOrient(e, e._facingLeft);
            const eo = e._isCoverGate
                ? GATE_SNAP[eEff]
                : ((COVER_SNAP[e.grade] && COVER_SNAP[e.grade][eEff])
                    || COVER_SNAP.D[eEff] || COVER_SNAP.D.v);
            if (!eo) continue;
            const existingEnds = [
                { key: 'L', x: e.x + eo.L.x, y: e.y + eo.L.y },
                { key: 'R', x: e.x + eo.R.x, y: e.y + eo.R.y },
            ];
            for (const ne of newEnds) {
                for (const ee of existingEnds) {
                    const d = Math.hypot(ne.x - ee.x, ne.y - ee.y);
                    if (d > SNAP_RADIUS) continue;
                    const nOff = ne.key === 'L' ? off.L : off.R;
                    let sx = ee.x - nOff.x;
                    let sy = ee.y - nOff.y;
                    // H 键内部吸附（2026-08-17）：新墙端头沿已有墙身方向向墙内偏移
                    // SNAP_OVERLAP（端帽重叠），从"外部端到端"变为"内部端帽互盖"
                    if (this._snapInside) {
                        const eL = existingEnds[0], eR = existingEnds[1];
                        const len = Math.hypot(eR.x - eL.x, eR.y - eL.y) || 1;
                        const ux = (eR.x - eL.x) / len;
                        const uy = (eR.y - eL.y) / len;
                        const dir = ee.key === 'L' ? 1 : -1; // L 端向内=朝 R，R 端向内=朝 L
                        sx += ux * dir * SNAP_OVERLAP;
                        sy += uy * dir * SNAP_OVERLAP;
                    }
                    // 同向延续加分（按视觉/有效朝向判断）；跨向仅在转角处兜底
                    const score = d + (eEff === eff ? 0 : SNAP_RADIUS);
                    if (!best || score < best.score) {
                        best = { x: sx, y: sy, score, same: eEff === eff, e };
                    }
                }
            }
        }
        if (!best) return null;
        // 沿新件轴线向「既有件方向」回退重叠量：接缝只叠不缺。
        // 门用 GATE_SNAP_OVERLAP（端柱叠合防双柱），掩体用 SNAP_OVERLAP（端帽贴图统一）。
        // 方向判定：既有件在新件轴线上的投影方向（dot>0 = 既有在 +axis 侧）。
        // 旧实现 dir 取反了——左外接时新件被推离 40px 产生大间隙（2026-08-05 用户反馈）
        const ax = off.R.x - off.L.x;
        const ay = off.R.y - off.L.y;
        const al = Math.hypot(ax, ay) || 1;
        const dot = (best.e.x - best.x) * ax + (best.e.y - best.y) * ay;
        const dir = dot >= 0 ? -1 : 1;
        // 门对门：端柱需叠在同一位置（51px，见 GATE_SNAP_OVERLAP 注释）；
        // 门对掩体：门的端柱应贴合在墙端（face 端点重合，重叠 0）。
        const overlap = item.kind === 'gate'
            ? (best.e._isCoverGate ? GATE_SNAP_OVERLAP : 0)
            : SNAP_OVERLAP;
        best.x -= (ax / al) * overlap * dir;
        best.y -= (ay / al) * overlap * dir;
        return best;
    },

    /**
     * 方块墙网格吸附（2026-08-17）：1 格 = 64×32 菱形格。
     * - 附近已有方块：优先吸附到其相邻格（沿 ±e1/±e2，格边贴边无缝拼接）；
     * - 否则吸附到最近格心（80px 内）；更远则自由放置。
     * 格网原点取 (4232,4080)，使基地方块环 32 块全部落在整数格上。
     */
    _snapBlockGrid(x, y) {
        const E1 = { x: 64, y: 32 }, E2 = { x: -64, y: 32 };
        let best = null;
        // 1) 已有方块相邻格
        for (const e of Game.entities.values()) {
            if (!e || !e._isDefenseCover || !e._isBlockCover || !e.active) continue;
            for (const off of [[E1.x, E1.y], [E2.x, E2.y], [-E1.x, -E1.y], [-E2.x, -E2.y]]) {
                const cx = e.x + off[0], cy = e.y + off[1];
                const d = Math.hypot(cx - x, cy - y);
                if (d <= 100 && (!best || d < best.d)) {
                    best = { x: Math.round(cx), y: Math.round(cy), d, e, grid: true };
                }
            }
        }
        // 2) 始终吸附到最近格心（1×1 格网，保证方块永远落在格上、无缝对齐）
        const [i, j] = this._blockCellOf(x, y);
        const [gx, gy] = this._blockCellCenter(i, j);
        const d = Math.hypot(gx - x, gy - y);
        if (!best || d < best.d) best = { x: Math.round(gx), y: Math.round(gy), d, grid: true };
        return best;
    },

    /** 方块墙格网坐标（1 格 = 64×32，原点 4232/4080） */
    _blockCellOf(wx, wy) {
        const GX = 4232, GY = 4080;
        const u = (wx - GX) / 64;   // i - j
        const v = (wy - GY) / 32;   // i + j
        return [Math.round((u + v) / 2), Math.round((v - u) / 2)];
    },

    /** 格网坐标 → 格心世界坐标 */
    _blockCellCenter(i, j) {
        return [4232 + i * 64 - j * 64, 4080 + i * 32 + j * 32];
    },

    /**
     * 拖墙预览（帝国时代式）：从起点格沿鼠标主导方向（|Δi|≥|Δj| → e1 向，
     * 否则 e2 向）铺一行，预览主幽灵在行尾、行内其余方块用半透明副本。
     */
    _updateWallPreview(mx, my) {
        const drag = this._wallDrag;
        if (!drag || !this._ghost) return;
        const [ci, cj] = this._blockCellOf(mx, my);
        const di = ci - drag.si, dj = cj - drag.sj;
        const cells = [];
        if (Math.abs(di) >= Math.abs(dj)) {
            const step = di >= 0 ? 1 : -1;
            for (let i = drag.si; i !== ci + step; i += step) cells.push([i, drag.sj]);
        } else {
            const step = dj >= 0 ? 1 : -1;
            for (let j = drag.sj; j !== cj + step; j += step) cells.push([drag.si, j]);
        }
        this._wallRow = cells.map(([i, j]) => this._blockCellCenter(i, j));
        this._clearWallPreview();
        const scene = window.__phaserScene;
        if (!scene) return;
        const item = this._placing.item;
        for (let k = 0; k < this._wallRow.length; k++) {
            const [x, y] = this._wallRow[k];
            const anchor = this._ghostAnchor(x, y);
            const ok = this._canPlaceBlock(x, y);
            if (k === this._wallRow.length - 1) {
                this._ghost.setPosition(anchor.x, anchor.y);
                this._ghost.setTint(ok ? 0x9dff9d : 0xff7777);
                this._ghost.setVisible(true);
            } else {
                const sp = scene.add.sprite(anchor.x, anchor.y, item.tex);
                sp.setOrigin(0.5, 0.5);
                sp.setAlpha(0.55);
                sp.setDepth(999998);
                sp.setDisplaySize(this._ghost.displayWidth, this._ghost.displayHeight);
                sp.setTint(ok ? 0x9dff9d : 0xff7777);
                this._rowPreview.push(sp);
            }
        }
    },

    _clearWallPreview() {
        for (const sp of this._rowPreview || []) {
            if (sp && sp.active) sp.destroy();
        }
        this._rowPreview = [];
    },

    /** 创建4格门真实组件预览：两端方块墙 + D级栅栏关闭帧。 */
    _createGate4Preview(scene) {
        this._destroyGate4Preview();
        if (!scene || !scene.textures) return;
        const pillars = [];
        if (scene.textures.exists('obstacle_block')) {
            for (let i = 0; i < 2; i++) {
                const sp = scene.add.sprite(0, 0, 'obstacle_block');
                sp.setOrigin(0.5, 0.5);
                sp.setDisplaySize(260, 259);
                sp.setAlpha(0.55);
                sp.setDepth(999998);
                sp.setVisible(false);
                pillars.push(sp);
            }
        }
        let bars = null;
        if (scene.textures.exists('cover_gate_D_bars')) {
            bars = scene.add.sprite(0, 0, 'cover_gate_D_bars', 0);
            bars.setOrigin(0.5, 0.5);
            bars.setScale(GATE4_VISUAL.scaleX, GATE4_VISUAL.scaleY);
            bars.setCrop(GATE_GEOM.barCrop.x, GATE_GEOM.barCrop.y, GATE_GEOM.barCrop.w, GATE_GEOM.barCrop.h);
            bars.setAlpha(0.55);
            bars.setDepth(999999);
            bars.setVisible(false);
        }
        this._gatePreviewParts = { pillars, bars };
    },

    _setGate4PreviewVisible(visible) {
        const parts = this._gatePreviewParts;
        if (!parts) return;
        for (const sp of parts.pillars || []) sp.setVisible(visible);
        if (parts.bars) parts.bars.setVisible(visible);
    },

    _restoreGate4HiddenBlocks() {
        for (const item of this._gatePreviewHiddenBlocks || []) {
            if (item.sprite && item.sprite.active) item.sprite.setVisible(item.visible);
        }
        this._gatePreviewHiddenBlocks = [];
    },

    _hideGate4ReplacementBlocks(cells) {
        this._restoreGate4HiddenBlocks();
        if (!this._snapped || !this._snapped.replace) return;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene._neutralSprites) return;
        for (const k of [1, 2]) {
            const [cx, cy] = cells[k];
            const block = this._blockAt(cx, cy);
            const data = block ? scene._neutralSprites.get(block) : null;
            const sprite = data && data.sprite;
            if (!sprite || !sprite.active) continue;
            this._gatePreviewHiddenBlocks.push({ sprite, visible: sprite.visible });
            sprite.setVisible(false);
        }
    },

    _destroyGate4Preview() {
        this._restoreGate4HiddenBlocks();
        const parts = this._gatePreviewParts;
        if (parts) {
            for (const sp of parts.pillars || []) {
                if (sp && sp.active) sp.destroy();
            }
            if (parts.bars && parts.bars.active) parts.bars.destroy();
        }
        this._gatePreviewParts = null;
    },

    /** 4 格门预览与实际放置同构：组件位置、缩放、裁剪与镜像全部复用实体口径。 */
    _updateGate4Preview(ax, ay, dir) {
        const parts = this._gatePreviewParts;
        if (!parts) return;
        const ok = this._canPlaceGate4(ax, ay, dir);
        const cells = this._gate4Cells(ax, ay, dir);
        const tint = ok ? 0x9dff9d : 0xff7777;
        const pillarCells = [cells[0], cells[3]];
        for (let i = 0; i < (parts.pillars || []).length; i++) {
            const sp = parts.pillars[i];
            const cell = pillarCells[i];
            sp.setPosition(cell[0], cell[1] - BLOCK_FOOT_OFFSET);
            // 与实际 DefenseCover 方块深度一致：face maxY + 12 = cellY + 28
            sp.setDepth(999900 + (cell[1] - ay) + 28);
            sp.setTint(tint);
            sp.setVisible(true);
        }
        if (parts.bars) {
            parts.bars.setPosition(ax, ay - GATE4_VISUAL.footOffsetY);
            // 实际 bars 深度 = 门 face 中点 (anchorY+32) + 12
            parts.bars.setDepth(999944);
            parts.bars.setFlipX(dir === 'e1');
            parts.bars.setTint(tint);
            parts.bars.setVisible(true);
        }
        this._hideGate4ReplacementBlocks(cells);
    },

    /** 拖墙落点：整行统一放置（每块独立 canPlace，跳过不可放格）。 */
    _placeBlockRow(cells) {
        const item = this._placing && this._placing.item;
        if (!item) return;
        let n = 0;
        const clearZones = [];
        for (const [x, y] of cells) {
            if (!this._canPlace(x, y)) continue;
            const id = `built_${item.id}_${++this._seq}`;
            const cover = new DefenseCover(x, y, {
                grade: item.grade,
                orient: item.orient,
                mirror: false,
                block: true,
                id,
            });
            Game.entities.set(id, cover);
            clearZones.push({ x, y, radius: 70 });
            n++;
        }
        this._clearBuildZones(clearZones);
        if (n > 0 && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        this._notify(n > 0 ? `${item.name} 已放置 ${n} 块` : `${item.name}：没有可放置的格子`, '#7fd4ff');
    },

    /**
     * 4 格门吸附（2026-08-17）：门锚点 = 栅栏跨 2 格的中点（格网半格位）。
     * e1 向门锚点 = 格心 + 0.5·e1；e2 向门锚点 = 格心 + 0.5·e2；取鼠标较近者。
     */
    _snapGate4Grid(x, y) {
        const [ci, cj] = this._blockCellOf(x, y);
        // 替换：鼠标所在格处于 4 连墙运行 → 锚点取段中间、方向取墙向
        for (const dir of ['e2', 'e1']) {
            const run = this._findWallRun4(ci, cj, dir);
            if (run) {
                const anc = this._gate4AnchorForCell(run[1][0], run[1][1], dir);
                return { x: anc.x, y: anc.y, dir, d: 0, replace: true };
            }
        }
        // 新建：方向固定（默认 e2，仅 F 镜像反转 e1）
        const dir = (this._placing && this._placing.mirror) ? 'e1' : 'e2';
        const anc = this._gate4AnchorFor(x, y, dir);
        return { x: anc.x, y: anc.y, dir, d: Math.round(Math.hypot(anc.x - x, anc.y - y)), replace: false };
    },

    /** 4 格门指定方向的锚点（e1: 格心+0.5·e1；e2: 格心+0.5·e2），保证格对齐 */
    _gate4AnchorFor(x, y, dir) {
        const [ci, cj] = this._blockCellOf(x, y);
        return this._gate4AnchorForCell(ci, cj, dir);
    },

    /** 指定格 + 方向的 4 格门锚点 */
    _gate4AnchorForCell(ci, cj, dir) {
        const [ccx, ccy] = this._blockCellCenter(ci, cj);
        return {
            x: Math.round(ccx + (dir === 'e1' ? 32 : -32)),
            y: Math.round(ccy + 16),
        };
    },

    /** 含 (ci,cj) 的 4 连方块墙运行（沿 dir），无则 null */
    _findWallRun4(ci, cj, dir) {
        const step = dir === 'e1' ? [1, 0] : [0, 1];
        for (let s = -3; s <= 0; s++) {
            const cells = [];
            for (let k = 0; k < 4; k++) cells.push([ci + (s + k) * step[0], cj + (s + k) * step[1]]);
            let ok = true;
            for (const [i, j] of cells) {
                if (!this._blockAtCell(i, j)) { ok = false; break; }
            }
            if (ok) return cells;
        }
        return null;
    },

    /** 4 格门的 4 个格心（沿 dir 方向，k=0..3）：石柱 ±1.5 格、栅栏 ±0.5 格 */
    _gate4Cells(x, y, dir) {
        const vec = dir === 'e1' ? [64, 32] : [-64, 32];
        const out = [];
        for (const t of [-1.5, -0.5, 0.5, 1.5]) {
            out.push([Math.round(x + vec[0] * t), Math.round(y + vec[1] * t)]);
        }
        return out;
    },

    /** 4 格门放置判定：4 格全空（新建）或全为方块墙（替换）才允许；单向：门不可换回墙。 */
    _canPlaceGate4(x, y, dir) {
        const cells = this._gate4Cells(x, y, dir);
        let walls = 0;
        for (const [cx, cy] of cells) {
            if (this._blockAt(cx, cy)) { walls++; continue; }
            if (!this._canPlaceBlock(cx, cy)) return false;
        }
        return walls === 0 || walls === 4;
    },

    /** 该格是否有方块墙实体 */
    _blockAt(x, y) {
        const [ci, cj] = this._blockCellOf(x, y);
        return this._blockAtCell(ci, cj);
    },

    /** 格坐标 (i,j) 上是否有方块墙实体 */
    _blockAtCell(ci, cj) {
        for (const e of Game.entities.values()) {
            if (!e || !e._isBlockCover || !e.active) continue;
            const [ei, ej] = this._blockCellOf(e.x, e.y);
            if (ei === ci && ej === cj) return e;
        }
        return null;
    },

    /** 移除方块墙实体（替换时清掉中间 2 格） */
    _removeWallBlock(e) {
        if (!e) return;
        e.active = false;
        if (WallSystem && WallSystem.isoSegments && e._coverSeg) {
            const i = WallSystem.isoSegments.indexOf(e._coverSeg);
            if (i >= 0) WallSystem.isoSegments.splice(i, 1);
        }
        if (Game.entities) Game.entities.delete(e.id);
        if (typeof e.destroy === 'function') {
            try { e.destroy(); } catch { /* 无 Phaser 环境 */ }
        }
    },

    /**
     * 放置/替换 4 格门：左右石柱（方块墙实体）+ 中间 2 格宽门实体。
     * 替换：4 格全为墙 → 保留两端墙当石柱、移除中间 2 墙、中间加门。
     */
    _placeGate4(x, y, dir) {
        const item = this._placing && this._placing.item;
        if (!item) return;
        const cells = this._gate4Cells(x, y, dir);
        const isReplace = cells.every(([cx, cy]) => !!this._blockAt(cx, cy));
        if (isReplace) {
            // 中间 2 格墙 → 移除（两端墙保留为石柱）
            for (const k of [1, 2]) {
                const [cx, cy] = cells[k];
                this._removeWallBlock(this._blockAt(cx, cy));
            }
        }
        let n = 0;
        // 石柱：k=0, k=3
        for (const k of [0, 3]) {
            const [cx, cy] = cells[k];
            if (isReplace && this._blockAt(cx, cy)) continue; // 替换时保留两端墙
            if (!this._canPlaceBlock(cx, cy)) continue;
            const id = `built_${item.id}_pillar_${++this._seq}`;
            const cover = new DefenseCover(cx, cy, {
                grade: item.grade,
                orient: 'v',
                mirror: false,
                block: true,
                id,
            });
            Game.entities.set(id, cover);
            n++;
        }
        // 门实体：栅栏跨中间 2 格
        const gid = `built_${item.id}_${++this._seq}`;
        const gate = new BuildableGate(x, y, {
            grade: item.grade,
            orient: 'v',
            mirror: dir === 'e1',
            barCells: 2,
            barsOnly: true,
            id: gid,
        });
        Game.entities.set(gid, gate);
        if (DefenseSystem && DefenseSystem.gates) DefenseSystem.gates.push(gate);
        n++;
        this._clearBuildZones(cells.map(([cx, cy]) => ({ x: cx, y: cy, radius: 70 })));
        if (n > 0 && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        this._notify(isReplace ? `${item.name} 已替换（4 墙 → 门）` : `${item.name} 已放置`, '#7fd4ff');
    },

    /**
     * 射击台贴墙拼接吸附（九版）：平台台面边与掩体/门墙 face 线对齐。
     * - v 墙（"/"，slope -0.5）→ 平台后边 B→L（slope -0.49）贴墙；
     *   实体 = 墙中点 + 墙法线 × 130.7（后边中点到实体的垂距）。
     * - h 墙（"\"，slope +0.5）→ 平台右边 R→B（slope +0.50）贴墙；
     *   实体 = 墙中点 + 墙法线 × 161.1（右边中点到实体的垂距）。
     * - 法线朝鼠标侧；F 镜像翻到墙另一侧。吸附点 = 实体（台阶入口），
     *   平台主体沿墙外展、台阶朝房内。
     * 几何常量来自 FiringPlatform 八版标定（display px，相对实体）。
     * @returns {null|{x:number,y:number,e:object,orient:string}}
     */
    _snapPlatformToWall(x, y) {
        const item = this._placing && this._placing.item;
        if (!item || item.kind !== 'platform') return null;
        const mirror = !!(this._placing && this._placing.mirror);
        // 台面边描述：{ 方向, 边中点 rel, 边中点→实体垂距, 朝实体法线 }
        const edgeCfg = {
            v: { perp: 130.7 }, // 后边 B→L
            h: { perp: 161.1 }, // 右边 R→B
        };
        let best = null;
        for (const e of Game.entities.values()) {
            if (!e || !e.active) continue;
            if (!(e._isDefenseCover || e._isCoverGate)) continue; // 只贴掩体/门墙段
            const [A, B] = e._faceLine || [];
            if (!A || !B || typeof A.x !== 'number') continue;
            const d = this._pointSegDist(x, y, A, B);
            if (d > SNAP_RADIUS + 80) continue; // 吸附触发距离（宽松）
            const wx = B.x - A.x, wy = B.y - A.y;
            const wl = Math.hypot(wx, wy) || 1;
            // 墙朝向按斜率符号：slope>0 = "\"(h)、slope<0 = "/"(v)
            // （不能按 B.x-A.x 符号——掩体 v 墙 B.x>A.x 但斜率是负的）
            const orient = (wx * wy) >= 0 ? 'h' : 'v';
            const eg = edgeCfg[orient];
            if (!eg) continue;
            const mx0 = (A.x + B.x) / 2, my0 = (A.y + B.y) / 2;
            // 墙法线：朝鼠标侧
            let nx = -wy / wl, ny = wx / wl;
            if ((x - mx0) * nx + (y - my0) * ny < 0) { nx = -nx; ny = -ny; }
            if (mirror) { nx = -nx; ny = -ny; } // F 镜像：贴墙另一侧
            const sx = mx0 + nx * eg.perp;
            const sy = my0 + ny * eg.perp;
            if (!best || d < best.d) best = { x: Math.round(sx), y: Math.round(sy), d, e, orient };
        }
        if (!best) return null;
        return { x: best.x, y: best.y, e: best.e, wall: best.e, orient: best.orient };
    },

    /** 新掩体的墙段底边线段（face line，世界坐标）——按级别 + 有效朝向 */
    _coverSeg(x, y, grade, eff) {
        if (this._placing && this._placing.item.kind === 'block') {
            const g = BLOCK_FACE[eff] || BLOCK_FACE.v;
            return [
                { x: x + g.A.x, y: y + g.A.y },
                { x: x + g.B.x, y: y + g.B.y },
            ];
        }
        if (this._placing && this._placing.item.kind === 'gate') {
            const half = GATE_GEOM.worldFaceLen / 2;
            const midY = y - 65;
            if (eff === 'v') {
                return [
                    { x: x - half, y: midY + half * 0.5 },
                    { x: x + half, y: midY - half * 0.5 },
                ];
            }
            return [
                { x: x - half, y: midY - half * 0.5 },
                { x: x + half, y: midY + half * 0.5 },
            ];
        }
        const g = (COVER_FACE[grade] && COVER_FACE[grade][eff]) || COVER_FACE.D[eff] || COVER_FACE.D.v;
        return [
            { x: x + g.A.x, y: y + g.A.y },
            { x: x + g.B.x, y: y + g.B.y },
        ];
    },

    /**
     * 两线段最近点参数（Ericson 算法）：返回 { s, t, dist }，
     * s/t ∈ [0,1] 为两段上的最近点参数，dist 为最近距离。
     */
    _segSegClosest(p1, p2, p3, p4) {
        const clamp01 = (v) => Math.max(0, Math.min(1, v));
        const d1 = { x: p2.x - p1.x, y: p2.y - p1.y };
        const d2 = { x: p4.x - p3.x, y: p4.y - p3.y };
        const r = { x: p1.x - p3.x, y: p1.y - p3.y };
        const a = d1.x * d1.x + d1.y * d1.y;
        const e = d2.x * d2.x + d2.y * d2.y;
        const f = d2.x * r.x + d2.y * r.y;
        const eps = 1e-9;
        let s = 0, t = 0;
        if (a <= eps && e <= eps) {
            s = 0; t = 0;
        } else if (a <= eps) {
            s = 0; t = clamp01(f / e);
        } else {
            const c = d1.x * r.x + d1.y * r.y;
            if (e <= eps) {
                t = 0; s = clamp01(-c / a);
            } else {
                const b = d1.x * d2.x + d1.y * d2.y;
                const denom = a * e - b * b;
                s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
                t = (b * s + f) / e;
                if (t < 0) { t = 0; s = clamp01(-c / a); }
                else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
            }
        }
        const cx = p1.x + d1.x * s - (p3.x + d2.x * t);
        const cy = p1.y + d1.y * s - (p3.y + d2.y * t);
        return { s, t, dist: Math.hypot(cx, cy) };
    },

    _canPlace(x, y) {
        if (x < 20 || y < 20 || x > CONFIG.WORLD_WIDTH - 20 || y > CONFIG.WORLD_HEIGHT - 20) return false;
        // 方块墙：格子冲突判定（2026-08-17 二修）——单条 face 线段会压住同向邻格，
        // 改为「同格不可放、邻格/更远可放」+ 地形检查（排除方块自身 face 段）
        if (this._placing && this._placing.item.kind === 'block') {
            return this._canPlaceBlock(x, y);
        }
        // 4 格门：4 个格全部可放
        if (this._placing && this._placing.item.kind === 'gate4') {
            const dir = (this._snapped && this._snapped.dir) || 'e2';
            return this._canPlaceGate4(x, y, dir);
        }
        const radius = this._placing.item.kind === 'tower' || this._placing.item.kind === 'hamster_hut'
            ? 40
            : (this._placing.item.kind === 'trap' ? TRAP_SPACING : 28);
        const canBuild = WallSystem && typeof WallSystem.canBuildAt === 'function'
            ? WallSystem.canBuildAt.bind(WallSystem)
            : (WallSystem && typeof WallSystem.canMoveTo === 'function' ? WallSystem.canMoveTo.bind(WallSystem) : null);
        if (canBuild && !canBuild(x, y, radius)) return false;
        // 射击台（2026-08-16 七版）：自由放置高台，footprint 大（260 显示宽 → 半长 130）——
        // 只要求边界/可通行/间距（平台间 ≥240、其他建筑 ≥90），不依赖任何墙体几何
        if (this._placing.item.kind === 'platform') {
            for (const e of Game.entities.values()) {
                if (!e || !e.active) continue;
                if (e._isFiringPlatform) {
                    if (Math.hypot(e.x - x, e.y - y) < 240) return false;
                    continue;
                }
                if (!e._isDefenseStructure) continue;
                const dx = e.x - x, dy = e.y - y;
                if (dx * dx + dy * dy < 90 * 90) return false;
            }
            return true;
        }
        // 不与已建建筑重叠：掩体按「墙段真实 footprint（底边线段 + 墙厚）」判定——
        // 只检查底部碰撞体积，斜墙不再用轴对齐保守矩形（避免“该能放却红”）；
        // 两墙不能穿越/叠放，仅允许端点相接或吸附后 8px 接缝叠合
        if (this._placing.item.kind === 'cover' || this._placing.item.kind === 'gate' || this._placing.item.kind === 'block') {
            const eff = effOrient(this._placing.item, this._placing.mirror);
            const thick = this._placing.item.kind === 'block'
                ? BLOCK_FOOT.thick
                : this._placing.item.kind === 'gate'
                ? GATE_GEOM.halfThick
                : ((COVER_FOOT[eff] || COVER_FOOT[this._placing.item.orient] || COVER_FOOT.v).thick ?? 26);
            const seg = this._coverSeg(x, y, this._placing.item.grade, eff);
            for (const e of Game.entities.values()) {
                if (!e || !e._isDefenseStructure || !e.active) continue;
                // 2026-08-16 全建筑统一遮挡锚线后：_faceLine 不再是掩体/门专属——
                // 只有墙段类（掩体/门）走线段+墙厚重叠判定；塔/基地/小屋/能源矿等
                // 紧凑建筑仍走圆心距离粗判（否则其面线会被当成 26px 厚墙段误判）
                const wallLike = e._isDefenseCover || e._isCoverGate;
                if (wallLike && e._faceLine && e._faceLine.length === 2) {
                    // 已有掩体：线段 + 墙厚
                    const eThick = e._coverHalfThick ?? 26;
                    const minGap = (thick + eThick) / 2
                        - (this._placing.item.kind === 'gate' ? GATE_JOIN_ALLOW : SNAP_OVERLAP);
                    const cp = this._segSegClosest(seg[0], seg[1], e._faceLine[0], e._faceLine[1]);
                    // 端点-端点接触（吸附拼接的 8px 叠合）允许；只有“端部插入
                    // 对方墙段中部/侧向侵入”才拒绝——平铺摆放判定只认底部碰撞体积
                    // 端帽叠合容差（2026-08-16 实锤修复）：吸附回退让新件端点在既有件
                    // 端帽内 4px（门 GATE_SNAP_OVERLAP）~40px（掩体），最近点参数落在
                    // 端部 1%~20%；旧 1e-4 会把"门 4px 回退 → s≈0.013"的合法端到端
                    // 拼接误判为重叠拒绝（吸附成功但 canPlace=false，用户看不到吸附）。
                    // 8% ≈ 门 24px / 掩体 16px 的端部接触；更深的中段重叠仍被 minGap 拒绝。
                    // 端帽容差（2026-08-16 二修）：门对门端柱叠合 51px → s≈0.169，
                    // 门对掩体 face 重合 → s≈0；容差取 0.18 接受这两类合法端部接触；
                    // 更深的端叠/中段重叠仍被 minGap 拒绝。
                    const endEnd = (cp.s <= 0.18 || cp.s >= 1 - 0.18)
                        && (cp.t <= 0.18 || cp.t >= 1 - 0.18);
                    if (!endEnd && cp.dist < minGap) return false;
                } else {
                    // 塔/基地：圆心距离粗判
                    const dx = e.x - x;
                    const dy = e.y - y;
                    if (dx * dx + dy * dy < 70 * 70) return false;
                }
            }
            return true;
        }
        if (this._placing.item.kind === 'trap') {
            // 陷阱：放路上（不参与掩体墙段判定），但不得压塔/基座/其他陷阱
            for (const e of Game.entities.values()) {
                if (!e || !e.active) continue;
                const dx = e.x - x;
                const dy = e.y - y;
                if (dx * dx + dy * dy < TRAP_SPACING * TRAP_SPACING) return false;
            }
            return true;
        }
        for (const e of Game.entities.values()) {
            if (!e || !e._isDefenseStructure || !e.active) continue;
            const dx = e.x - x;
            const dy = e.y - y;
            if (dx * dx + dy * dy < 70 * 70) return false;
        }
        return true;
    },

    /** 方块墙放置判定：1×1 格心冲突 + 地形（树/仙人掌/世界边界）。 */
    _canPlaceBlock(x, y) {
        const [ni, nj] = this._blockCellOf(x, y);
        const ignoreSegs = new Set();
        for (const e of Game.entities.values()) {
            if (!e || !e._isDefenseStructure || !e.active) continue;
            if (e._isBlockCover) {
                if (e._coverSeg) ignoreSegs.add(e._coverSeg);
                const [ei, ej] = this._blockCellOf(e.x, e.y);
                if (ei === ni && ej === nj) return false; // 同格不可放
                continue;
            }
            const dx = e.x - x, dy = e.y - y;
            if (dx * dx + dy * dy < 70 * 70) return false;
        }
        const canBuild = WallSystem && typeof WallSystem.canBuildAt === 'function'
            ? WallSystem.canBuildAt.bind(WallSystem)
            : (WallSystem && typeof WallSystem.canMoveTo === 'function' ? WallSystem.canMoveTo.bind(WallSystem) : null);
        if (canBuild) {
            // 方块自身/其它方块的 face 段不参与阻挡（格子判定已管重叠），
            // 树/仙人掌/世界边界仍生效
            if (!canBuild(x, y, 28, { rects: new Set(), segs: ignoreSegs })) return false;
        }
        return true;
    },

    // ==================== 建筑详情视图（2026-08-15：面板内切换，仅掩体） ====================

    /** 掩体/门命中检测：face 线段距离（墙厚 + 24px 余量）或脚底 90px 圆，取最近者 */
    _hitTestCover(wx, wy) {
        let best = null;
        for (const e of Game.entities.values()) {
            if (!e || !(e._isDefenseCover || e._isCoverGate) || !e.active) continue;
            let d = Infinity;
            if (e._faceLine && e._faceLine.length === 2) {
                d = this._pointSegDist(wx, wy, e._faceLine[0], e._faceLine[1]) - (e._coverHalfThick ?? 26);
            }
            d = Math.min(d, Math.hypot(wx - e.x, wy - e.y) - 90);
            if (d <= 24 && (!best || d < best.d)) best = { e, d };
        }
        return best ? best.e : null;
    },

    /** 点到线段的最短距离 */
    _pointSegDist(px, py, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
    },

    _showDetail(entity) {
        this._detail = entity;
        this._renderDetail();
    },

    _closeDetail() {
        this._detail = null;
        this._renderDetail();
    },

    /** 详情视图渲染：_detail 为空回到网格列表；建筑被摧毁自动退回 */
    _renderDetail() {
        if (!this._panel) return;
        const grid = this._panel.querySelector('#bpGrid');
        const det = this._panel.querySelector('#bpDetail');
        if (!grid || !det) return;
        let e = this._detail;
        let show = !!(e && e.active && e.hp > 0);
        if (e && !show) {
            e = this._detail = null;
            show = false;
            this._notify('建筑已被摧毁', '#ff8855');
        }
        // 详情与建筑列表并排显示（2026-08-16）：不再隐藏网格/操作行/提示
        det.style.display = show ? '' : 'none';
        if (!show) return;
        // 门走专属详情（含常锁/常开模式按钮，2026-08-15）
        if (e._isCoverGate) { this._renderGateDetail(det, e); return; }
        // 射击台专属详情（2026-08-16）：不再误显示"掩体·F级"（grade 为 undefined）
        if (e._isFiringPlatform) { this._renderPlatformDetail(det, e); return; }
        // 掩体详情：贴图 / 耐久条 / 朝向 / 建造消耗 / 修理费率 / 回满预估
        const g = e.grade || 'F';
        const maxHp = e.maxHp || 1;
        const hp = Math.max(0, Math.ceil(e.hp));
        const pct = Math.round((hp / maxHp) * 100);
        const barColor = pct > 60 ? '#7fd47f' : (pct > 30 ? '#ffd700' : '#ff6666');
        const buildCost = Math.round((DEFENSE_CONFIG.covers.hp[g] ?? 400) * 0.25);
        const repairRate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.coverHpPerEnergy) || 2;
        const repairNeed = Math.ceil((maxHp - hp) / repairRate);
        const eff = effOrient(e, e._facingLeft);
        const orientTxt = eff === 'v' ? '垂直（/）' : '水平（\\）';
        det.innerHTML = `
            <div class="bp-detail-head">
                <img src="assets/terrain/obstacle_cover_${g}_v.png" draggable="false" alt="掩体·${g}级">
                <div style="flex:1;min-width:0;">
                    <div class="bp-detail-name">掩体·${g}级</div>
                    <div class="bp-hpbar"><div style="width:${pct}%;background:${barColor};"></div></div>
                    <div style="font-size:11px;color:#b0a892;">耐久 ${hp} / ${maxHp}（${pct}%）</div>
                </div>
            </div>
            <div class="bp-detail-rows">
                朝向：<b>${orientTxt}</b><br>
                建造消耗：<b style="color:#7fd4ff;">${buildCost} 能源</b><br>
                修理费率：<b>${repairRate} 耐久 / 1 能源</b>（点击下方按钮修理）<br>
                回满预估：<b style="color:#7fd4ff;">≈ ${repairNeed} 能源</b>
            </div>
            <div style="display:flex;gap:8px;">
                <button id="bpBack" class="bp-back" style="flex:1;">← 返回列表</button>
                <button id="bpRepair" class="bp-repair" style="flex:1;" ${hp >= maxHp ? 'disabled' : ''}>${hp >= maxHp ? '耐久已满' : `修 理（-${repairNeed} 能源）`}</button>
            </div>`;
        det.querySelector('#bpBack').addEventListener('click', () => this._closeDetail());
        det.querySelector('#bpRepair').addEventListener('click', () => this._repairCover());
    },

    /** 射击台详情（2026-08-16）：名称/贴图/耐久/用途 + 修理（复用 _repairCover） */
    _renderPlatformDetail(det, e) {
        const maxHp = e.maxHp || 800;
        const hp = Math.max(0, Math.ceil(e.hp));
        const pct = Math.round((hp / maxHp) * 100);
        const barColor = pct > 60 ? '#7fd47f' : (pct > 30 ? '#ffd700' : '#ff6666');
        const repairRate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.coverHpPerEnergy) || 2;
        const repairNeed = Math.ceil((maxHp - hp) / repairRate);
        det.innerHTML = `
            <div class="bp-detail-head">
                <img src="assets/terrain/firing_platform.png" draggable="false" alt="射击台" style="width:96px;height:89px;object-fit:contain;">
                <div style="flex:1;min-width:0;">
                    <div class="bp-detail-name">射击台</div>
                    <div class="bp-hpbar"><div style="width:${pct}%;background:${barColor};"></div></div>
                    <div style="font-size:11px;color:#b0a892;">耐久 ${hp} / ${maxHp}（${pct}%）</div>
                </div>
            </div>
            <div class="bp-detail-rows">
                用途：站上高台可越过己方掩体向外射击<br>
                修理费率：<b>${repairRate} 耐久 / 1 能源</b>（点击下方按钮修理）<br>
                回满预估：<b style="color:#7fd4ff;">≈ ${repairNeed} 能源</b>
            </div>
            <div style="display:flex;gap:8px;">
                <button id="bpBack" class="bp-back" style="flex:1;">← 返回列表</button>
                <button id="bpRepair" class="bp-repair" style="flex:1;" ${hp >= maxHp ? 'disabled' : ''}>${hp >= maxHp ? '耐久已满' : `修 理（-${repairNeed} 能源）`}</button>
            </div>`;
        det.querySelector('#bpBack').addEventListener('click', () => this._closeDetail());
        det.querySelector('#bpRepair').addEventListener('click', () => this._repairCover());
    },

    /** 门详情（2026-08-15）：耐久/消耗/修理 + 常锁门/常开门模式按钮（当前模式金框高亮） */
    _renderGateDetail(det, e) {
        const g = e.grade || 'D';
        const maxHp = e.maxHp || 1;
        const hp = Math.max(0, Math.ceil(e.hp));
        const pct = Math.round((hp / maxHp) * 100);
        const barColor = pct > 60 ? '#7fd47f' : (pct > 30 ? '#ffd700' : '#ff6666');
        const buildCost = Math.round((DEFENSE_CONFIG.covers.hp[g] ?? 400) * 0.25);
        const repairRate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.coverHpPerEnergy) || 2;
        const repairNeed = Math.ceil((maxHp - hp) / repairRate);
        const mode = e.gateMode || 'auto';
        const modeTxt = mode === 'locked' ? '常锁（任何单位经过都不开）'
            : (mode === 'open' ? '常开（门口保持敞开）' : '自动（友军靠近开门）');
        const stateTxt = (e.state === 'open' || e.state === 'opening') ? '开启' : '关闭';
        det.innerHTML = `
            <div class="bp-detail-head">
                <div class="bp-gate-icon">🚪</div>
                <div style="flex:1;min-width:0;">
                    <div class="bp-detail-name">${e.name || `铁栅栏门·${g}级`}</div>
                    <div class="bp-hpbar"><div style="width:${pct}%;background:${barColor};"></div></div>
                    <div style="font-size:11px;color:#b0a892;">耐久 ${hp} / ${maxHp}（${pct}%）· 当前${stateTxt}</div>
                </div>
            </div>
            <div class="bp-detail-rows">
                建造消耗：<b style="color:#7fd4ff;">${buildCost} 能源</b><br>
                修理费率：<b>${repairRate} 耐久 / 1 能源</b>（点击下方按钮修理）<br>
                回满预估：<b style="color:#7fd4ff;">≈ ${repairNeed} 能源</b><br>
                门模式：<b style="color:#ffd700;">${modeTxt}</b>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="bpGateLock" class="bp-mode-lock" style="flex:1;${mode === 'locked' ? 'outline:2px solid #ffd700;' : ''}">常锁门</button>
                <button id="bpGateOpen" class="bp-mode-open" style="flex:1;${mode === 'open' ? 'outline:2px solid #ffd700;' : ''}">常开门</button>
            </div>
            <div style="display:flex;gap:8px;">
                <button id="bpBack" class="bp-back" style="flex:1;">← 返回列表</button>
                <button id="bpRepair" class="bp-repair" style="flex:1;" ${hp >= maxHp ? 'disabled' : ''}>${hp >= maxHp ? '耐久已满' : `修 理（-${repairNeed} 能源）`}</button>
            </div>`;
        det.querySelector('#bpBack').addEventListener('click', () => this._closeDetail());
        det.querySelector('#bpRepair').addEventListener('click', () => this._repairCover());
        det.querySelector('#bpGateLock').addEventListener('click', () => {
            if (this._detail && typeof this._detail.setMode === 'function') this._detail.setMode('locked');
            this._renderDetail();
        });
        det.querySelector('#bpGateOpen').addEventListener('click', () => {
            if (this._detail && typeof this._detail.setMode === 'function') this._detail.setMode('open');
            this._renderDetail();
        });
    },

    /** 详情实时刷新（500ms 跟随 _refreshTimer）：耐久条战斗中跳动；被摧毁自动退回 */
    _refreshDetail() {
        if (this._detail) this._renderDetail();
    },

    /**
     * 按钮修理（2026-08-15 用户要求，替代原 E 键长按——快捷键冲突）：
     * 点击一次修满；能源不足时修到能负担的上限。费率 = DEFENSE_CONFIG.repair.coverHpPerEnergy。
     * 修理入口仅此一处：建筑面板（B）掩体详情视图。
     */
    _repairCover() {
        const e = this._detail;
        if (!e || !e.active || e.hp >= e.maxHp) return;
        const rate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.coverHpPerEnergy) || 2;
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        const want = Math.min(e.maxHp - e.hp, energy * rate);
        if (want <= 0) {
            this._notify('能源不足，无法修理', '#ff5555');
            return;
        }
        const cost = Math.max(1, Math.ceil(want / rate));
        if (!EnergyManager || !EnergyManager.deductEnergy(cost)) {
            this._notify('能源不足，无法修理', '#ff5555');
            return;
        }
        e.hp = Math.min(e.maxHp, e.hp + want);
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(e.x, e.y - 40, `+${Math.round(want)} 修理`, '#7fd4ff'));
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        this._renderDetail();
        this._refreshCurrencies();
    },

    _notify(text, color) {
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, text, color || '#d4c5a9'));
        }
    },

    /** 建造成功后的可清除物批处理：散布障碍只重建一次碰撞，草地 chunk 只重烘焙一次。 */
    _clearBuildZones(zones) {
        const validZones = (zones || []).filter((z) => z && z.radius > 0);
        if (validZones.length === 0) return;
        if (WallSystem && typeof WallSystem.removeScatterObstaclesInZones === 'function') {
            WallSystem.removeScatterObstaclesInZones(validZones);
        } else if (WallSystem && typeof WallSystem.removeScatterObstaclesAt === 'function') {
            for (const z of validZones) WallSystem.removeScatterObstaclesAt(z.x, z.y, z.radius);
        }
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && typeof scene.eraseDecoBatch === 'function') {
            scene.eraseDecoBatch(validZones);
        } else if (scene && typeof scene.eraseDecoAt === 'function') {
            for (const z of validZones) scene.eraseDecoAt(z.x, z.y, z.radius);
        }
    },

    /**
     * 上夹角图层校正（2026-08-17）：手动摆放两堵墙在顶部（各自 face 上端）交汇
     * 形成上夹角时，左臂（v 向 "/"、TL 边）depth +0.5 盖住右臂（h 向 "\"、TR 边），
     * 即左墙在右墙之上。内部吸附（H）端帽重叠 40px，端点容差取 50。
     */
    _fixCoverCornerDepth(cover) {
        if (!cover || !cover._faceLine || typeof cover._faceDepth !== 'number') return;
        const eps = 50; // 端点容差（覆盖内部吸附 40px 端帽重叠）
        for (const e of Game.entities.values()) {
            if (!e || e === cover || !e._isDefenseStructure || !e.active) continue;
            if (!e._faceLine || e._isCoverGate) continue;
            for (const p of cover._faceLine) {
                for (const q of e._faceLine) {
                    if (Math.hypot(p.x - q.x, p.y - q.y) > eps) continue;
                    // 交汇点须在两墙各自 face 的上端（顶部顶点 T）→ 才是上夹角
                    const coverTop = Math.min(cover._faceLine[0].y, cover._faceLine[1].y);
                    const eTop = Math.min(e._faceLine[0].y, e._faceLine[1].y);
                    if (p.y > coverTop + eps || q.y > eTop + eps) continue;
                    const coverV = cover.orient === 'v';
                    const eV = e.orient === 'v';
                    const bias = 0.5;
                    if (coverV && !eV) {
                        // 新墙 = 左臂（v），已有 = 右臂（h）→ 左盖右
                        cover._faceDepth = Math.max(cover._faceLine[0].y, cover._faceLine[1].y) + 12 + bias;
                    } else if (!coverV && eV) {
                        // 新墙 = 右臂（h），已有 = 左臂（v）→ 左盖右（已有左臂 +0.5）
                        e._faceDepth = Math.max(e._faceLine[0].y, e._faceLine[1].y) + 12 + bias;
                    }
                    return;
                }
            }
        }
    },

    _place(x, y) {
        const { item, mirror } = this._placing;
        if (!this._canPlace(x, y)) {
            this._notify('该位置无法放置', '#ff5555');
            return;
        }
        // 货币扣费：掩体/防御塔扣能源（世界-122 采集所得），陷阱扣金币。
        // 开发工具「无限资源」开启时建造不消耗能源/金币（2026-08-15）
        const free = !!(Game && Game._devInfiniteResources);
        const currency = item.currency === 'energy' ? 'energy' : 'gold';
        const payOk = free || (currency === 'energy'
            ? (EnergyManager && EnergyManager.deductEnergy(item.cost))
            : (GoldManager && GoldManager.deductGold(item.cost)));
        if (!payOk) {
            this._notify(currency === 'energy' ? '能源不足（攻击资源点采集）' : '金币不足', '#ff5555');
            return;
        }
        const id = `built_${item.id}_${++this._seq}`;
        if (item.kind === 'tower') {
            const tower = new DefenseTower(x, y, { id });
            tower._mirrored = mirror;
            Game.entities.set(id, tower);
            DefenseSystem.towers.push(tower);
        } else if (item.kind === 'hamster_hut') {
            const hut = new HamsterHut(x, y, { id });
            Game.entities.set(id, hut);
            HamsterHutSystem.huts.push(hut);
        } else if (item.kind === 'hamster_barracks') {
            const barracks = new HamsterBarracks(x, y, { id });
            Game.entities.set(id, barracks);
            HamsterBarracksSystem.barracks.push(barracks);
        } else if (item.kind === 'producer') {
            const producer = new ProducerBuilding(x, y, { id, cfgKey: item.id });
            Game.entities.set(id, producer);
            ProducerBuildingSystem.buildings.push(producer);
        } else if (item.kind === 'trap') {
            const trap = new DefenseTrap(x, y, {
                type: item.trapType,
                grade: item.grade,
                id,
            });
            Game.entities.set(id, trap);
        } else if (item.kind === 'gate') {
            const gate = new BuildableGate(x, y, {
                grade: item.grade,
                orient: item.orient,
                mirror,
                id,
            });
            Game.entities.set(id, gate);
            if (DefenseSystem && DefenseSystem.gates) DefenseSystem.gates.push(gate);
        } else if (item.kind === 'platform') {
            // 射击台（2026-08-16 七版）：自由放置高台——无墙线/法线/裁墙；
            // F 镜像只做视觉左右翻面（_facingLeft）
            const platform = new FiringPlatform(x, y, {
                mirror,
                id,
            });
            Game.entities.set(id, platform);
            if (DefenseSystem && DefenseSystem.platforms) DefenseSystem.platforms.push(platform);
        } else if (item.kind === 'gate4') {
            // 4 格门（2026-08-17）：2 石柱 + 2 格铁栅栏宽门
            const dir = (this._snapped && this._snapped.dir) || 'e2';
            this._placeGate4(x, y, dir);
        } else {
            const cover = new DefenseCover(x, y, {
                grade: item.grade,
                orient: item.orient,
                mirror,
                block: item.kind === 'block',
                id,
            });
            Game.entities.set(id, cover);
            if (item.kind !== 'block') {
                // 上夹角图层校正（2026-08-17）：手动摆放两堵墙在顶部交汇时，
                // 左臂（v 向 "/"、TL 边）盖右臂（h 向 "\"、TR 边）——左墙在右墙之上
                this._fixCoverCornerDepth(cover);
            }
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        const cur = item.currency === 'energy' ? '能' : '金';
        this._notify(
            free ? `${item.name} 已放置（无限资源）` : `${item.name} 已放置（-${item.cost} ${cur}）`,
            item.currency === 'energy' ? '#7fd4ff' : '#ffd700'
        );
        // 清除建造位置重叠的散布障碍物（仙人掌/树等，2026-08-17 用户口径）：
        // 下达指令建筑的地方有树木/草类障碍物，建造后直接删除
        const clearRadius = item.kind === 'platform' ? 140
            : (item.kind === 'hamster_hut' || item.kind === 'hamster_barracks' || item.kind === 'producer' ? 95
                : (item.kind === 'cover' || item.kind === 'gate' ? 110 : 60));
        // 4 格门已按四个格心批量清除；其它建筑按自身中心清除。
        if (item.kind !== 'gate4') this._clearBuildZones([{ x, y, radius: clearRadius }]);
        this._snapped = null;
        this._refreshCurrencies();
    },
};

// ==================== B 键全局监听（仅世界-122）====================

if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyB') return;
        if (!Game || !Game.isRunning || !Game.player) return;
        if (Game._wallEditMode || Game._collisionEditMode) return;
        if (!SceneManager || SceneManager.currentScene !== 'scene8') return;
        if (UIState && Object.values(UIState._state).some(Boolean)) return; // 其他面板打开时不抢键
        e.preventDefault();
        BuildingSystem.toggle();
    }, true);
}
