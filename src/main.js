// ==================== 模块化入口文件 ====================
// 按原 legacy.js 顺序导入所有模块，并挂载为全局变量

import { DataLoader } from './systems/data-loader.js';

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

    // 挂载到全局（保持与原 legacy.js 相同的运行时行为）
    // A. Config & Utils
    window.CONFIG = CONFIG;
    window.MathUtils = MathUtils;
    window.Easing = Easing;
    window.WEAPON_ANIM = WEAPON_ANIM;
    window.DataLoader = DataLoader;
    // 兼容旧代码直接引用的 easing 函数（player.js / enemy.js 中使用）
    window.easeInQuad = Easing.easeInQuad;
    window.easeOutQuad = Easing.easeOutQuad;
    window.easeInCubic = Easing.easeInCubic;
    window.easeInOutCubic = Easing.easeInOutCubic;

    // B. World
    window.Renderer = Renderer;
    window.Camera = Camera;
    window.MapGenerator = MapGenerator;
    window.MazeGenerator = MazeGenerator;
    window.WallSystem = WallSystem;

    // C. Effects
    window.EffectManager = EffectManager;
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
    window.DustEffect = DustEffect;
    window.FloatingTextEffect = FloatingTextEffect;
    window.MuzzleFlashEffect = MuzzleFlashEffect;
    window.ShellCasingEffect = ShellCasingEffect;

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
    window.DropItem = DropItem;
    window.NPC = NPC;

    // NPC Systems
    window.NPCDialogue = NPCDialogue;
    window.ShopSystem = ShopSystem;
    window.EnhanceSystem = EnhanceSystem;

    // 兼容别名
    window.HitEffect = BloodHitEffect;

    // G. Core Systems
    window.EventBus = EventBus;

    // H. UI Systems
    window.Input = Input;
    window.SkillManager = SkillManager;
    window.QuickBar = QuickBar;
    window.QUICK_BAR_CONFIG = QUICK_BAR_CONFIG;
    window.EquipManager = EquipManager;
    window.CodexManager = CodexManager;
    window.SystemUI = SystemUI;
    window.UI_DATA_CONFIG = UI_DATA_CONFIG;
    window.SoundManager = SoundManager;

    // I. Game
    window.Game = Game;

    // 绑定按钮事件（替代 HTML 内联 onclick，避免 ES6 模块加载前引用未定义的 Game）
    const startBtn = document.getElementById('startGameBtn');
    if (startBtn) startBtn.addEventListener('click', () => { startBtn.blur(); Game.start(); });
    const helpBtn = document.getElementById('showHelpBtn');
    if (helpBtn) helpBtn.addEventListener('click', () => { helpBtn.blur(); Game.showHelp(); });
    const backBtn = document.getElementById('backMenuBtn');
    if (backBtn) backBtn.addEventListener('click', () => { backBtn.blur(); Game.toMenu(); });

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

// B. World
import { Renderer } from './world/renderer.js';
import { Camera } from './world/camera.js';
import { MapGenerator } from './world/map-generator.js';
import { MazeGenerator } from './world/maze-generator.js';
import { WallSystem } from './world/wall-system.js';

// C. Effects
import { EffectManager } from './effects/effect-manager.js';
import { SlashEffect } from './effects/slash-effect.js';
import { ThrustEffect } from './effects/thrust-effect.js';
import { BloodHitEffect } from './effects/blood-hit-effect.js';
import { SmokeEffect } from './effects/smoke-effect.js';
import { AttackRangeEffect } from './effects/attack-range-effect.js';
import { DashConvergeEffect, DashAuraEffect, GoldenConvergeEffect } from './effects/dash-effects.js';
import { SweepEffect } from './effects/sweep-effect.js';
import { NightFlameBeamEffect } from './effects/nightflame-effect.js';
import { DodgeEffect, DeathEffect, BloodEffect, DustEffect } from './effects/particle-effects.js';
import { FloatingTextEffect } from './effects/floating-text.js';
import { MuzzleFlashEffect } from './effects/muzzle-flash.js';
import { ShellCasingEffect } from './effects/shell-casing.js';

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
import { DropItem } from './entities/drop-item.js';

// G. Core Systems
import { EventBus } from './core/event-bus.js';

// H. UI Systems
import { Input } from './ui/input.js';
import { SkillManager } from './ui/skill-manager.js';
import { QuickBar, QUICK_BAR_CONFIG } from './ui/quick-bar.js';
import { EquipManager } from './ui/equip-manager.js';
import { CodexManager } from './ui/codex-manager.js';
import { SystemUI, UI_DATA_CONFIG } from './ui/system-ui.js';
import { SoundManager } from './ui/sound-manager.js';

// I. Game
import { Game } from './game.js';

// NPC
import { NPC } from './entities/npc.js';
import { NPCDialogue } from './ui/npc-dialogue.js';
import { ShopSystem } from './ui/shop-system.js';
import { EnhanceSystem } from './ui/enhance-system.js';

// 启动初始化
initModules().catch(err => console.error('Module init failed:', err));
