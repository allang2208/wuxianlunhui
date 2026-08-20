import { SoundManager } from '../ui/sound-manager.js';
import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { Renderer } from '../world/renderer.js';
import { StatusBar } from '../ui/status-bar.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { SmokeEffect } from '../effects/smoke-effect.js';
import { LightningBoltEffect } from '../effects/lightning-bolt.js';
import { burstParticles } from '../effects/combat-fx.js';
import { Entity } from './entity.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getCurrentDungeonType } from '../config/exp-system.js';
import { DungeonRunStats } from '../world/dungeon-run-stats.js';
import { PartySystem } from '../systems/party-system.js';
import { BloodMistEffect, DeathEffect } from '../effects/particle-effects.js';
import { isMachineGun, isRifle, isPistolCategory, isShotgunCategory } from '../config/gun-ammo.js';
import { Enemy } from './enemy.js';
import { SkillManager } from '../ui/skill-manager.js';
import { DungeonMapSystem } from '../world/dungeon-map-system.js';
import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { getTributeGoldMultiplier, getTributeKillMpHealRatio, getTributeKillHpHealRatio, getTributeMonsterDamageTakenMul, getMoonshadowConfig, rollTributeDrop } from '../config/tribute-effects.js';

// 友方阵营组：玩家与友军互相免疫伤害（防御塔/基地/掩体/伙伴等，2026-08-14）
const FRIENDLY_FACTIONS = new Set(['player', 'companion']);

/** 友方免伤判定：source 与 target 同属友方阵营组则禁止伤害 */
export function isFriendlyFire(source, target) {
    // 开发工具「友军伤害」开关（2026-08-16）：开启后允许对友方单位造成伤害
    if (typeof window !== 'undefined' && window.Game && window.Game._devFriendlyFire) {
        return false;
    }
    return !!(source && target && FRIENDLY_FACTIONS.has(source._faction) && FRIENDLY_FACTIONS.has(target._faction));
}

        /**
         * 根据配置计算怪物金币掉落
         * @param {number} level - 怪物等级
         * @param {Object} _source - 击杀来源（保留参数签名，当前未消费）
         * @returns {number} 金币数量
         */
        function getEnemyGoldDrop(level, _source) {
            const cfg = COMBAT_FORMULAS.enemy?.goldDrop || {};
            const base = cfg.base ?? 0;
            const levelMul = cfg.levelMultiplier ?? 4;
            const randomMin = cfg.randomMin ?? 1;
            const randomMax = cfg.randomMax ?? 10;
            let amount = base + (level || 1) * levelMul + Math.floor(Math.random() * (randomMax - randomMin + 1)) + randomMin;

            // 全局倍率
            const globalMul = cfg.globalMultiplier ?? 1;
            amount = Math.floor(amount * globalMul);

            // 祭品效果（数据驱动）：携带祭品的金币掉落百分比加成
            amount = Math.floor(amount * getTributeGoldMultiplier());

            return Math.max(0, amount);
        }

        class DamageableEntity extends Entity {
            constructor(x, y, config = {}) {
                super(x, y); this._faction = config.faction || 'neutral'; this.hittable = true; this.hp = config.hp || 100; this.maxHp = config.maxHp || 100;
                this.size = config.size || 20; this.collisionRadius = config.collisionRadius || this.size || 12; this.name = config.name || '目标'; this.hitFlash = 0; this.hitFlashDuration = 300;
                this.knockbackX = 0; this.knockbackY = 0; this.knockbackFriction = 0.962;
                this.immovable = false; // 建筑/掩体等置 true：任何击退/位移通道一律无效
                // 子类在 super() 后才设置碰撞字段，需要重建统一 Collider
                this.rebuildCollider();
                // ===== 状态栏系统（每个实体独立） =====
                this.statusEffects = []; // { type, duration, remaining, icon, name, color, stacks }
            }
            takeDamage(damage, source, damageType = 'physical', isMelee = true) {
                // 友方免伤：玩家/友军不能伤害同为友方的单位（防御塔/基地/掩体/伙伴）
                if (isFriendlyFire(source, this)) return 0;
                // 高度分层：近战只能命中脚底Z差在可触及范围内的目标。
                if (isMelee && source) {
                    const verticalReach = Number(source.meleeVerticalReach) || 48;
                    if (Math.abs((Number(source.z) || 0) - (Number(this.z) || 0)) > verticalReach) return 0;
                }
                // 新增：怪物之间不互相攻击
                if (this._faction === 'enemy' && source && source._faction === 'enemy') return;
                // 应用伤害公式：伤害 = 攻击力² / (攻击力 + 防御力)
                let baseDamage = damage;
                let isCrit = false;
                if (source && source.data && this.data) {
                    let atk, def;
                    if (damageType === 'magic' || damageType === 'electric') {
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
                    // 法袍套「秘法」：玩家魔法伤害 +18%（三件齐穿，source 侧生效）
                    if ((damageType === 'magic' || damageType === 'electric') && source && source._faction === 'player' && source._magicDamageBonus) {
                        baseDamage = Math.floor(baseDamage * (1 + source._magicDamageBonus));
                    }
                    // 应用魔力易伤：魔法伤害每层+5%
                    if ((damageType === 'magic' || damageType === 'electric') && this._magicVulnerabilityStacks > 0) {
                        baseDamage = Math.floor(baseDamage * (1 + this._magicVulnerabilityStacks * 0.05));
                    }
                    // 应用感电：电系伤害每层 +3%（感电叠满 5 层触发过载，见 applyElectrified）
                    if (damageType === 'electric' && this._electrifiedStacks > 0) {
                        baseDamage = Math.floor(baseDamage * (1 + this._electrifiedStacks * 0.03));
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
                    // 冻结目标额外受到 50% 物理伤害（非魔法伤害）
                    if (damageType !== 'magic' && damageType !== 'electric' && this.hasStatusEffect && this.hasStatusEffect('frozen')) {
                        baseDamage = Math.floor(baseDamage * 1.5);
                    }
                    // 装甲僵尸持盾防御：50%概率格挡，减少50%伤害
                    if (this.data && this.data.equipShield === 'small_shield' && damageType !== 'magic' && damageType !== 'electric') {
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
                        if (currentWpn && currentWpn._craftEffects) {
                            if (currentWpn._craftEffects.critChancePercent) {
                                critRate += currentWpn._craftEffects.critChancePercent * 100;
                            }
                            // 暴击符文：仅对魔法伤害生效
                            if ((damageType === 'magic' || damageType === 'electric') && currentWpn._craftEffects.magicCritPercent) {
                                critRate += currentWpn._craftEffects.magicCritPercent * 100;
                            }
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
                // 重甲套自动格挡（最后乘法结算；强化不影响概率）：
                // 壁垒（优质）= 30% 概率减少 80% 伤害；镇岳（稀有）= 40% 概率减少 85% 伤害；
                // 天罡（史诗）= 50% 概率减少 90% 伤害；神域（神话重甲）= 60% 概率减少 90% 伤害
                const blockCfg = this._armorSetActive === 'oracle'
                    ? { chance: 0.60, remain: 0.10 }
                    : (this._armorSetActive === 'tiangang'
                        ? { chance: 0.50, remain: 0.10 }
                        : (this._armorSetActive === 'zhenyue'
                            ? { chance: 0.40, remain: 0.15 }
                            : (this._armorSetActive === 'heavy' ? { chance: 0.30, remain: 0.20 } : null)));
                if (this._faction === 'player' && blockCfg && Math.random() < blockCfg.chance) {
                    baseDamage = Math.max(1, Math.floor(baseDamage * blockCfg.remain));
                    if (EffectManager && EffectManager.createDamageText) {
                        EffectManager.createDamageText(this.x, this.y - this.size - 15, '格挡!', '#9ab8c8');
                    }
                }
                // 铁匠铺能力：标记箭（2026-08-17）——被标记目标受所有伤害增加
                // （标准 Buff 工作流：addStatusEffect('marked') 注册 + effect.value 携带数值，
                //   同类型刷新取最大 value；updateStatusEffects 计时清除）
                if (this.hasStatusEffect('marked')) {
                    const marked = this.statusEffects.find(e => e.type === 'marked');
                    const markedMul = 1 + (marked && marked.value ? marked.value : 0.15);
                    baseDamage = Math.floor(baseDamage * markedMul);
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
                // 供 DamagePipeline 读取的本次命中暴击标记（hitmarker 分级用，每次 takeDamage 重置）
                this._lastHitCrit = isCrit;
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
                // 统一清理自定义特效（循环音轨/头部粒子/范围圈/投射物等）：
                // 死亡后 update 多数被跳过，各实体自身的"死亡即停"检查未必执行，必须在此兜底
                if (typeof this._destroyCustomEffects === 'function') this._destroyCustomEffects();
                if (SoundManager && SoundManager.playWorld) {
                    // 世界音效（2026-08-11 距离衰减）：死亡声按尸体位置衰减
                    SoundManager.playWorld('assets/sounds/ui/knockdown_1.mp3', this.x, this.y);
                } else if (SoundManager && SoundManager.playFile) {
                    SoundManager.playFile('assets/sounds/ui/knockdown_1.mp3');
                }
                if (source && source.data) source.data.kills++;
                EffectManager.add(new DeathEffect(this.x, this.y, this.size));
                if (source) {
                    const angle = Math.atan2(source.y - this.y, source.x - this.x);
                    EffectManager.add(new BloodMistEffect(this.x, this.y, angle + Math.PI));
                }
                // 掉落金币（不再掉落 G18）；召唤物（_summoned 标签）不掉金币/经验
                if (this instanceof Enemy && !this._summoned && !this._noGoldDrop) {
                    let goldAmount = getEnemyGoldDrop(this.level, source);
                    // rank 金币倍率配置驱动（goldDrop.rankMultipliers，如 elite ×2 / lord ×3）
                    const rankGoldMul = (COMBAT_FORMULAS.enemy?.goldDrop?.rankMultipliers || {})[this.rank];
                    if (rankGoldMul) goldAmount *= rankGoldMul;
                    goldAmount = Math.floor(goldAmount);

                    // 祭品效果（数据驱动）：大理石 - 击杀后1秒内恢复最大生命值
                    const marbleRatio = getTributeKillHpHealRatio();
                    if (marbleRatio > 0 && source && source.data) {
                        source._marbleHealTimer = 1000; // 1秒
                        source._marbleHealTotal = source.data.maxHp * marbleRatio;
                        source._marbleHealPerTick = source._marbleHealTotal / (1000 / 16.67); // 每帧恢复量
                        if (StatusBar) {
                            if (source._marbleHealEffectId) StatusBar.removeEffect(source._marbleHealEffectId);
                            source._marbleHealEffectId = StatusBar.addEffect('marbleHeal', 1000, { icon: '🗿', name: '大理石守护', color: '#8a9a8a' });
                        }
                    }

                    const goldItem = { name: '金币', category: 'gold', stack: goldAmount, rarity: 'mythic' };
                    Game.dropItem(this.x, this.y, goldItem);

                    // 祭品掉落：按地牢难度分级掉落表（精英/首领必掉分表，普通怪按概率；稀有度封顶）
                    const tributeDrop = rollTributeDrop(this.rank, (DungeonMapSystem && DungeonMapSystem.dungeonType) || null);
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
                    // 新增：掉落经验值（传玩家等级，exp-system 内做压级衰减/越级加成；
                    // 地牢中记录单局统计供通关结算面板，tag 供飘字标注衰减/越级）
                    const _expSrc = (source && source.gainExp) ? source
                        : ((source && source.source && source.source.gainExp) ? source.source : null);
                    if (_expSrc) {
                        const detail = this.getExpDetail ? this.getExpDetail(_expSrc.data?.level ?? 1) : null;
                        const amount = detail ? detail.exp : (this.getExpValue ? this.getExpValue(_expSrc.data?.level ?? 1) : 2);
                        if (getCurrentDungeonType()) {
                            DungeonRunStats.recordKill(this.rank);
                            DungeonRunStats.recordExp(amount);
                        }
                        _expSrc.gainExp(amount, detail ? detail.tag : null);
                        // 侍从队经验：与玩家同额、无平分机制（仅进入战斗击杀时获得）
                        PartySystem.grantCombatExp(amount);
                    }
                }
                // 防守模式（世界122）：地面金币掉落关闭（金币由 DefenseSystem 结算直接进背包），
                // 击杀经验按 25% 发放（2026-08-15 用户要求）；侍从队同额
                else if (this instanceof Enemy && !this._summoned && this._defenseMonster) {
                    const _expSrc = (source && source.gainExp) ? source
                        : ((source && source.source && source.source.gainExp) ? source.source : null);
                    if (_expSrc) {
                        const detail = this.getExpDetail ? this.getExpDetail(_expSrc.data?.level ?? 1) : null;
                        const base = detail ? detail.exp : (this.getExpValue ? this.getExpValue(_expSrc.data?.level ?? 1) : 2);
                        const amount = Math.max(1, Math.floor(base * 0.25));
                        _expSrc.gainExp(amount, detail ? detail.tag : null);
                        PartySystem.grantCombatExp(amount);
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
                if (this.immovable) return; // 不可位移实体（掩体/建筑）拒绝一切击退
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
                    inspire: { icon: '📣', name: '激励', color: '#ffb347' },
                    magicVulnerability: { icon: '🔮', name: '魔力易伤', color: '#8a5a9a' },
                    droneVulnerability: { icon: '🛸', name: '无人机易伤', color: '#5a7a9a' },
                    fear: { icon: '😱', name: '恐惧', color: '#7a5ac8' },
                    statusImmune: { icon: '🔰', name: '状态免疫', color: '#5ac8c8' },
                    haste: { icon: '💨', name: '加速', color: '#5ac85a' },
                    holyRenewal: { icon: '💚', name: '圣光续疗', color: '#7aff9a' },
                    chainSpell: { icon: '🔗', name: '链式强化', color: '#8a7a6a' },
                    chill: { icon: '❄️', name: '寒冷', color: '#7ab8e0' },
                    burn: { icon: '🔥', name: '灼伤', color: '#ff6b35' },
                    frozen: { icon: '🧊', name: '冻结', color: '#a0d8ff' },
                    flameArmor: { icon: '🔥', name: '灼锋焰甲', color: '#ff7a3a' },
                    electrified: { icon: '⚡', name: '感电', color: '#b98cff' },
                    marked: { icon: '🎯', name: '标记', color: '#ffd700' },
                };
                const config = STATUS_CONFIG[type] || { icon: '❓', name: type, color: '#8a7d6b' };

                // 状态免疫：持有 statusImmune 的实体拒绝一切其他 buff/debuff 入库（免疫本身除外）
                if (type !== 'statusImmune' && this.hasStatusEffect('statusImmune')) return null;

                // 同类型效果：更新剩余时间（取较大值）
                const existing = this.statusEffects.find(e => e.type === type);
                if (existing) {
                    existing.remaining = Math.max(existing.remaining, duration);
                    existing.duration = Math.max(existing.duration, duration);
                    if (options.stacks !== undefined) existing.stacks = options.stacks;
                    // 同类型 buff 数值不一致时取最大值（较强效果生效，2026-08-17）
                    if (options.value !== undefined) {
                        existing.value = Math.max(existing.value ?? 0, options.value);
                    }
                    return existing;
                }

                let name = options.name || config.name;
                if (options.stacks !== undefined) name = `${name} x${options.stacks}`;

                const effect = {
                    type, duration, remaining: duration,
                    icon: options.icon || config.icon,
                    name, color: options.color || config.color,
                    stacks: options.stacks || 1,
                    ...(options.value !== undefined ? { value: options.value } : {}),
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
                    if (e.remaining <= 0) {
                        // 激励到期：还原攻击/移速乘算
                        if (e.type === 'inspire') this._onInspireEnd();
                        // 加速到期：清空层数
                        if (e.type === 'haste') this._onHasteEnd();
                        // 链式强化到期：清空层数
                        if (e.type === 'chainSpell') this._onChainSpellEnd();
                        // 灼锋焰甲到期：结算经验并回收武器火焰（玩家专有，方法在 subsystems mixin）
                        if (e.type === 'flameArmor' && typeof this._onFlameArmorEnd === 'function') this._onFlameArmorEnd();
                        this.statusEffects.splice(i, 1);
                    }
                }
            }

            /**
             * 激励 buff（怪物增益，如僵尸工头号召）：
             * 持续期间移动速度 ×speedMul、物理攻击 ×atkMul（数据层直接乘算，到期 _onInspireEnd 还原）。
             * 重复激励只刷新时长，不重复乘算。
             */
            applyInspire(duration, opts = {}) {
                if (this.hasStatusEffect('statusImmune')) return;
                const speedMul = opts.speedMul ?? 1.33;
                const atkMul = opts.atkMul ?? 1.5;
                if (!this.hasStatusEffect('inspire')) {
                    this._inspireMul = { speedMul, atkMul };
                    if (this.data && typeof this.data.atk === 'number') {
                        this.data.atk = Math.max(1, Math.round(this.data.atk * atkMul));
                    }
                    if (typeof this.maxSpeed === 'number' && this.maxSpeed > 0) this.maxSpeed *= speedMul;
                    if (typeof this.speed === 'number' && this.speed > 0) this.speed *= speedMul;
                }
                this.addStatusEffect('inspire', duration, { name: '激励', icon: '📣', color: '#ffb347' });
                if (this._faction === 'player' && StatusBar) {
                    StatusBar.addEffect('inspire', duration, { name: '激励', icon: '📣', color: '#ffb347' });
                }
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, '📣 激励！', '#ffb347'));
                }
            }

            /** 状态免疫 buff：持有期间免疫一切其他 buff/debuff（addStatusEffect 与各 apply* 统一拦截） */
            applyStatusImmune(duration) {
                this.addStatusEffect('statusImmune', duration);
                if (this._faction === 'player' && StatusBar) {
                    StatusBar.addEffect('statusImmune', duration, { name: '状态免疫', icon: '🔰', color: '#5ac8c8' });
                }
            }

            /**
             * 加速 buff（如 P4040 轻量化快速板机命中获得）：
             * 按层数叠加，每层提供固定比例移速加成；获得新层时层数+1，持续时间按来源追加。
             * 全部持续时间到期后所有层数一并消失。
             * 不改 maxSpeed 数据层，到期自动失效无需还原。
             *
             * @param {number} duration - 本次层数的持续时间（毫秒）
             * @param {Object} opts - { speedMul?: 总倍率（兼容旧配置）, perStackMul?: 每层加成 }
             */
            applyHaste(duration, opts = {}) {
                if (this.hasStatusEffect('statusImmune')) return;
                // 兼容旧调用 speedMul=1.10 表示每层 +10%；新调用建议直接传 perStackMul=0.10
                const perStackMul = opts.perStackMul ?? (opts.speedMul ? opts.speedMul - 1 : 0.10);

                const existing = this.statusEffects.find(e => e.type === 'haste');
                if (existing) {
                    existing.stacks += 1;
                    existing.remaining += duration;
                    existing.duration += duration;
                    this._hasteStacks = existing.stacks;
                } else {
                    this._hastePerStackMul = perStackMul;
                    this._hasteStacks = 1;
                    this.addStatusEffect('haste', duration, { stacks: 1, name: '加速', icon: '💨', color: '#5ac85a' });
                }

                if (this._faction === 'player' && StatusBar) {
                    const effect = this.statusEffects.find(e => e.type === 'haste');
                    if (effect) {
                        StatusBar.addEffect('haste', effect.remaining, { name: '加速', icon: '💨', color: '#5ac85a', stacks: effect.stacks });
                    }
                }
            }

            /** 加速到期还原（updateStatusEffects 钩子） */
            _onHasteEnd() {
                this._hasteStacks = 0;
            }

            /** 链式强化到期还原（updateStatusEffects 钩子） */
            _onChainSpellEnd() {
                this._chainSpellStacks = 0;
            }

            /** 激励到期还原（updateStatusEffects 钩子） */
            _onInspireEnd() {
                const mul = this._inspireMul;
                if (!mul) return;
                this._inspireMul = null;
                if (this.data && typeof this.data.atk === 'number' && mul.atkMul > 0) {
                    this.data.atk = Math.max(1, Math.round(this.data.atk / mul.atkMul));
                }
                if (typeof this.maxSpeed === 'number' && mul.speedMul > 0) this.maxSpeed /= mul.speedMul;
                if (typeof this.speed === 'number' && mul.speedMul > 0) this.speed /= mul.speedMul;
            }
            /**
             * 应用眩晕（通过状态栏系统）
             * @param {number} duration - 毫秒
             */
            applyStun(duration) {
                if (this._isDead) return;
                if (this.hasStatusEffect('statusImmune')) return;
                this.addStatusEffect('stun', duration);
                // 眩晕打断：攻击动画/预警/施法冻结全部回 idle
                this._cancelActionsForStun();
                // 显示眩晕浮动文字
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, '💫 眩晕！', '#9a7a5a'));
                }
            }
            /** 眩晕/冻结时强制中断当前动作（攻击动画、预警、施法冻结） */
            _cancelActionsForStun() {
                if (this.weaponAnim) {
                    this.weaponAnim.state = 'idle';
                    this.weaponAnim.timer = 0;
                    if (this.weaponAnim.isAttacking !== undefined) this.weaponAnim.isAttacking = false;
                }
                if (this.offhandWeaponAnim) {
                    this.offhandWeaponAnim.state = 'idle';
                    this.offhandWeaponAnim.timer = 0;
                    if (this.offhandWeaponAnim.isAttacking !== undefined) this.offhandWeaponAnim.isAttacking = false;
                }
                if (this._attackTelegraphTimer > 0) {
                    this._attackTelegraphTimer = 0;
                    this._attackTelegraphFire = null;
                }
                // 中断攻击动画计时（如 zombie/_attackAnimTimer），避免眩晕/冻结结束后仍被锁在攻击状态
                if (this._attackAnimTimer > 0) this._attackAnimTimer = 0;
                if (this._animState === 'attack') this._animState = 'idle';
                if (this._frozenForCast) this._frozenForCast = false;
            }
            /**
             * 应用/延长眩晕（电系改造用）：已有眩晕则延长，否则施加 base+extend
             * @param {number} baseDuration - 基础眩晕时长（毫秒）
             * @param {number} extendDuration - 延长时长（毫秒）
             */
            applyStunExtend(baseDuration, extendDuration) {
                if (this._isDead) return;
                if (this.hasStatusEffect('statusImmune')) return;
                const existing = this.statusEffects.find(e => e.type === 'stun');
                if (existing) {
                    existing.remaining += extendDuration;
                    existing.duration += extendDuration;
                } else {
                    this.addStatusEffect('stun', baseDuration + extendDuration);
                }
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, '💫 眩晕！', '#9a7a5a'));
                }
            }
            /**
             * 应用恐惧（debuff 工作流见 SKILL.md）：
             * - 持续时间内朝恐惧源相反方向移动（玩家失控）；移速 -33%/层，最多 3 层（-99%）
             * - 重复受到：层数 +1（≤3）；持续时间由 addStatusEffect 按孰长刷新
             * @param {number} duration - 毫秒
             * @param {object} source - 恐惧来源实体（逃离目标的参照点）
             */
            applyFear(duration, source) {
                if (this._isDead) return;
                if (this.hasStatusEffect('statusImmune')) return;
                const existing = this.statusEffects.find(e => e.type === 'fear');
                const stacks = Math.min((existing ? (existing.stacks || 1) : 0) + 1, 3);
                this.addStatusEffect('fear', duration, { stacks });
                if (source && source.active !== false) this._fearSource = source;
                // 左上角状态栏仅显示玩家自身的恐惧（怪物的不占用玩家 UI）
                if (this._faction === 'player' && typeof StatusBar !== 'undefined' && StatusBar) {
                    StatusBar.addEffect('fear', duration, { stacks });
                }
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, '😱 恐惧！', '#7a5ac8'));
                }
            }
            /** 恐惧移速倍率：1 - 0.33×层数，下限 0.01（无恐惧返回 1） */
            getFearSpeedMul() {
                const e = this.statusEffects.find(x => x.type === 'fear' && x.remaining > 0);
                if (!e) return 1;
                return Math.max(0.01, 1 - 0.33 * (e.stacks || 1));
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
                if (this.hasStatusEffect('statusImmune')) return;
                this._poisonStacks += stacks;
                this._poisonTimer = 5000;
                if (this._poisonTickTimer <= 0) this._poisonTickTimer = 1000;
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `☠️ 中毒 +${stacks}层`, '#39ff14'));
                }
                if (this._poisonEffect) this._poisonEffect.reset();
            }
            // --- 状态效果：流血（每层每秒 1% 当前生命值，持续 10s，到期减一层） ---
            _updateBleed(dt) {
                if (this._bleedStacks <= 0) return;
                this._bleedTimer -= dt;
                this._bleedTickTimer -= dt;
                if (this._bleedTickTimer <= 0) {
                    const dmg = Math.max(1, Math.floor(this.hp * 0.01 * this._bleedStacks));
                    this.hp -= dmg;
                    if (EffectManager) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${dmg}`, '#9a3a3a'));
                    }
                    // 流血血渍：特工斧头同款红色粒子落地，地面保留 10s（GameScene 统一实现）
                    const fxScene = typeof window !== 'undefined' ? window.__phaserScene : null;
                    if (fxScene && typeof fxScene.playBleedGroundParticles === 'function') {
                        fxScene.playBleedGroundParticles(this.x, this.y, this);
                    }
                    this._bleedTickTimer = 1000;
                }
                if (this._bleedTimer <= 0) {
                    this._bleedStacks = Math.max(0, this._bleedStacks - 1);
                    if (this._bleedStacks > 0) {
                        this._bleedTimer = 10000;
                        if (this._bleedEffectId && StatusBar) {
                            // 同步重置状态栏计时器：addEffect 对已有同类效果会刷新 remaining/duration，
                            // 避免状态栏自身的 10s 倒计时到期把流血整体移除（实际逻辑是到期只减一层）
                            this._bleedEffectId = StatusBar.addEffect('bleed', 10000, { stacks: this._bleedStacks });
                        }
                    } else {
                        if (this._bleedEffectId && StatusBar) {
                            StatusBar.removeEffect(this._bleedEffectId);
                            this._bleedEffectId = null;
                        }
                    }
                }
            }
            applyCripple(duration, opts = {}) {
                if (this.hasStatusEffect('statusImmune')) return;
                // 状态栏显示
                if (StatusBar) {
                    this._crippleEffectId = StatusBar.addEffect('slow', duration, { name: '致残', icon: '🦴', color: '#8a8a7a' });
                }
                // 内部状态数组（供 hasStatusEffect 查询）
                this.addStatusEffect('slow', duration, { name: '致残', icon: '🦴', color: '#8a8a7a' });
                if (!opts.silent && EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, '🦴 致残！', '#8a8a7a'));
                }
            }
            applyBind(duration) {
                if (this.hasStatusEffect('statusImmune')) return;
                if (StatusBar) {
                    this._bindEffectId = StatusBar.addEffect('bind', duration, { name: '束缚', icon: '⛓️', color: '#7a5a8a' });
                }
                this.addStatusEffect('bind', duration, { name: '束缚', icon: '⛓️', color: '#7a5a8a' });
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, '⛓️ 束缚！', '#7a5a8a'));
                }
            }
            applyBleeding(stacks) {
                if (this.hasStatusEffect('statusImmune')) return;
                this._bleedStacks += stacks;
                this._bleedTimer = 10000;
                if (this._bleedTickTimer <= 0) this._bleedTickTimer = 1000;
                // addEffect 对已有同类效果会刷新 remaining/duration，保持状态栏与实际计时同步
                this._bleedEffectId = StatusBar.addEffect('bleed', 10000, { stacks: this._bleedStacks });
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
                if (this.hasStatusEffect('statusImmune')) return;
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
                if (this.hasStatusEffect('statusImmune')) return;
                this._droneVulnerabilityStacks += stacks;
                this._droneVulnerabilityTimer = 999999;
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `🛸 无人机易伤 +${stacks}层`, '#5a7a9a'));
                }
            }

            // --- 状态效果：圣光续疗（HoT，每秒恢复最大生命值百分比） ---
            _updateHolyRenewal(dt) {
                if (!this._holyRenewalStacks || this._holyRenewalStacks <= 0) return;
                this._holyRenewalTimer -= dt;
                this._holyRenewalTickTimer -= dt;
                if (this._holyRenewalTickTimer <= 0) {
                    const maxHp = (this.data && this.data.maxHp) || this.maxHp || 1;
                    const healPercent = this._holyRenewalHealPercent || 0.01;
                    const heal = Math.max(1, Math.floor(maxHp * healPercent * this._holyRenewalStacks));
                    if (this.data) this.data.hp = Math.min((this.data.maxHp || this.maxHp || Infinity), (this.data.hp || 0) + heal);
                    if (EffectManager) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `+${heal}`, '#7aff9a'));
                    }
                    this._holyRenewalTickTimer = 1000;
                }
                if (this._holyRenewalTimer <= 0) {
                    this._holyRenewalStacks = 0;
                    this._holyRenewalTimer = 0;
                    if (this._holyRenewalEffectId && StatusBar) {
                        StatusBar.removeEffect(this._holyRenewalEffectId);
                        this._holyRenewalEffectId = null;
                    }
                }
            }
            applyHolyRenewal(stacks = 1, duration = 3000, healPercent = 0.01) {
                if (this.hasStatusEffect('statusImmune')) return;
                if (this._holyRenewalStacks > 0) {
                    this._holyRenewalStacks += stacks;
                    this._holyRenewalTimer += duration;
                } else {
                    this._holyRenewalStacks = stacks;
                    this._holyRenewalTimer = duration;
                    this._holyRenewalTickTimer = 1000;
                    this._holyRenewalHealPercent = healPercent;
                }
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `💚 圣光续疗 +${stacks}层`, '#7aff9a'));
                }
                const effect = this.statusEffects.find(e => e.type === 'holyRenewal');
                if (effect) {
                    effect.stacks = this._holyRenewalStacks;
                    effect.remaining = this._holyRenewalTimer;
                    effect.duration = Math.max(effect.duration, this._holyRenewalTimer);
                } else {
                    this.addStatusEffect('holyRenewal', this._holyRenewalTimer, { stacks: this._holyRenewalStacks });
                }
                if (this._faction === 'player' && StatusBar) {
                    this._holyRenewalEffectId = StatusBar.addEffect('holyRenewal', this._holyRenewalTimer, { stacks: this._holyRenewalStacks });
                }
            }

            // --- 状态效果：寒冷（每层减速，加法叠加最终乘算） ---
            _updateChill(dt) {
                if (!this._chillStacks || this._chillStacks <= 0) return;
                this._chillTimer -= dt;
                if (this._chillTimer <= 0) {
                    this._chillStacks = 0;
                    this._chillTimer = 0;
                    const effect = this.statusEffects.find(e => e.type === 'chill');
                    if (effect) this.removeStatusEffect('chill');
                    if (this._chillEffectId && StatusBar) {
                        StatusBar.removeEffect(this._chillEffectId);
                        this._chillEffectId = null;
                    }
                }
            }
            applyChill(stacks = 1, duration = 3000, slowPercent = 0.05) {
                if (this.hasStatusEffect('statusImmune')) return;
                // 冻结状态下不再叠加寒冷
                if (this.hasStatusEffect('frozen')) return;
                if (this._chillStacks > 0) {
                    this._chillStacks += stacks;
                    this._chillTimer += duration;
                } else {
                    this._chillStacks = stacks;
                    this._chillTimer = duration;
                    this._chillSlowPercent = slowPercent;
                }
                // 寒冷达到 20 层 → 触发冻结并减少 10 层寒冷
                if (this._chillStacks >= 20) {
                    this._chillStacks -= 10;
                    if (this._chillStacks < 0) this._chillStacks = 0;
                    this.applyFreeze(duration);
                    // 如果寒冷被扣光，清理寒冷状态显示
                    if (this._chillStacks === 0) {
                        this._chillTimer = 0;
                        this.removeStatusEffect('chill');
                        if (this._chillEffectId && StatusBar) {
                            StatusBar.removeEffect(this._chillEffectId);
                            this._chillEffectId = null;
                        }
                    }
                }
                if (EffectManager) {
                    // 统一寒冷反馈：任何来源（暴风雪/冰墙光环）都显示当前总层数，
                    // 冻结结束恢复叠层时同样能看到 x11、x12…；横向抖动避免同点堆叠
                    const jx = (Math.random() - 0.5) * 22;
                    EffectManager.add(new FloatingTextEffect(
                        this.x + jx,
                        this.y - this.size - 12,
                        `❄️ 寒冷 x${this._chillStacks}`,
                        '#7ab8e0'
                    ));
                }
                const effect = this.statusEffects.find(e => e.type === 'chill');
                if (effect) {
                    effect.stacks = this._chillStacks;
                    effect.remaining = this._chillTimer;
                    effect.duration = Math.max(effect.duration, this._chillTimer);
                } else {
                    this.addStatusEffect('chill', this._chillTimer, { stacks: this._chillStacks });
                }
                if (this._faction === 'player' && StatusBar) {
                    this._chillEffectId = StatusBar.addEffect('chill', this._chillTimer, { stacks: this._chillStacks });
                }
            }
            // --- 状态效果：冻结（等同于眩晕 + 50% 额外物理伤害 + 冰块视觉） ---
            _updateFreeze(dt) {
                if (!this._freezeStacks || this._freezeStacks <= 0) return;
                this._freezeTimer -= dt;
                if (this._freezeTimer <= 0) {
                    this._freezeStacks = 0;
                    this._freezeTimer = 0;
                    const effect = this.statusEffects.find(e => e.type === 'frozen');
                    if (effect) this.removeStatusEffect('frozen');
                    if (this._freezeEffectId && StatusBar) {
                        StatusBar.removeEffect(this._freezeEffectId);
                        this._freezeEffectId = null;
                    }
                }
            }
            applyFreeze(duration = 3000) {
                if (this.hasStatusEffect('statusImmune')) return;
                // 冻结等同于眩晕：强制中断当前动作
                if (typeof this._cancelAllActionsForStun === 'function') {
                    this._cancelAllActionsForStun(); // 玩家专用：施法/特殊攻击/换弹等
                } else {
                    this._cancelActionsForStun();    // 通用实体：攻击动画/预警等
                }
                this._freezeStacks = 1;
                this._freezeTimer = duration;
                // 对玩家：冻结同时进入眩晕控制状态，控制时长取两者较长
                if (this._faction === 'player') {
                    this.isStunned = true;
                    this.stunTimer = Math.max(this.stunTimer || 0, duration);
                }
                // 清理已有的冻结显示，避免重复
                this.removeStatusEffect('frozen');
                if (this._freezeEffectId && StatusBar) StatusBar.removeEffect(this._freezeEffectId);
                this.addStatusEffect('frozen', duration, { stacks: 1 });
                if (this._faction === 'player' && StatusBar) {
                    this._freezeEffectId = StatusBar.addEffect('frozen', duration, { stacks: 1 });
                }
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, '🧊 冻结！', '#a0d8ff'));
                }
                if (SoundManager && SoundManager.playWorld) {
                    // 世界音效（2026-08-11 距离衰减）：冻结声按被冻目标位置衰减
                    SoundManager.playWorld('assets/sounds/skills/frozn.mp3', this.x, this.y);
                } else if (SoundManager && SoundManager.playFile) {
                    SoundManager.playFile('assets/sounds/skills/frozn.mp3');
                }
            }
            /** 是否处于冻结状态 */
            isFrozen() {
                return this._freezeStacks > 0 && this._freezeTimer > 0;
            }
            /** 寒冷移速倍率：1 - 层数×每层减速，下限 0.01 */
            getChillSpeedMul() {
                if (!this._chillStacks || this._chillStacks <= 0) return 1;
                const perStack = this._chillSlowPercent || 0.05;
                return Math.max(0.01, 1 - this._chillStacks * perStack);
            }

            // --- 状态效果：灼伤（每 0.5s 造成施法者魔法攻击×倍率伤害，可叠加） ---
            _updateBurn(dt) {
                if (!this._burnStacks || this._burnStacks.length === 0) return;
                this._burnTickTimer -= dt;
                for (const stack of this._burnStacks) stack.remaining -= dt;
                // 移除已到期层
                this._burnStacks = this._burnStacks.filter(s => s.remaining > 0);
                if (this._burnStacks.length === 0) {
                    this._burnTickTimer = 0;
                    const effect = this.statusEffects.find(e => e.type === 'burn');
                    if (effect) this.removeStatusEffect('burn');
                    if (this._burnEffectId && StatusBar) {
                        StatusBar.removeEffect(this._burnEffectId);
                        this._burnEffectId = null;
                    }
                    return;
                }
                if (this._burnTickTimer <= 0) {
                    let totalDmg = 0;
                    let source = null;
                    for (const stack of this._burnStacks) {
                        const matk = stack.matk || 0;
                        totalDmg += Math.max(1, Math.floor(matk * stack.damageMul));
                        if (!source && stack.source && stack.source.active !== false) source = stack.source;
                    }
                    if (totalDmg > 0) {
                        // 灼伤属于魔法持续伤害；source 失效时用 this 自身占位，确保伤害数字正常结算
                        this.takeDamage(totalDmg, source || this, 'magic');
                        if (EffectManager) {
                            EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${totalDmg}`, '#ff6b35'));
                        }
                    }
                    this._burnTickTimer = this._burnTickMs || 500;
                }
            }
            applyBurn(source, stacks = 1, duration = 3000, damageMul = 0.5, tickMs = 500) {
                if (this.hasStatusEffect('statusImmune')) return;
                const matk = (source && source.data && source.data.matk) || 0;
                if (!this._burnStacks) this._burnStacks = [];
                for (let i = 0; i < stacks; i++) {
                    this._burnStacks.push({ source, matk, damageMul, remaining: duration });
                }
                this._burnTickMs = tickMs;
                if (this._burnTickTimer <= 0) this._burnTickTimer = tickMs;
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `🔥 灼伤 +${stacks}层`, '#ff6b35'));
                }
                const totalStacks = this._burnStacks.length;
                const effect = this.statusEffects.find(e => e.type === 'burn');
                if (effect) {
                    effect.stacks = totalStacks;
                    effect.remaining = Math.max(effect.remaining, duration);
                    effect.duration = Math.max(effect.duration, duration);
                } else {
                    this.addStatusEffect('burn', duration, { stacks: totalStacks });
                }
                if (this._faction === 'player' && StatusBar) {
                    this._burnEffectId = StatusBar.addEffect('burn', duration, { stacks: totalStacks });
                }
            }

            // --- 状态效果：感电（每层使受到的电系伤害 +3%；叠满 5 层触发过载） ---
            _updateElectrified(dt) {
                if (!this._electrifiedStacks || this._electrifiedStacks <= 0) return;
                this._electrifiedTimer -= dt;
                if (this._electrifiedTimer <= 0) {
                    this._electrifiedStacks = 0;
                    this._electrifiedTimer = 0;
                    this._electrifiedSource = null;
                    const effect = this.statusEffects.find(e => e.type === 'electrified');
                    if (effect) this.removeStatusEffect('electrified');
                    if (this._electrifiedEffectId && StatusBar) {
                        StatusBar.removeEffect(this._electrifiedEffectId);
                        this._electrifiedEffectId = null;
                    }
                }
            }
            /**
             * 应用感电（debuff 工作流见 SKILL.md）：
             * - 每层使该目标受到的电系魔法伤害 +3%（takeDamage 电系分支消费）；
             * - 叠满 5 层自动触发「过载」：眩晕 1.2s + 对周围 150px 敌方传导一次电击，清空全部层数；
             * - 层数加法叠加、持续时间累加，到期全部清空（与寒冷同模式）。
             * @param {number} stacks - 新增层数
             * @param {number} duration - 新增持续时间（毫秒）
             * @param {object} source - 施放来源（过载伤害归属）
             */
            applyElectrified(stacks = 1, duration = 4000, source) {
                if (this._isDead) return;
                if (this.hasStatusEffect('statusImmune')) return;
                this._electrifiedStacks = (this._electrifiedStacks || 0) + stacks;
                this._electrifiedTimer = (this._electrifiedTimer || 0) + duration;
                if (source && source.active !== false) this._electrifiedSource = source;
                // 叠满 5 层：触发过载并清空
                if (this._electrifiedStacks >= 5) {
                    this._electrifiedStacks = 0;
                    this._electrifiedTimer = 0;
                    this._triggerElectrifiedOverload(source);
                    this.removeStatusEffect('electrified');
                    if (this._electrifiedEffectId && StatusBar) {
                        StatusBar.removeEffect(this._electrifiedEffectId);
                        this._electrifiedEffectId = null;
                    }
                    return;
                }
                if (EffectManager) {
                    // 横向抖动避免同点堆叠
                    const jx = (Math.random() - 0.5) * 22;
                    EffectManager.add(new FloatingTextEffect(this.x + jx, this.y - this.size - 12, `⚡ 感电 x${this._electrifiedStacks}`, '#b98cff'));
                }
                const effect = this.statusEffects.find(e => e.type === 'electrified');
                if (effect) {
                    effect.stacks = this._electrifiedStacks;
                    effect.remaining = this._electrifiedTimer;
                    effect.duration = Math.max(effect.duration, this._electrifiedTimer);
                } else {
                    this.addStatusEffect('electrified', this._electrifiedTimer, { stacks: this._electrifiedStacks });
                }
                if (this._faction === 'player' && StatusBar) {
                    this._electrifiedEffectId = StatusBar.addEffect('electrified', this._electrifiedTimer, { stacks: this._electrifiedStacks });
                }
            }
            /** 过载：眩晕 1.2s + 对周围 150px 敌方单位传导一次电击（伤害归属施放来源） */
            _triggerElectrifiedOverload(source) {
                const src = (source && source.active !== false) ? source : (this._electrifiedSource || this);
                // 控制效果：眩晕 1.2s（applyStun 内部统一中断动作）
                this.applyStun(1200);
                const entities = (typeof window !== 'undefined' && window.Game && window.Game.entities)
                    ? Array.from(window.Game.entities.values()) : [];
                const matk = (src.data && src.data.matk) || 0;
                const int = (src.data && src.data.int) || 0;
                const damage = Math.floor(20 + matk * 1.2 + int * 1.2);
                const overloadRadius = 150;
                const hitX = this.x;
                const hitY = this.y - ((this.bodyHeight || 120) * 0.5);
                const hitDepth = (this._phaserSprite ? this._phaserSprite.depth : this.y + 10) + 2;
                for (const e of entities) {
                    if (!e || e === this || !e.active || !e.hittable) continue;
                    if (e._faction === this._faction) continue;
                    if (Math.hypot(e.x - this.x, e.y - this.y) > overloadRadius) continue;
                    EffectManager.add(new LightningBoltEffect(this, e, {
                        durationMs: 450,
                        fadeMs: 220,
                        segments: 8,
                        jitter: 0.11,
                        uniform: true,
                        widthScale: 0.45,
                    }));
                    burstParticles({
                        texture: 'impact_dot',
                        x: e.x,
                        y: e.y - ((e.bodyHeight || 120) * 0.5),
                        count: 12,
                        jitter: 36,
                        config: {
                            speed: { min: 90, max: 420 },
                            scale: { start: 3.2, end: 0.4 },
                            alpha: { start: 1.0, end: 0 },
                            lifespan: { min: 300, max: 600 },
                            tint: [0xffffff, 0xcbb4ff, 0x8f7bff, 0x6a4bff],
                            blendMode: 'ADD',
                        },
                        destroyAfterMs: 700,
                        depth: (e._phaserSprite ? e._phaserSprite.depth : e.y + 10) + 2,
                    });
                    e.takeDamage(damage, src, 'electric');
                }
                if (EffectManager) {
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 18, '⚡ 过载！', '#b98cff'));
                    burstParticles({
                        texture: 'impact_dot',
                        x: hitX,
                        y: hitY,
                        count: 22,
                        jitter: 48,
                        config: {
                            speed: { min: 120, max: 520 },
                            scale: { start: 4.2, end: 0.4 },
                            alpha: { start: 1.0, end: 0 },
                            lifespan: { min: 380, max: 700 },
                            tint: [0xffffff, 0xddd2ff, 0x8f7bff, 0x4b2bff],
                            blendMode: 'ADD',
                        },
                        destroyAfterMs: 800,
                        depth: hitDepth,
                    });
                }
                if (SoundManager && SoundManager.playWorld) {
                    // 世界音效（2026-08-11 距离衰减）：闪电音效按受击位置衰减
                    SoundManager.playWorld('assets/sounds/skills/lightning-1.mp3', this.x, this.y);
                } else if (SoundManager && SoundManager.playFile) {
                    SoundManager.playFile('assets/sounds/skills/lightning-1.mp3');
                }
            }

            update(dt) {
                // 更新状态栏效果计时器
                this.updateStatusEffects(dt);
                // 更新伤害型状态效果（中毒、流血、易伤、灼伤）
                this._updatePoison(dt);
                this._updateBleed(dt);
                this._updateMagicVulnerability(dt);
                this._updateDroneVulnerability(dt);
                this._updateBurn(dt);
                // 更新治疗/减速/控制型状态效果
                this._updateHolyRenewal(dt);
                this._updateChill(dt);
                this._updateFreeze(dt);
                this._updateElectrified(dt);
                if (!this.immovable && (Math.abs(this.knockbackX) > 0.1 || Math.abs(this.knockbackY) > 0.1)) {
                    const nx = this.x + this.knockbackX;
                    const ny = this.y + this.knockbackY;
                    // 击退时加入墙壁碰撞检测，防止穿墙
                    const radius = this.groundRadius;
                    if (WallSystem && WallSystem.walls && WallSystem.walls.length > 0) {
                        const resolved = WallSystem.resolve(
                            this.x,
                            this.y,
                            nx,
                            ny,
                            radius,
                            WallSystem.ignoreForEntity?.(this) || null
                        );
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
                if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
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
