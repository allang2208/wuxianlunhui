// ============================================================
// 世界-122 建筑升级支付事务
// 正式流程消耗真实金币/能源；开发工具“无限资源”开启时统一豁免升级支付。
// ============================================================
import { CrossPlaneResourceSystem } from './cross-plane-resource-system.js';

export function payBuildingUpgradeCost(cost = {}) {
    return CrossPlaneResourceSystem.pay(cost);
}

export function refundBuildingUpgradePayment(payment) {
    CrossPlaneResourceSystem.refund(payment);
}
