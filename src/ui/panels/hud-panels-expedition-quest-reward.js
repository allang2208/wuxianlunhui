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
    expeditionEyebrow.textContent = '地牢终端 / 钥匙验证';
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
    // 操作按钮
    const expeditionActions = document.createElement('div');
    expeditionActions.className = 'expedition-actions';
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
