class MuzzleFlashEffect {
    constructor(x, y, angle, scale = 1.0, deferVisuals = false) {
        this.x = x; this.y = y; this.angle = angle; this.scale = scale;
        this.life = 80; this.maxLife = 80; this.active = true;
        // 不再绘制随弹道旋转的尖锥火苗；原有枪口粒子火光由 playMuzzleFire 保留。
        if (!deferVisuals) this._spawnEnvironmentGlow();
    }

    reset(x, y, angle, scale = 1.0) {
        this.x = x; this.y = y; this.angle = angle; this.scale = scale;
        this.life = this.maxLife; this.active = true;
        this._spawnEnvironmentGlow();
    }

    _spawnEnvironmentGlow() {
        const scene = window.__phaserScene;
        if (!scene || typeof scene.spawnEnvironmentGlow !== 'function') return;
        scene.spawnEnvironmentGlow(this.x, this.y, {
            radius: 58 * this.scale,
            color: 0xffc45a,
            alpha: 0.26,
            duration: this.maxLife,
            depth: this.y + 54,
        });
    }

    getFogVisuals() { return null; }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
        }
    }

}

export { MuzzleFlashEffect };
