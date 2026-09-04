import { SoundManager } from '../ui/sound-manager.js';

/** Opt-in one-shot footfalls; no loop survives stopping, death or scene removal. */
export function updateFriendlyMovementSound(unit, dt) {
    const cue = unit.sounds?.walk;
    if (!cue) return;
    const previousX = unit._walkSoundX;
    const previousY = unit._walkSoundY;
    unit._walkSoundX = unit.x;
    unit._walkSoundY = unit.y;
    const walking = ['walk', 'run', 'running', 'moving'].includes(unit._animState);
    const moved = Number.isFinite(previousX) && Number.isFinite(previousY)
        && Math.hypot(unit.x - previousX, unit.y - previousY) > 0.2;
    if (!walking || !moved || unit._dying || unit.data.hp <= 0
        || ['stun', 'frozen', 'petrified'].some((type) => unit.hasStatusEffect?.(type))) {
        unit._walkSoundLeft = 0;
        return;
    }
    unit._walkSoundLeft = Math.max(0, (unit._walkSoundLeft || 0) - dt);
    if (unit._walkSoundLeft > 0) return;
    const path = Array.isArray(cue) ? cue[Math.floor(Math.random() * cue.length)] : cue;
    if (!path) return;
    SoundManager.playWorld(path, unit.x, unit.y, unit.sounds.walkVolume ?? 0.3);
    unit._walkSoundLeft = unit.sounds.walkInterval ?? 500;
}
