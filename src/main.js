// ==================== 模块化入口文件 ====================
// 仅保留启动必需的全局挂载，其余模块请使用 ES module 显式导入

import { DataLoader } from './systems/data-loader.js';
import { MovementSystem } from './systems/movement-system.js';
import { WallSystem } from './world/wall-system.js';
import { CombatSystem } from './systems/combat-system.js';
import { PerceptionSystem } from './systems/perception-system.js';

import { ItemDatabase } from './items/item-database.js';
import { completeWeaponFields } from './ui/equip-data-manager.js';

import { Game } from './game.js';
import { PhaserGame } from './phaser/PhaserGame.js';

import { initUIPanels } from './ui/panels/ui-panels.js';
import { NPCDialogue } from './ui/npc-dialogue.js';
import { QuestSystem } from './ui/quest-system.js';
import { NpcPortraitTool } from './ui/npc-portrait-tool.js';
import { GameUIManager } from './ui/game-ui-manager.js';
import { EnchantSystem } from './ui/enchant-system.js';
import DevTool from './ui/dev-tool.js';

import { getElement } from './utils/dom-utils.js';

async function initModules() {
    const data = await DataLoader.loadAll();
    if (data.equipment) {
        ItemDatabase.load(data.equipment);
    }

    // 启动合并：用 EquipDataManager 全量源补全 ItemDatabase 模板缺失字段
    //（统一走 completeWeaponFields，与 shop-system 商品列表补全共用同一份字段清单与查找逻辑）
    if (ItemDatabase.items) {
        for (const [, item] of Object.entries(ItemDatabase.items)) {
            completeWeaponFields(item);
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
    window.WallSystem = WallSystem; // 调试/控制台排查墙体碰撞用（与 MovementSystem 同口径挂载）
    window.CombatSystem = CombatSystem;
    window.PerceptionSystem = PerceptionSystem;

    window.NPCDialogue = NPCDialogue;
    window.QuestSystem = QuestSystem;
    window.NpcPortraitTool = NpcPortraitTool;
    window.DevTool = DevTool;
    // 调试助手：快速设置技能等级（控制台：await setSkillLevel('lightningStrike', 10)；开发面板「技能」页签同源调用）
    window.setSkillLevel = async (skillId, level) => {
        const player = window.Game && window.Game.player;
        if (!player || !player.skills) return { ok: false, error: '游戏角色未就绪' };
        const sk = player.skills[skillId];
        if (!sk) return { ok: false, error: `技能不存在: ${skillId}` };
        const maxL = sk.maxLevel || 20;
        const L = Math.max(1, Math.min(maxL, Math.floor(Number(level) || 1)));
        sk.level = L;
        sk.exp = 0;
        if (typeof sk.getExpForNext === 'function') sk.maxExp = sk.getExpForNext(L);
        if (L >= maxL) sk.exp = sk.maxExp || 0;
        try {
            const { SkillLevelSystem } = await import('./combat/skill-level-system.js');
            SkillLevelSystem.refreshUI(skillId);
        } catch (_e) { /* 面板刷新失败不影响等级设置 */ }
        return { ok: true, skillId, name: sk.name || skillId, level: L, maxLevel: maxL };
    };

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
    // 附魔系统：注册 EventBus 监听（附魔槽拖回背包/装备栏、卷轴快捷放入）
    EnchantSystem.init();

    if (document.readyState === 'complete') {
        Game.init();
    } else {
        window.onload = () => Game.init();
    }
}

initModules().catch(err => console.error('Module init failed:', err));
