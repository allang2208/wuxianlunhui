import { Game } from '../game.js';
import { LevelUpEffectQueue } from '../effects/level-up-queue.js';
import { SkillLevelSystem } from '../combat/skill-level-system.js';
import { isSwordCategory } from '../config/gun-ammo.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { SystemUI } from './system-ui.js';
import { grantCompanionSkillExp } from '../systems/skill-system.js';
import {
    getSkillMagicCategory,
    getSkillMagicTier,
    MAGIC_CATEGORY_STYLE,
    MAGIC_TIER_STYLE,
} from '../config/magic-categories.js';
import { getDroneValues, getPushStrikeValues, getWhirlwindRadius } from '../config/skill-formulas.js';
import { getShieldDefenseValues } from '../config/shield-config.js';

function buildSkillDetailModel(skill, displaySkill) {
    const tags = skill.tags || [];
    const active = tags.some(tag => tag.type === 'active');
    let operation = active ? '拖入快捷栏后按绑定键释放' : '满足装备条件后自动生效';
    let role = tags.find(tag => ['magic', 'melee', 'ranged', 'weapon'].includes(tag.type))?.name || '通用';
    let restriction = active ? '动作互斥、资源与冷却满足时可用' : '被动效果按当前装备与状态结算';
    if (skill.id === 'shieldDefense') {
        operation = '按住右键举盾，松开右键收盾';
        role = '格挡减伤 / 时机弹反';
        restriction = '当前副手装备盾；近战出手/施法/受控时不能举盾；手枪可盾下开火但不能瞄准';
    } else if (skill.id === 'pushStrike') {
        operation = '按快捷键发动；可中断当前换弹';
        role = '贴身保命 / 近战钝击';
        restriction = '仅步枪、机枪、能量机枪与霰弹枪等双手长枪';
    } else if (skill.id === 'droneSkill') {
        operation = '短按部署/接管/退出；长按指定航点';
        role = '高空侦察 / 战术标记';
        restriction = '部署消耗一次 MP 并进入冷却，控制切换不重复消耗';
    }
    return { role, operation, restriction, level: displaySkill.level };
}
export const SkillManager = {
    _currentDetailSkillId: null, // 追踪当前打开的技能详情ID
    _currentFilter: 'all', // 当前筛选条件：all|passive|active|magic
    _addSkillExp(player, skill, gained) {
        if (!skill || skill.level >= skill.maxLevel || gained <= 0) return;
        // 队友技能修炼（露娜魔法等）：走纯函数升级（companion-safe），不经过玩家技能面板
        if (player && player._faction === 'companion') {
            grantCompanionSkillExp(player, skill.id, gained);
            return;
        }
        SkillLevelSystem.addExp(skill, gained, player);
        SkillLevelSystem.refreshUI(skill.id);
    },
    addMeleeExp(player, hitCount, killCount, weaponItem = null) {
        if (!player || !player.skills) return;
        // 动作系统可传入起手武器快照，避免攻击途中装备变化让本次剑精通经验丢失。
        const currentWeapon = weaponItem || player.equipments[player.weaponMode];
        if (!currentWeapon || !isSwordCategory(currentWeapon.weaponType)) return;
        const sm = player.skills.swordMastery;
        if (!sm || sm.level >= sm.maxLevel) return;
        const rw = sm.expRewards || {};
        let gained = 0;
        gained += hitCount * (rw.hit || 0);
        if (hitCount >= 2) gained += rw.multiHit || 0;
        gained += killCount * (rw.kill || 0);
        this._addSkillExp(player, sm, gained);
    },
    addDashExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const da = player.skills.dashAttack;
        if (!da || da.level >= da.maxLevel) return;
        const rw = da.expRewards || {};
        let gained = 0;
        gained += hitCount * (rw.hit || 0);
        if (hitCount >= 2) gained += rw.multiHit || 0;
        gained += killCount * (rw.kill || 0);
        if (gained <= 0) return;
        SkillLevelSystem.addExp(da, gained, player);
        // 同步 dashAttackThrust 和 dashAttackFire 的等级和经验
        const dt = player.skills.dashAttackThrust;
        if (dt) {
            dt.level = da.level;
            dt.exp = da.exp;
            dt.maxExp = da.maxExp;
        }
        const df = player.skills.dashAttackFire;
        if (df) {
            df.level = da.level;
            df.exp = da.exp;
            df.maxExp = da.maxExp;
        }
        SkillLevelSystem.refreshUI(da.id, 'dashAttackThrust', 'dashAttackFire');
    },
    addDashThrustExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        // dashAttackThrust 共享 dashAttack 的等级和经验
        const da = player.skills.dashAttack;
        const dt = player.skills.dashAttackThrust;
        if (!da || !dt || da.level >= da.maxLevel) return;
        const rw = da.expRewards || {};
        let gained = 0;
        gained += hitCount * (rw.hit || 0);
        if (hitCount >= 2) gained += rw.multiHit || 0;
        gained += killCount * (rw.kill || 0);
        if (gained <= 0) return;
        SkillLevelSystem.addExp(da, gained, player);
        // 同步到 dashAttackThrust 和 dashAttackFire
        dt.level = da.level;
        dt.exp = da.exp;
        dt.maxExp = da.maxExp;
        const df = player.skills.dashAttackFire;
        if (df) {
            df.level = da.level;
            df.exp = da.exp;
            df.maxExp = da.maxExp;
        }
        SkillLevelSystem.refreshUI(da.id, dt.id, 'dashAttackFire');
    },
    addWhirlwindExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const ww = player.skills.whirlwind;
        if (!ww || ww.level >= ww.maxLevel) return;
        const rw = ww.expRewards || {};
        let gained = 0;
        gained += hitCount * (rw.hit || 0);
        if (hitCount >= 2) gained += rw.multiHit || 0;
        gained += killCount * (rw.kill || 0);
        this._addSkillExp(player, ww, gained);
    },
    addPushStrikeExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const ps = player.skills.pushStrike;
        if (!ps || ps.hidden === true || ps.disabled === true || ps.level >= ps.maxLevel) return;
        const rw = ps.expRewards || {};
        let gained = 0;
        gained += hitCount * (rw.hit || 0);
        if (hitCount >= 2) gained += rw.multiHit || 0;
        if (hitCount >= (rw.multiHitThreshold || 5)) gained += rw.multiHitBonus || 0;
        gained += killCount * (rw.kill || 0);
        this._addSkillExp(player, ps, gained);
    },
    onLevelUp(player, skill) {
        const effect = skill.getEffect(skill.level);
        let effectText = '';
        let onShowCallback = null;
        if (skill.id === 'swordMastery') {
            onShowCallback = () => {
                player.data.dex += 1;
                player.calculateCombatStats();
                this.updateMeleeCooldown(player);
            };
            effectText = `剑攻击+${effect.atkBonus}  冷却-${(effect.cooldownReduction * 100).toFixed(0)}%  敏捷+${effect.dexBonus}`;
        } else if (skill.id === 'dashAttack' || skill.id === 'dashAttackThrust' || skill.id === 'dashAttackFire') {
            effectText = `伤害倍率×${effect.damageMul.toFixed(2)}  冷却-${(effect.cooldownReduction * 100).toFixed(0)}%`;
        } else if (skill.id === 'whirlwind') {
            onShowCallback = () => {
                player.data.str += 1;
                player.calculateCombatStats();
            };
            const currentWeapon = player.equipments?.[player.weaponMode] || null;
            effectText = `伤害倍率×${effect.damageMul.toFixed(2)}  力量+${effect.strBonus}  实际范围${getWhirlwindRadius(effect, currentWeapon)}px`;
        } else if (skill.id === 'pushStrike') {
            onShowCallback = () => {
                player.data.str += 1;
                player.calculateCombatStats();
            };
            const pushValues = getPushStrikeValues(skill.level, (Number(player.data.str) || 0) + 1);
            effectText = `伤害${pushValues.damage}  范围${pushValues.radius}px  击退${pushValues.knockback}px  冷却${pushValues.cooldown.toFixed(2)}秒`;
        } else if (skill.id === 'criticalStrike') {
            onShowCallback = () => {
                player.data.luck += 1;
                player.calculateCombatStats();
            };
            effectText = `暴击伤害+${(effect.damageBonus * 100).toFixed(0)}%  幸运+${effect.luckBonus}`;
        } else if (skill.id === 'machineGunMastery') {
            onShowCallback = () => {
                player.data.str += 1;
                player.calculateCombatStats();
            };
            effectText = `机枪伤害+${effect.damageBonus}  伤害+${(effect.damagePercent * 100).toFixed(0)}%  力量+${effect.strBonus}  散布延迟+${effect.spreadDelayBonus}s`;
        } else if (skill.id === 'rifleMastery') {
            onShowCallback = () => {
                player.data.wis += 1;
                player.calculateCombatStats();
            };
            effectText = `步枪伤害+${effect.damageBonus}  伤害+${(effect.damagePercent * 100).toFixed(0)}%  精神+${effect.wisBonus}  暴击率+${effect.critRateBonus}%`;
        } else if (skill.id === 'pistolMastery') {
            onShowCallback = () => {
                player.data.dex += 1;
                player.calculateCombatStats();
            };
            effectText = `手枪伤害+${effect.damageBonus}  伤害+${(effect.damagePercent * 100).toFixed(0)}%  敏捷+${effect.dexBonus}  移速+${(effect.speedPercent * 100).toFixed(0)}%`;
        } else if (skill.id === 'shotgunMastery') {
            onShowCallback = () => {
                player.data.con += 1;
                player.calculateCombatStats();
            };
            effectText = `散弹枪伤害+${(effect.damagePercent * 100).toFixed(0)}%  体质+${effect.conBonus}  击退+${effect.knockbackBonus}px`;
        } else if (skill.id === 'bowMastery') {
            onShowCallback = () => {
                player.data.dex += 1;
                player.calculateCombatStats();
                this.updateBowCooldown(player);
            };
            effectText = `弓攻击+${effect.damageBonus}  伤害+${(effect.damagePercent * 100).toFixed(0)}%  冷却-${(effect.cooldownReduction * 100).toFixed(0)}%  敏捷+${effect.dexBonus}`;
        } else if (skill.id === 'droneSkill') {
            const droneValues = getDroneValues(skill.level);
            effectText = `持续${droneValues.duration}s  易伤+${droneValues.damageBonusPercent}%  暴击率+${droneValues.critBonusPercent}%  侦察${droneValues.visionRadius}px  标记${droneValues.markRadius}px`;
        } else if (skill.id === 'iceSpike') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const baseDamage = effect.damageBase;
            const magicDamage = Math.floor(d.matk * effect.magicMul);
            const intDamage = Math.floor(d.int * effect.intMul);
            const totalDamage = baseDamage + magicDamage + intDamage;
            effectText = `伤害${totalDamage}  冰锥数量${effect.spikeCount}  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'fireball') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const baseDamage = effect.damageBase;
            const magicDamage = Math.floor(d.matk * effect.magicMul);
            const intDamage = Math.floor(d.int * effect.intMul);
            const totalDamage = baseDamage + magicDamage + intDamage;
            effectText = `伤害${totalDamage}  爆炸范围${effect.explosionRadius}px  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'lightningStrike') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const baseDamage = effect.damageBase;
            const magicDamage = Math.floor(d.matk * effect.magicMul);
            const intDamage = Math.floor(d.int * effect.intMul);
            const totalDamage = baseDamage + magicDamage + intDamage;
            effectText = `伤害${totalDamage}  传导${effect.chainTargets}个  眩晕${((effect.stunMs || 750) / 1000).toFixed(2)}秒  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'stormDomain') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const strikeDamage = Math.floor(effect.strikeDamageBase + d.matk * effect.strikeMagicMul + d.int * effect.strikeIntMul);
            effectText = `每雷伤害${strikeDamage}  持续${effect.duration}秒  范围${effect.radius}px  传导${effect.chainExtraTargets}个  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'thunderLance') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const lanceDamage = Math.floor(effect.lanceDamageBase + d.matk * effect.lanceMagicMul + d.int * effect.lanceIntMul);
            effectText = `贯穿伤害${lanceDamage}（满蓄×${effect.chargeBonusMul || 1.3}，随蓄力比例）  射程${effect.maxRange}px  击退${effect.knockback}px  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'holyLight') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10, wis: 0 };
            const totalAmount = effect.healBase + Math.floor(d.matk * effect.magicMul) + Math.floor(d.int * effect.intMul) + Math.floor((d.wis || 0) * effect.wisMul);
            effectText = `圣光${totalAmount}（敌伤/友疗）  僵尸×${effect.zombieDamageMul || 2}  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'sanctuaryDomain') {
            const sd = Game.player ? Game.player.data : { matk: 0, int: 10, wis: 0 };
            const tickDmg = Math.floor(effect.damageBase + sd.matk * effect.damageMagicMul + sd.int * effect.damageIntMul);
            const tickHeal = Math.floor(effect.healBase + (sd.wis || 0) * effect.healWisMul);
            effectText = `每跳伤害${tickDmg}（僵尸×${effect.zombieDamageMul}）  每跳治疗${tickHeal}  持续${effect.duration}秒  范围${effect.radius}px  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'holyJudgment') {
            const jd = Game.player ? Game.player.data : { matk: 0, int: 10, wis: 0 };
            const judgeDmg = Math.floor(effect.damageBase + jd.matk * effect.damageMagicMul + jd.int * effect.damageIntMul + (jd.wis || 0) * effect.damageWisMul);
            const judgeHeal = Math.floor(effect.healBase + (jd.wis || 0) * effect.healWisMul);
            effectText = `审判伤害${judgeDmg}（满蓄，僵尸×${effect.zombieDamageMul}）  治疗${judgeHeal}  半径${effect.radiusMin}→${effect.radiusMax}px  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'iceWall') {
            const d = Game.player ? Game.player.data : { int: 10, wis: 10 };
            const totalDamage = effect.damageBase + Math.floor((d.int || 0) * effect.damageIntMul) + Math.floor((d.wis || 0) * effect.damageWisMul);
            effectText = `伤害${totalDamage}  冰墙段数${effect.segmentCount}  持续${effect.duration}秒  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'blizzard') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const totalDamage = effect.damageBase + Math.floor(d.matk * effect.magicMul) + Math.floor(d.int * effect.intMul);
            effectText = `每跳伤害${totalDamage}  范围${effect.radiusX}px  持续${effect.duration}秒  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'meteor') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const totalDamage = effect.damageBase + Math.floor(d.matk * effect.magicMul) + Math.floor(d.int * effect.intMul);
            effectText = `爆炸伤害${totalDamage}  范围${effect.explosionRadius}px  灼伤${effect.burnStacks}层  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'flameArmor') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const hitBonus = effect.hitDamageBase + Math.floor(d.matk * effect.hitMagicMul) + Math.floor(d.int * effect.hitIntMul);
            const auraBonus = effect.auraDamageBase + Math.floor(d.matk * effect.auraMagicMul) + Math.floor(d.int * effect.auraIntMul);
            effectText = `命中附伤${hitBonus}  光环每跳${auraBonus}  持续${effect.duration}秒  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        }
        // 使用特效队列顺序播放
        LevelUpEffectQueue.add({
            type: 'skillLevelUp',
            level: skill.level,
            icon: skill.icon || '✦',
            iconImage: skill.iconImage || null,
            title: `${skill.name} 升级！Lv.${skill.level}`,
            effectText: effectText,
            onShow: onShowCallback
        });
        // 刷新UI
        const detail2 = getElement('skillDetail');
        const detailOpen2 = detail2 && detail2.style.display !== 'none' && detail2.style.display !== '';
        if (detailOpen2 || (SystemUI.isOpen && SystemUI.currentTab === 'skill')) {
            this.renderSkillGrid();
            if (this._currentDetailSkillId === skill.id) {
                this.renderSkillDetail(skill);
            }
        }
    },
    addCriticalStrikeExp(player, isCrit, isKill) {
        if (!player || !player.skills) return;
        const cs = player.skills.criticalStrike;
        if (!cs || cs.level >= cs.maxLevel) return;
        const rw = cs.expRewards || {};
        let gained = 0;
        if (isCrit) gained += rw.crit || 0;
        if (isCrit && isKill) gained += rw.critKill || 0;
        this._addSkillExp(player, cs, gained);
    },
    addMachineGunMasteryExp(player, isKill, isCrit) {
        if (!player || !player.skills) return;
        const mg = player.skills.machineGunMastery;
        if (!mg || mg.level >= mg.maxLevel) return;
        const rw = mg.expRewards || {};
        let gained = 0;
        if (isKill) gained += rw.kill || 0;
        if (isCrit) gained += rw.crit || 0;
        this._addSkillExp(player, mg, gained);
    },
    addRifleMasteryExp(player, isKill, isCrit) {
        if (!player || !player.skills) return;
        const rm = player.skills.rifleMastery;
        if (!rm || rm.level >= rm.maxLevel) return;
        const rw = rm.expRewards || {};
        let gained = 0;
        if (isKill) gained += rw.kill || 0;
        if (isCrit) gained += rw.crit || 0;
        this._addSkillExp(player, rm, gained);
    },
    addPistolMasteryExp(player, isKill, isCrit) {
        if (!player || !player.skills) return;
        const pm = player.skills.pistolMastery;
        if (!pm || pm.level >= pm.maxLevel) return;
        const rw = pm.expRewards || {};
        let gained = 0;
        if (isKill) gained += rw.kill || 0;
        if (isCrit) gained += rw.crit || 0;
        this._addSkillExp(player, pm, gained);
    },
    addShotgunMasteryExp(player, isKill, isCrit) {
        if (!player || !player.skills) return;
        const sm = player.skills.shotgunMastery;
        if (!sm || sm.level >= sm.maxLevel) return;
        const rw = sm.expRewards || {};
        let gained = 0;
        if (isKill) gained += rw.kill || 0;
        if (isCrit) gained += rw.crit || 0;
        this._addSkillExp(player, sm, gained);
    },
    addBowExp(player, isHit, isCrit, isKill) {
        if (!player || !player.skills) return;
        const bm = player.skills.bowMastery;
        if (!bm || bm.level >= bm.maxLevel) return;
        const rw = bm.expRewards || {};
        let gained = 0;
        if (isHit) gained += rw.hit || 0;
        if (isCrit) gained += rw.crit || 0;
        if (isKill) gained += rw.kill || 0;
        this._addSkillExp(player, bm, gained);
    },
    addDroneExp(player, entity) {
        if (!player || !player.skills) return;
        const ds = player.skills.droneSkill;
        if (!ds || ds.level >= ds.maxLevel) return;
        // 只有击杀被无人机影响的敌人才能获得经验
        if (entity && entity._droneVulnerabilityStacks > 0) {
            const rw = ds.expRewards || {};
            this._addSkillExp(player, ds, rw.kill || 0);
        }
    },
    addIceSpikeExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const sk = player.skills.iceSpike;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        if (hitCount >= 2) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addFireballExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const sk = player.skills.fireball;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        if (hitCount >= 2) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addIceWallExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const sk = player.skills.iceWall;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        if (hitCount >= 2) gained += rw.multiHit || 0;
        this._addSkillExp(player, sk, gained);
    },
    addBlizzardExp(player, hitCount, killCount, multiHit) {
        if (!player || !player.skills) return;
        const sk = player.skills.blizzard;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        if (multiHit) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addMeteorExp(player, hitCount, killCount, multiHit) {
        if (!player || !player.skills) return;
        const sk = player.skills.meteor;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        if (multiHit) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addFlameArmorExp(player, hitCount, killCount, multiHit) {
        if (!player || !player.skills) return;
        const sk = player.skills.flameArmor;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        if (multiHit) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addLightningStrikeExp(player, hitCount, killCount, multiHit) {
        if (!player || !player.skills) return;
        const sk = player.skills.lightningStrike;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        if (multiHit) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addStormDomainExp(player, hitCount, killCount, multiHit) {
        if (!player || !player.skills) return;
        const sk = player.skills.stormDomain;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        if (multiHit) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addThunderLanceExp(player, hitCount, killCount, multiHit) {
        if (!player || !player.skills) return;
        const sk = player.skills.thunderLance;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        if (multiHit) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addHolyLightExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const sk = player.skills.holyLight;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        const gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
        this._addSkillExp(player, sk, gained);
    },
    addSanctuaryDomainExp(player, hitCount, killCount, healCount, multiHit) {
        if (!player || !player.skills) return;
        const sk = player.skills.sanctuaryDomain;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0) + (healCount || 0) * (rw.heal || 0);
        if (multiHit) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addHolyJudgmentExp(player, hitCount, killCount, healCount, multiHit) {
        if (!player || !player.skills) return;
        const sk = player.skills.holyJudgment;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        let gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0) + (healCount || 0) * (rw.heal || 0);
        if (multiHit) gained += rw.multiHit || 0;
        if (killCount >= 2) gained += rw.multiKill || 0;
        this._addSkillExp(player, sk, gained);
    },
    addShieldDefenseExp(player, isMelee, isParry) {
        if (!player || !player.skills) return;
        const sd = player.skills.shieldDefense;
        if (!sd || sd.level >= sd.maxLevel) return;
        const rw = sd.expRewards || {};
        let gained = 0;
        if (isParry) {
            gained += rw.parry || 0;
        } else if (isMelee) {
            gained += rw.meleeBlock || 0;
        } else {
            gained += rw.rangedBlock || 0; // 远程攻击防御
        }
        this._addSkillExp(player, sd, gained);
    },
    updateMeleeCooldown(player) {
        if (!player || !player.skills) return;
        const sm = player.skills.swordMastery;
        const effect = sm.getEffect(sm.level);
        const baseCooldown = 500;
        const reducedCooldown = baseCooldown * (1 - effect.cooldownReduction);
        player.attacks.melee.maxCooldown = Math.max(200, reducedCooldown);
        player.animTimingMul = 1 - effect.cooldownReduction;
    },
    updateBowCooldown(player) {
        if (!player || !player.skills) return;
        const bm = player.skills.bowMastery;
        if (!bm) return;
        const effect = bm.getEffect(bm.level);
        const baseCooldown = 600;
        const reducedCooldown = baseCooldown * (1 - effect.cooldownReduction);
        player.attacks.ranged.maxCooldown = Math.max(200, reducedCooldown);
    },
    _getSkillCategoryPriority(skill) {
        // 默认排序口径（2026-08-02 定稿）：精通类 → 被动类 → 主动类 → 魔法类
        // 精通类按名称识别（剑/弓/机枪/步枪/手枪/散弹枪精通），其余按 tags 归类
        if (!skill || !skill.tags) return 5;
        if (skill.name && skill.name.includes('精通')) return 1;
        if (skill.tags.some(t => t.type === 'passive')) return 2;
        if (skill.tags.some(t => t.type === 'magic')) return 4;
        if (skill.tags.some(t => t.type === 'active')) return 3;
        return 5;
    },
    _sortSkills(skills) {
        return skills.slice().sort((a, b) => {
            const pa = this._getSkillCategoryPriority(a);
            const pb = this._getSkillCategoryPriority(b);
            if (pa !== pb) return pa - pb;
            // 魔法类内部：按魔法等级（初级→中级→高级）→ 系别（火→冰→电→光）→ 名称
            if (pa === 4) {
                const ta = getSkillMagicTier(a.id);
                const tb = getSkillMagicTier(b.id);
                if (ta !== tb) return ta - tb;
                const catOrder = { fire: 1, ice: 2, electric: 3, light: 4 };
                const oa = catOrder[getSkillMagicCategory(a.id)] ?? 9;
                const ob = catOrder[getSkillMagicCategory(b.id)] ?? 9;
                if (oa !== ob) return oa - ob;
            }
            return (a.name || '').localeCompare(b.name || '');
        });
    },
    renderSkillGrid() {
        const grid = getElement('skillGrid');
        if (!grid) return;
        const player = Game.player;
        if (!player || !player.skills) { grid.innerHTML = '<p style="color:#8a7d6b;text-align:center;padding:40px;">技能系统加载中...</p>'; return; }
        grid.innerHTML = '';
        // 渲染筛选按钮
        const filterBar = getElement('skillFilterBar');
        if (filterBar) {
            filterBar.innerHTML = `
                <button class="skill-filter-btn ${this._currentFilter === 'all' ? 'active' : ''}" data-filter="all">全部</button>
                <button class="skill-filter-btn ${this._currentFilter === 'passive' ? 'active' : ''}" data-filter="passive">被动</button>
                <button class="skill-filter-btn ${this._currentFilter === 'active' ? 'active' : ''}" data-filter="active">主动</button>
                <button class="skill-filter-btn ${this._currentFilter === 'magic' ? 'active' : ''}" data-filter="magic">魔法</button>
            `;
            filterBar.querySelectorAll('.skill-filter-btn').forEach(btn => {
                btn.onclick = () => {
                    this._currentFilter = btn.dataset.filter;
                    this.renderSkillGrid();
                };
            });
        }
        // 根据当前装备决定显示 dashAttack 还是 dashAttackThrust 或 dashAttackFire
        const currentWeapon = player.equipments[player.weaponMode];
        const currentOverrides = currentWeapon?.skillOverrides || {};
        const hasFireSkill = !!currentOverrides.dashAttackFire;
        const hasThrustSkill = !!currentOverrides.dashAttackThrust;
        let skillList;
        if (hasFireSkill && player.skills.dashAttackFire) {
            skillList = [player.skills.swordMastery, player.skills.dashAttackFire, player.skills.whirlwind, player.skills.pushStrike, player.skills.criticalStrike, player.skills.machineGunMastery, player.skills.rifleMastery, player.skills.pistolMastery, player.skills.shotgunMastery, player.skills.bowMastery, player.skills.droneSkill, player.skills.iceSpike, player.skills.lightningStrike, player.skills.stormDomain, player.skills.thunderLance, player.skills.holyLight, player.skills.shieldDefense, player.skills.fireball, player.skills.iceWall, player.skills.blizzard, player.skills.meteor, player.skills.flameArmor, player.skills.sanctuaryDomain, player.skills.holyJudgment];
        } else if (hasThrustSkill && player.skills.dashAttackThrust) {
            skillList = [player.skills.swordMastery, player.skills.dashAttackThrust, player.skills.whirlwind, player.skills.pushStrike, player.skills.criticalStrike, player.skills.machineGunMastery, player.skills.rifleMastery, player.skills.pistolMastery, player.skills.shotgunMastery, player.skills.bowMastery, player.skills.droneSkill, player.skills.iceSpike, player.skills.lightningStrike, player.skills.stormDomain, player.skills.thunderLance, player.skills.holyLight, player.skills.shieldDefense, player.skills.fireball, player.skills.iceWall, player.skills.blizzard, player.skills.meteor, player.skills.flameArmor, player.skills.sanctuaryDomain, player.skills.holyJudgment];
        } else {
            skillList = [player.skills.swordMastery, player.skills.dashAttack, player.skills.whirlwind, player.skills.pushStrike, player.skills.criticalStrike, player.skills.machineGunMastery, player.skills.rifleMastery, player.skills.pistolMastery, player.skills.shotgunMastery, player.skills.bowMastery, player.skills.droneSkill, player.skills.iceSpike, player.skills.lightningStrike, player.skills.stormDomain, player.skills.thunderLance, player.skills.holyLight, player.skills.shieldDefense, player.skills.fireball, player.skills.iceWall, player.skills.blizzard, player.skills.meteor, player.skills.flameArmor, player.skills.sanctuaryDomain, player.skills.holyJudgment];
        }
        // 搁置技能保留数据和资产，但不出现在技能网格或进入详情链。
        skillList = skillList.filter(skill => skill && skill.hidden !== true && skill.disabled !== true);
        // 筛选
        if (this._currentFilter !== 'all') {
            skillList = skillList.filter(skill => {
                if (!skill) return false;
                return skill.tags && skill.tags.some(t => t.type === this._currentFilter);
            });
        }
        // 排序
        skillList = this._sortSkills(skillList);
        skillList.forEach(skill => {
            if (!skill) return;
            const card = document.createElement('div');
            card.className = 'skill-card';
            // 两个武器变体共享 dashAttack 的等级和经验，但保留各自效果公式。
            let displaySkill = skill;
            if ((skill.id === 'dashAttackThrust' || skill.id === 'dashAttackFire') && player.skills.dashAttack) {
                displaySkill = player.skills.dashAttack;
            }
            const expPercent = displaySkill.level >= displaySkill.maxLevel ? 100 : Math.min(100, (displaySkill.exp / displaySkill.maxExp) * 100);
            const isActive = skill.tags && skill.tags.some(t => t.type === 'active');
            card.draggable = isActive;
            card.dataset.skillId = skill.id;
            card.innerHTML = `
                <div class="skill-icon">${skill.iconImage ? `<img src="${skill.iconImage}" style="width:48px;height:48px;object-fit:contain;" onerror="this.style.display='none';this.parentElement.textContent='${skill.icon}';">` : skill.icon}</div>
                <div class="skill-name">${skill.name}</div>
                <div class="skill-level">Lv.${displaySkill.level} / ${displaySkill.maxLevel}</div>
                <div class="skill-exp-bar"><div class="skill-exp-fill" style="width:${expPercent}%"></div></div>
            `;
            card.onclick = () => this.renderSkillDetail(skill);
            if (isActive) {
                card.ondragstart = (e) => {
                    e.dataTransfer.setData('text/plain', skill.id);
                    card.classList.add('dragging');
                    // 只拖动图标作为 drag image
                    const icon = card.querySelector('.skill-icon');
                    const dragVisual = icon?.querySelector('img') || icon;
                    if (dragVisual) {
                        e.dataTransfer.setDragImage(dragVisual, dragVisual.offsetWidth / 2, dragVisual.offsetHeight / 2);
                    }
                    TimerManager.setTimeout(() => SystemUI.close(), 50);
                };
                card.ondragend = () => {
                    card.classList.remove('dragging');
                };
            }
            grid.appendChild(card);
        });
    },
    renderSkillDetail(skill) {
        if (!skill || skill.hidden === true || skill.disabled === true) {
            this._currentDetailSkillId = null;
            const shelvedDetail = getElement('skillDetail');
            if (shelvedDetail) shelvedDetail.style.display = 'none';
            this.renderSkillGrid();
            return;
        }
        this._currentDetailSkillId = skill.id;
        const detail = getElement('skillDetail');
        const body = getElement('sdBody');
        if (!detail || !body) return;
        // 武器变体共享 dashAttack 的进度；效果必须读取变体自身 getEffect，不能套用普通冲刺公式。
        let displaySkill = skill;
        if (skill.id === 'dashAttackThrust' || skill.id === 'dashAttackFire') {
            displaySkill = Game.player.skills.dashAttack || skill;
        }
        const effect = skill.getEffect(displaySkill.level);
        const nextEffect = displaySkill.level < displaySkill.maxLevel ? skill.getEffect(displaySkill.level + 1) : null;
        const expPercent = displaySkill.level >= displaySkill.maxLevel ? 100 : Math.min(100, (displaySkill.exp / displaySkill.maxExp) * 100);
        const detailModel = buildSkillDetailModel(skill, displaySkill);
        const title = getElement('sdTitle');
        if (title) title.textContent = `${skill.name} · Lv.${displaySkill.level}`;
        detail.setAttribute('aria-label', `${skill.name}技能详情，可上下滚动`);
        let html = `<section class="sd-overview">
            <div class="sd-overview-icon">${skill.iconImage ? `<img src="${skill.iconImage}" alt="">` : skill.icon}</div>
            <div class="sd-overview-copy"><strong>${skill.name}</strong><p>${skill.description || ''}</p></div>
            <dl class="sd-overview-meta">
                <div><dt>定位</dt><dd>${detailModel.role}</dd></div>
                <div><dt>操作</dt><dd>${detailModel.operation}</dd></div>
                <div><dt>限制</dt><dd>${detailModel.restriction}</dd></div>
            </dl>
        </section>`;
        // 特性词条
        if (skill.tags && skill.tags.length > 0) {
            html += `<div class="sd-tags">`;
            skill.tags.forEach(tag => {
                html += `<span class="sd-tag tag-${tag.type}">${tag.name}</span>`;
            });
            // 魔法分类词条（冰/火/电/光）与魔法等级词条（初级/中级/高级），带分类色
            const catKey = getSkillMagicCategory(skill.id);
            if (catKey && MAGIC_CATEGORY_STYLE[catKey]) {
                const cs = MAGIC_CATEGORY_STYLE[catKey];
                html += `<span class="sd-tag" style="background:${cs.color}22;color:${cs.color};border:1px solid ${cs.color}66;">${cs.name}</span>`;
            }
            if (catKey && MAGIC_TIER_STYLE[getSkillMagicTier(skill.id)]) {
                const ts = MAGIC_TIER_STYLE[getSkillMagicTier(skill.id)];
                html += `<span class="sd-tag" style="background:${ts.color}22;color:${ts.color};border:1px solid ${ts.color}66;">${ts.name}</span>`;
            }
            html += `</div>`;
        }
        // 技能效果区域
        html += `<div class="sd-section"><h4>技能效果</h4>`;
        html += `<div class="sd-stat-row"><span class="sd-stat-name">当前等级</span><span class="sd-stat-val">Lv.${displaySkill.level}</span></div>`;
        if (skill.id === 'swordMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">剑攻击加成</span><span class="sd-stat-val pos">+${effect.atkBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">敏捷加成</span><span class="sd-stat-val pos">+${effect.dexBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">剑类攻击间隔缩短</span><span class="sd-stat-val pos">${(effect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级攻击加成</span><span class="sd-stat-val pos">+${nextEffect.atkBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级敏捷加成</span><span class="sd-stat-val pos">+${nextEffect.dexBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级剑类攻击间隔缩短</span><span class="sd-stat-val pos">${(nextEffect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            }
        } else if (skill.id === 'dashAttack' || skill.id === 'dashAttackThrust' || skill.id === 'dashAttackFire') {
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            if (skill.id === 'dashAttackThrust') {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">第1/2击</span><span class="sd-stat-val pos">= 基础攻击力 × ${effect.damageMul.toFixed(2)} + ${effect.thrustLevelBonusEarly.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">第3击</span><span class="sd-stat-val pos">= 基础攻击力 × ${effect.damageMul.toFixed(2)} + ${effect.thrustLevelBonusLate.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">基础攻击力</span><span class="sd-stat-val pos">= 武器基础攻击 + 属性加成 + 强化加成 + 精通加成</span></div>`;
            } else if (skill.id === 'dashAttackFire') {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= (物理攻击力 + 魔法攻击力) × ${effect.damageMul.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">物理攻击力</span><span class="sd-stat-val pos">= 武器基础攻击 + 属性加成 + 强化加成 + 精通加成</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击力</span><span class="sd-stat-val pos">= 人物面板魔法攻击</span></div>`;
            } else {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= 基础武器攻击力 × ${effect.damageMul.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">基础武器攻击力</span><span class="sd-stat-val pos">= 武器基础攻击 + 属性加成 + 强化加成 + 精通加成</span></div>`;
            }
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却缩减</span><span class="sd-stat-val pos">${(effect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            // 击退距离/触发时间；攻击范围与实际判定同口径（dash-system._checkHit）
            const curWpn = Game.player && Game.player.equipments ? Game.player.equipments[Game.player.weaponMode] : null;
            const baseKnockback = (curWpn && curWpn.attack && curWpn.attack.knockback) || 8;
            const triggerTime = 333 * (1 - (displaySkill.level - 1) * 0.03);
            const craftRangeDelta = (curWpn && curWpn._craftEffects && curWpn._craftEffects.rangeDelta) || 0;
            // 扇形范围：武器攻击范围 + rangeBonusBase + 等级×rangeLevelBonus + rangeBonusFlat
            const baseRange = (curWpn && curWpn.attack && curWpn.attack.range)
                || (Game.player && Game.player.attacks && Game.player.attacks.melee && Game.player.attacks.melee.config && Game.player.attacks.melee.config.range)
                || 206;
            // 突刺判定矩形：hitCheck.length + lengthBonus + 改造距离（武器 skillOverrides 优先）
            const rectLen = (Game.player && typeof Game.player._getSkillParam === 'function')
                ? (Game.player._getSkillParam('dashAttackThrust', 'hitCheck.length', effect.hitLength || 0)
                    + Game.player._getSkillParam('dashAttackThrust', 'hitCheck.lengthBonus', effect.hitLengthBonus || 0))
                : ((effect.hitLength || 0) + (effect.hitLengthBonus || 0));
            const rectW = (Game.player && typeof Game.player._getSkillParam === 'function')
                ? Game.player._getSkillParam('dashAttackThrust', 'hitCheck.width', effect.hitWidth || 0)
                : (effect.hitWidth || 0);
            const thrustDashDist = (Game.player && typeof Game.player._getSkillParam === 'function')
                ? Game.player._getSkillParam('dashAttackThrust', 'animation.dashDist', effect.dashDist || 0)
                : (effect.dashDist || 0);
            const knockbackDist = skill.id === 'dashAttackThrust'
                ? thrustDashDist * (effect.speedMul || 1)
                : baseKnockback + (effect.knockbackBonus || 0) + displaySkill.level * (effect.knockbackLevelBonus || 0);
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退距离</span><span class="sd-stat-val pos">${knockbackDist}px</span></div>`;
            if (skill.id === 'dashAttackThrust') {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">攻击范围（判定长度）</span><span class="sd-stat-val pos">${rectLen + craftRangeDelta}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">判定宽度</span><span class="sd-stat-val pos">${rectW}px</span></div>`;
            } else {
                const attackRange = baseRange + effect.rangeBonusBase + displaySkill.level * effect.rangeLevelBonus + effect.rangeBonusFlat;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">攻击范围</span><span class="sd-stat-val pos">${attackRange}px</span></div>`;
            }
            html += `<div class="sd-stat-row"><span class="sd-stat-name">触发时间</span><span class="sd-stat-val pos">${triggerTime.toFixed(0)}ms</span></div>`;
            if (skill.id === 'dashAttackThrust') {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">判定类型</span><span class="sd-stat-val pos">矩形（持续）</span></div>`;
            } else if (skill.id === 'dashAttackFire') {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">判定类型</span><span class="sd-stat-val pos">扇形（火焰路径）</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">特效</span><span class="sd-stat-val pos">武器路径火焰轨迹</span></div>`;
            }
            if (nextEffect) {
                if (skill.id === 'dashAttackThrust') {
                    html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级第1/2击</span><span class="sd-stat-val pos">×${nextEffect.damageMul.toFixed(2)} + ${nextEffect.thrustLevelBonusEarly.toFixed(2)}</span></div>`;
                    html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级第3击</span><span class="sd-stat-val pos">×${nextEffect.damageMul.toFixed(2)} + ${nextEffect.thrustLevelBonusLate.toFixed(2)}</span></div>`;
                } else {
                    html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级伤害倍率</span><span class="sd-stat-val pos">×${nextEffect.damageMul.toFixed(2)}</span></div>`;
                }
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却缩减</span><span class="sd-stat-val pos">${(nextEffect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
                const nextKnockback = skill.id === 'dashAttackThrust'
                    ? thrustDashDist * (nextEffect.speedMul || 1)
                    : baseKnockback + (nextEffect.knockbackBonus || 0) + (displaySkill.level + 1) * (nextEffect.knockbackLevelBonus || 0);
                const nextTrigger = 333 * (1 - displaySkill.level * 0.03);
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级击退距离</span><span class="sd-stat-val pos">${nextKnockback}px</span></div>`;
                if (skill.id === 'dashAttackThrust') {
                    const nextLen = rectLen + craftRangeDelta; // 突刺长度不随等级变化（lengthBonus=0）
                    html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级攻击范围（判定长度）</span><span class="sd-stat-val pos">${nextLen}px</span></div>`;
                } else {
                    const nextRange = baseRange + nextEffect.rangeBonusBase + (displaySkill.level + 1) * nextEffect.rangeLevelBonus + nextEffect.rangeBonusFlat;
                    html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级攻击范围</span><span class="sd-stat-val pos">${nextRange}px</span></div>`;
                }
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级触发时间</span><span class="sd-stat-val pos">${nextTrigger.toFixed(0)}ms</span></div>`;
                if (skill.id === 'dashAttackThrust') {
                    html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级判定类型</span><span class="sd-stat-val pos">矩形（持续）</span></div>`;
                } else if (skill.id === 'dashAttackFire') {
                    html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级判定类型</span><span class="sd-stat-val pos">扇形（火焰路径）</span></div>`;
                }
            }
        } else if (skill.id === 'whirlwind') {
            const currentWeapon = Game.player?.equipments?.[Game.player.weaponMode] || null;
            const actualRadius = getWhirlwindRadius(effect, currentWeapon);
            const nextRadius = nextEffect ? getWhirlwindRadius(nextEffect, currentWeapon) : 0;
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= 基础武器攻击力 × ${effect.damageMul.toFixed(2)}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础武器攻击力</span><span class="sd-stat-val pos">= 武器基础攻击 + 属性加成 + 强化加成 + 精通加成</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">实际判定范围</span><span class="sd-stat-val pos">${actualRadius}px（含剑类与锻造修正）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">硬直</span><span class="sd-stat-val pos">${(effect.stunDuration / 1000).toFixed(2)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown.toFixed(1)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">体力消耗</span><span class="sd-stat-val pos">${effect.staminaCost}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">力量加成</span><span class="sd-stat-val pos">+${effect.strBonus}</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级伤害倍率</span><span class="sd-stat-val pos">×${nextEffect.damageMul.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级实际范围</span><span class="sd-stat-val pos">${nextRadius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown.toFixed(1)}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级体力消耗</span><span class="sd-stat-val pos">${nextEffect.staminaCost}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级力量加成</span><span class="sd-stat-val pos">+${nextEffect.strBonus}</span></div>`;
            }
        } else if (skill.id === 'pushStrike') {
            const strength = Game.player?.data?.str || 0;
            const pushValues = getPushStrikeValues(displaySkill.level, strength);
            const nextPush = nextEffect ? getPushStrikeValues(displaySkill.level + 1, strength) : null;
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= round(3 + 等级×0.35 + 力量×(0.35 + 等级×0.015))</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前力量</span><span class="sd-stat-val pos">${strength}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前伤害</span><span class="sd-stat-val pos">${pushValues.damage}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">判定</span><span class="sd-stat-val pos">${pushValues.radius}px / 90° / ${pushValues.hitCheckDelay}ms 结算</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退距离</span><span class="sd-stat-val pos">${pushValues.knockback}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${pushValues.cooldown.toFixed(2)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">体力消耗</span><span class="sd-stat-val pos">${pushValues.staminaCost.toFixed(1)}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">硬直时间</span><span class="sd-stat-val pos">${pushValues.stunDuration}ms</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row sd-next-row"><span class="sd-stat-name">下一级伤害</span><span class="sd-stat-val pos">${nextPush.damage}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级判定范围</span><span class="sd-stat-val pos">${nextPush.radius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextPush.cooldown.toFixed(2)}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级体力消耗</span><span class="sd-stat-val pos">${nextPush.staminaCost.toFixed(1)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级硬直</span><span class="sd-stat-val pos">${nextPush.stunDuration}ms</span></div>`;
            }
        } else if (skill.id === 'criticalStrike') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">暴击伤害加成</span><span class="sd-stat-val pos">+${(effect.damageBonus * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">幸运加成</span><span class="sd-stat-val pos">+${effect.luckBonus}</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级暴击伤害加成</span><span class="sd-stat-val pos">+${(nextEffect.damageBonus * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级幸运加成</span><span class="sd-stat-val pos">+${nextEffect.luckBonus}</span></div>`;
            }
        } else if (skill.id === 'machineGunMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">机枪伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">机枪伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">力量加成</span><span class="sd-stat-val pos">+${effect.strBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">散布延迟加成</span><span class="sd-stat-val pos">+${effect.spreadDelayBonus}s</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级机枪伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级机枪伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级力量加成</span><span class="sd-stat-val pos">+${nextEffect.strBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级散布延迟加成</span><span class="sd-stat-val pos">+${nextEffect.spreadDelayBonus}s</span></div>`;
            }
        } else if (skill.id === 'rifleMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">步枪伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">步枪伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">精神加成</span><span class="sd-stat-val pos">+${effect.wisBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">步枪暴击率加成</span><span class="sd-stat-val pos">+${effect.critRateBonus}%</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级步枪伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级步枪伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级精神加成</span><span class="sd-stat-val pos">+${nextEffect.wisBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级步枪暴击率加成</span><span class="sd-stat-val pos">+${nextEffect.critRateBonus}%</span></div>`;
            }
        } else if (skill.id === 'pistolMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">手枪伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">手枪伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">敏捷加成</span><span class="sd-stat-val pos">+${effect.dexBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">手枪移速加成</span><span class="sd-stat-val pos">+${(effect.speedPercent * 100).toFixed(0)}%</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级手枪伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级手枪伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级敏捷加成</span><span class="sd-stat-val pos">+${nextEffect.dexBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级手枪移速加成</span><span class="sd-stat-val pos">+${(nextEffect.speedPercent * 100).toFixed(0)}%</span></div>`;
            }
        } else if (skill.id === 'shotgunMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">散弹枪伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">体质加成</span><span class="sd-stat-val pos">+${effect.conBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退加成</span><span class="sd-stat-val pos">+${effect.knockbackBonus}px</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级散弹枪伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级体质加成</span><span class="sd-stat-val pos">+${nextEffect.conBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级击退加成</span><span class="sd-stat-val pos">+${nextEffect.knockbackBonus}px</span></div>`;
            }
        } else if (skill.id === 'bowMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">弓伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">弓伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">敏捷加成</span><span class="sd-stat-val pos">+${effect.dexBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">弓类攻击间隔缩短</span><span class="sd-stat-val pos">${(effect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级弓伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级弓伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级敏捷加成</span><span class="sd-stat-val pos">+${nextEffect.dexBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级弓类攻击间隔缩短</span><span class="sd-stat-val pos">${(nextEffect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            }
        } else if (skill.id === 'droneSkill') {
            const droneValues = getDroneValues(displaySkill.level);
            const nextDrone = nextEffect ? getDroneValues(displaySkill.level + 1) : null;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">持续时间</span><span class="sd-stat-val pos">${droneValues.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">部署消耗 / 冷却</span><span class="sd-stat-val pos">${droneValues.mpCost} MP / ${droneValues.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonusPercent}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">暴击率加成</span><span class="sd-stat-val pos">+${effect.critBonusPercent}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">移速</span><span class="sd-stat-val pos">${effect.moveSpeed}px/s</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">高空侦察半径</span><span class="sd-stat-val pos">${droneValues.visionRadius}px（忽略遮挡与环境减益）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">易伤标记半径</span><span class="sd-stat-val pos">${droneValues.markRadius}px（离圈残留2秒）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">受益单位</span><span class="sd-stat-val pos">玩家、同伴与全部友军</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">判定间隔</span><span class="sd-stat-val pos">0.25秒</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级持续时间</span><span class="sd-stat-val pos">${nextEffect.duration}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonusPercent}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级暴击率加成</span><span class="sd-stat-val pos">+${nextEffect.critBonusPercent}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级移速</span><span class="sd-stat-val pos">${nextEffect.moveSpeed}px/s</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级侦察半径</span><span class="sd-stat-val pos">${nextDrone.visionRadius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级标记半径</span><span class="sd-stat-val pos">${nextDrone.markRadius}px</span></div>`;
            }
        } else if (skill.id === 'iceSpike') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const baseDamage = effect.damageBase;
            const magicDamage = Math.floor(d.matk * effect.magicMul);
            const intDamage = Math.floor(d.int * effect.intMul);
            const totalDamage = baseDamage + magicDamage + intDamage;
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础伤害</span><span class="sd-stat-val pos">${baseDamage}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击加成</span><span class="sd-stat-val pos">${magicDamage} (魔法攻击×${effect.magicMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${intDamage} (智力×${effect.intMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前总伤害</span><span class="sd-stat-val pos">${totalDamage}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冰锥数量</span><span class="sd-stat-val pos">${effect.spikeCount}个</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">悬浮持续时间</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">飞行速度</span><span class="sd-stat-val pos">${effect.flySpeed}px/s</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">最大射程</span><span class="sd-stat-val pos">${effect.maxRange}px</span></div>`;
            if (nextEffect) {
                const nextBase = nextEffect.damageBase;
                const nextMagic = Math.floor(d.matk * nextEffect.magicMul);
                const nextInt = Math.floor(d.int * nextEffect.intMul);
                const nextTotal = nextBase + nextMagic + nextInt;
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级基础伤害</span><span class="sd-stat-val pos">${nextBase}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法攻击加成</span><span class="sd-stat-val pos">${nextMagic} (魔法攻击×${nextEffect.magicMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级智力加成</span><span class="sd-stat-val pos">${nextInt} (智力×${nextEffect.intMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级总伤害</span><span class="sd-stat-val pos">${nextTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冰锥数量</span><span class="sd-stat-val pos">${nextEffect.spikeCount}个</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法消耗</span><span class="sd-stat-val pos">${nextEffect.mpCost} MP</span></div>`;
            }
        } else if (skill.id === 'blizzard') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const baseDamage = effect.damageBase;
            const magicDamage = Math.floor(d.matk * effect.magicMul);
            const intDamage = Math.floor(d.int * effect.intMul);
            const totalDamage = baseDamage + magicDamage + intDamage;
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础伤害</span><span class="sd-stat-val pos">${baseDamage}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击加成</span><span class="sd-stat-val pos">${magicDamage} (魔法攻击×${effect.magicMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${intDamage} (智力×${effect.intMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">每跳伤害</span><span class="sd-stat-val pos">${totalDamage} / ${(effect.tickMs / 1000).toFixed(1)}秒</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">区域范围</span><span class="sd-stat-val pos">${effect.radiusX}×${effect.radiusY}px（椭圆）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">持续时间</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">寒冷减速</span><span class="sd-stat-val pos">每跳叠1层 / ${(effect.chillSlowPercent * 100).toFixed(1)}%每层</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">最大射程</span><span class="sd-stat-val pos">${effect.maxRange}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextBase = nextEffect.damageBase;
                const nextMagic = Math.floor(d.matk * nextEffect.magicMul);
                const nextInt = Math.floor(d.int * nextEffect.intMul);
                const nextTotal = nextBase + nextMagic + nextInt;
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级基础伤害</span><span class="sd-stat-val pos">${nextBase}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法攻击加成</span><span class="sd-stat-val pos">${nextMagic} (魔法攻击×${nextEffect.magicMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级智力加成</span><span class="sd-stat-val pos">${nextInt} (智力×${nextEffect.intMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级总伤害</span><span class="sd-stat-val pos">${nextTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级范围</span><span class="sd-stat-val pos">${nextEffect.radiusX}×${nextEffect.radiusY}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级持续时间</span><span class="sd-stat-val pos">${nextEffect.duration}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法消耗</span><span class="sd-stat-val pos">${nextEffect.mpCost} MP</span></div>`;
            }
        } else if (skill.id === 'meteor') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const baseDamage = effect.damageBase;
            const magicDamage = Math.floor(d.matk * effect.magicMul);
            const intDamage = Math.floor(d.int * effect.intMul);
            const totalDamage = baseDamage + magicDamage + intDamage;
            const lavaBase = effect.lavaDamageBase;
            const lavaMagic = Math.floor(d.matk * effect.lavaMagicMul);
            const lavaInt = Math.floor(d.int * effect.lavaIntMul);
            const lavaTotal = lavaBase + lavaMagic + lavaInt;
            html += `<div class="sd-section"><h4>🧮 爆炸伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础伤害</span><span class="sd-stat-val pos">${baseDamage}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击加成</span><span class="sd-stat-val pos">${magicDamage} (魔法攻击×${effect.magicMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${intDamage} (智力×${effect.intMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前总伤害</span><span class="sd-stat-val pos">${totalDamage}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>🔥 熔岩灼烧（每跳）</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">每跳伤害</span><span class="sd-stat-val pos">${lavaTotal} / ${(effect.lavaTickMs / 1000).toFixed(1)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">每跳灼伤</span><span class="sd-stat-val pos">+${effect.lavaBurnStacks}层（魔法攻击×${effect.lavaBurnDamageMul.toFixed(2)}/层）</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">爆炸范围</span><span class="sd-stat-val pos">${effect.explosionRadius}px（中心全额，边缘衰减）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">爆炸灼伤</span><span class="sd-stat-val pos">+${effect.burnStacks}层（魔法攻击×${effect.burnDamageMul.toFixed(2)}/层）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退距离</span><span class="sd-stat-val pos">${effect.knockback}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">熔岩范围</span><span class="sd-stat-val pos">${effect.lavaRadius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">熔岩持续</span><span class="sd-stat-val pos">${effect.lavaDuration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">最大射程</span><span class="sd-stat-val pos">${effect.maxRange}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextBase = nextEffect.damageBase;
                const nextMagic = Math.floor(d.matk * nextEffect.magicMul);
                const nextInt = Math.floor(d.int * nextEffect.intMul);
                const nextTotal = nextBase + nextMagic + nextInt;
                const nextLavaTotal = nextEffect.lavaDamageBase + Math.floor(d.matk * nextEffect.lavaMagicMul) + Math.floor(d.int * nextEffect.lavaIntMul);
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级爆炸伤害</span><span class="sd-stat-val pos">${nextTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级爆炸范围</span><span class="sd-stat-val pos">${nextEffect.explosionRadius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级熔岩每跳</span><span class="sd-stat-val pos">${nextLavaTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级熔岩范围/持续</span><span class="sd-stat-val pos">${nextEffect.lavaRadius}px / ${nextEffect.lavaDuration}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法消耗</span><span class="sd-stat-val pos">${nextEffect.mpCost} MP</span></div>`;
            }
            html += `</div>`;
        } else if (skill.id === 'flameArmor') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const hitBase = effect.hitDamageBase;
            const hitMagic = Math.floor(d.matk * effect.hitMagicMul);
            const hitInt = Math.floor(d.int * effect.hitIntMul);
            const hitTotal = hitBase + hitMagic + hitInt;
            const auraBase = effect.auraDamageBase;
            const auraMagic = Math.floor(d.matk * effect.auraMagicMul);
            const auraInt = Math.floor(d.int * effect.auraIntMul);
            const auraTotal = auraBase + auraMagic + auraInt;
            html += `<div class="sd-section"><h4>🧮 命中附伤公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础附伤</span><span class="sd-stat-val pos">${hitBase}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击加成</span><span class="sd-stat-val pos">${hitMagic} (魔法攻击×${effect.hitMagicMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${hitInt} (智力×${effect.hitIntMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">每次攻击附伤</span><span class="sd-stat-val pos">${hitTotal}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>🔥 灼烧光环（每跳）</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">每跳伤害</span><span class="sd-stat-val pos">${auraTotal} / ${(effect.auraTickMs / 1000).toFixed(1)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">灼烧范围</span><span class="sd-stat-val pos">${effect.auraRadius}px</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">Buff 持续</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">生效方式</span><span class="sd-stat-val pos">除魔法技能外的攻击命中附带魔法伤害+火花；武器上浮火焰粒子</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextHit = nextEffect.hitDamageBase + Math.floor(d.matk * nextEffect.hitMagicMul) + Math.floor(d.int * nextEffect.hitIntMul);
                const nextAura = nextEffect.auraDamageBase + Math.floor(d.matk * nextEffect.auraMagicMul) + Math.floor(d.int * nextEffect.auraIntMul);
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级附伤</span><span class="sd-stat-val pos">${nextHit}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级光环每跳</span><span class="sd-stat-val pos">${nextAura}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级范围</span><span class="sd-stat-val pos">${nextEffect.auraRadius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级持续</span><span class="sd-stat-val pos">${nextEffect.duration}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
            }
            html += `</div>`;
        } else if (skill.id === 'shieldDefense') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前副手持盾时总物防加成</span><span class="sd-stat-val pos">+${(effect.defBonusPercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">格挡承伤比例扣减</span><span class="sd-stat-val pos">${(effect.damageReductionBonus * 100).toFixed(0)}个百分点</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">弹反眩晕加成</span><span class="sd-stat-val pos">+${effect.parryStunBonus.toFixed(2)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">反制规则</span><span class="sd-stat-val pos">远程弹反不眩晕；近战弹反触发反制硬直</span></div>`;
            const shield = Game.player?.shieldSystem?.getShieldData();
            if (shield) {
                const values = getShieldDefenseValues(shield, effect);
                html += `<div class="sd-stat-row"><span class="sd-stat-name">当前盾格挡承伤</span><span class="sd-stat-val">${(values.remainingDamageRatio * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">弹反时窗 / 方向范围</span><span class="sd-stat-val">${values.parryWindow / 1000}秒 / 左右各${values.parryHalfAngle}°</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">格挡体力 / 破防眩晕</span><span class="sd-stat-val">${values.staminaCost} / ${values.stunOnExhaustion / 1000}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">近战弹反总眩晕</span><span class="sd-stat-val">${values.parryStun / 1000}秒</span></div>`;
            } else {
                html += `<p class="sd-note">当前武器组副手未装备盾牌，持盾加成与格挡均未生效。</p>`;
            }
            html += `<p class="sd-note">普通格挡保留全方向减伤；弹反按鼠标世界方向判断。格挡承伤比例 = max(5%, 盾牌基础承伤比例 − 技能扣减)，在物防/魔防结算后相乘。举盾移速减半且不回体力，成功弹反免伤且不耗体力；远程只抵消本次命中，不反射弹体。</p>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级当前副手持盾时总物防加成</span><span class="sd-stat-val pos">+${(nextEffect.defBonusPercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级格挡承伤比例扣减</span><span class="sd-stat-val pos">${(nextEffect.damageReductionBonus * 100).toFixed(0)}个百分点</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级弹反眩晕加成</span><span class="sd-stat-val pos">+${nextEffect.parryStunBonus.toFixed(2)}秒</span></div>`;
            }
        } else if (skill.id === 'fireball') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const baseDamage = effect.damageBase;
            const magicDamage = Math.floor(d.matk * effect.magicMul);
            const intDamage = Math.floor(d.int * effect.intMul);
            const totalDamage = baseDamage + magicDamage + intDamage;
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础伤害</span><span class="sd-stat-val pos">${baseDamage}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击加成</span><span class="sd-stat-val pos">${magicDamage} (魔法攻击×${effect.magicMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${intDamage} (智力×${effect.intMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前总伤害</span><span class="sd-stat-val pos">${totalDamage}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">爆炸范围</span><span class="sd-stat-val pos">${effect.explosionRadius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">悬浮持续时间</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">飞行速度</span><span class="sd-stat-val pos">${effect.flySpeed}px/s</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">最大射程</span><span class="sd-stat-val pos">${effect.maxRange}px</span></div>`;
            if (nextEffect) {
                const nextBase = nextEffect.damageBase;
                const nextMagic = Math.floor(d.matk * nextEffect.magicMul);
                const nextInt = Math.floor(d.int * nextEffect.intMul);
                const nextTotal = nextBase + nextMagic + nextInt;
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级基础伤害</span><span class="sd-stat-val pos">${nextBase}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法攻击加成</span><span class="sd-stat-val pos">${nextMagic} (魔法攻击×${nextEffect.magicMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级智力加成</span><span class="sd-stat-val pos">${nextInt} (智力×${nextEffect.intMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级总伤害</span><span class="sd-stat-val pos">${nextTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级爆炸范围</span><span class="sd-stat-val pos">${nextEffect.explosionRadius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法消耗</span><span class="sd-stat-val pos">${nextEffect.mpCost} MP</span></div>`;
            }
        } else if (skill.id === 'lightningStrike') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const baseDamage = effect.damageBase;
            const magicDamage = Math.floor(d.matk * effect.magicMul);
            const intDamage = Math.floor(d.int * effect.intMul);
            const totalDamage = baseDamage + magicDamage + intDamage;
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础伤害</span><span class="sd-stat-val pos">${baseDamage}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击加成</span><span class="sd-stat-val pos">${magicDamage} (魔法攻击×${effect.magicMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${intDamage} (智力×${effect.intMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前总伤害</span><span class="sd-stat-val pos">${totalDamage}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">锁定方式</span><span class="sd-stat-val pos">鼠标指向处最近敌方单位</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">瞄准范围</span><span class="sd-stat-val pos">${effect.aimRadius || 200}px（附近无目标不可释放）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">最大射程</span><span class="sd-stat-val pos">${effect.maxRange}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">传导范围</span><span class="sd-stat-val pos">${effect.chainRange}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">传导目标</span><span class="sd-stat-val pos">${effect.chainTargets}个（每5级+1）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">每跳衰减</span><span class="sd-stat-val pos">${(effect.chainDecay * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">命中眩晕</span><span class="sd-stat-val pos">${((effect.stunMs || 750) / 1000).toFixed(2)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">感电</span><span class="sd-stat-val pos">命中+${effect.electrifyStacks || 1}层（叠满5层过载）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">闪电持续</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">消失耗时</span><span class="sd-stat-val pos">${(effect.fadeMs || 250) / 1000}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextBase = nextEffect.damageBase;
                const nextMagic = Math.floor(d.matk * nextEffect.magicMul);
                const nextInt = Math.floor(d.int * nextEffect.intMul);
                const nextTotal = nextBase + nextMagic + nextInt;
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级基础伤害</span><span class="sd-stat-val pos">${nextBase}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法攻击加成</span><span class="sd-stat-val pos">${nextMagic} (魔法攻击×${nextEffect.magicMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级智力加成</span><span class="sd-stat-val pos">${nextInt} (智力×${nextEffect.intMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级总伤害</span><span class="sd-stat-val pos">${nextTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级传导目标</span><span class="sd-stat-val pos">${nextEffect.chainTargets}个</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级眩晕</span><span class="sd-stat-val pos">${((nextEffect.stunMs || 750) / 1000).toFixed(2)}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
            }
            html += `</div>`;
        } else if (skill.id === 'stormDomain') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const strikeBase = effect.strikeDamageBase;
            const strikeMagic = Math.floor(d.matk * effect.strikeMagicMul);
            const strikeInt = Math.floor(d.int * effect.strikeIntMul);
            const strikeTotal = strikeBase + strikeMagic + strikeInt;
            html += `<div class="sd-section"><h4>🧮 每雷伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础伤害</span><span class="sd-stat-val pos">${strikeBase}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击加成</span><span class="sd-stat-val pos">${strikeMagic} (魔法攻击×${effect.strikeMagicMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${strikeInt} (智力×${effect.strikeIntMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前每雷总伤害</span><span class="sd-stat-val pos">${strikeTotal}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">形态</span><span class="sd-stat-val pos">头顶雷云跟随自己，自动落雷</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">持续</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">落雷间隔</span><span class="sd-stat-val pos">${(effect.strikeIntervalMs / 1000).toFixed(1)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">雷云半径</span><span class="sd-stat-val pos">${effect.radius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">传导目标</span><span class="sd-stat-val pos">${effect.chainExtraTargets}个（每10级+1）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">命中眩晕</span><span class="sd-stat-val pos">${((effect.stunMs || 250) / 1000).toFixed(2)}秒（打断）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">感电</span><span class="sd-stat-val pos">命中+${effect.electrifyStacks}层（叠满5层过载）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法等级</span><span class="sd-stat-val pos">中级魔法（需装备法杖）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextBase = nextEffect.strikeDamageBase;
                const nextMagic = Math.floor(d.matk * nextEffect.strikeMagicMul);
                const nextInt = Math.floor(d.int * nextEffect.strikeIntMul);
                const nextTotal = nextBase + nextMagic + nextInt;
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级每雷总伤害</span><span class="sd-stat-val pos">${nextTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级持续</span><span class="sd-stat-val pos">${nextEffect.duration}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级雷云半径</span><span class="sd-stat-val pos">${nextEffect.radius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
            }
            html += `</div>`;
        } else if (skill.id === 'thunderLance') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const lanceBase = effect.lanceDamageBase;
            const lanceMagic = Math.floor(d.matk * effect.lanceMagicMul);
            const lanceInt = Math.floor(d.int * effect.lanceIntMul);
            const lanceTotal = lanceBase + lanceMagic + lanceInt;
            html += `<div class="sd-section"><h4>🧮 贯穿伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础伤害</span><span class="sd-stat-val pos">${lanceBase}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击加成</span><span class="sd-stat-val pos">${lanceMagic} (魔法攻击×${effect.lanceMagicMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${lanceInt} (智力×${effect.lanceIntMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前贯穿总伤害</span><span class="sd-stat-val pos">${lanceTotal}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">形态</span><span class="sd-stat-val pos">蓄力后电磁炮直线光束（railgun）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">蓄力方式</span><span class="sd-stat-val pos">长按快捷键蓄力，瞄准随鼠标移动；松开或蓄满 ${((effect.delayMs || 2500) / 1000).toFixed(1)}秒 释放</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">贯穿射程</span><span class="sd-stat-val pos">${effect.maxRange}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">贯穿判定</span><span class="sd-stat-val pos">鼠标方向锥形内全部敌人（按距离）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">命中击退</span><span class="sd-stat-val pos">沿光束方向击退 ${effect.knockback}px（50→150px 随等级）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">蓄力伤害</span><span class="sd-stat-val pos">蓄力 0.5~2.5 秒按时间比例 20%~100%（满蓄 ×${effect.chargeBonusMul || 1.3}）；不足 0.5 秒释放失败且不进入冷却</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">感电增伤</span><span class="sd-stat-val pos">目标每层感电 +${Math.round((effect.electrifyDamagePerStack || 0.1) * 100)}% 伤害</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">终点电爆</span><span class="sd-stat-val pos">射程尽头/撞墙处爆炸 + 感电地面（2秒）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">感电</span><span class="sd-stat-val pos">命中+${effect.electrifyStacks}层（叠满5层过载）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法等级</span><span class="sd-stat-val pos">高级魔法（需装备法杖）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextBase = nextEffect.lanceDamageBase;
                const nextMagic = Math.floor(d.matk * nextEffect.lanceMagicMul);
                const nextInt = Math.floor(d.int * nextEffect.lanceIntMul);
                const nextTotal = nextBase + nextMagic + nextInt;
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级贯穿总伤害</span><span class="sd-stat-val pos">${nextTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级射程</span><span class="sd-stat-val pos">${nextEffect.maxRange}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
            }
            html += `</div>`;
        } else if (skill.id === 'holyLight') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10, wis: 0 };
            const baseAmount = effect.healBase;
            const magicAmount = Math.floor(d.matk * effect.magicMul);
            const intAmount = Math.floor(d.int * effect.intMul);
            const wisAmount = Math.floor((d.wis || 0) * effect.wisMul);
            const totalAmount = baseAmount + magicAmount + intAmount + wisAmount;
            html += `<div class="sd-section"><h4>🧮 回复/伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础值</span><span class="sd-stat-val pos">${baseAmount}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击加成</span><span class="sd-stat-val pos">${magicAmount} (魔法攻击×${effect.magicMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${intAmount} (智力×${effect.intMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">精神加成</span><span class="sd-stat-val pos">${wisAmount} (精神×${effect.wisMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前总量</span><span class="sd-stat-val pos">${totalAmount}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">目标效果</span><span class="sd-stat-val pos">敌方伤害 / 友方回复生命</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">僵尸类伤害</span><span class="sd-stat-val pos">×${effect.zombieDamageMul || 2}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">锁定方式</span><span class="sd-stat-val pos">鼠标指向处最近目标</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">自释放</span><span class="sd-stat-val pos">Alt+快捷键 直接对自己释放</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">瞄准范围</span><span class="sd-stat-val pos">${effect.aimRadius || 200}px（附近无目标不可释放）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">最大射程</span><span class="sd-stat-val pos">${effect.maxRange}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">光束持续</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">消失耗时</span><span class="sd-stat-val pos">${(effect.fadeMs || 400) / 1000}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒（每5级-1秒）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextBase = nextEffect.healBase;
                const nextMagic = Math.floor(d.matk * nextEffect.magicMul);
                const nextInt = Math.floor(d.int * nextEffect.intMul);
                const nextWis = Math.floor((d.wis || 0) * nextEffect.wisMul);
                const nextTotal = nextBase + nextMagic + nextInt + nextWis;
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级基础值</span><span class="sd-stat-val pos">${nextBase}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法攻击加成</span><span class="sd-stat-val pos">${nextMagic} (魔法攻击×${nextEffect.magicMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级智力加成</span><span class="sd-stat-val pos">${nextInt} (智力×${nextEffect.intMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级精神加成</span><span class="sd-stat-val pos">${nextWis} (精神×${nextEffect.wisMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级总量</span><span class="sd-stat-val pos">${nextTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
            }
            html += `</div>`;
        } else if (skill.id === 'sanctuaryDomain') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10, wis: 0 };
            const tickDmg = Math.floor(effect.damageBase + d.matk * effect.damageMagicMul + d.int * effect.damageIntMul);
            const tickHeal = Math.floor(effect.healBase + (d.wis || 0) * effect.healWisMul);
            html += `<div class="sd-section"><h4>🧮 每跳公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">每跳伤害</span><span class="sd-stat-val pos">${tickDmg}（基础${effect.damageBase} + 魔攻×${effect.damageMagicMul.toFixed(2)} + 智力×${effect.damageIntMul.toFixed(2)}）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">每跳治疗</span><span class="sd-stat-val pos">${tickHeal}（基础${effect.healBase} + 精神×${effect.healWisMul.toFixed(2)}）</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">形态</span><span class="sd-stat-val pos">圣辉环以自身为中心，跟随移动</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">持续</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">半径</span><span class="sd-stat-val pos">${effect.radius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">僵尸类伤害</span><span class="sd-stat-val pos">×${effect.zombieDamageMul}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">净化</span><span class="sd-stat-val pos">每${(effect.cleanseIntervalMs / 1000).toFixed(0)}秒为领域内友军移除 1 个负面状态</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法等级</span><span class="sd-stat-val pos">中级魔法（需装备法杖）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextDmg = Math.floor(nextEffect.damageBase + d.matk * nextEffect.damageMagicMul + d.int * nextEffect.damageIntMul);
                const nextHeal = Math.floor(nextEffect.healBase + (d.wis || 0) * nextEffect.healWisMul);
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(255,210,122,0.2);padding-top:8px;"><span class="sd-stat-name">下一级每跳伤害/治疗</span><span class="sd-stat-val pos">${nextDmg} / ${nextHeal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级持续</span><span class="sd-stat-val pos">${nextEffect.duration}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级半径</span><span class="sd-stat-val pos">${nextEffect.radius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
            }
            html += `</div>`;
        } else if (skill.id === 'holyJudgment') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10, wis: 0 };
            const judgeDmg = Math.floor(effect.damageBase + d.matk * effect.damageMagicMul + d.int * effect.damageIntMul + (d.wis || 0) * effect.damageWisMul);
            const judgeHeal = Math.floor(effect.healBase + (d.wis || 0) * effect.healWisMul);
            html += `<div class="sd-section"><h4>🧮 审判公式（满蓄）</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">审判伤害</span><span class="sd-stat-val pos">${judgeDmg}（基础${effect.damageBase} + 魔攻×${effect.damageMagicMul.toFixed(2)} + 智力×${effect.damageIntMul.toFixed(2)} + 精神×${effect.damageWisMul.toFixed(2)}）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">治疗</span><span class="sd-stat-val pos">${judgeHeal}（基础${effect.healBase} + 精神×${effect.healWisMul.toFixed(2)}）</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">形态</span><span class="sd-stat-val pos">蓄力后目标点降下巨型圣柱</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">蓄力方式</span><span class="sd-stat-val pos">长按快捷键蓄力，目标点随鼠标移动；松开或蓄满 ${((effect.delayMs || 2500) / 1000).toFixed(1)}秒 落柱</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">蓄力效果</span><span class="sd-stat-val pos">蓄力 0.5~2.5 秒按时间比例 30%~100%；不足 0.5 秒释放失败且不进入冷却</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">审判半径</span><span class="sd-stat-val pos">${effect.radiusMin}→${effect.radiusMax}px（随蓄力）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">选点射程</span><span class="sd-stat-val pos">${effect.maxRange}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">僵尸类伤害</span><span class="sd-stat-val pos">×${effect.zombieDamageMul}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">净化斩杀</span><span class="sd-stat-val pos">非 Boss 不死单位血量 ≤ ${(effect.purifyThreshold * 100).toFixed(1)}% 直接净化即死</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">友方效果</span><span class="sd-stat-val pos">范围内大额回血 + 立即清除全部负面状态</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">自释放</span><span class="sd-stat-val pos">Alt+快捷键 落点锁定自身脚下</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法等级</span><span class="sd-stat-val pos">高级魔法（需装备法杖）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextDmg = Math.floor(nextEffect.damageBase + d.matk * nextEffect.damageMagicMul + d.int * nextEffect.damageIntMul + (d.wis || 0) * nextEffect.damageWisMul);
                const nextHeal = Math.floor(nextEffect.healBase + (d.wis || 0) * nextEffect.healWisMul);
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(255,210,122,0.2);padding-top:8px;"><span class="sd-stat-name">下一级审判伤害/治疗</span><span class="sd-stat-val pos">${nextDmg} / ${nextHeal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级净化斩杀线</span><span class="sd-stat-val pos">${(nextEffect.purifyThreshold * 100).toFixed(1)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
            }
            html += `</div>`;
        } else if (skill.id === 'iceWall') {
            const d = Game.player ? Game.player.data : { int: 10, wis: 10 };
            const baseDamage = effect.damageBase;
            const intDamage = Math.floor((d.int || 0) * effect.damageIntMul);
            const wisDamage = Math.floor((d.wis || 0) * effect.damageWisMul);
            const totalDamage = baseDamage + intDamage + wisDamage;
            html += `<div class="sd-section"><h4>🧮 伤害公式（物理）</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础伤害</span><span class="sd-stat-val pos">${baseDamage}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">智力加成</span><span class="sd-stat-val pos">${intDamage} (智力×${effect.damageIntMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">精神加成</span><span class="sd-stat-val pos">${wisDamage} (精神×${effect.damageWisMul.toFixed(2)})</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前总伤害</span><span class="sd-stat-val pos">${totalDamage}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法等级</span><span class="sd-stat-val pos">中级魔法（需装备法杖）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冰墙段数</span><span class="sd-stat-val pos">${effect.segmentCount}（每级两端各+1段）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">墙体朝向</span><span class="sd-stat-val pos">垂直于施法方向，阻挡移动与投射物</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">生成延迟</span><span class="sd-stat-val pos">${((effect.spawnDelayMs || 0) / 1000).toFixed(1)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">命中击退</span><span class="sd-stat-val pos">${effect.hitKnockback}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">寒冷光环</span><span class="sd-stat-val pos">${effect.chillRadius}px 范围每${((effect.chillIntervalMs || 1000) / 1000).toFixed(0)}秒 ${effect.chillStacks}层</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">持续时间</span><span class="sd-stat-val pos">${effect.duration}秒（每级+0.5秒）</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">最大射程</span><span class="sd-stat-val pos">${effect.maxRange}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法消耗</span><span class="sd-stat-val pos">${effect.mpCost} MP</span></div>`;
            if (nextEffect) {
                const nextBase = nextEffect.damageBase;
                const nextInt = Math.floor((d.int || 0) * nextEffect.damageIntMul);
                const nextWis = Math.floor((d.wis || 0) * nextEffect.damageWisMul);
                const nextTotal = nextBase + nextInt + nextWis;
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级基础伤害</span><span class="sd-stat-val pos">${nextBase}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级智力加成</span><span class="sd-stat-val pos">${nextInt} (智力×${nextEffect.damageIntMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级精神加成</span><span class="sd-stat-val pos">${nextWis} (精神×${nextEffect.damageWisMul.toFixed(2)})</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级总伤害</span><span class="sd-stat-val pos">${nextTotal}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冰墙段数</span><span class="sd-stat-val pos">${nextEffect.segmentCount}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级持续时间</span><span class="sd-stat-val pos">${nextEffect.duration}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级魔法消耗</span><span class="sd-stat-val pos">${nextEffect.mpCost} MP</span></div>`;
            }
            html += `</div>`;
        }
        if (!nextEffect) {
            html += `<div class="sd-stat-row" style="margin-top:8px;color:#7a9a6a;">已达到最高等级</div>`;
        }
        html += `</div>`;
        // 升级进度
        html += `<div class="sd-section"><h4>升级进度</h4>`;
        html += `<div class="sd-exp-track"><div class="sd-exp-bar"><div class="sd-exp-fill" style="width:${expPercent}%"></div></div><span class="sd-exp-text">${displaySkill.exp}/${displaySkill.maxExp}</span></div>`;
        html += `<p style="margin-top:8px;color:#a0a0a0;font-size:12px;">${displaySkill.level >= displaySkill.maxLevel ? '已满级' : `还需 ${displaySkill.maxExp - displaySkill.exp} 点经验升级`}</p>`;
        html += `</div>`;
        // 升级方式
        html += `<div class="sd-section"><h4>升级方式</h4>`;
        if (skill.id === 'swordMastery') {
            html += `<p>• 每次击中敌人积累 1 点经验（多敌人=多倍）</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 10 点经验</p>`;
        } else if (skill.id === 'dashAttack') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：长按Shift冲刺超过0.75秒后，使用近战武器左键攻击</p>`;
        } else if (skill.id === 'dashAttackThrust') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：装备骑士长剑时，长按Shift冲刺超过0.75秒后，使用近战武器左键攻击</p>`;
        } else if (skill.id === 'dashAttackFire') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：装备夜与火之剑时，长按Shift冲刺超过0.75秒后，使用近战武器左键攻击</p>`;
        } else if (skill.id === 'whirlwind') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：按快捷键触发技能，需装备近战武器且消耗体力</p>`;
        } else if (skill.id === 'pushStrike') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 同时攻击到五个以上敌人时，额外获得 10 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p class="sd-note">触发条件：按快捷键发动，当前必须装备双手长枪；手枪、弓、近战与空手不可用。</p>`;
        } else if (skill.id === 'criticalStrike') {
            html += `<p>• 造成暴击时积累 1 点经验</p>`;
            html += `<p>• 暴击击杀敌人时增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：绑定所有暴击效果，暴击时自动触发</p>`;
        } else if (skill.id === 'machineGunMastery') {
            html += `<p>• 使用机枪击杀敌人增加 10 点经验</p>`;
            html += `<p>• 使用机枪暴击增加 5 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备机枪时自动生效</p>`;
        } else if (skill.id === 'rifleMastery') {
            html += `<p>• 使用步枪击杀敌人增加 10 点经验</p>`;
            html += `<p>• 使用步枪暴击增加 5 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备步枪时自动生效</p>`;
        } else if (skill.id === 'pistolMastery') {
            html += `<p>• 使用手枪击杀敌人增加 10 点经验</p>`;
            html += `<p>• 使用手枪暴击增加 5 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备手枪时自动生效</p>`;
        } else if (skill.id === 'shotgunMastery') {
            html += `<p>• 使用散弹枪击杀敌人增加 10 点经验</p>`;
            html += `<p>• 使用散弹枪暴击增加 5 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备散弹枪时自动生效</p>`;
        } else if (skill.id === 'bowMastery') {
            html += `<p>• 每次用弓击中敌人积累 1 点经验</p>`;
            html += `<p>• 用弓暴击时增加 5 点经验</p>`;
            html += `<p>• 击杀目标时增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备弓时自动生效</p>`;
        } else if (skill.id === 'droneSkill') {
            html += `<p>• 击杀被无人机影响的敌人增加 15 点经验</p>`;
            html += `<p class="sd-note">主动技能：短按部署/接管/退出控制，长按发送航点；只有成功部署扣蓝并进入冷却。</p>`;
        } else if (skill.id === 'iceSpike') {
            html += `<p>• 使用冰锥攻击到一个目标加 4 点经验</p>`;
            html += `<p>• 同时命中 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 一次击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 使用冰锥杀死一个目标加 12 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">主动技能：按快捷键生成冰锥，再次按同一键发射所有冰锥</p>`;
        } else if (skill.id === 'fireball') {
            html += `<p>• 使用火球攻击到一个目标加 4 点经验</p>`;
            html += `<p>• 同时命中 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 一次击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 使用火球杀死一个目标加 12 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">主动技能：按快捷键在身前凝聚火球，再次按同一键发射火球</p>`;
        } else if (skill.id === 'lightningStrike') {
            html += `<p>• 闪电击中一个目标增加 4 点经验</p>`;
            html += `<p>• 同时攻击到 2 个及以上目标时，额外获得 10 点经验</p>`;
            html += `<p>• 一次击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 击杀目标增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">主动技能：拖入快捷栏后按 Q/E 释放，锁定鼠标指向处最近的敌方单位</p>`;
        } else if (skill.id === 'stormDomain') {
            html += `<p>• 雷暴领域每击中一个目标增加 1 点经验</p>`;
            html += `<p>• 单次落雷命中 2 个及以上目标，额外获得 5 点经验</p>`;
            html += `<p>• 一次击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 雷暴领域击杀一个目标增加 6 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">中级魔法：需装备法杖才能释放。拖入快捷栏后按 Q/E 释放，头顶雷云跟随自己持续落雷</p>`;
        } else if (skill.id === 'thunderLance') {
            html += `<p>• 贯穿雷枪每击中一个目标增加 2 点经验</p>`;
            html += `<p>• 单次贯穿命中 2 个及以上目标，额外获得 8 点经验</p>`;
            html += `<p>• 一次击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 贯穿雷枪击杀一个目标增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">高级魔法：需装备法杖才能释放。拖入快捷栏后按住 Q/E 蓄力（瞄准随鼠标），松开或蓄满 2.5 秒后沿鼠标方向射出电磁炮直线光束，蓄力 0.5~2.5 秒按时间比例造成 20%~100% 伤害，不足 0.5 秒释放失败且不进入冷却</p>`;
        } else if (skill.id === 'holyLight') {
            html += `<p>• 圣光命中一个目标增加 5 点经验</p>`;
            html += `<p>• 击杀目标增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">主动技能：拖入快捷栏后按 Q/E 释放（Alt+快捷键直接对自己释放），敌方=伤害（僵尸翻倍）、友方=回复生命</p>`;
        } else if (skill.id === 'sanctuaryDomain') {
            html += `<p>• 圣辉领域每击中一个目标增加 1 点经验</p>`;
            html += `<p>• 每跳治疗一个友军增加 1 点经验</p>`;
            html += `<p>• 单跳命中 2 个及以上目标，额外获得 5 点经验</p>`;
            html += `<p>• 一次击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 圣辉领域击杀一个目标增加 6 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">中级魔法：需装备法杖才能释放。拖入快捷栏后按 Q/E 释放，圣辉环跟随自己：友军持续回血+净化负面，敌方持续受光系伤害（僵尸 2.5 倍）</p>`;
        } else if (skill.id === 'holyJudgment') {
            html += `<p>• 圣光审判每击中一个目标增加 2 点经验</p>`;
            html += `<p>• 每治疗一个友军增加 1 点经验</p>`;
            html += `<p>• 单次命中 2 个及以上目标，额外获得 8 点经验</p>`;
            html += `<p>• 一次击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 圣光审判击杀一个目标增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">高级魔法：需装备法杖才能释放。拖入快捷栏后按住 Q/E 蓄力（目标点随鼠标，Alt+快捷键落点锁定自身），松开或蓄满 2.5 秒落柱：敌方光系伤害（僵尸 3 倍）+ 低血不死净化即死，友方大额回血+清除全部负面</p>`;
        } else if (skill.id === 'iceWall') {
            html += `<p>• 冰墙命中一个目标增加 3 点经验</p>`;
            html += `<p>• 同时命中 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 冰墙击杀一个目标增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">中级魔法：需装备法杖才能释放。拖入快捷栏后按 Q/E 释放，0.5秒延迟后在鼠标指向处生成一列垂直于施法方向的冰墙，阻挡移动与投射物，落点单位受物理伤害并被击退</p>`;
        } else if (skill.id === 'blizzard') {
            html += `<p>• 暴风雪每跳命中一个目标增加 1 点经验（每 0.5 秒一跳，整次施法累计）</p>`;
            html += `<p>• 单跳同时命中 2 个及以上目标，额外获得 5 点经验</p>`;
            html += `<p>• 一次施法击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 暴风雪击杀一个目标增加 6 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">高级魔法：需装备法杖才能释放。拖入快捷栏后按 Q/E 释放，在鼠标指向处召唤暴风雪，椭圆区域内每 0.5 秒造成魔法伤害并叠加一层寒冷减速，随等级提升伤害、持续时间与范围</p>`;
        } else if (skill.id === 'meteor') {
            html += `<p>• 陨星爆炸命中一个目标增加 2 点经验</p>`;
            html += `<p>• 熔岩区域每跳命中一个目标增加 2 点经验（每 0.5 秒一跳，整次施法累计）</p>`;
            html += `<p>• 单跳同时命中 2 个及以上目标，额外获得 8 点经验</p>`;
            html += `<p>• 一次施法击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 陨星击杀一个目标增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">高级魔法：需装备法杖才能释放。拖入快捷栏后按 Q/E 释放，在鼠标指向处召唤陨星坠落：预警后陨星砸落造成大范围爆炸（击退+灼伤），随后留下熔岩区域持续灼烧敌人</p>`;
        } else if (skill.id === 'flameArmor') {
            html += `<p>• 命中附伤与光环每跳命中一个目标各增加 1 点经验（整次 Buff 累计）</p>`;
            html += `<p>• 光环单跳同时命中 2 个及以上目标，额外获得 5 点经验</p>`;
            html += `<p>• 一次 Buff 期间击杀 2 个及以上目标，额外获得 10 点经验</p>`;
            html += `<p>• 灼锋焰甲击杀一个目标增加 8 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">初级魔法：拖入快捷栏后按 Q/E 释放，为自己添加灼锋焰甲 Buff——非魔法攻击命中附带魔法伤害+火花，灼烧光环每 0.5 秒灼烧周围敌人，武器持续上浮火焰粒子</p>`;
        } else if (skill.id === 'shieldDefense') {
            const rewards = skill.expRewards || {};
            html += `<p>• 成功格挡近战攻击加 ${rewards.meleeBlock ?? 0} 点经验</p>`;
            html += `<p>• 成功格挡远程攻击加 ${rewards.rangedBlock ?? 0} 点经验</p>`;
            html += `<p>• 成功弹反加 ${rewards.parry ?? 0} 点经验（不叠加格挡经验）</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">当前副手持盾时获得物防加成；右键举盾才启用格挡与弹反。体力不足的破防命中不增加修炼经验。</p>`;
        }
        html += `</div>`;
        body.innerHTML = html;
        // 统一模型的下一级比较：运行时 DOM 自动剔除与当前值相同的条目。
        const rows = [...body.querySelectorAll('.sd-stat-row')];
        for (const row of rows) {
            const name = row.querySelector('.sd-stat-name')?.textContent?.trim() || '';
            if (!name.startsWith('下一级')) continue;
            const currentName = name.replace(/^下一级/, '');
            const current = rows.find(candidate => candidate !== row
                && candidate.querySelector('.sd-stat-name')?.textContent?.trim() === currentName);
            if (current && current.querySelector('.sd-stat-val')?.textContent?.trim()
                === row.querySelector('.sd-stat-val')?.textContent?.trim()) row.remove();
        }
        detail.scrollTop = 0;
        detail.style.display = 'flex';
        detail.focus({ preventScroll: true });
        const backBtn = getElement('sdBackBtn');
        if (backBtn) {
            backBtn.onclick = () => {
                detail.style.display = 'none';
                this._currentDetailSkillId = null;
                this.renderSkillGrid();
            };
        }
    }
};
