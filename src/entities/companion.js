// ============================================================
// 侍从（Companion）实体——数据模型与玩家对齐（2026-08-12 框架）
// 需求：队员等级/属性/背包/装备/技能栏与玩家单位一致；仅战斗获取经验；
//       升级属性点按成长规则分配（companion-growth.js 注册表，不硬编码）。
// 本类保持纯净（无 Phaser 依赖），供队伍系统 / UI / 战斗结算消费。
// ============================================================

import { computeMaxExp } from '../config/exp-system.js';
import { allocateOnLevelUp } from '../config/companion-growth.js';
import { canEquipSlot, getEquipmentBonuses, isOneHandedItem } from '../ui/equip/equip-rules.js';
import { buildSkillMap, restoreSkills, grantCompanionSkillExp } from '../systems/skill-system.js';
import COMBAT_FORMULAS from '../../data/combat-formulas.json';
import companionConfigData from '../../data/companion-config.json';
import { EnergyManager } from '../systems/energy-manager.js';
import { getTributeFriendlyAtkMul, getTributeFriendlyMaxHpMul } from '../config/tribute-effects.js';
import { canMeleeShareSurface } from '../combat/melee-surface.js';
import { applyOutgoingDamageModifiers } from '../combat/outgoing-damage-modifiers.js';
import { Collider } from '../physics/collider.js';

const ATTR_KEYS = ['str', 'dex', 'int', 'con', 'wis', 'luck'];

export class Companion {
    /**
     * @param {object} archive - companion-config.json 里的队员档案
     */
    constructor(archive) {
        this.id = archive.id;
        this.name = archive.name || archive.id;
        this.title = archive.title || '';
        this.desc = archive.desc || '';
        this.role = archive.role || 'generic';
        this.growthRule = archive.growthRule || 'balanced';
        this.avatar = archive.avatar || '👤';
        this.modelPlaceholder = archive.modelPlaceholder || '';
        this.weaponType = archive.weaponType || 'sword';
        // 渲染尺寸/脚底偏移（companion-config.json 配置驱动）：displaySize 覆盖默认帧显示边长；
        // spriteOffsetY 让精灵图脚底贴合逻辑落地点（素材帧内脚底不在帧中心时使用）。
        this.displaySize = archive.displaySize || 0;
        this.spriteOffsetY = archive.spriteOffsetY || 0;
        // 装备限制（companion-config.json equipRules 配置驱动）：
        //   weaponTypes - 允许的武器类型（如露娜只许 staff 法杖）；
        //   armorSets   - 允许的法袍类套装（如 robe/eclipse/lunar/oracle_robe，+魔法攻击力套装）。
        // 未配置（null）表示无限制，走玩家同款 equip-rules。
        this.equipRules = archive.equipRules || null;
        // 装备栏顶部注释文案（如露娜“只能装备法杖和法袍类装备”）。
        this.equipNote = archive.equipNote || '';
        // AI 配置（2026-08-14）：有 ai 字段的队员由 CompanionAI 驱动战斗/跟随；无则纯跟随渲染
        this.aiConfig = archive.ai || null;
        // 六维战斗属性公式源（2026-08-16）：仓鼠友军单位 statFormula='enemy' →
        // 派生数值（atk/def/matk/mdef/crit/critRes）走怪物同款公式（combat-formulas
        // enemy.calculateCombatStats）；伙伴（伊莉丝/露娜）默认玩家公式不变。
        this._enemyCombatStats = archive.statFormula === 'enemy';
        // 初始魔法覆盖（2026-08-15）：露娜 baseMaxMp=600（1 级基准，升级仍 +10/级 + 装备加成）
        this._maxMpOverride = archive.baseMaxMp || 0;
        // 初始生命覆盖（2026-08-16）：仓鼠战士 baseMaxHp=300（con=15 → 公式 250，覆盖为 300）；
        // 与 baseMaxMp 同口径：1 级基准，升级 +10/级 + 装备 maxHp 加成保留
        this._maxHpOverride = archive.baseMaxHp || 0;
        // 消耗品自动使用设置（背包界面可改；低 HP/MP 比例时自动用对应恢复药水，低级→高级）
        this.consumableSettings = {
            enabled: true,
            hpThreshold: 0.3,
            mpThreshold: 0.25,
            useLowToHigh: true,
            ...(archive.consumableSettings || {}),
        };

        const base = archive.baseData || {};
        const level = archive.baseLevel || 1;
        this.data = {
            level,
            exp: archive.baseExp || 0,
            maxExp: computeMaxExp(level),
            attrPoints: 0,
            str: base.str || 5,
            dex: base.dex || 5,
            int: base.int || 5,
            con: base.con || 5,
            wis: base.wis || 5,
            luck: base.luck || 5,
            hp: 0,
            mp: 0,
            maxHp: 0,
            maxMp: 0,
            stamina: 100,
            maxStamina: 100,
        };
        // 装备栏（与玩家同构：weapon/weapon2/offhand/armor/helmet/... 由装备系统消费）
        this.equipments = {};
        // 背包（与玩家同构：{slot, item} 数组，slot 从 0 起）
        this.backpack = [];
        this.maxBackpackSlots = 10;   // 与玩家默认背包一致（EquipManager.maxBackpackSlots=10）
        // 技能栏：与玩家同一套数据驱动构建（skills.json → buildSkillFromJSON）。
        // archive.skills 为技能 id 数组（当前配置为空=占位，后续填 id 即自动拥有/修炼/渲染）
        this.skills = buildSkillMap(archive.skills || []);
        // 技能解锁表：skillId → 解锁等级（升到该级自动加入 skills，如露娜 10 级解锁圣光）
        this._unlockSkills = archive.unlockSkills || {};
        this._checkUnlocks();
        // 动作动画配置（walk/run/spell 等；素材已入库 assets/companions/<id>/）
        this.animations = archive.animations || {};
        // 音效配置（仓鼠单位等：attack/mining 键 → 文件路径；AI 按事件播放，路径不进代码）
        this.sounds = archive.sounds || {};
        // ===== 战斗运行时字段（由 CompanionAI / PartySystem.updateCombat 驱动；不进存档）=====
        this.active = true;
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.rotation = 0;
        this.isMoving = false;
        this.maxSpeed = 120;
        this.accel = 0.35;
        this.friction = 0.85;
        this.groundRadius = archive.groundRadius ?? archive.collisionRadius ?? 26;
        this.bodyHeight = 130;
        this._faction = 'companion'; // 与 player 互为友军（技能敌我判定按阵营分组）
        this._isPartyCompanion = true;
        this._enemyTargetable = true; // 世界-122：正式玩家队友可被防守怪锁定；仓鼠有更高分类优先级
        this.hittable = true;
        this.hitFlash = 0;
        this.hitFlashDuration = 120;
        this.target = null;
        this._animState = 'idle';    // idle | walk | run | spell（渲染层消费）
        this._castState = 'idle';    // idle | casting | recover
        this._lastFaceRight = true;  // 渲染朝向：移动方向决定（flipX）
        this._frozenForCast = false; // MovementSystem 施法锁定
        this._castCooldown = 0;      // AI 施法节流（ms）
        this._fireballCooldown = 0;
        this._iceSpikeCooldown = 0;
        this._lightningStrikeCooldown = 0;
        this._holyLightCooldown = 0;
        this._defending = false; // 剑盾防御（持盾减伤 + 常态弹反）生效标志，防御 hold 期由 CompanionAI 置位
        // 世界-122 友军同样可承接 DamageableEntity 的公共增益语义（如牧师的激励）。
        this.statusEffects = [];
        this._inspireMul = null;
        this._usesModifierInspire = true;
        this.calculateCombatStats(); // 初始化战斗属性（matk 等，含无装备基础魔攻）
        this._formulaBaseAtk = Math.max(1, Number(this.data.atk) || 1);
        this.updateMaxStats();
        this.data.hp = this.data.maxHp;
        this.data.mp = this.data.maxMp;
    }

    /**
     * 给 Game.friendlyUnits 使用的统一碰撞配置入口。
     * 子类先保留各自现有半径/高度作为默认值，再由配置文件中的编辑器字段覆盖；
     * 正式单位和碰撞编辑器预览因此读取同一份数据。
     */
    configureCollisionFromArchive(archive = {}) {
        const positive = (value, fallback) => {
            const n = Number(value);
            return Number.isFinite(n) && n > 0 ? n : fallback;
        };
        const render = archive.render || {};
        const radius = positive(
            archive.collisionRadius ?? archive.groundRadius,
            positive(this.collisionRadius ?? this.groundRadius, 26)
        );
        const height = positive(
            archive.height ?? archive.bodyHeight,
            positive(this.bodyHeight, radius * 2)
        );
        const hitbox = render.projectileHitbox || this.config?.render?.projectileHitbox || null;

        this.groundRadius = radius;
        this.collisionRadius = radius;
        this.bodyHeight = height;
        this.collisionShape = 'circle';
        this.collisionWidth = positive(render.collisionWidth ?? hitbox?.width, radius * 2);
        this.collisionHeight = positive(render.collisionHeight ?? hitbox?.height, height);
        this.colliderOffsetX = Number(render.colliderOffsetX ?? archive.colliderOffsetX) || 0;
        this.colliderOffsetY = Number(render.colliderOffsetY ?? archive.colliderOffsetY) || 0;
        this.config = {
            ...(this.config || {}),
            height,
            render: {
                ...(render || {}),
                ...(this.config?.render || {}),
                ...(hitbox ? { projectileHitbox: { ...hitbox } } : {}),
            },
        };
        this.rebuildCollider();
    }

    rebuildCollider() {
        this.collider = Collider.fromEntity(this);
        this.collider.attach(this);
    }

    get level() { return this.data.level; }
    get hp() { return this.data.hp; }
    get maxHp() { return this.data.maxHp; }

    hasStatusEffect(type) {
        return this.statusEffects.some((effect) => effect.type === type && effect.remaining > 0);
    }

    addStatusEffect(type, duration, options = {}) {
        const existing = this.statusEffects.find((effect) => effect.type === type);
        if (existing) {
            existing.remaining = Math.max(existing.remaining, duration);
            existing.duration = Math.max(existing.duration, duration);
            return existing;
        }
        const effect = {
            type,
            duration,
            remaining: duration,
            icon: options.icon || '✨',
            name: options.name || type,
            color: options.color || '#9a9a5a',
        };
        this.statusEffects.push(effect);
        return effect;
    }

    updateStatusEffects(dt) {
        for (let i = this.statusEffects.length - 1; i >= 0; i--) {
            const effect = this.statusEffects[i];
            effect.remaining -= dt;
            if (effect.remaining > 0) continue;
            if (effect.type === 'inspire') this._onInspireEnd();
            this.statusEffects.splice(i, 1);
        }
    }

    /**
     * 友军激励使用临时修饰器，不再直接乘除基础属性/AI配置。
     * 这样激励期间升级、重算六维或切换装备都不会在结束时被错误除回旧值。
     */
    applyInspire(duration, opts = {}) {
        const speedMul = opts.speedMul ?? 1.33;
        const atkMul = opts.atkMul ?? 1.5;
        if (!this.hasStatusEffect('inspire')) {
            this._inspireMul = { speedMul, atkMul };
        }
        this.addStatusEffect('inspire', duration, { name: '激励', icon: '📣', color: '#ffb347' });
    }

    _onInspireEnd() {
        this._inspireMul = null;
    }

    getMoveSpeedMultiplier() {
        return Math.max(0, Number(this._inspireMul?.speedMul) || 1);
    }

    /**
     * 配置 attackDamage 是该单位初始六维下的基准伤害。
     * 等级/装备改变物攻后按当前物攻÷初始物攻缩放；激励作为独立临时乘区。
     * 暴击率与目标暴抗按百分比相减，暴击伤害固定 1.5 倍。
     */
    getPhysicalAttackDamagePreview(configuredDamage) {
        const baseDamage = Math.max(0, Number(configuredDamage) || 0);
        const currentAtk = Math.max(1, Number(this.data?.atk) || this._formulaBaseAtk || 1);
        const baseAtk = Math.max(1, Number(this._formulaBaseAtk) || currentAtk);
        const inspireMul = Math.max(0, Number(this._inspireMul?.atkMul) || 1);
        // 工艺品祭品：全体友方单位攻击乘区（friendlyAtkPercent，实时聚合）
        const tributeMul = getTributeFriendlyAtkMul();
        return Math.max(1, Math.round(baseDamage * currentAtk / baseAtk * inspireMul * tributeMul));
    }

    getPhysicalAttackDamage(configuredDamage, target = null) {
        let damage = this.getPhysicalAttackDamagePreview(configuredDamage);
        const critRate = Math.max(
            0,
            (Number(this.data?.crit) || 0) - (Number(target?.data?.critRes) || 0)
        );
        this._lastAttackCrit = Math.random() * 100 < critRate;
        if (this._lastAttackCrit) damage *= 1.5;
        return Math.max(1, Math.round(damage));
    }

    /** 单位死亡后从所属建筑持有列表移除，避免补员数越多历史引用越长。 */
    detachFromOwner() {
        const owner = this._barracks || this._hut || null;
        const list = this._hut ? owner?.miners : owner?.units;
        if (!Array.isArray(list)) return false;
        const index = list.indexOf(this);
        if (index < 0) return false;
        list.splice(index, 1);
        return true;
    }

    /** 升级曲线与玩家同口径（唯一来源 combat-formulas player.expPerLevel） */
    getExpForLevel(level) {
        return computeMaxExp(level);
    }

    /**
     * 战斗经验获取（仅进入战斗时调用；与玩家同额、无平分机制）。
     * 升级：属性点按 growthRule 自动分配（不手动加点），HP/MP 回满。
     */
    gainExp(amount) {
        if (amount <= 0) return;
        const d = this.data;
        d.exp += Math.floor(amount);
        let leveled = false;
        while (d.exp >= d.maxExp) {
            d.exp -= d.maxExp;
            d.level += 1;
            d.maxExp = this.getExpForLevel(d.level);
            d.attrPoints += 2;
            this._applyGrowth(d.attrPoints);
            d.attrPoints = 0;
            this._checkUnlocks();
            this.updateMaxStats();
            d.hp = d.maxHp;
            d.mp = d.maxMp;
            leveled = true;
        }
        if (leveled && typeof this.onLevelUp === 'function') this.onLevelUp(d.level);
        return d.level;
    }

    /** 升级属性点按成长规则分配（不硬编码：规则在 companion-growth.js 注册表） */
    _applyGrowth(points) {
        const deltas = allocateOnLevelUp(this, this.growthRule, points);
        for (const k of ATTR_KEYS) this.data[k] += deltas[k] || 0;
        return deltas;
    }

    /** 技能解锁：达到解锁等级且未拥有的技能自动加入 skills（升级时/构造时调用） */
    _checkUnlocks() {
        for (const [skillId, lvl] of Object.entries(this._unlockSkills || {})) {
            if (this.data.level >= lvl && !this.skills[skillId]) {
                const rebuilt = buildSkillMap([skillId]);
                if (rebuilt[skillId]) this.skills[skillId] = rebuilt[skillId];
            }
        }
    }

    /** 最大生命/魔法与玩家同公式（combat-formulas player.maxHp/maxMp） */
    updateMaxStats() {
        const d = this.data;
        const formulas = COMBAT_FORMULAS.player || {};
        const hpF = formulas.maxHp || { base: 100, conMultiplier: 10 };
        const mpF = formulas.maxMp || { base: 100, wisMultiplier: 10, intMultiplier: 5 };
        const eq = this.getEquipmentBonuses();
        const oldMaxHp = d.maxHp;
        const oldMaxMp = d.maxMp;
        // 每级成长 +10 生命 / +10 魔法（1 级为 0，2 级 +10，依此类推；玩家/队员同口径）
        const lvlHp = (d.level - 1) * 10;
        const lvlMp = (d.level - 1) * 10;
        if (this._maxHpOverride > 0) {
            // 初始生命覆盖：1 级基准 = baseMaxHp，升级 +10/级，装备 maxHp 加成保留
            d.maxHp = this._maxHpOverride + (eq.maxHp || 0) + lvlHp;
        } else {
            d.maxHp = (hpF.base || 100) + d.con * (hpF.conMultiplier || 10) + (eq.maxHp || 0) + lvlHp;
        }
        if (this._maxMpOverride > 0) {
            // 初始魔法覆盖：1 级基准 = baseMaxMp，升级 +10/级，装备 maxMp 加成保留
            d.maxMp = this._maxMpOverride + (eq.maxMp || 0) + lvlMp;
        } else {
            d.maxMp = (mpF.base || 100) + d.wis * (mpF.wisMultiplier || 10) + d.int * (mpF.intMultiplier || 5) + (eq.maxMp || 0) + lvlMp;
        }
        // 工艺品祭品：全体友方单位生命乘区（friendlyMaxHpPercent，实时聚合）
        const friendlyHpMul = getTributeFriendlyMaxHpMul();
        if (friendlyHpMul !== 1) d.maxHp = Math.max(1, Math.round(d.maxHp * friendlyHpMul));
        if (oldMaxHp > 0) d.hp = Math.min(d.maxHp, d.hp + (d.maxHp - oldMaxHp));
        else d.hp = d.maxHp;
        if (oldMaxMp > 0) d.mp = Math.min(d.maxMp, d.mp + (d.maxMp - oldMaxMp));
        else d.mp = d.maxMp;
    }

    /**
     * 装备槽位判定：先按队友 equipRules 做职业限制，再走玩家同款规则（equip-rules.canEquipSlot）。
     * 限制逻辑（数据驱动，未配置 equipRules 的队友无限制）：
     *   - 武器类物品（weaponType/rangedType/category 含 weapon）只能装 weaponTypes 允许的类型；
     *   - 法袍类防具（category === 'armor'）只能装 armorSets 允许的套装（+魔法攻击力套装）；
     *   - 首饰/消耗品不受限（非武器也非法袍防具）。
     */
    canEquip(item, slot) {
        if (item && slot && this.equipRules) {
            const isWeaponItem = item.weaponType || (item.category && item.category.includes('weapon')) || item.rangedType;
            if (isWeaponItem) {
                const allowedWeapons = this.equipRules.weaponTypes || [];
                if (allowedWeapons.length && !allowedWeapons.includes(item.weaponType)) {
                    return false;
                }
                // 单手剑限制：伊莉丝只许单手剑/盾，双手武器（如双手剑）直接拒绝
                if (this.equipRules.oneHandedWeaponsOnly && item.isTwoHanded) {
                    return false;
                }
            } else if (item.category === 'armor') {
                const allowedSets = this.equipRules.armorSets || [];
                if (allowedSets.length && !allowedSets.includes(item.armorSet)) {
                    return false;
                }
            }
        }
        return canEquipSlot(item, slot);
    }

    /**
     * 受击入口（镜像玩家 ShieldSystem.onDamageTaken，2026-08-15 剑盾护卫）：
     * 防御 hold 期（_defending=true）→ 持盾减伤 + 常态触发弹反（无窗口/朝向限制）；
     * 否则照常掉血。敌人当前不主动攻击队友，此方法供未来仇恨/范围伤害链路复用。
     * @returns {{damage:number, parried:boolean}}
     */
    takeDamage(damage, attacker, damageType = 'physical', isMelee = true) {
        // 必须在暴击、盾反、击退和修炼奖励之前关门，避免跨层攻击产生任何副作用。
        if (isMelee && attacker && !canMeleeShareSurface(attacker, this)) {
            return { damage: 0, parried: false, critical: false, blockedBySurface: true };
        }
        const d = this.data;
        let raw = Math.max(0, Number(damage) || 0);
        const finalCritRate = Math.max(
            0,
            (Number(attacker?.data?.crit) || 0) - (Number(d.critRes) || 0)
        );
        const critical = Math.random() * 100 < finalCritRate;
        if (critical) raw *= 1.5;
        const defense = damageType === 'magic' || damageType === 'electric'
            ? Math.max(0, Number(d.mdef) || 0)
            : Math.max(0, Number(d.def) || 0);
        const reduction = defense / (defense + 60);
        const minimum = Math.floor(raw * 0.1);
        const mitigated = Math.max(minimum, Math.floor(raw * (1 - reduction)));
        const outgoingAdjusted = applyOutgoingDamageModifiers(mitigated, attacker);
        if (this._defending) {
            const shieldData = this._getShieldData();
            const defense = (shieldData && shieldData.defense) || {};
            // 与玩家一致：remainingRatio = max(0.05, damageReduction)（small_shield 0.5 → 承伤 50%）
            const remainingRatio = Math.max(0.05, defense.damageReduction ?? 0.5);
            // 常态弹反：任何来源伤害都可弹（近战眩晕/击退/打断；远程抵消伤害）
            if (attacker && attacker._faction === 'enemy') {
                if (isMelee && typeof attacker.applyStun === 'function') {
                    attacker.applyStun(defense.parryStun || 2000);
                }
                if (attacker._attackTimer) attacker._attackTimer = 0;
                if (typeof attacker.applyKnockback === 'function') {
                    const angle = Math.atan2(attacker.y - this.y, attacker.x - this.x);
                    attacker.applyKnockback(angle, defense.parryKnockback || 100);
                }
                // 持盾防御修炼：弹反成功 +parry 经验（与玩家 addShieldDefenseExp 同 expRewards）
                const sd = this.skills && this.skills.shieldDefense;
                if (sd) {
                    const rw = sd.expRewards || {};
                    grantCompanionSkillExp(this, 'shieldDefense', rw.parry || 10);
                }
            }
            const dealt = outgoingAdjusted * remainingRatio;
            d.hp = Math.max(0, d.hp - dealt);
            if (dealt > 0) this.hitFlash = this.hitFlashDuration;
            return { damage: dealt, parried: true, critical };
        }
        d.hp = Math.max(0, d.hp - outgoingAdjusted);
        if (outgoingAdjusted > 0) this.hitFlash = this.hitFlashDuration;
        return { damage: outgoingAdjusted, parried: false, critical };
    }

    /** 当前装备的盾（副手优先，ring2 兜底；无盾返回 null） */
    _getShieldData() {
        for (const slot of ['offhand', 'ring2']) {
            const it = this.equipments && this.equipments[slot];
            if (it && it.weaponType === 'shield') return it;
        }
        return null;
    }

    /** 装备加成汇总（bonusStats/bonusPerEnhance/defense；与玩家同一套口径） */
    getEquipmentBonuses() {
        return getEquipmentBonuses(this.equipments);
    }

    /**
     * 从侍从背包装备（与玩家同规则但简化：自动槽位 → 替换回包）。
     * 武器：单手先 weapon 再 weapon2/offhand；盾进副手（主手双手武器时卸下主手）；
     *       双手武器只进主手槽；非武器按 item.equipSlot。目标槽被占 → 原装备回背包。
     * @returns {string|null} 装备到的槽位；失败返回 null
     */
    equipFromBackpack(backpackIdx) {
        const idx = this.backpack.findIndex(b => b.slot === backpackIdx);
        if (idx < 0) return null;
        const item = this.backpack[idx];
        if (!item || item.name === undefined) return null;

        let targetSlot;
        const isWeapon = item.category === 'weapon_melee' || item.category === 'weapon_ranged'
            || item.weaponType || item.rangedType;
        if (isWeapon) {
            const oneHanded = isOneHandedItem(item);
            if (item.weaponType === 'shield') {
                // 盾：优先对应副手；主手是双手武器则卸下主手
                const mainSlot = 'weapon';
                const mainItem = this.equipments[mainSlot];
                if (mainItem && mainItem.isTwoHanded) {
                    // 背包满无法卸下主手 → 拒绝装备（防旧装备静默丢失）
                    if (this._findFreeBackpackSlot() === -1) return null;
                    this._stashToBackpack(mainItem);
                    delete this.equipments[mainSlot];
                }
                targetSlot = 'offhand';
                if (this.equipments[targetSlot]) {
                    if (this._findFreeBackpackSlot() === -1) return null;
                    this._stashToBackpack(this.equipments[targetSlot]);
                    delete this.equipments[targetSlot];
                }
            } else if (oneHanded) {
                targetSlot = !this.equipments.weapon ? 'weapon'
                    : (!this.equipments.weapon2 ? 'weapon2'
                        : (!this.equipments.offhand ? 'offhand'
                            : 'weapon'));
                if (targetSlot === 'weapon' && this.equipments.weapon && this.equipments.weapon.isTwoHanded) {
                    if (this._findFreeBackpackSlot() === -1) return null;
                    this._stashToBackpack(this.equipments.weapon);
                    delete this.equipments.weapon;
                }
            } else {
                // 双手武器：主手槽
                targetSlot = 'weapon';
            }
        } else {
            targetSlot = item.equipSlot;
        }

        if (!targetSlot || !this.canEquip(item, targetSlot)) {
            // 规则不允许（如双手武器进副手）：直接落背包不动
            return null;
        }
        // 目标槽被占：原装备回背包
        if (this.equipments[targetSlot]) {
            // 背包满无法替换 → 拒绝装备（防旧装备静默丢失）
            if (this._findFreeBackpackSlot() === -1) return null;
            this._stashToBackpack(this.equipments[targetSlot]);
        }
        this.equipments[targetSlot] = JSON.parse(JSON.stringify(item));
        this.backpack.splice(idx, 1);
        this.calculateCombatStats();
        this.updateMaxStats();
        return targetSlot;
    }

    /** 卸下装备回背包（背包满则丢弃在目标槽外不处理，返回 false） */
    unequip(slot) {
        const item = this.equipments[slot];
        if (!item) return false;
        const freeSlot = this._findFreeBackpackSlot();
        if (freeSlot === -1) return false;
        this.backpack.push({ ...JSON.parse(JSON.stringify(item)), slot: freeSlot });
        delete this.equipments[slot];
        this.calculateCombatStats();
        this.updateMaxStats();
        return true;
    }

    /** 装备六维差值法写入 data（与玩家 calculateCombatStats 同思路；攻/防基础公式同玩家） */
    calculateCombatStats() {
        const d = this.data;
        const eq = this.getEquipmentBonuses();
        const prev = this._equipAttrBonus || { str: 0, dex: 0, int: 0, con: 0, wis: 0, luck: 0 };
        d.str += eq.str - prev.str;
        d.dex += eq.dex - prev.dex;
        d.int += eq.int - prev.int;
        d.con += eq.con - prev.con;
        d.wis += eq.wis - prev.wis;
        d.luck += eq.luck - prev.luck;
        this._equipAttrBonus = { str: eq.str, dex: eq.dex, int: eq.int, con: eq.con, wis: eq.wis, luck: eq.luck };
        // 仓鼠友军单位：六维派生数值走怪物同款公式（enemy.calculateCombatStats）。
        // 与怪物实现逐项对齐——atk 用 round 标志，其余（def/matk/mdef/crit/critRes）
        // 按 floor 口径；HP/等级不走这里（HP 由 baseMaxHp/con 公式在 updateMaxStats 定）。
        if (this._enemyCombatStats) {
            const ef = COMBAT_FORMULAS.enemy?.calculateCombatStats || {};
            const atkF = ef.attack || { base: 0, strMultiplier: 0.5, dexMultiplier: 0.5, round: true };
            const defF = ef.defense || { conMultiplier: 1.5, strMultiplier: 0.3, round: 'floor' };
            const matkF = ef.magicAttack || { base: 0, intMultiplier: 0.5, wisMultiplier: 0.5, round: 'floor' };
            const mdefF = ef.magicDefense || { wisMultiplier: 1.2, intMultiplier: 0.3, round: 'floor' };
            const critF = ef.crit || { base: 2, luckMultiplier: 1.0, round: 'floor' };
            const critResF = ef.critResist || { conMultiplier: 1.0, round: 'floor' };
            const fl = (v) => Math.floor(v);
            d.atk = atkF.round
                ? Math.round((atkF.base ?? 0) + d.str * atkF.strMultiplier + d.dex * atkF.dexMultiplier)
                : fl((atkF.base ?? 0) + d.str * atkF.strMultiplier + d.dex * atkF.dexMultiplier);
            d.atk += Math.round(eq.atk || 0);
            d.def = fl(d.con * defF.conMultiplier + d.str * defF.strMultiplier) + Math.round(eq.defense || 0);
            d.matk = fl((matkF.base ?? 0) + d.int * matkF.intMultiplier + d.wis * matkF.wisMultiplier) + Math.round(eq.matk || 0);
            d.mdef = fl(d.wis * mdefF.wisMultiplier + d.int * mdefF.intMultiplier);
            d.crit = fl((critF.base ?? 2) + d.luck * critF.luckMultiplier);
            d.critRes = fl(d.con * critResF.conMultiplier);
            return;
        }
        const formulas = COMBAT_FORMULAS.player || {};
        const atkF = formulas.attack || { base: 10, strMultiplier: 0.05, dexMultiplier: 0.1, round: true };
        d.atk = atkF.round
            ? Math.round(atkF.base + d.str * (atkF.strMultiplier || 0) + d.dex * (atkF.dexMultiplier || 0))
            : atkF.base + d.str * (atkF.strMultiplier || 0) + d.dex * (atkF.dexMultiplier || 0);
        d.atk += Math.round(eq.atk || 0);
        // 魔攻：基础公式（int/wis）+ 首饰 eq.matk + 装备 matkFormula（法杖等，与玩家 _getEquipmentMatkBonus 同口径）
        let matk = (eq.matk || 0);
        if (this.equipments) {
            for (const slotKey of Object.keys(this.equipments)) {
                const it = this.equipments[slotKey];
                if (!it || !it.matkFormula) continue;
                const el = it.enhanceLevel || 0;
                const f = it.matkFormula;
                const flat = (f.base || 0) + el * (f.enhanceBase || 0);
                const intMul = (f.intMul || 0) + el * (f.enhanceIntMul || 0);
                const wisMul = (f.wisMul || 0) + el * (f.enhanceWisMul || 0);
                matk += flat + d.int * intMul + d.wis * wisMul;
            }
        }
        // 魔攻基础公式与玩家对齐（formulas.magicAttack：int×1.5 + wis×0.5，floor）。
        // 此前误读空的 formulas.matk（{}）→ 无装备时 matk=0 → 普通攻击恒 1（2026-08-15）
        const matkF = formulas.magicAttack || { intMultiplier: 1.5, wisMultiplier: 0.5, floor: true };
        const baseMatk = matk + d.int * (matkF.intMultiplier || 0) + d.wis * (matkF.wisMultiplier || 0);
        d.matk = matkF.floor ? Math.floor(baseMatk) : Math.round(baseMatk);
        const defF = formulas.defense || { conMultiplier: 1.2, strMultiplier: 0.3, round: 'floor' };
        const raw = d.con * (defF.conMultiplier || 1.2) + d.str * (defF.strMultiplier || 0.3) + (eq.defense || 0);
        d.def = defF.round === 'floor' ? Math.floor(raw) : Math.round(raw);
    }

    /** 背包空位（0..maxBackpackSlots-1）；满返回 -1 */
    _findFreeBackpackSlot() {
        const used = new Set(this.backpack.map(b => b.slot));
        for (let i = 0; i < this.maxBackpackSlots; i++) {
            if (!used.has(i)) return i;
        }
        return -1;
    }

    /** 装备回背包（找空位；满则忽略） */
    _stashToBackpack(item) {
        const freeSlot = this._findFreeBackpackSlot();
        if (freeSlot === -1) return;
        this.backpack.push({ ...JSON.parse(JSON.stringify(item)), slot: freeSlot });
    }

    /** 采集能源直接进入世界-122仓库；返回实际入库量。 */
    addMinedEnergy(amount) {
        return EnergyManager ? EnergyManager.depositEnergy(amount) : 0;
    }

    /** 序列化（存档用）：纯数据 */
    serialize() {
        return {
            id: this.id, name: this.name, title: this.title, role: this.role,
            growthRule: this.growthRule, avatar: this.avatar,
            weaponType: this.weaponType,
            data: { ...this.data },
            equipments: JSON.parse(JSON.stringify(this.equipments)),
            backpack: JSON.parse(JSON.stringify(this.backpack)),
            skills: JSON.parse(JSON.stringify(this.skills || {})),
            animations: JSON.parse(JSON.stringify(this.animations || {})),
            maxBackpackSlots: this.maxBackpackSlots,
            baseMaxMp: this._maxMpOverride || undefined,
            baseMaxHp: this._maxHpOverride || undefined,
            consumableSettings: JSON.parse(JSON.stringify(this.consumableSettings || {})),
            equipRules: this.equipRules ? JSON.parse(JSON.stringify(this.equipRules)) : null,
            equipNote: this.equipNote,
            // AI 配置与技能解锁表必须随档保存（2026-08-16）：此前丢失导致解散再招募/
            // 读档后 aiConfig=null → 渲染层当“纯跟随单位”贴玩家、AI 错用露娜法师默认
            // 配置——伊莉丝命令“执行了但画面不动”（实机 CDP 复现）。
            aiConfig: this.aiConfig || undefined,
            unlockSkills: this._unlockSkills || undefined,
            displaySize: this.displaySize || undefined,
            spriteOffsetY: this.spriteOffsetY || undefined,
        };
    }

    static fromSerialized(s) {
        // 档案兜底：老档（无 aiConfig/unlockSkills 字段）回退 companion-config.json 的
        // 同 id 档案，保证解散再招募/读档后 AI 角色与技能解锁表不丢
        const archive = (companionConfigData.companions || []).find(a => a.id === s.id) || {};
        const c = new Companion({ id: s.id, name: s.name, title: s.title, role: s.role,
            growthRule: s.growthRule, avatar: s.avatar, weaponType: s.weaponType,
            baseLevel: 1 });
        // 装备限制随档案恢复：解散再招募（roster 继承）或读档后限制依然生效
        c.equipRules = s.equipRules || null;
        c.equipNote = s.equipNote || '';
        if (s.displaySize) c.displaySize = s.displaySize;
        if (s.spriteOffsetY) c.spriteOffsetY = s.spriteOffsetY;
        c.data = { ...s.data };
        c.equipments = s.equipments || {};
        c.backpack = s.backpack || [];
        let legacyEnergy = 0;
        c.backpack = c.backpack.filter((item) => {
            if (!item || item.category !== 'energy') return true;
            legacyEnergy += Math.max(0, Number(item.stack) || 0);
            return false;
        });
        if (legacyEnergy > 0 && EnergyManager) EnergyManager.importLegacyEnergy(legacyEnergy);
        // 技能重建：JSON 序列化丢 getEffect/getExpForNext 方法，按 id 从 SKILL_DATA 重建
        c.skills = restoreSkills(s.skills || {});
        c.animations = s.animations || {};
        if (s.maxBackpackSlots) c.maxBackpackSlots = s.maxBackpackSlots;
        if (s.baseMaxMp) c._maxMpOverride = s.baseMaxMp;
        if (s.baseMaxHp) c._maxHpOverride = s.baseMaxHp;
        if (s.consumableSettings) c.consumableSettings = { enabled: true, hpThreshold: 0.3, mpThreshold: 0.25, useLowToHigh: true, ...s.consumableSettings };
        // AI 配置/技能解锁表：优先存档值，老档回退配置档案（2026-08-16 修复）
        c.aiConfig = s.aiConfig || archive.ai || null;
        c._unlockSkills = s.unlockSkills || archive.unlockSkills || {};
        // 恢复后按真实等级重查技能解锁（构造时等级=1 查不到）
        c._checkUnlocks();
        // 预置装备六维差值：恢复的 data 已含装备加成，差值法不得重复叠加
        const eq = c.getEquipmentBonuses();
        c._equipAttrBonus = { str: eq.str || 0, dex: eq.dex || 0, int: eq.int || 0, con: eq.con || 0, wis: eq.wis || 0, luck: eq.luck || 0 };
        c.calculateCombatStats();
        c.updateMaxStats();
        return c;
    }
}
