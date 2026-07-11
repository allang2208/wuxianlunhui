import { WallSystem } from '../world/wall-system.js';
import { Renderer } from '../world/renderer.js';
import { DamagePipeline } from './damage-pipeline.js';

        class Projectile {
            constructor(x, y, angle, speed, maxRange, size, damage, piercing, source, entities, image, isTracer = false, isGold = false, isDarkGold = false, damageType = 'physical', _noRender = false, isGreen = false, isSpit = false) {
                this.x = x; this.y = y; this.angle = angle; this.speed = speed; this.maxRange = maxRange; this.size = size;
                this.damage = damage; this.piercing = piercing; this.source = source; this.entities = entities;
                this.traveled = 0; this.active = true; this.hitTargets = new Set(); this.image = image;
                this.isTracer = isTracer; // 是否为曳光弹（G18手枪）
                this.isSpit = isSpit || false; // 是否为毒液投射物（SpitterZombie）
                this.isGold = isGold; // 是否为亮金色曳光弹（PKM）
                this.isDarkGold = isDarkGold; // 是否为深黄色曳光弹（沙漠之鹰）
                this.isGreen = isGreen; // 是否为亮绿色曳光弹（能量轻机枪）
                this.damageType = damageType; // 伤害类型：physical 或 magic
            }
            update(dt = 16.67) {
                const scale = dt / 1000;
                const dx = Math.cos(this.angle) * this.speed * scale, dy = Math.sin(this.angle) * this.speed * scale;
                const prevX = this.x, prevY = this.y;
                this.x += dx; this.y += dy; this.traveled += this.speed * scale;
                if (this.traveled >= this.maxRange) { this.active = false; return; }
                // 墙壁碰撞检测
                if (WallSystem && WallSystem.blocked && WallSystem.blocked(prevX, prevY, this.x, this.y)) {
                    this.active = false; return;
                }
                // 清理已失效目标的命中记录
                for (const target of Array.from(this.hitTargets)) {
                    if (!target.active) {
                        this.hitTargets.delete(target);
                    }
                }
                // 实体碰撞检测（this.entities 是 Map，需遍历 .values()）
                const entityList = Array.from(this.entities.values());
                for (const entity of entityList) {
                    if (entity === this.source || !entity.active || !entity.hittable || this.hitTargets.has(entity)) continue;
                    const dist = Math.sqrt((entity.x - this.x) ** 2 + (entity.y - this.y) ** 2);
                    if (dist < (entity.collisionRadius || 12) + this.size) {
                        // 友军伤害免疫：子弹穿透同阵营目标
                        if (this.source && this.source._faction && entity._faction && this.source._faction === entity._faction) {
                            continue;
                        }
                        this.hitTargets.add(entity);
                        const damage = typeof this.damage === 'object' ? Math.floor(this.damage.min + Math.random() * (this.damage.max - this.damage.min + 1)) : this.damage;
                        // 毒液投射物：命中后给目标加一层中毒
                        if (this.isSpit && typeof entity.applyPoison === 'function') {
                            entity.applyPoison(1);
                        }
                        const weapon = this.source ? (this.source.getCurrentWeapon ? this.source.getCurrentWeapon() : (this.source.equipments && this.source.weaponMode ? this.source.equipments[this.source.weaponMode] : null)) : null;
                        DamagePipeline.applyHit(this.source, entity, {
                            damage,
                            damageType: this.damageType || 'ranged',
                            currentWeapon: weapon
                        });
                        if (this.piercing) { this.piercing--; if (this.piercing < 0) this.active = false; }
                        else { this.active = false; }
                        if (!this.active) return;
                    }
                }
            }
            render(ctx) {
                if (this.isSpit) {
                    // 毒液僵尸投射物：亮绿色方块
                    const screenPos = Renderer.worldToScreen(this.x, this.y);
                    const size = this.size * 2;
                    ctx.save();
                    ctx.translate(screenPos.x, screenPos.y);
                    ctx.rotate(this.angle);
                    ctx.fillStyle = '#00ff00';
                    ctx.fillRect(-size / 2, -size / 2, size, size);
                    ctx.fillStyle = '#ccffcc';
                    ctx.fillRect(-size / 4, -size / 4, size / 2, size / 2);
                    ctx.restore();
                    return;
                }
                if (this.isGreen) {
                    // 亮绿色曳光弹（能量轻机枪）
                    const screenPos = Renderer.worldToScreen(this.x, this.y);
                    const tailLen = 55;
                    const tx = screenPos.x - Math.cos(this.angle) * tailLen;
                    const ty = screenPos.y - Math.sin(this.angle) * tailLen;
                    ctx.save();
                    ctx.strokeStyle = 'rgba(0, 255, 100, 0.3)';
                    ctx.lineWidth = 10;
                    ctx.lineCap = 'round';
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    ctx.strokeStyle = 'rgba(50, 255, 120, 0.6)';
                    ctx.lineWidth = 6;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    ctx.strokeStyle = 'rgba(100, 255, 150, 0.95)';
                    ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    ctx.fillStyle = '#a0ffc0';
                    ctx.beginPath(); ctx.arc(screenPos.x, screenPos.y, 3, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                    return;
                }
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
