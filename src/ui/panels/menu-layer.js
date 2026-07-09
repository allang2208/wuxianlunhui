/**
 * 菜单层面板 - 动态创建模块
 * 对应 index.html 中的 menu-layer 部分
 */
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

    return menuLayer;
}
