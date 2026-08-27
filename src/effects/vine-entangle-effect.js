/**
 * 紫蚀古树藤蔓缠绕表现层。
 *
 * 正式 H3 精灵图存在时播放 `fx_vine_entangle_v1`；素材尚未加载或场景无动画时，
 * 退回轻量 Graphics 藤条。两条路径都只负责视觉，控制时长由目标的 bind 状态决定。
 * depth 始终取受影响目标精灵上方，满足“藤蔓覆盖目标”的表现契约。
 */
class VineEntangleEffect {
    constructor(target, options = {}) {
        this.target = target;
        this.duration = Math.max(100, Number(options.durationMs) || 3000);
        this.life = this.duration;
        this.active = true;
        this._elapsed = 0;
        this._sprite = null;
        this._graphics = null;
        this._displaySize = Math.max(64, Number(options.displaySize) || 220);
        this._ensureVisual();
        this._syncVisual();
    }

    getFogVisuals() {
        return [this._sprite, this._graphics].filter(Boolean);
    }

    update(dt = 16.67) {
        const step = Math.max(0, Number(dt) || 0);
        this._elapsed += step;
        this.life = Math.max(0, this.life - step);
        if (!this.target?.active || this.target._isDead || !(this.target.hp > 0) || this.life <= 0) {
            this.destroy();
            return;
        }
        this._ensureVisual();
        this._syncVisual();
    }

    _ensureVisual() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || this._sprite || this._graphics) return;
        if (scene.textures?.exists?.('fx_vine_entangle')
            && scene.anims?.exists?.('fx_vine_entangle_v1')) {
            this._sprite = scene.add.sprite(0, 0, 'fx_vine_entangle');
            this._sprite.setOrigin(0.5, 0.82);
            this._sprite.setDisplaySize(this._displaySize, this._displaySize);
            this._sprite.play('fx_vine_entangle_v1');
            scene.worldEffectsGroup?.add?.(this._sprite);
            return;
        }
        this._graphics = scene.add.graphics();
        scene.worldEffectsGroup?.add?.(this._graphics);
    }

    _anchor() {
        const sprite = this.target?._phaserSprite;
        return {
            x: this.target?.collider?.x ?? this.target?.x ?? 0,
            y: this.target?.collider?.y ?? this.target?.y ?? 0,
            depth: (Number(sprite?.depth) || Number(this.target?.y) || 0) + 0.5,
        };
    }

    _syncVisual() {
        const anchor = this._anchor();
        if (this._sprite?.active) {
            this._sprite.setPosition(anchor.x, anchor.y);
            this._sprite.setDepth(anchor.depth);
            return;
        }
        const g = this._graphics;
        if (!g?.active) return;
        const grow = Math.min(1, this._elapsed / 260);
        const fade = Math.min(1, this.life / 260);
        const height = this._displaySize * 0.72 * grow;
        const width = this._displaySize * 0.34;
        const pulse = 1 + Math.sin(this._elapsed * 0.018) * 0.035;
        g.clear();
        g.setDepth(anchor.depth);
        g.lineStyle(7, 0x45351f, 0.88 * fade);
        for (let i = 0; i < 5; i++) {
            const phase = i * Math.PI * 0.72 + this._elapsed * 0.002;
            const points = [];
            for (let segment = 0; segment <= 12; segment++) {
                const t = segment / 12;
                points.push({
                    x: anchor.x + Math.sin(phase + t * Math.PI * 2.4) * width * (0.55 + t * 0.45),
                    y: anchor.y - t * height * pulse,
                });
            }
            g.strokePoints(points, false);
        }
        g.lineStyle(2, 0x9d5ad9, 0.62 * fade);
        for (let i = 0; i < 3; i++) {
            const y = anchor.y - height * (0.22 + i * 0.25);
            g.strokeEllipse(anchor.x, y, width * 2.1, width * 0.58);
        }
    }

    destroy() {
        if (this._sprite?.active) this._sprite.destroy();
        if (this._graphics?.active) this._graphics.destroy();
        this._sprite = null;
        this._graphics = null;
        this.active = false;
    }
}

export { VineEntangleEffect };
