/**
 * 图层遮挡统一规则防回归测试（2026-07-31 定案：depth = 地面锚线 y + 层级常量；
 * 墙件唯一入口 WallSystem.depthOf = max(底边端点 y)）
 * 运行：node scripts/test-wall-depth.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}

console.log('图层遮挡统一规则（depthOf 唯一入口）');

const wallSys = read('src/world/wall-system.js');
const combat = read('src/world/combat-room-system.js');
const editor = read('src/ui/wall-editor.js');
const chest = read('src/world/chest-room-system.js');

// 1. 唯一入口存在且规则为 max(底边端点 y)
check('WallSystem.depthOf 存在', /depthOf\(piece, bias = 0\)/.test(wallSys));
check('depthOf 规则 = max(底边端点 y)', wallSys.includes('Math.max(maxY, a.y, b.y)'));
check('运行时审计 __depthAudit 存在', wallSys.includes('__depthAudit'));

// 2. 通道预制直墙件 depth 走 depthOf（不沿用预制保存的 hub 深度值）
check('通道预制件 depth 走 depthOf', combat.includes('clipped.depth = WallSystem.depthOf(clipped)'));

// 3. 战斗房墙体生成全场统一 max（填充/封口无 min 模式残留）
check('_fillEdgeGaps 统一 max 规则', /_fillEdgeGaps\(room, edge[\s\S]{0,3000}const depthMode = 'max';/.test(combat));
check('_sealPassageSides 统一 max 规则', /_sealPassageSides[\s\S]{0,3000}const depthMode = 'max';/.test(combat));

// 4. 菱形墙构建（wall-system）四边全部 max
const bSection = wallSys.split('buildIsoDiamondWalls(')[1] || '';
check('菱形墙四边 edgeFill 全部 max', !/edgeFill\([^)]*,\s*'min'\)/.test(bSection));

// 5. 编辑器新放置件走 depthOf（手调旧值兼容保留在拖动/图层面板）
check('摆墙编辑器新件走 depthOf', editor.includes('p.depth = WallSystem.depthOf(p)'));

// 6. 宝箱房直墙/门墙 depth 为 max 规则
check('宝箱房直墙 depth = max 底边', chest.includes("mode === 'min' ? Math.min(ay, by) : Math.max(ay, by)") || chest.includes("const mode = 'max'"));

// 7. 菱形墙注释含统一规则论证（防回退引入第二套规则）
check('统一规则文档化（wall-system 注释）', wallSys.includes('图层遮挡唯一规则'));

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
