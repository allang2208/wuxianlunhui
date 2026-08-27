/**
 * 开发调试开关（dev-tools 技能页签按钮控制）：
 * `window.Game._devNoSkillCost = true` → 技能无冷却、无任何资源消耗（MP/体力）。
 */
export const isSkillCheatEnabled = () => !!(typeof window !== 'undefined' && window.Game && window.Game._devNoSkillCost);

/**
 * 统一经济调试开关：默认经济事务可免金币/能源。
 * 军事招募会显式关闭免单并继续消耗粮食；人口、计时和出口碰撞仍按正式规则执行。
 */
export const isInfiniteResourcesEnabled = () => !!(
    typeof window !== 'undefined' && window.Game && window.Game._devInfiniteResources
);

/** 建筑升级项目跳过读条；费用、科技门禁与完成结算仍走正式链路。 */
export const isInstantBuildingUpgradeEnabled = () => !!(
    typeof window !== 'undefined' && window.Game && window.Game._devInstantBuildingUpgrades
);

/** 造兵跳过生产读条；粮食、科技、特色编制与出口碰撞仍走正式链路。 */
export const isInstantTroopProductionEnabled = () => !!(
    typeof window !== 'undefined' && window.Game && window.Game._devInstantTroopProduction
);

/** 造兵忽略全局军事人口容量；已出兵数量仍照常计入人口快照。 */
export const isMilitaryPopulationIgnored = () => !!(
    typeof window !== 'undefined' && window.Game && window.Game._devIgnoreMilitaryPopulation
);

/**
 * 建筑实例和 World-122 快照都把当前读条保存在自身的 `*Upgrade` 字段。
 * 开关开启时只归零剩余时间，让各业务系统在原完成入口结算等级与副作用。
 */
export function skipBuildingUpgradeWait(owner) {
    if (!owner || !isInstantBuildingUpgradeEnabled()) return false;
    let skipped = false;
    for (const [key, value] of Object.entries(owner)) {
        if (!/upgrade$/i.test(key) || !value || typeof value !== 'object') continue;
        if (!Object.prototype.hasOwnProperty.call(value, 'remainMs')) continue;
        value.remainMs = 0;
        skipped = true;
    }
    return skipped;
}

/**
 * 开发调试（2026-08-22）：控制台执行 `debugGrantCraftTributes()` 向仓库发放
 * 工艺品祭品（equipment.json 中 craft_* 前缀条目）每种各一件；仓库格子不足时
 * 返回实际入仓数量。仅调试用途，不参与正式流程。
 */
if (typeof window !== 'undefined' && !window.debugGrantCraftTributes) {
    window.debugGrantCraftTributes = async () => {
        // 动态导入避免模块环（dev-cheats 被经济/生产模块静态引用）
        const [{ ItemDatabase }, { WarehouseSystem }] = await Promise.all([
            import('../items/item-database.js'),
            import('../ui/warehouse-system.js'),
        ]);
        const ids = Object.keys(ItemDatabase.items || {}).filter((id) => id.startsWith('craft_'));
        let granted = 0;
        for (const id of ids) {
            const inst = ItemDatabase.createInstance(id, { stack: 1 });
            if (inst && WarehouseSystem.addItem(inst)) granted++;
        }
        console.log(`[dev] 工艺品祭品已入仓 ${granted}/${ids.length} 件`);
        return granted;
    };
}
