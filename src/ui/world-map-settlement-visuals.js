// Strategic miniature art only; settlements/ownership remain campaign records.
import settlements from '../../data/world-map-settlements.json';

export const SETTLEMENT_ATLAS_URL = new URL('../../assets/ui/world-map/settlements.png', import.meta.url).href;
export const SETTLEMENT_ATLAS = settlements;

export function settlementFrame(site, cell) {
    // Real player-built world portals keep their existing map marker.
    if (site.kind !== 'town' && site.kind !== 'outpost') return null;
    const profile = site.status === 'destroyed' ? 'destroyed' : cell.biome;
    return settlements.frames[`${profile}_${site.kind}`] || settlements.frames[`ruins_${site.kind}`];
}
