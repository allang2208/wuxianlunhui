import DevTool from '../dev-tool.js';
import { CollisionEditor } from '../collision-editor.js';
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
    tabWeapon.addEventListener('click', () => DevTool.switchTab('weapon'));
    tabWeapon.textContent = '武器';
    tabs.appendChild(tabWeapon);

    const tabCollision = document.createElement('div');
    tabCollision.className = 'dev-tool-tab';
    tabCollision.dataset.tab = 'collision';
    tabCollision.addEventListener('click', () => DevTool.switchTab('collision'));
    tabCollision.textContent = '碰撞';
    tabs.appendChild(tabCollision);

    const tabSkill = document.createElement('div');
    tabSkill.className = 'dev-tool-tab';
    tabSkill.dataset.tab = 'skill';
    tabSkill.addEventListener('click', () => {
        DevTool.switchTab('skill');
        fillSkillSelect();
    });
    tabSkill.textContent = '技能';
    tabs.appendChild(tabSkill);

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
        ['attack2', '二段攻击'],
        ['dash', '冲刺攻击'],
        ['recover', '收势'],
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
    // 播放帧率（留空=动画配置 frameRate；DevTool._getPreviewFps 读取）
    const fpsInput = document.createElement('input');
    fpsInput.type = 'number';
    fpsInput.id = 'devToolFps';
    fpsInput.min = '1';
    fpsInput.max = '60';
    fpsInput.step = '1';
    fpsInput.placeholder = 'fps';
    fpsInput.title = '播放帧率（留空=动画配置帧率）';
    fpsInput.style.width = '48px';
    menuItemFrame.appendChild(fpsInput);
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
        { label: '模糊X:', id: 'devToolBlurX', value: '0', step: '0.5' },
        { label: '模糊Y:', id: 'devToolBlurY', value: '0', step: '0.5' },
        { label: '拉伸X:', id: 'devToolStrX', value: '1', step: '0.01' },
        { label: '拉伸Y:', id: 'devToolStrY', value: '1', step: '0.01' },
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

    // 📍 固定点工具按钮（dev-tool.js 绑定事件）：武器贴图校准标记点，跨帧跟随
    const markerRow = document.createElement('div');
    markerRow.className = 'dev-tool-control-row';
    const markerBtn = document.createElement('button');
    markerBtn.id = 'devToolMarker';
    markerBtn.className = 'dev-tool-menu-btn';
    markerBtn.style.width = '100%';
    markerBtn.title = '在武器贴图上放置校准标记点，所有帧同步显示';
    markerBtn.textContent = '📍 固定点';
    markerRow.appendChild(markerBtn);
    controls.appendChild(markerRow);

    right.appendChild(controls);

    const modeHint = document.createElement('div');
    modeHint.className = 'dev-tool-mode-hint';
    modeHint.id = 'devToolModeHint';
    modeHint.innerHTML = '<div>🖱 左键拖动</div><div>🔄 滚轮缩放</div><div>按 <kbd>R</kbd> 切换旋转/缩放模式</div>';
    right.appendChild(modeHint);

    const dataOutput = document.createElement('div');
    dataOutput.className = 'dev-tool-data-output';
    dataOutput.id = 'devToolDataOutput';
    dataOutput.style.cssText = 'display:none;';
    right.appendChild(dataOutput);

    content.appendChild(right);
    contentWeapon.appendChild(content);
    root.appendChild(contentWeapon);

    // ===== Tab 内容：碰撞体积编辑 =====
    const contentCollision = document.createElement('div');
    contentCollision.className = 'dev-tool-tab-content';
    contentCollision.dataset.tabContent = 'collision';
    contentCollision.style.cssText = 'display:none;';

    const collisionWrap = document.createElement('div');
    collisionWrap.className = 'collision-tab-wrap';

    const collisionDesc = document.createElement('div');
    collisionDesc.className = 'collision-tab-desc';
    collisionDesc.innerHTML = '<p>在主神空间中实时编辑碰撞判定：</p>'
        + '<p>🟩 怪物/NPC：矩形八点拖拽 + 圆柱半径/高矮 + 整体平移</p>'
        + '<p>🧱 墙：拖 face 线段两端点改跨度，橙点调碰撞厚度（按类型生效）</p>'
        + '<p>🚪 门：打开/关闭两状态分别调整；打开态拖金色门洞边缘调通行宽度</p>'
        + '<p>🛢 障碍物：footprint 矩形八点拖拽；🪤 陷阱：触发半径圈 + 数量/伤害/冷却</p>'
        + '<p>调整后即时生效，「保存」写入 data/enemy-config.json / game-config.json / wall-geo-overrides.json / dungeon-config.json。</p>';
    collisionWrap.appendChild(collisionDesc);

    const collisionOpenBtn = document.createElement('button');
    collisionOpenBtn.className = 'dev-tool-menu-btn collision-open-btn';
    collisionOpenBtn.textContent = '🎯 打开碰撞体积编辑器';
    // 编辑器需要看到游戏画面：先收起本面板，再打开浮动编辑器（参照坐标工具的做法）
    collisionOpenBtn.addEventListener('click', () => {
        DevTool.hide();
        CollisionEditor.open();
    });
    collisionWrap.appendChild(collisionOpenBtn);

    contentCollision.appendChild(collisionWrap);
    root.appendChild(contentCollision);

    // ===== Tab 内容：技能等级调试 =====
    const contentSkill = document.createElement('div');
    contentSkill.className = 'dev-tool-tab-content';
    contentSkill.dataset.tabContent = 'skill';
    contentSkill.style.cssText = 'display:none;';

    const skillWrap = document.createElement('div');
    skillWrap.className = 'collision-tab-wrap';

    const skillDesc = document.createElement('div');
    skillDesc.className = 'collision-tab-desc';
    skillDesc.innerHTML = '<p>⚡ 快速调整技能等级（测试用，改后立即生效）：</p>';
    skillWrap.appendChild(skillDesc);

    const skillRow = document.createElement('div');
    skillRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px 0;';

    const skillSelect = document.createElement('select');
    skillSelect.id = 'devToolSkillSelect';
    skillSelect.style.cssText = 'width:100%;padding:4px;background:#1c1c1c;color:#d4c5a9;border:1px solid #3a3a3a;';
    skillRow.appendChild(skillSelect);

    const levelRow = document.createElement('div');
    levelRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const levelLabel = document.createElement('span');
    levelLabel.textContent = '等级:';
    levelLabel.style.cssText = 'color:#d4c5a9;font-size:13px;';
    const levelInput = document.createElement('input');
    levelInput.type = 'number';
    levelInput.id = 'devToolSkillLevel';
    levelInput.min = '1';
    levelInput.max = '20';
    levelInput.value = '1';
    levelInput.style.cssText = 'width:56px;padding:4px;background:#1c1c1c;color:#d4c5a9;border:1px solid #3a3a3a;';
    const btnMinus = document.createElement('button');
    btnMinus.className = 'dev-tool-menu-btn';
    btnMinus.textContent = '−';
    const btnPlus = document.createElement('button');
    btnPlus.className = 'dev-tool-menu-btn';
    btnPlus.textContent = '+';
    const btnApply = document.createElement('button');
    btnApply.className = 'dev-tool-menu-btn';
    btnApply.textContent = '✓ 应用';
    btnApply.style.cssText = 'margin-left:auto;';
    levelRow.append(levelLabel, levelInput, btnMinus, btnPlus, btnApply);
    skillRow.appendChild(levelRow);

    const skillStatus = document.createElement('div');
    skillStatus.id = 'devToolSkillStatus';
    skillStatus.style.cssText = 'color:#b8d8ff;font-size:12px;min-height:16px;';
    skillRow.appendChild(skillStatus);

    skillWrap.appendChild(skillRow);
    contentSkill.appendChild(skillWrap);
    root.appendChild(contentSkill);

    // ===== 技能等级调试逻辑 =====
    const fillSkillSelect = () => {
        const player = window.Game && window.Game.player;
        const sel = document.getElementById('devToolSkillSelect');
        if (!sel || !player || !player.skills) return;
        const current = sel.value;
        sel.innerHTML = '';
        for (const [id, sk] of Object.entries(player.skills)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = `${sk.name || id}（Lv.${sk.level}/${sk.maxLevel || 20}）`;
            sel.appendChild(opt);
        }
        if (current && player.skills[current]) sel.value = current;
        updateSkillStatus();
    };
    const updateSkillStatus = () => {
        const player = window.Game && window.Game.player;
        const sel = document.getElementById('devToolSkillSelect');
        const status = document.getElementById('devToolSkillStatus');
        const input = document.getElementById('devToolSkillLevel');
        if (!player || !sel || !status || !input) return;
        const sk = player.skills[sel.value];
        if (!sk) { status.textContent = ''; return; }
        input.max = sk.maxLevel || 20;
        input.value = sk.level;
        status.textContent = sk.level >= (sk.maxLevel || 20)
            ? `${sk.name}：已满级`
            : `${sk.name}：当前 Lv.${sk.level}，升级需 ${sk.maxExp - sk.exp} 经验`;
    };
    const applySkillLevel = (delta) => {
        const player = window.Game && window.Game.player;
        const sel = document.getElementById('devToolSkillSelect');
        const input = document.getElementById('devToolSkillLevel');
        if (!player || !sel || !input || !player.skills[sel.value]) {
            if (DevTool && typeof DevTool._showToast === 'function') DevTool._showToast('❌ 请先进入游戏');
            return;
        }
        const target = delta ? Number(player.skills[sel.value].level) + delta : Number(input.value || 1);
        const result = typeof window.setSkillLevel === 'function'
            ? window.setSkillLevel(sel.value, target)
            : Promise.resolve({ ok: false, error: 'setSkillLevel 未挂载' });
        Promise.resolve(result).then(r => {
            if (r && r.ok) {
                updateSkillStatus();
                fillSkillSelect();
                if (DevTool && typeof DevTool._showToast === 'function') DevTool._showToast(`✅ ${r.name} → Lv.${r.level}`);
            } else if (DevTool && typeof DevTool._showToast === 'function') {
                DevTool._showToast(`❌ ${(r && r.error) || '设置失败'}`);
            }
        });
    };
    btnPlus.addEventListener('click', () => applySkillLevel(1));
    btnMinus.addEventListener('click', () => applySkillLevel(-1));
    btnApply.addEventListener('click', () => applySkillLevel(0));

    return root;
}
