/**
 * 生成地牢要素一览表（dungeons-table.md）
 * 数据源：data/dungeon-config.json（dungeonList 展示元数据 + 各地牢配置块）
 * 用法：node scripts/generate-dungeons-table.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'dungeon-config.json');
const OUT = path.join(ROOT, 'dungeons-table.md');

/** 地牢类型 → 配置块键（与 dungeon-config.js _keyFor 同步维护） */
const KEY_MAP = {
    zombie: 'zombieDungeon',
    zombieBeginner: 'zombieDungeonBeginner',
    zombieMid: 'zombieDungeonMid',
};

const GRADE_LABELS = { F: 'F', E: 'E', D: 'D', C: 'C', B: 'B', A: 'A' };

function pct(v) {
    return v === undefined || v === null ? '—' : `${Math.round(v * 100)}%`;
}

function bossDesc(cfg) {
    if (!cfg.bossEncounter) return '专属 Boss（BossRewardSystem 集合体）';
    const comp = cfg.bossEncounter.monsterComposition || {};
    const parts = Object.entries(comp).map(([tier, n]) => `${tier}×${n}`);
    return parts.length ? `独立遭遇（${parts.join(' + ')}）` : '独立遭遇';
}

const data = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
const list = data.dungeonList || {};

const lines = [
    '# 地牢要素一览表',
    '',
    '> 由 `scripts/generate-dungeons-table.mjs` 生成，数据源 `data/dungeon-config.json`。新增/修改地牢后重新运行脚本更新本表。',
    '',
    '| 地牢 | 等级 | 房间数 | 起始路线 | 战斗/事件 | 精英战斗 | 最短路径战斗 | Boss |',
    '|---|---|---|---|---|---|---|---|',
];

for (const [key, info] of Object.entries(list)) {
    const cfg = data[KEY_MAP[key]] || {};
    const grade = info.grade || '—';
    const nodes = cfg.nodeCount ? (cfg.nodeCount.min === cfg.nodeCount.max ? `${cfg.nodeCount.min}` : `${cfg.nodeCount.min}~${cfg.nodeCount.max}`) : (info.nodeCount || '—');
    const startRows = Array.isArray(cfg.startRows) ? `${cfg.startRows.length} 条` : '—';
    const ratios = cfg.typeRatios ? `${pct(cfg.typeRatios.combat)} / ${pct(cfg.typeRatios.event)}` : (info.battleRatio || '—');
    const elite = cfg.eliteCombatChance !== undefined ? pct(cfg.eliteCombatChance) : '—';
    const shortest = cfg.shortestCombatPath ?? '—';
    lines.push(`| ${info.name || key} | ${GRADE_LABELS[grade] || grade} | ${nodes} | ${startRows} | ${ratios} | ${elite} | ${shortest} 场 | ${bossDesc(cfg)} |`);
}

fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf-8');
console.log(`OK: ${OUT}（${Object.keys(list).length} 个地牢）`);
