import fogConfig from '../../data/fog-of-war.json';
import { VisionSourceRegistry } from './vision-source-registry.js';
import { FogOcclusionGrid } from './fog-occlusion-grid.js';

export const FOG_VISIBILITY = Object.freeze({
    UNEXPLORED: 0,
    EXPLORED: 1,
    VISIBLE: 2,
});

const ENABLED_SCENES = new Set(Array.isArray(fogConfig.enabledScenes) ? fogConfig.enabledScenes : []);
const HOSTILE_FACTIONS = new Set(['enemy', 'agent']);
const DEFAULT_WORLD_WIDTH = 12288;
const DEFAULT_WORLD_HEIGHT = 8192;

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function encodeBytes(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    if (typeof btoa === 'function') return btoa(binary);
    if (typeof globalThis.Buffer !== 'undefined') return globalThis.Buffer.from(bytes).toString('base64');
    return '';
}

function decodeBytes(encoded) {
    if (typeof encoded !== 'string' || !encoded) return null;
    try {
        if (typeof atob === 'function') {
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            return bytes;
        }
        if (typeof globalThis.Buffer !== 'undefined') {
            return new Uint8Array(globalThis.Buffer.from(encoded, 'base64'));
        }
    } catch (error) {
        console.warn('[FogOfWar] 无法读取探索记录，将按未探索处理：', error);
    }
    return null;
}

function packBits(values) {
    const packed = new Uint8Array(Math.ceil(values.length / 8));
    for (let i = 0; i < values.length; i += 1) {
        if (values[i]) packed[i >> 3] |= 1 << (i & 7);
    }
    return packed;
}

function unpackBits(encoded, length) {
    const packed = decodeBytes(encoded);
    if (!packed) return null;
    const result = new Uint8Array(length);
    const limit = Math.min(length, packed.length * 8);
    for (let i = 0; i < limit; i += 1) result[i] = (packed[i >> 3] >> (i & 7)) & 1;
    return result;
}

function copyOrResampleExplored(serialized, state) {
    if (!serialized || typeof serialized !== 'object') return false;
    const oldColumns = Math.max(1, Math.floor(Number(serialized.columns) || 0));
    const oldRows = Math.max(1, Math.floor(Number(serialized.rows) || 0));
    const oldExplored = unpackBits(serialized.explored, oldColumns * oldRows);
    if (!oldExplored) return false;

    if (oldColumns === state.columns && oldRows === state.rows) {
        state.explored.set(oldExplored.subarray(0, state.explored.length));
        return true;
    }

    for (let row = 0; row < state.rows; row += 1) {
        const sourceRow = Math.min(oldRows - 1, Math.floor((row + 0.5) * oldRows / state.rows));
        for (let column = 0; column < state.columns; column += 1) {
            const sourceColumn = Math.min(oldColumns - 1, Math.floor((column + 0.5) * oldColumns / state.columns));
            state.explored[row * state.columns + column] = oldExplored[sourceRow * oldColumns + sourceColumn];
        }
    }
    return true;
}

function entityPosition(entity) {
    if (!entity) return null;
    const x = Number(entity.x);
    const y = Number(entity.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function revealCircle(state, target, x, y, radius) {
    const cellSize = state.cellSize;
    const minColumn = Math.max(0, Math.floor((x - radius) / cellSize));
    const maxColumn = Math.min(state.columns - 1, Math.floor((x + radius) / cellSize));
    const minRow = Math.max(0, Math.floor((y - radius) / cellSize));
    const maxRow = Math.min(state.rows - 1, Math.floor((y + radius) / cellSize));
    const radiusSq = radius * radius;

    for (let row = minRow; row <= maxRow; row += 1) {
        const cellY = (row + 0.5) * cellSize;
        const dySq = (cellY - y) * (cellY - y);
        for (let column = minColumn; column <= maxColumn; column += 1) {
            const cellX = (column + 0.5) * cellSize;
            const dx = cellX - x;
            if (dx * dx + dySq <= radiusSq) target[row * state.columns + column] = 1;
        }
    }
}

const SHADOW_OCTANTS = Object.freeze([
    [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
    [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
]);

function castShadowOctant(state, target, occlusion, originColumn, originRow, distance,
    startSlope, endSlope, radiusCells, radiusWorldSq, sourceX, sourceY, transform, sourceContext) {
    if (startSlope < endSlope) return;
    const [xx, xy, yx, yy] = transform;
    let nextStart = startSlope;
    for (let currentDistance = distance; currentDistance <= radiusCells; currentDistance += 1) {
        let blocked = false;
        let offsetX = -currentDistance - 1;
        const offsetY = -currentDistance;
        while (offsetX <= 0) {
            offsetX += 1;
            const column = originColumn + offsetX * xx + offsetY * xy;
            const row = originRow + offsetX * yx + offsetY * yy;
            const leftSlope = (offsetX - 0.5) / (offsetY + 0.5);
            const rightSlope = (offsetX + 0.5) / (offsetY - 0.5);
            if (startSlope < rightSlope) continue;
            if (endSlope > leftSlope) break;
            if (column < 0 || row < 0 || column >= state.columns || row >= state.rows) continue;

            const worldDx = (column + 0.5) * state.cellSize - sourceX;
            const worldDy = (row + 0.5) * state.cellSize - sourceY;
            const cellX = (column + 0.5) * state.cellSize;
            const cellY = (row + 0.5) * state.cellSize;
            const originRayBlocked = FogOcclusionGrid.rayBlockedFromOrigin(
                occlusion,
                sourceContext,
                cellX,
                cellY
            );
            if (!originRayBlocked && worldDx * worldDx + worldDy * worldDy <= radiusWorldSq) {
                target[row * state.columns + column] = 1;
            }
            const opaque = originRayBlocked
                || FogOcclusionGrid.isBlocked(occlusion, column, row, sourceContext);
            if (blocked) {
                if (opaque) {
                    nextStart = rightSlope;
                    continue;
                }
                blocked = false;
                startSlope = nextStart;
            } else if (opaque && currentDistance < radiusCells) {
                blocked = true;
                castShadowOctant(state, target, occlusion, originColumn, originRow,
                    currentDistance + 1, startSlope, leftSlope, radiusCells, radiusWorldSq, sourceX, sourceY,
                    transform, sourceContext);
                nextStart = rightSlope;
            }
        }
        if (blocked) break;
    }
}

function revealWithOcclusion(state, target, entity, radius, occlusion) {
    const x = Number(entity?.x);
    const y = Number(entity?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || radius <= 0) return;
    if (!occlusion || occlusion.blockedCells <= 0) {
        revealCircle(state, target, x, y, radius);
        return;
    }
    const originColumn = Math.floor(x / state.cellSize);
    const originRow = Math.floor(y / state.cellSize);
    if (originColumn < 0 || originRow < 0 || originColumn >= state.columns || originRow >= state.rows) return;
    target[originRow * state.columns + originColumn] = 1;
    const radiusCells = Math.max(1, Math.ceil(radius / state.cellSize));
    const radiusWorldSq = radius * radius;
    const sourceContext = FogOcclusionGrid.sourceOcclusionContext(
        state,
        entity,
        fogConfig.occlusion || {}
    );
    for (const transform of SHADOW_OCTANTS) {
        castShadowOctant(state, target, occlusion, originColumn, originRow, 1,
            1, 0, radiusCells, radiusWorldSq, x, y, transform, sourceContext);
    }
}

export const FogOfWarSystem = {
    config: fogConfig,
    _states: new Map(),

    isEnabled(sceneId) {
        return ENABLED_SCENES.has(sceneId);
    },

    enterScene(sceneId, options = {}) {
        if (!this.isEnabled(sceneId)) return null;
        const width = positiveNumber(options.width, DEFAULT_WORLD_WIDTH);
        const height = positiveNumber(options.height, DEFAULT_WORLD_HEIGHT);
        const cellSize = positiveNumber(options.cellSize, positiveNumber(fogConfig.cellSize, 128));
        const columns = Math.max(1, Math.ceil(width / cellSize));
        const rows = Math.max(1, Math.ceil(height / cellSize));
        const worldEpoch = Math.max(0, Math.floor(Number(options.worldEpoch) || 0));
        const existing = this._states.get(sceneId);
        VisionSourceRegistry.activateScene(sceneId);

        if (existing?.active && existing.worldEpoch === worldEpoch
            && existing.width === width && existing.height === height && existing.cellSize === cellSize) {
            return existing;
        }

        const state = {
            sceneId,
            worldEpoch,
            width,
            height,
            cellSize,
            columns,
            rows,
            explored: new Uint8Array(columns * rows),
            visible: new Uint8Array(columns * rows),
            nextVisible: new Uint8Array(columns * rows),
            revision: 1,
            nextUpdateAt: 0,
            active: true,
            lastUpdateStats: { durationMs: 0, sourceCount: 0, changedCells: 0, exploredCells: 0 },
        };
        const restored = Number(options.serialized?.worldEpoch) === worldEpoch
            && copyOrResampleExplored(options.serialized, state);
        if (!restored && options.legacyExplored) state.explored.fill(1);
        this._states.set(sceneId, state);
        return state;
    },

    deactivateScene(sceneId) {
        const state = this._states.get(sceneId);
        if (state) state.active = false;
    },

    resetScene(sceneId) {
        this._states.delete(sceneId);
        FogOcclusionGrid.resetScene(sceneId);
    },

    update(sceneId, game, nowMs = Date.now(), options = {}) {
        const state = this._states.get(sceneId);
        if (!state || !state.active) return false;
        const now = Number.isFinite(nowMs) ? nowMs : Date.now();
        if (!options.force && now < state.nextUpdateAt) return false;
        state.nextUpdateAt = now + positiveNumber(fogConfig.updateIntervalMs, 100);

        const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const previousVisible = state.visible;
        const nextVisible = state.nextVisible;
        nextVisible.fill(0);
        const occlusion = FogOcclusionGrid.sync(sceneId, state, game, now, {
            force: options.force,
            config: fogConfig.occlusion || {},
        });
        const sources = VisionSourceRegistry.getSources(game, now, { force: options.force });
        // 逻辑网格只能分辨到 cellSize；同格多个友军分别做一次遮挡扩散不会增加精度，
        // 只保留该格半径最大的来源，避免成团部队把迷雾成本线性放大。
        const uniqueSources = new Map();
        let rawSourceCount = 0;
        for (const entity of sources) {
            const radius = VisionSourceRegistry.radiusOf(entity, fogConfig.vision || {}, game);
            const position = radius > 0 ? entityPosition(entity) : null;
            if (position) {
                rawSourceCount += 1;
                const column = Math.floor(position.x / state.cellSize);
                const row = Math.floor(position.y / state.cellSize);
                const key = column + row * state.columns;
                const existing = uniqueSources.get(key);
                if (!existing || radius > existing.radius) {
                    uniqueSources.set(key, { entity, radius });
                }
            }
        }
        for (const source of uniqueSources.values()) {
            revealWithOcclusion(state, nextVisible, source.entity, source.radius, occlusion);
        }
        const sourceCount = uniqueSources.size;

        let changed = false;
        let changedCells = 0;
        let exploredCells = 0;
        for (let i = 0; i < nextVisible.length; i += 1) {
            if (nextVisible[i] && !state.explored[i]) {
                state.explored[i] = 1;
                changed = true;
                exploredCells += 1;
            }
            if (nextVisible[i] !== previousVisible[i]) {
                changed = true;
                changedCells += 1;
            }
        }
        state.visible = nextVisible;
        state.nextVisible = previousVisible;
        if (changed) state.revision += 1;
        const endedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        state.lastUpdateStats = {
            durationMs: endedAt - startedAt,
            sourceCount,
            rawSourceCount,
            changedCells,
            exploredCells,
            occlusionRevision: occlusion?.revision || 0,
        };
        return changed;
    },

    getGrid(sceneId) {
        return this._states.get(sceneId) || null;
    },

    getDebugModel(sceneId) {
        const state = this._states.get(sceneId);
        if (!state) return null;
        let visibleCells = 0;
        let exploredCells = 0;
        for (let i = 0; i < state.visible.length; i += 1) {
            if (state.visible[i]) visibleCells += 1;
            else if (state.explored[i]) exploredCells += 1;
        }
        return {
            sceneId,
            active: state.active,
            columns: state.columns,
            rows: state.rows,
            cellSize: state.cellSize,
            revision: state.revision,
            visibleCells,
            exploredCells,
            unexploredCells: state.visible.length - visibleCells - exploredCells,
            update: { ...state.lastUpdateStats },
            sources: VisionSourceRegistry.describe(fogConfig.vision || {}),
            occlusion: FogOcclusionGrid.getDebugModel(sceneId),
        };
    },

    getVisibilityAt(sceneId, x, y) {
        const state = this._states.get(sceneId);
        if (!state || !state.active) return FOG_VISIBILITY.VISIBLE;
        const column = Math.floor(Number(x) / state.cellSize);
        const row = Math.floor(Number(y) / state.cellSize);
        if (!Number.isFinite(column) || !Number.isFinite(row)
            || column < 0 || row < 0 || column >= state.columns || row >= state.rows) {
            return FOG_VISIBILITY.UNEXPLORED;
        }
        const index = row * state.columns + column;
        if (state.visible[index]) return FOG_VISIBILITY.VISIBLE;
        return state.explored[index] ? FOG_VISIBILITY.EXPLORED : FOG_VISIBILITY.UNEXPLORED;
    },

    isPointVisible(sceneId, x, y) {
        return this.getVisibilityAt(sceneId, x, y) === FOG_VISIBILITY.VISIBLE;
    },

    isAreaVisible(sceneId, x, y, radius = 0) {
        const state = this._states.get(sceneId);
        if (!state || !state.active) return true;
        const safeRadius = Math.max(0, Number(radius) || 0);
        if (safeRadius <= 0) return this.isPointVisible(sceneId, x, y);
        const minColumn = Math.max(0, Math.floor((x - safeRadius) / state.cellSize));
        const maxColumn = Math.min(state.columns - 1, Math.floor((x + safeRadius) / state.cellSize));
        const minRow = Math.max(0, Math.floor((y - safeRadius) / state.cellSize));
        const maxRow = Math.min(state.rows - 1, Math.floor((y + safeRadius) / state.cellSize));
        const tolerance = safeRadius + state.cellSize * Math.SQRT1_2;
        const toleranceSq = tolerance * tolerance;
        for (let row = minRow; row <= maxRow; row += 1) {
            const cellY = (row + 0.5) * state.cellSize;
            for (let column = minColumn; column <= maxColumn; column += 1) {
                const index = row * state.columns + column;
                if (!state.visible[index]) continue;
                const cellX = (column + 0.5) * state.cellSize;
                const dx = cellX - x;
                const dy = cellY - y;
                if (dx * dx + dy * dy <= toleranceSq) return true;
            }
        }
        return false;
    },

    shouldHideEntity(sceneId, entity) {
        if (!entity || !this.isEnabled(sceneId)) return false;
        const faction = entity._faction || entity.faction;
        const requiresLiveSight = HOSTILE_FACTIONS.has(faction) || !!entity.itemData || !!entity._fogRequiresVisibility;
        const requiresExploration = faction === 'neutral' || !!entity._fogRequiresExploration;
        if (!requiresLiveSight && !requiresExploration) return false;
        const position = entityPosition(entity);
        if (!position) return false;
        const rectRadius = Math.hypot(
            (Number(entity.collisionWidth) || 0) * 0.5,
            (Number(entity.collisionHeight) || 0) * 0.5
        );
        const radius = Math.max(
            0,
            Number(entity.groundRadius) || 0,
            Number(entity.collisionRadius) || 0,
            rectRadius
        );
        if (requiresLiveSight) return !this.isAreaVisible(sceneId, position.x, position.y, radius);
        return this.getVisibilityAt(sceneId, position.x, position.y) === FOG_VISIBILITY.UNEXPLORED;
    },

    serializeScene(sceneId) {
        const state = this._states.get(sceneId);
        if (!state) return null;
        return {
            version: 1,
            worldEpoch: state.worldEpoch,
            width: state.width,
            height: state.height,
            cellSize: state.cellSize,
            columns: state.columns,
            rows: state.rows,
            explored: encodeBytes(packBits(state.explored)),
        };
    },
};

export default FogOfWarSystem;
