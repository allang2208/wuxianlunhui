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
 * （package.json test 脚本若引用本文件需带 --import；直接 node 运行也可，JSON 走 fs 读取）
 */
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
    const directorStub = { resolveComposition: (comp) => comp.map(() => factoryStub) };

    // _updateLabel 需要 document
    globalThis.document = {
        createElement: () => ({ style: {}, textContent: '', remove() {} }),
        body: { appendChild() {} },
    };

    const build = new Function('DungeonConfig', 'createTimeAgentAssault', 'EncounterDirector', 'invasionConfig',
        `${src}; return AgentInvasionSystem;`);
    const AIS = build(DungeonConfigStub, factoryStub, directorStub, invasionConfig);

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
    const AIS2 = build(DungeonConfigStub, factoryStub, directorStub, invasionConfig);
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

// ========== 4. 宝箱奖励表 F~A 全档 ==========
console.log('\n[4] 宝箱奖励表完整性');
{
    const cf = readJson('data/combat-formulas.json');
    const table = cf.universalEventRewards && cf.universalEventRewards.treasureChest;
    check('treasureChest 表存在', !!table);
    for (const g of ['F', 'E', 'D', 'C', 'B', 'A']) {
        check(`treasureChest 含 ${g} 档`, !!(table && table[g]));
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
    const blocks = { zombie: 'zombieDungeon', zombieBeginner: 'zombieDungeonBeginner', zombieMid: 'zombieDungeonMid', swamp: 'swampDungeon' };
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

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
