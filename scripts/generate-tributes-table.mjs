/**
 * 生成祭品效果一览表（tributes-table.md）
 * 数据源：data/equipment.json 中 category === 'tribute' 的物品
 * 用法：node scripts/generate-tributes-table.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'equipment.json');
const OUT = path.join(ROOT, 'tributes-table.md');

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'legendary'];
const RARITY_LABELS = {
    common: '普通', uncommon: '优质', rare: '稀有',
    epic: '史诗', mythic: '神话', legendary: '传说',
};

/** effects 键 → 中文名（与 SKILL.md 祭品工作流第 2 节一致） */
const EFFECT_LABELS = {
    atkPercent: '物理攻击', matkPercent: '魔法攻击',
    defPercent: '物理防御', mdefPercent: '魔法防御',
    moveSpeedPercent: '移动速度', critPercent: '暴击率',
    goldPercent: '金币掉落', expPercent: '经验获取', dropChancePercent: '祭品掉率',
    hpRegenPercent: '生命恢复', mpRegenPercent: '魔法恢复', staminaRegenPercent: '体力恢复',
    hpRegenFlat: '生命恢复(固定/秒)',
    monsterDamageTakenPercent: '怪物承伤', monsterAtkDownPercent: '怪物攻击削减', monsterMoveSlowPercent: '怪物移速削减',
    combatChanceDelta: '战斗事件概率(pp)', eliteChanceDelta: '精英战斗概率(pp)',
    revivePercent: '复活生命', killMpHealPercent: '击杀回蓝', killHpHealPercent: '击杀回血',
};

/** special 特效键渲染（与 tribute-effects.js SPECIAL_BUFFS / 特效模式一致） */
const SPECIAL_RENDERERS = {
    surviveCapPercent: (v) => `【金刚不坏】单次伤害≤${v}%最大生命`,
    moonshadowDuration: (v) => `【月影】入战无敌 ${v / 1000}s`,
    moonshadowDamagePercent: (v) => `【月影】精英/Boss战物魔伤 +${v}%`,
    oreUpgrade: (v) => `【点石成金】拾取祭品品质+${v === true ? 1 : v}`,
};

function collectTributes(node, acc) {
    if (Array.isArray(node)) {
        node.forEach((v) => collectTributes(v, acc));
    } else if (node && typeof node === 'object') {
        if (node.category === 'tribute') acc.push(node);
        else Object.values(node).forEach((v) => collectTributes(v, acc));
    }
    return acc;
}

function fmtValue(key, value) {
    // Delta 键为百分点（pp），Flat 为固定值，其余为百分比
    if (key.endsWith('Delta')) return `${value > 0 ? '+' : ''}${value}pp`;
    if (key.endsWith('Flat')) return `${value > 0 ? '+' : ''}${value}/秒`;
    return `${value > 0 ? '+' : ''}${value}%`;
}

function renderEffects(item) {
    const parts = [];
    const effects = item.effects || {};
    for (const [key, value] of Object.entries(effects)) {
        const label = EFFECT_LABELS[key] || key;
        parts.push(`${label} ${fmtValue(key, value)}`);
    }
    // 特效（special 块）按注册渲染器输出；未识别的键原样列出
    const special = item.special || {};
    for (const [key, value] of Object.entries(special)) {
        const renderer = SPECIAL_RENDERERS[key];
        parts.push(renderer ? renderer(value) : `【${key}】${value}`);
    }
    // effects/special 皆空时回退 stats 面板文本
    if (parts.length === 0 && Array.isArray(item.stats)) {
        for (const s of item.stats) parts.push(`${s.name} ${s.value}`);
    }
    return parts.join('<br>') || '—';
}

const data = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
const tributes = collectTributes(data, []);
tributes.sort((a, b) => {
    const ra = RARITY_ORDER.indexOf(a.rarity);
    const rb = RARITY_ORDER.indexOf(b.rarity);
    if (ra !== rb) return ra - rb;
    return String(a.name).localeCompare(String(b.name), 'zh');
});

const counts = {};
for (const t of tributes) counts[t.rarity] = (counts[t.rarity] || 0) + 1;
const summary = RARITY_ORDER.filter((r) => counts[r])
    .map((r) => `${RARITY_LABELS[r]} ${counts[r]}`).join(' / ');

const lines = [
    '# 祭品效果一览表',
    '',
    `> 由 \`scripts/generate-tributes-table.mjs\` 生成，数据源 \`data/equipment.json\`（共 ${tributes.length} 件：${summary}）。修改祭品后重新运行脚本更新本表。`,
    '',
    '| 祭品 | 稀有度 | 效果 |',
    '|---|---|---|',
];
for (const t of tributes) {
    const rarity = RARITY_LABELS[t.rarity] || t.rarity;
    lines.push(`| ${t.icon || ''} ${t.name} | ${rarity} | ${renderEffects(t)} |`);
}

fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf-8');
console.log(`OK: ${OUT}（${tributes.length} 件祭品）`);
