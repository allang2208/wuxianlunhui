import audioConfig from '../../data/audio-config.json';
import { SoundManager } from './sound-manager.js';
import { EventBus } from '../core/event-bus.js';

const config = audioConfig.uiCues.worldMap;
const storageKey = 'wuxian_world_map_audio_v1';
let preferences = null;
const lastPlayed = new Map();
const voices = new Map();
let lastThreatAt = -Infinity;

export const WorldMapAudio = {
    read() {
        if (!preferences) {
            let saved;
            try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch (_) { /* Session fallback. */ }
            const volume = saved?.volume;
            preferences = { enabled: saved?.enabled !== false,
                volume: typeof volume === 'number' && Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : config.defaultVolume };
        }
        return { ...preferences };
    },
    set(patch) {
        const next = { ...this.read(), ...patch };
        next.enabled = next.enabled !== false;
        next.volume = Math.max(0, Math.min(1, Number(next.volume) || 0));
        preferences = next;
        for (const [kind, voice] of voices) {
            if (!next.enabled || !next.volume) voice.stop();
            else voice.setVolume(config[kind].volume * next.volume);
            if (!voice.active) voices.delete(kind);
        }
        try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch (_) { /* Session fallback. */ }
    },
    play(kind) {
        const preference = this.read(), cue = config[kind];
        if (!cue || !preference.enabled || !preference.volume || !window.Game?.isRunning
            || window.Game._paused || document.hidden || !SoundManager.enabled
            || SoundManager.masterVolume <= 0 || SoundManager.channelVolumes.ui <= 0) return;
        const now = performance.now();
        if (now - (lastPlayed.get(kind) ?? -Infinity) < cue.guardMs) return;
        // A fresh threat stays audible; routine feedback never piles on top of it.
        if (kind !== 'threat' && (voices.get('threat')?.active || now - lastThreatAt < 1000)) return;
        lastPlayed.set(kind, now);
        if (kind === 'threat') {
            lastThreatAt = now;
            for (const voice of voices.values()) voice.stop();
            voices.clear();
        }
        voices.get(kind)?.stop();
        const voice = SoundManager.playFile(cue.path || audioConfig.uiCues[cue.cue], cue.volume * preference.volume, 'ui', { controllable: true });
        if (voice) voices.set(kind, voice);
        else voices.delete(kind);
    },
};

// One listener for the lifetime of the UI module, not one per map opening.
EventBus.on('strategy:journal-event', ({ kind, phase }) => {
    if (kind === 'battle' || kind === 'siege') WorldMapAudio.play('threat');
    else if (kind === 'arrival' || (kind === 'base_entry' && phase === 'complete')) WorldMapAudio.play('arrival');
    else if (['blocked', 'target_lost', 'order_rejected'].includes(kind)
        || (kind === 'base_entry' && phase === 'failed')) WorldMapAudio.play('rejected');
});
