import { isGunWeapon, isTwoHanded } from '../../config/gun-ammo.js';
import { WeaponAnimConfig, getWeaponStateConfig } from '../../items/weapon-anim-config.js';

const renderMixin = {
renderHealthBar(ctx, x, y) {
                const barWidth = 40, barHeight = 6;
                const hpPercent = Math.max(0, this.data.hp / this.data.maxHp);
                const barY = y - this.size - 28;
                // 背景
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(x - barWidth/2, barY, barWidth, barHeight);
                // 血量
                let hpColor;
                if (hpPercent > 0.6) hpColor = '#4ade80';
                else if (hpPercent > 0.3) hpColor = '#facc15';
                else hpColor = '#ef4444';
                ctx.fillStyle = hpColor;
                ctx.fillRect(x - barWidth/2, barY, barWidth * hpPercent, barHeight);
                // 边框
                ctx.strokeStyle = 'rgba(60, 50, 40, 0.9)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x - barWidth/2, barY, barWidth, barHeight);
                // 血量文字（低于满血时显示）
                if (hpPercent < 1) {
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 9px SimHei, "Microsoft YaHei", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(`${Math.ceil(this.data.hp)}`, x, barY + barHeight/2 + 0.5);
                }
            },

renderStaminaBar(ctx, x, y) {
                const barWidth = 36, barHeight = 5, staminaPercent = this.data.stamina / this.data.maxStamina;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(x - barWidth/2, y + this.size + 36, barWidth, barHeight);
                const staminaColor = staminaPercent > 0.5 ? '#a09060' : staminaPercent > 0.25 ? '#a08040' : '#8a4a4a';
                ctx.fillStyle = staminaColor; ctx.fillRect(x - barWidth/2, y + this.size + 36, barWidth * staminaPercent, barHeight);
                ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)'; ctx.lineWidth = 1; ctx.strokeRect(x - barWidth/2, y + this.size + 36, barWidth, barHeight);
                // ===== 机枪过热条渲染（体力条下方 3px） =====
                if (this._overheatActive) {
                    const ohY = y + this.size + 36 + barHeight + 3;
                    const ohPercent = this._overheatValue;
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    ctx.fillRect(x - barWidth/2, ohY, barWidth, barHeight);
                    // 渐变红色：左边浅，右边深
                    const grad = ctx.createLinearGradient(x - barWidth/2, ohY, x + barWidth/2, ohY);
                    grad.addColorStop(0, '#ff6b6b');
                    grad.addColorStop(1, '#8a1a1a');
                    ctx.fillStyle = grad;
                    ctx.fillRect(x - barWidth/2, ohY, barWidth * ohPercent, barHeight);
                    ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x - barWidth/2, ohY, barWidth, barHeight);
                    // 过热时添加闪烁效果
                    if (this._overheatOverheated) {
                        const flicker = 0.5 + Math.sin(Date.now() / 100) * 0.3;
                        ctx.fillStyle = `rgba(255, 100, 100, ${flicker * 0.3})`;
                        ctx.fillRect(x - barWidth/2, ohY, barWidth, barHeight);
                    }
                }
                // ===== 换弹进度条渲染（过热条下方 3px，白色背景） =====
                const currentSlot = this.weaponMode;
                const currentItem = this.equipments[currentSlot];
                if (currentItem && isGunWeapon(currentItem)) {
                    const mainState = this._ammoState[currentSlot];
                    let nextY = y + this.size + 36 + barHeight + 3 + (this._overheatActive ? barHeight + 3 : 0);
                    if (mainState && mainState.reloading) {
                        const reloadPercent = 1 - (mainState.reloadTimer / mainState.reloadTime);
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                        ctx.fillRect(x - barWidth/2, nextY, barWidth, barHeight);
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(x - barWidth/2, nextY, barWidth * reloadPercent, barHeight);
                        ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(x - barWidth/2, nextY, barWidth, barHeight);
                        nextY += barHeight + 3;
                    }
                    // 双持时：副手换弹进度条（主手下方 3px）
                    const offhandSlot = currentSlot === 'weapon' ? 'offhand' : 'ring2';
                    const offhandItem = this.equipments[offhandSlot];
                    const isDualWield = offhandItem && offhandItem.name && !offhandItem.isTwoHanded; // Bug-4 统一双持判断：副手有装备且非双手武器
                    if (isDualWield) {
                        const offState = this._ammoState[offhandSlot];
                        if (offState && offState.reloading) {
                            const offReloadPercent = 1 - (offState.reloadTimer / offState.reloadTime);
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                            ctx.fillRect(x - barWidth/2, nextY, barWidth, barHeight);
                            ctx.fillStyle = '#cccccc'; // 副手用浅灰色区分
                            ctx.fillRect(x - barWidth/2, nextY, barWidth * offReloadPercent, barHeight);
                            ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)';
                            ctx.lineWidth = 1;
                            ctx.strokeRect(x - barWidth/2, nextY, barWidth, barHeight);
                        }
                    }
                }
            },

renderWeapon(ctx) {
                const wa = WEAPON_ANIM;
                const s = wa.size;
                const ms = s * 0.75;
                // 获取当前武器栏位的装备
                let currentItem = this.equipments[this.weaponMode];
                // 如果当前栏位无装备，但另一栏位有装备，显示另一栏位的装备
                if (!currentItem || !currentItem.name) {
                    const otherSlot = this.weaponMode === 'weapon' ? 'weapon2' : 'weapon';
                    const otherItem = this.equipments[otherSlot];
                    if (otherItem && otherItem.name) {
                        currentItem = otherItem;
                    }
                }
                if (!currentItem || !currentItem.name) return; // 两个栏位都为空，不渲染

                // 如果 Phaser 渲染武器，检查是否需要 Canvas 渲染特殊动画
                const anim = this.weaponAnim;
                const isMeleeWeapon = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
                const isBowAttacking = currentItem.weaponType === 'bow' && anim.state !== 'idle';
                const isSpecialAnim = this._isWhirlwind || this._isDashing || this._dashResetAnim || this._specialAttackActive || this._specialResetAnim || this._runeSwordSpecialActive || this._runeSwordResetAnim || isBowAttacking;
                if (this._usePhaserWeapon && !isSpecialAnim) {
                    // Phase 1/2/3: 武器本体由 Phaser 渲染，Canvas 不再绘制任何武器
                    // 保留符文粒子：在 return 前绘制常驻粒子效果
                    if (currentItem && currentItem.weaponEffect === 'runeSword') {
                        let animState = 'idle';
                        if (this._isSprinting) animState = 'running';
                        else if (this.isMoving) animState = 'walk';
                        const swordCfg = getWeaponStateConfig('sword', animState);
                        ctx.save();
                        ctx.translate(-7, 0); // mainBaseX
                        ctx.translate(swordCfg.holdOffsetX || wa.holdX, swordCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -ms * 0.85);
                        this.weaponEffect.render(ctx);
                        ctx.restore();
                    }
                    return;
                }
                // 预加载另一栏位装备的图片
                const actualItem = this.equipments[this.weaponMode];
                if ((!actualItem || !actualItem.name) && currentItem.equipImage) {
                    if (this._lastFallbackItem !== currentItem.equipImage) {
                        this._lastFallbackItem = currentItem.equipImage;
                        if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') {
                            if (currentItem.canvasImageProp === 'deagleImage') {
                                this.deagleImage = new Image();
                                this.deagleImage.src = currentItem.equipImage;
                            } else {
                                this.pistolImage = new Image();
                                this.pistolImage.src = currentItem.equipImage;
                            }
                        } else if (currentItem.weaponType === 'pkm') {
                            this.pkmImage = new Image();
                            this.pkmImage.src = currentItem.equipImage;
                        } else if (currentItem.weaponType === 'akm') {
                            this.akmImage = new Image();
                            this.akmImage.src = currentItem.weaponAsset?.image || currentItem.equipImage;
                        } else if (currentItem.weaponType === 'qbz191') {
                            this.qbz191Image = new Image();
                            this.qbz191Image.src = currentItem.equipImage;
                        } else if (currentItem.weaponType === 'qjb201') {
                            this.qjb201Image = new Image();
                            this.qjb201Image.src = currentItem.equipImage;
                        } else if (currentItem.weaponType === 'shotgun') {
                            if (currentItem.canvasImageProp) {
                                this[currentItem.canvasImageProp] = new Image();
                                this[currentItem.canvasImageProp].src = currentItem.equipImage;
                            }
                        } else if (currentItem.weaponType === 'bow') {
                            // 弓帧动画在 switchWeaponMode 中处理
                        } else {
                            this.meleeImage = new Image();
                            this.meleeImage.src = currentItem.equipImage;
                        }
                    }
                }
                // 判断当前装备类型
                const isPistol = currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol';
                const isBow = currentItem.weaponType === 'bow';
                const isPkmOrAkm = currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg';
                const isShotgun = currentItem.weaponType === 'shotgun';
                const isMelee = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
                const isAttacking = anim.state !== 'idle';
                const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const offhandItem = this.equipments[offhandSlot];
                const isDualWield = offhandItem && offhandItem.name && !offhandItem.isTwoHanded; // Bug-4 统一双持判断：副手有装备且非双手武器
                // 武器位置根据类型调整：手枪/近战/弓后退5px，双手枪械保持原位置
                let mainBaseX, mainBaseY, offBaseX, offBaseY;
                if (isPistol) {
                    // 手枪（单持或双持）统一使用双持主手位置
                    mainBaseX = -15; mainBaseY = 16.5;
                    offBaseX = -5; offBaseY = -16.5;
                } else if (isPkmOrAkm || isShotgun) {
                    // 双手枪械：恢复为之前版本的位置
                    mainBaseX = isDualWield ? 0 : 8;
                    mainBaseY = isDualWield ? 8 : 0;
                    offBaseX = 0; offBaseY = -8;
                } else {
                    // 近战/弓：后退5px，双持时间距增加7px
                    mainBaseX = isDualWield ? -15 : -7;
                    mainBaseY = isDualWield ? 16.5 : 0;
                    offBaseX = -5; offBaseY = -16.5;
                }
                ctx.save();
                ctx.translate(mainBaseX, mainBaseY);
                const wpnDir = this._getFacingDirection();
                // 武器挂载点（固定偏移，不再依赖精灵图）
                const mountX = wpnDir === 'left' ? -15 : 15;
                const mountY = wpnDir === 'left' ? 10 : -10;
                ctx.translate(mountX, mountY);
                if (wpnDir === 'left' || wpnDir === 'right') {
                    ctx.scale(-1, 1);
                }
                if (wpnDir === 'up') {
                    ctx.translate(0, -5);
                } else if (wpnDir === 'down') {
                    ctx.translate(0, 5);
                }
                // === 手枪渲染 ===
                if (isPistol) {
                    const pCfg = WeaponAnimConfig[currentItem.animConfigKey || 'pistol'];
                    const rp = pCfg.renderParams || {};
                    const weaponImg = currentItem.canvasImageProp ? this[currentItem.canvasImageProp] : this.pistolImage;
                    if (isAttacking) {
                        let recoil = 0, shakeY = 0;
                        if (anim.state === 'windup') {
                            recoil = -s * (rp.recoilWindup || 0.04) * easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        } else if (anim.state === 'swing') {
                            const st = anim.timer / this._getAnimMs(wa.swingMs);
                            recoil = s * (rp.recoilSwing || 0.1) * (1 - st);
                            shakeY = (Math.random() - 0.5) * (rp.shakeIntensity || 3) * (1 - st);
                        } else {
                            const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                            recoil = -s * (rp.recoilRecover || 0.04) * (1 - rt);
                        }
                        const ps = pCfg.idleScale || 1;
                        const gunX = (pCfg.holdOffsetX || 0) + recoil;
                        ctx.translate(gunX, (pCfg.holdOffsetY || 0) + shakeY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        const pw = s * 0.275 * ps; const ph = s * 0.5 * ps;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -pw / 2, 0, pw, ph);
                    } else {
                        // 主手手枪待机：武器中心为旋转轴
                        const pCfg = WeaponAnimConfig[currentItem.animConfigKey || 'pistol'];
                        const ps = pCfg.idleScale || 1;
                        ctx.translate(pCfg.holdOffsetX || 0, pCfg.holdOffsetY || 0);
                        ctx.rotate(Math.PI / 2);
                        let finalAngle = anim.angle;
                        // 待机动画1：轻微摆动（始终生效）
                        if (anim.state === 'idle' && !anim.spinEnd) {
                            finalAngle += (pCfg.idleRotation || 0) * Math.PI / 180;
                            finalAngle += Math.sin(this.animTime * 0.4) * 0.02;
                            if (this.isMoving) {
                                const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                                finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                            }
                        }
                        ctx.translate(0, -s * 0.42);
                        ctx.rotate(finalAngle);
                        const pw = s * 0.275 * ps; const ph = s * 0.5 * ps;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -pw / 2, -ph / 2, pw, ph);
                    }
                }
                // === PKM / AKM 渲染 ===
                else if (isPkmOrAkm) {
                    const isActuallyPkm = currentItem.weaponType === 'pkm';
                    const pCfg = WeaponAnimConfig[currentItem.weaponType] || WeaponAnimConfig.akm;
                    let weaponImg;
                    if (isActuallyPkm) weaponImg = this.pkmImage;
                    else if (currentItem.weaponType === 'qbz191') weaponImg = this.qbz191Image;
                    else if (currentItem.weaponType === 'qjb201') weaponImg = this.qjb201Image;
                    else if (currentItem.weaponType === 'energy_lmg') weaponImg = this.energyLmgImage;
                    else weaponImg = this.akmImage;
                    if (isAttacking) {
                        let recoil = 0, shakeY = 0;
                        if (anim.state === 'windup') {
                            recoil = -s * 0.03 * easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        } else if (anim.state === 'swing') {
                            const st = anim.timer / this._getAnimMs(wa.swingMs);
                            recoil = s * 0.08 * (1 - st);
                            shakeY = (Math.random() - 0.5) * 4 * (1 - st);
                        } else {
                            const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                            recoil = -s * 0.03 * (1 - rt);
                        }
                        const gunX = (pCfg.holdOffsetX || 0) + recoil;
                        ctx.translate(gunX, (pCfg.holdOffsetY || 0) + shakeY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        const scale = pCfg.idleScale || 1;
                        const w = s * 0.75 * scale;
                        const h = s * scale;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -w / 2, 0, w, h);
                    } else {
                        ctx.translate(pCfg.holdOffsetX || 0, pCfg.holdOffsetY || 0);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        let finalAngle = anim.angle;
                        // 待机动画1：轻微摆动（始终生效）
                        if (anim.state === 'idle' && !anim.spinEnd) {
                            finalAngle += (pCfg.idleRotation || 0) * Math.PI / 180;
                            finalAngle += Math.sin(this.animTime * 0.4) * 0.02;
                            if (this.isMoving) {
                                const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                                finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                            }
                        }
                        ctx.rotate(finalAngle);
                        const scale = pCfg.idleScale || 1;
                        const w = s * 0.75 * scale;
                        const h = s * scale;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -w / 2, 0, w, h);
                    }
                }
                // === Super90 散弹枪渲染 ===
                else if (isShotgun) {
                    const pCfg = WeaponAnimConfig.shotgun || WeaponAnimConfig.akm;
                    const currentItem = this.equipments[this.weaponMode];
                    const weaponImg = currentItem && currentItem.canvasImageProp ? this[currentItem.canvasImageProp] : null;
                    if (isAttacking) {
                        let recoil = 0, shakeY = 0;
                        if (anim.state === 'windup') {
                            recoil = -s * 0.04 * easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        } else if (anim.state === 'swing') {
                            const st = anim.timer / this._getAnimMs(wa.swingMs);
                            recoil = s * 0.12 * (1 - st);
                            shakeY = (Math.random() - 0.5) * 5 * (1 - st);
                        } else {
                            const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                            recoil = -s * 0.04 * (1 - rt);
                        }
                        const gunX = (pCfg.holdOffsetX || 0) + recoil;
                        ctx.translate(gunX, (pCfg.holdOffsetY || 0) + shakeY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        const scale = pCfg.idleScale || 1;
                        const w = s * 0.75 * scale;
                        const h = s * scale;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -w / 2, 0, w, h);
                    } else {
                        ctx.translate(pCfg.holdOffsetX || 0, pCfg.holdOffsetY || 0);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        let finalAngle = anim.angle;
                        // 待机动画1：轻微摆动（始终生效）
                        if (anim.state === 'idle' && !anim.spinEnd) {
                            finalAngle += (pCfg.idleRotation || 0) * Math.PI / 180;
                            finalAngle += Math.sin(this.animTime * 0.4) * 0.02;
                            if (this.isMoving) {
                                const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                                finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                            }
                        }
                        ctx.rotate(finalAngle);
                        const scale = pCfg.idleScale || 1;
                        const w = s * 0.75 * scale;
                        const h = s * scale;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -w / 2, 0, w, h);
                    }
                }
                // === 弓渲染 ===
                else if (isBow) {
                    // 弓攻击：已迁移到 Phaser syncWeapon（bow_attack spritesheet），Canvas 跳过
                    if (this._usePhaserWeapon) {
                        return;
                    }
                    if (isAttacking && anim.state !== 'rotate' && anim.state !== 'idle_return') {
                        // windup / swing / recover 阶段：帧动画
                        let t = 0;
                        if (anim.state === 'windup') t = easeOutQuad(anim.timer / wa.windupMs);
                        else if (anim.state === 'swing') t = 1;
                        else if (anim.state === 'recover') t = 1 - easeInQuad(anim.timer / wa.recoverMs);

                        // 弓攻击动画：在旋转后的角度播放，固定朝向为 idleRotation + rotateAngle
                        const bowCfg = WeaponAnimConfig.bow;
                        ctx.translate(bowCfg.holdOffsetX || wa.holdX, bowCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        // 固定旋转到 idleRotation 角度 + 旋转阶段的角度（攻击在旋转后角度播放）
                        let finalAngle = 0;
                        if (bowCfg.idleRotation) {
                            finalAngle += bowCfg.idleRotation * Math.PI / 180;
                        }
                        // 加上旋转阶段的角度（攻击动画在旋转后的角度播放）
                        finalAngle += anim.rotateAngle || 0;
                        ctx.rotate(finalAngle);

                        const scale = bowCfg.idleScale || 1;

                        if (anim.state === 'recover') {
                            // recover 阶段：使用待机贴图，避免从帧动画切换到待机贴图的跳变
                            const bowImgIdle = this.bowEquipImage;
                            if (bowImgIdle && bowImgIdle.complete && bowImgIdle.naturalWidth > 0) {
                                const baseH = s * scale;
                                const aspect = bowImgIdle.naturalWidth / bowImgIdle.naturalHeight;
                                const w = baseH * aspect;
                                const h = baseH;
                                ctx.drawImage(bowImgIdle, -w / 2, -h / 2, w, h);
                            }
                        } else {
                            // windup / swing 阶段：显示帧动画
                            // 动态帧数弓动画
                            const frames = this.equippedBowFrames || this.bowFrames;
                            const frameCount = frames.length;
                            let frameIdx = 0;
                            const totalMs = wa.windupMs + wa.swingMs + wa.recoverMs;
                            let attackProgress = 0;
                            if (anim.state === 'windup') attackProgress = anim.timer / totalMs;
                            else if (anim.state === 'swing') attackProgress = (wa.windupMs + anim.timer) / totalMs;
                            else if (anim.state === 'recover') attackProgress = (wa.windupMs + wa.swingMs + anim.timer) / totalMs;
                            if (frameCount > 0) {
                                frameIdx = Math.min(frameCount - 1, Math.floor(attackProgress * frameCount));
                            }
                            const bowImg = frames[frameIdx] || frames[0];
                            if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) {
                                const baseH = s * scale * 0.80; // 攻击帧缩小20%
                                const aspect = bowImg.naturalWidth / bowImg.naturalHeight;
                                const w = baseH * aspect;
                                const h = baseH;
                                ctx.drawImage(bowImg, -w / 2, -h / 2, w, h);
                            } else {
                                // 帧加载失败时，绘制待机贴图作为备用
                                const bowImgIdle = this.bowEquipImage;
                                if (bowImgIdle && bowImgIdle.complete && bowImgIdle.naturalWidth > 0) {
                                    const baseH = s * scale;
                                    const aspect = bowImgIdle.naturalWidth / bowImgIdle.naturalHeight;
                                    const w = baseH * aspect;
                                    const h = baseH;
                                    ctx.drawImage(bowImgIdle, -w / 2, -h / 2, w, h);
                                }
                            }
                        }
                    } else if (anim.state === 'rotate') {
                        // rotate 阶段：显示静态贴图并应用旋转
                        const bowCfg = WeaponAnimConfig.bow;
                        ctx.translate(bowCfg.holdOffsetX || wa.holdX, bowCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        let finalAngle = 0;
                        if (bowCfg.idleRotation) {
                            finalAngle += bowCfg.idleRotation * Math.PI / 180;
                        }
                        // 应用 rotateAngle（逆时针旋转，即负角度）
                        finalAngle += anim.rotateAngle || 0;
                        ctx.rotate(finalAngle);
                        const scale = bowCfg.idleScale || 1;
                        const bowImg = this.bowEquipImage;
                        if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) {
                            const baseH = s * scale * 1.10; // 待机贴图增大10%
                            const aspect = bowImg.naturalWidth / bowImg.naturalHeight;
                            const w = baseH * aspect;
                            const h = baseH;
                            ctx.drawImage(bowImg, -w / 2, -h / 2, w, h);
                        } else {
                            const frames = this.equippedBowFrames || this.bowFrames;
                            const fallbackImg = frames[0];
                            if (fallbackImg && fallbackImg.complete && fallbackImg.naturalWidth > 0) {
                                const w = s * 0.6 * scale * 1.10;
                                const h = s * scale * 1.10;
                                ctx.drawImage(fallbackImg, -w / 2, -h / 2, w, h);
                            }
                        }
                    } else {
                        // 弓待机：使用装备栏贴图（trainingBOW.png），支持 WeaponAnimConfig 配置，带呼吸摆动
                        const bowCfg = WeaponAnimConfig.bow;
                        ctx.translate(bowCfg.holdOffsetX || wa.holdX, bowCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        // 应用 idleRotation + 呼吸摆动
                        let finalAngle = Math.sin(Date.now() / 400) * 0.06;
                        if (bowCfg.idleRotation) {
                            finalAngle += bowCfg.idleRotation * Math.PI / 180;
                        }
                        ctx.rotate(finalAngle);
                        const scale = bowCfg.idleScale || 1;
                        // 使用装备栏贴图 trainingBOW.png，根据原始比例动态缩放
                        const bowImg = this.bowEquipImage;
                        if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) {
                            const baseH = s * scale * 1.10; // 待机贴图增大10%
                            const aspect = bowImg.naturalWidth / bowImg.naturalHeight;
                            const w = baseH * aspect;
                            const h = baseH;
                            ctx.drawImage(bowImg, -w / 2, -h / 2, w, h);
                        } else {
                            // 备用：使用 bowFrames[0]
                            const frames = this.equippedBowFrames || this.bowFrames;
                            const fallbackImg = frames[0];
                            if (fallbackImg && fallbackImg.complete && fallbackImg.naturalWidth > 0) {
                                const w = s * 0.6 * scale * 1.10;
                                const h = s * scale * 1.10;
                                ctx.drawImage(fallbackImg, -w / 2, -h / 2, w, h);
                            }
                        }
                    }
                }
                // === 近战（剑等）渲染 ===
                else if (isMelee) {
                    const ms = s * 0.75;
                    if (this._isWhirlwind) {
                        // 风车技能：武器跟随人物整体旋转（旋转在 render() 中已处理）
                        // Phase 迁移：已迁移到 Phaser _syncSpecialWeaponAnim，Canvas 跳过
                        /*
                        const w = ms * 0.63;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        let whirlwindOffset = 0;
                        if (this._whirlwindTimer <= 50) {
                            whirlwindOffset = 15 * easeOutQuad(this._whirlwindTimer / 50);
                        } else {
                            whirlwindOffset = 15;
                        }
                        ctx.translate(0, whirlwindOffset);
                        ctx.translate(0, -ms * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                        */
                    } else if (this._isDashing) {
                        // ===== 冲刺攻击武器动画 =====
                        // Phase 迁移：已迁移到 Phaser _syncSpecialWeaponAnim，Canvas 跳过
                        /*
                        const activeSkillId = this._getActiveDashSkillId();
                        const state = this.dashSystem._getDashWeaponStateAt(this._dashTimer, activeSkillId);
                        const w = ms * 0.63;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, state.dashOffset);
                        ctx.rotate(state.dashAngle);
                        ctx.translate(0, -ms * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                        */
                    } else if (this._dashResetAnim) {
                        // 冲刺攻击后复位动画：旋转与回位同步进行（0-100%）
                        // Phase 迁移：已迁移到 Phaser _syncSpecialWeaponAnim，Canvas 跳过
                        /*
                        const elapsed = Date.now() - this._dashResetAnim.startTime;
                        const t = Math.min(1, elapsed / this._dashResetAnim.duration);
                        const w = ms * 0.63;
                        const easeT = easeOutQuart(t);
                        const currentAngle = this._dashResetAnim.startAngle * (1 - easeT);
                        const currentOffset = this._dashResetAnim.startOffset * (1 - easeT);
                        const attackBaseX = wa.holdX + 8;
                        const attackBaseY = wa.holdY + 6;
                        const idleBaseX = wa.holdX;
                        const idleBaseY = wa.holdY;
                        const currentBaseX = attackBaseX + (idleBaseX - attackBaseX) * easeT;
                        const currentBaseY = attackBaseY + (idleBaseY - attackBaseY) * easeT;
                        ctx.translate(currentBaseX, currentBaseY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, currentOffset);
                        ctx.rotate(currentAngle);
                        ctx.translate(0, -ms * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                        */
                    } else if (this._specialResetAnim) {
                        // 特殊攻击后复位动画：同步旋转+回位
                        // Phase 迁移：已迁移到 Phaser _syncSpecialWeaponAnim，Canvas 跳过
                        /*
                        const elapsed = Date.now() - this._specialResetAnim.startTime;
                        const t = Math.min(1, elapsed / this._specialResetAnim.duration);
                        const easeT = easeOutQuart(t);
                        const w = ms * 0.63;
                        const currentAngle = this._specialResetAnim.startAngle * (1 - easeT);
                        const currentOffset = this._specialResetAnim.startOffset * (1 - easeT);
                        const attackBaseX = wa.holdX + 8;
                        const attackBaseY = wa.holdY + 6;
                        const idleBaseX = wa.holdX;
                        const idleBaseY = wa.holdY;
                        const currentBaseX = attackBaseX + (idleBaseX - attackBaseX) * easeT;
                        const currentBaseY = attackBaseY + (idleBaseY - attackBaseY) * easeT;
                        ctx.translate(currentBaseX, currentBaseY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, currentOffset);
                        ctx.rotate(currentAngle);
                        ctx.translate(0, -ms * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                        */
                    } else if (this._specialAttackActive) {
                        // 特殊攻击期间：武器前伸15px
                        // Phase 迁移：已迁移到 Phaser _syncSpecialWeaponAnim，Canvas 跳过
                        /*
                        const w = ms * 0.63;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -ms * 0.85);
                        ctx.translate(0, -15); // 武器前伸 15px（减半）
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                        */
                    } else if (isAttacking) {
                        // 使用刺击动画配置（Stab Animation），可被所有剑类武器复用
                        // Phase 2: 已迁移到 Phaser syncWeapon 刺击位移，Canvas 跳过
                        // 保留符文粒子（Phase 3 已迁移）
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            let animState = 'idle';
                            if (this._isSprinting) animState = 'running';
                            else if (this.isMoving) animState = 'walk';
                            const swordCfg = getWeaponStateConfig('sword', animState);
                            ctx.save();
                            ctx.translate(-7, 0); // mainBaseX
                            ctx.translate(swordCfg.holdOffsetX || wa.holdX, swordCfg.holdOffsetY || wa.holdY);
                            ctx.rotate(Math.PI / 2);
                            ctx.translate(0, -ms * 0.85);
                            this.weaponEffect.render(ctx);
                            ctx.restore();
                        }
                    } else {
                        // 近战待机：武器固定在绑定位置，不随鼠标旋转
                        // Phase 1: 武器本体由 Phaser 渲染，Canvas 不再绘制
                        // 保留符文粒子（Phase 3 会迁移到 Phaser）
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            let animState = 'idle';
                            if (this._isSprinting) animState = 'running';
                            else if (this.isMoving) animState = 'walk';
                            const swordCfg = getWeaponStateConfig('sword', animState);
                            ctx.save();
                            ctx.translate(-7, 0); // mainBaseX
                            ctx.translate(swordCfg.holdOffsetX || wa.holdX, swordCfg.holdOffsetY || wa.holdY);
                            ctx.rotate(Math.PI / 2);
                            ctx.translate(0, -ms * 0.85);
                            this.weaponEffect.render(ctx);
                            ctx.restore();
                        }
                        // 不绘制武器本体（Phaser 已渲染）
                        // const scale = swordCfg.idleScale || 1;
                        // const w = ms * 0.63 * scale;
                        // const h = ms * scale;
                        // if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) ctx.drawImage(this.meleeImage, -w / 2, -h / 2, w, h);
                    }
                }
                ctx.restore(); // 恢复主手前的坐标系，副手将在角色原始坐标系中绘制
                // === 副手渲染（角色左方，独立动画）===
                if (isDualWield && offhandItem && offhandItem.name) {
                    const offIsPistol = offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol';
                    const offIsPkmOrAkm = offhandItem.weaponType === 'pkm' || offhandItem.weaponType === 'akm' || offhandItem.weaponType === 'qbz191' || offhandItem.weaponType === 'qjb201';
                    const offIsBow = offhandItem.weaponType === 'bow';
                    const offIsMelee = offhandItem.category === 'weapon_melee' || offhandItem.weaponType === 'sword';

                    // 副手独立动画（跟随主手攻击状态）
                    const offhandAnim = this.offhandWeaponAnim || { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle };
                    // 待机时：呼吸效果
                    if (offhandAnim.state === 'idle') {
                        // 副手待机动画2：360度旋转（与主手独立触发时间）
                        // 装备机枪时不播放旋转待机动画
                        const offhandItemForIdle = this.equipments[offhandSlot];
                        const offhandIsMachineGun = offhandItemForIdle && (offhandItemForIdle.weaponType === 'pkm' || offhandItemForIdle.weaponType === 'akm' || offhandItemForIdle.weaponType === 'qbz191' || offhandItemForIdle.weaponType === 'qjb201');
                        if (offhandAnim.spinEnd && Date.now() < offhandAnim.spinEnd) {
                            const t = 1 - (offhandAnim.spinEnd - Date.now()) / offhandAnim.spinDuration;
                            offhandAnim.angle = WEAPON_ANIM.idleAngle + Math.sin(Date.now() / 400) * 0.06 + t * Math.PI * 8;
                        } else {
                            offhandAnim.spinEnd = 0;
                            offhandAnim.angle = WEAPON_ANIM.idleAngle + Math.sin(Date.now() / 400) * 0.06;
                            if (this.isMoving && !offhandAnim.spinEnd) {
                                const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                                offhandAnim.angle += Math.sin(this.animTime * 0.5) * Math.min(0.15, mSpeed * 0.04);
                            }
                            // 副手独立旋转触发时间（偏移1500ms避免与主手同步）
                            if (!offhandIsMachineGun) {
                                if (!offhandAnim.nextSpin) offhandAnim.nextSpin = Date.now() + 4500 + Math.random() * 3000;
                                if (Date.now() >= offhandAnim.nextSpin) {
                                    offhandAnim.spinDuration = 650;
                                    offhandAnim.spinEnd = Date.now() + offhandAnim.spinDuration;
                                    offhandAnim.nextSpin = Date.now() + offhandAnim.spinDuration + 4500 + Math.random() * 3000;
                                }
                            }
                        }
                    }

                    const offIsAttacking = offhandAnim.state !== 'idle';
                    ctx.save();
                    ctx.translate(offBaseX, offBaseY); // 副手位置
                    // 副手武器挂载点（固定偏移）
                    const mountX = wpnDir === 'left' ? 15 : -15;
                    const mountY = wpnDir === 'left' ? 10 : -10;
                    ctx.translate(mountX, mountY);
                    if (wpnDir === 'left' || wpnDir === 'right') {
                        ctx.scale(-1, 1);
                    }
                    if (wpnDir === 'up') {
                        ctx.translate(0, -5);
                    } else if (wpnDir === 'down') {
                        ctx.translate(0, 5);
                    }
                    ctx.rotate(Math.PI / 2);

                    let offhandImg, w, drawY, drawH = s;
                    if (offIsPistol) {
                        const offPCfg = WeaponAnimConfig[offhandItem.animConfigKey || 'pistol'];
                        const offRp = offPCfg.renderParams || {};
                        const offPs = offPCfg.idleScale || 1;
                        offhandImg = offhandItem.equipImage ? (() => { const img = new Image(); img.src = offhandItem.equipImage; return img; })() : this.pistolImage;
                        const pw = s * 0.275 * offPs; const ph = s * 0.5 * offPs;
                        if (offIsAttacking) {
                            let recoil = 0, shakeY = 0;
                            const offWindupMs = this._getOffhandAnimMs(offhandItem, wa.windupMs);
                            const offSwingMs = this._getOffhandAnimMs(offhandItem, wa.swingMs);
                            const offRecoverMs = this._getOffhandAnimMs(offhandItem, wa.recoverMs);
                            if (offhandAnim.state === 'windup') {
                                recoil = -s * (offRp.recoilWindup || 0.04) * easeOutQuad(offhandAnim.timer / offWindupMs);
                            } else if (offhandAnim.state === 'swing') {
                                const st = offhandAnim.timer / offSwingMs;
                                recoil = s * (offRp.recoilSwing || 0.1) * (1 - st);
                                shakeY = (offRp.shakeIntensity || 3) === 0 ? 0 : (Math.random() - 0.5) * (offRp.shakeIntensity || 3) * (1 - st);
                            } else {
                                const rt = offhandAnim.timer / offRecoverMs;
                                recoil = -s * (offRp.recoilRecover || 0.04) * (1 - rt);
                            }
                            ctx.translate(recoil, shakeY);
                            ctx.translate(0, -s * 0.42);
                            w = pw; drawY = 0; drawH = ph;
                        } else {
                            ctx.translate(0, -s * 0.42);
                            w = pw; drawY = -ph / 2; drawH = ph;
                        }
                    } else if (offIsPkmOrAkm) {
                        if (offhandItem.weaponType === 'pkm') offhandImg = this.pkmImage;
                        else if (offhandItem.weaponType === 'qbz191') offhandImg = this.qbz191Image;
                        else if (offhandItem.weaponType === 'qjb201') offhandImg = this.qjb201Image;
                        else offhandImg = this.akmImage;
                        w = s * 0.75;
                        ctx.translate(0, -s * 0.42);
                        drawY = 0;
                    } else if (offIsBow) {
                        const frames = offhandItem.bowFrames || this.bowFrames;
                        offhandImg = frames[0];
                        w = s * 0.6;
                        ctx.translate(0, -s / 2);
                        drawY = -s / 2;
                    } else if (offIsMelee) {
                        const ms = s * 0.75;
                        offhandImg = offhandItem.equipImage ? (() => { const img = new Image(); img.src = offhandItem.equipImage; return img; })() : this.meleeImage;
                        w = ms * 0.63;
                        ctx.translate(0, -ms * 0.85);
                        drawY = -ms / 2;
                        drawH = ms;
                    }

                    ctx.rotate(offhandAnim.angle);

                    // Phase 2: 副手攻击动画已迁移到 Phaser，Canvas 不再绘制武器本体
                    // if (offhandAnim.state !== 'idle') {
                    //     if (offhandImg && offhandImg.complete && offhandImg.naturalWidth > 0) {
                    //         ctx.drawImage(offhandImg, -w / 2, drawY, w, drawH);
                    //     } else {
                    //         ctx.fillStyle = '#4a4a5a'; ctx.fillRect(-w/2, -s/2, w, s);
                    //     }
                    // }
                    // idle 状态：武器本体由 Phaser 渲染（Phase 2 已迁移攻击动画）

                    ctx.restore();
                }
                // ===== 边境长弓蓄力满闪光特效（武器） =====
                if (this._chargeFlashActive && currentItem && currentItem.chargeAttack) {
                    const flashAlpha = Math.min(1, this._chargeFlashTimer / 500);
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.7})`;
                    ctx.fillRect(-60, -60, 120, 120);
                    ctx.globalCompositeOperation = 'source-over';
                }
                ctx.restore(); // 恢复 renderWeapon 开始的 ctx.save()
            },

render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y), x = pos.x, y = pos.y + (this.isDodging ? 0 : Math.sin(this.animTime) * 2);

                // ===== Phaser 渲染同步（在 ctx.save() 之前，避免 Canvas 状态不匹配）=====
                this._usePhaserSprite = false; // 默认 Canvas 渲染
                const phaserScene = window.__phaserScene;
                if (phaserScene && phaserScene.playerSprite) {
                    const sprite = phaserScene.playerSprite;
                    const spriteSize = this.size * 6.25; // 与原有 Canvas 渲染一致：112.5
                    // 只有在非 Velocity 模式下才设置位置
                    // Velocity 模式下位置由 Phaser 物理引擎控制，手动设置会覆盖物理引擎的计算
                    if (!phaserScene._useVelocityDrive) {
                        sprite.setPosition(this.x, this.y);
                    }
                    // 统一缩放：所有角色动画帧的目标显示尺寸为 112.5px
                    // 无论 idle 单图还是 spritesheet，都按单帧 512px 计算缩放
                    const FRAME_SIZE = 512;
                    const scale = spriteSize / FRAME_SIZE;
                    sprite.setScale(scale);
                    // 根据朝向设置左右翻转（只保留左右朝向）
                    // rotation: 0=右, PI/2=下, PI=左, -PI/2=上
                    const facingRight = Math.abs(this.rotation) < Math.PI / 2;
                    sprite.setFlipX(!facingRight);
                    
                    if (this.isMoving) {
                        // 攻击动画播放时不覆盖
                        const isPlayingAttack = sprite.anims.isPlaying && sprite.anims.currentAnim && sprite.anims.currentAnim.key === 'player_attack_sword';
                        if (!isPlayingAttack) {
                            // 使用 Phaser 动画系统播放 walk/run
                            const animKey = this._isSprinting ? 'player_run' : 'player_walk';
                            const currentAnim = sprite.anims.currentAnim?.key;
                            if (currentAnim !== animKey || !sprite.anims.isPlaying) {
                                sprite.play(animKey, true);
                            }
                        }
                        sprite.setRotation(0); // 不旋转，只用 flipX 控制朝向
                    } else {
                        // 攻击动画播放时不停止
                        const isPlayingAttack = sprite.anims.isPlaying && sprite.anims.currentAnim && sprite.anims.currentAnim.key === 'player_attack_sword';
                        if (!isPlayingAttack) {
                            if (sprite.anims.isPlaying) sprite.anims.stop();
                            sprite.setTexture('player_idle');
                        }
                        sprite.setRotation(0); // 不旋转，只用 flipX 控制朝向
                    }
                    // ===== 地牢模式：隐藏 Phaser 角色贴图 =====
                    const _dms = window.DungeonMapSystem || (typeof DungeonMapSystem !== 'undefined' ? DungeonMapSystem : null);
                    if (SceneManager.currentScene === 'scene7' && _dms && _dms.active && _dms.state === 'map') {
                        sprite.setVisible(false);
                        sprite.setActive(false);
                        if (phaserScene.weaponSprite) { phaserScene.weaponSprite.setVisible(false); phaserScene.weaponSprite.setActive(false); }
                        if (phaserScene.offhandWeaponSprite) { phaserScene.offhandWeaponSprite.setVisible(false); phaserScene.offhandWeaponSprite.setActive(false); }
                        this._usePhaserSprite = false;
                    } else if (this._stickFigure) {
                        // 火柴人模式：强制 Canvas 绘制，隐藏 Phaser 角色贴图
                        sprite.setVisible(false);
                        sprite.setActive(false);
                        this._usePhaserSprite = false;
                    } else {
                        sprite.setVisible(true);
                        sprite.setActive(true);
                        this._usePhaserSprite = true; // 标记：Phaser 已渲染角色，Canvas 跳过角色贴图
                    }
                    // 同步武器到 Phaser Sprite
                    const weaponAnim = this._getWeaponAnimParams();
                    const offhandAnim = this._getOffhandWeaponAnimParams();
                    phaserScene.syncWeapon(this, weaponAnim);
                    phaserScene.syncOffhandWeapon(this, offhandAnim);
                    // 根据 Phaser 条件开关决定 Canvas 是否渲染武器
                    // phaserScene._useCanvasWeapon = true  → Canvas 渲染武器（Phaser 隐藏）
                    // phaserScene._useCanvasWeapon = false → Phaser 渲染武器（Canvas 隐藏）
                    const useCanvasWeapon = phaserScene._useCanvasWeapon === true;
                    this._usePhaserWeapon = !useCanvasWeapon;
                    // 不 return，继续让 Canvas 渲染武器、特效、箭头等
                } else {
                    this._usePhaserWeapon = false;
                }

                this.renderHealthBar(ctx, x, y); this.renderStaminaBar(ctx, x, y); ctx.save(); ctx.translate(x, y);
                if (this.isDodging) { const tilt = Math.atan2(this.dodgeDirection.y, this.dodgeDirection.x); ctx.rotate(tilt + Math.PI/2); }
                else if (this._dashResetAnim) {
                    const elapsed = Date.now() - this._dashResetAnim.startTime;
                    const t = Math.min(1, elapsed / this._dashResetAnim.duration);
                    const delta = this._shortestAngleDelta(this._dashResetAnim.startRotation, this._dashResetAnim.targetRotation);
                    ctx.rotate(this._dashResetAnim.startRotation + delta * easeOutQuart(t));
                }
                else if (this._specialResetAnim) {
                    const elapsed = Date.now() - this._specialResetAnim.startTime;
                    const t = Math.min(1, elapsed / this._specialResetAnim.duration);
                    const delta = this._shortestAngleDelta(this._specialResetAnim.startRotation, this._specialResetAnim.targetRotation);
                    ctx.rotate(this._specialResetAnim.startRotation + delta * easeOutQuart(t));
                }
                else if (this._runeSwordResetAnim) {
                    const elapsed = Date.now() - this._runeSwordResetAnim.startTime;
                    const t = Math.min(1, elapsed / this._runeSwordResetAnim.duration);
                    const delta = this._shortestAngleDelta(this._runeSwordResetAnim.startRotation, this._runeSwordResetAnim.targetRotation);
                    ctx.rotate(this._runeSwordResetAnim.startRotation + delta * easeOutQuart(t));
                }
                else ctx.rotate(this.rotation);
                // 调试坐标系（用于对比工具中的坐标系）
                this._drawDebugCoordinateSystem(ctx);
                const currentItem = this.equipments[this.weaponMode];
                let attackType = 'melee';
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackType = 'pistol';
                    else if (currentItem.weaponType === 'pkm') attackType = 'pkm';
                    else if (currentItem.weaponType === 'akm') attackType = 'akm';
                    else if (currentItem.weaponType === 'qbz191') attackType = 'qbz191';
                    else if (currentItem.weaponType === 'bow') attackType = 'ranged';
                }
                const attack = this.attacks[attackType];
                if (this.isDodging) ctx.globalAlpha = 0.7;
                if (this._isDashing) {
                    // 冲刺攻击：角色发光 + 拖尾效果（蓝色圆圈已删除）
                    const dashProgress = this._dashTimer / 800;
                    const glowAlpha = dashProgress < 0.40 ? 0.6 : 0.6 * (1 - (dashProgress - 0.40) / 0.60);
                    // 冲刺方向指示器
                    // 已迁移到 Phaser，Canvas 跳过
                    /*
                    ctx.save();
                    const dashAngle = Math.atan2(this._dashDirection.y, this._dashDirection.x);
                    ctx.rotate(dashAngle);
                    ctx.fillStyle = `rgba(74, 158, 255, ${glowAlpha * 0.5})`;
                    ctx.beginPath(); ctx.moveTo(this.size + 8, 0); ctx.lineTo(this.size - 4, -5); ctx.lineTo(this.size - 4, 5); ctx.closePath(); ctx.fill();
                    ctx.restore();
                    */
                }
                if (this._dashConvergeAuraActive) {
                    // 冲刺就绪金色光点：亮度闪烁
                    // 已迁移到 Phaser，Canvas 跳过
                    /*
                    const flicker = 0.4 + Math.sin(Date.now() / 120) * 0.25;
                    ctx.fillStyle = `rgba(255, 230, 100, ${flicker * 0.35})`;
                    ctx.beginPath(); ctx.arc(0, 0, this.size + 7, 0, Math.PI * 2); ctx.fill();
                    */
                }
                // 中毒绿色粒子效果
                // 已迁移到 Phaser，Canvas 跳过
                /*
                if (this._poisonStacks > 0 && this._poisonEffect) {
                    this._poisonEffect.render(ctx, 0, 0);
                }
                */
                if (this._isWhirlwind) {
                    // 风车技能：人物和武器整体旋转（叠加在基础旋转之上）
                    // 前50ms不旋转（武器平移阶段），后750ms旋转4圈，使用easeOutQuad使速度逐步放慢
                    let spinAngle = 0;
                    if (this._whirlwindTimer > 50) {
                        const t = Math.min(1, (this._whirlwindTimer - 50) / (this._whirlwindDuration - 50));
                        spinAngle = easeOutQuad(t) * 4 * Math.PI * 2;
                    }
                    ctx.rotate(spinAngle);
                }
                // ===== 角色渲染已迁移到 Phaser =====
                // Phaser Sprite 在 render() 开头已同步位置和动画
                // Canvas 不再绘制角色精灵图
                // Character animation handled by Phaser, Canvas no longer needs these variables

                // 角色渲染已迁移到 Phaser，Canvas 跳过
                // Phaser 同步逻辑在 render() 开头已完成
                // 如果 Phaser 不可用，显示简单占位（不应发生）
                if (!this._usePhaserSprite) {
                    // 回退：绘制简单圆形占位
                    ctx.fillStyle = '#8B4513';
                    ctx.beginPath();
                    ctx.arc(0, 0, this.size, 0, Math.PI * 2);
                    ctx.fill();
                }
                // All character animation migrated to Phaser
                // ===== 边境长弓蓄力满闪光特效（人物） =====
                if (this._chargeFlashActive) {
                    const flashAlpha = Math.min(1, this._chargeFlashTimer / 500);
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.7})`;
                    ctx.fillRect(-60, -60, 120, 120);
                    ctx.globalCompositeOperation = 'source-over';
                }
                // ===== 符文长剑特殊攻击：渲染悬浮的剑 =====
                // Phase 3: 已迁移到 Phaser _syncRuneSwords，Canvas 不再绘制
                /*
                if (this._runeSwordSpecialActive && this._runeSwordSwords.length > 0) {
                    ...
                }
                */
                // ===== 冰锥技能：渲染悬浮的冰锥 =====
                // Phase 3: 已迁移到 Phaser _syncIceSpikes，Canvas 不再绘制
                /*
                if (this._iceSpikeActive && this._iceSpikeSpikes && this._iceSpikeSpikes.length > 0) {
                    ...
                }
                */
                // ===== 火球技能：渲染悬浮的火球 =====
                // Phase 3: 已迁移到 Phaser _syncFireball，Canvas 不再绘制
                /*
                if (this._fireballActive && this._fireball && !this._fireball.launched) {
                    ...
                }
                */
                // 闪避时：恢复旋转为 this.rotation，避免武器随身体倾斜而错位
                if (this.isDodging) {
                    const tilt = Math.atan2(this.dodgeDirection.y, this.dodgeDirection.x);
                    ctx.rotate(-(tilt + Math.PI/2) + this.rotation);
                }
                this.renderWeapon(ctx);
                // === 盾牌渲染（副手栏装备盾牌时）===
                // 统一迁移：盾牌由 Phaser 渲染，Canvas 跳过
                /*
                const _offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const _offhandItem = this.equipments[_offhandSlot];
                if (_offhandItem && _offhandItem.weaponType === 'shield') {
                    ...
                }
                */
                // 防御红光也迁移到 Phaser
                /*
                if (this.shieldSystem && this.shieldSystem.defending) {
                    ...
                }
                */
                if (!this._usePhaserSprite) {
                    ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.moveTo(this.size + 5, 0); ctx.lineTo(this.size - 1, -4); ctx.lineTo(this.size - 1, 4); ctx.closePath(); ctx.fill();
                    ctx.strokeStyle = 'rgba(122, 154, 106, 0.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, this.size + 5 + Math.sin(Date.now()/300)*1.5, 0, Math.PI*2); ctx.stroke();
                }
                ctx.restore();
                ctx.globalAlpha = 1;
                // 脚下阴影（紧贴脚底）
                if (!this._usePhaserSprite) {
                    ctx.fillStyle = 'rgba(0,0,0,0.25)';
                    ctx.beginPath();
                    const spriteDrawSize = this.size * 4.5;
                    ctx.ellipse(x, y + spriteDrawSize / 2, spriteDrawSize * 0.25, spriteDrawSize * 0.1, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
                // ===== 符文长剑特殊攻击：渲染飞行中的剑（世界坐标）=====
                // 已迁移到 Phaser _syncRuneSwords（飞行剑），Canvas 跳过
                /*
                if (this._runeSwordSpecialActive && this._runeSwordSwords.length > 0) {
                    ...
                }
                */
                // ===== 冰锥技能：渲染飞行中的冰锥（世界坐标）=====
                // 已迁移到 Phaser _syncFlyingIceSpikes，Canvas 跳过
                /*
                if (this._iceSpikeSpikes && this._iceSpikeSpikes.some(s => s.flyActive)) {
                    ...
                }
                */
                // ===== 火球技能：渲染飞行中的火球（世界坐标）=====
                // 已迁移到 Phaser _syncFlyingFireball，Canvas 跳过
                /*
                if (this._fireball && this._fireball.flyActive) {
                    ...
                }
                */
                // ===== 无人机渲染 =====
                // 已迁移到 Phaser _syncDrone，Canvas 跳过
                /*
                if (this.droneSystem && this.droneSystem.active) {
                    this.droneSystem.render(ctx);
                }
                */
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.data.name, x, y - 55);
            }
};

export { renderMixin };
