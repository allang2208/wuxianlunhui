import { blockCellCenter, blockCellOf } from './gate4-grid.js';

export const BUILDING_ROAD_TEXTURE = 'building_road_tiles';
export const BUILDING_ROAD_FRAME_WIDTH = 128;
export const BUILDING_ROAD_FRAME_HEIGHT = 64;
export const BUILDING_ROAD_DISPLAY_WIDTH = 130;
export const BUILDING_ROAD_DISPLAY_HEIGHT = 65;
export const BUILDING_ROAD_DEPTH = -995;

const BUILDING_CELLS = 2;
const ROAD_PADDING = 1;
const BUILDING_FRONT_OFFSET_Y = 96;

function cellKey(i, j) {
    return `${i},${j}`;
}

export function buildingRoadFrame(i, j) {
    const hash = Math.imul(i, 73856093) ^ Math.imul(j, 19349663);
    return (hash >>> 0) % 4;
}

/**
 * A 2x2 building uses cells [baseI..baseI+1] x [baseJ..baseJ+1].
 * The road reservation adds one cell on every side, producing a 4x4 area:
 * 12 visible road cells plus the central 4 building cells.
 */
export function buildingRoadLayout(x, y) {
    const [baseI, baseJ] = blockCellOf(x, y - BUILDING_FRONT_OFFSET_Y);
    const reservationCells = [];
    const buildingCells = [];
    const roadCells = [];

    for (let di = -ROAD_PADDING; di < BUILDING_CELLS + ROAD_PADDING; di++) {
        for (let dj = -ROAD_PADDING; dj < BUILDING_CELLS + ROAD_PADDING; dj++) {
            const i = baseI + di;
            const j = baseJ + dj;
            const [cx, cy] = blockCellCenter(i, j);
            const cell = {
                i,
                j,
                key: cellKey(i, j),
                x: Math.round(cx),
                y: Math.round(cy),
                frame: buildingRoadFrame(i, j),
                road: di < 0 || di >= BUILDING_CELLS || dj < 0 || dj >= BUILDING_CELLS,
            };
            reservationCells.push(cell);
            if (cell.road) roadCells.push(cell);
            else buildingCells.push(cell);
        }
    }

    return {
        x,
        y,
        baseI,
        baseJ,
        reservationCells,
        buildingCells,
        roadCells,
    };
}

export const BuildingRoadSystem = {
    _scene: null,
    _owners: new Map(),
    _cellOwners: new Map(),
    _roadTiles: new Map(),

    reset(scene = null) {
        for (const record of this._roadTiles.values()) {
            if (record.sprite?.active) record.sprite.destroy();
        }
        for (const entity of this._owners.keys()) {
            if (entity?._removeBuildingRoads) delete entity._removeBuildingRoads;
            if (entity?._buildingRoadLayout) delete entity._buildingRoadLayout;
        }
        this._scene = scene;
        this._owners = new Map();
        this._cellOwners = new Map();
        this._roadTiles = new Map();
    },

    _ensureScene(scene) {
        if (scene && scene !== this._scene) this.reset(scene);
    },

    isReservedCell(i, j, ignoreEntity = null) {
        const owners = this._cellOwners.get(cellKey(i, j));
        if (!owners || owners.size === 0) return false;
        if (!ignoreEntity) return true;
        for (const owner of owners) {
            if (owner !== ignoreEntity) return true;
        }
        return false;
    },

    canAttach(entity) {
        if (!entity) return false;
        const layout = buildingRoadLayout(entity.x, entity.y);
        return layout.reservationCells.every((cell) =>
            !this.isReservedCell(cell.i, cell.j, entity)
        );
    },

    attach(entity, { allowOverlap = false, scene = null } = {}) {
        if (!entity) return false;
        const targetScene = scene || (
            typeof window !== 'undefined' ? window.__phaserScene : null
        );
        this._ensureScene(targetScene);
        this.detach(entity);

        const layout = buildingRoadLayout(entity.x, entity.y);
        if (!allowOverlap && layout.reservationCells.some((cell) =>
            this.isReservedCell(cell.i, cell.j)
        )) return false;

        const record = { layout };
        this._owners.set(entity, record);
        for (const cell of layout.reservationCells) {
            let owners = this._cellOwners.get(cell.key);
            if (!owners) {
                owners = new Set();
                this._cellOwners.set(cell.key, owners);
            }
            owners.add(entity);
        }

        for (const cell of layout.roadCells) {
            let tile = this._roadTiles.get(cell.key);
            if (!tile) {
                let sprite = null;
                if (targetScene?.add?.sprite) {
                    sprite = targetScene.add.sprite(
                        cell.x,
                        cell.y,
                        BUILDING_ROAD_TEXTURE,
                        cell.frame
                    );
                    sprite.setOrigin(0.5, 0.5);
                    sprite.setDisplaySize(
                        BUILDING_ROAD_DISPLAY_WIDTH,
                        BUILDING_ROAD_DISPLAY_HEIGHT
                    );
                    sprite.setDepth(BUILDING_ROAD_DEPTH);
                    sprite.setAlpha(0.96);
                }
                tile = { sprite, owners: new Set() };
                this._roadTiles.set(cell.key, tile);
            }
            tile.owners.add(entity);
        }

        entity._buildingRoadLayout = layout;
        entity._removeBuildingRoads = () => this.detach(entity);
        return true;
    },

    detach(entity) {
        const record = this._owners.get(entity);
        if (!record) return false;

        for (const cell of record.layout.reservationCells) {
            const owners = this._cellOwners.get(cell.key);
            if (!owners) continue;
            owners.delete(entity);
            if (owners.size === 0) this._cellOwners.delete(cell.key);
        }
        for (const cell of record.layout.roadCells) {
            const tile = this._roadTiles.get(cell.key);
            if (!tile) continue;
            tile.owners.delete(entity);
            if (tile.owners.size === 0) {
                if (tile.sprite?.active) tile.sprite.destroy();
                this._roadTiles.delete(cell.key);
            }
        }

        this._owners.delete(entity);
        if (entity?._removeBuildingRoads) delete entity._removeBuildingRoads;
        if (entity?._buildingRoadLayout) delete entity._buildingRoadLayout;
        return true;
    },
};
