/**
 * 位面祭坛献祭回归（2026-08-22 语义重做后刷新，2026-08-23 更新本测试）：
 * - 祭品效果为主神空间/世界/地牢共用的同一份 30 分钟限时状态，离场/进地牢不再冻结或转永续；
 * - 同一稀有度仅允许 1 件生效，新献祭覆盖同级旧祭品并刷新 30 分钟，最多同时 6 件；
 * - 地牢准入改为消耗对应等级钥匙（背包优先、仓库其次），钥匙不能献祭；
 * - 献祭按剩余时长存档/恢复；
 * - 传送门与祭坛职责分离，祭坛点击打开独立详情面板。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    WORLD122_TRIBUTE_DURATION_MS,
    activateWorld122Tributes,
    deactivateWorld122Tributes,
    updateWorld122Tributes,
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
    rarity: 'common',
    icon: '🕯️',
    effects: { atkPercent: 10 },
};

clearWorld122Tributes();
check('统一时长为30分钟', WORLD122_TRIBUTE_DURATION_MS === 30 * 60 * 1000);
check('初始无生效祭品', getActiveWorld122TributeItems().length === 0);
activateWorld122Tributes(now);
const first = sacrificeWorld122Tribute(tribute, now);
check('可献祭祭品', first.ok && !first.refreshed && !first.replaced
    && first.entry.expiresAt === now + WORLD122_TRIBUTE_DURATION_MS);
check('献祭后生效（主神空间/世界/地牢共用同一份状态）', getActiveWorld122TributeItems().length === 1);

const sameRarityOther = { ...tribute, _id: 'test_tribute_2', name: '同级另一祭品' };
const replaced = sacrificeWorld122Tribute(sameRarityOther, now + 1000);
check('同稀有度新祭品覆盖旧祭品并刷新30分钟（每稀有度仅1件生效）',
    replaced.ok && replaced.replaced && !replaced.refreshed
    && getWorld122TributeEntries().length === 1
    && getWorld122TributeEntries()[0].item.name === '同级另一祭品'
    && getWorld122TributeEntries()[0].expiresAt === now + 1000 + WORLD122_TRIBUTE_DURATION_MS);
const refreshed = sacrificeWorld122Tribute(sameRarityOther, now + 2000);
check('同名同稀有度再献祭只刷新时长、不叠重复条目',
    refreshed.ok && refreshed.refreshed && !refreshed.replaced
    && getWorld122TributeEntries().length === 1);
check('地牢钥匙不能作为祭品献祭',
    !sacrificeWorld122Tribute({ _id: 'anchorTokenF', name: 'F 级时空锚点代币', category: 'tribute' }, now).ok);

// 离场/切场不再冻结：deactivate 仅做兼容 prune，祭品继续生效
deactivateWorld122Tributes(now + 6000);
check('离场不再冻结祭品（继续共用倒计时）', getActiveWorld122TributeItems().length === 1);

const snapshot = serializeWorld122Tributes(now + 60000);
check('献祭以剩余时长存档', snapshot.length === 1
    && snapshot[0].remainingMs === WORLD122_TRIBUTE_DURATION_MS - 58000);
clearWorld122Tributes();
check('清空后无生效祭品', getActiveWorld122TributeItems().length === 0);
restoreWorld122Tributes(snapshot, now + 2 * 60 * 60 * 1000);
check('读档按剩余时长重建到期点（不消耗离线时间）',
    getActiveWorld122TributeItems()[0]?.name === '同级另一祭品'
    && getWorld122TributeEntries()[0]?.expiresAt
        === now + 2 * 60 * 60 * 1000 + WORLD122_TRIBUTE_DURATION_MS - 58000);
check('到期祭品自动失效（倒计时全场持续流动）',
    updateWorld122Tributes(now + 3 * 60 * 60 * 1000) === true
    && getActiveWorld122TributeItems().length === 0);
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
const dungeonMapSrc = fs.readFileSync(path.join(ROOT, 'src/world/dungeon-map-system.js'), 'utf8');
const panelSrc = fs.readFileSync(path.join(ROOT, 'src/world/world122-tribute-system.js'), 'utf8');
const expeditionSrc = fs.readFileSync(path.join(ROOT, 'src/ui/expedition-system.js'), 'utf8');
const playerSubsystemSrc = fs.readFileSync(path.join(ROOT, 'src/entities/player/subsystems.js'), 'utf8');
check('祭品效果聚合读取位面祭坛生效祭品',
    /getActiveWorld122TributeItems/.test(tributeSrc) && /_activeTributeItems/.test(tributeSrc));
check('主神空间/世界/地牢共用同一祭品状态（2026-08-22 取消地牢互斥分支）',
    /return getActiveWorld122TributeItems\(\)/.test(tributeSrc)
    && !/_dungeonTributeItems/.test(tributeSrc));
check('出征确认自动检测并消耗对应等级钥匙（背包优先、仓库其次）',
    /getDungeonKeyRequirement\(grade\)/.test(expeditionSrc)
    && /_consumeDungeonKey\(grade\)/.test(expeditionSrc)
    && /背包和仓库中都没有/.test(expeditionSrc));
check('蟠桃续命使用统一计数（2026-08-22 取消世界/地牢分离）',
    /this\._worldPeachReviveUsed/.test(playerSubsystemSrc)
    && !/this\._peachReviveUsed\b/.test(playerSubsystemSrc)
    && /this\.player\._worldPeachReviveUsed = false/.test(panelSrc));
check('所有常驻世界初始化同一献祭系统且不绑定传送门',
    /World122TributeSystem\.setup\(player\)/.test(defenseSrc)
    && /if \(this\._managedExternally\)[\s\S]*World122TributeSystem\.setup\(player\)/.test(defenseSrc)
    && !/World122TributeSystem\.setup\(player,\s*(?:core|this\.base)\)/.test(defenseSrc)
    && /World122TributeSystem\.teardown\(\)/.test(defenseSrc));
check('祭品过期、献祭覆盖、读档恢复和清空都会刷新友军最大生命',
    /setWorld122TributeRefreshHandler/.test(tributeSrc)
    && /if \(changed && refresh\) refreshFriendlyStats\(\)/.test(storeSrc)
    && /refreshFriendlyStats\(\); \/\/ 祭品集合变化/.test(storeSrc)
    && /if \(changed\) refreshFriendlyStats\(\)/.test(storeSrc)
    && !/from ['"]\.\.\/config\/tribute-effects\.js['"]/.test(storeSrc));
check('献祭以剩余时长存档、读档按剩余时长重建（30分钟全场共用，不冻结）',
    /remainingMs: remainingOf\(entry, now\)/.test(storeSrc)
    && /expiresAt: now \+ remainingMs/.test(storeSrc));
check('祭坛面板按到期点显示剩余倒计时',
    /entry\.expiresAt - Date\.now\(\)/.test(panelSrc)
    && /remainingText/.test(panelSrc));
check('地牢不再把祭品转为本局永续状态（2026-08-22 废止）',
    !/_carriedItems/.test(dungeonMapSrc)
    && !/持续至本次地牢结束/.test(tributeSrc));
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
