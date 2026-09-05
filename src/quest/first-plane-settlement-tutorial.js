import { Game } from '../game.js';
import { QuestStore } from './quest-store.js';
import { WorldProgressionSystem } from '../world/world-progression-system.js';
import { TechnologySystem } from '../world/technology-system.js';
import { PopulationEconomySystem } from '../world/population-economy-system.js';
import { EnergyManager } from '../systems/energy-manager.js';

export const FIRST_PLANE_SETTLEMENT_QUEST_ID = 'first_plane_settlement';
export const FIRST_PLANE_ORE_TARGET = 300;
export const FIRST_PLANE_CONSTRUCTION_SUBSIDY = 1200;
export const FIRST_PLANE_RECOMMENDED_TECH_ID = 'engineering_drafting';

const OBJECTIVES = Object.freeze({
    WAREHOUSE: 'build_first_warehouse',
    ORE: 'gather_energy_ore',
    SUBSIDY: 'claim_construction_subsidy',
    HOUSE: 'build_first_house',
    WINDMILL: 'operate_first_windmill',
    RESEARCH_INSTITUTE: 'build_research_institute',
    START_RESEARCH: 'start_technology_research',
    PRODUCE_RESEARCH: 'produce_first_research_progress',
});

const BUILDING_IDS = Object.freeze({
    WAREHOUSE: 'warehouse',
    HOUSE: 'house',
    WINDMILL: 'wheat_windmill',
    RESEARCH_INSTITUTE: 'research_institute',
    CITY_HALL: 'city_hall',
});

function completed(objectiveId) {
    return QuestStore.getObjectiveProgress(FIRST_PLANE_SETTLEMENT_QUEST_ID, objectiveId)
        >= (objectiveId === OBJECTIVES.ORE ? FIRST_PLANE_ORE_TARGET : 1);
}

function complete(objectiveId) {
    if (!completed(objectiveId)) {
        QuestStore.setObjectiveProgress(FIRST_PLANE_SETTLEMENT_QUEST_ID, objectiveId,
            objectiveId === OBJECTIVES.ORE ? FIRST_PLANE_ORE_TARGET : 1);
    }
}

function ensureConstructionSubsidy() {
    if (!completed(OBJECTIVES.ORE)
        || QuestStore.getObjectiveProgress(FIRST_PLANE_SETTLEMENT_QUEST_ID, OBJECTIVES.SUBSIDY) >= 1) {
        return 0;
    }
    const added = EnergyManager.depositEnergy(FIRST_PLANE_CONSTRUCTION_SUBSIDY, {
        accounting: { ignore: true },
    });
    QuestStore.setObjectiveProgress(FIRST_PLANE_SETTLEMENT_QUEST_ID, OBJECTIVES.SUBSIDY, 1);
    return added;
}

function foundingSceneId() {
    const founding = WorldProgressionSystem.getFoundingState();
    return founding?.status === 'founded' ? founding.sceneId : null;
}

function currentSceneId() {
    return typeof window !== 'undefined' ? window.SceneManager?.currentScene : null;
}

function isLiveInFoundingScene(sceneId = currentSceneId()) {
    const firstCity = foundingSceneId();
    return !!firstCity && sceneId === firstCity && currentSceneId() === firstCity;
}

function liveBuilding(cfgKey) {
    if (!isLiveInFoundingScene()) return null;
    return Array.from(Game.entities?.values?.() || []).find((entity) =>
        entity?.active !== false
        && !entity?._sinking
        && Number(entity?.hp ?? entity?.data?.hp ?? 1) > 0
        && entity?.cfgKey === cfgKey) || null;
}

function nearestEnergyNode() {
    if (!isLiveInFoundingScene()) return null;
    const playerX = Number(Game.player?.x) || 0;
    const playerY = Number(Game.player?.y) || 0;
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const entity of Game.entities?.values?.() || []) {
        if (!entity?._isEnergyNode || entity.active === false || entity._depleted
            || Number(entity.hp) <= 0) continue;
        const distance = Math.hypot((Number(entity.x) || 0) - playerX,
            (Number(entity.y) || 0) - playerY);
        if (distance >= nearestDistance) continue;
        nearest = entity;
        nearestDistance = distance;
    }
    return nearest;
}

function hasWorkers(building) {
    return Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0)) > 0;
}

function needsResearcherTransfer(institute, windmill) {
    return !hasWorkers(institute)
        && hasWorkers(windmill)
        && Math.max(0, Math.floor(Number(PopulationEconomySystem.getPopulationSnapshot()?.free) || 0)) <= 0;
}

function hasSelectedResearchTargetWithStaff() {
    const institute = liveBuilding(BUILDING_IDS.RESEARCH_INSTITUTE);
    return hasWorkers(institute)
        && !!TechnologySystem.state?.targetTechId
        && !!TechnologySystem.state?.activeTechId
        && TechnologySystem.state?.activeSource === 'target';
}

/**
 * 首城教程只把 QuestStore 当作进度账本；建筑、人口岗位、矿石入库与科研
 * 产出仍分别以现有业务系统为真源。目标严格按顺序结算，提前建造不会丢失，
 * 但必须等前一步完成后才会进入下一阶段。
 */
export const FirstPlaneSettlementTutorial = {
    OBJECTIVES,
    BUILDING_IDS,

    startForScene(sceneId = currentSceneId()) {
        if (!isLiveInFoundingScene(sceneId)) return { accepted: false, stage: this.getStage() };
        const wasAvailable = QuestStore.getStatus(FIRST_PLANE_SETTLEMENT_QUEST_ID) === 'available';
        if (wasAvailable) QuestStore.acceptQuest(FIRST_PLANE_SETTLEMENT_QUEST_ID);
        this.syncLiveProgress();
        return { accepted: wasAvailable, stage: this.getStage() };
    },

    syncLiveProgress() {
        if (QuestStore.getStatus(FIRST_PLANE_SETTLEMENT_QUEST_ID) !== 'active'
            || !isLiveInFoundingScene()) return this.getStage();

        if (!completed(OBJECTIVES.WAREHOUSE)) {
            if (!liveBuilding(BUILDING_IDS.WAREHOUSE)) return this.getStage();
            complete(OBJECTIVES.WAREHOUSE);
        }
        if (!completed(OBJECTIVES.ORE)) return this.getStage();
        ensureConstructionSubsidy();
        if (!completed(OBJECTIVES.HOUSE)) {
            if (!liveBuilding(BUILDING_IDS.HOUSE)) return this.getStage();
            complete(OBJECTIVES.HOUSE);
        }
        if (!completed(OBJECTIVES.WINDMILL)) {
            const windmill = liveBuilding(BUILDING_IDS.WINDMILL);
            if (!windmill || !hasWorkers(windmill)) return this.getStage();
            complete(OBJECTIVES.WINDMILL);
        }
        if (!completed(OBJECTIVES.RESEARCH_INSTITUTE)) {
            if (!liveBuilding(BUILDING_IDS.RESEARCH_INSTITUTE)) return this.getStage();
            complete(OBJECTIVES.RESEARCH_INSTITUTE);
        }
        if (!completed(OBJECTIVES.START_RESEARCH) && hasSelectedResearchTargetWithStaff()) {
            complete(OBJECTIVES.START_RESEARCH);
        }
        return this.getStage();
    },

    recordBuildingPlaced({ sceneId } = {}) {
        if (!isLiveInFoundingScene(sceneId)) return this.getStage();
        return this.syncLiveProgress();
    },

    recordWorkersChanged({ sceneId } = {}) {
        if (!isLiveInFoundingScene(sceneId)) return this.getStage();
        return this.syncLiveProgress();
    },

    recordOreGathered({ sceneId, amount, destination } = {}) {
        if (QuestStore.getStatus(FIRST_PLANE_SETTLEMENT_QUEST_ID) !== 'active'
            || !isLiveInFoundingScene(sceneId)
            || destination !== 'warehouse'
            || !completed(OBJECTIVES.WAREHOUSE)
            || completed(OBJECTIVES.ORE)) return this.getStage();
        const added = Math.max(0, Math.floor(Number(amount) || 0));
        if (added <= 0) return this.getStage();
        const current = QuestStore.getObjectiveProgress(
            FIRST_PLANE_SETTLEMENT_QUEST_ID,
            OBJECTIVES.ORE
        );
        const next = Math.min(FIRST_PLANE_ORE_TARGET, current + added);
        QuestStore.setObjectiveProgress(
            FIRST_PLANE_SETTLEMENT_QUEST_ID,
            OBJECTIVES.ORE,
            next
        );
        // 教学经济闭环：3000 初始能源 + 300 实采 + 1200 补给，刚好覆盖风车与研究所。
        // 隐藏任务目标保证只发一次，也允许已完成采矿的旧存档在恢复时补领。
        ensureConstructionSubsidy();
        return this.syncLiveProgress();
    },

    recordTechnologyChanged({ reason, completedNode } = {}) {
        if (QuestStore.getStatus(FIRST_PLANE_SETTLEMENT_QUEST_ID) !== 'active') {
            return this.getStage();
        }
        this.syncLiveProgress();
        if (!completed(OBJECTIVES.RESEARCH_INSTITUTE)) return this.getStage();

        const manuallyTargetedWithStaff = reason === 'manual-target'
            && hasSelectedResearchTargetWithStaff();
        if (!completed(OBJECTIVES.START_RESEARCH) && manuallyTargetedWithStaff) {
            complete(OBJECTIVES.START_RESEARCH);
        }
        const producedResearch = reason === 'progress' || (reason === 'completed' && completedNode);
        if (producedResearch && completed(OBJECTIVES.START_RESEARCH)) {
            complete(OBJECTIVES.PRODUCE_RESEARCH);
            QuestStore.setQuestCompleted(FIRST_PLANE_SETTLEMENT_QUEST_ID, true);
        }
        return this.getStage();
    },

    getStage() {
        const status = QuestStore.getStatus(FIRST_PLANE_SETTLEMENT_QUEST_ID);
        if (status === 'completed') return 'completed';
        if (status !== 'active') return 'inactive';
        if (!completed(OBJECTIVES.WAREHOUSE)) return 'build_warehouse';
        if (!completed(OBJECTIVES.ORE)) return 'gather_ore';
        if (!completed(OBJECTIVES.HOUSE)) return 'build_house';
        if (!completed(OBJECTIVES.WINDMILL)) return 'operate_windmill';
        if (!completed(OBJECTIVES.RESEARCH_INSTITUTE)) return 'build_research_institute';
        if (!completed(OBJECTIVES.START_RESEARCH)) return 'start_research';
        if (!completed(OBJECTIVES.PRODUCE_RESEARCH)) return 'produce_research';
        return 'completed';
    },

    getAnnouncementForStage(stage = this.getStage()) {
        const announcements = {
            build_warehouse: '小鼠大王通讯：先为首城建立物资中枢。下一步，建造首座免费仓库。',
            gather_ore: `仓库已启用。下一步，跟随金色箭头采集并实际入库 ${FIRST_PLANE_ORE_TARGET} 能源。`,
            build_house: `采矿达标，${FIRST_PLANE_CONSTRUCTION_SUBSIDY} 能源建设补给已结算。下一步，建造免费房屋。`,
            operate_windmill: '首批居民已落户。下一步，建造麦田风车并安排 1 名农夫。',
            build_research_institute: '粮食生产链已启动。下一步，建造研究所。',
            start_research: '研究所已落成。下一步，安排至少 1 名研究员；没有空闲居民时，可以从风车调任农夫。',
            produce_research: '研究目标已确定。保持研究员在岗，让研究进度开始增长。',
            completed: '小鼠大王通讯：不错。仓库能够储存物资，风车能够养活居民，研究所也开始推动科技了——这座基地已经能够自行运转。接下来，就按你的想法扩建它吧。',
        };
        return announcements[stage] || '';
    },

    getActiveHint() {
        const stage = this.getStage();
        const firstCity = foundingSceneId();
        if (stage === 'inactive' || stage === 'completed') return '';
        if (!isLiveInFoundingScene()) {
            const cityName = firstCity
                ? (WorldProgressionSystem.getWorldDisplayName(firstCity) || '首座位面')
                : '首座位面';
            return `按 O 打开位面航图并进入${cityName}，继续首城建设教程。`;
        }
        if (stage === 'build_warehouse') {
            return '按 B 打开建筑菜单，选择“仓库”并放在市政厅附近。首座仓库免费，建成后发放 3000 能源与 500 食物。';
        }
        if (stage === 'gather_ore') {
            const current = Math.floor(QuestStore.getObjectiveProgress(
                FIRST_PLANE_SETTLEMENT_QUEST_ID,
                OBJECTIVES.ORE
            ));
            return `靠近金色标记的能源矿脉并攻击；只有实际进入仓库的能源才计数。当前 ${current}/${FIRST_PLANE_ORE_TARGET} 能源，达标后发放 ${FIRST_PLANE_CONSTRUCTION_SUBSIDY} 能源建设补给。`;
        }
        if (stage === 'build_house') {
            return '按 B 建造“房屋”。首座房屋免费，并立即带来 1 名居民；没有居民，风车和研究所都不会运转。';
        }
        if (stage === 'operate_windmill') {
            const windmill = liveBuilding(BUILDING_IDS.WINDMILL);
            return windmill
                ? '点击麦田风车，在建筑详情的岗位区点击“+1”或“最大”；至少 1 名农夫上岗后才会持续生产食物。'
                : '按 B 建造“麦田风车”（1500 能源）；建成后还要点击建筑并安排至少 1 名农夫。';
        }
        if (stage === 'build_research_institute') {
            return '按 B 建造“研究所”（3000 能源）。能源不足时，继续攻击金色标记的矿脉并等待能源实际入库。';
        }
        if (stage === 'start_research') {
            const institute = liveBuilding(BUILDING_IDS.RESEARCH_INSTITUTE);
            if (!hasWorkers(institute)) {
                const windmill = liveBuilding(BUILDING_IDS.WINDMILL);
                return needsResearcherTransfer(institute, windmill)
                    ? '点击麦田风车，在岗位区点击“-1”撤下农夫；再点击研究所点击“+1”，把这名居民调任为研究员。调任期间风车会暂停，完成教学后可自行调整岗位。'
                    : '点击研究所，在岗位区点击“+1”，安排至少 1 名研究员；没有研究员时科研速度为 0。';
            }
            return '按 Y 打开科技树，选择任意可研究科技并设为目标；推荐先研究 60 点的“工程制图”。';
        }
        if (stage === 'produce_research') {
            const activeId = TechnologySystem.state?.activeTechId;
            const node = TechnologySystem.getNode(activeId);
            const progress = node ? Math.floor(TechnologySystem.getProgress(node.id)) : 0;
            return node
                ? `正在研究“${node.name}”：${progress}/${node.researchCost}。保持研究员在岗；研究进度开始增长后，即可完成新手引导。`
                : '保持研究所有研究员在岗；按 Y 重新选择任意可研究科技，让研究进度开始增长。';
        }
        return '';
    },

    getGuideState() {
        if (QuestStore.getStatus(FIRST_PLANE_SETTLEMENT_QUEST_ID) !== 'active') return null;
        const stage = this.getStage();
        if (stage === 'completed') return null;
        const inFirstCity = isLiveInFoundingScene();
        if (!inFirstCity) {
            return {
                stage: `return_to_city:${stage}`,
                seriesLabel: '首城建设',
                step: Math.max(1, ['build_warehouse', 'gather_ore', 'build_house', 'operate_windmill',
                    'build_research_institute', 'start_research', 'produce_research'].indexOf(stage) + 1),
                total: 7,
                title: '返回首座位面',
                targetId: null,
                targetLabel: '位面航图',
                domTargetSelector: '#worldSwitchBtn',
                detail: this.getActiveHint(),
            };
        }

        const ore = stage === 'gather_ore' ? nearestEnergyNode() : null;
        const windmill = liveBuilding(BUILDING_IDS.WINDMILL);
        const institute = liveBuilding(BUILDING_IDS.RESEARCH_INSTITUTE);
        const reassignResearcher = stage === 'start_research'
            && needsResearcherTransfer(institute, windmill);
        const models = {
            build_warehouse: {
                step: 1, title: '建立物资仓库', targetId: liveBuilding(BUILDING_IDS.CITY_HALL)?.id,
                targetLabel: '按 B · 建筑菜单 · 仓库', domTargetSelector: '.build-panel.active .we-thumb[data-id="warehouse"]',
            },
            gather_ore: {
                step: 2, title: '采集 300 能源', targetId: ore?.id,
                directionTargetId: ore?.id,
                targetLabel: `能源矿脉 · ${FIRST_PLANE_ORE_TARGET} 能源`,
            },
            build_house: {
                step: 3, title: '安置首批居民', targetId: null,
                targetLabel: '按 B · 建筑菜单 · 房屋', domTargetSelector: '.build-panel.active .we-thumb[data-id="house"]',
            },
            operate_windmill: {
                step: 4, title: windmill ? '安排风车农夫' : '建造麦田风车', targetId: windmill?.id,
                targetLabel: windmill ? '麦田风车 · 岗位区' : '按 B · 建筑菜单 · 麦田风车',
                domTargetSelector: windmill
                    ? '#producerBuildingPanel [data-worker-delta="1"]'
                    : '.build-panel.active .we-thumb[data-id="wheat_windmill"]',
            },
            build_research_institute: {
                step: 5, title: '建造研究所', targetId: null,
                targetLabel: '按 B · 建筑菜单 · 研究所', domTargetSelector: '.build-panel.active .we-thumb[data-id="research_institute"]',
            },
            start_research: {
                step: 6,
                title: hasWorkers(institute) ? '选择研究目标' : (reassignResearcher ? '调任风车农夫' : '安排研究员'),
                targetId: reassignResearcher ? windmill?.id : institute?.id,
                targetLabel: hasWorkers(institute)
                    ? '科技树 · 工程制图'
                    : (reassignResearcher ? '麦田风车 · 撤下 1 名农夫' : '研究所 · 岗位区'),
                domTargetSelector: hasWorkers(institute)
                    ? `#technologyTreePanel [data-tech-id="${FIRST_PLANE_RECOMMENDED_TECH_ID}"], #technologyTreeBtn`
                    : (reassignResearcher
                        ? '#producerBuildingPanel [data-worker-delta="-1"]'
                        : '#producerBuildingPanel [data-worker-delta="1"]'),
            },
            produce_research: {
                step: 7, title: '启动科技研究', targetId: institute?.id,
                targetLabel: TechnologySystem.getNode(TechnologySystem.state?.activeTechId)?.name || '科技树',
                domTargetSelector: TechnologySystem.state?.activeTechId
                    ? `#technologyTreePanel [data-tech-id="${TechnologySystem.state.activeTechId}"], #technologyTreeBtn`
                    : '#technologyTreeBtn',
            },
        };
        return {
            stage,
            seriesLabel: '首城建设',
            total: 7,
            ...models[stage],
            detail: this.getActiveHint(),
        };
    },
};

export default FirstPlaneSettlementTutorial;
