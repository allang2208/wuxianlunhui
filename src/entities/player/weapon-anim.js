import { SoundManager } from '../../ui/sound-manager.js';
import { WEAPON_ANIM } from '../../config/math-utils.js';
import { Camera } from '../../world/camera.js';
import { Input } from '../../ui/input.js';
// ============================================================
// Weapon Animation System - 状态机驱动（兼容旧系统）
// 远程武器使用状态机驱动动画，近战武器使用 Phaser Tween
// ============================================================

import { isTwoHanded } from '../../config/gun-ammo.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { Easing } from '../../config/math-utils.js';
import { CONFIG } from '../../config/config.js';
import { playerTextureKey, getPlayerAnimDurationMs } from '../../config/player-anim.js';

const weaponAnimMixin = {
    // 初始化武器动画状态
    initWeaponAnim() {
        this.weaponAnim = {
            state: 'idle',
            angle: 0,
            timer: 0,
            isAttacking: false,
        };
        this.offhandWeaponAnim = {
            state: 'idle',
            angle: 0,
            timer: 0,
            isAttacking: false,
        };
        // 当前活动的 Tweens（仅近战武器使用）
        this._activeAttackTweens = [];
    },

    // 每帧更新武器动画状态机（兼容旧系统）
    updateWeaponAnim(dt) {
        const wa = WEAPON_ANIM, anim = this.weaponAnim;

        // 清理已停止的攻击 Tween，避免僵尸 Tween 残留
        if (this._activeAttackTweens) {
            this._activeAttackTweens = this._activeAttackTweens.filter(t => t && typeof t.isPlaying === 'function' && t.isPlaying());
        }

        // [FIX] 任意非 idle 状态卡住超过 5 秒，强制恢复 idle，避免体力回复等逻辑被永久阻塞
        if (anim.state !== 'idle' && anim.timer > 5000) {
            anim.state = 'idle';
            anim.timer = 0;
            anim.isAttacking = false;
        }

        // 攻击状态由状态机管理
        switch (anim.state) {
            case 'idle':
                // 旋转待机动画
                if (anim.spinEnd && Date.now() < anim.spinEnd) {
                    const t = 1 - (anim.spinEnd - Date.now()) / anim.spinDuration;
                    anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06 + t * Math.PI * 8;
                } else {
                    anim.spinEnd = 0;
                    anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06;
                    
                    // 装备双手武器时不播放旋转待机动画
                    const _idleItem = this.equipments[this.weaponMode];
                    const _isTwoHandedIdle = _idleItem && isTwoHanded(_idleItem);
                    if (_isTwoHandedIdle) {
                        anim.nextSpin = 0;
                        anim.spinEnd = 0;
                    } else if (!anim.nextSpin) {
                        anim.nextSpin = Date.now() + 3000 + Math.random() * 3000;
                    } else if (Date.now() >= anim.nextSpin) {
                        anim.spinDuration = 650;
                        anim.spinEnd = Date.now() + anim.spinDuration;
                        anim.nextSpin = Date.now() + anim.spinDuration + 3000 + Math.random() * 3000;
                    }
                }
                break;
                
            case 'rotate':
                // 弓类旋转阶段
                anim.timer += dt;
                if (anim.timer >= 500) {
                    anim.state = 'windup';
                    anim.timer = 0;
                    anim.rotateAngle = -14 * (Math.PI / 180);
                    SoundManager.playFile('assets/sounds/bow/rope_pull_1s.wav');
                } else {
                    const t = anim.timer / 500;
                    const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                    anim.rotateAngle = -14 * easeT * (Math.PI / 180);
                }
                break;
                
            case 'windup':
                anim.spinEnd = 0;
                anim.timer += dt;
                if (anim.timer >= this._getAnimMs(wa.windupMs)) {
                    anim.state = 'swing';
                    anim.timer = 0;
                } else {
                    anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * Easing.easeInQuad(anim.timer / this._getAnimMs(wa.windupMs));
                }
                break;
                
            case 'swing':
                // 近战判定
                if (anim.timer === 0 && this._pendingThrust) {
                    this._pendingThrust.active = true;
                }
                if (this._pendingThrust && this._pendingThrust.active) {
                    if (Date.now() - this._pendingThrust.startTime <= 500) {
                        this.attacks.melee.checkTriangleHit(this);
                    } else {
                        this._pendingThrust.active = false;
                    }
                }

                // 远程武器在 swing 阶段发射子弹（放在 timer 检查之前，避免高射速武器 dt 过大跳过射击）
                {
                    const currentItem = this.equipments[this.weaponMode];
                    const isRangedWeapon = currentItem && (currentItem.weaponType === 'pistol' || currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'shotgun' || currentItem.weaponType === 'energy_lmg' || currentItem.rangedType === 'pistol');
                    const hasPendingMainShot = this.rangedFireData && this.rangedFireData.fireMainHand;
                    if ((!this.rangedFired || hasPendingMainShot) && isRangedWeapon && this.rangedFireData) {
                        this._fireRanged('main');
                    }
                }

                anim.timer += dt;
                if (anim.timer >= this._getAnimMs(wa.swingMs)) {
                    anim.state = 'recover';
                    anim.timer = 0;
                    if (this._pendingThrust) {
                        this._pendingThrust.active = false;
                        this.attacks.melee.giveExp(this);
                    }
                } else {
                    anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * Easing.easeOutQuad(anim.timer / this._getAnimMs(wa.swingMs));
                }
                break;
                
            case 'recover':
                anim.timer += dt;
                if (anim.timer >= this._getAnimMs(wa.recoverMs)) {
                    // 弓在 recover 结束后射出箭矢
                    const currentItem = this.equipments[this.weaponMode];
                    if (currentItem && currentItem.weaponType === 'bow' && !this.rangedFired && this.rangedFireData) {
                        const mouseWorldX = Input.mouse.x + Camera.x - CONFIG.VIEW_WIDTH / 2;
                        const mouseWorldY = Input.mouse.y + Camera.y - CONFIG.VIEW_HEIGHT / 2;
                        this.rangedFireData.targetX = mouseWorldX;
                        this.rangedFireData.targetY = mouseWorldY;
                        SoundManager.playFile('assets/sounds/arrow_flyby_1s.mp3');
                        this._fireRanged('main');
                    }
                    anim.state = 'idle_return';
                    anim.timer = 0;
                    this._pendingThrust = null;
                } else {
                    anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * Easing.easeInOutCubic(anim.timer / this._getAnimMs(wa.recoverMs));
                }
                break;
                
            case 'idle_return':
                anim.timer += dt;
                if (anim.timer >= 200) {
                    anim.state = 'idle';
                    anim.timer = 0;
                    anim.rotateAngle = 0;
                    anim.isAttacking = false;
                } else {
                    const t = anim.timer / 200;
                    const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                    anim.rotateAngle = -14 * (1 - easeT) * (Math.PI / 180);
                }
                break;

            case 'attacking':
                // 近战 Tween 负责驱动；清理已结束的 Tween
                if (this._activeAttackTweens) {
                    this._activeAttackTweens = this._activeAttackTweens.filter(t => t && !t.hasFinished && t.isPlaying());
                }
                // 若 Tween 已被清理或结束但状态未复位，安全回退到 idle
                if (!this._activeAttackTweens || this._activeAttackTweens.length === 0) {
                    anim.state = 'idle';
                    anim.timer = 0;
                    anim.isAttacking = false;
                } else {
                    // 累计计时，让上方的 5 秒卡住保护能够生效
                    anim.timer += dt;
                }
                break;

            default:
                // 未知状态安全回退
                anim.state = 'idle';
                anim.timer = 0;
                anim.isAttacking = false;
                break;
        }
        
        // 同步副手攻击动画
        if (this.offhandWeaponAnim) {
            const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
            const offhandItem = this.equipments[offhandSlot];
            const isDualPistol = offhandItem && (offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol');
            if (isDualPistol) {
                const offAnim = this.offhandWeaponAnim;
                const offWindupMs = this._getOffhandAnimMs(offhandItem, wa.windupMs);
                const offSwingMs = this._getOffhandAnimMs(offhandItem, wa.swingMs);
                const offRecoverMs = this._getOffhandAnimMs(offhandItem, wa.recoverMs);
                switch (offAnim.state) {
                    case 'windup':
                        offAnim.timer += dt;
                        if (offAnim.timer >= offWindupMs) { offAnim.state = 'swing'; offAnim.timer = 0; }
                        break;
                    case 'swing':
                        offAnim.timer += dt;
                        if (offAnim.timer >= offSwingMs) { offAnim.state = 'recover'; offAnim.timer = 0; }
                        else {
                            const hasPendingOffhand = this.rangedFireData && this.rangedFireData.fireOffhand;
                            if (hasPendingOffhand) this._fireRanged('offhand');
                        }
                        break;
                    case 'recover':
                        offAnim.timer += dt;
                        if (offAnim.timer >= offRecoverMs) { offAnim.state = 'idle'; offAnim.timer = 0; offAnim.isAttacking = false; }
                        break;
                }
            }
        }
    },

    // 触发攻击动画（兼容旧代码调用）
    triggerWeaponAnim(hand = 'main') {
        const currentItem = this.equipments[this.weaponMode];
        if (currentItem && currentItem.weaponType === 'bow') {
            this.weaponAnim.state = 'rotate';
            this.weaponAnim.timer = 0;
            this.weaponAnim.rotateAngle = 0;
        } else {
            this.weaponAnim.state = 'swing';
            this.weaponAnim.timer = 0;
        }
        this.weaponAnim.isAttacking = true;
        this.rangedFired = false;
        
        // 近战武器使用 Phaser Tween
        const isMelee = currentItem && (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword');
        if (isMelee) {
            const scene = window.__phaserScene;
            if (scene) {
                this._playSwordAttackTween(scene, hand);
            }
        }
    },

    // 剑类攻击 Tween 动画
    _playSwordAttackTween(scene, hand) {
        const anim = hand === 'offhand' ? this.offhandWeaponAnim : this.weaponAnim;
        // 防止同一手重复启动 Tween：只有当前没在攻击动画中才启动
        if (anim.state === 'attacking') return;

        // 新攻击启动：清除上一段的定格保持窗口
        this._attackHoldUntil = 0;

        anim.isAttacking = true;
        anim.state = 'attacking';

        const weaponSprite = hand === 'offhand' ? scene.offhandWeaponSprite : scene.weaponSprite;
        if (!weaponSprite) {
            anim.isAttacking = false;
            anim.state = 'idle';
            return;
        }
        
        const startRotation = weaponSprite.rotation;
        const startX = weaponSprite.x;
        const startY = weaponSprite.y;
        const self = this;
        
        const currentWeapon = this.getCurrentWeapon ? this.getCurrentWeapon() : (this.equipments && this.weaponMode ? this.equipments[this.weaponMode] : null);
        const weaponType = currentWeapon ? (currentWeapon.weaponType || 'sword') : 'sword';

        // 本次攻击 Tween 总时长：同步玩家贴图动画（timeScale 拉伸/压缩），避免贴图与武器轨迹各播各的
        //（perFrame 与默认 Tween 两条路径都会先赋值再读取，无需初值）
        let tweenDuration;
        
        // 逐帧模式：武器位置/旋转由 GameScene 按玩家攻击动画当前帧同步，Tween 只负责命中判定与状态重置
        // 连段（一段后窗口期内再攻击）的 stage 在下方计算，二段轨迹读 attack2 块（缺失回退 attack）
        const wacCfg = WeaponAnimConfig[weaponType];
        const perFrameCfg = wacCfg?.attack;
        if (perFrameCfg && perFrameCfg.type === 'perFrame' && perFrameCfg.frames) {
            // 连段：上一段攻击结束后 500ms 内再次攻击 → 派生下一段（一段挥砍→二段挥砍→回一段）。
            // 二段素材未加载（纹理缺失）时自动回退一段；后续三段突刺加入只需扩展此数组
            const COMBO_WINDOW_MS = 500;
            const now = performance.now();
            const chained = hand === 'main' && this._lastMeleeAttackEnd && (now - this._lastMeleeAttackEnd) <= COMBO_WINDOW_MS;
            let stage = chained ? ((this._meleeComboStage || 1) % 2) + 1 : 1;
            let animKey = stage === 2 ? 'attack_sword_2' : 'attack_sword';
            if (stage === 2 && !scene.textures.exists(playerTextureKey(animKey))) {
                stage = 1;
                animKey = 'attack_sword';
            }
            if (hand === 'main') this._meleeComboStage = stage;
            // 命中判定配置：一段读 attack 块，二段读 attack2 块（缺失回退 attack）。
            // 帧号换算 progress 阈值 = (frame-1)/(frames.length-1)，不写死帧数；
            // 无 hitCheck 配置时回退旧的 500ms 连续判定窗口
            const stageCfg = (stage === 2 && wacCfg.attack2) ? wacCfg.attack2 : perFrameCfg;
            const hitCheckCfg = stageCfg.hitCheck || null;
            let hitCheckThreshold = null;
            if (hitCheckCfg && typeof hitCheckCfg.frame === 'number' && stageCfg.frames && stageCfg.frames.length > 1) {
                hitCheckThreshold = (hitCheckCfg.frame - 1) / (stageCfg.frames.length - 1);
            }
            let hitChecked = false;
            // 时长必须按逐帧时长求和优先（getPlayerAnimDurationMs 认识 frameDurations/frameWeights）——
            // Phaser Animation.duration 只按 frameRate 派生（30帧@12fps=2500ms），与逐帧时长实际播放
            // （30×50ms=1500ms）不一致，会导致武器轨迹进度比人物贴图慢（"慢半拍"）
            const animDef = scene.anims.get(playerTextureKey(animKey));
            const totalDuration = getPlayerAnimDurationMs(animKey) || (animDef && animDef.duration) || 900;
            tweenDuration = totalDuration;

            if (hand === 'main') {
                // 预写连段定格窗口：Phaser 4 每帧顺序 PRE_UPDATE(动画) → UPDATE(Tween)，
                // 动画播完帧上 animationcomplete 早于 Tween onComplete 触发——若在 onComplete
                // 才写这些字段，GameScene 的完成回调读到的是旧值，会把贴图切回 idle（定格失效，
                // 首次攻击与 1500ms 二段必现）；收势中被新攻击打断也要解除收势标记
                this._attackRecovering = false;
                this._attackHoldAnimKey = animKey;
                this._lastMeleeAttackEnd = now + totalDuration; // onComplete 会按实际结束时间复写
                this._attackHoldUntil = now + totalDuration + COMBO_WINDOW_MS;
            }

            // 统一由 GameScene 播放并记录攻击起始时间，用于逐帧武器同步
            if (hand === 'main' && scene.setPlayerAnimation) {
                scene.setPlayerAnimation(animKey, tweenDuration);
            }

            // 挥砍音效：攻击动画开始时播放（块配置 sound 字段，一段/二段可不同）
            if (stageCfg.sound && typeof SoundManager !== 'undefined' && SoundManager.playFile) {
                SoundManager.playFile(stageCfg.sound);
            }

            const attackTween = scene.tweens.add({
                targets: { progress: 0 },
                progress: 1,
                duration: totalDuration,
                ease: 'Linear',
                onStart: function() {
                    if (self._pendingThrust) self._pendingThrust.active = true;
                },
                onUpdate: function(tween) {
                    if (!self._pendingThrust || !self._pendingThrust.active) return;
                    if (hitCheckThreshold !== null) {
                        // 一次性判定：progress 首次达到 hitCheck 帧阈值时按形状判定（一段矩形/二段扇形）
                        if (!hitChecked && tween.targets[0].progress >= hitCheckThreshold) {
                            hitChecked = true;
                            self.attacks.melee.checkStageHit(self, hitCheckCfg);
                        }
                    } else if (Date.now() - self._pendingThrust.startTime <= 500) {
                        self.attacks.melee.checkTriangleHit(self);
                    } else {
                        self._pendingThrust.active = false;
                    }
                },
                onComplete: function() {
                    anim.isAttacking = false;
                    anim.state = 'idle';
                    if (hand === 'main') {
                        self._lastMeleeAttackEnd = performance.now(); // 连段窗口起点
                        // 攻击后定格保持：定格 0.5s（=连段判定窗口）——
                        // 定格期间武器朝向绑定身体 flipX（身体冻结故武器冻结），超时播 recover 收势
                        self._attackHoldAnimKey = animKey;
                        self._attackHoldUntil = self._lastMeleeAttackEnd + 500;
                    }
                    if (self._pendingThrust) {
                        self._pendingThrust.active = false;
                        self.attacks.melee.giveExp(self);
                        self._pendingThrust = null;
                    }
                }
            });
            this._activeAttackTweens.push(attackTween);
            return;
        }
        
        // 默认三段 Tween 链：windup / swing / recover
        const windupMs = 200;
        const swingMs = 300;
        const recoverMs = 400;
        tweenDuration = windupMs + swingMs + recoverMs;
        const playerRotation = this.rotation;
        const windupAngle = startRotation - 0.5;
        const swingAngle = startRotation + 0.8;
        const thrustDistance = 20;
        const thrustX = Math.cos(playerRotation) * thrustDistance;
        const thrustY = Math.sin(playerRotation) * thrustDistance;

        const chain = scene.tweens.chain({
            tweens: [
                {
                    targets: weaponSprite,
                    rotation: windupAngle,
                    x: startX - thrustX * 0.3,
                    y: startY - thrustY * 0.3,
                    duration: windupMs,
                    ease: 'Quad.easeIn',
                    onStart: function() {
                        if (self._pendingThrust) self._pendingThrust.active = true;
                    }
                },
                {
                    targets: weaponSprite,
                    rotation: swingAngle,
                    x: startX + thrustX,
                    y: startY + thrustY,
                    duration: swingMs,
                    ease: 'Quad.easeOut',
                    onUpdate: function() {
                        if (self._pendingThrust && self._pendingThrust.active) {
                            if (Date.now() - self._pendingThrust.startTime <= 500) {
                                self.attacks.melee.checkTriangleHit(self);
                            } else {
                                self._pendingThrust.active = false;
                            }
                        }
                    }
                },
                {
                    targets: weaponSprite,
                    rotation: startRotation,
                    x: startX,
                    y: startY,
                    duration: recoverMs,
                    ease: 'Cubic.easeInOut',
                    onComplete: function() {
                        anim.isAttacking = false;
                        anim.state = 'idle';
                        if (self._pendingThrust) {
                            self._pendingThrust.active = false;
                            self.attacks.melee.giveExp(self);
                            self._pendingThrust = null;
                        }
                    }
                }
            ]
        });

        this._activeAttackTweens.push(chain);

        if (hand === 'main' && scene.setPlayerAnimation) {
            scene.setPlayerAnimation('attack_sword', tweenDuration);
        }
    },

    // 清理所有活动的 Tween
    clearAttackTweens() {
        this._activeAttackTweens.forEach(tween => {
            if (tween && tween.stop) tween.stop();
        });
        this._activeAttackTweens = [];
        
        this.weaponAnim.isAttacking = false;
        this.weaponAnim.state = 'idle';
        this.offhandWeaponAnim.isAttacking = false;
        this.offhandWeaponAnim.state = 'idle';
    },

    // 获取动画时长
    _getAnimMs(baseMs) {
        const currentItem = this.equipments[this.weaponMode];
        let cfgKey = 'sword';
        if (currentItem) {
            if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') cfgKey = currentItem.animConfigKey || 'pistol';
            else if (currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg') cfgKey = currentItem.weaponType;
            else if (currentItem.weaponType === 'bow') cfgKey = 'bow';
            else if (currentItem.weaponType === 'shotgun') cfgKey = 'shotgun';
        }
        const cfg = WeaponAnimConfig[cfgKey];
        if (currentItem && currentItem.weaponType === 'bow' && cfg && cfg.attackInterval) {
            const bowAttackInterval = (currentItem.attack && currentItem.attack.attackInterval) || cfg.attackInterval;
            const attackAnimMs = bowAttackInterval - (cfg.rotateMs || 500) - (cfg.returnMs || 200);
            const totalBaseMs = WEAPON_ANIM.windupMs + WEAPON_ANIM.swingMs + WEAPON_ANIM.recoverMs;
            const mul = (attackAnimMs / totalBaseMs) * (this.animTimingMul || 1);
            return Math.round(baseMs * mul);
        }
        const mul = (cfg ? cfg.timingMul : 1) * (this.animTimingMul || 1);
        return Math.round(baseMs * mul);
    }
};

export { weaponAnimMixin };
