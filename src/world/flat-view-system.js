import {
    isoFootprintVertices,
    isoLocalToWorldDelta,
    worldDeltaToIsoLocal,
} from '../physics/iso-footprint.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';
import { UIState } from '../ui/ui-state.js';

const SUPPORTED_SCENES = new Set(['scene8', 'scene9', 'scene10', 'scene11', 'scene12']);

const STYLE = Object.freeze({
    building: { fill: 0x42576b, line: 0x9fc6df, alpha: 0.28 },
    wall: { fill: 0x56616b, line: 0xc2ccd3, alpha: 0.34 },
    tower: { fill: 0x5b4a70, line: 0xd7baff, alpha: 0.34 },
    gateClosed: { fill: 0x745c27, line: 0xffd36a, alpha: 0.38 },
    gateOpen: { fill: 0x2d6b50, line: 0x7dffbd, alpha: 0.32 },
    staircase: { fill: 0x365e68, line: 0x8ce5ee, alpha: 0.34 },
});

function isTypingTarget(target) {
    if (!target || typeof target !== 'object') return false;
    const tag = String(target.tagName || '').toLowerCase();
    return target.isContentEditable
        || !!target.closest?.('input, textarea, select, [contenteditable="true"]')
        || tag === 'input'
        || tag === 'textarea'
        || tag === 'select';
}

function isSpaceEvent(event) {
    return event?.code === 'Space' || event?.key === ' ' || event?.key === 'Spacebar';
}

function centerOf(points) {
    if (!points?.length) return { x: 0, y: 0 };
    return points.reduce((out, point) => ({
        x: out.x + point.x / points.length,
        y: out.y + point.y / points.length,
    }), { x: 0, y: 0 });
}

function fallbackFootprint(entity) {
    const x = (Number(entity?.x) || 0) + (Number(entity?.colliderOffsetX) || 0);
    const y = (Number(entity?.y) || 0) + (Number(entity?.colliderOffsetY) || 0);
    const width = Math.max(24, Number(entity?.collisionWidth) || (Number(entity?.collisionRadius) || 24) * 2);
    const height = Math.max(12, Number(entity?.collisionHeight) || width * 0.5);
    return [
        { x, y: y - height * 0.5 },
        { x: x + width * 0.5, y },
        { x, y: y + height * 0.5 },
        { x: x - width * 0.5, y },
    ];
}

function footprintOf(entity) {
    if (entity?.collisionShape === 'iso_rect') {
        const points = isoFootprintVertices(entity);
        if (points.length >= 3 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
            return points;
        }
    }
    return fallbackFootprint(entity);
}

function stripAroundSegment(a, b, halfThickness = 9) {
    if (!a || !b) return [];
    const local = worldDeltaToIsoLocal(b.x - a.x, b.y - a.y);
    const length = Math.hypot(local.u, local.v);
    if (length < 0.001) return [];
    const offset = isoLocalToWorldDelta(
        -local.v / length * halfThickness,
        local.u / length * halfThickness
    );
    return [
        { x: a.x + offset.x, y: a.y + offset.y },
        { x: b.x + offset.x, y: b.y + offset.y },
        { x: b.x - offset.x, y: b.y - offset.y },
        { x: a.x - offset.x, y: a.y - offset.y },
    ];
}

function uniqueActiveObjects(items) {
    return [...new Set(items)].filter((item) => item?.active);
}

export const FlatViewSystem = {
    enabled: false,
    initialized: false,
    _scene: null,
    _graphics: null,
    _unitGraphics: null,
    _indicator: null,
    _savedObjects: new Map(),
    _blockedMarkers: [],
    _commandMarkers: [],
    _keydown: null,

    init() {
        if (this.initialized || typeof window === 'undefined') return;
        this.initialized = true;
        this._keydown = (event) => this._onKeyDown(event);
        // 捕获阶段先于 Input 的冒泡监听接管 Space，避免建造/RTS 时同时触发玩家闪避。
        window.addEventListener('keydown', this._keydown, true);
    },

    reset() {
        this.setEnabled(false);
    },

    destroy() {
        this.setEnabled(false);
        if (typeof window !== 'undefined' && this._keydown) {
            window.removeEventListener('keydown', this._keydown, true);
        }
        this._keydown = null;
        this.initialized = false;
        if (this._graphics?.active) this._graphics.destroy();
        if (this._unitGraphics?.active) this._unitGraphics.destroy();
        this._graphics = null;
        this._unitGraphics = null;
        this._blockedMarkers = [];
        this._commandMarkers = [];
        this._scene = null;
        if (this._indicator?.isConnected) this._indicator.remove();
        this._indicator = null;
    },

    isAvailable(game = null) {
        const activeGame = game || (typeof window !== 'undefined' ? window.Game : null);
        const sceneId = typeof window !== 'undefined' ? window.SceneManager?.currentScene : null;
        return !!(activeGame?.isRunning && SUPPORTED_SCENES.has(sceneId));
    },

    isSpaceAvailable(game = null) {
        const activeGame = game || (typeof window !== 'undefined' ? window.Game : null);
        if (!this.isAvailable(activeGame)) return false;
        return !!(
            activeGame.RTSCommand?.enabled
            || activeGame._buildMode
            || activeGame.BuildingSystem?.active
        );
    },

    setEnabled(next) {
        const value = !!next;
        // 压平视图只属于指挥/建筑输入态；普通直接操控的 Space 继续唯一归玩家闪避。
        if (value && (!this.isAvailable() || !this.isSpaceAvailable())) return false;
        if (this.enabled === value) return this.enabled;
        this.enabled = value;
        if (!value) {
            this._restoreVisuals();
            this._blockedMarkers = [];
            this._commandMarkers = [];
            if (this._graphics?.active) {
                this._graphics.clear();
                this._graphics.setVisible(false);
            }
            if (this._unitGraphics?.active) {
                this._unitGraphics.clear();
                this._unitGraphics.setVisible(false);
            }
        }
        this._updateIndicator(0, 0);
        return this.enabled;
    },

    toggle() {
        return this.setEnabled(!this.enabled);
    },

    _onKeyDown(event) {
        if (UIState.isOpen('worldSwitch')) return;
        if (!isSpaceEvent(event) || !this.isSpaceAvailable()) return;
        const typing = isTypingTarget(event.target);
        // 合法上下文中的 Space 必须始终与角色输入隔离。文本输入保留浏览器默认的空格录入，
        // 但仍阻断事件抵达 Input；按钮焦点则按压平快捷键处理，不能再次激活按钮。
        if (!typing) event.preventDefault();
        event.stopImmediatePropagation();
        this._clearSpaceKey();
        if (!typing && !event.repeat) this.toggle();
    },

    sync(scene, game, wallSystem) {
        // 指挥/建造模式期间每帧清理可能在模式切换前遗留的 Space，
        // 防止“用空格激活带焦点按钮后才进入指挥模式”造成首帧翻滚。
        if (this.isSpaceAvailable(game)) this._clearSpaceKey(game);
        // 离开指挥/建筑输入态即恢复立面，避免移除滚轮入口后留下无法恢复的压平画面。
        if (this.enabled && (!this.isAvailable(game) || !this.isSpaceAvailable(game))) {
            this.setEnabled(false);
        }
        if (!this.enabled || !scene?.add) {
            this._updateIndicator(0, 0);
            return;
        }
        this._ensureScene(scene);
        const graphics = this._graphics;
        graphics.clear();
        graphics.setVisible(true);

        const structures = this._collectStructures(game);
        for (const entity of structures) {
            this._hideStructure(scene, entity);
            this._drawStructure(graphics, entity);
        }
        const wallCount = this._flattenWallVisuals(graphics, wallSystem);
        this._flattenWorldGate(graphics);
        this._hideDetachedSinkSprites(scene);
        this._hideXRayArtifacts(scene);
        const elevatedCount = this._drawElevatedUnitHints(game);
        this._updateIndicator(structures.length + wallCount, elevatedCount);
    },

    /** 常规渲染与战争迷雾同步后再次压住全部建筑装饰特效，避免后置可见性恢复把它们点亮。 */
    suppressBuildingEffects(scene, game) {
        if (!this.enabled || !scene?._neutralSprites) return;
        for (const entity of this._collectStructures(game)) {
            const neutral = scene._neutralSprites.get(entity);
            neutral?.groundContactSprite?.setVisible?.(false);
            neutral?.overlaySprite?.setVisible?.(false);
            neutral?.foregroundSprite?.setVisible?.(false);
            neutral?.workingEffectGraphics?.setVisible?.(false);
            neutral?.staffingWarningGraphics?.setVisible?.(false);
        }
    },

    _clearSpaceKey(game = null) {
        const activeGame = game || (typeof window !== 'undefined' ? window.Game : null);
        activeGame?.Input?.keys?.delete?.('Space');
    },

    /** 弹体仍由真实墙体判定销毁；这里只记录一个短时可视反馈。 */
    notifyProjectileBlocked(x, y, z = 0) {
        if (!this.enabled || !Number.isFinite(x) || !Number.isFinite(y)) return;
        this._blockedMarkers.push({ x, y, z: Number(z) || 0, at: Date.now() });
        if (this._blockedMarkers.length > 24) this._blockedMarkers.splice(0, this._blockedMarkers.length - 24);
    },

    /**
     * RTS 指令的层级反馈。只快照目标点与选中单位当前承载层，不参与寻路、攻击或命中结算。
     * @param {'move'|'attack'} mode
     * @param {object} targetPoint
     * @param {object[]} commandedUnits
     */
    notifyCommandTarget(mode, targetPoint, commandedUnits = []) {
        if (!this.enabled || !targetPoint) return;
        const x = Number(targetPoint.x);
        const y = Number(targetPoint.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const z = Math.max(0, Number(targetPoint.z) || 0);
        const surfaceKind = targetPoint.surfaceKind
            || targetPoint._surfaceKind
            || (z > 1 ? 'elevated' : 'ground');
        const sourceLayers = new Set();
        for (const unit of commandedUnits) {
            if (!unit?.active) continue;
            sourceLayers.add(unit._surfaceKind || ((Number(unit.z) || 0) > 1 ? 'elevated' : 'ground'));
        }
        this._commandMarkers = [{
            mode: mode === 'attack' ? 'attack' : 'move',
            x,
            y,
            z,
            surfaceKind,
            mixedSources: sourceLayers.size > 1,
            at: Date.now(),
        }];
    },

    _ensureScene(scene) {
        if (this._scene === scene && this._graphics?.active) return;
        this._restoreVisuals();
        if (this._graphics?.active) this._graphics.destroy();
        if (this._unitGraphics?.active) this._unitGraphics.destroy();
        this._scene = scene;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(WORLD_RENDER_LAYERS.FLAT_STRUCTURE);
        this._unitGraphics = scene.add.graphics();
        // 只读高度提示覆盖单位，但保持在世界 HUD/屏幕 HUD 下方。
        this._unitGraphics.setDepth(99970);
    },

    _remember(object) {
        if (!object?.active) return null;
        let saved = this._savedObjects.get(object);
        if (!saved) {
            saved = {
                visible: object.visible !== false,
                depth: Number.isFinite(object.depth) ? object.depth : null,
            };
            this._savedObjects.set(object, saved);
        }
        return saved;
    },

    _hide(object) {
        if (!this._remember(object)) return;
        object.setVisible?.(false);
    },

    _restoreVisuals() {
        for (const [object, saved] of this._savedObjects.entries()) {
            if (!object?.active) continue;
            object.setVisible?.(saved.visible);
            if (saved.depth !== null) object.setDepth?.(saved.depth);
        }
        this._savedObjects.clear();
    },

    _collectStructures(game) {
        const out = [];
        const seen = new Set();
        const add = (entity) => {
            if (!entity?.active || !entity._isDefenseStructure || seen.has(entity)) return;
            seen.add(entity);
            out.push(entity);
        };
        if (game?.entities?.values) {
            for (const entity of game.entities.values()) add(entity);
        }
        add(game?.DefenseSystem?.gate);
        for (const gate of game?.DefenseSystem?.gates || []) add(gate);
        return out;
    },

    _hideStructure(scene, entity) {
        const neutral = scene._neutralSprites?.get(entity);
        const tower = scene._defenseSprites?.get(entity);
        const neutralBodies = Array.isArray(neutral?.segmentSprites) && neutral.segmentSprites.length
            ? neutral.segmentSprites
            : [neutral?.sprite];
        for (const object of uniqueActiveObjects([
            ...neutralBodies,
            neutral?.groundContactSprite,
            neutral?.overlaySprite,
            neutral?.foregroundSprite,
            tower?.base,
            tower?.arm,
            tower?.weapon,
            entity.spriteL,
            entity.sprite,
            entity.spriteR,
            entity._phaserSprite,
        ])) this._hide(object);
        this._hide(neutral?.label);
    },

    _drawStructure(graphics, entity) {
        const parts = entity._isWallStaircase && Array.isArray(entity.segments) && entity.segments.length
            ? entity.segments
            : [entity];
        const isGate = !!entity._isCoverGate;
        const gateOpen = isGate && (entity.state === 'open' || entity.state === 'opening');
        const style = entity._isWallStaircase
            ? STYLE.staircase
            : (isGate ? (gateOpen ? STYLE.gateOpen : STYLE.gateClosed)
                : (entity._isDefenseTower ? STYLE.tower
                    : (entity._isDefenseCover ? STYLE.wall : STYLE.building)));
        const polygons = [];
        for (const part of parts) {
            const points = footprintOf(part);
            polygons.push(points);
            this._drawPolygon(graphics, points, style);
        }

        const points = polygons.flat();
        const center = centerOf(points);
        if (entity._isDefenseTower) {
            graphics.lineStyle(2, style.line, 0.95);
            graphics.strokeCircle(center.x, center.y, 13);
            graphics.lineBetween(center.x - 8, center.y, center.x + 8, center.y);
            graphics.lineBetween(center.x, center.y - 5, center.x, center.y + 5);
        } else if (isGate) {
            const line = Array.isArray(entity._faceLine) ? entity._faceLine : null;
            const a = line?.[0] || polygons[0]?.[3];
            const b = line?.[1] || polygons[0]?.[1];
            if (a && b) {
                graphics.lineStyle(gateOpen ? 3 : 5, style.line, 0.95);
                if (gateOpen) {
                    const mx = (a.x + b.x) * 0.5;
                    const my = (a.y + b.y) * 0.5;
                    graphics.lineBetween(a.x, a.y, mx - (b.x - a.x) * 0.12, my - (b.y - a.y) * 0.12);
                    graphics.lineBetween(mx + (b.x - a.x) * 0.12, my + (b.y - a.y) * 0.12, b.x, b.y);
                } else {
                    graphics.lineBetween(a.x, a.y, b.x, b.y);
                }
            }
        } else if (entity._isWallStaircase) {
            const first = entity.segments?.[0];
            const last = entity.segments?.[entity.segments.length - 1];
            if (first && last) this._drawArrow(graphics, first, last, style.line);
        } else {
            graphics.fillStyle(style.line, 0.9);
            graphics.fillCircle(center.x, center.y, 3);
        }
    },

    _drawPolygon(graphics, points, style) {
        if (!points || points.length < 3) return;
        graphics.fillStyle(style.fill, style.alpha);
        graphics.fillPoints(points, true);
        graphics.lineStyle(2, style.line, 0.92);
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) graphics.lineTo(points[i].x, points[i].y);
        graphics.closePath();
        graphics.strokePath();
    },

    _drawArrow(graphics, from, to, color) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (length < 2) return;
        const ux = dx / length;
        const uy = dy / length;
        const tx = to.x - ux * 16;
        const ty = to.y - uy * 16;
        graphics.lineStyle(3, color, 0.95);
        graphics.lineBetween(from.x, from.y, tx, ty);
        graphics.lineBetween(tx, ty, tx - ux * 9 - uy * 6, ty - uy * 9 + ux * 6);
        graphics.lineBetween(tx, ty, tx - ux * 9 + uy * 6, ty - uy * 9 - ux * 6);
    },

    _flattenWallVisuals(graphics, wallSystem) {
        if (!wallSystem?.isoVisuals) return 0;
        let count = 0;
        for (const piece of wallSystem.isoVisuals) {
            const sprite = piece?._sprite;
            if (!sprite?.active) continue;
            const geo = wallSystem._geoForTex?.(piece.tex);
            if (geo?.category === 'obstacle') continue;
            this._hide(sprite);
            const segments = wallSystem._pieceBaseSegments?.(piece) || [];
            for (const [a, b] of segments) {
                const points = stripAroundSegment(a, b, 9);
                this._drawPolygon(graphics, points, STYLE.wall);
            }
            count++;
        }
        return count;
    },

    _flattenWorldGate(graphics) {
        const gate = typeof window !== 'undefined' ? window.WallGate : null;
        if (!gate?.sprite?.active || !Array.isArray(gate._seg)) return;
        for (const sprite of gate.sprites?.length ? gate.sprites : [gate.sprite]) this._hide(sprite);
        for (const sprite of gate.glowSprites?.length ? gate.glowSprites : [gate.glowSprite]) this._hide(sprite);
        const open = gate.state === 'open' || gate.state === 'opening';
        const style = open ? STYLE.gateOpen : STYLE.gateClosed;
        const points = stripAroundSegment(gate._seg[0], gate._seg[1], 12);
        this._drawPolygon(graphics, points, style);
        const a = gate._seg[0];
        const b = gate._seg[1];
        graphics.lineStyle(open ? 3 : 5, style.line, 0.95);
        if (!open) graphics.lineBetween(a.x, a.y, b.x, b.y);
    },

    _hideDetachedSinkSprites(scene) {
        for (const child of scene.children?.list || []) {
            if (Number.isFinite(child?._sinkBaseY)) this._hide(child);
        }
    },

    _hideXRayArtifacts(scene) {
        if (!scene._xrayMap) return;
        for (const current of scene._xrayMap.values()) {
            for (const key of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone']) {
                current?.[key]?.setVisible?.(false);
            }
        }
    },

    _drawElevatedUnitHints(game) {
        const graphics = this._unitGraphics;
        if (!graphics?.active) return 0;
        graphics.clear();
        graphics.setVisible(true);
        const units = new Set();
        const add = (unit) => {
            if (!unit?.active || unit._isDefenseStructure) return;
            if (unit._surfaceKind !== 'wall_walk' && unit._surfaceKind !== 'stairs') return;
            units.add(unit);
        };
        add(game?.player);
        for (const unit of game?.PartySystem?.members || []) add(unit);
        for (const unit of game?.friendlyUnits || []) add(unit);
        if (game?.entities?.values) {
            for (const unit of game.entities.values()) add(unit);
        }

        for (const unit of units) {
            const z = Math.max(0, Number(unit.z) || 0);
            const footY = (Number(unit.y) || 0) - z;
            const groundY = Number(unit.y) || 0;
            const radius = Math.max(14, Number(unit.groundRadius) || Number(unit.collisionRadius) || 20) + 7;
            const onStairs = unit._surfaceKind === 'stairs';
            const color = onStairs ? 0xffc65c : 0x6fdfff;
            graphics.lineStyle(2.2, color, 0.96);
            graphics.strokeEllipse(unit.x, footY, radius * 2, radius * 0.86);
            // 真实 z 的地面投影连线：只帮助读图，不改变单位位置或承载面。
            if (z > 5) {
                graphics.lineStyle(1.2, color, 0.44);
                const span = Math.max(1, groundY - footY);
                for (let offset = 5; offset < span; offset += 10) {
                    graphics.lineBetween(
                        unit.x,
                        footY + offset,
                        unit.x,
                        Math.min(groundY, footY + offset + 5)
                    );
                }
                graphics.fillStyle(color, 0.86);
                graphics.fillCircle(unit.x, groundY, 2.5);
            }
            // 墙顶用上箭头；楼梯用斜向双线，直接读取当前 surfaceKind。
            if (onStairs) {
                graphics.lineStyle(2, color, 0.92);
                graphics.lineBetween(unit.x - 7, footY - radius * 0.58, unit.x + 5, footY - radius * 0.78);
                graphics.lineBetween(unit.x - 3, footY - radius * 0.45, unit.x + 9, footY - radius * 0.65);
            } else {
                const topY = footY - radius * 0.62;
                graphics.fillStyle(color, 0.92);
                graphics.fillTriangle(unit.x, topY - 7, unit.x - 5, topY, unit.x + 5, topY);
            }
        }
        const now = Date.now();
        this._blockedMarkers = this._blockedMarkers.filter((marker) => now - marker.at < 520);
        for (const marker of this._blockedMarkers) {
            const progress = Math.max(0, Math.min(1, (now - marker.at) / 520));
            const alpha = 1 - progress;
            const y = marker.y - marker.z;
            const radius = 5 + progress * 8;
            graphics.lineStyle(2, 0xff9a62, alpha * 0.95);
            graphics.strokeCircle(marker.x, y, radius);
            graphics.lineBetween(marker.x - radius * 0.65, y - radius * 0.65, marker.x + radius * 0.65, y + radius * 0.65);
            graphics.lineBetween(marker.x + radius * 0.65, y - radius * 0.65, marker.x - radius * 0.65, y + radius * 0.65);
            if (marker.z > 5) {
                graphics.lineStyle(1, 0xff9a62, alpha * 0.38);
                graphics.lineBetween(marker.x, y + radius, marker.x, marker.y);
            }
        }
        this._drawCommandMarkers(graphics, now);
        return units.size;
    },

    _drawCommandMarkers(graphics, now) {
        const lifeMs = 1100;
        this._commandMarkers = this._commandMarkers.filter((marker) => now - marker.at < lifeMs);
        for (const marker of this._commandMarkers) {
            const progress = Math.max(0, Math.min(1, (now - marker.at) / lifeMs));
            const alpha = 1 - progress;
            const visualY = marker.y - marker.z;
            const radius = 12 + progress * 5;
            const color = marker.mode === 'attack'
                ? 0xff6262
                : (marker.surfaceKind === 'wall_walk'
                    ? 0x6fdfff
                    : (marker.surfaceKind === 'stairs' ? 0xffc65c : 0x72e58e));
            graphics.lineStyle(2.4, color, alpha * 0.96);
            if (marker.mode === 'attack') {
                graphics.strokeCircle(marker.x, visualY, radius);
                graphics.lineBetween(marker.x - radius - 5, visualY, marker.x - radius * 0.45, visualY);
                graphics.lineBetween(marker.x + radius * 0.45, visualY, marker.x + radius + 5, visualY);
                graphics.lineBetween(marker.x, visualY - radius - 5, marker.x, visualY - radius * 0.45);
                graphics.lineBetween(marker.x, visualY + radius * 0.45, marker.x, visualY + radius + 5);
            } else {
                graphics.beginPath();
                graphics.moveTo(marker.x, visualY - radius);
                graphics.lineTo(marker.x + radius, visualY);
                graphics.lineTo(marker.x, visualY + radius * 0.62);
                graphics.lineTo(marker.x - radius, visualY);
                graphics.closePath();
                graphics.strokePath();
                graphics.fillStyle(color, alpha * 0.82);
                graphics.fillCircle(marker.x, visualY, 2.8);
            }
            if (marker.mixedSources) {
                graphics.lineStyle(1.4, color, alpha * 0.58);
                graphics.strokeCircle(marker.x, visualY, radius + 6);
            }
            if (marker.z > 5) {
                graphics.lineStyle(1.1, color, alpha * 0.42);
                graphics.lineBetween(marker.x, visualY + radius, marker.x, marker.y);
                graphics.fillStyle(color, alpha * 0.82);
                graphics.fillTriangle(marker.x, visualY - radius - 7, marker.x - 4, visualY - radius - 1, marker.x + 4, visualY - radius - 1);
            }
        }
    },

    _commandSummary() {
        const marker = this._commandMarkers?.[0];
        if (!marker || Date.now() - marker.at >= 1100) return '';
        const layer = marker.surfaceKind === 'wall_walk'
            ? `墙顶 +${Math.round(marker.z)}`
            : (marker.surfaceKind === 'stairs'
                ? `楼梯 +${Math.round(marker.z)}`
                : (marker.z > 1 ? `高层 +${Math.round(marker.z)}` : '地面'));
        const action = marker.mode === 'attack' ? '攻击' : '移动';
        return `${action}→${layer}${marker.mixedSources ? ' · 混层编队各自寻路' : ''}`;
    },

    _updateIndicator(count, elevatedCount = 0) {
        if (typeof document === 'undefined') return;
        const spaceAvailable = this.isSpaceAvailable();
        if (!this._indicator && (this.enabled || spaceAvailable) && document.body) {
            const indicator = document.createElement('div');
            const invasionHud = document.getElementById('worldInvasionHud');
            indicator.id = 'flatViewIndicator';
            indicator.setAttribute('aria-live', 'polite');
            Object.assign(indicator.style, {
                position: invasionHud ? 'absolute' : 'fixed',
                top: invasionHud ? 'calc(100% + 8px)' : '128px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: '10020',
                pointerEvents: 'none',
                width: 'max-content',
                maxWidth: 'calc(100vw - 24px)',
                textAlign: 'center',
                padding: '7px 12px',
                border: '1px solid rgba(159, 198, 223, 0.72)',
                borderRadius: '4px',
                background: 'rgba(12, 22, 30, 0.88)',
                color: '#d9edf7',
                font: '13px/1.2 "Microsoft YaHei", sans-serif',
                boxShadow: '0 2px 10px rgba(0,0,0,0.38)',
            });
            (invasionHud || document.body).appendChild(indicator);
            this._indicator = indicator;
        }
        if (!this._indicator) return;
        this._indicator.style.display = (this.enabled || spaceAvailable) ? 'block' : 'none';
        this._indicator.style.opacity = this.enabled ? '1' : '0.72';
        if (this.enabled) {
            const command = this._commandSummary();
            this._indicator.textContent = `压平视图 · ${count} 个建筑/墙件 · ${elevatedCount} 个高层单位${command ? ` · ${command}` : ''} · 空格恢复`;
        } else if (spaceAvailable) {
            this._indicator.textContent = '空格：压平建筑（仅改变显示）';
        }
    },
};
