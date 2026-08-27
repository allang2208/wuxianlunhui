import { SoundManager } from '../../ui/sound-manager.js';
import { WEAPON_ANIM } from '../../config/math-utils.js';
import { Camera } from '../../world/camera.js';
import { Input } from '../../ui/input.js';
// ============================================================
// Weapon Animation System - 状态机驱动（兼容旧系统）
// 远程武器使用状态机驱动动画，近战武器使用 Phaser Tween
// ============================================================

import { isTwoHanded } from '../../config/gun-ammo.js';
import { AUTO_GUN_FAMILY } from '../../config/weapon-families.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { Easing } from '../../config/math-utils.js';
import { CONFIG } from '../../config/config.js';
import { playerTextureKey, getPlayerAnimDurationMs, getSpriteFrameBounds } from '../../config/player-anim.js';
import { WallSystem } from '../../world/wall-system.js';
import { enterAttackHold, clearPose, nowMs,
    MELEE_COMBO_STAGES, MELEE_STAGE_ANIM_KEYS, meleeStageCfgKey, meleeStageHoldMs } from './anim-state.js';

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
                if (anim.spinEnd && nowMs() < anim.spinEnd) {
                    const t = 1 - (anim.spinEnd - nowMs()) / anim.spinDuration;
                    anim.angle = wa.idleAngle + Math.sin(nowMs() / 400) * 0.06 + t * Math.PI * 8;
                } else {
                    anim.spinEnd = 0;
                    anim.angle = wa.idleAngle + Math.sin(nowMs() / 400) * 0.06;
                    
                    // 装备双手武器时不播放旋转待机动画
                    const _idleItem = this.equipments[this.weaponMode];
                    const _isTwoHandedIdle = _idleItem && isTwoHanded(_idleItem);
                    if (_isTwoHandedIdle) {
                        anim.nextSpin = 0;
                        anim.spinEnd = 0;
                    } else if (!anim.nextSpin) {
                        anim.nextSpin = nowMs() + 3000 + Math.random() * 3000;
                    } else if (nowMs() >= anim.nextSpin) {
                        anim.spinDuration = 650;
                        anim.spinEnd = nowMs() + anim.spinDuration;
                        anim.nextSpin = nowMs() + anim.spinDuration + 3000 + Math.random() * 3000;
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
                    if (nowMs() - this._pendingThrust.startTime <= 500) {
                        this.attacks.melee.checkTriangleHit(this);
                    } else {
                        this._pendingThrust.active = false;
                    }
                }

                // 远程武器在 swing 阶段发射子弹（放在 timer 检查之前，避免高射速武器 dt 过大跳过射击）
                {
                    const currentItem = this.equipments[this.weaponMode];
                    const isRangedWeapon = currentItem && (currentItem.weaponType === 'pistol' || AUTO_GUN_FAMILY.includes(currentItem.weaponType) || currentItem.weaponType === 'shotgun' || currentItem.rangedType === 'pistol');
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
                        const rtsAttackLocked = !!(typeof window !== 'undefined'
                            && window.Game?.RTSCommand?.enabled
                            && this._rtsController?.command?.mode === 'attack');
                        if (!rtsAttackLocked) {
                            const mouseWorldX = Input.mouse.x + Camera.x - CONFIG.VIEW_WIDTH / 2;
                            const mouseWorldY = Input.mouse.y + Camera.y - CONFIG.VIEW_HEIGHT / 2;
                            this.rangedFireData.targetX = mouseWorldX;
                            this.rangedFireData.targetY = mouseWorldY;
                        }
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
        const isMelee = currentItem && (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword');
        // 同一次近战攻击只允许一个 Tween/音效会话。必须在下方改写 state 之前判断；
        // 否则 attacking 会先被覆写为 swing，_playSwordAttackTween 的防重守卫会被绕过。
        if (isMelee && this.weaponAnim
            && (this.weaponAnim.isAttacking || this.weaponAnim.state === 'attacking')) return;
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

        // 新攻击启动：清除上一段的定格保持窗口（pose session 全清——本路径只由 update.js 近战输入
        // 守卫（!_attackRecovering && !_dashRecoverAt）进入，recover/dashFreeze 字段本就为假，等价原单清 hold）
        clearPose(this);

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
            // 三段连段（2026-08-13）：一段过顶下劈 → 二段肩高快劈 → 三段弓步突刺（终结段）→ 收势。
            // 段素材未加载（纹理缺失）时逐级回退（stage3→2→1）；窗口/定格/收势梯度见 anim-state.js 登记
            const now = nowMs();
            // 连段窗口按上一段判定：一段后 0.5s、二段后 0.2s；第三段当前配置为 0，直接收势。
            const prevChainWindow = meleeStageHoldMs(this._meleeComboStage || 1);
            const chained = hand === 'main' && this._lastMeleeAttackEnd && (now - this._lastMeleeAttackEnd) <= prevChainWindow;
            let stage = chained ? ((this._meleeComboStage || 1) % MELEE_COMBO_STAGES) + 1 : 1;
            let animKey = MELEE_STAGE_ANIM_KEYS[stage - 1];
            // 纹理缺失逐级回退（stage3→2→1）
            while (stage > 1 && !scene.textures.exists(playerTextureKey(animKey))) {
                stage--;
                animKey = MELEE_STAGE_ANIM_KEYS[stage - 1];
            }
            if (hand === 'main') this._meleeComboStage = stage;
            // 命中判定配置：按段选 attack/attack2/attack3 块（缺失逐级回退 attack）。
            // 帧号必须按人物动画的真实逐帧边界换算；frameDurations/frameWeights 非等时时，
            // 均匀除帧会让音效/命中落后画面。无 hitCheck 配置时回退旧的 500ms 连续判定窗口。
            const stageCfg = wacCfg[meleeStageCfgKey(wacCfg, stage)] || perFrameCfg;
            const stageFrameCount = stageCfg.frames?.length || 0;
            const spriteFrameBounds = getSpriteFrameBounds(animKey);
            // 人物动画与武器轨迹帧数完全一致时才消费真实边界；素材/配置降级导致帧数不匹配时
            // 保留旧的均匀轨迹阈值，不能把另一套帧表直接套到当前阶段。
            const frameBounds = spriteFrameBounds?.length === stageFrameCount ? spriteFrameBounds : null;
            const frameCount = stageFrameCount || spriteFrameBounds?.length || 0;
            const clampFrame = value => Math.max(1, Math.min(frameCount || 1, Math.floor(Number(value) || 1)));
            const frameStartProgress = value => {
                const frame = clampFrame(value);
                if (frame <= 1 || frameCount <= 1) return 0;
                return frameBounds?.[frame - 2] ?? ((frame - 1) / (frameCount - 1));
            };
            const hitCheckCfg = stageCfg.hitCheck || null;
            let hitCheckThreshold = null;
            if (hitCheckCfg && typeof hitCheckCfg.frame === 'number' && frameCount > 1) {
                hitCheckThreshold = frameStartProgress(hitCheckCfg.frame);
            }
            let hitChecked = false;
            // 时长必须按逐帧时长求和优先（getPlayerAnimDurationMs 认识 frameDurations/frameWeights）——
            // Phaser Animation.duration 只按 frameRate 派生（30帧@12fps=2500ms），与逐帧时长实际播放
            // （30×50ms=1500ms）不一致，会导致武器轨迹进度比人物贴图慢（"慢半拍"）
            const animDef = scene.anims.get(playerTextureKey(animKey));
            const totalDuration = getPlayerAnimDurationMs(animKey) || (animDef && animDef.duration) || 900;
            tweenDuration = totalDuration;

            // 动画根位移（当前仅 attack3 配置前迈）：按人物逐帧真实时长确定起止点，
            // 方向锁定为本次攻击方向；普通攻击判定继续遵守 _pendingThrust 的起手固定原点合同。
            let rootMotion = null;
            const rootCfg = hand === 'main' ? stageCfg.rootMotion : null;
            const rootDistance = Math.max(0, Number(rootCfg?.distance) || 0);
            if (rootDistance > 0 && frameCount > 1) {
                const startFrame = clampFrame(rootCfg.startFrame);
                const endFrame = Math.min(frameCount, Math.max(startFrame + 1, clampFrame(rootCfg.endFrame)));
                const startProgress = frameStartProgress(startFrame);
                const endProgress = frameStartProgress(endFrame);
                const attackAngle = Number.isFinite(this._pendingThrust?.angle)
                    ? this._pendingThrust.angle
                    : (this._facingRightVisual === false ? Math.PI : 0);
                if (endProgress > startProgress) {
                    this.vx = 0;
                    this.vy = 0;
                    this.isMoving = false;
                    rootMotion = {
                        startX: this.x,
                        startY: this.y,
                        dirX: Math.cos(attackAngle),
                        dirY: Math.sin(attackAngle),
                        distance: rootDistance,
                        startProgress,
                        endProgress,
                        complete: false,
                    };
                }
            }

            if (hand === 'main') {
                // 预写连段定格窗口：Phaser 4 每帧顺序 PRE_UPDATE(动画) → UPDATE(Tween)，
                // 动画播完帧上 animationcomplete 早于 Tween onComplete 触发——若在 onComplete
                // 才写这些字段，GameScene 的完成回调读到的是旧值，会把贴图切回 idle（定格失效，
                // 首次攻击与 1500ms 二段必现）；enterAttackHold 不变量：写 hold 同时清 recover
                //（收势中被新攻击打断也要解除收势标记）
                this._lastMeleeAttackEnd = now + totalDuration; // onComplete 会按实际结束时间复写
                enterAttackHold(this, {
                    animKey,
                    // 定格时长按当前段：一段 0.5s / 二段 0.2s / 三段 0（meleeCombo.stageNHoldMs）
                    untilMs: now + totalDuration + meleeStageHoldMs(stage),
                });
            }

            // 统一由 GameScene 播放并记录攻击起始时间，用于逐帧武器同步
            if (hand === 'main' && scene.setPlayerAnimation) {
                scene.setPlayerAnimation(animKey, tweenDuration);
            }

            // 挥砍音效：按块配置 sound 字段，soundFrame 控制播放时机（缺省 1=起手立即播放）；
            // 与 hitCheck 共用人物动画真实帧边界，非等时停留帧不会让音效错拍。
            const soundFrame = (stageCfg.sound && typeof stageCfg.soundFrame === 'number') ? stageCfg.soundFrame : 1;
            const soundThreshold = frameCount > 1 ? frameStartProgress(soundFrame) : 0;
            // 音效门禁必须归属于本次攻击会话，而不是单个 Tween 回调。第三段包含根位移与
            // 终结段收势切换；若同一会话残留了第二条 Tween，局部 boolean 会各自放行一次。
            // 共用 _pendingThrust 标记后，同一次攻击无论有多少回调都只允许一次挥砍音。
            const attackSession = this._pendingThrust;
            const playSwingSoundOnce = () => {
                if (!stageCfg.sound || !attackSession || attackSession.swingSoundPlayed) return;
                attackSession.swingSoundPlayed = true;
                if (typeof SoundManager !== 'undefined' && SoundManager.playFile) {
                    SoundManager.playFile(stageCfg.sound);
                }
            };
            if (soundThreshold <= 0) playSwingSoundOnce();

            const attackTween = scene.tweens.add({
                targets: { progress: 0 },
                progress: 1,
                duration: totalDuration,
                ease: 'Linear',
                onStart: function() {
                    if (self._pendingThrust) self._pendingThrust.active = true;
                },
                onUpdate: function(tween) {
                    const progress = tween.targets[0].progress;
                    if (rootMotion && !rootMotion.complete && progress >= rootMotion.startProgress) {
                        const moveProgress = Math.min(1, (progress - rootMotion.startProgress)
                            / (rootMotion.endProgress - rootMotion.startProgress));
                        const easedProgress = Easing.easeOutQuad(moveProgress);
                        const targetX = rootMotion.startX + rootMotion.dirX * rootMotion.distance * easedProgress;
                        const targetY = rootMotion.startY + rootMotion.dirY * rootMotion.distance * easedProgress;
                        const wallIgnore = WallSystem.ignoreForEntity?.(self) || null;
                        self._surfaceInputIntent = { x: rootMotion.dirX, y: rootMotion.dirY };
                        const resolved = WallSystem.resolve(
                            rootMotion.startX,
                            rootMotion.startY,
                            targetX,
                            targetY,
                            self.groundRadius,
                            wallIgnore
                        );
                        self.x = resolved.x;
                        self.y = resolved.y;
                        if (self.collider && typeof self.collider.syncPosition === 'function') self.collider.syncPosition();
                        rootMotion.complete = moveProgress >= 1;
                    }
                    if (progress >= soundThreshold) {
                        // 到帧播放挥砍音效（soundFrame>1 的二段攻击等）
                        playSwingSoundOnce();
                    }
                    if (!self._pendingThrust || !self._pendingThrust.active) return;
                    if (hitCheckThreshold !== null) {
                        // 一次性判定：progress 首次达到 hitCheck 帧阈值时按该段配置形状判定
                        if (!hitChecked && progress >= hitCheckThreshold) {
                            hitChecked = true;
                            self.attacks.melee.checkStageHit(self, hitCheckCfg);
                        }
                    } else if (nowMs() - self._pendingThrust.startTime <= 500) {
                        self.attacks.melee.checkTriangleHit(self);
                    } else {
                        self._pendingThrust.active = false;
                    }
                },
                onComplete: function() {
                    anim.isAttacking = false;
                    anim.state = 'idle';
                    if (hand === 'main') {
                        self._lastMeleeAttackEnd = nowMs(); // 连段窗口起点
                        // 攻击后定格保持：按段区分（一段 0.5s / 二段 0.2s，=各自连段窗口）——
                        // 定格期间武器朝向绑定身体 flipX（身体冻结故武器冻结），超时播 recover 收势
                        // 2026-08-03 修复：此前这里固定 +500，把二段预写的 200ms 定格覆盖成 500ms
                        //（SKILL"实机采样二段 holdMs=200"实为冻结管线未触发 onComplete 采到的预写值）
                        // 红线：与上方预写构成"预写 → onComplete 复写"两次写序列，次序/位置不得改动
                        enterAttackHold(self, {
                            animKey,
                            untilMs: self._lastMeleeAttackEnd + meleeStageHoldMs(self._meleeComboStage || 1),
                        });
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
                            if (nowMs() - self._pendingThrust.startTime <= 500) {
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
            else if (AUTO_GUN_FAMILY.includes(currentItem.weaponType)) cfgKey = currentItem.weaponType;
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
