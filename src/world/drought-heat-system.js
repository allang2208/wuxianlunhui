const TEXTURE_KEY = 'weather_drought_heat_edges';
const HEAT_DEPTH = 99988;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function ensureHeatTexture(scene, config) {
    if (scene?.textures?.exists(TEXTURE_KEY)) return true;
    if (!scene?.textures?.createCanvas) return false;
    const texture = scene.textures.createCanvas(TEXTURE_KEY, 512, 512);
    const context = texture.getContext();
    const edgeColor = config?.edgeColor || '255,126,35';
    const coreColor = config?.coreColor || '255,214,112';
    const edgeAlpha = clamp(Number(config?.textureEdgeAlpha) || 0.72, 0, 1);
    const innerAlpha = clamp(Number(config?.textureInnerAlpha) || 0.18, 0, 1);
    const edgeSize = clamp(Number(config?.edgeSizeRatio) || 0.34, 0.12, 0.48) * 512;
    context.clearRect(0, 0, 512, 512);

    const paintEdge = (x0, y0, x1, y1, rect) => {
        const gradient = context.createLinearGradient(x0, y0, x1, y1);
        gradient.addColorStop(0, `rgba(${edgeColor},${edgeAlpha})`);
        gradient.addColorStop(0.42, `rgba(${coreColor},${innerAlpha})`);
        gradient.addColorStop(1, `rgba(${coreColor},0)`);
        context.fillStyle = gradient;
        context.fillRect(...rect);
    };
    paintEdge(0, 0, edgeSize, 0, [0, 0, edgeSize, 512]);
    paintEdge(512, 0, 512 - edgeSize, 0, [512 - edgeSize, 0, edgeSize, 512]);
    paintEdge(0, 0, 0, edgeSize, [0, 0, 512, edgeSize]);
    paintEdge(0, 512, 0, 512 - edgeSize, [0, 512 - edgeSize, 512, edgeSize]);
    texture.refresh();
    return true;
}

/** 纯屏幕视觉：暖色边缘辉光缓慢呼吸，不创建物理体或玩法状态。 */
export class DroughtHeatSystem {
    constructor(scene) {
        this.scene = scene;
        this._image = null;
        this._visibility = 0;
        this._elapsedMs = 0;
    }

    update({ active = false, config = null, deltaMs = 0, running = true, loading = false,
        mapMode = false } = {}) {
        const target = active && !loading && !mapMode ? 1 : 0;
        if (target > 0 && !this._image) this._create(config || {});
        const stepMs = running ? Math.min(100, Math.max(0, Number(deltaMs) || 0)) : 0;
        if (stepMs > 0) {
            const responseMs = target > this._visibility
                ? Math.max(100, Number(config?.fadeInMs) || 1800)
                : Math.max(100, Number(config?.fadeOutMs) || 2400);
            this._visibility += (target - this._visibility)
                * (1 - Math.exp(-stepMs / responseMs));
            this._elapsedMs += stepMs;
        } else if (target > 0 && this._visibility <= 0) {
            this._visibility = 0.001;
        }
        if (!this._image?.active) return;

        const camera = this.scene?.cameras?.main;
        const zoom = camera?.zoom || 1;
        const viewW = this.scene?.scale?.width || camera?.width || 1920;
        const viewH = this.scene?.scale?.height || camera?.height || 1080;
        const pulsePeriodMs = Math.max(1200, Number(config?.pulsePeriodMs) || 5200);
        const pulseAmount = clamp(Number(config?.pulseAmount) || 0.09, 0, 0.3);
        const baseAlpha = clamp(Number(config?.alpha) || 0.5, 0, 1);
        const pulse = 1 + Math.sin(this._elapsedMs / pulsePeriodMs * Math.PI * 2) * pulseAmount;
        this._image
            .setPosition(0, 0)
            .setDisplaySize(viewW / zoom, viewH / zoom)
            .setAlpha(clamp(baseAlpha * this._visibility * pulse, 0, 1))
            .setVisible(this._visibility > 0.001);
    }

    _create(config) {
        if (!ensureHeatTexture(this.scene, config)) return;
        this._image = this.scene.add.image(0, 0, TEXTURE_KEY)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(HEAT_DEPTH)
            .setBlendMode('ADD')
            .setAlpha(0);
    }

    reset() {
        if (this._image?.active) this._image.destroy();
        this._image = null;
        this._visibility = 0;
        this._elapsedMs = 0;
    }
}

export default DroughtHeatSystem;
