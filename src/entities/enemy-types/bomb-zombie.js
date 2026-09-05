import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { FogVisualAdapter } from '../../effects/fog-visual-adapter.js';
import { hostilesOf } from './_shared/enemy-utils.js';
import {
    burstParticles,
    createGroundWarning,
    destroyWarning,
    fireGroundShockwave,
    fireRadialLines,
    keepWarningAlive,
    launchArcProjectile,
} from '../../effects/combat-fx.js';

/**
 * 炸弹僵尸（废弃矿洞专属精英）
 * - 攻击动画完整表现“掏取 → 点燃 → 抛出”，正式释放帧为 0-based 42。
 * - 炸弹固定时长抛物线落地，落地后保留实体与范围警示，独立等待 2s 再爆炸。
 * - 伤害、时序、碰撞范围与视觉尺寸全部由 enemy-config.json 驱动。
 */
export class BombZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.bombZombie,
            showWeapon: false,
            ...config,
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        this._animState = 'idle';
        this._animStateTimer = 0;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._throwCd = 0;
        this._throwReleased = false;

        this._bombFlights = new Set();
        this._landedBombs = [];

        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
    }

    _getThrowConfig() {
        return this.config?.attackSkills?.bombThrow || {};
    }

    _getDeathConfig() {
        return this.config?.death || {};
    }

    update(dt, entities) {
        if (!this.active) {
            // 已抛出的炸弹脱离施法者生命周期：死亡动画期间仍继续落地、计时和爆炸。
            this._updateLandedBombs(dt, entities);
            this._updateDeathSequence(dt);
            return;
        }

        super.update(dt, entities);

        // 已经落地的炸弹是独立危险物：施法者被控时仍继续走 2s 引信。
        this._updateLandedBombs(dt, entities);

        const attackDt = this.getAttackIntervalDelta(dt);
        if (this._throwCd > 0) this._throwCd -= attackDt;

        if (this.hasStatusEffect?.('stun')
            || this.hasStatusEffect?.('frozen')
            || this.hasStatusEffect?.('petrified')) {
            this._cancelAttack();
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            return;
        }
        if (this.hasStatusEffect?.('fear')) return;

        if (this._attackTimer > 0) this._updateThrowAttack(dt);

        const speed = Math.hypot(this.vx, this.vy);
        const nextState = this._attackTimer > 0
            ? 'attack'
            : (speed > (this.maxSpeed ?? this.speed ?? 130) * 0.05 ? 'walk' : 'idle');
        this._animStateTimer += dt;
        if (nextState !== this._animState && this._animStateTimer >= 80) {
            this._animState = nextState;
            this._animStateTimer = 0;
        }

        const target = this.target?.active ? this.target : null;
        if (this._attackTimer > 0 && target) {
            this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }

        if (!this._attackTimer && this._throwCd <= 0 && target) {
            const cfg = this._getThrowConfig();
            const distance = Math.hypot(target.x - this.x, target.y - this.y);
            if (distance <= (cfg.range ?? 650)) {
                this._tryAttackTelegraph(() => this._startThrow());
            }
        }
    }

    _startThrow() {
        const target = this.target?.active ? this.target : null;
        if (!target) return false;
        const cfg = this._getThrowConfig();
        const distance = Math.hypot(target.x - this.x, target.y - this.y);
        if (distance > (cfg.range ?? 650)) return false;

        const duration = cfg.duration ?? 5083;
        this._attackTimer = duration;
        this._attackAnimTimer = duration;
        this._throwCd = cfg.cooldown ?? 9000;
        this._throwReleased = false;
        this._animState = 'attack';
        this._animStateTimer = 0;
        this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        return true;
    }

    _cancelAttack() {
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._throwReleased = false;
    }

    _onCombatActionInterruptedByControl() {
        this._cancelAttack();
        super._onCombatActionInterruptedByControl();
    }

    _updateThrowAttack(dt) {
        const cfg = this._getThrowConfig();
        const duration = cfg.duration ?? 5083;
        const frames = cfg.frames ?? 61;
        const releaseFrame = cfg.releaseFrame ?? 42;

        this._attackTimer = Math.max(0, this._attackTimer - dt);
        this._attackAnimTimer = this._attackTimer;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        const elapsed = duration - this._attackTimer;
        if (!this._throwReleased && elapsed >= (releaseFrame / frames) * duration) {
            this._throwReleased = true;
            this._throwBomb();
        }
        if (this._attackTimer <= 0) {
            this._attackTimer = 0;
            this._attackAnimTimer = 0;
        }
    }

    _throwBomb() {
        const cfg = this._getThrowConfig();
        const target = this.target?.active ? this.target : null;
        const flyDuration = cfg.flyDuration ?? 1000;
        const flySeconds = flyDuration / 1000;
        let tx = this.x;
        let ty = this.y;
        if (target) {
            // 固定飞行时长抛物线使用线性外推落点，不走直线弹体拦截解。
            tx = target.x + (target.vx || 0) * flySeconds;
            ty = target.y + (target.vy || 0) * flySeconds;
        }
        const surfaceContext = target
            ? surfaceEffectFromEntity(target)
            : surfaceEffectFromEntity(this);
        const facingLeft = this._getPhaserOptions().flipX;
        const dirX = facingLeft ? -1 : 1;
        const sx = this.x + dirX * (cfg.muzzleForward ?? 80);
        const sy = this.y - (cfg.muzzleUpY ?? 60);

        let handle = null;
        handle = launchArcProjectile({
            textureKey: 'enemy_bomb_zombie_projectile',
            size: cfg.projectileSize ?? 64,
            sx,
            sy,
            tx,
            ty,
            arcHeight: cfg.arcHeight ?? 110,
            duration: flyDuration,
            spin: Math.PI * 2,
            depth: this.y + 15,
            onImpact: (ix, iy) => {
                if (handle) this._bombFlights.delete(handle);
                this._landBomb(ix, iy, surfaceContext);
            },
        });
        if (handle) this._bombFlights.add(handle);
    }

    _landBomb(x, y, surfaceContext) {
        const cfg = this._getThrowConfig();
        const baseSize = cfg.landedSize ?? cfg.projectileSize ?? 64;
        const bomb = {
            x,
            y,
            surfaceContext,
            timer: cfg.fuseMs ?? 2000,
            baseSize,
            sprite: null,
            warning: createGroundWarning(x, y, cfg.impactRadius ?? 180),
        };

        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene?.add?.sprite && scene.textures?.exists('enemy_bomb_zombie_projectile')) {
            const sprite = scene.add.sprite(
                x,
                y - (cfg.landedVisualUpY ?? 14),
                'enemy_bomb_zombie_projectile'
            );
            sprite.setDisplaySize(baseSize, baseSize);
            sprite.setRotation(Math.random() * Math.PI * 2);
            sprite.setDepth(y + 15);
            const descriptor = {
                position: { x, y },
                visuals: sprite,
            };
            if (typeof scene.syncFogVisualEffect === 'function') {
                scene.syncFogVisualEffect(sprite, descriptor);
            } else {
                FogVisualAdapter.register(sprite, descriptor);
            }
            bomb.sprite = sprite;
        }
        this._landedBombs.push(bomb);
    }

    _updateLandedBombs(dt, entities) {
        const fuseMs = this._getThrowConfig().fuseMs ?? 2000;
        for (let i = this._landedBombs.length - 1; i >= 0; i--) {
            const bomb = this._landedBombs[i];
            bomb.timer -= dt;
            if (!keepWarningAlive(bomb.warning)) bomb.warning = null;
            if (bomb.sprite?.active) {
                const progress = Math.max(0, Math.min(1, 1 - bomb.timer / fuseMs));
                const pulse = 1 + Math.sin(progress * Math.PI * 12) * (0.025 + progress * 0.07);
                bomb.sprite.setDisplaySize(bomb.baseSize * pulse, bomb.baseSize * pulse);
                if (progress >= 0.65) {
                    bomb.sprite.setTint(Math.sin(progress * Math.PI * 20) > 0 ? 0xffba66 : 0xff6848);
                }
            }
            if (bomb.timer > 0) continue;
            this._landedBombs.splice(i, 1);
            this._explodeBomb(bomb, entities);
        }
    }

    _explodeBomb(bomb, entities) {
        const cfg = this._getThrowConfig();
        this._destroyLandedBombVisual(bomb);

        const radius = cfg.impactRadius ?? 180;
        const shape = new GroundEllipse(
            bomb.x,
            bomb.y,
            radius,
            radius * PERSPECTIVE_SCALE_Y,
            bomb.surfaceContext || surfaceEffectFromEntity(this)
        );
        const atk = this.data?.atk || 0;
        const damage = Math.max(1, Math.round(atk * (cfg.damageMul ?? 1.75)));
        for (const entity of hostilesOf(this, entities)) {
            if (shape.intersectsEntity(entity)) {
                entity.takeDamage(damage, this, 'physical', false);
            }
        }

        fireGroundShockwave({
            x: bomb.x,
            y: bomb.y,
            maxRadius: radius,
            strokeColor: 0xffd06a,
            fillColor: 0xff4b1f,
            lineWidth: 12,
            duration: 520,
            strokeAlpha: 0.95,
            fillAlpha: 0.2,
        });
        fireRadialLines({
            x: bomb.x,
            y: bomb.y,
            count: 12,
            color: 0xffe1a0,
            innerFrom: 6,
            innerTo: radius * 0.2,
            outerFrom: radius * 0.25,
            outerTo: radius,
            duration: 360,
            lineWidth: 4,
            alpha: 0.95,
        });
        burstParticles({
            texture: 'smoke_particle',
            x: bomb.x,
            y: bomb.y,
            count: 18,
            config: {
                speed: { min: 70, max: 190 },
                angle: { min: 190, max: 350 },
                scale: { start: 0.45, end: 1.7 },
                alpha: { start: 0.8, end: 0 },
                tint: [0x5a4b43, 0x837065, 0xb59a80],
                lifespan: 850,
                blendMode: 'NORMAL',
            },
            destroyAfterMs: 950,
            depth: bomb.y + 20,
        });
        burstParticles({
            texture: 'impact_dot',
            x: bomb.x,
            y: bomb.y,
            count: 24,
            config: {
                speed: { min: 100, max: 260 },
                angle: { min: 0, max: 360 },
                scale: { start: 1.4, end: 0 },
                alpha: { start: 1, end: 0 },
                tint: [0xfff0a8, 0xffa43a, 0xd94a22],
                lifespan: 420,
                blendMode: 'ADD',
            },
            destroyAfterMs: 520,
            depth: bomb.y + 30,
        });
    }

    _destroyLandedBombVisual(bomb) {
        bomb.warning = destroyWarning(bomb.warning);
        if (bomb.sprite) {
            FogVisualAdapter.unregister(bomb.sprite);
            if (bomb.sprite.active) bomb.sprite.destroy();
            bomb.sprite = null;
        }
    }

    _destroyCustomEffects() {
        if (this._preserveBombsAfterDeath) return;
        for (const handle of this._bombFlights) handle.cancel();
        this._bombFlights.clear();
        for (const bomb of this._landedBombs) this._destroyLandedBombVisual(bomb);
        this._landedBombs = [];
    }

    onDeath(source) {
        const death = this._getDeathConfig();
        this.active = false;
        this._animState = 'death';
        this._animStateTimer = 0;
        this._cancelAttack();
        this._deathAnimTimer = death.animMs ?? 2750;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._deathRemoveDelay = this._deathAnimTimer
            + (death.holdMs ?? 1000)
            + (death.fadeMs ?? 300)
            + 500;
        // DamageableEntity.onDeath 会调用 _destroyCustomEffects；这里仅在死亡瞬间保留
        // 已抛出的飞行弹/落地弹，实体最终移除时仍走正常清理。
        this._preserveBombsAfterDeath = true;
        if (typeof super.onDeath === 'function') super.onDeath(source);
        this._preserveBombsAfterDeath = false;
    }

    _updateDeathSequence(dt) {
        const death = this._getDeathConfig();
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer -= dt;
            if (this._deathAnimTimer <= 0) {
                this._deathAnimTimer = 0;
                this._corpseTimer = death.holdMs ?? 1000;
            }
        } else if (this._corpseTimer > 0) {
            this._corpseTimer -= dt;
            if (this._corpseTimer <= 0) {
                this._corpseTimer = 0;
                this._fadeTimer = death.fadeMs ?? 300;
            }
        } else if (this._fadeTimer > 0) {
            this._fadeTimer -= dt;
            const fadeMs = death.fadeMs ?? 300;
            if (this._phaserSprite?.active) {
                this._phaserSprite.setAlpha(Math.max(0, this._fadeTimer / fadeMs));
            }
            if (this._fadeTimer <= 0 && this._phaserSprite?.active) {
                this._phaserSprite.destroy();
                this._phaserSprite = null;
            }
        }
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_bomb_zombie_walk';
            case 'attack': return 'enemy_bomb_zombie_attack';
            case 'death': return 'enemy_bomb_zombie_death';
            default: return 'enemy_bomb_zombie_idle';
        }
    }

    _getPhaserOptions() {
        let flipX = false;
        if (this._attackTimer > 0 && this.target?.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else {
            flipX = Math.cos(this.rotation ?? 0) < 0;
        }
        const render = this.config?.render || {};
        return {
            spriteSize: render.spriteSize ?? 260.7,
            collisionWidth: render.collisionWidth ?? 57.5,
            collisionHeight: render.collisionHeight ?? 158.8,
            textOffsetY: -(render.spriteSize ?? 260.7) / 2 - 10,
            flipX,
            animState: this._animState,
            animKey: this._getTextureKey(),
        };
    }
}
