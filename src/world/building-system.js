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
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { SoundManager } from '../ui/sound-manager.js';
import { UIState } from '../ui/ui-state.js';
import { CONFIG } from '../config/config.js';
import { SceneManager } from './scene-manager.js';
import { DefenseSystem, DefenseTower, DefenseCover, DEFENSE_CONFIG, COVER_FACE, COVER_FOOT } from './defense-system.js';
import { DefenseTrap, TRAP_CONFIG, TRAP_GRADES, TRAP_SPACING, getTrapDef, DefenseTrapSystem } from './defense-trap-system.js';

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

/** 吸附触发距离（世界像素）：鼠标预览的墙端锚点与既有墙端锚点在此距离内即吸附 */
const SNAP_RADIUS = 60;
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
    { id: 'tower', name: '防御塔', cost: 300, tex: 'obstacle_defense_tower', kind: 'tower' },
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
    });
}
// 陷阱：4 类 × F~A 六档（数据源 TRAP_CONFIG，唯一真源）
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
        });
    }
}

// ==================== 建筑系统 ====================

export const BuildingSystem = {
    active: false,
    _placing: null,       // { item, mirror }
    _ghost: null,
    _snapped: null,        // 当前吸附到的放置坐标 { x, y, e }（无吸附为 null）
    _panel: null,
    _downFn: null,
    _moveFn: null,
    _keyFn: null,
    _seq: 0,

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
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 50, '建筑面板（B 关闭）', '#9acd9a'));
        }
    },

    close() {
        if (!this.active) return;
        this.active = false;
        Game._buildMode = false;
        this._cancelPlacement();
        if (this._downFn) window.removeEventListener('mousedown', this._downFn);
        if (this._moveFn) window.removeEventListener('mousemove', this._moveFn);
        if (this._keyFn) window.removeEventListener('keydown', this._keyFn, true);
        this._downFn = this._moveFn = this._keyFn = null;
        if (this._panel) {
            this._panel.remove();
            this._panel = null;
        }
    },

    // ==================== 面板 ====================

    _buildPanel() {
        if (this._panel) this._panel.remove();
        const el = document.createElement('div');
        el.className = 'wall-editor-panel';
        const gold = GoldManager ? GoldManager.getGold() : 0;
        el.innerHTML = `
            <div class="we-title">建筑面板（世界-122） <span class="we-close" id="bpClose">×</span></div>
            <div class="we-info" id="bpGold">金币：<b style="color:#ffd700;">${gold}</b>（点击建筑后到场景里放置）</div>
            <div class="we-grid we-std-scroll" id="bpGrid" style="max-height:52vh;overflow-y:auto;">
                ${BUILD_ITEMS.map((it) => `
                    <div class="we-thumb" data-id="${it.id}" title="${it.name} — ${it.cost} 金币">
                        <img src="assets/terrain/${it.tex}.png" draggable="false" alt="${it.name}">
                        <span>${it.name}<br><em style="color:#ffd700;font-style:normal;">${it.cost}金</em></span>
                    </div>`).join('')}
            </div>
            <div class="we-row">
                <button id="bpMirror" title="镜像翻转摆放方向（F）">镜像 F</button>
                <button id="bpCancel" title="取消放置（右键/Esc）">取消</button>
                <span class="we-selinfo" id="bpSel">未选择建筑</span>
            </div>
            <div class="we-hints">
                B=开/关面板 | 点击建筑后移动鼠标预览<br>
                左键放置（扣金币）| F=镜像（垂直↔水平）| 右键/Esc=取消<br>
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

    _refreshGold() {
        if (!this._panel) return;
        const el = this._panel.querySelector('#bpGold');
        if (el) {
            el.innerHTML = `金币：<b style="color:#ffd700;">${GoldManager ? GoldManager.getGold() : 0}</b>（点击建筑后到场景里放置）`;
        }
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
            } else if (item.kind === 'trap') {
                this._ghost.setDisplaySize(item.trapW || 72, item.trapH || 52);
            } else {
                this._ghost.setDisplaySize(260, Math.round(260 / (this._coverAspect(item) || 1)));
            }
        }
        const sel = this._panel && this._panel.querySelector('#bpSel');
        if (sel) sel.textContent = `${item.name}（${item.cost}金）— 左键放置 / F 镜像`;
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
            this._ghost.setPosition(snap.x, snap.y - this._ghostFootOffset());
            this._ghost.setTint(0x9dff9d); // 吸附成功：绿色提示
        } else {
            this._snapped = null;
            this._ghost.setPosition(p.x, p.y - this._ghostFootOffset());
            // 吸附落点被占用（如门洞另一侧门柱）时不显示吸附；
            // 当前位置本身不可放置则红色提示
            if (this._canPlace(p.x, p.y)) this._ghost.clearTint();
            else this._ghost.setTint(0xff7777);
        }
    },

    _ghostFootOffset() {
        if (!this._placing) return 0;
        return this._placing.item.kind === 'tower' ? 131 : (this._ghost.displayHeight / 2);
    },

    _onMouseDown(e) {
        if (e.button === 2) {
            // 右键取消放置
            this._cancelPlacement();
            return;
        }
        if (e.button !== 0 || !this._placing) return;
        const p = this._clientToWorld(e);
        if (!p || !p.overCanvas) return;
        // 落点 = 幽灵已确认可放的吸附位（_onMouseMove 已过滤 canPlace）；
        // 否则用鼠标原始位置。避免"吸附显示绿但点击落点被拒"（右边吸附放不下）
        const snapped = (this._snapped && this._canPlace(this._snapped.x, this._snapped.y))
            ? this._snapped : null;
        this._place(snapped ? snapped.x : p.x, snapped ? snapped.y : p.y);
    },

    _onKey(e) {
        if (!this._placing) return;
        if (e.code === 'KeyF') {
            e.preventDefault();
            this._toggleMirror();
        } else if (e.code === 'Escape') {
            e.preventDefault();
            this._cancelPlacement();
        }
    },

    // ==================== 摆放 ====================

    /**
     * 掩体端点吸附：找最近的一个既有掩体墙端锚点，把新件对应端贴上去。
     * 仅掩体参与吸附（防御塔不拼接）；同向（v-v / h-h）优先，跨向（v-h 转角）次之。
     * @returns {null|{x:number,y:number,e:object}}
     */
    _snapPosition(x, y) {
        const item = this._placing && this._placing.item;
        if (!item || item.kind !== 'cover') return null;
        const eff = effOrient(item, this._placing.mirror);
        const off = (COVER_SNAP[item.grade] && COVER_SNAP[item.grade][eff])
            || COVER_SNAP.D[eff] || COVER_SNAP.D.v;
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
            const eo = (COVER_SNAP[e.grade] && COVER_SNAP[e.grade][eEff])
                || COVER_SNAP.D[eEff] || COVER_SNAP.D.v;
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
        // 沿新件轴线向「既有件方向」回退 SNAP_OVERLAP：接缝只叠不缺。
        // 方向判定：既有件在新件轴线上的投影方向（dot>0 = 既有在 +axis 侧）。
        // 旧实现 dir 取反了——左外接时新件被推离 40px 产生大间隙（2026-08-05 用户反馈）
        const ax = off.R.x - off.L.x;
        const ay = off.R.y - off.L.y;
        const al = Math.hypot(ax, ay) || 1;
        const dot = (best.e.x - best.x) * ax + (best.e.y - best.y) * ay;
        const dir = dot >= 0 ? -1 : 1;
        best.x -= (ax / al) * SNAP_OVERLAP * dir;
        best.y -= (ay / al) * SNAP_OVERLAP * dir;
        return best;
    },

    /** 新掩体的墙段底边线段（face line，世界坐标）——按级别 + 有效朝向 */
    _coverSeg(x, y, grade, eff) {
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
        const radius = this._placing.item.kind === 'tower' ? 40 : (this._placing.item.kind === 'trap' ? TRAP_SPACING : 28);
        if (WallSystem && typeof WallSystem.canMoveTo === 'function' && !WallSystem.canMoveTo(x, y, radius)) return false;
        // 不与已建建筑重叠：掩体按「墙段真实 footprint（底边线段 + 墙厚）」判定——
        // 只检查底部碰撞体积，斜墙不再用轴对齐保守矩形（避免“该能放却红”）；
        // 两墙不能穿越/叠放，仅允许端点相接或吸附后 8px 接缝叠合
        if (this._placing.item.kind === 'cover') {
            const eff = effOrient(this._placing.item, this._placing.mirror);
            const foot = COVER_FOOT[eff] || COVER_FOOT[this._placing.item.orient] || COVER_FOOT.v;
            const thick = foot.thick ?? 26; // 墙厚一半，不是碰撞 rect 的 min（140 会成空气墙）
            const seg = this._coverSeg(x, y, this._placing.item.grade, eff);
            for (const e of Game.entities.values()) {
                if (!e || !e._isDefenseStructure || !e.active) continue;
                if (e._faceLine && e._faceLine.length === 2) {
                    // 已有掩体：线段 + 墙厚
                    const eThick = e._coverHalfThick ?? 26;
                    const minGap = (thick + eThick) / 2 - SNAP_OVERLAP;
                    const cp = this._segSegClosest(seg[0], seg[1], e._faceLine[0], e._faceLine[1]);
                    // 端点-端点接触（吸附拼接的 8px 叠合）允许；只有“端部插入
                    // 对方墙段中部/侧向侵入”才拒绝——平铺摆放判定只认底部碰撞体积
                    const endEnd = (cp.s <= 1e-4 || cp.s >= 1 - 1e-4)
                        && (cp.t <= 1e-4 || cp.t >= 1 - 1e-4);
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
        if (!GoldManager || !GoldManager.deductGold(item.cost)) {
            this._notify('金币不足', '#ff5555');
            return;
        }
        const id = `built_${item.id}_${++this._seq}`;
        if (item.kind === 'tower') {
            const tower = new DefenseTower(x, y, { id });
            tower._mirrored = mirror;
            Game.entities.set(id, tower);
            DefenseSystem.towers.push(tower);
        } else if (item.kind === 'trap') {
            const trap = new DefenseTrap(x, y, {
                type: item.trapType,
                grade: item.grade,
                id,
            });
            Game.entities.set(id, trap);
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
        this._notify(`${item.name} 已放置（-${item.cost} 金币）`, '#ffd700');
        this._snapped = null;
        this._refreshGold();
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
