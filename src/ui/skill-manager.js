import { Game } from '../game.js';
import { LevelUpEffectQueue } from '../effects/level-up-queue.js';
import { SkillLevelSystem } from '../combat/skill-level-system.js';
import { isSwordCategory } from '../config/gun-ammo.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { SystemUI } from './system-ui.js';
import {
    getSkillMagicCategory,
    getSkillMagicTier,
    MAGIC_CATEGORY_STYLE,
    MAGIC_TIER_STYLE,
} from '../config/magic-categories.js';
export const SkillManager = {
    _currentDetailSkillId: null, // 追踪当前打开的技能详情ID
    _currentFilter: 'all', // 当前筛选条件：all|passive|active|magic
    _addSkillExp(player, skill, gained) {
        if (!skill || skill.level >= skill.maxLevel || gained <= 0) return;
        SkillLevelSystem.addExp(skill, gained, player);
        SkillLevelSystem.refreshUI(skill.id);
    },
    addMeleeExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        // 检查当前武器是否为剑类（剑精通只对剑类武器生效）
        const currentWeapon = player.equipments[player.weaponMode];
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
        if (!ps || ps.level >= ps.maxLevel) return;
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
            effectText = `伤害倍率×${effect.damageMul.toFixed(2)}  力量+${effect.strBonus}  范围${effect.radius}px`;
        } else if (skill.id === 'pushStrike') {
            onShowCallback = () => {
                player.data.str += 1;
                player.calculateCombatStats();
            };
            const curDamage = Math.round(player.data.str * effect.damageMul);
            effectText = `伤害${curDamage}  范围${effect.radius}px  击退${effect.knockback}px  冷却${effect.cooldown.toFixed(1)}秒`;
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
            effectText = `持续时间+${effect.duration}s  伤害加成+${effect.damageBonusPercent}%  暴击率+${effect.critBonusPercent}%  移速${effect.moveSpeed}px/s  范围${effect.radius}px`;
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
        } else if (skill.id === 'holyLight') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10, wis: 0 };
            const totalAmount = effect.healBase + Math.floor(d.matk * effect.magicMul) + Math.floor(d.int * effect.intMul) + Math.floor((d.wis || 0) * effect.wisMul);
            effectText = `圣光${totalAmount}（敌伤/友疗）  僵尸×${effect.zombieDamageMul || 2}  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'iceWall') {
            const d = Game.player ? Game.player.data : { int: 10, wis: 10 };
            const totalDamage = effect.damageBase + Math.floor((d.int || 0) * effect.damageIntMul) + Math.floor((d.wis || 0) * effect.damageWisMul);
            effectText = `伤害${totalDamage}  冰墙段数${effect.segmentCount}  持续${effect.duration}秒  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
        } else if (skill.id === 'blizzard') {
            const d = Game.player ? Game.player.data : { matk: 0, int: 10 };
            const totalDamage = effect.damageBase + Math.floor(d.matk * effect.magicMul) + Math.floor(d.int * effect.intMul);
            effectText = `每跳伤害${totalDamage}  范围${effect.radiusX}px  持续${effect.duration}秒  冷却${effect.cooldown}秒  魔法消耗${effect.mpCost}MP`;
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
    addHolyLightExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const sk = player.skills.holyLight;
        if (!sk || sk.level >= sk.maxLevel) return;
        const rw = sk.expRewards || {};
        const gained = hitCount * (rw.hit || 0) + killCount * (rw.kill || 0);
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
        if (skill.tags.some(t => t.type === 'active')) return 3;
        if (skill.tags.some(t => t.type === 'magic')) return 4;
        return 5;
    },
    _sortSkills(skills) {
        return skills.slice().sort((a, b) => {
            const pa = this._getSkillCategoryPriority(a);
            const pb = this._getSkillCategoryPriority(b);
            if (pa !== pb) return pa - pb;
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
        const hasFireSkill = (player._skillOverrides && player._skillOverrides.dashAttackFire) || (currentWeapon && currentWeapon.skillOverrides && currentWeapon.skillOverrides.dashAttackFire);
        const hasThrustSkill = (player._skillOverrides && player._skillOverrides.dashAttackThrust) || (currentWeapon && currentWeapon.skillOverrides && currentWeapon.skillOverrides.dashAttackThrust);
        let skillList;
        if (hasFireSkill && player.skills.dashAttackFire) {
            skillList = [player.skills.swordMastery, player.skills.dashAttackFire, player.skills.whirlwind, player.skills.pushStrike, player.skills.criticalStrike, player.skills.machineGunMastery, player.skills.rifleMastery, player.skills.pistolMastery, player.skills.shotgunMastery, player.skills.bowMastery, player.skills.droneSkill, player.skills.iceSpike, player.skills.lightningStrike, player.skills.holyLight, player.skills.shieldDefense, player.skills.fireball, player.skills.iceWall, player.skills.blizzard];
        } else if (hasThrustSkill && player.skills.dashAttackThrust) {
            skillList = [player.skills.swordMastery, player.skills.dashAttackThrust, player.skills.whirlwind, player.skills.pushStrike, player.skills.criticalStrike, player.skills.machineGunMastery, player.skills.rifleMastery, player.skills.pistolMastery, player.skills.shotgunMastery, player.skills.bowMastery, player.skills.droneSkill, player.skills.iceSpike, player.skills.lightningStrike, player.skills.holyLight, player.skills.shieldDefense, player.skills.fireball, player.skills.iceWall, player.skills.blizzard];
        } else {
            skillList = [player.skills.swordMastery, player.skills.dashAttack, player.skills.whirlwind, player.skills.pushStrike, player.skills.criticalStrike, player.skills.machineGunMastery, player.skills.rifleMastery, player.skills.pistolMastery, player.skills.shotgunMastery, player.skills.bowMastery, player.skills.droneSkill, player.skills.iceSpike, player.skills.lightningStrike, player.skills.holyLight, player.skills.shieldDefense, player.skills.fireball, player.skills.iceWall, player.skills.blizzard];
        }
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
            // dashAttackThrust 显示 dashAttack 的等级和经验
            let displaySkill = skill;
            if (skill.id === 'dashAttackThrust' && player.skills.dashAttack) {
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
                    if (icon) {
                        e.dataTransfer.setDragImage(icon, icon.offsetWidth / 2, icon.offsetHeight / 2);
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
        this._currentDetailSkillId = skill.id;
        const detail = getElement('skillDetail');
        const body = getElement('sdBody');
        if (!detail || !body) return;
        // dashAttackThrust 共享 dashAttack 的等级和效果
        let displaySkill = skill;
        if (skill.id === 'dashAttackThrust') {
            displaySkill = Game.player.skills.dashAttack || skill;
        }
        const effect = displaySkill.getEffect(displaySkill.level);
        const nextEffect = displaySkill.level < displaySkill.maxLevel ? displaySkill.getEffect(displaySkill.level + 1) : null;
        const expPercent = displaySkill.level >= displaySkill.maxLevel ? 100 : Math.min(100, (displaySkill.exp / displaySkill.maxExp) * 100);
        let html = '';
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
                html += `<div class="sd-stat-row"><span class="sd-stat-name">第1/2击</span><span class="sd-stat-val pos">= 基础攻击力 × 0.80 + 技能等级 × 0.05</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">第3击</span><span class="sd-stat-val pos">= 基础攻击力 × 0.90 + 技能等级 × 0.10</span></div>`;
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
            const baseKnockback = 8; // 默认武器击退
            const knockbackDist = baseKnockback + 150 + displaySkill.level * 5;
            const triggerTime = 333 * (1 - (displaySkill.level - 1) * 0.03);
            const curWpn = Game.player && Game.player.equipments ? Game.player.equipments[Game.player.weaponMode] : null;
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
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级伤害倍率</span><span class="sd-stat-val pos">×${nextEffect.damageMul.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却缩减</span><span class="sd-stat-val pos">${(nextEffect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
                const nextKnockback = baseKnockback + 150 + (displaySkill.level + 1) * 5;
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
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= 基础武器攻击力 × ${effect.damageMul.toFixed(2)}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础武器攻击力</span><span class="sd-stat-val pos">= 武器基础攻击 + 属性加成 + 强化加成 + 精通加成</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">判定范围</span><span class="sd-stat-val pos">${effect.radius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退距离</span><span class="sd-stat-val pos">${effect.knockback}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown.toFixed(1)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">体力消耗</span><span class="sd-stat-val pos">${effect.staminaCost}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">力量加成</span><span class="sd-stat-val pos">+${effect.strBonus}</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级伤害倍率</span><span class="sd-stat-val pos">×${nextEffect.damageMul.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级判定范围</span><span class="sd-stat-val pos">${nextEffect.radius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown.toFixed(1)}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级体力消耗</span><span class="sd-stat-val pos">${nextEffect.staminaCost}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级力量加成</span><span class="sd-stat-val pos">+${nextEffect.strBonus}</span></div>`;
            }
        } else if (skill.id === 'pushStrike') {
            const curDamage = Game.player ? Math.round(Game.player.data.str * effect.damageMul) : Math.round(10 * effect.damageMul);
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= 力量 × ${effect.damageMul.toFixed(2)}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前力量</span><span class="sd-stat-val pos">${Game.player ? Game.player.data.str : 10}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前伤害</span><span class="sd-stat-val pos">${curDamage}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">判定范围</span><span class="sd-stat-val pos">${effect.radius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退距离</span><span class="sd-stat-val pos">${effect.knockback}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown.toFixed(1)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">体力消耗</span><span class="sd-stat-val pos">${effect.staminaCost}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">眩晕时间</span><span class="sd-stat-val pos">1.5秒</span></div>`;
            if (nextEffect) {
                const nextDamage = Game.player ? Math.round(Game.player.data.str * nextEffect.damageMul) : Math.round(10 * nextEffect.damageMul);
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级伤害</span><span class="sd-stat-val pos">${nextDamage}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级判定范围</span><span class="sd-stat-val pos">${nextEffect.radius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown.toFixed(1)}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级体力消耗</span><span class="sd-stat-val pos">${nextEffect.staminaCost}</span></div>`;
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
            html += `<div class="sd-stat-row"><span class="sd-stat-name">持续时间</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonusPercent}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">暴击率加成</span><span class="sd-stat-val pos">+${effect.critBonusPercent}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">移速</span><span class="sd-stat-val pos">${effect.moveSpeed}px/s</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">影响范围</span><span class="sd-stat-val pos">${effect.radius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">判定间隔</span><span class="sd-stat-val pos">0.25秒</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级持续时间</span><span class="sd-stat-val pos">${nextEffect.duration}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonusPercent}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级暴击率加成</span><span class="sd-stat-val pos">+${nextEffect.critBonusPercent}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级移速</span><span class="sd-stat-val pos">${nextEffect.moveSpeed}px/s</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级范围</span><span class="sd-stat-val pos">${nextEffect.radius}px</span></div>`;
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
        } else if (skill.id === 'shieldDefense') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">装备盾牌防御力加成</span><span class="sd-stat-val pos">+${(effect.defBonusPercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">防御减伤加成</span><span class="sd-stat-val pos">+${(effect.damageReductionBonus * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">弹反眩晕加成</span><span class="sd-stat-val pos">+${effect.parryStunBonus.toFixed(2)}秒</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级防御力加成</span><span class="sd-stat-val pos">+${(nextEffect.defBonusPercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级减伤加成</span><span class="sd-stat-val pos">+${(nextEffect.damageReductionBonus * 100).toFixed(0)}%</span></div>`;
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
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退距离</span><span class="sd-stat-val pos">${effect.knockback}px</span></div>`;
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
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级击退</span><span class="sd-stat-val pos">${nextEffect.knockback}px</span></div>`;
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
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：按快捷键触发技能，需装备远程武器（手枪/机枪/步枪/弓）且消耗体力</p>`;
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
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">主动技能：按快捷键释放/操控/回收无人机</p>`;
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
        } else if (skill.id === 'holyLight') {
            html += `<p>• 圣光命中一个目标增加 5 点经验</p>`;
            html += `<p>• 击杀目标增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">主动技能：拖入快捷栏后按 Q/E 释放（Alt+快捷键直接对自己释放），敌方=伤害（僵尸翻倍）、友方=回复生命</p>`;
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
        } else if (skill.id === 'shieldDefense') {
            html += `<p>• 防御敌人近战攻击加 2 点经验</p>`;
            html += `<p>• 防御敌人远程攻击加 5 点经验</p>`;
            html += `<p>• 成功弹反敌人加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备盾牌时自动生效</p>`;
        }
        html += `</div>`;
        body.innerHTML = html;
        detail.style.display = 'block';
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
