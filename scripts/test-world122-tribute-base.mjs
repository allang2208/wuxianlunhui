/**
 * 世界-122基地献祭回归：
 * - 祭品 Buff 统一30分钟；
 * - 仅世界-122激活时参与 tribute-effects；
 * - 同名献祭刷新、可存档恢复；
 * - 基地点击打开详情面板，不再只是飘耐久文字。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    WORLD122_TRIBUTE_DURATION_MS,
    activateWorld122Tributes,
    deactivateWorld122Tributes,
    getActiveWorld122TributeItems,
    getWorld122TributeEntries,
    sacrificeWorld122Tribute,
    serializeWorld122Tributes,
    restoreWorld122Tributes,
    clearWorld122Tributes,
} from '../src/world/world122-tribute-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const now = Date.now();
const tribute = {
    _id: 'test_tribute',
    name: '测试祭品',
    category: 'tribute',
    icon: '🕯️',
    effects: { atkPercent: 10 },
};

clearWorld122Tributes();
check('统一时长为30分钟', WORLD122_TRIBUTE_DURATION_MS === 30 * 60 * 1000);
check('离开世界-122时不参与效果聚合', getActiveWorld122TributeItems().length === 0);
const first = sacrificeWorld122Tribute(tribute, now);
check('可献祭祭品', first.ok && !first.refreshed && first.entry.expiresAt === now + WORLD122_TRIBUTE_DURATION_MS);
activateWorld122Tributes();
check('进入世界-122后祭品生效', getActiveWorld122TributeItems().length === 1);
const refreshed = sacrificeWorld122Tribute(tribute, now + 1000);
check('同名祭品刷新时长而不叠重复条目',
    refreshed.ok && refreshed.refreshed
    && getWorld122TributeEntries().length === 1
    && refreshed.entry.expiresAt === now + 1000 + WORLD122_TRIBUTE_DURATION_MS);
const snapshot = serializeWorld122Tributes();
clearWorld122Tributes();
restoreWorld122Tributes(snapshot);
activateWorld122Tributes();
check('献祭Buff可存档恢复', getActiveWorld122TributeItems()[0]?.name === '测试祭品');
deactivateWorld122Tributes();
check('离场立即停止对通用祭品效果引擎供给', getActiveWorld122TributeItems().length === 0);
clearWorld122Tributes();

const tributeSrc = fs.readFileSync(path.join(ROOT, 'src/config/tribute-effects.js'), 'utf8');
const defenseSrc = fs.readFileSync(path.join(ROOT, 'src/world/defense-system.js'), 'utf8');
const saveSrc = fs.readFileSync(path.join(ROOT, 'src/ui/game-ui-manager.js'), 'utf8');
const headerSrc = fs.readFileSync(path.join(ROOT, 'src/ui/panels/building-detail-header.js'), 'utf8');
check('祭品效果聚合同时读取世界-122激活祭品',
    /getActiveWorld122TributeItems/.test(tributeSrc) && /_activeTributeItems/.test(tributeSrc));
check('基地核心初始化/离场接入献祭系统',
    /World122TributeSystem\.setup\(player, core\)/.test(defenseSrc)
    && /World122TributeSystem\.teardown\(\)/.test(defenseSrc));
check('点击基地核心打开详情献祭面板',
    /World122TributeSystem\.openFor\(this\.base, player\)/.test(defenseSrc));
const panelSrc = fs.readFileSync(path.join(ROOT, 'src/world/world122-tribute-system.js'), 'utf8');
check('基地面板包含建筑详情、生命条与核心属性',
    /data-role="base-detail"/.test(panelSrc)
    && /renderBuildingDetailHeader/.test(panelSrc)
    && /texture: 'defense_base'/.test(panelSrc)
    && /耐久 \$\{current\} \/ \$\{max\}（\$\{pct\}%）/.test(headerSrc)
    && /物理防御/.test(panelSrc)
    && /魔法防御/.test(panelSrc)
    && /4×4 菱形格/.test(panelSrc));
check('献祭Buff写入世界-122存档',
    /tributeBuffs: World122TributeSystem\.serialize\(\)/.test(saveSrc)
    && /World122TributeSystem\.restore\(data\.world122\?\.tributeBuffs\)/.test(saveSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
