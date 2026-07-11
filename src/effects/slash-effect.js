import { Renderer } from '../world/renderer.js';

class SlashEffect {
            constructor(x, y, angle, range, arc) {
                this.x = x; this.y = y; this.angle = angle; this.range = range; this.arc = arc;
                this.life = 350; this.maxLife = 350; this.active = true;
                this.startAngle = angle - arc / 2; this.endAngle = angle + arc / 2;
                this.currentAngle = this.startAngle;
                this.swingSpeed = arc * 26; // 更流畅的展开速度
            }
            update(dt = 16.67) {
                this.life -= dt;
                if (this.currentAngle < this.endAngle) {
                    this.currentAngle += this.swingSpeed * (dt / 1000);
                    if (this.currentAngle > this.endAngle) this.currentAngle = this.endAngle;
                }
                if (this.life <= 0) this.active = false;
            }
            render(ctx) {
                const alpha = Math.min(1, this.life / 200);
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);

                // 动态展开扇形
                const currentSweep = this.currentAngle - this.startAngle;
                if (currentSweep > 0) {
                    // 径向渐变：中心不透明 → 边缘淡出
                    const gradient = ctx.createRadialGradient(0, 0, this.range * 0.05, 0, 0, this.range);
                    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.7})`);
                    gradient.addColorStop(0.2, `rgba(230, 210, 180, ${alpha * 0.5})`);
                    gradient.addColorStop(0.6, `rgba(212, 197, 169, ${alpha * 0.2})`);
                    gradient.addColorStop(1, `rgba(212, 197, 169, 0)`);

                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.arc(0, 0, this.range, this.startAngle, this.currentAngle);
                    ctx.closePath();
                    ctx.fill();

                    // 扇形边缘高光
                    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.arc(0, 0, this.range, this.startAngle, this.currentAngle);
                    ctx.stroke();

                    // 两侧边缘线
                    ctx.strokeStyle = `rgba(230, 210, 180, ${alpha * 0.4})`;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(Math.cos(this.startAngle) * this.range, Math.sin(this.startAngle) * this.range);
                    ctx.moveTo(0, 0);
                    ctx.lineTo(Math.cos(this.currentAngle) * this.range, Math.sin(this.currentAngle) * this.range);
                    ctx.stroke();
                }

                ctx.restore();
            }
        }


export { SlashEffect };
