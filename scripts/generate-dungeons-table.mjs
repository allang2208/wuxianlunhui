/**
 * 生成地牢要素一览表（dungeons-table.md）
 * 数据源：data/dungeon-config.json（展示元数据 + 各地牢配置块）
 *        + src/config/dungeon-config.js 的 DEFAULTS（遭遇兜底，文本提取，不引依赖）
 * 用法：node scripts/generate-dungeons-table.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'dungeon-config.json');
const CFG_JS = path.join(ROOT, 'src', 'config', 'dungeon-config.js');
const OUT = path.join(ROOT, 'dungeons-table.md');

/** 地牢类型 → 配置块键（与 dungeon-config.js _keyFor 同步维护） */
const KEY_MAP = {
    zombie: 'zombieDungeon',
    zombieBeginner: 'zombieDungeonBeginner',
    zombieMid: 'zombieDungeonMid',
};

const GRADE_ORDER = ['F', 'E', 'D', 'C', 'B', 'A'];

/** 从 dungeon-config.js 文本提取 DEFAULTS 字面量（离线求值，避免 import 链） */
function loadDefaults() {
    const src = fs.readFileSync(CFG_JS, 'utf-8');
    const start = src.indexOf('const DEFAULTS = ');
    if (start < 0) return {};
    const open = src.indexOf('{', start);
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const literal = src.slice(open, end + 1);
    // eslint-disable-next-line no-new-func
    return new Function(`return (${literal});`)();
}

function pct(v) {
    return v === undefined || v === null ? '—' : `${Math.round(v * 100)}%`;
}

function nodeCountDesc(cfg, info) {
    if (cfg.nodeCount) {
        return cfg.nodeCount.min === cfg.nodeCount.max
            ? `${cfg.nodeCount.min}` : `${cfg.nodeCount.min}~${cfg.nodeCount.max}`;
    }
    return info.nodeCount || '—';
}

function encounterDesc(enc) {
    if (!enc) return '—';
    const waves = enc.combatWaves ?? '—';
    const per = enc.monstersPerWave ?? '—';
    let comp = '';
    if (enc.monsterComposition) {
        comp = '（' + Object.entries(enc.monsterComposition).map(([t, n]) => `${t}×${n}`).join('+') + '）';
    } else if (enc.tierWeights) {
        const parts = Object.entries(enc.tierWeights).filter(([, w]) => w > 0).map(([t, w]) => `${t} ${pct(w)}`);
        comp = parts.length ? `（${parts.join(' / ')}）` : '';
    }
    return `${waves} 波×${per}${comp}`;
}

function bossDesc(cfg) {
    if (!cfg.bossEncounter) return '专属 Boss（BossRewardSystem 集合体）';
    const comp = cfg.bossEncounter.monsterComposition || {};
    const parts = Object.entries(comp).map(([tier, n]) => `${tier}×${n}`);
    let desc = parts.length ? `独立遭遇（${parts.join(' + ')}）` : '独立遭遇';
    if (cfg.bossEncounter.poolFamily) desc += `，限定${cfg.bossEncounter.poolFamily}类`;
    return desc;
}

function chestBranchDesc(cfg, grade) {
    const count = cfg.chestBranches?.count ?? (2 + Math.max(0, GRADE_ORDER.indexOf(grade)) * 2);
    return `${count} 条（2~3 节点，1 战斗 50% 精英，尽头宝箱）`;
}

function invasionDesc(grade, inv) {
    const eligible = inv.enabled !== false && GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf(inv.minGrade || 'D');
    if (!eligible) return '—';
    const cnt = (inv.agentCountByGrade && inv.agentCountByGrade[grade]) ?? 1;
    return `${Math.round((inv.initialChance ?? 0.25) * 100)}% 起，每 ${inv.chanceStepTurns ?? 2} 回合 +${Math.round((inv.chanceStep ?? 0.05) * 100)}%，特工×${cnt}`;
}

const data = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
const DEFAULTS = loadDefaults();
const INVASION = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'agent-invasion.json'), 'utf-8'));
const list = data.dungeonList || {};

const lines = [
    '# 地牢要素一览表',
    '',
    '> 由 `scripts/generate-dungeons-table.mjs` 生成，数据源 `data/dungeon-config.json`（+ `data/agent-invasion.json`）。新增/修改地牢后重新运行脚本更新本表。',
    '',
    '| 地牢 | 等级 | 房间数 | 起始路线 | 战斗/事件 | 精英战斗 | 最短路径战斗 | 到Boss最少房间 | 宝箱岔路 | 普通战斗构成 | 精英战斗构成 | Boss | 时空特工入侵 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];

for (const [key, info] of Object.entries(list)) {
    const cfg = data[KEY_MAP[key]] || {};
    const grade = info.grade || '—';
    const nodes = nodeCountDesc(cfg, info);
    const startRows = Array.isArray(cfg.startRows) ? `${cfg.startRows.length} 条` : '—';
    const ratios = cfg.typeRatios ? `${pct(cfg.typeRatios.combat)} / ${pct(cfg.typeRatios.event)}` : (info.battleRatio || '—');
    const elite = cfg.eliteCombatChance !== undefined ? pct(cfg.eliteCombatChance) : '—';
    const shortest = cfg.shortestCombatPath ?? '—';
    const minRooms = cfg.minRoomsToBoss ?? ((cfg.shortestCombatPath ?? 0) + 2);
    const branches = chestBranchDesc(cfg, grade);
    const encNormal = (cfg.encounters && cfg.encounters.normal) || DEFAULTS.zombieDungeon?.encounters?.normal;
    const encElite = (cfg.encounters && cfg.encounters.elite) || DEFAULTS.zombieDungeon?.encounters?.elite;
    const normalDesc = encounterDesc(encNormal);
    const eliteDesc = (cfg.eliteCombatChance === 0) ? '—（不刷）' : encounterDesc(encElite);
    const boss = bossDesc(cfg);
    const invasion = invasionDesc(grade, INVASION);
    lines.push(`| ${info.name || key} | ${grade} | ${nodes} | ${startRows} | ${ratios} | ${elite} | ${shortest} 场 | ${minRooms} 间 | ${branches} | ${normalDesc} | ${eliteDesc} | ${boss} | ${invasion} |`);
}

lines.push(
    '',
    '## 说明',
    '',
    '- **房间数**：含起点/战斗/事件/Boss/奖励节点，不含宝箱岔路（岔路另计）；`min~max` 为生成浮动区间。',
    '- **最短路径战斗**：主通道强制战斗节点数（shortestCombatPath）。',
    '- **到 Boss 最少房间**：minRoomsToBoss，最短路径房间数下限（= 中间列 + 2），不足时扩展中间列。',
    '- **宝箱岔路**：独立于主线，尽头固定宝箱事件；条数缺省按等级 F=2、每级 +2。',
    '- **时空特工入侵**：详见 `data/agent-invasion.json`；仅 D 级及以上触发，追击追上后按节点类型触发三种入侵战斗（4096 场地）。',
);

fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf-8');
console.log(`OK: ${OUT}（${Object.keys(list).length} 个地牢）`);
