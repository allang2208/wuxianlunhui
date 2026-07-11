import { SystemUI } from '../system-ui.js';
export function createHudPanelsSystemTabs() {
    // 创建根元素
    const root = document.createElement('div');
    root.id = 'uiLayer';
    root.style.cssText = 'display: none; position: absolute; inset: 0; pointer-events: none;';

    // ===== 系统面板 =====
    const panelOverlay = document.createElement('div');
    panelOverlay.className = 'panel-overlay';
    panelOverlay.id = 'panelOverlay';
    root.appendChild(panelOverlay);

    const systemPanel = document.createElement('div');
    systemPanel.className = 'system-panel';
    systemPanel.id = 'systemPanel';

    // 面板头部
    const panelHeader = document.createElement('div');
    panelHeader.className = 'panel-header';
    const panelTitle = document.createElement('div');
    panelTitle.className = 'panel-title';
    panelTitle.id = 'panelTitle';
    panelTitle.textContent = '角色状态';
    const panelClose = document.createElement('div');
    panelClose.className = 'panel-close';
    panelClose.onclick = function() { SystemUI.close(); };
    panelClose.textContent = '✕';
    panelHeader.appendChild(panelTitle);
    panelHeader.appendChild(panelClose);
    systemPanel.appendChild(panelHeader);

    // 面板标签页
    const panelTabs = document.createElement('div');
    panelTabs.className = 'panel-tabs';

    const btnStatus = document.createElement('div');
    btnStatus.className = 'tab-btn panel-tab active';
    btnStatus.dataset.tab = 'status';
    btnStatus.id = 'btnStatus';
    btnStatus.onclick = function() { SystemUI.switchTab('status'); };
    btnStatus.textContent = '状态';

    const btnEquip = document.createElement('div');
    btnEquip.className = 'tab-btn panel-tab';
    btnEquip.dataset.tab = 'equip';
    btnEquip.id = 'btnEquip';
    btnEquip.onclick = function() { SystemUI.switchTab('equip'); };
    btnEquip.textContent = '装备';

    const btnSkill = document.createElement('div');
    btnSkill.className = 'tab-btn panel-tab';
    btnSkill.dataset.tab = 'skill';
    btnSkill.id = 'btnSkill';
    btnSkill.onclick = function() { SystemUI.switchTab('skill'); };
    btnSkill.textContent = '技能';

    const btnCodex = document.createElement('div');
    btnCodex.className = 'tab-btn panel-tab';
    btnCodex.dataset.tab = 'codex';
    btnCodex.id = 'btnCodex';
    btnCodex.onclick = function() { SystemUI.switchTab('codex'); };
    btnCodex.textContent = '图鉴';

    panelTabs.appendChild(btnStatus);
    panelTabs.appendChild(btnEquip);
    panelTabs.appendChild(btnSkill);
    panelTabs.appendChild(btnCodex);
    systemPanel.appendChild(panelTabs);

    // ===== 状态页 =====
    const tabStatus = document.createElement('div');
    tabStatus.className = 'tab-page active';
    tabStatus.dataset.page = 'status';
    tabStatus.id = 'tab-status';

    const statusPage = document.createElement('div');
    statusPage.className = 'status-page';
    const spTitle = document.createElement('h3');
    spTitle.className = 'sp-title';
    spTitle.textContent = '角色状态';
    statusPage.appendChild(spTitle);

    const statusCharLayout = document.createElement('div');
    statusCharLayout.className = 'status-char-layout';

    // 状态头部
    const statusHeader = document.createElement('div');
    statusHeader.className = 'status-header';
    const headerName = document.createElement('span');
    headerName.className = 'header-name';
    headerName.id = 'charName';
    headerName.textContent = '轮回者';
    const headerClass = document.createElement('span');
    headerClass.className = 'header-class';
    headerClass.id = 'charClass';
    headerClass.textContent = '初心者';
    const headerLevel = document.createElement('span');
    headerLevel.className = 'header-level';
    headerLevel.id = 'charLevel';
    headerLevel.textContent = 'Lv.1';
    const headerAttrPoints = document.createElement('span');
    headerAttrPoints.className = 'header-attrpoints';
    headerAttrPoints.id = 'attrPoints';
    headerAttrPoints.textContent = '属性点: 0';
    statusHeader.appendChild(headerName);
    statusHeader.appendChild(headerClass);
    statusHeader.appendChild(headerLevel);
    statusHeader.appendChild(headerAttrPoints);
    statusCharLayout.appendChild(statusHeader);

    // 状态详情
    const statusDetails = document.createElement('div');
    statusDetails.className = 'status-details';

    // 状态 - 生命/魔法/体力/经验
    const statusSection1 = document.createElement('div');
    statusSection1.className = 'status-section';
    const h4Status = document.createElement('h4');
    h4Status.textContent = '状态';
    statusSection1.appendChild(h4Status);

    const statusBars = [
        { label: '生命', cls: 'hp', id: 'barHp', valId: 'valHp', val: '100/100' },
        { label: '魔法', cls: 'mp', id: 'barMp', valId: 'valMp', val: '100/100' },
        { label: '体力', cls: 'stamina', id: 'barStamina', valId: 'valStamina', val: '200/200' },
        { label: '经验', cls: 'exp', id: 'barExp', valId: 'valExp', val: '0%' }
    ];
    statusBars.forEach(sb => {
        const sbRow = document.createElement('div');
        sbRow.className = 'status-bar';
        const sbLabel = document.createElement('span');
        sbLabel.className = 'bar-label';
        sbLabel.textContent = sb.label;
        const sbTrack = document.createElement('div');
        sbTrack.className = 'bar-track';
        const sbFill = document.createElement('div');
        sbFill.className = 'bar-fill ' + sb.cls;
        sbFill.id = sb.id;
        sbTrack.appendChild(sbFill);
        const sbVal = document.createElement('span');
        sbVal.className = 'status-value';
        sbVal.id = sb.valId;
        sbVal.textContent = sb.val;
        sbRow.appendChild(sbLabel);
        sbRow.appendChild(sbTrack);
        sbRow.appendChild(sbVal);
        statusSection1.appendChild(sbRow);
    });
    statusDetails.appendChild(statusSection1);

    // 基础属性
    const statusSection2 = document.createElement('div');
    statusSection2.className = 'status-section';
    const h4Base = document.createElement('h4');
    h4Base.textContent = '基础属性';
    statusSection2.appendChild(h4Base);
    const attrList = document.createElement('div');
    attrList.className = 'attr-list';
    const attrCol1 = document.createElement('div');
    attrCol1.className = 'attr-col';
    const attrCol2 = document.createElement('div');
    attrCol2.className = 'attr-col';
    const baseAttrs = [
        { name: '力量', attr: 'str', id: 'attrStr' },
        { name: '敏捷', attr: 'dex', id: 'attrDex' },
        { name: '智力', attr: 'int', id: 'attrInt' },
        { name: '精神', attr: 'wis', id: 'attrWis' },
        { name: '体质', attr: 'con', id: 'attrCon' },
        { name: '幸运', attr: 'luck', id: 'attrLuck' }
    ];
    baseAttrs.forEach((a, i) => {
        const attrItem = document.createElement('div');
        attrItem.className = 'attr-item';
        attrItem.dataset.attr = a.attr;
        const attrName = document.createElement('span');
        attrName.className = 'attr-name';
        attrName.textContent = a.name;
        const attrVal = document.createElement('span');
        attrVal.className = 'attr-val';
        attrVal.id = a.id;
        attrVal.textContent = '10';
        const attrPlus = document.createElement('span');
        attrPlus.className = 'attr-plus';
        attrPlus.dataset.attr = a.attr;
        attrPlus.style.display = 'none';
        attrPlus.textContent = '+';
        attrItem.appendChild(attrName);
        attrItem.appendChild(attrVal);
        attrItem.appendChild(attrPlus);
        if (i < 3) attrCol1.appendChild(attrItem);
        else attrCol2.appendChild(attrItem);
    });
    attrList.appendChild(attrCol1);
    attrList.appendChild(attrCol2);
    statusSection2.appendChild(attrList);
    statusDetails.appendChild(statusSection2);

    // 战斗属性
    const statusSection3 = document.createElement('div');
    statusSection3.className = 'status-section';
    const h4Combat = document.createElement('h4');
    h4Combat.textContent = '战斗属性';
    statusSection3.appendChild(h4Combat);
    const combatList = document.createElement('div');
    combatList.className = 'attr-list';
    const combatAttrs = [
        { name: '物理攻击', id: 'combatAtk', val: '0' },
        { name: '物理防御', id: 'combatDef', val: '0' },
        { name: '魔法攻击', id: 'combatMatk', val: '0' },
        { name: '魔法防御', id: 'combatMdef', val: '0' },
        { name: '暴击率', id: 'combatCrit', val: '0%' },
        { name: '暴击抵抗', id: 'combatCritRes', val: '0%' },
        { name: '攻击间隔', id: 'combatAspd', val: '0' },
        { name: '移动速度', id: 'combatSpd', val: '0' }
    ];
    combatAttrs.forEach(a => {
        const attrItem = document.createElement('div');
        attrItem.className = 'attr-item';
        const attrName = document.createElement('span');
        attrName.className = 'attr-name';
        attrName.textContent = a.name;
        const attrVal = document.createElement('span');
        attrVal.className = 'attr-val';
        attrVal.id = a.id;
        attrVal.textContent = a.val;
        attrItem.appendChild(attrName);
        attrItem.appendChild(attrVal);
        combatList.appendChild(attrItem);
    });
    statusSection3.appendChild(combatList);
    statusDetails.appendChild(statusSection3);

    // 详细信息
    const statusSection4 = document.createElement('div');
    statusSection4.className = 'status-section';
    const h4Detail = document.createElement('h4');
    h4Detail.textContent = '详细信息';
    statusSection4.appendChild(h4Detail);
    const detailList = document.createElement('div');
    detailList.className = 'attr-list';
    const detailAttrs = [
        { name: '体力恢复', id: 'detailStaminaRegen', val: '0/秒' },
        { name: '生命回复', id: 'detailHpRegen', val: '1/秒' },
        { name: '魔法回复', id: 'detailMpRegen', val: '1/3秒' },
        { name: '碰撞体积', id: 'detailCollisionRadius', val: '0px' },
        { name: '移动速度', id: 'detailMoveSpeed', val: '0px/帧' },
        { name: '闪避冷却', id: 'detailDodgeCooldown', val: '0ms' },
        { name: '攻击距离', id: 'detailAttackRange', val: '0px' },
        { name: '击退距离', id: 'detailKnockback', val: '0px' },
        { name: '视野宽度', id: 'detailViewRange', val: '0px' }
    ];
    detailAttrs.forEach(a => {
        const attrItem = document.createElement('div');
        attrItem.className = 'attr-item';
        const attrName = document.createElement('span');
        attrName.className = 'attr-name';
        attrName.textContent = a.name;
        const attrVal = document.createElement('span');
        attrVal.className = 'attr-val';
        attrVal.id = a.id;
        attrVal.textContent = a.val;
        attrItem.appendChild(attrName);
        attrItem.appendChild(attrVal);
        detailList.appendChild(attrItem);
    });
    statusSection4.appendChild(detailList);
    statusDetails.appendChild(statusSection4);

    // 轮回信息
    const statusSection5 = document.createElement('div');
    statusSection5.className = 'status-section';
    const h4Loop = document.createElement('h4');
    h4Loop.textContent = '轮回信息';
    statusSection5.appendChild(h4Loop);
    const loopList = document.createElement('div');
    loopList.className = 'attr-list';
    const loopAttrs = [
        { name: '轮回次数', id: 'infoLoop', val: '0' },
        { name: '存活天数', id: 'infoDays', val: '1' },
        { name: '击杀数', id: 'infoKills', val: '0' },
        { name: '完成任务', id: 'infoQuests', val: '0' },
        { name: '基因锁', id: 'infoGene', val: '未开启' },
        { name: '主神评价', id: 'infoRank', val: 'F' }
    ];
    loopAttrs.forEach(a => {
        const attrItem = document.createElement('div');
        attrItem.className = 'attr-item';
        const attrName = document.createElement('span');
        attrName.className = 'attr-name';
        attrName.textContent = a.name;
        const attrVal = document.createElement('span');
        attrVal.className = 'attr-val';
        attrVal.id = a.id;
        attrVal.textContent = a.val;
        attrItem.appendChild(attrName);
        attrItem.appendChild(attrVal);
        loopList.appendChild(attrItem);
    });
    statusSection5.appendChild(loopList);
    statusDetails.appendChild(statusSection5);

    statusCharLayout.appendChild(statusDetails);
    statusPage.appendChild(statusCharLayout);
    tabStatus.appendChild(statusPage);
    systemPanel.appendChild(tabStatus);

    // ===== 装备+背包页 =====
    const tabEquip = document.createElement('div');
    tabEquip.className = 'tab-page';
    tabEquip.dataset.page = 'equip';
    tabEquip.id = 'tab-equip';

    const gearLayout = document.createElement('div');
    gearLayout.className = 'gear-layout';

    const gearEquipCol = document.createElement('div');
    gearEquipCol.className = 'gear-equip-col';
    const gearColTitle = document.createElement('div');
    gearColTitle.className = 'gear-col-title';
    gearColTitle.textContent = '装备栏';
    gearEquipCol.appendChild(gearColTitle);

    const equipGrid = document.createElement('div');
    equipGrid.className = 'equip-grid';
    const equipSlots = [
        'earring', 'helmet', 'ring1', 'gloves', 'necklace', 'cloak',
        'weapon', 'armor', 'offhand', 'weapon2', 'belt', 'ring2', 'extra', 'boots', 'backpack'
    ];
    const equipSlotNames = [
        '左耳环', '头盔', '右耳环', '手套', '项链', '披风',
        '主手武器1', '盔甲', '副手武器1', '主手武器2', '腰带', '副手武器2', '额外物品', '靴子', '背包装备'
    ];
    equipSlots.forEach((slot, i) => {
        const diabloSlot = document.createElement('div');
        diabloSlot.className = 'diablo-slot';
        diabloSlot.dataset.slot = slot;
        const slotIcon = document.createElement('div');
        slotIcon.className = 'slot-icon';
        slotIcon.dataset.default = '';
        const slotRarity = document.createElement('div');
        slotRarity.className = 'slot-rarity';
        slotRarity.dataset.default = '';
        const slotName = document.createElement('div');
        slotName.className = 'slot-name';
        slotName.dataset.default = equipSlotNames[i];
        slotName.textContent = equipSlotNames[i];
        diabloSlot.appendChild(slotIcon);
        diabloSlot.appendChild(slotRarity);
        diabloSlot.appendChild(slotName);
        equipGrid.appendChild(diabloSlot);
    });
    gearEquipCol.appendChild(equipGrid);
    gearLayout.appendChild(gearEquipCol);

    const gearInventoryCol = document.createElement('div');
    gearInventoryCol.className = 'gear-inventory-col';
    const inventoryHeader = document.createElement('div');
    inventoryHeader.className = 'inventory-header';
    const invSpan1 = document.createElement('span');
    invSpan1.textContent = '背包';
    const invCount = document.createElement('span');
    invCount.id = 'invCount';
    invCount.textContent = '0/36';
    inventoryHeader.appendChild(invSpan1);
    inventoryHeader.appendChild(invCount);
    gearInventoryCol.appendChild(inventoryHeader);
    const inventoryGrid = document.createElement('div');
    inventoryGrid.className = 'inventory-grid';
    inventoryGrid.id = 'inventoryGrid';
    gearInventoryCol.appendChild(inventoryGrid);
    gearLayout.appendChild(gearInventoryCol);

    tabEquip.appendChild(gearLayout);
    systemPanel.appendChild(tabEquip);

    // ===== 技能页 =====
    const tabSkill = document.createElement('div');
    tabSkill.className = 'tab-page';
    tabSkill.dataset.page = 'skill';
    tabSkill.id = 'tab-skill';

    const skillPage = document.createElement('div');
    skillPage.className = 'skill-page';
    const skillFilterBar = document.createElement('div');
    skillFilterBar.className = 'skill-filter-bar';
    skillFilterBar.id = 'skillFilterBar';
    skillPage.appendChild(skillFilterBar);
    const skillGrid = document.createElement('div');
    skillGrid.className = 'skill-grid';
    skillGrid.id = 'skillGrid';
    skillPage.appendChild(skillGrid);
    const skillDetail = document.createElement('div');
    skillDetail.className = 'skill-detail';
    skillDetail.id = 'skillDetail';
    skillDetail.style.display = 'none';
    const sdHeader = document.createElement('div');
    sdHeader.className = 'sd-header';
    const sdBackBtn = document.createElement('button');
    sdBackBtn.className = 'sd-back';
    sdBackBtn.id = 'sdBackBtn';
    sdBackBtn.textContent = '← 返回';
    const sdTitle = document.createElement('span');
    sdTitle.className = 'sd-title';
    sdTitle.id = 'sdTitle';
    sdTitle.textContent = '技能详情';
    sdHeader.appendChild(sdBackBtn);
    sdHeader.appendChild(sdTitle);
    skillDetail.appendChild(sdHeader);
    const sdBody = document.createElement('div');
    sdBody.className = 'sd-body';
    sdBody.id = 'sdBody';
    skillDetail.appendChild(sdBody);
    skillPage.appendChild(skillDetail);
    tabSkill.appendChild(skillPage);
    systemPanel.appendChild(tabSkill);

    // ===== 图鉴页 =====
    const tabCodex = document.createElement('div');
    tabCodex.className = 'tab-page';
    tabCodex.dataset.page = 'codex';
    tabCodex.id = 'tab-codex';

    const codexWrapper = document.createElement('div');
    codexWrapper.className = 'codex-wrapper';
    const codexLayout = document.createElement('div');
    codexLayout.className = 'codex-layout';
    codexLayout.id = 'codexLayout';
    const codexHeader = document.createElement('div');
    codexHeader.className = 'codex-header';
    const codexH3 = document.createElement('h3');
    codexH3.className = 'sp-title';
    codexH3.textContent = '图鉴';
    codexHeader.appendChild(codexH3);
    codexLayout.appendChild(codexHeader);
    const codexMainTabs = document.createElement('div');
    codexMainTabs.className = 'codex-main-tabs';
    codexMainTabs.id = 'codexMainTabs';
    const codexTabEquip = document.createElement('div');
    codexTabEquip.className = 'codex-main-tab active';
    codexTabEquip.dataset.section = 'equipment';
    codexTabEquip.textContent = '装备';
    const codexTabMonster = document.createElement('div');
    codexTabMonster.className = 'codex-main-tab';
    codexTabMonster.dataset.section = 'monster';
    codexTabMonster.textContent = '怪物';
    codexMainTabs.appendChild(codexTabEquip);
    codexMainTabs.appendChild(codexTabMonster);
    codexLayout.appendChild(codexMainTabs);

    const codexEquipLayout = document.createElement('div');
    codexEquipLayout.className = 'codex-sub-layout active';
    codexEquipLayout.id = 'codexEquipLayout';
    const codexCatTabs = document.createElement('div');
    codexCatTabs.className = 'codex-category-tabs';
    codexCatTabs.id = 'codexCatTabs';
    codexEquipLayout.appendChild(codexCatTabs);
    const codexGrid = document.createElement('div');
    codexGrid.className = 'codex-grid';
    codexGrid.id = 'codexGrid';
    codexEquipLayout.appendChild(codexGrid);
    codexLayout.appendChild(codexEquipLayout);

    const codexMonsterLayout = document.createElement('div');
    codexMonsterLayout.className = 'codex-sub-layout';
    codexMonsterLayout.id = 'codexMonsterLayout';
    const codexMonsterCatTabs = document.createElement('div');
    codexMonsterCatTabs.className = 'codex-category-tabs';
    codexMonsterCatTabs.id = 'codexMonsterCatTabs';
    codexMonsterLayout.appendChild(codexMonsterCatTabs);
    const codexMonsterGrid = document.createElement('div');
    codexMonsterGrid.className = 'codex-grid';
    codexMonsterGrid.id = 'codexMonsterGrid';
    codexMonsterLayout.appendChild(codexMonsterGrid);
    codexLayout.appendChild(codexMonsterLayout);
    codexWrapper.appendChild(codexLayout);

    const codexDetail = document.createElement('div');
    codexDetail.className = 'codex-detail';
    codexDetail.id = 'codexDetail';
    const codexDetailHeader = document.createElement('div');
    codexDetailHeader.className = 'codex-detail-header';
    const codexDetailTitle = document.createElement('div');
    codexDetailTitle.className = 'codex-detail-title';
    codexDetailTitle.id = 'codexDetailTitle';
    codexDetailTitle.textContent = '详情';
    codexDetailHeader.appendChild(codexDetailTitle);
    codexDetail.appendChild(codexDetailHeader);
    const codexDetailBody = document.createElement('div');
    codexDetailBody.className = 'codex-detail-body';
    codexDetailBody.id = 'codexDetailBody';
    codexDetail.appendChild(codexDetailBody);
    codexWrapper.appendChild(codexDetail);

    tabCodex.appendChild(codexWrapper);
    systemPanel.appendChild(tabCodex);
    root.appendChild(systemPanel);

    return root;
}
