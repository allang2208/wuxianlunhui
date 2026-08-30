import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import { isFriendlyFire } from '../damageable-entity.js';
import { PartySystem } from '../../systems/party-system.js';
import { distanceToEntityShape } from '../../utils/collision-helpers.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { canMeleeShareSurface } from '../../combat/melee-surface.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { WallSystem } from '../../world/wall-system.js';
import { createGroundWarning, keepWarningAlive, destroyWarning, fireGroundShockwave } from '../../effects/combat-fx.js';
import { FogVisualAdapter } from '../../effects/fog-visual-adapter.js';

const ATTACKS = ['stomp', 'pipe_blast', 'vein_resonance'];
const sceneForEffects = () => typeof window !== 'undefined' ? window.__phaserScene : null;

/** 高级废弃矿洞首领。动画帧、伤害窗口与弹体均消费逻辑 dt，不使用定时器结算伤害。 */
export class DeepVeinMother extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, { ...enemyConfigData.deepVeinMother, ...config, showWeapon: false });
        this._useStickFigure = false;
        this._usePacingAI = false;
        this._usesDirectedBasicMelee = false;
        // 技能决策自管，彻底关闭通用 thrust，避免接触帧以外多打一份伤害。
        this.attacks = {};
        this.aiInterval = Number.MAX_SAFE_INTEGER;
        this._animState = 'idle';
        this._animStateTimer = 0;
        this._action = null;
        this._actionTimer = 0;
        this._actionSnapshot = null;
        this._eventsFired = new Set();
        this._cooldowns = Object.fromEntries(ATTACKS.map(k => [k, this._skill(k).initialCooldownMs || 0]));
        this._thinkTimer = 0;
        this._recoveryTimer = 0;
        this._pressure = 0;
        this._pressurePending = false;
        this._lastEntities = null;
        this._warning = null;
        this._landingWarnings = [];
        this._projectiles = new Set();
        this._preserveCorpse = true;
        this._deathStarted = false;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._syncFrameGeometry();
        this._syncApproachProfile();
    }

    _skill(state) { return this.config.attackSkills[state]; }
    _layout(state = this._animState) { return this.config.textures.frameLayouts[state]; }
    _controlled() { return ['stun', 'frozen', 'petrified', 'fear'].some(k => this.hasStatusEffect(k)); }
    triggerWeaponAnim() {} // 所有攻击仅从本类 _startAction 进入。

    updateWhilePetrified(dt) {
        // 主循环石化时绕过 Enemy.update；仍须取消未释放节点并清理预警。
        this._finishAction(false);
        super.updateWhilePetrified(dt);
        if (this.active) this._updateProjectiles(dt);
    }

    update(dt, entities) {
        if (!this.active) { this._updateDeathSequence(dt); return; }
        const wasControlled = this._controlled();
        super.update(dt, entities);
        if (!this.active) return; // DOT 可在 super.update 内致死，不能再走攻击分支。
        this._lastEntities = entities;
        const cooldownDt = this.getAttackIntervalDelta(dt);
        for (const key of ATTACKS) this._cooldowns[key] = Math.max(0, this._cooldowns[key] - cooldownDt);
        this._recoveryTimer = Math.max(0, this._recoveryTimer - cooldownDt);
        // 已发射碎矿在硬控期间仍飞行；死亡/离场通过统一清理取消。
        this._updateProjectiles(dt);
        if (!this.active) return;
        if (wasControlled || this._controlled()) {
            this._finishAction(false);
            this._setState('idle');
            return;
        }
        if (this._action) { this._updateAction(dt); return; }
        if (this._pressurePending) { this._startAction('pressure_release'); return; }
        this._syncApproachProfile();
        this._thinkTimer -= dt;
        if (this._thinkTimer <= 0 && this._recoveryTimer <= 0) {
            this._thinkTimer = this.config.decisionIntervalMs;
            this._chooseAction();
            if (this._action) return;
        }
        const moving = Math.hypot(this.vx || 0, this.vy || 0) > this.speed * 0.05;
        if (moving) this.rotation = Math.atan2(this.vy, this.vx);
        this._setState(moving ? 'walking' : 'idle');
        this._animStateTimer = (this._animStateTimer + dt) % this._layout().duration;
    }

    _syncApproachProfile() {
        const target = this.target;
        const distance = target ? distanceToEntityShape(target, this.collider.x, this.collider.y) : Infinity;
        let range = this._approachReach('stomp');
        for (const key of ATTACKS) {
            // 目标已进入喷矿最小距离时不能仍以850刹停，否则会在纵向近战盒外干等。
            if (this._cooldowns[key] <= 0 && distance >= (this._skill(key).minTriggerRange || 0)) {
                range = Math.max(range, this._approachReach(key));
            }
        }
        this.attackRange = range;
        this.attackDistance = range;
    }

    _approachReach(state) {
        const cfg = this._skill(state);
        if (state === 'pipe_blast' || !this.target) return cfg.triggerRange;
        const dx = (this.target.collider?.x ?? this.target.x)-this.collider.x;
        const dy = (this.target.collider?.y ?? this.target.y)-this.collider.y;
        const groundAngle = Math.atan2(dy/PERSPECTIVE_SCALE_Y, dx);
        return cfg.triggerRange*Math.hypot(Math.cos(groundAngle), Math.sin(groundAngle)*PERSPECTIVE_SCALE_Y);
    }

    _chooseAction() {
        const target = this.target;
        if (!this._validTarget(target) || !canMeleeShareSurface(this, target)) return;
        const x = this.collider.x, y = this.collider.y;
        if (this._wallBlocked(x, y, target)) return;
        const distance = distanceToEntityShape(target, x, y);
        // 大范围技就绪且目标贴近时优先震脉；远处喷矿；近处重踏。
        for (const state of ['vein_resonance', 'pipe_blast', 'stomp']) {
            const cfg = this._skill(state);
            if (this._cooldowns[state] <= 0 && distance >= (cfg.minTriggerRange || 0)
                && distance <= this._approachReach(state)) {
                this._startAction(state, target);
                return;
            }
        }
    }

    _startAction(state, target = null) {
        if (this._action || !this.active) return;
        const x = this.collider.x, y = this.collider.y;
        const tx = target?.collider?.x ?? x + Math.cos(this.rotation);
        const ty = target?.collider?.y ?? y + Math.sin(this.rotation);
        const angle = Math.atan2(ty-y, tx-x);
        const groundAngle = Math.atan2((ty-y)/PERSPECTIVE_SCALE_Y, tx-x);
        const cfg = this._skill(state);
        this._action = state;
        this._actionSnapshot = { x, y, angle, groundAngle, surface: surfaceEffectFromEntity(this) };
        this._eventsFired.clear();
        this._actionTimer = this._layout(state).duration;
        this._attackAnimTimer = this._actionTimer;
        this._frozenForCast = true;
        this.vx = this.vy = 0;
        this.isMoving = false;
        this.rotation = angle;
        this._setState(state);
        if (state !== 'pressure_release') this._cooldowns[state] = cfg.cooldown;
        if (state === 'pipe_blast') {
            // 起手预判一次并锁定整组落点，三发不会各自追踪躲闪后的玩家。
            let dx = tx + (target.vx || 0)*cfg.leadMs/1000 - x;
            let dy = ty + (target.vy || 0)*cfg.leadMs/1000 - y;
            // 弹道射程与距离判定都采用实际世界坐标，不能只把纵向落点截成半射程。
            const d = Math.hypot(dx, dy) || 1;
            const limit = Math.min(1, cfg.triggerRange/d);
            dx *= limit; dy *= limit;
            this._actionSnapshot.landings = cfg.lateralOffsets.map(offset => ({
                x: x + dx - Math.sin(groundAngle)*offset,
                y: y + dy + Math.cos(groundAngle)*offset*PERSPECTIVE_SCALE_Y,
            }));
            this._landingWarnings = this._actionSnapshot.landings.map(p =>
                createGroundWarning(p.x, p.y-this._actionSnapshot.surface.z, cfg.impactRadius));
        } else if (state !== 'pressure_release') {
            const area = this._area(state, this._actionSnapshot);
            this._warning = createGroundWarning(area.x, area.y-area.surface.z, area.radius);
        }
    }

    _updateAction(dt) {
        const state = this._action;
        const layout = this._layout(state);
        const cfg = this._skill(state);
        this._actionTimer = Math.max(0, this._actionTimer-dt);
        this._animStateTimer = layout.duration-this._actionTimer;
        this._attackAnimTimer = this._actionTimer;
        this.vx = this.vy = 0;
        this.isMoving = false;
        this.rotation = this._actionSnapshot.angle;
        keepWarningAlive(this._warning);
        this._landingWarnings.forEach(keepWarningAlive);
        const events = state === 'pipe_blast' ? cfg.releaseFrames
            : state === 'pressure_release' ? [] : [cfg.contactFrame ?? cfg.releaseFrame];
        for (let i = 0; i < events.length; i++) {
            const at = events[i]*layout.duration/layout.frameCount;
            // >= + 逐事件消费：长帧跨过多个节点也补发，每节点最多一次。
            if (this._eventsFired.has(i) || this._animStateTimer < at) continue;
            if (this._eventsFired.size === 0) {
                this._pressure++;
                this._pressurePending = this._pressure >= this._skill('pressure_release').attacksPerRelease;
            }
            this._eventsFired.add(i);
            if (state === 'pipe_blast') this._launchOre(i, this._animStateTimer-at);
            else {
                const area = this._area(state, this._actionSnapshot);
                this._warning = destroyWarning(this._warning);
                this._impact(area, cfg, state, state === 'stomp');
            }
            // 招架反制/反伤可能在同一次命中内打断或击杀攻击者。
            if (!this.active || this._controlled()) { this._finishAction(false); return; }
        }
        if (this._actionTimer <= 0) this._finishAction(true);
    }

    _area(state, snapshot) {
        const cfg = this._skill(state);
        const offset = cfg.forwardOffset || 0;
        return { x: snapshot.x+Math.cos(snapshot.groundAngle)*offset,
            y: snapshot.y+Math.sin(snapshot.groundAngle)*offset*PERSPECTIVE_SCALE_Y,
            radius: cfg.radius, surface: snapshot.surface };
    }

    _launchOre(index, initialAge) {
        const snap = this._actionSnapshot;
        const cfg = this._skill('pipe_blast');
        const landing = snap.landings[index];
        const shot = { ...landing, radius: cfg.impactRadius, surface: snap.surface, age: initialAge,
            originX: snap.x, originY: snap.y,
            sx: snap.x+Math.cos(snap.angle)*cfg.muzzleForward,
            sy: snap.y, height: cfg.muzzleHeight,
            warning: this._landingWarnings[index], sprite: null };
        this._landingWarnings[index] = null;
        const scene = sceneForEffects();
        if (scene?.textures?.exists('enemy_deep_vein_mother_ore_fragment')) {
            shot.sprite = scene.add.sprite(shot.sx, shot.sy, 'enemy_deep_vein_mother_ore_fragment');
            shot.sprite.setDisplaySize(cfg.projectileSize, cfg.projectileSize);
            FogVisualAdapter.register(shot.sprite, { position: () => ({ x: shot.sprite.x, y: shot.sprite.y }), visuals: shot.sprite });
        }
        this._projectiles.add(shot);
        this._updateProjectile(shot, 0);
    }

    _updateProjectiles(dt) {
        for (const shot of this._projectiles) this._updateProjectile(shot, dt);
    }

    _updateProjectile(shot, dt) {
        const cfg = this._skill('pipe_blast');
        shot.age += dt;
        const p = Math.min(1, shot.age/cfg.flightMs);
        keepWarningAlive(shot.warning);
        if (shot.sprite?.active) {
            const groundY = shot.sy+(shot.y-shot.sy)*p;
            shot.sprite.setPosition(shot.sx+(shot.x-shot.sx)*p,
                groundY-shot.surface.z-shot.height*(1-p)-cfg.arcHeight*4*p*(1-p));
            shot.sprite.setDepth(groundY+15);
            shot.sprite.rotation = p*Math.PI*4;
        }
        if (p < 1) return;
        this._removeProjectile(shot);
        // 物理落点与爆炸各检查一次遮挡，不能隔墙空降伤害。
        if (!WallSystem.blocked(shot.originX, shot.originY, shot.x, shot.y)) {
            this._impact(shot, cfg, 'pipe_blast', false);
        }
    }

    _removeProjectile(shot) {
        shot.warning = destroyWarning(shot.warning);
        if (shot.sprite) { FogVisualAdapter.unregister(shot.sprite); shot.sprite.destroy(); }
        this._projectiles.delete(shot);
    }

    _impact(area, cfg, skillId, isMelee) {
        const shape = new GroundEllipse(area.x, area.y, area.radius, area.radius*PERSPECTIVE_SCALE_Y, area.surface);
        fireGroundShockwave({ x: area.x, y: area.y-area.surface.z, maxRadius: area.radius,
            strokeColor: 0xb978ee, fillColor: 0x74429f, duration: 450, groundLayer: true,
            depth: area.y-998, lineWidth: 5 });
        const supplied = this._lastEntities?.values ? this._lastEntities.values() : (this._lastEntities || []);
        const targets = new Set(supplied);
        for (const member of PartySystem.members || []) targets.add(member);
        for (const unit of (typeof window !== 'undefined' && window.Game?.friendlyUnits) || []) targets.add(unit);
        for (const target of targets) {
            if (!this.active || (isMelee && this._controlled())) break;
            if (!this._validTarget(target) || !shape.intersectsEntity(target) || this._wallBlocked(area.x, area.y, target)) continue;
            const angle = Math.atan2(target.collider.y-area.y, target.collider.x-area.x);
            const result = DamagePipeline.applyHit(this, target, {
                damage: Math.max(1, Math.round(this.data[cfg.damageType === 'magic' ? 'matk' : 'atk']*cfg.damageMul)),
                damageType: cfg.damageType, knockback: 0, angle, isMelee,
                confirmedHitContext: { skillId: `deepVeinMother.${skillId}` },
            });
            if (!result.hit || target.shieldSystem?._lastParried) continue;
            if (cfg.knockback > 0 && target.active) target.applyKnockback?.(angle, cfg.knockback);
            if (cfg.crippleMs > 0 && target.active) target.applyCripple?.(cfg.crippleMs);
        }
    }

    _validTarget(target) {
        return !!target && target !== this && target.active && !target._isDead && target.hp > 0
            && target.hittable !== false && target._faction !== 'enemy' && !isFriendlyFire(this, target);
    }

    _wallBlocked(x, y, target) {
        const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
        return WallSystem.blocked(x, y, target.collider?.x ?? target.x, target.collider?.y ?? target.y, ignore);
    }

    _finishAction(completed) {
        if (!this._action) return;
        if (completed && this._action === 'pressure_release') {
            this._pressure = 0;
            this._pressurePending = false;
        }
        this._warning = destroyWarning(this._warning);
        this._landingWarnings.forEach(destroyWarning);
        this._landingWarnings = [];
        this._action = null;
        this._actionSnapshot = null;
        this._actionTimer = this._attackAnimTimer = 0;
        this._frozenForCast = false;
        this._recoveryTimer = this.config.recoveryPauseMs;
        this._setState('idle');
        this._syncApproachProfile();
    }

    isCoreExposed() {
        if (!this.active || this._action !== 'pressure_release') return false;
        const layout = this._layout();
        const cfg = this._skill('pressure_release');
        const progress = this._animStateTimer*layout.frameCount/layout.duration;
        return progress >= cfg.exposedStartFrame && progress < cfg.exposedEndFrame;
    }

    takeDamage(damage, source, damageType = 'physical', isMelee = true, hitContext = null) {
        if (!this.active) return 0;
        // 进入统一防御/格挡/飘字/击杀链前放大输入攻击量；不直接扣血或改写基础防御。
        const multiplier = this.isCoreExposed() ? this._skill('pressure_release').incomingAttackMul : 1;
        return super.takeDamage(damage*multiplier, source, damageType, isMelee, hitContext);
    }

    _destroyCustomEffects() {
        this._warning = destroyWarning(this._warning);
        this._landingWarnings.forEach(destroyWarning);
        this._landingWarnings = [];
        for (const shot of this._projectiles) this._removeProjectile(shot);
    }

    onDeath(source) {
        if (this._deathStarted) return;
        this._deathStarted = true;
        this._finishAction(false);
        this._pressurePending = false;
        this._destroyCustomEffects();
        this.vx = this.vy = 0;
        this.isMoving = false;
        this._setState('dying');
        this._deathAnimTimer = this._layout('dying').duration;
        super.onDeath(source); // 掉落、首领奖励、波次击杀只结算一次。
    }

    _updateDeathSequence(dt) {
        if (!this._deathStarted) return;
        const cfg = this.config.death;
        this._animStateTimer += dt;
        const elapsed = this._animStateTimer;
        const animMs = this._layout('dying').duration;
        this._deathAnimTimer = Math.max(0, animMs-elapsed);
        this._corpseTimer = elapsed >= animMs ? Math.max(0, animMs+cfg.holdMs-elapsed) : 0;
        this._fadeTimer = elapsed >= animMs+cfg.holdMs ? Math.max(0, animMs+cfg.holdMs+cfg.fadeMs-elapsed) : 0;
        if (elapsed >= animMs+cfg.holdMs+cfg.fadeMs && this._phaserSprite) {
            this._phaserSprite.destroy();
            this._phaserSprite = null;
        }
    }

    _setState(state) {
        if (state === this._animState) return;
        this._animState = state;
        this._animStateTimer = 0;
        this._syncFrameGeometry();
    }

    _syncFrameGeometry() {
        const layout = this._layout();
        const scale = this.config.render.bodyDisplayHeight/layout.authoredBodyHeight;
        this.footOffsetY = (layout.footY-layout.frameHeight/2)*scale;
    }

    _getTextureKey() { return `enemy_deep_vein_mother_${this._animState}`; }

    _getPhaserOptions() {
        const layout = this._layout();
        const render = this.config.render;
        const elapsed = layout.repeat < 0 ? this._animStateTimer % layout.duration : this._animStateTimer;
        const frame = Math.min(layout.frameCount-1, Math.floor(elapsed*layout.frameCount/layout.duration));
        const alpha = !this.active && this._animStateTimer >= layout.duration+this.config.death.holdMs
            ? this._fadeTimer/this.config.death.fadeMs : 1;
        return { frame, alpha, flipX: Math.cos(this._actionSnapshot?.angle ?? this.rotation) < 0,
            spriteSize: Math.max(layout.frameWidth, layout.frameHeight)*render.bodyDisplayHeight/layout.authoredBodyHeight,
            collisionWidth: render.collisionWidth, collisionHeight: render.collisionHeight,
            textOffsetY: -render.collisionHeight-18, dynamicSpriteSize: true };
    }
}
