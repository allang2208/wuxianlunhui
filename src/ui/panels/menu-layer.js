
/**
 * 菜单层面板 - 动态创建模块
 * 对应 index.html 中的 menu-layer 部分
 */
import { GAME_CONFIG } from '../../config/game-config.js';

export function createMenuLayer() {
    // 根元素: menuLayer
    const menuLayer = document.createElement('div');
    menuLayer.id = 'menuLayer';
    menuLayer.className = 'menu-layer';

    // 子元素: menu-bg
    const menuBg = document.createElement('div');
    menuBg.className = 'menu-bg';
    menuLayer.appendChild(menuBg);

    // 子元素: menu-content
    const menuContent = document.createElement('div');
    menuContent.className = 'menu-content';
    menuContent.setAttribute('role', 'region');
    menuContent.setAttribute('aria-labelledby', 'startMenuTitle');

    // 子元素: h1.game-title
    const gameTitle = document.createElement('h1');
    gameTitle.className = 'game-title';
    gameTitle.id = 'startMenuTitle';
    gameTitle.textContent = '无限轮回';
    menuContent.appendChild(gameTitle);

    // 子元素: p.game-subtitle
    const gameSubtitle = document.createElement('p');
    gameSubtitle.className = 'game-subtitle';
    gameSubtitle.textContent = '俯视角动作RPG';
    menuContent.appendChild(gameSubtitle);

    // 版本号（仅进入游戏界面展示；全局右上角 badge 已删除——meta.version 长期未递增已过时）
    const versionText = document.createElement('p');
    versionText.className = 'game-version';
    versionText.textContent = 'V' + (GAME_CONFIG.meta?.version || '');
    menuContent.appendChild(versionText);

    // 子元素: div.menu-buttons
    const menuButtons = document.createElement('div');
    menuButtons.className = 'menu-buttons';
    menuButtons.setAttribute('role', 'group');
    menuButtons.setAttribute('aria-label', '主菜单操作');

    // 子元素: button.menu-btn.start-btn (开始游戏)
    const startGameBtn = document.createElement('button');
    startGameBtn.type = 'button';
    startGameBtn.className = 'menu-btn start-btn';
    startGameBtn.id = 'startGameBtn';
    startGameBtn.textContent = '开始游戏';
    menuButtons.appendChild(startGameBtn);

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'menu-btn settings-btn';
    settingsBtn.id = 'startSettingsBtn';
    settingsBtn.textContent = '设置';
    settingsBtn.setAttribute('aria-haspopup', 'dialog');
    settingsBtn.setAttribute('aria-controls', 'gameMenuOverlay');
    menuButtons.appendChild(settingsBtn);

    const secondaryActions = document.createElement('div');
    secondaryActions.className = 'menu-secondary-actions';

    // 子元素: button.menu-btn (操作说明)
    const showHelpBtn = document.createElement('button');
    showHelpBtn.type = 'button';
    showHelpBtn.className = 'menu-btn';
    showHelpBtn.id = 'showHelpBtn';
    showHelpBtn.textContent = '操作说明';
    secondaryActions.appendChild(showHelpBtn);

    const exitGameBtn = document.createElement('button');
    exitGameBtn.type = 'button';
    exitGameBtn.className = 'menu-btn exit-btn';
    exitGameBtn.id = 'exitGameBtn';
    exitGameBtn.textContent = '退出游戏';
    secondaryActions.appendChild(exitGameBtn);
    menuButtons.appendChild(secondaryActions);

    menuContent.appendChild(menuButtons);

    const menuStatus = document.createElement('p');
    menuStatus.id = 'startMenuStatus';
    menuStatus.className = 'menu-status';
    menuStatus.setAttribute('role', 'status');
    menuStatus.setAttribute('aria-live', 'polite');
    menuContent.appendChild(menuStatus);
    exitGameBtn.addEventListener('click', () => {
        if (exitGameBtn.disabled) return;
        menuStatus.removeAttribute('data-tone');
        try {
            if (typeof window.electronAPI?.exitApp === 'function') {
                exitGameBtn.disabled = true;
                exitGameBtn.setAttribute('aria-busy', 'true');
                exitGameBtn.textContent = '正在退出…';
                menuStatus.textContent = '正在关闭游戏窗口…';
                // 复用 preload 的 exit-app IPC，不改发布目录、存档或其他应用。
                window.electronAPI.exitApp();
            } else {
                // 浏览器可能拒绝关闭手动打开的标签页，保留菜单并提供可执行提示。
                menuStatus.textContent = '若页面未自动关闭，请手动关闭当前浏览器标签页。';
                window.close();
            }
        } catch (error) {
            exitGameBtn.disabled = false;
            exitGameBtn.removeAttribute('aria-busy');
            exitGameBtn.textContent = '退出游戏';
            menuStatus.dataset.tone = 'danger';
            menuStatus.textContent = '退出未完成，请重试或手动关闭游戏窗口。';
            console.error('开始面板退出游戏失败:', error);
        }
    });

    // 子元素: div.menu-info
    const menuInfo = document.createElement('div');
    menuInfo.className = 'menu-info';

    // 新手流程在真实场景中逐步教学；首页只保留入口说明，避免一次灌入整张键位表。
    const infoLine1 = document.createElement('p');
    infoLine1.textContent = '基础操作会在实际游玩中逐步提示。';
    menuInfo.appendChild(infoLine1);

    const infoLine2 = document.createElement('p');
    infoLine2.textContent = '完整键位可随时从“操作说明”查看。';
    menuInfo.appendChild(infoLine2);

    menuContent.appendChild(menuInfo);

    menuLayer.appendChild(menuContent);

    // “开始游戏”只打开入口选择；新游戏仍回到 Game.start() 唯一启动链。
    const startChoice = document.createElement('div');
    startChoice.id = 'startGameChoice';
    startChoice.className = 'start-game-choice';
    startChoice.hidden = true;
    startChoice.setAttribute('aria-hidden', 'true');

    const choicePanel = document.createElement('section');
    choicePanel.className = 'start-game-choice-panel';
    choicePanel.setAttribute('role', 'dialog');
    choicePanel.setAttribute('aria-modal', 'true');
    choicePanel.setAttribute('aria-labelledby', 'startGameChoiceTitle');
    choicePanel.setAttribute('aria-describedby', 'startGameChoiceDescription');
    choicePanel.tabIndex = -1;

    const choiceEyebrow = document.createElement('p');
    choiceEyebrow.className = 'start-game-choice-eyebrow';
    choiceEyebrow.textContent = '轮回档案 // 启动协议';

    const choiceTitle = document.createElement('h2');
    choiceTitle.id = 'startGameChoiceTitle';
    choiceTitle.textContent = '选择进入方式';

    const choiceDescription = document.createElement('p');
    choiceDescription.id = 'startGameChoiceDescription';
    choiceDescription.className = 'start-game-choice-description';
    choiceDescription.textContent = '建立新的轮回，或从既有档案继续。';

    const choiceActions = document.createElement('div');
    choiceActions.className = 'start-game-choice-actions';

    const newGameBtn = document.createElement('button');
    newGameBtn.type = 'button';
    newGameBtn.id = 'newGameChoiceBtn';
    newGameBtn.className = 'menu-btn start-game-choice-primary';
    newGameBtn.textContent = '新游戏';

    const loadGameBtn = document.createElement('button');
    loadGameBtn.type = 'button';
    loadGameBtn.id = 'loadGameChoiceBtn';
    loadGameBtn.className = 'menu-btn load-btn';
    loadGameBtn.disabled = true;
    loadGameBtn.setAttribute('aria-label', '读取游戏，暂未开放');
    loadGameBtn.setAttribute('aria-describedby', 'startGameChoiceLoadHint');
    const loadLabel = document.createElement('span');
    loadLabel.textContent = '读取游戏';
    const loadHint = document.createElement('span');
    loadHint.id = 'startGameChoiceLoadHint';
    loadHint.className = 'menu-btn-caption';
    loadHint.textContent = '存档系统将在后续版本开放';
    loadGameBtn.append(loadLabel, loadHint);

    const closeChoiceBtn = document.createElement('button');
    closeChoiceBtn.type = 'button';
    closeChoiceBtn.id = 'closeStartGameChoiceBtn';
    closeChoiceBtn.className = 'menu-btn start-game-choice-back';
    closeChoiceBtn.textContent = '返回主界面';

    choiceActions.append(newGameBtn, loadGameBtn, closeChoiceBtn);
    choicePanel.append(choiceEyebrow, choiceTitle, choiceDescription, choiceActions);
    startChoice.appendChild(choicePanel);
    menuLayer.appendChild(startChoice);

    return menuLayer;
}
