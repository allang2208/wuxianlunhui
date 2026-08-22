
import { ItemDatabase } from '../items/item-database.js';
import { Game } from '../game.js';
import { SceneManager } from '../world/scene-manager.js';
// Quest System - 任务日志系统
import { FloatingTextEffect } from '../effects/floating-text.js';
import { UIState } from './ui-state.js';
import { EffectManager } from '../effects/effect-manager.js';
import { queryAllElements } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { DropItem } from '../entities/drop-item.js';
import { NPCDialogue } from './npc-dialogue.js';
import { RewardSystem } from './reward-system.js';
import { EquipManager } from './equip-manager.js';
import { GameUIManager } from './game-ui-manager.js';
import { BasePanel } from './panels/base-panel.js';
import { mountRightSidebarPanel } from './right-sidebar-panel-layer.js';

export const QuestSystem = {
    _selectedQuest: 'explore_rift_1',
    _fromNPC: false, // 标记是否从小鼠侍从NPC打开的任务栏
    _panel: null,
    _lastFocusedElement: null,

    // 任务数据库
    QUESTS: {
        'explore_rift_1': {
            id: 'explore_rift_1',
            name: '探索时空裂隙',
            type: '主线任务',
            giver: '小鼠侍从',
            location: '181号世界 · 雪原裂隙',
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

    get _isOpen() { return UIState.isOpen('quest'); },

    _getPanel() {
        if (this._panel) return this._panel;

        this._panel = new BasePanel({
            id: 'questPanel',
            className: 'quest-panel bp-right-column',
            stateKey: 'quest',
            mountElement: (el) => mountRightSidebarPanel(el, 'panel', { bringToFront: true }),
        });
        this._panel.buildContent = (el) => this._buildPanelContent(el);
        this._panel.onOpen = () => {
            this._panel.el?.setAttribute('aria-hidden', 'false');
            queryAllElements('.side-menu').forEach(menu => menu.classList.add('hidden'));
            this._render();
            this._panel.el?.querySelector('.quest-panel-close')?.focus({ preventScroll: true });
        };
        this._panel.onClose = () => {
            const shouldRestoreFocus = !NPCDialogue.active;
            this._panel.el?.setAttribute('aria-hidden', 'true');
            queryAllElements('.side-menu').forEach(menu => menu.classList.remove('hidden'));
            this._fromNPC = false;
            if (NPCDialogue.active) NPCDialogue.exitCompactMode();
            if (shouldRestoreFocus
                && this._lastFocusedElement?.isConnected
                && typeof this._lastFocusedElement.focus === 'function') {
                this._lastFocusedElement.focus({ preventScroll: true });
            }
            this._lastFocusedElement = null;
        };
        return this._panel;
    },

    open() {
        const panel = this._getPanel();
        if (panel.isOpen) {
            mountRightSidebarPanel(panel.el, 'panel', { bringToFront: true });
            this._render();
            return;
        }
        this._lastFocusedElement = document.activeElement;
        panel.open();
    },

    close() {
        if (this._panel) this._panel.close();
    },

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    },

    selectQuest(questId) {
        if (!this.QUESTS[questId]) return;
        this._selectedQuest = questId;
        this._render();
    },

    // 接受任务
    acceptQuest() {
        const quest = this.QUESTS[this._selectedQuest];
        if (quest) {
            quest.accepted = true;
            // 任务栏版本：不传送，仅更新任务状态
            this._render();
        }
        this.close();
        if (NPCDialogue.active) NPCDialogue.close();
    },

    // 小鼠侍从专用：接受任务并直接传送到任务场景（旧版本行为）
    acceptQuestAndTeleport() {
        const quest = this.QUESTS[this._selectedQuest];
        if (quest) {
            quest.accepted = true;
            if (QuestState) {
                QuestState.startQuest(quest.scene, 'quest');
            }
        }
        this.close();
        if (NPCDialogue.active) NPCDialogue.close();
    },

    refresh() {
        if (this._isOpen) this._render();
    },

    _buildPanelContent(panel) {
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-labelledby', 'questPanelTitle');
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = `
            <header class="quest-panel-header bp-panel-header">
                <div class="quest-panel-header-copy bp-panel-header-copy">
                    <div class="quest-panel-eyebrow bp-type-meta">行动终端 / 任务档案</div>
                    <h2 class="quest-panel-title bp-type-title" id="questPanelTitle">任务档案</h2>
                </div>
                <div class="quest-panel-head-actions">
                    <span class="quest-panel-count bp-type-meta" id="questPanelCount" aria-live="polite"></span>
                    <button class="quest-panel-close bp-panel-close" type="button" aria-label="关闭任务档案">✕</button>
                </div>
            </header>
            <div class="quest-panel-body bp-panel-body">
                <aside class="quest-list-pane" aria-label="任务档案索引">
                    <div class="quest-pane-heading">
                        <div>
                            <div class="quest-section-kicker bp-type-caption">ARCHIVE INDEX</div>
                            <h3 class="quest-pane-title bp-type-subtitle">任务索引</h3>
                        </div>
                        <span class="quest-archive-summary bp-type-meta" id="questArchiveSummary"></span>
                    </div>
                    <div class="quest-overview" id="questOverview" aria-label="任务状态统计"></div>
                    <div class="quest-list-col" id="questListCol" aria-label="任务列表"></div>
                </aside>
                <section class="quest-detail-col" id="questDetailCol" aria-live="polite" aria-label="任务详情"></section>
            </div>`;

        panel.querySelector('.quest-panel-close')?.addEventListener('click', () => this.close());
        panel.querySelector('#questListCol')?.addEventListener('click', (event) => {
            const item = event.target.closest('[data-quest-id]');
            if (item) this.selectQuest(item.dataset.questId);
        });
        panel.querySelector('#questDetailCol')?.addEventListener('click', (event) => {
            if (event.target.closest('[data-quest-action="accept"]')) this.acceptQuest();
        });
    },

    _getQuestStatus(quest) {
        if (quest.completed) return { key: 'completed', text: '已完成' };
        if (quest.accepted) return { key: 'active', text: '进行中' };
        return { key: 'available', text: '待领取' };
    },

    _getQuestProgress(quest) {
        const objectives = Array.isArray(quest.objectives) ? quest.objectives : [];
        const total = objectives.reduce((sum, objective) => sum + Math.max(0, Number(objective.target) || 0), 0);
        const current = objectives.reduce((sum, objective) => {
            const target = Math.max(0, Number(objective.target) || 0);
            return sum + Math.min(target, Math.max(0, Number(objective.current) || 0));
        }, 0);
        const ratio = quest.completed ? 1 : (total > 0 ? current / total : 0);
        return {
            current,
            total,
            percent: Math.round(Math.max(0, Math.min(1, ratio)) * 100),
            completedObjectives: objectives.filter(objective => Number(objective.current) >= Number(objective.target)).length,
        };
    },

    _render() {
        const panel = this._panel?.el;
        if (!panel) return;
        const listCol = panel.querySelector('#questListCol');
        const detailCol = panel.querySelector('#questDetailCol');
        const overview = panel.querySelector('#questOverview');
        const panelCount = panel.querySelector('#questPanelCount');
        const archiveSummary = panel.querySelector('#questArchiveSummary');
        if (!listCol || !detailCol || !overview) return;

        const quests = Object.values(this.QUESTS);
        const activeCount = quests.filter(quest => quest.accepted && !quest.completed).length;
        const completedCount = quests.filter(quest => quest.completed).length;
        const availableCount = quests.length - activeCount - completedCount;
        if (panelCount) panelCount.textContent = `${activeCount} 进行中 / ${quests.length} 总计`;
        if (archiveSummary) archiveSummary.textContent = `${quests.length} 份档案`;
        overview.innerHTML = `
            <div class="quest-overview-stat"><span>待领取</span><strong>${availableCount}</strong></div>
            <div class="quest-overview-stat"><span>进行中</span><strong>${activeCount}</strong></div>
            <div class="quest-overview-stat"><span>已完成</span><strong>${completedCount}</strong></div>`;

        if (quests.length === 0) {
            listCol.innerHTML = '<div class="quest-empty-state bp-type-meta">暂无任务档案</div>';
            detailCol.innerHTML = '<div class="quest-empty-state quest-empty-state--detail"><strong>暂无可查看的任务</strong><span>新的行动档案会在这里归档。</span></div>';
            return;
        }

        if (!this.QUESTS[this._selectedQuest]) this._selectedQuest = quests[0].id;

        // 渲染任务列表
        listCol.innerHTML = quests.map(quest => {
            const status = this._getQuestStatus(quest);
            const progress = this._getQuestProgress(quest);
            const isCompleted = status.key === 'completed';
            const isActive = quest.id === this._selectedQuest;
            return `
                <button class="quest-list-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} quest-state-${status.key}"
                    type="button" data-quest-id="${quest.id}" aria-pressed="${isActive}">
                    <span class="quest-list-item-head">
                        <span class="quest-item-name">${quest.name}</span>
                        <span class="quest-item-status">${status.text}</span>
                    </span>
                    <span class="quest-item-meta">
                        <span>${quest.type}</span>
                        <span>${progress.percent}%</span>
                    </span>
                    <span class="quest-list-progress" aria-hidden="true"><span style="width:${progress.percent}%"></span></span>
                </button>
            `;
        }).join('');

        // 渲染任务详情
        const quest = this.QUESTS[this._selectedQuest];
        if (!quest) {
            detailCol.innerHTML = '<div class="quest-empty-state quest-empty-state--detail">暂无任务</div>';
            return;
        }

        const status = this._getQuestStatus(quest);
        const progress = this._getQuestProgress(quest);
        const objectivesHtml = quest.objectives.map((objective, index) => {
            const current = Math.max(0, Number(objective.current) || 0);
            const target = Math.max(0, Number(objective.target) || 0);
            const isDone = target > 0 && current >= target;
            const objectivePercent = target > 0 ? Math.round(Math.min(1, current / target) * 100) : 0;
            return `
                <div class="quest-objective-item ${isDone ? 'completed' : ''}">
                    <div class="quest-objective-row">
                        <span class="quest-objective-index">${isDone ? '✓' : String(index + 1).padStart(2, '0')}</span>
                        <span class="quest-objective-copy">${objective.text}</span>
                        <strong class="quest-objective-value">${current}/${target}</strong>
                    </div>
                    <div class="quest-objective-progress" role="progressbar" aria-label="${objective.text}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${current}">
                        <span style="width:${objectivePercent}%"></span>
                    </div>
                </div>`;
        }).join('');

        const rewardTypeLabels = { level: '成长', gold: '货币', weapon: '装备' };
        const rewardsHtml = quest.rewards.map(reward => `
            <div class="quest-reward-item">
                <span>${rewardTypeLabels[reward.type] || '奖励'}</span>
                <strong>${reward.text}</strong>
            </div>`).join('');

        let actionHtml = '';
        if (!quest.accepted && !quest.completed) {
            actionHtml = `
                <div class="quest-detail-actions bp-panel-actions">
                    <div class="quest-action-copy">
                        <strong>档案待确认</strong>
                        <span>接受后可返回小鼠侍从，选择进入任务世界。</span>
                    </div>
                    <button class="quest-btn quest-btn-accept bp-button" type="button" data-quest-action="accept">接受任务</button>
                </div>`;
        } else if (quest.completed) {
            actionHtml = `
                <div class="quest-action-state quest-action-state--completed">
                    <strong>任务已完成</strong>
                    <span>行动记录与奖励已归档。</span>
                </div>`;
        } else {
            const activeHint = QuestState.isInQuest()
                ? '当前正在任务世界执行行动目标。'
                : '任务已接受，可返回小鼠侍从进入任务世界。';
            actionHtml = `
                <div class="quest-action-state quest-action-state--active">
                    <strong>行动进行中</strong>
                    <span>${activeHint}</span>
                </div>`;
        }

        detailCol.innerHTML = `
            <div class="quest-detail-header">
                <div>
                    <div class="quest-section-kicker bp-type-caption">${quest.type} / ${quest.id}</div>
                    <h3 class="quest-detail-title bp-type-title">${quest.name}</h3>
                </div>
                <span class="quest-status-chip quest-state-${status.key}">${status.text}</span>
            </div>
            <div class="quest-detail-meta">
                <div><span>发布者</span><strong>${quest.giver || '未登记'}</strong></div>
                <div><span>目标区域</span><strong>${quest.location || quest.scene}</strong></div>
                <div><span>总体进度</span><strong>${progress.percent}%</strong></div>
            </div>
            <section class="quest-detail-section">
                <div class="quest-detail-section-heading">
                    <h4 class="quest-objective-title bp-type-subtitle">行动简报</h4>
                </div>
                <p class="quest-detail-desc bp-type-body">${quest.desc}</p>
            </section>
            <section class="quest-detail-section">
                <div class="quest-detail-section-heading">
                    <h4 class="quest-objective-title bp-type-subtitle">行动目标</h4>
                    <span>${progress.completedObjectives}/${quest.objectives.length} 完成</span>
                </div>
                <div class="quest-objective-list">${objectivesHtml}</div>
            </section>
            <section class="quest-detail-section">
                <div class="quest-detail-section-heading">
                    <h4 class="quest-reward-label bp-type-subtitle">任务奖励</h4>
                    <span>${quest.rewards.length} 项</span>
                </div>
                <div class="quest-reward-grid">${rewardsHtml}</div>
            </section>
            ${actionHtml}
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
        QuestSystem.refresh();
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
        QuestSystem.refresh();
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
            QuestSystem.refresh();
        }
    },

    // 完成撤离
    completeEvacuation() {
        this.returnPortalSpawned = true;
        if (QuestSystem.QUESTS['explore_rift_1']) {
            QuestSystem.QUESTS['explore_rift_1'].objectives[1].current = 1;
        }
        QuestSystem.refresh();
    },

    // 完成任务
    finishQuest() {
        this.questCompleted = true;
        if (QuestSystem.QUESTS['explore_rift_1']) {
            QuestSystem.QUESTS['explore_rift_1'].completed = true;
        }
        QuestSystem.refresh();
        // 打开奖励结算界面（三选一）
        if (RewardSystem && RewardSystem.open) {
            // 延迟打开，确保场景切换完成
            TimerManager.setTimeout(() => RewardSystem.open(), 800);
        } else {
            // 后备：直接发放奖励
            this._grantRewards();
        }
    },

    // 发放奖励
    _grantRewards() {
        if (!Game.player) return;
        const p = Game.player;

        // 1. 提升一级（保留经验值）
        if (LevelUpSystem) {
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
        if (GameUIManager) GameUIManager.updateUI();
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
            if (DropItem) {
                DropItem.create(player.x + 20, player.y, instance);
            }
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 30, '背包已满，武器已放在地上', '#ff6666'));
        }
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
        if (GameUIManager) GameUIManager.updateUI();
    }
};
