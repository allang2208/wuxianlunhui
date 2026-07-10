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
    const optDefault = document.createElement('option');
    optDefault.value = 'default';
    optDefault.textContent = '遗忘祭坛';
    const optZombie = document.createElement('option');
    optZombie.value = 'zombie';
    optZombie.textContent = '☠ 僵尸地牢';
    expeditionDungeonSelect.appendChild(optDefault);
    expeditionDungeonSelect.appendChild(optZombie);
    expeditionDungeonSelector.appendChild(dungeonLabel);
    expeditionDungeonSelector.appendChild(expeditionDungeonSelect);
    expeditionInfo.appendChild(expeditionDungeonSelector);
    // 水平信息行
    const expeditionInfoRow = document.createElement('div');
    expeditionInfoRow.className = 'expedition-info-row';
    const expeditionInfoDefs = [
        { label: '地牢名称', id: 'expeditionDungeonName', val: '遗忘祭坛' },
        { label: '节点数', id: 'expeditionNodeCount', val: '35~40' },
        { label: '战斗节点', id: 'expeditionBattleRatio', val: '70%' },
        { label: '地牢等级', id: 'expeditionLevel', val: '5-15级' },
        { label: '预计奖励', id: 'expeditionReward', val: '4500金币' }
    ];
    expeditionInfoDefs.forEach(sd => {
        const item = document.createElement('div');
        item.className = 'expedition-info-item';
        const itemLabel = document.createElement('span');
        itemLabel.className = 'expedition-info-label';
        itemLabel.textContent = sd.label + '：';
        const itemValue = document.createElement('span');
        itemValue.className = 'expedition-info-value';
        itemValue.id = sd.id;
        itemValue.textContent = sd.val;
        item.appendChild(itemLabel);
        item.appendChild(itemValue);
        expeditionInfoRow.appendChild(item);
    });
    expeditionInfo.appendChild(expeditionInfoRow);
    expeditionBody.appendChild(expeditionInfo);
    // 队伍
    const expeditionParty = document.createElement('div');
    expeditionParty.className = 'expedition-party';
    const expeditionSectionTitle = document.createElement('div');
    expeditionSectionTitle.className = 'expedition-section-title';
    expeditionSectionTitle.innerHTML = '队伍 <span class="expedition-hint">(3人)</span>';
    expeditionParty.appendChild(expeditionSectionTitle);
    const expeditionPartyList = document.createElement('div');
    expeditionPartyList.className = 'expedition-party-list';
    expeditionPartyList.id = 'expeditionPartyList';
    // 队长
    const expeditionPartyLeader = document.createElement('div');
    expeditionPartyLeader.className = 'expedition-party-member';
    expeditionPartyLeader.id = 'expeditionPartyLeader';
    const leaderAvatar = document.createElement('div');
    leaderAvatar.className = 'expedition-party-avatar';
    leaderAvatar.textContent = '🧙';
    const leaderInfo = document.createElement('div');
    leaderInfo.className = 'expedition-party-info';
    const leaderName = document.createElement('div');
    leaderName.className = 'expedition-party-name';
    leaderName.textContent = '队长（主角）';
    const leaderDetail = document.createElement('div');
    leaderDetail.className = 'expedition-party-detail';
    leaderDetail.textContent = '点击左侧背包拖入队友';
    leaderInfo.appendChild(leaderName);
    leaderInfo.appendChild(leaderDetail);
    expeditionPartyLeader.appendChild(leaderAvatar);
    expeditionPartyLeader.appendChild(leaderInfo);
    expeditionPartyList.appendChild(expeditionPartyLeader);
    // 空位1
    const expeditionPartySlot1 = document.createElement('div');
    expeditionPartySlot1.className = 'expedition-party-member';
    expeditionPartySlot1.id = 'expeditionPartySlot1';
    const slot1Avatar = document.createElement('div');
    slot1Avatar.className = 'expedition-party-avatar';
    slot1Avatar.style.opacity = '0.5';
    slot1Avatar.textContent = '?';
    const slot1Info = document.createElement('div');
    slot1Info.className = 'expedition-party-info';
    const slot1Name = document.createElement('div');
    slot1Name.className = 'expedition-party-name';
    slot1Name.style.color = '#888';
    slot1Name.textContent = '空位';
    const slot1Detail = document.createElement('div');
    slot1Detail.className = 'expedition-party-detail';
    slot1Detail.textContent = '待招募';
    slot1Info.appendChild(slot1Name);
    slot1Info.appendChild(slot1Detail);
    expeditionPartySlot1.appendChild(slot1Avatar);
    expeditionPartySlot1.appendChild(slot1Info);
    expeditionPartyList.appendChild(expeditionPartySlot1);
    // 空位2
    const expeditionPartySlot2 = document.createElement('div');
    expeditionPartySlot2.className = 'expedition-party-member';
    expeditionPartySlot2.id = 'expeditionPartySlot2';
    const slot2Avatar = document.createElement('div');
    slot2Avatar.className = 'expedition-party-avatar';
    slot2Avatar.style.opacity = '0.5';
    slot2Avatar.textContent = '?';
    const slot2Info = document.createElement('div');
    slot2Info.className = 'expedition-party-info';
    const slot2Name = document.createElement('div');
    slot2Name.className = 'expedition-party-name';
    slot2Name.style.color = '#888';
    slot2Name.textContent = '空位';
    const slot2Detail = document.createElement('div');
    slot2Detail.className = 'expedition-party-detail';
    slot2Detail.textContent = '待招募';
    slot2Info.appendChild(slot2Name);
    slot2Info.appendChild(slot2Detail);
    expeditionPartySlot2.appendChild(slot2Avatar);
    expeditionPartySlot2.appendChild(slot2Info);
    expeditionPartyList.appendChild(expeditionPartySlot2);
    expeditionParty.appendChild(expeditionPartyList);
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
