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
    DEFENSE_CONFIG, COVER_FACE, COVER_FOOT, GATE_GEOM,
} from './defense-system.js';
import { DefenseTrap, TRAP_CONFIG, TRAP_GRADES, TRAP_SPACING, getTrapDef, DefenseTrapSystem } from './defense-trap-system.js';
import { HamsterHut, HamsterHutSystem, HAMSTER_CONFIG } from './hamster-hut-system.js';
import { HamsterBarracks, HamsterBarracksSystem, BARRACKS_CONFIG } from './hamster-barracks-system.js';

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

export const BUILD_ITEMS = [
    { id: 'tower', name: '防御塔', cost: 300, tex: 'obstacle_defense_tower', kind: 'tower', currency: 'energy' },
    { id: 'hamster_hut', name: '仓鼠小屋', cost: 1000, tex: 'hamster_hut', kind: 'hamster_hut', currency: 'energy' },
    { id: 'hamster_barracks', name: '仓鼠兵营', cost: 1500, tex: 'hamster_barracks', kind: 'hamster_barracks', currency: 'energy' },
    { id: 'firing_platform', name: '射击台', cost: 400, tex: 'firing_platform', kind: 'platform', currency: 'energy' },
];
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
    _snapped: null,        // 当前吸附到的放置坐标 { x, y, e }（无吸附为 null）
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
        this._keyFn = (e) => this._onKey(e);
        window.addEventListener('mousedown', this._downFn);
        window.addEventListener('mousemove', this._moveFn);
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
        if (this._keyFn) window.removeEventListener('keydown', this._keyFn, true);
        this._downFn = this._moveFn = this._keyFn = null;
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
                墙段只能端点拼接，不能重叠摆放
            </div>`;
        document.body.appendChild(el);
        this._panel = el;
        el.querySelector('#bpClose').addEventListener('click', () => this.close());
        el.querySelector('#bpMirror').addEventListener('click', () => this._toggleMirror());
        el.querySelector('#bpCancel').addEventListener('click', () => this._cancelPlacement());
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
            } else if (item.kind === 'trap') {
                this._ghost.setDisplaySize(item.trapW || 72, item.trapH || 52);
            } else if (item.kind === 'gate') {
                this._ghost.setDisplaySize(GATE_GEOM.cellW * GATE_GEOM.displayScale, GATE_GEOM.cellH * GATE_GEOM.displayScale);
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
        if (this._ghost) this._ghost.setFlipX(this._placing.mirror);
    },

    _cancelPlacement() {
        this._snapped = null;
        if (this._ghost) {
            this._ghost.destroy();
            this._ghost = null;
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
        const snap = this._snapPosition(p.x, p.y);
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
                if (this._placing.item.kind === 'platform') this._ghost.setTint(0x9dff9d);
                else this._ghost.clearTint();
            }
            else this._ghost.setTint(0xff7777);
        }
    },

    /** 幽灵锚点：与实体渲染完全一致（精灵中心 = 锚点 + offsetX/footOffsetY） */
    _ghostAnchor(x, y) {
        if (this._placing && this._placing.item.kind === 'platform') {
            // 射击台八版标定：offsetX=-25.6 / footOffsetY=49
            return { x: x - 25.6, y: y - 49 };
        }
        return { x, y: y - this._ghostFootOffset() };
    },

    _ghostFootOffset() {
        if (!this._placing) return 0;
        if (this._placing.item.kind === 'tower') return 131;
        if (this._placing.item.kind === 'hamster_hut') return HAMSTER_CONFIG.hut.footOffsetY;
        if (this._placing.item.kind === 'hamster_barracks') return BARRACKS_CONFIG.barracks.footOffsetY;
        if (this._placing.item.kind === 'platform') return 49; // 射击台 footOffsetY（八版标定）
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
        // 落点 = 幽灵已确认可放的吸附位（_onMouseMove 已过滤 canPlace）；
        // 否则用鼠标原始位置。避免"吸附显示绿但点击落点被拒"（右边吸附放不下）
        const snapped = (this._snapped && this._canPlace(this._snapped.x, this._snapped.y))
            ? this._snapped : null;
        this._place(snapped ? snapped.x : p.x, snapped ? snapped.y : p.y);
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
        if (item.kind === 'platform') return this._snapPlatformToWall(x, y);
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
                { x: e.x + eo.L.x, y: e.y + eo.L.y },
                { x: e.x + eo.R.x, y: e.y + eo.R.y },
            ];
            for (const ne of newEnds) {
                for (const ee of existingEnds) {
                    const d = Math.hypot(ne.x - ee.x, ne.y - ee.y);
                    if (d > SNAP_RADIUS) continue;
                    const nOff = ne.key === 'L' ? off.L : off.R;
                    const sx = ee.x - nOff.x;
                    const sy = ee.y - nOff.y;
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
        const radius = this._placing.item.kind === 'tower' || this._placing.item.kind === 'hamster_hut'
            ? 40
            : (this._placing.item.kind === 'trap' ? TRAP_SPACING : 28);
        if (WallSystem && typeof WallSystem.canMoveTo === 'function' && !WallSystem.canMoveTo(x, y, radius)) return false;
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
        if (this._placing.item.kind === 'cover' || this._placing.item.kind === 'gate') {
            const eff = effOrient(this._placing.item, this._placing.mirror);
            const thick = this._placing.item.kind === 'gate'
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
        } else {
            const cover = new DefenseCover(x, y, {
                grade: item.grade,
                orient: item.orient,
                mirror,
                id,
            });
            Game.entities.set(id, cover);
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        const cur = item.currency === 'energy' ? '能' : '金';
        this._notify(
            free ? `${item.name} 已放置（无限资源）` : `${item.name} 已放置（-${item.cost} ${cur}）`,
            item.currency === 'energy' ? '#7fd4ff' : '#ffd700'
        );
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
