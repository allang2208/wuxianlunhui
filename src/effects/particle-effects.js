        class DodgeEffect {
            constructor(x, y, dirX, dirY) {
                this.x = x; this.y = y; this.dirX = dirX; this.dirY = dirY; this.life = 300; this.maxLife = 300; this.active = true; this.trails = [];
                for (let i = 0; i < 5; i++) this.trails.push({ x: x - dirX * i * 8, y: y - dirY * i * 8, alpha: 1 - i * 0.15, size: 14 - i * 1.5 });
            }
            update() { this.life -= 16; if (this.life <= 0) this.active = false; this.trails.forEach(t => t.alpha -= 0.03); }
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
            update() {
                this.life -= 16; if (this.life <= 0) this.active = false;
                this.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95; });
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
                    const speed = 1.5 + Math.random() * 6;
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
            update() {
                this.life -= 12;
                if (this.life <= 0) { this.active = false; return; }
                this.particles.forEach(p => {
                    p.x += p.vx; p.y += p.vy;
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

        class DustEffect {
            constructor(x, y, intensity) {
                this.x = x; this.y = y; this.life = 450; this.maxLife = 450; this.active = true;
                this.particles = [];
                const count = Math.floor(5 + intensity * 6);
                for (let i = 0; i < count; i++) {
                    const angle = Math.PI + (Math.random() - 0.5) * Math.PI;
                    const speed = 0.8 + Math.random() * 2 + intensity * 0.8;
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
            update() {
                this.life -= 10;
                if (this.life <= 0) { this.active = false; return; }
                this.particles.forEach(p => {
                    p.x += p.vx; p.y += p.vy;
                    p.vy -= 0.015;
                    p.vx *= 0.97; p.vy *= 0.97;
                    p.alpha -= 0.006;
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

export { DodgeEffect, DeathEffect, BloodEffect, DustEffect };
