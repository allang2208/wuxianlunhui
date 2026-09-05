import { GroundZone } from '../effects/ground-zone.js';
import { FogVisualAdapter } from '../effects/fog-visual-adapter.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

// 小数量、固定图形对象；不创建物理体、不使用逐对象滤镜或长期定时器。
export class MineWarningVisual {
    constructor(scene, x, y, radius, kind) {
        Object.assign(this, { scene, x, y, radius, kind, active: true });
        this.ground = scene.add.graphics().setDepth(WORLD_RENDER_LAYERS.GROUND_WEATHER + 0.01);
        this.air = scene.add.graphics().setDepth(y + 2);
        FogVisualAdapter.register(this);
        scene.syncFogVisualEffect?.(this);
    }
    getFogPosition() { return this; }
    getFogVisuals() { return [this.ground, this.air]; }
    draw(progress, elapsed = 0) {
        const { x, y, radius: r, kind } = this;
        const sy = PERSPECTIVE_SCALE_Y;
        this.ground.clear(); this.air.clear();
        const color = kind === 'earthquake' ? 0xd5ad72 : 0xb498c7;
        this.ground.fillStyle(0x17130f, 0.3 + progress * 0.25);
        this.ground.fillEllipse(x, y, r * 2, r * 2 * sy);
        this.ground.lineStyle(2, color, 0.5 + Math.sin(elapsed * 0.009) * 0.2);
        this.ground.strokeEllipse(x, y, r * 2, r * 2 * sy);
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4;
            const len = r * (0.25 + progress * 0.65);
            this.ground.lineBetween(x + Math.cos(a) * 12, y + Math.sin(a) * 12 * sy,
                x + Math.cos(a + 0.15) * len, y + Math.sin(a + 0.15) * len * sy);
        }
        if (kind === 'earthquake') {
            const fall = Math.max(0, (progress - 0.6) / 0.4);
            const rockY = y - 300 * (1 - fall * fall);
            if (fall > 0) {
                this.air.fillStyle(0x5f574a, 1);
                this.air.fillPoints([{ x: x - 18, y: rockY - 20 }, { x: x + 8, y: rockY - 30 },
                    { x: x + 24, y: rockY - 8 }, { x: x + 13, y: rockY + 9 }, { x: x - 21, y: rockY + 4 }], true);
                this.air.fillStyle(0xb3a58b, 0.9);
                this.air.fillTriangle(x - 18, rockY - 20, x + 8, rockY - 30, x + 2, rockY - 4);
            }
        } else {
            for (let i = 0; i < 10; i++) {
                const a = i * 2.4 + elapsed * 0.0006;
                this.air.fillStyle(color, 0.06 + progress * 0.09);
                this.air.fillEllipse(x + Math.cos(a) * r * 0.6,
                    y + Math.sin(a) * r * sy * 0.5 - progress * (i % 4) * 12,
                    25 + progress * 22, 16 + progress * 16);
            }
        }
    }
    drawImpact(age) {
        this.ground.clear(); this.air.clear();
        const t = Math.min(1, age / 900);
        for (let i = 0; i < 12; i++) {
            const a = i * 2.39996;
            const distance = (15 + i * 6) * t;
            this.air.fillStyle(i % 3 ? 0x8c806c : 0xb7a992, (1 - t) * 0.28);
            this.air.fillEllipse(this.x + Math.cos(a) * distance,
                this.y + Math.sin(a) * distance * PERSPECTIVE_SCALE_Y - Math.sin(t * Math.PI) * 22,
                14 + t * 38, 10 + t * 20);
        }
    }
    destroy() {
        if (!this.active) return;
        this.active = false;
        FogVisualAdapter.unregister(this);
        this.ground.destroy(); this.air.destroy();
    }
}

export class MineGasZone extends GroundZone {
    constructor(scene, x, y, config) {
        super({ x, y, radius: config.radius, duration: config.zoneDurationMs,
            tickMs: 1000, oil: { color: 0x697c28, alpha: 0.18, growMs: config.growMs },
            gloss: { color: 0xa4b54b, alpha: 0.18, lineWidth: 3 }, flame: null });
        this.elapsed = 0;
        this.totalDuration = config.zoneDurationMs;
        this._clouds = scene.add.graphics().setDepth(y + 1);
        this._gfx.forEach((gfx, index) => gfx.setDepth(WORLD_RENDER_LAYERS.GROUND_WEATHER + index * 0.001));
        // 本天气由游戏时钟驱动，移除基类的独立呼吸 Tween，暂停时所有烟雾冻结。
        this._gfx.forEach((gfx) => scene.tweens.killTweensOf(gfx));
        scene.syncFogVisualEffect?.(this);
    }
    getFogVisuals() { return [super.getFogVisuals(), this._clouds]; }
    update(dt, entities) {
        if (!super.update(dt, entities)) return false;
        this.elapsed += dt;
        this._clouds.clear();
        const fade = Math.min(1, this.timer / 2500);
        this._clouds.setAlpha(fade);
        // 每个毒区固定18团低矮烟雾；边界及伤害共同使用 radius * oilFrac。
        for (let i = 0; i < 18; i++) {
            const a = i * 2.39996 + this.elapsed * 0.00012;
            const dist = Math.sqrt((i + 0.5) / 18) * this.radius * this.oilFrac * 0.76;
            this._clouds.fillStyle(i % 3 ? 0x61722e : 0xa0ad52, i % 3 ? 0.12 : 0.08);
            this._clouds.fillEllipse(this.x + Math.cos(a) * dist,
                this.displayY + Math.sin(a) * dist * PERSPECTIVE_SCALE_Y - 8 - Math.sin(a * 2) * 9,
                90 * this.oilFrac, 48 * this.oilFrac);
        }
        return true;
    }
    destroy() {
        this._clouds?.destroy(); this._clouds = null;
        super.destroy();
    }
}
