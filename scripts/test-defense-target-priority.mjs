/**
 * 世界-122 防守怪统一目标优先级回归：
 * 距离档位优先；同档 仓鼠 > 玩家队友 > 玩家 > 建筑 > 基地；
 * 本地无目标时回退远结构，结构全灭后回退远单位。
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFENSE_TARGET_TYPE,
    classifyDefenseTarget,
    pickDefensePriorityTarget,
    shouldSwitchDefenseTarget,
} from '../src/ai/defense-target-priority.js';
import { PerceptionSystem } from '../src/systems/perception-system.js';
import { WallSystem } from '../src/world/wall-system.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`); }
}

function target(id, x, type, extra = {}) {
    const out = {
        id, x, y: 0, active: true, hp: 100, maxHp: 100, hittable: true,
        collisionRadius: 0, collider: { x, y: 0, radius: 0 },
        ...extra,
    };
    if (type === 'hamster') Object.assign(out, { _faction: 'companion', _enemyTargetable: true, _isHamsterWarrior: true });
    if (type === 'party') Object.assign(out, { _faction: 'companion', _enemyTargetable: true, _isPartyCompanion: true });
    if (type === 'player') Object.assign(out, { _faction: 'player' });
    if (type === 'building') Object.assign(out, { _faction: 'player', _isDefenseStructure: true });
    if (type === 'base') Object.assign(out, { _faction: 'player', _isDefenseStructure: true, _isDefenseBase: true });
    return out;
}

function monster(extra = {}) {
    return {
        id: 'monster', x: 0, y: 0, active: true, hp: 100,
        _preferDefenseTargets: true, _defenseMonster: true,
        _engageHostileRange: 320, _alertRange: 9000,
        attackRange: 70, target: null,
        ...extra,
    };
}

check('目标分类顺序完整',
    classifyDefenseTarget(target('h', 0, 'hamster')) === DEFENSE_TARGET_TYPE.HAMSTER
    && classifyDefenseTarget(target('c', 0, 'party')) === DEFENSE_TARGET_TYPE.PARTY
    && classifyDefenseTarget(target('p', 0, 'player')) === DEFENSE_TARGET_TYPE.PLAYER
    && classifyDefenseTarget(target('b', 0, 'building')) === DEFENSE_TARGET_TYPE.BUILDING
    && classifyDefenseTarget(target('base', 0, 'base')) === DEFENSE_TARGET_TYPE.BASE);

{
    const m = monster();
    const hamster = target('hamster', 50, 'hamster');
    const player = target('player', 90, 'player');
    check('同一距离档位仓鼠优先于玩家',
        pickDefensePriorityTarget(m, [hamster, player]).target === hamster);
}
{
    const m = monster();
    const player = target('player', 20, 'player');
    const hamster = target('hamster', 150, 'hamster');
    check('距离档位优先：更近玩家胜过更远仓鼠',
        pickDefensePriorityTarget(m, [player, hamster]).target === player);
}
{
    const m = monster();
    const hamster = target('hamster', 100, 'hamster');
    const wall = target('wall', 80, 'building');
    check('同档仓鼠优先于普通建筑',
        pickDefensePriorityTarget(m, [hamster, wall]).target === hamster);
}
{
    const m = monster();
    const wall = target('wall', 20, 'building');
    const hamster = target('hamster', 180, 'hamster');
    check('距离档位优先：贴身建筑胜过更远仓鼠',
        pickDefensePriorityTarget(m, [wall, hamster]).target === wall);
}
{
    const m = monster();
    const party = target('party', 80, 'party');
    const player = target('player', 60, 'player');
    check('同档玩家队友优先于玩家',
        pickDefensePriorityTarget(m, [party, player]).target === party);
}
{
    const m = monster();
    const building = target('building', 500, 'building');
    const base = target('base', 490, 'base');
    const pick = pickDefensePriorityTarget(m, [building, base]);
    check('本地无目标时回退远处结构，同档普通建筑优先基地',
        pick.scope === 'strategic' && pick.target === building);
}
{
    const m = monster();
    const farParty = target('party', 900, 'party');
    const pick = pickDefensePriorityTarget(m, [farParty]);
    check('结构全部消失后回退搜索远处玩家单位',
        pick.scope === 'far-unit' && pick.target === farParty);
}
{
    const m = monster();
    const farParty = target('party', 900, 'party');
    check('当前仍有有效结构目标时禁止误触发远单位最终兜底',
        pickDefensePriorityTarget(m, [farParty], { allowFarUnitFallback: false }) === null);
}
{
    const m = monster();
    const fullWall = target('full', 40, 'building', { _attackSlots: 1 });
    const hamster = target('hamster', 80, 'hamster');
    const occ = new Map([[fullWall, 1]]);
    check('结构满载时选择同档可攻击单位',
        pickDefensePriorityTarget(m, [fullWall, hamster], { occupancy: occ }).target === hamster);
}
{
    const m = monster();
    const farBuilding = target('building', 7000, 'building');
    const hamster = target('hamster', 20, 'hamster');
    const candidate = pickDefensePriorityTarget(m, [farBuilding, hamster], { exclude: farBuilding });
    check('远建筑当前目标遇到本地仓鼠会切换',
        shouldSwitchDefenseTarget(m, farBuilding, candidate));
}
{
    const m = monster();
    const wall = target('wall', 20, 'building');
    const hamster = target('hamster', 180, 'hamster');
    const candidate = pickDefensePriorityTarget(m, [wall, hamster], { exclude: wall });
    check('更近建筑不会被更远仓鼠越级抢走',
        !shouldSwitchDefenseTarget(m, wall, candidate));
}

// 真实 PerceptionSystem 最小场景：验证原 bug（近仓鼠输远基地）已反转。
{
    const oldWalls = WallSystem.walls;
    const oldSegs = WallSystem.isoSegments;
    const oldTrees = WallSystem.trees;
    WallSystem.walls = [];
    WallSystem.isoSegments = [];
    WallSystem.trees = [];
    const m = monster({ name: 'probe' });
    PerceptionSystem._ensurePerceptionState(m);
    const hamster = target('hamster', 20, 'hamster');
    const base = target('base', 7000, 'base');
    const entities = new Map([['m', m], ['h', hamster], ['b', base]]);
    check('真实感知：20px仓鼠胜过7000px基地',
        PerceptionSystem._findBestTarget(m, entities) === hamster);
    WallSystem.walls = oldWalls;
    WallSystem.isoSegments = oldSegs;
    WallSystem.trees = oldTrees;
}

const enemySrc = fs.readFileSync(path.join(ROOT, 'src/entities/enemy.js'), 'utf8');
const moveSrc = fs.readFileSync(path.join(ROOT, 'src/systems/movement-system.js'), 'utf8');
const companionSrc = fs.readFileSync(path.join(ROOT, 'src/entities/companion.js'), 'utf8');
check('黑狼自管AI复用统一防守目标选择器',
    /pickDefensePriorityTarget\(this, arr\)/.test(enemySrc));
check('开门追击复用统一目标比较器',
    /cands\.sort\(\(a, b\) => compareDefenseTargets\(enemy, a, b\)\)/.test(moveSrc));
check('正式玩家队友具备可锁定、可受击和HP统一入口',
    /this\._isPartyCompanion = true/.test(companionSrc)
    && /this\._enemyTargetable = true/.test(companionSrc)
    && /this\.hittable = true/.test(companionSrc)
    && /get hp\(\)/.test(companionSrc)
    && /get maxHp\(\)/.test(companionSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
