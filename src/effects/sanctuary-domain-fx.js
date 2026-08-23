import { burstParticles } from './combat-fx.js';

/**
 * 圣辉领域 Buff 视觉（2026-08-23，光系中级：跟身金色圣辉环）
 *
 * - 地面：2:1 等距投影的金色圣纹环（外环描边 + 内圈柔光池 + 八枚圣纹刻度缓慢旋转）；
 * - 上空：金色光粒持续向上飘散（ADD，圣光同款语义）；
 * - 每 2s 净化脉冲时环体做一次亮度呼吸（由系统调 pulse()）。
 * 由 EffectManager 驱动，领域结束时 destroy 统一回收。
 */

const PERSPECTIVE_Y = 0.5; // 地面 2:1 椭圆（与建筑 footprint/阴影同口径）

function _getScene() {
    return typeof window !== 'undefined' ? window.__phaserScene : null;
}

export class SanctuaryDomainFx {
    /**
     * @param {object} source - 施法者（领域中心跟随）
     * @param {object} opts
     * @param {number} opts.radius - 领域半径（圣辉领域 radius = 230 + 10×等级）
     */
    constructor(source, { radius = 240 } = {}) {
        this.source = source;
        this.radius = radius;
        this.active = true;
        this._ringGfx = null;    // 圣纹环（NORMAL）
        this._glowGfx = null;    // 柔光池（ADD）
        this._angle = 0;         // 圣纹刻度旋转角
        this._particleTimer = 0;
        this._pulseT = 0;        // 净化脉冲剩余（ms）
        this._fogVisible = true;
        this._build();
        _getScene()?.syncFogVisualEffect?.(this);
    }

    getFogPosition() {
        return { x: this.source?.x, y: this.source?.y };
    }

    getFogVisuals() {
        return [this._ringGfx, this._glowGfx];
    }

    setFogVisible(visible) {
        this._fogVisible = visible;
    }

    /** 净化脉冲：环体亮度呼吸一次（由领域系统在每次净化时调用） */
    pulse() {
        this._pulseT = 300;
    }

    _build() {
        const scene = _getScene();
        if (!scene || !scene.add) return;
        this._ringGfx = scene.add.graphics();
        this._glowGfx = scene.add.graphics();
        this._glowGfx.setBlendMode('ADD');
    }

    update(dt) {
        const scene = _getScene();
        const src = this.source;
        if (!scene || !src || !src.active) { this.destroy(); return; }
        if (!this._ringGfx) return;
        this._angle += dt * 0.0004; // 缓慢旋转
        if (this._pulseT > 0) this._pulseT = Math.max(0, this._pulseT - dt);
        const pulse = this._pulseT > 0 ? (this._pulseT / 300) : 0;

        const r = this.radius;
        const depth = src.y - 6;
        this._ringGfx.setDepth(depth).setPosition(src.x, src.y);
        this._glowGfx.setDepth(depth - 1).setPosition(src.x, src.y);

        // 柔光池（径向渐亮靠叠加同心椭圆近似，ADD 混合）
        const g = this._glowGfx;
        g.clear();
        if (this._fogVisible) {
            const layers = 4;
            for (let i = layers; i >= 1; i--) {
                const t = i / layers;
                g.fillStyle(0xffd77a, 0.05 + pulse * 0.05);
                g.fillEllipse(0, 0, r * 2 * t, r * 2 * t * PERSPECTIVE_Y);
            }
        }

        // 圣纹环：外环 + 内环 + 八枚刻度
        const rg = this._ringGfx;
        rg.clear();
        if (this._fogVisible) {
            const alpha = 0.55 + pulse * 0.4;
            rg.lineStyle(3, 0xffe08a, alpha);
            rg.strokeEllipse(0, 0, r * 2, r * 2 * PERSPECTIVE_Y);
            rg.lineStyle(1.5, 0xfff3c8, alpha * 0.8);
            rg.strokeEllipse(0, 0, r * 1.7, r * 1.7 * PERSPECTIVE_Y);
            // 八枚圣纹刻度（短线段，随 _angle 旋转）
            rg.lineStyle(4, 0xffe08a, alpha);
            for (let i = 0; i < 8; i++) {
                const a = this._angle + (i * Math.PI) / 4;
                const c = Math.cos(a);
                const s = Math.sin(a) * PERSPECTIVE_Y;
                const r0 = r * 0.92;
                const r1 = r * 1.0;
                rg.lineBetween(c * r0, s * r0, c * r1, s * r1);
            }
        }

        // 上升金色光粒
        this._particleTimer -= dt;
        if (this._fogVisible && this._particleTimer <= 0) {
            this._particleTimer = 160;
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * r * 0.85;
            burstParticles({
                texture: 'impact_dot',
                x: src.x + Math.cos(a) * rr,
                y: src.y + Math.sin(a) * rr * PERSPECTIVE_Y,
                count: 3,
                jitter: 8,
                config: {
                    speed: { min: 20, max: 60 },
                    angle: { min: -100, max: -80 },
                    gravityY: -40,
                    scale: { start: 1.6, end: 0.2 },
                    alpha: { start: 0.9, end: 0 },
                    lifespan: { min: 500, max: 900 },
                    tint: [0xffffff, 0xfff3c8, 0xffe08a, 0xffc95a],
                    blendMode: 'ADD',
                },
                destroyAfterMs: 950,
                depth: src.y + 30,
            });
        }
    }

    destroy() {
        this.active = false;
        if (this._ringGfx) { this._ringGfx.destroy(); this._ringGfx = null; }
        if (this._glowGfx) { this._glowGfx.destroy(); this._glowGfx = null; }
    }
}
