/**
 * Two-layer whirlwind weapon compositor.
 *
 * The equipped sword remains the only texture source. During the two side-on
 * crossover windows, complementary local-texture crops place one contiguous
 * sword segment behind the body and the other in front. At front/back views the
 * whole sword moves to the matching layer. Cropping does not alter the sprite
 * transform, so the grip origin remains stable for every sword texture.
 */
export class WhirlwindWeaponDepth {
    constructor(scene) {
        this.scene = scene;
        this.backSprite = null;
        this.active = false;
        this.pose = null;
    }

    _ensureBackSprite(mainSprite) {
        if (!mainSprite?.texture?.key) return null;
        if (!this.backSprite || !this.backSprite.active) {
            this.backSprite = this.scene.add.sprite(
                mainSprite.x,
                mainSprite.y,
                mainSprite.texture.key,
                mainSprite.frame?.name
            );
            this.backSprite.setVisible(false);
        } else if (this.backSprite.texture.key !== mainSprite.texture.key) {
            this.backSprite.setTexture(mainSprite.texture.key, mainSprite.frame?.name);
        }
        return this.backSprite;
    }

    _copyTransform(mainSprite, target) {
        target.setOrigin(mainSprite.originX, mainSprite.originY);
        target.setPosition(mainSprite.x, mainSprite.y);
        target.setRotation(mainSprite.rotation);
        target.setFlipX(mainSprite.flipX);
        target.setFlipY(mainSprite.flipY);
        // scaleX 可能为负：推击用它围绕固定握点连续完成枪口/枪托翻面。
        // 直接复制 scale 能保留符号；setDisplaySize 会把镜像符号抹掉并造成后景半枪反向。
        target.setScale(mainSprite.scaleX, mainSprite.scaleY);
        target.setTint(mainSprite.tintTopLeft);
        target.setAlpha(1);
    }

    _setSplitCrop(front, back, ratio, frontFromTip, axis = 'y') {
        const frameWidth = Math.max(1, front.frame?.realWidth || front.frame?.width || front.width || 1);
        const frameHeight = Math.max(1, front.frame?.realHeight || front.frame?.height || front.height || 1);
        if (axis === 'x') {
            const frontWidth = Math.max(1, Math.min(frameWidth - 1, Math.round(frameWidth * ratio)));
            const backWidth = frameWidth - frontWidth;
            if (frontFromTip) {
                front.setCrop(frameWidth - frontWidth, 0, frontWidth, frameHeight);
                back.setCrop(0, 0, backWidth, frameHeight);
            } else {
                front.setCrop(0, 0, frontWidth, frameHeight);
                back.setCrop(frontWidth, 0, backWidth, frameHeight);
            }
            return;
        }
        const frontHeight = Math.max(1, Math.min(frameHeight - 1, Math.round(frameHeight * ratio)));
        const backHeight = frameHeight - frontHeight;

        if (frontFromTip) {
            front.setCrop(0, 0, frameWidth, frontHeight);
            back.setCrop(0, frontHeight, frameWidth, backHeight);
        } else {
            front.setCrop(0, backHeight, frameWidth, frontHeight);
            back.setCrop(0, 0, frameWidth, backHeight);
        }
    }

    apply(mainSprite, pose, visible = true) {
        const back = this._ensureBackSprite(mainSprite);
        if (!mainSprite || !back || !pose) return;
        this._copyTransform(mainSprite, back);
        this.active = true;
        this.pose = pose;

        mainSprite.setAlpha(1);
        mainSprite.setCrop();
        back.setCrop();
        if (!visible) {
            mainSprite.setVisible(false);
            back.setVisible(false);
            return;
        }

        const phase = pose.depthPhase || 'front';
        if (phase === 'front') {
            mainSprite.setVisible(true);
            back.setVisible(false);
            return;
        }
        if (phase === 'back') {
            // Keep the authoritative weapon sprite logically presented so
            // sword-bound effects can still read its current transform.
            mainSprite.setVisible(true).setAlpha(0.001);
            back.setVisible(true);
            return;
        }

        const depthValue = Math.max(-0.2, Math.min(0.2, Number(pose.depthValue) || 0));
        const configuredFrontRatio = Number(pose.frontRatio);
        const frontRatio = Number.isFinite(configuredFrontRatio)
            ? Math.max(0.08, Math.min(0.92, configuredFrontRatio))
            : (depthValue + 0.2) / 0.4;
        this._setSplitCrop(
            mainSprite,
            back,
            frontRatio,
            pose.splitFromTip !== 'back',
            pose.splitAxis || 'y'
        );
        mainSprite.setVisible(true);
        back.setVisible(true);
    }

    syncDepth(playerDepth, occluded) {
        if (!this.active || !this.pose || !this.backSprite) return false;
        const frontOffset = occluded ? 0.4 : 2;
        const backOffset = -0.2;
        this.backSprite.setDepth(playerDepth + backOffset);
        this.scene.weaponSprite?.setDepth(
            playerDepth + (this.pose.depthPhase === 'back' ? backOffset : frontOffset)
        );
        return true;
    }

    clear(mainSprite) {
        this.active = false;
        this.pose = null;
        if (mainSprite) {
            mainSprite.setCrop();
            mainSprite.setAlpha(1);
        }
        if (this.backSprite) {
            this.backSprite.setCrop();
            this.backSprite.setVisible(false);
        }
    }

    destroy() {
        this.backSprite?.destroy();
        this.backSprite = null;
        this.active = false;
        this.pose = null;
    }
}
