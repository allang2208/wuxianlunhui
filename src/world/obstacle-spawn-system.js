/**
 * 地牢障碍物生成接口（2026-08-26 收敛为零生成）。
 *
 * 房间烛台、中央石柱、预制障碍组合与通道火把全部停止生成。
 * 保留这两个稳定入口，避免战斗房/竞技场调用方为了“无障碍”再分叉；
 * 墙体、门、宝箱房和地板烘焙不属于本系统，继续按各自合同运行。
 *
 * obstacle_candle / obstacle_torch 等全局资产仍被世界-125、建筑或编辑器复用，
 * 此处只删除地牢运行时生成行为，不删除公共素材与墙体几何登记。
 */
export const ObstacleSpawnSystem = Object.freeze({
    spawnForRoom() {
        return 0;
    },

    spawnForPassages() {
        return 0;
    },
});
