/**
 * 多世界建筑面板（B 键开关，参考摆墙面板）。
 *
 * - 世界-122/123/124/125 共用；
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
import { BuildingSinkEffect } from '../effects/building-sink.js';
import { SoundManager } from '../ui/sound-manager.js';
import { UIState } from '../ui/ui-state.js';
import { renderBuildingDetailHeader } from '../ui/panels/building-detail-header.js';
import { mountRightSidebarPanel } from '../ui/right-sidebar-panel-layer.js';
import { TechnologyGate } from '../ui/technology-gate.js';
import { CONFIG } from '../config/config.js';
import { SceneManager } from './scene-manager.js';
import { Renderer } from './renderer.js';
import { World122TributeSystem } from './world122-tribute-system.js';
import {
    DefenseSystem, DefenseTower, DefenseCover, BuildableGate, WallStaircase,
    DEFENSE_CONFIG, COVER_FACE, COVER_FOOT, GATE_GEOM, GATE4_VISUAL,
    BLOCK_FACE, BLOCK_FOOT, BLOCK_FOOT_OFFSET, BLOCK_VISUAL,
    DEFENSE_TOWER_VISUAL, WALL_STAIR_VISUAL, WALL_STAIR_CONFIG,
    getWallStairVariant, wallStairAnchorOffset, collectConnectedWalkableWalls,
} from './defense-system.js';
import { HamsterHut, HamsterHutSystem, HAMSTER_CONFIG } from './hamster-hut-system.js';
import { HamsterBarracks, HamsterBarracksSystem, BARRACKS_CONFIG } from './hamster-barracks-system.js';
import { ProducerBuilding, ProducerBuildingSystem, PRODUCER_BUILDINGS } from './producer-building-system.js';
import { CrossPlaneResourceSystem } from './cross-plane-resource-system.js';
import {
    applyFittedBuildingFootprint,
    WALL_STAIR_FOOTPRINTS,
    ONE_CELL_BUILDING_FOOT,
    TWO_BY_TWO_BUILDING_FOOT,
} from './building-footprint.js';
import {
    BLOCK_GRID, blockCellOf, blockCellCenter, gate4AnchorForCell, gate4Cells,
    chooseGate4Snap, isGate4OccupancyValid,
} from './gate4-grid.js';
import {
    circleIntersectsIsoFootprint,
    isoFootprintsOverlap,
    isoFootprintVertices,
    pointInIsoFootprint,
} from '../physics/iso-footprint.js';
import { structureDepthAtY } from './structure-depth.js';
import { TechnologySystem } from './technology-system.js';
import {
    resolveConfiguredVisualFootprint,
    resolveStructureGroundFit,
} from './structure-visual-anchor.js';
import '../config/structure-ground-fit-config.js';
import {
    BuildingRoadSystem,
    BUILDING_FIELD_DISPLAY_HEIGHT,
    BUILDING_FIELD_DISPLAY_WIDTH,
    BUILDING_FIELD_TEXTURE,
    BUILDING_ROAD_DISPLAY_HEIGHT,
    BUILDING_ROAD_DISPLAY_WIDTH,
    BUILDING_ROAD_ICON,
    BUILDING_ROAD_TEXTURE,
    buildingRoadFrame,
    buildingRoadLayout,
} from './building-road-system.js';

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
/** 建造警戒半径：拟放置锚点附近存在敌对单位时禁止施工。 */
const BUILD_ENEMY_EXCLUSION_RADIUS = 200;
const BUILD_HOSTILE_FACTIONS = new Set(['enemy', 'agent']);
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

/** 除墙、门外的玩家可建造建筑统一占 2×2。 */
function isTwoByTwoBuildItem(item) {
    return !!item && ['tower', 'hamster_hut', 'hamster_barracks', 'producer'].includes(item.kind);
}

/** 防御塔与显式关闭外围地块的建筑只占标准 2x2，不预留或生成外围道路。 */
function usesBuildingRoads(item) {
    if (!isTwoByTwoBuildItem(item) || item.kind === 'tower') return false;
    return item.kind !== 'producer'
        || PRODUCER_BUILDINGS[item.id]?.perimeterTile !== 'none';
}

function buildingPerimeterKind(item) {
    if (item?.kind !== 'producer') return 'road';
    return PRODUCER_BUILDINGS[item.id]?.perimeterTile === 'field' ? 'field' : 'road';
}

function isWallStairBuildItem(item) {
    return !!item && item.kind === 'wall_staircase';
}

function wallStairDir(mirror) {
    return mirror ? 'e1' : 'e2';
}

const C_GRADE_WALL_COST = Math.round((DEFENSE_CONFIG.covers.hp.C ?? 1600) * 0.25);
const BLOCK_WALL_COST = 50;
const DEFAULT_WALL_STAIR_TEXTURE =
    WALL_STAIR_CONFIG.variants.e2_pos?.lower?.texture || 'wall_stair_lower_e2_pos';
const WALL_STAIR_PANEL_ICON =
    WALL_STAIR_CONFIG.variants.e1_pos?.lower?.texture || 'wall_stair_lower_e1_pos';

export const BUILD_ITEMS = [
    { id: 'tower', name: '防御塔', cost: 1000, tex: 'obstacle_defense_tower', thumbnailPath: 'assets/ui/building-thumbnails/tower.png', kind: 'tower', currency: 'energy' },
    // 1×1 方块墙沿用 C 级数值，但采用独立的单块造价；4 格门仍按 C 级墙造价。
    { id: 'cover_block', name: '方块墙', cost: BLOCK_WALL_COST, tex: 'obstacle_block', thumbnailPath: 'assets/ui/building-thumbnails/cover_block.png', kind: 'block', grade: 'C', orient: 'v', currency: 'energy' },
    {
        id: 'road',
        name: '道路',
        cost: 10,
        tex: BUILDING_ROAD_TEXTURE,
        icon: BUILDING_ROAD_ICON,
        thumbnailPath: 'assets/ui/building-thumbnails/road.png',
        kind: 'road',
        currency: 'energy',
    },
    { id: 'gate_4cell', name: '4格门', cost: C_GRADE_WALL_COST, tex: 'gate_4cell', icon: 'gate_4cell', thumbnailPath: 'assets/ui/building-thumbnails/gate_4cell.png', kind: 'gate4', grade: 'C', visualGrade: 'D', orient: 'v', currency: 'energy' },
    {
        id: HAMSTER_CONFIG.hut.id,
        name: HAMSTER_CONFIG.hut.name,
        cost: HAMSTER_CONFIG.hut.cost,
        tex: HAMSTER_CONFIG.hut.tex,
        thumbnailPath: `assets/ui/building-thumbnails/${HAMSTER_CONFIG.hut.id}.png`,
        kind: 'hamster_hut',
        economyType: HAMSTER_CONFIG.hut.economyType,
        currency: 'energy'
    },
    {
        id: 'hamster_barracks',
        name: BARRACKS_CONFIG.barracks.name,
        cost: BARRACKS_CONFIG.barracks.cost,
        tex: BARRACKS_CONFIG.barracks.tex,
        thumbnailPath: 'assets/ui/building-thumbnails/hamster_barracks.png',
        kind: 'hamster_barracks',
        currency: 'energy'
    },
    {
        id: WALL_STAIR_CONFIG.id,
        name: WALL_STAIR_CONFIG.name,
        cost: WALL_STAIR_CONFIG.costPerSegment * 2,
        costPerSegment: WALL_STAIR_CONFIG.costPerSegment,
        tex: DEFAULT_WALL_STAIR_TEXTURE,
        icon: WALL_STAIR_PANEL_ICON,
        thumbnailPath: 'assets/ui/building-thumbnails/wall_staircase.png',
        kind: 'wall_staircase',
        currency: 'energy',
    },
];
// 产兵建筑（配置驱动，data/producer-buildings.json 唯一真源——出兵时间/出品种类/造价
// 全部在配置里，后续替换建筑只改配置+贴图，不用动代码）
for (const pc of Object.values(PRODUCER_BUILDINGS || {})) {
    // 过滤配置表顶层的 _comment 等非建筑条目（否则生成 { id: undefined, name: undefined }
    // 的“undefined”建筑，2026-08-17 用户反馈建筑面板出现 undefined）
    // 世界核心传送门等配置驱动实体由位面生命周期自动生成，不进入玩家建造面板。
    if (!pc || typeof pc !== 'object' || !pc.id || pc.playerBuildable === false) continue;
    BUILD_ITEMS.push({
        id: pc.id,
        name: pc.name,
        cost: pc.cost,
        tex: pc.tex,
        assetPath: pc.assetPath,
        thumbnailPath: pc.thumbnailPath || pc.assetPath || `assets/ui/building-thumbnails/${pc.id}.png`,
        kind: 'producer',
        currency: pc.currency === 'gold' ? 'gold' : 'energy',
        buildWarning: pc.buildWarning || '',
    });
}
// 旧 F→A 长掩体与旧滑动门已从建筑清单移除；底层实体/资产保留兼容历史场景。
function isBuildItemTechnologyUnlocked(item) {
    if (!item) return false;
    return TechnologySystem.isUnlocked('building', item.id);
}

function renderBuildItemThumb(item, cost, lockedReason = '') {
    const currencyLabel = item.currency === 'energy' ? '能' : '金';
    const thumbnail = item.icon || item.tex;
    const blockedClass = lockedReason ? ' is-build-blocked' : '';
    return `
        <div class="we-thumb${blockedClass}" data-id="${item.id}" data-economy-locked="${lockedReason ? 'true' : 'false'}"
             aria-disabled="${lockedReason ? 'true' : 'false'}"
             title="${lockedReason || `${item.name} — ${cost} ${currencyLabel}`}"
             data-technology-gate-type="building"
             data-technology-gate-id="${item.id}"
             data-technology-gate-layout="collapse">
            <img src="${item.thumbnailPath || item.assetPath || `assets/terrain/${thumbnail}.png`}"
                 width="128" height="64" loading="lazy" decoding="async"
                 draggable="false" alt="${item.name}">
            <span>${item.name}<br><em data-build-cost style="color:${item.currency === 'energy' ? '#7fd4ff' : '#ffd700'};font-style:normal;">${cost}${currencyLabel}</em></span>
        </div>`;
}

// ==================== 建筑系统 ====================

export const BuildingSystem = {
    active: false,
    _placing: null,       // { item, mirror, groundFit? }
    _recycleMode: false,  // 建筑面板快捷回收：左键连续回收建筑/道路
    _detail: null,        // 建筑详情视图：当前查看的掩体实体（2026-08-15）
    _ghost: null,
    _guide: null,         // 产兵建筑对齐线（Phaser Graphics，2026-08-17）
    _snapEnabled: true,   // 产兵建筑自动吸附开关（G 键切换，2026-08-17）
    _snapInside: false,   // 墙段吸附位置：false=外部（端到端，默认）/ true=内部（端帽重叠，H 键切换，2026-08-17）
    _snapped: null,        // 当前吸附到的放置坐标 { x, y, e }（无吸附为 null）
    _wallDrag: null,       // 方块墙拖墙状态 { si, sj }（2026-08-17 帝国时代式拖墙）
    _rowPreview: [],       // 拖墙预览精灵（主幽灵之外的行内方块）
    _roadPreview: [],      // 2×2 建筑外围 12 格道路预览
    _roadPlacementStatus: null,
    _gatePreviewParts: null, // 4格门实际组件预览 { pillars:[Sprite], bars:Sprite }
    _gatePreviewHiddenBlocks: [], // 替换4连墙时临时隐藏的中间两块实际精灵
    _gate4Dir: null,       // 当前4格门方向（e1/e2）
    _gate4Hover: null,     // 最后一次场景鼠标世界坐标；F切换必须从原始坐标重算，不能用半格锚点
    _panel: null,
    _lastWarehouseAvailability: null,
    _lastBuildAvailabilitySignature: '',
    _detailPanel: null,
    _panelCloseTimer: null,
    _buildSortMode: 'unlock', // unlock=实际解锁顺序；energy=能源造价升序、金币建筑置后
    _downFn: null,
    _moveFn: null,
    _keyFn: null,
    _blurFn: null,
    _moveFrame: null,
    _moveGeneration: 0,
    _pendingPointerClient: null,
    _lastPointerClient: null,
    _seq: 0,
    _refreshTimer: null,

    toggle() {
        if (this.active) this.close();
        else this.open();
    },

    open() {
        if (this.active || !Game.isRunning) return;
        if (Game.RTSCommand && Game.RTSCommand.enabled) Game.RTSCommand.setEnabled(false);
        this.active = true;
        Game._buildMode = true;
        // 建筑主面板打开前清理所有独立建筑详情，避免旧面板残留在二级页之外。
        for (const panel of this._buildingDetailPanels()) {
            if (panel.isOpen && typeof panel.close === 'function') panel.close();
        }
        this._buildPanel();
        this._downFn = (e) => this._onMouseDown(e);
        this._moveFn = (e) => this._onMouseMove(e);
        this._upFn = (e) => this._onMouseUp(e);
        this._keyFn = (e) => this._onKey(e);
        this._blurFn = () => {
            this._cancelQueuedMouseMove();
            this._cancelDragPlacement();
        };
        window.addEventListener('mousedown', this._downFn, true);
        window.addEventListener('mousemove', this._moveFn);
        window.addEventListener('mouseup', this._upFn);
        window.addEventListener('keydown', this._keyFn, true);
        window.addEventListener('blur', this._blurFn);
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
        this._cancelPlacement({ destroyReusableVisuals: true });
        this._recycleMode = false;
        this._closeDetail();
        for (const panel of this._buildingDetailPanels()) {
            if (panel.isOpen && typeof panel.close === 'function') panel.close();
        }
        if (this._downFn) window.removeEventListener('mousedown', this._downFn, true);
        if (this._moveFn) window.removeEventListener('mousemove', this._moveFn);
        if (this._upFn) window.removeEventListener('mouseup', this._upFn);
        if (this._keyFn) window.removeEventListener('keydown', this._keyFn, true);
        if (this._blurFn) window.removeEventListener('blur', this._blurFn);
        this._downFn = this._moveFn = this._upFn = this._keyFn = this._blurFn = null;
        if (this._panel) {
            const closingPanel = this._panel;
            const closingDetailPanel = this._detailPanel;
            closingPanel.classList.remove('active');
            if (closingDetailPanel) closingDetailPanel.classList.remove('active');
            clearTimeout(this._panelCloseTimer);
            this._panelCloseTimer = setTimeout(() => {
                if (this._panel !== closingPanel) return;
                closingPanel.remove();
                if (closingDetailPanel) closingDetailPanel.remove();
                this._panel = null;
                if (this._detailPanel === closingDetailPanel) this._detailPanel = null;
                this._panelCloseTimer = null;
            }, 260);
        }
        document.querySelectorAll('.side-menu').forEach((menu) => menu.classList.remove('hidden'));
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

    _baseBuildCost(item) {
        if (!item) return 0;
        const cfg = item.kind === 'producer' ? PRODUCER_BUILDINGS[item.id] : null;
        if (Number.isFinite(Number(cfg?.firstWhenNoneCost))) {
            const hasAny = cfg.workshopType === 'warehouse'
                ? (EnergyManager?.getWarehouseCount?.() || 0) > 0
                : (ProducerBuildingSystem?.buildings || []).some((building) => (
                    building?.active !== false
                    && !building?._sinking
                    && building?.cfgKey === item.id
                ));
            if (!hasAny) return Math.max(0, Math.floor(Number(cfg.firstWhenNoneCost)));
        }
        return Math.max(0, Math.floor(Number(item.cost) || 0));
    },

    _effectiveBuildCost(item) {
        const base = this._baseBuildCost(item);
        const currency = item?.currency === 'energy' ? 'energy' : 'gold';
        return CrossPlaneResourceSystem.quote({ [currency]: base })[currency];
    },

    _buildItemResourceBlockReason(item, cost = this._effectiveBuildCost(item)) {
        if (Game?._devInfiniteResources || !(cost > 0)) return '';
        const currency = item?.currency === 'energy' ? 'energy' : 'gold';
        if (CrossPlaneResourceSystem.getAvailable(currency) >= cost) return '';
        const label = currency === 'energy' ? '能源' : '金币';
        return `${label}不足（需要 ${cost} ${label}）`;
    },

    _buildResourceAvailabilitySignature() {
        return BUILD_ITEMS.map((item) => {
            const cost = this._effectiveBuildCost(item);
            const blocked = !!this._buildItemResourceBlockReason(item, cost);
            return `${item.id}:${cost}:${blocked ? 0 : 1}`;
        }).join('|');
    },

    _economyWarehouseBlockReason(item) {
        const economyType = item?.kind === 'producer'
            ? PRODUCER_BUILDINGS[item.id]?.economyType
            : item?.economyType;
        return economyType && !EnergyManager?.hasWarehouse?.()
            ? '需要先在当前位面修建仓库'
            : '';
    },

    _featureBuildingBlockReason(item) {
        const cfg = item?.kind === 'producer' ? PRODUCER_BUILDINGS[item.id] : null;
        if (!cfg) return '';
        if (Array.isArray(cfg.allowedSceneIds) && !cfg.allowedSceneIds.includes(SceneManager.currentScene)) {
            const worldName = cfg.featureWorldId
                ? (SceneManager.scenes?.[cfg.featureWorldId]?.name || cfg.featureWorldId)
                : '对应位面';
            return `只能在${worldName}建造`;
        }
        const limit = Math.max(0, Math.floor(Number(cfg.buildLimit) || 0));
        if (limit > 0) {
            const count = (ProducerBuildingSystem?.buildings || []).filter((building) =>
                building?.active !== false && !building?._sinking && building?.cfgKey === item.id).length;
            if (count >= limit) return `${cfg.name}数量已达上限（${limit}）`;
        }
        return '';
    },

    _buildItemBlockReason(item) {
        return this._featureBuildingBlockReason(item)
            || this._economyWarehouseBlockReason(item);
    },

    _buildItemCardBlockReason(item, cost = this._effectiveBuildCost(item)) {
        return this._buildItemBlockReason(item)
            || this._buildItemResourceBlockReason(item, cost);
    },

    _buildItemGate(item) {
        return { type: 'building', id: item?.id };
    },

    _sortedBuildItems() {
        const originalOrder = new Map(BUILD_ITEMS.map((item, index) => [item.id, index]));
        return [...BUILD_ITEMS].sort((a, b) => {
            if (this._buildSortMode === 'energy') {
                const currencyA = a.currency === 'energy' ? 0 : 1;
                const currencyB = b.currency === 'energy' ? 0 : 1;
                if (currencyA !== currencyB) return currencyA - currencyB;
                if (currencyA === 0) {
                    const costDelta = this._effectiveBuildCost(a) - this._effectiveBuildCost(b);
                    if (costDelta !== 0) return costDelta;
                }
            } else {
                const gateA = this._buildItemGate(a);
                const gateB = this._buildItemGate(b);
                const orderA = TechnologySystem.getUnlockOrder(gateA.type, gateA.id);
                const orderB = TechnologySystem.getUnlockOrder(gateB.type, gateB.id);
                if (orderA !== orderB) return orderA - orderB;
            }
            return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
        });
    },

    _buildGridItemsHtml() {
        return this._sortedBuildItems()
            .map((item) => {
                const cost = this._effectiveBuildCost(item);
                return renderBuildItemThumb(item, cost, this._buildItemCardBlockReason(item, cost));
            })
            .join('');
    },

    _updateBuildSortButton() {
        const button = this._panel?.querySelector('#bpSortMode');
        if (!button) return;
        const byEnergy = this._buildSortMode === 'energy';
        button.textContent = byEnergy ? '排序：能源消耗' : '排序：解锁顺序';
        button.title = byEnergy
            ? '当前按能源造价从低到高排列，金币建筑置后；点击切换为实际解锁顺序'
            : '当前按实际解锁时间排列；点击切换为能源消耗顺序';
    },

    _renderBuildGrid() {
        const grid = this._panel?.querySelector('#bpGrid');
        if (!grid) return;
        const scrollTop = grid.scrollTop;
        grid.querySelectorAll('.we-thumb[data-id]').forEach((thumb) => TechnologyGate.unbind(thumb));
        grid.innerHTML = this._buildGridItemsHtml();
        TechnologyGate.bindTree(grid);
        grid.querySelectorAll('.we-thumb[data-id]').forEach((thumb) => this._bindBuildItemThumb(thumb));
        grid.scrollTop = scrollTop;
        this._lastBuildAvailabilitySignature = this._buildResourceAvailabilitySignature();
        this._updateBuildSortButton();
    },

    /**
     * 资源、跨位面倍率和场景建造条件变化只更新现有卡片状态。
     * 科技解锁或排序变化才重建网格，避免每 500ms 反复解码图片、解绑/重绑事件。
     */
    _syncBuildItemCards() {
        const grid = this._panel?.querySelector('#bpGrid');
        if (!grid) return;
        for (const thumb of grid.querySelectorAll('.we-thumb[data-id]')) {
            const item = BUILD_ITEMS.find((entry) => entry.id === thumb.dataset.id);
            if (!item) continue;
            const cost = this._effectiveBuildCost(item);
            const currencyLabel = item.currency === 'energy' ? '能' : '金';
            const blockReason = this._buildItemCardBlockReason(item, cost);
            const blocked = !!blockReason;
            thumb.dataset.economyLocked = blocked ? 'true' : 'false';
            thumb.classList.toggle('is-build-blocked', blocked);
            thumb.setAttribute('aria-disabled', blocked ? 'true' : 'false');
            thumb.title = blockReason || `${item.name} — ${cost} ${currencyLabel}`;
            const price = thumb.querySelector('[data-build-cost]');
            if (price) price.textContent = `${cost}${currencyLabel}`;
        }
        this._lastBuildAvailabilitySignature = this._buildResourceAvailabilitySignature();
    },

    _buildPanel() {
        clearTimeout(this._panelCloseTimer);
        this._panelCloseTimer = null;
        if (this._panel) this._panel.remove();
        if (this._detailPanel) this._detailPanel.remove();
        const el = document.createElement('div');
        // build-panel 专属类：右侧主栏目尺寸与响应式建筑网格，不影响摆墙编辑器共享样式。
        el.className = 'wall-editor-panel build-panel';
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const resourceContext = CrossPlaneResourceSystem.getContext();
        const energy = CrossPlaneResourceSystem.getAvailable('energy');
        const resourceLabel = resourceContext.remote ? '跨位面可用' : '本位面';
        el.innerHTML = `
            <div class="we-title"><span id="bpTitleText">建筑面板（${SceneManager.scenes?.[SceneManager.currentScene]?.name || '当前世界'}）</span> <span class="we-close" id="bpClose">×</span></div>
            <div class="we-hotkeys" id="bpHotkeys" style="font-size:12px;color:#ffd700;background:rgba(90,70,20,0.25);border:1px solid #6a5a2a;border-radius:4px;padding:4px 8px;margin-bottom:8px;">
                镜像翻转 <b>F</b>（<span id="bpMirrorState">关</span>）｜ 辅助吸附 <b>G</b>（<span id="bpSnapState">开</span>）｜ 墙吸附 <b>H</b>（<span id="bpWallSnap">外部</span>）
            </div>
            <div class="we-info" id="bpCur">
                金币：<b style="color:#ffd700;">${gold}</b>&nbsp;&nbsp;能源：<b style="color:#7fd4ff;">${energy}</b>（${resourceLabel}；点击建筑后到场景里放置）
            </div>
            <div class="we-row" id="bpSortRow" style="margin:6px 0;justify-content:flex-end;">
                <button id="bpSortMode" type="button" style="min-width:132px;">排序：解锁顺序</button>
            </div>
            <div class="we-grid we-std-scroll" id="bpGrid" style="max-height:62vh;overflow-y:auto;">
                ${this._buildGridItemsHtml()}
            </div>
            <div class="we-row" id="bpRow">
                <button id="bpMirror" title="镜像翻转摆放方向（F）">镜像 F</button>
                <button id="bpCancel" title="取消放置（右键/Esc）">取消</button>
                <span class="we-selinfo" id="bpSel">未选择建筑</span>
            </div>
            <div class="we-row" id="bpRecycleRow"
                 data-technology-gate-type="mechanic"
                 data-technology-gate-id="building_recycle"
                 style="margin-top:7px;">
                <button id="bpRecycleMode" title="进入回收模式后，左键点击建筑或道路进行回收" style="width:100%;background:#5a3028;color:#ffd7d0;border:1px solid #8a4a3a;">回收建筑</button>
            </div>
            <div class="we-hints" id="bpHints">
                <div class="build-context-warning" id="bpContextWarning" hidden></div>
                B=开/关面板 | 点击建筑后移动鼠标预览<br>
                左键放置（掩体/塔扣能源）| F=镜像（垂直↔水平）| 右键/Esc=取消<br>
                回收建筑=进入快捷回收，左键可连续回收建筑或道路<br>
                点击已建掩体查看详情（耐久/消耗）| Esc=返回/关闭<br>
                掩体靠近已有掩体端点自动吸附（变绿=已吸附）<br>
                墙段只能端点拼接，不能重叠摆放<br>
                H=切换墙段吸附位置（外部=端到端 / 内部=端帽重叠）<br>
                小屋/兵营/铁匠铺/草屋靠近已有同类建筑按地面 30° 地板线轴对齐（F=镜像，G=取消吸附）
            </div>`;
        TechnologyGate.bindTree(el);
        mountRightSidebarPanel(el, 'panel');
        this._panel = el;
        const detailPanel = document.createElement('div');
        detailPanel.className = 'build-structure-detail-panel';
        detailPanel.innerHTML = `
            <div class="building-detail-column-header">
                <span id="bpDetailTitle">建筑详情</span>
                <button id="bpDetailClose" type="button" aria-label="关闭建筑详情">×</button>
            </div>
            <div id="bpDetail" class="building-detail-column-body"></div>`;
        mountRightSidebarPanel(detailPanel, 'panel');
        this._detailPanel = detailPanel;
        detailPanel.querySelector('#bpDetailClose').addEventListener('click', () => this._closeDetail());
        document.querySelectorAll('.side-menu').forEach((menu) => menu.classList.add('hidden'));
        // 先提交收起态，再切 active，复用右侧主栏目同款滑入动画。
        void el.offsetWidth;
        el.classList.add('active');
        el.querySelector('#bpClose').addEventListener('click', () => this.close());
        el.querySelector('#bpMirror').addEventListener('click', () => this._toggleMirror());
        el.querySelector('#bpSortMode')?.addEventListener('click', () => {
            this._buildSortMode = this._buildSortMode === 'unlock' ? 'energy' : 'unlock';
            this._renderBuildGrid();
        });
        el.querySelector('#bpCancel').addEventListener('click', () => {
            this._cancelPlacement();
            this._setRecycleMode(false);
        });
        el.querySelector('#bpRecycleMode')?.addEventListener('click', () => {
            this._setRecycleMode(!this._recycleMode);
        });
        el.querySelector('#bpMirror').addEventListener('click', () => this._updateSnapHint());
        this._updateSnapHint();
        this._updateMirrorUi();
        this._updateBuildSortButton();
        el.querySelectorAll('.we-thumb').forEach((t) => {
            this._bindBuildItemThumb(t);
        });
        this._lastWarehouseAvailability = !!EnergyManager?.hasWarehouse?.();
        this._lastBuildAvailabilitySignature = this._buildResourceAvailabilitySignature();
    },

    _refreshCurrencies() {
        if (!this._panel) return;
        const hasWarehouse = !!EnergyManager?.hasWarehouse?.();
        const availabilitySignature = this._buildResourceAvailabilitySignature();
        if (this._lastWarehouseAvailability !== hasWarehouse
            || this._lastBuildAvailabilitySignature !== availabilitySignature) {
            this._lastWarehouseAvailability = hasWarehouse;
            this._syncBuildItemCards();
        }
        const el = this._panel.querySelector('#bpCur');
        if (el) {
            const context = CrossPlaneResourceSystem.getContext();
            const energy = CrossPlaneResourceSystem.getAvailable('energy');
            const label = context.remote ? `跨位面可用，当前额外消耗 ${Math.round((context.multiplier - 1) * 100)}%` : '本位面';
            el.innerHTML = `金币：<b style="color:#ffd700;">${GoldManager ? GoldManager.getGold() : 0}</b>&nbsp;&nbsp;能源：<b style="color:#7fd4ff;">${energy}</b>（${label}；点击建筑后到场景里放置）`;
        }
    },

    // 兼容旧调用名（面板货币显示统一走 _refreshCurrencies）
    _refreshGold() {
        this._refreshCurrencies();
    },

    refreshTechnologyUnlocks() {
        if (!this.active) return;
        const grid = this._panel?.querySelector('#bpGrid');
        if (!grid) return;

        // 读入较低科技进度的存档时才终止已经失去权限的操作；正常科技完成/解锁不触碰交互状态。
        if (this._placing && !isBuildItemTechnologyUnlocked(this._placing.item)) this._cancelPlacement();
        if (this._recycleMode && !TechnologySystem.isUnlocked('mechanic', 'building_recycle')) {
            this._setRecycleMode(false);
        }

        // 建筑栏明确采用折叠门禁：锁定卡不保留空位，解锁后按当前模式重新连续排序。
        this._renderBuildGrid();
    },

    _bindBuildItemThumb(thumb) {
        if (!thumb || thumb.dataset.buildItemBound === 'true') return;
        thumb.dataset.buildItemBound = 'true';
        thumb.addEventListener('click', () => {
            const item = BUILD_ITEMS.find((entry) => entry.id === thumb.dataset.id);
            if (item) this._selectItem(item);
        });
    },

    _selectItem(item) {
        if (!isBuildItemTechnologyUnlocked(item)) {
            this._notify('该建筑尚未通过科技解锁', '#ffb35c');
            return;
        }
        const buildBlock = this._buildItemCardBlockReason(item);
        if (buildBlock) {
            this._notify(buildBlock, '#ffb35c');
            this._syncBuildItemCards();
            return;
        }
        this._setRecycleMode(false);
        this._cancelPlacement();
        this._placing = { item, mirror: false };
        // 兼容修复前已经建成但未触发拓扑失效的方块墙：点选楼梯时只刷新一次，
        // 随后的鼠标移动继续复用缓存，不产生逐帧重建开销。
        if (isWallStairBuildItem(item)) DefenseSystem?.invalidateElevatedTopology?.();
        const scene = window.__phaserScene;
        if (this._ghost && (!this._ghost.active || this._ghost.scene !== scene)) {
            if (this._ghost.active) this._ghost.destroy();
            this._ghost = null;
        }
        if (this._guide && (!this._guide.active || this._guide.scene !== scene)) {
            if (this._guide.active) this._guide.destroy();
            this._guide = null;
        }
        if (scene && !this._ghost) {
            this._ghost = scene.add.sprite(0, 0, item.tex);
        }
        this._syncBuildItemCards();
        // 产兵建筑对齐线（2026-08-17）：吸附时画水平/垂直参考线
        if (scene && !this._guide) {
            this._guide = scene.add.graphics();
        }
        if (this._ghost) {
            this._ghost.stop?.();
            this._ghost.setCrop?.();
            this._ghost.setTexture(item.tex);
            this._ghost.setOrigin(0.5, 0.5);
            this._ghost.setPosition(0, 0);
            this._ghost.setRotation(0);
            this._ghost.setAlpha(0.55);
            this._ghost.setDepth(999998);
            this._ghost.setVisible(true);
            this._ghost.setFlip(false, false);
            this._ghost.clearTint();
            // 显示尺寸 = 实体显示尺寸（普通建筑已统一放大到 2×2 视觉尺度）
            if (item.kind === 'tower') {
                this._ghost.setDisplaySize(DEFENSE_TOWER_VISUAL.base.w, DEFENSE_TOWER_VISUAL.base.h);
            } else if (item.kind === 'hamster_hut') {
                this._ghost.setDisplaySize(HAMSTER_CONFIG.hut.displayW, HAMSTER_CONFIG.hut.displayH);
            } else if (item.kind === 'hamster_barracks') {
                this._ghost.setDisplaySize(BARRACKS_CONFIG.barracks.displayW, BARRACKS_CONFIG.barracks.displayH);
            } else if (item.kind === 'producer') {
                const pc = PRODUCER_BUILDINGS[item.id];
                this._ghost.setDisplaySize(pc.displayW, pc.displayH);
            } else if (item.kind === 'road') {
                this._ghost.setDisplaySize(BUILDING_ROAD_DISPLAY_WIDTH, BUILDING_ROAD_DISPLAY_HEIGHT);
            } else if (item.kind === 'gate') {
                this._ghost.setDisplaySize(GATE_GEOM.cellW * GATE_GEOM.displayScale, GATE_GEOM.cellH * GATE_GEOM.displayScale);
            } else if (item.kind === 'gate4') {
                // 4 格门不用近似合成图：预览由两块真实方块墙 + 实际栅栏帧组成
                this._ghost.setVisible(false);
                this._createGate4Preview(scene, item.visualGrade || item.grade);
            } else if (item.kind === 'wall_staircase') {
                this._ghost.setDisplaySize(WALL_STAIR_VISUAL.w, WALL_STAIR_VISUAL.h);
            } else if (item.kind === 'block') {
                this._ghost.setDisplaySize(BLOCK_VISUAL.w, BLOCK_VISUAL.h);
            } else {
                this._ghost.setDisplaySize(260, Math.round(260 / (this._coverAspect(item) || 1)));
            }
            if (['hamster_hut', 'hamster_barracks', 'producer'].includes(item.kind)) {
                const fit = this._ghostGroundFit();
                if (fit?.prismConstrained && fit.displayWidth > 0 && fit.displayHeight > 0) {
                    this._ghost.setDisplaySize(fit.displayWidth, fit.displayHeight);
                }
            }
        }
        this._updateMirrorUi();
        if (usesBuildingRoads(item)) this._ensureRoadPreview(scene, buildingPerimeterKind(item));
        else this._clearRoadPreview();
        const sel = this._panel && this._panel.querySelector('#bpSel');
        if (sel) {
            const action = item.kind === 'road' ? '单击或拖动铺设' : '左键放置 / F 镜像';
            sel.textContent = `${item.name}（${this._effectiveBuildCost(item)}${item.currency === 'energy' ? '能' : '金'}）— ${action}`;
        }
        if (this._guide) {
            this._guide.clear();
            this._guide.setDepth(999997);
            this._guide.setVisible(false);
        }
        const warning = this._panel?.querySelector('#bpContextWarning');
        if (warning) {
            warning.textContent = item.buildWarning || '';
            warning.hidden = !item.buildWarning;
        }
    },

    _coverAspect(item) {
        // 掩体显示宽高比（与 DefenseCover 同源：COVER_ASPECT 表）
        const table = { F: { h: 1.004, v: 1.004 }, E: { h: 1.004, v: 1.004 }, D: { h: 1.004, v: 1.004 }, C: { h: 1.004, v: 1.004 }, B: { h: 1.004, v: 1.004 }, A: { h: 1.004, v: 1.004 } };
        return (table[item.grade] && table[item.grade][item.orient]) || 1;
    },

    _toggleMirror() {
        if (!this._placing) return;
        this._flushQueuedMouseMove();
        const previousVisualOffsetX = this._ghostVisualOffsetX();
        this._placing.mirror = !this._placing.mirror;
        if (this._placing.item.kind === 'gate4') {
            const hover = this._gate4Hover;
            const next = hover ? this._snapGate4Grid(hover.x, hover.y) : null;
            if (next) {
                const ok = !!next.valid && this._canPlaceGate4(next.x, next.y, next.dir);
                this._snapped = ok ? next : null;
                if (!ok) this._restoreGate4HiddenBlocks();
                this._updateGate4Preview(next.x, next.y, next.dir);
            } else {
                this._snapped = null;
                this._restoreGate4HiddenBlocks();
                this._setGate4PreviewVisible(false);
            }
        } else if (isWallStairBuildItem(this._placing.item)) {
            const hover = this._wallStairHover;
            const next = hover ? this._snapWallStairGrid(hover.x, hover.y) : null;
            const ok = !!next && this._canPlaceWallStairFootprint(next.x, next.y, next);
            this._snapped = ok ? next : null;
            this._updateStairPreview(next, ok);
        } else if (this._ghost) {
            this._ghost.setFlipX(this._placing.mirror);
            // alpha 底座中心可能不在贴图正中；镜像后视觉偏移也要反号，
            // 保证幽灵底座仍对齐同一个逻辑 footprint。
            const nextVisualOffsetX = this._ghostVisualOffsetX();
            this._ghost.x += nextVisualOffsetX - previousVisualOffsetX;
            this._updateGuide(this._snapped, this._placing.item, this._ghost.x, this._ghost.y);
        }
        this._updateMirrorUi();
        this._refreshPlacementPreviewAtLastPointer();
    },

    _updateMirrorUi() {
        if (!this._panel) return;
        const enabled = !!this._placing?.mirror;
        const available = !!this._placing;
        const state = this._panel.querySelector('#bpMirrorState');
        if (state) {
            state.textContent = enabled ? '开' : '关';
            state.style.color = enabled ? '#9dff9d' : '#ffd700';
        }
        const button = this._panel.querySelector('#bpMirror');
        if (button) {
            button.disabled = !available;
            button.textContent = enabled ? '镜像 F：开' : '镜像 F：关';
            button.style.color = enabled ? '#9dff9d' : '';
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
            const eFoot = e._visualFootOffsetY ?? e.footOffsetY ?? 0;
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
        if (!snap || snap.grid || !isProducerKind(item) || !this._snapEnabled) {
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
        this._flushQueuedMouseMove();
        this._snapEnabled = !this._snapEnabled;
        this._snapped = null; // 切换后清残留吸附位，避免鼠标不动时点落旧吸附点
        this._clearStairPreview();
        if (!this._snapEnabled && this._guide) {
            this._guide.setVisible(false);
        }
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(
                Game.player.x, Game.player.y - 50,
                `辅助吸附：${this._snapEnabled ? '开' : '关'}`,
                this._snapEnabled ? '#9dff9d' : '#ff8855'
            ));
        }
        // 城墙楼梯属于“必须贴墙”的结构，不受普通建筑辅助吸附开关影响。
        // 切换 G 后立即从最后鼠标位置恢复合法候选，避免预览消失到下一次移动鼠标。
        if (isWallStairBuildItem(this._placing?.item) && this._wallStairHover) {
            const next = this._snapWallStairGrid(this._wallStairHover.x, this._wallStairHover.y);
            const ok = !!next && this._canPlaceWallStairFootprint(next.x, next.y, next);
            this._snapped = ok ? next : null;
            this._updateStairPreview(next, ok);
        }
        this._updateSnapHint();
        this._refreshPlacementPreviewAtLastPointer();
    },

    /** H 键：切换墙段吸附位置——外部（端到端）↔ 内部（端帽重叠）（2026-08-17） */
    _toggleSnapInside() {
        this._flushQueuedMouseMove();
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
        this._refreshPlacementPreviewAtLastPointer();
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

    _cancelPlacement({ destroyReusableVisuals = false } = {}) {
        this._cancelQueuedMouseMove();
        this._snapped = null;
        this._wallDrag = null;
        this._wallRow = [];
        this._gate4Dir = null;
        this._gate4Hover = null;
        this._wallStairHover = null;
        this._clearWallPreview();
        this._clearStairPreview();
        this._destroyGate4Preview();
        this._clearRoadPreview(destroyReusableVisuals);
        this._roadPlacementStatus = null;
        if (this._ghost) {
            if (destroyReusableVisuals || !this._ghost.active) {
                if (this._ghost.active) this._ghost.destroy();
                this._ghost = null;
            } else {
                this._ghost.stop?.();
                this._ghost.setCrop?.();
                this._ghost.clearTint();
                this._ghost.setFlip(false, false);
                this._ghost.setVisible(false);
            }
        }
        if (this._guide) {
            if (destroyReusableVisuals || !this._guide.active) {
                if (this._guide.active) this._guide.destroy();
                this._guide = null;
            } else {
                this._guide.clear();
                this._guide.setVisible(false);
            }
        }
        if (destroyReusableVisuals) this._lastPointerClient = null;
        this._placing = null;
        this._updateMirrorUi();
        const sel = this._panel && this._panel.querySelector('#bpSel');
        if (sel) sel.textContent = '未选择建筑';
        const warning = this._panel?.querySelector('#bpContextWarning');
        if (warning) {
            warning.textContent = '';
            warning.hidden = true;
        }
    },

    _setRecycleMode(enabled) {
        const next = !!enabled;
        if (next && !TechnologySystem.isUnlocked('mechanic', 'building_recycle')) {
            this._notify('需要先研发工程制图', '#ffb35c');
            return false;
        }
        if (next) {
            this._cancelPlacement();
            if (this._detail) this._closeDetail();
        }
        this._recycleMode = next;
        const button = this._panel && this._panel.querySelector('#bpRecycleMode');
        if (button) {
            button.textContent = next ? '退出回收' : '回收建筑';
            button.style.background = next ? '#8a3f32' : '#5a3028';
            button.style.color = next ? '#fff2a8' : '#ffd7d0';
            button.style.boxShadow = next ? '0 0 0 2px rgba(255,215,0,0.35) inset' : 'none';
        }
        const sel = this._panel && this._panel.querySelector('#bpSel');
        if (sel) {
            sel.textContent = next
                ? '回收模式：左键回收建筑/道路，右键或 Esc 退出'
                : (this._placing ? sel.textContent : '未选择建筑');
        }
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

    _cancelQueuedMouseMove() {
        this._moveGeneration++;
        if (this._moveFrame !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(this._moveFrame);
        }
        this._moveFrame = null;
        this._pendingPointerClient = null;
    },

    _onMouseMove(e) {
        if (!this._placing || !this._ghost) return;
        const pointer = { clientX: e.clientX, clientY: e.clientY };
        this._lastPointerClient = pointer;
        this._pendingPointerClient = pointer;
        if (this._moveFrame !== null) return;
        const generation = this._moveGeneration;
        const frameHandle = window.requestAnimationFrame(() => {
            if (generation !== this._moveGeneration || this._moveFrame !== frameHandle) return;
            this._moveFrame = null;
            const latest = this._pendingPointerClient;
            this._pendingPointerClient = null;
            if (latest) this._applyMouseMove(latest);
        });
        this._moveFrame = frameHandle;
    },

    /** 点击/松开前同步冲刷最后坐标，避免 rAF 尚未执行时沿用旧吸附点或旧拖墙行。 */
    _flushQueuedMouseMove(pointer = null) {
        if (pointer && Number.isFinite(pointer.clientX) && Number.isFinite(pointer.clientY)) {
            const latest = { clientX: pointer.clientX, clientY: pointer.clientY };
            this._lastPointerClient = latest;
            this._pendingPointerClient = latest;
        }
        const latest = this._pendingPointerClient;
        this._cancelQueuedMouseMove();
        if (latest && this._placing && this._ghost) this._applyMouseMove(latest);
    },

    _refreshPlacementPreviewAtLastPointer() {
        if (this._lastPointerClient && this._placing && this._ghost) {
            this._applyMouseMove(this._lastPointerClient);
        }
    },

    _applyMouseMove(e) {
        if (!this._placing || !this._ghost) return;
        const p = this._clientToWorld(e);
        if (!p || !p.overCanvas) return;
        // 拖墙中：预览一行方块（不吸附单个格）
        if (this._wallDrag) {
            this._updateWallPreview(p.x, p.y);
            return;
        }
        const item = this._placing.item;
        if (item.kind === 'gate4') this._gate4Hover = { x: p.x, y: p.y };
        if (item.kind === 'wall_staircase') this._wallStairHover = { x: p.x, y: p.y };
        const snap = this._snapPosition(p.x, p.y);
        // 4 格门：幽灵用门图标，按方向翻转（F 镜像换 e1/e2）
        if (item.kind === 'gate4') {
            if (snap) {
                const ok = !!snap.valid && this._canPlaceGate4(snap.x, snap.y, snap.dir);
                this._snapped = ok ? snap : null;
                if (!ok) this._restoreGate4HiddenBlocks();
                this._updateGate4Preview(snap.x, snap.y, snap.dir);
            } else {
                this._snapped = null;
                this._restoreGate4HiddenBlocks();
                this._setGate4PreviewVisible(false);
            }
            return;
        }
        if (isWallStairBuildItem(item)) {
            const ok = !!snap && this._canPlaceWallStairFootprint(snap.x, snap.y, snap);
            this._snapped = ok ? snap : null;
            this._updateStairPreview(snap, ok);
            return;
        }
        if (isTwoByTwoBuildItem(item) && snap) {
            const ok = this._canPlace(snap.x, snap.y);
            this._snapped = snap;
            const sp = this._ghostAnchor(snap.x, snap.y);
            this._ghost.setPosition(sp.x, sp.y);
            this._ghost.setTint(ok ? 0x9dff9d : 0xff7777);
            if (usesBuildingRoads(item)) {
                this._updateRoadPreview(snap.x, snap.y, this._roadPlacementStatus, ok);
            }
            this._updateGuide(snap, item, this._ghost.x, this._ghost.y);
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
                // 楼梯候选可建造时给绿色反馈。
                if (item.kind === 'wall_staircase') this._ghost.setTint(0x9dff9d);
                else this._ghost.clearTint();
            }
            else this._ghost.setTint(0xff7777);
        }
        this._updateGuide(snap, item, this._ghost.x, this._ghost.y);
    },

    /** 幽灵锚点：与实体渲染完全一致（精灵中心 = 锚点 + offsetX/footOffsetY） */
    _ghostAnchor(x, y) {
        if (this._placing && this._placing.item.kind === 'tower') {
            return {
                x,
                y: y + DEFENSE_TOWER_VISUAL.base.footprintCenterOffsetY
                    - DEFENSE_TOWER_VISUAL.base.footOffsetY,
            };
        }
        if (this._placing && this._placing.item.kind === 'wall_staircase') {
            return {
                x: x + (this._placing.mirror ? -WALL_STAIR_VISUAL.offsetX : WALL_STAIR_VISUAL.offsetX),
                y: y - WALL_STAIR_VISUAL.footOffsetY,
            };
        }
        if (this._placing && this._placing.item.kind === 'gate4') {
            return { x, y }; // 4 格门锚点 = 栅栏中点，幽灵直接居中
        }
        return { x: x + this._ghostVisualOffsetX(), y: y - this._ghostFootOffset() };
    },

    _ghostVisualOffsetX() {
        const fit = this._ghostGroundFit();
        const fitOffsetX = fit?.visualOffsetX || 0;
        const producerCfg = this._placing?.item.kind === 'producer'
            ? PRODUCER_BUILDINGS[this._placing.item.id]
            : null;
        const offsetX = fitOffsetX
            + (fit?.prismConstrained ? 0 : (Number(producerCfg?.anchorAdjustX) || 0));
        return this._placing?.mirror ? -offsetX : offsetX;
    },

    _ghostGroundFit() {
        if (!this._placing) return null;
        if (!['hamster_hut', 'hamster_barracks', 'producer'].includes(this._placing.item.kind)) return null;
        if (this._placing.groundFit) return this._placing.groundFit;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !this._ghost?.texture?.key) return null;
        const producerCfg = this._placing.item.kind === 'producer'
            ? PRODUCER_BUILDINGS[this._placing.item.id]
            : null;
        const structureCfg = producerCfg || (
            this._placing.item.kind === 'hamster_hut'
                ? HAMSTER_CONFIG.hut
                : (this._placing.item.kind === 'hamster_barracks'
                    ? BARRACKS_CONFIG.barracks : null)
        );
        const visualFootprint = resolveConfiguredVisualFootprint(
            structureCfg,
            TWO_BY_TWO_BUILDING_FOOT.w,
            TWO_BY_TWO_BUILDING_FOOT.d
        );
        // 建造幽灵与落地实体使用同一“prism-body”接地中心拟合口径；
        // 建筑底部铺装由道路预览/BuildingRoadSystem 独立维护。
        const fit = resolveStructureGroundFit(
            scene,
            this._ghost.texture.key,
            this._ghost.frame?.name,
            this._ghost.displayWidth,
            this._ghost.displayHeight,
            {
                nominalWidth: TWO_BY_TWO_BUILDING_FOOT.w,
                nominalHeight: TWO_BY_TWO_BUILDING_FOOT.d,
                constrainToPrism: structureCfg?.autoFootprint !== true,
                centerAdjustX: structureCfg?.autoFootprint === true
                    ? 0 : (Number(structureCfg?.anchorAdjustX) || 0),
                centerAdjustY: structureCfg?.autoFootprint === true
                    ? 0 : (Number(structureCfg?.anchorAdjustY) || 0),
                visualFootprint,
            }
        );
        if (fit) this._placing.groundFit = fit;
        return fit;
    },

    _ghostFootOffset() {
        if (!this._placing) return 0;
        if (this._placing.item.kind === 'tower') return DEFENSE_TOWER_VISUAL.base.footOffsetY;
        const fit = this._ghostGroundFit();
        if (fit) {
            const producerCfg = this._placing.item.kind === 'producer'
                ? PRODUCER_BUILDINGS[this._placing.item.id]
                : null;
            return fit.footOffsetY
                + (fit.prismConstrained ? 0 : (Number(producerCfg?.anchorAdjustY) || 0));
        }
        if (this._placing.item.kind === 'hamster_hut') return HAMSTER_CONFIG.hut.footOffsetY;
        if (this._placing.item.kind === 'hamster_barracks') return BARRACKS_CONFIG.barracks.footOffsetY;
        if (this._placing.item.kind === 'producer') {
            const pc = PRODUCER_BUILDINGS[this._placing.item.id];
            return pc.footOffsetY;
        }
        if (this._placing.item.kind === 'wall_staircase') return WALL_STAIR_VISUAL.footOffsetY;
        if (this._placing.item.kind === 'block') return BLOCK_FOOT_OFFSET; // 方块墙：61（与实体一致）
        if (this._placing.item.kind === 'road') return 0;
        return this._ghost.displayHeight / 2;
    },

    _ensureRoadPreview(scene = null, kind = buildingPerimeterKind(this._placing?.item)) {
        const targetScene = scene || (
            typeof window !== 'undefined' ? window.__phaserScene : null
        );
        if (!targetScene?.add?.sprite) return;
        const reusable = this._roadPreview.length === 12
            && this._roadPreview.every((sprite) => sprite?.active && sprite.scene === targetScene);
        if (reusable && this._roadPreview.every((sprite) => sprite._perimeterKind === kind)) return;
        if (!reusable) {
            this._clearRoadPreview(true);
            for (let index = 0; index < 12; index++) {
                this._roadPreview.push(targetScene.add.sprite(0, 0, BUILDING_ROAD_TEXTURE, index % 4));
            }
        }
        const texture = kind === 'field' ? BUILDING_FIELD_TEXTURE : BUILDING_ROAD_TEXTURE;
        const displayWidth = kind === 'field'
            ? BUILDING_FIELD_DISPLAY_WIDTH
            : BUILDING_ROAD_DISPLAY_WIDTH;
        const displayHeight = kind === 'field'
            ? BUILDING_FIELD_DISPLAY_HEIGHT
            : BUILDING_ROAD_DISPLAY_HEIGHT;
        for (let index = 0; index < this._roadPreview.length; index++) {
            const sprite = this._roadPreview[index];
            sprite.stop?.();
            sprite.setCrop?.();
            sprite.setTexture(texture, index % 4);
            sprite._perimeterKind = kind;
            sprite.setOrigin(0.5, 0.5);
            sprite.setDisplaySize(displayWidth, displayHeight);
            sprite.setPosition(0, 0);
            sprite.setRotation(0);
            sprite.setFlip(false, false);
            sprite.setDepth(999996);
            sprite.setAlpha(0.62);
            sprite.clearTint();
            sprite.setVisible(false);
        }
    },

    _clearRoadPreview(destroy = false) {
        for (const sprite of this._roadPreview) {
            if (!sprite?.active) continue;
            if (destroy) sprite.destroy();
            else {
                sprite.clearTint();
                sprite.setVisible(false);
            }
        }
        if (destroy) this._roadPreview = [];
    },

    _updateRoadPreview(x, y, status, fallbackOk = false) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const kind = buildingPerimeterKind(this._placing?.item);
        this._ensureRoadPreview(scene, kind);
        const layout = status?.layout || buildingRoadLayout(x, y);
        const validByKey = status?.validByKey || new Map();
        for (let index = 0; index < this._roadPreview.length; index++) {
            const sprite = this._roadPreview[index];
            const cell = layout.roadCells[index];
            if (!sprite || !cell) {
                if (sprite) sprite.setVisible(false);
                continue;
            }
            const valid = validByKey.has(cell.key) ? validByKey.get(cell.key) : fallbackOk;
            sprite.setFrame(cell.frame);
            sprite.setPosition(cell.x, cell.y);
            sprite.setTint(valid ? 0x9dff9d : 0xff5555);
            sprite.setVisible(true);
        }
    },

    _buildingDetailPanels() {
        return [
            DefenseSystem?._panel,
            HamsterHutSystem?._panel,
            HamsterBarracksSystem?._panel,
            ProducerBuildingSystem?._panel,
            World122TributeSystem?._panel,
        ].filter(Boolean);
    },

    /** 关闭主建筑面板及其全部详情视图，并清理正在摆放的预览。 */
    _closeAllBuildingPanels() {
        let closed = false;
        if (this._detail) {
            this._closeDetail();
            closed = true;
        }
        for (const panel of this._buildingDetailPanels()) {
            if (panel.isOpen && typeof panel.close === 'function') {
                panel.close();
                closed = true;
            }
        }
        if (this.active) {
            this.close();
            closed = true;
        }
        return closed;
    },

    /** 面板外左右键关闭主建筑面板及所有建筑详情；面板内部点击保留正常交互。 */
    _closeBuildingPanelsFromOutside(e) {
        if (!e || (e.button !== 0 && e.button !== 2)) return false;
        // 已选择待建建筑时，鼠标交给后续放置流程：左键放置，右键只取消当前选择。
        if (this._placing || this._recycleMode) return false;
        const detailPanels = this._buildingDetailPanels();
        const target = e.target;
        const insideMain = !!(this._panel && target && this._panel.contains(target));
        const insideStructureDetail = !!(this._detailPanel && target && this._detailPanel.contains(target));
        const insideDetail = detailPanels.some((panel) => panel.el && target && panel.el.contains(target));
        if (insideMain || insideStructureDetail || insideDetail) return false;
        return this._closeAllBuildingPanels();
    },

    /** 空白场景点击关闭主建筑面板；点击建筑本体时保留面板，让详情交互继续分发。 */
    _eventHitsBuilding(e) {
        const p = this._clientToWorld(e);
        if (!p || !p.overCanvas) return false;
        if (this._hitTestCover(p.x, p.y)) return true;
        for (const entity of Game.entities.values()) {
            if (!entity || !entity.active || !entity._isDefenseStructure) continue;
            if (entity._isWallStaircase && Array.isArray(entity.visualSegments)) {
                if (entity.visualSegments.some((visual) =>
                    Math.abs(p.x - visual.x) <= visual.displayWidth * 0.5
                    && Math.abs(p.y - visual.y) <= visual.displayHeight * 0.5
                )) return true;
            }
            if (entity.collisionShape === 'iso_rect' && pointInIsoFootprint(p.x, p.y, entity, 16)) {
                return true;
            }
            const spr = entity.spriteCfg;
            if (spr) {
                const fallbackOffsetX = entity._facingLeft
                    ? -(spr.offsetX || 0)
                    : (spr.offsetX || 0);
                const cx = entity.x + (entity._visualFootOffsetX ?? fallbackOffsetX);
                const cy = entity.y - (entity._visualFootOffsetY ?? spr.footOffsetY ?? 0);
                const hw = (spr.size || entity.size || 32) / 2;
                const hh = (spr.sizeH || spr.size || entity.size || 32) / 2;
                if (Math.abs(p.x - cx) <= hw && Math.abs(p.y - cy) <= hh) return true;
            }
        }
        return false;
    },

    _onMouseDown(e) {
        if (this._closeBuildingPanelsFromOutside(e)) return;
        if (e.button === 2) {
            // 右键取消放置或退出快捷回收，保留建筑面板。
            this._cancelPlacement();
            this._setRecycleMode(false);
            return;
        }
        if (e.button !== 0) return;
        // 点击落在面板自身 DOM 上不穿透到场景
        if (this._panel && e.target && this._panel.contains(e.target)) return;
        if (this._recycleMode) {
            const p = this._clientToWorld(e);
            if (!p || !p.overCanvas) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            this._recycleAt(p.x, p.y);
            return;
        }
        // 非放置状态：点击已建掩体 → 详情视图（2026-08-15；
        // 防御塔维持原有独立面板，由 game.js 点击分发处理，不在此拦截）
        if (!this._placing) {
            const p = this._clientToWorld(e);
            if (!p || !p.overCanvas) return;
            const cover = this._hitTestCover(p.x, p.y);
            if (cover) this._showDetail(cover);
            return;
        }
        const p = this._clientToWorld(e);
        if (!p || !p.overCanvas) return;
        // rAF 可能尚未执行；点击坐标必须同步更新预览，再由 _place() 完整复验。
        this._flushQueuedMouseMove(e);
        // 方块墙/道路：按下开始拖动（帝国时代式：长按拖动沿一条方向铺一排），
        // 松开时才统一放置（普通单击 = 只放起点一块）
        if (this._placing.item.kind === 'block' || this._placing.item.kind === 'road') {
            const snap = this._snapPosition(p.x, p.y) || { x: p.x, y: p.y };
            const [si, sj] = this._blockCellOf(snap.x, snap.y);
            this._wallDrag = { si, sj };
            this._updateWallPreview(snap.x, snap.y);
            return;
        }
        if (this._placing.item.kind === 'gate4') {
            this._gate4Hover = { x: p.x, y: p.y };
            const snap = this._snapGate4Grid(p.x, p.y);
            if (snap && snap.valid && this._canPlaceGate4(snap.x, snap.y, snap.dir)) {
                this._snapped = snap;
                this._place(snap.x, snap.y);
            } else {
                this._notify('该位置无法放置', '#ff5555');
            }
            return;
        }
        if (isWallStairBuildItem(this._placing.item)) {
            const snap = this._snapPosition(p.x, p.y);
            if (snap) {
                this._snapped = snap;
                this._place(snap.x, snap.y);
            } else {
                this._notify('请靠近外露且占地可用的方块墙建造楼梯', '#ff5555');
            }
            return;
        }
        if (isTwoByTwoBuildItem(this._placing.item)) {
            const snap = this._snapPosition(p.x, p.y);
            if (snap) {
                this._snapped = snap;
                this._place(snap.x, snap.y);
            }
            return;
        }
        // 落点 = 幽灵已确认可放的吸附位（_onMouseMove 已过滤 canPlace）；
        // 否则用鼠标原始位置。避免"吸附显示绿但点击落点被拒"（右边吸附放不下）
        const snapped = (this._snapped && this._canPlace(this._snapped.x, this._snapped.y))
            ? this._snapped : null;
        this._place(snapped ? snapped.x : p.x, snapped ? snapped.y : p.y);
    },

    /** 松开鼠标：结束拖墙/铺路，统一放置预览行（帝国时代式）。 */
    _onMouseUp(e) {
        if (e.button !== 0) return;
        if (!this._wallDrag) return;
        // mouseup 的坐标是拖墙/道路最终端点，不能提交上一帧缓存的 _wallRow。
        this._flushQueuedMouseMove(e);
        const p = this._clientToWorld(e);
        if (!p || !p.overCanvas || (this._panel && e.target && this._panel.contains(e.target))) {
            this._cancelDragPlacement();
            return;
        }
        const cells = this._wallRow || [];
        const itemKind = this._placing?.item?.kind;
        this._wallDrag = null;
        this._clearWallPreview();
        if (cells.length) {
            if (itemKind === 'road') this._placeRoadRow(cells);
            else this._placeBlockRow(cells);
        }
    },

    /** 失焦/画布外松开只取消本次拖墙，不退出当前建筑选择。 */
    _cancelDragPlacement() {
        this._wallDrag = null;
        this._wallRow = [];
        this._clearWallPreview();
    },

    _onKey(e) {
        // Esc 统一关闭建筑主面板与详情，并由 close() 收尾放置预览、事件监听和建造模式。
        if (e.code === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (this._recycleMode) {
                this._setRecycleMode(false);
                return;
            }
            this._closeAllBuildingPanels();
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
     * 除墙/门外的可建造建筑吸附到 2×2 格网中心。
     * @returns {null|{x:number,y:number,e:object}}
     */
    _snapPosition(x, y) {
        const item = this._placing && this._placing.item;
        if (!item) return null;
        // 方块墙：网格吸附（2026-08-17）——1 格 = 64×32 菱形格，贴格心/邻格拼接
        if (item.kind === 'block' || item.kind === 'road') return this._snapBlockGrid(x, y);
        if (isTwoByTwoBuildItem(item)) return this._snapBuildingGrid(x, y, 2);
        if (isWallStairBuildItem(item)) return this._snapWallStairGrid(x, y);
        // 4 格门：锚点吸附到格网半格位（栅栏跨 2 格的中点），方向跟随主导轴
        if (item.kind === 'gate4') return this._snapGate4Grid(x, y);
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

    /** N×N 建筑锚点：以所覆盖 N² 个格心的平均位置作为 footprint 中心。 */
    _snapBuildingGrid(x, y, cells = 2) {
        const centerOffsetY = ONE_CELL_BUILDING_FOOT.d * (cells - 1) / 2;
        const frontOffsetY = centerOffsetY + ONE_CELL_BUILDING_FOOT.d * cells / 2;
        const [i, j] = this._blockCellOf(x, y - frontOffsetY);
        const [gx, gy] = this._blockCellCenter(i, j);
        return {
            x: Math.round(gx),
            y: Math.round(gy + frontOffsetY),
            d: Math.hypot(gx - x, gy + frontOffsetY - y),
            grid: true,
            cells,
        };
    },

    /**
     * 城墙楼梯吸附：以墙顶为锚，沿墙法向对应的格轴向鼠标侧自动延伸到地面。
     * F/mirror 只切换墙的另一侧；当前 wallTopZ=125、rise=62.5 → 两段。
     */
    _snapWallStairGrid(x, y) {
        // 楼梯没有自由放置路径，必须始终执行贴墙候选计算；G 只控制普通建筑辅助吸附。
        const candidates = [];
        const mirror = !!this._placing?.mirror;
        const entities = Array.from(Game.entities.values());
        const walkableAnchorCounts = new Map();
        for (const entity of entities) {
            if (!entity?.active || !entity._isWalkableWall) continue;
            const key = `${Math.round(entity.x)},${Math.round(entity.y)}`;
            walkableAnchorCounts.set(key, (walkableAnchorCounts.get(key) || 0) + 1);
        }
        for (const wall of entities) {
            if (!wall || !wall.active || !wall._isDefenseCover || wall._isCoverGate
                || !wall._isWalkableWall || !Array.isArray(wall._faceLine)) continue;
            const anchorKey = `${Math.round(wall.x)},${Math.round(wall.y)}`;
            const stackedAtSameAnchor = (walkableAnchorCounts.get(anchorKey) || 0) > 1;
            if (stackedAtSameAnchor) continue;
            if (wall._isBlockCover) {
                const directions = [
                    { dir: 'e1', ascendingSign: -1, vx: BLOCK_GRID.e1[0], vy: BLOCK_GRID.e1[1] },
                    { dir: 'e1', ascendingSign: 1, vx: -BLOCK_GRID.e1[0], vy: -BLOCK_GRID.e1[1] },
                    { dir: 'e2', ascendingSign: -1, vx: BLOCK_GRID.e2[0], vy: BLOCK_GRID.e2[1] },
                    { dir: 'e2', ascendingSign: 1, vx: -BLOCK_GRID.e2[0], vy: -BLOCK_GRID.e2[1] },
                ];
                for (const direction of directions) {
                    if (!DefenseSystem.isWallStairAttachmentEligible?.(
                        wall,
                        direction.vx,
                        direction.vy
                    )) continue;
                    const targetTopZ = Number(wall._wallTopZ) || 125;
                    const segmentCount = Math.max(
                        WALL_STAIR_CONFIG.minSegments,
                        Math.min(
                            WALL_STAIR_CONFIG.maxSegments,
                            Math.ceil(targetTopZ / WALL_STAIR_CONFIG.risePerSegment)
                        )
                    );
                    const topCenter = {
                        x: wall.x + direction.vx,
                        y: wall.y + direction.vy,
                    };
                    const bottomCenter = {
                        x: wall.x + direction.vx * segmentCount,
                        y: wall.y + direction.vy * segmentCount,
                    };
                    const segments = [];
                    for (let index = 0; index < segmentCount; index++) {
                        const fromWall = segmentCount - index;
                        segments.push({
                            index,
                            x: Math.round(wall.x + direction.vx * fromWall),
                            y: Math.round(wall.y + direction.vy * fromWall),
                            baseZ: index * (targetTopZ / segmentCount),
                            topZ: (index + 1) * (targetTopZ / segmentCount),
                        });
                    }
                    const attachPoint = {
                        x: wall.x + direction.vx * 0.5,
                        y: wall.y + direction.vy * 0.5,
                    };
                    const candidate = {
                        x: bottomCenter.x,
                        y: bottomCenter.y,
                        d: Math.hypot(x - topCenter.x, y - topCenter.y),
                        grid: true,
                        dir: direction.dir,
                        ascendingSign: direction.ascendingSign,
                        outwardSign: -direction.ascendingSign,
                        wall,
                        walls: collectConnectedWalkableWalls(wall, Game.entities),
                        attachPoint,
                        targetTopZ,
                        segmentCount,
                        segments,
                        cost: WALL_STAIR_CONFIG.costPerSegment * segmentCount,
                    };
                    if (candidate.d <= WALL_STAIR_CONFIG.attachRadius) candidates.push(candidate);
                }
                continue;
            }
            const [a, b] = wall._faceLine;
            if (!a || !b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            if (len2 <= 1e-6) continue;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
            const px = a.x + dx * t;
            const py = a.y + dy * t;
            const distance = Math.hypot(x - px, y - py);
            if (distance > WALL_STAIR_CONFIG.attachRadius) continue;

            // "\" 墙沿 e1，楼梯走 e2；"/" 墙沿 e2，楼梯走 e1。
            const dir = dx * dy >= 0 ? 'e2' : 'e1';
            const axis = dir === 'e1' ? BLOCK_GRID.e1 : BLOCK_GRID.e2;
            let outwardSign = ((x - px) * axis[0] + (y - py) * axis[1]) >= 0 ? 1 : -1;
            if (mirror) outwardSign *= -1;
            const ascendingSign = -outwardSign;
            const stepX = axis[0] * ascendingSign;
            const stepY = axis[1] * ascendingSign;
            const targetTopZ = Number(wall._wallTopZ) || 125;
            const segmentCount = Math.max(
                WALL_STAIR_CONFIG.minSegments,
                Math.min(
                    WALL_STAIR_CONFIG.maxSegments,
                    Math.ceil(targetTopZ / WALL_STAIR_CONFIG.risePerSegment)
                )
            );
            // 顶段上沿必须直接接触墙面真实投影点：顶段中心 = 接触点 - 半格登高轴。
            // 旧实现先取墙所在格再偏一格，墙面线并不等于格边，导致墙内多出一格并产生大缝。
            const topCenter = {
                x: px - stepX * 0.5,
                y: py - stepY * 0.5,
            };
            const bottomCenter = {
                x: topCenter.x - stepX * (segmentCount - 1),
                y: topCenter.y - stepY * (segmentCount - 1),
            };
            const segments = [];
            for (let index = 0; index < segmentCount; index++) {
                segments.push({
                    index,
                    x: Math.round(bottomCenter.x + stepX * index),
                    y: Math.round(bottomCenter.y + stepY * index),
                    baseZ: index * (targetTopZ / segmentCount),
                    topZ: (index + 1) * (targetTopZ / segmentCount),
                });
            }
            const candidate = {
                x: segments[0].x,
                y: segments[0].y,
                d: distance,
                grid: true,
                dir,
                ascendingSign,
                outwardSign,
                wall,
                walls: collectConnectedWalkableWalls(wall, Game.entities),
                attachPoint: { x: px, y: py },
                targetTopZ,
                segmentCount,
                segments,
                cost: WALL_STAIR_CONFIG.costPerSegment * segmentCount,
            };
            candidates.push(candidate);
        }
        if (!candidates.length) return null;
        candidates.sort((a, b) => a.d - b.d);
        // 最近墙块/方向可能属于内层叠墙或已有建筑占位；依次寻找最近的绿色合法候选。
        for (const candidate of candidates) {
            if (this._canPlaceWallStairFootprint(candidate.x, candidate.y, candidate)) {
                candidate.placementValid = true;
                candidate.visualSegments = this._buildStairVisualSegments(candidate);
                return candidate;
            }
        }
        // 不可建造的内层墙/被覆盖墙不能继续抢占吸附。附近没有绿色候选时直接取消
        // 楼梯预览；鼠标移近其它外露墙面后会重新选择最近合法候选。
        return null;
    },

    _buildStairVisualSegments(stair) {
        if (!Array.isArray(stair?.segments)) return [];
        const variant = getWallStairVariant(stair.dir, stair.ascendingSign);
        if (!variant) return [];
        const displayWidth = Number(variant.displayWidth) || WALL_STAIR_CONFIG.displayWidth;
        const displayHeight = Number(variant.displayHeight) || WALL_STAIR_CONFIG.displayHeight;
        const visuals = new Array(stair.segments.length);
        for (let index = 0; index < stair.segments.length; index++) {
            const segment = stair.segments[index];
            const partName = index === stair.segments.length - 1 ? 'upper' : 'lower';
            const part = variant[partName];
            const surface = wallStairAnchorOffset(variant, partName, 'surface');
            const entry = wallStairAnchorOffset(variant, partName, 'entry');
            const exit = wallStairAnchorOffset(variant, partName, 'exit');
            const surfaceZ = (segment.baseZ + segment.topZ) * 0.5;
            const center = {
                x: segment.x - surface.x,
                y: segment.y - surfaceZ - surface.y,
            };
            visuals[index] = {
                texture: part?.texture,
                x: center.x,
                y: center.y,
                displayWidth,
                displayHeight,
                entry: { x: center.x + entry.x, y: center.y + entry.y },
                exit: { x: center.x + exit.x, y: center.y + exit.y },
            };
        }
        return visuals;
    },

    _clearStairPreview() {
        for (const sprite of this._stairPreview || []) {
            if (sprite && sprite.active) sprite.destroy();
        }
        this._stairPreview = [];
    },

    _updateStairPreview(snap, ok) {
        this._clearStairPreview();
        if (!this._ghost) return;
        if (!snap || !Array.isArray(snap.visualSegments)) {
            this._ghost.setVisible(false);
            const sel = this._panel && this._panel.querySelector('#bpSel');
            if (sel && isWallStairBuildItem(this._placing?.item)) {
                sel.textContent = `${WALL_STAIR_CONFIG.name} — 请靠近外露且占地可用的方块墙`;
            }
            return;
        }
        const scene = window.__phaserScene;
        const tint = ok ? 0x9dff9d : 0xff7777;
        const sprites = [];
        for (let index = 0; index < snap.visualSegments.length; index++) {
            const visual = snap.visualSegments[index];
            const sprite = index === 0 ? this._ghost : scene.add.sprite(0, 0, visual.texture);
            sprite.setTexture(visual.texture);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDisplaySize(visual.displayWidth, visual.displayHeight);
            sprite.setPosition(visual.x, visual.y);
            sprite.setDepth(999998 + index * 0.01);
            sprite.setAlpha(0.55);
            sprite.setTint(tint);
            sprite.setVisible(true);
            if (index > 0) sprites.push(sprite);
        }
        this._stairPreview = sprites;
        const sel = this._panel && this._panel.querySelector('#bpSel');
        if (sel) {
            sel.textContent = `${WALL_STAIR_CONFIG.name}（${snap.segmentCount}段，共${snap.cost}能）— 左键建造 / F切换墙侧`;
        }
    },

    /** 方块墙格网坐标（1 格 = 64×32，原点 4232/4080） */
    _blockCellOf(wx, wy) {
        return blockCellOf(wx, wy);
    },

    /** 格网坐标 → 格心世界坐标 */
    _blockCellCenter(i, j) {
        return blockCellCenter(i, j);
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
        const isRoad = item.kind === 'road';
        for (let k = 0; k < this._wallRow.length; k++) {
            const [x, y] = this._wallRow[k];
            const [i, j] = this._blockCellOf(x, y);
            const anchor = this._ghostAnchor(x, y);
            const ok = isRoad ? this._canPlaceRoad(x, y) : this._canPlaceBlock(x, y);
            if (k === this._wallRow.length - 1) {
                if (isRoad) this._ghost.setFrame(buildingRoadFrame(i, j));
                this._ghost.setPosition(anchor.x, anchor.y);
                this._ghost.setTint(ok ? 0x9dff9d : 0xff7777);
                this._ghost.setVisible(true);
            } else {
                const sp = scene.add.sprite(
                    anchor.x,
                    anchor.y,
                    item.tex,
                    isRoad ? buildingRoadFrame(i, j) : undefined
                );
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
    _createGate4Preview(scene, grade = 'C') {
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
        const barsKey = `cover_gate_${grade}_bars`;
        if (scene.textures.exists(barsKey)) {
            bars = scene.add.sprite(0, 0, barsKey, 0);
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
            const existingPillar = this._blockAt(cell[0], cell[1]);
            sp.setPosition(cell[0], cell[1] - BLOCK_FOOT_OFFSET);
            // 与实际 DefenseCover 方块深度一致：face maxY + 12 = cellY + 28
            sp.setDepth(999900 + (cell[1] - ay) + 28);
            sp.setTint(tint);
            sp.setVisible(!existingPillar);
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
        let spent = 0;
        let insufficient = false;
        const clearZones = [];
        const free = !!(Game && Game._devInfiniteResources);
        for (const [x, y] of cells) {
            if (!this._canPlace(x, y)) continue;
            if (!free && !this._deductBuildCost(item.currency, item.cost)) {
                insufficient = true;
                break;
            }
            const id = `built_${item.id}_${++this._seq}`;
            let cover;
            try {
                cover = new DefenseCover(x, y, {
                    grade: item.grade,
                    orient: item.orient,
                    mirror: false,
                    block: true,
                    id,
                });
            } catch (err) {
                if (!free) this._refundLastBuildPayment();
                console.error('[BuildingSystem] 方块墙建造失败:', err);
                break;
            }
            this._markBuiltEntity(cover, item);
            Game.entities.set(id, cover);
            clearZones.push({ x, y, radius: 70 });
            spent += free ? item.cost : (this._lastBuildPayment?.energy ?? item.cost);
            this._lastBuildPayment = null;
            n++;
        }
        this._clearBuildZones(clearZones);
        // 方块墙统一走拖墙/单击行放置入口，不会进入 _place() 的 block 分支。
        // 整批完成后只失效一次高架拓扑，确保楼梯吸附能立即识别新墙，同时避免逐块重建。
        if (n > 0) DefenseSystem?.invalidateElevatedTopology?.();
        if (n > 0 && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        const suffix = free ? '（无限资源）' : `（-${spent} 能）`;
        const text = n > 0
            ? `${item.name} 已放置 ${n} 块${suffix}${insufficient ? '，资源不足已停止' : ''}`
            : (insufficient ? `${item.name}：能源不足` : `${item.name}：没有可放置的格子`);
        this._notify(text, n > 0 ? '#7fd4ff' : '#ff5555');
        this._refreshCurrencies();
    },

    /** 拖动铺路：只对新增且合法的格子逐块扣费，已有道路/建筑预约格自动跳过。 */
    _placeRoadRow(cells) {
        const item = this._placing && this._placing.item;
        if (!item || item.kind !== 'road') return;
        let n = 0;
        let spent = 0;
        let insufficient = false;
        const clearZones = [];
        const free = !!(Game && Game._devInfiniteResources);
        for (const [x, y] of cells) {
            if (!this._canPlaceRoad(x, y)) continue;
            if (!free && !this._deductBuildCost(item.currency, item.cost)) {
                insufficient = true;
                break;
            }
            const [i, j] = this._blockCellOf(x, y);
            if (!BuildingRoadSystem.addManualRoad(i, j, {
                refundable: !free,
                buildCost: free ? 0 : item.cost,
                buildCurrency: item.currency,
            })) {
                if (!free) this._refundLastBuildPayment();
                continue;
            }
            clearZones.push({ x, y, radius: ONE_CELL_BUILDING_FOOT.clearRadius });
            spent += free ? item.cost : (this._lastBuildPayment?.energy ?? item.cost);
            this._lastBuildPayment = null;
            n++;
        }
        this._clearBuildZones(clearZones);
        if (n > 0 && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        const suffix = free ? '（无限资源）' : `（-${spent} 能）`;
        const text = n > 0
            ? `${item.name} 已铺设 ${n} 格${suffix}${insufficient ? '，资源不足已停止' : ''}`
            : (insufficient ? `${item.name}：能源不足` : `${item.name}：没有可铺设的格子`);
        this._notify(text, n > 0 ? '#7fd4ff' : '#ff5555');
        this._refreshCurrencies();
    },

    /**
     * 4 格门吸附（2026-08-17）：门锚点 = 栅栏跨 2 格的中点（格网半格位）。
     * e1 向门锚点 = 格心 + 0.5·e1；e2 向门锚点 = 格心 + 0.5·e2；取鼠标较近者。
     */
    _snapGate4Grid(x, y) {
        const snap = chooseGate4Snap(x, y, {
            mirror: !!(this._placing && this._placing.mirror),
            hasBlock: (i, j) => !!this._blockAtCell(i, j),
            canPlace: (ax, ay, dir) => this._canPlaceGate4(ax, ay, dir),
        });
        if (snap) this._gate4Dir = snap.dir;
        return snap;
    },

    /** 4 格门指定方向的锚点（e1: 格心+0.5·e1；e2: 格心+0.5·e2），保证格对齐 */
    _gate4AnchorFor(x, y, dir, side = 1) {
        const [ci, cj] = this._blockCellOf(x, y);
        return this._gate4AnchorForCell(ci, cj, dir, side);
    },

    /** 指定格 + 方向的 4 格门锚点 */
    _gate4AnchorForCell(ci, cj, dir, side = 1) {
        return gate4AnchorForCell(ci, cj, dir, side);
    },

    /** 4 格门的 4 个格心（沿 dir 方向，k=0..3）：石柱 ±1.5 格、栅栏 ±0.5 格 */
    _gate4Cells(x, y, dir) {
        return gate4Cells(x, y, dir);
    },

    /** 4 格门判定：全空、四墙替换、或单端柱复用；中间格被占用仍拒绝。 */
    _canPlaceGate4(x, y, dir) {
        const cells = this._gate4Cells(x, y, dir);
        const item = this._placing && this._placing.item;
        if (!item || this._violatesPlacementUnitRules(item, x, y, { dir })) return false;
        const occupied = [];
        const existingBlocks = [];
        for (let k = 0; k < cells.length; k++) {
            const [cx, cy] = cells[k];
            const block = this._blockAt(cx, cy);
            existingBlocks[k] = block;
            if (block) occupied.push(k);
        }
        if (!isGate4OccupancyValid(occupied)) return false;

        // 复用既有门柱向外延伸时，连接点所属旧门的栅栏段不应反过来阻止新门吸附。
        const connectedGateSegs = new Set();
        for (const k of [0, 3]) {
            const root = existingBlocks[k]?._buildGroupRoot;
            if (root?._isGate4) {
                if (root._gateSeg) connectedGateSegs.add(root._gateSeg);
            }
        }
        for (let k = 0; k < cells.length; k++) {
            if (existingBlocks[k]) continue;
            const [cx, cy] = cells[k];
            if (!this._canPlaceBlock(cx, cy, {
                ignoreSegs: connectedGateSegs,
            })) return false;
        }
        return true;
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
        DefenseSystem?.invalidateElevatedTopology?.();
    },

    /**
     * 放置/替换 4 格门：左右石柱（方块墙实体）+ 中间 2 格宽门实体。
     * 替换：4 格全为墙 → 保留两端墙当石柱、移除中间 2 墙、中间加门。
     */
    _placeGate4(x, y, dir) {
        const item = this._placing && this._placing.item;
        if (!item) return;
        const cells = this._gate4Cells(x, y, dir);
        const existing = cells.map(([cx, cy]) => this._blockAt(cx, cy));
        const isReplace = existing.every(Boolean);
        const endpointAttach = !isReplace
            && existing.filter(Boolean).length === 1
            && (!!existing[0] || !!existing[3]);
        if (isReplace) {
            // 中间 2 格墙 → 移除（两端墙保留为石柱）
            for (const k of [1, 2]) {
                const [cx, cy] = cells[k];
                this._removeWallBlock(this._blockAt(cx, cy));
            }
        }
        let n = 0;
        const group = [];
        // 石柱：k=0, k=3
        for (const k of [0, 3]) {
            const [cx, cy] = cells[k];
            const existingPillar = this._blockAt(cx, cy);
            if (existingPillar) {
                // 四墙替换时端柱纳入门组；单端吸附时复用但保持原墙独立，回收门不会误删旧柱。
                if (isReplace) group.push(existingPillar);
                continue;
            }
            if (!this._canPlaceBlock(cx, cy)) continue;
            const id = `built_${item.id}_pillar_${++this._seq}`;
            const cover = new DefenseCover(cx, cy, {
                grade: item.grade,
                orient: 'v',
                mirror: false,
                block: true,
                id,
            });
            this._markBuiltEntity(cover, item, 0); // 新建门的石柱成本计入门主体，避免重复退款
            Game.entities.set(id, cover);
            group.push(cover);
            n++;
        }
        // 门实体：栅栏跨中间 2 格
        const gid = `built_${item.id}_${++this._seq}`;
        const gate = new BuildableGate(x, y, {
            grade: item.visualGrade || item.grade,
            hp: DEFENSE_CONFIG.covers.hp[item.grade] ?? 1600,
            isGate4: true,
            orient: 'v',
            mirror: dir === 'e1',
            barCells: 2,
            barsOnly: true,
            id: gid,
        });
        gate.grade = item.grade; // 详情/数值显示为 C 级，视觉仍沿用已验收的 D 级4格门素材
        gate._isGate4 = true;
        this._markBuiltEntity(gate, item);
        Game.entities.set(gid, gate);
        if (DefenseSystem && DefenseSystem.gates) DefenseSystem.gates.push(gate);
        group.push(gate);
        for (const part of group) {
            part._buildGroup = group;
            part._buildGroupRoot = gate;
        }
        n++;
        // 新建门柱或四墙替门都会改变方块墙集合；楼梯外墙资格必须在下一次查询前刷新。
        DefenseSystem?.invalidateElevatedTopology?.();
        this._clearBuildZones(cells.map(([cx, cy]) => ({ x: cx, y: cy, radius: 70 })));
        if (n > 0 && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        const placedText = isReplace
            ? `${item.name} 已替换（4 墙 → 门）`
            : (endpointAttach ? `${item.name} 已吸附端柱` : `${item.name} 已放置`);
        this._notify(placedText, '#7fd4ff');
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

    /** 建造判定使用的实际占地半径（墙段/4格门另走专用几何）。 */
    _itemPlacementRadius(item) {
        if (!item) return 28;
        if (isTwoByTwoBuildItem(item)) {
            return Math.hypot(TWO_BY_TWO_BUILDING_FOOT.w / 2, TWO_BY_TWO_BUILDING_FOOT.d / 2);
        }
        return 28;
    },

    _entityPlacementRadius(e) {
        if (!e) return 0;
        if (e._isGridBuilding) return e.collisionRadius || 0;
        if (e._isBlockCover) return Math.hypot(BLOCK_FOOT.w / 2, BLOCK_FOOT.d / 2);
        return e.collisionRadius || e.groundRadius || 28;
    },

    _placementUnitCenter(entity) {
        return {
            x: Number.isFinite(Number(entity?.collider?.x)) ? Number(entity.collider.x) : Number(entity?.x) || 0,
            y: Number.isFinite(Number(entity?.collider?.y)) ? Number(entity.collider.y) : Number(entity?.y) || 0,
        };
    },

    /** 只把玩家、友军、敌军和实体 NPC 视为“单位”；建筑、资源点和无碰撞装饰不进入本规则。 */
    _isPlacementUnit(entity) {
        if (!entity || !entity.active || entity.noCollision || entity._isDefenseStructure) return false;
        if (entity === Game.player) return true;
        if (entity.npcType) return true;
        return entity._faction === 'player'
            || entity._faction === 'companion'
            || BUILD_HOSTILE_FACTIONS.has(entity._faction);
    },

    _placementUnits() {
        if (!Game?.entities) return [];
        return Array.from(Game.entities.values()).filter((entity) => this._isPlacementUnit(entity));
    },

    /** 敌军按物理 x/y 到放置锚点的中心距离判定，不受精灵高度或压平显示影响。 */
    _hasEnemyNearPlacement(x, y) {
        const limitSq = BUILD_ENEMY_EXCLUSION_RADIUS * BUILD_ENEMY_EXCLUSION_RADIUS;
        for (const entity of Game?.entities?.values?.() || []) {
            if (!entity?.active || !BUILD_HOSTILE_FACTIONS.has(entity._faction)) continue;
            const center = this._placementUnitCenter(entity);
            const dx = center.x - x;
            const dy = center.y - y;
            if (dx * dx + dy * dy <= limitSq) return true;
        }
        return false;
    },

    _unitIntersectsIsoProbe(unit, probe) {
        const center = this._placementUnitCenter(unit);
        const radius = Math.max(1, Number(unit.groundRadius) || Number(unit.collisionRadius) || 10);
        return circleIntersectsIsoFootprint(center.x, center.y, radius, probe);
    },

    /** 使用各建筑真实占地判断“脚下有单位”，避免仅按锚点圆形粗判。 */
    _hasUnitInPlacementFootprint(item, x, y, { dir = null, snap = null } = {}) {
        const units = this._placementUnits();
        if (units.length === 0) return false;
        let probes = null;

        if (isTwoByTwoBuildItem(item)) {
            probes = [this._buildingFootprintProbe(x, y)];
        } else if (item.kind === 'block' || item.kind === 'road') {
            probes = [this._roadCellProbe({ x, y })];
        } else if (item.kind === 'gate4') {
            probes = this._gate4Cells(x, y, dir || 'e2')
                .map(([cellX, cellY]) => this._roadCellProbe({ x: cellX, y: cellY }));
        } else if (isWallStairBuildItem(item)) {
            const stairDir = snap?.dir || dir || wallStairDir(!!this._placing?.mirror);
            const segments = Array.isArray(snap?.segments) && snap.segments.length > 0
                ? snap.segments
                : [{ x, y }];
            probes = segments.map((segment) => this._wallStairProbe(segment.x, segment.y, stairDir));
        }

        if (probes) {
            return units.some((unit) => probes.some((probe) => this._unitIntersectsIsoProbe(unit, probe)));
        }

        if (item.kind === 'cover' || item.kind === 'gate') {
            const orient = effOrient(item, !!this._placing?.mirror);
            const seg = this._coverSeg(x, y, item.grade, orient);
            const fullThickness = item.kind === 'gate'
                ? GATE_GEOM.halfThick * 2
                : ((COVER_FOOT[orient] || COVER_FOOT[item.orient] || COVER_FOOT.v).thick ?? 26);
            return units.some((unit) => {
                const center = this._placementUnitCenter(unit);
                const radius = Math.max(1, Number(unit.groundRadius) || Number(unit.collisionRadius) || 10);
                return this._pointSegDist(center.x, center.y, seg[0], seg[1]) <= radius + fullThickness / 2;
            });
        }

        const radius = this._itemPlacementRadius(item);
        return units.some((unit) => {
            const center = this._placementUnitCenter(unit);
            const unitRadius = Math.max(1, Number(unit.groundRadius) || Number(unit.collisionRadius) || 10);
            return Math.hypot(center.x - x, center.y - y) <= radius + unitRadius;
        });
    },

    _violatesPlacementUnitRules(item, x, y, context = {}) {
        return this._hasEnemyNearPlacement(x, y)
            || this._hasUnitInPlacementFootprint(item, x, y, context);
    },

    /** 完整 footprint 必须留在世界内；不能只检查锚点离边缘 20px。 */
    _fitsPlacementBounds(item, x, y) {
        const pad = 20;
        let minX, maxX, minY, maxY;
        if (item.kind === 'block') {
            minX = x - BLOCK_FOOT.w / 2; maxX = x + BLOCK_FOOT.w / 2;
            minY = y - BLOCK_FOOT.d / 2; maxY = y + BLOCK_FOOT.d / 2;
        } else if (item.kind === 'road') {
            const probe = this._roadCellProbe({ x, y });
            const vertices = isoFootprintVertices(probe);
            minX = Math.min(...vertices.map((p) => p.x));
            maxX = Math.max(...vertices.map((p) => p.x));
            minY = Math.min(...vertices.map((p) => p.y));
            maxY = Math.max(...vertices.map((p) => p.y));
        } else if (isWallStairBuildItem(item)) {
            const probe = this._wallStairProbe(x, y, wallStairDir(!!this._placing?.mirror));
            const vertices = isoFootprintVertices(probe);
            minX = Math.min(...vertices.map((p) => p.x));
            maxX = Math.max(...vertices.map((p) => p.x));
            minY = Math.min(...vertices.map((p) => p.y));
            maxY = Math.max(...vertices.map((p) => p.y));
        } else if (isTwoByTwoBuildItem(item)) {
            const vertices = isoFootprintVertices(this._buildingFootprintProbe(x, y));
            minX = Math.min(...vertices.map((p) => p.x));
            maxX = Math.max(...vertices.map((p) => p.x));
            minY = Math.min(...vertices.map((p) => p.y));
            maxY = Math.max(...vertices.map((p) => p.y));
        } else {
            const r = this._itemPlacementRadius(item);
            minX = x - r; maxX = x + r;
            minY = y - r; maxY = y + r;
        }
        return minX >= pad && minY >= pad
            && maxX <= CONFIG.WORLD_WIDTH - pad
            && maxY <= CONFIG.WORLD_HEIGHT - pad;
    },

    _canPlace(x, y) {
        const item = this._placing && this._placing.item;
        if (!item) return false;
        if (this._featureBuildingBlockReason(item)) return false;
        if (!isTwoByTwoBuildItem(item) && !this._fitsPlacementBounds(item, x, y)) return false;
        // 方块墙：格子冲突判定（2026-08-17 二修）——单条 face 线段会压住同向邻格，
        // 改为「同格不可放、邻格/更远可放」+ 地形检查（排除方块自身 face 段）
        if (this._placing && this._placing.item.kind === 'block') {
            return this._canPlaceBlock(x, y);
        }
        if (this._placing && this._placing.item.kind === 'road') {
            return this._canPlaceRoad(x, y);
        }
        // 4 格门：4 个格全部可放
        if (this._placing && this._placing.item.kind === 'gate4') {
            const dir = (this._snapped && this._snapped.dir) || 'e2';
            return this._canPlaceGate4(x, y, dir);
        }
        if (isWallStairBuildItem(item)) return this._canPlaceWallStairFootprint(x, y);
        if (isTwoByTwoBuildItem(item)) return this._canPlaceBuildingFootprint(x, y);
        if (this._violatesPlacementUnitRules(item, x, y)) return false;
        const radius = this._itemPlacementRadius(item);
        const canBuild = WallSystem && typeof WallSystem.canBuildAt === 'function'
            ? WallSystem.canBuildAt.bind(WallSystem)
            : (WallSystem && typeof WallSystem.canMoveTo === 'function' ? WallSystem.canMoveTo.bind(WallSystem) : null);
        if (canBuild && !canBuild(x, y, radius)) return false;
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
                if (e._isWallStaircase && Array.isArray(e.segments)) {
                    if (e.segments.some((segment) => Math.hypot(segment.x - x, segment.y - y) < 96)) return false;
                    continue;
                }
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
        for (const e of Game.entities.values()) {
            if (!e || !e._isDefenseStructure || !e.active) continue;
            const dx = e.x - x;
            const dy = e.y - y;
            const minDist = radius + this._entityPlacementRadius(e) + 4;
            if (dx * dx + dy * dy < minDist * minDist) return false;
        }
        return true;
    },

    /** 普通建筑 2×2 矩形 footprint：完整边界、建筑重叠和地形阻挡统一判定。 */
    _canPlaceBuildingFootprint(x, y) {
        const item = this._placing && this._placing.item;
        if (!item) return false;
        if (this._violatesPlacementUnitRules(item, x, y)) {
            this._roadPlacementStatus = null;
            return false;
        }
        const status = this._buildingRoadPlacementStatus(x, y, {
            includeRoadRing: usesBuildingRoads(item),
            perimeterKind: buildingPerimeterKind(item),
        });
        this._roadPlacementStatus = status;
        if (!this._fitsPlacementBounds(item, x, y)) return false;
        if (!this._canPlaceIsoBuildingFootprint(this._buildingFootprintProbe(x, y))) return false;
        return status.ok;
    },

    _buildingFootprintProbe(x, y) {
        const probe = {
            active: true,
            x,
            y,
            collisionShape: 'iso_rect',
            collisionWidth: TWO_BY_TWO_BUILDING_FOOT.w,
            collisionHeight: TWO_BY_TWO_BUILDING_FOOT.d,
            collisionIsoHalfU: TWO_BY_TWO_BUILDING_FOOT.w / (2 * Math.SQRT2),
            collisionIsoHalfV: TWO_BY_TWO_BUILDING_FOOT.w / (2 * Math.SQRT2),
            colliderOffsetY: TWO_BY_TWO_BUILDING_FOOT.offY,
        };
        const fit = this._ghostGroundFit();
        const item = this._placing?.item;
        // 统一资产默认走标准2×2；只有未来显式声明 true 的异形生产建筑才允许像素拟合。
        const autoFootprint = item?.kind === 'producer'
            && PRODUCER_BUILDINGS[item.id]?.autoFootprint === true;
        if (fit && autoFootprint) applyFittedBuildingFootprint(probe, fit);
        return probe;
    },

    _roadCellProbe(cell) {
        return {
            active: true,
            x: cell.x,
            y: cell.y,
            collisionShape: 'iso_rect',
            collisionWidth: ONE_CELL_BUILDING_FOOT.w,
            collisionHeight: ONE_CELL_BUILDING_FOOT.d,
            collisionIsoHalfU: ONE_CELL_BUILDING_FOOT.halfU,
            collisionIsoHalfV: ONE_CELL_BUILDING_FOOT.halfV,
            colliderOffsetX: 0,
            colliderOffsetY: 0,
        };
    },

    _roadCellFitsBounds(cell) {
        const pad = 20;
        const vertices = isoFootprintVertices(this._roadCellProbe(cell));
        return vertices.every((point) =>
            point.x >= pad
            && point.y >= pad
            && point.x <= CONFIG.WORLD_WIDTH - pad
            && point.y <= CONFIG.WORLD_HEIGHT - pad
        );
    },

    _buildingRoadPlacementStatus(x, y, { includeRoadRing = true, perimeterKind = 'road' } = {}) {
        const layout = buildingRoadLayout(x, y);
        const validByKey = new Map();
        const checkedCells = includeRoadRing ? layout.reservationCells : layout.buildingCells;
        for (const cell of checkedCells) {
            const canShareManualRoad = cell.road && perimeterKind === 'road';
            const valid = !BuildingRoadSystem.isReservedCell(cell.i, cell.j)
                && (canShareManualRoad || !BuildingRoadSystem.isManualRoadCell(cell.i, cell.j))
                && this._roadCellFitsBounds(cell)
                && this._canPlaceIsoBuildingFootprint(this._roadCellProbe(cell), {
                    centerSampleRadius: 4,
                    edgeSampleRadius: 0,
                });
            validByKey.set(cell.key, valid);
        }
        return {
            layout,
            validByKey,
            ok: checkedCells.every((cell) => validByKey.get(cell.key)),
        };
    },

    _wallStairProbe(x, y, dir) {
        const foot = WALL_STAIR_FOOTPRINTS[dir] || WALL_STAIR_FOOTPRINTS.e2;
        return {
            active: true,
            x,
            y,
            collisionShape: 'iso_rect',
            collisionWidth: foot.collisionWidth,
            collisionHeight: foot.collisionHeight,
            collisionIsoHalfU: foot.halfU,
            collisionIsoHalfV: foot.halfV,
            colliderOffsetX: foot.offX,
            colliderOffsetY: foot.offY,
        };
    },

    /** 城墙楼梯整组占地判定：所有1×1段必须同时合法，只忽略其连接的目标墙本体。 */
    _canPlaceWallStairFootprint(x, y, snap = this._snapped) {
        const item = this._placing && this._placing.item;
        if (!item || !snap || !snap.wall || !Array.isArray(snap.segments)) return false;
        if (this._violatesPlacementUnitRules(item, x, y, { dir: snap.dir, snap })) return false;
        const attachedWalls = snap.walls?.length ? snap.walls : [snap.wall];
        // 实体重叠只忽略楼梯真正连接的目标墙。若忽略整条连通墙链，内层叠墙或
        // 楼梯段所占格里的其它墙也会被放行，导致不可到达墙仍能吸附并穿墙建造。
        // 边线采样继续忽略墙链，避免合法外墙两侧的相邻墙线在2px采样中误伤。
        const ignoreEntities = new Set([snap.wall]);
        const ignoreSegs = new Set(attachedWalls.map((wall) => wall?._coverSeg).filter(Boolean));
        // 已有楼梯的红色侧轨属于移动导航边界，不是建筑占地。中间补建楼梯时若继续
        // 参与2px地形采样，会被左右两座楼梯的侧轨同时误判为阻挡。楼梯之间的真实
        // 冲突仍由下方逐段1×1 footprint重叠检查负责。
        for (const staircase of DefenseSystem?.staircases || []) {
            if (!staircase?.active) continue;
            for (const edge of staircase._edgeSegs || []) ignoreSegs.add(edge);
        }
        for (const segment of snap.segments) {
            if (!this._fitsPlacementBounds(item, segment.x, segment.y)) return false;
            const probe = this._wallStairProbe(segment.x, segment.y, snap.dir);
            if (!this._canPlaceIsoBuildingFootprint(probe, {
                ignoreEntities,
                ignoreSegs,
                // 楼梯底座已经通过完整1×1 footprint做实体重叠判定。地形采样不能再让
                // 四角/边中点外扩18px，否则左右斜向端会越出本格误撞相邻墙。
                centerSampleRadius: 12,
                edgeSampleRadius: 2,
            })) return false;
        }
        return true;
    },

    _canPlaceIsoBuildingFootprint(probe, options = {}) {
        if (!probe) return false;
        const ignoreEntities = options.ignoreEntities || new Set();
        const ignoreSegs = options.ignoreSegs || new Set();
        for (const e of Game.entities.values()) {
            if (!e || !e._isDefenseStructure || !e.active) continue;
            if (e._isWallStaircase && Array.isArray(e.segments)) {
                for (const segment of e.segments) {
                    const stairProbe = this._wallStairProbe(segment.x, segment.y, e.dir);
                    if (isoFootprintsOverlap(probe, stairProbe, -0.5)) return false;
                }
                continue;
            }
            if (ignoreEntities.has(e)) continue;
            const ecx = e.collider ? e.collider.x : e.x + (e.colliderOffsetX || 0);
            const ecy = e.collider ? e.collider.y : e.y + (e.colliderOffsetY || 0);
            if (e.collisionShape === 'iso_rect') {
                if (isoFootprintsOverlap(probe, e, -0.5)) return false;
                continue;
            }
            if (e._isBlockCover) {
                const blockProbe = {
                    x: ecx,
                    y: ecy,
                    collisionWidth: BLOCK_FOOT.w,
                    collisionIsoHalfU: BLOCK_FOOT.w / (2 * Math.SQRT2),
                    collisionIsoHalfV: BLOCK_FOOT.w / (2 * Math.SQRT2),
                };
                if (isoFootprintsOverlap(probe, blockProbe, -0.5)) return false;
                continue;
            }
            const er = e.collisionRadius || e.groundRadius || 28;
            if (circleIntersectsIsoFootprint(ecx, ecy, er + 4, probe)) return false;
        }

        const canBuild = WallSystem && typeof WallSystem.canBuildAt === 'function'
            ? WallSystem.canBuildAt.bind(WallSystem)
            : (WallSystem && typeof WallSystem.canMoveTo === 'function' ? WallSystem.canMoveTo.bind(WallSystem) : null);
        if (!canBuild) return true;
        const vertices = isoFootprintVertices(probe);
        const center = {
            x: probe.x + (probe.colliderOffsetX || 0),
            y: probe.y + (probe.colliderOffsetY || 0),
        };
        const centerSampleRadius = Number.isFinite(options.centerSampleRadius)
            ? Math.max(0, options.centerSampleRadius)
            : 18;
        const edgeSampleRadius = Number.isFinite(options.edgeSampleRadius)
            ? Math.max(0, options.edgeSampleRadius)
            : centerSampleRadius;
        const samples = [{ point: center, radius: centerSampleRadius }];
        for (const vertex of vertices) samples.push({ point: vertex, radius: edgeSampleRadius });
        for (let i = 0; i < vertices.length; i++) {
            const a = vertices[i], b = vertices[(i + 1) % vertices.length];
            samples.push({
                point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                radius: edgeSampleRadius,
            });
        }
        return samples.every(({ point, radius }) => canBuild(point.x, point.y, radius, {
            rects: new Set(),
            segs: ignoreSegs,
        }));
    },

    /** 手动道路：单格地面覆盖，不生成碰撞；已有道路和建筑4×4预约格不可重复铺设。 */
    _canPlaceRoad(x, y) {
        const item = this._placing && this._placing.item;
        if (!item || item.kind !== 'road' || !this._fitsPlacementBounds(item, x, y)) return false;
        if (this._violatesPlacementUnitRules(item, x, y)) return false;
        const [i, j] = this._blockCellOf(x, y);
        if (!BuildingRoadSystem.canPlaceManualRoadCell(i, j)) return false;
        // 方块墙的面线穿过格心；道路与墙相邻时，单格菱形的边中点会恰落在该面线上。
        // 道路本身没有碰撞，故仅忽略方块墙的线段阻挡。墙的 iso footprint 仍参与下方
        // _canPlaceIsoBuildingFootprint 的实体重叠检查，保证不能把道路铺到墙所在格。
        const ignoreSegs = new Set();
        for (const e of Game.entities.values()) {
            if (e?.active && e._isBlockCover && e._coverSeg) ignoreSegs.add(e._coverSeg);
        }
        return this._canPlaceIsoBuildingFootprint(this._roadCellProbe({ x, y }), {
            ignoreSegs,
            centerSampleRadius: 4,
            edgeSampleRadius: 0,
        });
    },

    /** 方块墙放置判定：1×1 格心冲突 + 地形（树/仙人掌/世界边界）。 */
    _canPlaceBlock(x, y, options = {}) {
        const item = this._placing && this._placing.item;
        const boundsItem = item && item.kind === 'gate4' ? { kind: 'block' } : item;
        if (!boundsItem || !this._fitsPlacementBounds(boundsItem, x, y)) return false;
        if (item?.kind !== 'gate4' && this._violatesPlacementUnitRules(item, x, y)) return false;
        const [ni, nj] = this._blockCellOf(x, y);
        const blockR = Math.hypot(BLOCK_FOOT.w / 2, BLOCK_FOOT.d / 2);
        const ignoreSegs = new Set(options.ignoreSegs || []);
        for (const e of Game.entities.values()) {
            if (!e || !e._isDefenseStructure || !e.active) continue;
            if (e._isWallStaircase && Array.isArray(e.segments)) {
                const blockProbe = this._wallStairProbe(x, y, 'e2');
                if (e.segments.some((segment) => isoFootprintsOverlap(
                    blockProbe,
                    this._wallStairProbe(segment.x, segment.y, e.dir),
                    -0.5
                ))) return false;
                continue;
            }
            if (e._isBlockCover) {
                if (e._isBlockCover && e._coverSeg) ignoreSegs.add(e._coverSeg);
                const [ei, ej] = this._blockCellOf(e.x, e.y);
                if (ei === ni && ej === nj) return false; // 同格不可放
                continue;
            }
            if (e.collisionShape === 'iso_rect') {
                const blockProbe = {
                    x,
                    y,
                    collisionWidth: BLOCK_FOOT.w,
                    collisionIsoHalfU: BLOCK_FOOT.w / (2 * Math.SQRT2),
                    collisionIsoHalfV: BLOCK_FOOT.w / (2 * Math.SQRT2),
                };
                if (isoFootprintsOverlap(blockProbe, e, -0.5)) return false;
                continue;
            }
            if (e._isGridBuilding && e.collisionWidth > 0 && e.collisionHeight > 0) {
                const blockProbe = {
                    x,
                    y,
                    collisionWidth: BLOCK_FOOT.w,
                    collisionIsoHalfU: BLOCK_FOOT.w / (2 * Math.SQRT2),
                    collisionIsoHalfV: BLOCK_FOOT.w / (2 * Math.SQRT2),
                };
                if (isoFootprintsOverlap(blockProbe, e, -0.5)) return false;
                continue;
            }
            const ecx = e.collider ? e.collider.x : e.x;
            const ecy = e.collider ? e.collider.y : e.y;
            const dx = ecx - x, dy = ecy - y;
            const minDist = blockR + this._entityPlacementRadius(e) + 4;
            if (dx * dx + dy * dy < minDist * minDist) return false;
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

    /** 掩体/门/城墙楼梯命中检测。 */
    _hitTestCover(wx, wy) {
        let best = null;
        for (const e of Game.entities.values()) {
            if (!e || !(e._isDefenseCover || e._isCoverGate || e._isWallStaircase) || !e.active) continue;
            let d = Infinity;
            if (e._isWallStaircase && Array.isArray(e.visualSegments)) {
                for (const visual of e.visualSegments) {
                    const dx = Math.max(0, Math.abs(wx - visual.x) - visual.displayWidth * 0.5);
                    const dy = Math.max(0, Math.abs(wy - visual.y) - visual.displayHeight * 0.5);
                    d = Math.min(d, Math.hypot(dx, dy));
                }
            }
            if (e._faceLine && e._faceLine.length === 2) {
                d = this._pointSegDist(wx, wy, e._faceLine[0], e._faceLine[1]) - (e._coverHalfThick ?? 26);
            }
            d = Math.min(d, Math.hypot(wx - e.x, wy - e.y) - 90);
            if (d <= 24 && (!best || d < best.d)) best = { e, d };
        }
        return best ? best.e : null;
    },

    /** 快捷回收命中：只允许玩家建造的实体，按实际占地/精灵范围选最近目标。 */
    _hitTestRecyclableEntity(wx, wy) {
        const roots = new Set();
        const hits = [];
        for (const raw of Game.entities.values()) {
            if (!raw || !raw.active || !raw._builtByPlayer) continue;
            const entity = raw._buildGroupRoot && raw._buildGroupRoot.active
                ? raw._buildGroupRoot
                : raw;
            if (roots.has(entity)) continue;
            roots.add(entity);
            if (!this._recycleInfo(entity).recyclable) continue;

            let score = Infinity;
            if (entity._isWallStaircase && Array.isArray(entity.visualSegments)) {
                for (const visual of entity.visualSegments) {
                    const dx = Math.max(0, Math.abs(wx - visual.x) - visual.displayWidth * 0.5);
                    const dy = Math.max(0, Math.abs(wy - visual.y) - visual.displayHeight * 0.5);
                    score = Math.min(score, Math.hypot(dx, dy));
                }
            }
            if (entity._faceLine && entity._faceLine.length === 2) {
                score = Math.min(score,
                    this._pointSegDist(wx, wy, entity._faceLine[0], entity._faceLine[1])
                    - (entity._coverHalfThick ?? 26));
            }
            if (entity.collisionShape === 'iso_rect'
                && pointInIsoFootprint(wx, wy, entity, 16)) {
                score = Math.min(score, 0);
            }
            const spr = entity.spriteCfg;
            if (spr) {
                const fallbackOffsetX = entity._facingLeft
                    ? -(spr.offsetX || 0)
                    : (spr.offsetX || 0);
                const cx = entity.x + (entity._visualFootOffsetX ?? fallbackOffsetX);
                const cy = entity.y - (entity._visualFootOffsetY ?? spr.footOffsetY ?? 0);
                const hw = (spr.size || entity.size || 32) * 0.5;
                const hh = (spr.sizeH || spr.size || entity.size || 32) * 0.5;
                const dx = Math.max(0, Math.abs(wx - cx) - hw);
                const dy = Math.max(0, Math.abs(wy - cy) - hh);
                score = Math.min(score, Math.hypot(dx, dy));
            }
            score = Math.min(score, Math.hypot(wx - entity.x, wy - entity.y) - 90);
            if (score <= 24) hits.push({ entity, score });
        }
        hits.sort((a, b) => a.score - b.score || b.entity.y - a.entity.y);
        return hits[0]?.entity || null;
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
        this._detail = entity && entity._buildGroupRoot && entity._buildGroupRoot.active
            ? entity._buildGroupRoot
            : entity;
        this._renderDetail();
    },

    _closeDetail() {
        this._detail = null;
        this._renderDetail();
    },

    _detailPanelTitle(e) {
        if (e?._isCoverGate) return `${e._isGate4 ? '4格门' : (e.name || `铁栅栏门·${e.grade || 'D'}级`)} · 建筑详情`;
        if (e?._isWallStaircase) return `${WALL_STAIR_CONFIG.name} · 建筑详情`;
        if (e?._isBlockCover) return '方块墙 · 建筑详情';
        return `掩体·${e?.grade || 'F'}级 · 建筑详情`;
    },

    /** 详情视图渲染：作为建筑主面板的同级独立右侧栏目。 */
    _renderDetail() {
        if (!this._detailPanel) return;
        const det = this._detailPanel.querySelector('#bpDetail');
        if (!det) return;
        let e = this._detail;
        let show = !!(e && e.active && e.hp > 0);
        if (e && !show) {
            e = this._detail = null;
            show = false;
            this._notify('建筑已被摧毁', '#ff8855');
        }
        this._detailPanel.classList.toggle('active', show);
        const title = this._detailPanel.querySelector('#bpDetailTitle');
        if (title) title.textContent = show ? this._detailPanelTitle(e) : '建筑详情';
        if (!show) {
            det.innerHTML = '';
            return;
        }
        mountRightSidebarPanel(this._detailPanel, 'panel', { bringToFront: true });
        // 门走专属详情（含常锁/常开模式按钮，2026-08-15）
        if (e._isCoverGate) { this._renderGateDetail(det, e); return; }
        // 城墙楼梯专属详情。
        if (e._isWallStaircase) { this._renderWallStairDetail(det, e); return; }
        if (e._isBlockCover) { this._renderBlockDetail(det, e); return; }
        // 掩体详情：贴图 / 耐久条 / 朝向 / 建造消耗 / 修理费率 / 回满预估
        const g = e.grade || 'F';
        const maxHp = e.maxHp || 1;
        const hp = Math.max(0, Math.ceil(e.hp));
        const buildCost = e._buildCost ?? Math.round((DEFENSE_CONFIG.covers.hp[g] ?? 400) * 0.25);
        const repairRate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.coverHpPerEnergy) || 2;
        const repairNeed = Math.ceil((maxHp - hp) / repairRate);
        const eff = effOrient(e, e._facingLeft);
        const orientTxt = eff === 'v' ? '垂直（/）' : '水平（\\）';
        det.innerHTML = `
            ${renderBuildingDetailHeader({ texture: `obstacle_cover_${g}_v`, name: `掩体·${g}级`, hp, maxHp, status: orientTxt })}
            <div style="font-size:13px;font-weight:700;color:#ffd700;margin:2px 0 6px;">特殊功能 · 阻挡与防线构建</div>
            <div class="bp-detail-rows">
                朝向：<b>${orientTxt}</b><br>
                建造消耗：<b style="color:#7fd4ff;">${buildCost} 能源</b><br>
                修理费率：<b>${repairRate} 耐久 / 1 能源</b>（点击下方按钮修理）<br>
                回满预估：<b style="color:#7fd4ff;">≈ ${repairNeed} 能源</b>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
                <button id="bpBack" class="bp-back" style="flex:1;">← 返回列表</button>
                <button id="bpRepair" class="bp-repair" style="flex:1;" ${hp >= maxHp ? 'disabled' : ''}>${hp >= maxHp ? '耐久已满' : `修 理（-${repairNeed} 能源）`}</button>
                ${this._recycleButtonHtml(e)}
            </div>`;
        this._bindDetailActions(det);
    },

    /** 1×1 方块墙详情：真实贴图、C级数值、真实建造成本与半价回收。 */
    _renderBlockDetail(det, e) {
        const maxHp = e.maxHp || (DEFENSE_CONFIG.covers.hp.C ?? 1600);
        const hp = Math.max(0, Math.ceil(e.hp));
        const buildCost = e._buildCost ?? BLOCK_WALL_COST;
        const repairRate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.coverHpPerEnergy) || 2;
        const repairNeed = Math.ceil((maxHp - hp) / repairRate);
        det.innerHTML = `
            ${renderBuildingDetailHeader({ texture: 'obstacle_block', name: '方块墙（C级数值）', hp, maxHp, status: '1×1 菱形格防线' })}
            <div style="font-size:13px;font-weight:700;color:#ffd700;margin:2px 0 6px;">特殊功能 · 阻挡与防线构建</div>
            <div class="bp-detail-rows">
                占地：<b>1×1 菱形格</b><br>
                建造消耗：<b style="color:#7fd4ff;">${buildCost} 能源</b><br>
                修理费率：<b>${repairRate} 耐久 / 1 能源</b><br>
                回满预估：<b style="color:#7fd4ff;">≈ ${repairNeed} 能源</b>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
                <button id="bpBack" class="bp-back">← 返回列表</button>
                <button id="bpRepair" class="bp-repair" ${hp >= maxHp ? 'disabled' : ''}>${hp >= maxHp ? '耐久已满' : `修 理（-${repairNeed} 能源）`}</button>
                ${this._recycleButtonHtml(e)}
            </div>`;
        this._bindDetailActions(det);
    },

    /** 城墙楼梯详情：整组段数、目标高度、建造成本与修理。 */
    _renderWallStairDetail(det, e) {
        const maxHp = e.maxHp || WALL_STAIR_CONFIG.hpPerSegment * (e.segmentCount || 2);
        const hp = Math.max(0, Math.ceil(e.hp));
        const buildCost = e._buildCost ?? WALL_STAIR_CONFIG.costPerSegment * (e.segmentCount || 2);
        const repairRate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.coverHpPerEnergy) || 2;
        const repairNeed = Math.ceil((maxHp - hp) / repairRate);
        det.innerHTML = `
            ${renderBuildingDetailHeader({ texture: e.visualSegments?.[0]?.texture || e.spriteCfg?.idleKey, name: WALL_STAIR_CONFIG.name, hp, maxHp, status: '连接地面与城墙顶面' })}
            <div style="font-size:13px;font-weight:700;color:#ffd700;margin:2px 0 6px;">特殊功能 · 自动延伸至墙顶</div>
            <div class="bp-detail-rows">
                占地：<b>${e.segmentCount || 2} 段 × 每段1×1格</b><br>
                到达高度：<b>${Math.round(e.targetTopZ || e.platformHeight || 0)}</b><br>
                每段抬升：<b>${Math.round(e.risePerSegment || WALL_STAIR_CONFIG.risePerSegment)}</b><br>
                建造消耗：<b style="color:#7fd4ff;">${buildCost} 能源</b><br>
                修理费率：<b>${repairRate} 耐久 / 1 能源</b>（点击下方按钮修理）<br>
                回满预估：<b style="color:#7fd4ff;">≈ ${repairNeed} 能源</b>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
                <button id="bpBack" class="bp-back" style="flex:1;">← 返回列表</button>
                <button id="bpRepair" class="bp-repair" style="flex:1;" ${hp >= maxHp ? 'disabled' : ''}>${hp >= maxHp ? '耐久已满' : `修 理（-${repairNeed} 能源）`}</button>
                ${this._recycleButtonHtml(e)}
            </div>`;
        this._bindDetailActions(det);
    },

    /** 门详情（2026-08-15）：耐久/消耗/修理 + 常锁门/常开门模式按钮（当前模式金框高亮） */
    _renderGateDetail(det, e) {
        const g = e.grade || 'D';
        const maxHp = e.maxHp || 1;
        const hp = Math.max(0, Math.ceil(e.hp));
        const buildCost = e._buildCost ?? Math.round((DEFENSE_CONFIG.covers.hp[g] ?? 400) * 0.25);
        const repairRate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.coverHpPerEnergy) || 2;
        const repairNeed = Math.ceil((maxHp - hp) / repairRate);
        const mode = e.gateMode || 'auto';
        const modeTxt = mode === 'locked' ? '常锁（任何单位经过都不开）'
            : (mode === 'open' ? '常开（门口保持敞开）' : '自动（友军靠近开门）');
        const stateTxt = (e.state === 'open' || e.state === 'opening') ? '开启' : '关闭';
        det.innerHTML = `
            ${renderBuildingDetailHeader({
                texture: e._isGate4 ? 'gate_4cell' : null,
                icon: '🚪',
                name: e._isGate4 ? '4格门（C级数值）' : (e.name || `铁栅栏门·${g}级`),
                hp,
                maxHp,
                status: `当前${stateTxt}`,
            })}
            <div style="font-size:13px;font-weight:700;color:#ffd700;margin:2px 0 6px;">特殊功能 · 门控与通行模式</div>
            <div class="bp-detail-rows">
                建造消耗：<b style="color:#7fd4ff;">${buildCost} 能源</b><br>
                ${e._isGate4 ? '结构：<b>两端方块墙 + 中间双格栅栏</b><br>' : ''}
                修理费率：<b>${repairRate} 耐久 / 1 能源</b>（点击下方按钮修理）<br>
                回满预估：<b style="color:#7fd4ff;">≈ ${repairNeed} 能源</b><br>
                门模式：<b style="color:#ffd700;">${modeTxt}</b>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="bpGateLock" class="bp-mode-lock" style="flex:1;${mode === 'locked' ? 'outline:2px solid #ffd700;' : ''}">常锁门</button>
                <button id="bpGateOpen" class="bp-mode-open" style="flex:1;${mode === 'open' ? 'outline:2px solid #ffd700;' : ''}">常开门</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
                <button id="bpBack" class="bp-back" style="flex:1;">← 返回列表</button>
                <button id="bpRepair" class="bp-repair" style="flex:1;" ${hp >= maxHp ? 'disabled' : ''}>${hp >= maxHp ? '耐久已满' : `修 理（-${repairNeed} 能源）`}</button>
                ${this._recycleButtonHtml(e)}
            </div>`;
        this._bindDetailActions(det);
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

    _deductBuildCost(currency, amount) {
        if (!(amount > 0)) return true;
        const payment = CrossPlaneResourceSystem.pay({ [currency === 'gold' ? 'gold' : 'energy']: amount });
        this._lastBuildPayment = payment.ok ? payment : null;
        return payment.ok;
    },

    _refundLastBuildPayment() {
        if (!this._lastBuildPayment) return;
        CrossPlaneResourceSystem.refund(this._lastBuildPayment);
        this._lastBuildPayment = null;
    },

    _refundBuildCost(currency, amount) {
        if (!(amount > 0)) return;
        if (currency === 'gold') {
            if (GoldManager && typeof GoldManager.addGold === 'function') GoldManager.addGold(amount);
        } else if (EnergyManager && typeof EnergyManager.addEnergy === 'function') {
            EnergyManager.addEnergy(amount);
        }
    },

    /** 标记玩家放置建筑的真实成本，供详情真值与半价回收使用。 */
    _markBuiltEntity(entity, item, cost = item?.cost ?? 0) {
        if (!entity || !item) return entity;
        entity._builtByPlayer = true;
        entity._buildItemId = item.id;
        entity._buildCost = cost;
        entity._buildCurrency = item.currency || 'energy';
        entity._buildDisplayName = item.name;
        return entity;
    },

    _recycleTargets(entity) {
        const raw = Array.isArray(entity && entity._buildGroup) ? entity._buildGroup : [entity];
        return Array.from(new Set(raw.filter((e) => e && e.active)));
    },

    _recycleInfo(entity) {
        const targets = this._recycleTargets(entity);
        const hasProtectedWorldCore = targets.some((e) => e._isWorldPortalCore || e._isMainHubPortalBuilding);
        const recyclable = targets.length > 0 && !hasProtectedWorldCore
            && targets.every((e) => e._builtByPlayer);
        const currency = targets.find((e) => e._buildCurrency)?._buildCurrency || 'energy';
        const totalCost = targets.reduce((sum, e) => sum + (Number(e._buildCost) || 0), 0);
        const refund = targets.reduce((sum, e) => {
            const durability = Math.max(0, Math.min(1,
                Number(e.hp) / Math.max(1, Number(e.maxHp) || 1)));
            return sum + Math.floor((Number(e._buildCost) || 0) * 0.5 * durability);
        }, 0);
        return { targets, recyclable, currency, totalCost, refund };
    },

    _removeBuiltEntity(entity) {
        if (!entity) return;
        if (entity._isDefenseCover && typeof entity.removeFromCollision === 'function') {
            entity.removeFromCollision();
            DefenseSystem?.invalidateElevatedTopology?.();
        }
        if (entity._isCoverGate) {
            if (typeof entity._teardownCollision === 'function') entity._teardownCollision();
            if (DefenseSystem && Array.isArray(DefenseSystem.gates)) {
                const i = DefenseSystem.gates.indexOf(entity);
                if (i >= 0) DefenseSystem.gates.splice(i, 1);
            }
            if (DefenseSystem && DefenseSystem.gate === entity) DefenseSystem.gate = null;
        }
        if (entity._isWallStaircase && DefenseSystem && Array.isArray(DefenseSystem.staircases)) {
            const i = DefenseSystem.staircases.indexOf(entity);
            if (i >= 0) DefenseSystem.staircases.splice(i, 1);
            if (typeof entity._unregisterEdgeSegs === 'function') entity._unregisterEdgeSegs();
            for (const segment of entity.segments || []) segment.active = false;
            DefenseSystem.rebuildWallStairGroups?.();
            DefenseSystem.invalidateElevatedTopology?.();
        }
        if (entity._isDefenseTower && DefenseSystem && Array.isArray(DefenseSystem.towers)) {
            const i = DefenseSystem.towers.indexOf(entity);
            if (i >= 0) DefenseSystem.towers.splice(i, 1);
            if (DefenseSystem._panel?.isOpen && DefenseSystem._panel.tower === entity) {
                DefenseSystem._panel.close();
            }
        }
        entity.hittable = false;
        entity._sinking = true;
        if (EffectManager) {
            EffectManager.add(new BuildingSinkEffect(entity).start());
        } else if (typeof entity.destroy === 'function') {
            try { entity.destroy(); } catch { entity.active = false; }
        } else {
            entity.active = false;
        }
    },

    /** 详情面板半价回收玩家放置建筑；4格门按组件组整体回收。 */
    _recycleEntity(entity) {
        entity = entity && entity._buildGroupRoot && entity._buildGroupRoot.active
            ? entity._buildGroupRoot
            : entity;
        if (entity && typeof entity.sell === 'function'
            && (entity._isHamsterHut || entity._isHamsterBarracks || entity._isProducerBuilding)) {
            const currency = entity._buildCurrency === 'gold' ? 'gold' : 'energy';
            const result = entity.sell();
            if (!result?.ok) {
                this._notify(result?.reason || '该建筑无法回收', '#ff5555');
                return false;
            }
            this._detail = null;
            this._renderDetail();
            this._refreshCurrencies();
            if (Number.isFinite(Number(PRODUCER_BUILDINGS[entity.cfgKey]?.firstWhenNoneCost))) {
                this._renderBuildGrid();
            }
            const unit = currency === 'gold' ? '金币' : '能源';
            this._notify(`建筑已回收（+${result.refund || 0} ${unit}）`, '#ffd700');
            if (SoundManager && typeof SoundManager.playFile === 'function') {
                SoundManager.playFile('assets/sounds/ui/sell.wav');
            }
            return true;
        }
        const info = this._recycleInfo(entity);
        if (!entity || !info.recyclable) {
            this._notify('该建筑不可回收', '#ff8855');
            return false;
        }
        if (info.currency === 'energy' && (!EnergyManager || !EnergyManager.canStore(info.refund))) {
            this._notify('仓库空间不足，无法接收回收返还能源', '#ff5555');
            return false;
        }
        // 门先拆：destroy() 会恢复被门裁剪的墙段；随后再拆两端方块，避免幽灵碰撞段复活。
        const ordered = [
            ...info.targets.filter((e) => e._isCoverGate),
            ...info.targets.filter((e) => !e._isCoverGate),
        ];
        for (const target of ordered) this._removeBuiltEntity(target);
        this._refundBuildCost(info.currency, info.refund);
        const unit = info.currency === 'gold' ? '金币' : '能源';
        this._detail = null;
        this._renderDetail();
        this._refreshCurrencies();
        this._notify(`建筑已回收（+${info.refund} ${unit}）`, '#ffd700');
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return true;
    },

    /** 详情面板半价回收玩家放置建筑；4格门按组件组整体回收。 */
    _recycleBuilding() {
        this._recycleEntity(this._detail);
    },

    _recycleAt(wx, wy) {
        const entity = this._hitTestRecyclableEntity(wx, wy);
        if (entity) {
            this._recycleEntity(entity);
            return;
        }
        const road = BuildingRoadSystem.getManualRoadAt(wx, wy);
        if (!road) {
            this._notify('此处没有可回收的建筑或道路', '#ff8855');
            return;
        }
        const roadItem = BUILD_ITEMS.find((item) => item.kind === 'road');
        const paidCost = Number.isFinite(Number(road.buildCost)) && Number(road.buildCost) > 0
            ? Number(road.buildCost)
            : (road.refundable !== false ? Number(roadItem?.cost) || 0 : 0);
        const currency = road.buildCurrency === 'gold' ? 'gold' : 'energy';
        const refund = road.refundable === false ? 0 : Math.floor(paidCost * 0.5);
        if (currency === 'energy' && (!EnergyManager || !EnergyManager.canStore(refund))) {
            this._notify('仓库空间不足，无法接收回收返还能源', '#ff5555');
            return;
        }
        if (!BuildingRoadSystem.removeManualRoad(road.i, road.j)) {
            this._notify('道路回收失败', '#ff5555');
            return;
        }
        this._refundBuildCost(currency, refund);
        this._refreshCurrencies();
        const unit = currency === 'gold' ? '金币' : '能源';
        this._notify(`道路已回收（+${refund} ${unit}）`, '#ffd700');
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
    },

    _recycleButtonHtml(entity) {
        const info = this._recycleInfo(entity);
        const unit = info.currency === 'gold' ? '金' : '能';
        return `<button id="bpRecycle" class="bp-recycle"
            data-technology-gate-type="mechanic" data-technology-gate-id="building_recycle"
            style="background:#5a3028;color:#ffd7d0;border:1px solid #8a4a3a;border-radius:6px;padding:7px 4px;
            ${info.recyclable ? 'cursor:pointer;' : 'opacity:0.45;cursor:default;'}"
            ${info.recyclable ? '' : 'disabled'}>${info.recyclable ? `回收（+${info.refund}${unit}）` : '不可回收'}</button>`;
    },

    _bindDetailActions(det) {
        TechnologyGate.bindTree(det);
        const back = det.querySelector('#bpBack');
        const repair = det.querySelector('#bpRepair');
        const recycle = det.querySelector('#bpRecycle');
        if (back) back.addEventListener('click', () => this._closeDetail());
        if (repair) repair.addEventListener('click', () => this._repairCover());
        if (recycle) recycle.addEventListener('click', () => this._recycleBuilding());
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
                        cover._faceDepth = structureDepthAtY(
                            Math.max(cover._faceLine[0].y, cover._faceLine[1].y),
                            bias
                        );
                    } else if (!coverV && eV) {
                        // 新墙 = 右臂（h），已有 = 左臂（v）→ 左盖右（已有左臂 +0.5）
                        e._faceDepth = structureDepthAtY(
                            Math.max(e._faceLine[0].y, e._faceLine[1].y),
                            bias
                        );
                    }
                    return;
                }
            }
        }
    },

    _place(x, y) {
        const { item, mirror } = this._placing;
        if (!isBuildItemTechnologyUnlocked(item)) {
            this._notify('该建筑尚未通过科技解锁', '#ffb35c');
            this._cancelPlacement();
            return;
        }
        const buildBlock = this._buildItemBlockReason(item);
        if (buildBlock) {
            this._notify(buildBlock, '#ffb35c');
            this._cancelPlacement();
            this._syncBuildItemCards();
            return;
        }
        if (!this._canPlace(x, y)) {
            this._notify('该位置无法放置', '#ff5555');
            return;
        }
        // 货币扣费由建筑条目的 currency 决定。
        // 开发工具「无限资源」开启时建造不消耗能源/金币（2026-08-15）
        const free = !!(Game && Game._devInfiniteResources);
        const currency = item.currency === 'energy' ? 'energy' : 'gold';
        const staircaseSnap = item.kind === 'wall_staircase' ? this._snapped : null;
        const buildCost = staircaseSnap?.cost ?? this._baseBuildCost(item);
        const payOk = free || this._deductBuildCost(currency, buildCost);
        if (!payOk) {
            this._notify(currency === 'energy' ? '能源不足（攻击资源点采集）' : '金币不足', '#ff5555');
            this._syncBuildItemCards();
            return;
        }
        const id = `built_${item.id}_${++this._seq}`;
        let placedEntity = null;
        try {
            if (item.kind === 'tower') {
                const tower = this._markBuiltEntity(new DefenseTower(x, y, { id }), item);
                tower._mirrored = mirror;
                Game.entities.set(id, tower);
                DefenseSystem.towers.push(tower);
                placedEntity = tower;
            } else if (item.kind === 'hamster_hut') {
                const hut = this._markBuiltEntity(new HamsterHut(x, y, { id }), item);
                hut._facingLeft = mirror;
                Game.entities.set(id, hut);
                HamsterHutSystem.huts.push(hut);
                placedEntity = hut;
            } else if (item.kind === 'hamster_barracks') {
                const barracks = this._markBuiltEntity(new HamsterBarracks(x, y, { id }), item);
                barracks._facingLeft = mirror;
                Game.entities.set(id, barracks);
                HamsterBarracksSystem.barracks.push(barracks);
                placedEntity = barracks;
            } else if (item.kind === 'producer') {
                const producer = this._markBuiltEntity(
                    new ProducerBuilding(x, y, { id, cfgKey: item.id }),
                    item,
                    buildCost
                );
                producer._facingLeft = mirror;
                Game.entities.set(id, producer);
                ProducerBuildingSystem.buildings.push(producer);
                placedEntity = producer;
            } else if (item.kind === 'gate') {
                const gate = this._markBuiltEntity(new BuildableGate(x, y, {
                    grade: item.grade,
                    orient: item.orient,
                    mirror,
                    id,
                }), item);
                Game.entities.set(id, gate);
                if (DefenseSystem && DefenseSystem.gates) DefenseSystem.gates.push(gate);
            } else if (item.kind === 'wall_staircase') {
                const snap = staircaseSnap;
                if (!snap || !snap.wall || !snap.segments?.length) {
                    throw new Error('城墙楼梯缺少有效墙体吸附');
                }
                const staircase = this._markBuiltEntity(new WallStaircase(x, y, {
                    dir: snap.dir,
                    ascendingSign: snap.ascendingSign,
                    mirror,
                    wall: snap.wall,
                    walls: snap.walls,
                    attachPoint: snap.attachPoint,
                    targetTopZ: snap.targetTopZ,
                    segmentCount: snap.segmentCount,
                    segments: snap.segments,
                    id,
                }), item, buildCost);
                Game.entities.set(id, staircase);
                if (DefenseSystem && DefenseSystem.staircases) {
                    DefenseSystem.staircases.push(staircase);
                    DefenseSystem.rebuildWallStairGroups?.();
                    DefenseSystem.invalidateElevatedTopology?.();
                }
            } else if (item.kind === 'gate4') {
                // 4 格门（2026-08-17）：2 石柱 + 2 格铁栅栏宽门
                const dir = (this._snapped && this._snapped.dir) || 'e2';
                this._placeGate4(x, y, dir);
            } else {
                const cover = this._markBuiltEntity(new DefenseCover(x, y, {
                    grade: item.grade,
                    orient: item.orient,
                    mirror,
                    block: item.kind === 'block',
                    id,
                }), item);
                Game.entities.set(id, cover);
                // 方块墙与旧式掩体墙都属于可行走墙面；放置后立即刷新拓扑，避免下一次
                // 楼梯吸附或路线规划仍读取建造前的外墙/连通分量。
                DefenseSystem.invalidateElevatedTopology?.();
                if (item.kind !== 'block') {
                    // 上夹角图层校正（2026-08-17）：手动摆放两堵墙在顶部交汇时，
                    // 左臂（v 向 "/"、TL 边）盖右臂（h 向 "\"、TR 边）——左墙在右墙之上
                    this._fixCoverCornerDepth(cover);
                }
            }
            if (placedEntity && usesBuildingRoads(item)) {
                BuildingRoadSystem.attach(placedEntity);
            }
        } catch (err) {
            if (!free) this._refundLastBuildPayment();
            console.error('[BuildingSystem] 建造失败:', err);
            this._notify('建造失败，资源已返还', '#ff5555');
            return;
        }
        const paidCost = free ? buildCost : (this._lastBuildPayment?.[currency] ?? buildCost);
        this._lastBuildPayment = null;
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        const cur = item.currency === 'energy' ? '能' : '金';
        this._notify(
            free ? `${item.name} 已放置（无限资源）` : `${item.name} 已放置（-${paidCost} ${cur}）`,
            item.currency === 'energy' ? '#7fd4ff' : '#ffd700'
        );
        // 清除建造位置重叠的散布障碍物（仙人掌/树等，2026-08-17 用户口径）：
        // 下达指令建筑的地方有树木/草类障碍物，建造后直接删除
        const clearRadius = item.kind === 'block'
            ? ONE_CELL_BUILDING_FOOT.clearRadius
            : isTwoByTwoBuildItem(item)
            ? TWO_BY_TWO_BUILDING_FOOT.clearRadius
            : (item.kind === 'cover' || item.kind === 'gate' ? 110 : 60);
        // 4 格门已按四个格心批量清除；其它建筑按自身中心清除。
        if (item.kind === 'wall_staircase' && staircaseSnap?.segments) {
            this._clearBuildZones(staircaseSnap.segments.map((segment) => ({
                x: segment.x,
                y: segment.y,
                radius: ONE_CELL_BUILDING_FOOT.clearRadius,
            })));
        } else if (isTwoByTwoBuildItem(item)) {
            const layout = placedEntity?._buildingRoadLayout || buildingRoadLayout(x, y);
            const clearCells = usesBuildingRoads(item) ? layout.reservationCells : layout.buildingCells;
            this._clearBuildZones(clearCells.map((cell) => ({
                x: cell.x,
                y: cell.y,
                radius: ONE_CELL_BUILDING_FOOT.clearRadius,
            })));
        } else if (item.kind !== 'gate4') {
            const zoneY = isTwoByTwoBuildItem(item) ? y + TWO_BY_TWO_BUILDING_FOOT.offY : y;
            this._clearBuildZones([{ x, y: zoneY, radius: clearRadius }]);
        }
        this._snapped = null;
        this._clearStairPreview();
        this._refreshCurrencies();
        if (item.kind === 'producer'
            && Number.isFinite(Number(PRODUCER_BUILDINGS[item.id]?.firstWhenNoneCost))) {
            this._renderBuildGrid();
        }
    },
};

// ==================== B 键全局监听（全部已接入世界）====================

if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyB') return;
        if (!Game || !Game.isRunning || !Game.player) return;
        if (Game._wallEditMode || Game._collisionEditMode) return;
        if (!SceneManager || !['scene8', 'scene9', 'scene10', 'scene11'].includes(SceneManager.currentScene)) return;
        if (UIState && Object.values(UIState._state).some(Boolean)) return; // 其他面板打开时不抢键
        e.preventDefault();
        BuildingSystem.toggle();
    }, true);
}
