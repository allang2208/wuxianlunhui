import { WorldProgressionSystem as Progression } from './world-progression-system.js';
import { WORLD_MAP_CELLS, worldMapInfo, strategicCell } from './world-map-cells.js';

const orderedIds = (ids) => WORLD_MAP_CELLS.filter((cell) => ids.has(cell.id)).map((cell) => cell.id);
const normalizeRevealedAreas = (areas = []) => Array.isArray(areas) ? areas
    .map((area) => ({
        key: String(area?.key || '').slice(0, 64),
        cellId: strategicCell(area?.cellId)?.id || null,
        radius: Math.max(0, Math.min(8, Math.floor(Number(area?.radius) || 0))),
    }))
    .filter((area) => area.key && area.cellId)
    .slice(-16) : [];

/** Persistent exploration plus current strategic sight. It does not advance simulation. */
export const StrategicMapIntel = {
    refreshMapIntel() {
        const mapKey = worldMapInfo().key;
        const saved = this.state.mapIntel?.mapKey === mapKey && Array.isArray(this.state.mapIntel.exploredCellIds)
            ? this.state.mapIntel.exploredCellIds : [];
        const explored = new Set(saved.filter((id) => strategicCell(id)));
        const visible = new Set();
        const revealedAreas = this.state.mapIntel?.mapKey === mapKey
            ? normalizeRevealedAreas(this.state.mapIntel.revealedAreas) : [];
        const revealTo = (target, cellId, radius = 0) => {
            const center = strategicCell(cellId);
            radius = Math.max(0, Math.min(8, Math.floor(Number(radius) || 0)));
            if (!center) return;
            for (let q = -radius; q <= radius; q++) {
                for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
                    const cell = strategicCell(`${center.q + q},${center.r + r}`);
                    if (cell) target.add(cell.id);
                }
            }
        };
        const reveal = (cellId, radius = 0) => revealTo(visible, cellId, radius);
        // A located planar signal is permanently known even if its portal is later destroyed.
        for (const sceneId of Progression.getWorldIds()) reveal(Progression.getWorldMapDiscovery(sceneId)?.cellId, 0);
        // Scenario reveals remain explored knowledge; the initial founding area is live sight only while choosing.
        for (const area of revealedAreas) revealTo(explored, area.cellId, area.radius);
        if (Progression.getFoundingState().status === 'selecting') {
            for (const area of revealedAreas.filter((entry) => entry.key === 'first_founding_recommendation')) {
                reveal(area.cellId, area.radius);
            }
        }
        const sources = this.getInvasionReconSources().map(({ cellId, radius }) => ({ cellId, radius }));
        for (const source of sources) reveal(source.cellId, source.radius);
        for (const id of visible) explored.add(id);
        const exploredCellIds = orderedIds(explored), visibleCellIds = orderedIds(visible);
        const exploredSignature = exploredCellIds.join('|');
        let changed = false;
        const revealedSignature = JSON.stringify(revealedAreas);
        if (this.state.mapIntel?.mapKey !== mapKey || this._mapExploredSignature !== exploredSignature
            || this._mapRevealedSignature !== revealedSignature) {
            this.state.mapIntel = { version: 2, mapKey, exploredCellIds, revealedAreas };
            this._mapExploredSignature = exploredSignature;
            this._mapRevealedSignature = revealedSignature;
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

    revealMapArea(cellId, radius = 0, { key = 'manual' } = {}) {
        const center = strategicCell(cellId);
        if (!center) return { ok: false, reason: '无效的地图坐标' };
        const mapKey = worldMapInfo().key;
        const areas = this.state.mapIntel?.mapKey === mapKey
            ? normalizeRevealedAreas(this.state.mapIntel.revealedAreas) : [];
        const normalized = {
            key: String(key || 'manual').slice(0, 64),
            cellId: center.id,
            radius: Math.max(0, Math.min(8, Math.floor(Number(radius) || 0))),
        };
        const index = areas.findIndex((area) => area.key === normalized.key);
        if (index >= 0 && areas[index].cellId === normalized.cellId
            && areas[index].radius === normalized.radius) {
            return { ok: true, ...this.refreshMapIntel() };
        }
        if (index >= 0) areas[index] = normalized;
        else areas.push(normalized);
        this.state.mapIntel = {
            version: 2,
            mapKey,
            exploredCellIds: this.state.mapIntel?.mapKey === mapKey
                ? [...(this.state.mapIntel.exploredCellIds || [])] : [],
            revealedAreas: normalizeRevealedAreas(areas),
        };
        this._mapExploredSignature = this._mapVisibleSignature = this._mapRevealedSignature = null;
        return { ok: true, ...this.refreshMapIntel() };
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
