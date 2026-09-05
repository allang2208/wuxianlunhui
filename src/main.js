// ==================== 模块化入口文件 ====================
// 仅保留启动必需的全局挂载，其余模块请使用 ES module 显式导入

import { DataLoader } from './systems/data-loader.js';
import { MovementSystem } from './systems/movement-system.js';
import { WallSystem } from './world/wall-system.js';
import { CombatSystem } from './systems/combat-system.js';
import { PerceptionSystem } from './systems/perception-system.js';
import { EventBus } from './core/event-bus.js';

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
import { FirstExpeditionTutorial, FIRST_EXPEDITION_QUEST_ID } from './quest/first-expedition-tutorial.js';
import {
    FirstPlaneSettlementTutorial,
    FIRST_PLANE_SETTLEMENT_QUEST_ID,
} from './quest/first-plane-settlement-tutorial.js';
import { FirstExpeditionGuide } from './ui/first-expedition-guide.js';
import { QuestStore } from './quest/quest-store.js';
import { GoldManager } from './systems/gold-manager.js';
import { NpcPortraitTool } from './ui/npc-portrait-tool.js';
import { GameUIManager } from './ui/game-ui-manager.js';
import { EnchantSystem } from './ui/enchant-system.js';
import { GameMenu } from './ui/game-menu.js';
import { OpeningCinematic } from './ui/opening-cinematic.js';
import { OpeningDialogue } from './ui/opening-dialogue.js';
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
import { World126WeatherSystem } from './world/world126-weather-system.js';
import { WorldWeatherSystem } from './world/world-weather-system.js';
import { WorldEventTimelineSystem } from './world/world-event-timeline-system.js';
import { WorldSpecialWeatherRegistry } from './world/world-special-weather-registry.js';
import { WorldDestructionChallengeSystem } from './world/world-destruction-challenge-system.js';
import { WorldStrategySystem } from './world/world-strategy-system.js';
import { TroopLineSystem } from './world/troop-line-system.js';
import { TechnologySystem } from './world/technology-system.js';
import { TechnologyTreePanel } from './ui/technology-tree-panel.js';
import { ResearchReportDock } from './ui/research-report-dock.js';

import { getElement } from './utils/dom-utils.js';

const TUTORIAL_SKIP_STARTER_GOLD = 200;
let pendingTutorialSkipMode = null;

WorldEventTimelineSystem.setFrameProvider(() => WorldInvasionSystem.getTimelineFrame());
WorldEventTimelineSystem.registerProvider('invasion', () => WorldInvasionSystem.getTimelineEvents());
WorldEventTimelineSystem.registerProvider('weather', () => WorldWeatherSystem.getForecastEvents());
WorldSpecialWeatherRegistry.registerProvider('sandstorm', World122SandstormSystem);
WorldSpecialWeatherRegistry.registerProvider('drought', World122DroughtSystem);
WorldSpecialWeatherRegistry.registerProvider('fog_tide', World125FogTideSystem);
WorldSpecialWeatherRegistry.registerProvider('mine_weather', World126WeatherSystem);

function syncFirstExpeditionQuest(status) {
    const stage = FirstExpeditionTutorial.syncFromWorldProgression(status);
    if (stage !== 'completed') QuestSystem.selectQuest(FIRST_EXPEDITION_QUEST_ID);
    WorldSwitchPanel.refreshAccessState();
    return stage;
}

function advanceFirstPlaneSettlement(action, { announce = true } = {}) {
    const previousStage = FirstPlaneSettlementTutorial.getStage();
    const result = action?.();
    const nextStage = FirstPlaneSettlementTutorial.getStage();
    if (nextStage !== 'inactive' && nextStage !== 'completed') {
        QuestSystem.selectQuest(FIRST_PLANE_SETTLEMENT_QUEST_ID);
    }
    if (announce && nextStage !== previousStage) {
        const message = FirstPlaneSettlementTutorial.getAnnouncementForStage(nextStage);
        if (message) {
            SceneManager.showTopNotification(message, {
                tone: nextStage === 'completed' ? 'success' : 'info',
                duration: nextStage === 'completed' ? 6000 : 4600,
            });
        }
    }
    return result;
}

EventBus.on('game:new-run-ready', () => {
    const skipMode = pendingTutorialSkipMode;
    pendingTutorialSkipMode = null;
    if (skipMode === 'starter_funds') {
        QuestStore.setQuestCompleted(FIRST_EXPEDITION_QUEST_ID, true);
        QuestStore.setQuestCompleted(FIRST_PLANE_SETTLEMENT_QUEST_ID, true);
        const funded = GoldManager.addGold(TUTORIAL_SKIP_STARTER_GOLD);
        WorldSwitchPanel.refreshAccessState();
        SceneManager.showTopNotification(funded
            ? `已跳过全部教程：启动资金 ${TUTORIAL_SKIP_STARTER_GOLD} 金币已放入背包，可自行购买 F 级钥匙`
            : '已跳过全部教程，但背包没有空位，启动资金未能入包', {
            tone: funded ? 'success' : 'warning',
            duration: 6000,
        });
        return;
    }
    if (skipMode === 'direct_founding') {
        QuestStore.setQuestCompleted(FIRST_EXPEDITION_QUEST_ID, true);
        QuestStore.setQuestCompleted(FIRST_PLANE_SETTLEMENT_QUEST_ID, true);
        const funded = GoldManager.addGold(TUTORIAL_SKIP_STARTER_GOLD);
        const result = WorldProgressionSystem.unlockFirstFoundingForTutorialSkip();
        WorldSwitchPanel.refreshAccessState();
        const fundingText = funded
            ? `启动资金 ${TUTORIAL_SKIP_STARTER_GOLD} 金币已放入背包`
            : `背包没有足够空间，启动资金 ${TUTORIAL_SKIP_STARTER_GOLD} 金币未能完整放入`;
        SceneManager.showTopNotification(result?.ok
            ? `已跳过全部教程：${fundingText}；与小鼠大王交谈，即可直接打开位面航图并选择首城`
            : `${fundingText}；未能开启首城选址：${result?.reason || '位面进度未就绪'}`, {
            tone: result?.ok && funded ? 'success' : 'warning',
            duration: 6500,
        });
        return;
    }
    FirstExpeditionTutorial.startNewRun();
    QuestSystem.selectQuest(FIRST_EXPEDITION_QUEST_ID);
    WorldSwitchPanel.refreshAccessState();
    SceneManager.showTopNotification('新手主线已开启，当前目标会持续显示在小地图右侧。', {
        tone: 'info',
        duration: 4800,
    });
});
EventBus.on('tutorial:first-expedition-altar-opened', () => {
    if (!FirstExpeditionTutorial.markAltarOpened()) return;
    QuestSystem.selectQuest(FIRST_EXPEDITION_QUEST_ID);
    SceneManager.showTopNotification('祭坛已定位：选择“废弃矿洞·初级”并成功通关', { tone: 'info' });
});
EventBus.on('world:first-founding-ready', () => {
    syncFirstExpeditionQuest('awaiting_king');
});
EventBus.on('world:first-founding-completed', () => syncFirstExpeditionQuest('founded'));
EventBus.on('world:first-founding-sync', ({ status } = {}) => syncFirstExpeditionQuest(status));
EventBus.on('world:scene-entered', ({ sceneId } = {}) => {
    const result = advanceFirstPlaneSettlement(
        () => FirstPlaneSettlementTutorial.startForScene(sceneId),
        { announce: false }
    );
    if (!result?.accepted) return;
    const message = FirstPlaneSettlementTutorial.getAnnouncementForStage();
    if (message) SceneManager.showTopNotification(message, { tone: 'info', duration: 5200 });
});
EventBus.on('world:building-placed', (payload) => {
    advanceFirstPlaneSettlement(() => FirstPlaneSettlementTutorial.recordBuildingPlaced(payload));
});
EventBus.on('world:building-workers-changed', (payload) => {
    advanceFirstPlaneSettlement(() => FirstPlaneSettlementTutorial.recordWorkersChanged(payload));
});
EventBus.on('world:energy-ore-gathered', (payload) => {
    advanceFirstPlaneSettlement(() => FirstPlaneSettlementTutorial.recordOreGathered(payload));
});
EventBus.on('technology:changed', (payload) => {
    if (GameUIManager._loadBusy) return;
    advanceFirstPlaneSettlement(() => FirstPlaneSettlementTutorial.recordTechnologyChanged(payload));
});

EventBus.on('world:portal-completed', ({ sceneId, firstConstruction, foundingGift } = {}) => {
    if (!sceneId) return;
    if (foundingGift) return;
    const worldName = WorldProgressionSystem.getWorldConfig(sceneId)?.name || sceneId;
    const completion = firstConstruction ? '传送门建造完成' : '传送门重建完成';
    const event = WorldStrategySystem.recordEngineeringReport({
        sceneId,
        worldName,
        report: { portals: [completion] },
    }, { announce: false });
    const revision = event?.revision;
    SceneManager.showTopNotification(`${worldName}${completion}`, {
        tone: 'success',
        onComplete: () => {
            const current = WorldStrategySystem.state.events.find((entry) => entry.id === event?.id);
            if (current?.revision === revision) WorldStrategySystem.announceEvent(event.id);
        },
    });
});

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
    ResearchReportDock.init();
    FirstExpeditionGuide.init();
    GameMenu.init();
    StartGameChoice.init({
        // 新游戏固定先播纯画面序章，再由小鼠大王完成独立剧情引导，最后进入唯一 Game.start()。
        onNewGame: () => OpeningCinematic.play({
            force: true,
            onComplete: () => OpeningDialogue.play({
                onComplete: ({ tutorialSkipMode } = {}) => {
                    pendingTutorialSkipMode = tutorialSkipMode || null;
                    return Game.start();
                },
            }),
        }),
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
    const settingsBtn = getElement('startSettingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => GameMenu.openSettings(settingsBtn));
    const helpBtn = getElement('showHelpBtn');
    if (helpBtn) helpBtn.addEventListener('click', () => { helpBtn.blur(); GameUIManager.showHelp(); });
    const backBtn = getElement('backMenuBtn');
    if (backBtn) backBtn.addEventListener('click', () => GameMenu.open({ trigger: backBtn }));

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
