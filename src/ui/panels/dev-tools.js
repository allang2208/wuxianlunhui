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
    collisionDesc.innerHTML = '<p>在主神空间中实时编辑怪物 / NPC 的碰撞体积：</p>'
        + '<p>🟩 绿色矩形（躯干判定）：四角 + 边中八点拖拽调节</p>'
        + '<p>🟧 橙色圆柱体：底部椭圆等比缩放 + 顶部手柄调节高矮</p>'
        + '<p>✥ 在矩形或椭圆内按住拖动：整体平移碰撞体对齐贴图</p>'
        + '<p>调整后即时生效，「保存」直接写入 data/enemy-config.json / data/game-config.json。</p>';
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

    return root;
}
