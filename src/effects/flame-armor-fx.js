import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

/**
 * 灼锋焰甲 Buff 视觉（2026-08-03 优化版）
 *
 * 1) 武器火焰：读取武器贴图像素自动定位剑身区间（排除剑柄/把手），沿剑身每 ~10px
 *    密集采样全覆盖火焰粒子——红/黄主色（去纯白），朝向由 rotation+flipX 共同校正，左右天然对称；
 * 2) 脚底火焰环：玩家脚底椭圆 footprint 外沿的火焰环 + 沿环旋转的火星：
 *    - 底层：随呼吸明暗的橙色椭圆描边（贴合 footprint 透视 2:1，深度在地面层实体之下）；
 *    - 高亮弧：一条更亮更粗的弧段沿环扫过（旋转感）；
 *    - 火星：均布 6 个火点沿环公转，每帧在火点处喷发上升火焰粒子。
 * 由 EffectManager 驱动，buff 结束/死亡/场景切换时 destroy 统一回收。
 */

function _getScene() {
    return typeof window !== 'undefined' ? window.__phaserScene : null;
}

/** 武器贴图剑身区间缓存（按纹理键；运行时像素分析一次，之后复用） */
const BLADE_RANGE_CACHE = new Map();

export class FlameArmorFx {
    constructor(player, weaponOffset = 55) {
        this.player = player;
        this.weaponOffset = weaponOffset;
        this.active = true;
        this._weaponTimer = 0;
        this._weaponEveryMs = 50;
        this._orbitTimer = 0;
        this._orbitEveryMs = 90;
        this._orbitAngle = 0;
        this._orbitSpeed = 0.0032; // rad/ms
        this._flameCount = 6;
        // 红→橙→黄主色，无纯白（纯白在 ADD 混合下会盖掉色相）
        this._flameTints = [0xff3300, 0xff5500, 0xff8830, 0xffcc00];
        this._ringGfx = null;
        this._bladeGlowGfx = null;
    }

    getFogPosition() {
        return this.player ? { x: this.player.x, y: this.player.y } : null;
    }

    getFogVisuals() {
        return [this._ringGfx, this._bladeGlowGfx];
    }

    _footprintRadius() {
        const p = this.player;
        const base = (p.collider && p.collider.radius) || p.collisionRadius || 22.5;
        return base + 6; // 外沿外扩一点，环更明显
    }

    update(dt = 16.67) {
        const p = this.player;
        if (!p || !p.active || typeof p.hasStatusEffect !== 'function' || !p.hasStatusEffect('flameArmor')) {
            this.destroy();
            return;
        }
        // 武器火焰
        this._weaponTimer -= dt;
        if (this._weaponTimer <= 0) {
            this._weaponTimer = this._weaponEveryMs;
            this._spawnWeaponFlame();
        }
        // 脚底火焰环：公转角度推进 + 沿环火星
        this._orbitAngle = (this._orbitAngle + this._orbitSpeed * dt) % (Math.PI * 2);
        this._orbitTimer -= dt;
        if (this._orbitTimer <= 0) {
            this._orbitTimer = this._orbitEveryMs;
            this._spawnOrbitFlames();
        }
        this._drawBladeGlow();
        this._drawRing();
    }

    _spawnWeaponFlame() {
        const points = this._getBladePoints();
        this._spawnFlamesAt(points, {
            speed: { min: 20, max: 80 },
            angle: { min: 200, max: 340 },
            gravityY: -150,
            scale: { start: 1.5, end: 0.2 },
            alpha: { start: 0.85, end: 0 },
            lifespan: { min: 420, max: 760 },
            tint: this._flameTints,
            blendMode: 'ADD',
        }, 850, this.player.y + 30, 2); // 每点 2 粒 + 深度在武器/玩家之上
    }

    /** 沿剑身画呼吸火焰光带（外焰橙红粗线 + 内焰亮黄细线），保证整段剑身被火焰包覆 */
    _drawBladeGlow() {
        const scene = _getScene();
        const p = this.player;
        if (!scene || !scene.add) return;
        const pts = this._getBladePoints(2);
        if (pts.length < 2) return;
        if (!this._bladeGlowGfx) {
            this._bladeGlowGfx = scene.add.graphics();
        }
        const g = this._bladeGlowGfx;
        g.clear();
        g.setPosition(0, 0);
        g.setDepth(p.y + 30);
        const breath = 0.5 + 0.5 * Math.sin(Date.now() * 0.008);
        // 外焰：粗橙红
        g.lineStyle(8, 0xff7020, 0.30 * breath);
        g.lineBetween(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
        // 内焰：亮黄
        g.lineStyle(3.5, 0xffcc55, 0.55 * breath);
        g.lineBetween(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
        // 焰心：暖白
        g.lineStyle(1.4, 0xfff0b0, 0.45 * breath);
        g.lineBetween(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
    }

    /**
     * 剑身上的均匀采样点（只覆盖剑身，排除剑柄/把手）：
     * 1) 运行时读取武器贴图像素，分析长轴上每段的不透明宽度——剑身是长而窄的区段，
     *    护手/柄部宽度突然变大；剑身区间 = 尖端起到宽度首次超过 55% 最大宽度的位置，
     *    结果按纹理键缓存（_getBladeRange）。
     * 2) 沿剑身区间每 ~10px 取一个点（密集全覆盖，不再固定 4 点）。
     * 3) 朝向：竖版贴图（剑/杖）剑身沿 local Y（尖端在贴图顶部，flipX 不影响）；
     *    横版贴图（枪械）沿 local X，视觉尖端方向 = flipX ? -1 : +1。
     */
    _getBladePoints(count = null) {
        const p = this.player;
        const scene = _getScene();
        let s = null;
        if (scene) {
            if (scene.weaponSprite && scene.weaponSprite.active && scene.weaponSprite.visible) s = scene.weaponSprite;
            else if (scene.offhandWeaponSprite && scene.offhandWeaponSprite.active && scene.offhandWeaponSprite.visible) s = scene.offhandWeaponSprite;
        }
        const pts = [];
        if (s) {
            const dw = s.displayWidth || 0;
            const dh = s.displayHeight || 0;
            const cos = Math.cos(s.rotation);
            const sin = Math.sin(s.rotation);
            const portrait = dh > dw; // 竖版：剑身沿 local Y
            const range = this._getBladeRange(s, scene, portrait);
            const axisLen = portrait ? dh : dw;
            const bladeLen = Math.max(1, (range.end - range.start) * axisLen);
            // 每 ~10px 一个点，保证整段剑身被火焰覆盖
            const n = count != null ? count : Math.max(8, Math.min(24, Math.ceil(bladeLen / 10)));
            const dir = s.flipX ? -1 : 1;
            for (let i = 0; i < n; i++) {
                const t = n === 1 ? 0.5 : i / (n - 1); // 0=剑尖 1=柄侧
                const frac = range.start + (range.end - range.start) * t;
                let lx = 0;
                let ly = 0;
                if (portrait) {
                    // 尖端在贴图顶部（local -Y），向下到剑身末端
                    ly = -dh / 2 + frac * dh;
                } else {
                    // 视觉尖端在 local dir*+X，向柄侧后退 frac 比例
                    lx = dir * (dw / 2 - frac * dw);
                }
                pts.push({
                    x: s.x + cos * lx - sin * ly,
                    y: s.y + sin * lx + cos * ly,
                });
            }
            return pts;
        }
        const cos = Math.cos(p.rotation || 0);
        const sin = Math.sin(p.rotation || 0);
        const n = count != null ? count : 10;
        for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0.5 : i / (n - 1);
            const d = 12 + (this.weaponOffset - 12) * t;
            pts.push({ x: p.x + cos * d, y: p.y + sin * d - 24 });
        }
        return pts;
    }

    /**
     * 从武器贴图分析剑身区间（长轴方向 0=尖端侧 → 1=柄侧）。
     * 竖版：按行统计不透明像素数，尖端=内容起点，剑身末端=宽度首次超过 55% 最大宽度处（护手/柄起点）。
     * 横版（枪械）无可靠护手判定，取默认 62% 枪身（后续可按需加配置）。
     * 结果按纹理键缓存；分析失败回退 [0.03, 0.62]。
     */
    _getBladeRange(s, scene, portrait) {
        const key = s.texture && s.texture.key;
        if (key && BLADE_RANGE_CACHE.has(key)) return BLADE_RANGE_CACHE.get(key);
        let range = { start: 0.03, end: 0.62 };
        try {
            const tex = scene.textures.get(key);
            const src = tex && typeof tex.getSourceImage === 'function' ? tex.getSourceImage() : null;
            if (src && src.width > 0 && src.height > 0 && typeof document !== 'undefined') {
                const cw = src.width;
                const ch = src.height;
                const canvas = document.createElement('canvas');
                canvas.width = cw;
                canvas.height = ch;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.clearRect(0, 0, cw, ch);
                ctx.drawImage(src, 0, 0);
                const data = ctx.getImageData(0, 0, cw, ch).data;
                const n = portrait ? ch : cw;
                const widths = new Array(n).fill(0);
                if (portrait) {
                    for (let y = 0; y < ch; y++) {
                        let cnt = 0;
                        const row = y * cw;
                        for (let x = 0; x < cw; x++) {
                            if (data[(row + x) * 4 + 3] > 40) cnt++;
                        }
                        widths[y] = cnt;
                    }
                } else {
                    for (let x = 0; x < cw; x++) {
                        let cnt = 0;
                        for (let y = 0; y < ch; y++) {
                            if (data[(y * cw + x) * 4 + 3] > 40) cnt++;
                        }
                        widths[x] = cnt;
                    }
                }
                let first = -1;
                let last = -1;
                for (let i = 0; i < n; i++) {
                    if (widths[i] > 0) {
                        if (first < 0) first = i;
                        last = i;
                    }
                }
                if (first >= 0 && last > first) {
                    let maxW = 0;
                    for (let i = first; i <= last; i++) {
                        if (widths[i] > maxW) maxW = widths[i];
                    }
                    if (maxW > 0) {
                        let bladeEnd = last;
                        for (let i = first; i <= last; i++) {
                            if (widths[i] > maxW * 0.55) {
                                bladeEnd = i;
                                break;
                            }
                        }
                        range = {
                            start: Math.max(0, first / n),
                            end: Math.min(1, Math.max(bladeEnd, first + 1) / n),
                        };
                    }
                }
            }
        } catch (_e) {
            range = { start: 0.03, end: 0.62 };
        }
        if (key) BLADE_RANGE_CACHE.set(key, range);
        return range;
    }

    /** 单发射器在多个点 explode（避免每个点一个发射器）；depth 缺省取最高点 y+12 */
    _spawnFlamesAt(points, config, destroyAfterMs = 800, depth = null, perPoint = 1) {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        if (typeof scene._ensureImpactDotTexture === 'function') scene._ensureImpactDotTexture();
        if (!scene.textures.exists('impact_dot')) return;
        const em = scene.add.particles(0, 0, 'impact_dot', { ...config, emitting: false });
        em.addToUpdateList();
        let maxY = -Infinity;
        for (const pt of points) {
            em.explode(perPoint, pt.x, pt.y);
            if (pt.y > maxY) maxY = pt.y;
        }
        em.setDepth(depth !== null ? depth : maxY + 12);
        scene.time.delayedCall(destroyAfterMs, () => { if (em && em.active) em.destroy(); });
    }

    /** 沿环公转的火星：单发射器在 N 个火点 explode（blizzard 雪花同款，避免每点一个发射器） */
    _spawnOrbitFlames() {
        const p = this.player;
        const r = this._footprintRadius();
        const x = p.x;
        const y = p.y;
        const points = [];
        for (let i = 0; i < this._flameCount; i++) {
            const a = this._orbitAngle + (i * Math.PI * 2) / this._flameCount;
            const fx = x + Math.cos(a) * r;
            const fy = y + Math.sin(a) * r * PERSPECTIVE_SCALE_Y;
            points.push({ x: fx, y: fy });
        }
        this._spawnFlamesAt(points, {
            speed: { min: 10, max: 45 },
            angle: { min: 200, max: 340 },
            gravityY: -120,
            scale: { start: 1.0, end: 0.15 },
            alpha: { start: 0.8, end: 0 },
            lifespan: { min: 350, max: 650 },
            tint: this._flameTints,
            blendMode: 'ADD',
        }, 750, y - 996);
    }

    /** 地面火焰环：椭圆描边（呼吸）+ 沿环旋转的高亮弧段 */
    _drawRing() {
        const scene = _getScene();
        const p = this.player;
        if (!scene || !scene.add || !scene.tweens) return;
        const r = this._footprintRadius();
        const x = p.x;
        const y = p.y;
        const ry = r * PERSPECTIVE_SCALE_Y;
        if (!this._ringGfx) {
            this._ringGfx = scene.add.graphics();
        }
        const g = this._ringGfx;
        g.clear();
        g.setPosition(0, 0);
        g.setDepth(y - 998);
        const breath = 0.55 + 0.45 * Math.sin(Date.now() * 0.006);
        // 底层环：暗橙细环
        g.lineStyle(2.5, 0xff7020, 0.30 * breath);
        g.strokeEllipse(x, y, r * 2, ry * 2);
        // 高亮弧段：更亮更粗，绕环旋转
        const arcStart = this._orbitAngle;
        const arcSpan = Math.PI / 2;
        g.lineStyle(3.5, 0xffb030, 0.85 * breath);
        g.beginPath();
        const steps = 12;
        for (let i = 0; i <= steps; i++) {
            const a = arcStart + (arcSpan * i) / steps;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * ry;
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
        }
        g.strokePath();
    }

    /** 统一回收（buff 到期/死亡/场景切换；幂等） */
    destroy() {
        if (this._bladeGlowGfx) {
            if (this._bladeGlowGfx.active && typeof this._bladeGlowGfx.destroy === 'function') {
                this._bladeGlowGfx.destroy();
            }
            this._bladeGlowGfx = null;
        }
        if (this._ringGfx) {
            if (this._ringGfx.active && typeof this._ringGfx.destroy === 'function') {
                const scene = _getScene();
                if (scene && scene.tweens) scene.tweens.killTweensOf(this._ringGfx);
                this._ringGfx.destroy();
            }
            this._ringGfx = null;
        }
        this.active = false;
    }
}
