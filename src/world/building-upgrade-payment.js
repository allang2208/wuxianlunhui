// ============================================================
// 世界-122 建筑升级支付事务
// 正式流程消耗真实金币/能源；开发工具“无限资源”开启时统一豁免升级支付。
// ============================================================
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { isInfiniteResourcesEnabled } from '../config/dev-cheats.js';

export function payBuildingUpgradeCost(cost = {}) {
    const gold = Math.max(0, Math.floor(Number(cost.gold) || 0));
    const energy = Math.max(0, Math.floor(Number(cost.energy) || 0));
    if (isInfiniteResourcesEnabled()) return { ok: true, gold, energy, free: true };
    if (!GoldManager || !EnergyManager) return { ok: false, reason: '货币系统不可用' };
    if (GoldManager.getGold() < gold) return { ok: false, reason: `金币不足（需 ${gold} 金币）` };
    if (EnergyManager.getEnergy() < energy) return { ok: false, reason: `能源不足（需 ${energy} 能源）` };

    if (gold > 0 && !GoldManager.deductGold(gold)) {
        return { ok: false, reason: `金币扣除失败（需 ${gold} 金币）` };
    }
    if (energy > 0 && !EnergyManager.deductEnergy(energy)) {
        if (gold > 0) GoldManager.addGold(gold);
        return { ok: false, reason: `能源扣除失败（需 ${energy} 能源）` };
    }
    return { ok: true, gold, energy };
}
