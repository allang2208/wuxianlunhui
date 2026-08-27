import { blockCellCenter, blockCellOf } from './gate4-grid.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';
import { WallSystem } from './wall-system.js';
import { createRoadNetwork, shortestRoadRoute } from './road-connectivity.js';
import { RoadsideDecorationSystem } from './roadside-decoration-system.js';

export const BUILDING_ROAD_TEXTURE = 'building_road_tiles';
export const BUILDING_ROAD_ICON = 'building_road';
export const BUILDING_ROAD_FRAME_WIDTH = 128;
export const BUILDING_ROAD_FRAME_HEIGHT = 64;
export const BUILDING_ROAD_DISPLAY_WIDTH = 130;
export const BUILDING_ROAD_DISPLAY_HEIGHT = 65;
export const BUILDING_ROAD_DEPTH = WORLD_RENDER_LAYERS.ROAD;
export const BUILDING_ROAD_SPEED_MULTIPLIER = 1.2;
export const BUILDING_FIELD_TEXTURE = 'building_field_tiles';
export const BUILDING_FIELD_DISPLAY_WIDTH = 130;
export const BUILDING_FIELD_DISPLAY_HEIGHT = 65;
export const BUILDING_FIELD_DEPTH = WORLD_RENDER_LAYERS.FIELD;

const DEFAULT_BUILDING_CELLS = 2;
const ROAD_PADDING = 1;

function cellKey(i, j) {
    return `${i},${j}`;
}

export function buildingRoadFrame(i, j) {
    const hash = Math.imul(i, 73856093) ^ Math.imul(j, 19349663);
    const unsigned = hash >>> 0;
    const roll = unsigned % 100;
    const variant = ((unsigned >>> 8) ^ unsigned) >>> 0;
    if (roll < 45) return variant % 4;
    if (roll < 80) return 4 + variant % 4;
    if (roll < 95) return 8 + variant % 2;
    return 10 + variant % 2;
}

/**
 * A building uses a cells×cells interior. The road reservation adds one cell
 * on every side. The central cells may
 * receive visual-only surface fillers so the building art joins the perimeter
 * without turning its occupied footprint into walkable road.
 */
export function buildingRoadLayout(x, y, cells = DEFAULT_BUILDING_CELLS) {
    const buildingCellsWide = cells === 4 ? 4 : DEFAULT_BUILDING_CELLS;
    const frontOffsetY = (buildingCellsWide * 2 - 1) * 32;
    const [baseI, baseJ] = blockCellOf(x, y - frontOffsetY);
    const reservationCells = [];
    const buildingCells = [];
    const roadCells = [];

    for (let di = -ROAD_PADDING; di < buildingCellsWide + ROAD_PADDING; di++) {
        for (let dj = -ROAD_PADDING; dj < buildingCellsWide + ROAD_PADDING; dj++) {
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
                road: di < 0 || di >= buildingCellsWide || dj < 0 || dj >= buildingCellsWide,
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
        footprintCells: buildingCellsWide,
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
    _manualRoadCells: new Map(),
    _topologyRevision: 0,
    _networkCache: null,

    _markTopologyChanged() {
        this._topologyRevision = (Number(this._topologyRevision) || 0) + 1;
        this._networkCache = null;
        // 拖铺道路会在同一输入事务中连续修改多格；街景只取最终拓扑，微任务合并重建，
        // 避免每落一格都遍历全部道路和附近建筑。
        RoadsideDecorationSystem.requestSync({
            scene: this._scene,
            roadTiles: this._roadTiles,
            buildings: Array.from(this._owners.keys()),
        });
    },

    reset(scene = null) {
        for (const record of this._roadTiles.values()) {
            if (record.sprite?.active) record.sprite.destroy();
        }
        for (const entity of this._owners.keys()) {
            if (entity?._removeBuildingRoads) delete entity._removeBuildingRoads;
            if (entity?._buildingRoadLayout) delete entity._buildingRoadLayout;
            if (entity?._buildingPerimeterKind) delete entity._buildingPerimeterKind;
        }
        this._scene = scene;
        this._owners = new Map();
        this._cellOwners = new Map();
        this._roadTiles = new Map();
        this._manualRoadCells = new Map();
        this._markTopologyChanged();
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

    isManualRoadCell(i, j) {
        return this._manualRoadCells.has(cellKey(i, j));
    },

    hasRoadCell(i, j) {
        return this._roadTiles.get(cellKey(i, j))?.kind === 'road';
    },

    hasPerimeterCell(i, j) {
        return this._roadTiles.has(cellKey(i, j));
    },

    hasRoadAt(x, y) {
        const [i, j] = blockCellOf(x, y);
        return this.hasRoadCell(i, j);
    },

    movementMultiplierAt(x, y) {
        return this.hasRoadAt(x, y) ? BUILDING_ROAD_SPEED_MULTIPLIER : 1;
    },

    getTopologyRevision() {
        return Number(this._topologyRevision) || 0;
    },

    getRoadNetwork() {
        const wallRevision = Number(WallSystem?._collisionRevision) || 0;
        if (this._networkCache?.roadRevision === this._topologyRevision
            && this._networkCache?.wallRevision === wallRevision) {
            return this._networkCache.network;
        }
        const cells = [];
        for (const [key, tile] of this._roadTiles.entries()) {
            if (tile?.kind !== 'road') continue;
            const i = Number(tile.i);
            const j = Number(tile.j);
            if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
            const [cx, cy] = blockCellCenter(i, j);
            cells.push({ key, i, j, x: Number(tile.x) || cx, y: Number(tile.y) || cy });
        }
        const network = createRoadNetwork(cells, {
            edgeBlocked: (from, to) => WallSystem.blocked(from.x, from.y, to.x, to.y),
        });
        this._networkCache = {
            roadRevision: this._topologyRevision,
            wallRevision,
            network,
        };
        return network;
    },

    getBuildingRoadAccessKeys(building) {
        if (!building) return [];
        const network = this.getRoadNetwork();
        const layout = building._buildingRoadLayout || buildingRoadLayout(
            building.x,
            building.y,
            building._buildingFootprintCells || 2
        );
        return layout.roadCells.map((cell) => cell.key).filter((key) => network.byKey.has(key));
    },

    getBuildingRoadInfo(building) {
        const network = this.getRoadNetwork();
        const wallRevision = Number(WallSystem?._collisionRevision) || 0;
        const signature = [
            this.getTopologyRevision(),
            wallRevision,
            Math.round(Number(building?.x) || 0),
            Math.round(Number(building?.y) || 0),
        ].join(':');
        if (building?._buildingRoadInfoCache?.signature === signature) {
            return building._buildingRoadInfoCache;
        }
        const accessKeys = this.getBuildingRoadAccessKeys(building);
        const componentIds = [...new Set(accessKeys
            .map((key) => network.componentByKey.get(key))
            .filter((id) => id !== undefined))];
        const cellKeys = [];
        for (const id of componentIds) cellKeys.push(...(network.components.get(id) || []));
        const info = {
            signature,
            connected: accessKeys.length > 0,
            accessKeys,
            componentIds,
            cellKeys: [...new Set(cellKeys)],
            topologyRevision: this.getTopologyRevision(),
            wallRevision,
            network,
        };
        if (building) building._buildingRoadInfoCache = info;
        return info;
    },

    findRouteBetweenBuildings(fromBuilding, toBuilding) {
        const network = this.getRoadNetwork();
        return shortestRoadRoute(
            network,
            this.getBuildingRoadAccessKeys(fromBuilding),
            this.getBuildingRoadAccessKeys(toBuilding)
        );
    },

    getReachableBuildings(fromBuilding, candidates) {
        const network = this.getRoadNetwork();
        const startKeys = this.getBuildingRoadAccessKeys(fromBuilding);
        const result = [];
        for (const building of candidates || []) {
            if (!building || building.active === false) continue;
            const route = shortestRoadRoute(
                network,
                startKeys,
                this.getBuildingRoadAccessKeys(building)
            );
            if (!route) continue;
            result.push({ building, route, distance: Math.max(0, route.length - 1) });
        }
        result.sort((a, b) => a.distance - b.distance);
        return result;
    },

    canPlaceManualRoadCell(i, j) {
        return !this.hasPerimeterCell(i, j) && !this.isReservedCell(i, j);
    },

    _ensureRoadTile(cell, targetScene, kind = 'road') {
        let tile = this._roadTiles.get(cell.key);
        if (!tile) {
            tile = {
                sprite: null, owners: new Set(), manual: false, kind,
                i: cell.i, j: cell.j, x: cell.x, y: cell.y,
            };
            this._roadTiles.set(cell.key, tile);
        }
        tile.i = cell.i;
        tile.j = cell.j;
        tile.x = cell.x;
        tile.y = cell.y;
        if (!tile.sprite && targetScene?.add?.sprite) {
            const usesFieldTexture = kind === 'field' || kind === 'field_fill';
            tile.sprite = usesFieldTexture
                ? targetScene.add.sprite(cell.x, cell.y, BUILDING_FIELD_TEXTURE, cell.frame)
                : targetScene.add.sprite(cell.x, cell.y, BUILDING_ROAD_TEXTURE, cell.frame);
            tile.sprite.setOrigin(0.5, 0.5);
            tile.sprite.setDisplaySize(
                usesFieldTexture ? BUILDING_FIELD_DISPLAY_WIDTH : BUILDING_ROAD_DISPLAY_WIDTH,
                usesFieldTexture ? BUILDING_FIELD_DISPLAY_HEIGHT : BUILDING_ROAD_DISPLAY_HEIGHT
            );
            tile.sprite.setDepth(usesFieldTexture ? BUILDING_FIELD_DEPTH : BUILDING_ROAD_DEPTH);
            tile.sprite.setAlpha(0.96);
        }
        return tile;
    },

    addManualRoad(i, j, {
        scene = null,
        force = false,
        refundable = false,
        buildCost = 0,
        buildCurrency = 'energy',
    } = {}) {
        const targetScene = scene || (
            typeof window !== 'undefined' ? window.__phaserScene : null
        );
        this._ensureScene(targetScene);
        const key = cellKey(i, j);
        const existingTile = this._roadTiles.get(key);
        if (!force && !this.canPlaceManualRoadCell(i, j)) return false;
        if (existingTile && existingTile.kind !== 'road') return false;
        // 旧快照兼容：自动道路环已占用该格时，手动道路可共享贴图并保留独立持久化标记；
        // 建筑中央预约格没有道路贴图，禁止强制铺入建筑底下。
        if (force && this.isReservedCell(i, j) && !existingTile) return false;
        const [x, y] = blockCellCenter(i, j);
        const cell = {
            i,
            j,
            key,
            x: Math.round(x),
            y: Math.round(y),
            frame: buildingRoadFrame(i, j),
            refundable: !!refundable,
            buildCost: Math.max(0, Number(buildCost) || 0),
            buildCurrency: buildCurrency === 'gold' ? 'gold' : 'energy',
        };
        this._manualRoadCells.set(key, cell);
        const tile = this._ensureRoadTile(cell, targetScene);
        tile.manual = true;
        this._markTopologyChanged();
        return true;
    },

    removeManualRoad(i, j) {
        const key = cellKey(i, j);
        if (!this._manualRoadCells.delete(key)) return false;
        const tile = this._roadTiles.get(key);
        if (tile) {
            tile.manual = false;
            if (tile.owners.size === 0) {
                if (tile.sprite?.active) tile.sprite.destroy();
                this._roadTiles.delete(key);
            }
        }
        this._markTopologyChanged();
        return true;
    },

    getManualRoadCell(i, j) {
        return this._manualRoadCells.get(cellKey(i, j)) || null;
    },

    getManualRoadAt(x, y) {
        const [i, j] = blockCellOf(x, y);
        return this.getManualRoadCell(i, j);
    },

    captureManualRoads() {
        return Array.from(this._manualRoadCells.values()).map((cell) => ({
            i: cell.i,
            j: cell.j,
            refundable: cell.refundable !== false,
            buildCost: Math.max(0, Number(cell.buildCost) || 0),
            buildCurrency: cell.buildCurrency === 'gold' ? 'gold' : 'energy',
        }));
    },

    restoreManualRoads(cells, { scene = null } = {}) {
        let restored = 0;
        for (const cell of cells || []) {
            const i = Number(cell?.i);
            const j = Number(cell?.j);
            if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
            // 旧快照只有 i/j：这些道路来自玩家付费铺设，按可回收道路兼容恢复；
            // 新快照会明确记录附属道路不可退款，防止拆建刷资源。
            const refundable = cell?.refundable !== false;
            if (this.addManualRoad(i, j, {
                scene,
                force: true,
                refundable,
                buildCost: cell?.buildCost,
                buildCurrency: cell?.buildCurrency,
            })) restored++;
        }
        return restored;
    },

    canAttach(entity) {
        if (!entity) return false;
        const layout = buildingRoadLayout(
            entity.x,
            entity.y,
            entity._buildingFootprintCells || 2
        );
        return layout.reservationCells.every((cell) =>
            !this.isReservedCell(cell.i, cell.j, entity)
        );
    },

    attach(entity, { allowOverlap = false, scene = null, kind = null } = {}) {
        if (!entity) return false;
        const targetScene = scene || (
            typeof window !== 'undefined' ? window.__phaserScene : null
        );
        this._ensureScene(targetScene);
        this.detach(entity);

        const configuredKind = kind ?? entity._cfg?.perimeterTile ?? 'road';
        if (configuredKind === 'none') return true;

        const layout = buildingRoadLayout(
            entity.x,
            entity.y,
            entity._buildingFootprintCells || 2
        );
        if (!allowOverlap && layout.reservationCells.some((cell) =>
            this.isReservedCell(cell.i, cell.j)
        )) return false;

        const perimeterKind = configuredKind === 'field' ? 'field' : 'road';
        const record = { layout, kind: perimeterKind };
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
            const tile = this._ensureRoadTile(cell, targetScene, perimeterKind);
            tile.owners.add(entity);
        }
        // 删除独立地基后，用外围地块同源纹理补齐主体透明处下方的中央4格。
        // *_fill 不属于道路/田地玩法格：不提供移速、不写手铺道路快照，也不可退款。
        const fillKind = perimeterKind === 'field' ? 'field_fill' : 'road_fill';
        for (const cell of layout.buildingCells) {
            const tile = this._ensureRoadTile(cell, targetScene, fillKind);
            tile.owners.add(entity);
        }

        entity._buildingRoadLayout = layout;
        entity._buildingPerimeterKind = perimeterKind;
        entity._removeBuildingRoads = (options = {}) => this.detach(entity, {
            ...options,
            preserveRoads: perimeterKind === 'road' && options.preserveRoads === true,
        });
        this._markTopologyChanged();
        return true;
    },

    /**
     * 释放建筑的 4×4 预约。preserveRoads=true 时，外围自动道路转为独立道路：
     * 建筑被毁/拆除后道路保留，中心四格预约释放，可直接原位重建。
     */
    detach(entity, { preserveRoads = false } = {}) {
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
            if (record.kind === 'road' && preserveRoads && tile.owners.size === 0 && !tile.manual) {
                // 独立道路沿用同一张贴图与持久化口径，避免建筑消失时道路一并消失。
                this._manualRoadCells.set(cell.key, {
                    i: cell.i,
                    j: cell.j,
                    key: cell.key,
                    x: cell.x,
                    y: cell.y,
                    frame: cell.frame,
                    refundable: false,
                    buildCost: 0,
                    buildCurrency: 'energy',
                });
                tile.manual = true;
            }
            if (tile.owners.size === 0 && !tile.manual) {
                if (tile.sprite?.active) tile.sprite.destroy();
                this._roadTiles.delete(cell.key);
            }
        }
        // 中央补片只服务当前建筑，不能随 preserveRoads 转为手动/可退款道路。
        for (const cell of record.layout.buildingCells) {
            const tile = this._roadTiles.get(cell.key);
            if (!tile) continue;
            tile.owners.delete(entity);
            if (tile.owners.size === 0 && !tile.manual) {
                if (tile.sprite?.active) tile.sprite.destroy();
                this._roadTiles.delete(cell.key);
            }
        }

        this._owners.delete(entity);
        if (entity?._removeBuildingRoads) delete entity._removeBuildingRoads;
        if (entity?._buildingRoadLayout) delete entity._buildingRoadLayout;
        if (entity?._buildingPerimeterKind) delete entity._buildingPerimeterKind;
        this._markTopologyChanged();
        return true;
    },
};
