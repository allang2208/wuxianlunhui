/**
 * 世界-122位面祭坛献祭回归：
 * - 世界祭品 Buff 只在世界模式累计30分钟，离场冻结；
 * - scene8~scene11 世界模式通用，主神空间与地牢模式不生效；
 * - 地牢携带祭品永续至本次地牢清理；
 * - 同名献祭刷新、可存档恢复；
 * - 传送门与祭坛职责分离，祭坛点击打开独立详情面板。
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
activateWorld122Tributes(now);
const first = sacrificeWorld122Tribute(tribute, now);
check('可献祭祭品', first.ok && !first.refreshed && first.entry.expiresAt === now + WORLD122_TRIBUTE_DURATION_MS);
check('进入世界-122后祭品生效', getActiveWorld122TributeItems().length === 1);
const refreshed = sacrificeWorld122Tribute(tribute, now + 1000);
check('同名祭品刷新时长而不叠重复条目',
    refreshed.ok && refreshed.refreshed
    && getWorld122TributeEntries().length === 1
    && refreshed.entry.expiresAt === now + 1000 + WORLD122_TRIBUTE_DURATION_MS);
deactivateWorld122Tributes(now + 6000);
const paused = getWorld122TributeEntries()[0];
check('离开世界模式冻结剩余时间',
    paused?.expiresAt === null
    && paused?.remainingMs === WORLD122_TRIBUTE_DURATION_MS - 5000
    && getActiveWorld122TributeItems().length === 0);
const snapshot = serializeWorld122Tributes(now + 60 * 60 * 1000);
clearWorld122Tributes();
restoreWorld122Tributes(snapshot, now + 2 * 60 * 60 * 1000);
activateWorld122Tributes(now + 2 * 60 * 60 * 1000);
check('暂停中的献祭Buff存档恢复后不消耗离线时间',
    getActiveWorld122TributeItems()[0]?.name === '测试祭品'
    && getWorld122TributeEntries()[0]?.expiresAt
        === now + 2 * 60 * 60 * 1000 + WORLD122_TRIBUTE_DURATION_MS - 5000);
deactivateWorld122Tributes(now + 2 * 60 * 60 * 1000);
check('离场立即停止对通用祭品效果引擎供给', getActiveWorld122TributeItems().length === 0);
clearWorld122Tributes();

const tributeSrc = fs.readFileSync(path.join(ROOT, 'src/config/tribute-effects.js'), 'utf8');
const defenseSrc = fs.readFileSync(path.join(ROOT, 'src/world/defense-system.js'), 'utf8');
const producerSrc = fs.readFileSync(path.join(ROOT, 'src/world/producer-building-system.js'), 'utf8');
const storeSrc = fs.readFileSync(path.join(ROOT, 'src/world/world122-tribute-store.js'), 'utf8');
const sceneSrc = fs.readFileSync(path.join(ROOT, 'src/world/scene-manager.js'), 'utf8');
const snapshotSrc = fs.readFileSync(path.join(ROOT, 'src/world/world122-snapshot.js'), 'utf8');
const buildingSrc = fs.readFileSync(path.join(ROOT, 'src/world/building-system.js'), 'utf8');
const producerConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/producer-buildings.json'), 'utf8'));
const saveSrc = fs.readFileSync(path.join(ROOT, 'src/ui/game-ui-manager.js'), 'utf8');
const headerSrc = fs.readFileSync(path.join(ROOT, 'src/ui/panels/building-detail-header.js'), 'utf8');
const statusBarSrc = fs.readFileSync(path.join(ROOT, 'src/ui/status-bar.js'), 'utf8');
const dungeonMapSrc = fs.readFileSync(path.join(ROOT, 'src/world/dungeon-map-system.js'), 'utf8');
const panelSrc = fs.readFileSync(path.join(ROOT, 'src/world/world122-tribute-system.js'), 'utf8');
const expeditionSrc = fs.readFileSync(path.join(ROOT, 'src/ui/expedition-system.js'), 'utf8');
const playerSubsystemSrc = fs.readFileSync(path.join(ROOT, 'src/entities/player/subsystems.js'), 'utf8');
check('祭品效果聚合同时读取世界-122激活祭品',
    /getActiveWorld122TributeItems/.test(tributeSrc) && /_activeTributeItems/.test(tributeSrc));
check('地牢与世界祭品效果源硬互斥',
    /if \(DungeonMapSystem\?\.active === true\) return _dungeonTributeItems\(\)/.test(tributeSrc)
    && /return getActiveWorld122TributeItems\(\)/.test(tributeSrc)
    && /DungeonMapSystem\?\.active === true \? _dungeonTributeItems\(\) : \[\]/.test(tributeSrc));
check('depart旁路先停世界献祭，地牢激活后再重算并同步祭品',
    /World122TributeSystem\.teardown\(\)[\s\S]*DungeonMapSystem\._carriedItems = carried/.test(expeditionSrc)
    && /DungeonMapSystem\.init\('scene7',[\s\S]*player\.calculateCombatStats\(\)[\s\S]*syncTributeBuffs\(player\)/.test(expeditionSrc));
check('蟠桃使用次数按世界与本次地牢分离',
    /dungeonTributeMode \? this\._peachReviveUsed : this\._worldPeachReviveUsed/.test(playerSubsystemSrc)
    && /this\.player\._peachReviveUsed = false/.test(dungeonMapSrc)
    && /this\.player\._worldPeachReviveUsed = false/.test(panelSrc));
check('所有常驻世界初始化同一献祭系统且不绑定传送门',
    /World122TributeSystem\.setup\(player\)/.test(defenseSrc)
    && /if \(this\._managedExternally\)[\s\S]*World122TributeSystem\.setup\(player\)/.test(defenseSrc)
    && !/World122TributeSystem\.setup\(player,\s*(?:core|this\.base)\)/.test(defenseSrc)
    && /World122TributeSystem\.teardown\(\)/.test(defenseSrc));
check('祭品过期、模式切换和清空都会刷新友军最大生命',
    /setWorld122TributeRefreshHandler/.test(tributeSrc)
    && /changed && refresh\) refreshFriendlyStats\(\)/.test(storeSrc)
    && /if \(wasActive\) refreshFriendlyStats\(\)/.test(storeSrc)
    && /if \(changed\) refreshFriendlyStats\(\)/.test(storeSrc)
    && !/from ['"]\.\.\/config\/tribute-effects\.js['"]/.test(storeSrc));
check('世界献祭以剩余时长存档并在离场时冻结',
    /entry\.remainingMs = remainingOf\(entry, now\)/.test(storeSrc)
    && /remainingMs: remainingOf\(entry, now\)/.test(storeSrc)
    && /entry\.expiresAt = now \+ remainingOf\(entry, now\)/.test(storeSrc));
check('离开世界模式显示暂停状态且返回后切回倒计时',
    /this\._syncPausedStatus\(\)/.test(panelSrc)
    && /world122TributePaused_/.test(panelSrc)
    && /暂停·剩余/.test(panelSrc)
    && /persistent: true/.test(panelSrc));
check('地牢祭品状态永续到本次地牢 shutdown',
    /persistent: true/.test(tributeSrc)
    && /持续至本次地牢结束/.test(tributeSrc)
    && /effect\.persistent \|\| effect\.battleRemaining/.test(statusBarSrc)
    && /shutdown\(\)[\s\S]*this\._carriedItems = \[\][\s\S]*clearTributeBuffs\(tributePlayer\)/.test(dungeonMapSrc));
check('传送门不再被献祭交互截获，祭坛由通用建筑按 panelMode 分发',
    !/World122TributeSystem\.openFor\(this\.base, player\)/.test(defenseSrc)
    && /panelMode === 'tribute'/.test(producerSrc)
    && /World122TributeSystem\.openFor\(picked, player\)/.test(producerSrc));
check('位面祭坛是世界-122建筑面板中的基础独立建筑',
    producerConfig.plane_altar?.name === '位面祭坛'
    && producerConfig.plane_altar?.panelMode === 'tribute'
    && producerConfig.plane_altar?.buildLimit === 1
    && producerConfig.plane_altar?.allowedSceneIds?.includes('scene8'));
check('世界核心传送门保持单座、稳定身份且不可出售或回收',
    producerConfig.portal?.buildLimit === 1
    && /id: `world_portal_\$\{sceneId\}`/.test(snapshotSrc)
    && /const coreId = `world_portal_\$\{sceneId\}`/.test(sceneSrc)
    && /世界核心传送门不可出售/.test(producerSrc)
    && /hasProtectedWorldCore/.test(buildingSrc));
check('祭坛面板包含建筑详情、生命条与祭坛属性',
    /data-role="altar-detail"/.test(panelSrc)
    && /renderBuildingDetailHeader/.test(panelSrc)
    && /'defense_base'/.test(panelSrc)
    && /耐久 \$\{current\} \/ \$\{max\}（\$\{pct\}%）/.test(headerSrc)
    && /物理防御/.test(panelSrc)
    && /魔法防御/.test(panelSrc)
    && /献祭 \/ 位面祝福/.test(panelSrc));
check('献祭Buff写入世界-122存档',
    /tributeBuffs: World122TributeSystem\.serialize\(\)/.test(saveSrc)
    && /World122TributeSystem\.restore\(data\.world122\?\.tributeBuffs\)/.test(saveSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
