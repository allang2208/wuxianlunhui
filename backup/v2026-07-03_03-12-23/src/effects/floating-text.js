        class FloatingTextEffect {
            constructor(x, y, text) {
                this.x = x; this.y = y; this.text = text;
                this.life = 1200; this.maxLife = 1200; this.active = true;
                this.vy = -0.8;
            }
            update(dt = 16.67) {
                this.life -= dt;
                this.y += this.vy * (dt / 1000);
                if (this.life <= 0) this.active = false;
            }
            render(ctx) {
                const alpha = this.life / this.maxLife;
                const pos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.globalAlpha = alpha;
                ctx.fillStyle = '#d4c5a9'; ctx.font = '14px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(this.text, pos.x, pos.y);
                ctx.restore();
            }
        }


export { FloatingTextEffect };
