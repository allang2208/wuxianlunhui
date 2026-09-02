import audioConfig from '../../data/audio-config.json';
import { SoundManager } from './sound-manager.js';

// v3 加入逐幕镜头、局部环境效果和音效；让已经验收过 v2 的玩家能再观看一次新版。
const OPENING_SEEN_KEY = 'infiniteLoop_opening_seen_v3';
const OPENING_AUDIO = audioConfig.openingCinematic || {};

const OPENING_FRAMES = [
    {
        src: './assets/scenes/opening/01-grave-lightning.png',
        holdMs: 2800,
        motion: 'grave-push',
        effect: 'storm',
        ambience: 'graveStorm',
    },
    {
        src: './assets/scenes/opening/02-awakened-skull.png',
        holdMs: 2600,
        motion: 'skull-breathe',
        effect: 'grave-dust',
        ambience: 'graveStorm',
    },
    {
        src: './assets/scenes/opening/03-memory-slip.png',
        holdMs: 2400,
        motion: 'memory-drift',
        effect: 'memory',
        ambience: 'mountainWind',
    },
    {
        src: './assets/scenes/opening/04-memory-fall.png',
        holdMs: 2400,
        motion: 'memory-fall',
        effect: 'fall',
        ambience: 'mountainWind',
        cues: ['stoneAvalanche'],
    },
    // 回忆结束必须回到同一张骷髅画面，不能重绘镜头或改变坟墓布局。
    {
        src: './assets/scenes/opening/02-awakened-skull.png',
        holdMs: 2200,
        motion: 'recall-focus',
        effect: 'recall',
        ambience: 'graveStorm',
    },
    {
        src: './assets/scenes/opening/05-teleport-start.png',
        holdMs: 2200,
        motion: 'teleport-push',
        effect: 'teleport',
        ambience: 'graveStorm',
        cues: ['teleport'],
    },
    {
        src: './assets/scenes/opening/06-teleport-peak.png',
        holdMs: 1900,
        motion: 'teleport-peak',
        effect: 'teleport-peak',
        ambience: 'graveStorm',
        cues: ['energyFlow'],
    },
    {
        src: './assets/scenes/opening/07-empty-grave.png',
        holdMs: 2200,
        motion: 'empty-pull',
        effect: 'storm-after',
        ambience: 'graveStorm',
    },
    {
        src: './assets/scenes/opening/08-main-hub-arrival.png',
        holdMs: 2600,
        motion: 'hub-rise',
        effect: 'hub',
        cues: ['teleport', 'choirShine'],
    },
    {
        src: './assets/scenes/opening/09-skeleton-formed.png',
        holdMs: 2500,
        motion: 'body-forge',
        effect: 'forge',
        cues: ['energyFlow'],
    },
    {
        src: './assets/scenes/opening/10-skeleton-standing.png',
        holdMs: 2600,
        motion: 'standing-settle',
        effect: 'settle',
        cues: ['choirShine'],
    },
];

function hasSeenOpening() {
    try {
        return localStorage.getItem(OPENING_SEEN_KEY) === 'true';
    } catch (_error) {
        return false;
    }
}

function rememberOpening() {
    try {
        localStorage.setItem(OPENING_SEEN_KEY, 'true');
    } catch (_error) {
        // 无持久存储时仍允许本次会话正常进入菜单。
    }
}

export const OpeningCinematic = {
    _overlay: null,
    _layers: [],
    _skipButton: null,
    _gameContainer: null,
    _gameContainerWasInert: false,
    _timer: 0,
    _fastForwardTimer: 0,
    _transitionToken: 0,
    _frameIndex: 0,
    _activeLayer: 0,
    _playing: false,
    _finished: false,
    _onComplete: null,
    _atmosphere: null,
    _ambientKey: null,
    _ambientHandle: null,
    _cueHandles: [],
    _audioPreloaders: [],

    play({ onComplete = null, force = false } = {}) {
        if (this._overlay) return false;
        if (!force && hasSeenOpening()) {
            Promise.resolve(onComplete?.({ previouslySeen: true })).catch((error) => {
                console.error('[OpeningCinematic] 跳过已观看序章后的启动回调失败:', error);
            });
            return false;
        }
        this._frameIndex = 0;
        this._activeLayer = 0;
        this._finished = false;
        this._onComplete = onComplete;
        SoundManager.init();
        this._build();
        this._playing = true;
        document.body.classList.add('opening-cinematic-active');
        this._preloadFrames();
        this._preloadAudio();
        this._showFrame(0);
        return true;
    },

    _build() {
        const overlay = document.createElement('section');
        overlay.id = 'openingCinematic';
        overlay.className = 'opening-cinematic';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', '序章');

        for (let index = 0; index < 2; index += 1) {
            const image = document.createElement('img');
            image.className = 'opening-cinematic-frame';
            image.alt = '';
            image.setAttribute('aria-hidden', 'true');
            image.draggable = false;
            overlay.appendChild(image);
            this._layers.push(image);
        }

        const atmosphere = document.createElement('div');
        atmosphere.className = 'opening-cinematic-atmosphere';
        atmosphere.setAttribute('aria-hidden', 'true');
        overlay.appendChild(atmosphere);

        const whiteout = document.createElement('div');
        whiteout.className = 'opening-cinematic-whiteout';
        whiteout.setAttribute('aria-hidden', 'true');
        overlay.appendChild(whiteout);

        const skipButton = document.createElement('button');
        skipButton.type = 'button';
        skipButton.className = 'opening-cinematic-skip';
        skipButton.dataset.uiClickSound = 'off';
        skipButton.setAttribute('aria-label', '跳过序章');
        skipButton.innerHTML = '<span>SKIP</span><i aria-hidden="true"></i><i aria-hidden="true"></i>';
        skipButton.addEventListener('click', () => this.finish({ skipped: true }));
        overlay.appendChild(skipButton);
        overlay.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.target.closest('.opening-cinematic-skip')) return;
            event.preventDefault();
            this._advanceFrame();
        });

        document.body.appendChild(overlay);
        this._overlay = overlay;
        this._atmosphere = atmosphere;
        this._skipButton = skipButton;
        this._gameContainer = document.getElementById('gameContainer');
        this._gameContainerWasInert = this._gameContainer?.inert ?? false;
        if (this._gameContainer) this._gameContainer.inert = true;
        overlay.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab') return;
            event.preventDefault();
            skipButton.focus({ preventScroll: true });
        });
        requestAnimationFrame(() => overlay.classList.add('is-visible'));
    },

    _preloadFrames() {
        const uniqueSources = [...new Set(OPENING_FRAMES.map((frame) => frame.src))];
        for (const src of uniqueSources.slice(1)) {
            const image = new Image();
            image.decoding = 'async';
            image.src = src;
        }
    },

    _preloadAudio() {
        const uniquePaths = [...new Set(Object.values(OPENING_AUDIO)
            .map((entry) => entry?.path)
            .filter(Boolean))];
        this._audioPreloaders = uniquePaths.map((path) => {
            const audio = new Audio(path);
            audio.preload = 'auto';
            audio.load();
            return audio;
        });
    },

    _playConfiguredAudio(key) {
        const entry = OPENING_AUDIO[key];
        if (!entry?.path) return null;
        return SoundManager.playFile(
            entry.path,
            Number.isFinite(entry.volume) ? entry.volume : 1,
            'sfx',
            { controllable: true }
        ) || null;
    },

    _stopCueAudio() {
        for (const handle of this._cueHandles) handle?.stop?.();
        this._cueHandles = [];
    },

    _syncFrameAudio(frame) {
        this._stopCueAudio();
        const nextAmbientKey = frame.ambience || null;
        if (nextAmbientKey !== this._ambientKey) {
            this._ambientHandle?.stop?.();
            this._ambientHandle = null;
            this._ambientKey = nextAmbientKey;
            if (nextAmbientKey) this._ambientHandle = this._playConfiguredAudio(nextAmbientKey);
        }
        for (const cue of frame.cues || []) {
            const handle = this._playConfiguredAudio(cue);
            if (handle) this._cueHandles.push(handle);
        }
    },

    _stopAllAudio() {
        this._stopCueAudio();
        this._ambientHandle?.stop?.();
        this._ambientHandle = null;
        this._ambientKey = null;
        for (const audio of this._audioPreloaders) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        }
        this._audioPreloaders = [];
    },

    _showFrame(index) {
        if (!this._playing || this._finished) return;
        const transitionToken = ++this._transitionToken;
        if (index >= OPENING_FRAMES.length) {
            this._showWhiteout();
            return;
        }

        this._frameIndex = index;
        const frame = OPENING_FRAMES[index];
        const nextLayerIndex = index === 0 ? 0 : 1 - this._activeLayer;
        const nextLayer = this._layers[nextLayerIndex];
        const previousLayer = this._layers[this._activeLayer];
        let settled = false;

        const reveal = () => {
            if (settled || transitionToken !== this._transitionToken || !this._playing || this._finished) return;
            settled = true;
            nextLayer.classList.remove('is-motion-active');
            nextLayer.dataset.motion = frame.motion || 'still';
            nextLayer.style.setProperty('--opening-frame-duration', `${frame.holdMs + 900}ms`);
            // 双缓冲图片节点会被复用；强制一次布局以重新启动该幕的轻推镜动画。
            void nextLayer.offsetWidth;
            nextLayer.classList.add('is-active');
            nextLayer.classList.add('is-motion-active');
            if (nextLayer !== previousLayer) previousLayer.classList.remove('is-active');
            this._activeLayer = nextLayerIndex;
            if (this._overlay) this._overlay.dataset.effect = frame.effect || 'none';
            this._syncFrameAudio(frame);
            window.clearTimeout(this._timer);
            this._timer = window.setTimeout(() => this._showFrame(index + 1), frame.holdMs);
        };

        nextLayer.onload = reveal;
        nextLayer.onerror = () => {
            if (settled || transitionToken !== this._transitionToken || !this._playing || this._finished) return;
            settled = true;
            console.warn('[OpeningCinematic] 序章图片加载失败，继续下一幕:', frame.src);
            this._timer = window.setTimeout(() => this._showFrame(index + 1), 80);
        };
        nextLayer.src = frame.src;
        if (nextLayer.complete && nextLayer.naturalWidth > 0) requestAnimationFrame(reveal);
    },

    _advanceFrame() {
        if (!this._playing || this._finished || !this._overlay) return;
        if (this._overlay.classList.contains('is-whiteout')) {
            this.finish();
            return;
        }
        window.clearTimeout(this._timer);
        window.clearTimeout(this._fastForwardTimer);
        this._overlay.classList.add('is-fast-forward');
        this._fastForwardTimer = window.setTimeout(() => {
            this._overlay?.classList.remove('is-fast-forward');
        }, 260);
        this._showFrame(this._frameIndex + 1);
    },

    _showWhiteout() {
        if (!this._overlay || this._finished) return;
        window.clearTimeout(this._timer);
        this._overlay.classList.add('is-whiteout');
        this._skipButton?.setAttribute('tabindex', '-1');
        this._timer = window.setTimeout(() => this.finish(), 1400);
    },

    finish({ skipped = false } = {}) {
        if (this._finished) return;
        this._finished = true;
        this._playing = false;
        this._transitionToken += 1;
        window.clearTimeout(this._timer);
        window.clearTimeout(this._fastForwardTimer);
        this._stopAllAudio();
        rememberOpening();
        document.body.classList.remove('opening-cinematic-active');
        if (this._gameContainer) this._gameContainer.inert = this._gameContainerWasInert;
        const onComplete = this._onComplete;
        this._onComplete = null;
        Promise.resolve(onComplete?.({ skipped })).catch((error) => {
            console.error('[OpeningCinematic] 序章结束后的新游戏启动失败:', error);
        });

        const overlay = this._overlay;
        if (!overlay) return;
        overlay.classList.toggle('was-skipped', skipped);
        overlay.classList.add('is-exiting');
        window.setTimeout(() => {
            overlay.remove();
            this._overlay = null;
            this._layers = [];
            this._skipButton = null;
            this._gameContainer = null;
            this._atmosphere = null;
        }, skipped ? 260 : 720);
    },
};
