import { applyEnchantOnHit } from './attack.js';

/**
 * 统一伤害处理管道
 * 封装命中后的通用流程，消除 attack.js 和 projectile.js 中的重复代码
 */
class DamagePipeline {
    /**
     * 执行一次命中后的完整伤害流程
     * @param {object} source 攻击来源（玩家或敌人）
     * @param {object} target 命中目标
     * @param {object} options
     * @param {number} options.damage 最终伤害值
     * @param {string} [options.damageType='physical'] 伤害类型
     * @param {number} [options.knockback] 击退距离
     * @param {number} [options.angle] 击退角度
     * @param {object} [options.currentWeapon] 当前武器（未提供则自动解析）
     * @param {{value:number}} [options.hitCountRef] 命中计数引用
     * @param {{value:number}} [options.killCountRef] 击杀计数引用
     * @param {boolean} [options.isMelee=true] 是否为近战攻击（影响盾牌弹反效果）
     * @returns {{hit:boolean,killed:boolean}}
     */
    static applyHit(source, target, options = {}) {
        const {
            damage,
            damageType = 'physical',
            knockback,
            angle,
            currentWeapon,
            hitCountRef,
            killCountRef,
            isMelee = true
        } = options;

        const weapon = currentWeapon !== undefined
            ? currentWeapon
            : (source.getCurrentWeapon ? source.getCurrentWeapon() : (source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null));

        if (weapon) {
            applyEnchantOnHit(weapon, target, source);
        }

        if (typeof source._onHitEntity === 'function') {
            source._onHitEntity(target);
        }

        const wasAlive = target.hp > 0;
        target.takeDamage(damage, source, damageType, isMelee);
        const killed = wasAlive && target.hp <= 0;

        // 盾牌弹反成功后，不应再对持盾者施加击退、 craft 特效等后续效果
        const parried = target.shieldSystem && target.shieldSystem._lastParried;

        if (hitCountRef && typeof hitCountRef.value === 'number') {
            hitCountRef.value++;
        }
        if (killed && killCountRef && typeof killCountRef.value === 'number') {
            killCountRef.value++;
        }

        if (!parried && isValidKnockback(knockback, angle) && typeof target.applyKnockback === 'function') {
            target.applyKnockback(angle, knockback);
        }

        if (!parried && weapon && weapon._craftEffects && target) {
            const ce = weapon._craftEffects;
            if (ce.bleedingOnHit && typeof target.applyBleeding === 'function') {
                target.applyBleeding(1);
            }
            if (ce.magicVulnerabilityOnHit && typeof target.applyMagicVulnerability === 'function') {
                const stacks = ce.magicVulnerabilityStacks || 1;
                target.applyMagicVulnerability(stacks);
            }
            if (ce.enchantedBlade) {
                const weaponAtk = source.getCurrentWeaponAtk ? source.getCurrentWeaponAtk() : damage;
                target.takeDamage(weaponAtk, source, 'magic');
            }
        }

        if (typeof source._triggerRuneSwordCooldownReduction === 'function') {
            source._triggerRuneSwordCooldownReduction();
        }

        return { hit: true, killed };
    }
}

function isValidKnockback(knockback, angle) {
    return knockback != null && angle != null &&
           typeof knockback === 'number' && Number.isFinite(knockback) &&
           typeof angle === 'number' && Number.isFinite(angle);
}

export { DamagePipeline };
