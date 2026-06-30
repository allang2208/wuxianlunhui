        class Projectile {
            constructor(x, y, angle, speed, maxRange, size, damage, piercing, source, entities, image, isTracer = false, isGold = false, isDarkGold = false, damageType = 'physical', noRender = false) {
                this.x = x; this.y = y; this.angle = angle; this.speed = speed; this.maxRange = maxRange; this.size = size;
                this.damage = damage; this.piercing = piercing; this.source = source; this.entities = entities;
                this.traveled = 0; this.active = true; this.hitTargets = new Set(); this.image = image;
                this.isTracer = isTracer; // 是否为曳光弹（G18手枪）
                this.isGold = isGold; // 是否为亮金色曳光弹（PKM）
                this.isDarkGold = isDarkGold; // 是否为深黄色曳光弹（沙漠之鹰）
                this.damageType = damageType; // 伤害类型：physical 或 magic
                this.noRender = noRender; // 不渲染（训练用弓）
            }
            update() {
                const dx = Math.cos(this.angle) * this.speed, dy = Math.sin(this.angle) * this.speed;
                this.x += dx; this.y += dy; this.traveled += this.speed;
                if (this.traveled >= this.maxRange) { this.active = false; return; }
                if (this.x < -CONFIG.WORLD_WIDTH || this.x > CONFIG.WORLD_WIDTH * 2 || this.y < -CONFIG.WORLD_HEIGHT || this.y > CONFIG.WORLD_HEIGHT * 2) { this.active = false; return; }
                // 墙壁碰撞检测：弹道不能穿过墙
                if (WallSystem.blocked(this.x - dx * 2, this.y - dy * 2, this.x, this.y)) { this.active = false; return; }
                this.entities.forEach(entity => {
                    if (entity === this.source || !entity.active || !entity.hittable) return;
                    if (this.hitTargets.has(entity.id)) return;
                    const dist = MathUtils.distance(this.x, this.y, entity.x, entity.y);
                    if (dist < entity.size + this.size) {
                        const damage = Math.floor((this.damage.min + this.damage.max) / 2);
                        entity.takeDamage(damage, this.source, this.damageType);
                        // 应用击退效果
                        if (this.knockback && entity.applyKnockback) {
                            entity.applyKnockback(this.angle, this.knockback);
                        }
                        if (this.piercing) {
                            if (typeof this.piercing === 'number') {
                                this.piercing--;
                                if (this.piercing <= 0) {
                                    this.active = false;
                                } else {
                                    this.hitTargets.add(entity.id);
                                }
                            } else {
                                this.hitTargets.add(entity.id);
                            }
                        } else {
                            this.active = false;
                        }
                    }
                });
            }
            render(ctx) {
                if (this.noRender) return; // 训练用弓：不渲染箭矢
                if (this.isGold) {
                    // 亮金色曳光弹
                    const screenPos = Renderer.worldToScreen(this.x, this.y);
                    const tailLen = 50;
                    const tx = screenPos.x - Math.cos(this.angle) * tailLen;
                    const ty = screenPos.y - Math.sin(this.angle) * tailLen;
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255, 200, 0, 0.3)';
                    ctx.lineWidth = 10;
                    ctx.lineCap = 'round';
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    ctx.strokeStyle = 'rgba(255, 220, 50, 0.6)';
                    ctx.lineWidth = 6;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    ctx.strokeStyle = 'rgba(255, 240, 100, 0.95)';
                    ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    ctx.fillStyle = '#fff8a0';
                    ctx.beginPath(); ctx.arc(screenPos.x, screenPos.y, 3, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                    return;
                }
                if (this.isDarkGold) {
                    // 深黄色曳光弹（沙漠之鹰）
                    const screenPos = Renderer.worldToScreen(this.x, this.y);
                    const tailLen = 45;
                    const tx = screenPos.x - Math.cos(this.angle) * tailLen;
                    const ty = screenPos.y - Math.sin(this.angle) * tailLen;
                    ctx.save();
                    // 外层光晕
                    ctx.strokeStyle = 'rgba(255, 160, 0, 0.3)';
                    ctx.lineWidth = 9;
                    ctx.lineCap = 'round';
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 中层光晕
                    ctx.strokeStyle = 'rgba(255, 190, 30, 0.6)';
                    ctx.lineWidth = 5;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 核心亮线
                    ctx.strokeStyle = 'rgba(255, 210, 60, 0.95)';
                    ctx.lineWidth = 2.5;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 头部高亮光点
                    ctx.fillStyle = '#ffd040';
                    ctx.beginPath(); ctx.arc(screenPos.x, screenPos.y, 3, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                    return;
                }
                if (this.isTracer) {
                    // 淡金色曳光弹：绘制发光弹道线
                    const screenPos = Renderer.worldToScreen(this.x, this.y);
                    const tailLen = 40; // 弹道尾迹长度
                    const tx = screenPos.x - Math.cos(this.angle) * tailLen;
                    const ty = screenPos.y - Math.sin(this.angle) * tailLen;
                    ctx.save();
                    // 外层光晕（较宽、较淡）
                    ctx.strokeStyle = 'rgba(255, 200, 70, 0.25)';
                    ctx.lineWidth = 8;
                    ctx.lineCap = 'round';
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 中层光晕
                    ctx.strokeStyle = 'rgba(255, 220, 100, 0.5)';
                    ctx.lineWidth = 4;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 核心亮线
                    ctx.strokeStyle = 'rgba(255, 235, 160, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 头部高亮光点
                    ctx.fillStyle = '#ffe8a0';
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
