import { Entity } from './entity.js';

        class DropItem extends Entity {
            constructor(x, y, itemData) {
                super(x, y);
                this.x = x; this.y = y; this.itemData = itemData || {};
                this.size = 0; this.active = true; this.life = Infinity;
                this.bobOffset = 0;
                this.image = new Image();
                // 金币使用新的动画贴图
                if (itemData.category === 'gold' || itemData.name === '金币') {
                    this.image.src = 'assets/items/gold_transparent_07.png';
                } else if (itemData.iconImage) {
                    this.image.src = itemData.iconImage;
                } else if (itemData.equipImage) {
                    // 所有装备一律使用持有的贴图（equipImage）
                    this.image.src = itemData.equipImage;
                } else if (itemData.dropImage) {
                    this.image.src = itemData.dropImage;
                } else {
                    this.image.src = 'assets/items/steel_bow_dropped.png';
                }
                this.pickupRange = 30;
            }
            update(dt) {
                // 装备不随时间消失（life = Infinity）
                this.bobOffset += dt * 0.003;
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y);
                const bobY = Math.sin(this.bobOffset) * 4;
                ctx.save(); ctx.translate(pos.x, pos.y + bobY);
                // 鼠标悬停检测
                const mx = Input.mouse.x, my = Input.mouse.y;
                const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - (pos.y + bobY)) * (my - (pos.y + bobY))) < 35;
                // 发光效果
                ctx.shadowColor = hover ? 'rgba(255, 215, 0, 0.8)' : 'rgba(200, 170, 100, 0.5)';
                ctx.shadowBlur = hover ? 20 : 12;
                if (this.image && this.image.complete && this.image.naturalWidth > 0) {
                    const s = hover ? 40 : 32;
                    if (this.image && this.image.complete && this.image.naturalWidth > 0) ctx.drawImage(this.image, -s/2, -s/2, s, s);
                } else {
                    ctx.fillStyle = '#c4a55a'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI*2); ctx.fill();
                }
                ctx.shadowBlur = 0;
                // 金色轮廓高亮
                if (hover) {
                    ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)'; ctx.lineWidth = 2.5;
                    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
                }
                // 标签
                ctx.fillStyle = hover ? 'rgba(255, 235, 150, 1)' : 'rgba(212, 197, 169, 0.9)';
                ctx.font = hover ? '13px SimHei, "Microsoft YaHei", "黑体", sans-serif' : '11px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(this.itemData.name, 0, 28);
                ctx.fillStyle = 'rgba(138, 125, 107, 0.7)'; ctx.font = '10px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                ctx.fillText('[点击拾取]', 0, 42);
                ctx.restore();
            }
        }

export { DropItem };
