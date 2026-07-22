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
import { WeaponTransform } from '../../combat/weapon-transform.js';
import { Easing } from '../../config/math-utils.js';
import { CONFIG } from '../../config/config.js';

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
                        SoundManager.playFile('assets/sounds/bow/arrow_flyby_1s.mp3');
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

    // 剑类攻击 Tween 动画（支持关键帧）
    _playSwordAttackTween(scene, hand) {
        const anim = hand === 'offhand' ? this.offhandWeaponAnim : this.weaponAnim;
        // 防止同一手重复启动 Tween：只有当前没在攻击动画中才启动
        if (anim.state === 'attacking') return;

        anim.isAttacking = true;
        anim.state = 'attacking';

        // 统一由 GameScene 播放并记录攻击起始时间，用于逐帧武器同步
        if (hand === 'main' && scene.setPlayerAnimation) {
            scene.setPlayerAnimation('attack_sword');
        }

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
        const kfConfig = WeaponAnimConfig.keyframes && WeaponAnimConfig.keyframes[weaponType] && WeaponAnimConfig.keyframes[weaponType].attack;
        
        const facingRight = Math.abs(self.rotation) < Math.PI / 2;

        // 逐帧模式：武器位置/旋转由 GameScene 按玩家攻击动画当前帧同步，Tween 只负责命中判定与状态重置
        const perFrameCfg = WeaponAnimConfig[weaponType]?.attack;
        if (perFrameCfg && perFrameCfg.type === 'perFrame' && perFrameCfg.frames) {
            const animDef = scene.anims.get('player_attack_sword');
            const totalDuration = animDef ? (animDef.duration || 900) : 900;

            const attackTween = scene.tweens.add({
                targets: { progress: 0 },
                progress: 1,
                duration: totalDuration,
                ease: 'Linear',
                onStart: function() {
                    if (self._pendingThrust) self._pendingThrust.active = true;
                },
                onUpdate: function() {
                    if (self._pendingThrust && self._pendingThrust.active) {
                        if (Date.now() - self._pendingThrust.startTime <= 500) {
                            self.attacks.melee.checkTriangleHit(self);
                        } else {
                            self._pendingThrust.active = false;
                        }
                    }
                },
                onComplete: function() {
                    anim.isAttacking = false;
                    anim.state = 'idle';
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
        
        if (kfConfig && kfConfig.length >= 2) {
            anim.isAttacking = true;
            anim.state = 'attacking';
            const totalDuration = 900;
            
            const attackTween = scene.tweens.add({
                targets: { progress: 0 },
                progress: 1,
                duration: totalDuration,
                ease: 'Linear',
                onStart: function() {
                    if (self._pendingThrust) self._pendingThrust.active = true;
                },
                onUpdate: function(tween) {
                    const progress = tween.getValue();
                    let prev = kfConfig[0], next = kfConfig[kfConfig.length - 1];
                    for (let i = 0; i < kfConfig.length - 1; i++) {
                        if (progress >= kfConfig[i].progress && progress <= kfConfig[i + 1].progress) {
                            prev = kfConfig[i];
                            next = kfConfig[i + 1];
                            break;
                        }
                    }
                    
                    const segmentDuration = next.progress - prev.progress;
                    const t = segmentDuration > 0 ? (progress - prev.progress) / segmentDuration : 0;
                    
                    const rotation = (prev.rotation !== undefined ? prev.rotation : 0) +
                        ((next.rotation !== undefined ? next.rotation : 0) -
                         (prev.rotation !== undefined ? prev.rotation : 0)) * t;
                    const scale = (prev.scale !== undefined ? prev.scale : 1) +
                        ((next.scale !== undefined ? next.scale : 1) -
                         (prev.scale !== undefined ? prev.scale : 1)) * t;

                    // 关键帧数据优先使用 holdOffsetX/Y（当前主配置），并兼容 handOffsetX/Y / offsetX/Y
                    const prevOffsetX = prev.holdOffsetX !== undefined ? prev.holdOffsetX :
                        (prev.handOffsetX !== undefined ? prev.handOffsetX : prev.offsetX);
                    const nextOffsetX = next.holdOffsetX !== undefined ? next.holdOffsetX :
                        (next.handOffsetX !== undefined ? next.handOffsetX : next.offsetX);
                    const prevOffsetY = prev.holdOffsetY !== undefined ? prev.holdOffsetY :
                        (prev.handOffsetY !== undefined ? prev.handOffsetY : prev.offsetY);
                    const nextOffsetY = next.holdOffsetY !== undefined ? next.holdOffsetY :
                        (next.handOffsetY !== undefined ? next.handOffsetY : next.offsetY);

                    const offsetX = (prevOffsetX !== undefined ? prevOffsetX : 0) +
                        ((nextOffsetX !== undefined ? nextOffsetX : 0) -
                         (prevOffsetX !== undefined ? prevOffsetX : 0)) * t;
                    const offsetY = (prevOffsetY !== undefined ? prevOffsetY : 0) +
                        ((nextOffsetY !== undefined ? nextOffsetY : 0) -
                         (prevOffsetY !== undefined ? prevOffsetY : 0)) * t;

                    const kfOffset = { offsetX, offsetY, rotation, scale };

                    const kfPos = WeaponTransform.getKeyframedWeaponPosition(self, weaponType, 'attack', kfOffset, 0, facingRight);
                    weaponSprite.x = kfPos.x;
                    weaponSprite.y = kfPos.y;
                    weaponSprite.rotation = kfPos.rotation;
                    
                    if (self._pendingThrust && self._pendingThrust.active) {
                        if (Date.now() - self._pendingThrust.startTime <= 500) {
                            self.attacks.melee.checkTriangleHit(self);
                        } else {
                            self._pendingThrust.active = false;
                        }
                    }
                },
                onComplete: function() {
                    anim.isAttacking = false;
                    anim.state = 'idle';
                    const idlePos = WeaponTransform.getWeaponWorldPosition(self, weaponType, false, false, 'idle');
                    scene.tweens.add({
                        targets: weaponSprite,
                        x: idlePos.x,
                        y: idlePos.y,
                        rotation: WeaponTransform.getWeaponRotation(0, weaponType, 0, 'idle', Math.abs(self.rotation) < Math.PI / 2),
                        duration: 150,
                        ease: 'Cubic.easeOut'
                    });
                    if (self._pendingThrust) {
                        self._pendingThrust.active = false;
                        self.attacks.melee.giveExp(self);
                        self._pendingThrust = null;
                    }
                }
            });
            
            this._activeAttackTweens.push(attackTween);
        } else {
            const windupMs = 200;
            const swingMs = 300;
            const recoverMs = 400;
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
        }
        
        if (scene.setPlayerAnimation) {
            scene.setPlayerAnimation('attack_sword');
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
