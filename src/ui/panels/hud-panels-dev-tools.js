export function createDevToolPanel() {
    // ===== 交互开发工具面板 =====
    const devToolPanel = document.createElement('div');
    devToolPanel.id = 'devToolPanel';
    devToolPanel.className = 'dev-tool-panel';
    const devToolHeader = document.createElement('div');
    devToolHeader.className = 'dev-tool-header';
    const devToolTitle = document.createElement('span');
    devToolTitle.className = 'dev-tool-title';
    devToolTitle.textContent = '🛠️ 交互开发工具';
    const devToolClose = document.createElement('button');
    devToolClose.className = 'dev-tool-close';
    devToolClose.id = 'devToolClose';
    devToolClose.textContent = '✕';
    devToolHeader.appendChild(devToolTitle);
    devToolHeader.appendChild(devToolClose);
    devToolPanel.appendChild(devToolHeader);
    // Tab 栏
    const devToolTabs = document.createElement('div');
    devToolTabs.className = 'dev-tool-tabs';
    const devToolTabWeapon = document.createElement('div');
    devToolTabWeapon.className = 'dev-tool-tab active';
    devToolTabWeapon.dataset.tab = 'weapon';
    devToolTabWeapon.onclick = function() { DevTool.switchTab('weapon'); };
    devToolTabWeapon.textContent = '武器';
    const devToolTabEnemy = document.createElement('div');
    devToolTabEnemy.className = 'dev-tool-tab';
    devToolTabEnemy.dataset.tab = 'enemy';
    devToolTabEnemy.onclick = function() { DevTool.switchTab('enemy'); };
    devToolTabEnemy.textContent = '怪物';
    devToolTabs.appendChild(devToolTabWeapon);
    devToolTabs.appendChild(devToolTabEnemy);
    devToolPanel.appendChild(devToolTabs);
    // Tab 内容：武器
    const devToolTabContentWeapon = document.createElement('div');
    devToolTabContentWeapon.className = 'dev-tool-tab-content active';
    devToolTabContentWeapon.dataset.tabContent = 'weapon';
    // 上方菜单栏
    const devToolMenu = document.createElement('div');
    devToolMenu.className = 'dev-tool-menu';
    // 动画选择
    const menuItem1 = document.createElement('div');
    menuItem1.className = 'dev-tool-menu-item';
    const labelAnim = document.createElement('label');
    labelAnim.textContent = '动画:';
    const devToolAnimSelect = document.createElement('select');
    devToolAnimSelect.id = 'devToolAnimSelect';
    const animOptions = ['idle', 'walk', 'running', 'attack', 'bow_draw', 'bow_release', 'gun_idle', 'gun_fire', 'reload', 'hurt', 'death'];
    const animLabels = ['待机', '移动', '奔跑', '攻击', '拉弓', '射箭', '持枪待机', '射击', '换弹', '受击', '死亡'];
    animOptions.forEach((val, i) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = animLabels[i];
        devToolAnimSelect.appendChild(opt);
    });
    menuItem1.appendChild(labelAnim);
    menuItem1.appendChild(devToolAnimSelect);
    devToolMenu.appendChild(menuItem1);
    // 帧控制
    const menuItem2 = document.createElement('div');
    menuItem2.className = 'dev-tool-menu-item';
    const labelFrame = document.createElement('label');
    labelFrame.textContent = '帧:';
    const devToolFrameSlider = document.createElement('input');
    devToolFrameSlider.type = 'range';
    devToolFrameSlider.id = 'devToolFrameSlider';
    devToolFrameSlider.min = '0';
    devToolFrameSlider.max = '0';
    devToolFrameSlider.value = '0';
    const devToolFrameLabel = document.createElement('span');
    devToolFrameLabel.id = 'devToolFrameLabel';
    devToolFrameLabel.textContent = '1 / 1';
    const devToolPlayBtn = document.createElement('button');
    devToolPlayBtn.id = 'devToolPlayBtn';
    devToolPlayBtn.className = 'dev-tool-menu-btn';
    devToolPlayBtn.textContent = '▶ 播放';
    menuItem2.appendChild(labelFrame);
    menuItem2.appendChild(devToolFrameSlider);
    menuItem2.appendChild(devToolFrameLabel);
    menuItem2.appendChild(devToolPlayBtn);
    devToolMenu.appendChild(menuItem2);
    // 武器选择
    const menuItem3 = document.createElement('div');
    menuItem3.className = 'dev-tool-menu-item';
    const labelWeapon = document.createElement('label');
    labelWeapon.textContent = '武器:';
    const devToolWeaponSelect = document.createElement('select');
    devToolWeaponSelect.id = 'devToolWeaponSelect';
    const weaponOptions = [
        { val: 'sword', label: '⚔️ 剑（生锈长剑）' },
        { val: 'bow', label: '🏹 弓（训练弓）' },
        { val: 'pistol', label: '🔫 手枪（G18）' },
        { val: 'deagle', label: '🔫 沙漠之鹰' },
        { val: 'pkm', label: '🔥 PKM' },
        { val: 'akm', label: '🔥 AKM' },
        { val: 'qbz191', label: '🔥 QBZ-191' },
        { val: 'qjb201', label: '🔥 QJB-201' },
        { val: 'super90', label: '🔫 Super90' },
        { val: 'saiga12k', label: '🔫 S12K' },
        { val: 'energy_lmg', label: '🔫 能量轻机枪' }
    ];
    weaponOptions.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.val;
        opt.textContent = w.label;
        devToolWeaponSelect.appendChild(opt);
    });
    menuItem3.appendChild(labelWeapon);
    menuItem3.appendChild(devToolWeaponSelect);
    devToolMenu.appendChild(menuItem3);
    // 菜单按钮
    const menuBtnDefs = [
        { id: 'devToolSave', text: '💾 保存' },
        { id: 'devToolApplyAll', text: '📋 应用到所有帧' },
        { id: 'devToolInterpolate', text: '📈 插值' },
        { id: 'devToolClearKf', text: '🗑️ 清空关键帧' },
        { id: 'devToolReset2', text: '🔄 重置' },
        { id: 'devToolCoord', text: '📐 坐标工具' }
    ];
    menuBtnDefs.forEach(def => {
        const btn = document.createElement('button');
        btn.id = def.id;
        btn.className = 'dev-tool-menu-btn';
        btn.textContent = def.text;
        devToolMenu.appendChild(btn);
    });
    devToolTabContentWeapon.appendChild(devToolMenu);
    // 下方双栏
    const devToolContent = document.createElement('div');
    devToolContent.className = 'dev-tool-content';
    // 左栏
    const devToolLeft = document.createElement('div');
    devToolLeft.className = 'dev-tool-left';
    const devToolCanvasWrap = document.createElement('div');
    devToolCanvasWrap.className = 'dev-tool-canvas-wrap';
    const devToolCanvas = document.createElement('canvas');
    devToolCanvas.id = 'devToolCanvas';
    devToolCanvas.width = 640;
    devToolCanvas.height = 520;
    const devToolCanvasOverlay = document.createElement('div');
    devToolCanvasOverlay.className = 'dev-tool-canvas-overlay';
    const devToolHint = document.createElement('div');
    devToolHint.className = 'dev-tool-hint-text';
    devToolHint.id = 'devToolHint';
    devToolHint.textContent = '拖动武器到人物位置 → 按 R 进入调整模式';
    devToolCanvasOverlay.appendChild(devToolHint);
    devToolCanvasWrap.appendChild(devToolCanvas);
    devToolCanvasWrap.appendChild(devToolCanvasOverlay);
    devToolLeft.appendChild(devToolCanvasWrap);
    const devToolFrameStrip = document.createElement('div');
    devToolFrameStrip.className = 'dev-tool-frame-strip';
    devToolFrameStrip.id = 'devToolFrameStrip';
    devToolLeft.appendChild(devToolFrameStrip);
    const devToolInfo = document.createElement('div');
    devToolInfo.className = 'dev-tool-info';
    devToolInfo.id = 'devToolInfo';
    const infoRow1 = document.createElement('div');
    infoRow1.className = 'dev-tool-info-row';
    const infoSpan1 = document.createElement('span');
    infoSpan1.textContent = '状态:';
    const infoStatus = document.createElement('span');
    infoStatus.id = 'devToolStatus';
    infoStatus.textContent = '待机';
    infoRow1.appendChild(infoSpan1);
    infoRow1.appendChild(infoStatus);
    const infoRow2 = document.createElement('div');
    infoRow2.className = 'dev-tool-info-row';
    const infoSpan2 = document.createElement('span');
    infoSpan2.textContent = '武器:';
    const infoWeaponName = document.createElement('span');
    infoWeaponName.id = 'devToolWeaponName';
    infoWeaponName.textContent = '无';
    infoRow2.appendChild(infoSpan2);
    infoRow2.appendChild(infoWeaponName);
    devToolInfo.appendChild(infoRow1);
    devToolInfo.appendChild(infoRow2);
    devToolLeft.appendChild(devToolInfo);
    devToolContent.appendChild(devToolLeft);
    // 右栏
    const devToolRight = document.createElement('div');
    devToolRight.className = 'dev-tool-right';
    const devToolSectionTitle = document.createElement('div');
    devToolSectionTitle.className = 'dev-tool-section-title';
    devToolSectionTitle.textContent = '武器贴图';
    devToolRight.appendChild(devToolSectionTitle);
    const devToolWeaponPreview = document.createElement('div');
    devToolWeaponPreview.className = 'dev-tool-weapon-preview';
    devToolWeaponPreview.id = 'devToolWeaponPreview';
    const weaponPlaceholder = document.createElement('div');
    weaponPlaceholder.className = 'dev-tool-weapon-placeholder';
    weaponPlaceholder.textContent = '选择武器类型';
    const devToolWeaponImg = document.createElement('img');
    devToolWeaponImg.id = 'devToolWeaponImg';
    devToolWeaponImg.src = '';
    devToolWeaponImg.style.display = 'none';
    devToolWeaponImg.style.cursor = 'grab';
    devToolWeaponImg.alt = 'weapon';
    devToolWeaponImg.draggable = true;
    devToolWeaponPreview.appendChild(weaponPlaceholder);
    devToolWeaponPreview.appendChild(devToolWeaponImg);
    devToolRight.appendChild(devToolWeaponPreview);
    const devToolControls = document.createElement('div');
    devToolControls.className = 'dev-tool-controls';
    const controlRows = [
        { label: '屏幕偏移X:', id: 'devToolOffX', val: '0', step: '1' },
        { label: '屏幕偏移Y:', id: 'devToolOffY', val: '0', step: '1' },
        { label: 'Rotation:', id: 'devToolRot', val: '0', step: '1' },
        { label: 'Scale:', id: 'devToolScl', val: '1', step: '0.1' }
    ];
    controlRows.forEach(cr => {
        const row = document.createElement('div');
        row.className = 'dev-tool-control-row';
        const label = document.createElement('label');
        label.textContent = cr.label;
        const input = document.createElement('input');
        input.type = 'number';
        input.id = cr.id;
        input.value = cr.val;
        input.step = cr.step;
        row.appendChild(label);
        row.appendChild(input);
        devToolControls.appendChild(row);
    });
    devToolRight.appendChild(devToolControls);
    const devToolModeHint = document.createElement('div');
    devToolModeHint.className = 'dev-tool-mode-hint';
    devToolModeHint.id = 'devToolModeHint';
    devToolModeHint.innerHTML = '<div>🖱 左键拖动</div><div>🔄 滚轮缩放</div><div>按 <kbd>R</kbd> 切换旋转/缩放模式</div>';
    devToolRight.appendChild(devToolModeHint);
    const devToolDataOutput = document.createElement('div');
    devToolDataOutput.className = 'dev-tool-data-output';
    devToolDataOutput.id = 'devToolDataOutput';
    devToolDataOutput.style.display = 'none';
    devToolRight.appendChild(devToolDataOutput);
    devToolContent.appendChild(devToolRight);
    devToolTabContentWeapon.appendChild(devToolContent);
    devToolPanel.appendChild(devToolTabContentWeapon);
    // Tab 内容：AI
    const devToolTabContentAi = document.createElement('div');
    devToolTabContentAi.className = 'dev-tool-tab-content';
    devToolTabContentAi.dataset.tabContent = 'ai';
    devToolTabContentAi.style.display = 'none';
    const aiDevTool = document.createElement('div');
    aiDevTool.className = 'ai-dev-tool';
    const aiDevToolHeader = document.createElement('div');
    aiDevToolHeader.className = 'ai-dev-tool-header';
    aiDevToolHeader.innerHTML = '<span>当前战术: <span id="aiCurrentTactic">骚扰</span></span><span>怪物数量: <span id="aiEnemyCount">0</span></span>';
    aiDevTool.appendChild(aiDevToolHeader);
    const aiDevToolMonsters = document.createElement('div');
    aiDevToolMonsters.className = 'ai-dev-tool-monsters';
    aiDevToolMonsters.id = 'aiDevToolMonsterList';
    const aiMonsterItem = document.createElement('div');
    aiMonsterItem.className = 'ai-monster-item';
    aiMonsterItem.textContent = '暂无活跃怪物';
    aiDevToolMonsters.appendChild(aiMonsterItem);
    aiDevTool.appendChild(aiDevToolMonsters);
    const aiDevToolSynergies = document.createElement('div');
    aiDevToolSynergies.className = 'ai-dev-tool-synergies';
    const aiSynergiesH4 = document.createElement('h4');
    aiSynergiesH4.textContent = '激活的协同';
    aiDevToolSynergies.appendChild(aiSynergiesH4);
    const aiDevToolSynergyList = document.createElement('div');
    aiDevToolSynergyList.id = 'aiDevToolSynergyList';
    const aiSynergyItem = document.createElement('div');
    aiSynergyItem.className = 'ai-synergy-item';
    aiSynergyItem.textContent = '暂无激活的协同';
    aiDevToolSynergyList.appendChild(aiSynergyItem);
    aiDevToolSynergies.appendChild(aiDevToolSynergyList);
    aiDevTool.appendChild(aiDevToolSynergies);
    devToolTabContentAi.appendChild(aiDevTool);
    devToolPanel.appendChild(devToolTabContentAi);
    // Tab 内容：怪物贴图调整
    const devToolTabContentEnemy = document.createElement('div');
    devToolTabContentEnemy.className = 'dev-tool-tab-content';
    devToolTabContentEnemy.dataset.tabContent = 'enemy';
    devToolTabContentEnemy.style.display = 'none';
    const enemySpriteTool = document.createElement('div');
    enemySpriteTool.className = 'enemy-sprite-tool';
    // 上方菜单
    const enemySpriteMenu = document.createElement('div');
    enemySpriteMenu.className = 'enemy-sprite-menu';
    const enemySpriteMenuItem = document.createElement('div');
    enemySpriteMenuItem.className = 'enemy-sprite-menu-item';
    const enemyLabel = document.createElement('label');
    enemyLabel.textContent = '怪物:';
    const enemySpriteSelect = document.createElement('select');
    enemySpriteSelect.id = 'enemySpriteSelect';
    const enemyOptions = [
        'blackWolf', 'spider', 'fatZombie', 'slime', 'mushroom', 'bat',
        'skeleton', 'ghost', 'wolf', 'goblin', 'demon', 'dragon', 'lich', 'bigBoss'
    ];
    const enemyLabels = [
        '黑狼', '蜘蛛', '肥僵尸', '史莱姆', '蘑菇怪', '蝙蝠',
        '骷髅', '幽灵', '灰狼', '哥布林', '恶魔', '龙', '巫妖', '大Boss'
    ];
    enemyOptions.forEach((val, i) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = enemyLabels[i];
        enemySpriteSelect.appendChild(opt);
    });
    enemySpriteMenuItem.appendChild(enemyLabel);
    enemySpriteMenuItem.appendChild(enemySpriteSelect);
    enemySpriteMenu.appendChild(enemySpriteMenuItem);
    const enemyMenuBtns = [
        { id: 'enemySpriteSave', text: '💾 导出' },
        { id: 'enemySpriteLoad', text: '📋 导入' },
        { id: 'enemySpriteReset', text: '🔄 重置' }
    ];
    enemyMenuBtns.forEach(def => {
        const btn = document.createElement('button');
        btn.id = def.id;
        btn.className = 'enemy-sprite-menu-btn';
        btn.textContent = def.text;
        enemySpriteMenu.appendChild(btn);
    });
    enemySpriteTool.appendChild(enemySpriteMenu);
    // 主区域：预览 + 控制
    const enemySpriteContent = document.createElement('div');
    enemySpriteContent.className = 'enemy-sprite-content';
    // 左栏：预览
    const enemySpriteLeft = document.createElement('div');
    enemySpriteLeft.className = 'enemy-sprite-left';
    const enemySpriteCanvasWrap = document.createElement('div');
    enemySpriteCanvasWrap.className = 'enemy-sprite-canvas-wrap';
    const enemySpriteCanvas = document.createElement('canvas');
    enemySpriteCanvas.id = 'enemySpriteCanvas';
    enemySpriteCanvas.width = 400;
    enemySpriteCanvas.height = 400;
    enemySpriteCanvasWrap.appendChild(enemySpriteCanvas);
    enemySpriteLeft.appendChild(enemySpriteCanvasWrap);
    const enemySpriteDirections = document.createElement('div');
    enemySpriteDirections.className = 'enemy-sprite-directions';
    const dirDefs = [
        { dir: 'left', text: '← 左' },
        { dir: 'up', text: '↑ 上' },
        { dir: 'right', text: '→ 右', active: true },
        { dir: 'down', text: '↓ 下' }
    ];
    dirDefs.forEach(d => {
        const btn = document.createElement('button');
        btn.className = 'enemy-direction-btn' + (d.active ? ' active' : '');
        btn.dataset.dir = d.dir;
        btn.textContent = d.text;
        enemySpriteDirections.appendChild(btn);
    });
    enemySpriteLeft.appendChild(enemySpriteDirections);
    const enemySpriteOutput = document.createElement('div');
    enemySpriteOutput.className = 'enemy-sprite-output';
    enemySpriteOutput.id = 'enemySpriteOutput';
    enemySpriteOutput.style.display = 'none';
    enemySpriteLeft.appendChild(enemySpriteOutput);
    enemySpriteContent.appendChild(enemySpriteLeft);
    // 右栏：参数控制
    const enemySpriteRight = document.createElement('div');
    enemySpriteRight.className = 'enemy-sprite-right';
    const enemySpriteSectionTitle = document.createElement('div');
    enemySpriteSectionTitle.className = 'enemy-sprite-section-title';
    enemySpriteSectionTitle.textContent = '贴图参数';
    enemySpriteRight.appendChild(enemySpriteSectionTitle);
    const enemySpriteControls = document.createElement('div');
    enemySpriteControls.className = 'enemy-sprite-controls';
    const enemyControlRows = [
        { label: '精灵图:', id: 'enemySpriteTexture', type: 'select', options: [
            { val: 'enemy_black_wolf', label: '黑狼（移动）' },
            { val: 'enemy_black_wolf_attack', label: '黑狼（攻击）' },
            { val: 'enemy_spider', label: '蜘蛛' },
            { val: 'enemy_slime', label: '史莱姆' },
            { val: 'enemy_skeleton', label: '骷髅' },
            { val: 'enemy_ghost', label: '幽灵' }
        ]},
        { label: '大小:', id: 'enemySpriteSize', type: 'number', val: '216', step: '8', min: '8', max: '512', suffix: 'px' },
        { label: '旋转:', id: 'enemySpriteRotation', type: 'number', val: '0', step: '15', suffix: '°' },
        { label: '水平翻转:', id: 'enemySpriteFlipX', type: 'checkbox' },
        { label: '垂直翻转:', id: 'enemySpriteFlipY', type: 'checkbox' }
    ];
    enemyControlRows.forEach(cr => {
        const row = document.createElement('div');
        row.className = 'enemy-sprite-control-row';
        const label = document.createElement('label');
        label.textContent = cr.label;
        row.appendChild(label);
        if (cr.type === 'select') {
            const select = document.createElement('select');
            select.id = cr.id;
            cr.options.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.val;
                opt.textContent = o.label;
                select.appendChild(opt);
            });
            row.appendChild(select);
        } else if (cr.type === 'checkbox') {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = cr.id;
            row.appendChild(input);
        } else {
            const input = document.createElement('input');
            input.type = 'number';
            input.id = cr.id;
            input.value = cr.val;
            input.step = cr.step;
            if (cr.min) input.min = cr.min;
            if (cr.max) input.max = cr.max;
            row.appendChild(input);
            if (cr.suffix) {
                const span = document.createElement('span');
                span.textContent = cr.suffix;
                row.appendChild(span);
            }
        }
        enemySpriteControls.appendChild(row);
    });
    enemySpriteRight.appendChild(enemySpriteControls);
    const enemySpriteHint = document.createElement('div');
    enemySpriteHint.className = 'enemy-sprite-hint';
    enemySpriteHint.innerHTML = '<div>调整参数后实时预览</div><div>导出 JSON 后复制给我</div>';
    enemySpriteRight.appendChild(enemySpriteHint);
    enemySpriteContent.appendChild(enemySpriteRight);
    enemySpriteTool.appendChild(enemySpriteContent);
    devToolTabContentEnemy.appendChild(enemySpriteTool);
    devToolPanel.appendChild(devToolTabContentEnemy);

    return devToolPanel;
}
