import technologyTree from '../../data/technology-tree.json';
import producerBuildings from '../../data/producer-buildings.json';
import buildingUpgrades from '../../data/building-upgrades.json';
import populationEconomy from '../../data/population-economy.json';
import { EventBus } from '../core/event-bus.js';
import { WorldProgressionSystem } from './world-progression-system.js';

const VERSION = 32;
const RESEARCH_COST_CURVE_VERSION = 19;
const RESEARCH_NODE_COST_MIGRATION_VERSION = 30;
const PREVIOUS_RESEARCH_COSTS_BY_VERSION = Object.freeze([
    Object.freeze({
        beforeVersion: 29,
        costs: Object.freeze({
            high_energy_experimentation: 1560,
            planar_observation_science: 3380,
            interplane_research_coordination: 4410,
        }),
    }),
    Object.freeze({
        beforeVersion: 30,
        costs: Object.freeze({
            planar_observation_science: 8100,
            interplane_research_coordination: 18000,
        }),
    }),
]);
const ALLOWED_UNLOCK_TYPES = new Set([
    'building', 'unit', 'upgrade', 'mechanic', 'recruitmentTier',
]);

function resolveResearchCost(node, isPlaneResearch = false) {
    const baseResearchCost = Math.max(1, Number(node?.researchCost) || 1);
    const curve = technologyTree.researchCostCurve || {};
    const roundTo = Math.max(1, Math.floor(Number(curve.roundTo) || 1));
    let multiplier = 1;
    if (isPlaneResearch) {
        multiplier = Math.max(0.01, Number(curve.planeResearchMultiplier) || 1);
    } else {
        const bands = Array.isArray(curve.bands) ? curve.bands : [];
        const band = bands.find((entry) => entry.maxBaseCost == null
            || baseResearchCost <= Number(entry.maxBaseCost));
        multiplier = Math.max(0.01, Number(band?.multiplier) || 1);
    }
    return Math.max(roundTo, Math.ceil(baseResearchCost * multiplier / roundTo) * roundTo);
}

function previousResearchCost(nodeId, savedVersion) {
    const version = Number(savedVersion) || 0;
    for (const migration of PREVIOUS_RESEARCH_COSTS_BY_VERSION) {
        if (version >= migration.beforeVersion) continue;
        const cost = migration.costs[nodeId];
        if (Number(cost) > 0) return cost;
    }
    return 0;
}

function withResolvedResearchCost(node, isPlaneResearch = false) {
    const baseResearchCost = Math.max(1, Number(node?.researchCost) || 1);
    return {
        ...node,
        baseResearchCost,
        researchCost: resolveResearchCost(node, isPlaneResearch),
    };
}

const treeNodes = Array.isArray(technologyTree.nodes)
    ? technologyTree.nodes.map((node) => withResolvedResearchCost(node, false)) : [];
const planeResearchNodes = Array.isArray(technologyTree.planeResearch)
    ? technologyTree.planeResearch.map((node) => withResolvedResearchCost(node, true)) : [];
const nodes = [...treeNodes, ...planeResearchNodes];
const nodesById = new Map(nodes.map((node) => [node.id, node]));
const unlockOwners = new Map();
const V3_ECONOMY_MIGRATION_TECH_IDS = Object.freeze([
    'settlement_planning', 'housing_optimization', 'agricultural_division',
    'market_circulation', 'credit_finance', 'economic_engineering',
    'interplane_logistics_protocol',
]);
const V14_WALL_MIGRATION_TECH_IDS = Object.freeze([
    'wall_brickwork', 'wall_black_brickwork',
]);

export const WALL_VISUAL_TIERS = Object.freeze([
    Object.freeze({
        level: 1, name: '沙墙', textureKey: 'obstacle_block_sand',
        thumbnailPath: 'assets/ui/building-thumbnails/cover_block_sand.png',
        stairTextureSuffix: 'sand',
        stairThumbnailPath: 'assets/ui/building-thumbnails/wall_staircase_sand.png',
        gateTextureKey: 'gate_4cell_sand',
        gateThumbnailPath: 'assets/ui/building-thumbnails/gate_4cell_sand.png',
    }),
    Object.freeze({
        level: 2, name: '砖墙', textureKey: 'obstacle_block_brick', unlockId: 'wall_material_brick',
        thumbnailPath: 'assets/ui/building-thumbnails/cover_block_brick.png',
        stairTextureSuffix: 'brick',
        stairThumbnailPath: 'assets/ui/building-thumbnails/wall_staircase_brick.png',
        gateTextureKey: 'gate_4cell_brick',
        gateThumbnailPath: 'assets/ui/building-thumbnails/gate_4cell_brick.png',
    }),
    Object.freeze({
        level: 3, name: '黑砖墙', textureKey: 'obstacle_block', unlockId: 'wall_material_black_brick',
        thumbnailPath: 'assets/ui/building-thumbnails/cover_block_black_brick.png',
        stairTextureSuffix: 'black_brick',
        stairThumbnailPath: 'assets/ui/building-thumbnails/wall_staircase_black_brick.png',
        gateTextureKey: 'gate_4cell_black_brick',
        gateThumbnailPath: 'assets/ui/building-thumbnails/gate_4cell_black_brick.png',
    }),
    Object.freeze({
        level: 4, name: '混凝土墙', textureKey: 'obstacle_block_concrete', unlockId: 'wall_material_concrete',
        thumbnailPath: 'assets/ui/building-thumbnails/cover_block_concrete.png',
        stairTextureSuffix: 'concrete',
        stairThumbnailPath: 'assets/ui/building-thumbnails/wall_staircase_concrete.png',
        gateTextureKey: 'gate_4cell_concrete',
        gateThumbnailPath: 'assets/ui/building-thumbnails/gate_4cell_concrete.png',
    }),
    Object.freeze({
        level: 5, name: '高科技符文墙', textureKey: 'obstacle_block_rune', unlockId: 'wall_material_rune',
        thumbnailPath: 'assets/ui/building-thumbnails/cover_block_rune.png',
        stairTextureSuffix: 'rune',
        stairThumbnailPath: 'assets/ui/building-thumbnails/wall_staircase_rune.png',
        gateTextureKey: 'gate_4cell_rune',
        gateThumbnailPath: 'assets/ui/building-thumbnails/gate_4cell_rune.png',
    }),
]);
const WALL_STAIR_TIER_SUFFIX = /_(?:sand|brick|black_brick|concrete|rune)$/;

const producerConfigs = Object.values(producerBuildings || {})
    .filter((config) => config && typeof config === 'object' && config.id);
const recruitmentTierPlans = producerConfigs.flatMap((config) =>
    (Array.isArray(config.recruitmentTiers) ? config.recruitmentTiers : [])
        .filter((tier) => tier?.id)
        .map((tier) => ({ ...tier, buildingId: config.id, buildingName: config.name })));
const recruitmentTierPlansById = new Map(
    recruitmentTierPlans.map((tier) => [tier.id, tier])
);
const producerUnitIds = producerConfigs.flatMap((config) => (config.unitTypes || [])
    .map((unit) => typeof unit === 'string' ? unit : unit?.key)
    .filter(Boolean));
const upgradeIds = Object.values(buildingUpgrades || {}).flatMap((project) => [
    ...Object.values(project?.abilities || {}).map((ability) => ability?.id).filter(Boolean),
    ...Object.keys(project?.modules || {}),
]);
const economyLevelUpgradeIds = Object.values(populationEconomy || {}).flatMap((config) =>
    (Array.isArray(config?.levels) ? config.levels : [])
        .map((level) => level?.technologyUnlockId)
        .filter(Boolean));
const KNOWN_UNLOCK_TARGETS = Object.freeze({
    building: new Set([
        'tower', 'cover_block', 'road', 'gate_4cell', 'hamster_hut',
        'wall_staircase', ...producerConfigs.map((config) => config.id),
    ]),
    unit: new Set(producerUnitIds),
    upgrade: new Set([
        ...upgradeIds,
        ...economyLevelUpgradeIds,
        ...WALL_VISUAL_TIERS.map((tier) => tier.unlockId).filter(Boolean),
    ]),
    mechanic: new Set([
        'building_recycle', 'building_relocation', 'rts_command', 'troop_hold', 'troop_rally',
        'cross_world_reinforcement', 'deep_vein_mining',
    ]),
    recruitmentTier: new Set(recruitmentTierPlans.map((tier) => tier.id)),
});

for (const node of nodes) {
    for (const unlock of node.unlocks || []) {
        const key = `${unlock.type}:${unlock.id}`;
        if (!unlockOwners.has(key)) unlockOwners.set(key, []);
        unlockOwners.get(key).push(node.id);
    }
}

function emptyState() {
    return {
        version: VERSION,
        completed: [],
        activeTechId: null,
        activeSource: null,
        targetTechId: null,
        researchQueue: [],
        progressById: {},
    };
}

function normalizeProgress(value, cost) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(Math.max(0, Number(cost) || 0), number));
}

function validateTechnologyTreeConfig(config) {
    const errors = [];
    const warnings = [];
    const sourceNodes = [
        ...(Array.isArray(config?.nodes) ? config.nodes : []),
        ...(Array.isArray(config?.planeResearch) ? config.planeResearch : []),
    ];
    const ids = new Set();
    const unlocks = new Map();

    if (!Array.isArray(config?.nodes)) errors.push('nodes 必须是数组');
    if (!Array.isArray(config?.planeResearch)) errors.push('planeResearch 必须是数组');
    if (!(Number(config?.pointsPerInstitutePerSecond) > 0)) {
        errors.push('pointsPerInstitutePerSecond 必须大于 0');
    }
    const costCurve = config?.researchCostCurve;
    if (!(Number(costCurve?.roundTo) > 0)) {
        errors.push('researchCostCurve.roundTo 必须大于 0');
    }
    if (!Array.isArray(costCurve?.bands) || costCurve.bands.length === 0) {
        errors.push('researchCostCurve.bands 必须是非空数组');
    } else {
        for (const [index, band] of costCurve.bands.entries()) {
            if (!(Number(band?.multiplier) > 0)) {
                errors.push(`researchCostCurve.bands[${index}].multiplier 必须大于 0`);
            }
            if (band?.maxBaseCost != null && !(Number(band.maxBaseCost) > 0)) {
                errors.push(`researchCostCurve.bands[${index}].maxBaseCost 必须大于 0`);
            }
        }
        if (costCurve.bands[costCurve.bands.length - 1]?.maxBaseCost != null) {
            errors.push('researchCostCurve.bands 最后一档必须省略 maxBaseCost 作为兜底');
        }
    }
    if (!(Number(costCurve?.planeResearchMultiplier) > 0)) {
        errors.push('researchCostCurve.planeResearchMultiplier 必须大于 0');
    }
    const rateCurve = config?.researchRateCurve;
    if (!(Number(rateCurve?.fullEfficiencyRate) > 0)) {
        errors.push('researchRateCurve.fullEfficiencyRate 必须大于 0');
    }
    if (!Number.isFinite(Number(rateCurve?.overflowEfficiency))
        || Number(rateCurve.overflowEfficiency) < 0
        || Number(rateCurve.overflowEfficiency) > 1) {
        errors.push('researchRateCurve.overflowEfficiency 必须在 0 到 1 之间');
    }
    if (!(Number(rateCurve?.maximumEffectiveRate) >= Number(rateCurve?.fullEfficiencyRate))) {
        errors.push('researchRateCurve.maximumEffectiveRate 不得低于 fullEfficiencyRate');
    }

    for (const [index, node] of sourceNodes.entries()) {
        const id = typeof node?.id === 'string' ? node.id.trim() : '';
        if (!id) {
            errors.push(`nodes[${index}] 缺少有效 id`);
            continue;
        }
        if (ids.has(id)) errors.push(`重复科技 id：${id}`);
        ids.add(id);
        if (!(Number(node.researchCost) > 0)) errors.push(`${id} 的 researchCost 必须大于 0`);
        if (node.requiredWorldCount != null
            && !(Number.isInteger(Number(node.requiredWorldCount))
                && Number(node.requiredWorldCount) > 0)) {
            errors.push(`${id} 的 requiredWorldCount 必须是正整数`);
        }
        if (typeof node.branch !== 'string' || !node.branch.trim()) warnings.push(`${id} 缺少 branch`);
        if (!Number.isFinite(Number(node.column)) || !Number.isFinite(Number(node.lane))) {
            warnings.push(`${id} 缺少有效 column/lane 布局坐标`);
        }
        if (!Array.isArray(node.prerequisites)) errors.push(`${id} 的 prerequisites 必须是数组`);
        if (!Array.isArray(node.unlocks)) errors.push(`${id} 的 unlocks 必须是数组`);

        for (const unlock of node.unlocks || []) {
            if (!ALLOWED_UNLOCK_TYPES.has(unlock?.type)) {
                errors.push(`${id} 使用了非法解锁类型：${unlock?.type || '(empty)'}`);
                continue;
            }
            if (typeof unlock.id !== 'string' || !unlock.id.trim()) {
                errors.push(`${id} 存在缺少 id 的 ${unlock.type} 解锁项`);
                continue;
            }
            if (!KNOWN_UNLOCK_TARGETS[unlock.type]?.has(unlock.id)) {
                errors.push(`${id} 引用了不存在的解锁目标：${unlock.type}:${unlock.id}`);
                continue;
            }
            const key = `${unlock.type}:${unlock.id}`;
            if (unlocks.has(key)) {
                warnings.push(`解锁目标 ${key} 同时由 ${unlocks.get(key)} 与 ${id} 提供`);
            } else {
                unlocks.set(key, id);
            }
        }
    }

    for (const node of sourceNodes) {
        if (!node?.id) continue;
        for (const requiredId of node.prerequisites || []) {
            if (requiredId === node.id) errors.push(`${node.id} 不能依赖自身`);
            else if (!ids.has(requiredId)) errors.push(`${node.id} 引用了不存在的前置科技：${requiredId}`);
        }
    }

    const visitState = new Map();
    const stack = [];
    const visit = (id) => {
        const state = visitState.get(id) || 0;
        if (state === 2) return;
        if (state === 1) {
            const start = Math.max(0, stack.indexOf(id));
            errors.push(`科技树存在循环依赖：${[...stack.slice(start), id].join(' -> ')}`);
            return;
        }
        visitState.set(id, 1);
        stack.push(id);
        const node = sourceNodes.find((entry) => entry?.id === id);
        for (const requiredId of node?.prerequisites || []) {
            if (ids.has(requiredId)) visit(requiredId);
        }
        stack.pop();
        visitState.set(id, 2);
    };
    for (const id of ids) visit(id);

    const reachable = new Set(sourceNodes
        .filter((node) => node?.id && (node.prerequisites || []).length === 0)
        .map((node) => node.id));
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of sourceNodes) {
            if (!node?.id || reachable.has(node.id)) continue;
            const prerequisites = node.prerequisites || [];
            if (prerequisites.length && prerequisites.every((id) => reachable.has(id))) {
                reachable.add(node.id);
                changed = true;
            }
        }
    }
    for (const id of ids) {
        if (!reachable.has(id)) warnings.push(`科技 ${id} 无法从任何根科技到达`);
    }

    return Object.freeze({
        valid: errors.length === 0,
        errors: Object.freeze([...new Set(errors)]),
        warnings: Object.freeze([...new Set(warnings)]),
    });
}

const CONFIG_VALIDATION = validateTechnologyTreeConfig(technologyTree);
if (CONFIG_VALIDATION.errors.length) {
    console.error('[TechnologySystem] 科技配置校验失败', CONFIG_VALIDATION.errors);
}
if (CONFIG_VALIDATION.warnings.length) {
    console.warn('[TechnologySystem] 科技配置警告', CONFIG_VALIDATION.warnings);
}

export const TechnologySystem = {
    config: technologyTree,
    validation: CONFIG_VALIDATION,
    state: emptyState(),
    lastInstituteCount: 0,
    lastRawResearchRate: 0,
    lastResearchRate: 0,

    reset() {
        this.state = emptyState();
        this.lastInstituteCount = 0;
        this.lastRawResearchRate = 0;
        this.lastResearchRate = 0;
        this._emitChanged('reset');
    },

    validateConfig() {
        return this.validation;
    },

    getNodes() {
        return nodes;
    },

    getTreeNodes() {
        return treeNodes;
    },

    getPlaneResearchNodes() {
        return planeResearchNodes;
    },

    getNode(id) {
        return nodesById.get(id) || null;
    },

    getRecruitmentTierPlan(id) {
        return recruitmentTierPlansById.get(id) || null;
    },

    isCompleted(id) {
        return this.state.completed.includes(id);
    },

    isWorldRequirementMet(id) {
        const node = this.getNode(id);
        if (!node) return false;
        if (node.requiredWorldId
            && !WorldProgressionSystem.isWorldEligible(node.requiredWorldId)) return false;
        const requiredWorldCount = Math.max(0,
            Math.floor(Number(node.requiredWorldCount) || 0));
        return requiredWorldCount <= 0
            || WorldProgressionSystem.getTravelWorlds().length >= requiredWorldCount;
    },

    isAvailable(id) {
        const node = this.getNode(id);
        return !!node && node.placeholder !== true
            && this.isWorldRequirementMet(id) && !this.isCompleted(id)
            && (node.prerequisites || []).every((requiredId) => this.isCompleted(requiredId));
    },

    getAvailableNodes() {
        return nodes.filter((node) => this.isAvailable(node.id));
    },

    isUnlocked(type, id) {
        const owners = unlockOwners.get(`${type}:${id}`);
        if (!owners?.length) return true;
        return owners.some((nodeId) => this.isCompleted(nodeId));
    },

    getWallVisualTier() {
        let resolved = WALL_VISUAL_TIERS[0];
        for (const tier of WALL_VISUAL_TIERS.slice(1)) {
            if (this.isUnlocked('upgrade', tier.unlockId)) resolved = tier;
        }
        return resolved;
    },

    getWallTextureKey() {
        return this.getWallVisualTier().textureKey;
    },

    getWallStairTextureKey(baseTextureKey) {
        if (!baseTextureKey) return baseTextureKey;
        const baseKey = String(baseTextureKey).replace(WALL_STAIR_TIER_SUFFIX, '');
        return `${baseKey}_${this.getWallVisualTier().stairTextureSuffix}`;
    },

    getUnlockRequirementLabel(type, id) {
        return (unlockOwners.get(`${type}:${id}`) || [])
            .map((nodeId) => this.getNode(nodeId)?.name)
            .filter(Boolean)
            .join(' / ');
    },

    /** 实际解锁顺序：基础功能为 -1，未解锁为 Infinity，同一目标取最早完成的拥有者。 */
    getUnlockOrder(type, id) {
        const owners = unlockOwners.get(`${type}:${id}`);
        if (!owners?.length) return -1;
        let order = Number.POSITIVE_INFINITY;
        for (const nodeId of owners) {
            const index = this.state.completed.indexOf(nodeId);
            if (index >= 0) order = Math.min(order, index);
        }
        return order;
    },

    getProgress(id) {
        return normalizeProgress(this.state.progressById[id], this.getNode(id)?.researchCost);
    },

    getDependencyPath(id, { includeCompleted = true } = {}) {
        const order = [];
        const visited = new Set();
        const visiting = new Set();
        const visit = (nodeId) => {
            if (visited.has(nodeId) || visiting.has(nodeId)) return;
            const node = this.getNode(nodeId);
            if (!node) return;
            visiting.add(nodeId);
            for (const requiredId of node.prerequisites || []) visit(requiredId);
            visiting.delete(nodeId);
            visited.add(nodeId);
            if (includeCompleted || !this.isCompleted(nodeId)) order.push(nodeId);
        };
        visit(id);
        return order;
    },

    getResearchPlan(id) {
        const node = this.getNode(id);
        if (!node || node.placeholder === true
            || !this.isWorldRequirementMet(id) || this.isCompleted(id)) return [];
        return this.getDependencyPath(id, { includeCompleted: false });
    },

    getResearchQueue() {
        return [...this.state.researchQueue];
    },

    getResearchMode() {
        if (this.state.targetTechId) return 'target';
        if (this.state.activeTechId && this.state.activeSource === 'auto') return 'auto';
        return 'idle';
    },

    getRemainingResearchPoints(ids = null) {
        const queue = Array.isArray(ids)
            ? ids
            : (this.state.researchQueue.length
                ? this.state.researchQueue
                : (this.state.activeTechId ? [this.state.activeTechId] : []));
        return queue.reduce((sum, id) => {
            const node = this.getNode(id);
            if (!node || this.isCompleted(id)) return sum;
            return sum + Math.max(0, Number(node.researchCost) - this.getProgress(id));
        }, 0);
    },

    getEstimatedSeconds(ids = null, researchRate = this.lastResearchRate) {
        const rate = Math.max(0, Number(researchRate) || 0);
        if (!(rate > 0)) return null;
        return this.getRemainingResearchPoints(ids) / rate;
    },

    getEffectiveResearchRate(rawResearchRate) {
        const rawRate = Math.max(0, Number(rawResearchRate) || 0);
        const curve = technologyTree.researchRateCurve || {};
        const fullEfficiencyRate = Math.max(0,
            Number(curve.fullEfficiencyRate) || rawRate);
        const overflowEfficiency = Math.max(0, Math.min(1,
            Number(curve.overflowEfficiency) || 0));
        const maximumEffectiveRate = Math.max(fullEfficiencyRate,
            Number(curve.maximumEffectiveRate) || Number.POSITIVE_INFINITY);
        const effectiveRate = rawRate <= fullEfficiencyRate
            ? rawRate
            : fullEfficiencyRate + (rawRate - fullEfficiencyRate) * overflowEfficiency;
        return Math.min(maximumEffectiveRate, effectiveRate);
    },

    setResearchTarget(id, { source = 'manual-target' } = {}) {
        if (!this.getNode(id) || this.isCompleted(id)) return false;
        const plan = this.getResearchPlan(id);
        const nextId = plan.find((nodeId) => this.isAvailable(nodeId));
        if (!nextId) return false;
        this.state.targetTechId = id;
        this.state.researchQueue = plan;
        this.state.activeTechId = nextId;
        this.state.activeSource = 'target';
        this._emitChanged(source);
        return true;
    },

    setActive(id, options = {}) {
        return this.setResearchTarget(id, options);
    },

    clearResearchTarget({ source = 'clear-target' } = {}) {
        const changed = !!(this.state.targetTechId || this.state.researchQueue.length
            || this.state.activeSource === 'target');
        this.state.targetTechId = null;
        this.state.researchQueue = [];
        this.state.activeTechId = null;
        this.state.activeSource = null;
        if (changed) this._emitChanged(source);
        return changed;
    },

    clearActive() {
        return this.clearResearchTarget({ source: 'clear' });
    },

    update(deltaMs, instituteCount = 0, actualResearchRate = null, rawResearchRate = null) {
        const count = Math.max(0, Math.floor(Number(instituteCount) || 0));
        const fallbackRawRate = Math.max(0,
            Number(technologyTree.pointsPerInstitutePerSecond) || 0) * count;
        const rate = actualResearchRate == null
            ? this.getEffectiveResearchRate(fallbackRawRate)
            : Math.max(0, Number(actualResearchRate) || 0);
        const rawRate = rawResearchRate == null
            ? (actualResearchRate == null ? fallbackRawRate : rate)
            : Math.max(0, Number(rawResearchRate) || 0);
        this.lastInstituteCount = count;
        this.lastRawResearchRate = rawRate;
        this.lastResearchRate = rate;
        if (!(rate > 0) || deltaMs <= 0) return null;
        let remainingPoints = rate * (deltaMs / 1000);
        let lastCompletedNode = null;
        let progressed = false;
        let safety = nodes.length + 1;

        while (remainingPoints > 0 && safety-- > 0) {
            if (!this.isAvailable(this.state.activeTechId)) {
                this._selectNextResearch();
                if (!this.state.activeTechId) break;
            }

            const node = this.getNode(this.state.activeTechId);
            const current = this.getProgress(node.id);
            const needed = Math.max(0, Number(node.researchCost) - current);
            const applied = Math.min(remainingPoints, needed);
            const next = current + applied;
            remainingPoints -= applied;
            this.state.progressById[node.id] = Math.min(node.researchCost, next);

            if (next < node.researchCost) {
                progressed = applied > 0;
                break;
            }

            this._completeResearch(node);
            lastCompletedNode = node;
        }

        if (progressed) this._emitChanged('progress');
        return lastCompletedNode;
    },

    _completeResearch(node) {
        if (!this.state.completed.includes(node.id)) this.state.completed.push(node.id);
        delete this.state.progressById[node.id];
        this.state.activeTechId = null;

        if (this.state.targetTechId === node.id) {
            this.state.targetTechId = null;
            this.state.researchQueue = [];
            this.state.activeSource = null;
        } else if (this.state.targetTechId) {
            this._rebuildTargetQueue();
        } else {
            this.state.activeSource = null;
        }

        this._emitChanged('completed', node);
        this._refreshConsumers();
        const sceneManager = typeof window !== 'undefined' ? window.SceneManager : null;
        const unlockSummary = (node.unlocks || [])
            .map((unlock) => unlock.label || unlock.id)
            .filter(Boolean)
            .join('、');
        sceneManager?.showTopNotification?.(
            `科技研发完成：${node.name}${unlockSummary ? `｜解锁 ${unlockSummary}` : ''}`,
            { color: '#8ee6ff' }
        );
    },

    unlockAll({ source = 'dev' } = {}) {
        const before = this.state.completed.length;
        this.state.completed = nodes
            .filter((node) => node.placeholder !== true)
            .map((node) => node.id);
        this.state.activeTechId = null;
        this.state.activeSource = null;
        this.state.targetTechId = null;
        this.state.researchQueue = [];
        this.state.progressById = {};
        this._emitChanged(source);
        this._refreshConsumers();
        return Math.max(0, this.state.completed.length - before);
    },

    serialize() {
        return {
            version: VERSION,
            completed: [...this.state.completed],
            activeTechId: this.state.activeTechId,
            activeSource: this.state.activeSource,
            targetTechId: this.state.targetTechId,
            researchQueue: [...this.state.researchQueue],
            progressById: { ...this.state.progressById },
        };
    },

    restore(saved, { legacyUnlockAll = false } = {}) {
        if (!saved || typeof saved !== 'object') {
            this.state = emptyState();
            if (legacyUnlockAll) this.unlockAll({ source: 'legacy-save' });
            else this._emitChanged('restore');
            return;
        }

        const completed = Array.isArray(saved.completed)
            ? [...new Set(saved.completed.filter((id) => {
                const node = nodesById.get(id);
                return !!node && node.placeholder !== true;
            }))]
            : [];
        if (Number(saved.version) < 3) {
            for (const id of V3_ECONOMY_MIGRATION_TECH_IDS) {
                if (nodesById.has(id) && !completed.includes(id)) completed.push(id);
            }
        }
        // v8 将既有风车升级纳入“农业分工”门禁；旧档一次性完成该节点，避免已在使用的升级被回锁。
        if (Number(saved.version) < 8
            && nodesById.has('agricultural_division')
            && !completed.includes('agricultural_division')) {
            completed.push('agricultural_division');
        }
        // v14 以前方块墙固定使用当前黑砖贴图；迁移时补齐前两级墙材科技，
        // 只保留既有视觉，不改墙体数值、碰撞或其他城防科技的解锁状态。
        if (Number(saved.version) < 14) {
            for (const id of V14_WALL_MIGRATION_TECH_IDS) {
                if (nodesById.has(id) && !completed.includes(id)) completed.push(id);
            }
        }
        // v25 将原“雪原忍术”拆为城堡建造与忍者招募两级。旧档若已完成忍术，
        // 同步补齐其新增前置，避免既有雪原玩法在升级版本后出现倒挂或回锁。
        if (Number(saved.version) < 25
            && completed.includes('snow_ninjutsu')
            && nodesById.has('snow_castle_architecture')
            && !completed.includes('snow_castle_architecture')) {
            completed.push('snow_castle_architecture');
        }
        // v28 将丛林祭司、沙漠僧侣从原位面建筑科技中拆为独立的第二级招募科技。
        // 旧档若已经完成原科技，则补齐对应新节点，维持其既有招募权限。
        if (Number(saved.version) < 28) {
            const featureUnitTechMigrations = [
                ['jungle_temple_rites', 'jungle_priesthood'],
                ['desert_mansion_charter', 'desert_monastic_order'],
            ];
            for (const [legacyTechId, unitTechId] of featureUnitTechMigrations) {
                if (completed.includes(legacyTechId)
                    && nodesById.has(unitTechId)
                    && !completed.includes(unitTechId)) {
                    completed.push(unitTechId);
                }
            }
        }
        // v30 在大学与位面观测阵列之间新增“高能实验学/高能实验室”。
        // 已完成后段科研的旧档同步补齐新增前置，保持既有阵列/中枢建造权限不回锁。
        if (Number(saved.version) < 30
            && (completed.includes('planar_observation_science')
                || completed.includes('interplane_research_coordination'))
            && nodesById.has('high_energy_laboratory_science')
            && !completed.includes('high_energy_laboratory_science')) {
            completed.push('high_energy_laboratory_science');
        }
        const progressById = {};
        for (const [id, value] of Object.entries(saved.progressById || {})) {
            const node = this.getNode(id);
            if (!node || completed.includes(id)) continue;
            const savedProgress = Math.max(0, Number(value) || 0);
            let migratedProgress = savedProgress;
            if (Number(saved.version) < RESEARCH_COST_CURVE_VERSION
                && Number(node.baseResearchCost) > 0) {
                migratedProgress = savedProgress / node.baseResearchCost * node.researchCost;
            } else if (Number(saved.version) < RESEARCH_NODE_COST_MIGRATION_VERSION) {
                const oldCost = previousResearchCost(node.id, saved.version);
                if (oldCost > 0) {
                    migratedProgress = savedProgress / oldCost * node.researchCost;
                }
            }
            progressById[id] = normalizeProgress(migratedProgress, node.researchCost);
        }
        this.state = {
            ...emptyState(),
            completed,
            progressById,
        };

        const savedTargetId = this.getNode(saved.targetTechId) && !this.isCompleted(saved.targetTechId)
            ? saved.targetTechId
            : null;
        if (savedTargetId) {
            this.state.targetTechId = savedTargetId;
            this._rebuildTargetQueue();
            if (this.state.researchQueue.includes(saved.activeTechId) && this.isAvailable(saved.activeTechId)) {
                this.state.activeTechId = saved.activeTechId;
            }
        } else if (Number(saved.version) < 2
            && this.getNode(saved.activeTechId)
            && this.isAvailable(saved.activeTechId)) {
            // v1 的手选项目迁移为同名研究目标，已有进度不丢失。
            this.state.targetTechId = saved.activeTechId;
            this._rebuildTargetQueue();
            this.state.activeTechId = saved.activeTechId;
        } else if (this.getNode(saved.activeTechId) && this.isAvailable(saved.activeTechId)) {
            this.state.activeTechId = saved.activeTechId;
            this.state.activeSource = 'auto';
        }

        this._emitChanged('restore');
        this._refreshConsumers();
    },

    _selectNextResearch() {
        if (this.state.targetTechId && !this.isCompleted(this.state.targetTechId)) {
            this._rebuildTargetQueue();
            if (this.state.activeTechId) {
                this._emitChanged('queue-next');
                return this.state.activeTechId;
            }
        }

        this.state.targetTechId = null;
        this.state.researchQueue = [];
        const available = this.getAvailableNodes();
        this.state.activeTechId = available.length
            ? available[Math.floor(Math.random() * available.length)].id
            : null;
        this.state.activeSource = this.state.activeTechId ? 'auto' : null;
        if (this.state.activeTechId) this._emitChanged('auto-select');
        return this.state.activeTechId;
    },

    _rebuildTargetQueue() {
        const targetId = this.state.targetTechId;
        if (!targetId || this.isCompleted(targetId)) {
            this.state.targetTechId = null;
            this.state.researchQueue = [];
            this.state.activeTechId = null;
            this.state.activeSource = null;
            return [];
        }
        const plan = this.getResearchPlan(targetId);
        this.state.researchQueue = plan;
        const activeStillValid = plan.includes(this.state.activeTechId)
            && this.isAvailable(this.state.activeTechId);
        if (!activeStillValid) {
            this.state.activeTechId = plan.find((id) => this.isAvailable(id)) || null;
        }
        this.state.activeSource = this.state.activeTechId ? 'target' : null;
        return plan;
    },

    _emitChanged(reason, completedNode = null) {
        EventBus.emit('technology:changed', {
            reason,
            completedNode,
            state: this.serialize(),
        });
    },

    _refreshConsumers() {
        const game = typeof window !== 'undefined' ? window.Game : null;
        const wallTextureKey = this.getWallTextureKey();
        for (const entity of game?.entities?.values?.() || []) {
            entity?.refreshRecruitmentTier?.();
            if (entity?._isBlockCover && entity.spriteCfg) {
                entity.spriteCfg.idleKey = wallTextureKey;
                delete entity._structureVisualFitKey;
                delete entity._structureVisualFit;
                continue;
            }
            if (!entity?._isWallStaircase || !Array.isArray(entity.visualSegments)) continue;
            for (const visual of entity.visualSegments) {
                const baseTexture = String(visual.baseTexture || visual.texture || '')
                    .replace(WALL_STAIR_TIER_SUFFIX, '');
                visual.baseTexture = baseTexture;
                visual.texture = this.getWallStairTextureKey(baseTexture);
            }
            if (entity.spriteCfg && entity.visualSegments[0]?.texture) {
                entity.spriteCfg.idleKey = entity.visualSegments[0].texture;
            }
        }
        for (const building of game?.ProducerBuildingSystem?.buildings || []) {
            building?.refreshRecruitmentTier?.();
        }
        game?.BuildingSystem?.refreshTechnologyUnlocks?.();
        game?.ProducerBuildingSystem?._panel?.refresh?.();
        game?.RTSCommand?._refreshTroopLinePanel?.(true);
    },
};
