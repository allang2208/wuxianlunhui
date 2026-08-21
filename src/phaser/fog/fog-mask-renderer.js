function parseColor(value, fallback) {
    if (typeof value !== 'string' || value[0] !== '#') return fallback;
    const parsed = Number.parseInt(value.slice(1), 16);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clampAlpha(value, fallback) {
    const parsed = Number(value);
    return Math.max(0, Math.min(1, Number.isFinite(parsed) ? parsed : fallback));
}

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

/** 主画面战争迷雾遮罩：管理低分辨率纹理、柔边和显隐过渡。 */
export class FogMaskRenderer {
    constructor(scene, fogSystem, textureKey = 'world_fog_of_war_mask') {
        this.scene = scene;
        this.fogSystem = fogSystem;
        this.textureKey = textureKey;
        this.texture = null;
        this.sprite = null;
        this.state = null;
        this.revision = -1;
        this.columns = 0;
        this.rows = 0;
        this.visualAlpha = null;
        this.targetAlpha = null;
        this.imageData = null;
        this.visualReady = false;
        this.transitioning = false;
        this.enabled = true;
        this.lastRenderMs = 0;
        this.lastChangedCells = 0;
    }

    setVisible(visible) {
        this.enabled = !!visible;
        if (this.sprite?.active) this.sprite.setVisible(this.enabled && !!this.state?.active);
    }

    hide() {
        if (this.sprite?.active) this.sprite.setVisible(false);
        this.state = null;
    }

    _ensureTexture(grid) {
        const dimensionsChanged = this.columns !== grid.columns || this.rows !== grid.rows;
        if (this.texture && !dimensionsChanged) return;
        if (this.sprite?.active) this.sprite.destroy();
        this.sprite = null;
        if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);
        this.texture = this.scene.textures.createCanvas(this.textureKey, grid.columns, grid.rows);
        this.columns = grid.columns;
        this.rows = grid.rows;
        this.revision = -1;
        this.visualAlpha = new Float32Array(grid.columns * grid.rows);
        this.targetAlpha = new Float32Array(grid.columns * grid.rows);
        this.imageData = this.texture.getContext().createImageData(grid.columns, grid.rows);
        this.visualReady = false;
        this.transitioning = false;
        this.sprite = this.scene.add.image(0, 0, this.textureKey);
        this.sprite.setOrigin(0, 0);
        this.sprite.setDepth(Number(this.fogSystem.config.overlay?.depth) || 99980);
    }

    update(sceneId, grid, deltaMs = 16.67) {
        const startedAt = nowMs();
        if (!this.fogSystem.isEnabled(sceneId) || !grid?.active) {
            this.hide();
            return false;
        }
        if (this.state !== grid) {
            this.state = grid;
            this.revision = -1;
            this.visualReady = false;
            this.transitioning = false;
        }
        this._ensureTexture(grid);
        this.sprite.setDisplaySize(grid.width, grid.height);
        this.sprite.setVisible(this.enabled);

        const overlay = this.fogSystem.config.overlay || {};
        const visual = this.fogSystem.config.visual || {};
        const unexploredColor = parseColor(overlay.unexploredColor, 0x020406);
        const exploredColor = parseColor(overlay.exploredColor, 0x07100d);
        const unexploredAlpha = clampAlpha(overlay.unexploredAlpha, 1);
        const exploredAlpha = clampAlpha(overlay.exploredAlpha, 0.62);
        let dirty = false;
        let changedCells = 0;

        if (this.revision !== grid.revision) {
            for (let i = 0; i < grid.visible.length; i += 1) {
                const next = grid.visible[i] ? 0 : (grid.explored[i] ? exploredAlpha : unexploredAlpha);
                if (this.targetAlpha[i] !== next) changedCells += 1;
                this.targetAlpha[i] = next;
            }
            if (!this.visualReady) {
                this.visualAlpha.set(this.targetAlpha);
                this.visualReady = true;
                this.transitioning = false;
            } else if (changedCells > 0) {
                this.transitioning = true;
            }
            this.revision = grid.revision;
            dirty = true;
        }

        if (!dirty && !this.transitioning) {
            this.lastChangedCells = 0;
            this.lastRenderMs = nowMs() - startedAt;
            return false;
        }

        const dt = Math.max(0, Math.min(100, Number(deltaMs) || 0));
        const revealMs = Math.max(1, Number(visual.revealTransitionMs) || 180);
        const concealMs = Math.max(1, Number(visual.concealTransitionMs) || 260);
        let stillTransitioning = false;
        for (let i = 0; i < this.visualAlpha.length; i += 1) {
            const current = this.visualAlpha[i];
            const target = this.targetAlpha[i];
            const diff = target - current;
            if (Math.abs(diff) <= 0.002) {
                if (current !== target) {
                    this.visualAlpha[i] = target;
                    dirty = true;
                }
                continue;
            }
            const duration = diff < 0 ? revealMs : concealMs;
            this.visualAlpha[i] = current + Math.sign(diff) * Math.min(Math.abs(diff), dt / duration);
            if (Math.abs(this.targetAlpha[i] - this.visualAlpha[i]) > 0.002) stillTransitioning = true;
            dirty = true;
        }
        this.transitioning = stillTransitioning;
        this.lastChangedCells = changedCells;
        if (!dirty) {
            this.lastRenderMs = nowMs() - startedAt;
            return false;
        }

        const softness = Math.max(0, Math.min(1, Number(visual.edgeSoftness) || 0));
        const pixels = this.imageData;
        for (let i = 0; i < grid.visible.length; i += 1) {
            const explored = grid.explored[i] !== 0;
            const color = explored ? exploredColor : unexploredColor;
            let alpha = this.visualAlpha[i];
            if (softness > 0) {
                const row = Math.floor(i / grid.columns);
                const column = i - row * grid.columns;
                let sum = alpha * 4;
                let weight = 4;
                for (let dy = -1; dy <= 1; dy += 1) {
                    const sy = row + dy;
                    if (sy < 0 || sy >= grid.rows) continue;
                    for (let dx = -1; dx <= 1; dx += 1) {
                        if (dx === 0 && dy === 0) continue;
                        const sx = column + dx;
                        if (sx < 0 || sx >= grid.columns) continue;
                        const sampleWeight = dx === 0 || dy === 0 ? 2 : 1;
                        sum += this.visualAlpha[sy * grid.columns + sx] * sampleWeight;
                        weight += sampleWeight;
                    }
                }
                alpha += (sum / weight - alpha) * softness;
            }
            const offset = i * 4;
            pixels.data[offset] = (color >> 16) & 0xff;
            pixels.data[offset + 1] = (color >> 8) & 0xff;
            pixels.data[offset + 2] = color & 0xff;
            pixels.data[offset + 3] = Math.round(alpha * 255);
        }
        const context = this.texture.getContext();
        context.putImageData(pixels, 0, 0);
        this.texture.refresh();
        this.lastRenderMs = nowMs() - startedAt;
        return true;
    }

    destroy() {
        if (this.sprite?.active) this.sprite.destroy();
        this.sprite = null;
        if (this.scene?.textures?.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);
        this.texture = null;
        this.state = null;
    }
}

export default FogMaskRenderer;
