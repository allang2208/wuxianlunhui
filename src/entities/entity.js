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
            
            takeDamage(_damage, _source) {}
            applyKnockback(_angle, _force) {}

            
            /**
             * 获取碰撞形状（用于兼容现有系统）
             * 优先使用显式设置的矩形碰撞体；没有矩形再回退到六边形/圆形。
             * @returns {{type:string, radius:number, width?:number, height?:number}}
             */
            getCollisionShape() {
                if (this.collisionShape === 'rect' && this.collisionWidth > 0 && this.collisionHeight > 0) {
                    return {
                        type: 'rect',
                        width: this.collisionWidth,
                        height: this.collisionHeight,
                        radius: Math.max(this.collisionWidth, this.collisionHeight) / 2
                    };
                }
                if (this.hitbox) {
                    return { type: 'hex', radius: this.hitbox.getApproxRadius() };
                }
                return { type: 'circle', radius: this.collisionRadius || this.size * 0.6 || 10 };
            }
        }

export { Entity };
