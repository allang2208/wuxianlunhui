class Portal {
    constructor(x, y, targetScene, label) {
        this.x = x; this.y = y;
        this.targetScene = targetScene;
        this.label = label || '传送门';
        this.size = 40;
        this.noCollision = true;
        this.active = true;
        this.pulseTimer = 0;
    }
    update(dt) {
        this.pulseTimer += dt / 1000;
    }
}

export { Portal };
