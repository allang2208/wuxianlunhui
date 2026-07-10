// ============================================================
// Weapon Animation System - Phaser Tween Driven
// 替换旧的状态机系统，使用 Phaser Tween 驱动攻击动画
// ============================================================

import { isTwoHanded } from '../../config/gun-ammo.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';

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
        // 当前活动的 Tweens
        this._activeAttackTweens = [];
    },

    // 每帧更新（仅处理待机和非攻击状态）
    updateWeaponAnim(dt) {
        const wa = WEAPON_ANIM, anim = this.weaponAnim;
        
        // 攻击状态由 Phaser Tween 管理，这里只处理 idle
        if (anim.isAttacking) return;
        
        // 待机状态：呼吸动画 + 旋转待机动画
        if (anim.state === 'idle') {
            anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06;
            
            // 装备双手武器时不播放旋转待机动画
            const _idleItem = this.equipments[this.weaponMode];
            const _isTwoHandedIdle = _idleItem && isTwoHanded(_idleItem);
            if (!_isTwoHandedIdle) {
                if (!anim.nextSpin) anim.nextSpin = Date.now() + 3000 + Math.random() * 3000;
                if (Date.now() >= anim.nextSpin) {
                    anim.spinDuration = 650;
                    anim.spinEnd = Date.now() + anim.spinDuration;
                    anim.nextSpin = Date.now() + anim.spinDuration + 3000 + Math.random() * 3000;
                }
                if (anim.spinEnd && Date.now() < anim.spinEnd) {
                    const t = 1 - (anim.spinEnd - Date.now()) / anim.spinDuration;
                    anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06 + t * Math.PI * 8;
                }
            }
        }
    },

    // 触发攻击动画（别名，兼容旧代码调用）
    triggerWeaponAnim(hand = 'main') {
        return this.triggerAttackAnimation(hand);
    },

    // 触发攻击动画（由外部攻击系统调用）
    triggerAttackAnimation(hand = 'main') {
        const scene = window.__phaserScene;
        if (!scene) return;
        
        const currentItem = this.equipments[this.weaponMode];
        if (!currentItem) return;
        
        const isMelee = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
        
        if (isMelee) {
            // 剑类武器：使用 Phaser Tween 驱动攻击动画
            this._playSwordAttackTween(scene, hand);
            // 同时播放角色攻击动画
            if (scene.playerSprite) {
                scene.playerSprite.play('player_attack_sword', true);
                scene.playerSprite.once('animationcomplete', () => {
                    if (scene.playerSprite.anims.currentAnim?.key === 'player_attack_sword') {
                        scene.playerSprite.setTexture('player_idle');
                    }
                });
            }
        } else {
            // 远程武器（弓、枪械等）：调用 _fireRanged 发射子弹
            this._fireRanged(hand);
        }
    },

    // 剑类攻击 Tween 动画（支持关键帧）
    _playSwordAttackTween(scene, hand) {
        const anim = hand === 'offhand' ? this.offhandWeaponAnim : this.weaponAnim;
        if (anim.isAttacking) return; // 防止重复触发
        
        anim.isAttacking = true;
        anim.state = 'attacking';
        
        // 获取武器精灵
        const weaponSprite = hand === 'offhand' ? scene.offhandWeaponSprite : scene.weaponSprite;
        if (!weaponSprite) {
            anim.isAttacking = false;
            anim.state = 'idle';
            return;
        }
        
        // 保存初始状态
        const startRotation = weaponSprite.rotation;
        const startX = weaponSprite.x;
        const startY = weaponSprite.y;
        
        const self = this;
        
        // 检查是否有关键帧配置
        const currentWeapon = this.getCurrentWeapon ? this.getCurrentWeapon() : (this.equipments && this.weaponMode ? this.equipments[this.weaponMode] : null);
        const weaponType = currentWeapon ? (currentWeapon.weaponType || 'sword') : 'sword';
        const kfConfig = WeaponAnimConfig.keyframes && WeaponAnimConfig.keyframes[weaponType] && WeaponAnimConfig.keyframes[weaponType].attack;
        
        if (kfConfig && kfConfig.length >= 2) {
            // ===== 使用关键帧动画 =====
            
            anim.isAttacking = true;
            anim.state = 'attacking';
            
            // 创建单个 Tween，在 onUpdate 中根据进度插值关键帧
            const totalDuration = 900; // 总攻击时长 ms
            
            const attackTween = scene.tweens.add({
                targets: { progress: 0 },
                progress: 1,
                duration: totalDuration,
                ease: 'Linear',
                onStart: function() {
                    if (self._pendingThrust) {
                        self._pendingThrust.active = true;
                    }
                },
                onUpdate: function(tween) {
                    const progress = tween.getValue();
                    
                    // 关键帧插值
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
                    
                    // 线性插值
                    const offsetX = prev.offsetX + (next.offsetX - prev.offsetX) * t;
                    const offsetY = prev.offsetY + (next.offsetY - prev.offsetY) * t;
                    const rotation = prev.rotation + (next.rotation - prev.rotation) * t;
                    
                    // 转换为世界坐标（相对于玩家当前位置）
                    const playerRotation = self.rotation;
                    const cos = Math.cos(playerRotation);
                    const sin = Math.sin(playerRotation);
                    const facingRight = Math.abs(playerRotation) < Math.PI / 2;
                    const mirrorX = facingRight ? 1 : -1;
                    
                    // 使用 WeaponTransform 计算位置
                    const localX = offsetX * mirrorX;
                    const localY = offsetY;
                    
                    weaponSprite.x = self.x + (localX * cos - localY * sin);
                    weaponSprite.y = self.y + (localX * sin + localY * cos);
                    weaponSprite.rotation = (rotation * Math.PI / 180) * mirrorX;
                    
                    // 检测碰撞
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
            
        } else {
            // ===== 使用传统动画（无关键帧时回退）=====
            
            // 攻击参数
            const windupMs = 200;   // 预备时间
            const swingMs = 300;    // 挥砍时间
            const recoverMs = 400;  // 回位时间
            
            // 攻击角度（基于玩家朝向）
            const playerRotation = this.rotation;
            const windupAngle = startRotation - 0.5;  // 向后扬起
            const swingAngle = startRotation + 0.8;   // 向前挥砍
            
            // 攻击位移
            const thrustDistance = 20;
            const thrustX = Math.cos(playerRotation) * thrustDistance;
            const thrustY = Math.sin(playerRotation) * thrustDistance;
            
            const chain = scene.tweens.chain({
                tweens: [
                    // 阶段1：预备（windup）
                    {
                        targets: weaponSprite,
                        rotation: windupAngle,
                        x: startX - thrustX * 0.3,
                        y: startY - thrustY * 0.3,
                        duration: windupMs,
                        ease: 'Quad.easeIn',
                        onStart: function() {
                            if (self._pendingThrust) {
                                self._pendingThrust.active = true;
                            }
                        }
                    },
                    // 阶段2：挥砍（swing）
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
                    // 阶段3：回位（recover）
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
        
        // 同时播放玩家角色攻击动画
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

    // 获取动画时长（用于外部系统计算冷却）
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
