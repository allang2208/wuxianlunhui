// ==================== 模块化入口文件 ====================
// 按原 legacy.js 顺序导入所有模块，并挂载为全局变量

import { DataLoader } from './systems/data-loader.js';
import { MovementSystem } from './systems/movement-system.js';
import { CombatSystem } from './systems/combat-system.js';
import { PerceptionSystem } from './systems/perception-system.js';

// 异步加载所有数据，然后初始化模块
async function initModules() {
    // 加载 JSON 数据
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

    // 加载战术小队配置
    const squadConfig = await DataLoader.loadJSON('/data/humanoid-squad-config.json');
    if (squadConfig) {
        window.HUMANOID_SQUAD_CONFIG = squadConfig;
    }

    // 挂载到全局（保持与原 legacy.js 相同的运行时行为）
    // A. Config & Utils
    window.CONFIG = CONFIG;
    window.MathUtils = MathUtils;
    window.Easing = Easing;
    window.WEAPON_ANIM = WEAPON_ANIM;
    window.Z_INDEX = Z_INDEX;
    window.CSS_Z_INDEX = CSS_Z_INDEX;
    window.DataLoader = DataLoader;
    window.EnchantConfig = EnchantConfig;
    window.EnchantScrollItems = EnchantScrollItems;
    window.MagicDustItem = MagicDustItem;
    window.AttackFormula = { calculateAttackFormula, getAttackFormula, computeWeaponAttack, isMachineGun };
    // 兼容旧代码直接引用的 easing 函数（player.js / enemy.js 中使用）
    window.easeInQuad = Easing.easeInQuad;
    window.easeOutQuad = Easing.easeOutQuad;
    window.easeInCubic = Easing.easeInCubic;
    window.easeInOutCubic = Easing.easeInOutCubic;
    window.easeOutQuart = Easing.easeOutQuart;

    // B. World
    window.Renderer = Renderer;
    window.Camera = Camera;
    window.MapGenerator = MapGenerator;
    window.MazeGenerator = MazeGenerator;
    window.WallSystem = WallSystem;

    // C. Effects
    window.EffectManager = EffectManager;
    window.WeaponEffect = WeaponEffect;
    window.SlashEffect = SlashEffect;
    window.ThrustEffect = ThrustEffect;
    window.BloodHitEffect = BloodHitEffect;
    window.SmokeEffect = SmokeEffect;
    window.AttackRangeEffect = AttackRangeEffect;
    window.DashConvergeEffect = DashConvergeEffect;
    window.DashAuraEffect = DashAuraEffect;
    window.GoldenConvergeEffect = GoldenConvergeEffect;
    window.SweepEffect = SweepEffect;
    window.NightFlameBeamEffect = NightFlameBeamEffect;
    window.DodgeEffect = DodgeEffect;
    window.DeathEffect = DeathEffect;
    window.BloodEffect = BloodEffect;
    window.BloodMistEffect = BloodMistEffect;
    window.DustEffect = DustEffect;
    window.RuneSwordExplodeEffect = RuneSwordExplodeEffect;
    window.ZombieBloodPool = ZombieBloodPool;
    window.FloatingTextEffect = FloatingTextEffect;
    window.MuzzleFlashEffect = MuzzleFlashEffect;
    window.ShellCasingEffect = ShellCasingEffect;
    window.LevelUpEffectQueue = LevelUpEffectQueue;

    // World & Scene
    window.SceneManager = SceneManager;
    window.Portal = Portal;

    // D. Items
    window.ItemFactory = ItemFactory;
    window.ItemDatabase = ItemDatabase;
    window.WeaponAnimConfig = WeaponAnimConfig;

    // E. Combat
    window.Attack = Attack;
    window.SlashAttack = SlashAttack;
    window.ThrustAttack = ThrustAttack;
    window.RangedAttack = RangedAttack;
    window.Projectile = Projectile;

    // F. Entities
    window.Entity = Entity;
    window.DamageableEntity = DamageableEntity;
    window.TargetDummy = TargetDummy;
    window.Player = Player;
    window.Enemy = Enemy;
    window.BlackWolf = BlackWolf;
    window.RedWolfKing = RedWolfKing;
    window.HumanoidMonster = HumanoidMonster;
    window.Commander = Commander;
    window.MachineGunner = MachineGunner;
    window.Rifleman = Rifleman;
    window.FlankRifleman = FlankRifleman;
    window.ShieldBearer = ShieldBearer;

    window.DropItem = DropItem;
    window.NPC = NPC;

    // NPC Systems
    window.NPCDialogue = NPCDialogue;
    window.ShopSystem = ShopSystem;
    window.EnhanceSystem = EnhanceSystem;
    window.CraftSystem = CraftSystem;
    window.EnchantSystem = EnchantSystem;
    window.QuestSystem = QuestSystem;
    window.QuestState = QuestState;
    window.QuestTracker = QuestTracker;
    window.LevelUpSystem = LevelUpSystem;
    window.RiftSystem = RiftSystem;
    window.RewardSystem = RewardSystem;
    window.EnhancementItems = EnhancementItems;

    // Gold Manager
    window.GoldManager = GoldManager;

    // 兼容别名
    window.HitEffect = BloodHitEffect;

    // AI
    window.pathFinder = pathFinder;
    window.PathManager = PathManager;
    window.TacticalSquadAI = TacticalSquadAI;

    // AI Systems (v0.197 重构)
    window.MovementSystem = MovementSystem;
    window.CombatSystem = CombatSystem;
    window.PerceptionSystem = PerceptionSystem;

    // G. Core Systems
    window.EventBus = EventBus;

    // H. UI Systems
    window.StatusBar = StatusBar;
    window.Input = Input;
    window.SkillManager = SkillManager;
    window.QuickBar = QuickBar;
    window.QUICK_BAR_CONFIG = QUICK_BAR_CONFIG;
    window.EquipManager = EquipManager;
    window.EquipTooltipManager = EquipTooltipManager;
    window.BackpackDialogManager = BackpackDialogManager;
    window.EquipDataManager = EquipDataManager;
    window.GameUIManager = GameUIManager;
    window.CodexManager = CodexManager;
    window.SystemUI = SystemUI;
    window.UI_DATA_CONFIG = UI_DATA_CONFIG;
    window.SoundManager = SoundManager;
    // 挂载开发工具
    window.DevTool = DevTool;
    // 挂载立绘调整工具
    window.NpcPortraitTool = NpcPortraitTool;

    // I. Game
    window.Game = Game;
    window.SkillLevelSystem = SkillLevelSystem;
    // Phaser 迁移系统
    window.PhaserGame = PhaserGame;

    // 绑定按钮事件（替代 HTML 内联 onclick，避免 ES6 模块加载前引用未定义的 Game）
    const startBtn = document.getElementById('startGameBtn');
    if (startBtn) startBtn.addEventListener('click', () => { startBtn.blur(); Game.start(); });
    const helpBtn = document.getElementById('showHelpBtn');
    if (helpBtn) helpBtn.addEventListener('click', () => { helpBtn.blur(); Game.showHelp(); });
    const backBtn = document.getElementById('backMenuBtn');
    if (backBtn) backBtn.addEventListener('click', () => { backBtn.blur(); Game.toMenu(); });
    // 初始化开发工具
    DevTool.init();
    // 初始化立绘调整工具
    NpcPortraitTool.init();

    // 启动游戏
    if (document.readyState === 'complete') {
        Game.init();
    } else {
        window.onload = () => Game.init();
    }

    console.log('✅ Module system initialized. 32 modules loaded. Data-driven config active.');
}

// 导入所有模块（导入顺序不影响运行时，因为挂载在 initModules 中执行）
// A. Config & Utils
import { CONFIG } from './config/config.js';
import { MathUtils, Easing, WEAPON_ANIM } from './config/math-utils.js';
import { Z_INDEX, CSS_Z_INDEX } from './config/ui-constants.js';
import { EnchantConfig, EnchantScrollItems, MagicDustItem } from './config/enchant-config.js';
import { calculateAttackFormula, getAttackFormula, computeWeaponAttack, isMachineGun } from './config/attack-formula.js';

// B. World
import { Renderer } from './world/renderer.js';
import { Camera } from './world/camera.js';
import { MapGenerator } from './world/map-generator.js';
import { MazeGenerator } from './world/maze-generator.js';
import { WallSystem } from './world/wall-system.js';

// C. Effects
import { EffectManager } from './effects/effect-manager.js';
import { WeaponEffect } from './effects/weapon-effect.js';
import { SlashEffect } from './effects/slash-effect.js';
import { ThrustEffect } from './effects/thrust-effect.js';
import { BloodHitEffect } from './effects/blood-hit-effect.js';
import { SmokeEffect } from './effects/smoke-effect.js';
import { AttackRangeEffect } from './effects/attack-range-effect.js';
import { DashConvergeEffect, DashAuraEffect, GoldenConvergeEffect } from './effects/dash-effects.js';
import { SweepEffect } from './effects/sweep-effect.js';
import { NightFlameBeamEffect } from './effects/nightflame-effect.js';
import { DodgeEffect, DeathEffect, BloodEffect, BloodMistEffect, DustEffect, RuneSwordExplodeEffect, ZombieBloodPool } from './effects/particle-effects.js';
import { FloatingTextEffect } from './effects/floating-text.js';
import { MuzzleFlashEffect } from './effects/muzzle-flash.js';
import { ShellCasingEffect } from './effects/shell-casing.js';
import { LevelUpEffectQueue } from './effects/level-up-queue.js';
import { PoisonEffect } from './effects/poison-effect.js';

// World & Scene
import { SceneManager } from './world/scene-manager.js';
import { Portal } from './world/portal.js';

// D. Items
import { ItemFactory } from './items/item-factory.js';
import { ItemDatabase } from './items/item-database.js';
import { WeaponAnimConfig } from './items/weapon-anim-config.js';

// E. Combat
import { Attack, SlashAttack, ThrustAttack, RangedAttack } from './combat/attack.js';
import { Projectile } from './combat/projectile.js';

// F. Entities
import { Entity } from './entities/entity.js';
import { DamageableEntity } from './entities/damageable-entity.js';
import { TargetDummy } from './entities/target-dummy.js';
import { Player } from './entities/player.js';
import { Enemy } from './entities/enemy.js';
import { pathFinder } from './ai/pathfinder.js';
import { PathManager } from './ai/path-manager.js';
import { BlackWolf, RedWolfKing } from './entities/enemy-types.js';
import { HumanoidMonster, Commander, MachineGunner, Rifleman, FlankRifleman, ShieldBearer } from './entities/humanoid-monster.js';
import { TacticalSquadAI } from './ai/tactical-squad-ai.js';

import { DropItem } from './entities/drop-item.js';
import { NPC } from './entities/npc.js';

// G. Core Systems
import { EventBus } from './core/event-bus.js';

// H. UI Systems
import { StatusBar } from './ui/status-bar.js';
import { Input } from './ui/input.js';
import { SkillManager } from './ui/skill-manager.js';
import { QuickBar, QUICK_BAR_CONFIG } from './ui/quick-bar.js';
import { EquipManager } from './ui/equip-manager.js';
import { EquipTooltipManager } from './ui/equip-tooltip-manager.js';
import { BackpackDialogManager } from './ui/backpack-dialog-manager.js';
import { EquipDataManager } from './ui/equip-data-manager.js';
import { GameUIManager } from './ui/game-ui-manager.js';
import { CodexManager } from './ui/codex-manager.js';
import { SystemUI, UI_DATA_CONFIG } from './ui/system-ui.js';
import { SoundManager } from './ui/sound-manager.js';
import DevTool from './ui/dev-tool.js';
import { NpcPortraitTool } from './ui/npc-portrait-tool.js';

// I. Game
import { Game } from './game.js';

// Phaser 迁移系统
import { PhaserGame } from './phaser/PhaserGame.js';

// NPC Systems
import { NPCDialogue } from './ui/npc-dialogue.js';
import { ShopSystem } from './ui/shop-system.js';
import { EnhanceSystem } from './ui/enhance-system.js';
import { CraftSystem } from './ui/craft-system.js';
import { EnchantSystem } from './ui/enchant-system.js';
import { QuestSystem, QuestState, QuestTracker, LevelUpSystem } from './ui/quest-system.js';
import { RewardSystem, EnhancementItems } from './ui/reward-system.js';
import { RiftSystem } from './quest/rift-system.js';

// Gold & Currency
import { GoldManager } from './systems/gold-manager.js';

// Skill Level System
import { SkillLevelSystem } from './combat/skill-level-system.js';

// 启动初始化
initModules().catch(err => console.error('Module init failed:', err));
