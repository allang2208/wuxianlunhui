import { SoundManager } from '../../ui/sound-manager.js';

import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { SceneManager } from '../../world/scene-manager.js';
import { Camera } from '../../world/camera.js';
import { Input } from '../../ui/input.js';
import { StatusBar } from '../../ui/status-bar.js';
import { DashConvergeEffect } from '../../effects/dash-effects.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { isGunWeapon, isOneHanded, isTwoHanded } from '../../config/gun-ammo.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { CONFIG } from '../../config/config.js';
import { getTributeHpRegenMultiplier, getTributeMpRegenMultiplier, getTributeStaminaRegenMul, getTributeHpRegenFlat } from '../../config/tribute-effects.js';
import { GameUIManager } from '../../ui/game-ui-manager.js';
import { SystemUI } from '../../ui/system-ui.js';
import { BuildingRoadSystem } from '../../world/building-road-system.js';

const updateMixin = {
update(dt, entities) {
                // 每帧先清表现标志，防止死亡、眩晕、施法等提前返回时残留奔跑姿态。
                this._rtsRunVisual = false;
                // 墙顶/楼梯是窄通道：浏览器偶发长帧不能把约100ms一次积分成数十像素瞬移。
                // 计时器仍使用真实dt，仅位置积分限制为最多约两帧。
                const elevatedMoveDt = this._surfaceKind === 'wall_walk'
                    || this._surfaceKind === 'stairs'
                    ? Math.min(dt, 34)
                    : dt;
                if (this.hitFlash > 0) {
                    this.hitFlash = Math.max(0, this.hitFlash - dt);
                }
                this.updateStatusEffects(dt);
                // 伤害型状态效果：中毒/流血由下方玩家专属块处理（data.hp 口径 + 无敌开关）；
                // 基类 _updatePoison/_updateBleed 走 this.hp（敌人字段），玩家再调会双重驱动计时器
                if (typeof this._updateMagicVulnerability === 'function') this._updateMagicVulnerability(dt);
                if (typeof this._updateDroneVulnerability === 'function') this._updateDroneVulnerability(dt);
                // 死亡状态处理
                if (this._isDead) {
                    this._rtsController?.hold?.();
                    this._deathTimer -= dt;
                    if (this._deathTimer <= 0) {
                        // 蟠桃续命：该次地牢一次，3s 后以 30% 最大生命原地复活
                        if (this._peachRevivePending) {
                            this._peachRevivePending = false;
                            this._reviveInPlace();
                        } else {
                            this.respawn();
                        }
                    }
                    return; // 死亡期间不执行任何其他逻辑
                }
                // ===== 眩晕/冻结状态处理 =====
                // 冻结效果等同于眩晕；任一存在即进入控制状态
                if (typeof this._updateFreeze === 'function') this._updateFreeze(dt);
                const stillFrozen = this.hasStatusEffect && this.hasStatusEffect('frozen');
                if (this.isStunned || stillFrozen) {
                    if (this.stunTimer > 0) this.stunTimer -= dt;
                    if (this.stunTimer <= 0 && !stillFrozen) {
                        this.isStunned = false;
                        this.stunTimer = 0;
                        // 从状态栏移除眩晕效果
                        if (this._stunEffectId && StatusBar) {
                            StatusBar.removeEffect(this._stunEffectId);
                            this._stunEffectId = null;
                        }
                    }
                    // 眩晕/冻结期间强制取消防御状态
                    if (this.shieldSystem && this.shieldSystem.defending) {
                        this.shieldSystem.exitDefense();
                    }
                    // 眩晕/冻结期间：无法移动、无法攻击、无法调准朝向、无法释放技能
                    // 更新其他子系统（如武器特效、动画复位等）
                    this._updateSubsystems(dt, entities);
                    return;
                }
                // ===== 施法状态处理（2026-08-02：空手施法 0.5s 前摇 + 0.25s 后摇） =====
                if (this._castState === 'casting' || this._castState === 'recover') {
                    // 施法跨步位移（前摇向前 +30px / 后摇退回，WallSystem 解析防穿墙）
                    this._updateCastStep();
                    // 后摇阶段允许空格翻滚打断（前摇不可打断）
                    if (this._castState === 'recover' && Input.isPressed(CONFIG.KEYS.SPACE)
                        && this.dodgeCooldown <= 0 && this.data.stamina >= CONFIG.STAMINA_DODGE_COST) {
                        this._interruptCastRecover();
                        this.triggerDodge(Input.getMovement());
                    }
                    // 施法/后摇期间：无法移动、无法攻击、无法释放技能/魔法/开枪
                    this.vx = 0;
                    this.vy = 0;
                    this.isMoving = false;
                    this._updateSubsystems(dt, entities);
                    return;
                }
                // ===== 恐惧状态处理 =====
                // 失控：输入全部无效，强制朝恐惧源相反方向移动；移速按层数削减（-33%/层，上限-99%）
                if (this.hasStatusEffect && this.hasStatusEffect('fear')) {
                    const src = this._fearSource;
                    if (src && src.active) {
                        const dx = this.x - src.x, dy = this.y - src.y;
                        const d = Math.hypot(dx, dy) || 1;
                        // 与正常移动同口径：maxSpeed × 恐惧层数倍率
                        const spd = (this.maxSpeed || this.data.speed || 100)
                            * this.getFearSpeedMul()
                            * BuildingRoadSystem.movementMultiplierAt(this.x, this.y);
                        this.vx = (dx / d) * spd;
                        this.vy = (dy / d) * spd;
                        this.isMoving = true;
                    } else {
                        this.vx = 0;
                        this.vy = 0;
                        this.isMoving = false;
                    }
                    // 恐惧期间强制取消防御（与眩晕同口径）
                    if (this.shieldSystem && this.shieldSystem.defending) {
                        this.shieldSystem.exitDefense();
                    }
                    this._updateSubsystems(dt, entities);
                    // 位置积分与墙壁解析（失控移动也要走正常通道，不可穿墙）
                    {
                        const mScale = elevatedMoveDt / 1000;
                        const nx = this.x + this.vx * mScale, ny = this.y + this.vy * mScale;
                        const resolved = WallSystem.resolve(
                            this.x, this.y, nx, ny, this.groundRadius,
                            WallSystem.ignoreForEntity ? WallSystem.ignoreForEntity(this) : null
                        );
                        this.x = resolved.x;
                        this.y = resolved.y;
                    }
                    return;
                }
                // ===== 中毒处理 =====
                if (this._poisonTimer > 0) {
                    this._poisonTimer -= dt;
                    this._poisonTickTimer -= dt;
                    if (this._poisonTickTimer <= 0) {
                        // 无敌开关期间不扣血，计时/层数消耗照常
                        if (!SceneManager._mainHubInvincible) {
                            this.data.hp -= this._poisonStacks;
                            EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${this._poisonStacks}`, '#7a9a5a'));
                            if (this.data.hp <= 0) {
                                this.data.hp = 0;
                                this.onDeath();
                            }
                        }
                        this._poisonTickTimer = 1000;
                    }
                    if (this._poisonTimer <= 0) {
                        this._poisonStacks = Math.max(0, this._poisonStacks - 1);
                        if (this._poisonStacks > 0) {
                            // 还有剩余层数，重新启动计时器
                            this._poisonTimer = 5000;
                            this._poisonTickTimer = 1000; // 重置 tick 计时器
                            if (StatusBar) {
                                // 重置 StatusBar 的 remaining 时间，保持图标显示同步
                                StatusBar.addEffect('poison', 5000, { stacks: this._poisonStacks });
                            }
                        } else {
                            // 全部层数耗尽，完全清除
                            this._poisonTimer = 0;
                            this._poisonTickTimer = 0;
                            if (this._poisonEffectId && StatusBar) {
                                StatusBar.removeEffect(this._poisonEffectId);
                                this._poisonEffectId = null;
                            }
                            // 清除中毒粒子效果
                            if (this._poisonEffect) this._poisonEffect.reset();
                        }
                    }
                }
                // ===== 流血处理（每层每秒 1% 当前生命值，持续 10s，到期减一层） =====
                if (this._bleedStacks > 0) {
                    this._bleedTimer -= dt;
                    this._bleedTickTimer -= dt;
                    if (this._bleedTickTimer <= 0) {
                        // 无敌开关（左下「无敌」按钮）期间不扣血，计时/层数消耗照常
                        if (!SceneManager._mainHubInvincible) {
                            const dmg = Math.max(1, Math.floor(this.data.hp * 0.01 * this._bleedStacks));
                            this.data.hp -= dmg;
                            EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${dmg}`, '#9a3a3a'));
                            if (this.data.hp <= 0) {
                                this.data.hp = 0;
                                this.onDeath();
                            }
                        }
                        // 流血血渍（地图模式下 GameScene 内部拦截不生成）
                        const fxScene = typeof window !== 'undefined' ? window.__phaserScene : null;
                        if (fxScene && typeof fxScene.playBleedGroundParticles === 'function') {
                            fxScene.playBleedGroundParticles(this.x, this.y, this);
                        }
                        this._bleedTickTimer = 1000;
                    }
                    if (this._bleedTimer <= 0) {
                        this._bleedStacks = Math.max(0, this._bleedStacks - 1);
                        if (this._bleedStacks > 0) {
                            this._bleedTimer = 10000;
                            if (this._bleedEffectId && StatusBar) {
                                // 同步重置状态栏计时器（与基类 _updateBleed 同语义：到期只减一层）
                                this._bleedEffectId = StatusBar.addEffect('bleed', 10000, { stacks: this._bleedStacks });
                            }
                        } else {
                            if (this._bleedEffectId && StatusBar) {
                                StatusBar.removeEffect(this._bleedEffectId);
                                this._bleedEffectId = null;
                            }
                        }
                    }
                }
                // 更新中毒粒子效果
                if (this._poisonStacks > 0 && this._poisonEffect) {
                    this._poisonEffect.update(dt, this.x, this.y);
                }
                // ===== 无人机易伤效果更新 =====
                if (this._droneVulnerabilityStacks > 0) {
                    this._droneVulnerabilityTimer -= dt;
                    if (this._droneVulnerabilityTimer <= 0) {
                        this._droneVulnerabilityStacks = Math.max(0, this._droneVulnerabilityStacks - 1);
                        if (this._droneVulnerabilityStacks > 0) {
                            this._droneVulnerabilityTimer = 5000;
                        } else {
                            if (this._droneVulnerabilityEffectId && StatusBar) {
                                StatusBar.removeEffect(this._droneVulnerabilityEffectId);
                                this._droneVulnerabilityEffectId = null;
                            }
                        }
                    }
                }
                // ===== 弹药系统换弹更新 =====
                this._updateReload(dt);
                // 更新弹药显示UI
                this._updateAmmoDisplay();

                const rtsEnabled = !!(typeof window !== 'undefined'
                    && window.Game?.RTSCommand?.enabled
                    && !window.Game?._observerMode);
                const rtsIntent = this._rtsController?.update?.(dt, entities, rtsEnabled) || {
                    move: { x: 0, y: 0 },
                    aimWorld: null,
                    primaryDown: false,
                    primaryPressed: false,
                    runVisual: false,
                };
                const move = rtsEnabled ? rtsIntent.move : Input.getMovement();
                let primaryDown = rtsEnabled ? !!rtsIntent.primaryDown : Input.mouse.leftDown;
                let primaryPressed = rtsEnabled ? !!rtsIntent.primaryPressed : Input.mouse.leftPressed;
                let secondaryDown = rtsEnabled ? false : Input.mouse.rightDown;
                let secondaryPressed = rtsEnabled ? false : Input.mouse.rightPressed;
                const directMouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                const controlAimWorld = rtsEnabled
                    ? (rtsIntent.aimWorld || {
                        x: this.x + Math.cos(this.rotation || 0) * 100,
                        y: this.y + Math.sin(this.rotation || 0) * 100,
                    })
                    : directMouseWorld;
                this._surfaceInputIntent = this.isDodging
                    ? { x: this.dodgeDirection.x, y: this.dodgeDirection.y }
                    : { x: move.x, y: move.y };
                // 无人机操控模式下：禁用玩家移动，但继续更新其他逻辑
                const isDroneControlling = this.droneSystem && this.droneSystem.controlling;
                // 近战攻击期间禁止转向，变量供下方移动/旋转逻辑共享
                let isMeleeAttacking = false;
                if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;
                if (this.weaponSwitchCooldown > 0) this.weaponSwitchCooldown -= dt;
                if (this.isDodging) {
                    // 高架长帧位移已经限幅，翻滚计时也使用同一积分量，
                    // 否则卡顿帧会只消耗时长却不走完距离，表现为突然刹停。
                    this.dodgeTimer -= elevatedMoveDt;
                    if (this.dodgeTimer <= 0) { this._endDodge(); }
                    else {
                        const dScale = elevatedMoveDt / 1000;
                        // 生效速度走 calculateCombatStats 面板（可被装备/道具修饰），缺省回退配置基准
                        const dodgeSpeed = (this.data && this.data.dodgeSpeed) || CONFIG.DODGE_SPEED;
                        const dnx = this.x + this.dodgeDirection.x * dodgeSpeed * 0.33 * dScale, dny = this.y + this.dodgeDirection.y * dodgeSpeed * 0.33 * dScale;
                        const dr = WallSystem.resolve(
                            this.x, this.y, dnx, dny, this.groundRadius,
                            WallSystem.ignoreForEntity ? WallSystem.ignoreForEntity(this) : null
                        );
                        this.x = dr.x; this.y = dr.y;
                        // 主神空间：限制在场景范围内(0,0)-(WORLD_WIDTH,WORLD_HEIGHT)，其他场景保持大范围
                        if (SceneManager && SceneManager.currentScene === 'main') {
                            this.x = Math.max(0, Math.min(CONFIG.WORLD_WIDTH, this.x)); this.y = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT, this.y));
                        } else {
                            this.x = Math.max(-CONFIG.WORLD_WIDTH, Math.min(CONFIG.WORLD_WIDTH * 2, this.x)); this.y = Math.max(-CONFIG.WORLD_HEIGHT, Math.min(CONFIG.WORLD_HEIGHT * 2, this.y));
                        }
                        this.animTime += 0.4;
                    }
                } else if (!isDroneControlling) {
                    let sprint = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse();
                    // 防御状态：禁止奔跑
                    if (this.shieldSystem && this.shieldSystem.defending) sprint = false;
                    // 攻击期间禁止奔跑（平衡调整：单手持枪（含双持手枪）可跑步开火；
                    // 双手枪械（机枪/突击步枪）与近战武器维持开火打断奔跑）
                    const isAttacking = this.weaponAnim && this.weaponAnim.state !== 'idle';
                    if (isAttacking) {
                        const equipForSprint = this.equipments[this.weaponMode];
                        const isGunEquip = equipForSprint && isGunWeapon(equipForSprint);
                        if (!isGunEquip || isTwoHanded(equipForSprint)) sprint = false;
                    }
                    let targetSpeed = sprint ? CONFIG.PLAYER_SPRINT : this.maxSpeed;
                    // 减速状态（致残）：移动速度减半
                    if (this.hasStatusEffect && this.hasStatusEffect('slow')) targetSpeed *= 0.5;
                    // 束缚状态：无法移动
                    if (this.hasStatusEffect && this.hasStatusEffect('bind')) targetSpeed = 0;
                    // 防御状态：移动速度减慢 50%
                    if (this.shieldSystem && this.shieldSystem.defending) targetSpeed *= 0.5;
                    const currentEquip = this.equipments[this.weaponMode];
                    const isPkmEquipped = currentEquip && (currentEquip.weaponType === 'pkm' || currentEquip.weaponType === 'qjb201' || currentEquip.weaponType === 'energy_lmg');
                    const isPistolEquipped = currentEquip && (currentEquip.weaponType === 'pistol' || currentEquip.rangedType === 'pistol');
                    if (isPkmEquipped) {
                        let moveSpeedReduction = 0.50; // Base reduction 50%
                        const craftEffects = currentEquip && currentEquip._craftEffects;
                        if (craftEffects && craftEffects.moveSpeedPercent) {
                            moveSpeedReduction -= craftEffects.moveSpeedPercent;
                        }
                        if (moveSpeedReduction > 0.90) moveSpeedReduction = 0.90;
                        if (moveSpeedReduction < 0) moveSpeedReduction = 0;
                        targetSpeed *= (1 - moveSpeedReduction);
                    }
                    // 改造移速效果：非 PKM 武器通用加成（此前仅 PKM 系生效，Super90 无托/沙鹰短枪管等失效）
                    if (!isPkmEquipped && currentEquip && currentEquip._craftEffects && currentEquip._craftEffects.moveSpeedPercent) {
                        targetSpeed *= (1 + currentEquip._craftEffects.moveSpeedPercent);
                    }
                    // 手枪精通：持有手枪时增加移动速度
                    if (isPistolEquipped && this.skills && this.skills.pistolMastery) {
                        const pm = this.skills.pistolMastery.getEffect(this.skills.pistolMastery.level);
                        targetSpeed *= (1 + pm.speedPercent);
                    }
                    // 加速 buff（命中获得，如 P4040 轻量化快速板机）：按层数叠加移速
                    if (this.hasStatusEffect && this.hasStatusEffect('haste')) {
                        const hasteStacks = this._hasteStacks || 1;
                        const hastePerStack = this._hastePerStackMul || 0.10;
                        targetSpeed *= (1 + hasteStacks * hastePerStack);
                    }
                    // 寒冷 debuff：按层数降低移速（加法叠加最终乘算）
                    if (this.hasStatusEffect && this.hasStatusEffect('chill')) {
                        targetSpeed *= (typeof this.getChillSpeedMul === 'function' ? this.getChillSpeedMul() : 1);
                    }
                    // 道路范围移速 +20%：动态读脚底格，不写回 maxSpeed，离开道路立即恢复。
                    targetSpeed *= BuildingRoadSystem.movementMultiplierAt(this.x, this.y);
                    // 双手枪械开火/瞄准时禁止 Shift 奔跑（开火或右键瞄准即中断奔跑退回 walking，
                    // _isSprinting 解除后姿态回 walk，武器位置同步为 walking 配置）
                    const isTwoHandedGun = isGunWeapon(currentEquip) && isTwoHanded(currentEquip);
                    if (sprint && isTwoHandedGun && (primaryDown || secondaryDown)) {
                        sprint = false;
                        // PKM 系保留原 50% 减速语义，其他双手枪退回普通走速
                        if (isPkmEquipped) {
                            let moveSpeedReduction = 0.50;
                            const craftEffects = currentEquip && currentEquip._craftEffects;
                            if (craftEffects && craftEffects.moveSpeedPercent) {
                                moveSpeedReduction -= craftEffects.moveSpeedPercent;
                            }
                            if (moveSpeedReduction > 0.90) moveSpeedReduction = 0.90;
                            if (moveSpeedReduction < 0) moveSpeedReduction = 0;
                            targetSpeed = this.maxSpeed * (1 - moveSpeedReduction);
                        } else {
                            targetSpeed = this.maxSpeed;
                        }
                    }
                    // 冲刺攻击动画期间：移动速度为0.1px/帧（结束后恢复）
                    if (this._isDashing) targetSpeed = 0.1;
                    // 冲刺末帧定格期：同普通攻击不可移动（输入无效，动画播完前不许动）
                    if (this._dashRecoverAt) targetSpeed = 0;
                    // 风车攻击动画期间：移动速度为0.1px/帧（结束后恢复）
                    if (this._isWhirlwind) targetSpeed = 0.1;
                    // 推击攻击动画期间：移动速度为0.1px/帧（结束后恢复）
                    if (this._isPushStrike) targetSpeed = 0.1;
                    // 特殊攻击动画期间：完全不能移动
                    if (this._specialAttackActive) targetSpeed = 0;

                    // 近战攻击期间：完全禁止移动（但可以用闪避取消）
                    isMeleeAttacking = this.weaponAnim && this.weaponAnim.isAttacking && currentEquip && (currentEquip.category === 'weapon_melee' || currentEquip.weaponType === 'sword');
                    let moveInput = move;
                    if (isMeleeAttacking) {
                        targetSpeed = 0;
                        moveInput = { x: 0, y: 0 };
                    }

                    this.vx += (moveInput.x * targetSpeed - this.vx) * this.accel; this.vy += (moveInput.y * targetSpeed - this.vy) * this.accel;
                    if (moveInput.x === 0) this.vx *= this.friction; if (moveInput.y === 0) this.vy *= this.friction;

                    // ===== Velocity 驱动模式（可选）=====
                    const phaserScene = window.__phaserScene;
                    if (phaserScene && phaserScene._useVelocityDrive && phaserScene.playerSprite && phaserScene.playerSprite.body) {
                        // Velocity 驱动：设置 Phaser 物理体速度，让 Phaser 处理碰撞和位置更新
                        // 注意：闪避时仍使用直接位置设置（见上方闪避逻辑）
                        // 速度系数：100（补偿物理引擎阻力）
                        const speedMultiplier = 100;
                        phaserScene.playerSprite.body.setVelocity(this.vx * speedMultiplier, this.vy * speedMultiplier);
                        // 不再直接设置位置，位置由 Phaser 物理引擎更新
                        // GameScene._syncBodiesToPhysics() 会从 Phaser 同步位置回 Player
                    } else {
                        // 原有模式：直接位置设置 + WallSystem 碰撞解析
                        const mScale = elevatedMoveDt / 1000;
                        const nx = this.x + this.vx * mScale, ny = this.y + this.vy * mScale;
                        const resolved = WallSystem.resolve(
                            this.x, this.y, nx, ny, this.groundRadius,
                            WallSystem.ignoreForEntity ? WallSystem.ignoreForEntity(this) : null
                        );
                        // 墙壁碰撞音效：速度较大且位置被阻挡时
                        if ((Math.abs(this.vx) > 1.5 || Math.abs(this.vy) > 1.5) && (Math.abs(resolved.x - nx) > 1 || Math.abs(resolved.y - ny) > 1)) {
                            // SoundManager.play('wall_hit');
                        }
                        this.x = resolved.x; this.y = resolved.y;
                        // 主神空间：限制在场景范围内(0,0)-(WORLD_WIDTH,WORLD_HEIGHT)，其他场景保持大范围
                        if (SceneManager && SceneManager.currentScene === 'main') {
                            this.x = Math.max(0, Math.min(CONFIG.WORLD_WIDTH, this.x)); this.y = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT, this.y));
                        } else {
                            this.x = Math.max(-CONFIG.WORLD_WIDTH, Math.min(CONFIG.WORLD_WIDTH * 2, this.x)); this.y = Math.max(-CONFIG.WORLD_HEIGHT, Math.min(CONFIG.WORLD_HEIGHT * 2, this.y));
                        }
                    }
                    if (sprint && this.isMoving) { this.data.stamina -= CONFIG.STAMINA_SPRINT_COST * (dt / 1000); if (this.data.stamina < 0) this.data.stamina = 0; }
                    // 闪避：近战攻击期间按空格可取消攻击动画并闪避
                    // 攻击动画锁定（2026-07-27 用户设定）：任何一段攻击动画未播完前一切输入无效——
                    // 闪避不再取消攻击，攻击期间完全不可闪避
                    const _attackLocked = this.weaponAnim && this.weaponAnim.isAttacking;
                    if (!_attackLocked && Input.isPressed(CONFIG.KEYS.SPACE) && this.dodgeCooldown <= 0 && this.data.stamina >= CONFIG.STAMINA_DODGE_COST) {
                        if (this.weaponAnim && this.weaponAnim.isAttacking) this.clearAttackTweens();
                        this.triggerDodge(moveInput);
                    }
                }
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                const aimScreenPos = Renderer.worldToScreen(controlAimWorld.x, controlAimWorld.y);
                const dx = aimScreenPos.x - screenPos.x, dy = aimScreenPos.y - screenPos.y;
                if (isMeleeAttacking) {
                    // 近战攻击期间锁定朝向，动画结束后再恢复跟随鼠标
                } else if (this._isDashing || this._dashRecoverAt || this._dashResetAnim) {
                    // 冲刺/末帧定格/复位期间朝向冻结（武器朝向绑定身体 flipX，不随鼠标移动）
                } else if (this._specialAttackActive) {
                    this.rotation = this._specialAttackLockedAngle;
                } else if (!this._isWhirlwind && !this.isDodging) {
                    this.rotation = Math.atan2(dy, dx);
                    // 根据鼠标方向确定4方向朝向
                    const absDx = Math.abs(dx);
                    const absDy = Math.abs(dy);
                    if (absDx > absDy) {
                        this._facingDir = dx > 0 ? 'right' : 'left';
                    } else {
                        this._facingDir = dy > 0 ? 'down' : 'up';
                    }
                }
                if (isDroneControlling) {
                    this.vx *= this.friction;
                    this.vy *= this.friction;
                }
                this.isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1;
                // 双手枪械开火/瞄准=非奔跑状态（与上方 sprint 中断同口径）：腿部动画回 walking、脚下不出烟尘。
                // 此前只把局部 sprint 置 false（减速生效），_isSprinting 未同步导致腿层仍播 runlegs
                const _thGunEquip = this.equipments[this.weaponMode];
                const _twoHandedGunCombat = !!(_thGunEquip && isGunWeapon(_thGunEquip) && isTwoHanded(_thGunEquip)
                    && (primaryDown || secondaryDown)); // 左键开火或右键瞄准
                const _sprintActive = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse() && !_twoHandedGunCombat;
                this._isSprinting = _sprintActive; // 保存供render使用
                this._rtsRunVisual = !!(rtsEnabled && rtsIntent.runVisual && this.isMoving);
                // ===== 行走/奔跑动画已由 Phaser 处理 =====
                // Phaser 在 GameScene.update() 中自动播放 walk/run/idle 动画
                if (this.isMoving && !this.isDodging) {
                    this.animTime += 0.15;
                }
                const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    const sprint = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse() && !_twoHandedGunCombat;
                    if (speed > 1.0 && sprint) {
                        if (!this.dustTimer) this.dustTimer = 0;
                        this.dustTimer += dt;
                        const interval = sprint ? 70 : 140;
                        if (this.dustTimer >= interval) {
                            this.dustTimer -= interval;
                            // SoundManager.play('step');
                            const offsetX = -this.vx * (dt / 1000) * 1.5 + (Math.random() - 0.5) * 8;
                            const offsetY = -this.vy * (dt / 1000) * 1.5 + (Math.random() - 0.5) * 4;
                            const dInt = sprint ? 1.5 : 0.8;
                            // 烟尘贴合脚部再上移 5px：y-5（原 y+10/y+5/y+0 偏下）
                            EffectFactory.createDustEffect(this.x + offsetX, this.y + offsetY - 5, dInt);
                            // PKM 装备时奔跑额外生成更浓密的烟尘
                            const currentItem = this.equipments[this.weaponMode];
                            if (currentItem && (currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg')) {
                                const pkmDInt = sprint ? 2.2 : 1.2;
                                EffectFactory.createDustEffect(this.x + offsetX * 0.7, this.y + offsetY * 0.7 - 5, pkmDInt);
                            }
                        }
                    } else {
                        this.dustTimer = 0;
                    }
                const isAttacking = this.weaponAnim && this.weaponAnim.state !== 'idle';
                const isSprinting = Input.isSprint() && this.data.stamina > 0 && this.isMoving && this._isFacingMouse();
                // 体力值异常时先复位，防止 NaN 永久阻塞恢复
                if (!isFinite(this.data.stamina) || this.data.stamina < 0) this.data.stamina = 0;
                // 冲刺攻击计时：追踪长按Shift持续时间
                if (isSprinting && !this._isDashing) {
                    this._sprintDuration += dt;
                    // 计算触发时间：基础333ms，每级减少3%
                    const activeDashSkill = this._getActiveDashSkillId();
                    const dashLevel = (this.skills && this.skills[activeDashSkill] && this.skills[activeDashSkill].level) || 1;
                    const triggerTime = 333 * (1 - (dashLevel - 1) * 0.03);
                    // 冲刺攻击可发动条件检查（与下方dash触发保持同步）
                    const currentWeapon = this.equipments[this.weaponMode];
                    const isWeaponEquipped = currentWeapon && currentWeapon.name;
                    const isMelee = isWeaponEquipped && currentWeapon.category === 'weapon_melee';
                    const dashReady = isMelee && this._sprintDuration >= triggerTime && !this._isDashing && this.skills && this.skills[activeDashSkill];
                    // 单次触发金光汇聚特效，触发后激活跟随光环
                    if (dashReady) {
                        if (!this._dashConvergeShown) {
                            // 首次触发：播放汇聚特效一次，并激活跟随光环
                            this._dashConvergeShown = true;
                            EffectManager.add(new DashConvergeEffect(this.x, this.y, this));
                            this._dashConvergeAuraActive = true;
                        }
                    }
                } else if (!Input.isSprint()) {
                    // 仅当Shift松开时重置计数，方向切换不重置
                    this._sprintDuration = 0;
                    this._dashConvergeShown = false;
                    this._dashConvergeAuraActive = false;
                }
                if (!this.isDodging && !isAttacking && !isSprinting && !(this.shieldSystem && this.shieldSystem.defending) && this.data.stamina < this.data.maxStamina) {
                    this.staminaRegenDelay -= dt;
                    if (this.staminaRegenDelay <= 0) {
                        let mul = this._staminaRegenMul;
                        if (!isFinite(mul) || mul < 0) mul = 1.0;
                        // 祭品效果（数据驱动）：体力恢复加成
                        mul *= getTributeStaminaRegenMul();
                        if (!isFinite(this.data.stamina) || this.data.stamina < 0) this.data.stamina = 0;
                        this.data.stamina += CONFIG.STAMINA_REGEN * (dt / 1000) * mul;
                        if (this.data.stamina > this.data.maxStamina) this.data.stamina = this.data.maxStamina;
                    }
                } else {
                    this.staminaRegenDelay = 500;
                }
                // ===== 生命回复 =====
                if (this.data.hp < this.data.maxHp) {
                    let regen = this.data.hpRegen;
                    // 祭品效果（数据驱动）：固定恢复加值（麦穗 hpRegenFlat）
                    regen += getTributeHpRegenFlat();
                    // 祭品效果（数据驱动）：生命恢复百分比加成
                    regen *= getTributeHpRegenMultiplier();
                    this.data.hp = Math.min(this.data.maxHp, this.data.hp + regen * (dt / 1000));
                }
                // 祭品效果：大理石 - 击杀后1秒内恢复5%最大生命值
                if (this._marbleHealTimer > 0) {
                    this._marbleHealTimer -= dt;
                    const healPerTick = this._marbleHealTotal / (1000 / 16.67);
                    this.data.hp = Math.min(this.data.maxHp, this.data.hp + healPerTick * (dt / 16.67));
                    if (this._marbleHealTimer <= 0) {
                        this._marbleHealTimer = 0;
                        if (this._marbleHealEffectId && StatusBar) {
                            StatusBar.removeEffect(this._marbleHealEffectId);
                            this._marbleHealEffectId = null;
                        }
                    }
                }
                // 祭品效果（数据驱动）：千年人参 - 击杀后1秒内回复最大魔法值
                if (this._ginsengHealTimer > 0) {
                    this._ginsengHealTimer -= dt;
                    const mpHealPerTick = this._ginsengHealTotal / (1000 / 16.67);
                    this.data.mp = Math.min(this.data.maxMp, this.data.mp + mpHealPerTick * (dt / 16.67));
                    if (this._ginsengHealTimer <= 0) {
                        this._ginsengHealTimer = 0;
                        if (this._ginsengHealEffectId && StatusBar) {
                            StatusBar.removeEffect(this._ginsengHealEffectId);
                            this._ginsengHealEffectId = null;
                        }
                    }
                }
                // 月影庇护无敌计时
                if (this._moonshadowTimer > 0) {
                    this._moonshadowTimer = Math.max(0, this._moonshadowTimer - dt);
                }
                // ===== 魔法回复 =====
                if (this.data.mp < this.data.maxMp) {
                    // 祭品效果（数据驱动）：魔法恢复百分比加成
                    this.data.mp = Math.min(this.data.maxMp, this.data.mp + this.data.mpRegen * getTributeMpRegenMultiplier() * (dt / 1000));
                }
                Object.values(this.attacks).forEach(a => a.update(dt));
                // ===== 枪类武器弹道扩散计时更新（主副手独立） =====
                const _currentWep2 = this.equipments[this.weaponMode];
                const _isGun = _currentWep2 && isGunWeapon(_currentWep2);
                // 双持判断
                const _offSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const _offItem = this.equipments[_offSlot];
                const _isDual = _offItem && _offItem.name && !_offItem.isTwoHanded;
                // 主手散布计时：左键按下时主手武器累计散布
                if (_isGun && primaryDown) {
                    this._gunSpreadTimer += dt;
                    this._gunSpreadWeapon = _currentWep2.weaponType;
                } else {
                    this._gunSpreadTimer = Math.max(0, this._gunSpreadTimer - dt * 2);
                    if (this._gunSpreadTimer <= 0) this._gunSpreadWeapon = null;
                }
                // 副手散布计时：双持时右键按下且副手为枪械时累计散布
                const _offIsGun = _offItem && isGunWeapon(_offItem);
                if (_isDual && _offIsGun && secondaryDown) {
                    this._gunSpreadTimerOff += dt;
                    this._gunSpreadWeaponOff = _offItem.weaponType;
                } else {
                    this._gunSpreadTimerOff = Math.max(0, this._gunSpreadTimerOff - dt * 2);
                    if (this._gunSpreadTimerOff <= 0) this._gunSpreadWeaponOff = null;
                }
                // 准星单发 kick 衰减（recoilRecoveryDelta 改造：恢复时间毫秒增减，下限 20ms）
                if (this._crosshairShotKick > 0) {
                    const craftEffects = _currentWep2 && _currentWep2._craftEffects;
                    const _kickDecayMs = Math.max(20, 80 + ((craftEffects && craftEffects.recoilRecoveryDelta) || 0));
                    this._crosshairShotKick = Math.max(0, this._crosshairShotKick - dt / _kickDecayMs);
                }
                // 预计算主手散布因子（供准星显示与主手开火使用）
                if (_isGun) {
                    const wt = _currentWep2.weaponType;
                    const craftEffects = _currentWep2 && _currentWep2._craftEffects;
                    // 独头弹模式：特殊散布系统（后坐力层数控制）
                    if (wt === 'shotgun' && craftEffects && craftEffects.slugMode) {
                        this._currentSpreadFactor = 1;
                        this._currentSpreadMaxAngle = this._slugRecoilLayers * 5 + (craftEffects.maxSpreadAngleDelta || 0);
                        if (this._currentSpreadMaxAngle < 0) this._currentSpreadMaxAngle = 0;
                    } else {
                        // 普通枪械散布系统
                        let spreadStartDelay = 500; // 默认：0.5秒后开始散布
                        let spreadMaxTime = 4000;
                        let maxSpreadAngle = 25;
                        // 武器特异化散布参数（全自动板机 spreadParamsOverride 整体覆盖优先，其次武器配置）
                        const sp = (craftEffects && craftEffects.spreadParamsOverride) || _currentWep2.spreadParams;
                        if (sp) {
                            if (sp.startDelay !== undefined) spreadStartDelay = sp.startDelay;
                            if (sp.maxTime !== undefined) spreadMaxTime = sp.maxTime;
                            if (sp.maxAngle !== undefined) maxSpreadAngle = sp.maxAngle;
                        }
                        // 能量机枪：动态散布参数覆盖
                        if (wt === 'energy_lmg') {
                            const elp = this._getEnergyLMGParams();
                            spreadMaxTime = elp.spreadMaxTime;
                            maxSpreadAngle = elp.maxSpreadAngle;
                        }
                        // 瞄准模式：散布开始延迟 +1s
                        if (this._aimModeActive) {
                            spreadStartDelay += 1000;
                        }
                        // 应用改造效果
                        if (craftEffects) {
                            spreadStartDelay += craftEffects.spreadStartDelta || 0;
                            if (spreadStartDelay < 0) spreadStartDelay = 0;
                            spreadMaxTime += craftEffects.spreadTimeDelta || 0;
                            if (spreadMaxTime < 500) spreadMaxTime = 500;
                            maxSpreadAngle += craftEffects.maxSpreadAngleDelta || 0;
                            // 全自动专属增量（枪口/枪管改造附带，仅全自动板机改造后生效）
                            if (craftEffects.fireModeOverride === 'fullAuto') {
                                spreadStartDelay += craftEffects.autoSpreadStartDelta || 0;
                                if (spreadStartDelay < 0) spreadStartDelay = 0;
                                spreadMaxTime += craftEffects.autoSpreadTimeDelta || 0;
                                if (spreadMaxTime < 500) spreadMaxTime = 500;
                                maxSpreadAngle += craftEffects.autoMaxSpreadAngleDelta || 0;
                            }
                            // 移动/静止散布倍率（两脚架/无托平衡等改造）：按移动状态对最大散布角乘算——
                            // combatant.js 的 _computeSpreadForWeapon 含此逻辑但 _updateSpreadTimers 无调用者，
                            // 玩家实际散布在此计算，必须在此消费（2026-08-11 修复）
                            const spreadMoveMul = craftEffects.moveSpreadPercent || 0;
                            const spreadStaticMul = craftEffects.stationarySpreadPercent || 0;
                            maxSpreadAngle *= Math.max(0.1, this.isMoving ? (1 + spreadMoveMul) : (1 + spreadStaticMul));
                        }
                        this._currentSpreadFactor = (spreadMaxTime <= 0)
                            ? (this._gunSpreadTimer > spreadStartDelay ? 1 : 0)
                            : Math.min(1, Math.max(0, this._gunSpreadTimer - spreadStartDelay) / spreadMaxTime);
                        this._currentSpreadMaxAngle = maxSpreadAngle;
                    }
                } else {
                    this._currentSpreadFactor = 0;
                    this._currentSpreadMaxAngle = 0;
                }
                // 预计算副手散布因子（供副手开火使用）
                if (_offIsGun) {
                    const offWt = _offItem.weaponType;
                    const offCraftEffects = _offItem && _offItem._craftEffects;
                    if (offWt === 'shotgun' && offCraftEffects && offCraftEffects.slugMode) {
                        this._currentSpreadFactorOff = 1;
                        this._currentSpreadMaxAngleOff = this._slugRecoilLayers * 5 + (offCraftEffects.maxSpreadAngleDelta || 0);
                        if (this._currentSpreadMaxAngleOff < 0) this._currentSpreadMaxAngleOff = 0;
                    } else {
                        let offSpreadStartDelay = 500;
                        let offSpreadMaxTime = 4000;
                        let offMaxSpreadAngle = 25;
                        const offSp = (offCraftEffects && offCraftEffects.spreadParamsOverride) || _offItem.spreadParams;
                        if (offSp) {
                            if (offSp.startDelay !== undefined) offSpreadStartDelay = offSp.startDelay;
                            if (offSp.maxTime !== undefined) offSpreadMaxTime = offSp.maxTime;
                            if (offSp.maxAngle !== undefined) offMaxSpreadAngle = offSp.maxAngle;
                        }
                        if (offWt === 'energy_lmg') {
                            const offElp = this._getEnergyLMGParams(); // 能量轻机枪参数从主手装备读取（Player 只持一把能量轻机枪）
                            offSpreadMaxTime = offElp.spreadMaxTime;
                            offMaxSpreadAngle = offElp.maxSpreadAngle;
                        }
                        if (this._aimModeActive) {
                            offSpreadStartDelay += 1000;
                        }
                        if (offCraftEffects) {
                            offSpreadStartDelay += offCraftEffects.spreadStartDelta || 0;
                            if (offSpreadStartDelay < 0) offSpreadStartDelay = 0;
                            offSpreadMaxTime += offCraftEffects.spreadTimeDelta || 0;
                            if (offSpreadMaxTime < 500) offSpreadMaxTime = 500;
                            offMaxSpreadAngle += offCraftEffects.maxSpreadAngleDelta || 0;
                            // 全自动专属增量（仅全自动板机改造后生效，与主手同口径）
                            if (offCraftEffects.fireModeOverride === 'fullAuto') {
                                offSpreadStartDelay += offCraftEffects.autoSpreadStartDelta || 0;
                                if (offSpreadStartDelay < 0) offSpreadStartDelay = 0;
                                offSpreadMaxTime += offCraftEffects.autoSpreadTimeDelta || 0;
                                if (offSpreadMaxTime < 500) offSpreadMaxTime = 500;
                                offMaxSpreadAngle += offCraftEffects.autoMaxSpreadAngleDelta || 0;
                            }
                            // 副手同口径：移动/静止散布倍率
                            const offSpreadMoveMul = offCraftEffects.moveSpreadPercent || 0;
                            const offSpreadStaticMul = offCraftEffects.stationarySpreadPercent || 0;
                            offMaxSpreadAngle *= Math.max(0.1, this.isMoving ? (1 + offSpreadMoveMul) : (1 + offSpreadStaticMul));
                        }
                        this._currentSpreadFactorOff = (offSpreadMaxTime <= 0)
                            ? (this._gunSpreadTimerOff > offSpreadStartDelay ? 1 : 0)
                            : Math.min(1, Math.max(0, this._gunSpreadTimerOff - offSpreadStartDelay) / offSpreadMaxTime);
                        this._currentSpreadMaxAngleOff = offMaxSpreadAngle;
                    }
                } else {
                    this._currentSpreadFactorOff = 0;
                    this._currentSpreadMaxAngleOff = 0;
                }
                // ===== 独头弹后坐力恢复系统 =====
                if (_currentWep2 && _currentWep2.weaponType === 'shotgun') {
                    const ce = _currentWep2._craftEffects;
                    if (ce && ce.slugMode) {
                        if (primaryDown) {
                            // 射击时：重置恢复计时器
                            this._slugRecoilTimer = 0;
                        } else {
                            // 停止射击：开始恢复
                            this._slugRecoilTimer += dt;
                            const baseRecovery = 500; // 默认后坐力恢复时间 500ms
                            const recovery = Math.max(100, baseRecovery + (ce.slugRecoilRecovery || 0));
                            if (this._slugRecoilTimer >= recovery) {
                                // 达到恢复时间后，所有层数一次性清零
                                this._slugRecoilLayers = 0;
                                this._slugRecoilTimer = 0;
                            }
                        }
                    } else {
                        this._slugRecoilLayers = 0;
                        this._slugRecoilTimer = 0;
                    }
                }
                // ===== 机枪类武器过热系统更新（PKM、QJB-201、能量轻机枪） =====
                if (_currentWep2 && (_currentWep2.weaponType === 'pkm' || _currentWep2.weaponType === 'qjb201' || _currentWep2.weaponType === 'energy_lmg')) {
                    this._overheatWeaponType = _currentWep2.weaponType;
                    const ce = _currentWep2._craftEffects;
                    const ohDelta = (ce && ce.overheatTimeDelta) || 0;
                    const ohRecDelta = (ce && ce.overheatRecoverDelta) || 0;
                    const elp = _currentWep2.weaponType === 'energy_lmg' ? this._getEnergyLMGParams() : null;
                    const hp = _currentWep2.heatParams || {};
                    if (this._overheatOverheated) {
                        // 过热恢复中
                        this._overheatRecoverTimer -= dt;
                        let recoverTime = _currentWep2.weaponType === 'energy_lmg'
                            ? (elp ? elp.overheatRecoverTime : 2500)
                            : (hp.overheatRecoverTime || 1500);
                        if (_currentWep2.weaponType === 'energy_lmg') recoverTime += ohRecDelta;
                        const ohPct = _currentWep2._craftEffects && _currentWep2._craftEffects.overheatRecoverPercent;
                        if (ohPct) recoverTime = recoverTime * (1 + ohPct);
                        if (recoverTime < 500) recoverTime = 500; // 最小0.5秒
                        this._lastOverheatRecoverMs = recoverTime;
                        this._overheatValue = Math.max(0, this._overheatValue - (dt / recoverTime));
                        if (this._overheatRecoverTimer <= 0 || this._overheatValue <= 0) {
                            this._overheatOverheated = false;
                            this._overheatRecoverTimer = 0;
                            this._overheatValue = 0;
                            this._overheatActive = false;
                        }
                    } else if (primaryDown && !this._isReloading(this.weaponMode)) {
                        // 持续开火
                        this._overheatActive = true;
                        let overheatTime = _currentWep2.weaponType === 'energy_lmg'
                            ? (elp ? elp.overheatTime : 4000)
                            : (hp.overheatTime || 5000);
                        if (_currentWep2.weaponType === 'energy_lmg') overheatTime += ohDelta;
                        if (overheatTime < 1000) overheatTime = 1000; // 最小1秒
                        this._overheatValue = Math.min(1, this._overheatValue + (dt / overheatTime));
                        if (this._overheatValue >= 1) {
                            this._overheatOverheated = true;
                            let recoverTimer = _currentWep2.weaponType === 'energy_lmg'
                                ? (elp ? elp.overheatCooldownTime : 4000)
                                : (hp.overheatCooldownTime || 1500);
                            if (_currentWep2.weaponType === 'energy_lmg') recoverTimer += ohRecDelta;
                            const ohPct2 = _currentWep2._craftEffects && _currentWep2._craftEffects.overheatRecoverPercent;
                            if (ohPct2) recoverTimer = recoverTimer * (1 + ohPct2);
                            if (recoverTimer < 500) recoverTimer = 500;
                            this._overheatRecoverTimer = recoverTimer;
                            // 过热音效
                            if (SoundManager) {
                                // 配置驱动：heatParams.overheatSound 优先（新机枪可配置专属过热音），
                                // 缺失回退现有类型硬编码（2026-08-08 去硬编码）
                                if (hp.overheatSound) {
                                    SoundManager.playFile(hp.overheatSound);
                                } else if (_currentWep2.weaponType === 'energy_lmg') {
                                    SoundManager.playFile('assets/sounds/weapons/pkm_ammo_steam_mixed.wav');
                                    SoundManager.playFile('assets/sounds/weapons/apex_reload_4s_raw.mp3');
                                } else {
                                    SoundManager.playFile('assets/sounds/weapons/pkm_ammo_steam_mixed.wav');
                                }
                            }
                        }
                    } else {
                        // 停止开火
                        let recoverTime = _currentWep2.weaponType === 'energy_lmg'
                            ? (elp ? elp.overheatCooldownTime : 4000)
                            : (hp.overheatCooldownTime || 1500);
                        if (_currentWep2.weaponType === 'energy_lmg') recoverTime += ohRecDelta;
                        if (recoverTime < 500) recoverTime = 500;
                        this._lastOverheatCoolMs = recoverTime;
                        this._overheatValue = Math.max(0, this._overheatValue - (dt / recoverTime));
                        if (this._overheatValue <= 0) {
                            this._overheatActive = false;
                        }
                    }
                } else {
                    // 非机枪武器：隐藏过热条，但保留过热/锁定状态（防止切换武器绕过冷却）。
                    // 冷却计时与降温在离手期间继续推进（时间驱动），切回机枪后按剩余计时生效。
                    this._overheatActive = false;
                    if (this._overheatOverheated) {
                        this._overheatRecoverTimer -= dt;
                        if (this._overheatRecoverTimer <= 0) {
                            this._overheatOverheated = false;
                            this._overheatRecoverTimer = 0;
                            this._overheatValue = 0;
                        }
                    } else if (this._overheatValue > 0) {
                        // 部分过热值按该机枪的冷却速率继续降温（默认 1500ms 满值排空）
                        this._overheatValue = Math.max(0, this._overheatValue - dt / (this._lastOverheatCoolMs || 1500));
                    }
                }
                this.updateWeaponAnim(dt);
                this._updateSubsystems(dt, entities);
                const mouseWorld = controlAimWorld;
                // 左键拾取地面物品已取消 — 现在仅在鼠标悬停触发金色特效时自动拾取
                // （逻辑移至 Game.update() 的悬停检测中）
                if (!this.isDodging && !this._isDashing && !this._isWhirlwind && !this._isPushStrike && !this._specialAttackActive && !this._isDead) {
                    // ===== 盾防御状态管理 =====
                    // 规则（长期）：主手手枪+副手持盾 → 右键只触发盾格挡，无法进入瞄准；
                    // 主手非手枪枪械 → 右键优先瞄准，不进入盾防御；近战/空手照旧盾防御
                    const _mainItemShield = this.equipments[this.weaponMode];
                    const _isMainPistolGun = _mainItemShield && (_mainItemShield.weaponType === 'pistol' || _mainItemShield.rangedType === 'pistol');
                    const _isMainNonPistolGun = _mainItemShield && isGunWeapon(_mainItemShield) && !_isMainPistolGun;
                    if (_isMainNonPistolGun && this.shieldSystem && this.shieldSystem.defending) {
                        this.shieldSystem.exitDefense();
                    }
                    if (this.shieldSystem && this.shieldSystem.checkEquipped() && !_isMainNonPistolGun) {
                        if (secondaryDown) {
                            if (!this.shieldSystem.defending) {
                                this.shieldSystem.enterDefense();
                            }
                        } else {
                            if (this.shieldSystem.defending) {
                                this.shieldSystem.exitDefense();
                            }
                        }
                    }
                    // 游戏开始冷却：防止点击"开始游戏"按钮的鼠标事件携带到游戏中导致自动攻击
                    if (this.gameStartCooldown > 0) {
                        this.gameStartCooldown -= dt;
                        if (this.gameStartCooldown > 0) {
                            Input.mouse.leftPressed = false;
                            Input.mouse.leftDown = false;
                            primaryPressed = false;
                            primaryDown = false;
                        }
                    }
                    // 防御状态下：跳过所有攻击输入处理（手枪+盾时允许手枪攻击）
                    const _mainItem = this.equipments[this.weaponMode];
                    const _isMainPistol = _mainItem && (_mainItem.weaponType === 'pistol' || _mainItem.rangedType === 'pistol');
                    if (this.shieldSystem && this.shieldSystem.defending && !_isMainPistol) {
                        return;
                    }
                    // === 攻击输入处理 ===
                    // BUG FIX：装备面板打开时，完全禁止攻击输入
                    // 防止用户在面板中装备武器时，因之前按住左键导致自动攻击
                    if (SystemUI.isOpen) {
                        Input.mouse.leftPressed = false;
                        primaryPressed = false;
                        // 注意：不重置 leftDown，避免面板关闭后立即攻击
                        return;
                    }
                    // 游戏开始冷却期间禁止攻击
                    if (this.gameStartCooldown > 0) {
                        Input.mouse.leftPressed = false;
                        Input.mouse.leftDown = false;
                        primaryPressed = false;
                        primaryDown = false;
                        return;
                    }
                    // 新设计：根据当前武器栏的实际装备类型决定攻击方式
                    const currentSlot = this.weaponMode; // 'weapon' or 'weapon2'
                    let currentItem = this.equipments[currentSlot];
                    let isWeaponEquipped = currentItem && currentItem.name;
                    const _offhandSlot = currentSlot === 'weapon' ? 'offhand' : 'ring2';
                    const _offhandItem = this.equipments[_offhandSlot];
                    // 自动切换：主武器槽为空时，将副武器切换到主武器槽
                    if (!isWeaponEquipped && _offhandItem && _offhandItem.name) {
                        this.equipments[currentSlot] = _offhandItem;
                        this.equipments[_offhandSlot] = null;
                        this._initAmmoForSlot(currentSlot);
                        this._initAmmoForSlot(_offhandSlot);
                        if (GameUIManager) {
                            GameUIManager.updateEquipmentUI();
                        }
                        // 重新获取当前武器状态
                        currentItem = this.equipments[currentSlot];
                        isWeaponEquipped = currentItem && currentItem.name;
                    }
                    const useOffhand = !isWeaponEquipped && _offhandItem && _offhandItem.name;
                    const effectiveItem = useOffhand ? _offhandItem : currentItem;
                    const effectiveSlot = useOffhand ? _offhandSlot : currentSlot;
                    // ===== 边境长弓蓄力攻击逻辑 =====
                    const isBorderBow = effectiveItem && effectiveItem.chargeAttack;
                    if (isBorderBow) {
                        if (primaryDown) {
                            if (this._chargeState === 'idle') {
                                this._chargeState = 'charging';
                                this._chargeTimer = 0;
                            } else if (this._chargeState === 'charging') {
                                this._chargeTimer += dt;
                                if (this._chargeTimer >= 1500) {
                                    this._chargeState = 'charged';
                                    this._chargeFlashActive = true;
                                    this._chargeFlashTimer = 500;
                                }
                            }
                        } else {
                            if (this._chargeState === 'charging') {
                                this._chargeState = 'idle';
                                this._chargeTimer = 0;
                            } else if (this._chargeState === 'charged') {
                                this._chargeState = 'idle';
                                this._chargeTimer = 0;
                                const atk = this.attacks.ranged;
                                if (atk.canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                    if (Input.isSprint() && this.data.stamina > 0) this._sprintDuration = 0;
                                    this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                                    atk.cooldown = atk.maxCooldown;
                                    this.triggerWeaponAnim();
                                }
                            }
                        }
                        // 更新闪光计时器
                        if (this._chargeFlashActive) {
                            this._chargeFlashTimer -= dt;
                            if (this._chargeFlashTimer <= 0) {
                                this._chargeFlashActive = false;
                                this._chargeFlashTimer = 0;
                            }
                        }
                        // 边境长弓消费掉 leftPressed，防止进入下方的点击攻击逻辑
                        if (primaryPressed) {
                            Input.mouse.leftPressed = false;
                            primaryPressed = false;
                        }
                    }
                    // 判断当前有效武器的类型
                    const isPistol = effectiveItem && (effectiveItem.weaponType === 'pistol' || effectiveItem.rangedType === 'pistol');
                    const isBow = effectiveItem && effectiveItem.weaponType === 'bow';
                    const isPkm = effectiveItem && (effectiveItem.weaponType === 'pkm' || effectiveItem.weaponType === 'akm' || effectiveItem.weaponType === 'm416' || effectiveItem.weaponType === 'qbz191' || effectiveItem.weaponType === 'qjb201' || effectiveItem.weaponType === 'energy_lmg');
                    const isShotgun = effectiveItem && effectiveItem.weaponType === 'shotgun';
                    const isMelee = effectiveItem && (effectiveItem.category === 'weapon_melee' || effectiveItem.weaponType === 'sword');
                    const isGun = effectiveItem && isGunWeapon(effectiveItem);
                    
                    // ===== 计算副手状态（用于双持判断） =====
                    const offhandSlot = currentSlot === 'weapon' ? 'offhand' : 'ring2';
                    const offhandItem = this.equipments[offhandSlot];
                    const isDualWield = offhandItem && offhandItem.name && !offhandItem.isTwoHanded;

                    // ===== 瞄准模式：所有枪械都可以进行瞄准（双持手枪除外） =====
                    if (isGun && secondaryDown && !(isPistol && isDualWield)) {
                        this._aimModeActive = true;
                        const craftEffects = effectiveItem && effectiveItem._craftEffects;
                        const scopeType = craftEffects && (craftEffects.highPowerScope ? '3x' : (craftEffects.redDotScope ? '1x' : null));
                        // 镜头向鼠标方向移动：所有枪械都有偏移效果，有瞄具时距离更大
                        const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                        const dx = mouseWorld.x - this.x;
                        const dy = mouseWorld.y - this.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const angle = Math.atan2(dy, dx);
                        const BASE_AIM_OFFSET = 100; // 无瞄具基础偏移距离
                        let maxDist;
                        if (scopeType === '3x') {
                            maxDist = 900;
                        } else if (scopeType === '1x') {
                            maxDist = 300;
                        } else {
                            // 无瞄具：基础距离 × 1
                            maxDist = BASE_AIM_OFFSET * 1;
                        }
                        const offsetDist = Math.min(dist, maxDist);
                        Camera.aimOffsetX = Math.cos(angle) * offsetDist;
                        Camera.aimOffsetY = Math.sin(angle) * offsetDist;
                    } else {
                        this._aimModeActive = false;
                        Camera.aimOffsetX = 0;
                        Camera.aimOffsetY = 0;
                    }

                    if (isPistol) {
                        // 手枪射击：根据左右键分别控制主副手
                        const attackKey = effectiveItem.attackKey || 'pistol';
                        const offhandAttackKey = offhandItem && offhandItem.offhandAttackKey || 'pistolOffhand';
                        // 检查弹药和换弹状态
                        const mainHasAmmo = this._hasAmmo(effectiveSlot);
                        const mainReloading = this._isReloading(effectiveSlot);
                        const offhandHasAmmo = isDualWield ? this._hasAmmo(offhandSlot) : false;
                        const offhandReloading = isDualWield ? this._isReloading(offhandSlot) : false;
                        // 根据 fireMode 选择触发器：semiAuto = 单击射击，fullAuto = 按住持续射击
                        // （全自动板机改造 fireModeOverride 优先于武器固有 fireMode）
                        const mainFireMode = (effectiveItem._craftEffects && effectiveItem._craftEffects.fireModeOverride) || effectiveItem.fireMode || 'fullAuto';
                        const mainFireTrigger = mainFireMode === 'semiAuto' ? primaryPressed : primaryDown;
                        // 左键：主手射击
                        if (mainHasAmmo && !mainReloading && this.weaponSwitchCooldown <= 0 && mainFireTrigger && this.attacks[attackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                            this.attacks[attackKey].cooldown = this.attacks[attackKey].maxCooldown;
                            this.triggerWeaponAnim();
                            // 半自动武器：消费掉点击事件，防止持续射击
                            if (mainFireMode === 'semiAuto') {
                                Input.mouse.leftPressed = false;
                                primaryPressed = false;
                                // 爆发板机（craft burstMode=N）：一次扳机 N 连发，首发后按 60ms 间隔排队
                                const _burstN = (effectiveItem._craftEffects && effectiveItem._craftEffects.burstMode) || 0;
                                if (_burstN > 1) {
                                    this._burstLeft = _burstN - 1;
                                    this._burstDelay = 60;
                                    this._burstSlot = effectiveSlot;
                                    this._burstAttackKey = attackKey;
                                    this.attacks[attackKey].cooldown = 60; // 爆发内小间隔，末发后恢复标准冷却
                                }
                            }
                        }
                        // 爆发板机连发处理：排队弹按 60ms 间隔射出；弹药/体力不足立即中断
                        if (this._burstLeft > 0) {
                            this._burstDelay -= dt;
                            if (this._burstDelay <= 0) {
                                const bk = this._burstAttackKey || 'pistol';
                                const bHasAmmo = this._hasAmmo(this._burstSlot);
                                const bReloading = this._isReloading(this._burstSlot);
                                if (bHasAmmo && !bReloading && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                    this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: this._burstSlot, fireMainHand: true };
                                    this.triggerWeaponAnim();
                                    this._burstLeft--;
                                    this._burstDelay = 60;
                                    this.attacks[bk].cooldown = this._burstLeft > 0 ? 60 : this.attacks[bk].maxCooldown;
                                } else {
                                    this._burstLeft = 0;
                                    this.attacks[bk].cooldown = this.attacks[bk].maxCooldown;
                                }
                            }
                        }
                        // 右键：副手射击（双持时）
                        const offhandFireMode = (offhandItem && offhandItem._craftEffects && offhandItem._craftEffects.fireModeOverride) || (offhandItem && offhandItem.fireMode) || 'fullAuto';
                        const offhandFireTrigger = offhandFireMode === 'semiAuto' ? secondaryPressed : secondaryDown;
                        if (isDualWield && offhandHasAmmo && !offhandReloading && this.weaponSwitchCooldown <= 0 && offhandFireTrigger && this.attacks[offhandAttackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, offhandSlot: offhandSlot, fireOffhand: true };
                            this.attacks[offhandAttackKey].cooldown = this.attacks[offhandAttackKey].maxCooldown;
                            this.triggerOffhandWeaponAnim();
                            // 半自动副手：消费掉点击事件
                            if (offhandFireMode === 'semiAuto') {
                                Input.mouse.rightPressed = false;
                                secondaryPressed = false;
                                // 爆发板机（craft burstMode=N）：副手同样生效——一次扳机 N 连发，60ms 间隔排队
                                const _burstNOff = (offhandItem && offhandItem._craftEffects && offhandItem._craftEffects.burstMode) || 0;
                                if (_burstNOff > 1) {
                                    this._burstLeftOff = _burstNOff - 1;
                                    this._burstDelayOff = 60;
                                    this._burstSlotOff = offhandSlot;
                                    this._burstAttackKeyOff = offhandAttackKey;
                                    this.attacks[offhandAttackKey].cooldown = 60; // 爆发内小间隔，末发后恢复标准冷却
                                }
                            }
                        }
                        // 副手爆发板机连发处理（与主手同口径）：排队弹按 60ms 间隔射出，弹药/体力不足中断
                        if (this._burstLeftOff > 0) {
                            this._burstDelayOff -= dt;
                            if (this._burstDelayOff <= 0) {
                                const bkOff = this._burstAttackKeyOff || 'pistolOffhand';
                                const bHasAmmoOff = this._hasAmmo(this._burstSlotOff);
                                const bReloadingOff = this._isReloading(this._burstSlotOff);
                                if (bHasAmmoOff && !bReloadingOff && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                    this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, offhandSlot: this._burstSlotOff, fireOffhand: true };
                                    this.triggerOffhandWeaponAnim();
                                    this._burstLeftOff--;
                                    this._burstDelayOff = 60;
                                    this.attacks[bkOff].cooldown = this._burstLeftOff > 0 ? 60 : this.attacks[bkOff].maxCooldown;
                                } else {
                                    this._burstLeftOff = 0;
                                    this.attacks[bkOff].cooldown = this.attacks[bkOff].maxCooldown;
                                }
                            }
                        }
                    } else if (isPkm) {
                        // PKM / AKM / 191 / 201 / 能量轻机枪 全自动模式：按住 leftDown 持续射击
                        const isEnergyLMG = effectiveItem.weaponType === 'energy_lmg';
                        const attackKey = effectiveItem.weaponType === 'pkm' ? 'pkm' : (effectiveItem.weaponType === 'akm' ? 'akm' : (effectiveItem.weaponType === 'qbz191' ? 'qbz191' : (effectiveItem.weaponType === 'qjb201' ? 'qjb201' : (effectiveItem.weaponType === 'm416' ? 'm416' : 'energy_lmg'))));

                        // 检查弹药和换弹状态（能量轻机枪无限子弹，不检查弹药）
                        const hasAmmo = isEnergyLMG ? true : this._hasAmmo(effectiveSlot);
                        const isReloading = isEnergyLMG ? false : this._isReloading(effectiveSlot);

                        // 过热时禁止射击（按武器类型匹配：只有引发过热的机枪被锁定，
                        // 切到其他武器不受影响，但切回仍处于锁定计时中）
                        const isOverheated = this._overheatOverheated && this._overheatWeaponType === effectiveItem.weaponType;
                        if (isOverheated) {
                            // 过热中，禁止开火
                        } else if (hasAmmo && !isReloading && this.weaponSwitchCooldown <= 0 && primaryDown && this.attacks[attackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                            this.attacks[attackKey].cooldown = this.attacks[attackKey].maxCooldown;
                            this.triggerWeaponAnim();
                        }

                        // 能量轻机枪：更新射速提升状态
                        if (isEnergyLMG) {
                            const elp = this._getEnergyLMGParams();
                            if (primaryDown && !this._overheatOverheated) {
                                // 持续开火：累积开火时间
                                if (!this._energyLMGIsFiring) {
                                    this._energyLMGIsFiring = true;
                                    this._energyLMGFireTime = 0;
                                }
                                this._energyLMGFireTime += dt; // 使用实际dt，确保固定时间
                                // 计算当前冷却时间：从baseCooldown线性降到maxCooldown，rampUpTime内完成
                                const rampProgress = Math.min(1, this._energyLMGFireTime / elp.rampUpTime);
                                const currentCooldown = Math.round(elp.baseCooldown - (elp.baseCooldown - elp.maxCooldown) * rampProgress);
                                this.attacks.energy_lmg.maxCooldown = currentCooldown;
                            } else {
                                // 停止开火：重置射速
                                this._energyLMGIsFiring = false;
                                this._energyLMGFireTime = 0;
                                this.attacks.energy_lmg.maxCooldown = elp.baseCooldown;
                            }
                        }

                        // 右键：副手射击（双持时，且不在瞄准模式下）
                        if (!this._aimModeActive && !useOffhand) {
                            let offhandSlot = null;
                            if (currentSlot === 'weapon') offhandSlot = 'offhand';
                            else if (currentSlot === 'weapon2') offhandSlot = 'ring2';
                            const offhandItem = offhandSlot ? this.equipments[offhandSlot] : null;
                            if (offhandItem && offhandItem.name && isOneHanded(offhandItem)) {
                                const offhandAttackKey = offhandItem && offhandItem.offhandAttackKey || 'pistolOffhand';
                                if (offhandAttackKey && this.attacks[offhandAttackKey]) {
                                    const offhandHasAmmo = this._hasAmmo(offhandSlot);
                                    const offhandReloading = this._isReloading(offhandSlot);
                                    if (offhandHasAmmo && !offhandReloading && this.weaponSwitchCooldown <= 0 && secondaryDown && this.attacks[offhandAttackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                        this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, offhandSlot: offhandSlot, fireOffhand: true };
                                        this.attacks[offhandAttackKey].cooldown = this.attacks[offhandAttackKey].maxCooldown;
                                        this.triggerOffhandWeaponAnim();
                                    }
                                }
                            }
                        }
                    } else if (isShotgun) {
                        const attackKey = effectiveItem.attackKey || 'super90';
                        const isSaiga12k = attackKey === 'saiga12k';
                        const hasAmmo = this._hasAmmo(effectiveSlot);
                        const isReloading = this._isReloading(effectiveSlot);
                        // 打断单发装填：左键按下时打断换弹（仅Super90）
                        if (!rtsEnabled && !isSaiga12k && isReloading && primaryPressed) {
                            this._interruptReload(effectiveSlot);
                        }
                        // 打断换弹：SAIGA-12K按住左键时也打断换弹
                        if (!rtsEnabled && isSaiga12k && isReloading && primaryDown) {
                            this._interruptReload(effectiveSlot);
                        }
                        // Super90: 单次点击开火(leftPressed)；SAIGA-12K: 按住左键持续开火(leftDown)
                        const fireTrigger = isSaiga12k ? primaryDown : primaryPressed;
                        if (hasAmmo && !isReloading && this.weaponSwitchCooldown <= 0 && fireTrigger && this.attacks[attackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                            this.attacks[attackKey].cooldown = this.attacks[attackKey].maxCooldown;
                            this.triggerWeaponAnim();
                            if (!isSaiga12k) {
                                Input.mouse.leftPressed = false; // Super90消费掉点击事件
                                primaryPressed = false;
                            }
                        }
                        // 子弹打空时，点击开火键也触发换弹（自动换弹）
                        const ammoState = this._getAmmoState(effectiveSlot);
                        if (!hasAmmo && !isReloading && primaryPressed && ammoState && ammoState.current <= 0) {
                            this._startReload(effectiveSlot);
                            Input.mouse.leftPressed = false;
                            primaryPressed = false;
                        }
                    } else if (primaryPressed) {
                        // 计算冲刺攻击触发时间：基础333ms，每级减少3%
                        const activeDashSkill = this._getActiveDashSkillId();
                        const dashLevel = (this.skills && this.skills[activeDashSkill] && this.skills[activeDashSkill].level) || 1;
                        const triggerTime = 333 * (1 - (dashLevel - 1) * 0.03);
                        if (isMelee && this._sprintDuration >= triggerTime && !this._isDashing && !(this.weaponAnim && this.weaponAnim.isAttacking)
                            && !this._attackRecovering && !this._dashRecoverAt) {
                            // 冲刺攻击触发（攻击动画锁定：任何一段攻击未播完前不触发，收势/定格期同样拒绝）
                            this.dashSystem.trigger(entities);
                        } else if (isMelee) {
                            // 近战攻击：使用 ThrustAttack
                            // 攻击动画未播放完之前，忽略新的普通攻击输入：
                            // 不重播攻击动画，也不产生新的攻击判定（冲刺/风车/推击/收势/定格期同样拒绝插队）
                            if (this.weaponAnim.state !== 'attacking' && !this._isDashing && !this._isWhirlwind
                                && !this._isPushStrike && !this._attackRecovering && !this._dashRecoverAt) {
                                const atk = this.attacks.melee;
                                if (atk.canUse()) {
                                    const success = atk.execute(this, mouseWorld.x, mouseWorld.y, entities);
                                    if (success) {
                                        atk.cooldown = atk.maxCooldown;
                                        this.triggerWeaponAnim();
                                        // 符文长剑：攻击命中时减少技能CD
                                        this.runeSwordSystem._triggerCooldownReduction();
                                    }
                                }
                            }
                        } else if (isBow) {
                            // 弓矢攻击：使用 RangedAttack
                            const atk = this.attacks.ranged;
                            if (atk.canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                // 如果正在奔跑，停止奔跑
                                if (Input.isSprint() && this.data.stamina > 0) {
                                    this._sprintDuration = 0;
                                }
                                this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                                atk.cooldown = atk.maxCooldown;
                                this.triggerWeaponAnim();
                            }
                        }
                        Input.mouse.leftPressed = false;
                        primaryPressed = false;
                    }
                    // ===== 右键特殊攻击：夜与火之剑 / 符文长剑 =====
                    // 攻击动画锁定：任何一段攻击未播完前不触发
                    if (secondaryPressed && isMelee && !(this.weaponAnim && this.weaponAnim.isAttacking)) {
                        
                        if (effectiveItem && effectiveItem.specialAttackType === 'nightFlame') {
                            // 夜与火之剑
                            
                            if ((this._specialAttackCooldowns['nightFlame'] || 0) <= 0 && !this._specialAttackActive && !this._runeSwordSpecialActive) {
                                this.specialAttackSystem.trigger(mouseWorld.x, mouseWorld.y, entities);
                            }
                        } else if (effectiveItem && effectiveItem.specialAttackType === 'runeSword') {
                            // 符文长剑
                            
                            if (this._runeSwordSpecialActive) {
                                // 已激活：发射一把剑
                                this.runeSwordSystem._launchBlade();
                            } else if ((this._specialAttackCooldowns['runeSword'] || 0) <= 0 && !this._specialAttackActive) {
                                // 未激活：启动特殊攻击
                                this.runeSwordSystem.trigger();
                            }
                        }
                        Input.mouse.rightPressed = false;
                        secondaryPressed = false;
                    }
                }
            }
};

export { updateMixin };
