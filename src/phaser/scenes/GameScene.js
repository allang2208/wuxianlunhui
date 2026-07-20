
import { Game } from '../../game.js';
import { SceneManager } from '../../world/scene-manager.js';


// ============================================================
// GameScene - 主游戏场景：替代原有的 renderer.js + game.js 渲染部分
// ============================================================
import { Scene } from 'phaser';
import { WallSystem } from '../../world/wall-system.js';
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
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { getTorsoRect } from '../../physics/torso-hitbox.js';

import { DungeonMapSystem } from '../../world/dungeon-map-system.js';
import { Camera } from '../../world/camera.js';
import { Input } from '../../ui/input.js';
import { RiftSystem } from '../../quest/rift-system.js';
import { isGunWeapon } from '../../config/gun-ammo.js';
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

        // 相机设置
        const viewW = CONFIG?.VIEW_WIDTH || window.innerWidth || 1920;
        const viewH = CONFIG?.VIEW_HEIGHT || window.innerHeight || 1080;
        this.cameras.main.setBounds(-CONFIG.WORLD_WIDTH, -CONFIG.WORLD_HEIGHT, CONFIG.WORLD_WIDTH * 3, CONFIG.WORLD_HEIGHT * 3);
        this.cameras.main.setZoom(1);
        this.cameras.main.setViewport(0, 0, viewW, viewH);
        this.cameras.main.setBackgroundColor('#000000');

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
            }
            if (this.playerSprite && this.playerSprite.visible) {
                this.playerSprite.setVisible(false);
                this.playerSprite.setActive(false);
            }
            if (this.weaponSprite && this.weaponSprite.visible) {
                this.weaponSprite.setVisible(false);
                this.weaponSprite.setActive(false);
            }
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
            if (this.minimapTitle) this.minimapTitle.setVisible(false);
            this._entityHudTexts.forEach(t => t.setVisible(false));
            // 地图模式下隐藏敌人/中立实体/其他施法者特效，避免战斗残留覆盖地图
            if (this.enemies) this.enemies.setVisible(false);
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
            }
        }

        // 同步玩家精灵图动画状态
        this._updatePlayerAnimation(_game);

        // 先同步 Sprite/物理体位置，再更新相机，避免贴图比相机慢一帧导致抖动
        this._syncBodiesToPhysics();
        // 同步可移动实体脚底阴影
        this._syncEntityShadows(_game);
        // 同步眩晕双星特效（眩晕持续时间内播放，结束消失）
        this._syncStunEffects(_game);
        // 调试范围圈与阴影使用同一脚底坐标，避免错位
        this._syncCollisionRadii(_game);
        // Phase 4: 根据世界 Y 坐标统一动态实体深度
        this._updateDynamicDepths();
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
            this.playerSprite.setDepth(this.playerSprite.y + footOffsetY + 10);
        }

        // 2. 敌人 / 尸体
        if (Game.entities) {
            Game.entities.forEach(e => {
                if (!e || e === Game.player) return;
                const isCorpse = e._preserveCorpse && !e.active &&
                    (e._deathAnimTimer > 0 || e._corpseTimer > 0);
                if (!e.active && !isCorpse) return;
                const sprite = e._phaserSprite;
                if (!sprite || !sprite.active) return;
                const footOffsetY = this._getFootOffsetY(e, sprite);
                sprite.setDepth(sprite.y + footOffsetY + (isCorpse ? 2 : 10));
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
        this.playerSprite = this.physics.add.sprite(0, 0, 'player_idle');
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
            this.playerSprite.setTexture('player_idle');

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
     * 切换玩家动画
     */
    setPlayerAnimation(key) {
        if (!this.playerSprite) return;

        this._lastPlayerAnimKey = key;
        const currentAnim = this.playerSprite.anims.currentAnim?.key;

        // 根据朝向翻转（侧视精灵图默认朝右）
        const player = window.Game && window.Game.player;
        if (player && player._facingDir) {
            if (player._facingDir === 'left') {
                this.playerSprite.setFlipX(true);
            } else if (player._facingDir === 'right') {
                this.playerSprite.setFlipX(false);
            }
        }

        if (key === 'idle') {
            if (currentAnim && currentAnim.key !== 'player_idle') {
                this.playerSprite.anims.stop();
            }
            this.playerSprite.setTexture('player_idle');
        } else if (key === 'walk') {
            if (!currentAnim || currentAnim.key !== 'player_walk') {
                this.playerSprite.play('player_walk', true);
            }
        } else if (key === 'run') {
            if (!currentAnim || currentAnim.key !== 'player_run') {
                this.playerSprite.play('player_run', true);
            }
        } else if (key === 'attack_sword') {
            // 剑攻击动画：播放一次，完成后回到idle
            if (currentAnim === 'player_attack_sword' && this.playerSprite.anims.isPlaying) return;
            this.playerSprite.play('player_attack_sword', true);
            const animDef = this.anims.get('player_attack_sword');
            this._playerAttackDuration = animDef ? (animDef.duration || 667) : 667;
            this._playerAttackStartTime = performance.now();
            this.playerSprite.once('animationcomplete', () => {
                this.setPlayerAnimation('idle');
            });
        }
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
        const isPlayingAttackAnim = isMeleeWeapon && currentAnimKey === 'player_attack_sword' && this.playerSprite.anims.isPlaying;
        if (isMeleeWeapon && weaponAnim.isAttacking && !isPlayingAttackAnim) {
            weaponAnim.isAttacking = false;
            weaponAnim.state = 'idle';
        }
        if (weaponAnim.isAttacking || (weaponAnim.state && weaponAnim.state !== 'idle')) return;
        if (player._isWhirlwind || player._isDashing || player._specialAttackActive) return;

        let key = 'idle';
        if (player._isSprinting && player.isMoving) {
            key = 'run';
        } else if (player.isMoving) {
            key = 'walk';
        }

        // 加入短暂停顿缓冲：停止移动后 80ms 再切回 idle，避免速度抖动导致动画反复重启
        const now = performance.now();
        if (key === 'idle') {
            if (!this._playerAnimIdleStart) this._playerAnimIdleStart = now;
            if (now - this._playerAnimIdleStart < 80) return;
        } else {
            this._playerAnimIdleStart = 0;
        }

        // 即使动画状态未变，也同步朝向翻转
        if (player._facingDir) {
            if (player._facingDir === 'left') {
                this.playerSprite.setFlipX(true);
            } else if (player._facingDir === 'right') {
                this.playerSprite.setFlipX(false);
            }
        }
        if (this._lastPlayerAnimKey === key) return;
        this.setPlayerAnimation(key);
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
        const wt = currentItem.weaponType;
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
                const pos = WeaponTransform.getWeaponWorldPosition(player, wt, false, false, animState);
                const facingRight = Math.abs(player.rotation) < Math.PI / 2;
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
                
                return;
            }
        }
        
        // 保留 Canvas 版本作为对比基准（条件开关）
        // 在浏览器控制台执行：__phaserScene._useCanvasWeapon = true 切换回 Canvas
        if (this._useCanvasWeapon === undefined) this._useCanvasWeapon = false;
        
        // 如果玩家处于特殊动画状态，同步特殊动画位置到 Phaser（风车/冲刺/复位）
        const isSpecialAnim = player._isWhirlwind || player._isDashing || player._dashResetAnim || player._specialAttackActive || player._specialResetAnim;
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
        if (weaponAnim.isAttacking) {
            const isGun = ['pistol', 'deagle', 'p4040', 'akm', 'pkm', 'qbz191', 'qjb201', 'energy_lmg', 'shotgun'].includes(wt);
            if (!isGun) {
                // 近战武器：优先使用逐帧配置，按玩家攻击动画当前帧同步武器
                const perFrameCfg = WeaponAnimConfig[wt]?.attack;
                if (perFrameCfg && perFrameCfg.type === 'perFrame' && perFrameCfg.frames) {
                    this.weaponSprite.setVisible(!this._useCanvasWeapon);
                    let progress = 0;
                    if (this._playerAttackStartTime && this._playerAttackDuration > 0) {
                        progress = Math.min(1, (performance.now() - this._playerAttackStartTime) / this._playerAttackDuration);
                    } else {
                        const currentAnim = this.playerSprite.anims.currentAnim;
                        if (currentAnim && currentAnim.key === 'player_attack_sword' && this.playerSprite.anims.getProgress) {
                            progress = this.playerSprite.anims.getProgress();
                        }
                    }
                    const facingRight = Math.abs(player.rotation) < Math.PI / 2;
                    // 以右攻击为参考，朝左时翻转贴图并镜像位置/旋转
                    const pfPos = WeaponTransform.getInterpolatedPerFramePosition(player, wt, progress, true);
                    if (pfPos) {
                        const wx = facingRight ? pfPos.x : 2 * player.x - pfPos.x;
                        const wrot = facingRight ? pfPos.rotation : -pfPos.rotation;
                        this.weaponSprite.setPosition(wx, pfPos.y);
                        this.weaponSprite.setRotation(wrot);
                        this.weaponSprite.setFlipX(!facingRight);
                        const wSize = WeaponTransform.getWeaponSize(wt, pfPos.scale, 'attack');
                        this.weaponSprite.setDisplaySize(wSize.width, wSize.height);
                    }
                    return;
                }
                // 否则：Tween 控制位置，直接返回
                this.weaponSprite.setVisible(!this._useCanvasWeapon);
                const wSize = WeaponTransform.getWeaponSize(wt, null, 'attack');
                this.weaponSprite.setDisplaySize(wSize.width, wSize.height);
                return;
            }
            // 远程武器：继续执行，让状态机驱动的后坐力生效
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
        
        // ===== 关键帧插值：walk/attack 动画使用关键帧数据 =====
        let keyframeOffset = null;
        let kfAnimState = null; // 实际使用的关键帧动画类型
        
        // 计算攻击进度（如果有）
        let attackProgress = null;
        if (weaponAnim.isAttacking && weaponAnim.state !== 'idle') {
            const wa = { windupMs: 200, swingMs: 300, recoverMs: 400 };
            const totalMs = wa.windupMs + wa.swingMs + wa.recoverMs;
            if (weaponAnim.state === 'windup') {
                attackProgress = (weaponAnim.timer / wa.windupMs) * (wa.windupMs / totalMs);
            } else if (weaponAnim.state === 'swing') {
                attackProgress = (wa.windupMs + weaponAnim.timer) / totalMs;
            } else if (weaponAnim.state === 'recover') {
                attackProgress = (wa.windupMs + wa.swingMs + weaponAnim.timer) / totalMs;
            }
            // 限制在 0-1 范围内
            attackProgress = Math.max(0, Math.min(1, attackProgress));
        }
        
        // 确定使用哪个关键帧配置
        if (isMelee) {
            if (animState === 'walk') {
                kfAnimState = 'walk';
            } else if (attackProgress !== null) {
                kfAnimState = 'attack';
            }
        }
        
        if (kfAnimState && WeaponAnimConfig.keyframes && WeaponAnimConfig.keyframes[wt]) {
            const kfConfig = WeaponAnimConfig.keyframes[wt][kfAnimState];
            if (kfConfig && kfConfig.length >= 2) {
                // 获取进度
                let progress;
                if (kfAnimState === 'attack') {
                    progress = attackProgress;
                } else if (kfAnimState === 'walk' && this.playerSprite && this.playerSprite.anims) {
                    const currentAnim = this.playerSprite.anims.currentAnim;
                    if (currentAnim && currentAnim.key === 'player_walk') {
                        progress = this.playerSprite.anims.getProgress();
                    }
                }
                
                if (progress !== undefined && progress !== null) {
                    // 线性插值找到当前关键帧
                    let prev = kfConfig[0], next = kfConfig[kfConfig.length - 1];
                    for (let i = 0; i < kfConfig.length - 1; i++) {
                        if (progress >= kfConfig[i].progress && progress <= kfConfig[i + 1].progress) {
                            prev = kfConfig[i];
                            next = kfConfig[i + 1];
                            break;
                        }
                    }
                    // 计算插值比例
                    const segmentDuration = next.progress - prev.progress;
                    const t = segmentDuration > 0 ? (progress - prev.progress) / segmentDuration : 0;
                    // 线性插值
                    // 支持 handOffsetX/Y（挂载点系统）和 offsetX/Y（旧系统）
                    const prevOffsetX = prev.handOffsetX !== undefined ? prev.handOffsetX : prev.offsetX;
                    const nextOffsetX = next.handOffsetX !== undefined ? next.handOffsetX : next.offsetX;
                    const prevOffsetY = prev.handOffsetY !== undefined ? prev.handOffsetY : prev.offsetY;
                    const nextOffsetY = next.handOffsetY !== undefined ? next.handOffsetY : next.offsetY;
                    keyframeOffset = {
                        offsetX: prevOffsetX + (nextOffsetX - prevOffsetX) * t,
                        offsetY: prevOffsetY + (nextOffsetY - prevOffsetY) * t,
                        rotation: prev.rotation + (next.rotation - prev.rotation) * t,
                        scale: prev.scale + (next.scale - prev.scale) * t
                    };
                }
            }
        }
        
        const pos = WeaponTransform.getWeaponWorldPosition(player, wt, false, false, animState);
        const facingRight = Math.abs(player.rotation) < Math.PI / 2;
        // 近战武器使用固定 rotation（所有状态）；
        // 远程武器（枪械）贴图旋转 = 武器位置 → 鼠标准心的精确连线角，
        // 不再使用 player.rotation（脚底→鼠标连线角），消除手部锚点视差导致的固定角度偏移。
        let rot;
        if (isMelee) {
            rot = WeaponTransform.getWeaponRotation(0, wt, 0, animState, facingRight);
        } else if (typeof Input !== 'undefined' && Input.mouse) {
            const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            rot = Math.atan2(mouseWorld.y - pos.y, mouseWorld.x - pos.x);
        } else {
            rot = WeaponTransform.getWeaponRotation(player.rotation, wt, 0, animState, facingRight);
        }
        
        // 应用关键帧偏移（覆盖默认位置）
        if (keyframeOffset && kfAnimState) {
            const kfPos = WeaponTransform.getKeyframedWeaponPosition(
                player, wt, kfAnimState, keyframeOffset, 0, facingRight
            );
            pos.x = kfPos.x;
            pos.y = kfPos.y;
            rot = kfPos.rotation;
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
        
        this.weaponSprite.setPosition(pos.x, pos.y);
        this.weaponSprite.setRotation(rot);
        this.weaponSprite.setVisible(!this._useCanvasWeapon);
        this.weaponSprite.setFlipX(false);
        
        // 武器水平翻转：使用 setScale(-1, 1) 替代 setFlipX，同时翻转位置和贴图
        // 注意：位置已经在 localToWorld 中镜像，这里只需要翻转贴图
        // 如果位置已镜像，不需要再翻转贴图
        // const weaponFlipX = !facingRight;
        // this.weaponSprite.setFlipX(weaponFlipX);
        
        // 武器缩放：枪械类使用 setScale 保持原始比例，其他武器使用 setDisplaySize 匹配 Canvas 尺寸
        const wSize = WeaponTransform.getWeaponSize(wt, null, animState);
        const isGun = ['pistol', 'deagle', 'p4040', 'akm', 'pkm', 'qbz191', 'qjb201', 'energy_lmg', 'shotgun'].includes(wt);
        if (isGun) {
            this.weaponSprite.setScale(wSize.height / this.weaponSprite.height);
            const flipY = Math.abs(rot) > Math.PI / 2;
            this.weaponSprite.setFlipY(flipY);
        } else {
            this.weaponSprite.setDisplaySize(wSize.width, wSize.height);
        }
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
        const wt = offhandItem.weaponType;
        
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
        const pos = WeaponTransform.getWeaponWorldPosition(player, wt, true, false, offhandAnimState);
        const facingRight = Math.abs(player.rotation) < Math.PI / 2;
        // 近战武器使用固定 rotation（所有状态）；
        // 副手远程武器（双持手枪）同主手：武器位置 → 鼠标准心的精确连线角
        const isMelee = wt === 'sword' || wt === 'bow';
        let rot;
        if (isMelee) {
            rot = WeaponTransform.getWeaponRotation(0, wt, 0, offhandAnimState, facingRight);
        } else if (typeof Input !== 'undefined' && Input.mouse) {
            const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            rot = Math.atan2(mouseWorld.y - pos.y, mouseWorld.x - pos.x);
        } else {
            rot = WeaponTransform.getWeaponRotation(player.rotation, wt, 0, offhandAnimState, facingRight);
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
        
        this.offhandWeaponSprite.setPosition(pos.x, pos.y);
        this.offhandWeaponSprite.setRotation(rot);
        this.offhandWeaponSprite.setVisible(!this._useCanvasWeapon);
        
        // 武器水平翻转：使用旋转镜像替代 setFlipX
        // const offhandFlipX = !facingRight;
        // this.offhandWeaponSprite.setFlipX(offhandFlipX);
        
        // 武器缩放：枪械类使用 setScale 保持原始比例，其他武器使用 setDisplaySize
        const wSize = WeaponTransform.getWeaponSize(wt);
        const isGunOff = ['pistol', 'deagle', 'p4040', 'akm', 'pkm', 'qbz191', 'qjb201', 'energy_lmg', 'shotgun'].includes(wt);
        if (isGunOff) {
            this.offhandWeaponSprite.setScale(wSize.height / this.offhandWeaponSprite.height);
            const flipY = Math.abs(rot) > Math.PI / 2;
            this.offhandWeaponSprite.setFlipY(flipY);
        } else {
            this.offhandWeaponSprite.setDisplaySize(wSize.width, wSize.height);
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

    // 统一的特殊动画武器同步（风车/冲刺/复位/特殊攻击）
    // 将 Canvas 变换链转换为世界坐标
    _syncSpecialWeaponAnim(player, wt, _weaponAnim) {
        if (!this.weaponSprite) {
            const texture = getWeaponTextureKey(player.equipments[player.weaponMode]);
            this.weaponSprite = this.add.sprite(0, 0, texture);
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
            const t = Math.min(1, elapsed / player._dashResetAnim.duration);
            const easeT = Easing.easeOutQuart(t);
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
        this._syncMinimap(gScreen);
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

        // 敌人
        for (const entity of _game.entities.values()) {
            if (!entity || !entity.active || entity === _game.player) continue;
            if (entity._faction !== 'enemy') continue;
            drawEntity(entity);
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
        // hudOffsetY（render 配置）：贴图透明上沿过大时整体下移名字/血条的校准量（规则：名字/血条应位于贴图上方 30px 区域）
        // render 来源：新怪（enemy-config.json）走 entity.config.render，老怪（animation-config）走 _animCfg.render
        const renderCfg = entity._animCfg?.render || entity.config?.render || {};
        const hudDy = renderCfg.hudOffsetY || 0;
        if (hp < maxHp) {
            const cfg = renderCfg.healthBar || { width: 28, height: 4, offsetY: -30 };
            const barW = cfg.width || 28;
            const barH = cfg.height || 4;
            const barY = topY + hudDy + (cfg.offsetY || -8);
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
        nameText.setPosition(x, topY + hudDy - 6);
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

    _syncCrosshair(g) {
        const player = window.Game && window.Game.player;
        if (!player) return;
        // 出征面板或地牢地图模式：强制恢复默认鼠标指针，避免与地图/面板交互冲突
        const isDungeonNonCombat = DungeonMapSystem && DungeonMapSystem.active &&
            (DungeonMapSystem.state === 'map' || DungeonMapSystem.state === 'event' ||
             DungeonMapSystem.state === 'shop' || DungeonMapSystem.state === 'reward');
        if ((ExpeditionSystem && ExpeditionSystem._isOpen) || isDungeonNonCombat) {
            document.body.style.cursor = 'default';
            return;
        }
        const currentWeapon = player.equipments[player.weaponMode];
        const isBowWeapon = currentWeapon && currentWeapon.weaponType === 'bow';
        const wantCursor = (!currentWeapon || (!isGunWeapon(currentWeapon) && !isBowWeapon)) ? 'default' : 'none';
        document.body.style.cursor = wantCursor;
        if (wantCursor === 'default') return;
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

        // 描边
        g.lineStyle(lineWidth + outlineWidth, parseInt((colors.outline || '#000000').replace('#', ''), 16), 1);
        this._drawCrosshairLines(g, mx, my, gap, lineLen);
        // 主体
        g.lineStyle(lineWidth, parseInt((colors.main || '#00ff00').replace('#', ''), 16), 1);
        this._drawCrosshairLines(g, mx, my, gap, lineLen);
        // 中心点
        g.fillStyle(parseInt((colors.outline || '#000000').replace('#', ''), 16), 1);
        g.fillCircle(mx, my, centerDot.outerRadius || 1.5);
        g.fillStyle(parseInt((colors.main || '#00ff00').replace('#', ''), 16), 1);
        g.fillCircle(mx, my, centerDot.innerRadius || 0.8);
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

    _syncMinimap(g) {
        const game = window.Game;
        if (!game || !game.player || game._npcDialoguePaused) return;
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

        // 墙壁数量变化时才重绘静态层
        const wallCount = WallSystem && WallSystem.walls ? WallSystem.walls.length : 0;
        if (wallCount !== this._minimapStaticWallsCount) {
            this._redrawMinimapStatic();
            this._minimapStaticWallsCount = wallCount;
        }

        // 相机视野框
        const camX = mx + (Camera.x - CONFIG.VIEW_WIDTH / 2) * scale;
        const camY = my + (Camera.y - CONFIG.VIEW_HEIGHT / 2) * scale;
        const viewW = Math.max(1, CONFIG.VIEW_WIDTH * scale);
        const viewH = Math.max(1, CONFIG.VIEW_HEIGHT * scale);
        const viewColor = this._parseColor(styles.viewFrame || 'rgba(255,200,0,0.6)', 0xffc800, 0.6);
        g.lineStyle(1, viewColor.color, viewColor.alpha);
        g.strokeRect(camX, camY, viewW, viewH);

        // 裂隙
        if (SceneManager.currentScene === 'scene2' && RiftSystem && RiftSystem.rifts) {
            const riftColor = this._parseColor(styles.rift || '#00008B', 0x00008B, 1);
            g.fillStyle(riftColor.color, riftColor.alpha);
            for (const rift of RiftSystem.rifts) {
                if (rift.completed) continue;
                const rx = mx + rift.x * scale;
                const ry = my + rift.y * scale;
                g.fillCircle(rx, ry, sizes.rift || 2);
            }
        }

        // 其它实体
        if (game.entities && typeof game.entities.forEach === 'function') {
            game.entities.forEach(e => {
                if (!e || e === game.player || !e.active) return;
                if (typeof e.x !== 'number' || typeof e.y !== 'number' || isNaN(e.x) || isNaN(e.y)) return;
                const ex = mx + e.x * scale;
                const ey = my + e.y * scale;
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

        // 玩家
        const px = mx + game.player.x * scale;
        const py = my + game.player.y * scale;
        const playerColor = this._parseColor(styles.player || '#00ff00', 0x00ff00, 1);
        g.fillStyle(playerColor.color, playerColor.alpha);
        g.fillCircle(px, py, sizes.player || 3);
        const dir = game.player.rotation || 0;
        g.lineStyle(sizes.arrowLineWidth || 1.5, playerColor.color, playerColor.alpha);
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(dir) * (sizes.arrowLen || 6), py + Math.sin(dir) * (sizes.arrowLen || 6));
        g.strokePath();

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
                if (!this.textures.exists('neutral_circle')) {
                    const g = this.add.graphics();
                    g.fillStyle(0xffffff, 1);
                    g.fillCircle(16, 16, 16);
                    g.generateTexture('neutral_circle', 32, 32);
                    g.destroy();
                }
                const size = e.size || 16;
                const sprite = this.add.sprite(e.x, e.y, 'neutral_circle');
                sprite.setOrigin(0.5, 0.5);
                sprite.setDisplaySize(size * 2, size * 2);
                const label = this.add.text(e.x, e.y - size - 8, '', {
                    fontFamily: 'SimHei, "Microsoft YaHei", sans-serif',
                    fontSize: '11px',
                    color: '#d4c5a9',
                    align: 'center'
                });
                label.setOrigin(0.5, 1);
                label.setDepth(e.y + 1);
                data = { sprite, label };
                this._neutralSprites.set(e, data);
            }
            const { sprite, label } = data;
            const size = e.size || 16;
            const shift = this._getFootOffsetY(e, sprite);
            sprite.setPosition(e.x, e.y - shift);
            sprite.setTint(this._parseColor(e.color || '#d4c5a9').color);

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
            label.setPosition(e.x, sprite.y - size - 8);
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
        const shouldReplay = !current || current.key !== animKey || (!sprite.anims.isPlaying && isLoopAnim);
        if (shouldReplay) {
            // 死亡动画结束后进入尸体阶段，不要再播放
            if (animState === 'death' && enemy._deathAnimTimer <= 0) {
                sprite.anims.stop();
            } else {
                sprite.anims.play(animKey, true);
            }
        }

        // 运行时动态偏移：按当前帧把有效贴图对齐到同一位置
        this._applySpriteFrameOffset(sprite, animKey);
    }
}
