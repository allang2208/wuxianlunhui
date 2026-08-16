/**
 * 世界-122 防守怪目标分摊契约测试（2026-08-16）
 *
 * 规则：防守怪选结构目标时按「结构同时攻击上限」感知拥挤度，把溢出怪分摊到
 * 附近低占用的第二结构；正在攻击距离内的怪保持不换目标。
 *
 * 用法：node scripts/test-defense-targeting.mjs
 */
import {
    DEFAULT_ATTACK_SLOTS,
    MIN_CONSIDER_RANGE,
    effectiveAttackRange,
    attackSlotsOf,
    considerRangeFor,
    computeStructureOccupancy,
    pickStructureTarget,
} from '../src/ai/defense-targeting.js';
import { WallSystem } from '../src/world/wall-system.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  OK ${name}${detail ? `：${detail}` : ''}`); }
    else { fail++; console.error(`  FAIL ${name}${detail ? `：${detail}` : ''}`); }
}

function monster(x, y, target) {
    return {
        x, y,
        active: true,
        hp: 100,
        attackRange: 70,
        _preferDefenseTargets: true,
        _defenseMonster: true,
        target: target || null,
    };
}

function structure(x, y, extra = {}) {
    return {
        x, y,
        active: true,
        hp: 1000,
        _isDefenseStructure: true,
        _faction: 'player',
        ...extra,
    };
}

// 1. 基础工具
check('attackSlotsOf 默认 3', attackSlotsOf(structure(0, 0)) === DEFAULT_ATTACK_SLOTS);
check('attackSlotsOf 读取 _attackSlots 覆盖', attackSlotsOf(structure(0, 0, { _attackSlots: 6 })) === 6);
check('effectiveAttackRange 优先 attackDistance', effectiveAttackRange({ attackDistance: 100, attackRange: 70 }) === 100);
check('effectiveAttackRange 回退 attackRange×1.15', effectiveAttackRange({ attackRange: 70 }) === 80.5);
check('considerRangeFor 不小于 420', considerRangeFor({ attackRange: 70 }) >= MIN_CONSIDER_RANGE);
check('considerRangeFor 随射程放大', considerRangeFor({ attackDistance: 930 }) > considerRangeFor({ attackRange: 70 }));

// 2. 占用表：只统计防守怪，且只统计 target 是存活结构
{
    const base = structure(0, 0);
    const cover = structure(200, 0);
    const m1 = monster(10, 0, base);
    const m2 = monster(20, 0, base);
    const m3 = monster(30, 0, cover);
    const idle = monster(40, 0, null);
    const enemy = monster(50, 0, base);
    enemy._preferDefenseTargets = false;
    enemy._defenseMonster = false; // 非防守怪不计入
    const dead = monster(60, 0, base);
    dead.active = false;
    const occ = computeStructureOccupancy([m1, m2, m3, idle, enemy, dead]);
    check('占用表：base=2', occ.get(base) === 2);
    check('占用表：cover=1', occ.get(cover) === 1);
    check('占用表：非防守怪/死怪不计入', occ.size === 2);
}

// 3. 全部空闲 → 选最近
{
    const far = structure(500, 0);
    const near = structure(100, 0);
    const m = monster(0, 0);
    const pick = pickStructureTarget(m, [near, far]);
    check('全空闲选最近', pick && pick.target === near, `dist=${pick && pick.dist}`);
}

// 4. 最近结构超容量且够不着（射程外）、附近有空闲 → 选空闲第二目标
{
    const base = structure(0, 0, { _attackSlots: 2 });
    const cover = structure(150, 0);
    const crowd = [monster(10, 0, base), monster(20, 0, base)];
    const m = monster(300, 0, base); // 距 base 300 > 攻击距离+120，且 base 已满
    const pick = pickStructureTarget(m, [base, cover, ...crowd]);
    check('超容量转空闲第二目标', pick && pick.target === cover, `occ=${pick && pick.occ}`);
}

// 5. 当前目标在攻击距离内 → 即使超容量也保持（正在输出）
{
    const base = structure(0, 0, { _attackSlots: 1 });
    const cover = structure(300, 0);
    const crowd = [monster(5, 0, base)];
    const m = monster(20, 0, base); // 距 base 20 < 攻击距离 80.5
    const pick = pickStructureTarget(m, [base, cover, ...crowd]);
    check('攻击距离内保持当前', pick && pick.target === base);
}

// 6. 当前目标未超容量且在考虑范围内 → 保持（防抖）
{
    const base = structure(0, 0, { _attackSlots: 3 });
    const cover = structure(300, 0);
    const m = monster(100, 0, base); // 距 base 100，覆盖范围 420 内，占用 0 < 3
    const pick = pickStructureTarget(m, [base, cover]);
    check('未超容量保持当前', pick && pick.target === base);
}

// 7. 当前目标超容量且出攻击距离 → 换附近空闲
{
    const base = structure(0, 0, { _attackSlots: 1 });
    const cover = structure(200, 0);
    const crowd = [monster(5, 0, base)];
    const m = monster(220, 0, base); // 距 base 220 > 攻击距离+120，且 base 已满
    const pick = pickStructureTarget(m, [base, cover, ...crowd]);
    check('超容量且够不着换目标', pick && pick.target === cover, `target occ=${pick && pick.occ}`);
}

// 8. 考虑范围内无候选 → null（调用方回退最近结构）
{
    const base = structure(1000, 0);
    const m = monster(0, 0, base);
    const pick = pickStructureTarget(m, [base]);
    check('超范围无候选返回 null', pick === null);
}

// 9. 占用最少优先（都不超容量时距离优先，超容量时占用优先）
{
    const far = structure(300, 0, { _attackSlots: 1 });
    const near = structure(100, 0, { _attackSlots: 1 });
    const crowd = [monster(10, 0, near)];
    const m = monster(0, 0);
    const pick = pickStructureTarget(m, [near, far, ...crowd]);
check('近目标已满 → 选远但空闲', pick && pick.target === far, `dist=${pick && pick.dist} occ=${pick && pick.occ}`);
}

// 10. 保持仅当真够得着（形状距离 ≤ 攻击距离）：够不着且超容量 → 换目标
{
    const base = structure(300, 0, { _attackSlots: 1, collisionRadius: 50 });
    const cover = structure(150, 0, { collisionRadius: 26 });
    const crowd = [monster(280, 0, base), monster(290, 0, base)];
    const m = monster(0, 0, base); // 形状距离 300-50=250 > 80.5，且 base 已满
    const pick = pickStructureTarget(m, [base, cover, ...crowd]);
    check('够不着且超容量 → 换可达掩体', pick && pick.target === cover, `target occ=${pick && pick.occ}`);
    // 同场景但形状距离在射程内（贴脸正在打）→ 即使超容量也保持
    const m2 = monster(60, 0, base); // 形状距离 240? 仍超；改用贴脸场景
    const base2 = structure(60, 0, { _attackSlots: 1, collisionRadius: 50 });
    const m3 = monster(60, 0, base2); // 形状距离 10 ≤ 80.5 → 正在输出
    const pick3 = pickStructureTarget(m3, [base2, cover, ...crowd.map((c) => ({ ...c }))]);
    check('贴脸正在打（形状距离≤射程）→ 保持不抢', pick3 && pick3.target === base2);
}

// 11. 可达性：被墙挡住的候选不选（挑墙另一侧的目标会继续顶墙）
{
    WallSystem.walls = [];
    WallSystem.isoSegments = [];
    // 一堵竖向墙挡在怪与 coverA 之间；coverB 在无遮挡方向
    WallSystem.isoSegments.push({ x1: 50, y1: -200, x2: 50, y2: 200, halfThick: 26 });
    const coverA = structure(120, 0, { collisionRadius: 26 });
    const coverB = structure(0, 150, { collisionRadius: 26 });
    coverA._coverSeg = { x1: 32, y1: -21, x2: 208, y2: -108, halfThick: 26, _cover: true, _owner: coverA };
    coverB._coverSeg = { x1: -88, y1: 129, x2: 88, y2: 42, halfThick: 26, _cover: true, _owner: coverB };
    const m = monster(0, 0);
    const pick = pickStructureTarget(m, [coverA, coverB]);
    check('墙另一侧的候选被排除（选可达的 coverB）', pick && pick.target === coverB,
        `got=${pick && (pick.target.name || pick.target.id)}`);
    WallSystem.walls = [];
    WallSystem.isoSegments = [];
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
