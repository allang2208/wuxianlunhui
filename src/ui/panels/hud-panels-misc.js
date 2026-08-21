import { Game } from '../../game.js';
import { QuestSystem } from '../quest-system.js';
import { SystemUI } from '../system-ui.js';
import { SceneManager } from '../../world/scene-manager.js';
import { WallEditor } from '../wall-editor.js';
import { CompanionPanel } from '../companion-panel.js';
import { WorldSwitchPanel } from '../world-switch-panel.js';
import { TechnologyTreePanel } from '../technology-tree-panel.js';
export function createHudPanelsMisc() {
    const root = document.createElement('div');

    // ===== 侧边菜单 =====
    const sideMenu = document.createElement('div');
    sideMenu.className = 'side-menu';
    // 2026-08-19 用户口径：技能↔背包对调、世界传送（组队原位置）↔组队（移到队尾）对调；
    // 快捷键徽标同位置同款：世界传送 O / 队员管理 P（P 键自暂停让位——暂停已整合进 Esc 菜单）；图鉴 O 让位给 U
    const sideMenuItems = [
        { tab: 'status', title: '角色状态 (CapsLock)', icon: 'assets/ui/icons/status.png', alt: '状态', key: 'Caps', label: '人物状态' },
        { tab: 'skill', title: '技能 (K)', icon: 'assets/ui/icons/skills.png', alt: '技能', key: 'K', label: '技能栏' },
        { tab: 'equip', title: '装备背包 (Tab)', icon: 'assets/ui/icons/inventory.png', alt: '背包', key: 'Tab', label: '背包' },
        { tab: 'codex', title: '图鉴 (U)', icon: 'assets/ui/icons/codex.png', alt: '图鉴', key: 'U', label: '图鉴栏' },
        { action: 'QuestSystem.open()', title: '任务 (L)', icon: 'assets/ui/icons/quest.png', alt: '任务', key: 'L', label: '任务栏' },
        { action: 'WorldSwitchPanel.toggle()', title: '世界传送 (O)', icon: 'assets/ui/icons/world_switch.png', alt: '世界传送', key: 'O', label: '世界传送', id: 'worldSwitchBtn' },
        { action: 'CompanionPanel.openManage()', title: '管理队员 (P)', icon: 'assets/ui/icons/party.png', alt: '队员', key: 'P', label: '队员管理' },
        { action: 'Game.handleAddPoint()', title: '属性点', icon: 'assets/ui/addpoint.png', alt: '属性点', key: null, label: '属性点', id: 'addPointBtn', extraClass: 'addpoint-btn hidden' },
        // 新入口追加在全部既有栏目之后，避免改变任何原按钮的预设序号。
        { action: 'TechnologyTreePanel.open()', title: '科技树 (Y)', emoji: '🔬', alt: '科技树', key: 'Y', label: '科技树', id: 'technologyTreeBtn' }
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
                else if (action === 'TechnologyTreePanel.open()') TechnologyTreePanel.open();
                else if (action === 'Game.handleAddPoint()') Game.handleAddPoint();
                else if (action === 'CompanionPanel.openManage()') CompanionPanel.openManage();
                else if (action === 'WorldSwitchPanel.toggle()') WorldSwitchPanel.toggle();
            };
        }
        if (item.emoji) {
            const emojiEl = document.createElement('span');
            emojiEl.className = 'side-menu-emoji';
            emojiEl.textContent = item.emoji;
            btn.appendChild(emojiEl);
        } else {
            const img = document.createElement('img');
            img.src = item.icon;
            img.alt = item.alt;
            btn.appendChild(img);
        }
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

    // ===== 显示攻击范围开关 =====
    const attackRangeToggle = document.createElement('div');
    attackRangeToggle.className = 'attack-range-toggle';
    attackRangeToggle.id = 'attackRangeToggle';
    attackRangeToggle.title = '绿色=可移动面；亮绿色=地面/墙顶接口；红线=楼梯不可穿越的外侧物理护栏';
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

    // ===== 秒杀模式切换按钮 =====
    const oneHitKillToggle = document.createElement('div');
    oneHitKillToggle.className = 'invincible-toggle';
    oneHitKillToggle.id = 'oneHitKillToggle';
    oneHitKillToggle.title = '秒杀模式（玩家攻击直接秒杀怪物）';
    const oneHitKillSpan = document.createElement('span');
    oneHitKillSpan.textContent = '秒杀';
    oneHitKillToggle.appendChild(oneHitKillSpan);
    oneHitKillToggle.addEventListener('click', () => {
        if (typeof window === 'undefined' || !window.Game) return;
        window.Game._oneHitKill = !window.Game._oneHitKill;
        oneHitKillToggle.classList.toggle('active', window.Game._oneHitKill);
        oneHitKillSpan.textContent = window.Game._oneHitKill ? '秒杀中' : '秒杀';
    });
    root.appendChild(oneHitKillToggle);

    // ===== 墙壁编辑器切换按钮（摆墙模式：拖动/缩放/翻转墙件，存预制组合） =====
    const wallEditorToggle = document.createElement('div');
    wallEditorToggle.className = 'invincible-toggle';
    wallEditorToggle.id = 'wallEditorToggle';
    wallEditorToggle.title = '墙壁编辑器（摆墙模式）';
    const wallEditorSpan = document.createElement('span');
    wallEditorSpan.textContent = '摆墙';
    wallEditorToggle.appendChild(wallEditorSpan);
    wallEditorToggle.addEventListener('click', () => {
        WallEditor.toggle();
        wallEditorToggle.classList.toggle('active', WallEditor.active);
    });
    root.appendChild(wallEditorToggle);

    // ===== 游戏内时间（与 EnvironmentLightingSystem 昼夜相位同源） =====
    const gameTime = document.createElement('div');
    gameTime.id = 'gameTime';
    gameTime.className = 'game-time';
    // 24h 太阳针表盘（2026-08-19）：针=太阳方位——上=正午、右=日落、下=午夜、左=日出；
    // 上半圆白昼弧、下半圆黑夜弧。角度在 refreshGameTime 由 getSun().phase 驱动。
    const minorTicks = [];
    for (let i = 0; i < 24; i++) {
        if (i % 6 === 0) continue; // 四主刻度位（正午/日落/午夜/日出）另画
        const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
        const x1 = 24 + Math.cos(a) * 19.5;
        const y1 = 24 + Math.sin(a) * 19.5;
        const x2 = 24 + Math.cos(a) * 21.5;
        const y2 = 24 + Math.sin(a) * 21.5;
        minorTicks.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="dial-tick-minor"/>`);
    }
    const dial = document.createElement('span');
    dial.id = 'gameTimeDial';
    dial.className = 'time-dial';
    dial.innerHTML = `<svg viewBox="0 0 48 48" width="60" height="60" aria-hidden="true">
  <circle cx="24" cy="24" r="22" class="dial-face"/>
  <path d="M 4 24 A 20 20 0 0 1 44 24" class="dial-arc-day"/>
  <path d="M 4 24 A 20 20 0 0 0 44 24" class="dial-arc-night"/>
  <line x1="4" y1="24" x2="44" y2="24" class="dial-horizon"/>
  ${minorTicks.join('')}
  <line x1="24" y1="3" x2="24" y2="8" class="dial-tick-major"/>
  <line x1="24" y1="40" x2="24" y2="45" class="dial-tick-major"/>
  <line x1="3" y1="24" x2="8" y2="24" class="dial-tick-major"/>
  <line x1="40" y1="24" x2="45" y2="24" class="dial-tick-major"/>
  <g id="gameTimeDialHand">
    <line x1="24" y1="24" x2="24" y2="9" class="dial-hand"/>
    <circle cx="24" cy="9" r="3" class="dial-hand-tip"/>
  </g>
  <circle cx="24" cy="24" r="2" class="dial-center"/>
</svg>`;
    const timeIcon = document.createElement('span');
    timeIcon.id = 'gameTimeIcon';
    timeIcon.className = 'time-icon';
    timeIcon.textContent = '☀';
    const timeText = document.createElement('span');
    timeText.id = 'gameTimeText';
    timeText.className = 'time-text';
    timeText.textContent = '第1日 · 12:00 · 白昼';
    gameTime.append(dial, timeIcon, timeText);
    root.appendChild(gameTime);

    const invasionHud = document.createElement('div');
    invasionHud.id = 'worldInvasionHud';
    invasionHud.className = 'world-invasion-hud';
    invasionHud.innerHTML = `
        <div class="world-invasion-label"><span>⚠</span><span id="worldInvasionText">距离入侵 5.0 天</span></div>
        <div id="worldInvasionDetail" class="world-invasion-detail"></div>
        <button id="worldInvasionSupport" class="world-invasion-support" type="button">⚔ 前往支援</button>
        <div class="world-invasion-track"><div id="worldInvasionBar" class="world-invasion-bar"></div></div>`;
    invasionHud.querySelector('#worldInvasionSupport')?.addEventListener('click', () => {
        WorldSwitchPanel.supportActiveInvasion();
    });
    root.appendChild(invasionHud);

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
    // 直接挂 document.body：uiLayer 自身 z-index:10 形成 stacking context，
    // 挂在其中会使 tooltip 的 99999 仅在 uiLayer 内部生效，被 body 级的仓库面板(4000)等遮挡
    document.body.appendChild(equipTooltip);

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
    // 2026-07-30 重构：canvas 预览/拖动区已移除——拖动直接在对话左侧立绘上进行，
    // 面板只保留缩放/旋转/镜像/重置/保存
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
    npcPortraitToolBody.appendChild(npcPortraitToolControls);
    npcPortraitTool.appendChild(npcPortraitToolBody);
    root.appendChild(npcPortraitTool);

    return root;
}
