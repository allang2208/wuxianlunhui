// ============================================================
// 侍从（Companion）实体——数据模型与玩家对齐（2026-08-12 框架）
// 需求：队员等级/属性/背包/装备/技能栏与玩家单位一致；仅战斗获取经验；
//       升级属性点按成长规则分配（companion-growth.js 注册表，不硬编码）。
// 本类保持纯净（无 Phaser 依赖），供队伍系统 / UI / 战斗结算消费。
// ============================================================

import { computeMaxExp } from '../config/exp-system.js';
import { allocateOnLevelUp } from '../config/companion-growth.js';
import { canEquipSlot, getEquipmentBonuses, isOneHandedItem } from '../ui/equip/equip-rules.js';
import { buildSkillMap, restoreSkills } from '../systems/skill-system.js';
import COMBAT_FORMULAS from '../../data/combat-formulas.json';

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
        // 装备限制（companion-config.json equipRules 配置驱动）：
        //   weaponTypes - 允许的武器类型（如露娜只许 staff 法杖）；
        //   armorSets   - 允许的法袍类套装（如 robe/eclipse/lunar/oracle_robe，+魔法攻击力套装）。
        // 未配置（null）表示无限制，走玩家同款 equip-rules。
        this.equipRules = archive.equipRules || null;
        // 装备栏顶部注释文案（如露娜“只能装备法杖和法袍类装备”）。
        this.equipNote = archive.equipNote || '';
        // AI 配置（2026-08-14）：有 ai 字段的队员由 CompanionAI 驱动战斗/跟随；无则纯跟随渲染
        this.aiConfig = archive.ai || null;
        // 初始魔法覆盖（2026-08-15）：露娜 baseMaxMp=600（1 级基准，升级仍 +10/级 + 装备加成）
        this._maxMpOverride = archive.baseMaxMp || 0;
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
        this.groundRadius = 26;
        this.bodyHeight = 130;
        this._faction = 'companion'; // 与 player 互为友军（技能敌我判定按阵营分组）
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
        this.calculateCombatStats(); // 初始化战斗属性（matk 等，含无装备基础魔攻）
        this.updateMaxStats();
        this.data.hp = this.data.maxHp;
        this.data.mp = this.data.maxMp;
    }

    get level() { return this.data.level; }

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
        d.maxHp = (hpF.base || 100) + d.con * (hpF.conMultiplier || 10) + (eq.maxHp || 0) + lvlHp;
        if (this._maxMpOverride > 0) {
            // 初始魔法覆盖：1 级基准 = baseMaxMp，升级 +10/级，装备 maxMp 加成保留
            d.maxMp = this._maxMpOverride + (eq.maxMp || 0) + lvlMp;
        } else {
            d.maxMp = (mpF.base || 100) + d.wis * (mpF.wisMultiplier || 10) + d.int * (mpF.intMultiplier || 5) + (eq.maxMp || 0) + lvlMp;
        }
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
            } else if (item.category === 'armor') {
                const allowedSets = this.equipRules.armorSets || [];
                if (allowedSets.length && !allowedSets.includes(item.armorSet)) {
                    return false;
                }
            }
        }
        return canEquipSlot(item, slot);
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
            consumableSettings: JSON.parse(JSON.stringify(this.consumableSettings || {})),
            equipRules: this.equipRules ? JSON.parse(JSON.stringify(this.equipRules)) : null,
            equipNote: this.equipNote,
        };
    }

    static fromSerialized(s) {
        const c = new Companion({ id: s.id, name: s.name, title: s.title, role: s.role,
            growthRule: s.growthRule, avatar: s.avatar, weaponType: s.weaponType,
            baseLevel: 1 });
        // 装备限制随档案恢复：解散再招募（roster 继承）或读档后限制依然生效
        c.equipRules = s.equipRules || null;
        c.equipNote = s.equipNote || '';
        c.data = { ...s.data };
        c.equipments = s.equipments || {};
        c.backpack = s.backpack || [];
        // 技能重建：JSON 序列化丢 getEffect/getExpForNext 方法，按 id 从 SKILL_DATA 重建
        c.skills = restoreSkills(s.skills || {});
        c.animations = s.animations || {};
        if (s.maxBackpackSlots) c.maxBackpackSlots = s.maxBackpackSlots;
        if (s.baseMaxMp) c._maxMpOverride = s.baseMaxMp;
        if (s.consumableSettings) c.consumableSettings = { enabled: true, hpThreshold: 0.3, mpThreshold: 0.25, useLowToHigh: true, ...s.consumableSettings };
        // 预置装备六维差值：恢复的 data 已含装备加成，差值法不得重复叠加
        const eq = c.getEquipmentBonuses();
        c._equipAttrBonus = { str: eq.str || 0, dex: eq.dex || 0, int: eq.int || 0, con: eq.con || 0, wis: eq.wis || 0, luck: eq.luck || 0 };
        c.calculateCombatStats();
        c.updateMaxStats();
        return c;
    }
}
