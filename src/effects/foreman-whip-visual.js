import motion from '../../data/foreman-whip-motion.json';
import { projectForemanWhip } from '../entities/enemy-types/_shared/foreman-whip-geometry.js';

/** 场景持有的工头附属鞭层；不使用独立Tween/计时器，不参与伤害结算。 */
export class ForemanWhipVisuals {
    constructor(scene) {
        this.scene = scene;
        this.effects = new Map();
        this.active = new Set();
        scene.events.once('shutdown', this.destroy, this);
    }

    getVisual(entity) {
        return this.effects.get(entity);
    }

    sync(game) {
        this.active.clear();
        const scene = this.scene;
        for (const entity of game?.entities?.values?.() || []) {
            if (entity?.id !== 'foremanZombie') continue;
            // 完整鞭身已在攻击图中时禁用旧曲线；仍让实体保存石化时的实际动画帧。
            if (entity.config?.textures?.attackWhipMode === 'baked') continue;
            const state = entity.getWhipVisualState?.();
            const sprite = entity._phaserSprite;
            if (!state || !entity.active || !sprite?.active
                || sprite.texture?.key !== 'enemy_foreman_attack') continue;
            this.active.add(entity);
            let graphics = this.effects.get(entity);
            if (!graphics?.active) {
                graphics = scene.add.graphics();
                scene.worldEffectsGroup?.add(graphics);
                this.effects.set(entity, graphics);
            }
            const visible = sprite.visible && !scene._mapModeActive
                && entity._viewportRenderVisible !== false;
            graphics.setVisible(visible);
            if (!visible) continue;

            const layout = entity.config.textures.frameLayouts.attack;
            const localX = (sprite.flipX ? layout.frameWidth - layout.footX : layout.footX)
                - sprite.originX * layout.frameWidth;
            const localY = layout.footY - sprite.originY * layout.frameHeight;
            const root = sprite.getWorldTransformMatrix().transformPoint(localX, localY);
            const pixelScale = Math.abs(sprite.scaleX);
            const index = Math.max(0, Math.min(motion.frames.length - 1, state.frame));
            const points = projectForemanWhip({
                pose: motion.frames[index], contactPose: motion.frames[motion.contactFrame],
                frame: index, contactFrame: motion.contactFrame, root, pixelScale,
                angle: state.angle, flipX: sprite.flipX, reach: state.reach,
                strikeHeight: state.strikeHeight,
            });

            // 消费本帧已完成遮挡仲裁的深度；后向鞭身在身体后，前向在身体前。
            graphics.setDepth(sprite.depth + (Math.sin(state.angle) > 0.1 ? 0.02 : -0.02));
            graphics.setAlpha(sprite.alpha * (motion.whipOpacities?.[index] ?? 1));
            if (graphics.mask !== sprite.mask) {
                graphics.clearMask(false);
                if (sprite.mask) graphics.setMask(sprite.mask);
            }
            graphics.clear();
            const outer = state.petrified ? 0x454545 : 0x311c12;
            const inner = state.petrified ? 0x858585 : 0x774d2a;
            const widths = motion.strokeWidths || [4.277934, 1.887324];
            for (let pass = 0; pass < 2; pass++) {
                for (let i = 0; i < points.length - 1; i++) {
                    const taper = 1 - 0.7 * i / (points.length - 1);
                    graphics.lineStyle(Math.max(0.65, widths[pass] * pixelScale * taper), pass ? inner : outer, 1);
                    graphics.lineBetween(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
                }
            }
            if (!state.petrified && index >= motion.contactFrame && index <= motion.contactFrame + 1) {
                const tip = points[points.length - 1];
                graphics.fillStyle(0xe4bd7a, 0.8);
                graphics.fillCircle(tip.x, tip.y, 2.5);
            }
        }
        for (const [entity, graphics] of this.effects) {
            if (this.active.has(entity)) continue;
            if (graphics.active) {
                graphics.clearMask(false);
                graphics.destroy();
            }
            this.effects.delete(entity);
        }
    }

    destroy() {
        for (const graphics of this.effects.values()) {
            if (!graphics?.active) continue;
            graphics.clearMask(false);
            graphics.destroy();
        }
        this.effects.clear();
        this.active.clear();
        this.scene._foremanWhips = null;
    }
}
