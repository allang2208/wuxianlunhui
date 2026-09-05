import { ItemDatabase } from '../items/item-database.js';
import { EquipManager } from '../ui/equip-manager.js';
import { WarehouseSystem } from '../ui/warehouse-system.js';
import { countDungeonKeys } from '../config/dungeon-key-config.js';
import { WorldProgressionSystem } from '../world/world-progression-system.js';
import { QuestStore } from './quest-store.js';

export const FIRST_EXPEDITION_QUEST_ID = 'first_city_founding';
export const FIRST_EXPEDITION_DUNGEON_ID = 'abandonedMineBeginner';

const STARTER_KEY_ID = 'anchorTokenF';
const STARTER_KEY_GRADE = 'F';

const OBJECTIVES = Object.freeze({
    KEY: 'claim_starter_key',
    ALTAR: 'open_expedition_altar',
    DUNGEON: 'complete_first_dungeon',
    FOUNDING: 'claim_founding',
});

function completed(objectiveId) {
    return QuestStore.getObjectiveProgress(FIRST_EXPEDITION_QUEST_ID, objectiveId) >= 1;
}

function complete(objectiveId) {
    if (!completed(objectiveId)) {
        QuestStore.setObjectiveProgress(FIRST_EXPEDITION_QUEST_ID, objectiveId, 1);
    }
}

function dungeonRunActive() {
    return !!(typeof window !== 'undefined' && window.SceneManager?.isDungeonRunActive?.());
}

function backpackFull() {
    return (EquipManager.backpackItems?.length || 0) >= (EquipManager.maxBackpackSlots || 0);
}

/**
 * 首次探索只把 QuestStore 当作引导进度账本；地牢通关与位面授予仍分别以
 * WorldProgressionSystem.completedDungeons / founding 为业务真源。
 */
export const FirstExpeditionTutorial = {
    OBJECTIVES,

    startNewRun() {
        QuestStore.acceptQuest(FIRST_EXPEDITION_QUEST_ID);
        return this.getStage();
    },

    syncFromWorldProgression(status = WorldProgressionSystem.getFoundingState()?.status) {
        if (QuestStore.getStatus(FIRST_EXPEDITION_QUEST_ID) !== 'completed') {
            QuestStore.acceptQuest(FIRST_EXPEDITION_QUEST_ID);
        }
        if (WorldProgressionSystem.hasCompletedDungeon(FIRST_EXPEDITION_DUNGEON_ID)
            || status === 'awaiting_king' || status === 'selecting' || status === 'founded') {
            complete(OBJECTIVES.KEY);
            complete(OBJECTIVES.ALTAR);
            complete(OBJECTIVES.DUNGEON);
        }
        if (status === 'founded') {
            complete(OBJECTIVES.FOUNDING);
            QuestStore.setQuestCompleted(FIRST_EXPEDITION_QUEST_ID, true);
        }
        return this.getStage();
    },

    grantStarterKey() {
        if (QuestStore.getStatus(FIRST_EXPEDITION_QUEST_ID) === 'completed'
            || WorldProgressionSystem.hasCompletedDungeon(FIRST_EXPEDITION_DUNGEON_ID)) {
            return { ok: false, reason: '首次探索已经完成，不会重复发放新手钥匙。' };
        }
        QuestStore.acceptQuest(FIRST_EXPEDITION_QUEST_ID);
        if (this.hasUsableFKey()) {
            complete(OBJECTIVES.KEY);
            return { ok: true, duplicate: true };
        }

        const key = ItemDatabase.createInstance(STARTER_KEY_ID, { stack: 1 });
        if (!key) return { ok: false, reason: 'F 级时空锚点尚未载入，请稍后重试。' };
        try {
            if (!EquipManager.addToInventory(key)) {
                return { ok: false, full: true, reason: '背包已经满了。请先腾出至少 1 个格子，再回来领取；新手钥匙不会转入仓库或信箱。' };
            }
            const replacement = completed(OBJECTIVES.KEY);
            complete(OBJECTIVES.KEY);
            return { ok: true, backpack: 1, replacement };
        } catch (error) {
            console.error('[FirstExpeditionTutorial] F 级新手钥匙发放失败:', error);
            return { ok: false, reason: '新手钥匙未能放入背包，请稍后重试。' };
        }
    },

    markAltarOpened() {
        if (QuestStore.getStatus(FIRST_EXPEDITION_QUEST_ID) !== 'active'
            || !completed(OBJECTIVES.KEY) || completed(OBJECTIVES.ALTAR)
            || !this.hasUsableFKey()) return false;
        complete(OBJECTIVES.ALTAR);
        return true;
    },

    hasUsableFKey() {
        return countDungeonKeys(EquipManager.backpackItems || [], STARTER_KEY_GRADE)
            + countDungeonKeys(WarehouseSystem.items || [], STARTER_KEY_GRADE) > 0;
    },

    hasStarterKeyInBackpack() {
        return countDungeonKeys(EquipManager.backpackItems || [], STARTER_KEY_GRADE) > 0;
    },

    hasStarterKeyInWarehouse() {
        return countDungeonKeys(WarehouseSystem.items || [], STARTER_KEY_GRADE) > 0;
    },

    getStage() {
        if (QuestStore.getStatus(FIRST_EXPEDITION_QUEST_ID) === 'completed') return 'completed';
        if (!completed(OBJECTIVES.KEY)) return 'receive_key';
        if (!completed(OBJECTIVES.ALTAR)) {
            return this.hasUsableFKey() ? 'open_altar' : 'replace_key';
        }
        if (!completed(OBJECTIVES.DUNGEON)) {
            return !dungeonRunActive() && !this.hasUsableFKey() ? 'replace_key' : 'complete_dungeon';
        }
        if (!completed(OBJECTIVES.FOUNDING)) return 'claim_founding';
        return 'completed';
    },

    getActiveHint() {
        const stage = this.getStage();
        const foundingStatus = WorldProgressionSystem.getFoundingState()?.status;
        if (stage === 'receive_key') {
            return backpackFull()
                ? '使用 WASD 移动到小鼠大王附近，再用鼠标左键点击他进行交互。背包已满，请先腾出至少 1 个格子。'
                : '使用 WASD 移动到小鼠大王附近，再用鼠标左键点击他进行交互；确认领取后，F 级新手钥匙会直接放入背包。';
        }
        if (stage === 'replace_key') {
            return backpackFull()
                ? '首次探索尚未完成且背包已满：腾出至少 1 格后，返回小鼠大王免费补领 F 级钥匙。'
                : '首次探索尚未完成且当前没有 F 级钥匙：返回小鼠大王免费补领，再去中央祭坛。';
        }
        if (stage === 'open_altar') {
            return this.hasStarterKeyInWarehouse()
                ? 'F 级钥匙目前在仓库中；祭坛可以读取它。前往中央祭坛并选择“首次 F 级探索”。'
                : '携带背包中的 F 级钥匙前往中央祭坛，点击祭坛并选择“首次 F 级探索”。';
        }
        if (stage === 'complete_dungeon') {
            return dungeonRunActive()
                ? '当前正在执行首次探索：按基础战斗→随机事件→首领战→奖励房的单线顺序完成新手试炼。'
                : '在祭坛选择“废弃矿洞·初级”进入固定新手试炼；成功领取奖励后才会解锁大地图。';
        }
        if (stage === 'claim_founding') {
            return foundingStatus === 'selecting'
                ? '首城授予已批准：在位面航图中从当前合法候选里确认首城位置。'
                : '首次探索已完成，大地图已解锁。返回主神空间与小鼠大王交谈，开启首城选址。';
        }
        return '';
    },

    getGuideState() {
        if (QuestStore.getStatus(FIRST_EXPEDITION_QUEST_ID) !== 'active') return null;
        const stage = this.getStage();
        if (stage === 'completed') return null;
        if (stage === 'complete_dungeon' && dungeonRunActive()) {
            const combatGuide = typeof window !== 'undefined'
                ? window.DungeonMapSystem?.getTutorialCombatGuideState?.()
                : null;
            if (combatGuide) return combatGuide;
        }
        const foundingStatus = WorldProgressionSystem.getFoundingState()?.status;
        const models = {
            receive_key: { step: 1, title: '学习移动与交互', targetId: 'npc_mouse_king', targetLabel: '小鼠大王 · 鼠标左键' },
            replace_key: { step: 3, title: '补领 F 级钥匙', targetId: 'npc_mouse_king', targetLabel: '小鼠大王' },
            open_altar: { step: 2, title: '前往中央祭坛', targetId: 'npc_altar', targetLabel: '中央祭坛' },
            complete_dungeon: { step: 3, title: '完成首次探索', targetId: dungeonRunActive() ? null : 'npc_altar', targetLabel: '废弃矿洞·初级' },
            claim_founding: foundingStatus === 'selecting'
                ? { step: 4, title: '选择首座位面', targetId: null, targetLabel: '位面航图' }
                : { step: 4, title: '返回小鼠大王', targetId: 'npc_mouse_king', targetLabel: '小鼠大王' },
        };
        return { stage, ...models[stage], detail: this.getActiveHint() };
    },
};

export default FirstExpeditionTutorial;
