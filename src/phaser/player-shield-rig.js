import { PLAYER_SHIELD_ARM as ARM, PLAYER_SHIELD_VISUAL as VISUAL } from '../config/shield-config.js';
import { PLAYER_SHIELD_POSES } from '../config/player-shield-poses.js';
import { playerTextureKey } from '../config/player-anim.js';

const RAD = Math.PI / 180;
const smoothStep = value => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
};

// 点与贴图共用 mirror → scale → rotation → translation；不经过脚点/鼠标再估算手位。
function transformPoint(point, pivot, root, scaleX, scaleY, rotation, mirror) {
    const x = (point.x - pivot.x) * scaleX * mirror;
    const y = (point.y - pivot.y) * scaleY;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    return { x: root.x + x * cos - y * sin, y: root.y + x * sin + y * cos };
}

function polygonPath(ctx, polygon) {
    ctx.beginPath();
    polygon.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
}

/** 待机/手枪的独立副手与近战源帧挂点。只写显示，不写动作或战斗状态。 */
export class PlayerShieldRig {
    constructor(scene) {
        this.scene = scene;
        this.progress = 0;
        this.replacements = [];
        this.textureKeys = [];
        this.upperSprite = null;
        this.forearmSprite = null;
        this.walkLowerSprite = null;
        this.mode = null;
        this.shieldBehindBody = false;
    }

    // 动画仲裁前归还原图，避免衍生纹理进入动作识别、脚点计算或下一动作。
    beginFrame() {
        for (const { sprite, original, replacement } of this.replacements) {
            if (sprite?.scene && sprite.texture?.key === replacement) sprite.setTexture(original);
        }
        this.replacements.length = 0;
        this.upperSprite?.setVisible(false);
        this.forearmSprite?.setVisible(false);
        this.walkLowerSprite?.setVisible(false);
    }

    clear() {
        this.beginFrame();
        this.walkLowerSprite?.anims.stop();
        this.progress = 0;
        this.mode = null;
        this.shieldBehindBody = false;
    }

    _makeTexture(suffix, sourceKey, polygons, erase = false, flip = false) {
        const key = `player_shield_rig_${suffix}`;
        const textures = this.scene.textures;
        const source = textures.get(sourceKey).getSourceImage();
        const texture = textures.createCanvas(key, source.width, source.height);
        const ctx = texture.context;
        ctx.save();
        if (flip) {
            ctx.translate(source.width, 0);
            ctx.scale(-1, 1);
        }
        if (erase) {
            ctx.drawImage(source, 0, 0);
            ctx.globalCompositeOperation = 'destination-out';
            for (const polygon of polygons) {
                polygonPath(ctx, polygon);
                ctx.fill();
            }
        } else {
            polygonPath(ctx, polygons[0]);
            ctx.clip();
            ctx.drawImage(source, 0, 0);
        }
        ctx.restore();
        texture.refresh();
        this.textureKeys.push(key);
        return key;
    }

    _ensureParts() {
        if (this.upperSprite) return true;
        if (!this.scene.textures.exists(ARM.source)) return false;
        const source = this.scene.textures.get(ARM.source).getSourceImage();
        // 标定只对当前源图有效；未来换图不能静默套用旧轮廓。
        if (source.width !== ARM.width || source.height !== ARM.height) return false;
        this.bodyKey = this._makeTexture('idle_body', ARM.source, [ARM.upperPolygon, ARM.forearmPolygon], true);
        const lowerBodyPolygon = [
            [0, ARM.walkSplit.upperCutY],
            [ARM.width, ARM.walkSplit.upperCutY],
            [ARM.width, ARM.height],
            [0, ARM.height],
        ];
        this.walkUpperKey = this._makeTexture(
            'walk_upper', ARM.source,
            [ARM.upperPolygon, ARM.forearmPolygon, lowerBodyPolygon], true
        );
        const upperKey = this._makeTexture('upper', ARM.source, [ARM.upperPolygon]);
        const forearmKey = this._makeTexture('forearm', ARM.source, [ARM.forearmPolygon]);
        this.upperSprite = this.scene.add.sprite(0, 0, upperKey).setVisible(false);
        this.forearmSprite = this.scene.add.sprite(0, 0, forearmKey).setVisible(false);
        return true;
    }

    _ensureWalkLower() {
        if (this.walkLowerSprite) return true;
        const baseKey = playerTextureKey(ARM.walkSplit.animKey);
        const textureKey = `${baseKey}_body`;
        if (!this.scene.textures.exists(textureKey) || !this.scene.anims.exists(textureKey)) return false;
        this.walkLowerSprite = this.scene.add.sprite(0, 0, textureKey).setVisible(false);
        return true;
    }

    _syncWalkLower(body) {
        if (!this._ensureWalkLower()) return false;
        const split = ARM.walkSplit;
        const key = `${playerTextureKey(split.animKey)}_body`;
        const lower = this.walkLowerSprite;
        if (lower.texture.key !== key) lower.setTexture(key);
        if (lower.anims.currentAnim?.key !== key || !lower.anims.isPlaying) lower.play(key, true);
        lower.setCrop(0, split.lowerCropY, split.frameWidth, split.frameHeight - split.lowerCropY);
        lower.setOrigin(body.originX, body.originY);
        lower.setPosition(body.x, body.y);
        lower.setDisplaySize(body.displayWidth, body.displayHeight);
        lower.setFlipX(body.flipX);
        lower.setRotation(body.rotation);
        lower.setAlpha(body.alpha);
        if (body.isTinted) {
            lower.setTint(body.tintTopLeft, body.tintTopRight, body.tintBottomLeft, body.tintBottomRight);
            lower.setTintMode(body.tintMode);
        } else {
            lower.clearTint();
        }
        lower.setVisible(true);
        return true;
    }

    _ensurePistol() {
        if (this.pistolKeys) return true;
        if (!this.scene.textures.exists(ARM.pistol.source)) return false;
        const source = this.scene.textures.get(ARM.pistol.source).getSourceImage();
        if (source.width !== ARM.pistol.width || source.height !== ARM.pistol.height) return false;
        this.pistolKeys = [false, true].map(flip => this._makeTexture(
            flip ? 'pistol_main_flip' : 'pistol_main', ARM.pistol.source,
            [ARM.pistol.removePolygon], true, flip
        ));
        return true;
    }

    _replaceTexture(sprite, replacement) {
        this.replacements.push({ sprite, original: sprite.texture.key, replacement });
        // 派生图与原图同尺寸，同 origin / scale / rotation；不重设主手变换。
        sprite.setTexture(replacement);
    }

    _placePart(sprite, pivot, root, scaleX, scaleY, rotation, mirror, body) {
        sprite.setOrigin(mirror > 0 ? pivot.x / ARM.width : 1 - pivot.x / ARM.width, pivot.y / ARM.height);
        sprite.setFlipX(mirror < 0);
        sprite.setScale(scaleX, scaleY);
        sprite.setPosition(root.x, root.y);
        sprite.setRotation(rotation);
        sprite.setAlpha(body.alpha);
        if (body.isTinted) {
            sprite.setTint(body.tintTopLeft, body.tintTopRight, body.tintBottomLeft, body.tintBottomRight);
            sprite.setTintMode(body.tintMode);
        } else {
            sprite.clearTint();
        }
        sprite.setVisible(true);
    }

    _syncAuthoredPose(body) {
        // 以真正显示的纹理+帧为权威。anims.stop后currentAnim仍会残留，不能据此绑旧动作；
        // 也不以isPlaying过滤，攻击末帧定格/石化时仍须跟住当前手掌。
        const track = PLAYER_SHIELD_POSES[body.texture.key];
        const index = Number(body.frame?.name);
        if (!track || !Number.isInteger(index) || !track.frames[index]
            || body.frame.width !== track.width || body.frame.height !== track.height) return null;
        this.clear();
        this.mode = 'authored';
        const pose = track.frames[index];
        this.shieldBehindBody = pose.behindBody;
        const facingRight = !body.flipX;
        const mirror = facingRight ? 1 : -1;
        const grip = transformPoint(pose,
            { x: body.originX * track.width, y: body.originY * track.height }, body,
            body.displayWidth / track.width, body.displayHeight / track.height, body.rotation, mirror);
        return { ...grip, facingRight, rotation: body.rotation + pose.tilt * RAD * mirror };
    }

    sync(player, deltaMs) {
        const scene = this.scene;
        const body = scene.playerSprite;
        const authoredPose = this._syncAuthoredPose(body);
        if (authoredPose) return authoredPose;
        const pistol = scene._twistTexKey === 'player_gun_idle_pistol'
            && scene._twistState && scene.playerTorsoSprite?.visible && scene.playerArmSprite?.visible;
        const idle = body.texture.key === ARM.source;
        if ((!idle && !pistol) || !this._ensureParts() || (pistol && !this._ensurePistol())) {
            this.clear();
            return null;
        }
        const walking = !pistol && idle && player.shieldSystem.defending && player.isMoving
            && this._ensureWalkLower();
        if (!walking && this.walkLowerSprite?.anims.isPlaying) this.walkLowerSprite.anims.stop();
        this.mode = pistol ? 'pistol' : (walking ? 'walk' : 'idle');
        this.shieldBehindBody = false;
        const target = player.shieldSystem.defending ? 1 : 0;
        // 暂停/石化不推进视觉过渡；举盾立即生效的战斗时窗完全不读取此进度。
        if (!player.hasStatusEffect?.('petrified')) {
            const step = Math.max(0, deltaMs || 0) / (target ? VISUAL.raiseMs : VISUAL.lowerMs);
            this.progress = target ? Math.min(1, this.progress + step) : Math.max(0, this.progress - step);
        }
        // 先伸后举；两个阶段在分界处速度为0，松开/重按沿同一进度反向，不另开Tween。
        const reach = smoothStep(this.progress / ARM.reachFraction);
        const lift = smoothStep((this.progress - ARM.reachFraction) / (1 - ARM.reachFraction));
        const facingRight = pistol ? scene._twistState.facingRight : !body.flipX;
        const mirror = facingRight ? 1 : -1;
        const scaleX = body.displayWidth / ARM.width;
        const scaleY = body.displayHeight / ARM.height;
        let baseRotation = body.rotation;
        let shoulder;
        if (pistol) {
            const torso = scene.playerTorsoSprite;
            baseRotation = torso.rotation;
            // 消费躯干真实 origin（跑步腿帧高512，原躯干高516），不再用腿帧尺寸猜肩位。
            const torsoMirror = torso.texture.key.endsWith('_flip') ? -1 : 1;
            const torsoPivot = {
                x: (torsoMirror > 0 ? torso.originX : 1 - torso.originX) * ARM.pistol.width,
                y: torso.originY * ARM.pistol.height,
            };
            shoulder = transformPoint(ARM.pistol.shoulder, torsoPivot, torso,
                torso.displayWidth / ARM.pistol.width, torso.displayHeight / ARM.pistol.height, baseRotation, torsoMirror);
            const flippedSource = scene.playerArmSprite.texture.key.endsWith('_flip');
            this._replaceTexture(scene.playerArmSprite, this.pistolKeys[flippedSource ? 1 : 0]);
        } else {
            shoulder = transformPoint(ARM.shoulder, { x: body.originX * ARM.width, y: body.originY * ARM.height },
                body, scaleX, scaleY, baseRotation, mirror);
            // 放下后使用完整原图，原始待机像素完全保留。
            if (this.progress === 0) {
                const grip = transformPoint(ARM.grip, ARM.shoulder, shoulder, scaleX, scaleY, baseRotation, mirror);
                return { ...grip, facingRight, rotation: baseRotation + VISUAL.restTilt * mirror };
            }
            this._replaceTexture(body, walking ? this.walkUpperKey : this.bodyKey);
            if (walking) this._syncWalkLower(body);
        }

        const upperDegrees = ARM.reachUpperDegrees * reach
            + (ARM.guardUpperDegrees - ARM.reachUpperDegrees) * lift;
        const forearmDegrees = ARM.reachForearmDegrees * reach
            + (ARM.guardForearmDegrees - ARM.reachForearmDegrees) * lift;
        const upperRotation = baseRotation + upperDegrees * RAD * mirror;
        const forearmRotation = baseRotation + forearmDegrees * RAD * mirror;
        const elbow = transformPoint(ARM.elbow, ARM.shoulder, shoulder, scaleX, scaleY, upperRotation, mirror);
        this._placePart(this.upperSprite, ARM.shoulder, shoulder, scaleX, scaleY, upperRotation, mirror, body);
        this._placePart(this.forearmSprite, ARM.elbow, elbow, scaleX, scaleY, forearmRotation, mirror, body);
        // 关键合同：盾牌与显示出来的手掌使用完全相同的前臂变换，没有独立 world 偏移。
        const grip = transformPoint(ARM.grip, ARM.elbow, elbow, scaleX, scaleY, forearmRotation, mirror);
        return { ...grip, facingRight, rotation: baseRotation + (VISUAL.restTilt + (VISUAL.guardTilt - VISUAL.restTilt) * lift) * mirror };
    }

    syncDepth(playerDepth) {
        // 腿层在静态上身后方，16px 重叠区由上身覆盖，膝上线不会随帧开缝。
        this.walkLowerSprite?.setDepth(playerDepth - 0.005);
        // 始终小于城墙塔最紧凑的 shieldOff=0.04；手枪主臂保留在副手骨链之前。
        this.upperSprite?.setDepth(playerDepth + (this.mode === 'pistol' ? 0.005 : 0.025));
        this.forearmSprite?.setDepth(playerDepth + (this.mode === 'pistol' ? 0.015 : 0.03));
    }

    destroy() {
        this.clear();
        this.upperSprite?.destroy();
        this.forearmSprite?.destroy();
        this.walkLowerSprite?.destroy();
        for (const key of this.textureKeys) this.scene.textures.remove(key);
        this.textureKeys.length = 0;
        this.upperSprite = null;
        this.forearmSprite = null;
        this.walkLowerSprite = null;
        this.pistolKeys = null;
    }
}
