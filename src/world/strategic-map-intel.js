import { WorldProgressionSystem as Progression } from './world-progression-system.js';
import { WORLD_MAP_CELLS, worldMapInfo, strategicCell } from './world-map-cells.js';

const orderedIds = (ids) => WORLD_MAP_CELLS.filter((cell) => ids.has(cell.id)).map((cell) => cell.id);

/** Persistent exploration plus current strategic sight. It does not advance simulation. */
export const StrategicMapIntel = {
    refreshMapIntel() {
        const mapKey = worldMapInfo().key;
        const saved = this.state.mapIntel?.mapKey === mapKey && Array.isArray(this.state.mapIntel.exploredCellIds)
            ? this.state.mapIntel.exploredCellIds : [];
        const explored = new Set(saved.filter((id) => strategicCell(id)));
        const visible = new Set();
        const reveal = (cellId, radius = 0) => {
            const center = strategicCell(cellId);
            radius = Math.max(0, Math.min(8, Math.floor(Number(radius) || 0)));
            if (!center) return;
            for (let q = -radius; q <= radius; q++) {
                for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
                    const cell = strategicCell(`${center.q + q},${center.r + r}`);
                    if (cell) visible.add(cell.id);
                }
            }
        };
        // A located planar signal is permanently known even if its portal is later destroyed.
        for (const sceneId of Progression.getWorldIds()) reveal(Progression.getWorldMapDiscovery(sceneId)?.cellId, 0);
        const sources = this.getInvasionReconSources().map(({ cellId, radius }) => ({ cellId, radius }));
        for (const source of sources) reveal(source.cellId, source.radius);
        for (const id of visible) explored.add(id);
        const exploredCellIds = orderedIds(explored), visibleCellIds = orderedIds(visible);
        const exploredSignature = exploredCellIds.join('|');
        let changed = false;
        if (this.state.mapIntel?.mapKey !== mapKey || this._mapExploredSignature !== exploredSignature) {
            this.state.mapIntel = { version: 1, mapKey, exploredCellIds };
            this._mapExploredSignature = exploredSignature;
            changed = true;
        }
        const visibleSignature = visibleCellIds.join('|');
        if (this._mapVisibleSignature !== visibleSignature) {
            this._mapVisibleSignature = visibleSignature;
            changed = true;
        }
        if (changed) this._mapIntelRevision = (this._mapIntelRevision || 0) + 1;
        this._mapVisibleCells = visible;
        this._mapExploredCells = explored;
        return { mapKey, revision: this._mapIntelRevision || 0, exploredCellIds, visibleCellIds };
    },

    getMapVisibleEnemies() {
        if (!this._mapVisibleCells) this.refreshMapIntel();
        return this.getVisibleEnemies().filter((enemy) => this._mapVisibleCells.has(enemy.cellId));
    },

    mapCellIntel(cellId) {
        if (!this._mapVisibleCells || !this._mapExploredCells) this.refreshMapIntel();
        return { visible: this._mapVisibleCells.has(cellId), explored: this._mapExploredCells.has(cellId) };
    },

    getMapSettlements() {
        if (!this._mapExploredCells) this.refreshMapIntel();
        return this.getSettlements().filter((site) => site.owner !== 'enemy'
            || this._mapExploredCells.has(site.cellId) || this._mapVisibleCells.has(site.cellId));
    },

    getMapWars() {
        if (!this._mapExploredCells) this.refreshMapIntel();
        return this.getWars().filter((war) => war.source === 'world'
            || this._mapExploredCells.has(war.cellId) || this._mapVisibleCells.has(war.cellId));
    },

    mapHostileCells() {
        const occupied = new Set(this.getMapVisibleEnemies().map((enemy) => enemy.cellId));
        for (const site of this.getMapSettlements()) {
            if (site.owner === 'enemy' && site.status === 'active') occupied.add(site.cellId);
        }
        for (const war of this.getMapWars()) if (war.cellId) occupied.add(war.cellId);
        return occupied;
    },
};
