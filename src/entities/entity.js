        class Entity {
            constructor(x, y) { this.id = Math.random().toString(36).substr(2, 9); this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.rotation = 0; this.active = true; this.hittable = false; this.components = new Map(); }
            addComponent(name, comp) { this.components.set(name, comp); comp.entity = this; }
            update() {} render(ctx) {} takeDamage(damage, source) {} applyKnockback(angle, force) {}
            renderCollisionRadius(ctx) {
                const radius = this.collisionRadius || this.size * 0.6 || 10;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
                ctx.beginPath();
                ctx.arc(screenPos.x, screenPos.y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            }
        }

export { Entity };
