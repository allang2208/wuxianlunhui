import { DungeonConfig } from '../config/dungeon-config.js';

const EDGES = {
    TOP: 0,
    RIGHT: 1,
    BOTTOM: 2,
    LEFT: 3
};

export const DungeonSpawnUtils = {
    EDGES,

    /**
     * 随机选择一条边的索引
     */
    randomEdgeIndex() {
        return Math.floor(Math.random() * 4);
    },

    /**
     * 获取对边索引
     */
    getOppositeEdgeIndex(edgeIndex) {
        return (edgeIndex + 2) % 4;
    },

    /**
     * 获取某条边的中点出生位置（世界坐标，Y+向上）
     * @param {number} roomSize - 正方形场地边长
     * @param {number} edgeIndex - 0=上 1=右 2=下 3=左
     * @param {number} [offset] - 距边向内的固定像素偏移
     */
    getEdgeMidpoint(roomSize, edgeIndex, offset) {
        const cfg = DungeonConfig.getCombatRoomConfig();
        const safeOffset = offset ?? cfg.spawn.playerOffsetFromEdge;
        const half = roomSize / 2;
        switch (edgeIndex) {
            case EDGES.TOP:
                return { x: 0, y: half - safeOffset };
            case EDGES.RIGHT:
                return { x: half - safeOffset, y: 0 };
            case EDGES.BOTTOM:
                return { x: 0, y: -half + safeOffset };
            case EDGES.LEFT:
                return { x: -half + safeOffset, y: 0 };
            default:
                return { x: 0, y: 0 };
        }
    },

    /**
     * 获取怪物出生区域中心（对边中点，按配置深度向内）
     * @param {number} roomSize
     * @param {number} playerEdgeIndex
     */
    getMonsterSpawnCenter(roomSize, playerEdgeIndex) {
        const cfg = DungeonConfig.getCombatRoomConfig();
        const oppositeEdge = this.getOppositeEdgeIndex(playerEdgeIndex);
        return this.getEdgeMidpoint(roomSize, oppositeEdge, cfg.spawn.monsterSpawnDepth);
    },

    /**
     * 在指定边附近的带状区域内随机生成一个位置
     * @param {number} roomSize
     * @param {number} edgeIndex
     * @param {number} depth - 距边的深度范围
     * @param {number} margin - 距离角点的安全边距
     */
    randomPointNearEdge(roomSize, edgeIndex, depth, margin) {
        const cfg = DungeonConfig.getCombatRoomConfig();
        const safeDepth = depth ?? cfg.spawn.monsterSpawnDepth;
        const safeMargin = margin ?? cfg.spawn.monsterMargin;
        const half = roomSize / 2;
        const inner = half - safeMargin;

        const base = this.getEdgeMidpoint(roomSize, edgeIndex, safeDepth);
        const halfSpan = inner - Math.abs(safeDepth);
        const t = (Math.random() - 0.5) * 2; // -1 ~ 1

        switch (edgeIndex) {
            case EDGES.TOP:
            case EDGES.BOTTOM:
                return { x: base.x + t * halfSpan, y: base.y };
            case EDGES.RIGHT:
            case EDGES.LEFT:
                return { x: base.x, y: base.y + t * halfSpan };
            default:
                return base;
        }
    },

    /**
     * 随机一个普通战斗场地尺寸
     */
    rollNormalRoomSize() {
        const cfg = DungeonConfig.getCombatRoomConfig();
        const { min, max, step } = cfg.normalSize;
        const steps = Math.floor((max - min) / step);
        return min + Math.floor(Math.random() * (steps + 1)) * step;
    }
};

export default DungeonSpawnUtils;
