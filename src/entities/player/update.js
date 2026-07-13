import { SoundManager } from '../../ui/sound-manager.js';

import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { SceneManager } from '../../world/scene-manager.js';
import { Camera } from '../../world/camera.js';
import { Input } from '../../ui/input.js';
import { StatusBar } from '../../ui/status-bar.js';
import { DashConvergeEffect } from '../../effects/dash-effects.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { isGunWeapon, isOneHanded } from '../../config/gun-ammo.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { CONFIG } from '../../config/config.js';
import { GameUIManager } from '../../ui/game-ui-manager.js';
import { SystemUI } from '../../ui/system-ui.js';
import { DungeonMapSystem } from '../../world/dungeon-map-system.js';

const updateMixin = {
update(dt, entities) {
                // 同步六边形顶点世界坐标（原 super.update(dt) 做的事情）
                if (this.hitbox) {
                    this.hitbox.updateWorldPosition(this);
                }
                if (this.hitFlash > 0) {
                    this.hitFlash = Math.max(0, this.hitFlash - dt);
                }
                this.updateStatusEffects(dt);
                // 死亡状态处理
                if (this._isDead) {
                    this._deathTimer -= dt;
                    if (this._deathTimer <= 0) {
                        this.respawn();
                    }
                    return; // 死亡期间不执行任何其他逻辑
                }
                // ===== 眩晕状态处理 =====
                if (this.isStunned) {
                    this.stunTimer -= dt;
                    if (this.stunTimer <= 0) {
                        this.isStunned = false;
                        this.stunTimer = 0;
                        // 从状态栏移除眩晕效果
                        if (this._stunEffectId && StatusBar) {
                            StatusBar.removeEffect(this._stunEffectId);
                            this._stunEffectId = null;
                        }
                    }
                    // 眩晕期间强制取消防御状态
                    if (this.shieldSystem && this.shieldSystem.defending) {
                        this.shieldSystem.exitDefense();
                    }
                    // 眩晕期间：无法移动、无法攻击、无法调准朝向、无法释放技能
                    // 更新其他子系统（如武器特效、动画复位等）
                    this._updateSubsystems(dt, entities);
                    return;
                }
                // ===== 中毒处理 =====
                if (this._poisonTimer > 0) {
                    this._poisonTimer -= dt;
                    this._poisonTickTimer -= dt;
                    if (this._poisonTickTimer <= 0) {
                        this.data.hp -= this._poisonStacks;
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${this._poisonStacks}`, '#7a9a5a'));
                        if (this.data.hp <= 0) {
                            this.data.hp = 0;
                            this.onDeath();
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

                const move = Input.getMovement();
                // 无人机操控模式下：禁用玩家移动，但继续更新其他逻辑
                const isDroneControlling = this.droneSystem && this.droneSystem.controlling;
                // 近战攻击期间禁止转向，变量供下方移动/旋转逻辑共享
                let isMeleeAttacking = false;
                if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;
                if (this.weaponSwitchCooldown > 0) this.weaponSwitchCooldown -= dt;
                if (this.isDodging) {
                    this.dodgeTimer -= dt;
                    if (this.dodgeTimer <= 0) { this.isDodging = false; this.dodgeInvincible = false; }
                    else {
                        const dScale = dt / 1000;
                        const dnx = this.x + this.dodgeDirection.x * CONFIG.DODGE_SPEED * 0.33 * dScale, dny = this.y + this.dodgeDirection.y * CONFIG.DODGE_SPEED * 0.33 * dScale;
                        const dr = WallSystem.resolve(this.x, this.y, dnx, dny, this.collisionRadius);
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
                    // 攻击期间禁止奔跑
                    const isAttacking = this.weaponAnim && this.weaponAnim.state !== 'idle';
                    if (isAttacking) sprint = false;
                    let targetSpeed = sprint ? CONFIG.PLAYER_SPRINT : this.maxSpeed;
                    // 减速状态（致残）：移动速度减半
                    if (this.hasStatusEffect && this.hasStatusEffect('slow')) targetSpeed *= 0.5;
                    // 防御状态：移动速度减慢 50%
                    if (this.shieldSystem && this.shieldSystem.defending) targetSpeed *= 0.5;
                    const currentEquip = this.equipments[this.weaponMode];
                    const isPkmEquipped = currentEquip && (currentEquip.weaponType === 'pkm' || currentEquip.weaponType === 'qjb201' || currentEquip.weaponType === 'energy_lmg');
                    const isPistolEquipped = currentEquip && (currentEquip.weaponType === 'pistol' || currentEquip.rangedType === 'pistol');
                    const _isAkmOrQbz191 = currentEquip && (currentEquip.weaponType === 'akm' || currentEquip.weaponType === 'qjb201');
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
                    // 手枪精通：持有手枪时增加移动速度
                    if (isPistolEquipped && this.skills && this.skills.pistolMastery) {
                        const pm = this.skills.pistolMastery.getEffect(this.skills.pistolMastery.level);
                        targetSpeed *= (1 + pm.speedPercent);
                    }
                    // 机枪开火时禁止 Shift 奔跑
                    if (sprint && isPkmEquipped && Input.mouse.leftDown && this._gunSpreadWeapon) {
                        sprint = false;
                        let moveSpeedReduction = 0.50;
                        const craftEffects = currentEquip && currentEquip._craftEffects;
                        if (craftEffects && craftEffects.moveSpeedPercent) {
                            moveSpeedReduction -= craftEffects.moveSpeedPercent;
                        }
                        if (moveSpeedReduction > 0.90) moveSpeedReduction = 0.90;
                        if (moveSpeedReduction < 0) moveSpeedReduction = 0;
                        targetSpeed = this.maxSpeed * (1 - moveSpeedReduction);
                    }
                    // 冲刺攻击动画期间：移动速度为0.1px/帧（结束后恢复）
                    if (this._isDashing) targetSpeed = 0.1;
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
                        const mScale = dt / 1000;
                        const nx = this.x + this.vx * mScale, ny = this.y + this.vy * mScale;
                        const resolved = WallSystem.resolve(this.x, this.y, nx, ny, this.collisionRadius);
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
                    if (Input.isPressed(CONFIG.KEYS.SPACE) && this.dodgeCooldown <= 0 && this.data.stamina >= CONFIG.STAMINA_DODGE_COST) {
                        if (this.weaponAnim && this.weaponAnim.isAttacking) this.clearAttackTweens();
                        this.triggerDodge(moveInput);
                    }
                }
                const screenPos = Renderer.worldToScreen(this.x, this.y), dx = Input.mouse.x - screenPos.x, dy = Input.mouse.y - screenPos.y;
                if (isMeleeAttacking) {
                    // 近战攻击期间锁定朝向，动画结束后再恢复跟随鼠标
                } else if (this._isDashing) {
                    // 冲刺时不改变武器朝向
                    // this.rotation = Math.atan2(this._dashDirection.y, this._dashDirection.x);
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
                const _sprintActive = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse();
                this._isSprinting = _sprintActive; // 保存供render使用
                // ===== 行走/奔跑动画已由 Phaser 处理 =====
                // Phaser 在 GameScene.update() 中自动播放 walk/run/idle 动画
                if (this.isMoving && !this.isDodging) {
                    this.animTime += 0.15;
                }
                if (this.isMoving && !this.isDodging) {
                    this.animTime += 0.15;
                }
                const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    const sprint = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse();
                    if (speed > 1.0) {
                        if (!this.dustTimer) this.dustTimer = 0;
                        this.dustTimer += dt;
                        const interval = sprint ? 70 : 140;
                        if (this.dustTimer >= interval) {
                            this.dustTimer -= interval;
                            // SoundManager.play('step');
                            const offsetX = -this.vx * (dt / 1000) * 1.5 + (Math.random() - 0.5) * 8;
                            const offsetY = -this.vy * (dt / 1000) * 1.5 + (Math.random() - 0.5) * 4;
                            const dInt = sprint ? 1.5 : 0.8;
                            EffectFactory.createDustEffect(this.x + offsetX, this.y + offsetY + 10, dInt);
                            // PKM 装备时奔跑额外生成更浓密的烟尘
                            const currentItem = this.equipments[this.weaponMode];
                            if (currentItem && (currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg')) {
                                const pkmDInt = sprint ? 2.2 : 1.2;
                                EffectFactory.createDustEffect(this.x + offsetX * 0.7, this.y + offsetY * 0.7 + 10, pkmDInt);
                            }
                        }
                    } else {
                        this.dustTimer = 0;
                    }
                const isAttacking = this.weaponAnim && this.weaponAnim.state !== 'idle';
                const isSprinting = Input.isSprint() && this.data.stamina > 0 && this.isMoving && this._isFacingMouse();
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
                    // 祭品效果：麦穗 - 生命恢复每秒+1
                    if (DungeonMapSystem && DungeonMapSystem._carriedItems) {
                        const tributes = DungeonMapSystem._carriedItems;
                        const hasWheat = tributes.some(c => c && c.item && c.item.name === '麦穗');
                        if (hasWheat) regen += 1;
                    }
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
                // ===== 魔法回复 =====
                if (this.data.mp < this.data.maxMp) {
                    this.data.mp = Math.min(this.data.maxMp, this.data.mp + (this.data.mpRegen / 3) * (dt / 1000));
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
                if (_isGun && Input.mouse.leftDown) {
                    this._gunSpreadTimer += dt;
                    this._gunSpreadWeapon = _currentWep2.weaponType;
                } else {
                    this._gunSpreadTimer = Math.max(0, this._gunSpreadTimer - dt * 2);
                    if (this._gunSpreadTimer <= 0) this._gunSpreadWeapon = null;
                }
                // 副手散布计时：双持时右键按下且副手为枪械时累计散布
                const _offIsGun = _offItem && isGunWeapon(_offItem);
                if (_isDual && _offIsGun && Input.mouse.rightDown) {
                    this._gunSpreadTimerOff += dt;
                    this._gunSpreadWeaponOff = _offItem.weaponType;
                } else {
                    this._gunSpreadTimerOff = Math.max(0, this._gunSpreadTimerOff - dt * 2);
                    if (this._gunSpreadTimerOff <= 0) this._gunSpreadWeaponOff = null;
                }
                // 准星单发 kick 衰减
                if (this._crosshairShotKick > 0) {
                    this._crosshairShotKick = Math.max(0, this._crosshairShotKick - dt / 80);
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
                        // 武器特异化散布参数（优先从配置读取）
                        const sp = _currentWep2.spreadParams;
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
                        const offSp = _offItem.spreadParams;
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
                        if (Input.mouse.leftDown) {
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
                        if (recoverTime < 500) recoverTime = 500; // 最小0.5秒
                        this._overheatValue = Math.max(0, this._overheatValue - (dt / recoverTime));
                        if (this._overheatRecoverTimer <= 0 || this._overheatValue <= 0) {
                            this._overheatOverheated = false;
                            this._overheatRecoverTimer = 0;
                            this._overheatValue = 0;
                            this._overheatActive = false;
                        }
                    } else if (Input.mouse.leftDown && !this._isReloading(this.weaponMode)) {
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
                            if (recoverTimer < 500) recoverTimer = 500;
                            this._overheatRecoverTimer = recoverTimer;
                            // 过热音效
                            if (SoundManager) {
                                if (_currentWep2.weaponType === 'energy_lmg') {
                                    SoundManager.playFile('assets/sounds/pkm_ammo_steam_mixed.wav');
                                    SoundManager.playFile('assets/sounds/apex_reload_4s_raw.mp3');
                                } else {
                                    SoundManager.playFile('assets/sounds/pkm_ammo_steam_mixed.wav');
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
                        this._overheatValue = Math.max(0, this._overheatValue - (dt / recoverTime));
                        if (this._overheatValue <= 0) {
                            this._overheatActive = false;
                        }
                    }
                } else {
                    // 非机枪武器：隐藏过热条
                    this._overheatActive = false;
                    this._overheatValue = 0;
                    this._overheatOverheated = false;
                    this._overheatRecoverTimer = 0;
                    this._overheatWeaponType = null;
                }
                this.updateWeaponAnim(dt);
                this._updateSubsystems(dt, entities);
                const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                // 左键拾取地面物品已取消 — 现在仅在鼠标悬停触发金色特效时自动拾取
                // （逻辑移至 Game.update() 的悬停检测中）
                if (!this.isDodging && !this._isDashing && !this._isWhirlwind && !this._isPushStrike && !this._specialAttackActive && !this._isDead) {
                    // ===== 盾防御状态管理 =====
                    if (this.shieldSystem && this.shieldSystem.checkEquipped()) {
                        if (Input.mouse.rightDown) {
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
                        // 注意：不重置 leftDown，避免面板关闭后立即攻击
                        return;
                    }
                    // 游戏开始冷却期间禁止攻击
                    if (this.gameStartCooldown > 0) {
                        Input.mouse.leftPressed = false;
                        Input.mouse.leftDown = false;
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
                        if (Input.mouse.leftDown) {
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
                        if (Input.mouse.leftPressed) Input.mouse.leftPressed = false;
                    }
                    // 判断当前有效武器的类型
                    const isPistol = effectiveItem && (effectiveItem.weaponType === 'pistol' || effectiveItem.rangedType === 'pistol');
                    const isBow = effectiveItem && effectiveItem.weaponType === 'bow';
                    const isPkm = effectiveItem && (effectiveItem.weaponType === 'pkm' || effectiveItem.weaponType === 'akm' || effectiveItem.weaponType === 'qbz191' || effectiveItem.weaponType === 'qjb201' || effectiveItem.weaponType === 'energy_lmg');
                    const isShotgun = effectiveItem && effectiveItem.weaponType === 'shotgun';
                    const isMelee = effectiveItem && (effectiveItem.category === 'weapon_melee' || effectiveItem.weaponType === 'sword');
                    const isGun = effectiveItem && isGunWeapon(effectiveItem);
                    
                    // ===== 计算副手状态（用于双持判断） =====
                    const offhandSlot = currentSlot === 'weapon' ? 'offhand' : 'ring2';
                    const offhandItem = this.equipments[offhandSlot];
                    const isDualWield = offhandItem && offhandItem.name && !offhandItem.isTwoHanded;

                    // ===== 瞄准模式：所有枪械都可以进行瞄准（双持手枪除外） =====
                    if (isGun && Input.mouse.rightDown && !(isPistol && isDualWield)) {
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
                        const mainFireMode = effectiveItem.fireMode || 'fullAuto';
                        const mainFireTrigger = mainFireMode === 'semiAuto' ? Input.mouse.leftPressed : Input.mouse.leftDown;
                        // 左键：主手射击
                        if (mainHasAmmo && !mainReloading && this.weaponSwitchCooldown <= 0 && mainFireTrigger && this.attacks[attackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                            this.attacks[attackKey].cooldown = this.attacks[attackKey].maxCooldown;
                            this.triggerWeaponAnim();
                            // 半自动武器：消费掉点击事件，防止持续射击
                            if (mainFireMode === 'semiAuto') {
                                Input.mouse.leftPressed = false;
                            }
                        }
                        // 右键：副手射击（双持时）
                        const offhandFireMode = offhandItem && offhandItem.fireMode || 'fullAuto';
                        const offhandFireTrigger = offhandFireMode === 'semiAuto' ? Input.mouse.rightPressed : Input.mouse.rightDown;
                        if (isDualWield && offhandHasAmmo && !offhandReloading && this.weaponSwitchCooldown <= 0 && offhandFireTrigger && this.attacks[offhandAttackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, offhandSlot: offhandSlot, fireOffhand: true };
                            this.attacks[offhandAttackKey].cooldown = this.attacks[offhandAttackKey].maxCooldown;
                            this.triggerOffhandWeaponAnim();
                            // 半自动副手：消费掉点击事件
                            if (offhandFireMode === 'semiAuto') {
                                Input.mouse.rightPressed = false;
                            }
                        }
                    } else if (isPkm) {
                        // PKM / AKM / 191 / 201 / 能量轻机枪 全自动模式：按住 leftDown 持续射击
                        const isEnergyLMG = effectiveItem.weaponType === 'energy_lmg';
                        const attackKey = effectiveItem.weaponType === 'pkm' ? 'pkm' : (effectiveItem.weaponType === 'akm' ? 'akm' : (effectiveItem.weaponType === 'qbz191' ? 'qbz191' : (effectiveItem.weaponType === 'qjb201' ? 'qjb201' : 'energy_lmg')));

                        // 检查弹药和换弹状态（能量轻机枪无限子弹，不检查弹药）
                        const hasAmmo = isEnergyLMG ? true : this._hasAmmo(effectiveSlot);
                        const isReloading = isEnergyLMG ? false : this._isReloading(effectiveSlot);

                        // 过热时禁止射击
                        const isOverheated = this._overheatOverheated;
                        if (isOverheated) {
                            // 过热中，禁止开火
                        } else if (hasAmmo && !isReloading && this.weaponSwitchCooldown <= 0 && Input.mouse.leftDown && this.attacks[attackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                            this.attacks[attackKey].cooldown = this.attacks[attackKey].maxCooldown;
                            this.triggerWeaponAnim();
                        }

                        // 能量轻机枪：更新射速提升状态
                        if (isEnergyLMG) {
                            const elp = this._getEnergyLMGParams();
                            if (Input.mouse.leftDown && !this._overheatOverheated) {
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
                                    if (offhandHasAmmo && !offhandReloading && this.weaponSwitchCooldown <= 0 && Input.mouse.rightDown && this.attacks[offhandAttackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
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
                        if (!isSaiga12k && isReloading && Input.mouse.leftPressed) {
                            this._interruptReload(effectiveSlot);
                        }
                        // 打断换弹：SAIGA-12K按住左键时也打断换弹
                        if (isSaiga12k && isReloading && Input.mouse.leftDown) {
                            this._interruptReload(effectiveSlot);
                        }
                        // Super90: 单次点击开火(leftPressed)；SAIGA-12K: 按住左键持续开火(leftDown)
                        const fireTrigger = isSaiga12k ? Input.mouse.leftDown : Input.mouse.leftPressed;
                        if (hasAmmo && !isReloading && this.weaponSwitchCooldown <= 0 && fireTrigger && this.attacks[attackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                            this.attacks[attackKey].cooldown = this.attacks[attackKey].maxCooldown;
                            this.triggerWeaponAnim();
                            if (!isSaiga12k) {
                                Input.mouse.leftPressed = false; // Super90消费掉点击事件
                            }
                        }
                        // 子弹打空时，点击开火键也触发换弹（自动换弹）
                        const ammoState = this._getAmmoState(effectiveSlot);
                        if (!hasAmmo && !isReloading && Input.mouse.leftPressed && ammoState && ammoState.current <= 0) {
                            this._startReload(effectiveSlot);
                            Input.mouse.leftPressed = false;
                        }
                    } else if (Input.mouse.leftPressed) {
                        // 计算冲刺攻击触发时间：基础333ms，每级减少3%
                        const activeDashSkill = this._getActiveDashSkillId();
                        const dashLevel = (this.skills && this.skills[activeDashSkill] && this.skills[activeDashSkill].level) || 1;
                        const triggerTime = 333 * (1 - (dashLevel - 1) * 0.03);
                        if (isMelee && this._sprintDuration >= triggerTime && !this._isDashing) {
                            // 冲刺攻击触发
                            this.dashSystem.trigger(entities);
                        } else if (isMelee) {
                            // 近战攻击：使用 ThrustAttack
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
                    }
                    // ===== 右键特殊攻击：夜与火之剑 / 符文长剑 =====
                    if (Input.mouse.rightPressed && isMelee) {
                        
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
                    }
                }
            }
};

export { updateMixin };
