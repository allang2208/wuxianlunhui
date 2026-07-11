/**
 * DungeonMapGenerator — 地牢地图生成器（杀戮尖塔风格）
 * 
 * 特性：
 * - 35-40 节点随机生成（分层网格，横竖线不交叉）
 * - 最短路径需经过 9 场战斗到达 Boss
 * - 节点类型：start, combat(70%), event(30%), boss, reward, empty
 * - 迷雾机制：未访问显示 "?"，已访问/相邻显示实际类型
 * - 配置驱动，方便数值调整
 * 
 * 使用方式：
 *   const generator = new DungeonMapGenerator();
 *   const { nodes, edges, config } = generator.generate();
 */

// ==================== 默认配置 ====================
export const DUNGEON_MAP_CONFIG = {
    name: '僵尸地牢',
    description: '被亡灵瘟疫侵蚀的地下墓穴，四条通道通向深处。',

    // 节点数量范围
    minNodes: 35,
    maxNodes: 40,

    // 分层配置（列数 = 层数）
    // 每层节点数范围，总和应在 35-40 之间
    layerNodeCounts: [
        { min: 1, max: 1 },   // Layer 0: start（固定1个）
        { min: 3, max: 4 },   // Layer 1
        { min: 3, max: 5 },   // Layer 2
        { min: 3, max: 5 },   // Layer 3
        { min: 3, max: 5 },   // Layer 4
        { min: 3, max: 5 },   // Layer 5
        { min: 3, max: 5 },   // Layer 6
        { min: 3, max: 5 },   // Layer 7
        { min: 3, max: 4 },   // Layer 8
        { min: 2, max: 4 },   // Layer 9
        { min: 1, max: 1 },   // Layer 10: boss（固定1个）
    ],

    // 最短路径要求（从 start 到 boss 必须经过的 combat 节点数）
    minCombatPathLength: 9,

    // 节点类型分布（中间层，不含 start/boss/reward）
    // combat + event = 1.0
    nodeTypeWeights: {
        combat: 0.70,  // 70% 战斗
        event:  0.30,  // 30% 事件
    },

    // 奖励节点：Boss 后固定1个
    hasRewardNode: true,

    // 地图尺寸（用于渲染定位）
    mapWidth:  2000,
    mapHeight: 1500,

    // 节点间距
    layerSpacingX: 180,  // 层间水平间距
    nodeSpacingY:  100,  // 同层节点垂直间距

    // 视觉配置
    typeColors: {
        start:  '#3a5a3a',
        combat: '#7a3a3a',
        event:  '#6a5a3a',
        boss:   '#7a0000',
        reward: '#5a3a7a',
        empty:  '#3a3a3a',
    },
    typeBorderColors: {
        start:  '#6aca6a',
        combat: '#aa5a5a',
        event:  '#9a8a5a',
        boss:   '#aa0000',
        reward: '#8a5aaa',
        empty:  '#5a5a5a',
    },
    typeIcons: {
        start:  '▶',
        combat: '⚔',
        event:  '?',
        boss:   '☠',
        reward: '💎',
        empty:  '·',
    },
    typeLabels: {
        start:  '起点',
        combat: '战斗',
        event:  '事件',
        boss:   'BOSS',
        reward: '奖励',
        empty:  '空',
    },

    // 迷雾配置
    fogOfWar: {
        enabled: true,
        unknownIcon: '?',
        unknownColor: '#2a2a2a',
        unknownBorderColor: '#1a1a1a',
    },

    // 生成参数
    generation: {
        maxAttempts: 100,           // 最大尝试次数（满足最短路径）
        verticalConnectionChance: 0.6, // 同层相邻节点间垂直连接概率
        minConnectionsPerNode: 1,   // 每个节点最少连接数
        maxConnectionsPerNode: 3,   // 每个节点最多连接数
    }
};

// ==================== 地图生成器类 ====================
export class DungeonMapGenerator {
    constructor(config = DUNGEON_MAP_CONFIG) {
        this.config = { ...config };
        this.nodes = [];
        this.edges = [];
    }

    /**
     * 生成地图节点和边
     * @returns {Object} { nodes, edges, config, metadata }
     */
    generate() {
        let attempts = 0;
        const maxAttempts = this.config.generation.maxAttempts;

        while (attempts < maxAttempts) {
            attempts++;
            this._clear();
            this._generateLayers();
            this._generateEdges();

            if (this._validatePathLength()) {
                const metadata = this._computeMetadata();
                return {
                    nodes: this.nodes,
                    edges: this.edges,
                    config: this.config,
                    metadata
                };
            }
        }

        // 如果多次尝试都失败，放宽条件返回最后一次结果
        console.warn(`[DungeonMapGenerator] 无法在 ${maxAttempts} 次尝试内生成满足最短路径=${this.config.minCombatPathLength} 的地图，返回最后一次结果`);
        const metadata = this._computeMetadata();
        return {
            nodes: this.nodes,
            edges: this.edges,
            config: this.config,
            metadata
        };
    }

    /** 清空当前数据 */
    _clear() {
        this.nodes = [];
        this.edges = [];
    }

    /** 生成分层节点 */
    _generateLayers() {
        const { layerNodeCounts, mapWidth, mapHeight, layerSpacingX, nodeSpacingY } = this.config;
        const layers = [];

        // 1. 确定每层节点数
        let totalNodes = 0;
        for (let i = 0; i < layerNodeCounts.length; i++) {
            const lc = layerNodeCounts[i];
            // 第一层和最后一层固定1个
            if (i === 0 || i === layerNodeCounts.length - 1) {
                layers.push(1);
                totalNodes += 1;
            } else {
                const count = this._randInt(lc.min, lc.max);
                layers.push(count);
                totalNodes += count;
            }
        }

        // 2. 如果总数不在范围内，调整中间层
        if (totalNodes < this.config.minNodes) {
            // 增加中间层节点
            for (let i = 1; i < layers.length - 1 && totalNodes < this.config.minNodes; i++) {
                if (layers[i] < layerNodeCounts[i].max) {
                    layers[i]++;
                    totalNodes++;
                }
            }
        } else if (totalNodes > this.config.maxNodes) {
            // 减少中间层节点
            for (let i = layers.length - 2; i > 0 && totalNodes > this.config.maxNodes; i--) {
                if (layers[i] > layerNodeCounts[i].min) {
                    layers[i]--;
                    totalNodes--;
                }
            }
        }

        // 3. 生成节点坐标和类型
        const numLayers = layers.length;
        const startX = mapWidth / (numLayers + 1);
        const centerY = mapHeight / 2;

        let nodeId = 0;
        for (let layer = 0; layer < numLayers; layer++) {
            const count = layers[layer];
            const layerX = startX * (layer + 1);

            // 计算该层节点的Y坐标（居中分布）
            const totalHeight = (count - 1) * nodeSpacingY;
            const startY = centerY - totalHeight / 2;

            for (let i = 0; i < count; i++) {
                const type = this._determineNodeType(layer, numLayers, i);
                const node = {
                    id: `node_${layer}_${i}`,
                    layer,
                    index: i,
                    x: layerX,
                    y: startY + i * nodeSpacingY,
                    type,
                    originalType: type, // 保存原始类型（用于 empty 恢复）
                    connections: [], // 出边目标节点id
                };
                this.nodes.push(node);
                nodeId++;
            }
        }
    }

    /** 确定节点类型 */
    _determineNodeType(layer, totalLayers, index) {
        // 第一层：起点
        if (layer === 0) return 'start';
        // 最后一层：Boss
        if (layer === totalLayers - 1) return 'boss';
        // Boss 后一层：奖励（如果启用）
        if (layer === totalLayers && this.config.hasRewardNode) return 'reward';

        // 中间层：按权重随机
        const weights = this.config.nodeTypeWeights;
        const roll = Math.random();
        let cumulative = 0;
        for (const [type, weight] of Object.entries(weights)) {
            cumulative += weight;
            if (roll < cumulative) return type;
        }
        return 'combat';
    }

    /** 生成边（连接） */
    _generateEdges() {
        const nodesByLayer = this._groupNodesByLayer();
        const numLayers = nodesByLayer.length;
        const verticalChance = this.config.generation.verticalConnectionChance;

        // 1. 层间连接（水平方向，只能从左到右）
        for (let layer = 0; layer < numLayers - 1; layer++) {
            const currentLayer = nodesByLayer[layer];
            const nextLayer = nodesByLayer[layer + 1];

            // 每个当前层节点至少连接到下一层的一个节点
            for (const node of currentLayer) {
                // 找到最近的下一层节点
                const targets = this._findNearestNodes(node, nextLayer, 1, 2); // 连接1-2个
                for (const target of targets) {
                    this._addEdge(node.id, target.id);
                }
            }

            // 确保下一层每个节点至少被上一层的一个节点连接（反向检查）
            for (const nextNode of nextLayer) {
                const hasIncoming = this.edges.some(e => e.to === nextNode.id);
                if (!hasIncoming) {
                    // 找到最近的上层节点连接过来
                    const source = this._findNearestNode(nextNode, currentLayer);
                    if (source) {
                        this._addEdge(source.id, nextNode.id);
                    }
                }
            }
        }

        // 2. 同层垂直连接（相邻节点之间，双向）
        for (let layer = 0; layer < numLayers; layer++) {
            const layerNodes = nodesByLayer[layer];
            for (let i = 0; i < layerNodes.length - 1; i++) {
                if (Math.random() < verticalChance) {
                    this._addEdge(layerNodes[i].id, layerNodes[i + 1].id, true);
                }
            }
        }

        // 3. 清理超出最大连接数的节点
        this._trimExcessConnections();
    }

    /** 按层分组节点 */
    _groupNodesByLayer() {
        const map = new Map();
        for (const node of this.nodes) {
            if (!map.has(node.layer)) map.set(node.layer, []);
            map.get(node.layer).push(node);
        }
        // 按层排序
        const layers = [];
        for (let i = 0; i <= Math.max(...map.keys()); i++) {
            layers.push(map.get(i) || []);
        }
        return layers;
    }

    /** 找到最近的N个节点（在指定范围内） */
    _findNearestNodes(source, candidates, minCount, maxCount) {
        // 按距离排序
        const sorted = candidates.map(c => ({
            node: c,
            dist: Math.abs(c.y - source.y)
        })).sort((a, b) => a.dist - b.dist);

        // 随机选择连接数量
        const count = this._randInt(minCount, Math.min(maxCount, sorted.length));
        return sorted.slice(0, count).map(s => s.node);
    }

    /** 找到最近的单个节点 */
    _findNearestNode(source, candidates) {
        if (candidates.length === 0) return null;
        let nearest = candidates[0];
        let minDist = Math.abs(candidates[0].y - source.y);
        for (let i = 1; i < candidates.length; i++) {
            const dist = Math.abs(candidates[i].y - source.y);
            if (dist < minDist) {
                minDist = dist;
                nearest = candidates[i];
            }
        }
        return nearest;
    }

    /** 添加边 */
    _addEdge(from, to, bidirectional = false) {
        // 避免重复
        const exists = this.edges.some(e => e.from === from && e.to === to);
        if (exists) return;

        this.edges.push({ from, to });
        
        // 更新节点的 connections
        const fromNode = this.nodes.find(n => n.id === from);
        if (fromNode && !fromNode.connections.includes(to)) {
            fromNode.connections.push(to);
        }

        if (bidirectional) {
            const existsReverse = this.edges.some(e => e.from === to && e.to === from);
            if (!existsReverse) {
                this.edges.push({ from: to, to: from });
                const toNode = this.nodes.find(n => n.id === to);
                if (toNode && !toNode.connections.includes(from)) {
                    toNode.connections.push(from);
                }
            }
        }
    }

    /** 清理超出最大连接数的节点 */
    _trimExcessConnections() {
        const maxConn = this.config.generation.maxConnectionsPerNode;
        for (const node of this.nodes) {
            if (node.connections.length > maxConn) {
                // 保留到最近节点的连接
                const keep = node.connections.slice(0, maxConn);
                // 删除多余的边
                this.edges = this.edges.filter(e => {
                    if (e.from === node.id && !keep.includes(e.to)) return false;
                    return true;
                });
                node.connections = keep;
            }
        }
    }

    /** 验证最短路径长度 */
    _validatePathLength() {
        const startNode = this.nodes.find(n => n.type === 'start');
        const bossNode = this.nodes.find(n => n.type === 'boss');
        if (!startNode || !bossNode) return false;

        // BFS 找最短路径
        const queue = [{ id: startNode.id, combatCount: 0, path: [startNode.id] }];
        const visited = new Set();
        visited.add(startNode.id);

        while (queue.length > 0) {
            const current = queue.shift();
            const currentNode = this.nodes.find(n => n.id === current.id);

            // 到达 Boss
            if (current.id === bossNode.id) {
                return current.combatCount >= this.config.minCombatPathLength;
            }

            // 找到所有出边
            const outgoing = this.edges.filter(e => e.from === current.id);
            for (const edge of outgoing) {
                if (!visited.has(edge.to)) {
                    visited.add(edge.to);
                    const nextNode = this.nodes.find(n => n.id === edge.to);
                    const nextCombatCount = current.combatCount + (nextNode && nextNode.type === 'combat' ? 1 : 0);
                    queue.push({
                        id: edge.to,
                        combatCount: nextCombatCount,
                        path: [...current.path, edge.to]
                    });
                }
            }
        }

        // 无法到达 Boss
        return false;
    }

    /** 计算元数据 */
    _computeMetadata() {
        const typeCounts = {};
        for (const node of this.nodes) {
            typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
        }

        // 计算最短路径上的 combat 数
        const startNode = this.nodes.find(n => n.type === 'start');
        const bossNode = this.nodes.find(n => n.type === 'boss');
        let shortestCombatCount = 0;

        if (startNode && bossNode) {
            const queue = [{ id: startNode.id, combatCount: 0 }];
            const visited = new Set();
            visited.add(startNode.id);

            while (queue.length > 0) {
                const current = queue.shift();
                if (current.id === bossNode.id) {
                    shortestCombatCount = current.combatCount;
                    break;
                }

                const outgoing = this.edges.filter(e => e.from === current.id);
                for (const edge of outgoing) {
                    if (!visited.has(edge.to)) {
                        visited.add(edge.to);
                        const nextNode = this.nodes.find(n => n.id === edge.to);
                        const nextCombatCount = current.combatCount + (nextNode && nextNode.type === 'combat' ? 1 : 0);
                        queue.push({ id: edge.to, combatCount: nextCombatCount });
                    }
                }
            }
        }

        return {
            totalNodes: this.nodes.length,
            totalEdges: this.edges.length,
            typeDistribution: typeCounts,
            shortestCombatPath: shortestCombatCount,
            layers: Math.max(...this.nodes.map(n => n.layer)) + 1,
        };
    }

    /** 整数随机范围 [min, max] */
    _randInt(min, max) {
        return Math.floor(min + Math.random() * (max - min + 1));
    }
}

// ==================== 迷雾系统 ====================
export class DungeonFogOfWar {
    constructor() {
        this.visitedNodeIds = new Set();
        this.revealedNodeIds = new Set(); // 相邻节点也可见
    }

    /** 访问节点 */
    visit(nodeId, nodes, edges) {
        this.visitedNodeIds.add(nodeId);
        this.revealedNodeIds.add(nodeId);

        // 揭示相邻节点
        const adjacentEdges = edges.filter(e => e.from === nodeId || e.to === nodeId);
        for (const edge of adjacentEdges) {
            const adjacentId = edge.from === nodeId ? edge.to : edge.from;
            this.revealedNodeIds.add(adjacentId);
        }
    }

    /** 获取节点显示状态 */
    getNodeVisibility(nodeId) {
        if (this.visitedNodeIds.has(nodeId)) return 'visited';
        if (this.revealedNodeIds.has(nodeId)) return 'revealed';
        return 'hidden';
    }

    /** 获取节点显示类型（用于渲染） */
    getNodeDisplayType(node) {
        const visibility = this.getNodeVisibility(node.id);
        if (visibility === 'visited') return node.type;
        if (visibility === 'revealed') return node.type;
        return 'unknown';
    }

    /** 检查节点是否可点击（相邻且已揭示） */
    isClickable(nodeId, currentNodeId, edges) {
        if (nodeId === currentNodeId) return false;
        const isAdjacent = edges.some(e =>
            (e.from === currentNodeId && e.to === nodeId)
        );
        return isAdjacent && this.revealedNodeIds.has(nodeId);
    }

    /** 重置 */
    reset() {
        this.visitedNodeIds.clear();
        this.revealedNodeIds.clear();
    }
}

// ==================== 便捷导出 ====================
export default {
    config: DUNGEON_MAP_CONFIG,
    MapGenerator: DungeonMapGenerator,
    FogOfWar: DungeonFogOfWar,
};
