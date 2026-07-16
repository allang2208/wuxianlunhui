import { Game } from '../../game.js';
import { QuestSystem } from '../quest-system.js';
import { SystemUI } from '../system-ui.js';
import { SceneManager } from '../../world/scene-manager.js';
export function createHudPanelsMisc() {
    const root = document.createElement('div');

    // ===== 侧边菜单 =====
    const sideMenu = document.createElement('div');
    sideMenu.className = 'side-menu';
    const sideMenuItems = [
        { tab: 'status', title: '角色状态 (CapsLock)', icon: 'assets/ui/icons/status.png', alt: '状态', key: 'Caps', label: '人物状态' },
        { tab: 'equip', title: '装备背包 (Tab)', icon: 'assets/ui/icons/inventory.png', alt: '背包', key: 'Tab', label: '背包' },
        { tab: 'skill', title: '技能 (K)', icon: 'assets/ui/icons/skills.png', alt: '技能', key: 'K', label: '技能栏' },
        { tab: 'codex', title: '图鉴 (O)', icon: 'assets/ui/icons/codex.png', alt: '图鉴', key: 'O', label: '图鉴栏' },
        { action: 'QuestSystem.open()', title: '任务 (L)', icon: 'assets/ui/icons/quest.png', alt: '任务', key: 'L', label: '任务栏' },
        { action: 'Game.handleAddPoint()', title: '属性点', icon: 'assets/ui/addpoint.png', alt: '属性点', key: null, label: '属性点', id: 'addPointBtn', extraClass: 'addpoint-btn hidden' }
    ];
    sideMenuItems.forEach(item => {
        const btn = document.createElement('div');
        btn.className = 'side-menu-btn' + (item.extraClass ? ' ' + item.extraClass : '');
        if (item.id) btn.id = item.id;
        btn.title = item.title;
        if (item.tab) {
            btn.onclick = function() { SystemUI.toggle(item.tab); };
        } else if (item.action) {
            const action = item.action;
            btn.onclick = function() {
                if (action === 'QuestSystem.open()') QuestSystem.open();
                else if (action === 'Game.handleAddPoint()') Game.handleAddPoint();
            };
        }
        const img = document.createElement('img');
        img.src = item.icon;
        img.alt = item.alt;
        btn.appendChild(img);
        if (item.key) {
            const keyHint = document.createElement('span');
            keyHint.className = 'key-hint';
            keyHint.textContent = item.key;
            btn.appendChild(keyHint);
        }
        const panelLabel = document.createElement('span');
        panelLabel.className = 'panel-label';
        panelLabel.textContent = item.label;
        btn.appendChild(panelLabel);
        sideMenu.appendChild(btn);
    });
    root.appendChild(sideMenu);

    // ===== 快捷栏 =====
    const bottomBar = document.createElement('div');
    bottomBar.className = 'bottom-bar';
    const skillGroup = document.createElement('div');
    skillGroup.className = 'quick-slot-group';
    skillGroup.id = 'skillGroup';
    const skillDivider = document.createElement('div');
    skillDivider.className = 'quick-slot-divider';
    skillGroup.appendChild(skillDivider);
    const itemGroup = document.createElement('div');
    itemGroup.className = 'quick-slot-group';
    itemGroup.id = 'itemGroup';
    const itemDivider = document.createElement('div');
    itemDivider.className = 'quick-slot-divider';
    itemGroup.appendChild(itemDivider);
    bottomBar.appendChild(skillGroup);
    bottomBar.appendChild(itemGroup);
    root.appendChild(bottomBar);

    // ===== 经验值条 =====
    const expBarContainer = document.createElement('div');
    expBarContainer.className = 'exp-bar-container';
    expBarContainer.id = 'expBarContainer';
    const expBar = document.createElement('div');
    expBar.className = 'exp-bar-fill';
    expBar.id = 'expBar';
    expBarContainer.appendChild(expBar);
    root.appendChild(expBarContainer);

    // ===== 操作提示 =====
    const controlsHintLeft = document.createElement('div');
    controlsHintLeft.id = 'controlsHintLeft';
    controlsHintLeft.className = 'controls-hint-left';
    const controlsLines = [
        'WASD - 移动 | 鼠标 - 瞄准',
        '左键 - 攻击 | 右键 - 特殊攻击',
        '空格 - 闪避 | Shift - 冲刺',
        'F - 切换武器 | R - 换弹',
        '1~4 - 快捷栏 | Q/E/X/C - 技能',
        'Z - 范围拾取 | Tab - 背包',
        'CapsLock - 状态栏 | K - 技能栏 | O - 图鉴',
        'Tab - 背包 | L - 任务 | Esc - 菜单'
    ];
    controlsLines.forEach(line => {
        const div = document.createElement('div');
        div.textContent = line;
        controlsHintLeft.appendChild(div);
    });
    root.appendChild(controlsHintLeft);

    // ===== 显示攻击范围开关 =====
    const attackRangeToggle = document.createElement('div');
    attackRangeToggle.className = 'attack-range-toggle';
    attackRangeToggle.id = 'attackRangeToggle';
    attackRangeToggle.title = '显示攻击范围';
    const attackRangeSpan = document.createElement('span');
    attackRangeSpan.textContent = '范围';
    attackRangeToggle.appendChild(attackRangeSpan);
    root.appendChild(attackRangeToggle);

    // ===== 交互开发工具按钮 =====
    const devToolTrigger = document.createElement('div');
    devToolTrigger.className = 'dev-tool-trigger';
    devToolTrigger.id = 'devToolTrigger';
    devToolTrigger.title = '交互开发工具';
    const devToolSpan = document.createElement('span');
    devToolSpan.textContent = '🛠';
    devToolTrigger.appendChild(devToolSpan);
    root.appendChild(devToolTrigger);

    // ===== 无敌模式切换按钮 =====
    const invincibleToggle = document.createElement('div');
    invincibleToggle.className = 'invincible-toggle active';
    invincibleToggle.id = 'invincibleToggle';
    invincibleToggle.title = '无敌模式（主神空间生效）';
    const invincibleSpan = document.createElement('span');
    invincibleSpan.textContent = '无敌';
    invincibleToggle.appendChild(invincibleSpan);
    invincibleToggle.addEventListener('click', () => {
        SceneManager._mainHubInvincible = !SceneManager._mainHubInvincible;
        invincibleToggle.classList.toggle('active', SceneManager._mainHubInvincible);
        invincibleSpan.textContent = SceneManager._mainHubInvincible ? '无敌' : '可伤';
    });
    root.appendChild(invincibleToggle);

    // ===== 游戏秒表计时器 =====
    const gameTimer = document.createElement('div');
    gameTimer.id = 'gameTimer';
    gameTimer.className = 'game-timer';
    gameTimer.style.display = 'none';
    const timerIcon = document.createElement('span');
    timerIcon.className = 'timer-icon';
    timerIcon.textContent = '⏱';
    const timerText = document.createElement('span');
    timerText.id = 'timerText';
    timerText.className = 'timer-text';
    timerText.textContent = '00:00:00';
    gameTimer.appendChild(timerIcon);
    gameTimer.appendChild(timerText);
    root.appendChild(gameTimer);

    // ===== 装备 Tooltip =====
    const equipTooltip = document.createElement('div');
    equipTooltip.className = 'equip-tooltip';
    equipTooltip.id = 'equipTooltip';
    const ttEnchant = document.createElement('div');
    ttEnchant.className = 'tt-enchant';
    ttEnchant.id = 'ttEnchant';
    const ttCraft = document.createElement('div');
    ttCraft.className = 'tt-craft';
    ttCraft.id = 'ttCraft';
    const ttMain = document.createElement('div');
    ttMain.className = 'tt-main';
    const ttClose = document.createElement('div');
    ttClose.className = 'tt-close';
    ttClose.id = 'ttCloseBtn';
    ttClose.textContent = '×';
    const ttHeader = document.createElement('div');
    ttHeader.className = 'tt-header';
    const ttIcon = document.createElement('div');
    ttIcon.className = 'tt-icon';
    ttIcon.id = 'ttIcon';
    ttIcon.textContent = '⚔';
    const ttTitle = document.createElement('div');
    ttTitle.className = 'tt-title';
    const ttName = document.createElement('div');
    ttName.className = 'tt-name';
    ttName.id = 'ttName';
    ttName.textContent = '装备名称';
    const ttType = document.createElement('div');
    ttType.className = 'tt-type';
    ttType.id = 'ttType';
    ttType.textContent = '装备类型';
    ttTitle.appendChild(ttName);
    ttTitle.appendChild(ttType);
    ttHeader.appendChild(ttIcon);
    ttHeader.appendChild(ttTitle);
    const ttStats = document.createElement('div');
    ttStats.className = 'tt-stats';
    ttStats.id = 'ttStats';
    const ttExtra = document.createElement('div');
    ttExtra.className = 'tt-extra';
    ttExtra.id = 'ttExtra';
    const ttDesc = document.createElement('div');
    ttDesc.className = 'tt-desc';
    ttDesc.id = 'ttDesc';
    ttDesc.textContent = '装备描述';
    ttMain.appendChild(ttClose);
    ttMain.appendChild(ttHeader);
    ttMain.appendChild(ttStats);
    ttMain.appendChild(ttExtra);
    ttMain.appendChild(ttDesc);
    equipTooltip.appendChild(ttEnchant);
    equipTooltip.appendChild(ttCraft);
    equipTooltip.appendChild(ttMain);
    root.appendChild(equipTooltip);

    // ===== 坐标工具覆盖层 =====
    const coordOverlay = document.createElement('div');
    coordOverlay.id = 'coordOverlay';
    coordOverlay.className = 'coord-overlay';
    root.appendChild(coordOverlay);
    const coordPanel = document.createElement('div');
    coordPanel.id = 'coordPanel';
    coordPanel.className = 'coord-panel';
    const coordPanelTitle = document.createElement('div');
    coordPanelTitle.className = 'coord-panel-title';
    coordPanelTitle.textContent = '📐 坐标工具';
    const coordRow1 = document.createElement('div');
    coordRow1.className = 'coord-row';
    const coordLabel1 = document.createElement('span');
    coordLabel1.className = 'coord-label';
    coordLabel1.textContent = '起始点:';
    const coordStart = document.createElement('span');
    coordStart.className = 'coord-value';
    coordStart.id = 'coordStart';
    coordStart.textContent = '--';
    coordRow1.appendChild(coordLabel1);
    coordRow1.appendChild(coordStart);
    const coordRow2 = document.createElement('div');
    coordRow2.className = 'coord-row';
    const coordLabel2 = document.createElement('span');
    coordLabel2.className = 'coord-label';
    coordLabel2.textContent = '结束点:';
    const coordEnd = document.createElement('span');
    coordEnd.className = 'coord-value';
    coordEnd.id = 'coordEnd';
    coordEnd.textContent = '--';
    coordRow2.appendChild(coordLabel2);
    coordRow2.appendChild(coordEnd);
    const coordRow3 = document.createElement('div');
    coordRow3.className = 'coord-row';
    const coordLabel3 = document.createElement('span');
    coordLabel3.className = 'coord-label';
    coordLabel3.textContent = '尺寸:';
    const coordSize = document.createElement('span');
    coordSize.className = 'coord-value';
    coordSize.id = 'coordSize';
    coordSize.textContent = '--';
    coordRow3.appendChild(coordLabel3);
    coordRow3.appendChild(coordSize);
    const coordRow4 = document.createElement('div');
    coordRow4.className = 'coord-row';
    coordRow4.style.cssText = 'justify-content: space-between; margin-top: 4px;';
    const coordHint = document.createElement('span');
    coordHint.className = 'coord-hint';
    coordHint.textContent = '左键拖动框选 · 右键退出';
    const coordCopyBtn = document.createElement('button');
    coordCopyBtn.className = 'coord-btn';
    coordCopyBtn.id = 'coordCopyBtn';
    coordCopyBtn.textContent = '📋 复制坐标';
    coordRow4.appendChild(coordHint);
    coordRow4.appendChild(coordCopyBtn);
    coordPanel.appendChild(coordPanelTitle);
    coordPanel.appendChild(coordRow1);
    coordPanel.appendChild(coordRow2);
    coordPanel.appendChild(coordRow3);
    coordPanel.appendChild(coordRow4);
    root.appendChild(coordPanel);

    // ===== NPC 立绘调整工具 =====
    const npcPortraitTool = document.createElement('div');
    npcPortraitTool.id = 'npcPortraitTool';
    npcPortraitTool.className = 'npc-portrait-tool';
    const npcPortraitToolHeader = document.createElement('div');
    npcPortraitToolHeader.className = 'npc-portrait-tool-header';
    const npcPortraitToolTitle = document.createElement('span');
    npcPortraitToolTitle.textContent = '🖼️ 调整立绘';
    const npcPortraitToolClose = document.createElement('button');
    npcPortraitToolClose.id = 'npcPortraitToolClose';
    npcPortraitToolClose.className = 'npc-portrait-tool-close';
    npcPortraitToolClose.textContent = '✕';
    npcPortraitToolHeader.appendChild(npcPortraitToolTitle);
    npcPortraitToolHeader.appendChild(npcPortraitToolClose);
    npcPortraitTool.appendChild(npcPortraitToolHeader);
    const npcPortraitToolBody = document.createElement('div');
    npcPortraitToolBody.className = 'npc-portrait-tool-body';
    const npcPortraitCanvas = document.createElement('canvas');
    npcPortraitCanvas.id = 'npcPortraitCanvas';
    npcPortraitCanvas.width = 400;
    npcPortraitCanvas.height = 400;
    npcPortraitCanvas.className = 'npc-portrait-canvas';
    const npcPortraitToolControls = document.createElement('div');
    npcPortraitToolControls.className = 'npc-portrait-tool-controls';
    const npcPortraitControlRows = [
        { label: '缩放', id: 'npcPortraitScale', min: '0.1', max: '5.0', step: '0.01', val: '1.0', valId: 'npcPortraitScaleVal', suffix: '' },
        { label: '旋转', id: 'npcPortraitRotation', min: '-180', max: '180', step: '1', val: '0', valId: 'npcPortraitRotationVal', suffix: '°' }
    ];
    npcPortraitControlRows.forEach(cr => {
        const row = document.createElement('div');
        row.className = 'npc-portrait-control-row';
        const label = document.createElement('label');
        label.textContent = cr.label;
        const input = document.createElement('input');
        input.type = 'range';
        input.id = cr.id;
        input.min = cr.min;
        input.max = cr.max;
        input.step = cr.step;
        input.value = cr.val;
        const valSpan = document.createElement('span');
        valSpan.id = cr.valId;
        valSpan.textContent = cr.val + cr.suffix;
        row.appendChild(label);
        row.appendChild(input);
        row.appendChild(valSpan);
        npcPortraitToolControls.appendChild(row);
    });
    const npcPortraitFlipXRow = document.createElement('div');
    npcPortraitFlipXRow.className = 'npc-portrait-control-row';
    const npcPortraitFlipX = document.createElement('button');
    npcPortraitFlipX.id = 'npcPortraitFlipX';
    npcPortraitFlipX.className = 'npc-portrait-btn';
    npcPortraitFlipX.textContent = '🔄 镜像';
    npcPortraitFlipXRow.appendChild(npcPortraitFlipX);
    npcPortraitToolControls.appendChild(npcPortraitFlipXRow);
    const npcPortraitBtnRow = document.createElement('div');
    npcPortraitBtnRow.className = 'npc-portrait-control-row';
    const npcPortraitReset = document.createElement('button');
    npcPortraitReset.id = 'npcPortraitReset';
    npcPortraitReset.className = 'npc-portrait-btn npc-portrait-btn-secondary';
    npcPortraitReset.textContent = '↺ 重置';
    const npcPortraitSave = document.createElement('button');
    npcPortraitSave.id = 'npcPortraitSave';
    npcPortraitSave.className = 'npc-portrait-btn npc-portrait-btn-primary';
    npcPortraitSave.textContent = '💾 保存';
    npcPortraitBtnRow.appendChild(npcPortraitReset);
    npcPortraitBtnRow.appendChild(npcPortraitSave);
    npcPortraitToolControls.appendChild(npcPortraitBtnRow);
    npcPortraitToolBody.appendChild(npcPortraitCanvas);
    npcPortraitToolBody.appendChild(npcPortraitToolControls);
    npcPortraitTool.appendChild(npcPortraitToolBody);
    root.appendChild(npcPortraitTool);

    return root;
}
