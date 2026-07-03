import { Entity } from './entity.js';
import { EffectManager } from '../effects/effect-manager.js';
import { ZombieBloodPool } from '../effects/particle-effects.js';
import { isMachineGun, isRifle, isPistolCategory, isShotgunCategory } from '../config/gun-ammo.js';

        class DamageableEntity extends Entity {
            constructor(x, y, config = {}) {
                super(x, y); this._faction = config.faction || 'neutral'; this.hittable = true; this.hp = config.hp || 100; this.maxHp = config.maxHp || 100;
                this.size = config.size || 20; this.name = config.name || '目标'; this.hitFlash = 0; this.hitFlashDuration = 300;
                this.knockbackX = 0; this.knockbackY = 0; this.knockbackFriction = 0.962;
                // ===== 状态栏系统（每个实体独立） =====
                this.statusEffects = []; // { type, duration, remaining, icon, name, color, stacks }
            }
            takeDamage(damage, source, damageType = 'physical') {
                // 新增：怪物之间不互相攻击
                if (this._faction === 'enemy' && source && source._faction === 'enemy') return;
                // 应用伤害公式：伤害 = 攻击力² / (攻击力 + 防御力)
                let baseDamage = damage;
                let isCrit = false;
                if (source && source.data && this.data) {
                    let atk, def;
                    if (damageType === 'magic') {
                        // 魔法伤害：使用 matk 和 mdef
                        atk = source.data.matk || 0;
                        def = this.data.mdef || 0;
                        // 应用改造魔法防御穿透效果
                        if (source && source.equipments && source.weaponMode) {
                            const currentWpn = source.equipments[source.weaponMode];
                            if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.magicPenetrationPercent) {
                                def = Math.floor(def * (1 - currentWpn._craftEffects.magicPenetrationPercent));
                            }
                        }
                    } else {
                        // 物理伤害（默认）：使用 damage 作为 atk 值（武器攻击力）
                        atk = (damage > 0) ? damage : (source.data.atk || 0);
                        def = this.data.def || 0;
                        // 应用改造穿甲效果（钢芯穿甲弹等）
                        if (source && source.equipments && source.weaponMode) {
                            const currentWpn = source.equipments[source.weaponMode];
                            if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.armorPenetrationPercent) {
                                def = Math.floor(def * (1 - currentWpn._craftEffects.armorPenetrationPercent));
                            }
                        }
                    }
                    if (atk > 0) {
                        baseDamage = Math.floor((atk * atk) / (atk + def));
                        // 10%最低保底伤害
                        const minDamage = Math.floor(atk * 0.1);
                        if (baseDamage < minDamage) {
                            baseDamage = minDamage;
                        }
                    }
                    // 应用魔力易伤：魔法伤害每层+5%
                    if (damageType === 'magic' && this._magicVulnerabilityStacks > 0) {
                        baseDamage = Math.floor(baseDamage * (1 + this._magicVulnerabilityStacks * 0.05));
                    }
                    // 应用无人机易伤：所有伤害每层+10%（基础）+ 等级加成（在source上计算）
                    if (this._droneVulnerabilityStacks > 0) {
                        let droneBonus = 0.10 * this._droneVulnerabilityStacks;
                        // 如果source有无人机技能，应用等级加成
                        if (source && source.skills && source.skills.droneSkill) {
                            const effect = source.skills.droneSkill.getEffect(source.skills.droneSkill.level);
                            droneBonus = (effect.damageBonusPercent / 100) * this._droneVulnerabilityStacks;
                        }
                        baseDamage = Math.floor(baseDamage * (1 + droneBonus));
                    }
                    // 暴击判定（仅用于精通技能经验，不额外应用伤害倍率——调用方已处理）
                    let critRate = source.data.crit || 0;
                    if (source && source.equipments && source.skills && source.skills.rifleMastery) {
                        const currentWpn = source.equipments[source.weaponMode];
                        if (currentWpn && isRifle(currentWpn.weaponType)) {
                            critRate += source.skills.rifleMastery.getEffect(source.skills.rifleMastery.level).critRateBonus;
                        }
                    }
                    // 改造效果：暴击率加成
                    if (source && source.equipments && source.weaponMode) {
                        const currentWpn = source.equipments[source.weaponMode];
                        if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.critChancePercent) {
                            critRate += currentWpn._craftEffects.critChancePercent * 100;
                        }
                    }
                    // 无人机易伤：暴击率加成
                    if (this._droneVulnerabilityStacks > 0) {
                        let droneCritBonus = 10 * this._droneVulnerabilityStacks;
                        if (source && source.skills && source.skills.droneSkill) {
                            const effect = source.skills.droneSkill.getEffect(source.skills.droneSkill.level);
                            droneCritBonus = effect.critBonusPercent * this._droneVulnerabilityStacks;
                        }
                        critRate += droneCritBonus;
                    }
                    const critRes = this.data.critRes || 0;
                    const finalCritRate = Math.max(0, critRate - critRes);
                    isCrit = Math.random() * 100 < finalCritRate;
                    if (isCrit && source && source.skills && source.skills.criticalStrike) {
                        SkillManager.addCriticalStrikeExp(source, isCrit, false); // isKill 在下面计算
                    }
                }
                // 扣血
                this.hp -= baseDamage;
                this.hitFlash = this.hitFlashDuration;
                // 显示伤害数字
                if (typeof EffectManager !== 'undefined' && EffectManager.createDamageText) {
                    EffectManager.createDamageText(this.x, this.y - this.size, baseDamage, isCrit);
                }
                const isKill = this.hp <= 0;
                if (isKill) {
                    this.hp = 0;
                    this.onDeath(source);
                }
                // 武器精通技能经验（使用大类判定）
                if (source && source.equipments && SkillManager) {
                    const currentWpn = source.equipments[source.weaponMode];
                    if (currentWpn) {
                        const wt = currentWpn.weaponType;
                        if (isMachineGun(wt) && (isKill || isCrit)) {
                            SkillManager.addMachineGunMasteryExp(source, isKill, isCrit);
                        } else if (isRifle(wt) && (isKill || isCrit)) {
                            SkillManager.addRifleMasteryExp(source, isKill, isCrit);
                        } else if (isPistolCategory(wt) && (isKill || isCrit)) {
                            SkillManager.addPistolMasteryExp(source, isKill, isCrit);
                        } else if (isShotgunCategory(wt) && (isKill || isCrit)) {
                            SkillManager.addShotgunMasteryExp(source, isKill, isCrit);
                        } else if (wt === 'bow') {
                            SkillManager.addBowExp(source, true, isCrit, isKill);
                        }
                    }
                }
                // 无人机技能经验：击杀被无人机影响的敌人
                if (isKill && source && source.skills && SkillManager && SkillManager.addDroneExp) {
                    SkillManager.addDroneExp(source, this);
                }
            }
            onDeath(source) {
                this.active = false;
                if (typeof SoundManager !== 'undefined' && SoundManager.playFile) {
                    SoundManager.playFile('assets/sounds/knockdown_1.mp3');
                }
                if (source && source.data) source.data.kills++;
                EffectManager.add(new DeathEffect(this.x, this.y, this.size));
                if (source) {
                    const angle = Math.atan2(source.y - this.y, source.x - this.x);
                    EffectManager.add(new BloodMistEffect(this.x, this.y, angle + Math.PI));
                }
                // 血池最后添加，确保在最上层渲染（不被血雾覆盖）
                if (this.name && this.name.includes('僵尸')) {
                    EffectManager.add(new ZombieBloodPool(this.x, this.y, { r: 45, g: 200, b: 35 }));
                } else if (this._faction === 'enemy') {
                    EffectManager.add(new ZombieBloodPool(this.x, this.y, { r: 180, g: 35, b: 35 }));
                }
                // 掉落金币（不再掉落 G18）
                if (this instanceof Enemy) {
                    const level = this.level || 1;
                    const goldAmount = 5 + Math.floor(Math.random() * 10 + 1) * level;
                    const goldItem = { name: '金币', category: 'gold', stack: goldAmount };
                    Game.dropItem(this.x, this.y, goldItem);
                    // 新增：掉落经验值
                    if (source && source.gainExp) {
                        source.gainExp(this.getExpValue ? this.getExpValue() : 2);
                    } else if (source && source.source && source.source.gainExp) {
                        // 如果是 Projectile，经验给 Projectile 的 owner
                        source.source.gainExp(this.getExpValue ? this.getExpValue() : 2);
                    }
                }
                // 延迟删除尸体（3秒后从 entities 中移除）
                this._deathTime = Date.now();
                this._deathRemoveDelay = 3000; // 3秒后删除
                // 隐藏 Phaser Sprite
                const phaserScene = window.__phaserScene;
                if (phaserScene && this._phaserSprite) {
                    this._phaserSprite.setVisible(false);
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

            // ===== 状态栏系统 =====
            /**
             * 添加状态效果
             * @param {string} type - 状态类型 'stun', 'poison', 'bleed', 'slow' 等
             * @param {number} duration - 持续时间（毫秒）
             * @param {Object} options - { icon, name, color, stacks }
             */
            addStatusEffect(type, duration, options = {}) {
                const STATUS_CONFIG = {
                    stun: { icon: '💫', name: '眩晕', color: '#9a7a5a' },
                    poison: { icon: '☠️', name: '中毒', color: '#7a9a5a' },
                    slow: { icon: '🐌', name: '减速', color: '#5a7a9a' },
                    buff: { icon: '✨', name: '增益', color: '#9a9a5a' },
                    shield: { icon: '🛡️', name: '护盾', color: '#5a8a9a' },
                    bleed: { icon: '🩸', name: '流血', color: '#9a3a3a' },
                    magicVulnerability: { icon: '🔮', name: '魔力易伤', color: '#8a5a9a' },
                    droneVulnerability: { icon: '🛸', name: '无人机易伤', color: '#5a7a9a' },
                };
                const config = STATUS_CONFIG[type] || { icon: '❓', name: type, color: '#8a7d6b' };

                // 同类型效果：更新剩余时间（取较大值）
                const existing = this.statusEffects.find(e => e.type === type);
                if (existing) {
                    existing.remaining = Math.max(existing.remaining, duration);
                    existing.duration = Math.max(existing.duration, duration);
                    if (options.stacks !== undefined) existing.stacks = options.stacks;
                    return existing;
                }

                let name = options.name || config.name;
                if (options.stacks !== undefined) name = `${name} x${options.stacks}`;

                const effect = {
                    type, duration, remaining: duration,
                    icon: options.icon || config.icon,
                    name, color: options.color || config.color,
                    stacks: options.stacks || 1,
                };
                this.statusEffects.push(effect);
                return effect;
            }
            /**
             * 检查是否有某类型的状态效果
             * @param {string} type
             * @returns {boolean}
             */
            hasStatusEffect(type) {
                return this.statusEffects.some(e => e.type === type && e.remaining > 0);
            }
            /**
             * 获取某类型状态效果的剩余时间
             * @param {string} type
             * @returns {number}
             */
            getStatusEffectRemaining(type) {
                const e = this.statusEffects.find(e => e.type === type);
                return e ? e.remaining : 0;
            }
            /**
             * 按类型移除状态效果
             * @param {string} type
             */
            removeStatusEffect(type) {
                const idx = this.statusEffects.findIndex(e => e.type === type);
                if (idx >= 0) this.statusEffects.splice(idx, 1);
            }
            /**
             * 更新所有状态效果计时器
             * @param {number} dt
             */
            updateStatusEffects(dt) {
                if (this.statusEffects.length === 0) return;
                for (let i = this.statusEffects.length - 1; i >= 0; i--) {
                    const e = this.statusEffects[i];
                    e.remaining -= dt;
                    if (e.remaining <= 0) this.statusEffects.splice(i, 1);
                }
            }
            /**
             * 应用眩晕（通过状态栏系统）
             * @param {number} duration - 毫秒
             */
            applyStun(duration) {
                if (this._isDead) return;
                this.addStatusEffect('stun', duration);
                // 显示眩晕浮动文字
                if (typeof EffectManager !== 'undefined') {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, '💫 眩晕！', '#9a7a5a'));
                }
            }
            update(dt) {
                // 更新状态栏效果计时器
                this.updateStatusEffects(dt);
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
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                const barWidth = 40, barHeight = 5, border = 1;
                const x = screenPos.x - barWidth / 2, y = screenPos.y - this.size - 14;
                const hpPercent = this.hp / this.maxHp;
                // 边框：深黑色背景，与主角体力条做明显区分
                ctx.fillStyle = '#1a0a0a';
                ctx.fillRect(x - border, y - border, barWidth + border * 2, barHeight + border * 2);
                // 底色：深红色
                ctx.fillStyle = '#5a1010';
                ctx.fillRect(x, y, barWidth, barHeight);
                // 当前血量：根据血量百分比变化亮度
                ctx.fillStyle = hpPercent > 0.5 ? '#c04040' : hpPercent > 0.25 ? '#a03030' : '#8a1a1a';
                ctx.fillRect(x, y, barWidth * hpPercent, barHeight);
            }
        }

export { DamageableEntity };
