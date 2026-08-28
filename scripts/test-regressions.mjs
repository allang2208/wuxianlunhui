/**
 * 回归测试（scripts/test-regressions.mjs）
 *
 * 覆盖 2026-07-28 全面排查修复的 bug 类别，防再犯：
 * 1. 时空特工追击状态机（真实源码注入桩执行）：触发后特工必须逐回合推进
 *    （历史上 invasionsUsed 上限闸门误挡追击分支，特工永远不走位、入侵永不发生）
 * 2. 弹药配置回退：ammoConfig.max 经 JSON 克隆变 null 时必须回退 GUN_AMMO_CAP
 *    （能量轻机枪 max: Infinity → null 无法开火的根因）
 * 3. data/ ↔ public/data/ 双份 JSON 逐字节一致（运行时 fetch 命中 public 副本）
 * 4. 宝箱奖励表 F~A 全档（chest-room-system GRADES 曾缺 F，F 级错发 D 档）
 * 5. equipment.json 音效路径全部真实存在（双份漂移曾致开火音效 404）
 *
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-regressions.mjs
 * （package.json test 脚本若引用本文件需带 --import；直接 node 运行也可——
 *  本文件头部已自注册 JSON loader，动态 import 的 src 模块内裸 JSON 导入也能工作）
 */
// 自注册 JSON loader：使后续 await import() 的 src 模块内裸 .json 导入
// 无需命令行 --import 也能工作（单跑/CI 直接 node 本文件不再报 ERR_IMPORT_ATTRIBUTE_MISSING）
await import('./register-json-loader.mjs');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ========== 1. 时空特工追击状态机（真实源码 + 桩） ==========
console.log('\n[1] 时空特工追击状态机');
{
    // 真实源码注入桩执行：agent-invasion-system 的实体/Phaser 链无法在 node 导入，
    // 剥掉 import/export 后用 new Function 注入桩——状态机逻辑是真实代码
    const src = fs.readFileSync(path.join(ROOT, 'src/world/agent-invasion-system.js'), 'utf-8')
        .split('\n')
        .filter(l => !l.trimStart().startsWith('import '))
        .join('\n')
        .replace('export const AgentInvasionSystem', 'const AgentInvasionSystem');

    const invasionConfig = readJson('data/agent-invasion.json');
    const DungeonConfigStub = {
        getDungeonList: () => ({ zombie: { grade: 'D' } }),
        getZombieDungeonConfig: () => ({ minRoomsToBoss: 3 }),
    };
    const factoryStub = (x, y) => ({ x, y });

    // _updateLabel 需要 document
    globalThis.document = {
        createElement: () => ({ style: { setProperty() {} }, textContent: '', remove() {} }),
        getElementById: () => null,
        body: { appendChild() {} },
    };

    const build = new Function('DungeonConfig', 'createTimeAgentAssault', 'createTimeAgentShield', 'invasionConfig',
        `${src}; return AgentInvasionSystem;`);
    const AIS = build(DungeonConfigStub, factoryStub, factoryStub, invasionConfig);

    // 节点链：start → n1..n6（直线，BFS 必可达）
    const nodes = [{ id: 'start', type: 'start' }, ...Array.from({ length: 6 }, (_, i) => ({ id: `n${i + 1}`, type: 'combat' }))];
    const edges = [];
    for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
    let playerIdx = 0;
    const dms = { dungeonType: 'zombie', nodes, edges, get currentNodeId() { return nodes[playerIdx].id; } };

    AIS.init(dms);
    check('D 级地牢 eligible=true', AIS.eligible === true);

    // 前 minRoomsToBoss-1 回合不判定
    AIS.onPlayerEnterNode(nodes[1]);
    check('未到起始回合 chance=0', AIS.chance === 0);

    // 强制触发（Math.random 恒 0 < chance）；每进入一节点=1 回合，逐节点推进
    const origRandom = Math.random;
    Math.random = () => 0;
    playerIdx = 2; AIS.onPlayerEnterNode(nodes[playerIdx]); // tc=2 < startTurns=3
    playerIdx = 3; AIS.onPlayerEnterNode(nodes[playerIdx]); // tc=3=startTurns → 判定触发
    Math.random = origRandom;
    check('达到起始回合后触发', AIS.triggered === true && AIS.invasionsUsed === 1);
    check('特工起点=start 节点', AIS.agentNodeId === 'start');

    // 核心回归：触发后下一回合特工必须推进（修复前 invasionsUsed 闸门挡死，恒不动）
    playerIdx = 4; AIS.onPlayerEnterNode(nodes[playerIdx]);
    check('触发后特工沿最短路线推进（不被上限闸门挡死）', AIS.agentNodeId === 'n2', `实际=${AIS.agentNodeId}`);

    // 继续推进直到追上
    playerIdx = 5; AIS.onPlayerEnterNode(nodes[playerIdx]);
    playerIdx = 6; AIS.onPlayerEnterNode(nodes[playerIdx]);
    check('特工最终追上玩家（caught=true）', AIS.caught === true, `agent=${AIS.agentNodeId} player=${nodes[playerIdx].id}`);
    check('追上后拦截下一节点', AIS.shouldIntercept({ type: 'combat' }) === true);
    check('empty 节点不拦截', AIS.shouldIntercept({ type: 'empty' }) === false);

    // 消费捕获标记：一次入侵只拦截一次，且次数上限拦住新一轮
    AIS.consumeCatch();
    check('consumeCatch 复位 caught/triggered', AIS.caught === false && AIS.triggered === false);
    Math.random = () => 0;
    AIS.onPlayerEnterNode(nodes[6]);
    Math.random = origRandom;
    check('maxInvasionsPerRun=1 时不二次触发', AIS.triggered === false);

    // F 级地牢不启用
    const AIS2 = build(DungeonConfigStub, factoryStub, factoryStub, invasionConfig);
    AIS2.init({ ...dms, dungeonType: 'zombieBeginner' });
    // 桩的 getDungeonList 只有 zombie，F 级回退 grade='F' → minGrade D 不启用
    check('F 级地牢 eligible=false', AIS2.eligible === false);
}

// ========== 2. 弹药配置回退（真实模块） ==========
console.log('\n[2] 弹药配置回退（JSON 克隆 Infinity→null）');
{
    const { getAmmoConfig, isGunWeapon } = await import(pathToFileURL(path.join(ROOT, 'src/config/gun-ammo.js')));
    // 模拟 JSON 克隆后的能量轻机枪实例（max: Infinity → null）
    const cloned = JSON.parse(JSON.stringify({ weaponId: 'weapon15', ammoConfig: { max: Infinity, reloadTime: 0 } }));
    check('JSON 克隆后 max 变 null（前提成立）', cloned.ammoConfig.max === null);
    const cfg = getAmmoConfig(cloned);
    check('max==null 时回退 GUN_AMMO_CAP.weapon15', cfg && cfg.max === Infinity, `实际=${cfg && cfg.max}`);
    check('其余字段实例优先', cfg.reloadTime === 0);
    const normal = getAmmoConfig({ weaponId: 'weapon9', ammoConfig: { max: 12, reloadTime: 1000 } });
    check('正常实例不受影响', normal.max === 12);
    const bare = getAmmoConfig({ weaponId: 'weapon9' });
    check('无 ammoConfig 时按 weaponId 回退', bare && bare.max === 12);
    check('isGunWeapon 按 weaponId 回退判定', isGunWeapon({ weaponId: 'weapon15' }) === true);
}

// ========== 3. data/ ↔ public/data/ 双份一致 ==========
console.log('\n[3] data/ ↔ public/data/ 双份一致');
{
    const pairs = ['equipment.json', 'player-anim-config.json', 'wall-prefabs.json', 'skills.json'];
    for (const f of pairs) {
        const a = path.join(ROOT, 'data', f), b = path.join(ROOT, 'public/data', f);
        if (!fs.existsSync(a) || !fs.existsSync(b)) { check(`${f} 双份存在`, false); continue; }
        check(`${f} 双份逐字节一致`, fs.readFileSync(a, 'utf-8') === fs.readFileSync(b, 'utf-8'));
    }
}

// ========== 3b. 贴图单一路径：public/assets 不得存在（防双份漂移，Vite 以 public 优先服务） ==========
console.log('\n[3b] 贴图单一路径（仅 assets/）');
{
    check('public/assets 不存在（贴图仅 assets/ 一条路径）', !fs.existsSync(path.join(ROOT, 'public/assets')));
    // 游戏引用的关键贴图在 assets/ 下必须存在
    for (const f of ['icons/201-icon.png', 'player/dash_recover.png']) {
        check(`assets/${f} 存在`, fs.existsSync(path.join(ROOT, 'assets', f)));
    }
}

// ========== 4. 宝箱奖励表 F~A 全档 ==========
console.log('\n[4] 宝箱奖励表完整性');
{
    const cf = readJson('data/combat-formulas.json');
    const table = cf.universalEventRewards && cf.universalEventRewards.treasureChest;
    check('treasureChest 表存在', !!table);
    for (const g of ['F', 'E', 'D', 'C', 'B', 'A']) {
        check(`treasureChest 含 ${g} 档`, !!(table && table[g]));
        if (table && table[g]) {
            check(`treasureChest ${g} 含 gold/materialDust`, typeof table[g].gold === 'number' && typeof table[g].materialDust === 'number');
            check(`treasureChest ${g} 含强化石/改造券/祭品概率`,
                typeof table[g].enhancementStone === 'number' &&
                typeof table[g].reforgeTicket === 'number' &&
                typeof table[g].tributeChance === 'number');
        }
    }
    // chest-room-system 的 GRADES 必须覆盖表内全部档（防配置有档、代码不读）
    const chestSrc = fs.readFileSync(path.join(ROOT, 'src/world/chest-room-system.js'), 'utf-8');
    const m = chestSrc.match(/GRADES\s*=\s*\[([^\]]+)\]/);
    const grades = m ? (m[1].match(/'([FEDCBA])'/g) || []).map(s => s.replace(/'/g, '')) : [];
    check('chest-room-system GRADES 覆盖 F~A', ['F', 'E', 'D', 'C', 'B', 'A'].every(g => grades.includes(g)), `实际=[${grades}]`);
}

// ========== 5. equipment.json 音效路径真实存在 ==========
console.log('\n[5] equipment.json 音效路径存在性');
{
    const equip = readJson('data/equipment.json');
    const soundKeys = ['fireSound', 'equipSound', 'reloadSound', 'overheatSound'];
    const bad = [];
    const walk = (node, trail) => {
        if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${trail}[${i}]`)); return; }
        if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) {
                if (soundKeys.includes(k) && typeof v === 'string') {
                    // 音效值允许带中文注释后缀（图鉴展示用），取路径部分校验
                    const p = v.split('（')[0];
                    if (!fs.existsSync(path.join(ROOT, p)) && !fs.existsSync(path.join(ROOT, 'public', p))) {
                        bad.push(`${trail}.${k}=${p}`);
                    }
                } else if (k === 'soundEffects' && v && typeof v === 'object') {
                    for (const [sk, sv] of Object.entries(v)) {
                        const p = String(sv).split('（')[0];
                        if (!fs.existsSync(path.join(ROOT, p)) && !fs.existsSync(path.join(ROOT, 'public', p))) {
                            bad.push(`${trail}.soundEffects.${sk}=${p}`);
                        }
                    }
                } else {
                    walk(v, trail ? `${trail}.${k}` : k);
                }
            }
        }
    };
    for (const [id, item] of Object.entries(equip)) walk(item, id);
    check('全部音效路径真实存在（assets/ 或 public/assets/）', bad.length === 0, bad.join('; '));
}

// ========== 6. 地牢 nodeCount 结构可达性 ==========
console.log('\n[6] 地牢 nodeCount 结构可达性');
{
    // 与 zombie-dungeon.js generate() 同公式（改公式需同步）：
    // branchPlanned = 岔路条数×2.5；gridMin = max(minRoomsToBoss+1, min - branchPlanned)；
    // 网格容量 = 3 + max(scp, minRooms-2, ceil((gridMin-3)/rows))×rows 必须 ≥ gridMin
    const dc = readJson('data/dungeon-config.json');
    const gradeBranches = { F: 2, E: 4, D: 6, C: 8, B: 10, A: 12 };
    const blocks = {
        zombie: 'zombieDungeon', zombieBeginner: 'zombieDungeonBeginner', zombieMid: 'zombieDungeonMid',
        frozenBeginner: 'frozenDungeonBeginner', frozenMid: 'frozenDungeonMid', frozen: 'frozenDungeon',
        swampBeginner: 'swampDungeonBeginner', swampMid: 'swampDungeonMid', swamp: 'swampDungeon'
    };
    for (const [type, key] of Object.entries(blocks)) {
        const cfg = dc[key];
        if (!cfg) { check(`${type} 配置块存在`, false); continue; }
        const rows = cfg.grid.rows;
        const minRooms = cfg.minRoomsToBoss ?? (cfg.shortestCombatPath + 2);
        const grade = (dc.dungeonList[type] && dc.dungeonList[type].grade) || 'D';
        const branchCount = (cfg.chestBranches && cfg.chestBranches.count !== undefined)
            ? cfg.chestBranches.count : (gradeBranches[grade] ?? 6);
        const branchPlanned = Math.round(branchCount * 2.5);
        const gridMin = Math.max(minRooms + 1, cfg.nodeCount.min - branchPlanned);
        const gridMax = Math.max(gridMin, cfg.nodeCount.max - branchPlanned);
        const cols = Math.max(cfg.shortestCombatPath, minRooms - 2, Math.ceil((gridMin - 3) / rows));
        const capacity = 3 + cols * rows;
        check(`${type} 网格容量可达 gridMin（${capacity} ≥ ${gridMin}）`, capacity >= gridMin);
        check(`${type} gridMin ≤ gridMax（${gridMin} ≤ ${gridMax}）`, gridMin <= gridMax);
    }
}

// ========== 7. 经验系统 pacing 闭环 ==========
console.log('\n[7] 经验系统（pacing 闭环/压级衰减/锚定）');
{
    const expSys = await import(pathToFileURL(path.join(ROOT, 'src/config/exp-system.js')));
    const { getDungeonExpBase, getWeightedKills, getBandCost, getMonsterExp, getMonsterEffectiveLevel, getExpDecayMultiplier, computeMaxExp } = expSys;
    const cf = readJson('data/combat-formulas.json');
    const expCfg = cf.enemy.expValue;
    const dc = readJson('data/dungeon-config.json');

    // 升级曲线一致性：computeMaxExp 与 player.expPerLevel 手算一致
    const f = cf.player.expPerLevel;
    check('computeMaxExp(10) 与配置手算一致',
        computeMaxExp(10) === (f.base + 10 * f.levelMultiplier + 10 * f.levelSquareMultiplier) * f.finalMultiplier * f.globalMultiplier);

    // 闭环不变量（方案A 两池拆分）：base×runs×explore×W = (1-share)×段成本；清剿奖×runs×explore×C = share×段成本
    const share = cf.enemy.expValue.roomBonus?.share ?? 0;
    for (const type of Object.keys(dc.dungeonList)) {
        const grade = dc.dungeonList[type].grade;
        const base = getDungeonExpBase(type);
        const W = getWeightedKills(type);
        const cost = getBandCost(grade);
        const rebuilt = base * (expCfg.pacingRuns) * (expCfg.exploreFactor) * W;
        check(`${type}(${grade}) 击杀池闭环 = (1-share)×段成本`, Math.abs(rebuilt - (1 - share) * cost) < 1e-6, `${rebuilt} vs ${(1 - share) * cost}`);
        const bonusRebuilt = expSys.getRoomClearBonus(type) * expCfg.pacingRuns * expCfg.exploreFactor * expSys.getCombatNodeCount(type);
        check(`${type}(${grade}) 清剿奖池闭环 = share×段成本`, Math.abs(bonusRebuilt - share * cost) < 1e-6, `${bonusRebuilt} vs ${share * cost}`);
        check(`${type}(${grade}) 加权击杀 W > 0`, W > 0);
        check(`${type}(${grade}) 战斗节点数 > 0`, expSys.getCombatNodeCount(type) > 0);
    }

    // 连战倍率边界（3 连战起 +15%，每多 1 场 +5%，封顶 1.5）
    check('连战 1~2 场倍率 1', expSys.getStreakMultiplier(1) === 1 && expSys.getStreakMultiplier(2) === 1);
    check('连战 3 场 ×1.15', Math.abs(expSys.getStreakMultiplier(3) - 1.15) < 1e-9);
    check('连战 4 场 ×1.20', Math.abs(expSys.getStreakMultiplier(4) - 1.20) < 1e-9);
    check('连战 5 场 ×1.25', Math.abs(expSys.getStreakMultiplier(5) - 1.25) < 1e-9);
    check('连战封顶 ×1.5', expSys.getStreakMultiplier(20) === 1.5);

    // 各档战斗加权关系（2026-07-28 波次重构的用户验收线）：Boss ≥ 精英战 ≥ 普通战（F 无精英战）
    for (const type of Object.keys(dc.dungeonList)) {
        const w = expSys.getDungeonFightWeights(type);
        check(`${type} Boss战(${w.boss}) ≥ 精英战(${w.elite})`, w.boss >= w.elite);
        check(`${type} Boss战(${w.boss}) ≥ 普通战(${w.normal})`, w.boss >= w.normal);
    }
    // 波次结构：D/C 普通战尾波定刷精英（16=14N+1E）、精英战尾波定刷领主（18=14N+1L）
    {
        const wD = expSys.getDungeonFightWeights('zombie');
        check('D 普通战加权 16（尾波定刷精英）', wD.normal === 16);
        check('D 精英战加权 18（尾波定刷领主）', wD.elite === 18);
        const wF = expSys.getDungeonFightWeights('zombieBeginner');
        check('F Boss 加权 16 > F 普通战 15', wF.boss === 16 && wF.normal === 15);
        const wE = expSys.getDungeonFightWeights('zombieMid');
        check('E Boss 加权 18（尾波定刷领主）', wE.boss === 18);
    }

    // 基础经验量级锚点（手算估值 ±20%，pacingRuns=5.0 + share=0.3 + 波次重构口径）：F≈16 / E≈67 / D≈59 / C≈71
    const anchors = { zombieBeginner: 16, zombieMid: 67, zombie: 59, swamp: 71 };
    for (const [type, expect] of Object.entries(anchors)) {
        const base = getDungeonExpBase(type);
        check(`${type} 基础经验 ≈${expect}（±20%）`, Math.abs(base - expect) / expect <= 0.2, `实际=${base.toFixed(1)}`);
    }

    // 衰减曲线边界
    check('diff ≤ 5 不衰减', getExpDecayMultiplier(10, 5, 'normal') === 1);
    check('diff=6 衰减 0.85', Math.abs(getExpDecayMultiplier(11, 5, 'normal') - 0.85) < 1e-9);
    check('普通怪下限 1%', getExpDecayMultiplier(100, 5, 'normal') === 0.01);
    check('精英下限 3%', getExpDecayMultiplier(100, 5, 'elite') === 0.03);
    check('首领下限 10%', getExpDecayMultiplier(100, 5, 'boss') === 0.10);

    // 越级加成边界（与衰减对称：diff < -5 每级 +10%，封顶 1.5×）
    check('越级 diff=-5 无加成', expSys.getExpLevelMultiplier(5, 10, 'normal') === 1);
    check('越级 diff=-6 加成 1.1×', Math.abs(expSys.getExpLevelMultiplier(4, 10, 'normal') - 1.1) < 1e-9);
    check('越级封顶 1.5×', expSys.getExpLevelMultiplier(1, 100, 'normal') === 1.5);
    check('越级加成 rank 无差别', expSys.getExpLevelMultiplier(1, 100, 'boss') === 1.5);

    // 经验明细 tag（飘字标注）
    check('明细 tag：衰减', expSys.getMonsterExpDetail({ rank: 'normal', level: 3 }, 60, 'zombieBeginner').tag === 'decay');
    check('明细 tag：越级', expSys.getMonsterExpDetail({ rank: 'normal', level: 3 }, 1, 'swamp').tag === 'underdog');
    check('明细 tag：同级无标记', expSys.getMonsterExpDetail({ rank: 'normal', level: 3 }, 3, 'zombieBeginner').tag === null);

    // 锚定等级：单调递增 + 种间偏移保留
    const lv = (t, lvCfg) => getMonsterEffectiveLevel({ level: lvCfg }, t);
    check('锚定等级单调：F<E<D<C', lv('zombieBeginner', 3) < lv('zombieMid', 3) && lv('zombieMid', 3) < lv('zombie', 3) && lv('zombie', 3) < lv('swamp', 3));
    check('种间偏移保留：同级地牢僵尸狗比僵尸低 1 级', lv('zombie', 3) - lv('zombie', 2) === 1);
    check('F 档锚=3（僵尸配置3级→有效3级）', lv('zombieBeginner', 3) === 3);

    // 单怪经验：F 档普通怪 = base × 1（同级无衰减）；高压级衰减到下限
    const e1 = getMonsterExp({ rank: 'normal', level: 3 }, 3, 'zombieBeginner');
    check('F 档普通怪同级经验 = floor(base)', e1 === Math.floor(getDungeonExpBase('zombieBeginner')));
    const e2 = getMonsterExp({ rank: 'normal', level: 3 }, 60, 'zombieBeginner');
    check('60 级刷 F 档普通怪 = 1% 下限', e2 === Math.max(1, Math.floor(getDungeonExpBase('zombieBeginner') * 0.01)));
    const e3 = getMonsterExp({ rank: 'elite', level: 6 }, 12, 'zombie'); // D档锚9+(6-3)=12，同级无倍率
    check('精英怪经验 = base × 2', e3 === Math.floor(getDungeonExpBase('zombie') * 2));

    // 主神空间（无地牢）：回退 F 档
    check('无地牢回退 F 档', getDungeonExpBase(null) === getDungeonExpBase('zombieBeginner'));
}

// ========== 8. 属性成长 ==========
console.log('\n[8] 属性成长');
{
    const expSys = await import(pathToFileURL(path.join(ROOT, 'src/config/exp-system.js')));
    const cf2 = readJson('data/combat-formulas.json');
    const growth = cf2.enemy.monsterGrowth;

    // 配置完整性
    check('monsterGrowth 配置完整', growth && growth.hpPerLevel > 0 && growth.hpPerLevelBoss > 0 && growth.atkPerLevel > 0 && growth.defPerLevel > 0);
    check('首领 hp 系数低于普通（防马拉松）', growth.hpPerLevelBoss < growth.hpPerLevel);

    // 有效等级 = 锚定 + 种间偏移
    const eff = expSys.getMonsterEffectiveLevel({ level: 3 }, 'zombieBeginner');
    check('F 档 lv3 有效等级 = 锚定 3', eff === 3, `实际=${eff}`);
}

// ========== 8. 机枪 -50% 移速口径（V0.311）——减速仅限机枪系，步枪/其他双手枪不得混入 ==========
console.log('\n[8] 机枪移速口径');
{
    const { isMachineGun } = await import('../src/config/attack-formula.js');
    check('isMachineGun：pkm/qjb201/energy_lmg 为机枪', isMachineGun('pkm') && isMachineGun('qjb201') && isMachineGun('energy_lmg'));
    check('isMachineGun：akm/qbz191/shotgun 非机枪', !isMachineGun('akm') && !isMachineGun('qbz191') && !isMachineGun('shotgun'));

    // 运行时减速名单（update.js isPkmEquipped）不得包含 akm/qbz191
    const updSrc = fs.readFileSync(path.join(ROOT, 'src/entities/player/update.js'), 'utf-8');
    const pkmLine = updSrc.split('\n').find(l => l.includes('isPkmEquipped') && l.includes('weaponType'));
    check('运行时减速名单存在', !!pkmLine);
    check('运行时减速名单不含 akm/qbz191', pkmLine && !pkmLine.includes("'akm'") && !pkmLine.includes("'qbz191'"), pkmLine && pkmLine.trim());

    // tooltip -50% 展示必须走 isMachineGun（不再用含步枪的硬编码名单）
    const ttSrc = fs.readFileSync(path.join(ROOT, 'src/ui/equip-tooltip-manager.js'), 'utf-8');
    check('tooltip 减速展示用 isMachineGun', ttSrc.includes('isMachineGun(fullItem.weaponType)'));
    check('tooltip 无步枪硬编码减速名单', !ttSrc.includes("'akm', 'qbz191', 'qjb201'"));
}

// ========== 9. 僵尸/沼泽地牢领主池 family 限定（V0.327）——lord 池必须只含僵尸 family，时空特工不得入池 ==========
console.log('\n[9] 领主池 family 限定');
{
    const zdSrc = fs.readFileSync(path.join(ROOT, 'src/world/zombie-dungeon.js'), 'utf-8');
    // 领主池 getter 必须带 family === '僵尸' 过滤（2026-07-29 前曾跨 family 抽取，时空特工会进领主位）
    const lordGetter = zdSrc.split('get lord()')[1] || '';
    check('lord 池带僵尸 family 过滤', lordGetter.includes("cfg.family === '僵尸'"));
    // 数据层交叉验证：僵尸 family 领主池非空（foremanZombie/shounao/flyHand），特工 family 领主被排除
    const enemyCfg = readJson('data/enemy-config.json');
    const zombieLords = Object.entries(enemyCfg).filter(([, c]) => c.family === '僵尸' && c.rank === 'lord').map(([k]) => k);
    const agentLords = Object.entries(enemyCfg).filter(([, c]) => c.family === '特工' && c.rank === 'lord').map(([k]) => k);
    check('僵尸领主池非空（≥3）', zombieLords.length >= 3, zombieLords.join(','));
    check('特工领主存在但不应入池（仅作存在性核对）', agentLords.length >= 1, agentLords.join(','));
}

// ========== 10. 近期修复防回归（V0.329~V0.331 源码级断言） ==========
console.log('\n[10] 近期修复防回归');
{
    // 门闸候选排除近顶点件（精英房下夹角断口根因修复）
    const crsSrc = fs.readFileSync(path.join(ROOT, 'src/world/combat-room-system.js'), 'utf-8');
    check('_setupGate 含近顶点排除（nearVertex）', crsSrc.includes('const nearVertex = (p) =>'));
    check('_setupGate 近顶点阈值 0.8×瓦长', crsSrc.includes('0.8 * faceLen0'));
    check('_setupGate 门闸锚点沿边回退 8px', crsSrc.includes('/ _segLen * 8'));
    // cleanupRoom 不跳过存活尸体（地牢 map 态计时器冻结，尸体会带进下一房）；
    // cleanupMonstersOnly（波次间同房）必须保留跳过
    const cleanupRoomBody = (crsSrc.split('cleanupRoom() {')[1] || '').split('cleanupMonstersOnly')[0];
    const cleanupWavesBody = (crsSrc.split('cleanupMonstersOnly() {')[1] || '').split('_restoreSceneState')[0];
    check('cleanupRoom 无 isPreservedCorpse 跳过', !cleanupRoomBody.includes('isPreservedCorpse'));
    check('cleanupMonstersOnly 保留 isPreservedCorpse 跳过', cleanupWavesBody.includes('isPreservedCorpse'));

    // 宝箱房门墙深度=门洞中心底边 y（"墙看底边 max、门看门洞中心"定案）；直墙仍为整墙 max
    const chestSrc = fs.readFileSync(path.join(ROOT, 'src/world/chest-room-system.js'), 'utf-8');
    check('宝箱房门墙深度=门洞中心底边 y', chestSrc.includes('const gateDepth = (g1.y + g2.y) / 2;'));
    check('宝箱房直墙深度=整块墙 min/max 底边', chestSrc.includes("mode === 'min' ? Math.min(ay, by) : Math.max(ay, by)"));

    // 主神空间状态缓存：depart 清实体前 + Game.init 末尾都必须保存
    const expSrc = fs.readFileSync(path.join(ROOT, 'src/ui/expedition-system.js'), 'utf-8');
    const departBody = (expSrc.split('depart() {')[1] || '').split('returnToMain')[0];
    check('depart() 调 _saveMainSceneState', departBody.includes('_saveMainSceneState'));
    const gameSrc = fs.readFileSync(path.join(ROOT, 'src/game.js'), 'utf-8');
    check('Game.init 末尾调 _saveMainSceneState', gameSrc.includes('SceneManager._saveMainSceneState()'));
    // _saveMainSceneState 不再保存误导性死状态（树木/特效/相机不恢复）
    const smSrc = fs.readFileSync(path.join(ROOT, 'src/world/scene-manager.js'), 'utf-8');
    const saveBody = (smSrc.split('_saveMainSceneState() {')[1] || '').split('_resolveWorldSize')[0];
    check('_saveMainSceneState 无 _mainTrees/_mainEffects/_mainCamera 死状态',
        !saveBody.includes('_mainTrees') && !saveBody.includes('_mainEffects') && !saveBody.includes('_mainCamera'));
}

// ========== 11. 距离衰减音量（SoundManager 位置音效） ==========
console.log('\n[11] 距离衰减音量');
{
    const { SoundManager } = await import(pathToFileURL(path.join(ROOT, 'src/ui/sound-manager.js')));
    const cfg = { base: 0.5, max: 1.5, nearDist: 150, farDist: 600, maxDist: 2000 };

    check('贴近（d=0）音量=最大值 1.5', SoundManager.computeDistanceVolume(0, cfg) === 1.5);
    check('nearDist 内音量=最大值', SoundManager.computeDistanceVolume(150, cfg) === 1.5);
    check('farDist 处音量=base 0.5', SoundManager.computeDistanceVolume(600, cfg) === 0.5);
    const mid = SoundManager.computeDistanceVolume(1300, cfg);
    check('far→maxDist 中点=base 一半', Math.abs(mid - 0.25) < 1e-9, `got ${mid}`);
    check('maxDist 处音量=0', SoundManager.computeDistanceVolume(2000, cfg) === 0);
    check('超出 maxDist 音量=0', SoundManager.computeDistanceVolume(2600, cfg) === 0);
    const seq = [0, 100, 300, 600, 1200, 2000, 2600].map(d => SoundManager.computeDistanceVolume(d, cfg));
    check('音量随距离单调不增', seq.every((v, i) => i === 0 || v <= seq[i - 1] + 1e-12), seq.join(','));
    check('maxDist=0 显式关闭衰减段时远端保持 base（兼容旧行为）', SoundManager.computeDistanceVolume(99999, { base: 0.5, max: 1.5, nearDist: 150, farDist: 600, maxDist: 0 }) === 0.5);

    check('distanceGain 近端=1', SoundManager.distanceGain(0, { maxDist: 2000 }) === 1);
    check('distanceGain 远端=0', SoundManager.distanceGain(2000, { maxDist: 2000 }) === 0);
    check('distanceGain 超距=0', SoundManager.distanceGain(3000, { maxDist: 2000 }) === 0);

    // flySwarm 配置双份一致且静音距离 = 2000
    const flyA = readJson('data/enemy-config.json').flySwarm.sounds;
    const flyB = readJson('public/data/enemy-config.json').flySwarm.sounds;
    check('flySwarm.loopMaxDist=2000（双份）', flyA.loopMaxDist === 2000 && flyB.loopMaxDist === 2000, `data=${flyA.loopMaxDist} public=${flyB.loopMaxDist}`);
    check('flySwarm.sounds 含全部衰减键（双份一致）',
        flyA.loopVolumeBase === flyB.loopVolumeBase && flyA.loopVolumeMax === flyB.loopVolumeMax &&
        flyA.loopNearDist === flyB.loopNearDist && flyA.loopFarDist === flyB.loopFarDist &&
        flyA.loopMaxDist === flyB.loopMaxDist && flyA.loopCrossfadeSec === flyB.loopCrossfadeSec);
}

// ========== 12. 主音量设置（clamp + 实时作用于循环音轨） ==========
console.log('\n[12] 主音量设置');
{
    const { SoundManager } = await import(pathToFileURL(path.join(ROOT, 'src/ui/sound-manager.js')));
    const saved = SoundManager.masterVolume;
    SoundManager.setVolume(0.5);
    check('setVolume(0.5) 生效', SoundManager.masterVolume === 0.5);
    SoundManager.setVolume(1.5);
    check('setVolume 上限 clamp 到 1', SoundManager.masterVolume === 1);
    SoundManager.setVolume(-1);
    check('setVolume 下限 clamp 到 0', SoundManager.masterVolume === 0);

    // 循环音轨 gain 实时联动（BGM/环境音改主音量立即生效）
    const fakeLoop = { volume: 0.7, gain: { gain: { value: 0.7 } } };
    SoundManager._loops = { test: fakeLoop };
    SoundManager.setVolume(0.5);
    check('循环音轨 gain 实时 = volume×master（0.35）', Math.abs(fakeLoop.gain.gain.value - 0.35) < 1e-9, `got ${fakeLoop.gain.gain.value}`);
    delete SoundManager._loops;
    SoundManager.masterVolume = saved;
}

// ========== 13. 技能效果缓存（getEffect 按等级复用，防每帧热路径重复求值） ==========
console.log('\n[13] 技能效果缓存');
{
    const { DataLoader } = await import(pathToFileURL(path.join(ROOT, 'src/systems/data-loader.js')));
    const skill = DataLoader.buildSkillFromJSON('testSkill', {
        name: '测试技能',
        maxLevel: 5,
        effectFormula: { a: 'level * 2', b: 10 },
    });
    const e3a = skill.getEffect(3);
    const e3b = skill.getEffect(3);
    check('同等级返回同一缓存对象', e3a === e3b);
    check('求值正确（a=level×2, b=10）', e3a.a === 6 && e3a.b === 10);
    const e4 = skill.getEffect(4);
    check('不同等级重新求值', e4 !== e3a && e4.a === 8);
    check('缓存按等级切换回旧值仍正确', skill.getEffect(3).a === 6);
}

// ========== 14. 技能公式求值器边界 ==========
console.log('\n[14] 技能公式求值器');
{
    const { DataLoader } = await import(pathToFileURL(path.join(ROOT, 'src/systems/data-loader.js')));
    const f = (expr, level = 1) => DataLoader.parseSkillFormula(expr, level);

    check('基础四则+括号', f('2 + 3 * 4', 1) === 14);
    check('除零返回 0', f('1 / 0', 1) === 0);
    check('level 代入', f('10 + level * 2', 5) === 20);
    check('前导小数点 .5', f('.5 + 1', 1) === 1.5);
    check('一元负号开头', f('-5 + 2', 1) === -3);
    check('二元后一元负号', f('5 + -3', 1) === 2);
    check('括号前一元负号', f('-(2 + 3)', 1) === -5);
    check('乘法后一元负号', f('2 * -3', 1) === -6);
    check('Math.round 单参', f('Math.round(1600 / 1.5)', 1) === 1067);
    check('Math.floor + level', f('2 + Math.floor((level - 1) / 5)', 6) === 3);
    check('Math.PI 常量', Math.abs(f('2 * Math.PI / 3', 1) - 2.0944) < 0.001);
    check('非法字符返回 0', f('5 + evil', 1) === 0);
    check('多参 Math 被白名单拒绝返回 0', f('Math.max(1, 2)', 1) === 0);
    check('数字直接透传', f(42, 1) === 42);
    check('空串返回 0', f('', 1) === 0);

    // 真实技能公式抽样（升级曲线不被 parser 改动影响）
    const skillsData = readJson('data/skills.json').skills;
    const iceSpike = DataLoader.buildSkillFromJSON('iceSpike', skillsData.iceSpike);
    check('iceSpike.spikeCount L1=2', iceSpike.getEffect(1).spikeCount === 2);
    check('iceSpike.spikeCount L6=3', iceSpike.getEffect(6).spikeCount === 3);
    check('iceSpike.spikeCount L11=4', iceSpike.getEffect(11).spikeCount === 4);
    const holyLight = DataLoader.buildSkillFromJSON('holyLight', skillsData.holyLight);
    check('holyLight.cooldown L1=10', holyLight.getEffect(1).cooldown === 10);
    check('holyLight.cooldown L6=9', holyLight.getEffect(6).cooldown === 9);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
