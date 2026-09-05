// Shared by Canvas markers and the DOM roster; art never changes army/save data.
import flags from '../../data/world-map-army-visuals.json';
import settlerFlag from '../../data/world-map-settler-visuals.json';

export const ARMY_FLAG_ATLAS_URL = new URL('../../assets/ui/world-map/army-flags.png', import.meta.url).href;
export const ARMY_FLAG_ATLAS = flags;
export const PLAYER_ARMY_MARKER_ID = '__player_army__';
export const SETTLER_PIECE_URL = new URL('../../assets/ui/world-map/settler-flag.png', import.meta.url).href;
export const SETTLER_PIECE = settlerFlag;

export function armyFlagFrame(army) {
    return flags.frames[army?.friendly ? 'player' : army?.type] || flags.frames.ruin_watch;
}

export function armyFlagPortrait(army) {
    const frame = armyFlagFrame(army);
    const x = frame.column * 100 / (flags.columns - 1);
    const y = frame.row * 100 / (flags.rows - 1);
    return `<span class="wm-flag-portrait" aria-hidden="true" style="--wm-flag-x:${x}%;--wm-flag-y:${y}%"></span>`;
}
