import { Entity } from './entity.js';

        class DamageableEntity extends Entity {
            constructor(x, y, config = {}) {
                super(x, y); this.hittable = true; this.hp = config.hp || 100; this.maxHp = config.maxHp || 100;
                this.size = config.size || 20; this.name = config.name || '目标'; this.hitFlash = 0; this.hitFlashDuration = 200;
                this.knockbackX = 0; this.knockbackY = 0; this.knockbackFriction = 0.95;
            }
            takeDamage(damage, source) {
                const critRate = (source && source.data && source.data.crit) || 0;
                const isCrit = Math.random() * 100 < critRate;
                this.hp -= damage; this.hitFlash = this.hitFlashDuration;
                // SoundManager.play(isCrit ? 'crit' : 'hit');
                EffectManager.createDamageText(this.x, this.y - this.size, damage, isCrit);
                if (isCrit) EffectManager.triggerCritEffects();
                if (this.hp <= 0) { this.hp = 0; this.onDeath(source); }
            }
            onDeath(source) {
                this.active = false;
                // SoundManager.play('enemy_death');
                if (source && source.data) source.data.kills++;
                EffectManager.add(new DeathEffect(this.x, this.y, this.size));
                // 掉落钢弓
                if (this instanceof Enemy) Game.dropItem(this.x, this.y, EquipManager.G18_PISTOL_ITEM);
                // 给予玩家经验值
                if (source && source.gainExp && typeof source.gainExp === 'function') {
                    source.gainExp(this.expValue || 10);
                }
            }
            applyKnockback(angle, totalPx) {
                // 统一单位：totalPx 表示总击退距离（像素）
                const friction = this.knockbackFriction || 0.88;
                // 物理公式：总位移 = initialSpeed / (1 - friction)
                // => initialSpeed = totalPx * (1 - friction)
                const initialSpeed = totalPx * (1 - friction);
                this.knockbackX += Math.cos(angle) * initialSpeed;
                this.knockbackY += Math.sin(angle) * initialSpeed;
            }
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
                            this.y = resolved.y - Math.sin(angle) * 5;
                            // 撞墙烟雾效果：在墙面位置产生
                            if (typeof EffectManager !== 'undefined') EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                            this.knockbackX = 0;
                            this.knockbackY = 0;
                        } else {
                            this.x = resolved.x;
                            this.y = resolved.y;
                        }
                    } else {
                        this.x = nx;
                        this.y = ny;
                    }
                    this.knockbackX *= this.knockbackFriction;
                    this.knockbackY *= this.knockbackFriction;
                    if (Math.abs(this.knockbackX) < 0.1) this.knockbackX = 0;
                    if (Math.abs(this.knockbackY) < 0.1) this.knockbackY = 0;
                }
                if (this.hitFlash > 0) this.hitFlash -= 16;
            }
            renderHealthBar(ctx) {
                if (this.hp >= this.maxHp) return;
                const screenPos = Renderer.worldToScreen(this.x, this.y), barWidth = 40, barHeight = 4, hpPercent = this.hp / this.maxHp;
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(screenPos.x - barWidth/2, screenPos.y - this.size - 12, barWidth, barHeight);
                ctx.fillStyle = hpPercent > 0.5 ? '#7a9a6a' : hpPercent > 0.25 ? '#a09060' : '#8a4a4a';
                ctx.fillRect(screenPos.x - barWidth/2, screenPos.y - this.size - 12, barWidth * hpPercent, barHeight);
            }
        }

export { DamageableEntity };
