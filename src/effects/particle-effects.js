
function _colorObj(r, g, b, a = 1) {
    return { r, g, b, a, hex: (r << 16) | (g << 8) | b };
}

function _randomBloodColor() {
    const r = Math.random();
    if (r > 0.7) return _colorObj(220, 60, 60);
    if (r > 0.35) return _colorObj(180, 30, 30);
    return _colorObj(120, 20, 20);
}

function _randomMistColor() {
    const r = Math.random();
    if (r > 0.6) return _colorObj(180, 20, 20);
    if (r > 0.3) return _colorObj(140, 10, 10);
    return _colorObj(100, 5, 5);
}

class DodgeEffect {
    constructor(x, y, dirX, dirY) {
        this.x = x; this.y = y; this.dirX = dirX; this.dirY = dirY; this.life = 300; this.maxLife = 300; this.active = true; this.trails = [];
        this._graphics = null;
        this._initTrails();
        this._ensureGraphics();
    }
    _initTrails() {
        this.trails = [];
        for (let i = 0; i < 5; i++) this.trails.push({ x: this.x - this.dirX * i * 8, y: this.y - this.dirY * i * 8, alpha: 1 - i * 0.15, size: 14 - i * 1.5 });
    }
    reset(x, y, dirX, dirY) {
        this.x = x; this.y = y; this.dirX = dirX; this.dirY = dirY; this.life = this.maxLife; this.active = true;
        this._initTrails();
        this._ensureGraphics();
    }
    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 45);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }
    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        this.trails.forEach(t => t.alpha -= 1.872 * (dt / 1000));
        this._redraw();
    }
    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const g = this._graphics;
        const globalAlpha = this.life / this.maxLife;
        g.clear();
        g.setPosition(0, 0);
        g.setDepth(this.y + 45);
        g.fillStyle(0xa0c8a0, 1);
        this.trails.forEach(t => {
            if (t.alpha <= 0) return;
            g.fillStyle(0xa0c8a0, t.alpha * globalAlpha * 0.4);
            g.fillCircle(t.x, t.y, t.size);
        });
    }}

class DeathEffect {
    constructor(x, y, size) {
        this.x = x; this.y = y; this.size = size; this.life = 500; this.maxLife = 500; this.active = true; this.particles = [];
        this._graphics = null;
        for (let i = 0; i < 8; i++) { const angle = (Math.PI * 2 / 8) * i; this.particles.push({ x: 0, y: 0, vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3, size: 3 + Math.random() * 4 }); }
        this._ensureGraphics();
    }
    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 45);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }
    update(dt = 16.67) {
        this.life -= dt; if (this.life <= 0) { this.active = false; if (this._graphics) { this._graphics.destroy(); this._graphics = null; } return; }
        this.particles.forEach(p => { p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000); p.vx *= 0.95; p.vy *= 0.95; });
        this._redraw();
    }
    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const alpha = this.life / this.maxLife;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 45);
        g.fillStyle(0x8a7d6b, alpha);
        this.particles.forEach(p => { g.fillCircle(p.x, p.y, p.size * alpha); });
    }}

class BloodEffect {
    constructor(x, y, angle) {
        this.x = x; this.y = y; this.angle = angle; this.life = 500; this.maxLife = 500; this.active = true;
        this.particles = [];
        this._graphics = null;
        for (let i = 0; i < 20; i++) {
            const spreadAngle = angle + (Math.random() - 0.5) * Math.PI * 0.9;
            const speed = 93.6 + Math.random() * 374.4;
            this.particles.push({
                x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6,
                vx: Math.cos(spreadAngle) * speed,
                vy: Math.sin(spreadAngle) * speed,
                size: 2.5 + Math.random() * 4.5,
                color: _randomBloodColor()
            });
        }
        this._ensureGraphics();
    }
    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 45);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }
    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        this.particles.forEach(p => {
            p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000);
            p.vx *= 0.90; p.vy *= 0.90;
        });
        this._redraw();
    }
    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const alpha = this.life / this.maxLife;
        const finalAlpha = alpha * (0.4 + alpha * 0.6);
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 45);
        this.particles.forEach(p => {
            g.fillStyle(p.color.hex, finalAlpha);
            g.fillCircle(p.x, p.y, p.size * (0.6 + alpha * 0.4));
        });
    }}

class BloodMistEffect {
    constructor(x, y, angle) {
        this.x = x; this.y = y; this.life = 600; this.maxLife = 600; this.active = true;
        this.particles = [];
        this._graphics = null;
        for (let i = 0; i < 35; i++) {
            const spreadAngle = angle + (Math.random() - 0.5) * Math.PI * 0.9;
            const speed = 62.4 + Math.random() * 280.8;
            this.particles.push({
                x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8,
                vx: Math.cos(spreadAngle) * speed,
                vy: Math.sin(spreadAngle) * speed,
                size: 3 + Math.random() * 9,
                alpha: 0.5 + Math.random() * 0.5,
                color: _randomMistColor()
            });
        }
        this._ensureGraphics();
    }
    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 44);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }
    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        this.particles.forEach(p => {
            p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000);
            p.vx *= 0.90; p.vy *= 0.90;
            p.alpha -= 0.4992 * (dt / 1000);
        });
        this._redraw();
    }
    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const globalAlpha = this.life / this.maxLife;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 44);
        this.particles.forEach(p => {
            if (p.alpha <= 0) return;
            g.fillStyle(p.color.hex, p.alpha * globalAlpha);
            g.fillCircle(p.x, p.y, p.size * (0.6 + globalAlpha * 0.4));
        });
    }}

class DustEffect {
    constructor(x, y, intensity) {
        this.x = x; this.y = y; this.life = 450; this.maxLife = 450; this.active = true;
        this.particles = [];
        this._graphics = null;
        this._initParticles(intensity);
        this._ensureGraphics();
    }
    _initParticles(intensity) {
        this.particles = [];
        const count = Math.floor(5 + intensity * 6);
        for (let i = 0; i < count; i++) {
            const angle = Math.PI + (Math.random() - 0.5) * Math.PI;
            const speed = 49.92 + Math.random() * 124.8 + intensity * 49.92;
            this.particles.push({
                x: (Math.random() - 0.5) * 6,
                y: Math.random() * 3,
                vx: Math.cos(angle) * speed * 0.6,
                vy: Math.sin(angle) * speed * 0.4 - 0.3 - Math.random() * 0.6,
                size: 3 + Math.random() * (3 + intensity * 2.5),
                alpha: 0.4 + Math.random() * 0.35
            });
        }
    }
    reset(x, y, intensity) {
        this.x = x; this.y = y; this.life = this.maxLife; this.active = true;
        this._initParticles(intensity);
        this._ensureGraphics();
        if (this._graphics) {
            this._graphics.clear();
            this._graphics.setActive(true);
            this._graphics.setVisible(true);
        }
    }
    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 43);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }
    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) {
                this._graphics.clear();
                this._graphics.setActive(false);
                this._graphics.setVisible(false);
            }
            return;
        }
        this.particles.forEach(p => {
            p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000);
            p.vy -= 0.015;
            p.vx *= 0.97; p.vy *= 0.97;
            p.alpha -= 0.3744 * (dt / 1000);
        });
        this._redraw();
    }
    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const globalAlpha = this.life / this.maxLife;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 43);
        this.particles.forEach(p => {
            if (p.alpha <= 0) return;
            g.fillStyle(0xa09687, p.alpha * globalAlpha);
            g.fillCircle(p.x, p.y, p.size * (0.5 + globalAlpha * 0.5));
        });
    }}

class ZombieBloodPool {
    constructor(x, y, color) {
        this.x = x; this.y = y;
        this.life = 12000; this.maxLife = 12000; this.active = true;
        this.fadeStart = 4000;
        this.radius = 25 + Math.random() * 20;
        this.color = color || { r: 60, g: 240, b: 45 };
        this._colorHex = (this.color.r << 16) | (this.color.g << 8) | this.color.b;
        this._highlightHex = (Math.min(255, this.color.r + 50) << 16) | (Math.min(255, this.color.g + 50) << 8) | (Math.min(255, this.color.b + 40));
        this._outlineHex = (Math.min(255, this.color.r + 70) << 16) | (Math.min(255, this.color.g + 70) << 8) | (Math.min(255, this.color.b + 60));
        this.blobs = [];
        for (let i = 0; i < 12; i++) {
            this.blobs.push({
                dx: (Math.random() - 0.5) * this.radius * 2.5,
                dy: (Math.random() - 0.5) * this.radius * 1.5,
                radius: this.radius * (0.4 + Math.random() * 0.6),
                wobble: Math.random() * Math.PI * 2,
                wobbleSpeed: 0.01 + Math.random() * 0.015
            });
        }
        this._graphics = null;
        this._ensureGraphics();
    }
    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 42);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }
    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        this.blobs.forEach(b => { b.wobble += b.wobbleSpeed; });
        this._redraw();
    }
    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        let alpha = 1;
        if (this.life < this.fadeStart) alpha = this.life / this.fadeStart;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 42);
        this.blobs.forEach(b => {
            const wx = Math.sin(b.wobble) * 3;
            const wy = Math.cos(b.wobble) * 2;
            g.fillStyle(this._colorHex, 0.4 + alpha * 0.2);
            g.fillCircle(b.dx + wx, b.dy + wy, b.radius);
        });
        g.fillStyle(this._highlightHex, alpha * 0.35);
        g.fillCircle(0, 0, this.radius * 0.5);
        g.lineStyle(2, this._outlineHex, alpha * 0.3);
        g.strokeCircle(0, 0, this.radius * 0.8);
    }}

export { DodgeEffect, DeathEffect, BloodEffect, BloodMistEffect, DustEffect, RuneSwordExplodeEffect, ZombieBloodPool };

class RuneSwordExplodeEffect {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.life = 400; this.maxLife = 400; this.active = true;
        this.lines = [];
        this._graphics = null;
        for (let i = 0; i < 35; i++) {
            const angle = Math.random() * Math.PI * 2;
            const length = 15 + Math.random() * 40;
            this.lines.push({
                angle, length,
                width: 1 + Math.random() * 2,
                growDuration: 80 + Math.random() * 120,
                fadeDuration: 150 + Math.random() * 150,
                elapsed: 0
            });
        }
        this._ensureGraphics();
    }
    _ensureGraphics() {
        const scene = window.__phaserScene;
        if (this._graphics || !scene) return;
        this._graphics = scene.add.graphics();
        this._graphics.setDepth(this.y + 50);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }
    update(dt) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            if (this._graphics) { this._graphics.destroy(); this._graphics = null; }
            return;
        }
        this.lines.forEach(line => { line.elapsed += dt; });
        this.lines = this.lines.filter(line => line.elapsed < line.growDuration + line.fadeDuration);
        this._redraw();
    }
    _redraw() {
        if (!this._graphics || !this._graphics.active) return;
        const g = this._graphics;
        g.clear();
        g.setPosition(this.x, this.y);
        g.setDepth(this.y + 50);
        this.lines.forEach(line => {
            const t = line.elapsed;
            let alpha, currentLen;
            if (t < line.growDuration) {
                const p = t / line.growDuration;
                currentLen = line.length * p;
                alpha = 1;
            } else {
                const p = (t - line.growDuration) / line.fadeDuration;
                currentLen = line.length;
                alpha = 1 - p;
            }
            if (alpha <= 0) return;
            g.lineStyle(line.width, 0x3282ff, alpha);
            g.beginPath();
            g.moveTo(0, 0);
            g.lineTo(Math.cos(line.angle) * currentLen, Math.sin(line.angle) * currentLen);
            g.strokePath();
        });
    }}
