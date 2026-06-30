// ============================================================
// GameScene - 主游戏场景：替代原有的 renderer.js + game.js 渲染部分
// ============================================================
import { Scene } from 'phaser';
import { WallSystem } from '../../world/wall-system.js';
import { WeaponTransform } from '../../combat/weapon-transform.js';

export class GameScene extends Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    // ---- 生命周期 ----

    create() {
        console.log('[GameScene] Scene created');

        // 标记场景就绪，通知外部系统（必须提前，因为后续代码依赖 window.__phaserScene）
        window.__phaserSceneReady = true;
        window.__phaserScene = this;

        // 初始化标志（必须在 setupColliders 之前）
        this._collidersSet = false;
        // Velocity 驱动开关（默认关闭，避免与原有移动逻辑冲突）
        // 如需手动测试，可在控制台执行：__phaserScene._useVelocityDrive = true
        this._useVelocityDrive = false;

        // 创建玩家 Sprite（占位，后续由 Player 类接管）
        this._createPlayerSprite();

        // 创建敌人组
        this.enemies = this.physics.add.group();

        // 创建碰撞层（墙壁/障碍物）
        this.walls = this.physics.add.staticGroup();

        // 同步墙壁到 Phaser（WallSystem.init() 在 PhaserGame.init() 之前调用，所以这里补同步）
        if (WallSystem.walls && WallSystem.walls.length > 0) {
            WallSystem._syncWallsToPhaser();
        }

        // 相机设置
        const viewW = CONFIG?.VIEW_WIDTH || window.innerWidth || 1920;
        const viewH = CONFIG?.VIEW_HEIGHT || window.innerHeight || 1080;
        this.cameras.main.setBounds(-CONFIG.WORLD_WIDTH, -CONFIG.WORLD_HEIGHT, CONFIG.WORLD_WIDTH * 3, CONFIG.WORLD_HEIGHT * 3);
        this.cameras.main.setZoom(1);
        this.cameras.main.setViewport(0, 0, viewW, viewH);


        // 事件监听：外部系统通知
        this.events.on('playerSpawn', this._onPlayerSpawn, this);
        this.events.on('enemySpawn', this._onEnemySpawn, this);
    }

    update(time, delta) {
        // Phaser 自动调用，每帧更新
        // 现有 Game 循环仍然运行，这里只做 Phaser 相关的更新
        this._updateCamera();
        // 同步玩家位置到物理体（用于碰撞检测）
        this._syncBodiesToPhysics();
    }

    /**
     * 将现有逻辑层的位置同步到 Phaser 物理体
     * 保持逻辑层权威，物理体仅用于检测
     * 如果启用了 velocity 驱动，从 Phaser 同步位置回逻辑层
     */
    _syncBodiesToPhysics() {
        const Game = window.Game;
        if (!Game) return;
        
        // 玩家：如果启用 velocity 驱动，从 Phaser 同步位置回 Player
        if (this._useVelocityDrive && Game.player && this.playerSprite && this.playerSprite.body) {
            // 初始化：如果 playerSprite 在 (0,0) 或远离玩家，同步一次位置
            const distToPlayer = Math.sqrt(
                (this.playerSprite.x - Game.player.x) ** 2 +
                (this.playerSprite.y - Game.player.y) ** 2
            );
            if (distToPlayer > 100) {
                this.playerSprite.body.reset(Game.player.x, Game.player.y);
                console.log('[Velocity Drive] Init position:', Game.player.x, Game.player.y);
            }
            
            // 如果玩家在闪避，Player 直接设置位置，需要同步到 Phaser
            if (Game.player.isDodging) {
                this.playerSprite.body.reset(Game.player.x, Game.player.y);
                this.playerSprite.body.setVelocity(0, 0);
            }
            
            // 正常：从 Phaser 同步位置到 Player
            // 注意：只同步位置，不同步速度！
            Game.player.x = this.playerSprite.x;
            Game.player.y = this.playerSprite.y;
            // 边界检查
            if (Game.player.x < -CONFIG.WORLD_WIDTH || Game.player.x > CONFIG.WORLD_WIDTH * 2 ||
                Game.player.y < -CONFIG.WORLD_HEIGHT || Game.player.y > CONFIG.WORLD_HEIGHT * 2) {
                Game.player.x = Math.max(-CONFIG.WORLD_WIDTH, Math.min(CONFIG.WORLD_WIDTH * 2, Game.player.x));
                Game.player.y = Math.max(-CONFIG.WORLD_HEIGHT, Math.min(CONFIG.WORLD_HEIGHT * 2, Game.player.y));
                this.playerSprite.body.reset(Game.player.x, Game.player.y);
            }
            return;
        }
        
        // 原有模式：同步位置到物理体（用于碰撞检测）
        if (Game.player && this.playerSprite && this.playerSprite.body) {
            this.playerSprite.body.reset(Game.player.x, Game.player.y);
        }
        
        // 同步所有敌人（只有已创建 Phaser Sprite 的才同步，不自动创建）
        Game.entities.forEach((entity) => {
            if (!entity || !entity.active || entity === Game.player) return;
            if (!entity._phaserSprite) return; // 没有 Phaser Sprite 的不自动创建
            if (entity._phaserSprite.body) {
                entity._phaserSprite.body.reset(entity.x, entity.y);
            }
            if (entity.rotation !== undefined) {
                entity._phaserSprite.setRotation(entity.rotation + Math.PI / 2);
            }
        });
    }

    // ---- 相机系统 ----

    _updateCamera() {
        const Camera = window.Camera;
        if (!Camera) return;

        const viewW = CONFIG?.VIEW_WIDTH || window.innerWidth || 1920;
        const viewH = CONFIG?.VIEW_HEIGHT || window.innerHeight || 1080;

        // 更新相机边界（允许负坐标，3倍世界范围）
        this.cameras.main.setBounds(-CONFIG.WORLD_WIDTH, -CONFIG.WORLD_HEIGHT, CONFIG.WORLD_WIDTH * 3, CONFIG.WORLD_HEIGHT * 3);

        // 直接同步原有系统的相机位置，避免两个 Canvas 错位
        this.cameras.main.scrollX = Camera.x - viewW / 2;
        this.cameras.main.scrollY = Camera.y - viewH / 2;
    }

    // ---- 实体管理 ----

    _createPlayerSprite() {
        // 创建占位精灵，后续由外部 Player 系统接管控制
        this.playerSprite = this.physics.add.sprite(0, 0, 'character_idle');
        this.playerSprite.setDepth(100);
        this.playerSprite.setVisible(false); // 初始隐藏，等玩家生成后再显示
        // 配置物理体：无重力（俯视角），设置碰撞圆，消除阻力
        const body = this.playerSprite.body;
        body.setGravity(0, 0);
        body.setCircle(18); // 与 Player.collisionRadius 一致
        body.setImmovable(false);
        // 消除物理引擎的阻力，让速度完全由代码控制
        body.setDrag(0);
        body.setFriction(0, 0);
        body.setBounce(0, 0);
        body.setDamping(false);
        // 禁用物理引擎的自动移动（moves = false 时物理引擎不会自动积分位置）
        // 但我们需要物理引擎积分位置，所以保持 moves = true
        // 关键：使用 velocity 时，物理引擎会积分位置，但阻力会导致速度衰减
        // 设置 mass 为 1，避免质量影响
        body.setMass(1);
    }

    _onPlayerSpawn(data) {
        if (this.playerSprite) {
            this.playerSprite.setPosition(data.x, data.y);
            this.playerSprite.setVisible(true);
            this.playerSprite.play('player_walk');
        }
    }

    _onEnemySpawn(data) {
        const enemySprite = this.physics.add.sprite(data.x, data.y, data.texture || 'enemy_spider');
        enemySprite.setData('enemyId', data.id);
        this.enemies.add(enemySprite);
    }

    // ---- 公共 API（供外部系统调用） ----

    /**
     * 同步玩家位置到 Phaser Sprite
     */
    syncPlayerPosition(x, y, rotation) {
        if (!this.playerSprite) return;
        this.playerSprite.setPosition(x, y);
        this.playerSprite.setRotation(rotation);
    }

    /**
     * 切换玩家动画
     */
    setPlayerAnimation(key) {
        if (!this.playerSprite) return;
        if (key === 'idle') {
            this.playerSprite.anims.stop();
            this.playerSprite.setTexture('character_idle');
        } else if (key === 'walk') {
            this.playerSprite.play('player_walk', true);
        }
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
        let texture = 'weapon_rusty_sword';
        const wt = currentItem.weaponType;
        const wid = currentItem.weaponId;
        
        if (wt === 'pistol') {
            texture = (wid === 'weapon10') ? 'weapon_deagle' : 'weapon_g18';
        } else if (wt === 'pkm') {
            texture = 'weapon_pkm';
        } else if (wt === 'akm') {
            texture = 'weapon_akm';
        } else if (wt === 'qbz191') {
            texture = 'weapon_qbz191';
        } else if (wt === 'qjb201') {
            texture = 'weapon_qjb201';
        } else if (wt === 'shotgun') {
            texture = (wid === 'weapon13') ? 'weapon_saiga12k' : 'weapon_super90';
        } else if (wt === 'bow') {
            // 弓：rotate 阶段显示静态贴图并旋转；windup/swing/recover 由 Canvas 渲染帧动画
            if (weaponAnim.isAttacking) {
                // 攻击时隐藏 Phaser 武器，让 Canvas 渲染 8 帧动画
                if (this.weaponSprite) this.weaponSprite.setVisible(false);
                return;
            }
            texture = 'weapon_bow';
        } else if (wt === 'sword' || currentItem.category === 'weapon_melee') {
            // 根据 weaponId 选择对应的剑纹理
            if (wid === 'weapon2') {
                texture = 'weapon_knights_sword';
            } else if (wid === 'weapon4') {
                texture = 'weapon_rune_sword';
            } else if (wid === 'weapon5') {
                texture = 'weapon_night_flame';
            } else {
                texture = 'weapon_rusty_sword';
            }
        }
        
        // 保留 Canvas 版本作为对比基准（条件开关）
        // 在浏览器控制台执行：__phaserScene._useCanvasWeapon = true 切换回 Canvas
        if (this._useCanvasWeapon === undefined) this._useCanvasWeapon = false;
        
        // 如果玩家处于特殊动画状态，隐藏 Phaser 武器（由 Canvas 渲染）
        const isSpecialAnim = player._isWhirlwind || player._isDashing || player._dashResetAnim || player._specialAttackActive || player._specialResetAnim;
        if (isSpecialAnim) {
            if (this.weaponSprite) this.weaponSprite.setVisible(false);
            return;
        }
        
        // 创建或更新武器 Sprite
        if (!this.weaponSprite) {
            this.weaponSprite = this.add.sprite(0, 0, texture);
            this.weaponSprite.setDepth(150);
        } else if (this.weaponSprite.texture.key !== texture) {
            this.weaponSprite.setTexture(texture);
        }
        
        // 使用 WeaponTransform 统一计算位置和旋转
        const pos = WeaponTransform.getWeaponWorldPosition(player, wt, false, false);
        let rot = WeaponTransform.getWeaponRotation(player.rotation, wt, weaponAnim.animAngle || 0);
        
        // 应用后坐力偏移
        if (weaponAnim.recoil) {
            pos.x -= Math.cos(player.rotation) * weaponAnim.recoil;
            pos.y -= Math.sin(player.rotation) * weaponAnim.recoil;
        }
        
        // 应用刺击位移（反向）
        if (weaponAnim.thrust) {
            pos.x -= Math.cos(player.rotation) * weaponAnim.thrust;
            pos.y -= Math.sin(player.rotation) * weaponAnim.thrust;
        }
        
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
        
        // 武器缩放：使用 setDisplaySize 匹配 Canvas 的绘制尺寸
        const wSize = WeaponTransform.getWeaponSize(wt);
        this.weaponSprite.setDisplaySize(wSize.width, wSize.height);
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
        let texture = 'weapon_rusty_sword';
        const wt = offhandItem.weaponType;
        const wid = offhandItem.weaponId;
        
        if (wt === 'pistol') {
            texture = (wid === 'weapon10') ? 'weapon_deagle' : 'weapon_g18';
        } else if (wt === 'pkm') {
            texture = 'weapon_pkm';
        } else if (wt === 'akm') {
            texture = 'weapon_akm';
        } else if (wt === 'qbz191') {
            texture = 'weapon_qbz191';
        } else if (wt === 'qjb201') {
            texture = 'weapon_qjb201';
        } else if (wt === 'shotgun') {
            texture = (wid === 'weapon13') ? 'weapon_saiga12k' : 'weapon_super90';
        } else if (wt === 'bow') {
            texture = 'weapon_bow';
        } else if (wt === 'sword' || offhandItem.category === 'weapon_melee') {
            // 根据 weaponId 选择对应的剑纹理
            if (wid === 'weapon2') {
                texture = 'weapon_knights_sword';
            } else if (wid === 'weapon4') {
                texture = 'weapon_rune_sword';
            } else if (wid === 'weapon5') {
                texture = 'weapon_night_flame';
            } else {
                texture = 'weapon_rusty_sword';
            }
        }
        
        // 创建或更新副手武器 Sprite
        if (!this.offhandWeaponSprite) {
            this.offhandWeaponSprite = this.add.sprite(0, 0, texture);
            this.offhandWeaponSprite.setDepth(149); // 略低于主手
        } else if (this.offhandWeaponSprite.texture.key !== texture) {
            this.offhandWeaponSprite.setTexture(texture);
        }
        
        // 使用 WeaponTransform 统一计算副手位置和旋转
        const pos = WeaponTransform.getWeaponWorldPosition(player, wt, true, false);
        let rot = WeaponTransform.getWeaponRotation(player.rotation, wt, weaponAnim.animAngle || 0);
        
        // 应用后坐力偏移
        if (weaponAnim.recoil) {
            pos.x -= Math.cos(player.rotation) * weaponAnim.recoil;
            pos.y -= Math.sin(player.rotation) * weaponAnim.recoil;
        }
        
        // 应用刺击位移（反向）
        if (weaponAnim.thrust) {
            pos.x -= Math.cos(player.rotation) * weaponAnim.thrust;
            pos.y -= Math.sin(player.rotation) * weaponAnim.thrust;
        }
        
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
        
        // 武器缩放：使用 setDisplaySize 匹配 Canvas 的绘制尺寸
        const wSize = WeaponTransform.getWeaponSize(wt);
        this.offhandWeaponSprite.setDisplaySize(wSize.width, wSize.height);
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
     * 设置碰撞关系（在墙壁同步完成后调用）
     * 实体间碰撞：用 Phaser overlap 检测，但响应仍由现有 Game.resolveCollisions() 处理
     * 这样既利用 Phaser B/C 树的高效检测，又保持原有逻辑权威
     */
    setupColliders() {
        if (this._collidersSet) return;
        // 玩家 vs 墙壁（让 Phaser 物理阻挡，但现有逻辑也处理）
        if (this.playerSprite) {
            this.physics.add.collider(this.playerSprite, this.walls);
        }
        // 敌人 vs 墙壁
        this.physics.add.collider(this.enemies, this.walls);
        // 实体间碰撞：使用 overlap 检测但不自动响应，保持现有逻辑处理
        this._setupEntityOverlap();
        this._collidersSet = true;
        console.log('[GameScene] Colliders set up');
    }

    /**
     * 设置实体间 overlap 检测（玩家/敌人之间）
     * 碰撞响应仍由 Game.resolveCollisions() 处理，这里只做检测标记
     */
    _setupEntityOverlap() {
        if (this.playerSprite) {
            this.physics.add.overlap(this.playerSprite, this.enemies, (playerSprite, enemySprite) => {
                // 不自动响应，仅记录碰撞对
                // 现有 Game.resolveCollisions() 仍负责实际的碰撞分离
                // 未来可在此调用 Phaser 的物理响应，逐步替换
            });
        }
        // 敌人 vs 敌人 overlap
        this.physics.add.overlap(this.enemies, this.enemies, (enemyA, enemyB) => {
            // 同上，不做自动响应
        });
        console.log('[GameScene] Entity overlap set up');
    }

    getPlayerSprite() { return this.playerSprite; }
    getEnemyGroup() { return this.enemies; }
    getWallGroup() { return this.walls; }

    /**
     * 为敌人创建或获取 Phaser Sprite
     */
    getOrCreateEnemySprite(enemy, texture = 'enemy_spider') {
        if (!enemy._phaserSprite || !enemy._phaserSprite.active) {
            const sprite = this.physics.add.sprite(enemy.x, enemy.y, texture);
            sprite.setData('enemyId', enemy.id || enemy.name);
            sprite.setDepth(50);
            // 配置物理体：无重力，碰撞圆
            const body = sprite.body;
            body.setGravity(0, 0);
            body.setCircle(enemy.collisionRadius || enemy.size || 20);
            body.setImmovable(false);
            this.enemies.add(sprite);
            enemy._phaserSprite = sprite;
        }
        return enemy._phaserSprite;
    }
}
