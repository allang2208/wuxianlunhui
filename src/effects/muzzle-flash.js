        class MuzzleFlashEffect {
            constructor(x, y, angle, scale = 1.0) {
                this.x = x; this.y = y; this.angle = angle; this.scale = scale;
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
                    const s = 56 * (0.6 + alpha * 0.4) * this.scale;
                    ctx.globalAlpha = alpha * 0.5;
                    if (this.image && this.image.complete && this.image.naturalWidth > 0) ctx.drawImage(this.image, 0, -s * 0.35, s * 1.5, s * 0.7);
                }
                ctx.restore();
            }
        }


export { MuzzleFlashEffect };
