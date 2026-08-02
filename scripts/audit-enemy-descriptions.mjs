import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.resolve(__dirname, '../data/enemy-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const issues = [];

function addIssue(monsterId, skillName, field, configValue, descSnippet, reason) {
    issues.push({
        monsterId,
        skillName,
        field,
        configValue,
        descSnippet,
        reason,
    });
}

/** 从描述中提取所有数字（整数/小数） */
function extractNumbers(desc) {
    if (!desc) return [];
    const matches = desc.match(/\d+(?:\.\d+)?/g);
    return matches ? matches.map(Number) : [];
}

/** 提取所有时间（支持 ms/s，返回 ms） */
function extractTimesMs(desc) {
    if (!desc) return [];
    const out = [];
    // 形如 1.5s / 1500ms / 4s
    const re = /(\d+(?:\.\d+)?)\s*(ms|s|秒)/gi;
    let m;
    while ((m = re.exec(desc)) !== null) {
        const v = parseFloat(m[1]);
        const unit = m[2].toLowerCase();
        out.push(unit === 'ms' || unit === '毫秒' ? v : v * 1000);
    }
    return out;
}

/** 提取倍率（×N / N 倍） */
function extractMultipliers(desc) {
    if (!desc) return [];
    const out = [];
    const re1 = /[×xX](\d+(?:\.\d+)?)/g;
    let m;
    while ((m = re1.exec(desc)) !== null) out.push(parseFloat(m[1]));
    const re2 = /(\d+(?:\.\d+)?)\s*倍/g;
    while ((m = re2.exec(desc)) !== null) out.push(parseFloat(m[1]));
    return out;
}

/** 提取 "第 N 帧"，支持 / , 、 分隔 */
function extractHitFrames(desc) {
    if (!desc) return [];
    const out = [];
    const re = /第\s*(\d+(?:\s*[,、/]\s*\d+)*)\s*帧/g;
    let m;
    while ((m = re.exec(desc)) !== null) {
        m[1].split(/\s*[,、/]\s*/).forEach(s => {
            const n = Number(s.trim());
            if (Number.isFinite(n)) out.push(n);
        });
    }
    return out;
}

/** 提取 "N 帧动画" / "N 帧XXX动画" / "N 帧，" */
function extractFrameCounts(desc) {
    if (!desc) return [];
    const out = [];
    const re = /(\d+)\s*帧(?:\s*[^（(]*?动画|[,，])/g;
    let m;
    while ((m = re.exec(desc)) !== null) out.push(Number(m[1]));
    return out;
}

/** attackSkills key -> 可能的中文名/关键词列表（用于匹配 skills.name 或 skills.desc） */
const SKILL_KEYWORDS = {
    slam: ['砸击', '砸地', '下砸', '一砸'],
    whip: ['鞭击', '鞭子'],
    howl: ['嚎叫', '号召', '咆哮'],
    throw: ['投掷', '晶石', '投射物'],
    spawn: ['涌出', '生成', '苏生', '召唤'],
    summon: ['召唤', '唤出'],
    combo: ['二连击', '连击', '二连'],
    charge: ['冲锋', '持盾冲锋', '冲撞'],
    block: ['格挡', '防御', '举盾'],
    hammer: ['锤击'],
    grandSlam: ['重砸', '灭世'],
    flashbang: ['闪光弹'],
    axe: ['斧头', '斧砍', '斧劈'],
    bash: ['盾击'],
    defend: ['防御', '举盾', '格挡'],
    spit: ['喷射', '毒液喷射'],
    magic: ['远程魔法', '魔法'],
    venom: ['毒液瓶', '毒液区'],
    bottle: ['毒液瓶', '毒液泼洒'],
    forms: ['形态', '切换'],
    shoot: ['射击', '速射', '开火'],
    lantern: ['提灯', '矿灯'],
};

/** 尝试找到与 skillKey 对应的 skills 描述 */
function findSkillDesc(monster, skillKey) {
    if (!Array.isArray(monster.skills)) return null;

    // 1. 优先用 attackSkills.<key>.name 精确匹配 skills.name
    const skillCfg = (monster.attackSkills && monster.attackSkills[skillKey]) || {};
    if (skillCfg.name) {
        const byName = monster.skills.find(s => s.name === skillCfg.name);
        if (byName) return byName.desc || '';
    }

    // 2. 用 skillKey 匹配 skills.name（英文 key 直接匹配的情况）
    const byNameKey = monster.skills.find(s => s.name === skillKey);
    if (byNameKey) return byNameKey.desc || '';

    // 3. 用关键词列表匹配 skills.name 或 skills.desc
    const keywords = SKILL_KEYWORDS[skillKey] || [skillKey];
    for (const kw of keywords) {
        const byKwName = monster.skills.find(s => s.name && s.name.includes(kw));
        if (byKwName) return byKwName.desc || '';
    }
    for (const kw of keywords) {
        const byKwDesc = monster.skills.find(s => s.desc && s.desc.includes(kw));
        if (byKwDesc) return byKwDesc.desc;
    }

    return null;
}

function near(a, b, tolerance = 0.05) {
    if (a === undefined || a === null || b === undefined || b === null) return false;
    return Math.abs(a - b) <= tolerance;
}

function includesApprox(arr, val, tolerance = 0.05) {
    return arr.some(v => near(v, val, tolerance));
}

function auditMonster(id, monster) {
    const skills = monster.attackSkills;
    if (!skills || typeof skills !== 'object') return;

    for (const [skillKey, skillCfg] of Object.entries(skills)) {
        const skillName = skillCfg.name || skillKey;
        const desc = findSkillDesc(monster, skillName);
        if (!desc) {
            addIssue(id, skillName, 'desc', null, null, '未找到对应 skills 描述');
            continue;
        }

        const nums = extractNumbers(desc);
        const timesMs = extractTimesMs(desc);
        const multipliers = extractMultipliers(desc);
        const hitFrames = extractHitFrames(desc);
        const frameCounts = extractFrameCounts(desc);

        // range / throwRange / triggerRange
        const range = skillCfg.range ?? skillCfg.throwRange ?? skillCfg.triggerRange ?? null;
        if (range !== null && !nums.some(n => near(n, range, 1))) {
            addIssue(id, skillName, 'range/throwRange/triggerRange', range, desc.slice(0, 60), `描述中未找到 ${range}px`);
        }

        // cooldown / intervalMs
        const cd = skillCfg.cooldown ?? skillCfg.intervalMs ?? null;
        if (cd !== null && !timesMs.some(t => near(t, cd, cd * 0.05 + 50))) {
            addIssue(id, skillName, 'cooldown/intervalMs(ms)', cd, desc.slice(0, 60), `描述中未找到 ${cd}ms（或 ${cd / 1000}s）`);
        }

        // duration
        const duration = skillCfg.duration ?? null;
        if (duration !== null && !timesMs.some(t => near(t, duration, duration * 0.05 + 50))) {
            addIssue(id, skillName, 'duration(ms)', duration, desc.slice(0, 60), `描述中未找到 ${duration}ms`);
        }

        // damageMul
        const dmgMul = skillCfg.damageMul ?? null;
        if (dmgMul !== null && !multipliers.some(m => near(m, dmgMul, 0.05))) {
            addIssue(id, skillName, 'damageMul', dmgMul, desc.slice(0, 60), `描述中未找到 ×${dmgMul}`);
        }

        // frames
        const frames = skillCfg.frames ?? null;
        if (frames !== null && !frameCounts.some(f => near(f, frames, 0))) {
            addIssue(id, skillName, 'frames', frames, desc.slice(0, 60), `描述中未找到 ${frames} 帧动画`);
        }

        // hitFrames / fireFrame
        const cfgHitFrames = Array.isArray(skillCfg.hitFrames)
            ? skillCfg.hitFrames
            : (skillCfg.hitFrame !== undefined ? [skillCfg.hitFrame]
                : (skillCfg.fireFrame !== undefined ? [skillCfg.fireFrame] : []));
        for (const hf of cfgHitFrames) {
            if (!hitFrames.some(f => near(f, hf, 0))) {
                addIssue(id, skillName, 'hitFrame/fireFrame', hf, desc.slice(0, 60), `描述中未找到第 ${hf} 帧`);
            }
        }

        // summon count
        const count = skillCfg.count ?? null;
        if (count !== null && !nums.some(n => near(n, count, 0))) {
            addIssue(id, skillName, 'summon.count', count, desc.slice(0, 60), `描述中未找到召唤数量 ${count}`);
        }

        // impactRadius / zoneDuration / tickMs 等毒液区/燃烧区参数
        const impactRadius = skillCfg.impactRadius ?? null;
        if (impactRadius !== null && !nums.some(n => near(n, impactRadius, 1))) {
            addIssue(id, skillName, 'impactRadius', impactRadius, desc.slice(0, 60), `描述中未找到 ${impactRadius}px 范围`);
        }
        const zoneDuration = skillCfg.zoneDuration ?? null;
        if (zoneDuration !== null && !timesMs.some(t => near(t, zoneDuration, zoneDuration * 0.05 + 50))) {
            addIssue(id, skillName, 'zoneDuration(ms)', zoneDuration, desc.slice(0, 60), `描述中未找到持续 ${zoneDuration}ms`);
        }
        const tickMs = skillCfg.tickMs ?? null;
        if (tickMs !== null && !timesMs.some(t => near(t, tickMs, tickMs * 0.05 + 50))) {
            addIssue(id, skillName, 'tickMs', tickMs, desc.slice(0, 60), `描述中未找到 ${tickMs}ms 间隔`);
        }

        // stunMs
        const stunMs = skillCfg.stunMs ?? null;
        if (stunMs !== null && !timesMs.some(t => near(t, stunMs, stunMs * 0.05 + 50))) {
            addIssue(id, skillName, 'stunMs', stunMs, desc.slice(0, 60), `描述中未找到眩晕 ${stunMs}ms`);
        }

        // knockback
        const kb = skillCfg.knockback ?? null;
        if (kb !== null && !nums.some(n => near(n, kb, 1))) {
            addIssue(id, skillName, 'knockback', kb, desc.slice(0, 60), `描述中未找到击退 ${kb}px`);
        }
    }
}

for (const [id, monster] of Object.entries(config)) {
    auditMonster(id, monster);
}

if (issues.length === 0) {
    console.log('✅ 未发现 attackSkills 与 skills.desc 之间的不一致。');
} else {
    console.log(`⚠️ 发现 ${issues.length} 处不一致/缺失：\n`);
    for (const issue of issues) {
        console.log(`[${issue.monsterId}] ${issue.skillName}`);
        console.log(`  字段: ${issue.field}`);
        console.log(`  配置值: ${issue.configValue}`);
        console.log(`  原因: ${issue.reason}`);
        console.log(`  描述片段: ${issue.descSnippet || '(无)'}`);
        console.log('');
    }
}
