
import { Game } from '../../game.js';
import { SceneManager } from '../../world/scene-manager.js';


// ============================================================
// GameScene - 主游戏场景：替代原有的 renderer.js + game.js 渲染部分
// ============================================================
import { Scene } from 'phaser';
import { WallSystem } from '../../world/wall-system.js';
import { WeaponTransform } from '../../combat/weapon-transform.js';
import { getWeaponTextureKey } from '../../config/weapon-texture-map.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { Easing, WEAPON_ANIM } from '../../config/math-utils.js';

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

        // Phase 3: 创建特效 Sprite Group
        this.runeSwordGroup = this.add.group();
        this.iceSpikeGroup = this.add.group();
        this.fireballSprite = null;

        // Phase 3 续：盾牌和飞行投射物
        this.shieldSprite = null;
        this.iceSpikeFlyGroup = this.add.group();
        this.fireballFlySprite = null;

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

    update(_time, _delta) {
        // Phaser 自动调用，每帧更新
        // 现有 Game 循环仍然运行，这里只做 Phaser 相关的更新
        
        // 地牢模式：隐藏角色及武器贴图
        const _game = window.Game;
        const _dms = window.DungeonMapSystem;
        if (SceneManager.currentScene === 'scene7' && _dms && _dms.active && _dms.state === 'map') {
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
        } else {
            // 火柴人模式：保持 Phaser sprite 隐藏，由 Canvas 绘制火柴人
            const _isStickFigure = _game && _game.player && _game.player._stickFigure;
            if (this.playerSprite && _game && _game.player && !this.playerSprite.visible && !_isStickFigure) {
                this.playerSprite.setVisible(true);
                this.playerSprite.setActive(true);
            }
            // 武器 Sprite 的可见性由 syncWeapon 控制，不在 update 中强制显示
            // 避免覆盖 syncWeapon 的隐藏逻辑（如武器切换为空时）
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
            }
        }
        
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
                // 如果实体有攻击冲刺偏移，同步到 Phaser 物理体
                let syncX = entity.x, syncY = entity.y;
                if (entity._attackDashOffset > 0 && !entity._dashBlocked) {
                    const offset = typeof entity._getDashOffset === 'function'
                        ? entity._getDashOffset()
                        : { x: 0, y: 0 };
                    syncX += offset.x;
                    syncY += offset.y;
                }
                entity._phaserSprite.body.reset(syncX, syncY);
            }
            // 不旋转，仅通过 flipX 控制朝向（与玩家一致）
            // if (entity.rotation !== undefined) {
            //     entity._phaserSprite.setRotation(entity.rotation + Math.PI / 2);
            // }
        });
    }

    // ---- 相机系统 ----

    _updateCamera() {
        const Camera = window.Camera;
        if (!Camera) return;

        const viewW = CONFIG?.VIEW_WIDTH || window.innerWidth || 1920;
        const viewH = CONFIG?.VIEW_HEIGHT || window.innerHeight || 1080;

        // 每帧更新 viewport，确保分辨率改变后 Phaser 相机渲染区域与 Canvas 层保持一致
        this.cameras.main.setViewport(0, 0, viewW, viewH);

        // 更新相机边界（允许负坐标，边界需足够大以包含 Camera.x - viewW/2 的范围）
        const boundSize = Math.max(CONFIG.WORLD_WIDTH, viewW, CONFIG.WORLD_HEIGHT, viewH) * 3;
        this.cameras.main.setBounds(-boundSize, -boundSize, boundSize * 2, boundSize * 2);

        // 直接同步原有系统的相机位置，避免两个 Canvas 错位
        this.cameras.main.scrollX = Camera.x - viewW / 2;
        this.cameras.main.scrollY = Camera.y - viewH / 2;
    }

    // ---- 实体管理 ----

    _createPlayerSprite() {
        // 创建占位精灵，后续由外部 Player 系统接管控制
        this.playerSprite = this.physics.add.sprite(0, 0, 'player_idle');
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
            // 火柴人模式：不显示 Phaser sprite
            const _game = window.Game;
            const _isStickFigure = _game && _game.player && _game.player._stickFigure;
            this.playerSprite.setVisible(!_isStickFigure);
            this.playerSprite.setActive(!_isStickFigure);
            this.playerSprite.setTexture('player_idle');
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
        
        const currentAnim = this.playerSprite.anims.currentAnim?.key;
        
        if (key === 'idle') {
            if (currentAnim && currentAnim !== 'player_idle') {
                this.playerSprite.anims.stop();
            }
            this.playerSprite.setTexture('player_idle');
        } else if (key === 'walk') {
            if (currentAnim !== 'player_walk') {
                this.playerSprite.play('player_walk', true);
            }
        } else if (key === 'run') {
            if (currentAnim !== 'player_run') {
                this.playerSprite.play('player_run', true);
            }
        } else if (key === 'attack_sword') {
            // 剑攻击动画：播放一次，完成后回到idle
            this.playerSprite.play('player_attack_sword', true);
            this.playerSprite.once('animationcomplete', () => {
                this.setPlayerAnimation('idle');
            });
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
                    this.weaponSprite.setDepth(150);
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
                
                // 弓武器水平翻转：使用旋转镜像替代 setFlipX
                // const bowFlipX = !facingRight;
                // this.weaponSprite.setFlipX(bowFlipX);
                
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
            this.weaponSprite.setDepth(150);
        } else if (this.weaponSprite.texture.key !== texture) {
            this.weaponSprite.setTexture(texture);
        }
        
        // ===== Phaser Tween 攻击动画期间，跳过 syncWeapon 的位置更新 =====
        // 但远程武器使用状态机驱动，需要继续执行以应用后坐力
        if (weaponAnim.isAttacking) {
            const isGun = ['pistol', 'deagle', 'p4040', 'akm', 'pkm', 'qbz191', 'qjb201', 'energy_lmg', 'shotgun'].includes(wt);
            if (!isGun) {
                // 近战武器：Tween 控制位置，直接返回
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
            this.weaponSprite.setDepth(150);
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
        // 近战武器使用固定 rotation（所有状态），远程武器使用 player.rotation
        const useFixedRot = isMelee;  // 所有近战状态都固定
        let rot = WeaponTransform.getWeaponRotation(useFixedRot ? 0 : player.rotation, wt, 0, animState, facingRight);
        
        // 应用关键帧偏移（覆盖默认位置）
        if (keyframeOffset) {
            const cfg = WeaponAnimConfig[wt];
            const hasHandAnchors = cfg.handAnchors && typeof cfg.handAnchors === 'object';
            
            if (hasHandAnchors && kfAnimState) {
                // ===== 挂载点系统（新）=====
                // 获取基础挂载点
                const handAnchors = cfg.handAnchors || {};
                const anchor = handAnchors[kfAnimState] || handAnchors.idle || { x: 0, y: 0 };
                
                // 方向镜像
                const anchorX = facingRight ? anchor.x : -anchor.x;
                const anchorY = anchor.y;
                
                // 关键帧偏移（handOffsetX/Y）
                const handOffsetX = keyframeOffset.offsetX || 0;
                const handOffsetY = keyframeOffset.offsetY || 0;
                
                // 手部世界位置 = 玩家位置 + 挂载点 + 关键帧偏移
                const playerX = player.x;
                const playerY = player.y;
                const handWorldX = playerX + anchorX + handOffsetX;
                const handWorldY = playerY + anchorY + handOffsetY;
                
                // gripOffset 旋转后的位置
                const gripOffset = cfg.gripOffset || { x: 0, y: 0 };
                const rotationRad = (keyframeOffset.rotation || 0) * Math.PI / 180;
                const cos = Math.cos(rotationRad);
                const sin = Math.sin(rotationRad);
                const gripRotatedX = cos * gripOffset.x - sin * gripOffset.y;
                const gripRotatedY = sin * gripOffset.x + cos * gripOffset.y;
                
                // 武器位置 = 手部位置 + gripOffset 旋转后
                pos.x = handWorldX + gripRotatedX;
                pos.y = handWorldY + gripRotatedY;
                
                // 旋转
                rot = WeaponTransform.getWeaponRotation(useFixedRot ? 0 : player.rotation, wt, 0, kfAnimState, facingRight) + rotationRad;
            } else {
                // ===== 旧系统：直接替换 holdOffsetX/Y =====
                const stateCfg = cfg[kfAnimState] || cfg;
                const originalHoldX = stateCfg.holdOffsetX;
                const originalHoldY = stateCfg.holdOffsetY;
                const originalRot = stateCfg.idleRotation;
                const originalScale = stateCfg.idleScale;
                
                if (!cfg[kfAnimState]) cfg[kfAnimState] = {};
                cfg[kfAnimState].holdOffsetX = keyframeOffset.offsetX;
                cfg[kfAnimState].holdOffsetY = keyframeOffset.offsetY;
                cfg[kfAnimState].idleRotation = keyframeOffset.rotation;
                cfg[kfAnimState].idleScale = keyframeOffset.scale;
                
                const worldPos = WeaponTransform.getWeaponWorldPosition(player, wt, false, false, animState);
                pos.x = worldPos.x;
                pos.y = worldPos.y;
                
                cfg[kfAnimState].holdOffsetX = originalHoldX;
                cfg[kfAnimState].holdOffsetY = originalHoldY;
                cfg[kfAnimState].idleRotation = originalRot;
                cfg[kfAnimState].idleScale = originalScale;
                
                rot = WeaponTransform.getWeaponRotation(useFixedRot ? 0 : player.rotation, wt, 0, animState, facingRight);
            }
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
            this.offhandWeaponSprite.setDepth(149); // 略低于主手
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
        // 近战武器使用固定 rotation（所有状态），远程武器使用 player.rotation
        const isMelee = wt === 'sword' || wt === 'bow';
        const useFixedRot = isMelee;  // 所有近战状态都固定
        let rot = WeaponTransform.getWeaponRotation(useFixedRot ? 0 : player.rotation, wt, 0, offhandAnimState, facingRight);
        
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
            sprite.setDepth(155);
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
            const mouseX = camera.scrollX + (window.Input?.mouse?.x || 0);
            const mouseY = camera.scrollY + (window.Input?.mouse?.y || 0);
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
     * Phase 3: 同步冰锥到 Phaser Sprite
     */
    _syncIceSpikes(player) {
        if (!player._iceSpikeSpikes) {
            this.iceSpikeGroup.setVisible(false);
            return;
        }
        
        // 确保 Group 中有足够的 Sprite
        while (this.iceSpikeGroup.countActive() < player._iceSpikeSpikes.length) {
            const sprite = this.add.sprite(0, 0, 'iceSpike');
            sprite.setDisplaySize(40, 60);
            sprite.setDepth(155);
            this.iceSpikeGroup.add(sprite);
        }
        
        // 同步每根冰锥的位置和旋转
        this.iceSpikeGroup.getChildren().forEach((sprite, i) => {
            const spike = player._iceSpikeSpikes[i];
            if (!spike || !spike.active || spike.launched || spike.flyActive) {
                sprite.setVisible(false);
                return;
            }
            
            const swayX = Math.sin(spike.swayTimer * spike.swayFreqX) * spike.swayAmpX;
            const swayY = Math.cos(spike.swayTimer * spike.swayFreqY) * spike.swayAmpY;
            
            const localX = spike.offsetX + swayX;
            const localY = spike.offsetY + swayY;
            
            const cos = Math.cos(player.rotation);
            const sin = Math.sin(player.rotation);
            const worldX = player.x + cos * localX - sin * localY;
            const worldY = player.y + sin * localX + cos * localY;
            
            // 计算朝向鼠标的角度（使用 Phaser 相机坐标）
            const camera = this.cameras.main;
            const mouseX = camera.scrollX + (window.Input?.mouse?.x || 0);
            const mouseY = camera.scrollY + (window.Input?.mouse?.y || 0);
            const absoluteAngle = Math.atan2(mouseY - player.y, mouseX - player.x);
            
            sprite.setPosition(worldX, worldY);
            sprite.setRotation(absoluteAngle + Math.PI / 2);
            sprite.setAlpha(0.85);
            sprite.setVisible(true);
        });
    }

    /**
     * Phase 3: 同步火球到 Phaser Sprite
     */
    _syncFireball(player) {
        if (!player._fireballActive || !player._fireball || player._fireball.launched) {
            if (this.fireballSprite) this.fireballSprite.setVisible(false);
            return;
        }
        
        const fb = player._fireball;
        
        if (!this.fireballSprite) {
            this.fireballSprite = this.add.sprite(0, 0, 'fireball');
            this.fireballSprite.setDepth(155);
        }
        
        const _s = player.size;
        const swayX = Math.sin(fb.swayTimer * fb.swayFreqX) * fb.swayAmpX;
        const swayY = Math.cos(fb.swayTimer * fb.swayFreqX) * fb.swayAmpX * 0.5;
        
        const localX = fb.offsetX + swayX;
        const localY = fb.offsetY + swayY;
        
        const cos = Math.cos(player.rotation);
        const sin = Math.sin(player.rotation);
        const worldX = player.x + cos * localX - sin * localY;
        const worldY = player.y + sin * localX + cos * localY;
        
        // 计算朝向鼠标的角度（使用 Phaser 相机坐标）
        const camera = this.cameras.main;
        const mouseX = camera.scrollX + ((window.Input?.mouse?.x) || 0);
        const mouseY = camera.scrollY + ((window.Input?.mouse?.y) || 0);
        const absoluteAngle = Math.atan2(mouseY - player.y, mouseX - player.x);
        
        this.fireballSprite.setPosition(worldX, worldY);
        this.fireballSprite.setRotation(absoluteAngle + Math.PI / 2);
        this.fireballSprite.setAlpha(0.9);
        this.fireballSprite.setDisplaySize(50 * (fb.scale || 1), 50 * (fb.scale || 1));
        
        // 如果 fireball 是 spritesheet，设置当前帧
        if (fb.frameIndex !== undefined) {
            try {
                this.fireballSprite.setFrame(fb.frameIndex);
            } catch (_e) {
                // 不是 spritesheet 或帧不存在，忽略
            }
        }
        
        this.fireballSprite.setVisible(true);
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
        
        if (!this.shieldSprite) {
            this.shieldSprite = this.add.sprite(0, 0, 'shield');
            this.shieldSprite.setDepth(148); // 低于武器(150)，高于角色(100)
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
                this.defenseGlow.setDepth(90);
            }
            this.defenseGlow.clear();
            const flicker = 0.5 + Math.sin(Date.now() / 200) * 0.25;
            const r = player.size + 8;
            this.defenseGlow.fillStyle(0xcc3333, flicker * 0.35);
            this.defenseGlow.fillCircle(player.x, player.y, r);
            this.defenseGlow.lineStyle(2, 0xff5555, flicker * 0.6);
            this.defenseGlow.strokeCircle(player.x, player.y, r + 2);
        } else if (this.defenseGlow) {
            this.defenseGlow.clear();
        }
    }

    /**
     * Phase 3 续：同步飞行中的冰锥到 Phaser Sprite
     */
    _syncFlyingIceSpikes(player) {
        if (!player._iceSpikeSpikes || !player._iceSpikeSpikes.some(s => s.flyActive)) {
            this.iceSpikeFlyGroup.setVisible(false);
            return;
        }
        
        const activeSpikes = player._iceSpikeSpikes.filter(s => s.flyActive);
        
        // 确保 Group 中有足够的 Sprite
        while (this.iceSpikeFlyGroup.countActive() < activeSpikes.length) {
            const sprite = this.add.sprite(0, 0, 'iceSpike');
            sprite.setDisplaySize(40, 60);
            sprite.setDepth(150);
            this.iceSpikeFlyGroup.add(sprite);
        }
        
        let activeIdx = 0;
        this.iceSpikeFlyGroup.getChildren().forEach(sprite => {
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
    _syncFlyingFireball(player) {
        if (!player._fireball || !player._fireball.flyActive) {
            if (this.fireballFlySprite) this.fireballFlySprite.setVisible(false);
            return;
        }
        
        const fb = player._fireball;
        
        if (!this.fireballFlySprite) {
            this.fireballFlySprite = this.add.sprite(0, 0, 'fireball');
            this.fireballFlySprite.setDepth(150);
        }
        
        this.fireballFlySprite.setPosition(fb.flyX, fb.flyY);
        this.fireballFlySprite.setRotation(fb.flyAngle + Math.PI / 2);
        this.fireballFlySprite.setAlpha(0.9);
        this.fireballFlySprite.setDisplaySize(50 * (fb.scale || 1), 50 * (fb.scale || 1));
        
        if (fb.frameIndex !== undefined) {
            try {
                this.fireballFlySprite.setFrame(fb.frameIndex);
            } catch (_e) {
                // 帧索引可能无效，忽略
            }
        }
        
        this.fireballFlySprite.setVisible(true);
    }

    // 统一的特殊动画武器同步（风车/冲刺/复位/特殊攻击）
    // 将 Canvas 变换链转换为世界坐标
    _syncSpecialWeaponAnim(player, wt, _weaponAnim) {
        if (!this.weaponSprite) {
            const texture = getWeaponTextureKey(player.equipments[player.weaponMode]);
            this.weaponSprite = this.add.sprite(0, 0, texture);
            this.weaponSprite.setDepth(150);
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
        console.log('[GameScene] Entity overlap set up');
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
        // 清除玩家 Sprite
        if (this._playerSprite) {
            this._playerSprite.destroy();
            this._playerSprite = null;
        }
        // 清除实体引用
        Game.entities.forEach(entity => {
            if (entity._phaserSprite) {
                entity._phaserSprite.destroy();
                entity._phaserSprite = null;
            }
        });
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
            this.droneSprite.setDepth(160);
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
            this.droneRangeGraphics.strokeCircle(drone.x, drone.y, drone.radius);
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
            this.droneText.setDepth(165);
        }
        this.droneText.setPosition(drone.x, drone.y - 18);
        this.droneText.setText(`${remainingSec}s`);
        this.droneText.setVisible(true);
    }

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
            body.setCircle((enemy.collisionRadius || enemy.size || 20) * 2);
            body.setImmovable(false);
            this.enemies.add(sprite);
            enemy._phaserSprite = sprite;
        } else if (enemy._phaserSprite.texture.key !== texture) {
            // 纹理变化时切换（如黑狼左右/上下精灵图切换）
            enemy._phaserSprite.setTexture(texture);
        }
        return enemy._phaserSprite;
    }
}
