        // ==================== 音效管理系统 ====================
        import audioConfig from '../../data/audio-config.json';

        // 音量持久化防抖句柄（滑块 input 高频触发时合并写入）
        let _volumeSaveTimer = null;

        export const SoundManager = {
            ctx: null,
            masterVolume: 0.6,
            enabled: true,
            // 声道音量（data/audio-config.json channels；sfx/ui/music 二级调节）
            channelVolumes: { ...(audioConfig.channels || { sfx: 1, ui: 1, music: 0.6 }) },
            _stepTimer: 0,
            _stepInterval: 280,
            _initialized: false,

            init() {
                if (this._initialized) return;
                try {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (AudioContext) {
                        this.ctx = new AudioContext();
                        this._initialized = true;
                        this._loadSavedVolumes();
                    }
                } catch (e) { console.warn('Web Audio API 不可用:', e); }
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

            // 播放外部音频文件（.mp3, .wav 等）；channel 走声道音量（默认 sfx）
            playFile(path, volume = 1.0, channel = 'sfx') {
                if (!this.enabled) return;
                const chVol = this.channelVolumes[channel] ?? this.channelVolumes.sfx ?? 1;
                try {
                    const audio = new Audio(path);
                    audio.volume = Math.max(0, Math.min(1, volume * chVol * this.masterVolume));
                    audio.play().catch(e => console.warn('SoundManager.playFile failed:', path, e.message));
                } catch (e) {
                    console.warn('SoundManager.playFile error:', path, e);
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
                const gain = this.distanceGain(d, opts);
                if (gain <= 0) return;
                this.playFile(path, volume * gain, channel);
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
             * 播放场景 BGM：读 audio-config.json bgm[sceneId]，null 则停止；
             * 循环播放（交叉淡入 bgmCrossfadeSec），音量 = 配置音量 × music 声道 × masterVolume
             */
            playBgmForScene(sceneId) {
                const track = (audioConfig.bgm || {})[sceneId];
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
                l.positional = {
                    x, y,
                    base: opts.base ?? 0.5,
                    max: opts.max ?? 1.5,
                    nearDist: opts.nearDist ?? 150,
                    farDist: opts.farDist ?? 600,
                    maxDist: opts.maxDist ?? 2000,
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
                const base = cfg.base ?? 0.5;
                const max = cfg.max ?? 1.5;
                const nearDist = cfg.nearDist ?? 150;
                const farDist = cfg.farDist ?? 600;
                const maxDist = cfg.maxDist ?? 2000;
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
                const nearDist = opts.nearDist ?? 0;
                const maxDist = opts.maxDist ?? (opts.farDist ?? 2000);
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
