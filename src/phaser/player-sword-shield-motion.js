import motion from '../../data/player-sword-shield-motion.json';
import soloRun from '../../data/player-sword-solo-run.json';
import walkGrip from '../../data/player-sword-walk-grip.json';
import comboGrip from '../../data/player-sword-combo-grip.json';
import dashGrip from '../../data/player-dash-slash-grip.json';
import thrust from '../../data/player-sword-shield-thrust-v3.json';
import thrustRecover from '../../data/player-thrust-recover-poses.json';
import { WeaponTransform } from '../combat/weapon-transform.js';
import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { PLAYER_DEFAULTS } from '../config/player-defaults.js';
import { isTwoHanded } from '../config/gun-ammo.js';
import { PLAYER_SHIELD_WALK_POSES } from '../config/player-shield-poses.js';
import { isPlayerRunVisual, nowMs } from '../entities/player/anim-state.js';
import { Input } from '../ui/input.js';

const RAD = Math.PI / 180;
const COMBO_CONFIG_KEYS = { attack_sword: 'attack', attack_sword_2: 'attack2', attack_sword_3: 'attack3' };

// 空手副臂只换身体帧；主剑握点、角度、尺寸和掌部遮挡复用已确认的剑盾跑姿。
const soloMotion = {
    sourceSize: motion.sourceSize,
    pages: [...motion.pages, ...soloRun.pages],
    poses: soloRun.frames.map(([page, frame], index) => ({
        ...motion.poses[motion.run[index]],
        body: [motion.pages.length + page, frame],
        shield: null,
    })),
};

// 离散身体帧与握点一起选择；不能只插值装备，让装备在静止手掌内滑动。
function sample(track, time, bank = motion) {
    let id = track[0][1];
    for (const [at, next] of track) {
        if (at > time) break;
        id = next;
    }
    return bank.poses[id];
}

/** 剑类待机/步行/三段普攻抓握、剑盾低持/冲刺及空副手单剑跑姿。只替换显示。 */
export class PlayerSwordShieldMotion {
    constructor(scene) {
        this.scene = scene;
        this.runOffset = 0;
        this.lastRunFrame = null;
        this.session = null;
        this.replacement = null;
        this.idleReplacement = null;
        this.handSprite = null;
        this.shieldBinding = null;
        this.pose = null;
        this.poseBank = motion;
        this.thrustIdle = false;
        this.thrustExitPose = null;
        this.prepareResumeAt = null;
    }

    beginFrame() {
        // 待机抓握最后叠在盾臂处理之后，必须先归还它，再归还前一层显示替换。
        const idle = this.idleReplacement;
        if (idle) {
            const body = this.scene.playerSprite;
            if (body?.scene) {
                if (body.texture.key === idle.texture) body.setTexture(idle.key, idle.frame);
                body.setScale(idle.scaleX, idle.scaleY);
            }
            this.idleReplacement = null;
        }
        const saved = this.replacement;
        if (saved) {
            const body = this.scene.playerSprite;
            if (body?.scene) {
                // AnimationState 可能已经推进到下一原生帧；此时不能把旧帧贴回去。
                if (body.texture.key === saved.texture) body.setTexture(saved.key, saved.frame);
                body.setScale(saved.scaleX, saved.scaleY);
            }
            if (saved.nativeHandVisible !== undefined) {
                this.scene.playerHandSprite?.setVisible(saved.nativeHandVisible);
            }
            this.replacement = null;
        }
        this.handSprite?.setVisible(false);
        this.shieldBinding = null;
    }

    beforeAnimation(key) {
        this.beginFrame();
        this.pose = null;
        this.thrustExitPose = null;
        if (key !== 'idle' && key !== 'dash_recover_thrust') this.thrustIdle = false;
        if (key === 'dash_attack') {
            this.session = this.lastRunFrame === null ? null : { style: 'slash', origin: this.lastRunFrame };
        } else if (key === 'dash_attack_thrust') {
            this.session = { style: 'thrust', origin: this.lastRunFrame ?? 0 };
            this.returnPhase = null;
        } else if (key === 'dash_recover_thrust') {
            if (this.session?.style !== 'thrust') this.session = { style: 'thrust', origin: 0 };
        } else if (key === 'run') {
            this.runOffset = this.returnPhase ?? 0;
            this.prepareResumeAt = this.returnPhase == null ? null : nowMs();
            this.returnPhase = null;
            this.session = null;
        } else if (key !== 'dash_recover') {
            if (key === 'idle' && this.session?.style === 'thrust' && this.session.recovery) {
                this.thrustIdle = true;
                // 原生完成回调先切idle，再由移动仲裁切run；显示端补这一帧交接。
                this.thrustExitPose = this.session.returnToRun ? 'run' : 'idle';
            }
            this.session = null;
            this.runOffset = 0;
            if (key !== 'idle') this.returnPhase = null;
        }
        if (key !== 'run') this.lastRunFrame = null;
    }

    clear() {
        this.beginFrame();
        this.pose = null;
        this.poseBank = motion;
        this.session = null;
        this.lastRunFrame = null;
        this.returnPhase = null;
        this.runOffset = 0;
        this.thrustIdle = false;
        this.thrustExitPose = null;
        this.prepareResumeAt = null;
    }

    _syncNativeThrustRecovery(player, body) {
        const recovery = body.texture.key === 'player_dash_recover_thrust';
        const idle = this.thrustIdle && body.texture.key === 'player_idle';
        if (!recovery && !idle) return false;
        const config = recovery ? thrustRecover : thrustRecover.idle;
        const pose = recovery ? config.frames[Number(body.frame.name)] : config;
        const sword = this.scene.weaponSprite;
        if (!pose || !sword || body.frame.realWidth !== config.width || body.frame.realHeight !== config.height) return false;
        this.thrustIdle = true;
        if (idle) {
            // 收势512帧切回516的原idle，保持相同名义尺寸，下一帧仍恢复原动画缩放。
            this.replacement = { key: body.texture.key, frame: body.frame.name, texture: body.texture.key,
                scaleX: body.scaleX, scaleY: body.scaleY };
            body.setDisplaySize(PLAYER_DEFAULTS.physics.spriteSize, PLAYER_DEFAULTS.physics.spriteSize);
        }
        const mirror = body.flipX ? -1 : 1;
        const transform = point => {
            const x = (point[0] / config.width - body.originX) * body.displayWidth * mirror;
            const y = (point[1] / config.height - body.originY) * body.displayHeight;
            const c = Math.cos(body.rotation), s = Math.sin(body.rotation);
            return { x: body.x + x*c-y*s, y: body.y+x*s+y*c };
        };
        const size = WeaponTransform.getWeaponSize('sword', null, 'idle');
        const origin = WeaponTransform.getTextureGrip('sword', sword.texture.key, size);
        const grip = transform(pose.main);
        sword.setPosition(grip.x, grip.y).setDisplaySize(size.width, size.height)
            .setOrigin(mirror > 0 ? origin.x : 1-origin.x, origin.y)
            .setFlipX(mirror < 0).setFlipY(false)
            .setRotation(body.rotation + pose.swordAngle * RAD * mirror)
            .setAlpha(body.alpha).setVisible(true);
        // 原副臂待机/防御链继续管理idle；只有收势帧覆盖盾挂点。
        if (recovery) {
            this.shieldBinding = { ...transform(pose.off), facingRight: mirror > 0,
                rotation: body.rotation + pose.shieldAngle * RAD * mirror };
            this.shieldBehindBody = false;
        }
        this.pose = null;
        return true;
    }

    _select(player, body, hasShield) {
        this.poseBank = motion;
        if (body.texture.key === 'player_run' && isPlayerRunVisual(player)) {
            const index = Number(body.frame.name);
            if (!Number.isInteger(index) || index < 0 || index > 7) return null;
            this.lastRunFrame = (index + this.runOffset) % 8;
            if (!hasShield) {
                this.poseBank = soloMotion;
                return soloMotion.poses[this.lastRunFrame];
            }
            // 只使用真实冲刺就绪进度；RTS的跑步显示不授予突击预备。
            if (this._thrustAvailable() && player._isSprinting && Input.isSprint()
                && player._getActiveDashSkillId?.() === 'dashAttackThrust'
                && player.skills?.dashAttackThrust && player.data.stamina > 0
                && player._isSprintDirectionAllowed?.() && player._hasHorizontalDashInput?.()) {
                const level = player._getDashSkillLevel('dashAttackThrust');
                const readyMs = 333 * (1 - (level - 1) * 0.03);
                const duration = Math.max(1, Math.min(thrust.prepareMs, readyMs));
                let amount = Math.max(0, Math.min(1, (player._sprintDuration - Math.max(0, readyMs-duration)) / duration));
                // 收势回跑后仍可能已达就绪阈值；只缓入上身，不复位游戏计时或限制点击。
                if (this.prepareResumeAt !== null) amount = Math.min(amount, Math.max(0, (nowMs()-this.prepareResumeAt)/thrust.prepareMs));
                if (amount > 0) return this._thrustPose(thrust.preparation[this.lastRunFrame], amount);
            }
            return motion.poses[motion.run[this.lastRunFrame]];
        }
        this.lastRunFrame = null;
        if (body.texture.key === 'player_walk_body' || body.texture.key === 'player_walk') {
            const index = Number(body.frame.name);
            const pose = walkGrip.poses[index];
            const frame = WeaponAnimConfig.sword.walkFrames?.frames?.[index];
            if (!pose || !frame) return null;
            this.poseBank = walkGrip;
            const offhand = hasShield ? PLAYER_SHIELD_WALK_POSES[index] : null;
            // 沿用可编辑的 walkFrames；它的偏移是144显示空间中的掌心，非武器中心。
            const base = PLAYER_DEFAULTS.physics.spriteSize;
            const size = WeaponTransform.getWeaponSize('sword', frame.scale, 'walk');
            return { ...pose, shield: offhand ? {
                point: [offhand.x, offhand.y],
                angle: offhand.tilt,
                behind: offhand.behindBody,
            } : null, sword: {
                point: [(frame.offsetX / base + 0.5) * walkGrip.sourceSize,
                    (frame.offsetY / base + 0.5) * walkGrip.sourceHeight],
                angle: frame.rotation,
                size: [size.width / base * walkGrip.sourceSize, size.height / base * walkGrip.sourceSize],
            } };
        }
        const thrustPose = this._selectThrust(player, body);
        if (thrustPose) return thrustPose;
        if (!this.session || player._dashVisualStyle === 'thrust') return null;
        if (player._isDashing && body.texture.key === 'player_dash_attack') {
            // 随原攻击总时长缩放；不往技能时长前面追加120ms，也不延后命中。
            const time = player._dashTimer / Math.max(1, player._dashTotalMs) * motion.attackReferenceMs;
            return time < motion.entryMs ? sample(motion.entries[this.session.origin], time) : null;
        }
        if (player._attackRecovering && player._recoverCfgKey === 'dash'
            && body.texture.key === 'player_dash_recover') {
            const elapsed = Math.max(0, nowMs() - player._attackRecoverStart);
            if (this.session.returnToRun === undefined) {
                this.session.returnToRun = !!this._wantsRun(player);
            }
            // 原版停止输入时仍走原版回待机；不强迫玩家做一个跑步脚姿。
            if (!this.session.returnToRun) return null;
            if (elapsed >= motion.recoverMs - 160) this.returnPhase = motion.returnRunFrame;
            return sample(motion.recovery, elapsed);
        }
        return null;
    }

    _thrustAvailable() {
        return thrust.pages.every(p => this.scene.textures.exists(p.key));
    }

    _thrustPose(track, time) {
        this.poseBank = thrust;
        return sample(track, time, thrust);
    }

    _wantsRun(player) {
        const move = Input.getMovement();
        return player._rtsRunVisual || (Input.isSprint() && player.data.stamina > 0
            && (move.x !== 0 || move.y !== 0) && player._isSprintDirectionAllowed?.());
    }

    _selectThrust(player, body) {
        if (!this._thrustAvailable()) return null;
        if (body.texture.key === 'player_idle' && this.thrustExitPose) {
            const exit = this.thrustExitPose === 'run' && this._wantsRun(player) ? 'run' : 'idle';
            this.thrustExitPose = null;
            if (exit === 'idle') this.returnPhase = null;
            return this._thrustPose(thrust.recovery[exit], thrust.recoverMs);
        }
        if (this.session?.style !== 'thrust') return null;
        if (player._isDashing && body.texture.key === 'player_dash_attack_thrust') {
            const time = player._dashTimer / Math.max(1, player._dashTotalMs) * thrust.attackReferenceMs;
            return this._thrustPose(thrust.attacks[this.session.origin], time);
        }
        if (body.texture.key === 'player_dash_recover_thrust') {
            const reset = player._dashResetAnim;
            // 使用原复位时钟；保留对象引用以承接字段先清空、原生动画稍后完成的尾帧。
            if (reset?.visualStyle === 'thrust') this.session.recovery = reset;
            const clock = this.session.recovery;
            if (!clock) return null;
            const time = Math.max(0, nowMs()-clock.startTime) / Math.max(1, clock.duration) * thrust.recoverMs;
            if (time >= thrust.recoverMs-thrust.returnBlendMs && this.session.returnToRun === undefined) {
                this.session.returnToRun = !!this._wantsRun(player);
            }
            const exit = this.session.returnToRun ? 'run' : 'idle';
            this.returnPhase = this.session.returnToRun ? thrust.returnRunFrame : null;
            this.thrustIdle = true;
            return this._thrustPose(thrust.recovery[exit], time);
        }
        return null;
    }

    sync(player) {
        const body = this.scene.playerSprite;
        if (this._syncDashGrip(player, body)) return;
        if (this._syncComboGrip(player, body)) return;
        const item = player?.equipments?.[player.weaponMode];
        const shield = player?.shieldSystem?.getShieldData();
        const offhand = player?.equipments?.[player.weaponMode === 'weapon' ? 'offhand' : 'ring2'];
        const petrified = player?.hasStatusEffect?.('petrified');
        const solo = !shield && !offhand && !isTwoHanded(item);
        const soloRunning = solo && body?.texture.key === 'player_run'
            && (isPlayerRunVisual(player) || (petrified && this.pose && this.poseBank === soloMotion));
        const swordWalking = (body?.texture.key === 'player_walk_body' || body?.texture.key === 'player_walk')
            && (body.anims.isPlaying || petrified);
        // 法杖也复用 sword 配置，但不能进入真实单手剑分支。
        // 步行只改主手抓握；无盾奔跑仍要求空副手，攻击/收势/待机沿用原门禁。
        const eligible = item?.weaponType === 'sword' && (shield || soloRunning || swordWalking)
            && body?.visible && body.active
            && !player._isDead && !player.isDodging && !player._frozenAbyssFalling
            && !this.scene._useCanvasWeapon;
        if (!eligible) {
            this.clear();
            return;
        }
        const available = (swordWalking ? walkGrip : shield ? motion : soloMotion).pages.every(p => this.scene.textures.exists(p.key));
        const defending = !!player.shieldSystem?.defending;
        // 石化沿用当前帧；装备切换时不能把旧持盾副臂留给空手变体，或反过来。
        const frozenPose = petrified && this.pose && (swordWalking
            ? this.poseBank === walkGrip
            : this.poseBank !== walkGrip && (!!shield === (this.poseBank !== soloMotion)));
        const pose = !defending && available
            ? (frozenPose ? this.pose : this._select(player, body, !!shield)) : null;
        this.pose = pose;
        if (!pose) {
            // 新身体用其最终解算掌点；只有原生帧/原idle才读旧表，避免两套坐标串用。
            if (shield && this._syncNativeThrustRecovery(player, body)) return;
        }
        if (defending || !available) {
            this.clear();
            return;
        }
        if (!pose) return;
        const bank = this.poseBank;
        // 步行保留512×516源尺寸；显示仍与原生步行一致，不因换紧裁图集改变体量。
        const w = PLAYER_DEFAULTS.physics.spriteSize, h = w;
        const mirror = body.flipX ? -1 : 1;
        const transform = point => {
            const x = (point[0] / bank.sourceSize - body.originX) * w * mirror;
            const y = (point[1] / (bank.sourceHeight || bank.sourceSize) - body.originY) * h;
            const c = Math.cos(body.rotation), s = Math.sin(body.rotation);
            return { x: body.x + x*c - y*s, y: body.y + x*s + y*c };
        };
        const texture = bank.pages[pose.body[0]].key;
        this.replacement = { key: body.texture.key, frame: body.frame.name, texture,
            scaleX: body.scaleX, scaleY: body.scaleY,
            nativeHandVisible: bank === walkGrip ? this.scene.playerHandSprite?.visible : undefined };
        body.setTexture(texture, pose.body[1]).setDisplaySize(w, h);

        const sword = this.scene.weaponSprite;
        if (sword) {
            const grip = transform(pose.sword.point);
            const width = pose.sword.size[0] / bank.sourceSize * w;
            const height = pose.sword.size[1] / bank.sourceSize * h;
            const actual = WeaponTransform.getTextureGrip('sword', sword.texture.key, { width, height });
            const origin = pose.gripMode === 'bridge' ? {
                x: pose.sword.origin[0] + (actual.x-motion.referenceGrip[0])*(1-pose.entryMix),
                y: pose.sword.origin[1] + (actual.y-motion.referenceGrip[1])*(1-pose.entryMix),
            } : actual;
            sword.setPosition(grip.x, grip.y).setDisplaySize(width, height)
                .setOrigin(mirror > 0 ? origin.x : 1-origin.x, origin.y)
                .setFlipX(mirror < 0).setFlipY(false)
                .setRotation(body.rotation + pose.sword.angle * RAD * mirror)
                .setAlpha(body.alpha).setVisible(true);
        }
        if (!this.handSprite) this.handSprite = this.scene.add.sprite(0, 0, texture);
        this.handSprite.setTexture(bank.pages[pose.hand[0]].key, pose.hand[1])
            .setOrigin(body.originX, body.originY).setPosition(body.x, body.y)
            .setDisplaySize(w, h).setFlipX(body.flipX).setRotation(body.rotation)
            .setAlpha(body.alpha).setVisible(true);
        if (body.isTinted) {
            this.handSprite.setTint(body.tintTopLeft, body.tintTopRight, body.tintBottomLeft, body.tintBottomRight);
            this.handSprite.setTintMode(body.tintMode);
        } else this.handSprite.clearTint();
        this.scene.playerHandSprite?.setVisible(false);
        this.shieldBinding = pose.shield ? { ...transform(pose.shield.point), facingRight: mirror > 0,
            rotation: body.rotation + pose.shield.angle * RAD * mirror } : null;
        this.shieldBehindBody = pose.shield?.behind ?? false;
    }

    _syncDashGrip(player, body) {
        const sword = this.scene.weaponSprite;
        const item = player?.equipments?.[player.weaponMode];
        const anim = body?.texture.key;
        const recovering = anim === 'player_dash_recover' && player?._attackRecovering && player._recoverCfgKey === 'dash';
        const frozen = anim === 'player_dash_recover' && !!player?._dashRecoverAt;
        if (item?.weaponType !== 'sword' || player._dashVisualStyle === 'thrust'
            || (!recovering && !frozen && !(anim === 'player_dash_attack' && player._isDashing))
            || !body?.visible || !body.active || !sword?.visible || this.scene._useCanvasWeapon
            || player._isDead || player.isDodging || player._frozenAbyssFalling
            || body.frame.realWidth !== 512) return false;
        const index = Number(body.frame.name);
        if (!Number.isInteger(index)) return false;
        const frames = WeaponAnimConfig.sword.dashGrip?.frames;
        const last = frames?.at(-1);
        if (!last) return false;
        let bank = dashGrip;
        let pose = recovering ? dashGrip.poses.recover[index] : dashGrip.poses.attack[frozen ? frames.length-1 : index];
        let frame = recovering ? null : frames[frozen ? frames.length-1 : index];
        if (!pose) return false;
        const hasShield = !!player.shieldSystem?.getShieldData();
        const entryTime = player._dashTimer / Math.max(1, player._dashTotalMs || dashGrip.attackReferenceMs) * dashGrip.attackReferenceMs;
        if (!recovering && !frozen && hasShield && this.session?.style === 'slash'
            && entryTime < dashGrip.entryReferenceMs) {
            // 复用已确认的短过渡整帧；双掌与身体取同一个采样，不插值握柄原点。
            const track = motion.entries[this.session.origin];
            const record = track.findLast(([at]) => at <= entryTime) || track[0];
            const entry = motion.poses[record[1]];
            bank = motion;
            pose = { ...entry, main: entry.sword.point, sourceWidth: 512, sourceHeight: 512,
                shield: [...entry.shield.point, entry.shield.angle, entry.shield.behind] };
            const legacyAngle = -90 + 180*record[0]/dashGrip.attackReferenceMs;
            const sourceFrame = frames[Math.min(frames.length-1, Math.floor(record[0]/dashGrip.attackReferenceMs*frames.length+1e-6))];
            frame = { ...frame, offsetX: (pose.main[0]/512-.5)*144, offsetY: (pose.main[1]/512-.5)*144,
                rotation: entry.sword.angle + (sourceFrame.rotation-legacyAngle)*entry.entryMix };
        } else if (recovering) {
            const t = index / (dashGrip.poses.recover.length-1);
            const idle = WeaponAnimConfig.sword.idle;
            const idleAngle = WeaponTransform.getWeaponRotation(0, 'sword', 0, 'idle', true)/RAD;
            frame = { offsetX: (pose.main[0]/pose.sourceWidth-.5)*144,
                offsetY: (pose.main[1]/pose.sourceHeight-.5)*144,
                rotation: pose.angle + (last.rotation-dashGrip.defaults.at(-1).rotation)*(1-t) + (idleAngle-105)*t,
                scale: last.scale + ((idle?.idleScale ?? 1.5)-last.scale)*t,
                stretchX: 1+((last.stretchX ?? 1)-1)*(1-t), stretchY: 1+((last.stretchY ?? 1)-1)*(1-t) };
            if (index === 0) frame = { ...last, blurX: 0, blurY: 0 };
            // 保留原有携盾回跑出口；只在尾段选用已确认的回跑整帧，不改变移动取消规则。
            if (hasShield && this.session?.style === 'slash') {
                if (this.session.returnToRun === undefined) this.session.returnToRun = !!this._wantsRun(player);
                if (this.session.returnToRun && index >= 10) {
                    const returned = sample(motion.recovery, dashGrip.returnRunTimes[index-10]);
                    bank = motion;
                    pose = { ...returned, main: returned.sword.point, sourceWidth: 512, sourceHeight: 512,
                        shield: [...returned.shield.point, returned.shield.angle, returned.shield.behind] };
                    frame = { ...frame, offsetX: (pose.main[0]/512-.5)*144,
                        offsetY: (pose.main[1]/512-.5)*144, rotation: returned.sword.angle };
                    this.returnPhase = dashGrip.returnRunFrame;
                }
            }
        }
        if (!frame) return false;
        const texture = bank.pages[pose.body[0]].key, handTexture = bank.pages[pose.hand[0]].key;
        if (!this.scene.textures.exists(texture) || !this.scene.textures.exists(handTexture)) return false;
        const width = body.displayWidth, height = body.displayHeight, mirror = body.flipX ? -1 : 1;
        const c = Math.cos(body.rotation), s = Math.sin(body.rotation);
        const transform = (x, y) => {
            const dx = (x+.5-body.originX)*width*mirror, dy = (y+.5-body.originY)*height;
            return { x: body.x+dx*c-dy*s, y: body.y+dx*s+dy*c };
        };
        const grip = WeaponTransform.getSwordGripFramePose(frame, sword.texture.key);
        const point = transform(grip.x/144, grip.y/144);
        this.replacement = { key: body.texture.key, frame: body.frame.name, texture,
            scaleX: body.scaleX, scaleY: body.scaleY, nativeHandVisible: this.scene.playerHandSprite?.visible };
        body.setTexture(texture, pose.body[1]).setDisplaySize(width, height);
        sword.setPosition(point.x, point.y).setOrigin(mirror > 0 ? grip.gripX : 1-grip.gripX, grip.gripY)
            .setDisplaySize(grip.width, grip.height).setFlipX(mirror < 0).setFlipY(false)
            .setRotation(body.rotation+grip.rotation*mirror).setAlpha(body.alpha);
        this.scene._applyWeaponBlur(frozen ? 0 : grip.blurX, frozen ? 0 : grip.blurY);
        if (!this.handSprite) this.handSprite = this.scene.add.sprite(0, 0, handTexture);
        this.handSprite.setTexture(handTexture, pose.hand[1]).setOrigin(body.originX, body.originY)
            .setPosition(body.x, body.y).setDisplaySize(width, height).setFlipX(body.flipX)
            .setRotation(body.rotation).setAlpha(body.alpha).setVisible(true);
        if (body.isTinted) {
            this.handSprite.setTint(body.tintTopLeft, body.tintTopRight, body.tintBottomLeft, body.tintBottomRight);
            this.handSprite.setTintMode(body.tintMode);
        } else this.handSprite.clearTint();
        this.scene.playerHandSprite?.setVisible(false);
        const [offX,offY,tilt,behind=false] = pose.shield;
        this.shieldBinding = { ...transform(offX/pose.sourceWidth-.5,offY/pose.sourceHeight-.5),
            facingRight: mirror > 0, rotation: body.rotation+tilt*RAD*mirror };
        this.shieldBehindBody = behind;
        this.pose = null;
        return true;
    }

    _syncComboGrip(player, body) {
        const sword = this.scene.weaponSprite;
        const item = player?.equipments?.[player.weaponMode];
        if (item?.weaponType !== 'sword' || !body?.visible || !body.active || !sword?.visible
            || this.scene._useCanvasWeapon || player._isDead || player.isDodging || player._frozenAbyssFalling
            || player._isDashing || player._dashRecoverAt || player._dashResetAnim
            || player._isWhirlwind || player._whirlwindRecovering || player._isPushStrike
            || player._specialAttackActive || player._specialResetAnim) return false;
        const anim = body.texture.key.replace(/^player_/, '').replace(/_body$/, '');
        const index = Number(body.frame.name);
        const recovering = anim === 'recover' && player._attackRecovering && player._recoverCfgKey !== 'dash';
        if (!Number.isInteger(index) || (!COMBO_CONFIG_KEYS[anim] && !recovering)
            || body.frame.realWidth !== comboGrip.sourceSize || body.frame.realHeight !== comboGrip.sourceSize) return false;
        const cfg = WeaponAnimConfig.sword;
        const basis = PLAYER_DEFAULTS.physics.spriteSize * comboGrip.displayScale;
        let pose, frame;
        if (recovering) {
            const key = ['attack', 'attack2', 'attack3'][(player._meleeComboStage || 1)-1];
            const track = comboGrip.recoverTracks[key];
            const entry = track?.[index];
            if (!entry) return false;
            const [source, sourceIndex, angle] = entry;
            pose = comboGrip.poses[source][sourceIndex];
            const sourceKey = COMBO_CONFIG_KEYS[source];
            const sourceFrame = sourceKey ? cfg[`${sourceKey}Grip`]?.frames[sourceIndex] : null;
            const last = cfg[`${key}Grip`]?.frames.at(-1);
            if (!last) return false;
            const t = index / Math.max(1, track.length-1);
            const idleScale = cfg.idle?.idleScale ?? cfg.idleScale;
            const idleAngle = WeaponTransform.getWeaponRotation(0, 'sword', 0, 'idle', true) / RAD;
            frame = {
                offsetX: sourceFrame?.offsetX ?? (pose.main[0]/comboGrip.sourceSize-.5)*basis,
                offsetY: sourceFrame?.offsetY ?? (pose.main[1]/comboGrip.sourceSize-.5)*basis,
                rotation: angle + (last.rotation-track[0][2])*(1-t) + (idleAngle-105)*t,
                scale: last.scale + (idleScale-last.scale)*t,
                stretchX: 1+((last.stretchX ?? 1)-1)*(1-t),
                stretchY: 1+((last.stretchY ?? 1)-1)*(1-t),
            };
        } else {
            pose = comboGrip.poses[anim]?.[index];
            frame = cfg[`${COMBO_CONFIG_KEYS[anim]}Grip`]?.frames[index];
        }
        if (!pose || !frame) return false;
        const texture = comboGrip.pages[pose.body[0]].key;
        const handTexture = comboGrip.pages[pose.hand[0]].key;
        if (!this.scene.textures.exists(texture) || !this.scene.textures.exists(handTexture)) return false;
        const width = body.displayWidth, height = body.displayHeight;
        const mirror = body.flipX ? -1 : 1;
        const c = Math.cos(body.rotation), s = Math.sin(body.rotation);
        const transform = (x, y) => {
            const dx = (x+.5-body.originX)*width*mirror;
            const dy = (y+.5-body.originY)*height;
            return { x: body.x+dx*c-dy*s, y: body.y+dx*s+dy*c };
        };
        const grip = WeaponTransform.getSwordGripFramePose(frame, sword.texture.key);
        const point = transform(grip.x/basis, grip.y/basis);
        this.replacement = { key: body.texture.key, frame: body.frame.name, texture,
            scaleX: body.scaleX, scaleY: body.scaleY,
            nativeHandVisible: this.scene.playerHandSprite?.visible };
        body.setTexture(texture, pose.body[1]).setDisplaySize(width, height);
        sword.setPosition(point.x, point.y).setOrigin(mirror > 0 ? grip.gripX : 1-grip.gripX, grip.gripY)
            .setDisplaySize(grip.width, grip.height).setFlipX(mirror < 0).setFlipY(false)
            .setRotation(body.rotation+grip.rotation*mirror).setAlpha(body.alpha);
        this.scene._applyWeaponBlur(grip.blurX, grip.blurY);
        if (!this.handSprite) this.handSprite = this.scene.add.sprite(0, 0, handTexture);
        this.handSprite.setTexture(handTexture, pose.hand[1]).setOrigin(body.originX, body.originY)
            .setPosition(body.x, body.y).setDisplaySize(width, height).setFlipX(body.flipX)
            .setRotation(body.rotation).setAlpha(body.alpha).setVisible(true);
        if (body.isTinted) {
            this.handSprite.setTint(body.tintTopLeft, body.tintTopRight, body.tintBottomLeft, body.tintBottomRight);
            this.handSprite.setTintMode(body.tintMode);
        } else this.handSprite.clearTint();
        this.scene.playerHandSprite?.setVisible(false);
        const [offX, offY, tilt, behind = false] = pose.shield;
        this.shieldBinding = { ...transform(offX/comboGrip.sourceSize-.5, offY/comboGrip.sourceSize-.5),
            facingRight: mirror > 0, rotation: body.rotation+tilt*RAD*mirror };
        this.shieldBehindBody = behind;
        this.pose = null;
        return true;
    }

    // 在盾牌rig完成本帧伸臂/举盾之后调用，只替换主手，不接管副臂或防御进度。
    syncIdleGrip(player) {
        const body = this.scene.playerSprite;
        const sword = this.scene.weaponSprite;
        const item = player?.equipments?.[player.weaponMode];
        const guardBody = body?.texture.key === 'player_shield_rig_idle_body';
        const nativeIdle = body?.texture.key === 'player_idle';
        if (item?.weaponType !== 'sword' || (!nativeIdle && !guardBody)
            || !body?.visible || !body.active || !sword?.visible || this.scene._useCanvasWeapon
            || player._isDead || player.isDodging || player._frozenAbyssFalling
            || player.weaponAnim?.isAttacking || player._isDashing || player._attackRecovering) return;
        const config = walkGrip.idle;
        const texture = walkGrip.pages[0].key;
        if (!config || !this.scene.textures.exists(texture)) return;
        const size = PLAYER_DEFAULTS.physics.spriteSize;
        const grip = WeaponTransform.getSwordIdleGripPose(config, sword.texture.key, {}, size);
        const width = body.displayWidth, height = body.displayHeight;
        const mirror = body.flipX ? -1 : 1;
        const x = (grip.x / size + 0.5 - body.originX) * width * mirror;
        const y = (grip.y / size + 0.5 - body.originY) * height;
        const c = Math.cos(body.rotation), s = Math.sin(body.rotation);
        this.idleReplacement = { key: body.texture.key, frame: body.frame.name, texture,
            scaleX: body.scaleX, scaleY: body.scaleY };
        body.setTexture(texture, guardBody ? config.guardBody : config.body).setDisplaySize(width, height);
        sword.setPosition(body.x+x*c-y*s, body.y+x*s+y*c)
            .setOrigin(mirror > 0 ? grip.gripX : 1-grip.gripX, grip.gripY)
            .setDisplaySize(grip.width, grip.height).setFlipX(mirror < 0).setFlipY(false)
            .setRotation(body.rotation+grip.rotation*mirror).setAlpha(body.alpha);
        if (!this.handSprite) this.handSprite = this.scene.add.sprite(0, 0, texture);
        this.handSprite.setTexture(texture, config.hand).setOrigin(body.originX, body.originY)
            .setPosition(body.x, body.y).setDisplaySize(width, height)
            .setFlipX(body.flipX).setRotation(body.rotation).setAlpha(body.alpha).setVisible(true);
        if (body.isTinted) {
            this.handSprite.setTint(body.tintTopLeft, body.tintTopRight, body.tintBottomLeft, body.tintBottomRight);
            this.handSprite.setTintMode(body.tintMode);
        } else this.handSprite.clearTint();
    }

    syncDepth(playerDepth, weaponOff) {
        if (this.handSprite?.visible) this.handSprite.setDepth(playerDepth + weaponOff + 0.01);
    }

    destroy() {
        this.clear();
        this.handSprite?.destroy();
        this.handSprite = null;
    }
}
