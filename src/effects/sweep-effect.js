
class SweepEffect {
    constructor(x, y, w, h, colCount, duration) {
        this.x = x; this.y = y;
        this.w = w; this.h = h;
        this.colCount = colCount;
        this.life = duration; this.maxLife = duration; this.active = true;
        this.colDelay = 50;
        this.fadeDuration = 60;
        this.visibleDuration = 120;
        this._graphics = null;
        this._label = null;
        this._createPhaserObjects();
    }

    _createPhaserObjects() {
        const scene = window.__phaserScene;
        if (!scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 60);
        this._label = scene.add.text(this.x, this.y, '测试区域', {
            fontFamily: 'SimHei, "Microsoft YaHei", "黑体", sans-serif',
            fontSize: '12px',
            color: '#000000',
            align: 'center'
        });
        this._label.setOrigin(0.5, 0.5);
        this._label.setDepth(this.y + 61);
        if (scene.worldEffectsGroup) {
            scene.worldEffectsGroup.add(this._graphics);
            scene.worldEffectsGroup.add(this._label);
        }
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.life = this.maxLife; // 循环播放：重置生命周期
        }
        this._redraw();
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const elapsed = this.maxLife - this.life;
        const colW = this.w / this.colCount;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x - this.w / 2, this.y - this.h / 2);
        g.setDepth(this.y + 60);

        // 黑色边框标记区域
        g.lineStyle(2, 0x000000, 0.8);
        g.strokeRect(0, 0, this.w, this.h);

        // 扫过的白色条带
        for (let i = 0; i < this.colCount; i++) {
            const appearStart = i * this.colDelay;
            const appearEnd = appearStart + this.fadeDuration;
            const disappearStart = appearEnd + this.visibleDuration;
            const disappearEnd = disappearStart + this.fadeDuration;
            let alpha = 0;
            if (elapsed >= appearStart && elapsed < appearEnd) {
                alpha = (elapsed - appearStart) / this.fadeDuration;
            } else if (elapsed >= appearEnd && elapsed < disappearStart) {
                alpha = 1;
            } else if (elapsed >= disappearStart && elapsed < disappearEnd) {
                alpha = 1 - (elapsed - disappearStart) / this.fadeDuration;
            }
            if (alpha <= 0) continue;
            g.fillStyle(0xffffff, alpha);
            g.fillRect(i * colW, 0, colW, this.h);
        }

        if (this._label && this._label.active) {
            this._label.setPosition(this.x, this.y);
            this._label.setDepth(this.y + 61);
            this._label.setAlpha(0.9);
        }
    }

    }

export { SweepEffect };
