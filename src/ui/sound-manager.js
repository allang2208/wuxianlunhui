        // ==================== 音效管理系统 ====================
        export const SoundManager = {
            ctx: null,
            masterVolume: 0.6,
            enabled: true,
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
                    }
                } catch (e) { console.warn('Web Audio API 不可用:', e); }
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

            // 播放外部音频文件（.mp3, .wav 等）
            playFile(path, volume = 1.0) {
                if (!this.enabled) return;
                try {
                    const audio = new Audio(path);
                    audio.volume = Math.max(0, Math.min(1, volume * this.masterVolume));
                    audio.play().catch(e => console.warn('SoundManager.playFile failed:', path, e.message));
                } catch (e) {
                    console.warn('SoundManager.playFile error:', path, e);
                }
            },

            // ==================== 循环音轨（WebAudio，音量可 >100%，支持动态调节） ====================

            /**
             * 启动循环音轨（同 id 先停旧轨再启动；返回是否成功）
             * @param {string} id 音轨唯一标识（如 'flyswarm_xxx'）
             * @param {string} path 音频路径
             * @param {number} volume 初始音量倍率（可超过 1，由 GainNode 实现）
             */
            async playLoop(id, path, volume = 1.0) {
                if (!this.enabled || !this.ctx || !id) return false;
                this._loops = this._loops || {};
                // 同 id 先停旧轨（避免叠加播放）
                const old = this._loops[id];
                if (old && old.src) { try { old.src.stop(); } catch (_e) { /* 忽略 */ } }
                delete this._loops[id];
                try {
                    const buf = await (await fetch(path)).arrayBuffer();
                    const audioBuf = await this.ctx.decodeAudioData(buf);
                    const src = this.ctx.createBufferSource();
                    src.buffer = audioBuf;
                    src.loop = true;
                    const gain = this.ctx.createGain();
                    gain.gain.value = volume * this.masterVolume;
                    src.connect(gain).connect(this.ctx.destination);
                    src.start();
                    this._loops[id] = { src, gain };
                    return true;
                } catch (e) {
                    console.warn('SoundManager.playLoop error:', path, e);
                    return false;
                }
            },

            /** 动态调节循环音轨音量（倍率可超过 1） */
            setLoopVolume(id, volume) {
                const l = this._loops && this._loops[id];
                if (l && l.gain) l.gain.gain.value = volume * this.masterVolume;
            },

            /** 停止循环音轨 */
            stopLoop(id) {
                const l = this._loops && this._loops[id];
                if (l) {
                    try { if (l.src) l.src.stop(); } catch (_e) { /* 忽略 */ }
                    delete this._loops[id];
                }
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

            setVolume(v) { this.masterVolume = Math.max(0, Math.min(1, v)); },
            toggle() { this.enabled = !this.enabled; return this.enabled; }
        };
