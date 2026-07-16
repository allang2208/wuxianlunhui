import { SoundManager } from '../ui/sound-manager.js';
import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { AttackRangeEffect } from '../effects/attack-range-effect.js';
import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { DamagePipeline } from './damage-pipeline.js';
import { COMBAT_CONFIG } from '../config/combat-config.js';

import { EffectManager } from '../effects/effect-manager.js';
import { ProjectileFactory } from '../utils/projectile-factory.js';
import { CONFIG } from '../config/config.js';
import { SkillManager } from '../ui/skill-manager.js';
import { AimHelper } from '../utils/aim-helper.js';
import { distanceToEntityShape } from '../utils/collision-helpers.js';
import { VerticalSector, VerticalRect } from '../physics/skill-shapes.js';
import SpatialPartitionSystem from '../systems/spatial-partition-system.js';

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
            constructor(config) { 
                this.config = config; 
                this.cooldown = 0; 
                const defaultCooldown = COMBAT_CONFIG.attack?.defaults?.cooldown || 1000;
                this.maxCooldown = config.cooldown !== undefined ? config.cooldown : defaultCooldown; 
                this.range = config.range || 0; 
                this.width = config.width || 0; 
                this.projectileSpeed = config.projectileSpeed || 0; 
                this.projectileRange = config.projectileRange || 0; 
                this.active = true; 
            }
            canUse() { return this.cooldown <= 0; }
            use(source, targetX, targetY, entities) { if (!this.canUse()) return false; const success = this.execute(source, targetX, targetY, entities); if (success) this.cooldown = this.maxCooldown; return success; }
            execute(_source, _targetX, _targetY, _entities) {}
            update(dt) { if (this.cooldown > 0) this.cooldown -= dt; }
            getCooldownPercent() { return Math.max(0, this.cooldown / this.maxCooldown); }
            _queryNearbyEntities(x, y, radius, exclude, entities) {
                if (SpatialPartitionSystem && typeof SpatialPartitionSystem.queryRadius === 'function') {
                    return SpatialPartitionSystem.queryRadius(x, y, radius, exclude);
                }
                return entities ? Array.from(entities.values()) : [];
            }
        }

        class SlashAttack extends Attack {
            constructor(config = {}) {
                const cfg = COMBAT_CONFIG.slashAttack || { cooldown: 500, range: 100, arc: Math.PI / 2.5, damage: { min: 10, max: 18 }, knockback: 31 };
                super({ 
                    cooldown: config.cooldown || cfg.cooldown, 
                    range: config.range || cfg.range, 
                    arc: config.arc || cfg.arc, 
                    damage: config.damage || cfg.damage, 
                    knockback: config.knockback || cfg.knockback, 
                    ...config 
                });
            }
            execute(source, targetX, targetY, entities) {
                const currentWeapon = source.getCurrentWeapon ? source.getCurrentWeapon() : (source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null);
                const attackAngle = Math.atan2(targetY - source.y, targetX - source.x);
                if (!isFinite(attackAngle)) {
                    console.warn('SlashAttack: invalid attack angle', { targetX, targetY, sx: source.x, sy: source.y });
                    return false;
                }
                let staminaCost = CONFIG.STAMINA_MELEE_COST;
                if (currentWeapon && currentWeapon._craftEffects) {
                    const ce = currentWeapon._craftEffects;
                    if (typeof ce.staminaCostDelta === 'number' && isFinite(ce.staminaCostDelta)) staminaCost += ce.staminaCostDelta;
                }
                if (!isFinite(staminaCost) || staminaCost < 0) staminaCost = 0;
                if (source.consumeStamina) {
                    if (!source.consumeStamina(staminaCost)) return false;
                } else if (source.data && source.data.stamina !== undefined) {
                    if (source.data.stamina < staminaCost) return false;
                    source.data.stamina -= staminaCost;
                }
                // 剑类武器攻击范围调整：根据武器配置使用对应射程
                const isSword = currentWeapon && (currentWeapon.weaponType === 'sword' || currentWeapon.category === 'weapon_melee');
                const swordCfg = COMBAT_CONFIG.slashAttack?.sword || { baseRange: 155, rangeBonus: 50 };
                const rangeBonus = (currentWeapon && currentWeapon.attack && currentWeapon.attack.rangeBonus) ?? swordCfg.rangeBonus;
                let effectiveRange = isSword ? ((currentWeapon.attack?.range || swordCfg.baseRange) + rangeBonus) : this.config.range;
                // 应用改造效果：攻击距离
                if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.rangeDelta) {
                    effectiveRange += currentWeapon._craftEffects.rangeDelta;
                }
                const arc = this.config.arc;
                // 攻击范围起始位置：从视觉身体中心（脚底 - footOffsetY）发出，与武器位置同步
                const weaponOffset = COMBAT_CONFIG.attack?.defaults?.weaponOffset || 0;
                const footOffsetY = source.footOffsetY ?? source.config?.render?.footOffsetY ?? 0;
                const originX = source.x + Math.cos(attackAngle) * weaponOffset;
                const originY = source.y - footOffsetY + Math.sin(attackAngle) * weaponOffset;
                EffectManager.add(new AttackRangeEffect(originX, originY, attackAngle, effectiveRange, arc, 'sector'));
                let hitCount = 0, killCount = 0;
                const hitCountRef = { value: 0 };
                const killCountRef = { value: 0 };
                const slashShape = new VerticalSector(originX, originY, attackAngle, effectiveRange, arc, 0, source.bodyHeight || 150);
                const candidates = this._queryNearbyEntities(originX, originY, effectiveRange + 100, source, entities);
                candidates.forEach(entity => {
                    if (entity === source || !entity.active || !entity.hittable) return;
                    // 新增：怪物之间不互相攻击
                    if (source._faction === 'enemy' && entity._faction === 'enemy') return;
                    if (slashShape.intersectsEntity(entity)) {
                        const baseDamage = source.getCurrentWeaponAtk ? source.getCurrentWeaponAtk() : Math.floor((this.config.damage.min + this.config.damage.max) / 2);
                        const damage = baseDamage;
                        const { killed } = DamagePipeline.applyHit(source, entity, {
                            damage,
                            damageType: 'physical',
                            knockback: this.config.knockback,
                            angle: attackAngle,
                            currentWeapon,
                            hitCountRef,
                            killCountRef
                        });
                        if (killed) killCount++;
                        hitCount++;
                    }
                });
                // 剑精通经验（普通斩击命中）
                SkillManager.addMeleeExp(source, hitCount, killCount);
                return true;
            }
        }

        class ThrustAttack extends Attack {
            constructor(config = {}) {
                const cfg = COMBAT_CONFIG.thrustAttack || { cooldown: 600, range: 117, width: 23, damage: { min: 12, max: 20 }, knockback: 19, damageType: 'physical', hitDurationMs: 500 };
                super({ 
                    cooldown: config.cooldown || cfg.cooldown, 
                    range: config.range || cfg.range, 
                    width: config.width || cfg.width, 
                    damage: config.damage || cfg.damage, 
                    knockback: config.knockback || cfg.knockback, 
                    damageType: config.damageType || cfg.damageType, 
                    hitDurationMs: config.hitDurationMs || cfg.hitDurationMs,
                    ...config 
                });
            }
            execute(source, targetX, targetY, entities) {
                const currentWeapon = source.getCurrentWeapon ? source.getCurrentWeapon() : (source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null);
                const attackAngle = Math.atan2(targetY - source.y, targetX - source.x);
                if (!isFinite(attackAngle)) {
                    console.warn('ThrustAttack: invalid attack angle', { targetX, targetY, sx: source.x, sy: source.y });
                    return false;
                }
                let staminaCost = CONFIG.STAMINA_MELEE_COST;
                if (currentWeapon && currentWeapon._craftEffects) {
                    const ce = currentWeapon._craftEffects;
                    if (typeof ce.staminaCostDelta === 'number' && isFinite(ce.staminaCostDelta)) staminaCost += ce.staminaCostDelta;
                }
                if (!isFinite(staminaCost) || staminaCost < 0) staminaCost = 0;
                if (source.consumeStamina) {
                    if (!source.consumeStamina(staminaCost)) return false;
                } else if (source.data && source.data.stamina !== undefined) {
                    if (source.data.stamina < staminaCost) return false;
                    source.data.stamina -= staminaCost;
                }
                // 计算武器攻击力（包含属性加成和剑精通）
                const weaponAtk = source.getCurrentWeaponAtk ? source.getCurrentWeaponAtk() : Math.floor((this.config.damage.min + this.config.damage.max) / 2);
                // 剑类武器攻击范围：使用 WeaponAnimConfig.sword.hitBox 统一配置
                const isSword = currentWeapon && (currentWeapon.weaponType === 'sword' || currentWeapon.category === 'weapon_melee');
                const swordCfg = COMBAT_CONFIG.thrustAttack?.sword || { rangeBonus: 50 };
                const rangeBonus = (currentWeapon && currentWeapon.attack && currentWeapon.attack.rangeBonus) ?? swordCfg.rangeBonus;
                const hitBox = WeaponAnimConfig.sword.hitBox;
                let effectiveRange = isSword ? (hitBox.forwardRange + rangeBonus) : this.config.range;
                // 应用改造效果：攻击距离
                if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.rangeDelta) {
                    effectiveRange += currentWeapon._craftEffects.rangeDelta;
                }
                const effectiveWidth = isSword ? hitBox.width * 2 : this.config.width; // hitBox.width 是半宽，显示用全宽
                // 攻击范围起始位置：从视觉身体中心发出，与武器位置同步
                const weaponOffset = COMBAT_CONFIG.attack?.defaults?.weaponOffset || 0;
                const footOffsetY = source.footOffsetY ?? source.config?.render?.footOffsetY ?? 0;
                const originX = source.x + Math.cos(attackAngle) * weaponOffset;
                const originY = source.y - footOffsetY + Math.sin(attackAngle) * weaponOffset;
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
                // 攻击判定持续时间：覆盖 windup + swing 阶段
                const hitDurationMs = this.config.hitDurationMs || 500;
                if (Date.now() - pt.startTime > hitDurationMs) { pt.active = false; return; }
                const range = pt.range, width = pt.width, angle = pt.angle;
                const ax = pt.x, ay = pt.y; // 使用攻击起始时的固定位置
                let hitCount = 0, killCount = 0;
                // 获取当前武器，检查是否为剑类武器
                const currentWeapon = source.getCurrentWeapon ? source.getCurrentWeapon() : (source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null);
                const isSword = currentWeapon && (currentWeapon.weaponType === 'sword' || currentWeapon.category === 'weapon_melee');
                // 剑类武器攻击范围：使用 WeaponAnimConfig.sword.hitBox 统一配置
                const hitBox = WeaponAnimConfig.sword.hitBox;
                const backExt = isSword ? (hitBox.backExtension || 0) : 0;
                const thrustShape = new VerticalRect(ax, ay, angle, range, width, 0, source.bodyHeight || 150, backExt);
                const candidates = this._queryNearbyEntities(ax, ay, range + 100, source, pt.entities);
                candidates.forEach(entity => {
                    if (entity === source || !entity.active || !entity.hittable) return;
                    if (pt.hitSet.has(entity)) return; // 已命中过
                    // 新增：怪物之间不互相攻击
                    if (source._faction === 'enemy' && entity._faction === 'enemy') return;
                    // 墙壁视线检测：不能攻击墙后的目标
                    if (WallSystem.blocked(ax, ay, entity.x, entity.y)) return;
                    // === 动态距离判定（优先于矩形判定）===
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
                        if (distanceToEntityShape(entity, sourceX, sourceY) > pt.dynamicRange) return;
                        // 命中：走统一伤害管道
                    } else if (!thrustShape.intersectsEntity(entity)) {
                        return;
                    }
                    pt.hitSet.add(entity);
                    let baseDamage = Math.floor((pt.damage.min + pt.damage.max) / 2);
                    const damage = baseDamage + pt.damageBonus;
                    const { killed } = DamagePipeline.applyHit(source, entity, {
                        damage,
                        damageType: pt.damageType || 'physical',
                        knockback: pt.knockback,
                        angle,
                        currentWeapon
                    });
                    if (this.config.crippleDuration && entity.applyCripple) {
                        entity.applyCripple(this.config.crippleDuration);
                    }
                    if (killed) killCount++;
                    hitCount++;
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
                const cfg = COMBAT_CONFIG.rangedAttack || { cooldown: 800, projectileSpeed: 10, projectileRange: 625, projectileSize: 6, damage: { min: 6, max: 14 }, piercing: false, damageType: 'physical' };
                super({ 
                    cooldown: config.cooldown || cfg.cooldown, 
                    projectileSpeed: config.projectileSpeed || cfg.projectileSpeed, 
                    projectileRange: config.projectileRange || cfg.projectileRange, 
                    projectileSize: config.projectileSize || cfg.projectileSize, 
                    damage: config.damage || cfg.damage, 
                    piercing: config.piercing || cfg.piercing, 
                    damageType: config.damageType || cfg.damageType, 
                    ...config 
                });
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
                    
                    SoundManager.playFile('assets/sounds/pkm_half_sec.wav');
                } else if (wType === 'qbz191') {
                    SoundManager.playFile('assets/sounds/qbz191_shot6_valley.mp3');
                } else if (wType === 'pistol') {
                    SoundManager.play('gun_fire');
                } else {
                    SoundManager.play('bow_fire');
                }
                // [FIX] 统一使用 getCurrentWeaponAtk，敌人优先读取 enemy-config.json 的 damageMin/damageMax，
                // 确保实际伤害与图鉴显示一致。
                const baseDamage = source.getCurrentWeaponAtk
                    ? source.getCurrentWeaponAtk()
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
                const projDefaults = COMBAT_CONFIG.projectile?.defaults || { speed: 10, range: 625, size: 6 };
                const projectileSpeed = this.config.projectileSpeed || projDefaults.speed;
                const projectileRange = this.config.projectileRange || projDefaults.range;
                const projectileSize = this.config.projectileSize || projDefaults.size;

                // [ENHANCE] 对移动目标使用预判瞄准
                let aimX = targetX, aimY = targetY;
                if (source.target && source.target.active && source.target.vx !== undefined) {
                    const lead = AimHelper.lead(source.x, source.y, source.target.x, source.target.y, source.target.vx || 0, source.target.vy || 0, projectileSpeed);
                    aimX = lead.x; aimY = lead.y;
                }
                const angle = Math.atan2(aimY - source.y, aimX - source.x);

                ProjectileFactory.create({
                    x: source.x, y: source.y, angle,
                    speed: projectileSpeed, maxRange: projectileRange, size: projectileSize,
                    damage, piercing, source, entities,
                    image: source.arrowImage,
                    damageType,
                    isSpit: source.name === '毒液僵尸' || this.config.isSpit
                });
                return true;
            }
        }

export { Attack, SlashAttack, ThrustAttack, RangedAttack, EnchantOnHitRegistry, applyEnchantOnHit };
