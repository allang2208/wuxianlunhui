import { footOffsetFromOpaqueBottom } from '../src/world/structure-visual-anchor.js';

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
    if (condition) {
        pass++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
}

check('贴图最低行即接地点时回退到显示高度一半',
    footOffsetFromOpaqueBottom(294, 967, 966) === 147);
const researchOffset = footOffsetFromOpaqueBottom(308, 1093, 1078);
check('底部14px透明留白自动从脚底偏移中扣除',
    Math.abs(researchOffset - 150.0567) < 0.01,
    researchOffset.toFixed(3));
check('不同原图尺寸按显示高度等比例换算',
    footOffsetFromOpaqueBottom(296, 1170, 1169) === 148);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
