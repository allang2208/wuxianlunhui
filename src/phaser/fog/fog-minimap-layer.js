/** 小地图战争迷雾层：复用 FogMaskRenderer 的 CanvasTexture。 */
export class FogMinimapLayer {
    constructor(scene, depth = 99999.25) {
        this.scene = scene;
        this.depth = depth;
        this.sprite = null;
        this.requestedVisible = true;
    }

    setVisible(visible) {
        this.requestedVisible = !!visible;
        if (this.sprite?.active) this.sprite.setVisible(this.requestedVisible);
    }

    sync(grid, maskRenderer, layout, invZoom, layersVisible = true) {
        if (!grid?.active || !maskRenderer?.texture
            || !this.scene.textures.exists(maskRenderer.textureKey)) {
            if (this.sprite?.active) this.sprite.setVisible(false);
            return;
        }
        if (!this.sprite?.active) {
            this.sprite = this.scene.add.image(0, 0, maskRenderer.textureKey);
            this.sprite.setOrigin(0, 0);
            this.sprite.setScrollFactor(0);
            this.sprite.setDepth(this.depth);
        } else if (this.sprite.texture !== maskRenderer.texture) {
            this.sprite.setTexture(maskRenderer.textureKey);
        }
        this.sprite.setPosition(layout.contentX * invZoom, layout.contentY * invZoom);
        this.sprite.setDisplaySize(layout.contentW * invZoom, layout.contentH * invZoom);
        this.sprite.setVisible(this.requestedVisible && layersVisible);
    }

    destroy() {
        if (this.sprite?.active) this.sprite.destroy();
        this.sprite = null;
    }
}

export default FogMinimapLayer;
