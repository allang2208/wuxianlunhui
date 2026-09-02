
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

    // 子元素: h1.game-title
    const gameTitle = document.createElement('h1');
    gameTitle.className = 'game-title';
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
    versionText.style.cssText = 'margin:4px 0 0;font-size:13px;color:#8a7f6d;letter-spacing:1px;';
    versionText.textContent = 'V' + (GAME_CONFIG.meta?.version || '');
    menuContent.appendChild(versionText);

    // 子元素: div.menu-buttons
    const menuButtons = document.createElement('div');
    menuButtons.className = 'menu-buttons';

    // 子元素: button.menu-btn.start-btn (开始游戏)
    const startGameBtn = document.createElement('button');
    startGameBtn.className = 'menu-btn start-btn';
    startGameBtn.id = 'startGameBtn';
    startGameBtn.textContent = '开始游戏';
    menuButtons.appendChild(startGameBtn);

    // 子元素: button.menu-btn (操作说明)
    const showHelpBtn = document.createElement('button');
    showHelpBtn.className = 'menu-btn';
    showHelpBtn.id = 'showHelpBtn';
    showHelpBtn.textContent = '操作说明';
    menuButtons.appendChild(showHelpBtn);

    menuContent.appendChild(menuButtons);

    // 子元素: div.menu-info
    const menuInfo = document.createElement('div');
    menuInfo.className = 'menu-info';

    // 子元素: p (操作说明文本行1)
    const infoLine1 = document.createElement('p');
    infoLine1.textContent = 'WASD移动 | 鼠标瞄准 | 左键攻击 | 右键特殊攻击';
    menuInfo.appendChild(infoLine1);

    // 子元素: p (操作说明文本行2)
    const infoLine2 = document.createElement('p');
    infoLine2.textContent = 'F切换武器 | R换弹 | 空格闪避 | Shift冲刺';
    menuInfo.appendChild(infoLine2);

    // 子元素: p (操作说明文本行3)
    const infoLine3 = document.createElement('p');
    infoLine3.textContent = '1~4快捷栏 | Q/E/X/C技能 | Z范围拾取 | Tab背包';
    menuInfo.appendChild(infoLine3);

    // 子元素: p (操作说明文本行4)
    const infoLine4 = document.createElement('p');
    infoLine4.textContent = 'CapsLock状态栏 | K技能栏 | L图鉴 | Esc菜单';
    menuInfo.appendChild(infoLine4);

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
