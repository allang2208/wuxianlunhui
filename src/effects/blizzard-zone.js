import { GroundZone } from './ground-zone.js';

/**
 * 暴风雪持续区域特效（2026-08-03，暴风雪技能首航）
 *
 * GroundZone 的地面区域子类，把"油脂+反光+火焰"换成冰系四层视觉：
 *  1) 底面：半透明冰蓝椭圆（NORMAL），呼吸明暗
 *  2) 反光：白色 ADD 描边椭圆，错相位呼吸
 *  3) 雪花：白色小粒子在椭圆上半区持续飘落（ADD 发光）
 *  4) 云雾：蓝色大粒子缓慢弥漫（ADD，低透明度）
 *  5) 风线：白色短线横扫区域（线条风暴感，ADD）
 * 伤害/生命周期沿用 GroundZone：timer + tickMs + onTick，到期统一清理。
 */

function _getScene() {
    return typeof window !== 'undefined' ? window.__phaserScene : null;
}

// 乌云恒在最上：不参与 Y 排序，避免被墙体/实体/地面特效遮挡
const CLOUD_TOP_DEPTH = 1 << 28;

export class BlizzardZone extends GroundZone {
    constructor(o) {
        super({
            x: o.x,
            y: o.y,
            radius: o.radiusX || 200,
            duration: o.durationMs || 6000,
            tickMs: o.tickMs || 500,
            onTick: o.onTick,
            oil: null,
            gloss: null,
            flame: null,
        });
        this.radiusX = this.radius;
        this.radiusY = o.radiusY || this.radius * 0.6;

        // ===== 全部特效参数配置化（外部可经构造 options 覆盖） =====
        // 地面层：冰蓝底椭圆 + 白色反光描边（呼吸明暗）
        this._baseCfg = {
            color: 0x9fd4ff, alpha: 0.16, growMs: 400,
            breathe: { to: 0.28, duration: 700 }, ...(o.base || o.oil || {}),
        };
        this._glossCfg = {
            color: 0xffffff, alpha: 0.26, lineWidth: 7,
            breathe: { to: 0.12, duration: 500 }, ...(o.gloss || {}),
        };
        // 底部雪花粒子（区域内持续飘落）
        this._snowCfg = {
            texture: 'impact_dot', morphMs: 90, burstCount: 12,
            speed: { min: 20, max: 70 }, angle: { min: 70, max: 110 }, gravityY: 180,
            scale: { start: 1.0, end: 0.2 }, alpha: { start: 0.85, end: 0 },
            lifespan: { min: 600, max: 1100 }, tint: [0xffffff, 0xe8f6ff, 0xbcdcff],
            blendMode: 'ADD', emitterTtlMs: 1300, ...(o.snow || {}),
        };
        // 蓝色云雾（已调淡，避免大片光团）
        this._mistCfg = {
            texture: 'impact_dot', morphMs: 260, burstCount: 3,
            speed: { min: 3, max: 12 }, angle: { min: 0, max: 360 }, gravityY: -6,
            scale: { start: 2.0, end: 0.5 }, alpha: { start: 0.2, end: 0 },
            lifespan: { min: 1200, max: 2000 }, tint: [0x4d8fd9, 0x7fb8ff, 0xaad8ff],
            blendMode: 'ADD', emitterTtlMs: 2200, ...(o.mist || {}),
        };
        // 风线
        this._streakCfg = {
            morphMs: 110, perBurst: 2, durationMs: 420,
            ySpread: 0.75, xSpread: 0.7, lenMin: 0.18, lenMax: 0.53,
            sweep: 0.95, lineWidth: 2, lineAlpha: 0.55, ...(o.streak || {}),
        };
        // 空中砸落：雪球/冰锥。范围变化时云与坠落起点按 radiusX/radiusY 同步缩放
        this._fallCfg = {
            intervalMs: 50, snowballChance: 0.55, maxActive: 48,
            snowballSizeMin: 14, snowballSizeMax: 28,
            snowballVy0Min: 520, snowballVy0Max: 680, snowballGravity: 4800,
            spikeHMin: 30, spikeHMax: 50, spikeAspect: 0.19,
            spikeVy0Min: 720, spikeVy0Max: 960, spikeGravity: 5600,
            spawnJitterX: 0.16, spawnJitterY: 0.5, // 云内生成抖动（相对半径比例）
            ...(o.fall || {}),
        };
        // 落地迸溅
        this._impactCfg = {
            snowballCount: 20, spikeCount: 24,
            speedMin: 100, speedMax: 360, gravityY: 620,
            scaleStart: 1.8, scaleEnd: 0.1, alphaStart: 0.95,
            lifespanMin: 280, lifespanMax: 560,
            angleMin: 200, angleMax: 340, // 向上扇形迸溅
            ringColor: 0xffffff, ringAlpha: 0.5, ringWidth: 3,
            ringScale: 3.2, ringMs: 350, ringRadius: 22, ringAspect: 0.5,
            ...(o.impact || {}),
        };
        // 乌云：随区域半径缩放（widthMul/thickMul/heightMul 均为半径比例），liftY 为额外抬升像素
        this._cloudCfg = {
            liftY: 100, heightMul: 2.3, widthMul: 1.15, thickMul: 0.55,
            puffMorphMs: 280, puffPerBurst: 2,
            puffSpeedMin: 3, puffSpeedMax: 15, puffGravityY: -8,
            puffScaleStart: 2.6, puffScaleEnd: 0.8, puffAlphaStart: 0.38,
            puffLifespanMin: 1500, puffLifespanMax: 2600,
            puffTint: [0x23262f, 0x3a404e, 0x4a5060],
            puffSpreadMin: 0.85, puffSpreadMax: 1.3, puffYFactor: 0.38, puffYSpread: 0.25,
            layers: [
                { tint: 0x23262f, count: 18, spread: 1.0, sizeMin: 0.55, sizeMax: 0.95, alpha: 0.9, yOffRatio: 0 },
                { tint: 0x3a404e, count: 14, spread: 0.85, sizeMin: 0.45, sizeMax: 0.75, alpha: 0.85, yOffRatio: -0.18 },
                { tint: 0x596170, count: 9, spread: 0.6, sizeMin: 0.35, sizeMax: 0.55, alpha: 0.8, yOffRatio: -0.32 },
            ],
            ...(o.cloud || {}),
        };

        this.snowTimer = 0;
        this.mistTimer = 0;
        this.streakTimer = 0;
        this._fallTimer = 0;
        this._streaks = [];
        this._falling = [];
        // 乌云中心 = 区域上方（半径比例）+ 额外抬升；改 skill 范围时自动跟随
        this._cloudY = this.y - this.radiusY * this._cloudCfg.heightMul - this._cloudCfg.liftY;
        this._buildIce();
        this._buildCloud();
    }

    /** 柔边圆纹理：乌云色块的底（边缘羽化，去掉塑料硬边感） */
    _ensureCloudPuffTexture(scene) {
        if (scene.textures.exists('blizzardCloudPuff')) return;
        const size = 128;
        const canvas = scene.textures.createCanvas('blizzardCloudPuff', size, size);
        const ctx = canvas.getContext();
        const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.72)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        canvas.refresh();
    }

    /** 乌云：柔边深灰/灰/浅灰三层色块叠出写实云团，周围持续飘散粒子烟雾 */
    _buildCloud() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        this._ensureCloudPuffTexture(scene);
        if (!scene.textures.exists('blizzardCloudPuff')) return;
        const cx = this.x;
        const cy = this._cloudY;
        const C = this._cloudCfg;
        const w = this.radiusX * C.widthMul;
        const h = this.radiusY * C.thickMul;
        const layers = C.layers;
        this._cloudBlobs = [];
        for (const L of layers) {
            for (let i = 0; i < L.count; i++) {
                const rr = Math.sqrt(Math.random()) * L.spread;
                const a = Math.random() * Math.PI * 2;
                const px = cx + Math.cos(a) * rr * w;
                const py = cy + Math.sin(a) * rr * h + h * (L.yOffRatio || 0);
                const size = w * (L.sizeMin + Math.random() * (L.sizeMax - L.sizeMin));
                const blob = scene.add.image(px, py, 'blizzardCloudPuff');
                blob.setTint(L.tint);
                blob.setDisplaySize(size, size);
                blob.setAlpha(L.alpha * (0.75 + Math.random() * 0.25));
                blob.setDepth(CLOUD_TOP_DEPTH);
                this._cloudBlobs.push(blob);
                this._gfx.push(blob);
            }
        }
        this._cloudPuffTimer = 0;
    }

    /** 云周围飘散的深灰粒子烟雾（NORMAL 混合，黑色在 ADD 下不可见） */
    _spawnCloudPuff() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        if (typeof scene._ensureImpactDotTexture === 'function') scene._ensureImpactDotTexture();
        if (!scene.textures.exists('impact_dot')) return;
        const a = Math.random() * Math.PI * 2;
        const C = this._cloudCfg;
        const rr = this.radiusX * (C.puffSpreadMin + Math.random() * (C.puffSpreadMax - C.puffSpreadMin));
        const px = this.x + Math.cos(a) * rr;
        const py = this._cloudY + Math.sin(a) * rr * C.puffYFactor
            + (Math.random() - 0.5) * this.radiusY * C.puffYSpread;
        const em = scene.add.particles(0, 0, 'impact_dot', {
            speed: { min: C.puffSpeedMin, max: C.puffSpeedMax }, angle: { min: 0, max: 360 }, gravityY: C.puffGravityY,
            scale: { start: C.puffScaleStart, end: C.puffScaleEnd }, alpha: { start: C.puffAlphaStart, end: 0 },
            lifespan: { min: C.puffLifespanMin, max: C.puffLifespanMax }, tint: C.puffTint,
            blendMode: 'NORMAL', emitting: false,
        });
        em.addToUpdateList();
        em.setDepth(CLOUD_TOP_DEPTH);
        em.explode(C.puffPerBurst ?? 2, px, py);
        scene.time.delayedCall((C.puffLifespanMax || 2600) + 200, () => { if (em && em.active) em.destroy(); });
    }

    /** 纯白圆形雪球贴图（运行时生成，避免贴图白边问题） */
    _ensureSnowballTexture(scene) {
        if (scene.textures.exists('blizzardSnowball')) return;
        const size = 64;
        const canvas = scene.textures.createCanvas('blizzardSnowball', size, size);
        const ctx = canvas.getContext();
        ctx.clearRect(0, 0, size, size);
        const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.88, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
        canvas.refresh();
    }

    /** 底面（NORMAL 冰蓝椭圆）+ 反光（ADD 白描边）——radiusX/radiusY 独立，不沿用 0.5 透视 */
    _buildIce() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        const rx = this.radiusX;
        const ry = this.radiusY;
        // 底面
        const c = typeof this._baseCfg.color === 'string' ? parseInt(this._baseCfg.color, 16) : this._baseCfg.color;
        const oil = scene.add.graphics();
        oil.fillStyle(c, this._baseCfg.alpha);
        oil.fillEllipse(0, 0, rx * 2, ry * 2);
        oil.setPosition(this.x, this.y);
        oil.setScale(this.oilFrac);
        oil.setDepth(this.y - 1000);
        this.oilGfx = oil;
        this._gfx.push(oil);
        const b = this._baseCfg.breathe || {};
        scene.tweens.add({ targets: oil, alpha: { from: 1, to: b.to ?? 0.38 }, duration: b.duration ?? 700, yoyo: true, repeat: -1 });
        // 反光描边
        const gc = typeof this._glossCfg.color === 'string' ? parseInt(this._glossCfg.color, 16) : this._glossCfg.color;
        const gloss = scene.add.graphics();
        gloss.lineStyle(this._glossCfg.lineWidth ?? 8, gc, this._glossCfg.alpha ?? 0.4);
        gloss.strokeEllipse(0, 0, rx * 2, ry * 2);
        gloss.setPosition(this.x, this.y);
        gloss.setScale(this.oilFrac);
        gloss.setBlendMode('ADD');
        gloss.setDepth(this.y - 999);
        this.glossGfx = gloss;
        this._gfx.push(gloss);
        const gb = this._glossCfg.breathe || {};
        scene.tweens.add({ targets: gloss, alpha: { from: 1, to: gb.to ?? 0.18 }, duration: gb.duration ?? 500, yoyo: true, repeat: -1 });
    }

    _ensureTexture(scene, texture) {
        if (!scene.textures.exists(texture) && texture === 'impact_dot' && typeof scene._ensureImpactDotTexture === 'function') {
            scene._ensureImpactDotTexture();
        }
        return scene.textures.exists(texture);
    }

    /** 雪花：椭圆上半区随机点生成，白色小粒子向下飘落 */
    _spawnSnow() {
        const scene = _getScene();
        const F = this._snowCfg;
        if (!scene || !scene.add || !F || !this._ensureTexture(scene, F.texture)) return;
        const em = scene.add.particles(0, 0, F.texture, {
            speed: F.speed, angle: F.angle, gravityY: F.gravityY,
            scale: F.scale, alpha: F.alpha, lifespan: F.lifespan,
            tint: F.tint, blendMode: F.blendMode, emitting: false,
        });
        em.addToUpdateList();
        em.setDepth(this.y - 998);
        for (let i = 0; i < F.burstCount; i++) {
            const fx = this.x + (Math.random() * 2 - 1) * this.radiusX * 0.9;
            const fy = this.y - Math.random() * this.radiusY * 0.9;
            em.explode(1, fx, fy);
        }
        scene.time.delayedCall(F.emitterTtlMs ?? 1300, () => { if (em && em.active) em.destroy(); });
    }

    /** 云雾：蓝色大粒子在区域内缓慢弥漫（ADD，低透明度） */
    _spawnMist() {
        const scene = _getScene();
        const F = this._mistCfg;
        if (!scene || !scene.add || !F || !this._ensureTexture(scene, F.texture)) return;
        const em = scene.add.particles(0, 0, F.texture, {
            speed: F.speed, angle: F.angle, gravityY: F.gravityY,
            scale: F.scale, alpha: F.alpha, lifespan: F.lifespan,
            tint: F.tint, blendMode: F.blendMode, emitting: false,
        });
        em.addToUpdateList();
        em.setDepth(this.y - 998);
        for (let i = 0; i < F.burstCount; i++) {
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random());
            const fx = this.x + Math.cos(a) * rr * this.radiusX;
            const fy = this.y + Math.sin(a) * rr * this.radiusY;
            em.explode(1, fx, fy);
        }
        scene.time.delayedCall(F.emitterTtlMs ?? 2200, () => { if (em && em.active) em.destroy(); });
    }

    /** 风线：白色短线从左向右横扫（线条风暴感） */
    _spawnStreak() {
        const scene = _getScene();
        const S = this._streakCfg;
        if (!scene || !scene.add || !S) return;
        const count = S.perBurst || 2;
        for (let k = 0; k < count; k++) {
            const y = this.y + (Math.random() * 2 - 1) * this.radiusY * (S.ySpread ?? 0.75);
            const x0 = this.x + (Math.random() * 2 - 1) * this.radiusX * (S.xSpread ?? 0.7);
            const len = this.radiusX * ((S.lenMin ?? 0.18) + Math.random() * ((S.lenMax ?? 0.53) - (S.lenMin ?? 0.18)));
            const g = scene.add.graphics();
            g.lineStyle(S.lineWidth ?? 2, 0xffffff, 1);
            g.lineBetween(0, 0, len, 0);
            g.setPosition(x0, y);
            g.setBlendMode('ADD');
            g.setDepth(this.y - 996);
            g.setAlpha(0);
            this._streaks.push(g);
            const dur = S.durationMs || 420;
            scene.tweens.add({
                targets: g, x: x0 + this.radiusX * (S.sweep ?? 0.95),
                alpha: { from: 0, to: S.lineAlpha ?? 0.55 }, duration: dur * 0.25,
                onComplete: () => {
                    if (!g || !g.active) return;
                    scene.tweens.add({ targets: g, alpha: 0, duration: dur * 0.75, delay: dur * 0.25 });
                },
            });
            scene.time.delayedCall(dur * 1.4, () => {
                const idx = this._streaks.indexOf(g);
                if (idx >= 0) this._streaks.splice(idx, 1);
                if (g && g.active) g.destroy();
            });
        }
    }

    /** 空中砸落：雪球（旋转）或冰锥（竖直）从高空坠入区域 */
    _spawnFalling() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        if (this._falling.length >= (this._fallCfg.maxActive ?? 12)) return;
        const isSnowball = Math.random() < (this._fallCfg.snowballChance ?? 0.55);
        if (isSnowball) this._ensureSnowballTexture(scene);
        const key = isSnowball ? 'blizzardSnowball' : 'iceSpike';
        if (!scene.textures.exists(key)) return;

        const sprite = scene.add.sprite(0, 0, key);
        const F = this._fallCfg;
        if (isSnowball) {
            const size = F.snowballSizeMin + Math.random() * (F.snowballSizeMax - F.snowballSizeMin);
            sprite.setDisplaySize(size, size);
        } else {
            const h = F.spikeHMin + Math.random() * (F.spikeHMax - F.spikeHMin);
            sprite.setDisplaySize(h * F.spikeAspect, h);
        }
        // 椭圆内均匀随机落点（避免全部砸在椭圆下方）
        const rr = Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        const landX = this.x + Math.cos(a) * rr * this.radiusX;
        const landY = this.y + Math.sin(a) * rr * this.radiusY;
        // 从乌云内生成：水平/垂直抖动（半径比例，范围变化自动跟随）
        const x = landX + (Math.random() - 0.5) * this.radiusX * F.spawnJitterX;
        const y = this._cloudY + (Math.random() - 0.5) * this.radiusY * F.spawnJitterY;
        sprite.setPosition(x, y);
        sprite.setAlpha(0.9);
        sprite.setDepth(y + 12); // 随高度 y 排序，坠落时自然向前层移动
        this._falling.push({
            sprite,
            x,
            y,
            vx: 0,
            vy: isSnowball
                ? F.snowballVy0Min + Math.random() * (F.snowballVy0Max - F.snowballVy0Min)
                : F.spikeVy0Min + Math.random() * (F.spikeVy0Max - F.spikeVy0Min),
            isSnowball,
            landX,
            landY,
        });
    }

    /** 雪球/冰锥下落物理 + 落地迸溅 */
    _updateFalling(dt) {
        const dtSec = dt / 1000;
        for (let i = this._falling.length - 1; i >= 0; i--) {
            const f = this._falling[i];
            const F = this._fallCfg;
            f.vy += (f.isSnowball ? F.snowballGravity : F.spikeGravity) * dtSec;
            f.x += f.vx * dtSec;
            f.y += f.vy * dtSec;
            f.sprite.setPosition(f.x, f.y);
            f.sprite.setDepth(f.y + 12); // 图层：随 Y 自然排序
            if (f.y >= f.landY) {
                this._impact(f);
                if (f.sprite && f.sprite.active) f.sprite.destroy();
                this._falling.splice(i, 1);
            }
        }
    }

    /** 落地迸溅：冰屑粒子 + 小冲击环 */
    _impact(f) {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        if (typeof scene._ensureImpactDotTexture === 'function') scene._ensureImpactDotTexture();
        if (!scene.textures.exists('impact_dot')) return;
        const I = this._impactCfg;
        const em = scene.add.particles(0, 0, 'impact_dot', {
            speed: { min: I.speedMin, max: I.speedMax },
            angle: { min: I.angleMin, max: I.angleMax },
            gravityY: I.gravityY,
            scale: { start: I.scaleStart, end: I.scaleEnd },
            alpha: { start: I.alphaStart, end: 0 },
            lifespan: { min: I.lifespanMin, max: I.lifespanMax },
            tint: [0xffffff, 0xaaddff, 0x66aaff],
            blendMode: 'ADD',
            emitting: false,
        });
        em.addToUpdateList();
        em.setDepth(f.landY - 996);
        em.explode(f.isSnowball ? I.snowballCount : I.spikeCount, f.landX, f.landY);
        scene.time.delayedCall((I.lifespanMax || 560) + 100, () => { if (em && em.active) em.destroy(); });

        const g = scene.add.graphics();
        g.lineStyle(I.ringWidth, I.ringColor, I.ringAlpha);
        g.strokeEllipse(0, 0, I.ringRadius * 2, I.ringRadius * 2 * I.ringAspect);
        g.setPosition(f.landX, f.landY);
        g.setBlendMode('ADD');
        g.setDepth(f.landY - 997);
        scene.tweens.add({
            targets: g, scaleX: I.ringScale, scaleY: I.ringScale, alpha: 0,
            duration: I.ringMs, ease: 'Cubic.easeOut',
            onComplete: () => { if (g && g.active) g.destroy(); },
        });
    }

    update(dt, entities) {
        const alive = super.update(dt, entities);
        if (!alive) return false;
        this.snowTimer -= dt;
        if (this.snowTimer <= 0) {
            this.snowTimer = this._snowCfg.morphMs ?? 90;
            this._spawnSnow();
        }
        this.mistTimer -= dt;
        if (this.mistTimer <= 0) {
            this.mistTimer = this._mistCfg.morphMs ?? 160;
            this._spawnMist();
        }
        this.streakTimer -= dt;
        if (this.streakTimer <= 0) {
            this.streakTimer = this._streakCfg.morphMs ?? 110;
            this._spawnStreak();
        }
        this._fallTimer -= dt;
        if (this._fallTimer <= 0) {
            this._fallTimer = this._fallCfg.intervalMs ?? 200;
            this._spawnFalling();
        }
        if (this._cloudPuffTimer !== undefined) {
            this._cloudPuffTimer -= dt;
            if (this._cloudPuffTimer <= 0) {
                this._cloudPuffTimer = this._cloudCfg.puffMorphMs ?? 280;
                this._spawnCloudPuff();
            }
        }
        this._updateFalling(dt);
        return true;
    }

    destroy() {
        const scene = _getScene();
        for (const g of this._streaks) {
            if (!g) continue;
            if (scene && scene.tweens) scene.tweens.killTweensOf(g);
            if (g.active && typeof g.destroy === 'function') g.destroy();
        }
        this._streaks = [];
        for (const f of this._falling) {
            if (f.sprite && f.sprite.active && typeof f.sprite.destroy === 'function') {
                f.sprite.destroy();
            }
        }
        this._falling = [];
        super.destroy();
    }
}
