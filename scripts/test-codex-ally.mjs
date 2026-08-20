/**
 * 图鉴栏整改回归（2026-08-19）：
 * - 遮罩收回：子页面 DOM 实际激活才拦截、UIState 滞留键自愈；
 * - 数据调用排查：半自动散布两行无源硬编码已清除（spreadParams/weapon-fx-config 真源）；
 * - 友军独立栏目：unit-upgrade-store 登记表 + 矿工配置驱动，产出建筑反查自产兵配置；
 * - 布局风格：友军卡片青蓝点缀、主 tab 金色激活，与背包/属性栏金棕主色调一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sysui = read('src/ui/system-ui.js');
const codex = read('src/ui/codex-manager.js');
const tabs = read('src/ui/panels/hud-panels-system-tabs.js');
const css = read('game-style.css');

let pass = 0;
let fail = 0;
function check(name, condition) {
    console.log(`${condition ? '  ✓' : '  ✗'} ${name}`);
    if (condition) pass++; else fail++;
}

// ---- 1. 收回（点击面板外区域） ----
check('遮罩收回：子页面 DOM 实际激活才拦截（不再只看 UIState 键）',
    /el\.classList\.contains\('active'\)\) return/.test(sysui));
check('滞留键自愈（UIState.close(key) 后正常收回）',
    /UIState\.close\(key\); \/\/ 滞留键自愈/.test(sysui)
    && /getElementIfExists/.test(sysui));

// ---- 2. 硬编码清除 ----
check('半自动散布假数据已移除（detailRow 调用级无硬编码）',
    !/detailRow\('每次射击散布增加', '\+5°'\)/.test(codex) && !/detailRow\('后坐力恢复时间', '500ms'\)/.test(codex));
check('散布展示走 spreadParams/weapon-fx-config 真源',
    /WEAPON_FX_CONFIG/.test(codex) && /d\.spreadParams/.test(codex)
    && /slugRecoilAnglePerLayer/.test(codex));

// ---- 3. 友军独立栏目 ----
check('图鉴新增「友军」主 tab + 子布局 + 网格容器',
    /data-section = 'ally'|dataset\.section = 'ally'/.test(tabs)
    && /codexAllyLayout/.test(tabs) && /codexAllyGrid/.test(tabs));
check('友军数据驱动：UNIT_KIND_CFG 登记表 + 矿工配置',
    /UNIT_KIND_CFG/.test(codex) && /hamster-miner-config\.json/.test(codex));
check('友军产出建筑反查产兵配置（unitTypes 反查）',
    /producerBuildingsJson/.test(codex) && /unitTypes.*some/.test(codex));
check('友军详情走怪物公式派生（与单位 statFormula 同口径）',
    /CodexFormulaHelper\.calculateCombatStats/.test(codex));
check('友军网格/详情渲染接线（renderAllyGrid/openAllyDetail/showSection）',
    /renderAllyGrid/.test(codex) && /openAllyDetail/.test(codex)
    && /section === 'ally'/.test(codex));

// ---- 4. 布局风格 ----
check('友军卡片青蓝点缀 + 主 tab 金色激活 + 友军标签样式入库',
    /\.codex-ally-card/.test(css) && /\.cd-family-tag\.ally/.test(css)
    && /\.codex-main-tab\.active \{[^}]*#ffd98a/.test(css));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
