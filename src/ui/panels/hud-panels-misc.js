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
        { action: 'QuestSystem.toggle()', title: '任务档案 (L)', icon: 'assets/ui/icons/quest.png', alt: '任务档案', key: 'L', label: '任务档案' },
        { action: 'WorldSwitchPanel.toggle()', title: '世界 (O)', icon: 'assets/ui/icons/world_switch.png', alt: '世界', key: 'O', label: '世界', id: 'worldSwitchBtn' },
        { action: 'CompanionPanel.toggleManage()', title: '管理队员 (P)', icon: 'assets/ui/icons/party.png', alt: '队员', key: 'P', label: '队员管理' },
        { action: 'TechnologyTreePanel.toggle()', title: '科技树 (Y)', icon: 'assets/ui/icons/technology_tree.png', alt: '科技树', key: 'Y', label: '科技树', id: 'technologyTreeBtn' },
        // 可用属性点是条件提示入口，固定放在常驻科技树下方的最末位。
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
                if (action === 'QuestSystem.toggle()') QuestSystem.toggle();
                else if (action === 'TechnologyTreePanel.toggle()') TechnologyTreePanel.toggle();
                else if (action === 'Game.handleAddPoint()') Game.handleAddPoint();
                else if (action === 'CompanionPanel.toggleManage()') CompanionPanel.toggleManage();
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

    // ===== 右上角经济面板与游戏时间 =====
    const topRightHud = document.createElement('div');
    topRightHud.className = 'top-right-hud';

    const resourceBar = document.createElement('div');
    resourceBar.id = 'basicResourceBar';
    // basic-resource-bar 保留为既有兼容类；玩家可见命名统一为“经济面板”。
    resourceBar.className = 'basic-resource-bar economy-panel';
    resourceBar.dataset.panelName = '经济面板';
    resourceBar.setAttribute('role', 'region');
    resourceBar.setAttribute('aria-label', '经济面板');

    const resourceSummary = document.createElement('div');
    resourceSummary.className = 'economy-panel-summary';
    const populationRow = document.createElement('div');
    populationRow.className = 'economy-panel-population-row';
    [
        { key: 'gold', label: '金币', iconSrc: 'assets/ui/resource-icons/gold.png', valueId: 'resourceGoldTotal' },
        { key: 'energy', label: '能源', iconSrc: 'assets/ui/resource-icons/energy.png', valueId: 'resourceEnergyTotal' },
        { key: 'food', label: '食物', iconSrc: 'assets/ui/resource-icons/food.png', valueId: 'resourceFoodTotal' },
        { key: 'military-population', label: '兵力', iconSrc: 'assets/ui/unit-icons/hamster-warrior.png', valueId: 'resourceMilitaryPopulation' },
        { key: 'working-population', label: '人口', iconSrc: 'assets/ui/unit-icons/hamster-explorer.png', valueId: 'resourceWorkingPopulation' },
    ].forEach((resource) => {
        const item = document.createElement('div');
        item.className = `basic-resource-item basic-resource-item--${resource.key}`;
        item.title = resource.key === 'military-population'
            ? '军事人口：已出兵数 / 房屋提供的人口上限（不占用经济岗位人口）'
            : resource.key === 'working-population'
                ? '本位面实际居民人数；已用岗位、空闲人口和住房容量在展开详情中分别显示（不含军事单位）'
                : `${resource.label}总量`;

        const icon = document.createElement('img');
        icon.className = 'basic-resource-icon';
        icon.src = resource.iconSrc;
        icon.alt = '';
        icon.draggable = false;
        icon.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'basic-resource-label';
        label.textContent = resource.label;

        const value = document.createElement('strong');
        value.id = resource.valueId;
        value.className = 'basic-resource-value';
        value.textContent = resource.key === 'military-population' ? '0/0' : '0';

        item.append(icon, label, value);
        if (resource.key.endsWith('population')) populationRow.appendChild(item);
        else resourceSummary.appendChild(item);
    });
    resourceSummary.appendChild(populationRow);

    const economyDetails = document.createElement('div');
    economyDetails.id = 'economyPanelExpandedDetails';
    economyDetails.className = 'economy-panel-expanded-details';
    economyDetails.innerHTML = `
      <div class="economy-panel-detail-content">
        <div class="economy-detail-heading">
            <span>仓库容量</span>
            <strong id="economyWarehouseCount">0座</strong>
        </div>
        <div class="economy-capacity-list">
            <div class="economy-capacity-row economy-capacity-row--unbounded">
                <div class="economy-capacity-meta"><span>金币</span><strong id="economyGoldCapacityText">0 · 无上限</strong></div>
                <div class="economy-capacity-track economy-capacity-track--unbounded" role="status" aria-label="金币无限堆叠"><span></span></div>
            </div>
            <div class="economy-capacity-row">
                <div class="economy-capacity-meta"><span>总占用</span><strong id="economyStorageCapacityText">0 / 0 · 余 0</strong></div>
                <div id="economyStorageCapacityTrack" class="economy-capacity-track" role="progressbar" aria-label="仓库总容量" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span id="economyStorageCapacityFill" class="economy-capacity-fill economy-capacity-fill--storage"></span></div>
            </div>
            <div class="economy-capacity-row">
                <div class="economy-capacity-meta"><span>能源</span><strong id="economyEnergyCapacityText">0 / 0 · 余 0</strong></div>
                <div id="economyEnergyCapacityTrack" class="economy-capacity-track" role="progressbar" aria-label="能源可存容量" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span id="economyEnergyCapacityFill" class="economy-capacity-fill economy-capacity-fill--energy"></span></div>
            </div>
            <div class="economy-capacity-row">
                <div class="economy-capacity-meta"><span>食物</span><strong id="economyFoodCapacityText">0 / 0 · 余 0</strong></div>
                <div id="economyFoodCapacityTrack" class="economy-capacity-track" role="progressbar" aria-label="食物可存容量" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span id="economyFoodCapacityFill" class="economy-capacity-fill economy-capacity-fill--food"></span></div>
            </div>
        </div>
        <div class="economy-detail-heading"><span>人口与住房</span><small>居民与兵力独立</small></div>
        <div class="economy-capacity-list economy-capacity-list--population">
            <div class="economy-capacity-row">
                <div class="economy-capacity-meta"><span>兵力</span><strong id="economyMilitaryCapacityText">0 / 0 · 余 0</strong></div>
                <div id="economyMilitaryCapacityTrack" class="economy-capacity-track" role="progressbar" aria-label="军事人口容量" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span id="economyMilitaryCapacityFill" class="economy-capacity-fill economy-capacity-fill--military"></span></div>
            </div>
            <div class="economy-capacity-row">
                <div class="economy-capacity-meta"><span>已用岗位 / 实际人口</span><strong id="economyWorkingCapacityText">0 / 0 · 空闲 0</strong></div>
                <div id="economyWorkingCapacityTrack" class="economy-capacity-track" role="progressbar" aria-label="已用岗位占实际人口的比例" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span id="economyWorkingCapacityFill" class="economy-capacity-fill economy-capacity-fill--working"></span></div>
            </div>
            <div class="economy-capacity-row economy-capacity-row--housing" title="实际居民 / 住房容量；住房已满只减速，不停止增长">
                <div class="economy-capacity-meta"><span>居民 / 住房</span><strong id="economyHousingCapacityText">0 / 0 · 余 0</strong></div>
                <div id="economyHousingCapacityTrack" class="economy-capacity-track" role="progressbar" aria-label="实际居民与住房容量" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><span id="economyHousingCapacityFill" class="economy-capacity-fill economy-capacity-fill--working"></span></div>
            </div>
        </div>
        <div class="economy-detail-heading"><span>每秒净收支</span></div>
        <p id="economyRateWindow" class="economy-rate-note">周期均摊 / 实收支统计</p>
        <div class="economy-rate-grid">
            <div><span>金币</span><strong id="economyGoldRate">0.00/秒</strong><small id="economyGoldIncome">收入 +0.00/秒</small><small id="economyGoldExpense">消耗 −0.00/秒</small></div>
            <div><span>能源</span><strong id="economyEnergyRate">0.00/秒</strong><small id="economyEnergyIncome">收入 +0.00/秒</small><small id="economyEnergyExpense">消耗 −0.00/秒</small></div>
            <div><span>食物</span><strong id="economyFoodRate">0.00/秒</strong><small id="economyFoodIncome">收入 +0.00/秒</small><small id="economyFoodExpense">消耗 −0.00/秒</small></div>
        </div>
      </div>`;

    const economyModeToggle = document.createElement('button');
    economyModeToggle.id = 'economyPanelModeToggle';
    economyModeToggle.className = 'economy-panel-mode-toggle';
    economyModeToggle.type = 'button';
    economyModeToggle.setAttribute('aria-controls', economyDetails.id);
    economyModeToggle.setAttribute('aria-expanded', 'false');
    economyModeToggle.setAttribute('aria-label', '展开经济面板详情');
    economyModeToggle.title = '展开详细经济面板';
    economyModeToggle.innerHTML = '<span aria-hidden="true">⌄</span>';
    economyModeToggle.addEventListener('click', () => {
        const expanded = resourceBar.classList.toggle('is-expanded');
        economyModeToggle.setAttribute('aria-expanded', String(expanded));
        economyModeToggle.setAttribute('aria-label', expanded ? '收起经济面板详情' : '展开经济面板详情');
        economyModeToggle.title = expanded ? '收起经济面板详情' : '展开详细经济面板';
        economyModeToggle.blur();
    });
    resourceBar.append(resourceSummary, economyDetails, economyModeToggle);

    // 游戏内时间与 EnvironmentLightingSystem 昼夜相位同源。
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
    topRightHud.append(resourceBar, gameTime);
    root.appendChild(topRightHud);

    const invasionHud = document.createElement('div');
    invasionHud.id = 'worldInvasionHud';
    // ID/class 保留兼容旧调用；玩家可见名称统一为“时间进度栏”。
    invasionHud.className = 'world-invasion-hud is-compact';
    invasionHud.dataset.panelName = '时间进度栏';
    invasionHud.setAttribute('role', 'region');
    invasionHud.setAttribute('aria-label', '时间进度栏');
    invasionHud.innerHTML = `
        <div id="worldTimelineExpandedDetails" class="world-timeline-expanded-details">
            <div class="world-timeline-heading">
                <span id="worldTimelineTitle" class="world-timeline-title">时间进度栏</span>
                <span id="worldTimelineWindow" class="world-timeline-window">未来5日</span>
            </div>
            <div id="worldTimelineFilters" class="world-timeline-filters" role="group" aria-label="事件类型筛选"></div>
            <div class="world-invasion-label"><span>⚔</span><span id="worldInvasionText">暂无入侵情报</span></div>
            <div id="worldInvasionDetail" class="world-invasion-detail"></div>
            <button id="worldInvasionSupport" class="world-invasion-support" type="button">⚔ 前往支援</button>
        </div>
        <div class="world-invasion-track" role="img" aria-label="时间进度栏：未来5日事件">
            <div id="worldInvasionBar" class="world-invasion-bar"></div>
            <div id="worldTimelineEvents" class="world-timeline-events"></div>
            <div id="worldTimelineCursor" class="world-timeline-cursor"><span>现在</span></div>
        </div>
        <button id="worldTimelineModeToggle" class="world-timeline-mode-toggle" type="button"
            aria-controls="worldTimelineExpandedDetails" aria-expanded="false" aria-label="展开时间进度栏详情">
            <span aria-hidden="true">⌄</span>
        </button>
        <section id="worldTimelinePopover" class="world-timeline-popover" aria-labelledby="worldTimelinePopoverTitle" hidden>
            <div class="world-timeline-popover-heading">
                <span id="worldTimelinePopoverTitle">事件详情</span>
                <button id="worldTimelinePopoverClose" type="button" aria-label="关闭事件详情">×</button>
            </div>
            <div id="worldTimelinePopoverContent" class="world-timeline-popover-content"></div>
        </section>`;
    invasionHud.querySelector('#worldInvasionSupport')?.addEventListener('click', () => {
        WorldSwitchPanel.supportActiveInvasion();
    });
    const closeTimelinePopover = () => {
        const popover = invasionHud.querySelector('#worldTimelinePopover');
        if (popover) {
            popover.hidden = true;
            popover.removeAttribute('data-source-id');
        }
    };
    const timelineModeToggle = invasionHud.querySelector('#worldTimelineModeToggle');
    timelineModeToggle?.addEventListener('click', () => {
        const compact = !invasionHud.classList.contains('is-compact');
        invasionHud.classList.toggle('is-compact', compact);
        timelineModeToggle.setAttribute('aria-expanded', String(!compact));
        timelineModeToggle.setAttribute('aria-label', compact ? '展开时间进度栏详情' : '收起时间进度栏详情');
        timelineModeToggle.title = compact ? '展开详细时间进度栏' : '收起为简化时间进度栏';
        if (compact) closeTimelinePopover();
        timelineModeToggle.blur();
    });
    if (timelineModeToggle) timelineModeToggle.title = '展开详细时间进度栏';
    invasionHud.querySelector('#worldTimelinePopoverClose')?.addEventListener('click', closeTimelinePopover);
    invasionHud.addEventListener('keydown', (event) => {
        const popover = invasionHud.querySelector('#worldTimelinePopover');
        if (event.key !== 'Escape' || !popover || popover.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        closeTimelinePopover();
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
