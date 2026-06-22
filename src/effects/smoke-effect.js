        // 烟雾图片预加载（本地管理）
        const SMOKE_FRAMES = [
            'assets/effects/smoke_01_start.png','assets/effects/smoke_02_expand.png',
            'assets/effects/smoke_03_grow.png','assets/effects/smoke_04_peak.png',
            'assets/effects/smoke_05_fade.png','assets/effects/smoke_06_shrink.png',
            'assets/effects/smoke_07_wisp.png','assets/effects/smoke_08_gone.png',
        ];
        const smokeImages = SMOKE_FRAMES.map(src => { const img = new Image(); img.src = src; return img; });

        class SmokeEffect {
            constructor(x, y, size = 60) {
                this.x = x; this.y = y; this.size = size;
                this.life = 3000; this.maxLife = 3000; this.active = true; this.frameCount = 8;
            }
            update() { this.life -= 16; if (this.life <= 0) this.active = false; }
            render(ctx) {
                const progress = 1 - this.life / this.maxLife;
                const frameIndex = Math.min(7, Math.floor(progress * this.frameCount));
                const img = smokeImages[frameIndex];
                if (!img || !img.complete) return;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.globalAlpha = 0.5;
                const s = this.size;
                if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, screenPos.x - s / 2, screenPos.y - s / 2, s, s);
                ctx.restore();
            }
        }
        /**
         * 白底攻击范围显示效果（兼容 legacy.js 单文件模式）
         */

export { SmokeEffect };
