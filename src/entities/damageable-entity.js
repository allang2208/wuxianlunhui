import { SoundManager } from '../ui/sound-manager.js';
import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { Renderer } from '../world/renderer.js';
import { StatusBar } from '../ui/status-bar.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { SmokeEffect } from '../effects/smoke-effect.js';
import { Entity } from './entity.js';
import { EffectManager } from '../effects/effect-manager.js';
import { BloodMistEffect, DeathEffect } from '../effects/particle-effects.js';
import { isMachineGun, isRifle, isPistolCategory, isShotgunCategory } from '../config/gun-ammo.js';
import { Enemy } from './enemy.js';
import { SkillManager } from '../ui/skill-manager.js';
import { DungeonMapSystem } from '../world/dungeon-map-system.js';
import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { getTributeGoldMultiplier, getTributeKillMpHealRatio, getTributeMonsterDamageTakenMul, getMoonshadowConfig, rollTributeDrop } from '../config/tribute-effects.js';

        /**
         * 根据配置计算怪物金币掉落
         * @param {number} level - 怪物等级
         * @param {Object} source - 击杀来源（用于检测祭品效果）
         * @returns {number} 金币数量
         */
        function getEnemyGoldDrop(level, source) {
            const cfg = COMBAT_FORMULAS.enemy?.goldDrop || {};
            const base = cfg.base ?? 0;
            const levelMul = cfg.levelMultiplier ?? 4;
            const randomMin = cfg.randomMin ?? 1;
            const randomMax = cfg.randomMax ?? 10;
            let amount = base + (level || 1) * levelMul + Math.floor(Math.random() * (randomMax - randomMin + 1)) + randomMin;

            // 全局倍率
            const globalMul = cfg.globalMultiplier ?? 1;
            amount = Math.floor(amount * globalMul);

            // 祭品效果
            const tributeName = cfg.tributeName || '麦穗';
            const tributeMul = cfg.tributeMultiplier ?? 1.25;
            if (source && DungeonMapSystem && DungeonMapSystem._carriedItems) {
                const tributes = DungeonMapSystem._carriedItems;
                const hasTribute = tributes.some(c => c && c.item && c.item.name === tributeName);
                if (hasTribute) {
                    amount = Math.floor(amount * tributeMul);
                }
            }

            // 祭品效果（数据驱动）：携带祭品的金币掉落百分比加成
            amount = Math.floor(amount * getTributeGoldMultiplier());

            return Math.max(0, amount);
        }

        class DamageableEntity extends Entity {
            constructor(x, y, config = {}) {
                super(x, y); this._faction = config.faction || 'neutral'; this.hittable = true; this.hp = config.hp || 100; this.maxHp = config.maxHp || 100;
                this.size = config.size || 20; this.collisionRadius = config.collisionRadius || this.size || 12; this.name = config.name || '目标'; this.hitFlash = 0; this.hitFlashDuration = 300;
                this.knockbackX = 0; this.knockbackY = 0; this.knockbackFriction = 0.962;
                // 子类在 super() 后才设置碰撞字段，需要重建统一 Collider
                this.rebuildCollider();
                // ===== 状态栏系统（每个实体独立） =====
                this.statusEffects = []; // { type, duration, remaining, icon, name, color, stacks }
            }
            takeDamage(damage, source, damageType = 'physical', isMelee = true) {
                // 新增：怪物之间不互相攻击
                if (this._faction === 'enemy' && source && source._faction === 'enemy') return;
                // 应用伤害公式：伤害 = 攻击力² / (攻击力 + 防御力)
                let baseDamage = damage;
                let isCrit = false;
                if (source && source.data && this.data) {
                    let atk, def;
                    if (damageType === 'magic') {
                        // 魔法伤害：使用传入的 damage 作为 atk（已包含技能公式计算），fallback 到 matk
                        atk = (damage > 0) ? damage : (source.data.matk || 0);
                        def = this.data.mdef || 0;
                        // 应用改造魔法防御穿透效果
                        if (source && source.getCurrentWeapon) {
                            const currentWpn = source.getCurrentWeapon();
                            if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.magicPenetrationPercent) {
                                def = Math.floor(def * (1 - currentWpn._craftEffects.magicPenetrationPercent));
                            }
                        }
                    } else {
                        // 物理伤害（默认）：使用 damage 作为 atk 值（武器攻击力）
                        atk = (damage > 0) ? damage : (source.data.atk || 0);
                        def = this.data.def || 0;
                        // 应用改造穿甲效果（钢芯穿甲弹等）
                        if (source && source.getCurrentWeapon) {
                            const currentWpn = source.getCurrentWeapon();
                            if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.armorPenetrationPercent) {
                                def = Math.floor(def * (1 - currentWpn._craftEffects.armorPenetrationPercent));
                            }
                        }
                    }
                    if (atk > 0) {
                        // 防御减伤公式：伤害 = atk * (1 - def / (def + 60))
                        // 提升防御收益（原100改为60），def=60时减伤50%
                        const damageReduction = def / (def + 60);
                        baseDamage = Math.floor(atk * (1 - damageReduction));
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
                    // 远程物理伤害减免（在魔力易伤之后应用）
                    // 枪械等远程物理攻击的 damageType 为 'physical' 且 isMelee=false
                    if (!isMelee && (damageType === 'ranged' || damageType === 'physical') && this._rangedDamageReduction > 0) {
                        baseDamage = Math.floor(baseDamage * (1 - this._rangedDamageReduction));
                    }
                    // 应用无人机易伤：所有伤害每层+10%（基础）+ 等级加成（在source上计算）
                    if (this._droneVulnerabilityStacks > 0) {
                        let droneBonus = 0.10 * this._droneVulnerabilityStacks;
                        // 如果source有无人机技能，应用等级加成
                        if (source && source.skills && source.skills.droneSkill) {
                            const effect = source.skills.droneSkill.getEffect(source.skills.droneSkill.level);
                            droneBonus = ((effect.damageBonusPercent || 10) / 100) * this._droneVulnerabilityStacks;
                        }
                        baseDamage = Math.floor(baseDamage * (1 + droneBonus));
                    }
                    // 祭品效果（数据驱动）：怪物承伤加成（敌方阵营承伤时）
                    if (this._faction === 'enemy') {
                        baseDamage = Math.floor(baseDamage * getTributeMonsterDamageTakenMul());
                        // 月影：Boss/精英战斗事件中物理魔法伤害加成
                        if (source && source._moonshadowBoostActive) {
                            const ms = getMoonshadowConfig();
                            if (ms && ms.damagePercent) baseDamage = Math.floor(baseDamage * (1 + ms.damagePercent / 100));
                        }
                    }
                    // 装甲僵尸持盾防御：50%概率格挡，减少50%伤害
                    if (this.data && this.data.equipShield === 'small_shield' && damageType !== 'magic') {
                        if (Math.random() < 0.5) {
                            baseDamage = Math.floor(baseDamage * 0.5);
                            // 显示格挡特效
                            if (EffectManager && EffectManager.createDamageText) {
                                EffectManager.createDamageText(this.x, this.y - this.size - 15, '格挡!', '#7a9a9a');
                            }
                        }
                    }
                    // 暴击判定（仅用于精通技能经验，不额外应用伤害倍率——调用方已处理）
                    let critRate = source.data.crit || 0;
                    if (source && source.getCurrentWeapon && source.skills && source.skills.rifleMastery) {
                        const currentWpn = source.getCurrentWeapon();
                        if (currentWpn && isRifle(currentWpn.weaponType)) {
                            critRate += source.skills.rifleMastery.getEffect(source.skills.rifleMastery.level).critRateBonus;
                        }
                    }
                    // 改造效果：暴击率加成
                    if (source && source.getCurrentWeapon) {
                        const currentWpn = source.getCurrentWeapon();
                        if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.critChancePercent) {
                            critRate += currentWpn._craftEffects.critChancePercent * 100;
                        }
                    }
                    // 无人机易伤：暴击率加成
                    if (this._droneVulnerabilityStacks > 0) {
                        let droneCritBonus = 10 * this._droneVulnerabilityStacks;
                        if (source && source.skills && source.skills.droneSkill) {
                            const effect = source.skills.droneSkill.getEffect(source.skills.droneSkill.level);
                            droneCritBonus = (effect.critBonusPercent || 10) * this._droneVulnerabilityStacks;
                        }
                        critRate += droneCritBonus;
                    }
                    const critRes = this.data.critRes || 0;
                    const finalCritRate = Math.max(0, critRate - critRes);
                    isCrit = Math.random() * 100 < finalCritRate;
                    if (isCrit && !this._summoned && source && source.skills && source.skills.criticalStrike) {
                        SkillManager.addCriticalStrikeExp(source, isCrit, false); // isKill 在下面计算
                    }
                }
                // 秒杀模式：玩家攻击直接致死（左下角"秒杀"调试开关，走正常伤害流程）
                if (source && source._faction === 'player' && typeof window !== 'undefined' && window.Game && window.Game._oneHitKill) {
                    baseDamage = Math.max(baseDamage, this.hp);
                }
                // 扣血
                this.hp -= baseDamage;
                this.hitFlash = this.hitFlashDuration;
                // 僵尸类怪物受击绿色粒子（统一入口，确保所有伤害路径都会触发）
                const scene = typeof window !== 'undefined' && window.__phaserScene;
                if (scene && typeof scene.triggerZombieHitParticles === 'function') {
                    scene.triggerZombieHitParticles(this, source);
                }
                // 首领被玩家命中：显示 BOSS 专属血条（仅玩家攻击触发，超时自动隐藏）
                if (this.rank === 'boss' && source && source._faction === 'player' && scene && typeof scene.showBossHpBar === 'function') {
                    scene.showBossHpBar(this);
                }
                // 显示伤害数字
                if (EffectManager && EffectManager.createDamageText) {
                    EffectManager.createDamageText(this.x, this.y - this.size, baseDamage, isCrit);
                }
                const isKill = this.hp <= 0;
                if (isKill) {
                    this.hp = 0;
                    this.onDeath(source);
                }
                // 武器精通技能经验（使用大类判定）；召唤物（_summoned 标签）不提供修炼值
                if (!this._summoned && source && source.getCurrentWeapon && SkillManager) {
                    const currentWpn = source.getCurrentWeapon();
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
                // 无人机技能经验：击杀被无人机影响的敌人（召唤物不提供修炼值）
                if (!this._summoned && isKill && source && source.skills && SkillManager && SkillManager.addDroneExp) {
                    SkillManager.addDroneExp(source, this);
                }
            }
            onDeath(source) {
                this.active = false;
                if (SoundManager && SoundManager.playFile) {
                    SoundManager.playFile('assets/sounds/knockdown_1.mp3');
                }
                if (source && source.data) source.data.kills++;
                EffectManager.add(new DeathEffect(this.x, this.y, this.size));
                if (source) {
                    const angle = Math.atan2(source.y - this.y, source.x - this.x);
                    EffectManager.add(new BloodMistEffect(this.x, this.y, angle + Math.PI));
                }
                // 掉落金币（不再掉落 G18）；召唤物（_summoned 标签）不掉金币/经验
                if (this instanceof Enemy && !this._summoned) {
                    let goldAmount = getEnemyGoldDrop(this.level, source);
                    if (this.rank === 'elite') goldAmount *= 2;

                    // 祭品效果：大理石 - 击杀后1秒内恢复5%最大生命值
                    if (source && DungeonMapSystem && DungeonMapSystem._carriedItems) {
                        const tributes = DungeonMapSystem._carriedItems;
                        const hasMarble = tributes.some(c => c && c.item && c.item.name === '大理石');
                        if (hasMarble && source && source.data) {
                            source._marbleHealTimer = 1000; // 1秒
                            source._marbleHealTotal = source.data.maxHp * 0.05;
                            source._marbleHealPerTick = source._marbleHealTotal / (1000 / 16.67); // 每帧恢复量
                            if (StatusBar) {
                                if (source._marbleHealEffectId) StatusBar.removeEffect(source._marbleHealEffectId);
                                source._marbleHealEffectId = StatusBar.addEffect('marbleHeal', 1000, { icon: '🗿', name: '大理石守护', color: '#8a9a8a' });
                            }
                        }
                    }

                    const goldItem = { name: '金币', category: 'gold', stack: goldAmount };
                    Game.dropItem(this.x, this.y, goldItem);

                    // 祭品掉落：精英/首领必掉（品质按权重），普通怪 5% 只出稀有及以下
                    const tributeDrop = rollTributeDrop(this.rank);
                    if (tributeDrop) {
                        Game.dropItem(this.x, this.y, tributeDrop);
                    }

                    // 祭品效果（数据驱动）：千年人参 - 击杀后1秒内回复最大魔法值
                    const ginsengRatio = getTributeKillMpHealRatio();
                    if (ginsengRatio > 0 && source && source.data) {
                        source._ginsengHealTimer = 1000;
                        source._ginsengHealTotal = source.data.maxMp * ginsengRatio;
                        source._ginsengHealPerTick = source._ginsengHealTotal / (1000 / 16.67);
                        if (StatusBar) {
                            if (source._ginsengHealEffectId) StatusBar.removeEffect(source._ginsengHealEffectId);
                            source._ginsengHealEffectId = StatusBar.addEffect('ginsengHeal', 1000, { icon: '🌿', name: '人参回气', color: '#6a9a5a' });
                        }
                    }
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
                if (!this._deathRemoveDelay) this._deathRemoveDelay = 3000; // 默认 3 秒，子类可覆盖
                // 销毁 Phaser Sprite，防止残留或被 group setVisible(true) 重新显示
                // 需要保留尸体播放死亡动画的敌人可设置 _preserveCorpse = true
                if (this._phaserSprite && !this._preserveCorpse) {
                    this._phaserSprite.destroy();
                    this._phaserSprite = null;
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
                    bind: { icon: '⛓️', name: '束缚', color: '#7a5a8a' },
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
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, '💫 眩晕！', '#9a7a5a'));
                }
            }
            // --- 状态效果：中毒 ---
            _updatePoison(dt) {
                if (this._poisonStacks <= 0) return;
                this._poisonTimer -= dt;
                this._poisonTickTimer -= dt;
                if (this._poisonEffect) {
                    this._poisonEffect.update(dt, this.x, this.y - this.size);
                }
                if (this._poisonTickTimer <= 0) {
                    this.hp -= this._poisonStacks;
                    if (EffectManager) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${this._poisonStacks}`, '#39ff14'));
                    }
                    this._poisonTickTimer = 1000;
                    if (this.hp <= 0) {
                        this.hp = 0;
                        if (typeof this.onDeath === 'function') this.onDeath();
                    }
                }
                if (this._poisonTimer <= 0) {
                    this._poisonStacks = Math.max(0, this._poisonStacks - 1);
                    if (this._poisonStacks > 0) {
                        this._poisonTimer = 5000;
                    } else {
                        if (this._poisonEffectId && StatusBar) {
                            StatusBar.removeEffect(this._poisonEffectId);
                            this._poisonEffectId = null;
                        }
                        if (this._poisonEffect) this._poisonEffect.reset();
                    }
                }
            }
            applyPoison(stacks) {
                this._poisonStacks += stacks;
                this._poisonTimer = 5000;
                if (this._poisonTickTimer <= 0) this._poisonTickTimer = 1000;
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `☠️ 中毒 +${stacks}层`, '#39ff14'));
                }
                if (this._poisonEffect) this._poisonEffect.reset();
            }
            // --- 状态效果：流血 ---
            _updateBleed(dt) {
                if (this._bleedStacks <= 0) return;
                this._bleedTimer -= dt;
                this._bleedTickTimer -= dt;
                if (this._bleedTickTimer <= 0) {
                    const dmg = Math.max(1, Math.floor(this.hp * 0.1));
                    this.hp -= dmg;
                    if (EffectManager) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${dmg}`, '#9a3a3a'));
                    }
                    this._bleedTickTimer = 1000;
                }
                if (this._bleedTimer <= 0) {
                    this._bleedStacks = Math.max(0, this._bleedStacks - 1);
                    if (this._bleedStacks > 0) {
                        this._bleedTimer = 5000;
                        if (this._bleedEffectId && StatusBar) {
                            StatusBar.updateEffectStacks('bleed', this._bleedStacks);
                        }
                    } else {
                        if (this._bleedEffectId && StatusBar) {
                            StatusBar.removeEffect(this._bleedEffectId);
                            this._bleedEffectId = null;
                        }
                    }
                }
            }
            applyCripple(duration) {
                // 状态栏显示
                if (StatusBar) {
                    this._crippleEffectId = StatusBar.addEffect('slow', duration, { name: '致残', icon: '🦴', color: '#8a8a7a' });
                }
                // 内部状态数组（供 hasStatusEffect 查询）
                this.addStatusEffect('slow', duration, { name: '致残', icon: '🦴', color: '#8a8a7a' });
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, '🦴 致残！', '#8a8a7a'));
                }
            }
            applyBind(duration) {
                if (StatusBar) {
                    this._bindEffectId = StatusBar.addEffect('bind', duration, { name: '束缚', icon: '⛓️', color: '#7a5a8a' });
                }
                this.addStatusEffect('bind', duration, { name: '束缚', icon: '⛓️', color: '#7a5a8a' });
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, '⛓️ 束缚！', '#7a5a8a'));
                }
            }
            applyBleeding(stacks) {
                this._bleedStacks += stacks;
                this._bleedTimer = 5000;
                if (this._bleedTickTimer <= 0) this._bleedTickTimer = 1000;
                if (!this._bleedEffectId && StatusBar) {
                    this._bleedEffectId = StatusBar.addEffect('bleed', 5000, { stacks: this._bleedStacks });
                } else if (StatusBar) {
                    StatusBar.updateEffectStacks('bleed', this._bleedStacks);
                }
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `🩸 流血 +${stacks}层`, '#9a3a3a'));
                }
            }
            // --- 状态效果：魔法易伤 ---
            _updateMagicVulnerability(dt) {
                if (this._magicVulnerabilityStacks <= 0) return;
                this._magicVulnerabilityTimer -= dt;
                if (this._magicVulnerabilityTimer <= 0) {
                    this._magicVulnerabilityStacks = Math.max(0, this._magicVulnerabilityStacks - 1);
                    if (this._magicVulnerabilityStacks > 0) this._magicVulnerabilityTimer = 5000;
                }
            }
            applyMagicVulnerability(stacks) {
                this._magicVulnerabilityStacks += stacks;
                this._magicVulnerabilityTimer = 5000;
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `🔮 魔力易伤 +${stacks}层`, '#8a5a9a'));
                }
            }
            // --- 状态效果：无人机易伤 ---
            _updateDroneVulnerability(dt) {
                if (this._droneVulnerabilityStacks <= 0) return;
                this._droneVulnerabilityTimer -= dt;
                if (this._droneVulnerabilityTimer <= 0) {
                    this._droneVulnerabilityStacks = Math.max(0, this._droneVulnerabilityStacks - 1);
                    if (this._droneVulnerabilityStacks > 0) this._droneVulnerabilityTimer = 5000;
                }
            }
            applyDroneVulnerability(stacks) {
                this._droneVulnerabilityStacks += stacks;
                this._droneVulnerabilityTimer = 999999;
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `🛸 无人机易伤 +${stacks}层`, '#5a7a9a'));
                }
            }
            update(dt) {
                // 更新状态栏效果计时器
                this.updateStatusEffects(dt);
                // 更新伤害型状态效果（中毒、流血、易伤）
                this._updatePoison(dt);
                this._updateBleed(dt);
                this._updateMagicVulnerability(dt);
                this._updateDroneVulnerability(dt);
                if (Math.abs(this.knockbackX) > 0.1 || Math.abs(this.knockbackY) > 0.1) {
                    const nx = this.x + this.knockbackX;
                    const ny = this.y + this.knockbackY;
                    // 击退时加入墙壁碰撞检测，防止穿墙
                    const radius = this.groundRadius;
                    if (WallSystem && WallSystem.walls && WallSystem.walls.length > 0) {
                        const resolved = WallSystem.resolve(this.x, this.y, nx, ny, radius);
                        // 撞墙检测：如果resolve限制了移动，往反方向反弹5px
                        const hitWall = Math.abs(resolved.x - nx) > 0.5 || Math.abs(resolved.y - ny) > 0.5;
                        if (hitWall) {
                            const angle = Math.atan2(this.knockbackY, this.knockbackX);
                            this.x = resolved.x - Math.cos(angle) * 5;
                            this.y = resolved.y - Math.sin(angle) * 5;
                            // 撞墙烟雾效果：在墙面位置产生
                            if (EffectManager) EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
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
            _drawShadow(ctx, x, y, size) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
                ctx.beginPath();
                ctx.ellipse(x, y + size * 0.7, size * 0.8, size * 0.3, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }

export { DamageableEntity };
