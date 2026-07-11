import { Renderer } from '../world/renderer.js';
        class DodgeEffect {
            constructor(x, y, dirX, dirY) {
                this.x = x; this.y = y; this.dirX = dirX; this.dirY = dirY; this.life = 300; this.maxLife = 300; this.active = true; this.trails = [];
                for (let i = 0; i < 5; i++) this.trails.push({ x: x - dirX * i * 8, y: y - dirY * i * 8, alpha: 1 - i * 0.15, size: 14 - i * 1.5 });
            }
            update(dt = 16.67) { this.life -= dt; if (this.life <= 0) this.active = false; this.trails.forEach(t => t.alpha -= 1.872 * (dt / 1000)); }
            render(ctx) {
                const alpha = this.life / this.maxLife;
                this.trails.forEach(t => { if (t.alpha <= 0) return; const screenPos = Renderer.worldToScreen(t.x, t.y); ctx.fillStyle = `rgba(160, 200, 160, ${t.alpha * alpha * 0.4})`; ctx.beginPath(); ctx.arc(screenPos.x, screenPos.y, t.size, 0, Math.PI*2); ctx.fill(); });
            }
        }

        class DeathEffect {
            constructor(x, y, size) {
                this.x = x; this.y = y; this.size = size; this.life = 500; this.maxLife = 500; this.active = true; this.particles = [];
                for (let i = 0; i < 8; i++) { const angle = (Math.PI * 2 / 8) * i; this.particles.push({ x: 0, y: 0, vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3, size: 3 + Math.random() * 4 }); }
            }
            update(dt = 16.67) {
                this.life -= dt; if (this.life <= 0) this.active = false;
                this.particles.forEach(p => { p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000); p.vx *= 0.95; p.vy *= 0.95; });
            }
            render(ctx) {
                const alpha = this.life / this.maxLife, screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(screenPos.x, screenPos.y);
                this.particles.forEach(p => { ctx.fillStyle = `rgba(138, 125, 107, ${alpha})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI*2); ctx.fill(); });
                ctx.restore();
            }
        }

        class BloodEffect {
            constructor(x, y, angle) {
                this.x = x; this.y = y; this.angle = angle; this.life = 500; this.maxLife = 500; this.active = true;
                this.particles = [];
                for (let i = 0; i < 20; i++) {
                    const spreadAngle = angle + (Math.random() - 0.5) * Math.PI * 0.9;
                    const speed = 93.6 + Math.random() * 374.4;
                    const r = Math.random();
                    let color;
                    if (r > 0.7) color = `rgba(220, 60, 60,`;
                    else if (r > 0.35) color = `rgba(180, 30, 30,`;
                    else color = `rgba(120, 20, 20,`;
                    this.particles.push({
                        x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6,
                        vx: Math.cos(spreadAngle) * speed,
                        vy: Math.sin(spreadAngle) * speed,
                        size: 2.5 + Math.random() * 4.5,
                        color: color
                    });
                }
            }
            update(dt = 16.67) {
                this.life -= dt;
                if (this.life <= 0) { this.active = false; return; }
                this.particles.forEach(p => {
                    p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000);
                    p.vx *= 0.90; p.vy *= 0.90;
                });
            }
            render(ctx) {
                const alpha = this.life / this.maxLife;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(screenPos.x, screenPos.y);
                this.particles.forEach(p => {
                    const a = alpha * (0.4 + alpha * 0.6);
                    ctx.fillStyle = `${p.color} ${a})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * (0.6 + alpha * 0.4), 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.restore();
            }
        }

        class BloodMistEffect {
            constructor(x, y, angle) {
                this.x = x; this.y = y; this.life = 600; this.maxLife = 600; this.active = true;
                this.particles = [];
                for (let i = 0; i < 35; i++) {
                    const spreadAngle = angle + (Math.random() - 0.5) * Math.PI * 0.9;
                    const speed = 62.4 + Math.random() * 280.8;
                    const r = Math.random();
                    let color;
                    if (r > 0.6) color = `rgba(180, 20, 20,`;
                    else if (r > 0.3) color = `rgba(140, 10, 10,`;
                    else color = `rgba(100, 5, 5,`;
                    this.particles.push({
                        x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8,
                        vx: Math.cos(spreadAngle) * speed,
                        vy: Math.sin(spreadAngle) * speed,
                        size: 3 + Math.random() * 9,
                        alpha: 0.5 + Math.random() * 0.5,
                        color: color
                    });
                }
            }
            update(dt = 16.67) {
                this.life -= dt;
                if (this.life <= 0) { this.active = false; return; }
                this.particles.forEach(p => {
                    p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000);
                    p.vx *= 0.90; p.vy *= 0.90;
                    p.alpha -= 0.4992 * (dt / 1000);
                });
            }
            render(ctx) {
                const globalAlpha = this.life / this.maxLife;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(screenPos.x, screenPos.y);
                this.particles.forEach(p => {
                    if (p.alpha <= 0) return;
                    const a = p.alpha * globalAlpha;
                    ctx.fillStyle = `${p.color} ${a})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * (0.6 + globalAlpha * 0.4), 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.restore();
            }
        }

        class DustEffect {
            constructor(x, y, intensity) {
                this.x = x; this.y = y; this.life = 450; this.maxLife = 450; this.active = true;
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
            update(dt = 16.67) {
                this.life -= dt;
                if (this.life <= 0) { this.active = false; return; }
                this.particles.forEach(p => {
                    p.x += p.vx * (dt / 1000); p.y += p.vy * (dt / 1000);
                    p.vy -= 0.015;
                    p.vx *= 0.97; p.vy *= 0.97;
                    p.alpha -= 0.3744 * (dt / 1000);
                });
            }
            render(ctx) {
                const globalAlpha = this.life / this.maxLife;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(screenPos.x, screenPos.y);
                this.particles.forEach(p => {
                    if (p.alpha <= 0) return;
                    const a = p.alpha * globalAlpha;
                    ctx.fillStyle = `rgba(160, 150, 135, ${a})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * (0.5 + globalAlpha * 0.5), 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.restore();
            }
        }

class ZombieBloodPool {
    constructor(x, y, color) {
        this.x = x; this.y = y;
        this.life = 12000; this.maxLife = 12000; this.active = true;
        this.fadeStart = 4000;
        this.radius = 25 + Math.random() * 20;
        this.color = color || { r: 60, g: 240, b: 45 };
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
    }
    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) { this.active = false; return; }
        this.blobs.forEach(b => { b.wobble += b.wobbleSpeed; });
    }
    render(ctx) {
        const screenPos = Renderer.worldToScreen(this.x, this.y);
        let alpha = 1;
        if (this.life < this.fadeStart) {
            alpha = this.life / this.fadeStart;
        }
        ctx.save();
        ctx.globalAlpha = alpha * 0.5;
        const c = this.color;
        this.blobs.forEach(b => {
            const wobbleX = Math.sin(b.wobble) * 3;
            const wobbleY = Math.cos(b.wobble) * 2;
            ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${0.4 + alpha * 0.2})`;
            ctx.beginPath();
            ctx.arc(screenPos.x + b.dx + wobbleX, screenPos.y + b.dy + wobbleY, b.radius, 0, Math.PI * 2);
            ctx.fill();
        });
        // 中心高光（更亮）
        ctx.fillStyle = `rgba(${c.r + 50}, ${c.g + 50}, ${c.b + 40}, ${alpha * 0.35})`;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, this.radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // 外圈轮廓
        ctx.strokeStyle = `rgba(${c.r + 70}, ${c.g + 70}, ${c.b + 60}, ${alpha * 0.3})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, this.radius * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

export { DodgeEffect, DeathEffect, BloodEffect, BloodMistEffect, DustEffect, RuneSwordExplodeEffect, ZombieBloodPool };

class RuneSwordExplodeEffect {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.life = 400; this.maxLife = 400; this.active = true;
        this.lines = [];
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
    }
    update(dt) {
        this.life -= dt;
        if (this.life <= 0) { this.active = false; return; }
        this.lines.forEach(line => { line.elapsed += dt; });
        this.lines = this.lines.filter(line => line.elapsed < line.growDuration + line.fadeDuration);
    }
    render(ctx) {
        const screenPos = Renderer.worldToScreen(this.x, this.y);
        ctx.save(); ctx.translate(screenPos.x, screenPos.y);
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
            ctx.strokeStyle = `rgba(50, 130, 255, ${alpha})`;
            ctx.lineWidth = line.width;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(line.angle) * currentLen, Math.sin(line.angle) * currentLen);
            ctx.stroke();
        });
        ctx.restore();
    }
}
