import { DataLoader } from '../../systems/data-loader.js';
import { isPlayerRunVisual, nowMs } from './anim-state.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { WEAPON_ANIM } from '../../config/math-utils.js';

import { Renderer } from '../../world/renderer.js';
import { WallSystem } from '../../world/wall-system.js';
import { SceneManager } from '../../world/scene-manager.js';
import { Camera } from '../../world/camera.js';
import { Input } from '../../ui/input.js';
import { StatusBar } from '../../ui/status-bar.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { LevelUpEffectQueue } from '../../effects/level-up-queue.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { ProjectileFactory } from '../../utils/projectile-factory.js';
import { createWeaponRicochetHandler } from '../../combat/weapon-ricochet.js';
import { createLegendaryLmgHitHandler } from '../../combat/weapon-legendary-lmg.js';
import { createVoidFuneralHitHandler, prepareMythicShotgunBlast } from '../../combat/mythic-shotgun.js';
import { createLegendaryShotgunHitHandler, prepareLegendaryShotgunBlast } from '../../combat/legendary-shotgun.js';
import { prepareMythicHandCannonShot } from '../../combat/mythic-hand-cannon.js';
import { createLegendaryPistolHitHandler } from '../../combat/legendary-pistol.js';
import { loadImage } from '../../utils/image-loader.js';
import { isGunWeapon, isTwoHanded, isRifle, getAmmoConfig, getEquipSound, getFireSound, resolveGunAttackInterval } from '../../config/gun-ammo.js';
import { AUTO_GUN_FAMILY } from '../../config/weapon-families.js';
import { WeaponAnimConfig, getWeaponStateConfig } from '../../items/weapon-anim-config.js';
import { WEAPON_FX_CONFIG } from '../../config/weapon-fx-config.js';
import { Easing } from '../../config/math-utils.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { GunFeel } from '../../effects/gunfeel.js';
import { canMeleeShareSurface } from '../../combat/melee-surface.js';
import { applyOutgoingDamageModifiers } from '../../combat/outgoing-damage-modifiers.js';
import { getElement } from '../../utils/dom-utils.js';
import { TimerManager } from '../../utils/timer-manager.js';
import { CONFIG } from '../../config/config.js';
import { QuestState } from '../../ui/quest-system.js';
import { SkillManager } from '../../ui/skill-manager.js';
import { QuickBar } from '../../ui/quick-bar.js';
import { GameUIManager } from '../../ui/game-ui-manager.js';
import { SystemUI } from '../../ui/system-ui.js';
import { findWeaponConfig } from '../../ui/equip-data-manager.js';
import { getDroneValues, getPushStrikeValues } from '../../config/skill-formulas.js';

// 默认技能经验公式与辅助函数（应用全局技能经验倍率）
const DEFAULT_SKILL_EXP_FORMULA = '100 + (level - 1) * 100';
function getDefaultSkillMaxExp() {
    return DataLoader.parseSkillExpFormula(DEFAULT_SKILL_EXP_FORMULA, 1);
}
function getDefaultSkillExpForNext(level) {
    return DataLoader.parseSkillExpFormula(DEFAULT_SKILL_EXP_FORMULA, level);
}
import { DungeonMapSystem } from '../../world/dungeon-map-system.js';
import { getTributeReviveRatio, getTributeExpMultiplier, syncTributeBuffs, getTributeMonsterAtkDownMul, getSurviveCapRatio } from '../../config/tribute-effects.js';

const subsystemsMixin = {
gainExp(amount, expTag = null) {
                if (amount <= 0) return;
                // 天山雪莲特效：本次地牢经验获取加成
                amount = Math.floor(amount * getTributeExpMultiplier());
                if (amount <= 0) return;
                const d = this.data;
                d.exp += amount;
                // 显示获得经验浮动文字（衰减灰/越级绿/连战紫标注，机制可见化）
                const expColor = expTag === 'decay' ? '#b0a080' : (expTag === 'underdog' ? '#7ee787' : (expTag === 'streak' ? '#c9a0ff' : '#ffd700'));
                const expSuffix = expTag === 'decay' ? '（衰减）' : (expTag === 'underdog' ? '（越级）' : (expTag === 'streak' ? '（连战）' : ''));
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, `+${amount} EXP${expSuffix}`, expColor));
                // 检查升级（支持溢出连续升级）
                while (d.exp >= d.maxExp) {
                    d.exp -= d.maxExp;
                    d.level++;
                    d.maxExp = this.getExpForLevel(d.level);
                    d.attrPoints += 2;
                    // 升级时回复满生命值和魔法值
                    this.updateMaxStats();
                    d.hp = d.maxHp;
                    d.mp = d.maxMp;
                    this.onLevelUp(d.level);
                }
                // 同步更新经验值UI（底部经验条）
                if (GameUIManager && GameUIManager.updateUI) {
                    GameUIManager.updateUI();
                }
            },

onLevelUp(level) {
                // 使用特效队列顺序播放
                LevelUpEffectQueue.add({
                    type: 'playerLevelUp',
                    level: level,
                    icon: '⭐',
                    title: `等级提升！Lv.${level}`,
                    effectText: '获得2点属性点',
                    onShow: () => {
                        // 更新战斗属性
                        this.calculateCombatStats();
                        // 更新最大生命/魔法值
                        this.updateMaxStats();
                        // 如果面板正在打开，同步刷新UI
                        if (SystemUI.isOpen && SystemUI.currentTab === 'status') {
                            GameUIManager.updateUI();
                        }
                    }
                });
            },

takeDamage(damage, source, damageType = 'physical', isMelee = false) {
                // 结果只属于本次受击，不能沿用上一次弹反状态。
                if (this.shieldSystem) this.shieldSystem._lastParried = false;
                // 近战最终保险：跨 ground/stairs/wall_walk 平面的直伤、弹反和附带状态全部拒绝。
                if (isMelee && source && !canMeleeShareSurface(source, this)) return 0;
                // 闪避无敌期间不受伤害
                if (this.dodgeInvincible) return;
                // 月影庇护：无敌时间内不受伤害
                if (this._moonshadowTimer > 0) return;
                // 已死亡不处理
                if (this._isDead) return;
                // 伤害值安全校验，防止 undefined/NaN 导致 HP 异常
                let finalDamage = Number(damage);
                if (!Number.isFinite(finalDamage) || finalDamage < 0) {
                    console.warn('[Player.takeDamage] 非法伤害值:', damage);
                    finalDamage = 0;
                }
                const d = this.data;
                const critRate = (source && source.data && source.data.crit) || 0;
                const critRes = (d && d.critRes) || 0;
                // 附魔效果：暴击率加成
                let enchantCritBonus = 0;
                if (source && source.equipments) {
                    const weapon = source.equipments[source.weaponMode];
                    if (weapon && weapon._enchantEffects && weapon._enchantEffects.critRate) {
                        enchantCritBonus = weapon._enchantEffects.critRate * 100; // 转换为百分比
                    }
                }
                const finalCritRate = Math.max(0, critRate + enchantCritBonus - critRes);
                const isCrit = typeof source?._forcedHitCritical === 'boolean'
                    ? source._forcedHitCritical
                    : Math.random() * 100 < finalCritRate;
                // 应用暴击伤害加成
                // 次级格挡：装备宽十字护手时，受到近战攻击有50%概率减少50%伤害
                if (isMelee && this.equipments && this.weaponMode) {
                    const currentWpn = this.equipments[this.weaponMode];
                    if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.secondaryBlock) {
                        if (Math.random() < 0.5) {
                            finalDamage = Math.floor(finalDamage * 0.5);
                        }
                    }
                }
                if (isCrit && source && source.skills && source.skills.criticalStrike) {
                    const csEffect = source.skills.criticalStrike.getEffect(source.skills.criticalStrike.level);
                    finalDamage = Math.floor(finalDamage * (1 + csEffect.damageBonus));
                }
                // 盾防御系统处理（主神空间也允许弹反测试，因此放在无敌判定之前）
                if (this.shieldSystem && this.shieldSystem.active && this.shieldSystem.defending) {
                    const result = this.shieldSystem.onDamageTaken(finalDamage, source, isMelee);
                    finalDamage = result.damage;
                    if (result.parried) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 20, '🛡️ 弹反！', '#c0a060'));
                        return 0;
                    }
                }
                // 无敌开关（左下「无敌」按钮）：全场景生效（含地牢）
                if (SceneManager._mainHubInvincible) return;
                // 应用无人机易伤：受到的所有伤害增加
                if (this._droneVulnerabilityStacks > 0) {
                    let droneBonus = 0.10 * this._droneVulnerabilityStacks;
                    if (source && source.skills && source.skills.droneSkill) {
                        const effect = source.skills.droneSkill.getEffect(source.skills.droneSkill.level);
                        droneBonus = ((effect.damageBonusPercent || 10) / 100) * this._droneVulnerabilityStacks;
                    }
                    finalDamage = Math.floor(finalDamage * (1 + droneBonus));
                }
                // 祭品效果（数据驱动）：怪物攻击削减
                if (source && source._faction === 'enemy') {
                    finalDamage = Math.floor(finalDamage * getTributeMonsterAtkDownMul());
                }
                finalDamage = applyOutgoingDamageModifiers(finalDamage, source);
                // 金刚石「金刚不坏」：单次伤害不超过最大生命值的配置比例
                const surviveCap = getSurviveCapRatio();
                if (surviveCap > 0 && this.data) {
                    const cap = Math.max(1, Math.floor(this.data.maxHp * surviveCap));
                    if (finalDamage > cap) finalDamage = cap;
                }
                d.hp -= finalDamage;
                if (Number.isNaN(d.hp)) {
                    console.error('[Player.takeDamage] HP 异常，已重置为 0', { finalDamage, previousHp: d.hp });
                    d.hp = 0;
                }
                this.hitFlash = this.hitFlashDuration;
                if (finalDamage > 0) {
                    const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
                    if (scene && typeof scene.playPlayerHitAttachedFx === 'function') {
                        scene.playPlayerHitAttachedFx(this, source, damageType);
                    }
                }
                EffectManager.createDamageText(this.x, this.y - this.size, finalDamage, isCrit, {
                    target: this,
                    source,
                    damageType,
                    isMelee,
                });
                if (isCrit) EffectManager.triggerCritEffects();
                const isKill = d.hp <= 0;
                if (isKill) { d.hp = 0; this.onDeath(); }
                // 暴击技能经验
                if (isCrit && source && SkillManager) {
                    SkillManager.addCriticalStrikeExp(source, isCrit, isKill);
                }
            },

applyDroneVulnerability(_stacks) {
                this._droneVulnerabilityStacks = 1; // 固定1层，不再叠加
                this._droneVulnerabilityTimer = 999999; // [FIX] 设极大值，永不过期，由外部范围判定控制移除
                if (StatusBar) {
                    this._droneVulnerabilityEffectId = StatusBar.addEffect('droneVulnerability', 999999);
                }
            },

removeDroneVulnerability() {
                this._droneVulnerabilityStacks = 0;
                this._droneVulnerabilityTimer = 0;
                if (this._droneVulnerabilityEffectId && StatusBar) {
                    StatusBar.removeEffect(this._droneVulnerabilityEffectId);
                    this._droneVulnerabilityEffectId = null;
                }
            },

onDeath() {
                this.shieldSystem?.exitDefense();
                this._isDead = true;
                this._deathTimer = 3000; // 3秒后重生
                // 蟠桃续命跟随全场景献祭状态；只有重新献祭/覆盖为蟠桃才刷新使用次数。
                const dungeonTributeMode = DungeonMapSystem?.active === true;
                const reviveUsed = this._worldPeachReviveUsed;
                if (!reviveUsed && getTributeReviveRatio() > 0) {
                    this._worldPeachReviveUsed = true;
                    this._peachRevivePending = true;
                    if (dungeonTributeMode) syncTributeBuffs(this);
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - 60, '🍑 蟠桃续命生效：3秒后原地复活', '#e8a06a'));
                }
                // 显示死亡提示
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '你死了！3秒后重生', '#ff4444'));
                // 蟠桃会在原地续命；只有真正走常规重生时才判任务失败，避免清掉会话后困在任务实例。
                if (QuestState && QuestState.isInQuest() && !this._peachRevivePending) {
                    QuestState.reset();
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - 60, '任务失败，请重新与侍从对话', '#ff4444'));
                }
                // 死亡不掉落经验或装备（预留接口）
                if (typeof this._onDeathDrop === 'function') {
                    this._onDeathDrop();
                }
            },

// 蟠桃续命：原地复活（不清地牢、不传送），以配置的复活比例生命站起
_reviveInPlace() {
                this._isDead = false;
                this._deathTimer = 0;
                const d = this.data;
                const ratio = getTributeReviveRatio() || 0.3;
                d.hp = Math.max(1, Math.floor(d.maxHp * ratio));
                d.stamina = d.maxStamina;
                // 清关键临时状态（与 respawn 同口径，但保留地牢进程）
                this._poisonStacks = 0;
                this._poisonTimer = 0;
                this._poisonTickTimer = 0;
                this.clearCorrosion?.();
                this.isStunned = false;
                this.stunTimer = 0;
                this._overheatActive = false;
                this._overheatValue = 0;
                this._overheatOverheated = false;
                this._overheatStates = {};
                this._isPushStrike = false;
                this._specialAttackActive = false;
                this._specialAttackTimer = 0;
                this._isDashing = false;
                this._dashSkillId = null;
                this._dashWeaponItem = null;
                this._dashSkillOverrides = null;
                this._isWhirlwind = false;
                this._whirlwindRecovering = false;
                this._whirlwindRecoverTimer = 0;
                this._whirlwindRecoverDuration = 0;
                // 还原闪避标记（死亡打断闪避时 hittable/noCollision 可能仍挂着）
                this._endDodge();
                this.vx = 0;
                this.vy = 0;
                if (this.droneSystem && this.droneSystem.controlling) {
                    this.droneSystem._exitControl();
                }
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '🍑 原地复活！', '#e8a06a'));
            },

respawn() {
                this._isDead = false;
                this._deathTimer = 0;
                const d = this.data;
                d.hp = d.maxHp;
                d.mp = d.maxMp;
                d.stamina = d.maxStamina;
                this._isDashing = false;
                this._dashSkillId = null;
                this._dashWeaponItem = null;
                this._dashSkillOverrides = null;
                // 清除所有状态效果
                this._poisonStacks = 0;
                this._poisonTimer = 0;
                this._poisonTickTimer = 0;
                this.clearCorrosion?.();
                if (this._poisonEffectId && StatusBar) {
                    StatusBar.removeEffect(this._poisonEffectId);
                    this._poisonEffectId = null;
                }
                // 清除眩晕状态
                this._dashStunned = false;
                this._dashStunTimer = 0;
                // 还原闪避标记（死亡打断闪避时 hittable/noCollision 可能仍挂着）
                this._endDodge();
                // 清除过热状态
                this._overheatActive = false;
                this._overheatValue = 0;
                this._overheatOverheated = false;
                this._overheatRecoverTimer = 0;
                this._overheatWeaponType = null;
                this._overheatStates = {};
                // 清除推击状态
                this._isPushStrike = false;
                this._pushStrikeTimer = 0;
                this._pushStrikeHitSet = new Set();
                this._pushStrikeHitChecked = false;
                // 清除符文长剑特殊状态
                this._runeSwordSpecialActive = false;
                this._runeSwordSpecialTimer = 0;
                this._runeSwordSwords = null;
                // 清除夜与火之剑特殊状态
                this._specialAttackActive = false;
                this._specialAttackTimer = 0;
                this._specialAttackEntities = null;
                // 清除所有特殊攻击冷却
                this._specialAttackCooldowns = {};
                // 清除无人机状态
                if (this.droneSystem) {
                    this.droneSystem._deactivate({ immediateMarks: true, silent: true });
                }
                // 清除无人机易伤状态
                this._droneVulnerabilityStacks = 0;
                this._droneVulnerabilityTimer = 0;
                if (this._droneVulnerabilityEffectId && StatusBar) {
                    StatusBar.removeEffect(this._droneVulnerabilityEffectId);
                    this._droneVulnerabilityEffectId = null;
                }
                // 清除冰锥状态
                this._iceSpikeActive = false;
                this._iceSpikeTimer = 0;
                this._iceSpikeCooldown = 0;
                this._iceSpikeSpikes = [];
                // 清除火球状态
                this._fireballActive = false;
                this._fireballTimer = 0;
                this._fireballCooldown = 0;
                this._fireball = null;
                // 清除闪电状态
                this._lightningStrikeCooldown = 0;
                // 清除圣光状态
                this._holyLightCooldown = 0;
                // 清除暴风雪状态（含正在持续的区域特效）
                this._blizzardCooldown = 0;
                if (this.blizzardSystem && typeof this.blizzardSystem.clearZones === 'function') {
                    this.blizzardSystem.clearZones();
                }
                // 清除陨星坠落状态（含正在预警/坠落/熔岩的打击）
                this._meteorCooldown = 0;
                if (this.meteorSystem && typeof this.meteorSystem.clearStrikes === 'function') {
                    this.meteorSystem.clearStrikes();
                }
                // 清除灼锋焰甲状态（含武器火焰与灼烧光环）
                this._flameArmorCooldown = 0;
                if (this.flameArmorSystem && typeof this.flameArmorSystem.clearBuff === 'function') {
                    this.flameArmorSystem.clearBuff();
                }
                // 清除雷暴领域状态（含头顶雷云）
                this._stormDomainCooldown = 0;
                if (this.stormDomainSystem && typeof this.stormDomainSystem.clearCloud === 'function') {
                    this.stormDomainSystem.clearCloud();
                }
                // 清除贯穿雷枪状态（含蓄力瞄准标记与感电地面）
                this._thunderLanceCooldown = 0;
                if (this.thunderLanceSystem && typeof this.thunderLanceSystem.clearLance === 'function') {
                    this.thunderLanceSystem.clearLance();
                }
                // 清除圣辉领域状态（含圣辉环）
                this._sanctuaryDomainCooldown = 0;
                if (this.sanctuaryDomainSystem && typeof this.sanctuaryDomainSystem.clearDomain === 'function') {
                    this.sanctuaryDomainSystem.clearDomain();
                }
                // 清除圣光审判状态（含蓄力光球）
                this._holyJudgmentCooldown = 0;
                if (this.holyJudgmentSystem && typeof this.holyJudgmentSystem.clearJudgment === 'function') {
                    this.holyJudgmentSystem.clearJudgment();
                }
                // 清除施法状态（死亡/复活复位）
                this._castState = 'idle';
                this._castReleaseDone = true;
                this._castOnRelease = null;
                this._castStep = 0;
                this._castOriginX = null;
                this._castOriginY = null;
                this._castRecoverOriginX = null;
                this._castRecoverOriginY = null;
                // 清除死亡粒子效果
                if (this._poisonEffect) this._poisonEffect.reset();
                // 重置所有弹药状态
                this._ammoState = { weapon: null, offhand: null, weapon2: null, ring2: null };
                // 重新初始化当前装备的弹药
                ['weapon', 'offhand', 'weapon2', 'ring2'].forEach(slot => this._initAmmoForSlot(slot));
                // 重生位置：主神空间 origin 点（固定坐标）
                const respawnPos = { x: SceneManager.scenes.main.origin.x, y: SceneManager.scenes.main.origin.y };
                if (SceneManager.currentScene !== 'main') {
                    // 从其他场景死亡回主神空间：统一关闭地牢系统（如有），使用 origin 点重生
                    if (DungeonMapSystem && DungeonMapSystem.active) {
                        // 地牢死亡惩罚：丢失背包中所有物品（装备与金币不受影响）
                        if (typeof DungeonMapSystem._clearPlayerBackpack === 'function') {
                            DungeonMapSystem._clearPlayerBackpack();
                        }
                        DungeonMapSystem.shutdown();
                    }
                    SceneManager._respawnPos = respawnPos;
                    SceneManager.switchScene('main', this);
                } else {
                    this.x = respawnPos.x;
                    this.y = respawnPos.y;
                    Camera.follow(this);
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '已重生', '#7a9a6a'));
                }
            },

applyPoison(stacks) {
                const wasPoisoned = this._poisonTimer > 0;
                this._poisonStacks += stacks;
                this._poisonTimer = 5000;
                if (!wasPoisoned) {
                    this._poisonTickTimer = 1000;
                }
                if (StatusBar) {
                    this._poisonEffectId = StatusBar.addEffect('poison', 5000, { stacks: this._poisonStacks });
                }
                EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `☠️ 中毒 +${stacks}层`, '#7a9a5a'));
            },

            /** 灼锋焰甲 Buff 到期钩子（updateStatusEffects 调用）：结算经验并回收武器火焰 */
            _onFlameArmorEnd() {
                if (this.flameArmorSystem && typeof this.flameArmorSystem.onBuffEnd === 'function') {
                    this.flameArmorSystem.onBuffEnd();
                }
            },

            _initSkills() {
                // 优先从 JSON 数据加载技能配置
                if (typeof window !== 'undefined' && window.SKILL_DATA) {
                    const skills = {};
                    for (const [id, data] of Object.entries(window.SKILL_DATA)) {
                        if (DataLoader && DataLoader.buildSkillFromJSON) {
                            skills[id] = DataLoader.buildSkillFromJSON(id, data);
                        } else {
                            // fallback: 手动构建技能对象
                            skills[id] = {
                                id: id,
                                name: data.name || id,
                                icon: data.icon || '✦',
                                iconImage: data.iconImage || '',
                                description: data.description || '',
                                hidden: data.hidden === true,
                                disabled: data.disabled === true,
                                shelvedReason: data.shelvedReason || '',
                                level: 1,
                                maxLevel: data.maxLevel || 20,
                                exp: 0,
                                maxExp: getDefaultSkillMaxExp(),
                                // 击杀/暴击等经验奖励（与 buildSkillFromJSON 同口径）
                                expRewards: data.expRewards || {},
                                tags: data.tags || [],
                                getEffect(level) {
                                    const result = {};
                                    if (data.effectFormula) {
                                        for (const [key, formula] of Object.entries(data.effectFormula)) {
                                            const value = DataLoader.parseSkillFormula(String(formula), level);
                                            result[key] = Number.isFinite(value) ? value : 0;
                                        }
                                    }
                                    return result;
                                },
                                getExpForNext(level) {
                                    if (data.expFormula) {
                                        return DataLoader.parseSkillExpFormula(String(data.expFormula), level);
                                    }
                                    return getDefaultSkillExpForNext(level);
                                }
                            };
                        }
                    }
                    // 兜底：确保暴击技能始终存在（即使JSON中没有定义）
                    if (!skills.criticalStrike) {
                        skills.criticalStrike = {
                            id: 'criticalStrike', name: '暴击', icon: '💥', iconImage: 'assets/skills/暴击.png',
                            description: '精通暴击之道，每次暴击都能造成更致命的打击',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '暴击', type: 'passive' }, { name: '被动', type: 'passive' }],
                            getEffect(level) { return { damageBonus: 0.50 + level * 0.05, luckBonus: level }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保冲刺攻击-火始终存在（即使JSON缓存了旧版本）
                    if (!skills.dashAttackFire) {
                        skills.dashAttackFire = {
                            id: 'dashAttackFire', name: '冲刺攻击-火', icon: '🔥', iconImage: 'assets/skills/冲刺攻击-火.png',
                            description: '夜与火之剑专属：冲刺后向前挥砍，武器路径上留下火焰轨迹，对路径上敌人造成毁灭性打击',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                            getEffect(level) { return { damageMul: 1.5 + level * 0.05, cooldownReduction: level * 0.02, staminaCost: 20, totalMs: 800, chargeMs: 350, dashDist: 94, movePhaseRatio: 0.4, speedMul: 0.75, bounceRatio: 0.3, slashWindowMs: 400, knockbackBonus: 188, knockbackLevelBonus: 6, rangeBonusBase: 6, rangeLevelBonus: 6, rangeBonusFlat: 55, hitArc: 2 * Math.PI / 3, stunDuration: 500, critMul: 2, rangeEffectLife: 1000, rangeEffectAlpha: 0.5, goldenConvergeDuration: Math.round(1600 / 1.5), fireTrailSpawnInterval: 50, fireTrailWeaponOffset: 60 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    if (skills.dashAttackFire) {
                        skills.dashAttackFire.iconImage = 'assets/skills/冲刺攻击-火.png';
                    }
                    // 兜底：确保冲刺攻击-突刺始终存在（即使JSON缓存了旧版本）
                    if (!skills.dashAttackThrust) {
                        skills.dashAttackThrust = {
                            id: 'dashAttackThrust', name: '冲刺攻击-突刺', icon: '⚔', iconImage: 'assets/skills/冲刺突击.png',
                            description: '骑士长剑专属：冲刺后向前突刺，对路径上敌人造成多次伤害',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                            getEffect(level) { return { damageMul: 0.80 + level * 0.03, cooldownReduction: level * 0.02, staminaCost: 20, totalMs: 600, chargeMs: 0, dashDist: 188, thrustMs: 600, hitLength: 438, hitLengthBonus: 0, hitWidth: 94, hitBackOffset: 0, hitTickInterval: 199, rangeBonusBase: 6, rangeLevelBonus: 6, rangeBonusFlat: 30, hitArc: 2 * Math.PI / 3, stunDuration: 500, critMul: 1.5, rangeEffectLife: 1000, rangeEffectAlpha: 0.5, goldenConvergeDuration: Math.round(1600 / 1.5), movePhaseRatio: 0.4, speedMul: 0.75, bounceRatio: 0.3, thrustMaxHits: 3, thrustLevelBonusEarly: level * 0.05, thrustLevelBonusLate: level * 0.10 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    if (skills.dashAttackThrust) {
                        skills.dashAttackThrust.iconImage = 'assets/skills/冲刺突击.png';
                    }
                    // 兜底：确保冰锥技能始终存在
                    if (!skills.iceSpike) {
                        skills.iceSpike = {
                            id: 'iceSpike', name: '冰锥', icon: '❄', iconImage: 'assets/skills/Icearrow-skill.png',
                            description: '释放后在角色身后生成冰锥，再次释放将所有冰锥瞄准鼠标方向射出',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { damageBase: 30 + level * 5, magicMul: 1.2 + 0.25 * level, intMul: 1.2 + 0.25 * level, cooldown: 10, mpCost: 30, spikeCount: 2 + Math.floor((level - 1) / 5), duration: 30, flySpeed: 1600, maxRange: 800 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保暴风雪技能始终存在
                    if (!skills.blizzard) {
                        skills.blizzard = {
                            id: 'blizzard', name: '暴风雪', icon: '❄', iconImage: 'assets/skills/blizzard_icon.png',
                            description: '在鼠标指向处召唤暴风雪：椭圆形区域内持续下雪，区域内的敌人持续受到魔法伤害并被减速',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { cooldown: 40 - Math.floor((level - 1) * 5 / 19), mpCost: 150, maxRange: 650, duration: 5 + Math.floor((level - 1) * 5 / 19), tickMs: 500, radiusX: 200 + level * 8, radiusY: 124 + level * 5, damageBase: 5 + level * 2, magicMul: 0.12 + level * 0.02, intMul: 0.12 + level * 0.02, chillStacks: 1, chillDurationMs: 2500, chillSlowPercent: 0.035 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保持盾防御技能始终存在
                    if (!skills.shieldDefense) {
                        skills.shieldDefense = {
                            id: 'shieldDefense', name: '持盾防御', icon: '🛡', iconImage: 'assets/skills/持盾防御.png',
                            description: '精通盾牌防御之术，在持盾状态下获得更强的防御能力和弹反效果',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '盾牌', type: 'weapon' }, { name: '被动', type: 'passive' }],
                            getEffect(level) { return { defBonusPercent: level * 0.02, damageReductionBonus: level * 0.02, parryStunBonus: Math.floor(level / 5) * 0.25 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保火球技能始终存在
                    if (!skills.fireball) {
                        skills.fireball = {
                            id: 'fireball', name: '火球', icon: '🔥', iconImage: 'assets/skills/fireball_icon.png',
                            description: '释放后在角色身前凝聚火球，再次释放将火球瞄准鼠标方向射出，命中后造成范围爆炸伤害',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { damageBase: 80 + level * 10, magicMul: 2 + 0.5 * level, intMul: 2.5 + 0.75 * level, cooldown: 20, mpCost: 50, explosionRadius: 80 + level * 5, duration: 30, flySpeed: 1600, maxRange: 1200 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保闪电技能始终存在
                    if (!skills.lightningStrike) {
                        skills.lightningStrike = {
                            id: 'lightningStrike', name: '闪电', icon: '⚡', iconImage: 'assets/skills/闪电.png',
                            description: '释放后锁定鼠标指向处最近的敌方单位，蓝紫色闪电连接造成魔法伤害，闪电会向目标周围 200px 内传导，命中目标被眩晕并叠加感电',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { damageBase: 20 + level * 10, magicMul: 1.15 + level * 0.25, intMul: 1 + level * 0.25, cooldown: 12, mpCost: 30, aimRadius: 200, maxRange: 600, stunMs: 750 + level * 20, chainRange: 200, chainTargets: 1 + Math.floor((level - 1) / 5), chainDecay: 0.1, duration: 0.5, fadeMs: 250, segments: 10, jitter: 0.09, electrifyStacks: 1, electrifyDurationMs: 4000 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保雷暴领域技能始终存在（电系中级，需法杖）
                    if (!skills.stormDomain) {
                        skills.stormDomain = {
                            id: 'stormDomain', name: '雷暴领域', icon: '🌩️', iconImage: 'assets/skills/雷暴领域.png',
                            description: '中级电魔法：在头顶凝聚雷云跟随自己，持续期内每 0.9 秒对范围内最近的敌人落雷，落雷可传导、眩晕打断并叠加感电',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { cooldown: 30, mpCost: 80 + Math.floor((level - 1) * 40 / 19), maxRange: 550, duration: 10 + Math.floor((level - 1) * 3 / 19), strikeIntervalMs: 900, radius: 220 + level * 8, strikeDamageBase: 25 + level * 4, strikeMagicMul: 0.45 + level * 0.05, strikeIntMul: 0.45 + level * 0.05, chainExtraTargets: 1 + Math.floor((level - 1) / 8), chainRange: 160, chainDecay: 0.3, stunMs: 250, electrifyStacks: 1, electrifyDurationMs: 4000 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保贯穿雷枪技能始终存在（电系高级，需法杖）
                    if (!skills.thunderLance) {
                        skills.thunderLance = {
                            id: 'thunderLance', name: '贯穿雷枪', icon: '⚡', iconImage: 'assets/skills/贯穿雷枪.png',
                            description: '高级电魔法：长按 Q 蓄力（可随鼠标改变瞄准方向），蓄满 2.5 秒或松开后沿鼠标方向射出电磁炮直线光束——笔直贯穿路径上所有敌人，蓄力 0.5~2.5 秒按时间比例造成 20%~100% 伤害（满蓄力 100%），命中目标被击退（50→150px 随等级），不足 0.5 秒释放失败且不进入冷却不耗魔；目标感电层数越高伤害越高（每层 +10%）；射程尽头或撞墙处电爆',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { cooldown: 32 - Math.floor((level - 1) * 4 / 19), mpCost: 120 + Math.floor((level - 1) * 35 / 19), maxRange: 900 + level * 15, delayMs: 2500, minChargeMs: 500, lanceDamageBase: 110 + level * 14, lanceMagicMul: 1.8 + level * 0.26, lanceIntMul: 2.0 + level * 0.30, knockback: 50 + Math.floor((level - 1) * 100 / 19), electrifyDamagePerStack: 0.1, electrifyStacks: 2, electrifyDurationMs: 5000, chargeBonusMul: 1.3, coneHalfWidth: 40, endExplosionRadius: 90, shakeIntensity: 10 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保圣光技能始终存在
                    if (!skills.holyLight) {
                        skills.holyLight = {
                            id: 'holyLight', name: '圣光', icon: '✨', iconImage: 'assets/skills/圣光.png',
                            selfCast: true,
                            description: '在鼠标指向处召唤金色圣光从天而降：对敌方造成魔法伤害（僵尸类伤害翻倍），对友方回复生命；金色光粒向上飘散，持续 2 秒',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { cooldown: 10 - Math.floor((level - 1) / 5), mpCost: 30, aimRadius: 200, maxRange: 600, duration: 2, fadeMs: 400, beamTopWidth: 60, beamBottomWidth: 110, beamHeight: 1400, dissolveRatio: 0.28, healBase: 5 + level * 5, magicMul: 0.25 + level * 0.25, intMul: 1 + level * 0.5, wisMul: 1 + level * 0.5, zombieDamageMul: 2 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保圣辉领域技能始终存在（光系中级，需法杖）
                    if (!skills.sanctuaryDomain) {
                        skills.sanctuaryDomain = {
                            id: 'sanctuaryDomain', name: '圣辉领域', icon: '🌟', iconImage: 'assets/skills/圣辉领域.png',
                            description: '中级光魔法：以自身为中心展开圣辉领域并跟随移动，持续期内友军每 0.5 秒回复生命、每 2 秒净化 1 个负面状态；领域内敌方每 0.5 秒受光系魔法伤害（僵尸类 2.5 倍）',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { cooldown: 26 - Math.floor((level - 1) * 4 / 19), mpCost: 60 + Math.floor((level - 1) * 40 / 19), duration: 8 + Math.floor((level - 1) * 4 / 19), radius: 230 + level * 10, tickMs: 500, healBase: 3 + level * 2, healWisMul: 0.3 + level * 0.1, damageBase: 6 + level * 2, damageMagicMul: 0.2 + level * 0.05, damageIntMul: 0.2 + level * 0.05, zombieDamageMul: 2.5, cleanseIntervalMs: 2000 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保圣光审判技能始终存在（光系高级，需法杖）
                    if (!skills.holyJudgment) {
                        skills.holyJudgment = {
                            id: 'holyJudgment', name: '圣光审判', icon: '☀️', iconImage: 'assets/skills/圣光审判.png',
                            selfCast: true,
                            description: '高级光魔法：长按蓄力（可随鼠标移动选点），松开或蓄满 2.5 秒后在目标点降下巨型圣柱——范围内敌方受光系伤害（僵尸类 3 倍），血量过低的非 Boss 不死单位被直接净化；友方大额回复并立即清除全部负面状态',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { cooldown: 40 - Math.floor((level - 1) * 4 / 19), mpCost: 130 + Math.floor((level - 1) * 40 / 19), maxRange: 700, delayMs: 2500, minChargeMs: 500, radiusMin: 280, radiusMax: 520, damageBase: 60 + level * 8, damageMagicMul: 1.5 + level * 0.25, damageIntMul: 1.0 + level * 0.2, damageWisMul: 1.0 + level * 0.2, zombieDamageMul: 3, purifyThreshold: 0.12 + level * 0.004, healBase: 20 + level * 12, healWisMul: 1 + level * 0.5, shakeIntensity: 12 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保无人机技能始终存在（即使JSON中没有定义）
                    if (!skills.droneSkill) {
                        skills.droneSkill = {
                            id: 'droneSkill', name: '无人机', icon: '🚁', iconImage: 'assets/skills/无人机.png',
                            description: '部署高空侦察无人机开拓迷雾，并在近圈为全队标记敌方弱点',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '主动', type: 'active' }, { name: '魔法', type: 'magic' }],
                            getEffect(level) { return getDroneValues(level); },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    // 兜底：确保夜与火之剑技能始终存在
                    if (!skills.nightFlame) {
                        skills.nightFlame = {
                            id: 'nightFlame', name: '夜与火之剑', icon: '🌙', iconImage: 'assets/skills/fireball_icon.png',
                            description: '夜与火之剑专属：释放一道贯穿敌人的火焰光束，造成持续魔法伤害并附加魔力易伤',
                            level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(_level) { return { cooldown: 15, mpCost: 80, beamLength: 1500, beamDuration: 3000, beamWidth: 56, tickInterval: 200, damageBase: 60, strMul: 1.5, intMul: 1.25, tickDamageMul: 0.25, magicVulnStacks: 2, resetOffset: -15, recoverMs: 500, rangeEffectAlpha: 0.4, rangeEffectShape: 'triangle', rangeEffectFilled: true, rangeEffectLife: 100 }; },
                            getExpForNext: getDefaultSkillExpForNext,
                        };
                    }
                    return skills;
                }
                // 兜底：硬编码默认技能（JSON 加载失败时）
                return {
                    swordMastery: {
                        id: 'swordMastery', name: '剑精通', icon: '⚔',
                        description: '精通剑术，每次挥舞都更加致命',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '剑类武器', type: 'weapon' }, { name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { atkBonus: level, cooldownReduction: level * 0.01, dexBonus: level }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    dashAttack: {
                        id: 'dashAttack', name: '冲刺攻击', icon: '💨',
                        description: '在冲刺状态下发动强力突进挥砍，对路径上的敌人造成毁灭性打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageMul: 1.75 + level * 0.05, cooldownReduction: level * 0.02, staminaCost: 20, totalMs: 800, chargeMs: 350, dashDist: 188, movePhaseRatio: 0.4, speedMul: 0.75, bounceRatio: 0.3, slashWindowMs: 400, knockbackBonus: 188, knockbackLevelBonus: 6, rangeBonusBase: 6, rangeLevelBonus: 6, rangeBonusFlat: 55, hitArc: 2 * Math.PI / 3, stunDuration: 500, critMul: 2, rangeEffectLife: 1000, rangeEffectAlpha: 0.5, goldenConvergeDuration: Math.round(1600 / 1.5) }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    dashAttackFire: {
                        id: 'dashAttackFire', name: '冲刺攻击-火', icon: '🔥', iconImage: 'assets/skills/冲刺攻击-火.png',
                        description: '夜与火之剑专属：冲刺后向前挥砍，武器路径上留下火焰轨迹，对路径上敌人造成毁灭性打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageMul: 1.5 + level * 0.05, cooldownReduction: level * 0.02, staminaCost: 20, totalMs: 800, chargeMs: 350, dashDist: 94, movePhaseRatio: 0.4, speedMul: 0.75, bounceRatio: 0.3, slashWindowMs: 400, knockbackBonus: 188, knockbackLevelBonus: 6, rangeBonusBase: 6, rangeLevelBonus: 6, rangeBonusFlat: 55, hitArc: 2 * Math.PI / 3, stunDuration: 500, critMul: 2, rangeEffectLife: 1000, rangeEffectAlpha: 0.5, goldenConvergeDuration: Math.round(1600 / 1.5), fireTrailSpawnInterval: 50, fireTrailWeaponOffset: 60 }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    dashAttackThrust: {
                        id: 'dashAttackThrust', name: '冲刺攻击-突刺', icon: '⚔', iconImage: 'assets/skills/冲刺突击.png',
                        description: '骑士长剑专属：冲刺后向前突刺，对路径上敌人造成多次伤害',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageMul: 0.80 + level * 0.03, cooldownReduction: level * 0.02, staminaCost: 20, totalMs: 600, chargeMs: 0, dashDist: 188, thrustMs: 600, hitLength: 438, hitLengthBonus: 0, hitWidth: 94, hitBackOffset: 0, hitTickInterval: 199, rangeBonusBase: 6, rangeLevelBonus: 6, rangeBonusFlat: 30, hitArc: 2 * Math.PI / 3, stunDuration: 500, critMul: 1.5, rangeEffectLife: 1000, rangeEffectAlpha: 0.5, goldenConvergeDuration: Math.round(1600 / 1.5), movePhaseRatio: 0.4, speedMul: 0.75, bounceRatio: 0.3, thrustMaxHits: 3, thrustLevelBonusEarly: level * 0.05, thrustLevelBonusLate: level * 0.10 }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    whirlwind: {
                        id: 'whirlwind', name: '风车', icon: '🌀',
                        description: '以自身为中心高速旋转武器，对周围敌人造成毁灭性打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '近战', type: 'melee' }, { name: '主动', type: 'active' }],
                        getEffect(level) { return { damageMul: 1.5 + level * 0.10, strBonus: level, cooldown: 10 - level * 0.2, staminaCost: 20 + level * 1, radius: 120 + level * 5, swordRadiusBonus: 80, knockback: 250, stunDuration: 2500, duration: 800 }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    // TEMP SHELVED (2026-08-25): 保留推击逻辑与美术资产，待枪械动画重做后移除 hidden/disabled 恢复。
                    pushStrike: {
                        id: 'pushStrike', name: '推击', icon: '💥', iconImage: 'assets/skills/推击.png',
                        description: '以双手长枪的枪托顶开贴身敌人，短暂硬直并创造脱身空间',
                        hidden: true, disabled: true, shelvedReason: '暂时搁置：枪械推击动画待重新设计',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '近战钝击', type: 'melee' }, { name: '主动', type: 'active' }],
                        getEffect(level) { return getPushStrikeValues(level, 0); },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    criticalStrike: {
                        id: 'criticalStrike', name: '暴击', icon: '💥', iconImage: 'assets/skills/暴击.png',
                        description: '精通暴击之道，每次暴击都能造成更致命的打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '暴击', type: 'passive' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageBonus: 0.50 + level * 0.05, luckBonus: level }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    machineGunMastery: {
                        id: 'machineGunMastery', name: '机枪精通', icon: '🔫', iconImage: 'assets/skills/machine_gun_mastery.png',
                        description: '精通机枪的操控艺术，每次射击都更加致命',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '机枪', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { strBonus: level, damagePercent: level * 0.01, damageBonus: level, spreadDelayBonus: level * 0.1 }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    rifleMastery: {
                        id: 'rifleMastery', name: '步枪精通', icon: '🎯', iconImage: 'assets/skills/步枪精通.png',
                        description: '精通步枪的精准射击，每颗子弹都命中要害',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '步枪', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { wisBonus: level, damagePercent: level * 0.01, damageBonus: level, critRateBonus: level }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    pistolMastery: {
                        id: 'pistolMastery', name: '手枪精通', icon: '🔫', iconImage: 'assets/skills/pistol_mastery.png',
                        description: '精通手枪的快速射击，在移动中也能精准命中',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '手枪', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { dexBonus: level, damagePercent: level * 0.01, damageBonus: level, speedPercent: level * 0.01 }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    shotgunMastery: {
                        id: 'shotgunMastery', name: '散弹枪精通', icon: '🔫', iconImage: 'assets/skills/散弹枪精通.png',
                        description: '精通散弹枪的毁灭性火力，每一发弹丸都更具威力',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '散弹枪', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { conBonus: level, damagePercent: level * 0.01, knockbackBonus: level }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    bowMastery: {
                        id: 'bowMastery', name: '弓精通', icon: '🏹', iconImage: 'assets/skills/弓精通.png',
                        description: '精通弓箭射击之道，每次拉弓都更加致命',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '弓类武器', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageBonus: level * 5, damagePercent: level * 0.01, cooldownReduction: level * 0.01, dexBonus: level }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    droneSkill: {
                        id: 'droneSkill', name: '无人机', icon: '🚁', iconImage: 'assets/skills/无人机.png',
                        description: '部署高空侦察无人机开拓迷雾，并在近圈为全队标记敌方弱点',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '主动', type: 'active' }, { name: '魔法', type: 'magic' }],
                        getEffect(level) { return getDroneValues(level); },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    iceSpike: {
                        id: 'iceSpike', name: '冰锥', icon: '❄', iconImage: 'assets/skills/Icearrow-skill.png',
                        description: '释放后在角色身后生成冰锥，再次释放将所有冰锥瞄准鼠标方向射出',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                        getEffect(level) { return { damageBase: 30 + level * 5, magicMul: 1.2 + 0.25 * level, intMul: 1.2 + 0.25 * level, cooldown: 10, mpCost: 30, spikeCount: 2 + Math.floor((level - 1) / 5), duration: 30, flySpeed: 1600, maxRange: 800 }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    shieldDefense: {
                        id: 'shieldDefense', name: '持盾防御', icon: '🛡', iconImage: 'assets/skills/持盾防御.png',
                        description: '精通盾牌防御之术，在持盾状态下获得更强的防御能力和弹反效果',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '盾牌', type: 'weapon' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { defBonusPercent: level * 0.02, damageReductionBonus: level * 0.02, parryStunBonus: Math.floor(level / 5) * 0.25 }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    fireball: {
                        id: 'fireball', name: '火球', icon: '🔥', iconImage: 'assets/skills/fireball_icon.png',
                        description: '释放后在角色身前凝聚火球，再次释放将火球瞄准鼠标方向射出，命中后造成范围爆炸伤害',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                        getEffect(level) { return { damageBase: 80 + level * 10, magicMul: 2 + 0.5 * level, intMul: 2.5 + 0.75 * level, cooldown: 20, mpCost: 50, explosionRadius: 80 + level * 5, duration: 30, flySpeed: 1600, maxRange: 1200 }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    },
                    nightFlame: {
                        id: 'nightFlame', name: '夜与火之剑', icon: '🌙', iconImage: 'assets/skills/fireball_icon.png',
                        description: '夜与火之剑专属：释放一道贯穿敌人的火焰光束，造成持续魔法伤害并附加魔力易伤',
                        level: 1, maxLevel: 20, exp: 0, maxExp: getDefaultSkillMaxExp(),
                        tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                        getEffect(_level) { return { cooldown: 15, mpCost: 80, beamLength: 1500, beamDuration: 3000, beamWidth: 56, tickInterval: 200, damageBase: 60, strMul: 1.5, intMul: 1.25, tickDamageMul: 0.25, magicVulnStacks: 2, resetOffset: -15, recoverMs: 500, rangeEffectAlpha: 0.4, rangeEffectShape: 'triangle', rangeEffectFilled: true, rangeEffectLife: 100 }; },
                        getExpForNext: getDefaultSkillExpForNext,
                    }
                };
            },

_applyEnchantAttackInterval(item) {
                // 空手/非武器：恢复所有攻击的基准冷却，避免附魔减速残留给下一把武器
                if (!item || (!item.weaponType && !item.attackKey)) {
                    for (const key of Object.keys(this.attacks)) {
                        const atk = this.attacks[key];
                        if (atk && atk.baseMaxCooldown !== undefined) atk.maxCooldown = atk.baseMaxCooldown;
                    }
                    return;
                }
                // 根据武器类型更新对应的攻击冷却
                const wType = item.weaponType;
                const attackKey = item.attackKey || 'melee';
                const atk = this.attacks[attackKey];
                if (atk) {
                    // 基准冷却取攻击实例创建时的原始值（baseMaxCooldown），
                    // 避免把已被附魔/改造/射速 ramp 改过的运行时值缓存为基准
                    let baseCooldown = atk.baseMaxCooldown !== undefined ? atk.baseMaxCooldown : atk.maxCooldown;
                    if (wType === 'bow' && item.attack && item.attack.attackInterval) {
                        baseCooldown = item.attack.attackInterval;
                    }
                    // 枪械统一走带40ms下限的真值解析器；近战/弓保留原附魔与改造叠加口径。
                    if (isGunWeapon(item)) {
                        atk.maxCooldown = resolveGunAttackInterval(item, baseCooldown);
                    } else {
                        const intervalMul = Number(item._enchantEffects?.attackIntervalMul) || 1;
                        const attackIntervalDelta = Number(item._craftEffects?.attackIntervalDelta) || 0;
                        atk.maxCooldown = Math.round(baseCooldown * intervalMul + attackIntervalDelta);
                    }
                }
            },

_getEffectiveGunAttackInterval(item, attackKey) {
                const attack = attackKey ? this.attacks?.[attackKey] : null;
                const canonical = findWeaponConfig(item?.weaponId, item?.name);
                const base = Number(canonical?.attack?.attackInterval)
                    || Number(item?.attack?.attackInterval)
                    || Number(attack?.baseMaxCooldown)
                    || Number(attack?.maxCooldown)
                    || 250;
                const baseInterval = resolveGunAttackInterval(item, base);
                const ramp = canonical?.rampFireParams || item?.rampFireParams;
                if (!ramp) return baseInterval;
                const state = this._gunRampStates?.weapon?.weapon === item
                    ? this._gunRampStates.weapon
                    : (this._gunRampStates?.weapon2?.weapon === item ? this._gunRampStates.weapon2 : null);
                const progress = Math.max(0, Math.min(1, Number(state?.progress) || 0));
                const minCooldown = Math.max(40,
                    (Number(ramp.minCooldown) || base) + (Number(item?._craftEffects?.rampMinCooldownDelta) || 0));
                const peakInterval = resolveGunAttackInterval(item, minCooldown);
                return Math.round(baseInterval + (peakInterval - baseInterval) * progress);
            },

_applySkillOverrides(_item) {
                // 技能覆盖只认当前启用主手。调用方即使传入非当前槽物品，也不能污染运行时技能。
                const activeItem = this.equipments?.[this.weaponMode] || null;
                // 附魔效果：攻击间隔调整（装备/卸下/附魔写回统一在此刷新，不再只有切枪才生效）
                this._applyEnchantAttackInterval(activeItem);
                this._skillOverrides = activeItem?.skillOverrides
                    ? JSON.parse(JSON.stringify(activeItem.skillOverrides))
                    : {};
            },

_clearSkillOverrides() {
                // 卸下当前武器可能会自动切到另一主手；清理后必须立即同步新当前武器，不能无条件置空。
                const activeItem = this.equipments?.[this.weaponMode] || null;
                this._skillOverrides = activeItem?.skillOverrides
                    ? JSON.parse(JSON.stringify(activeItem.skillOverrides))
                    : {};
            },

_getCurrentSkillOverrides() {
                const activeItem = this.equipments?.[this.weaponMode] || null;
                return activeItem?.skillOverrides || {};
            },

_getDashSkillLevel(skillId = null) {
                const activeSkillId = skillId || this._getActiveDashSkillId();
                const shared = this.skills?.dashAttack;
                return Number(shared?.level) || Number(this.skills?.[activeSkillId]?.level) || 1;
            },

triggerWhirlwind() {
                // 攻击动画锁定：任何一段攻击未播完前不触发
                if (!this._isPushStrike && !this._whirlwindRecovering && this.whirlwindSystem && !(this.weaponAnim && this.weaponAnim.isAttacking)) {
                    this.whirlwindSystem.trigger();
                }
            },

triggerPushStrike() {
                // 攻击动画锁定：任何一段攻击未播完前不触发
                if (!this._whirlwindRecovering && this.pushStrikeSystem && !(this.weaponAnim && this.weaponAnim.isAttacking)) {
                    return this.pushStrikeSystem.trigger();
                }
                return false;
            },

_triggerRuneSwordCooldownReduction() {
                if (this.runeSwordSystem) {
                    this.runeSwordSystem._triggerCooldownReduction();
                }
            },

_getSkillParam(skillId, paramPath, defaultValue) {
                const overrideSource = this._isDashing && this._dashSkillId === skillId && this._dashSkillOverrides
                    ? this._dashSkillOverrides
                    : this._getCurrentSkillOverrides();
                const override = overrideSource[skillId];
                if (!override) return defaultValue;
                const keys = paramPath.split('.');
                let val = override;
                for (const k of keys) {
                    val = val?.[k];
                    if (val === undefined) return defaultValue;
                }
                return val;
            },

_getActiveDashSkillId() {
                const overrides = this._getCurrentSkillOverrides();
                if (overrides.dashAttackThrust) return 'dashAttackThrust';
                if (overrides.dashAttackFire) return 'dashAttackFire';
                return 'dashAttack';
            },

_isFacingMouse() {
                const moveDir = Input.getMovement();  // 修正：使用 getMovement 而非 getMoveDir
                if (moveDir.x === 0 && moveDir.y === 0) return false;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                const mx = Input.mouse.x - screenPos.x;
                const my = Input.mouse.y - screenPos.y;
                const len = Math.sqrt(mx * mx + my * my);
                if (len === 0) return true;
                return (moveDir.x * mx + moveDir.y * my) / len > 0;
            },

_isSprintDirectionAllowed() {
                const moveDir = Input.getMovement();
                if (!moveDir || (moveDir.x === 0 && moveDir.y === 0)) return false;
                const item = this.equipments?.[this.weaponMode];
                const isMelee = item && (item.category === 'weapon_melee' || item.weaponType === 'sword');
                return isMelee ? true : this._isFacingMouse();
            },

_hasHorizontalDashInput() {
                const moveDir = Input.getMovement();
                return !!moveDir && Math.abs(Number(moveDir.x) || 0) >= 0.001;
            },

_getFacingDirection() {
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                const mx = Input.mouse.x - screenPos.x;
                const my = Input.mouse.y - screenPos.y;
                const absX = Math.abs(mx);
                const absY = Math.abs(my);
                if (absX === 0 && absY === 0) {
                    const vx = this.vx || 0;
                    const vy = this.vy || 0;
                    const absVX = Math.abs(vx);
                    const absVY = Math.abs(vy);
                    if (absVX > absVY) {
                        return vx > 0 ? 'right' : 'left';
                    } else {
                        return vy > 0 ? 'down' : 'up';
                    }
                }
                if (absX > absY) {
                    return mx > 0 ? 'right' : 'left';
                } else {
                    return my > 0 ? 'down' : 'up';
                }
            },

addAttribute(attr) {
                if (this.data.attrPoints <= 0) return false;
                const validAttrs = ['str', 'dex', 'int', 'con', 'wis', 'luck'];
                if (!validAttrs.includes(attr)) return false;
                this.data.attrPoints--;
                this.data[attr]++;
                this.calculateCombatStats();
                this.updateMaxStats();
                return true;
            },

    triggerDodge(moveInput) {
                if (this._specialAttackActive) return; // 夜与火之剑特殊攻击期间禁止闪避
                if (this.shieldSystem && this.shieldSystem.defending) return; // 防御状态禁止闪避
                if (this.hasStatusEffect && this.hasStatusEffect('bind')) return; // 束缚状态禁止闪避
                // 风车收势唯一允许的动作取消入口：先清收势临时状态，再进入正常翻滚。
                if (this._whirlwindRecovering) this.whirlwindSystem?.cancelRecover?.();
                // 闪避取消当前攻击动画/Tween
                if (this.weaponAnim && this.weaponAnim.isAttacking) {
                    this.clearAttackTweens();
                }
                let dirX = moveInput.x, dirY = moveInput.y;
                if (dirX === 0 && dirY === 0) { dirX = Math.cos(this.rotation); dirY = Math.sin(this.rotation); }
                const len = Math.sqrt(dirX*dirX + dirY*dirY); if (len > 0) { dirX /= len; dirY /= len; }
                this.dodgeDirection = { x: dirX, y: dirY }; this.isDodging = true;
                // 生效时长/速度走 calculateCombatStats 计算面板（可被装备/道具修饰），缺省回退配置基准
                this.dodgeTimer = (this.data && this.data.dodgeDuration) || CONFIG.DODGE_DURATION;
                this.dodgeCooldown = CONFIG.DODGE_COOLDOWN; this.dodgeInvincible = true; this.data.stamina -= CONFIG.STAMINA_DODGE_COST;
                // 闪避期间：不可选中（感知/命中判定统一跳过）+ 碰撞体积 0（实体分离跳过；
                // 墙壁仍由 WallSystem 解析，不可穿墙——与铠甲骑士冲锋同机制）
                this._dodgePrevHittable = this.hittable;
                this.hittable = false;
                this._dodgePrevNoCollision = !!this.noCollision;
                this.noCollision = true;
                // SoundManager.play('dodge');
                this.vx = 0; this.vy = 0;
                // 闪避动画：朝鼠标方向=翻滚（dodge_roll），背向鼠标=后撤跳跃（dodge_jump，2026-07-30）。
                // 朝向不变（flipX 仍由鼠标侧决定）——后撤跳天然背身效果
                {
                    const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
                    if (scene && typeof scene.setPlayerAnimation === 'function') {
                        let dodgeAnimKey = 'dodge_roll';
                        if (typeof Input !== 'undefined' && Input.mouse && typeof Renderer !== 'undefined' && Renderer.screenToWorld) {
                            const mw = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                            const mdx = mw.x - this.x, mdy = mw.y - this.y;
                            const mlen = Math.hypot(mdx, mdy);
                            if (mlen > 1) {
                                const dot = (dirX * mdx + dirY * mdy) / mlen;
                                if (dot < 0) dodgeAnimKey = 'dodge_jump';
                            }
                        }
                        scene.setPlayerAnimation(dodgeAnimKey, this.dodgeTimer);
                    }
                }
                EffectFactory.createDodgeEffect(this.x, this.y, dirX, dirY);
            },

// 闪避结束统一出口：还原无敌/不可选中/碰撞标记（计时到期与眩晕打断都走这里）
_endDodge() {
                this.isDodging = false;
                this.dodgeInvincible = false;
                this.hittable = this._dodgePrevHittable !== undefined ? this._dodgePrevHittable : true;
                // 恢复实体碰撞：与实体重叠时由 resolveCollisions 逐帧挤出（带墙壁解析，不瞬移不卡墙）
                this.noCollision = this._dodgePrevNoCollision !== undefined ? this._dodgePrevNoCollision : false;
                this._dodgePrevHittable = undefined;
                this._dodgePrevNoCollision = undefined;
            },

_lineRectIntersection(x1, y1, x2, y2, rect) {
                // Liang-Barsky 线段裁剪算法，返回线段进入矩形时的参数 t (0~1)，无交点返回 null
                const dx = x2 - x1, dy = y2 - y1;
                let u1 = 0, u2 = 1;
                const p = [-dx, dx, -dy, dy], q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];
                for (let i = 0; i < 4; i++) {
                    if (p[i] === 0) { if (q[i] < 0) return null; }
                    else { const t = q[i] / p[i]; if (p[i] < 0) { if (t > u1) u1 = t; } else { if (t < u2) u2 = t; } }
                }
                return u1 < u2 ? u1 : null;
            },

_shortestAngleDelta(from, to) {
                let delta = to - from;
                while (delta > Math.PI) delta -= Math.PI * 2;
                while (delta < -Math.PI) delta += Math.PI * 2;
                return delta;
            },


triggerOffhandWeaponAnim() {
                // 仅触发副手动画
                if (this.offhandWeaponAnim) {
                    this.offhandWeaponAnim.state = 'swing';
                    this.offhandWeaponAnim.timer = 0;
                    this.offhandWeaponAnim.isAttacking = true;
                }
            },

switchWeaponMode() {
                // 攻击期间（rotate/windup/swing/recover/idle_return）不能切换武器
                if (this.weaponAnim && this.weaponAnim.state !== 'idle') {
                    return;
                }
                // 冲刺动作从发动到专属 recover 结束必须使用同一把武器与同一技能快照。
                if (this._isDashing || this._dashRecoverAt || this._dashResetAnim || this._whirlwindRecovering
                    || this._isPushStrike || this._specialResetAnim) {
                    return;
                }
                // 夜与火之剑特殊攻击期间不能切换武器
                if (this._specialAttackActive) {
                    return;
                }
                // === 新设计：weaponMode 只是表示当前使用哪个栏位 ===
                // 'weapon' = 武器栏1, 'weapon2' = 武器栏2
                // 按 F 键切换：weapon <-> weapon2
                const nextMode = this.weaponMode === 'weapon' ? 'weapon2' : 'weapon';
                const nextItem = this.equipments[nextMode];
                // 如果目标栏位为空，且当前栏位有装备，则不允许切换（防止切换到空栏位）
                // 但如果当前栏位为空，且目标栏位有装备，则允许切换
                const currentItem = this.equipments[this.weaponMode];
                // 副手仅承载盾牌/魔法书等支援装备，不能让空主手武器组变成“可切换武器组”。
                const nextHasWeapon = !!(nextItem && nextItem.name);
                const currentHasWeapon = !!(currentItem && currentItem.name);
                if (!nextHasWeapon && !currentHasWeapon) {
                    // 两个栏位都为空，显示提示
                    const hint = document.createElement('div');
                    hint.id = '_weaponSwitchHint';
                    hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(120,50,50,0.9);color:#d4c5a9;font-size:18px;padding:10px 24px;border-radius:8px;border:2px solid #9a5a5a;z-index:99999;pointer-events:none;font-family:SimHei, "Microsoft YaHei", "黑体", sans-serif;white-space:nowrap;transition:opacity 0.5s;';
                    hint.textContent = '⚠ 无可用武器栏';
                    document.body.appendChild(hint);
                    requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; TimerManager.setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 800); });
                    return;
                }
                if (!nextHasWeapon) {
                    // 目标栏位为空但当前栏位有装备，显示提示但不切换
                    const hint = document.createElement('div');
                    hint.id = '_weaponSwitchHint';
                    hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(120,50,50,0.9);color:#d4c5a9;font-size:18px;padding:10px 24px;border-radius:8px;border:2px solid #9a5a5a;z-index:99999;pointer-events:none;font-family:SimHei, "Microsoft YaHei", "黑体", sans-serif;white-space:nowrap;transition:opacity 0.5s;';
                    hint.textContent = '⚠ 目标栏位无装备';
                    document.body.appendChild(hint);
                    requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; TimerManager.setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 800); });
                    return;
                }
                this.weaponMode = nextMode;
                this.shieldSystem?.checkEquipped();
                // 法杖魔攻只读取当前启用主手；切换后立即刷新，避免沿用上一武器组的 matk。
                this.calculateCombatStats();
                // 切换武器栏：立即中断所有槽位的换弹动作（含 Super90 单发装填）
                for (const slot of ['weapon', 'offhand', 'weapon2', 'ring2']) {
                    const state = this._ammoState && this._ammoState[slot];
                    if (state && state.reloading) {
                        state.reloading = false;
                        state.reloadTimer = 0;
                        state.singleReloadMode = false;
                    }
                }
                // 切换武器时重置蓄力状态
                if (this._chargeState !== 'idle') {
                    this._chargeState = 'idle';
                    this._chargeTimer = 0;
                    this._chargeFlashActive = false;
                    this._chargeFlashTimer = 0;
                }
                // G18 切换保护：切换到 pistol 后 300ms 内不能开火
                if (nextItem && (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol' || AUTO_GUN_FAMILY.includes(nextItem.weaponType))) {
                    this.weaponSwitchCooldown = 300;
                }
                // 视觉反馈：屏幕中央显示切换提示
                const oldHint = getElement('_weaponSwitchHint');
                if (oldHint) oldHint.remove();
                const hint = document.createElement('div');
                hint.id = '_weaponSwitchHint';
                hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(60,50,40,0.9);color:#d4c5a9;font-size:22px;padding:12px 28px;border-radius:8px;border:2px solid #7a6a5a;z-index:99999;pointer-events:none;font-family:SimHei, "Microsoft YaHei", "黑体", sans-serif;white-space:nowrap;transition:opacity 0.5s;';
                const modeName = this.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
                // 图标根据当前栏位的实际装备类型决定
                let modeIcon = '⚔';
                if (nextItem) {
                    if (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol') modeIcon = '🔫';
                    else if (AUTO_GUN_FAMILY.includes(nextItem.weaponType)) modeIcon = '🔥';
                    else if (nextItem.weaponType === 'bow') modeIcon = '🏹';
                }
                hint.textContent = `${modeIcon} ${modeName}`;
                document.body.appendChild(hint);
                requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; TimerManager.setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 600); });
                // 切换武器后150ms触发一次待机动画2（旋转动画）—— 双手武器不触发旋转
                if (nextItem && !isTwoHanded(nextItem)) {
                    this.weaponAnim.nextSpin = nowMs() + WEAPON_FX_CONFIG.switchSpinDelayMs;
                } else {
                    this.weaponAnim.nextSpin = 0;
                    this.weaponAnim.spinEnd = 0;
                }
                // 更新近战武器贴图：如果当前装备是剑类，切换对应的手持贴图
                if (nextItem && nextItem.equipImage) {
                    this.meleeImage.src = nextItem.equipImage;
                }
                // 更新弓的帧动画
                if (nextItem && nextItem.bowFrames) {
                    const frames = [];
                    for (let i = 0; i < nextItem.bowFrames.length; i++) {
                        frames.push(loadImage(nextItem.bowFrames[i]));
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                    // 设置弓类待机贴图
                    if (nextItem.equipImage) {
                        this.bowEquipImage = loadImage(nextItem.equipImage);
                    }
                } else if (nextItem && nextItem.weaponAsset && nextItem.weaponAsset.framePrefix) {
                    const frames = [];
                    for (let i = 1; i <= nextItem.weaponAsset.frameCount; i++) {
                        const num = String(i).padStart(nextItem.weaponAsset.framePad || 2, '0');
                        frames.push(loadImage(nextItem.weaponAsset.framePrefix + num + '.png'));
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                    // 设置弓类待机贴图
                    if (nextItem.equipImage) {
                        this.bowEquipImage = loadImage(nextItem.equipImage);
                    }
                } else if (nextItem && (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol')) {
                    this.equippedRangedType = 'pistol';
                    if (nextItem.equipImage) {
                        const canvasImageProp = nextItem.canvasImageProp || 'pistolImage';
                        this[canvasImageProp] = loadImage(nextItem.equipImage);
                    }
                    if (nextItem.weaponAsset && nextItem.weaponAsset.muzzleImage) {
                        this.muzzleFlashImg = loadImage(nextItem.weaponAsset.muzzleImage);
                    }
                } else if (nextItem && AUTO_GUN_FAMILY.includes(nextItem.weaponType)) {
                    this.equippedRangedType = nextItem.weaponType;
                    if (nextItem.equipImage) {
                        const canvasImageProp = nextItem.canvasImageProp;
                        if (canvasImageProp) this[canvasImageProp] = loadImage(nextItem.weaponAsset?.image || nextItem.equipImage);
                    }
                } else if (nextItem && nextItem.weaponType === 'shotgun') {
                    this.equippedRangedType = 'shotgun';
                    if (nextItem.equipImage) {
                        if (nextItem.canvasImageProp) {
                            this[nextItem.canvasImageProp] = loadImage(nextItem.equipImage);
                        }
                    }
                    if (nextItem.weaponAsset && nextItem.weaponAsset.muzzleImage) {
                        this.muzzleFlashImg = loadImage(nextItem.weaponAsset.muzzleImage);
                    }
                } else {
                    this.equippedRangedType = null;
                    this.equippedBowFrames = null;
                }
                // Play equip sound (bolt pull) for any gun with equipSound configured
                const equipSnd = getEquipSound(nextItem);
                if (equipSnd && SoundManager && SoundManager.playFile) {
                    SoundManager.playFile(equipSnd);
                }
                // 切换武器时结束符文长剑特殊攻击（未发射的剑淡出消失，持续300ms）
                if (this._runeSwordSpecialActive) {
                    this.runeSwordSystem._end(true);
                }
                // 切换武器时同步特殊攻击图标
                QuickBar.refreshSpecialAttack(this);
                // 切换武器时重置武器粒子效果
                this.weaponEffect.reset();
                // 切换武器时初始化弹药系统
                this._initAmmoForSlot(nextMode);
                // 应用/恢复装备的技能覆盖
                
                this._applySkillOverrides(nextItem);
                // 附魔效果：攻击间隔调整
                this._applyEnchantAttackInterval(nextItem);
                // 刷新技能栏显示（根据当前武器显示对应的冲刺攻击技能）
                if (SkillManager && SkillManager.renderSkillGrid) {
                    SkillManager.renderSkillGrid();
                }
            },

checkDualWieldUnequip(_slotKey) {
                // 主手1/副手1/主手2/副手2 各自独立，卸载时不影响其他槽位
                // 此函数保留仅用于兼容性，不再执行任何联动操作
                return;
            },

loadWeaponAssets(item) {
                if (!item) return;
                this.equippedRangedType = null;
                this.equippedBowFrames = null;
                const wt = item.weaponType;
                const wa = item.weaponAsset;
                if (!wt || !wa) return;
                if (wt === 'bow' && wa.framePrefix && wa.frameCount) {
                    const frames = [];
                    for (let i = 1; i <= wa.frameCount; i++) {
                        const num = String(i).padStart(wa.framePad || 2, '0');
                        frames.push(loadImage(wa.framePrefix + num + '.png'));
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                    // 设置弓类待机贴图
                    if (item.equipImage) {
                        this.bowEquipImage = loadImage(item.equipImage);
                    }
                } else if (wt === 'pistol' && wa.image) {
                    const canvasImageProp = item.canvasImageProp || 'pistolImage';
                    this[canvasImageProp] = loadImage(wa.image);
                    this.equippedRangedType = 'pistol';
                    if (wa.muzzleImage) { this.muzzleFlashImg = loadImage(wa.muzzleImage); }
                }
            },

_initAmmoForSlot(slot) {
                const item = this.equipments[slot];
                if (!item || !isGunWeapon(item)) {
                    this._ammoState[slot] = null;
                    return;
                }
                const ammoConfig = getAmmoConfig(item); // 实例缺 ammoConfig 时按 weaponId 回退 GUN_AMMO_CAP（与 combatant/图鉴/tooltip 同口径）
                if (!ammoConfig) {
                    this._ammoState[slot] = null;
                    return;
                }
                // 如果已经有弹药状态，保持当前弹药（换武器时不清空），否则初始化满弹
                let maxAmmo = ammoConfig.max;
                let reloadTime = ammoConfig.reloadTime;
                // 应用改造效果（弹夹容量、换弹时间、短枪管覆盖）
                if (item._craftEffects) {
                    const ce = item._craftEffects;
                    if (ce.magazineOverride) {
                        maxAmmo = ce.magazineOverride; // 短枪管覆盖弹夹容量
                    } else if (ce.magazineDelta) {
                        maxAmmo += ce.magazineDelta;
                    }
                    if (ce.magazinePercent) {
                        maxAmmo = Math.round(maxAmmo * (1 + ce.magazinePercent));
                    }
                    if (ce.reloadTimeDelta) reloadTime += ce.reloadTimeDelta;
                    if (maxAmmo < 1) maxAmmo = 1;
                    if (reloadTime < 100) reloadTime = 100;
                }
                if (!this._ammoState[slot] || this._ammoState[slot].weaponId !== item.weaponId) {
                    this._ammoState[slot] = {
                        weaponId: item.weaponId,
                        current: maxAmmo,
                        max: maxAmmo,
                        reloading: false,
                        reloadTimer: 0,
                        reloadTime: reloadTime,
                        reloadStartedEmpty: false
                    };
                } else {
                    // 同一武器，更新最大弹药数（防止配置变更）
                    this._ammoState[slot].max = maxAmmo;
                    this._ammoState[slot].reloadTime = reloadTime;
                    // 改造弹夹后容量减小，同步当前弹药不超过最大值
                    if (this._ammoState[slot].current > maxAmmo) {
                        this._ammoState[slot].current = maxAmmo;
                }
            }
        },
        /** 后摇打断：空格翻滚取消施法恢复动画（GameScene.cancelPlayerCast 同步清监听） */
        _interruptCastRecover() {
            if (this._castState !== 'recover') return;
            this._castState = 'idle';
            this._castReleaseDone = true;
            this._castOnRelease = null;
            const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
            if (scene && typeof scene.cancelPlayerCast === 'function') {
                scene.cancelPlayerCast();
            }
        },
        /** 施法跨步：前摇沿起手朝向推进到 +30px，后摇退回原位（每帧调用，WallSystem 解析防穿墙） */
        _updateCastStep() {
            if (!this._castState || this._castState === 'idle') return;
            const now = nowMs(); // Phase 3：收口单调时钟（_castStartTime/_castRecoverStartTime 写者在 GameScene，同口径）
            if (this._castState === 'casting') {
                const t = Math.min(1, (now - (this._castStartTime || now)) / (this._castForwardMs || 500));
                const targetX = (this._castOriginX ?? this.x) + (this._castStepDirX || 0) * (this._castStepMax || 30) * t;
                const targetY = (this._castOriginY ?? this.y) + (this._castStepDirY || 0) * (this._castStepMax || 30) * t;
                const resolved = WallSystem.resolve(
                    this.x, this.y, targetX, targetY, this.groundRadius,
                    WallSystem.ignoreForEntity ? WallSystem.ignoreForEntity(this) : null
                );
                this.x = resolved.x;
                this.y = resolved.y;
            } else if (this._castState === 'recover') {
                const t = Math.min(1, (now - (this._castRecoverStartTime || now)) / (this._castRecoverMs || 250));
                const ox = this._castOriginX ?? this._castRecoverOriginX ?? this.x;
                const oy = this._castOriginY ?? this._castRecoverOriginY ?? this.y;
                const rx = this._castRecoverOriginX ?? this.x;
                const ry = this._castRecoverOriginY ?? this.y;
                const targetX = ox + (rx - ox) * (1 - t);
                const targetY = oy + (ry - oy) * (1 - t);
                const resolved = WallSystem.resolve(
                    this.x, this.y, targetX, targetY, this.groundRadius,
                    WallSystem.ignoreForEntity ? WallSystem.ignoreForEntity(this) : null
                );
                this.x = resolved.x;
                this.y = resolved.y;
            }
        },

_getAmmoState(slot) {
                return this._ammoState[slot] || null;
            },

_isReloading(slot) {
                const state = this._ammoState[slot];
                return state && state.reloading;
            },

_hasAmmo(slot) {
                if (!this._ammoState[slot]) {
                    this._initAmmoForSlot(slot);
                }
                const state = this._ammoState[slot];
                return state && state.current > 0 && !state.reloading;
            },

_consumeAmmo(slot) {
                const state = this._ammoState[slot];
                if (!state || state.current <= 0) return false;
                state.current--;
                // 打空后自动换弹
                if (state.current <= 0) {
                    this._startReload(slot);
                }
                return true;
            },

_startReload(slot) {
                const state = this._ammoState[slot];
                if (!state || state.reloading || state.current >= state.max) {
                    
                    return false;
                }
                const item = this.equipments[slot];
                // 读 getAmmoConfig（item.ammoConfig || GUN_AMMO_CAP 回退）——
                // 商店/掉落等未经 EquipDataManager 合并的实例也能拿到 singleReloadMode（Super90 单发装填失效根因）
                const ammoConfig = getAmmoConfig(item);
                const singleReloadMode = ammoConfig && ammoConfig.singleReloadMode;
                const reloadSound = ammoConfig && ammoConfig.reloadSound;
                state.reloading = true;
                // 只记录本次换弹开始时是否已经空仓；主动中途换弹必须保持 false。
                state.reloadStartedEmpty = state.current <= 0;
                // 双持模式下换弹时间 +50%（副手为手枪或盾）
                let actualReloadTime = state.reloadTime;
                if (item && (item.weaponType === 'pistol' || item.rangedType === 'pistol')) {
                    const offSlot = slot === 'weapon' ? 'offhand' : (slot === 'weapon2' ? 'ring2' : (slot === 'offhand' ? 'weapon' : (slot === 'ring2' ? 'weapon2' : null)));
                    if (offSlot) {
                        const offItem = this.equipments[offSlot];
                        if (offItem && (offItem.weaponType === 'pistol' || offItem.weaponType === 'shield')) {
                            actualReloadTime = Math.round(actualReloadTime * 1.5);
                        }
                    }
                }
                state.reloadTimer = actualReloadTime;
                // 记录本次实际换弹时长（含双持 +50% 等修正；state.reloadTime 保持基础值，
                // 避免下次换弹在已加成的值上重复叠加）。UI 读 reloadDuration ?? reloadTime。
                state.reloadDuration = actualReloadTime;
                
                if (singleReloadMode) {
                    // 单发装填模式（如Super90）
                    state.singleReloadMode = true;
                    SoundManager.playFile(reloadSound || 'assets/sounds/weapons/Super90-reload.mp3');
                } else {
                    // 普通武器：一次性装填
                    state.singleReloadMode = false;
                    if (SoundManager && SoundManager.playFile) {
                        // 配置驱动：实例 reloadSound 优先（新枪配专属换弹音），
                        // 缺失回退通用换弹音（2026-08-08 去硬编码）
                        SoundManager.playFile(reloadSound || 'assets/sounds/weapons/reload_sharp.mp3', 1.69);
                    }
                }
                return true;
            },

_interruptReload(slot) {
                const state = this._ammoState[slot];
                
                if (!state || !state.reloading || !state.singleReloadMode) return false;
                state.reloading = false;
                state.reloadTimer = 0;
                state.reloadStartedEmpty = false;
                return true;
            },

_updateReload(dt) {
                const slots = ['weapon', 'offhand', 'weapon2', 'ring2'];
                for (const slot of slots) {
                    // 如果槽位有枪械但没有弹药状态，自动初始化
                    const item = this.equipments[slot];
                    if (item && isGunWeapon(item) && (!this._ammoState[slot] || this._ammoState[slot].weaponId !== item.weaponId)) {
                        
                        this._initAmmoForSlot(slot);
                    }
                    const state = this._ammoState[slot];
                    if (!state || !state.reloading) continue;
                    state.reloadTimer -= dt;
                    if (state.reloadTimer <= 0) {
                        state.reloadTimer = 0;
                        if (state.singleReloadMode) {
                            // 单发装填模式：支持快速装填器（每次装2发）
                            const item = this.equipments[slot];
                            const ce = item && item._craftEffects;
                            const reloadCount = (ce && ce.fastReload) ? 2 : 1;
                            state.current = Math.min(state.max, state.current + reloadCount);
                            
                            if (state.current >= state.max) {
                                state.reloading = false;
                                state.singleReloadMode = false;
                                this._gunSpreadShots = 0; // 主手换弹后重置主手散布
                                this._gunSpreadShotsOff = 0; // 同时重置副手散布
                                // 单发装填满弹时播放收尾音效（左轮：最后一发+转轮回摆合上；
                                // 未配置 reloadFinishSound 时回退枪栓音）
                                if (SoundManager && SoundManager.playFile) {
                                    const ammoCfg = getAmmoConfig(item);
                                    const finishSnd = ammoCfg && ammoCfg.reloadFinishSound;
                                    SoundManager.playFile(finishSnd || 'assets/sounds/weapons/bolt_pull_1s_clean.wav');
                                }
                            } else {
                                // 继续装填下一发
                                state.reloadTimer = (state.reloadDuration || state.reloadTime);
                                const ammoCfg2 = getAmmoConfig(item);
                                const roundSnd = ammoCfg2 && ammoCfg2.reloadSound;
                                SoundManager.playFile(roundSnd || 'assets/sounds/weapons/Super90-reload.mp3');
                            }
                        } else {
                            // 普通武器：一次性装满
                            const completedEmptyReload = state.reloadStartedEmpty === true;
                            state.reloading = false;
                            state.current = state.max;
                            state.reloadStartedEmpty = false;
                            this._gunSpreadShots = 0; // 主手换弹后重置主手散布
                            this._gunSpreadShotsOff = 0; // 同时重置副手散布
                            // 自动步枪只有打空后的换弹完成时才追加一次统一枪机闭锁声；
                            // 中途主动换弹不会播放这条收尾音。
                            if (completedEmptyReload && item && isRifle(item.weaponType)
                                && SoundManager && SoundManager.playFile) {
                                const finishSnd = getEquipSound(item);
                                if (finishSnd) SoundManager.playFile(finishSnd);
                            }
                        }
                    }
                }
            },

reloadCurrentWeapon() {
                if (this._isPushStrike) return false;
                const currentSlot = this.weaponMode;
                const currentItem = this.equipments[currentSlot];
                if (!currentItem || !isGunWeapon(currentItem)) return;
                // 主手换弹
                this._startReload(currentSlot);
                // 双持时副手也换弹
                let offhandSlot = null;
                if (currentSlot === 'weapon') offhandSlot = 'offhand';
                else if (currentSlot === 'weapon2') offhandSlot = 'ring2';
                if (offhandSlot) {
                    const offhandItem = this.equipments[offhandSlot];
                    if (offhandItem && isGunWeapon(offhandItem)) {
                        this._startReload(offhandSlot);
                    }
                }
            },

getAmmoDisplay() {
                const result = [];
                const currentSlot = this.weaponMode;
                const currentItem = this.equipments[currentSlot];
                if (!currentItem || !isGunWeapon(currentItem)) return result;
                // 主手
                const mainState = this._ammoState[currentSlot];
                if (mainState) {
                    result.push({
                        name: currentItem.name,
                        current: mainState.current,
                        max: mainState.max,
                        reloading: mainState.reloading,
                        reloadPercent: mainState.reloading ? 1 - (mainState.reloadTimer / (mainState.reloadDuration || mainState.reloadTime)) : 0,
                        isMain: true
                    });
                }
                // 副手（双持时）
                let offhandSlot = null;
                if (currentSlot === 'weapon') offhandSlot = 'offhand';
                else if (currentSlot === 'weapon2') offhandSlot = 'ring2';
                if (offhandSlot) {
                    const offhandItem = this.equipments[offhandSlot];
                    const offState = this._ammoState[offhandSlot];
                    if (offhandItem && isGunWeapon(offhandItem) && offState) {
                        result.push({
                            name: offhandItem.name,
                            current: offState.current,
                            max: offState.max,
                            reloading: offState.reloading,
                            reloadPercent: offState.reloading ? 1 - (offState.reloadTimer / (offState.reloadDuration || offState.reloadTime)) : 0,
                            isMain: false
                        });
                    }
                }
                return result;
            },

_initAmmoDisplay() {
                if (this._ammoDisplayEl) return;
                const el = document.createElement('div');
                el.id = '_ammoDisplay';
                el.style.cssText = 'position:fixed;bottom:20px;right:20px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:9999;pointer-events:none;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;transition:opacity 0.3s;';
                document.body.appendChild(el);
                this._ammoDisplayEl = el;
            },

_updateAmmoDisplay() {
                if (!this._ammoDisplayEl) return;
                const ammoData = this.getAmmoDisplay();
                if (ammoData.length === 0) {
                    this._ammoDisplayEl.style.opacity = '0';
                    this._ammoDisplayEl.innerHTML = '';
                    return;
                }
                this._ammoDisplayEl.style.opacity = '1';
                let html = '';
                for (const data of ammoData) {
                    const color = data.reloading ? '#888888' : (data.current <= data.max * 0.2 ? '#ff6b6b' : '#d4c5a9');
                    // 无限弹药（能量轻机枪 max=Infinity）：显示"无限"而非 Infinity/Infinity
                    const statusText = data.reloading
                        ? `换弹中 ${Math.ceil(data.reloadPercent * 100)}%`
                        : (Number.isFinite(data.max) ? `${data.current}/${data.max}` : '∞ 无限');
                    html += `<div style="background:rgba(40,35,30,0.85);color:${color};padding:4px 10px;border-radius:6px;border:1px solid rgba(120,100,80,0.5);font-size:14px;white-space:nowrap;"><span style="font-size:12px;color:#8a7a6a;margin-right:4px;">${data.isMain ? '主' : '副'}</span>${data.name}: ${statusText}</div>`;
                }
                this._ammoDisplayEl.innerHTML = html;
            },

_getOffhandAnimMs(offhandItem, baseMs) {
                if (!offhandItem) return baseMs;
                let cfgKey = 'sword';
                if (offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol') cfgKey = offhandItem.animConfigKey || 'pistol';
                else if (AUTO_GUN_FAMILY.includes(offhandItem.weaponType)) cfgKey = offhandItem.weaponType;
                else if (offhandItem.weaponType === 'bow') cfgKey = 'bow';
                const cfg = WeaponAnimConfig[cfgKey];
                const mul = (cfg ? cfg.timingMul : 1) * (this.animTimingMul || 1);
                return Math.round(baseMs * mul);
            },

_getEffectivePiercing(basePiercing, item) {
                let result = (typeof basePiercing === 'number') ? basePiercing : 0;
                if (item) {
                    if (item._enchantEffects && item._enchantEffects.piercingBonus) {
                        result += item._enchantEffects.piercingBonus;
                    }
                    if (item._craftEffects && item._craftEffects.piercingBonus) {
                        result += item._craftEffects.piercingBonus;
                    }
                }
                return result;
            },

_prepareCalibrationShot(item) {
                const params = item && item.calibrationShotParams;
                if (!params) return null;
                if (!this._calibrationShotStates) this._calibrationShotStates = new WeakMap();
                let state = this._calibrationShotStates.get(item);
                if (!state) {
                    state = { hits: 0, charged: false };
                    this._calibrationShotStates.set(item, state);
                }
                const effects = item._craftEffects || {};
                const hitsRequired = Math.max(2, Math.round((Number(params.hitsRequired) || 8) + (Number(effects.calibrationHitsRequiredDelta) || 0)));
                const damageMultiplier = Math.max(1, (Number(params.damageMultiplier) || 1.8) + (Number(effects.calibrationDamageMultiplierDelta) || 0));
                const piercingBonus = Math.max(0, Math.round((Number(params.piercingBonus) || 2) + (Number(effects.calibrationPiercingBonusDelta) || 0)));
                if (state.charged) {
                    state.charged = false;
                    state.hits = 0;
                    return { charged: true, damageMultiplier, piercingBonus, onFirstHit: null };
                }
                return {
                    charged: false,
                    damageMultiplier: 1,
                    piercingBonus: 0,
                    onFirstHit: () => {
                        if (state.charged) return;
                        state.hits += 1;
                        if (state.hits >= hitsRequired) {
                            state.hits = 0;
                            state.charged = true;
                        }
                    }
                };
            },

_prepareRhythmBurstShot(item) {
                const params = item && item.rhythmBurstParams;
                if (!params) return null;
                if (!this._rhythmBurstStates) this._rhythmBurstStates = new WeakMap();
                let state = this._rhythmBurstStates.get(item);
                if (!state) {
                    state = { shot: 0, lastShotAt: 0 };
                    this._rhythmBurstStates.set(item, state);
                }
                const effects = item._craftEffects || {};
                const resetMs = Math.max(100, (Number(params.resetMs) || 450) + (Number(effects.rhythmResetMsDelta) || 0));
                const now = Date.now();
                if (now - state.lastShotAt > resetMs) state.shot = 0;
                state.lastShotAt = now;
                state.shot += 1;
                const startShot = Math.max(1, Math.round((Number(params.startShot) || 5) + (Number(effects.rhythmStartShotDelta) || 0)));
                const endShot = Math.max(startShot, Math.round((Number(params.endShot) || 12) + (Number(effects.rhythmEndShotDelta) || 0)));
                const damageMultiplier = Math.max(1, (Number(params.damageMultiplier) || 1.28) + (Number(effects.rhythmDamageMultiplierDelta) || 0));
                const sweet = state.shot >= startShot && state.shot <= endShot;
                return { sweet, damageMultiplier: sweet ? damageMultiplier : 1, spreadMultiplier: sweet ? 0.45 : 1 };
            },

_prepareConvergenceShot(item) {
                const params = item && item.convergenceParams;
                if (!params) return null;
                if (!this._convergenceShotStates) this._convergenceShotStates = new WeakMap();
                let state = this._convergenceShotStates.get(item);
                if (!state) {
                    state = { shot: 0, lastShotAt: 0 };
                    this._convergenceShotStates.set(item, state);
                }
                const effects = item._craftEffects || {};
                const resetMs = Math.max(100, (Number(params.resetMs) || 320) + (Number(effects.convergenceResetMsDelta) || 0));
                const now = Date.now();
                if (now - state.lastShotAt > resetMs) state.shot = 0;
                state.lastShotAt = now;
                state.shot += 1;
                const startShot = Math.max(2, Math.round((Number(params.startShot) || 6) + (Number(effects.convergenceStartShotDelta) || 0)));
                const maxStacks = Math.max(1, Math.round((Number(params.maxStacks) || 10) + (Number(effects.convergenceMaxStacksDelta) || 0)));
                const stack = Math.min(maxStacks, Math.max(0, state.shot - startShot + 1));
                const damagePerStack = Math.max(0, (Number(params.damagePerStack) || 0.02) + (Number(effects.convergenceDamagePerStackDelta) || 0));
                const spreadPerStack = Math.max(0, (Number(params.spreadPerStack) || 0.035) + (Number(effects.convergenceSpreadPerStackDelta) || 0));
                return {
                    stack,
                    damageMultiplier: 1 + stack * damagePerStack,
                    spreadMultiplier: Math.max(0.35, 1 - stack * spreadPerStack),
                };
            },

_playFireSound(item, defaultSound = 'gun_fire', branchSound = null) {
                // 改造音效覆盖（如 P4040 锤击点弹药）优先于武器自带 fireSound
                const sound = (item && item._craftEffects && item._craftEffects.fireSoundOverride)
                    || branchSound || getFireSound(item) || defaultSound;
                if (!SoundManager) return;
                if (sound.startsWith('assets/')) {
                    if (SoundManager.playGunshot) SoundManager.playGunshot(sound);
                    else SoundManager.playFile(sound);
                } else {
                    SoundManager.play(sound);
                }
            },

_getMuzzlePosition(gunLX, gunLY, forwardOffset = 0) {
                const c = Math.cos(this.rotation), sin = Math.sin(this.rotation);
                return {
                    x: this.x + c * (gunLX + forwardOffset) - sin * gunLY,
                    // 高架表面：兜底枪口同样跟随实体z抬升
                    y: this.y + sin * (gunLX + forwardOffset) + c * gunLY - (this.z || 0)
                };
            },

_spawnMuzzleFlash(gunLX, gunLY, forwardOffset, angle, scale) {
                const pos = this._getMuzzlePosition(gunLX, gunLY, forwardOffset);
                EffectFactory.createMuzzleFlash(pos.x, pos.y, angle, scale);
            },

_spawnMuzzleFlashAt(x, y, angle, scale) {
                EffectFactory.createMuzzleFlash(x, y, angle, scale);
            },

/**
 * 从 Phaser 武器精灵计算真实枪口世界坐标。
 * 枪口点读配置 WeaponAnimConfig[wt].muzzle {x, y}（贴图内分数坐标），
 * 缺省 = 贴图右缘中心（旧行为）；随贴图旋转，子弹/火焰同点。
 * 如果当前没有对应的武器精灵，返回 null，由调用方回退到旧的脚底相对算法。
 */
_getMuzzleWorldPosition(hand = 'main') {
                const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
                if (!scene) return null;
                const sprite = hand === 'offhand' ? scene.offhandWeaponSprite : scene.weaponSprite;
                // 不检查 sprite.active：地图模式曾置 false，位置仍由 syncWeapon 每帧同步，可见即可用
                if (!sprite || !sprite.visible || !sprite.texture) return null;
                const slot = hand === 'offhand' ? (this.weaponMode === 'weapon' ? 'offhand' : 'ring2') : this.weaponMode;
                const item = this.equipments && this.equipments[slot];
                const wt = item && (item.animConfigKey || item.weaponType);
                // 枪口点优先级：手动覆盖（muzzle.manual）> BootScene 自动烘焙（贴图最前端）> 配置 muzzle > 贴图右缘中心
                const baked = (typeof window !== 'undefined' && window.__weaponMuzzlePoints)
                    ? window.__weaponMuzzlePoints[sprite.texture.key] : null;
                const m = wt && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].muzzle;
                const useManual = m && m.manual === true;
                const fracX = useManual ? m.x : (baked ? baked.fx : (m && m.x !== undefined ? m.x : 1.0));
                const fracY = useManual ? m.y : (baked ? baked.fy : (m && m.y !== undefined ? m.y : 0.5));
                // 出生点偏移（配置 muzzle.forward / muzzle.up）：forward 沿枪管前移（默认 8px），up 世界上移（默认 5px）
                const fwd = m && m.forward !== undefined ? m.forward : 8;
                const up = m && m.up !== undefined ? m.up : 5;
                const offX = (fracX - 0.5) * sprite.displayWidth + fwd;
                let offY = (fracY - 0.5) * sprite.displayHeight;
                // 镜像对称：贴图 flipY（瞄左）时贴图内 Y 偏移必须同步取反（"火焰左右不对称"根因）。
                // 判定读 sprite.flipY（渲染侧权威状态），不用 |rotation|>90° 反推——
                // rotOffset（-6°）会让 90°~96° 窗口内反推结果与实际 flip 相反（副手错位根因）
                if (sprite.flipY) offY = -offY;
                const cos = Math.cos(sprite.rotation);
                const sin = Math.sin(sprite.rotation);
                // 副手专属偏移（配置 muzzle.offhandOffsetX/Y，世界 px）：双持手枪副手开火位微调
                let ohx = 0, ohy = 0;
                if (hand === 'offhand' && m) {
                    if (m.offhandOffsetX) ohx = m.offhandOffsetX;
                    if (m.offhandOffsetY) ohy = m.offhandOffsetY;
                }
                return {
                    x: sprite.x + cos * offX - sin * offY + ohx,
                    y: sprite.y + sin * offX + cos * offY - up + ohy,
                    angle: sprite.rotation
                };
            },

            /** 把2D瞄准点补成伪3D直线弹道参数；目标缺少实体高度时默认瞄准身体下段。 */
            _projectileAim3D(spawnPos, targetX, targetY, targetZ = 24, visualAngle = null, entities = null) {
                const startZ = (Number(this.z) || 0) + (this.collider?.height || this.size || 40) * 0.58;
                const groundY = spawnPos.y + startZ;
                const visualBase = Math.atan2(targetY - spawnPos.y, targetX - spawnPos.x);
                const spread = Number.isFinite(visualAngle) ? visualAngle - visualBase : 0;
                let groundTargetX = targetX;
                let groundTargetY = targetY;
                let resolvedTargetZ = targetZ;
                let bestDist = 90;
                const candidates = entities?.values ? entities.values() : (entities || []);
                for (const entity of candidates) {
                    if (!entity?.active || !entity.hittable || entity === this) continue;
                    const visualX = entity._phaserSprite?.x ?? entity.x;
                    const visualY = entity._phaserSprite?.y
                        ?? (entity.y - (Number(entity.z) || 0) - (entity.collider?.height || 40) * 0.5);
                    const distance = Math.hypot(targetX - visualX, targetY - visualY);
                    if (distance >= bestDist) continue;
                    bestDist = distance;
                    groundTargetX = entity.collider?.x ?? entity.x;
                    groundTargetY = entity.collider?.y ?? entity.y;
                    resolvedTargetZ = entity.collider?.centerZ
                        ?? ((Number(entity.z) || 0) + (entity.collider?.height || 40) * 0.5);
                }
                return {
                    z: startZ,
                    targetZ: resolvedTargetZ,
                    groundY,
                    groundAngle: Math.atan2(groundTargetY - groundY, groundTargetX - spawnPos.x) + spread,
                    aimDistance: Math.max(1, Math.hypot(groundTargetX - spawnPos.x, groundTargetY - groundY)),
                };
            },

_spawnMuzzleFireAt(x, y) {
                // 特工突击同款开火火光（金色粒子爆发）
                const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
                if (scene && typeof scene.playMuzzleFire === 'function') {
                    scene.playMuzzleFire(x, y);
                }
            },

_spawnShellCasing(hand, gunLX, gunLY, shellOffset, angle) {
                // 优先：蛋壳从枪械贴图中心弹出，向上抛起后受重力掉落至脚下（2026-07-17 调整）
                const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
                const sprite = scene ? (hand === 'offhand' ? scene.offhandWeaponSprite : scene.weaponSprite) : null;
                // 不检查 sprite.active：与 _getMuzzleWorldPosition 同口径，可见即可用
                if (sprite && sprite.visible && sprite.texture) {
                    EffectFactory.createShellCasing(sprite.x, sprite.y, angle, this.y);
                    return;
                }
                // 回退：无武器贴图时使用旧的脚底相对算法
                const c = Math.cos(this.rotation), sin = Math.sin(this.rotation);
                const x = this.x + c * (gunLX + shellOffset.fx) - sin * (gunLY + shellOffset.fy);
                const y = this.y + sin * (gunLX + shellOffset.fx) + c * (gunLY + shellOffset.fy);
                EffectFactory.createShellCasing(x, y, angle);
            },

_getGunSpreadTuning(item) {
                const craftEffects = item?._craftEffects || null;
                const canonical = findWeaponConfig(item?.weaponId, item?.name);
                const spread = (craftEffects && craftEffects.spreadParamsOverride)
                    || canonical?.spreadParams || item?.spreadParams || {};
                const attackKey = item?.attackKey || (item?.weaponType === 'pistol' ? 'pistol' : item?.weaponType);
                const intervalMs = this._getEffectiveGunAttackInterval(item, attackKey);
                const msToShots = (ms) => Number(ms) / intervalMs;

                let startShots = Number.isFinite(Number(spread.startShots))
                    ? Number(spread.startShots)
                    : Math.max(0, msToShots(spread.startDelay ?? 500));
                let maxShots = Number.isFinite(Number(spread.maxShots))
                    ? Number(spread.maxShots)
                    : startShots + Math.max(1, msToShots(spread.maxTime ?? 1800));
                let recoveryMs = Math.max(100, Number(spread.recoveryMs) || Math.max(280, intervalMs * 2.5));
                let maxAngle = Math.max(0, Number(spread.maxAngle) || WEAPON_FX_CONFIG.defaultMaxSpreadAngle);

                if (craftEffects) {
                    const startDeltaShots = msToShots(craftEffects.spreadStartDelta || 0);
                    startShots += startDeltaShots;
                    maxShots += startDeltaShots + msToShots(craftEffects.spreadTimeDelta || 0);
                    maxAngle += craftEffects.maxSpreadAngleDelta || 0;
                    recoveryMs += craftEffects.recoilRecoveryDelta || 0;
                    if (craftEffects.fireModeOverride === 'fullAuto') {
                        const autoStartShots = msToShots(craftEffects.autoSpreadStartDelta || 0);
                        startShots += autoStartShots;
                        maxShots += autoStartShots + msToShots(craftEffects.autoSpreadTimeDelta || 0);
                        maxAngle += craftEffects.autoMaxSpreadAngleDelta || 0;
                    }
                    const stateSpread = this.isMoving
                        ? (craftEffects.moveSpreadPercent || 0)
                        : (craftEffects.stationarySpreadPercent || 0);
                    maxAngle *= Math.max(0.1, 1 + stateSpread);
                }

                // 瞄准不取消后坐力，只把稳定连射窗口向后推，保留瞄具/点射改造的收益。
                if (this._aimModeActive) {
                    const aimBonusShots = Math.max(2, Math.round(600 / intervalMs));
                    startShots += aimBonusShots;
                    maxShots += aimBonusShots;
                }

                startShots = Math.max(0, startShots);
                maxShots = Math.max(startShots + 1, maxShots);
                recoveryMs = Math.max(100, recoveryMs);
                // “每次射击散布±N°”必须进入实际弹道：按散布成长区间折算到最大角，
                // 准星与投射物继续共用该 tuning，避免只有文案/kick 生效。
                const growthShots = Math.max(1, maxShots - startShots);
                maxAngle += (Number(craftEffects?.shotSpreadDelta) || 0) * growthShots;
                maxAngle = Math.max(0, Math.min(45, maxAngle));
                const fixedSpread = item?.weaponType === 'shotgun' && !(craftEffects && craftEffects.slugMode);
                return { startShots, maxShots, recoveryMs, maxAngle, fixedSpread };
            },

_spreadFactorFromShots(shots, tuning) {
                if (tuning.fixedSpread) return 1;
                return Math.min(1, Math.max(0,
                    ((Number(shots) || 0) - tuning.startShots) /
                    Math.max(1, tuning.maxShots - tuning.startShots)));
            },

_getSlugSpreadTuning(item) {
                const ce = item?._craftEffects || null;
                const perShotAngle = Math.max(0, 5 + (Number(ce?.shotSpreadDelta) || 0));
                const baseCap = item?.weaponId === 'weapon12' ? 15 : 20;
                const maxAngle = Math.max(0, Math.min(45,
                    baseCap + (Number(ce?.maxSpreadAngleDelta) || 0)));
                const recoveryMs = Math.max(100, 500 + (Number(ce?.slugRecoilRecovery) || 0));
                return { perShotAngle, maxAngle, recoveryMs };
            },

_registerGunSpreadShot(hand, item) {
                const tuning = this._getGunSpreadTuning(item);
                const isOffhand = hand === 'offhand';
                const heatKey = isOffhand ? '_gunSpreadShotsOff' : '_gunSpreadShots';
                const factorKey = isOffhand ? '_currentSpreadFactorOff' : '_currentSpreadFactor';
                const angleKey = isOffhand ? '_currentSpreadMaxAngleOff' : '_currentSpreadMaxAngle';
                this[heatKey] = Math.min(tuning.maxShots, (Number(this[heatKey]) || 0) + 1);
                this[factorKey] = this._spreadFactorFromShots(this[heatKey], tuning);
                this[angleKey] = tuning.maxAngle;

                // 单发 kick 只用于准星的瞬时反馈；实际弹道散布由上面的发数热量决定。
                const shotSpreadDelta = Number(item?._craftEffects?.shotSpreadDelta) || 0;
                this._crosshairShotKick = Math.max(
                    Number(this._crosshairShotKick) || 0,
                    Math.max(0.35, 1.2 + shotSpreadDelta)
                );
            },

_getGunBallistics(item, fallbackRange) {
                const craftEffects = item?._craftEffects || null;
                const canonical = findWeaponConfig(item?.weaponId, item?.name);
                const attack = canonical?.attack || item?.attack || null;
                const rangeDelta = Number(craftEffects?.rangeDelta) || 0;
                const baseRange = Math.max(100, Number(attack?.range) || Number(fallbackRange) || 100);
                const maxRange = Math.max(100, baseRange + rangeDelta);
                const falloff = attack?.damageFalloff;
                if (!falloff) return { maxRange, damageFalloff: null };

                // 正射程改造把完整伤害距离推进60%，其余部分成为更远的衰减尾段；负射程全额收缩。
                const startShift = rangeDelta >= 0 ? rangeDelta * 0.6 : rangeDelta;
                const start = Math.min(maxRange, Math.max(0, (Number(falloff.start) || baseRange) + startShift));
                return {
                    maxRange,
                    damageFalloff: {
                        start,
                        minMultiplier: Math.max(0.05, Math.min(1, Number(falloff.minMultiplier) || 0.4))
                    }
                };
            },

_fireRanged(hand = 'main') {
                const d = this.rangedFireData;
                if (!d) return;

                // 瞄准死区激活：弹道跟随可调锥有效角而非贴脸准心（枪械近战弱的设计设定，
                // 与姿态/贴图/锚点同口径；aimDeadZone=0 可整体关闭该机制）
                const frozenScene = typeof window !== 'undefined' ? window.__phaserScene : null;
                if (frozenScene && frozenScene._frozenAimActive && frozenScene._effectiveAim !== undefined) {
                    const FAR = 2000;
                    d.targetX = this.x + Math.cos(frozenScene._effectiveAim) * FAR;
                    d.targetY = this.y + Math.sin(frozenScene._effectiveAim) * FAR;
                }

                // 开火手感反馈（trauma 微震 + zoom punch；重武器另有 Camera.triggerShake 大力震屏）
                if (GunFeel) GunFeel.onShot(this.equipments[this.weaponMode]);

                // === 副手独立处理 ===
                if (hand === 'offhand') {
                    const offhandSlot = d.offhandSlot || (this.weaponMode === 'weapon' ? 'offhand' : 'ring2');
                    const offhandItem = this.equipments[offhandSlot];
                    if (offhandItem && d.fireOffhand && (offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol')) {
                        const offhandHasAmmo = this._hasAmmo(offhandSlot);
                        if (offhandHasAmmo) {
                            this._consumeAmmo(offhandSlot);
                            this._registerGunSpreadShot('offhand', offhandItem);
                            const mythicHandCannonShot = prepareMythicHandCannonShot(offhandItem);
                            const legendaryPistolOnHit = createLegendaryPistolHitHandler(this, offhandItem, d.entities);
                            const offhandAttackKey = offhandItem.offhandAttackKey || 'pistolOffhand';
                            const offPC = this.attacks[offhandAttackKey].config;
                            const fxCfg = WEAPON_FX_CONFIG.pistolOffhand;
                            const gunLX = this.size + fxCfg.gunLX;
                            const leftGunLY = fxCfg.gunLY;
                            let muzzlePos = this._getMuzzleWorldPosition('offhand');
                            if (!muzzlePos) muzzlePos = this._getMuzzlePosition(gunLX, leftGunLY, fxCfg.muzzleForward);
                            const leftAngle = Math.atan2(d.targetY - muzzlePos.y, d.targetX - muzzlePos.x);
                            let offhandSpreadFactor = this._currentSpreadFactorOff;
                            const offhandMaxSpreadAngle = this._currentSpreadMaxAngleOff || WEAPON_FX_CONFIG.defaultMaxSpreadAngle;
                            const leftSpreadRad = (Math.random() - 0.5) * 2 * (offhandMaxSpreadAngle * Math.PI / 180) * offhandSpreadFactor;
                            const leftFinalAngle = leftAngle + leftSpreadRad
                                * (mythicHandCannonShot?.spreadMultiplier || 1);
                            let offhandDamage = offPC.damage.min;
                            if (this.getCurrentWeaponAtk) {
                                offhandDamage = this.getCurrentWeaponAtk(offhandItem);
                            }
                            offhandDamage = Math.round(offhandDamage
                                * (mythicHandCannonShot?.damageMultiplier || 1));
                            const offhandDamageObj = { min: offhandDamage, max: offhandDamage };
                            const offIsDarkGold = offhandItem.isDarkGold || false;
                            const offBallistics = this._getGunBallistics(offhandItem, offPC.projectileRange);
                            const offCraftEffects = offhandItem._craftEffects || {};
                            const offSpeed = offPC.projectileSpeed
                                * Math.max(0.1, 1 + (Number(offCraftEffects.projectileSpeedPercent) || 0));
                            const offKnockback = (Number(offPC.knockback) || 0)
                                + (Number(offCraftEffects.knockbackDelta) || 0)
                                + (Number(mythicHandCannonShot?.knockbackDelta) || 0);
                            ProjectileFactory.create({
                                x: muzzlePos.x, y: muzzlePos.y, angle: leftFinalAngle,
                                ...this._projectileAim3D(muzzlePos, d.targetX, d.targetY, 24, leftFinalAngle, d.entities),
                                speed: offSpeed, maxRange: offBallistics.maxRange, size: offPC.projectileSize,
                                damage: offhandDamageObj, piercing: this._getEffectivePiercing(offPC.piercing, offhandItem)
                                    + (mythicHandCannonShot?.piercingBonus || 0),
                                knockback: offKnockback,
                                source: this, effectWeapon: offhandItem, entities: d.entities, image: null,
                                isTracer: !offIsDarkGold, isDarkGold: offIsDarkGold,
                                isPurple: mythicHandCannonShot?.kind === 'sanctified',
                                isCrimson: !!offhandItem.bloodDebtParams,
                                isCyan: mythicHandCannonShot?.kind === 'duelist' || !!offhandItem.corridorParams,
                                onFirstHit: legendaryPistolOnHit,
                                damageFalloff: offBallistics.damageFalloff,
                                playerGunWallSparks: true
                            });
                            this._playFireSound(offhandItem, fxCfg.defaultSound);
                            this._spawnMuzzleFlashAt(muzzlePos.x, muzzlePos.y, leftFinalAngle, fxCfg.muzzleScale);
                            this._spawnMuzzleFireAt(muzzlePos.x, muzzlePos.y);
                            this._spawnShellCasing('offhand', gunLX, leftGunLY, fxCfg.shellOffset, leftFinalAngle);
                        }
                        delete d.fireOffhand;
                    }
                    if (d && !d.fireMainHand && !d.fireOffhand) {
                        this.rangedFired = true; this.rangedFireData = null;
                    }
                    return;
                }

                // === 主手处理 ===
                const mainSlot = d.mainSlot || this.weaponMode;
                const currentItem = this.equipments[mainSlot];
                const isPistol = currentItem && (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol');
                const isBow = currentItem && currentItem.weaponType === 'bow';
                const isPkmOrAkm = currentItem && AUTO_GUN_FAMILY.includes(currentItem.weaponType);
                const isShotgun = currentItem && currentItem.weaponType === 'shotgun';
                const wac = WeaponAnimConfig[isPistol ? 'pistol' : (isBow ? 'bow' : (isPkmOrAkm ? currentItem.weaponType : (isShotgun ? 'shotgun' : 'sword')))];
                const _holdX = wac ? wac.holdOffsetX : WEAPON_ANIM.holdX;
                const holdY = wac ? wac.holdOffsetY : WEAPON_ANIM.holdY;
                if (isPistol) {
                    // 检测是否双持手枪（任何手枪组合均可）
                    const mainAttackKey = currentItem.attackKey || 'pistol';
                    // 从 rangedFireData 获取槽位信息
                    const mainSlot = d.mainSlot || this.weaponMode;
                    const offhandSlot = d.offhandSlot || (this.weaponMode === 'weapon' ? 'offhand' : 'ring2');
                    const offhandItem = this.equipments[offhandSlot];
                    const _offhandAttackKey = offhandItem && offhandItem.offhandAttackKey || 'pistolOffhand';
                    const fxCfg = WEAPON_FX_CONFIG.pistol;
                    const gunLX = this.size + fxCfg.gunLX, gunLY = fxCfg.gunLY;

                    // === 左键：主手开火 ===
                    if (d.fireMainHand) {
                        const mainHasAmmo = this._hasAmmo(mainSlot);
                        if (mainHasAmmo) {
                            this._consumeAmmo(mainSlot);
                            this._registerGunSpreadShot('main', currentItem);
                            const mythicHandCannonShot = prepareMythicHandCannonShot(currentItem);
                            const legendaryPistolOnHit = createLegendaryPistolHitHandler(this, currentItem, d.entities);
                            let muzzlePos = this._getMuzzleWorldPosition('main');
                            if (!muzzlePos) muzzlePos = this._getMuzzlePosition(gunLX, gunLY, fxCfg.muzzleForward);
                            const angle = Math.atan2(d.targetY - muzzlePos.y, d.targetX - muzzlePos.x);
                            // 散布：使用统一的散布系统（所有枪械散布计算时间0.5s）
                            const mainSpreadFactor = this._currentSpreadFactor;
                            const maxSpreadAngle = this._currentSpreadMaxAngle || WEAPON_FX_CONFIG.defaultMaxSpreadAngle;
                            const spreadRad = (Math.random() - 0.5) * 2 * (maxSpreadAngle * Math.PI / 180) * mainSpreadFactor;
                            const finalAngle = angle + spreadRad
                                * (mythicHandCannonShot?.spreadMultiplier || 1);
                            const mainPC = this.attacks[mainAttackKey].config;
                            let mainDamage = mainPC.damage.min;
                            if (this.getCurrentWeaponAtk) {
                                mainDamage = this.getCurrentWeaponAtk();
                            }
                            mainDamage = Math.round(mainDamage
                                * (mythicHandCannonShot?.damageMultiplier || 1));
                            const mainDamageObj = { min: mainDamage, max: mainDamage };
                            // 创建主手弹丸
                            const mainIsDarkGold = currentItem.isDarkGold || false;
                            const mainBallistics = this._getGunBallistics(currentItem, mainPC.projectileRange);
                            const mainCraftEffects = currentItem._craftEffects || {};
                            const mainSpeed = mainPC.projectileSpeed
                                * Math.max(0.1, 1 + (Number(mainCraftEffects.projectileSpeedPercent) || 0));
                            const mainKnockback = (Number(mainPC.knockback) || 0)
                                + (Number(mainCraftEffects.knockbackDelta) || 0)
                                + (Number(mythicHandCannonShot?.knockbackDelta) || 0);
                            ProjectileFactory.create({
                                x: muzzlePos.x, y: muzzlePos.y, angle: finalAngle,
                                ...this._projectileAim3D(muzzlePos, d.targetX, d.targetY, 24, finalAngle, d.entities),
                                speed: mainSpeed, maxRange: mainBallistics.maxRange, size: mainPC.projectileSize,
                                damage: mainDamageObj, piercing: this._getEffectivePiercing(mainPC.piercing, currentItem)
                                    + (mythicHandCannonShot?.piercingBonus || 0),
                                knockback: mainKnockback,
                                source: this, effectWeapon: currentItem, entities: d.entities, image: null,
                                isTracer: !mainIsDarkGold, isDarkGold: mainIsDarkGold,
                                isPurple: mythicHandCannonShot?.kind === 'sanctified',
                                isCrimson: !!currentItem.bloodDebtParams,
                                isCyan: mythicHandCannonShot?.kind === 'duelist' || !!currentItem.corridorParams,
                                onFirstHit: legendaryPistolOnHit,
                                damageFalloff: mainBallistics.damageFalloff,
                                playerGunWallSparks: true
                            });
                            // 主手开火音效
                            this._playFireSound(currentItem, fxCfg.defaultSound);
                            // 主手枪口火焰特效
                            this._spawnMuzzleFlashAt(muzzlePos.x, muzzlePos.y, finalAngle, fxCfg.muzzleScale);
                            this._spawnMuzzleFireAt(muzzlePos.x, muzzlePos.y);
                            // 弹壳从抛壳窗弹出（枪身右侧后方）
                            this._spawnShellCasing('main', gunLX, gunLY, fxCfg.shellOffset, angle);
                        }
                        delete d.fireMainHand;
                    }
                    // 副手开火已移到 hand === 'offhand' 分支独立处理
                } else if (isPkmOrAkm) {
                    // 只处理明确标记为主手开火的情况
                    if (d.fireMainHand) {
                        const craftEffects = currentItem && currentItem._craftEffects;
                        const mainSlot = d.mainSlot || this.weaponMode;
                        const attackKey = currentItem.weaponType;
                        const isEnergyLMG = attackKey === 'energy_lmg';

                        // 能量轻机枪：不消耗弹药，其他机枪消耗弹药
                        if (!isEnergyLMG) {
                            if (this._hasAmmo(mainSlot)) {
                                this._consumeAmmo(mainSlot);
                            }
                        }
                        const overdriveShot = this._registerOverdriveHeatShot(currentItem, mainSlot);
                        const rhythmShot = this._prepareRhythmBurstShot(currentItem);
                        const convergenceShot = this._prepareConvergenceShot(currentItem);
                        const energyParams = isEnergyLMG ? this._getEnergyLMGParams() : null;
                        const energyAtPeak = !!(energyParams
                            && this._energyLMGFireTime >= energyParams.rampUpTime);
                        const energyPeakDamageMultiplier = energyAtPeak
                            ? Math.max(1, 1 + (Number(craftEffects?.energyPeakDamageMultiplierDelta) || 0))
                            : 1;
                        const energyPeakPiercingBonus = energyAtPeak
                            ? Math.max(0, Math.round(Number(craftEffects?.energyPeakPiercingBonus) || 0))
                            : 0;
                        this._registerGunSpreadShot('main', currentItem);

                        const lmgCfg = WEAPON_FX_CONFIG.lmg;
                        const gunLX = this.size + lmgCfg.gunLX, gunLY = holdY;
                        let spawnPos = this._getMuzzleWorldPosition('main');
                        if (!spawnPos) spawnPos = this._getMuzzlePosition(gunLX, gunLY, lmgCfg.muzzleForward);
                        const baseAngle = Math.atan2(d.targetY - spawnPos.y, d.targetX - spawnPos.x);

                        // 所有自动武器统一消费按实际发数累计的散布，能量机枪不再另走按住时间分支。
                        const spreadFactor = this._currentSpreadFactor;
                        const maxSpreadAngle = this._currentSpreadMaxAngle || WEAPON_FX_CONFIG.defaultMaxSpreadAngle;
                        const spreadRad = (Math.random() - 0.5) * 2 * (maxSpreadAngle * Math.PI / 180) * spreadFactor;
                        const angle = baseAngle + spreadRad
                            * (rhythmShot?.spreadMultiplier || 1)
                            * (convergenceShot?.spreadMultiplier || 1)
                            * overdriveShot.spreadMultiplier;

                        const pc = this.attacks[attackKey].config;
                        // 动态计算伤害（优先使用 getCurrentWeaponAtk，包含强化和改造加成）
                        let weaponDamage;
                        if (this.getCurrentWeaponAtk) {
                            weaponDamage = this.getCurrentWeaponAtk();
                        } else {
                            // 防御分支（玩家侧永不触发：base.js 必定义 getCurrentWeaponAtk）——
                            // 原 weapon-damage-formulas.js 硬编码第二套公式已删除，统一公式源为 attack-formula.js
                            weaponDamage = 0;
                        }
                        const calibrationShot = this._prepareCalibrationShot(currentItem);
                        const shotDamage = Math.round(weaponDamage
                            * (calibrationShot?.damageMultiplier || 1)
                            * (rhythmShot?.damageMultiplier || 1)
                            * (convergenceShot?.damageMultiplier || 1)
                            * energyPeakDamageMultiplier
                            * overdriveShot.damageMultiplier);
                        const damage = { min: shotDamage, max: shotDamage };

                        // 屏幕抖动
                        Camera.triggerShake(isEnergyLMG ? lmgCfg.cameraShakeEnergy : lmgCfg.cameraShake);

                        // 机枪分支历史上绕开 _playFireSound 直调 playFile，导致高射速枪仍被普通
                        // 4 voice 池吞声。统一进入逐发枪声入口，同时保留能量轻机枪等分支专用音色。
                        this._playFireSound(currentItem, lmgCfg.defaultSound, lmgCfg.soundMap[attackKey]);

                        // 应用改造效果
                        const ballistics = this._getGunBallistics(currentItem, pc.projectileRange);
                        const effectiveRange = ballistics.maxRange;
                        let effectiveKnockback = pc.knockback || 0;
                        let effectiveProjectileSpeed = pc.projectileSpeed;
                        if (craftEffects) {
                            effectiveKnockback += craftEffects.knockbackDelta || 0;
                            if (craftEffects.projectileSpeedPercent) {
                                effectiveProjectileSpeed *= (1 + craftEffects.projectileSpeedPercent);
                            }
                        }
                        effectiveProjectileSpeed *= overdriveShot.projectileSpeedMultiplier;

                        const ricochetOnHit = createWeaponRicochetHandler(this, currentItem, d.entities);
                        const legendaryLmgOnHit = createLegendaryLmgHitHandler(this, currentItem, d.entities);

                        // 创建弹丸
                        ProjectileFactory.create({
                            x: spawnPos.x, y: spawnPos.y, angle: angle,
                            ...this._projectileAim3D(spawnPos, d.targetX, d.targetY, 24, angle, d.entities),
                            speed: effectiveProjectileSpeed, maxRange: effectiveRange, size: pc.projectileSize,
                            damage: damage,
                            piercing: this._getEffectivePiercing(pc.piercing, currentItem)
                                + (calibrationShot?.piercingBonus || 0)
                                + energyPeakPiercingBonus
                                + overdriveShot.piercingBonus,
                            source: this, effectWeapon: currentItem, entities: d.entities, image: null,
                            isGold: !isEnergyLMG, isGreen: isEnergyLMG,
                            isPurple: calibrationShot?.charged === true,
                            isCrimson: rhythmShot?.sweet === true
                                || overdriveShot.overheated
                                || !!currentItem.runeLitanyParams,
                            isCyan: energyAtPeak
                                || (convergenceShot?.stack || 0) > 0
                                || !!currentItem.ricochetParams
                                || !!currentItem.constellationParams,
                            damageType: isEnergyLMG ? 'magic' : 'physical',
                            knockback: effectiveKnockback,
                            damageFalloff: ballistics.damageFalloff,
                            playerGunWallSparks: true,
                            onFirstHit: calibrationShot?.onFirstHit || ricochetOnHit || legendaryLmgOnHit,
                            hitContext: currentItem.overdriveHeatParams
                                ? { critChanceBonusPercent: overdriveShot.critChanceBonusPercent }
                                : null,
                        });

                        // 枪口火焰特效
                        const hideMuzzle = !isEnergyLMG && craftEffects && craftEffects.hideMuzzleFlash;
                        if (!hideMuzzle) {
                            this._spawnMuzzleFlashAt(spawnPos.x, spawnPos.y, angle, isEnergyLMG ? lmgCfg.muzzleScaleEnergy : lmgCfg.muzzleScale);
                            this._spawnMuzzleFireAt(spawnPos.x, spawnPos.y);
                        }

                        // 弹壳从抛壳窗弹出（能量轻机枪不抛壳）
                        if (!isEnergyLMG) {
                            this._spawnShellCasing('main', gunLX, gunLY, lmgCfg.shellOffset, angle);
                        }
                        delete d.fireMainHand;
                    }
                    // 副手开火已移到 hand === 'offhand' 分支独立处理
                } else if (isShotgun) {
                    const currentItem = this.equipments[this.weaponMode];
                    const craftEffects = currentItem && currentItem._craftEffects;
                    const isSlug = craftEffects && craftEffects.slugMode;
                    const isFlechette = craftEffects && craftEffects.flechetteMode;
                    const attackKey = currentItem.attackKey || 'super90';
                    const sgCfg = WEAPON_FX_CONFIG.shotgun;
                    const pelletCount = currentItem.pelletCount || sgCfg.defaultPelletCount;
                    // 散弹枪：一次击发多发弹丸（普通模式）或单发弹丸（独头弹模式）
                    if (d.fireMainHand) {
                        const mainSlot = d.mainSlot || this.weaponMode;
                        if (this._hasAmmo(mainSlot)) {
                            this._consumeAmmo(mainSlot);
                            this._registerGunSpreadShot('main', currentItem);
                            const mythicBlast = prepareMythicShotgunBlast(currentItem);
                            const legendaryBlast = prepareLegendaryShotgunBlast(currentItem);
                            const pc = this.attacks[attackKey].config;
                            const gunLX = this.size + sgCfg.gunLX, gunLY = holdY;
                            let spawnPos = this._getMuzzleWorldPosition('main');
                            if (!spawnPos) spawnPos = this._getMuzzlePosition(gunLX, gunLY, sgCfg.muzzleForward);
                            const baseAngle = Math.atan2(d.targetY - spawnPos.y, d.targetX - spawnPos.x);
                            // 动态计算伤害（优先使用 getCurrentWeaponAtk 包含强化和改造加成）
                            let weaponDamage;
                            if (this.getCurrentWeaponAtk) {
                                weaponDamage = this.getCurrentWeaponAtk();
                            } else {
                                // 防御分支（玩家侧永不触发）——原 weapon-damage-formulas.js 硬编码回退已删除
                                weaponDamage = 0;
                            }
                            weaponDamage = Math.round(weaponDamage * (mythicBlast?.damageMultiplier || 1));
                            const damage = { min: weaponDamage, max: weaponDamage };
                            // 应用改造效果（射程、击退）
                            const ballistics = this._getGunBallistics(currentItem, pc.projectileRange);
                            const effectiveRange = ballistics.maxRange;
                            let effectiveKnockback = pc.knockback || 20;
                            let effectiveSpeed = pc.projectileSpeed;
                            if (craftEffects) {
                                effectiveKnockback += craftEffects.knockbackDelta || 0;
                            }
                            // 散弹枪精通击退加成
                            if (this.skills && this.skills.shotgunMastery) {
                                const sm = this.skills.shotgunMastery.getEffect(this.skills.shotgunMastery.level);
                                effectiveKnockback += sm.knockbackBonus || 0;
                            }
                            effectiveKnockback += mythicBlast?.knockbackDelta || 0;
                            // 屏幕抖动
                            Camera.triggerShake(sgCfg.cameraShake);
                            // 开火音效
                            this._playFireSound(currentItem, sgCfg.defaultSound);
                            // 确定穿透值（箭型弹模式基础1层 + 附魔/改造加成）
                            let piercing = 0;
                            if (isFlechette) {
                                piercing = 1;
                            }
                            piercing = this._getEffectivePiercing(piercing, currentItem);
                            piercing += mythicBlast?.piercingBonus || 0;
                            const voidFuneralOnHit = createVoidFuneralHitHandler(
                                this,
                                currentItem,
                                d.entities,
                                weaponDamage * (isSlug ? 1 : pelletCount)
                            );
                            const legendaryShotgunOnHit = createLegendaryShotgunHitHandler(
                                this,
                                currentItem,
                                d.entities,
                                weaponDamage * (isSlug ? 1 : pelletCount),
                                legendaryBlast
                            );
                            const shotgunOnHit = voidFuneralOnHit || legendaryShotgunOnHit;
                            if (isSlug) {
                                // 独头弹模式：单发弹丸，后坐力层数控制散布（应用改造效果）
                                this._slugRecoilLayers++;
                                const slugTuning = this._getSlugSpreadTuning(currentItem);
                                // 首发零散布；后续按发数增长并受武器上限约束，不再无限扩张。
                                const slugSpreadAngle = Math.min(slugTuning.maxAngle,
                                    Math.max(0, this._slugRecoilLayers - 1) * slugTuning.perShotAngle);
                                const slugSpreadRad = (Math.random() - 0.5) * 2 * (slugSpreadAngle * Math.PI / 180);
                                const angle = baseAngle + slugSpreadRad * (mythicBlast?.spreadMultiplier || 1);
                                ProjectileFactory.create({
                                    x: spawnPos.x, y: spawnPos.y, angle: angle,
                                    ...this._projectileAim3D(spawnPos, d.targetX, d.targetY, 24, angle, d.entities),
                                    speed: effectiveSpeed, maxRange: effectiveRange, size: pc.projectileSize,
                                    damage: damage, piercing: piercing,
                                    source: this, effectWeapon: currentItem, entities: d.entities, image: null,
                                    isGold: true,
                                    knockback: effectiveKnockback,
                                    damageFalloff: ballistics.damageFalloff,
                                    playerGunWallSparks: true,
                                    onFirstHit: shotgunOnHit,
                                    isCrimson: mythicBlast?.charged === true || !!currentItem.royalHuntParams,
                                    isPurple: !!currentItem.voidFuneralParams,
                                    isCyan: legendaryBlast?.phase === 'lunar',
                                    isDarkGold: legendaryBlast?.phase === 'solar',
                                });
                            } else {
                                // 普通模式：多发弹丸，每发随机散布（应用改造效果）
                                // fixedSpread 与准星共用同一 tuning；shotSpreadDelta 不再只改UI kick。
                                const spreadAngle = this._getGunSpreadTuning(currentItem).maxAngle;
                                for (let pellet = 0; pellet < pelletCount; pellet++) {
                                    const spreadRad = (Math.random() - 0.5) * 2 * (spreadAngle * Math.PI / 180);
                                    const angle = baseAngle + spreadRad * (mythicBlast?.spreadMultiplier || 1);
                                    ProjectileFactory.create({
                                        x: spawnPos.x, y: spawnPos.y, angle: angle,
                                        ...this._projectileAim3D(spawnPos, d.targetX, d.targetY, 24, angle, d.entities),
                                        speed: effectiveSpeed, maxRange: effectiveRange, size: pc.projectileSize,
                                        damage: damage, piercing: piercing,
                                        source: this, effectWeapon: currentItem, entities: d.entities, image: null,
                                        isGold: true,
                                        knockback: effectiveKnockback,
                                        damageFalloff: ballistics.damageFalloff,
                                        playerGunWallSparks: true,
                                        onFirstHit: shotgunOnHit,
                                        isCrimson: mythicBlast?.charged === true || !!currentItem.royalHuntParams,
                                        isPurple: !!currentItem.voidFuneralParams,
                                        isCyan: legendaryBlast?.phase === 'lunar',
                                        isDarkGold: legendaryBlast?.phase === 'solar',
                                    });
                                }
                            }
                            // 枪口火焰（消音器隐藏）
                            const hideMuzzle = craftEffects && craftEffects.hideMuzzleFlash;
                            if (!hideMuzzle) {
                                this._spawnMuzzleFlashAt(spawnPos.x, spawnPos.y, baseAngle, sgCfg.muzzleScale);
                                this._spawnMuzzleFireAt(spawnPos.x, spawnPos.y);
                            }
                            // 弹壳
                            this._spawnShellCasing('main', gunLX, gunLY, sgCfg.shellOffset, baseAngle);
                        }
                        delete d.fireMainHand;
                    }
                } else if (isBow) {
                    const cfg = this.attacks.ranged.config;
                    const weaponCfg = (currentItem && currentItem.attack) || {};
                    const bowCfg = WEAPON_FX_CONFIG.bow;
                    const bowLX = this.size + bowCfg.bowLX, bowLY = holdY;
                    const spawnPos = this._getMuzzlePosition(bowLX, bowLY, 0);
                    const angle = Math.atan2(d.targetY - spawnPos.y, d.targetX - spawnPos.x);
                    // 动态计算伤害（优先使用 getCurrentWeaponAtk 包含强化加成）
                    let weaponDamage = cfg.damage.min;
                    if (this.getCurrentWeaponAtk) {
                        weaponDamage = this.getCurrentWeaponAtk();
                    }
                    const damage = { min: weaponDamage, max: weaponDamage };
                    const projSpeed = weaponCfg.projectileSpeed || cfg.projectileSpeed;
                    const projRange = weaponCfg.range || cfg.projectileRange;
                    const projSize = weaponCfg.projectileSize || cfg.projectileSize;
                    const projPiercing = this._getEffectivePiercing(weaponCfg.piercing !== undefined ? weaponCfg.piercing : cfg.piercing, currentItem);
                    ProjectileFactory.create({
                        x: spawnPos.x, y: spawnPos.y, angle: angle,
                        ...this._projectileAim3D(spawnPos, d.targetX, d.targetY, 24, angle, d.entities),
                        speed: projSpeed, maxRange: projRange, size: projSize,
                        damage: damage, piercing: projPiercing,
                        source: this, effectWeapon: currentItem, entities: d.entities, image: this.arrowImage
                    });
                }
                if (d && !d.fireMainHand && !d.fireOffhand) {
                    this.rangedFired = true; this.rangedFireData = null;
                }
            },

_getWeaponAnimParams() {
                const wa = WEAPON_ANIM;
                const anim = this.weaponAnim;
                const currentItem = this.equipments[this.weaponMode];
                const params = {};

                if (!currentItem || !currentItem.name) return params;

                const isPistol = currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol';
                const isPkmOrAkm = AUTO_GUN_FAMILY.includes(currentItem.weaponType);
                const isShotgun = currentItem.weaponType === 'shotgun';
                const isMelee = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
                const s = wa.size;

                // 弓类攻击动画（旋转 + 拉弓后移）
                if (currentItem.weaponType === 'bow' && anim.state !== 'idle') {
                    // 所有非待机阶段都隐藏 Phaser，由 Canvas 渲染
                    params.isAttacking = true;

                    // rotate / idle_return 阶段：传递旋转角度
                    if (anim.state === 'rotate' || anim.state === 'idle_return') {
                        params.rotateAngle = anim.rotateAngle || 0;
                    }

                    // windup / swing / recover 阶段：拉弓后移
                    let recoil = 0;
                    if (anim.state === 'windup') {
                        const t = anim.timer / this._getAnimMs(wa.windupMs);
                        recoil = -s * 0.08 * Easing.easeOutQuad(t); // 拉弓后移
                    } else if (anim.state === 'swing') {
                        const st = anim.timer / this._getAnimMs(wa.swingMs);
                        recoil = s * 0.05 * (1 - st); // 释放后轻微前移
                    } else if (anim.state === 'recover') {
                        const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                        recoil = -s * 0.03 * (1 - rt); // 缓慢回到待机
                    }
                    params.recoil = recoil;
                }

                // 枪械后坐力
                if ((isPistol || isPkmOrAkm || isShotgun) && anim.state !== 'idle') {
                    let recoil = 0, shakeY = 0;
                    if (anim.state === 'windup') {
                        recoil = -s * 0.03 * Easing.easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                    } else if (anim.state === 'swing') {
                        const st = anim.timer / this._getAnimMs(wa.swingMs);
                        recoil = s * 0.1 * (1 - st);
                        shakeY = (Math.random() - 0.5) * 3 * (1 - st);
                    } else if (anim.state === 'recover') {
                        const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                        recoil = -s * 0.03 * (1 - rt);
                    }
                    params.recoil = recoil;
                    params.recoilAngle = shakeY * 0.02;
                }
                // 枪械待机动画1：轻微摆动（Phaser 同步）
                if ((isPistol || isPkmOrAkm || isShotgun) && anim.state === 'idle' && !anim.spinEnd) {
                    let swayAngle = Math.sin(this.animTime * 0.4) * 0.02;
                    if (this.isMoving) {
                        const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                        swayAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                    }
                    params.animAngle = swayAngle;
                }

                // 剑类刺击动画
                if (isMelee && !this._isWhirlwind && !this._isDashing && !this._specialAttackActive && !this._dashResetAnim && !this._specialResetAnim && !this._runeSwordResetAnim) {
                    if (anim.state === 'idle') {
                        // 待机时：不随鼠标旋转，固定角度（WeaponTransform.getWeaponRotation 中已应用 idleRotation）
                        let animAngle = 0;
                        // 可选：保留极轻微的移动呼吸摆动
                        if (this.isMoving && !anim.spinEnd) {
                            const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                            animAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                        }
                        params.animAngle = animAngle;
                    } else {
                        // 攻击动画已禁用，武器保持静止
                        params.animAngle = 0;
                        // thrust 不再由 player.js 计算，GameScene.js 会根据 anim.state/timer 独立计算
                    }
                }

                // 武器缩放（如符文长剑的 +50%）
                if (isMelee) {
                    let animState = 'idle';
                    if (isPlayerRunVisual(this)) animState = 'running';
                    else if (this.isMoving) animState = 'walk';
                    const swordCfg = getWeaponStateConfig('sword', animState);
                    if (swordCfg.idleScale && swordCfg.idleScale !== 1) {
                        params.scale = swordCfg.idleScale;
                    }
                }

                return params;
            },

_getOffhandWeaponAnimParams() {
                const wa = WEAPON_ANIM;
                const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const offhandItem = this.equipments[offhandSlot];
                const params = {};

                if (!offhandItem || !offhandItem.name) return params;

                const offhandAnim = this.offhandWeaponAnim || { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle };
                const isPistol = offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol';
                const _isPkmOrAkm = AUTO_GUN_FAMILY.includes(offhandItem.weaponType);
                const _isShotgun = offhandItem.weaponType === 'shotgun';
                const isMelee = offhandItem.category === 'weapon_melee' || offhandItem.weaponType === 'sword';
                const s = wa.size;

                // 副手后坐力（仅手枪）
                if (isPistol && offhandAnim.state !== 'idle') {
                    let recoil = 0;
                    const offWindupMs = this._getOffhandAnimMs(offhandItem, wa.windupMs);
                    const offSwingMs = this._getOffhandAnimMs(offhandItem, wa.swingMs);
                    const offRecoverMs = this._getOffhandAnimMs(offhandItem, wa.recoverMs);
                    if (offhandAnim.state === 'windup') {
                        recoil = -s * 0.03 * Easing.easeOutQuad(offhandAnim.timer / offWindupMs);
                    } else if (offhandAnim.state === 'swing') {
                        const st = offhandAnim.timer / offSwingMs;
                        recoil = s * 0.1 * (1 - st);
                    } else if (offhandAnim.state === 'recover') {
                        const rt = offhandAnim.timer / offRecoverMs;
                        recoil = -s * 0.03 * (1 - rt);
                    }
                    params.recoil = recoil;
                    params.recoilAngle = -recoil * 0.05;
                }

                // 副手刺击动画 - 已由 Phaser 全权处理，player.js 只传递状态和时间
                if (isMelee && offhandAnim.state !== 'idle') {
                    // thrust 不再由 player.js 计算，GameScene.js 会根据 offhandAnim.state/timer 独立计算
                }

                // 副手缩放
                if (isMelee) {
                    let animState = 'idle';
                    if (isPlayerRunVisual(this)) animState = 'running';
                    else if (this.isMoving) animState = 'walk';
                    const swordCfg = getWeaponStateConfig('sword', animState);
                    if (swordCfg.idleScale && swordCfg.idleScale !== 1) {
                        params.scale = swordCfg.idleScale;
                    }
                }

                return params;
            },

_drawDebugCoordinateSystem(ctx) {
                ctx.save();
                ctx.lineWidth = 2;
                // x轴（向右，红色）
                ctx.strokeStyle = '#ff5555';
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(150, 0); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(145, -5); ctx.lineTo(150, 0); ctx.lineTo(145, 5); ctx.stroke();
                // y轴（向下，绿色）——与 Canvas 一致，Y+向下
                ctx.strokeStyle = '#55ff55';
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 150); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-5, 145); ctx.lineTo(0, 150); ctx.lineTo(5, 145); ctx.stroke();
                // 刻度
                ctx.fillStyle = '#888888';
                ctx.font = '10px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let i = -100; i <= 100; i += 10) {
                    if (i === 0) continue;
                    ctx.strokeStyle = '#ff5555'; ctx.lineWidth = 0.5;
                    ctx.beginPath(); ctx.moveTo(i, -3); ctx.lineTo(i, 3); ctx.stroke();
                    if (i % 20 === 0) ctx.fillText(String(i), i, 12);
                    ctx.strokeStyle = '#55ff55'; ctx.lineWidth = 0.5;
                    ctx.beginPath(); ctx.moveTo(-3, i); ctx.lineTo(3, i); ctx.stroke();
                    if (i % 20 === 0) ctx.fillText(String(i), -12, i);
                }
                // 原点
                ctx.fillStyle = '#ffffff';
                ctx.fillText('0', -10, 10);
                ctx.restore();
            },

_drawStickFigure(ctx, bodyScale = 1, bodyOffsetX = 0, bodyOffsetY = 0) {
                // 与精灵图一致：反旋转回屏幕空间，保持直立；左右用水平翻转
                ctx.save();
                ctx.rotate(-this.rotation);
                ctx.translate(bodyOffsetX, bodyOffsetY);
                ctx.scale(bodyScale, bodyScale);

                if (this._getFacingDirection() === 'left') ctx.scale(-1, 1);

                const color = this.hitFlash > 0 ? '#ffffff' : '#111111';
                const lw = this.hitFlash > 0 ? 4 : 3;
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.lineWidth = lw;

                // ================================================================
                // 基于用户提供的图像识别的关节坐标（直立姿态，Y+向下）
                // 图像尺寸 199x420，红点标记的关节位置已按玩家比例缩放
                // ================================================================
                let J = {
                    head:   { x: 0,  y: -28 },
                    neck:   { x: 0,  y: -19 },
                    shoulder:{x: 0,  y: -18 },
                    lShldr: { x: -7, y: -18 },
                    rShldr: { x: 7,  y: -18 },
                    lElbow: { x: -12,y: -6  },
                    rElbow: { x: 12, y: -3  },
                    lHand:  { x: -8, y: 7   },
                    rHand:  { x: 14, y: 7   },
                    hip:    { x: 0,  y: 18  },
                    lHip:   { x: -6, y: 18  },
                    rHip:   { x: 6,  y: 18  },
                    lKnee:  { x: -8, y: 35  },
                    rKnee:  { x: 8,  y: 35  },
                    lFoot:  { x: -10,y: 52  },
                    rFoot:  { x: 10, y: 52  }
                };

                // ================================================================
                // Walk 动画：2秒循环，左右脚交替走2步
                // ================================================================
                if (this.isMoving && !this.isDodging && !this._isWhirlwind) {
                    const walkCycle = (nowMs() / 1000) % 2;          // 0 ~ 2 秒
                    const phase = walkCycle * Math.PI;                  // 0 ~ 2π
                    const sinP = Math.sin(phase);                       // 左腿主相位
                    const cosP = Math.cos(phase);                       // 用于抬脚和臀部位移
                    const sin2P = Math.sin(phase * 2);                // 2倍频，用于臀部起伏

                    // ---- 臀部起伏（每步一次）----
                    const hipBob = sin2P * 1.5;
                    J.head.y   += hipBob * 0.3;
                    J.neck.y   += hipBob * 0.4;
                    J.shoulder.y += hipBob * 0.4;
                    J.lShldr.y += hipBob * 0.4;
                    J.rShldr.y += hipBob * 0.4;
                    J.hip.y    += hipBob;
                    J.lHip.y   += hipBob;
                    J.rHip.y   += hipBob;

                    // ---- 左腿（phase 0-π 时向前）----
                    const lForward = Math.max(0, sinP);   // 0~1 向前阶段
                    const lLift = Math.max(0, cosP);      // 抬脚阶段（与sin错开）
                    const lFootX = sinP * 10;             // 前后摆动 10px
                    const lFootY = -lLift * 4 - lForward * 2; // 抬脚+前伸
                    J.lFoot.x  += lFootX;
                    J.lFoot.y  += lFootY;
                    J.lKnee.x  += lFootX * 0.55;          // 膝盖跟随
                    J.lKnee.y  += lFootY * 0.6;

                    // ---- 右腿（与左腿反相）----
                    const rForward = Math.max(0, -sinP);
                    const rLift = Math.max(0, -cosP);
                    const rFootX = -sinP * 10;
                    const rFootY = -rLift * 4 - rForward * 2;
                    J.rFoot.x  += rFootX;
                    J.rFoot.y  += rFootY;
                    J.rKnee.x  += rFootX * 0.55;
                    J.rKnee.y  += rFootY * 0.6;

                    // ---- 手臂摆动（与对侧腿同向，自然摆臂）----
                    const armSwing = 9;
                    J.lHand.x  -= sinP * armSwing;       // 左臂与左腿反相
                    J.lElbow.x -= sinP * armSwing * 0.65;
                    J.rHand.x  += sinP * armSwing;       // 右臂与左腿同相
                    J.rElbow.x += sinP * armSwing * 0.65;
                }

                // ---- 待机动画：呼吸（仅静止时）----
                if (!this.isMoving) {
                    const breath = Math.sin(nowMs() / 400) * 0.5;
                    J.head.y   += breath;
                    J.neck.y   += breath * 0.8;
                    J.shoulder.y += breath * 0.8;
                    J.lShldr.y += breath * 0.8;
                    J.rShldr.y += breath * 0.8;
                    J.hip.y    += breath * 0.3;
                    J.lHip.y   += breath * 0.3;
                    J.rHip.y   += breath * 0.3;
                }

                // ---- 绘制头部 ----
                ctx.beginPath(); ctx.arc(J.head.x, J.head.y, 7, 0, Math.PI * 2); ctx.fill();

                // ---- 绘制脊柱（neck → hip）----
                ctx.beginPath(); ctx.moveTo(J.neck.x, J.neck.y); ctx.lineTo(J.hip.x, J.hip.y); ctx.stroke();

                // ---- 绘制左臂（shoulder → elbow → hand）----
                ctx.beginPath(); ctx.moveTo(J.lShldr.x, J.lShldr.y);
                ctx.lineTo(J.lElbow.x, J.lElbow.y); ctx.lineTo(J.lHand.x, J.lHand.y); ctx.stroke();

                // ---- 绘制右臂 ----
                ctx.beginPath(); ctx.moveTo(J.rShldr.x, J.rShldr.y);
                ctx.lineTo(J.rElbow.x, J.rElbow.y); ctx.lineTo(J.rHand.x, J.rHand.y); ctx.stroke();

                // ---- 绘制左腿（hip → knee → foot）----
                ctx.beginPath(); ctx.moveTo(J.lHip.x, J.lHip.y);
                ctx.lineTo(J.lKnee.x, J.lKnee.y); ctx.lineTo(J.lFoot.x, J.lFoot.y); ctx.stroke();

                // ---- 绘制右腿 ----
                ctx.beginPath(); ctx.moveTo(J.rHip.x, J.rHip.y);
                ctx.lineTo(J.rKnee.x, J.rKnee.y); ctx.lineTo(J.rFoot.x, J.rFoot.y); ctx.stroke();

                // ---- 关节小圆点（手、脚）----
                ctx.fillStyle = color;
                [J.lHand, J.rHand, J.lFoot, J.rFoot].forEach(j => {
                    ctx.beginPath(); ctx.arc(j.x, j.y, 2, 0, Math.PI * 2); ctx.fill();
                });

                ctx.restore();
            },

applyStun(duration) {
                if (this._isDead) return; // 死亡状态不眩晕
                if (this.dodgeInvincible) return; // 闪避判定窗口内：不进入眩晕（与伤害免疫同窗口）
                this.isStunned = true;
                this.stunTimer = duration;
                // 终止所有进行中的动作，眩晕期间只保留待机
                this._cancelAllActionsForStun();
                // 在状态栏显示眩晕效果
                if (StatusBar) {
                    if (this._stunEffectId) {
                        StatusBar.removeEffect(this._stunEffectId);
                    }
                    this._stunEffectId = StatusBar.addEffect('stun', duration);
                }
                // 显示眩晕浮动文字
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 50, '💫 眩晕！', '#9a7a5a'));
            },

// 眩晕时终止所有动作：攻击动画/闪避/技能/特殊攻击/蓄力/换弹/无人机操控全部中断
_cancelAllActionsForStun() {
                this.shieldSystem?.exitDefense();
                // 攻击动画回待机（主手+副手）：强制停止所有攻击 Tween，即使伤害判定尚未发生也中断
                if (this.weaponAnim && this.weaponAnim.isAttacking) {
                    this.clearAttackTweens();
                }
                if (this.weaponAnim) {
                    this.weaponAnim.state = 'idle';
                    this.weaponAnim.timer = 0;
                    this.weaponAnim.isAttacking = false;
                }
                if (this.offhandWeaponAnim) {
                    this.offhandWeaponAnim.state = 'idle';
                    this.offhandWeaponAnim.timer = 0;
                    this.offhandWeaponAnim.isAttacking = false;
                }
                // 闪避/冲刺/风车/推击/特殊攻击（闪避走 _endDodge 统一出口，同步还原无敌/碰撞标记）
                this._endDodge();
                this._isDashing = false;
                this._dashState = 'idle';
                this._dashTimer = 0;
                this._dashSkillId = null;
                this._dashWeaponItem = null;
                this._dashSkillOverrides = null;
                this._isWhirlwind = false;
                this._whirlwindRecovering = false;
                this._whirlwindRecoverTimer = 0;
                this._whirlwindRecoverDuration = 0;
                if (this._whirlwindRangeEffect) {
                    this._whirlwindRangeEffect.active = false;
                    this._whirlwindRangeEffect = null;
                }
                this._isPushStrike = false;
                this._specialAttackActive = false;
                this._specialAttackTimer = 0;
                // 蓄力状态
                if (this._chargeState !== 'idle') {
                    this._chargeState = 'idle';
                    this._chargeTimer = 0;
                    this._chargeFlashActive = false;
                    this._chargeFlashTimer = 0;
                }
                // 换弹中断（含单发装填）
                for (const slot of ['weapon', 'offhand', 'weapon2', 'ring2']) {
                    const state = this._ammoState && this._ammoState[slot];
                    if (state && state.reloading) {
                        state.reloading = false;
                        state.reloadTimer = 0;
                        state.singleReloadMode = false;
                    }
                }
                // 退出无人机操控
                if (this.droneSystem && this.droneSystem.controlling) {
                    this.droneSystem._exitControl();
                }
                // 施法/后摇中断（通知 Phaser 场景清理动画监听，防止魔法延迟释放）
                if (this._castState && this._castState !== 'idle') {
                    const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
                    if (scene && typeof scene.cancelPlayerCast === 'function') {
                        scene.cancelPlayerCast(true);
                    }
                    this._castState = 'idle';
                    this._castReleaseDone = false;
                    this._castOnRelease = null;
                }
                // 速度清零，只播放 idle 精灵图
                this.vx = 0;
                this.vy = 0;
                this.isMoving = false;
            },

_updateSubsystems(dt, entities) {
                // 符文长剑常驻粒子属于 Phaser 武器附着层：必须等 GameScene 完成真实
                // weaponSprite 姿态和动态深度后再同步，不能在逻辑层用玩家坐标猜剑柄。
                // ===== 冲刺攻击更新 =====
                if (this._isDashing) {
                    this.dashSystem.update(dt, entities);
                }
                // ===== 风车技能更新 =====
                if (this._isWhirlwind || this._whirlwindRecovering) {
                    this.whirlwindSystem.update(dt, entities);
                }
                // ===== 推击技能更新 =====
                if (this._isPushStrike) {
                    this.pushStrikeSystem.update(dt, entities);
                }
                // ===== 夜与火之剑特殊攻击更新 =====
                if (this._specialAttackActive) {
                    this.specialAttackSystem.update(dt, entities);
                }
                // 特殊攻击冷却（每个类型独立）
                for (const type in this._specialAttackCooldowns) {
                    if (this._specialAttackCooldowns[type] > 0) {
                        this._specialAttackCooldowns[type] -= dt;
                        if (this._specialAttackCooldowns[type] < 0) this._specialAttackCooldowns[type] = 0;
                    }
                }
                // ===== 符文长剑特殊攻击更新 =====
                if (this._runeSwordSpecialActive) {
                    this.runeSwordSystem.update(dt, entities);
                } else if (this._runeSwordSwords && this._runeSwordSwords.some(s => s.flyActive)) {
                    this.runeSwordSystem._updateFlyingBlades(dt, entities);
                }
                // ===== 冰锥技能更新 =====
                if (this._iceSpikeActive || (this._iceSpikeSpikes && this._iceSpikeSpikes.some(s => s.flyActive))) {
                    this.iceSpikeSystem.update(dt, entities);
                }
                // 冰锥技能冷却
                if (this._iceSpikeCooldown > 0) {
                    this._iceSpikeCooldown -= dt;
                    if (this._iceSpikeCooldown < 0) this._iceSpikeCooldown = 0;
                }
                // ===== 火球技能更新 =====
                if (this._fireballActive || (this._fireball && this._fireball.flyActive)) {
                    this.fireballSystem.update(dt, entities);
                }
                // 火球技能冷却
                if (this._fireballCooldown > 0) {
                    this._fireballCooldown -= dt;
                    if (this._fireballCooldown < 0) this._fireballCooldown = 0;
                }
                // ===== 闪电技能更新（冷却由系统自管） =====
                if (this.lightningStrikeSystem) {
                    this.lightningStrikeSystem.update(dt);
                }
                // ===== 圣光技能更新（冷却由系统自管） =====
                if (this.holyLightSystem) {
                    this.holyLightSystem.update(dt);
                }
                // ===== 冰墙技能更新（冷却与生命周期由系统自管） =====
                if (this.iceWallSystem) {
                    this.iceWallSystem.update(dt);
                }
                // ===== 暴风雪技能更新（冷却与区域生命周期由系统自管） =====
                if (this.blizzardSystem) {
                    this.blizzardSystem.update(dt, entities);
                }
                // ===== 陨星坠落技能更新（冷却与打击生命周期由系统自管） =====
                if (this.meteorSystem) {
                    this.meteorSystem.update(dt, entities);
                }
                // ===== 灼锋焰甲技能更新（冷却与光环由系统自管） =====
                if (this.flameArmorSystem) {
                    this.flameArmorSystem.update(dt, entities);
                }
                // ===== 雷暴领域技能更新（雷云与冷却由系统自管） =====
                if (this.stormDomainSystem) {
                    this.stormDomainSystem.update(dt, entities);
                }
                // ===== 贯穿雷枪技能更新（蓄力/感电地面与冷却由系统自管） =====
                if (this.thunderLanceSystem) {
                    this.thunderLanceSystem.update(dt, entities);
                }
                // ===== 圣辉领域技能更新（圣辉环与冷却由系统自管） =====
                if (this.sanctuaryDomainSystem) {
                    this.sanctuaryDomainSystem.update(dt, entities);
                }
                // ===== 圣光审判技能更新（蓄力与冷却由系统自管） =====
                if (this.holyJudgmentSystem) {
                    this.holyJudgmentSystem.update(dt, entities);
                }
                // ===== 无人机技能更新 =====
                if (this.droneSystem && this.droneSystem.active) {
                    this.droneSystem.update(dt, entities);
                }
                // 冲刺攻击复位动画更新
                if (this._dashResetAnim) {
                    const elapsed = nowMs() - this._dashResetAnim.startTime;
                    if (elapsed >= this._dashResetAnim.duration) {
                        this._dashResetAnim = null;
                        this._dashVisualStyle = null;
                    }
                }
                // 特殊攻击复位动画更新
                if (this._specialResetAnim) {
                    const elapsed = nowMs() - this._specialResetAnim.startTime;
                    if (elapsed >= this._specialResetAnim.duration) {
                        this._specialResetAnim = null;
                        this._specialAttackWeaponItem = null;
                        this._specialAttackAnimDuration = 0;
                        this._specialAttackPhase = null;
                        this._specialAttackBeamTimer = 0;
                        this._specialAttackReleaseFrame = 0;
                        this._specialAttackReleaseProgress = 0;
                        this._specialAttackOriginX = null;
                        this._specialAttackOriginY = null;
                    }
                }
                // 符文长剑复位动画更新
                if (this._runeSwordResetAnim) {
                    const elapsed = nowMs() - this._runeSwordResetAnim.startTime;
                    if (elapsed >= this._runeSwordResetAnim.duration) {
                        this._runeSwordResetAnim = null;
                    }
                }
            }
};

export { subsystemsMixin };
