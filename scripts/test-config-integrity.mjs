/**
 * 配置完整性校验（scripts/test-config-integrity.mjs）
 *
 * 校验项目配置间的一致性，把"配置改了但引用断链"这类错误挡在运行前：
 * 1. enemy-config.json：基础数值契约、rank 合法、贴图/音效路径存在、工厂键与配置对齐
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
const ENEMY_REQUIRED_NUMBER_FIELDS = Object.freeze([
    'hp', 'maxHp', 'str', 'dex', 'int', 'con', 'wis', 'luck'
]);
const ENEMY_OPTIONAL_NUMBER_FIELDS = Object.freeze([
    'level', 'speed', 'attackRange', 'attackDistance', 'attackCooldown', 'aiInterval',
    'atk', 'matk', 'mdef'
]);
const ENEMY_FORBIDDEN_DERIVED_FIELDS = Object.freeze({
    def: '请通过 str/con 与 combat-formulas.json 调整',
    crit: '请通过 luck 与 combat-formulas.json 调整',
    critRes: '请通过 con 与 combat-formulas.json 调整',
    combatLevel: '由六维、maxHp、speed、rank 与 combat-formulas.json 自动派生',
    expValue: '经验由 exp-system.js 按位面、阶级和等级差动态结算'
});

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
const fileExists = (rel) => fs.existsSync(path.join(ROOT, rel));
const pendingProducerAssets = new Set(
    Object.values(readJson('data/producer-buildings.json'))
        .filter((cfg) => cfg && typeof cfg === 'object' && cfg.assetPending === true && cfg.tex)
        .map((cfg) => `assets/terrain/${cfg.tex}.png`)
);

// ---------- 0. data/ 与 public/data/ 双份配置一致性 ----------
// SKILL 反复记录"双份同步"是配置改坏重灾区（player-anim-config 等），机器强制 diff
for (const f of fs.readdirSync(path.join(ROOT, 'data')).filter(f => f.endsWith('.json'))) {
    const pub = path.join(ROOT, 'public/data', f);
    if (!fs.existsSync(pub)) continue; // 单份配置（combat-config 等只存在于 data/）
    const a = fs.readFileSync(path.join(ROOT, 'data', f));
    const b = fs.readFileSync(pub);
    if (!a.equals(b)) {
        err(`双份配置不一致：data/${f} 与 public/data/${f} 内容不同（必须双份同步）`);
    }
}

// ---------- 1. BootScene 贴图加载 ----------
const bootSrc = fs.readFileSync(path.join(ROOT, 'src/phaser/scenes/BootScene.js'), 'utf-8');
const loadedKeys = new Set();
const loadRe = /this\.load\.(?:image|spritesheet)\(\s*'([^']+)'\s*,\s*'([^']+)'/g;
let m;
while ((m = loadRe.exec(bootSrc)) !== null) {
    loadedKeys.add(m[1]);
    if (!fileExists(m[2])) {
        if (pendingProducerAssets.has(m[2])) {
            warn(`待补建筑资产：'${m[1]}' -> ${m[2]}（代码已接入，补图后自动转为正常校验）`);
        } else {
            err(`BootScene 加载的贴图不存在：'${m[1]}' -> ${m[2]}`);
        }
    }
}

// anims.create 引用的贴图键
const animTextureRe = /generateFrameNumbers\('([^']+)'/g;
while ((m = animTextureRe.exec(bootSrc)) !== null) {
    if (!loadedKeys.has(m[1])) err(`anims.create 引用未加载的贴图键：'${m[1]}'`);
}

// ---------- 2. enemy-config.json ----------
const enemyCfg = readJson('data/enemy-config.json');
for (const [key, cfg] of Object.entries(enemyCfg)) {
    if (cfg.id !== key) err(`enemy-config.json ${key}: id 必须与配置键一致（当前 '${cfg.id}'）`);
    for (const field of ENEMY_REQUIRED_NUMBER_FIELDS) {
        if (typeof cfg[field] !== 'number' || !Number.isFinite(cfg[field])) {
            err(`enemy-config.json ${key}.${field} 必须是有限数字`);
        }
    }
    for (const field of ENEMY_OPTIONAL_NUMBER_FIELDS) {
        if (cfg[field] != null && (typeof cfg[field] !== 'number' || !Number.isFinite(cfg[field]))) {
            err(`enemy-config.json ${key}.${field} 必须是有限数字`);
        }
    }
    for (const [field, guidance] of Object.entries(ENEMY_FORBIDDEN_DERIVED_FIELDS)) {
        if (Object.hasOwn(cfg, field)) {
            err(`enemy-config.json ${key}.${field} 是运行时派生字段，不允许直配；${guidance}`);
        }
    }
    if (cfg.attackSkills != null && (typeof cfg.attackSkills !== 'object' || Array.isArray(cfg.attackSkills))) {
        err(`enemy-config.json ${key}.attackSkills 必须是以技能键组织的对象`);
    }
    for (const [skillKey, skillConfig] of Object.entries(cfg.attackSkills || {})) {
        if (!skillConfig || typeof skillConfig !== 'object' || Array.isArray(skillConfig)) {
            err(`enemy-config.json ${key}.attackSkills.${skillKey} 必须是参数对象`);
        }
    }
    if (cfg.rank && !RANKS.has(cfg.rank)) err(`enemy-config.json ${key}: 非法 rank '${cfg.rank}'`);
    if ((cfg.category ?? 'monster') === 'monster' && !cfg.textures?.idle) {
        err(`enemy-config.json ${key}: 图鉴怪物必须配置 textures.idle，禁止退回颜色圆圈占位`);
    }
    const idleLayout = cfg.textures?.frameLayouts?.idle;
    if (idleLayout) {
        for (const field of ['frameWidth', 'frameHeight', 'frameCount', 'columns']) {
            if (typeof idleLayout[field] !== 'number' || !Number.isFinite(idleLayout[field]) || idleLayout[field] <= 0) {
                err(`enemy-config.json ${key}.textures.frameLayouts.idle.${field} 必须是正数`);
            }
        }
    }
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
for (const key of [
    'zombieDungeon', 'zombieDungeonBeginner', 'frozenDungeonBeginner', 'zombieDungeonMid',
    'swampDungeonBeginner', 'swampDungeonMid', 'swampDungeon'
]) {
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
    for (const [encounterName, encounter] of Object.entries({ ...(d.encounters || {}), boss: d.bossEncounter })) {
        for (const monsterKey of encounter?.poolKeys || []) {
            if (!enemyCfg[monsterKey]) err(`${key}.${encounterName}.poolKeys 怪物不存在：'${monsterKey}'`);
            if (!factoryKeys.has(monsterKey)) err(`${key}.${encounterName}.poolKeys 工厂未登记：'${monsterKey}'`);
        }
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
