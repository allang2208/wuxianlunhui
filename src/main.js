// ==================== 模块化入口文件 ====================
// 仅保留启动必需的全局挂载，其余模块请使用 ES module 显式导入

import { DataLoader } from './systems/data-loader.js';
import { MovementSystem } from './systems/movement-system.js';
import { CombatSystem } from './systems/combat-system.js';
import { PerceptionSystem } from './systems/perception-system.js';

import { ItemDatabase } from './items/item-database.js';
import { EquipDataManager } from './ui/equip-data-manager.js';

import { Game } from './game.js';
import { PhaserGame } from './phaser/PhaserGame.js';

import { initUIPanels } from './ui/panels/ui-panels.js';
import { NPCDialogue } from './ui/npc-dialogue.js';
import { QuestSystem } from './ui/quest-system.js';
import { NpcPortraitTool } from './ui/npc-portrait-tool.js';
import { GameUIManager } from './ui/game-ui-manager.js';
import DevTool from './ui/dev-tool.js';

import { getElement } from './utils/dom-utils.js';

async function initModules() {
    const data = await DataLoader.loadAll();
    if (data.equipment) {
        ItemDatabase.load(data.equipment);
    }

    if (EquipDataManager && ItemDatabase.items) {
        const equipConfigs = Object.values(EquipDataManager).filter(v => v && typeof v === 'object' && v.weaponId);
        for (const [, item] of Object.entries(ItemDatabase.items)) {
            const match = equipConfigs.find(cfg => cfg.weaponId === item.weaponId || cfg.name === item.name);
            if (match) {
                const fieldsToMerge = [
                    'attackFormula', 'ammoConfig', 'spreadParams', 'heatParams',
                    'energyLMGParams', 'fireMode', 'animConfigKey', 'attackKey',
                    'offhandAttackKey', 'canvasImageProp', 'specialAttackType',
                    'sound', 'pelletCount', 'equipSound', 'renderParams', 'fireSound',
                    'isDarkGold', 'dropImage', 'equipImage', 'slotImage'
                ];
                for (const field of fieldsToMerge) {
                    if (match[field] !== undefined && item[field] === undefined) {
                        item[field] = match[field];
                    }
                }
            }
        }
    }

    if (data.skills) {
        window.SKILL_DATA = data.skills;
    }
    if (data.enemies) {
        window.ENEMY_DATA = data.enemies;
    }

    // 仍需要全局暴露的模块（DOM inline onclick / 外部系统检测 / 控制台调试）
    window.MovementSystem = MovementSystem;
    window.CombatSystem = CombatSystem;
    window.PerceptionSystem = PerceptionSystem;

    window.NPCDialogue = NPCDialogue;
    window.QuestSystem = QuestSystem;
    window.NpcPortraitTool = NpcPortraitTool;
    window.DevTool = DevTool;

    // 初始化 UI 面板（动态创建 DOM）
    const gameContainer = getElement('gameContainer');
    if (gameContainer) {
        initUIPanels(gameContainer);
    }

    // 游戏入口与 Phaser 迁移系统
    window.Game = Game;
    window.PhaserGame = PhaserGame;

    // 绑定按钮事件
    const startBtn = getElement('startGameBtn');
    if (startBtn) startBtn.addEventListener('click', () => { startBtn.blur(); Game.start(); });
    const helpBtn = getElement('showHelpBtn');
    if (helpBtn) helpBtn.addEventListener('click', () => { helpBtn.blur(); GameUIManager.showHelp(); });
    const backBtn = getElement('backMenuBtn');
    if (backBtn) backBtn.addEventListener('click', () => { backBtn.blur(); GameUIManager.toMenu(); });

    DevTool.init();
    NpcPortraitTool.init();

    if (document.readyState === 'complete') {
        Game.init();
    } else {
        window.onload = () => Game.init();
    }
}

initModules().catch(err => console.error('Module init failed:', err));
