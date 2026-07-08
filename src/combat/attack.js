import { WeaponAnimConfig } from '../items/weapon-anim-config.js';

// ===== 通用附魔命中效果系统 =====
// 遍历武器 _enchantEffects，自动应用所有 onHit 类型效果
// 后续新增附魔效果只需在此注册处理器，无需修改攻击逻辑代码
const EnchantOnHitRegistry = {
    poisonOnHit: (weapon, target, source, effects) => {
        if (typeof target.applyPoison === 'function') {
            target.applyPoison(effects.poisonStacks || 1);
        }
    },
    // 后续在此注册更多 onHit 效果，例如：
    // fireOnHit: (weapon, target, source, effects) => { ... },
    // iceOnHit: (weapon, target, source, effects) => { ... },
};

function applyEnchantOnHit(weapon, target, source) {
    if (!weapon || !weapon._enchantEffects || !target) return;
    const effects = weapon._enchantEffects;
    for (const [key, handler] of Object.entries(EnchantOnHitRegistry)) {
        if (effects[key]) {
            handler(weapon, target, source, effects);
        }
    }
}

        class Attack {
            constructor(config) { this.config = config; this.cooldown = 0; this.maxCooldown = config.cooldown !== undefined ? config.cooldown : 1000; this.range = config.range || 0; this.width = config.width || 0; this.projectileSpeed = config.projectileSpeed || 0; this.projectileRange = config.projectileRange || 0; this.active = true; }
            canUse() { return this.cooldown <= 0; }
            use(source, targetX, targetY, entities) { if (!this.canUse()) return false; const success = this.execute(source, targetX, targetY, entities); if (success) this.cooldown = this.maxCooldown; return success; }
            execute(source, targetX, targetY, entities) {}
            update(dt) { if (this.cooldown > 0) this.cooldown -= dt; }
            getCooldownPercent() { return Math.max(0, this.cooldown / this.maxCooldown); }
        }

        class SlashAttack extends Attack {
            constructor(config = {}) {
                super({ cooldown: config.cooldown || 500, range: config.range || 100, arc: config.arc || Math.PI / 2.5, damage: config.damage || { min: 10, max: 18 }, knockback: config.knockback || 31, ...config });
            }
            execute(source, targetX, targetY, entities) {
                const currentWeapon = source.getCurrentWeapon ? source.getCurrentWeapon() : (source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null);
                let staminaCost = CONFIG.STAMINA_MELEE_COST;
                if (currentWeapon && currentWeapon._craftEffects) {
                    const ce = currentWeapon._craftEffects;
                    if (ce.staminaCostDelta) staminaCost += ce.staminaCostDelta;
                }
                if (staminaCost < 0) staminaCost = 0;
                if (source.consumeStamina) {
                    if (!source.consumeStamina(staminaCost)) return false;
                } else if (source.data && source.data.stamina !== undefined) {
                    if (source.data.stamina < staminaCost) return false;
                    source.data.stamina -= staminaCost;
                }
                // 剑类武器攻击范围调整：根据武器配置使用对应射程
                const isSword = currentWeapon && (currentWeapon.weaponType === 'sword' || currentWeapon.category === 'weapon_melee');
                const rangeBonus = (currentWeapon && currentWeapon.attack && currentWeapon.attack.rangeBonus) ?? 50;
                let effectiveRange = isSword ? ((currentWeapon.attack?.range || 155) + rangeBonus) : this.config.range;
                // 应用改造效果：攻击距离
                if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.rangeDelta) {
                    effectiveRange += currentWeapon._craftEffects.rangeDelta;
                }
                const arc = this.config.arc;
                const attackAngle = Math.atan2(targetY - source.y, targetX - source.x);
                if (!isFinite(attackAngle)) {
                    console.warn('SlashAttack: invalid attack angle', { targetX, targetY, sx: source.x, sy: source.y });
                    return true;
                }
                // 攻击范围起始位置与主角坐标重叠（偏移0px）
                const WEAPON_OFFSET = 0;
                const originX = source.x + Math.cos(attackAngle) * WEAPON_OFFSET;
                const originY = source.y + Math.sin(attackAngle) * WEAPON_OFFSET;
                EffectManager.add(new AttackRangeEffect(originX, originY, attackAngle, effectiveRange, arc, 'sector'));
                let hitCount = 0, killCount = 0;
                entities.forEach(entity => {
                    if (entity === source || !entity.active || !entity.hittable) return;
                    // 新增：怪物之间不互相攻击
                    if (source._faction === 'enemy' && entity._faction === 'enemy') return;
                    if (MathUtils.pointInSector(entity.x, entity.y, originX, originY, attackAngle, effectiveRange, arc)) {
                        const baseDamage = source.getCurrentWeaponAtk ? source.getCurrentWeaponAtk() : Math.floor((this.config.damage.min + this.config.damage.max) / 2);
                        const damage = baseDamage;
                        const wasAlive = entity.hp > 0;
                        entity.takeDamage(damage, source, 'physical', true);
                        if (wasAlive && entity.hp <= 0) killCount++;
                        hitCount++;
                        entity.applyKnockback(attackAngle, this.config.knockback);
                        source._triggerRuneSwordCooldownReduction && source._triggerRuneSwordCooldownReduction();
                        // 通用附魔命中效果（非硬编码）
                        applyEnchantOnHit(currentWeapon, entity, source);
                        if (typeof source._onHitEntity === 'function') source._onHitEntity(entity);
                        // 改造效果：流血
                        if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.bleedingOnHit && entity.applyBleeding) {
                            entity.applyBleeding(1);
                        }
                    }
                });
                // 剑精通经验（普通斩击命中）
                SkillManager.addMeleeExp(source, hitCount, killCount);
                return true;
            }
        }

        class ThrustAttack extends Attack {
            constructor(config = {}) {
                super({ cooldown: config.cooldown || 600, range: config.range || 117, width: config.width || 23, damage: config.damage || { min: 12, max: 20 }, knockback: config.knockback || 19, damageType: config.damageType || 'physical', ...config });
            }
            execute(source, targetX, targetY, entities) {
                const currentWeapon = source.getCurrentWeapon ? source.getCurrentWeapon() : (source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null);
                let staminaCost = CONFIG.STAMINA_MELEE_COST;
                if (currentWeapon && currentWeapon._craftEffects) {
                    const ce = currentWeapon._craftEffects;
                    if (ce.staminaCostDelta) staminaCost += ce.staminaCostDelta;
                }
                if (staminaCost < 0) staminaCost = 0;
                if (source.consumeStamina) {
                    if (!source.consumeStamina(staminaCost)) return false;
                } else if (source.data && source.data.stamina !== undefined) {
                    if (source.data.stamina < staminaCost) return false;
                    source.data.stamina -= staminaCost;
                }
                const attackAngle = Math.atan2(targetY - source.y, targetX - source.x);
                if (!isFinite(attackAngle)) {
                    console.warn('ThrustAttack: invalid attack angle', { targetX, targetY, sx: source.x, sy: source.y });
                    return true;
                }
                // 计算武器攻击力（包含属性加成和剑精通）
                const weaponAtk = source.getCurrentWeaponAtk ? source.getCurrentWeaponAtk() : Math.floor((this.config.damage.min + this.config.damage.max) / 2);
                // 剑类武器攻击范围：使用 WeaponAnimConfig.sword.hitBox 统一配置
                const isSword = currentWeapon && (currentWeapon.weaponType === 'sword' || currentWeapon.category === 'weapon_melee');
                const rangeBonus = (currentWeapon && currentWeapon.attack && currentWeapon.attack.rangeBonus) ?? 50;
                const hitBox = WeaponAnimConfig.sword.hitBox;
                let effectiveRange = isSword ? (hitBox.forwardRange + rangeBonus) : this.config.range;
                // 应用改造效果：攻击距离
                if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.rangeDelta) {
                    effectiveRange += currentWeapon._craftEffects.rangeDelta;
                }
                const effectiveWidth = isSword ? hitBox.width * 2 : this.config.width; // hitBox.width 是半宽，显示用全宽
                // 攻击范围起始位置与主角坐标重叠（偏移0px）
                const WEAPON_OFFSET = 0;
                const originX = source.x + Math.cos(attackAngle) * WEAPON_OFFSET;
                const originY = source.y + Math.sin(attackAngle) * WEAPON_OFFSET;
                // 白色攻击范围可视化：使用统一 hitBox 配置
                if (Game.showAttackRange) {
                    EffectManager.add(new AttackRangeEffect(originX, originY, attackAngle, effectiveRange, effectiveWidth, 'triangle', 1000));
                }
                // 存储攻击数据，供swing阶段进行正方形攻击判定
                source._pendingThrust = {
                    x: originX,                   // 攻击起始位置（固定，不随移动变化）
                    y: originY,
                    range: effectiveRange,         // 剑类武器使用武器配置射程
                    width: effectiveWidth,         // 修正：实际判定宽度与显示宽度一致
                    angle: attackAngle,
                    facingDir: source._facingDir || 'down', // 4方向朝向（用于矩形攻击判定）
                    hitSet: new Set(),             // 已命中目标
                    damage: { min: weaponAtk, max: weaponAtk },
                    damageBonus: 0,                // 剑精通加成已包含在 getCurrentWeaponAtk 中
                    damageType: this.config.damageType || 'physical', // 伤害类型
                    knockback: this.config.knockback,
                    entities: entities,
                    active: true,
                    startTime: Date.now(),         // 判定开始时间
                    totalHitCount: 0,              // 整个攻击累计命中数
                    totalKillCount: 0,           // 整个攻击累计击杀数
                    dynamicRange: this.config.dynamicRange || 0,
                    expGiven: false                // 是否已发放经验
                };
                return true;
            }
            // 在swing阶段调用，进行三角形攻击判定
            checkTriangleHit(source) {
                const pt = source._pendingThrust;
                if (!pt || !pt.active) return;
                // 攻击判定持续时间：200ms
                if (Date.now() - pt.startTime > 200) { pt.active = false; return; }
                const range = pt.range, width = pt.width, angle = pt.angle;
                const ax = pt.x, ay = pt.y; // 使用攻击起始时的固定位置
                let hitCount = 0, killCount = 0;
                // 获取当前武器，检查是否为剑类武器
                const currentWeapon = source.getCurrentWeapon ? source.getCurrentWeapon() : (source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null);
                const isSword = currentWeapon && (currentWeapon.weaponType === 'sword' || currentWeapon.category === 'weapon_melee');
                // 剑类武器攻击范围：使用 WeaponAnimConfig.sword.hitBox 统一配置
                const hitBox = WeaponAnimConfig.sword.hitBox;
                const facingDir = pt.facingDir || 'down';
                pt.entities.forEach(entity => {
                    if (entity === source || !entity.active || !entity.hittable) return;
                    if (pt.hitSet.has(entity)) return; // 已命中过
                    // 新增：怪物之间不互相攻击
                    if (source._faction === 'enemy' && entity._faction === 'enemy') return;
                    // 墙壁视线检测：不能攻击墙后的目标
                    if (WallSystem.blocked(ax, ay, entity.x, entity.y)) return;
                    // === 动态距离判定（优先于矩形判定）===
                    const entityRadius = entity.collisionRadius || 12;
                    if (pt.dynamicRange > 0) {
                        // 计算黑狼当前实际位置（含冲刺偏移）
                        let sourceX = source.x, sourceY = source.y;
                        if (source._attackDashOffset > 0 && !source._dashBlocked) {
                            if (source._dashAngle !== undefined) {
                                sourceX += Math.cos(source._dashAngle) * source._attackDashOffset;
                                sourceY += Math.sin(source._dashAngle) * source._attackDashOffset;
                            } else {
                                switch (source._dashStartFacing) {
                                    case 'right': sourceX += source._attackDashOffset; break;
                                    case 'left':  sourceX -= source._attackDashOffset; break;
                                    case 'down':  sourceY += source._attackDashOffset; break;
                                    case 'up':    sourceY -= source._attackDashOffset; break;
                                }
                            }
                        }
                        const realDist = Math.sqrt((entity.x - sourceX)**2 + (entity.y - sourceY)**2);
                        if (realDist <= pt.dynamicRange + entityRadius) {
                            // 命中：走正常伤害流程
                            pt.hitSet.add(entity);
                            hitCount++;
                            // 通用附魔命中效果
                            applyEnchantOnHit(currentWeapon, entity, source);
                            if (typeof source._onHitEntity === 'function') source._onHitEntity(entity);
                            let baseDamage = Math.floor((pt.damage.min + pt.damage.max) / 2);
                            const damage = baseDamage + pt.damageBonus;
                            const wasAlive = entity.hp > 0;
                            entity.takeDamage(damage, source, pt.damageType || 'physical', true);
                            if (wasAlive && entity.hp <= 0) killCount++;
                            entity.applyKnockback(angle, pt.knockback);
                            // 改造效果：流血
                            if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.bleedingOnHit && entity.applyBleeding) {
                                entity.applyBleeding(1);
                            }
                            // 改造效果：魔力易伤
                            if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.magicVulnerabilityOnHit && entity.applyMagicVulnerability) {
                                const stacks = currentWeapon._craftEffects.magicVulnerabilityStacks || 1;
                                entity.applyMagicVulnerability(stacks);
                            }
                            // 改造效果：附魔刀刃
                            if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.enchantedBlade) {
                                const weaponAtk = source.getCurrentWeaponAtk ? source.getCurrentWeaponAtk() : damage;
                                entity.takeDamage(weaponAtk, source, 'magic');
                            }
                            source._triggerRuneSwordCooldownReduction && source._triggerRuneSwordCooldownReduction();
                            return; // 命中后直接处理下一个实体
                        }
                        // 动态距离未命中：跳过矩形判定，继续下一个
                        return;
                    }
                    // 矩形命中判定：根据4方向确定攻击矩形范围
                    const dx = entity.x - ax, dy = entity.y - ay;
                    const backExt = isSword ? hitBox.backExtension : 0;
                    let inRange = false;
                    if (facingDir === 'right') {
                        inRange = dx >= -backExt - entityRadius && dx <= range + entityRadius &&
                                  Math.abs(dy) <= width + entityRadius;
                    } else if (facingDir === 'left') {
                        inRange = dx <= backExt + entityRadius && dx >= -range - entityRadius &&
                                  Math.abs(dy) <= width + entityRadius;
                    } else if (facingDir === 'down') {
                        inRange = dy >= -backExt - entityRadius && dy <= range + entityRadius &&
                                  Math.abs(dx) <= width + entityRadius;
                    } else if (facingDir === 'up') {
                        inRange = dy <= backExt + entityRadius && dy >= -range - entityRadius &&
                                  Math.abs(dx) <= width + entityRadius;
                    }
                    if (inRange) {
                        pt.hitSet.add(entity);
                        hitCount++;
                        // 通用附魔命中效果（非硬编码，替代硬编码的 _onHitEntity）
                        applyEnchantOnHit(currentWeapon, entity, source);
                        if (typeof source._onHitEntity === 'function') source._onHitEntity(entity);
                        let baseDamage = Math.floor((pt.damage.min + pt.damage.max) / 2);
                        const damage = baseDamage + pt.damageBonus;
                        const wasAlive = entity.hp > 0;
                        entity.takeDamage(damage, source, pt.damageType || 'physical', true);
                        if (wasAlive && entity.hp <= 0) killCount++;
                        entity.applyKnockback(angle, pt.knockback);
                        // 改造效果：流血
                        if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.bleedingOnHit && entity.applyBleeding) {
                            entity.applyBleeding(1);
                        }
                        // 改造效果：魔力易伤（符文长剑/夜与火之剑）
                        if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.magicVulnerabilityOnHit && entity.applyMagicVulnerability) {
                            const stacks = currentWeapon._craftEffects.magicVulnerabilityStacks || 1;
                            entity.applyMagicVulnerability(stacks);
                        }
                        // 改造效果：附魔刀刃（夜与火之剑）
                        if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.enchantedBlade) {
                            const weaponAtk = source.getCurrentWeaponAtk ? source.getCurrentWeaponAtk() : damage;
                            entity.takeDamage(weaponAtk, source, 'magic');
                        }
                        source._triggerRuneSwordCooldownReduction && source._triggerRuneSwordCooldownReduction();
                    }
                });
                // 累计命中/击杀数（不直接给经验，经验在swing结束时统一发放）
                pt.totalHitCount += hitCount;
                pt.totalKillCount += killCount;
            }
            // 在swing阶段结束时调用，统一发放经验（只计算一次）
            giveExp(source) {
                const pt = source._pendingThrust;
                if (!pt || pt.expGiven) return;
                pt.expGiven = true;
                if (source.skills && source.skills.swordMastery) {
                    SkillManager.addMeleeExp(source, pt.totalHitCount, pt.totalKillCount);
                }
            }
        }

        class RangedAttack extends Attack {
            constructor(config = {}) {
                super({ cooldown: config.cooldown || 800, projectileSpeed: config.projectileSpeed || 10, projectileRange: config.projectileRange || 625, projectileSize: config.projectileSize || 6, damage: config.damage || { min: 6, max: 14 }, piercing: config.piercing || false, damageType: config.damageType || 'physical', ...config });
            }
            execute(source, targetX, targetY, entities) {
                if (source.consumeStamina) {
                    if (!source.consumeStamina(CONFIG.STAMINA_RANGED_COST)) return false;
                } else if (source.data && source.data.stamina !== undefined) {
                    if (source.data.stamina < CONFIG.STAMINA_RANGED_COST) return false;
                    source.data.stamina -= CONFIG.STAMINA_RANGED_COST;
                }
                const wType = source.equippedRangedType;
                // 播放武器开火音效
                if (wType === 'pkm') {
                    console.log('[PKM] Playing sound:', 'assets/sounds/pkm_half_sec.wav');
                    SoundManager.playFile('assets/sounds/pkm_half_sec.wav');
                } else if (wType === 'qbz191') {
                    SoundManager.playFile('assets/sounds/qbz191_shot6_valley.mp3');
                } else if (wType === 'pistol') {
                    SoundManager.play('gun_fire');
                } else {
                    SoundManager.play('bow_fire');
                }
                const angle = Math.atan2(targetY - source.y, targetX - source.x);
                // 新增：怪物使用属性攻击力，玩家保持配置值
                const baseDamage = source._faction === 'enemy' && source.data && source.data.atk
                    ? source.data.atk
                    : Math.floor((this.config.damage.min + this.config.damage.max) / 2);
                const damage = { min: baseDamage, max: baseDamage };
                const damageType = this.config.damageType || 'physical';
                // 附魔效果：穿透加成（骷髅射手）
                let piercing = this.config.piercing;
                if (source && source.getCurrentWeapon) {
                    const weapon = source.getCurrentWeapon();
                    if (weapon) {
                        if (weapon._enchantEffects && weapon._enchantEffects.piercingBonus) {
                            piercing = (piercing || 0) + weapon._enchantEffects.piercingBonus;
                        }
                        if (weapon._craftEffects && weapon._craftEffects.piercingBonus) {
                            piercing = (piercing || 0) + weapon._craftEffects.piercingBonus;
                        }
                    }
                }
                { let p = EffectManager._acquire('Projectile');
                        if (p) { p.x = source.x; p.y = source.y; p.angle = angle; p.speed = this.config.projectileSpeed; p.maxRange = this.config.projectileRange; p.size = this.config.projectileSize; p.damage = damage; p.piercing = piercing; p.source = source; p.entities = entities; p.image = source.arrowImage; p.traveled = 0; p.active = true; p.hitTargets = new Set(); p.damageType = damageType; p.isSpit = false; }
                        else p = new Projectile(source.x, source.y, angle, this.config.projectileSpeed, this.config.projectileRange, this.config.projectileSize, damage, piercing, source, entities, source.arrowImage, false, false, false, damageType);
                        if (source.name === '毒液僵尸' || this.config.isSpit) p.isSpit = true;
                        EffectManager.add(p); }
                return true;
            }
        }

export { Attack, SlashAttack, ThrustAttack, RangedAttack, EnchantOnHitRegistry, applyEnchantOnHit };
