import { BlendModes } from 'phaser';

// ============================================================
// SwordAuraTrail — 挥砍剑气轨迹（直线版）
// 思路：程序化生成一组笔直的竖向白色短线，沿剑身方向等距排布，攻击时按剑的
// 位置/显示尺寸持续采样；
// perpendicularToWeapon=true 时每条短直线都垂直于剑身，沿弧形轨迹连续摆放后
// 自然形成“书法毛笔划过”的弧线拖尾。
// 残影沿运动反方向后移 trailBackOffset，保证特效只出现在剑已经扫过的轨迹内。
// 并用“NORMAL 核心笔触 + ADD 发光层”叠出“剑气追剑运动轨迹”的效果：
// 核心层保证亮色场景可见，发光层负责暗场景光感。
// 参数全部走 WeaponAnimConfig[sword].aura，可随时调整。
// ============================================================

const DEFAULTS = {
    enabled: true,
    intervalMs: 12,      // 轨迹采样间隔：越小越密，覆盖更完整
    lifeMs: 220,         // 单次采样残留时间
    maxCount: 24,        // 最多同时存在的残影数
    alpha: 0.6,         // 核心笔触峰值透明度
    tint: '0xffffff',    // 固定白色剑气（暂不提取剑身颜色）
    colorSource: 'fixed', // fixed=固定 tint / weapon=从剑贴图提取颜色（预留）
    blendMode: 'normal', // normal=颜色可见性优先（亮色地面也可见），add=发光叠加
    glowEnabled: true,   // 额外叠加一层发光残影，保证暗场景下的剑气感
    glowAlpha: 0.18,
    glowScale: 1.0,
    glowTint: '0xffffff',
    glowBlendMode: 'add',
    widthMul: 0.28,      // 非垂直剑身模式：笔触宽度
    heightMul: 0.7,      // 非垂直剑身模式：笔触长度
    trailBackOffset: 2,  // 沿运动反方向轻微后移，让笔触落在剑已扫过的路径上
    minMoveDistance: 2,  // 位移小于该值不生成新残影（避免静止时堆叠/前探）
    rotateWithWeapon: false, // true=线条沿剑身方向旋转（旧逻辑）
    perpendicularToWeapon: true, // true=线条始终垂直于剑身；沿弧形轨迹连续采样即形成书法拖尾弧线
    perpendicularStripeCount: 8, // 每个采样覆盖整把剑时，沿剑身排列的垂直线条数
    perpendicularCoverageLength: 1.0, // 覆盖剑身长度比例（不能超过剑长）
    perpendicularCoverageWidth: 0.9, // 覆盖剑身宽度比例（不能超过剑宽）
    scaleStart: 0.95,    // 刚生成时缩放
    scaleEnd: 1.0,      // 消散时缩放
    fadeInRatio: 0.12,   // 生命前 12% 淡入
    fadeOutRatio: 0.88   // 生命后 12% 淡出
};

function parseTint(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const text = value.trim().replace(/^#/, '');
        const n = parseInt(text, 16);
        if (Number.isFinite(n)) return n;
    }
    return 0x9fd8ff;
}

export class SwordAuraTrail {
    constructor(scene, config = {}) {
        this.scene = scene;
        this.cfg = { ...DEFAULTS, ...(config || {}) };
        this.cfg.tint = parseTint(this.cfg.tint);
        this.cfg.glowTint = parseTint(this.cfg.glowTint !== undefined ? this.cfg.glowTint : 0xffffff);
        this.samples = [];
        this.sprites = [];
        this.glowSprites = [];
        this._weaponColorCache = new Map();
        this._lastVx = 0;
        this._lastVy = 0;
        this._lastPush = -Infinity;
        this._textureKey = 'sword_aura_brush';
        this._ensureTexture();
    }

    _now() {
        if (this.scene && this.scene.time) return this.scene.time.now;
        return (typeof performance !== 'undefined' ? performance.now() : Date.now());
    }

    _rgbToInt(r, g, b) {
        return ((Math.round(r) & 0xff) << 16) | ((Math.round(g) & 0xff) << 8) | (Math.round(b) & 0xff);
    }

    _hslToRgb(h, s, l) {
        h = ((h % 1) + 1) % 1;
        if (s === 0) {
            const v = Math.round(l * 255);
            return { r: v, g: v, b: v };
        }
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hue = (t) => {
            t = ((t % 1) + 1) % 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        return {
            r: Math.round(hue(h + 1 / 3) * 255),
            g: Math.round(hue(h) * 255),
            b: Math.round(hue(h - 1 / 3) * 255)
        };
    }

    /**
     * 从当前武器贴图提取剑身颜色：
     * - 优先采样有彩色像素（饱和度权重），避免白边/黑描边主导；
     * - 若武器本身接近灰钢色，则退化为平均色，并强制给一点饱和度；
     * - 结果按纹理 key 缓存，同一把剑只在首次提取。
     */
    getWeaponColor(textureKey) {
        if (this.cfg.colorSource !== 'weapon') return this.cfg.tint;
        if (!textureKey) return this.cfg.tint;
        if (this._weaponColorCache.has(textureKey)) return this._weaponColorCache.get(textureKey);
        if (!this.scene || !this.scene.textures || !this.scene.textures.exists(textureKey)) return this.cfg.tint;

        let color = this.cfg.tint;
        try {
            const tex = this.scene.textures.get(textureKey);
            const src = tex && typeof tex.getSourceImage === 'function' ? tex.getSourceImage() : null;
            if (!src || !src.width) return color;

            const frame = tex.get ? (tex.get('__BASE') || tex.get(0) || null) : null;
            const cutX = frame && typeof frame.cutX === 'number' ? frame.cutX : 0;
            const cutY = frame && typeof frame.cutY === 'number' ? frame.cutY : 0;
            const cutW = frame && typeof frame.cutWidth === 'number' ? frame.cutWidth : src.width;
            const cutH = frame && typeof frame.cutHeight === 'number' ? frame.cutHeight : src.height;

            const maxDim = 56;
            const scale = Math.min(1, maxDim / Math.max(cutW, cutH));
            const w = Math.max(1, Math.round(cutW * scale));
            const h = Math.max(1, Math.round(cutH * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return color;
            ctx.drawImage(src, cutX, cutY, cutW, cutH, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;

            let rSum = 0, gSum = 0, bSum = 0, count = 0;
            let colorR = 0, colorG = 0, colorB = 0, colorWeight = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] < 24) continue;
                const r = data[i], g = data[i + 1], b = data[i + 2];
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const lum = (r + g + b) / (3 * 255);
                // 排除近白背景与近黑描边
                if (lum < 0.07 || lum > 0.93) continue;
                rSum += r; gSum += g; bSum += b; count++;
                const sat = max > 0 ? (max - min) / max : 0;
                if (sat > 0.12 && lum > 0.16 && lum < 0.9) {
                    colorR += r * sat;
                    colorG += g * sat;
                    colorB += b * sat;
                    colorWeight += sat;
                }
            }
            if (count === 0) return color;

            let r, g, b;
            if (colorWeight > 0.02) {
                r = colorR / colorWeight;
                g = colorG / colorWeight;
                b = colorB / colorWeight;
            } else {
                r = rSum / count;
                g = gSum / count;
                b = bSum / count;
            }

            // 转到 HSL：保留剑身色相，把饱和度和明度约束到适合剑气表现的区间
            const nr = r / 255, ng0 = g / 255, nb0 = b / 255;
            const mx = Math.max(nr, ng0, nb0);
            const mn = Math.min(nr, ng0, nb0);
            const l = (mx + mn) / 2;
            const dl = mx - mn;
            let s = dl === 0 ? 0 : dl / (1 - Math.abs(2 * l - 1));
            s = Math.max(0.38, Math.min(0.78, s || 0.38));
            const targetL = Math.max(0.5, Math.min(0.68, l || 0.58));
            let hue = 0;
            if (dl !== 0) {
                if (mx === nr) hue = ((ng0 - nb0) / dl) % 6;
                else if (mx === ng0) hue = (nb0 - nr) / dl + 2;
                else hue = (nr - ng0) / dl + 4;
                hue /= 6;
            }
            const adjusted = this._hslToRgb(hue, s, targetL);
            color = this._rgbToInt(adjusted.r, adjusted.g, adjusted.b);
        } catch (_e) {
            color = this.cfg.tint;
        }
        this._weaponColorCache.set(textureKey, color);
        return color;
    }

    _ensureTexture() {
        if (!this.scene || !this.scene.textures) return;
        if (this.scene.textures.exists(this._textureKey)) return;

        // 垂直剑身书法纹理：画布 X 方向 = 沿剑身长度，Y 方向 = 剑身宽度。
        // 在 X 方向等距排布多条竖向短直线；旋转 swordRotation+90° 后，
        // 每条线都垂直于剑身，并且一组线覆盖整个剑身。
        const stripeCount = Math.max(3, Math.min(10, this.cfg.perpendicularStripeCount || 6));
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const brushDot = (x, y, radius, alpha) => {
            if (radius <= 0 || alpha <= 0) return;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
            grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
            grad.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.55})`);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        };

        const marginX = 10;
        const spanX = canvas.width - marginX * 2;
        for (let i = 0; i < stripeCount; i++) {
            const t = stripeCount === 1 ? 0.5 : i / (stripeCount - 1);
            const x = marginX + spanX * t;
            // 每条线都是笔直竖线，不横向波动
            for (let y = 4; y <= canvas.height - 4; y += 2) {
                brushDot(x, y, 4.6, 0.4);
                brushDot(x, y, 9.0, 0.14);
            }
            brushDot(x, 10, 8, 0.2);
            brushDot(x, canvas.height - 10, 8, 0.2);
        }

        this.scene.textures.addCanvas(this._textureKey, canvas);
    }

    pushPose(pose) {
        if (!this.cfg.enabled || !this.scene || !this.scene.textures.exists(this._textureKey)) return;
        if (!pose) return;

        const now = this._now();
        if (now - this._lastPush < this.cfg.intervalMs) return;

        const rawX = pose.x || 0;
        const rawY = pose.y || 0;
        const lastSample = this.samples[this.samples.length - 1];

        if (lastSample) {
            const dx = rawX - lastSample.rawX;
            const dy = rawY - lastSample.rawY;
            const dRot = Math.abs(Math.atan2(
                Math.sin((pose.rotation || 0) - lastSample.rotation),
                Math.cos((pose.rotation || 0) - lastSample.rotation)
            ));
            // 静态帧/几乎未移动时不要叠残影；换剑取色变化除外
            const tintChanged = pose.tint !== undefined && lastSample.tint !== undefined
                && pose.tint !== lastSample.tint;
            if (dx * dx + dy * dy < this.cfg.minMoveDistance * this.cfg.minMoveDistance
                && dRot < 0.02 && !tintChanged) {
                return;
            }
        }

        // 运动反方向：残影位置从当前剑位后移 trailBackOffset，保证只留在剑已扫过的区域。
        // 首个采样没有运动方向，先以 hold 状态入池但不渲染；下一采样到达后它才显示在历史位置，
        // 这样特效永远不会出现在剑前方。
        let dirX = 0, dirY = 0;
        if (lastSample) {
            if (lastSample.hold) lastSample.hold = false;
            const dx = rawX - lastSample.rawX;
            const dy = rawY - lastSample.rawY;
            const speed = Math.hypot(dx, dy);
            if (speed >= 0.5) {
                dirX = dx / speed;
                dirY = dy / speed;
                this._lastVx = dirX;
                this._lastVy = dirY;
            } else {
                dirX = this._lastVx;
                dirY = this._lastVy;
            }
        }

        const hasDirection = dirX !== 0 || dirY !== 0;
        const back = this.cfg.trailBackOffset || 0;
        this._lastPush = now;
        this.samples.push({
            rawX,
            rawY,
            x: hasDirection ? rawX - dirX * back : rawX,
            y: hasDirection ? rawY - dirY * back : rawY,
            rotation: pose.rotation || 0,
            width: pose.width || 1,
            height: pose.height || 1,
            tint: pose.tint !== undefined ? pose.tint : this.cfg.tint,
            hold: !hasDirection,
            age: 0
        });

        if (this.samples.length > this.cfg.maxCount) {
            this.samples.shift();
        }
    }

    update(dt = 16.67, weaponDepth = null) {
        if (!this.scene || !this.scene.textures || !this.scene.textures.exists(this._textureKey)) return;
        if (!this.cfg.enabled) {
            this._hideAll();
            return;
        }

        const life = Math.max(1, this.cfg.lifeMs || 1);
        for (const sample of this.samples) sample.age += dt;
        this.samples = this.samples.filter(sample => sample.age < life);

        // 补齐核心笔触 + 可选发光层两个 Sprite 池
        while (this.sprites.length < this.samples.length) {
            const sprite = this.scene.add.image(0, 0, this._textureKey);
            sprite.setOrigin(0.5, 0.5);
            sprite.setBlendMode(this.cfg.blendMode === 'add' ? BlendModes.ADD : BlendModes.NORMAL);
            sprite.setVisible(false);
            if (this.scene.worldEffectsGroup) this.scene.worldEffectsGroup.add(sprite);
            this.sprites.push(sprite);
        }
        if (this.cfg.glowEnabled) {
            while (this.glowSprites.length < this.samples.length) {
                const glow = this.scene.add.image(0, 0, this._textureKey);
                glow.setOrigin(0.5, 0.5);
                glow.setTint(this.cfg.glowTint);
                glow.setBlendMode(this.cfg.glowBlendMode === 'normal' ? BlendModes.NORMAL : BlendModes.ADD);
                glow.setVisible(false);
                if (this.scene.worldEffectsGroup) this.scene.worldEffectsGroup.add(glow);
                this.glowSprites.push(glow);
            }
        }

        const fallbackDepth = this.scene.weaponSprite
            ? this.scene.weaponSprite.depth - 1
            : 0;
        const depth = typeof weaponDepth === 'number' ? weaponDepth : fallbackDepth;

        for (let i = 0; i < this.sprites.length; i++) {
            const sprite = this.sprites[i];
            const sample = this.samples[i];
            if (!sample) {
                sprite.setVisible(false);
                if (this.glowSprites[i]) this.glowSprites[i].setVisible(false);
                continue;
            }
            if (sample.hold) {
                sprite.setVisible(false);
                if (this.glowSprites[i]) this.glowSprites[i].setVisible(false);
                continue;
            }

            const p = Math.max(0, Math.min(1, sample.age / life));
            const fadeIn = this.cfg.fadeInRatio > 0 ? Math.min(1, p / this.cfg.fadeInRatio) : 1;
            const fadeOut = this.cfg.fadeOutRatio < 1
                ? Math.max(0, Math.min(1, (1 - p) / (1 - this.cfg.fadeOutRatio)))
                : 1;
            const alpha = this.cfg.alpha * Math.min(fadeIn, fadeOut);
            const scale = this.cfg.scaleStart + (this.cfg.scaleEnd - this.cfg.scaleStart) * p;
            let coreW;
            let coreH;
            if (this.cfg.perpendicularToWeapon) {
                // 纹理 X 轴覆盖剑身长度，Y 轴覆盖剑身宽度；宽度乘以 0.9 避免超出剑宽
                coreW = sample.height * this.cfg.perpendicularCoverageLength * scale;
                coreH = sample.width * this.cfg.perpendicularCoverageWidth * scale;
            } else {
                coreW = sample.width * this.cfg.widthMul * scale;
                coreH = sample.height * this.cfg.heightMul * scale;
            }

            // 核心直线：NORMAL 混合，固定白色，亮色地面也可见
            let auraRotation = 0;
            if (this.cfg.perpendicularToWeapon) {
                // 书法拖尾：每段短直线都垂直于剑身；沿轨迹连续摆放后自然形成弧线
                auraRotation = sample.rotation + Math.PI / 2;
            } else if (this.cfg.rotateWithWeapon) {
                auraRotation = sample.rotation;
            }
            sprite.setTint(sample.tint !== undefined ? sample.tint : this.cfg.tint);
            sprite.setPosition(sample.x, sample.y);
            sprite.setRotation(auraRotation);
            sprite.setDisplaySize(coreW, coreH);
            sprite.setAlpha(alpha);
            sprite.setDepth(depth);
            sprite.setVisible(alpha > 0.004);

            // 发光层：ADD 混合，颜色固定白/亮色，负责暗场景的剑气光感
            if (this.cfg.glowEnabled) {
                const glow = this.glowSprites[i];
                if (glow) {
                    glow.setPosition(sample.x, sample.y);
                    glow.setRotation(auraRotation);
                    glow.setDisplaySize(coreW * this.cfg.glowScale, coreH * this.cfg.glowScale);
                    glow.setAlpha(alpha * this.cfg.glowAlpha);
                    glow.setDepth(depth - 0.001);
                    glow.setVisible(alpha * this.cfg.glowAlpha > 0.004);
                }
            }
        }
    }

    _hideAll() {
        for (const sprite of this.sprites) sprite.setVisible(false);
        for (const glow of this.glowSprites) glow.setVisible(false);
    }

    clear() {
        this.samples = [];
        this._hideAll();
        this._lastVx = 0;
        this._lastVy = 0;
        this._lastPush = -Infinity;
    }
}

export { DEFAULTS as SWORD_AURA_DEFAULTS };
