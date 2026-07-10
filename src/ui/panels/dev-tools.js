// src/ui/panels/dev-tools.js
// 动态创建交互开发工具面板 (dev-tool-panel)

export function createDevToolPanel() {
    // 根容器
    const root = document.createElement('div');
    root.id = 'devToolPanel';
    root.className = 'dev-tool-panel';

    // ===== 头部 =====
    const header = document.createElement('div');
    header.className = 'dev-tool-header';

    const title = document.createElement('span');
    title.className = 'dev-tool-title';
    title.textContent = '🛠️ 交互开发工具';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'dev-tool-close';
    closeBtn.id = 'devToolClose';
    closeBtn.textContent = '✕';
    header.appendChild(closeBtn);

    root.appendChild(header);

    // ===== Tab 栏 =====
    const tabs = document.createElement('div');
    tabs.className = 'dev-tool-tabs';

    const tabWeapon = document.createElement('div');
    tabWeapon.className = 'dev-tool-tab active';
    tabWeapon.dataset.tab = 'weapon';
    tabWeapon.setAttribute('onclick', "DevTool.switchTab('weapon')");
    tabWeapon.textContent = '武器';
    tabs.appendChild(tabWeapon);

    const tabEnemy = document.createElement('div');
    tabEnemy.className = 'dev-tool-tab';
    tabEnemy.dataset.tab = 'enemy';
    tabEnemy.setAttribute('onclick', "DevTool.switchTab('enemy')");
    tabEnemy.textContent = '怪物';
    tabs.appendChild(tabEnemy);

    root.appendChild(tabs);

    // ===== Tab 内容：武器 =====
    const contentWeapon = document.createElement('div');
    contentWeapon.className = 'dev-tool-tab-content active';
    contentWeapon.dataset.tabContent = 'weapon';

    // 上方菜单栏
    const menu = document.createElement('div');
    menu.className = 'dev-tool-menu';

    // 动画选择
    const menuItemAnim = document.createElement('div');
    menuItemAnim.className = 'dev-tool-menu-item';
    menuItemAnim.innerHTML = '<label>动画:</label>';
    const animSelect = document.createElement('select');
    animSelect.id = 'devToolAnimSelect';
    const animOptions = [
        ['idle', '待机'],
        ['walk', '移动'],
        ['running', '奔跑'],
        ['attack', '攻击'],
        ['bow_draw', '拉弓'],
        ['bow_release', '射箭'],
        ['gun_idle', '持枪待机'],
        ['gun_fire', '射击'],
        ['reload', '换弹'],
        ['hurt', '受击'],
        ['death', '死亡'],
    ];
    animOptions.forEach(([value, text]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        animSelect.appendChild(opt);
    });
    menuItemAnim.appendChild(animSelect);
    menu.appendChild(menuItemAnim);

    // 帧控制
    const menuItemFrame = document.createElement('div');
    menuItemFrame.className = 'dev-tool-menu-item';
    menuItemFrame.innerHTML = '<label>帧:</label>';
    const frameSlider = document.createElement('input');
    frameSlider.type = 'range';
    frameSlider.id = 'devToolFrameSlider';
    frameSlider.min = '0';
    frameSlider.max = '0';
    frameSlider.value = '0';
    menuItemFrame.appendChild(frameSlider);
    const frameLabel = document.createElement('span');
    frameLabel.id = 'devToolFrameLabel';
    frameLabel.textContent = '1 / 1';
    menuItemFrame.appendChild(frameLabel);
    const playBtn = document.createElement('button');
    playBtn.id = 'devToolPlayBtn';
    playBtn.className = 'dev-tool-menu-btn';
    playBtn.textContent = '▶ 播放';
    menuItemFrame.appendChild(playBtn);
    menu.appendChild(menuItemFrame);

    // 武器选择
    const menuItemWeapon = document.createElement('div');
    menuItemWeapon.className = 'dev-tool-menu-item';
    menuItemWeapon.innerHTML = '<label>武器:</label>';
    const weaponSelect = document.createElement('select');
    weaponSelect.id = 'devToolWeaponSelect';
    const weaponOptions = [
        ['sword', '⚔️ 剑（生锈长剑）'],
        ['bow', '🏹 弓（训练弓）'],
        ['pistol', '🔫 手枪（G18）'],
        ['deagle', '🔫 沙漠之鹰'],
        ['pkm', '🔥 PKM'],
        ['akm', '🔥 AKM'],
        ['qbz191', '🔥 QBZ-191'],
        ['qjb201', '🔥 QJB-201'],
        ['super90', '🔫 Super90'],
        ['saiga12k', '🔫 S12K'],
        ['energy_lmg', '🔫 能量轻机枪'],
    ];
    weaponOptions.forEach(([value, text]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        weaponSelect.appendChild(opt);
    });
    menuItemWeapon.appendChild(weaponSelect);
    menu.appendChild(menuItemWeapon);

    // 功能按钮
    const btnSave = document.createElement('button');
    btnSave.className = 'dev-tool-menu-btn';
    btnSave.id = 'devToolSave';
    btnSave.textContent = '💾 保存';
    menu.appendChild(btnSave);

    const btnApplyAll = document.createElement('button');
    btnApplyAll.className = 'dev-tool-menu-btn';
    btnApplyAll.id = 'devToolApplyAll';
    btnApplyAll.textContent = '📋 应用到所有帧';
    menu.appendChild(btnApplyAll);

    const btnInterpolate = document.createElement('button');
    btnInterpolate.className = 'dev-tool-menu-btn';
    btnInterpolate.id = 'devToolInterpolate';
    btnInterpolate.textContent = '📈 插值';
    menu.appendChild(btnInterpolate);

    const btnClearKf = document.createElement('button');
    btnClearKf.className = 'dev-tool-menu-btn';
    btnClearKf.id = 'devToolClearKf';
    btnClearKf.textContent = '🗑️ 清空关键帧';
    menu.appendChild(btnClearKf);

    const btnReset = document.createElement('button');
    btnReset.className = 'dev-tool-menu-btn';
    btnReset.id = 'devToolReset2';
    btnReset.textContent = '🔄 重置';
    menu.appendChild(btnReset);

    const btnCoord = document.createElement('button');
    btnCoord.className = 'dev-tool-menu-btn';
    btnCoord.id = 'devToolCoord';
    btnCoord.textContent = '📐 坐标工具';
    menu.appendChild(btnCoord);

    contentWeapon.appendChild(menu);

    // 下方双栏
    const content = document.createElement('div');
    content.className = 'dev-tool-content';

    // 左栏：人物动画展示
    const left = document.createElement('div');
    left.className = 'dev-tool-left';

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'dev-tool-canvas-wrap';
    canvasWrap.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.id = 'devToolCanvas';
    canvas.width = 640;
    canvas.height = 520;
    canvasWrap.appendChild(canvas);

    // 缩放控制按钮
    const zoomControls = document.createElement('div');
    zoomControls.className = 'dev-tool-zoom-controls';
    zoomControls.style.cssText = 'position:absolute;bottom:8px;right:8px;display:flex;gap:4px;z-index:10;';
    
    const btnZoomOut = document.createElement('button');
    btnZoomOut.className = 'dev-tool-zoom-btn';
    btnZoomOut.id = 'devToolZoomOut';
    btnZoomOut.textContent = '−';
    btnZoomOut.title = '缩小';
    zoomControls.appendChild(btnZoomOut);
    
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'dev-tool-zoom-label';
    zoomLabel.id = 'devToolZoomLabel';
    zoomLabel.textContent = '100%';
    zoomLabel.style.cssText = 'color:#d4c5a9;font-size:12px;padding:4px 8px;background:rgba(40,40,40,0.8);border-radius:4px;min-width:50px;text-align:center;';
    zoomControls.appendChild(zoomLabel);
    
    const btnZoomIn = document.createElement('button');
    btnZoomIn.className = 'dev-tool-zoom-btn';
    btnZoomIn.id = 'devToolZoomIn';
    btnZoomIn.textContent = '+';
    btnZoomIn.title = '放大';
    zoomControls.appendChild(btnZoomIn);
    
    const btnZoomReset = document.createElement('button');
    btnZoomReset.className = 'dev-tool-zoom-btn';
    btnZoomReset.id = 'devToolZoomReset';
    btnZoomReset.textContent = '⟲';
    btnZoomReset.title = '重置缩放';
    zoomControls.appendChild(btnZoomReset);
    
    canvasWrap.appendChild(zoomControls);

    const overlay = document.createElement('div');
    overlay.className = 'dev-tool-canvas-overlay';
    const hint = document.createElement('div');
    hint.className = 'dev-tool-hint-text';
    hint.id = 'devToolHint';
    hint.innerHTML = '拖动武器到人物位置 → 按 <kbd>R</kbd> 进入调整模式';
    overlay.appendChild(hint);
    canvasWrap.appendChild(overlay);
    left.appendChild(canvasWrap);

    const frameStrip = document.createElement('div');
    frameStrip.className = 'dev-tool-frame-strip';
    frameStrip.id = 'devToolFrameStrip';
    left.appendChild(frameStrip);

    const info = document.createElement('div');
    info.className = 'dev-tool-info';
    info.id = 'devToolInfo';

    const infoRow1 = document.createElement('div');
    infoRow1.className = 'dev-tool-info-row';
    infoRow1.innerHTML = '<span>状态:</span> <span id="devToolStatus">待机</span>';
    info.appendChild(infoRow1);

    const infoRow2 = document.createElement('div');
    infoRow2.className = 'dev-tool-info-row';
    infoRow2.innerHTML = '<span>武器:</span> <span id="devToolWeaponName">无</span>';
    info.appendChild(infoRow2);

    left.appendChild(info);
    content.appendChild(left);

    // 右栏：武器选择和控制
    const right = document.createElement('div');
    right.className = 'dev-tool-right';

    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'dev-tool-section-title';
    sectionTitle.textContent = '武器贴图';
    right.appendChild(sectionTitle);

    const weaponPreview = document.createElement('div');
    weaponPreview.className = 'dev-tool-weapon-preview';
    weaponPreview.id = 'devToolWeaponPreview';
    const placeholder = document.createElement('div');
    placeholder.className = 'dev-tool-weapon-placeholder';
    placeholder.textContent = '选择武器类型';
    weaponPreview.appendChild(placeholder);
    const weaponImg = document.createElement('img');
    weaponImg.id = 'devToolWeaponImg';
    weaponImg.src = '';
    weaponImg.style.cssText = 'display:none; cursor: grab;';
    weaponImg.alt = 'weapon';
    weaponImg.setAttribute('draggable', 'true');
    weaponPreview.appendChild(weaponImg);
    right.appendChild(weaponPreview);

    const controls = document.createElement('div');
    controls.className = 'dev-tool-controls';

    const controlRows = [
        { label: '屏幕偏移X:', id: 'devToolOffX', value: '0', step: '1' },
        { label: '屏幕偏移Y:', id: 'devToolOffY', value: '0', step: '1' },
        { label: 'Rotation:', id: 'devToolRot', value: '0', step: '1' },
        { label: 'Scale:', id: 'devToolScl', value: '1', step: '0.1' },
    ];
    controlRows.forEach(({ label, id, value, step }) => {
        const row = document.createElement('div');
        row.className = 'dev-tool-control-row';
        row.innerHTML = `<label>${label}</label>`;
        const input = document.createElement('input');
        input.type = 'number';
        input.id = id;
        input.value = value;
        input.step = step;
        row.appendChild(input);
        controls.appendChild(row);
    });
    
    // 设置手部挂载点按钮
    const handAnchorRow = document.createElement('div');
    handAnchorRow.className = 'dev-tool-control-row';
    const handAnchorBtn = document.createElement('button');
    handAnchorBtn.className = 'dev-tool-menu-btn';
    handAnchorBtn.id = 'devToolSetHandAnchor';
    handAnchorBtn.textContent = '✋ 设置手部挂载点';
    handAnchorBtn.style.cssText = 'width:100%;font-size:12px;';
    handAnchorRow.appendChild(handAnchorBtn);
    controls.appendChild(handAnchorRow);
    
    right.appendChild(controls);

    const modeHint = document.createElement('div');
    modeHint.className = 'dev-tool-mode-hint';
    modeHint.id = 'devToolModeHint';
    modeHint.innerHTML = '<div>🖱 左键拖动</div><div>🔄 滚轮缩放</div><div>按 <kbd>R</kbd> 切换旋转/缩放模式</div>';
    right.appendChild(modeHint);

    // 关键帧控制区域（仅在攻击动画显示）
    const keyframeSection = document.createElement('div');
    keyframeSection.className = 'dev-tool-keyframe-section';
    keyframeSection.id = 'devToolKeyframeSection';
    keyframeSection.style.cssText = 'margin-top:10px;padding:8px;background:rgba(40,40,40,0.8);border-radius:6px;border:1px solid #444;';
    
    const kfTitle = document.createElement('div');
    kfTitle.style.cssText = 'font-size:12px;font-weight:bold;color:#d4c5a9;margin-bottom:6px;';
    kfTitle.textContent = '🎬 关键帧编辑';
    keyframeSection.appendChild(kfTitle);
    
    const kfHint = document.createElement('div');
    kfHint.style.cssText = 'font-size:11px;color:#888;margin-bottom:6px;';
    kfHint.innerHTML = '拖动武器到目标位置 → 按 <kbd>K</kbd> 添加关键帧';
    keyframeSection.appendChild(kfHint);
    
    const addKfBtn = document.createElement('button');
    addKfBtn.className = 'dev-tool-menu-btn';
    addKfBtn.id = 'devToolAddKeyframe';
    addKfBtn.textContent = '➕ 添加关键帧';
    addKfBtn.style.cssText = 'width:100%;margin-bottom:4px;font-size:12px;padding:4px;';
    keyframeSection.appendChild(addKfBtn);
    
    const kfList = document.createElement('div');
    kfList.className = 'dev-tool-keyframe-list';
    kfList.id = 'devToolKeyframeList';
    kfList.style.cssText = 'max-height:120px;overflow-y:auto;margin-top:4px;';
    kfList.innerHTML = '<div style="color:#888;text-align:center;padding:10px;">暂无关键帧</div>';
    keyframeSection.appendChild(kfList);
    
    right.appendChild(keyframeSection);

    const dataOutput = document.createElement('div');
    dataOutput.className = 'dev-tool-data-output';
    dataOutput.id = 'devToolDataOutput';
    dataOutput.style.cssText = 'display:none;';
    right.appendChild(dataOutput);

    content.appendChild(right);
    contentWeapon.appendChild(content);
    root.appendChild(contentWeapon);

    // ===== Tab 内容：AI =====
    const contentAI = document.createElement('div');
    contentAI.className = 'dev-tool-tab-content';
    contentAI.dataset.tabContent = 'ai';
    contentAI.style.cssText = 'display:none;';

    const aiDevTool = document.createElement('div');
    aiDevTool.className = 'ai-dev-tool';

    const aiHeader = document.createElement('div');
    aiHeader.className = 'ai-dev-tool-header';
    aiHeader.innerHTML = '<span>当前战术: <span id="aiCurrentTactic">骚扰</span></span><span>怪物数量: <span id="aiEnemyCount">0</span></span>';
    aiDevTool.appendChild(aiHeader);

    const aiMonsterList = document.createElement('div');
    aiMonsterList.className = 'ai-dev-tool-monsters';
    aiMonsterList.id = 'aiDevToolMonsterList';
    const aiMonsterItem = document.createElement('div');
    aiMonsterItem.className = 'ai-monster-item';
    aiMonsterItem.textContent = '暂无活跃怪物';
    aiMonsterList.appendChild(aiMonsterItem);
    aiDevTool.appendChild(aiMonsterList);

    const aiSynergies = document.createElement('div');
    aiSynergies.className = 'ai-dev-tool-synergies';
    aiSynergies.innerHTML = '<h4>激活的协同</h4>';
    const synergyList = document.createElement('div');
    synergyList.id = 'aiDevToolSynergyList';
    const synergyItem = document.createElement('div');
    synergyItem.className = 'ai-synergy-item';
    synergyItem.textContent = '暂无激活的协同';
    synergyList.appendChild(synergyItem);
    aiSynergies.appendChild(synergyList);
    aiDevTool.appendChild(aiSynergies);

    contentAI.appendChild(aiDevTool);
    root.appendChild(contentAI);

    // ===== Tab 内容：怪物贴图调整 =====
    const contentEnemy = document.createElement('div');
    contentEnemy.className = 'dev-tool-tab-content';
    contentEnemy.dataset.tabContent = 'enemy';
    contentEnemy.style.cssText = 'display:none;';

    const enemySpriteTool = document.createElement('div');
    enemySpriteTool.className = 'enemy-sprite-tool';

    // 上方菜单
    const enemyMenu = document.createElement('div');
    enemyMenu.className = 'enemy-sprite-menu';

    const enemyMenuItem = document.createElement('div');
    enemyMenuItem.className = 'enemy-sprite-menu-item';
    enemyMenuItem.innerHTML = '<label>怪物:</label>';
    const enemySelect = document.createElement('select');
    enemySelect.id = 'enemySpriteSelect';
    const enemyOptions = [
        ['blackWolf', '黑狼'],
        ['spider', '蜘蛛'],
        ['fatZombie', '肥僵尸'],
        ['slime', '史莱姆'],
        ['mushroom', '蘑菇怪'],
        ['bat', '蝙蝠'],
        ['skeleton', '骷髅'],
        ['ghost', '幽灵'],
        ['wolf', '灰狼'],
        ['goblin', '哥布林'],
        ['demon', '恶魔'],
        ['dragon', '龙'],
        ['lich', '巫妖'],
        ['bigBoss', '大Boss'],
    ];
    enemyOptions.forEach(([value, text]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        enemySelect.appendChild(opt);
    });
    enemyMenuItem.appendChild(enemySelect);
    enemyMenu.appendChild(enemyMenuItem);

    const enemyBtnSave = document.createElement('button');
    enemyBtnSave.className = 'enemy-sprite-menu-btn';
    enemyBtnSave.id = 'enemySpriteSave';
    enemyBtnSave.textContent = '💾 导出';
    enemyMenu.appendChild(enemyBtnSave);

    const enemyBtnLoad = document.createElement('button');
    enemyBtnLoad.className = 'enemy-sprite-menu-btn';
    enemyBtnLoad.id = 'enemySpriteLoad';
    enemyBtnLoad.textContent = '📋 导入';
    enemyMenu.appendChild(enemyBtnLoad);

    const enemyBtnReset = document.createElement('button');
    enemyBtnReset.className = 'enemy-sprite-menu-btn';
    enemyBtnReset.id = 'enemySpriteReset';
    enemyBtnReset.textContent = '🔄 重置';
    enemyMenu.appendChild(enemyBtnReset);

    enemySpriteTool.appendChild(enemyMenu);

    // 主区域：预览 + 控制
    const enemyContent = document.createElement('div');
    enemyContent.className = 'enemy-sprite-content';

    // 左栏：预览
    const enemyLeft = document.createElement('div');
    enemyLeft.className = 'enemy-sprite-left';

    const enemyCanvasWrap = document.createElement('div');
    enemyCanvasWrap.className = 'enemy-sprite-canvas-wrap';
    const enemyCanvas = document.createElement('canvas');
    enemyCanvas.id = 'enemySpriteCanvas';
    enemyCanvas.width = 400;
    enemyCanvas.height = 400;
    enemyCanvasWrap.appendChild(enemyCanvas);
    enemyLeft.appendChild(enemyCanvasWrap);

    const enemyDirections = document.createElement('div');
    enemyDirections.className = 'enemy-sprite-directions';
    const dirButtons = [
        ['left', '← 左'],
        ['up', '↑ 上'],
        ['right', '→ 右'],
        ['down', '↓ 下'],
    ];
    dirButtons.forEach(([dir, text]) => {
        const btn = document.createElement('button');
        btn.className = dir === 'right' ? 'enemy-direction-btn active' : 'enemy-direction-btn';
        btn.dataset.dir = dir;
        btn.textContent = text;
        enemyDirections.appendChild(btn);
    });
    enemyLeft.appendChild(enemyDirections);

    const enemyOutput = document.createElement('div');
    enemyOutput.className = 'enemy-sprite-output';
    enemyOutput.id = 'enemySpriteOutput';
    enemyOutput.style.cssText = 'display:none;';
    enemyLeft.appendChild(enemyOutput);

    enemyContent.appendChild(enemyLeft);

    // 右栏：参数控制
    const enemyRight = document.createElement('div');
    enemyRight.className = 'enemy-sprite-right';

    const enemySectionTitle = document.createElement('div');
    enemySectionTitle.className = 'enemy-sprite-section-title';
    enemySectionTitle.textContent = '贴图参数';
    enemyRight.appendChild(enemySectionTitle);

    const enemyControls = document.createElement('div');
    enemyControls.className = 'enemy-sprite-controls';

    const enemyControlRows = [
        { label: '精灵图:', id: 'enemySpriteTexture', type: 'select', options: [
            ['enemy_black_wolf', '黑狼（移动）'],
            ['enemy_black_wolf_attack', '黑狼（攻击）'],
            ['enemy_spider', '蜘蛛'],
            ['enemy_slime', '史莱姆'],
            ['enemy_skeleton', '骷髅'],
            ['enemy_ghost', '幽灵'],
        ]},
        { label: '大小:', id: 'enemySpriteSize', type: 'number', value: '216', step: '8', min: '8', max: '512', suffix: 'px' },
        { label: '旋转:', id: 'enemySpriteRotation', type: 'number', value: '0', step: '15', suffix: '°' },
        { label: '水平翻转:', id: 'enemySpriteFlipX', type: 'checkbox' },
        { label: '垂直翻转:', id: 'enemySpriteFlipY', type: 'checkbox' },
    ];
    enemyControlRows.forEach((rowDef) => {
        const row = document.createElement('div');
        row.className = 'enemy-sprite-control-row';
        row.innerHTML = `<label>${rowDef.label}</label>`;
        if (rowDef.type === 'select') {
            const sel = document.createElement('select');
            sel.id = rowDef.id;
            rowDef.options.forEach(([value, text]) => {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = text;
                sel.appendChild(opt);
            });
            row.appendChild(sel);
        } else if (rowDef.type === 'checkbox') {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = rowDef.id;
            row.appendChild(cb);
        } else {
            const input = document.createElement('input');
            input.type = 'number';
            input.id = rowDef.id;
            input.value = rowDef.value;
            if (rowDef.step) input.step = rowDef.step;
            if (rowDef.min) input.min = rowDef.min;
            if (rowDef.max) input.max = rowDef.max;
            row.appendChild(input);
            if (rowDef.suffix) {
                const span = document.createElement('span');
                span.textContent = rowDef.suffix;
                row.appendChild(span);
            }
        }
        enemyControls.appendChild(row);
    });
    enemyRight.appendChild(enemyControls);

    const enemyHint = document.createElement('div');
    enemyHint.className = 'enemy-sprite-hint';
    enemyHint.innerHTML = '<div>调整参数后实时预览</div><div>导出 JSON 后复制给我</div>';
    enemyRight.appendChild(enemyHint);

    enemyContent.appendChild(enemyRight);
    enemySpriteTool.appendChild(enemyContent);
    contentEnemy.appendChild(enemySpriteTool);
    root.appendChild(contentEnemy);

    return root;
}
