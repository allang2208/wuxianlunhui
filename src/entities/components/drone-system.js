import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { CONFIG } from '../../config/config.js';
import { SceneManager } from '../../world/scene-manager.js';
import { VisionSourceRegistry } from '../../world/vision-source-registry.js';
import { getDroneValues } from '../../config/skill-formulas.js';

const HOSTILE_FACTIONS = new Set(['enemy', 'hostile', 'monster']);
let nextDroneSourceId = 1;

/** 高空侦察 + 近圈战术标记。等级与增益只在成功部署瞬间快照。 */
export class DroneSystem {
    constructor(player) {
        this.player = player;
        this.active = false;
        this.controlling = false;
        this.x = 0;
        this.y = 0;
        this.duration = 0;
        this.maxDuration = 0;
        this.checkTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.speed = 500;
        this.visionRadius = 0;
        this.markRadius = 0;
        this.fogSightRadius = 0;
        this.fogSightDebuffImmune = true;
        this.fogVisionProfile = 'drone';
        this._snapshot = null;
        this._sourceId = `player-drone-${nextDroneSourceId++}`;
        this._savedCameraTarget = null;
        this._affectedEntities = new Set();
        this._moveTarget = null;
        this._holdPosition = false;
        this._visionHandle = null;
        this._visionSceneId = null;
    }

    toggle(options = {}) {
        if (!this.active) return this._deploy(options);
        if (!this.controlling) this._enterControl();
        else this._exitControl();
        return { ok: true, deployed: false };
    }

    commandFlyToMouse(options = {}) {
        const result = this.active ? { ok: true, deployed: false } : this._deploy(options);
        if (!this.active) return result;
        const mw = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
        this._moveTarget = this._clampPoint(mw.x, mw.y);
        this._holdPosition = true;
        EffectManager.add(new FloatingTextEffect(this._moveTarget.x, this._moveTarget.y - 12, '无人机：航点锁定', '#66dbe8'));
        return result;
    }

    _deploy({ ignoreCosts = false } = {}) {
        const skill = this.player.skills?.droneSkill;
        if (!skill) return { ok: false, deployed: false };
        const snapshot = getDroneValues(skill.level);
        if (!ignoreCosts && (Number(this.player.data?.mp) || 0) < snapshot.mpCost) {
            EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, '法力不足', '#c86b6b'));
            return { ok: false, deployed: false };
        }
        if (!ignoreCosts) this.player.data.mp = Math.max(0, this.player.data.mp - snapshot.mpCost);

        this._snapshot = snapshot;
        this.active = true;
        this.controlling = false;
        this.maxDuration = snapshot.duration * 1000;
        this.duration = this.maxDuration;
        this.speed = snapshot.moveSpeed;
        this.visionRadius = snapshot.visionRadius;
        this.markRadius = snapshot.markRadius;
        this.fogSightRadius = snapshot.visionRadius;
        this.checkTimer = 0;
        const angle = this.player.rotation;
        const point = this._clampPoint(this.player.x + Math.cos(angle) * 50, this.player.y + Math.sin(angle) * 50);
        this.x = point.x;
        this.y = point.y;
        this.vx = 0;
        this.vy = 0;
        this._moveTarget = null;
        this._holdPosition = false;
        this._ensureVisionSource(true);
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 20, '无人机已部署', '#66dbe8'));
        return { ok: true, deployed: true, snapshot };
    }

    _enterControl() {
        this.controlling = true;
        this._savedCameraTarget = Renderer.cameraTarget || null;
        Renderer.cameraTarget = { x: this.x, y: this.y, isDrone: true };
        EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, '无人机：接管控制', '#66dbe8'));
    }

    _exitControl() {
        this.controlling = false;
        Renderer.cameraTarget = this._savedCameraTarget || null;
        this._savedCameraTarget = null;
        EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, '无人机：自动巡航', '#66dbe8'));
    }

    _deactivate({ immediateMarks = false, silent = false } = {}) {
        if (this.controlling) this._exitControl();
        this.active = false;
        this._visionHandle?.dispose?.();
        this._visionHandle = null;
        this._visionSceneId = null;
        for (const entity of this._affectedEntities) {
            entity?.removeDroneVulnerability?.(this._sourceId, { immediate: immediateMarks });
        }
        this._affectedEntities.clear();
        this._moveTarget = null;
        this._snapshot = null;
        if (!silent) EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, '无人机任务结束', '#66dbe8'));
    }

    _ensureVisionSource(force = false) {
        const sceneId = SceneManager.currentScene;
        if (force || !this._visionHandle || sceneId !== this._visionSceneId) {
            this._visionHandle?.dispose?.();
            this._visionSceneId = sceneId;
            this._visionHandle = VisionSourceRegistry.register(this, {
                profile: 'drone', sceneId, ignoreOcclusion: true, ignoreVisionDebuffs: true,
            });
        }
    }

    _worldBounds() {
        const scene = SceneManager.scenes?.[SceneManager.currentScene] || null;
        return {
            width: Math.max(32, Number(scene?.width) || Number(CONFIG.WORLD_WIDTH) || 4096),
            height: Math.max(32, Number(scene?.height) || Number(CONFIG.WORLD_HEIGHT) || 4096),
        };
    }

    _clampPoint(x, y) {
        const bounds = this._worldBounds();
        return {
            x: Math.max(16, Math.min(bounds.width - 16, Number(x) || 16)),
            y: Math.max(16, Math.min(bounds.height - 16, Number(y) || 16)),
        };
    }

    update(dt, entities) {
        if (!this.active) return;
        if (this._visionSceneId !== SceneManager.currentScene) {
            this._deactivate({ immediateMarks: true, silent: true });
            return;
        }
        this._ensureVisionSource();
        this.duration -= dt;
        if (this.duration <= 0) {
            this._deactivate();
            return;
        }

        const dtSec = dt / 1000;
        if (this._moveTarget && this.controlling) {
            const manual = Input.isPressed('KeyW') || Input.isPressed('ArrowUp')
                || Input.isPressed('KeyS') || Input.isPressed('ArrowDown')
                || Input.isPressed('KeyA') || Input.isPressed('ArrowLeft')
                || Input.isPressed('KeyD') || Input.isPressed('ArrowRight');
            if (manual) this._moveTarget = null;
        }

        if (this._moveTarget) {
            const dx = this._moveTarget.x - this.x;
            const dy = this._moveTarget.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 12) {
                this._moveTarget = null;
                this.vx = 0;
                this.vy = 0;
            } else {
                const step = Math.min(dist, this.speed * dtSec);
                const point = this._clampPoint(this.x + dx / dist * step, this.y + dy / dist * step);
                this.x = point.x;
                this.y = point.y;
            }
        } else if (this.controlling) {
            let moveX = 0;
            let moveY = 0;
            if (Input.isPressed('KeyW') || Input.isPressed('ArrowUp')) moveY -= 1;
            if (Input.isPressed('KeyS') || Input.isPressed('ArrowDown')) moveY += 1;
            if (Input.isPressed('KeyA') || Input.isPressed('ArrowLeft')) moveX -= 1;
            if (Input.isPressed('KeyD') || Input.isPressed('ArrowRight')) moveX += 1;
            const len = Math.hypot(moveX, moveY) || 1;
            this.vx += (moveX / len * this.speed - this.vx) * 0.7;
            this.vy += (moveY / len * this.speed - this.vy) * 0.7;
            if (!moveX) this.vx *= 0.82;
            if (!moveY) this.vy *= 0.82;
            const point = this._clampPoint(this.x + this.vx * dtSec, this.y + this.vy * dtSec);
            this.x = point.x;
            this.y = point.y;
        } else if (!this._holdPosition) {
            const angle = this.player.rotation;
            const target = this._clampPoint(this.player.x + Math.cos(angle) * 50, this.player.y + Math.sin(angle) * 50);
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 5) {
                const step = Math.min(dist, this.speed * dtSec);
                this.x += dx / dist * step;
                this.y += dy / dist * step;
            }
        }

        if (this.controlling && Renderer.cameraTarget?.isDrone) {
            Renderer.cameraTarget.x = this.x;
            Renderer.cameraTarget.y = this.y;
        }
        this.checkTimer -= dt;
        if (this.checkTimer <= 0) {
            this.checkTimer = 250;
            this._applyDebuff(entities);
        }
    }

    _applyDebuff(entities) {
        if (!this._snapshot) return;
        const inRange = new Set();
        // Game.entities 在不同调用链中可能是 Map 或数组；Map 的默认迭代项是
        // [key, value]，必须显式取 values()，否则标记扫描会把键值对当成实体。
        const iterable = typeof entities?.values === 'function' ? entities.values() : (entities || []);
        for (const entity of iterable) {
            if (!entity?.active || !entity.hittable || entity.hp <= 0) continue;
            if (!HOSTILE_FACTIONS.has(entity._faction || entity.faction)) continue;
            // 高空标记只看俯视距离，不受地表层、墙上层或飞行目标分类限制。
            if (!entity.collider?.intersectsGroundCircle?.(this.x, this.y, this.markRadius)) continue;
            inRange.add(entity);
            entity.applyDroneVulnerability?.({
                sourceId: this._sourceId,
                damageBonusPercent: this._snapshot.damageBonusPercent,
                critBonusPercent: this._snapshot.critBonusPercent,
                duration: this._snapshot.markLingerMs,
                owner: this.player,
            });
        }
        for (const entity of this._affectedEntities) {
            if (!entity?.active || entity.hp <= 0) {
                entity?.removeDroneVulnerability?.(this._sourceId, { immediate: true });
                this._affectedEntities.delete(entity);
            } else if (!inRange.has(entity)) {
                entity.removeDroneVulnerability?.(this._sourceId, { immediate: false });
                this._affectedEntities.delete(entity);
            }
        }
        for (const entity of inRange) this._affectedEntities.add(entity);
    }
}
