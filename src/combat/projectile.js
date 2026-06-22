        class Projectile {
            constructor(x, y, angle, speed, maxRange, size, damage, piercing, source, entities, image, isTracer = false) {
                this.x = x; this.y = y; this.angle = angle; this.speed = speed; this.maxRange = maxRange; this.size = size;
                this.damage = damage; this.piercing = piercing; this.source = source; this.entities = entities;
                this.traveled = 0; this.active = true; this.hitTargets = new Set(); this.image = image;
                this.isTracer = isTracer; // 是否为曳光弹（G18手枪）
            }
            update() {
                const dx = Math.cos(this.angle) * this.speed, dy = Math.sin(this.angle) * this.speed;
                this.x += dx; this.y += dy; this.traveled += this.speed;
                if (this.traveled >= this.maxRange) { this.active = false; return; }
                if (this.x < 0 || this.x > CONFIG.WORLD_WIDTH || this.y < 0 || this.y > CONFIG.WORLD_HEIGHT) { this.active = false; return; }
                // 墙壁碰撞检测：弹道不能穿过墙
                if (WallSystem.blocked(this.x - dx * 2, this.y - dy * 2, this.x, this.y)) { this.active = false; return; }
                this.entities.forEach(entity => {
                    if (entity === this.source || !entity.active || !entity.hittable) return;
                    if (this.hitTargets.has(entity.id)) return;
                    const dist = MathUtils.distance(this.x, this.y, entity.x, entity.y);
                    if (dist < entity.size + this.size) {
                        const damage = Math.floor(MathUtils.randomRange(this.damage.min, this.damage.max));
                        entity.takeDamage(damage, this.source);
                        // 远程武器击退 = 0
                        // 攻击特效已关闭（纯动作模式）：不显示 BloodEffect 血溅
                        // { let b = EffectManager._acquire('BloodEffect');
                        // if (b) { b.x = entity.x; b.y = entity.y; b.angle = this.angle; b.life = 500; b.active = true;
                        //     b.particles.forEach(p => { const sa = this.angle + (Math.random()-0.5)*Math.PI*0.9; const sp = 1.5+Math.random()*6; p.vx = Math.cos(sa)*sp; p.vy = Math.sin(sa)*sp; p.x = (Math.random()-0.5)*6; p.y = (Math.random()-0.5)*6; }); }
                        // else b = new BloodEffect(entity.x, entity.y, this.angle);
                        // EffectManager.add(b); }
                        if (!this.piercing) this.active = false; else this.hitTargets.add(entity.id);
                    }
                });
            }
            render(ctx) {
                if (this.isTracer) {
                    // 黄色曳光弹：绘制发光弹道线
                    const screenPos = Renderer.worldToScreen(this.x, this.y);
                    const tailLen = 40; // 弹道尾迹长度
                    const tx = screenPos.x - Math.cos(this.angle) * tailLen;
                    const ty = screenPos.y - Math.sin(this.angle) * tailLen;
                    ctx.save();
                    // 外层光晕（较宽、较淡）
                    ctx.strokeStyle = 'rgba(255, 220, 50, 0.25)';
                    ctx.lineWidth = 8;
                    ctx.lineCap = 'round';
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 中层光晕
                    ctx.strokeStyle = 'rgba(255, 235, 80, 0.5)';
                    ctx.lineWidth = 4;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 核心亮线
                    ctx.strokeStyle = 'rgba(255, 250, 150, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 头部高亮光点
                    ctx.fillStyle = '#fff8c0';
                    ctx.beginPath(); ctx.arc(screenPos.x, screenPos.y, 2.5, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                    return;
                }
                // 非曳光弹（弓矢）：绘制箭矢贴图
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(screenPos.x, screenPos.y); ctx.rotate(this.angle);
                if (this.image && this.image.complete && this.image.naturalWidth > 0) {
                    const s = this.size * 10; const w = s * 0.22;
                    ctx.rotate(-Math.PI / 2); ctx.drawImage(this.image, -w / 2, -s / 2, w, s);
                } else {
                    // 无贴图时绘制简单箭头
                    ctx.fillStyle = '#d4c5a9';
                    ctx.beginPath();
                    ctx.moveTo(0, -8); ctx.lineTo(4, 4); ctx.lineTo(0, 2); ctx.lineTo(-4, 4);
                    ctx.closePath(); ctx.fill();
                }
                ctx.restore();
            }
        }

export { Projectile };
