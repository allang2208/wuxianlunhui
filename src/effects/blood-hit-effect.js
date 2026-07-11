import { Renderer } from '../world/renderer.js';
        class BloodHitEffect {
            constructor(x, y, angle = null) {
                this.x = x; this.y = y;
                this.life = 600; this.maxLife = 600; this.active = true;
                // 粒子系统：生成红色飙血粒子
                this.particles = [];
                const particleCount = 12 + Math.floor(Math.random() * 8); // 12-20个粒子
                for (let i = 0; i < particleCount; i++) {
                    const pAngle = (angle !== null)
                        ? angle + (Math.random() - 0.5) * Math.PI * 0.6
                        : Math.random() * Math.PI * 2;
                    const speed = 93.6 + Math.random() * 218.4; // 1.5-5 px/帧速度
                    const size = 2 + Math.random() * 4; // 2-6px大小
                    const upwardOffset = (angle !== null) ? 0 : -1.5;
                    this.particles.push({
                        x: 0, y: 0, // 相对中心位置
                        vx: Math.cos(pAngle) * speed,
                        vy: Math.sin(pAngle) * speed + upwardOffset,
                        size: size,
                        color: this._randomBloodColor(),
                        life: 400 + Math.random() * 200, // 400-600ms寿命
                        maxLife: 400 + Math.random() * 200,
                        gravity: 0.08 + Math.random() * 0.05 // 重力加速度
                    });
                }
                // 中心溅血团（大圆形，快速淡出）
                this.splash = { size: 8 + Math.random() * 6, life: 200, maxLife: 200 };
            }
            _randomBloodColor() {
                const colors = [
                    '#8a1c1c', '#a02020', '#b83030', '#c04040',
                    '#7a1515', '#9a2525', '#d03535', '#e84545'
                ];
                return colors[Math.floor(Math.random() * colors.length)];
            }
            update(dt = 16.67) {
                this.life -= dt;
                if (this.life <= 0) { this.active = false; return; }
                // 更新溅血团
                this.splash.life -= dt;
                // 更新粒子
                this.particles.forEach(p => {
                    p.life -= dt;
                    p.x += p.vx * (dt / 1000);
                    p.y += p.vy * (dt / 1000);
                    p.vy += p.gravity; // 重力下落
                    p.vx *= 0.96; // 空气阻力
                    p.size *= 0.995; // 缓慢缩小
                });
                this.particles = this.particles.filter(p => p.life > 0);
            }
            render(ctx) {
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);
                // 绘制中心溅血团
                if (this.splash.life > 0) {
                    const splashAlpha = Math.min(1, this.splash.life / 100);
                    const splashSize = this.splash.size * (1 + (1 - this.splash.life / this.splash.maxLife) * 0.5);
                    ctx.fillStyle = `rgba(180, 30, 30, ${splashAlpha})`;
                    ctx.beginPath();
                    ctx.arc(0, 0, splashSize, 0, Math.PI * 2);
                    ctx.fill();
                    // 边缘高光
                    ctx.strokeStyle = `rgba(220, 60, 60, ${splashAlpha * 0.5})`;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
                // 绘制粒子
                this.particles.forEach(p => {
                    const alpha = Math.min(1, p.life / 150);
                    ctx.fillStyle = p.color;
                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                    // 粒子拖尾（小圆点）
                    if (p.size > 3) {
                        ctx.fillStyle = `rgba(160, 20, 20, ${alpha * 0.5})`;
                        ctx.beginPath();
                        ctx.arc(p.x - p.vx * 1.5, p.y - p.vy * 1.5, p.size * 0.6, 0, Math.PI * 2);
                        ctx.fill();
                    }
                });
                ctx.restore();
            }
        }
        // 保留旧类名引用，确保兼容
        const HitEffect = BloodHitEffect;

export { BloodHitEffect };
