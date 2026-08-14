// ============================================================
// 通用技能系统（2026-08-12）
// 玩家与侍从共用同一套技能数据模型/构建/修炼/渲染：
//   - 数据源：data/skills.json → main.js 挂 window.SKILL_DATA
//   - 构建：DataLoader.buildSkillFromJSON（公式/经验曲线/效果缓存同玩家）
//   - 修炼：SkillLevelSystem.addExp（升级/满级封顶通用）
//   - 升级回调：onSkillLevelUp（按 effectFormula 应用属性奖励；特效队列对无坐标单位兜底）
// 玩家现有 SkillManager 保持不动（技能顺序/筛选/详情为玩家专属），
// 侍从技能栏走 renderSkillList 通用渲染。
// ============================================================

import { buildSkillFromJSON } from './skill-formula.js';

/** 技能数据源（window.SKILL_DATA，node 环境返回空） */
export function getSkillData() {
    if (typeof window !== 'undefined' && window.SKILL_DATA) return window.SKILL_DATA;
    return {};
}

/**
 * 按技能 id 列表构建技能对象表（与玩家 _initSkills 同构：id → skill 对象）。
 * @param {string[]} skillIds - 要构建的技能 id（玩家全量可传 Object.keys(skillData)）
 * @param {object} [skillData] - 技能定义（缺省 window.SKILL_DATA）
 * @returns {object} skills 表
 */
export function buildSkillMap(skillIds, skillData = null) {
    const data = skillData || getSkillData();
    const skills = {};
    for (const id of skillIds || []) {
        const def = data[id];
        if (!def) continue;
        skills[id] = buildSkillFromJSON(id, def);
    }
    return skills;
}

/**
 * 从序列化数据恢复技能对象（JSON 序列化会丢 getEffect/getExpForNext 方法）：
 * 按 id 从 skillData 重建对象，再覆盖 level/exp/maxExp。
 * @param {object} savedSkills - serialize 后的 skills 表（纯数据）
 * @param {object} [skillData] - 技能定义（缺省 window.SKILL_DATA）
 */
export function restoreSkills(savedSkills, skillData = null) {
    const data = skillData || getSkillData();
    const out = {};
    for (const [id, saved] of Object.entries(savedSkills || {})) {
        const def = data[id];
        if (!def) continue;
        const skill = buildSkillFromJSON(id, def);
        skill.level = saved.level || 1;
        skill.exp = saved.exp || 0;
        skill.maxExp = saved.maxExp || skill.getExpForNext(skill.level);
        out[id] = skill;
    }
    return out;
}

/** 取技能对象（owner.skills[id]） */
export function getSkill(owner, skillId) {
    return (owner && owner.skills && owner.skills[skillId]) || null;
}

/** 通用取技能效果（与玩家 getEffect 同口径，带缓存） */
export function getSkillEffect(owner, skillId, level) {
    const skill = getSkill(owner, skillId);
    if (!skill) return {};
    return skill.getEffect(level !== undefined ? level : skill.level);
}

/**
 * 通用技能修炼入口（命中/击杀/使用等场景调用）。
 * @param {object} owner - 单位（玩家/侍从），需有 skills 与 data
 * @param {string} skillId - 技能 id
 * @param {number} amount - 经验量
 * @param {object} [opts] - { refreshUI: fn } 升级后刷新对应 UI
 * @returns {boolean} 是否升级
 */
export function grantSkillExp(owner, skillId, amount, opts = {}) {
    const skill = getSkill(owner, skillId);
    if (!skill || amount <= 0) return false;
    // 升级逻辑与 combat/skill-level-system.js SkillLevelSystem.addExp 同源（内联保持本模块纯净，
    // 无 Phaser 依赖可 node 单测；玩家路径仍走 SkillLevelSystem，行为一致）
    if (skill.level >= skill.maxLevel) return false;
    skill.exp += amount;
    let leveled = false;
    while (skill.exp >= skill.maxExp && skill.level < skill.maxLevel) {
        skill.exp -= skill.maxExp;
        skill.level++;
        skill.maxExp = skill.getExpForNext(skill.level);
        leveled = true;
    }
    if (skill.level >= skill.maxLevel) skill.exp = 0;
    if (leveled) onSkillLevelUp(owner, skill);
    if (leveled && typeof opts.refreshUI === 'function') opts.refreshUI(owner, skill);
    return leveled;
}

/**
 * 通用技能升级回调（玩家 SkillManager.onLevelUp 的通用版）：
 * 按 effectFormula 里的属性奖励字段应用（strBonus/dexBonus/intBonus/conBonus/wisBonus/luckBonus），
 * 无坐标单位（侍从未入场景）跳过特效队列；有效果文本时打印。
 */
export function onSkillLevelUp(owner, skill) {
    if (!owner || !skill) return;
    const effect = typeof skill.getEffect === 'function' ? skill.getEffect(skill.level) : {};
    const attrMap = {
        strBonus: 'str', dexBonus: 'dex', intBonus: 'int',
        conBonus: 'con', wisBonus: 'wis', luckBonus: 'luck',
    };
    let attrText = '';
    for (const [formulaKey, attrKey] of Object.entries(attrMap)) {
        const v = effect[formulaKey];
        if (typeof v === 'number' && isFinite(v) && v !== 0) {
            owner.data[attrKey] = (owner.data[attrKey] || 0) + v;
            attrText += `${attrKey.toUpperCase()}+${v} `;
        }
    }
    if (owner.calculateCombatStats) owner.calculateCombatStats();
    if (owner.updateMaxStats) owner.updateMaxStats();
    if (typeof owner.x === 'number' && typeof owner.y === 'number' && typeof EffectManager !== 'undefined') {
        // 场景内单位（玩家）：特效队列展示升级（框架：玩家走原 SkillManager，此分支一般不被触发）
    }
    if (attrText) console.log(`[SkillSystem] ${owner.name || owner.id} ${skill.name} Lv.${skill.level} ${attrText}`);
}

/**
 * 通用技能列表渲染（侍从技能栏；玩家技能栏保留 SkillManager 专属渲染）。
 * 卡片格式与玩家技能页完全一致：.skill-card + .skill-icon + .skill-name +
 * .skill-level + .skill-exp-bar/.skill-exp-fill（全局 CSS 复用）。
 * @param {HTMLElement} container - 容器
 * @param {object} skills - skills 表
 * @param {object} [opts] - { onSelect: fn(skill), placeholder: string, gridClass: string }
 */
export function renderSkillList(container, skills, opts = {}) {
    if (!container) return;
    const list = Object.values(skills || {});
    if (!list.length) {
        container.innerHTML = `<div class="companion-skill-placeholder">${opts.placeholder || '技能栏占位（后续按指令添加技能）'}</div>`;
        return;
    }
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = opts.gridClass || 'skill-grid';
    for (const skill of list) {
        const expPct = skill.level >= skill.maxLevel ? 100 : Math.min(100, (skill.exp / Math.max(1, skill.maxExp)) * 100);
        const card = document.createElement('div');
        card.className = 'skill-card';
        card.dataset.skillId = skill.id;
        card.innerHTML = `
            <div class="skill-icon">${skill.iconImage ? `<img src="${skill.iconImage}" style="width:48px;height:48px;object-fit:contain;" onerror="this.style.display='none';this.parentElement.textContent='${skill.icon || '✦'}';">` : (skill.icon || '✦')}</div>
            <div class="skill-name">${skill.name || skill.id}</div>
            <div class="skill-level">Lv.${skill.level} / ${skill.maxLevel}</div>
            <div class="skill-exp-bar"><div class="skill-exp-fill" style="width:${expPct}%"></div></div>
        `;
        if (typeof opts.onSelect === 'function') card.onclick = () => opts.onSelect(skill);
        grid.appendChild(card);
    }
    container.appendChild(grid);
}
