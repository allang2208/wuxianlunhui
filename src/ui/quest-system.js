
import { ItemDatabase } from '../items/item-database.js';
import { Game } from '../game.js';
import { SceneManager } from '../world/scene-manager.js';
// Quest System - 任务日志系统
import { FloatingTextEffect } from '../effects/floating-text.js';
import { UIState } from './ui-state.js';
import { EffectManager } from '../effects/effect-manager.js';
import { queryAllElements, getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { DropItem } from '../entities/drop-item.js';
import { NPCDialogue } from './npc-dialogue.js';
import { RewardSystem } from './reward-system.js';
import { EquipManager } from './equip-manager.js';
import { GameUIManager } from './game-ui-manager.js';
export const QuestSystem = {
    _isOpen: false,
    _selectedQuest: 'explore_rift_1',
    _fromNPC: false, // 标记是否从小鼠侍从NPC打开的任务栏

    // 任务数据库
    QUESTS: {
        'explore_rift_1': {
            id: 'explore_rift_1',
            name: '探索时空裂隙',
            type: '主线任务',
            desc: '根据线索，近期发现不同世界中出现了时空乱流和时空不稳定的裂隙，前往最近发生情况的181号世界，找到发生时空裂隙的地方，收集线索调查。',
            objectives: [
                { id: 'rift_1', text: '完成三个时空裂隙的线索收集', current: 0, target: 3 },
                { id: 'evacuate', text: '成功从 181 世界中撤离', current: 0, target: 1 }
            ],
            rewards: [
                { type: 'level', text: '提升一级' },
                { type: 'gold', text: '500 金币' },
                { type: 'weapon', text: '随机优质武器' }
            ],
            completed: false,
            accepted: false,
            scene: 'scene2'
        }
    },

    open() {
        UIState.open('quest');
        this._isOpen = true;
        const panel = getElement('questPanel');
        if (panel) {
            panel.classList.add('active');
        }
        // 打开面板时隐藏右侧侧边栏图标
        queryAllElements('.side-menu').forEach(m => m.classList.add('hidden'));
        this._render();
    },

    close() {
        UIState.close('quest');
        this._isOpen = false;
        this._fromNPC = false; // 关闭时重置来源标记
        const panel = getElement('questPanel');
        if (panel) {
            panel.classList.remove('active');
        }
        queryAllElements('.side-menu').forEach(m => m.classList.remove('hidden'));
        if (NPCDialogue.active) {
            NPCDialogue.exitCompactMode();
        }
    },

    toggle() {
        if (UIState.isOpen('quest')) this.close();
        else this.open();
    },

    selectQuest(questId) {
        this._selectedQuest = questId;
        this._render();
    },

    // 接受任务
    acceptQuest() {
        const quest = this.QUESTS[this._selectedQuest];
        if (quest) {
            quest.accepted = true;
            // 任务栏版本：不传送，仅更新追踪栏
            if (typeof QuestTracker !== 'undefined') QuestTracker.update();
        }
        this.close();
        if (NPCDialogue.active) NPCDialogue.close();
    },

    // 小鼠侍从专用：接受任务并直接传送到任务场景（旧版本行为）
    acceptQuestAndTeleport() {
        const quest = this.QUESTS[this._selectedQuest];
        if (quest) {
            quest.accepted = true;
            if (typeof QuestTracker !== 'undefined') QuestTracker.update();
            if (typeof QuestState !== 'undefined') {
                QuestState.startQuest(quest.scene, 'quest');
            }
        }
        this.close();
        if (NPCDialogue.active) NPCDialogue.close();
    },

    _render() {
        const listCol = getElement('questListCol');
        const detailCol = getElement('questDetailCol');
        if (!listCol || !detailCol) return;

        // 渲染任务列表
        listCol.innerHTML = Object.values(this.QUESTS).map(q => {
            const isCompleted = q.completed;
            const isActive = q.id === this._selectedQuest;
            const checkMark = isCompleted ? '<span class="quest-item-check">✓</span>' : '';
            return `
                <div class="quest-list-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}" data-quest="${q.id}">
                    <div class="quest-item-name">${q.name}${checkMark}</div>
                    <div class="quest-item-type">${q.type}</div>
                </div>
            `;
        }).join('');

        listCol.querySelectorAll('.quest-list-item').forEach(el => {
            el.onclick = () => this.selectQuest(el.dataset.quest);
        });

        // 渲染任务详情
        const quest = this.QUESTS[this._selectedQuest];
        if (!quest) {
            detailCol.innerHTML = '<div class="quest-detail-desc">暂无任务</div>';
            return;
        }

        const objectivesHtml = quest.objectives.map(obj => {
            const isDone = obj.current >= obj.target;
            return `<div class="quest-objective-item ${isDone ? 'completed' : ''}">${obj.text} (${obj.current}/${obj.target})</div>`;
        }).join('');

        const rewardsHtml = quest.rewards.map(r => `<div class="quest-reward-item">• ${r.text}</div>`).join('');

        const statusText = quest.completed ? '已完成' : (quest.accepted ? '进行中' : '未接受');
        const statusClass = quest.completed ? 'quest-status-completed' : 'quest-status-active';

        detailCol.innerHTML = `
            <div class="quest-detail-title">${quest.name}</div>
            <div class="quest-detail-desc">${quest.desc}</div>
            <div class="quest-detail-objectives">
                <div class="quest-objective-title">具体目标：</div>
                ${objectivesHtml}
            </div>
            <div class="quest-detail-rewards">
                <div class="quest-reward-label">任务奖励：</div>
                ${rewardsHtml}
            </div>
            <div class="quest-detail-status ${statusClass}">状态：${statusText}</div>
            ${!quest.accepted && !quest.completed ? `<div style="margin-top:12px;"><button class="quest-btn quest-btn-accept" onclick="QuestSystem.acceptQuest()">接受任务</button></div>` : ''}
        `;
    }
};

// QuestState - 全局任务状态管理（运行时）
export const QuestState = {
    activeQuest: null,
    currentScene: null,
    mode: null,
    riftProgress: [0, 0, 0],
    riftCompleted: [false, false, false],
    questCompleted: false,
    returnPortalSpawned: false,
    _questDied: false,

    startQuest(sceneId, mode) {
        this.activeQuest = 'explore_rift_1';
        this.currentScene = sceneId;
        this.mode = mode;
        this.riftProgress = [0, 0, 0];
        this.riftCompleted = [false, false, false];
        this.questCompleted = false;
        this.returnPortalSpawned = false;
        this._questDied = false;
        // 重置 QuestSystem 中的任务进度
        const quest = QuestSystem.QUESTS['explore_rift_1'];
        if (quest) {
            quest.objectives.forEach(obj => obj.current = 0);
            quest.completed = false;
        }
        SceneManager.switchScene(sceneId, Game.player, mode);
    },

    manualStart(sceneId) {
        this.startQuest(sceneId, 'quest');
    },

    reset() {
        this.activeQuest = null;
        this.currentScene = null;
        this.mode = null;
        this.riftProgress = [0, 0, 0];
        this.riftCompleted = [false, false, false];
        this.questCompleted = false;
        this.returnPortalSpawned = false;
        this._questDied = true;
    },

    // 检查是否在任务中
    isInQuest() {
        return this.activeQuest !== null && this.mode === 'quest';
    },

    // 完成一个裂隙调查
    completeRift(index) {
        if (index >= 0 && index < 3 && !this.riftCompleted[index]) {
            this.riftCompleted[index] = true;
            this.riftProgress[index] = 1;
            // 更新QuestSystem中的任务进度
            if (QuestSystem.QUESTS['explore_rift_1']) {
                QuestSystem.QUESTS['explore_rift_1'].objectives[0].current = this.riftCompleted.filter(Boolean).length;
            }
            // 更新追踪栏
            if (typeof QuestTracker !== 'undefined') QuestTracker.update();
        }
    },

    // 完成撤离
    completeEvacuation() {
        this.returnPortalSpawned = true;
        if (QuestSystem.QUESTS['explore_rift_1']) {
            QuestSystem.QUESTS['explore_rift_1'].objectives[1].current = 1;
        }
        if (typeof QuestTracker !== 'undefined') QuestTracker.update();
    },

    // 完成任务
    finishQuest() {
        this.questCompleted = true;
        if (QuestSystem.QUESTS['explore_rift_1']) {
            QuestSystem.QUESTS['explore_rift_1'].completed = true;
        }
        // 打开奖励结算界面（三选一）
        if (typeof RewardSystem !== 'undefined' && RewardSystem.open) {
            // 延迟打开，确保场景切换完成
            TimerManager.setTimeout(() => RewardSystem.open(), 800);
        } else {
            // 后备：直接发放奖励
            this._grantRewards();
        }
        if (typeof QuestTracker !== 'undefined') QuestTracker.update();
    },

    // 发放奖励
    _grantRewards() {
        if (!Game.player) return;
        const p = Game.player;

        // 1. 提升一级（保留经验值）
        if (typeof LevelUpSystem !== 'undefined') {
            LevelUpSystem.levelUp(p);
        } else {
            // 备用方案
            const savedExp = p.data.exp;
            p.data.level++;
            p.data.maxExp = p.getExpForLevel(p.data.level);
            p.data.exp = Math.min(savedExp, p.data.maxExp);
            p.data.attrPoints += 2;
        }

        // 2. 500金币
        p.data.money = (p.data.money || 0) + 500;

        // 3. 随机优质武器
        this._grantRandomWeapon(p);

        // 显示完成提示
        EffectManager.add(new FloatingTextEffect(p.x, p.y - 50, '任务完成！', '#ffd700'));
        if (typeof GameUIManager !== 'undefined') GameUIManager.updateUI();
    },

    // 发放随机优质武器
    _grantRandomWeapon(player) {
        const rareWeapons = Object.values(ItemDatabase.items || {}).filter(item =>
            item.rarity === 'rare' || item.rarity === 'epic'
        );
        if (rareWeapons.length === 0) return;
        const weapon = rareWeapons[Math.floor(Math.random() * rareWeapons.length)];
        const instance = ItemDatabase.createInstance ? ItemDatabase.createInstance(weapon.id) : { ...weapon };

        // 尝试放入背包
        const maxSlots = EquipManager.maxBackpackSlots || 36;
        const backpack = EquipManager.backpackItems || (EquipManager.backpackItems = []);
        const usedSlots = new Set(backpack.map(i => i.slot));
        let slot = 0;
        while (usedSlots.has(slot) && slot < maxSlots) slot++;
        if (slot < maxSlots) {
            instance.slot = slot;
            backpack.push(instance);
            EquipManager.updateInventorySlots();
        } else {
            // 背包满，放在地上
            if (typeof DropItem !== 'undefined') {
                DropItem.create(player.x + 20, player.y, instance);
            }
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 30, '背包已满，武器已放在地上', '#ff6666'));
        }
    }
};

// QuestTracker - 任务追踪栏（地图栏下方）
export const QuestTracker = {
    init() {
        this._createElement();
    },

    _createElement() {
        const existing = getElement('questTracker');
        if (existing) return;
        const tracker = document.createElement('div');
        tracker.id = 'questTracker';
        tracker.className = 'quest-tracker';
        tracker.innerHTML = `
            <div class="quest-tracker-title">📜 任务追踪</div>
            <div class="quest-tracker-content" id="questTrackerContent"></div>
        `;
        getElement('gameContainer').appendChild(tracker);
    },

    update() {
        const content = getElement('questTrackerContent');
        if (!content) return;

        const quest = QuestSystem.QUESTS['explore_rift_1'];
        if (!quest || !quest.accepted) {
            content.innerHTML = '<div class="quest-tracker-empty">暂无进行中的任务</div>';
            return;
        }

        const objHtml = quest.objectives.map(obj => {
            const done = obj.current >= obj.target;
            return `<div class="quest-tracker-obj ${done ? 'completed' : ''}">${obj.text} (${obj.current}/${obj.target})</div>`;
        }).join('');

        content.innerHTML = `
            <div class="quest-tracker-name">${quest.type}：${quest.name}</div>
            ${objHtml}
        `;
    }
};

// LevelUpSystem - 等级提升系统
export const LevelUpSystem = {
    levelUp(player) {
        const savedExp = player.data.exp;
        player.data.level++;
        player.data.maxExp = player.getExpForLevel(player.data.level);
        player.data.exp = Math.min(savedExp, player.data.maxExp);
        player.data.attrPoints += 2;
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 50, `等级提升！Lv.${player.data.level}`, '#ffd700'));
        if (typeof GameUIManager !== 'undefined') GameUIManager.updateUI();
    }
};
