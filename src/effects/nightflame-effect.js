
class NightFlameBeamEffect {
    constructor(x, y, angle, width, length, duration) {
        this.x = x; this.y = y;
        this.angle = angle;
        this.width = width; this.length = length;
        this.duration = duration;
        this.life = duration; this.active = true;
        this._startTime = Date.now();
        this._lastUpdateTime = Date.now();

        this.colors = [
            { r: 50, g: 130, b: 255, hex: 0x3282ff },
            { r: 70, g: 150, b: 255, hex: 0x4696ff },
            { r: 90, g: 170, b: 255, hex: 0x5aaaff },
            { r: 110, g: 190, b: 255, hex: 0x6ebeff },
            { r: 130, g: 210, b: 255, hex: 0x82d2ff },
            { r: 150, g: 230, b: 255, hex: 0x96e6ff }
        ];

        this.lines = [];
        this._batchTimer = 0;
        this._batchInterval = 100;
        this._batchCount = 20;
        this._radius = 17;
        this._graphics = null;
        this._ensureGraphics();
    }

    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 50);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    update(dt = 16.67) {
        this._lastUpdateTime = Date.now();
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        this._batchTimer += dt;
        if (this._batchTimer >= this._batchInterval) {
            this._batchTimer -= this._batchInterval;
            this._spawnBatch();
        }
        this.lines.forEach(line => { line.elapsed += dt; });
        this.lines = this.lines.filter(line => {
            const totalLife = line.growDuration + line.fadeDuration;
            return line.elapsed < totalLife;
        });
        this._redraw();
    }

    _spawnBatch() {
        for (let i = 0; i < this._batchCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * this._radius;
            this.lines.push({
                spreadX: dist * Math.cos(angle),
                spreadY: dist * Math.sin(angle),
                elapsed: 0,
                growDuration: 150 + Math.random() * 100,
                fadeDuration: 100 + Math.random() * 150,
                lineWidth: 1 + Math.random() * 2.5,
                color: this.colors[Math.floor(Math.random() * this.colors.length)]
            });
        }
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 50);
        g.setRotation(this.angle);

        this.lines.forEach(line => {
            const growProgress = Math.min(1, line.elapsed / line.growDuration);
            const currentLength = this.length * growProgress;
            if (currentLength <= 0) return;
            let fadeAlpha = 1;
            if (growProgress >= 1) {
                const fadeElapsed = line.elapsed - line.growDuration;
                fadeAlpha = Math.max(0, 1 - fadeElapsed / line.fadeDuration);
            }
            if (fadeAlpha <= 0) return;
            const c = line.color;
            g.lineStyle(line.lineWidth, c.hex, fadeAlpha * 0.85);
            g.beginPath();
            g.moveTo(line.spreadX, line.spreadY);
            g.lineTo(currentLength + line.spreadX, line.spreadY);
            g.strokePath();
            if (growProgress > 0.3) {
                const glowAlpha = fadeAlpha * 0.3 * Math.min(1, growProgress / 0.5);
                g.fillStyle(0xffffff, glowAlpha);
                g.fillCircle(currentLength + line.spreadX, line.spreadY, 2.5);
            }
        });

        if (this.life > 0) {
            const baseAlpha = Math.min(1, this.life / 500) * 0.3;
            g.fillStyle(0x64b4ff, baseAlpha * 0.5);
            g.fillCircle(0, 0, 15);
            g.fillStyle(0x64b4ff, baseAlpha * 0.25);
            g.fillCircle(0, 0, 10);
            g.fillStyle(0x64b4ff, baseAlpha);
            g.fillCircle(0, 0, 5);
        }
    }

    }

export { NightFlameBeamEffect };
