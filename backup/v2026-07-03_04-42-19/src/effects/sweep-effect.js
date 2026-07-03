        class SweepEffect {
            constructor(x, y, w, h, colCount, duration) {
                this.x = x; this.y = y;
                this.w = w; this.h = h;
                this.colCount = colCount;
                this.life = duration; this.maxLife = duration; this.active = true;
                this.colDelay = 50;
                this.fadeDuration = 60;
                this.visibleDuration = 120;
            }
            update(dt = 16.67) {
                this.life -= dt;
                if (this.life <= 0) {
                    this.life = this.maxLife; // 循环播放：重置生命周期
                }
            }
            render(ctx) {
                const elapsed = this.maxLife - this.life;
                const colW = this.w / this.colCount;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.translate(screenPos.x - this.w / 2, screenPos.y - this.h / 2);
                // 绘制黑色边框标记区域
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.lineWidth = 2;
                ctx.strokeRect(0, 0, this.w, this.h);
                // 绘制"测试区域"文字
                ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
                ctx.font = 'bold 12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('测试区域', this.w / 2, this.h / 2 + 4);
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
                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                    ctx.fillRect(i * colW, 0, colW, this.h);
                }
                ctx.restore();
            }
        }

export { SweepEffect };
