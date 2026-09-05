import { friendlyAttackFrame } from '../../combat/friendly-attack-timing.js';
import { Game } from '../../game.js';
import { SceneManager } from '../../world/scene-manager.js';
import { PartySystem } from '../../systems/party-system.js';
import { EnergyNodeSystem } from '../../world/energy-node-system.js';


// ============================================================
// GameScene - 主游戏场景：替代原有的 renderer.js + game.js 渲染部分
// ============================================================
import { Scene, BlendModes, TintModes } from 'phaser';
import { WallSystem } from '../../world/wall-system.js';
import { FlatViewSystem } from '../../world/flat-view-system.js';
import { WallGate } from '../../world/wall-gate.js';
import {
    wallBattlementRuneVariant,
    wallBattlementsAtSlot,
    WALL_BATTLEMENT_RUNE_VISUAL,
} from '../../world/wall-battlement.js';
import { ChestRoomSystem } from '../../world/chest-room-system.js';
import { Renderer } from '../../world/renderer.js';
import { MapGenerator } from '../../world/map-generator.js';
import { bakeDungeonFloorChunk, registerDecoClearZones } from '../../world/dungeon-floor-texture.js';
import { WeaponTransform } from '../../combat/weapon-transform.js';
import { SwordArcTrail } from '../../effects/sword-arc-trail.js';
import { WhirlwindWeaponDepth } from '../../effects/whirlwind-weapon-depth.js';
import { WhirlwindFootprintFx } from '../../effects/whirlwind-footprint-fx.js';
import { DashThrustConvergenceFx } from '../../effects/dash-thrust-convergence-fx.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FogVisualAdapter } from '../../effects/fog-visual-adapter.js';
import { ForemanWhipVisuals } from '../../effects/foreman-whip-visual.js';
import { FogMaskRenderer } from '../fog/fog-mask-renderer.js';
import { FogMinimapLayer } from '../fog/fog-minimap-layer.js';
import { FogDebugOverlay } from '../fog/fog-debug-overlay.js';
import { FogVisibilityController } from '../fog/fog-visibility-controller.js';
import {
    appendTriangulatedShadow,
    createStaticShadowHandle,
    shadowCasterMayReachViewport,
    shadowPolygonIntersectsViewport,
} from '../shadows/static-shadow-render-cache.js';
import {
    BuildingDamageFx,
    buildingDamageFlameCount,
    isBuildingDamageFxTarget,
} from '../../effects/building-damage-fx.js';
import { getWeaponTextureKey } from '../../config/weapon-texture-map.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { Easing, WEAPON_ANIM } from '../../config/math-utils.js';
import { CONFIG } from '../../config/config.js';
import { GAME_CONFIG } from '../../config/game-config.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { UnitDisplaySettings } from '../../ui/unit-display-settings.js';
import { getSpriteFrameOffset } from '../../utils/sprite-offsets.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { PLAYER_DEFAULTS } from '../../config/player-defaults.js';
import { playerTextureKey, getPlayerAnimDef, getPlayerAnimDurationMs } from '../../config/player-anim.js';
import { AnimChannel, resolveAnimChannel, enterRecover, clearPose, isPlayerRunVisual, nowMs,
    MELEE_STAGE_ANIM_KEYS, meleeStageCfgKey, meleeStageRecoverMs } from '../../entities/player/anim-state.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { getPlayerShieldVisual, PLAYER_SHIELD_ARM } from '../../config/shield-config.js';
import { PlayerShieldRig } from '../player-shield-rig.js';
import { PlayerSwordShieldMotion } from '../player-sword-shield-motion.js';
import { getTorsoRect } from '../../physics/torso-hitbox.js';
import { entitySurfaceZ, isEntityStrictlyBelow } from '../../physics/elevation.js';
import SpatialPartitionSystem from '../../systems/spatial-partition-system.js';
import { FogOfWarSystem } from '../../world/fog-of-war-system.js';
import performanceConfig from '../../../data/performance-config.json';
import { PerformanceMonitor } from '../../systems/performance-monitor.js';
import { RuntimeAssetManager } from '../assets/runtime-asset-manager.js';

import { DungeonMapSystem } from '../../world/dungeon-map-system.js';
import { Camera } from '../../world/camera.js';
import { Input } from '../../ui/input.js';
import { isGameplayPointerEvent } from '../../ui/gameplay-pointer-boundary.js';
import { RiftSystem } from '../../quest/rift-system.js';
import { isGunWeapon, isTwoHanded, isRifle } from '../../config/gun-ammo.js';
import { GUN_FAMILY, PISTOL_FAMILY } from '../../config/weapon-families.js';
import { findWeaponConfig } from '../../ui/equip-data-manager.js';
import { ExpeditionSystem } from '../../ui/expedition-system.js';
import { getCastSpeedMultiplier } from '../../utils/magic-craft-helper.js';
import { burstParticles, resolveSkillEffectDepth } from '../../effects/combat-fx.js';
import { GunFeel } from '../../effects/gunfeel.js';
import {
    DEFENSE_TOWER_VISUAL,
    DefenseSystem,
    WALL_WALK_CONFIG,
    blockWallTopWalkGeometry,
} from '../../world/defense-system.js';
import { stairGroupGroundPortal } from '../../world/unified-elevated-navigation.js';
import {
    applyFittedBuildingFootprint,
    getBuildingFootprint,
} from '../../world/building-footprint.js';
import { isoFootprintVertices } from '../../physics/iso-footprint.js';
import {
    compareIsoBoundsOrder,
    resolveStructureRenderOrder,
    segmentIsoBounds,
    STRUCTURE_ORDER_GAP,
    structureDepthChannels,
    structureIsoBounds,
} from '../../world/structure-render-order.js';
import {
    clearStructureFootOffsetCache,
    resolveConfiguredVisualFootprint,
    resolveStructureGroundFit,
    shouldAutoAnchorStructure,
} from '../../world/structure-visual-anchor.js';
import {
    getVisibleFrameBounds,
    getVisibleSpriteWorldBounds,
    getVisibleSpriteTopY,
    resolveSpriteDepthProfile,
} from '../../world/sprite-depth-profile.js';
import { structureOcclusionBounds } from '../../world/structure-depth.js';
import { syncAllCivilianVisualDepths } from '../../world/civilian-visual-utils.js';
import {
    applyCivilianVisualSetting,
    CivilianVisualSettings,
} from '../../world/civilian-visual-runtime.js';
import { EnvironmentLightingSystem } from '../../world/environment-lighting-system.js';
import { RainWeatherSystem } from '../../world/rain-weather-system.js';
import { WindblownSandSystem } from '../../world/windblown-sand-system.js';
import { World122SandstormSystem } from '../../world/world122-sandstorm-system.js';
import { World122DroughtSystem } from '../../world/world122-drought-system.js';
import { DroughtHeatSystem } from '../../world/drought-heat-system.js';
import { WorldWeatherSystem } from '../../world/world-weather-system.js';
import { WorldProgressionSystem } from '../../world/world-progression-system.js';
import { RoadsideDecorationSystem } from '../../world/roadside-decoration-system.js';
import { WorldDestructionChallengeSystem } from '../../world/world-destruction-challenge-system.js';
import { World125AtmosphereSystem } from '../../world/world125-atmosphere-system.js';
import { World125FogTideSystem } from '../../world/world125-fog-tide-system.js';
import { World126WeatherSystem } from '../../world/world126-weather-system.js';
import { World126WeatherRuntime } from '../../world/world126-weather-runtime.js';
import { PopulationEconomySystem } from '../../world/population-economy-system.js';
import { BakeryEconomySystem } from '../../world/bakery-economy-system.js';
import { CheeseFarmSystem } from '../../world/cheese-farm-system.js';
import { SteamPowerPlantSystem } from '../../world/steam-power-plant-system.js';
import {
    isStructureShadowEnabled,
    resolveStructureShadowCaster,
} from '../../world/structure-shadow-caster.js';
import { WORLD_RENDER_LAYERS } from '../../world/world-render-layers.js';
import { resolveUnitGroundFootprint } from '../../world/unit-ground-footprint.js';
import lightingAssets from '../../../data/environment-lighting-assets.json';
import '../../config/structure-ground-fit-config.js';

/**
 * 保留 NPC/商店/对话业务身份的仓库、祭坛仍是格网建筑：物理、范围可视化、
 * 结构阴影与主体图层必须共同识别同一个 iso footprint，禁止再叠单位圆柱体积。
 */
const usesBuildingFootprintVolume = (entity) => !!entity
    && entity._isGridBuilding === true
    && entity.collisionShape === 'iso_rect'
    && Number(entity.collisionWidth) > 0
    && Number(entity.collisionHeight) > 0;

/** 世界建筑统一 HUD 判定：防守结构及格网建筑都不常驻名称或满血血条。 */
const isWorldBuildingEntity = (entity) => !!entity
    && (entity._isDefenseStructure === true || usesBuildingFootprintVolume(entity));

const setVisualDepthIfChanged = (visual, depth, stats) => {
    if (visual.depth === depth) {
        stats.frameRedundantSkips += 1;
        stats.totalRedundantSkips += 1;
        return false;
    }
    visual.setDepth(depth);
    stats.frameWrites += 1;
    stats.totalWrites += 1;
    return true;
};

// 世界-122~126 共用大世界尺寸与广角镜头。集中登记，避免新位面已按
// 12288×8192 构建却遗漏相机名单、仍以 1:1 放大显示。
const ZOOMED_OUT_WORLD_SCENES = new Set(['scene8', 'scene9', 'scene10', 'scene11', 'scene12', 'strategy_battle']);
const COMMAND_CURSOR_STYLES = Object.freeze({
    move: 'crosshair',
    gather: 'crosshair',
    attack_move: 'url("assets/ui/cursors/attack-target-cold-steel.png") 24 24, crosshair',
    patrol: 'url("assets/ui/cursors/patrol-cold-steel.png") 24 24, crosshair',
    rally: 'url("assets/ui/cursors/rally-cold-steel.png") 20 41, crosshair',
    attack_target: 'url("assets/ui/cursors/attack-target-cold-steel.png") 24 24, crosshair',
    invalid: 'url("assets/ui/cursors/invalid-command-cold-steel.png") 24 24, not-allowed',
    recycle: 'url("assets/ui/cursors/recycle-cold-steel.png") 24 20, crosshair',
});

// 无人岗位提示：只画描边，中心保持完全透明；斜杠随整枚标识旋转。
const NO_WORKERS_INDICATOR = Object.freeze({
    radius: 20,
    topGap: 17,
    cycleMs: 4800,
    shadowColor: 0x2b0d13,
    ringColor: 0xff4655,
    highlightColor: 0xffc2b5,
});

// 共享结构阴影层：所有建筑/障碍物阴影先合并，再在同一 Graphics 内向轮廓内部羽化；
// 相邻阴影交叠与单影同深（杜绝重叠加深），中心透明度仍精确等于原始 opacity；
// 深度由 WORLD_RENDER_LAYERS 统一分配：位于道路/地面铺装之上、压平投影之下。
// 道路即地面，阴影压暗路面如压裸地；同层对象不再依赖显示列表创建顺序。
// 最外层轮廓必须保持原尺寸；整体放大或居中描边都会越过主体贴图的 alpha 接地边。


export class GameScene extends Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    // ---- 生命周期 ----

    _installWebGLContextRecovery() {
        const canvas = this.game?.canvas;
        const renderer = this.game?.renderer;
        this._webglContextLost = !!renderer?.contextLost;
        // Phaser 4 的逐对象 Filter 会为每个对象建立离屏渲染通道。Boot 又常驻大量
        // 4K/8K 精灵表，位面入侵时建筑沉陷/石化叠加会把显存峰值推到 context lost。
        // 从首帧禁用这些纯装饰 Filter，建筑下沉走 crop，石化/悬停走普通 tint。
        this._webglFiltersDisabled = true;
        if (renderer) renderer._optionalFiltersDisabledAfterContextLoss = true;
        if (this._webglFiltersDisabled) this._weaponBlurDisabled = true;
        if (!canvas?.addEventListener) return;

        this._onWebGLContextLost = () => {
            this._webglContextLost = true;
            RuntimeAssetManager.markContextLost();
            this._webglFiltersDisabled = true;
            if (renderer) renderer._optionalFiltersDisabledAfterContextLoss = true;
            this._weaponBlurDisabled = true;
            this._weaponBlurFilter = null;
            // 丢失期间不能销毁旧 GL 资源；只停止 Filter 渲染，待 Phaser 完成恢复后统一清理。
            for (const child of this.children?.list || []) {
                if (child?.filterCamera) child.renderFilters = false;
            }
            for (const fx of this._petrifyFx?.values?.() || []) {
                for (const record of fx?.sprites?.values?.() || []) record.filter = null;
            }
        };
        this._onWebGLContextRestored = () => {
            this._webglContextLost = false;
            this._clearOptionalWebGLFiltersAfterRestore();
            RuntimeAssetManager.recoverAfterContextRestore();
        };
        canvas.addEventListener('webglcontextlost', this._onWebGLContextLost, false);
        canvas.addEventListener('webglcontextrestored', this._onWebGLContextRestored, false);
        this.events.once('shutdown', () => {
            canvas.removeEventListener('webglcontextlost', this._onWebGLContextLost, false);
            canvas.removeEventListener('webglcontextrestored', this._onWebGLContextRestored, false);
            this._onWebGLContextLost = null;
            this._onWebGLContextRestored = null;
        });
    }

    _clearOptionalWebGLFiltersAfterRestore() {
        for (const child of this.children?.list || []) {
            if (!child?.filterCamera) continue;
            // 不在新 context 中销毁旧 context 创建的 framebuffer/texture；这正是
            // INVALID_OPERATION "object does not belong to this context" 的来源。
            // 仅切断渲染引用，交给页面/场景完整重建统一回收。
            child.renderFilters = false;
            child.__hoverGlowFx = null;
        }
        for (const fx of this._petrifyFx?.values?.() || []) {
            for (const record of fx?.sprites?.values?.() || []) record.filter = null;
        }
    }

    create() {
        // 场景重建时清运行时 alpha 缓存；同路径替换建筑原图后还必须重新生成 ground-fit manifest。
        clearStructureFootOffsetCache();

        // 标记场景就绪，通知外部系统（必须提前，因为后续代码依赖 window.__phaserScene）
        window.__phaserSceneReady = true;
        window.__phaserScene = this;
        RuntimeAssetManager.attachScene(this);
        RuntimeAssetManager.ensureBuildingEntities(Game.entities?.values?.() || [], { required: false })
            .then(() => RuntimeAssetManager.commitBuildingEntities(
                Game.entities?.values?.() || []));
        this._civilianVisualSettingsUnsubscribe?.();
        this._civilianVisualSettingsUnsubscribe = CivilianVisualSettings.subscribe((disabled) => {
            applyCivilianVisualSetting(this, disabled);
        });
        this.events.once('shutdown', () => {
            this._civilianVisualSettingsUnsubscribe?.();
            this._civilianVisualSettingsUnsubscribe = null;
        });
        this._attachPerformanceRenderSampling();

        // 初始化标志（必须在 setupColliders 之前）
        this._collidersSet = false;
        this._playerAttackStartTime = 0;
        this._playerAttackDuration = 667;
        this._weaponBlurFilter = null; // 武器真实模糊（Phaser 4 Blur 滤镜控制器，逐帧更新 strength）
        this._weaponBlurDisabled = false; // 运动模糊禁用标记（超大贴图 / WebGL context lost 后置位，防 Framebuffer 崩溃）
        this._installWebGLContextRecovery();
        this._companionSprites = {}; // 侍从跟随渲染：memberId → Phaser Sprite
        this._selectionRings = {};   // 组队栏选中光圈：memberId → Phaser Ellipse（金色脚下光圈）
        this._companionGhosts = {};  // 动作切换残影（淡出 110ms）：memberId → Phaser Sprite
        this._playerAttachedHitFx = []; // 玩家短寿命受击附着层（跟随主体贴图移动/深度）
        this._desertPriestStaffGlowKeys = new Set(); // 沙漠祭司逐帧法杖顶端金光
        this._desertPriestStaffSparks = new Set(); // 短命星芒；地图模式切换时立即清理
        this._moveMarkerGfx = null;  // 右键移动目标标记（绿色下指箭头）
        // 冰墙 fx 池与共享发射器：场景 stop/start 后旧对象已销毁，必须重置防悬挂引用
        this._iceWallFx = [];
        this._iceWallVariantPool = null;
        // Velocity 驱动开关（默认关闭，避免与原有移动逻辑冲突）
        // 如需手动测试，可在控制台执行：__phaserScene._useVelocityDrive = true
        this._useVelocityDrive = false;

        // 创建玩家 Sprite（占位，后续由 Player 类接管）
        this._createPlayerSprite();

        // 敌人移动/碰撞由 Game + WallSystem 逻辑层统一处理；这里只保留普通渲染组。
        // 禁止再给每只敌人创建 Arcade Body，否则空 overlap 与 body.reset 会重复消耗物理预算。
        this.enemies = this.add.group();

        // 创建碰撞层（墙壁/障碍物）
        this.walls = this.physics.add.staticGroup();

        // 视觉墙壁/树木组（2.5D 透视渲染）
        this.visualWalls = this.add.group();
        this.visualTrees = this.add.group();
        // 树木同步发生在下方 WallSystem._syncWallsToPhaser 内，注册表必须提前创建。
        this._staticSunShadows = new Map();
        this._structureSunShadows = new Map();
        this._nextStaticShadowRegistrationId = 1;
        this._structureShadowVisibilityRevision = 0;
        this._structureShadowRenderedVisibilityRevision = -1;

        // 同步墙壁到 Phaser（WallSystem.init() 在 PhaserGame.init() 之前调用，所以这里补同步）
        if (WallSystem.walls && WallSystem.walls.length > 0) {
            WallSystem._syncWallsToPhaser();
        }

        // Phase 3: 创建特效 Sprite Group
        this.runeSwordGroup = this.add.group();
        this.iceSpikeGroup = this.add.group();
        this.fireballSprite = null;

        // Phase 3 续：盾牌和飞行投射物
        this.shieldSprite = null;
        this.iceSpikeFlyGroup = this.add.group();
        this.fireballFlySprite = null;

        // 通用施法者特效精灵注册表（支持玩家与敌人）
        this._magicSprites = new Map();

        // 投射物精灵组
        this.projectilesGroup = this.add.group();

        // 掉落物精灵组（用于与墙壁正确透视排序）
        this.dropItemsGroup = this.add.group();

        // 世界空间特效组（攻击范围、枪口火焰等）
        this.worldEffectsGroup = this.add.group();
          // 平滑弧形刀光：挂在 worldEffectsGroup，地图模式统一隐藏
          this._swordArcTrail = new SwordArcTrail(this, (WeaponAnimConfig.sword && WeaponAnimConfig.sword.arc) || {});
        // 风车：复用当前装备贴图，将剑身按旋转相位分到人物前/后层。
        this._whirlwindWeaponDepth = new WhirlwindWeaponDepth(this);
        // 推击沿用风车验证过的前后景裁切器，但使用独立实例与横向枪身裁切。
        this._pushStrikeWeaponDepth = new WhirlwindWeaponDepth(this);
        // 风车脚底：只在玩家 footprint 上绘制白色旋风，不参与技能判定。
        this._whirlwindFootprintFx = new WhirlwindFootprintFx(
            this,
            WeaponAnimConfig.sword?.whirlwind?.footprintFx || {}
        );
        // 骑士长剑冲刺突击专属：多层白线从身后汇聚到当前剑尖。
        this._dashThrustConvergenceFx = new DashThrustConvergenceFx(
            this,
            WeaponAnimConfig.sword?.dashThrustConvergence || {}
        );
        // 环境色覆盖在世界之上、HUD 之下；scrollFactor(0) 坐标按当前 zoom 换算。
        this._ambientOverlay = this.add.rectangle(0, 0, 1, 1, 0x000000, 0);
        this._ambientOverlay.setOrigin(0, 0);
        this._ambientOverlay.setScrollFactor(0);
        this._ambientOverlay.setDepth(99990);
        this._fogMaskRenderer = new FogMaskRenderer(this, FogOfWarSystem);
        this._fogMinimapLayer = new FogMinimapLayer(this);
        this._fogDebugOverlay = new FogDebugOverlay(this);
        this._fogVisibilityController = new FogVisibilityController(
            this,
            FogOfWarSystem,
            FogVisualAdapter,
            (entity, hidden) => this._setFogEntityHidden(entity, hidden)
        );
        this._windblownSand = new WindblownSandSystem(this);
        this._rainWeather = new RainWeatherSystem(this);
        this._droughtHeat = new DroughtHeatSystem(this);
        this._world125Atmosphere = new World125AtmosphereSystem(this);
        this._mineWeather = new World126WeatherRuntime(this);
        this.events.once('shutdown', () => this._mineWeather?.reset(true));
        // 局部亮光：短时（枪火/爆发）与常驻（火把/蓄力火球）分开管理。
        this._transientEnvironmentGlows = [];
        this._persistentEnvironmentGlows = new Map();
        // 建筑与静态环境物共用一个地表 Graphics，移动单位仍使用独立接触影 Sprite。
        this._structureShadowLayer = this.add.graphics();
        this._structureShadowLayer.setDepth(WORLD_RENDER_LAYERS.STRUCTURE_SHADOW);
        this._structureShadowJobs = [];
        // 场景重启后新层为空画布：复位脏检查状态，首帧强制重画（防阴影不可见）。
        this._structureShadowJobCount = -1;
        this._structureShadowLayerOpacity = -1;
        this._structureShadowOpacitySignature = '';
        this._structureShadowEdgeFadeSignature = '';
        this._structureShadowViewportSignature = '';
        this._structureShadowRenderStats = {
            visibleJobs: 0,
            viewportCulled: 0,
            preGeometryCulled: 0,
            postGeometryCulled: 0,
            viewportPaddingPx: 0,
            clusters: 0,
            rawContourVertices: 0,
            contourVertices: 0,
            featherPaths: 0,
            triangles: 0,
            sourceVertices: 0,
            commandBufferLength: 0,
            rebuilds: 0,
            lastRebuildMs: 0,
            rebuildTotalMs: 0,
            rebuildPeakMs: 0,
            layerVisible: false,
        };
        // 世界 HUD：缓存每个贴图帧的可见 alpha 顶部，血条按真实模型而非透明画布定位。
        this._installShadowConsoleTools();

        // HUD：世界空间（血条/名字）与屏幕空间（准星/小地图）
        this.worldHudGraphics = this.add.graphics();
        this.worldHudGraphics.setDepth(100000);
        this.screenHudGraphics = this.add.graphics();
        this.screenHudGraphics.setDepth(100001);
        this.screenHudGraphics.setScrollFactor(0);
        // 碰撞体积可视化（点击左下角“范围”按钮后显示半透明红圈）
        this._collisionRadiusGraphics = null;
        this._elevatedNavigationRangeGraphics = null;
        this._elevatedNavigationRangeLabel = null;
        // 无专属 Phaser Sprite 的实体（训练靶/NPC）通用渲染容器
        this._neutralSprites = new Map();
        // 防御塔三层渲染（基座/机械臂/挂载武器）
        this._defenseSprites = new Map();

        // 可移动实体脚底阴影：按 groundRadius 绘制黑色圆影
        this._shadowSprites = new Map();
        this._ensureShadowTexture();
        this._environmentLightingUnsubscribe?.();
        this._environmentLightingUnsubscribe = EnvironmentLightingSystem.subscribeConfig(
            (config, changedKeys) => this._onEnvironmentLightingConfigChanged(config, changedKeys)
        );
        this.events.once('shutdown', () => {
            this._environmentLightingUnsubscribe?.();
            this._environmentLightingUnsubscribe = null;
        });

        // 小地图静态层（背景/边界/墙壁），只在墙壁或世界尺寸变化时重绘
        this._minimapStaticGraphics = this.add.graphics();
        this._minimapStaticGraphics.setDepth(99999);
        this._minimapStaticGraphics.setScrollFactor(0);
        this._minimapStaticKey = null;
        // 小地图动态层（实体/相机框/玩家箭头），独立 graphics + 矩形 mask 裁剪（防止画出小地图框外）
        this._minimapDynamicGraphics = this.add.graphics();
        this._minimapDynamicGraphics.setDepth(99999.5);
        this._minimapDynamicGraphics.setScrollFactor(0);
        this.minimapTitle = this.add.text(0, 0, '地图', {
            fontFamily: 'SimHei, "Microsoft YaHei", sans-serif',
            fontSize: '13px',
            color: '#d4c5a9cc'
        });
        this.minimapTitle.setDepth(100001);
        this.minimapTitle.setScrollFactor(0);
        this._entityHudTexts = new Map();
        this._hudReady = false;

        // 地形 Sprite（优先使用 Renderer.terrainTexture 覆盖，否则由 Phaser Graphics 直接生成）
        this._terrainSprite = null;
        this._terrainSource = null;
        this._terrainWorldWidth = 0;
        this._terrainWorldHeight = 0;
        this._mainHubBackdrop = null;
        this._mainHubBackdropKey = null;
        // 2048² 分块地板（世界-122 惰性加载）：key -> Phaser image；待烘焙队列
        this._terrainChunkSprites = new Map();
        this._terrainChunkQueue = [];

        // 地图模式状态缓存，避免每帧切换相机背景色
        this._mapModeActive = false;

        // X 光墙面透视总开关（2026-07-26 用户要求停用，代码保留；改 true 恢复）
        this._xrayEnabled = 'drops'; // false=全关 / true=全量 / 'drops'=仅掉落物（2026-07-31 定案）

        // 相机设置
        const viewW = CONFIG?.VIEW_WIDTH || window.innerWidth || 1920;
        const viewH = CONFIG?.VIEW_HEIGHT || window.innerHeight || 1080;
        this.cameras.main.setBounds(-CONFIG.WORLD_WIDTH, -CONFIG.WORLD_HEIGHT, CONFIG.WORLD_WIDTH * 3, CONFIG.WORLD_HEIGHT * 3);
        this.cameras.main.setZoom(1);
        this.cameras.main.setViewport(0, 0, viewW, viewH);
        this.cameras.main.setBackgroundColor('#000000');

        // 首启主神空间地形（砖地+边界墙）：必须在 Phaser 贴图就绪后烘焙，
        // 否则地板贴图未加载会回退网格（Game.init 直调会抢跑）
        if (SceneManager && SceneManager.currentScene === 'main' && typeof SceneManager._setupMainHubTerrain === 'function') {
            SceneManager._setupMainHubTerrain();
        }
        // 初始同步地形（后续由场景切换/战斗房生成主动调用 syncTerrain()）
        this.syncTerrain();
        this._syncMainHubBackdrop(false);

        // 预生成僵尸受击绿色粒子纹理
        this._ensureZombieHitTexture();

        // 事件监听：外部系统通知
        this.events.on('playerSpawn', this._onPlayerSpawn, this);
        this.events.on('enemySpawn', this._onEnemySpawn, this);

        // 启动 HUD 场景（屏幕空间 UI）
        this.scene.run('HudScene');
    }

    _attachPerformanceRenderSampling() {
        this.game?.events?.off('prerender', this._beginPerformanceRenderSample, this);
        this.game?.events?.off('postrender', this._endPerformanceRenderSample, this);
        this.game?.events?.on('prerender', this._beginPerformanceRenderSample, this);
        this.game?.events?.on('postrender', this._endPerformanceRenderSample, this);
        this.events.once('shutdown', this._detachPerformanceRenderSampling, this);
        this.events.once('destroy', this._detachPerformanceRenderSampling, this);
    }

    _detachPerformanceRenderSampling() {
        this.game?.events?.off('prerender', this._beginPerformanceRenderSample, this);
        this.game?.events?.off('postrender', this._endPerformanceRenderSample, this);
        this._performanceRenderStartedAt = null;
    }

    _beginPerformanceRenderSample() {
        this._performanceRenderStartedAt = PerformanceMonitor.begin();
    }

    _endPerformanceRenderSample() {
        if (this._performanceRenderStartedAt == null) return;
        PerformanceMonitor.end('phaserRenderSubmit', this._performanceRenderStartedAt);
        this._performanceRenderStartedAt = null;
    }

    update(_time, _delta) {
        let performancePhaseStartedAt = PerformanceMonitor.begin();
        // Phaser 自动调用，每帧更新
        // 现有 Game 循环仍然运行，这里只做 Phaser 相关的更新
        // 世界时间是跨场景统一时钟：地牢探险与观察切换期间也持续推进；只受游戏暂停控制。
        const worldClockRunning = Game?.isRunning && !Game._paused;
        const worldDelta = worldClockRunning ? _delta : 0;
        const worldTimeBefore = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
        EnvironmentLightingSystem.update(worldDelta);
        const worldTimeAfter = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
        const invasionDelta = Math.max(0, worldTimeAfter - worldTimeBefore);
        const currentWorldId = SceneManager.getCurrentWorldId();
        World122SandstormSystem.update(worldTimeAfter);
        World122DroughtSystem.update(worldTimeAfter);
        World125FogTideSystem.syncScene(currentWorldId);
        World125FogTideSystem.update(worldTimeAfter);
        World126WeatherSystem.update(worldTimeAfter);
        this._mineWeather?.update(invasionDelta);
        WorldWeatherSystem.update(worldTimeAfter);
        const rainState = WorldWeatherSystem.getVisualState(currentWorldId, worldTimeAfter);
        const droughtActive = !rainState.active
            && World122DroughtSystem.isActive(currentWorldId, worldTimeAfter);
        this._weatherVisualState = rainState;
        this._droughtVisualActive = droughtActive;
        EnvironmentLightingSystem.setRainLighting(rainState, GAME_CONFIG.weatherEffects?.rain);
        RoadsideDecorationSystem.updateDynamic({
            daylight: EnvironmentLightingSystem.getAmbient().daylight,
            rainState,
            worldTimeMs: worldTimeAfter,
            // 手铺道路建筑（perimeterTile:none）不会登记为道路 owner；传入完整实体集合，
            // 让街景正门净空与建筑周边接地痕迹仍能识别这些建筑。
            buildings: Game?.entities,
        });
        window.WorldInvasionSystem?.update?.(invasionDelta, currentWorldId);
        WorldDestructionChallengeSystem.update(worldTimeAfter, currentWorldId);
        RoadsideDecorationSystem.syncViewport(this.cameras?.main?.worldView || null);
        // 与后台 capturedGameTimeMs 同源；先结算旧战事窗口，再让入侵改变安全状态。
        Game.updateWorldEconomy(invasionDelta);
        PerformanceMonitor.end('phaserWorldSystems', performancePhaseStartedAt);
        performancePhaseStartedAt = PerformanceMonitor.begin();

        // 能源节点防叠图自愈（2026-08-16）：世界-122 每 ~1s 清一次同位置堆积节点
        // （旧会话/HMR/历史配置残留会叠出“门边一堆矿”，setup 清理覆盖不到已加载场景）
        if (SceneManager && SceneManager.currentScene === 'scene8' && EnergyNodeSystem) {
            this._nodeSweepTick = (this._nodeSweepTick || 0) + 1;
            if (this._nodeSweepTick % 60 === 0 && typeof EnergyNodeSystem.sweepStacked === 'function') {
                EnergyNodeSystem.sweepStacked();
            }
        }

        // 分块地板惰性烘焙/卸载（无 chunks 时立即返回，开销可忽略）
        this._updateTerrainChunks();

        // 地牢模式：隐藏角色及武器贴图
        const _game = window.Game;
        this._swordShieldMotion?.beginFrame();
        this._playerShieldRig?.beginFrame();
        this._refreshRenderViewport();
        FogOfWarSystem.update(SceneManager.getCurrentWorldId(), _game, Date.now());
        this._syncFogOfWar(_delta);
        PerformanceMonitor.end('phaserTerrainFog', performancePhaseStartedAt);
        performancePhaseStartedAt = PerformanceMonitor.begin();
        const _dms = DungeonMapSystem;
        const isMapMode = SceneManager.currentScene === 'scene7' && _dms && _dms.active && _dms.state === 'map';
        this._syncAmbientOverlay(isMapMode);
        this._syncMainHubBackdrop(isMapMode);
        if (isMapMode) {
            this._clearRenderScratchSets();
            // 地图模式下 Phaser 相机背景透明，露出下方 Canvas 绘制的路线地图
            if (!this._mapModeActive) {
                this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
                this._mapModeActive = true;
                // 地图选择界面：body 挂 map-mode 类统一隐藏快捷栏/顶部栏/操作提示（CSS 规则驱动，防覆盖遗漏）
                document.body.classList.add('map-mode');
            }
            if (this.playerSprite && this.playerSprite.visible) {
                this.playerSprite.setVisible(false);
                this.playerSprite.setActive(false);
            }
            if (this.playerHandSprite && this.playerHandSprite.visible) {
                this.playerHandSprite.setVisible(false);
                this.playerHandSprite.setActive(false);
            }
            if (this.weaponSprite && this.weaponSprite.visible) {
                this.weaponSprite.setVisible(false);
                this.weaponSprite.setActive(false);
            }
            this._whirlwindWeaponDepth?.clear(this.weaponSprite);
            this._pushStrikeWeaponDepth?.clear(this.weaponSprite);
            this._hideWeaponGhosts(); // 地图模式连带隐藏攻击残影
            if (this.offhandWeaponSprite && this.offhandWeaponSprite.visible) {
                this.offhandWeaponSprite.setVisible(false);
                this.offhandWeaponSprite.setActive(false);
            }
            // Phase 3: 场景六地图模式下隐藏特效
            this.runeSwordGroup.setVisible(false);
            this.iceSpikeGroup.setVisible(false);
            if (this.fireballSprite) this.fireballSprite.setVisible(false);
            // Phase 3 续：场景六地图模式下隐藏盾牌和飞行投射物
            if (this.shieldSprite) this.shieldSprite.setVisible(false);
            this._playerShieldRig?.clear();
            if (this.defenseGlow) this.defenseGlow.clear();
            this.iceSpikeFlyGroup.setVisible(false);
            if (this.fireballFlySprite) this.fireballFlySprite.setVisible(false);
            if (this.droneSprite) this.droneSprite.setVisible(false);
            if (this.droneRangeGraphics) this.droneRangeGraphics.clear();
            if (this.droneMarkRangeGraphics) this.droneMarkRangeGraphics.clear();
            if (this.droneText) this.droneText.setVisible(false);
            if (this._collisionRadiusGraphics) this._collisionRadiusGraphics.clear();
            // 地图模式下隐藏 2.5D 墙壁/树木与地形
            if (this.visualWalls) this.visualWalls.setVisible(false);
            if (this.visualTrees) this.visualTrees.setVisible(false);
            if (this._terrainSprite) this._terrainSprite.setVisible(false);
            if (this.projectilesGroup) this.projectilesGroup.setVisible(false);
            if (this.dropItemsGroup) this.dropItemsGroup.setVisible(false);
            if (this.worldEffectsGroup) this.worldEffectsGroup.setVisible(false);
            // 地图模式下隐藏 HUD
            if (this.worldHudGraphics) this.worldHudGraphics.setVisible(false);
            if (this.screenHudGraphics) this.screenHudGraphics.setVisible(false);
            this._setMinimapLayersVisible(false);
            for (const roleTexts of this._entityHudTexts.values()) {
                roleTexts.forEach((text) => text.setVisible(false));
            }
            // 地图模式下隐藏敌人/中立实体/其他施法者特效，避免战斗残留覆盖地图
            if (this.enemies) this.enemies.setVisible(false);
            // X 光透视对象不属于任何显示组，必须显式隐藏——否则战斗结束后
            // 透视圈/实体克隆（如墙后金币）残留在地图选择界面上
            if (this._xrayMap) {
                for (const [, cur] of this._xrayMap) {
                    for (const k of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone', 'shieldUpperClone', 'shieldForearmClone', 'swordShieldHandClone']) {
                        if (cur[k]) cur[k].setVisible(false);
                    }
                }
            }
            if (this._neutralSprites) {
                for (const data of this._neutralSprites.values()) {
                    if (Array.isArray(data.segmentSprites)) {
                        data.segmentSprites.forEach((sprite) => sprite?.setVisible(false));
                    }
                    if (data.groundContactSprite) data.groundContactSprite.setVisible(false);
                    if (data.overlaySprite) data.overlaySprite.setVisible(false);
                    if (data.foregroundSprite) data.foregroundSprite.setVisible(false);
                    if (data.workingEffectGraphics) data.workingEffectGraphics.setVisible(false);
                    if (data.staffingWarningGraphics) data.staffingWarningGraphics.setVisible(false);
                    if (data.battlementRuneSprite) data.battlementRuneSprite.setVisible(false);
                    if (data.sprite) data.sprite.setVisible(false);
                    if (data.label) data.label.setVisible(false);
                }
            }
            if (this._magicSprites) {
                for (const sprites of this._magicSprites.values()) {
                    if (sprites.iceSpikes) sprites.iceSpikes.forEach(s => s.setVisible(false));
                    if (sprites.iceSpikeFly) sprites.iceSpikeFly.forEach(s => s.setVisible(false));
                    if (sprites.fireball) sprites.fireball.setVisible(false);
                    if (sprites.fireballFly) sprites.fireballFly.setVisible(false);
                }
            }
        } else {
            // 非地图模式保持纯黑背景
            if (this._mapModeActive) {
                this.cameras.main.setBackgroundColor('#000000');
                this._mapModeActive = false;
                // 恢复快捷栏与操作提示栏（移除 map-mode 类）
                document.body.classList.remove('map-mode');
            }
            // 火柴人模式：保持 Phaser sprite 隐藏，由 Canvas 绘制火柴人
            const _isStickFigure = _game && _game.player && _game.player._stickFigure;
            if (this.playerSprite && _game && _game.player && !this.playerSprite.visible && !_isStickFigure) {
                this.playerSprite.setVisible(true);
                this.playerSprite.setActive(true);
            }
            // 武器/副手贴图：地图模式曾 setActive(false)，在此统一恢复 active
            // （可见性仍由 syncWeapon 控制；枪口计算 _getMuzzleWorldPosition 依赖 active 标志）
            if (this.weaponSprite && !this.weaponSprite.active) this.weaponSprite.setActive(true);
            if (this.offhandWeaponSprite && !this.offhandWeaponSprite.active) this.offhandWeaponSprite.setActive(true);
            if (this.playerHandSprite && !this.playerHandSprite.active) this.playerHandSprite.setActive(true);
            // 武器 Sprite 的可见性由 syncWeapon 控制，不在 update 中强制显示
            // 避免覆盖 syncWeapon 的隐藏逻辑（如武器切换为空时）
            // 恢复 2.5D 墙壁/树木与地形显示
            if (this.visualWalls) this.visualWalls.setVisible(true);
            if (this.visualTrees) this.visualTrees.setVisible(true);
            if (this._terrainSprite) this._terrainSprite.setVisible(true);
            if (this.projectilesGroup) this.projectilesGroup.setVisible(true);
            if (this.dropItemsGroup) this.dropItemsGroup.setVisible(true);
            if (this.worldEffectsGroup) this.worldEffectsGroup.setVisible(true);
            // 恢复敌人/中立实体/其他施法者特效显示
            if (this.enemies) this.enemies.setVisible(true);
            if (this._neutralSprites) {
                for (const data of this._neutralSprites.values()) {
                    if (Array.isArray(data.segmentSprites)) {
                        data.segmentSprites.forEach((sprite) => sprite?.setVisible(true));
                    }
                    if (data.groundContactSprite) data.groundContactSprite.setVisible(true);
                    if (data.overlaySprite) data.overlaySprite.setVisible(true);
                    if (data.foregroundSprite) data.foregroundSprite.setVisible(true);
                    if (data.workingEffectGraphics) {
                        data.workingEffectGraphics.setVisible(data.workingEffectVisible === true);
                    }
                    if (data.staffingWarningGraphics) {
                        data.staffingWarningGraphics.setVisible(data.staffingWarningVisible === true);
                    }
                    if (data.battlementRuneSprite) {
                        data.battlementRuneSprite.setVisible(data.battlementRuneVisible === true);
                    }
                    if (data.sprite) data.sprite.setVisible(true);
                    if (data.label) data.label.setVisible(true);
                }
            }
            if (this._magicSprites) {
                for (const sprites of this._magicSprites.values()) {
                    if (sprites.iceSpikes) sprites.iceSpikes.forEach(s => s.setVisible(true));
                    if (sprites.iceSpikeFly) sprites.iceSpikeFly.forEach(s => s.setVisible(true));
                    if (sprites.fireball) sprites.fireball.setVisible(true);
                    if (sprites.fireballFly) sprites.fireballFly.setVisible(true);
                }
            }
            // 恢复并同步 HUD（NPC 对话界面打开时隐藏左上角小地图）
            const _dialogueOpen = !!(typeof window !== 'undefined' && window.NPCDialogue && window.NPCDialogue._active);
            if (this.worldHudGraphics) this.worldHudGraphics.setVisible(true);
            if (this.screenHudGraphics) this.screenHudGraphics.setVisible(true);
            if (this._minimapStaticGraphics) this._minimapStaticGraphics.setVisible(!_dialogueOpen);
            if (this._minimapDynamicGraphics) this._minimapDynamicGraphics.setVisible(!_dialogueOpen);
            // GameScene 跨逻辑场景常驻，位面迷雾小地图 Image 也会保留上一场景纹理。
            // 返回无迷雾的主神空间后，不能仅按 HUD 状态重新点亮该旧 Image；否则它会在
            // 每帧 HUD 恢复与 100ms 小地图同步隐藏之间反复显隐，形成黑图频闪。
            const _fogGridActive = !!FogOfWarSystem.getGrid(SceneManager.getCurrentWorldId())?.active;
            this._fogMinimapLayer?.setVisible(!_dialogueOpen && _fogGridActive);
            if (this.minimapTitle) this.minimapTitle.setVisible(!_dialogueOpen);
            this._setMinimapLayersVisible(
                !_dialogueOpen && this._isMinimapVisibleForCurrentMode()
            );
            this._syncHud(_game);
            this._updateBossHpBar(_delta);
            this._syncHitFlashAndCharge(_game);
            this._syncNeutralEntities(_game);
            // 新手目标圈依赖中立 NPC 本帧最终位置与动画帧可见范围；必须在 NPC 同步后绘制，
            // 否则移动中的小鼠大王会产生一帧滞后，圆圈也只能拿到上一帧贴图边界。
            this._syncFirstExpeditionMarker(_game, this.worldHudGraphics);
            // 防御塔三层渲染（基座 + 旋转机械臂 + 挂载武器）
            this._syncDefenseTowers(_game);
            // 完整建筑贴图按 footprint 拓扑排序；墙/门/建筑共享同一稳定顺序。
            this._syncStructureRenderOrder(_game);
            // 双槽符文必须等主体均已创建且最终结构深度已落定后再同步。
            this._syncWallBattlementRuneOverlays();
            this._syncBuildingDamageFx(_game);
            // Phase 3: 同步特效 Sprite
            if (_game && _game.player) {
                this._syncRuneSwords(_game.player);
                this._syncIceSpikes(_game.player);
                this._syncFireball(_game.player);
                // 飞行投射物；盾牌在身体/手臂本帧变换落定后同步。
                this._syncFlyingIceSpikes(_game.player);
                this._syncFlyingFireball(_game.player);
                // Phase 续：同步无人机
                this._syncDrone(_game.player);
                // Phase 续：同步冰墙
                this._syncIceWalls(_game.player);

                // 同步其他施法者（如僵尸巫师）的冰锥/火球特效
                this._syncOtherMagicCasters(_game);
                // 近战定格到期必须在武器参数快照前推进到 recover：人物与武器才能在
                // 同一渲染帧从攻击末帧开始收势。这里只推进精确命中的近战 hold，
                // 不改动枪械依赖的全局动画更新顺序。
                this._advanceExpiredMeleeHoldBeforeWeaponSync(_game);
                // 同步主手/副手武器 Sprite（传入后坐力/抖动参数）
                const mainParams = { ..._game.player._getWeaponAnimParams(), state: _game.player.weaponAnim.state, timer: _game.player.weaponAnim.timer, isAttacking: _game.player.weaponAnim.isAttacking };
                const offParams = { ..._game.player._getOffhandWeaponAnimParams(), state: _game.player.offhandWeaponAnim.state, timer: _game.player.offhandWeaponAnim.timer, isAttacking: _game.player.offhandWeaponAnim.isAttacking };
                this.syncWeapon(_game.player, mainParams);
                this.syncOffhandWeapon(_game.player, offParams);
                // 闪避期间隐藏主手/副手武器贴图（syncWeapon 每帧重设可见性，此处统一覆盖；
                // 闪避结束 isDodging=false 后由 syncWeapon 自动恢复，无需显式还原）
                if (_game.player.isDodging) {
                    if (this.weaponSprite) this.weaponSprite.setVisible(false);
                    if (this.offhandWeaponSprite) this.offhandWeaponSprite.setVisible(false);
                    this._whirlwindWeaponDepth?.clear(this.weaponSprite);
                }
            }
        }

        // 同步玩家精灵图动画状态
        this._updatePlayerAnimation(_game);
        // 持枪瞄准：上半身分层扭转（无扭转姿态时内部自动跳过）
        this._syncGunTwist(_game.player);
        // 手臂条层：肩关节随扭转，旋转追随枪握把（无配置时内部自动跳过）
        this._syncGunArm();

        // 先同步 Sprite/物理体位置，再更新相机，避免贴图比相机慢一帧导致抖动
        this._syncBodiesToPhysics();
        if (_game?.player) this._syncSwordShieldMotion(_game.player);
        if (_game?.player) this._syncShield(_game.player, worldDelta);
        if (_game?.player) this._swordShieldMotion?.syncIdleGrip(_game.player);
        // 侍从跟随渲染（露娜等有动作素材的队员：跟随玩家播 walk/run/spell）
        this._syncCompanionSprites(_game, _delta);
        // 侍从普通攻击光球渲染（蓝色光球，CompanionAI 推进）
        this._syncCompanionBasics(_game);
        // 同步可移动实体脚底阴影（原在此处，2026-08-15 移到 _updateDynamicDepths 之后）
        // 调试范围圈与阴影使用同一脚底坐标，避免错位
        this._syncCollisionRadii(_game);
        // Phase 4: 根据世界 Y 坐标统一动态实体深度
        this._updateDynamicDepths();
        // 光柱在武器最终遮挡深度确定后再同步剑尖与图层，
        // 避免先读到上一帧 depth，导致发射光团偶发被武器末端压住。
        if (_game?.player?._specialAttackActive) {
            this._syncNightFlameBeamOrigin(_game.player);
        }
        // 符文长剑粒子必须消费本帧最终 weaponSprite 变换与遮挡深度，避免攻击、冲刺、
        // recover、背负或左右镜像时仍按玩家逻辑坐标估算而脱离剑身。
        this._syncRuneWeaponEffect(_game?.player, _delta);
        // 所有单位附着层必须读取本帧最终仲裁 depth，不能在单位跨建筑前缘前预写上一帧深度。
        // 同步眩晕双星特效（眩晕持续时间内播放，结束消失）
        this._syncStunEffects(_game);
        // 同步冻结冰块特效（冻结持续时间内覆盖目标，结束消失）
        this._syncFreezeEffects(_game);
        // 石化在所有动画同步之后锁定当前帧并转为黑白，解除时原帧继续。
        this._syncPetrifyEffects(_game);
        // 同步激励 buff 白色环绕光晕（持续时间内跟随目标，结束消失）
        this._syncInspireEffects(_game);
        // 无人机战术锁定框读取本帧目标最终位置/深度，并受实时迷雾可见性约束。
        this._syncDroneTargetLocks(_game);
        // 玩家受击附着层必须在位置与动态深度更新后同步，避免移动时慢一帧或穿过遮挡层。
        this._syncPlayerAttachedHitFx(_game, _delta);
        // 红狼王变身红黑弥漫粒子必须在动态深度之后同步，才能继承本体本帧的墙体遮挡仲裁。
        this._syncRedWolfTransformEffects(_game);
        // 飞扑手爪烟雾读取本帧最终 Sprite，避免逻辑脚点/上一帧姿态造成错位。
        this._syncRedWolfPounceSmoke(_game);
        // 工头鞭层读取本帧最终人体脚点、镜像与遮挡深度。
        if (!this._foremanWhips) this._foremanWhips = new ForemanWhipVisuals(this);
        this._foremanWhips.sync(_game);
        if (this._whirlwindFootprintFx) {
            const whirlwindPlayer = _game?.player;
            this._whirlwindFootprintFx.update(_delta, {
                player: whirlwindPlayer,
                active: whirlwindPlayer?._isWhirlwind === true && !whirlwindPlayer?.isDodging,
                elapsed: whirlwindPlayer?._whirlwindTimer || 0,
                duration: whirlwindPlayer?._whirlwindDuration || 800,
                mapMode: this._mapModeActive,
                visible: this.playerSprite?.visible !== false,
                depth: this.playerSprite?.depth != null
                    ? this.playerSprite.depth - 0.25
                    : (whirlwindPlayer?.y || 0) - 0.25,
                playerDepth: this.playerSprite?.depth,
                weaponBackDepth: this._whirlwindWeaponDepth?.backSprite?.depth,
            });
        }
          // 弧形刀光放在剑贴图上一层，保证世界-122 等遮挡/亮色场景也可见
          if (this._swordArcTrail) {
              this._swordArcTrail.update(_delta, this.weaponSprite ? this.weaponSprite.depth + 1 : 0);
          }
        if (this._dashThrustConvergenceFx) {
            const dashPlayer = _game?.player;
            const dashTotalMs = Math.max(1, Number(dashPlayer?._dashTotalMs) || 600);
            this._dashThrustConvergenceFx.update(_delta, {
                active: dashPlayer?._isDashing === true
                    && dashPlayer?._dashVisualStyle === 'thrust',
                progress: Math.max(0, Math.min(1,
                    (Number(dashPlayer?._dashTimer) || 0) / dashTotalMs)),
                weaponSprite: this.weaponSprite,
                mapMode: this._mapModeActive,
                depth: this.weaponSprite?.depth != null
                    ? this.weaponSprite.depth - 0.01
                    : this.playerSprite?.depth || 0,
            });
        }
        PerformanceMonitor.end('phaserEntityVisuals', performancePhaseStartedAt);
        performancePhaseStartedAt = PerformanceMonitor.begin();
        // 同步可移动实体脚底阴影（必须在 _updateDynamicDepths 之后：阴影深度 =
        // 贴图当前帧仲裁后深度 − 0.1，保证贴图永远在阴影之上、任何情况下阴影
        // 都不能盖住贴图。2026-08-15 修复：旧顺序阴影先跑、读上一帧贴图深度，
        // 怪物跨过掩体/墙面线深度骤降时阴影会以旧深度盖在贴图上 1 帧——
        // 世界-122 毒蛆大椭圆阴影在基地掩体线反复压住虫身的根因；所有怪物适用）
        this._syncEntityShadows(_game);
        this._sunShadowSyncTimer = (this._sunShadowSyncTimer ?? 80) + _delta;
        const periodicShadowSync = this._sunShadowSyncTimer >= 80;
        const towerShadowDirty = this._dynamicTowerShadowDirty === true;
        if (periodicShadowSync || towerShadowDirty) {
            // 太阳角度和静态建筑拓扑不会按 60Hz 发生可见变化；12.5Hz 足够平滑，
            // 同时避免每帧创建阴影任务、Set、签名及触发聚类检查。炮臂帧角变化则
            // 立即失效一次共享层，防止 80ms 节流让炮臂阴影落后于已显示的量化帧。
            if (periodicShadowSync) this._sunShadowSyncTimer %= 80;
            this._dynamicTowerShadowDirty = false;
            this._syncStructureSunShadows(_game);
            this._syncStaticSunShadows();
        }
        this._syncEnvironmentGlows(_delta, isMapMode);
        // X 光圆圈：被墙壁遮挡的实体以黑渐变圆圈透视显示
        this._syncXRayCircles(_game);
        // 要塞式压平视图最后接管建筑显示，避免前面的常规同步在同帧重新显示立面。
        // 这里只改 Phaser 可见性/占地投影，不改实体、碰撞、寻路或高度语义。
        FlatViewSystem.sync(this, _game, WallSystem);
        if (!isMapMode) this._applyViewportEntityVisibility(_game);
        this._applyFogEntityVisibility(_game);
        this._enforceDisabledShadowVisibility();
        // 雾可见性同步可能恢复此前隐藏的对象；压平态最后统一关闭建筑装饰层
        // （风车旋转层及后续共用 overlay/workingEffect 的建筑特效）。
        FlatViewSystem.suppressBuildingEffects(this, _game);
        this._syncFogDebug();
        this._updateCamera();
        PerformanceMonitor.end('phaserShadowsVisibility', performancePhaseStartedAt);
        performancePhaseStartedAt = PerformanceMonitor.begin();
        // 环境效果直接读取配置真源；SceneManager.scenes 是 init 时快照，开发期 JSON 热更新后
        // 可能仍是不含新增 environmentEffects 的旧对象，导致系统每帧判定为未启用。
        const currentSceneConfig = GAME_CONFIG.scenes?.[SceneManager.currentScene]
            || SceneManager.scenes?.[SceneManager.currentScene];
        this._rainWeather?.update({
            sceneId: SceneManager.currentScene,
            sceneConfig: currentSceneConfig,
            config: GAME_CONFIG.weatherEffects?.rain,
            requestedIntensityId: rainState.active ? rainState.intensityId : null,
            deltaMs: worldDelta,
            running: worldClockRunning,
            loading: SceneManager.isLoading,
        });
        this._droughtHeat?.update({
            active: droughtActive,
            config: World122DroughtSystem.getVisualConfig(),
            deltaMs: worldDelta,
            running: worldClockRunning,
            loading: SceneManager.isLoading,
            mapMode: isMapMode,
        });
        this._windblownSand?.update({
            sceneId: SceneManager.currentScene,
            sceneConfig: currentSceneConfig,
            deltaMs: worldDelta,
            running: worldClockRunning,
            loading: SceneManager.isLoading,
            daylight: EnvironmentLightingSystem.getSun()?.daylight ?? 1,
            sandstormActive: World122SandstormSystem.isActive(SceneManager.currentScene),
        });
        PerformanceMonitor.end('phaserWeather', performancePhaseStartedAt);
        performancePhaseStartedAt = PerformanceMonitor.begin();
        World125FogTideSystem.syncPlayerShelter(
            _game?.entities?.get?.('player') === _game?.player ? _game.player : null,
            SceneManager.currentScene
        );
        this._world125Atmosphere?.update({
            sceneId: SceneManager.currentScene,
            sceneConfig: currentSceneConfig,
            deltaMs: worldDelta,
            running: worldClockRunning,
            loading: SceneManager.isLoading,
            fogTideActive: World125FogTideSystem.isActive(SceneManager.currentScene),
        });
        this._performanceCounterTimer = (this._performanceCounterTimer ?? 500) + _delta;
        if (this._performanceCounterTimer >= 500) {
            this._performanceCounterTimer %= 500;
            this._syncPerformanceDebugCounters(currentSceneConfig, rainState);
        }
        PerformanceMonitor.end('phaserWorldAtmosphere', performancePhaseStartedAt);
    }

    _syncFogOfWar(deltaMs = 16.67) {
        const sceneId = SceneManager.getCurrentWorldId();
        const grid = FogOfWarSystem.getGrid(sceneId);
        this._fogMaskRenderer.update(sceneId, grid, deltaMs);
        if (!grid?.active) this._fogMinimapLayer.setVisible(false);
    }

    syncFogVisualEffect(effect, descriptor = null) {
        FogVisualAdapter.register(effect, descriptor);
        return FogVisualAdapter.syncEffect(effect, SceneManager.getCurrentWorldId(), FogOfWarSystem);
    }

    isFogPointVisible(x, y) {
        const sceneId = SceneManager.getCurrentWorldId();
        return !FogOfWarSystem.isEnabled(sceneId) || FogOfWarSystem.isPointVisible(sceneId, x, y);
    }

    getWorld125AtmosphereDebugModel() {
        const sceneId = SceneManager.getCurrentWorldId();
        const runtimeSceneId = SceneManager.currentScene;
        const sceneConfig = GAME_CONFIG.scenes?.scene11 || SceneManager.scenes?.scene11;
        const atmosphereConfig = sceneConfig?.environmentEffects?.dungeonAtmosphere;
        const gameplayModel = World125FogTideSystem.getDebugModel(sceneId);
        const visualModel = this._world125Atmosphere?.getFogTideVisualModel(atmosphereConfig) || {
            enabled: false,
            visualModeActive: false,
            targetSceneId: 'scene11',
            gameplayAffects: false,
        };
        return {
            ...gameplayModel,
            visualModeActive: visualModel.visualModeActive,
            available: runtimeSceneId === 'scene11' && !SceneManager.isLoading,
            currentSceneId: sceneId,
        };
    }

    toggleWorld125FogTide() {
        const current = this.getWorld125AtmosphereDebugModel();
        if (!current.available) {
            return { ok: false, reason: '请先进入世界-125·地牢遗迹', model: current };
        }
        const result = World125FogTideSystem.debugToggle(SceneManager.getCurrentWorldId());
        return { ...result, model: this.getWorld125AtmosphereDebugModel() };
    }

    getRainWeatherDebugModel(sceneId = SceneManager.getCurrentWorldId()) {
        const runtimeSceneId = WorldProgressionSystem.getRuntimeSceneId(sceneId);
        const sceneConfig = GAME_CONFIG.scenes?.[runtimeSceneId]
            || SceneManager.scenes?.[runtimeSceneId]
            || null;
        const visual = this._rainWeather?.getDebugModel(
            runtimeSceneId,
            SceneManager.currentScene,
            SceneManager.isLoading,
            GAME_CONFIG.weatherEffects?.rain,
            sceneConfig
        ) || {
            sceneId,
            enabled: false,
            active: false,
            available: false,
            visualOnly: true,
        };
        return {
            ...visual,
            ...WorldWeatherSystem.getDebugModel(
                sceneId,
                SceneManager.getCurrentWorldId(),
                SceneManager.isLoading
            ),
        };
    }

    toggleRainWeather(sceneId = SceneManager.getCurrentWorldId(), intensityId = null) {
        return WorldWeatherSystem.debugToggle(sceneId, intensityId, {
            currentSceneId: SceneManager.getCurrentWorldId(),
            loading: SceneManager.isLoading,
        });
    }

    setFogDebugOptions(options = {}) {
        const next = this._fogDebugOverlay.setOptions(options);
        if (Object.prototype.hasOwnProperty.call(options, 'maskVisible')) {
            this._fogMaskRenderer.setVisible(options.maskVisible !== false);
        }
        return next;
    }

    getFogDebugModel() {
        const sceneId = SceneManager.getCurrentWorldId();
        const model = FogOfWarSystem.getDebugModel(sceneId);
        if (!model) return null;
        return {
            ...model,
            render: {
                durationMs: this._fogMaskRenderer.lastRenderMs,
                changedCells: this._fogMaskRenderer.lastChangedCells,
                maskVisible: this._fogMaskRenderer.enabled,
            },
            effects: FogVisualAdapter.getDebugModel(),
            visibility: this._fogVisibilityController.getDebugModel(),
            options: { ...this._fogDebugOverlay.options },
        };
    }

    _getPerformanceRuntimeProfile() {
        if (this._performanceRuntimeProfile) return this._performanceRuntimeProfile;
        const renderer = this.game?.renderer;
        const gl = renderer?.gl;
        let gpuRenderer = '';
        let gpuVendor = '';
        if (gl) {
            try {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                gpuRenderer = String(gl.getParameter(
                    debugInfo?.UNMASKED_RENDERER_WEBGL || gl.RENDERER
                ) || '');
                gpuVendor = String(gl.getParameter(
                    debugInfo?.UNMASKED_VENDOR_WEBGL || gl.VENDOR
                ) || '');
            } catch (_error) {
                // 某些浏览器隐私策略禁止读取调试扩展；保留空值即可。
            }
        }
        const runtimeNavigator = globalThis.navigator;
        this._performanceRuntimeProfile = {
            renderer: gl ? 'WebGL' : 'Canvas',
            gpuRenderer,
            gpuVendor,
            hardwareConcurrency: Number(runtimeNavigator?.hardwareConcurrency) || 0,
            deviceMemoryGb: Number(runtimeNavigator?.deviceMemory) || 0,
            userAgent: runtimeNavigator?.userAgent || '',
        };
        return this._performanceRuntimeProfile;
    }

    _syncPerformanceDebugCounters(sceneConfig, rainState) {
        const sceneId = SceneManager.currentScene;
        const renderer = this.game?.renderer;
        const canvas = this.game?.canvas;
        const camera = this.cameras?.main;
        const displayList = this.children?.list || [];
        const runtime = this._getPerformanceRuntimeProfile();
        const rain = this._rainWeather;
        const sand = this._windblownSand;
        const fogGrid = FogOfWarSystem.getGrid(SceneManager.getCurrentWorldId());
        const fogEffectStats = FogVisualAdapter.getDebugModel();
        const countAlive = (emitter) => Number(emitter?.getAliveParticleCount?.()) || 0;
        // 低频采样点顺便收敛已死亡/已淘汰兵种的资源引用；只看逻辑实体与生产 pin，
        // 不改变单位模拟，也不在逐帧热路径额外创建扫描任务。
        RuntimeAssetManager.commitFriendlyEntities(Game.friendlyUnits);
        RuntimeAssetManager.commitEnemyEntities(Game.entities?.values?.() || []);
        RuntimeAssetManager.commitBuildingEntities(Game.entities?.values?.() || []);

        PerformanceMonitor.setCounter('scene.id', sceneId || 'unknown');
        PerformanceMonitor.setCounter('scene.name', sceneConfig?.name || sceneId || 'unknown');
        PerformanceMonitor.setCounter('scene.type', sceneConfig?.type || 'world');
        PerformanceMonitor.setCounter('scene.loading', SceneManager.isLoading ? 1 : 0);
        PerformanceMonitor.setCounter('sampling.rawDtCapMs', Number(GAME_CONFIG.gameLoop?.maxDtMs) || 100);
        PerformanceMonitor.setCounter('sampling.uiUpdateIntervalMs', Number(GAME_CONFIG.gameLoop?.uiUpdateIntervalMs) || 100);
        PerformanceMonitor.setCounter('runtime.renderer', runtime.renderer);
        PerformanceMonitor.setCounter('runtime.gpuRenderer', runtime.gpuRenderer || 'unavailable');
        PerformanceMonitor.setCounter('runtime.gpuVendor', runtime.gpuVendor || 'unavailable');
        PerformanceMonitor.setCounter('runtime.hardwareConcurrency', runtime.hardwareConcurrency);
        PerformanceMonitor.setCounter('runtime.deviceMemoryGb', runtime.deviceMemoryGb || 'unavailable');
        PerformanceMonitor.setCounter('runtime.devicePixelRatio', globalThis.devicePixelRatio || 1);
        PerformanceMonitor.setCounter('runtime.userAgent', runtime.userAgent);
        const assetStats = RuntimeAssetManager.getStats();
        PerformanceMonitor.setCounter('assets.residentFriendlyUnits', assetStats.residentFriendlyUnits);
        PerformanceMonitor.setCounter('assets.currentFriendlyUnits', assetStats.currentFriendlyUnits);
        PerformanceMonitor.setCounter('assets.residentEnemyTextures', assetStats.residentEnemyTextures);
        PerformanceMonitor.setCounter('assets.deferredEnemyTextures', assetStats.deferredEnemyTextures);
        PerformanceMonitor.setCounter('assets.currentEnemyFamilies', assetStats.currentEnemyFamilies);
        PerformanceMonitor.setCounter('assets.residentBuildingTextures', assetStats.residentBuildingTextures);
        PerformanceMonitor.setCounter('assets.currentBuildingTextures', assetStats.currentBuildingTextures);
        PerformanceMonitor.setCounter('assets.previewBuildingTextures', assetStats.previewBuildingTextures);
        PerformanceMonitor.setCounter('assets.deferredBuildingTextures', assetStats.deferredBuildingTextures);
        PerformanceMonitor.setCounter('assets.estimatedGpuMiB', assetStats.estimatedGpuMiB);
        PerformanceMonitor.setCounter('assets.safeMode', assetStats.safeMode ? 1 : 0);
        PerformanceMonitor.setCounter('assets.contextLost', assetStats.contextLost ? 1 : 0);
        PerformanceMonitor.setCounter('assets.maxParallelDownloads', assetStats.maxParallelDownloads);
        PerformanceMonitor.setCounter('assets.pendingRequests', assetStats.pendingAssetRequests);
        PerformanceMonitor.setCounter('assets.pendingMiB', assetStats.pendingAssetMiB);
        PerformanceMonitor.setCounter('assets.uploadingMiB', assetStats.uploadingAssetMiB);
        PerformanceMonitor.setCounter('assets.networkBlocked', assetStats.networkBlocked ? 1 : 0);
        PerformanceMonitor.setCounter('assets.networkBackoffMs', assetStats.networkBackoffMs);
        PerformanceMonitor.setCounter('render.canvasWidth', Number(canvas?.width) || 0);
        PerformanceMonitor.setCounter('render.canvasHeight', Number(canvas?.height) || 0);
        PerformanceMonitor.setCounter('render.scaleWidth', Number(this.scale?.width) || 0);
        PerformanceMonitor.setCounter('render.scaleHeight', Number(this.scale?.height) || 0);
        PerformanceMonitor.setCounter('render.cameraZoom', Number(camera?.zoom) || 1);
        PerformanceMonitor.setCounter('render.gameObjectsTotal', displayList.length);
        PerformanceMonitor.setCounter('render.gameObjectsVisible', displayList.filter((item) => (
            item?.active !== false && item?.visible !== false
        )).length);
        PerformanceMonitor.setCounter('render.visualWalls', this.visualWalls?.getLength?.() || 0);
        PerformanceMonitor.setCounter('render.visualTrees', this.visualTrees?.getLength?.() || 0);
        PerformanceMonitor.setCounter('render.terrainChunks', this._terrainChunkSprites?.size || 0);
        const roadsideStats = RoadsideDecorationSystem.getStats();
        PerformanceMonitor.setCounter('roadside.roadCells', Number(roadsideStats.roadCells) || 0);
        PerformanceMonitor.setCounter('roadside.lastDirtyCells', Number(roadsideStats.lastDirtyCells) || 0);
        PerformanceMonitor.setCounter('roadside.buildingCandidates', Number(roadsideStats.buildingCandidates) || 0);
        PerformanceMonitor.setCounter('roadside.chunks', Number(roadsideStats.chunks) || 0);
        PerformanceMonitor.setCounter('roadside.visibleChunks', Number(roadsideStats.visibleChunks) || 0);
        PerformanceMonitor.setCounter('roadside.candidateSpecs', Number(roadsideStats.candidateSpecs) || 0);
        PerformanceMonitor.setCounter('roadside.activeSprites', Number(roadsideStats.activeSprites) || 0);
        PerformanceMonitor.setCounter('roadside.activeFootSprites', Number(roadsideStats.activeFootSprites) || 0);
        PerformanceMonitor.setCounter('roadside.activeGroundSprites', Number(roadsideStats.activeGroundSprites) || 0);
        PerformanceMonitor.setCounter('roadside.pooledSprites', Number(roadsideStats.pooledSprites) || 0);
        PerformanceMonitor.setCounter('roadside.fullRebuilds', Number(roadsideStats.fullRebuilds) || 0);
        PerformanceMonitor.setCounter('roadside.partialRebuilds', Number(roadsideStats.partialRebuilds) || 0);
        PerformanceMonitor.setCounter('roadside.rebuildCount', Number(roadsideStats.rebuildCount) || 0);
        PerformanceMonitor.setCounter('roadside.lastRebuildMs', Number(roadsideStats.lastRebuildMs) || 0);
        PerformanceMonitor.setCounter('roadside.lastIndexMs', Number(roadsideStats.lastIndexMs) || 0);
        PerformanceMonitor.setCounter('roadside.lastSpecBuildMs', Number(roadsideStats.lastSpecBuildMs) || 0);
        PerformanceMonitor.setCounter('roadside.lastChunkBuildMs', Number(roadsideStats.lastChunkBuildMs) || 0);
        PerformanceMonitor.setCounter('roadside.lastViewportSyncMs', Number(roadsideStats.lastViewportSyncMs) || 0);
        PerformanceMonitor.setCounter('roadside.totalRebuildMs', Number(roadsideStats.totalRebuildMs) || 0);
        PerformanceMonitor.setCounter('roadside.maxRebuildMs', Number(roadsideStats.maxRebuildMs) || 0);
        PerformanceMonitor.setCounter('roadside.budgetCulled', Number(roadsideStats.budgetCulled) || 0);
        PerformanceMonitor.setCounter('roadside.visibleBudgetCulled', Number(roadsideStats.visibleBudgetCulled) || 0);
        PerformanceMonitor.setCounter('roadside.depthWrites', Number(roadsideStats.depthWrites) || 0);
        PerformanceMonitor.setCounter('roadside.depthSkips', Number(roadsideStats.depthSkips) || 0);
        PerformanceMonitor.setCounter('roadside.groundBatchMode', roadsideStats.groundBatchMode || 'sprites');
        const viewportCacheStats = this._renderVisibilityCacheStats || {};
        const viewportChecks = (Number(viewportCacheStats.hits) || 0)
            + (Number(viewportCacheStats.misses) || 0);
        PerformanceMonitor.setCounter(
            'render.viewportVisibilityReuseEnabled',
            this._reuseViewportVisibilityWithinFrame !== false ? 1 : 0
        );
        PerformanceMonitor.setCounter('render.viewportVisibilityChecks', viewportChecks);
        PerformanceMonitor.setCounter(
            'render.viewportVisibilityCacheHits',
            Number(viewportCacheStats.hits) || 0
        );
        PerformanceMonitor.setCounter(
            'render.viewportVisibilityCacheMisses',
            Number(viewportCacheStats.misses) || 0
        );
        PerformanceMonitor.setCounter(
            'render.viewportVisibilityCacheHitPercent',
            viewportChecks > 0 ? (Number(viewportCacheStats.hits) || 0) / viewportChecks * 100 : 0
        );
        PerformanceMonitor.setCounter(
            'render.viewportStableVisibleSkipEnabled',
            this._skipStableVisibleWrites !== false ? 1 : 0
        );
        PerformanceMonitor.setCounter(
            'render.viewportVisibilityApplyTransitions',
            Number(viewportCacheStats.applyTransitions) || 0
        );
        PerformanceMonitor.setCounter(
            'render.viewportVisibilityVisibleFastSkips',
            Number(viewportCacheStats.visibleFastSkips) || 0
        );
        PerformanceMonitor.setCounter(
            'render.viewportVisibilityHiddenRefreshes',
            Number(viewportCacheStats.hiddenRefreshes) || 0
        );
        PerformanceMonitor.setCounter(
            'render.companionSourceRenderable',
            this._companionRenderMembers?.length || 0
        );
        PerformanceMonitor.setCounter(
            'render.companionSourceAll',
            this._companionAllMembers?.length || 0
        );
        PerformanceMonitor.setCounter(
            'render.companionSourceRefreshes',
            Number(this._companionSourceRefreshes) || 0
        );
        PerformanceMonitor.setCounter(
            'render.companionSourceReuses',
            Number(this._companionSourceReuses) || 0
        );
        const dynamicDepthStats = this._dynamicDepthStats || {};
        PerformanceMonitor.setCounter(
            'render.dynamicDepthFrameWrites',
            Number(dynamicDepthStats.frameWrites) || 0
        );
        PerformanceMonitor.setCounter(
            'render.dynamicDepthFrameRedundantSkips',
            Number(dynamicDepthStats.frameRedundantSkips) || 0
        );
        PerformanceMonitor.setCounter(
            'render.dynamicDepthTotalWrites',
            Number(dynamicDepthStats.totalWrites) || 0
        );
        PerformanceMonitor.setCounter(
            'render.dynamicDepthTotalRedundantSkips',
            Number(dynamicDepthStats.totalRedundantSkips) || 0
        );
        const shadowStats = this._structureShadowRenderStats || {};
        PerformanceMonitor.setCounter('shadow.staticCasters', this._staticSunShadows?.size || 0);
        PerformanceMonitor.setCounter('shadow.totalCasters', this._staticSunShadows?.size || 0);
        PerformanceMonitor.setCounter('shadow.structureCasters', this._structureSunShadows?.size || 0);
        PerformanceMonitor.setCounter('shadow.drawJobs', this._structureShadowJobs?.length || 0);
        PerformanceMonitor.setCounter('shadow.quality', EnvironmentLightingSystem.getShadowQuality());
        PerformanceMonitor.setCounter('shadow.visibleJobs', Number(shadowStats.visibleJobs) || 0);
        PerformanceMonitor.setCounter('shadow.drawnCasters', shadowStats.layerVisible
            ? (Number(shadowStats.visibleJobs) || 0)
            : 0);
        PerformanceMonitor.setCounter('shadow.layerVisible', shadowStats.layerVisible ? 1 : 0);
        PerformanceMonitor.setCounter('shadow.viewportCulled', Number(shadowStats.viewportCulled) || 0);
        PerformanceMonitor.setCounter('shadow.preGeometryCulled', Number(shadowStats.preGeometryCulled) || 0);
        PerformanceMonitor.setCounter('shadow.postGeometryCulled', Number(shadowStats.postGeometryCulled) || 0);
        PerformanceMonitor.setCounter('shadow.viewportPaddingPx', Number(shadowStats.viewportPaddingPx) || 0);
        PerformanceMonitor.setCounter('shadow.clusters', Number(shadowStats.clusters) || 0);
        PerformanceMonitor.setCounter('shadow.rawContourVertices', Number(shadowStats.rawContourVertices) || 0);
        PerformanceMonitor.setCounter('shadow.contourVertices', Number(shadowStats.contourVertices) || 0);
        PerformanceMonitor.setCounter('shadow.contourReductionPercent', Number(shadowStats.rawContourVertices) > 0
            ? (1 - Number(shadowStats.contourVertices) / Number(shadowStats.rawContourVertices)) * 100
            : 0);
        PerformanceMonitor.setCounter('shadow.featherPaths', Number(shadowStats.featherPaths) || 0);
        PerformanceMonitor.setCounter('shadow.triangles', Number(shadowStats.triangles) || 0);
        PerformanceMonitor.setCounter('shadow.sourceVertices', Number(shadowStats.sourceVertices) || 0);
        PerformanceMonitor.setCounter('shadow.commandBufferLength', Number(shadowStats.commandBufferLength) || 0);
        PerformanceMonitor.setCounter('shadow.rebuilds', Number(shadowStats.rebuilds) || 0);
        PerformanceMonitor.setCounter('shadow.lastRebuildMs', Number(shadowStats.lastRebuildMs) || 0);
        PerformanceMonitor.setCounter('shadow.rebuildTotalMs', Number(shadowStats.rebuildTotalMs) || 0);
        PerformanceMonitor.setCounter('shadow.rebuildPeakMs', Number(shadowStats.rebuildPeakMs) || 0);
        PerformanceMonitor.setCounter('fog.enabled', fogGrid?.active ? 1 : 0);
        PerformanceMonitor.setCounter('fog.revision', Number(fogGrid?.revision) || 0);
        PerformanceMonitor.setCounter('fog.maskRenderMs', this._fogMaskRenderer?.lastRenderMs || 0);
        PerformanceMonitor.setCounter('fog.maskChangedCells', this._fogMaskRenderer?.lastChangedCells || 0);
        PerformanceMonitor.setCounter('fog.maskTransitioning', this._fogMaskRenderer?.transitioning ? 1 : 0);
        PerformanceMonitor.setCounter('fog.effectsTracked', Number(fogEffectStats.tracked) || 0);
        PerformanceMonitor.setCounter('fog.effectsHiddenTracked', Number(fogEffectStats.hiddenTracked) || 0);
        PerformanceMonitor.setCounter(
            'fog.visibilityWrites',
            Number(fogEffectStats.visibilityWrites) || 0
        );
        PerformanceMonitor.setCounter(
            'fog.visibilityRedundantSkips',
            Number(fogEffectStats.visibilityRedundantSkips) || 0
        );
        PerformanceMonitor.setCounter('weather.rainActive', rain?._activeSceneId === sceneId ? 1 : 0);
        PerformanceMonitor.setCounter('weather.rainIntensity', rainState?.intensityId || 'none');
        PerformanceMonitor.setCounter('weather.rainStreakAlive', countAlive(rain?._streakEmitter));
        PerformanceMonitor.setCounter('weather.rainStreakCap', rain?._streakEmitter?.maxAliveParticles || 0);
        PerformanceMonitor.setCounter('weather.rainSplashAlive', countAlive(rain?._splashEmitter));
        PerformanceMonitor.setCounter('weather.rainSplashCap', rain?._splashEmitter?.maxAliveParticles || 0);
        PerformanceMonitor.setCounter('weather.sandActive', sand?._activeConfig ? 1 : 0);
        PerformanceMonitor.setCounter('weather.sandstormActive', sand?._sandstormActive ? 1 : 0);
        PerformanceMonitor.setCounter('weather.sandGroundAlive', countAlive(sand?._groundEmitter));
        PerformanceMonitor.setCounter('weather.sandGroundCap', sand?._groundEmitter?.maxAliveParticles || 0);
        PerformanceMonitor.setCounter('weather.sandForegroundAlive', countAlive(sand?._foregroundEmitter));
        PerformanceMonitor.setCounter('weather.sandForegroundCap', sand?._foregroundEmitter?.maxAliveParticles || 0);
    }

    _syncFogDebug() {
        if (!this._fogDebugOverlay?.options?.enabled) return;
        const sceneId = SceneManager.getCurrentWorldId();
        this._fogDebugOverlay.update(
            FogOfWarSystem.getGrid(sceneId),
            this.getFogDebugModel()
        );
    }

    /** 只裁切视觉对象；实体 active、AI、物理、碰撞与寻路状态保持原样。 */
    _applyFogEntityVisibility(_game) {
        const sceneId = SceneManager.getCurrentWorldId();
        this._fogVisibilityController.sync(sceneId, _game, Date.now());
        this._fogVisibilityController.enforceHidden();
    }

    _refreshRenderViewport() {
        const cfg = performanceConfig.renderCulling || {};
        this._renderViewportEpoch = (this._renderViewportEpoch || 0) + 1;
        this._reuseViewportVisibilityWithinFrame = cfg.reuseVisibilityWithinFrame !== false;
        this._skipStableVisibleWrites = cfg.skipStableVisibleWrites !== false;
        const stats = this._renderVisibilityCacheStats || (this._renderVisibilityCacheStats = {
            hits: 0,
            misses: 0,
            applyTransitions: 0,
            visibleFastSkips: 0,
            hiddenRefreshes: 0,
        });
        stats.hits = 0;
        stats.misses = 0;
        stats.applyTransitions = 0;
        stats.visibleFastSkips = 0;
        stats.hiddenRefreshes = 0;
        if (cfg.enabled === false) {
            this._renderViewport = null;
            return;
        }
        const view = this.cameras?.main?.worldView;
        if (!view) return;
        const padding = Math.max(0, Number(cfg.paddingPx) || 320);
        this._renderViewport = {
            left: view.x - padding,
            right: view.right + padding,
            top: view.y - padding,
            bottom: view.bottom + padding,
        };
    }

    _clearRenderScratchSets() {
        this._shadowActiveEntities?.clear();
        this._shadowFriendlySeen?.clear();
        this._stunActiveEntities?.clear();
        this._freezeActiveEntities?.clear();
        this._inspireActiveEntities?.clear();
        this._redWolfTransformActiveEntities?.clear();
        this._droneLockActiveEntities?.clear();
        this._hudActiveEntities?.clear();
        this._structureShadowActiveCasters?.clear();
        this._neutralActiveEntities?.clear();
        this._defenseTowerActiveEntities?.clear();
        this._companionActiveIds?.clear();
        if (this._companionRenderMembers) this._companionRenderMembers.length = 0;
        if (this._companionAllMembers) this._companionAllMembers.length = 0;
        this._companionById?.clear();
        this._companionSourceEpoch = -1;
        this._companionSourceGame = null;
        if (this._dynamicDepthStats) {
            this._dynamicDepthStats.frameWrites = 0;
            this._dynamicDepthStats.frameRedundantSkips = 0;
        }
    }

    /** 交互共用真实主体部件；不把阴影、光晕、反射等特效纳入建筑命中。 */
    getStructurePickVisuals(entity) {
        const neutral = this._neutralSprites?.get(entity);
        const tower = this._defenseSprites?.get(entity);
        return [...new Set([
            ...(neutral?.segmentSprites || []),
            neutral?.sprite,
            neutral?.groundContactSprite,
            neutral?.overlaySprite,
            neutral?.foregroundSprite,
            tower?.base,
            tower?.arm,
            tower?.weapon,
            entity?._phaserSprite,
            ...(entity?._isCoverGate ? [entity.spriteL, entity.sprite, entity.spriteR] : []),
        ].filter((visual) => visual?.active && visual.visible !== false
            && Number(visual.alpha ?? 1) > 0))];
    }

    _isEntityInRenderViewport(entity) {
        const view = this._renderViewport;
        if (!view || !entity || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return true;
        const sprite = entity._phaserSprite || this._neutralSprites?.get(entity)?.sprite
            || this._defenseSprites?.get(entity)?.base || this._companionSprites?.[entity.id];
        const epoch = this._renderViewportEpoch || 0;
        const cacheable = this._reuseViewportVisibilityWithinFrame && !!sprite;
        const stats = this._renderVisibilityCacheStats || (this._renderVisibilityCacheStats = {
            hits: 0,
            misses: 0,
        });
        if (cacheable
            && entity._viewportRenderEpoch === epoch
            && entity._viewportRenderCacheX === entity.x
            && entity._viewportRenderCacheY === entity.y
            && entity._viewportRenderCacheSprite === sprite) {
            stats.hits += 1;
            return entity._viewportRenderVisible !== false;
        }
        stats.misses += 1;
        const radius = Math.max(
            16,
            Number(entity.config?.render?.visualCullRadius) || 0,
            Number(entity.groundRadius || entity.size || entity.collisionRadius) || 16,
            (Number(sprite?.displayWidth) || 0) * 0.5,
            (Number(sprite?.displayHeight) || 0) * 0.5,
            (Number(entity.spriteCfg?.sizeH || entity.displaySize) || 0) * 0.5,
        );
        const visible = entity.x + radius >= view.left && entity.x - radius <= view.right
            && entity.y + radius >= view.top && entity.y - radius <= view.bottom;
        if (cacheable) {
            entity._viewportRenderEpoch = epoch;
            entity._viewportRenderCacheX = entity.x;
            entity._viewportRenderCacheY = entity.y;
            entity._viewportRenderCacheSprite = sprite;
            entity._viewportRenderVisible = visible;
        }
        return visible;
    }

    _setViewportVisualHidden(visual, hidden) {
        if (!visual) return;
        if (Array.isArray(visual) || visual instanceof Set) {
            for (const item of visual) this._setViewportVisualHidden(item, hidden);
            return;
        }
        if (visual instanceof Map) {
            for (const item of visual.values()) this._setViewportVisualHidden(item, hidden);
            return;
        }
        if (typeof visual.setVisible !== 'function') return;
        if (hidden) {
            if (!Object.prototype.hasOwnProperty.call(visual, '_viewportRestoreVisible')) {
                visual._viewportRestoreVisible = visual.visible !== false;
            }
            if (visual.visible !== false) visual.setVisible(false);
            return;
        }
        if (Object.prototype.hasOwnProperty.call(visual, '_viewportRestoreVisible')) {
            const restoreVisible = visual._viewportRestoreVisible !== false;
            if (visual.visible !== restoreVisible) visual.setVisible(restoreVisible);
            delete visual._viewportRestoreVisible;
        }
    }

    _setViewportVisualRecordHidden(record, hidden) {
        if (!record) return;
        for (const key in record) {
            if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
            this._setViewportVisualHidden(record[key], hidden);
        }
    }

    _setFogVisualRecordHidden(record, hidden) {
        if (!record) return;
        for (const key in record) {
            if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
            FogVisualAdapter.setHidden(record[key], hidden);
        }
    }

    _setViewportEntityHidden(entity, hidden) {
        if (!entity) return;
        const viewportHidden = hidden === true;
        const stats = this._renderVisibilityCacheStats || (this._renderVisibilityCacheStats = {
            hits: 0,
            misses: 0,
            applyTransitions: 0,
            visibleFastSkips: 0,
            hiddenRefreshes: 0,
        });
        if (this._skipStableVisibleWrites
            && !viewportHidden
            && entity._viewportEntityHidden !== true) {
            stats.visibleFastSkips += 1;
            return;
        }
        if (entity._viewportEntityHidden === viewportHidden) stats.hiddenRefreshes += 1;
        else stats.applyTransitions += 1;
        this._setViewportVisualHidden(entity?._phaserSprite, hidden);
        this._setViewportVisualHidden(entity?._phaserLabel, hidden);
        this._setViewportVisualHidden(this._shadowSprites?.get(entity), hidden);
        const neutral = this._neutralSprites?.get(entity);
        this._setViewportVisualRecordHidden(neutral, hidden);
        const tower = this._defenseSprites?.get(entity);
        this._setViewportVisualRecordHidden(tower, hidden);
        const magic = this._magicSprites?.get(entity);
        this._setViewportVisualRecordHidden(magic, hidden);
        const xray = this._xrayMap?.get(entity);
        this._setViewportVisualRecordHidden(xray, hidden);
        this._setViewportVisualHidden(this._companionSprites?.[entity?.id], hidden);
        this._setViewportVisualHidden(this._companionGhosts?.[entity?.id], hidden);
        this._setViewportVisualHidden(this._selectionRings?.[entity?.id], hidden);
        this._setViewportVisualHidden(this._freezeFx?.get(entity)?.block, hidden);
        this._setViewportVisualHidden(this._inspireFx?.get(entity)?.gfx, hidden);
        const stunFx = this._stunFx?.get(entity);
        this._setViewportVisualRecordHidden(stunFx, hidden);
        this._setViewportVisualHidden(this._redWolfTransformFx?.get(entity)?.emitters, hidden);
        this._setViewportVisualHidden(this._redWolfPounceSmokeFx?.get(entity)?.emitters, hidden);
        this._setViewportVisualHidden(this._foremanWhips?.getVisual(entity), hidden);
        const damageFx = entity?._buildingDamageFx;
        this._setViewportVisualHidden(damageFx?._flames, hidden);
        this._setViewportVisualHidden(damageFx?._smoke, hidden);
        this._setViewportVisualHidden(this._entityHudTexts?.get(entity), hidden);
        entity._viewportEntityHidden = viewportHidden;
    }

    _applyViewportEntityVisibility(_game) {
        if (!_game?.entities) return;
        let visible = 0;
        let culled = 0;
        const seen = this._viewportVisibilitySeen || (this._viewportVisibilitySeen = new Set());
        seen.clear();
        const apply = (entity) => {
            if (!entity || seen.has(entity) || entity === _game.player) return;
            seen.add(entity);
            const isCorpse = _game.isPreservedCorpse(entity);
            if (!entity.active && !isCorpse) {
                this._setViewportEntityHidden(entity, true);
                return;
            }
            const inViewport = this._isEntityInRenderViewport(entity);
            entity._viewportRenderVisible = inViewport;
            this._setViewportEntityHidden(entity, !inViewport);
            if (inViewport) visible++;
            else culled++;
        };
        for (const entity of _game.entities.values()) apply(entity);
        for (const entity of PartySystem.members || []) apply(entity);
        for (const entity of _game.friendlyUnits || []) apply(entity);
        PerformanceMonitor.setCounter('render.visibleEntities', visible);
        PerformanceMonitor.setCounter('render.culledEntities', culled);
    }

    _setFogEntityHidden(entity, hidden) {
        if (entity?._phaserSprite?.active) FogVisualAdapter.setHidden(entity._phaserSprite, hidden);
        if (entity?._phaserLabel?.active) FogVisualAdapter.setHidden(entity._phaserLabel, hidden);
        const shadow = this._shadowSprites?.get(entity);
        if (shadow?.active) FogVisualAdapter.setHidden(shadow, hidden);

        const neutral = this._neutralSprites?.get(entity);
        if (neutral) {
            FogVisualAdapter.setHidden(neutral.sprite, hidden);
            FogVisualAdapter.setHidden(neutral.label, hidden);
            FogVisualAdapter.setHidden(neutral.groundContactSprite, hidden);
            FogVisualAdapter.setHidden(neutral.overlaySprite, hidden);
            FogVisualAdapter.setHidden(neutral.foregroundSprite, hidden);
            FogVisualAdapter.setHidden(neutral.workingEffectGraphics, hidden);
            FogVisualAdapter.setHidden(neutral.staffingWarningGraphics, hidden);
            FogVisualAdapter.setHidden(neutral.battlementRuneSprite, hidden);
            FogVisualAdapter.setHidden(neutral.segmentSprites, hidden);
        }
        const tower = this._defenseSprites?.get(entity);
        this._setFogVisualRecordHidden(tower, hidden);
        const xray = this._xrayMap?.get(entity);
        this._setFogVisualRecordHidden(xray, hidden);
        const magic = this._magicSprites?.get(entity);
        this._setFogVisualRecordHidden(magic, hidden);
        const structureShadows = this._structureSunShadows?.get(entity);
        FogVisualAdapter.setHidden(structureShadows, hidden);
        // 建筑真正绘制在共享 _structureShadowLayer；上面的非渲染句柄只承载注册身份。
        // 将雾状态写回逐实体数据，并用 revision 强制共享层重画，不能隐藏整层。
        let shadowVisibilityChanged = false;
        const shadowHandles = Array.isArray(structureShadows) ? structureShadows : [structureShadows];
        for (const handle of shadowHandles) {
            const shadowData = handle && this._staticSunShadows?.get(handle);
            if (!shadowData || shadowData.fogHidden === !!hidden) continue;
            shadowData.fogHidden = !!hidden;
            shadowVisibilityChanged = true;
        }
        if (shadowVisibilityChanged) {
            this._structureShadowVisibilityRevision = (this._structureShadowVisibilityRevision || 0) + 1;
        }
        FogVisualAdapter.setHidden(this._freezeFx?.get(entity)?.block, hidden);
        FogVisualAdapter.setHidden(this._inspireFx?.get(entity)?.gfx, hidden);
        FogVisualAdapter.setHidden(this._stunFx?.get(entity), hidden);
        FogVisualAdapter.setHidden(this._redWolfTransformFx?.get(entity)?.emitters, hidden);
        FogVisualAdapter.setHidden(this._redWolfPounceSmokeFx?.get(entity)?.emitters, hidden);
        FogVisualAdapter.setHidden(this._foremanWhips?.getVisual(entity), hidden);
        const damageFx = entity?._buildingDamageFx;
        if (damageFx) {
            FogVisualAdapter.setHidden(damageFx._flames, hidden);
            FogVisualAdapter.setHidden(damageFx._smoke, hidden);
            if (hidden && damageFx._glowKey) this.unregisterEnvironmentGlow(damageFx._glowKey);
        }
        if (hidden) this.unregisterEnvironmentGlow(`fireball:${entity?.id || entity?.name || 'unknown'}`);
    }

    /** 左下角“范围”开关：显示墙顶、楼梯、共享缝、Portal 和真实侧轨。 */
    _syncElevatedNavigationRanges(_game, show) {
        if (!show || !DefenseSystem?.active || !_game?.entities) {
            if (this._elevatedNavigationRangeGraphics) {
                this._elevatedNavigationRangeGraphics.clear();
                this._elevatedNavigationRangeGraphics.setVisible(false);
            }
            if (this._elevatedNavigationRangeLabel) {
                this._elevatedNavigationRangeLabel.setVisible(false);
            }
            return;
        }
        if (!this._elevatedNavigationRangeGraphics) {
            this._elevatedNavigationRangeGraphics = this.add.graphics();
            this._elevatedNavigationRangeGraphics.setDepth(99998);
        }
        const g = this._elevatedNavigationRangeGraphics;
        g.clear();
        g.setVisible(true);
        const debug = DefenseSystem.debugElevatedNavigationGeometry?.(_game.entities);
        if (!debug) return;

        const drawPolygon = (
            points,
            fillColor = 0x20ff70,
            fillAlpha = 0.12,
            lineColor = 0x39ff7a,
            lineAlpha = 0.9,
            lineWidth = 1.5
        ) => {
            if (!Array.isArray(points) || points.length < 3) return;
            g.fillStyle(fillColor, fillAlpha);
            g.lineStyle(lineWidth, lineColor, lineAlpha);
            g.beginPath();
            g.moveTo(points[0].x, points[0].y);
            for (let index = 1; index < points.length; index++) {
                g.lineTo(points[index].x, points[index].y);
            }
            g.closePath();
            if (fillAlpha > 0) g.fillPath();
            g.strokePath();
        };
        const drawLine = (from, to, color, alpha = 1, width = 1.5) => {
            if (!from || !to) return;
            g.lineStyle(width, color, alpha);
            g.beginPath();
            g.moveTo(from.x, from.y);
            g.lineTo(to.x, to.y);
            g.strokePath();
        };
        const elevated = (point, z) => ({
            x: point.x,
            y: point.y - (Number(z) || 0),
        });

        // 墙顶主面、两墙连接面与四墙交汇面：绿色区域就是统一高架查询的几何真源。
        for (const wall of debug.walls || []) {
            const geometry = blockWallTopWalkGeometry(wall);
            if (!geometry?.vertices?.length) continue;
            const topZ = Number(wall._wallTopZ) || WALL_WALK_CONFIG.defaultTopZ;
            drawPolygon(geometry.vertices.map((point) => elevated(point, topZ)));
        }
        for (const connector of debug.wallConnectors || []) {
            drawPolygon(
                (connector.vertices || []).map((point) => elevated(point, connector.topZ)),
                0x43ff83,
                0.18,
                0x8dffb2,
                1,
                2
            );
        }
        for (const junction of debug.wallJunctions || []) {
            drawPolygon(
                (junction.vertices || []).map((point) => elevated(point, junction.topZ)),
                0x43ff83,
                0.24,
                0xb8ffd0,
                1,
                2
            );
        }
        // 墙顶红线只画连续墙面的真实外轮廓；共享墙边和楼梯入口边不会生成。
        for (const guard of debug.wallGuards || []) {
            drawLine(
                elevated({ x: guard.x1, y: guard.y1 }, guard._surfaceZ1),
                elevated({ x: guard.x2, y: guard.y2 }, guard._surfaceZ2),
                0xff3355,
                0.95,
                2
            );
        }

        const seenSeams = new Set();
        const seenGroups = new Set();
        for (const staircase of debug.staircases || []) {
            for (let index = 0; index < (staircase.segments || []).length; index++) {
                const segment = staircase.segments[index];
                const surface = staircase.visualSegments?.[index]?.walkSurface
                    || segment?.walkSurface;
                if (!segment || !surface) continue;
                drawPolygon([
                    elevated(surface.entryA, segment.baseZ),
                    elevated(surface.entryB, segment.baseZ),
                    elevated(surface.exitB, segment.topZ),
                    elevated(surface.exitA, segment.topZ),
                ]);
            }

            // 相邻楼梯之间真正补上的共享面；没有此绿色区域就仍然存在几何暗缝。
            for (const seam of staircase._sharedStairSurfaces || []) {
                if (!seam || seenSeams.has(seam)) continue;
                seenSeams.add(seam);
                const segment = staircase.segments?.[seam.segmentIndex];
                const entryZ = seam.connector
                    ? staircase.targetTopZ
                    : (Number(segment?.baseZ) || 0);
                const exitZ = seam.connector
                    ? staircase.targetTopZ
                    : (Number(segment?.topZ) || entryZ);
                const seamFill = seam.connector ? 0x00ff55 : 0x55ff99;
                const seamLine = seam.connector ? 0x00ff66 : 0xb0ffd0;
                drawPolygon([
                    elevated(seam.railA[0], entryZ),
                    elevated(seam.railB[0], entryZ),
                    elevated(seam.railB[1], exitZ),
                    elevated(seam.railA[1], exitZ),
                ], seamFill, seam.connector ? 0.16 : 0.22, seamLine, 1,
                seam.connector ? 2.5 : 2);
            }

            const wallConnector = staircase.wallConnectorSurface?.();
            if (wallConnector?.hull?.length) {
                drawPolygon(
                    wallConnector.hull.map((point) => elevated(point, staircase.targetTopZ)),
                    0x00ff55,
                    0.16,
                    0x00ff66,
                    1,
                    2.5
                );
            }

            // 楼梯侧轨改用橙色，和墙顶红色防坠线明确区分；两者仍直接读取各自
            // 的权威碰撞几何，不另算调试线。组内侧轨已经被删除，因此不会显示。
            for (const edge of staircase._edgeSegs || []) {
                drawLine(
                    elevated({ x: edge.x1, y: edge.y1 }, edge._surfaceZ1),
                    elevated({ x: edge.x2, y: edge.y2 }, edge._surfaceZ2),
                    0xff9f0a,
                    0.95,
                    2
                );
            }

            const groupId = staircase._wallStairGroupId || staircase.id;
            if (seenGroups.has(groupId)) continue;
            seenGroups.add(groupId);
            const portal = stairGroupGroundPortal(
                staircase,
                WALL_WALK_CONFIG.surfaceNavigation.portalEntryRadius
            );
            if (!portal) continue;
            const margin = Math.max(
                2,
                Number(WALL_WALK_CONFIG.surfaceNavigation.portalCaptureMargin) || 18
            );
            const halfWidth = portal.halfWidth + margin;
            const portalPoint = (along, across) => ({
                x: portal.entry.x
                    + portal.axisX * along
                    + portal.acrossAxisX * across,
                y: portal.entry.y
                    + portal.axisY * along
                    + portal.acrossAxisY * across,
            });
            drawPolygon([
                portalPoint(-margin, -halfWidth),
                portalPoint(margin, -halfWidth),
                portalPoint(margin, halfWidth),
                portalPoint(-margin, halfWidth),
            ], 0x00ff55, 0.16, 0x00ff66, 1, 2.5);
            drawLine(portal.groundPoint, portal.entry, 0x00ff66, 1, 2);
        }

        // 当前单位脚底状态：红=被夹回/排队，绿=已提交高架身份，黄=仍是地面身份。
        const unit = _game.player;
        if (unit?.active) {
            const portalDebug = unit._surfacePortalDebug
                && Date.now() - (Number(unit._surfacePortalDebug.at) || 0) <= 500
                ? unit._surfacePortalDebug
                : null;
            const blocked = unit._surfaceSweepClamped
                || unit._surfaceNavWaiting
                || portalDebug?.status === 'rejected';
            const elevatedUnit = unit._surfaceKind === 'stairs' || unit._surfaceKind === 'wall_walk';
            const color = blocked ? 0xff2244 : (elevatedUnit ? 0x00ff66 : 0xffdd33);
            g.lineStyle(3, color, 1);
            g.strokeCircle(unit.x, unit.y - (Number(unit.z) || 0), 8);
            if (portalDebug) {
                const portalColor = portalDebug.status === 'accepted'
                    ? 0x00ff66
                    : 0xff2244;
                g.fillStyle(portalColor, 0.9);
                g.fillCircle(
                    portalDebug.x,
                    portalDebug.y,
                    4
                );
            }
            const lastValidated = unit._elevatedState?.lastValidated;
            if (lastValidated) {
                g.lineStyle(1.5, 0xaaffcc, 0.9);
                g.strokeCircle(
                    lastValidated.x,
                    lastValidated.y - (Number(lastValidated.z) || 0),
                    5
                );
            }
            if (!this._elevatedNavigationRangeLabel) {
                this._elevatedNavigationRangeLabel = this.add.text(0, 0, '', {
                    fontFamily: 'SimHei, "Microsoft YaHei", sans-serif',
                    fontSize: '12px',
                    color: '#ffffff',
                    backgroundColor: 'rgba(0, 0, 0, 0.78)',
                    padding: { x: 5, y: 3 },
                });
                this._elevatedNavigationRangeLabel.setOrigin(0.5, 1);
                this._elevatedNavigationRangeLabel.setDepth(100000);
            }
            const kindLabel = unit._surfaceKind === 'stairs'
                ? '楼梯'
                : (unit._surfaceKind === 'wall_walk' ? '墙顶' : '地面');
            const reasonLabel = portalDebug?.status === 'rejected'
                ? (portalDebug.reason === 'portal_geometry'
                    ? ' | 拒绝:入口几何'
                    : ' | 拒绝:通行许可')
                : (portalDebug?.status === 'accepted' ? ' | 入口已接受' : '');
            const groupSize = unit._surfaceStairGroupMembers?.length || 0;
            this._elevatedNavigationRangeLabel
                .setText(
                    `${kindLabel} Z:${Math.round(Number(unit.z) || 0)}`
                    + ` 候选:${Number(unit._surfaceCandidateCount) || 0}`
                    + (groupSize > 1 ? ` 楼梯组:${groupSize}` : '')
                    + reasonLabel
                )
                .setColor(blocked ? '#ff5570' : (elevatedUnit ? '#66ff99' : '#ffe066'))
                .setPosition(unit.x, unit.y - (Number(unit.z) || 0) - 14)
                .setVisible(true);
        } else if (this._elevatedNavigationRangeLabel) {
            this._elevatedNavigationRangeLabel.setVisible(false);
        }
    }

    _reconcileNeutralVisualLayer(data, property, cfg, entity, body) {
        let sprite = data[property];
        const key = cfg?.textureKey;
        const staticFrame = Number.isInteger(cfg?.frame) ? cfg.frame : null;
        if (!key) {
            if (sprite?.active) sprite.destroy();
            data[property] = null;
            return null;
        }
        if (!this.textures.exists(key)) return sprite?.active ? sprite : null;
        if (sprite?.active && sprite.texture?.key !== key) {
            sprite.destroy();
            sprite = null;
        }
        if (!sprite?.active) {
            sprite = this.add.sprite(
                entity.x, entity.y, key, staticFrame === null ? undefined : staticFrame);
            sprite.setOrigin(0.5, 0.5);
            data[property] = sprite;
        }
        if (staticFrame !== null && Number(sprite.frame?.name) !== staticFrame) {
            sprite.setFrame(staticFrame);
        }
        sprite.setDisplaySize(
            Number(cfg.displayW) || body.displayWidth,
            Number(cfg.displayH) || body.displayHeight
        );
        if (property === 'overlaySprite' && this.anims.exists(key)
            && (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== key)) {
            sprite.play(key);
        }
        return sprite;
    }

    /**
     * 将现有逻辑层的位置同步到 Phaser 物理体
     * 保持逻辑层权威，物理体仅用于检测
     * 如果启用了 velocity 驱动，从 Phaser 同步位置回逻辑层
     */
    _syncHitFlashAndCharge(_game) {
        if (!_game) return;
        const player = _game.player;
        if (player && this.playerSprite && this.playerSprite.active) {
            // 玩家受击白闪与蓄力白闪共用同一视觉通道。
            if (player.hitFlash > 0 || player._chargeFlashActive) {
                this.playerSprite.setTint(0xffffff);
                if (this.weaponSprite && this.weaponSprite.active) this.weaponSprite.setTint(0xffffff);
                if (this.offhandWeaponSprite && this.offhandWeaponSprite.active) this.offhandWeaponSprite.setTint(0xffffff);
            } else {
                this.playerSprite.clearTint();
                if (this.weaponSprite && this.weaponSprite.active) this.weaponSprite.clearTint();
                if (this.offhandWeaponSprite && this.offhandWeaponSprite.active) this.offhandWeaponSprite.clearTint();
            }
        }
        if (_game.entities) {
            const wallNow = Date.now();
            _game.entities.forEach(e => {
                if (!e || !e.active || e === player) return;
                if (!this._isEntityInRenderViewport(e)) return;
                // 掉落物：tint 由 DropItem 悬停高亮自管，不随受击闪白清空
                if (e.itemData && e.noCollision) return;
                const sprite = e._phaserSprite;
                if (!sprite || !sprite.active) return;
                const rtsFlashUntil = e._rtsAttackFlashUntil || 0;
                const stunResistFlashUntil = e._stunResistFlashUntil || 0;
                if (stunResistFlashUntil && stunResistFlashUntil <= wallNow) {
                    delete e._stunResistFlashStartedAt;
                    delete e._stunResistFlashUntil;
                }
                // 领主眩晕豁免黄闪优先于同次伤害白闪，确保判定反馈不会被覆盖。
                if (stunResistFlashUntil > wallNow) {
                    const elapsed = wallNow - (e._stunResistFlashStartedAt || wallNow);
                    sprite.setTint(Math.floor(elapsed / 60) % 2 === 0 ? 0xffcf3f : 0xffffb8);
                // 受击白闪优先于 RTS 攻击指示，保证真正造成伤害时反馈不被覆盖。
                } else if (e.hitFlash > 0) {
                    sprite.setTint(0xffffff);
                } else if (rtsFlashUntil > wallNow) {
                    const elapsed = wallNow - (e._rtsAttackFlashStartedAt || wallNow);
                    sprite.setTint(Math.floor(elapsed / 90) % 2 === 0 ? 0xff3030 : 0xffffff);
                } else {
                    if (rtsFlashUntil) {
                        delete e._rtsAttackFlashStartedAt;
                        delete e._rtsAttackFlashUntil;
                    }
                    sprite.clearTint();
                }
            });
        }
    }

    /**
     * 玩家有效扣血后的贴图附着式受击反馈：冲击光、两道裂痕和少量火花。
     * 特效使用主体 Sprite 作为位置/深度真源，玩家移动、上下楼或穿过遮挡物时仍贴在身上。
     */
    playPlayerHitAttachedFx(player, source, damageType = 'physical') {
        const sprite = this.playerSprite;
        if (!player || !sprite || !sprite.active || !sprite.visible) return;

        const palette = damageType === 'electric'
            ? { glow: 0x4f8fff, core: 0xe8f6ff, sparks: [0xffffff, 0x8fd6ff, 0x4f7fff] }
            : (damageType === 'magic'
                ? { glow: 0xa04fff, core: 0xf4e8ff, sparks: [0xffffff, 0xd58cff, 0x8a3fff] }
                : { glow: 0xc51f2f, core: 0xfff2e6, sparks: [0xffffff, 0xff784f, 0xc51f2f] });
        const width = Math.max(48, Number(sprite.displayWidth) || 128);
        const height = Math.max(64, Number(sprite.displayHeight) || 160);
        const sourceAngle = source && Number.isFinite(source.x) && Number.isFinite(source.y)
            ? Math.atan2(player.y - source.y, player.x - source.x)
            : Math.random() * Math.PI * 2;
        // 受击点取身体朝向伤害来源的一侧；Y 轴压缩，避免火花落到脚底之外。
        const impactX = -Math.cos(sourceAngle) * width * 0.22;
        const impactY = -Math.sin(sourceAngle) * height * 0.16;
        const container = this.add.container(sprite.x, sprite.y);
        const glow = this.add.ellipse(0, 0, width * 0.52, height * 0.62, palette.glow, 0.24)
            .setBlendMode(BlendModes.ADD);
        const slashAngle = sourceAngle + Math.PI * 0.5;
        const slashA = this.add.rectangle(impactX, impactY, width * 0.34, 3, palette.core, 0.95)
            .setRotation(slashAngle - 0.28)
            .setBlendMode(BlendModes.ADD);
        const slashB = this.add.rectangle(impactX + Math.cos(sourceAngle) * 6, impactY + 5, width * 0.26, 2, palette.glow, 0.9)
            .setRotation(slashAngle + 0.34)
            .setBlendMode(BlendModes.ADD);
        container.add([glow, slashA, slashB]);

        for (let i = 0; i < 7; i++) {
            const spark = this.add.circle(impactX, impactY, i < 2 ? 3 : 2, palette.sparks[i % palette.sparks.length], 0.95)
                .setBlendMode(BlendModes.ADD);
            container.add(spark);
            const spread = sourceAngle + (Math.random() - 0.5) * 1.6;
            const distance = width * (0.12 + Math.random() * 0.22);
            this.tweens.add({
                targets: spark,
                x: impactX + Math.cos(spread) * distance,
                y: impactY + Math.sin(spread) * distance * 0.55,
                alpha: 0,
                scale: 0.25,
                duration: 220 + Math.random() * 90,
                ease: 'Quad.easeOut',
            });
        }
        this.tweens.add({ targets: glow, alpha: 0, scaleX: 1.25, scaleY: 1.12, duration: 180, ease: 'Quad.easeOut' });
        this.tweens.add({ targets: [slashA, slashB], alpha: 0, scaleX: 1.2, duration: 260, ease: 'Quad.easeOut' });

        const list = this._playerAttachedHitFx || (this._playerAttachedHitFx = []);
        while (list.length >= 6) {
            const oldest = list.shift();
            if (oldest?.container?.active) oldest.container.destroy(true);
        }
        list.push({ container, remaining: 320 });
    }

    _syncPlayerAttachedHitFx(_game, dt) {
        const list = this._playerAttachedHitFx;
        if (!list || list.length === 0) return;
        const sprite = this.playerSprite;
        const player = _game?.player;
        for (let i = list.length - 1; i >= 0; i--) {
            const fx = list[i];
            fx.remaining -= Math.max(0, Number(dt) || 0);
            if (!fx.container?.active || fx.remaining <= 0 || !player) {
                if (fx.container?.active) fx.container.destroy(true);
                list.splice(i, 1);
                continue;
            }
            fx.container
                .setPosition(sprite.x, sprite.y)
                .setDepth(sprite.depth + 4)
                .setVisible(sprite.visible && !this._mapModeActive);
        }
    }

    _prepareCompanionFrameSources(_game) {
        const epoch = this._renderViewportEpoch || 0;
        const sources = this._companionFrameSources || (this._companionFrameSources = {});
        if (this._companionSourceEpoch === epoch && this._companionSourceGame === _game) {
            this._companionSourceReuses = (this._companionSourceReuses || 0) + 1;
            return sources;
        }

        const renderMembers = this._companionRenderMembers || (this._companionRenderMembers = []);
        const allMembers = this._companionAllMembers || (this._companionAllMembers = []);
        const byId = this._companionById || (this._companionById = new Map());
        renderMembers.length = 0;
        allMembers.length = 0;
        byId.clear();

        for (const member of PartySystem.members || []) {
            if (!member) continue;
            allMembers.push(member);
            if (member.active !== false) renderMembers.push(member);
            if (member.id) byId.set(member.id, member);
        }
        for (const friendly of _game?.friendlyUnits || []) {
            if (!friendly) continue;
            allMembers.push(friendly);
            renderMembers.push(friendly);
            if (friendly.id && !byId.has(friendly.id)) byId.set(friendly.id, friendly);
        }

        this._companionSourceEpoch = epoch;
        this._companionSourceGame = _game;
        this._companionSourceRefreshes = (this._companionSourceRefreshes || 0) + 1;
        sources.renderMembers = renderMembers;
        sources.allMembers = allMembers;
        sources.byId = byId;
        return sources;
    }

    _companionFrameFootCorrection(member, sprite, anims, scale) {
        const frameH = sprite.frame?.height || 512;
        const calibratedFootY = member.getAnimationFootY?.(sprite.texture?.key);
        if (Number.isFinite(calibratedFootY)) {
            return (frameH / 2 - calibratedFootY) * scale - (member.spriteOffsetY || 0);
        }
        if (member._isHamsterCatapultCrew) {
            const entry = Object.entries(anims).find(([key]) =>
                sprite.texture?.key === `companion_${member.animId}_${key}`);
            const footY = entry?.[1]?.footY;
            if (Number.isFinite(footY)) {
                return (frameH / 2 - footY) * scale - (member.spriteOffsetY || 0);
            }
        }
        return -(frameH - 512) * 0.4375 * scale;
    }

    _syncCatapultAnimation(member, sprite, anims) {
        const state = member._catapultVisualState || 'idle';
        const def = anims[state];
        if (!def) return;
        const key = `companion_${member.animId}_${state}`;
        if (!this.textures.exists(key)) return;
        let elapsed = member._catapultElapsedMs || 0;
        if (def.repeat === -1) elapsed %= def.durationMs;
        let frame = 0;
        while (frame < def.frameCount - 1 && elapsed >= def.frameDurations[frame]) {
            elapsed -= def.frameDurations[frame++];
        }
        // AI 与贴图共用源片时钟；视口外或低帧率也不会推迟离勺事件/重播死亡。
        if (sprite.anims.isPlaying) sprite.anims.stop();
        sprite.removeAllListeners('animationcomplete');
        if (sprite.texture.key !== key || sprite.frame.name !== frame) sprite.setTexture(key, frame);
    }

    /** 侍从跟随渲染：有动作素材的队员（露娜等）跟随玩家，按移动/冲刺/施法播 walk/run/spell */
    _syncCompanionSprites(_game, dt) {
        const player = _game && _game.player;
        const members = this._prepareCompanionFrameSources(_game).renderMembers;
        // 地图模式 / 无玩家：隐藏全部队员精灵
        if (!player || !this.playerSprite || this._mapModeActive || !this.playerSprite.visible) {
            for (const k in this._companionSprites) {
                if (!Object.prototype.hasOwnProperty.call(this._companionSprites, k)) continue;
                this._companionSprites[k].setVisible(false);
                this._setNinjaArmGlowVisible(this._companionSprites[k], false);
            }
            for (const k in this._selectionRings) {
                if (!Object.prototype.hasOwnProperty.call(this._selectionRings, k)) continue;
                this._selectionRings[k].setVisible(false);
            }
            this._clearDesertPriestStaffFx();
            return;
        }
        // 渲染对象 = 队伍侍从 + 世界-122 友方单位（仓鼠矿工等，2026-08-15）
        const activeIds = this._companionActiveIds || (this._companionActiveIds = new Set());
        activeIds.clear();
        const isMoving = !!player.isMoving;
        const isSprinting = isPlayerRunVisual(player);
        const casting = !!(player._castState && player._castState !== 'idle');
        const facingRight = !this.playerSprite.flipX;
        for (const member of members) {
            const anims = member.animations || {};
            // 动画键按 animId（仓鼠矿工多只实例共用 'hamster_miner' 素材键）
            const animId = member.animId || member.id;
            // 经济状态仍为 walk，负重只选择贴图，不改变 AI/寻路/速度。
            const loadedWalk = member._isHamsterMiningExpert && member._energyCarried > 0
                && member.animations?.carryWalk;
            const walkKey = `companion_${animId}_${loadedWalk ? 'carryWalk' : 'walk'}`;
            const runKey = `companion_${animId}_run`;
            if (!anims.walk) continue;
            if (!this.textures.exists(walkKey)) {
                // 运行时兜底：生产/兵线在加载层之外物化新兵种时，只请求该兵种资源。
                // requestFriendlyUnit 内部会合并重复请求并对失败做短 TTL 负缓存。
                RuntimeAssetManager.requestFriendlyUnit(animId);
                continue;
            }
            if (RuntimeAssetManager.isManagedFriendlyUnit(animId)
                && !RuntimeAssetManager.isFriendlyUnitReady(animId)) {
                // 运行时兜底：生产/兵线在加载层之外物化新兵种时，只请求该兵种资源。
                // requestFriendlyUnit 内部会合并重复请求并对失败做短 TTL 负缓存。
                RuntimeAssetManager.requestFriendlyUnit(animId);
            }
            if (!RuntimeAssetManager.isTextureReady(walkKey, this)) continue;
            activeIds.add(member.id);
            let sprite = this._companionSprites[member.id];
            if (!this._isEntityInRenderViewport(member)) {
                this._setViewportVisualHidden(sprite, true);
                this._setNinjaArmGlowVisible(sprite, false);
                this._setViewportVisualHidden(this._selectionRings?.[member.id], true);
                continue;
            }
            this._setViewportVisualHidden(sprite, false);
            this._setViewportVisualHidden(this._selectionRings?.[member.id], false);
            // 显示基准：单位可配置 displaySize（仓鼠矿工略小于玩家），缺省与玩家一致
            const size = member.displaySize || PLAYER_DEFAULTS.physics.spriteSize;
            if (!sprite) {
                const fw = anims.walk.frameWidth || 512;
                const fh = anims.walk.frameHeight || 512;
                // 站立姿态：优先 idle 动画首帧（2026-08-14 新增 idle 素材）；
                // 其次奔跑动画首帧（idle→起跑完全连续）；无奔跑素材退回 walk 首帧
                const idleTexKey = `companion_${animId}_idle`;
                const hasIdleTex = anims.idle && this.textures.exists(idleTexKey);
                const runIdle = anims.run && this.textures.exists(runKey);
                const idleKey = hasIdleTex ? idleTexKey : (runIdle ? runKey : walkKey);
                const idleFrame = hasIdleTex ? 0 : (runIdle ? 0 : (Array.isArray(anims.walk.frames) ? anims.walk.frames[0] : 0));
                sprite = this.add.sprite(player.x, player.y, idleKey, idleFrame);
                sprite.setOrigin(0.5, 0.5);
                const longest = Math.max(fw, fh);
                sprite.setDisplaySize(fw * size / longest, fh * size / longest);
                sprite.setData('companionIdleKey', idleKey);
                sprite.setData('companionIdleFrame', idleFrame);
                sprite.setDepth(this.playerSprite.depth + 0.5);
                this._companionSprites[member.id] = sprite;
            }
            RuntimeAssetManager.repairSpriteFrame(sprite, walkKey, this);
            if ((member.hasStatusEffect?.('petrified') || this._petrifyFx?.has(member)
                || ((animId.startsWith('hamster_') || member._isHamsterPriest || member._isHamsterWarrior) && member.isCombatActionBlocked?.()))
                && !member._dying) {
                if (!sprite.getData('hamsterControlPaused')) {
                    sprite.setData('hamsterControlPaused', true);
                    sprite.anims.pause();
                }
                const normS = size / 512
                    * (member.getAnimationVisualScale?.(sprite.texture?.key, sprite.frame?.name) ?? 1);
                const frameW = sprite.frame?.width || 512;
                const frameH = sprite.frame?.height || 512;
                const feetCorr = this._companionFrameFootCorrection(member, sprite, anims, normS);
                sprite.setDisplaySize(frameW * normS, frameH * normS);
                sprite.setPosition(
                    member.x,
                    member.y + (member.spriteOffsetY || 0) - (member.z || 0) + feetCorr
                );
                sprite.setVisible(true);
                const stealthAlpha = Number(member.aiConfig?.stealth?.alpha);
                sprite.setAlpha(member._isStealthed
                    ? (Number.isFinite(stealthAlpha) ? stealthAlpha : 0.42)
                    : 1);
                this._syncNinjaArmGlow(member, sprite);
                continue;
            }
            if (sprite.getData('hamsterControlPaused')) {
                sprite.setData('hamsterControlPaused', false);
                if (member._dying) sprite.anims.stop();
                else sprite.anims.resume();
            }
            // 朝向：AI 队员——逃跑面朝移动方向；其余（idle/施法/走位）始终面朝目标
            // （最近敌人）；无目标按移动方向。纯渲染队员仍跟随玩家镜像。
            const aiMode = !!member.aiConfig;
            let faceRight = facingRight;
            if (aiMode) {
                const combatFacing = member._isHamsterScoutRifleSkirmisher
                    && (member._animState === 'attack' || member._animState === 'moving_attack')
                    && member.target?.active;
                // 仓鼠矿工/战士/射手/盾卫/民兵/斥候移动（walk）始终朝向实际移动方向（vx），不倒退走路——
                // 否则寻路绕行/回屋时贴图朝向目标、实际反向移动（2026-08-15 用户口径）
                const moving = member._animState === 'walk' || Math.abs(member.vx) > 5;
                const lockedMelee = member._animState === 'attack' && member._ai?._meleeSnapshot
                    && (member._ai._swingActive || member._ai._swing);
                if (lockedMelee) {
                    faceRight = Math.cos(member._ai._meleeSnapshot.worldAngle) >= 0;
                } else if (combatFacing) {
                    faceRight = member.target.x >= member.x;
                } else if ((member._isHamsterMiner || member._isHamsterWarrior || member._isHamsterShooter || member._isHamsterGuard || member._isHamsterMilitia || member._isHamsterScout || member._isHamsterScoutRifleSkirmisher || member._isHamsterMusketeer || member._isHamsterPriest || member._isHamsterKnight || member._isHamsterLightCavalry || member._isHamsterNinja) && moving) {
                    faceRight = member.vx > 0;
                } else if (member._lastAction === 'flee' && Math.abs(member.vx) > 5) {
                    faceRight = member.vx > 0;
                } else {
                    const tgt = (member.target && member.target.active)
                        ? member.target
                        : (member._isHamsterMiner ? null : this._nearestCompanionEnemy(member));
                    if (tgt) {
                        faceRight = tgt.x >= member.x;
                    } else if (Math.abs(member.vx) > 5) {
                        faceRight = member.vx > 0;
                    } else if (member._lastFaceRight !== undefined) {
                        faceRight = member._lastFaceRight;
                    }
                }
                member._lastFaceRight = faceRight;
            }
            if (member._isHamsterCatapultCrew
                && (member._animState === 'attack' || member._dying)) {
                faceRight = member._catapultFaceRight;
                member._lastFaceRight = faceRight;
            }
            sprite.setFlipX(!faceRight);
            sprite.setDepth(this.playerSprite.depth + 0.5);
            // 动作切换残影：记录切换前贴图/帧/显示尺寸，本帧末尾若贴图键变了就生成淡出残影
            const prevTexKey = sprite.texture?.key;
            const prevFrameName = sprite.frame?.name;
            const prevDispW = sprite.displayWidth;
            const prevDispH = sprite.displayHeight;
            // 士兵移动烟尘（2026-08-17）：玩家跑步同款 DustEffect，脚下生成——
            // 军事单位（战士/射手/盾卫/民兵/斥候，不含矿工）移动（walk/run）时按 90ms 间隔出烟
            if (member._isHamsterWarrior || member._isHamsterShooter || member._isHamsterGuard || member._isHamsterMilitia || member._isHamsterScout || member._isHamsterMusketeer || member._isHamsterPriest || member._isHamsterKnight || member._isHamsterLightCavalry || member._isHamsterNinja) {
                const unitMoving = member._animState === 'walk'
                    || Math.abs(member.vx || 0) > 5 || Math.abs(member.vy || 0) > 5;
                if (unitMoving) {
                    if (!member._dustTimer) member._dustTimer = 0;
                    member._dustTimer += dt;
                    const interval = 90;
                    if (member._dustTimer >= interval) {
                        member._dustTimer -= interval;
                        const offsetX = (Math.random() - 0.5) * 8;
                        const offsetY = (Math.random() - 0.5) * 4;
                        EffectFactory.createDustEffect(member.x + offsetX, member.y + offsetY - 5, 0.8);
                    }
                } else {
                    member._dustTimer = 0;
                }
            }
            // 动画：施法 > 冲刺 > 移动 > 站立停帧
            const spellKey = `companion_${animId}_spell`;
            if (aiMode) {
                // AI 状态驱动：dying > mining > spell > run > walk > idle（站立帧 = 待机首帧）
                const st = member._animState || 'idle';
                if (member._isHamsterMiningExpert) {
                    const miningDuration = Number(anims.mining?.durationMs) || 0;
                    sprite.anims.timeScale = st === 'mining' && miningDuration > 0
                        ? miningDuration / Math.max(1, member._ai?._attackInterval || 1500) : 1;
                }
                // 每次逻辑动作都有独立序号；状态切换时注销旧回调，屏外连续攻击也能重新起播。
                if ((animId.startsWith('hamster_') || member._isHamsterPriest || member._isHamsterWarrior)) {
                    const actionStamp = [st, member._attackActionSeq, member._chargeActionSeq,
                        member._prayerActionSeq, member._samuraiAttackSeq,
                        member._attackSwingSeq, member._stealthCastSeq,
                        member._scoutRifleShotSeq].join(':');
                    if (sprite.getData('hamsterActionStamp') !== actionStamp) {
                        sprite.removeAllListeners('animationcomplete');
                        sprite.anims.stop();
                        sprite.setData('hamsterActionStamp', actionStamp);
                        for (const flag of ['hamsterAtk', 'shooterSwing', 'shooterSwingFinished',
                            'knightAttackPlaying', 'knightAttackFinished', 'knightChargePlaying',
                            'knightChargeFinished', 'priestPrayer', 'priestPrayerFinished']) sprite.setData(flag, false);
                    }
                }
                const miningKey = `companion_${animId}_mining`;
                const dyingKey = `companion_${animId}_dying`;
                const viewingKey = `companion_${animId}_viewing`;
                const diggingKey = `companion_${animId}_digging`;
                // 仓鼠骑士的待机是多帧循环。不能像伊莉丝那样只靠最终 idle 回退分支
                // 清动作锁，否则 attack → 多帧 idle → attack 后会永久认为“已播过”。
                if (member._isHamsterKnight) {
                    if (st !== 'attack') {
                        sprite.setData('knightAttackPlaying', false);
                        sprite.setData('knightAttackFinished', false);
                    }
                    if (st !== 'charge') {
                        sprite.setData('knightChargePlaying', false);
                        sprite.setData('knightChargeFinished', false);
                    }
                }
                // 死亡不可被残留的特殊动作键覆盖；其余状态下特殊动作优先于通用攻击/待机分支。
                const attackFrame = st === 'dying' ? null : friendlyAttackFrame(member);
                if (member._isHamsterCatapultCrew) {
                    this._syncCatapultAnimation(member, sprite, anims);
                } else if (attackFrame) {
                    const key = `companion_${animId}_${attackFrame.key}`;
                    if (this.textures.exists(key)) {
                        sprite.anims.stop();
                        if (sprite.texture.key !== key || sprite.frame.name !== attackFrame.frame) {
                            sprite.setTexture(key, attackFrame.frame);
                        }
                    }
                } else if (st === 'dying' && anims.dying && this.textures.exists(dyingKey)) {
                    // 死亡动画只播一次（repeat 0），播完停在最后一帧；防每帧重播
                    if (!sprite.getData('hamsterDying')) {
                        sprite.setData('hamsterDying', true);
                        sprite.play(dyingKey, true);
                    }
                } else if (st === 'stealth' && member._isHamsterNinja
                    && anims.stealth && this.textures.exists(`companion_${animId}_stealth`)) {
                    const stealthKey = `companion_${animId}_stealth`;
                    const stealthSeq = Math.max(0, Number(member._stealthCastSeq) || 0);
                    const playedSeq = Math.max(0, Number(sprite.getData('ninjaStealthSeq')) || 0);
                    const finishedSeq = Math.max(0, Number(sprite.getData('ninjaStealthFinishedSeq')) || 0);
                    if (stealthSeq > playedSeq || (finishedSeq !== stealthSeq
                        && (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== stealthKey))) {
                        sprite.setData('ninjaStealthSeq', stealthSeq);
                        sprite.play(stealthKey, true);
                        sprite.removeAllListeners('animationcomplete');
                        sprite.once('animationcomplete', (anim) => {
                            if (member._dying || member._animState !== st) return;
                            if (anim && anim.key !== stealthKey) return;
                            sprite.setData('ninjaStealthFinishedSeq', stealthSeq);
                        });
                    }
                } else if (st === 'viewing' && member._isHamsterExplorer
                    && anims.viewing && this.textures.exists(viewingKey)) {
                    // 探险途中到点停留：18 帧观察动作只播一次，状态结束后下一段移动会清锁。
                    if (!sprite.getData('explorerViewing')) {
                        sprite.setData('explorerViewing', true);
                        sprite.play(viewingKey, true);
                    }
                } else if (st === 'digging' && member._isHamsterExplorer
                    && anims.digging && this.textures.exists(diggingKey)) {
                    // 12 分钟探险结束：在最终位置完整播放 13 帧挖掘动作，AI 随后结算奖励。
                    if (!sprite.getData('explorerDigging')) {
                        sprite.setData('explorerDigging', true);
                        sprite.play(diggingKey, true);
                    }
                } else if (st === 'mining' && anims.mining && this.textures.exists(miningKey)) {
                    // 采矿动画 = 攻击触发时播一次挥锄，其余攻击间隔定格 waitFrame（插帧后默认索引 10）。
                    // AI 每次有效命中递增 _miningSwingSeq；插帧后首次完整 0~36，之后 8~36 单次。
                    const miningStartKey = `${miningKey}_start`;
                    const miningWaitFrame = anims.mining.waitFrame ?? 10;
                    const miningSwingSeq = Math.max(0, Number(member._miningSwingSeq) || 0);
                    const playedMiningSwingSeq = Math.max(0, Number(sprite.getData('miningSwingSeq')) || 0);
                    if (miningSwingSeq > playedMiningSwingSeq) {
                        sprite.setData('miningSwingSeq', miningSwingSeq);
                        sprite.setData('miningSwing', true);
                        const firstSwing = !sprite.getData('hamsterMining');
                        sprite.setData('hamsterMining', true);
                        if (firstSwing && anims.mining.startFrames && this.anims.exists(miningStartKey)) {
                            sprite.play(miningStartKey, true);
                        } else {
                            sprite.play(miningKey, true);
                        }
                        sprite.removeAllListeners('animationcomplete');
                        sprite.once('animationcomplete', (anim) => {
                            if (member._dying || member._animState !== st) return;
                            if (anim && anim.key !== miningStartKey && anim.key !== miningKey) return;
                            sprite.setData('miningSwing', false);
                            // 挥完定格 waitFrame，直到下一次攻击
                            if (sprite.anims.isPlaying) sprite.anims.stop();
                            if (sprite.texture.key !== miningKey || sprite.frame.name !== miningWaitFrame) {
                                sprite.setTexture(miningKey, miningWaitFrame);
                            }
                        });
                    } else if (!sprite.getData('miningSwing')) {
                        // 攻击间隔：定格 waitFrame
                        sprite.setData('miningSwing', false);
                        if (sprite.anims.isPlaying) sprite.anims.stop();
                        if (sprite.texture.key !== miningKey || sprite.frame.name !== miningWaitFrame) {
                            sprite.setTexture(miningKey, miningWaitFrame);
                        }
                    }
                } else if (st === 'spell' && member._isHamsterPriest && anims.spell && this.textures.exists(spellKey)) {
                    // 仓鼠牧师：praying 17 帧单次，第 8 帧由 AI 结算圣光；播完定格末帧，
                    // 等 AI 结束施法再切回 idle，避免 spell 状态下自动重播。
                    const spellLast = anims.spell.frameCount ? anims.spell.frameCount - 1 : 16;
                    if (member._prayerCast && !sprite.getData('priestPrayer')
                        && !sprite.getData('priestPrayerFinished')) {
                        sprite.setData('priestPrayer', true);
                        sprite.play(spellKey, true);
                        sprite.removeAllListeners('animationcomplete');
                        sprite.once('animationcomplete', (anim) => {
                            if (member._dying || member._animState !== st) return;
                            if (anim && anim.key !== spellKey) return;
                            sprite.setData('priestPrayer', false);
                            sprite.setData('priestPrayerFinished', true);
                            // 施法标记由 AI 结束时清除，旧视觉回调不改逻辑状态。
                            if (sprite.anims.isPlaying) sprite.anims.stop();
                            if (sprite.texture.key !== spellKey || sprite.frame.name !== spellLast) {
                                sprite.setTexture(spellKey, spellLast);
                            }
                        });
                    } else if ((!member._prayerCast || sprite.getData('priestPrayerFinished'))
                        && !sprite.getData('priestPrayer')) {
                        if (sprite.anims.isPlaying) sprite.anims.stop();
                        if (sprite.texture.key !== spellKey || sprite.frame.name !== spellLast) {
                            sprite.setTexture(spellKey, spellLast);
                        }
                    } else if (member._prayerCast && sprite.getData('priestPrayer')
                        && (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== spellKey)) {
                        // 自愈（2026-08-21，照斥候 shooterSwing 同款）：上次祈祷动画被打断
                        // （未触发 animationcomplete）→ priestPrayer 残留 true 会永久禁播；
                        // 重置标记，下一帧走播放分支重播
                        sprite.setData('priestPrayer', false);
                    }
                } else if (st === 'spell' && anims.spell && this.textures.exists(spellKey)) {
                    // 重播条件 = 动画已停止（被 idle 停帧 setTexture 打断）或键变化。
                    // spell 已 repeat -1（循环播放中不会自然停），isPlaying 恒 true → 不重播；
                    // 只有被停帧打断时 isPlaying=false → 才重新播放。
                    if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== spellKey) {
                        sprite.play(spellKey, true);
                    }
                } else if (st === 'defend' && anims.defend && this.textures.exists(`companion_${animId}_defend`)) {
                    // 剑盾防御（伊莉丝）：enter 播 1~8 帧一次 → hold 停帧第 8 帧（2s 持盾减伤+常态弹反）
                    // → exit 播剩余一次。2026-08-17 修复"重复动画"两处根因：
                    // ① 阶段读 member._defendPhase（AI 现已逐段镜像），此前恒 undefined → 永远走 enter；
                    // ② enter/exit 播完停末帧，不再用 !isPlaying 当重播条件（播完即回放 = 重复动画）。
                    const defendKey = `companion_${animId}_defend`;
                    const holdFrame = anims.defend.holdFrame ?? 7;
                    const phase = member._defendPhase || 'enter';
                    if (phase === 'enter') {
                        const startKey = `${defendKey}_start`;
                        if (sprite.getData('defPhase') !== 'enter') {
                            sprite.setData('defPhase', 'enter');
                            sprite.play(startKey, true);
                        } else if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== startKey) {
                            // 播完/被打断：停 enter 末帧（= 第 8 帧），等 AI 切 hold，不重播
                            if (sprite.texture.key !== defendKey || sprite.frame.name !== holdFrame) {
                                sprite.setTexture(defendKey, holdFrame);
                            }
                        }
                    } else if (phase === 'hold') {
                        sprite.setData('defPhase', 'hold');
                        if (sprite.anims.isPlaying) sprite.anims.stop();
                        if (sprite.texture.key !== defendKey || sprite.frame.name !== holdFrame) {
                            sprite.setTexture(defendKey, holdFrame);
                        }
                    } else {
                        const endKey = `${defendKey}_end`;
                        const exitLast = (anims.defend.exitFrames ? anims.defend.exitFrames[1] : 18) ?? 18;
                        if (sprite.getData('defPhase') !== 'exit') {
                            sprite.setData('defPhase', 'exit');
                            sprite.play(endKey, true);
                        } else if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== endKey) {
                            // 播完/被打断：停 exit 末帧（第 19 帧），等 AI 切 idle，不重播
                            if (sprite.texture.key !== defendKey || sprite.frame.name !== exitLast) {
                                sprite.setTexture(defendKey, exitLast);
                            }
                        }
                    }
                } else if (st === 'charge' && member._isHamsterKnight
                    && anims.charge && this.textures.exists(`companion_${animId}_charge`)) {
                    // 骑士冲锋：一次性完整播放，播完定在末帧；AI 的冲锋窗口可能比贴图
                    // 多出一段时间，绝不能因 !isPlaying 自动从第 1 帧重播。
                    const chargeKey = `companion_${animId}_charge`;
                    const chargeLast = anims.charge.frameCount ? anims.charge.frameCount - 1 : 29;
                    if (!sprite.getData('knightChargePlaying')) {
                        sprite.setData('knightChargePlaying', true);
                        sprite.setData('knightChargeFinished', false);
                        sprite.play(chargeKey, true);
                        sprite.removeAllListeners('animationcomplete');
                        sprite.once('animationcomplete', (anim) => {
                            if (member._dying || member._animState !== st) return;
                            if (anim && anim.key !== chargeKey) return;
                            sprite.setData('knightChargeFinished', true);
                            if (sprite.anims.isPlaying) sprite.anims.stop();
                            if (sprite.texture.key !== chargeKey || sprite.frame.name !== chargeLast) {
                                sprite.setTexture(chargeKey, chargeLast);
                            }
                        });
                    } else if (!sprite.getData('knightChargeFinished')
                        && (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== chargeKey)) {
                        // 非正常切走时 Phaser 不会发 animationcomplete；下帧从第 1 帧恢复。
                        sprite.setData('knightChargePlaying', false);
                    }
                } else if (st === 'attack' && member._isHamsterKnight
                    && anims.attack && this.textures.exists(`companion_${animId}_attack`)) {
                    // 骑士普攻与 AI 的 60ms 收尾分离：贴图播完后停末帧，AI 仍负责
                    // 命中、冷却和结束状态；离开 attack 的帧由上方统一清锁，下一次必重播。
                    const atkKey = `companion_${animId}_attack`;
                    const atkLast = anims.attack.frameCount ? anims.attack.frameCount - 1 : 30;
                    if (!sprite.getData('knightAttackPlaying')) {
                        sprite.setData('knightAttackPlaying', true);
                        sprite.setData('knightAttackFinished', false);
                        sprite.play(atkKey, true);
                        sprite.removeAllListeners('animationcomplete');
                        sprite.once('animationcomplete', (anim) => {
                            if (member._dying || member._animState !== st) return;
                            if (anim && anim.key !== atkKey) return;
                            sprite.setData('knightAttackFinished', true);
                            if (sprite.anims.isPlaying) sprite.anims.stop();
                            if (sprite.texture.key !== atkKey || sprite.frame.name !== atkLast) {
                                sprite.setTexture(atkKey, atkLast);
                            }
                        });
                    } else if (!sprite.getData('knightAttackFinished')
                        && (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== atkKey)) {
                        // 被其他状态意外中断时清播放锁，保持下一帧自动自愈重播。
                        sprite.setData('knightAttackPlaying', false);
                    }
                } else if (st === 'attack' && member._isHamsterNinja) {
                    const variant = member._attackVariant === 'continuous' ? 'attack_continuous' : 'attack_opening';
                    const attackDef = anims[variant];
                    const attackKey = `companion_${animId}_${variant}`;
                    if (attackDef && this.textures.exists(attackKey)) {
                        const attackSeq = Math.max(0, Number(member._attackSwingSeq) || 0);
                        const playedSeq = Math.max(0, Number(sprite.getData('ninjaAttackSeq')) || 0);
                        const finishedSeq = Math.max(0, Number(sprite.getData('ninjaAttackFinishedSeq')) || 0);
                        if (attackSeq > playedSeq || (finishedSeq !== attackSeq
                            && (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== attackKey))) {
                            sprite.setData('ninjaAttackSeq', attackSeq);
                            sprite.setData('ninjaAttackVariant', variant);
                            sprite.play(attackKey, true);
                            sprite.removeAllListeners('animationcomplete');
                            sprite.once('animationcomplete', (anim) => {
                                if (member._dying || member._animState !== st) return;
                                if (anim && anim.key !== attackKey) return;
                                sprite.setData('ninjaAttackFinishedSeq', attackSeq);
                                const last = Math.max(0, (attackDef.frameCount || 1) - 1);
                                if (sprite.anims.isPlaying) sprite.anims.stop();
                                sprite.setTexture(attackKey, last);
                            });
                        }
                    }
                } else if ((st === 'attack' || st === 'moving_attack')
                    && member._isHamsterScoutRifleSkirmisher) {
                    const attackState = st === 'moving_attack' ? 'moving_attack' : 'attack';
                    const attackDef = anims[attackState];
                    const attackKey = `companion_${animId}_${attackState}`;
                    if (attackDef && this.textures.exists(attackKey)) {
                        const attackSeq = Math.max(0, Number(member._scoutRifleShotSeq) || 0);
                        const playedSeq = Math.max(0, Number(sprite.getData('scoutRifleShotSeq')) || 0);
                        const finishedSeq = Math.max(0,
                            Number(sprite.getData('scoutRifleFinishedSeq')) || 0);
                        if (attackSeq > playedSeq || (finishedSeq !== attackSeq
                            && (!sprite.anims.isPlaying
                                || sprite.anims.currentAnim?.key !== attackKey))) {
                            sprite.setData('scoutRifleShotSeq', attackSeq);
                            sprite.setData('scoutRifleShotState', attackState);
                            sprite.play(attackKey, true);
                            sprite.removeAllListeners('animationcomplete');
                            sprite.once('animationcomplete', (anim) => {
                                if (member._dying || member._animState !== st) return;
                                if (anim && anim.key !== attackKey) return;
                                sprite.setData('scoutRifleFinishedSeq', attackSeq);
                                if (sprite.anims.isPlaying) sprite.anims.stop();
                                sprite.setTexture(attackKey,
                                    Math.max(0, (attackDef.frameCount || 1) - 1));
                            });
                        }
                    }
                } else if (st === 'attack' && (member._isHamsterShooter || member._isHamsterGuard || member._isHamsterMilitia || member._isHamsterScout || member._isHamsterMusketeer || member._isHamsterLightCavalry)
                    && ((member._isHamsterAntiVehicle && member._attackVariant === 'rocket')
                        ? (anims.rocket_attack && this.textures.exists(`companion_${animId}_rocket_attack`))
                        : (anims.attack && this.textures.exists(`companion_${animId}_attack`)))) {
                    // 仓鼠射手/盾卫/民兵/斥候攻击：单次播放（射手 13 帧 / 盾卫 12 帧 /
                    // 民兵 15 帧 / 斥候 18 帧，repeat 0），射手第 10 帧、斥候第 11 帧
                    // 出膛、盾卫第 10 帧、民兵第 8 帧伤害判定均由 AI 计时；
                    // AI 每次挥击置 _attackSwing → 重播动画；播完定格末帧等下一次挥击。
                    const attackVariant = member._isHamsterAntiVehicle && member._attackVariant === 'rocket'
                        ? 'rocket_attack'
                        : 'attack';
                    const attackDef = anims[attackVariant];
                    const atkKey = `companion_${animId}_${attackVariant}`;
                    const atkLast = attackDef?.frameCount ? attackDef.frameCount - 1 : 12;
                    const swingKey = sprite.getData('shooterSwingKey');
                    if (sprite.getData('shooterSwing') && swingKey !== atkKey) {
                        sprite.setData('shooterSwing', false);
                    }
                    if (member._attackSwing && !sprite.getData('shooterSwing')
                        && !sprite.getData('shooterSwingFinished')) {
                        sprite.setData('shooterSwing', true);
                        sprite.setData('shooterSwingKey', atkKey);
                        sprite.play(atkKey, true);
                        sprite.removeAllListeners('animationcomplete');
                        sprite.once('animationcomplete', (anim) => {
                            if (member._dying || member._animState !== st) return;
                            if (anim && anim.key !== atkKey) return;
                            sprite.setData('shooterSwing', false);
                            sprite.setData('shooterSwingFinished', true);
                            if (sprite.anims.isPlaying) sprite.anims.stop();
                            if (sprite.texture.key !== atkKey || sprite.frame.name !== atkLast) {
                                sprite.setTexture(atkKey, atkLast);
                            }
                        });
                    } else if (member._attackSwing && !sprite.getData('shooterSwingFinished')
                        && (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== atkKey)) {
                        // 上次挥击动画被打断（未触发 animationcomplete）→ shooterSwing 残留 true：
                        // 重置标记，下一帧走播放分支重播（2026-08-17 斥候攻击动画修复）
                        sprite.setData('shooterSwing', false);
                    } else if (!sprite.getData('shooterSwing')) {
                        // 开火间隔：定格攻击末帧
                        if (sprite.anims.isPlaying) sprite.anims.stop();
                        if (sprite.texture.key !== atkKey || sprite.frame.name !== atkLast) {
                            sprite.setTexture(atkKey, atkLast);
                        }
                    }
                } else if (st === 'attack' && member._isHamsterSamurai
                    && anims.attack && this.textures.exists(`companion_${animId}_attack`)) {
                    // 武士每次普攻对应一段完整的 43 帧拔刀斩。AI 递增序号触发重播，
                    // 伤害在刀刃接触帧结算；播完后停末帧等待下一次挥击。
                    const atkKey = `companion_${animId}_attack`;
                    const atkLast = Math.max(0, (anims.attack.frameCount || 1) - 1);
                    const attackSeq = Math.max(0, Number(member._samuraiAttackSeq) || 0);
                    const playedSeq = Math.max(0, Number(sprite.getData('samuraiAttackSeq')) || 0);
                    if (attackSeq > playedSeq) {
                        sprite.setData('samuraiAttackSeq', attackSeq);
                        sprite.play(atkKey, true);
                        sprite.removeAllListeners('animationcomplete');
                        sprite.once('animationcomplete', (anim) => {
                            if (member._dying || member._animState !== st) return;
                            if (anim && anim.key !== atkKey) return;
                            if (sprite.anims.isPlaying) sprite.anims.stop();
                            if (sprite.texture.key !== atkKey || sprite.frame.name !== atkLast) {
                                sprite.setTexture(atkKey, atkLast);
                            }
                        });
                    } else if (!sprite.anims.isPlaying
                        || sprite.anims.currentAnim?.key !== atkKey) {
                        if (sprite.texture.key !== atkKey || sprite.frame.name !== atkLast) {
                            sprite.setTexture(atkKey, atkLast);
                        }
                    }
                } else if (st === 'attack' && member._isHamsterWarrior
                    && anims.attack && this.textures.exists(`companion_${animId}_attack`)) {
                    // 仓鼠战士攻击两段式（2026-08-16 用户口径）：从待机/移动进入攻击 → 先播
                    // 完整 1~24 帧一次；持续攻击中 → 第 6~24 帧循环（attack_start 播完自动切 attack）
                    const atkKey = `companion_${animId}_attack`;
                    const atkStartKey = `${atkKey}_start`;
                    if (!sprite.getData('hamsterAtk')) {
                        sprite.setData('hamsterAtk', true);
                        if (anims.attack.startFrames && this.anims.exists(atkStartKey)) {
                            sprite.play(atkStartKey, true);
                            sprite.removeAllListeners('animationcomplete');
                            sprite.once('animationcomplete', () => {
                                if (sprite.getData('hamsterAtk')
                                    && sprite.anims.currentAnim?.key === atkStartKey) {
                                    sprite.play(atkKey, true);
                                }
                            });
                        } else {
                            sprite.play(atkKey, true);
                        }
                    } else if (!sprite.anims.isPlaying
                        || (sprite.anims.currentAnim?.key !== atkKey
                            && sprite.anims.currentAnim?.key !== atkStartKey)) {
                        sprite.play(atkKey, true);
                    }
                } else if (st === 'attack' && anims.attack && this.textures.exists(`companion_${animId}_attack`)) {
                    // 普通攻击（伊莉丝）：28 帧 repeat 0 播一次，动画结束停在末帧（AI 届时切回 idle）
                    const attackKey = `companion_${animId}_attack`;
                    if (!sprite.getData('atkPlayed')) {
                        sprite.setData('atkPlayed', true);
                        sprite.play(attackKey, true);
                    }
                } else if (st === 'windmill' && anims.windmill && this.textures.exists(`companion_${animId}_windmill`)) {
                    // 风车（伊莉丝）：23 帧 repeat 0 播一次，动画结束停在末帧（AI 届时切回 idle）
                    const wmKey = `companion_${animId}_windmill`;
                    if (!sprite.getData('wmPlayed')) {
                        sprite.setData('wmPlayed', true);
                        sprite.play(wmKey, true);
                    }
                } else if (st === 'run' && anims.run && this.textures.exists(runKey)) {
                    // idle→running：先播起步段（run_start，startFrames 一次），仍在奔跑则循环 loopFrames（run）
                    const runStartKey = `${runKey}_start`;
                    if (!sprite.getData('lunaRunning')) {
                        sprite.setData('lunaRunning', true);
                        if (anims.run.startFrames && this.anims.exists(runStartKey)) {
                            sprite.play(runStartKey, true);
                            sprite.removeAllListeners('animationcomplete');
                            sprite.once('animationcomplete', () => {
                                if (sprite.getData('lunaRunning')
                                    && sprite.anims.currentAnim?.key === runStartKey) {
                                    sprite.play(runKey, true);
                                }
                            });
                        } else {
                            sprite.play(runKey, true);
                        }
                    } else if (!sprite.anims.isPlaying
                        || (sprite.anims.currentAnim?.key !== runKey
                            && sprite.anims.currentAnim?.key !== runStartKey)) {
                        sprite.play(runKey, true);
                    }
                } else if (st === 'walk') {
                    // 静止→移动：播放行走动画（2026-08-17 用户口径：任何小范围移动都强制播
                    // walking，取消移动门槛）。伊莉丝 walking 前两帧前摇已从素材删除、单段
                    // 12 帧循环（无 startFrames 走简单路径）；仓鼠矿工保留起步全播+循环
                    // 两段式（配置带 startFrames 时走两段）。
                    sprite.setData('lunaRunning', false);
                    // 离开攻击状态必须重置战士攻击标记：attack→walk→attack 再次进入攻击时
                    // 仍播完整 1~24 帧起步（2026-08-16 用户口径：从其他状态进攻击播完整循环）
                    sprite.setData('hamsterAtk', false);
                    sprite.setData('explorerViewing', false);
                    sprite.setData('explorerDigging', false);
                    const walkStartKey = `${walkKey}_start`;
                    if (anims.walk.startFrames && this.anims.exists(walkStartKey)) {
                        if (!sprite.getData('hamsterWalk')) {
                            sprite.setData('hamsterWalk', true);
                            sprite.play(walkStartKey, true);
                            sprite.removeAllListeners('animationcomplete');
                            sprite.once('animationcomplete', () => {
                                if (sprite.getData('hamsterWalk')
                                    && sprite.anims.currentAnim?.key === walkStartKey) {
                                    sprite.play(walkKey, true);
                                }
                            });
                        } else if (!sprite.anims.isPlaying
                            || (sprite.anims.currentAnim?.key !== walkKey
                                && sprite.anims.currentAnim?.key !== walkStartKey)) {
                            sprite.play(walkKey, true);
                        }
                    } else if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== walkKey) {
                        sprite.play(walkKey, true);
                    }
                } else if (st === 'idle' && anims.idle && (anims.idle.frameCount || 1) > 1
                    && this.textures.exists(`companion_${animId}_idle`)) {
                    // 多帧待机（2026-08-17 仓鼠斥候 6 帧呼吸待机）：循环播放，不再停首帧
                    const idleAnimKey = `companion_${animId}_idle`;
                    if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== idleAnimKey) {
                        sprite.play(idleAnimKey, true);
                    }
                } else {
                    sprite.setData('hamsterDying', false);
                    sprite.setData('hamsterMining', false);
                    sprite.setData('miningSwing', false);
                    sprite.setData('hamsterWalk', false);
                    sprite.setData('hamsterAtk', false);
                    sprite.setData('shooterSwing', false);
                    sprite.setData('lunaRunning', false);
                    sprite.setData('atkPlayed', false);
                    sprite.setData('knightAttackPlaying', false);
                    sprite.setData('knightAttackFinished', false);
                    sprite.setData('knightChargePlaying', false);
                    sprite.setData('knightChargeFinished', false);
                    sprite.setData('wmPlayed', false);
                    sprite.setData('defPhase', null);
                    sprite.setData('explorerViewing', false);
                    sprite.setData('explorerDigging', false);
                    if (sprite.anims.isPlaying) sprite.anims.stop();
                    const idleKey = sprite.getData('companionIdleKey');
                    const idleFrame = sprite.getData('companionIdleFrame');
                    if (idleKey && (sprite.texture.key !== idleKey || sprite.frame.name !== idleFrame)) {
                        sprite.setTexture(idleKey, idleFrame);
                    }
                }
            } else if (casting && anims.spell && this.textures.exists(spellKey)) {
                if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== spellKey) {
                    sprite.play(spellKey, true);
                }
            } else if (isSprinting && anims.run && this.textures.exists(runKey)) {
                // 起步（startFrames 播一次）+ 奔跑循环（loopFrames）：站立/走→跑时先起步
                const runStartKey = `${runKey}_start`;
                if (!sprite.getData('lunaRunning')) {
                    sprite.setData('lunaRunning', true);
                    if (anims.run.startFrames && this.anims.exists(runStartKey)) {
                        sprite.play(runStartKey, true);
                        sprite.once('animationcomplete', () => {
                            if (sprite.getData('lunaRunning') && sprite.anims.currentAnim?.key === runStartKey) {
                                sprite.play(runKey, true);
                            }
                        });
                    } else {
                        sprite.play(runKey, true);
                    }
                } else if (!sprite.anims.isPlaying
                    || (sprite.anims.currentAnim?.key !== runKey && sprite.anims.currentAnim?.key !== runStartKey)) {
                    sprite.play(runKey, true);
                }
            } else if (isMoving) {
                if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== walkKey) {
                    sprite.play(walkKey, true);
                }
            } else {
                sprite.setData('lunaRunning', false);
                if (sprite.anims.isPlaying) sprite.anims.stop();
                const idleKey = sprite.getData('companionIdleKey');
                const idleFrame = sprite.getData('companionIdleFrame');
                if (idleKey && (sprite.texture.key !== idleKey || sprite.frame.name !== idleFrame)) {
                    sprite.setTexture(idleKey, idleFrame);
                }
            }
            // 位置：AI 队员用自身逻辑坐标（跟随/站位/撤退由 AI 移动）；纯渲染队员跟随玩家左后偏移
            // 脚底偏移（companion-config spriteOffsetY）：精灵帧内脚底不在帧中心时下移贴地
            const spriteOffY = member.spriteOffsetY || 0;
            // 高架单位按脚底 z 抬升渲染。
            // （0~platformHeight），走上台阶平滑升高，不再布尔瞬移
            const elevationZ = member.z || 0;
            // 跨动作统一显示归一化（2026-08-17 伊莉丝六动作统一尺度）：
            // 各动作帧格规格可不同（512×512~960×1024），内容统一按 S=461/171 摆放、
            // 脚底固定 0.9375×格高——显示尺寸按当前帧格线性映射（512 格 = size 基准），
            // 竖直补 -(格高-512)×0.4375×normS 让脚底在所有动作下贴同一世界线。
            // 旧实现只在创建时按 walk 帧格设置一次，帧格规格不同的动作会整体缩放/漂移
            // （上一次重建"大小无法统一"的渲染侧根因）。
            const normS = size / 512
                * (member.getAnimationVisualScale?.(sprite.texture?.key, sprite.frame?.name) ?? 1);
            const frameW = (sprite.frame && sprite.frame.width) || 512;
            const frameH = (sprite.frame && sprite.frame.height) || 512;
            const animationVisualOffset = member.getAnimationVisualOffset?.(
                sprite.texture?.key, sprite.frame?.name
            ) || {};
            const animationOffsetX = (Number(animationVisualOffset.x) || 0)
                * normS * (sprite.flipX ? -1 : 1);
            const animationOffsetY = (Number(animationVisualOffset.y) || 0) * normS;
            // 待机呼吸（2026-08-21 零素材微动）：静止 idle 且未播动画（单帧待机）时，
            // 纵向 ±1.8% 正弦缩放 + 横向 ∓0.6% 保体积补偿，脚底锚定（修正 displayHeight/2）；
            // 相位按成员 id 打散，避免全员同步呼吸；多帧 idle 动画（如斥候）与移动/攻击/施法不叠加。
            const idleState = aiMode
                ? (member._animState || 'idle') === 'idle'
                : (!isMoving && !isSprinting && !casting);
            const idleStill = idleState && !sprite.anims.isPlaying && !member._isHamsterCatapultCrew;
            // 可选 render.idleSwayX：多帧待机也可做纯渲染水平微动，不改变实体/碰撞坐标。
            const renderConfig = member.config?.render || {};
            const idleSwayX = Math.max(0, Number(renderConfig.idleSwayX) || 0);
            const idleSwayPeriodMs = Math.max(250, Number(renderConfig.idleSwayPeriodMs) || 2400);
            let idlePhase = 0;
            if (idleStill || (idleState && idleSwayX > 0)) {
                const idStr = String(member.id || '');
                for (let i = 0; i < idStr.length; i++) idlePhase += idStr.charCodeAt(i);
            }
            let breatheH = 1, breatheW = 1;
            if (idleStill) {
                const s = Math.sin((this.time.now / 2400) * Math.PI * 2 + idlePhase);
                breatheH = 1 + 0.018 * s;
                breatheW = 1 - 0.006 * s;
            }
            const idleOffsetX = idleState && idleSwayX > 0
                ? Math.sin((this.time.now / idleSwayPeriodMs) * Math.PI * 2 + idlePhase) * idleSwayX
                : 0;
            sprite.setDisplaySize(frameW * normS * breatheW, frameH * normS * breatheH);
            const feetCorr = this._companionFrameFootCorrection(member, sprite, anims, normS)
                - frameH * normS * (breatheH - 1) / 2;
            if (aiMode) {
                sprite.setPosition(member.x + idleOffsetX + animationOffsetX,
                    member.y + spriteOffY - elevationZ + feetCorr + animationOffsetY);
            } else {
                const offX = facingRight ? -150 : 150;
                sprite.setPosition(player.x + offX + idleOffsetX + animationOffsetX,
                    player.y + 34 + spriteOffY - elevationZ + feetCorr + animationOffsetY);
            }
            sprite.setVisible(true);
            const stealthAlpha = Number(member.aiConfig?.stealth?.alpha);
            sprite.setAlpha(member._isStealthed
                ? (Number.isFinite(stealthAlpha) ? stealthAlpha : 0.42)
                : 1);
            this._syncNinjaArmGlow(member, sprite);
            // 专家尚无独立死亡视频：保持自身待机姿势短暂淡出，不借用普通矿工素材。
            if (member._isHamsterMiningExpert && member._dying) {
                sprite.setAlpha(Math.max(0, Math.min(1, member._deathTimer / 1060)));
            }
            this._syncDesertPriestStaffFx(member, sprite, anims, dt);
            // 动作切换残影（零素材过渡）：贴图键变化 = 动作切换——旧帧残影 110ms 淡出消顿挫
            if (prevTexKey && sprite.texture?.key !== prevTexKey
                && member.config?.render?.actionTransitionGhost !== false) {
                this._spawnCompanionGhost(member.id, prevTexKey, prevFrameName,
                    prevDispW, prevDispH, sprite);
            }
            // Tint 优先级：受击白闪 > 选中金色 > 常态。经济矿工不可选择，只保留受击反馈。
            const selected = PartySystem.isSelected(member.id);
            const hitFlashing = member.hitFlash > 0;
            if (member._isHamsterMiner) {
                if (this._selectionRings[member.id]) this._selectionRings[member.id].setVisible(false);
                if (hitFlashing) sprite.setTint(0xffffff);
                else sprite.clearTint();
            } else {
                if (hitFlashing) {
                    sprite.setTint(0xffffff);
                    if (selected) this._showSelectionRing(member.id, member.x, member.y, size);
                    else if (this._selectionRings[member.id]) this._selectionRings[member.id].setVisible(false);
                } else if (selected) {
                    sprite.setTint(0xffd98a);
                    this._showSelectionRing(member.id, member.x, member.y, size);
                } else {
                    sprite.clearTint();
                    if (this._selectionRings[member.id]) this._selectionRings[member.id].setVisible(false);
                }
            }
        }
        // 清理已移出队伍的精灵
        for (const id in this._companionSprites) {
            if (!Object.prototype.hasOwnProperty.call(this._companionSprites, id)) continue;
            if (!activeIds.has(id)) {
                this._disableDesertPriestStaffFx(id);
                this._destroyNinjaArmGlow(this._companionSprites[id]);
                this._companionSprites[id].destroy();
                delete this._companionSprites[id];
                const ghost = this._companionGhosts && this._companionGhosts[id];
                if (ghost) {
                    ghost.destroy();
                    delete this._companionGhosts[id];
                }
            }
        }
        // 清理已移出队伍的光圈
        for (const id in this._selectionRings) {
            if (!Object.prototype.hasOwnProperty.call(this._selectionRings, id)) continue;
            if (!activeIds.has(id)) {
                this._selectionRings[id].destroy();
                delete this._selectionRings[id];
            }
        }
    }

    _setNinjaArmGlowVisible(sprite, visible) {
        const glow = sprite?.getData?.('ninjaArmGlow');
        glow?.aura?.setVisible(visible);
        glow?.core?.setVisible(visible);
    }

    _destroyNinjaArmGlow(sprite) {
        const glow = sprite?.getData?.('ninjaArmGlow');
        glow?.aura?.destroy?.();
        glow?.core?.destroy?.();
        sprite?.setData?.('ninjaArmGlow', null);
    }

    /** 拔刀首击蓄好时，红光固定在持刀手臂附近；普通几何光圈，不启用 per-object Filter。 */
    _syncNinjaArmGlow(member, sprite) {
        if (!member?._isHamsterNinja || !sprite) return;
        let glow = sprite.getData('ninjaArmGlow');
        if (!glow || !glow.aura?.active || !glow.core?.active) {
            glow = {
                aura: this.add.circle(0, 0, 11, 0xff1f2e, 0.24),
                core: this.add.circle(0, 0, 4, 0xff4050, 0.92),
            };
            glow.aura.setBlendMode(BlendModes.ADD);
            glow.core.setBlendMode(BlendModes.ADD);
            sprite.setData('ninjaArmGlow', glow);
        }
        const visible = !!(member._openingStrikeArmed && !member._isStealthed
            && !member._stealthCastActive && !member._dying && sprite.visible);
        this._setNinjaArmGlowVisible(sprite, visible);
        if (!visible) return;
        const norm = (member.displaySize || 258.33472) / 512;
        const direction = sprite.flipX ? -1 : 1;
        const x = sprite.x + direction * 24 * norm;
        const y = sprite.y + 122 * norm;
        const depth = sprite.depth + 0.02;
        glow.aura.setPosition(x, y).setScale(norm * 1.5).setDepth(depth);
        glow.core.setPosition(x, y).setScale(norm * 1.25).setDepth(depth + 0.01);
    }

    /**
     * 沙漠祭司施法光效：从配置读取当前 spelling 帧的杖首像素锚点，按精灵显示尺寸
     * 和 flipX 转换成世界坐标。这样举杖、落杖及左右转向时金光始终贴住法杖顶端。
     */
    _syncDesertPriestStaffFx(member, sprite, animations, dt) {
        if (!member?._isDesertPriest || !sprite) return;
        const spell = animations?.spell || {};
        const anchors = spell.staffTipFrames;
        const spellKey = `companion_${member.animId || member.id}_spell`;
        const active = member._animState === 'spell'
            && sprite.visible
            && sprite.texture?.key === spellKey
            && Array.isArray(anchors)
            && anchors.length > 0;
        if (!active) {
            this._disableDesertPriestStaffFx(member.id, sprite);
            return;
        }

        let frameIndex = Number(sprite.frame?.name);
        if (!Number.isInteger(frameIndex)) {
            frameIndex = Math.max(0, Number(sprite.anims?.currentFrame?.index || 1) - 1);
        }
        frameIndex = Math.max(0, Math.min(anchors.length - 1, frameIndex));
        const anchor = anchors[frameIndex];
        if (!Array.isArray(anchor) || anchor.length < 2) {
            this._disableDesertPriestStaffFx(member.id, sprite);
            return;
        }

        const frameWidth = Math.max(1, Number(spell.frameWidth) || Number(sprite.frame?.width) || 512);
        const frameHeight = Math.max(1, Number(spell.frameHeight) || Number(sprite.frame?.height) || 512);
        let localX = (Number(anchor[0]) - frameWidth * 0.5) * (sprite.displayWidth / frameWidth);
        if (sprite.flipX) localX = -localX;
        const localY = (Number(anchor[1]) - frameHeight * 0.5) * (sprite.displayHeight / frameHeight);
        const x = sprite.x + localX;
        const y = sprite.y + localY;
        const fx = spell.staffGlow || {};
        const raised = frameIndex >= 6 && frameIndex <= 12;
        const glowKey = `desert-priest-staff:${member.id}`;
        this.registerEnvironmentGlow(glowKey, x, y, {
            radius: Math.max(8, Number(fx.radius) || 30) * (raised ? 1.12 : 0.82),
            color: Number(fx.color) || 0xffd45c,
            alpha: Math.max(0.05, Number(fx.alpha) || 0.34) * (raised ? 1 : 0.72),
            depth: sprite.depth + 0.08,
            flicker: raised ? 0.22 : 0.15,
            pulsePeriodMs: Math.max(120, Number(fx.pulsePeriodMs) || 360),
        });
        this._desertPriestStaffGlowKeys.add(glowKey);

        const interval = Math.max(35, Number(fx.sparkIntervalMs) || 65);
        const elapsed = (Number(sprite.getData('desertPriestStaffSparkTimer')) || 0)
            + Math.max(0, Number(dt) || 0);
        if (elapsed >= interval) {
            sprite.setData('desertPriestStaffSparkTimer', elapsed % interval);
            if (this.isFogPointVisible(x, y)) {
                this._spawnDesertPriestStaffSpark(x, y, sprite.depth + 0.1, fx, raised);
            }
        } else {
            sprite.setData('desertPriestStaffSparkTimer', elapsed);
        }
    }

    _spawnDesertPriestStaffSpark(x, y, depth, fx, raised) {
        const textureKey = 'desert_priest_staff_spark';
        if (!this.textures.exists(textureKey)) {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0xffffff, 1);
            g.fillCircle(16, 16, 2.5);
            g.fillTriangle(16, 0, 13.8, 14, 18.2, 14);
            g.fillTriangle(16, 32, 13.8, 18, 18.2, 18);
            g.fillTriangle(0, 16, 14, 13.8, 14, 18.2);
            g.fillTriangle(32, 16, 18, 13.8, 18, 18.2);
            g.generateTexture(textureKey, 32, 32);
            g.destroy();
        }
        const radius = Math.max(4, Number(fx.sparkRadius) || 18);
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * radius * (raised ? 1 : 0.65);
        const spark = this.add.image(
            x + Math.cos(angle) * distance,
            y + Math.sin(angle) * distance,
            textureKey,
        );
        spark.setBlendMode(BlendModes.ADD);
        spark.setTint(Math.random() < 0.28
            ? (Number(fx.highlightColor) || 0xffe8a3)
            : (Number(fx.color) || 0xffd45c));
        spark.setDepth(depth);
        spark.setAlpha(0.95);
        spark.setScale(raised ? 0.34 : 0.24);
        spark.setAngle(Math.random() * 45);
        this._desertPriestStaffSparks.add(spark);
        const duration = Math.max(100, Number(fx.sparkDurationMs) || 280);
        this.tweens.add({
            targets: spark,
            alpha: 0,
            scaleX: raised ? 0.82 : 0.58,
            scaleY: raised ? 0.82 : 0.58,
            angle: spark.angle + (Math.random() < 0.5 ? -24 : 24),
            y: spark.y - 5 - Math.random() * 6,
            duration,
            ease: 'Sine.easeOut',
            onComplete: () => {
                this._desertPriestStaffSparks?.delete(spark);
                spark.destroy();
            },
        });
    }

    _disableDesertPriestStaffFx(memberId, sprite = null) {
        const glowKey = `desert-priest-staff:${memberId}`;
        this.unregisterEnvironmentGlow(glowKey);
        this._desertPriestStaffGlowKeys?.delete(glowKey);
        if (sprite) sprite.setData('desertPriestStaffSparkTimer', 0);
    }

    _clearDesertPriestStaffFx() {
        if (!this._desertPriestStaffGlowKeys) return;
        for (const glowKey of this._desertPriestStaffGlowKeys) {
            this.unregisterEnvironmentGlow(glowKey);
        }
        this._desertPriestStaffGlowKeys.clear();
        for (const sprite of Object.values(this._companionSprites || {})) {
            if (sprite?.active) sprite.setData('desertPriestStaffSparkTimer', 0);
        }
        for (const spark of this._desertPriestStaffSparks || []) {
            if (spark?.active) spark.destroy();
        }
        this._desertPriestStaffSparks?.clear();
    }

    /**
     * 动作切换残影（2026-08-21 零素材过渡）：单位贴图键切换瞬间，用旧贴图/旧帧
     * 在当前位置生成 alpha 0.32 的残影，110ms 淡出销毁——柔化 walk↔run↔idle↔attack
     * 硬切的顿挫感。每个队员同时至多一个残影（新切换顶掉旧的）；tween 由场景托管，
     * shutdown 自动清理。
     */
    _spawnCompanionGhost(id, texKey, frameName, dispW, dispH, sprite) {
        if (!texKey || !this.textures.exists(texKey)) return;
        if (!this._companionGhosts) this._companionGhosts = {};
        const prev = this._companionGhosts[id];
        if (prev && prev.active) prev.destroy();
        const ghost = this.add.sprite(sprite.x, sprite.y, texKey, frameName);
        ghost.setOrigin(0.5, 0.5);
        ghost.setDisplaySize(Math.max(1, dispW || 1), Math.max(1, dispH || 1));
        ghost.setFlipX(sprite.flipX);
        ghost.setDepth(sprite.depth - 0.05);
        ghost.setAlpha(0.32);
        this._companionGhosts[id] = ghost;
        this.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: 110,
            onComplete: () => {
                if (this._companionGhosts[id] === ghost) delete this._companionGhosts[id];
                ghost.destroy();
            },
        });
    }

    /** 选中光圈：金色椭圆贴脚（RTS 式选中标记，视角压扁）——填充 15% 透明、边缘 100% */
    _showSelectionRing(id, x, y, size) {
        let ring = this._selectionRings[id];
        if (!ring) {
            ring = this.add.ellipse(x, y, size * 1.05, size * 0.42, 0xd4af37, 0.15);
            ring.setStrokeStyle(2, 0xd4af37, 1.0);
            this._selectionRings[id] = ring;
        }
        // 深度跟随该成员精灵本身（精灵 - 0.2，低于精灵 - 0.1 的脚底阴影）：AI 队员的贴图深度由
        // _updateDynamicDepths 按世界 Y 每帧仲裁，这里读到的可能是上一帧仲裁值，
        // 仅作兜底——同帧精确值在 _updateDynamicDepths 2.5 段精灵 setDepth 后覆盖。
        // 此前光圈深度固定 playerSprite.depth + 0.42 只在创建时设一次：玩家/队友
        // 纵向移动后深度仲裁变化，光圈会盖到队友贴图上面（“图层应在贴图之下”实机反馈）。
        const unitSprite = this._companionSprites[id];
        if (unitSprite && unitSprite.active) ring.setDepth(unitSprite.depth - 0.2);
        ring.setPosition(x, y + size * 0.42);
        ring.setSize(size * 1.05, size * 0.42);
        ring.setVisible(true);
    }

    /** 右键目标标记：用地面 Y 算排序、用 Z 算屏幕落点；高架面再抬到承载层之上。 */
    showMoveMarker(x, groundY, z = 0, surfaceDepth = null) {
        if (this._moveMarkerGfx) {
            this._moveMarkerGfx.destroy();
            this._moveMarkerGfx = null;
        }
        const g = this.add.graphics();
        g.fillStyle(0x3dff6a, 0.85);
        g.fillTriangle(0, 0, -9, -20, 9, -20); // 箭头尖朝下（尖端 = 目标点）
        g.fillRect(-3, -38, 6, 20);            // 箭杆
        const displayY = groundY - (Number(z) || 0);
        const supportDepth = surfaceDepth == null ? NaN : Number(surfaceDepth);
        g.setPosition(x, displayY);
        g.setDepth(Math.max(
            groundY + 15,
            Number.isFinite(supportDepth) ? supportDepth + 2 : -Infinity
        ));
        this._moveMarkerGfx = g;
        this.tweens.add({
            targets: g, alpha: 0, duration: 400, delay: 800,
            onComplete: () => {
                g.destroy();
                if (this._moveMarkerGfx === g) this._moveMarkerGfx = null;
            },
        });
    }

    /** 侍从 idl 朝向用：找离该队员最近的敌人（member.target 失效时的兜底） */
    _nearestCompanionEnemy(member) {
        const Game = window.Game;
        if (!Game || !Game.entities || !member) return null;
        let best = null; let bestD = Infinity;
        for (const e of Game.entities.values()) {
            if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy') continue;
            const d = Math.hypot(e.x - member.x, e.y - member.y);
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    /** 侍从投射物渲染：露娜光球（蓝色 impact_dot）/ 仓鼠射手箭矢（projective 贴图旋转） */
    _syncCompanionBasics(_game) {
        if (!this._companionBasicSprites) this._companionBasicSprites = {};
        const members = this._prepareCompanionFrameSources(_game).allMembers;
        const liveKeys = new Set();
        for (const m of members) {
            if (!m || m.active === false) continue;
            for (const b of [...(m._inFlightBasics || []), m._basic]) {
                if (!b?.active) continue;
                const spriteKey = b._renderId ? `${m.id}:${b._renderId}` : String(m.id);
                liveKeys.add(spriteKey);
                let spr = this._companionBasicSprites[spriteKey];
                const rocket = !!b.antiVehicleRocket;
                const grenade = !!b.antiTankGrenade;
                const musket = !!m._isHamsterMusketeer;
                const sniper = !!m._isHamsterSniper;
                const ranged = m._isHamsterShooter || m._isHamsterScout;
                const projectileRender = m.config?.render || {};
                const tipLeft = projectileRender.projectileTipDirection
                    ? projectileRender.projectileTipDirection === 'left'
                    : m._isHamsterShooter;
                const projContentW = Math.max(1, Number(projectileRender.projectileContentWidth)
                    || (m._isHamsterShooter ? 146 : 172));
                const defaultArrowLength = 72 * ((m.displaySize || 226) / 226);
                const defaultProjectileLength = rocket ? 46
                    : (sniper ? 72 : (musket ? 54 : defaultArrowLength));
                const projectileLength = Math.max(1,
                    Number(rocket ? projectileRender.rocketProjectileLength
                        : projectileRender.projectileLength) || defaultProjectileLength);
                const projectileWidth = Math.max(1, Number(rocket
                    ? projectileRender.rocketProjectileWidth
                    : projectileRender.projectileWidth)
                    || (rocket ? 8 : (sniper ? 3 : 4)));
                const tailAtMuzzle = projectileRender.projectileTailAtMuzzle === true;
                const arrowKey = ranged ? `companion_${m.animId || m.id}_projectile` : null;
                const projectileKind = grenade ? 'anti_tank_grenade'
                    : (rocket ? 'anti_vehicle_rocket'
                        : (sniper ? 'sniper' : (musket ? 'musket' : (ranged ? 'ranged' : 'basic'))));
                if (spr && spr.getData('friendlyProjectileKind') !== projectileKind) {
                    spr.destroy();
                    spr = null;
                    delete this._companionBasicSprites[spriteKey];
                }
                if (!spr) {
                    if (grenade) {
                        const grenadeKey = `companion_${m.animId || m.id}_grenade`;
                        if (this.textures.exists(grenadeKey)) {
                            spr = this.add.sprite(b.x, b.y, grenadeKey, 0);
                            spr.setOrigin(
                                Number(projectileRender.grenadeProjectilePivot?.x) || 0.5,
                                Number(projectileRender.grenadeProjectilePivot?.y) || 0.5
                            );
                            spr.setDisplaySize(
                                Math.max(1, Number(projectileRender.grenadeProjectileWidth) || 52),
                                Math.max(1, Number(projectileRender.grenadeProjectileHeight) || 26)
                            );
                        } else {
                            spr = this.add.rectangle(b.x, b.y, 28, 8, 0x6f7445, 1);
                        }
                    } else if (rocket) {
                        const tube = this.add.rectangle(-projectileLength * 0.03, 0,
                            projectileLength * 0.78, projectileWidth, 0x6f7445, 1);
                        tube.setStrokeStyle(2, 0x2e3426, 1);
                        const nose = this.add.rectangle(projectileLength * 0.42, 0,
                            projectileLength * 0.18, projectileWidth * 0.75, 0x3d4330, 1);
                        const tail = this.add.rectangle(-projectileLength * 0.47, 0,
                            projectileLength * 0.12, projectileWidth * 1.5, 0x8c6f42, 1);
                        spr = this.add.container(b.x, b.y, [tube, nose, tail]);
                        spr.setSize(projectileLength, projectileWidth * 1.5);
                    } else if (musket || sniper) {
                        spr = this.add.rectangle(b.x, b.y, projectileLength, projectileWidth,
                            sniper ? 0xfff2b3 : 0xffd34d, 1);
                        spr.setBlendMode(BlendModes.ADD);
                    } else if (b.catapultStone && arrowKey && this.textures.exists(arrowKey)) {
                        spr = this.add.sprite(b.x, b.y, arrowKey);
                        spr.setDisplaySize(projectileRender.projectileDisplaySize,
                            projectileRender.projectileDisplaySize);
                    } else if (ranged && arrowKey && this.textures.exists(arrowKey)) {
                        // 弓、弩投射物都是 512 方形透明帧；按各兵种实测内容宽换算，
                        // 让 render.projectileLength 表示真正可见的箭身长度。
                        spr = this.add.sprite(b.x, b.y, arrowKey);
                        const frameDisplay = Math.round(projectileLength * 512 / projContentW);
                        spr.setDisplaySize(frameDisplay, frameDisplay);
                    } else {
                        if (!this.textures.exists('impact_dot') && typeof this._ensureImpactDotTexture === 'function') {
                            this._ensureImpactDotTexture();
                        }
                        spr = this.add.sprite(b.x, b.y, 'impact_dot');
                        spr.setTint(0x4db8ff);
                        spr.setBlendMode(BlendModes.ADD);
                        spr.setDisplaySize(24, 24);
                    }
                    spr.setData('friendlyProjectileKind', projectileKind);
                    this._companionBasicSprites[spriteKey] = spr;
                }
                const flightAngle = b.visualAngle ?? b.angle;
                const configuredVisualLead = Number(rocket
                    ? projectileRender.rocketProjectileLeadOffset
                    : projectileRender.projectileLeadOffset);
                const visualLead = tailAtMuzzle
                    ? (Number.isFinite(configuredVisualLead)
                        ? configuredVisualLead : projectileLength * 0.5)
                    : 0;
                const projectileY = Number.isFinite(b.z) ? b.y - b.z : b.y;
                spr.setPosition(
                    b.x + Math.cos(flightAngle) * visualLead,
                    projectileY + Math.sin(flightAngle) * visualLead
                );
                if (grenade) {
                    spr.setRotation(flightAngle);
                    if (spr.type === 'Sprite') {
                        spr.setDisplaySize(
                            Math.max(1, Number(projectileRender.grenadeProjectileWidth) || 52),
                            Math.max(1, Number(projectileRender.grenadeProjectileHeight) || 26)
                        );
                    }
                } else if (rocket) {
                    spr.setRotation(flightAngle);
                } else if (musket || sniper) {
                    spr.setRotation(flightAngle);
                    spr.setDisplaySize(projectileLength, projectileWidth);
                    spr.setBlendMode(BlendModes.ADD);
                } else if (ranged && arrowKey && this.textures.exists(arrowKey)) {
                    // 尖头方向：射手朝左旋转 +180°；斥候朝右直接旋转到飞行角
                    spr.setRotation(flightAngle + (tipLeft ? Math.PI : 0));
                    spr.setBlendMode(BlendModes.NORMAL);
                } else {
                    spr.setRotation(0);
                }
                spr.setDepth((b.y || 0) + 500);
                spr.setVisible(true);
            }
        }
        for (const [key, sprite] of Object.entries(this._companionBasicSprites)) {
            if (liveKeys.has(key)) continue;
            sprite.destroy();
            delete this._companionBasicSprites[key];
        }
        this._syncHeavyMachineGunTracers(members);
        this._syncDiscardedAntiVehicleLaunchers(members);
        this._syncAntiVehicleExplosions(members);
    }

    /** 重机枪并行曳光弹：逻辑由专属 AI 维护，Phaser 只同步短条视觉。 */
    _syncHeavyMachineGunTracers(members) {
        if (!this._heavyMachineGunTracerSprites) this._heavyMachineGunTracerSprites = {};
        const liveKeys = new Set();
        for (const member of members) {
            if (!member?._isHamsterHeavyMachineGunner || member.active === false) continue;
            const projectileRender = member.config?.render || {};
            const projectileLength = Math.max(1,
                Number(projectileRender.projectileLength) || 48);
            const projectileWidth = Math.max(1,
                Number(projectileRender.projectileWidth) || 3);
            const tailAtMuzzle = projectileRender.projectileTailAtMuzzle === true;
            for (const bullet of member._machineGunProjectiles || []) {
                if (!bullet?.active) continue;
                const key = `${member.id}:${bullet.id}`;
                liveKeys.add(key);
                let tracer = this._heavyMachineGunTracerSprites[key];
                if (!tracer) {
                    tracer = this.add.rectangle(
                        bullet.x, bullet.y, projectileLength, projectileWidth, 0xffd34d, 1);
                    tracer.setBlendMode(BlendModes.ADD);
                    this._heavyMachineGunTracerSprites[key] = tracer;
                }
                const flightAngle = bullet.visualAngle ?? bullet.angle;
                const configuredVisualLead = Number(projectileRender.projectileLeadOffset);
                const visualLead = tailAtMuzzle
                    ? (Number.isFinite(configuredVisualLead)
                        ? configuredVisualLead : projectileLength * 0.5)
                    : 0;
                const projectileY = Number.isFinite(bullet.z) ? bullet.y - bullet.z : bullet.y;
                tracer.setPosition(
                    bullet.x + Math.cos(flightAngle) * visualLead,
                    projectileY + Math.sin(flightAngle) * visualLead
                );
                tracer.setRotation(flightAngle);
                tracer.setDisplaySize(projectileLength, projectileWidth);
                tracer.setDepth((bullet.y || 0) + 500);
                tracer.setVisible(true);
            }
        }
        for (const [key, tracer] of Object.entries(this._heavyMachineGunTracerSprites)) {
            if (liveKeys.has(key)) continue;
            tracer.destroy();
            delete this._heavyMachineGunTracerSprites[key];
        }
    }

    /** 一次性火箭筒发射后的空筒抛弃视觉；逻辑位置与寿命由单位 AI 驱动。 */
    _syncDiscardedAntiVehicleLaunchers(members) {
        if (!this._discardedAntiVehicleLaunchers) this._discardedAntiVehicleLaunchers = {};
        const liveKeys = new Set();
        for (const member of members) {
            if (!member?._isHamsterAntiVehicle) continue;
            const launcher = member._discardedLauncher;
            let visual = this._discardedAntiVehicleLaunchers[member.id];
            if (!launcher?.active || member.active === false) {
                if (visual) visual.setVisible(false);
                continue;
            }
            if (!visual) {
                const tube = this.add.rectangle(0, 0, 40, 7, 0x73784a, 1);
                tube.setStrokeStyle(2, 0x303527, 1);
                const rear = this.add.rectangle(-23, 0, 7, 11, 0x8d7046, 1);
                visual = this.add.container(launcher.x, launcher.y, [tube, rear]);
                visual.setSize(50, 13);
                this._discardedAntiVehicleLaunchers[member.id] = visual;
            }
            liveKeys.add(String(member.id));
            visual.setPosition(launcher.x, launcher.y - Math.max(0, Number(launcher.z) || 0));
            visual.setRotation(launcher.angle || 0);
            visual.setAlpha(Math.min(1, Math.max(0, launcher.lifeMs / 220)));
            visual.setDepth((launcher.y || 0) + 490);
            visual.setVisible(true);
        }
        for (const [key, visual] of Object.entries(this._discardedAntiVehicleLaunchers)) {
            if (liveKeys.has(key)) continue;
            visual.destroy();
            delete this._discardedAntiVehicleLaunchers[key];
        }
    }

    /** 火箭命中爆心：短促扩张闪光，仅负责 Phaser 视觉，不参与伤害判定。 */
    _syncAntiVehicleExplosions(members) {
        if (!this._antiVehicleExplosionVisuals) this._antiVehicleExplosionVisuals = {};
        const liveKeys = new Set();
        for (const member of members) {
            if (!member?._isHamsterAntiVehicle && !member?._isHamsterAntiTankRifleman) continue;
            const explosion = member._antiVehicleExplosion;
            let visual = this._antiVehicleExplosionVisuals[member.id];
            if (!explosion?.active || member.active === false) {
                if (visual) visual.setVisible(false);
                continue;
            }
            if (!visual) {
                const outer = this.add.circle(0, 0, 34, 0xff7a1a, 0.42);
                outer.setStrokeStyle(4, 0xffd06a, 0.85);
                const core = this.add.circle(0, 0, 14, 0xfff2bd, 0.9);
                visual = this.add.container(explosion.x, explosion.y, [outer, core]);
                visual.setSize(76, 76);
                this._antiVehicleExplosionVisuals[member.id] = visual;
            }
            liveKeys.add(String(member.id));
            const progress = 1 - Math.max(0, explosion.lifeMs) / Math.max(1, explosion.maxLifeMs);
            visual.setPosition(explosion.x, explosion.y - (Number(explosion.z) || 0));
            visual.setScale(0.35 + progress * 1.15);
            visual.setAlpha(1 - progress);
            visual.setDepth((explosion.y || 0) + 505);
            visual.setVisible(true);
        }
        for (const [key, visual] of Object.entries(this._antiVehicleExplosionVisuals)) {
            if (liveKeys.has(key)) continue;
            visual.destroy();
            delete this._antiVehicleExplosionVisuals[key];
        }
    }

    _syncBodiesToPhysics() {
        const Game = window.Game;
        if (!Game) return;

        // 让 Arcade Body 的碰撞中心保持在逻辑脚底，同时 Sprite 中心向上偏移 footOffsetY。
        // 注意：body.reset(x,y) 会把 GameObject 也移到 (x,y)，所以必须传入偏移后的 Sprite 坐标。
        const applyBodyFootOffset = (sprite, shiftY) => {
            const body = sprite.body;
            if (!body) return;
            // Arcade offset 是“源像素”单位，需要除以 scaleY。
            const scaleY = Math.abs(sprite.scaleY) || 1;
            body.setOffset(body.offset.x, shiftY / scaleY);
        };

        // 玩家：如果启用 velocity 驱动，从 Phaser 同步位置回 Player
        if (this._useVelocityDrive && Game.player && this.playerSprite && this.playerSprite.body) {
            const playerShift = this._getFootOffsetY(Game.player, this.playerSprite);
            Game.player.footOffsetY = playerShift;
            applyBodyFootOffset(this.playerSprite, playerShift);

            // 初始化：如果 playerSprite 在 (0,0) 或远离玩家，同步一次位置
            // playerSprite.y 是贴图中心，Game.player.y 是逻辑脚底，需要减去 footOffsetY
            const distToPlayer = Math.sqrt(
                (this.playerSprite.x - Game.player.x) ** 2 +
                (this.playerSprite.y - (Game.player.y - playerShift)) ** 2
            );
            if (distToPlayer > 100) {
                this.playerSprite.body.reset(Game.player.x, Game.player.y - playerShift);
            }

            // 如果玩家在闪避，Player 直接设置位置，需要同步到 Phaser
            if (Game.player.isDodging) {
                this.playerSprite.body.reset(Game.player.x, Game.player.y - playerShift);
                this.playerSprite.body.setVelocity(0, 0);
            }

            // 正常：从 Phaser 同步位置到 Player
            // 注意：只同步位置，不同步速度！
            // 把贴图中心坐标转回逻辑脚底坐标
            Game.player.x = this.playerSprite.x;
            Game.player.y = this.playerSprite.y + playerShift;
            this._syncPlayerHandLayer();
            // 边界检查
            if (Game.player.x < -CONFIG.WORLD_WIDTH || Game.player.x > CONFIG.WORLD_WIDTH * 2 ||
                Game.player.y < -CONFIG.WORLD_HEIGHT || Game.player.y > CONFIG.WORLD_HEIGHT * 2) {
                Game.player.x = Math.max(-CONFIG.WORLD_WIDTH, Math.min(CONFIG.WORLD_WIDTH * 2, Game.player.x));
                Game.player.y = Math.max(-CONFIG.WORLD_HEIGHT, Math.min(CONFIG.WORLD_HEIGHT * 2, Game.player.y));
                this.playerSprite.body.reset(Game.player.x, Game.player.y - playerShift);
            }
            return;
        }

        // 原有模式：同步位置到物理体（用于碰撞检测）
        if (Game.player && this.playerSprite && this.playerSprite.body) {
            const playerShift = this._getFootOffsetY(Game.player, this.playerSprite);
            // 高架单位按脚底 z 抬升渲染，
            // 走上楼梯时深度随脚底高度变化。
            const elevationZ = Game.player.z || 0;
            Game.player.footOffsetY = playerShift;
            this.playerSprite.setPosition(Game.player.x, Game.player.y - playerShift - elevationZ);
            this._syncPlayerHandLayer();
            applyBodyFootOffset(this.playerSprite, playerShift);
            this.playerSprite.body.reset(Game.player.x, Game.player.y - playerShift - elevationZ);
        }

        // 同步所有敌人（自动为缺失 Sprite 的敌人创建占位 Sprite）
        Game.entities.forEach((entity) => {
            if (!entity || entity === Game.player) return;
            // 掉落物：位置/深度由 DropItem._syncPhaserSprite 自管（上下浮动 bob），
            // 此处每帧强写 (x, y - displayHeight/2) 会冲掉 bob 并抬高贴图——跳过
            if (entity.itemData && entity.noCollision) return;
            const isCorpse = Game.isPreservedCorpse(entity);
            if (!entity.active && !isCorpse) return;
            const inViewport = this._isEntityInRenderViewport(entity);
            entity._viewportRenderVisible = inViewport;
            if (!inViewport) {
                this._setViewportEntityHidden(entity, true);
                return;
            }
            this._setViewportEntityHidden(entity, false);
            // 入侵特工（_faction === 'agent'）与敌人同口径创建精灵图——
            // 此前仅 'enemy'，入侵特工永远拿不到 sprite，只能画成 neutral_circle 占位圆（动画全消失）
            // Enemy siege walls use the same static structure renderer as player walls.
            if (entity._strategicFortification && !entity._isCoverGate) return;
            if ((entity._faction === 'enemy' || entity._faction === 'agent') && (!entity._phaserSprite || !entity._phaserSprite.active)) {
                const wanted = (typeof entity._getTextureKey === 'function')
                    ? entity._getTextureKey()
                    : 'enemy_circle';
                this.getOrCreateEnemySprite(entity, wanted);
            }
            if (!entity._phaserSprite) return;
            // 直接同步 Sprite 位置；若配置了 footOffsetY，把逻辑位置对齐到贴图脚底
            let syncX = entity.x, syncY = entity.y;
            if (entity._attackDashOffset > 0 && !entity._dashBlocked) {
                const offset = typeof entity._getDashOffset === 'function'
                    ? entity._getDashOffset()
                    : { x: 0, y: 0 };
                syncX += offset.x;
                syncY += offset.y;
            }
            const shiftY = this._getFootOffsetY(entity, entity._phaserSprite);
            entity.footOffsetY = shiftY;
            const siegeElevation = entity._strategicGarrison ? (Number(entity.z) || 0) : 0;
            entity._phaserSprite.setPosition(syncX, syncY - shiftY - siegeElevation);
            if (usesBuildingFootprintVolume(entity)) {
                this._applyStructureVisualSize(entity, entity._phaserSprite);
                this._syncStructureOcclusionVisualBounds(entity, [entity._phaserSprite]);
            }
            if (entity._phaserSprite.body) {
                applyBodyFootOffset(entity._phaserSprite, shiftY);
                entity._phaserSprite.body.reset(syncX, syncY - shiftY - siegeElevation);
            }
            if (!entity._strategicFortification && (entity._faction === 'enemy' || entity._faction === 'agent')) {
                this._syncEnemyAnimation(entity);
            }
            // 不旋转，仅通过 flipX 控制朝向（与玩家一致）
            // if (entity.rotation !== undefined) {
            //     entity._phaserSprite.setRotation(entity.rotation + Math.PI / 2);
            // }
        });
    }

    /**
     * Phase 4: 统一动态实体深度排序
     * 让玩家、敌人、武器、技能特效都按世界 Y 坐标与环境墙壁/树木在同一深度空间排序。
     * 在 _syncBodiesToPhysics 之后调用，确保 Sprite 位置已更新。
     */
    _wallTowerForegroundBand(entity) {
        const surface = entity?._surfaceWall;
        // 高差切换仍以真实 _surfaceWall 为准；图层则从脚底圆首次触及连接面开始
        // 预取塔楼前景遮挡，消除普通墙→塔楼中心归属切换前的一帧闪层。
        const transitionOccluder = entity?._surfaceForegroundOccluder;
        const owner = transitionOccluder?.active
            ? transitionOccluder
            : (surface?._wallTowerOwner
                || (surface?._isWallTower && surface?._wallTowerWalk ? surface : null));
        const foreground = owner?.spriteCfg?.foregroundOverlay;
        if (!owner?.active || foreground?.depthMode !== 'wallTowerParapet') return null;
        const baseDepth = Number(owner._structureRenderDepth);
        if (!Number.isFinite(baseDepth)) return null;
        const foregroundOffset = Number.isFinite(Number(foreground.depthOffset))
            ? Number(foreground.depthOffset)
            : 0.45;
        const unitClearance = Math.max(0.02,
            Number(foreground.unitClearance) || 0.12);
        return {
            owner,
            foregroundDepth: baseDepth + foregroundOffset,
            maxUnitDepth: baseDepth + foregroundOffset - unitClearance,
            surfaceOffset: Math.max(0.01,
                Number(owner._wallTowerWalk?.surfaceDepthOffset) || 0.08),
        };
    }

    _resolveElevatedSurfaceDepth(entity, depth, surfaceDepth) {
        const band = this._wallTowerForegroundBand(entity);
        const floor = surfaceDepth + (band?.surfaceOffset ?? 1);
        const raised = Math.max(depth, floor);
        return band ? Math.min(raised, band.maxUnitDepth) : raised;
    }

    _capWallTowerForegroundDepth(entity, depth) {
        const band = this._wallTowerForegroundBand(entity);
        return band ? Math.min(depth, band.maxUnitDepth) : depth;
    }

    _groundContactDepth(baseDepth, groundContactCfg = null) {
        // 只有显式拆出的地台沉到共享阴影下；旧墙脚覆盖层继续跟随建筑后置通道。
        return groundContactCfg?.depthMode === 'ground'
            ? WORLD_RENDER_LAYERS.STRUCTURE_GROUND_CONTACT
            : baseDepth - 0.04;
    }

    _foregroundOverlayDepth(entity, baseDepth, foregroundCfg = null) {
        const cfg = foregroundCfg || entity?.spriteCfg?.foregroundOverlay;
        if (entity?._isWallTower && cfg?.depthMode === 'wallTowerParapet') {
            return baseDepth + (Number.isFinite(Number(cfg.depthOffset))
                ? Number(cfg.depthOffset)
                : 0.45);
        }
        return entity?._structureRenderChannels?.frontFx ?? (baseDepth + 0.04);
    }

    /**
     * 塔楼前缘是盖住塔顶单位的独立遮挡层，但它不是独立的地面 footprint 节点。
     * 当一格墙只在塔楼前侧共边/共顶点时，2x2 塔楼与 1x1 墙的常规歧义排序可能
     * 只比较主体基础深度，使塔楼前缘的额外 depth 反盖到本应位于前方的墙上。
     */
    _wallTowerFrontEdgeTouches(towerBounds, wallBounds, tolerance = 1.5) {
        if (!towerBounds || !wallBounds) return false;
        const intervalTouches = (aMin, aMax, bMin, bMax) =>
            Math.min(aMax, bMax) >= Math.max(aMin, bMin) - tolerance;
        const touchesFrontU = Math.abs(wallBounds.minU - towerBounds.maxU) <= tolerance
            && intervalTouches(towerBounds.minV, towerBounds.maxV, wallBounds.minV, wallBounds.maxV);
        const touchesFrontV = Math.abs(wallBounds.minV - towerBounds.maxV) <= tolerance
            && intervalTouches(towerBounds.minU, towerBounds.maxU, wallBounds.minU, wallBounds.maxU);
        return touchesFrontU || touchesFrontV;
    }

    /**
     * 为塔楼前侧相接墙补齐结构级 depth 槽。这里只抬高墙节点的本轮拓扑基准，
     * 不污染墙的几何 _faceDepth，也不改变塔楼后侧墙与塔顶单位的遮挡关系。
     */
    _applyWallTowerFrontWallDepthFloors(nodes, resolvedDepths) {
        const towers = nodes.filter((node) => node.entity?._isWallTower);
        const walls = nodes.filter((node) => node.entity?._isBlockCover
            && !node.entity?._wallTowerOwner);
        const battlements = nodes.filter((node) => node.entity?._isWallBattlement);
        let changed = false;
        for (const towerNode of towers) {
            const towerDepth = resolvedDepths.get(towerNode.stableKey);
            if (!Number.isFinite(towerDepth)) continue;
            const foregroundCfg = towerNode.entity?.spriteCfg?.foregroundOverlay;
            const foregroundOffset = foregroundCfg?.depthMode === 'wallTowerParapet'
                && Number.isFinite(Number(foregroundCfg.depthOffset))
                ? Number(foregroundCfg.depthOffset)
                : 0.45;
            // 正常静态结构间隔已经足以越过塔楼前缘；若以后提高前缘偏移，仍至少
            // 留出一个很小的稳定先后差，避免 Phaser 同 depth 时依赖创建顺序。
            const requiredGap = Math.max(STRUCTURE_ORDER_GAP, foregroundOffset + 0.04);
            for (const wallNode of walls) {
                if (!this._wallTowerFrontEdgeTouches(towerNode.bounds, wallNode.bounds)) continue;
                // 防止容差把塔楼后侧/横跨节点误判为前墙；明确在塔后者绝不抬高。
                if (compareIsoBoundsOrder(towerNode.bounds, wallNode.bounds) > 0) continue;
                const requiredDepth = towerDepth + requiredGap;
                const connectedNodes = [
                    wallNode,
                    ...battlements.filter((node) =>
                        node.entity?._wallBattlementAttachment?.wall === wallNode.entity),
                ];
                for (const connectedNode of connectedNodes) {
                    if (connectedNode.baseDepth + 0.001 >= requiredDepth) continue;
                    connectedNode.baseDepth = requiredDepth;
                    changed = true;
                }
            }
        }
        return changed;
    }

    _updateDynamicDepths() {
        const Game = window.Game;
        if (!Game) return;
        const depthStats = this._dynamicDepthStats || (this._dynamicDepthStats = {
            frameWrites: 0,
            frameRedundantSkips: 0,
            totalWrites: 0,
            totalRedundantSkips: 0,
        });
        depthStats.frameWrites = 0;
        depthStats.frameRedundantSkips = 0;
        // 结构候选每帧只从实体表提取一次；此前玩家/每只敌人/每只友军都会各自
        // 重扫整张 Game.entities，单位和建筑越多，图层仲裁的重复开销越明显。
        const structureCandidates = [
            ...WallSystem.collectDynamicStructureDepthEntities(Game.entities),
            ...(Game.player?.iceWallSystem?.getDepthOccluders?.() || []),
        ];
        // 纯视觉平民不在 Game.entities：其最终 depth 也必须在本帧建筑拓扑排序完成后
        // 统一落地，不能由风车/工坊/银行的业务 update 提前各写一遍旧结构深度。
        syncAllCivilianVisualDepths(structureCandidates);
        // 道路立体小物不是实体，但与单位一样必须按脚点参与建筑前后仲裁；
        // 路缘、脚印和积水仍由固定 ROAD_EDGE / ROAD_DECAL 地表层管理。
        RoadsideDecorationSystem.syncStructureDepths(
            structureCandidates,
            this._structureOrderCache?.signature || ''
        );
        const raiseElevatedAboveLowerUnits = (entity, sprite, depth) => {
            if (!entity || !sprite || (Number(entity.z) || 0) <= 1 || !Game.entities) {
                return depth;
            }
            const invScale = 1 / PERSPECTIVE_SCALE_Y;
            let resolvedDepth = depth;
            const queryRadius = (Number(entity.groundRadius) || 20) + 140;
            const lowerCandidates = SpatialPartitionSystem?.queryRadius
                ? SpatialPartitionSystem.queryRadius(entity.x, entity.y, queryRadius, entity)
                : Game.entities.values();
            for (const lower of lowerCandidates) {
                if (!lower || lower === entity || !lower.active || lower._isDefenseStructure) continue;
                const lowerSprite = lower._phaserSprite;
                if (!lowerSprite?.active) continue;
                if (!isEntityStrictlyBelow(lower, entity)) continue;
                const dx = lower.x - entity.x;
                const dy = (lower.y - entity.y) * invScale;
                const nearRadius = (Number(entity.groundRadius) || 20)
                    + (Number(lower.groundRadius) || 20) + 16;
                if (dx * dx + dy * dy > nearRadius * nearRadius) continue;
                resolvedDepth = Math.max(resolvedDepth, lowerSprite.depth + 0.1);
            }
            return resolvedDepth;
        };

        // 1. 玩家：深度基于脚底 Y（Sprite.y + footOffsetY）
        let playerNatural = 0, playerCorrected = 0;
        if (Game.player && this.playerSprite && this.playerSprite.active) {
            const footOffsetY = this._getFootOffsetY(Game.player, this.playerSprite);
            const depthProfile = this._getDynamicDepthProfile(
                Game.player,
                this.playerSprite,
                footOffsetY
            );
            // 高架单位的自然深度与脚底 z 同步，墙顶面线继续参与仲裁。
            playerNatural = depthProfile.naturalDepth;
            playerCorrected = WallSystem.resolveDynamicEntityDepth(
                Game.player.x,
                Game.player.y,
                playerNatural,
                depthProfile.frontRange,
                depthProfile.sideRange,
                depthProfile.visibleWorldBounds,
                structureCandidates
            );
            // 楼梯单位最低保证绘制在当前楼梯分段之上。
            const staircase = Game.player._surfaceStaircase;
            if (staircase && staircase._faceDepth != null && Game.player.z > 0) {
                playerCorrected = Math.max(playerCorrected, staircase._faceDepth + 1);
            }
            const playerSurfaceDepth = Number(Game.player?._surfaceRenderDepth);
            if ((Game.player?._surfaceKind === 'wall_walk'
                || Game.player?._surfaceKind === 'stairs')
                && Number.isFinite(playerSurfaceDepth)
                && (Number(Game.player?.z) || 0) > 0) {
                playerCorrected = this._resolveElevatedSurfaceDepth(
                    Game.player, playerCorrected, playerSurfaceDepth);
            }
            setVisualDepthIfChanged(this.playerSprite, playerCorrected, depthStats);
        }

        // 2. 敌人 / 尸体：与玩家、军事友军共用逻辑脚底 depth 档案和建筑仲裁，
        // 禁止在敌人分支恢复 sprite.y + footOffsetY 作为自然深度。
        if (Game.entities) {
            Game.entities.forEach(e => {
                if (!e || e === Game.player) return;
                // 掉落物：深度自管（随浮动贴图），不参与实体深度覆写
                if (e.itemData && e.noCollision) return;
                // 静态结构已由 _syncStructureRenderOrder 按完整 footprint 拓扑落深度；
                // 禁止再按动态单位的脚点 Y 覆写，否则房屋/官邸等高体量建筑会整栋错误压住单位。
                if (e._structureDepthMode || e._isDefenseStructure || usesBuildingFootprintVolume(e)) return;
                const isCorpse = Game.isPreservedCorpse(e);
                if (!e.active && !isCorpse) return;
                if (e._viewportRenderVisible === false) return;
                const sprite = e._phaserSprite;
                if (!sprite || !sprite.active) return;
                const footOffsetY = this._getFootOffsetY(e, sprite);
                const depthProfile = this._getDynamicDepthProfile(e, sprite, footOffsetY);
                let d = WallSystem.resolveDynamicEntityDepth(
                    e.x,
                    e.y,
                    depthProfile.naturalDepth - (isCorpse ? 8 : 0),
                    depthProfile.frontRange,
                    depthProfile.sideRange,
                    depthProfile.visibleWorldBounds,
                    structureCandidates
                );
                const surfaceDepth = Number(e._surfaceRenderDepth);
                if ((e._surfaceKind === 'wall_walk' || e._surfaceKind === 'stairs')
                    && Number.isFinite(surfaceDepth)
                    && (Number(e.z) || 0) > 0) {
                    d = this._resolveElevatedSurfaceDepth(e, d, surfaceDepth);
                }
                setVisualDepthIfChanged(sprite, d, depthStats);
            });
        }
        if (this.playerSprite?.active && Game.player) {
            playerCorrected = raiseElevatedAboveLowerUnits(
                Game.player,
                this.playerSprite,
                playerCorrected
            );
            playerCorrected = this._capWallTowerForegroundDepth(
                Game.player, playerCorrected);
            setVisualDepthIfChanged(this.playerSprite, playerCorrected, depthStats);
        }

        // 2.5 侍从跟随精灵：AI 队员按自身世界 Y 排序；纯渲染队员按实际显示脚线排序。
        // 两者都必须参与建筑/墙体仲裁，不能固定跟随玩家 depth。
        if (this._companionSprites) {
            const companionById = this._prepareCompanionFrameSources(Game).byId;
            for (const cid in this._companionSprites) {
                if (!Object.prototype.hasOwnProperty.call(this._companionSprites, cid)) continue;
                const sprite = this._companionSprites[cid];
                if (!sprite || !sprite.active || !sprite.visible) continue;
                const unit = companionById.get(cid);
                if (!unit) continue;
                // 与友军阴影同一锚点口径（2026-08-21）：footOffsetY 显式配置优先（仓鼠系），
                // 无配置实测帧内容底边——v2 管线脚底基线在 0.9375×格高，格底兜底会偏深 ~14px
                const cfgFootD = unit.footOffsetY ?? unit.config?.render?.footOffsetY;
                const footOffsetY = (typeof cfgFootD === 'number')
                    ? cfgFootD
                    : sprite.displayHeight * (this._getVisibleFrameBottomRatio(sprite) - 0.5);
                // AI 单位使用权威逻辑脚线；无 AI 的纯跟随队员没有独立世界坐标，必须按其
                // 实际渲染脚线仲裁。旧代码直接跳过后者，使其永久停在 playerDepth+0.5，
                // 与建筑前缘完全脱钩。
                const worldAnchored = !!unit.aiConfig
                    && Number.isFinite(unit.x) && Number.isFinite(unit.y);
                const depthX = worldAnchored ? unit.x : sprite.x;
                const depthY = worldAnchored ? unit.y : (sprite.y + footOffsetY);
                const logicalFootY = worldAnchored
                    ? unit.y - (Number(unit.z) || 0)
                    : depthY;
                const depthProfile = resolveSpriteDepthProfile(unit, sprite, {
                    footOffsetY,
                    logicalX: depthX,
                    logicalFootY,
                    minFrontRange: 60,
                    maxFrontRange: 280,
                });
                let d = WallSystem.resolveDynamicEntityDepth(
                    depthX,
                    depthY,
                    depthProfile.naturalDepth,
                    depthProfile.frontRange,
                    depthProfile.sideRange,
                    depthProfile.visibleWorldBounds,
                    structureCandidates
                );
                // 楼梯单位保证绘制在当前楼梯分段之上。
                const staircase = worldAnchored ? unit._surfaceStaircase : null;
                if (staircase && staircase._faceDepth != null && unit.z > 0) {
                    d = Math.max(d, staircase._faceDepth + 1);
                }
                const surfaceDepth = Number(unit._surfaceRenderDepth);
                if (worldAnchored
                    && (unit._surfaceKind === 'wall_walk' || unit._surfaceKind === 'stairs')
                    && Number.isFinite(surfaceDepth)
                    && (Number(unit.z) || 0) > 0) {
                    d = this._resolveElevatedSurfaceDepth(unit, d, surfaceDepth);
                }
                if (worldAnchored) d = raiseElevatedAboveLowerUnits(unit, sprite, d);
                if (worldAnchored) d = this._capWallTowerForegroundDepth(unit, d);
                setVisualDepthIfChanged(sprite, d, depthStats);
                const ghost = this._companionGhosts?.[cid];
                if (ghost?.active) setVisualDepthIfChanged(ghost, d - 0.05, depthStats);
                const staffGlow = this._persistentEnvironmentGlows?.get(
                    `desert-priest-staff:${cid}`
                );
                if (staffGlow) staffGlow.depth = d + 0.08;
                // 选中光圈同帧跟随该队员最终深度（贴图之下 0.2，同时低于阴影）：
                // 光圈必须低于该单位所有贴图，且随 Y 排序仲裁一起变化。
                if (this._selectionRings && this._selectionRings[cid]) {
                    setVisualDepthIfChanged(this._selectionRings[cid], d - 0.2, depthStats);
                }
                // 非 Party 成员友军的 RTS 黄圈由 rts-command 持有；这里在本体完成
                // 当帧建筑/墙体仲裁后回写，避免跨越遮挡线时读取上一帧深度。
                Game.RTSCommand?.syncAllyRingDepth?.(unit, d);
            }
        }

        // 3. 玩家手持武器 / 盾牌跟随玩家深度，保持相对层级。
        // 玩家被墙压下（仲裁后 depth < 自然 depth）时跟随件改用 <0.5 的紧凑偏移——
        // 否则 +2/+1 的常规偏移会浮到遮挡墙之上（武器/盾牌穿墙显示）
        const playerDepth = (this.playerSprite && this.playerSprite.active) ? this.playerSprite.depth : 0;
        const towerParapetOccluded = !!this._wallTowerForegroundBand(Game.player);
        const occluded = towerParapetOccluded
            || (!!(this.playerSprite && this.playerSprite.active) && playerCorrected < playerNatural);
        const weaponOff = towerParapetOccluded ? 0.06 : (occluded ? 0.4 : 2);
        const offhandOff = towerParapetOccluded ? 0.05 : (occluded ? 0.3 : 1);
        const shieldOff = towerParapetOccluded ? 0.04 : (occluded ? 0.2 : 1);
        if (this.weaponSprite && this.weaponSprite.active) {
            setVisualDepthIfChanged(this.weaponSprite, playerDepth + weaponOff, depthStats);
            if (!this._pushStrikeWeaponDepth?.syncDepth(playerDepth, occluded, weaponOff)) {
                this._whirlwindWeaponDepth?.syncDepth(playerDepth, occluded, weaponOff);
            }
        }
        if (this.offhandWeaponSprite && this.offhandWeaponSprite.active) {
            setVisualDepthIfChanged(this.offhandWeaponSprite, playerDepth + offhandOff, depthStats);
        }
        if (this.shieldSprite && this.shieldSprite.active) {
            // 攻击副手甩到身后时，盾随源帧退到躯干后；仍沿本帧建筑/墙垛深度仲裁。
            const shieldPoseOffset = this._playerShieldRig?.shieldBehindBody ? -0.01 : shieldOff;
            setVisualDepthIfChanged(this.shieldSprite, playerDepth + shieldPoseOffset, depthStats);
        }
        this._playerShieldRig?.syncDepth(playerDepth, weaponOff);
        this._swordShieldMotion?.syncDepth(playerDepth, weaponOff);
        // 手部分层：恒在武器之上（身体 + 常规偏移之上再 +1）
        if (this.playerHandSprite && this.playerHandSprite.active) {
            const handOff = towerParapetOccluded ? 0.08 : (occluded ? 0.5 : 3);
            setVisualDepthIfChanged(this.playerHandSprite, playerDepth + handOff, depthStats);
        }
        // 枪械姿态的躯干/手臂在动态仲裁前按上一帧 player depth 写入；这里必须跟随
        // 本帧最终深度重落，否则跨建筑前缘时会出现身体已翻层、上半身仍被建筑遮住一帧。
        if (this.playerTorsoSprite?.active && this.playerTorsoSprite.visible) {
            setVisualDepthIfChanged(this.playerTorsoSprite, playerDepth + 0.01, depthStats);
        }
        if (this.playerArmSprite?.active && this.playerArmSprite.visible) {
            setVisualDepthIfChanged(this.playerArmSprite, playerDepth + 0.02, depthStats);
        }
        if (this.playerSupportArmSprite?.active && this.playerSupportArmSprite.visible) {
            setVisualDepthIfChanged(this.playerSupportArmSprite, playerDepth + 0.02, depthStats);
        }
        if (this.playerFiringHandSprite?.active && this.playerFiringHandSprite.visible) {
            // 后手指骨必须盖住后握把，才能形成“包握”而不是枪漂在拳头前面。
            const firingHandOff = towerParapetOccluded ? 0.08 : (occluded ? 0.5 : 3);
            setVisualDepthIfChanged(this.playerFiringHandSprite, playerDepth + firingHandOff, depthStats);
        }

        // 4. 防御光环位于玩家下方
        if (this.defenseGlow && this.defenseGlow.active) {
            setVisualDepthIfChanged(this.defenseGlow, playerDepth - 2, depthStats);
        }

        // 5. 魔法/技能特效按自身世界 Y 排序（符文剑/冰锥为浮空件，深度改由各同步函数按施法者精灵设置）
        for (const s of this.iceSpikeGroup.getChildren()) {
            if (s && s.active) setVisualDepthIfChanged(s, s.y + 15, depthStats);
        }
        if (this.fireballSprite && this.fireballSprite.active) {
            setVisualDepthIfChanged(this.fireballSprite, this.fireballSprite.y + 15, depthStats);
        }
        for (const s of this.iceSpikeFlyGroup.getChildren()) {
            if (s && s.active) setVisualDepthIfChanged(s, s.y + 15, depthStats);
        }
        if (this.fireballFlySprite && this.fireballFlySprite.active) {
            setVisualDepthIfChanged(this.fireballFlySprite, this.fireballFlySprite.y + 15, depthStats);
        }

        // 其他施法者（敌人巫师等）的特效
        if (this._magicSprites) {
            for (const [caster, sprites] of this._magicSprites) {
                if (sprites.iceSpikes) {
                    sprites.iceSpikes.forEach(s => {
                        if (s && s.active) setVisualDepthIfChanged(
                            s,
                            this._projectileDepth(caster, s._skillGroundY, s._skillDepthContext),
                            depthStats
                        );
                    });
                }
                if (sprites.iceSpikeFly) {
                    sprites.iceSpikeFly.forEach(s => {
                        if (s && s.active) setVisualDepthIfChanged(
                            s,
                            this._projectileDepth(caster, s._skillGroundY, s._skillDepthContext),
                            depthStats
                        );
                    });
                }
                if (sprites.fireballEmitters) {
                    let fireballDepth = null;
                    sprites.fireballEmitters.forEach(em => {
                        if (!em || !em.visible) return;
                        fireballDepth = this._projectileDepth(
                            caster,
                            em._skillGroundY,
                            em._skillDepthContext
                        );
                        setVisualDepthIfChanged(em, fireballDepth, depthStats);
                    });
                    const glowKey = `fireball:${caster.id || caster.name || 'unknown'}`;
                    const glow = this._persistentEnvironmentGlows?.get(glowKey);
                    if (glow && fireballDepth != null) glow.depth = fireballDepth + 0.1;
                }
            }
        }

        // 6. 无人机及其文字
        if (this.droneSprite && this.droneSprite.active) {
            const droneDepth = this.droneSprite.y + 18;
            setVisualDepthIfChanged(this.droneSprite, droneDepth, depthStats);
            if (this.droneText && this.droneText.active) {
                setVisualDepthIfChanged(this.droneText, droneDepth + 1, depthStats);
            }
        }

        // 7. 中立实体（NPC / 训练靶）统一深度
        if (this._neutralSprites) {
            for (const [e, data] of this._neutralSprites.entries()) {
                if (!e || !e.active || !data.sprite || !data.sprite.active) continue;
                if (e._isWallStaircase && Array.isArray(data.segmentSprites)) {
                    // 分段楼梯已在 _syncWallStaircaseEntity 按各段承载面落深度。
                    if (data.label?.active) data.label.setVisible(false);
                    continue;
                }
                // 静态结构已在 _syncNeutralEntities 写入缓存深度，并由
                // _syncStructureRenderOrder 在拓扑变化时覆盖最终值；动态单位阶段不得第三次重写。
                if (data.sprCfg?.depthMode === 'ground'
                    || e._isMainHubArchitectureOccluder
                    || e._structureDepthMode
                    || e._isDefenseStructure
                    || usesBuildingFootprintVolume(e)) continue;
                const footOffsetY = this._getFootOffsetY(e, data.sprite);
                const depth = data.sprite.y + footOffsetY + 10;
                setVisualDepthIfChanged(data.sprite, depth, depthStats);
                if (data.groundContactSprite?.active) {
                    setVisualDepthIfChanged(data.groundContactSprite,
                        this._groundContactDepth(depth, data.sprCfg?.groundContact), depthStats);
                }
                if (data.overlaySprite?.active) {
                    setVisualDepthIfChanged(data.overlaySprite, depth + 0.01, depthStats);
                }
                if (data.foregroundSprite?.active) {
                    setVisualDepthIfChanged(data.foregroundSprite, depth + 0.04, depthStats);
                }
                if (data.workingEffectGraphics?.active) {
                    setVisualDepthIfChanged(data.workingEffectGraphics, depth + 0.015, depthStats);
                }
                if (data.staffingWarningGraphics?.active) {
                    setVisualDepthIfChanged(data.staffingWarningGraphics, depth + 0.14, depthStats);
                }
                if (data.label && data.label.active) {
                    setVisualDepthIfChanged(data.label, depth + 1, depthStats);
                }
            }
        }
    }

    /**
     * 生成可复用的柔边接触阴影纹理。只在创建时上传一次，不在帧循环中重绘。
     */
    _ensureShadowTexture() {
        if (this.textures.exists('entity_shadow')) return;
        const texture = this.textures.createCanvas('entity_shadow', 128, 128);
        if (!texture) return;
        const ctx = texture.context;
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        for (const stop of EnvironmentLightingSystem.getContactShadowGradientStops()) {
            gradient.addColorStop(stop.offset, `rgba(0, 0, 0, ${stop.alpha})`);
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        texture.refresh();
    }

    _ensureEnvironmentGlowTexture() {
        if (this.textures.exists('environment_glow')) return;
        const texture = this.textures.createCanvas('environment_glow', 128, 128);
        if (!texture) return;
        const ctx = texture.context;
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
        gradient.addColorStop(0.18, 'rgba(255, 255, 255, 0.52)');
        gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.14)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        texture.refresh();
    }

    _syncAmbientOverlay(isMapMode) {
        const overlay = this._ambientOverlay;
        if (!overlay || !overlay.active) return;
        const cfg = EnvironmentLightingSystem.getConfig();
        const ambient = EnvironmentLightingSystem.getAmbient();
        const zoom = (this.cameras.main && this.cameras.main.zoom) || 1;
        const viewW = (this.scale && this.scale.width) || CONFIG.VIEW_WIDTH || 1920;
        const viewH = (this.scale && this.scale.height) || CONFIG.VIEW_HEIGHT || 1080;
        overlay.setPosition(0, 0);
        overlay.setSize(viewW / zoom, viewH / zoom);
        overlay.setFillStyle(ambient.color, ambient.alpha);
        overlay.setVisible(!isMapMode && cfg.ambientEnabled && ambient.alpha > 0.001);
    }

    _createEnvironmentGlow(x, y, options = {}) {
        this._ensureEnvironmentGlowTexture();
        if (!this.textures.exists('environment_glow')) return null;
        const sprite = this.add.sprite(x, y, 'environment_glow');
        sprite.setOrigin(0.5, 0.5);
        sprite.setBlendMode(BlendModes.ADD);
        return sprite;
    }

    /** 一次性局部亮光：枪口、爆发、命中等短时高亮使用。 */
    spawnEnvironmentGlow(x, y, options = {}) {
        if (!EnvironmentLightingSystem.getConfig().localGlowEnabled) return null;
        const sprite = this._createEnvironmentGlow(x, y, options);
        if (!sprite) return null;
        const record = {
            sprite,
            x,
            y,
            radius: options.radius ?? 48,
            color: options.color ?? 0xffc35a,
            alpha: options.alpha ?? 0.22,
            duration: options.duration ?? 100,
            remain: options.duration ?? 100,
            depth: options.depth ?? y + 40,
        };
        this._transientEnvironmentGlows.push(record);
        return sprite;
    }

    /** 常驻局部亮光：火把、悬浮火球等按调用方 key 更新位置，不重复创建。 */
    registerEnvironmentGlow(key, x, y, options = {}) {
        if (!this._persistentEnvironmentGlows) this._persistentEnvironmentGlows = new Map();
        let record = this._persistentEnvironmentGlows.get(key);
        if (!record || !record.sprite || !record.sprite.active) {
            const sprite = this._createEnvironmentGlow(x, y, options);
            if (!sprite) return null;
            record = { sprite, phase: Math.random() * Math.PI * 2 };
            this._persistentEnvironmentGlows.set(key, record);
        }
        Object.assign(record, {
            x,
            y,
            radius: options.radius ?? record.radius ?? 54,
            color: options.color ?? record.color ?? 0xffa24a,
            alpha: options.alpha ?? record.alpha ?? 0.16,
            depth: options.depth ?? record.depth ?? y + 30,
            flicker: options.flicker ?? record.flicker ?? 0.12,
            pulseSpeed: Number(options.pulsePeriodMs) > 0
                ? (Math.PI * 2) / Number(options.pulsePeriodMs)
                : (record.pulseSpeed ?? 0.010),
        });
        return record.sprite;
    }

    unregisterEnvironmentGlow(key, destroy = true) {
        const record = this._persistentEnvironmentGlows && this._persistentEnvironmentGlows.get(key);
        if (!record) return;
        this._persistentEnvironmentGlows.delete(key);
        if (destroy && record.sprite && record.sprite.active) record.sprite.destroy();
    }

    _syncEnvironmentGlows(delta, isMapMode) {
        const enabled = EnvironmentLightingSystem.getConfig().localGlowEnabled && !isMapMode;
        const now = (this.time && this.time.now) || 0;
        for (let i = this._transientEnvironmentGlows.length - 1; i >= 0; i--) {
            const glow = this._transientEnvironmentGlows[i];
            glow.remain -= delta;
            if (glow.remain <= 0 || !glow.sprite || !glow.sprite.active) {
                if (glow.sprite && glow.sprite.active) glow.sprite.destroy();
                this._transientEnvironmentGlows.splice(i, 1);
                continue;
            }
            const life = Math.max(0, glow.remain / glow.duration);
            const fogVisible = this.isFogPointVisible(glow.x, glow.y);
            glow.sprite.setPosition(glow.x, glow.y);
            glow.sprite.setDisplaySize(glow.radius * 2 * (1.15 - life * 0.15), glow.radius * 2 * (1.15 - life * 0.15));
            glow.sprite.setTint(glow.color);
            glow.sprite.setAlpha(enabled && fogVisible ? glow.alpha * life * life : 0);
            glow.sprite.setDepth(glow.depth);
            glow.sprite.setVisible(enabled && fogVisible);
        }
        if (!this._persistentEnvironmentGlows) return;
        for (const [key, glow] of this._persistentEnvironmentGlows.entries()) {
            if (!glow.sprite || !glow.sprite.active) {
                this._persistentEnvironmentGlows.delete(key);
                continue;
            }
            const pulse = 1 + Math.sin(now * (glow.pulseSpeed ?? 0.010) + glow.phase) * glow.flicker;
            const fogVisible = this.isFogPointVisible(glow.x, glow.y);
            glow.sprite.setPosition(glow.x, glow.y);
            glow.sprite.setDisplaySize(glow.radius * 2 * pulse, glow.radius * 2 * pulse);
            glow.sprite.setTint(glow.color);
            glow.sprite.setAlpha(enabled && fogVisible ? glow.alpha * pulse : 0);
            glow.sprite.setDepth(glow.depth);
            glow.sprite.setVisible(enabled && fogVisible);
        }
    }

    /**
     * 获取实体脚底相对于 Sprite 中心的偏移（像素）。
     * - 如果 render 或实体上显式配置了 footOffsetY，则使用配置值。
     * - 否则默认按 Sprite 显示高度的一半（即贴图方格底部）兜底。
     */
    _getFootOffsetY(entity, sprite) {
        if (!sprite) return 0;
        if (!entity) return (Number(sprite.displayHeight) || 0) * 0.5;
        const configured = entity.footOffsetY ?? entity.config?.render?.footOffsetY;
        if (shouldAutoAnchorStructure(entity) && sprite.texture?.key) {
            const fit = this._resolveStructureVisualFit(entity, sprite);
            if (fit) {
                const adjusted = fit.footOffsetY
                    + (fit.prismConstrained ? 0 : (Number(entity.spriteCfg?.anchorAdjustY) || 0));
                entity._visualFootOffsetY = adjusted;
                return adjusted;
            }
        }
        if (typeof configured === 'number') return configured;
        return sprite.displayHeight * 0.5;
    }

    /**
     * 普通格网建筑的视觉变换唯一入口。棱柱拟合只读现有 footprint，绝不反写碰撞体；
     * 显式 autoFootprint 异形建筑继续保留旧 alpha-ground-fit 行为。
     */
    _resolveStructureVisualFit(entity, sprite) {
        if (!shouldAutoAnchorStructure(entity) || !sprite?.texture?.key) return null;
        // A scene-authored landmark may deliberately keep its global logical
        // footprint while using a smaller composition-specific render scale.
        // The main-hub portal uses this to match the approved master scene
        // without changing the reusable portal's 4x4 collision contract.
        if (entity.spriteCfg?.preserveConfiguredVisualSize === true) return null;
        // 拟合输入只允许是建筑主体纹理；建筑底部铺装由 BuildingRoadSystem 独立维护。
        const fallbackFoot = getBuildingFootprint(entity._buildingFootprintCells || 2);
        const constrainToPrism = entity.spriteCfg?.autoFootprint !== true;
        const nominal = {
            w: constrainToPrism
                ? Math.max(8, Number(entity.collisionWidth) || fallbackFoot.w)
                : fallbackFoot.w,
            d: constrainToPrism
                ? Math.max(4, Number(entity.collisionHeight) || fallbackFoot.d)
                : fallbackFoot.d,
        };
        const configuredWidth = Math.max(1,
            Number(entity.spriteCfg?.size) || Number(sprite.displayWidth) || 1);
        const configuredHeight = Math.max(1,
            Number(entity.spriteCfg?.sizeH) || Number(sprite.displayHeight) || configuredWidth);
        const centerAdjustX = Number(entity.spriteCfg?.anchorAdjustX) || 0;
        const centerAdjustY = Number(entity.spriteCfg?.anchorAdjustY) || 0;
        const visualFootprint = constrainToPrism
            ? resolveConfiguredVisualFootprint(entity.spriteCfg, nominal.w, nominal.d)
            : null;
        const fitKey = [
            sprite.texture.key,
            String(sprite.frame?.name ?? ''),
            configuredWidth,
            configuredHeight,
            nominal.w,
            nominal.d,
            constrainToPrism ? 'prism-body' : 'ground',
            centerAdjustX,
            centerAdjustY,
            visualFootprint ? JSON.stringify(visualFootprint) : '',
        ].join(':');
        if (entity._structureVisualFitKey === fitKey) return entity._structureVisualFit || null;
        const fit = resolveStructureGroundFit(
            this,
            sprite.texture.key,
            sprite.frame?.name,
            configuredWidth,
            configuredHeight,
            {
                nominalWidth: nominal.w,
                nominalHeight: nominal.d,
                constrainToPrism,
                centerAdjustX: constrainToPrism ? centerAdjustX : 0,
                centerAdjustY: constrainToPrism ? centerAdjustY : 0,
                visualFootprint: constrainToPrism ? visualFootprint : null,
            }
        );
        entity._structureVisualFitKey = fitKey;
        entity._structureVisualFit = fit;
        return fit;
    }

    /** 普通建筑优先消费显式 visualFootprint；未标定素材才回退 alpha 自动拟合。 */
    _applyStructureVisualSize(entity, sprite) {
        if (!sprite || !entity?.spriteCfg) return null;
        const configuredWidth = Math.max(1, Number(entity.spriteCfg.size) || 128);
        const configuredHeight = Math.max(1,
            Number(entity.spriteCfg.sizeH) || configuredWidth);
        sprite.setDisplaySize(configuredWidth, configuredHeight);
        const fit = this._resolveStructureVisualFit(entity, sprite);
        if (fit?.prismConstrained && fit.displayWidth > 0 && fit.displayHeight > 0) {
            sprite.setDisplaySize(fit.displayWidth, fit.displayHeight);
            entity._structureVisualScaleX = fit.displayWidth / configuredWidth;
            entity._structureVisualScaleY = fit.displayHeight / configuredHeight;
            entity._structureVisualScale = entity._structureVisualScaleX;
        } else {
            entity._structureVisualScaleX = 1;
            entity._structureVisualScaleY = 1;
            entity._structureVisualScale = 1;
        }
        return fit;
    }

    /** 缓存建筑本帧真实 alpha 世界 AABB，供二维候选与统一地面拓扑消费。 */
    _syncStructureOcclusionVisualBounds(entity, sprites) {
        if (!entity || entity._structureDepthMode !== 'iso_footprint') return;
        // 升级换图可能同时改变主体尺寸、脚点和外伸轮廓。结构拓扑的快速缓存不能只看
        // 实体数量/碰撞 revision，否则放大的新贴图最多会沿用 250ms 的旧视觉交叠关系。
        // 这里只记录固定视觉几何，不包含动画帧和雾显隐，避免风车叶轮等每帧使缓存失效。
        const visualGeometryKey = (sprites || [])
            .filter((sprite) => sprite?.active)
            .map((sprite) => [
                sprite.texture?.key || '',
                Number(sprite.displayWidth) || 0,
                Number(sprite.displayHeight) || 0,
                Number(sprite.x) || 0,
                Number(sprite.y) || 0,
                sprite.flipX ? 1 : 0,
                Number(sprite.rotation) || 0,
            ].join(':'))
            .join('|');
        if (entity._structureOcclusionVisualGeometryKey !== visualGeometryKey) {
            entity._structureOcclusionVisualGeometryKey = visualGeometryKey;
            this._structureOrderCache = null;
        }
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const sprite of sprites || []) {
            if (!sprite?.active || !sprite.visible) continue;
            const bounds = getVisibleSpriteWorldBounds(sprite);
            minX = Math.min(minX, bounds.minX);
            maxX = Math.max(maxX, bounds.maxX);
            minY = Math.min(minY, bounds.minY);
            maxY = Math.max(maxY, bounds.maxY);
        }
        if (Number.isFinite(minX) && Number.isFinite(maxX)
            && Number.isFinite(minY) && Number.isFinite(maxY)) {
            entity._structureOcclusionVisualMinX = minX;
            entity._structureOcclusionVisualMaxX = maxX;
            entity._structureOcclusionVisualMinY = minY;
            entity._structureOcclusionVisualMaxY = maxY;
        } else {
            delete entity._structureOcclusionVisualMinX;
            delete entity._structureOcclusionVisualMaxX;
            delete entity._structureOcclusionVisualMinY;
            delete entity._structureOcclusionVisualMaxY;
        }
    }

    /** 普通建筑按显式标定中心对齐 footprint；底部道路补片不参与，异形建筑保留旧校正。 */
    _getVisualOffsetX(entity, sprite) {
        if (!sprite) return 0;
        const configured = entity.spriteCfg?.offsetX ?? entity.config?.render?.offsetX ?? 0;
        const autoAnchor = shouldAutoAnchorStructure(entity);
        const mirrorSign = autoAnchor && entity._facingLeft ? -1 : 1;
        if (autoAnchor && sprite.texture?.key) {
            const fit = this._resolveStructureVisualFit(entity, sprite);
            if (fit) {
                const fitKey = [
                    sprite.texture.key,
                    String(sprite.frame?.name ?? ''),
                    sprite.displayWidth,
                    sprite.displayHeight,
                    fit.leftX,
                    fit.rightX,
                ].join(':');
                if (entity._visualGroundFitKey !== fitKey) {
                    // 像素拟合 footprint 仅对显式开启 autoFootprint 的建筑生效；
                    // 其余建筑物理保持标准格网，只取视觉锚点偏移。
                    if (entity.spriteCfg?.autoFootprint === true) {
                        applyFittedBuildingFootprint(entity, fit);
                        if (typeof entity.rebuildCollider === 'function') entity.rebuildCollider();
                    }
                    entity._visualGroundFitKey = fitKey;
                }
                const visualOffsetX = (
                    fit.visualOffsetX
                    + (fit.prismConstrained ? 0 : (Number(entity.spriteCfg?.anchorAdjustX) || 0))
                ) * mirrorSign;
                entity._visualFootOffsetX = visualOffsetX;
                return visualOffsetX;
            }
        }
        return (Number(configured) || 0) * mirrorSign;
    }

    /**
     * 判断实体是否显式配置了 footOffsetY（用于决定是否上移 Sprite 使逻辑位置落在脚底）。
     */
    _hasConfiguredFootOffset(entity) {
        return typeof (entity.footOffsetY ?? entity.config?.render?.footOffsetY) === 'number';
    }

    /**
     * 帧内容可见底边比例（alpha>8 的最大可见 y / 帧高），按 纹理+帧 缓存。
     * 与 _getVisibleSpriteTopY 同源的底部版本：AI 精灵帧底常留透明区（v2 管线脚底基线
     * 固定在 0.9375×格高），需要真实脚底基线时以此为准，不能用整帧底边。
     */
    _getVisibleFrameBottomRatio(sprite) {
        return getVisibleFrameBounds(sprite).bottom;
    }

    /**
     * 返回精灵当前帧真实可见 alpha 顶部的世界 Y。
     * AI 精灵常带大片透明上沿，不能用整帧 displayHeight 顶部当作模型头顶。
     */
    _getVisibleSpriteTopY(sprite) {
        return getVisibleSpriteTopY(sprite);
    }

    /**
     * 玩家、敌人和友军共用的动态图层几何档案。
     * 横向范围取当前帧 alpha 内容而不是整帧或固定碰撞半径，避免建筑前角漏仲裁。
     */
    _getDynamicDepthProfile(entity, sprite, footOffsetY) {
        const logicalFootY = (Number(entity?.y) || 0) - (Number(entity?.z) || 0);
        return resolveSpriteDepthProfile(entity, sprite, {
            footOffsetY,
            logicalX: entity?.x,
            logicalFootY,
            minFrontRange: 60,
            maxFrontRange: 280,
        });
    }

    /**
     * 地面 shadow footprint 的唯一入口：
     * - iso_rect：直接取 iso-footprint 的投影顶点范围，建筑阴影与真实占格同尺寸；
     * - rect：宽度不变、纵深按透视 0.5 压缩；
     * - 其余移动实体：groundRadius 的 2:1 椭圆。
     */
    _getGroundShadowFootprint(entity, fallbackRadius = 10, fallbackCenter = null) {
        const center = {
            x: entity?.collider ? entity.collider.x : (fallbackCenter?.x ?? entity?.x ?? 0),
            y: entity?.collider ? entity.collider.y : (fallbackCenter?.y ?? entity?.y ?? 0),
        };
        if (entity?.collisionShape === 'iso_rect') {
            const vertices = isoFootprintVertices(entity);
            if (vertices.length) {
                const xs = vertices.map((p) => p.x);
                const ys = vertices.map((p) => p.y);
                const minX = Math.min(...xs), maxX = Math.max(...xs);
                const minY = Math.min(...ys), maxY = Math.max(...ys);
                return {
                    x: (minX + maxX) * 0.5,
                    y: (minY + maxY) * 0.5,
                    width: maxX - minX,
                    height: maxY - minY,
                };
            }
        }
        if (entity?.collisionShape === 'rect'
            && entity.collisionWidth > 0 && entity.collisionHeight > 0) {
            return {
                ...center,
                width: entity.collisionWidth,
                height: entity.collisionHeight * PERSPECTIVE_SCALE_Y,
            };
        }
        const radius = Math.max(1, entity?.groundRadius || fallbackRadius || 10);
        return {
            ...center,
            width: radius * 2,
            height: radius * 2 * PERSPECTIVE_SCALE_Y,
        };
    }

    /**
     * 可移动单位的阴影 footprint 唯一入口。
     * 单位地面碰撞在全项目统一为 Collider.radius 的水平 2:1 椭圆；collisionShape:'rect'
     * 描述的是玩家/怪物/NPC 的躯干受击矩形，不能拿来决定脚下阴影尺寸。
     * 中心按实体类别统一解析：玩家含 z，友军取视觉插值脚点，其余取 Collider；
     * 阴影与“范围”调试必须同时消费本结果，半径仍严格读取 Collider/groundRadius。
     */
    _getUnitRenderFootprint(entity, fallbackRadius = 10, game = null) {
        const currentGame = game || (typeof window !== 'undefined' ? window.Game : null) || null;
        const player = currentGame?.player || null;
        const partyMembers = PartySystem.members || [];
        const worldFriendlies = Array.isArray(currentGame?.friendlyUnits)
            ? currentGame.friendlyUnits
            : [];
        const isFriendly = entity !== player
            && (partyMembers.includes(entity) || worldFriendlies.includes(entity));
        let centerOverride = null;
        if (isFriendly) {
            const sprite = this._companionSprites?.[entity?.id];
            if (sprite?.active) {
                const cfgFoot = entity.footOffsetY ?? entity.config?.render?.footOffsetY;
                const footY = (typeof cfgFoot === 'number')
                    ? sprite.y + cfgFoot
                    : sprite.y + sprite.displayHeight * (this._getVisibleFrameBottomRatio(sprite) - 0.5);
                centerOverride = { x: sprite.x, y: footY };
            }
        }
        const footprint = resolveUnitGroundFootprint(entity, fallbackRadius, centerOverride);
        // 高架玩家的脚点位于实际承载平面；范围调试与阴影必须消费同一修正。
        if (entity === player) footprint.y -= Number(entity?.z) || 0;
        return footprint;
    }

    /**
     * 为可移动实体生成太阳驱动的接触阴影。
     * 阴影服务统一负责太阳方向/高度；本方法只绑定实体脚底、显示深度和对象池。
     */
    _syncEntityShadows(_game) {
        if (!_game) return;
        const dms = DungeonMapSystem;
        const isDungeon = SceneManager.isDungeonIsolationActive();
        const isMapMode = isDungeon && dms && dms.active && dms.state === 'map';
        const active = this._shadowActiveEntities || (this._shadowActiveEntities = new Set());
        active.clear();

        const ensureShadow = (key, entity, footprint, depth, visible, _sourceSprite = null) => {
            const shadowRadius = Math.max(1, Math.max(footprint.width, footprint.height) * 0.5);
            const profile = EnvironmentLightingSystem.getDynamicShadow(entity, shadowRadius, {
                dungeon: isDungeon,
            });
            if (!profile) {
                const existing = this._shadowSprites.get(key);
                if (existing && existing.active) existing.setVisible(false);
                return null;
            }
            let sprite = this._shadowSprites.get(key);
            if (!sprite || !sprite.active) {
                sprite = this.add.sprite(0, 0, 'entity_shadow');
                this._shadowSprites.set(key, sprite);
            }
            // 普通单位使用严格水平接触椭圆（ground footprint 唯一真源）；逐帧 alpha
            // 剪影链（unit_projection）已退役。只有显式 directional=true 才保留方向尾影。
            sprite.setTexture('entity_shadow');
            sprite.setOrigin(0.5, 0.5);
            // 不能把整个 2:1 footprint 椭圆旋转到太阳影向：影向接近屏幕 Y 轴时会把
            // 水平脚底错误地立成竖椭圆。普通路径中心/尺寸/角度全部直接绑定 footprint。
            const offLen = Math.hypot(profile.offsetX, profile.offsetY);
            const baseW = footprint.width * profile.widthMul;
            const baseH = footprint.height * profile.depthMul;
            if (profile.directional && offLen > 3) {
                sprite.setPosition(
                    footprint.x + profile.offsetX * 0.5,
                    footprint.y + profile.offsetY * 0.5
                );
                sprite.setDisplaySize(baseW + offLen, baseH);
                sprite.setRotation(Math.atan2(profile.offsetY, profile.offsetX));
            } else {
                sprite.setPosition(footprint.x, footprint.y);
                sprite.setDisplaySize(baseW, baseH);
                sprite.setRotation(0);
            }
            sprite.setFlipX(false);
            sprite.setFlipY(false);
            sprite.setDepth(depth);
            sprite.setAlpha(profile.opacity);
            sprite.setVisible(visible);
            return sprite;
        };

        // 玩家
        if (_game.player && this.playerSprite && this.playerSprite.active) {
            const e = _game.player;
            active.add(e);
            const depth = this.playerSprite.depth - 0.1; // 跟随本体仲裁后 depth（含墙体遮挡压下），始终略低于本体
            const footprint = this._getUnitRenderFootprint(e, e.groundRadius || 10, _game);
            ensureShadow(e, e, footprint, depth, !isMapMode, this.playerSprite);
        }

        // 敌人
        if (_game.entities) {
            _game.entities.forEach(e => {
                if (!e || !e.active || e === _game.player) return;
                if (e._faction !== 'enemy' && e._faction !== 'agent') return; // 入侵特工与敌人同口径
                if (e._noShadow) return; // 配置跳过阴影（如矿洞，贴图自带底座）
                const sprite = e._phaserSprite;
                if (!sprite || !sprite.active) return;
                active.add(e);
                if (!this._isEntityInRenderViewport(e)) {
                    this._setViewportVisualHidden(this._shadowSprites.get(e), true);
                    return;
                }
                const depth = sprite.depth - 0.1; // 跟随本体仲裁后 depth（含墙体遮挡压下），始终略低于本体
                ensureShadow(
                    e,
                    e,
                    this._getUnitRenderFootprint(e, e.groundRadius || 10, _game),
                    depth,
                    !isMapMode,
                    sprite
                );
            });
        }

        // 友军：队伍成员和世界-122生产单位都由 _companionSprites 承担渲染，
        // 所以按 Sprite 脚底取点；纯跟随队员没有逻辑世界坐标时也不会错落在 (0, 0)。
        const friendlySeen = this._shadowFriendlySeen || (this._shadowFriendlySeen = new Set());
        friendlySeen.clear();
        const syncFriendlyShadow = (e) => {
            if (!e || !e.active || friendlySeen.has(e) || e._noShadow) return;
            friendlySeen.add(e);
            const sprite = this._companionSprites && this._companionSprites[e.id];
            if (!sprite || !sprite.active || !sprite.visible) return;
            active.add(e);
            if (!this._isEntityInRenderViewport(e)) {
                this._setViewportVisualHidden(this._shadowSprites.get(e), true);
                return;
            }
            // 友军、玩家及范围调试共用同一渲染脚点；尺寸仍只读 Collider.radius。
            const footprint = this._getUnitRenderFootprint(e, e.groundRadius || 10, _game);
            ensureShadow(
                e,
                e,
                footprint,
                sprite.depth - 0.1,
                !isMapMode,
                sprite
            );
        };
        for (const e of PartySystem.members || []) syncFriendlyShadow(e);
        if (Array.isArray(_game.friendlyUnits)) {
            for (const e of _game.friendlyUnits) syncFriendlyShadow(e);
        }

        // 中立实体（NPC / 训练靶）
        if (this._neutralSprites) {
            for (const [e, data] of this._neutralSprites.entries()) {
                if (!e || !e.active || !data.sprite || !data.sprite.active) continue;
                // 建筑由结构太阳投影链负责，不能再叠一层“单位接触椭圆”。
                if (e._isDefenseStructure || usesBuildingFootprintVolume(e)) continue;
                if (e._noShadow) continue; // 配置跳过阴影（如仓库宝箱，贴图自带底座）
                active.add(e);
                if (!this._isEntityInRenderViewport(e)) {
                    this._setViewportVisualHidden(this._shadowSprites.get(e), true);
                    continue;
                }
                // NPC/训练靶与玩家、怪物、友军使用同一 Collider footprint；阴影深度读取
                // 本帧已经完成墙体/建筑遮挡仲裁的 Sprite，禁止回退旧 e.y + 9。
                const depth = data.sprite.depth - 0.1;
                ensureShadow(
                    e,
                    e,
                    this._getUnitRenderFootprint(e, e.groundRadius || 10, _game),
                    depth,
                    !isMapMode,
                    data.sprite
                );
            }
        }

        // 清理已失效实体的阴影
        for (const [key, sprite] of this._shadowSprites.entries()) {
            if (!active.has(key)) {
                sprite.destroy();
                this._shadowSprites.delete(key);
            }
        }
    }

    _syncShadowControlledGroundContacts(enabled) {
        for (const [entity, data] of this._neutralSprites || []) {
            const groundContact = data?.groundContactSprite;
            if (!groundContact?.active || data?.sprCfg?.groundContact?.shadowControlled !== true) continue;
            if (!enabled) {
                groundContact.setVisible(false);
                continue;
            }
            const fogHidden = FogOfWarSystem.shouldHideEntity(SceneManager.currentScene, entity);
            groundContact.setVisible(
                !this._mapModeActive
                && !fogHidden
                && data.sprite?.visible !== false
            );
        }
    }

    /** 设置菜单会暂停 Phaser；配置监听必须直接收口现存图层，不能等待下一帧。 */
    _onEnvironmentLightingConfigChanged(config, changedKeys = []) {
        const changed = new Set(changedKeys);
        if (![...changed].some((key) => key === 'enabled' || key === 'staticEnabled' || key === 'quality')) return;

        const enabled = config?.enabled !== false;
        ChestRoomSystem.syncShadowVisibility(enabled);
        this._syncShadowControlledGroundContacts(enabled);
        this._sunShadowSyncTimer = 80;

        if (changed.has('enabled') && typeof Renderer.terrainRebuild === 'function') {
            Renderer.terrainRebuild();
        }

        if (!enabled) {
            for (const shadow of this._shadowSprites?.values() || []) {
                if (shadow?.active) shadow.setVisible(false);
            }
            if (this._structureShadowLayer?.active) this._structureShadowLayer.setVisible(false);
            if (this._structureShadowRenderStats) this._structureShadowRenderStats.layerVisible = false;
            return;
        }

        // 重新开启时也在暂停菜单背后立即恢复；各同步函数仍负责地图、迷雾和视口过滤。
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game?.isRunning) return;
        if (changed.has('enabled')) this._syncEntityShadows(game);
        this._syncStructureSunShadows(game);
        this._syncStaticSunShadows();
    }

    /** FogVisualAdapter 可能恢复旧 visible；主开关关闭时在帧末再次强制隐藏阴影专属视觉。 */
    _enforceDisabledShadowVisibility() {
        if (EnvironmentLightingSystem.isShadowEnabled()) return;
        for (const shadow of this._shadowSprites?.values() || []) {
            if (shadow?.active && shadow.visible) shadow.setVisible(false);
        }
        if (this._structureShadowLayer?.active && this._structureShadowLayer.visible) {
            this._structureShadowLayer.setVisible(false);
        }
        this._syncShadowControlledGroundContacts(false);
        ChestRoomSystem.syncShadowVisibility(false);
    }

    // ---- 相机系统 ----

    /**
     * X 光圆圈透视（被墙壁遮挡的实体）
     * 判定：墙件 depth > 实体 depth 且贴图包围盒相交 → 实体被遮挡
     * 效果：在遮挡墙之上画黑渐变圆圈（边缘黑→透明），圆圈内显示实体贴图（径向 alpha 蒙版裁剪）
     */
    _getXrayTextures() {
        if (this.textures.exists('xray_circle')) return;
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 256;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        // 圆环样式：中间全透明（人物直接透原场景），仅边缘黑→透明渐变
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.55, 'rgba(0,0,0,0)');
        g.addColorStop(0.8, 'rgba(0,0,0,0.75)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 256);
        this.textures.addCanvas('xray_circle', c);
    }

    /** 销毁全部 X 光透视对象（战斗事件结束/场景恢复时调用，防残留到地图界面） */
    _purgeXRayCircles() {
        if (!this._xrayMap) return;
        for (const [, cur] of this._xrayMap) {
            for (const k of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone', 'shieldUpperClone', 'shieldForearmClone', 'swordShieldHandClone']) {
                if (cur[k]) cur[k].destroy();
            }
            if (cur.holeKey && this.textures.exists(cur.holeKey)) this.textures.remove(cur.holeKey);
        }
        this._xrayMap.clear();
    }

    _syncXRayCircles(_game) {
        // 透视效果：'drops'=仅掉落物（定案）/ true=全量 / false=全关
        if (this._xrayEnabled === false) {
            if (this._xrayMap && this._xrayMap.size) this._purgeXRayCircles();
            return;
        }
        if (!_game) return;
        const dms = DungeonMapSystem;
        const isMapMode = SceneManager.currentScene === 'scene7' && dms && dms.active && dms.state === 'map';
        if (!this._xrayMap) this._xrayMap = new Map();
        this._getXrayTextures();
        const walls = (!isMapMode && WallSystem.isoVisuals) ? WallSystem.isoVisuals.filter(p => p._sprite && p._sprite.active) : [];
        // 遮挡物统一列表：iso 墙件 + 门闸（同几何判定：底边线段 + 墙高）
        const occluders = [];
        for (const p of walls) {
            const g = WallSystem._geoForTex(p.tex);
            occluders.push({
                sprite: p._sprite,
                segs: WallSystem._pieceBaseSegments(p),
                hWall: (g ? g.wallH : 800) * (p.scaleY ?? 1),
            });
        }
        if (WallGate && WallGate.sprite && WallGate.sprite.active && WallGate._seg && WallGate.state !== 'open') {
            const gg = WallSystem._geoForTex(WallGate.sprite.texture ? WallGate.sprite.texture.key : 'wall_gate');
            const gateSprites = WallGate.sprites?.length ? WallGate.sprites : [WallGate.sprite];
            const gateDepthSegments = WallGate.depthSegments?.length ? WallGate.depthSegments : null;
            for (let index = 0; index < gateSprites.length; index++) {
                const sprite = gateSprites[index];
                if (!sprite?.active) continue;
                const segment = gateDepthSegments?.[index];
                occluders.push({
                    sprite,
                    segs: segment ? [[segment.A, segment.B]] : [WallGate._seg],
                    hWall: (gg ? gg.wallH : 800) * (WallGate._scale ? WallGate._scale.sy : 1),
                });
            }
        }
        // 宝箱房门墙（精英战小房，独立实体）：同样纳入遮挡判定（isoSegments 格式转点对）
        if (ChestRoomSystem && ChestRoomSystem._gate && ChestRoomSystem._gate.sprite
            && ChestRoomSystem._gate.sprite.active && !ChestRoomSystem._gate.open) {
            const cg = ChestRoomSystem._gate;
            const cgg = WallSystem._geoForTex(cg.sprite.texture ? cg.sprite.texture.key : 'wall_gate');
            const cgSegs = [...(cg.segs || []), ...(cg.open ? [] : [cg.gateSeg])].filter(Boolean)
                .map(s => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
            const gateSprites = cg.sprites?.length ? cg.sprites : [cg.sprite];
            const depthSegments = cg.depthSegments?.length ? cg.depthSegments : null;
            for (let index = 0; index < gateSprites.length; index++) {
                const sprite = gateSprites[index];
                if (!sprite?.active) continue;
                const segment = depthSegments?.[index];
                occluders.push({
                    sprite,
                    segs: segment ? [[segment.A, segment.B]] : cgSegs,
                    hWall: (cgg ? cgg.wallH : 800) * (sprite.scaleY || 1),
                });
            }
            if (!this._chestGateXrayLogged) {
                this._chestGateXrayLogged = true;
                console.log('[XRay] 宝箱房门已加入 occluders：', cgSegs.length, '段，hWall=', (cgg ? cgg.wallH : 800) * (cg.sprite.scaleY || 1), 'depth=', cg.sprite.depth);
            }
        }

        // 竞技场门墙（入场门/通道门，独立实例）：纳入遮挡判定（与宝箱房门同模型）
        const _crs = (typeof window !== 'undefined') ? window.CombatRoomSystem : null;
        if (_crs && _crs._arena) {
            const arenaGates = [..._crs._arena.passages.flatMap(r => r.gates)];
            if (_crs._arena.entryGate) arenaGates.push(_crs._arena.entryGate);
            for (const g of arenaGates) {
                if (!g.sprite || !g.sprite.active) continue;
                const gg = WallSystem._geoForTex(g.sprite.texture ? g.sprite.texture.key : 'wall_gate');
                const gSegs = [...(g.wallSegs || []), ...(g.open ? [] : [g.gateSeg])].filter(Boolean)
                    .map(s => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
                occluders.push({
                    sprite: g.sprite,
                    segs: gSegs,
                    hWall: (gg ? gg.wallH : 800) * (g.sprite.scaleY || 1),
                });
            }
        }

        const check = (e, sprite) => {
            const cur0 = this._xrayMap.get(e);
            if (!this._isEntityInRenderViewport(e)) {
                this._setViewportVisualRecordHidden(cur0, true);
                return;
            }
            this._setViewportVisualRecordHidden(cur0, false);
            if (FogOfWarSystem.shouldHideEntity(SceneManager.getCurrentWorldId(), e)) {
                if (cur0) {
                    for (const k of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone', 'shieldUpperClone', 'shieldForearmClone', 'swordShieldHandClone']) {
                        if (cur0[k]) cur0[k].setVisible(false);
                    }
                }
                return;
            }
            if (!e || !sprite || !sprite.active) return;
            // 找遮挡墙（depth 高于实体 + 几何遮挡判定，取最高 depth）
            // 判定：脚底在墙面底边线之后（fy < baseY）且身体进入墙面覆盖带（fy > baseY - 墙高），
            // 覆盖量 > 身体 15% 才算被遮挡——不再用包围盒（斜墙的 AABB 一半是空的，必提前触发）
            let wallDepth = -Infinity;
            if (occluders.length) {
                const footY = sprite.y + this._getFootOffsetY(e, sprite);
                const hEnt = (e.collider && e.collider.height) ? e.collider.height : sprite.displayHeight * 0.55;
                const minCover = Math.max(8, hEnt * 0.15);
                for (const o of occluders) {
                    const wd = o.sprite.depth;
                    if (wd <= sprite.depth || wd <= wallDepth) continue;
                    for (const [a, b] of o.segs) {
                        const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
                        if (sprite.x < minX - 10 || sprite.x > maxX + 10) continue;
                        const t = (b.x - a.x) !== 0 ? (sprite.x - a.x) / (b.x - a.x) : 0;
                        const baseY = a.y + (b.y - a.y) * t;
                        const cover = footY - (baseY - o.hWall);
                        if (footY < baseY && cover > minCover) {
                            wallDepth = wd;
                            break;
                        }
                    }
                }
            }
            if (wallDepth === -Infinity) {
                if (cur0) {
                    for (const k of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone', 'shieldUpperClone', 'shieldForearmClone', 'swordShieldHandClone']) {
                        if (cur0[k]) cur0[k].setVisible(false);
                    }
                }
                return;
            }
            // 接缝处防半遮：把圆覆盖范围内的所有墙件（全包围盒）的最高 depth 作为绘制基准，
            // 保证地板洞/圆环/克隆盖过接缝处的另一块墙，而不是只盖触发的那块
            const radius = Math.max(36, sprite.displayWidth * 0.85);
            for (const o of occluders) {
                const wd = o.sprite.depth;
                if (wd <= wallDepth) continue;
                const wb = o.sprite.getBounds();
                if (wb.x < sprite.x + radius && wb.x + wb.width > sprite.x - radius &&
                    wb.y < sprite.y + radius && wb.y + wb.height > sprite.y - radius) {
                    wallDepth = wd;
                }
            }
            let cur = cur0;
            if (!cur) {
                const circle = this.add.sprite(0, 0, 'xray_circle');
                const clone = this.add.sprite(0, 0, sprite.texture.key);
                // 地板透视洞：动态 canvas 纹理（每帧从烘焙地板抠一块，边缘径向渐隐）
                const holeCanvas = document.createElement('canvas');
                holeCanvas.width = 192;
                holeCanvas.height = 192;
                const holeKey = `xray_hole_${this._xraySeq = (this._xraySeq || 0) + 1}`;
                const holeTex = this.textures.addCanvas(holeKey, holeCanvas);
                const hole = this.add.image(0, 0, holeKey);
                hole.setOrigin(0.5, 0.5);
                cur = { circle, clone, hole, holeCanvas, holeCtx: holeCanvas.getContext('2d'), holeTex, holeKey };
                this._xrayMap.set(e, cur);
            }
            // 更新地板透视洞内容（跟随实体位置抠取烘焙地板）
            const terrain = (typeof Renderer !== 'undefined' && Renderer.terrainTexture) ? Renderer.terrainTexture : null;
            if (terrain && cur.holeTex) {
                const ctx = cur.holeCtx;
                ctx.clearRect(0, 0, 192, 192);
                ctx.drawImage(terrain, sprite.x - 96, sprite.y - 96, 192, 192, 0, 0, 192, 192);
                ctx.globalCompositeOperation = 'destination-in';
                const g = ctx.createRadialGradient(96, 96, 0, 96, 96, 96);
                g.addColorStop(0, 'rgba(0,0,0,1)');
                g.addColorStop(0.6, 'rgba(0,0,0,1)');
                g.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, 192, 192);
                ctx.globalCompositeOperation = 'source-over';
                cur.holeTex.refresh();
                cur.hole.setPosition(sprite.x, sprite.y);
                cur.hole.setDepth(wallDepth + 0.5);
                cur.hole.setVisible(true);
            } else {
                cur.hole.setVisible(false);
            }
            cur.circle.setPosition(sprite.x, sprite.y);
            cur.circle.setDisplaySize(radius * 2, radius * 2);
            cur.circle.setDepth(wallDepth + 1);
            cur.circle.setVisible(true);
            cur.clone.setTexture(sprite.texture.key, sprite.frame && sprite.frame.name);
            cur.clone.setPosition(sprite.x, sprite.y);
            cur.clone.setDisplaySize(sprite.displayWidth, sprite.displayHeight);
            cur.clone.setFlipX(sprite.flipX);
            cur.clone.setAlpha(0.9);
            cur.clone.setDepth(wallDepth + 2);
            cur.clone.setVisible(true);
            // 玩家武器/副手/盾牌克隆（透视一并显示，跟随各自贴图位置与旋转）
            if (e === _game.player) {
                const syncAux = (key, src, dOff) => {
                    if (!src || !src.active || !src.visible) {
                        if (cur[key]) cur[key].setVisible(false);
                        return;
                    }
                    if (!cur[key]) cur[key] = this.add.sprite(0, 0, src.texture.key);
                    const c = cur[key];
                    c.setTexture(src.texture.key, src.frame && src.frame.name);
                    c.setOrigin(src.originX, src.originY);
                    c.setPosition(src.x, src.y);
                    c.setDisplaySize(src.displayWidth, src.displayHeight);
                    c.setRotation(src.rotation);
                    c.setFlipX(src.flipX);
                    c.setAlpha(0.9);
                    c.setDepth(wallDepth + dOff);
                    c.setVisible(true);
                };
                syncAux('weaponClone', this.weaponSprite, 2.2);
                syncAux('offhandClone', this.offhandWeaponSprite, 2.15);
                syncAux('shieldClone', this.shieldSprite, this._playerShieldRig?.shieldBehindBody ? 1.99 : 2.1);
                syncAux('shieldMainArmClone', this._playerShieldRig?.mainArmSprite, 2.02);
                syncAux('shieldUpperClone', this._playerShieldRig?.upperSprite, 2.03);
                syncAux('shieldForearmClone', this._playerShieldRig?.forearmSprite, 2.04);
                syncAux('swordShieldHandClone', this._swordShieldMotion?.handSprite, 2.21);
            }
        };

        // 全量模式才透视玩家（'drops' 模式玩家/怪物不参与）
        if (this._xrayEnabled === true && _game.player && this.playerSprite && this.playerSprite.active) {
            check(_game.player, this.playerSprite);
        }
        if (_game.entities) {
            _game.entities.forEach(e => {
                if (!e || e === _game.player || !e.active) return;
                // 'drops' 模式：仅掉落物（DropItem 以 itemData 标识）
                if (this._xrayEnabled === 'drops' && !e.itemData) return;
                if (e._phaserSprite) check(e, e._phaserSprite);
            });
        }
        // 清理已移除实体的 X 光对象
        for (const [e, cur] of this._xrayMap) {
            if (!e || !e.active) {
                for (const k of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone', 'shieldUpperClone', 'shieldForearmClone', 'swordShieldHandClone']) {
                    if (cur[k]) cur[k].destroy();
                }
                if (cur.holeKey && this.textures.exists(cur.holeKey)) this.textures.remove(cur.holeKey);
                this._xrayMap.delete(e);
            }
        }
    }

    _updateCamera() {
        // Camera 已作为 ES module 导入
        if (!Camera) return;

        // 使用 Phaser 实际渲染尺寸，避免 viewport 与 CSS 缩放不一致导致错位
        const viewW = this.scale.width || window.innerWidth || 1920;
        const viewH = this.scale.height || window.innerHeight || 1080;

        // 仅在尺寸变化时更新 viewport / bounds，减少每帧开销
        if (this._lastCameraViewW !== viewW || this._lastCameraViewH !== viewH) {
            this._lastCameraViewW = viewW;
            this._lastCameraViewH = viewH;
            this.cameras.main.setViewport(0, 0, viewW, viewH);
            const boundSize = Math.max(CONFIG.WORLD_WIDTH, viewW, CONFIG.WORLD_HEIGHT, viewH) * 3;
            this.cameras.main.setBounds(-boundSize, -boundSize, boundSize * 2, boundSize * 2);
        }

        // 直接同步原有系统的相机位置，避免两个 Canvas 错位
        // 震屏：旧随机震（Camera.shakeX/Y，此前 Phaser 路径未消费）+ GunFeel trauma² 平滑震叠加
        const shakeX = (Camera.shakeX || 0) + GunFeel.shakeX;
        const shakeY = (Camera.shakeY || 0) + GunFeel.shakeY;
        // 场景基础缩放：世界-122~125统一缩小到70%（≈视野多43%，用户校准：0.5过小）；
        // 主神空间与地牢保持1:1。zoom punch按基础缩放等比叠加，切场下一帧自动生效/还原。
        const zoomedOutWorld = SceneManager
            && ZOOMED_OUT_WORLD_SCENES.has(SceneManager.currentScene);
        const sceneBaseZoom = zoomedOutWorld ? 0.7 : 1;
        // zoom punch：开火瞬间视角轻微推近（2D 等价 FOV punch），GunFeel 内指数回落
        const zoom = sceneBaseZoom * (1 + GunFeel.zoomPunch);
        if (Math.abs(this.cameras.main.zoom - zoom) > 0.0004) {
            this.cameras.main.setZoom(zoom);
            // 双保险：zoom 变化显式失效小地图静态层缓存（缓存键虽含 zoom，
            // 但 _syncHud 先于本函数运行，首帧可能按旧 zoom 重绘——显式失效确保下一帧纠正）
            this._minimapStaticKey = null;
        }
        // 相机 origin 固定 (0,0)：缩放枢轴锚定屏幕左上角——scrollFactor-0 的固定 UI（小地图等）
        // 在任意 zoom 下按"屏幕位置 = 绘制坐标 × zoom"一致换算（origin 0.5 会按视图中心枢轴
        // 平移缩放固定 UI，世界-122 zoom 0.7 时小地图被推到屏幕中部——2026-08-15 修复）
        if (this.cameras.main.originX !== 0 || this.cameras.main.originY !== 0) {
            this.cameras.main.setOrigin(0, 0);
        }
        // 边界钳制（2026-08-14 自 camera.js 迁入）：按 Phaser 相机 viewport/zoom 实时换算可视半宽，
        // 任意缩放比例通用（世界小于视野时取世界中心）；世界-122 不钳制——自然边界 + 人物恒居中
        if (SceneManager && SceneManager.currentScene !== 'scene8') {
            const halfW = viewW / (2 * zoom);
            const halfH = viewH / (2 * zoom);
            const minX = Math.min(halfW, CONFIG.WORLD_WIDTH / 2);
            const minY = Math.min(halfH, CONFIG.WORLD_HEIGHT / 2);
            const maxX = Math.max(CONFIG.WORLD_WIDTH - halfW, CONFIG.WORLD_WIDTH / 2);
            const maxY = Math.max(CONFIG.WORLD_HEIGHT - halfH, CONFIG.WORLD_HEIGHT / 2);
            Camera.x = Math.max(minX, Math.min(maxX, Camera.x));
            Camera.y = Math.max(minY, Math.min(maxY, Camera.y));
        }
        // 世界-122 默认（非瞄准）：玩家恒居镜头中央（2026-08-16 用户要求）——
        // 直接钉在玩家坐标，不做 Camera.x 平滑拖尾（移动时玩家不再偏出中心）；
        // 瞄准时仍走 Camera.x（含 aimOffset 平滑偏移）；无人机、观察、指挥与建筑模式不抢镜头。
        // 注意：GameScene 不持有 this.player，必须用 window.Game.player（与 game.js
        // Camera.update 的跟随目标同一引用），否则快照永远不生效。
        // 纵向以玩家精灵（贴图中心，已含 footOffsetY/elevationZ）
        // 为镜头中心——此前钉逻辑脚底，人物身体恒在屏幕中心上方 ~50px（zoom 0.7 ×
        // 72px 脚底偏移），观感"没居中"。
        const camGame = (typeof window !== 'undefined') ? window.Game : null;
        const camPlayer = camGame ? camGame.player : null;
        const camIsAiming = (Camera.aimOffsetX !== 0 || Camera.aimOffsetY !== 0);
        const camIsDrone = !!(camPlayer && camPlayer.droneSystem && camPlayer.droneSystem.controlling);
        if (SceneManager && SceneManager.currentScene === 'scene8' && !camIsAiming && !camIsDrone && camPlayer
            && !(camGame && camGame._observerMode)
            && !(camGame && camGame.RTSCommand && camGame.RTSCommand.enabled)
            && !(camGame && camGame.BuildingSystem && camGame.BuildingSystem.active)) {
            Camera.x = camPlayer.x;
            const playerSprite = this.playerSprite;
            Camera.y = (playerSprite && playerSprite.active) ? playerSprite.y : camPlayer.y;
        }
        // 居中：走相机原生 centerOn（对任意 zoom/origin 自动换算，绝不手写 scroll 公式），
        // 玩家（Camera 跟随点）在任何缩放比例下都保持在屏幕中央
        this.cameras.main.centerOn(Camera.x + shakeX, Camera.y + shakeY);
    }

    // ---- 实体管理 ----

    _createPlayerSprite() {
        // 创建占位精灵，后续由外部 Player 系统接管控制
        // 锚点设在贴图中心（0.5,0.5），使碰撞矩形中心与贴图中心、逻辑位置三者对齐
        const { spriteSize, collisionWidth, collisionHeight } = PLAYER_DEFAULTS.physics;
        this.playerSprite = this.physics.add.sprite(0, 0, playerTextureKey('idle'));
        this.playerSprite.setOrigin(0.5, 0.5);
        this.playerSprite.setDisplaySize(spriteSize, spriteSize);
        this.playerSprite.setVisible(false); // 初始隐藏，等玩家生成后再显示
        // 配置物理体：无重力（俯视角），设置与配置一致的矩形碰撞体，消除阻力
        const body = this.playerSprite.body;
        body.setGravity(0, 0);
        // 物理体尺寸直接使用配置里的碰撞矩形（60x120），不再取原始纹理尺寸
        body.setSize(collisionWidth, collisionHeight);
        body.setImmovable(false);
        // 消除物理引擎的阻力，让速度完全由代码控制
        body.setDrag(0);
        body.setFriction(0, 0);
        body.setBounce(0, 0);
        body.setDamping(false);
        // 设置 mass 为 1，避免质量影响
        body.setMass(1);
        // 位置由代码完全控制，关闭物理引擎自动积分，避免碰撞导致抖动/瞬移
        // 仅在 Velocity 驱动模式下开启物理自动积分
        body.moves = this._useVelocityDrive;
        // 手部分层 sprite（walk 等 handLayer 姿态）：帧/位置/翻转由 _syncBodiesToPhysics 每帧跟随身体
        this.playerHandSprite = this.add.sprite(0, 0, playerTextureKey('idle'));
        this.playerHandSprite.setOrigin(0.5, 0.5);
        this.playerHandSprite.setDisplaySize(spriteSize, spriteSize);
        this.playerHandSprite.setVisible(false);
        this.playerHandSprite.setDepth(this.playerSprite.depth + 3);
    }

    _ensurePlayerHandSprite() {
        if (!this.playerHandSprite && this.playerSprite) {
            const { spriteSize } = PLAYER_DEFAULTS.physics;
            this.playerHandSprite = this.add.sprite(0, 0, playerTextureKey('idle'));
            this.playerHandSprite.setOrigin(0.5, 0.5);
            this.playerHandSprite.setDisplaySize(spriteSize, spriteSize);
            this.playerHandSprite.setVisible(false);
            this.playerHandSprite.setDepth(this.playerSprite.depth + 3);
        }
        return this.playerHandSprite;
    }

    // 手部分层每帧同步：帧号/位置/翻转跟随身体 sprite，深度恒为身体 +3（在武器 +2 之上）
    _syncPlayerHandLayer() {
        const hand = this.playerHandSprite;
        if (!hand || !hand.active || !this.playerSprite) return;
        // 2026-08-03 修复：手层仅在 handLayer 动画（walk/staff_cast）显示时才需要同步。
        // 隐藏期（recover/attack/idle）纹理可能是只含 __BASE 的 player_idle 或旧手层贴图，
        // 此前每帧 setFrame(身体帧) 会触发 Phaser "Texture has no frame" 告警刷屏
        // （普通攻击/收势期间 100% 复现；截图 GameScene.js:1060 即此处的 setFrame）。
        if (!hand.visible) return;
        hand.setPosition(this.playerSprite.x, this.playerSprite.y);
        hand.setFlipX(this.playerSprite.flipX);
        // 攻击 sheet 带 displayScale；手层必须逐帧继承身体的实际显示尺寸，
        // 否则同一原图坐标会按 144px 手层叠到约 158px 身体上，视觉上必然滑手。
        hand.setDisplaySize(this.playerSprite.displayWidth, this.playerSprite.displayHeight);
        hand.setDepth(this.playerSprite.depth + 3);
        // 帧跟随：身体播 body 动画时，手 sprite 用同一帧索引（两 sheet 同网格同帧序）
        if (this.playerSprite.anims.currentAnim && this.playerSprite.anims.isPlaying) {
            const frameName = this.playerSprite.frame && this.playerSprite.frame.name;
            if (frameName !== undefined && hand.frame && Number(hand.frame.name) !== Number(frameName)) {
                const idx = Number(frameName);
                const tex = hand.texture;
                // 帧存在性守卫：目标帧不在手层贴图内则跳过
                // （idx 0 由 Phaser 回落 __BASE 不告警；NaN/越界直接忽略）
                const frameNames = tex && tex.getFrameNames ? tex.getFrameNames() : [];
                if (idx === 0 || frameNames.includes(String(idx))) {
                    try {
                        hand.setFrame(idx);
                    } catch (_e) { /* 帧越界忽略 */ }
                }
            }
        }
    }

    _onPlayerSpawn(data) {
        if (this.playerSprite) {
            this.playerSprite.setPosition(data.x, data.y);
            // 火柴人模式：不显示 Phaser sprite
            const _game = window.Game;
            const _isStickFigure = _game && _game.player && _game.player._stickFigure;
            this.playerSprite.setVisible(!_isStickFigure);
            this.playerSprite.setActive(!_isStickFigure);
            this.playerSprite.setTexture(playerTextureKey('idle'));

            // Phaser Arcade 体只负责场景物理同步；逻辑 footprint/胶囊/投射物躯干
            // 已由 Player 构造函数建立，禁止在出生回调二次覆盖造成双值状态。
            const { collisionWidth, collisionHeight } = PLAYER_DEFAULTS.physics;
            if (this.playerSprite.body) {
                this.playerSprite.body.setSize(collisionWidth, collisionHeight);
            }
        }
    }

    /**
     * 计算纹理帧中不透明像素的包围盒
     * @returns {{x:number, y:number, w:number, h:number}|null}
     */
    _getFrameVisibleBounds(textureKey, frameName) {
        const texture = this.textures.get(textureKey);
        if (!texture) return null;
        const frame = texture.get(frameName);
        if (!frame || !frame.source || !frame.source.image) return null;
        const img = frame.source.image;
        const cutX = frame.cutX || 0;
        const cutY = frame.cutY || 0;
        const cutW = frame.cutWidth || img.width;
        const cutH = frame.cutHeight || img.height;

        const canvas = document.createElement('canvas');
        canvas.width = cutW;
        canvas.height = cutH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, cutX, cutY, cutW, cutH, 0, 0, cutW, cutH);
        let data;
        try {
            data = ctx.getImageData(0, 0, cutW, cutH).data;
        } catch (_e) {
            return null;
        }

        let minX = cutW, minY = cutH, maxX = 0, maxY = 0;
        let hasPixel = false;
        const threshold = 10; // alpha 阈值
        for (let y = 0; y < cutH; y++) {
            for (let x = 0; x < cutW; x++) {
                const alpha = data[(y * cutW + x) * 4 + 3];
                if (alpha > threshold) {
                    hasPixel = true;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (!hasPixel) return null;
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }

    _onEnemySpawn(data) {
        const texture = data.texture || 'enemy_circle';
        const safeTexture = this.textures.exists(texture) ? texture : 'enemy_circle';
        const enemySprite = this.add.sprite(data.x, data.y, safeTexture);
        enemySprite.setOrigin(0.5, 0.5);
        enemySprite.setData('enemyId', data.id);
        const enemy = data.enemyRef || { size: 14 };
        this._applyEnemyVisualOptions(enemySprite, enemy);
        this.enemies.add(enemySprite);
    }

    // ---- 公共 API（供外部系统调用） ----

    /**
     * 同步玩家位置到 Phaser Sprite
     */
    syncPlayerPosition(x, y, rotation) {
        if (!this.playerSprite) return;
        const shift = this._getFootOffsetY(window.Game && window.Game.player, this.playerSprite);
        this.playerSprite.setPosition(x, y - shift);
        this.playerSprite.setRotation(rotation);
    }

    /**
     * 切换玩家动画（配置驱动：data/player-anim-config.json）
     * @param {string} key 动画键（idle/walk/run/attack_sword/...）
     * @param {number} [targetDurationMs] 播放一次类动画的目标时长；
     *   与贴图自然时长不一致时用 timeScale 拉伸/压缩对齐（攻击 Tween 与贴图同步）
     */
    setPlayerAnimation(key, targetDurationMs = 0) {
        if (!this.playerSprite) return;
        this._swordShieldMotion?.beforeAnimation(key);

        this._lastPlayerAnimKey = key;
        const currentAnim = this.playerSprite.anims.currentAnim?.key;
        // 手部分层（如 walk）：身体层动画键 = player_<key>_body；手 sprite 帧每帧跟随身体帧
        const def = getPlayerAnimDef(key);
        // 显示缩放（配置驱动，2026-08-13）：三段攻击 sheet 站立内容高 432/512，比 idle 的 477/516 小 ~8.4%——
        // displayScale 追平屏显身高（素材侧几何上无法追平：过顶帧 490px 顶着 512 格，见 CHANGELOG 2026-08-13）；
        // 无该字段的动画（idle/walk/recover/施法/闪避/冲刺等）恢复基准尺寸
        const dispScale = (def && def.displayScale) || 1;
        const baseSize = PLAYER_DEFAULTS.physics.spriteSize;
        this.playerSprite.setDisplaySize(baseSize * dispScale, baseSize * dispScale);
        const handLayer = (def && def.handLayer) || null;
        const usesBodyLayer = handLayer && handLayer.overlayOnly !== true;
        const bodyTexKey = usesBodyLayer ? `${playerTextureKey(key)}_body` : null;

        // 根据朝向翻转（侧视精灵图默认朝右）——与武器/锚点同一中轴滞回判定（_getVisualFacingRight），
        // 禁用 _facingDir 四方向制（45° 边界），否则 45°~87° 区间身体与武器朝向相反
        const player = window.Game && window.Game.player;
        if (player) {
            const dashFacing = (player._isDashing || player._dashRecoverAt || player._dashResetAnim)
                && player._dashDirection && player._dashDirection.x !== 0;
            const facingRight = player._isPushStrike
                ? player._pushStrikeFacingRight !== false
                : this._getVisualFacingRight(player);
            this.playerSprite.setFlipX(dashFacing
                ? player._dashDirection.x < 0
                : !facingRight);
        }

        const texKey = playerTextureKey(key);

        // 切换动画前移除旧的完成回调：repeat 0 动画被打断时 Phaser 不发 animationcomplete，
        // once 监听会残留——下一次一次性动画完成时陈旧回调误触发（误切 idle / 误清收势标记）
        if (this._playerAnimCompleteHandler) {
            this.playerSprite.off('animationcomplete', this._playerAnimCompleteHandler);
            this._playerAnimCompleteHandler = null;
        }

        // 默认退出躯干扭转（扭转姿态在下方单帧分支重新启用）
        this._twistConfig = null;
        this._twistState = null;
        // 持枪瞄准的平滑角标记一并复位：切弓/近战后 _syncGunTwist 不再刷新，
        // 残留 true 会让弹道/锚点沿用陈旧平滑角（subsystems.js 消费 _effectiveAim）
        this._frozenAimActive = false;
        if (this.playerTorsoSprite) this.playerTorsoSprite.setVisible(false);
        if (this.playerArmSprite) this.playerArmSprite.setVisible(false);
        if (this.playerSupportArmSprite) this.playerSupportArmSprite.setVisible(false);
        if (this.playerFiringHandSprite) this.playerFiringHandSprite.setVisible(false);

        // 单帧贴图（如待机）：停止动画并贴纹理
        if (!def || def.type !== 'sheet') {
            if (currentAnim && currentAnim !== texKey) {
                this.playerSprite.anims.stop();
            }
            this.playerSprite.anims.timeScale = 1;
            // 手部分层：非 sheet（单帧/无配置）姿态隐藏手 sprite
            if (this.playerHandSprite) {
                this.playerHandSprite.setVisible(false);
            }
            // 上半身分层扭转姿态（如持枪瞄准）：腿层贴玩家 Sprite，躯干层由 _syncGunTwist 驱动
            if (def && def.twist && this.textures.exists(`${texKey}_legs`) && this.textures.exists(`${texKey}_torso`)) {
                this.playerSprite.setTexture(`${texKey}_legs`);
                this._ensureTorsoSprite(`${texKey}_torso`, def.twist);
                this._ensureArmSprite(`${texKey}_arm`, def.twist);
                this._twistConfig = def.twist;
                this._twistTexKey = texKey;
            } else if (this.textures.exists(texKey)) {
                this.playerSprite.setTexture(texKey);
            }
            return;
        }

        // 播放一次的动作（攻击等）：防重入，记录时长，完成后回 idle
        if ((def.repeat !== undefined ? def.repeat : -1) === 0) {
            // 手部分层仅用于循环姿态（walk）与带 handLayer 的一次性动作（如 staff_cast）；
            // 其余一次性动作（攻击/施法等）隐藏手 sprite
            const oneShotKey = usesBodyLayer ? `${texKey}_body` : texKey;
            if (!handLayer && this.playerHandSprite) {
                this.playerHandSprite.setVisible(false);
            }
            if (currentAnim === oneShotKey && this.playerSprite.anims.isPlaying) return;
            // 贴图与动画必须同源（扭转腿层/单帧姿态切换后 texture 可能不匹配，不重置会卡第一帧）
            if (this.playerSprite.texture.key !== oneShotKey) {
                this.playerSprite.setTexture(oneShotKey);
            }
            this.playerSprite.play(oneShotKey, true);
            // 带 handLayer 的一次性动作：显示手 sprite 叠在武器之上（帧跟随由 _syncPlayerHandLayer 每帧同步）
            if (handLayer) {
                this._ensurePlayerHandSprite();
                if (this.playerHandSprite.texture.key !== `${texKey}_hand`) {
                    this.playerHandSprite.setTexture(`${texKey}_hand`);
                }
                this.playerHandSprite.setVisible(true);
                this.playerHandSprite.setFlipX(this.playerSprite.flipX);
                this.playerHandSprite.setPosition(this.playerSprite.x, this.playerSprite.y);
                this._syncPlayerHandLayer();
            }
            const animDef = this.anims.get(texKey);
            // naturalMs 同样按逐帧时长求和优先（否则 frameDurations 系动画 timeScale 算错，
            // 贴图与 Tween 时长再次脱节）
            const naturalMs = getPlayerAnimDurationMs(key) || (animDef && animDef.duration);
            this.playerSprite.anims.timeScale = (targetDurationMs > 0 && naturalMs > 0)
                ? naturalMs / targetDurationMs
                : 1;
            this._playerAttackDuration = targetDurationMs > 0 ? targetDurationMs : naturalMs;
            this._playerAttackStartTime = nowMs();
            const completeHandler = () => {
                this._playerAnimCompleteHandler = null;
                this.playerSprite.anims.timeScale = 1;
                // 连段定格保持：攻击动画播完处于保持窗口时停在末帧，不回 idle
                //（_updatePlayerAnimation 的保持逻辑接管：窗口内接二段 / 超时播 recover）
                const p = window.Game && window.Game.player;
                // 收势动画播完：解除收势标记（原 _updatePlayerAnimation 里的独立 once 会残留，已并入此处）
                if (p && (key === 'recover' || key === 'dash_recover')) {
                    // pose session 全清（收势标记 + 冲刺恢复轨迹块标记等）；此刻不存在更新的 hold——
                    // 收势期间新攻击被输入守卫拒绝，且 setPlayerAnimation 切动画时已移除本回调
                    clearPose(p);
                    if (key === 'recover' && p._specialResetAnim) {
                        p._specialResetAnim = null;
                        p._specialAttackWeaponItem = null;
                        p._specialAttackAnimDuration = 0;
                        p._specialAttackPhase = null;
                        p._specialAttackBeamTimer = 0;
                        p._specialAttackReleaseFrame = 0;
                        p._specialAttackReleaseProgress = 0;
                        p._specialAttackOriginX = null;
                        p._specialAttackOriginY = null;
                    }
                }
                if (p && (key === 'dash_recover' || key === 'dash_recover_thrust')) {
                    p._dashVisualStyle = null;
                }
                if (p && key === 'whirlwind_recover') {
                    p.whirlwindSystem?.finishRecover?.();
                    return;
                }
                // 冲刺期间/冲刺末帧定格期：不切 idle——dash_attack 播完也应停在末帧等恢复动画，
                // 否则定格窗口里贴图被换回 idle（"最后一帧用的是 idle 贴图"的根因）
                if (p && (p._isDashing || p._dashRecoverAt)) return;
                // 风车系统与动画同为技能时长，但两条更新链可能相差一个渲染帧；
                // 动画先完成时先定格末帧，下一帧技能退出后再由常规仲裁恢复 idle/walk。
                if (p && p._isWhirlwind && key === 'whirlwind') return;
                if (p && p._isPushStrike && key === 'push_strike') return;
                // 夜与火之剑复用普通第三段突刺：到 attack3 命中帧即冻结前伸姿态并发射；
                // 此完成事件仅是跨帧兜底，仍会强制贴回配置的释放帧而非动画末帧。
                if (p && p._specialAttackActive && p._specialAttackAnimKey === key) {
                    // 正常路径会在 attack3 的命中/最大前伸帧提前截停；若渲染帧跳过，
                    // 动画完成事件也强制回到同一释放帧，绝不拿动画末帧发射。
                    this._holdNightFlameReleaseFrame(p, false);
                    const item = p._specialAttackWeaponItem || p.equipments?.[p.weaponMode];
                    const weaponType = item?.animConfigKey || item?.weaponType;
                    if (weaponType) this._syncSpecialWeaponAnim(p, weaponType, p.weaponAnim || {});
                    return;
                }
                // 只要近战 pose session 仍存在，就由 ATTACK_HOLD 仲裁统一决定“继续定格”或
                // “到期进入 recover”。animationcomplete 不按墙钟抢先切 idle；尤其第三段
                // hold=0 时，动画完成与 Tween 完成同帧，抢切可能制造人物/武器瞬态错位。
                if (p && p._attackHoldUntil && p._attackHoldAnimKey === key
                    && MELEE_STAGE_ANIM_KEYS.includes(key)) {
                    return;
                }
                this.setPlayerAnimation('idle');
            };
            this._playerAnimCompleteHandler = completeHandler;
            this.playerSprite.once('animationcomplete', completeHandler);
            return;
        }

        // 循环动画（walk/run 等）
        this.playerSprite.anims.timeScale = 1;
        // 手部分层：walk 用身体层动画（去手），手 sprite 单独叠加在武器之上
        const playTexKey = usesBodyLayer ? bodyTexKey : texKey;
        const playAnimKey = usesBodyLayer ? `${texKey}_body` : texKey;
        // currentAnim 相同但已停止（单帧 idle 切换会 anims.stop() 但不清 currentAnim 引用）也必须重播——
        // 否则"走路→停下→再走"时 walk 永远不重启（NPC 对话后走路失效根因）
        if (currentAnim !== playAnimKey || !this.playerSprite.anims.isPlaying) {
            // 贴图与动画必须同源（同上）
            if (this.playerSprite.texture.key !== playTexKey) {
                this.playerSprite.setTexture(playTexKey);
            }
            this.playerSprite.play(playAnimKey, true);
        }
        // 手 sprite：显示并同步纹理（帧在 _syncBodiesToPhysics 每帧跟随）
        if (handLayer) {
            this._ensurePlayerHandSprite();
            if (this.playerHandSprite.texture.key !== `${texKey}_hand`) {
                this.playerHandSprite.setTexture(`${texKey}_hand`);
            }
            this.playerHandSprite.setVisible(true);
            this.playerHandSprite.setFlipX(this.playerSprite.flipX);
            this.playerHandSprite.setPosition(this.playerSprite.x, this.playerSprite.y);
            this._syncPlayerHandLayer();
        } else if (this.playerHandSprite) {
            this.playerHandSprite.setVisible(false);
        }
    }

    /**
     * 玩家施法动作（2026-08-02，空手施法 12 帧/0.5s + 0.25s 倒放后摇）：
     * - 前摇播放 cast 动画，播放到第 releaseFrame 帧（默认第 8 帧）触发 onRelease（魔法实际释放）；
     * - 前摇期间输入全锁（player/update.js 施法分支 early-return）；
     * - 前摇播完自动 0.25s 倒放恢复 idle；后摇阶段空格翻滚可打断（_interruptCastRecover → cancelPlayerCast）；
     * - 施法期间武器不隐藏，保持在 idle 右手持握位置（weaponAnim.state 保持 idle 自然停右手）。
     * 冰锥/火球二段发射、圣光释放等魔法统一走此入口（各系统 _startPlayerCast 包装）。
     */
    startPlayerCast({ onRelease, forwardMs = 500, recoverMs = 250, releaseFrame = 8, totalFrames = 12, holdAtRelease = false }) {
        const p = window.Game && window.Game.player;
        if (!p || !this.playerSprite) return;
        // 施法动画全配置驱动：动画键来自武器数据 castAnimKey（法杖=staff_cast），
        // 释放帧/前摇/后摇时长来自 player-anim-config（releaseFrame/forwardMs/recoverMs）
        const currentItem = p.equipments && p.equipments[p.weaponMode];
        const castKey = (currentItem && currentItem.castAnimKey) || 'cast';
        const castDef = getPlayerAnimDef(castKey);
        const texKey = playerTextureKey(castKey);
        // 手部分层（法杖施法 staff_cast）：身体层去手 + 手层 sprite 叠在武器之上
        const castHandLayer = (castDef && castDef.handLayer) || null;
        const castPlayKey = castHandLayer ? `${texKey}_body` : texKey;
        if (!this.anims.exists(castPlayKey)) { if (onRelease) onRelease(); return; }
        const frameRange = (castDef && castDef.frames) ? castDef.frames : [0, ((castDef && castDef.frameCount) || 1) - 1];
        totalFrames = frameRange[1] - frameRange[0] + 1;
        releaseFrame = (castDef && castDef.releaseFrame) || Math.ceil(totalFrames * 2 / 3);
        forwardMs = (castDef && castDef.forwardMs) || forwardMs;
        recoverMs = (castDef && castDef.recoverMs) || recoverMs;
        // 合金握柄等改造：施法速度加快（前摇/后摇时长除以倍率）
        const castSpeedMul = getCastSpeedMultiplier(p);
        if (castSpeedMul > 1) {
            forwardMs = Math.max(100, Math.floor(forwardMs / castSpeedMul));
            recoverMs = Math.max(50, Math.floor(recoverMs / castSpeedMul));
        }
        // 清掉可能残留的施法监听/状态（不重置玩家状态，避免打断自身流程）
        this.cancelPlayerCast(false);
        p._castState = 'casting';
        p.shieldSystem?.exitDefense();
        p._castReleaseDone = false;
        p._castOnRelease = onRelease || null;
        // 施法跨步：前摇沿起手朝向推进 +30px、后摇退回（update.js 每帧 _updateCastStep 驱动）
        p._castStep = 0;
        p._castStepMax = 30;
        p._castForwardMs = forwardMs;
        p._castRecoverMs = recoverMs;
        p._castStepDirX = Math.cos(p.rotation || 0);
        p._castStepDirY = Math.sin(p.rotation || 0);
        p._castOriginX = p.x; // 起手位置（后摇向此归位，防穿墙钳制后回退过头）
        p._castOriginY = p.y;
        p._castStartTime = nowMs();
        p._castRecoverStartTime = null;
        // 退出扭转/分层姿态
        this._twistConfig = null;
        this._twistState = null;
        if (this.playerTorsoSprite) this.playerTorsoSprite.setVisible(false);
        if (this.playerArmSprite) this.playerArmSprite.setVisible(false);
        if (this.playerSupportArmSprite) this.playerSupportArmSprite.setVisible(false);
        if (this.playerFiringHandSprite) this.playerFiringHandSprite.setVisible(false);
        if (this.playerSprite.texture.key !== castPlayKey) this.playerSprite.setTexture(castPlayKey);
        this.playerSprite.setFlipX(!this._getVisualFacingRight(p));
        // 手部分层：显示手 sprite（帧/位置/翻转由 _syncPlayerHandLayer 每帧跟随）
        if (castHandLayer) {
            this._ensurePlayerHandSprite();
            if (this.playerHandSprite.texture.key !== `${texKey}_hand`) {
                this.playerHandSprite.setTexture(`${texKey}_hand`);
            }
            this.playerHandSprite.setVisible(true);
            this.playerHandSprite.setFlipX(this.playerSprite.flipX);
            this.playerHandSprite.setPosition(this.playerSprite.x, this.playerSprite.y);
        }
        // 前摇：12 帧 / forwardMs
        this.playerSprite.play({ key: castPlayKey, frameRate: totalFrames / (forwardMs / 1000), repeat: 0 });
        this.playerSprite.anims.timeScale = 1;
        this._playerAttackDuration = forwardMs;
        this._playerAttackStartTime = nowMs();
        // 帧回调：播放到第 releaseFrame 帧释放魔法（只触发一次）
        this._castUpdateHandler = (_anim, frame) => {
            if (p._castState !== 'casting') return;
            if (frame.index === releaseFrame - 1 && !p._castReleaseDone) {
                p._castReleaseDone = true;
                const fn = p._castOnRelease;
                p._castOnRelease = null;
                if (fn) fn();
                // 蓄力定格：冻结在释放帧（保持 casting 输入锁定），等 resumePlayerCastHold 再继续
                if (holdAtRelease && p._castState === 'casting') {
                    // 先站稳：瞬间完成前摇跨步（+30px），蓄力期间玩家/手完全静止，光球不随跨步漂移
                    const stepT = 1;
                    const tx = (p._castOriginX ?? p.x) + (p._castStepDirX || 0) * (p._castStepMax || 30) * stepT;
                    const ty = (p._castOriginY ?? p.y) + (p._castStepDirY || 0) * (p._castStepMax || 30) * stepT;
                    if (WallSystem && typeof WallSystem.resolve === 'function') {
                        const resolved = WallSystem.resolve(p.x, p.y, tx, ty, p.groundRadius);
                        p.x = resolved.x;
                        p.y = resolved.y;
                    } else {
                        p.x = tx;
                        p.y = ty;
                    }
                    p._castStartTime = nowMs() - (p._castForwardMs || 500); // t=1：后续跨步不再推进
                    if (this.playerSprite && this.playerSprite.anims) {
                        this.playerSprite.anims.timeScale = 0;
                    }
                    if (this._castCompleteHandler) {
                        if (this.playerSprite) this.playerSprite.off('animationcomplete', this._castCompleteHandler);
                    }
                    this._castHoldActive = true;
                }
            }
        };
        this.playerSprite.on('animationupdate', this._castUpdateHandler);
        // 兜底：animationupdate 万一未触发（事件异常/动画被外部打断），按帧时间释放，避免魔法永远不释放
        if (this._castReleaseTimer) this.time.removeEvent(this._castReleaseTimer);
        this._castReleaseTimer = this.time.delayedCall((releaseFrame / totalFrames) * forwardMs + 40, () => {
            if (p._castState === 'casting' && !p._castReleaseDone) {
                p._castReleaseDone = true;
                const fn = p._castOnRelease;
                p._castOnRelease = null;
                if (fn) fn();
            }
        });
        // 前摇播完 → 倒放后摇（0.25s）
        this._castCompleteHandler = () => {
            if (p._castState !== 'casting') return;
            p._castState = 'recover';
            p._castRecoverOriginX = p.x; // 后摇起点（线性归位到起手位置）
            p._castRecoverOriginY = p.y;
            p._castRecoverStartTime = nowMs();
            this.playerSprite.playReverse({ key: castPlayKey, frameRate: totalFrames / (recoverMs / 1000) });
            this.playerSprite.anims.timeScale = 1;
            this._castRecoverHandler = () => this._endPlayerCast();
            this.playerSprite.once('animationcomplete', this._castRecoverHandler);
            // 兜底：倒放完成事件万一不触发，超时强制收尾
            if (this._castRecoverTimer) this.time.removeEvent(this._castRecoverTimer);
            this._castRecoverTimer = this.time.delayedCall(recoverMs + 80, () => {
                if (p._castState === 'recover') this._endPlayerCast();
            });
        };
        this.playerSprite.once('animationcomplete', this._castCompleteHandler);
    }

    /** 蓄力定格结束：恢复施法动画继续播完前摇 → 现有倒放后摇回 idle（贯穿雷枪蓄力释放/取消后调用） */
    resumePlayerCastHold() {
        if (!this._castHoldActive) return false;
        this._castHoldActive = false;
        if (this.playerSprite && this.playerSprite.anims) {
            this.playerSprite.anims.timeScale = 1;
        }
        const p = window.Game && window.Game.player;
        if (p && p._castState === 'casting' && this._castCompleteHandler && this.playerSprite) {
            // 重新挂前摇播完 → 倒放后摇 → idle
            this.playerSprite.once('animationcomplete', this._castCompleteHandler);
            return true;
        }
        return false;
    }

    /** 取消/结束施法：清监听、恢复武器显示；resetState=false 仅清监听（startPlayerCast 内部用） */
    cancelPlayerCast(resetState = true) {
        const p = window.Game && window.Game.player;
        if (this._castHoldActive) {
            this._castHoldActive = false;
            if (this.playerSprite && this.playerSprite.anims) this.playerSprite.anims.timeScale = 1;
        }
        if (this._castUpdateHandler) {
            if (this.playerSprite) this.playerSprite.off('animationupdate', this._castUpdateHandler);
            this._castUpdateHandler = null;
        }
        if (this._castCompleteHandler) {
            if (this.playerSprite) this.playerSprite.off('animationcomplete', this._castCompleteHandler);
            this._castCompleteHandler = null;
        }
        if (this._castRecoverHandler) {
            if (this.playerSprite) this.playerSprite.off('animationcomplete', this._castRecoverHandler);
            this._castRecoverHandler = null;
        }
        if (this._castRecoverTimer) {
            this.time.removeEvent(this._castRecoverTimer);
            this._castRecoverTimer = null;
        }
        if (this._castReleaseTimer) {
            this.time.removeEvent(this._castReleaseTimer);
            this._castReleaseTimer = null;
        }
        if (resetState) {
            if (p) {
                p._castState = 'idle';
                p._castReleaseDone = true;
                p._castOnRelease = null;
                p._castStep = 0;
                p._castStartTime = null;
                p._castRecoverStartTime = null;
                p._castOriginX = null;
                p._castOriginY = null;
                p._castRecoverOriginX = null;
                p._castRecoverOriginY = null;
            }
            // 施法被打断（眩晕/冻结/翻滚打断后摇）时同步隐藏手层，避免残留可见帧
            if (this.playerHandSprite) this.playerHandSprite.setVisible(false);
        }
    }

    /** 后摇倒放完成/被打断后的收尾：回 idle */
    _endPlayerCast() {
        const p = window.Game && window.Game.player;
        this.cancelPlayerCast();
        if (p) this.setPlayerAnimation('idle');
    }

    /**
     * 创建/复用躯干层 Sprite（原点=腰轴心，位置由 _syncGunTwist 每帧贴到腰轴世界点）
     */
    _ensureTorsoSprite(torsoKey, twist) {
        const frameW = this.playerSprite.frame.width || 512;
        const frameH = this.playerSprite.frame.height || 516;
        if (!this.playerTorsoSprite) {
            this.playerTorsoSprite = this.add.sprite(0, 0, torsoKey);
        } else if (this.playerTorsoSprite.texture.key !== torsoKey) {
            this.playerTorsoSprite.setTexture(torsoKey);
        }
        this.playerTorsoSprite.setOrigin(twist.pivotX / frameW, twist.pivotY / frameH);
        this.playerTorsoSprite.setVisible(true);
    }

    /**
     * 上半身分层扭转（持枪 360° 瞄准）：
     * 腿层站死，躯干层绕腰轴随瞄准角旋转（按比例钳制 ±maxAngle），翻转/位置/深度每帧同步。
     * 输出 _twistState 供 syncWeapon 把枪锚点绕同一腰轴旋转（躯干带手臂转，枪必须跟手）。
     */
    _syncGunTwist(player) {
        const twist = this._twistConfig;
        if (!twist || !this.playerTorsoSprite || !this.playerSprite || !player) return;
        // 地图模式/玩家隐藏时躯干层同步隐藏
        if (this._mapModeActive || !this.playerSprite.visible) {
            this.playerTorsoSprite.setVisible(false);
            this._twistState = null;
            return;
        }

        // 腰射⇄瞄准过渡（仅双手枪械）：长按右键瞄准时 aimEase 0→1 平滑推进，退出反向回落。
        // 推进条件挂 aimLift（Tier1 抬升）或 aimFrames（帧动画）任一配置存在，
        // 两者只决定"怎么表现瞄准"，不决定"是否推进"——删表现配置不会导致 ease 恒 0
        const currentItem = player.equipments && player.equipments[player.weaponMode];
        const twoHandedGun = currentItem && isGunWeapon(currentItem) && isTwoHanded(currentItem);
        const aimCfg = twist.aimFrames || twist.aimLift;
        const aiming = !!(twoHandedGun && player._aimModeActive && aimCfg);
        const ms = (aimCfg && aimCfg.transitionMs) || 150;
        const now = nowMs();
        const dtMs = this._aimEaseLastT ? Math.min(50, now - this._aimEaseLastT) : 16.67;
        this._aimEaseLastT = now;
        if (this._aimEaseT === undefined) this._aimEaseT = 0;
        // 线性推进（不用指数趋近）：去程=回程严格镜像倒放，transitionMs 内干净到位。
        // 指数趋近在回程 ease≈0.05 处拖 ~1s 尾巴——手臂仍挂帧动画条但锚点已近旧链，
        // 且帧条旋转基准（前手 ~39°）与静态条（后手 ~84°）不同，表现为回程结尾变形
        this._aimEaseT = Math.max(0, Math.min(1, this._aimEaseT + (aiming ? 1 : -1) * (dtMs / ms)));
        const t = this._aimEaseT;
        this._aimEase = t * t * (3 - 2 * t); // smoothstep（端点柔化，仍有限时长、严格倒放）
        const frameW = this.playerSprite.frame.width || 512;
        const frameH = this.playerSprite.frame.height || 516;
        const dispW = this.playerSprite.displayWidth;
        const dispH = this.playerSprite.displayHeight;
        let aim;
        let facingRight;
        // 瞄准角（世界）与面向（±0.05 死区防正上/正下翻转抖动）
        const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
        const rawAim = Math.atan2(mouseWorld.y - player.y, mouseWorld.x - player.x);
        // 近距角度平滑（取代死区/可调锥，2026-07-27）：任何距离都用真实瞄准方向（弹道零误差），
        // 准心进入 aimSmoothRadius 内时对瞄准角做短弧 EMA——准心贴近时鼠标小位移会引起角度瞬变，
        // 躯干钳制/手臂/锚点跟不上会错位；平滑让角速度有界（近强远弱，出半径立即恢复零延迟）。
        // 贴图/锚点/弹道统一走 _effectiveAim（沿用 _frozenAimActive 标记，语义=平滑激活），四通道同口径
        const smoothR = twist.aimSmoothRadius ?? 160;
        const distToMouse = Math.hypot(mouseWorld.x - player.x, mouseWorld.y - player.y);
        aim = rawAim;
        if (distToMouse < smoothR) {
            const now2 = nowMs();
            const dtMs2 = this._aimSmoothLastT ? Math.min(50, now2 - this._aimSmoothLastT) : 16.67;
            // 平滑时间常数：边缘≈0（零延迟）→ 中心 aimSmoothTau（默认 120ms，越大越"肉"，近战弱可加大）
            const smoothT = 1 - distToMouse / smoothR;
            const tau = (twist.aimSmoothTau ?? 120) * smoothT;
            const k = tau > 0.01 ? 1 - Math.exp(-dtMs2 / tau) : 1;
            const prev = this._smoothedAim !== undefined ? this._smoothedAim : rawAim;
            let diff = rawAim - prev;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // 短弧插值防 ±π 绕远路
            aim = prev + diff * k;
            this._smoothedAim = aim;
            this._frozenAimActive = true;
        } else {
            this._smoothedAim = rawAim;
            this._frozenAimActive = false;
        }
        this._aimSmoothLastT = nowMs();
        this._effectiveAim = aim;
        facingRight = this._twistState ? this._twistState.facingRight : true;
        const cosAim = Math.cos(aim); // 同帧同值复用（恒等化简，数学结果不变；Phase 4）
        if (cosAim > 0.05) facingRight = true;
        else if (cosAim < -0.05) facingRight = false;
        // 面向系内相对角，归一化后按比例钳制
        let rel = facingRight ? aim : Math.PI - aim;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        const max = (twist.maxAngle ?? 40) * Math.PI / 180;
        const angleScale = twist.angleScale ?? 1;
        const clamped = Math.max(-max, Math.min(max, rel * angleScale));
        // 腰轴世界点（腿层贴图坐标 → 世界；翻转时 X 镜像）
        // 走腿 sheet 已按 idle 髋/脚基准逐帧烘焙对齐（217/500），walking 与 idle 完全一致，
        // 不再需要逐帧髋部跟随；torsoShiftY 为躯干整体下移微调（世界 px，配置驱动）
        const pivotLocalX = (twist.pivotX / frameW - 0.5) * dispW;
        const pivotLocalY = (twist.pivotY / frameH - 0.5) * dispH;
        // torsoShiftX/torsoShiftY：躯干整体位置微调（世界 px，配置驱动；X 随翻转镜像）
        const torsoShiftX = twist.torsoShiftX || 0;
        let pivotWorldX = this.playerSprite.x + (facingRight ? pivotLocalX + torsoShiftX : -pivotLocalX - torsoShiftX);
        let pivotWorldY = this.playerSprite.y + pivotLocalY + (twist.torsoShiftY || 0);

        // 开火后坐上身抖动：读武器动画的 recoil（枪械状态机驱动），取小比例反向作用于腰轴——
        // 躯干/肩/枪锚点同步后坐（腿不动），twist.recoilTorsoScale 配置比例（0 关闭）
        const torsoRecoilScale = twist.recoilTorsoScale !== undefined ? twist.recoilTorsoScale : 0.3;
        if (torsoRecoilScale > 0 && player.weaponAnim && player.weaponAnim.state && player.weaponAnim.state !== 'idle') {
            const recoilParams = typeof player._getWeaponAnimParams === 'function' ? player._getWeaponAnimParams() : null;
            const recoil = (recoilParams && recoilParams.recoil) || 0;
            if (recoil !== 0) {
                const kick = recoil * torsoRecoilScale;
                pivotWorldX -= Math.cos(aim) * kick;
                pivotWorldY -= Math.sin(aim) * kick;
            }
        }

        // 走/跑周期身体起伏：躯干/肩/枪锚点随原动画体感逐帧上下（bodyBobY 数据驱动，
        // isPlaying 防御——stop() 后 currentAnim 引用不清空，站立时不得误用走路帧偏移）
        const curLegsKey = this.playerSprite.anims.isPlaying ? this.playerSprite.anims.currentAnim?.key : null;
        let bobPart = null;
        if (curLegsKey === `${this._twistTexKey}_walklegs`) bobPart = twist.walkLegs;
        else if (curLegsKey === `${this._twistTexKey}_runlegs`) bobPart = twist.runLegs;
        if (bobPart && bobPart.bodyBobY) {
            // Phaser AnimationFrame.index 为 1-based；配置数组为 0-based。
            const bobIdx = this.playerSprite.anims.currentFrame
                ? Math.max(0, this.playerSprite.anims.currentFrame.index - 1)
                : 0;
            const bobScale = bobPart.bobScale !== undefined ? bobPart.bobScale : 1;
            const bdy = (bobPart.bodyBobY[bobIdx] || 0) * (dispH / bobPart.frameHeight) * bobScale;
            pivotWorldY += bdy;
            this._bobDelta = { x: 0, y: bdy };
            // 跑步左右摇摆：髋部 X 逐帧偏移（bodyBobX，翻转镜像；bobXScale 默认 0.5 轻微档）
            if (bobPart.bodyBobX) {
                const bobXScale = bobPart.bobXScale !== undefined ? bobPart.bobXScale : 0.5;
                // 方向取反：实测序列与步态前后方向相反（该前时后、该后时前）
                const bdxRaw = -(bobPart.bodyBobX[bobIdx] || 0) * (dispW / bobPart.frameWidth) * bobXScale;
                const bdx = facingRight ? bdxRaw : -bdxRaw;
                pivotWorldX += bdx;
                this._bobDelta.x = bdx;
            }
        } else {
            this._bobDelta = { x: 0, y: 0 };
        }
        // 躯干层：原点即轴心，贴到轴点旋转；左瞄用烘焙镜像贴图 + 镜像原点（不用 flipX，语义确定）
        const torsoBaseKey = `${this._twistTexKey}_torso`;
        const torsoFlipKey = `${torsoBaseKey}_flip`;
        const useFlip = !facingRight && this.textures.exists(torsoFlipKey);
        const wantKey = useFlip ? torsoFlipKey : torsoBaseKey;
        if (this.playerTorsoSprite.texture.key !== wantKey) {
            this.playerTorsoSprite.setTexture(wantKey);
        }
        this.playerTorsoSprite.setOrigin(
            (useFlip ? (frameW - twist.pivotX) : twist.pivotX) / frameW,
            twist.pivotY / frameH
        );
        this.playerTorsoSprite.setPosition(pivotWorldX, pivotWorldY);
        this.playerTorsoSprite.setDisplaySize(dispW, dispH);
        this.playerTorsoSprite.setFlipX(false);
        this.playerTorsoSprite.setRotation(facingRight ? clamped : -clamped);
        this.playerTorsoSprite.setDepth(this.playerSprite.depth + 0.01);
        this.playerTorsoSprite.setVisible(true);
        // 腿层翻转跟随瞄准方向（覆盖 _facingDir 的翻转）
        this.playerSprite.setFlipX(!facingRight);
        // 供 syncWeapon 枪锚点绕腰轴旋转
        this._twistState = { angle: clamped, facingRight, pivotX: pivotWorldX, pivotY: pivotWorldY };
    }

    /**
     * 创建/复用手臂条 Sprite（原点=肩关节，旋转由 _syncGunArm 每帧驱动）
     */
    _ensureArmSprite(armKey, twist) {
        if (!twist.arm || !this.textures.exists(armKey)) return;
        const frameW = this.playerSprite.frame.width || 512;
        const frameH = this.playerSprite.frame.height || 516;
        if (!this.playerArmSprite) {
            this.playerArmSprite = this.add.sprite(0, 0, armKey);
        } else if (this.playerArmSprite.texture.key !== armKey) {
            this.playerArmSprite.setTexture(armKey);
        }
        this.playerArmSprite.setOrigin(twist.arm.pivotX / frameW, twist.arm.pivotY / frameH);
        this.playerArmSprite.setVisible(true);
    }

    _ensureSupportArmSprite(supportKey) {
        if (!supportKey || !this.textures.exists(supportKey)) return null;
        if (!this.playerSupportArmSprite) {
            this.playerSupportArmSprite = this.add.sprite(0, 0, supportKey);
        } else if (this.playerSupportArmSprite.texture.key !== supportKey) {
            this.playerSupportArmSprite.setTexture(supportKey);
        }
        return this.playerSupportArmSprite;
    }

    _ensureFiringHandSprite(firingHandKey) {
        if (!firingHandKey || !this.textures.exists(firingHandKey)) return null;
        if (!this.playerFiringHandSprite) {
            this.playerFiringHandSprite = this.add.sprite(0, 0, firingHandKey);
        } else if (this.playerFiringHandSprite.texture.key !== firingHandKey) {
            this.playerFiringHandSprite.setTexture(firingHandKey);
        }
        return this.playerFiringHandSprite;
    }

    /**
     * 双层持枪臂：后手帧只追随主握把；托举臂以躯干肩点为根，独立解到当前武器护木点。
     * 只读渲染姿态与握点，不改变武器主轴、枪口、命中或任何 gameplay 状态。
     */
    _syncGunArm() {
        const twist = this._twistConfig;
        if (!twist || !twist.arm || !this.playerArmSprite) {
            if (this.playerSupportArmSprite) this.playerSupportArmSprite.setVisible(false);
            if (this.playerFiringHandSprite) this.playerFiringHandSprite.setVisible(false);
            this._gunFiringHandWorld = null;
            this._gunFiringHandContactError = null;
            return;
        }
        if (!this._twistState || !this.playerTorsoSprite || !this.playerTorsoSprite.visible) {
            this.playerArmSprite.setVisible(false);
            if (this.playerSupportArmSprite) this.playerSupportArmSprite.setVisible(false);
            if (this.playerFiringHandSprite) this.playerFiringHandSprite.setVisible(false);
            this._gunFiringHandWorld = null;
            this._gunFiringHandContactError = null;
            this._gunSupportContactError = null;
            this._gunSupportGuardWorld = null;
            return;
        }
        const arm = twist.arm;
        const ts = this._twistState;
        const frameW = this.playerSprite.frame.width || 512;
        const frameH = this.playerSprite.frame.height || 516;
        const dispW = this.playerSprite.displayWidth;
        const dispH = this.playerSprite.displayHeight;
        // 肩关节世界点：肩在躯干上，随躯干扭转绕腰轴旋转
        const dSx = ((arm.pivotX - twist.pivotX) / frameW) * dispW;
        const dSy = ((arm.pivotY - twist.pivotY) / frameH) * dispH;
        const tw = ts.facingRight ? ts.angle : -ts.angle;
        const cosT = Math.cos(tw), sinT = Math.sin(tw);
        const offX = ts.facingRight ? dSx : -dSx;
        const shoulderX = ts.pivotX + offX * cosT - dSy * sinT;
        const shoulderY = ts.pivotY + offX * sinT + dSy * cosT;
        // 贴图内自然角（肩→手）
        const natural = Math.atan2(arm.handY - arm.pivotY, arm.handX - arm.pivotX);
        // 握把世界点（上一帧 syncWeapon 记录；首帧用自然向量兜底）
        const grip = this._gunGripWorld || {
            x: shoulderX + Math.cos(natural) * dispW * 0.12,
            y: shoulderY + Math.sin(natural) * dispW * 0.12,
        };
        const aimAng = Math.atan2(grip.y - shoulderY, grip.x - shoulderX);
        // aimFrames 分支（腰射→瞄准帧动画）：仅在瞄准过渡/瞄准状态（_aimEase>0）接管——
        // ease=0 时完全走下方旧静态手臂路径，保证非瞄准状态与接入前逐像素等价。
        // 旋转轴心沿用 twist.arm.pivot（帧 0 已与静态手臂条对齐），帧自然角随帧手部坐标变化
        const af = twist.aimFrames;
        if (af && this._aimEase > 0) {
            const afBaseKey = `${this._twistTexKey}_aimframes`;
            if (this.textures.exists(afBaseKey) && af.hands && af.hands.length) {
                const fi = Math.max(0, Math.min(af.hands.length - 1, Math.round(this._aimEase * (af.hands.length - 1))));
                const hand = af.hands[fi];
                const naturalF = Math.atan2(hand.y - arm.pivotY, hand.x - arm.pivotX);
                const naturalEffF = ts.facingRight ? naturalF : Math.PI - naturalF;
                const rotF = aimAng - naturalEffF;
                const afFlipKey = `${afBaseKey}_flip`;
                const useFlipF = !ts.facingRight && this.textures.exists(afFlipKey);
                const wantKeyF = useFlipF ? afFlipKey : afBaseKey;
                if (this.playerArmSprite.texture.key !== wantKeyF) {
                    this.playerArmSprite.setTexture(wantKeyF, fi);
                } else {
                    this.playerArmSprite.setFrame(fi);
                }
                this.playerArmSprite.setOrigin((useFlipF ? (frameW - arm.pivotX) : arm.pivotX) / frameW, arm.pivotY / frameH);
                this.playerArmSprite.setPosition(shoulderX, shoulderY);
                this.playerArmSprite.setDisplaySize(dispW, dispH);
                this.playerArmSprite.setRotation(rotF);
                this.playerArmSprite.setDepth(this.playerSprite.depth + 0.02);
                this.playerArmSprite.setVisible(true);

                // 后手不再烘焙在主臂末端。它以枪械贴图的真实 rear grip 为唯一原点，
                // 并随枪身旋转/上下翻面：后握把穿过掌指间的留白，指骨叠在武器前景，
                // 才能在向右以及任意枪管角度都读成“抓住握把”。
                const firingHandKey = `${this._twistTexKey}_aimfiringhand`;
                const firingHandSprite = af.firingHandSrc
                    ? this._ensureFiringHandSprite(firingHandKey)
                    : null;
                const firingHandAnchor = af.firingHandAnchor || { x: 64, y: 64 };
                const firingHandFrameW = af.firingHandFrameWidth || 128;
                const firingHandFrameH = af.firingHandFrameHeight || 128;
                if (firingHandSprite && grip && this.weaponSprite?.visible) {
                    if (firingHandSprite.texture.key !== firingHandKey) firingHandSprite.setTexture(firingHandKey, fi);
                    else firingHandSprite.setFrame(fi);
                    firingHandSprite.setOrigin(
                        firingHandAnchor.x / firingHandFrameW,
                        firingHandAnchor.y / firingHandFrameH
                    );
                    firingHandSprite.setPosition(grip.x, grip.y);
                    firingHandSprite.setDisplaySize(
                        dispW * firingHandFrameW / frameW,
                        dispH * firingHandFrameH / frameH
                    );
                    firingHandSprite.setRotation(this.weaponSprite.rotation);
                    firingHandSprite.setFlipX(false);
                    firingHandSprite.setFlipY(!!this.weaponSprite.flipY);
                    firingHandSprite.setDepth(this.playerSprite.depth + 3);
                    firingHandSprite.setVisible(true);
                    this._gunFiringHandWorld = { x: grip.x, y: grip.y };
                    this._gunFiringHandContactError = this._gunRearGripRenderWorld
                        ? Math.hypot(
                            this._gunRearGripRenderWorld.x - grip.x,
                            this._gunRearGripRenderWorld.y - grip.y
                        )
                        : null;
                } else {
                    if (this.playerFiringHandSprite) this.playerFiringHandSprite.setVisible(false);
                    this._gunFiringHandWorld = null;
                    this._gunFiringHandContactError = null;
                }

                // 托枪臂独立跟随当前武器的真实护木点。主握枪臂仍只绑定后握把；两层分离后，
                // 精确 ADS 改变枪身角度时不会再把托举掌心留在旧的主臂旋转轴上。
                const supportVariant = af.supportVariants?.[this._gunAnimConfigKey]
                    ? this._gunAnimConfigKey
                    : null;
                const supportBaseKey = `${this._twistTexKey}_aimsupport${supportVariant ? `_${supportVariant}` : ''}`;
                const supportFlipKey = `${supportBaseKey}_flip`;
                const supportKey = useFlipF && this.textures.exists(supportFlipKey)
                    ? supportFlipKey
                    : supportBaseKey;
                const supportSprite = this._ensureSupportArmSprite(supportKey);
                const supportShoulder = af.supportShoulders?.[fi];
                const supportHand = af.supportHands?.[fi];
                const supportContact = (supportVariant
                    ? af.supportContactVariants?.[supportVariant]
                    : af.supportContacts)?.[fi] || supportHand;
                const supportGrip = this.weaponSprite?.visible
                    ? WeaponTransform.getTextureSupportGrip(this._gunAnimConfigKey, this.weaponSprite.texture.key)
                    : null;
                if (supportSprite && supportShoulder && supportContact && supportGrip) {
                    // 肩点属于躯干：围绕同一腰轴随 torso twist 变换，而不是跟随后手臂旋转。
                    const dSupportShoulderX = ((supportShoulder.x - twist.pivotX) / frameW) * dispW;
                    const dSupportShoulderY = ((supportShoulder.y - twist.pivotY) / frameH) * dispH;
                    const supportShoulderOffsetX = ts.facingRight ? dSupportShoulderX : -dSupportShoulderX;
                    const supportShoulderWorldX = ts.pivotX + supportShoulderOffsetX * cosT - dSupportShoulderY * sinT;
                    const supportShoulderWorldY = ts.pivotY + supportShoulderOffsetX * sinT + dSupportShoulderY * cosT;

                    // supportGrip 是未翻转贴图分数坐标；按 Sprite 当前 origin/flip/rotation
                    // 还原为世界点，因此逐枪缩放、左右镜像和任意瞄准角都共用同一接触口径。
                    const weaponLocalX = (supportGrip.x - this.weaponSprite.originX)
                        * this.weaponSprite.displayWidth * (this.weaponSprite.flipX ? -1 : 1);
                    const weaponLocalY = (supportGrip.y - this.weaponSprite.originY)
                        * this.weaponSprite.displayHeight * (this.weaponSprite.flipY ? -1 : 1);
                    const weaponCos = Math.cos(this.weaponSprite.rotation);
                    const weaponSin = Math.sin(this.weaponSprite.rotation);
                    const supportTargetX = this.weaponSprite.x + weaponLocalX * weaponCos - weaponLocalY * weaponSin;
                    const supportTargetY = this.weaponSprite.y + weaponLocalX * weaponSin + weaponLocalY * weaponCos;

                    // supportHands 是解算骨架的掌心端点，卷指姿态里它可能落在掌内空腔。
                    // supportContact 则是该帧真实可见的下侧掌缘/指缘像素。过渡前段仍保留
                    // “伸手去托枪”的原动作（若首帧直接锁护木会把手臂拉长到约2.26倍），
                    // 但接触解算从此以真实像素为端点，完整 ADS 时严格坐在不透明护木下缘。
                    const sourceVectorX = (useFlipF
                        ? supportShoulder.x - supportContact.x
                        : supportContact.x - supportShoulder.x) * dispW / frameW;
                    const sourceVectorY = (supportContact.y - supportShoulder.y) * dispH / frameH;
                    const authoredTargetX = supportShoulderWorldX
                        + sourceVectorX * Math.cos(rotF) - sourceVectorY * Math.sin(rotF);
                    const authoredTargetY = supportShoulderWorldY
                        + sourceVectorX * Math.sin(rotF) + sourceVectorY * Math.cos(rotF);
                    const contactT = Math.max(0, Math.min(1, this._aimEase || 0));
                    const contactBlend = contactT * contactT * (3 - 2 * contactT);
                    const currentTargetX = authoredTargetX + (supportTargetX - authoredTargetX) * contactBlend;
                    const currentTargetY = authoredTargetY + (supportTargetY - authoredTargetY) * contactBlend;
                    const targetVectorX = currentTargetX - supportShoulderWorldX;
                    const targetVectorY = currentTargetY - supportShoulderWorldY;
                    const sourceLength = Math.max(0.001, Math.hypot(sourceVectorX, sourceVectorY));
                    const targetLength = Math.max(0.001, Math.hypot(targetVectorX, targetVectorY));
                    const supportScale = targetLength / sourceLength;
                    const supportRotation = Math.atan2(targetVectorY, targetVectorX)
                        - Math.atan2(sourceVectorY, sourceVectorX);

                    if (supportSprite.texture.key !== supportKey) supportSprite.setTexture(supportKey, fi);
                    else supportSprite.setFrame(fi);
                    supportSprite.setOrigin(
                        (useFlipF ? frameW - supportShoulder.x : supportShoulder.x) / frameW,
                        supportShoulder.y / frameH
                    );
                    supportSprite.setPosition(supportShoulderWorldX, supportShoulderWorldY);
                    supportSprite.setDisplaySize(dispW * supportScale, dispH * supportScale);
                    supportSprite.setRotation(supportRotation);
                    supportSprite.setDepth(this.playerSprite.depth + 0.02);
                    supportSprite.setVisible(true);

                    const supportCos = Math.cos(supportRotation);
                    const supportSin = Math.sin(supportRotation);
                    const solvedHandX = supportShoulderWorldX
                        + sourceVectorX * supportScale * supportCos - sourceVectorY * supportScale * supportSin;
                    const solvedHandY = supportShoulderWorldY
                        + sourceVectorX * supportScale * supportSin + sourceVectorY * supportScale * supportCos;
                    this._gunSupportHandWorld = { x: solvedHandX, y: solvedHandY };
                    this._gunSupportTargetWorld = { x: currentTargetX, y: currentTargetY };
                    this._gunSupportGuardWorld = { x: supportTargetX, y: supportTargetY };
                    this._gunSupportContactError = Math.hypot(solvedHandX - currentTargetX, solvedHandY - currentTargetY);
                } else {
                    if (this.playerSupportArmSprite) this.playerSupportArmSprite.setVisible(false);
                    this._gunSupportContactError = null;
                    this._gunSupportGuardWorld = null;
                }
                return;
            }
        }
        if (this.playerSupportArmSprite) this.playerSupportArmSprite.setVisible(false);
        if (this.playerFiringHandSprite) this.playerFiringHandSprite.setVisible(false);
        this._gunFiringHandWorld = null;
        this._gunFiringHandContactError = null;
        this._gunSupportContactError = null;
        this._gunSupportGuardWorld = null;
        // 翻转时用烘焙镜像贴图：其自然角为 π − natural（镜像后手的方向），旋转公式两侧统一
        const naturalEff = ts.facingRight ? natural : Math.PI - natural;
        const rot = aimAng - naturalEff;
        // 翻转：烘焙镜像贴图 + 镜像原点
        const armBaseKey = `${this._twistTexKey}_arm`;
        const armFlipKey = `${armBaseKey}_flip`;
        const useFlip = !ts.facingRight && this.textures.exists(armFlipKey);
        const wantKey = useFlip ? armFlipKey : armBaseKey;
        if (this.playerArmSprite.texture.key !== wantKey) {
            this.playerArmSprite.setTexture(wantKey);
        }
        this.playerArmSprite.setOrigin((useFlip ? (frameW - arm.pivotX) : arm.pivotX) / frameW, arm.pivotY / frameH);
        this.playerArmSprite.setPosition(shoulderX, shoulderY);
        this.playerArmSprite.setDisplaySize(dispW, dispH);
        this.playerArmSprite.setRotation(rot);
        this.playerArmSprite.setDepth(this.playerSprite.depth + 0.02);
        this.playerArmSprite.setVisible(true);
    }

    /**
     * 在武器渲染快照前只推进“已经到期的近战定格”。
     * syncWeapon 也会被开发工具单独调用，不能在其中写 gameplay 状态；整段动画仲裁仍保留
     * 在常规更新位置，避免提前清理枪械 twist/aim 状态。
     */
    _advanceExpiredMeleeHoldBeforeWeaponSync(_game) {
        const player = _game && _game.player;
        if (!player || !this.playerSprite || !this.playerSprite.active
            || resolveAnimChannel(player) !== AnimChannel.ATTACK_HOLD
            || player._attackRecovering
            || player.isMoving
            || !player._attackHoldUntil
            || nowMs() < player._attackHoldUntil
            || !MELEE_STAGE_ANIM_KEYS.includes(player._attackHoldAnimKey)) {
            return;
        }
        this._updatePlayerAnimation(_game);
    }

    /**
     * 根据玩家移动状态自动切换 walk/run/idle 动画
     * 攻击/特殊动画期间不覆盖
     */
    _updatePlayerAnimation(_game) {
        if (!_game || !_game.player || !this.playerSprite || !this.playerSprite.active) return;
        const player = _game.player;
        if (player.hasStatusEffect?.('petrified') || this._petrifyFx?.has(player)) {
            return;
        }
        // 动画通道仲裁（玩家动画优化 Phase 2 / 步骤 2.1）：原 6 级 if 守卫收敛为查表分派。
        // 通道谓词见 src/entities/player/anim-state.js（只读、与原 if 链条件/顺序逐字等价）；
        // 各 case 体内代码为原 if 链逐行搬运，写副作用（近战卡死复位、dash 到点触发等）保持原位。
        const animCtx = {}; // 通道判定的附带产物（如 gunPose 解析结果），case 内复用避免二次计算
        const channel = resolveAnimChannel(player, animCtx);
        switch (channel) {
        case AnimChannel.DEAD:
            return;
        // 施法动画期间不被移动/状态机覆盖（前摇+后摇由 startPlayerCast 独立驱动，
        // 第 8 帧释放依赖动画完整播放到目标帧；否则每帧 idle/walk 覆盖导致永远不释放）
        case AnimChannel.CAST: {
            // 兜底：施法动画没在播（注册失败/被外部打断等）时自动收尾，防施法状态软锁
            const curCastKey = (player.equipments && player.equipments[player.weaponMode] && player.equipments[player.weaponMode].castAnimKey) || 'cast';
            const castAnimKey = playerTextureKey(curCastKey);
            // 兼容手部分层：法杖施法实际播 player_staff_cast_body（身体层去手）
            const castDefG = getPlayerAnimDef(curCastKey);
            const castPlayKey = (castDefG && castDefG.handLayer) ? `${castAnimKey}_body` : castAnimKey;
            const cur = this.playerSprite.anims.currentAnim?.key;
            if (cur !== castPlayKey || !this.playerSprite.anims.isPlaying) {
                this._endPlayerCast();
            }
            return;
        }

        // 攻击/特殊动画期间不覆盖
        case AnimChannel.MELEE_ATTACK: {
            const weaponAnim = player.weaponAnim || {};
            const currentItem = player.equipments[player.weaponMode];
            const isMeleeWeapon = currentItem && (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword');
            const currentAnimKey = this.playerSprite.anims.currentAnim?.key;
            // 仅对近战武器做安全防护：逻辑层标记为攻击中，但剑攻击动画已停止，说明状态卡住，强制恢复
            const isPlayingAttackAnim = isMeleeWeapon && MELEE_STAGE_ANIM_KEYS.some(k => this._playerAnimKeyMatches(currentAnimKey, k)) && this.playerSprite.anims.isPlaying;
            if (isMeleeWeapon && weaponAnim.isAttacking && !isPlayingAttackAnim) {
                weaponAnim.isAttacking = false;
                weaponAnim.state = 'idle';
                // 卡死复位后原 if 链会继续向下执行 → 按新状态重新仲裁（复位后 MELEE_ATTACK 不再成立，递归即等价落闸）
                this._updatePlayerAnimation(_game);
                return;
            }
            // 枪械放行：枪开火时 weaponAnim.state='attacking'，但枪的攻击动画在武器贴图层，
            // playerSprite 只承载腿/躯干层——此处 early-return 会冻结腿层（冲刺开火时 runlegs 切不回 walklegs）。
            // 近战保留守卫（attack_sword 动画在 playerSprite 上，不能被覆盖）；
            // 枪械姿态下通道谓词不成立、不会进入本 case——见 anim-state.js #3
            return;
        }
        // 闪避翻滚动画播放期间不被移动状态机覆盖（结束/被打断后由下方正常逻辑接管）
        case AnimChannel.DODGE:
            return;
        case AnimChannel.SKILL:
            return;

        // 冲刺攻击末帧定格：dash 结束后 0.5s 内保持定格（不切 idle），到点播恢复动画（0.5s）
        case AnimChannel.DASH_RECOVER: {
            if (nowMs() < player._dashRecoverAt) {
                // 定格贴图 = dash_recover 首帧（2026-07-29 起；原定格=dash_attack 末帧）
                // 纹理键必须走 playerTextureKey（player_<动画键>），裸键不存在会渲染成空白
                const freezeTex = playerTextureKey('dash_recover');
                if (this.playerSprite.texture.key !== freezeTex || Number(this.playerSprite.frame.name) !== 0) {
                    this.playerSprite.anims.stop();
                    this.playerSprite.setTexture(freezeTex, 0);
                }
                return;
            }
            // 到点：退出定格（clearPose 全清）并进入冲刺恢复——enterRecover 不变量：同时清 hold；
            // startMs = 武器滑回时间基准（走近战同款末帧滑回，轨迹块=dash）
            clearPose(player);
            enterRecover(player, { cfgKey: 'dash', startMs: nowMs() });
            this.setPlayerAnimation('dash_recover', 500);
            return;
        }

        // 攻击后定格保持（连段窗口）与收势动画：
        // 一段/二段攻击 Tween 结束后定格在末帧等待连段；窗口内无攻击输入则播 recover 收势回 idle；
        // 移动立即取消定格/收势（新攻击由上方攻击守卫接管，不会走到这里）
        case AnimChannel.ATTACK_HOLD: {
            const now = nowMs();
            if (player.isMoving) {
                clearPose(player); // 移动立即取消定格/收势（pose session 全清）
                // 移动取消定格/收势后原 if 链落到下方移动/持枪逻辑 → 按新状态重新仲裁（递归即等价落闸）
                this._updatePlayerAnimation(_game);
                return;
            } else if (player._attackRecovering) {
                return; // 收势播放中，等 animationcomplete 解除
            } else if (now < player._attackHoldUntil) {
                return; // 定格末帧（repeat 0 的攻击动画播完自然停在末帧，不做任何切换）
            } else {
                if (getPlayerAnimDef('recover') && this.anims.exists(playerTextureKey('recover'))) {
                    // enterRecover 不变量：同时清 hold（原 `_attackHoldUntil = 0` 提前写入并入此处）；
                    // startMs = 收势起点（武器线性滑回 idle 位的时间基准）
                    enterRecover(player, { cfgKey: null, startMs: now });
                    // recover 播完回 idle、解除收势标记均由 setPlayerAnimation 的完成回调统一处理
                    // 收势时长按段：一段=配置自然时长 / 二段 0.3s / 三段（终结）0.4s（meleeCombo.stageNRecoverMs）
                    this.setPlayerAnimation('recover', meleeStageRecoverMs(player._meleeComboStage || 1));
                    return;
                }
                // recover 动画缺失：清定格（pose session 全清）后原 if 链落到下方 idle/locomotion → 按新状态重新仲裁（递归即等价落闸）
                clearPose(player);
                this._updatePlayerAnimation(_game);
                return;
            }
        }

        // 持枪姿态解析已收口到 anim-state.js 的 resolveGunPose（与原 _resolveGunPose 闭包逐字等价）：
        // 双持手枪（副手为手枪）→ gun_idle_dual；单持手枪 → gun_idle_pistol；其余枪械 → gun_idle；配置缺失逐级回退。
        // GUN_POSE / LOCOMOTION 共用尾部：通道谓词已保证 gunPose 非空 当且仅当 channel === GUN_POSE
        case AnimChannel.GUN_POSE:
        case AnimChannel.LOCOMOTION:
        default: {
        const gunPose = channel === AnimChannel.GUN_POSE ? animCtx.gunPose : null; // 谓词已解析，复用 ctx 结果（值与 resolveGunPose(player) 相同）


        // 长按格挡移动：玩家主 Sprite 直接播放去摆臂后的原生 walking 连续躯干；
        // PlayerShieldRig 只把初版双臂挂到该帧肩点，不再做上下半身跨素材拼接。
        // 手枪+盾继续走既有 gunPose 躯干/腿分层，不重复建立第二套上身。
        const shieldWalking = !gunPose && player.shieldSystem?.defending && player.isMoving;
        if (shieldWalking) {
            const shieldWalkKey = PLAYER_SHIELD_ARM.walk.animationKey;
            if (this.playerSprite.anims.currentAnim?.key !== shieldWalkKey
                || !this.playerSprite.anims.isPlaying) {
                this._playGunLegAnimation(shieldWalkKey, this._getGunLegCyclePhase());
            }
            if (this.playerHandSprite) this.playerHandSprite.setVisible(false);
            this.playerSprite.setFlipX(!this._getVisualFacingRight(player));
            this._lastPlayerAnimKey = 'shield_walk';
            this._playerAnimIdleStart = 0;
            return;
        }


        // 持枪移动：腿层播走路/跑步腿动画（下半身裁片），躯干层保持（扭转继续由 _syncGunTwist 驱动）
        const gunWalkLegsKey = gunPose ? `${playerTextureKey(gunPose.poseKey)}_walklegs` : null;
        const gunRunLegsKey = gunPose ? `${playerTextureKey(gunPose.poseKey)}_runlegs` : null;
        const useRunLegs = isPlayerRunVisual(player) && gunPose && gunPose.def.twist.runLegs
            && gunRunLegsKey && this.anims.exists(gunRunLegsKey);
        const legsAnimKey = useRunLegs ? gunRunLegsKey : gunWalkLegsKey;
        const previousLegPhase = this._getGunLegCyclePhase();
        if (gunPose && gunPose.def.twist && gunPose.def.twist.walkLegs && player.isMoving && legsAnimKey && this.anims.exists(legsAnimKey)) {
            // 移动中切换武器：姿态键变化时重建分层（躯干/手臂/锚点配置随新姿态切换）
            if (this._twistTexKey !== playerTextureKey(gunPose.poseKey)) {
                this.setPlayerAnimation(gunPose.poseKey);
            }
            if (!this._twistConfig) {
                // 分层未激活（如生成即持枪移动）：先按持枪站立初始化腿/躯干层
                this.setPlayerAnimation(gunPose.poseKey);
            }
            if (this.playerSprite.anims.currentAnim?.key !== legsAnimKey || !this.playerSprite.anims.isPlaying) {
                // isPlaying 防御：动画被外部停止（贴图切换/场景事件）时自动重播，防"走一段后卡回静态"
                this._playGunLegAnimation(legsAnimKey, previousLegPhase);
            }
            this.playerSprite.anims.timeScale = 1;
            this._lastPlayerAnimKey = 'gun_walk';
            this._playerAnimIdleStart = 0;
            return;
        }

        let key = 'idle';
        if (isPlayerRunVisual(player) && player.isMoving) {
            key = 'run';
        } else if (player.isMoving) {
            key = 'walk';
        } else if (gunPose) {
            // 持枪待机姿态（姿态层方案：身体低持 + 枪械贴图 360° 程序旋转；配置缺失自动回退 idle）
            key = gunPose.poseKey;
        }

        // 加入短暂停顿缓冲：停止移动后 80ms 再切回 idle，避免速度抖动导致动画反复重启
        const now = nowMs();
        if (key === 'idle') {
            if (!this._playerAnimIdleStart) this._playerAnimIdleStart = now;
            if (now - this._playerAnimIdleStart < 80) return;
        } else {
            this._playerAnimIdleStart = 0;
        }

        // 即使动画状态未变，也同步朝向翻转（与武器/锚点同一中轴滞回界限）
        this.playerSprite.setFlipX(!this._getVisualFacingRight(player));
        if (this._lastPlayerAnimKey === key) return;
        const shieldWalkPhase = key === 'walk' && this._lastPlayerAnimKey === 'shield_walk'
            ? this._getGunLegCyclePhase() : null;
        this.setPlayerAnimation(key);
        // 松开格挡仍在移动时，把21帧分层腿的相位交回原生walk；不从f0硬切，
        // 避免脚步/骨盆在同一移动周期内突然换腿。
        if (shieldWalkPhase !== null && this.playerSprite.anims?.isPlaying) {
            this.playerSprite.anims.setProgress(shieldWalkPhase);
        }
        } // end case GUN_POSE / LOCOMOTION（共用尾部）
        } // end switch (channel)
    }

    /**
     * 中轴朝向判定（滞回）：|cos(rotation)| > 0.05 才翻转，垂直带内保持上一朝向——
     * 身体贴图/主手/副手/锚点统一用这一个界限，消除"身体与武器翻转不同步"
     */
    _getVisualFacingRight(player) {
        const c = Math.cos(player.rotation);
        if (c > 0.05) player._facingRightVisual = true;
        else if (c < -0.05) player._facingRightVisual = false;
        return player._facingRightVisual !== false; // 默认朝右
    }

    /**
     * 读取当前分层腿或原生walk的循环相位。walk/run 帧数和帧率不同，切换时不能从 0 重播。
     * Phaser 帧序号为 1-based；把当前帧内 accumulator 也折进 0~1 相位，减少临界帧跳步。
     */
    _getGunLegCyclePhase() {
        const animState = this.playerSprite?.anims;
        const currentAnim = animState?.currentAnim;
        const currentFrame = animState?.currentFrame;
        const key = currentAnim?.key || '';
        const nativeWalk = key === playerTextureKey('walk') || key === `${playerTextureKey('walk')}_body`
            || key === PLAYER_SHIELD_ARM.walk.animationKey;
        if ((!key.endsWith('_walklegs') && !key.endsWith('_runlegs') && !nativeWalk) || !currentFrame) return null;
        const frameCount = currentAnim.frames?.length || 0;
        if (frameCount <= 0) return null;
        const frameIndex = Math.max(0, Math.min(frameCount - 1, currentFrame.index - 1));
        const frameDuration = Number(animState.nextTick)
            || Number(currentFrame.duration)
            || Number(animState.msPerFrame)
            || 0;
        const inFrame = frameDuration > 0
            ? Math.max(0, Math.min(0.999, (Number(animState.accumulator) || 0) / frameDuration))
            : 0;
        return (frameIndex + inFrame) / frameCount;
    }

    _playGunLegAnimation(key, cyclePhase = null) {
        const targetAnim = this.anims.get(key);
        const frameCount = targetAnim?.frames?.length || 0;
        let startFrame = 0;
        let inFrame = 0;
        if (cyclePhase !== null && frameCount > 0) {
            const targetPosition = (((cyclePhase % 1) + 1) % 1) * frameCount;
            startFrame = Math.min(frameCount - 1, Math.floor(targetPosition));
            inFrame = targetPosition - startFrame;
        }
        // 纹理必须先切再播放，避免 Phaser 在旧纹理帧表上启动新动画。
        this.playerSprite.setTexture(key);
        this.playerSprite.play(key, true, startFrame);
        if (inFrame > 0) {
            const animState = this.playerSprite.anims;
            const frameDuration = Number(animState.nextTick)
                || Number(animState.currentFrame?.duration)
                || Number(animState.msPerFrame)
                || 0;
            if (frameDuration > 0) animState.accumulator = inFrame * frameDuration;
        }
    }

    _playerAnimKeyMatches(actualKey, logicalKey) {
        if (!actualKey || !logicalKey) return false;
        const base = playerTextureKey(logicalKey);
        return actualKey === base || actualKey === `${base}_body`;
    }

    /**
     * 当前近战人物动画的精确逐帧进度。
     * Phaser 的 currentFrame.index 是 1-based；accumulator/nextTick 给出当前帧内进度。
     * 直接以人物动画为时间源，可让武器握点严格停在人物当前帧，且支持非等时停留帧。
     */
    _getActiveMeleePerFrameProgress(frameCount, expectedAnimKey = null) {
        const animState = this.playerSprite && this.playerSprite.anims;
        const currentAnim = animState && animState.currentAnim;
        const currentFrame = animState && animState.currentFrame;
        if (!animState || !currentAnim || !currentFrame || frameCount <= 0
            || (expectedAnimKey
                ? !this._playerAnimKeyMatches(currentAnim.key, expectedAnimKey)
                : !MELEE_STAGE_ANIM_KEYS.some(k => this._playerAnimKeyMatches(currentAnim.key, k)))
            || !currentAnim.frames || currentAnim.frames.length !== frameCount) {
            return null;
        }

        const frameIndex = Math.max(0, Math.min(frameCount - 1, (Number(currentFrame.index) || 1) - 1));
        const frameDuration = Number(animState.nextTick)
            || Number(currentFrame.duration)
            || Number(animState.msPerFrame)
            || 0;
        let framePhase = 0;
        if (animState.isPlaying && frameDuration > 0) {
            framePhase = Math.max(0, Math.min(1, (Number(animState.accumulator) || 0) / frameDuration));
        } else if (currentFrame.isLast) {
            framePhase = 1;
        }
        return Math.min(1, (frameIndex + framePhase) / frameCount);
    }

    /**
     * 当前一次性近战动画正在显示的源贴图帧。
     * frameSequence 可以重复同一组源帧；武器必须按 textureFrame 读取同编号握柄，
     * 不能按动画序列位置把第二圈错误映射成另一段轨迹。
     */
    _getActiveMeleeSourceFrame(sourceFrameCount, expectedAnimKey) {
        const animState = this.playerSprite?.anims;
        const currentAnim = animState?.currentAnim;
        const currentFrame = animState?.currentFrame;
        if (!currentAnim || !currentFrame || sourceFrameCount <= 0
            || !this._playerAnimKeyMatches(currentAnim.key, expectedAnimKey)) {
            return null;
        }
        const rawFrame = Number(currentFrame.textureFrame ?? this.playerSprite?.frame?.name);
        if (!Number.isFinite(rawFrame)) return null;
        return Math.max(0, Math.min(sourceFrameCount - 1, Math.floor(rawFrame)));
    }

    /**
     * 同步玩家武器到 Phaser Sprite
     * 创建武器 Sprite 并跟随玩家位置和旋转
     */
    syncWeapon(player, weaponAnim = {}) {
        if (!this.playerSprite || !player) return;
        
        const currentItem = player.equipments[player.weaponMode];
        if (!currentItem || !currentItem.name) {
            if (this.weaponSprite) this.weaponSprite.setVisible(false);
            this._gunAnimConfigKey = null;
            return;
        }
        
        // 根据 weaponType 和 weaponId 精确映射贴图
        let texture = getWeaponTextureKey(currentItem);
        // 动画/贴图配置键：animConfigKey 优先（R93 等新枪不再共用 G18 pistol 配置——副手翻转根因）
        const wt = currentItem.animConfigKey || currentItem.weaponType;
        this._gunAnimConfigKey = GUN_FAMILY.includes(wt) ? wt : null;
        const isMelee = wt === 'sword' || wt === 'bow';
        // staff 也复用 sword 动画配置键；本次 walking 握柄与 running 背负只允许真实剑类进入。
        const isSwordMelee = currentItem.weaponType === 'sword';

        // ===== 施法武器跟随（法杖举杖施法）=====
        // 施法期间（前摇 casting / 后摇 recover）法杖按 staff_cast 动画帧读取 staffCastFrames 逐帧轨迹——
        // 前摇正放（f0→f4 举杖到最高）、后摇倒放（f4→f8 放下），武器中段始终贴住左侧手
        const castState = player._castState;
        if (currentItem.weaponType === 'staff' && castState && castState !== 'idle'
            && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].staffCastFrames
            && WeaponAnimConfig[wt].staffCastFrames.type === 'perFrame'
            && WeaponAnimConfig[wt].staffCastFrames.frames) {
            const castFrames = WeaponAnimConfig[wt].staffCastFrames.frames;
            // 当前施法动画帧（staff_cast 帧 0~8；倒放时 frame 递减，索引天然对应）
            let castFrame = 0;
            // 优先 anims.currentFrame.textureFrame（动画官方帧源：正放/倒放都准确）；
            // 回退 sprite.frame.name（部分渲染路径下可能滞后于动画）
            let rawFrame = NaN;
            if (this.playerSprite.anims && this.playerSprite.anims.currentFrame) {
                rawFrame = Number(this.playerSprite.anims.currentFrame.textureFrame);
            }
            if (Number.isNaN(rawFrame)) {
                const curFrame = this.playerSprite.frame && this.playerSprite.frame.name;
                if (curFrame !== undefined && curFrame !== null) rawFrame = Number(curFrame);
            }
            if (!Number.isNaN(rawFrame) && rawFrame < castFrames.length) {
                castFrame = Math.max(0, Math.floor(rawFrame));
            }
            const cf = castFrames[castFrame];
            if (cf) {
                if (!this.weaponSprite) {
                    this.weaponSprite = this.add.sprite(0, 0, texture);
                } else if (this.weaponSprite.texture.key !== texture) {
                    this.weaponSprite.setTexture(texture);
                }
                const facingRight = !this.playerSprite.flipX;
                const offX = (facingRight ? 1 : -1) * cf.offsetX;
                const offY = cf.offsetY;
                let rot = cf.rotation * Math.PI / 180;
                if (!facingRight) rot = Math.PI - rot;
                // 武器同步脚底 z，避免与人物贴图分离。
                this.weaponSprite.setPosition(
                    player.x + offX,
                    player.y + offY - this._getFootOffsetY(player, this.playerSprite) - (player.z || 0)
                );
                this.weaponSprite.setRotation(rot);
                this.weaponSprite.setFlipX(!facingRight);
                const wSize = WeaponTransform.getWeaponSize(wt, cf.scale, 'idle');
                this.weaponSprite.setDisplaySize(wSize.width, wSize.height);
                this.weaponSprite.setVisible(!this._useCanvasWeapon);
                this._hideWeaponGhosts();
                return;
            }
        }
        
        if (wt === 'bow') {
            // 弓攻击：使用 spritesheet 帧动画
            if (weaponAnim.isAttacking && weaponAnim.state !== 'idle') {
                // 弓攻击动画帧映射
                let frameIndex = 0;
                if (weaponAnim.state === 'windup') {
                    frameIndex = 0;
                } else if (weaponAnim.state === 'swing') {
                    const t = weaponAnim.timer / (WEAPON_ANIM.swingMs || 300);
                    if (t < 0.33) frameIndex = 1;
                    else if (t < 0.66) frameIndex = 2;
                    else frameIndex = 3;
                } else if (weaponAnim.state === 'recover') {
                    frameIndex = 3;
                }
                
                if (!this.weaponSprite) {
                    this.weaponSprite = this.add.sprite(0, 0, 'bow_attack');
                } else if (this.weaponSprite.texture.key !== 'bow_attack') {
                    this.weaponSprite.setTexture('bow_attack');
                }
                
                try {
                    this.weaponSprite.setFrame(frameIndex);
                } catch (_e) {
                    // 帧索引可能无效，忽略
                }
                
                // 同步位置和旋转（与 Canvas 一致）
                let animState = 'idle';
                if (isPlayerRunVisual(player)) animState = 'running';
                else if (player.isMoving) animState = 'walk';
                const pos = WeaponTransform.getWeaponWorldPosition(player, wt, false, false, animState, {}, this._getVisualFacingRight(player));
                const facingRight = this._getVisualFacingRight(player);
                // 近战武器使用固定 rotation（所有状态），远程武器使用 player.rotation
                const useFixedRot = isMelee;  // 所有近战状态都固定
                let rot = WeaponTransform.getWeaponRotation(useFixedRot ? 0 : player.rotation, wt, weaponAnim.animAngle || 0, animState, facingRight);
                
                // 弓攻击时添加旋转偏移
                if (weaponAnim.rotateAngle) {
                    rot += weaponAnim.rotateAngle;
                }
                
                this.weaponSprite.setPosition(pos.x, pos.y);
                this.weaponSprite.setRotation(rot);
                this.weaponSprite.setVisible(true);
                this.weaponSprite.setFlipX(false);
                this._hideWeaponGhosts(); // 弓分支不经 perFrame 残影管线

                return;
            }
        }
        
        // 保留 Canvas 版本作为对比基准（条件开关）
        // 在浏览器控制台执行：__phaserScene._useCanvasWeapon = true 切换回 Canvas
        if (this._useCanvasWeapon === undefined) this._useCanvasWeapon = false;
        
        // 如果玩家处于特殊动画状态，同步特殊动画位置到 Phaser（风车/冲刺/冲刺末帧定格/复位）
        const isSpecialAnim = player._isWhirlwind || player._whirlwindRecovering || player._isPushStrike || player._isDashing || player._dashRecoverAt || player._dashResetAnim || player._specialAttackActive || player._specialResetAnim;
        if (!player._isWhirlwind) this._whirlwindWeaponDepth?.clear(this.weaponSprite);
        if (!player._isPushStrike) this._pushStrikeWeaponDepth?.clear(this.weaponSprite);
        if (isSpecialAnim) {
            this._syncSpecialWeaponAnim(player, wt, weaponAnim);
            return;
        }
        
        // 创建或更新武器 Sprite
        if (!this.weaponSprite) {
            this.weaponSprite = this.add.sprite(0, 0, texture);
        } else if (this.weaponSprite.texture.key !== texture) {
            this.weaponSprite.setTexture(texture);
        }
        // 复位冲刺 Lerp 的剑柄 origin（特殊动画只在 isSpecialAnim 时走 _syncSpecialWeaponAnim，
        // 普通路径必须自行复位，否则普通攻击/待机会残留绕剑柄旋转）
        if (this.weaponSprite.originX !== 0.5 || this.weaponSprite.originY !== 0.5) {
            this.weaponSprite.setOrigin(0.5, 0.5);
        }
        
        // ===== Phaser Tween 攻击动画期间，跳过 syncWeapon 的位置更新 =====
        // 但远程武器使用状态机驱动，需要继续执行以应用后坐力
        // inAttackHold：攻击后定格保持窗口（连段等待）——武器定格在上一段轨迹末帧。
        // 渲染只读取 pose session，不按墙钟自行退出 hold；正常更新会在武器快照前通过
        // _advanceExpiredMeleeHoldBeforeWeaponSync 原子推进到 recover，外部只读探针也不会改状态。
        const inAttackHold = resolveAnimChannel(player) === AnimChannel.ATTACK_HOLD
            && !!(player._attackHoldUntil && !player.isMoving && !player._attackRecovering);
        if (weaponAnim.isAttacking || inAttackHold) {
            const isGun = GUN_FAMILY.includes(wt);
            if (!isGun) {
                // 近战武器：优先使用逐帧配置，按玩家攻击动画当前帧同步武器
                // 连段按段读 attack/attack2/attack3 轨迹块（缺失逐级回退 attack）
                const wacWt = WeaponAnimConfig[wt];
                const atkCfgKey = meleeStageCfgKey(wacWt, player._meleeComboStage || 1);
                const perFrameCfg = wacWt && wacWt[atkCfgKey];
                if (perFrameCfg && perFrameCfg.type === 'perFrame' && perFrameCfg.frames) {
                    this.weaponSprite.setVisible(!this._useCanvasWeapon);
                    let progress = 1; // 定格保持窗口恒为末帧
                    if (weaponAnim.isAttacking) {
                        // 恢复旧版连续时间源：武器轨迹按攻击目标时长稳定推进，不再用
                        // currentFrame.index/frameCount 造成整条轨迹落后一帧且末端到不了 1。
                        progress = 0;
                        if (this._playerAttackStartTime && this._playerAttackDuration > 0) {
                            progress = Math.min(1, (nowMs() - this._playerAttackStartTime) / this._playerAttackDuration);
                        } else {
                            const currentAnim = this.playerSprite.anims.currentAnim;
                            if (currentAnim && MELEE_STAGE_ANIM_KEYS.some(k => this._playerAnimKeyMatches(currentAnim.key, k)) && this.playerSprite.anims.getProgress) {
                                progress = this.playerSprite.anims.getProgress();
                            }
                        }
                    }
                    // 朝向硬绑定：武器朝向 = 人物贴图 flipX（身体是唯一权威）——
                    // 攻击/定格/收势期间身体 flipX 冻结，武器自然冻结，无需独立朝向捕获
                    const facingRight = !this.playerSprite.flipX;
                    // 以右攻击为参考，朝左时翻转贴图并镜像位置/旋转
                    const gripAnchor = perFrameCfg.anchor === 'grip';
                    const pfPos = gripAnchor
                        // 普通攻击轨迹是在统一 gripOffset 口径下调好的；每把剑的 textureGrip
                        // 只用于新生成的 run/专属动作，不能反向改变旧三段轨迹的 origin。
                        ? WeaponTransform.getInterpolatedGripPerFramePosition(player, wt, progress, true, atkCfgKey)
                        : WeaponTransform.getInterpolatedPerFramePosition(player, wt, progress, true, atkCfgKey);
                    if (pfPos) {
                        // anchor='grip'：origin 钉到剑柄（朝左 X 镜像），旋转绕剑柄不甩手
                        if (gripAnchor) {
                            this.weaponSprite.setOrigin(facingRight ? pfPos.gripX : 1 - pfPos.gripX, pfPos.gripY);
                        }
                        const wx = facingRight ? pfPos.x : 2 * player.x - pfPos.x;
                        const wrot = facingRight ? pfPos.rotation : -pfPos.rotation;
                        this.weaponSprite.setPosition(wx, pfPos.y);
                        this.weaponSprite.setRotation(wrot);
                        // 枪械朝左瞄准会留下 flipY=true；切剑后立即攻击不会经过普通 idle
                        // 分支，必须在近战攻击入口显式清理，否则整把剑会纵向翻转、剑柄脱手。
                        this.weaponSprite.setFlipY(false);
                        this.weaponSprite.setFlipX(!facingRight);
                        const wSize = WeaponTransform.getWeaponSize(wt, pfPos.scale, 'attack');
                        // B 方案：挥砍拉伸（stretchX/stretchY，缺省 1）
                        this.weaponSprite.setDisplaySize(
                            wSize.width * (pfPos.stretchX || 1),
                            wSize.height * (pfPos.stretchY || 1)
                        );
                        // 帧级运动模糊（blurX/blurY）：Phaser 4 Blur 滤镜，方向性（见 _applyWeaponBlur）
                        const bx = pfPos.blurX || 0, by = pfPos.blurY || 0;
                        this._applyWeaponBlur(bx, by);
                        // 2026-08-03：移除二段 18~24 帧"武器沉到人物之下"的旧逻辑——
                        // 双手横向挥砍时剑在身体前方，压到人物下方会被身体遮挡（涂层遮盖）。
                        // 武器恒在人物前方（+2）；若个别帧剑身盖脸，应调位置/角度而非改深度。
                        this.weaponSprite.setDepth(this.playerSprite.depth + 2);
                          if (weaponAnim.isAttacking) this._pushSwordAuraPose(wSize);
                    }
                    return;
                }
                // 否则：Tween 控制位置，直接返回
                this.weaponSprite.setVisible(!this._useCanvasWeapon);
                this._hideWeaponGhosts(); // 非 perFrame 轨迹不出残影
                const wSize = WeaponTransform.getWeaponSize(wt, null, 'attack');
                this.weaponSprite.setDisplaySize(wSize.width, wSize.height);
                return;
            }
            // 远程武器：继续执行，让状态机驱动的后坐力生效
        }
        
        // 攻击/定格分支之外：残影隐藏（A 方案仅在攻击轨迹帧激活）
        this._hideWeaponGhosts();
        // 武器深度复位（二段 18~24 帧的下沉仅在攻击轨迹帧生效）
        if (this.weaponSprite && this.playerSprite && this.weaponSprite.depth !== this.playerSprite.depth + 2) {
            this.weaponSprite.setDepth(this.playerSprite.depth + 2);
        }

        // 收势滑行（recover 播放中）：普通三段按各自 recover 配置走三次贝塞尔回 idle；
        // 未配置的旧武器/冲刺保持线性兜底。朝向沿用定格冻结朝向（收势期间鼠标转向不影响）。
        if (player._attackRecovering && player._attackRecoverStart) {
            const isGunR = GUN_FAMILY.includes(wt); // 2026-08-13 收口：原内联数组漏 beretta93r，R93 收势错误走进近战末帧滑回分支
            if (!isGunR) {
                const facingR = !this.playerSprite.flipX; // 朝向硬绑定：收势滑行同身体 flipX（收势期身体冻结）
                // 收势时长按段：一段=配置自然时长 / 二段 0.3s / 三段 0.4s（与恢复动画同步）
                const recMs = meleeStageRecoverMs(player._meleeComboStage || 1);
                const recDur = recMs > 0 ? recMs : (getPlayerAnimDurationMs('recover') || 800);
                const t = Math.max(0, Math.min(1, (nowMs() - player._attackRecoverStart) / recDur));
                // 起点：上一段轨迹末帧（progress=1，与攻击分支同口径：恒按朝右取帧后手动镜像）
                // _recoverCfgKey='dash' 时优先取 dashHand 末帧反推中心（与剑柄锚手末帧连续），否则回退旧 dash 轨迹末帧；朝向同身体 flipX 冻结不随鼠标
                const wacR = WeaponAnimConfig[wt];
                const atkKeyR = player._recoverCfgKey
                    || meleeStageCfgKey(wacR, player._meleeComboStage || 1);
                let start = null;
                  if (player._recoverCfgKey === 'dash') {
                      start = WeaponTransform.getDashRecoverStartPosition(player, wt);
                  }
                  if (!start) {
                      // anchor='grip'（剑柄锚手）：末帧握把点+刃向反推中心，与定格末帧连续（dashHand 同款）
                      start = WeaponTransform.getAttackRecoverStartPosition(player, wt, atkKeyR);
                  }
                  if (!start) {
                      start = WeaponTransform.getInterpolatedPerFramePosition(player, wt, 1, true, atkKeyR);
                  }
                if (start && !facingR) {
                    start.x = 2 * player.x - start.x;
                    start.rotation = -start.rotation;
                }
                // 终点：idle 持械位（同朝向镜像口径）
                const endLocal = WeaponTransform.getWeaponLocalOffset(wt, player.size, false, false, 'idle', facingR);
                const end = WeaponTransform.localToWorld(player, endLocal, 0, facingR, 'idle', wt);
                const endRot = WeaponTransform.getWeaponRotation(0, wt, 0, 'idle', facingR);
                if (start) {
                    // dashHand 可把正式轨迹放在独立块中，旧 dash 30点仍保留作回退。
                    // 独立块可提供 recover 贝塞尔；没有配置时仍走原线性兜底。
                    const recoverProfileKey = player._recoverCfgKey === 'dash'
                        ? (wacR?.dashHand?.trackKey || atkKeyR)
                        : atkKeyR;
                    const recoverProfile = wacR?.[recoverProfileKey]?.recover;
                    const recoverPose = WeaponTransform.getAttackRecoverPose(
                        start,
                        { x: end.x, y: end.y, rotation: endRot },
                        t,
                        recoverProfile,
                        facingR
                    );
                    let recoverX;
                    let recoverY;
                    let recoverRotation;
                    let sizeProgress;
                    if (recoverPose) {
                        recoverX = recoverPose.x;
                        recoverY = recoverPose.y;
                        recoverRotation = recoverPose.rotation;
                        sizeProgress = recoverPose.sizeProgress;
                    } else {
                        let dRot = endRot - start.rotation;
                        dRot = Math.atan2(Math.sin(dRot), Math.cos(dRot)); // 旧配置短弧线性兜底
                        recoverX = start.x + (end.x - start.x) * t;
                        recoverY = start.y + (end.y - start.y) * t;
                        recoverRotation = start.rotation + dRot * t;
                        sizeProgress = t;
                    }
                    const sizeStart = WeaponTransform.getWeaponSize(wt, start.scale, 'attack');
                    const sizeEnd = WeaponTransform.getWeaponSize(wt, null, 'idle');
                    // 攻击末帧可能带挥砍拉伸；收势首帧必须继承该实际显示尺寸，
                    // 再平滑回 idle，避免第三段末帧 1.048 倍宽度瞬间缩回 1 倍。
                    const startWidth = sizeStart.width * (start.stretchX ?? 1);
                    const startHeight = sizeStart.height * (start.stretchY ?? 1);
                    const recoverWidth = startWidth + (sizeEnd.width - startWidth) * sizeProgress;
                    const recoverHeight = startHeight + (sizeEnd.height - startHeight) * sizeProgress;
                    // 收势全程保留当前贴图的真实握柄 origin。recoverX/Y 仍是视觉中心轨迹，
                    // 因而先把中心转换成握柄世界点；末帧视觉中心与 idle 中心-origin 完全重合。
                    const textureGrip = WeaponTransform.getTextureGrip(wt, texture, {
                        width: recoverWidth,
                        height: recoverHeight,
                    });
                    let gripLocalX = (textureGrip.x - 0.5) * recoverWidth;
                    const gripLocalY = (textureGrip.y - 0.5) * recoverHeight;
                    if (!facingR) gripLocalX = -gripLocalX;
                    const gripCos = Math.cos(recoverRotation);
                    const gripSin = Math.sin(recoverRotation);
                    this.weaponSprite.setOrigin(facingR ? textureGrip.x : 1 - textureGrip.x, textureGrip.y);
                    this.weaponSprite.setPosition(
                        recoverX + gripLocalX * gripCos - gripLocalY * gripSin,
                        recoverY + gripLocalX * gripSin + gripLocalY * gripCos
                    );
                    this.weaponSprite.setRotation(recoverRotation);
                    this.weaponSprite.setFlipY(false);
                    this.weaponSprite.setFlipX(!facingR);
                    this.weaponSprite.setDisplaySize(recoverWidth, recoverHeight);
                    this.weaponSprite.setVisible(!this._useCanvasWeapon);
                    return;
                }
            }
        }

        // 使用 WeaponTransform 统一计算位置和旋转
        // 按玩家状态推断动画状态
        // 使用 WeaponTransform 统一计算位置和旋转
        // 按玩家状态推断动画状态
        let animState = 'idle';
        // 剑盾格挡步行固定上身，主手武器继续跟 idle 掌点；仅腿层播放 walk。
        // 格挡步行的主手改由独立手掌关节钉住；这里先保持idle姿态/尺寸，稍后只改握点。
        const shieldUpperLocked = !!(isMelee && player.shieldSystem?.defending);
        if (!shieldUpperLocked && isPlayerRunVisual(player)) animState = 'running';
        else if (!shieldUpperLocked && player.isMoving) animState = 'walk';
        else if (weaponAnim.isAttacking && weaponAnim.state !== 'idle') animState = 'attack';

        // ===== 行走逐帧轨迹（walkFrames）：真实剑类按人物当前帧把剑柄钉在手上 =====
        // 配置：WeaponAnimConfig[wt].walkFrames { type:'perFrame', frames:[21 帧，与 walk 动画帧一一对应] }
        // 法杖（staff，animConfigKey='sword' 复用剑配置）：独立 staffWalkFrames 块——
        // 剑柄在贴图中心下方 55px，法杖中段≈贴图中心，故法杖轨迹整体下移 55px 让中段对准手
        // 朝向硬绑定同攻击分支：以朝右为基准取帧，朝左手动镜像（位置 x 取反 + 旋转取反 + 贴图 flipX）
        const isStaffWeapon = currentItem && currentItem.weaponType === 'staff';
        const walkFramesCfg = isMelee ? (WeaponAnimConfig[wt] && (isStaffWeapon
            ? (WeaponAnimConfig[wt].staffWalkFrames || WeaponAnimConfig[wt].walkFrames)
            : WeaponAnimConfig[wt].walkFrames)) : null;
        if (animState === 'walk' && isMelee && walkFramesCfg
            && walkFramesCfg.type === 'perFrame' && walkFramesCfg.frames && walkFramesCfg.frames.length) {
            let walkProgress = 0;
            let walkFrameIndex = 0;
            const anims = this.playerSprite.anims;
            const curAnim = anims.currentAnim;
            // 兼容手部分层：walk 实际播 player_walk_body（身体层去手），进度口径一致
            const walkBodyKey = `${playerTextureKey('walk')}_body`;
            const isActiveWalkAnim = !!(anims.isPlaying && curAnim
                && (curAnim.key === playerTextureKey('walk') || curAnim.key === walkBodyKey));
            if (isActiveWalkAnim) {
                if (anims.getProgress) walkProgress = anims.getProgress();
                // Phaser currentFrame.index 为 1-based。剑柄位置必须与当前人物帧一一对应，
                // 不在离散人物帧之间自行滑动，否则手层尚未换帧时剑柄会短暂脱手。
                walkFrameIndex = Math.max(0, Math.min(
                    walkFramesCfg.frames.length - 1,
                    (Number(anims.currentFrame?.index) || 1) - 1
                ));
            }
            const facingRight = !this.playerSprite.flipX;
            const gripAnchor = isSwordMelee && walkFramesCfg.anchor === 'grip';
            const walkCfgKey = isStaffWeapon ? 'staffWalkFrames' : 'walkFrames';
            // 剑：人物当前帧就是握点真源；法杖保持原有平滑中段握持，不受本次修改影响。
            const wfPos = gripAnchor
                ? WeaponTransform.getInterpolatedGripPerFramePosition(
                    player,
                    wt,
                    walkFrameIndex / Math.max(1, walkFramesCfg.frames.length - 1),
                    true,
                    walkCfgKey,
                    'walk',
                    texture
                )
                : WeaponTransform.getSmoothPerFramePosition(
                    player, wt, walkProgress, true, walkCfgKey
                );
            if (wfPos) {
                if (gripAnchor) {
                    this.weaponSprite.setOrigin(
                        facingRight ? wfPos.gripX : 1 - wfPos.gripX,
                        wfPos.gripY
                    );
                }
                const wx = facingRight ? wfPos.x : 2 * player.x - wfPos.x;
                const wrot = facingRight ? wfPos.rotation : -wfPos.rotation;
                this.weaponSprite.setPosition(wx, wfPos.y);
                this.weaponSprite.setRotation(wrot);
                this.weaponSprite.setFlipY(false);
                this.weaponSprite.setFlipX(!facingRight);
                const wSize = WeaponTransform.getWeaponSize(wt, wfPos.scale, 'walk');
                this.weaponSprite.setDisplaySize(
                    wSize.width * (wfPos.stretchX || 1),
                    wSize.height * (wfPos.stretchY || 1)
                );
                this.weaponSprite.setDepth(this.playerSprite.depth + 2);
                this.weaponSprite.setVisible(!this._useCanvasWeapon);
                this._hideWeaponGhosts();
                return;
            }
        }

        // 法杖（staff）：idle/walk/running 静态姿态用独立 staffIdle 块（中段握持，与剑 idle 分离）
        const staffIdleCfg = isStaffWeapon && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].staffIdle;
        const staffOverrides = staffIdleCfg ? {
            holdOffsetX: staffIdleCfg.holdOffsetX,
            holdOffsetY: staffIdleCfg.holdOffsetY,
            idleRotation: staffIdleCfg.idleRotation,
            idleScale: staffIdleCfg.idleScale,
        } : {};
        const pos = WeaponTransform.getWeaponWorldPosition(player, wt, false, false, animState, staffOverrides, isMelee ? !this.playerSprite.flipX : this._getVisualFacingRight(player));
        const facingRight = isMelee ? !this.playerSprite.flipX : this._getVisualFacingRight(player); // 近战朝向硬绑定身体 flipX

        // 躯干扭转激活（持枪瞄准）：锚点在躯干空间计算（不随 player.rotation 公转）
        if (this._twistState && !isMelee) {
            const a = this._computeGunAnchor(player, wt, animState, false);
            pos.x = a.x;
            pos.y = a.y;
        }

        // 近战武器使用固定 rotation（所有状态）；
        // 远程武器（枪械）贴图旋转 = 武器位置 → 鼠标准心的精确连线角，
        // 不再使用 player.rotation（脚底→鼠标连线角），消除手部锚点视差导致的固定角度偏移。
        // rotOffset（配置，度）：枪械贴图固有倾角修正（如手枪贴图视差性下俯）
        const gunRotOffset = !isMelee && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].rotOffset
            ? WeaponAnimConfig[wt].rotOffset * Math.PI / 180 : 0;
        let rot;
        let gunAimTarget = null;
        if (isMelee) {
            rot = WeaponTransform.getWeaponRotation(0, wt, 0, animState, facingRight);
        } else if (typeof Input !== 'undefined' && Input.mouse) {
            // 瞄准死区激活：用可调锥有效角（与姿态/手臂/锚点同口径）
            if (this._frozenAimActive && this._effectiveAim !== undefined) {
                rot = this._effectiveAim;
                // 近距平滑期间弹道使用同一有效角；取远点只表达方向，避免贴图与实际弹道分叉。
                gunAimTarget = {
                    x: player.x + Math.cos(rot) * 2000,
                    y: player.y + Math.sin(rot) * 2000,
                };
            } else {
                const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                gunAimTarget = mouseWorld;
                rot = Math.atan2(mouseWorld.y - pos.y, mouseWorld.x - pos.x);
            }
        } else {
            rot = WeaponTransform.getWeaponRotation(player.rotation, wt, 0, animState, facingRight);
        }
        
        // 应用后坐力偏移
        if (weaponAnim.recoil) {
            pos.x -= Math.cos(player.rotation) * weaponAnim.recoil;
            pos.y -= Math.sin(player.rotation) * weaponAnim.recoil;
        }
        
        // Phase 2: 攻击动画刺击位移计算（已禁用，使用开发工具配置）
        let _thrust = 0;
        
        // 应用 recoilAngle
        if (weaponAnim.recoilAngle) {
            rot += weaponAnim.recoilAngle;
        }
        
        // 应用弓旋转角度（rotate 阶段）
        if (weaponAnim.rotateAngle && wt === 'bow') {
            rot += weaponAnim.rotateAngle;
        }
        
        // 武器缩放：枪械类使用 setScale 保持原始比例，其他武器使用 setDisplaySize 匹配 Canvas 尺寸
        const wSize = WeaponTransform.getWeaponSize(wt, null, animState);
        const isGun = GUN_FAMILY.includes(wt);
        // 枪械贴图以高度定标并保持源图宽高比；抓握点换算必须使用实际显示宽度，
        // 不能继续使用 getWeaponSize 的旧理论矩形（手枪 0.275×0.5、长枪 0.75×1）。
        const gunDisplaySize = isGun ? {
            width: wSize.height * ((this.weaponSprite.width || 1) / Math.max(1, this.weaponSprite.height || 1)),
            height: wSize.height,
        } : wSize;
        // 读取优先级：装备实例字段 > EquipDataManager 标准配置 > anim 配置。
        // 提前解析，供自动步枪的逐枪枪口几何校正与后续贴图偏移共用同一组真值。
        const _wepCfg = isGun ? findWeaponConfig(currentItem.weaponId, currentItem.name) : null;
        const spriteOffX = isGun && (currentItem.spriteOffsetX ?? (_wepCfg && _wepCfg.spriteOffsetX) ?? (WeaponAnimConfig[wt] && WeaponAnimConfig[wt].spriteOffsetX));
        const spriteOffY = isGun && (currentItem.spriteOffsetY ?? (_wepCfg && _wepCfg.spriteOffsetY) ?? (WeaponAnimConfig[wt] && WeaponAnimConfig[wt].spriteOffsetY));
        const aimSprOffX = isGun && (currentItem.aimSpriteOffsetX ?? (_wepCfg && _wepCfg.aimSpriteOffsetX) ?? (WeaponAnimConfig[wt] && WeaponAnimConfig[wt].aimSpriteOffsetX));
        const aimSprOffY = isGun && (currentItem.aimSpriteOffsetY ?? (_wepCfg && _wepCfg.aimSpriteOffsetY) ?? (WeaponAnimConfig[wt] && WeaponAnimConfig[wt].aimSpriteOffsetY));
        // 瞄左（|rot|>90°）时贴图 flipY 防倒置——握把点的贴图内 Y 随之镜像，补偿必须同步取反
        const gunFlipY = isGun && Math.abs(rot) > Math.PI / 2;
        // rotOffset 随 flipY 镜像取反：右 -6° ↔ 左 +6°（否则枪管方向左右不对称，火焰/弹道同偏）
        rot += gunFlipY ? -gunRotOffset : gunRotOffset;

        // 枪械始终以原有主握把为唯一轴心。supportGrip 只描述独立托举臂的接触位置，
        // 绝不能在 ADS 中替换主握把或平移整把枪。
        const gripCfg = isGun
            ? WeaponTransform.getTextureGrip(wt, this.weaponSprite.texture.key, gunDisplaySize)
            : null;

        // 自动步枪及逐枪标记的 ADS：以本枪烘焙枪口点解算贴图角度，使“真实枪口 → 当前有效准星”
        // 与贴图 +X 枪管轴严格共线。按 aimEase 混合，腰射角度不变，抬枪轨迹连续。
        const preciseAds = isRifle(wt) || WeaponAnimConfig[wt]?.preciseAds === true;
        if (isGun && preciseAds && gunAimTarget && this._aimEase > 0) {
            rot = this._resolveRifleAdsRotation({
                wt, pos, target: gunAimTarget, rot, gunFlipY, wSize: gunDisplaySize,
                grip: gripCfg,
                spriteOffX, spriteOffY, aimSprOffY,
                recoilAngle: weaponAnim.recoilAngle || 0,
            });
        }

        // 贴图显示偏移：X/Y 是世界轴；aimSpriteOffsetX 沿枪管轴，aimSpriteOffsetY 为世界纵向。
        // 偏移属于实际渲染枪体，因此后手必须追随偏移后的真实贴图握把；先记录偏移前
        // 锚点会造成“枪动了、手留在原处”的系统性漂浮。
        if (spriteOffX) pos.x += gunFlipY ? -spriteOffX : spriteOffX;
        if (spriteOffY) pos.y += spriteOffY;
        if (aimSprOffX) {
            const aimSpriteOffset = aimSprOffX * (this._aimEase || 0);
            pos.x += Math.cos(rot) * aimSpriteOffset;
            pos.y += Math.sin(rot) * aimSpriteOffset;
        }
        if (aimSprOffY) pos.y += aimSprOffY * (this._aimEase || 0);

        // 与近战 weapon-origin 锚手同一契约：_gunGripWorld 永远表示当前画面中
        // 贴图真实后握把的位置，而不是应用渲染补偿之前的理论位置。
        this._gunGripWorld = isGun ? { x: pos.x, y: pos.y } : null;

        // 单一主握把轴心：贴图中心随旋转绕握把公转，360° 与左右镜像共用同一口径。
        if (gripCfg) {
            const gcx = (0.5 - gripCfg.x) * gunDisplaySize.width;
            const gcyRaw = (0.5 - gripCfg.y) * gunDisplaySize.height;
            const gcy = gunFlipY ? -gcyRaw : gcyRaw;
            pos.x += Math.cos(rot) * gcx - Math.sin(rot) * gcy;
            pos.y += Math.sin(rot) * gcx + Math.cos(rot) * gcy;
        }

        this.weaponSprite.setPosition(pos.x, pos.y);
        this.weaponSprite.setRotation(rot);
        this.weaponSprite.setVisible(!this._useCanvasWeapon);
        this.weaponSprite.setFlipX(false);
        
        // 武器水平翻转：使用 setScale(-1, 1) 替代 setFlipX，同时翻转位置和贴图
        // 注意：位置已经在 localToWorld 中镜像，这里只需要翻转贴图
        // 如果位置已镜像，不需要再翻转贴图
        // const weaponFlipX = !facingRight;
        // this.weaponSprite.setFlipX(weaponFlipX);
        
        if (isGun) {
            this.weaponSprite.setScale(wSize.height / this.weaponSprite.height);
            this.weaponSprite.setFlipY(gunFlipY);
            if (gripCfg && this._gunGripWorld) {
                const rearLocalX = (gripCfg.x - this.weaponSprite.originX)
                    * this.weaponSprite.displayWidth * (this.weaponSprite.flipX ? -1 : 1);
                const rearLocalY = (gripCfg.y - this.weaponSprite.originY)
                    * this.weaponSprite.displayHeight * (this.weaponSprite.flipY ? -1 : 1);
                const rearCos = Math.cos(this.weaponSprite.rotation);
                const rearSin = Math.sin(this.weaponSprite.rotation);
                this._gunRearGripRenderWorld = {
                    x: this.weaponSprite.x + rearLocalX * rearCos - rearLocalY * rearSin,
                    y: this.weaponSprite.y + rearLocalX * rearSin + rearLocalY * rearCos,
                };
                this._gunRearContactError = Math.hypot(
                    this._gunRearGripRenderWorld.x - this._gunGripWorld.x,
                    this._gunRearGripRenderWorld.y - this._gunGripWorld.y
                );
            } else {
                this._gunRearGripRenderWorld = null;
                this._gunRearContactError = null;
            }
        } else {
            this._gunRearGripRenderWorld = null;
            this._gunRearContactError = null;
            this.weaponSprite.setDisplaySize(wSize.width, wSize.height);
            // 近战朝左贴图镜像：旋转码（π−idleRot）恰等于 −R_r（正确镜像角，
            // 关系式 M∘Rot(R)=Rot(−R)∘M），补 flipX 构成绕垂直轴完整镜像；
            // 位置镜像已在 localToWorld 完成（与攻击 perFrame 分支"旋转取反+flipX"同惯例）
            this.weaponSprite.setFlipY(false);
            this.weaponSprite.setFlipX(isMelee && !facingRight);
        }

        // running 的剑使用静态背负锚点，并始终位于人物主体背层；staff/bow/枪械不进入该分支。
        const carryLayer = WeaponAnimConfig[wt]?.[animState]?.carryLayer;
        const swordOnBack = isSwordMelee && animState === 'running' && carryLayer === 'back';
        this.weaponSprite.setDepth(this.playerSprite.depth + (swordOnBack ? -1 : 2));
    }

    /**
     * 自动步枪 ADS 枪口对准：逐贴图读取 BootScene 烘焙枪口点，解析枪口相对握把的
     * 局部垂距，再用闭式解求出枪管轴穿过目标点的旋转角。只混合角度差，不改腰射。
     */
    _resolveRifleAdsRotation({
        wt, pos, target, rot, gunFlipY, wSize, grip,
        spriteOffX, spriteOffY, aimSprOffY, recoilAngle,
    }) {
        const cfg = WeaponAnimConfig[wt] || {};
        const rearGrip = grip || WeaponTransform.getTextureGrip(wt, this.weaponSprite.texture.key, wSize);
        const baked = (typeof window !== 'undefined' && window.__weaponMuzzlePoints)
            ? window.__weaponMuzzlePoints[this.weaponSprite.texture.key] : null;
        const muzzle = cfg.muzzle || {};
        const fracY = muzzle.manual === true
            ? (muzzle.y ?? 0.5)
            : (baked ? baked.fy : (muzzle.y ?? 0.5));
        const displayHeight = wSize.height;
        const gripLocalYRaw = (0.5 - (rearGrip.y ?? 0.5)) * displayHeight;
        const muzzleLocalYRaw = (fracY - 0.5) * displayHeight;
        const localY = gunFlipY
            ? -(gripLocalYRaw + muzzleLocalYRaw)
            : gripLocalYRaw + muzzleLocalYRaw;

        // spriteOffset 是世界坐标；aimSpriteOffsetY 仅在 ADS 期间按 ease 混合。
        const ease = Math.max(0, Math.min(1, this._aimEase || 0));
        const worldOffsetX = spriteOffX ? (gunFlipY ? -spriteOffX : spriteOffX) : 0;
        const worldOffsetY = (spriteOffY || 0) + (aimSprOffY || 0) * ease;
        const dx = target.x - (pos.x + worldOffsetX);
        const dy = target.y - (pos.y + worldOffsetY);
        const distance = Math.hypot(dx, dy);
        if (distance <= Math.abs(localY) + 0.001) return rot;

        const targetAngle = Math.atan2(dy, dx);
        const exactRot = targetAngle - Math.asin(Math.max(-1, Math.min(1, localY / distance)));
        // 对准只修正基础持枪角；射击瞬间的既有 recoilAngle 仍完整保留。
        const alignmentRot = rot - recoilAngle;
        const correction = Math.atan2(
            Math.sin(exactRot - alignmentRot),
            Math.cos(exactRot - alignmentRot)
        );
        return rot + correction * ease;
    }

    /**
     * 枪械扭转锚点（主/副手共用）：
     * 躯干空间计算（不随 player.rotation 公转）；钳制内绕腰轴随躯干轨道；
     * 超出钳制的角以肩为支点把钳制点继续旋转——圆过钳制点，全程连续无跳变。
     */
    _computeGunAnchor(player, wt, animState, isOffhand) {
        const ts = this._twistState;
        const local = WeaponTransform.getWeaponLocalOffset(wt, player.size, isOffhand, false, animState, ts.facingRight);
        let lx = local.x;
        if (!ts.facingRight) lx = -lx; // 躯干镜像，锚点同步镜像
        const body = WeaponTransform.localToWorld(player, { x: lx, y: local.y }, 0, true, animState, wt);

        // ① 钳制位置：腰轴轨道（ts.angle 即钳制后的扭转角）
        const dAng = ts.facingRight ? ts.angle : -ts.angle;
        const pdx = body.x - ts.pivotX, pdy = body.y - ts.pivotY;
        const cosA = Math.cos(dAng), sinA = Math.sin(dAng);
        const clampX = ts.pivotX + pdx * cosA - pdy * sinA;
        const clampY = ts.pivotY + pdx * sinA + pdy * cosA;

        // ② 超出钳制的角（面向系）：以肩为支点继续旋转钳制点
        const twistCfg = this._twistConfig;
        let excess = 0;
        if (twistCfg && twistCfg.arm && typeof Input !== 'undefined' && Input.mouse) {
            const mw = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            // 瞄准死区激活时用可调锥有效角（与 _syncGunTwist 同口径）
            const aimW = (this._frozenAimActive && this._effectiveAim !== undefined)
                ? this._effectiveAim
                : Math.atan2(mw.y - player.y, mw.x - player.x);
            let rel = ts.facingRight ? aimW : Math.PI - aimW;
            rel = Math.atan2(Math.sin(rel), Math.cos(rel));
            const scaleA = twistCfg.angleScale !== undefined ? twistCfg.angleScale : 1;
            excess = rel * scaleA - ts.angle;
        }
        const pos = { x: 0, y: 0 };
        if (excess !== 0) {
            const frameW = this.playerSprite.frame.width || 512;
            const frameH = this.playerSprite.frame.height || 516;
            const dispW = this.playerSprite.displayWidth;
            const dispH = this.playerSprite.displayHeight;
            const dSx = ((twistCfg.arm.pivotX - twistCfg.pivotX) / frameW) * dispW;
            const dSy = ((twistCfg.arm.pivotY - twistCfg.pivotY) / frameH) * dispH;
            const offX = ts.facingRight ? dSx : -dSx;
            const shoulderX = ts.pivotX + offX * cosA - dSy * sinA;
            const shoulderY = ts.pivotY + offX * sinA + dSy * cosA;
            const exW = ts.facingRight ? excess : -excess;
            const vx = clampX - shoulderX, vy = clampY - shoulderY;
            const cosE = Math.cos(exW), sinE = Math.sin(exW);
            pos.x = shoulderX + vx * cosE - vy * sinE;
            pos.y = shoulderY + vx * sinE + vy * cosE;
        } else {
            pos.x = clampX;
            pos.y = clampY;
        }

        // aimFrames 锚点（腰射→瞄准帧动画）：锚点 = 肩 + R(世界瞄准角 − 帧自然角) × (帧手 − 肩)——
        // 与 _syncGunArm 的主握枪臂同口径；托举臂另按武器实际护木点解算。按 _aimEase 与旧链锚点混合：
        // ease=0 完全等价旧链（钳制轨道+超出延伸），ease=1 完全帧驱动，过渡平滑无瞬移
        const afCfg = twistCfg && twistCfg.aimFrames;
        if (afCfg && this._aimEase > 0 && twistCfg.arm && afCfg.hands && afCfg.hands.length) {
            const frameW = this.playerSprite.frame.width || 512;
            const frameH = this.playerSprite.frame.height || 516;
            const dispW = this.playerSprite.displayWidth;
            const dispH = this.playerSprite.displayHeight;
            const fi = Math.max(0, Math.min(afCfg.hands.length - 1, Math.round(this._aimEase * (afCfg.hands.length - 1))));
            const hand = afCfg.hands[fi];
            // 肩关节世界点（与 _syncGunArm 同口径：肩在躯干上随扭转绕腰轴旋转）
            const dSxF = ((twistCfg.arm.pivotX - twistCfg.pivotX) / frameW) * dispW;
            const dSyF = ((twistCfg.arm.pivotY - twistCfg.pivotY) / frameH) * dispH;
            const offXF = ts.facingRight ? dSxF : -dSxF;
            const shX = ts.pivotX + offXF * cosA - dSyF * sinA;
            const shY = ts.pivotY + offXF * sinA + dSyF * cosA;
            // 世界瞄准角（死区可调锥同口径）
            let aimWF = ts.facingRight ? 0 : Math.PI;
            if (typeof Input !== 'undefined' && Input.mouse) {
                const mwF = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                aimWF = (this._frozenAimActive && this._effectiveAim !== undefined)
                    ? this._effectiveAim
                    : Math.atan2(mwF.y - player.y, mwF.x - player.x);
            }
            const natF = Math.atan2(hand.y - twistCfg.arm.pivotY, hand.x - twistCfg.arm.pivotX);
            const natEffF = ts.facingRight ? natF : Math.PI - natF;
            const rotF = aimWF - natEffF;
            let vxF = (hand.x - twistCfg.arm.pivotX) * (dispW / frameW);
            const vyF = (hand.y - twistCfg.arm.pivotY) * (dispH / frameH);
            if (!ts.facingRight) vxF = -vxF; // 镜像帧内手部水平取反
            const cosF = Math.cos(rotF), sinF = Math.sin(rotF);
            // 逐武器瞄准微调（可选，世界 px）：aimAdjustX 朝向后移（负=靠近身体，翻转镜像）/aimAdjustY 下移——
            // 共享 aimFrames 公式之上按武器修正（如 qbz191 与 AKM 基准差）
            const aimAdj = WeaponAnimConfig[wt] || {};
            // liftAdjustX/Y（世界 px）：瞄准锚点微调——X 朝向后移（负=靠近身体，翻转镜像），Y 正=少抬/下移；经 blend 自动 ×ease
            const fxF = shX + vxF * cosF - vyF * sinF + (ts.facingRight ? 1 : -1) * ((afCfg.liftAdjustX || 0) + (aimAdj.aimAdjustX || 0));
            const fyF = shY + vxF * sinF + vyF * cosF + (afCfg.liftAdjustY || 0) + (aimAdj.aimAdjustY || 0);
            const e = this._aimEase;
            pos.x = pos.x * (1 - e) + fxF * e;
            pos.y = pos.y * (1 - e) + fyF * e;
        }

        // 双持偏移（配置 dualOffsetX，世界 px）：双持手枪时主/副手同步前移（远离头部，翻转镜像）
        const dualOff = WeaponAnimConfig[wt] && WeaponAnimConfig[wt].dualOffsetX;
        if (dualOff) {
            const offSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
            const offItem = player.equipments[offSlot];
            if (offItem && offItem.name && (offItem.weaponType === 'pistol' || offItem.rangedType === 'pistol')) {
                pos.x += ts.facingRight ? dualOff : -dualOff;
            }
        }
        // 瞄准抬升（Tier 1：双手枪械 aimLift；offsetX 翻转镜像，offsetY 负=上移）——
        // 锚点上移后手臂经 atan2(握把−肩) 自然举到眼前，臂枪一体。
        // aimFrames 激活时跳过（帧动画锚点已含抬升轨迹，叠加会双重抬升）
        if (this._aimEase > 0 && twistCfg && twistCfg.aimLift && !afCfg) {
            pos.x += ts.facingRight ? (twistCfg.aimLift.offsetX || 0) * this._aimEase : -(twistCfg.aimLift.offsetX || 0) * this._aimEase;
            pos.y += (twistCfg.aimLift.offsetY || 0) * this._aimEase;
        }
        // 武器摆动倍率（配置 bobWeaponScale，默认 1=与上身同幅）：武器 bob = 上身 bob × 倍率，方向对齐
        const bobWeaponScale = WeaponAnimConfig[wt] && WeaponAnimConfig[wt].bobWeaponScale;
        if (bobWeaponScale && this._bobDelta && (this._bobDelta.x !== 0 || this._bobDelta.y !== 0)) {
            pos.x += this._bobDelta.x * (bobWeaponScale - 1);
            pos.y += this._bobDelta.y * (bobWeaponScale - 1);
        }

        // 手枪主手不是长枪 ADS 的逐帧手位：静态手臂条只会绕肩旋转，不会伸长。
        // 旧配置把枪的理论锚点放在自然掌心前约 12~15px，因而即使贴图 grip 自身
        // 数学上零误差，画面仍是“枪浮在指尖前”。这里保留原瞄准方向、双持偏移、
        // 跑步 bob 与左右镜像，只把主握把的肩距收口到当前姿态的真实肩→掌心长度。
        // 副手属于 gun_idle_dual 躯干烘焙手位，继续使用独立 offBase，不套主臂长度。
        if (!isOffhand && PISTOL_FAMILY.includes(wt) && twistCfg && twistCfg.arm) {
            const arm = twistCfg.arm;
            const frameW = this.playerSprite.frame.width || 512;
            const frameH = this.playerSprite.frame.height || 516;
            const dispW = this.playerSprite.displayWidth;
            const dispH = this.playerSprite.displayHeight;
            const shoulderLocalX = ((arm.pivotX - twistCfg.pivotX) / frameW) * dispW;
            const shoulderLocalY = ((arm.pivotY - twistCfg.pivotY) / frameH) * dispH;
            const shoulderFacingX = ts.facingRight ? shoulderLocalX : -shoulderLocalX;
            const shoulderX = ts.pivotX + shoulderFacingX * cosA - shoulderLocalY * sinA;
            const shoulderY = ts.pivotY + shoulderFacingX * sinA + shoulderLocalY * cosA;
            const naturalHandX = (arm.handX - arm.pivotX) * (dispW / frameW);
            const naturalHandY = (arm.handY - arm.pivotY) * (dispH / frameH);
            const naturalReach = Math.hypot(naturalHandX, naturalHandY);
            const targetX = pos.x - shoulderX;
            const targetY = pos.y - shoulderY;
            const targetReach = Math.hypot(targetX, targetY);
            if (naturalReach > 0.001 && targetReach > 0.001) {
                const reachScale = naturalReach / targetReach;
                pos.x = shoulderX + targetX * reachScale;
                pos.y = shoulderY + targetY * reachScale;
            }
        }
        return pos;
    }

    /**
     * 同步副手武器到 Phaser Sprite
     */
    syncOffhandWeapon(player, weaponAnim = {}) {
        if (!this.playerSprite || !player) return;
        this._offhandGunGripWorld = null;
        
        const offhandSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
        const offhandItem = player.equipments[offhandSlot];
        
        if (!offhandItem || !offhandItem.name) {
            if (this.offhandWeaponSprite) this.offhandWeaponSprite.setVisible(false);
            return;
        }
        
        // 如果副手不是武器（如盾牌），隐藏 Sprite
        const isWeapon = offhandItem.category === 'weapon_melee' || offhandItem.category === 'weapon_ranged' ||
                         GUN_FAMILY.includes(offhandItem.weaponType) || ['bow', 'sword'].includes(offhandItem.weaponType);
        if (!isWeapon) {
            if (this.offhandWeaponSprite) this.offhandWeaponSprite.setVisible(false);
            return;
        }
        
        // 如果 Canvas 渲染武器，隐藏 Phaser 副手武器
        if (this._useCanvasWeapon) {
            if (this.offhandWeaponSprite) this.offhandWeaponSprite.setVisible(false);
            return;
        }
        
        // 如果玩家处于特殊动画状态，隐藏 Phaser 副手武器（由 Canvas 渲染）
        const isSpecialAnim = player._isWhirlwind || player._whirlwindRecovering || player._isPushStrike || player._isDashing || player._dashResetAnim || player._specialAttackActive || player._specialResetAnim;
        if (isSpecialAnim) {
            if (this.offhandWeaponSprite) this.offhandWeaponSprite.setVisible(false);
            return;
        }
        
        // 根据 weaponType 和 weaponId 精确映射贴图
        let texture = getWeaponTextureKey(offhandItem);
        // 动画/贴图配置键：animConfigKey 优先（与 weapon-anim.js/subsystems 同口径；R93 副手误吃 G18 配置的根因）
        const wt = offhandItem.animConfigKey || offhandItem.weaponType;
        
        // 创建或更新副手武器 Sprite
        if (!this.offhandWeaponSprite) {
            this.offhandWeaponSprite = this.add.sprite(0, 0, texture);
        } else if (this.offhandWeaponSprite.texture.key !== texture) {
            this.offhandWeaponSprite.setTexture(texture);
        }
        
        // 使用 WeaponTransform 统一计算副手位置和旋转
        // 按玩家状态推断动画状态（副手也可能为剑类）
        let offhandAnimState = 'idle';
        if (isPlayerRunVisual(player)) offhandAnimState = 'running';
        else if (player.isMoving) offhandAnimState = 'walk';
        // 近战武器使用固定 rotation（所有状态）；
        // 副手远程武器（双持手枪）同主手：武器位置 → 鼠标准心的精确连线角
        const isMelee = wt === 'sword' || wt === 'bow';
        const pos = WeaponTransform.getWeaponWorldPosition(player, wt, true, false, offhandAnimState, {}, isMelee ? !this.playerSprite.flipX : this._getVisualFacingRight(player));
        const facingRight = isMelee ? !this.playerSprite.flipX : this._getVisualFacingRight(player); // 近战朝向硬绑定身体 flipX

        // 躯干扭转激活：副手锚点与主手同口径（躯干空间 + 连续轨道）
        if (this._twistState && !isMelee) {
            const a = this._computeGunAnchor(player, wt, offhandAnimState, true);
            pos.x = a.x;
            pos.y = a.y;
        }

        let rot;
        if (isMelee) {
            rot = WeaponTransform.getWeaponRotation(0, wt, 0, offhandAnimState, facingRight);
        } else if (typeof Input !== 'undefined' && Input.mouse) {
            // 瞄准死区激活：用可调锥有效角（与主手同口径）
            if (this._frozenAimActive && this._effectiveAim !== undefined) {
                rot = this._effectiveAim;
            } else {
                const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                rot = Math.atan2(mouseWorld.y - pos.y, mouseWorld.x - pos.x);
            }
        } else {
            rot = WeaponTransform.getWeaponRotation(player.rotation, wt, 0, offhandAnimState, facingRight);
        }
        // rotOffset（配置，度）：枪械贴图固有倾角修正；随 flipY 镜像取反（右 -6° ↔ 左 +6°）
        const rotOffsetOff = !isMelee && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].rotOffset
            ? WeaponAnimConfig[wt].rotOffset * Math.PI / 180 : 0;
        const isGunOff = GUN_FAMILY.includes(wt);
        // flipY 与主手同口径：用 rotOffset 修正【前】的 rot 判定（此前在加过 -6° 偏移后重判，
        // 90°~96° 窗口内主/副手 flipY 相反——双持手枪左右朝向不对称根因）
        const flipY = isGunOff && Math.abs(rot) > Math.PI / 2;
        rot += flipY ? -rotOffsetOff : rotOffsetOff;

        // 应用后坐力偏移
        if (weaponAnim.recoil) {
            pos.x -= Math.cos(player.rotation) * weaponAnim.recoil;
            pos.y -= Math.sin(player.rotation) * weaponAnim.recoil;
        }

        // Phase 2: 攻击动画刺击位移计算（已禁用，使用开发工具配置）
        let _thrust = 0;

        // 应用 recoilAngle（随 flipY 镜像取反，与 rotOffset 同口径——副手后坐踢角
        // -recoil*0.05 幅度达 ~36°，瞄左不镜像会把枪拧向反侧，枪口/火焰/子弹随贴图错位 ~33px）
        if (weaponAnim.recoilAngle) {
            rot += flipY ? -weaponAnim.recoilAngle : weaponAnim.recoilAngle;
        }
        
        // 应用弓旋转角度（rotate 阶段）
        if (weaponAnim.rotateAngle && wt === 'bow') {
            rot += weaponAnim.rotateAngle;
        }
        
        // 武器缩放：枪械类使用 setScale 保持原始比例，其他武器使用 setDisplaySize
        const wSize = WeaponTransform.getWeaponSize(wt, null, offhandAnimState);
        const gunDisplaySizeOff = isGunOff ? {
            width: wSize.height * ((this.offhandWeaponSprite.width || 1) / Math.max(1, this.offhandWeaponSprite.height || 1)),
            height: wSize.height,
        } : wSize;

        // 与主手保持同一配置读取与同锚语义。当前双持主要是手枪，但这里不依赖
        // "手枪恰好没有偏移"这一偶然条件，后续逐枪偏移也不会再次造成副手脱手。
        const offhandWepCfg = isGunOff ? findWeaponConfig(offhandItem.weaponId, offhandItem.name) : null;
        const spriteOffXOff = isGunOff && (offhandItem.spriteOffsetX
            ?? offhandWepCfg?.spriteOffsetX ?? WeaponAnimConfig[wt]?.spriteOffsetX ?? 0);
        const spriteOffYOff = isGunOff && (offhandItem.spriteOffsetY
            ?? offhandWepCfg?.spriteOffsetY ?? WeaponAnimConfig[wt]?.spriteOffsetY ?? 0);
        const aimSprOffXOff = isGunOff && (offhandItem.aimSpriteOffsetX
            ?? offhandWepCfg?.aimSpriteOffsetX ?? WeaponAnimConfig[wt]?.aimSpriteOffsetX ?? 0);
        const aimSprOffYOff = isGunOff && (offhandItem.aimSpriteOffsetY
            ?? offhandWepCfg?.aimSpriteOffsetY ?? WeaponAnimConfig[wt]?.aimSpriteOffsetY ?? 0);
        if (spriteOffXOff) pos.x += flipY ? -spriteOffXOff : spriteOffXOff;
        if (spriteOffYOff) pos.y += spriteOffYOff;
        if (aimSprOffXOff) {
            const aimOffset = aimSprOffXOff * (this._aimEase || 0);
            pos.x += Math.cos(rot) * aimOffset;
            pos.y += Math.sin(rot) * aimOffset;
        }
        if (aimSprOffYOff) pos.y += aimSprOffYOff * (this._aimEase || 0);
        this._offhandGunGripWorld = isGunOff ? { x: pos.x, y: pos.y } : null;

        // 握把旋转轴心（与主手同口径；逐贴图 grip + 真实显示宽高）
        const gripCfgOff = isGunOff
            ? WeaponTransform.getTextureGrip(wt, this.offhandWeaponSprite.texture.key, gunDisplaySizeOff)
            : null;
        if (gripCfgOff) {
            const gcx = (0.5 - gripCfgOff.x) * gunDisplaySizeOff.width;
            const gcyRaw = (0.5 - gripCfgOff.y) * gunDisplaySizeOff.height;
            const gcy = flipY ? -gcyRaw : gcyRaw;
            pos.x += Math.cos(rot) * gcx - Math.sin(rot) * gcy;
            pos.y += Math.sin(rot) * gcx + Math.cos(rot) * gcy;
        }

        this.offhandWeaponSprite.setPosition(pos.x, pos.y);
        this.offhandWeaponSprite.setRotation(rot);
        this.offhandWeaponSprite.setVisible(!this._useCanvasWeapon);
        
        // 武器水平翻转：使用旋转镜像替代 setFlipX
        // const offhandFlipX = !facingRight;
        // this.offhandWeaponSprite.setFlipX(offhandFlipX);
        
        if (isGunOff) {
            this.offhandWeaponSprite.setScale(wSize.height / this.offhandWeaponSprite.height);
            this.offhandWeaponSprite.setFlipY(flipY);
        } else {
            this.offhandWeaponSprite.setDisplaySize(wSize.width, wSize.height);
            // 副手近战朝左贴图镜像（与主手同口径：旋转码已等于 −R_r，补 flipX 构成垂直轴完整镜像）
            this.offhandWeaponSprite.setFlipY(false);
            this.offhandWeaponSprite.setFlipX(isMelee && !facingRight);
        }
    }

    /**
     * Phase 3: 同步符文长剑悬浮剑到 Phaser Sprite
     */
    _syncRuneSwords(player) {
        if (!player._runeSwordSpecialActive || !player._runeSwordSwords) {
            this.runeSwordGroup.setVisible(false);
            return;
        }
        
        // 确保 Group 中有足够的 Sprite
        while (this.runeSwordGroup.countActive() < player._runeSwordSwords.length) {
            const sprite = this.add.sprite(0, 0, 'runeSwordBlade');
            this.runeSwordGroup.add(sprite);
        }
        
        // 同步每把剑的位置和旋转
        this.runeSwordGroup.getChildren().forEach((sprite, i) => {
            const sword = player._runeSwordSwords[i];
            if (!sword || !sword.active) {
                sprite.setVisible(false);
                return;
            }
            
            // 贴图大小：与 Canvas 一致（84 * 0.6 = 50.4）
            const BLADE_SIZE = 50;
            sprite.setDisplaySize(BLADE_SIZE, BLADE_SIZE);
            
            if (sword.flyActive) {
                // 飞行剑：使用世界坐标和 flyAngle
                // 视觉投影直接消费飞剑真实 Z；flyX/flyY 继续保持物理平面坐标。
                const flyZ = Number(sword.flyZ)
                    || entitySurfaceZ(player) + (sword.elev ?? (player.bodyHeight || 0) * 0.5);
                sprite.setPosition(sword.flyX, sword.flyY - flyZ);
                sprite.setDepth(this._projectileDepth(player, sword.flyY));
                sprite.setRotation(sword.flyAngle + Math.PI / 2);
                sprite.setAlpha(1);
                sprite.setVisible(true);
                return;
            }
            
            // 立体环绕：以玩家圆柱体碰撞体积为基准（环形 offsetX/offsetY + 各自 elev 高度）
            const swayX = Math.sin(sword.swayTimer * sword.swayFreqX) * sword.swayAmpX;
            const swayY = Math.cos(sword.swayTimer * sword.swayFreqY) * sword.swayAmpY;
            
            const localX = sword.offsetX + swayX;
            const localY = sword.offsetY + swayY;
            
            const cos = Math.cos(player.rotation);
            const sin = Math.sin(player.rotation);
            const worldX = player.x + cos * localX - sin * localY;
            const worldY = player.y
                - entitySurfaceZ(player)
                - (sword.elev ?? (player.bodyHeight || 0) * 0.5)
                + sin * localX + cos * localY;
            
            // 计算朝向鼠标的角度（使用 Phaser 相机坐标，避免 window.Camera 偏移错误）
            const camera = this.cameras.main;
            const mouseX = camera.scrollX + (Input.mouse?.x || 0);
            const mouseY = camera.scrollY + (Input.mouse?.y || 0);
            const absoluteAngle = Math.atan2(mouseY - worldY, mouseX - worldX);
            
            sprite.setPosition(worldX, worldY);
            sprite.setDepth(this._projectileDepth(player, worldY));
            sprite.setRotation(absoluteAngle + Math.PI / 2);
            sprite.setAlpha(sword.fading ? Math.max(0, 1 - sword.fadeTimer / 300) : 1);
            sprite.setVisible(true);
        });
    }

    /**
     * 同步非玩家施法者的冰锥/火球特效
     */
    _destroyMagicCasterVisuals(caster, sprites) {
        if (!sprites) return;
        const visuals = new Set([
            ...(sprites.iceSpikes || []),
            ...(sprites.iceSpikeFly || []),
            sprites.fireball,
            sprites.fireballFly,
            ...(sprites.fireballEmitters || []),
        ]);
        for (const visual of visuals) {
            if (!visual) continue;
            visual.stop?.();
            visual.destroy?.();
        }
        sprites.iceSpikes = [];
        sprites.iceSpikeFly = [];
        sprites.fireball = null;
        sprites.fireballFly = null;
        sprites.fireballEmitters = null;
        this.unregisterEnvironmentGlow(`fireball:${caster?.id || caster?.name || 'unknown'}`);
    }

    _syncOtherMagicCasters(_game) {
        if (!_game.entities) return;
        const activeCasters = new Set();
        _game.entities.forEach(entity => {
            if (entity === _game.player) return;
            const hasIce = entity._iceSpikeActive || (entity._iceSpikeSpikes && entity._iceSpikeSpikes.some(s => s.active));
            // ⚠ 2026-08-08 九修：发射后的火球必须 flyActive 才算"活跃"——巫师死亡/命中后
            // 状态未清（_fireballActive 残留 true）或施法者已死（hp<=0）时，粒子也应被清理
            // 循环销毁，避免"火球命中后残留不消失"。
            const casterAlive = entity.hp == null || entity.hp > 0;
            const fb = entity._fireball;
            const hasFire = casterAlive && entity._fireballActive && fb && (fb.launched ? fb.flyActive : fb.active);
            if (!hasIce && !hasFire) return;
            activeCasters.add(entity);
            this._syncIceSpikes(entity);
            this._syncFireball(entity);
            this._syncFlyingIceSpikes(entity);
            this._syncFlyingFireball(entity);
        });
        // 玩家也由主循环单独同步，必须加入 activeCasters，避免清理循环误删玩家魔法精灵
        if (_game.player) activeCasters.add(_game.player);
        // 清理不再施法的注册表条目
        for (const [caster, sprites] of this._magicSprites.entries()) {
            if (activeCasters.has(caster)) continue;
            this._destroyMagicCasterVisuals(caster, sprites);
            this._magicSprites.delete(caster);
        }
    }

    _getMagicSprites(caster) {
        if (!this._magicSprites.has(caster)) {
            this._magicSprites.set(caster, {
                iceSpikes: [],
                iceSpikeFly: [],
                fireball: null,
                fireballFly: null,
                fireballEmitters: null, // 火球粒子火焰（主火焰团 + 外层光晕，火炬火焰放大版）
            });
        }
        return this._magicSprites.get(caster);
    }

    // ==================== 火球粒子火焰（参考障碍物火炬火焰：impact_dot + 三色 ADD 上飘） ====================
    _ensureFireballEmitters(caster, scale) {
        const sprites = this._getMagicSprites(caster);
        if (sprites.fireballEmitters) return sprites.fireballEmitters;
        const s = scale || 1;
        // 与火炬火焰同款：确保 impact_dot 粒子贴图存在（此前未确保，纹理缺失时粒子不可见）
        if (!this.textures.exists('impact_dot') && typeof this._ensureImpactDotTexture === 'function') {
            this._ensureImpactDotTexture();
        }
        // ① 主火焰团：稍大的火球
        const main = this.add.particles(0, 0, 'impact_dot', {
            frequency: 45,
            speedX: { min: -16, max: 16 },
            speedY: { min: -160, max: -80 },
            scale: { start: 5.5 * s, end: 0.9 * s },
            alpha: { start: 0.95, end: 0 },
            lifespan: 520,
            tint: [0xffffff, 0xffd27a, 0xff8830, 0xff5510],
            blendMode: 'ADD',
        });
        // ② 外层光晕：更大更淡
        const glow = this.add.particles(0, 0, 'impact_dot', {
            frequency: 30,
            speedX: { min: -6, max: 6 },
            speedY: { min: -34, max: -12 },
            scale: { start: 9 * s, end: 2.6 * s },
            alpha: { start: 0.32, end: 0 },
            lifespan: 620,
            tint: [0xff8830, 0xff5510],
            blendMode: 'ADD',
        });
        sprites.fireballEmitters = [main, glow];
        return sprites.fireballEmitters;
    }

    _positionFireballEmitters(caster, x, y, scale, groundY = y, depthContext = null) {
        const ems = this._ensureFireballEmitters(caster, scale || 1);
        const depth = this._projectileDepth(caster, groundY, depthContext);
        for (const em of ems) {
            em.setPosition(x, y);
            em._skillGroundY = groundY;
            em._skillDepthContext = depthContext;
            // 浮空件深度 = 施法者精灵深度 + 2（避免按抬升后 y 排序沉到施法者身后不可见）
            em.setDepth(depth);
            em.setVisible(true);
        }
        this.registerEnvironmentGlow(`fireball:${caster.id || caster.name || 'unknown'}`, x, y, {
            radius: 72 * (scale || 1),
            color: 0xff7a2e,
            alpha: 0.18,
            depth: depth + 0.1,
            flicker: 0.10,
        });
    }

    /** 浮空特效优先跟随施法者；墙顶特效额外高于整条承托墙链。 */
    _projectileDepth(caster, fallbackY, depthContext = null) {
        return resolveSkillEffectDepth({
            source: caster,
            groundY: fallbackY,
            context: depthContext,
            groundOffset: 15,
            sourceOffset: 2,
            // 已发射的墙顶弹体使用出手快照，不再跟随后来上下墙的施法者深度。
            preferSourceDepth: depthContext == null,
        });
    }

    _hideFireballEmitters(caster) {
        const sprites = this._getMagicSprites(caster);
        if (sprites.fireballEmitters) {
            for (const em of sprites.fireballEmitters) em.setVisible(false);
        }
        this.unregisterEnvironmentGlow(`fireball:${caster.id || caster.name || 'unknown'}`);
    }

    /**
     * Phase 3: 同步冰锥到 Phaser Sprite
     */
    _syncIceSpikes(caster) {
        const sprites = this._getMagicSprites(caster);
        if (!caster._iceSpikeSpikes) {
            sprites.iceSpikes.forEach(s => s.setVisible(false));
            return;
        }

        // 确保有足够 Sprite
        while (sprites.iceSpikes.length < caster._iceSpikeSpikes.length) {
            const sprite = this.add.sprite(0, 0, 'iceSpike');
            sprite.setDisplaySize(40, 60);
            sprites.iceSpikes.push(sprite);
        }

        // 同步每根冰锥的位置和旋转
        sprites.iceSpikes.forEach((sprite, i) => {
            const spike = caster._iceSpikeSpikes[i];
            if (!spike || !spike.active || spike.launched || spike.flyActive) {
                sprite.setVisible(false);
                return;
            }

            // 随机贴图：每颗冰锥独立抽取（4 张 AI 生成贴图）
            const tex = spike.tex || 'iceSpike';
            if (sprite.texture.key !== tex) sprite.setTexture(tex);

            const swayX = Math.sin(spike.swayTimer * spike.swayFreqX) * spike.swayAmpX;
            const swayY = Math.cos(spike.swayTimer * spike.swayFreqY) * spike.swayAmpY;

            // 发射前待机：按轨道角绕施法者圆柱体椭圆环绕（orbitAngle 由系统 update 推进）
            const oa = spike.orbitAngle ?? Math.atan2(spike.offsetY || 0, spike.offsetX || 0);
            const localX = Math.cos(oa) * (spike.orbitRx ?? 50) + swayX;
            const localY = Math.sin(oa) * (spike.orbitRy ?? 30) + swayY;

            const cos = Math.cos(caster.rotation || 0);
            const sin = Math.sin(caster.rotation || 0);
            // 生成位置：以施法者圆柱体碰撞体积为基准——立体环绕（每根冰锥按 elev 位于圆柱体不同高度）
            const worldX = caster.x + cos * localX - sin * localY;
            const casterDisplayY = caster.y - entitySurfaceZ(caster);
            const worldY = casterDisplayY
                - (spike.elev ?? (caster.bodyHeight || 0) * 0.5)
                + sin * localX + cos * localY;

            // 玩家通过鼠标瞄准；敌人自动瞄准 caster.target。
            // 参考调整前代码：所有冰锥统一以施法者中心→鼠标准星的朝向（整圈冰锥同一指向，全部对准准星方向）
            let absoluteAngle;
            if (caster === Game.player) {
                const camera = this.cameras.main;
                const mouseX = camera.scrollX + (Input.mouse?.x || 0);
                const mouseY = camera.scrollY + (Input.mouse?.y || 0);
                absoluteAngle = Math.atan2(mouseY - casterDisplayY, mouseX - caster.x);
            } else {
                const target = caster.target;
                if (target && target.active) {
                    absoluteAngle = Math.atan2(
                        target.y - entitySurfaceZ(target) - casterDisplayY,
                        target.x - caster.x
                    );
                } else {
                    absoluteAngle = caster.rotation || 0;
                }
            }

            sprite.setPosition(worldX, worldY);
            sprite._skillGroundY = caster.y;
            sprite._skillDepthContext = null;
            sprite.setDepth(this._projectileDepth(caster, worldY)); // 浮空件：施法者精灵深度 + 2
            sprite.setRotation(absoluteAngle + Math.PI / 2);
            sprite.setAlpha(0.85);
            sprite.setVisible(true);
        });
    }

    /**
     * Phase 3: 同步火球到 Phaser Sprite
     */
    _syncFireball(caster) {
        if (!caster._fireballActive || !caster._fireball || caster._fireball.launched) {
            this._hideFireballEmitters(caster);
            return;
        }

        const fb = caster._fireball;

        const swayX = Math.sin(fb.swayTimer * fb.swayFreqX) * fb.swayAmpX;
        const swayY = Math.cos(fb.swayTimer * fb.swayFreqX) * fb.swayAmpX * 0.5;

        // 发射前待机：按轨道角绕施法者圆柱体椭圆环绕（orbitAngle 由系统 update 推进）
        const oa = fb.orbitAngle ?? 0;
        const localX = Math.cos(oa) * (fb.orbitRx ?? 50) + swayX;
        const localY = Math.sin(oa) * (fb.orbitRy ?? 30) + swayY;

        const cos = Math.cos(caster.rotation || 0);
        const sin = Math.sin(caster.rotation || 0);
        // 生成位置：以施法者圆柱体碰撞体积为基准（火球位于垂直中心 elev）
        const worldX = caster.x + cos * localX - sin * localY;
        const worldY = caster.y
            - entitySurfaceZ(caster)
            - (fb.elev ?? (caster.bodyHeight || 0) * 0.5)
            + sin * localX + cos * localY;

        // 火炬同款火焰粒子（放大版）替换固定贴图
        this._positionFireballEmitters(caster, worldX, worldY, fb.scale || 1, caster.y, null);
    }

    /**
     * Phase 3 续：同步盾牌到 Phaser Sprite
     */
    _syncSwordShieldMotion(player) {
        if (!this._swordShieldMotion) {
            const motion = new PlayerSwordShieldMotion(this);
            this._swordShieldMotion = motion;
            this.events.once('shutdown', () => {
                motion.destroy();
                if (this._swordShieldMotion === motion) this._swordShieldMotion = null;
            });
        }
        this._swordShieldMotion.sync(player);
    }

    _syncShield(player, deltaMs = 0) {
        const offhandItem = player.shieldSystem?.getShieldData();
        const body = this.playerSprite;
        const hidden = !offhandItem || !body?.visible || !body.active
            || player._isDead || player.isDodging || player._frozenAbyssFalling
            || player._castState === 'casting' || player._castState === 'recover';
        if (hidden) {
            if (this.shieldSprite) this.shieldSprite.setVisible(false);
            this._playerShieldRig?.clear();
            this.defenseGlow?.clear();
            return;
        }
        
        const texture = getWeaponTextureKey(offhandItem);
        if (!this.shieldSprite) {
            this.shieldSprite = this.add.sprite(0, 0, texture);
        } else if (this.shieldSprite.texture.key !== texture) {
            this.shieldSprite.setTexture(texture);
        }
        
        const visual = getPlayerShieldVisual(offhandItem);
        const defending = !!player.shieldSystem?.defending;
        if (!this._playerShieldRig) {
            const rig = new PlayerShieldRig(this);
            this._playerShieldRig = rig;
            this.events.once('shutdown', () => {
                rig.destroy();
                if (this._playerShieldRig === rig) this._playerShieldRig = null;
            });
        }
        const motionBinding = this._swordShieldMotion?.shieldBinding;
        if (motionBinding) {
            this._playerShieldRig.clear();
            this._playerShieldRig.shieldBehindBody = this._swordShieldMotion.shieldBehindBody;
        }
        const binding = motionBinding || this._playerShieldRig.sync(player, deltaMs);
        if (binding?.mainGrip) this._swordShieldMotion?.syncDetachedGrip(player, binding);
        const anchor = visual.fallbackAnchor;
        const facingRight = binding ? binding.facingRight : !body.flipX;
        const mirror = facingRight ? 1 : -1;
        const worldX = binding ? binding.x : body.x + (anchor.x - body.originX) * body.displayWidth * mirror;
        const worldY = binding ? binding.y : body.y + (anchor.y - body.originY) * body.displayHeight;
        const displayH = PLAYER_DEFAULTS.physics.spriteSize * visual.bodyHeightRatio / visual.visibleHeightRatio;
        const frame = this.shieldSprite.frame;
        const displayW = displayH * frame.width / frame.height;
        const rot = binding ? binding.rotation : (defending ? visual.guardTilt : visual.restTilt) * mirror;
        const defenseBlend = Number.isFinite(binding?.defenseBlend)
            ? Math.max(0, Math.min(1, binding.defenseBlend))
            : (defending ? 1 : 0);
        const originX = visual.originX + (visual.defenseOriginX - visual.originX) * defenseBlend;
        const originY = visual.originY + (visual.defenseOriginY - visual.originY) * defenseBlend;
        // rotation 只负责盾面在屏幕平面内的倾斜；持盾视角由水平透视收缩单独表达。
        // 与 defenseBlend 同步插值，确保举盾/收盾过程中不瞬间变窄或恢复正面。
        const perspectiveScaleX = 1
            + (visual.defensePerspectiveScaleX - 1) * defenseBlend;
        
        this.shieldSprite.setPosition(worldX, worldY);
        this.shieldSprite.setOrigin(facingRight ? originX : 1 - originX, originY);
        this.shieldSprite.setFlipX(!facingRight);
        this.shieldSprite.setRotation(rot);
        this.shieldSprite.setDisplaySize(displayW * perspectiveScaleX, displayH);
        this.shieldSprite.setAlpha(body.alpha);
        this.shieldSprite.setVisible(true);
        
        // 防御红光（用 Phaser 图形或 Sprite）
        if (defending) {
            // 创建或更新防御光环
            if (!this.defenseGlow) {
                this.defenseGlow = this.add.graphics();
            }
            this.defenseGlow.clear();
            const flicker = 0.5 + Math.sin(Date.now() / 200) * 0.25;
            const r = player.size + 8;
            const groundX = player.collider?.x ?? player.x;
            const groundY = (player.collider?.y ?? player.y) - entitySurfaceZ(player);
            this.defenseGlow.fillStyle(0xcc3333, flicker * 0.35);
            this.defenseGlow.fillEllipse(groundX, groundY, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);
            this.defenseGlow.lineStyle(2, 0xff5555, flicker * 0.6);
            this.defenseGlow.strokeEllipse(groundX, groundY, (r + 2) * 2, (r + 2) * 2 * PERSPECTIVE_SCALE_Y);
        } else if (this.defenseGlow) {
            this.defenseGlow.clear();
        }
    }

    /**
     * Phase 3 续：同步飞行中的冰锥到 Phaser Sprite
     */
    _syncFlyingIceSpikes(caster) {
        const sprites = this._getMagicSprites(caster);
        if (!caster._iceSpikeSpikes || !caster._iceSpikeSpikes.some(s => s.flyActive)) {
            sprites.iceSpikeFly.forEach(s => s.setVisible(false));
            return;
        }

        const activeSpikes = caster._iceSpikeSpikes.filter(s => s.flyActive);

        // 确保有足够 Sprite
        while (sprites.iceSpikeFly.length < activeSpikes.length) {
            const sprite = this.add.sprite(0, 0, 'iceSpike');
            sprite.setDisplaySize(40, 60);
            sprites.iceSpikeFly.push(sprite);
        }

        let activeIdx = 0;
        sprites.iceSpikeFly.forEach(sprite => {
            if (activeIdx < activeSpikes.length) {
                const spike = activeSpikes[activeIdx];
                // 随机贴图：与悬浮期一致，每颗冰锥独立抽取
                const tex = spike.tex || 'iceSpike';
                if (sprite.texture.key !== tex) sprite.setTexture(tex);
                // 视觉与碰撞共用真实 flyZ，墙顶/楼梯飞行不再降到物理地面投影。
                sprite.setPosition(spike.flyX, spike.flyY - (Number(spike.flyZ) || 0));
                sprite._skillGroundY = spike.flyY;
                sprite._skillDepthContext = spike.renderDepthContext;
                sprite.setDepth(this._projectileDepth(caster, spike.flyY, spike.renderDepthContext));
                sprite.setRotation(spike.flyAngle + Math.PI / 2);
                sprite.setAlpha(0.9);
                sprite.setVisible(true);
                activeIdx++;
            } else {
                sprite.setVisible(false);
            }
        });
    }

    /**
     * Phase 3 续：同步飞行中的火球到 Phaser Sprite
     */
    _syncFlyingFireball(caster) {
        if (!caster._fireball || !caster._fireball.flyActive) {
            // 悬浮期（未发射）由 _syncFireball 负责显示发射器，这里不能隐藏——否则每帧互相抵消看不到火球；
            // 火球完全结束时由 _syncFireball 的 early-return 统一隐藏
            return;
        }

        const fb = caster._fireball;
        // 视觉与碰撞共用真实 flyZ。
        this._positionFireballEmitters(
            caster,
            fb.flyX,
            fb.flyY - (Number(fb.flyZ) || 0),
            fb.scale || 1,
            fb.flyY,
            fb.renderDepthContext
        );
    }

    // ==================== 挥砍残影（A 方案运动模糊的实现） ====================
    // 高斯滤镜对细长武器是"摊薄消失"（实测峰值帧剑身近乎不可见），改为沿 perFrame 轨迹
    // 回放历史姿态的残影副本：blurX/blurY 配置值驱动残影强度（峰值帧残影最长最浓，起势/收势无）。
    // 与攻击/冲刺两分支共用；不依赖 WebGL 滤镜，Canvas 兜底环境同样生效。
    _syncWeaponGhosts(player, wt, progress, cfgKey, facingRight, blurStrength) {
        const GHOST_N = 3;
        if (!this._weaponGhosts) this._weaponGhosts = [];
        // 强度阈值：起势/收势与定格末帧的小值（0.4~1）不出残影
        if (!this.weaponSprite || blurStrength < 1.5) {
            this._hideWeaponGhosts();
            return;
        }
        const norm = Math.min(1, blurStrength / 12); // 12 = 现行配置峰值
        const step = 0.035 + norm * 0.05;            // 每道残影回退的进度步长（峰值时总长 ≈ 0.26）
        const texKey = this.weaponSprite.texture.key;
        for (let i = 0; i < GHOST_N; i++) {
            let g = this._weaponGhosts[i];
            const past = progress - step * (i + 1);
            if (past <= 0) {
                if (g) g.setVisible(false);
                continue;
            }
            // 与主贴图同口径：恒按朝右取帧后手动镜像
            const pf = WeaponTransform.getInterpolatedPerFramePosition(player, wt, past, true, cfgKey);
            if (!pf) {
                if (g) g.setVisible(false);
                continue;
            }
            if (!g) {
                g = this.add.sprite(0, 0, texKey);
                this._weaponGhosts[i] = g;
            }
            if (g.texture.key !== texKey) g.setTexture(texKey);
            g.setPosition(facingRight ? pf.x : 2 * player.x - pf.x, pf.y);
            g.setRotation(facingRight ? pf.rotation : -pf.rotation);
            g.setFlipX(!facingRight);
            const s = WeaponTransform.getWeaponSize(wt, pf.scale, 'attack');
            g.setDisplaySize(s.width * (pf.stretchX || 1), s.height * (pf.stretchY || 1));
            g.setAlpha(Math.max(0, (0.1 + 0.4 * norm) * (1 - (i + 1) / (GHOST_N + 1))));
            g.setDepth(this.weaponSprite.depth - 0.001 * (i + 1));
            g.setVisible(this.weaponSprite.visible);
        }
    }

    _hideWeaponGhosts() {
        if (this._weaponGhosts) {
            for (const g of this._weaponGhosts) g.setVisible(false);
        }
        // 非攻击/冲刺轨迹帧：关闭武器模糊（strength=0 → 无采样偏移，等同原图）
        if (this._weaponBlurFilter) this._weaponBlurFilter.strength = 0;
    }

    /**
     * 符文长剑常驻粒子：以实际 Phaser 武器贴图为唯一姿态真源。
     * weaponSprite 使用中心 origin 时，从视觉中心沿剑身本地 +Y 找到握柄；攻击/行走等
     * 已把 origin 设置到握柄的分支则直接使用 sprite 锚点，避免重复偏移。
     */
    _syncRuneWeaponEffect(player, delta) {
        const effect = player?.weaponEffect;
        if (!effect) return;

        const currentWeapon = player.equipments?.[player.weaponMode] || null;
        const sprite = this.weaponSprite;
        const spritePresented = !!(sprite?.active && (sprite.visible || this._useCanvasWeapon));
        const shouldRender = currentWeapon?.weaponEffect === 'runeSword'
            && spritePresented
            && !player.isDodging
            && !this._mapModeActive;
        if (!shouldRender) {
            effect.deactivate();
            return;
        }

        const width = Math.max(1, Number(sprite.displayWidth) || 1);
        const height = Math.max(1, Number(sprite.displayHeight) || 1);
        const originX = Number.isFinite(sprite.originX) ? sprite.originX : 0.5;
        const originY = Number.isFinite(sprite.originY) ? sprite.originY : 0.5;
        const gripOffset = Number(WeaponAnimConfig.sword?.gripOffset) || 40;
        // grip-origin 分支的 sprite.x/y 已经是握柄；中心-origin 分支按同一 gripOffset 反推。
        const usesGripOrigin = Math.abs(originY - 0.5) > 0.0001;
        const gripNormX = 0.5;
        const gripNormY = usesGripOrigin ? originY : 0.5 + gripOffset / height;
        let localX = (gripNormX - originX) * width;
        let localY = (gripNormY - originY) * height;
        if (sprite.flipX) localX = -localX;
        if (sprite.flipY) localY = -localY;
        const rotation = Number(sprite.rotation) || 0;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const hiltX = sprite.x + localX * cos - localY * sin;
        const hiltY = sprite.y + localX * sin + localY * cos;

        const isAttacking = player.weaponAnim?.state !== 'idle';
        const isUsingSkill = player._isWhirlwind || player._whirlwindRecovering || player._isPushStrike || player._isDashing
            || player._specialAttackActive || player._runeSwordSpecialActive;
        effect.update(delta, {
            rotation,
            depth: (Number(sprite.depth) || 0) + 0.01,
            isMoving: player.isMoving,
            isInCombat: isAttacking || isUsingSkill,
            weaponAnimState: player.weaponAnim?.state || 'idle',
            x: player.x,
            y: player.y,
            hiltX,
            hiltY,
            mouseX: Input.mouse.x,
            mouseY: Input.mouse.y,
            screenToWorld: Renderer.screenToWorld.bind(Renderer),
        });
    }

      /**
       * 弧形刀光采样：把当前剑贴图的视觉中心/显示尺寸交给 SwordArcTrail。
       * 由其按时间间隔生成平滑弧形刀光。只应在攻击挥砍/冲刺位移期间调用。
       */
      _pushSwordAuraPose(size) {
          if (!this._swordArcTrail || !this.weaponSprite || !this.weaponSprite.visible) return;
          let centerX = this.weaponSprite.x;
          let centerY = this.weaponSprite.y;
          if (typeof this.weaponSprite.getCenter === 'function') {
              const center = this.weaponSprite.getCenter();
              if (center) {
                  centerX = center.x;
                  centerY = center.y;
              }
          }
            // 普通攻击 origin=中心；dashHand origin=剑柄。统一按 origin 反推视觉中心，
            // 不用 getCenter 的结果覆盖（不同 origin/旋转下口径可能有差异）。
            {
                const _w = this.weaponSprite.displayWidth || (size && size.width) || 1;
                const _h = this.weaponSprite.displayHeight || (size && size.height) || 1;
                const _ox = this.weaponSprite.originX !== undefined ? this.weaponSprite.originX : 0.5;
                const _oy = this.weaponSprite.originY !== undefined ? this.weaponSprite.originY : 0.5;
                const _lx = (0.5 - _ox) * _w;
                const _ly = (0.5 - _oy) * _h;
                const _cos = Math.cos(this.weaponSprite.rotation);
                const _sin = Math.sin(this.weaponSprite.rotation);
                centerX = this.weaponSprite.x + _lx * _cos - _ly * _sin;
                centerY = this.weaponSprite.y + _lx * _sin + _ly * _cos;
            }
          this._swordArcTrail.pushPose({
              x: centerX,
              y: centerY,
              rotation: this.weaponSprite.rotation,
              width: this.weaponSprite.displayWidth || (size && size.width) || 1,
              height: this.weaponSprite.displayHeight || (size && size.height) || 1,
                
          });
      }

    // ==================== 武器运动模糊（废弃的高斯滤镜路线，已停用） ====================
    // 2026-08-12：`filters.internal.addBlur`（Phaser 旧版高斯滤镜）在部分 GPU/浏览器下创建
    // WebGL framebuffer 失败（Framebuffer Unsupported）→ 整个渲染上下文崩溃黑屏。
    // 该路线早被 SKILL 标记"观感失败已废弃"（细长武器被摊薄消失），正式运动模糊 = 残影
    // （_syncWeaponGhosts）。以下两方法保留签名兼容调用点，但不再创建任何滤镜。
    _ensureWeaponBlur() {
        return null;
    }

    _applyWeaponBlur(_bx, _by) {
        return; // 废弃：高斯滤镜已停用（崩溃源），运动模糊由残影承担
    }

    /** 当前主手 Sprite 的真实剑尖；剑贴图竖向存放，局部顶部中心即剑尖。 */
    _getWeaponSpriteTipWorld(sprite = this.weaponSprite) {
        if (!sprite?.active) return null;
        const width = Math.max(1, Number(sprite.displayWidth) || 1);
        const height = Math.max(1, Number(sprite.displayHeight) || 1);
        const originX = Number.isFinite(Number(sprite.originX)) ? Number(sprite.originX) : 0.5;
        const originY = Number.isFinite(Number(sprite.originY)) ? Number(sprite.originY) : 0.5;
        const rotation = Number(sprite.rotation) || 0;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const localTipX = (0.5 - originX) * width * (sprite.flipX ? -1 : 1);
        const localTipY = -originY * height * (sprite.flipY ? -1 : 1);
        const x = sprite.x + localTipX * cos - localTipY * sin;
        const y = sprite.y + localTipX * sin + localTipY * cos;
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    /** 逻辑层只读入口：特殊攻击起手和持续伤害都从当前真实武器剑尖取源。 */
    getPlayerWeaponTipWorld() {
        return this._getWeaponSpriteTipWorld(this.weaponSprite);
    }

    _holdNightFlameReleaseFrame(player, startBeam = true) {
        if (!player?._specialAttackActive || player._specialAttackPhase !== 'windup') return false;
        const releaseFrame = Math.max(0, Math.floor(Number(player._specialAttackReleaseFrame) || 0));
        // 停掉 attack3 后显式贴回释放源帧：即使低帧率跨帧，也不会误定格在第 11 帧或末帧。
        this.playerSprite?.anims?.stop();
        if (this.playerSprite?.active) this.playerSprite.setFrame(releaseFrame);
        if (this.playerHandSprite?.active && this.playerHandSprite.visible) {
            try {
                this.playerHandSprite.setFrame(releaseFrame);
            } catch (_error) { /* 手层缺帧时只保留身体，避免阻断技能释放 */ }
        }
        player._specialAttackTimer = (Number(player._specialAttackAnimDuration) || 0)
            * Math.max(0, Math.min(1, Number(player._specialAttackReleaseProgress) || 0));
        if (!startBeam) return true;
        return player.specialAttackSystem?.startBeam?.() === true;
    }

    _syncNightFlameBeamOrigin(player) {
        if (!player?._specialAttackActive || !player._specialAttackBeam?.active) return;
        const tip = this._getWeaponSpriteTipWorld(this.weaponSprite);
        if (!tip) return;
        player._specialAttackOriginX = tip.x;
        player._specialAttackOriginY = tip.y;
        player._specialAttackBeam.setOrigin?.(tip.x, tip.y);
        // 光柱两层都放在真实武器之上，让剑尖汇聚光团覆盖贴图末端，
        // 不再按剑尖 y 自行估算深度。
        player._specialAttackBeam.setDepth?.(
            (Number(this.weaponSprite?.depth) || Number(this.playerSprite?.depth) || 0) + 0.25
        );
        if (player._specialAttackRangeEffect?.active) {
            player._specialAttackRangeEffect.setOrigin?.(tip.x, tip.y);
        }
    }

    // 统一的特殊动画武器同步（风车/冲刺/复位/特殊攻击）
    // 将 Canvas 变换链转换为世界坐标
    _syncSpecialWeaponAnim(player, wt, _weaponAnim) {
        const equippedItem = player._isPushStrike
            ? (player._pushStrikeWeaponItem || player.equipments[player.weaponMode])
            : ((player._specialAttackActive || player._specialResetAnim)
                ? (player._specialAttackWeaponItem || player.equipments[player.weaponMode])
                : player.equipments[player.weaponMode]);
        const equippedTexture = getWeaponTextureKey(equippedItem);
        if (!this.weaponSprite) {
            this.weaponSprite = this.add.sprite(0, 0, equippedTexture);
        } else if (this.weaponSprite.texture.key !== equippedTexture) {
            // 技能发动前一帧更换武器时，特殊分支也必须立即消费当前装备贴图。
            this.weaponSprite.setTexture(equippedTexture);
        }

        // 夜与火之剑复用普通连段第三段突刺及其 attack3 recover 曲线。
        // 人物身体是握柄轨迹与左右朝向的唯一权威：武器直接消费当前 attack3
        // 源帧的作者握点，不再绕人物中心旋转整条轨迹。光柱仍单独使用锁定射击角。
        const isNightFlameSpecial = wt === 'sword'
            && equippedItem?.specialAttackType === 'nightFlame'
            && (player._specialAttackActive || player._specialResetAnim);
        if (isNightFlameSpecial) {
            const facingRight = !this.playerSprite.flipX;
            if (player._specialAttackActive) {
                let releaseNow = false;
                const attackFrameCount = Math.max(
                    1, WeaponAnimConfig.sword?.attack3?.frames?.length || 16);
                let sourceFrame = null;
                if (player._specialAttackPhase === 'windup') {
                    const releaseFrame = Math.max(0,
                        Math.floor(Number(player._specialAttackReleaseFrame) || 0));
                    sourceFrame = this._getActiveMeleeSourceFrame(
                        attackFrameCount, 'attack_sword_3');
                    if (sourceFrame !== null && sourceFrame >= releaseFrame) {
                        this._holdNightFlameReleaseFrame(player, false);
                        releaseNow = true;
                    }
                }
                const duration = Math.max(1, Number(player._specialAttackAnimDuration) || 900);
                const progress = player._specialAttackPhase === 'beam' || releaseNow
                    ? Math.max(0, Math.min(1,
                        Number(player._specialAttackReleaseProgress) || 0))
                    : (sourceFrame !== null
                        ? sourceFrame / Math.max(1, attackFrameCount - 1)
                        : Math.max(0, Math.min(1,
                            (Number(player._specialAttackTimer) || 0) / duration)));
                const pose = WeaponTransform.getInterpolatedGripPerFramePosition(
                    player,
                    wt,
                    progress,
                    true,
                    'attack3',
                    'attack',
                    equippedTexture
                );
                if (pose) {
                    // 与普通 attack3 相同：位置/旋转按身体朝向镜像，origin 钉在真实剑柄。
                    // 这样即使动画分段变速，剑柄也不会比手部提前跑到下一帧。
                    this.weaponSprite.setOrigin(
                        facingRight ? pose.gripX : 1 - pose.gripX,
                        pose.gripY
                    );
                    this.weaponSprite.setPosition(
                        facingRight ? pose.x : 2 * player.x - pose.x,
                        pose.y
                    );
                    this.weaponSprite.setRotation(facingRight ? pose.rotation : -pose.rotation);
                    this.weaponSprite.setFlipX(!facingRight);
                    this.weaponSprite.setFlipY(false);
                    const size = WeaponTransform.getWeaponSize(wt, pose.scale, 'attack');
                    this.weaponSprite.setDisplaySize(
                        size.width * (pose.stretchX || 1),
                        size.height * (pose.stretchY || 1)
                    );
                    this.weaponSprite.setDepth(this.playerSprite.depth + 2);
                    this.weaponSprite.setVisible(!this._useCanvasWeapon);
                    this._hideWeaponGhosts();
                    if (releaseNow) {
                        player.specialAttackSystem?.startBeam?.();
                    }
                    return;
                }
            } else if (player._specialResetAnim) {
                const duration = Math.max(1, Number(player._specialResetAnim.duration) || 500);
                const clockProgress = Math.max(0, Math.min(1,
                    (nowMs() - player._specialResetAnim.startTime) / duration));
                const recoverAnims = this.playerSprite?.anims;
                const isRecoverPlaying = this._playerAnimKeyMatches(
                    recoverAnims?.currentAnim?.key, 'recover');
                const animationProgress = isRecoverPlaying && recoverAnims?.getProgress
                    ? Number(recoverAnims.getProgress())
                    : NaN;
                // 人物 recover 帧进度为真源：分帧时长或 timeScale 改变时，武器不再
                // 使用独立墙钟慢一拍。轻微 ease-out 前置回收，跟上身体收手而不跳帧。
                const bodyProgress = Number.isFinite(animationProgress)
                    ? Math.max(0, Math.min(1, animationProgress))
                    : clockProgress;
                const progress = 1 - Math.pow(1 - bodyProgress, 1.35);
                const baseStart = WeaponTransform.getAttackRecoverStartPosition(
                    player,
                    wt,
                    'attack3',
                    player._specialAttackReleaseProgress,
                    equippedTexture
                );
                if (baseStart) {
                    // recover 从定格前刺帧的同一个左/右镜像姿态起步，
                    // 不再从绕人物中心旋转后的假起点滑回 idle。
                    const start = facingRight
                        ? baseStart
                        : {
                            ...baseStart,
                            x: 2 * player.x - baseStart.x,
                            rotation: -baseStart.rotation,
                        };
                    const endLocal = WeaponTransform.getWeaponLocalOffset(
                        wt, player.size, false, false, 'idle', facingRight);
                    const end = WeaponTransform.localToWorld(
                        player, endLocal, 0, facingRight, 'idle', wt);
                    const endRotation = WeaponTransform.getWeaponRotation(
                        0, wt, 0, 'idle', facingRight);
                    const recoverPose = WeaponTransform.getAttackRecoverPose(
                        start,
                        { x: end.x, y: end.y, rotation: endRotation },
                        progress,
                        WeaponAnimConfig[wt]?.attack3?.recover,
                        facingRight
                    );
                    if (recoverPose) {
                        const startSize = WeaponTransform.getWeaponSize(wt, start.scale, 'attack');
                        const endSize = WeaponTransform.getWeaponSize(wt, null, 'idle');
                        const startWidth = startSize.width * (start.stretchX ?? 1);
                        const startHeight = startSize.height * (start.stretchY ?? 1);
                        const width = startWidth
                            + (endSize.width - startWidth) * recoverPose.sizeProgress;
                        const height = startHeight
                            + (endSize.height - startHeight) * recoverPose.sizeProgress;
                        const grip = WeaponTransform.getTextureGrip(
                            wt, equippedTexture, { width, height });
                        let gripLocalX = (grip.x - 0.5) * width;
                        const gripLocalY = (grip.y - 0.5) * height;
                        if (!facingRight) gripLocalX = -gripLocalX;
                        const gripCos = Math.cos(recoverPose.rotation);
                        const gripSin = Math.sin(recoverPose.rotation);
                        this.weaponSprite.setOrigin(
                            facingRight ? grip.x : 1 - grip.x,
                            grip.y
                        );
                        this.weaponSprite.setPosition(
                            recoverPose.x + gripLocalX * gripCos - gripLocalY * gripSin,
                            recoverPose.y + gripLocalX * gripSin + gripLocalY * gripCos
                        );
                        this.weaponSprite.setRotation(recoverPose.rotation);
                        this.weaponSprite.setFlipX(!facingRight);
                        this.weaponSprite.setFlipY(false);
                        this.weaponSprite.setDisplaySize(width, height);
                        this.weaponSprite.setDepth(this.playerSprite.depth + 2);
                        this.weaponSprite.setVisible(!this._useCanvasWeapon);
                        this._hideWeaponGhosts();
                        return;
                    }
                }
            }
        }

        const pushCfg = WeaponAnimConfig.pushStrike;
        if (player._isPushStrike && pushCfg) {
            const pushType = player._pushStrikeWeaponType || wt;
            const anchorFrames = Array.isArray(pushCfg.anchorFrames) ? pushCfg.anchorFrames : [];
            const progress = Math.max(0, Math.min(0.999999,
                (player._pushStrikeTimer || 0)
                    / Math.max(1, player._pushStrikeEffect?.animationDuration || pushCfg.durationMs || 800)));
            const sourceFrameCount = Math.max(1, Number(pushCfg.sourceFrameCount) || 9);
            const sourceFrame = this._getActiveMeleeSourceFrame(sourceFrameCount, 'push_strike');
            const playbackSequence = getPlayerAnimDef('push_strike')?.frameSequence;
            const fallbackStep = Array.isArray(playbackSequence) && playbackSequence.length
                ? Math.min(playbackSequence.length - 1, Math.floor(progress * playbackSequence.length))
                : 0;
            const fallbackSourceFrame = Array.isArray(playbackSequence) && playbackSequence.length
                ? Number(playbackSequence[fallbackStep])
                : 0;
            const anchorIndex = Math.max(0, Math.min(anchorFrames.length - 1,
                sourceFrame !== null && sourceFrame < anchorFrames.length
                    ? sourceFrame
                    : (Number.isFinite(fallbackSourceFrame) ? fallbackSourceFrame : 0)));
            const anchorFrame = anchorFrames[anchorIndex] || anchorFrames[0] || {};

            // 参考风车的 cos/sin 投影：手位严格读取当前离散人物帧；枪械按墙钟连续
            // 转入纵深。位置不跨人物帧插值，调转角/透视/裁切则每个渲染帧更新。
            const turnOutEnd = Math.max(0.05, Math.min(0.48, Number(pushCfg.turnOutEnd) || 0.36));
            const turnBackStart = Math.max(turnOutEnd, Math.min(0.95, Number(pushCfg.turnBackStart) || 0.64));
            const smoothStep = value => {
                const t = Math.max(0, Math.min(1, value));
                return t * t * (3 - 2 * t);
            };
            let turnAmount = 1;
            if (progress < turnOutEnd) {
                turnAmount = smoothStep(progress / turnOutEnd);
            } else if (progress > turnBackStart) {
                turnAmount = smoothStep((1 - progress) / Math.max(0.05, 1 - turnBackStart));
            }
            const turnAngle = Math.PI * turnAmount;
            const screenAxis = Math.cos(turnAngle);
            const depthAmount = Math.sin(turnAngle);
            const perspectiveMin = Math.max(0.01, Math.min(0.25,
                Number(pushCfg.perspectiveMin) || 0.04));
            const perspective = Math.max(perspectiveMin, Math.abs(screenAxis));
            const perspectiveHeightMin = Math.max(0.65, Math.min(1,
                Number(pushCfg.perspectiveHeightMin) || 0.82));
            const perspectiveHeight = perspectiveHeightMin
                + (1 - perspectiveHeightMin) * perspective;
            const depthBlendThreshold = Math.max(0, Math.min(0.4,
                Number(pushCfg.depthBlendThreshold) || 0.08));
            const pose = {
                ...anchorFrame,
                perspective,
                reverse: screenAxis < 0,
                depthPhase: depthAmount > depthBlendThreshold ? 'split' : 'front',
                depthValue: depthAmount * 0.2,
                frontRatio: Number(pushCfg.frontRatio) || 0.58,
                splitFromTip: pushCfg.splitFromTip === 'front' ? 'front' : 'back',
                splitAxis: 'x',
            };
            const facingRight = !this.playerSprite.flipX;
            const poseScale = Number(pose.scale) || 1;
            const size = WeaponTransform.getWeaponSize(pushType, null, 'idle');
            const pushDisplaySize = {
                width: size.height * ((this.weaponSprite.width || 1) / Math.max(1, this.weaponSprite.height || 1)),
                height: size.height,
            };
            const gripCfg = WeaponTransform.getTextureGrip(
                pushType,
                this.weaponSprite.texture.key,
                pushDisplaySize,
            );
            const gripX = Number.isFinite(Number(gripCfg.x)) ? Number(gripCfg.x) : 0.29;
            const gripY = Number.isFinite(Number(gripCfg.y)) ? Number(gripCfg.y) : 0.54;
            const buttContactX = Math.max(0, Math.min(0.2,
                Number(pushCfg.buttContactX) || 0.04));
            // 调转过程中把贴图挂点从扳机握把连续移到枪托接触点。世界挂点从后手
            // 切到前伸手的时刻落在枪身最窄处；之后相邻人物帧始终沿同一只前手推进。
            const mountX = gripX + (buttContactX - gripX) * turnAmount;
            const offsetX = Number(pose.offsetX) || 0;
            const offsetY = Number(pose.offsetY) || 0;
            const gripWorld = {
                x: this.playerSprite.x + (facingRight ? offsetX : -offsetX),
                y: this.playerSprite.y + offsetY,
            };
            this._gunGripWorld = gripWorld;
            let rotation = (facingRight ? 1 : -1) * (Number(pose.rotation) || 0) * Math.PI / 180;
            const gunRotOffset = (Number(WeaponAnimConfig[pushType]?.rotOffset) || 0) * Math.PI / 180;
            rotation += facingRight ? gunRotOffset : -gunRotOffset;
            this.weaponSprite.setOrigin(mountX, gripY);
            this.weaponSprite.setPosition(gripWorld.x, gripWorld.y);
            this.weaponSprite.setRotation(rotation);
            this.weaponSprite.setFlipX(false);
            this.weaponSprite.setFlipY(false);
            const idScale = Number(pushCfg.weaponIdProfiles?.[equippedItem?.weaponId]?.scale) || 1;
            const baseScale = (size.height / Math.max(1, this.weaponSprite.height)) * poseScale * idScale;
            const horizontalSign = (facingRight ? 1 : -1) * (pose.reverse ? -1 : 1);
            // 用带符号 scaleX 围绕同一 grip origin 连续翻面；不切换 flipX/origin，
            // 避免二维枪贴图在最窄透视处仍横跳一个握把长度。
            this.weaponSprite.setScale(
                baseScale * perspective * horizontalSign,
                baseScale * perspectiveHeight
            );
            this.weaponSprite.setVisible(true);
            this._hideWeaponGhosts();
            this._pushStrikeWeaponDepth?.apply(this.weaponSprite, {
                ...pose,
                depthValue: pose.depthPhase === 'front' ? 0.2 : (pose.depthPhase === 'back' ? -0.2 : 0),
            }, true);
            return;
        }

        // 风车逐帧握把/纵深轨迹：身体动画与武器贴图解耦，因此所有剑共用同一条
        // 手位轨迹，符文/骑士/夜与火仍保留各自游戏内贴图与绑定特效。
        const whirlwindCfg = wt === 'sword' ? WeaponAnimConfig.sword?.whirlwind : null;
        if (player._isWhirlwind && whirlwindCfg) {
            const duration = Math.max(1, player._whirlwindDuration || whirlwindCfg.durationMs || 800);
            const progress = Math.max(0, Math.min(0.999999, (player._whirlwindTimer || 0) / duration));
            const frameCount = Math.max(1, Number(whirlwindCfg.frameCount) || 23);
            // 风车身体允许通过 frameSequence 重复旋转源帧；武器直接跟随当前 textureFrame，
            // 使每一圈都复用同一组作者握柄/角度轨迹。动画不可用时才按技能墙钟回退。
            const sourceFrame = this._getActiveMeleeSourceFrame(frameCount, 'whirlwind');
            const frameIndex = sourceFrame !== null
                ? sourceFrame
                : Math.min(frameCount - 1, Math.floor(progress * frameCount));
            const lowerFrames = Math.max(0, Math.floor(Number(whirlwindCfg.lowerFrames) || 0));
            const riseFrames = Math.max(0, Math.floor(Number(whirlwindCfg.riseFrames) || 0));
            const spinFrames = Math.max(1, frameCount - lowerFrames - riseFrames);
            let theta = Math.PI * 2 * frameIndex / frameCount;
            let lowAmount = 0;
            if (lowerFrames + riseFrames > 0 && spinFrames < frameCount) {
                if (frameIndex < lowerFrames) {
                    const t = lowerFrames <= 1 ? 1 : frameIndex / (lowerFrames - 1);
                    lowAmount = t * t * (3 - 2 * t);
                    theta = 0;
                } else if (frameIndex < lowerFrames + spinFrames) {
                    const spinIndex = frameIndex - lowerFrames;
                    lowAmount = 1;
                    theta = (Number(whirlwindCfg.spinPhaseDeg) || 0) * Math.PI / 180
                        + Math.PI * 2 * spinIndex / spinFrames;
                } else {
                    const riseIndex = frameIndex - lowerFrames - spinFrames;
                    const t = riseFrames <= 1 ? 1 : riseIndex / (riseFrames - 1);
                    lowAmount = Math.pow(1 - t, 3);
                    theta = 0;
                }
            }
            const screenAxis = Math.cos(theta);
            const depthValue = Math.sin(theta);
            const splitAt = Number(whirlwindCfg.depthSplit) || 0.2;
            // H3 身体帧的双手不是规则圆周：位置/角度必须按当前离散身体帧钉住，
            // 不能在两帧之间插值，否则剑柄会提前离手。未配置帧仍回退到解析轨迹。
            const gripFrame = Array.isArray(whirlwindCfg.frames)
                ? whirlwindCfg.frames[frameIndex]
                : null;
            const gripOffsetX = Number.isFinite(Number(gripFrame?.offsetX))
                ? Number(gripFrame.offsetX)
                : (Number(whirlwindCfg.orbitX) || 19.21) * screenAxis;
            const gripOffsetY = Number.isFinite(Number(gripFrame?.offsetY))
                ? Number(gripFrame.offsetY)
                : (Number(whirlwindCfg.centerOffsetY) || -104.66)
                    + (Number(whirlwindCfg.bobY) || 1.51) * Math.cos(theta * 2)
                    + (Number(whirlwindCfg.dropY) || 0) * lowAmount;
            const gripRotation = Number.isFinite(Number(gripFrame?.rotation))
                ? Number(gripFrame.rotation)
                : (screenAxis >= 0 ? 90 : -90);
            const pose = {
                offsetX: gripOffsetX,
                offsetY: gripOffsetY,
                rotation: gripRotation,
                scale: Number(whirlwindCfg.scale) || 1.5,
                perspective: (Number(whirlwindCfg.perspectiveMin) || 0.3)
                    + (1 - (Number(whirlwindCfg.perspectiveMin) || 0.3)) * Math.abs(screenAxis),
                depthPhase: depthValue > splitAt ? 'front' : (depthValue < -splitAt ? 'back' : 'split'),
                depthValue,
                splitFromTip: screenAxis >= 0 ? 'front' : 'back',
            };
            const facingRight = !this.playerSprite.flipX;
            const scale = Number(pose.scale) || 1.5;
            const perspective = Math.max(0.24, Number(pose.perspective) || 1);
            const wSize = WeaponTransform.getWeaponSize(wt, scale, 'attack');
            const gripOffset = Number(WeaponAnimConfig.sword?.gripOffset) || 40;

            this.weaponSprite.setOrigin(0.5, 0.5 + gripOffset / Math.max(1, wSize.height));
            this.weaponSprite.setPosition(
                player.x + (facingRight ? pose.offsetX : -pose.offsetX),
                player.y + pose.offsetY
            );
            this.weaponSprite.setRotation(
                (facingRight ? pose.rotation : -pose.rotation) * Math.PI / 180
            );
            this.weaponSprite.setFlipX(!facingRight);
            this.weaponSprite.setFlipY(false);
            this.weaponSprite.setDisplaySize(
                wSize.width * (0.72 + 0.28 * perspective),
                wSize.height * perspective
            );
            this.weaponSprite.setVisible(!this._useCanvasWeapon);
            this._whirlwindWeaponDepth?.apply(
                this.weaponSprite,
                pose,
                !this._useCanvasWeapon && !this._mapModeActive
            );
            this._hideWeaponGhosts();
            return;
        }

        // 风车专属收势：从正式风车末帧的视觉中心直接缓慢回到 idle 中心。
        // 不再消费独立的 13 点抛物式握点轨迹，避免“把剑抛起再接回手中”的错觉。
        const whirlwindRecoverCfg = wt === 'sword' ? WeaponAnimConfig.sword?.whirlwindRecover : null;
        const recoverSourceCfg = wt === 'sword'
            ? WeaponAnimConfig.sword?.[whirlwindRecoverCfg?.source || 'whirlwind']
            : null;
        const whirlwindFrames = Array.isArray(recoverSourceCfg?.frames)
            ? recoverSourceCfg.frames
            : [];
        const recoverStartFrame = whirlwindFrames[whirlwindFrames.length - 1];
        if (player._whirlwindRecovering
            && whirlwindRecoverCfg?.type === 'toIdle'
            && recoverStartFrame) {
            const rawProgress = Math.max(0, Math.min(1,
                (player._whirlwindRecoverTimer || 0) / Math.max(1, player._whirlwindRecoverDuration || 520)
            ));
            const progress = whirlwindRecoverCfg.easing === 'linear'
                ? rawProgress
                : Easing.easeInOutCubic(rawProgress);
            const facingRight = !this.playerSprite.flipX;
            const startScale = Number(recoverStartFrame.scale)
                || Number(recoverSourceCfg.scale)
                || 1.5;
            const startSize = WeaponTransform.getWeaponSize(wt, startScale, 'attack');
            const gripOffset = Number(WeaponAnimConfig.sword?.gripOffset) || 40;
            const startRotation = (facingRight ? 1 : -1)
                * (Number(recoverStartFrame.rotation) || 0) * Math.PI / 180;
            const startGripX = player.x
                + (facingRight ? 1 : -1) * (Number(recoverStartFrame.offsetX) || 0);
            const startGripY = player.y + (Number(recoverStartFrame.offsetY) || 0);
            // 风车末帧以剑柄为 origin；先反推剑中心，确保 recover 首帧与上一帧像素级连续。
            const startCenterX = startGripX + Math.sin(startRotation) * gripOffset;
            const startCenterY = startGripY - Math.cos(startRotation) * gripOffset;

            const idleCenter = WeaponTransform.getWeaponWorldPosition(
                player,
                wt,
                false,
                false,
                'idle',
                {},
                facingRight
            );
            const idleRotation = WeaponTransform.getWeaponRotation(
                0,
                wt,
                0,
                'idle',
                facingRight
            );
            let rotationDelta = idleRotation - startRotation;
            rotationDelta = Math.atan2(Math.sin(rotationDelta), Math.cos(rotationDelta));
            const idleSize = WeaponTransform.getWeaponSize(wt, null, 'idle');

            this._whirlwindWeaponDepth?.clear(this.weaponSprite);
            this.weaponSprite.setOrigin(0.5, 0.5);
            this.weaponSprite.setPosition(
                startCenterX + (idleCenter.x - startCenterX) * progress,
                startCenterY + (idleCenter.y - startCenterY) * progress
            );
            this.weaponSprite.setRotation(startRotation + rotationDelta * progress);
            this.weaponSprite.setFlipX(!facingRight);
            this.weaponSprite.setFlipY(false);
            this.weaponSprite.setDisplaySize(
                startSize.width + (idleSize.width - startSize.width) * progress,
                startSize.height + (idleSize.height - startSize.height) * progress
            );
            this.weaponSprite.setDepth(this.playerSprite.depth + 2);
            this.weaponSprite.setVisible(!this._useCanvasWeapon);
            this._hideWeaponGhosts();
            return;
        }

        // 冲刺攻击：骑士长剑 dashAttackThrust 使用独立 dashThrustHand；
        // 其他武器继续使用原 dashHand / sword.dash 上劈下砍轨迹。
        // 末帧定格期（_dashRecoverAt）同轨迹停在 progress=1——定格姿态=冲刺末帧，与人物贴图一致
        const dashHandKey = player._dashVisualStyle === 'thrust' ? 'dashThrustHand' : 'dashHand';
        const dashHandCfg = (wt === 'sword' || wt === 'bow')
            && WeaponAnimConfig[wt] && WeaponAnimConfig[wt][dashHandKey];
        const dashTrackKey = dashHandCfg?.trackKey || 'dash';
        const dashCfg = (wt === 'sword' || wt === 'bow') && WeaponAnimConfig[wt] && WeaponAnimConfig[wt][dashTrackKey];
          // 冲刺攻击·剑柄锚手（dashHand 模式）：正式突刺直接消费逐帧握把点；
          // 旧 gripArc 仍可从中心轨迹反推。两者都以 origin=剑柄跟随人物手部。
          const dashHandActive = dashHandCfg && dashCfg && dashCfg.type === 'perFrame' && dashCfg.frames
              && (player._isDashing || player._dashRecoverAt);
        // 冲刺攻击 Lerp 模式（2026-08-12）：剑柄锚手 + 起始/结束双端点线性插值。
        // 剑柄（grip）钉在插值位置，剑身绕剑柄旋转；dashHand 优先，本路径仅作无 dashHand 配置时回退。
        const dashLerpCfg = (wt === 'sword' || wt === 'bow') && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].dashLerp;
        const dashLerpActive = dashLerpCfg && dashLerpCfg.type === 'lerp'
            && (player._isDashing || player._dashRecoverAt);
        if (this.weaponSprite && !dashLerpActive && !dashHandActive
            && (this.weaponSprite.originX !== 0.5 || this.weaponSprite.originY !== 0.5)) {
            // 非冲刺锚手状态：复位剑柄 origin（武器绕中心旋转的既有语义）
            this.weaponSprite.setOrigin(0.5, 0.5);
        }
                  if (dashHandActive) {
              const totalMs = player._dashTotalMs || 800;
              const progress = player._isDashing
                  ? Math.max(0, Math.min(1, (player._dashTimer || 0) / totalMs))
                  : 1;
              // 朝向=冲刺方向（dashDirection.x 符号；与人物 flipX 绑定同口径）
              const facingRight = player._dashDirection ? player._dashDirection.x >= 0 : !this.playerSprite.flipX;
              const hp = WeaponTransform.getDashHandPosition(player, wt, progress, dashHandKey);
              if (hp) {
                  // origin=剑柄点（翻转时 X 镜像），旋转绕剑柄 → 剑柄钉在反推手位、剑身绕手转
                  this.weaponSprite.setOrigin(facingRight ? hp.gripX : 1 - hp.gripX, hp.gripY);
                  const wx = facingRight ? hp.x : 2 * player.x - hp.x;
                  const wrot = facingRight ? hp.rotation : -hp.rotation;
                  this.weaponSprite.setPosition(wx, hp.y);
                  this.weaponSprite.setRotation(wrot);
                  this.weaponSprite.setFlipX(!facingRight);
                  const wSize = WeaponTransform.getWeaponSize(wt, hp.scale, 'attack');
                  this.weaponSprite.setDisplaySize(
                      wSize.width * (hp.stretchX || 1),
                      wSize.height * (hp.stretchY || 1)
                  );
                  if (player._isDashing) {
                      this._applyWeaponBlur(hp.blurX, hp.blurY);
                  } else if (this._weaponBlurFilter) {
                      this._weaponBlurFilter.strength = 0;
                  }
                  this.weaponSprite.setDepth(this.playerSprite.depth + 2);
                  this.weaponSprite.setVisible(!this._useCanvasWeapon);
                    if (player._isDashing) this._pushSwordAuraPose(wSize);
                  return;
              }
          }
          if (dashLerpActive) {
            const totalMs = player._dashTotalMs || 800;
            const progress = player._isDashing
                ? Math.max(0, Math.min(1, (player._dashTimer || 0) / totalMs))
                : 1;
            // 朝向=冲刺方向（dashDirection.x 符号；与人物 flipX 绑定同口径）
            const facingRight = player._dashDirection ? player._dashDirection.x >= 0 : !this.playerSprite.flipX;
            const lp = WeaponTransform.getLerpDashPosition(player, progress, facingRight, dashLerpCfg);
            if (lp) {
                const grip = lp.grip || { x: 0.5, y: 0.5 };
                // 剑柄锚手：origin=剑柄点（翻转时 X 镜像），旋转绕剑柄 → 剑柄钉在插值位置、剑身绕手转
                this.weaponSprite.setOrigin(facingRight ? grip.x : 1 - grip.x, grip.y);
                this.weaponSprite.setPosition(lp.x, lp.y);
                this.weaponSprite.setRotation(lp.rotation);
                this.weaponSprite.setFlipX(!facingRight);
                const wSize = WeaponTransform.getWeaponSize(wt, lp.scale, 'attack');
                this.weaponSprite.setDisplaySize(
                    wSize.width * (lp.stretchX || 1),
                    wSize.height * (lp.stretchY || 1)
                );
                if (player._isDashing) {
                    this._applyWeaponBlur(lp.blurX, lp.blurY);
                } else if (this._weaponBlurFilter) {
                    this._weaponBlurFilter.strength = 0;
                }
                this.weaponSprite.setVisible(!this._useCanvasWeapon);
                  if (player._isDashing) this._pushSwordAuraPose(wSize);
                return;
            }
        }
        if ((player._isDashing || player._dashRecoverAt) && dashCfg && dashCfg.type === 'perFrame' && dashCfg.frames) {
            const totalMs = player._dashTotalMs || 800;
            const progress = player._isDashing
                ? Math.max(0, Math.min(1, (player._dashTimer || 0) / totalMs))
                : 1;
            // 朝向=冲刺方向（dashDirection.x 符号；与人物 flipX 绑定同口径）
            const facingRight = player._dashDirection ? player._dashDirection.x >= 0 : !this.playerSprite.flipX;
            const pfPos = WeaponTransform.getInterpolatedPerFramePosition(player, wt, progress, true, 'dash');
            if (pfPos) {
                const wx = facingRight ? pfPos.x : 2 * player.x - pfPos.x;
                const wrot = facingRight ? pfPos.rotation : -pfPos.rotation;
                this.weaponSprite.setPosition(wx, pfPos.y);
                this.weaponSprite.setRotation(wrot);
                this.weaponSprite.setFlipX(!facingRight);
                const wSize = WeaponTransform.getWeaponSize(wt, pfPos.scale, 'attack');
                this.weaponSprite.setDisplaySize(
                    wSize.width * (pfPos.stretchX || 1),
                    wSize.height * (pfPos.stretchY || 1)
                );
                // 帧级运动模糊：仅在冲刺位移期间生效；末帧定格停顿（_dashRecoverAt）恢复原贴图不模糊
                const bx = pfPos.blurX || 0, by = pfPos.blurY || 0;
                if (player._isDashing) {
                    this._applyWeaponBlur(bx, by);
                } else {
                    if (this._weaponBlurFilter) this._weaponBlurFilter.strength = 0;
                }
                this.weaponSprite.setVisible(!this._useCanvasWeapon);
                  if (player._isDashing) this._pushSwordAuraPose(wSize);
                return;
            }
        }

        // 骑士长剑突刺专属收势：从 dashThrust 末帧沿配置贝塞尔回到 idle。
        // 普通冲刺不进入 _dashResetAnim，仍走原 dash_recover + dash 轨迹收势。
        if (player._dashResetAnim?.visualStyle === 'thrust' && wt === 'sword') {
            const elapsed = nowMs() - player._dashResetAnim.startTime;
            const duration = Math.max(1, player._dashResetAnim.duration || 500);
            const t = Math.max(0, Math.min(1, elapsed / duration));
            const facingRight = player._dashDirection
                ? player._dashDirection.x >= 0
                : !this.playerSprite.flipX;
            let start = WeaponTransform.getDashRecoverStartPosition(
                player,
                wt,
                'dashThrustHand'
            );
            if (start && !facingRight) {
                start.x = 2 * player.x - start.x;
                start.rotation = -start.rotation;
            }
            if (start) {
                const endLocal = WeaponTransform.getWeaponLocalOffset(
                    wt,
                    player.size,
                    false,
                    false,
                    'idle',
                    facingRight
                );
                const end = WeaponTransform.localToWorld(
                    player,
                    endLocal,
                    0,
                    facingRight,
                    'idle',
                    wt
                );
                const endRotation = WeaponTransform.getWeaponRotation(
                    0,
                    wt,
                    0,
                    'idle',
                    facingRight
                );
                const profile = WeaponAnimConfig[wt]?.dashThrust?.recover;
                const pose = WeaponTransform.getAttackRecoverPose(
                    start,
                    { x: end.x, y: end.y, rotation: endRotation },
                    t,
                    profile,
                    facingRight
                );
                let rotationDelta = endRotation - start.rotation;
                rotationDelta = Math.atan2(Math.sin(rotationDelta), Math.cos(rotationDelta));
                const recoverX = pose?.x ?? (start.x + (end.x - start.x) * t);
                const recoverY = pose?.y ?? (start.y + (end.y - start.y) * t);
                const recoverRotation = pose?.rotation ?? (start.rotation + rotationDelta * t);
                const sizeProgress = pose?.sizeProgress ?? t;
                const startSize = WeaponTransform.getWeaponSize(wt, start.scale, 'attack');
                const endSize = WeaponTransform.getWeaponSize(wt, null, 'idle');
                const startWidth = startSize.width * (start.stretchX ?? 1);
                const startHeight = startSize.height * (start.stretchY ?? 1);

                this.weaponSprite.setOrigin(0.5, 0.5);
                this.weaponSprite.setPosition(recoverX, recoverY);
                this.weaponSprite.setRotation(recoverRotation);
                this.weaponSprite.setFlipY(false);
                this.weaponSprite.setFlipX(!facingRight);
                this.weaponSprite.setDisplaySize(
                    startWidth + (endSize.width - startWidth) * sizeProgress,
                    startHeight + (endSize.height - startHeight) * sizeProgress
                );
                this.weaponSprite.setDepth(this.playerSprite.depth + 2);
                this.weaponSprite.setVisible(!this._useCanvasWeapon);
                this._hideWeaponGhosts();
                return;
            }
        }

        const wa = WEAPON_ANIM;
        const ms = wa.size * 0.75;
        const cos = Math.cos(player.rotation);
        const sin = Math.sin(player.rotation);
        
        // 基础偏移 (wa.holdX + 8, wa.holdY + 6) 在旋转坐标系中 → 世界坐标
        const baseX = wa.holdX + 8;
        const baseY = wa.holdY + 6;
        let worldX = player.x + cos * baseX - sin * baseY;
        let worldY = player.y + sin * baseX + cos * baseY;
        
        // 基础旋转 + 玩家旋转
        let rot = player.rotation + Math.PI / 2;
        
        // 武器方向（垂直于玩家朝向）
        const weaponDirX = -sin;
        const weaponDirY = cos;
        
        // 额外偏移和角度（根据特殊动画状态）
        let extraOffset = 0;
        let extraAngle = 0;
        
        if (player._isWhirlwind) {
            if (player._whirlwindTimer <= 50) {
                extraOffset = 15 * Easing.easeOutQuad(player._whirlwindTimer / 50);
            } else {
                extraOffset = 15;
            }
        } else if (player._isDashing) {
            const activeSkillId = player._dashSkillId
                || (player._getActiveDashSkillId ? player._getActiveDashSkillId() : null);
            const state = player.dashSystem && activeSkillId ? player.dashSystem._getDashWeaponStateAt(player._dashTimer, activeSkillId) : { dashOffset: 0, dashAngle: 0 };
            extraOffset = state.dashOffset || 0;
            extraAngle = state.dashAngle || 0;
        } else if (player._dashResetAnim) {
            const elapsed = nowMs() - player._dashResetAnim.startTime;
            // t 钳制 [0,1]：定格期（startTime 未来）保持攻击位；恢复窗口内**线性**滑回 idle 位并同步旋转
            const easeT = Math.max(0, Math.min(1, elapsed / player._dashResetAnim.duration));
            extraAngle = player._dashResetAnim.startAngle * (1 - easeT);
            extraOffset = player._dashResetAnim.startOffset * (1 - easeT);
            // 基础位置回位：攻击(-12, 17) -> 待机(-20, 11)
            const attackBaseX = wa.holdX + 8;
            const attackBaseY = wa.holdY + 6;
            const idleBaseX = wa.holdX;
            const idleBaseY = wa.holdY;
            const currentBaseX = attackBaseX + (idleBaseX - attackBaseX) * easeT;
            const currentBaseY = attackBaseY + (idleBaseY - attackBaseY) * easeT;
            worldX = player.x + cos * currentBaseX - sin * currentBaseY;
            worldY = player.y + sin * currentBaseX + cos * currentBaseY;
        } else if (player._specialResetAnim) {
            const elapsed = nowMs() - player._specialResetAnim.startTime;
            const t = Math.min(1, elapsed / player._specialResetAnim.duration);
            const easeT = Easing.easeOutQuart(t);
            extraAngle = player._specialResetAnim.startAngle * (1 - easeT);
            extraOffset = player._specialResetAnim.startOffset * (1 - easeT);
            const attackBaseX = wa.holdX + 8;
            const attackBaseY = wa.holdY + 6;
            const idleBaseX = wa.holdX;
            const idleBaseY = wa.holdY;
            const currentBaseX = attackBaseX + (idleBaseX - attackBaseX) * easeT;
            const currentBaseY = attackBaseY + (idleBaseY - attackBaseY) * easeT;
            worldX = player.x + cos * currentBaseX - sin * currentBaseY;
            worldY = player.y + sin * currentBaseX + cos * currentBaseY;
        } else if (player._specialAttackActive) {
            extraOffset = -15;
        }
        
        // 最终位置：基础位置 + 额外偏移 * 武器方向 - 武器中心偏移 * 武器方向
        const finalX = worldX + weaponDirX * (extraOffset - ms * 0.85);
        const finalY = worldY + weaponDirY * (extraOffset - ms * 0.85);
        const finalRot = rot + extraAngle;
        
        // 武器水平翻转：使用旋转镜像替代 setFlipX
        // const specialFlipX = Math.abs(player.rotation) >= Math.PI / 2;
        // this.weaponSprite.setFlipX(specialFlipX);
        
        const wSize = WeaponTransform.getWeaponSize(wt);
        const isGunSpecial = GUN_FAMILY.includes(wt); // 2026-08-13 收口：原内联数组漏 beretta93r，R93 缩放应走 setScale/flipY 分支
        if (isGunSpecial) {
            this.weaponSprite.setScale(wSize.height / this.weaponSprite.height);
            const flipY = Math.abs(finalRot) > Math.PI / 2;
            this.weaponSprite.setFlipY(flipY);
        } else {
            this.weaponSprite.setDisplaySize(wSize.width, wSize.height);
        }
        this.weaponSprite.setPosition(finalX, finalY);
        this.weaponSprite.setRotation(finalRot);
        this.weaponSprite.setVisible(true);
    }
    
    /**
     * 添加墙壁碰撞体
     */
    addWall(x, y, width, height) {
        const wall = this.add.rectangle(x, y, width, height, 0x000000, 0);
        this.physics.add.existing(wall, true);
        this.walls.add(wall);
    }

    /**
     * 创建粒子特效
     */
    createParticles(x, y, config = {}) {
        const particles = this.add.particles(x, y, config.texture || 'particle', {
            speed: config.speed || 100,
            scale: { start: config.scaleStart || 1, end: 0 },
            lifespan: config.lifespan || 500,
            quantity: config.quantity || 10,
            blendMode: 'ADD',
        });
        return particles;
    }

    /**
     * 预生成僵尸受击绿色粒子纹理
     */
    /**
     * 预生成眩晕星星纹理（四角星，亮黄色）
     */
    _ensureStunStarTexture() {
        if (this.textures.exists('stun_star')) return;
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffe060, 1);
        g.beginPath();
        g.moveTo(8, 0);
        g.lineTo(10, 6);
        g.lineTo(16, 8);
        g.lineTo(10, 10);
        g.lineTo(8, 16);
        g.lineTo(6, 10);
        g.lineTo(0, 8);
        g.lineTo(6, 6);
        g.closePath();
        g.fillPath();
        g.generateTexture('stun_star', 16, 16);
        g.destroy();
    }

    /**
     * 眩晕动画特效：两颗星星在眩晕实体贴图头顶旋转，
     * 眩晕持续时间内播放，结束后自动消失（含实体失效的兜底清理）
     */
    _syncStunEffects(_game) {
        if (!_game || !_game.entities) return;
        if (!this._stunFx) this._stunFx = new Map();
        const isMapMode = SceneManager.currentScene === 'scene7' && DungeonMapSystem && DungeonMapSystem.active && DungeonMapSystem.state === 'map';
        if (isMapMode) {
            for (const [, fx] of this._stunFx.entries()) this._destroyStunFx(fx);
            this._stunFx.clear();
            return;
        }
        if (!this.textures.exists('stun_star')) this._ensureStunStarTexture();
        const now = performance.now();
        const active = this._stunActiveEntities || (this._stunActiveEntities = new Set());
        active.clear();
        // 单个实体的双星处理（怪物贴图 _phaserSprite；玩家贴图挂 this.playerSprite，单独传入）
        const process = (e, sprite) => {
            if (!e || !e.active || !sprite || !sprite.active) return;
            const stunned = typeof e.hasStatusEffect === 'function' && e.hasStatusEffect('stun');
            if (!stunned) return;
            active.add(e);
            let fx = this._stunFx.get(e);
            if (!this._isEntityInRenderViewport(e)) {
                this._setViewportVisualRecordHidden(fx, true);
                return;
            }
            this._setViewportVisualRecordHidden(fx, false);
            if (!fx) {
                const s1 = this.add.sprite(0, 0, 'stun_star');
                const s2 = this.add.sprite(0, 0, 'stun_star');
                s1.setScale(1.2);
                s2.setScale(1.2);
                fx = { s1, s2, angle: Math.random() * Math.PI * 2 };
                this._stunFx.set(e, fx);
            }
            // 双星绕头顶旋转（Y 按平面透视压缩），带轻微上下浮动
            fx.angle += 0.05;
            const headY = sprite.y - sprite.displayHeight / 2 - 8;
            const bob = Math.sin(now / 300) * 3;
            const r = 26;
            const x1 = sprite.x + Math.cos(fx.angle) * r;
            const y1 = headY + Math.sin(fx.angle) * r * PERSPECTIVE_SCALE_Y + bob;
            const x2 = sprite.x + Math.cos(fx.angle + Math.PI) * r;
            const y2 = headY + Math.sin(fx.angle + Math.PI) * r * PERSPECTIVE_SCALE_Y + bob;
            fx.s1.setPosition(x1, y1).setDepth(headY + 1001).setVisible(true);
            fx.s2.setPosition(x2, y2).setDepth(headY + 1001).setVisible(true);
        };
        _game.entities.forEach(e => process(e, e && e._phaserSprite));
        // 玩家被眩晕：同款双星（贴图挂 this.playerSprite）
        process(_game.player, this.playerSprite);
        // 眩晕结束/实体失效：销毁特效
        for (const [e, fx] of this._stunFx.entries()) {
            if (!active.has(e)) {
                this._destroyStunFx(fx);
                this._stunFx.delete(e);
            }
        }
    }

    _destroyStunFx(fx) {
        if (fx.s1 && fx.s1.active) fx.s1.destroy();
        if (fx.s2 && fx.s2.active) fx.s2.destroy();
    }

    /**
     * 预生成冻结冰块纹理（半透明蓝色方块 + 裂纹）
     */
    _ensureIceBlockTexture() {
        if (this.textures.exists('ice_block')) return;
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        const w = 64, h = 64;
        // 冰块主体：半透明蓝
        g.fillStyle(0x7ab8e0, 0.55);
        g.fillRect(0, 0, w, h);
        // 高亮边框
        g.lineStyle(3, 0xa0d8ff, 0.9);
        g.strokeRect(0, 0, w, h);
        // 裂纹
        g.lineStyle(2, 0xffffff, 0.6);
        g.beginPath();
        g.moveTo(12, 18);
        g.lineTo(26, 30);
        g.lineTo(22, 46);
        g.moveTo(42, 14);
        g.lineTo(38, 28);
        g.lineTo(52, 38);
        g.strokePath();
        g.generateTexture('ice_block', w, h);
        g.destroy();
    }

    /**
     * 冻结动画特效：半透明冰块覆盖在冻结实体上，
     * 冻结持续时间内跟随目标，结束后自动消失（含实体失效的兜底清理）
     */
    _syncFreezeEffects(_game) {
        if (!_game || !_game.entities) return;
        if (!this._freezeFx) this._freezeFx = new Map();
        const isMapMode = SceneManager.currentScene === 'scene7' && DungeonMapSystem && DungeonMapSystem.active && DungeonMapSystem.state === 'map';
        if (isMapMode) {
            for (const [, fx] of this._freezeFx.entries()) this._destroyFreezeFx(fx);
            this._freezeFx.clear();
            return;
        }
        if (!this.textures.exists('ice_block')) this._ensureIceBlockTexture();
        const active = this._freezeActiveEntities || (this._freezeActiveEntities = new Set());
        active.clear();
        const process = (e, sprite) => {
            if (!e || !e.active || !sprite || !sprite.active) return;
            const frozen = typeof e.hasStatusEffect === 'function' && e.hasStatusEffect('frozen');
            if (!frozen) return;
            active.add(e);
            let fx = this._freezeFx.get(e);
            if (!this._isEntityInRenderViewport(e)) {
                this._setViewportVisualHidden(fx?.block, true);
                return;
            }
            this._setViewportVisualHidden(fx?.block, false);
            if (!fx) {
                const block = this.add.sprite(0, 0, 'ice_block');
                fx = { block };
                this._freezeFx.set(e, fx);
            }
            const w = (sprite.displayWidth || 32) * 1.1;
            const h = (sprite.displayHeight || 32) * 1.15;
            fx.block.setPosition(sprite.x, sprite.y);
            fx.block.setDisplaySize(w, h);
            fx.block.setDepth((typeof sprite.depth === 'number' ? sprite.depth : 0) + 0.5);
            fx.block.setVisible(true);
            fx.block.setAlpha(0.75);
        };
        _game.entities.forEach(e => process(e, e && e._phaserSprite));
        // 玩家被冻结：冰块挂在 this.playerSprite 上
        process(_game.player, this.playerSprite);
        // 冻结结束/实体失效：销毁特效
        for (const [e, fx] of this._freezeFx.entries()) {
            if (!active.has(e)) {
                this._destroyFreezeFx(fx);
                this._freezeFx.delete(e);
            }
        }
    }

    _destroyFreezeFx(fx) {
        if (fx.block && fx.block.active) fx.block.destroy();
    }

    /**
     * 石化表现合同：不切换待机或专用石像图，而是停在受击当刻的动画帧。
     * WebGL Filter 全局禁用时使用普通填充 tint，避免为每个单位创建离屏缓冲。
     */
    _syncPetrifyEffects(_game) {
        if (!_game) return;
        if (!this._petrifyFx) this._petrifyFx = new Map();
        const activeEntities = new Set();
        const process = (entity, sprites) => {
            if (!entity || entity.active === false || !entity.hasStatusEffect?.('petrified')) return;
            const currentSprites = new Set((sprites || []).filter(sprite => sprite?.active));
            if (!currentSprites.size) return;
            activeEntities.add(entity);
            let fx = this._petrifyFx.get(entity);
            if (!fx) {
                fx = { sprites: new Map() };
                this._petrifyFx.set(entity, fx);
            }
            for (const [sprite, record] of fx.sprites) {
                if (currentSprites.has(sprite) && sprite.active) continue;
                this._removePetrifySpriteEffect(record);
                fx.sprites.delete(sprite);
            }
            for (const sprite of currentSprites) {
                let record = fx.sprites.get(sprite);
                if (!record) {
                    const wasPlaying = !!sprite.anims?.isPlaying;
                    const wasPaused = !!sprite.anims?.isPaused;
                    let filter = null;
                    const tintState = {
                        isTinted: !!sprite.isTinted,
                        tintMode: sprite.tintMode,
                        topLeft: sprite.tintTopLeft,
                        topRight: sprite.tintTopRight,
                        bottomLeft: sprite.tintBottomLeft,
                        bottomRight: sprite.tintBottomRight,
                    };
                    const tintApplied = !filter
                        && typeof sprite.setTint === 'function'
                        && typeof sprite.setTintMode === 'function';
                    if (tintApplied) sprite.setTint(0x8f969c).setTintMode(TintModes.FILL);
                    record = { sprite, filter, tintApplied, tintState, wasPlaying, wasPaused };
                    fx.sprites.set(sprite, record);
                }
                sprite.anims?.pause?.();
            }
        };

        process(_game.player, [
            this.playerSprite,
            this.playerTorsoSprite,
            this.playerArmSprite,
            this.playerSupportArmSprite,
            this.playerFiringHandSprite,
            this.playerHandSprite,
            this.weaponSprite,
            this.offhandWeaponSprite,
            this.shieldSprite,
            this._playerShieldRig?.upperSprite,
            this._playerShieldRig?.forearmSprite,
            this._playerShieldRig?.mainArmSprite,
            this._swordShieldMotion?.handSprite,
        ]);
        _game.entities?.forEach?.(entity => process(entity, [entity?._phaserSprite]));
        for (const member of PartySystem?.members || []) {
            process(member, [this._companionSprites?.[member.id]]);
        }
        for (const friendly of _game.friendlyUnits || []) {
            process(friendly, [this._companionSprites?.[friendly.id], friendly?._phaserSprite]);
        }

        for (const [entity, fx] of this._petrifyFx) {
            if (activeEntities.has(entity)) continue;
            for (const record of fx.sprites.values()) this._removePetrifySpriteEffect(record);
            this._petrifyFx.delete(entity);
        }
    }

    _removePetrifySpriteEffect(record) {
        const sprite = record?.sprite;
        if (!sprite?.active) return;
        try {
            if (record.filter) sprite.filters?.internal?.remove?.(record.filter);
        } catch (_error) {
            // Sprite 销毁时 Phaser 会自行回收其滤镜链。
        }
        if (record.tintApplied) {
            const state = record.tintState;
            if (state?.isTinted) {
                sprite.setTint?.(
                    state.topLeft,
                    state.topRight,
                    state.bottomLeft,
                    state.bottomRight
                );
                if (Number.isFinite(state.tintMode)) sprite.setTintMode?.(state.tintMode);
            } else {
                sprite.clearTint?.();
            }
        }
        if (record.wasPlaying && !record.wasPaused && sprite.anims?.currentAnim) {
            sprite.anims.resume?.();
        }
    }

    /**
     * 确保冰墙贴图存在：4 个冰晶簇变体 + 地面霜斑 + 碎冰屑
     * 用 canvas 2D 渐变绘制（Graphics.generateTexture 不支持 fillGradientStyle 渲出渐变）
     */
    _ensureIceWallTexture() {
        if (!this.textures.exists('ice_wall_segment_0')) {
            const W = 64, H = 80;
            // 种子随机：每个变体布局固定，避免每次启动墙形不同
            const mulberry32 = (seed) => () => {
                seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
                let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
            for (let v = 0; v < 4; v++) {
                const tex = this.textures.createCanvas(`ice_wall_segment_${v}`, W, H);
                const ctx = tex.getContext();
                const rand = mulberry32(1000 + v * 77);
                const baseY = H - 5;

                // 底座：深蓝冰坨（上半椭圆）
                const baseGrad = ctx.createLinearGradient(0, baseY - 12, 0, H);
                baseGrad.addColorStop(0, 'rgba(46,107,143,0.95)');
                baseGrad.addColorStop(1, 'rgba(18,46,66,0.95)');
                ctx.fillStyle = baseGrad;
                ctx.beginPath();
                ctx.ellipse(W / 2, baseY + 2, W * 0.45, 11, 0, Math.PI, 0);
                ctx.fill();

                // 晶柱参数：中央最高、两侧渐低、随机倾斜
                const defs = [];
                const n = 5;
                for (let s = 0; s < n; s++) {
                    const u = s / (n - 1);                              // 0..1 左→右
                    const centerBoost = Math.max(0.2, 1 - Math.abs(u - 0.5) * 1.5);
                    defs.push({
                        bx: W * (0.12 + 0.76 * u) + (rand() - 0.5) * 6,
                        bw: 6 + rand() * 4,
                        h: H * (0.42 + 0.5 * centerBoost) + (rand() - 0.5) * 10,
                        lean: (rand() - 0.5) * 10,
                    });
                }
                // 先矮后高绘制，中央晶柱压在最前
                defs.sort((a, b) => a.h - b.h);
                for (const d of defs) {
                    const apexY = baseY - d.h;
                    // 主体：深蓝 → 亮蓝 → 尖顶近白 竖向渐变
                    const grad = ctx.createLinearGradient(0, baseY, 0, apexY);
                    grad.addColorStop(0, 'rgba(29,78,110,0.96)');
                    grad.addColorStop(0.55, 'rgba(90,168,216,0.92)');
                    grad.addColorStop(1, 'rgba(224,244,255,0.98)');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.moveTo(d.bx - d.bw, baseY);
                    ctx.lineTo(d.bx + d.bw, baseY);
                    ctx.lineTo(d.bx + d.bw * 0.75 + d.lean * 0.4, baseY - d.h * 0.55);
                    ctx.lineTo(d.bx + d.lean, apexY);
                    ctx.lineTo(d.bx - d.bw * 0.75 + d.lean * 0.4, baseY - d.h * 0.55);
                    ctx.closePath();
                    ctx.fill();
                    // 右侧暗面（晶体棱面立体感）
                    ctx.fillStyle = 'rgba(16,44,66,0.35)';
                    ctx.beginPath();
                    ctx.moveTo(d.bx + d.lean, apexY);
                    ctx.lineTo(d.bx + d.bw * 0.75 + d.lean * 0.4, baseY - d.h * 0.55);
                    ctx.lineTo(d.bx + d.bw, baseY);
                    ctx.lineTo(d.bx + d.lean * 0.6, baseY);
                    ctx.closePath();
                    ctx.fill();
                    // 左棱高光
                    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(d.bx - d.bw * 0.75 + d.lean * 0.4, baseY - d.h * 0.55);
                    ctx.lineTo(d.bx + d.lean, apexY);
                    ctx.stroke();
                    // 内部裂纹
                    if (rand() > 0.35) {
                        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
                        ctx.lineWidth = 0.8;
                        const cx0 = d.bx + (rand() - 0.5) * d.bw;
                        const cy0 = baseY - d.h * (0.2 + rand() * 0.3);
                        ctx.beginPath();
                        ctx.moveTo(cx0, cy0);
                        ctx.lineTo(cx0 + (rand() - 0.5) * 8, cy0 - 8 - rand() * 8);
                        ctx.lineTo(cx0 + (rand() - 0.5) * 10, cy0 - 16 - rand() * 6);
                        ctx.stroke();
                    }
                }

                // 根部碎冰渣
                ctx.fillStyle = 'rgba(160,216,255,0.8)';
                for (let k = 0; k < 4; k++) {
                    const sx = W * (0.15 + rand() * 0.7), sy = baseY + 2 + rand() * 3, r = 1 + rand() * 2;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy - r);
                    ctx.lineTo(sx + r, sy);
                    ctx.lineTo(sx, sy + r * 0.6);
                    ctx.lineTo(sx - r, sy);
                    ctx.closePath();
                    ctx.fill();
                }
                tex.refresh();
            }
        }
        // 地面霜斑：竖向压扁的径向渐变椭圆
        if (!this.textures.exists('ice_wall_frost')) {
            const tex = this.textures.createCanvas('ice_wall_frost', 96, 48);
            const ctx = tex.getContext();
            ctx.save();
            ctx.translate(48, 24);
            ctx.scale(1, 0.5);
            const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 46);
            g.addColorStop(0, 'rgba(200,236,255,0.5)');
            g.addColorStop(0.5, 'rgba(160,216,255,0.22)');
            g.addColorStop(1, 'rgba(160,216,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(-48, -48, 96, 96);
            ctx.restore();
            tex.refresh();
        }
        // 碎冰屑粒子贴图
        if (!this.textures.exists('ice_shard')) {
            const tex = this.textures.createCanvas('ice_shard', 10, 10);
            const ctx = tex.getContext();
            ctx.fillStyle = 'rgba(224,244,255,1)';
            ctx.beginPath();
            ctx.moveTo(5, 0); ctx.lineTo(10, 5); ctx.lineTo(5, 10); ctx.lineTo(0, 5);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(90,168,216,0.65)';
            ctx.beginPath();
            ctx.moveTo(5, 0); ctx.lineTo(10, 5); ctx.lineTo(5, 5);
            ctx.closePath(); ctx.fill();
            tex.refresh();
        }
    }

    /** 冰墙粒子贴图兜底：破土/碎裂用一次性 burstParticles（自带 impact_dot 保障），这里只需确保贴图存在 */
    _ensureIceWallFx() {
        if (!this.textures.exists('impact_dot')) this._ensureImpactDotTexture();
    }

    /** 单段墙的常驻寒气：低频白雾缓慢上飘（跟随墙段生灭） */
    _createIceWallMist() {
        return this.add.particles(0, 0, 'impact_dot', {
            emitting: false,
            speedY: { min: -22, max: -10 },
            speedX: { min: -6, max: 6 },
            lifespan: { min: 900, max: 1600 },
            scale: { start: 0.9, end: 0.15 },
            alpha: { start: 0.22, end: 0 },
            frequency: 240,
            tint: [0xc8ecff, 0xa0d8ff],
            blendMode: 'ADD',
        });
    }

    /**
     * 冰墙贴图随机池：segment_3（宽矮四柱）已按用户要求剔除，池 = segment_0/1/2/4；
     * 图片缺失时回退到程序生成的 segment_0~3。首次调用时缓存（贴图在 BootScene/懒生成后不变）。
     */
    _iceWallVariantKeys() {
        if (!this._iceWallVariantPool) {
            const preferred = ['ice_wall_segment_0', 'ice_wall_segment_1', 'ice_wall_segment_2', 'ice_wall_segment_4'];
            this._iceWallVariantPool = preferred.filter(k => this.textures.exists(k));
            if (this._iceWallVariantPool.length === 0) {
                this._iceWallVariantPool = [0, 1, 2, 3]
                    .filter(i => this.textures.exists(`ice_wall_segment_${i}`))
                    .map(i => `ice_wall_segment_${i}`);
            }
        }
        return this._iceWallVariantPool;
    }

    /**
     * 同步冰墙到 Phaser
     * 视觉分层：地面霜斑（最底）→ 冰晶簇 sprite（底部锚定，中心向两端 stagger 破土生长、
     * 半透明 0.6、贴图放大 1.25×、常驻呼吸微光、到期前 350ms 闪烁抖动预警）→ 寒气粒子。
     * 生长进度由 IceWallSystem 维护的 age / spawnDelay 推导；到期碎裂特效（冰屑/冰雾/冲击环）
     * 由逻辑层 IceWallSystem._shatter 直接触发，渲染层无消融动画。
     */
    _syncIceWalls(player) {
        if (!this._iceWallFx) this._iceWallFx = [];
        const isMapMode = SceneManager.currentScene === 'scene7' && DungeonMapSystem && DungeonMapSystem.active && DungeonMapSystem.state === 'map';
        if (isMapMode || !player || !player.iceWallSystem) {
            this._iceWallFx.forEach(fx => {
                if (fx.sprite && fx.sprite.active) fx.sprite.setVisible(false);
                if (fx.frost && fx.frost.active) fx.frost.setVisible(false);
                if (fx.mist && fx.mist.active) fx.mist.stop();
            });
            return;
        }

        const walls = player.iceWallSystem.getWalls();
        // 无条件调用：内部各贴图块自带存在性守卫（晶簇图片由 BootScene 预加载后会跳过程序生成，
        // 但霜斑/碎冰屑仍需这里生成）
        this._ensureIceWallTexture();
        this._ensureIceWallFx();

        // 按需扩展 fx 池（sprite + 霜斑 + 寒气发射器）
        while (this._iceWallFx.length < walls.length) {
            const sprite = this.add.sprite(0, 0, 'ice_wall_segment_0');
            sprite.setOrigin(0.5, 1);
            const frost = this.add.image(0, 0, 'ice_wall_frost');
            frost.setOrigin(0.5, 0.5);
            // 寒气发射器对象级降载：每 3 段才建一个（高等级 43 段 → 15 个发射器对象，
            // 只发射 1/3 时不再为其余段白白持有 emitter 对象）
            const mist = (this._iceWallFx.length % 3 === 0) ? this._createIceWallMist() : null;
            this._iceWallFx.push({ sprite, frost, mist, wall: null, burstDone: false });
        }
        // 回收多余 fx
        while (this._iceWallFx.length > walls.length) {
            const fx = this._iceWallFx.pop();
            if (fx.sprite && fx.sprite.active) fx.sprite.destroy();
            if (fx.frost && fx.frost.active) fx.frost.destroy();
            if (fx.mist && fx.mist.active) fx.mist.destroy();
        }

        const APPEAR_MS = 380;   // 破土生长时长
        const WARN_MS = 350;     // 碎裂前预警（闪烁抖动）时长，随后逻辑层移除并触发碎裂特效
        const BASE_ALPHA = 0.6;  // 冰体半透明度
        const SIZE_MUL = 1.25;   // 贴图放大系数
        const now = this.time.now;

        walls.forEach((w, i) => {
            const fx = this._iceWallFx[i];
            const s = fx.sprite;
            if (!s || !s.active) return;
            // 池位复用到新墙：重置状态，variant 经随机池映射贴图（池内无 segment_3）
            if (fx.wall !== w) {
                fx.wall = w;
                fx.burstDone = false;
                const pool = this._iceWallVariantKeys();
                s.setTexture(pool[(w.variant || 0) % pool.length]);
                if (fx.mist) fx.mist.setPosition(w.x, w.y - 4);
            }

            const t = (w.age || 0) - (w.spawnDelay || 0);   // 扣除 stagger 延迟后的生长时间
            // 生长进度（0→1，带回弹过冲）
            let grow = 1;
            if (t <= 0) {
                grow = 0;
            } else if (t < APPEAR_MS) {
                const p = t / APPEAR_MS;
                grow = Easing.easeOutQuart(p) * (1 + 0.15 * Math.sin(Math.PI * p));
                if (!fx.burstDone) {
                    fx.burstDone = true;
                    // 破土冰雾/碎冰屑：一次性 burstParticles——共享发射器同帧多段（对称段 stagger 相同）
                    // 会互相覆盖位置，一次性发射器各段独立、位置互不干扰
                    burstParticles({
                        texture: 'impact_dot', x: w.x, y: w.y - 4, count: 10, jitter: 8,
                        config: {
                            speed: { min: 30, max: 120 },
                            angle: { min: 200, max: 340 },
                            lifespan: { min: 350, max: 750 },
                            scale: { start: 1.6, end: 0.2 },
                            alpha: { start: 0.65, end: 0 },
                            tint: [0xffffff, 0xa0d8ff, 0x5aa8d8],
                            blendMode: 'ADD',
                        },
                        destroyAfterMs: 800, depth: w.y + 2,
                    });
                    burstParticles({
                        texture: 'ice_shard', x: w.x, y: w.y - 6, count: 6, jitter: 6,
                        config: {
                            speed: { min: 70, max: 200 },
                            angle: { min: 220, max: 320 },
                            gravityY: 520,
                            lifespan: { min: 450, max: 850 },
                            scale: { min: 0.5, max: 1.1 },
                            rotate: { min: -180, max: 180 },
                            alpha: { start: 1, end: 0.4 },
                        },
                        destroyAfterMs: 800, depth: w.y + 2,
                    });
                }
            }
            // 碎裂预警：最后 350ms 高频闪烁 + 微抖动（不塌缩，碎裂特效由逻辑层触发）
            const warn = w.remaining < WARN_MS;
            const warnFade = warn ? Math.max(0, w.remaining / WARN_MS) : 1;

            // 主 sprite：晶簇屏幕朝上直立，底部锚定 scaleY 生长；半透明度 0.6
            s.setPosition(w.x + (warn ? (Math.random() - 0.5) * 2.5 : 0), w.y);
            s.setRotation(0);
            // 每个视觉段按自己的接地面线落深度；动态单位消费同一面线做前后仲裁。
            // 同 y（横向墙）仍用中心微偏移堆成冰脊，不让整堵长墙共用单一极端 depth。
            const centerIdx = (walls.length - 1) / 2;
            const faceDepth = Number.isFinite(w._structureRenderDepth)
                ? w._structureRenderDepth
                : (Number.isFinite(w._faceDepth) ? w._faceDepth : w.y + 1);
            s.setDepth(faceDepth + (walls.length - Math.abs(i - centerIdx)) * 0.01);
            const scaleY = Math.max(0.001, grow);
            // 等比缩放：高度按技能配置 w.height×1.25，宽度随贴图纵横比自适应
            const texH = (s.frame && s.frame.height) || 320;
            s.setScale((w.height * SIZE_MUL * scaleY) / texH);
            // 呼吸微光（完全长成且未预警时）
            const breath = (t >= APPEAR_MS && !warn) ? 0.92 + 0.08 * Math.sin(now / 650 + i * 1.7) : 1;
            const warnFlicker = warn ? 0.55 + 0.45 * Math.abs(Math.sin(now / 45 + i)) : 1;
            s.setAlpha(BASE_ALPHA * Math.min(1, grow) * breath * warnFlicker);
            s.setVisible(scaleY > 0.01);

            // 地面霜斑：随墙同生共灭，宽度跟随实际贴图显示宽度，预警期同步衰减
            const f = fx.frost;
            if (f && f.active) {
                const fg = Math.min(1, grow * 1.4);
                const fw = Math.max(w.width * 2.1, s.displayWidth * 1.15);
                f.setPosition(w.x, w.y);
                f.setDepth(w.y - 1);
                f.setDisplaySize(fw * (0.55 + 0.45 * fg), fw * 0.5 * (0.55 + 0.45 * fg));
                f.setAlpha(0.6 * fg * warnFade);
                f.setVisible(fg > 0.02 && warnFade > 0);
            }

            // 常驻寒气：长成后持续上飘，预警期停止；高等级墙段数多时每 3 段才起一路，控制发射器总数
            const m = fx.mist;
            if (m && m.active) {
                const mistOn = (i % 3 === 0) && grow >= 0.8 && w.remaining > 120;
                if (mistOn && !m.emitting) m.start();
                else if (!mistOn && m.emitting) m.stop();
                m.setAlpha(0.9 * warnFade);
            }
        });
    }

    /**
     * 激励 buff 白色环绕光晕：持续时间内跟随目标，结束消失
     * 在目标脚下生成白色旋转光环（graphics 圆环 + 呼吸缩放）
     */
    _syncInspireEffects(_game) {
        if (!_game || !_game.entities) return;
        if (!this._inspireFx) this._inspireFx = new Map();
        const isMapMode = SceneManager.currentScene === 'scene7' && DungeonMapSystem && DungeonMapSystem.active && DungeonMapSystem.state === 'map';
        if (isMapMode) {
            for (const [, fx] of this._inspireFx.entries()) this._destroyInspireFx(fx);
            this._inspireFx.clear();
            return;
        }
        const active = this._inspireActiveEntities || (this._inspireActiveEntities = new Set());
        active.clear();
        const process = (e, sprite) => {
            if (!e || !e.active || !sprite || !sprite.active) return;
            const inspired = typeof e.hasStatusEffect === 'function' && e.hasStatusEffect('inspire');
            if (!inspired) return;
            active.add(e);
            let fx = this._inspireFx.get(e);
            if (!this._isEntityInRenderViewport(e)) {
                this._setViewportVisualHidden(fx?.gfx, true);
                return;
            }
            this._setViewportVisualHidden(fx?.gfx, false);
            if (!fx) {
                const g = this.add.graphics();
                fx = { gfx: g, angle: 0 };
                this._inspireFx.set(e, fx);
            }
            fx.angle += 0.03;
            const r = (e.groundRadius || e.collisionRadius || 20) + 8;
            const pulse = 1 + Math.sin(fx.angle * 3) * 0.15;
            // 光环放在脚下 footprint 位置（与阴影重叠），而不是实体中心
            const cx = e.collider ? e.collider.x : e.x;
            const cy = e.collider ? e.collider.y : e.y;
            fx.gfx.clear();
            fx.gfx.lineStyle(3, 0xffffff, 0.7 * pulse);
            fx.gfx.strokeEllipse(cx, cy, r * 2 * pulse, r * 2 * pulse * PERSPECTIVE_SCALE_Y);
            fx.gfx.lineStyle(1.5, 0xffffff, 0.4 * pulse);
            fx.gfx.strokeEllipse(cx, cy, r * 2.5 * pulse, r * 2.5 * pulse * PERSPECTIVE_SCALE_Y);
            // 图层在怪物贴图之下（怪物贴图 depth ≈ e.y + 10），可被遮挡
            fx.gfx.setDepth(cy + 5);
            fx.gfx.setVisible(true);
        };
        _game.entities.forEach(e => process(e, e && e._phaserSprite));
        process(_game.player, this.playerSprite);
        for (const member of PartySystem.members || []) {
            process(member, this._companionSprites?.[member.id]);
        }
        for (const [e, fx] of this._inspireFx.entries()) {
            if (!active.has(e)) {
                this._destroyInspireFx(fx);
                this._inspireFx.delete(e);
            }
        }
    }

    _destroyInspireFx(fx) {
        if (fx.gfx && fx.gfx.active) fx.gfx.destroy();
    }

    /** 红狼飞扑：保持原冲锋发烟时段/红烟风格，发射器附着当前帧的手爪。 */
    _syncRedWolfPounceSmoke(_game) {
        if (!_game?.entities) return;
        if (!this._redWolfPounceSmokeFx) {
            this._redWolfPounceSmokeFx = new Map();
            this.events.once('shutdown', () => {
                for (const fx of this._redWolfPounceSmokeFx?.values() || []) this._destroyRedWolfPounceSmoke(fx);
                this._redWolfPounceSmokeFx = null;
                this._redWolfPounceSmokeActive?.clear();
            });
        }
        const effects = this._redWolfPounceSmokeFx;
        const active = this._redWolfPounceSmokeActive || (this._redWolfPounceSmokeActive = new Set());
        active.clear();
        const isMapMode = SceneManager.currentScene === 'scene7'
            && DungeonMapSystem?.active && DungeonMapSystem.state === 'map';
        for (const enemy of _game.entities.values()) {
            const sprite = enemy?._phaserSprite;
            if (isMapMode || enemy?._pounceState !== 'charge' || !enemy.active || enemy._deathStarted
                || !sprite?.active || !sprite.visible || !this._isEntityInRenderViewport(enemy)) continue;
            const state = enemy._isTransformed ? 'werewolfPounce' : 'pounce';
            const anchors = enemy._animCfg?.animation?.pounceSmokeAnchors?.[state];
            const texture = enemy._isTransformed ? 'enemy_red_wolf_king_werewolf_pounce' : 'enemy_red_wolf_king_pounce';
            const frameIndex = Number(sprite.frame?.name);
            if (!anchors || sprite.texture?.key !== texture || !Number.isInteger(frameIndex)
                || sprite.frame.width !== anchors.frameWidth || sprite.frame.height !== anchors.frameHeight) continue;
            const points = anchors.frames[frameIndex];
            if (!points || !this.textures.exists('smoke_particle')) continue;
            active.add(enemy);
            let fx = effects.get(enemy);
            if (!fx) {
                const emitters = [0, 1].map(() => {
                    const emitter = this.add.particles(0, 0, 'smoke_particle', {
                        emitting: false, frequency: 65, quantity: 2,
                        speed: { min: 12, max: 48 }, angle: { min: 0, max: 360 },
                        scale: { start: 0.65, end: 1.9 }, alpha: { start: 0.58, end: 0 },
                        lifespan: { min: 460, max: 760 },
                        tint: [0x3b070b, 0x7d0d16, 0xb51c26, 0xd6403f], blendMode: 'NORMAL',
                    });
                    emitter.addToUpdateList();
                    return emitter;
                });
                fx = { emitters };
                effects.set(enemy, fx);
            }
            // Matrix includes the final position, scale, rotation and any parent transform.
            // Texture mirroring is separate from that matrix; apply it before origin subtraction.
            const matrix = sprite.getWorldTransformMatrix();
            const width = sprite.frame.width, height = sprite.frame.height;
            for (let hand = 0; hand < fx.emitters.length; hand++) {
                const emitter = fx.emitters[hand];
                const px = points[hand * 2], py = points[hand * 2 + 1];
                if (!Number.isFinite(px) || !Number.isFinite(py)) {
                    emitter.stop();
                    emitter.killAll();
                    emitter.setVisible(false);
                    continue;
                }
                const localX = (sprite.flipX ? width - px : px) - sprite.displayOriginX;
                const localY = (sprite.flipY ? height - py : py) - sprite.displayOriginY;
                const point = matrix.transformPoint(localX, localY);
                emitter.setPosition(point.x, point.y);
                emitter.setDepth(sprite.depth + (hand === 0 ? 0.08 : -0.06));
                emitter.setAlpha(sprite.alpha);
                emitter.setVisible(true);
                if (!emitter.emitting) emitter.start();
            }
        }
        for (const [enemy, fx] of effects) {
            if (active.has(enemy)) continue;
            this._destroyRedWolfPounceSmoke(fx);
            effects.delete(enemy);
        }
    }

    _destroyRedWolfPounceSmoke(fx) {
        for (const emitter of fx.emitters) {
            if (!emitter?.active) continue;
            emitter.stop();
            emitter.destroy();
        }
    }

    /**
     * 红狼王狼→狼人变身弥漫特效：脚下和腰部各一组红/黑软雾。
     * 红雾使用 ADD 增强能量感；黑雾必须 NORMAL，否则黑色 tint 在加法混合下不可见。
     */
    _createRedWolfTransformFx() {
        if (!this.textures.exists('smoke_particle')) return null;
        const create = (config) => this.add.particles(0, 0, 'smoke_particle', {
            emitting: false,
            quantity: 1,
            ...config,
        });
        const footRed = create({
            frequency: 42,
            speedX: { min: -52, max: 52 },
            speedY: { min: -36, max: -8 },
            scale: { start: 0.24, end: 0.78 },
            alpha: { start: 0.72, end: 0 },
            lifespan: { min: 620, max: 980 },
            tint: [0xff2a18, 0xd00000, 0x780000],
            blendMode: 'ADD',
        });
        const footBlack = create({
            frequency: 58,
            speedX: { min: -44, max: 44 },
            speedY: { min: -30, max: -6 },
            scale: { start: 0.30, end: 1.05 },
            alpha: { start: 0.52, end: 0 },
            lifespan: { min: 820, max: 1320 },
            tint: [0x030000, 0x110006, 0x26000d],
            blendMode: 'NORMAL',
        });
        const waistRed = create({
            frequency: 48,
            speedX: { min: -34, max: 34 },
            speedY: { min: -30, max: 24 },
            scale: { start: 0.18, end: 0.68 },
            alpha: { start: 0.68, end: 0 },
            lifespan: { min: 560, max: 900 },
            tint: [0xff311f, 0xc90000, 0x690000],
            blendMode: 'ADD',
        });
        const waistBlack = create({
            frequency: 64,
            speedX: { min: -30, max: 30 },
            speedY: { min: -24, max: 20 },
            scale: { start: 0.25, end: 0.92 },
            alpha: { start: 0.48, end: 0 },
            lifespan: { min: 760, max: 1220 },
            tint: [0x020000, 0x100005, 0x22000b],
            blendMode: 'NORMAL',
        });
        const emitters = [footBlack, footRed, waistBlack, waistRed];
        return { footRed, footBlack, waistRed, waistBlack, emitters };
    }

    _syncRedWolfTransformEffects(_game) {
        if (!_game?.entities) return;
        if (!this._redWolfTransformFx) this._redWolfTransformFx = new Map();
        const isMapMode = SceneManager.currentScene === 'scene7'
            && DungeonMapSystem?.active && DungeonMapSystem.state === 'map';
        if (isMapMode) {
            for (const fx of this._redWolfTransformFx.values()) this._destroyRedWolfTransformFx(fx);
            this._redWolfTransformFx.clear();
            return;
        }

        const active = this._redWolfTransformActiveEntities
            || (this._redWolfTransformActiveEntities = new Set());
        active.clear();
        for (const enemy of _game.entities.values()) {
            const sprite = enemy?._phaserSprite;
            if (!enemy?._isTransforming || !enemy.active || !sprite?.active) continue;
            active.add(enemy);
            let fx = this._redWolfTransformFx.get(enemy);
            if (!this._isEntityInRenderViewport(enemy)) {
                for (const emitter of fx?.emitters || []) {
                    this._setViewportVisualHidden(emitter, true);
                    if (emitter.emitting) emitter.stop();
                }
                continue;
            }
            if (!fx) {
                fx = this._createRedWolfTransformFx();
                if (!fx) continue;
                this._redWolfTransformFx.set(enemy, fx);
            }

            const total = Math.max(1, enemy._transformCfg?.duration ?? 2000);
            const progress = 1 - Math.max(0, enemy._transformTimer || 0) / total;
            const footX = enemy.collider?.x ?? enemy.x;
            const footY = (enemy.collider?.y ?? enemy.y) - 3;
            // 狼形腰线约在脚底上方44px；随直立过程平滑升到74px。
            const waistY = footY - (44 + progress * 30);
            const waistSway = Math.sin((this.time?.now || 0) / 170) * 2.5;
            fx.footRed.setPosition(footX, footY);
            fx.footBlack.setPosition(footX, footY + 1);
            fx.waistRed.setPosition(footX + waistSway, waistY);
            fx.waistBlack.setPosition(footX - waistSway, waistY + 2);

            // 跟随仲裁后的本体深度，偏移严格小于0.5，避免本体被墙压下时粒子穿墙。
            const depth = Number.isFinite(sprite.depth) ? sprite.depth : enemy.y + 10;
            fx.footBlack.setDepth(depth - 0.08);
            fx.waistBlack.setDepth(depth - 0.04);
            fx.footRed.setDepth(depth + 0.06);
            fx.waistRed.setDepth(depth + 0.08);

            const visible = sprite.visible !== false;
            for (const emitter of fx.emitters) {
                emitter.setVisible(visible);
                if (visible && !emitter.emitting) emitter.start();
                else if (!visible && emitter.emitting) emitter.stop();
            }
        }

        for (const [enemy, fx] of this._redWolfTransformFx.entries()) {
            if (active.has(enemy)) continue;
            this._destroyRedWolfTransformFx(fx);
            this._redWolfTransformFx.delete(enemy);
        }
    }

    _destroyRedWolfTransformFx(fx) {
        for (const emitter of fx?.emitters || []) {
            if (!emitter?.active) continue;
            emitter.stop();
            emitter.destroy();
        }
    }

    _ensureZombieHitTexture() {
        if (this.textures.exists('zombie_hit_dot')) return;
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0x55ff55, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture('zombie_hit_dot', 8, 8);
        g.destroy();
    }

    /**
     * 预生成白色粒子纹理（tint 乘算后呈现准确颜色；绿色纹理会被 tint 偏色）
     */
    _ensureImpactDotTexture() {
        if (this.textures.exists('impact_dot')) return;
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture('impact_dot', 8, 8);
        g.destroy();
    }

    /**
     * 播放僵尸类怪物受击绿色粒子
     * @param {number} x
     * @param {number} y
     * @param {number} [angle] 受击方向（弧度），未提供时随机散射
     */
    playZombieHitParticles(x, y, angle, tintColor = null, opts = null) {
        // 自定义颜色用白色纹理（tint 乘算准确显色）；默认绿色沿用原绿色纹理
        const useCustom = tintColor !== null && tintColor !== undefined;
        const texKey = useCustom ? 'impact_dot' : 'zombie_hit_dot';
        if (!this.textures.exists(texKey)) {
            if (useCustom) this._ensureImpactDotTexture(); else this._ensureZombieHitTexture();
        }
        // 速度/距离倍率（配置驱动，默认 1）：速度 ×speedMul，存活 ×distMul（同速度下活更久=飞更远）
        const speedMul = (opts && opts.speedMul) || 1;
        const distMul = (opts && opts.distMul) || 1;
        // 在 (0,0) 创建发射器，随后用 explode(x,y) 在世界坐标一次性爆发，
        // 避免把发射器位置与爆发坐标叠加导致粒子飞到屏幕外。
        const particles = this.add.particles(0, 0, texKey, {
            speed: { min: 80 * speedMul, max: 220 * speedMul },
            scale: { start: 1.4, end: 0 },
            lifespan: 600 * distMul,
            quantity: 12,
            tint: useCustom ? tintColor : 0x55ff55,
            blendMode: 'ADD',
            angle: angle != null ? { min: (angle * 180 / Math.PI) - 45, max: (angle * 180 / Math.PI) + 45 } : { min: 0, max: 360 },
            gravityY: 120,
            emitting: false
        });
        // 确保粒子会被更新（移动/死亡），否则只会在一帧静止
        particles.addToUpdateList();
        // 按爆发位置 Y 排序，并高于普通实体，确保可见
        particles.setDepth(y + 1000);
        particles.explode(12, x, y);
        // 短暂延迟后销毁发射器，避免内存泄漏（存活随 distMul 延长）
        this.time.delayedCall(Math.max(800, 600 * distMul + 200), () => {
            if (particles && particles.active) particles.destroy();
        });
    }

    /**
     * 播放黄褐色冲击粒子（集合体投掷物落点：比僵尸受击粒子更大更多，持续 1.5 秒）。
     * 与僵尸受击粒子同纹理，黄褐色 tint、2.0 起始缩放、20 颗、重力下坠。
     * @param {number} x 落点 X
     * @param {number} y 落点 Y
     */
    playTanImpactParticles(x, y) {
        if (!this.textures.exists('impact_dot')) this._ensureImpactDotTexture();
        const particles = this.add.particles(0, 0, 'impact_dot', {
            speed: { min: 100, max: 260 },
            scale: { start: 2.0, end: 0 },
            lifespan: 1500,
            quantity: 20,
            tint: 0xb8860b,
            blendMode: 'ADD',
            angle: { min: 0, max: 360 },
            gravityY: 120,
            emitting: false
        });
        particles.addToUpdateList();
        particles.setDepth(y + 1000);
        particles.explode(20, x, y);
        this.time.delayedCall(1800, () => {
            if (particles && particles.active) particles.destroy();
        });
    }

    /** 开火火光：枪口处黄白色高亮闪光（ADD 混合，120ms 放大淡出） */
    playMuzzleFire(x, y) {
        if (!this.textures.exists('impact_dot')) this._ensureImpactDotTexture();
        const particles = this.add.particles(0, 0, 'impact_dot', {
            speed: { min: 30, max: 90 },
            scale: { start: 1.6, end: 0 },
            lifespan: 140,
            quantity: 6,
            tint: 0xffcc55,
            blendMode: 'ADD',
            angle: { min: 0, max: 360 },
            emitting: false
        });
        particles.addToUpdateList();
        particles.setDepth(y + 1000);
        particles.explode(6, x, y);
        this.time.delayedCall(200, () => {
            if (particles && particles.active) particles.destroy();
        });
    }

    /**
     * 红色粒子下浮（斧头命中）：从目标绿色矩形碰撞体积上方 15% 区域生成并向下掉落，
     * 缓慢起始 + 重力加速，落到目标 footprint 椭圆最下方即消失
     */
    playRedFallParticles(x, y, target) {
        if (!this.textures.exists('impact_dot')) this._ensureImpactDotTexture();
        // 生成区域：绿色矩形（collisionWidth×collisionHeight）上方 15% 带状区中心
        const tH = (target && (target.collisionHeight || target.config?.render?.collisionHeight)) || 60;
        const tW = (target && (target.collisionWidth || target.config?.render?.collisionWidth)) || 40;
        const footY0 = (target && target.collider) ? target.collider.y : y;
        const bandCenterY = footY0 - tH * 0.925;
        const bandHalfH = tH * 0.075;
        // 边界保护：粒子生成位置钳制在世界范围内，防止在地图边界外生成
        const worldW = (typeof CONFIG !== 'undefined' && CONFIG.WORLD_WIDTH) || 4096;
        const worldH = (typeof CONFIG !== 'undefined' && CONFIG.WORLD_HEIGHT) || 4096;
        const rawSx = (target ? target.x : x) + (Math.random() - 0.5) * tW;
        const rawSy = bandCenterY + (Math.random() - 0.5) * 2 * bandHalfH;
        const sx = Math.max(0, Math.min(worldW, rawSx));
        const sy = Math.max(0, Math.min(worldH, rawSy));
        const particles = this.add.particles(0, 0, 'impact_dot', {
            // 起始慢速向下（大范围摆动），重力 500 拉出"由慢到快"的掉落感
            speed: { min: 30, max: 90 },
            angle: { min: 45, max: 135 },
            gravityY: 500,
            scale: { start: 1.4, end: 0.2 },
            alpha: { start: 0.9, end: 0 },
            lifespan: 1400,
            quantity: 9,
            frequency: 60,
            tint: 0xa00000, // 深红
            blendMode: 'ADD'
        });
        particles.addToUpdateList();
        particles.setDepth(y + 1000);
        // 死亡区：目标 footprint 椭圆最下方水平线以下（onEnter 即消失）
        const footY = (target && target.collider)
            ? target.collider.y + ((target.groundRadius || 22) * PERSPECTIVE_SCALE_Y)
            : y + 20;
        particles.addDeathZone({
            type: 'onEnter',
            source: { contains: (_px, py) => py >= footY }
        });
        particles.start();
        particles.emitParticleAt(sx, sy, 24);
        // 持续约 0.9s 发射后停止，1.5s 总寿命销毁
        this.time.delayedCall(900, () => { if (particles && particles.active) particles.stop(); });
        this.time.delayedCall(1500, () => { if (particles && particles.active) particles.destroy(); });
    }

    /**
     * 流血血渍（特工斧头同款红色粒子落地 + 地面保留 10s）：
     * 掉落视觉复用 playRedFallParticles；地面血渍为静态红色粒子（lifespan 10s，ADD 混合），
     * 每次流血 tick 在目标脚底生成一小片，10s 后自动销毁
     */
    playBleedGroundParticles(x, y, target) {
        // 地图模式（路线选择）下不生成：世界隐藏、相机错位，血渍会出现在屏幕上方
        if (this._mapModeActive) return;
        // 掉落视觉（同款红粒子下浮）
        this.playRedFallParticles(x, y, target);
        if (!this.textures.exists('impact_dot')) this._ensureImpactDotTexture();
        const footY = (target && target.collider) ? target.collider.y : y;
        // 边界保护：血渍生成位置钳制在世界范围内，防止在地图边界外生成
        const worldW = (typeof CONFIG !== 'undefined' && CONFIG.WORLD_WIDTH) || 4096;
        const worldH = (typeof CONFIG !== 'undefined' && CONFIG.WORLD_HEIGHT) || 4096;
        const splat = this.add.particles(0, 0, 'impact_dot', {
            speed: 0,
            scale: { start: 1.3, end: 0.8 },
            alpha: { start: 0.85, end: 0.25 },
            lifespan: 10000,
            tint: 0xa00000,
            blendMode: 'ADD',
            emitting: false
        });
        splat.addToUpdateList();
        splat.setDepth(footY + 1);
        // 发射器保持 (0,0)，explode 传世界坐标（Phaser 粒子坐标陷阱）
        for (let i = 0; i < 4; i++) {
            const px = Math.max(0, Math.min(worldW, x + (Math.random() - 0.5) * 60));
            const py = Math.max(0, Math.min(worldH, footY + (Math.random() - 0.5) * 14));
            splat.explode(1, px, py);
        }
        this.time.delayedCall(10500, () => { if (splat && splat.active) splat.destroy(); });
    }

    // ==================== BOSS 专属血条（屏幕空间 DOM） ====================
    /**
     * 创建/获取 BOSS 血条 DOM：位于顶部状态栏下方 20px，居中。
     * 仅在玩家攻击命中 Boss 时显示（showBossHpBar 触发），超时或 Boss 死亡自动隐藏。
     */
    _ensureBossHpBar() {
        if (this._bossHpBarEl) return this._bossHpBarEl;
        const topBar = document.getElementById('topBar');
        const topOffset = (topBar && topBar.offsetHeight ? topBar.offsetHeight : 44) + 20;
        const el = document.createElement('div');
        el.id = 'bossHpBar';
        el.style.cssText = `
            position: fixed; top: ${topOffset}px; left: 50%; transform: translateX(-50%);
            width: 520px; z-index: 5000; display: none; pointer-events: none;
            font-family: SimHei, "Microsoft YaHei", sans-serif;
        `;
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;">
                <span id="bossHpBarName" style="color:#e8c878;font-size:17px;font-weight:700;text-shadow:0 2px 6px #000;">☠ 首领</span>
                <span id="bossHpBarText" style="color:#d4c5a9;font-size:13px;text-shadow:0 1px 4px #000;"></span>
            </div>
            <div style="height:14px;background:rgba(10,5,5,0.85);border:2px solid #6a2a2a;border-radius:7px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.6);">
                <div id="bossHpBarFill" style="height:100%;width:100%;background:linear-gradient(90deg,#7a1a1a,#e04040);transition:width 0.15s;"></div>
            </div>
        `;
        document.body.appendChild(el);
        this._bossHpBarEl = el;
        return el;
    }

    /**
     * 玩家攻击命中 Boss 时调用：显示/刷新 BOSS 血条并重置 5 秒隐藏计时
     */
    showBossHpBar(boss) {
        if (!boss) return;
        const el = this._ensureBossHpBar();
        this._bossHpBarTarget = boss;
        this._bossHpBarHideTimer = 5000;
        const nameEl = el.querySelector('#bossHpBarName');
        if (nameEl) nameEl.textContent = `☠ ${boss.name || '首领'} · 首领`;
        this._syncBossHpBarFill();
        el.style.display = 'block';
    }

    _syncBossHpBarFill() {
        const boss = this._bossHpBarTarget;
        if (!boss || !this._bossHpBarEl) return;
        const maxHp = boss.maxHp || (boss.data && boss.data.maxHp) || 1;
        const hp = Math.max(0, (boss.hp !== undefined ? boss.hp : (boss.data ? boss.data.hp : maxHp)));
        const pct = Math.max(0, Math.min(1, hp / maxHp));
        const fill = this._bossHpBarEl.querySelector('#bossHpBarFill');
        if (fill) fill.style.width = `${(pct * 100).toFixed(1)}%`;
        const text = this._bossHpBarEl.querySelector('#bossHpBarText');
        if (text) text.textContent = `${Math.floor(hp)} / ${maxHp}`;
    }

    _updateBossHpBar(dt) {
        if (!this._bossHpBarTarget) return;
        const boss = this._bossHpBarTarget;
        // Boss 死亡/离场立即隐藏
        if (!boss.active || FogOfWarSystem.shouldHideEntity(SceneManager.getCurrentWorldId(), boss)) {
            this._hideBossHpBar();
            return;
        }
        this._syncBossHpBarFill();
        // 超时无新命中自动隐藏
        this._bossHpBarHideTimer -= dt;
        if (this._bossHpBarHideTimer <= 0) {
            this._hideBossHpBar();
        }
    }

    _hideBossHpBar() {
        if (this._bossHpBarEl) this._bossHpBarEl.style.display = 'none';
        this._bossHpBarTarget = null;
        this._bossHpBarHideTimer = 0;
    }

    /**
     * 预生成地牢刷怪黑色粒子纹理
     */
    _ensureDungeonSpawnTexture() {
        if (this.textures.exists('dungeon_spawn_dot')) return;
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0x000000, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture('dungeon_spawn_dot', 8, 8);
        g.destroy();
    }

    /**
     * 播放地牢刷怪黑色粒子（怪物脚下生成，持续 1.5 秒）。
     * 与僵尸受击粒子相比：速度更慢、持续更久、数量多 30%（12→16）、颜色纯黑。
     * 注意：纯黑粒子必须用 NORMAL 混合，ADD 模式下黑色不可见。
     * @param {number} x 怪物脚底 X
     * @param {number} y 怪物脚底 Y
     */
    playDungeonSpawnParticles(x, y) {
        if (!this.textures.exists('dungeon_spawn_dot')) this._ensureDungeonSpawnTexture();
        const particles = this.add.particles(0, 0, 'dungeon_spawn_dot', {
            speed: { min: 30, max: 90 },
            scale: { start: 1.6, end: 0 },
            lifespan: 1500,
            quantity: 16,
            tint: 0x000000,
            blendMode: 'NORMAL',
            angle: { min: 0, max: 360 },
            gravityY: -40,
            emitting: false
        });
        particles.addToUpdateList();
        particles.setDepth(y + 1000);
        particles.explode(16, x, y);
        // 粒子寿命 1.5 秒，随后销毁发射器，避免内存泄漏
        this.time.delayedCall(1600, () => {
            if (particles && particles.active) particles.destroy();
        });
    }

    /**
     * 统一触发怪物受击粒子（缺省绿色/僵尸同款；hitParticleColor 配置可覆盖，如集合体落地黄）
     * @param {object} target 被击中的目标
     * @param {object} [source] 伤害来源，用于计算受击方向
     */
    triggerZombieHitParticles(target, source) {
        if (!target || !target.config) return;
        const angle = source && target
            ? Math.atan2(target.y - source.y, target.x - source.x)
            : null;
        // 在受击目标朝向来源的一侧边缘生成特效，更贴近实际受击点
        // 优先使用配置的渲染尺寸计算半径，避免小 size 导致特效贴在中心
        const render = target.config?.render;
        let radius = target.collisionRadius;
        if (!radius && render) {
            radius = Math.max(render.collisionWidth || 0, render.collisionHeight || 0, render.spriteSize || 0) / 2;
        }
        if (!radius) radius = target.size || 12;
        // 粒子产生位置绑定受击实体的贴图中心（脚底上移 footOffsetY），不再以脚底为锚点
        const footOffsetY = target.footOffsetY ?? target.config?.render?.footOffsetY ?? 0;
        const centerY = target.y - footOffsetY;
        let hitX = target.x;
        let hitY = centerY;
        if (angle != null) {
            hitX = target.x - Math.cos(angle) * radius * 0.75;
            hitY = centerY - Math.sin(angle) * radius * 0.75;
        }
        // 受击粒子颜色：配置 hitParticleColor（如集合体落地黄），缺省绿色
        let tintColor = null;
        if (typeof target.config?.hitParticleColor === 'string') {
            const parsed = parseInt(target.config.hitParticleColor.replace('#', ''), 16);
            if (Number.isFinite(parsed)) tintColor = parsed;
        }
        // 粒子速度/距离倍率：配置 hitParticleSpeedMul / hitParticleDistMul（如骑士蓝色快粒子）
        const speedMul = target.config?.hitParticleSpeedMul ?? 1;
        const distMul = target.config?.hitParticleDistMul ?? 1;
        this.playZombieHitParticles(hitX, hitY, angle, tintColor, { speedMul, distMul });
    }

    /**
     * 设置碰撞关系（在墙壁同步完成后调用）
     * 实体间碰撞：用 Phaser overlap 检测，但响应仍由现有 Game.resolveCollisions() 处理
     * 这样既利用 Phaser B/C 树的高效检测，又保持原有逻辑权威
     */
    setupColliders() {
        if (this._collidersSet) return;
        // 玩家 vs 墙壁：仅在 Velocity 驱动模式下启用 Phaser 物理阻挡。
        // 默认模式下位置由 WallSystem.resolve 权威处理，body.moves=false，
        // 保留 collider 会与 WallSystem 形成双重阻挡/抖动。
        if (this.playerSprite && this._useVelocityDrive) {
            this.physics.add.collider(this.playerSprite, this.walls);
        }
        // [FIX] 敌人 vs 墙壁：移除此 collider，让 WallSystem.resolve() 成为唯一权威。
        // 双重碰撞系统会导致贴墙/墙角刷新的敌人被 Phaser 物理钉死，而手动解析又返回原坐标。
        // this.physics.add.collider(this.enemies, this.walls);
        // 实体间碰撞只由 Game.resolveCollisions() 的空间宽相处理。
        // 此处不注册空 overlap；空回调仍会让 Arcade Physics 枚举玩家/敌人和敌人/敌人碰撞对。
        this._collidersSet = true;
        
    }

    getPlayerSprite() { return this.playerSprite; }
    getEnemyGroup() { return this.enemies; }
    getWallGroup() { return this.walls; }

    // 清理所有实体 Sprite（场景切换时调用）
    clearAllEntitySprites() {
        this._mineWeather?.reset(true);
        this._windblownSand?.reset();
        this._rainWeather?.reset();
        this._droughtHeat?.reset();
        this._world125Atmosphere?.reset();
        // 销毁 enemies 组中的所有 Sprite
        if (this.enemies) {
            this.enemies.clear(true, true);
        }
        // 清除掉落物 Sprite/标签
        if (this.dropItemsGroup) {
            this.dropItemsGroup.clear(true, true);
        }
        // 清除世界特效 Sprite
        if (this.worldEffectsGroup) {
            this.worldEffectsGroup.clear(true, true);
        }
        // 清除玩家 Sprite
        if (this._playerSprite) {
            this._playerSprite.destroy();
            this._playerSprite = null;
        }
        // 清除实体引用（包括掉落物标签等未加入分组的 Phaser 对象）
        Game.entities.forEach(entity => {
            if (entity._phaserSprite) {
                entity._phaserSprite.destroy();
                entity._phaserSprite = null;
            }
            if (entity._phaserLabel) {
                entity._phaserLabel.destroy();
                entity._phaserLabel = null;
            }
        });
        // 清除世界 HUD 文本
        for (const roleTexts of this._entityHudTexts.values()) {
            for (const text of roleTexts.values()) {
                if (text?.active) text.destroy();
            }
        }
        this._entityHudTexts.clear();
        // 清除通用施法者特效注册表
        if (this._magicSprites) {
            for (const [caster, sprites] of this._magicSprites.entries()) {
                this._destroyMagicCasterVisuals(caster, sprites);
            }
            this._magicSprites.clear();
        }
        if (this._droneTargetLocks) {
            for (const lock of this._droneTargetLocks.values()) lock.graphics?.destroy();
            this._droneTargetLocks.clear();
        }
        if (this._droneTargetLockPool) {
            for (const graphics of this._droneTargetLockPool) graphics?.destroy();
            this._droneTargetLockPool.length = 0;
        }
        this._pushStrikeWeaponDepth?.clear(this.weaponSprite);
    }

    /**
     * 同步无人机到 Phaser Sprite
     */
    _syncDrone(player) {
        if (!player.droneSystem || !player.droneSystem.active) {
            if (this.droneSprite) this.droneSprite.setVisible(false);
            if (this.droneRangeGraphics) this.droneRangeGraphics.clear();
            if (this.droneMarkRangeGraphics) this.droneMarkRangeGraphics.clear();
            if (this.droneText) this.droneText.setVisible(false);
            return;
        }
        
        const drone = player.droneSystem;
        
        // 创建/更新无人机 Sprite
        if (!this.droneSprite) {
            this.droneSprite = this.add.sprite(0, 0, 'drone_hover');
            this.droneSprite.setDisplaySize(56, 56);
            if (!this.anims.exists('drone_hover_anim')) {
                this.anims.create({
                    key: 'drone_hover_anim',
                    frames: this.anims.generateFrameNumbers('drone_hover', { start: 0, end: 7 }),
                    frameRate: 12,
                    repeat: -1,
                });
            }
            this.droneSprite.play('drone_hover_anim');
        }
        this.droneSprite.setPosition(drone.x, drone.y);
        this.droneSprite.setVisible(true);
        
        // 操控模式下显示范围圈
        if (drone.controlling && window.Game && window.Game.showAttackRange) {
            if (!this.droneRangeGraphics) {
                this.droneRangeGraphics = this.add.graphics();
                this.droneRangeGraphics.setDepth(90);
            }
            if (!this.droneMarkRangeGraphics) {
                this.droneMarkRangeGraphics = this.add.graphics();
                this.droneMarkRangeGraphics.setDepth(90.01);
            }
            this.droneRangeGraphics.clear();
            this.droneRangeGraphics.lineStyle(1.5, 0x66dbe8, 0.42);
            this.droneRangeGraphics.strokeEllipse(drone.x, drone.y, drone.visionRadius * 2, drone.visionRadius * 2 * PERSPECTIVE_SCALE_Y);
            this.droneMarkRangeGraphics.clear();
            this.droneMarkRangeGraphics.lineStyle(1.5, 0xd7a64a, 0.62);
            this.droneMarkRangeGraphics.strokeEllipse(drone.x, drone.y, drone.markRadius * 2, drone.markRadius * 2 * PERSPECTIVE_SCALE_Y);
        } else if (this.droneRangeGraphics) {
            this.droneRangeGraphics.clear();
            this.droneMarkRangeGraphics?.clear();
        }
        
        // 显示剩余时间
        const remainingSec = Math.ceil(drone.duration / 1000);
        if (!this.droneText) {
            this.droneText = this.add.text(0, 0, '', {
                fontFamily: 'SimHei, sans-serif',
                fontSize: '10px',
                color: '#d4c5a9',
                align: 'center'
            });
            this.droneText.setOrigin(0.5, 1);
        }
        this.droneText.setPosition(drone.x, drone.y - 31);
        this.droneText.setText(`${drone.controlling ? '手动' : '自动'} · ${remainingSec}s`);
        this.droneText.setVisible(true);
    }

    _syncDroneTargetLocks(_game) {
        if (!this._droneTargetLocks) this._droneTargetLocks = new Map();
        if (!this._droneTargetLockPool) this._droneTargetLockPool = [];
        const active = this._droneLockActiveEntities || (this._droneLockActiveEntities = new Set());
        active.clear();
        if (!this._mapModeActive) {
            for (const entity of _game?.entities?.values?.() || []) {
                if (!entity?.active || entity.hp <= 0 || entity._faction !== 'enemy') continue;
                if (!entity.hasStatusEffect?.('droneVulnerability')) continue;
                if (FogOfWarSystem.shouldHideEntity(SceneManager.getCurrentWorldId(), entity)) continue;
                active.add(entity);
                let lock = this._droneTargetLocks.get(entity);
                if (!lock) {
                    const graphics = this._droneTargetLockPool.pop() || this.add.graphics();
                    lock = { graphics, acquiredAt: this.time.now };
                    this._droneTargetLocks.set(entity, lock);
                }
                const g = lock.graphics;
                const sprite = entity._phaserSprite;
                const width = Math.max(24, Math.min(120, sprite?.displayWidth || (entity.collisionWidth || entity.size * 2 || 32)));
                const height = Math.max(30, Math.min(150, sprite?.displayHeight || (entity.bodyHeight || entity.size * 3 || 48)));
                const cx = Number(sprite?.x) || entity.x;
                const cy = Number(sprite?.y) || (entity.y - height * 0.5);
                const left = cx - width * 0.52;
                const right = cx + width * 0.52;
                const top = cy - height * 0.52;
                const bottom = cy + height * 0.52;
                const corner = Math.max(5, Math.min(13, width * 0.22));
                g.clear();
                g.lineStyle(1.5, 0x66dbe8, 0.92);
                g.beginPath();
                g.moveTo(left + corner, top); g.lineTo(left, top); g.lineTo(left, top + corner);
                g.moveTo(right - corner, top); g.lineTo(right, top); g.lineTo(right, top + corner);
                g.moveTo(left, bottom - corner); g.lineTo(left, bottom); g.lineTo(left + corner, bottom);
                g.moveTo(right, bottom - corner); g.lineTo(right, bottom); g.lineTo(right - corner, bottom);
                g.strokePath();
                const diamondY = top - 7;
                g.lineStyle(1.25, 0xd7a64a, 0.95);
                g.beginPath();
                g.moveTo(cx, diamondY - 5); g.lineTo(cx + 5, diamondY);
                g.lineTo(cx, diamondY + 5); g.lineTo(cx - 5, diamondY); g.closePath(); g.strokePath();
                const acquireProgress = Math.min(1, Math.max(0, (this.time.now - lock.acquiredAt) / 220));
                if (acquireProgress < 1) {
                    const scanY = top + (bottom - top) * acquireProgress;
                    g.lineStyle(2, 0x8ff5ff, 1 - acquireProgress * 0.35);
                    g.lineBetween(left + 2, scanY, right - 2, scanY);
                }
                g.setDepth((Number(sprite?.depth) || entity.y) + 0.6);
                g.setVisible(true);
            }
        }
        for (const [entity, lock] of this._droneTargetLocks) {
            if (!active.has(entity)) {
                lock.graphics?.clear();
                lock.graphics?.setVisible(false);
                if (lock.graphics && this._droneTargetLockPool.length < 48) {
                    this._droneTargetLockPool.push(lock.graphics);
                } else {
                    lock.graphics?.destroy();
                }
                this._droneTargetLocks.delete(entity);
            }
        }
    }

    /** 推击命中：冷白压缩弧 + 少量金属火星，不使用剑光或血液贴图。 */
    triggerPushStrikeImpact(x, y, angle, radius, target = null) {
        const g = this.add.graphics();
        const cx = x + Math.cos(angle) * Math.min(radius, 64);
        const cy = y + Math.sin(angle) * Math.min(radius, 64);
        g.setDepth((Number(target?._phaserSprite?.depth) || target?.y || y) + 1);
        g.lineStyle(3, 0xe8f1f4, 0.9);
        g.beginPath();
        g.arc(cx, cy, Math.max(18, radius * 0.34), angle - Math.PI / 4, angle + Math.PI / 4, false);
        g.strokePath();
        g.lineStyle(1, 0xb9c8cf, 0.5);
        for (let i = -2; i <= 2; i += 1) {
            const a = angle + i * 0.12;
            g.lineBetween(cx, cy, cx + Math.cos(a) * radius * 0.36, cy + Math.sin(a) * radius * 0.36);
        }
        g.fillStyle(0xd7a64a, 0.9);
        for (let i = 0; i < 4; i += 1) {
            const a = angle + (i - 1.5) * 0.28;
            g.fillCircle(cx + Math.cos(a) * (12 + i * 3), cy + Math.sin(a) * (12 + i * 3), 1.5);
        }
        this.tweens.add({ targets: g, alpha: 0, scaleX: 1.12, scaleY: 1.12, duration: 180, onComplete: () => g.destroy() });
    }

    /**
     * 同步 HUD：血条/名字标签/准星/小地图
     */
    _syncHud(_game) {
        if (!_game || !_game.player) return;
        this._hudReady = true;
        const gWorld = this.worldHudGraphics;
        const gScreen = this.screenHudGraphics;
        gWorld.clear();
        gScreen.clear();

        const activeEntities = this._hudActiveEntities || (this._hudActiveEntities = new Set());
        activeEntities.clear();
        let hudVisibleEntities = 0;
        let hudCulledEntities = 0;
        // 实体血条与名字
        for (const entity of _game.entities.values()) {
            if (!entity || !entity.active || entity === _game.player) continue;
            if (typeof entity.x !== 'number' || typeof entity.y !== 'number') continue;
            activeEntities.add(entity);
            if (entity._hideHud) {
                this._entityHudTexts.get(entity)?.forEach((text) => text.setVisible(false));
                continue;
            }
            if (!this._isEntityInRenderViewport(entity)) {
                hudCulledEntities++;
                this._entityHudTexts.get(entity)?.forEach((text) => text.setVisible(false));
                continue;
            }
            const faction = entity._faction || entity.faction;
            const requiresLiveSight = faction === 'enemy' || faction === 'agent'
                || !!entity.itemData || !!entity._fogRequiresVisibility;
            const worldId = SceneManager.getCurrentWorldId();
            const hiddenByFog = FogOfWarSystem.isEnabled(worldId) && (
                requiresLiveSight
                    ? FogOfWarSystem.shouldHideEntity(worldId, entity)
                    : !FogOfWarSystem.isPointVisible(worldId, entity.x, entity.y)
            );
            if (hiddenByFog) {
                this._entityHudTexts.get(entity)?.forEach((text) => text.setVisible(false));
                continue;
            }
            hudVisibleEntities++;
            this._syncEntityHud(entity);
        }
        // 玩家血条/体力条
        activeEntities.add(_game.player);
        this._syncPlayerHud(_game.player);

        // 清理已失效实体的文本
        for (const [entity, roleTexts] of this._entityHudTexts.entries()) {
            if (!activeEntities.has(entity)) {
                for (const text of roleTexts.values()) text.destroy();
                this._entityHudTexts.delete(entity);
            }
        }

        // 准星
        this._syncCrosshair(gScreen);
        // 小地图
        this._syncMinimap();
        PerformanceMonitor.setCounter('hud.visibleEntities', hudVisibleEntities);
        PerformanceMonitor.setCounter('hud.culledEntities', hudCulledEntities);
    }

    _syncFirstExpeditionMarker(_game, graphics) {
        if (!graphics || typeof document === 'undefined') return;
        const targetId = document.body?.dataset?.firstExpeditionTarget;
        if (!targetId) return;
        const target = Array.from(_game.entities?.values?.() || []).find((entity) =>
            entity?.active && entity.id === targetId);
        if (!target) return;
        const gold = 0xf2bd3f;
        const goldLight = 0xffdf70;
        const goldShadow = 0x5b3500;
        const directionTargetId = document.body?.dataset?.firstTutorialDirectionTarget;
        const player = _game.player;
        if (directionTargetId === targetId && player?.active !== false
            && Number.isFinite(player?.x) && Number.isFinite(player?.y)) {
            const dx = Number(target.x) - Number(player.x);
            const dy = Number(target.y) - Number(player.y);
            const distance = Math.hypot(dx, dy);
            if (distance > 8) {
                const ux = dx / distance;
                const uy = dy / distance;
                const px = -uy;
                const py = ux;
                const playerBounds = getVisibleSpriteWorldBounds(player._phaserSprite);
                const anchorX = playerBounds ? (playerBounds.minX + playerBounds.maxX) / 2 : Number(player.x);
                const anchorY = playerBounds ? playerBounds.minY - 24 : Number(player.y) - 74;
                const tipX = anchorX + ux * 24;
                const tipY = anchorY + uy * 24;
                const baseX = anchorX - ux * 7;
                const baseY = anchorY - uy * 7;
                const tailX = anchorX - ux * 18;
                const tailY = anchorY - uy * 18;
                graphics.lineStyle(6, goldShadow, 0.48);
                graphics.lineBetween(tailX, tailY, baseX, baseY);
                graphics.lineStyle(3, goldLight, 0.76);
                graphics.lineBetween(tailX, tailY, baseX, baseY);
                graphics.fillStyle(goldShadow, 0.52);
                graphics.fillTriangle(
                    tipX + ux * 3, tipY + uy * 3,
                    baseX + px * 12, baseY + py * 12,
                    baseX - px * 12, baseY - py * 12
                );
                graphics.fillStyle(gold, 0.78);
                graphics.fillTriangle(
                    tipX, tipY,
                    baseX + px * 8, baseY + py * 8,
                    baseX - px * 8, baseY - py * 8
                );
            }
        }
        // 矿脉可能在屏幕外；玩家头顶的方向箭头仍应保留，目标包围圈只在目标可见时绘制。
        if (!this._isEntityInRenderViewport(target)) return;
        const neutral = this._neutralSprites?.get(target);
        const visualSprites = new Set([
            target._phaserSprite,
            neutral?.sprite,
            neutral?.groundContactSprite,
            neutral?.overlaySprite,
            neutral?.foregroundSprite,
        ].filter((sprite) => sprite?.active && sprite.visible !== false));
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        const includeBounds = (bounds) => {
            if (!bounds || ![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)) return;
            minX = Math.min(minX, bounds.minX);
            maxX = Math.max(maxX, bounds.maxX);
            minY = Math.min(minY, bounds.minY);
            maxY = Math.max(maxY, bounds.maxY);
        };
        for (const sprite of visualSprites) includeBounds(getVisibleSpriteWorldBounds(sprite));

        // NPC 的点击区按完整主体预先标定；与当前动画帧 alpha 范围取并集，既包住整个人物，
        // 也避免单帧肢体收拢时目标圈缩到角色身体里面。
        const clickRect = target.getClickRect?.();
        if (clickRect && Number(clickRect.w) > 0 && Number(clickRect.h) > 0) {
            includeBounds({
                minX: Number(target.x) + Number(clickRect.ox || 0),
                maxX: Number(target.x) + Number(clickRect.ox || 0) + Number(clickRect.w),
                minY: Number(target.y) + Number(clickRect.oy || 0),
                maxY: Number(target.y) + Number(clickRect.oy || 0) + Number(clickRect.h),
            });
        }
        if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
            const fallbackSize = Math.max(1, Number(target.spriteCfg?.size || target.size * 2) || 48);
            const fallbackHeight = Math.max(1, Number(target.spriteCfg?.sizeH || fallbackSize) || fallbackSize);
            const fallbackCenterY = Number(target.y) - Number(target.spriteCfg?.footOffsetY || 0);
            minX = Number(target.x) - fallbackSize / 2;
            maxX = Number(target.x) + fallbackSize / 2;
            minY = fallbackCenterY - fallbackHeight / 2;
            maxY = fallbackCenterY + fallbackHeight / 2;
        }

        const x = (minX + maxX) / 2;
        const y = (minY + maxY) / 2;
        const visualWidth = Math.max(1, maxX - minX);
        const visualHeight = Math.max(1, maxY - minY);
        const reducedMotion = this._tutorialReducedMotion ??= window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        const pulse = reducedMotion ? 0 : (Math.sin((this.time?.now || 0) / 260) + 1) / 2;
        // 仍按可见包围盒半对角线包住目标，但只留小幅呼吸边距，避免高大NPC外圈显得过大。
        const ringRadius = Math.max(28, Math.hypot(visualWidth, visualHeight) / 2 + 4 + pulse * 2);
        const arrowY = minY - 14 - pulse * 4;

        // 深琥珀描边负责在白色大理石上托住亮金主体；内外两圈仍保持同一金色引导语义。
        graphics.lineStyle(5, goldShadow, 0.42);
        graphics.strokeCircle(x, y, ringRadius);
        graphics.lineStyle(3, gold, 0.72);
        graphics.strokeCircle(x, y, ringRadius);
        graphics.lineStyle(1, goldLight, 0.46);
        graphics.strokeCircle(x, y, ringRadius + 5);

        graphics.lineStyle(5, goldShadow, 0.5);
        graphics.lineBetween(x, arrowY - 24, x, arrowY - 10);
        graphics.lineStyle(3, gold, 0.78);
        graphics.lineBetween(x, arrowY - 24, x, arrowY - 10);
        graphics.fillStyle(goldShadow, 0.56);
        graphics.fillTriangle(x - 11, arrowY - 11, x + 11, arrowY - 11, x, arrowY + 4);
        graphics.fillStyle(gold, 0.8);
        graphics.fillTriangle(x - 8, arrowY - 8, x + 8, arrowY - 8, x, arrowY + 1);
    }

    /**
     * 点击左下角“范围”按钮后，用半透明红色图形显示实体的碰撞/受击体积
     * - 矩形碰撞体：画外接矩形
     * - 圆形/无显式形状：画圆（半径取 collisionRadius）
     * - 玩家也显示，方便对齐受击体积与贴图
     */
    _syncCollisionRadii(_game) {
        if (!_game || !_game.entities) return;
        const show = _game.showAttackRange;
        this._syncElevatedNavigationRanges(_game, show);
        if (!show) {
            if (this._collisionRadiusGraphics) {
                this._collisionRadiusGraphics.clear();
                this._collisionRadiusGraphics.setVisible(false);
            }
            return;
        }
        if (!this._collisionRadiusGraphics) {
            this._collisionRadiusGraphics = this.add.graphics();
            this._collisionRadiusGraphics.setDepth(99999);
        }
        this._collisionRadiusGraphics.clear();
        this._collisionRadiusGraphics.setVisible(true);
        this._collisionRadiusGraphics.fillStyle(0xff0000, 0.25);
        this._collisionRadiusGraphics.lineStyle(1, 0xff0000, 0.5);

        const drawnEntities = new Set();
        const drawEntity = (entity) => {
            if (!entity || !entity.active || drawnEntities.has(entity)) return;
            if (FogOfWarSystem.shouldHideEntity(SceneManager.getCurrentWorldId(), entity)) return;
            // 仓库/祭坛等保留 NPC 交互身份的格网建筑只在下方建筑分支绘制 iso 棱柱；
            // 这里若继续画单位圆柱，会让调试界面误报为两套碰撞同时生效。
            if (usesBuildingFootprintVolume(entity)) return;
            // 跳过显式 noFootprint 的旧单位；格网建筑已在上方转入统一建筑体积分支。
            if (entity.config?.noFootprint) return;
            drawnEntities.add(entity);
            // 与单位阴影复用同一入口，红色 footprint 与黑色接触影必须完全重合。
            const footprint = this._getUnitRenderFootprint(
                entity,
                entity.groundRadius || entity.collisionRadius || entity.size * 0.6 || 12,
                _game
            );
            const r = footprint.radius;
            const cx = footprint.x;
            const cy = footprint.y;

            // 1) 地面 footprint：红色半透明椭圆
            this._collisionRadiusGraphics.strokeEllipse(cx, cy, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);
            this._collisionRadiusGraphics.fillEllipse(cx, cy, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);

            // 2) 上方垂直圆柱体：橙色，底面与红色 footprint 完全重合，高度 = bodyHeight
            // 地面实体的有效受击体积就是“footprint 沿 Z 轴拉伸成圆柱”，近战/投射物都按此判定。
            const h = entity.bodyHeight || r * 2;
            const topY = cy - h;
            const rx = r * 2;
            const ry = r * 2 * PERSPECTIVE_SCALE_Y;

            this._collisionRadiusGraphics.fillStyle(0xff6600, 0.10);
            this._collisionRadiusGraphics.fillEllipse(cx, cy, rx, ry);
            this._collisionRadiusGraphics.fillEllipse(cx, topY, rx, ry);
            this._collisionRadiusGraphics.fillRect(cx - r, topY, r * 2, cy - topY);

            this._collisionRadiusGraphics.lineStyle(1.5, 0xff8800, 0.75);
            this._collisionRadiusGraphics.strokeEllipse(cx, cy, rx, ry);
            this._collisionRadiusGraphics.strokeEllipse(cx, topY, rx, ry);
            this._collisionRadiusGraphics.beginPath();
            this._collisionRadiusGraphics.moveTo(cx - r, topY);
            this._collisionRadiusGraphics.lineTo(cx - r, cy);
            this._collisionRadiusGraphics.moveTo(cx + r, topY);
            this._collisionRadiusGraphics.lineTo(cx + r, cy);
            this._collisionRadiusGraphics.strokePath();

            // 顶部/底部水平参考线
            this._collisionRadiusGraphics.lineStyle(1, 0xffaa00, 0.6);
            this._collisionRadiusGraphics.beginPath();
            this._collisionRadiusGraphics.moveTo(cx - r, topY);
            this._collisionRadiusGraphics.lineTo(cx + r, topY);
            this._collisionRadiusGraphics.moveTo(cx - r, cy);
            this._collisionRadiusGraphics.lineTo(cx + r, cy);
            this._collisionRadiusGraphics.strokePath();

            // 3) 投射物躯干矩形：绿色描边（仅投射物判定使用，与近战无关）
            // 推导共享自 physics/torso-hitbox.js，与判定口径一致
            const torso = getTorsoRect(entity);
            if (torso) {
                this._collisionRadiusGraphics.lineStyle(1.5, 0x00ff66, 0.8);
                this._collisionRadiusGraphics.strokeRect(
                    torso.cx - torso.halfW, torso.cy - torso.halfH,
                    torso.halfW * 2, torso.halfH * 2
                );
            }

            // 恢复地面圆的填充样式，供下一个实体使用
            this._collisionRadiusGraphics.fillStyle(0xff0000, 0.25);
            this._collisionRadiusGraphics.lineStyle(1, 0xff0000, 0.5);
        };

        // 玩家
        if (_game.player) drawEntity(_game.player);

        // 敌人 + 普通 NPC 显示单位椭圆；格网建筑 NPC 已在 drawEntity 内排除。
        for (const entity of _game.entities.values()) {
            if (!entity || !entity.active || entity === _game.player) continue;
            if (entity._faction !== 'enemy' && entity._faction !== 'agent' && !entity.npcType) continue;
            drawEntity(entity);
        }

        // 队伍成员与世界友军也使用同一渲染脚点，便于直接核对插值后的阴影中心。
        const friendlySeen = new Set();
        for (const entity of [
            ...(PartySystem.members || []),
            ...(Array.isArray(_game.friendlyUnits) ? _game.friendlyUnits : []),
        ]) {
            if (!entity || friendlySeen.has(entity)) continue;
            friendlySeen.add(entity);
            drawEntity(entity);
        }

        // NPC 点击交互区域：绿色轮廓（与 game.js 点击判定同一推导 getClickRect）
        this._collisionRadiusGraphics.lineStyle(1.5, 0x00ff66, 0.9);
        for (const entity of _game.entities.values()) {
            if (!entity || !entity.active || !entity.npcType) continue;
            const rect = typeof entity.getClickRect === 'function' ? entity.getClickRect() : null;
            if (rect) {
                this._collisionRadiusGraphics.strokeRect(
                    entity.x + rect.ox, entity.y + rect.oy, rect.w, rect.h
                );
            } else {
                // 无贴图 NPC：圆形点击区域（interactionDistances.npcHover）
                const hoverR = GAME_CONFIG.interactionDistances?.npcHover ?? 40;
                this._collisionRadiusGraphics.strokeCircle(entity.x, entity.y, hoverR);
            }
        }

        // 矩形/等距地面旋转矩形 footprint：用人物圆柱体同款橙色标识——
        // 底面矩形 = footprint（collisionWidth/Height），顶面 = 底面沿 Z 上移 bodyHeight，
        // 侧壁竖线连四角（与圆柱体"footprint 沿 Z 拉伸"同语义，供左下角「范围」按钮查看）
        for (const entity of _game.entities.values()) {
            if (!entity || !entity.active) continue;
            if (entity._faction === 'enemy') continue; // 敌人走 drawEntity 椭圆口径（本段只服务祭坛/仓库类 NPC）
            if (!['rect', 'iso_rect'].includes(entity.collisionShape)
                || !(entity.collisionWidth > 0 && entity.collisionHeight > 0)) continue;
            const rcx = entity.collider ? entity.collider.x : entity.x;
            const rcy = entity.collider ? entity.collider.y : entity.y;
            const hw = entity.collisionWidth / 2, hh = entity.collisionHeight / 2;
            const topY = rcy - (entity.bodyHeight || 60);
            const g = this._collisionRadiusGraphics;
            if (entity.collisionShape === 'iso_rect') {
                const bottom = isoFootprintVertices(entity);
                const top = bottom.map((p) => ({ x: p.x, y: p.y - (entity.bodyHeight || 60) }));
                const drawPoly = (points, fill = false) => {
                    g.beginPath();
                    g.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
                    g.closePath();
                    if (fill) g.fillPath();
                    g.strokePath();
                };
                g.fillStyle(0xff6600, 0.10);
                g.lineStyle(1.5, 0xff8800, 0.75);
                drawPoly(bottom, true);
                drawPoly(top, false);
                g.beginPath();
                for (let i = 0; i < bottom.length; i++) {
                    g.moveTo(bottom[i].x, bottom[i].y);
                    g.lineTo(top[i].x, top[i].y);
                }
                g.strokePath();
                continue;
            }
            g.fillStyle(0xff6600, 0.10);
            g.fillRect(rcx - hw, topY, hw * 2, rcy - topY + hh);
            g.lineStyle(1.5, 0xff8800, 0.75);
            g.strokeRect(rcx - hw, rcy - hh, hw * 2, hh * 2);   // 底面 footprint
            g.strokeRect(rcx - hw, topY - hh, hw * 2, hh * 2);  // 顶面
            g.beginPath();
            for (const sx of [-1, 1]) {
                for (const sy of [-1, 1]) {
                    g.moveTo(rcx + sx * hw, rcy + sy * hh);
                    g.lineTo(rcx + sx * hw, topY + sy * hh);
                }
            }
            g.strokePath();
        }
    }

    _syncEntityHud(entity) {
        const isBoss = entity.rank === 'boss';
        const isFriendly = entity._faction === 'companion';
        const isEnemy = entity._faction === 'enemy';
        const isBuilding = isWorldBuildingEntity(entity);
        const unitDisplay = isFriendly
            ? UnitDisplaySettings.get('friendly')
            : (isEnemy ? UnitDisplaySettings.get('enemy') : null);
        const maxHp = entity.maxHp || entity.data?.maxHp || 1;
        const hp = entity.hp ?? entity.data?.hp ?? maxHp;
        if (maxHp <= 0) return;
        const hpPercent = Math.max(0, Math.min(1, hp / maxHp));
        const size = entity.size || 14;
        // 仓鼠矿工等友方单位由侍从渲染管线持有精灵（_companionSprites）——
        // 名称/血条按该精灵顶部锚定，贴图缩放后自动跟随（2026-08-15）
        const sprite = (entity._phaserSprite && entity._phaserSprite.active)
            ? entity._phaserSprite
            : (this._companionSprites && this._companionSprites[entity.id]
                && this._companionSprites[entity.id].active ? this._companionSprites[entity.id] : null);
        const x = sprite ? sprite.x : entity.x;
        // 能源矿/掩体/基地等走 _neutralSprites 渲染，没有 _phaserSprite；
        // 其贴图顶部 = 逻辑脚底 − spriteCfg.sizeH，血条/名字据此锚定。
        const neutralVisualH = (!sprite && (entity._isDefenseStructure || entity._isEnergyNode) && entity.spriteCfg?.sizeH)
            ? entity.spriteCfg.sizeH
            : 0;
        const topY = sprite
            ? sprite.y - sprite.displayHeight * 0.5
            : (neutralVisualH > 0 ? entity.y - neutralVisualH : entity.y - size * 1.5);
        const visibleTopY = sprite ? this._getVisibleSpriteTopY(sprite) : topY;

        if (isBoss) {
            const barW = 80, barH = 8, border = 2;
            const barX = x - barW / 2;
            // 血条整体下移 100px（此前上浮过高）；名字/数值/首领字段上下错开显示
            const barY = topY + 188;
            // 背景
            this.worldHudGraphics.fillStyle(0x1a0a0a, 1);
            this.worldHudGraphics.fillRect(barX - border, barY - border, barW + border * 2, barH + border * 2);
            // 底色
            this.worldHudGraphics.fillStyle(0x3a1010, 1);
            this.worldHudGraphics.fillRect(barX, barY, barW, barH);
            // 血量
            const hpColor = hpPercent > 0.5 ? 0xc04040 : hpPercent > 0.25 ? 0xa03030 : 0xff2020;
            this.worldHudGraphics.fillStyle(hpColor, 1);
            this.worldHudGraphics.fillRect(barX, barY, barW * hpPercent, barH);
            // 召唤阶段标记线（仅配置了 HP 阈值召唤的 Boss 才画；集合体为定时召唤，不画）
            const summonCfg = GAME_CONFIG.bossReward?.boss?.skills?.summon;
            if (summonCfg) {
                const summonThreshold = summonCfg.summonHpPercent ?? 0.5;
                const summonX = barX + barW * summonThreshold;
                this.worldHudGraphics.lineStyle(2, 0x44ff44, 1);
                this.worldHudGraphics.beginPath();
                this.worldHudGraphics.moveTo(summonX, barY - 2);
                this.worldHudGraphics.lineTo(summonX, barY + barH + 2);
                this.worldHudGraphics.strokePath();
            }
            // 首领名字：血条上方独立一行
            const nameText = this._getEntityHudText(entity, 'bossName');
            nameText.setText(`${entity.name}`);
            nameText.setPosition(x, barY - 34);
            nameText.setVisible(true);
            // HP 数值：紧贴血条上方
            const text = this._getEntityHudText(entity, 'bossHp');
            text.setText(`${Math.floor(hp)}/${maxHp}`);
            text.setPosition(x, barY - 8);
            text.setVisible(true);
            return;
        }

        // hudOffsetY 是旧人工透明边校准；人物单位改按当前帧 alpha 顶部自动定位。
        // render 来源：新怪（enemy-config.json）走 entity.config.render，老怪（animation-config）走 _animCfg.render
        const renderCfg = entity._animCfg?.render || entity.config?.render || {};
        const hudDy = renderCfg.hudOffsetY || 0;
        // 人物单位以可见模型顶部为锚点：血条下沿与模型顶部固定间隔 10px。
        // 非人物（建筑/资源）保留旧有胶囊或贴图顶部定位，避免改变世界-122既有标签。
        const useModelTopAnchor = isFriendly || isEnemy;
        const modelTopY = sprite ? visibleTopY : topY + hudDy;
        let anchorTop = topY;
        if (!useModelTopAnchor && renderCfg.capsuleHudAnchor) {
            const capH = (entity.collider && entity.collider.height) || renderCfg.spriteSize || size * 2;
            anchorTop = (entity.collider ? entity.collider.y : entity.y) - capH;
        }
        // 建筑不消费单位HUD的“显示满血条”选项：只有真实受损后才显示血条。
        const shouldShowHealthBar = isBuilding
            ? hp < maxHp
            : (unitDisplay
                ? unitDisplay.showHealthBar && (unitDisplay.showFullHealth || hp < maxHp)
                : hp < maxHp);
        let barY = null;
        if (shouldShowHealthBar) {
            const structureBarCfg = entity._isEnergyNode
                // 能源矿名称上移后，受损血条继续位于名称上方并保留间距。
                ? { width: 42, height: 6, offsetY: -40 }
                : (entity._isDefenseCover ? { width: 44, height: 5, offsetY: -36 } : null);
            const cfg = structureBarCfg || renderCfg.healthBar || { width: 28, height: 4, offsetY: -30 };
            const barW = cfg.width || 28;
            const barH = cfg.height || 4;
            barY = useModelTopAnchor
                ? modelTopY - 10 - barH
                : anchorTop + hudDy + (cfg.offsetY || -8);
            const barX = x - barW / 2;
            this.worldHudGraphics.fillStyle(0x1a0a0a, 1);
            this.worldHudGraphics.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
            this.worldHudGraphics.fillStyle(isFriendly ? 0x123c28 : 0x5a1010, 1);
            this.worldHudGraphics.fillRect(barX, barY, barW, barH);
            const hpColor = isFriendly
                ? (hpPercent > 0.5 ? 0x49c878 : hpPercent > 0.25 ? 0xe2b846 : 0xdf4f4f)
                : (hpPercent > 0.5 ? 0xc04040 : hpPercent > 0.25 ? 0xa03030 : 0x8a1a1a);
            this.worldHudGraphics.fillStyle(hpColor, 1);
            this.worldHudGraphics.fillRect(barX, barY, barW * hpPercent, barH);
        }

        // 仓鼠探险家头顶探险进度：12 分钟漫游期间持续增长，最终 digging 阶段保持满格。
        if (entity._isHamsterExplorer && entity._exploreActive) {
            const duration = Math.max(1, Number(entity._exploreDurationMs) || 720000);
            const remaining = Math.max(0, Number(entity._exploreRemainingMs) || 0);
            const progress = entity._explorePhase === 'digging'
                ? 1
                : Math.max(0, Math.min(1, 1 - remaining / duration));
            const exploreW = 46;
            const exploreH = 4;
            const exploreX = x - exploreW / 2;
            const exploreY = barY === null ? modelTopY - 18 : barY - 9;
            this.worldHudGraphics.fillStyle(0x090d12, 0.95);
            this.worldHudGraphics.fillRect(exploreX - 1, exploreY - 1, exploreW + 2, exploreH + 2);
            this.worldHudGraphics.fillStyle(0x27323b, 1);
            this.worldHudGraphics.fillRect(exploreX, exploreY, exploreW, exploreH);
            this.worldHudGraphics.fillStyle(progress < 0.5 ? 0xc7a64f : (progress < 0.8 ? 0x74a7b8 : 0x73c991), 1);
            this.worldHudGraphics.fillRect(exploreX, exploreY, exploreW * progress, exploreH);
        }

        // 名字标签：掉落物、NPC、训练靶等自带标签，跳过避免重叠
        // 已由 _syncNeutralEntities 挂了名字/血条标签的实体（仓鼠小屋/能源矿/掩体等建筑、
        // 静态 NPC）跳过 HUD 名字，避免重复显示——以后加建筑不用重复加名字（2026-08-15）
        const nameDisabled = isBuilding || (unitDisplay && !unitDisplay.showName);
        const hasOwnLabel = nameDisabled || entity.noNameLabel || entity.npcType || entity._dpsTracking !== undefined
            || (entity.itemData !== undefined) || (this._neutralSprites && this._neutralSprites.has(entity));
        if (hasOwnLabel) {
            // 隐藏之前可能已创建的名字文本
            this._entityHudTexts.get(entity)?.get('name')?.setVisible(false);
            return;
        }
        const nameText = this._getEntityHudText(entity, 'name');
          // 世界-122 相机 0.7：防御建筑名称放大 30%（12px → 16px）
          const nameFontSize = (SceneManager && SceneManager.currentScene === 'scene8' && entity._isDefenseStructure) ? '16px' : '12px';
          if (nameText.style && nameText.style.fontSize !== nameFontSize) {
              nameText.setFontSize(nameFontSize);
          }
        nameText.setText(entity.name || '');
        // 名字颜色按怪物等级：精英紫 / 领主橙 / 首领红（boss 走 bossName 样式，已是红色）
        const RANK_NAME_COLORS = { elite: '#c67affcc', lord: '#ffa500cc' };
        const rankColor = RANK_NAME_COLORS[entity.rank];
        nameText.setColor(isFriendly ? '#8fe3a5' : (rankColor || '#d4c5a9cc'));
        const nameY = barY === null
            ? (useModelTopAnchor ? modelTopY - 16 : anchorTop + hudDy - 6)
            : barY - 9;
        nameText.setPosition(x, nameY);
        nameText.setVisible(true);
    }

    _syncPlayerHud(player) {
        const data = player.data || {};
        const maxHp = data.maxHp || 1;
        const hp = data.hp ?? maxHp;
        const hpPercent = Math.max(0, Math.min(1, hp / maxHp));
        const size = player.size || 18;
        const sprite = (this.playerSprite && this.playerSprite.active) ? this.playerSprite : null;
        const x = sprite ? sprite.x : player.x;
        const displayH = sprite ? sprite.displayHeight : size * 3;
        const footOffsetY = sprite ? this._getFootOffsetY(player, sprite) : displayH * 0.5;
        const topY = sprite ? sprite.y - displayH / 2 : player.y - size * 1.5;
        const footY = sprite ? sprite.y + footOffsetY : player.y + displayH / 2;
        const barW = 40, barH = 6;
        const barY = topY - 8; // 头顶上方
        const barX = x - barW / 2;

        // 血量背景
        this.worldHudGraphics.fillStyle(0x000000, 0.7);
        this.worldHudGraphics.fillRect(barX, barY, barW, barH);
        // 血量填充
        const hpColor = hpPercent > 0.6 ? 0x4ade80 : hpPercent > 0.3 ? 0xfacc15 : 0xef4444;
        this.worldHudGraphics.fillStyle(hpColor, 1);
        this.worldHudGraphics.fillRect(barX, barY, barW * hpPercent, barH);
        // 边框
        this.worldHudGraphics.lineStyle(1, 0x3c3228, 0.9);
        this.worldHudGraphics.strokeRect(barX, barY, barW, barH);
        // 血量文字
        const hpText = this._getEntityHudText(player, 'hp');
        if (hpPercent < 1) {
            hpText.setText(`${Math.ceil(hp)}`);
            hpText.setPosition(x, barY + barH / 2);
            hpText.setVisible(true);
        } else {
            hpText.setVisible(false);
        }

        // 体力条
        const stBarW = 36, stBarH = 5;
        const stMax = data.maxStamina || 1;
        const st = data.stamina ?? stMax;
        const stPercent = Math.max(0, Math.min(1, st / stMax));
        const stY = footY + 6; // 紧贴脚底下方
        const stX = x - stBarW / 2;
        this.worldHudGraphics.fillStyle(0x000000, 0.6);
        this.worldHudGraphics.fillRect(stX, stY, stBarW, stBarH);
        const stColor = stPercent > 0.5 ? 0xa09060 : stPercent > 0.25 ? 0xa08040 : 0x8a4a4a;
        this.worldHudGraphics.fillStyle(stColor, 1);
        this.worldHudGraphics.fillRect(stX, stY, stBarW * stPercent, stBarH);
        this.worldHudGraphics.lineStyle(1, 0x5a4d3f, 0.8);
        this.worldHudGraphics.strokeRect(stX, stY, stBarW, stBarH);

        // 过热条
        let nextY = stY + stBarH + 3;
        if (player._overheatActive) {
            const ohPercent = Math.max(0, Math.min(1, player._overheatValue || 0));
            this.worldHudGraphics.fillStyle(0x000000, 0.6);
            this.worldHudGraphics.fillRect(stX, nextY, stBarW, stBarH);
            // 简化为纯色条（左浅右深）
            this.worldHudGraphics.fillStyle(0xff6b6b, 1);
            this.worldHudGraphics.fillRect(stX, nextY, stBarW * ohPercent, stBarH);
            this.worldHudGraphics.lineStyle(1, 0x5a4d3f, 0.8);
            this.worldHudGraphics.strokeRect(stX, nextY, stBarW, stBarH);
            if (player._overheatOverheated) {
                const flicker = 0.5 + Math.sin(Date.now() / 100) * 0.3;
                this.worldHudGraphics.fillStyle(0xff6464, flicker * 0.3);
                this.worldHudGraphics.fillRect(stX, nextY, stBarW, stBarH);
            }
            nextY += stBarH + 3;
        }

        // 换弹进度条
        const currentSlot = player.weaponMode;
        const currentItem = player.equipments && player.equipments[currentSlot];
        if (currentItem && isGunWeapon(currentItem)) {
            const mainState = player._ammoState && player._ammoState[currentSlot];
            if (mainState && mainState.reloading) {
                const reloadPercent = 1 - (mainState.reloadTimer / (mainState.reloadDuration || mainState.reloadTime));
                this.worldHudGraphics.fillStyle(0x000000, 0.6);
                this.worldHudGraphics.fillRect(stX, nextY, stBarW, stBarH);
                this.worldHudGraphics.fillStyle(0xffffff, 1);
                this.worldHudGraphics.fillRect(stX, nextY, stBarW * reloadPercent, stBarH);
                this.worldHudGraphics.lineStyle(1, 0x5a4d3f, 0.8);
                this.worldHudGraphics.strokeRect(stX, nextY, stBarW, stBarH);
                nextY += stBarH + 3;
            }
            const offhandSlot = currentSlot === 'weapon' ? 'offhand' : 'ring2';
            const offhandItem = player.equipments[offhandSlot];
            const isDualWield = offhandItem && offhandItem.name && !offhandItem.isTwoHanded;
            if (isDualWield) {
                const offState = player._ammoState && player._ammoState[offhandSlot];
                if (offState && offState.reloading) {
                    const offReloadPercent = 1 - (offState.reloadTimer / (offState.reloadDuration || offState.reloadTime));
                    this.worldHudGraphics.fillStyle(0x000000, 0.6);
                    this.worldHudGraphics.fillRect(stX, nextY, stBarW, stBarH);
                    this.worldHudGraphics.fillStyle(0xcccccc, 1);
                    this.worldHudGraphics.fillRect(stX, nextY, stBarW * offReloadPercent, stBarH);
                    this.worldHudGraphics.lineStyle(1, 0x5a4d3f, 0.8);
                    this.worldHudGraphics.strokeRect(stX, nextY, stBarW, stBarH);
                }
            }
        }
    }

    _getEntityHudText(entity, role = 'value') {
        // entity -> role -> Text 两级索引：裁切/迷雾/同步均为 O(1) 定位，不扫描全 HUD。
        let roleTexts = this._entityHudTexts.get(entity);
        let cache = roleTexts?.get(role) || null;
        if (!cache) {
            const styleMap = {
                name: { fontFamily: 'SimHei, "Microsoft YaHei", "黑体", sans-serif', fontSize: '12px', color: '#d4c5a9cc' },
                bossName: { fontFamily: 'SimHei, "Microsoft YaHei", sans-serif', fontSize: '14px', color: '#ff5050e6', fontStyle: 'bold', align: 'center' },
                bossHp: { fontFamily: 'SimHei, "Microsoft YaHei", sans-serif', fontSize: '11px', color: '#d4c5a9', fontStyle: 'bold' },
                hp: { fontSize: '9px', color: '#ffffff', fontStyle: 'bold' }
            };
            cache = this.add.text(0, 0, '', styleMap[role] || {
                fontFamily: 'SimHei, "Microsoft YaHei", sans-serif',
                fontSize: '12px',
                color: '#ffffff'
            });
            cache.setOrigin(0.5, 0.5);
            cache.setDepth(100001);
            if (!roleTexts) {
                roleTexts = new Map();
                this._entityHudTexts.set(entity, roleTexts);
            }
            roleTexts.set(role, cache);
        }
        return cache;
    }

    /**
     * 解析颜色字符串（#rrggbb / #rgb / rgb(...) / rgba(...)）
     */
    _parseColor(str, defaultColor = 0xffffff, defaultAlpha = 1) {
        if (!str) return { color: defaultColor, alpha: defaultAlpha };
        if (str[0] === '#') {
            let hex = str.slice(1);
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            const color = parseInt(hex, 16) || defaultColor;
            return { color, alpha: defaultAlpha };
        }
        const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
        if (m) {
            const color = (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
            const alpha = m[4] !== undefined ? parseFloat(m[4]) : defaultAlpha;
            return { color, alpha };
        }
        return { color: defaultColor, alpha: defaultAlpha };
    }

    /**
     * 清理战斗场景残留的视觉对象（传送门、敌人、掉落物 Sprite）
     * 供 DungeonMapSystem 在离开战斗/清理战斗时调用
     */
    clearCombatView() {
        // 清理中立 Sprite（传送门标签等）
        if (this._neutralSprites) {
            for (const data of this._neutralSprites.values()) {
                const sprites = Array.isArray(data.segmentSprites) && data.segmentSprites.length
                    ? data.segmentSprites
                    : [data.sprite];
                for (const sprite of new Set(sprites)) {
                    if (sprite?.active) sprite.destroy();
                }
                if (data.overlaySprite?.active) data.overlaySprite.destroy();
                if (data.groundContactSprite?.active) data.groundContactSprite.destroy();
                if (data.foregroundSprite?.active) data.foregroundSprite.destroy();
                if (data.workingEffectGraphics?.active) data.workingEffectGraphics.destroy();
                if (data.staffingWarningGraphics?.active) data.staffingWarningGraphics.destroy();
                if (data.battlementRuneSprite?.active) data.battlementRuneSprite.destroy();
                if (data.label && data.label.active) data.label.destroy();
            }
            this._neutralSprites.clear();
        }
        // 清理敌人 Sprite
        if (this.enemies) {
            this.enemies.clear(true, true);
        }
        // 清理掉落物 Sprite/标签
        if (this.dropItemsGroup) {
            this.dropItemsGroup.clear(true, true);
        }
        // 清理世界 HUD 文本缓存中指向已销毁对象的条目
        for (const roleTexts of this._entityHudTexts.values()) {
            for (const text of roleTexts.values()) {
                if (text?.active) text.destroy();
            }
        }
        this._entityHudTexts.clear();
    }

    _syncCrosshair(_g) {
        const player = window.Game && window.Game.player;
        // 出征面板或地牢地图模式：强制恢复默认鼠标指针，避免与地图/面板交互冲突
        const isDungeonNonCombat = DungeonMapSystem && DungeonMapSystem.active &&
            (DungeonMapSystem.state === 'map' || DungeonMapSystem.state === 'event' ||
             DungeonMapSystem.state === 'shop' || DungeonMapSystem.state === 'reward');
        if ((ExpeditionSystem && ExpeditionSystem._isOpen) || isDungeonNonCombat) {
            document.body.style.cursor = '';
            if (this.game?.canvas) this.game.canvas.style.cursor = '';
            this._normalCommandCursorActive = false;
            if (this._domCursor) this._domCursor.style.display = 'none';
            return;
        }
        const game = window.Game;
        const mx = Input.mouse.x;
        const my = Input.mouse.y;
        // 与世界输入共用表面白名单；面板在静止鼠标下打开时也立即交回原生指针。
        const pointerTarget = Number.isFinite(mx) && Number.isFinite(my)
            ? document.elementFromPoint(mx, my)
            : null;
        if (!isGameplayPointerEvent({ target: pointerTarget })) {
            document.body.style.cursor = '';
            if (this.game?.canvas) this.game.canvas.style.cursor = '';
            this._normalCommandCursorActive = false;
            if (this._domCursor) this._domCursor.style.display = 'none';
            return;
        }
        if (this._syncSemanticCommandCursor(game)) return;
        const elevatedTarget = game?.RTSCommand?.elevatedCursorTarget?.();
        const elevatedAnchor = elevatedTarget
            ? this._elevatedCommandCursorAnchor(elevatedTarget, Input.mouse.x, Input.mouse.y)
            : null;
        if (elevatedAnchor && this._drawElevatedCommandCursor(elevatedAnchor.x, elevatedAnchor.y)) {
            document.body.style.cursor = 'none';
            if (this.game?.canvas) this.game.canvas.style.cursor = 'none';
            return;
        }
        if (elevatedTarget && this.game?.canvas) {
            // 首次异步加载贴图的一瞬间保留既有建筑鼠标，不制造不可见空档。
            this.game.canvas.style.cursor = game?.RTSCommand?._hoverBuilding ? 'var(--bp-cursor-pointer, pointer)' : '';
        }
        const currentWeapon = player?.equipments?.[player.weaponMode];
        const usesWeaponCrosshair = !!currentWeapon
            && (isGunWeapon(currentWeapon) || currentWeapon.weaponType === 'bow');
        if (this._syncNormalWorldCursor(game, usesWeaponCrosshair)) return;
        if (!player) {
            document.body.style.cursor = '';
            if (this.game?.canvas) this.game.canvas.style.cursor = '';
            if (this._domCursor) this._domCursor.style.display = 'none';
            return;
        }
        document.body.style.cursor = 'none';
        if (this.game?.canvas) this.game.canvas.style.cursor = 'none';
        const mainSpreadAngle = (Number(player._currentSpreadFactor) || 0)
            * (Number(player._currentSpreadMaxAngle) || 0);
        const offSpreadAngle = (Number(player._currentSpreadFactorOff) || 0)
            * (Number(player._currentSpreadMaxAngleOff) || 0);
        const spreadAngle = Math.max(mainSpreadAngle, offSpreadAngle)
            + (Number(player._crosshairShotKick) || 0);
        if (!this._crosshairSpread) this._crosshairSpread = 0;
        const crosshairCfg = GAME_CONFIG.crosshair || {};
        const lerpSpeed = crosshairCfg.lerpSpeed || 0.3;
        this._crosshairSpread += (spreadAngle - this._crosshairSpread) * lerpSpeed;
        const geometry = crosshairCfg.geometry || { baseGap: 5, maxGapExtra: 24, projectionScale: 48, lineLen: 6, capLen: 1.5, lineWidth: 1.5, outlineWidth: 1.5 };
        const baseGap = geometry.baseGap || 4;
        const maxGapExtra = geometry.maxGapExtra || 16;
        const mouseWorld = Renderer.screenToWorld(mx, my);
        const aimDistance = Math.hypot(mouseWorld.x - player.x, mouseWorld.y - player.y);
        const currentBallistics = typeof player._getGunBallistics === 'function'
            ? player._getGunBallistics(currentWeapon, currentWeapon?.attack?.range)
            : null;
        const effectiveAimDistance = Math.min(aimDistance, currentBallistics?.maxRange || aimDistance);
        const cameraZoom = (this.cameras?.main?.zoom) || 1;
        const projectedRadius = Math.tan(Math.min(35, Math.max(0, this._crosshairSpread)) * Math.PI / 180)
            * effectiveAimDistance * cameraZoom;
        // 实际角度投影到瞄准距离后做指数压缩，既贴合弹道锥，又不会在高散布时越出准星画布。
        const projectionScale = Math.max(1, geometry.projectionScale || 48);
        const gap = baseGap + maxGapExtra * (1 - Math.exp(-projectedRadius / projectionScale));
        const lineLen = geometry.lineLen || 6;
        const capLen = geometry.capLen ?? 1.5;
        const lineWidth = geometry.lineWidth || 1.5;
        const outlineWidth = geometry.outlineWidth || 1.5;
        const colors = this._resolveCrosshairColors(crosshairCfg.colors);
        const centerDot = crosshairCfg.centerDot || {};

        // 只在真实游戏表面显示最高层 DOM 准星；进入 UI 已在统一入口恢复原生指针。
        // 中心固定在鼠标坐标，只有外围刻度随原散布变化；Phaser 层不重复绘制。
        const cursorSize = Math.max(64, Number(crosshairCfg.canvasSize) || 96);
        const dom = this._ensureDomCursor(cursorSize);
        const dctx = this._domCursorCtx;
        dctx.clearRect(0, 0, cursorSize, cursorSize);
        const dcx = cursorSize * 0.5, dcy = cursorSize * 0.5;
        const outlineColor = colors.outline;
        const mainColor = colors.main;
        for (const [w, color] of [[lineWidth + outlineWidth, outlineColor], [lineWidth, mainColor]]) {
            dctx.strokeStyle = color;
            dctx.lineWidth = w;
            dctx.lineCap = 'square';
            dctx.lineJoin = 'miter';
            dctx.beginPath();
            dctx.moveTo(dcx, dcy - gap); dctx.lineTo(dcx, dcy - gap - lineLen);
            dctx.moveTo(dcx, dcy + gap); dctx.lineTo(dcx, dcy + gap + lineLen);
            dctx.moveTo(dcx - gap, dcy); dctx.lineTo(dcx - gap - lineLen, dcy);
            dctx.moveTo(dcx + gap, dcy); dctx.lineTo(dcx + gap + lineLen, dcy);
            // 短端帽保留冷钢机械刻度，避免厚重外框遮住小目标。
            dctx.moveTo(dcx - capLen, dcy - gap - lineLen); dctx.lineTo(dcx + capLen, dcy - gap - lineLen);
            dctx.moveTo(dcx - capLen, dcy + gap + lineLen); dctx.lineTo(dcx + capLen, dcy + gap + lineLen);
            dctx.moveTo(dcx - gap - lineLen, dcy - capLen); dctx.lineTo(dcx - gap - lineLen, dcy + capLen);
            dctx.moveTo(dcx + gap + lineLen, dcy - capLen); dctx.lineTo(dcx + gap + lineLen, dcy + capLen);
            dctx.stroke();
        }
        const outerRadius = centerDot.outerRadius || 2;
        const innerRadius = centerDot.innerRadius || 1;
        dctx.fillStyle = colors.centerOuter;
        dctx.beginPath();
        dctx.arc(dcx, dcy, outerRadius, 0, Math.PI * 2);
        dctx.fill();
        dctx.fillStyle = colors.centerInner;
        dctx.beginPath();
        dctx.arc(dcx, dcy, innerRadius, 0, Math.PI * 2);
        dctx.fill();

        // Hitmarker（COD 式三级命中确认：命中白 / 暴击金 / 击杀红，出现瞬间外扩后淡出）
        const hm = GunFeel.hitmarker;
        if (hm && hm.t > 0 && hm.dur > 0) {
            const prog = 1 - hm.t / hm.dur;                    // 0→1
            const hmOff = 7 + prog * 5;                        // 外扩动画
            const hmLen = 6;
            const hmAlpha = Math.min(1, hm.t / (hm.dur * 0.6));
            const hmColor = GunFeel.HITMARK_COLORS[hm.tier] || '#FAFAF2';
            dctx.save();
            dctx.globalAlpha = hmAlpha;
            for (const [w, color] of [[4.5, outlineColor], [2, hmColor]]) {
                dctx.strokeStyle = color;
                dctx.lineWidth = w;
                dctx.beginPath();
                for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                    const c = 0.7071; // cos45°
                    dctx.moveTo(dcx + sx * hmOff * c, dcy + sy * hmOff * c);
                    dctx.lineTo(dcx + sx * (hmOff + hmLen) * c, dcy + sy * (hmOff + hmLen) * c);
                }
                dctx.stroke();
            }
            dctx.restore();
        }
        dom.style.left = (mx - cursorSize * 0.5) + 'px';
        dom.style.top = (my - cursorSize * 0.5) + 'px';
        dom.style.display = 'block';
    }

    /** Canvas 颜色消费冷钢 CSS 真源；缓存解析结果，避免逐帧读取计算样式。 */
    _resolveCrosshairColors(configuredColors) {
        if (this._crosshairPalette && this._crosshairPaletteSource === configuredColors) {
            return this._crosshairPalette;
        }
        const theme = getComputedStyle(document.documentElement);
        const resolve = (value, token, fallback) => {
            const source = value || token;
            return source.startsWith('--') ? theme.getPropertyValue(source).trim() || fallback : source;
        };
        const colors = configuredColors || {};
        const outline = resolve(colors.outline, '--bp-ui-black', '#000000');
        const main = resolve(colors.main, '--bp-ui-white-soft', '#ffffff');
        const highlight = resolve(colors.highlight, '--bp-ui-white', main);
        this._crosshairPaletteSource = configuredColors;
        this._crosshairPalette = {
            outline,
            main,
            highlight,
            centerOuter: resolve(colors.centerOuter, '--bp-ui-black', outline),
            centerInner: resolve(colors.centerInner, '--bp-ui-white', highlight),
        };
        return this._crosshairPalette;
    }

    /** 六种模式指令游标的唯一写入点；业务系统只返回语义状态。 */
    _syncSemanticCommandCursor(game) {
        const building = game?.BuildingSystem;
        const rts = game?.RTSCommand;
        const mx = Input?.mouse?.x;
        const my = Input?.mouse?.y;
        const state = building?.active
            ? building.commandCursorState?.(mx, my)
            : rts?.commandCursorState?.(mx, my);
        if (!state) return false;

        const canvas = this.game?.canvas;
        const cursor = state === 'ui' ? '' : COMMAND_CURSOR_STYLES[state];
        if (cursor === undefined) return false;
        this._normalCommandCursorActive = true;
        if (this._domCursor) this._domCursor.style.display = 'none';
        document.body.style.cursor = cursor;
        if (canvas) canvas.style.cursor = cursor;
        return true;
    }

    /** 三种模式共用普通世界箭头；直接操控枪械/弓箭仍由专用准星接管。 */
    _syncNormalWorldCursor(game, usesWeaponCrosshair) {
        const rts = game?.RTSCommand;
        const building = game?.BuildingSystem;
        const rtsActive = !!rts?.enabled;
        const buildingActive = !!building?.active;
        const canvas = this.game?.canvas;
        const directPointerActive = !!game?.player && !usesWeaponCrosshair;
        if (!rtsActive && !buildingActive && !directPointerActive) {
            if (this._normalCommandCursorActive && canvas) {
                canvas.style.cursor = '';
            }
            this._normalCommandCursorActive = false;
            return false;
        }

        this._normalCommandCursorActive = true;
        if (this._domCursor) this._domCursor.style.display = 'none';
        const pointerOverUi = (rtsActive && !!rts._pointerOverUi)
            || (buildingActive && !!building._pointerOverUi);
        if (pointerOverUi) {
            document.body.style.cursor = '';
            if (canvas) canvas.style.cursor = '';
            return true;
        }

        const hoveringBuilding = (rtsActive && !!rts._hoverBuilding) || !!game?.DefenseSystem?._hoverTower;
        // 普通态清除临时覆盖，继承冷钢主题；路径和热点仅由 CSS 真源维护。
        const cursor = hoveringBuilding
            ? 'var(--bp-cursor-pointer, pointer)'
            : '';
        document.body.style.cursor = cursor;
        if (canvas) canvas.style.cursor = cursor;
        return true;
    }

    /**
     * 可登城 RTS 鼠标：箭头底部贴近解析后的真实墙顶目标，每个周期只向上移动并在回绕处淡出。
     * 语义判定归 RTSCommand；此处只负责加载正式贴图和统一置顶绘制。
     */
    _elevatedCommandCursorAnchor(target, fallbackX, fallbackY) {
        const x = Number(target?.x);
        const groundY = Number(target?.y);
        if (Number.isFinite(x) && Number.isFinite(groundY)) {
            // 正常立面显示真实墙顶 y-z；压平视图显示墙体物理 footprint y。
            const displayY = FlatViewSystem?.enabled
                ? groundY
                : groundY - (Number(target?.z) || 0);
            const screen = Renderer.worldToScreen(x, displayY);
            if (Number.isFinite(screen?.x) && Number.isFinite(screen?.y)) return screen;
        }
        return { x: fallbackX, y: fallbackY };
    }

    _drawElevatedCommandCursor(anchorX, anchorY) {
        if (!this._elevatedCursorImage
            && !this._elevatedCursorImageLoading
            && !this._elevatedCursorImageFailed) {
            const image = new Image();
            image.decoding = 'async';
            image.onload = () => {
                this._elevatedCursorImage = image;
                this._elevatedCursorImageLoading = null;
            };
            image.onerror = () => {
                this._elevatedCursorImageLoading = null;
                this._elevatedCursorImageFailed = true;
            };
            image.src = 'assets/ui/cursors/elevated-climb-arrow.png';
            this._elevatedCursorImageLoading = image;
        }
        const image = this._elevatedCursorImage;
        if (!image?.naturalWidth || !image?.naturalHeight) return false;

        const cursorSize = 112;
        const displayH = 92;
        const displayW = displayH * image.naturalWidth / image.naturalHeight;
        const phase = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) % 960) / 960;
        const upwardOffset = -phase * 6;
        const alpha = 0.58 + Math.sin(Math.PI * phase) * 0.34;
        const drawY = 8 + upwardOffset;
        // 正式资产可见底边距固定为 8/256；扣除后，箭头钢框底边精确落在目标锚点。
        const visibleBottomInset = displayH * 8 / 256;
        const visibleBaseY = 8 + displayH - visibleBottomInset;
        const dom = this._ensureDomCursor(cursorSize);
        const dctx = this._domCursorCtx;
        dctx.clearRect(0, 0, cursorSize, cursorSize);
        dctx.save();
        dctx.globalAlpha = alpha;
        dctx.imageSmoothingEnabled = true;
        dctx.imageSmoothingQuality = 'high';
        dctx.drawImage(
            image,
            (cursorSize - displayW) * 0.5,
            drawY,
            displayW,
            displayH
        );
        dctx.restore();
        dom.style.left = `${anchorX - cursorSize * 0.5}px`;
        dom.style.top = `${anchorY - visibleBaseY}px`;
        dom.style.display = 'block';
        return true;
    }

    /** DOM 置顶准星（最高 z-index 的独立 canvas，pointer-events 不拦截） */
    _ensureDomCursor(size = 96) {
        if (this._domCursor) {
            if (this._domCursor.width !== size || this._domCursor.height !== size) {
                this._domCursor.width = size;
                this._domCursor.height = size;
                this._domCursor.style.width = `${size}px`;
                this._domCursor.style.height = `${size}px`;
            }
            return this._domCursor;
        }
        const c = document.createElement('canvas');
        c.id = 'gameDomCursor';
        c.width = size;
        c.height = size;
        c.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;pointer-events:none;z-index:2147483647;display:none;`;
        document.body.appendChild(c);
        this._domCursor = c;
        this._domCursorCtx = c.getContext('2d');
        return c;
    }

    _drawCrosshairLines(g, mx, my, gap, lineLen) {
        g.beginPath();
        g.moveTo(mx, my - gap); g.lineTo(mx, my - gap - lineLen);
        g.moveTo(mx, my + gap); g.lineTo(mx, my + gap + lineLen);
        g.moveTo(mx - gap, my); g.lineTo(mx - gap - lineLen, my);
        g.moveTo(mx + gap, my); g.lineTo(mx + gap + lineLen, my);
        g.strokePath();
    }

    /**
     * 地牢路线、事件和奖励界面由 DungeonMapSystem 独占地图区域；只有真实战斗房
     * 使用 GameScene 的 HUD 小地图。普通世界始终使用同一套 GameScene 小地图。
     */
    _isMinimapVisibleForCurrentMode() {
        if (SceneManager.currentScene !== 'scene7') return true;
        if (!DungeonMapSystem?.active) return false;
        return DungeonMapSystem.state === 'combat' || DungeonMapSystem.state === 'boss';
    }

    _setMinimapLayersVisible(visible) {
        const show = !!visible;
        this._minimapStaticGraphics?.setVisible(show);
        this._minimapDynamicGraphics?.setVisible(show);
        this.minimapTitle?.setVisible(show);
        // GameScene 跨逻辑场景常驻，迷雾 Image 也会保留上一场景纹理；恢复时必须
        // 同时验证当前 grid，不能让旧位面黑图在无迷雾场景中变成“第二张小地图”。
        const fogGridActive = !!FogOfWarSystem.getGrid(SceneManager.currentScene)?.active;
        this._fogMinimapLayer?.setVisible(show && fogGridActive);
    }

    /** 固定 UI（scrollFactor-0，如小地图）在相机 zoom 下的坐标补偿系数：
     *  相机 origin 已固定 (0,0)，屏幕位置 = 绘制坐标 × zoom → 绘制坐标 = 屏幕目标 ÷ zoom。
     *  任意 zoom（0.3/0.7/1…）通用，小地图永远锚定屏幕固定位置（2026-08-15） */
    _minimapInvZoom() {
        return 1 / ((this.cameras.main && this.cameras.main.zoom) || 1);
    }

    /** 小地图绘制/点击共用布局真源（坐标均为 Phaser 视口像素，未乘 invZoom）。 */
    _minimapLayout() {
        const minimapCfg = GAME_CONFIG.minimap || {};
        // 地牢战斗沿用传统 150x150 小地图，避免全局宽版 HUD 配置在地牢中被误当成放大版。
        const isDungeonCombat = SceneManager.currentScene === 'scene7';
        const dungeonCfg = isDungeonCombat ? (minimapCfg.dungeon || {}) : {};
        const readLayoutNumber = (key, fallback) => {
            const raw = dungeonCfg[key] ?? minimapCfg[key];
            const value = Number(raw);
            return Number.isFinite(value) ? value : fallback;
        };
        const minimapW = Math.max(1, readLayoutNumber('width', 150));
        const minimapH = Math.max(1, readLayoutNumber('height', 150));
        const pad = Math.max(0, readLayoutNumber('padding', 10));
        const offsetY = Math.max(0, readLayoutNumber('offsetY', 50));
        const mx = pad;
        const my = pad + offsetY;
        const worldW = CONFIG.WORLD_WIDTH;
        const worldH = CONFIG.WORLD_HEIGHT;
        const scale = Math.min(minimapW / worldW, minimapH / worldH);
        const contentW = worldW * scale;
        const contentH = worldH * scale;
        const offX = (minimapW - contentW) / 2;
        const offY = (minimapH - contentH) / 2;
        return {
            minimapCfg,
            minimapW,
            minimapH,
            mx,
            my,
            worldW,
            worldH,
            scale,
            offX,
            offY,
            contentX: mx + offX,
            contentY: my + offY,
            contentW,
            contentH,
        };
    }

    /** 小地图实际地图内容的浏览器客户区矩形（排除宽高比留白）。 */
    minimapClientRect() {
        const canvas = this.game?.canvas;
        if (!canvas || !this.scale) return null;
        const rect = canvas.getBoundingClientRect();
        const viewW = this.scale.width || canvas.width;
        const viewH = this.scale.height || canvas.height;
        if (!rect.width || !rect.height || !viewW || !viewH) return null;
        const layout = this._minimapLayout();
        const toClientX = rect.width / viewW;
        const toClientY = rect.height / viewH;
        return {
            left: rect.left + layout.contentX * toClientX,
            top: rect.top + layout.contentY * toClientY,
            width: layout.contentW * toClientX,
            height: layout.contentH * toClientY,
        };
    }

    /** 浏览器客户区点击 → 小地图对应世界坐标；拖动时可钳在地图内容边缘。 */
    minimapWorldPointAt(clientX, clientY, { clampToContent = false } = {}) {
        if (!this._minimapStaticGraphics?.visible
            || !this._minimapDynamicGraphics?.visible
            || window.Game?._npcDialoguePaused) return null;
        const clientRect = this.minimapClientRect();
        if (!clientRect) return null;
        if (!clampToContent && (clientX < clientRect.left || clientX > clientRect.left + clientRect.width
            || clientY < clientRect.top || clientY > clientRect.top + clientRect.height)) return null;
        const layout = this._minimapLayout();
        const nx = clientRect.width > 0
            ? Math.max(0, Math.min(1, (clientX - clientRect.left) / clientRect.width))
            : 0;
        const ny = clientRect.height > 0
            ? Math.max(0, Math.min(1, (clientY - clientRect.top) / clientRect.height))
            : 0;
        return {
            x: Math.max(0, Math.min(layout.worldW, nx * layout.worldW)),
            y: Math.max(0, Math.min(layout.worldH, ny * layout.worldH)),
        };
    }

    _redrawMinimapStatic() {
        const g = this._minimapStaticGraphics;
        if (!g) return;
        g.clear();
        const invZ = this._minimapInvZoom();
        const minimapLayout = this._minimapLayout();
        const {
            minimapCfg, minimapW, minimapH, mx, my, worldW, worldH, scale, offX, offY,
        } = minimapLayout;
        // DOM 新手目标条消费当前小地图实际占位，禁止再复制一套固定坐标后与 RTS 左栏冲突。
        if (typeof document !== 'undefined' && document.body) {
            const hudLayoutKey = `${mx}:${my}:${minimapW}:${minimapH}`;
            if (hudLayoutKey !== this._minimapHudLayoutKey) {
                this._minimapHudLayoutKey = hudLayoutKey;
                document.body.style.setProperty('--minimap-hud-right', `${mx + minimapW}px`);
                document.body.style.setProperty('--minimap-hud-top', `${my}px`);
                document.body.style.setProperty('--minimap-hud-height', `${minimapH}px`);
            }
        }
        const styles = minimapCfg.styles || {};
        const bg = minimapCfg.background || {};
        const boxX0 = mx, boxY0 = my, boxX1 = mx + minimapW, boxY1 = my + minimapH;

        // 背景（所有绘制坐标 × 1/zoom，抵消相机缩放对 scrollFactor-0 图形的作用）
        const bgColor = this._parseColor(bg.fill || 'rgba(0,0,0,0.6)', 0x000000, 0.6);
        g.fillStyle(bgColor.color, bgColor.alpha);
        g.fillRect(mx * invZ, my * invZ, minimapW * invZ, minimapH * invZ);
        const borderColor = this._parseColor(bg.border || 'rgba(255,255,255,0.4)', 0xffffff, 0.4);
        g.lineStyle((bg.lineWidth || 1) * invZ, borderColor.color, borderColor.alpha);
        g.strokeRect(mx * invZ, my * invZ, minimapW * invZ, minimapH * invZ);

        // 墙壁（裁剪到框内：墙可带负坐标/越界坐标，与动态层 inBox 同口径，防画出小地图外）
        if (WallSystem && WallSystem.walls) {
            const wallColor = this._parseColor(styles.wall || 'rgba(80,80,80,0.5)', 0x505050, 0.5);
            g.fillStyle(wallColor.color, wallColor.alpha);
            for (const w of WallSystem.walls) {
                const wx = mx + offX + w.x * scale;
                const wy = my + offY + w.y * scale;
                const ww = Math.max(0.5, w.w * scale);
                const wh = Math.max(0.5, w.h * scale);
                const x0 = Math.max(wx, boxX0), y0 = Math.max(wy, boxY0);
                const x1 = Math.min(wx + ww, boxX1), y1 = Math.min(wy + wh, boxY1);
                if (x1 <= x0 || y1 <= y0) continue;
                g.fillRect(x0 * invZ, y0 * invZ, (x1 - x0) * invZ, (y1 - y0) * invZ);
            }
        }

        // 可移动区域边界（2026-08-16）：世界-122 菱形地块四边（WallSystem 里 _boundary
        // 不可见阻挡段）在小地图上画轮廓——区外黑地不可通行，轮廓即可移动范围。
        if (WallSystem && WallSystem.isoSegments) {
            const boundarySegs = WallSystem.isoSegments.filter((s) => s._boundary);
            if (boundarySegs.length > 0) {
                const bColor = this._parseColor(styles.playableBoundary || 'rgba(120,255,170,0.85)', 0x78ffaa, 0.85);
                g.lineStyle((styles.playableBoundaryWidth || 1) * invZ, bColor.color, bColor.alpha);
                // Graphics 在 WebGL 下不能依赖 geometry mask；线段必须在提交前裁到地图框内。
                const clipLineToBox = (x1, y1, x2, y2) => {
                    const dx = x2 - x1, dy = y2 - y1;
                    let t0 = 0, t1 = 1;
                    const tests = [
                        [-dx, x1 - boxX0], [dx, boxX1 - x1],
                        [-dy, y1 - boxY0], [dy, boxY1 - y1],
                    ];
                    for (const [p, q] of tests) {
                        if (p === 0) {
                            if (q < 0) return null;
                            continue;
                        }
                        const r = q / p;
                        if (p < 0) {
                            if (r > t1) return null;
                            if (r > t0) t0 = r;
                        } else {
                            if (r < t0) return null;
                            if (r < t1) t1 = r;
                        }
                    }
                    return {
                        x1: x1 + t0 * dx, y1: y1 + t0 * dy,
                        x2: x1 + t1 * dx, y2: y1 + t1 * dy,
                    };
                };
                for (const s of boundarySegs) {
                    const x1 = mx + offX + s.x1 * scale, y1 = my + offY + s.y1 * scale;
                    const x2 = mx + offX + s.x2 * scale, y2 = my + offY + s.y2 * scale;
                    const clipped = clipLineToBox(x1, y1, x2, y2);
                    if (!clipped) continue;
                    g.lineBetween(clipped.x1 * invZ, clipped.y1 * invZ,
                        clipped.x2 * invZ, clipped.y2 * invZ);
                }
            }
        }
    }

    /**
     * 注册静态物件的太阳投影。调用方只需提供脚底、碰撞半径与视觉高度；
     * 阴影的方向、长度与透明度统一由 EnvironmentLightingSystem 驱动。
     */
    registerStaticSunShadow(options = {}) {
        if (!this._staticSunShadows) this._staticSunShadows = new Map();
        const registrationId = this._nextStaticShadowRegistrationId++;
        const handle = createStaticShadowHandle(
            registrationId,
            Number(options.x) || 0,
            Number(options.y) || 0
        );
        if (options.hull) {
            // footprint 四边形凸包阴影：身份句柄不进入 display list；最终连续几何统一
            // 写入共享层的预三角化命令缓冲，太阳移动仍走原 epsilon 脏检查。
            this._staticSunShadows.set(handle, {
                registrationId,
                hull: true,
                x: options.x || 0,
                y: options.y || 0,
                radius: Math.max(1, options.radius || 10),
                footprintVertices: Array.isArray(options.footprintVertices)
                    ? options.footprintVertices.map((point) => ({ x: point.x, y: point.y }))
                    : null,
                shadowCasterParts: Array.isArray(options.shadowCasterParts)
                    ? options.shadowCasterParts.map((part) => ({
                        ...part,
                        vertices: Array.isArray(part.vertices)
                            ? part.vertices.map((point) => ({ x: point.x, y: point.y }))
                            : [],
                    }))
                    : null,
                shadowCasterSignature: options.shadowCasterSignature || '',
                shadowCasterSource: options.shadowCasterSource || null,
                height: Math.max(0, options.height || 0),
                maxOffset: options.maxOffset,
                opacity: options.opacity,
                enabled: options.enabled !== false,
                depth: options.depth ?? 0,
                visible: options.visible !== false,
                fogHidden: !!options.fogHidden,
                entity: options.entity || null,
                sourceSprite: options.sourceSprite || null,
                flipX: !!options.flipX,
            });
            return handle;
        }
        const radius = Math.max(1, options.radius || 10);
        const footprintWidth = Math.max(1, options.footprintWidth || radius * 2);
        const footprintHeight = Math.max(1, options.footprintHeight || radius * 2 * PERSPECTIVE_SCALE_Y);
        this._staticSunShadows.set(handle, {
            registrationId,
            x: options.x || 0,
            y: options.y || 0,
            radius,
            footprintWidth,
            footprintHeight,
            flipX: !!options.flipX,
            flipY: !!options.flipY,
            height: Math.max(0, options.height || radius * 3),
            maxOffset: options.maxOffset,
            opacity: options.opacity,
            enabled: options.enabled !== false,
            depth: options.depth ?? 0,
            visible: options.visible !== false,
            fogHidden: !!options.fogHidden,
            entity: options.entity || null,
        });
        return handle;
    }

    updateStaticSunShadow(handle, options = {}) {
        const data = this._staticSunShadows && this._staticSunShadows.get(handle);
        if (!data) return;
        Object.assign(data, options);
        if (Number.isFinite(Number(options.x))) handle.x = Number(options.x);
        if (Number.isFinite(Number(options.y))) handle.y = Number(options.y);
    }

    unregisterStaticSunShadow(handle, destroy = true) {
        if (!handle) return;
        this._staticSunShadows.delete(handle);
        if (destroy && handle.active) handle.destroy();
    }

    /** 浏览器控制台阴影校准入口：window.ShadowDebug.inspect / setInset。 */
    _installShadowConsoleTools() {
        if (typeof window === 'undefined') return;
        window.ShadowDebug = {
            listBuildings: () => Array.from(this._structureSunShadows?.keys() || []).map((entity) => ({
                id: entity.id,
                name: entity.name,
                texture: this._neutralSprites?.get(entity)?.sprite?.texture?.key
                    || this._defenseSprites?.get(entity)?.base?.texture?.key
                    || null,
            })),
            inspect: (id = 'defense_base') => this._inspectShadowAlignment(id),
        };
    }

    _inspectShadowAlignment(id) {
        const game = typeof window !== 'undefined' ? window.Game : null;
        const entity = game?.entities?.get(id)
            || Array.from(game?.entities?.values?.() || []).find((item) => item?.id === id || item?.name === id);
        if (!entity) return { ok: false, reason: `未找到实体: ${id}` };
        const neutral = this._neutralSprites?.get(entity);
        const layered = this._defenseSprites?.get(entity);
        const sprite = neutral?.sprite || layered?.base || entity._phaserSprite || null;
        const shadowEntry = this._structureSunShadows?.get(entity) || this._shadowSprites?.get(entity) || null;
        const shadowSprite = Array.isArray(shadowEntry) ? shadowEntry[0] || null : shadowEntry;
        const shadowData = shadowSprite ? this._staticSunShadows?.get(shadowSprite) : null;
        const footprint = this._getGroundShadowFootprint(entity, entity.collisionRadius || 10, sprite
            ? { x: sprite.x, y: sprite.y + this._getFootOffsetY(entity, sprite) }
            : null);
        const visualFoot = sprite
            ? { x: sprite.x, y: sprite.y + this._getFootOffsetY(entity, sprite) }
            : null;
        return {
            ok: true,
            entity: { id: entity.id, name: entity.name, texture: sprite?.texture?.key || null },
            visualFoot,
            footprintCenter: { x: footprint.x, y: footprint.y, width: footprint.width, height: footprint.height },
            shadowRoot: shadowData ? {
                x: shadowData.x,
                y: shadowData.y,
                hull: !!shadowData.hull,
                source: shadowData.shadowCasterSource || null,
                parts: shadowData.shadowCasterParts?.length || 0,
                vertices: Array.isArray(shadowData.footprintVertices)
                    ? shadowData.footprintVertices.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1) }))
                    : null,
            } : null,
            shadowSprite: shadowSprite ? {
                x: shadowSprite.x,
                y: shadowSprite.y,
                rotation: shadowSprite.rotation,
                graphics: !!shadowData?.hull,
            } : null,
            delta: visualFoot && shadowData
                ? { x: shadowData.x - visualFoot.x, y: shadowData.y - visualFoot.y }
                : null,
        };
    }

    /**
     * 解析实体的剪影多边形缓存（建筑/散布障碍物同口径）：
     * manifest shadowSilhouette 逐列数据 + 世界锚点（视觉脚底/贴图底行）+
     * 显示比例与最高列高（延长段归一基准）。静态实体只解析一次。
     */
    _resolveShadowSilhouette(data) {
        const sp = data.sourceSprite;
        if (!sp || !sp.active) return null;
        const meta = lightingAssets.assets?.[sp.texture?.key]?.shadowSilhouette;
        if (!meta || !Array.isArray(meta.columns) || meta.columns.length < 3) return null;
        const texW = Math.max(1, sp.frame?.cutWidth || sp.width || 1);
        const texH = Math.max(1, sp.frame?.cutHeight || sp.height || 1);
        const scaleX = sp.displayWidth / texW;
        const scaleY = sp.displayHeight / texH;
        // 建筑脚底走配置/实测 footOffsetY；散布障碍物贴图底行 = 精灵半高
        const footY = data.entity ? this._getFootOffsetY(data.entity, sp) : sp.displayHeight * 0.5;
        // flipX 一次性镜像列（2026-08-19 部分仙人掌没对齐修复）：列/前顶点先按
        // 贴图中心镜像，下游坡度截断/地面线/展开全部用镜像后几何，flipSign 归一——
        // 否则非对称贴图（单臂仙人掌）的镜像实例接地线与前顶点全部错位。
        const flip = !!data.flipX;
        const mirrorX = (x) => (texW - x);
        const columns = flip
            ? meta.columns.map((c) => [mirrorX(c[0]), c[1], c[2]]).sort((a, b) => a[0] - b[0])
            : meta.columns;
        const frontX = flip ? mirrorX(meta.frontX) : meta.frontX;
        // 实测代表高度（2026-08-19 墙/楼梯"太短"修复）：iso 地面线以上的内容高
        // 75 分位（显示像素）——墙这类高薄件的 data.height 由 footprint 半径低估一半，
        // 影长跟着短一半；剪影迷航归一与 profile.length 统一改用这个实测值。
        const frontTX = columns.reduce((a, c) => (c[2] > a[2] ? c : a), columns[0])[0];
        const contentHeights = columns
            .map((c) => Math.max(0, Math.max(c[2], meta.frontY - 0.5 * Math.abs(c[0] - frontTX)) - c[1]) * scaleY)
            .sort((a, b) => a - b);
        const measuredHeight = Math.max(1, contentHeights[Math.min(contentHeights.length - 1, Math.floor(contentHeights.length * 0.75))]);
        // 阴影实体四边形：与轮廓同一锚点真源（接地曲线生成，对齐由构造保证）。
        // 列已按 flipX 一次性镜像，下游 flipSign 归一为 false。
        const bodyVertices = EnvironmentLightingSystem.getSilhouetteFootprintVertices(columns, {
            scaleX,
            scaleY,
            anchorX: sp.x,
            anchorY: sp.y + footY,
            frontX,
            frontY: meta.frontY,
            texCenterX: texW / 2,
            flipX: false,
        });
        // 城墙楼梯锚点落地：精灵屏幕位置含 z 抬升，
        // 影子锚在那里会浮空——改用 footprint 四边形前顶点（地面真源）。
        let anchorX = sp.x;
        let anchorY = sp.y + footY;
        const ent = data.entity;
        if (ent && ent._isWallStaircase
            && Array.isArray(data.footprintVertices) && data.footprintVertices.length >= 3) {
            const quadFront = data.footprintVertices.reduce((a, b) => (b.y > a.y ? b : a));
            anchorX = quadFront.x - (flip ? -1 : 1) * (frontX - texW / 2) * scaleX;
            anchorY = quadFront.y;
        }
        return {
            columns,
            scaleX,
            scaleY,
            anchorX,
            anchorY,
            frontX,
            frontY: meta.frontY,
            texCenterX: texW / 2,
            flipMirrored: flip,
            measuredHeight,
            bodyVertices: bodyVertices.length >= 3 ? bodyVertices : null,
        };
    }

    _syncStaticSunShadows() {
        if (!this._staticSunShadows) return;
        const dms = DungeonMapSystem;
        const isDungeon = SceneManager.isDungeonIsolationActive();
        const isMapMode = isDungeon && dms && dms.active && dms.state === 'map';
        const shadowJobs = this._structureShadowJobs || [];
        shadowJobs.length = 0;
        let viewportCulled = 0;
        let preGeometryCulled = 0;
        let postGeometryCulled = 0;
        const renderCulling = performanceConfig.renderCulling || {};
        const cameraView = this.cameras?.main?.worldView;
        const configuredShadowPadding = Number(renderCulling.shadowPaddingPx);
        const shadowViewportPadding = Math.max(0,
            Number.isFinite(configuredShadowPadding) ? configuredShadowPadding : 64);
        const shadowViewport = renderCulling.enabled !== false && cameraView
            ? {
                left: cameraView.x - shadowViewportPadding,
                right: cameraView.right + shadowViewportPadding,
                top: cameraView.y - shadowViewportPadding,
                bottom: cameraView.bottom + shadowViewportPadding,
            }
            : null;
        const enqueueVisibleJob = (job) => {
            if (!shadowPolygonIntersectsViewport(job.hull, shadowViewport)) {
                viewportCulled += 1;
                postGeometryCulled += 1;
                return;
            }
            shadowJobs.push(job);
        };
        for (const [handle, data] of this._staticSunShadows.entries()) {
            if (!handle || !handle.active) {
                this._staticSunShadows.delete(handle);
                continue;
            }
            // 共享 Graphics 无法直接隐藏单一建筑；绘制前读取战争迷雾真源，避免新注册
            // 建筑等待帧末 FogVisibilityController 回调时短暂泄漏一帧阴影。
            if (data.entity) {
                const fogHidden = FogOfWarSystem.shouldHideEntity(SceneManager.getCurrentWorldId(), data.entity);
                if (data.fogHidden !== fogHidden) {
                    data.fogHidden = fogHidden;
                    this._structureShadowVisibilityRevision = (this._structureShadowVisibilityRevision || 0) + 1;
                }
            }
            const profile = EnvironmentLightingSystem.getStaticShadow(data, {
                dungeon: isDungeon,
            });
            if (!profile) {
                handle.setVisible(false);
                continue;
            }
            if (profile.opacity <= 0.001 || data.visible === false || data.fogHidden) continue;
            if (!shadowCasterMayReachViewport(data, shadowViewport, profile.length)) {
                viewportCulled += 1;
                preGeometryCulled += 1;
                continue;
            }
            if (data.hull) {
                // 阴影多边形真源：普通建筑 = 独立 shadow caster（visualFootprint/显式低模；
                // 仅异形或缺配置素材回退主体 alpha 接地）；
                // 散布障碍物（无 entity）= 凸包 ∪ manifest 剪影轮廓。两者最终都进入
                // 共享层的纯几何合并，不使用会随贴图换代失配的建筑 manifest 剪影。
                if (data._silCache === undefined) {
                    // 普通建筑和专用结构不消费 manifest 剪影；silhouette 路径只保留给
                    // 散布障碍物，防止建筑换图后旧列数据生成大范围错影。
                    data._silCache = data.entity ? null : this._resolveShadowSilhouette(data);
                }
                const theta = Math.atan2(profile.offsetY, profile.offsetX);
                // 多边形 epsilon 脏检查（2026-08-19 审计性能修复）：太阳角变化 <0.11°
                // 且延长段变化 <0.5px 且顶点签名不变时复用缓存多边形——子像素级步进
                // 无可见跳变，把每帧重建几十上百列点列的 GC/CPU 压力降到脏帧一次。
                const sig = data.shadowCasterSignature || (data.footprintVertices
                    ? data.footprintVertices.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('|')
                    : '');
                const state = data._polyState;
                const dirty = !state
                    || Math.abs(state.theta - theta) > 0.002
                    || Math.abs(state.length - profile.length) > 0.5
                    || state.sig !== sig;
                let hull;
                let cx;
                let cy;
                if (!dirty) {
                    hull = state.points;
                    cx = state.cx;
                    cy = state.cy;
                } else {
                    // 普通建筑可把多个低模 part 分层挤出并合成一个边界；无 part 的专用结构
                    // 继续挤出自身 footprint。散布障碍物再与 manifest 剪影做包络合并。
                    const bodyVerts = (data.entity ? data._silCache?.bodyVertices : null)
                        || data.footprintVertices;
                    const hullBody = data.shadowCasterParts?.length
                        ? EnvironmentLightingSystem.getLayeredShadowPolygon(
                            data.shadowCasterParts,
                            profile,
                            data.height
                        )
                        : (bodyVerts
                            ? EnvironmentLightingSystem.getStaticShadowHull(bodyVerts, profile)
                            : []);
                    const silPoly = data._silCache
                        ? EnvironmentLightingSystem.getSilhouetteShadowPolygon(data._silCache.columns, {
                            theta,
                            length: profile.length,
                            scaleX: data._silCache.scaleX,
                            scaleY: data._silCache.scaleY,
                            anchorX: data._silCache.anchorX,
                            anchorY: data._silCache.anchorY,
                            frontY: data._silCache.frontY,
                            texCenterX: data._silCache.texCenterX,
                            flipX: data.flipX && !data._silCache.flipMirrored,
                            groundLine: data._silCache.groundLine || null,
                            // 归一参考 = 实体自身阴影高度（与 profile.length 同源同单位）——
                            // 列高统计会被矮件稀释（仓库主屋位移被压扁的根因）。
                            maxHeight: Math.max(1, data.height || 1),
                            maxOffset: data.maxOffset ?? profile.length,
                        })
                        : [];
                    hull = data._silCache
                        ? EnvironmentLightingSystem.getUnionShadowPolygon(hullBody, silPoly, { theta })
                        : hullBody;
                    cx = 0;
                    cy = 0;
                    for (const pt of hull) { cx += pt.x; cy += pt.y; }
                    cx /= Math.max(1, hull.length);
                    cy /= Math.max(1, hull.length);
                    data._polyState = { theta, length: profile.length, sig, points: hull, cx, cy };
                }
                if (hull.length >= 3) {
                    enqueueVisibleJob({
                        id: data.registrationId,
                        hull,
                        cx,
                        cy,
                        opacity: profile.opacity,
                        dirty,
                    });
                }
                continue;
            }
            const baseW = data.footprintWidth || data.radius * 2;
            const baseH = data.footprintHeight || data.radius * 2 * PERSPECTIVE_SCALE_Y;
            const screenDiameter = Math.max(baseW, baseH) * Math.max(0.1, Number(this.cameras?.main?.zoom) || 1);
            const capsuleSegments = screenDiameter >= 144 ? 16 : (screenDiameter >= 48 ? 12 : 8);
            // 静态胶囊（树木/桶状仙人掌/墙件）并入共享层：
            // 独立 Sprite 会与结构层跨系统叠加变深（0.19×0.19 合成≈0.35，肉眼可见）——
            // 基础 footprint 始终是水平 2:1 椭圆，只沿归一化太阳方向平移扫掠；
            // 禁止旋转基础椭圆，否则纵向影向会再次把脚底立成竖椭圆。
            // 这些注册体全静态（树/散布障碍），epsilon 脏检查与多边形同口径；
            // 非渲染句柄仅保留为注册键（注销/回链用）。
            handle.setVisible(false);
            const capTheta = Math.atan2(profile.offsetY, profile.offsetX);
            const capSig = `${data.x.toFixed(1)},${data.y.toFixed(1)},${baseW.toFixed(1)},${baseH.toFixed(1)},${capsuleSegments}`;
            const capState = data._polyState;
            const capDirty = !capState
                || Math.abs(capState.theta - capTheta) > 0.002
                || Math.abs(capState.length - profile.length) > 0.5
                || capState.sig !== capSig;
            let capPts;
            let capCx;
            let capCy;
            if (!capDirty) {
                capPts = capState.points;
                capCx = capState.cx;
                capCy = capState.cy;
            } else {
                capCx = data.x + profile.offsetX;
                capCy = data.y + profile.offsetY;
                capPts = EnvironmentLightingSystem.getStaticShadowCapsule({
                    x: data.x,
                    y: data.y,
                    width: baseW,
                    height: baseH,
                    segments: capsuleSegments,
                }, profile);
                data._polyState = { theta: capTheta, length: profile.length, sig: capSig, points: capPts, cx: capCx, cy: capCy };
            }
            if (capPts.length >= 3) {
                enqueueVisibleJob({
                    id: data.registrationId,
                    hull: capPts,
                    cx: capCx,
                    cy: capCy,
                    opacity: profile.opacity,
                    dirty: capDirty,
                });
            }
        }
        // 共享结构阴影层：全部阴影多边形在同一 Graphics 内保持原尺寸外轮廓并向内羽化；
        // 互不相交的簇保留各自透明度，相交簇先并集并取最大透明度。不得外扩或描边。
        // 层深统一读取 WORLD_RENDER_LAYERS.STRUCTURE_SHADOW，禁止散落魔法数。
        const frameSun = EnvironmentLightingSystem.getSun();
        const frameTheta = Math.atan2(frameSun?.shadowY || 0, frameSun?.shadowX || 0);
        const edgeFade = EnvironmentLightingSystem.getShadowEdgeFade();
        const edgeFadeSignature = `${edgeFade.fadePx},${edgeFade.steps},${edgeFade.edgeAlphaRatio}`;
        const viewportSignature = shadowJobs.map((job) => job.id).join(',');
        const layer = this._structureShadowLayer;
        if (layer) {
            // 干净帧保留预三角化的 fillTriangle 命令；不再让 Phaser 4 在每次 render
            // 对数百条 fillPoints 重跑 Earcut。太阳仍按原 epsilon 连续几何更新，
            // 相机只在带 320px 缓冲的可见 caster 集合变化时触发重建。
            let layerOpacity = 0;
            let layerDirty = false;
            for (const job of shadowJobs) {
                layerOpacity = Math.max(layerOpacity, job.opacity);
                if (job.dirty) layerDirty = true;
            }
            const opacitySignature = shadowJobs
                .map((job) => Math.round(job.opacity * 1000))
                .join(',');
            if (shadowJobs.length !== (this._structureShadowJobCount ?? -1)) layerDirty = true;
            if (Math.abs(layerOpacity - (this._structureShadowLayerOpacity ?? -1)) > 0.005) layerDirty = true;
            if (opacitySignature !== (this._structureShadowOpacitySignature || '')) layerDirty = true;
            if (edgeFadeSignature !== (this._structureShadowEdgeFadeSignature || '')) layerDirty = true;
            if (viewportSignature !== (this._structureShadowViewportSignature || '')) layerDirty = true;
            if ((this._structureShadowVisibilityRevision || 0)
                !== (this._structureShadowRenderedVisibilityRevision ?? -1)) layerDirty = true;
            const renderStats = this._structureShadowRenderStats;
            renderStats.visibleJobs = shadowJobs.length;
            renderStats.viewportCulled = viewportCulled;
            renderStats.preGeometryCulled = preGeometryCulled;
            renderStats.postGeometryCulled = postGeometryCulled;
            renderStats.viewportPaddingPx = shadowViewport ? shadowViewportPadding : 0;
            if (layerDirty) {
                const rebuildStartedAt = PerformanceMonitor.begin();
                layer.clear();
                // 相交阴影先几何并集再一次填充（2026-08-19 用户口径"重叠调成一整个、
                // 同一强度"）——不依赖任何混合幂等假设，从结构上杜绝重叠加深。
                const drawJobs = this._mergeShadowJobsIntoClusters(shadowJobs, frameTheta);
                let rawContourVertices = 0;
                let contourVertices = 0;
                let featherPaths = 0;
                let triangles = 0;
                let sourceVertices = 0;
                for (const job of drawJobs) {
                    rawContourVertices += Number(job.hull?._shadowRawVertexCount) || job.hull.length;
                    contourVertices += job.hull.length;
                    // 先完成几何并集，再对最终外轮廓向内分层羽化。第 0 层不外扩，
                    // 最内层复原原 opacity，因此接地边/重叠同深契约保持不变。
                    const featherLayers = EnvironmentLightingSystem.getShadowFeatherLayers(
                        job.hull,
                        job.opacity,
                        { centerX: job.cx, centerY: job.cy }
                    );
                    for (const feather of featherLayers) {
                        const appended = appendTriangulatedShadow(
                            layer,
                            feather.points,
                            0x000000,
                            feather.alpha
                        );
                        featherPaths += appended.paths;
                        triangles += appended.triangles;
                        sourceVertices += appended.sourceVertices;
                    }
                }
                // 各个互不相交的簇可保留自己的透明度；相交簇在合并时取最大值。
                layer.setAlpha(1);
                this._structureShadowJobCount = shadowJobs.length;
                this._structureShadowLayerOpacity = layerOpacity;
                this._structureShadowOpacitySignature = opacitySignature;
                this._structureShadowEdgeFadeSignature = edgeFadeSignature;
                this._structureShadowViewportSignature = viewportSignature;
                this._structureShadowRenderedVisibilityRevision = this._structureShadowVisibilityRevision || 0;
                renderStats.clusters = drawJobs.length;
                renderStats.rawContourVertices = rawContourVertices;
                renderStats.contourVertices = contourVertices;
                renderStats.featherPaths = featherPaths;
                renderStats.triangles = triangles;
                renderStats.sourceVertices = sourceVertices;
                renderStats.commandBufferLength = layer.commandBuffer?.length || 0;
                renderStats.rebuilds += 1;
                const rebuildMs = Math.max(0, PerformanceMonitor.begin() - rebuildStartedAt);
                renderStats.lastRebuildMs = rebuildMs;
                renderStats.rebuildTotalMs = (Number(renderStats.rebuildTotalMs) || 0) + rebuildMs;
                renderStats.rebuildPeakMs = Math.max(
                    Number(renderStats.rebuildPeakMs) || 0,
                    rebuildMs
                );
            }
            const layerVisible = !isMapMode && layerOpacity > 0.001;
            layer.setVisible(layerVisible);
            renderStats.layerVisible = layerVisible;
        }
    }

    /**
     * 相交/相贴的阴影 job 聚簇 + 太阳帧包络合并（2026-08-19 重叠加深根治）。
     * 判定：bbox 粗筛（邻接容差）→ 顶点互含或边相交精判；互不相交的簇
     * 保持独立（禁止桥接远处建筑）。合并后的多边形作为一个整体羽化、统一强度。
     */
    _mergeShadowJobsIntoClusters(jobs, theta) {
        const n = jobs.length;
        if (n <= 1) return jobs;
        const MARGIN = 8; // 相贴聚簇容差 + AA 余量
        const boxes = jobs.map((job) => {
            let x0 = Infinity;
            let y0 = Infinity;
            let x1 = -Infinity;
            let y1 = -Infinity;
            for (const p of job.hull) {
                if (p.x < x0) x0 = p.x;
                if (p.y < y0) y0 = p.y;
                if (p.x > x1) x1 = p.x;
                if (p.y > y1) y1 = p.y;
            }
            return { x0: x0 - MARGIN, y0: y0 - MARGIN, x1: x1 + MARGIN, y1: y1 + MARGIN };
        });
        const parent = jobs.map((_, i) => i);
        const find = (i) => {
            let r = i;
            while (parent[r] !== r) r = parent[r];
            while (parent[i] !== r) { const next = parent[i]; parent[i] = r; i = next; }
            return r;
        };
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = boxes[i];
                const b = boxes[j];
                if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue;
                if (this._shadowPolysTouch(jobs[i].hull, jobs[j].hull)) {
                    const ri = find(i);
                    const rj = find(j);
                    if (ri !== rj) parent[rj] = ri;
                }
            }
        }
        const groups = new Map();
        jobs.forEach((job, i) => {
            const root = find(i);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root).push(job);
        });
        const out = [];
        for (const group of groups.values()) {
            if (group.length === 1) {
                out.push(group[0]);
                continue;
            }
            const merged = EnvironmentLightingSystem.getUnionOfPolygons(group.map((g) => g.hull), { theta });
            if (merged.length >= 3) {
                let cx = 0;
                let cy = 0;
                for (const p of merged) { cx += p.x; cy += p.y; }
                out.push({
                    hull: merged,
                    cx: cx / merged.length,
                    cy: cy / merged.length,
                    opacity: Math.max(...group.map((g) => g.opacity)),
                    dirty: true,
                });
            } else {
                out.push(...group);
            }
        }
        return out;
    }

    /** 两多边形是否相贴/相交：顶点互含 或 任两边相交。 */
    _shadowPolysTouch(polyA, polyB) {
        const pip = (pts, p) => {
            let inside = false;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                const a = pts[i];
                const b = pts[j];
                if ((a.y > p.y) !== (b.y > p.y)
                    && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
            }
            return inside;
        };
        for (const p of polyA) if (pip(polyB, p)) return true;
        for (const p of polyB) if (pip(polyA, p)) return true;
        const segCross = (a1, a2, b1, b2) => {
            const EPSILON = 1e-7;
            const orient = (p, q, r) =>
                (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
            const onSegment = (p, q, r) =>
                q.x >= Math.min(p.x, r.x) - EPSILON
                && q.x <= Math.max(p.x, r.x) + EPSILON
                && q.y >= Math.min(p.y, r.y) - EPSILON
                && q.y <= Math.max(p.y, r.y) + EPSILON;
            const o1 = orient(a1, a2, b1);
            const o2 = orient(a1, a2, b2);
            const o3 = orient(b1, b2, a1);
            const o4 = orient(b1, b2, a2);
            if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON))
                && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
            if (Math.abs(o1) <= EPSILON && onSegment(a1, b1, a2)) return true;
            if (Math.abs(o2) <= EPSILON && onSegment(a1, b2, a2)) return true;
            if (Math.abs(o3) <= EPSILON && onSegment(b1, a1, b2)) return true;
            return Math.abs(o4) <= EPSILON && onSegment(b1, a2, b2);
        };
        for (let i = 0; i < polyA.length; i++) {
            const a1 = polyA[i];
            const a2 = polyA[(i + 1) % polyA.length];
            for (let j = 0; j < polyB.length; j++) {
                if (segCross(a1, a2, polyB[j], polyB[(j + 1) % polyB.length])) return true;
            }
        }
        return false;
    }

    /**
     * 铁栅栏门专用太阳阴影（2026-08-19）：门无 spriteCfg（中立精灵是占位圆），
     * 且地面接触是对角面线而非 V 形底座——body 用门自身 iso footprint 薄矩形，
     * 剪影取 cover_gate_<grade> 帧 0 列、沿实体 `_faceLine`（世界面线真源）映射。
     */
    _ensureGateSunShadow(entity, active) {
        if (!isStructureShadowEnabled(entity)) return;
        const gateTex = entity._cfg?.tex;
        const silMeta = lightingAssets.assets?.[gateTex]?.shadowSilhouette || null;
        const verts = entity.collisionShape === 'iso_rect' ? isoFootprintVertices(entity) : null;
        if (!silMeta || !Array.isArray(silMeta.columns) || silMeta.columns.length < 3
            || !verts || verts.length < 3 || !Array.isArray(entity._faceLine)) return;
        const flip = !!entity._facingLeft;
        const mirrorX = (x) => 640 - x;
        const columns = flip
            ? silMeta.columns.map((c) => [mirrorX(c[0]), c[1], c[2]]).sort((a, b) => a[0] - b[0])
            : silMeta.columns;
        const frontX = flip ? mirrorX(silMeta.frontX) : silMeta.frontX;
        const scale = Number(entity._cfg?.displayScale) || 1;
        const frontTX = columns.reduce((a, c) => (c[2] > a[2] ? c : a), columns[0])[0];
        const contentHeights = columns
            .map((c) => Math.max(0, Math.max(c[2], silMeta.frontY - 0.5 * Math.abs(c[0] - frontTX)) - c[1]) * scale)
            .sort((a, b) => a - b);
        const measuredHeight = Math.max(1, contentHeights[Math.min(contentHeights.length - 1, Math.floor(contentHeights.length * 0.75))]);
        const shadowData = {
            hull: true,
            entity,
            sourceSprite: null,
            x: entity.x,
            y: entity.y,
            footprintVertices: verts.map((p) => ({ x: p.x, y: p.y })),
            height: measuredHeight,
            maxOffset: Math.max(43, measuredHeight * 0.5),
            opacity: entity.shadow?.opacity ?? entity._cfg?.shadow?.opacity,
            depth: (Number(entity._faceDepth) || entity.y) - 0.1,
            visible: true,
        };
        shadowData._silCache = {
            columns,
            scaleX: scale,
            scaleY: scale,
            frontX,
            frontY: silMeta.frontY,
            texCenterX: 320,
            flipMirrored: true,
            measuredHeight,
            groundLine: {
                ax: entity._faceLine[0].x,
                ay: entity._faceLine[0].y,
                bx: entity._faceLine[1].x,
                by: entity._faceLine[1].y,
            },
            bodyVertices: null,
        };
        let shadow = this._structureSunShadows.get(entity);
        if (!shadow || !shadow.active) {
            shadow = this.registerStaticSunShadow(shadowData);
            if (shadow) this._structureSunShadows.set(entity, shadow);
        } else {
            this.updateStaticSunShadow(shadow, shadowData);
        }
        if (shadow) active.add(entity);
    }

    /**
     * 城墙楼梯太阳阴影（2026-08-19 "视作一块整体"定稿）：
     * 楼梯由多块主体拼接（segmentSprites 逐段 z 抬升），逐段出影会有分块感；
     * 贴图内容是对角斜墙，剪影展开会沿贴图对角线偏离全局影向 40°+（七扭八斜根因）。
     * 故整条楼梯一个影：全部段 1×1 footprint 顶点合并成梯轴长带（凸包在
     * getStaticShadowHull 内求），沿全局影向统一挤出；高度取各段剪影实测最大
     * measuredHeight（墙/楼梯影长修复不回退），`_silCache` 置 null 走纯凸包。
     */
    _ensureStairSunShadows(entity, active) {
        if (!isStructureShadowEnabled(entity)) return;
        const neutral = this._neutralSprites && this._neutralSprites.get(entity);
        const segSprites = neutral?.segmentSprites || [];
        const segments = Array.isArray(entity.segments) ? entity.segments : [];
        if (!segments.length || !segSprites.length) {
            // 首帧/重建中：保留既有阴影，避免逐帧注销-重建抖动。
            if (this._structureSunShadows.has(entity)) active.add(entity);
            return;
        }
        const allVerts = [];
        let maxHeight = 0;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg?.collisionShape !== 'iso_rect') continue;
            const verts = isoFootprintVertices(seg);
            for (const p of verts) allVerts.push({ x: p.x, y: p.y });
            const sp = segSprites[i];
            if (!sp?.active) continue;
            const probe = this._resolveShadowSilhouette({
                entity, sourceSprite: sp, flipX: false, footprintVertices: verts,
            });
            if (probe?.measuredHeight > maxHeight) maxHeight = probe.measuredHeight;
        }
        if (allVerts.length < 3) return;
        const effectiveHeight = maxHeight
            || Math.max(64 * 3, (segSprites[0]?.displayHeight || 220) * 0.55) * 0.75 * 0.75;
        const sp0 = segSprites.find((s) => s?.active) || null;
        const shadowData = {
            hull: true,
            entity,
            sourceSprite: sp0,
            x: entity.x,
            y: entity.y,
            radius: 64,
            footprintVertices: allVerts,
            height: effectiveHeight,
            maxOffset: Math.max(43, effectiveHeight * 0.5),
            opacity: entity.shadow?.opacity ?? entity._cfg?.shadow?.opacity,
            depth: (Number(sp0?.depth) || entity.y) - 0.1,
            visible: sp0 ? sp0.visible : true,
            _silCache: null,
        };
        let shadow = this._structureSunShadows.get(entity);
        if (Array.isArray(shadow)) {
            // 分段影残留（上一版方案）：清掉重建
            shadow.forEach((s) => this.unregisterStaticSunShadow(s));
            shadow = null;
        }
        if (!shadow || !shadow.active) {
            shadow = this.registerStaticSunShadow(shadowData);
            if (shadow) this._structureSunShadows.set(entity, shadow);
        } else {
            this.updateStaticSunShadow(shadow, shadowData);
        }
        if (shadow) active.add(entity);
    }

    /**
     * 静态建筑投影：只处理有独立视觉 Sprite 的建筑，掩体/能源矿等保留原贴图底座。
     * 通过防御建筑或标准格网建筑身份识别，后续新建筑无需再各自维护一套太阳投影。
     */
    _syncStructureSunShadows(_game) {
        if (!_game || !_game.entities) return;
        const active = this._structureShadowActiveCasters
            || (this._structureShadowActiveCasters = new Set());
        active.clear();

        // 压平视图只移除建筑自身投影；共享层中的树木/环境障碍阴影继续由
        // _syncStaticSunShadows 绘制，不能直接隐藏整个共享 Graphics。
        if (FlatViewSystem.enabled) {
            for (const [entity, shadow] of this._structureSunShadows.entries()) {
                if (Array.isArray(shadow)) shadow.forEach((s) => this.unregisterStaticSunShadow(s));
                else this.unregisterStaticSunShadow(shadow);
                this._structureSunShadows.delete(entity);
            }
            return;
        }

        const ensure = (entity, sprite) => {
            if (!sprite || !sprite.active) return;
            // 禁用态在昂贵的 footprint/alpha/分层低模解析前退出；旧句柄由尾部清理。
            if (!isStructureShadowEnabled(entity)) return;
            const footprint = this._getGroundShadowFootprint(entity, entity.collisionRadius || 10, {
                x: sprite.x,
                y: sprite.y + this._getFootOffsetY(entity, sprite),
            });
            // radius 仅供静态影注册/旧几何兜底使用，不再参与普通建筑的高度计算。
            const radius = Math.max(18, Math.max(footprint.width, footprint.height) * 0.5);
            // 默认投影高度只取主体 Sprite 的视觉高度，不受建造 footprint/底部铺装尺寸影响；
            // shadowCaster 可按建筑显式覆盖高度并增加分层部件。
            const height = Math.max(24, sprite.displayHeight * 0.72);
            // 先保留 placement footprint 作为兼容兜底；普通建筑随后会优先替换成独立
            // shadow caster 的主体接地多边形，掩体仍沿用专用占地几何。
            let vertices = null;
            if (entity.collisionShape === 'iso_rect') {
                const v = isoFootprintVertices(entity);
                if (v.length >= 3) vertices = v.map((p) => ({ x: p.x, y: p.y }));
            }
            if (!vertices) {
                const hw = footprint.width * 0.5;
                const hh = footprint.height * 0.5;
                vertices = [
                    { x: footprint.x, y: footprint.y - hh },
                    { x: footprint.x + hw, y: footprint.y },
                    { x: footprint.x, y: footprint.y + hh },
                    { x: footprint.x - hw, y: footprint.y },
                ];
            }
            const isCover = !!entity._isDefenseCover;
            // 普通建筑优先使用离线主体影根，未登记时复用 Sprite 的最终 visualFootprint 映射；
            // 仅异形或缺配置素材回退实际 alpha 接地轮廓。独立地面铺装不参与，显式配置仍可覆盖。
            const caster = isCover ? null : resolveStructureShadowCaster(this, entity, sprite, {
                fallbackHeight: height,
                anchorX: footprint.x,
                anchorY: footprint.y,
            });
            if (caster?.contactVertices?.length >= 3) vertices = caster.contactVertices;
            // 掩体继续只借剪影清单取稳定实测高度；普通建筑不再依赖可能随换图失配的 manifest。
            const silCache = isCover ? this._resolveShadowSilhouette({
                entity, sourceSprite: sprite, flipX: !!sprite.flipX,
                footprintVertices: vertices,
            }) : null;
            const effectiveHeight = caster?.height || silCache?.measuredHeight || height;
            const effectiveMaxOffset = caster?.maxOffset
                ?? Math.max(43, effectiveHeight * 0.5);
            let shadow = this._structureSunShadows.get(entity);
            if (Array.isArray(shadow)) {
                // 楼梯分段影残留防御（楼梯走 _ensureStairSunShadows，正常不会到这里）
                shadow.forEach((s) => this.unregisterStaticSunShadow(s));
                shadow = null;
            }
            // 掩体墙（方块墙/各档护墙）只用 footprint 凸包（2026-08-19 用户口径
            // "墙壁阴影基于 footprint 生成"）：墙体贴图内容在画布内偏移大，
            // 剪影实体四边形会比 footprint 宽出近一倍、且沿墙斜向歪轴——
            // 剪影只取实测高度，多边形本体 `_silCache` 置 null 回退凸包。
            const shadowData = {
                hull: true,
                entity,
                sourceSprite: sprite,
                x: footprint.x,
                y: footprint.y,
                radius,
                footprintVertices: vertices,
                shadowCasterParts: caster?.parts || null,
                shadowCasterSignature: caster?.signature || '',
                shadowCasterSource: caster?.source || (isCover ? 'cover_footprint' : 'placement_fallback'),
                height: effectiveHeight,
                maxOffset: effectiveMaxOffset,
                opacity: entity.shadow?.opacity
                    ?? entity.config?.render?.shadow?.opacity
                    ?? entity._cfg?.shadow?.opacity,
                depth: sprite.depth - 0.1,
                visible: sprite.visible,
                _silCache: isCover ? null : silCache,
            };
            if (!shadow || !shadow.active) {
                shadow = this.registerStaticSunShadow(shadowData);
                if (shadow) this._structureSunShadows.set(entity, shadow);
            } else {
                this.updateStaticSunShadow(shadow, shadowData);
            }
            if (shadow) active.add(entity);
        };

        for (const entity of _game.entities.values()) {
            // 2026-08-19：方块墙/铁栅栏门也接入太阳阴影（不再因"贴图自带底座"排除掩体）；
            // 能源矿仍排除（矿点是发光体，贴图自带光效）。
            const isStructure = entity?._isDefenseStructure
                || (usesBuildingFootprintVolume(entity) && entity?._structureDepthMode);
            if (!entity || !entity.active || !isStructure || entity._isEnergyNode) continue;
            if (entity._isCoverGate) {
                this._ensureGateSunShadow(entity, active);
                continue;
            }
            if (entity._isWallStaircase) {
                this._ensureStairSunShadows(entity, active);
                continue;
            }
            if (entity._isDefenseTower) {
                const layered = this._defenseSprites && this._defenseSprites.get(entity);
                ensure(entity, layered && layered.base);
            } else {
                const neutral = this._neutralSprites && this._neutralSprites.get(entity);
                ensure(entity, neutral && neutral.sprite);
            }
        }

        for (const [entity, shadow] of this._structureSunShadows.entries()) {
            if (active.has(entity)) continue;
            if (Array.isArray(shadow)) shadow.forEach((s) => this.unregisterStaticSunShadow(s));
            else this.unregisterStaticSunShadow(shadow);
            this._structureSunShadows.delete(entity);
        }
    }

    _syncMinimapFog(fog, layout, invZ) {
        this._fogMinimapLayer.sync(
            fog,
            this._fogMaskRenderer,
            layout,
            invZ,
            this._minimapStaticGraphics?.visible !== false
            && this._minimapDynamicGraphics?.visible !== false
        );
    }

    /** 场景提交后的原子刷新：先应用目标场景相机缩放，再绕过 100ms 节流重画小地图。 */
    refreshMinimapForSceneTransition() {
        // 固定 HUD 的绘制坐标依赖 1/zoom；必须先让相机消费新 currentScene，
        // 否则回城时会按离场位面的 0.7 zoom 画完，再被 1.0 zoom 放大到地图栏外。
        this._updateCamera();
        this._minimapStaticKey = null;
        this._minimapNextAt = 0;
        this._syncMinimap();
    }

    _syncMinimap() {
        const game = window.Game;
        if (!game || !game.player || game._npcDialoguePaused) return;
        if (!this._isMinimapVisibleForCurrentMode()) {
            this._minimapDynamicGraphics?.clear();
            this._setMinimapLayersVisible(false);
            return;
        }
        // 动态层降频（2026-08-19）：每帧 clear+全表画点 → 100ms 节流，10Hz 对小地图足够流畅
        const now = (this.time && this.time.now) || Date.now();
        if (this._minimapNextAt && now < this._minimapNextAt) return;
        this._minimapNextAt = now + 100;
        // 独立动态层 + 边界检查裁剪（WebGL 不支持 geometry mask，改用绘制前边界判断）
        const g = this._minimapDynamicGraphics;
        if (!g) return;
        g.clear();
        const invZ = this._minimapInvZoom();
        const minimapLayout = this._minimapLayout();
        const {
            minimapCfg, minimapW, minimapH, mx, my, worldW, worldH, scale, offX, offY,
        } = minimapLayout;
        const styles = minimapCfg.styles || {};
        const sizes = minimapCfg.sizes || {};
        // 边界检查：只画小地图框内的内容（替代 WebGL 不支持的 geometry mask）
        const inBox = (x, y) => x >= mx && x <= mx + minimapW && y >= my && y <= my + minimapH;
        const clampX = (x) => Math.max(mx, Math.min(mx + minimapW, x));
        const clampY = (y) => Math.max(my, Math.min(my + minimapH, y));

        // 墙壁数量或世界尺寸/相机 zoom 变化时才重绘静态层：
        // 墙数可能跨场景恰好相同、尺寸必须参与缓存键（2026-08-15 地牢→主神空间教训）；
        // zoom 也必须参与（2026-08-16 世界-122 教训：_syncHud 先于 _updateCamera 运行时
        // 静态层按旧 zoom 的 invZ 绘制、之后 zoom 变化却不重绘 → 背景被相机缩放错位，
        // 动态视野框画到背景框外 + 与左上菜单按钮重叠）
        const wallCount = WallSystem && WallSystem.walls ? WallSystem.walls.length : 0;
        const boundaryCount = WallSystem && WallSystem.isoSegments
            ? WallSystem.isoSegments.filter((s) => s._boundary).length : 0;
        const camZoomForKey = Math.round(((this.cameras.main && this.cameras.main.zoom) || 1) * 1000) / 1000;
        const staticKey = wallCount + ':' + boundaryCount + ':' + worldW + 'x' + worldH + '@' + camZoomForKey
            + '#' + minimapW + 'x' + minimapH + '@' + mx + ',' + my;
        if (staticKey !== this._minimapStaticKey) {
            this._redrawMinimapStatic();
            this._minimapStaticKey = staticKey;
        }

        // 主画面与小地图共享同一张低分辨率 CanvasTexture，避免逐格提交 Graphics 指令。
        const fog = FogOfWarSystem.getGrid(SceneManager.getCurrentWorldId());
        this._syncMinimapFog(fog, minimapLayout, invZ);

        // 相机视野框（与框求交集，超框部分不画）。
        // 2026-08-14：可视世界范围 = VIEW / 相机 zoom——之前无视缩放，世界-122（zoom 0.7）
        // 的黄色视野框比实际视野小一圈，改按实时 zoom 换算（任意缩放通用）。
        // 2026-08-16：视口尺寸改用 Phaser 实际 scale（与 _updateCamera 同源），
        // 不再用固定 CONFIG.VIEW_WIDTH/HEIGHT——窗口非 1920×1080 时视野框会偏小/偏大。
        const camZoom = (this.cameras.main && this.cameras.main.zoom) || 1;
        const viewportW = (this.scale && this.scale.width) || CONFIG.VIEW_WIDTH || 1920;
        const viewportH = (this.scale && this.scale.height) || CONFIG.VIEW_HEIGHT || 1080;
        const camX = mx + offX + (Camera.x - viewportW / (2 * camZoom)) * scale;
        const camY = my + offY + (Camera.y - viewportH / (2 * camZoom)) * scale;
        const viewW = Math.max(1, (viewportW / camZoom) * scale);
        const viewH = Math.max(1, (viewportH / camZoom) * scale);
        const viewColor = this._parseColor(styles.viewFrame || 'rgba(255,200,0,0.6)', 0xffc800, 0.6);
        const fx1 = Math.max(camX, mx), fy1 = Math.max(camY, my);
        const fx2 = Math.min(camX + viewW, mx + minimapW), fy2 = Math.min(camY + viewH, my + minimapH);
        if (fx2 > fx1 && fy2 > fy1) {
            g.lineStyle(1 * invZ, viewColor.color, viewColor.alpha);
            g.strokeRect(fx1 * invZ, fy1 * invZ, (fx2 - fx1) * invZ, (fy2 - fy1) * invZ);
        }

        // 裂隙
        if (SceneManager.isQuestInstance('scene9') && RiftSystem && RiftSystem.rifts) {
            const riftColor = this._parseColor(styles.rift || '#00008B', 0x00008B, 1);
            g.fillStyle(riftColor.color, riftColor.alpha);
            for (const rift of RiftSystem.rifts) {
                if (rift.completed) continue;
                const rx = mx + offX + rift.x * scale;
                const ry = my + offY + rift.y * scale;
                const configuredRadius = Number(sizes.rift ?? sizes.riftRadius);
                const radius = Number.isFinite(configuredRadius) && configuredRadius > 0
                    ? configuredRadius : 2;
                if (inBox(rx, ry)) g.fillCircle(rx * invZ, ry * invZ, radius * invZ);
            }
        }

        // 动态标记样式只解析一次；配置同时兼容旧的 *Radius 字段与早期短字段。
        const portalColor = this._parseColor(styles.portal || '#00aaff', 0x00aaff, 1);
        const bossColor = this._parseColor(styles.boss || '#ff0000', 0xff0000, 1);
        const enemyColor = this._parseColor(styles.enemy || '#ff4444', 0xff4444, 1);
        const itemColor = this._parseColor(styles.drop || styles.item || '#ffd700', 0xffd700, 1);
        const friendlyBuildingColor = this._parseColor(
            styles.friendlyBuilding || '#59a9ff', 0x59a9ff, 1
        );
        const friendlyUnitColor = this._parseColor(
            styles.friendlyUnit || '#56e39f', 0x56e39f, 1
        );
        const markerSize = (shortKey, radiusKey, fallback) => {
            const value = Number(sizes[shortKey] ?? sizes[radiusKey]);
            return Number.isFinite(value) && value > 0 ? value : fallback;
        };
        const portalRadius = markerSize('portal', 'portalRadius', 2.5);
        const enemyRadius = markerSize('enemy', 'enemyRadius', 1.5);
        const dropRadius = markerSize('item', 'dropRadius', 1);
        const friendlyBuildingRadius = markerSize(
            'friendlyBuilding', 'friendlyBuildingRadius', 2.5
        );
        const friendlyUnitRadius = markerSize('friendlyUnit', 'friendlyUnitRadius', 1.75);

        // 友军可能同时登记在 entities、friendlyUnits 与 PartySystem.members；复用 Set 去重，
        // 避免每次 10Hz 小地图刷新创建三份拼接数组或把同一单位重复画亮。
        const friendlyUnits = this._minimapFriendlyUnits
            || (this._minimapFriendlyUnits = new Set());
        friendlyUnits.clear();
        for (const unit of game.friendlyUnits || []) {
            if (unit) friendlyUnits.add(unit);
        }
        for (const member of PartySystem.members || []) {
            if (member) friendlyUnits.add(member);
        }

        // 其它实体：建筑使用方形标记，移动友军稍后统一覆盖成圆点。
        if (game.entities && typeof game.entities.forEach === 'function') {
            game.entities.forEach(e => {
                if (!e || e === game.player || !e.active || e._hideHud) return;
                if (typeof e.x !== 'number' || typeof e.y !== 'number' || isNaN(e.x) || isNaN(e.y)) return;
                if (FogOfWarSystem.shouldHideEntity(SceneManager.getCurrentWorldId(), e)) return;
                const ex = mx + offX + e.x * scale;
                const ey = my + offY + e.y * scale;
                if (!inBox(ex, ey)) return; // 框外实体不画
                if (e.targetScene) {
                    g.fillStyle(portalColor.color, portalColor.alpha);
                    g.fillCircle(ex * invZ, ey * invZ, portalRadius * invZ);
                } else if (e.name === '大块头') {
                    g.fillStyle(bossColor.color, bossColor.alpha);
                    g.fillCircle(ex * invZ, ey * invZ, (enemyRadius * 2) * invZ);
                } else if (e._faction === 'enemy' || e._faction === 'agent') { // 入侵特工同敌人红点
                    g.fillStyle(enemyColor.color, enemyColor.alpha);
                    g.fillCircle(ex * invZ, ey * invZ, enemyRadius * invZ);
                } else if (e.itemData) {
                    g.fillStyle(itemColor.color, itemColor.alpha);
                    g.fillCircle(ex * invZ, ey * invZ, dropRadius * invZ);
                } else if (e._faction === 'companion') {
                    friendlyUnits.add(e);
                } else if (e._faction === 'player'
                    && (e._isDefenseStructure || e._isDefenseTower || e._isDefenseCover
                        || e._isProducerBuilding || e._isHamsterHut || e._buildItemId || e.cfgKey)) {
                    g.fillStyle(friendlyBuildingColor.color, friendlyBuildingColor.alpha);
                    const half = friendlyBuildingRadius * invZ;
                    g.fillRect(ex * invZ - half, ey * invZ - half, half * 2, half * 2);
                }
            });
        }

        // 友军单位最后绘制，确保驻守建筑或与玩家重叠时仍能看见。
        g.fillStyle(friendlyUnitColor.color, friendlyUnitColor.alpha);
        for (const unit of friendlyUnits) {
            if (!unit || unit === game.player || unit.active === false) continue;
            if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y)) continue;
            if (FogOfWarSystem.shouldHideEntity(SceneManager.currentScene, unit)) continue;
            const ux = mx + offX + unit.x * scale;
            const uy = my + offY + unit.y * scale;
            if (!inBox(ux, uy)) continue;
            g.fillCircle(ux * invZ, uy * invZ, friendlyUnitRadius * invZ);
        }

        // 玩家（箭头端点钳制到框内）
        const px = mx + offX + game.player.x * scale;
        const py = my + offY + game.player.y * scale;
        const playerColor = this._parseColor(styles.player || '#00ff00', 0x00ff00, 1);
        if (inBox(px, py)) {
            g.fillStyle(playerColor.color, playerColor.alpha);
            g.fillCircle(px * invZ, py * invZ,
                markerSize('player', 'playerRadius', 3) * invZ);
            const dir = game.player.rotation || 0;
            g.lineStyle(markerSize('arrowLineWidth', 'playerArrowLineWidth', 1.5) * invZ,
                playerColor.color, playerColor.alpha);
            g.beginPath();
            g.moveTo(px * invZ, py * invZ);
            const arrowLength = markerSize('arrowLen', 'playerArrowLength', 6);
            g.lineTo(clampX(px + Math.cos(dir) * arrowLength) * invZ,
                clampY(py + Math.sin(dir) * arrowLength) * invZ);
            g.strokePath();
        }

        // 标题
        const title = minimapCfg.title || {};
        this.minimapTitle.setPosition((mx + (title.offsetX || 4)) * invZ, (my + (title.offsetY || -2)) * invZ);
        this.minimapTitle.setScale(invZ, invZ);
        this.minimapTitle.setStyle({ fontSize: '13px', color: title.color || '#d4c5a9cc', fontFamily: 'SimHei, "Microsoft YaHei", sans-serif' });
        this.minimapTitle.setText(title.text || '地图');
        this.minimapTitle.setVisible(true);
    }

    _syncStructureRenderOrder(_game) {
        if (!_game?.entities) return;
        const now = Number(this.time?.now) || 0;
        const quickKey = [
            _game.entities.size,
            Number(WallSystem._collisionRevision) || 0,
            WallSystem.isoVisuals?.length || 0,
            DefenseSystem.gates?.length || 0,
            this._neutralSprites?.size || 0,
            this._defenseSprites?.size || 0,
        ].join(':');
        if (this._structureOrderCache?.quickKey === quickKey
            && now < (this._structureOrderCache.nextCheckAt || 0)) {
            return;
        }
        const nodes = [];
        const seenGates = new Set();
        const addNode = (node) => {
            if (!node?.bounds || !Number.isFinite(node.baseDepth) || !node.apply) return;
            nodes.push(node);
        };
        const mergeBounds = (items) => {
            const valid = items.filter(Boolean);
            if (!valid.length) return null;
            return valid.reduce((out, b) => ({
                minU: Math.min(out.minU, b.minU),
                maxU: Math.max(out.maxU, b.maxU),
                minV: Math.min(out.minV, b.minV),
                maxV: Math.max(out.maxV, b.maxV),
            }), { ...valid[0] });
        };

        const addGate = (gate) => {
            if (!gate || !gate.active || seenGates.has(gate) || !Array.isArray(gate._depthSegs)) return;
            seenGates.add(gate);
            const sprites = [gate.spriteL, gate.sprite, gate.spriteR];
            const baseDepths = [
                (gate._depthL ?? gate._depthSegs[0]?.depth ?? gate.y) + (gate._seamBiasL || 0),
                gate._depthBars ?? gate._depthSegs[1]?.depth ?? gate.y,
                (gate._depthR ?? gate._depthSegs[2]?.depth ?? gate.y) + (gate._seamBiasR || 0),
            ];
            for (let i = 0; i < gate._depthSegs.length; i++) {
                const seg = gate._depthSegs[i];
                const sprite = sprites[i];
                if (!seg?.A || !seg?.B || !sprite?.active) continue;
                addNode({
                    stableKey: `gate:${gate.id || gate.name || gate.x + ',' + gate.y}:${i}`,
                    bounds: segmentIsoBounds(seg.A, seg.B, gate._coverHalfThick || gate._cfg?.halfThick || 12),
                    baseDepth: baseDepths[i],
                    apply: (depth) => {
                        seg.depth = depth;
                        sprite.setDepth(depth);
                        if (i === 1) {
                            const channels = gate._structureRenderDepth === depth
                                ? gate._structureRenderChannels
                                : structureDepthChannels(depth);
                            gate._structureRenderDepth = depth;
                            gate._structureRenderChannels = channels;
                        }
                    },
                });
            }
        };

        for (const entity of _game.entities.values()) {
            if (!entity || !entity.active) continue;
            if (entity._isCoverGate) {
                addGate(entity);
                continue;
            }
            // 格网建筑身份与“可被敌人攻击的防御建筑”分离：主神空间祭坛保留 NPC 交互，
            // 但仍必须和墙、门、其他建筑进入同一 footprint 拓扑排序。
            if (!entity._isEnergyNode
                && !entity._isDefenseStructure
                && !(usesBuildingFootprintVolume(entity) && entity._structureDepthMode)) continue;
            const bounds = entity._isEnergyNode && Array.isArray(entity._faceLine)
                ? segmentIsoBounds(entity._faceLine[0], entity._faceLine[1], 1)
                : structureIsoBounds(entity);
            if (!bounds) continue;
            const neutral = this._neutralSprites?.get(entity);
            const tower = this._defenseSprites?.get(entity);
            const sprite = entity._isDefenseTower
                ? tower?.base
                : (neutral?.sprite || entity._phaserSprite);
            if (!sprite?.active) continue;
            if (entity._isDefenseCover
                && Number.isFinite(entity._faceDepth)
                && (!Number.isFinite(entity._structureTopologyObservedFaceDepth)
                    || Math.abs(entity._faceDepth - entity._structureTopologyObservedFaceDepth) > 0.001)) {
                // _faceDepth 永远保留几何前缘；建造系统修正墙角 bias 后只更新拓扑基准，
                // 最终渲染结果进入 _structureRenderDepth，不再反写并污染几何真源。
                entity._structureTopologyBaseDepth = entity._faceDepth;
                entity._structureTopologyObservedFaceDepth = entity._faceDepth;
            }
            if (!Number.isFinite(entity._structureTopologyBaseDepth)) {
                entity._structureTopologyBaseDepth = Number.isFinite(entity._structureFrontDepth)
                    ? entity._structureFrontDepth
                    : (Number.isFinite(entity._faceDepth) ? entity._faceDepth : entity.y + 12);
            }
            addNode({
                stableKey: `entity:${entity.id || entity.name || entity.x + ',' + entity.y}`,
                entity,
                bounds,
                visualBounds: structureOcclusionBounds(entity),
                baseDepth: entity._structureTopologyBaseDepth,
                apply: (depth) => {
                    const channels = entity._structureRenderDepth === depth
                        ? entity._structureRenderChannels
                        : structureDepthChannels(depth);
                    entity._structureRenderDepth = depth;
                    entity._structureRenderChannels = channels;
                    sprite.setDepth(channels.sprite);
                    if (neutral?.groundContactSprite?.active) {
                        neutral.groundContactSprite.setDepth(
                            this._groundContactDepth(depth, neutral.sprCfg?.groundContact));
                    }
                    if (neutral?.overlaySprite?.active) {
                        neutral.overlaySprite.setDepth(channels.sprite + 0.01);
                    }
                    if (neutral?.foregroundSprite?.active) {
                        neutral.foregroundSprite.setDepth(this._foregroundOverlayDepth(
                            entity, depth, neutral.sprCfg?.foregroundOverlay));
                    }
                    if (neutral?.workingEffectGraphics?.active) {
                        neutral.workingEffectGraphics.setDepth(channels.sprite + 0.015);
                    }
                    if (neutral?.staffingWarningGraphics?.active) {
                        neutral.staffingWarningGraphics.setDepth(channels.label + 0.02);
                    }
                    if (neutral?.label?.active) neutral.label.setDepth(channels.label);
                    if (tower) {
                        tower.base.setDepth(channels.sprite);
                        tower.arm?.setDepth(channels.frontFx);
                        tower.weapon?.setDepth(channels.smoke);
                    }
                },
            });
        }

        addGate(DefenseSystem.gate);
        for (const gate of DefenseSystem.gates || []) addGate(gate);

        for (let i = 0; i < (WallSystem.isoVisuals || []).length; i++) {
            const piece = WallSystem.isoVisuals[i];
            if (!piece?._sprite?.active) continue;
            const geo = typeof WallSystem._geoForTex === 'function' ? WallSystem._geoForTex(piece.tex) : null;
            if (geo?.category === 'obstacle') continue;
            const segments = typeof WallSystem._pieceBaseSegments === 'function'
                ? WallSystem._pieceBaseSegments(piece)
                : [];
            const bounds = mergeBounds(segments.map(([a, b]) => segmentIsoBounds(a, b, 8)));
            if (!bounds) continue;
            if (!Number.isFinite(piece._structureTopologyBaseDepth)) {
                piece._structureTopologyBaseDepth = Number.isFinite(piece.depth) ? piece.depth : piece.y;
            }
            addNode({
                stableKey: `wall:${piece._topologyId || (piece._topologyId = `${i}:${piece.tex}:${piece.x},${piece.y}`)}`,
                bounds,
                baseDepth: piece._structureTopologyBaseDepth,
                apply: (depth) => {
                    piece.depth = depth;
                    piece._sprite.setDepth(depth);
                },
            });
        }

        const signature = nodes.map((node) => {
            const b = node.bounds;
            const v = node.visualBounds;
            const visualKey = v
                ? `${v.minX.toFixed(1)},${v.maxX.toFixed(1)},${v.minY.toFixed(1)},${v.maxY.toFixed(1)}`
                : '-';
            const towerForegroundOffset = node.entity?._isWallTower
                ? Number(node.entity.spriteCfg?.foregroundOverlay?.depthOffset)
                : NaN;
            const towerForegroundKey = Number.isFinite(towerForegroundOffset)
                ? towerForegroundOffset.toFixed(2)
                : '-';
            return `${node.stableKey}:${b.minU.toFixed(2)},${b.maxU.toFixed(2)},${b.minV.toFixed(2)},${b.maxV.toFixed(2)}:${visualKey}:${node.baseDepth.toFixed(2)}:${towerForegroundKey}`;
        }).join('|');
        if (!this._structureOrderCache || this._structureOrderCache.signature !== signature) {
            let depths = resolveStructureRenderOrder(nodes);
            // 塔楼前缘属于精灵内的局部遮挡层，不是独立拓扑节点；先取得塔楼最终深度，
            // 再为前侧相接墙补齐一个静态结构槽，并重算一次以传播到其后继结构。
            if (this._applyWallTowerFrontWallDepthFloors(nodes, depths)) {
                depths = resolveStructureRenderOrder(nodes);
            }
            this._structureOrderCache = {
                signature,
                depths,
            };
            WallSystem._faceSegCache = null;
            WallSystem._faceSegColumnIndex = null;
        }
        this._structureOrderCache.quickKey = quickKey;
        // 静态拓扑无需每渲染帧重建节点、Set、闭包与长签名；数量/碰撞修订变化仍会立即触发。
        this._structureOrderCache.nextCheckAt = now + 250;
        const depths = this._structureOrderCache.depths;
        for (const node of nodes) {
            const depth = depths.get(node.stableKey);
            if (Number.isFinite(depth)) node.apply(depth);
        }
    }

    _syncBuildingDamageFx(_game) {
        if (!_game?.entities) return;
        if (FlatViewSystem.enabled) {
            // 建筑立面不可见时同步回收其附着火焰/烟雾；退出压平后会按血量自动重建。
            for (const entity of _game.entities.values()) {
                if (entity?._buildingDamageFx?.active) entity._buildingDamageFx.destroy();
            }
            return;
        }
        for (const entity of _game.entities.values()) {
            if (!isBuildingDamageFxTarget(entity)) continue;
            const count = buildingDamageFlameCount(entity);
            if (count > 0) {
                if (!entity._buildingDamageFx?.active) {
                    entity._buildingDamageFx = new BuildingDamageFx(entity);
                    EffectManager.add(entity._buildingDamageFx);
                }
            } else if (entity._buildingDamageFx?.active) {
                entity._buildingDamageFx.destroy();
            }
        }
    }

    /** 恢复城墙楼梯专用的分段Sprite渲染；四方向贴图本身已定向，禁止再次flip。 */
    _syncWallStaircaseEntity(e, data) {
        if (!e?._isWallStaircase
            || !Array.isArray(e.visualSegments)
            || !e.visualSegments.length
            || !data) return false;
        const segmentSprites = Array.isArray(data.segmentSprites)
            ? data.segmentSprites
            : [];
        for (let index = 0; index < e.visualSegments.length; index++) {
            const visual = e.visualSegments[index];
            if (!visual?.texture || !this.textures.exists(visual.texture)) continue;
            let segmentSprite = segmentSprites[index];
            if (!segmentSprite?.active) {
                segmentSprite = index === 0 && data.sprite?.active
                    ? data.sprite
                    : this.add.sprite(visual.x, visual.y, visual.texture);
                segmentSprites[index] = segmentSprite;
            }
            if (segmentSprite.texture.key !== visual.texture) {
                segmentSprite.setTexture(visual.texture);
            }
            segmentSprite.setOrigin(0.5, 0.5);
            segmentSprite.setPosition(visual.x, visual.y);
            segmentSprite.setDisplaySize(visual.displayWidth, visual.displayHeight);
            segmentSprite.setFlipX(false);
            segmentSprite.setFlipY(false);
            segmentSprite.setRotation(0);
            segmentSprite.setDepth(
                typeof e.renderDepthForSegment === 'function'
                    ? e.renderDepthForSegment(index)
                    : (Number(e._structureRenderDepth) || e.y + 12) + index * 0.01
            );
            segmentSprite.setVisible(true);
        }
        while (segmentSprites.length > e.visualSegments.length) {
            const stale = segmentSprites.pop();
            if (stale?.active) stale.destroy();
        }
        data.segmentSprites = segmentSprites;
        data.sprite = segmentSprites[0] || data.sprite;
        e._actualMaxRenderDepth = segmentSprites.reduce(
            (maxDepth, segmentSprite) =>
                segmentSprite?.active ? Math.max(maxDepth, segmentSprite.depth) : maxDepth,
            -Infinity
        );
        if (data.label) {
            if (data.label.text !== '') data.label.setText('');
            data.label.setVisible(false);
        }
        return true;
    }

    /** 楼梯探针/热更新入口：刷新当前场景全部分段楼梯。 */
    _syncWallStaircaseLayers(_game) {
        if (!_game?.entities || !this._neutralSprites) return;
        for (const e of _game.entities.values()) {
            if (!e?._isWallStaircase || !e.active) continue;
            const data = this._neutralSprites.get(e);
            if (data) this._syncWallStaircaseEntity(e, data);
        }
    }

    _buildingVisualPhase(entity) {
        const value = String(entity?.id || entity?.name || 'building');
        let hash = 0;
        for (let index = 0; index < value.length; index++) {
            hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
        }
        return (hash % 6283) / 1000;
    }

    _resolveBuildingWorkingEffectConfig(sprCfg) {
        const cfg = sprCfg?.workingEffect;
        return ['crystal_tip_sparkle', 'chimney_smoke', 'steam_puff', 'forge_sparks']
            .includes(cfg?.type) ? cfg : null;
    }

    _mixWorkingEffectColor(from, to, amount) {
        const t = Math.max(0, Math.min(1, Number(amount) || 0));
        const channel = (shift) => Math.round(
            ((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * t
        );
        return (channel(16) << 16) | (channel(8) << 8) | channel(0);
    }

    _buildingWorkingEffectColor(cfg, phase) {
        const configured = Array.isArray(cfg?.colors) ? cfg.colors : [];
        const palette = (configured.length >= 2 ? configured : ['#4387ff', '#3ee9f2', '#ffd56a'])
            .map((value) => this._parseColor(value, 0x4387ff).color);
        const scaled = ((phase % 1) + 1) % 1 * palette.length;
        const index = Math.floor(scaled) % palette.length;
        const rawT = scaled - Math.floor(scaled);
        const smoothT = rawT * rawT * (3 - 2 * rawT);
        return this._mixWorkingEffectColor(
            palette[index],
            palette[(index + 1) % palette.length],
            smoothT
        );
    }

    /**
     * 建筑营业微动态：只读经济系统的真实产出标记，以平滑确定性相位绘制，
     * 不创建粒子实体、计时器或存档状态，也不改变建筑 footprint 与交互范围。
     */
    _syncBuildingWorkingEffect(entity, data, sprite) {
        const cfg = this._resolveBuildingWorkingEffectConfig(data?.sprCfg);
        if (!cfg) {
            if (data?.workingEffectGraphics?.active) data.workingEffectGraphics.destroy();
            if (data) {
                data.workingEffectGraphics = null;
                data.workingEffectVisible = false;
            }
            return;
        }
        if (!data.workingEffectGraphics?.active) {
            data.workingEffectGraphics = this.add.graphics();
            data.workingEffectGraphics.setBlendMode(BlendModes.ADD);
        }
        const graphics = data.workingEffectGraphics;
        const working = entity?._economyWorking === true
            && entity?._sinking !== true
            && Number(entity?.hp) > 0;
        data.workingEffectVisible = working;
        if (!working) {
            graphics.clear();
            graphics.setVisible(false);
            return;
        }

        const phaseOffset = Number(data.workingEffectPhase) || 0;
        const now = Number(this.time?.now) || 0;
        const cycleMs = Math.max(900, Number(cfg.cycleMs) || 3000);
        const phase = ((now / cycleMs) + phaseOffset / (Math.PI * 2)) % 1;
        const color = this._buildingWorkingEffectColor(cfg, phase);
        const scaleX = (Number(sprite.displayWidth) || 1)
            / Math.max(1, Number(data.sprCfg?.size) || Number(sprite.displayWidth) || 1);
        const scaleY = (Number(sprite.displayHeight) || 1)
            / Math.max(1, Number(data.sprCfg?.sizeH) || Number(sprite.displayHeight) || 1);
        const effectScale = Math.sqrt(Math.max(0.01, scaleX * scaleY));
        const radius = Math.max(6, (Number(cfg.radius) || 18) * effectScale);
        const xDirection = sprite.flipX ? -1 : 1;
        const tipX = sprite.x + ((Number(cfg.tipXRatio) || 0.5) - 0.5)
            * sprite.displayWidth * xDirection;
        const tipY = sprite.y + ((Number(cfg.tipYRatio) || 0.1) - 0.5)
            * sprite.displayHeight;
        const pulse = 0.5 + Math.sin(phase * Math.PI * 2) * 0.5;
        const haloRadius = radius * (0.86 + pulse * 0.24);

        graphics.clear();
        graphics.setPosition(tipX, tipY);
        graphics.setDepth((Number(sprite.depth) || 0) + 0.015);
        graphics.setVisible(true);
        if (cfg.type === 'chimney_smoke' || cfg.type === 'steam_puff') {
            graphics.setBlendMode(BlendModes.NORMAL);
            const puffCount = Math.max(3, Math.min(8, Math.floor(Number(cfg.puffCount) || 5)));
            const rise = Math.max(radius * 2, (Number(cfg.rise) || 54) * effectScale);
            const drift = (Number(cfg.drift) || 16) * effectScale * (sprite.flipX ? -1 : 1);
            const palette = (Array.isArray(cfg.colors) && cfg.colors.length
                ? cfg.colors : (cfg.type === 'steam_puff'
                    ? ['#dbe7ea', '#aebfc4'] : ['#6f6963', '#91877c']))
                .map((value) => this._parseColor(value, 0x77716a).color);
            for (let index = 0; index < puffCount; index++) {
                const life = (phase * 0.86 + index / puffCount + phaseOffset * 0.07) % 1;
                const sway = Math.sin(life * Math.PI * 2 + index * 1.9) * radius * 0.32;
                const x = drift * life + sway;
                const y = -rise * life;
                const puffRadius = radius * (0.38 + life * 0.72);
                const alpha = Math.sin(life * Math.PI)
                    * (cfg.type === 'steam_puff' ? 0.2 : 0.16);
                graphics.fillStyle(palette[index % palette.length], alpha);
                graphics.fillCircle(x, y, puffRadius);
            }
            return;
        }
        if (cfg.type === 'forge_sparks') {
            graphics.setBlendMode(BlendModes.ADD);
            const palette = (Array.isArray(cfg.colors) && cfg.colors.length
                ? cfg.colors : ['#ffb52e', '#ff6a1a', '#fff0a0'])
                .map((value) => this._parseColor(value, 0xffa12e).color);
            graphics.fillStyle(palette[0], 0.08 + pulse * 0.08);
            graphics.fillCircle(0, 0, radius * (0.65 + pulse * 0.2));
            const sparkCount = Math.max(5, Math.min(12, Math.floor(Number(cfg.sparkCount) || 8)));
            for (let index = 0; index < sparkCount; index++) {
                const life = (phase * 2.1 + index / sparkCount + phaseOffset * 0.13) % 1;
                const angle = -Math.PI * (0.18 + (index % 5) * 0.13);
                const distance = radius * (0.35 + life * 1.8);
                const x = Math.cos(angle) * distance * (sprite.flipX ? -1 : 1);
                const y = Math.sin(angle) * distance - life * radius * 0.55;
                const alpha = Math.sin(life * Math.PI) * 0.9;
                const sparkRadius = Math.max(0.8, radius * (0.05 + (index % 2) * 0.018));
                const sparkColor = palette[index % palette.length];
                graphics.fillStyle(sparkColor, alpha);
                graphics.fillCircle(x, y, sparkRadius);
                graphics.lineStyle(Math.max(0.7, sparkRadius * 0.75), sparkColor, alpha * 0.7);
                graphics.lineBetween(x, y, x - Math.cos(angle) * sparkRadius * 4,
                    y - Math.sin(angle) * sparkRadius * 4);
            }
            return;
        }
        graphics.setBlendMode(BlendModes.ADD);
        graphics.fillStyle(color, 0.045 + pulse * 0.025);
        graphics.fillCircle(0, 0, haloRadius * 1.55);
        graphics.fillStyle(color, 0.09 + pulse * 0.05);
        graphics.fillCircle(0, 0, haloRadius);
        graphics.fillStyle(color, 0.18 + pulse * 0.08);
        graphics.fillCircle(0, 0, haloRadius * 0.48);
        graphics.lineStyle(Math.max(1, 1.4 * effectScale), color, 0.56 + pulse * 0.24);
        graphics.strokeCircle(0, 0, haloRadius * 0.72);
        graphics.lineBetween(-haloRadius * 0.72, 0, haloRadius * 0.72, 0);
        graphics.lineBetween(0, -haloRadius, 0, haloRadius);
        graphics.lineStyle(Math.max(1, effectScale), 0xffffff, 0.6 + pulse * 0.3);
        graphics.lineBetween(-haloRadius * 0.38, -haloRadius * 0.38,
            haloRadius * 0.38, haloRadius * 0.38);
        graphics.lineBetween(haloRadius * 0.38, -haloRadius * 0.38,
            -haloRadius * 0.38, haloRadius * 0.38);
        graphics.fillStyle(0xffffff, 0.86);
        graphics.fillCircle(0, 0, Math.max(1.5, 2.2 * effectScale));

        // 四颗确定性上升光屑：相位错开、横向轻摆，避免逐帧随机造成跳闪。
        for (let index = 0; index < 4; index++) {
            const life = (phase * 1.45 + index / 4 + phaseOffset * 0.11) % 1;
            const sparkleX = Math.sin(life * Math.PI * 2 + index * 1.7) * radius * 0.72;
            const sparkleY = radius * 0.62 - life * radius * 1.8;
            const sparkleAlpha = Math.sin(life * Math.PI) * 0.72;
            const sparkleColor = this._buildingWorkingEffectColor(cfg, (phase + index / 4) % 1);
            const sparkleRadius = Math.max(0.8, (1.1 + (index % 2) * 0.55) * effectScale);
            graphics.fillStyle(sparkleColor, sparkleAlpha);
            graphics.fillCircle(sparkleX, sparkleY, sparkleRadius);
            if (index < 2) {
                graphics.lineStyle(Math.max(0.75, 0.9 * effectScale), sparkleColor,
                    sparkleAlpha * 0.7);
                graphics.lineBetween(sparkleX - sparkleRadius * 2.2, sparkleY,
                    sparkleX + sparkleRadius * 2.2, sparkleY);
                graphics.lineBetween(sparkleX, sparkleY - sparkleRadius * 2.2,
                    sparkleX, sparkleY + sparkleRadius * 2.2);
            }
        }
    }

    /**
     * 有岗位但零上岗人口的经济建筑显示旋转禁止标识。图形只由描边组成，
     * 中心保持透明；相位由建筑稳定 ID 决定，避免多栋建筑完全同步。
     */
    _syncBuildingStaffingWarning(entity, data, sprite) {
        const roadBlocked = ((entity?._economyType === 'bakery'
            || entity?._economyType === 'desert_cookhouse'
            || entity?._economyType === 'frost_smokehouse'
            || entity?._economyType === 'chain_restaurant')
            && BakeryEconomySystem.getSnapshot(entity).roadConnected === false)
            || ((entity?._economyType === 'cheese_farm'
                || entity?._economyType === 'corn_farm'
                || entity?._economyType === 'mushroom_farm')
                && CheeseFarmSystem.getSnapshot(entity).roadConnected === false)
            || (entity?._economyType === 'steam_power_plant'
                && SteamPowerPlantSystem.getSnapshot(entity).roadConnected === false);
        const visible = (PopulationEconomySystem.isWorkforceUnstaffed(entity) || roadBlocked)
            && entity?._sinking !== true
            && Number(entity?.hp) > 0;
        data.staffingWarningVisible = visible;
        if (!visible) {
            const graphics = data.staffingWarningGraphics;
            if (graphics) {
                if (Object.prototype.hasOwnProperty.call(graphics, '_fogRestoreVisible')) {
                    graphics._fogRestoreVisible = false;
                }
                graphics.setVisible(false);
            }
            return;
        }
        if (!data.staffingWarningGraphics?.active) {
            const graphics = this.add.graphics();
            const radius = NO_WORKERS_INDICATOR.radius;
            const slashReach = radius * 0.72;
            graphics.lineStyle(8, NO_WORKERS_INDICATOR.shadowColor, 0.88);
            graphics.strokeCircle(0, 0, radius);
            graphics.lineBetween(-slashReach, -slashReach, slashReach, slashReach);
            graphics.lineStyle(4.5, NO_WORKERS_INDICATOR.ringColor, 1);
            graphics.strokeCircle(0, 0, radius);
            graphics.lineBetween(-slashReach, -slashReach, slashReach, slashReach);
            graphics.lineStyle(1.2, NO_WORKERS_INDICATOR.highlightColor, 0.82);
            graphics.strokeCircle(0, 0, radius - 2.2);
            graphics.lineBetween(-slashReach + 1.5, -slashReach + 1.5,
                slashReach - 1.5, slashReach - 1.5);
            data.staffingWarningGraphics = graphics;
        }
        const graphics = data.staffingWarningGraphics;
        const now = Number(this.time?.now) || 0;
        const phaseOffset = Number(data.staffingWarningPhase) || 0;
        const phase = ((now / NO_WORKERS_INDICATOR.cycleMs)
            + phaseOffset / (Math.PI * 2)) % 1;
        const pulse = 0.5 + Math.sin(phase * Math.PI * 2) * 0.5;
        graphics.setPosition(
            sprite.x,
            sprite.y - sprite.displayHeight / 2
                - NO_WORKERS_INDICATOR.radius - NO_WORKERS_INDICATOR.topGap
        );
        graphics.setRotation(phase * Math.PI * 2);
        graphics.setScale(0.96 + pulse * 0.06);
        graphics.setAlpha(0.82 + pulse * 0.18);
        graphics.setDepth(Number.isFinite(entity?._structureRenderChannels?.label)
            ? entity._structureRenderChannels.label + 0.02
            : (Number(sprite.depth) || 0) + 1.02);
        if (Object.prototype.hasOwnProperty.call(graphics, '_fogRestoreVisible')) {
            graphics._fogRestoreVisible = true;
            graphics.setVisible(false);
        } else {
            graphics.setVisible(true);
        }
    }

    /**
     * 同步无专属 Phaser Sprite 的实体（训练靶、NPC 等）
     */
    _syncNeutralEntities(_game) {
        if (!_game || !_game.entities) return;
        const active = this._neutralActiveEntities || (this._neutralActiveEntities = new Set());
        active.clear();
        const player = _game.player;
        for (const e of _game.entities.values()) {
            if (!e || e === player) continue;
            if (e._phaserSprite && e._phaserSprite.active) continue;
            if (!e.active) continue;
            // 防御塔由 _syncDefenseTowers 专属渲染（基座/臂/武器三层）
            if (e._skipNeutralSprite) continue;
            // 敌人由 _syncEntityHud 统一绘制名字/血条，避免重复标签
            if (e._faction === 'enemy' && !e._strategicFortification) continue;
            // 已由侍从渲染管线（_syncCompanionSprites，键 = 实体 id）接管的友方单位
            // （露娜/仓鼠矿工等）跳过中立占位圆——2026-08-15 仓鼠矿工「贴图背后棕色圆圈」
            // 根因：兜底 neutral_circle（白色）被缺省色 #d4c5a9 染色成棕圆叠在精灵下层，
            // 并重复生成名字/血条标签
            if (this._companionSprites && this._companionSprites[e.id]) continue;
            active.add(e);

            const desiredSprCfg = e.spriteCfg?.idleKey ? e.spriteCfg : null;
            const desiredLayerKeys = [
                desiredSprCfg?.overlayAnimation?.textureKey,
                desiredSprCfg?.groundContact?.textureKey,
                desiredSprCfg?.foregroundOverlay?.textureKey,
            ].filter(Boolean);
            const missingDesiredVisual = desiredSprCfg && (
                !this.textures.exists(desiredSprCfg.idleKey)
                || desiredLayerKeys.some((key) => !this.textures.exists(key))
                || !RuntimeAssetManager.isTextureReady(desiredSprCfg.idleKey, this)
                || desiredLayerKeys.some((key) => !RuntimeAssetManager.isTextureReady(key, this))
            );
            const managedBuildingVisual = RuntimeAssetManager.isBuildingVisualKey(
                desiredSprCfg?.idleKey
            ) || desiredLayerKeys.some((key) => RuntimeAssetManager.isBuildingVisualKey(key));
            if (missingDesiredVisual && managedBuildingVisual) {
                const now = Number(this.time?.now) || 0;
                if (e._buildingAssetRequestKey !== desiredSprCfg.idleKey
                    || now >= (Number(e._buildingAssetRetryAt) || 0)) {
                    e._buildingAssetRequestKey = desiredSprCfg.idleKey;
                    e._buildingAssetRetryAt = now + 5000;
                    RuntimeAssetManager.ensureBuildingEntities([e], { required: false });
                }
            }

            let data = this._neutralSprites.get(e);
            if (!this._isEntityInRenderViewport(e)) {
                if (data) this._setViewportEntityHidden(e, true);
                continue;
            }
            if (data) this._setViewportEntityHidden(e, false);
            if (!data) {
                // 贴图动画 NPC（config.sprite 配置 idle/walk 动画键）；无配置保持纯色圆
                const sprCfg = (e.spriteCfg && RuntimeAssetManager.isTextureReady(e.spriteCfg.idleKey, this))
                    ? e.spriteCfg : null;
                let sprite;
                if (sprCfg) {
                    const sz = sprCfg.size || 128;
                    const szH = sprCfg.sizeH || sz; // 等比非方形显示（防御塔等竖版建筑）
                    const staticFrame = Number.isInteger(sprCfg.frame) ? sprCfg.frame : undefined;
                    sprite = this.add.sprite(e.x, e.y, sprCfg.idleKey, staticFrame);
                    sprite.setOrigin(0.5, 0.5);
                    sprite.setDisplaySize(sz, szH);
                    // 静态贴图（无动画注册）直接显示首帧，不 play
                    if (this.anims.exists(sprCfg.idleKey)) sprite.play(sprCfg.idleKey);
                    // 动画帧触发音效（game-config npcs.*.sprite.frameSounds：
                    // 循环动画播到指定帧（1 基帧号）各播放一次；sprite 每实体只创建一次，监听不重复）
                    const fsCfg = sprCfg.frameSounds;
                    if (fsCfg && Array.isArray(fsCfg.frames) && fsCfg.frames.length && fsCfg.path) {
                        sprite.on('animationupdate', (_anim, frame) => {
                            if (fsCfg.frames.includes(frame.index) && SoundManager) {
                                // 世界坐标音效：按与玩家的距离衰减（默认传播距离 2000px，
                                // 远离 NPC 逐步减弱直到静音，见 data/audio-config.json distanceAttenuation）
                                if (typeof SoundManager.playWorld === 'function') {
                                    SoundManager.playWorld(fsCfg.path, e.x, e.y);
                                } else if (typeof SoundManager.playFile === 'function') {
                                    SoundManager.playFile(fsCfg.path);
                                }
                            }
                        });
                    }
                } else {
                    if (!this.textures.exists('neutral_circle')) {
                        const g = this.add.graphics();
                        g.fillStyle(0xffffff, 1);
                        g.fillCircle(16, 16, 16);
                        g.generateTexture('neutral_circle', 32, 32);
                        g.destroy();
                    }
                    const size = e.size || 16;
                    sprite = this.add.sprite(e.x, e.y, 'neutral_circle');
                    sprite.setOrigin(0.5, 0.5);
                    sprite.setDisplaySize(size * 2, size * 2);
                }
                  const labelFontSize = (SceneManager && SceneManager.currentScene === 'scene8') ? '14px' : '11px';
                const label = this.add.text(e.x, e.y - (e.size || 16) - 8, '', {
                    fontFamily: 'SimHei, "Microsoft YaHei", "黑体", sans-serif',
                    fontSize: '11px',
                    color: '#d4c5a9',
                    align: 'center',
                    stroke: '#000000', strokeThickness: 3,
                });
                label.setOrigin(0.5, 1);
                  label.setFontSize(labelFontSize);
                label.setDepth(e.y + 1);
                let overlaySprite = null;
                const overlayCfg = sprCfg?.overlayAnimation;
                if (overlayCfg?.textureKey && this.textures.exists(overlayCfg.textureKey)) {
                    overlaySprite = this.add.sprite(e.x, e.y, overlayCfg.textureKey);
                    overlaySprite.setOrigin(0.5, 0.5);
                    overlaySprite.setDisplaySize(
                        Number(overlayCfg.displayW) || sprite.displayWidth,
                        Number(overlayCfg.displayH) || sprite.displayHeight
                    );
                    if (this.anims.exists(overlayCfg.textureKey)) overlaySprite.play(overlayCfg.textureKey);
                }
                let groundContactSprite = null;
                const groundContactCfg = sprCfg?.groundContact;
                if (groundContactCfg?.textureKey
                    && this.textures.exists(groundContactCfg.textureKey)) {
                    groundContactSprite = this.add.sprite(
                        e.x, e.y, groundContactCfg.textureKey);
                    groundContactSprite.setOrigin(0.5, 0.5);
                    groundContactSprite.setDisplaySize(
                        Number(groundContactCfg.displayW) || sprite.displayWidth,
                        Number(groundContactCfg.displayH) || sprite.displayHeight
                    );
                }
                let foregroundSprite = null;
                const foregroundCfg = sprCfg?.foregroundOverlay;
                if (foregroundCfg?.textureKey && this.textures.exists(foregroundCfg.textureKey)) {
                    foregroundSprite = this.add.sprite(e.x, e.y, foregroundCfg.textureKey);
                    foregroundSprite.setOrigin(0.5, 0.5);
                    foregroundSprite.setDisplaySize(
                        Number(foregroundCfg.displayW) || sprite.displayWidth,
                        Number(foregroundCfg.displayH) || sprite.displayHeight
                    );
                }
                data = {
                    sprite,
                    label,
                    sprCfg,
                    groundContactSprite,
                    overlaySprite,
                    foregroundSprite,
                    workingEffectGraphics: null,
                    workingEffectVisible: false,
                    workingEffectPhase: this._buildingVisualPhase(e),
                    staffingWarningGraphics: null,
                    staffingWarningVisible: false,
                    staffingWarningPhase: this._buildingVisualPhase({ id: `${e.id || e.name}:staffing` }),
                    battlementRuneSprite: null,
                    battlementRuneVisible: false,
                };
                this._neutralSprites.set(e, data);
            }
            RuntimeAssetManager.repairSpriteFrame(data.sprite,
                RuntimeAssetManager.isTextureReady(desiredSprCfg?.idleKey, this)
                    ? desiredSprCfg.idleKey : 'neutral_circle', this);
            if (desiredSprCfg && RuntimeAssetManager.isTextureReady(desiredSprCfg.idleKey, this)) {
                data.sprCfg = desiredSprCfg;
                if (data.sprite.texture?.key === 'neutral_circle'
                    || data.sprite.texture?.key === '__MISSING') {
                    const staticFrame = Number.isInteger(desiredSprCfg.frame)
                        ? desiredSprCfg.frame : undefined;
                    data.sprite.setTexture(desiredSprCfg.idleKey, staticFrame);
                    data.sprite.clearTint();
                    delete e._structureVisualFitKey;
                    delete e._structureVisualFit;
                }
            }
            if (data.sprCfg) {
                this._reconcileNeutralVisualLayer(
                    data, 'overlaySprite', data.sprCfg.overlayAnimation, e, data.sprite);
                this._reconcileNeutralVisualLayer(
                    data, 'groundContactSprite', data.sprCfg.groundContact, e, data.sprite);
                this._reconcileNeutralVisualLayer(
                    data, 'foregroundSprite', data.sprCfg.foregroundOverlay, e, data.sprite);
            }
            const {
                sprite, label, sprCfg, groundContactSprite, overlaySprite, foregroundSprite,
            } = data;
            if (this._syncWallStaircaseEntity(e, data)) continue;
              const labelFontSize = (SceneManager && SceneManager.currentScene === 'scene8') ? '14px' : '11px';
              if (label.style && label.style.fontSize !== labelFontSize) {
                  label.setFontSize(labelFontSize);
              }
            const size = e.size || 16;
            const animKey = sprCfg
                ? ((e.isMoving && sprCfg.walkKey) ? sprCfg.walkKey : sprCfg.idleKey)
                : null;
            // 先切换当前建筑贴图，再按该帧真实 alpha 等比装入现有碰撞棱柱；
            // foot/X 锚点必须消费最终尺寸，不能先用错误配置尺寸定位后又二次缩放。
            if (sprCfg) {
                if (animKey && !this.anims.exists(animKey) && this.textures.exists(animKey)
                    && sprite.texture?.key !== animKey) {
                    sprite.setTexture(animKey);
                    delete e._structureVisualFitKey;
                    delete e._structureVisualFit;
                }
                const staticFrame = Number.isInteger(sprCfg.frame) ? sprCfg.frame : null;
                if (staticFrame !== null && Number(sprite.frame?.name) !== staticFrame) {
                    sprite.setFrame(staticFrame);
                }
                this._applyStructureVisualSize(e, sprite);
            }
            const shift = this._getFootOffsetY(e, sprite);
            // 普通 iso 建筑由 visualFootprint 直接锁定中心；未标定素材才回退 alpha。
            const visualOffsetX = this._getVisualOffsetX(e, sprite);
            sprite.setPosition(
                e.x + (e._isWallStaircase && e._facingLeft ? -visualOffsetX : visualOffsetX),
                e.y - shift
            );
            if (overlaySprite?.active) {
                const overlayCfg = sprCfg?.overlayAnimation || {};
                const visualScaleX = Math.max(0.01,
                    Number(e._structureVisualScaleX ?? e._structureVisualScale) || 1);
                const visualScaleY = Math.max(0.01,
                    Number(e._structureVisualScaleY ?? e._structureVisualScale) || 1);
                overlaySprite.setPosition(
                    sprite.x + (Number(overlayCfg.offsetX) || 0) * visualScaleX,
                    sprite.y + (Number(overlayCfg.offsetY) || 0) * visualScaleY
                );
                overlaySprite.setDisplaySize(
                    Number(overlayCfg.displayW) > 0
                        ? Number(overlayCfg.displayW) * visualScaleX
                        : sprite.displayWidth,
                    Number(overlayCfg.displayH) > 0
                        ? Number(overlayCfg.displayH) * visualScaleY
                        : sprite.displayHeight
                );
                overlaySprite.setFlipX(!!e._facingLeft);
                if (this.anims.exists(overlayCfg.textureKey)
                    && (!overlaySprite.anims.isPlaying || overlaySprite.anims.currentAnim?.key !== overlayCfg.textureKey)) {
                    overlaySprite.play(overlayCfg.textureKey);
                }
                const weatherSpeedMultipliers = overlayCfg.weatherSpeedMultiplierByIntensity;
                if (weatherSpeedMultipliers && overlaySprite.anims) {
                    const weatherIntensityId = this._weatherVisualState?.active
                        ? this._weatherVisualState.intensityId
                        : 'clear';
                    const configuredMultiplier = Number(weatherSpeedMultipliers[weatherIntensityId]);
                    const clearMultiplier = Number(weatherSpeedMultipliers.clear);
                    overlaySprite.anims.timeScale = Math.max(0.01,
                        Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
                            ? configuredMultiplier
                            : (Number.isFinite(clearMultiplier) && clearMultiplier > 0 ? clearMultiplier : 1));
                }
            }
            if (groundContactSprite?.active) {
                const groundContactCfg = sprCfg?.groundContact || {};
                const visualScaleX = Math.max(0.01,
                    Number(e._structureVisualScaleX ?? e._structureVisualScale) || 1);
                const visualScaleY = Math.max(0.01,
                    Number(e._structureVisualScaleY ?? e._structureVisualScale) || 1);
                const contactFootOffsetY = Number(groundContactCfg.footOffsetY);
                // 同画布拆层必须使用主体拟合后的中心，避免配置脚点再次缩放造成错层。
                const contactY = groundContactCfg.alignToBody === true
                    ? sprite.y
                    : e.y - (Number.isFinite(contactFootOffsetY)
                        ? contactFootOffsetY * visualScaleY
                        : shift);
                groundContactSprite.setPosition(
                    sprite.x + (Number(groundContactCfg.offsetX) || 0) * visualScaleX,
                    contactY + (Number(groundContactCfg.offsetY) || 0) * visualScaleY
                );
                groundContactSprite.setDisplaySize(
                    (Number(groundContactCfg.displayW) || sprite.displayWidth) * visualScaleX,
                    (Number(groundContactCfg.displayH) || sprite.displayHeight) * visualScaleY
                );
                groundContactSprite.setFlipX(!!e._facingLeft);
            }
            if (foregroundSprite?.active) {
                const foregroundCfg = sprCfg?.foregroundOverlay || {};
                const visualScaleX = Math.max(0.01,
                    Number(e._structureVisualScaleX ?? e._structureVisualScale) || 1);
                const visualScaleY = Math.max(0.01,
                    Number(e._structureVisualScaleY ?? e._structureVisualScale) || 1);
                const foregroundFootOffsetY = Number(foregroundCfg.footOffsetY);
                foregroundSprite.setPosition(
                    sprite.x + (Number(foregroundCfg.offsetX) || 0) * visualScaleX,
                    e.y - (Number.isFinite(foregroundFootOffsetY)
                        ? foregroundFootOffsetY * visualScaleY
                        : shift) + (Number(foregroundCfg.offsetY) || 0) * visualScaleY
                );
                foregroundSprite.setDisplaySize(
                    (Number(foregroundCfg.displayW) || sprite.displayWidth) * visualScaleX,
                    (Number(foregroundCfg.displayH) || sprite.displayHeight) * visualScaleY
                );
                foregroundSprite.setFlipX(!!e._facingLeft);
            }
            if (sprCfg) {
                // 贴图 NPC：行走/待机动画切换 + 朝向翻转，不做染色（静态贴图无动画则跳过）；
                // 倒退行走（移动方向与朝向相反）时循环动画倒放
                const wantReverse = !!e.isMoving && Math.abs(e.vx) > 0.1 && ((e.vx < 0) !== !!e._facingLeft);
                if (this.anims.exists(animKey)) {
                    const curKey = sprite.anims.currentAnim?.key;
                    const needStart = curKey !== animKey || !sprite.anims.isPlaying;
                    const dirChanged = wantReverse !== !!sprite._npcAnimReversed;
                    if (needStart || dirChanged) {
                        if (wantReverse) {
                            sprite.anims.playReverse(animKey, needStart && !dirChanged);
                        } else {
                            sprite.anims.play(animKey, needStart && !dirChanged);
                        }
                        sprite._npcAnimReversed = wantReverse;
                    }
                }
                sprite.setFlipX(!!e._facingLeft);
                // 贴图旋转（game-config npcs.*.sprite.rotation 度数；NPC 编辑器保存，缺省 0）
                sprite.setRotation(((sprCfg.rotation || 0) * Math.PI) / 180);
            } else {
                sprite.setTint(this._parseColor(e.color || '#d4c5a9').color);
            }
            // 跟随 rearFx 的旧接地层仍参与相交候选；固定贴地层不遮挡单位，
            // 不得把传送门的宽平台重新算入竖直门体的前后仲裁范围。
            this._syncStructureOcclusionVisualBounds(e, [
                sprite,
                overlaySprite,
                foregroundSprite,
                sprCfg?.groundContact?.depthMode === 'ground' ? null : groundContactSprite,
            ]);

            this._syncBuildingWorkingEffect(e, data, sprite);
            this._syncBuildingStaffingWarning(e, data, sprite);

            const isBuilding = isWorldBuildingEntity(e);
            let text = isBuilding ? '' : (e.name || '');
            let color = '#d4c5a9';
            if (e.npcType) {
                color = '#ffffff';
                if (player) {
                    const dx = e.x - player.x;
                    const dy = e.y - player.y;
                    if (Math.sqrt(dx * dx + dy * dy) <= (e.interactionRange || 200)) {
                        text += `${text ? '\n' : ''}左键对话`;
                    }
                }
            } else if (e._dpsTracking) {
                color = '#ff6666';
                text = `${e.name}\nDPS: ${e._dpsDisplay?.dps || 0} | 总伤害: ${e._dpsDisplay?.total || 0}`;
            } else if (!isBuilding && e.hp !== undefined && e.maxHp !== undefined) {
                // 能源矿只常驻名称；生命值改由受损时才出现的世界血条表达。
                text = e._isEnergyNode ? (e.name || '') : `${e.name} ${e.hp}/${e.maxHp}`;
            }
            // 名字标签：贴图 NPC 放在贴图顶部，圆形占位保持按 size 偏移
            const labelTop = sprCfg ? sprite.displayHeight / 2 : size;
            const labelGap = e._isEnergyNode ? 16 : 8; // 能源矿名称较原位置上移 4px
            label.setPosition(sprite.x, sprite.y - labelTop - labelGap);
            // 格网建筑（含保留 NPC/对话身份的主神空间祭坛）按地面锚线参与结构深度排序；
            // _isDefenseStructure 是战斗语义，不能作为建筑图层的唯一门禁。
            // 掩体带 _faceDepth（=墙段底边线 max 端点 y + 12，见 DefenseCover），
            // 不能用 e.y+12——e.y 是贴图显示框底边，比接地线深 22~137px，会把墙前
            // 实体错误排到墙后被盖（2026-08-05 实机复现）
            if (sprCfg?.depthMode === 'ground') {
                // 主神空间大面积铺装属于固定地面层：可接收结构太阳影，但绝不参与
                // 建筑/单位的Y排序，也不能以普通 Sprite 默认 depth=0 盖住共享阴影。
                sprite.setDepth(WORLD_RENDER_LAYERS.STRUCTURE_GROUND_CONTACT);
                label.setDepth(WORLD_RENDER_LAYERS.STRUCTURE_GROUND_CONTACT + 0.01);
            } else if (e._isMainHubArchitectureOccluder) {
                // Semantic crops from the unified hub render use their entity
                // Y solely as a fixed occlusion plane. They are not buildings,
                // so they must bypass footprint fitting and dynamic topology.
                sprite.setDepth(e.y);
                label.setDepth(e.y + 0.01);
            } else if (e._isEnergyNode
                || e._isDefenseStructure
                || (usesBuildingFootprintVolume(e) && e._structureDepthMode)) {
                const dd = Number.isFinite(e._structureRenderDepth)
                    ? e._structureRenderDepth
                    : ((typeof e._faceDepth === 'number') ? e._faceDepth : e.y + 12);
                sprite.setDepth(dd);
                if (groundContactSprite?.active) {
                    groundContactSprite.setDepth(
                        this._groundContactDepth(dd, sprCfg?.groundContact));
                }
                if (overlaySprite?.active) overlaySprite.setDepth(dd + 0.01);
                if (foregroundSprite?.active) {
                    foregroundSprite.setDepth(this._foregroundOverlayDepth(
                        e, dd, sprCfg?.foregroundOverlay));
                }
                if (data.workingEffectGraphics?.active) {
                    data.workingEffectGraphics.setDepth(dd + 0.015);
                }
                if (data.staffingWarningGraphics?.active) {
                    data.staffingWarningGraphics.setDepth(
                        (e._structureRenderChannels?.label ?? (dd + 0.12)) + 0.02);
                }
                label.setDepth(e._structureRenderChannels?.label ?? (dd + 1));
            }
            if (label.text !== text) {
                label.setText(text);
            }
            if (label.style?.color !== color) {
                label.setColor(color);
            }
            sprite.setVisible(true);
            if (groundContactSprite?.active) {
                const shadowControlled = sprCfg?.groundContact?.shadowControlled === true;
                groundContactSprite.setVisible(
                    !shadowControlled || EnvironmentLightingSystem.isShadowEnabled()
                );
            }
            if (overlaySprite?.active) overlaySprite.setVisible(true);
            if (foregroundSprite?.active) foregroundSprite.setVisible(true);
            if (data.workingEffectGraphics?.active) {
                data.workingEffectGraphics.setVisible(data.workingEffectVisible === true);
            }
            label.setVisible(text !== '');
            this._setBuildingHoverGlow([
                ...(Array.isArray(data.segmentSprites) ? data.segmentSprites : []),
                sprite,
                overlaySprite,
                foregroundSprite,
            ], !!e._isDefenseStructure && _game?.RTSCommand?._hoverBuilding === e);
              if (e._isDefenseCover) {
                  // 掩体：隐藏名字/血量文字，残血时只显示 _syncEntityHud 的小血条
                  if (label.text !== '') label.setText('');
                  label.setVisible(false);
              }
        }
        for (const [e, data] of this._neutralSprites.entries()) {
            if (!active.has(e)) {
                const sprites = Array.isArray(data.segmentSprites) && data.segmentSprites.length
                    ? data.segmentSprites
                    : [data.sprite];
                for (const sprite of new Set(sprites)) {
                    if (sprite?.active) sprite.destroy();
                }
                if (data.overlaySprite?.active) data.overlaySprite.destroy();
                if (data.groundContactSprite?.active) data.groundContactSprite.destroy();
                if (data.foregroundSprite?.active) data.foregroundSprite.destroy();
                if (data.workingEffectGraphics?.active) data.workingEffectGraphics.destroy();
                if (data.staffingWarningGraphics?.active) data.staffingWarningGraphics.destroy();
                if (data.battlementRuneSprite?.active) data.battlementRuneSprite.destroy();
                if (data.label?.active) data.label.destroy();
                this._neutralSprites.delete(e);
            }
        }
    }

    /**
     * 最高科技女墙的符文是纯视觉“成对接缝装饰”：同一承载墙、同一外沿的
     * slot 0/1 都存在时，由 slot 0 持有唯一 Sprite，并在两主体中心点之间显示。
     */
    _syncWallBattlementRuneOverlays() {
        if (!this._neutralSprites) return;
        for (const [entity, data] of this._neutralSprites.entries()) {
            if (!entity?._isWallBattlement || !data) continue;
            const attachment = entity._wallBattlementAttachment;
            let pairData = null;
            let pairAttachment = null;
            let textureKey = null;
            if (attachment?.slot === 0
                && entity.active !== false
                && !entity._sinking
                && String(entity.spriteCfg?.idleKey || '').endsWith('_rune')) {
                const pair = wallBattlementsAtSlot(attachment.wallCell, attachment.edge, 1)
                    .find((candidate) => candidate?._wallBattlementAttachment?.wall === attachment.wall);
                if (pair
                    && pair.active !== false
                    && !pair._sinking
                    && String(pair.spriteCfg?.idleKey || '').endsWith('_rune')) {
                    pairData = this._neutralSprites.get(pair) || null;
                    pairAttachment = pair._wallBattlementAttachment || null;
                    const variant = wallBattlementRuneVariant(attachment.wallCell, attachment.edge);
                    textureKey = `wall_battlement_rune_decal_${variant}`;
                }
            }

            const firstSprite = data.sprite;
            const secondSprite = pairData?.sprite;
            const visible = !!textureKey
                && this.textures.exists(textureKey)
                && firstSprite?.active
                && secondSprite?.active
                && firstSprite.visible !== false
                && secondSprite.visible !== false
                && !this._mapModeActive
                && entity._viewportEntityHidden !== true;
            data.battlementRuneVisible = visible;
            if (!visible) {
                data.battlementRuneSprite?.setVisible(false);
                continue;
            }

            let runeSprite = data.battlementRuneSprite;
            if (!runeSprite?.active) {
                runeSprite = this.add.sprite(0, 0, textureKey);
                runeSprite.setOrigin(0.5, 0.5);
                runeSprite.setAlpha(WALL_BATTLEMENT_RUNE_VISUAL.alpha);
                data.battlementRuneSprite = runeSprite;
            } else if (runeSprite.texture?.key !== textureKey) {
                runeSprite.setTexture(textureKey);
            }
            const firstSeam = attachment?.faceLine?.[1];
            const secondSeam = pairAttachment?.faceLine?.[0];
            const seamX = Number.isFinite(firstSeam?.x) && Number.isFinite(secondSeam?.x)
                ? (firstSeam.x + secondSeam.x) * 0.5
                : (firstSprite.x + secondSprite.x) * 0.5;
            // 高低主体的 Sprite 中心天然不同，直接取两中心平均会把符文向高段偏移。
            // 以两个紧裁主体的共同底线和较矮主体高度计算共享正面的几何中心。
            const firstBottom = firstSprite.y + firstSprite.displayHeight * 0.5;
            const secondBottom = secondSprite.y + secondSprite.displayHeight * 0.5;
            const commonFacadeHeight = Math.min(
                firstSprite.displayHeight,
                secondSprite.displayHeight
            );
            const seamY = (firstBottom + secondBottom) * 0.5 - commonFacadeHeight * 0.5;
            runeSprite.setPosition(seamX, seamY);
            runeSprite.setDisplaySize(
                WALL_BATTLEMENT_RUNE_VISUAL.width,
                WALL_BATTLEMENT_RUNE_VISUAL.height
            );
            runeSprite.setDepth(Math.max(firstSprite.depth, secondSprite.depth) + 0.03);
            runeSprite.setVisible(true);
        }
    }

    /**
     * 防御塔三层渲染：基座（静态，已去臂贴图）+ 机械臂（绕塔顶枢轴 360° 旋转）+
     * 挂载武器（跟随臂尖，朝向=塔 aimAngle）。
     * 世界-122 防守塔：臂帧表 `obstacle_defense_tower_arm_frames`，几何见 DEFENSE_TOWER_VISUAL。
     */
    _syncDefenseTowers(_game) {
        if (!_game || !_game.entities) return;
        const V = DEFENSE_TOWER_VISUAL;
        const active = this._defenseTowerActiveEntities
            || (this._defenseTowerActiveEntities = new Set());
        active.clear();
        for (const e of _game.entities.values()) {
            if (!e || !e._isDefenseTower || !e.active || e.hp <= 0) continue;
            active.add(e);
            let sp = this._defenseSprites.get(e);
            if (!this._isEntityInRenderViewport(e)) {
                if (sp) this._setViewportEntityHidden(e, true);
                continue;
            }
            if (sp) this._setViewportEntityHidden(e, false);
            if (!sp) {
                sp = {
                    base: this.add.sprite(0, 0, 'obstacle_defense_tower'),
                    arm: this.add.sprite(0, 0, 'obstacle_defense_tower_arm_frames'),
                    weapon: this.add.sprite(0, 0, 'weapon_rusty_sword'),
                    shadowRevision: -1,
                };
                sp.arm._frameIdx = -1;
                sp.base.setOrigin(0.5, 0.5);
                sp.arm.setOrigin(0.5, 0.5);
                sp.weapon.setOrigin(0.5, 0.5);
                this._defenseSprites.set(e, sp);
            }
            // 基座：沿普通建筑唯一入口，把素材法兰接地面映射到既有 2x2 碰撞棱柱。
            // 这里仅消费视觉拟合结果，不反写碰撞、占格或寻路。
            this._applyStructureVisualSize(e, sp.base);
            const baseFootOffset = this._getFootOffsetY(e, sp.base);
            const baseVisualOffsetX = this._getVisualOffsetX(e, sp.base);
            const towerGroundY = e.y;
            sp.base.setPosition(e.x + baseVisualOffsetX, towerGroundY - baseFootOffset);
            sp.base.setFlipX(!!e._mirrored);
            sp.base.setVisible(true);
            const assemblyScale = Math.max(0.01,
                (Number(sp.base.displayWidth) || V.base.w) / V.base.referenceW);
            e._defenseTowerAssemblyScale = assemblyScale;
            e._visualGroundOffsetY = 0;
            e._visualFootOffsetY = baseFootOffset;
            if (typeof e._syncShadowCaster === 'function') e._syncShadowCaster();
            if (sp.shadowRevision !== e._towerShadowRevision) {
                sp.shadowRevision = e._towerShadowRevision;
                this._dynamicTowerShadowDirty = true;
            }
            // 统一遮挡锚线（2026-08-16 全建筑同口径）：塔深度 = _faceDepth（接地线 y + 12），
            // 与小屋/基地/能源矿一致；单位在其后被压到塔下、在前/同线被抬到塔上（+0.5）。
            // 旧实现用 e.y + 2：与中立建筑深度不一致，同线单位 z-fight（建筑遮挡仓鼠）。
            const towerDepth = Number.isFinite(e._structureRenderDepth)
                ? e._structureRenderDepth
                : ((typeof e._faceDepth === 'number') ? e._faceDepth : e.y + 2);
            sp.base.setDepth(towerDepth);
            // 机械臂：预渲染 3D 旋转帧（48 帧），按 aimAngle 选最近帧；
            // 枢轴=帧内固定像素（相机固定 + 模型绕塔顶轴旋转），origin 设枢轴。
            const pivotX = sp.base.x;
            const pivotY = towerGroundY - V.muzzleHeight;
            const m = e._mirrored ? -1 : 1;
            const renderAimAngle = typeof e._renderAimAngle === 'function'
                ? e._renderAimAngle()
                : e.aimAngle;
            // 世界旋转 = -aimAngle（游戏 y 向下，屏幕顺时针=世界逆时针的镜像）；
            // 镜像塔再取反并 flipX 帧
            const theta = e._mirrored ? renderAimAngle : -renderAimAngle;
            const armStep = (Math.PI * 2) / V.arm.frames;
            let armIdx = Math.round(theta / armStep) % V.arm.frames;
            if (armIdx < 0) armIdx += V.arm.frames;
            if (sp.arm._frameIdx !== armIdx) {
                sp.arm.setFrame(armIdx);
                sp.arm._frameIdx = armIdx;
            }
            const armFrame = sp.arm.frame;
            sp.arm.setOrigin(V.arm.pivot.x / armFrame.width, V.arm.pivot.y / armFrame.height);
            sp.arm.setPosition(pivotX, pivotY);
            sp.arm.setDisplaySize(V.arm.w * assemblyScale, V.arm.h * assemblyScale);
            sp.arm.setRotation(0);
            sp.arm.setFlipX(!!e._mirrored);
            sp.arm.setDepth(towerDepth + 0.05);
            sp.arm.setVisible(true);
            // 挂载武器：臂尖 = 椭圆路径（等距投影 x 全量、y 0.5 缩短），
            // 朝向 = 臂尖方向角；朝左 flipY 防倒置。
            const item = e.weaponItem;
            if (item) {
                let tex = getWeaponTextureKey(item);
                if (!this.textures.exists(tex)) tex = 'weapon_rusty_sword';
                const gs = V.arm.gameScale * assemblyScale;
                const tipOX = gs * V.arm.k * V.arm.reach * Math.cos(renderAimAngle) * m;
                const tipOY = gs * V.arm.k * (0.5 * V.arm.reach * Math.sin(renderAimAngle) - 0.866 * V.arm.dz);
                const tipX = pivotX + tipOX;
                const tipY = pivotY + tipOY;
                let wAng = Math.atan2(0.5 * V.arm.reach * Math.sin(renderAimAngle) - 0.866 * V.arm.dz, V.arm.reach * Math.cos(renderAimAngle));
                if (e._mirrored) wAng = Math.PI - wAng;
                const flipY = Math.abs(wAng) > Math.PI / 2;
                // 枪管模式（"枪插进机械臂"假象，2026-08-14）：用预裁剪的枪管独立贴图，
                // 切口端（origin x=0）对齐臂尖并内嵌，枪管从机械臂/钩子里伸出。
                const barrelCfg = V.weapon.barrel && (V.weapon.barrel[item.weaponId] || V.weapon.barrel[item.weaponType]);
                if (barrelCfg) {
                    const barrelTex = `tower_barrel_${item.weaponId}`;
                    if (sp.weapon.texture.key !== barrelTex) sp.weapon.setTexture(barrelTex);
                    sp.weapon.setOrigin(0, 0.5);
                    const rootInset = (barrelCfg.inset ?? 7) * assemblyScale;
                    sp.weapon.setPosition(tipX - Math.cos(wAng) * rootInset, tipY - Math.sin(wAng) * rootInset);
                    sp.weapon.setRotation(wAng);
                    sp.weapon.setFlipX(false);
                    sp.weapon.setFlipY(flipY);
                    sp.weapon.setScale(barrelCfg.height * assemblyScale / barrelCfg.h);
                } else {
                    if (sp.weapon.texture.key !== tex) sp.weapon.setTexture(tex);
                    sp.weapon.setOrigin(0.5, 0.5);
                    const wH = (V.weapon.heights[item.weaponType] || V.weapon.defaultHeight)
                        * assemblyScale;
                    sp.weapon.setPosition(
                        tipX + Math.cos(wAng) * 8 * assemblyScale,
                        tipY + Math.sin(wAng) * 8 * assemblyScale
                    );
                    sp.weapon.setRotation(wAng);
                    sp.weapon.setFlipX(false);
                    sp.weapon.setFlipY(flipY);
                    sp.weapon.setScale(wH / Math.max(1, sp.weapon.height));
                }
                sp.weapon.setDepth(towerDepth + 0.08);
                sp.weapon.setVisible(true);
            } else {
                sp.weapon.setVisible(false);
            }
            this._syncStructureOcclusionVisualBounds(e, [sp.base, sp.arm, sp.weapon]);
            // 悬停金色高亮：DefenseSystem.updateHover 每帧更新 _hoverTower，
            // 基座/机械臂/武器三层贴图统一使用普通 tint，不创建离屏 Filter。
            this._setTowerHoverGlow(
                sp,
                DefenseSystem._hoverTower === e || _game?.RTSCommand?._hoverBuilding === e
            );
        }
        for (const [e, sp] of this._defenseSprites.entries()) {
            if (!active.has(e)) {
                sp.base.destroy();
                sp.arm.destroy();
                sp.weapon.destroy();
                this._defenseSprites.delete(e);
            }
        }
    }

    /** 防御塔悬停金色高亮：三层贴图（基座/臂/武器）同加同去普通 tint。 */
    _setTowerHoverGlow(sp, on) {
        this._setBuildingHoverGlow(['base', 'arm', 'weapon'].map((key) => sp[key]), on);
    }

    /** 指挥态建筑悬停轮廓：同一时刻只命中一栋，避免为全场建筑常驻滤镜通道。 */
    _setBuildingHoverGlow(visuals, on) {
        for (const sprite of new Set((visuals || []).filter(Boolean))) {
            if (!sprite || !sprite.active) continue;
            if (on) {
                if (sprite.__hoverTintState) continue;
                sprite.__hoverTintState = {
                    isTinted: !!sprite.isTinted,
                    tintMode: sprite.tintMode,
                    topLeft: sprite.tintTopLeft,
                    topRight: sprite.tintTopRight,
                    bottomLeft: sprite.tintBottomLeft,
                    bottomRight: sprite.tintBottomRight,
                };
                sprite.setTint?.(0xffe08a);
            } else if (sprite.__hoverTintState) {
                const state = sprite.__hoverTintState;
                if (state.isTinted) {
                    sprite.setTint?.(
                        state.topLeft,
                        state.topRight,
                        state.bottomLeft,
                        state.bottomRight
                    );
                    if (Number.isFinite(state.tintMode)) sprite.setTintMode?.(state.tintMode);
                } else {
                    sprite.clearTint?.();
                }
                sprite.__hoverTintState = null;
                sprite.__hoverGlowFx = null;
            }
        }
    }

    /**
     * 主神空间山顶远景测试层。
     *
     * 背景以屏幕 cover 方式显示，但裁切底边由世界坐标基线换算，因此玩家移动/缩放时
     * 切口仍跟随后排建筑。它只压在地形上方、道路和所有实体下方，不接收或制造阴影。
     */
    _syncMainHubBackdrop(isMapMode = false) {
        const cfg = GAME_CONFIG.scenes?.mainHub?.backdrop;
        const textureKey = cfg?.textureKey;
        const shouldShow = cfg?.enabled === true
            && SceneManager.currentScene === 'main'
            && !isMapMode
            && !!textureKey
            && this.textures.exists(textureKey);

        if (!shouldShow) {
            this._mainHubBackdrop?.setVisible(false);
            return;
        }

        if (!this._mainHubBackdrop || !this._mainHubBackdrop.active
            || this._mainHubBackdropKey !== textureKey) {
            this._mainHubBackdrop?.destroy();
            this._mainHubBackdrop = this.add.image(0, 0, textureKey)
                .setName('main_hub_summit_backdrop')
                .setOrigin(0.5, 0)
                .setScrollFactor(0);
            this._mainHubBackdropKey = textureKey;
        }

        const camera = this.cameras.main;
        const frame = this.textures.getFrame(textureKey);
        const sourceW = Math.max(1, frame?.realWidth || frame?.width || 1);
        const sourceH = Math.max(1, frame?.realHeight || frame?.height || 1);
        const zoom = Math.max(0.001, Number(camera.zoom) || 1);
        const viewportW = Math.max(1, Number(camera.width) || 1);
        const viewportH = Math.max(1, Number(camera.height) || 1);
        const screenScale = Math.max(viewportW / sourceW, viewportH / sourceH);

        const configuredBaseline = Number(cfg.baselineWorldY);
        const fallbackRatio = Math.max(0, Math.min(1,
            Number(cfg.baselineRatioFallback) || 0.44));
        const worldViewTop = Number(camera.worldView?.y);
        const baselineScreenY = Number.isFinite(configuredBaseline)
            && Number.isFinite(worldViewTop)
            ? (configuredBaseline - worldViewTop) * zoom
            : viewportH * fallbackRatio;
        const cropH = Math.max(0, Math.min(sourceH,
            Math.round(Math.max(0, Math.min(viewportH, baselineScreenY)) / screenScale)));

        const depthOffset = Number.isFinite(Number(cfg.depthOffsetFromTerrain))
            ? Number(cfg.depthOffsetFromTerrain) : 0.01;
        const alpha = Number.isFinite(Number(cfg.alpha))
            ? Math.max(0, Math.min(1, Number(cfg.alpha))) : 1;
        this._mainHubBackdrop
            .setCrop(0, 0, sourceW, cropH)
            .setScale(screenScale / zoom)
            .setPosition(viewportW / (2 * zoom), 0)
            .setDepth(WORLD_RENDER_LAYERS.TERRAIN + depthOffset)
            .setAlpha(alpha)
            .setVisible(cropH > 0);
    }

    /**
     * 公共入口：由 scene-manager / combat-room-system 在场景/战斗房切换后调用，
     * 避免每帧检查地形纹理。
     */
    syncTerrain() {
        this._syncTerrain();
        this._syncMainHubBackdrop(false);
    }

    /**
     * 同步地形 Sprite：
     * - 若 Renderer.terrainTexture 存在且尺寸匹配，直接使用该 Canvas 覆盖（兼容战斗场地/特殊场景）
     * - 否则使用 Phaser Graphics 直接生成地形 Texture（主场景，无 Canvas 中间件）
     */
    _syncTerrain() {
        const w = CONFIG.WORLD_WIDTH;
        const h = CONFIG.WORLD_HEIGHT;
        if (!w || !h) return;

        // 世界-122 分块惰性地板（applyDungeonFloorChunked 注册，switchScene 离场时清空）：
        // 按相机视口按需烘焙；非分块场景 Renderer.terrainChunks 恒为 null
        const chunks = Renderer.terrainChunks || null;
        if (chunks) {
            if (this._terrainSource !== chunks || this._terrainWorldWidth !== w || this._terrainWorldHeight !== h) {
                this._destroyTerrainChunks();
                this._terrainSource = chunks;
                this._terrainWorldWidth = w;
                this._terrainWorldHeight = h;
                // 先销毁旧的单张地形精灵再移除纹理——否则精灵仍引用已删除纹理，
                // 渲染时 frame.source 为 null（Phaser TexturerImage 'resolution' 崩溃）
                if (this._terrainSprite) {
                    this._terrainSprite.destroy();
                    this._terrainSprite = null;
                }
                if (this.textures.exists('terrain')) this.textures.remove('terrain');
            }
            this._updateTerrainChunks();
            return;
        }

        // 离开分块模式（切回主神空间/地牢等）：清掉分块精灵与纹理，回单张地形
        if (this._terrainChunkSprites && this._terrainChunkSprites.size > 0) {
            this._destroyTerrainChunks();
        }
        this._terrainSource = null;

        const override = Renderer.terrainTexture;
        if (this._terrainSource === override &&
            this._terrainWorldWidth === w &&
            this._terrainWorldHeight === h &&
            this.textures.exists('terrain')) {
            return;
        }
        this._terrainSource = override;
        this._terrainWorldWidth = w;
        this._terrainWorldHeight = h;

        if (this.textures.exists('terrain')) {
            this.textures.remove('terrain');
        }

        if (override && override.width === w && override.height === h) {
            this.textures.addCanvas('terrain', override);
        } else {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            MapGenerator.drawTerrain(g, w, h);
            this._drawGridAndBorder(g, w, h);
            g.generateTexture('terrain', w, h);
            g.destroy();
        }

        if (!this._terrainSprite) {
            this._terrainSprite = this.add.image(w / 2, h / 2, 'terrain');
            this._terrainSprite.setOrigin(0.5, 0.5);
            this._terrainSprite.setDepth(WORLD_RENDER_LAYERS.TERRAIN);
        } else {
            this._terrainSprite.setTexture('terrain');
            this._terrainSprite.setPosition(w / 2, h / 2);
        }
    }

    /**
     * 分块地板惰性烘焙/卸载：确保相机视口（+320px 余量）内的块已烘焙，
     * 每帧最多烘焙 1 块（分摊加载卡顿）；远离视口（+900px）的块连同纹理一起卸载，
     * 常驻显存 ≈ 视口块数（世界-122 由 96MB+ 降到 2~4 块 × 16MB）。
     */
    _updateTerrainChunks() {
        const chunks = Renderer.terrainChunks;
        if (!chunks) return;
        const cs = chunks.chunkSize;
        const cam = this.cameras.main;
        if (!cam || !cam.worldView) return;
        const vw = cam.worldView;
        const margin = 320;
        const x0 = Math.max(0, Math.floor((vw.x - margin) / cs));
        const y0 = Math.max(0, Math.floor((vw.y - margin) / cs));
        const x1 = Math.min(Math.floor((chunks.mapW - 1) / cs), Math.floor((vw.x + vw.width + margin) / cs));
        const y1 = Math.min(Math.floor((chunks.mapH - 1) / cs), Math.floor((vw.y + vw.height + margin) / cs));
        if (x1 < x0 || y1 < y0) return;

        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                const key = `terrain_chunk_${cx}_${cy}`;
                if (this._terrainChunkSprites.has(key)) continue;
                if (!this._terrainChunkQueue.some((q) => q.key === key)) {
                    this._terrainChunkQueue.push({ key, cx, cy, ox: cx * cs, oy: cy * cs });
                }
            }
        }
        if (this._terrainChunkQueue.length > 0) {
            const next = this._terrainChunkQueue.shift();
            if (next) this._bakeTerrainChunk(next);
        }
        const unloadCell = Math.ceil(900 / cs);
        for (const [key, sprite] of this._terrainChunkSprites) {
            const parts = key.split('_');
            const cx = Number(parts[2]);
            const cy = Number(parts[3]);
            if (cx < x0 - unloadCell || cx > x1 + unloadCell || cy < y0 - unloadCell || cy > y1 + unloadCell) {
                sprite.destroy();
                this._terrainChunkSprites.delete(key);
                if (this.textures.exists(key)) this.textures.remove(key);
            }
        }
    }

    _bakeTerrainChunk({ key, ox, oy }) {
        const chunks = Renderer.terrainChunks;
        if (!chunks) return;
        // 侵入式拼接：烘焙尺寸四周扩 pad px（世界相位连续，重叠区纹理一致），
        // 精灵中心不变 → 相邻块互相压 pad px，盖住接缝细线/黑边
        const pad = chunks.pad || 0;
        const canvas = bakeDungeonFloorChunk(ox - pad, oy - pad, chunks.chunkSize + pad * 2, chunks.chunkSize + pad * 2, chunks.mapW, chunks.mapH, null, chunks.diamond, pad);
        if (!canvas) return;
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addCanvas(key, canvas);
        const img = this.add.image(ox + chunks.chunkSize / 2, oy + chunks.chunkSize / 2, key);
        img.setOrigin(0.5, 0.5);
        img.setDepth(WORLD_RENDER_LAYERS.TERRAIN);
        this._terrainChunkSprites.set(key, img);
    }

    /** 擦除世界坐标 (wx,wy) 半径内的地板装饰（草等，2026-08-17）：注册清除区 +
     *  局部重烘焙所有与清除圆相交的已加载 chunk（未加载的块之后按需烘焙时自动跳过） */
    eraseDecoAt(wx, wy, radius) {
        this.eraseDecoBatch([{ x: wx, y: wy, radius }]);
    }

    /** 批量擦除装饰：一次登记全部区域，每个受影响 chunk 最多重烘焙一次。 */
    eraseDecoBatch(zones) {
        const validZones = (zones || []).filter((z) =>
            z && Number.isFinite(z.x) && Number.isFinite(z.y) && z.radius > 0
        );
        if (validZones.length === 0) return;
        registerDecoClearZones(validZones);
        const chunks = Renderer.terrainChunks;
        if (!chunks || !this._terrainChunkSprites) return;
        const cs = chunks.chunkSize || 2048;
        const toRebake = [];
        for (const [key] of this._terrainChunkSprites) {
            const parts = key.split('_');
            const dcx = Number(parts[2]);
            const dcy = Number(parts[3]);
            if (!Number.isFinite(dcx) || !Number.isFinite(dcy)) continue;
            const ox = dcx * cs, oy = dcy * cs;
            const touches = validZones.some((z) => {
                const nx = Math.max(ox, Math.min(z.x, ox + cs));
                const ny = Math.max(oy, Math.min(z.y, oy + cs));
                return Math.hypot(z.x - nx, z.y - ny) <= z.radius;
            });
            if (!touches) continue;
            toRebake.push({ dcx, dcy, key });
        }
        // 先收集再逐个重建（迭代中 delete+set 同一 key 会让 Map 迭代器重访 → 死循环）
        for (const r of toRebake) this._rebakeTerrainChunk(r.dcx, r.dcy, r.key);
    }

    /** 重烘焙单个地形块（先销毁旧精灵/纹理，再按视口烘焙逻辑重建） */
    _rebakeTerrainChunk(cx, cy, key) {
        if (this._terrainChunkSprites.has(key)) {
            const old = this._terrainChunkSprites.get(key);
            old.destroy();
            this._terrainChunkSprites.delete(key);
            if (this.textures.exists(key)) this.textures.remove(key);
        }
        const chunks = Renderer.terrainChunks;
        if (chunks) this._bakeTerrainChunk({ key, cx, cy, ox: cx * chunks.chunkSize, oy: cy * chunks.chunkSize });
    }

    _destroyTerrainChunks() {
        if (this._terrainChunkSprites) {
            for (const [key, sprite] of this._terrainChunkSprites) {
                sprite.destroy();
                if (this.textures.exists(key)) this.textures.remove(key);
            }
            this._terrainChunkSprites.clear();
        }
        this._terrainChunkQueue = [];
    }

    /**
     * 在地形 Texture 上烘焙网格与世界边界
     */
    _drawGridAndBorder(g, w, h) {
        const currentScene = SceneManager.currentScene;
        // 网格
        const gridCfg = GAME_CONFIG.grid || {};
        const gridSize = gridCfg.size || CONFIG.GRID_SIZE || 64;
        g.lineStyle(gridCfg.lineWidth || 1, 0x5a4d3f, 0.15);
        g.beginPath();
        for (let x = 0; x <= w; x += gridSize) {
            g.moveTo(x, 0);
            g.lineTo(x, h);
        }
        for (let y = 0; y <= h; y += gridSize) {
            g.moveTo(0, y);
            g.lineTo(w, y);
        }
        g.strokePath();
        // 边界：地牢与世界-122 不画描边（122 边界自然显示为地板渐变边缘，2026-08-14）
        if (currentScene !== 'scene7' && currentScene !== 'scene8') {
            const borderCfg = GAME_CONFIG.worldBorder || {};
            g.lineStyle(borderCfg.lineWidth || 4, 0x8a4a4a, 1);
            g.strokeRect(0, 0, w, h);
        }
    }

    /**
     * 应用敌人 Sprite 的纯视觉配置。敌人 Arcade Body 已移除，但首次显示尺寸、
     * 非方形帧等比缩放与 tint 仍必须保留，不能再与物理体初始化绑定。
     */
    _applyEnemyVisualOptions(sprite, enemy, resolvedOptions = null) {
        if (!sprite || !sprite.active) return;
        const options = resolvedOptions
            || ((typeof enemy?._getPhaserOptions === 'function') ? enemy._getPhaserOptions() : {});
        const renderCfg = enemy?.config?.render || {};
        const fallbackSize = (Number(enemy?.size) || 14) * 4;
        const configuredSize = Number(options.spriteSize || renderCfg.spriteSize || fallbackSize);
        const spriteSize = Number.isFinite(configuredSize) && configuredSize > 0
            ? configuredSize
            : fallbackSize;
        const frameW = (sprite.frame && sprite.frame.width) || 1;
        const frameH = (sprite.frame && sprite.frame.height) || 1;
        const longest = Math.max(frameW, frameH);
        const targetW = frameW * spriteSize / longest;
        const targetH = frameH * spriteSize / longest;
        if (Math.abs(sprite.displayWidth - targetW) > 0.01
            || Math.abs(sprite.displayHeight - targetH) > 0.01) {
            sprite.setDisplaySize(targetW, targetH);
        }
        sprite.setOrigin(0.5, 0.5);
        if (options.tint !== undefined) {
            sprite.setTint(options.tint);
        }
        if (options.frame !== undefined) {
            try {
                sprite.setFrame(options.frame);
            } catch (_e) {
                // 帧索引无效时由后续动画同步按当前纹理帧数钳制。
            }
        }
        if (options.alpha !== undefined) {
            const alpha = Math.max(0, Math.min(1, Number(options.alpha)));
            if (Number.isFinite(alpha)) sprite.setAlpha(alpha);
        }
    }

    /**
     * 为敌人创建或获取 Phaser Sprite
     */
    getOrCreateEnemySprite(enemy, texture = 'enemy_circle') {
        if (!RuntimeAssetManager.isTextureReady(texture, this)) {
            RuntimeAssetManager.requestEnemyVisual(texture);
        }
        const safeTexture = RuntimeAssetManager.isTextureReady(texture, this)
            ? texture
            : 'enemy_circle';
        if (!enemy._phaserSprite || !enemy._phaserSprite.active) {
            const sprite = this.add.sprite(enemy.x, enemy.y, safeTexture);
            sprite.setData('enemyId', enemy.id || enemy.name);
            this._applyEnemyVisualOptions(sprite, enemy);
            this.enemies.add(sprite);
            enemy._phaserSprite = sprite;
        } else if (enemy._phaserSprite.texture?.key !== safeTexture
            || !RuntimeAssetManager.isSpriteFrameReady(enemy._phaserSprite, this)) {
            // 纹理变化时切换（如黑狼左右/上下精灵图切换）
            RuntimeAssetManager.repairSpriteFrame(enemy._phaserSprite, safeTexture, this);
            enemy._phaserSprite.setTexture(safeTexture);
            this._applyEnemyVisualOptions(enemy._phaserSprite, enemy);
        }
        return enemy._phaserSprite;
    }

    /**
     * 根据当前动画/帧对 Sprite 进行内容中心对齐偏移
     * 解决精灵图有效贴图不在切分方格中央导致的抖动问题
     */
    _applySpriteFrameOffset(sprite, animKey) {
        const frame = sprite.anims.currentFrame || sprite.frame;
        const frameIndex = frame ? frame.index : null;
        if (frameIndex == null || !animKey) return;
        const offset = getSpriteFrameOffset(animKey, frameIndex);
        if (!offset) return;
        const scale = sprite.scaleX || 1;
        const desired = { x: -Math.round(offset.x * scale), y: -Math.round(offset.y * scale) };
        const current = sprite.getData('frameOffset') || { x: 0, y: 0 };
        if (current.x === desired.x && current.y === desired.y) return;
        sprite.x = sprite.x - current.x + desired.x;
        sprite.y = sprite.y - current.y + desired.y;
        sprite.setData('frameOffset', desired);
    }

    /**
     * 同步敌人动画状态与水平朝向（用于僵尸犬等带帧动画的敌人）
     */
    _syncEnemyAnimation(enemy) {
        const sprite = enemy._phaserSprite;
        if (!sprite || !sprite.active) return;
        RuntimeAssetManager.repairSpriteFrame(sprite, enemy._getTextureKey?.(), this);
        if (enemy.active && !enemy._isDead
            && (enemy.hasStatusEffect?.('petrified') || this._petrifyFx?.has(enemy))) {
            enemy._syncPetrifiedBodyAnchor?.(sprite);
            return;
        }
        const options = (typeof enemy._getPhaserOptions === 'function') ? enemy._getPhaserOptions() : {};
        // 同步纹理键（动画状态变化时需要切到对应 spritesheet/image）
        const wanted = (typeof enemy._getTextureKey === 'function') ? enemy._getTextureKey() : 'enemy_circle';
        if (!RuntimeAssetManager.isTextureReady(wanted, this)) {
            RuntimeAssetManager.requestEnemyVisual(wanted);
        }
        let safeTexture = RuntimeAssetManager.isTextureReady(wanted, this) ? wanted : 'enemy_circle';
        if (safeTexture === 'enemy_circle' && this.anims.exists(wanted)) {
            // 防御（2026-08-15 铠甲骑士教训）：_getTextureKey 返回了纯动画键（无同名贴图）时，
            // 不要回退 enemy_circle 白胶囊占位——取该动画首帧所在贴图继续渲染，
            // 等后续动画同步切到正确帧（骑士冲锋循环段贴图"丢失"的根因）
            const anim = this.anims.get(wanted);
            const firstFrame = anim && anim.frames && anim.frames[0];
            if (firstFrame?.textureKey
                && RuntimeAssetManager.isTextureReady(firstFrame.textureKey, this)) {
                safeTexture = firstFrame.textureKey;
            }
        }
        if (sprite.texture?.key !== safeTexture) {
            if (safeTexture === 'enemy_circle') RuntimeAssetManager.detachSpriteAnimation(sprite);
            sprite.setTexture(safeTexture);
            // 纹理切换后按当前帧尺寸重算显示大小：
            // 旧 250×215 贴图（黑狼 pacing/attack）与新 512² 贴图混用时，
            // 创建时一次性计算的 displaySize 会压扁/缩小（2026-08-06 黑狼 idle 小图根因）
            this._applyEnemyVisualOptions(sprite, enemy, options);
        }
        // 红狼王变身表在同一纹理内按进度线性放大；纹理键不变时也要同步动态尺寸。
        // 脚底位置仍由 entity.footOffsetY 驱动，不在这里另加 Y 偏移。
        if (options.dynamicSpriteSize && options.spriteSize > 0) {
            this._applyEnemyVisualOptions(sprite, enemy, options);
        }
        if (options.flipX !== undefined) {
            sprite.setFlipX(options.flipX);
        }
        // 非对称动作裁框使用固定素材锚点，镜像时同步翻转偏移；逻辑坐标/碰撞不变。
        // 上游每帧先重置为实体位置，这里只加一次，不累计偏移。
        if (Number.isFinite(options.frameAnchorX) && sprite.texture?.key === wanted) {
            sprite.x += (sprite.frame.width / 2 - options.frameAnchorX)
                * Math.abs(sprite.scaleX) * (sprite.flipX ? -1 : 1);
        }
        if (options.alpha !== undefined) {
            const alpha = Math.max(0, Math.min(1, Number(options.alpha)));
            if (Number.isFinite(alpha) && Math.abs(sprite.alpha - alpha) > 0.001) {
                sprite.setAlpha(alpha);
            }
        }
        if (options.frame !== undefined) {
            // 自管技能时钟的逐帧动作不能同时被 Phaser 的旧动画继续写帧。
            if (options.manualFrame && sprite.anims.currentAnim) {
                RuntimeAssetManager.detachSpriteAnimation(sprite);
            }
            let frame = options.frame;
            // 帧索引防越界：眩晕/冰冻时纹理切到单帧 idle 图，但 _animFrame 仍指向原动画帧号
            // （如 run 2 / attack 5），setFrame 会在 1 帧贴图上刷 "has no frame" 错误——
            // 按当前贴图实际帧数钳制（超范围回退到末帧/0），避免每帧 console 报错刷屏
            const tex = sprite.texture;
            if (typeof frame === 'number' && tex && typeof tex.getFrameNames === 'function') {
                const names = tex.getFrameNames();
                const count = (names && names.length) || 1;
                if (frame >= count) frame = count - 1;
                if (frame < 0) frame = 0;
            }
            try {
                sprite.setFrame(frame);
            } catch (_e) {
                // 帧索引无效时忽略
            }
        }
        // 手动 setFrame 的敌人不经过 Phaser animState 分支。红狼王普通攻击在这里
        // 消除素材帧内水平重心漂移；位置刚由逻辑坐标同步，故直接叠加本帧偏移。
        if (options.frameOffsetKey) {
            const frameIndex = sprite.frame ? sprite.frame.index : null;
            const offset = frameIndex == null
                ? null
                : getSpriteFrameOffset(options.frameOffsetKey, frameIndex);
            if (offset) {
                const scale = Math.abs(sprite.scaleX || 1);
                const mirrorX = sprite.flipX ? -1 : 1;
                sprite.x -= Math.round(offset.x * scale * mirrorX);
            }
        }
        if (options.manualFrame) return;
        const animState = options.animState;
        if (!animState) return;
        let animKey = options.animKey || ('zombie_dog_' + animState);
        if (animState === 'summon' && options.summonReverse) {
            animKey = 'enemy_zombie_wizard_summon_reverse';
        }
        const targetAnimation = this.anims.exists(animKey) ? this.anims.get(animKey) : null;
        const animationReady = RuntimeAssetManager.isAnimationReady(animKey, this);
        if (!targetAnimation || !animationReady) {
            RuntimeAssetManager.requestEnemyVisual(animKey);
            // 仅保留有效旧帧；坏动画不能在下一次 preUpdate 把旧 TextureSource 写回来。
            if (sprite.anims.currentAnim
                && !RuntimeAssetManager.isAnimationReady(sprite.anims.currentAnim.key, this)) {
                RuntimeAssetManager.detachSpriteAnimation(sprite);
            }
            return;
        }
        const current = sprite.anims.currentAnim;
        // 循环/一次性必须以 BootScene 注册的 repeat 为真源，不能再靠状态名白名单猜测。
        // 8 月 28—29 日的怪物新增了 fan_sweep、summon、phase_open、body_slam、
        // deathSlam 等专属状态；它们都是 repeat: 0，一旦按“未知状态=循环”处理，
        // 播完后会被自愈逻辑从首帧重播。只有无限循环动画才允许停止后自动续播。
        const isLoopAnim = Number(targetAnimation?.repeat) < 0;
        // 倒退行走：实体标记 animReverse 时循环动画倒放（playReverse），方向变化需强制重启
        const wantReverse = isLoopAnim && !!options.animReverse;
        const shouldReplay = !current || current.key !== animKey || (!sprite.anims.isPlaying && isLoopAnim);
        if (shouldReplay) {
            // 死亡动画结束后进入尸体阶段，不要再播放
            if (animState === 'death' && enemy._deathAnimTimer <= 0) {
                sprite.anims.stop();
            } else if (wantReverse) {
                sprite.anims.playReverse(animKey, true);
            } else {
                sprite.anims.play(animKey, true);
            }
            sprite._animReversed = wantReverse;
        } else if (isLoopAnim && wantReverse !== !!sprite._animReversed) {
            // 同一动画方向切换（正放↔倒放）：不带 ignoreIfPlaying 强制重启
            if (wantReverse) {
                sprite.anims.playReverse(animKey);
            } else {
                sprite.anims.play(animKey);
            }
            sprite._animReversed = wantReverse;
        }

        // 运行时动态偏移：按当前帧把有效贴图对齐到同一位置
        this._applySpriteFrameOffset(sprite, animKey);
    }
}
