// ==================== 模块化入口文件 ====================
// 仅保留启动必需的全局挂载，其余模块请使用 ES module 显式导入

import { DataLoader } from './systems/data-loader.js';
import { MovementSystem } from './systems/movement-system.js';
import { WallSystem } from './world/wall-system.js';
import { CombatSystem } from './systems/combat-system.js';
import { PerceptionSystem } from './systems/perception-system.js';

import { ItemDatabase } from './items/item-database.js';

import { Game } from './game.js';
import { PhaserGame } from './phaser/PhaserGame.js';
import { Renderer } from './world/renderer.js';
import { EffectManager } from './effects/effect-manager.js';
import { PartySystem } from './systems/party-system.js';
import { SkillManager } from './ui/skill-manager.js';
import { burstParticles } from './effects/combat-fx.js';
import {
    getTributeGoldMultiplier,
    getTributeKillMpHealRatio,
    getTributeKillHpHealRatio,
    getTributeMonsterDamageTakenMul,
    getMoonshadowConfig,
    rollTributeDrop,
    getFriendlyLifestealPercent,
} from './config/tribute-effects.js';
import { configureDamageableRuntime } from './entities/damageable-runtime.js';

import { initUIPanels } from './ui/panels/ui-panels.js';
import { NPCDialogue } from './ui/npc-dialogue.js';
import { QuestSystem } from './ui/quest-system.js';
import { NpcPortraitTool } from './ui/npc-portrait-tool.js';
import { GameUIManager } from './ui/game-ui-manager.js';
import { EnchantSystem } from './ui/enchant-system.js';
import { GameMenu } from './ui/game-menu.js';
import { OpeningCinematic } from './ui/opening-cinematic.js';
import { StartGameChoice } from './ui/start-game-choice.js';
import DevTool from './ui/dev-tool.js';
import { WorldSwitchPanel } from './ui/world-switch-panel.js';
import { WorldSimDriver } from './world/world-sim-driver.js';
import { SceneManager } from './world/scene-manager.js';
import * as World122SnapshotModule from './world/world122-snapshot.js';
import * as World122Sim from './world/world122-sim.js';
import { EnvironmentLightingSystem } from './world/environment-lighting-system.js';
import { WorldProgressionSystem } from './world/world-progression-system.js';
import { WorldInstanceSystem } from './world/world-instance-system.js';
import { WorldInvasionSystem } from './world/world-invasion-system.js';
import { World122SandstormSystem } from './world/world122-sandstorm-system.js';
import { World122DroughtSystem } from './world/world122-drought-system.js';
import { World125FogTideSystem } from './world/world125-fog-tide-system.js';
import { WorldWeatherSystem } from './world/world-weather-system.js';
import { WorldEventTimelineSystem } from './world/world-event-timeline-system.js';
import { WorldSpecialWeatherRegistry } from './world/world-special-weather-registry.js';
import { WorldDestructionChallengeSystem } from './world/world-destruction-challenge-system.js';
import { TroopLineSystem } from './world/troop-line-system.js';
import { TechnologySystem } from './world/technology-system.js';
import { TechnologyTreePanel } from './ui/technology-tree-panel.js';

import { getElement } from './utils/dom-utils.js';

WorldEventTimelineSystem.setFrameProvider(() => WorldInvasionSystem.getTimelineFrame());
WorldEventTimelineSystem.registerProvider('invasion', () => WorldInvasionSystem.getTimelineEvents());
WorldEventTimelineSystem.registerProvider('weather', () => WorldWeatherSystem.getForecastEvents());
WorldSpecialWeatherRegistry.registerProvider('sandstorm', World122SandstormSystem);
WorldSpecialWeatherRegistry.registerProvider('drought', World122DroughtSystem);
WorldSpecialWeatherRegistry.registerProvider('fog_tide', World125FogTideSystem);

// DamageableEntity 是 Combatant/Enemy 的底层基类；高层服务统一由入口注入，
// 防止实体继承链在 ES module 初始化阶段形成 TDZ 循环。
configureDamageableRuntime({
    game: Game,
    renderer: Renderer,
    effectManager: EffectManager,
    partySystem: PartySystem,
    skillManager: SkillManager,
    burstParticles,
    tribute: {
        getTributeGoldMultiplier,
        getTributeKillMpHealRatio,
        getTributeKillHpHealRatio,
        getTributeMonsterDamageTakenMul,
        getMoonshadowConfig,
        rollTributeDrop,
        getFriendlyLifestealPercent,
    },
});

// ===== 全局错误兜底：运行时异常不静默（控制台 + 屏幕小提示，崩溃现场可复现） =====
let _errorToast = null;
function _showErrorToast(text) {
    try {
        if (!_errorToast) {
            _errorToast = document.createElement('div');
            _errorToast.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;z-index:999999;background:rgba(120,30,25,0.92);color:#ffd0c8;font:12px/1.5 monospace;padding:6px 10px;border-radius:6px;pointer-events:none;white-space:pre-wrap;word-break:break-all;';
            document.body.appendChild(_errorToast);
        }
        _errorToast.textContent = `⚠ ${text}`;
        clearTimeout(_errorToast._t);
        _errorToast._t = setTimeout(() => { if (_errorToast) _errorToast.textContent = ''; }, 6000);
    } catch (_e) { /* 兜底本身失败不影响游戏 */ }
}
window.addEventListener('error', (e) => {
    console.error('[GlobalError]', e.message, e.filename, e.lineno);
    _showErrorToast(`${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`);
});
window.addEventListener('unhandledrejection', (e) => {
    const reason = (e && e.reason) ? (e.reason.message || String(e.reason)) : 'Promise rejected';
    console.error('[UnhandledRejection]', e && e.reason);
    _showErrorToast(`Promise: ${reason}`);
});

async function initModules() {
    const data = await DataLoader.loadAll();
    if (data.equipment) {
        ItemDatabase.load(data.equipment);
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
    TechnologyTreePanel.init();
    GameMenu.init();
    StartGameChoice.init({
        // “新游戏”是显式重开入口，始终播放序章；观看标记仅供未来自动进入/继续游戏使用。
        onNewGame: () => OpeningCinematic.play({ force: true, onComplete: () => Game.start() }),
    });
    // 世界切换面板（多世界并行 M1）：侧边菜单按钮由 hud-panels-misc 静态构建，这里仅挂全局
    window.WorldSwitchPanel = WorldSwitchPanel;
    // 后台世界模拟驱动（M3）：1Hz 只推进全局科研，位面按事件/读取/保存/入场结算。
    WorldSimDriver.init();
    window.WorldSimDriver = WorldSimDriver;
    // 快照/后台结算模块挂载（探针与控制台调试同口径，避免资源表 URL 逐出导致模块双实例）
    window.World122Snapshot = World122SnapshotModule;
    window.World122Sim = World122Sim;
    window.WorldProgressionSystem = WorldProgressionSystem;
    window.WorldInstanceSystem = WorldInstanceSystem;
    window.WorldInvasionSystem = WorldInvasionSystem;
    window.World122SandstormSystem = World122SandstormSystem;
    window.World122DroughtSystem = World122DroughtSystem;
    window.World125FogTideSystem = World125FogTideSystem;
    window.WorldWeatherSystem = WorldWeatherSystem;
    window.WorldEventTimelineSystem = WorldEventTimelineSystem;
    window.WorldDestructionChallengeSystem = WorldDestructionChallengeSystem;
    window.TroopLineSystem = TroopLineSystem;
    window.TechnologySystem = TechnologySystem;
    window.TechnologyTreePanel = TechnologyTreePanel;
    window.SceneManager = SceneManager;
    // 环境光照唯一实例挂载（HMR 后裸路径 import 会拿到第二实例，探针必须走这里）
    window.EnvironmentLightingSystem = EnvironmentLightingSystem;
    // 游戏入口与 Phaser 迁移系统
    window.Game = Game;
    window.PhaserGame = PhaserGame;

    // 绑定按钮事件
    const helpBtn = getElement('showHelpBtn');
    if (helpBtn) helpBtn.addEventListener('click', () => { helpBtn.blur(); GameUIManager.showHelp(); });
    const backBtn = getElement('backMenuBtn');
    if (backBtn) backBtn.addEventListener('click', () => { backBtn.blur(); GameMenu.open(); });

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
