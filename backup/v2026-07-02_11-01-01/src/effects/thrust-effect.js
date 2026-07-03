        class ThrustEffect {
            constructor(source, range, width) {
                this.source = source; this.range = range || 100; this.width = width || 20;
                this.life = 350; this.maxLife = 350; this.active = true; this.progress = 0; this.speed = 18.72;
                // 防御性检查：source 必须有效
                if (!source || typeof source.x !== 'number' || typeof source.y !== 'number' || typeof source.rotation !== 'number') {
                    console.warn('ThrustEffect: invalid source', source);
                    this.active = false; this.source = { x: 0, y: 0, rotation: 0 };
                }
                if (!ThrustEffect._img) {
                    ThrustEffect._img = new Image();
                    ThrustEffect._img.src = 'assets/icons/sword_hilt_icon.png';
                }
            }
            update(dt = 16.67) {
                this.life -= dt;
                this.progress += this.speed * (dt / 1000);
                if (this.progress > 1) this.progress = 1;
                if (this.life <= 0) this.active = false;
            }
            render(ctx) {
                if (!ThrustEffect._img || !ThrustEffect._img.complete || ThrustEffect._img.naturalWidth === 0) return;
                if (!this.source || typeof this.source.rotation !== 'number') return;
                const alpha = Math.min(1, this.life / 150);
                const src = this.source;
                const startDist = 20;
                const endDist = this.range * 0.8;
                const currentDist = startDist + (endDist - startDist) * this.progress;
                const fx = src.x + Math.cos(src.rotation) * currentDist;
                const fy = src.y + Math.sin(src.rotation) * currentDist;
                // 防御性检查：坐标有效性
                if (!isFinite(fx) || !isFinite(fy)) return;
                const screenPos = Renderer.worldToScreen(fx, fy);
                const s = WEAPON_ANIM.size;
                const size = s * 0.4 * (0.6 + this.progress * 0.4);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);
                ctx.rotate(src.rotation + Math.PI / 4);
                ctx.globalAlpha = alpha;
                if (ThrustEffect._img && ThrustEffect._img.complete && ThrustEffect._img.naturalWidth > 0) ctx.drawImage(ThrustEffect._img, -size / 2, -size / 2, size, size);
                for (let i = 1; i <= 3; i++) {
                    const trailDist = currentDist - i * 15;
                    if (trailDist < startDist) break;
                    const tx = src.x + Math.cos(src.rotation) * trailDist;
                    const ty = src.y + Math.sin(src.rotation) * trailDist;
                    const tPos = Renderer.worldToScreen(tx, ty);
                    const tSize = size * (1 - i * 0.2);
                    ctx.globalAlpha = alpha * (0.3 - i * 0.08);
                    ctx.save();
                    ctx.translate(tPos.x, tPos.y);
                    ctx.rotate(src.rotation + Math.PI / 4);
                    if (ThrustEffect._img && ThrustEffect._img.complete && ThrustEffect._img.naturalWidth > 0) ctx.drawImage(ThrustEffect._img, -tSize / 2, -tSize / 2, tSize, tSize);
                    ctx.restore();
                }
                ctx.restore();
            }
        }


export { ThrustEffect };
