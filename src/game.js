import { PhaserGame } from './phaser/PhaserGame.js';
import { Portal } from './world/portal.js';
import { EventBus } from './core/event-bus.js';
import { SoundManager } from './ui/sound-manager.js';
import { ItemFactory } from './items/item-factory.js';
import { Renderer } from './world/renderer.js';
import { SceneManager } from './world/scene-manager.js';
import { Camera } from './world/camera.js';
import { Input } from './ui/input.js';
import { StatusBar } from './ui/status-bar.js';
import { FloatingTextEffect } from './effects/floating-text.js';
import { LevelUpEffectQueue } from './effects/level-up-queue.js';
import { SweepEffect } from './effects/sweep-effect.js';
import { WallSystem } from './world/wall-system.js';
import { PERSPECTIVE_SCALE_Y } from './config/perspective-config.js';
import { NPCDialogue } from './ui/npc-dialogue.js';
import { BackpackDialogManager } from './ui/backpack-dialog-manager.js';
import { EquipDataManager } from './ui/equip-data-manager.js';
import { GameUIManager } from './ui/game-ui-manager.js';
import { EnchantScrollItems, MagicDustItem } from './config/enchant-config.js';
import { EnhancementItems } from './ui/reward-system.js';
import { SynergySystem, DEFAULT_SYNERGY_RULES } from './ai/synergy-system.js';
import { BattleCommander } from './ai/battle-commander.js';
import { Enemy } from './entities/enemy.js';
import SpatialPartitionSystem from './systems/spatial-partition-system.js';
import FormationSystem from './systems/formation-system.js';
import { TacticalSquadRoleSwitch } from './systems/tactical-squad-role-switch.js';
import { DungeonMapSystem } from './world/dungeon-map-system.js';
import { GAME_CONFIG } from './config/game-config.js';
import { EffectManager } from './effects/effect-manager.js';
import { getElement } from './utils/dom-utils.js';
import { TacticalSquadAI } from './ai/tactical-squad-ai.js';
import { PerceptionSystem } from './systems/perception-system.js';
import { MovementSystem } from './systems/movement-system.js';
import { CombatSystem } from './systems/combat-system.js';
import { CONFIG } from './config/config.js';
import { TargetDummy } from './entities/target-dummy.js';
import { Player } from './entities/player.js';
import { BlackWolf, ZombieDogEnemy } from './entities/enemy-types.js';
import { ZombieWizard } from './entities/enemy-types/zombie-wizard.js';
import { Mutant3 } from './entities/enemy-types/mutant-3.js';
import { SpitterZombie } from './entities/enemy-types/spitter-zombie.js';
import { FatZombie } from './entities/enemy-types/fat-zombie.js';
import { Zombie } from './entities/enemy-types/zombie.js';
import { AmalgamZombie } from './entities/enemy-types/amalgam-zombie.js';
import { ArmoredKnight } from './entities/enemy-types/armored-knight.js';
import { Shounao } from './entities/enemy-types/shounao.js';
import { FlySwarm } from './entities/enemy-types/fly-swarm.js';
import { FlyHand } from './entities/enemy-types/fly-hand.js';
import { TimeAgentAssault } from './entities/enemy-types/time-agent-assault.js';
import { TimeAgentShield } from './entities/enemy-types/time-agent-shield.js';
import { WarehouseSystem } from './ui/warehouse-system.js';
import { hasOreUpgrade, applyOreUpgradeOnPickup } from './config/tribute-effects.js';
import enemyConfigData from '../data/enemy-config.json';
import { DropItem } from './entities/drop-item.js';
import { NPC } from './entities/npc.js';
import { ShopSystem } from './ui/shop-system.js';
import { EnhanceSystem } from './ui/enhance-system.js';
import { QuestState, QuestTracker } from './ui/quest-system.js';
import { RiftSystem } from './quest/rift-system.js';
import { QuickBar } from './ui/quick-bar.js';
import { EquipManager } from './ui/equip-manager.js';
import { CodexManager } from './ui/codex-manager.js';
import { SystemUI } from './ui/system-ui.js';
import { UIState } from './ui/ui-state.js';
import { ExpeditionSystem } from './ui/expedition-system.js';
import { FusionSystem } from './ui/fusion-system.js';

export const Game = {
    VERSION: GAME_CONFIG.meta?.version || '0.198', // 游戏版本号（每次更新必须递增）
    isRunning: false, _paused: false, lastTime: 0, fps: 0, frameCount: 0, fpsTimer: 0, player: null, entities: new Map(), _pickupNearbyFlag: false,
    _synergySystem: null,
    _battleCommander: null, // 指挥AI实例
    _tacticalSquadAI: null, // 战术小队AI实例
    showAttackRange: false, // 攻击范围显示开关
    _npcDialoguePaused: false,
    _gameStartTime: null, // 游戏开始时间戳
    // _timerInterval 已弃用：由 GameUIManager 统一管理秒表定时器
    _portalCooldown: 0, // 传送门冷却时间戳
    init() {
        if (!SoundManager || !Input || !Renderer || !SystemUI || !QuickBar || !GameUIManager) {
            console.error('[Game.init] 核心模块未加载，无法初始化');
            return;
        }
        SoundManager.init(); Input.init(); Renderer.init(); SystemUI.init(); QuickBar.init();
        GameUIManager.init(this.player); GameUIManager.initAttackRangeToggle();
        if (QuestTracker) QuestTracker.init();
    },
    async start() {
        try {
            // 自动同步版本号到页面
            const versionBadge = getElement('versionBadge');
            if (versionBadge) versionBadge.textContent = 'V' + this.VERSION;
            // 防止重复启动：游戏已在运行时直接返回
            if (this.isRunning) {
                return;
            }
            const menuLayer = getElement('menuLayer'); const uiLayer = getElement('uiLayer'); const gameLayer = getElement('gameLayer'); if (menuLayer) menuLayer.classList.add('hidden'); if (uiLayer) uiLayer.style.display = 'block'; if (gameLayer) gameLayer.style.display = 'block';
            Renderer.generateWorld();
            // 初始化 Phaser 渲染系统（渐进式迁移）
            if (PhaserGame && !PhaserGame.isReady) {
                PhaserGame.init();
            }
            await this.spawnPlayer();
            this.spawnTargets(); this.spawnEnemy(); this.spawnTestTargets(); this.spawnNPC();
            GameUIManager.startTimer();
            // 在主角右边地上生成G18和SAIGA-12K（额外保留）
            // 使用主神空间固定原点，不随分辨率变化
            const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
                GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
            );
            const lootCfg = GAME_CONFIG.loot?.drops?.mainHub || {};
            const g18 = lootCfg.g18 || { x: 120, y: 0 };
            const saiga12k = lootCfg.saiga12k || { x: 160, y: 0 };
            this.dropItem(origin.x + g18.x, origin.y + g18.y, EquipDataManager.G18_PISTOL_ITEM);
            this.dropItem(origin.x + saiga12k.x, origin.y + saiga12k.y, EquipDataManager.SAIGA12K_ITEM);
            // 在主神空间横向生成所有武器
            this.spawnAllWeapons();
            // 在出生点附近生成所有附魔卷轴（供测试拾取）
            const scrollCfg = lootCfg.scrollBase || { x: 200, y: 0, spacing: 40 };
            const scrollBaseX = origin.x + scrollCfg.x;
            const scrollBaseY = origin.y + scrollCfg.y;
            this.dropItem(scrollBaseX, scrollBaseY, EnchantScrollItems.enchant_scroll_heavy);
            this.dropItem(scrollBaseX + scrollCfg.spacing, scrollBaseY, EnchantScrollItems.enchant_scroll_sharp);
            this.dropItem(scrollBaseX + scrollCfg.spacing * 2, scrollBaseY, EnchantScrollItems.enchant_scroll_tarantula);
            this.dropItem(scrollBaseX + scrollCfg.spacing * 3, scrollBaseY, EnchantScrollItems.enchant_scroll_skeleton);
            // 生成一些魔法晶尘（供测试）
            const magicDusts = lootCfg.magicDust || [{ x: 200, y: 40 }, { x: 240, y: 40, stack: 999 }];
            for (const md of magicDusts) {
                const item = md.stack ? { ...MagicDustItem, stack: md.stack } : MagicDustItem;
                this.dropItem(origin.x + md.x, origin.y + md.y, item);
            }
            // 生成强化石和改造券（各10份，供测试）
            const matCfg = lootCfg.materials || { baseX: 280, baseY: 40, spacingX: 30, spacingY: 40, count: 10 };
            for (let i = 0; i < matCfg.count; i++) {
                this.dropItem(origin.x + matCfg.baseX + i * matCfg.spacingX, origin.y + matCfg.baseY, { ...EnhancementItems.enhance_stone });
                this.dropItem(origin.x + matCfg.baseX + i * matCfg.spacingX, origin.y + matCfg.baseY + matCfg.spacingY, { ...EnhancementItems.modify_ticket });
            }
            // EventBus 解耦：订阅 Player 的拾取事件（使用具名回调以便 toMenu 中取消订阅）
            this._onPickup = this._onPickup || ((px, py, range) => this.tryPickupItem(px, py, range));
            EventBus.off('player:pickup', this._onPickup); EventBus.on('player:pickup', this._onPickup);
            GameUIManager.setupWeaponSwitchButtons();
            // 生成测试区域参考特效
            const testAreaCfg = GAME_CONFIG.effects?.testArea || { x: 3478, y: 2363, width: 100, height: 100, thickness: 10, duration: 5000, label: '测试区域', labelColor: '#000000' };
            EffectManager.add(new SweepEffect(testAreaCfg.x, testAreaCfg.y, testAreaCfg.width, testAreaCfg.height, testAreaCfg.thickness, testAreaCfg.duration));
            EffectManager.add(new FloatingTextEffect(testAreaCfg.x, testAreaCfg.y - 20, testAreaCfg.label, testAreaCfg.labelColor));
            // 初始化场景管理器
            SceneManager.init();
            SceneManager.currentScene = 'main'; // 游戏开始时当前场景为主场景
            SceneManager._inMainHub = true;
            SceneManager._mainHubInvincible = true;
            // 主神空间保留铠甲骑士、手脑用于测试（其余测试怪已清除，spawn 方法保留备用）
            this.spawnMainHubTestEntities();
            // 仓库测试种子：矿石类祭品每样一件（贴图/效果验收用）
            WarehouseSystem.seedOreTributes();
            // 初始化协同效应系统
            this._synergySystem = new SynergySystem();
            DEFAULT_SYNERGY_RULES.forEach(r => this._synergySystem.registerRule(r));
            // 初始化指挥AI系统
            this._battleCommander = new BattleCommander();
            // 初始化战术小队AI系统
            this._tacticalSquadAI = new TacticalSquadAI();
            // 在当前地图测试区域左边生成传送门
            const portalCfg = GAME_CONFIG.portals?.mainHub || { base: { x: 3478, y: 2363 }, spacing: 100, direction: 'left', entries: [] };
            const portalBase = portalCfg.base || { x: 3478, y: 2363 };
            const portalSpacing = portalCfg.spacing || 100;
            const portalDir = portalCfg.direction === 'right' ? 1 : -1;
            const portalEntries = portalCfg.entries || [];
            for (let i = 0; i < portalEntries.length; i++) {
                const entry = portalEntries[i];
                const px = portalBase.x + (i + 1) * portalSpacing * portalDir;
                const py = portalBase.y;
                const portal = new Portal(px, py, entry.targetScene, entry.label);
                this.entities.set(`portal_scene_${i + 2}`, portal);
                EffectManager.add(new FloatingTextEffect(px, py - 30, entry.label, '#5a9a8a'));
            }
            this.isRunning = true; this.lastTime = performance.now(); this.loop(this.lastTime);
        } catch(e) {
            const el = document.createElement('div');
            el.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;bottom:10px;z-index:99999;background:rgba(0,0,0,0.95);color:#ff4444;font-family:monospace;font-size:14px;padding:20px;overflow:auto;white-space:pre-wrap;';
            el.textContent = 'ERROR: ' + e.message + '\n\nStack:\n' + e.stack;
            document.body.appendChild(el);
        }
    },
    async spawnPlayer() {
        const startX = CONFIG.WORLD_WIDTH / 2 + 120 - 200;
        const startY = CONFIG.WORLD_HEIGHT / 2 - 150;
        this.player = new Player(startX, startY);
        this.entities.set('player', this.player);
        // 修复：player 创建后才初始化 GameUIManager，否则 updateUI 会因 player 为 null 而直接返回
        GameUIManager.init(this.player);
        Camera.follow(this.player);
        await EquipManager.init(this.player);
        CodexManager.init();
        // 通知 Phaser 场景玩家已生成，确保贴图/碰撞体正确初始化
        if (window.__phaserScene && typeof window.__phaserScene._onPlayerSpawn === 'function') {
            window.__phaserScene._onPlayerSpawn({ x: startX, y: startY });
        }
    },
    spawnTargets() {
        // 靶子放在迷宫下方的开放平原（上方相对出生点）
        const cfg = GAME_CONFIG.targets?.training || { base: { x: 3821, y: 2365 }, cols: 3, rows: 3, spacing: 120, baseHp: 150, hpIncrement: 30, namePrefix: '训练靶' };
        const base = cfg.base || { x: 3821, y: 2365 };
        const cols = cfg.cols || 3, rows = cfg.rows || 3, spacing = cfg.spacing || 120;
        const baseHp = cfg.baseHp || 150, hpIncrement = cfg.hpIncrement || 30;
        const namePrefix = cfg.namePrefix || '训练靶';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c;
                const tx = base.x + c * spacing, ty = base.y + r * spacing;
                const target = new TargetDummy(tx, ty, { hp: baseHp + i * hpIncrement, maxHp: baseHp + i * hpIncrement, name: `${namePrefix} ${i + 1}` });
                this.entities.set(`target_${i}`, target);
            }
        }
    },
    spawnEnemy() {
        // DPS测试靶子：无限生命值，显示DPS和总伤害
        const cfg = GAME_CONFIG.targets?.dpsTest || { x: 3244, y: 1879, hp: 999999, maxHp: 999999, size: 32, collisionRadius: 28, name: 'DPS测试靶', expValue: 0, dpsTracking: true };
        const dpsTarget = new TargetDummy(cfg.x, cfg.y, {
            hp: cfg.hp, maxHp: cfg.maxHp,
            size: cfg.size, collisionRadius: cfg.collisionRadius,
            name: cfg.name,
            expValue: cfg.expValue,
            dpsTracking: cfg.dpsTracking
        });
        this.entities.set('dps_target', dpsTarget);
    },
    handleAddPoint() {
        // 打开角色状态面板（属性点分配页面）
        SystemUI.open('status');
    },
    spawnSpitterZombieForTest() {
        if (!this.player) return;
        // 主神空间：在玩家右侧 250px 处生成一个毒液僵尸，用于测试贴图/动画/弹反
        const x = this.player.x + 250;
        const y = this.player.y;
        const spitter = new SpitterZombie(x, y);
        this.entities.set('spitter_test', spitter);
    },

    spawnNPC() {
        const npcCfg = GAME_CONFIG.npcs || {};
        const shopCfg = npcCfg.shopMouseKing || { offset: { x: 120, y: -150 }, name: '小鼠大王', size: 20, collisionRadius: 14, color: '#c4a35a', portrait: 'assets/ui/npc_portrait.png', npcType: 'shop' };
        const attendantCfg = npcCfg.mouseAttendant || { relativeTo: 'shopMouseKing', offset: { x: -100, y: 0 }, name: '小鼠侍从', size: 20, collisionRadius: 14, color: '#c4a35a', portrait: 'assets/npc/mouse_attendant.png', npcType: 'quest' };
        const npcX = CONFIG.WORLD_WIDTH / 2 + shopCfg.offset.x;
        const npcY = CONFIG.WORLD_HEIGHT / 2 + shopCfg.offset.y;
        const npc = new NPC(npcX, npcY, {
            id: 'npc_mouse_king',
            name: shopCfg.name,
            size: shopCfg.size,
            collisionRadius: shopCfg.collisionRadius,
            color: shopCfg.color,
            portrait: shopCfg.portrait,
            npcType: shopCfg.npcType,
            greetings: [
                '你好，冒险者！欢迎来到无限轮回。',
                '今天的天空格外晴朗呢。',
                '你看起来很强，要不要来商店看看？',
                '我听说最近在附近出现了一些奇怪的怪物。',
                '如果你需要强化装备，我可以帮你。',
                '你收集了多少战利品了？',
                '这个地方有时候会很危险，要小心。',
                '新鲜的货物刚到，快来看看！',
                '循环的世界永远不会无聊，对吧？',
                '你看起来需要帮助，有什么我可以做的吗？'
            ]
        });
        this.entities.set('npc_test', npc);
        const attendantX = attendantCfg.relativeTo === 'shopMouseKing' ? npcX + attendantCfg.offset.x : CONFIG.WORLD_WIDTH / 2 + attendantCfg.offset.x;
        const attendantY = attendantCfg.relativeTo === 'shopMouseKing' ? npcY + attendantCfg.offset.y : CONFIG.WORLD_HEIGHT / 2 + attendantCfg.offset.y;
        const attendant = new NPC(attendantX, attendantY, {
            id: 'npc_mouse_attendant',
            name: attendantCfg.name,
            size: attendantCfg.size,
            collisionRadius: attendantCfg.collisionRadius,
            color: attendantCfg.color,
            portrait: attendantCfg.portrait,
            npcType: attendantCfg.npcType,
            greetings: [
                '主人正在处理事务，请问有什么可以帮您的吗？',
                '听说最近发生了一些时空异常，请多加小心。',
                '您是来接受任务的吗？我可以为您安排。',
                '各个世界的状况越来越不稳定了……',
                '如果需要前往其他世界调查，请随时告诉我。',
                '我的职责是为主人分忧，也为冒险者引路。',
                '时空裂隙的出现频率越来越高了。',
                '您准备好迎接新的挑战了吗？',
                '我可以为您打开通往其他世界的大门。',
                '愿轮回之力保佑您的旅途平安。'
            ]
        });
        this.entities.set('npc_attendant', attendant);
        // 仓库 NPC（小鼠大王旁，实心圆替代贴图）
        const whCfg = npcCfg.warehouse || { relativeTo: 'shopMouseKing', offset: { x: 100, y: 0 }, name: '仓库', size: 20, collisionRadius: 14, color: '#8a6a3a', npcType: 'warehouse' };
        const whX = whCfg.relativeTo === 'shopMouseKing' ? npcX + whCfg.offset.x : CONFIG.WORLD_WIDTH / 2 + whCfg.offset.x;
        const whY = whCfg.relativeTo === 'shopMouseKing' ? npcY + whCfg.offset.y : CONFIG.WORLD_HEIGHT / 2 + whCfg.offset.y;
        const warehouseNpc = new NPC(whX, whY, {
            id: 'npc_warehouse',
            name: whCfg.name,
            size: whCfg.size,
            collisionRadius: whCfg.collisionRadius,
            color: whCfg.color,
            npcType: whCfg.npcType,
            greetings: ['仓库为你敞开。']
        });
        this.entities.set('npc_warehouse', warehouseNpc);
        // 祭坛 NPC（小鼠大王下方，实心圆替代贴图；点击打开祭坛对话）
        const altarCfg = npcCfg.altar || { relativeTo: 'shopMouseKing', offset: { x: 20, y: 120 }, name: '祭坛', size: 24, collisionRadius: 16, color: '#6a4a8a', npcType: 'altar' };
        const altarX = altarCfg.relativeTo === 'shopMouseKing' ? npcX + altarCfg.offset.x : CONFIG.WORLD_WIDTH / 2 + altarCfg.offset.x;
        const altarY = altarCfg.relativeTo === 'shopMouseKing' ? npcY + altarCfg.offset.y : CONFIG.WORLD_HEIGHT / 2 + altarCfg.offset.y;
        const altarNpc = new NPC(altarX, altarY, {
            id: 'npc_altar',
            name: altarCfg.name,
            size: altarCfg.size,
            collisionRadius: altarCfg.collisionRadius,
            color: altarCfg.color,
            npcType: altarCfg.npcType,
            greetings: ['祭坛的低语在空气中回荡，献上祭品，开启你的征程。']
        });
        this.entities.set('npc_altar', altarNpc);
        // 在小鼠大王右侧生成演示树木
        const treeCfg = GAME_CONFIG.trees?.demoLayout || { treeRadius: 25, groups: [] };
        const treeRadius = treeCfg.treeRadius || 25;
        for (const group of treeCfg.groups) {
            for (let i = 0; i < group.count; i++) {
                const tx = npcX + group.baseX + i * group.spacingX;
                const ty = npcY + group.baseY + (i % 2 === 0 ? -group.yJitter : group.yJitter);
                WallSystem.addTree(tx, ty, treeRadius, (group.startIndex || 0) + i, group.type, Math.random() * Math.PI * 2);
            }
        }
    },

    /**
     * 清理主神空间所有怪物（返回主神空间时调用）
     */
    clearMainMonstersAndSpawnDog() {
        // 删除所有阵营为 enemy 的实体（怪物）
        // 注：命名是历史遗留（早期同时生成僵尸犬），现仅承担"清空主神空间怪物"职责
        for (const [key, e] of this.entities.entries()) {
            if (e && e._faction === 'enemy') {
                if (e._phaserSprite && e._phaserSprite.active) {
                    e._phaserSprite.destroy();
                }
                this.entities.delete(key);
            }
        }
    },

    /**
     * 主神空间测试怪统一生成入口（开局 init 与 _loadMainScene 共用，强绑定）：
     * 清场后生成当前测试怪（铠甲骑士 + 手脑）。调整主神空间怪物只改这里。
     */
    spawnMainHubTestEntities() {
        this.clearMainMonstersAndSpawnDog();
        // 时空特工(突击)-F 测试生成（双形态机制验证）
        this.spawnMainTimeAgent();
        // 时空特工(盾位)-F 测试生成（沙鹰/盾击/防御弹反验证）
        this.spawnMainTimeAgentShield();
    },

    spawnMainTimeAgentShield() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const shieldCfg = enemyConfigData.timeAgentShield || {};
        // 迷宫已拆除，origin 东侧开阔地带生成（与突击特工错开站位）
        const shield = new TimeAgentShield(origin.x + 700, origin.y + 100, {
            ...shieldCfg,
            showWeapon: false,
            ai: {
                ...(shieldCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        this.entities.set('enemy_main_timeshield', shield);
    },

    spawnMainTimeAgent() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const agentCfg = enemyConfigData.timeAgentAssault || {};
        // 迷宫已拆除，origin 东侧开阔地带生成（避免卡墙）
        const agent = new TimeAgentAssault(origin.x + 500, origin.y + 100, {
            ...agentCfg,
            showWeapon: false,
            ai: {
                ...(agentCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        this.entities.set('enemy_main_timeagent', agent);
    },

    /**
     * 统一实体移除入口（强绑定，场景无关）：
     * 从 entities 删除前，先销毁该实体的 Phaser 贴图/标签，避免孤儿贴图残留。
     * 任何场景（主神空间/地牢/未来场景）删除实体都应走此入口。
     */
    removeEntity(key) {
        const entity = this.entities.get(key);
        if (entity) {
            // 实体自带的自定义特效统一清理（如集合体砸地范围圈/投掷警示/飞行投射物）
            if (typeof entity._destroyCustomEffects === 'function') {
                entity._destroyCustomEffects();
            }
            if (entity._phaserSprite) {
                entity._phaserSprite.destroy();
                entity._phaserSprite = null;
            }
            if (entity._phaserLabel) {
                entity._phaserLabel.destroy();
                entity._phaserLabel = null;
            }
            if (typeof entity._destroyPhaserSprite === 'function') {
                entity._destroyPhaserSprite();
            }
        }
        this.entities.delete(key);
    },

    /**
     * 是否为"存活尸体"（保留尸体机制，如胖子僵尸）：
     * 与实体更新循环同口径——尸体在死亡动画/尸体持续期间不被清理，
     * 只会因自身持续时间到而消失（腐蚀光环继续造成伤害）。
     */
    isPreservedCorpse(entity) {
        return !!(entity && entity._preserveCorpse && !entity.active &&
            (entity._deathAnimTimer > 0 || entity._corpseTimer > 0));
    },

    /**
     * 按 key 前缀统一移除实体（经 removeEntity，跳过存活尸体）。
     * 用于清理战斗召唤物（zombieDog_ / amalgam_fat_ / amalgam_zombie_ 等），
     * 这些实体不进入战斗追踪列表，需在清理路径按前缀兜底，避免战斗结束后泄漏。
     */
    removeEntitiesByPrefix(...prefixes) {
        for (const key of Array.from(this.entities.keys())) {
            if (!prefixes.some(p => typeof key === 'string' && key.startsWith(p))) continue;
            if (this.isPreservedCorpse(this.entities.get(key))) continue;
            this.removeEntity(key);
        }
    },

    spawnMainZombieDog() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const zombieDogCfg = enemyConfigData.zombieDog || {};
        // [FIX] 主城测试犬不再硬编码攻击/速度/碰撞等属性，直接复用 zombieDog 配置，
        // 仅保留较高的 80 HP 作为测试目标。
        const dog = new ZombieDogEnemy(origin.x + 250, origin.y + 120, {
            ...zombieDogCfg,
            name: '僵尸犬',
            hp: 80, maxHp: 80,
            showWeapon: false,
            _alertRange: Infinity,
            ai: { ...(zombieDogCfg.ai || {}), aggroRange: 9999, pacingRange: 0, loseTimeout: 999999 }
        });
        this.entities.set('enemy_main_zombie_dog', dog);
    },
    spawnMainZombieWizard() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const wizardCfg = enemyConfigData.zombieWizard || {};
        const wizard = new ZombieWizard(origin.x + 400, origin.y + 120, {
            ...wizardCfg,
            name: '僵尸巫师',
            hp: 500, maxHp: 500,
            showWeapon: false,
            _alertRange: Infinity,
            ai: {
                ...(wizardCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        wizard._createZombieDog = (x, y) => new ZombieDogEnemy(x, y, {
            ...enemyConfigData.zombieDog,
            name: '僵尸犬',
            hp: 80, maxHp: 80,
            showWeapon: false,
            ai: { aggroRange: 9999, pacingRange: 0, loseTimeout: 999999 }
        });
        this.entities.set('enemy_main_zombie_wizard', wizard);
    },
    spawnMainMutant3() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const mutantCfg = enemyConfigData.mutant3 || {};
        const mutant = new Mutant3(origin.x + 400, origin.y + 120, {
            ...mutantCfg,
            name: '突变体-3',
            hp: 750, maxHp: 750,
            showWeapon: false,
            _alertRange: Infinity,
            ai: {
                ...(mutantCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        mutant._createZombieDog = (x, y) => new ZombieDogEnemy(x, y, {
            ...enemyConfigData.zombieDog,
            name: '僵尸犬',
            hp: 80, maxHp: 80,
            showWeapon: false,
            ai: { aggroRange: 9999, pacingRange: 0, loseTimeout: 999999 }
        });
        this.entities.set('enemy_main_mutant3', mutant);
    },
    spawnMainFatZombie() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const fatCfg = enemyConfigData.fatZombie || {};
        // 使用原设定数值，仅保留永久警戒便于测试
        const fat = new FatZombie(origin.x + 250, origin.y + 250, {
            ...fatCfg,
            showWeapon: false,
            _alertRange: Infinity,
            ai: {
                ...(fatCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        this.entities.set('enemy_main_fat_zombie', fat);
    },
    spawnMainZombie() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const zombieCfg = enemyConfigData.zombie || {};
        // 使用原设定数值，仅保留永久警戒便于测试
        const zombie = new Zombie(origin.x + 250, origin.y + 120, {
            ...zombieCfg,
            showWeapon: false,
            _alertRange: Infinity,
            ai: {
                ...(zombieCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        this.entities.set('enemy_main_zombie', zombie);
    },
    spawnMainAmalgam() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const amalgamCfg = enemyConfigData.amalgamZombie || {};
        // 使用原设定数值，仅保留永久警戒便于测试
        const amalgam = new AmalgamZombie(origin.x + 650, origin.y + 120, {
            ...amalgamCfg,
            showWeapon: false,
            _alertRange: Infinity,
            ai: {
                ...(amalgamCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        // 注入召唤/生成工厂（主神空间测试用，沿用永久警戒配置）
        amalgam._createBasicZombie = (x, y) => new Zombie(x, y, {
            ...enemyConfigData.zombie,
            showWeapon: false,
            ai: { ...(enemyConfigData.zombie?.ai || {}), aggroRange: 9999, loseTimeout: 999999 }
        });
        amalgam._createFatZombie = (x, y) => new FatZombie(x, y, {
            ...enemyConfigData.fatZombie,
            showWeapon: false,
            ai: { ...(enemyConfigData.fatZombie?.ai || {}), aggroRange: 9999, loseTimeout: 999999 }
        });
        this.entities.set('enemy_main_amalgam', amalgam);
    },
    spawnMainArmoredKnight() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const knightCfg = enemyConfigData.armoredKnight || {};
        // 使用原设定数值，仅保留永久警戒便于测试
        const knight = new ArmoredKnight(origin.x + 350, origin.y + 320, {
            ...knightCfg,
            showWeapon: false,
            ai: {
                ...(knightCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        this.entities.set('enemy_main_armored_knight', knight);
    },
    spawnMainShounao() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const shounaoCfg = enemyConfigData.shounao || {};
        // 使用原设定数值，仅保留永久警戒便于测试；与骑士错开站位
        const shounao = new Shounao(origin.x - 350, origin.y + 320, {
            ...shounaoCfg,
            showWeapon: false,
            ai: {
                ...(shounaoCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        this.entities.set('enemy_main_shounao', shounao);
    },
    spawnMainFlySwarm() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const flyCfg = enemyConfigData.flySwarm || {};
        const fly = new FlySwarm(origin.x, origin.y + 520, {
            ...flyCfg,
            showWeapon: false,
            ai: {
                ...(flyCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        this.entities.set('enemy_main_flyswarm', fly);
    },
    spawnMainFlyHand() {
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const flyHandCfg = enemyConfigData.flyHand || {};
        // 迷宫已拆除，origin 东侧开阔地带生成（避免卡墙）
        const flyHand = new FlyHand(origin.x + 400, origin.y + 100, {
            ...flyHandCfg,
            showWeapon: false,
            ai: {
                ...(flyHandCfg.ai || {}),
                aggroRange: 9999,
                pacingRange: 0,
                loseTimeout: 999999
            }
        });
        this.entities.set('enemy_main_flyhand', flyHand);
    },
    spawnTestTargets() {
        // 生成20个10HP不会移动的测试目标
        const cfg = GAME_CONFIG.targets?.testTargets || { base: { x: 4379, y: 2411 }, spacing: 60, perRow: 5, count: 20, hp: 10, maxHp: 10, size: 14, collisionRadius: 10, namePrefix: '测试目标', expValue: 10 };
        const base = cfg.base || { x: 4379, y: 2411 };
        const spacing = cfg.spacing || 60;
        const perRow = cfg.perRow || 5;
        const count = cfg.count || 20;
        for (let i = 0; i < count; i++) {
            const row = Math.floor(i / perRow);
            const col = i % perRow;
            const tx = base.x + col * spacing;
            const ty = base.y + row * spacing;
            const target = new TargetDummy(tx, ty, { hp: cfg.hp, maxHp: cfg.maxHp, size: cfg.size, collisionRadius: cfg.collisionRadius, name: `${cfg.namePrefix}${i + 1}`, expValue: cfg.expValue });
            this.entities.set(`test_target_${i}`, target);
        }
    },
    dropItem(x, y, itemTemplate) {
        // 通过 ItemFactory 创建独立物品实例
        const itemInstance = ItemFactory.create(itemTemplate);
        const drop = new DropItem(x, y, itemInstance);
        this.entities.set('drop_' + Date.now() + '_' + Math.floor(Math.random() * 1000), drop);
    },
    _showDungeonEntryConfirm(entity) {
        if (getElement('dungeonEntryConfirm')) return;
        const overlay = document.createElement('div');
        overlay.id = 'dungeonEntryConfirm';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.80); z-index: 10001;
            display: flex; align-items: center; justify-content: center;
            font-family: SimHei, "Microsoft YaHei", sans-serif; user-select: none;
        `;
        overlay.innerHTML = `
            <div style="background: #2a2520; border: 2px solid #5a4a3a; border-radius: 10px; padding: 30px; max-width: 400px; width: 90%; color: #d4c5a9; text-align: center;">
                <h3 style="color: #e8c878; margin: 0 0 15px; font-size: 22px;">⚔ 地牢模式</h3>
                <p style="margin: 0 0 25px; line-height: 1.6;">你即将进入杀戮尖塔风格的地牢探险。<br>选择路线，击败敌人，获取奖励。</p>
                <div style="display: flex; gap: 15px; justify-content: center;">
                    <button id="dungeonEntryConfirmBtn" style="padding: 12px 30px; background: #4a6a3a; border: 2px solid #6a8a5a; color: #d4c5a9; border-radius: 5px; cursor: pointer; font-size: 15px;">进入地牢</button>
                    <button id="dungeonEntryCancelBtn" style="padding: 12px 30px; background: #3a3a3a; border: 2px solid #5a5a5a; color: #888; border-radius: 5px; cursor: pointer; font-size: 15px;">离开</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const confirmBtn = getElement('dungeonEntryConfirmBtn');
        const cancelBtn = getElement('dungeonEntryCancelBtn');
        if (!confirmBtn || !cancelBtn) {
            console.error('[Game._showDungeonEntryConfirm] 地牢确认/取消按钮未找到');
            return;
        }
        confirmBtn.onmouseenter = () => confirmBtn.style.background = "#5a7a4a";
        confirmBtn.onmouseleave = () => confirmBtn.style.background = "#4a6a3a";
        cancelBtn.onmouseenter = () => cancelBtn.style.background = "#4a4a4a";
        cancelBtn.onmouseleave = () => cancelBtn.style.background = "#3a3a3a";
        confirmBtn.onclick = () => {
            overlay.remove();
            const portalCooldownMs = GAME_CONFIG.portals?.mainHub?.cooldownMs || 2000;
        this._portalCooldown = Date.now() + portalCooldownMs;
            try {
                SceneManager.switchScene(entity.targetScene, this.player);
            } catch (err) {
                console.error('[portal detection] switchScene error:', err);
            }
        };
        cancelBtn.onclick = () => {
            overlay.remove();
            const portalCooldownMs = GAME_CONFIG.portals?.mainHub?.cooldownMs || 2000;
        this._portalCooldown = Date.now() + portalCooldownMs;
        };
    },
    // 武器生成位置管理器：从固定坐标开始，向右排列，每10件向下200单位
    _weaponSpawnIndex: 0,
    spawnWeapon(itemTemplate) {
        const cfg = GAME_CONFIG.weaponSpawn?.grid || { base: { x: -1356, y: 3 }, cols: 10, spacingX: 100, spacingY: 200 };
        const base = cfg.base || { x: -1356, y: 3 };
        const cols = cfg.cols || 10;
        const col = this._weaponSpawnIndex % cols;
        const row = Math.floor(this._weaponSpawnIndex / cols);
        const x = base.x + col * cfg.spacingX;
        const y = base.y + row * cfg.spacingY;
        this.dropItem(x, y, itemTemplate);
        this._weaponSpawnIndex++;
        return { x, y };
    },
    // 武器横向生成：在主神空间相对位置横向生成所有武器
    // 按顺序添加新武器，自动扩展
    _WEAPON_SPAWN_LIST: [
        EquipDataManager.TEST_EQUIPMENTS.weapon,      // 生锈的长剑 (weapon1)
        EquipDataManager.KINGHTS_SWORD_ITEM,            // 骑士长剑 (weapon2)
        EquipDataManager.RUNE_SWORD_ITEM,              // 符文长剑 (weapon4)
        EquipDataManager.NIGHT_FLAME_SWORD_ITEM,      // 夜与火之剑 (weapon5)
        EquipDataManager.PKM_ITEM,                     // PKM (weapon6)
        EquipDataManager.AKM_ITEM,                     // AKM (weapon7)
        EquipDataManager.QBZ191_ITEM,                  // QBZ-191 (weapon8)
        EquipDataManager.G18_PISTOL_ITEM,               // G18 (weapon9)
        EquipDataManager.DESERT_EAGLE_ITEM,            // 沙漠之鹰 (weapon10)
        EquipDataManager.P4040_ITEM,                     // P4040 (weapon18)
        EquipDataManager.QJB201_ITEM,                  // QJB-201 (weapon11)
        EquipDataManager.SUPER90_ITEM,                  // Super90 (weapon12)
        EquipDataManager.SAIGA12K_ITEM,                // SAIGA-12K (weapon13)
        EquipDataManager.ENERGY_LMG_ITEM,              // 能量轻机枪 (weapon15)
    ],
    spawnAllWeapons() {
        // 使用主神空间中心（origin）为参考点的相对坐标
        const origin = (Renderer && Renderer._getSceneOrigin) ? Renderer._getSceneOrigin() : (
            GAME_CONFIG.scenes?.mainHub?.origin || { x: 3825, y: 1886 }
        );
        const cfg = GAME_CONFIG.weaponSpawn?.allWeapons || { offset: { x: -874, y: -136 }, spacing: 50 };
        const baseX = origin.x + cfg.offset.x;
        const baseY = origin.y + cfg.offset.y;
        const spacing = cfg.spacing || 50;
        for (let i = 0; i < this._WEAPON_SPAWN_LIST.length; i++) {
            this.dropItem(baseX + i * spacing, baseY, this._WEAPON_SPAWN_LIST[i]);
        }
    },
    tryPickupItem(px, py, range) {
        let picked = false;
        this.entities.forEach((entity, key) => {
            if (picked) return;
            if (entity instanceof DropItem && entity.active) {
                const dx = entity.x - px, dy = entity.y - py;
                if (Math.sqrt(dx * dx + dy * dy) <= range) {
                    const itemData = entity.itemData;
                    // 可堆叠物品（金币/强化石/改造券等）：即使背包格子已满，只要现有堆叠未满就可以拾取
                    let canStack = false;
                    if (itemData && itemData.maxStack && itemData.maxStack > 1) {
                        const bp = EquipManager.backpackItems || [];
                        for (const existing of bp) {
                            if (existing.name === itemData.name && (existing.stack || 1) < itemData.maxStack) {
                                canStack = true;
                                break;
                            }
                        }
                    }
                    if (!canStack && EquipManager.backpackItems.length >= EquipManager.maxBackpackSlots) {
                        BackpackDialogManager._showBackpackFullNotice();
                        return false;
                    }
                    // 贤者之石「点石成金」：拾取的祭品品质提升一级，传说则额外再获一件（须在入包克隆前转换）
                    if (entity.itemData && entity.itemData.category === 'tribute' && hasOreUpgrade()) {
                        applyOreUpgradeOnPickup(entity.itemData, this.player);
                    }
                    const added = EquipManager.addToBackpack(entity.itemData);
                    if (added) {
                        entity.active = false;
                        if (entity._destroyPhaserSprite) entity._destroyPhaserSprite();
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                        picked = true;
                    }
                }
            }
        });
        return picked;
    },
    loop(timestamp) {
        if (!this.isRunning) return;
        if (this._paused) { this.lastTime = timestamp; requestAnimationFrame(t => this.loop(t)); return; }
        try {
            const maxDt = GAME_CONFIG.gameLoop?.maxDtMs || 100;
            const dt = Math.max(0, Math.min(timestamp - this.lastTime, maxDt)); this.lastTime = timestamp;
            this.frameCount++; this.fpsTimer += dt;
            if (this.fpsTimer >= 1000) { this.fps = this.frameCount; this.frameCount = 0; this.fpsTimer = 0; }
            this.update(dt); this.render(); GameUIManager.updateUI(); Input.update();
        } catch (e) {
            console.error('Game loop error:', e);
        }
        requestAnimationFrame(t => this.loop(t));
    },
    update(dt) {
        // ===== 地牢模式：地牢地图系统拦截 =====
        if (SceneManager.currentScene === 'scene7' && DungeonMapSystem && DungeonMapSystem.active) {
            if (DungeonMapSystem.state === 'map') {
                DungeonMapSystem.update(dt);
                EffectManager.update(dt);
                QuickBar.updateCooldowns(dt);
                Input.update();
                return;
            } else if (DungeonMapSystem.state === 'combat' || DungeonMapSystem.state === 'boss') {
                DungeonMapSystem.updateCombat(dt);
                // 地牢战斗中摄像机跟随玩家
                if (this.player) {
                    Camera.update(this.player);
                }
                try {
                    if (NPCDialogue && NPCDialogue.active) {
                        NPCDialogue.close();
                    }
                } catch (e) {
                    console.error('[DungeonMapSystem] Failed to close NPCDialogue:', e);
                }
                // 继续执行下面的实体更新
            } else if (DungeonMapSystem.state === 'shop' || DungeonMapSystem.state === 'event' || DungeonMapSystem.state === 'reward') {
                // 商店/事件/奖励模式：只更新输入和特效（奖励面板打开时实体不更新）
                EffectManager.update(dt);
                QuickBar.updateCooldowns(dt);
                Input.update();
                return;
            }
        }

        // 无人机操控模式下镜头跟随无人机
if (this.player && this.player.droneSystem && this.player.droneSystem.controlling) {
            const drone = this.player.droneSystem;
            Camera.update({ x: drone.x, y: drone.y });
        } else {
            Camera.update(this.player);
        }

        // 读取交互距离配置
        const interactCfg = GAME_CONFIG.interactionDistances || {};
        const npcClickDist = interactCfg.npcClick || 200;
        const npcHoverDist = interactCfg.npcHover || 40;
        const pickupClickDist = interactCfg.pickupClick || 150;
        const pickupHoverDist = interactCfg.pickupHover || 35;
if (Input.mouse.leftPressed) {
            // NPC 对话检测（优先于拾取）
            if (NPCDialogue.active) {
                NPCDialogue.skip();
                Input.mouse.leftPressed = false;
                return;
            }
            let clickedNPC = false;
            let clickedPickup = false;
            const dropKeysToDelete = [];
            for (const [key, entity] of this.entities) {
                if (clickedNPC && clickedPickup) break;
                if (!clickedNPC && entity instanceof NPC && entity.active) {
                    const pdx = entity.x - this.player.x, pdy = entity.y - this.player.y;
                    const playerDist = Math.sqrt(pdx * pdx + pdy * pdy);
                    if (playerDist > npcClickDist) continue;
                    const pos = Renderer.worldToScreen(entity.x, entity.y);
                    const mx = Input.mouse.x, my = Input.mouse.y;
                    const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - pos.y) * (my - pos.y)) < npcHoverDist;
                    if (hover) {
                        // 仓库 NPC：直接打开仓库面板，不走对话；记录锚点供距离自动关闭
                        if (entity.npcType === 'warehouse') {
                            WarehouseSystem._anchorNPC = entity;
                            WarehouseSystem.open();
                        } else {
                            NPCDialogue.open(entity);
                        }
                        clickedNPC = true;
                        Input.mouse.leftPressed = false;
                    }
                }
                if (!clickedPickup && entity instanceof DropItem && entity.active) {
                    const pdx = entity.x - this.player.x, pdy = entity.y - this.player.y;
                    const playerDist = Math.sqrt(pdx * pdx + pdy * pdy);
                    if (playerDist > pickupClickDist) continue;
                    const pos = Renderer.worldToScreen(entity.x, entity.y);
                    const bobY = Math.sin(entity.bobOffset) * 4;
                    const mx = Input.mouse.x, my = Input.mouse.y;
                    const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - (pos.y + bobY)) * (my - (pos.y + bobY))) < pickupHoverDist;
                    if (hover) {
                        const added = EquipManager.addToBackpack(entity.itemData);
                        if (added) {
                            entity.active = false;
                            if (entity._destroyPhaserSprite) entity._destroyPhaserSprite();
                            dropKeysToDelete.push(key);
                            EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                            clickedPickup = true;
                            Input.mouse.leftPressed = false;
                        } else {
                            BackpackDialogManager._showBackpackFullNotice();
                        }
                    }
                }
            }
            for (const key of dropKeysToDelete) {
                this.entities.delete(key);
            }
            if (clickedNPC) return;
        }

        // ===== 空间分区重建：必须在实体/战斗/AI/投射物更新前完成 =====
        if (SpatialPartitionSystem) {
            SpatialPartitionSystem.update(dt, this.entities);
        }

        // 预同步所有 Collider：子类 update 经常覆盖 super.update，导致 collider 位置停留在出生点。
        // 在战斗/AI 前统一同步一次，确保近战、投射物命中判定使用最新坐标。
        for (const e of this.entities.values()) {
            if (e.collider) e.collider.syncPosition();
        }

        // === [REFACTOR-START] 单次遍历：实体基础 update + 外部系统驱动 + 收集敌人 ===
this._battleCommanderEnemies = [];
        for (const e of this.entities.values()) {
            const isCorpse = e._preserveCorpse && !e.active && (e._deathAnimTimer > 0 || e._corpseTimer > 0);
            if (!e.active && !isCorpse) continue;
e.update(dt, this.entities);
// 玩家 update 会移动并触发攻击，同步其 Collider 供后续敌人 AI/战斗作为目标使用
            if (e === this.player && e.collider) {
                e.collider.syncPosition();
            }
if (e instanceof Enemy) {
                if (e.hp > 0) this._battleCommanderEnemies.push(e);
                if (PerceptionSystem) {
PerceptionSystem.update(e, dt, this.entities);
}
                if (MovementSystem) {
MovementSystem.update(e, dt, this.entities);
}
                // 敌人在 MovementSystem 移动后、CombatSystem 判定前同步 Collider，
                // 保证敌人自身攻击形状原点与目标 Collider 都为当前帧位置。
                if (e.collider) {
                    e.collider.syncPosition();
                }
                if (CombatSystem) {
CombatSystem.update(e, dt, this.entities);
}
            }
        }
        // === [REFACTOR-END] ===

        // ===== 阵型系统更新（必须在实体 update 之后，为下一帧设置 _tacticalTarget）=====
if (FormationSystem) {
            for (const e of this.entities.values()) {
                if (e.active) FormationSystem.update(e, dt, this.entities);
            }
        }

        // 协同效应系统更新
        if (this._synergySystem) {
            this._synergySystem.update(dt, this.entities);
        }

        // 指挥AI（BattleCommander）更新：根据战场态势选择战术并分配目标位置
        if (this._battleCommander && this.player && this._battleCommanderEnemies.length > 0) {
            this._battleCommander.update(dt, this.player, this._battleCommanderEnemies);
        }

        // 战术小队AI更新：控制类人型战术小队的协同行动
        if (this._tacticalSquadAI) {
            this._tacticalSquadAI.update(dt, this.player, this.entities);
        }

        // 战术小队角色动态切换（指挥官死亡后自动晋升）
        if (TacticalSquadRoleSwitch) {
            TacticalSquadRoleSwitch.update(dt, this.entities);
        }

        // ===== 单次遍历：金币自动拾取 + 清理死亡实体 + 传送门检测 =====
const pickupCfg = GAME_CONFIG.pickup || {};
        const goldAutoRange = pickupCfg.goldAutoRange || 80;
        const goldThrowOutRange = pickupCfg.goldThrowOutRange || 80;
        const goldAutoRangeSq = goldAutoRange * goldAutoRange;
        const goldThrowOutRangeSq = goldThrowOutRange * goldThrowOutRange;
        const goldMaxStack = pickupCfg.goldMaxStack || 999;
        let goldStackItem = null;
        for (const bpItem of EquipManager.backpackItems) {
            if (bpItem.category === 'gold' && bpItem.stack < (bpItem.maxStack || goldMaxStack)) {
                goldStackItem = bpItem;
                break;
            }
        }

        const portalCfg = GAME_CONFIG.portals?.mainHub || {};
        const portalTriggerDist = portalCfg.triggerDistance || interactCfg.portalTrigger || 30;
        const portalCooldownMs = portalCfg.cooldownMs || 2000;
        const now = Date.now();
        const portalReady = this.player && !SceneManager.isLoading && now > this._portalCooldown;

        for (const [key, entity] of this.entities) {
            if (!entity.active) {
                if (entity._deathTime && now - entity._deathTime > (entity._deathRemoveDelay || 0)) {
                    this.entities.delete(key);
                }
                continue;
            }

            // 金币自动拾取
            if (entity instanceof DropItem && entity.itemData && entity.itemData.category === 'gold') {
                const dx = entity.x - this.player.x;
                const dy = entity.y - this.player.y;
                const distSq = dx * dx + dy * dy;
                if (entity.itemData._droppedByPlayer) {
                    if (distSq > goldThrowOutRangeSq) {
                        entity.itemData._wasOutOfRange = true;
                    }
                    if (!entity.itemData._wasOutOfRange) {
                        // still in throw-out range, skip
                    } else if (distSq <= goldAutoRangeSq) {
                        // try stack/add
                        let stacked = false;
                        if (goldStackItem && goldStackItem.stack < (goldStackItem.maxStack || goldMaxStack)) {
                            goldStackItem.stack += entity.itemData.stack;
                            stacked = true;
                        } else {
                            for (const bpItem of EquipManager.backpackItems) {
                                if (bpItem.category === 'gold' && bpItem.stack < (bpItem.maxStack || goldMaxStack)) {
                                    bpItem.stack += entity.itemData.stack;
                                    stacked = true;
                                    break;
                                }
                            }
                        }
                        if (stacked) {
                            entity.active = false;
                            if (entity._destroyPhaserSprite) entity._destroyPhaserSprite();
                            this.entities.delete(key);
                            EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `+${entity.itemData.stack} 金币`, '#ffd700'));
                            if (SoundManager) {
                                SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                            }
                        } else if (EquipManager.backpackItems.length < EquipManager.maxBackpackSlots) {
                            EquipManager.addToBackpack(entity.itemData);
                            entity.active = false;
                            if (entity._destroyPhaserSprite) entity._destroyPhaserSprite();
                            this.entities.delete(key);
                            EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `+${entity.itemData.stack} 金币`, '#ffd700'));
                            if (SoundManager) {
                                SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                            }
                        } else {
                            BackpackDialogManager._showBackpackFullNotice();
                        }
                    }
                } else if (distSq <= goldAutoRangeSq) {
                    let stacked = false;
                    if (goldStackItem && goldStackItem.stack < (goldStackItem.maxStack || goldMaxStack)) {
                        goldStackItem.stack += entity.itemData.stack;
                        stacked = true;
                    } else {
                        for (const bpItem of EquipManager.backpackItems) {
                            if (bpItem.category === 'gold' && bpItem.stack < (bpItem.maxStack || goldMaxStack)) {
                                bpItem.stack += entity.itemData.stack;
                                stacked = true;
                                break;
                            }
                        }
                    }
                    if (stacked) {
                        entity.active = false;
                        if (entity._destroyPhaserSprite) entity._destroyPhaserSprite();
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `+${entity.itemData.stack} 金币`, '#ffd700'));
                        if (SoundManager) {
                            SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                        }
                    } else if (EquipManager.backpackItems.length < EquipManager.maxBackpackSlots) {
                        EquipManager.addToBackpack(entity.itemData);
                        entity.active = false;
                        if (entity._destroyPhaserSprite) entity._destroyPhaserSprite();
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `+${entity.itemData.stack} 金币`, '#ffd700'));
                        if (SoundManager) {
                            SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                        }
                    } else {
                        BackpackDialogManager._showBackpackFullNotice();
                    }
                }
            }

            // 传送门检测
            if (portalReady && entity.targetScene) {
                const dx = entity.x - this.player.x, dy = entity.y - this.player.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < portalTriggerDist) {
                    this._portalCooldown = now + portalCooldownMs;
                    try {
                        if (entity.targetScene === 'scene7') {
                            this._showDungeonEntryConfirm(entity);
                        } else {
                            if (entity._isQuestReturn) {
                                QuestState.completeEvacuation();
                                QuestState.finishQuest();
                                SceneManager.switchScene(entity.targetScene, this.player);
                            } else {
                                SceneManager.switchScene(entity.targetScene, this.player);
                            }
                        }
                    } catch (err) {
                        console.error('[portal detection] switchScene error:', err);
                    }
                }
            }
        }
this.resolveCollisions();
EffectManager.update(dt);
        // ===== 状态栏更新 =====
        if (StatusBar) {
            StatusBar.update(dt);
        }
        // 裂隙系统更新（仅在任务模式的雪地场景）
        if (SceneManager.currentScene === 'scene2' && QuestState && QuestState.isInQuest() && RiftSystem) {
            RiftSystem.update(dt, this.player);
        }
        QuickBar.updateCooldowns(dt);
        // Z键范围拾取：检测并执行
        if (this._pickupNearbyFlag) { this._pickupNearbyFlag = false; this.pickupNearbyItems(); }

        // 清理已失效但仍在 entities 中的掉落物（销毁 Phaser Sprite 并从 Map 移除）
        for (const [key, entity] of this.entities) {
            if (!entity.active && entity instanceof DropItem) {
                if (entity._destroyPhaserSprite) entity._destroyPhaserSprite();
                this.entities.delete(key);
            }
        }


        // 列车场景滚动背景
if (SceneManager.currentScene === 'scene3') {
            if (!this._trainScrollOffset) this._trainScrollOffset = 0;
            const scene3Cfg = GAME_CONFIG.scene3 || { scrollSpeed: 500 };
            this._trainScrollOffset += scene3Cfg.scrollSpeed * (dt / 1000);
        }
        // 雪地场景怪物定时生成
        if (SceneManager.currentScene === 'scene2') {
            const scene2Cfg = GAME_CONFIG.scene2?.spawning || {};
            const questCfg = scene2Cfg.quest || { firstDelay: 40000, interval: 40000, count: 3, radius: 1500 };
            const freeCfg = scene2Cfg.freeExplore || { interval: 5000, count: 3, radius: 2000 };
            // 任务模式：特殊怪物生成规则
            if (QuestState && QuestState.isInQuest()) {
                if (!this._questSpawnTimer) this._questSpawnTimer = 0;
                this._questSpawnTimer += dt;
                const firstDelay = this._questFirstSpawnDelay || questCfg.firstDelay;
                const interval = questCfg.interval;
                const count = questCfg.count;
                if (this._questSpawnTimer >= firstDelay) {
                    this._questSpawnTimer = 0;
                    this._questFirstSpawnDelay = interval; // 首次之后使用间隔
                    for (let i = 0; i < count; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const radius = questCfg.radius;
                        const sx = this.player.x + Math.cos(angle) * radius;
                        const sy = this.player.y + Math.sin(angle) * radius;
                        const mx = Math.max(100, Math.min(CONFIG.WORLD_WIDTH - 100, sx));
                        const my = Math.max(100, Math.min(CONFIG.WORLD_HEIGHT - 100, sy));
                        const monster = new BlackWolf(mx, my);
                        Game.entities.set(`scene2_quest_${Date.now()}_${i}_${Math.random()}`, monster);
                    }
                }
            } else {
                // 自由探索模式：原有逻辑
                if (!this._scene2SpawnTimer) this._scene2SpawnTimer = 0;
                this._scene2SpawnTimer += dt;
                if (this._scene2SpawnTimer >= freeCfg.interval) {
                    this._scene2SpawnTimer = 0;
                    for (let i = 0; i < freeCfg.count; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const dist = freeCfg.radius;
                        const sx = this.player.x + Math.cos(angle) * dist;
                        const sy = this.player.y + Math.sin(angle) * dist;
                        const mx = Math.max(100, Math.min(CONFIG.WORLD_WIDTH - 100, sx));
                        const my = Math.max(100, Math.min(CONFIG.WORLD_HEIGHT - 100, sy));
                        const monster = new BlackWolf(mx, my);
                        Game.entities.set(`scene2_monster_${Date.now()}_${i}_${Math.random()}`, monster);
                    }
                }
            }
        }

        // NPC 距离检测：离开配置距离自动关闭所有相关界面
        this._checkNPCDistance();
        // NPC 对话逐字更新
        NPCDialogue.update();
    },
    _checkNPCDistance() {
        if (!this.player) return;
        let activeNPC = NPCDialogue._currentNPC;
        if (!activeNPC && ShopSystem._currentNPC) activeNPC = ShopSystem._currentNPC;
        if (!activeNPC && EnhanceSystem._currentNPC) activeNPC = EnhanceSystem._currentNPC;
        // 仓库/祭坛（出征/合成）打开时：以各自锚点 NPC 为参照（对话已关，_currentNPC 为空）
        if (!activeNPC && WarehouseSystem._isOpen) activeNPC = WarehouseSystem._anchorNPC;
        if (!activeNPC && UIState.isOpen('expedition')) activeNPC = ExpeditionSystem._anchorNPC;
        if (!activeNPC && UIState.isOpen('fusion')) activeNPC = FusionSystem._anchorNPC;
        if (!activeNPC) return;
        const dx = activeNPC.x - this.player.x;
        const dy = activeNPC.y - this.player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const npcAutoCloseDist = GAME_CONFIG.interactionDistances?.npcAutoClose || 200;
        if (dist > npcAutoCloseDist) {
            NPCDialogue.close();
            ShopSystem.close();
            EnhanceSystem.close();
            SystemUI.close();
            WarehouseSystem.close();
            if (UIState.isOpen('expedition')) ExpeditionSystem.close();
            if (UIState.isOpen('fusion')) FusionSystem.close();
            LevelUpEffectQueue.clear();
        }
    },

    pickupNearbyItems() {
        const px = this.player.x, py = this.player.y;
        const range = GAME_CONFIG.pickup?.nearbyRange || 75; // 默认半径75px
        let pickedCount = 0;
        this.entities.forEach((entity, key) => {
            if (entity instanceof DropItem && entity.active) {
                const dx = entity.x - px, dy = entity.y - py;
                if (Math.sqrt(dx * dx + dy * dy) <= range) {
                    const added = EquipManager.addToBackpack(entity.itemData);
                    if (added) {
                        entity.active = false;
                        if (entity._destroyPhaserSprite) entity._destroyPhaserSprite();
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                        pickedCount++;
                    }
                }
            }
        });
        if (pickedCount > 0) { EffectManager.add(new FloatingTextEffect(px, py - 40, `范围拾取 ${pickedCount} 件物品`)); } else { EffectManager.add(new FloatingTextEffect(px, py - 40, '范围内无物品')); }
    },
    // 判断敌人是否正锁定某个目标并已进入攻击范围（用于关闭该组合的玩家-敌人推开）
    _isEnemyAttackingTarget(enemy, target) {
        if (!enemy || !target || enemy.faction !== 'enemy') return false;
        if (enemy.target !== target && enemy._comboTarget !== target && enemy._pounceTarget !== target) return false;
        const attackDist = enemy.attackRange ?? 80;
        const dx = enemy.x - target.x, dy = enemy.y - target.y;
        return dx * dx + dy * dy <= attackDist * attackDist;
    },
    // 实体碰撞体积解析：防止目标间堆叠（支持矩形、六边形、圆形）
    resolveCollisions() {
        const entities = Array.from(this.entities.values()).filter(e => e.active && e.groundRadius > 0 && !e.noCollision);
        const player = this.player;
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                const a = entities[i], b = entities[j];
                // 玩家与正在攻击自己的敌人不再互相推开，避免近战攻击时把目标小幅挤开
                if (player && (
                    (a === player && this._isEnemyAttackingTarget(b, player)) ||
                    (b === player && this._isEnemyAttackingTarget(a, player))
                )) continue;
                // Phase 1：统一使用地面圆形 footprint 做实体间分离
                const radiusA = a.groundRadius;
                const radiusB = b.groundRadius;
                // footprint 位置统一取 Collider 偏移后坐标（与命中椭圆/阴影同源，
                // 修复 colliderOffsetY 实体（如集合体）视觉椭圆与物理分离错位）
                const ax = a.collider ? a.collider.x : a.x;
                const ay = a.collider ? a.collider.y : a.y;
                const bx = b.collider ? b.collider.x : b.x;
                const by = b.collider ? b.collider.y : b.y;
                // 判定体积匹配 footprint 椭圆（逆透视变换，与投射物 footprint 判定同口径）：
                // 世界空间圆在屏幕 Y 方向按 PERSPECTIVE_SCALE_Y 压缩，分离判定同样按椭圆处理
                const invScale = 1 / PERSPECTIVE_SCALE_Y;
                const dx = bx - ax;
                const dy = (by - ay) * invScale;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = radiusA + radiusB;

                if (dist > 0 && dist < minDist) {
                    // 不可分离单位（如站桩 Boss）：自身纹丝不动，由对方承担全部重叠位移；双方均不可动则跳过
                    const immA = !!a.noSeparation;
                    const immB = !!b.noSeparation;
                    if (immA && immB) continue;
                    const overlap = minDist - dist;
                    // 在逆透视空间求法线，位移量再变换回世界空间（Y × SCALE_Y）
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const moveA = immA ? { x: 0, y: 0 } : {
                        x: -nx * overlap / (immB ? 1 : 2),
                        y: -ny * overlap / (immB ? 1 : 2) * PERSPECTIVE_SCALE_Y
                    };
                    const moveB = immB ? { x: 0, y: 0 } : {
                        x: nx * overlap / (immA ? 1 : 2),
                        y: ny * overlap / (immA ? 1 : 2) * PERSPECTIVE_SCALE_Y
                    };

                    // 用 WallSystem 校验，避免分离把实体推进墙里
                    const na = WallSystem.resolve(a.x, a.y, a.x + moveA.x, a.y + moveA.y, radiusA);
                    const nb = WallSystem.resolve(b.x, b.y, b.x + moveB.x, b.y + moveB.y, radiusB);
                    a.x = na.x; a.y = na.y;
                    b.x = nb.x; b.y = nb.y;
                }
            }
        }
    },
    render() {
        // ===== 渲染前置检查：Canvas 未就绪时跳过 =====
        if (!Renderer.ctx || !Renderer.canvas) return;

        // ===== 地牢模式：显示 gameCanvas 并渲染地牢地图 =====
        const isDungeonMap = SceneManager.currentScene === 'scene7' && DungeonMapSystem && DungeonMapSystem.active && DungeonMapSystem.state === 'map';
        if (isDungeonMap) {
            if (Renderer.canvas.style.display !== 'block') Renderer.canvas.style.display = 'block';
            Renderer.clear();
            DungeonMapSystem.render(Renderer.ctx);
            return;
        }

        // 所有世界渲染已迁移到 Phaser；非地牢地图模式下隐藏底层 gameCanvas 以节省 clear/合成开销
        if (Renderer.canvas.style.display !== 'none') Renderer.canvas.style.display = 'none';
    },
};
