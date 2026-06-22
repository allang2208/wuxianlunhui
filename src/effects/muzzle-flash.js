        class MuzzleFlashEffect {
            constructor(x, y, angle) {
                this.x = x; this.y = y; this.angle = angle;
                this.life = 80; this.maxLife = 80; this.active = true;
                if (!MuzzleFlashEffect._sharedImage) { MuzzleFlashEffect._sharedImage = new Image(); MuzzleFlashEffect._sharedImage.src = 'assets/effects/muzzle_flash_01.png'; }
                this.image = MuzzleFlashEffect._sharedImage;
            }
            update() { this.life -= 16; if (this.life <= 0) this.active = false; }
            render(ctx) {
                const alpha = this.life / this.maxLife;
                const pos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(this.angle);
                if (this.image && this.image.complete) {
                    const s = 28 * (0.6 + alpha * 0.4);
                    ctx.globalAlpha = alpha;
                    if (this.image && this.image.complete && this.image.naturalWidth > 0) ctx.drawImage(this.image, 0, -s * 0.35, s, s * 0.7);
                }
                ctx.restore();
            }
        }


export { MuzzleFlashEffect };
