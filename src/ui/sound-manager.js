        // ==================== 音效管理系统 ====================
        import audioConfig from '../../data/audio-config.json';

        // 音量持久化防抖句柄（滑块 input 高频触发时合并写入）
        let _volumeSaveTimer = null;
        const FILE_AUDIO_PERF = audioConfig.performance || {};
        const FILE_AUDIO_MAX_VOICES = Math.max(1, Number(FILE_AUDIO_PERF.fileVoiceLimit) || 24);
        const FILE_AUDIO_MAX_PER_PATH = Math.max(1, Number(FILE_AUDIO_PERF.perPathVoiceLimit) || 4);
        const FILE_AUDIO_MAX_CACHED_PATHS = Math.max(1, Number(FILE_AUDIO_PERF.cachedPathLimit) || 64);
        const FILE_AUDIO_REPEAT_GUARD_MS = Math.max(0, Number(FILE_AUDIO_PERF.repeatGuardMs) || 35);
        const FILE_AUDIO_RAPID_MAX_PER_PATH = Math.max(
            FILE_AUDIO_MAX_PER_PATH,
            Number(FILE_AUDIO_PERF.rapidFirePerPathVoiceLimit) || 24
        );
        const FILE_AUDIO_RAPID_MAX_VOICES = Math.max(
            FILE_AUDIO_RAPID_MAX_PER_PATH,
            Number(FILE_AUDIO_PERF.rapidFireVoiceLimit) || 32
        );
        const rapidRepeatGuard = Number(FILE_AUDIO_PERF.rapidFireRepeatGuardMs);
        const FILE_AUDIO_RAPID_REPEAT_GUARD_MS = Number.isFinite(rapidRepeatGuard)
            ? Math.max(0, rapidRepeatGuard)
            : 0;

        // 三种程序合成滚雷：近雷短促、连续滚雷、远雷低沉。每次闪电随机选择一种。
        const THUNDER_VARIANTS = Object.freeze([
            Object.freeze({
                duration: 2.2,
                brownStep: 0.16,
                cutoffStart: 620,
                cutoffEnd: 120,
                noiseAttack: 0.025,
                noisePeak: 0.82,
                noiseShoulderTime: 0.42,
                noiseShoulder: 0.15,
                rumbleStart: 72,
                rumbleEnd: 34,
                rumbleAttack: 0.018,
                rumblePeak: 0.48,
                rumbleDuration: 1.45,
            }),
            Object.freeze({
                duration: 3.6,
                brownStep: 0.11,
                cutoffStart: 300,
                cutoffEnd: 74,
                noiseAttack: 0.085,
                noisePeak: 0.7,
                noiseShoulderTime: 1.35,
                noiseShoulder: 0.22,
                rumbleStart: 54,
                rumbleEnd: 25,
                rumbleAttack: 0.05,
                rumblePeak: 0.42,
                rumbleDuration: 2.45,
                echoDelay: 0.72,
                echoStart: 43,
                echoEnd: 22,
                echoPeak: 0.2,
            }),
            Object.freeze({
                duration: 4.4,
                brownStep: 0.075,
                cutoffStart: 185,
                cutoffEnd: 52,
                noiseAttack: 0.18,
                noisePeak: 0.52,
                noiseShoulderTime: 2.1,
                noiseShoulder: 0.2,
                rumbleStart: 41,
                rumbleEnd: 19,
                rumbleAttack: 0.12,
                rumblePeak: 0.34,
                rumbleDuration: 3.4,
                echoDelay: 1.35,
                echoStart: 34,
                echoEnd: 17,
                echoPeak: 0.16,
            }),
        ]);

        export const SoundManager = {
            ctx: null,
            masterVolume: 0.6,
            enabled: true,
            // 声道音量（data/audio-config.json channels；sfx/ui/music 二级调节）
            channelVolumes: { ...(audioConfig.channels || { sfx: 1, ui: 1, music: 0.6 }) },
            // 世界音效距离衰减配置（data/audio-config.json distanceAttenuation；
            // 默认传播距离/循环衰减曲线都在配置里，后续调整只改配置不硬编码）
            _distance: audioConfig.distanceAttenuation || {},
            _stepTimer: 0,
            _stepInterval: 280,
            _initialized: false,
            _buttonClickBound: false,
            _filePools: new Map(),
            _fileLastPlayedAt: new Map(),
            _activeFileVoices: 0,
            // 高频枪声单独使用已解码 AudioBuffer。HTML Audio 池只承担首次解码前/解码失败兜底，
            // 避免 55~60ms 连射反复触发 media element 的异步 play/seek 调度。
            _gunshotBuffers: new Map(),
            _gunshotBufferLoads: new Map(),
            _gunshotBufferFailures: new Set(),
            _gunshotVoices: [],

            init() {
                if (this._initialized) return;
                this._bindButtonClickSound();
                try {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (AudioContext) {
                        this.ctx = new AudioContext();
                        this._initialized = true;
                        this._loadSavedVolumes();
                        this._preloadGunshotBuffers();
                    }
                } catch (e) { console.warn('Web Audio API 不可用:', e); }
            },

            /**
             * 全局按钮点击反馈：捕获阶段覆盖动态面板以及会停止冒泡的业务按钮。
             * 只响应原生按钮语义，禁用按钮不播放；路径与声道统一走 audio-config。
             */
            _bindButtonClickSound() {
                if (this._buttonClickBound || typeof document === 'undefined') return;
                this._buttonClickBound = true;
                document.addEventListener('click', (event) => {
                    const target = event.target;
                    if (!(target instanceof Element)) return;
                    const button = target.closest(
                        'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
                    );
                    if (!button || button.matches(':disabled, .disabled, [aria-disabled="true"], [data-disabled="true"]')
                        || button.closest('[inert]') || button.dataset.uiClickSound === 'off') return;
                    const path = audioConfig.uiCues?.buttonClick;
                    if (path) this.playFile(path, 1, 'ui');
                }, true);
            },

            /** 读回上次设置的音量（localStorage，主音量/背景音量） */
            _loadSavedVolumes() {
                try {
                    const master = parseFloat(localStorage.getItem('wuxian_audio_master'));
                    if (Number.isFinite(master)) this.masterVolume = Math.max(0, Math.min(1, master));
                    const music = parseFloat(localStorage.getItem('wuxian_audio_music'));
                    if (Number.isFinite(music)) this.channelVolumes.music = Math.max(0, Math.min(1, music));
                } catch (_e) { /* localStorage 不可用时忽略 */ }
            },

            _saveVolumes() {
                // 150ms trailing 防抖：拖动滑块时只落盘一次，避免每次 input 都写 localStorage
                if (_volumeSaveTimer) clearTimeout(_volumeSaveTimer);
                _volumeSaveTimer = setTimeout(() => {
                    _volumeSaveTimer = null;
                    try {
                        localStorage.setItem('wuxian_audio_master', String(this.masterVolume));
                        localStorage.setItem('wuxian_audio_music', String(this.channelVolumes.music ?? 1));
                    } catch (_e) { /* 忽略 */ }
                }, 150);
            },

            _ensureCtx() {
                if (!this.ctx) this.init();
                if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
                return !!this.ctx;
            },

            _now() { return this.ctx ? this.ctx.currentTime : 0; },

            _gain(val, when) {
                const g = this.ctx.createGain();
                g.gain.setValueAtTime(val, when);
                return g;
            },

            play(type) {
                if (!this.enabled || !this._ensureCtx()) return;
                switch (type) {
                    case 'melee_swing': this._playMeleeSwing(); break;
                    case 'bow_fire': this._playBowFire(); break;
                    case 'gun_fire': this._playGunFire(); break;
                    case 'hit': this._playHit(); break;
                    case 'crit': this._playCrit(); break;
                    case 'hitmark': this._playHitmark(); break;
                    case 'hitmark_crit': this._playHitmarkCrit(); break;
                    case 'kill_confirm': this._playKillConfirm(); break;
                    case 'dodge': this._playDodge(); break;
                    case 'pickup': this._playPickup(); break;
                    case 'drop': this._playDrop(); break;
                    case 'equip': this._playEquip(); break;
                    case 'switch_weapon': this._playSwitchWeapon(); break;
                    case 'panel_open': this._playPanelOpen(); break;
                    case 'panel_close': this._playPanelClose(); break;
                    case 'enemy_death': this._playEnemyDeath(); break;
                    case 'player_hurt': this._playPlayerHurt(); break;
                    case 'wall_hit': this._playWallHit(); break;
                    case 'step': this._playStep(); break;
                }
            },

            // 播放外部音频文件（.mp3, .wav 等）；channel 走声道音量（默认 sfx）。
            // options.rapidFire 只供逐发枪声使用：放宽同路径池并在池满时抢占最旧尾音，
            // 确保每次击发的枪口瞬态都能播放，同时仍受全局 voice 上限约束。
            playFile(path, volume = 1.0, channel = 'sfx', options = null) {
                if (!this.enabled || !path) return;
                const chVol = this.channelVolumes[channel] ?? this.channelVolumes.sfx ?? 1;
                const finalVolume = Math.max(0, Math.min(1, volume * chVol * this.masterVolume));
                if (finalVolume <= 0) return;
                try {
                    const now = performance.now();
                    const rapidFire = options?.rapidFire === true;
                    const repeatGuardMs = rapidFire
                        ? FILE_AUDIO_RAPID_REPEAT_GUARD_MS
                        : FILE_AUDIO_REPEAT_GUARD_MS;
                    const perPathLimit = rapidFire
                        ? FILE_AUDIO_RAPID_MAX_PER_PATH
                        : FILE_AUDIO_MAX_PER_PATH;
                    const lastPlayedAt = this._fileLastPlayedAt.get(path);
                    if (Number.isFinite(lastPlayedAt) && now - lastPlayedAt < repeatGuardMs) return;

                    let pool = this._filePools.get(path);
                    if (!pool) {
                        this._trimFilePools();
                        if (this._filePools.size >= FILE_AUDIO_MAX_CACHED_PATHS) return;
                        pool = { voices: [], lastUsedAt: now };
                        this._filePools.set(path, pool);
                    }
                    pool.lastUsedAt = now;
                    const oldestBusyVoice = () => pool.voices.reduce((oldest, voice) => {
                        if (!voice._smBusy) return oldest;
                        if (!oldest || (voice._smStartedAt || 0) < (oldest._smStartedAt || 0)) return voice;
                        return oldest;
                    }, null);

                    let audio = null;
                    let stealBusyVoice = false;
                    // 全局池已满时，高速枪声只能替换本枪最旧尾音，绝不突破全局 voice 上限。
                    if (rapidFire && this._activeFileVoices >= FILE_AUDIO_MAX_VOICES) {
                        audio = oldestBusyVoice();
                        stealBusyVoice = !!audio;
                    } else {
                        audio = pool.voices.find((voice) => !voice._smBusy);
                    }
                    if (!audio && this._activeFileVoices < FILE_AUDIO_MAX_VOICES
                        && pool.voices.length < perPathLimit) {
                        audio = new Audio(path);
                        audio.preload = 'auto';
                        audio._smBusy = false;
                        const release = () => {
                            if (!audio._smBusy) return;
                            audio._smBusy = false;
                            this._activeFileVoices = Math.max(0, this._activeFileVoices - 1);
                        };
                        audio.addEventListener('ended', release);
                        audio.addEventListener('error', release);
                        pool.voices.push(audio);
                    }
                    if (!audio && rapidFire) {
                        audio = oldestBusyVoice();
                        stealBusyVoice = !!audio;
                    }
                    if (!audio) return;

                    if (stealBusyVoice && audio._smBusy) {
                        audio.pause();
                        audio._smBusy = false;
                        this._activeFileVoices = Math.max(0, this._activeFileVoices - 1);
                    }

                    // 部分浏览器在媒体元数据尚未就绪时会拒绝 seek；首播从0开始，无需因此占住声道。
                    try { audio.currentTime = 0; } catch (_e) { /* 未加载时保持默认播放头 */ }
                    audio._smBusy = true;
                    audio._smStartedAt = now;
                    audio._smPlayToken = (audio._smPlayToken || 0) + 1;
                    const playToken = audio._smPlayToken;
                    this._activeFileVoices++;
                    this._fileLastPlayedAt.set(path, now);
                    audio.volume = finalVolume;
                    audio.play().catch((e) => {
                        if (options?.controllable && audio._smPlayToken !== playToken) return;
                        if (audio._smBusy && audio._smPlayToken === playToken) {
                            audio._smBusy = false;
                            this._activeFileVoices = Math.max(0, this._activeFileVoices - 1);
                        }
                        console.warn('SoundManager.playFile failed:', path, e.message);
                    });
                    // 可选的单次播放句柄：只停止本调用占用的池化声道，不误停同路径的新播放。
                    if (options?.controllable) {
                        const ownsVoice = () => audio._smBusy && audio._smPlayToken === playToken;
                        return {
                            get active() { return ownsVoice(); },
                            stop: () => {
                                if (!ownsVoice()) return;
                                audio.pause();
                                audio._smPlayToken++;
                                audio._smBusy = false;
                                this._activeFileVoices = Math.max(0, this._activeFileVoices - 1);
                            },
                            setVolume: (value) => {
                                if (ownsVoice()) audio.volume = Math.max(0, Math.min(1,
                                    value * this.masterVolume * (this.channelVolumes[channel] ?? 1)));
                            },
                        };
                    }
                } catch (e) {
                    console.warn('SoundManager.playFile error:', path, e);
                }
            },

            _loadGunshotBuffer(path) {
                if (this._gunshotBuffers.has(path)) {
                    return Promise.resolve(this._gunshotBuffers.get(path));
                }
                if (this._gunshotBufferFailures.has(path)) return Promise.resolve(null);
                const pending = this._gunshotBufferLoads.get(path);
                if (pending) return pending;
                if (!this.ctx) this.init();
                if (!this.ctx) return Promise.resolve(null);

                const load = fetch(path)
                    .then((response) => {
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        return response.arrayBuffer();
                    })
                    .then((data) => this.ctx.decodeAudioData(data))
                    .then((buffer) => {
                        this._gunshotBuffers.set(path, buffer);
                        this._gunshotBufferLoads.delete(path);
                        return buffer;
                    })
                    .catch((error) => {
                        this._gunshotBufferLoads.delete(path);
                        this._gunshotBufferFailures.add(path);
                        console.warn('SoundManager gunshot decode failed; using HTML Audio fallback:', path, error.message);
                        return null;
                    });
                this._gunshotBufferLoads.set(path, load);
                return load;
            },

            _preloadGunshotBuffers() {
                const paths = FILE_AUDIO_PERF.gunshotPreloadPaths;
                if (!Array.isArray(paths)) return;
                for (const path of new Set(paths)) {
                    if (typeof path === 'string' && path) this._loadGunshotBuffer(path);
                }
            },

            _releaseGunshotVoice(voice, stop = false) {
                const index = this._gunshotVoices.indexOf(voice);
                if (index >= 0) this._gunshotVoices.splice(index, 1);
                if (!voice) return;
                voice.source.onended = null;
                if (stop) {
                    try { voice.source.stop(); } catch (_e) { /* 已自然结束时忽略 */ }
                }
                try { voice.source.disconnect(); } catch (_e) { /* 忽略 */ }
                try { voice.gain.disconnect(); } catch (_e) { /* 忽略 */ }
            },

            _playDecodedGunshot(path, buffer, finalVolume) {
                if (!buffer || !this.ctx) return false;

                const samePath = this._gunshotVoices
                    .filter((voice) => voice.path === path)
                    .sort((a, b) => a.startedAt - b.startedAt);
                if (samePath.length >= FILE_AUDIO_RAPID_MAX_PER_PATH) {
                    this._releaseGunshotVoice(samePath[0], true);
                }
                if (this._gunshotVoices.length >= FILE_AUDIO_RAPID_MAX_VOICES) {
                    const oldest = this._gunshotVoices.reduce((candidate, voice) => (
                        !candidate || voice.startedAt < candidate.startedAt ? voice : candidate
                    ), null);
                    if (oldest) this._releaseGunshotVoice(oldest, true);
                }

                const startedAt = this.ctx.currentTime;
                const source = this.ctx.createBufferSource();
                const gain = this.ctx.createGain();
                source.buffer = buffer;
                gain.gain.setValueAtTime(finalVolume, startedAt);
                source.connect(gain).connect(this.ctx.destination);
                const voice = { path, source, gain, startedAt };
                source.onended = () => this._releaseGunshotVoice(voice);
                this._gunshotVoices.push(voice);
                try {
                    source.start(startedAt);
                } catch (error) {
                    this._releaseGunshotVoice(voice);
                    console.warn('SoundManager decoded gunshot start failed; using HTML Audio fallback:', path, error.message);
                    return false;
                }
                return true;
            },

            /**
             * 逐发枪声专用入口：缓存解码后的 AudioBuffer，每次击发创建轻量 one-shot source。
             * 首次解码期间或格式解码失败时才退回 rapidFire HTML Audio 池。
             */
            playGunshot(path, volume = 1.0, channel = 'sfx') {
                if (!this.enabled || !path) return;
                const chVol = this.channelVolumes[channel] ?? this.channelVolumes.sfx ?? 1;
                const finalVolume = Math.max(0, Math.min(1, volume * chVol * this.masterVolume));
                if (finalVolume <= 0) return;

                const buffer = this._gunshotBuffers.get(path);
                if (buffer && this._ensureCtx() && this._playDecodedGunshot(path, buffer, finalVolume)) return;

                // 不等待异步解码，保证第一次扣扳机仍立即有声；同一路径只会发起一次加载。
                if (!this._gunshotBufferFailures.has(path)) this._loadGunshotBuffer(path);
                this.playFile(path, volume, channel, { rapidFire: true });
            },

            _trimFilePools() {
                if (this._filePools.size < FILE_AUDIO_MAX_CACHED_PATHS) return;
                let oldestPath = null;
                let oldestAt = Infinity;
                for (const [cachedPath, pool] of this._filePools) {
                    if (pool.voices.some((voice) => voice._smBusy)) continue;
                    if (pool.lastUsedAt < oldestAt) {
                        oldestAt = pool.lastUsedAt;
                        oldestPath = cachedPath;
                    }
                }
                if (!oldestPath) return;
                const pool = this._filePools.get(oldestPath);
                for (const voice of pool?.voices || []) {
                    voice.removeAttribute('src');
                    voice.load();
                }
                this._filePools.delete(oldestPath);
                this._fileLastPlayedAt.delete(oldestPath);
            },

            /**
             * 暴风雨雷声：随机合成近雷、连续滚雷或远雷，不复用闪电技能的高频电击音。
             * 低通棕噪声提供雷云质感，低频正弦提供雷压；统一走 sfx/master 音量。
             */
            playThunder(volume = 0.7) {
                if (!this.enabled || !this._ensureCtx()) return;
                const t = this._now();
                const variant = THUNDER_VARIANTS[Math.floor(Math.random() * THUNDER_VARIANTS.length)];
                const duration = variant.duration;
                const channelVolume = this.channelVolumes.sfx ?? 1;
                const finalVolume = Math.max(0, Math.min(1,
                    Number(volume) * channelVolume * this.masterVolume));
                if (finalVolume <= 0) return;

                const noise = this.ctx.createBufferSource();
                const buffer = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * duration), this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                let brown = 0;
                for (let i = 0; i < data.length; i++) {
                    brown = (brown + (Math.random() * 2 - 1) * variant.brownStep) / 1.055;
                    const decay = 1 - i / data.length;
                    data[i] = brown * decay;
                }
                noise.buffer = buffer;

                const lowpass = this.ctx.createBiquadFilter();
                lowpass.type = 'lowpass';
                lowpass.frequency.setValueAtTime(variant.cutoffStart, t);
                lowpass.frequency.exponentialRampToValueAtTime(variant.cutoffEnd, t + duration);
                lowpass.Q.setValueAtTime(0.7, t);

                const noiseGain = this.ctx.createGain();
                noiseGain.gain.setValueAtTime(0.001, t);
                noiseGain.gain.linearRampToValueAtTime(variant.noisePeak * finalVolume, t + variant.noiseAttack);
                noiseGain.gain.exponentialRampToValueAtTime(
                    variant.noiseShoulder * finalVolume,
                    t + variant.noiseShoulderTime
                );
                noiseGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
                noise.connect(lowpass).connect(noiseGain).connect(this.ctx.destination);

                const rumble = this.ctx.createOscillator();
                rumble.type = 'sine';
                rumble.frequency.setValueAtTime(variant.rumbleStart, t);
                rumble.frequency.exponentialRampToValueAtTime(variant.rumbleEnd, t + variant.rumbleDuration);
                const rumbleGain = this.ctx.createGain();
                rumbleGain.gain.setValueAtTime(0.001, t);
                rumbleGain.gain.linearRampToValueAtTime(
                    variant.rumblePeak * finalVolume,
                    t + variant.rumbleAttack
                );
                rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + variant.rumbleDuration);
                rumble.connect(rumbleGain).connect(this.ctx.destination);

                let echo = null;
                if (variant.echoDelay) {
                    echo = this.ctx.createOscillator();
                    echo.type = 'sine';
                    echo.frequency.setValueAtTime(variant.echoStart, t + variant.echoDelay);
                    echo.frequency.exponentialRampToValueAtTime(variant.echoEnd, t + duration);
                    const echoGain = this.ctx.createGain();
                    echoGain.gain.setValueAtTime(0.001, t + variant.echoDelay);
                    echoGain.gain.linearRampToValueAtTime(
                        variant.echoPeak * finalVolume,
                        t + variant.echoDelay + 0.12
                    );
                    echoGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
                    echo.connect(echoGain).connect(this.ctx.destination);
                }

                noise.start(t);
                noise.stop(t + duration);
                rumble.start(t);
                rumble.stop(t + variant.rumbleDuration);
                if (echo) {
                    echo.start(t + variant.echoDelay);
                    echo.stop(t + duration);
                }
            },

            /**
             * 一次性位置音效：按播放瞬间声源与玩家的距离计算音量倍率，
             * 超出 maxDist 直接不播。
             * @param {string} path 音频路径
             * @param {number} x 声源世界坐标 x
             * @param {number} y 声源世界坐标 y
             * @param {number} [volume=1.0] 基础音量（近端满音量）
             * @param {string} [channel='sfx'] 声道
             * @param {object} [opts] 衰减参数：nearDist（满音量距离，默认 0）/ maxDist（静音距离，默认 2000）
             */
            playFileAt(path, x, y, volume = 1.0, channel = 'sfx', opts = {}) {
                if (!this.enabled) return;
                const p = (typeof window !== 'undefined' && window.Game && window.Game.player) || null;
                const d = (p && p.active) ? Math.hypot(p.x - x, p.y - y) : 0;
                // 距离衰减总开关：enabled=false 时退化为全局音量（近端满音量），不静音
                const effectiveOpts = (this._distance && this._distance.enabled === false)
                    ? { nearDist: 0, maxDist: Infinity }
                    : opts;
                const gain = this.distanceGain(d, effectiveOpts);
                if (gain <= 0) return;
                this.playFile(path, volume * gain, channel);
            },

            /** 带距离衰减的逐发枪声，供敌人/世界单位射击使用。 */
            playGunshotAt(path, x, y, volume = 1.0, channel = 'sfx', opts = {}) {
                if (!this.enabled) return;
                const p = (typeof window !== 'undefined' && window.Game && window.Game.player) || null;
                const d = (p && p.active) ? Math.hypot(p.x - x, p.y - y) : 0;
                const effectiveOpts = (this._distance && this._distance.enabled === false)
                    ? { nearDist: 0, maxDist: Infinity }
                    : opts;
                const gain = this.distanceGain(d, effectiveOpts);
                if (gain <= 0) return;
                this.playGunshot(path, volume * gain, channel);
            },

            /**
             * 世界音效统一入口（距离衰减，2026-08-11）：
             * 按声源世界坐标与玩家的距离自动衰减——越近越大直到 100%（nearDist 内），
             * 远离逐步减小直到 0（超过 maxDist 不播）。默认传播距离读
             * data/audio-config.json distanceAttenuation.defaultMaxDist（默认 2000px）。
             * 单次调用可用 opts.maxDist 覆盖（如特殊音效传播更远/更近）。
             * 注意：声源=玩家自身的脚步/技能/UI请用 playFile；逐发枪声使用
             * playGunshot（世界坐标枪声使用 playGunshotAt），避免普通音效去重吞枪声。
             * @param {string} path 音频路径
             * @param {number} x 声源世界坐标 x
             * @param {number} y 声源世界坐标 y
             * @param {number} [volume=1.0] 基础音量（近端满音量）
             * @param {string} [channel='sfx'] 声道
             * @param {object} [opts] 覆盖衰减参数：nearDist / maxDist
             */
            playWorld(path, x, y, volume = 1.0, channel = 'sfx', opts = {}) {
                this.playFileAt(path, x, y, volume, channel, opts);
            },

            /** 设置声道音量（sfx/ui/music，0~1；配置持久化见 data/audio-config.json） */
            setChannelVolume(channel, v) {
                this.channelVolumes[channel] = Math.max(0, Math.min(1, v));
                // BGM 实时联动 music 声道
                if (channel === 'music') this.setLoopVolume('bgm', (this._bgmVolume ?? 1) * (this.channelVolumes.music ?? 1));
                this._saveVolumes();
            },

            getChannelVolume(channel) {
                return this.channelVolumes[channel] ?? 1;
            },

            // ==================== BGM（场景背景音乐，data/audio-config.json bgm 映射驱动） ====================

            /**
             * 播放场景 BGM：普通场景读 bgm[sceneId]；scene7 可按 dungeonBgm[dungeonType]
             * 选择子类型音轨，未命中时回退 bgm.scene7；null 则停止；
             * 循环播放（交叉淡入 bgmCrossfadeSec），音量 = 配置音量 × music 声道 × masterVolume
             * @param {string} sceneId
             * @param {{ dungeonType?: string }} [context]
             */
            playBgmForScene(sceneId, context = {}) {
                const dungeonBgmKey = sceneId === 'scene7'
                    ? (audioConfig.dungeonBgm || {})[context.dungeonType]
                    : null;
                const track = (audioConfig.bgm || {})[dungeonBgmKey || sceneId];
                if (!track) {
                    this.stopBgm();
                    return;
                }
                const vol = typeof track === 'object' ? (track.volume ?? 1) : 1;
                const path = typeof track === 'object' ? track.path : track;
                const chVol = this.channelVolumes.music ?? 1;
                this._bgmVolume = vol;
                this.playLoop('bgm', path, vol * chVol, audioConfig.bgmCrossfadeSec ?? 0);
            },

            /** 停止当前 BGM */
            stopBgm() {
                this.stopLoop('bgm');
            },

            // ==================== 循环音轨（WebAudio，音量可 >100%，支持动态调节） ====================

            /**
             * 启动循环音轨（同 id 先停旧轨再启动；返回是否成功）
             * @param {string} id 音轨唯一标识（如 'flyswarm_xxx'）
             * @param {string} path 音频路径
             * @param {number} volume 初始音量倍率（可超过 1，由 GainNode 实现）
             * @param {number} [crossfadeSec=0] 交叉重叠秒数：>0 时不用自身 loop，
             *   而是在每轨结束前 N 秒启动下一轨（两轨重叠 N 秒，前轨不中断自然播完）
             */
            async playLoop(id, path, volume = 1.0, crossfadeSec = 0) {
                if (!this.enabled || !this.ctx || !id) return false;
                this._loops = this._loops || {};
                // 同 id 先停旧轨（避免叠加播放）
                this._stopLoopInternal(id);
                try {
                    const buf = await (await fetch(path)).arrayBuffer();
                    const audioBuf = await this.ctx.decodeAudioData(buf);

                    if (crossfadeSec > 0) {
                        // 交叉重叠模式：定时链，每轨在 (duration - crossfadeSec) 时启动下一轨
                        const leadMs = Math.max(80, audioBuf.duration * 1000 - crossfadeSec * 1000);
                        const startTrack = () => {
                            const state = this._loops[id];
                            if (!state || state.stopped) return;
                            const src = this.ctx.createBufferSource();
                            src.buffer = audioBuf;
                            const gain = this.ctx.createGain();
                            gain.gain.value = (state.volume ?? volume) * this.masterVolume;
                            src.connect(gain).connect(this.ctx.destination);
                            src.start();
                            state.src = src;
                            state.gain = gain;
                            state.timer = setTimeout(startTrack, leadMs);
                        };
                        this._loops[id] = { volume, stopped: false };
                        startTrack();
                    } else {
                        const src = this.ctx.createBufferSource();
                        src.buffer = audioBuf;
                        src.loop = true;
                        const gain = this.ctx.createGain();
                        gain.gain.value = volume * this.masterVolume;
                        src.connect(gain).connect(this.ctx.destination);
                        src.start();
                        this._loops[id] = { src, gain, volume };
                    }
                    return true;
                } catch (e) {
                    console.warn('SoundManager.playLoop error:', path, e);
                    return false;
                }
            },

            /** 动态调节循环音轨音量（倍率可超过 1；交叉模式下同时作用于后续轨） */
            setLoopVolume(id, volume) {
                const l = this._loops && this._loops[id];
                if (!l) return;
                l.volume = volume;
                if (l.gain) l.gain.gain.value = volume * this.masterVolume;
            },

            _stopLoopInternal(id) {
                const l = this._loops && this._loops[id];
                if (!l) return;
                l.stopped = true;
                if (l.timer) clearTimeout(l.timer);
                try { if (l.src) l.src.stop(); } catch (_e) { /* 忽略 */ }
                delete this._loops[id];
            },

            /** 停止循环音轨 */
            stopLoop(id) {
                this._stopLoopInternal(id);
            },

            /** 停止所有循环音轨（场景切换时兜底，防止实体被直接 clear 后音轨泄漏） */
            stopAllLoops() {
                if (!this._loops) return;
                for (const id of Object.keys(this._loops)) {
                    this._stopLoopInternal(id);
                }
            },

            // ==================== 位置音效（距离衰减，通用能力） ====================

            /**
             * 每帧刷新所有位置音效的音量（game.js 主循环调用）。
             * 无玩家时保持当前音量不变；有玩家时按声源与玩家距离重算，
             * 超出 maxDist 音量归 0（直接无声）。
             */
            update() {
                const loops = this._loops;
                if (!loops) return;
                const p = (typeof window !== 'undefined' && window.Game && window.Game.player) || null;
                if (!p || !p.active) return;
                for (const id of Object.keys(loops)) {
                    const l = loops[id];
                    if (!l || !l.positional) continue;
                    const pos = l.positional;
                    const d = Math.hypot(p.x - pos.x, p.y - pos.y);
                    l.volume = this.computeDistanceVolume(d, pos);
                    if (l.gain) l.gain.gain.value = l.volume * this.masterVolume;
                }
            },

            /**
             * 给循环音轨挂声源坐标 + 距离衰减参数，之后音量由 SoundManager.update()
             * 按与玩家的距离逐帧刷新（调用方无需自己算距离/音量）。
             * @param {string} id 音轨唯一标识
             * @param {number} x 声源世界坐标 x
             * @param {number} y 声源世界坐标 y
             * @param {object} [opts] 衰减参数：
             *   base（远端音量，默认 0.5）/ max（近端音量，默认 1.5）/
             *   nearDist（满音量距离，默认 150）/ farDist（base 音量距离，默认 600）/
             *   maxDist（静音距离，超出后音量 0，默认 2000）
             */
            setLoopPosition(id, x, y, opts = {}) {
                const l = this._loops && this._loops[id];
                if (!l) return;
                const loop = (this._distance && this._distance.loop) || {};
                l.positional = {
                    x, y,
                    base: opts.base ?? loop.base ?? 0.5,
                    max: opts.max ?? loop.max ?? 1.5,
                    nearDist: opts.nearDist ?? loop.nearDist ?? 150,
                    farDist: opts.farDist ?? loop.farDist ?? 600,
                    maxDist: opts.maxDist ?? loop.maxDist ?? 2000,
                };
            },

            /**
             * 循环音轨距离→音量曲线（双段线性，连续无跳变）：
             *   d ≤ nearDist            → max
             *   nearDist < d < farDist  → max 线性降至 base
             *   farDist ≤ d < maxDist   → base 线性降至 0
             *   d ≥ maxDist             → 0（无声）
             */
            computeDistanceVolume(d, cfg = {}) {
                const loop = (this._distance && this._distance.loop) || {};
                const base = cfg.base ?? loop.base ?? 0.5;
                const max = cfg.max ?? loop.max ?? 1.5;
                const nearDist = cfg.nearDist ?? loop.nearDist ?? 150;
                const farDist = cfg.farDist ?? loop.farDist ?? 600;
                const maxDist = cfg.maxDist ?? loop.maxDist ?? 2000;
                if (maxDist > 0 && d > maxDist) return 0;
                if (d <= nearDist) return max;
                if (d >= farDist) {
                    // 未配置静音段（maxDist ≤ farDist）时保持 base，兼容旧行为
                    if (maxDist <= farDist) return base;
                    const span = maxDist - farDist;
                    return base * Math.max(0, 1 - (d - farDist) / span);
                }
                const span = Math.max(1, farDist - nearDist);
                return base + (max - base) * (1 - (d - nearDist) / span);
            },

            /**
             * 一次性音效距离→倍率：nearDist 内恒 1，线性降至 maxDist 处 0，超出为 0。
             */
            distanceGain(d, opts = {}) {
                const cfg = this._distance || {};
                const nearDist = opts.nearDist ?? cfg.defaultNearDist ?? 0;
                const maxDist = opts.maxDist ?? (opts.farDist ?? cfg.defaultMaxDist ?? 2000);
                if (d <= nearDist) return 1;
                if (d >= maxDist) return 0;
                const span = Math.max(1, maxDist - nearDist);
                return Math.max(0, 1 - (d - nearDist) / span);
            },

            _playMeleeSwing() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.15, t);
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(300, t);
                osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.12);
            },

            _playBowFire() {
                const t = this._now();
                // 弦振动声
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.12, t);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(600, t);
                osc.frequency.exponentialRampToValueAtTime(200, t + 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.1);
                // 箭矢破空声
                const noise = this.ctx.createBufferSource();
                const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
                noise.buffer = buffer;
                const nGain = this._gain(0.06, t + 0.02);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
                noise.connect(nGain).connect(this.ctx.destination);
                noise.start(t + 0.02);
            },

            _playGunFire() {
                const t = this._now();
                // 低频爆音
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.3, t);
                osc.type = 'square';
                osc.frequency.setValueAtTime(200, t);
                osc.frequency.exponentialRampToValueAtTime(30, t + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.08);
                // 噪音爆破
                const noise = this.ctx.createBufferSource();
                const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.03, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
                noise.buffer = buffer;
                const nGain = this._gain(0.2, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
                noise.connect(nGain).connect(this.ctx.destination);
                noise.start(t);
            },

            _playHit() {
                const t = this._now();
                // 沉闷的打击声
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.2, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(200, t);
                osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.12);
                // 噪音层
                const noise = this.ctx.createBufferSource();
                const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.04, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
                noise.buffer = buffer;
                const nGain = this._gain(0.1, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
                noise.connect(nGain).connect(this.ctx.destination);
                noise.start(t);
            },

            _playCrit() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.2, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(500, t);
                osc.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
                osc.frequency.exponentialRampToValueAtTime(300, t + 0.15);
                gain.gain.setValueAtTime(0.2, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.18);
                // 闪烁噪音
                const noise = this.ctx.createBufferSource();
                const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.06, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
                noise.buffer = buffer;
                const nGain = this._gain(0.08, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
                noise.connect(nGain).connect(this.ctx.destination);
                noise.start(t);
            },

            /** 命中 tick（COD 式 hitmarker 音：极短、明亮、不掩枪声） */
            _playHitmark() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.09, t);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(1500, t);
                osc.frequency.exponentialRampToValueAtTime(1100, t + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.035);
            },

            /** 暴击 tick：更高更亮，带一点金属泛音 */
            _playHitmarkCrit() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.11, t);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(2100, t);
                osc.frequency.exponentialRampToValueAtTime(1500, t + 0.04);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.05);
                const osc2 = this.ctx.createOscillator();
                const gain2 = this._gain(0.05, t);
                osc2.type = 'square';
                osc2.frequency.setValueAtTime(3150, t);
                gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
                osc2.connect(gain2).connect(this.ctx.destination);
                osc2.start(t); osc2.stop(t + 0.03);
            },

            /** 击杀确认音：上行双音（低→高），明确区别于普通命中 */
            _playKillConfirm() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.14, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, t);
                osc.frequency.setValueAtTime(1320, t + 0.06);
                gain.gain.setValueAtTime(0.14, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.14);
            },

            _playDodge() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.12, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, t);
                osc.frequency.exponentialRampToValueAtTime(800, t + 0.08);
                osc.frequency.exponentialRampToValueAtTime(200, t + 0.2);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.2);
            },

            _playPickup() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.12, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, t);
                osc.frequency.setValueAtTime(660, t + 0.05);
                osc.frequency.setValueAtTime(880, t + 0.1);
                gain.gain.setValueAtTime(0.12, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.15);
            },

            _playDrop() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.1, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(660, t);
                osc.frequency.setValueAtTime(330, t + 0.06);
                gain.gain.setValueAtTime(0.1, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.12);
            },

            _playEquip() {
                const t = this._now();
                // 金属碰撞声
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.15, t);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(800, t);
                osc.frequency.exponentialRampToValueAtTime(400, t + 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.1);
            },

            _playSwitchWeapon() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.1, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, t);
                osc.frequency.setValueAtTime(500, t + 0.04);
                osc.frequency.setValueAtTime(400, t + 0.08);
                gain.gain.setValueAtTime(0.1, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.1);
            },

            _playPanelOpen() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.06, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, t);
                osc.frequency.exponentialRampToValueAtTime(600, t + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.08);
            },

            _playPanelClose() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.06, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, t);
                osc.frequency.exponentialRampToValueAtTime(300, t + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.08);
            },

            _playEnemyDeath() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.15, t);
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(200, t);
                osc.frequency.exponentialRampToValueAtTime(30, t + 0.3);
                gain.gain.setValueAtTime(0.15, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.3);
            },

            _playPlayerHurt() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.15, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(250, t);
                osc.frequency.exponentialRampToValueAtTime(80, t + 0.2);
                gain.gain.setValueAtTime(0.15, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.2);
            },

            _playWallHit() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.08, t);
                osc.type = 'square';
                osc.frequency.setValueAtTime(120, t);
                osc.frequency.exponentialRampToValueAtTime(40, t + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.08);
            },

            _playStep() {
                const now = Date.now();
                if (now - this._stepTimer < this._stepInterval) return;
                this._stepTimer = now;
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.04, t);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(100 + Math.random() * 60, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.04);
            },

            setVolume(v) {
                this.masterVolume = Math.max(0, Math.min(1, v));
                // 实时作用于所有运行中的循环音轨（BGM/环境音）
                if (this._loops) {
                    for (const id of Object.keys(this._loops)) {
                        const l = this._loops[id];
                        if (l && l.gain) l.gain.gain.value = (l.volume ?? 1) * this.masterVolume;
                    }
                }
                this._saveVolumes();
            },
            toggle() { this.enabled = !this.enabled; return this.enabled; }
        };
