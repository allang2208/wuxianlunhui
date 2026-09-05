// Strategic presentation only: never creates entities or advances world simulation.
import layout from '../../data/world-map-layout.json';
import { ARMY_FLAG_ATLAS_URL, ARMY_FLAG_ATLAS, PLAYER_ARMY_MARKER_ID, armyFlagFrame, SETTLER_PIECE_URL, SETTLER_PIECE } from './world-map-army-visuals.js';
import { SETTLEMENT_ATLAS_URL, SETTLEMENT_ATLAS, settlementFrame } from './world-map-settlement-visuals.js';
import { COMMAND_BADGE_URLS } from './world-map-command-feedback.js';
import { createArmyMotion } from './world-map-army-motion.js';
import motion from '../../data/world-map-command-feedback.json';
import { WORLD_MAP_LENSES } from './world-map-display.js';
import { WORLD_MAP_CELLS, worldMapInfo } from '../world/world-map-cells.js';
import { WorldMapTerrain, projectMapCell } from './world-map-terrain.js';
import { drawStrategicTerrainRules } from './world-map-terrain-rules.js';
import { MOUNTAIN_RELIEF_URL, drawMountainRelief } from './world-map-relief-visuals.js';
export { WORLD_MAP_PLANES, pickWorldMapEntryCell } from '../world/world-map-cells.js';

const ATLAS_URL = new URL('../../assets/ui/world-map/terrain-atlas.png', import.meta.url).href;
// Strategic orthographic contract: 55 degrees ABOVE the XY ground, camera on -Y,
// +Z up, zero roll. The Blender camera helper reads this same layout field.
// Elevation is baked into terrain/flags; do not change it as an independent UI tilt.
const SIN = Math.sin(layout.cameraElevationDegrees * Math.PI / 180);
const SQRT3 = Math.sqrt(3);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const armyMotion = createArmyMotion(motion);
const project = projectMapCell;
const validViewport = (view) => Number.isFinite(view?.center?.x) && Number.isFinite(view?.center?.y)
    && Number.isFinite(view?.zoom) && view.zoom > 0;

export class WorldMapView {
    constructor(canvas, { onSelect, onHover, onZoom, onLoadState, readCellCost, onHistory = () => {},
        onCellSelect = () => {}, onArmySelect = () => {}, onSiteSelect = () => {}, onCommand = () => {},
        onPointer = () => {}, readMarch = (unit) => ({ progress: unit.marchProgress || 0 }), readClock = () => 0 }) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.armyCanvas = document.createElement('canvas');
        this.armyCanvas.className = 'wm-army-canvas';
        this.armyCanvas.setAttribute('aria-hidden', 'true');
        canvas.after(this.armyCanvas);
        this.armyCtx = this.armyCanvas.getContext('2d');
        this.readMarch = readMarch; this.readClock = readClock;
        this.onSelect = onSelect;
        this.onHover = onHover;
        this.onZoom = onZoom;
        this.onHistory = onHistory;
        this.onLoadState = onLoadState;
        this.onCellSelect = onCellSelect;
        this.onArmySelect = onArmySelect;
        this.onSiteSelect = onSiteSelect;
        this.onCommand = onCommand;
        this.onPointer = onPointer;
        this.armies = [];
        this.armyRoute = [];
        this.routeStops = [];
        this._appendOrder = false;
        this.grid = true;
        this.lens = 'overview';
        this._viewHistory = [];
        this._hostileCells = new Set();
        this.mapInfo = worldMapInfo();
        this.cellCosts = new Map(WORLD_MAP_CELLS.map((cell) => [cell.id, readCellCost(cell)]));
        const multipliers = [...this.cellCosts.values()].map((cost) => cost.multiplier);
        this.costRange = { min: Math.min(...multipliers), max: Math.max(...multipliers) };
        this.selected = null;
        this.states = new Map();
        this.width = this.height = 0;
        this.scale = 1;
        this.offset = { x: 0, y: 0 };
        this.viewCenter = { x: 0, y: 0 };
        this._events = new AbortController();
        const options = { signal: this._events.signal };
        this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reducedMotion.addEventListener('change', () => { this._syncArmyAnimation(); this.invalidateArmies(); }, options);
        document.addEventListener('visibilitychange', () => { this._syncArmyAnimation(); this.invalidateArmies(); }, options);
        this.commandImages = Object.fromEntries(Object.entries(COMMAND_BADGE_URLS).map(([kind, url]) => {
            const image = new Image(); image.onload = () => this.invalidateArmies(); image.src = url;
            return [kind, image];
        }));
        canvas.addEventListener('pointerdown', (event) => this._down(event), options);
        canvas.addEventListener('pointermove', (event) => this._move(event), options);
        canvas.addEventListener('pointerup', (event) => this._up(event), options);
        canvas.addEventListener('pointercancel', () => { this._cancelDrag(); this.clearHover(); }, options);
        canvas.addEventListener('lostpointercapture', () => { this._cancelDrag(); this.clearHover(); }, options);
        canvas.addEventListener('pointerleave', () => {
            if (!this.drag) this.clearHover();
        }, options);
        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            const { x, y } = this._point(event);
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
            this.zoom(Math.exp(-clamp(delta, -240, 240) * .002), x, y);
        }, { ...options, passive: false });
        canvas.addEventListener('contextmenu', (event) => event.preventDefault(), options);
        window.addEventListener('blur', () => { this._appendOrder = false; this._cancelDrag(); this.clearHover(); }, options);
        const modifierChanged = (event) => {
            if (!['ShiftLeft', 'ShiftRight'].includes(event.code)) return;
            this._appendOrder = event.shiftKey;
            if (this._pointerPoint && !this.drag) this._hoverAt(this._pointerPoint);
        };
        window.addEventListener('keydown', modifierChanged, { ...options, capture: true });
        window.addEventListener('keyup', modifierChanged, { ...options, capture: true });
        this._resizeObserver = new ResizeObserver(() => this.resize());
        this._resizeObserver.observe(canvas.parentElement);
        const css = getComputedStyle(canvas);
        const color = (key) => css.getPropertyValue(`--bp-ui-${key}`).trim();
        const notice = (key) => css.getPropertyValue(`--bp-notice-${key}`).trim();
        this.colors = { background: color('black-soft'), text: color('white'), muted: color('text-muted'),
            line: color('line'), accent: color('accent-bright'), shell: color('charcoal'),
            friendly: notice('success'), hostile: notice('danger'), warning: notice('warning') };
        this.font = css.getPropertyValue('--bp-font-ui').trim() || 'sans-serif';
        this.fontSizes = { meta: css.getPropertyValue('--bp-type-meta').trim() };
        this.terrain = new WorldMapTerrain(() => this.invalidate(), this.cellCosts, this.colors.accent);
        this.cellById = this.terrain.cellById;
        this.bounds = this.terrain.bounds;
        this.resize();
        this.load();
    }

    load() {
        this._detachImage();
        this._detachReliefImage();
        this.ready = false;
        this._loadArmyFlags();
        this._loadSettlerArt();
        this._loadSettlementArt();
        this._loadReliefArt();
        this.onLoadState('loading');
        const image = new Image();
        this.image = image;
        image.onload = () => {
            if (this.disposed || image !== this.image) return;
            this.ready = true;
            this.terrain.bake(image, this.reliefReady ? this.reliefImage : null);
            this.onLoadState('ready');
            this.invalidate();
        };
        image.onerror = () => {
            if (this.disposed || image !== this.image) return;
            this.ready = false;
            this.onLoadState('error');
            this.terrain.bake(null, this.reliefReady ? this.reliefImage : null);
            this.invalidate();
        };
        image.src = ATLAS_URL;
    }

    _loadReliefArt() {
        const image = new Image();
        this.reliefImage = image;
        image.onload = () => {
            if (this.disposed || image !== this.reliefImage) return;
            this.reliefReady = true;
            this.terrain.bake(this.ready && this.image?.naturalWidth ? this.image : null, image);
            this.invalidate();
        };
        image.onerror = () => {
            if (this.disposed || image !== this.reliefImage) return;
            image.onload = image.onerror = null;
            this.reliefImage = null;
            this.reliefReady = false;
            // Vector mountains remain as the non-blocking fallback.
            this.terrain.bake(this.ready && this.image?.naturalWidth ? this.image : null, null);
            this.invalidate();
        };
        image.src = MOUNTAIN_RELIEF_URL;
    }

    _loadArmyFlags() {
        if (this.flagReady || this.flagImage) return;
        const image = new Image();
        this.flagImage = image;
        image.onload = () => {
            if (this.disposed || image !== this.flagImage) return;
            this.flagReady = true;
            this.invalidate();
        };
        image.onerror = () => {
            if (this.disposed || image !== this.flagImage) return;
            image.onload = image.onerror = null;
            this.flagImage = null;
            // Flag failure does not disable terrain, picking or command controls.
            this.invalidate();
        };
        image.src = ARMY_FLAG_ATLAS_URL;
    }

    _loadSettlerArt() {
        if (this.settlerImage) return;
        const image = this.settlerImage = new Image();
        image.onload = image.onerror = () => {
            if (!this.disposed && image === this.settlerImage) this.invalidateArmies();
        };
        image.src = SETTLER_PIECE_URL;
    }

    _loadSettlementArt() {
        if (this.settlementReady || this.settlementImage) return;
        const image = new Image();
        this.settlementImage = image;
        image.onload = () => {
            if (this.disposed || image !== this.settlementImage) return;
            this.settlementReady = true;
            this.invalidate();
        };
        image.onerror = () => {
            if (this.disposed || image !== this.settlementImage) return;
            image.onload = image.onerror = null;
            this.settlementImage = null;
            // Existing faction/status badges remain usable if the art is unavailable.
            this.invalidate();
        };
        image.src = SETTLEMENT_ATLAS_URL;
    }

    resize() {
        if (this.disposed) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const previous = this._pendingViewport || this.getViewport();
        this.width = rect.width;
        this.height = rect.height;
        // Bound the backing store to four million pixels, even on large/high-DPI displays.
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(4_000_000 / (this.width * this.height)));
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        this.armyCanvas.width = this.canvas.width; this.armyCanvas.height = this.canvas.height;
        const stage = this.canvas.parentElement;
        const topInset = Math.min(this.height * .25, 24 + (stage.querySelector('.wm-map-caption')?.offsetHeight || 0));
        // Reserve persistent controls, excluding the transient hover card so hovering never zooms.
        const bottomInset = Math.min(this.height * .45, 24 + (stage.querySelector('.wm-toolbar')?.offsetHeight || 44)
            + (stage.querySelector('.wm-lens-legend')?.offsetHeight || 0));
        this.viewCenter = { x: this.width / 2, y: (topInset + this.height - bottomInset) / 2 };
        this.fitScale = Math.max(1, Math.min((this.width - 48) / (this.bounds.right - this.bounds.left),
            (this.height - topInset - bottomInset - 12) / (this.bounds.bottom - this.bounds.top)));
        this._pendingViewport = null;
        // Preserve world-space center and relative zoom even when the panel changes size.
        if (previous) this.restoreViewport(previous);
        else this.fit(false);
        if (this._pendingFocus) {
            const { kind, id, options } = this._pendingFocus;
            this._pendingFocus = null;
            if (kind === 'cell') this.focusCell(id, options);
            else this.focusPlane(id, options);
        }
    }

    // Narrow panels must still be able to reach the readable detail level.
    get maxScale() { return Math.max(this.fitScale, Math.min(135, Math.max(64, this.fitScale * 4))); }

    get detailLevel() { return this.scale < 28 ? 'compact' : this.scale < 48 ? 'normal' : 'detail'; }

    getViewport() {
        if (!this.width || !this.height || !this.fitScale) return null;
        return { center: { x: (this.viewCenter.x - this.offset.x) / this.scale,
            y: (this.viewCenter.y - this.offset.y) / this.scale }, zoom: this.scale / this.fitScale };
    }

    restoreViewport(view) {
        if (!validViewport(view)) return false;
        if (!this.width || !this.height) { this._pendingViewport = view; return true; }
        this.scale = clamp(view.zoom * this.fitScale, this.fitScale * .65, this.maxScale);
        const padX = this.width / this.scale, padY = this.height / this.scale;
        this.offset = { x: this.viewCenter.x - clamp(view.center.x, this.bounds.left - padX, this.bounds.right + padX) * this.scale,
            y: this.viewCenter.y - clamp(view.center.y, this.bounds.top - padY, this.bounds.bottom + padY) * this.scale };
        this._clampPan();
        this._notifyZoom();
        this.invalidate();
        return true;
    }

    _navigateView(view, remember = true) {
        const previous = this.getViewport();
        if (!this.restoreViewport(view)) return;
        const current = this.getViewport();
        if (remember && previous && current && (Math.hypot(previous.center.x - current.center.x,
            previous.center.y - current.center.y) > .01 || Math.abs(previous.zoom - current.zoom) > .001)) {
            this._viewHistory.push(previous);
            this._viewHistory = this._viewHistory.slice(-8);
        }
        this.onHistory(this._viewHistory.length > 0);
    }

    fit(remember = true) {
        this._navigateView({ center: { x: (this.bounds.left + this.bounds.right) / 2,
            y: (this.bounds.top + this.bounds.bottom) / 2 }, zoom: 1 }, remember);
    }

    back() {
        const view = this._viewHistory.pop();
        if (view) this.restoreViewport(view);
        this.onHistory(this._viewHistory.length > 0);
    }

    getDisplayState() {
        return { mapKey: this.mapInfo.key, viewport: this.getViewport(), history: this._viewHistory.slice(), lens: this.lens, grid: this.grid };
    }

    restoreDisplayState(display) {
        if (!display) return;
        const sameMap = display.mapKey === this.mapInfo.key || (!display.mapKey && this.mapInfo.kind === 'legacy');
        if (sameMap) this.restoreViewport(display.viewport);
        this._viewHistory = sameMap && Array.isArray(display.history) ? display.history.filter(validViewport).slice(-8) : [];
        this.setLens(display.lens);
        this.setGrid(display.grid !== false);
        this.onHistory(this._viewHistory.length > 0);
    }

    setLens(lens) {
        this.lens = WORLD_MAP_LENSES.some((item) => item.id === lens) ? lens : 'overview';
        this.invalidate();
    }

    zoom(factor, x = this.viewCenter.x, y = this.viewCenter.y) {
        const old = this.scale;
        this.scale = clamp(old * factor, this.fitScale * .65, this.maxScale);
        this.offset.x = x - (x - this.offset.x) * this.scale / old;
        this.offset.y = y - (y - this.offset.y) * this.scale / old;
        this._clampPan();
        this._notifyZoom();
        this.invalidate();
    }

    pan(x, y) {
        this.offset.x += x;
        this.offset.y += y;
        this._clampPan();
        this.invalidate();
    }

    _clampPan() {
        const margin = Math.min(90, this.width / 4, this.height / 4);
        this.offset.x = clamp(this.offset.x, margin - this.bounds.right * this.scale, this.width - margin - this.bounds.left * this.scale);
        this.offset.y = clamp(this.offset.y, margin - this.bounds.bottom * this.scale, this.height - margin - this.bounds.top * this.scale);
    }

    _notifyZoom() { this.onZoom(Math.round(this.scale / this.fitScale * 100), this.detailLevel); }

    setGrid(visible) { this.grid = visible; this.invalidate(); }

    setState(states, selected) {
        const signature = JSON.stringify([states, selected]);
        if (signature === this._stateSignature) return;
        this._stateSignature = signature;
        this.states = new Map(states.map((state) => [state.id, state]));
        this.selected = selected;
        this.invalidate();
    }

    focusPlane(sceneId, { minScale = 0, remember = true } = {}) {
        if (!this.width || !this.height || !this.fitScale) {
            this._pendingFocus = { kind: 'plane', id: sceneId, options: { minScale, remember } };
            return;
        }
        let anchor = this.states.get(sceneId)?.entryCell;
        if (!anchor) {
            // 新局大陆位置由种子决定，未发现信标时只定位地貌区域，不使用旧305格锚点。
            const cells = this.terrain.cells.filter((cell) => cell.planeSceneId === sceneId);
            if (cells.length) anchor = {
                q: cells.reduce((sum, cell) => sum + cell.q, 0) / cells.length,
                r: cells.reduce((sum, cell) => sum + cell.r, 0) / cells.length,
            };
        }
        if (!anchor) { this.fit(remember); return; }
        const point = project(anchor.q, anchor.r);
        this._navigateView({ center: point, zoom: Math.max(this.scale, minScale) / this.fitScale }, remember);
    }

    setMapIntel(intel) {
        const signature = `${intel.mapKey}:${intel.revision}:${intel.exploredCellIds.length}:${intel.visibleCellIds.length}`;
        if (signature === this._mapIntelSignature) return;
        this._mapIntelSignature = signature;
        this._reconCells = new Set(intel.visibleCellIds);
        this.terrain.setFog(intel.exploredCellIds, intel.visibleCellIds, signature);
        this.invalidate();
    }

    setArmies(army, enemies, targetCellId, selectedArmyId = null, controlled = false, friendlies = [], controlledId = null) {
        const signature = JSON.stringify([army, enemies, targetCellId, selectedArmyId, controlled, friendlies, controlledId]);
        if (signature === this._armySignature) return;
        this._armySignature = signature;
        this.armies = [...(army ? [{ ...army, id: PLAYER_ARMY_MARKER_ID, friendly: true }] : []), ...friendlies.map((unit) => ({ ...unit, friendly: true })), ...enemies];
        this.controlledMarkerId = controlledId === army?.id ? PLAYER_ARMY_MARKER_ID : controlledId;
        const routeArmy = this.armies.find((unit) => unit.id === this.controlledMarkerId) || this.armies.find((unit) => unit.id === selectedArmyId && unit.friendly);
        this.routeArmyId = routeArmy?.id;
        this.armyRoute = routeArmy ? [routeArmy.cellId, ...(routeArmy.route || [])] : [];
        if (this.targetCellId !== targetCellId) this.invalidate();
        this.targetCellId = targetCellId;
        this.selectedArmyId = selectedArmyId;
        this.controlled = controlled;
        const hostileCells = enemies.map((enemy) => enemy.cellId).sort().join('|');
        if (hostileCells !== this._hostileSignature) {
            this._hostileSignature = hostileCells;
            this._hostileCells = new Set(enemies.map((enemy) => enemy.cellId));
            if (this.lens !== 'overview') this.invalidate();
        }
        const occupiedCells = this.armies.flatMap((unit) => [unit.cellId, unit.march?.toCellId]).filter(Boolean).sort().join('|');
        if (occupiedCells !== this._occupiedSignature) {
            this._occupiedSignature = occupiedCells;
            if (this.lens === 'terrain') this.invalidate();
        }
        this._syncArmyAnimation();
        this.invalidateArmies();
    }

    setPreview(preview) {
        const signature = JSON.stringify(preview);
        if (signature === this._previewSignature) return;
        this._previewSignature = signature;
        this.preview = preview;
        this.invalidateArmies();
    }

    setRouteStops(stops) {
        const signature = stops.join(';');
        if (signature === this._routeStopSignature) return;
        this._routeStopSignature = signature;
        this.routeStops = [...stops];
        this.invalidateArmies();
    }

    screenPoint(cellId) {
        const cell = this.cellById.get(cellId);
        return cell ? { x: this.offset.x + cell.x * this.scale, y: this.offset.y + cell.y * this.scale } : null;
    }

    _armyPoint(army) {
        const from = this.screenPoint(army.cellId), to = this.screenPoint(army.march?.toCellId);
        if (!from || !to) return from;
        const progress = clamp(this.readMarch(army)?.progress || 0, 0, 1);
        return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
    }

    _syncArmyAnimation() {
        clearInterval(this._armyTimer); this._armyTimer = null;
        if (this.disposed || document.hidden || this._reducedMotion.matches) return;
        const now = this.readClock();
        if (!this.armies.some((army) => armyMotion(army, now, this.readMarch(army)?.progress).animated)) return;
        this._lastArmyTime = now;
        this._armyTimer = setInterval(() => {
            const current = this.readClock();
            if (current === this._lastArmyTime) return;
            this._lastArmyTime = current;
            if (!this.armies.some((army) => armyMotion(army, current, this.readMarch(army)?.progress).animated)) {
                this._syncArmyAnimation(); this.invalidateArmies(); return;
            }
            const visible = this.armies.some((army) => {
                if (!armyMotion(army, current, this.readMarch(army)?.progress).animated) return false;
                const point = this._armyPoint(army);
                return point && point.x > -140 && point.x < this.width + 140 && point.y > -140 && point.y < this.height + 140;
            });
            if (visible) this.invalidateArmies();
        }, motion.armyFrameMs);
    }

    invalidateArmies() {
        if (this.disposed || this.armyFrame != null) return;
        this.armyFrame = requestAnimationFrame(() => { this.armyFrame = null; if (!this.disposed) this._drawArmyLayer(); });
    }

    _drawArmyLayer() {
        const ctx = this.armyCtx;
        if (!ctx || !this.width || !this.height) return;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        this._drawArmies();
        if (this._pointerPoint && !this.drag) this._hoverAt(this._pointerPoint);
    }

    _pick(point) {
        const contains = (box) => point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
        const army = this.armyLabels?.slice().reverse().find(contains);
        if (army) return { cell: this.cellById.get(army.cellId), armyId: army.id,
            enemyId: army.friendly ? null : army.id, friendly: army.friendly };
        const stop = this.routeLabels?.slice().reverse().find(contains);
        if (stop) return { cell: this.cellById.get(stop.cellId), routeStop: true };
        const site = this.siteLabels?.slice().reverse().find(contains);
        return { cell: site ? this.cellById.get(site.cellId) : this.hit(point.x, point.y), site: !!site };
    }

    _hoverAt(point) {
        this._pointerPoint = point;
        this.onPointer(point);
        const target = this._pick(point);
        target.append = this._appendOrder;
        const key = `${target.cell?.id || ''}/${target.armyId || ''}/${target.site || false}/${target.append}`;
        if (key === this._hoverKey) return;
        this._hoverKey = key;
        this.hovered = target.cell;
        this.onHover(target.cell, target);
        this.invalidate();
    }

    clearHover() {
        this._pointerPoint = null; this._hoverKey = null; this.hovered = null;
        this.onPointer(null); this.onHover(null);
        this.setPreview(null);
        this.invalidate();
    }

    setSettlements(sites, wars) {
        const signature = JSON.stringify([sites.map(({ id, cellId, kind, owner, status, name }) => ({ id, cellId, kind, owner, status, name })), wars.map((war) => war.targetId)]);
        if (signature === this._settlementSignature) return;
        this._settlementSignature = signature;
        this.settlements = sites;
        this.warTargets = new Set(wars.map((war) => war.targetId));
        this.invalidate();
    }

    focusCell(cellId, { minScale = 0, remember = true } = {}) {
        if (!this.width || !this.height || !this.fitScale) {
            this._pendingFocus = { kind: 'cell', id: cellId, options: { minScale, remember } };
            return;
        }
        const cell = this.cellById.get(cellId);
        if (!cell) return;
        this._navigateView({ center: { x: cell.x, y: cell.y }, zoom: Math.max(this.scale, minScale) / this.fitScale }, remember);
    }

    _point(event) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    _down(event) {
        if (![0, 2].includes(event.button) || this.drag) return;
        if (event.button === 2) { event.preventDefault(); event.stopPropagation(); }
        this.clearHover();
        const point = this._point(event);
        this.canvas.focus({ preventScroll: true });
        this.drag = { id: event.pointerId, button: event.button, start: point, previous: point, moved: false };
        this.canvas.setPointerCapture(event.pointerId);
    }

    _move(event) {
        this._appendOrder = event.shiftKey;
        const point = this._point(event);
        if (this.drag) {
            if (event.pointerId !== this.drag.id) return;
            const drag = this.drag;
            if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 6) {
                drag.moved = true;
                if (drag.button === 0) this.canvas.classList.add('is-dragging');
            }
            if (drag.moved && drag.button === 0) this.pan(point.x - drag.previous.x, point.y - drag.previous.y);
            drag.previous = point;
            return;
        }
        this._hoverAt(point);
    }

    _up(event) {
        if (!this.drag || this.drag.id !== event.pointerId || this.drag.button !== event.button) return;
        const { moved, button } = this.drag;
        const point = this._point(event);
        this._cancelDrag();
        if (button === 2) { event.preventDefault(); event.stopPropagation(); }
        if (!moved && point.x >= 0 && point.x <= this.width && point.y >= 0 && point.y <= this.height) {
            const target = this._pick(point), cell = target.cell;
            if (button === 2) {
                if (target.friendly && !event.shiftKey && !(target.armyId === PLAYER_ARMY_MARKER_ID
                    && this.controlledMarkerId && this.controlledMarkerId !== PLAYER_ARMY_MARKER_ID)) this.onArmySelect(target.armyId);
                else if (cell) this.onCommand(cell, target.enemyId || null, { append: event.shiftKey });
                return;
            }
            if (target.armyId) { this.onArmySelect(target.armyId); return; }
            if (target.routeStop) { this.onCellSelect(cell); return; }
            if (target.site) { this.onSiteSelect(cell); return; }
            const id = cell && Array.from(this.states.values()).find((state) => state.entryCell?.id === cell.id)?.id;
            if (id) { this.onSelect(id); return; }
            if (cell) this.onCellSelect(cell);
        }
    }

    _cancelDrag() {
        const id = this.drag?.id;
        this.drag = null;
        this.canvas.classList.remove('is-dragging');
        if (id != null && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    }

    hit(x, y) {
        const wx = (x - this.offset.x) / this.scale;
        const wy = -(y - this.offset.y) / (this.scale * SIN);
        const r = wy / 1.5, q = wx / SQRT3 - r / 2, s = -q - r;
        let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
        const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
        if (dq > dr && dq > ds) rq = -rr - rs;
        else if (dr > ds) rr = -rq - rs;
        return this.cellById.get(`${rq},${rr}`) || null;
    }

    invalidate() {
        if (this.disposed || this.frame != null) return;
        this.frame = requestAnimationFrame(() => { this.frame = null; if (!this.disposed) this.draw(); });
    }

    _hex(cell, ctx = this.ctx) {
        const x = this.offset.x + cell.x * this.scale, y = this.offset.y + cell.y * this.scale;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (30 + i * 60) * Math.PI / 180;
            const px = x + Math.cos(a) * this.scale, py = y - Math.sin(a) * this.scale * SIN;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    draw() {
        const ctx = this.ctx;
        if (!ctx || !this.width || !this.height) return;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = this.colors.background;
        ctx.fillRect(0, 0, this.width, this.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const a = layout.atlas, factor = this.scale / a.pixelsPerWorldUnit, frame = a.frameSize * factor;
        const overview = this.terrain.isOverview(this.scale, this.width, this.height);
        const visible = overview ? [] : this.terrain.visible(this.offset, this.scale, this.width, this.height);
        if (overview) this.terrain.draw(ctx, this.offset, this.scale);
        // Fill ground first, then relief back-to-front. No mirroring of baked lighting.
        for (const cell of visible) {
            this._hex(cell); ctx.fillStyle = layout.biomes[cell.biome].baseColor; ctx.fill();
        }
        if (this.ready) for (const cell of visible) {
            const tile = layout.tiles[cell.tile];
            ctx.drawImage(this.image, tile.x, tile.y, a.frameSize, a.frameSize,
                this.offset.x + cell.x * this.scale - a.anchorPx[0] * factor,
                this.offset.y + cell.y * this.scale - a.anchorPx[1] * factor, frame, frame);
        }
        for (const cell of visible) drawStrategicTerrainRules(ctx, cell,
            this.offset.x + cell.x * this.scale, this.offset.y + cell.y * this.scale, this.scale,
            { drawMountain: !this.reliefReady });
        if (this.reliefReady) for (const cell of visible) drawMountainRelief(ctx, this.reliefImage, cell,
            this.offset.x + cell.x * this.scale, this.offset.y + cell.y * this.scale, this.scale);
        // Far overlays visit actual points of interest, not every terrain cell.
        const overlayCells = overview ? [...new Set([...(this.settlements || []).map((site) => site.cellId),
            ...this._hostileCells])].map((id) => this.cellById.get(id)).filter(Boolean) : visible;
        this._drawLens(overlayCells.filter((cell) => this.terrain.exploredCells.has(cell.id)), overview);
        for (const id of this._reconCells || []) {
            const cell = this.cellById.get(id);
            if (!cell) continue;
            this._hex(cell);
            ctx.fillStyle = 'rgba(90, 192, 193, 0.09)'; ctx.fill();
            ctx.strokeStyle = 'rgba(111, 209, 205, 0.38)'; ctx.lineWidth = 1; ctx.stroke();
        }
        this.terrain.drawFog(ctx, this.offset, this.scale, overview ? null : visible);
        const selectedEntry = this.states.get(this.selected)?.entryCell;
        if (this.grid) for (const cell of visible) {
            this._hex(cell); ctx.strokeStyle = this.colors.line; ctx.lineWidth = .7; ctx.stroke();
        }
        const selectedCell = this.cellById.get(selectedEntry?.id);
        if (selectedCell) {
            this._hex(selectedCell); ctx.fillStyle = this.colors.accent; ctx.globalAlpha = .16; ctx.fill(); ctx.globalAlpha = 1;
            ctx.strokeStyle = this.colors.accent; ctx.lineWidth = 2.5; ctx.stroke();
        }
        if (this.hovered) { this._hex(this.hovered); ctx.strokeStyle = this.colors.accent; ctx.lineWidth = 1.6; ctx.stroke(); }
        this._drawSettlements();
        this._drawArmyLayer();
        ctx.textAlign = 'left';
        if (this._pointerPoint && !this.drag) this._hoverAt(this._pointerPoint);
    }

    _drawLens(visible, overview = false) {
        const ctx = this.ctx, sites = new Map((this.settlements || []).map((site) => [site.cellId, site]));
        const occupied = new Set(this.armies.flatMap((unit) => [unit.cellId, unit.march?.toCellId]));
        ctx.save();
        if (this.lens !== 'overview') {
            ctx.fillStyle = this.colors.shell; ctx.globalAlpha = this.lens === 'terrain' ? .38 : .18;
            ctx.fillRect(0, 0, this.width, this.height); ctx.globalAlpha = 1;
        }
        if (overview && this.lens === 'terrain') this.terrain.draw(ctx, this.offset, this.scale, true);
        for (const cell of visible) {
            const site = sites.get(cell.id), besieged = site && this.warTargets?.has(site.id);
            const hostile = this._hostileCells.has(cell.id) || (site?.owner === 'enemy' && site.status !== 'destroyed');
            if (this.lens === 'terrain' && !overview) {
                const cost = this.cellCosts.get(cell.id);
                const intensity = (cost.multiplier - this.costRange.min) / (this.costRange.max - this.costRange.min || 1);
                this._hex(cell); ctx.fillStyle = this.colors.accent; ctx.globalAlpha = .08 + intensity * .36; ctx.fill(); ctx.globalAlpha = 1;
                // City/army markers and their current edge take priority over terrain labels.
                if (this.detailLevel !== 'compact' && !site && !occupied.has(cell.id)) {
                    const p = this.screenPoint(cell.id);
                    const text = this.detailLevel === 'detail' ? `${Number(cost.hours.toFixed(2))}时` : `×${cost.multiplier}`;
                    ctx.font = `700 ${this.fontSizes.meta} ${this.font}`; ctx.textAlign = 'center';
                    const w = ctx.measureText(text).width + 8;
                    ctx.fillStyle = this.colors.shell; ctx.fillRect(p.x - w / 2, p.y - 10, w, 20);
                    ctx.fillStyle = this.colors.text; ctx.fillText(text, p.x, p.y + 4);
                }
            } else if ((this.lens === 'military' && hostile) || (this.lens === 'bases' && site?.owner === 'player')) {
                this._hex(cell); ctx.fillStyle = hostile ? this.colors.hostile : this.colors.friendly;
                ctx.globalAlpha = .22; ctx.fill(); ctx.globalAlpha = 1;
                ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2; ctx.stroke();
            }
            // A lens never conceals a war or claims that an unmarked cell is safe.
            if (besieged) {
                this._hex(cell); ctx.strokeStyle = this.colors.warning; ctx.lineWidth = 2.5; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
            }
        }
        ctx.restore();
    }

    _fitLabel(text, width) {
        const chars = Array.from(text);
        if (this.ctx.measureText(text).width <= width) return text;
        while (chars.length && this.ctx.measureText(`${chars.join('')}…`).width > width) chars.pop();
        return `${chars.join('')}…`;
    }

    _drawSettlements() {
        const ctx = this.ctx;
        this.siteLabels = [];
        // Native models share the terrain camera and sort by their ground position.
        const ordered = (this.settlements || []).slice().sort((a, b) =>
            (this.cellById.get(a.cellId)?.y || 0) - (this.cellById.get(b.cellId)?.y || 0) || a.id.localeCompare(b.id));
        for (const site of ordered) {
            const cell = this.cellById.get(site.cellId);
            if (!cell) continue;
            const x = this.offset.x + cell.x * this.scale, y = this.offset.y + cell.y * this.scale;
            const frame = settlementFrame(site, cell);
            const display = SETTLEMENT_ATLAS.display[site.kind];
            const size = frame ? clamp(this.scale * display.scale, display.min, display.max) : 0;
            const drawArt = frame && this.settlementReady;
            const left = x - SETTLEMENT_ATLAS.anchor[0] * size;
            const top = y - SETTLEMENT_ATLAS.anchor[1] * size;
            const compact = this.detailLevel === 'compact';
            const labelY = y + Math.max(compact ? 8 : 16, drawArt ? (frame.bounds[3] - SETTLEMENT_ATLAS.anchor[1]) * size + 4 : 8);
            const besieged = this.warTargets.has(site.id);
            const kind = site.status === 'destroyed' ? '墟' : site.kind === 'world' ? '基' : site.kind === 'outpost' ? '据' : '城';
            const inspected = cell.id === this.hovered?.id || cell.id === this.targetCellId;
            const showName = !compact && (inspected || this.detailLevel === 'detail' && ['overview', 'bases'].includes(this.lens));
            const showStatus = !compact && (this.lens === 'bases' || inspected);
            const ownership = site.owner === 'player' ? '我方' : site.owner === 'enemy' ? '敌方' : '无主';
            const label = compact ? (besieged ? '战' : kind) : `${showStatus ? ownership : ''}${kind}${besieged ? ' · 战' : ''}`;
            ctx.font = `700 ${this.fontSizes.meta} ${this.font}`;
            const name = showName ? this._fitLabel(site.name || label, Math.max(48, Math.min(164, this.scale * 1.6)) - 12) : '';
            const w = Math.max(ctx.measureText(label).width, name ? ctx.measureText(name).width : 0) + (compact ? 10 : 14);
            const labelHeight = name ? 40 : compact ? 20 : 24;
            // Pick only the rendered footprint and compact badge, excluding atlas padding.
            const hitLeft = Math.min(x - w / 2, drawArt ? left + frame.bounds[0] * size : x - w / 2);
            const hitTop = Math.min(labelY, drawArt ? top + frame.bounds[1] * size : labelY);
            const hitRight = Math.max(x + w / 2, drawArt ? left + frame.bounds[2] * size : x + w / 2);
            const hitBottom = Math.max(labelY + labelHeight, drawArt ? top + frame.bounds[3] * size : labelY + labelHeight);
            if (hitRight < 0 || hitLeft > this.width || hitBottom < 0 || hitTop > this.height) continue;
            if (drawArt) {
                const sourceSize = SETTLEMENT_ATLAS.frameSize;
                ctx.drawImage(this.settlementImage, frame.column * sourceSize, frame.row * sourceSize,
                    sourceSize, sourceSize, left, top, size, size);
            }
            ctx.fillStyle = this.colors.shell; ctx.fillRect(x - w / 2, labelY, w, labelHeight);
            ctx.strokeStyle = besieged ? this.colors.warning : site.status === 'destroyed' ? this.colors.muted : site.owner === 'player' ? this.colors.friendly : site.owner === 'enemy' ? this.colors.hostile : this.colors.muted;
            ctx.lineWidth = 1.5; ctx.strokeRect(x - w / 2, labelY, w, labelHeight);
            ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'center';
            if (name) { ctx.fillStyle = this.colors.text; ctx.fillText(name, x, labelY + 15); ctx.fillStyle = ctx.strokeStyle; }
            ctx.fillText(label, x, labelY + (name ? 32 : 15));
            this.siteLabels.push({ x: hitLeft, y: hitTop, w: hitRight - hitLeft, h: hitBottom - hitTop, cellId: site.cellId });
        }
    }

    _drawArmies() {
        const ctx = this.armyCtx, now = this.readClock();
        const screen = (id) => {
            const cell = this.cellById.get(id);
            return cell ? { x: this.offset.x + cell.x * this.scale, y: this.offset.y + cell.y * this.scale } : null;
        };
        const position = (army) => this._armyPoint(army);
        ctx.strokeStyle = this.colors.accent; ctx.lineWidth = 3;
        ctx.globalAlpha = this.preview?.ok ? .3 : 1;
        ctx.beginPath();
        this.armyRoute.forEach((id, index) => {
            const leader = index === 0 && this.armies.find((army) => army.id === this.routeArmyId);
            const p = leader ? position(leader) : screen(id);
            if (p) index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (this.preview) {
            const previewColor = !this.preview.ok ? this.colors.warning : this.preview.kind === 'attack' ? this.colors.hostile : this.colors.accent;
            const leader = this.armies.find((army) => army.id === this.routeArmyId);
            if (this.preview.ok && leader) {
                ctx.strokeStyle = previewColor; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
                ctx.beginPath();
                const start = position(leader);
                if (start) ctx.moveTo(start.x, start.y);
                this.preview.route.forEach((id) => { const p = screen(id); if (p) ctx.lineTo(p.x, p.y); });
                ctx.stroke(); ctx.setLineDash([]);
            }
            const end = this.cellById.get(this.preview.cellId);
            if (end) {
                this._hex(end, ctx); ctx.strokeStyle = previewColor; ctx.lineWidth = 3; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
                if (!this.preview.ok) {
                    const p = screen(end.id);
                    ctx.beginPath(); ctx.moveTo(p.x - 7, p.y - 7); ctx.lineTo(p.x + 7, p.y + 7);
                    ctx.moveTo(p.x + 7, p.y - 7); ctx.lineTo(p.x - 7, p.y + 7); ctx.stroke();
                }
            }
        }
        const movingLeader = this.armies.find((army) => army.id === this.routeArmyId && army.march);
        if (movingLeader) {
            const from = position(movingLeader), to = screen(movingLeader.march.toCellId);
            if (from && to) {
                ctx.strokeStyle = this.colors.text; ctx.lineWidth = 4; ctx.beginPath();
                ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
                ctx.fillStyle = this.colors.text; ctx.fillRect(to.x - 3, to.y - 3, 6, 6);
            }
        }
        const target = this.cellById.get(this.targetCellId);
        if (target) { this._hex(target, ctx); ctx.strokeStyle = this.colors.accent; ctx.lineWidth = 3; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]); }
        this._drawRouteStops();
        this.armyLabels = [];
        const groups = new Map();
        for (const army of this.armies) {
            if (!groups.has(army.cellId)) groups.set(army.cellId, []);
            groups.get(army.cellId).push(army.id);
        }
        for (const ids of groups.values()) ids.sort();
        // Ground position determines depth; selected markers are picked/drawn last.
        const ordered = this.armies.slice().sort((a, b) => Number(a.id === this.selectedArmyId) - Number(b.id === this.selectedArmyId)
            || (position(a)?.y || 0) - (position(b)?.y || 0) || a.id.localeCompare(b.id));
        const compact = this.detailLevel === 'compact';
        const size = compact ? 32 : clamp(this.scale * 2.1, 56, 112);
        for (const army of ordered) {
            const p = position(army);
            if (!p) continue;
            const visual = armyMotion(army, now, this.readMarch(army)?.progress, this._reducedMotion.matches);
            const ids = groups.get(army.cellId);
            const offset = (ids.indexOf(army.id) - (ids.length - 1) / 2) * (compact ? 30 : size * .53);
            const x = p.x + offset, y = p.y - 3;
            if (x < -size || y < -size || x > this.width + size || y > this.height + size) continue;
            const controlled = army.id === this.controlledMarkerId && this.controlled;
            const selected = controlled || army.id === this.selectedArmyId;
            const factionColor = army.friendly ? this.colors.friendly : this.colors.hostile;
            if (offset) {
                ctx.strokeStyle = factionColor; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x, y); ctx.stroke();
            }
            // A ground circle follows the map projection; the readable banner keeps its authored pose.
            const groundRadius = selected ? 18 : 13;
            ctx.beginPath(); ctx.ellipse(x, y, groundRadius, groundRadius * SIN, 0, 0, Math.PI * 2);
            ctx.fillStyle = this.colors.shell; ctx.fill();
            ctx.strokeStyle = selected ? this.colors.text : factionColor;
            if (selected && !controlled) ctx.setLineDash([3, 3]);
            ctx.lineWidth = selected ? 2.5 : 1.5; ctx.stroke();
            ctx.setLineDash([]);
            if (['arrived', 'entering', 'battle'].includes(visual.state)) {
                ctx.strokeStyle = visual.state === 'battle' ? this.colors.hostile : this.colors.friendly;
                ctx.globalAlpha = visual.pulse; ctx.lineWidth = 2;
                const radius = (compact ? 18 : 24) + visual.pulse * (compact ? 4 : 7);
                ctx.beginPath(); ctx.ellipse(x, y, radius, radius * SIN, 0, 0, Math.PI * 2); ctx.stroke();
                ctx.globalAlpha = 1;
            }
            const isSettler = army.kind === 'settler';
            const token = isSettler ? '移' : army.kind === 'convoy' ? '粮' : army.kind === 'detachment' ? `军${army.id.split('_')[1]}` : army.friendly ? '我' : army.objective ? '守' : '敌';
            ctx.font = `700 ${this.fontSizes.meta} ${this.font}`; ctx.textAlign = 'center';
            if (compact) {
                ctx.fillStyle = factionColor; ctx.fillText(token, x, y + 4);
                if (visual.badge) {
                    const badge = this.commandImages[visual.badge];
                    ctx.fillStyle = this.colors.shell; ctx.fillRect(x + 7, y - 27, 20, 20);
                    if (badge?.complete && badge.naturalWidth) ctx.drawImage(badge, x + 8, y - 26, 18, 18);
                    else { ctx.fillStyle = this.colors.warning; ctx.fillText(visual.badge === 'attack' ? '战' : visual.badge === 'enter' ? '入' : '!', x + 17, y - 12); }
                }
                // Compact picks follow compact ink, never the invisible full-sized flag.
                this.armyLabels.push({ id: army.id, friendly: army.friendly, cellId: army.cellId, x: x - 18, y: y - (visual.badge ? 28 : 18),
                    w: visual.badge ? 46 : 36, h: visual.badge ? 46 : 36 });
                continue;
            }
            const art = isSettler ? SETTLER_PIECE : ARMY_FLAG_ATLAS;
            const left = x - art.anchor[0] * size;
            const top = y - art.anchor[1] * size;
            const frame = isSettler ? SETTLER_PIECE : armyFlagFrame(army), sourceSize = ARMY_FLAG_ATLAS.frameSize;
            if (isSettler && this.settlerImage?.complete && this.settlerImage.naturalWidth) {
                ctx.save(); ctx.translate(x, y); ctx.rotate(visual.rotation);
                ctx.drawImage(this.settlerImage, left - x, top - y, size, size);
                ctx.restore();
            } else if (!isSettler && this.flagReady) {
                ctx.save(); ctx.translate(x, y); ctx.rotate(visual.rotation);
                ctx.drawImage(this.flagImage, frame.column * sourceSize, frame.row * sourceSize, sourceSize, sourceSize, left - x, top - y, size, size);
                ctx.restore();
            } else {
                // Readable banner silhouette while loading or after a failed image request.
                ctx.strokeStyle = factionColor; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 12, y - 49); ctx.stroke();
                ctx.fillStyle = factionColor;
                ctx.beginPath(); ctx.moveTo(x - 11, y - 47); ctx.lineTo(x + 17, y - 43);
                ctx.lineTo(x + 12, y - 23); ctx.lineTo(x - 11, y - 27); ctx.fill();
            }
            const stateName = { moving: '行军', hold: '驻留', arrived: '抵达', entering: '入营', battle: '接战', blocked: '受阻', defeated: '战败' }[visual.state];
            const label = this.lens === 'military' && this.detailLevel === 'detail' ? `${token} · ${stateName}` : token;
            const labelWidth = ctx.measureText(label).width + 10;
            ctx.fillStyle = this.colors.shell; ctx.fillRect(x - labelWidth / 2, y + 3, labelWidth, 17);
            ctx.fillStyle = factionColor; ctx.fillText(label, x, y + 16);
            const badge = this.commandImages[visual.badge], bx = x + size * .25, by = y - size * .67;
            if (visual.badge) {
                ctx.fillStyle = this.colors.shell; ctx.beginPath(); ctx.arc(bx + 11, by + 11, 13, 0, Math.PI * 2); ctx.fill();
                if (badge?.complete && badge.naturalWidth) ctx.drawImage(badge, bx, by, 22, 22);
                else { ctx.fillStyle = this.colors.warning; ctx.fillText(visual.badge === 'attack' ? '战' : visual.badge === 'enter' ? '入' : '!', bx + 11, by + 16); }
            }
            // Alpha bounds exclude empty atlas padding. The badge remains clickable too.
            const b = frame.bounds;
            const hitLeft = Math.min(left + b[0] * size, x - 12, x - labelWidth / 2) - 2;
            const hitTop = Math.min(top + b[1] * size, y - 49) - 2;
            this.armyLabels.push({ id: army.id, friendly: army.friendly, cellId: army.cellId, x: hitLeft, y: hitTop,
                w: Math.max(left + b[2] * size + 2, x + 18, x + labelWidth / 2, visual.badge ? bx + 24 : x) - hitLeft,
                h: Math.max(top + b[3] * size + 2, y + 20) - hitTop });
        }
    }

    _drawRouteStops() {
        const ctx = this.armyCtx;
        const stops = this.preview?.ok ? (this.preview.stops || []).map((stop) => stop.cellId) : this.routeStops;
        const groups = new Map();
        stops.forEach((id, index) => { if (!groups.has(id)) groups.set(id, []); groups.get(id).push(index + 1); });
        this.routeLabels = [];
        ctx.save();
        ctx.font = `700 ${this.fontSizes.meta} ${this.font}`; ctx.textAlign = 'center';
        for (const [cellId, indices] of groups) {
            const point = this.screenPoint(cellId);
            if (!point) continue;
            const label = indices.join('·'), w = Math.max(24, ctx.measureText(label).width + 10);
            const x = point.x + this.scale * .4, y = point.y - this.scale * .4 - 12;
            if (x + w / 2 < 0 || x - w / 2 > this.width || y + 24 < 0 || y > this.height) continue;
            ctx.fillStyle = this.colors.shell; ctx.fillRect(x - w / 2, y, w, 24);
            ctx.strokeStyle = this.colors.accent; ctx.lineWidth = 1.5;
            ctx.setLineDash(this.preview?.ok ? [3, 2] : []); ctx.strokeRect(x - w / 2, y, w, 24);
            ctx.fillStyle = this.colors.text; ctx.fillText(label, x, y + 16);
            this.routeLabels.push({ cellId, x: x - w / 2, y, w, h: 24 });
        }
        ctx.restore();
    }

    _detachImage() {
        this.ready = false;
        if (!this.image) return;
        this.image.onload = this.image.onerror = null;
        this.image.removeAttribute('src');
        this.image = null;
    }

    _detachReliefImage() {
        this.reliefReady = false;
        if (!this.reliefImage) return;
        this.reliefImage.onload = this.reliefImage.onerror = null;
        this.reliefImage.removeAttribute('src');
        this.reliefImage = null;
    }

    destroy() {
        this.disposed = true;
        this.terrain.destroy();
        clearInterval(this._armyTimer); this._armyTimer = null;
        if (this.armyFrame != null) cancelAnimationFrame(this.armyFrame);
        this.armyFrame = null;
        for (const image of Object.values(this.commandImages)) { image.onload = image.onerror = null; image.removeAttribute('src'); }
        this.commandImages = {};
        this.armyCanvas.width = this.armyCanvas.height = 1; this.armyCanvas.remove(); this.armyCtx = null;
        this._cancelDrag();
        this._events.abort();
        this._resizeObserver.disconnect();
        if (this.frame != null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this._detachImage();
        this._detachReliefImage();
        if (this.flagImage) {
            this.flagImage.onload = this.flagImage.onerror = null;
            this.flagImage.removeAttribute('src');
            this.flagImage = null;
        }
        this.flagReady = false;
        if (this.settlerImage) {
            this.settlerImage.onload = this.settlerImage.onerror = null;
            this.settlerImage.removeAttribute('src'); this.settlerImage = null;
        }
        if (this.settlementImage) {
            this.settlementImage.onload = this.settlementImage.onerror = null;
            this.settlementImage.removeAttribute('src');
            this.settlementImage = null;
        }
        this.settlementReady = false;
        this.canvas.width = this.canvas.height = 1;
        this.ctx = null;
        this.armyLabels = [];
        this.routeLabels = []; this.routeStops = [];
        this.siteLabels = [];
        this.settlements = [];
        this.armies = [];
    }
}
