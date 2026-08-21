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
    const expeditionHeaderCopy = document.createElement('div');
    expeditionHeaderCopy.className = 'expedition-header-copy';
    const expeditionEyebrow = document.createElement('span');
    expeditionEyebrow.className = 'expedition-eyebrow';
    expeditionEyebrow.textContent = '地牢终端 / 祭品配置';
    const expeditionTitle = document.createElement('span');
    expeditionTitle.className = 'expedition-title';
    expeditionTitle.textContent = '⚔ 出征准备';
    const expeditionClose = document.createElement('button');
    expeditionClose.className = 'expedition-close';
    expeditionClose.type = 'button';
    expeditionClose.setAttribute('aria-label', '关闭出征准备');
    expeditionClose.onclick = function() { ExpeditionSystem.close(); };
    expeditionClose.textContent = '✕';
    expeditionHeaderCopy.appendChild(expeditionEyebrow);
    expeditionHeaderCopy.appendChild(expeditionTitle);
    expeditionHeader.appendChild(expeditionHeaderCopy);
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
    dungeonLabel.className = 'expedition-dungeon-label';
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
    // 出征队友：玩家固定 + 3 名正式队友；点击成员管理/移出，点击空位招募替换。
    const expeditionParty = document.createElement('section');
    expeditionParty.className = 'expedition-party';
    const expeditionPartyTitle = document.createElement('div');
    expeditionPartyTitle.className = 'expedition-section-title';
    expeditionPartyTitle.innerHTML = `
        <span>出征队友 <span class="expedition-hint">点击成员管理或替换</span></span>
        <span class="expedition-party-count" id="expeditionPartyCount">0/3</span>`;
    expeditionParty.appendChild(expeditionPartyTitle);
    const expeditionMemberBar = document.createElement('div');
    expeditionMemberBar.className = 'expedition-member-bar';
    expeditionMemberBar.id = 'expeditionMemberBar';
    expeditionMemberBar.setAttribute('aria-label', '出征队友选择');
    expeditionParty.appendChild(expeditionMemberBar);
    expeditionBody.appendChild(expeditionParty);
    // 祭品栏
    const expeditionSupplies = document.createElement('div');
    expeditionSupplies.className = 'expedition-supplies';
    const suppliesTitle = document.createElement('div');
    suppliesTitle.className = 'expedition-section-title';
    suppliesTitle.innerHTML = `
        <span>出征栏 <span class="expedition-hint">从右侧背包拖入祭品</span></span>
        <span class="expedition-capacity"><span id="expeditionCapacityUsed">0</span>/<span id="expeditionCapacityMax">10</span></span>`;
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
    expeditionResetBtn.className = 'expedition-reset-btn bp-button bp-button--muted';
    expeditionResetBtn.type = 'button';
    expeditionResetBtn.id = 'expeditionResetBtn';
    expeditionResetBtn.onclick = function() { ExpeditionSystem.reset(); };
    expeditionResetBtn.textContent = '🔄 重置';
    const expeditionBackBtn = document.createElement('button');
    expeditionBackBtn.className = 'expedition-back-btn bp-button bp-button--muted';
    expeditionBackBtn.type = 'button';
    expeditionBackBtn.id = 'expeditionBackBtn';
    expeditionBackBtn.onclick = function() { ExpeditionSystem.returnToMain(); };
    expeditionBackBtn.textContent = '❌ 返回';
    const expeditionDepartBtn = document.createElement('button');
    expeditionDepartBtn.className = 'expedition-depart-btn bp-button';
    expeditionDepartBtn.type = 'button';
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
