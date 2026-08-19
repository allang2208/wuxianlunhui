/**
 * 世界-122 后台抽象结算（M1）功能回归：
 * 产兵计时/采矿仓储/读条完成/波次战报/败北/胜利发奖/预览无副作用。
 * world122-sim.js 为纯数据模块（无 Game 依赖），可直接 Node 单测。
 */
import { settleWorld122, WORLD122_SIM } from '../src/world/world122-sim.js';
import { resetAbilityLevels, getAbilityLevel } from '../src/world/ability-store.js';
import { resetUnitUpgrades } from '../src/world/unit-upgrade-store.js';

let pass = 0;
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (condition) pass++; else fail++;
}

const SIM_CFG = {
    prepMs: 30000, waveBreakMs: 10000, victoryWave: 10,
    victoryReward: { gold: 500, energy: 500 },
    waveBudgetBase: 26, waveBudgetGrowth: 1.15, hpPerWave: 0.16, atkPerWave: 0.08,
};

function makeSnap(overrides = {}) {
    return {
        version: 1,
        capturedAt: Date.now(),
        config: { ...SIM_CFG },
        base: { hp: 5000 },
        wave: { wave: 0, phase: 'prep', phaseTimer: 30000, victory: false },
        structures: [],
        nodes: [],
        ...overrides,
    };
}

// ---- 1. 产兵结算：兵营 45s/个、cap 5、读条余量保留 ----
{
    const snap = makeSnap({
        structures: [{ kind: 'barracks', x: 0, y: 0, hp: 2000, unitType: 'warrior', spawnTimer: 10000, units: 2 }],
    });
    const r = settleWorld122(snap, 120000);
    const b = snap.structures[0];
    check('产兵：120s 内 2→5（45s/个，cap 5 停止）', b.units === 5 && r.unitsProduced === 3);
    check('产兵满员后计时器回满周期', b.spawnTimer === 45000);
}

// ---- 2. 采矿 + 仓储封顶 + 矿点枯竭 ----
{
    const snap = makeSnap({
        structures: [
            { kind: 'hut', x: 0, y: 0, hp: 1500, modules: {}, miners: 2, respawnTimer: 0, storedEnergy: 0 },
            { kind: 'producer', cfgKey: 'warehouse', x: 0, y: 0, hp: 2500, storedEnergy: 0, unitType: '', units: 0 },
        ],
        nodes: [{ x: 0, y: 0, hp: 3000, maxHp: 3000, depleted: false, respawnTimer: 0, variant: 1 }],
    });
    const r = settleWorld122(snap, 60000);
    const wh = snap.structures[1];
    check('采矿：2 矿工 × 25 能源/s × 60s = 3000 入仓', Math.round(r.energyMined) === 3000 && wh.storedEnergy === 3000);
    check('矿点采空即枯竭并开始重生计时', snap.nodes[0].depleted === true && snap.nodes[0].respawnTimer > 0);
}

// ---- 3. 读条完成：研究升级 + 被动能源入仓 ----
{
    resetAbilityLevels();
    const snap = makeSnap({
        structures: [
            { kind: 'producer', cfgKey: 'research_institute', x: 0, y: 0, hp: 2200, unitType: '', units: 0,
              upgrade: { abilityId: 'research_passive_energy', totalMs: 60000, remainMs: 30000 }, continuous: null },
            { kind: 'producer', cfgKey: 'warehouse', x: 0, y: 0, hp: 2500, storedEnergy: 0, unitType: '', units: 0 },
        ],
    });
    const r = settleWorld122(snap, 60000);
    check('读条完成并升全局等级', r.abilitiesCompleted.includes('research_passive_energy')
        && getAbilityLevel('research_passive_energy') === 1);
    const wh = snap.structures[1];
    check('被动能源按秒入仓（60s × 1/s = 60）', r.passiveEnergy === 60 && wh.storedEnergy === 60);
    resetAbilityLevels();
}

// ---- 4. 波次清剿 + 墙先承伤 + 波次推进 ----
{
    const snap = makeSnap({
        structures: [
            { kind: 'block', x: 0, y: 0, hp: 1600, grade: 'C' },
            { kind: 'tower', x: 0, y: 0, hp: 99999, dps: 500 },
        ],
    });
    const r = settleWorld122(snap, 195000);
    check('195s 推进：清 5 波、第 6 波进行中（progressSec 部分累计）', r.wavesCleared.join(',') === '1,2,3,4,5'
        && snap.wave.wave === 6 && snap.wave.phase === 'wave' && (snap.wave.progressSec || 0) > 0);
    check('墙先承伤被摧毁、塔存活承余波、基地未受损',
        snap.structures[0].hp === 0 && r.structuresLost >= 1
        && snap.structures[1].hp > 0 && snap.structures[1].hp < 99999
        && snap.base.hp === 5000 && r.defeated === false);
}

// ---- 5. 无防守 → 败北 ----
{
    const snap = makeSnap();
    const r = settleWorld122(snap, 300000);
    check('无防守输出时基地被推平 → defeated', r.defeated === true && snap.base.hp <= 0);
}

// ---- 5b. 防守塔全毁后波次停摆（每波重算 DPS，防线被拆则卡住待玩家） ----
{
    const snap = makeSnap({
        structures: [{ kind: 'tower', x: 0, y: 0, hp: 1400, dps: 500 }],
    });
    const r = settleWorld122(snap, 150000);
    check('塔毁后 DPS 归零、波次卡住、基地受损但未必灭',
        r.defeated === false && snap.wave.phase === 'wave'
        && snap.structures[0].hp === 0 && snap.base.hp < 5000 && snap.base.hp > 0);
}

// ---- 6. 预览无副作用（世界切换面板口径） ----
{
    resetAbilityLevels();
    const snap = makeSnap({
        structures: [
            { kind: 'tower', x: 0, y: 0, hp: 1400, dps: 500 },
            { kind: 'producer', cfgKey: 'research_institute', x: 0, y: 0, hp: 2200, unitType: '', units: 0,
              upgrade: { abilityId: 'research_structure_hp', totalMs: 60000, remainMs: 1000 }, continuous: null },
        ],
    });
    const before = JSON.stringify(snap);
    const r = settleWorld122(snap, 195000, { commit: false });
    check('预览产生战报但不改快照、不升全局等级',
        r.wavesCleared.length > 0 && JSON.stringify(snap) === before
        && getAbilityLevel('research_structure_hp') === 0);
    resetAbilityLevels();
}

// ---- 7. 胜利发奖且只发一次（金币走 grant 回调，能源入快照仓库） ----
{
    const snap = makeSnap({
        wave: { wave: 9, phase: 'break', phaseTimer: 0, victory: false },
        structures: [
            { kind: 'tower', x: 0, y: 0, hp: 1400, dps: 9999 },
            { kind: 'producer', cfgKey: 'warehouse', x: 0, y: 0, hp: 2500, storedEnergy: 0, unitType: '', units: 0 },
        ],
    });
    let granted = [];
    const grant = (reward) => granted.push(reward);
    const r1 = settleWorld122(snap, 60000, { grant });
    check('清第 10 波 → 胜利：金币走回调、能源入快照仓库', r1.victory === true
        && granted.length === 1 && granted[0].gold === 500
        && snap.structures[1].storedEnergy === 500);
    const r2 = settleWorld122(snap, 60000, { grant });
    check('已胜利世界重复结算不再发奖', r2.victory === false && granted.length === 1);
}

// ---- 8. 估算常量口径锁定（波次成长曲线可复算） ----
check('估算常量齐备（HP/TP、怪均 DPS、接触系数、清波耗时窗）',
    WORLD122_SIM.tpHpAvg > 0 && WORLD122_SIM.monsterDpsPer > 0
    && WORLD122_SIM.contactFraction > 0 && WORLD122_SIM.contactFraction < 1
    && WORLD122_SIM.waveTimeMin > 0 && WORLD122_SIM.waveTimeMax > WORLD122_SIM.waveTimeMin);

// ---- 9. 增量 tick 与一次性结算等价（M2 驱动口径） ----
{
    const mk = () => makeSnap({
        structures: [
            { kind: 'block', x: 0, y: 0, hp: 1600, grade: 'C' },
            { kind: 'tower', x: 0, y: 0, hp: 1400, dps: 500 },
            { kind: 'barracks', x: 0, y: 0, hp: 2000, unitType: 'warrior', spawnTimer: 10000, units: 2 },
        ],
    });
    const oneShot = mk();
    const ticked = mk();
    settleWorld122(oneShot, 180000);
    for (let i = 0; i < 6; i++) settleWorld122(ticked, 30000);
    check('6×30s tick ≈ 180s 一次性（波次/产兵/承伤一致）',
        ticked.wave.wave === oneShot.wave.wave
        && ticked.wave.phase === oneShot.wave.phase
        && ticked.structures[0].hp === oneShot.structures[0].hp
        && ticked.structures[1].hp === oneShot.structures[1].hp
        && ticked.structures[2].units === oneShot.structures[2].units);
}

// ---- 10. 波次进度跨 tick 累计（不清波也推进 progressSec） ----
{
    const snap = makeSnap({
        wave: { wave: 1, phase: 'wave', phaseTimer: 0, victory: false },
        structures: [{ kind: 'tower', x: 0, y: 0, hp: 1400, dps: 50 }],
    });
    settleWorld122(snap, 5000);
    const p1 = snap.wave.progressSec || 0;
    settleWorld122(snap, 5000);
    check('波次进度跨 tick 累计（两次 5s > 一次 5s）',
        (snap.wave.progressSec || 0) > p1 && snap.wave.phase === 'wave');
    let guard = 100;
    while (snap.wave.phase === 'wave' && guard-- > 0) settleWorld122(snap, 5000);
    check('累计到清波时间后清波并推进', snap.wave.wave === 1 && snap.wave.phase === 'break');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
