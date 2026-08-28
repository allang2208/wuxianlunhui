import { getAbilityLevel, getAbilityValue } from '../world/ability-store.js';
import {
    BUILDING_UPGRADE_PROJECTS,
    getUpgradeModulesForUnitKind,
} from '../world/building-upgrade-projects.js';
import { MINER_CAMP_CONFIG } from '../world/miner-economy.js';
import { getUnitKind, getUnitUpgradeLevel } from '../world/unit-upgrade-store.js';

const STATUS_META = Object.freeze({
    stun: { name: '眩晕', icon: '💫', tone: 'debuff' },
    poison: { name: '中毒', icon: '☠️', tone: 'debuff' },
    slow: { name: '致残', icon: '🦴', tone: 'debuff' },
    bind: { name: '束缚', icon: '⛓️', tone: 'debuff' },
    bleed: { name: '流血', icon: '🩸', tone: 'debuff' },
    magicVulnerability: { name: '魔力易伤', icon: '🔮', tone: 'debuff' },
    droneVulnerability: { name: '无人机易伤', icon: '🛸', tone: 'debuff' },
    fear: { name: '恐惧', icon: '😱', tone: 'debuff' },
    chill: { name: '寒冷', icon: '❄️', tone: 'debuff' },
    burn: { name: '灼伤', icon: '🔥', tone: 'debuff' },
    frozen: { name: '冻结', icon: '🧊', tone: 'debuff' },
    electrified: { name: '感电', icon: '⚡', tone: 'debuff' },
    marked: { name: '标记', icon: '🎯', tone: 'debuff' },
    inspire: { name: '激励', icon: '📣', tone: 'buff' },
    statusImmune: { name: '状态免疫', icon: '🔰', tone: 'buff' },
    haste: { name: '加速', icon: '💨', tone: 'buff' },
    holyRenewal: { name: '圣光续疗', icon: '💚', tone: 'buff' },
    chainSpell: { name: '链式强化', icon: '🔗', tone: 'buff' },
    flameArmor: { name: '灼锋焰甲', icon: '🔥', tone: 'buff' },
    shield: { name: '护盾', icon: '🛡️', tone: 'buff' },
    buff: { name: '增益', icon: '✨', tone: 'buff' },
    goddessBless: { name: '女神祝福', icon: '✨', tone: 'buff' },
    demonPrayer: { name: '恶魔祈祷', icon: '🔥', tone: 'buff' },
});

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function durationValue(value, fallback = 0) {
    const number = Number(value);
    if (number === Infinity) return Infinity;
    return Number.isFinite(number) ? number : fallback;
}

function compactNumber(value, digits = 1) {
    const number = finite(value);
    const fixed = number.toFixed(digits);
    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

function signedPercent(ratio, { absolute = false } = {}) {
    const percent = finite(ratio) * 100;
    const value = compactNumber(absolute ? Math.abs(percent) : percent);
    if (absolute) return `${value}%`;
    return `${percent > 0 ? '+' : ''}${value}%`;
}

function moduleEffectText(module, level) {
    const amount = finite(module?.per) * level;
    switch (module?.effect) {
        case 'attackIntervalMult': return `攻击间隔 ${signedPercent(amount)}`;
        case 'attackDamageMult': return `攻击伤害 ${signedPercent(amount)}`;
        case 'moveSpeedMult': return `移动速度 ${signedPercent(amount)}`;
        case 'hpMult': return `最大生命 ${signedPercent(amount)}`;
        case 'defenseMult': return `防御力 ${signedPercent(amount)}`;
        case 'chargeDamageMult': return `冲锋伤害 ${signedPercent(amount)}`;
        case 'miningMult': return `采矿效率 ${signedPercent(amount)}`;
        case 'attackRangeBonus': return `攻击射程 +${compactNumber(amount)}px`;
        case 'holyLightCooldownMult': return `圣光冷却 ${signedPercent(amount)}`;
        case 'holyLightLevel': return `圣光等级 Lv.${compactNumber(finite(module.base, 1) + amount, 0)}`;
        case 'jungleMagicLevel': return `全部魔法等级 +${compactNumber(amount, 0)}`;
        case 'jungleSpellCooldownMult': {
            if (level <= 0) return '全部魔法冷却 -0%';
            const multiplier = finite(module.firstLevel, 1) + finite(module.per) * Math.max(0, level - 1);
            return `全部魔法冷却 -${compactNumber(Math.max(0, 1 - multiplier) * 100)}%`;
        }
        case 'holyLightRangeBonus': return `施法距离 +${compactNumber(amount)}px`;
        case 'titheEnergyPerTick': {
            const seconds = finite(module.tickMs) / 1000;
            return `每 ${compactNumber(seconds)}s 提供 ${compactNumber(amount)} 能源`;
        }
        default: return `当前效果 ${module?.mode === 'add' ? '+' : ''}${compactNumber(amount)}`;
    }
}

function abilityEffectText(abilityId, ability, level) {
    const value = getAbilityValue(ability, level);
    switch (abilityId) {
        case 'poison_arrow': return `命中中毒概率 ${signedPercent(value, { absolute: true })}`;
        case 'auto_guard': return `触发 ${signedPercent(value, { absolute: true })} · 减伤 ${compactNumber(finite(ability.damageReduction) * 100)}%`;
        case 'sweep_aoe': return `扇形 AOE 伤害强化 ${signedPercent(value, { absolute: true })}`;
        case 'mark_arrow': return `标记概率 ${signedPercent(value, { absolute: true })} · 目标承伤 +${compactNumber(finite(ability.damageAmplify) * 100)}%`;
        case 'armor_piercing_round': return `护甲穿透 ${signedPercent(value, { absolute: true })}`;
        case 'giant_slayer': return `对骑兵/大型怪物伤害 +${signedPercent(value, { absolute: true })}`;
        case 'inspire_magic': return `持续 ${compactNumber(value / 1000)}s · 移速 +${compactNumber((finite(ability.speedMul, 1) - 1) * 100)}% · 物攻 +${compactNumber((finite(ability.atkMul, 1) - 1) * 100)}%`;
        default:
            if (ability?.displayMode === 'seconds') return `当前效果 ${compactNumber(value / 1000)}s`;
            if (ability?.displayMode === 'flat') return `当前效果 ${compactNumber(value)}`;
            return `当前效果 ${signedPercent(value, { absolute: true })}`;
    }
}

/** 当前单位实际享受的全局兵种模块和特殊能力；只返回等级大于 0 的项目。 */
export function getUnitUpgradeRows(entity) {
    const kind = getUnitKind(entity);
    const rows = [];
    if (entity?._isHamsterMiner && entity?._hut) {
        for (const [moduleId, module] of Object.entries(MINER_CAMP_CONFIG.modules || {})) {
            if (module?.effect === 'count') continue;
            const level = Math.max(0, Math.floor(finite(entity._hut.modules?.[moduleId])));
            if (level <= 0) continue;
            rows.push({
                id: `miner:${entity._hut.id || 'hut'}:${moduleId}`,
                source: '所属矿工营地',
                name: module.name || moduleId,
                icon: module.icon || '◆',
                iconImage: module.iconImage || '',
                level,
                detail: moduleEffectText(module, level),
            });
        }
        return rows;
    }
    if (!kind) return rows;
    const modules = getUpgradeModulesForUnitKind(kind);
    for (const [moduleId, module] of Object.entries(modules || {})) {
        if (Array.isArray(module?.unitKinds) && !module.unitKinds.includes(kind)) continue;
        const level = getUnitUpgradeLevel(kind, moduleId);
        if (level <= 0) continue;
        rows.push({
            id: `module:${moduleId}`,
            source: '兵种强化',
            name: module.name || moduleId,
            icon: module.icon || '◆',
            iconImage: module.iconImage || '',
            level,
            detail: moduleEffectText(module, level),
        });
    }
    for (const project of Object.values(BUILDING_UPGRADE_PROJECTS)) {
        for (const [abilityId, ability] of Object.entries(project?.abilities || {})) {
            if (!Array.isArray(ability?.unitKinds) || !ability.unitKinds.includes(kind)) continue;
            const level = getAbilityLevel(abilityId);
            if (level <= 0) continue;
            rows.push({
                id: `ability:${abilityId}`,
                source: '特殊升级',
                name: ability.name || abilityId,
                icon: ability.icon || '◆',
                iconImage: ability.iconImage || '',
                level,
                detail: abilityEffectText(abilityId, ability, level),
            });
        }
    }
    return rows;
}

function actualStacks(entity, type, fallback = 1) {
    switch (type) {
        case 'poison': return finite(entity?._poisonStacks, fallback);
        case 'bleed': return finite(entity?._bleedStacks, fallback);
        case 'corrosion': return finite(entity?._corrosionStacks, fallback);
        case 'magicVulnerability': return finite(entity?._magicVulnerabilityStacks, fallback);
        case 'droneVulnerability': return finite(entity?._droneVulnerabilityStacks, fallback);
        case 'haste': return finite(entity?._hasteStacks, fallback);
        case 'holyRenewal': return finite(entity?._holyRenewalStacks, fallback);
        case 'chainSpell': return finite(entity?._chainSpellStacks, fallback);
        case 'chill': return finite(entity?._chillStacks, fallback);
        case 'burn': return Array.isArray(entity?._burnStacks) ? entity._burnStacks.length : fallback;
        case 'frozen': return finite(entity?._freezeStacks, fallback);
        case 'electrified': return finite(entity?._electrifiedStacks, fallback);
        default: return finite(fallback, 1);
    }
}

function actualRemaining(entity, type, fallback = 0) {
    switch (type) {
        case 'poison': return durationValue(entity?._poisonTimer, fallback);
        case 'bleed': return durationValue(entity?._bleedTimer, fallback);
        case 'corrosion': return durationValue(entity?._corrosionTimer, fallback);
        case 'magicVulnerability': return durationValue(entity?._magicVulnerabilityTimer, fallback);
        case 'droneVulnerability': return durationValue(entity?._droneVulnerabilityTimer, fallback);
        case 'holyRenewal': return durationValue(entity?._holyRenewalTimer, fallback);
        case 'chill': return durationValue(entity?._chillTimer, fallback);
        case 'burn': return Array.isArray(entity?._burnStacks)
            ? entity._burnStacks.reduce((max, stack) => Math.max(max, durationValue(stack?.remaining)), 0)
            : fallback;
        case 'frozen': return durationValue(entity?._freezeTimer, fallback);
        case 'electrified': return durationValue(entity?._electrifiedTimer, fallback);
        case 'stun': return durationValue(entity?.stunTimer, fallback);
        default: return durationValue(fallback);
    }
}

function remainingText(entity, type, remaining) {
    const dungeonBuff = entity?._dungeonBuffs?.[type];
    if (finite(dungeonBuff?.remainingBattles) > 0) {
        return `剩余 ${Math.floor(finite(dungeonBuff.remainingBattles))} 场`;
    }
    if (dungeonBuff?.permanent) return '永久';
    if (!Number.isFinite(remaining) || remaining >= 600000) return '持续中';
    if (remaining <= 0) return '';
    return `${Math.max(1, Math.ceil(remaining / 1000))}s`;
}

function dungeonBuffDetail(entity, type) {
    const buff = entity?._dungeonBuffs?.[type];
    if (!buff) return '';
    const parts = [];
    if (finite(buff.atkPercent)) parts.push(`物攻 ${buff.atkPercent > 0 ? '+' : ''}${compactNumber(buff.atkPercent)}%`);
    if (finite(buff.matkPercent)) parts.push(`魔攻 ${buff.matkPercent > 0 ? '+' : ''}${compactNumber(buff.matkPercent)}%`);
    if (finite(buff.defPercent)) parts.push(`防御 ${buff.defPercent > 0 ? '+' : ''}${compactNumber(buff.defPercent)}%`);
    if (finite(buff.moveSpeedPercent)) parts.push(`移速 ${buff.moveSpeedPercent > 0 ? '+' : ''}${compactNumber(buff.moveSpeedPercent)}%`);
    return parts.join(' · ');
}

function effectDetail(entity, type, effect, stacks) {
    const hp = Math.max(0, finite(entity?.hp ?? entity?.data?.hp));
    const maxHp = Math.max(1, finite(entity?.maxHp ?? entity?.data?.maxHp, 1));
    switch (type) {
        case 'stun': return '无法移动、攻击或施法';
        case 'frozen': return '无法行动 · 非魔法承伤 +50%';
        case 'bind': return '无法移动';
        case 'fear': {
            const multiplier = typeof entity?.getFearSpeedMul === 'function'
                ? entity.getFearSpeedMul()
                : Math.max(0.01, 1 - 0.33 * stacks);
            return `强制逃离 · 移速 -${compactNumber((1 - multiplier) * 100)}%`;
        }
        case 'slow': return entity?._faction === 'player'
            ? '移动速度 -50%'
            : '致残已登记 · 当前移动逻辑未应用减速';
        case 'poison': return `每秒 ${compactNumber(stacks, 0)} 点毒素伤害`;
        case 'bleed': return `每秒 ${Math.max(1, Math.floor(hp * 0.01 * stacks))} 点流血伤害`;
        case 'corrosion': {
            const perStack = finite(entity?._corrosionDefenseReductionPerStack, 0.05);
            return `物理防御 -${compactNumber(Math.min(100, stacks * perStack * 100))}%`;
        }
        case 'magicVulnerability': return `受到魔法伤害 +${compactNumber(stacks * 5)}%`;
        case 'droneVulnerability': return `基础全承伤 +${compactNumber(stacks * 10)}% · 被暴击率 +${compactNumber(stacks * 10)}%`;
        case 'marked': return `受到所有伤害 +${compactNumber(finite(effect?.value, 0.15) * 100)}%`;
        case 'electrified': return `受到电系伤害 +${compactNumber(stacks * 3)}% · 5 层触发过载`;
        case 'inspire': {
            if (!entity?._inspireMul) return '激励已登记 · 当前无攻击/移速倍率';
            const speedMul = finite(entity?._inspireMul?.speedMul, 1.33);
            const atkMul = finite(entity?._inspireMul?.atkMul, 1.5);
            return `移动速度 +${compactNumber((speedMul - 1) * 100)}% · 物理攻击 +${compactNumber((atkMul - 1) * 100)}%`;
        }
        case 'haste': {
            const perStack = finite(entity?._hastePerStackMul, 0.1);
            return `移动速度 +${compactNumber(stacks * perStack * 100)}%`;
        }
        case 'statusImmune': return '免疫其他 Buff / Debuff 入库';
        case 'holyRenewal': {
            const healPercent = finite(entity?._holyRenewalHealPercent, 0.01);
            return `每秒恢复 ${Math.max(1, Math.floor(maxHp * healPercent * stacks))} 生命`;
        }
        case 'chainSpell': return `下次魔法伤害 +${compactNumber(stacks * 2)}% · MP 消耗 +${compactNumber(stacks * 5)}%`;
        case 'chill': {
            const multiplier = typeof entity?.getChillSpeedMul === 'function'
                ? entity.getChillSpeedMul()
                : Math.max(0.01, 1 - stacks * finite(entity?._chillSlowPercent, 0.05));
            return `移动速度 -${compactNumber((1 - multiplier) * 100)}%`;
        }
        case 'burn': {
            const burnStacks = Array.isArray(entity?._burnStacks) ? entity._burnStacks : [];
            const baseDamage = burnStacks.reduce((sum, stack) => (
                sum + Math.max(1, Math.floor(finite(stack?.matk) * finite(stack?.damageMul, 0.5)))
            ), 0);
            const interval = Math.max(1, finite(entity?._burnTickMs, 500)) / 1000;
            return `每 ${compactNumber(interval)}s 魔伤基值 ${compactNumber(baseDamage || stacks, 0)}`;
        }
        case 'flameArmor': return '武器火焰与灼烧光环生效';
        case 'shield': return Number.isFinite(Number(effect?.value))
            ? `护盾值 ${compactNumber(effect.value)}` : '护盾生效中';
        case 'buff': return Number.isFinite(Number(effect?.value))
            ? `效果值 ${compactNumber(effect.value)}` : '通用增益生效中';
        default: return dungeonBuffDetail(entity, type) || '状态效果生效中';
    }
}

function fallbackStatusCandidates(entity) {
    return [
        { type: 'poison', stacks: entity?._poisonStacks, remaining: entity?._poisonTimer },
        { type: 'bleed', stacks: entity?._bleedStacks, remaining: entity?._bleedTimer },
        { type: 'corrosion', stacks: entity?._corrosionStacks, remaining: entity?._corrosionTimer },
        { type: 'magicVulnerability', stacks: entity?._magicVulnerabilityStacks, remaining: entity?._magicVulnerabilityTimer },
        { type: 'droneVulnerability', stacks: entity?._droneVulnerabilityStacks, remaining: entity?._droneVulnerabilityTimer },
        { type: 'haste', stacks: entity?._hasteStacks },
        { type: 'holyRenewal', stacks: entity?._holyRenewalStacks, remaining: entity?._holyRenewalTimer },
        { type: 'chainSpell', stacks: entity?._chainSpellStacks },
        { type: 'chill', stacks: entity?._chillStacks, remaining: entity?._chillTimer },
        { type: 'burn', stacks: Array.isArray(entity?._burnStacks) ? entity._burnStacks.length : 0 },
        { type: 'frozen', stacks: entity?._freezeStacks, remaining: entity?._freezeTimer },
        { type: 'electrified', stacks: entity?._electrifiedStacks, remaining: entity?._electrifiedTimer },
        { type: 'inspire', stacks: entity?._inspireMul ? 1 : 0 },
        { type: 'stun', stacks: entity?.isStunned ? 1 : 0, remaining: entity?.stunTimer },
    ];
}

/**
 * 汇总实体当前收到的状态影响。既读取标准 statusEffects，也兼容中毒/流血等旧式
 * “层数 + 独立计时器”状态；返回的数值均由当前运行时字段重新计算。
 */
export function getUnitStatusRows(entity) {
    if (!entity) return [];
    const sources = [];
    const seen = new Set();
    for (const effect of Array.isArray(entity.statusEffects) ? entity.statusEffects : []) {
        const remaining = durationValue(effect?.remaining);
        if (!effect?.type || remaining <= 0) continue;
        sources.push({ type: effect.type, effect, remaining: effect.remaining, stacks: effect.stacks });
        seen.add(effect.type);
    }
    for (const candidate of fallbackStatusCandidates(entity)) {
        if (seen.has(candidate.type) || finite(candidate.stacks) <= 0) continue;
        const remaining = actualRemaining(entity, candidate.type, candidate.remaining);
        if (remaining <= 0 && candidate.type !== 'inspire' && candidate.type !== 'haste' && candidate.type !== 'chainSpell') continue;
        sources.push({ ...candidate, effect: null, remaining });
        seen.add(candidate.type);
    }

    return sources.map((source) => {
        const meta = STATUS_META[source.type] || {};
        const stacks = Math.max(1, Math.floor(actualStacks(entity, source.type, source.stacks)));
        const remaining = actualRemaining(entity, source.type, source.remaining);
        const rawName = source.effect?.name || meta.name || source.type;
        const name = String(rawName).replace(/\s*[x×]\s*\d+$/i, '');
        return {
            id: source.type,
            type: source.type,
            name,
            icon: source.effect?.icon || meta.icon || '◆',
            tone: meta.tone || 'neutral',
            stacks,
            detail: effectDetail(entity, source.type, source.effect, stacks),
            remaining: remainingText(entity, source.type, remaining),
        };
    });
}
