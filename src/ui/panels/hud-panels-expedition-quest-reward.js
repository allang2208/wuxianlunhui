import { QuestSystem } from '../quest-system.js';
import { ExpeditionSystem } from '../expedition-system.js';
import { DungeonConfig } from '../../config/dungeon-config.js';
export function createHudPanelsExpeditionQuestReward() {
    // 创建根元素
    const root = document.createElement('div');

    // ===== 出征准备黑色背景覆盖层 =====
    const expeditionOverlay = document.createElement('div');
    expeditionOverlay.id = 'expeditionOverlay';
    expeditionOverlay.className = 'expedition-overlay';
    root.appendChild(expeditionOverlay);

    // ===== 出征准备面板 =====
    const expeditionPanel = document.createElement('div');
    expeditionPanel.id = 'expeditionPanel';
    expeditionPanel.className = 'expedition-panel';
    const expeditionHeader = document.createElement('div');
    expeditionHeader.className = 'expedition-header';
    const expeditionTitle = document.createElement('span');
    expeditionTitle.className = 'expedition-title';
    expeditionTitle.textContent = '⚔ 出征准备';
    const expeditionClose = document.createElement('button');
    expeditionClose.className = 'expedition-close';
    expeditionClose.onclick = function() { ExpeditionSystem.close(); };
    expeditionClose.textContent = '✕';
    expeditionHeader.appendChild(expeditionTitle);
    expeditionHeader.appendChild(expeditionClose);
    expeditionPanel.appendChild(expeditionHeader);
    const expeditionBody = document.createElement('div');
    expeditionBody.className = 'expedition-body';
    // 地牢信息
    const expeditionInfo = document.createElement('div');
    expeditionInfo.className = 'expedition-info';
    const expeditionDungeonSelector = document.createElement('div');
    expeditionDungeonSelector.className = 'expedition-dungeon-selector';
    const dungeonLabel = document.createElement('label');
    dungeonLabel.htmlFor = 'expeditionDungeonSelect';
    dungeonLabel.style.cssText = 'color:#8a7d6b; font-size:12px;';
    dungeonLabel.textContent = '选择地牢：';
    const expeditionDungeonSelect = document.createElement('select');
    expeditionDungeonSelect.id = 'expeditionDungeonSelect';
    expeditionDungeonSelect.className = 'expedition-dungeon-select';
    expeditionDungeonSelect.onchange = function() { ExpeditionSystem.onDungeonSelect(this.value); };
    // 地牢选项由 data/dungeon-config.json 的 dungeonList 驱动（新增地牢只需改配置）
    const dungeonList = DungeonConfig.getDungeonList();
    for (const [value, info] of Object.entries(dungeonList)) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = (info && info.name) || value;
        expeditionDungeonSelect.appendChild(opt);
    }
    expeditionDungeonSelector.appendChild(dungeonLabel);
    expeditionDungeonSelector.appendChild(expeditionDungeonSelect);
    expeditionInfo.appendChild(expeditionDungeonSelector);
    // 水平信息行
    const expeditionInfoRow = document.createElement('div');
    expeditionInfoRow.className = 'expedition-info-row';
    const expeditionInfoDefs = [
        { label: '地牢名称', id: 'expeditionDungeonName', val: '☠ 僵尸地牢高级' },
        { label: '节点数', id: 'expeditionNodeCount', val: '35~40' },
        { label: '战斗节点', id: 'expeditionBattleRatio', val: '70%' },
        { label: '地牢等级', id: 'expeditionLevel', val: '1级', highlight: true },
        { label: '预计奖励', id: 'expeditionReward', val: '1500金币' }
    ];
    expeditionInfoDefs.forEach(sd => {
        const item = document.createElement('div');
        item.className = 'expedition-info-item';
        const itemLabel = document.createElement('span');
        itemLabel.className = 'expedition-info-label';
        itemLabel.textContent = sd.label + '：';
        const itemValue = document.createElement('span');
        itemValue.className = sd.highlight
            ? 'expedition-info-value expedition-info-value--level'
            : 'expedition-info-value';
        itemValue.id = sd.id;
        itemValue.textContent = sd.val;
        item.appendChild(itemLabel);
        item.appendChild(itemValue);
        expeditionInfoRow.appendChild(item);
    });
    expeditionInfo.appendChild(expeditionInfoRow);
    expeditionBody.appendChild(expeditionInfo);
    // 出征队员界面栏（四圆圈：玩家固定 + 3 名侍从槽；空=加号，有=头像）
    const expeditionParty = document.createElement('div');
    expeditionParty.className = 'expedition-party';
    const expeditionSectionTitle = document.createElement('div');
    expeditionSectionTitle.className = 'expedition-section-title';
    expeditionSectionTitle.innerHTML = '出征队员 <span class="expedition-hint">(最多4人)</span>';
    expeditionParty.appendChild(expeditionSectionTitle);
    const expeditionMemberBar = document.createElement('div');
    expeditionMemberBar.className = 'expedition-member-bar';
    expeditionMemberBar.id = 'expeditionMemberBar';
    // 四个圆圈由 ExpeditionSystem._renderMemberBar 渲染（玩家 + PartySystem 侍从）
    expeditionParty.appendChild(expeditionMemberBar);
    expeditionBody.appendChild(expeditionParty);
    // 祭品栏
    const expeditionSupplies = document.createElement('div');
    expeditionSupplies.className = 'expedition-supplies';
    const suppliesTitle = document.createElement('div');
    suppliesTitle.className = 'expedition-section-title';
    suppliesTitle.innerHTML = '祭品栏 <span class="expedition-hint">(从背包拖入)</span>\n                            <span style="float:right; color:#8a7a6a; font-size:11px;">\n                                <span id="expeditionCapacityUsed">0</span>/<span id="expeditionCapacityMax">10</span>\n                            </span>';
    expeditionSupplies.appendChild(suppliesTitle);
    const expeditionInventoryGrid = document.createElement('div');
    expeditionInventoryGrid.className = 'expedition-inventory-grid';
    expeditionInventoryGrid.id = 'expeditionInventoryGrid';
    expeditionSupplies.appendChild(expeditionInventoryGrid);
    const expeditionTributeStats = document.createElement('div');
    expeditionTributeStats.className = 'expedition-tribute-stats';
    expeditionTributeStats.id = 'expeditionTributeStats';
    expeditionTributeStats.style.display = 'none';
    const tributeStatsTitle = document.createElement('div');
    tributeStatsTitle.className = 'expedition-tribute-stats-title';
    tributeStatsTitle.textContent = '祭品效果统计';
    const tributeStatsList = document.createElement('div');
    tributeStatsList.className = 'expedition-tribute-stats-list';
    tributeStatsList.id = 'expeditionTributeStatsList';
    expeditionTributeStats.appendChild(tributeStatsTitle);
    expeditionTributeStats.appendChild(tributeStatsList);
    expeditionSupplies.appendChild(expeditionTributeStats);
    expeditionBody.appendChild(expeditionSupplies);
    // 操作按钮
    const expeditionActions = document.createElement('div');
    expeditionActions.className = 'expedition-actions';
    const expeditionResetBtn = document.createElement('button');
    expeditionResetBtn.className = 'expedition-reset-btn';
    expeditionResetBtn.id = 'expeditionResetBtn';
    expeditionResetBtn.onclick = function() { ExpeditionSystem.reset(); };
    expeditionResetBtn.textContent = '🔄 重置';
    const expeditionBackBtn = document.createElement('button');
    expeditionBackBtn.className = 'expedition-back-btn';
    expeditionBackBtn.id = 'expeditionBackBtn';
    expeditionBackBtn.onclick = function() { ExpeditionSystem.returnToMain(); };
    expeditionBackBtn.textContent = '❌ 返回';
    const expeditionDepartBtn = document.createElement('button');
    expeditionDepartBtn.className = 'expedition-depart-btn';
    expeditionDepartBtn.id = 'expeditionDepartBtn';
    expeditionDepartBtn.onclick = function() { ExpeditionSystem.depart(); };
    expeditionDepartBtn.textContent = '🗡 确认出征';
    expeditionActions.appendChild(expeditionResetBtn);
    expeditionActions.appendChild(expeditionBackBtn);
    expeditionActions.appendChild(expeditionDepartBtn);
    expeditionBody.appendChild(expeditionActions);
    // 提示信息
    const expeditionMessage = document.createElement('div');
    expeditionMessage.className = 'expedition-message';
    expeditionMessage.id = 'expeditionMessage';
    expeditionBody.appendChild(expeditionMessage);
    expeditionPanel.appendChild(expeditionBody);
    root.appendChild(expeditionPanel);

    // ===== 任务面板 =====
    const questPanel = document.createElement('div');
    questPanel.id = 'questPanel';
    questPanel.className = 'quest-panel';
    const questPanelHeader = document.createElement('div');
    questPanelHeader.className = 'quest-panel-header';
    const questPanelTitle = document.createElement('span');
    questPanelTitle.className = 'quest-panel-title';
    questPanelTitle.textContent = '📜 任务日志';
    const questPanelClose = document.createElement('button');
    questPanelClose.className = 'quest-panel-close';
    questPanelClose.onclick = function() { QuestSystem.close(); };
    questPanelClose.textContent = '✕';
    questPanelHeader.appendChild(questPanelTitle);
    questPanelHeader.appendChild(questPanelClose);
    questPanel.appendChild(questPanelHeader);
    const questPanelBody = document.createElement('div');
    questPanelBody.className = 'quest-panel-body';
    const questListCol = document.createElement('div');
    questListCol.className = 'quest-list-col';
    questListCol.id = 'questListCol';
    const questDetailCol = document.createElement('div');
    questDetailCol.className = 'quest-detail-col';
    questDetailCol.id = 'questDetailCol';
    questPanelBody.appendChild(questListCol);
    questPanelBody.appendChild(questDetailCol);
    questPanel.appendChild(questPanelBody);
    root.appendChild(questPanel);

    // ===== 奖励结算面板 =====
    const rewardPanel = document.createElement('div');
    rewardPanel.id = 'rewardPanel';
    rewardPanel.className = 'reward-panel';
    rewardPanel.style.display = 'none';
    const rewardPanelTitle = document.createElement('div');
    rewardPanelTitle.className = 'reward-panel-title';
    rewardPanelTitle.textContent = '🎉 任务完成 - 选择奖励';
    const rewardCardsContainer = document.createElement('div');
    rewardCardsContainer.className = 'reward-cards-container';
    rewardCardsContainer.id = 'rewardCardsContainer';
    rewardPanel.appendChild(rewardPanelTitle);
    rewardPanel.appendChild(rewardCardsContainer);
    root.appendChild(rewardPanel);

    return root;
}
