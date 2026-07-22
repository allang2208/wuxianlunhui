/**
 * 配置完整性校验（scripts/test-config-integrity.mjs）
 *
 * 校验项目配置间的一致性，把"配置改了但引用断链"这类错误挡在运行前：
 * 1. enemy-config.json：rank 合法、贴图/音效路径存在、工厂键有配置、配置键有工厂
 * 2. BootScene.js：所有 load.image/spritesheet 的贴图路径存在
 * 3. BootScene.js：anims.create 引用的贴图键已加载
 * 4. dungeon-config.json：floor 贴图键已加载、poolFamily 非空、等级合法、nodeCount 区间、minRoomsToBoss
 * 5. agent-invasion.json / agent-synergy.json：角色键在 enemy-config.json 中存在
 *
 * 用法：node scripts/test-config-integrity.mjs（错误时退出码 1）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RANKS = new Set(['normal', 'minor', 'elite', 'lord', 'boss']);
const GRADES = new Set(['F', 'E', 'D', 'C', 'B', 'A']);

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
const fileExists = (rel) => fs.existsSync(path.join(ROOT, rel));

// ---------- 1. BootScene 贴图加载 ----------
const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf-8');
const loadedKeys = new Set();
const loadRe = /this\.load\.(?:image|spritesheet)\(\s*'([^']+)'\s*,\s*'([^']+)'/g;
let m;
while ((m = loadRe.exec(bootSrc)) !== null) {
    loadedKeys.add(m[1]);
    if (!fileExists(m[2])) err(`BootScene 加载的贴图不存在：'${m[1]}' -> ${m[2]}`);
}

// anims.create 引用的贴图键
const animTextureRe = /generateFrameNumbers\('([^']+)'/g;
while ((m = animTextureRe.exec(bootSrc)) !== null) {
    if (!loadedKeys.has(m[1])) err(`anims.create 引用未加载的贴图键：'${m[1]}'`);
}

// ---------- 2. enemy-config.json ----------
const enemyCfg = readJson('data/enemy-config.json');
for (const [key, cfg] of Object.entries(enemyCfg)) {
    if (cfg.rank && !RANKS.has(cfg.rank)) err(`enemy-config.json ${key}: 非法 rank '${cfg.rank}'`);
    // 贴图路径
    for (const [tk, tv] of Object.entries(cfg.textures || {})) {
        if (typeof tv === 'string' && tv.startsWith('assets/') && !fileExists(tv)) {
            err(`enemy-config.json ${key}.textures.${tk} 不存在：${tv}`);
        }
    }
    // 音效路径（非路径字段跳过）
    for (const [sk, sv] of Object.entries(cfg.sounds || {})) {
        if (typeof sv === 'string' && /\.(mp3|wav)$/.test(sv) && !fileExists(sv)) {
            err(`enemy-config.json ${key}.sounds.${sk} 不存在：${sv}`);
        } else if (Array.isArray(sv)) {
            for (const p of sv) {
                if (typeof p === 'string' && /\.(mp3|wav)$/.test(p) && !fileExists(p)) {
                    err(`enemy-config.json ${key}.sounds.${sk}[] 不存在：${p}`);
                }
            }
        }
    }
    // 精灵图帧数上限（4×8 切割最多 32 帧）
    const skills = cfg.attackSkills || {};
    for (const [name, sk] of Object.entries(skills)) {
        if (sk && typeof sk === 'object' && typeof sk.frames === 'number' && sk.frames > 32) {
            err(`enemy-config.json ${key}.attackSkills.${name}.frames=${sk.frames} 超出 4×8 切割上限 32`);
        }
    }
    // 碰撞体积双源一致性：collisionHeight（绿色矩形配置）与 projectileHitbox.height（躯干判定唯一来源）
    // 不一致时判定高度与配置显示不一致（历史 bug：只改 collisionHeight 导致矩形未拉伸）
    const r = cfg.render || {};
    if (r.collisionHeight && r.projectileHitbox && r.projectileHitbox.height && r.collisionHeight !== r.projectileHitbox.height) {
        warn(`enemy-config.json ${key}: collisionHeight(${r.collisionHeight}) 与 projectileHitbox.height(${r.projectileHitbox.height}) 不一致（躯干判定以 projectileHitbox 为准，两处需同步）`);
    }
}

// 工厂键 ↔ 配置键（从 zombie-dungeon.js 提取 ZOMBIE_FACTORY_MAP）
const zdSrc = fs.readFileSync(path.join(ROOT, 'src/world/zombie-dungeon.js'), 'utf-8');
const factoryKeys = new Set();
const factoryRe = /^\s{4}(\w+):\s*create\w+,?\s*$/gm;
while ((m = factoryRe.exec(zdSrc)) !== null) factoryKeys.add(m[1]);
for (const fk of factoryKeys) {
    if (!enemyCfg[fk]) err(`ZOMBIE_FACTORY_MAP['${fk}'] 在 enemy-config.json 中无配置`);
}
for (const key of Object.keys(enemyCfg)) {
    if ((enemyCfg[key].category === 'monster') && !factoryKeys.has(key)) {
        warn(`enemy-config.json['${key}'] 不在 ZOMBIE_FACTORY_MAP 中（不会进地牢怪物池，主神空间手动生成除外）`);
    }
}

// ---------- 3. dungeon-config.json ----------
const dungeonCfg = readJson('data/dungeon-config.json');
for (const [key, info] of Object.entries(dungeonCfg.dungeonList || {})) {
    if (info.grade && !GRADES.has(info.grade)) err(`dungeonList.${key}: 非法等级 '${info.grade}'`);
}
for (const key of ['zombieDungeon', 'zombieDungeonBeginner', 'zombieDungeonMid']) {
    const d = dungeonCfg[key];
    if (!d) continue;
    if (d.nodeCount && d.nodeCount.min > d.nodeCount.max) err(`${key}.nodeCount min>max`);
    if (d.minRoomsToBoss !== undefined && d.shortestCombatPath !== undefined && d.minRoomsToBoss < d.shortestCombatPath + 2) {
        err(`${key}.minRoomsToBoss(${d.minRoomsToBoss}) < shortestCombatPath+2(${d.shortestCombatPath + 2})，约束不可达`);
    }
    for (const tk of (d.floor && d.floor.tiles) || []) {
        if (!loadedKeys.has(tk)) err(`${key}.floor.tiles 贴图键未在 BootScene 加载：'${tk}'`);
    }
    if (d.bossEncounter && d.bossEncounter.poolFamily) {
        const fam = d.bossEncounter.poolFamily;
        const hasFam = Object.values(enemyCfg).some(c => c.family === fam);
        if (!hasFam) err(`${key}.bossEncounter.poolFamily '${fam}' 在 enemy-config.json 中无任何怪物`);
    }
}

// ---------- 4. 特工机制配置 ----------
const invCfg = readJson('data/agent-invasion.json');
for (const role of Object.values(invCfg.agentCompositionByGrade || {}).flat()) {
    if (!['assault', 'shield'].includes(role)) err(`agent-invasion.json 构成含未知角色 '${role}'`);
}
for (const g of Object.keys(invCfg.agentCompositionByGrade || {})) {
    if (!GRADES.has(g)) err(`agent-invasion.json agentCompositionByGrade 非法等级 '${g}'`);
}
const synCfg = readJson('data/agent-synergy.json');
for (const [role, key] of Object.entries(synCfg.roles || {})) {
    if (!enemyCfg[key]) err(`agent-synergy.json roles.${role}='${key}' 在 enemy-config.json 中不存在`);
}

// ---------- 输出 ----------
for (const w of warnings) console.warn(`WARN  ${w}`);
if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR ${e}`);
    console.error(`\n配置完整性校验失败：${errors.length} 个错误，${warnings.length} 个警告`);
    process.exit(1);
}
console.log(`配置完整性校验通过（${warnings.length} 个警告）`);
