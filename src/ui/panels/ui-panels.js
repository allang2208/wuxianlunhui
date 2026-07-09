/**
 * UI Panels 主入口
 * 统一导入所有 UI 面板创建函数，提供初始化入口
 */

import { createMenuLayer } from './menu-layer.js';
import { createGameLayer } from './game-layer.js';
import { createHudCore } from './hud-core.js';
import { createHudPanelsSystemTabs } from './hud-panels-system-tabs.js';
import { createHudPanelsNpc } from './hud-panels-npc.js';
import { createHudPanelsShopEnhanceCraftEnchant } from './hud-panels-shop-enhance-craft-enchant.js';
import { createHudPanelsExpeditionQuestReward } from './hud-panels-expedition-quest-reward.js';
import { createHudPanelsMisc } from './hud-panels-misc.js';
import { createDevToolPanel } from './dev-tools.js';

/**
 * 初始化所有 UI 面板
 * @param {HTMLElement} gameContainer - 游戏容器 DOM 元素
 */
export function initUIPanels(gameContainer) {
    // ===== 菜单层 =====
    const menuLayer = createMenuLayer();
    gameContainer.appendChild(menuLayer);

    // ===== 游戏层 =====
    const gameLayer = createGameLayer();
    gameContainer.appendChild(gameLayer);

    // ===== UI 层（HUD）=====
    const uiLayer = document.createElement('div');
    uiLayer.id = 'uiLayer';
    uiLayer.style.cssText = 'display: none; position: absolute; inset: 0; pointer-events: none;';

    // 核心 HUD 元素
    const hudCore = createHudCore();
    while (hudCore.firstChild) {
        uiLayer.appendChild(hudCore.firstChild);
    }

    // 系统面板 + Tab 页
    const systemTabs = createHudPanelsSystemTabs();
    while (systemTabs.firstChild) {
        uiLayer.appendChild(systemTabs.firstChild);
    }

    // NPC 相关
    const npcPanels = createHudPanelsNpc();
    while (npcPanels.firstChild) {
        uiLayer.appendChild(npcPanels.firstChild);
    }

    // 商店/强化/改造/附魔
    const shopPanels = createHudPanelsShopEnhanceCraftEnchant();
    while (shopPanels.firstChild) {
        uiLayer.appendChild(shopPanels.firstChild);
    }

    // 出征/任务/奖励
    const expeditionPanels = createHudPanelsExpeditionQuestReward();
    while (expeditionPanels.firstChild) {
        uiLayer.appendChild(expeditionPanels.firstChild);
    }

    // 杂项面板（侧边菜单、快捷栏、经验条、操作提示等）
    const miscPanels = createHudPanelsMisc();
    while (miscPanels.firstChild) {
        uiLayer.appendChild(miscPanels.firstChild);
    }

    gameContainer.appendChild(uiLayer);

    // ===== 开发工具面板 =====
    const devToolPanel = createDevToolPanel();
    gameContainer.appendChild(devToolPanel);

    return {
        menuLayer,
        gameLayer,
        uiLayer
    };
}

export {
    createMenuLayer,
    createGameLayer,
    createHudCore,
    createHudPanelsSystemTabs,
    createHudPanelsNpc,
    createHudPanelsShopEnhanceCraftEnchant,
    createHudPanelsExpeditionQuestReward,
    createHudPanelsMisc,
    createDevToolPanel
};
