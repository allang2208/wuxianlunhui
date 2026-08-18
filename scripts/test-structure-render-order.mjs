import {
    STRUCTURE_ORDER_GAP,
    resolveStructureRenderOrder,
    structureDepthChannels,
} from '../src/world/structure-render-order.js';

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

const nodes = [
    {
        stableKey: 'rear-building',
        bounds: { minU: 0, maxU: 2, minV: 0, maxV: 2 },
        baseDepth: 120,
    },
    {
        stableKey: 'middle-wall',
        bounds: { minU: 3, maxU: 3.3, minV: 0, maxV: 2 },
        baseDepth: 90,
    },
    {
        stableKey: 'front-building',
        bounds: { minU: 4, maxU: 6, minV: 0, maxV: 2 },
        baseDepth: 80,
    },
];
const ordered = resolveStructureRenderOrder(nodes);
check('拓扑关系覆盖错误基础Y：后建筑 < 墙 < 前建筑',
    ordered.get('rear-building') < ordered.get('middle-wall')
    && ordered.get('middle-wall') < ordered.get('front-building'));
check('相邻结构保留内部特效通道间隔',
    ordered.get('middle-wall') - ordered.get('rear-building') >= STRUCTURE_ORDER_GAP
    && ordered.get('front-building') - ordered.get('middle-wall') >= STRUCTURE_ORDER_GAP);

const channels = structureDepthChannels(200);
check('建筑渲染组内部顺序固定',
    channels.shadow < channels.rearFx
    && channels.rearFx < channels.sprite
    && channels.sprite < channels.frontFx
    && channels.frontFx < channels.smoke
    && channels.smoke < channels.label);
check('完整建筑通道不越过下一结构',
    channels.label < 200 + STRUCTURE_ORDER_GAP);

const ambiguous = resolveStructureRenderOrder([
    {
        stableKey: 'side-a',
        bounds: { minU: 0, maxU: 2, minV: 3, maxV: 5 },
        baseDepth: 50,
    },
    {
        stableKey: 'side-b',
        bounds: { minU: 3, maxU: 5, minV: 0, maxV: 2 },
        baseDepth: 60,
    },
]);
check('斜向交叉关系按基础深度稳定兜底',
    ambiguous.get('side-a') < ambiguous.get('side-b'));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
