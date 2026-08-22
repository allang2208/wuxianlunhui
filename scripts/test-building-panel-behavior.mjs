/**
 * 世界-122 建筑升级、独立生产选择与详情面板关闭契约。
 * 用法：node scripts/test-building-panel-behavior.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const payment = read('src/world/building-upgrade-payment.js');
const producer = read('src/world/producer-building-system.js');
const barracks = read('src/world/hamster-barracks-system.js');
const hut = read('src/world/hamster-hut-system.js');
const basePanel = read('src/ui/panels/base-panel.js');
const input = read('src/ui/input.js');
const tower = read('src/world/defense-system.js');

let pass = 0;
let fail = 0;
function check(name, condition) {
    if (condition) {
        pass++;
        console.log(`   ✓ ${name}`);
    } else {
        fail++;
        console.error(`   ✗ ${name}`);
    }
}

check('升级支付统一校验并扣除金币/能源',
    /GoldManager\.deductGold\(gold\)/.test(payment)
    && /EnergyManager\.deductEnergy\(energy\)/.test(payment)
    && /GoldManager\.addGold\(gold\)/.test(payment));
check('产兵、能力、兵营、矿场升级都走统一支付事务',
    (producer.match(/payBuildingUpgradeCost\(cost\)/g) || []).length >= 2
    && /payBuildingUpgradeCost\(cost\)/.test(barracks)
    && /payBuildingUpgradeCost\(cost\)/.test(hut));
check('升级不再受无限资源开关绕过',
    !/startAbilityUpgrade[\s\S]{0,900}_devInfiniteResources/.test(producer)
    && !/upgradeModule[\s\S]{0,700}_devInfiniteResources/.test(producer)
    && !/upgradeModule[\s\S]{0,700}_devInfiniteResources/.test(barracks)
    && !/upgradeModule[\s\S]{0,700}_devInfiniteResources/.test(hut));
check('每栋通用产兵建筑复制独立运行时配置',
    /cloneProducerRuntimeConfig\(sourceCfg\)/.test(producer)
    && /unitTypes: \(cfg\.unitTypes \|\| \[\]\)\.map/.test(producer));
check('产兵建筑与兵营重叠命中时选择最近实例',
    /let pickedScore = Infinity/.test(producer)
    && /let pickedScore = Infinity/.test(barracks)
    && /score < pickedScore/.test(producer)
    && /score < pickedScore/.test(barracks));
check('BasePanel支持建筑详情分组、Esc和面板外左右键关闭',
    /closeBasePanels/.test(basePanel)
    && /closeOnEscape/.test(basePanel)
    && /closeOnOutsidePointer/.test(basePanel)
    && /event\.button !== 0 && event\.button !== 2/.test(basePanel));
check('本地及Electron Esc优先关闭建筑详情',
    /closeBasePanels\('buildingDetail'\)/.test(input));
for (const [name, source] of [
    ['产兵/工坊', producer],
    ['兵营', barracks],
    ['矿场', hut],
    ['防御塔', tower],
]) {
    check(`${name}详情启用统一关闭策略`,
        /panelGroup: 'buildingDetail'/.test(source)
        && /closeOnEscape: true/.test(source)
        && /closeOnOutsidePointer: true/.test(source));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
