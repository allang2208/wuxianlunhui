import { DamageableEntity } from './damageable-entity.js';

        class TargetDummy extends DamageableEntity {
            constructor(x, y, config = {}) { super(x, y, { hp: config.hp || 200, maxHp: config.maxHp || 200, size: config.size || 24, collisionRadius: 20, name: config.name || '训练靶', ...config }); this.wobble = 0; this.baseY = y; this.expValue = config.expValue || 10; }
            update() {
                if (Math.abs(this.knockbackX) > 0.1 || Math.abs(this.knockbackY) > 0.1) {
                    const nx = this.x + this.knockbackX;
                    const ny = this.y + this.knockbackY;
                    // 击退时加入墙壁碰撞检测，防止穿墙
                    const radius = this.collisionRadius || this.size * 0.6 || 10;
                    if (typeof WallSystem !== 'undefined' && WallSystem.walls && WallSystem.walls.length > 0) {
                        const resolved = WallSystem.resolve(this.x, this.y, nx, ny, radius);
                        // 撞墙检测：如果resolve限制了移动，往反方向反弹5px
                        const hitWall = Math.abs(resolved.x - nx) > 0.5 || Math.abs(resolved.y - ny) > 0.5;
                        if (hitWall) {
                            const angle = Math.atan2(this.knockbackY, this.knockbackX);
                            this.x = resolved.x - Math.cos(angle) * 5;
                            this.baseY += (resolved.y - this.y) - Math.sin(angle) * 5;
                            // 撞墙烟雾效果：在墙面位置产生
                            if (typeof EffectManager !== 'undefined') EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                            this.knockbackX = 0;
                            this.knockbackY = 0;
                        } else {
                            this.x = resolved.x;
                            this.baseY += (resolved.y - this.y);
                        }
                    } else {
                        this.x = nx;
                        this.baseY += this.knockbackY;
                    }
                    this.knockbackX *= this.knockbackFriction;
                    this.knockbackY *= this.knockbackFriction;
                    if (Math.abs(this.knockbackX) < 0.1) this.knockbackX = 0;
                    if (Math.abs(this.knockbackY) < 0.1) this.knockbackY = 0;
                }
                if (this.hitFlash > 0) this.hitFlash -= 16;
                this.wobble += 0.05;
                this.y = this.baseY + Math.sin(this.wobble) * 3;
            }
            render(ctx) {
                const screenPos = Renderer.worldToScreen(this.x, this.y), x = screenPos.x, y = screenPos.y;
                ctx.save(); ctx.translate(x, y);
                ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(0, this.size + 4, this.size * 0.8, 6, 0, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = this.hitFlash > 0 ? '#ffaaaa' : '#8a7d6b'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#5a4d3f'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.25, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = '#5a4d3f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.stroke();
                ctx.restore();
                this.renderHealthBar(ctx);
                ctx.fillStyle = '#d4c5a9'; ctx.font = '11px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${this.name} ${this.hp}/${this.maxHp}`, x, y - this.size - 18);
                this.renderCollisionRadius(ctx);
            }
        }

export { TargetDummy };
