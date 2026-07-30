
import { Game } from '../../game.js';
import { SceneManager } from '../../world/scene-manager.js';


// ============================================================
// GameScene - 主游戏场景：替代原有的 renderer.js + game.js 渲染部分
// ============================================================
import { Scene } from 'phaser';
import { WallSystem } from '../../world/wall-system.js';
import { WallGate } from '../../world/wall-gate.js';
import { ChestRoomSystem } from '../../world/chest-room-system.js';
import { Renderer } from '../../world/renderer.js';
import { MapGenerator } from '../../world/map-generator.js';
import { WeaponTransform } from '../../combat/weapon-transform.js';
import { getWeaponTextureKey } from '../../config/weapon-texture-map.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { Easing, WEAPON_ANIM } from '../../config/math-utils.js';
import { CONFIG } from '../../config/config.js';
import { GAME_CONFIG } from '../../config/game-config.js';
import { getSpriteFrameOffset } from '../../utils/sprite-offsets.js';
import { PLAYER_DEFAULTS } from '../../config/player-defaults.js';
import { playerTextureKey, getPlayerAnimDef, getPlayerAnimDurationMs } from '../../config/player-anim.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { getTorsoRect } from '../../physics/torso-hitbox.js';

import { DungeonMapSystem } from '../../world/dungeon-map-system.js';
import { Camera } from '../../world/camera.js';
import { Input } from '../../ui/input.js';
import { RiftSystem } from '../../quest/rift-system.js';
import { isGunWeapon, isTwoHanded } from '../../config/gun-ammo.js';
import { findWeaponConfig } from '../../ui/equip-data-manager.js';
import { ExpeditionSystem } from '../../ui/expedition-system.js';

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

        // 可移动实体脚底阴影：按 groundRadius 绘制黑色圆影
        this._shadowSprites = new Map();
        this._ensureShadowTexture();

        // 小地图静态层（背景/边界/墙壁），只在墙壁变化时重绘
        this._minimapStaticGraphics = this.add.graphics();
        this._minimapStaticGraphics.setDepth(99999);
        this._minimapStaticGraphics.setScrollFactor(0);
        this._minimapStaticWallsCount = -1;
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
        this._xrayEnabled = false;

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
            // 恢复并同步 HUD
            if (this.worldHudGraphics) this.worldHudGraphics.setVisible(true);
            if (this.screenHudGraphics) this.screenHudGraphics.setVisible(true);
            if (this._minimapStaticGraphics) this._minimapStaticGraphics.setVisible(true);
            if (this._minimapDynamicGraphics) this._minimapDynamicGraphics.setVisible(true);
            if (this.minimapTitle) this.minimapTitle.setVisible(true);
            this._syncHud(_game);
            this._updateBossHpBar(_delta);
            this._syncHitFlashAndCharge(_game);
            this._syncNeutralEntities(_game);
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
        // 同步可移动实体脚底阴影
        this._syncEntityShadows(_game);
        // 同步眩晕双星特效（眩晕持续时间内播放，结束消失）
        this._syncStunEffects(_game);
        // 同步激励 buff 白色环绕光晕（持续时间内跟随目标，结束消失）
        this._syncInspireEffects(_game);
        // 调试范围圈与阴影使用同一脚底坐标，避免错位
        this._syncCollisionRadii(_game);
        // Phase 4: 根据世界 Y 坐标统一动态实体深度
        this._updateDynamicDepths();
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
            if (entity._faction === 'enemy' && (!entity._phaserSprite || !entity._phaserSprite.active)) {
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
            if (entity._faction === 'enemy') {
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
        if (this.playerSprite && this.playerSprite.active) {
            const footOffsetY = this._getFootOffsetY(Game.player, this.playerSprite);
            // 衔接处遮挡仲裁（斜墙 flat 深度在衔接处的几何误差修正）
            const pd = WallSystem.junctionCorrectedDepth(Game.player.x, Game.player.y, this.playerSprite.y + footOffsetY + 10);
            this.playerSprite.setDepth(pd);
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
                // 衔接处遮挡仲裁（与玩家同口径）
                const d = WallSystem.junctionCorrectedDepth(e.x, e.y, sprite.y + footOffsetY + (isCorpse ? 2 : 10));
                sprite.setDepth(d);
            });
        }

        // 3. 玩家手持武器 / 盾牌跟随玩家深度，保持相对层级
        const playerDepth = (this.playerSprite && this.playerSprite.active) ? this.playerSprite.depth : 0;
        if (this.weaponSprite && this.weaponSprite.active) {
            this.weaponSprite.setDepth(playerDepth + 2);
        }
        if (this.offhandWeaponSprite && this.offhandWeaponSprite.active) {
            this.offhandWeaponSprite.setDepth(playerDepth + 1);
        }
        if (this.shieldSprite && this.shieldSprite.active) {
            this.shieldSprite.setDepth(playerDepth + 1);
        }

        // 4. 防御光环位于玩家下方
        if (this.defenseGlow && this.defenseGlow.active) {
            this.defenseGlow.setDepth(playerDepth - 2);
        }

        // 5. 魔法/技能特效按自身世界 Y 排序
        [...this.runeSwordGroup.getChildren(), ...this.iceSpikeGroup.getChildren()].forEach(s => {
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
            for (const sprites of this._magicSprites.values()) {
                if (sprites.iceSpikes) {
                    sprites.iceSpikes.forEach(s => { if (s && s.active) s.setDepth(s.y + 15); });
                }
                if (sprites.iceSpikeFly) {
                    sprites.iceSpikeFly.forEach(s => { if (s && s.active) s.setDepth(s.y + 15); });
                }
                if (sprites.fireball && sprites.fireball.active) {
                    sprites.fireball.setDepth(sprites.fireball.y + 15);
                }
                if (sprites.fireballFly && sprites.fireballFly.active) {
                    sprites.fireballFly.setDepth(sprites.fireballFly.y + 15);
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
                const depth = data.sprite.y + footOffsetY + 10;
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
            const depth = e.y + 9; // 比实体本身低 1
            const cx = e.collider ? e.collider.x : e.x;
            const cy = e.collider ? e.collider.y : e.y;
            ensureShadow(e, cx, cy, e.groundRadius || 10, depth, !isMapMode);
        }

        // 敌人
        if (_game.entities) {
            _game.entities.forEach(e => {
                if (!e || !e.active || e === _game.player) return;
                if (e._faction !== 'enemy') return;
                if (e._noShadow) return; // 配置跳过阴影（如矿洞，贴图自带底座）
                const sprite = e._phaserSprite;
                if (!sprite || !sprite.active) return;
                active.add(e);
                const depth = e.y + 9;
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
        // 透视效果已全局停用（开关见 create；代码保留，_xrayEnabled=true 恢复）
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

        if (_game.player && this.playerSprite && this.playerSprite.active) {
            check(_game.player, this.playerSprite);
        }
        if (_game.entities) {
            _game.entities.forEach(e => {
                if (!e || e === _game.player || !e.active) return;
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
        this.cameras.main.scrollX = Camera.x - viewW / 2;
        this.cameras.main.scrollY = Camera.y - viewH / 2;
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

        // 根据朝向翻转（侧视精灵图默认朝右）——与武器/锚点同一中轴滞回判定（_getVisualFacingRight），
        // 禁用 _facingDir 四方向制（45° 边界），否则 45°~87° 区间身体与武器朝向相反
        const player = window.Game && window.Game.player;
        if (player) {
            this.playerSprite.setFlipX(!this._getVisualFacingRight(player));
        }

        const def = getPlayerAnimDef(key);
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
            if (currentAnim === texKey && this.playerSprite.anims.isPlaying) return;
            // 贴图与动画必须同源（扭转腿层/单帧姿态切换后 texture 可能不匹配，不重置会卡第一帧）
            if (this.playerSprite.texture.key !== texKey) {
                this.playerSprite.setTexture(texKey);
            }
            this.playerSprite.play(texKey, true);
            const animDef = this.anims.get(texKey);
            // naturalMs 同样按逐帧时长求和优先（否则 frameDurations 系动画 timeScale 算错，
            // 贴图与 Tween 时长再次脱节）
            const naturalMs = getPlayerAnimDurationMs(key) || (animDef && animDef.duration);
            this.playerSprite.anims.timeScale = (targetDurationMs > 0 && naturalMs > 0)
                ? naturalMs / targetDurationMs
                : 1;
            this._playerAttackDuration = targetDurationMs > 0 ? targetDurationMs : naturalMs;
            this._playerAttackStartTime = performance.now();
            const completeHandler = () => {
                this._playerAnimCompleteHandler = null;
                this.playerSprite.anims.timeScale = 1;
                // 连段定格保持：攻击动画播完处于保持窗口时停在末帧，不回 idle
                //（_updatePlayerAnimation 的保持逻辑接管：窗口内接二段 / 超时播 recover）
                const p = window.Game && window.Game.player;
                // 收势动画播完：解除收势标记（原 _updatePlayerAnimation 里的独立 once 会残留，已并入此处）
                if (p && (key === 'recover' || key === 'dash_recover')) {
                    p._attackRecovering = false;
                    p._recoverCfgKey = null; // 冲刺恢复轨迹块标记一并清除
                }
                // 冲刺期间/冲刺末帧定格期：不切 idle——dash_attack 播完也应停在末帧等恢复动画，
                // 否则定格窗口里贴图被换回 idle（"最后一帧用的是 idle 贴图"的根因）
                if (p && (p._isDashing || p._dashRecoverAt)) return;
                if (p && p._attackHoldUntil && performance.now() < p._attackHoldUntil
                    && (key === 'attack_sword' || key === 'attack_sword_2')) {
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
        // currentAnim 相同但已停止（单帧 idle 切换会 anims.stop() 但不清 currentAnim 引用）也必须重播——
        // 否则"走路→停下→再走"时 walk 永远不重启（NPC 对话后走路失效根因）
        if (currentAnim !== texKey || !this.playerSprite.anims.isPlaying) {
            // 贴图与动画必须同源（同上）
            if (this.playerSprite.texture.key !== texKey) {
                this.playerSprite.setTexture(texKey);
            }
            this.playerSprite.play(texKey, true);
        }
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
            const now = performance.now();
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
            const now2 = performance.now();
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
        this._aimSmoothLastT = performance.now();
        this._effectiveAim = aim;
        let facingRight = this._twistState ? this._twistState.facingRight : true;
        if (Math.cos(aim) > 0.05) facingRight = true;
        else if (Math.cos(aim) < -0.05) facingRight = false;
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
        if (player._isDead) return;

        // 攻击/特殊动画期间不覆盖
        const weaponAnim = player.weaponAnim || {};
        const currentItem = player.equipments[player.weaponMode];
        const isMeleeWeapon = currentItem && (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword');
        const currentAnimKey = this.playerSprite.anims.currentAnim?.key;
        // 仅对近战武器做安全防护：逻辑层标记为攻击中，但剑攻击动画已停止，说明状态卡住，强制恢复
        const isPlayingAttackAnim = isMeleeWeapon && (currentAnimKey === playerTextureKey('attack_sword') || currentAnimKey === playerTextureKey('attack_sword_2')) && this.playerSprite.anims.isPlaying;
        if (isMeleeWeapon && weaponAnim.isAttacking && !isPlayingAttackAnim) {
            weaponAnim.isAttacking = false;
            weaponAnim.state = 'idle';
        }
        // 枪械放行：枪开火时 weaponAnim.state='attacking'，但枪的攻击动画在武器贴图层，
        // playerSprite 只承载腿/躯干层——此处 early-return 会冻结腿层（冲刺开火时 runlegs 切不回 walklegs）。
        // 近战保留守卫（attack_sword 动画在 playerSprite 上，不能被覆盖）
        const _isGunPose = currentItem && isGunWeapon(currentItem);
        if (!_isGunPose && (weaponAnim.isAttacking || (weaponAnim.state && weaponAnim.state !== 'idle'))) return;
        // 闪避翻滚动画播放期间不被移动状态机覆盖（结束/被打断后由下方正常逻辑接管）
        if (player.isDodging) return;
        if (player._isWhirlwind || player._isDashing || player._specialAttackActive) return;

        // 冲刺攻击末帧定格：dash 结束后 0.5s 内保持定格（不切 idle），到点播恢复动画（0.5s）
        if (player._dashRecoverAt) {
            if (performance.now() < player._dashRecoverAt) {
                // 定格贴图 = dash_recover 首帧（2026-07-29 起；原定格=dash_attack 末帧）
                // 纹理键必须走 playerTextureKey（player_<动画键>），裸键不存在会渲染成空白
                const freezeTex = playerTextureKey('dash_recover');
                if (this.playerSprite.texture.key !== freezeTex || Number(this.playerSprite.frame.name) !== 0) {
                    this.playerSprite.anims.stop();
                    this.playerSprite.setTexture(freezeTex, 0);
                }
                return;
            }
            player._dashRecoverAt = 0;
            player._attackRecovering = true;
            player._attackRecoverStart = performance.now(); // 武器滑回时间基准（走近战同款末帧滑回，轨迹块=dash）
            player._recoverCfgKey = 'dash';
            this.setPlayerAnimation('dash_recover', 500);
            return;
        }

        // 攻击后定格保持（连段窗口）与收势动画：
        // 一段/二段攻击 Tween 结束后定格在末帧等待连段；窗口内无攻击输入则播 recover 收势回 idle；
        // 移动立即取消定格/收势（新攻击由上方攻击守卫接管，不会走到这里）
        if (player._attackHoldUntil || player._attackRecovering) {
            const now = performance.now();
            if (player.isMoving) {
                player._attackHoldUntil = 0;
                player._attackRecovering = false;
            } else if (player._attackRecovering) {
                return; // 收势播放中，等 animationcomplete 解除
            } else if (now < player._attackHoldUntil) {
                return; // 定格末帧（repeat 0 的攻击动画播完自然停在末帧，不做任何切换）
            } else {
                player._attackHoldUntil = 0;
                if (getPlayerAnimDef('recover') && this.anims.exists(playerTextureKey('recover'))) {
                    player._attackRecovering = true;
                    player._attackRecoverStart = now; // 收势起点（武器线性滑回 idle 位的时间基准）
                    // recover 播完回 idle、解除收势标记均由 setPlayerAnimation 的完成回调统一处理
                    this.setPlayerAnimation('recover');
                    return;
                }
            }
        }

        // 持枪姿态解析：双持手枪（副手为手枪）→ gun_idle_dual；单持手枪 → gun_idle_pistol；
        // 其余枪械 → gun_idle；配置缺失逐级回退
        const _resolveGunPose = () => {
            if (!currentItem || !isGunWeapon(currentItem)) return null;
            const offhandSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
            const offhandItem = player.equipments[offhandSlot];
            const isDualPistol = offhandItem && offhandItem.name
                && (offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol');
            const isPistolMain = currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol';
            if (isDualPistol) {
                const dualDef = getPlayerAnimDef('gun_idle_dual');
                if (dualDef) return { poseKey: 'gun_idle_dual', def: dualDef };
            }
            if (isPistolMain) {
                const pistolDef = getPlayerAnimDef('gun_idle_pistol');
                if (pistolDef) return { poseKey: 'gun_idle_pistol', def: pistolDef };
            }
            const def = getPlayerAnimDef('gun_idle');
            return def ? { poseKey: 'gun_idle', def } : null;
        };
        const gunPose = _resolveGunPose();

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
        const now = performance.now();
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
        
        // ===== Phaser Tween 攻击动画期间，跳过 syncWeapon 的位置更新 =====
        // 但远程武器使用状态机驱动，需要继续执行以应用后坐力
        // inAttackHold：攻击后定格保持窗口（连段等待）——武器定格在上一段轨迹末帧
        const inAttackHold = !!(player._attackHoldUntil && performance.now() < player._attackHoldUntil && !player.isMoving);
        if (weaponAnim.isAttacking || inAttackHold) {
            const isGun = ['pistol', 'deagle', 'p4040', 'beretta93r', 'akm', 'pkm', 'qbz191', 'qjb201', 'energy_lmg', 'shotgun'].includes(wt);
            if (!isGun) {
                // 近战武器：优先使用逐帧配置，按玩家攻击动画当前帧同步武器
                // 连段二段读 attack2 轨迹块（缺失回退 attack）
                const wacWt = WeaponAnimConfig[wt];
                const atkCfgKey = (player._meleeComboStage === 2 && wacWt && wacWt.attack2) ? 'attack2' : 'attack';
                const perFrameCfg = wacWt && wacWt[atkCfgKey];
                if (perFrameCfg && perFrameCfg.type === 'perFrame' && perFrameCfg.frames) {
                    this.weaponSprite.setVisible(!this._useCanvasWeapon);
                    let progress = 1; // 定格保持窗口恒为末帧
                    if (weaponAnim.isAttacking) {
                        progress = 0;
                        if (this._playerAttackStartTime && this._playerAttackDuration > 0) {
                            progress = Math.min(1, (performance.now() - this._playerAttackStartTime) / this._playerAttackDuration);
                        } else {
                            const currentAnim = this.playerSprite.anims.currentAnim;
                            if (currentAnim && (currentAnim.key === playerTextureKey('attack_sword') || currentAnim.key === playerTextureKey('attack_sword_2')) && this.playerSprite.anims.getProgress) {
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
                        // A 方案（残影实现）：帧级运动模糊——blurX/blurY 驱动沿轨迹的历史姿态残影
                        // （高斯滤镜对细长武器是"摊薄消失"，实测峰值帧剑身近乎不可见，已废弃）
                        const bx = pfPos.blurX || 0, by = pfPos.blurY || 0;
                        this._syncWeaponGhosts(player, wt, progress, atkCfgKey, facingRight, Math.max(bx, by));
                        // 二段攻击 18~24 帧：角色贴图在上层、武器贴图沉到人物之下（随进度逐帧判定）
                        const fi = Math.round(progress * (perFrameCfg.frames.length - 1));
                        const weaponUnder = atkCfgKey === 'attack2' && fi >= 18 && fi <= 24;
                        this.weaponSprite.setDepth(this.playerSprite.depth + (weaponUnder ? -0.01 : 2));
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
            const isGunR = ['pistol', 'deagle', 'p4040', 'akm', 'pkm', 'qbz191', 'qjb201', 'energy_lmg', 'shotgun'].includes(wt);
            if (!isGunR) {
                const facingR = !this.playerSprite.flipX; // 朝向硬绑定：收势滑行同身体 flipX（收势期身体冻结）
                const recDur = getPlayerAnimDurationMs('recover') || 800;
                const t = Math.max(0, Math.min(1, (performance.now() - player._attackRecoverStart) / recDur));
                // 起点：上一段轨迹末帧（progress=1，与攻击分支同口径：恒按朝右取帧后手动镜像）
                // _recoverCfgKey='dash' 时从冲刺轨迹末帧滑回（冲刺恢复），朝向同身体 flipX 冻结不随鼠标
                const wacR = WeaponAnimConfig[wt];
                const atkKeyR = player._recoverCfgKey
                    || ((player._meleeComboStage === 2 && wacR && wacR.attack2) ? 'attack2' : 'attack');
                const start = WeaponTransform.getInterpolatedPerFramePosition(player, wt, 1, true, atkKeyR);
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

        const pos = WeaponTransform.getWeaponWorldPosition(player, wt, false, false, animState, {}, isMelee ? !this.playerSprite.flipX : this._getVisualFacingRight(player));
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
        const isGun = ['pistol', 'deagle', 'p4040', 'beretta93r', 'akm', 'pkm', 'qbz191', 'qjb201', 'energy_lmg', 'shotgun'].includes(wt);
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
                         ['pistol', 'pkm', 'akm', 'qbz191', 'qjb201', 'shotgun', 'bow', 'sword'].includes(offhandItem.weaponType);
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
        const isGunOff = ['pistol', 'deagle', 'p4040', 'beretta93r', 'akm', 'pkm', 'qbz191', 'qjb201', 'energy_lmg', 'shotgun'].includes(wt);
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
                sprite.setPosition(sword.flyX, sword.flyY);
                sprite.setRotation(sword.flyAngle + Math.PI / 2);
                sprite.setAlpha(1);
                sprite.setVisible(true);
                return;
            }
            
            const s = player.size;
            const baseX = -s * 0.3 - 50;
            const baseY = sword.offsetX;
            const swayX = Math.sin(sword.swayTimer * sword.swayFreqX) * sword.swayAmpX;
            const swayY = Math.cos(sword.swayTimer * sword.swayFreqY) * sword.swayAmpY;
            
            const localX = baseX + swayX;
            const localY = baseY + swayY;
            
            const cos = Math.cos(player.rotation);
            const sin = Math.sin(player.rotation);
            const baseWorldX = player.x + cos * localX - sin * localY;
            const baseWorldY = player.y + sin * localX + cos * localY;
            
            // 计算朝向鼠标的角度（使用 Phaser 相机坐标，避免 window.Camera 偏移错误）
            const camera = this.cameras.main;
            const mouseX = camera.scrollX + (Input.mouse?.x || 0);
            const mouseY = camera.scrollY + (Input.mouse?.y || 0);
            const absoluteAngle = Math.atan2(mouseY - baseWorldY, mouseX - baseWorldX);
            
            // 应用旋转后的偏移（对应 Canvas 的 ctx.translate(0, -s * 0.85)）
            const worldX = baseWorldX + Math.cos(absoluteAngle) * s * 0.85;
            const worldY = baseWorldY + Math.sin(absoluteAngle) * s * 0.85;
            
            sprite.setPosition(worldX, worldY);
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
            const hasFire = entity._fireballActive || (entity._fireball && entity._fireball.active);
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
                fireballFly: null
            });
        }
        return this._magicSprites.get(caster);
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

            const swayX = Math.sin(spike.swayTimer * spike.swayFreqX) * spike.swayAmpX;
            const swayY = Math.cos(spike.swayTimer * spike.swayFreqY) * spike.swayAmpY;

            const localX = spike.offsetX + swayX;
            const localY = spike.offsetY + swayY;

            const cos = Math.cos(caster.rotation || 0);
            const sin = Math.sin(caster.rotation || 0);
            const worldX = caster.x + cos * localX - sin * localY;
            const worldY = caster.y + sin * localX + cos * localY;

            // 玩家通过鼠标瞄准；敌人自动瞄准 caster.target
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
            sprite.setRotation(absoluteAngle + Math.PI / 2);
            sprite.setAlpha(0.85);
            sprite.setVisible(true);
        });
    }

    /**
     * Phase 3: 同步火球到 Phaser Sprite
     */
    _syncFireball(caster) {
        const sprites = this._getMagicSprites(caster);
        if (!caster._fireballActive || !caster._fireball || caster._fireball.launched) {
            if (sprites.fireball) sprites.fireball.setVisible(false);
            return;
        }

        const fb = caster._fireball;

        if (!sprites.fireball) {
            sprites.fireball = this.add.sprite(0, 0, 'fireball');
        }

        const swayX = Math.sin(fb.swayTimer * fb.swayFreqX) * fb.swayAmpX;
        const swayY = Math.cos(fb.swayTimer * fb.swayFreqX) * fb.swayAmpX * 0.5;

        const localX = fb.offsetX + swayX;
        const localY = fb.offsetY + swayY;

        const cos = Math.cos(caster.rotation || 0);
        const sin = Math.sin(caster.rotation || 0);
        const worldX = caster.x + cos * localX - sin * localY;
        const worldY = caster.y + sin * localX + cos * localY;

        // 玩家通过鼠标瞄准；敌人自动瞄准 caster.target
        let absoluteAngle;
        if (caster === Game.player) {
            const camera = this.cameras.main;
            const mouseX = camera.scrollX + ((Input.mouse?.x) || 0);
            const mouseY = camera.scrollY + ((Input.mouse?.y) || 0);
            absoluteAngle = Math.atan2(mouseY - caster.y, mouseX - caster.x);
        } else {
            const target = caster.target;
            if (target && target.active) {
                absoluteAngle = Math.atan2(target.y - caster.y, target.x - caster.x);
            } else {
                absoluteAngle = caster.rotation || 0;
            }
        }

        sprites.fireball.setPosition(worldX, worldY);
        sprites.fireball.setRotation(absoluteAngle + Math.PI / 2);
        sprites.fireball.setAlpha(0.9);
        sprites.fireball.setDisplaySize(50 * (fb.scale || 1), 50 * (fb.scale || 1));

        // 如果 fireball 是 spritesheet，设置当前帧
        if (fb.frameIndex !== undefined) {
            try {
                sprites.fireball.setFrame(fb.frameIndex);
            } catch (_e) {
                // 不是 spritesheet 或帧不存在，忽略
            }
        }

        sprites.fireball.setVisible(true);
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
                sprite.setPosition(spike.flyX, spike.flyY);
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
        const sprites = this._getMagicSprites(caster);
        if (!caster._fireball || !caster._fireball.flyActive) {
            if (sprites.fireballFly) sprites.fireballFly.setVisible(false);
            return;
        }

        const fb = caster._fireball;

        if (!sprites.fireballFly) {
            sprites.fireballFly = this.add.sprite(0, 0, 'fireball');
        }

        sprites.fireballFly.setPosition(fb.flyX, fb.flyY);
        sprites.fireballFly.setRotation(fb.flyAngle + Math.PI / 2);
        sprites.fireballFly.setAlpha(0.9);
        sprites.fireballFly.setDisplaySize(50 * (fb.scale || 1), 50 * (fb.scale || 1));

        if (fb.frameIndex !== undefined) {
            try {
                sprites.fireballFly.setFrame(fb.frameIndex);
            } catch (_e) {
                // 帧索引可能无效，忽略
            }
        }

        sprites.fireballFly.setVisible(true);
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
                // 帧级运动模糊（残影实现，与攻击分支同管线）
                const bx = pfPos.blurX || 0, by = pfPos.blurY || 0;
                this._syncWeaponGhosts(player, wt, progress, 'dash', facingRight, Math.max(bx, by));
                this.weaponSprite.setVisible(!this._useCanvasWeapon);
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
            const elapsed = Date.now() - player._dashResetAnim.startTime;
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
            const elapsed = Date.now() - player._specialResetAnim.startTime;
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
        const isGunSpecial = ['pistol', 'deagle', 'p4040', 'akm', 'pkm', 'qbz191', 'qjb201', 'energy_lmg', 'shotgun'].includes(wt);
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
        const topY = sprite
            ? sprite.y - sprite.displayHeight * 0.5
            : entity.y - size * 1.5;

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
            const cfg = renderCfg.healthBar || { width: 28, height: 4, offsetY: -30 };
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
                const reloadPercent = 1 - (mainState.reloadTimer / mainState.reloadTime);
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
                    const offReloadPercent = 1 - (offState.reloadTimer / offState.reloadTime);
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

    _redrawMinimapStatic() {
        const g = this._minimapStaticGraphics;
        if (!g) return;
        g.clear();
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

        // 背景
        const bgColor = this._parseColor(bg.fill || 'rgba(0,0,0,0.6)', 0x000000, 0.6);
        g.fillStyle(bgColor.color, bgColor.alpha);
        g.fillRect(mx, my, minimapW, minimapH);
        const borderColor = this._parseColor(bg.border || 'rgba(255,255,255,0.4)', 0xffffff, 0.4);
        g.lineStyle(bg.lineWidth || 1, borderColor.color, borderColor.alpha);
        g.strokeRect(mx, my, minimapW, minimapH);

        // 墙壁
        if (WallSystem && WallSystem.walls) {
            const wallColor = this._parseColor(styles.wall || 'rgba(80,80,80,0.5)', 0x505050, 0.5);
            g.fillStyle(wallColor.color, wallColor.alpha);
            for (const w of WallSystem.walls) {
                const wx = mx + w.x * scale;
                const wy = my + w.y * scale;
                const ww = Math.max(0.5, w.w * scale);
                const wh = Math.max(0.5, w.h * scale);
                g.fillRect(wx, wy, ww, wh);
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

        // 墙壁数量变化时才重绘静态层
        const wallCount = WallSystem && WallSystem.walls ? WallSystem.walls.length : 0;
        if (wallCount !== this._minimapStaticWallsCount) {
            this._redrawMinimapStatic();
            this._minimapStaticWallsCount = wallCount;
        }

        // 相机视野框（与框求交集，超框部分不画）
        const camX = mx + (Camera.x - CONFIG.VIEW_WIDTH / 2) * scale;
        const camY = my + (Camera.y - CONFIG.VIEW_HEIGHT / 2) * scale;
        const viewW = Math.max(1, CONFIG.VIEW_WIDTH * scale);
        const viewH = Math.max(1, CONFIG.VIEW_HEIGHT * scale);
        const viewColor = this._parseColor(styles.viewFrame || 'rgba(255,200,0,0.6)', 0xffc800, 0.6);
        const fx1 = Math.max(camX, mx), fy1 = Math.max(camY, my);
        const fx2 = Math.min(camX + viewW, mx + minimapW), fy2 = Math.min(camY + viewH, my + minimapH);
        if (fx2 > fx1 && fy2 > fy1) {
            g.lineStyle(1, viewColor.color, viewColor.alpha);
            g.strokeRect(fx1, fy1, fx2 - fx1, fy2 - fy1);
        }

        // 裂隙
        if (SceneManager.currentScene === 'scene2' && RiftSystem && RiftSystem.rifts) {
            const riftColor = this._parseColor(styles.rift || '#00008B', 0x00008B, 1);
            g.fillStyle(riftColor.color, riftColor.alpha);
            for (const rift of RiftSystem.rifts) {
                if (rift.completed) continue;
                const rx = mx + rift.x * scale;
                const ry = my + rift.y * scale;
                if (inBox(rx, ry)) g.fillCircle(rx, ry, sizes.rift || 2);
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
                    g.fillCircle(ex, ey, sizes.portal || 2.5);
                } else if (e.name === '大块头') {
                    const bossColor = this._parseColor(styles.boss || '#ff0000', 0xff0000, 1);
                    g.fillStyle(bossColor.color, bossColor.alpha);
                    g.fillCircle(ex, ey, (sizes.enemy || 1.5) * 2);
                } else if (e._faction === 'enemy') {
                    const enemyColor = this._parseColor(styles.enemy || '#ff4444', 0xff4444, 1);
                    g.fillStyle(enemyColor.color, enemyColor.alpha);
                    g.fillCircle(ex, ey, sizes.enemy || 1.5);
                } else if (e.itemData) {
                    const itemColor = this._parseColor(styles.item || '#ffd700', 0xffd700, 1);
                    g.fillStyle(itemColor.color, itemColor.alpha);
                    g.fillCircle(ex, ey, sizes.item || 1);
                }
            });
        }

        // 玩家（箭头端点钳制到框内）
        const px = mx + game.player.x * scale;
        const py = my + game.player.y * scale;
        const playerColor = this._parseColor(styles.player || '#00ff00', 0x00ff00, 1);
        if (inBox(px, py)) {
            g.fillStyle(playerColor.color, playerColor.alpha);
            g.fillCircle(px, py, sizes.player || 3);
            const dir = game.player.rotation || 0;
            g.lineStyle(sizes.arrowLineWidth || 1.5, playerColor.color, playerColor.alpha);
            g.beginPath();
            g.moveTo(px, py);
            g.lineTo(clampX(px + Math.cos(dir) * (sizes.arrowLen || 6)), clampY(py + Math.sin(dir) * (sizes.arrowLen || 6)));
            g.strokePath();
        }

        // 标题
        const title = minimapCfg.title || {};
        this.minimapTitle.setPosition(mx + (title.offsetX || 4), my + (title.offsetY || -2));
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
                    sprite = this.add.sprite(e.x, e.y, sprCfg.idleKey);
                    sprite.setOrigin(0.5, 0.5);
                    sprite.setDisplaySize(sz, sz);
                    // 静态贴图（无动画注册）直接显示首帧，不 play
                    if (this.anims.exists(sprCfg.idleKey)) sprite.play(sprCfg.idleKey);
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
                const label = this.add.text(e.x, e.y - (e.size || 16) - 8, '', {
                    fontFamily: 'SimHei, "Microsoft YaHei", sans-serif',
                    fontSize: '11px',
                    color: '#d4c5a9',
                    align: 'center'
                });
                label.setOrigin(0.5, 1);
                label.setDepth(e.y + 1);
                data = { sprite, label, sprCfg };
                this._neutralSprites.set(e, data);
            }
            const { sprite, label, sprCfg } = data;
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
            label.setPosition(e.x, sprite.y - labelTop - 8);
            if (label.text !== text) {
                label.setText(text);
            }
            if (label.style?.color !== color) {
                label.setColor(color);
            }
            sprite.setVisible(true);
            label.setVisible(true);
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
        // 边界
        if (currentScene !== 'scene7') {
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
        const safeTexture = this.textures.exists(wanted) ? wanted : 'enemy_circle';
        if (sprite.texture.key !== safeTexture) {
            sprite.setTexture(safeTexture);
        }
        if (options.flipX !== undefined) {
            sprite.setFlipX(options.flipX);
        }
        if (options.frame !== undefined) {
            try {
                sprite.setFrame(options.frame);
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
