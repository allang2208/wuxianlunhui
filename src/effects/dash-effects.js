        class DashConvergeEffect {
            constructor(x, y, target) {
                this.x = x; this.y = y;
                this.target = target || null; // 跟随目标
                this.life = 600; this.maxLife = 600; this.active = true;
                this.particles = [];
                for (let i = 0; i < 16; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 80 + Math.random() * 120;
                    this.particles.push({
                        sx: Math.cos(angle) * dist,
                        sy: Math.sin(angle) * dist,
                        delay: Math.random() * 200,
                        size: 2 + Math.random() * 3,
                        speed: 0.15 + Math.random() * 0.25,
                        color: ['#ffd700', '#ffaa33', '#ffcc00', '#ffe066'][Math.floor(Math.random() * 4)]
                    });
                }
            }
            update() {
                this.life -= 16;
                if (this.life <= 0) this.active = false;
                // 跟随目标移动
                if (this.target && this.target.active) {
                    this.x = this.target.x;
                    this.y = this.target.y;
                }
            }
            render(ctx) {
                const elapsed = this.maxLife - this.life;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);
                this.particles.forEach(p => {
                    if (elapsed < p.delay) return;
                    const t = Math.min(1, (elapsed - p.delay) / (this.maxLife - p.delay));
                    const easeT = easeOutQuad(t);
                    const px = p.sx * (1 - easeT);
                    const py = p.sy * (1 - easeT);
                    const alpha = t < 0.3 ? t / 0.3 : (1 - t) * 1.5;
                    const size = p.size * (1 - t * 0.5);
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(px, py, size, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = alpha * 0.4;
                    ctx.beginPath();
                    ctx.arc(px - p.sx * p.speed * 3, py - p.sy * p.speed * 3, size * 1.5, 0, Math.PI * 2);
                    ctx.fill();
                });
                if (elapsed > 400) {
                    const flashT = Math.min(1, (elapsed - 400) / 200);
                    ctx.globalAlpha = flashT * 0.6;
                    ctx.fillStyle = '#ffd700';
                    ctx.beginPath();
                    ctx.arc(0, 0, 8 + flashT * 12, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }
        }
        /**
         * 冲刺攻击围绕特效：圆形金色浮动
         */
        class DashAuraEffect {
            constructor(x, y, target) {
                this.x = x; this.y = y;
                this.target = target || null; // 跟随目标
                this.life = 1200; this.maxLife = 1200; this.active = true;
                this.rings = [];
                for (let i = 0; i < 3; i++) {
                    this.rings.push({
                        radius: 15 + i * 10,
                        speed: 0.02 + Math.random() * 0.03,
                        offset: Math.random() * Math.PI * 2,
                        particles: Array.from({ length: 6 + i * 2 }, (_, j) => ({
                            angle: (j / (6 + i * 2)) * Math.PI * 2 + Math.random() * 0.5,
                            size: 1.5 + Math.random() * 2,
                            color: ['#ffd700', '#ffaa33', '#ffe066', '#ffcc88'][Math.floor(Math.random() * 4)]
                        }))
                    });
                }
            }
            update() {
                this.life -= 16;
                if (this.life <= 0) this.active = false;
                // 跟随目标移动
                if (this.target && this.target.active) {
                    this.x = this.target.x;
                    this.y = this.target.y;
                }
            }
            render(ctx) {
                const progress = 1 - this.life / this.maxLife;
                const alpha = progress < 0.2 ? progress / 0.2 : (1 - progress) * 1.25;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);
                ctx.globalAlpha = alpha * 0.7;
                const now = Date.now();
                this.rings.forEach((ring, i) => {
                    const ringAlpha = 0.6 - i * 0.15;
                    ring.particles.forEach(p => {
                        const angle = p.angle + now * ring.speed * 0.001 + ring.offset;
                        const px = Math.cos(angle) * ring.radius;
                        const py = Math.sin(angle) * ring.radius;
                        const pulse = 1 + Math.sin(now * 0.003 + p.angle * 3) * 0.2;
                        const size = p.size * pulse;
                        ctx.globalAlpha = alpha * ringAlpha;
                        ctx.fillStyle = p.color;
                        ctx.beginPath();
                        ctx.arc(px, py, size, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.globalAlpha = alpha * ringAlpha * 0.3;
                        ctx.beginPath();
                        ctx.arc(px, py, size * 2.5, 0, Math.PI * 2);
                        ctx.fill();
                    });
                });
                ctx.restore();
            }
        }

        class GoldenConvergeEffect {
            constructor(x, y, directionX, directionY, target) {
                this.x = x; this.y = y;
                this.baseX = x; this.baseY = y; // 记录初始生成位置（相对目标的偏移）
                this.dirX = directionX; this.dirY = directionY;
                this.target = target || null; // 跟随目标（玩家）
                this.life = 1600; this.maxLife = 1600; this.active = true;
                this.lineCount = 24;
                this.fanAngle = (50 * Math.PI) / 180;
                // 每条线有独立随机半径（大于180）
                this.lines = [];
                for (let i = 0; i < this.lineCount; i++) {
                    this.lines.push({ radius: 120 + Math.random() * 360 });
                }
            }
            update() {
                this.life -= 16;
                if (this.life <= 0) this.active = false;
                // 跟随目标移动：保持与目标的相对偏移
                if (this.target && this.target.active) {
                    this.x = this.target.x + (this.baseX - this.target.x);
                    this.y = this.target.y + (this.baseY - this.target.y);
                }
            }
            render(ctx) {
                const progress = 1 - this.life / this.maxLife; // 0 → 1
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                // 扇形方向：与突刺方向相反（在剑尖后方展开）
                const arcAngle = Math.atan2(-this.dirY, -this.dirX);
                const startAngle = arcAngle - this.fanAngle / 2;
                const angleStep = this.fanAngle / (this.lineCount - 1);
                const alpha = 0.5 * (1 - progress * 0.5);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);
                ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.lineWidth = 1.5;
                for (let i = 0; i < this.lineCount; i++) {
                    const angle = startAngle + i * angleStep;
                    // 每条线使用自己的随机半径，从最大长度逐渐收缩到 0
                    const currentRadius = this.lines[i].radius * (1 - easeOutQuad(progress));
                    const ex = Math.cos(angle) * currentRadius;
                    const ey = Math.sin(angle) * currentRadius;
                    ctx.beginPath();
                    ctx.moveTo(0, 0); // 中心点（剑尖位置）
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

export { DashConvergeEffect, DashAuraEffect, GoldenConvergeEffect };
