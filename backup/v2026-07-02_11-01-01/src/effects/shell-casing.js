        class ShellCasingEffect {
            constructor(x, y, angle) {
                this.x = x; this.y = y; this.angle = angle;
                this.life = 800; this.maxLife = 800; this.active = true;
                if (!ShellCasingEffect._sharedImage) { ShellCasingEffect._sharedImage = new Image(); ShellCasingEffect._sharedImage.src = 'assets/ammo/shell_ground.png'; }
                this.image = ShellCasingEffect._sharedImage;
                // 弹壳从枪口右侧弹出，做抛物线
                const ejectAngle = angle + Math.PI * 0.7 + (Math.random() - 0.5) * 0.5;
                const speed = 156 + Math.random() * 124.8;
                this.vx = Math.cos(ejectAngle) * speed;
                this.vy = Math.sin(ejectAngle) * speed;
                this.rot = 0; this.rotSpeed = (Math.random() - 0.5) * 0.4;
                this.grounded = false;
                this.groundY = y + (Math.random() * 5);
            }
            update(dt = 16.67) {
                this.life -= dt;
                if (this.life <= 0) { this.active = false; return; }
                if (!this.grounded) {
                    this.x += this.vx * (dt / 1000); this.y += this.vy * (dt / 1000);
                    this.vy += 0.12; // 重力
                    this.rot += this.rotSpeed;
                    this.vx *= 0.98;
                    if (this.y >= this.groundY) {
                        this.grounded = true;
                        this.y = this.groundY;
                        this.vx *= 0.3;
                    }
                }
            }
            render(ctx) {
                const alpha = Math.min(1, this.life / 200);
                const pos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(this.rot);
                ctx.globalAlpha = alpha;
                if (this.grounded && this.image && this.image.complete) {
                    if (this.image && this.image.complete && this.image.naturalWidth > 0) ctx.drawImage(this.image, -6, -4, 12, 8);
                } else {
                    ctx.fillStyle = '#c4a035';
                    ctx.beginPath(); ctx.ellipse(0, 0, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
                }
                ctx.restore();
            }
        }


export { ShellCasingEffect };
