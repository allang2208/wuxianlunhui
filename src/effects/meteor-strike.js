import { GroundZone } from './ground-zone.js';
import { Camera } from '../world/camera.js';
import { SoundManager } from '../ui/sound-manager.js';
import { fireGroundShockwave, burstParticles } from './combat-fx.js';

/** 陨星落地/燃烧音效（素材库 技能音效/陨星 三件） */
const SOUND_LAND = 'assets/sounds/skills/陨星落地.mp3';
const SOUND_BURN1 = 'assets/sounds/skills/陨星燃烧1.mp3';
const SOUND_BURN2 = 'assets/sounds/skills/陨星燃烧2.mp3';

/**
 * 陨星坠落特效（2026-08-03，火系高级魔法「陨星坠落」）
 *
 * 三阶段视觉（2026-08-03 调整：删除地面警示红圈，改为直接坠落预告）：
 *  1) fall  坠落：陨石（运行时 canvas 纹理）从高空加速砸落 + 烟尾（坠落本身就是预告）
 *  2) impact 爆炸：冲击波扩散圈 + ADD 火焰爆发 + 烟尘 + 震屏，随后铺开熔岩地面
 *  3) lava  熔岩余火：油面/反光 + **火炬式燃烧**（障碍物火炬同款连续发射器，
 *     网格铺满整个影响区域），周期灼烧
 * 伤害/灼伤/经验全部由 MeteorSystem 的 onImpact/onTick/onEnd 回调负责，本类只管视觉与生命周期。
 * 生命周期：update(dt, entities) 返回 false 表示已完全结束（调用方从数组移除并触发 onEnd）。
 */

function _getScene() {
    return typeof window !== 'undefined' ? window.__phaserScene : null;
}

export class MeteorStrike {
    constructor(o) {
        this.x = o.x;
        this.y = o.y;
        this.surfaceContext = o.surfaceContext || null;
        this.displayY = this.y - (Number(this.surfaceContext?.z) || 0);
        this.explosionRadius = o.explosionRadius ?? 150;
        this.lavaRadius = o.lavaRadius ?? 130;
        this.lavaDurationMs = o.lavaDurationMs ?? 3500;
        this.lavaTickMs = o.lavaTickMs ?? 500;
        this.fallMs = o.fallMs ?? 650;
        this.shakeIntensity = o.shakeIntensity ?? 0;
        this.onImpact = o.onImpact || null; // (x, y, entities) => void
        this.onTick = o.onTick || null;     // (zone, entities) => void
        this.onEnd = o.onEnd || null;       // () => void

        this.phase = 'fall';
        this._fallTimer = 0;
        this._trailTimer = 0;
        this._meteor = null;
        this._fallFromY = o.fallFromY ?? (this.displayY - 880);
        this._lavaZone = null;
        this._lavaEmitters = [];
        this._lavaElapsed = 0;
        this._burn1Played = false;
        this._burn2Started = false;
        this._nextBurn2At = 0;
        this._lavaRingGfx = null;
        this._ringGrow = 0;
        this._ringDone = false;
        this._startFall();
    }

    getFogVisuals() {
        return [this._meteor, this._lavaRingGfx, this._lavaEmitters];
    }

    /** 播放技能音效（防御性） */
    _playSound(path) {
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            try {
                SoundManager.playFile(path);
            } catch (_e) { /* 静默 */ }
        }
    }

    _ensureMeteorTexture(scene) {
        if (scene.textures.exists('meteorRock')) return;
        const size = 96;
        const canvas = scene.textures.createCanvas('meteorRock', size, size);
        const ctx = canvas.getContext();
        // 外圈火红辉光 → 暗岩核心（辉光烘焙进贴图，缩放不丢失）
        const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
        glow.addColorStop(0, 'rgba(255,244,214,1)');
        glow.addColorStop(0.3, 'rgba(255,178,92,0.95)');
        glow.addColorStop(0.62, 'rgba(150,52,16,0.9)');
        glow.addColorStop(1, 'rgba(30,10,4,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, size, size);
        // 岩石暗斑（固定随机种子绘制一次，纹理缓存后全局一致）
        let seed = 20260803;
        const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        ctx.fillStyle = 'rgba(45,26,16,0.85)';
        for (let i = 0; i < 7; i++) {
            const r = size * (0.05 + rand() * 0.11);
            ctx.beginPath();
            ctx.arc(size * (0.28 + rand() * 0.44), size * (0.28 + rand() * 0.44), r, 0, Math.PI * 2);
            ctx.fill();
        }
        // 高光裂纹（亮橙短线）
        ctx.strokeStyle = 'rgba(255,210,130,0.8)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
            const ax = size * (0.3 + rand() * 0.4);
            const ay = size * (0.3 + rand() * 0.4);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax + (rand() - 0.5) * size * 0.28, ay + (rand() - 0.5) * size * 0.28);
            ctx.stroke();
        }
        canvas.refresh();
    }

    _startFall() {
        const scene = _getScene();
        if (scene && scene.add) this._ensureMeteorTexture(scene);
        if (scene && scene.add && scene.textures.exists('meteorRock')) {
            this._meteor = scene.add.image(this.x, this._fallFromY, 'meteorRock');
            this._meteor.setScale(0.45);
            this._meteor.setDepth(this._fallFromY + 60);
        }
        this.phase = 'fall';
    }

    /** 坠落期：烟尾（黑烟 NORMAL + 火星 ADD） */
    _spawnTrail(curY) {
        burstParticles({
            texture: 'smoke_particle',
            x: this.x, y: curY - 30,
            count: 1,
            config: {
                speed: { min: 5, max: 25 },
                scale: { start: 0.8, end: 2.2 },
                alpha: { start: 0.35, end: 0 },
                lifespan: { min: 500, max: 900 },
                tint: 0x555555,
            },
            destroyAfterMs: 1000,
            depth: curY + 40,
        });
        burstParticles({
            texture: 'impact_dot',
            x: this.x, y: curY - 20,
            count: 2,
            config: {
                speed: { min: 20, max: 90 },
                angle: { min: 0, max: 360 },
                scale: { start: 1.0, end: 0.1 },
                alpha: { start: 0.7, end: 0 },
                lifespan: { min: 250, max: 500 },
                tint: [0xffd27a, 0xff8830],
                blendMode: 'ADD',
            },
            destroyAfterMs: 600,
            depth: curY + 42,
        });
    }

    _endFall(entities) {
        if (this._meteor && this._meteor.active) {
            this._meteor.destroy();
            this._meteor = null;
        }
        this._doImpact(entities);
    }

    _doImpact(entities) {
        const x = this.x;
        const y = this.y;
        const displayY = this.displayY;
        // 落地音效（无论是否命中都播）
        this._playSound(SOUND_LAND);
        // 伤害结算由调用方负责（含灼伤/击退/经验）
        if (this.onImpact) this.onImpact(x, y, entities);
        // 爆炸特效：冲击波扩散圈 + ADD 火焰爆发 + 烟尘余韵
        fireGroundShockwave({
            x, y: displayY, maxRadius: this.explosionRadius,
            strokeColor: 0xff7020, fillColor: 0xff9540,
            lineWidth: 9, duration: 460, flicker: true,
        });
        burstParticles({
            texture: 'impact_dot', x, y: displayY, count: 42, jitter: 0, // 爆点精确对准落地点（粒子靠速度随机散射）
            config: {
                speed: { min: 150, max: 520 },
                scale: { start: 3.2, end: 0.2 },
                alpha: { start: 0.95, end: 0 },
                lifespan: { min: 350, max: 700 },
                tint: [0xffffff, 0xffd27a, 0xff8830, 0xff5510],
                blendMode: 'ADD',
            },
            destroyAfterMs: 900, depth: displayY + 60,
        });
        burstParticles({
            texture: 'smoke_particle', x, y: displayY, count: 14, jitter: 0,
            config: {
                speed: { min: 30, max: 110 },
                scale: { start: 1.6, end: 4.0 },
                alpha: { start: 0.4, end: 0 },
                lifespan: { min: 800, max: 1400 },
                tint: 0x444444,
            },
            destroyAfterMs: 1600, depth: displayY + 55,
        });
        // 震屏（Camera.triggerShake 自带衰减，duration 由强度决定）
        if (this.shakeIntensity > 0 && Camera && typeof Camera.triggerShake === 'function') {
            Camera.triggerShake(this.shakeIntensity);
        }
        this._buildLava();
        this._ringGrow = 0;
        this._ringDone = false;
        this.phase = 'lava';
    }

    /** 熔岩余火：无油面/反光地面，纯火炬式连续燃烧铺满区域 */
    _buildLava() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        this._lavaZone = new GroundZone({
            x: this.x,
            y: this.y,
            surfaceContext: this.surfaceContext,
            radius: this.lavaRadius,
            duration: this.lavaDurationMs,
            tickMs: this.lavaTickMs,
            onTick: (z, entities) => { if (this.onTick) this.onTick(z, entities); },
            oil: null,   // 无油面
            gloss: null, // 无反光
            flame: null, // 火焰层由 _spawnTorchLava 火炬式发射器接管
        });
        this._spawnTorchLava();
    }

    /**
     * 火炬式燃烧（参考障碍物火炬 _placeTorch）：impact_dot + 三色 ADD 上飘连续发射器。
     * 每次施法在熔岩椭圆内**随机散布**（不再网格均匀），数量 54（原 18 ×3），
     * 粒子尺寸放大 25%（scale 2.75→0.4）；每个发射器自销毁于区域结束。
     */
    _spawnTorchLava() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        if (typeof scene._ensureImpactDotTexture === 'function') scene._ensureImpactDotTexture();
        if (!scene.textures.exists('impact_dot')) return;
        const rx = this.lavaRadius;
        const ry = this.lavaRadius * 0.5; // 与 GroundZone 椭圆同口径
        const count = 54; // 数量 ×3（原网格 18）
        const scaleMul = 1.25; // 效果放大 25%
        for (let i = 0; i < count; i++) {
            // 椭圆内均匀随机散布（sqrt 保证面内均匀，y 压缩 0.5 贴合透视；每次施法散布不同）
            const rr = Math.sqrt(Math.random());
            const a = Math.random() * Math.PI * 2;
            const pt = {
                x: this.x + Math.cos(a) * rr * rx,
                y: this.displayY + Math.sin(a) * rr * ry,
            };
            const em = scene.add.particles(pt.x, pt.y, 'impact_dot', {
                frequency: 70,
                speedY: { min: -50, max: -110 },
                speedX: { min: -10, max: 10 },
                scale: { start: 2.2 * scaleMul, end: 0.3 * scaleMul },
                alpha: { start: 0.9, end: 0 },
                lifespan: 600,
                tint: [0xffffff, 0xffcc55, 0xff8833],
                blendMode: 'ADD',
            });
            em.setDepth(pt.y - 996);
            em.addToUpdateList();
            this._lavaEmitters.push(em);
            scene.time.delayedCall(this.lavaDurationMs + 300, () => {
                if (em && em.active) em.destroy();
            });
        }
    }

    /** 每帧驱动（返回 false = 全部阶段结束，调用方移除并触发 onEnd） */
    update(dt, entities) {
        if (this.phase === 'fall') {
            this._fallTimer += dt;
            const p = Math.min(1, this._fallTimer / this.fallMs);
            const p2 = p * p; // 加速下坠
            const curY = this._fallFromY + (this.displayY - this._fallFromY) * p2;
            if (this._meteor && this._meteor.active) {
                this._meteor.setPosition(this.x, curY);
                this._meteor.setScale(0.45 + p * 0.9);
                this._meteor.setDepth(curY + 60);
            }
            this._trailTimer -= dt;
            if (this._trailTimer <= 0) {
                this._trailTimer = 45;
                this._spawnTrail(curY);
            }
            if (p >= 1) this._endFall(entities);
            return true;
        }
        if (this.phase === 'lava') {
            if (!this._lavaZone) {
                this.phase = 'done';
                return false;
            }
            // 燃烧音效序列：落地 0.2s 后播燃烧1；2s 起播燃烧2，之后每 0.7s 重叠循环（不等前一条播完）
            this._lavaElapsed += dt;
            if (!this._burn1Played && this._lavaElapsed >= 200) {
                this._burn1Played = true;
                this._playSound(SOUND_BURN1);
            }
            if (!this._burn2Started && this._lavaElapsed >= 2000) {
                this._burn2Started = true;
                this._nextBurn2At = 2000;
            }
            if (this._burn2Started && this._lavaElapsed >= this._nextBurn2At) {
                this._playSound(SOUND_BURN2);
                this._nextBurn2At += 700;
            }
            // 火焰椭圆边：恒定 0.5s 从落地点一个点扩散到最大影响边缘，扩散到后立即消失
            if (!this._ringDone) {
                this._ringGrow = Math.min(1, this._ringGrow + dt / 500);
                this._drawLavaRing();
                if (this._ringGrow >= 1) {
                    this._destroyLavaRing();
                    this._ringDone = true;
                }
            }
            const alive = this._lavaZone.update(dt, entities);
            if (!alive) {
                this._destroyLavaRing(); // 燃烧持续结束，椭圆边一并消失
                this.phase = 'done';
                this._lavaZone = null;
                if (this.onEnd) this.onEnd();
                return false;
            }
            return true;
        }
        return false;
    }

    /** 统一清理（死亡/场景切换调用；幂等） */
    destroy() {
        this._destroyLavaRing();
        if (this._meteor && this._meteor.active) {
            this._meteor.destroy();
            this._meteor = null;
        }
        for (const em of this._lavaEmitters) {
            if (em && em.active && typeof em.destroy === 'function') em.destroy();
        }
        this._lavaEmitters = [];
        if (this._lavaZone) {
            this._lavaZone.destroy();
            this._lavaZone = null;
        }
        this.phase = 'done';
    }

    /** 火焰椭圆边：标准椭圆 + 多层软光晕（宽而淡 → 窄而亮，无硬线条感），
     *  无呼吸/无绕圈；随 _ringGrow 从中心扩散到 lavaRadius */
    _drawLavaRing() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        if (!this._lavaRingGfx) this._lavaRingGfx = scene.add.graphics();
        const g = this._lavaRingGfx;
        g.clear();
        g.setPosition(0, 0);
        g.setDepth(this.displayY - 998); // 在火炬火焰（y-996）之下
        const baseR = Math.max(2, this.lavaRadius * this._ringGrow);
        const baseRy = baseR * 0.5; // 透视 2:1，与熔岩椭圆同口径
        // 扩散期：恒定 alpha 半透明填充，让"从点向外推开"清晰可见（无呼吸）
        if (this._ringGrow < 1) {
            g.fillStyle(0xff7020, 0.08);
            g.fillEllipse(this.x, this.displayY, baseR * 2, baseRy * 2);
        }
        // 多层软光晕（标准椭圆）：外圈宽淡辉光 → 内圈窄亮焰心，柔和无硬边
        const layers = [
            { w: 12, a: 0.05, c: 0xff7020 },
            { w: 9, a: 0.10, c: 0xff7020 },
            { w: 6, a: 0.18, c: 0xffa040 },
            { w: 3.5, a: 0.28, c: 0xffa040 },
            { w: 1.8, a: 0.40, c: 0xffb050 },
        ];
        for (const L of layers) {
            g.lineStyle(L.w, L.c, L.a);
            g.strokeEllipse(this.x, this.displayY, baseR * 2, baseRy * 2);
        }
    }

    /** 销毁火焰椭圆边（自然到期/强制清理共用；幂等） */
    _destroyLavaRing() {
        if (this._lavaRingGfx) {
            if (this._lavaRingGfx.active && typeof this._lavaRingGfx.destroy === 'function') {
                this._lavaRingGfx.destroy();
            }
            this._lavaRingGfx = null;
        }
    }
}
