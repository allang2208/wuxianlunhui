/** 非墙门建筑受损常驻火焰/烟雾。 */

export function isBuildingDamageFxTarget(entity) {
    return !!(
        entity
        && entity._isDefenseStructure
        && !entity._isDefenseCover
        && !entity._isCoverGate
        && !entity._isDefenseTrap
        && !entity._isTrap
    );
}

export function buildingDamageFlameCount(entity) {
    if (!entity || !(entity.maxHp > 0)) return 0;
    const ratio = Math.max(0, entity.hp / entity.maxHp);
    if (ratio <= 0.30) return 8;
    if (ratio <= 0.50) return 5;
    if (ratio <= 0.70) return 2;
    return 0;
}

function hashSeed(value) {
    const text = String(value || 'building');
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

export class BuildingDamageFx {
    constructor(entity) {
        this.entity = entity;
        this.active = true;
        this._scene = null;
        this._flames = [];
        this._smoke = null;
        this._points = [];
        this._pointSignature = '';
        this._smokeTimer = 0;
        this._glowKey = `building-damage:${entity.id || entity.name || hashSeed(entity.x)}`;
    }

    getFogPosition() {
        return this.entity ? { x: this.entity.x, y: this.entity.y } : null;
    }

    getFogVisuals() {
        return [this._flames, this._smoke];
    }

    _resolveSprite(scene) {
        if (this.entity._isDefenseTower) {
            return scene._defenseSprites?.get(this.entity)?.base || null;
        }
        return scene._neutralSprites?.get(this.entity)?.sprite || null;
    }

    _worldPoint(sprite, point) {
        let lx = (point.u - sprite.originX) * sprite.displayWidth;
        let ly = (point.v - sprite.originY) * sprite.displayHeight;
        if (sprite.flipX) lx = -lx;
        if (sprite.flipY) ly = -ly;
        const c = Math.cos(sprite.rotation || 0);
        const s = Math.sin(sprite.rotation || 0);
        return {
            x: sprite.x + lx * c - ly * s,
            y: sprite.y + lx * s + ly * c,
        };
    }

    _pickPoints(scene, sprite) {
        const frame = sprite.frame;
        const fw = frame?.realWidth || frame?.cutWidth || frame?.width || 1;
        const fh = frame?.realHeight || frame?.cutHeight || frame?.height || 1;
        const signature = `${sprite.texture.key}:${frame?.name}:${fw}x${fh}`;
        if (signature === this._pointSignature && this._points.length === 8) return;
        this._pointSignature = signature;
        this._points = [];
        const rand = seeded(hashSeed(this.entity.id || `${this.entity.x},${this.entity.y}`));
        for (let i = 0; i < 8; i++) {
            let chosen = null;
            for (let attempt = 0; attempt < 48; attempt++) {
                const u = 0.16 + rand() * 0.68;
                const v = 0.20 + rand() * 0.62;
                const px = Math.max(0, Math.min(fw - 1, Math.floor(u * fw)));
                const py = Math.max(0, Math.min(fh - 1, Math.floor(v * fh)));
                const alpha = scene.textures.getPixelAlpha(px, py, sprite.texture.key, frame?.name);
                const separated = this._points.every((p) => Math.hypot(p.u - u, p.v - v) >= 0.10);
                if (alpha > 48 && separated) {
                    chosen = { u, v };
                    break;
                }
            }
            // 无法读像素时仍限制在建筑主体中段，不落到地面或透明边角。
            this._points.push(chosen || {
                u: 0.24 + rand() * 0.52,
                v: 0.28 + rand() * 0.44,
            });
        }
    }

    _createFlame(scene) {
        if (!scene.textures.exists('impact_dot')
            && typeof scene._ensureImpactDotTexture === 'function') {
            scene._ensureImpactDotTexture();
        }
        if (!scene.textures.exists('impact_dot')) return null;
        const emitter = scene.add.particles(0, 0, 'impact_dot', {
            frequency: 85,
            speedX: { min: -12, max: 12 },
            speedY: { min: -105, max: -48 },
            scale: { start: 2.8, end: 0.35 },
            alpha: { start: 0.90, end: 0 },
            lifespan: { min: 520, max: 760 },
            tint: [0xfff1a8, 0xffcc55, 0xff8833, 0xff5522],
            blendMode: 'ADD',
        });
        emitter.addToUpdateList();
        return emitter;
    }

    _ensureSmoke(scene) {
        if (this._smoke?.active || !scene.textures.exists('smoke_particle')) return;
        this._smoke = scene.add.particles(0, 0, 'smoke_particle', {
            emitting: false,
            speedX: { min: -18, max: 18 },
            speedY: { min: -72, max: -32 },
            scale: { start: 0.45, end: 1.45 },
            alpha: { start: 0.34, end: 0 },
            lifespan: { min: 1100, max: 1800 },
            tint: [0x6f6a65, 0x817b74, 0x99918a],
            blendMode: 'NORMAL',
        });
        this._smoke.addToUpdateList();
    }

    _setFlameCount(scene, count) {
        while (this._flames.length < count) {
            const emitter = this._createFlame(scene);
            if (!emitter) break;
            this._flames.push(emitter);
        }
        while (this._flames.length > count) {
            const emitter = this._flames.pop();
            if (emitter?.active) emitter.destroy();
        }
        if (count > 0) this._ensureSmoke(scene);
    }

    update(dt = 16.67) {
        const entity = this.entity;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!entity || !scene || !scene.add || entity.active === false || entity.hp <= 0
            || !isBuildingDamageFxTarget(entity)) {
            this.destroy();
            return;
        }
        if (this._scene && this._scene !== scene) {
            this.destroy();
            return;
        }
        this._scene = scene;
        const count = buildingDamageFlameCount(entity);
        if (count <= 0) {
            this.destroy();
            return;
        }
        const sprite = this._resolveSprite(scene);
        if (!sprite || !sprite.active) return;
        this._pickPoints(scene, sprite);
        this._setFlameCount(scene, count);
        const view = scene.cameras?.main?.worldView;
        const visible = !!sprite.visible && (!view || (
            sprite.x + sprite.displayWidth * 0.5 >= view.x
            && sprite.x - sprite.displayWidth * 0.5 <= view.right
            && sprite.y + sprite.displayHeight * 0.5 >= view.y
            && sprite.y - sprite.displayHeight * 0.5 <= view.bottom
        ));
        const channels = entity._structureRenderChannels || {
            frontFx: (entity._structureRenderDepth ?? entity._faceDepth ?? entity.y) + 0.04,
            smoke: (entity._structureRenderDepth ?? entity._faceDepth ?? entity.y) + 0.08,
        };
        const worldPoints = [];
        for (let i = 0; i < this._flames.length; i++) {
            const point = this._worldPoint(sprite, this._points[i]);
            worldPoints.push(point);
            const emitter = this._flames[i];
            emitter.setPosition(point.x, point.y);
            emitter.setDepth(channels.frontFx);
            emitter.emitting = visible;
            emitter.setVisible(visible);
        }

        this._smokeTimer -= dt;
        if (this._smoke?.active) {
            this._smoke.setDepth(channels.smoke);
            this._smoke.setVisible(visible);
            if (visible && this._smokeTimer <= 0 && worldPoints.length) {
                this._smokeTimer = Math.max(90, 230 - count * 14);
                const burstCount = count >= 8 ? 3 : (count >= 5 ? 2 : 1);
                for (let i = 0; i < burstCount; i++) {
                    const point = worldPoints[(Math.floor(Math.random() * worldPoints.length))];
                    this._smoke.emitParticleAt(point.x, point.y - 12, 1);
                }
            }
        }

        if (visible && typeof scene.registerEnvironmentGlow === 'function' && worldPoints.length) {
            const avg = worldPoints.reduce((out, p) => ({
                x: out.x + p.x / worldPoints.length,
                y: out.y + p.y / worldPoints.length,
            }), { x: 0, y: 0 });
            scene.registerEnvironmentGlow(this._glowKey, avg.x, avg.y, {
                radius: 30 + count * 5,
                color: 0xff7a28,
                alpha: 0.07 + count * 0.008,
                depth: channels.frontFx,
                flicker: 0.10,
            });
        } else if (!visible && typeof scene.unregisterEnvironmentGlow === 'function') {
            scene.unregisterEnvironmentGlow(this._glowKey);
        }
    }

    destroy() {
        if (!this.active && !this._flames.length && !this._smoke) return;
        this.active = false;
        for (const emitter of this._flames) if (emitter?.active) emitter.destroy();
        this._flames = [];
        if (this._smoke?.active) this._smoke.destroy();
        this._smoke = null;
        if (this._scene && typeof this._scene.unregisterEnvironmentGlow === 'function') {
            this._scene.unregisterEnvironmentGlow(this._glowKey);
        }
        if (this.entity?._buildingDamageFx === this) this.entity._buildingDamageFx = null;
    }
}
