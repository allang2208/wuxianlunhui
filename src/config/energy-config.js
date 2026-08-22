/**
 * 世界-122 能源系统配置（纯数据，无 DOM/Phaser 依赖，可 node 单测）。
 */
export const ENERGY_CONFIG = {
    gatherRatio: 1.0,          // 每次攻击按造成伤害的 100% 产出能源
    depletedHoldMs: 650,       // 采空后先显示暗灰裂纹态，再进入建筑同款沉陷
    footprintCells: 1,        // 每个矿点固定占用一个 128×64 等距格（逻辑占格，不阻挡移动）
    nodeSize: 112,             // 显示宽度基准：留在 1×1 格宽 128px 内，仍保留少量尺寸抖动
    nodeRadius: 0,             // 物理碰撞半径：能源矿不再阻挡单位
    gatherRadius: 45,          // 采集接近半径（独立于物理碰撞，保证矿工仍可停在合适位置挥锄）
    storage: { min: 5000, max: 8000 }, // 单点储量（= hp）
    // 位面世代资源布局 v2：5 个远距主矿簇 + 1 个传送门 3000px 环上的三矿保底簇。
    // 簇心和每矿储量均使用位面世代随机流；同一世代重复进入由快照保持，重建位面后才换布局。
    generation: {
        layoutVersion: 2,
        majorClusterCount: 5,
        majorNodeCount: { min: 10, max: 12 },
        minimumTotalNodes: 54, // 兼容旧四簇最多 54 矿的存量迁移，不因换布局丢失未采矿物
        majorMinPortalDistance: 3000,
        majorMinCenterSpacing: 850,
        fallbackNodeCount: 3,
        fallbackPortalDistance: 3000,
        fallbackMinCenterSpacing: 520,
        clusterSpread: 320,
        fallbackSpread: 180,
        diamondInset: 380,
        candidateAttempts: 720,
    },
};
