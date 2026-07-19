import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { CONFIG } from '../config/config.js';
import { getTributeHpRegenFlat } from '../config/tribute-effects.js';

const fmt = (n, digits = 2) => {
    if (!isFinite(n)) return '0';
    return Number.isInteger(n) ? String(n) : n.toFixed(digits);
};

const formulaLine = (label, value, unit = '') => `<div class="tt-line"><span class="tt-name">${label}</span><span class="tt-val">${fmt(value)}${unit}</span></div>`;

function getWeaponCrit(player) {
    const currentWpn = player.equipments && player.equipments[player.weaponMode];
    if (!currentWpn || !currentWpn.stats) return 0;
    const critStat = currentWpn.stats.find(s => (s.name || s.label) === '暴击率');
    if (!critStat || !critStat.value) return 0;
    const match = String(critStat.value).match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
}

function getCurrentAttackConfig(player) {
    const currentWpn = player.equipments && player.equipments[player.weaponMode];
    let attackType = 'melee';
    if (currentWpn) {
        if (currentWpn.weaponType === 'pistol' || currentWpn.rangedType === 'pistol') attackType = 'pistol';
        else if (currentWpn.weaponType === 'bow') attackType = 'ranged';
    }
    return player.attacks && player.attacks[attackType] ? player.attacks[attackType].config : null;
}

export const StatusTooltipHelper = {
    render(key, player) {
        if (!player || !player.data) return '<div class="tt-title">数据加载中...</div>';
        const d = player.data;
        const formulas = COMBAT_FORMULAS.player || {};

        switch (key) {
            case 'hp': {
                const f = formulas.maxHp || { base: 100, conMultiplier: 10 };
                return `<div class="tt-title">生命值</div>
                    <div class="tt-desc">体质决定生命上限。</div>
                    ${formulaLine('基础生命', f.base)}
                    ${formulaLine('体质加成', d.con * (f.conMultiplier || 0))}
                    ${formulaLine('当前上限', d.maxHp)}
                    <div class="tt-note">当前生命：${Math.ceil(d.hp || 0)} / ${d.maxHp || 0}</div>`;
            }
            case 'mp': {
                const f = formulas.maxMp || { base: 100, wisMultiplier: 10, intMultiplier: 5 };
                return `<div class="tt-title">魔法值</div>
                    <div class="tt-desc">精神智力共同决定魔法上限。</div>
                    ${formulaLine('基础魔法', f.base)}
                    ${formulaLine('精神加成', d.wis * (f.wisMultiplier || 0))}
                    ${formulaLine('智力加成', d.int * (f.intMultiplier || 0))}
                    ${formulaLine('当前上限', d.maxMp)}
                    <div class="tt-note">当前魔法：${Math.ceil(d.mp || 0)} / ${d.maxMp || 0}</div>`;
            }
            case 'stamina':
                return `<div class="tt-title">体力值</div>
                    <div class="tt-desc">冲刺、闪避、攻击消耗体力，停止消耗后自动恢复。</div>
                    <div class="tt-note">当前体力：${Math.ceil(d.stamina || 0)} / ${d.maxStamina || 0}</div>`;
            case 'exp':
                return `<div class="tt-title">经验值</div>
                    <div class="tt-desc">击杀怪物、完成任务获得经验，满额后升级。</div>
                    <div class="tt-note">当前：${Math.floor(d.exp || 0)} / ${d.maxExp || 0}</div>`;
            case 'str': {
                const f = formulas.attack || {};
                return `<div class="tt-title">力量</div>
                    <div class="tt-desc">提升物理攻击与少量物理防御。</div>
                    ${formulaLine('物攻加成', d.str * (f.strMultiplier || 0))}
                    ${formulaLine('当前物攻', d.atk || 0)}
                    <div class="tt-note">每点力量 ≈ +${f.strMultiplier || 0} 物理攻击</div>`;
            }
            case 'dex': {
                const speedF = formulas.speed || { dexMultiplier: 0.05 };
                const regenF = formulas.staminaRegen || { base: 1.0, dexMultiplier: 0.01 };
                return `<div class="tt-title">敏捷</div>
                    <div class="tt-desc">提升移动速度、命中、暴击伤害基础与体力恢复倍率。</div>
                    ${formulaLine('移速加成', d.dex * (speedF.dexMultiplier || 0))}
                    ${formulaLine('体力恢复倍率', (regenF.base || 1) + d.dex * (regenF.dexMultiplier || 0), 'x')}
                    <div class="tt-note">每点敏捷 ≈ +${(regenF.dexMultiplier || 0) * 100}% 体力恢复</div>`;
            }
            case 'int': {
                const matkF = formulas.magicAttack || {};
                return `<div class="tt-title">智力</div>
                    <div class="tt-desc">提升魔法攻击、魔法上限与少量魔法防御。</div>
                    ${formulaLine('魔攻加成', d.int * (matkF.intMultiplier || 0))}
                    ${formulaLine('当前魔攻', d.matk || 0)}
                    <div class="tt-note">每点智力 ≈ +${matkF.intMultiplier || 0} 魔法攻击</div>`;
            }
            case 'con': {
                const defF = formulas.defense || {};
                const hpF = formulas.maxHp || {};
                return `<div class="tt-title">体质</div>
                    <div class="tt-desc">提升生命值、物理防御与暴击抵抗。</div>
                    ${formulaLine('生命加成', d.con * (hpF.conMultiplier || 0))}
                    ${formulaLine('物防加成', d.con * (defF.conMultiplier || 0))}
                    ${formulaLine('暴击抵抗', d.critRes || 0, '%')}
                    <div class="tt-note">每点体质 ≈ +${hpF.conMultiplier || 0} 生命、+${defF.conMultiplier || 0} 物防</div>`;
            }
            case 'wis': {
                const mdefF = formulas.magicDefense || {};
                return `<div class="tt-title">精神</div>
                    <div class="tt-desc">提升魔法防御、魔法上限与少量魔法攻击。</div>
                    ${formulaLine('魔防加成', d.wis * (mdefF.wisMultiplier || 0))}
                    ${formulaLine('当前魔防', d.mdef || 0)}
                    <div class="tt-note">每点精神 ≈ +${mdefF.wisMultiplier || 0} 魔法防御</div>`;
            }
            case 'luck': {
                const critF = formulas.crit || {};
                return `<div class="tt-title">幸运</div>
                    <div class="tt-desc">提升暴击率。</div>
                    ${formulaLine('暴击加成', d.luck * (critF.luckMultiplier || 0), '%')}
                    ${formulaLine('当前暴击率', d.crit || 0, '%')}
                    <div class="tt-note">每点幸运 ≈ +${critF.luckMultiplier || 0}% 暴击率</div>`;
            }
            case 'atk': {
                const f = formulas.attack || {};
                const wpnAtk = player.getCurrentWeaponAtk ? player.getCurrentWeaponAtk() : (d.atk || 0);
                return `<div class="tt-title">物理攻击</div>
                    <div class="tt-desc">角色基础物攻 + 武器伤害。</div>
                    ${formulaLine('基础物攻', d.atk || 0)}
                    ${formulaLine('武器伤害', wpnAtk)}
                    <div class="tt-note">公式：${f.base || 0} + 力量×${f.strMultiplier || 0} + 敏捷×${f.dexMultiplier || 0}</div>`;
            }
            case 'def': {
                const f = formulas.defense || {};
                return `<div class="tt-title">物理防御</div>
                    <div class="tt-desc">减免受到的物理伤害。</div>
                    ${formulaLine('当前物防', d.def || 0)}
                    <div class="tt-note">公式：体质×${f.conMultiplier || 0} + 力量×${f.strMultiplier || 0}</div>`;
            }
            case 'matk': {
                const f = formulas.magicAttack || {};
                return `<div class="tt-title">魔法攻击</div>
                    <div class="tt-desc">影响魔法类技能与普攻伤害。</div>
                    ${formulaLine('当前魔攻', d.matk || 0)}
                    <div class="tt-note">公式：智力×${f.intMultiplier || 0} + 精神×${f.wisMultiplier || 0}</div>`;
            }
            case 'mdef': {
                const f = formulas.magicDefense || {};
                return `<div class="tt-title">魔法防御</div>
                <div class="tt-desc">减免受到的魔法伤害。</div>
                ${formulaLine('当前魔防', d.mdef || 0)}
                <div class="tt-note">公式：精神×${f.wisMultiplier || 0} + 智力×${f.intMultiplier || 0}</div>`;
            }
            case 'crit': {
                const baseCrit = d.crit || 0;
                const weaponCrit = getWeaponCrit(player);
                return `<div class="tt-title">暴击率</div>
                    <div class="tt-desc">攻击时触发暴击的概率。</div>
                    ${formulaLine('基础暴击率', baseCrit, '%')}
                    ${formulaLine('武器暴击率', weaponCrit, '%')}
                    ${formulaLine('合计', baseCrit + weaponCrit, '%')}
                    <div class="tt-note">幸运每点 +${(formulas.crit?.luckMultiplier || 1)}% 暴击率</div>`;
            }
            case 'critRes':
                return `<div class="tt-title">暴击抵抗</div>
                    <div class="tt-desc">降低被敌人暴击的概率。</div>
                    ${formulaLine('当前暴击抵抗', d.critRes || 0, '%')}
                    <div class="tt-note">每点体质 +1% 暴击抵抗</div>`;
            case 'attackInterval': {
                const cfg = getCurrentAttackConfig(player);
                const cd = cfg && cfg.cooldown ? cfg.cooldown : (d.aspd || 1);
                return `<div class="tt-title">攻击间隔</div>
                    <div class="tt-desc">当前武器两次攻击之间的冷却时间。</div>
                    ${formulaLine('当前间隔', Math.round(cd), 'ms')}
                    <div class="tt-note">攻速倍率：${fmt(d.aspd || 1)}</div>`;
            }
            case 'moveSpeed': {
                const speed = player.maxSpeed || d.speed || CONFIG.PLAYER_SPEED || 0;
                return `<div class="tt-title">移动速度</div>
                    <div class="tt-desc">角色正常移动时的最大速度。</div>
                    ${formulaLine('帧速度', speed.toFixed(2), 'px/帧')}
                    ${formulaLine('秒速度', (speed * 60).toFixed(0), 'px/s')}
                    <div class="tt-note">基础：${CONFIG.PLAYER_SPEED || 0} px/帧；冲刺：${CONFIG.PLAYER_SPRINT || 0} px/帧</div>`;
            }
            case 'staminaRegen': {
                const f = formulas.staminaRegen || { base: 1.0, dexMultiplier: 0.01 };
                const mul = player._staminaRegenMul || 1;
                return `<div class="tt-title">体力恢复</div>
                    <div class="tt-desc">停止消耗体力后的每秒恢复量倍率。</div>
                    ${formulaLine('基础倍率', f.base || 1, 'x')}
                    ${formulaLine('敏捷加成', d.dex * (f.dexMultiplier || 0), 'x')}
                    ${formulaLine('当前倍率', mul, 'x')}
                    <div class="tt-note">实际恢复 = ${CONFIG.STAMINA_REGEN || 0} × ${fmt(mul)} /秒</div>`;
            }
            case 'hpRegen': {
                const extra = getTributeHpRegenFlat();
                return `<div class="tt-title">生命回复</div>
                    <div class="tt-desc">每秒自动恢复的生命值。</div>
                    ${formulaLine('基础回复', d.hpRegen || 0, '/秒')}
                    ${extra ? formulaLine('祭品加成', extra, '/秒') : ''}
                    ${formulaLine('合计', (d.hpRegen || 0) + extra, '/秒')}
                    <div class="tt-note">携带含固定恢复词条的祭品（如麦穗）时额外 +1/秒</div>`;
            }
            case 'mpRegen':
                return `<div class="tt-title">魔法回复</div>
                    <div class="tt-desc">每3秒自动恢复的魔法值。</div>
                    ${formulaLine('当前回复', d.mpRegen || 0, '/3秒')}
                    <div class="tt-note">精神与智力不直接影响魔法回复速率</div>`;
            case 'collisionRadius':
                return `<div class="tt-title">碰撞体积</div>
                    <div class="tt-desc">角色与怪物、障碍物碰撞的有效半径。</div>
                    ${formulaLine('碰撞半径', player.collisionRadius || 10, 'px')}
                    ${formulaLine('碰撞高度', player.collisionHeight || 60, 'px')}`;
            case 'moveSpeedDetail': {
                const speed = player.maxSpeed || d.speed || CONFIG.PLAYER_SPEED || 0;
                return `<div class="tt-title">移动速度</div>
                    <div class="tt-desc">受敏捷、地牢buff、祭品影响的实时移动速度。</div>
                    ${formulaLine('当前帧速度', speed.toFixed(2), 'px/帧')}
                    ${formulaLine('当前秒速度', (speed * 60).toFixed(0), 'px/s')}
                    <div class="tt-note">敏捷加成：${d.dex} × ${(formulas.speed?.dexMultiplier || 0.05)}</div>`;
            }
            case 'dodgeCooldown':
                return `<div class="tt-title">闪避冷却</div>
                    <div class="tt-desc">使用闪避后再次可用所需时间。</div>
                    ${formulaLine('冷却时间', CONFIG.DODGE_COOLDOWN || 800, 'ms')}`;
            case 'attackRange': {
                const cfg = getCurrentAttackConfig(player);
                return `<div class="tt-title">攻击距离</div>
                    <div class="tt-desc">当前武器攻击可命中敌人的最远距离。</div>
                    ${formulaLine('当前距离', cfg && cfg.range ? cfg.range : 100, 'px')}`;
            }
            case 'knockback': {
                const cfg = getCurrentAttackConfig(player);
                return `<div class="tt-title">击退距离</div>
                    <div class="tt-desc">攻击命中后推开敌人的距离。</div>
                    ${formulaLine('当前击退', cfg && cfg.knockback ? cfg.knockback : 20, 'px')}`;
            }
            case 'viewRange':
                return `<div class="tt-title">视野宽度</div>
                    <div class="tt-desc">摄像机渲染的游戏画面宽度。</div>
                    ${formulaLine('视野宽度', CONFIG.VIEW_WIDTH || 0, 'px')}`;
            case 'loopCount':
                return `<div class="tt-title">轮回次数</div>
                    <div class="tt-desc">已完成的主神空间轮回次数。</div>
                    <div class="tt-note">当前：${d.loopCount || 0}</div>`;
            case 'surviveDays':
                return `<div class="tt-title">存活天数</div>
                    <div class="tt-desc">本轮游戏已存活的天数。</div>
                    <div class="tt-note">当前：${d.surviveDays || 1} 天</div>`;
            case 'kills':
                return `<div class="tt-title">击杀数</div>
                    <div class="tt-desc">本轮游戏累计击杀的敌人数量。</div>
                    <div class="tt-note">当前：${d.kills || 0}</div>`;
            case 'quests':
                return `<div class="tt-title">完成任务</div>
                    <div class="tt-desc">本轮游戏已完成的主神任务数量。</div>
                    <div class="tt-note">当前：${d.quests || 0}</div>`;
            case 'geneLock':
                return `<div class="tt-title">基因锁</div>
                    <div class="tt-desc">基因锁开启等级，影响额外成长。</div>
                    <div class="tt-note">当前：${d.geneLock || '未开启'}</div>`;
            case 'rank':
                return `<div class="tt-title">主神评价</div>
                    <div class="tt-desc">根据本轮表现给出的综合评价。</div>
                    <div class="tt-note">当前：${d.rank || 'F'}</div>`;
            default:
                return `<div class="tt-title">${key}</div><div class="tt-desc">暂无说明</div>`;
        }
    }
};

export default StatusTooltipHelper;
