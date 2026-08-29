import { applyEnchantOnHit } from './attack.js';
import { SoundManager } from '../ui/sound-manager.js';
import { GunFeel } from '../effects/gunfeel.js';
import { canMeleeShareSurface } from './melee-surface.js';
import { isGunWeapon } from '../config/gun-ammo.js';
import { hasEnemyFamily } from '../config/enemy-family.js';
import audioConfig from '../../data/audio-config.json';

/**
 * 统一伤害处理管道
 * 封装命中后的通用流程，消除 attack.js 和 projectile.js 中的重复代码
 */
class DamagePipeline {
    /** 玩家近战命中音效节流（连段/多目标防刷音） */
    static _meleeHitSoundCd = 0;
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
     * @param {object} [options.effectContext] 单次攻击/投射物上下文，用于限制穿透多目标重复触发自身增益
     * @param {{value:number}} [options.hitCountRef] 命中计数引用
     * @param {{value:number}} [options.killCountRef] 击杀计数引用
     * @param {boolean} [options.isMelee=true] 是否为近战攻击（影响盾牌弹反效果）
     * @param {object} [options.confirmedHitContext] 传给来源确认命中钩子的技能上下文
     * @returns {{hit:boolean,killed:boolean,skillExpEligible:boolean}}
     */
    static applyHit(source, target, options = {}) {
        const {
            damage,
            damageType = 'physical',
            knockback,
            angle,
            currentWeapon,
            effectContext,
            hitCountRef,
            killCountRef,
            isMelee = true,
            confirmedHitContext = null
        } = options;
        if (isMelee && !canMeleeShareSurface(source, target)) {
            return { hit: false, killed: false, skillExpEligible: false };
        }

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
        const skillExpEligible = target._grantsSkillTrainingExp !== false;
        target.takeDamage(damage, source, damageType, isMelee, effectContext?._hitContext || null);
        const killed = wasAlive && target.hp <= 0;

        // 枪械手感反馈（COD/Sakanako 式命中确认链）：远程命中 → hitmarker 三级 + 音效 + trauma + 击杀 hitstop
        // 近战已有独立打击音（下方节流播放），不重复触发
        // 玩家命中反馈（震屏/hitmarker/trauma）仅限真正的玩家——防御塔等友方结构
        // 开火命中不震动玩家屏幕（2026-08-14）
        if (!isMelee && source && source._faction === 'player' && !source._isDefenseStructure && !source._isDefenseTower && GunFeel) {
            GunFeel.onPlayerHit({ killed, crit: !!target._lastHitCrit });
        }

        // 灼锋焰甲：Buff 期间非魔法攻击命中附带魔法伤害 + 火花（火焰护甲附伤）
        if (damageType !== 'magic' && source && source._faction === 'player' && source.flameArmorSystem
                && typeof source.hasStatusEffect === 'function' && source.hasStatusEffect('flameArmor')) {
            source.flameArmorSystem.onPhysicalHit(target, source);
        }

        // 盾牌弹反成功后，不应再对持盾者施加击退、 craft 特效等后续效果
        const parried = target.shieldSystem && target.shieldSystem._lastParried;

        // 玩家/防御塔枪械命中僵尸或动物时播放统一肉体命中声。
        // 友方仓鼠属于 companion 阵营，不会进入本分支。
        if (!parried && isPlayerOrTowerGunHit(source, target, weapon)) {
            const path = audioConfig.combatCues?.gunHitZombieAnimal;
            if (path && SoundManager && typeof SoundManager.playWorld === 'function') {
                const colliderX = Number(target.collider?.x);
                const colliderY = Number(target.collider?.y);
                const hitX = Number.isFinite(colliderX) ? colliderX : target.x;
                const hitY = Number.isFinite(colliderY) ? colliderY : target.y;
                SoundManager.playWorld(path, hitX, hitY);
            }
        }

        // 仅在伤害调用完成、确认未被弹反后触发的附加效果入口。
        // 需要“每次实际命中”语义的怪物效果（如棕蛇毒牙）走这里，避免在
        // takeDamage 之前无法识别弹反，也不改变旧 _onHitEntity 的既有时序。
        if (!parried && typeof source._onConfirmedHitEntity === 'function') {
            source._onConfirmedHitEntity(target, {
                killed,
                ...(confirmedHitContext && typeof confirmedHitContext === 'object'
                    ? confirmedHitContext
                    : {}),
            });
        }

        if (skillExpEligible && hitCountRef && typeof hitCountRef.value === 'number') {
            hitCountRef.value++;
        }
        if (skillExpEligible && killed && killCountRef && typeof killCountRef.value === 'number') {
            killCountRef.value++;
        }

        // 玩家近战攻击命中音效（assets/sounds/weapons/sword/hitting.mp3；
        // 节流 90ms 防连段多目标刷音）
        if (isMelee && source && source._faction === 'player' && !source._isDefenseStructure && SoundManager && typeof SoundManager.playFile === 'function') {
            const now = performance.now();
            if (now >= DamagePipeline._meleeHitSoundCd) {
                DamagePipeline._meleeHitSoundCd = now + 90;
                SoundManager.playFile('assets/sounds/weapons/sword/hitting.mp3');
            }
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
                target.takeDamage(weaponAtk, source, 'magic', false);
            }
            // P4040 轻量化快速板机：独立武器加速，同一穿透弹只在首次命中触发。
            if (ce.onHitSpeedBuff && source && typeof source.applyWeaponHaste === 'function') {
                const b = ce.onHitSpeedBuff;
                const alreadyTriggered = b.triggerPerProjectile && effectContext?._onHitSpeedBuffTriggered;
                if (!alreadyTriggered) {
                    source.applyWeaponHaste(b.durationMs ?? 2000, b.speedPercent ?? 0.10);
                    if (b.triggerPerProjectile && effectContext) effectContext._onHitSpeedBuffTriggered = true;
                }
            }
        }

        if (typeof source._triggerRuneSwordCooldownReduction === 'function') {
            source._triggerRuneSwordCooldownReduction();
        }

        return { hit: true, killed, skillExpEligible };
    }
}

function isValidKnockback(knockback, angle) {
    return knockback != null && angle != null &&
           typeof knockback === 'number' && Number.isFinite(knockback) &&
           typeof angle === 'number' && Number.isFinite(angle);
}

function isPlayerOrTowerGunHit(source, target, weapon) {
    if (!source || !target || target._faction !== 'enemy' || !isGunWeapon(weapon)) return false;
    const isPlayer = source._faction === 'player'
        && !source._isDefenseStructure
        && !source._isDefenseTower;
    const isDefenseTower = source._isDefenseTower === true;
    if (!isPlayer && !isDefenseTower) return false;
    return hasEnemyFamily(target, '僵尸') || hasEnemyFamily(target, '动物');
}

export { DamagePipeline };
