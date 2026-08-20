/**
 * 友军六维、激励修饰器、所属建筑清理与能力上限契约。
 * 用法：node --import ./scripts/register-json-loader.mjs scripts/test-friendly-combat-contract.mjs
 */
await import('./register-json-loader.mjs');
const { default: cfg } = await import('../data/hamster-light-cavalry-config.json');
const { Companion } = await import('../src/entities/companion.js');
const {
    getAbilityLevel, raiseAbilityLevel, resetAbilityLevels,
} = await import('../src/world/ability-store.js');

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? `：${detail}` : ''}`);
    if (condition) pass++; else fail++;
}

const unit = new Companion(cfg);
const target = { data: { critRes: 999 } };
const originalRandom = Math.random;
Math.random = () => 1;
check('初始六维下配置伤害保持60',
    unit.getPhysicalAttackDamage(60, target) === 60);
unit.data.atk *= 2;
check('物攻翻倍后实际攻击同步翻倍',
    unit.getPhysicalAttackDamage(60, target) === 120);
unit.data.atk /= 2;

unit._ai = { _attackDamage: 60 };
unit.applyInspire(10000, { atkMul: 1.5, speedMul: 1.33 });
check('激励不直接污染基础攻击和配置移速',
    unit._ai._attackDamage === 60 && cfg.ai.walkSpeed === 230);
check('激励通过独立乘区作用于伤害与移动',
    unit.getPhysicalAttackDamage(60, target) === 90
    && Math.abs(unit.getMoveSpeedMultiplier() - 1.33) < 1e-9);
unit._ai._attackDamage = 75; // 模拟激励期间建筑升级
unit._onInspireEnd();
check('激励结束不把升级后的攻击力错误除低',
    unit._ai._attackDamage === 75 && unit.getMoveSpeedMultiplier() === 1);

unit.data.hp = unit.data.maxHp;
const raw = 100;
const expected = Math.max(
    Math.floor(raw * 0.1),
    Math.floor(raw * (1 - unit.data.def / (unit.data.def + 60)))
);
const result = unit.takeDamage(raw, { data: { crit: 0 } }, 'physical', true);
check('物防参与友军承伤公式',
    Math.round(result.damage) === expected
    && Math.round(unit.data.maxHp - unit.data.hp) === expected);

const owner = { units: [unit] };
unit._barracks = owner;
check('死亡清理可移除所属建筑引用',
    unit.detachFromOwner() && owner.units.length === 0);

resetAbilityLevels();
for (let i = 0; i < 15; i++) raiseAbilityLevel('poison_arrow', 10);
check('全局能力等级严格钳制在maxLevel',
    getAbilityLevel('poison_arrow') === 10);
resetAbilityLevels();
Math.random = originalRandom;

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
