const weaponAnimMixin = {
updateWeaponAnim(dt) {
                const wa = WEAPON_ANIM, anim = this.weaponAnim;
                switch (anim.state) {
                    case 'idle':
                        if (anim.spinEnd && Date.now() < anim.spinEnd) {
                            const t = 1 - (anim.spinEnd - Date.now()) / anim.spinDuration;
                            anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06 + t * Math.PI * 8;
                            break;
                        }
                        anim.spinEnd = 0;
                        anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06;
                        // 装备双手武器时不播放旋转待机动画
                        const _idleItem = this.equipments[this.weaponMode];
                        const _isTwoHandedIdle = _idleItem && isTwoHanded(_idleItem);
                        if (_isTwoHandedIdle) {
                            // 双手武器：清除所有旋转状态
                            anim.nextSpin = 0;
                            anim.spinEnd = 0;
                        } else if (!_isTwoHandedIdle) {
                            if (!anim.nextSpin) anim.nextSpin = Date.now() + 3000 + Math.random() * 3000;
                            if (Date.now() >= anim.nextSpin) {
                                anim.spinDuration = 650; // 650ms内完成4圈旋转
                                anim.spinEnd = Date.now() + anim.spinDuration;
                                anim.nextSpin = Date.now() + anim.spinDuration + 3000 + Math.random() * 3000;
                            }
                        }
                        break;
                    case 'rotate':
                        // 弓类旋转阶段：500ms，逆时针旋转14度，平滑过渡
                        anim.timer += dt;
                        if (anim.timer >= 500) {
                            anim.state = 'windup';
                            anim.timer = 0;
                            anim.rotateAngle = -14 * (Math.PI / 180); // 定格在-14度
                            // 旋转完成，进入攻击动画，播放拉弓音效
                            SoundManager.playFile('assets/sounds/rope_pull_1s.wav');
                        } else {
                            // easeInOutCubic 平滑插值
                            const t = anim.timer / 500;
                            const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                            anim.rotateAngle = -14 * easeT * (Math.PI / 180);
                        }
                        break;
                    case 'windup':
                        anim.spinEnd = 0; // 攻击打断旋转动画
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.windupMs)) { anim.state = 'swing'; anim.timer = 0; }
                        else {
                            const currentItem = this.equipments[this.weaponMode];
                            if (currentItem && (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword')) {
                                // 攻击动画已禁用，武器保持静止
                            } else {
                                anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * easeInQuad(anim.timer / this._getAnimMs(wa.windupMs));
                            }
                        }
                        break;
                    case 'swing':
                        // swing阶段：进行三角形攻击判定
                        if (anim.timer === 0 && this._pendingThrust) {
                            // swing阶段开始：标记攻击为活跃状态
                            this._pendingThrust.active = true;
                        }
                        // 每帧进行三角形命中判定（仅近战武器），判定窗口200ms
                        if (this._pendingThrust && this._pendingThrust.active) {
                            if (Date.now() - this._pendingThrust.startTime <= 200) {
                                this.attacks.melee.checkTriangleHit(this);
                            } else {
                                this._pendingThrust.active = false;
                            }
                        }
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.swingMs)) {
                            anim.state = 'recover';
                            anim.timer = 0;
                            // swing阶段结束：统一发放经验（只计算一次）
                            if (this._pendingThrust) {
                                this._pendingThrust.active = false;
                                this.attacks.melee.giveExp(this);
                            }
                        }
                        else {
                            const currentItem = this.equipments[this.weaponMode];
                            if (currentItem && (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword')) {
                                // 攻击动画已禁用，武器保持静止
                            } else {
                                anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * easeOutQuad(anim.timer / this._getAnimMs(wa.swingMs));
                            }
                            // swing阶段：根据当前装备类型决定发射逻辑
                            // 弓除外：弓在攻击动画（recover）结束后才射出箭矢
                            const isRangedWeapon = currentItem && (currentItem.weaponType === 'pistol' || currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'shotgun' || currentItem.weaponType === 'energy_lmg' || currentItem.rangedType === 'pistol');
                            const hasPendingMainShot = this.rangedFireData && this.rangedFireData.fireMainHand;
                            if ((!this.rangedFired || hasPendingMainShot) && isRangedWeapon && this.rangedFireData) this._fireRanged('main');
                        }
                        break;
                    case 'recover':
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.recoverMs)) {
                            // 攻击动画完毕，弓在攻击动画结束后射出箭矢
                            const currentItem = this.equipments[this.weaponMode];
                            if (currentItem && currentItem.weaponType === 'bow' && !this.rangedFired && this.rangedFireData) {
                                // 更新目标位置为攻击动画结束时的准星位置（当前鼠标世界坐标）
                                const mouseWorldX = Input.mouse.x + Camera.x - CONFIG.VIEW_WIDTH / 2;
                                const mouseWorldY = Input.mouse.y + Camera.y - CONFIG.VIEW_HEIGHT / 2;
                                this.rangedFireData.targetX = mouseWorldX;
                                this.rangedFireData.targetY = mouseWorldY;
                                SoundManager.playFile('assets/sounds/arrow_flyby_1s.mp3');
                                this._fireRanged('main');
                            }
                            // 进入 idle_return 状态，200ms 平滑旋转回待机角度
                            anim.state = 'idle_return';
                            anim.timer = 0;
                            // 恢复阶段结束，完全清除攻击数据
                            this._pendingThrust = null;
                        }
                        else {
                            const currentItem = this.equipments[this.weaponMode];
                            if (currentItem && (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword')) {
                                // 攻击动画已禁用，武器保持静止
                            } else {
                                anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * easeInOutCubic(anim.timer / this._getAnimMs(wa.recoverMs));
                            }
                        }
                        break;
                    case 'idle_return':
                        // 攻击动画完毕后，弓从旋转角度回待机角度，200ms 平滑过渡
                        anim.timer += dt;
                        if (anim.timer >= 200) {
                            anim.state = 'idle';
                            anim.timer = 0;
                            anim.rotateAngle = 0; // 清除旋转角度
                        } else {
                            // easeInOutCubic 从 -14 度回 0 度
                            const t = anim.timer / 200;
                            const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                            anim.rotateAngle = -14 * (1 - easeT) * (Math.PI / 180);
                        }
                        break;
                }
                // 同步副手攻击动画（双持时显示攻击特效）
                // 对于双持手枪，副手使用独立的动画计时
                if (this.offhandWeaponAnim) {
                    const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                    const offhandItem = this.equipments[offhandSlot];
                    const isDualPistol = offhandItem && (offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol');
                    if (isDualPistol) {
                        // 副手手枪：独立动画计时
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
                                if (offAnim.timer >= offRecoverMs) { offAnim.state = 'idle'; offAnim.timer = 0; }
                                break;
                        }
                    } else {
                        // 副手动画保持独立，不再同步主手动画
                        // 非双持状态下副手动画自行管理
                    }
                }
            },

_getAnimMs(baseMs) {
                // 根据当前装备的实际类型选择动画配置
                const currentItem = this.equipments[this.weaponMode];
                let cfgKey = 'sword'; // 默认
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') cfgKey = currentItem.animConfigKey || 'pistol';
                    else if (currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg') cfgKey = currentItem.weaponType;
                    else if (currentItem.weaponType === 'bow') cfgKey = 'bow';
                    else if (currentItem.weaponType === 'shotgun') cfgKey = 'shotgun';
                }
                const cfg = WeaponAnimConfig[cfgKey];
                // 弓：攻击动画时长 = 总攻击间隔 - 前摇 - 后摇，前摇/后摇不受攻击间隔影响
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
