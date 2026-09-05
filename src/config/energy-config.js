/**
 * 世界-122 能源系统配置（纯数据，无 DOM/Phaser 依赖，可 node 单测）。
 */
export const ENERGY_CONFIG = {
    gatherRatio: 1.0,          // 每次攻击按造成伤害的 100% 产出能源
    depletedHoldMs: 650,       // 采空后先显示暗灰裂纹态，再进入建筑同款沉陷
    footprintCells: 1,        // 每个矿点固定占用一个 128×64 等距格（逻辑占格，不阻挡移动）
    nodeSize: 128,             // 实体尺寸基准与 1×1 等距格宽一致
    visualDisplayWidth: 130,   // 仅旧版缺图兜底使用；五款矮矿堆固定128px，不随机缩放
    visualStitchScale: { min: 1.0, max: 1.05 }, // 仅旧单体矿的视觉接缝补偿
    nodeRadius: 0,             // 物理碰撞半径：能源矿不再阻挡单位
    gatherRadius: 45,          // 采集接近半径（独立于物理碰撞，保证矿工仍可停在合适位置挥锄）
    storage: { min: 15000, max: 24000 }, // 自然生成单点储量（= hp），原范围的3倍；已有快照不补矿
    highEnergy: {
        sceneId: 'scene12', // 仅矿洞建设位面；不包括废弃矿洞地牢
        name: '高能矿脉',
        storageMultiplier: 2, // 储量翻倍，采集速度/伤害转能源倍率不变
    },
    // 位面世代资源布局 v2：5 个远距主矿簇 + 1 个传送门 1200px 环上的三矿保底簇。
    // 簇心和每矿储量均使用位面世代随机流；同一世代重复进入由快照保持，重建位面后才换布局。
    generation: {
        layoutVersion: 2, // 保留格网快照协议，不因簇形算法更新而搬迁已有矿点
        majorClusterCount: 5,
        majorNodeCount: { min: 10, max: 12 },
        minimumTotalNodes: 54, // 兼容旧四簇最多 54 矿的存量迁移，不因换布局丢失未采矿物
        majorMinPortalDistance: 3000,
        majorMinCenterSpacing: 850,
        fallbackNodeCount: 3,
        fallbackPortalDistance: 1200,
        fallbackMinCenterSpacing: 520,
        clusterSpread: 320,
        fallbackSpread: 180,
        diamondInset: 380,
        candidateAttempts: 720,
        compactGrowth: {
            maxAxisRatio: 1.75, // 按等距格i/j两轴约束簇形，拒绝细长条
            minFillRatio: 0.60, // 矿格至少填满包围格框的60%，避免折线长蛇
        },
    },
};
