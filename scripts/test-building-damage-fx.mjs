import {
    buildingDamageFlameCount,
    isBuildingDamageFxTarget,
} from '../src/effects/building-damage-fx.js';

let pass = 0;
let fail = 0;
function check(name, condition) {
    if (condition) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}`);
    }
}

const building = { _isDefenseStructure: true, hp: 100, maxHp: 100 };
check('满血无火焰', buildingDamageFlameCount(building) === 0);
building.hp = 71;
check('高于70%无火焰', buildingDamageFlameCount(building) === 0);
building.hp = 70;
check('70%生命生成2团火焰', buildingDamageFlameCount(building) === 2);
building.hp = 50;
check('50%生命生成5团火焰', buildingDamageFlameCount(building) === 5);
building.hp = 30;
check('30%生命生成8团火焰', buildingDamageFlameCount(building) === 8);
building.hp = 10;
check('低于30%保持8团火焰', buildingDamageFlameCount(building) === 8);

check('普通建筑允许受损特效', isBuildingDamageFxTarget(building));
check('墙体明确排除', !isBuildingDamageFxTarget({ ...building, _isDefenseCover: true }));
check('门明确排除', !isBuildingDamageFxTarget({ ...building, _isCoverGate: true }));
check('陷阱明确排除', !isBuildingDamageFxTarget({ ...building, _isDefenseTrap: true }));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
