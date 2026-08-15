
import { Game } from '../../game.js';
import { SceneManager } from '../../world/scene-manager.js';
import { PartySystem } from '../../systems/party-system.js';


// ============================================================
// GameScene - 主游戏场景：替代原有的 renderer.js + game.js 渲染部分
// ============================================================
import { Scene, BlendModes } from 'phaser';
import { WallSystem } from '../../world/wall-system.js';
import { WallGate } from '../../world/wall-gate.js';
import { ChestRoomSystem } from '../../world/chest-room-system.js';
import { Renderer } from '../../world/renderer.js';
import { MapGenerator } from '../../world/map-generator.js';
import { WeaponTransform } from '../../combat/weapon-transform.js';
import { SwordArcTrail } from '../../effects/sword-arc-trail.js';
import { getWeaponTextureKey } from '../../config/weapon-texture-map.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { Easing, WEAPON_ANIM } from '../../config/math-utils.js';
import { CONFIG } from '../../config/config.js';
import { GAME_CONFIG } from '../../config/game-config.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { getSpriteFrameOffset } from '../../utils/sprite-offsets.js';
import { PLAYER_DEFAULTS } from '../../config/player-defaults.js';
import { playerTextureKey, getPlayerAnimDef, getPlayerAnimDurationMs } from '../../config/player-anim.js';
import { AnimChannel, resolveAnimChannel, enterRecover, clearPose, nowMs,
    MELEE_STAGE_ANIM_KEYS, meleeStageCfgKey, meleeStageRecoverMs } from '../../entities/player/anim-state.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { getTorsoRect } from '../../physics/torso-hitbox.js';

import { DungeonMapSystem } from '../../world/dungeon-map-system.js';
import { Camera } from '../../world/camera.js';
import { Input } from '../../ui/input.js';
import { RiftSystem } from '../../quest/rift-system.js';
import { isGunWeapon, isTwoHanded } from '../../config/gun-ammo.js';
import { GUN_FAMILY } from '../../config/weapon-families.js';
import { findWeaponConfig } from '../../ui/equip-data-manager.js';
import { ExpeditionSystem } from '../../ui/expedition-system.js';
import { getCastSpeedMultiplier } from '../../utils/magic-craft-helper.js';
import { burstParticles } from '../../effects/combat-fx.js';
import { GunFeel } from '../../effects/gunfeel.js';
import { DEFENSE_TOWER_VISUAL, DefenseSystem } from '../../world/defense-system.js';

export class GameScene extends Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    // ---- 生命周期 ----

    create() {
        

        // 标记场景就绪，通知外部系统（必须提前，因为后续代码依赖 window.__phaserScene）
        window.__phaserSceneReady = true;
        window.__phaserScene = this;

        // 初始化标志（必须在 setupColliders 之前）
        this._collidersSet = false;
        this._playerAttackStartTime = 0;
        this._playerAttackDuration = 667;
        this._weaponBlurFilter = null; // 武器真实模糊（Phaser 4 Blur 滤镜控制器，逐帧更新 strength）
        this._weaponBlurDisabled = false; // 运动模糊禁用标记（超大贴图 / WebGL context lost 后置位，防 Framebuffer 崩溃）
        this._companionSprites = {}; // 侍从跟随渲染：memberId → Phaser Sprite
        // WebGL context lost 后禁用模糊：Phaser 会自动恢复渲染器，但失效帧缓冲可能反复触发 Framebuffer Unsupported
        if (this.game && this.game.canvas && typeof window !== 'undefined') {
            this.game.canvas.addEventListener('webglcontextlost', () => {
                this._weaponBlurDisabled = true;
                this._weaponBlurFilter = null;
            });
        }
        // 冰墙 fx 池与共享发射器：场景 stop/start 后旧对象已销毁，必须重置防悬挂引用
        this._iceWallFx = [];
        this._iceWallVariantPool = null;
        // Velocity 驱动开关（默认关闭，避免与原有移动逻辑冲突）
        // 如需手动测试，可在控制台执行：__phaserScene._useVelocityDrive = true
        this._useVelocityDrive = false;

        // 创建玩家 Sprite（占位，后续由 Player 类接管）
        this._createPlayerSprite();

        // 创建敌人组
        this.enemies = this.physics.add.group();

        // 创建碰撞层（墙壁/障碍物）
        this.walls = this.physics.add.staticGroup();

        // 视觉墙壁/树木组（2.5D 透视渲染）
        this.visualWalls = this.add.group();
        this.visualTrees = this.add.group();

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

        // HUD：世界空间（血条/名字）与屏幕空间（准星/小地图）
        this.worldHudGraphics = this.add.graphics();
        this.worldHudGraphics.setDepth(100000);
        this.screenHudGraphics = this.add.graphics();
        this.screenHudGraphics.setDepth(100001);
        this.screenHudGraphics.setScrollFactor(0);
        // 碰撞体积可视化（点击左下角“范围”按钮后显示半透明红圈）
        this._collisionRadiusGraphics = null;
        // 无专属 Phaser Sprite 的实体（训练靶/NPC）通用渲染容器
        this._neutralSprites = new Map();
        // 防御塔三层渲染（基座/机械臂/挂载武器）
        this._defenseSprites = new Map();

        // 可移动实体脚底阴影：按 groundRadius 绘制黑色圆影
        this._shadowSprites = new Map();
        this._ensureShadowTexture();

        // 小地图静态层（背景/边界/墙壁），只在墙壁或世界尺寸变化时重绘
        this._minimapStaticGraphics = this.add.graphics();
        this._minimapStaticGraphics.setDepth(99999);
        this._minimapStaticGraphics.setScrollFactor(0);
        this._minimapStaticKey = null;
        // 小地图动态层（实体/相机框/玩家箭头），独立 graphics + 矩形 mask 裁剪（防止画出小地图框外）
        this._minimapDynamicGraphics = this.add.graphics();
        this._minimapDynamicGraphics.setDepth(99999);
        this._minimapDynamicGraphics.setScrollFactor(0);
        this.minimapTitle = this.add.text(0, 0, '地图', {
            fontFamily: 'SimHei, "Microsoft YaHei", sans-serif',
            fontSize: '10px',
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

        // 预生成僵尸受击绿色粒子纹理
        this._ensureZombieHitTexture();

        // 事件监听：外部系统通知
        this.events.on('playerSpawn', this._onPlayerSpawn, this);
        this.events.on('enemySpawn', this._onEnemySpawn, this);

        // 启动 HUD 场景（屏幕空间 UI）
        this.scene.run('HudScene');
    }

    update(_time, _delta) {
        // Phaser 自动调用，每帧更新
        // 现有 Game 循环仍然运行，这里只做 Phaser 相关的更新

        // 地牢模式：隐藏角色及武器贴图
        const _game = window.Game;
        const _dms = DungeonMapSystem;
        const isMapMode = SceneManager.currentScene === 'scene7' && _dms && _dms.active && _dms.state === 'map';
        if (isMapMode) {
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
            if (this.defenseGlow) this.defenseGlow.clear();
            this.iceSpikeFlyGroup.setVisible(false);
            if (this.fireballFlySprite) this.fireballFlySprite.setVisible(false);
            if (this.droneSprite) this.droneSprite.setVisible(false);
            if (this.droneRangeGraphics) this.droneRangeGraphics.clear();
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
            if (this._minimapStaticGraphics) this._minimapStaticGraphics.setVisible(false);
            if (this._minimapDynamicGraphics) this._minimapDynamicGraphics.setVisible(false);
            if (this.minimapTitle) this.minimapTitle.setVisible(false);
            this._entityHudTexts.forEach(t => t.setVisible(false));
            // 地图模式下隐藏敌人/中立实体/其他施法者特效，避免战斗残留覆盖地图
            if (this.enemies) this.enemies.setVisible(false);
            // X 光透视对象不属于任何显示组，必须显式隐藏——否则战斗结束后
            // 透视圈/实体克隆（如墙后金币）残留在地图选择界面上
            if (this._xrayMap) {
                for (const [, cur] of this._xrayMap) {
                    for (const k of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone']) {
                        if (cur[k]) cur[k].setVisible(false);
                    }
                }
            }
            if (this._neutralSprites) {
                for (const data of this._neutralSprites.values()) {
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
            if (this.minimapTitle) this.minimapTitle.setVisible(!_dialogueOpen);
            this._syncHud(_game);
            this._updateBossHpBar(_delta);
            this._syncHitFlashAndCharge(_game);
            this._syncNeutralEntities(_game);
            // 防御塔三层渲染（基座 + 旋转机械臂 + 挂载武器）
            this._syncDefenseTowers(_game);
            // Phase 3: 同步特效 Sprite
            if (_game && _game.player) {
                this._syncRuneSwords(_game.player);
                this._syncIceSpikes(_game.player);
                this._syncFireball(_game.player);
                // Phase 3 续：同步盾牌和飞行投射物
                this._syncShield(_game.player);
                this._syncFlyingIceSpikes(_game.player);
                this._syncFlyingFireball(_game.player);
                // Phase 续：同步无人机
                this._syncDrone(_game.player);
                // Phase 续：同步冰墙
                this._syncIceWalls(_game.player);

                // 同步其他施法者（如僵尸巫师）的冰锥/火球特效
                this._syncOtherMagicCasters(_game);
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
        // 侍从跟随渲染（露娜等有动作素材的队员：跟随玩家播 walk/run/spell）
        this._syncCompanionSprites(_game);
        // 侍从普通攻击光球渲染（蓝色光球，CompanionAI 推进）
        this._syncCompanionBasics(_game);
        // 同步可移动实体脚底阴影（原在此处，2026-08-15 移到 _updateDynamicDepths 之后）
        // 同步眩晕双星特效（眩晕持续时间内播放，结束消失）
        this._syncStunEffects(_game);
        // 同步冻结冰块特效（冻结持续时间内覆盖目标，结束消失）
        this._syncFreezeEffects(_game);
        // 同步激励 buff 白色环绕光晕（持续时间内跟随目标，结束消失）
        this._syncInspireEffects(_game);
        // 调试范围圈与阴影使用同一脚底坐标，避免错位
        this._syncCollisionRadii(_game);
        // Phase 4: 根据世界 Y 坐标统一动态实体深度
        this._updateDynamicDepths();
          // 弧形刀光放在剑贴图上一层，保证世界-122 等遮挡/亮色场景也可见
          if (this._swordArcTrail) {
              this._swordArcTrail.update(_delta, this.weaponSprite ? this.weaponSprite.depth + 1 : 0);
          }
        // 同步可移动实体脚底阴影（必须在 _updateDynamicDepths 之后：阴影深度 =
        // 贴图当前帧仲裁后深度 − 0.1，保证贴图永远在阴影之上、任何情况下阴影
        // 都不能盖住贴图。2026-08-15 修复：旧顺序阴影先跑、读上一帧贴图深度，
        // 怪物跨过掩体/墙面线深度骤降时阴影会以旧深度盖在贴图上 1 帧——
        // 世界-122 毒蛆大椭圆阴影在基地掩体线反复压住虫身的根因；所有怪物适用）
        this._syncEntityShadows(_game);
        // X 光圆圈：被墙壁遮挡的实体以黑渐变圆圈透视显示
        this._syncXRayCircles(_game);
        this._updateCamera();
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
            if (player._chargeFlashActive) {
                this.playerSprite.setTint(0xffffff);
                if (this.weaponSprite && this.weaponSprite.active) this.weaponSprite.setTint(0xffffff);
            } else {
                this.playerSprite.clearTint();
                if (this.weaponSprite && this.weaponSprite.active) this.weaponSprite.clearTint();
            }
        }
        if (_game.entities) {
            _game.entities.forEach(e => {
                if (!e || !e.active || e === player) return;
                // 掉落物：tint 由 DropItem 悬停高亮自管，不随受击闪白清空
                if (e.itemData && e.noCollision) return;
                const sprite = e._phaserSprite;
                if (!sprite || !sprite.active) return;
                if (e.hitFlash > 0) {
                    sprite.setTint(0xffffff);
                } else {
                    sprite.clearTint();
                }
            });
        }
    }

    /** 侍从跟随渲染：有动作素材的队员（露娜等）跟随玩家，按移动/冲刺/施法播 walk/run/spell */
    _syncCompanionSprites(_game) {
        const player = _game && _game.player;
        // 地图模式 / 无玩家：隐藏全部队员精灵
        if (!player || !this.playerSprite || this._mapModeActive || !this.playerSprite.visible) {
            for (const k of Object.keys(this._companionSprites)) {
                this._companionSprites[k].setVisible(false);
            }
            return;
        }
        // 渲染对象 = 队伍侍从 + 世界-122 友方单位（仓鼠矿工等，2026-08-15）
        const members = [
            ...(PartySystem.members || []),
            ...(Array.isArray(_game.friendlyUnits) ? _game.friendlyUnits : []),
        ];
        const activeIds = new Set();
        const isMoving = !!player.isMoving;
        const isSprinting = !!player._isSprinting;
        const casting = !!(player._castState && player._castState !== 'idle');
        const facingRight = !this.playerSprite.flipX;
        for (const member of members) {
            const anims = member.animations || {};
            const walkKey = `companion_${member.id}_walk`;
            const runKey = `companion_${member.id}_run`;
            if (!anims.walk || !this.textures.exists(walkKey)) continue; // 无动作素材不渲染
            activeIds.add(member.id);
            let sprite = this._companionSprites[member.id];
            if (!sprite) {
                const fw = anims.walk.frameWidth || 512;
                const fh = anims.walk.frameHeight || 512;
                // 站立姿态：优先 idle 动画首帧（2026-08-14 新增 idle 素材）；
                // 其次奔跑动画首帧（idle→起跑完全连续）；无奔跑素材退回 walk 首帧
                const idleTexKey = `companion_${member.id}_idle`;
                const hasIdleTex = anims.idle && this.textures.exists(idleTexKey);
                const runIdle = anims.run && this.textures.exists(runKey);
                const idleKey = hasIdleTex ? idleTexKey : (runIdle ? runKey : walkKey);
                const idleFrame = hasIdleTex ? 0 : (runIdle ? 0 : (Array.isArray(anims.walk.frames) ? anims.walk.frames[0] : 0));
                sprite = this.add.sprite(player.x, player.y, idleKey, idleFrame);
                sprite.setOrigin(0.5, 0.5);
                const longest = Math.max(fw, fh);
                // 显示尺寸：单位可配置 displaySize（仓鼠矿工略小于玩家），缺省与玩家一致
                const size = member.displaySize || PLAYER_DEFAULTS.physics.spriteSize;
                sprite.setDisplaySize(fw * size / longest, fh * size / longest);
                sprite.setData('companionIdleKey', idleKey);
                sprite.setData('companionIdleFrame', idleFrame);
                sprite.setDepth(this.playerSprite.depth + 0.5);
                this._companionSprites[member.id] = sprite;
            }
            // 位置：AI 队员用自身逻辑坐标（跟随/站位/撤退由 AI 移动）；纯渲染队员跟随玩家左后偏移
            const aiMode = !!member.aiConfig;
            if (aiMode) {
                sprite.setPosition(member.x, member.y);
            } else {
                const offX = facingRight ? -150 : 150;
                sprite.setPosition(player.x + offX, player.y + 34);
            }
            // 朝向：AI 队员——逃跑面朝移动方向；其余（idle/施法/走位）始终面朝目标
            // （最近敌人）；无目标按移动方向。纯渲染队员仍跟随玩家镜像。
            let faceRight = facingRight;
            if (aiMode) {
                if (member._lastAction === 'flee' && Math.abs(member.vx) > 5) {
                    faceRight = member.vx > 0;
                } else {
                    // 仓鼠矿工只面朝矿点/移动方向，不回头面朝敌人
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
            sprite.setFlipX(!faceRight);
            sprite.setDepth(this.playerSprite.depth + 0.5);
            // 受击白闪（仓鼠矿工）
            if (member._isHamsterMiner) {
                if (member.hitFlash > 0) sprite.setTint(0xffffff);
                else sprite.clearTint();
            }
            // 动画：施法 > 冲刺 > 移动 > 站立停帧
            const spellKey = `companion_${member.id}_spell`;
            if (aiMode) {
                // AI 状态驱动：dying > mining > spell > run > walk > idle（站立帧 = 待机首帧）
                const st = member._animState || 'idle';
                const miningKey = `companion_${member.id}_mining`;
                const dyingKey = `companion_${member.id}_dying`;
                if (st === 'dying' && anims.dying && this.textures.exists(dyingKey)) {
                    // 死亡动画只播一次（repeat 0），播完停在最后一帧；防每帧重播
                    if (!sprite.getData('hamsterDying')) {
                        sprite.setData('hamsterDying', true);
                        sprite.play(dyingKey, true);
                    }
                } else if (st === 'mining' && anims.mining && this.textures.exists(miningKey)) {
                    // 采矿两段式：进入采矿先播完整 19 帧（mining_start），
                    // 之后持续循环 5~19 帧（mining）——2026-08-15 用户口径
                    const miningStartKey = `${miningKey}_start`;
                    if (!sprite.getData('hamsterMining')) {
                        sprite.setData('hamsterMining', true);
                        if (anims.mining.startFrames && this.anims.exists(miningStartKey)) {
                            sprite.play(miningStartKey, true);
                            sprite.once('animationcomplete', () => {
                                if (sprite.getData('hamsterMining')
                                    && sprite.anims.currentAnim?.key === miningStartKey) {
                                    sprite.play(miningKey, true);
                                }
                            });
                        } else {
                            sprite.play(miningKey, true);
                        }
                    } else if (!sprite.anims.isPlaying
                        || (sprite.anims.currentAnim?.key !== miningKey
                            && sprite.anims.currentAnim?.key !== miningStartKey)) {
                        sprite.play(miningKey, true);
                    }
                } else if (st === 'spell' && anims.spell && this.textures.exists(spellKey)) {
                    // 重播条件 = 动画已停止（被 idle 停帧 setTexture 打断）或键变化。
                    // spell 已 repeat -1（循环播放中不会自然停），isPlaying 恒 true → 不重播；
                    // 只有被停帧打断时 isPlaying=false → 才重新播放。
                    if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== spellKey) {
                        sprite.play(spellKey, true);
                    }
                } else if (st === 'run' && anims.run && this.textures.exists(runKey)) {
                    if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== runKey) {
                        sprite.play(runKey, true);
                    }
                } else if (st === 'walk') {
                    if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== walkKey) {
                        sprite.play(walkKey, true);
                    }
                } else {
                    sprite.setData('hamsterDying', false);
                    sprite.setData('hamsterMining', false);
                    sprite.setData('lunaRunning', false);
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
            sprite.setVisible(true);
        }
        // 清理已移出队伍的精灵
        for (const id of Object.keys(this._companionSprites)) {
            if (!activeIds.has(id)) {
                this._companionSprites[id].destroy();
                delete this._companionSprites[id];
            }
        }
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

    /** 侍从普通攻击光球渲染（蓝色 impact_dot；_basic 由 CompanionAI 推进） */
    _syncCompanionBasics(_game) {
        if (!this._companionBasicSprites) this._companionBasicSprites = {};
        const members = PartySystem.members;
        for (const m of members) {
            const b = m._basic;
            let spr = this._companionBasicSprites[m.id];
            if (b && b.active) {
                if (!spr) {
                    if (!this.textures.exists('impact_dot') && typeof this._ensureImpactDotTexture === 'function') {
                        this._ensureImpactDotTexture();
                    }
                    spr = this.add.sprite(b.x, b.y, 'impact_dot');
                    spr.setTint(0x4db8ff);
                    spr.setBlendMode(BlendModes.ADD);
                    spr.setDisplaySize(24, 24);
                    this._companionBasicSprites[m.id] = spr;
                }
                spr.setPosition(b.x, b.y);
                spr.setDepth(b.y + 15);
                spr.setVisible(true);
            } else if (spr) {
                spr.setVisible(false);
            }
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
            Game.player.footOffsetY = playerShift;
            this.playerSprite.setPosition(Game.player.x, Game.player.y - playerShift);
            this._syncPlayerHandLayer();
            applyBodyFootOffset(this.playerSprite, playerShift);
            this.playerSprite.body.reset(Game.player.x, Game.player.y - playerShift);
        }

        // 同步所有敌人（自动为缺失 Sprite 的敌人创建占位 Sprite）
        Game.entities.forEach((entity) => {
            if (!entity || entity === Game.player) return;
            // 掉落物：位置/深度由 DropItem._syncPhaserSprite 自管（上下浮动 bob），
            // 此处每帧强写 (x, y - displayHeight/2) 会冲掉 bob 并抬高贴图——跳过
            if (entity.itemData && entity.noCollision) return;
            const isCorpse = entity._preserveCorpse && !entity.active &&
                (entity._deathAnimTimer > 0 || entity._corpseTimer > 0);
            if (!entity.active && !isCorpse) return;
            // 入侵特工（_faction === 'agent'）与敌人同口径创建精灵图——
            // 此前仅 'enemy'，入侵特工永远拿不到 sprite，只能画成 neutral_circle 占位圆（动画全消失）
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
            entity._phaserSprite.setPosition(syncX, syncY - shiftY);
            if (entity._phaserSprite.body) {
                applyBodyFootOffset(entity._phaserSprite, shiftY);
                entity._phaserSprite.body.reset(syncX, syncY - shiftY);
            }
            if (entity._faction === 'enemy' || entity._faction === 'agent') {
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
    _updateDynamicDepths() {
        const Game = window.Game;
        if (!Game) return;

        // 1. 玩家：深度基于脚底 Y（Sprite.y + footOffsetY）
        let playerNatural = 0, playerCorrected = 0;
        if (this.playerSprite && this.playerSprite.active) {
            const footOffsetY = this._getFootOffsetY(Game.player, this.playerSprite);
            playerNatural = this.playerSprite.y + footOffsetY + 10;
            // 衔接处遮挡仲裁（斜墙 flat 深度在衔接处的几何误差修正）；
            // frontRange = 贴图脚底→头顶高度（封顶 280）：墙前该范围内像素仍与墙重叠时也要抬升。
            // footOffsetY 语义 = 脚底相对贴图中心的偏移（见 _getFootOffsetY），
            // 故脚底→头顶 = footOffsetY + displayHeight/2（旧公式 displayHeight − footOffsetY
            // 把它算成 72，只有真实高度 144 的一半——通道上侧墙"稍远离即被挡"的死带根因）
            const playerFrontRange = Math.min(280, Math.max(60, footOffsetY + this.playerSprite.displayHeight / 2));
            playerCorrected = WallSystem.junctionCorrectedDepth(Game.player.x, Game.player.y, playerNatural, playerFrontRange);
            this.playerSprite.setDepth(playerCorrected);
        }

        // 2. 敌人 / 尸体
        if (Game.entities) {
            Game.entities.forEach(e => {
                if (!e || e === Game.player) return;
                // 掉落物：深度自管（随浮动贴图），不参与实体深度覆写
                if (e.itemData && e.noCollision) return;
                const isCorpse = e._preserveCorpse && !e.active &&
                    (e._deathAnimTimer > 0 || e._corpseTimer > 0);
                if (!e.active && !isCorpse) return;
                const sprite = e._phaserSprite;
                if (!sprite || !sprite.active) return;
                const footOffsetY = this._getFootOffsetY(e, sprite);
                // 衔接处遮挡仲裁（与玩家同口径；frontRange = 贴图脚底→头顶高度 = footOffsetY + displayHeight/2，
                // 封顶 280——覆盖大型怪（如 fly-hand spriteSize 260）；旧封顶 160 给它们留理论死带）
                const frontRange = Math.min(280, Math.max(60, footOffsetY + sprite.displayHeight / 2));
                const d = WallSystem.junctionCorrectedDepth(e.x, e.y, sprite.y + footOffsetY + (isCorpse ? 2 : 10), frontRange);
                sprite.setDepth(d);
            });
        }

        // 2.5 侍从跟随精灵：AI 队员按自身世界 Y 排序（墙后时应被墙遮挡，
        // 不再固定跟随玩家深度导致"图层在墙壁之上"）；纯渲染队员保持玩家层
        if (this._companionSprites) {
            for (const [cid, sprite] of Object.entries(this._companionSprites)) {
                if (!sprite || !sprite.active || !sprite.visible) continue;
                const unit = PartySystem.members.find(m => m.id === cid)
                    || (window.Game && Array.isArray(window.Game.friendlyUnits)
                        ? window.Game.friendlyUnits.find(u => u.id === cid) : null);
                if (!unit || !unit.aiConfig) continue;
                const footOffsetY = this._getFootOffsetY(unit, sprite);
                const frontRange = Math.min(280, Math.max(60, footOffsetY + sprite.displayHeight / 2));
                const d = WallSystem.junctionCorrectedDepth(
                    unit.x, unit.y, sprite.y + footOffsetY + 10, frontRange);
                sprite.setDepth(d);
            }
        }

        // 3. 玩家手持武器 / 盾牌跟随玩家深度，保持相对层级。
        // 玩家被墙压下（仲裁后 depth < 自然 depth）时跟随件改用 <0.5 的紧凑偏移——
        // 否则 +2/+1 的常规偏移会浮到遮挡墙之上（武器/盾牌穿墙显示）
        const playerDepth = (this.playerSprite && this.playerSprite.active) ? this.playerSprite.depth : 0;
        const occluded = !!(this.playerSprite && this.playerSprite.active) && playerCorrected < playerNatural;
        const weaponOff = occluded ? 0.4 : 2, offhandOff = occluded ? 0.3 : 1, shieldOff = occluded ? 0.2 : 1;
        if (this.weaponSprite && this.weaponSprite.active) {
            this.weaponSprite.setDepth(playerDepth + weaponOff);
        }
        if (this.offhandWeaponSprite && this.offhandWeaponSprite.active) {
            this.offhandWeaponSprite.setDepth(playerDepth + offhandOff);
        }
        if (this.shieldSprite && this.shieldSprite.active) {
            this.shieldSprite.setDepth(playerDepth + shieldOff);
        }
        // 手部分层：恒在武器之上（身体 + 常规偏移之上再 +1）
        if (this.playerHandSprite && this.playerHandSprite.active) {
            const handOff = occluded ? 0.5 : 3;
            this.playerHandSprite.setDepth(playerDepth + handOff);
        }

        // 4. 防御光环位于玩家下方
        if (this.defenseGlow && this.defenseGlow.active) {
            this.defenseGlow.setDepth(playerDepth - 2);
        }

        // 5. 魔法/技能特效按自身世界 Y 排序（符文剑/冰锥为浮空件，深度改由各同步函数按施法者精灵设置）
        [...this.iceSpikeGroup.getChildren()].forEach(s => {
            if (s && s.active) s.setDepth(s.y + 15);
        });
        if (this.fireballSprite && this.fireballSprite.active) {
            this.fireballSprite.setDepth(this.fireballSprite.y + 15);
        }
        [...this.iceSpikeFlyGroup.getChildren()].forEach(s => {
            if (s && s.active) s.setDepth(s.y + 15);
        });
        if (this.fireballFlySprite && this.fireballFlySprite.active) {
            this.fireballFlySprite.setDepth(this.fireballFlySprite.y + 15);
        }

        // 其他施法者（敌人巫师等）的特效
        if (this._magicSprites) {
            for (const [caster, sprites] of this._magicSprites) {
                const pd = this._projectileDepth(caster, 0);
                if (sprites.iceSpikes) {
                    sprites.iceSpikes.forEach(s => { if (s && s.active) s.setDepth(pd); });
                }
                if (sprites.iceSpikeFly) {
                    sprites.iceSpikeFly.forEach(s => { if (s && s.active) s.setDepth(pd); });
                }
                if (sprites.fireballEmitters) {
                    sprites.fireballEmitters.forEach(em => { if (em && em.visible) em.setDepth(pd); });
                }
            }
        }

        // 6. 无人机及其文字
        if (this.droneSprite && this.droneSprite.active) {
            const droneDepth = this.droneSprite.y + 18;
            this.droneSprite.setDepth(droneDepth);
            if (this.droneText && this.droneText.active) {
                this.droneText.setDepth(droneDepth + 1);
            }
        }

        // 7. 中立实体（NPC / 训练靶）统一深度
        if (this._neutralSprites) {
            for (const [e, data] of this._neutralSprites.entries()) {
                if (!e || !e.active || !data.sprite || !data.sprite.active) continue;
                const footOffsetY = this._getFootOffsetY(e, data.sprite);
                // 掩体等带显式地面锚线深度（_faceDepth = 底边线 max y + 12）的实体
                // 不能按“贴图中心 + footOffsetY + 10”（= e.y + 10）覆盖——e.y 是显示框
                // 底边，比掩体接地线深 22~137px，会把墙前实体错误排到墙后被盖
                // （2026-08-05 实机复现：怪物 depth 2100 < 掩体 2121）
                const depth = (typeof e._faceDepth === 'number') ? e._faceDepth : data.sprite.y + footOffsetY + 10;
                data.sprite.setDepth(depth);
                if (data.label && data.label.active) data.label.setDepth(depth + 1);
            }
        }
    }

    /**
     * 生成可复用的黑色圆影纹理
     */
    _ensureShadowTexture() {
        if (this.textures.exists('entity_shadow')) return;
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0x000000, 1);
        g.fillCircle(32, 32, 32);
        g.generateTexture('entity_shadow', 64, 64);
        g.destroy();
    }

    /**
     * 获取实体脚底相对于 Sprite 中心的偏移（像素）。
     * - 如果 render 或实体上显式配置了 footOffsetY，则使用配置值。
     * - 否则默认按 Sprite 显示高度的一半（即贴图方格底部）兜底。
     */
    _getFootOffsetY(entity, sprite) {
        if (!sprite) return 0;
        const configured = entity.footOffsetY ?? entity.config?.render?.footOffsetY;
        if (typeof configured === 'number') return configured;
        return sprite.displayHeight * 0.5;
    }

    /**
     * 判断实体是否显式配置了 footOffsetY（用于决定是否上移 Sprite 使逻辑位置落在脚底）。
     */
    _hasConfiguredFootOffset(entity) {
        return typeof (entity.footOffsetY ?? entity.config?.render?.footOffsetY) === 'number';
    }

    /**
     * 为所有可移动实体（玩家、敌人、中立实体）在脚下生成黑色圆影，
     * 圆影半径匹配统一 Collider 的 groundRadius，深度低于实体本身。
     */
    _syncEntityShadows(_game) {
        if (!_game) return;
        const dms = DungeonMapSystem;
        const isMapMode = SceneManager.currentScene === 'scene7' && dms && dms.active && dms.state === 'map';
        const active = new Set();

        const ensureShadow = (key, x, y, radius, depth, visible) => {
            let sprite = this._shadowSprites.get(key);
            if (!sprite || !sprite.active) {
                sprite = this.add.sprite(0, 0, 'entity_shadow');
                sprite.setOrigin(0.5, 0.5);
                this._shadowSprites.set(key, sprite);
            }
            sprite.setPosition(x, y);
            sprite.setDisplaySize(radius * 2, radius * 2 * PERSPECTIVE_SCALE_Y);
            sprite.setDepth(depth);
            sprite.setAlpha(0.35);
            sprite.setVisible(visible);
            return sprite;
        };

        // 玩家
        if (_game.player && this.playerSprite && this.playerSprite.active) {
            const e = _game.player;
            active.add(e);
            const depth = this.playerSprite.depth - 0.1; // 跟随本体仲裁后 depth（含墙体遮挡压下），始终略低于本体
            const cx = e.collider ? e.collider.x : e.x;
            const cy = e.collider ? e.collider.y : e.y;
            ensureShadow(e, cx, cy, e.groundRadius || 10, depth, !isMapMode);
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
                const depth = sprite.depth - 0.1; // 跟随本体仲裁后 depth（含墙体遮挡压下），始终略低于本体
                const cx = e.collider ? e.collider.x : e.x;
                const cy = e.collider ? e.collider.y : e.y;
                ensureShadow(e, cx, cy, e.groundRadius || 10, depth, !isMapMode);
            });
        }

        // 中立实体（NPC / 训练靶）
        if (this._neutralSprites) {
            for (const [e, data] of this._neutralSprites.entries()) {
                if (!e || !e.active || !data.sprite || !data.sprite.active) continue;
                if (e._noShadow) continue; // 配置跳过阴影（如仓库宝箱，贴图自带底座）
                active.add(e);
                const depth = e.y + 9;
                const cx = e.collider ? e.collider.x : e.x;
                const cy = e.collider ? e.collider.y : e.y;
                ensureShadow(e, cx, cy, e.groundRadius || 10, depth, !isMapMode);
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
            for (const k of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone']) {
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
        if (WallGate && WallGate.sprite && WallGate.sprite.active && WallGate._seg) {
            const gg = WallSystem._geoForTex(WallGate.sprite.texture ? WallGate.sprite.texture.key : 'wall_gate');
            occluders.push({
                sprite: WallGate.sprite,
                segs: [WallGate._seg],
                hWall: (gg ? gg.wallH : 800) * (WallGate._scale ? WallGate._scale.sy : 1),
            });
        }
        // 宝箱房门墙（精英战小房，独立实体）：同样纳入遮挡判定（isoSegments 格式转点对）
        if (ChestRoomSystem && ChestRoomSystem._gate && ChestRoomSystem._gate.sprite && ChestRoomSystem._gate.sprite.active) {
            const cg = ChestRoomSystem._gate;
            const cgg = WallSystem._geoForTex(cg.sprite.texture ? cg.sprite.texture.key : 'wall_gate');
            const cgSegs = [...(cg.segs || []), ...(cg.open ? [] : [cg.gateSeg])].filter(Boolean)
                .map(s => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
            occluders.push({
                sprite: cg.sprite,
                segs: cgSegs,
                hWall: (cgg ? cgg.wallH : 800) * (cg.sprite.scaleY || 1),
            });
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
            const cur0 = this._xrayMap.get(e);
            if (wallDepth === -Infinity) {
                if (cur0) {
                    for (const k of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone']) {
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
                    if (!src || !src.active) {
                        if (cur[key]) cur[key].setVisible(false);
                        return;
                    }
                    if (!cur[key]) cur[key] = this.add.sprite(0, 0, src.texture.key);
                    const c = cur[key];
                    c.setTexture(src.texture.key, src.frame && src.frame.name);
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
                syncAux('shieldClone', this.shieldSprite, 2.1);
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
                for (const k of ['circle', 'clone', 'hole', 'weaponClone', 'offhandClone', 'shieldClone']) {
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
        // 场景基础缩放（2026-08-14）：世界-122 缩小到 70%（≈视野多 43%，用户校准：0.5 过小）；
        // 其余场景 1:1。zoom punch 按基础缩放等比叠加，切换场景下一帧自动生效/还原。
        const sceneBaseZoom = (SceneManager && SceneManager.currentScene === 'scene8') ? 0.7 : 1;
        // zoom punch：开火瞬间视角轻微推近（2D 等价 FOV punch），GunFeel 内指数回落
        const zoom = sceneBaseZoom * (1 + GunFeel.zoomPunch);
        if (Math.abs(this.cameras.main.zoom - zoom) > 0.0004) this.cameras.main.setZoom(zoom);
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

            // 玩家碰撞/受击体积由配置驱动，保持与 Player 逻辑实体一致
            const { collisionWidth, collisionHeight } = PLAYER_DEFAULTS.physics;
            if (_game && _game.player) {
                _game.player.collisionShape = 'rect';
                _game.player.collisionWidth = collisionWidth;
                _game.player.collisionHeight = collisionHeight;
                _game.player.collisionRadius = Math.max(collisionWidth, collisionHeight) / 2;
            }
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
        const enemySprite = this.physics.add.sprite(data.x, data.y, data.texture || 'enemy_spider');
        enemySprite.setOrigin(0.5, 0.5);
        enemySprite.setData('enemyId', data.id);
        this._configureEnemyBody(enemySprite, data.enemyRef || { size: 14, collisionRadius: 14 });
        this.enemies.add(enemySprite);
    }

    /**
     * 统一配置敌人 Sprite 的显示尺寸与碰撞体，使碰撞体中心对齐贴图中心
     * 碰撞体改为与贴图匹配的矩形（collisionShape='rect'），并用 collisionRadius 作为圆形回退。
     */
    _configureEnemyBody(sprite, enemy) {
        const body = sprite.body;
        if (!body) return;
        body.setGravity(0, 0);
        const options = typeof enemy._getPhaserOptions === 'function' ? enemy._getPhaserOptions() : {};
        // 显示尺寸：优先使用 enemy.config.render 里的 spriteSize，其次按 size*4 兜底
        const renderCfg = enemy.config?.render || {};
        const spriteSize = options.spriteSize || renderCfg.spriteSize || (enemy.size || 14) * 4;
        // 等比缩放：spriteSize 语义为"最长边像素"。方形帧与旧行为一致（宽=高=spriteSize）；
        // 非方形帧（如手脑 walk 512×1024）按帧宽高比等比缩放，避免压扁变形
        const frameW = (sprite.frame && sprite.frame.width) || 1;
        const frameH = (sprite.frame && sprite.frame.height) || 1;
        const longest = Math.max(frameW, frameH);
        sprite.setDisplaySize(frameW * spriteSize / longest, frameH * spriteSize / longest);
        sprite.setOrigin(0.5, 0.5);

        // 逻辑碰撞体积：优先保留配置里已有的 gameplay 尺寸或 enemy 类型选项，
        // 其次按 collisionRadius / size 推导，不再直接用 spriteSize 放大 footprint
        const gameplayRadius = enemy.collisionRadius > 0 ? enemy.collisionRadius : (enemy.size || 14) * 0.6;
        const fallbackSize = gameplayRadius * 2;
        const collisionWidth = options.collisionWidth || enemy.collisionWidth || fallbackSize;
        const collisionHeight = options.collisionHeight || enemy.collisionHeight || fallbackSize;
        enemy.collisionShape = 'rect';
        enemy.collisionWidth = collisionWidth;
        enemy.collisionHeight = collisionHeight;
        // footprint（阴影/分离/命中椭圆）以配置 collisionRadius 为准（强绑定唯一来源）；
        // 仅在未配置（<=0）时回退矩形推导，不再无条件覆盖配置值
        if (!(enemy.collisionRadius > 0)) {
            enemy.collisionRadius = Math.max(collisionWidth, collisionHeight) / 2;
        }

        // Phaser 物理体改为矩形，大小与逻辑碰撞体积一致
        body.setSize(collisionWidth, collisionHeight);
        body.setImmovable(false);
        // 碰撞字段已最终确定，重建统一 3D Collider（兜底对象可能没有该方法）
        if (typeof enemy.rebuildCollider === 'function') {
            enemy.rebuildCollider();
        }
        if (options.tint !== undefined) {
            sprite.setTint(options.tint);
        }
        if (options.frame !== undefined) {
            try {
                sprite.setFrame(options.frame);
            } catch (_e) {
                // 帧索引无效时忽略
            }
        }
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
        const bodyTexKey = handLayer ? `${playerTextureKey(key)}_body` : null;

        // 根据朝向翻转（侧视精灵图默认朝右）——与武器/锚点同一中轴滞回判定（_getVisualFacingRight），
        // 禁用 _facingDir 四方向制（45° 边界），否则 45°~87° 区间身体与武器朝向相反
        const player = window.Game && window.Game.player;
        if (player) {
            this.playerSprite.setFlipX(!this._getVisualFacingRight(player));
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
            const oneShotKey = handLayer ? `${texKey}_body` : texKey;
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
                }
                // 冲刺期间/冲刺末帧定格期：不切 idle——dash_attack 播完也应停在末帧等恢复动画，
                // 否则定格窗口里贴图被换回 idle（"最后一帧用的是 idle 贴图"的根因）
                if (p && (p._isDashing || p._dashRecoverAt)) return;
                if (p && p._attackHoldUntil && nowMs() < p._attackHoldUntil
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
        const playTexKey = handLayer ? bodyTexKey : texKey;
        const playAnimKey = handLayer ? `${texKey}_body` : texKey;
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
        {
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
        }
        const frameW = this.playerSprite.frame.width || 512;
        const frameH = this.playerSprite.frame.height || 516;
        const dispW = this.playerSprite.displayWidth;
        const dispH = this.playerSprite.displayHeight;
        // 瞄准角（世界）与面向（±0.05 死区防正上/正下翻转抖动）
        const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
        const rawAim = Math.atan2(mouseWorld.y - player.y, mouseWorld.x - player.x);
        // 近距角度平滑（取代死区/可调锥，2026-07-27）：任何距离都用真实瞄准方向（弹道零误差），
        // 准心进入 aimSmoothRadius 内时对瞄准角做短弧 EMA——准心贴近时鼠标小位移会引起角度瞬变，
        // 躯干钳制/手臂/锚点跟不上会错位；平滑让角速度有界（近强远弱，出半径立即恢复零延迟）。
        // 贴图/锚点/弹道统一走 _effectiveAim（沿用 _frozenAimActive 标记，语义=平滑激活），四通道同口径
        const smoothR = twist.aimSmoothRadius ?? 160;
        const distToMouse = Math.hypot(mouseWorld.x - player.x, mouseWorld.y - player.y);
        let aim = rawAim;
        if (distToMouse < smoothR) {
            const now2 = nowMs();
            const dtMs2 = this._aimSmoothLastT ? Math.min(50, now2 - this._aimSmoothLastT) : 16.67;
            // 平滑时间常数：边缘≈0（零延迟）→ 中心 aimSmoothTau（默认 120ms，越大越"肉"，近战弱可加大）
            const t = 1 - distToMouse / smoothR;
            const tau = (twist.aimSmoothTau ?? 120) * t;
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
        let facingRight = this._twistState ? this._twistState.facingRight : true;
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
            const bobIdx = this.playerSprite.anims.currentFrame ? this.playerSprite.anims.currentFrame.index : 0;
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

    /**
     * 手臂条层（单骨伪 IK）：肩关节在躯干上随扭转走，每帧旋转 = atan2(枪握把 − 肩) − 自然角。
     * 只读 _twistState/_gunGripWorld，不影响任何锚点计算；躯干钳制之外的角度由它补。
     */
    _syncGunArm() {
        const twist = this._twistConfig;
        if (!twist || !twist.arm || !this.playerArmSprite) return;
        if (!this._twistState || !this.playerTorsoSprite || !this.playerTorsoSprite.visible) {
            this.playerArmSprite.setVisible(false);
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
                return;
            }
        }
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
     * 根据玩家移动状态自动切换 walk/run/idle 动画
     * 攻击/特殊动画期间不覆盖
     */
    _updatePlayerAnimation(_game) {
        if (!_game || !_game.player || !this.playerSprite || !this.playerSprite.active) return;
        const player = _game.player;
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
            const isPlayingAttackAnim = isMeleeWeapon && MELEE_STAGE_ANIM_KEYS.some(k => currentAnimKey === playerTextureKey(k)) && this.playerSprite.anims.isPlaying;
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


        // 持枪移动：腿层播走路/跑步腿动画（下半身裁片），躯干层保持（扭转继续由 _syncGunTwist 驱动）
        const gunWalkLegsKey = gunPose ? `${playerTextureKey(gunPose.poseKey)}_walklegs` : null;
        const gunRunLegsKey = gunPose ? `${playerTextureKey(gunPose.poseKey)}_runlegs` : null;
        const useRunLegs = player._isSprinting && gunPose && gunPose.def.twist.runLegs
            && gunRunLegsKey && this.anims.exists(gunRunLegsKey);
        const legsAnimKey = useRunLegs ? gunRunLegsKey : gunWalkLegsKey;
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
                this.playerSprite.setTexture(legsAnimKey);
                this.playerSprite.play(legsAnimKey, true);
            }
            this.playerSprite.anims.timeScale = 1;
            this._lastPlayerAnimKey = 'gun_walk';
            this._playerAnimIdleStart = 0;
            return;
        }

        let key = 'idle';
        if (player._isSprinting && player.isMoving) {
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
        this.setPlayerAnimation(key);
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
     * 同步玩家武器到 Phaser Sprite
     * 创建武器 Sprite 并跟随玩家位置和旋转
     */
    syncWeapon(player, weaponAnim = {}) {
        if (!this.playerSprite || !player) return;
        
        const currentItem = player.equipments[player.weaponMode];
        if (!currentItem || !currentItem.name) {
            if (this.weaponSprite) this.weaponSprite.setVisible(false);
            return;
        }
        
        // 根据 weaponType 和 weaponId 精确映射贴图
        let texture = getWeaponTextureKey(currentItem);
        // 动画/贴图配置键：animConfigKey 优先（R93 等新枪不再共用 G18 pistol 配置——副手翻转根因）
        const wt = currentItem.animConfigKey || currentItem.weaponType;
        const isMelee = wt === 'sword' || wt === 'bow';

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
                this.weaponSprite.setPosition(player.x + offX, player.y + offY - this._getFootOffsetY(player, this.playerSprite));
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
                if (player._isSprinting) animState = 'running';
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
        const isSpecialAnim = player._isWhirlwind || player._isDashing || player._dashRecoverAt || player._dashResetAnim || player._specialAttackActive || player._specialResetAnim;
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
        // inAttackHold：攻击后定格保持窗口（连段等待）——武器定格在上一段轨迹末帧
        const inAttackHold = !!(player._attackHoldUntil && nowMs() < player._attackHoldUntil && !player.isMoving);
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
                        progress = 0;
                        if (this._playerAttackStartTime && this._playerAttackDuration > 0) {
                            progress = Math.min(1, (nowMs() - this._playerAttackStartTime) / this._playerAttackDuration);
                        } else {
                            const currentAnim = this.playerSprite.anims.currentAnim;
                            if (currentAnim && MELEE_STAGE_ANIM_KEYS.some(k => currentAnim.key === playerTextureKey(k)) && this.playerSprite.anims.getProgress) {
                                progress = this.playerSprite.anims.getProgress();
                            }
                        }
                    }
                    // 朝向硬绑定：武器朝向 = 人物贴图 flipX（身体是唯一权威）——
                    // 攻击/定格/收势期间身体 flipX 冻结，武器自然冻结，无需独立朝向捕获
                    const facingRight = !this.playerSprite.flipX;
                    // 以右攻击为参考，朝左时翻转贴图并镜像位置/旋转
                    const pfPos = WeaponTransform.getInterpolatedPerFramePosition(player, wt, progress, true, atkCfgKey);
                    if (pfPos) {
                        const wx = facingRight ? pfPos.x : 2 * player.x - pfPos.x;
                        const wrot = facingRight ? pfPos.rotation : -pfPos.rotation;
                        this.weaponSprite.setPosition(wx, pfPos.y);
                        this.weaponSprite.setRotation(wrot);
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

        // 收势滑行（recover 播放中）：武器从上一段轨迹末帧**线性滑回 idle 持械位**（位置/旋转/缩放同步渐变），
        // 不瞬移；朝向沿用定格冻结朝向（收势期间鼠标转向不影响）
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
                    let dRot = endRot - start.rotation;
                    dRot = Math.atan2(Math.sin(dRot), Math.cos(dRot)); // 短弧插值
                    const sizeStart = WeaponTransform.getWeaponSize(wt, start.scale, 'attack');
                    const sizeEnd = WeaponTransform.getWeaponSize(wt, null, 'idle');
                    this.weaponSprite.setPosition(
                        start.x + (end.x - start.x) * t,
                        start.y + (end.y - start.y) * t
                    );
                    this.weaponSprite.setRotation(start.rotation + dRot * t);
                    this.weaponSprite.setFlipX(!facingR);
                    this.weaponSprite.setDisplaySize(
                        sizeStart.width + (sizeEnd.width - sizeStart.width) * t,
                        sizeStart.height + (sizeEnd.height - sizeStart.height) * t
                    );
                    this.weaponSprite.setVisible(!this._useCanvasWeapon);
                    return;
                }
            }
        }

        // 使用 WeaponTransform 统一计算位置和旋转
        // 按玩家状态推断动画状态
        if (!this.weaponSprite) {
            this.weaponSprite = this.add.sprite(0, 0, texture);
        } else if (this.weaponSprite.texture.key !== texture) {
            this.weaponSprite.setTexture(texture);
        }
        
        // 使用 WeaponTransform 统一计算位置和旋转
        // 按玩家状态推断动画状态
        let animState = 'idle';
        if (player._isSprinting) animState = 'running';
        else if (player.isMoving) animState = 'walk';
        else if (weaponAnim.isAttacking && weaponAnim.state !== 'idle') animState = 'attack';

        // ===== 行走逐帧轨迹（walkFrames）：武器握把跟随行走动画右手摆动 =====
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
            const curAnim = this.playerSprite.anims.currentAnim;
            // 兼容手部分层：walk 实际播 player_walk_body（身体层去手），进度口径一致
            const walkBodyKey = `${playerTextureKey('walk')}_body`;
            if (curAnim && (curAnim.key === playerTextureKey('walk') || curAnim.key === walkBodyKey)
                && this.playerSprite.anims.getProgress) {
                walkProgress = this.playerSprite.anims.getProgress();
            }
            const facingRight = !this.playerSprite.flipX;
            // 平滑轨迹：Catmull-Rom 闭合样条插值（消除相邻帧提取噪声导致的"瞬移/顿挫"，
            // 首尾闭合保证循环动画无跳变）
            const wfPos = WeaponTransform.getSmoothPerFramePosition(
                player, wt, walkProgress, true, isStaffWeapon ? 'staffWalkFrames' : 'walkFrames'
            );
            if (wfPos) {
                const wx = facingRight ? wfPos.x : 2 * player.x - wfPos.x;
                const wrot = facingRight ? wfPos.rotation : -wfPos.rotation;
                this.weaponSprite.setPosition(wx, wfPos.y);
                this.weaponSprite.setRotation(wrot);
                this.weaponSprite.setFlipX(!facingRight);
                const wSize = WeaponTransform.getWeaponSize(wt, wfPos.scale, 'walk');
                this.weaponSprite.setDisplaySize(
                    wSize.width * (wfPos.stretchX || 1),
                    wSize.height * (wfPos.stretchY || 1)
                );
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
        if (isMelee) {
            rot = WeaponTransform.getWeaponRotation(0, wt, 0, animState, facingRight);
        } else if (typeof Input !== 'undefined' && Input.mouse) {
            // 瞄准死区激活：用可调锥有效角（与姿态/手臂/锚点同口径）
            if (this._frozenAimActive && this._effectiveAim !== undefined) {
                rot = this._effectiveAim;
            } else {
                const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
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
        // 瞄左（|rot|>90°）时贴图 flipY 防倒置——握把点的贴图内 Y 随之镜像，补偿必须同步取反
        const gunFlipY = isGun && Math.abs(rot) > Math.PI / 2;
        // rotOffset 随 flipY 镜像取反：右 -6° ↔ 左 +6°（否则枪管方向左右不对称，火焰/弹道同偏）
        rot += gunFlipY ? -gunRotOffset : gunRotOffset;

        // 记录握把（锚点）世界坐标，供手臂条层追随（下一帧读取）
        this._gunGripWorld = isGun ? { x: pos.x, y: pos.y } : null;

        // 握把旋转轴心（配置 grip，缺省贴图中心）：锚点=握把点（手上），
        // 贴图中心随旋转绕握把公转——消除"360 瞄准时握把在手上打滑"
        const gripCfg = isGun && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].grip;
        if (gripCfg) {
            const gcx = (0.5 - (gripCfg.x !== undefined ? gripCfg.x : 0.5)) * wSize.width;
            const gcyRaw = (0.5 - (gripCfg.y !== undefined ? gripCfg.y : 0.5)) * wSize.height;
            const gcy = gunFlipY ? -gcyRaw : gcyRaw;
            pos.x += Math.cos(rot) * gcx - Math.sin(rot) * gcy;
            pos.y += Math.sin(rot) * gcx + Math.cos(rot) * gcy;
        }

        // 贴图显示偏移（配置 spriteOffsetX/Y，世界 px，X 随 flipY 镜像）——
        // 只移动贴图渲染位置：手臂/锚点（_gunGripWorld 已记录）与弹道逻辑不受影响，枪口随贴图走。
        // 读取优先级：装备实例字段 > EquipDataManager 标准配置（按 weaponId 直查——实例可能来自
        // 旧存档/商店克隆缺字段，getAmmoConfig 同款教训）> anim 配置（两把共用 animConfigKey 的枪可各自微调）
        const _wepCfg = isGun ? findWeaponConfig(currentItem.weaponId, currentItem.name) : null;
        const spriteOffX = isGun && (currentItem.spriteOffsetX ?? (_wepCfg && _wepCfg.spriteOffsetX) ?? (WeaponAnimConfig[wt] && WeaponAnimConfig[wt].spriteOffsetX));
        const spriteOffY = isGun && (currentItem.spriteOffsetY ?? (_wepCfg && _wepCfg.spriteOffsetY) ?? (WeaponAnimConfig[wt] && WeaponAnimConfig[wt].spriteOffsetY));
        if (spriteOffX) pos.x += gunFlipY ? -spriteOffX : spriteOffX;
        if (spriteOffY) pos.y += spriteOffY;
        // 逐武器瞄准贴图微调（配置 aimSpriteOffsetX/Y，世界 px × _aimEase 混合）：
        // 只动瞄准态贴图渲染位置，腰射（ease=0）不变；手臂/锚点与弹道同样不受影响
        const aimSprOffX = isGun && (currentItem.aimSpriteOffsetX ?? (_wepCfg && _wepCfg.aimSpriteOffsetX) ?? (WeaponAnimConfig[wt] && WeaponAnimConfig[wt].aimSpriteOffsetX));
        const aimSprOffY = isGun && (currentItem.aimSpriteOffsetY ?? (_wepCfg && _wepCfg.aimSpriteOffsetY) ?? (WeaponAnimConfig[wt] && WeaponAnimConfig[wt].aimSpriteOffsetY));
        if (aimSprOffX) pos.x += (gunFlipY ? -aimSprOffX : aimSprOffX) * (this._aimEase || 0);
        if (aimSprOffY) pos.y += aimSprOffY * (this._aimEase || 0);

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
        } else {
            this.weaponSprite.setDisplaySize(wSize.width, wSize.height);
            // 近战朝左贴图镜像：旋转码（π−idleRot）恰等于 −R_r（正确镜像角，
            // 关系式 M∘Rot(R)=Rot(−R)∘M），补 flipX 构成绕垂直轴完整镜像；
            // 位置镜像已在 localToWorld 完成（与攻击 perFrame 分支"旋转取反+flipX"同惯例）
            this.weaponSprite.setFlipY(false);
            this.weaponSprite.setFlipX(isMelee && !facingRight);
        }
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
        // 与 _syncGunArm 的帧旋转同口径，枪与手臂帧严格一体。按 _aimEase 与旧链锚点混合：
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
        return pos;
    }

    /**
     * 同步副手武器到 Phaser Sprite
     */
    syncOffhandWeapon(player, weaponAnim = {}) {
        if (!this.playerSprite || !player) return;
        
        const offhandSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
        const offhandItem = player.equipments[offhandSlot];
        
        if (!offhandItem || !offhandItem.name) {
            if (this.offhandWeaponSprite) this.offhandWeaponSprite.setVisible(false);
            return;
        }
        
        // 如果副手不是武器（如盾牌），隐藏 Sprite
        const isWeapon = offhandItem.category === 'weapon_melee' || offhandItem.category === 'weapon_ranged' ||
                         ['pistol', 'pkm', 'akm', 'm416', 'qbz191', 'qjb201', 'shotgun', 'bow', 'sword'].includes(offhandItem.weaponType);
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
        const isSpecialAnim = player._isWhirlwind || player._isDashing || player._dashResetAnim || player._specialAttackActive || player._specialResetAnim;
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
        if (player._isSprinting) offhandAnimState = 'running';
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
        const wSize = WeaponTransform.getWeaponSize(wt);

        // 握把旋转轴心（与主手同口径；配置 grip，缺省贴图中心）
        const gripCfgOff = isGunOff && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].grip;
        if (gripCfgOff) {
            const gcx = (0.5 - (gripCfgOff.x !== undefined ? gripCfgOff.x : 0.5)) * wSize.width;
            const gcyRaw = (0.5 - (gripCfgOff.y !== undefined ? gripCfgOff.y : 0.5)) * wSize.height;
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
                // 悬浮在各自 elev 高度（碰撞/落点仍在 flyX/flyY 地面坐标）
                sprite.setPosition(sword.flyX, sword.flyY - (sword.elev ?? (player.bodyHeight || 0) * 0.5));
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
            const worldY = player.y - (sword.elev ?? (player.bodyHeight || 0) * 0.5) + sin * localX + cos * localY;
            
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
            if (sprites.iceSpikes) sprites.iceSpikes.forEach(s => s.destroy());
            if (sprites.iceSpikeFly) sprites.iceSpikeFly.forEach(s => s.destroy());
            if (sprites.fireball) sprites.fireball.destroy();
            if (sprites.fireballFly) sprites.fireballFly.destroy();
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

    _positionFireballEmitters(caster, x, y, scale) {
        const ems = this._ensureFireballEmitters(caster, scale || 1);
        for (const em of ems) {
            em.setPosition(x, y);
            // 浮空件深度 = 施法者精灵深度 + 2（避免按抬升后 y 排序沉到施法者身后不可见）
            em.setDepth(this._projectileDepth(caster, y));
            em.setVisible(true);
        }
    }

    /** 投射物/特效浮空深度：优先施法者精灵深度 + 2；无精灵时回退 y + 15 */
    _projectileDepth(caster, fallbackY) {
        if (caster === Game.player && this.playerSprite) return this.playerSprite.depth + 2;
        if (caster && caster._phaserSprite) return caster._phaserSprite.depth + 2;
        return (fallbackY || 0) + 15;
    }

    _hideFireballEmitters(caster) {
        const sprites = this._getMagicSprites(caster);
        if (sprites.fireballEmitters) {
            for (const em of sprites.fireballEmitters) em.setVisible(false);
        }
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
            const worldY = caster.y - (spike.elev ?? (caster.bodyHeight || 0) * 0.5) + sin * localX + cos * localY;

            // 玩家通过鼠标瞄准；敌人自动瞄准 caster.target。
            // 参考调整前代码：所有冰锥统一以施法者中心→鼠标准星的朝向（整圈冰锥同一指向，全部对准准星方向）
            let absoluteAngle;
            if (caster === Game.player) {
                const camera = this.cameras.main;
                const mouseX = camera.scrollX + (Input.mouse?.x || 0);
                const mouseY = camera.scrollY + (Input.mouse?.y || 0);
                absoluteAngle = Math.atan2(mouseY - caster.y, mouseX - caster.x);
            } else {
                const target = caster.target;
                if (target && target.active) {
                    absoluteAngle = Math.atan2(target.y - caster.y, target.x - caster.x);
                } else {
                    absoluteAngle = caster.rotation || 0;
                }
            }

            sprite.setPosition(worldX, worldY);
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
        const worldY = caster.y - (fb.elev ?? (caster.bodyHeight || 0) * 0.5) + sin * localX + cos * localY;

        // 火炬同款火焰粒子（放大版）替换固定贴图
        this._positionFireballEmitters(caster, worldX, worldY, fb.scale || 1);
    }

    /**
     * Phase 3 续：同步盾牌到 Phaser Sprite
     */
    _syncShield(player) {
        const offhandSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
        const offhandItem = player.equipments[offhandSlot];
        
        if (!offhandItem || offhandItem.weaponType !== 'shield') {
            if (this.shieldSprite) this.shieldSprite.setVisible(false);
            return;
        }
        
        const texture = getWeaponTextureKey(offhandItem);
        if (!this.shieldSprite) {
            this.shieldSprite = this.add.sprite(0, 0, texture);
        } else if (this.shieldSprite.texture.key !== texture) {
            this.shieldSprite.setTexture(texture);
        }
        
        const s = player.size;
        const sw = s * 6.25 * 0.55;
        const sh = s * 6.25 * 0.7;
        
        // 计算盾牌世界位置（基于 player 旋转）
        const offsetX = 20;
        const offsetY = -20;
        const cos = Math.cos(player.rotation);
        const sin = Math.sin(player.rotation);
        const worldX = player.x + cos * offsetX - sin * offsetY;
        const worldY = player.y + sin * offsetX + cos * offsetY;
        
        let rot = player.rotation + Math.PI / 2;
        if (player.shieldSystem && player.shieldSystem.defending) {
            rot -= 0.3;
        }
        
        this.shieldSprite.setPosition(worldX, worldY);
        this.shieldSprite.setRotation(rot);
        this.shieldSprite.setDisplaySize(sw, sh);
        this.shieldSprite.setVisible(true);
        
        // 防御红光（用 Phaser 图形或 Sprite）
        if (player.shieldSystem && player.shieldSystem.defending) {
            // 创建或更新防御光环
            if (!this.defenseGlow) {
                this.defenseGlow = this.add.graphics();
            }
            this.defenseGlow.clear();
            const flicker = 0.5 + Math.sin(Date.now() / 200) * 0.25;
            const r = player.size + 8;
            this.defenseGlow.fillStyle(0xcc3333, flicker * 0.35);
            this.defenseGlow.fillEllipse(player.x, player.y, r * 2, r * 2 * PERSPECTIVE_SCALE_Y);
            this.defenseGlow.lineStyle(2, 0xff5555, flicker * 0.6);
            this.defenseGlow.strokeEllipse(player.x, player.y, (r + 2) * 2, (r + 2) * 2 * PERSPECTIVE_SCALE_Y);
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
                // 飞行视觉悬浮在各自 elev 高度（碰撞/落点仍在 flyX/flyY 地面坐标）
                // 高度随飞行进度收敛：到达瞄准点（targetDist）时降到地面，所有冰锥精确汇聚于鼠标准星
                const flyProg = spike.targetDist ? Math.min(1, spike.flyDistance / spike.targetDist) : 0;
                const raiseY = (spike.elev ?? (caster.bodyHeight || 0) * 0.5) * (1 - flyProg);
                sprite.setPosition(spike.flyX, spike.flyY - raiseY);
                sprite.setDepth(this._projectileDepth(caster, spike.flyY));
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
        // 飞行高度随进度收敛：到达瞄准点（targetDist）时降到地面，与冰锥同口径
        const flyProg = fb.targetDist ? Math.min(1, fb.flyDistance / fb.targetDist) : 0;
        const raiseY = (fb.elev ?? (caster.bodyHeight || 0) * 0.5) * (1 - flyProg);
        this._positionFireballEmitters(caster, fb.flyX, fb.flyY - raiseY, fb.scale || 1);
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

    // 统一的特殊动画武器同步（风车/冲刺/复位/特殊攻击）
    // 将 Canvas 变换链转换为世界坐标
    _syncSpecialWeaponAnim(player, wt, _weaponAnim) {
        if (!this.weaponSprite) {
            const texture = getWeaponTextureKey(player.equipments[player.weaponMode]);
            this.weaponSprite = this.add.sprite(0, 0, texture);
        }

        // 冲刺攻击：sword.dash perFrame 轨迹（面板"冲刺攻击"页可调，与一/二段同插值管线）
        // 末帧定格期（_dashRecoverAt）同轨迹停在 progress=1——定格姿态=冲刺末帧，与人物贴图一致
        const dashCfg = (wt === 'sword' || wt === 'bow') && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].dash;
          // 冲刺攻击·剑柄锚手（dashHand 模式）：
          // 旧 dash 30 点轨迹是"贴图中心"路径；由 WeaponTransform.getDashHandPosition
          // 反推握把点并让 weaponSprite.origin=剑柄——剑柄钉在手上，剑身按
          // dashHand.fromRotation→toRotation 线性扫出 180°（默认 -90° → +90°，后→前）。
          const dashHandCfg = (wt === 'sword' || wt === 'bow') && WeaponAnimConfig[wt] && WeaponAnimConfig[wt].dashHand;
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
              const hp = WeaponTransform.getDashHandPosition(player, wt, progress);
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
            const activeSkillId = player._getActiveDashSkillId ? player._getActiveDashSkillId() : null;
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
        const active = new Set();
        // 单个实体的双星处理（怪物贴图 _phaserSprite；玩家贴图挂 this.playerSprite，单独传入）
        const process = (e, sprite) => {
            if (!e || !e.active || !sprite || !sprite.active) return;
            const stunned = typeof e.hasStatusEffect === 'function' && e.hasStatusEffect('stun');
            if (!stunned) return;
            active.add(e);
            let fx = this._stunFx.get(e);
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
        const active = new Set();
        const process = (e, sprite) => {
            if (!e || !e.active || !sprite || !sprite.active) return;
            const frozen = typeof e.hasStatusEffect === 'function' && e.hasStatusEffect('frozen');
            if (!frozen) return;
            active.add(e);
            let fx = this._freezeFx.get(e);
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
            // 段间图层：y 为主（南段压北段），同 y（横向墙）时中心段在前，堆叠成"冰脊"而非随机互压
            const centerIdx = (walls.length - 1) / 2;
            s.setDepth(w.y + 1 + (walls.length - Math.abs(i - centerIdx)) * 0.01);
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
        const active = new Set();
        const process = (e, sprite) => {
            if (!e || !e.active || !sprite || !sprite.active) return;
            const inspired = typeof e.hasStatusEffect === 'function' && e.hasStatusEffect('inspire');
            if (!inspired) return;
            active.add(e);
            let fx = this._inspireFx.get(e);
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
        if (!boss.active) {
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
        // 实体间碰撞：使用 overlap 检测但不自动响应，保持现有逻辑处理
        this._setupEntityOverlap();
        this._collidersSet = true;
        
    }

    /**
     * 设置实体间 overlap 检测（玩家/敌人之间）
     * 碰撞响应仍由 Game.resolveCollisions() 处理，这里只做检测标记
     */
    _setupEntityOverlap() {
        if (this.playerSprite) {
            this.physics.add.overlap(this.playerSprite, this.enemies, (_playerSprite, _enemySprite) => {
                // 不自动响应，仅记录碰撞对
                // 现有 Game.resolveCollisions() 仍负责实际的碰撞分离
                // 未来可在此调用 Phaser 的物理响应，逐步替换
            });
        }
        // 敌人 vs 敌人 overlap
        this.physics.add.overlap(this.enemies, this.enemies, (_enemyA, _enemyB) => {
            // 同上，不做自动响应
        });
        
    }

    getPlayerSprite() { return this.playerSprite; }
    getEnemyGroup() { return this.enemies; }
    getWallGroup() { return this.walls; }

    // 清理所有实体 Sprite（场景切换时调用）
    clearAllEntitySprites() {
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
        for (const text of this._entityHudTexts.values()) {
            if (text && text.active) text.destroy();
        }
        this._entityHudTexts.clear();
        // 清除通用施法者特效注册表
        if (this._magicSprites) {
            for (const sprites of this._magicSprites.values()) {
                if (sprites.iceSpikes) sprites.iceSpikes.forEach(s => s.destroy());
                if (sprites.iceSpikeFly) sprites.iceSpikeFly.forEach(s => s.destroy());
                if (sprites.fireball) sprites.fireball.destroy();
                if (sprites.fireballFly) sprites.fireballFly.destroy();
            }
            this._magicSprites.clear();
        }
    }

    /**
     * 同步无人机到 Phaser Sprite
     */
    _syncDrone(player) {
        if (!player.droneSystem || !player.droneSystem.active) {
            if (this.droneSprite) this.droneSprite.setVisible(false);
            if (this.droneRangeGraphics) this.droneRangeGraphics.clear();
            if (this.droneText) this.droneText.setVisible(false);
            return;
        }
        
        const drone = player.droneSystem;
        
        // 创建/更新无人机 Sprite
        if (!this.droneSprite) {
            this.droneSprite = this.add.sprite(0, 0, 'drone');
            this.droneSprite.setDisplaySize(32, 32);
        }
        this.droneSprite.setPosition(drone.x, drone.y);
        this.droneSprite.setVisible(true);
        
        // 操控模式下显示范围圈
        if (drone.controlling && window.Game && window.Game.showAttackRange) {
            if (!this.droneRangeGraphics) {
                this.droneRangeGraphics = this.add.graphics();
                this.droneRangeGraphics.setDepth(90);
            }
            this.droneRangeGraphics.clear();
            this.droneRangeGraphics.lineStyle(1, 0x5a7a9a, 0.3);
            this.droneRangeGraphics.strokeEllipse(drone.x, drone.y, drone.radius * 2, drone.radius * 2 * PERSPECTIVE_SCALE_Y);
        } else if (this.droneRangeGraphics) {
            this.droneRangeGraphics.clear();
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
        this.droneText.setPosition(drone.x, drone.y - 18);
        this.droneText.setText(`${remainingSec}s`);
        this.droneText.setVisible(true);
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

        const activeEntities = new Set();
        // 实体血条与名字
        for (const entity of _game.entities.values()) {
            if (!entity || !entity.active || entity === _game.player) continue;
            if (typeof entity.x !== 'number' || typeof entity.y !== 'number') continue;
            activeEntities.add(entity);
            this._syncEntityHud(entity);
        }
        // 玩家血条/体力条
        activeEntities.add(_game.player);
        this._syncPlayerHud(_game.player);

        // 清理已失效实体的文本
        for (const [key, text] of this._entityHudTexts.entries()) {
            if (!activeEntities.has(key.entity)) {
                text.destroy();
                this._entityHudTexts.delete(key);
            }
        }

        // 准星
        this._syncCrosshair(gScreen);
        // 小地图
        this._syncMinimap();
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

        const drawEntity = (entity) => {
            if (!entity || !entity.active) return;
            // 跳过配置了 noFootprint 的实体（如矿洞，保留碰撞判定但不显示脚下椭圆晕影）
            if (entity.config?.noFootprint) return;
            const r = entity.groundRadius || entity.collisionRadius || entity.size * 0.6 || 12;

            // footprint / 圆柱体使用 collider 坐标，支持前倾/攻击时的 footprint 偏移。
            const cx = entity.collider ? entity.collider.x : entity.x;
            const cy = entity.collider ? entity.collider.y : entity.y;

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

        // 敌人 + NPC（祭坛/仓库等 ellipse footprint 统一显示；掉落物/传送门不画）
        for (const entity of _game.entities.values()) {
            if (!entity || !entity.active || entity === _game.player) continue;
            if (entity._faction !== 'enemy' && !entity.npcType) continue;
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

        // 矩形 footprint（祭坛/仓库等固定 NPC）：用人物圆柱体同款橙色标识——
        // 底面矩形 = footprint（collisionWidth/Height），顶面 = 底面沿 Z 上移 bodyHeight，
        // 侧壁竖线连四角（与圆柱体"footprint 沿 Z 拉伸"同语义，供左下角「范围」按钮查看）
        for (const entity of _game.entities.values()) {
            if (!entity || !entity.active) continue;
            if (entity._faction === 'enemy') continue; // 敌人走 drawEntity 椭圆口径（本段只服务祭坛/仓库类 NPC）
            if (entity.collisionShape !== 'rect' || !(entity.collisionWidth > 0 && entity.collisionHeight > 0)) continue;
            const rcx = entity.collider ? entity.collider.x : entity.x;
            const rcy = entity.collider ? entity.collider.y : entity.y;
            const hw = entity.collisionWidth / 2, hh = entity.collisionHeight / 2;
            const topY = rcy - (entity.bodyHeight || 60);
            const g = this._collisionRadiusGraphics;
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
        const maxHp = entity.maxHp || entity.data?.maxHp || 1;
        const hp = entity.hp ?? entity.data?.hp ?? maxHp;
        if (maxHp <= 0) return;
        const hpPercent = Math.max(0, Math.min(1, hp / maxHp));
        const size = entity.size || 14;
        const sprite = (entity._phaserSprite && entity._phaserSprite.active) ? entity._phaserSprite : null;
        const x = sprite ? sprite.x : entity.x;
        // 能源矿/掩体/基地等走 _neutralSprites 渲染，没有 _phaserSprite；
        // 其贴图顶部 = 逻辑脚底 − spriteCfg.sizeH，血条/名字据此锚定。
        const neutralVisualH = (!sprite && (entity._isDefenseStructure || entity._isEnergyNode) && entity.spriteCfg?.sizeH)
            ? entity.spriteCfg.sizeH
            : 0;
        const topY = sprite
            ? sprite.y - sprite.displayHeight * 0.5
            : (neutralVisualH > 0 ? entity.y - neutralVisualH : entity.y - size * 1.5);

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

        // 普通敌人血条：受伤时才显示
        // hudOffsetY（render 配置）：贴图透明上沿过大时整体下移名字/血条的校准量
        // render 来源：新怪（enemy-config.json）走 entity.config.render，老怪（animation-config）走 _animCfg.render
        const renderCfg = entity._animCfg?.render || entity.config?.render || {};
        const hudDy = renderCfg.hudOffsetY || 0;
        // 默认工作流（新增怪物）：render.capsuleHudAnchor=true 时名字/血条锚定**圆柱体**碰撞体积
        // 最上方——三套碰撞体积注意区分：footprint 椭圆（地面）/ 绿色矩形（collisionWidth×collisionHeight
        // 近战判定）/ 圆柱体胶囊（collider.height，投射物判定）。锚点 = 胶囊 footprint Y − collider.height；
        // 旧怪物保持贴图顶部锚点不动
        let anchorTop = topY;
        if (renderCfg.capsuleHudAnchor) {
            const capH = (entity.collider && entity.collider.height) || renderCfg.spriteSize || size * 2;
            anchorTop = (entity.collider ? entity.collider.y : entity.y) - capH;
        }
        if (hp < maxHp) {
            const structureBarCfg = entity._isEnergyNode
                ? { width: 42, height: 6, offsetY: -34 }
                : (entity._isDefenseCover ? { width: 44, height: 5, offsetY: -36 } : null);
            const cfg = structureBarCfg || renderCfg.healthBar || { width: 28, height: 4, offsetY: -30 };
            const barW = cfg.width || 28;
            const barH = cfg.height || 4;
            const barY = anchorTop + hudDy + (cfg.offsetY || -8);
            const barX = x - barW / 2;
            this.worldHudGraphics.fillStyle(0x1a0a0a, 1);
            this.worldHudGraphics.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
            this.worldHudGraphics.fillStyle(0x5a1010, 1);
            this.worldHudGraphics.fillRect(barX, barY, barW, barH);
            const hpColor = hpPercent > 0.5 ? 0xc04040 : hpPercent > 0.25 ? 0xa03030 : 0x8a1a1a;
            this.worldHudGraphics.fillStyle(hpColor, 1);
            this.worldHudGraphics.fillRect(barX, barY, barW * hpPercent, barH);
        }

        // 名字标签：掉落物、NPC、训练靶等自带标签，跳过避免重叠
        const hasOwnLabel = entity.noNameLabel || entity.npcType || entity._dpsTracking !== undefined || (entity.itemData !== undefined);
        if (hasOwnLabel) {
            // 隐藏之前可能已创建的名字文本
            for (const [key, text] of this._entityHudTexts.entries()) {
                if (key.entity === entity && key.role === 'name') {
                    text.setVisible(false);
                }
            }
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
        nameText.setColor(rankColor || '#d4c5a9cc');
        nameText.setPosition(x, anchorTop + hudDy - 6);
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
        // name 文本与数值文本分别缓存，Map key 使用 {entity, role} 对象
        let cache = null;
        for (const [key, text] of this._entityHudTexts.entries()) {
            if (key.entity === entity && key.role === role) {
                cache = text;
                break;
            }
        }
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
            this._entityHudTexts.set({ entity, role }, cache);
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
                if (data.sprite && data.sprite.active) data.sprite.destroy();
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
        for (const text of this._entityHudTexts.values()) {
            if (text && text.active) text.destroy();
        }
        this._entityHudTexts.clear();
    }

    _syncCrosshair(_g) {
        const player = window.Game && window.Game.player;
        if (!player) return;
        // 出征面板或地牢地图模式：强制恢复默认鼠标指针，避免与地图/面板交互冲突
        const isDungeonNonCombat = DungeonMapSystem && DungeonMapSystem.active &&
            (DungeonMapSystem.state === 'map' || DungeonMapSystem.state === 'event' ||
             DungeonMapSystem.state === 'shop' || DungeonMapSystem.state === 'reward');
        if ((ExpeditionSystem && ExpeditionSystem._isOpen) || isDungeonNonCombat) {
            document.body.style.cursor = 'default';
            if (this._domCursor) this._domCursor.style.display = 'none';
            return;
        }
        const currentWeapon = player.equipments[player.weaponMode];
        const isBowWeapon = currentWeapon && currentWeapon.weaponType === 'bow';
        const wantCursor = (!currentWeapon || (!isGunWeapon(currentWeapon) && !isBowWeapon)) ? 'default' : 'none';
        document.body.style.cursor = wantCursor;
        if (wantCursor === 'default') {
            if (this._domCursor) this._domCursor.style.display = 'none';
            return;
        }
        const mx = Input.mouse.x;
        const my = Input.mouse.y;
        let spreadFactor = (player._currentSpreadFactor || 0) + (player._crosshairShotKick || 0);
        spreadFactor = Math.min(1, spreadFactor);
        if (!this._crosshairSpread) this._crosshairSpread = 0;
        const crosshairCfg = GAME_CONFIG.crosshair || {};
        const lerpSpeed = crosshairCfg.lerpSpeed || 0.3;
        this._crosshairSpread += (spreadFactor - this._crosshairSpread) * lerpSpeed;
        const spread = this._crosshairSpread;
        const geometry = crosshairCfg.geometry || { baseGap: 4, maxGapExtra: 16, lineLen: 6, lineWidth: 2.5, outlineWidth: 2.5 };
        const baseGap = geometry.baseGap || 4;
        const maxGapExtra = geometry.maxGapExtra || 16;
        const gap = baseGap + spread * maxGapExtra;
        const lineLen = geometry.lineLen || 6;
        const lineWidth = geometry.lineWidth || 2.5;
        const outlineWidth = geometry.outlineWidth || 2.5;
        const colors = crosshairCfg.colors || { outline: '#000000', main: '#00ff00' };
        const centerDot = crosshairCfg.centerDot || { outerRadius: 1.5, innerRadius: 0.8 };

        // DOM 置顶准星（2026-07-30）：NPC对话/商店/改造等 DOM 面板会盖住 Phaser 画布准星
        // （cursor:none 下面板区域鼠标完全不可见——"面板遮盖鼠标"根因）。
        // 用最高 z-index 的 DOM canvas 克隆同一准星几何，保证鼠标始终在所有图层之上；
        // DOM 准星接管后 Phaser 层不再画（gScreen 每帧已 clear，无双准星无残留）
        const dom = this._ensureDomCursor();
        const dctx = this._domCursorCtx;
        dctx.clearRect(0, 0, 64, 64);
        const dcx = 32, dcy = 32;
        const outlineColor = colors.outline || '#000000';
        const mainColor = colors.main || '#00ff00';
        for (const [w, color] of [[lineWidth + outlineWidth, outlineColor], [lineWidth, mainColor]]) {
            dctx.strokeStyle = color;
            dctx.lineWidth = w;
            dctx.beginPath();
            dctx.moveTo(dcx, dcy - gap); dctx.lineTo(dcx, dcy - gap - lineLen);
            dctx.moveTo(dcx, dcy + gap); dctx.lineTo(dcx, dcy + gap + lineLen);
            dctx.moveTo(dcx - gap, dcy); dctx.lineTo(dcx - gap - lineLen, dcy);
            dctx.moveTo(dcx + gap, dcy); dctx.lineTo(dcx + gap + lineLen, dcy);
            dctx.stroke();
        }
        dctx.fillStyle = outlineColor;
        dctx.beginPath(); dctx.arc(dcx, dcy, centerDot.outerRadius || 1.5, 0, Math.PI * 2); dctx.fill();
        dctx.fillStyle = mainColor;
        dctx.beginPath(); dctx.arc(dcx, dcy, centerDot.innerRadius || 0.8, 0, Math.PI * 2); dctx.fill();

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
        dom.style.left = (mx - 32) + 'px';
        dom.style.top = (my - 32) + 'px';
        dom.style.display = 'block';
    }

    /** DOM 置顶准星（最高 z-index 的 64×64 canvas，pointer-events 不拦截） */
    _ensureDomCursor() {
        if (this._domCursor) return this._domCursor;
        const c = document.createElement('canvas');
        c.id = 'gameDomCursor';
        c.width = 64;
        c.height = 64;
        c.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:64px;pointer-events:none;z-index:2147483647;display:none;';
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

    /** 固定 UI（scrollFactor-0，如小地图）在相机 zoom 下的坐标补偿系数：
     *  相机 origin 已固定 (0,0)，屏幕位置 = 绘制坐标 × zoom → 绘制坐标 = 屏幕目标 ÷ zoom。
     *  任意 zoom（0.3/0.7/1…）通用，小地图永远锚定屏幕固定位置（2026-08-15） */
    _minimapInvZoom() {
        return 1 / ((this.cameras.main && this.cameras.main.zoom) || 1);
    }

    _redrawMinimapStatic() {
        const g = this._minimapStaticGraphics;
        if (!g) return;
        g.clear();
        const invZ = this._minimapInvZoom();
        const minimapCfg = GAME_CONFIG.minimap || {};
        const minimapW = minimapCfg.width || 150;
        const minimapH = minimapCfg.height || 150;
        const pad = minimapCfg.padding || 10;
        const offsetY = minimapCfg.offsetY || 50;
        const mx = pad;
        const my = pad + offsetY;
        const worldW = CONFIG.WORLD_WIDTH;
        const worldH = CONFIG.WORLD_HEIGHT;
        const scaleX = minimapW / worldW;
        const scaleY = minimapH / worldH;
        const scale = Math.min(scaleX, scaleY);
        const styles = minimapCfg.styles || {};
        const bg = minimapCfg.background || {};

        // 背景（所有绘制坐标 × 1/zoom，抵消相机缩放对 scrollFactor-0 图形的作用）
        const bgColor = this._parseColor(bg.fill || 'rgba(0,0,0,0.6)', 0x000000, 0.6);
        g.fillStyle(bgColor.color, bgColor.alpha);
        g.fillRect(mx * invZ, my * invZ, minimapW * invZ, minimapH * invZ);
        const borderColor = this._parseColor(bg.border || 'rgba(255,255,255,0.4)', 0xffffff, 0.4);
        g.lineStyle((bg.lineWidth || 1) * invZ, borderColor.color, borderColor.alpha);
        g.strokeRect(mx * invZ, my * invZ, minimapW * invZ, minimapH * invZ);

        // 墙壁
        if (WallSystem && WallSystem.walls) {
            const wallColor = this._parseColor(styles.wall || 'rgba(80,80,80,0.5)', 0x505050, 0.5);
            g.fillStyle(wallColor.color, wallColor.alpha);
            for (const w of WallSystem.walls) {
                const wx = mx + w.x * scale;
                const wy = my + w.y * scale;
                const ww = Math.max(0.5, w.w * scale);
                const wh = Math.max(0.5, w.h * scale);
                g.fillRect(wx * invZ, wy * invZ, ww * invZ, wh * invZ);
            }
        }
    }

    _syncMinimap() {
        const game = window.Game;
        if (!game || !game.player || game._npcDialoguePaused) return;
        // 独立动态层 + 边界检查裁剪（WebGL 不支持 geometry mask，改用绘制前边界判断）
        const g = this._minimapDynamicGraphics;
        if (!g) return;
        g.clear();
        const invZ = this._minimapInvZoom();
        const minimapCfg = GAME_CONFIG.minimap || {};
        const minimapW = minimapCfg.width || 150;
        const minimapH = minimapCfg.height || 150;
        const pad = minimapCfg.padding || 10;
        const offsetY = minimapCfg.offsetY || 50;
        const mx = pad;
        const my = pad + offsetY;
        const worldW = CONFIG.WORLD_WIDTH;
        const worldH = CONFIG.WORLD_HEIGHT;
        const scaleX = minimapW / worldW;
        const scaleY = minimapH / worldH;
        const scale = Math.min(scaleX, scaleY);
        const styles = minimapCfg.styles || {};
        const sizes = minimapCfg.sizes || {};
        // 边界检查：只画小地图框内的内容（替代 WebGL 不支持的 geometry mask）
        const inBox = (x, y) => x >= mx && x <= mx + minimapW && y >= my && y <= my + minimapH;
        const clampX = (x) => Math.max(mx, Math.min(mx + minimapW, x));
        const clampY = (y) => Math.max(my, Math.min(my + minimapH, y));

        // 墙壁数量或世界尺寸变化时才重绘静态层（墙数可能跨场景恰好相同，尺寸必须参与缓存键）
        const wallCount = WallSystem && WallSystem.walls ? WallSystem.walls.length : 0;
        const staticKey = wallCount + ':' + worldW + 'x' + worldH;
        if (staticKey !== this._minimapStaticKey) {
            this._redrawMinimapStatic();
            this._minimapStaticKey = staticKey;
        }

        // 相机视野框（与框求交集，超框部分不画）
        // 相机视野框（与帧求交集，超框部分不画）。
        // 2026-08-14：可视世界范围 = VIEW / 相机 zoom——之前无视缩放，世界-122（zoom 0.7）
        // 的黄色视野框比实际视野小一圈，改按实时 zoom 换算（任意缩放通用）。
        const camZoom = (this.cameras.main && this.cameras.main.zoom) || 1;
        const camX = mx + (Camera.x - CONFIG.VIEW_WIDTH / (2 * camZoom)) * scale;
        const camY = my + (Camera.y - CONFIG.VIEW_HEIGHT / (2 * camZoom)) * scale;
        const viewW = Math.max(1, (CONFIG.VIEW_WIDTH / camZoom) * scale);
        const viewH = Math.max(1, (CONFIG.VIEW_HEIGHT / camZoom) * scale);
        const viewColor = this._parseColor(styles.viewFrame || 'rgba(255,200,0,0.6)', 0xffc800, 0.6);
        const fx1 = Math.max(camX, mx), fy1 = Math.max(camY, my);
        const fx2 = Math.min(camX + viewW, mx + minimapW), fy2 = Math.min(camY + viewH, my + minimapH);
        if (fx2 > fx1 && fy2 > fy1) {
            g.lineStyle(1 * invZ, viewColor.color, viewColor.alpha);
            g.strokeRect(fx1 * invZ, fy1 * invZ, (fx2 - fx1) * invZ, (fy2 - fy1) * invZ);
        }

        // 裂隙
        if (SceneManager.currentScene === 'scene2' && RiftSystem && RiftSystem.rifts) {
            const riftColor = this._parseColor(styles.rift || '#00008B', 0x00008B, 1);
            g.fillStyle(riftColor.color, riftColor.alpha);
            for (const rift of RiftSystem.rifts) {
                if (rift.completed) continue;
                const rx = mx + rift.x * scale;
                const ry = my + rift.y * scale;
                if (inBox(rx, ry)) g.fillCircle(rx * invZ, ry * invZ, (sizes.rift || 2) * invZ);
            }
        }

        // 其它实体
        if (game.entities && typeof game.entities.forEach === 'function') {
            game.entities.forEach(e => {
                if (!e || e === game.player || !e.active) return;
                if (typeof e.x !== 'number' || typeof e.y !== 'number' || isNaN(e.x) || isNaN(e.y)) return;
                const ex = mx + e.x * scale;
                const ey = my + e.y * scale;
                if (!inBox(ex, ey)) return; // 框外实体不画
                if (e.targetScene) {
                    const portalColor = this._parseColor(styles.portal || '#00aaff', 0x00aaff, 1);
                    g.fillStyle(portalColor.color, portalColor.alpha);
                    g.fillCircle(ex * invZ, ey * invZ, (sizes.portal || 2.5) * invZ);
                } else if (e.name === '大块头') {
                    const bossColor = this._parseColor(styles.boss || '#ff0000', 0xff0000, 1);
                    g.fillStyle(bossColor.color, bossColor.alpha);
                    g.fillCircle(ex * invZ, ey * invZ, ((sizes.enemy || 1.5) * 2) * invZ);
                } else if (e._faction === 'enemy' || e._faction === 'agent') { // 入侵特工同敌人红点
                    const enemyColor = this._parseColor(styles.enemy || '#ff4444', 0xff4444, 1);
                    g.fillStyle(enemyColor.color, enemyColor.alpha);
                    g.fillCircle(ex * invZ, ey * invZ, (sizes.enemy || 1.5) * invZ);
                } else if (e.itemData) {
                    const itemColor = this._parseColor(styles.item || '#ffd700', 0xffd700, 1);
                    g.fillStyle(itemColor.color, itemColor.alpha);
                    g.fillCircle(ex * invZ, ey * invZ, (sizes.item || 1) * invZ);
                }
            });
        }

        // 玩家（箭头端点钳制到框内）
        const px = mx + game.player.x * scale;
        const py = my + game.player.y * scale;
        const playerColor = this._parseColor(styles.player || '#00ff00', 0x00ff00, 1);
        if (inBox(px, py)) {
            g.fillStyle(playerColor.color, playerColor.alpha);
            g.fillCircle(px * invZ, py * invZ, (sizes.player || 3) * invZ);
            const dir = game.player.rotation || 0;
            g.lineStyle((sizes.arrowLineWidth || 1.5) * invZ, playerColor.color, playerColor.alpha);
            g.beginPath();
            g.moveTo(px * invZ, py * invZ);
            g.lineTo(clampX(px + Math.cos(dir) * (sizes.arrowLen || 6)) * invZ, clampY(py + Math.sin(dir) * (sizes.arrowLen || 6)) * invZ);
            g.strokePath();
        }

        // 标题
        const title = minimapCfg.title || {};
        this.minimapTitle.setPosition((mx + (title.offsetX || 4)) * invZ, (my + (title.offsetY || -2)) * invZ);
        this.minimapTitle.setScale(invZ, invZ);
        this.minimapTitle.setStyle({ fontSize: '10px', color: title.color || '#d4c5a9cc', fontFamily: 'SimHei, "Microsoft YaHei", sans-serif' });
        this.minimapTitle.setText(title.text || '地图');
        this.minimapTitle.setVisible(true);
    }

    /**
     * 同步无专属 Phaser Sprite 的实体（训练靶、NPC 等）
     */
    _syncNeutralEntities(_game) {
        if (!_game || !_game.entities) return;
        const active = new Set();
        const player = _game.player;
        for (const e of _game.entities.values()) {
            if (!e || e === player) continue;
            if (e._phaserSprite && e._phaserSprite.active) continue;
            if (!e.active) continue;
            // 防御塔由 _syncDefenseTowers 专属渲染（基座/臂/武器三层）
            if (e._skipNeutralSprite) continue;
            // 敌人由 _syncEntityHud 统一绘制名字/血条，避免重复标签
            if (e._faction === 'enemy') continue;
            active.add(e);

            let data = this._neutralSprites.get(e);
            if (!data) {
                // 贴图动画 NPC（config.sprite 配置 idle/walk 动画键）；无配置保持纯色圆
                const sprCfg = (e.spriteCfg && e.spriteCfg.idleKey && this.textures.exists(e.spriteCfg.idleKey))
                    ? e.spriteCfg : null;
                let sprite;
                if (sprCfg) {
                    const sz = sprCfg.size || 128;
                    const szH = sprCfg.sizeH || sz; // 等比非方形显示（防御塔等竖版建筑）
                    sprite = this.add.sprite(e.x, e.y, sprCfg.idleKey);
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
                data = { sprite, label, sprCfg };
                this._neutralSprites.set(e, data);
            }
            const { sprite, label, sprCfg } = data;
              const labelFontSize = (SceneManager && SceneManager.currentScene === 'scene8') ? '14px' : '11px';
              if (label.style && label.style.fontSize !== labelFontSize) {
                  label.setFontSize(labelFontSize);
              }
            const size = e.size || 16;
            const shift = this._getFootOffsetY(e, sprite);
            sprite.setPosition(e.x, e.y - shift);
            if (sprCfg) {
                // 贴图 NPC：行走/待机动画切换 + 朝向翻转，不做染色（静态贴图无动画则跳过）；
                // 倒退行走（移动方向与朝向相反）时循环动画倒放
                const animKey = (e.isMoving && sprCfg.walkKey) ? sprCfg.walkKey : sprCfg.idleKey;
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

            let text = e.name || '';
            let color = '#d4c5a9';
            if (e.npcType) {
                color = '#ffffff';
                if (player) {
                    const dx = e.x - player.x;
                    const dy = e.y - player.y;
                    if (Math.sqrt(dx * dx + dy * dy) <= (e.interactionRange || 200)) {
                        text += '\n左键对话';
                    }
                }
            } else if (e._dpsTracking) {
                color = '#ff6666';
                text = `${e.name}\nDPS: ${e._dpsDisplay?.dps || 0} | 总伤害: ${e._dpsDisplay?.total || 0}`;
            } else if (e.hp !== undefined && e.maxHp !== undefined) {
                text = `${e.name} ${e.hp}/${e.maxHp}`;
            }
            // 名字标签：贴图 NPC 放在贴图顶部，圆形占位保持按 size 偏移
            const labelTop = sprCfg ? sprite.displayHeight / 2 : size;
            const labelGap = e._isEnergyNode ? 12 : 8; // 能源矿放大 50% 后标签同步上移
            label.setPosition(e.x, sprite.y - labelTop - labelGap);
            // 防御建筑（基地核心/防御塔/掩体）：按地面锚线 Y 参与墙体深度排序。
            // 掩体带 _faceDepth（=墙段底边线 max 端点 y + 12，见 DefenseCover），
            // 不能用 e.y+12——e.y 是贴图显示框底边，比接地线深 22~137px，会把墙前
            // 实体错误排到墙后被盖（2026-08-05 实机复现）
            if (e._isDefenseStructure) {
                const dd = (typeof e._faceDepth === 'number') ? e._faceDepth : e.y + 12;
                sprite.setDepth(dd);
                label.setDepth(dd + 1);
            }
            if (label.text !== text) {
                label.setText(text);
            }
            if (label.style?.color !== color) {
                label.setColor(color);
            }
            sprite.setVisible(true);
            label.setVisible(true);
              if (e._isDefenseCover) {
                  // 掩体：隐藏名字/血量文字，残血时只显示 _syncEntityHud 的小血条
                  if (label.text !== '') label.setText('');
                  label.setVisible(false);
              }
        }
        for (const [e, data] of this._neutralSprites.entries()) {
            if (!active.has(e)) {
                data.sprite.destroy();
                data.label.destroy();
                this._neutralSprites.delete(e);
            }
        }
    }

    /**
     * 防御塔三层渲染：基座（静态，已去臂贴图）+ 机械臂（绕塔顶枢轴 360° 旋转）+
     * 挂载武器（跟随臂尖，朝向=塔 aimAngle）。
     * 世界-122 防守塔：臂贴图 `obstacle_defense_tower_arm`，几何见 DEFENSE_TOWER_VISUAL。
     */
    _syncDefenseTowers(_game) {
        if (!_game || !_game.entities) return;
        const V = DEFENSE_TOWER_VISUAL;
        const active = new Set();
        for (const e of _game.entities.values()) {
            if (!e || !e._isDefenseTower || !e.active || e.hp <= 0) continue;
            active.add(e);
            let sp = this._defenseSprites.get(e);
            if (!sp) {
                sp = {
                    base: this.add.sprite(0, 0, 'obstacle_defense_tower'),
                    arm: this.add.sprite(0, 0, 'obstacle_defense_tower_arm_frames'),
                    weapon: this.add.sprite(0, 0, 'weapon_rusty_sword'),
                };
                sp.arm._frameIdx = -1;
                sp.base.setOrigin(0.5, 0.5);
                sp.arm.setOrigin(0.5, 0.5);
                sp.weapon.setOrigin(0.5, 0.5);
                this._defenseSprites.set(e, sp);
            }
            // 基座
            sp.base.setPosition(e.x, e.y - V.base.footOffsetY);
            sp.base.setDisplaySize(V.base.w, V.base.h);
            sp.base.setFlipX(!!e._mirrored);
            // 深度锚点=塔脚底 e.y（实体同口径）；+2 仅保证同锚点确定排序。
            // 前/后遮挡：怪物脚底 y < e.y → 塔盖怪物；y > e.y → 怪物盖塔（2026-08-14）
            sp.base.setDepth(e.y + 2);
            sp.base.setVisible(true);
            // 机械臂：预渲染 3D 旋转帧（48 帧），按 aimAngle 选最近帧；
            // 枢轴=帧内固定像素（相机固定 + 模型绕塔顶轴旋转），origin 设枢轴。
            const pivotX = e.x;
            const pivotY = e.y - V.arm.pivotWorldY;
            const m = e._mirrored ? -1 : 1;
            // 世界旋转 = -aimAngle（游戏 y 向下，屏幕顺时针=世界逆时针的镜像）；
            // 镜像塔再取反并 flipX 帧
            const theta = e._mirrored ? e.aimAngle : -e.aimAngle;
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
            sp.arm.setDisplaySize(V.arm.w, V.arm.h);
            sp.arm.setRotation(0);
            sp.arm.setFlipX(!!e._mirrored);
            sp.arm.setDepth(e.y + 2.5);
            sp.arm.setVisible(true);
            // 挂载武器：臂尖 = 椭圆路径（等距投影 x 全量、y 0.5 缩短），
            // 朝向 = 臂尖方向角；朝左 flipY 防倒置。
            const item = e.weaponItem;
            if (item) {
                let tex = getWeaponTextureKey(item);
                if (!this.textures.exists(tex)) tex = 'weapon_rusty_sword';
                const gs = V.arm.gameScale;
                const tipOX = gs * V.arm.k * V.arm.reach * Math.cos(e.aimAngle) * m;
                const tipOY = gs * V.arm.k * (0.5 * V.arm.reach * Math.sin(e.aimAngle) - 0.866 * V.arm.dz);
                const tipX = pivotX + tipOX;
                const tipY = pivotY + tipOY;
                let wAng = Math.atan2(0.5 * V.arm.reach * Math.sin(e.aimAngle) - 0.866 * V.arm.dz, V.arm.reach * Math.cos(e.aimAngle));
                if (e._mirrored) wAng = Math.PI - wAng;
                const flipY = Math.abs(wAng) > Math.PI / 2;
                // 枪管模式（"枪插进机械臂"假象，2026-08-14）：用预裁剪的枪管独立贴图，
                // 切口端（origin x=0）对齐臂尖并内嵌，枪管从机械臂/钩子里伸出。
                const barrelCfg = V.weapon.barrel && (V.weapon.barrel[item.weaponId] || V.weapon.barrel[item.weaponType]);
                if (barrelCfg) {
                    const barrelTex = `tower_barrel_${item.weaponId}`;
                    if (sp.weapon.texture.key !== barrelTex) sp.weapon.setTexture(barrelTex);
                    sp.weapon.setOrigin(0, 0.5);
                    const rootInset = barrelCfg.inset ?? 7;
                    sp.weapon.setPosition(tipX - Math.cos(wAng) * rootInset, tipY - Math.sin(wAng) * rootInset);
                    sp.weapon.setRotation(wAng);
                    sp.weapon.setFlipX(false);
                    sp.weapon.setFlipY(flipY);
                    sp.weapon.setScale(barrelCfg.height / barrelCfg.h);
                } else {
                    if (sp.weapon.texture.key !== tex) sp.weapon.setTexture(tex);
                    sp.weapon.setOrigin(0.5, 0.5);
                    const wH = V.weapon.heights[item.weaponType] || V.weapon.defaultHeight;
                    sp.weapon.setPosition(tipX + Math.cos(wAng) * 8, tipY + Math.sin(wAng) * 8);
                    sp.weapon.setRotation(wAng);
                    sp.weapon.setFlipX(false);
                    sp.weapon.setFlipY(flipY);
                    sp.weapon.setScale(wH / Math.max(1, sp.weapon.height));
                }
                sp.weapon.setDepth(e.y + 3);
                sp.weapon.setVisible(true);
            } else {
                sp.weapon.setVisible(false);
            }
            // 悬停金色轮廓（2026-08-15）：DefenseSystem.updateHover 每帧更新 _hoverTower，
            // 基座/机械臂/武器三层贴图同加同去金色外发光（敌人攻击预警同款 filters.internal.addGlow）
            this._setTowerHoverGlow(sp, DefenseSystem._hoverTower === e);
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

    /** 防御塔悬停金色轮廓：三层贴图（基座/臂/武器）同加同去金色外发光（2026-08-15）。
     *  滤镜链路与敌人攻击预警同口径（filters.internal.addGlow）；Canvas 渲染降级无滤镜静默跳过。 */
    _setTowerHoverGlow(sp, on) {
        for (const key of ['base', 'arm', 'weapon']) {
            const sprite = sp[key];
            if (!sprite || !sprite.active) continue;
            if (on) {
                if (sprite.__hoverGlowFx) continue;
                let filters = sprite.filters;
                if (!filters && typeof sprite.enableFilters === 'function') {
                    try { sprite.enableFilters(); } catch (_e) { /* 滤镜不可用降级 */ }
                    filters = sprite.filters;
                }
                if (!filters || !filters.internal) continue;
                try {
                    sprite.__hoverGlowFx = filters.internal.addGlow(0xffd700, 2, 0, 1, false, 0.15, 10);
                } catch (_e) { sprite.__hoverGlowFx = null; }
            } else if (sprite.__hoverGlowFx) {
                try {
                    if (sprite.filters && sprite.filters.internal) sprite.filters.internal.remove(sprite.__hoverGlowFx);
                } catch (_e) { /* 精灵已销毁 */ }
                sprite.__hoverGlowFx = null;
            }
        }
    }

    /**
     * 公共入口：由 scene-manager / combat-room-system 在场景/战斗房切换后调用，
     * 避免每帧检查地形纹理。
     */
    syncTerrain() {
        this._syncTerrain();
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
            this._terrainSprite.setDepth(-1000);
        } else {
            this._terrainSprite.setTexture('terrain');
            this._terrainSprite.setPosition(w / 2, h / 2);
        }
    }

    /**
     * 在地形 Texture 上烘焙网格与世界边界
     */
    _drawGridAndBorder(g, w, h) {
        const currentScene = SceneManager.currentScene;
        // 网格
        if (currentScene !== 'scene3' && currentScene !== 'scene2') {
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
        }
        // 边界：地牢与世界-122 不画描边（122 边界自然显示为地板渐变边缘，2026-08-14）
        if (currentScene !== 'scene7' && currentScene !== 'scene8') {
            const borderCfg = GAME_CONFIG.worldBorder || {};
            g.lineStyle(borderCfg.lineWidth || 4, 0x8a4a4a, 1);
            g.strokeRect(0, 0, w, h);
        }
    }

    /**
     * 为敌人创建或获取 Phaser Sprite
     */
    getOrCreateEnemySprite(enemy, texture = 'enemy_circle') {
        const safeTexture = this.textures.exists(texture) ? texture : 'enemy_circle';
        if (!enemy._phaserSprite || !enemy._phaserSprite.active) {
            const sprite = this.physics.add.sprite(enemy.x, enemy.y, safeTexture);
            sprite.setOrigin(0.5, 0.5);
            sprite.setData('enemyId', enemy.id || enemy.name);
            this._configureEnemyBody(sprite, enemy);
            this.enemies.add(sprite);
            enemy._phaserSprite = sprite;
        } else if (enemy._phaserSprite.texture.key !== safeTexture) {
            // 纹理变化时切换（如黑狼左右/上下精灵图切换）
            enemy._phaserSprite.setTexture(safeTexture);
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
        const options = (typeof enemy._getPhaserOptions === 'function') ? enemy._getPhaserOptions() : {};
        // 同步纹理键（动画状态变化时需要切到对应 spritesheet/image）
        const wanted = (typeof enemy._getTextureKey === 'function') ? enemy._getTextureKey() : 'enemy_circle';
        let safeTexture = this.textures.exists(wanted) ? wanted : 'enemy_circle';
        if (safeTexture === 'enemy_circle' && this.anims.exists(wanted)) {
            // 防御（2026-08-15 铠甲骑士教训）：_getTextureKey 返回了纯动画键（无同名贴图）时，
            // 不要回退 enemy_circle 白胶囊占位——取该动画首帧所在贴图继续渲染，
            // 等后续动画同步切到正确帧（骑士冲锋循环段贴图"丢失"的根因）
            const anim = this.anims.get(wanted);
            const firstFrame = anim && anim.frames && anim.frames[0];
            if (firstFrame && firstFrame.textureKey && this.textures.exists(firstFrame.textureKey)) {
                safeTexture = firstFrame.textureKey;
            }
        }
        if (sprite.texture.key !== safeTexture) {
            sprite.setTexture(safeTexture);
            // 纹理切换后按当前帧尺寸重算显示大小：
            // 旧 250×215 贴图（黑狼 pacing/attack）与新 512² 贴图混用时，
            // 创建时一次性计算的 displaySize 会压扁/缩小（2026-08-06 黑狼 idle 小图根因）
            const size = options.spriteSize || 151;
            const fw = (sprite.frame && sprite.frame.width) || 1;
            const fh = (sprite.frame && sprite.frame.height) || 1;
            const longest = Math.max(fw, fh);
            sprite.setDisplaySize(fw * size / longest, fh * size / longest);
        }
        if (options.flipX !== undefined) {
            sprite.setFlipX(options.flipX);
        }
        if (options.frame !== undefined) {
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
        const animState = options.animState;
        if (!animState) return;
        let animKey = options.animKey || ('zombie_dog_' + animState);
        if (animState === 'summon' && options.summonReverse) {
            animKey = 'enemy_zombie_wizard_summon_reverse';
        }
        if (!this.anims.exists(animKey)) {
            // 没有对应动画时保持当前静态帧，不要强制 stop，避免冻结在动画最后一帧
            return;
        }
        const current = sprite.anims.currentAnim;
        // [FIX] 增加 isPlaying 检查：动画意外停止时自动重新播放
        // 攻击/死亡动画是一次性的，播完后停在最后一帧即可，不要重新播放
        // charge（骑士冲锋）同为一次性：行为时长远超动画时长，循环重播会产生"停顿重启"观感
        const isLoopAnim = animState !== 'attack' && animState !== 'death' && animState !== 'charge';
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
