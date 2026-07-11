import { Renderer } from '../world/renderer.js';
import { HexHitbox } from '../components/hitbox.js';

        class Entity {
            constructor(x, y) { this.id = Math.random().toString(36).substr(2, 9); this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.rotation = 0; this.active = true; this.hittable = false; this.components = new Map(); this.hitbox = null; }
            addComponent(name, comp) { this.components.set(name, comp); comp.entity = this; }
            
            /**
             * 初始化六边形包围盒
             * @param {number} radius - 六边形半径
             * @param {number[]} damageMultipliers - 6点伤害倍率
             * @param {number[]} radii - 6点独立半径（可选）
             */
            initHitbox(radius, damageMultipliers, radii) {
                this.hitbox = new HexHitbox(radius, damageMultipliers, radii);
                this.hitbox.updateWorldPosition(this);
            }
            
            update() {
                // 每帧同步六边形顶点世界坐标
                if (this.hitbox) {
                    this.hitbox.updateWorldPosition(this);
                }
            }
            
            render(_ctx) {}
            takeDamage(_damage, _source) {}
            applyKnockback(_angle, _force) {}
            
            renderCollisionRadius(ctx) {
                // 优先使用六边形调试渲染，回退到圆形
                if (this.hitbox) {
                    this.hitbox.renderDebug(ctx);
                    return;
                }
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
            
            /**
             * 获取碰撞形状（用于兼容现有系统）
             * @returns {{type:string, data:Object}} 
             */
            getCollisionShape() {
                if (this.hitbox) {
                    return { type: 'hex', radius: this.hitbox.getApproxRadius() };
                }
                return { type: 'circle', radius: this.collisionRadius || this.size * 0.6 || 10 };
            }
        }

export { Entity };
