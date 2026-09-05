import { BlendModes } from 'phaser';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';

const clamp = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => { const t = clamp(n); return t * t * (3 - 2 * t); };

// Use the saved world clock: 0 sunrise, .25 noon, .5 sunset, .75 midnight.
export function getMainHubAtmosphereState(phase) {
    const p = ((phase % 1) + 1) % 1;
    const keys = [[0, 0, 1, 0], [.12, 1, 0, 0], [.38, 1, 0, 0],
        [.5, 0, 1, 0], [.62, 0, 0, 1], [.88, 0, 0, 1], [1, 0, 1, 0]];
    const index = keys.findIndex((key, i) => i > 0 && p <= key[0]);
    const a = keys[index - 1], b = keys[index];
    const t = smooth((p - a[0]) / (b[0] - a[0]));
    return { day: a[1] + (b[1] - a[1]) * t,
        dusk: a[2] + (b[2] - a[2]) * t,
        night: a[3] + (b[3] - a[3]) * t };
}

/** Visual-only hub atmosphere. No entities, occupancy, input or extra day clock. */
export class MainHubAtmosphere {
    constructor(scene) {
        this.scene = scene;
        this.timeMs = 0;
        this.variants = new Map();
        this.clouds = [];
        this.lights = new Map();
        this.birds = null;
        this.edges = null;
        this.cloudTextureKey = 'main_hub_atmosphere_cloud_r22';
        this.ownsCloudTexture = false;
    }

    update({ backdrop, config, camera, baselineScreenY, depth, alpha, deltaMs = 0 }) {
        if (config?.enabled !== true) { this.hide(); return; }
        this.timeMs += Math.max(0, Number(deltaMs) || 0);
        const sun = EnvironmentLightingSystem.getSun();
        const state = getMainHubAtmosphereState(Number(sun.phase) || 0);
        const zoom = Math.max(.001, Number(camera.zoom) || 1);
        const width = Math.max(1, camera.width), height = Math.max(1, camera.height);
        const clip = Math.max(0, Math.min(height, baselineScreenY));

        // Day stays opaque underneath. Renormalize the middle layer so the
        // three source-over images have the intended day/dusk/night weights.
        const available = {};
        for (const name of ['dusk', 'night']) {
            const key = backdrop.variants?.[name]?.textureKey;
            let sprite = this.variants.get(name);
            available[name] = !!key && this.scene.textures.exists(key);
            if (!available[name]) { sprite?.setVisible(false); continue; }
            if (!sprite) {
                sprite = this.scene.add.image(0, 0, key).setOrigin(.5, 0).setScrollFactor(0);
                this.variants.set(name, sprite);
            } else if (sprite.texture.key !== key) sprite.setTexture(key);
            const frame = sprite.frame;
            const w = frame.realWidth || frame.width, h = frame.realHeight || frame.height;
            const scale = Math.max(width / w, height / h);
            sprite.setCrop(0, 0, w, Math.min(h, Math.floor(clip / scale)))
                .setScale(scale / zoom).setPosition(width / (2 * zoom), 0)
                .setDepth(depth + (name === 'night' ? .002 : .001)).setVisible(clip > 0);
        }
        const night = available.night ? state.night : 0;
        const dusk = available.dusk ? state.dusk : 0;
        this.variants.get('dusk')?.setAlpha(alpha * (night < .99999 ? dusk / (1 - night) : 0));
        this.variants.get('night')?.setAlpha(alpha * night);
        this._clouds(config.clouds, width, height, clip, zoom, depth + .003, state, alpha);
        this._birds(config.birds, width, height, clip, zoom, depth + .004, state, alpha);
        this._lights(config, state);
    }

    _clouds(cfg, width, height, clip, zoom, depth, state, alpha) {
        if (cfg?.enabled !== true || clip <= 0) {
            for (const sprite of this.clouds) sprite.setVisible(false);
            return;
        }
        const textures = this.scene.textures;
        if (!textures.exists(this.cloudTextureKey)) {
            const texture = textures.createCanvas(this.cloudTextureKey, 512, 128);
            if (!texture) return;
            const ctx = texture.context;
            // Bake a bounded, seamless-at-the-transparent-edge wisp once.
            for (let i = 0; i < 12; i++) {
                const x = 56 + i * 36, y = 62 + Math.sin(i * 2.3) * 14;
                ctx.save(); ctx.translate(x, y); ctx.scale(2.1, .65);
                const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
                g.addColorStop(0, 'rgba(255,255,255,.18)');
                g.addColorStop(.45, 'rgba(255,255,255,.09)');
                g.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = g; ctx.fillRect(-30, -30, 60, 60); ctx.restore();
            }
            texture.refresh(); this.ownsCloudTexture = true;
        }
        while (this.clouds.length < 3) {
            this.clouds.push(this.scene.add.image(0, 0, this.cloudTextureKey)
                .setOrigin(.5, 0).setScrollFactor(0));
        }
        const t = this.timeMs / 1000;
        this.clouds.forEach((sprite, i) => {
            const displayW = width * (i === 2 ? 1.1 : .8);
            const displayH = height * (i === 2 ? .19 : .12);
            const top = height * [.06, .23, .34][i];
            const cropH = 128 * clamp((clip - top) / displayH);
            const x = width * ([.25, .72, .46][i] + Math.sin(t / (90 + i * 23) + i) * .13);
            sprite.setCrop(0, 0, 512, cropH).setDisplaySize(displayW / zoom, displayH / zoom)
                .setPosition(x / zoom, top / zoom).setDepth(depth + i * .0001)
                .setTint(state.night > .5 ? 0x9baed6 : 0xfff6e8)
                .setAlpha((cfg.alpha ?? .26) * alpha * (1 - .55 * state.night))
                .setVisible(cropH > 0);
        });
    }

    _birds(cfg, width, height, clip, zoom, depth, state, alpha) {
        if (!this.birds && cfg?.enabled === true) {
            this.birds = this.scene.add.graphics().setScrollFactor(0);
        }
        if (!this.birds) return;
        const g = this.birds.clear().setDepth(depth);
        g.setVisible(cfg?.enabled === true && clip > 0 && state.night < .95);
        if (!g.visible) return;
        const period = Math.max(30000, cfg.intervalMs || 64000);
        const duration = Math.min(period * .5, cfg.flightMs || 18000);
        const time = this.timeMs + duration * .25;
        const cycle = Math.floor(time / period), local = time % period;
        if (local > duration) return;
        const p = local / duration;
        const direction = cycle % 2 ? -1 : 1;
        const baseX = width * (direction > 0 ? -.08 + p * 1.16 : 1.08 - p * 1.16);
        const count = 3 + cycle % 3;
        const visibility = smooth(p * 9) * smooth((1 - p) * 9) * (1 - state.night) * alpha;
        for (let i = 0; i < count; i++) {
            const size = Math.max(2, Math.min(5, width / 440)) * (1 - i * .055);
            const x = baseX - direction * i * size * 4.5;
            const y = height * (.13 + (cycle % 3) * .06) + i * size * 1.8
                + Math.sin(p * Math.PI * 2 + i * .3) * height * .012;
            // Clip entire silhouettes above the world-aligned backdrop cut.
            if (y - size < 0 || y + size >= clip || x < -size || x > width + size) continue;
            const flap = Math.sin(time / 210 + i * .9);
            const wingY = (Math.sin(time / 3100 + i) > .25 ? -.25 : flap * .7) * size;
            g.lineStyle(Math.max(.7, size * .27) / zoom, 0x293c53, .58 * visibility);
            g.beginPath(); g.moveTo((x - size) / zoom, (y + wingY) / zoom);
            g.lineTo((x - size * .35) / zoom, (y - size * .13) / zoom);
            g.lineTo(x / zoom, (y + size * .15) / zoom);
            g.lineTo((x + size * .35) / zoom, (y - size * .13) / zoom);
            g.lineTo((x + size) / zoom, (y + wingY) / zoom); g.strokePath();
        }
    }

    _lights(config, state) {
        const enabled = EnvironmentLightingSystem.getConfig().localGlowEnabled;
        const strength = enabled ? clamp(state.night + state.dusk * .4) : 0;
        const live = new Set();
        for (const definition of config.lights || []) {
            live.add(definition.id);
            let record = this.lights.get(definition.id);
            if (!record) {
                const core = this.scene._createEnvironmentGlow(definition.x, definition.y, {});
                if (!core) continue;
                const pool = this.scene.add.image(definition.x, definition.groundY, 'environment_glow')
                    .setBlendMode(BlendModes.ADD).setDepth(WORLD_RENDER_LAYERS.MAIN_HUB_GROUND_LIGHT);
                // A small NORMAL warm emitter stays visible against pale stone;
                // additive light alone saturates the white lantern to white.
                const emitter = this.scene.add.image(definition.x, definition.y, 'environment_glow');
                record = { core, pool, emitter }; this.lights.set(definition.id, record);
            }
            const { core, pool, emitter } = record;
            const fogVisible = this.scene.isFogPointVisible(definition.x, definition.groundY);
            const pulse = 1 + Math.sin(this.timeMs / (definition.pulseMs || 1700)) * .045;
            const color = definition.color ?? 0xffd59a;
            core.setPosition(definition.x, definition.y).setDepth(definition.depth)
                .setDisplaySize(definition.radius * 2 * pulse, definition.radius * 2 * pulse)
                .setTint(color).setAlpha(strength * (definition.alpha ?? .65) * pulse)
                .setVisible(fogVisible && strength > .001);
            emitter.setPosition(definition.x, definition.y).setDepth(definition.depth + .001)
                .setDisplaySize((definition.emitterRadius || 1) * 2, (definition.emitterRadius || 1) * 2)
                .setTint(0xffdf98).setAlpha(strength * .95 * pulse)
                .setVisible(fogVisible && strength > .001 && definition.emitterRadius > 0);
            const radius = definition.poolRadius || 100;
            pool.setPosition(definition.x, definition.groundY).setDisplaySize(radius * 2, radius)
                .setTint(color).setAlpha(strength * (definition.poolAlpha ?? .16))
                .setVisible(fogVisible && strength > .001);
        }
        for (const [id, record] of this.lights) {
            if (live.has(id)) continue;
            record.core.destroy(); record.pool.destroy(); record.emitter.destroy(); this.lights.delete(id);
        }
        if (!this.edges && config.edgeHighlights?.length) {
            this.edges = this.scene.add.graphics().setDepth(WORLD_RENDER_LAYERS.MAIN_HUB_GROUND_LIGHT + .001);
        }
        if (this.edges) {
            const g = this.edges.clear().setVisible(strength > .001);
            for (const line of config.edgeHighlights || []) {
                if (!this.scene.isFogPointVisible((line.from[0] + line.to[0]) / 2,
                    (line.from[1] + line.to[1]) / 2)) continue;
                g.lineStyle(line.width || 1.3, line.color ?? 0xd6e4f6, strength * (line.alpha ?? .26));
                g.lineBetween(...line.from, ...line.to);
            }
        }
    }

    hide() {
        for (const sprite of this.variants.values()) sprite.setVisible(false);
        for (const sprite of this.clouds) sprite.setVisible(false);
        for (const { core, pool, emitter } of this.lights.values()) {
            core.setVisible(false); pool.setVisible(false); emitter.setVisible(false);
        }
        this.birds?.setVisible(false); this.edges?.setVisible(false);
    }

    destroy() {
        for (const sprite of this.variants.values()) sprite.destroy();
        for (const sprite of this.clouds) sprite.destroy();
        for (const { core, pool, emitter } of this.lights.values()) { core.destroy(); pool.destroy(); emitter.destroy(); }
        this.birds?.destroy(); this.edges?.destroy();
        this.variants.clear(); this.clouds.length = 0; this.lights.clear();
        if (this.ownsCloudTexture) this.scene.textures.remove(this.cloudTextureKey);
    }
}
