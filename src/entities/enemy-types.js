import { WallSystem } from '../world/wall-system.js';
import { Enemy } from './enemy.js';
import { distanceToEntityShape } from '../utils/collision-helpers.js';
import {
    straightMotionWasBlocked,
    sweptMotionMeleeHits,
} from '../combat/motion-melee-sweep.js';
import {
    canImpactBasicMelee,
    canStartBasicMelee,
    createBasicMeleeSnapshot,
} from '../combat/melee-attack-resolver.js';
import { burstParticles } from '../effects/combat-fx.js';
import { EffectManager } from '../effects/effect-manager.js';
import { VenomSprayEffect } from '../effects/venom-spray-effect.js';
import { MedusaPetrifyingGazeFx } from '../effects/medusa-petrifying-gaze-fx.js';
import { VineEntangleEffect } from '../effects/vine-entangle-effect.js';
import { DamagePipeline } from '../combat/damage-pipeline.js';
import { isFriendlyFire } from './damageable-entity.js';
import { PartySystem } from '../systems/party-system.js';
import { GroundEllipse, GroundSector } from '../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { surfaceEffectFromEntity } from '../physics/elevation.js';
import { EffectFactory } from '../utils/effect-factory.js';
import { playSoundFrom } from './enemy-types/_shared/enemy-utils.js';
import {
    createGroundWarning,
    destroyWarning,
    fireGroundShockwave,
    keepWarningAlive,
    launchArcProjectile,
} from '../effects/combat-fx.js';
import {
    hasRangedLineOfSight,
    rangedLineOfSightCacheToken,
} from '../combat/ranged-line-of-sight.js';

import enemyConfigData from '../../data/enemy-config.json';
import { ANIMATION_CONFIG } from '../config/animation-config.js';
import { loadImage } from '../utils/image-loader.js';
import { ZombieWizard } from './enemy-types/zombie-wizard.js';
import { Mutant3 } from './enemy-types/mutant-3.js';
import { SpitterZombie } from './enemy-types/spitter-zombie.js';
import { FatZombie } from './enemy-types/fat-zombie.js';
import { Zombie } from './enemy-types/zombie.js';
import { AmalgamZombie } from './enemy-types/amalgam-zombie.js';
import { ArmoredKnight } from './enemy-types/armored-knight.js';
import { Shounao } from './enemy-types/shounao.js';
import { FlySwarm } from './enemy-types/fly-swarm.js';
import { FlyHand } from './enemy-types/fly-hand.js';
import { TimeAgentAssault } from './enemy-types/time-agent-assault.js';
import { TimeAgentShield } from './enemy-types/time-agent-shield.js';
import { PoisonMaggot } from './enemy-types/poison-maggot.js';
import { MinerZombie } from './enemy-types/miner-zombie.js';
import { LanternMinerZombie } from './enemy-types/lantern-miner-zombie.js';
import { BombZombie } from './enemy-types/bomb-zombie.js';
import { SupportBeamBrute } from './enemy-types/support-beam-brute.js';
import { CoreDrillWorm } from './enemy-types/core-drill-worm.js';
export { CoreDrillLarva, OreShardling } from './enemy-types/mine-small-monsters.js';
import { ForemanZombie } from './enemy-types/foreman-zombie.js';
import { MineCave } from './enemy-types/mine-cave.js';
import { Tombstone } from './enemy-types/tombstone.js';
export { DeepVeinMother } from './enemy-types/deep-vein-mother.js';
import { OreSpider } from './enemy-types/ore-spider.js';
import { Witch } from './enemy-types/witch.js';
import { Cauldron } from './enemy-types/cauldron.js';
import { IceSpikeSystem } from './components/ice-spike-system.js';
import { FireballSystem } from './components/fireball-system.js';
import { LightningStrikeSystem } from './components/lightning-strike-system.js';

function getAnimConfig(key) {
    return ANIMATION_CONFIG[key] || {};
}

class BlackWolf extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.blackWolf,
            usePacingAI: true,
            ...config
        });
        // 与红狼王同例（SKILL 二十九版）：贴图自带脚部接地感，关闭运行时椭圆阴影——
        // 否则"脚底像地板的黑边"实为 GameScene._syncEntityShadows 画的 entity_shadow
        // （collider 处 90×45 黑椭圆、alpha 0.35），抠图永远清不掉
        this._noShadow = true;
        // 加载动画配置
        this._animCfg = getAnimConfig('blackWolf');
        const anim = this._animCfg.animation || {};
        const spritePaths = this._animCfg.sprites || {};

        // 加载精灵图
        this._sprites = {
            side: loadImage(spritePaths.side || 'assets/enemies/black_wolf_walk.png'),
            walk: loadImage(spritePaths.walk || 'assets/enemies/black_wolf_walk.png'),
            run: loadImage(spritePaths.run || 'assets/enemies/black_wolf_run.png'),
            front: loadImage(spritePaths.front || 'assets/enemies/black_wolf_updown.png'),
            back: loadImage(spritePaths.back || 'assets/enemies/black_wolf_updown.png'),
            bite: loadImage(spritePaths.bite || 'assets/enemies/black_wolf_bite_regular.png'),
            pacing: loadImage(spritePaths.pacing || 'assets/enemies/black_wolf_walk.png'),
            idle: loadImage(spritePaths.idle || 'assets/enemies/black_wolf_idle.png')
        };
        
        // 当前 facing 方向
        this._facing = 'right'; // right, left, up, down
        this._lastHorizontalFacing = 'right'; // 供垂直移动/idle时保持水平朝向
        
        // 动画状态
        this._animState = 'idle'; // idle, walk, run, attack, pacing
        this._attackTypes = anim.attackTypes || {}; // bite(普通撕咬)；红狼王另有 pounce(飞扑技能)
        this._attackType = 'bite';
        // 黑狼只保留撕咬；飞扑状态机为红狼王共享实现（红狼王构造器里 _usesPounce=true 并补齐状态字段）
        this._usesPounce = false;
        // 普通撕咬（近距离常态化攻击，无突进）
        this._biteState = 'idle'; // idle | attacking
        this._biteTimer = 0;
        this._biteCooldown = 0;
        this._biteTarget = null;
        this._biteSnapshot = null;
        this._biteDamaged = false;
        // 只保留撕咬：关闭通用 CombatSystem 攻击决策，撕咬由本类状态机自主触发
        this.aiInterval = Number.MAX_SAFE_INTEGER;
        // 帧动画
        const frameLayout = anim.frameLayout || {};
        this._frameW = frameLayout.width ?? 512;
        this._frameH = frameLayout.height ?? 512;
        this._cols = frameLayout.cols ?? 4;
        this._rows = frameLayout.rows ?? 4;
        this._frameLayouts = anim.frameLayouts || {};
        // 帧率配置 (ms/帧)
        this._frameDurations = anim.frameDurations || {
            idle: 200,
            walk: 120,
            run: 80,
            attack: 100,
            pacing: 160
        };
        // 动画速度阈值
        this._speedThresholds = anim.speedThresholds || {
            run: 1.2,
            walk: 0.1
        };
        this._facingThreshold = anim.facingThreshold ?? 0.5;

    }

    update(dt, entities) {
        super.update(dt, entities);
        // 死亡防御：game.js 已跳过 active=false 实体的 update，这里双保险
        if (this._isDead || !this.active) return;
        
        // === 根据主导速度方向确定 facing（攻击期间锁定）===
        // 飞扑冷却计时（红狼王共享；黑狼不触发）
        if (this._usesPounce && this._pounceCooldown > 0) this._pounceCooldown -= dt;
        // 普通撕咬冷却计时
        if (this._biteCooldown > 0) this._biteCooldown -= dt;

        // 眩晕/冰冻：中断攻击、禁止移动（参照 mutant-3）
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            if (this._usesPounce && this._pounceState !== 'idle') this._endPounce();
            if (this._biteState !== 'idle') this._endBite();
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            return;
        }

        // 恐惧：中断攻击并停止攻击决策（移动由 MovementSystem 恐惧分支接管逃跑；
        // 参照 mutant-3 的 fear 中断，且补上逃跑动画跟随）
        if (this.hasStatusEffect && this.hasStatusEffect('fear')) {
            if (this._usesPounce && this._pounceState !== 'idle') this._endPounce();
            if (this._biteState !== 'idle') this._endBite();
            this._updateNormalState();
            this._updateAnimFrame(dt);
            return;
        }

        // ===== 普通撕咬状态（近距离常态化攻击，无突进）=====
        if (this._biteState === 'attacking') {
            this._updateBite(dt);
        } else if (this._usesPounce && this._pounceState !== 'idle') {
            // ===== 飞扑状态机（红狼王共享，参照 mutant-3：idle → prepare 蓄力 → charge 冲锋）=====
            if (this._pounceState === 'prepare') {
                this._pounceTimer -= dt;
                this.vx = 0;
                this.vy = 0;
                this.isMoving = false;
                this._animState = 'attack';
                // 蓄力期间面向目标
                const pounceTarget = this._pounceTarget;
                if (pounceTarget && pounceTarget.active) {
                    this._facing = pounceTarget.x >= this.x ? 'right' : 'left';
                    this._lastHorizontalFacing = this._facing;
                }
                if (this._pounceTimer <= 0) {
                    this._startCharge();
                }
            } else if (this._pounceState === 'charge') {
                this._updatePounceCharge(dt);
            }
        } else {
            // 攻击决策：近距离撕咬优先；红狼王额外保留中距离飞扑（技能）
            if (this.target && this.target.active) {
                const hasLOS = this._hasLOSTo(this.target);
                const dist = Math.hypot(this.target.x - this.x, this.target.y - this.y);
                // 普通撕咬使用方向性单目标合同；飞扑仍保留位移技能自己的距离语义。
                if (this._biteCooldown <= 0 && hasLOS && this._canStartBite(this.target)) {
                    if (this._startBite()) return;
                }
                // pounce 触发保持技能射程语义（中心距 ≤ pounceRange，与 mutant-3 一致）
                if (this._usesPounce && this._pounceCooldown <= 0 && hasLOS && dist <= (this.config?.pounceRange ?? 500)) {
                    this._startPounce();
                    return;
                }
            }
            this._updateNormalState();
        }

        // ===== 更新帧动画（攻击按阶段帧区间推进，其余按状态）=====
        this._updateAnimFrame(dt);
    }

    triggerWeaponAnim() {
        // 黑狼攻击由自定义状态机自主触发（普通撕咬），不使用通用攻击动画触发
    }

    // 正常移动态：facing + 动画状态
    _updateNormalState() {
        const absVx = Math.abs(this.vx);
        const absVy = Math.abs(this.vy);
        const threshold = this._facingThreshold;
        if (absVx >= threshold || absVy >= threshold) {
            if (absVy > absVx) {
                this._facing = this.vy > 0 ? 'down' : 'up';
            } else {
                this._facing = this.vx > 0 ? 'right' : 'left';
            }
        }
        if (this._facing === 'left' || this._facing === 'right') {
            this._lastHorizontalFacing = this._facing;
        }
        this._facingDir = this._facing;

        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (this._aiState === 'pacing') {
            this._animState = 'pacing';
        } else if (speed > this._speedThresholds.run) {
            this._animState = 'run';
        } else if (speed > this._speedThresholds.walk) {
            this._animState = 'walk';
        } else {
            this._animState = 'idle';
        }
    }

    // 飞扑冲锋阶段：锁定发动时目标坐标 + 命中检测 + 红烟轨迹。
    _updatePounceCharge(dt) {
        const dtSec = dt / 1000;
        this._facing = this._pounceDir.x >= 0 ? 'right' : 'left';
        this._lastHorizontalFacing = this._facing;
        this._facingDir = this._facing;
        this._animState = 'attack';

        // 向锁定终点移动，最远不超过 maxDist。
        const distToEnd = this._pounceTargetPos
            ? Math.hypot(this._pounceTargetPos.x - this.x, this._pounceTargetPos.y - this.y)
            : 0;
        const fromX = this.x;
        const fromY = this.y;
        let intendedX = fromX;
        let intendedY = fromY;
        if (distToEnd > 10 && this._pounceSpeed > 0) {
            const step = Math.min(this._pounceSpeed * dtSec, distToEnd);
            intendedX = fromX + this._pounceDir.x * step;
            intendedY = fromY + this._pounceDir.y * step;
            const resolved = WallSystem.resolve(fromX, fromY, intendedX, intendedY, this.groundRadius);
            this.x = resolved.x;
            this.y = resolved.y;
        }
        const motionBlocked = straightMotionWasBlocked(
            fromX, fromY, intendedX, intendedY, this.x, this.y
        );

        // 命中检测只认发动时锁定目标，并扫过本帧实际可达轨迹。
        const hitTarget = this._pounceTarget;
        if (!this._pounceDamaged && hitTarget && hitTarget.active && hitTarget.hittable) {
            if (sweptMotionMeleeHits(
                this,
                hitTarget,
                fromX,
                fromY,
                this.x,
                this.y,
                this.config?.pounceHitDistance ?? 100,
                { blocked: motionBlocked, skill: '红狼王飞扑' }
            )) {
                this._dealPhysicalHit(hitTarget, this._getPounceDamage());
                this._pounceDamaged = true;
                // 盾牌弹反：不再眩晕，弹反本身已处理（参照 mutant-3）
                const parried = hitTarget.shieldSystem && hitTarget.shieldSystem._lastParried;
                if (parried) {
                    this._endPounce();
                    return;
                }
                // 命中不眩晕，改为 3 秒致残（减速 debuff）
                if (hitTarget.applyCripple) {
                    hitTarget.applyCripple(this.config?.pounceCrippleMs ?? 3000);
                    this._endPounce();
                    return;
                }
            }
        }

        // 沿实际位移点连续散布红烟，终点和方向都自然跟随飞扑轨迹。
        this._pounceTrailTimer -= dt;
        if (this._pounceTrailTimer <= 0) {
            this._spawnPounceSmoke();
            this._pounceTrailTimer = 65;
        }

        if (motionBlocked || !hitTarget || !hitTarget.active || hitTarget._isDead) {
            this._endPounce();
            return;
        }

        this._pounceTimer -= dt;
        this._attackAnimTimer = Math.max(0, this._pounceTimer); // 阻止 MovementSystem 转向（参照 mutant-3）
        if (this._pounceTimer <= 0 || distToEnd <= 10) {
            this._endPounce();
        }
    }

    // 帧动画推进：攻击按 prepare/charge 阶段帧区间，其余按状态帧率
    _updateAnimFrame(dt) {
        this._animTimer += dt;
        if (this._animState === 'attack') {
            if (this._biteState === 'attacking') {
                // 普通撕咬：按配置帧时长推进；红狼王快咬合版为 21 帧 @50ms。
                const frameDuration = this._frameDurations.bite || 100;
                if (this._animTimer >= frameDuration) {
                    this._animTimer = 0;
                    this._animFrame = Math.min(this._animFrame + 1, this._getStateFrameCount() - 1);
                }
            } else {
                // 飞扑帧推进（红狼王共享；黑狼只走 bite 分支）
                const pounceCfg = this._attackTypes?.pounce || {};
                const total = this._getStateFrameCount();
                const prepareFrames = pounceCfg.prepareFrames ?? 4;
                if (this._pounceState === 'prepare') {
                    const frameDur = (pounceCfg.prepareMs ?? 1000) / Math.max(1, prepareFrames);
                    if (this._animTimer >= frameDur) {
                        this._animTimer = 0;
                        this._animFrame = Math.min(this._animFrame + 1, prepareFrames - 1);
                    }
                } else if (this._pounceState === 'charge') {
                    const chargeFrames = Math.max(1, total - prepareFrames);
                    const frameDur = (pounceCfg.chargeMs ?? 1000) / chargeFrames;
                    if (this._animTimer >= frameDur) {
                        this._animTimer = 0;
                        this._animFrame = Math.min(this._animFrame + 1, total - 1);
                    }
                }
            }
        } else {
            const frameDuration = this._frameDurations[this._animState] || 150;
            if (this._animTimer >= frameDuration) {
                this._animTimer = 0;
                this._animFrame = (this._animFrame + 1) % this._getStateFrameCount();
            }
        }
    }

    // ===== 普通撕咬（近距离常态化攻击，小幅度、无突进）=====
    _getBiteWidth() {
        return this.config?.biteWidth
            ?? this.config?.attack?.width
            ?? 20;
    }

    _getBiteStartConfig() {
        return {
            range: this.config?.biteRange ?? 150,
            width: this._getBiteWidth(),
        };
    }

    _getBiteImpactConfig() {
        return {
            range: this.config?.biteHitDistance ?? 90,
            width: this._getBiteWidth(),
        };
    }

    getBasicMeleeApproachConfig() {
        return this._getBiteStartConfig();
    }

    _canStartBite(target) {
        return canStartBasicMelee(this, target, this._getBiteStartConfig());
    }

    _startBite() {
        if (this._biteState !== 'idle' || !this._canStartBite(this.target)) return false;
        const biteTarget = this.target;
        this._biteState = 'attacking';
        this._animState = 'attack';
        this._frozenForCast = true; // 攻击期间锁定移动（防边攻击边漂移）
        this._biteTimer = this._attackTypes?.bite?.durationMs ?? 600;
        this._biteCooldown = this.config?.biteCooldown ?? 1200;
        this._biteTarget = biteTarget;
        this._biteSnapshot = createBasicMeleeSnapshot(
            this,
            biteTarget,
            this._getBiteImpactConfig()
        );
        this._biteDamaged = false;
        this._animFrame = 0;
        this._animTimer = 0;
        if (biteTarget && biteTarget.active) {
            this._facing = biteTarget.x >= this.x ? 'right' : 'left';
            this._lastHorizontalFacing = this._facing;
        }
        return true;
    }

    _tryBiteImpact() {
        if (this._biteDamaged || !this._biteTarget || !this._biteSnapshot) return false;
        if (!canImpactBasicMelee(this, this._biteTarget, this._biteSnapshot)) return false;
        this._dealPhysicalHit(this._biteTarget, this._getBiteDamage());
        this._biteDamaged = true;
        return true;
    }

    _updateBite(dt) {
        this._biteTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this._animState = 'attack';
        // 面向目标（原地小幅咬，无位移）
        if (this._biteTarget && this._biteTarget.active) {
            this._facing = this._biteTarget.x >= this.x ? 'right' : 'left';
            this._lastHorizontalFacing = this._facing;
        }
        // 动画中段（约 200~450ms）命中一次
        const elapsed = (this._attackTypes?.bite?.durationMs ?? 600) - this._biteTimer;
        if (!this._biteDamaged && elapsed >= 200 && elapsed <= 450) {
            this._tryBiteImpact();
        }
        if (this._biteTimer <= 0) {
            this._endBite();
        }
    }

    _endBite() {
        this._biteState = 'idle';
        this._frozenForCast = false;
        this._biteTimer = 0;
        this._biteTarget = null;
        this._biteSnapshot = null;
        this._biteDamaged = false;
        this._animState = 'idle';
        this._animFrame = 0;
    }

    _getBiteDamage() {
        // 普通撕咬：物理攻击基础伤害（无致残/眩晕附加）
        return this.data.atk || this.data.str || 20;
    }

    _dealPhysicalHit(target, damage) {
        return target.takeDamage(damage, this, 'physical', true);
    }

    // ===== 飞扑状态机（红狼王共享实现；黑狼只保留撕咬，不触发）=====
    _startPounce() {
        if (this._pounceState !== 'idle') return;
        this._pounceState = 'prepare';
        this._pounceAnimPhase = 'prepare';
        this._animState = 'attack';
        this._frozenForCast = true;
        this._pounceTimer = this._attackTypes?.pounce?.prepareMs ?? 1000;
        this._pounceCooldown = this.config?.pounceCooldown ?? 12000;
        this._pounceTarget = this.target;
        this._animFrame = 0;
        this._animTimer = 0;
        if (this.target && this.target.active) {
            this._facing = this.target.x >= this.x ? 'right' : 'left';
            this._lastHorizontalFacing = this._facing;
        }
    }

    _startCharge() {
        if (this._pounceState !== 'prepare') return;
        this._pounceState = 'charge';
        this._pounceAnimPhase = 'charge';
        this._frozenForCast = false;
        this._pounceTrailTimer = 0;
        this._pounceDamaged = false;

        const maxDist = this.config?.pounceMaxDist ?? 1000;
        const target = this._pounceTarget;
        if (target && target.active && !target._isDead
            && (!Number.isFinite(target.hp) || target.hp > 0)) {
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
                this._pounceDir = { x: dx / dist, y: dy / dist };
                // 飞扑位移在冲锋开始时快照目标位置，不再穿过目标或动态追踪。
                const clamped = Math.min(dist, maxDist);
                this._pounceTargetPos = {
                    x: this.x + this._pounceDir.x * clamped,
                    y: this.y + this._pounceDir.y * clamped
                };
                this._pounceChargeDistance = clamped;
            } else {
                this._endPounce();
                return;
            }
        } else {
            this._endPounce();
            return;
        }

        // 冲锋时长由配置驱动（chargeMs），速度 = 距离/时长（当前 1250ms = 比原 1s 慢 25%）
        const chargeMs = this._attackTypes?.pounce?.chargeMs ?? 1000;
        this._pounceTimer = chargeMs;
        this._attackAnimTimer = chargeMs;
        this._pounceSpeed = this._pounceChargeDistance / (chargeMs / 1000);

        // 帧从蓄力区切到冲锋区（保持视觉连续）
        const prepareFrames = this._attackTypes?.pounce?.prepareFrames ?? 4;
        this._animFrame = Math.max(this._animFrame, prepareFrames - 1);
    }

    _endPounce() {
        this._pounceState = 'idle';
        this._pounceAnimPhase = null;
        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._pounceTimer = 0;
        this._pounceTrailTimer = 0;
        this._pounceTargetPos = null;
        this._pounceDamaged = false;
        this._pounceTarget = null;
        this._animState = 'idle';
        this._animFrame = 0;
    }

    _getPounceDamage() {
        // 基类默认 1 倍；红狼王覆盖为 2 倍。
        return this.data.atk || this.data.str || 20;
    }

    _isTargetInRange(target, range) {
        if (!target) return false;
        // 统一口径：与 CombatSystem/inMeleeRange 同语义（distanceToEntityShape 边缘距）
        return distanceToEntityShape(target, this.x, this.y) <= Math.max(0, range);
    }

    // LOS 检查：复用 PerceptionSystem 缓存，缺省回退 WallSystem（与 CombatSystem 同模式）
    _hasLOSTo(target) {
        if (!target) return false;
        const losCache = this._perception && this._perception.losCache;
        const cached = losCache ? losCache.get(target.id) : null;
        const surfaceToken = rangedLineOfSightCacheToken(this, target);
        const interval = Number(this._perception?.losCheckInterval) || 0;
        if (cached && cached.surfaceToken === surfaceToken
            && (!interval || Date.now() - cached.time < interval)) return !!cached.result;
        const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
        return hasRangedLineOfSight(this, target, 8, ignore);
    }

    // 飞扑轨迹红烟：每个采样点生成短寿命烟团，使用 NORMAL 混合避免白色发光线。
    _spawnPounceSmoke() {
        const depth = this._phaserSprite ? this._phaserSprite.depth - 1 : this.y + 999;
        const groundRadius = Number(this.groundRadius) || 0;
        burstParticles({
            texture: 'smoke_particle',
            x: this.x - this._pounceDir.x * 16,
            y: this.y - this._pounceDir.y * 16 + groundRadius * 0.2,
            count: 4,
            jitter: 12,
            config: {
                speed: { min: 12, max: 48 },
                angle: { min: 0, max: 360 },
                scale: { start: 0.65, end: 1.9 },
                alpha: { start: 0.58, end: 0 },
                lifespan: { min: 460, max: 760 },
                tint: [0x3b070b, 0x7d0d16, 0xb51c26, 0xd6403f],
                blendMode: 'NORMAL',
            },
            destroyAfterMs: 850,
            depth,
        });
    }

    _getTextureKey() {
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            return 'enemy_black_wolf_idle';
        }
        if (this._animState === 'attack') {
            return 'enemy_black_wolf_bite';
        }
        if (this._animState === 'pacing') {
            return 'enemy_black_wolf_walk';
        }
        if (this._animState === 'run') {
            return 'enemy_black_wolf_run';
        }
        if (this._animState === 'idle') {
            return 'enemy_black_wolf_idle';
        }
        return 'enemy_black_wolf_walk';
    }

    // 当前状态的精灵图网格与帧数
    _getFrameLayout(state) {
        const layouts = this._frameLayouts || {};
        const key = state === 'attack' ? 'bite' : state;
        return layouts[key] || layouts.walk || { cols: 4, rows: 4 };
    }

    _getStateFrameCount() {
        const layouts = this._frameLayouts || {};
        if (this._animState === 'attack') {
            return layouts.bite?.frames || 6;
        }
        return layouts[this._animState]?.frames || (this._animState === 'run' ? 14 : (this._animState === 'walk' ? 16 : 8));
    }

    _getPhaserOptions() {
        let flipX;
        if (this._facing === 'left') {
            flipX = true;
        } else if (this._facing === 'right') {
            flipX = false;
        } else {
            // up/down：没有上下精灵图
            if (Math.abs(this.vx) > 0.1) {
                flipX = this.vx < 0;
            } else {
                // 纯垂直移动/idle：保持上次水平朝向
                flipX = this._lastHorizontalFacing === 'left';
            }
        }

        const renderCfg = this._animCfg?.render || {};
        return {
            spriteSize: renderCfg.spriteSize ?? 151,
            rotation: 0,
            // 眩晕/冰冻时纹理切到单帧 idle 图，帧号必须归零，否则 setFrame 在 1 帧贴图上刷 "has no frame"
            frame: (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) ? 0 : this._animFrame,
            flipX: flipX,
            flipY: false,
            textOffsetY: -64,
            nameColor: 'rgba(255, 60, 60, 0.9)'
        };
    }

    _drawBody(ctx) {
        const params = this._getBodyAnimationParams();
        let { bounceY, scaleX, scaleY, leanAngle, swayX } = params;

        let currentSprite;
        let staticImage = false;
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            // 眩晕状态：显示 idle 图片（被弹反后）
            currentSprite = this._sprites.idle;
            staticImage = true;
        } else if (this._animState === 'attack') {
            currentSprite = this._sprites.bite;
        } else if (this._animState === 'pacing') {
            currentSprite = this._sprites.pacing;
        } else if (this._animState === 'run') {
            currentSprite = this._sprites.run || this._sprites.side;
        } else if (this._animState === 'idle') {
            currentSprite = this._sprites.idle;
            staticImage = true;
        } else {
            currentSprite = this._sprites.walk || this._sprites.side;
        }

        const shouldFlip = this._facing === 'left' ||
            ((this._facing === 'up' || this._facing === 'down') && (
                (Math.abs(this.vx) > 0.1 && this.vx < 0) ||
                (Math.abs(this.vx) <= 0.1 && this._lastHorizontalFacing === 'left')
            ));
        if (shouldFlip) ctx.scale(-1, 1);
        ctx.rotate(leanAngle);
        if (currentSprite && currentSprite.complete && currentSprite.naturalWidth > 0) {
            if (staticImage) {
                // idle / 眩晕冻结图片：单张，直接绘制，缩放至 151x151
                const renderCfg = this._animCfg?.render || {};
                const spriteSize = renderCfg.spriteSize ?? 151;
                const spriteOffset = renderCfg.spriteOffset ?? -76;
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, spriteOffset, spriteOffset, spriteSize, spriteSize);
                ctx.restore();
            } else {
                // 正常帧动画
                const layout = this._getFrameLayout(this._animState);
                const frameW = currentSprite.naturalWidth / layout.cols;
                const frameH = currentSprite.naturalHeight / layout.rows;
                const col = this._animFrame % layout.cols;
                const row = Math.floor(this._animFrame / layout.cols);
                const renderCfg = this._animCfg?.render || {};
                const spriteSize = renderCfg.spriteSize ?? 151;
                const spriteOffset = renderCfg.spriteOffset ?? -76;
                ctx.save();
                ctx.translate(0, swayX);
                ctx.scale(scaleX, scaleY);
                ctx.translate(0, bounceY);
                ctx.drawImage(currentSprite, col * frameW, row * frameH, frameW, frameH, spriteOffset, spriteOffset, spriteSize, spriteSize);
                ctx.restore();
            }
        } else {
            super._drawBody(ctx);
        }
    }

    _drawShadow(ctx, x, y, _size) {
        // 阴影绑定碰撞体积位置：使用碰撞半径，随冲刺同步
        const r = this.groundRadius;
        const shadowCfg = this._animCfg?.render?.shadow || {};
        ctx.fillStyle = shadowCfg.color || 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.ellipse(x, y + r * (shadowCfg.yFactor ?? 0.5) + (shadowCfg.yOffset ?? 15), r * (shadowCfg.rxFactor ?? 1), r * (shadowCfg.ryFactor ?? 0.35), 0, 0, Math.PI * 2);
        ctx.fill();
    }

    _resetPacingInterval() {
        const cfg = this._animCfg?.animation?.pacingInterval || { min: 1000, max: 2000 };
        this._pacingInterval = cfg.min + Math.random() * (cfg.max - cfg.min);
    }

    _getDashOffsetProgress(progress) {
        const phases = this._animCfg?.animation?.dashEasing?.phases;
        if (!phases) return progress;
        for (const phase of phases) {
            if (progress <= phase.until) {
                if (phase.mode === 'constant') return phase.value;
                if (phase.mode === 'linear') {
                    const range = phase.until - phase.from;
                    const local = range > 0 ? (progress - phase.from) / range : 0;
                    return phase.fromValue + (phase.toValue - phase.fromValue) * local;
                }
            }
        }
        return 1;
    }

    _getBodyAnimationParams() {
        const cfg = this._animCfg?.render?.body || {};
        const t = this.animTime;
        let bounceY = 0, scaleX = 1, scaleY = 1, leanAngle = 0, swayX = 0;
        if (this._animState === 'attack') {
            const attackCfg = cfg.attack || {};
            const progress = 1 - Math.max(0, this._attackTimer) / (attackCfg.duration ?? 300);
            const scale = 1 + Math.sin(progress * Math.PI) * (attackCfg.scaleAmplitude ?? 0.15);
            scaleX = scale; scaleY = scale;
            bounceY = -Math.sin(progress * Math.PI) * (attackCfg.bounceAmplitude ?? 5);
            leanAngle = attackCfg.leanAngle ?? 0.1;
        } else if (this._animState === 'run') {
            const runCfg = cfg.run || {};
            const runPhase = t * (runCfg.phaseSpeed ?? 2);
            bounceY = Math.sin(runPhase) * (runCfg.bounceAmplitude ?? 4);
            leanAngle = Math.sin(runPhase) * (runCfg.leanAmplitude ?? 0.12);
            swayX = Math.sin(runPhase + (runCfg.swayPhaseOffset ?? Math.PI / 4)) * (runCfg.swayAmplitude ?? 2);
            const stretch = Math.sin(runPhase * 2) * (runCfg.stretchAmplitude ?? 0.015);
            scaleX = 1 + stretch; scaleY = 1 - stretch * (runCfg.stretchYFactor ?? 0.3);
        } else if (this._animState === 'walk' || this._animState === 'pacing') {
            const stateCfg = cfg[this._animState] || cfg.walk || {};
            bounceY = Math.sin(t) * (stateCfg.bounceAmplitude ?? 2);
        }
        return { bounceY, scaleX, scaleY, leanAngle, swayX };
    }
}

/**
 * 红狼王（elite，2026-08-23 母版六动作 + 狼人变身）：
 * - 狼形使用 idle / running / bite / pounce / howl / dying 六套母版；
 * - HP ≤ 阈值播放新 H3 狼→狼人变身，完成后保持狼人末帧承接二阶段；
 * - 狼形和狼人飞扑均使用独立母版，640 格按 512 基准归一化显示尺寸与脚底；
 * - 动画继续走 Phaser setFrame 帧索引路径，死亡接入保尸生命周期。
 */
class RedWolfKing extends BlackWolf {
    constructor(x, y, config = {}) {
        super(x, y, { ...enemyConfigData.redWolfKing, ...config });
        // 红狼王贴图自带脚部接地感，关闭运行时椭圆阴影——用户多次反馈
        // "脚下像地面的大块色块"（GameScene._syncEntityShadows 绘制的
        // entity_shadow，90×45px、alpha 0.35，固定跟随 collider 而贴图
        // 奔跑弹跳，视觉上像贴图底部拖着一块地面色块）。
        this._noShadow = true;
        this._animCfg = getAnimConfig('redWolfKing');
        const anim = this._animCfg.animation || {};
        const spritePaths = this._animCfg.sprites || {};
        // 帧网格/帧率必须重取红狼王自己的配置：BlackWolf 构造器已按 blackWolf 配置
        // 填过 _frameLayouts/_frameDurations，不重取会让六套新动画落回黑狼帧表。
        const frameLayout = anim.frameLayout || {};
        this._frameW = frameLayout.width ?? 512;
        this._frameH = frameLayout.height ?? 512;
        this._cols = frameLayout.cols ?? 4;
        this._rows = frameLayout.rows ?? 4;
        this._frameLayouts = anim.frameLayouts || {};
        this._frameDurations = anim.frameDurations || {
            idle: 200,
            walk: 120,
            run: 80,
            attack: 100,
            pacing: 160
        };
        // 六套母版狼形贴图；walk/pacing 共用 running。transform 是本轮新 H3
        // 首尾帧视频导出的 21 帧序列，不复用已经退出运行时的旧狼人资产。
        const runningSprite = loadImage(spritePaths.run || spritePaths.side || 'assets/enemies/red_wolf_king/running.png');
        this._wolfSprites = {
            side: runningSprite,
            front: runningSprite,
            back: runningSprite,
            walk: runningSprite,
            pacing: runningSprite,
            run: runningSprite,
            idle: loadImage(spritePaths.idle || 'assets/enemies/red_wolf_king/idle.png'),
            bite: loadImage(spritePaths.attack || 'assets/enemies/red_wolf_king/attack.png'),
            pounce: loadImage(spritePaths.pounce || 'assets/enemies/red_wolf_king/pounce.png'),
            dying: loadImage(spritePaths.dying || 'assets/enemies/red_wolf_king/dying.png'),
            howl: loadImage(spritePaths.howl || 'assets/enemies/red_wolf_king/howl.png'),
            transform: loadImage(spritePaths.transform || 'assets/enemies/red_wolf_king/transform.png'),
        };
        this._werewolfSprites = {
            idle: loadImage(spritePaths.werewolfIdle || 'assets/enemies/red_wolf_king/werewolf_idle.png'),
            run: loadImage(spritePaths.werewolfRun || 'assets/enemies/red_wolf_king/werewolf_running.png'),
            attack: loadImage(spritePaths.werewolfAttack || 'assets/enemies/red_wolf_king/werewolf_attacking.png'),
            pounce: loadImage(spritePaths.werewolfPounce || 'assets/enemies/red_wolf_king/werewolf_pouncing.png'),
            howl: loadImage(spritePaths.werewolfHowl || 'assets/enemies/red_wolf_king/werewolf_howling.png'),
            dying: loadImage(spritePaths.werewolfDying || 'assets/enemies/red_wolf_king/werewolf_dying.png'),
        };
        this._sprites = this._wolfSprites;
        // 二阶段配置：全属性强化、变身减伤和专属暴击，完成后切入狼人五动作。
        this._transformCfg = this._animCfg.transform || {};
        // v03 狼人虽然站立体高更高，但两足轮廓远窄于四足狼；按用户实测定稿为 1.8，
        // 确保变身后具备明确的首领体量。碰撞倍率仍独立配置，视觉修正不扩大攻击/受击判定。
        this._werewolfVisualScaleTarget = this._transformCfg.werewolfVisualScale ?? 1.8;
        this._werewolfCollisionScaleTarget = this._transformCfg.werewolfCollisionScale ?? 1.25;
        this._werewolfCollisionBase = null;
        this._appliedWerewolfCollisionScale = 1;
        this._transformedFrameDurations = anim.transformedFrameDurations || {
            idle: 90,
            walk: 124.583333,
            run: 115,
            pacing: 153.333333,
        };
        this._isTransforming = false;
        this._isTransformed = false;
        this._transformTriggered = false;
        this._transformTimer = 0;
        this._howlTimer = 0;
        this._howlResumeVelocity = null;
        // 双攻击：近距离撕咬 / 中距离飞扑。
        this._attackTypes = anim.attackTypes || {};
        this._attackType = 'bite';
        // 飞扑状态机由 BlackWolf 基类共享实现：红狼王启用，状态字段在基类已移除、这里补齐声明
        this._usesPounce = true;
        this._pounceState = 'idle'; // idle | prepare | charge
        this._pounceAnimPhase = null; // null | prepare | charge
        this._pounceTimer = 0;
        this._pounceCooldown = 0;
        this._pounceTarget = null;
        this._pounceTargetPos = null;
        this._pounceDir = { x: 0, y: 0 };
        this._pounceSpeed = 0;
        this._pounceDamaged = false;
        this._pounceTrailTimer = 0;
        // 二阶段主动嚎叫，给场上全体怪物激励 30s。
        this._howlCd = 0;
        // 死亡动画与短暂保尸；Game/GameScene 已识别同名计时字段。
        this._preserveCorpse = true;
        this._deathStarted = false;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._visualStateKey = 'idle';
        this._syncVisualFrameMetrics();
    }

    update(dt, entities) {
        // active=false 的死亡实体由主循环保留更新；只推进 dying/尸体计时，绝不再跑 AI。
        if (!this.active) {
            this._updateDeathAnimation(dt);
            return;
        }

        // 半血阶段强化：保留原数值契约，同时播放狼→狼人变身序列。
        if (!this._transformTriggered && this.maxHp > 0 && this.hp / this.maxHp <= (this._transformCfg.hpThreshold ?? 0.5)) {
            this._transformTriggered = true;
            this._isTransforming = true;
            this._transformTimer = this._transformCfg.duration ?? 2000;
            this._captureWerewolfCollisionBase();
            this._animFrame = 0;
            this._animTimer = 0;
        }
        if (this._isTransforming) {
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            if (this._biteState === 'attacking') this._endBite();
            if (this._pounceState !== 'idle') this._endPounce();
            this._frozenForCast = true;
            this._transformTimer -= dt;
            if (this._transformTimer <= 0) {
                this._transformTimer = 0;
                this._isTransforming = false;
                this._isTransformed = true;
                this._frozenForCast = false;
                this._applyTransform();
                this._howlTimer = 0;
                // 阶段切换本身已经播放嚎叫，主动技能延迟 5s 后才可再次释放。
                this._howlCd = Math.min(this._getHowlConfig().cooldown ?? 30000, 5000);
            }
        }
        if (this._isTransforming || this._isTransformed) {
            this._syncWerewolfCollisionScale();
        }
        if (this._howlTimer > 0) {
            this._howlTimer -= dt;
            this.vx = 0;
            this.vy = 0;
            if (this._biteState === 'attacking') this._endBite();
            if (this._pounceState !== 'idle') this._endPounce();
            this._frozenForCast = true;
            if (this._howlTimer <= 0) {
                this._howlTimer = 0;
                this._frozenForCast = false;
                const resume = this._howlResumeVelocity;
                if (resume && this.target && this.target.active) {
                    const resumeSpeed = Math.hypot(resume.x, resume.y);
                    const dx = this.target.x - this.x;
                    const dy = this.target.y - this.y;
                    const distance = Math.hypot(dx, dy);
                    this.vx = distance > 0.001 ? dx / distance * resumeSpeed : 0;
                    this.vy = distance > 0.001 ? dy / distance * resumeSpeed : 0;
                    this.isMoving = Math.hypot(this.vx, this.vy) > 0.1;
                }
                this._howlResumeVelocity = null;
            }
        }
        super.update(dt, entities);
        if (this._howlCd > 0) this._howlCd -= dt;
        // 二阶段主动嚎叫：只看真实攻击状态，_attackType 是最近一次攻击的视觉类型。
        if (this._isTransformed && this._howlCd <= 0 && this.target && this.target.active
            && this._biteState === 'idle' && this._pounceState === 'idle'
            && !this._isTransforming && this._howlTimer <= 0) {
            this._startHowl(entities);
        }
        // 变身期完整播放21帧；完成后保留 BlackWolf 的真实 idle/run/attack 状态，
        // 仅在主动嚎叫期间强制切到狼人 howl。
        if (this._isTransforming) {
            this._animState = 'transform';
        } else if (this._howlTimer > 0) {
            this._animState = 'howl';
        }
        this._sprites = this._isTransformed ? this._werewolfSprites : this._wolfSprites;
        this._syncVisualState();
        if (this._isTransforming) {
            this._animFrame = this._timerFrame(this._transformTimer, this._transformCfg.duration ?? 2000);
        } else if (this._howlTimer > 0) {
            const howlTotal = this._getHowlConfig().duration ?? 3000;
            this._animFrame = this._timerFrame(this._howlTimer, howlTotal);
        }
        this._syncVisualFrameMetrics();
    }

    _getHowlConfig() {
        return this.config?.attackSkills?.howl || {};
    }

    // 嚎叫技能：3s 动画 + 锁定，释放后场上全体敌方怪物获得激励 buff
    // （参照 foreman-zombie _startHowl；激励 = 移速×speedMul、物攻×atkMul）
    _startHowl(entities) {
        if (!this.active || this._deathStarted || this._isTransforming) return;
        const cfg = this._getHowlConfig();
        const duration = cfg.duration ?? 3000;
        // 终止进行中的咬/扑，避免嚎叫动画与攻击重叠
        if (this._biteState === 'attacking') this._endBite();
        if (this._pounceState !== 'idle') this._endPounce();
        this._howlTimer = duration;
        this._howlCd = cfg.cooldown ?? 30000;
        this._animState = 'howl';
        this._animFrame = 0;
        this._animTimer = 0;
        this._frozenForCast = true;
        this._howlResumeVelocity = {
            x: Number.isFinite(this.vx) ? this.vx : 0,
            y: Number.isFinite(this.vy) ? this.vy : 0,
        };
        this.vx = 0; this.vy = 0; this.isMoving = false;
        const list = Array.isArray(entities) ? entities : (entities ? Array.from(entities.values()) : []);
        for (const e of list) {
            if (!e || !e.active || e._faction !== 'enemy') continue;
            if (typeof e.applyInspire === 'function') {
                e.applyInspire(cfg.buffDuration ?? 30000, {
                    speedMul: cfg.speedMul ?? 1.33,
                    atkMul: cfg.atkMul ?? 1.5,
                });
            }
        }
        const sound = this.config?.sounds?.howl;
        if (sound && typeof window !== 'undefined' && window.SoundManager) {
            // 世界音效（2026-08-11 距离衰减）：嚎叫按敌人位置衰减
            if (window.SoundManager.playWorld) window.SoundManager.playWorld(sound, this.x, this.y);
            else window.SoundManager.playFile(sound);
        }
    }

    _timerFrame(remaining, total) {
        const n = this._getStateFrameCount();
        const progress = 1 - Math.max(0, remaining) / Math.max(1, total);
        return Math.max(0, Math.min(n - 1, Math.floor(progress * n)));
    }

    _getTransformProgress() {
        if (this._isTransformed) return 1;
        if (!this._isTransforming) return 0;
        const duration = this._transformCfg.duration ?? 2000;
        return Math.max(0, Math.min(1, 1 - this._transformTimer / Math.max(1, duration)));
    }

    _getWerewolfScale(targetScale) {
        return 1 + (Math.max(1, targetScale) - 1) * this._getTransformProgress();
    }

    _captureWerewolfCollisionBase() {
        if (this._werewolfCollisionBase) return;
        const radius = this.collisionRadius > 0 ? this.collisionRadius : (this.size || 20) * 0.6;
        const width = this.collisionWidth > 0 ? this.collisionWidth : radius * 2;
        const height = this.collisionHeight > 0 ? this.collisionHeight : radius * 2;
        const bodyHeight = this.collider?.height > 0 ? this.collider.height : height;
        this._werewolfCollisionBase = { radius, width, height, bodyHeight };
    }

    _applyWerewolfCollisionScale(scale) {
        this._captureWerewolfCollisionBase();
        const base = this._werewolfCollisionBase;
        if (!base) return;
        const safeScale = Math.max(1, scale);
        if (Math.abs(safeScale - this._appliedWerewolfCollisionScale) < 0.0001) return;
        this.collisionRadius = base.radius * safeScale;
        this.collisionWidth = base.width * safeScale;
        this.collisionHeight = base.height * safeScale;
        if (this.collider) {
            this.collider.radius = this.collisionRadius;
            this.collider.height = base.bodyHeight * safeScale;
            this.collider.syncPosition();
        }
        const body = this._phaserSprite?.body;
        if (body && typeof body.setSize === 'function') {
            body.setSize(this.collisionWidth, this.collisionHeight);
        }
        this._appliedWerewolfCollisionScale = safeScale;
    }

    _syncWerewolfCollisionScale() {
        const scale = this._getWerewolfScale(this._werewolfCollisionScaleTarget);
        this._applyWerewolfCollisionScale(scale);
    }

    _updateAnimFrame(dt) {
        if (!this._isTransformed) {
            super._updateAnimFrame(dt);
            return;
        }
        const normalDurations = this._frameDurations;
        this._frameDurations = { ...normalDurations, ...this._transformedFrameDurations };
        try {
            super._updateAnimFrame(dt);
        } finally {
            this._frameDurations = normalDurations;
        }
    }

    _applyTransform() {
        const multiplier = this._transformCfg.statMultiplier ?? 1.5;
        // 一次性强化六维与派生战斗属性；技能范围、冷却和碰撞几何不属于属性倍率。
        for (const key of ['str', 'dex', 'con', 'int', 'wis', 'luck', 'atk', 'def', 'matk', 'mdef', 'crit', 'critRes']) {
            if (typeof this.data?.[key] === 'number') {
                this.data[key] = Math.round(this.data[key] * multiplier);
            }
        }
        this.maxHp = Math.max(1, Math.round(this.maxHp * multiplier));
        this.data.maxHp = this.maxHp;
        if (this._transformCfg.healToFull !== false) this.hp = this.maxHp;
        this.data.hp = this.hp;
        for (const key of ['speed', 'maxSpeed', '_baseSpeed']) {
            if (typeof this[key] === 'number' && this[key] > 0) this[key] *= multiplier;
        }
        // 二阶段沿用同一飞扑状态机，但切换到狼人专属飞扑母版；变身完成后允许立即使用。
        this._usesPounce = true;
        this._pounceCooldown = 0;
        // 运行时面板同步显示二阶段的真实暴击率；伤害倍率在专属命中入口结算。
        this.data.crit = (this._transformCfg.criticalChance ?? 0.5) * 100;
    }

    // 变身期减伤（默认 90%，transform.damageReduction 可配）：
    // 在暴击计算前先砍掉伤害，让变身动画期间站着挨打也站得住。
    takeDamage(damage, source, damageType = 'physical', _isMelee = true, hitContext = null) {
        if (this._isTransforming) {
            const reduction = this._transformCfg?.damageReduction ?? 0.9;
            damage = Math.max(0, Math.round(damage * (1 - reduction)));
        }
        return super.takeDamage(damage, source, damageType, _isMelee, hitContext);
    }

    // 双攻击绑定：近距离撕咬和中距离飞扑分别选择独立母版 sheet。
    _startBite() {
        if (!this.active || this._deathStarted || this._isTransforming || this._howlTimer > 0) return false;
        this._attackType = 'bite';
        if (!super._startBite()) return false;
        // 出手瞬间锁定水平朝向，避免目标穿过中心线时整张攻击贴图逐帧左右翻转。
        this._biteFacing = this._facing;
        return true;
    }

    _startPounce() {
        if (!this.active || this._deathStarted || this._isTransforming || this._howlTimer > 0) return;
        this._attackType = 'pounce';
        super._startPounce();
    }

    _getPounceDamage() {
        const baseDamage = super._getPounceDamage();
        return baseDamage * (this.config?.pounceDamageMultiplier ?? 2);
    }

    _dealPhysicalHit(target, damage) {
        if (!this._isTransformed) return super._dealPhysicalHit(target, damage);
        const isCritical = Math.random() < (this._transformCfg.criticalChance ?? 0.5);
        const finalDamage = isCritical
            ? damage * (this._transformCfg.criticalDamageMultiplier ?? 2.5)
            : damage;
        // 伤害已在攻击者侧结算；该一次性标记只让统一受击入口显示同一次暴击结果。
        this._forcedHitCritical = isCritical;
        try {
            return super._dealPhysicalHit(target, finalDamage);
        } finally {
            delete this._forcedHitCritical;
        }
    }

    _startCharge() {
        super._startCharge();
        if (this._pounceState !== 'charge') return;
        const total = this._getStateFrameCount();
        const prepareFrames = this._attackTypes?.pounce?.prepareFrames ?? 4;
        this._animFrame = Math.min(total - 1, prepareFrames);
        this._animTimer = 0;
    }

    // 撕咬 1.2s（21 帧 @50ms/帧，末帧闭嘴定格），伤害判定落在扑咬爆发段
    //（约 42%~75% 时长，对应帧 10~18），最后两帧快速完成咬合。
    _updateBite(dt) {
        this._biteTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this._animState = 'attack';
        if (this._biteFacing === 'left' || this._biteFacing === 'right') {
            this._facing = this._biteFacing;
            this._lastHorizontalFacing = this._facing;
        }
        const duration = this._attackTypes?.bite?.durationMs ?? 600;
        const elapsed = duration - this._biteTimer;
        const hitStart = Math.round(duration * 0.42);
        const hitEnd = Math.round(duration * 0.75);
        if (!this._biteDamaged && elapsed >= hitStart && elapsed <= hitEnd) {
            this._tryBiteImpact();
        }
        if (this._biteTimer <= 0) {
            this._endBite();
        }
    }

    _getDeathConfig() {
        return this.config?.deathAnim || {};
    }

    onDeath(source) {
        if (this._deathStarted) return;
        const diedDuringTransform = this._isTransforming && !this._isTransformed;
        if (this._biteState === 'attacking') this._endBite();
        if (this._pounceState !== 'idle') this._endPounce();
        this._deathStarted = true;
        this._isTransforming = false;
        this._howlTimer = 0;
        this._howlResumeVelocity = null;
        this._frozenForCast = true;
        this._attackAnimTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.target = null;
        this._tacticalTarget = null;
        this._animState = 'death';
        this._animFrame = 0;
        this._animTimer = 0;
        this._visualStateKey = 'death';
        const death = this._getDeathConfig();
        const duration = death.duration ?? 2000;
        const holdMs = death.holdMs ?? 1000;
        this._deathAnimTimer = duration;
        this._corpseTimer = 0;
        this._preserveCorpse = true;
        this._deathRemoveDelay = duration + holdMs + 500;
        if (diedDuringTransform) this._applyWerewolfCollisionScale(1);
        this._syncVisualFrameMetrics();
        super.onDeath(source);
    }

    _updateDeathAnimation(dt) {
        if (!this._deathStarted) return;
        const death = this._getDeathConfig();
        const duration = death.duration ?? 2000;
        const holdMs = death.holdMs ?? 1000;
        const layout = this._isTransformed
            ? (this._frameLayouts?.werewolfDying || { cols: 5, rows: 5, frames: 21 })
            : (this._frameLayouts?.dying || { cols: 4, rows: 3, frames: 12 });
        const lastFrame = Math.min(layout.frames - 1, death.lastFrame ?? (layout.frames - 1));
        this._animState = 'death';
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer = Math.max(0, this._deathAnimTimer - dt);
            const progress = 1 - this._deathAnimTimer / Math.max(1, duration);
            this._animFrame = Math.min(lastFrame, Math.floor(progress * layout.frames));
            if (this._deathAnimTimer <= 0) {
                this._animFrame = lastFrame;
                this._corpseTimer = holdMs;
            }
        } else if (this._corpseTimer > 0) {
            this._animFrame = lastFrame;
            this._corpseTimer = Math.max(0, this._corpseTimer - dt);
            if (this._corpseTimer <= 0 && this._phaserSprite && this._phaserSprite.active) {
                this._phaserSprite.destroy();
                this._phaserSprite = null;
            }
        }
        this._syncVisualFrameMetrics();
    }

    _isAnimationFrozen() {
        return !!(this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen')));
    }

    _getTextureKey() {
        if (this._deathStarted) return this._isTransformed
            ? 'enemy_red_wolf_king_werewolf_dying'
            : 'enemy_red_wolf_king_dying';
        if (this._isTransforming) return 'enemy_red_wolf_king_transform';
        if (this._isTransformed) {
            if (this._isAnimationFrozen() || this._animState === 'idle') {
                return 'enemy_red_wolf_king_werewolf_idle';
            }
            if (this._howlTimer > 0 || this._animState === 'howl') {
                return 'enemy_red_wolf_king_werewolf_howl';
            }
            if (this._animState === 'attack') {
                return this._attackType === 'pounce'
                    ? 'enemy_red_wolf_king_werewolf_pounce'
                    : 'enemy_red_wolf_king_werewolf_attack';
            }
            return 'enemy_red_wolf_king_werewolf_run';
        }
        if (this._isAnimationFrozen()) return 'enemy_red_wolf_king_idle';
        if (this._howlTimer > 0 || this._animState === 'howl') {
            return 'enemy_red_wolf_king_howl';
        }
        if (this._animState === 'attack') {
            return this._attackType === 'pounce'
                ? 'enemy_red_wolf_king_pounce'
                : 'enemy_red_wolf_king_attack';
        }
        if (this._animState === 'idle') return 'enemy_red_wolf_king_idle';
        return 'enemy_red_wolf_king_run';
    }

    _getFrameLayout(state) {
        const layouts = this._frameLayouts || {};
        if (this._deathStarted || state === 'death') return this._isTransformed
            ? (layouts.werewolfDying || { cols: 5, rows: 5, frames: 21, frameWidth: 640, frameHeight: 640, footY: 590 })
            : (layouts.dying || { cols: 4, rows: 3, frames: 12 });
        if (this._isTransforming || state === 'transform') {
            return layouts.transform || { cols: 5, rows: 5, frames: 21, frameWidth: 640, frameHeight: 640, footY: 590 };
        }
        if (this._isTransformed) {
            if (this._isAnimationFrozen() || state === 'idle' || this._animState === 'idle') {
                return layouts.werewolfIdle || { cols: 10, rows: 2, frames: 20, frameWidth: 640, frameHeight: 640, footY: 590 };
            }
            if (this._howlTimer > 0 || state === 'howl' || this._animState === 'howl') {
                return layouts.werewolfHowl || { cols: 5, rows: 5, frames: 21, frameWidth: 640, frameHeight: 640, footY: 590 };
            }
            if (this._animState === 'attack') {
                return this._attackType === 'pounce'
                    ? (layouts.werewolfPounce || { cols: 5, rows: 6, frames: 27, frameWidth: 640, frameHeight: 640, footY: 590 })
                    : (layouts.werewolfAttack || { cols: 5, rows: 5, frames: 21, frameWidth: 640, frameHeight: 640, footY: 590 });
            }
            return layouts.werewolfRun || { cols: 10, rows: 2, frames: 20, frameWidth: 640, frameHeight: 640, footY: 590 };
        }
        if (this._isAnimationFrozen()) return layouts.idle || { cols: 4, rows: 3, frames: 12 };
        if (this._howlTimer > 0 || this._animState === 'howl') {
            return layouts.howl || { cols: 4, rows: 3, frames: 12 };
        }
        if (this._animState === 'attack') {
            return layouts[this._attackType] || layouts.attack || { cols: 4, rows: 3, frames: 12 };
        }
        const key = state === 'walk' || state === 'pacing' ? state : this._animState;
        return layouts[key] || layouts.run || { cols: 4, rows: 4, frames: 16 };
    }

    _getStateFrameCount() {
        const layout = this._getFrameLayout(this._animState);
        return layout.frames || (layout.cols * layout.rows);
    }

    _getVisualStateKey() {
        if (this._deathStarted) return 'death';
        if (this._isTransforming) return 'transform';
        if (this._isTransformed) {
            if (this._isAnimationFrozen()) return 'werewolf:idle';
            if (this._howlTimer > 0 || this._animState === 'howl') return 'werewolf:howl';
            if (this._animState === 'attack') return `werewolf:attack:${this._attackType}`;
            if (this._animState === 'idle') return 'werewolf:idle';
            return 'werewolf:locomotion';
        }
        if (this._isAnimationFrozen()) return 'idle';
        if (this._howlTimer > 0 || this._animState === 'howl') return 'howl';
        if (this._animState === 'attack') return `attack:${this._attackType}`;
        if (this._animState === 'idle') return 'idle';
        return 'locomotion';
    }

    _syncVisualState() {
        const next = this._getVisualStateKey();
        if (next === this._visualStateKey) return;
        this._visualStateKey = next;
        this._animFrame = 0;
        this._animTimer = 0;
    }

    _syncVisualFrameMetrics() {
        const layout = this._getFrameLayout(this._animState);
        const render = this._animCfg?.render || {};
        const referenceCell = render.referenceCell ?? 512;
        const frameW = layout.frameWidth ?? referenceCell;
        const frameH = layout.frameHeight ?? referenceCell;
        const formScale = this._getWerewolfScale(this._werewolfVisualScaleTarget);
        const spriteSize = (render.spriteSize ?? 151) * Math.max(frameW, frameH) / referenceCell
            * (layout.contentScale ?? 1) * formScale;
        const footY = layout.footY ?? frameH;
        this._currentSpriteDisplaySize = spriteSize;
        this.footOffsetY = (footY / frameH - 0.5) * spriteSize;
    }

    _getPhaserOptions() {
        this._syncVisualFrameMetrics();
        const opts = super._getPhaserOptions();
        opts.spriteSize = this._currentSpriteDisplaySize;
        opts.dynamicSpriteSize = this._isTransforming;
        // 死亡后状态效果不再更新；若死前处于眩晕/冻结，不能让遗留状态把 dying 永久钉在第 0 帧。
        // 该规则只适用于未变身狼形；狼人冻结改走独立 werewolf idle，不得闪回四足狼。
        const freezeWolfFrame = !this._deathStarted && !this._isTransforming && !this._isTransformed
            && this._isAnimationFrozen();
        opts.frame = freezeWolfFrame ? 0 : this._animFrame;
        return opts;
    }

    // 新视频已经包含完整身体运动，不再叠加旧程序化弹跳/拉伸。
    _getBodyAnimationParams() {
        return { bounceY: 0, scaleX: 1, scaleY: 1, leanAngle: 0, swayX: 0 };
    }

    _drawBody(ctx) {
        if (this._isTransformed) {
            let werewolf = this._werewolfSprites.run;
            if (this._deathStarted) werewolf = this._werewolfSprites.dying;
            else if (this._isAnimationFrozen() || this._animState === 'idle') werewolf = this._werewolfSprites.idle;
            else if (this._howlTimer > 0 || this._animState === 'howl') werewolf = this._werewolfSprites.howl;
            else if (this._animState === 'attack') werewolf = this._attackType === 'pounce'
                ? this._werewolfSprites.pounce
                : this._werewolfSprites.attack;
            const layout = this._getFrameLayout(this._animState);
            const shouldFlip = this._facing === 'left' ||
                ((this._facing === 'up' || this._facing === 'down') && (
                    (Math.abs(this.vx) > 0.1 && this.vx < 0) ||
                    (Math.abs(this.vx) <= 0.1 && this._lastHorizontalFacing === 'left')
                ));
            ctx.save();
            if (shouldFlip) ctx.scale(-1, 1);
            this._drawSheetFrame(ctx, werewolf, layout);
            ctx.restore();
            return;
        }
        let sprite = this._wolfSprites.run;
        if (this._deathStarted) sprite = this._wolfSprites.dying;
        else if (this._isTransforming || this._isTransformed) sprite = this._wolfSprites.transform;
        else if (this._isAnimationFrozen() || this._animState === 'idle') sprite = this._wolfSprites.idle;
        else if (this._howlTimer > 0 || this._animState === 'howl') sprite = this._wolfSprites.howl;
        else if (this._animState === 'attack') sprite = this._attackType === 'pounce'
            ? this._wolfSprites.pounce
            : this._wolfSprites.bite;
        else if (this._animState === 'pacing') sprite = this._wolfSprites.pacing;
        else if (this._animState === 'walk') sprite = this._wolfSprites.walk;

        const layout = this._getFrameLayout(this._animState);
        const shouldFlip = this._facing === 'left' ||
            ((this._facing === 'up' || this._facing === 'down') && (
                (Math.abs(this.vx) > 0.1 && this.vx < 0) ||
                (Math.abs(this.vx) <= 0.1 && this._lastHorizontalFacing === 'left')
            ));
        ctx.save();
        if (shouldFlip) ctx.scale(-1, 1);
        this._drawSheetFrame(ctx, sprite, layout);
        ctx.restore();
    }

    _drawSheetFrame(ctx, img, layout) {
        if (!img || !img.complete || !img.naturalWidth) return;
        const lay = layout || { cols: 4, rows: 3 };
        const frameW = img.naturalWidth / lay.cols;
        const frameH = img.naturalHeight / lay.rows;
        const frameCount = lay.frames || lay.cols * lay.rows;
        const frame = Math.max(0, Math.min(frameCount - 1, this._animFrame));
        const col = frame % lay.cols;
        const row = Math.floor(frame / lay.cols);
        const render = this._animCfg?.render || {};
        const referenceCell = render.referenceCell ?? 512;
        const formScale = this._getWerewolfScale(this._werewolfVisualScaleTarget);
        const spriteSize = (render.spriteSize ?? 151) * Math.max(frameW, frameH) / referenceCell
            * (lay.contentScale ?? 1) * formScale;
        const footY = lay.footY ?? frameH;
        const drawX = -spriteSize * 0.5;
        const drawY = -spriteSize * footY / frameH;
        ctx.drawImage(img, col * frameW, row * frameH, frameW, frameH, drawX, drawY, spriteSize, spriteSize);
    }
}

function hexToNumber(hex) {
    if (typeof hex === 'number') return hex;
    hex = hex.replace('#', '');
    return parseInt(hex, 16);
}

class CircleEnemy extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usesDirectedBasicMelee = true;
        this._circleColor = config.color || this._color || '#8a8a4a';
    }

    _getTextureKey() {
        return 'enemy_circle';
    }

    _getPhaserOptions() {
        return {
            spriteSize: (this.size || 14) * 4,
            textOffsetY: -(this.size || 14) - 10,
            tint: hexToNumber(this._circleColor)
        };
    }

    _drawBody(ctx) {
        ctx.save();
        ctx.fillStyle = this._circleColor;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class ZombieDogEnemy extends CircleEnemy {
    constructor(x, y, config = {}) {
        // 与其他怪类同口径：无配置构造时合并僵尸犬自身配置，杜绝名字/属性兜底
        // （此前 `new ZombieDogEnemy(x, y)` 会落到 Enemy 的「测试敌人」兜底名 +
        // 默认属性，世界-122 防守「测试怪物」残留根因，2026-08-15）
        // 犬科不显示武器：showWeapon 默认 false（调用方可显式覆盖），2026-08-15 补充
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.zombieDog,
            ...config
        });
        this._animState = 'idle';
        this._animStateTimer = 0;
        this._lastHorizontalFacing = 'right';
        this._attackDuration = this._getFrameLayout('attack').duration ?? 700;
        this._loopingSoundState = null;
        this._loopingSoundTimer = 0;

        // 死亡动画播放完成后保留尸体 1 秒，再交给通用清理链销毁。
        this._preserveCorpse = true;
        this._deathStarted = false;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathAnimation(dt);
            return;
        }
        super.update(dt, entities);
        // 石化需冻结当前动作帧，不能像眩晕/冻结那样把动画计时继续推进。
        if (this.hasStatusEffect?.('petrified')) return;
        // 递减攻击动画计时器；计时器归零后不再显示 attack 动画
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._attackTimer < 0) this._attackTimer = 0;
        }
        if (this._attackAnimTimer > 0) {
            this._attackAnimTimer -= dt;
            if (this._attackAnimTimer < 0) this._attackAnimTimer = 0;
        }
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (this._attackTimer <= 0 && Math.abs(this.vx) >= 0.1) {
            this._lastHorizontalFacing = this.vx > 0 ? 'right' : 'left';
        }

        // [FIX] 动画状态优先级：攻击动画 > 奔跑追击 > 近距离调整位置 > 待机
        // 使用相对于 maxSpeed 的阈值，并加入滞后（hysteresis）与最小保持时间，
        // 避免在攻击范围边缘因摩擦导致 run/walk/idle 高频切换，使奔跑贴图看起来“卡住”。
        let nextState = this._animState;
        if (this._attackTimer > 0) {
            nextState = 'attack';
        } else {
            const maxSpd = this.maxSpeed || this.speed || 250;
            const runThreshold = maxSpd * 0.30;
            const walkThreshold = maxSpd * 0.05;
            // 滞后：从 run 降到 walk 需要速度低于 runThreshold 一定比例
            const runToWalkThreshold = runThreshold * 0.65;
            const walkToRunThreshold = runThreshold * 1.05;

            if (this._animState === 'run') {
                if (speed < runToWalkThreshold) nextState = speed < walkThreshold ? 'idle' : 'walk';
            } else if (this._animState === 'walk') {
                if (speed > walkToRunThreshold) nextState = 'run';
                else if (speed < walkThreshold * 0.6) nextState = 'idle';
            } else {
                // idle -> run/walk
                if (speed > walkToRunThreshold) nextState = 'run';
                else if (speed > walkThreshold) nextState = 'walk';
                else nextState = 'idle';
            }
        }

        // 状态变化时重置保持计时器；未变化时累计时间
        this._animStateTimer = (this._animStateTimer || 0) + dt;
        const minHoldTime = 80; // ms，防止每帧在阈值边缘抖动
        if (nextState !== this._animState) {
            if (this._animStateTimer >= minHoldTime) {
                this._animState = nextState;
                this._animStateTimer = 0;
            }
        }
        this._syncConfiguredLoopSound(dt);
    }

    _syncConfiguredLoopSound(dt) {
        const state = this._animState === 'run' ? 'walk' : this._animState;
        if (state !== 'idle' && state !== 'walk') {
            this._loopingSoundState = null;
            this._loopingSoundTimer = 0;
            return;
        }
        const sounds = this.config?.sounds || {};
        if (!sounds[state]) return;
        const layout = this._getFrameLayout(state);
        const frameDuration = Number(layout?.frameRate) > 0
            ? 1000 * Math.max(1, Number(layout?.frameCount) || 1) / Number(layout.frameRate)
            : 0;
        const interval = Math.max(
            250,
            Number(sounds[`${state}Interval`]) || Number(layout?.duration) || frameDuration || 2000
        );
        if (this._loopingSoundState !== state) {
            this._loopingSoundState = state;
            this._loopingSoundTimer = state === 'idle'
                ? Math.random() * Math.min(interval, 750)
                : 0;
        } else {
            this._loopingSoundTimer = Math.max(0, this._loopingSoundTimer - Math.max(0, Number(dt) || 0));
        }
        if (this._loopingSoundTimer > 0) return;
        playSoundFrom(this, state);
        this._loopingSoundTimer = interval;
    }

    /**
     * 僵尸犬攻击动画触发入口。
     * 只在 CombatSystem 真正触发攻击后调用；若当前仍处于上一段 attack 动画中，
     * 则忽略重复触发，避免扑咬母版中途重播。
     */
    triggerWeaponAnim() {
        if (this._attackTimer > 0) return;
        if (this.target?.active) {
            this._lastHorizontalFacing = this.target.x < this.x ? 'left' : 'right';
        }
        super.triggerWeaponAnim();
        this._attackTimer = this._attackDuration || 700;
        this._attackAnimTimer = this._attackTimer;
        this._animFrame = 0;
        this._animTimer = 0;
        playSoundFrom(this, 'attack');
    }

    _getFrameLayout(state = this._animState) {
        const layouts = this.config?.textures?.frameLayouts || {};
        return layouts[state] || layouts.idle || {
            frameWidth: 512,
            frameHeight: 512,
            frameCount: 1,
            footY: 410,
        };
    }

    _getDeathConfig() {
        return this.config?.deathAnim || {};
    }

    _updateDeathAnimation(dt) {
        if (!this._deathStarted) return;
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer = Math.max(0, this._deathAnimTimer - dt);
            if (this._deathAnimTimer <= 0) {
                this._corpseTimer = this._getDeathConfig().holdMs ?? 1000;
            }
        } else if (this._corpseTimer > 0) {
            this._corpseTimer = Math.max(0, this._corpseTimer - dt);
            if (this._corpseTimer <= 0 && this._phaserSprite?.active) {
                this._phaserSprite.destroy();
                this._phaserSprite = null;
            }
        }
    }

    onDeath(source) {
        if (this._deathStarted) return;
        playSoundFrom(this, 'death');
        this._deathStarted = true;
        this._attackTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.target = null;
        this._tacticalTarget = null;
        this._animState = 'death';
        this._animStateTimer = 0;
        const death = this._getDeathConfig();
        const duration = death.duration ?? 1800;
        const holdMs = death.holdMs ?? 1000;
        this._deathAnimTimer = duration;
        this._corpseTimer = 0;
        this._deathRemoveDelay = duration + holdMs + 500;
        super.onDeath(source);
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'death':  return 'enemy_zombie_dog_death';
            case 'attack': return 'enemy_zombie_dog_attack';
            case 'run':    return 'enemy_zombie_dog_run';
            case 'walk':   return 'enemy_zombie_dog_walk';
            default:       return 'enemy_zombie_dog_idle';
        }
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        const layout = this._getFrameLayout();
        const referenceCell = this.config?.textures?.referenceCell ?? 512;
        const frameWidth = layout.frameWidth ?? referenceCell;
        const frameHeight = layout.frameHeight ?? referenceCell;
        const baseSpriteSize = renderCfg.spriteSize || 151;
        const pixelScale = baseSpriteSize / referenceCell;
        const spriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
        const footY = layout.footY ?? frameHeight;
        this.footOffsetY = (footY - frameHeight / 2) * pixelScale;
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 80,
            collisionHeight: renderCfg.collisionHeight || 79,
            textOffsetY: -baseSpriteSize / 2 - 10,
            flipX: this._lastHorizontalFacing === 'left',
            animState: this._animState,
            // 新母版已经统一脚底锚点；v2 动画键不套用旧素材的逐帧偏移表。
            animKey: `enemy_zombie_dog_${this._animState}_v2`,
        };
    }
}

/**
 * 僵尸犬唯一创建工厂（2026-08-15 统一）：此前配置拼接分散在 4 处——
 * enemy-types 类自身 / zombie-dungeon.js createZombieDog / game.js spawnMainZombieDog /
 * 巫师·集合体召唤钩子。类构造器负责合并 enemyConfigData.zombieDog 与 showWeapon 默认，
 * 本工厂只叠加场景差异（ai 深合并：配置 ai 与调用方覆盖合并，而非整体替换）。
 * @param {number} x @param {number} y
 * @param {object} [overrides] - 场景差异项（hp/name/ai 等；ai 与配置深合并）
 */
function createZombieDog(x, y, overrides = {}) {
    const cfgAi = (enemyConfigData.zombieDog && enemyConfigData.zombieDog.ai) || {};
    return new ZombieDogEnemy(x, y, {
        ...overrides,
        ai: { ...cfgAi, ...(overrides.ai || {}) },
    });
}

/**
 * 普通棕熊复用已验证的四足普通近战/死亡保尸时序，但拥有独立配置和动画键。
 * 棕熊只有 walking 素材；逻辑进入 run 状态时仍播放同一套纯步态动画。
 */
class BrownBearEnemy extends ZombieDogEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.brownBear,
            ...config,
        });
    }

    _getBrownBearVisualState(state = this._animState) {
        return state === 'run' ? 'walk' : state;
    }

    _getFrameLayout(state = this._animState) {
        return super._getFrameLayout(this._getBrownBearVisualState(state));
    }

    _getTextureKey() {
        return `enemy_brown_bear_${this._getBrownBearVisualState()}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        const visualState = this._getBrownBearVisualState();
        options.animState = visualState;
        options.animKey = `enemy_brown_bear_${visualState}_v1`;
        return options;
    }
}

function createBrownBear(x, y, overrides = {}) {
    const base = enemyConfigData.brownBear || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new BrownBearEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

/**
 * 普通邪恶树精：复用四动作普通近战和死亡保尸时序。逻辑 run 与 walk
 * 共用同一套沉重步行动画，死亡终帧保留碎裂后的木材堆。
 */
class EvilTreantEnemy extends ZombieDogEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.evilTreant,
            ...config,
        });
    }

    _getEvilTreantVisualState(state = this._animState) {
        return state === 'run' ? 'walk' : state;
    }

    _getFrameLayout(state = this._animState) {
        return super._getFrameLayout(this._getEvilTreantVisualState(state));
    }

    _getTextureKey() {
        return `enemy_evil_treant_${this._getEvilTreantVisualState()}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        const visualState = this._getEvilTreantVisualState();
        options.animState = visualState;
        options.animKey = `enemy_evil_treant_${visualState}_v1`;
        return options;
    }
}

function createEvilTreant(x, y, overrides = {}) {
    const base = enemyConfigData.evilTreant || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new EvilTreantEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

/**
 * 紫蚀古树首领：固定树桩型区域控制者。
 *
 * - 近距：锁向的地面扇形巨臂横扫；
 * - 远距：投石 1 秒落地，红圈与 GroundEllipse 同源，命中眩晕；
 * - 控制：施法后地面红圈预警，物理伤害 + 3 秒束缚；至少命中一个目标后排队衔接投石。
 *
 * 不存在移动视觉态，逻辑位移也强制锁回出生根点。
 */
class PurpleBlightAncientEnemy extends ZombieDogEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.purpleBlightAncient,
            ...config,
        });
        this._rootX = x;
        this._rootY = y;
        this.speed = 0;
        this.maxSpeed = 0;
        this._baseSpeed = 0;
        this.immovable = true;

        this._bossAction = null;
        this._bossActionTimer = 0;
        this._bossActionDuration = 0;
        this._bossActionReleased = false;
        this._bossActionTarget = null;
        this._bossActionPoint = null;
        this._meleeCooldown = 0;
        this._rockCooldown = Math.max(0, Number(this.config?.attackSkills?.rockThrow?.initialCooldownMs) || 0);
        this._vineCooldown = Math.max(0, Number(this.config?.attackSkills?.vineEntangle?.initialCooldownMs) || 0);
        this._pendingVineWarnings = [];
        this._rockProjectiles = [];
        this._queuedComboThrow = null;
        this._impactGraphics = [];

        // 三种动作全部由本类管理；关闭 ZombieDog 的通用单体突刺，避免同帧重复攻击。
        const melee = this.attacks?.melee;
        if (melee) melee.canUse = () => false;
    }

    _getPurpleAncientVisualState(state = this._animState) {
        if (state === 'death') return 'death';
        if (this._bossAction === 'vine') return 'spellcast';
        if (this._bossAction === 'rock') return 'throw';
        if (this._bossAction === 'melee') return 'attack';
        return 'idle';
    }

    _getFrameLayout(state = this._animState) {
        return super._getFrameLayout(this._getPurpleAncientVisualState(state));
    }

    _getTextureKey() {
        return `enemy_purple_blight_ancient_${this._getPurpleAncientVisualState()}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        const visualState = this._getPurpleAncientVisualState();
        options.animState = visualState;
        options.animKey = `enemy_purple_blight_ancient_${visualState}_v1`;
        options.dynamicSpriteSize = true;
        return options;
    }

    update(dt, entities) {
        if (!this.active) {
            super.update(dt, entities);
            return;
        }

        const attackDt = this.getAttackIntervalDelta(dt);
        this._meleeCooldown = Math.max(0, this._meleeCooldown - attackDt);
        this._rockCooldown = Math.max(0, this._rockCooldown - attackDt);
        this._vineCooldown = Math.max(0, this._vineCooldown - attackDt);
        this._updateQueuedCombo(dt);
        this._updateVineWarnings(dt, entities);
        this._updateRockWarnings();

        const controlled = this.hasStatusEffect?.('stun')
            || this.hasStatusEffect?.('frozen')
            || this.hasStatusEffect?.('fear')
            || this.hasStatusEffect?.('petrified');
        if (controlled && this._bossAction) this._cancelBossAction();
        if (this._bossAction) this._updateBossAction(dt, entities);

        super.update(dt, entities);
        this._lockToRoots();

        if (!this.active || this._isDead || controlled) return;
        if (!this._bossAction) this._chooseBossAction(this.target);
        this._animState = this._getPurpleAncientVisualState();
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
    }

    _lockToRoots() {
        this.x = this._rootX;
        this.y = this._rootY;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this.collider) {
            this.collider.x = this._rootX;
            this.collider.y = this._rootY;
            this.collider.syncPosition?.();
        }
    }

    _isValidHostile(target, allowStructure = true) {
        if (!target || target === this || !target.active || target._isDead
            || target.hittable === false || !(target.hp > 0)) return false;
        if (!allowStructure && target._isDefenseStructure) return false;
        return !isFriendlyFire(this, target)
            && !(this._faction === 'enemy' && target._faction === 'enemy');
    }

    _hostiles(entities) {
        const source = entities?.values
            ? entities.values()
            : (Array.isArray(entities) ? entities : []);
        const values = new Set(source);
        for (const member of PartySystem.members || []) values.add(member);
        for (const friendly of (typeof window !== 'undefined' && window.Game?.friendlyUnits) || []) {
            values.add(friendly);
        }
        return [...values].filter(target => this._isValidHostile(target));
    }

    _chooseBossAction(target) {
        if (this._queuedComboThrow) {
            const comboTarget = this._queuedComboThrow.target;
            if (!this._isValidHostile(comboTarget)) {
                this._queuedComboThrow = null;
            } else {
                if (this._queuedComboThrow.delayMs <= 0) {
                    this._queuedComboThrow = null;
                    this._startRockThrow(comboTarget, true);
                }
                // 藤蔓命中后的 450ms 衔接窗口内禁止普通横扫/投石抢占动作。
                return;
            }
        }
        // 藤蔓红圈尚未结算时保持待机；落空后本帧即可恢复普通攻击选择。
        if (this._pendingVineWarnings.length > 0) {
            return;
        }
        if (!this._isValidHostile(target)) return;
        const distance = distanceToEntityShape(target, this.x, this.y);
        const meleeCfg = this.config?.attackSkills?.armSweep || {};
        const vineCfg = this.config?.attackSkills?.vineEntangle || {};
        const rockCfg = this.config?.attackSkills?.rockThrow || {};

        if (this._vineCooldown <= 0
            && distance <= (Number(vineCfg.castRange) || 800)
            && hasRangedLineOfSight(this, target)) {
            this._startVineCast(target);
            return;
        }
        if (this._meleeCooldown <= 0 && distance <= (Number(meleeCfg.triggerRange) || 300)) {
            this._startMeleeSweep(target);
            return;
        }
        if (this._rockCooldown <= 0
            && distance <= (Number(rockCfg.triggerRange) || 900)
            && hasRangedLineOfSight(this, target)) {
            this._startRockThrow(target, false);
        }
    }

    _startAction(kind, target, duration) {
        this._bossAction = kind;
        this._bossActionTimer = duration;
        this._bossActionDuration = duration;
        this._bossActionReleased = false;
        this._bossActionTarget = target;
        this._bossActionPoint = target
            ? { x: target.collider?.x ?? target.x, y: target.collider?.y ?? target.y }
            : null;
        this._frozenForCast = true;
        this._attackTimer = duration;
        this._attackAnimTimer = duration;
        this._animState = this._getPurpleAncientVisualState();
        this._animStateTimer = 0;
        this._animFrame = 0;
        this._animTimer = 0;
        if (target) {
            this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
            this._lastHorizontalFacing = target.x < this.x ? 'left' : 'right';
        }
        this._lockToRoots();
        playSoundFrom(this, kind);
    }

    _startMeleeSweep(target) {
        const cfg = this.config?.attackSkills?.armSweep || {};
        const duration = Math.max(100, Number(cfg.durationMs) || 1500);
        this._meleeCooldown = Math.max(0, Number(cfg.cooldown) || 2400);
        this._startAction('melee', target, duration);
    }

    _startRockThrow(target, combo) {
        const cfg = this.config?.attackSkills?.rockThrow || {};
        const duration = Math.max(100, Number(cfg.durationMs) || 1500);
        this._rockCooldown = Math.max(0, Number(cfg.cooldown) || 8000);
        this._startAction('rock', target, duration);
        this._bossActionCombo = combo === true;
    }

    _startVineCast(target) {
        const cfg = this.config?.attackSkills?.vineEntangle || {};
        const duration = Math.max(100, Number(cfg.durationMs) || 1700);
        this._vineCooldown = Math.max(0, Number(cfg.cooldown) || 14000);
        this._startAction('vine', target, duration);
    }

    _updateBossAction(dt, entities) {
        const kind = this._bossAction;
        const cfg = kind === 'melee'
            ? this.config?.attackSkills?.armSweep || {}
            : kind === 'rock'
                ? this.config?.attackSkills?.rockThrow || {}
                : this.config?.attackSkills?.vineEntangle || {};
        this._bossActionTimer = Math.max(0, this._bossActionTimer - Math.max(0, Number(dt) || 0));
        const elapsed = this._bossActionDuration - this._bossActionTimer;
        const visualLayout = this._getFrameLayout(this._getPurpleAncientVisualState());
        const frameCount = Math.max(1, Math.floor(Number(visualLayout?.frameCount) || 1));
        const configuredReleaseFrame = Number(cfg.releaseFrame);
        const releaseAtMs = Number.isFinite(configuredReleaseFrame)
            ? this._bossActionDuration * Math.max(
                0,
                Math.min(frameCount - 1, Math.floor(configuredReleaseFrame))
            ) / frameCount
            : this._bossActionDuration * Math.max(
                0,
                Math.min(1, Number(cfg.releaseRatio) || 0.5)
            );
        if (!this._bossActionReleased && elapsed >= releaseAtMs) {
            this._bossActionReleased = true;
            if (kind === 'melee') this._resolveMeleeSweep(entities);
            else if (kind === 'rock') this._releaseRockThrow();
            else this._releaseVineWarning();
        }
        this._frozenForCast = true;
        this._animState = this._getPurpleAncientVisualState();
        this._lockToRoots();
        if (this._bossActionTimer <= 0) this._cancelBossAction();
    }

    _resolveMeleeSweep(entities) {
        const cfg = this.config?.attackSkills?.armSweep || {};
        const range = Math.max(1, Number(cfg.range) || 280);
        const arc = Math.max(1, Number(cfg.arcDegrees) || 150) * Math.PI / 180;
        const originX = this.collider?.x ?? this.x;
        const originY = this.collider?.y ?? this.y;
        const shape = new GroundSector(
            originX,
            originY,
            this.rotation || 0,
            range,
            arc,
            surfaceEffectFromEntity(this)
        );
        const damage = Math.max(1, Math.round((this.data?.atk || 1) * (Number(cfg.damageMultiplier) || 1)));
        for (const target of this._hostiles(entities)) {
            if (!shape.intersectsEntity(target)) continue;
            const tx = target.collider?.x ?? target.x;
            const ty = target.collider?.y ?? target.y;
            const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
            if (WallSystem?.blocked?.(originX, originY, tx, ty, ignore)) continue;
            DamagePipeline.applyHit(this, target, {
                damage,
                damageType: cfg.damageType || 'physical',
                knockback: Number(cfg.knockback) || 36,
                angle: Math.atan2(ty - originY, tx - originX),
                isMelee: true,
                confirmedHitContext: { skillId: 'purpleAncientArmSweep' },
            });
        }
    }

    _releaseRockThrow() {
        const cfg = this.config?.attackSkills?.rockThrow || {};
        const point = this._bossActionPoint;
        if (!point) return;
        const flightMs = Math.max(1, Number(cfg.flightMs) || 1000);
        const radius = Math.max(1, Number(cfg.impactRadius) || 170);
        const warning = createGroundWarning(point.x, point.y, radius);
        const throwLayout = this._getFrameLayout('throw');
        const referenceCell = Number(this.config?.textures?.referenceCell) || 512;
        const frameWidth = Number(throwLayout?.frameWidth) || referenceCell;
        const footY = Number(throwLayout?.footY) || (Number(throwLayout?.frameHeight) || referenceCell);
        const pixelScale = (Number(this.config?.render?.spriteSize) || 151) / referenceCell;
        const sourceX = Number(cfg.releasePointX);
        const sourceY = Number(cfg.releasePointY);
        const sourceOffsetX = Number.isFinite(sourceX)
            ? (sourceX - frameWidth / 2) * pixelScale
            : -(Number(cfg.muzzleForward) || 75);
        const sourceOffsetY = Number.isFinite(sourceY)
            ? (sourceY - footY) * pixelScale
            : -(Number(cfg.muzzleUpY) || 205);
        // 投石母版朝右时岩石由画面左手脱离；朝左播放会水平镜像。
        // 直接从母版坐标换算，保证投射物首帧中心与手中岩石中心重合。
        const mirroredOffsetX = this._lastHorizontalFacing === 'left'
            ? -sourceOffsetX
            : sourceOffsetX;
        const sx = this.x + mirroredOffsetX;
        const sy = this.y + sourceOffsetY;
        const projectileEntry = { projectile: null, warning };
        const projectile = launchArcProjectile({
            textureKey: cfg.projectileTexture || 'enemy_ore_spider_projectile',
            size: Math.max(20, Number(cfg.projectileSize) || 72),
            sx,
            sy,
            tx: point.x,
            ty: point.y,
            arcHeight: Math.max(0, Number(cfg.arcHeight) || 150),
            duration: flightMs,
            spin: Number(cfg.spin) || Math.PI * 1.5,
            depth: this.y + 30,
            onImpact: (x, y) => {
                destroyWarning(warning);
                this._rockProjectiles = this._rockProjectiles.filter(entry => entry !== projectileEntry);
                if (this.active && !this._isDead) this._resolveRockImpact(x, y);
            },
        });
        projectileEntry.projectile = projectile;
        if (projectile) this._rockProjectiles.push(projectileEntry);
    }

    _resolveRockImpact(x, y) {
        const cfg = this.config?.attackSkills?.rockThrow || {};
        const radius = Math.max(1, Number(cfg.impactRadius) || 170);
        const shape = new GroundEllipse(
            x,
            y,
            radius,
            radius * PERSPECTIVE_SCALE_Y,
            surfaceEffectFromEntity(this)
        );
        const damage = Math.max(1, Math.round((this.data?.atk || 1) * (Number(cfg.damageMultiplier) || 1.35)));
        const impact = fireGroundShockwave({
            x,
            y,
            maxRadius: radius,
            strokeColor: 0x8a7354,
            fillColor: 0x6a5138,
            duration: 460,
            flicker: false,
        });
        if (impact) this._impactGraphics.push(impact);
        const entities = typeof window !== 'undefined' ? window.Game?.entities : null;
        for (const target of this._hostiles(entities)) {
            if (!shape.intersectsEntity(target)) continue;
            const result = DamagePipeline.applyHit(this, target, {
                damage,
                damageType: cfg.damageType || 'physical',
                isMelee: false,
                confirmedHitContext: { skillId: 'purpleAncientRockThrow' },
            });
            const parried = target.shieldSystem && target.shieldSystem._lastParried;
            if (result.hit && !parried && target.active && !target._isDead && target.hp > 0) {
                target.applyStun?.(Math.max(0, Number(cfg.stunMs) || 1500));
            }
        }
    }

    _updateRockWarnings() {
        for (const entry of this._rockProjectiles) {
            if (!keepWarningAlive(entry.warning)) entry.warning = null;
        }
    }

    _releaseVineWarning() {
        const cfg = this.config?.attackSkills?.vineEntangle || {};
        const point = this._bossActionPoint;
        if (!point) return;
        const radius = Math.max(1, Number(cfg.radius) || 220);
        this._pendingVineWarnings.push({
            x: point.x,
            y: point.y,
            timer: Math.max(1, Number(cfg.warningMs) || 1200),
            warning: createGroundWarning(point.x, point.y, radius),
            preferredTarget: this._bossActionTarget,
            surfaceContext: surfaceEffectFromEntity(this),
        });
    }

    _updateVineWarnings(dt, entities) {
        const step = Math.max(0, Number(dt) || 0);
        for (let i = this._pendingVineWarnings.length - 1; i >= 0; i--) {
            const pending = this._pendingVineWarnings[i];
            pending.timer -= step;
            if (!keepWarningAlive(pending.warning)) pending.warning = null;
            if (pending.timer > 0) continue;
            pending.warning = destroyWarning(pending.warning);
            this._pendingVineWarnings.splice(i, 1);
            if (this.active && !this._isDead) this._resolveVineEntangle(pending, entities);
        }
    }

    _resolveVineEntangle(pending, entities) {
        const cfg = this.config?.attackSkills?.vineEntangle || {};
        const radius = Math.max(1, Number(cfg.radius) || 220);
        const shape = new GroundEllipse(
            pending.x,
            pending.y,
            radius,
            radius * PERSPECTIVE_SCALE_Y,
            pending.surfaceContext
        );
        const damage = Math.max(1, Math.round((this.data?.atk || 1) * (Number(cfg.damageMultiplier) || 0.85)));
        const boundTargets = [];
        for (const target of this._hostiles(entities)) {
            if (!shape.intersectsEntity(target)) continue;
            const result = DamagePipeline.applyHit(this, target, {
                damage,
                damageType: cfg.damageType || 'physical',
                isMelee: false,
                confirmedHitContext: { skillId: 'purpleAncientVineEntangle' },
            });
            const parried = target.shieldSystem && target.shieldSystem._lastParried;
            if (!result.hit || parried || !target.active || target._isDead || !(target.hp > 0)
                || target.hasStatusEffect?.('statusImmune')) continue;
            target.applyBind?.(Math.max(0, Number(cfg.bindMs) || 3000));
            EffectManager.add(new VineEntangleEffect(target, {
                durationMs: Math.max(0, Number(cfg.bindMs) || 3000),
                displaySize: Number(cfg.effectDisplaySize) || 220,
            }));
            boundTargets.push(target);
        }
        if (!boundTargets.length) return;
        const comboTarget = boundTargets.includes(pending.preferredTarget)
            ? pending.preferredTarget
            : boundTargets.reduce((best, target) => {
                if (!best) return target;
                const targetDist = Math.hypot(target.x - pending.x, target.y - pending.y);
                const bestDist = Math.hypot(best.x - pending.x, best.y - pending.y);
                return targetDist < bestDist ? target : best;
            }, null);
        this._queuedComboThrow = {
            target: comboTarget,
            delayMs: Math.max(0, Number(cfg.comboDelayMs) || 450),
        };
    }

    _updateQueuedCombo(dt) {
        if (!this._queuedComboThrow) return;
        this._queuedComboThrow.delayMs = Math.max(
            0,
            this._queuedComboThrow.delayMs - Math.max(0, Number(dt) || 0)
        );
        if (!this._isValidHostile(this._queuedComboThrow.target)) this._queuedComboThrow = null;
    }

    _cancelBossAction() {
        this._bossAction = null;
        this._bossActionTimer = 0;
        this._bossActionDuration = 0;
        this._bossActionReleased = false;
        this._bossActionTarget = null;
        this._bossActionPoint = null;
        this._bossActionCombo = false;
        this._frozenForCast = false;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._animState = 'idle';
        this._animStateTimer = 0;
        this.aiTimer = 0;
    }

    _destroyCustomEffects() {
        for (const pending of this._pendingVineWarnings) destroyWarning(pending.warning);
        this._pendingVineWarnings = [];
        for (const entry of this._rockProjectiles) {
            destroyWarning(entry.warning);
            entry.projectile?.cancel?.();
        }
        this._rockProjectiles = [];
        for (const graphics of this._impactGraphics) {
            if (graphics?.active) graphics.destroy();
        }
        this._impactGraphics = [];
        this._queuedComboThrow = null;
    }

    onDeath(source) {
        this._cancelBossAction();
        this._destroyCustomEffects();
        super.onDeath(source);
    }
}

function createPurpleBlightAncient(x, y, overrides = {}) {
    const base = enemyConfigData.purpleBlightAncient || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new PurpleBlightAncientEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

/**
 * 自然系精英食人花：四动作近战模板；普通攻击确认命中且未被弹反后，
 * 读取配置给目标叠加逐层消退的腐蚀。
 */
class CarnivorousPitcherEnemy extends ZombieDogEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.carnivorousPitcher,
            ...config,
        });
    }

    _getCarnivorousPitcherVisualState(state = this._animState) {
        return state === 'run' ? 'walk' : state;
    }

    _getFrameLayout(state = this._animState) {
        return super._getFrameLayout(this._getCarnivorousPitcherVisualState(state));
    }

    _getTextureKey() {
        return `enemy_carnivorous_pitcher_${this._getCarnivorousPitcherVisualState()}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        const visualState = this._getCarnivorousPitcherVisualState();
        options.animState = visualState;
        options.animKey = `enemy_carnivorous_pitcher_${visualState}_v1`;
        return options;
    }

    _onConfirmedHitEntity(target) {
        if (!target?.active || target._isDead || !(target.hp > 0)
            || typeof target.applyCorrosion !== 'function') return;
        const corrosion = this.config?.attackSkills?.corrosionOnHit || {};
        const stacks = Math.max(0, Math.floor(Number(corrosion.stacks) || 0));
        if (stacks <= 0) return;
        target.applyCorrosion(
            stacks,
            Math.max(1, Number(corrosion.durationMs) || 5000),
            Math.max(0, Number(corrosion.defenseReductionPerStack) || 0.05)
        );
    }
}

function createCarnivorousPitcher(x, y, overrides = {}) {
    const base = enemyConfigData.carnivorousPitcher || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new CarnivorousPitcherEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

/**
 * 普通棕蛇：复用已验证的四动作普通近战/死亡保尸时序。逻辑 run 继续
 * 播放同一套蜿蜒 walking；每次实际命中且未被弹反后叠加配置化中毒。
 */
class BrownSnakeEnemy extends ZombieDogEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.brownSnake,
            ...config,
        });
        // 低矮贴地素材不叠加通用椭圆阴影，避免蛇腹下方出现独立黑色地块。
        this._noShadow = true;
    }

    _getBrownSnakeVisualState(state = this._animState) {
        return state === 'run' ? 'walk' : state;
    }

    _getFrameLayout(state = this._animState) {
        return super._getFrameLayout(this._getBrownSnakeVisualState(state));
    }

    _getTextureKey() {
        return `enemy_brown_snake_${this._getBrownSnakeVisualState()}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        const visualState = this._getBrownSnakeVisualState();
        const layout = this._getFrameLayout(visualState);
        const visualScale = Math.max(0.01, Number(layout.visualScale) || 1);
        if (visualScale !== 1) {
            options.spriteSize *= visualScale;
            this.footOffsetY *= visualScale;
        }
        options.animState = visualState;
        options.animKey = `enemy_brown_snake_${visualState}_v1`;
        return options;
    }

    _onConfirmedHitEntity(target) {
        if (!target?.active || target._isDead || !(target.hp > 0)
                || typeof target.applyPoison !== 'function') return;
        const poison = this.config?.attackSkills?.poisonOnHit || {};
        const stacks = Math.max(0, Math.floor(Number(poison.stacks) || 0));
        if (stacks > 0) target.applyPoison(stacks);
    }
}

function createBrownSnake(x, y, overrides = {}) {
    const base = enemyConfigData.brownSnake || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new BrownSnakeEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

/**
 * 沼泽吸血大蚊：低生命、高速的自然系飞行近战怪。常驻 noCollision 只跳过
 * 单位间分离，墙体解析仍由既有 WallSystem 承担；每次确认命中后按目标实际
 * 扣除生命的配置比例恢复自身生命。
 */
class SwampVampireMosquitoEnemy extends ZombieDogEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.swampVampireMosquito,
            ...config,
        });
        this.noCollision = this.config?.noCollision ?? true;
        this._bloodDrainPreHitHp = new WeakMap();
    }

    _getSwampVampireMosquitoVisualState(state = this._animState) {
        return state === 'run' ? 'walk' : state;
    }

    _getFrameLayout(state = this._animState) {
        return super._getFrameLayout(this._getSwampVampireMosquitoVisualState(state));
    }

    _getTextureKey() {
        return `enemy_swamp_vampire_mosquito_${this._getSwampVampireMosquitoVisualState()}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        const visualState = this._getSwampVampireMosquitoVisualState();
        options.animState = visualState;
        options.animKey = `enemy_swamp_vampire_mosquito_${visualState}_v1`;
        return options;
    }

    _onHitEntity(target) {
        super._onHitEntity(target);
        if (target && (typeof target === 'object' || typeof target === 'function')) {
            const hp = Number(target.hp);
            if (Number.isFinite(hp)) this._bloodDrainPreHitHp.set(target, Math.max(0, hp));
        }
    }

    _onConfirmedHitEntity(target) {
        if (!target || !this._bloodDrainPreHitHp.has(target)) return;
        const hpBefore = this._bloodDrainPreHitHp.get(target);
        this._bloodDrainPreHitHp.delete(target);
        const hpAfter = Math.max(0, Number(target.hp) || 0);
        const damageDealt = Math.max(0, hpBefore - hpAfter);
        const healPercent = Math.max(0, Number(
            this.config?.attackSkills?.bloodDrain?.healPercent
        ) || 0);
        if (damageDealt <= 0 || healPercent <= 0 || !(this.hp > 0)) return;
        this.hp = Math.min(this.maxHp, this.hp + damageDealt * healPercent);
    }
}

function createSwampVampireMosquito(x, y, overrides = {}) {
    const base = enemyConfigData.swampVampireMosquito || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new SwampVampireMosquitoEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

/**
 * 黑色眼镜蛇王：沿用蛇类四动作与定向普通近战，在独立冷却上追加一次
 * 锁方向的扇形毒液喷射。普通咬击与喷射都通过确认命中钩子叠毒。
 */
class BlackKingCobraEnemy extends BrownSnakeEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.blackKingCobra,
            ...config,
        });
        this._venomSprayCfg = this.config?.attackSkills?.venomSpray || {};
        this._venomSprayCooldown = Math.max(0, Number(this._venomSprayCfg.initialCooldownMs) || 0);
        this._venomSprayActive = false;
        this._venomSprayTimer = 0;
        this._venomSprayReleased = false;
        this._venomSprayAngle = 0;
    }

    _getBrownSnakeVisualState(state = this._animState) {
        return state === 'run' ? 'walk' : state;
    }

    _getTextureKey() {
        return `enemy_black_king_cobra_${this._getBrownSnakeVisualState()}`;
    }

    _getPhaserOptions() {
        const options = ZombieDogEnemy.prototype._getPhaserOptions.call(this);
        const visualState = this._getBrownSnakeVisualState();
        options.animState = visualState;
        options.animKey = `enemy_black_king_cobra_${visualState}_v1`;
        return options;
    }

    update(dt, entities) {
        super.update(dt, entities);
        if (!this.active) return;

        const attackDt = this.getAttackIntervalDelta(dt);
        this._venomSprayCooldown = Math.max(0, this._venomSprayCooldown - attackDt);
        const controlled = this.hasStatusEffect
            && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen') || this.hasStatusEffect('fear'));

        if (this._venomSprayActive) {
            if (controlled) this._cancelVenomSpray();
            else this._updateVenomSpray(dt, entities);
        } else if (!controlled && this._venomSprayCooldown <= 0 && this._canStartVenomSpray(this.target)) {
            this._startVenomSpray(this.target);
        }

        // ZombieDog 的速度动画状态机不认识施法态；基类更新后锁回攻击母版。
        if (this._venomSprayActive) this._animState = 'attack';
    }

    _canStartVenomSpray(target) {
        if (!target?.active || target._isDead || target.hittable === false
            || target._faction === 'enemy' || !(target.hp > 0)) return false;
        if (this._attackTimer > 0 || this._attackAnimTimer > 0
            || this._pendingThrust?.active || this._attackTelegraphTimer > 0) return false;
        const range = Math.max(0, Number(this._venomSprayCfg.triggerRange) || 450);
        if (distanceToEntityShape(target, this.x, this.y) > range) return false;
        const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
        return hasRangedLineOfSight(this, target, 8, ignore);
    }

    _startVenomSpray(target) {
        const duration = Math.max(100, Number(this._venomSprayCfg.durationMs) || 1200);
        this._venomSprayActive = true;
        this._venomSprayTimer = duration;
        this._venomSprayReleased = false;
        this._venomSprayAngle = Math.atan2(target.y - this.y, target.x - this.x);
        this._venomSprayCooldown = Math.max(0, Number(this._venomSprayCfg.cooldown) || 9000);
        this._frozenForCast = true;
        this._animState = 'attack';
        this._animStateTimer = 0;
        this._attackTimer = duration;
        this._attackAnimTimer = duration;
        this._animFrame = 0;
        this._animTimer = 0;
        this.rotation = this._venomSprayAngle;
        this._lastHorizontalFacing = Math.cos(this._venomSprayAngle) < 0 ? 'left' : 'right';
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.aiTimer = 0;
        playSoundFrom(this, 'venom');
    }

    _updateVenomSpray(dt, entities) {
        const duration = Math.max(100, Number(this._venomSprayCfg.durationMs) || 1200);
        this._venomSprayTimer = Math.max(0, this._venomSprayTimer - Math.max(0, Number(dt) || 0));
        const frameCount = Math.max(1, Math.floor(Number(this._venomSprayCfg.frameCount) || 21));
        const releaseFrame = Math.max(0, Math.min(
            frameCount - 1,
            Math.floor(Number(this._venomSprayCfg.releaseFrame) || 0)
        ));
        const releaseAtMs = duration * releaseFrame / frameCount;
        const elapsed = duration - this._venomSprayTimer;
        if (!this._venomSprayReleased && elapsed >= releaseAtMs) {
            this._venomSprayReleased = true;
            this._releaseVenomSpray(entities);
        }
        this._frozenForCast = true;
        this._animState = 'attack';
        this.rotation = this._venomSprayAngle;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._venomSprayTimer <= 0) this._cancelVenomSpray();
    }

    _releaseVenomSpray(entities) {
        const cfg = this._venomSprayCfg;
        const range = Math.max(1, Number(cfg.range) || 420);
        const arcDegrees = Math.max(1, Number(cfg.arcDegrees) || 82);
        const halfArc = arcDegrees * Math.PI / 360;
        const originX = this.collider?.x ?? this.x;
        const originY = this.collider?.y ?? this.y;
        const damage = Math.max(1, Math.round(
            (this.data?.atk || this.data?.str || 20) * (Number(cfg.damageMultiplier) || 0.85)
        ));
        const values = entities?.values ? entities.values() : (entities || []);

        for (const target of values) {
            if (!target || target === this || !target.active || target._isDead
                || target.hittable === false || target._faction === 'enemy' || !(target.hp > 0)) continue;
            const targetX = target.collider?.x ?? target.x;
            const targetY = target.collider?.y ?? target.y;
            if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) continue;
            const dx = targetX - originX;
            const dy = targetY - originY;
            const distance = Math.hypot(dx, dy);
            const targetRadius = Math.max(0, Number(target.collisionRadius ?? target.collider?.radius) || 0);
            if (distance - targetRadius > range) continue;
            let diff = Math.atan2(dy, dx) - this._venomSprayAngle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const angularPadding = distance > targetRadius && distance > 0
                ? Math.asin(Math.min(1, targetRadius / distance))
                : Math.PI;
            if (Math.abs(diff) > halfArc + angularPadding) continue;
            const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
            if (!hasRangedLineOfSight(this, target, 8, ignore)) continue;

            DamagePipeline.applyHit(this, target, {
                damage,
                damageType: cfg.damageType || 'magic',
                isMelee: false,
                confirmedHitContext: {
                    skillId: 'venomSpray',
                    poisonStacksOverride: Math.max(0, Math.floor(Number(cfg.poisonStacks) || 0)),
                },
            });
        }

        EffectManager.add(new VenomSprayEffect({
            x: originX,
            y: originY,
            angle: this._venomSprayAngle,
            range,
            arcDegrees,
            durationMs: cfg.effectDurationMs,
            particleCount: cfg.particleCount,
        }));
    }

    _cancelVenomSpray() {
        this._venomSprayActive = false;
        this._venomSprayTimer = 0;
        this._venomSprayReleased = false;
        this._frozenForCast = false;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._animState = 'idle';
        this._animStateTimer = 0;
        this._animFrame = 0;
        this.aiTimer = 0;
    }

    _onConfirmedHitEntity(target, context = {}) {
        if (!target?.active || target._isDead || !(target.hp > 0)
            || typeof target.applyPoison !== 'function') return;
        const normalStacks = this.config?.attackSkills?.poisonOnHit?.stacks;
        const stacks = Math.max(0, Math.floor(Number(
            context.poisonStacksOverride ?? normalStacks
        ) || 0));
        if (stacks > 0) target.applyPoison(stacks);
    }

    onDeath(source) {
        this._venomSprayActive = false;
        this._venomSprayTimer = 0;
        this._venomSprayReleased = false;
        this._frozenForCast = false;
        super.onDeath(source);
    }
}

function createBlackKingCobra(x, y, overrides = {}) {
    const base = enemyConfigData.blackKingCobra || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new BlackKingCobraEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

/**
 * 美杜莎领主：甩尾在第 12 帧结算锁向地面扇形 AOE；石化凝视在
 * 独立动画第 11 帧释放扇形魔法伤害，并调用通用 applyPetrify 状态入口。
 */
class MedusaEnemy extends ZombieDogEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.medusa,
            ...config,
        });
        this._petrifyingGazeCfg = this.config?.attackSkills?.petrifyingGaze || {};
        this._petrifyingGazeCooldown = Math.max(
            0,
            Number(this._petrifyingGazeCfg.initialCooldownMs) || 0
        );
        this._petrifyingGazeActive = false;
        this._petrifyingGazeTimer = 0;
        this._petrifyingGazeReleased = false;
        this._petrifyingGazeAngle = 0;
        this._petrifyingGazeFx = null;

        // 逐帧普通攻击时间轴继续负责起手、锁向和第12帧触发；接触判定
        // 改由美杜莎专属地面扇形处理，避免通用解析器退回单体主目标语义。
        const meleeAttack = this.attacks?.melee;
        if (meleeAttack?.checkTriangleHit) {
            const fallbackCheck = meleeAttack.checkTriangleHit.bind(meleeAttack);
            meleeAttack.checkTriangleHit = (source) => {
                if (source === this) {
                    this._resolveTailSweepAoe();
                    return;
                }
                fallbackCheck(source);
            };
        }
    }

    _getMedusaVisualState(state = this._animState) {
        return state === 'run' ? 'walk' : state;
    }

    _getFrameLayout(state = this._animState) {
        return super._getFrameLayout(this._getMedusaVisualState(state));
    }

    _getTextureKey() {
        return `enemy_medusa_${this._getMedusaVisualState()}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        const visualState = this._getMedusaVisualState();
        options.animState = visualState;
        options.animKey = `enemy_medusa_${visualState}_v1`;
        return options;
    }

    _resolveTailSweepAoe() {
        const pending = this._pendingThrust;
        if (!pending?.active || pending.tailSweepResolved) return;
        pending.tailSweepResolved = true;

        const cfg = this.config?.basicMelee?.area || {};
        const range = Math.max(1, Number(cfg.range) || 230);
        const arcDegrees = Math.max(1, Number(cfg.arcDegrees) || 140);
        const arcRadians = arcDegrees * Math.PI / 180;
        const originX = Number.isFinite(Number(pending.x))
            ? Number(pending.x)
            : (this.collider?.x ?? this.x);
        const originY = Number.isFinite(Number(pending.y))
            ? Number(pending.y)
            : (this.collider?.y ?? this.y);
        const angle = Number.isFinite(Number(pending.angle))
            ? Number(pending.angle)
            : (this.rotation || 0);
        const shape = new GroundSector(
            originX,
            originY,
            angle,
            range,
            arcRadians,
            surfaceEffectFromEntity(this)
        );

        const candidates = new Set(pending.entities || []);
        for (const member of PartySystem.members || []) candidates.add(member);
        for (const friendly of (typeof window !== 'undefined' && window.Game?.friendlyUnits) || []) {
            candidates.add(friendly);
        }

        const baseDamage = Math.max(1, Math.floor(
            ((Number(pending.damage?.min) || 0) + (Number(pending.damage?.max) || 0)) / 2
            + (Number(pending.damageBonus) || 0)
        ));
        const damageMultiplier = Math.max(0, Number(cfg.damageMultiplier) || 1);
        const damage = Math.max(1, Math.floor(baseDamage * damageMultiplier));
        const knockback = Number.isFinite(Number(cfg.knockback))
            ? Number(cfg.knockback)
            : pending.knockback;

        for (const target of candidates) {
            if (!target || target === this || !target.active || target._isDead
                || target.hittable === false || !(target.hp > 0) || pending.hitSet.has(target)) continue;
            if (isFriendlyFire(this, target)
                || (this._faction === 'enemy' && target._faction === 'enemy')) continue;
            if (!shape.intersectsEntity(target)) continue;

            const targetX = target.collider?.x ?? target.x;
            const targetY = target.collider?.y ?? target.y;
            const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
            if (WallSystem?.blocked?.(originX, originY, targetX, targetY, ignore)) {
                const structureInReach = target._isDefenseStructure
                    && distanceToEntityShape(target, originX, originY) <= range;
                if (!structureInReach) continue;
            }

            const radialAngle = Math.atan2(targetY - originY, targetX - originX);
            const result = DamagePipeline.applyHit(this, target, {
                damage,
                damageType: pending.damageType || 'physical',
                knockback,
                angle: radialAngle,
                isMelee: true,
                confirmedHitContext: { skillId: 'tailSweep' },
            });
            if (!result.hit) continue;
            pending.hitSet.add(target);
            if (result.skillExpEligible) {
                pending.totalHitCount += 1;
                if (result.killed && !target._summoned) pending.totalKillCount += 1;
            }
        }
    }

    update(dt, entities) {
        super.update(dt, entities);
        if (!this.active || this.hasStatusEffect?.('petrified')) return;

        const attackDt = this.getAttackIntervalDelta(dt);
        this._petrifyingGazeCooldown = Math.max(0, this._petrifyingGazeCooldown - attackDt);
        const controlled = this.hasStatusEffect
            && (this.hasStatusEffect('stun')
                || this.hasStatusEffect('frozen')
                || this.hasStatusEffect('fear'));

        if (this._petrifyingGazeActive) {
            if (controlled) this._cancelPetrifyingGaze();
            else this._updatePetrifyingGaze(dt, entities);
        } else if (!controlled
            && this._petrifyingGazeCooldown <= 0
            && this._canStartPetrifyingGaze(this.target)) {
            this._startPetrifyingGaze(this.target);
        }

        if (this._petrifyingGazeActive) this._animState = 'petrify';
    }

    _canStartPetrifyingGaze(target) {
        if (!target?.active || target._isDead || target.hittable === false
            || !['player', 'companion'].includes(target._faction) || !(target.hp > 0)) return false;
        if (this._attackTimer > 0 || this._attackAnimTimer > 0
            || this._pendingThrust?.active || this._attackTelegraphTimer > 0) return false;
        const range = Math.max(0, Number(this._petrifyingGazeCfg.triggerRange) || 560);
        if (distanceToEntityShape(target, this.x, this.y) > range) return false;
        const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
        return hasRangedLineOfSight(this, target, 8, ignore);
    }

    _startPetrifyingGaze(target) {
        const duration = Math.max(100, Number(this._petrifyingGazeCfg.durationMs) || 1500);
        this._petrifyingGazeActive = true;
        this._petrifyingGazeTimer = duration;
        this._petrifyingGazeReleased = false;
        this._petrifyingGazeAngle = Math.atan2(target.y - this.y, target.x - this.x);
        this._petrifyingGazeCooldown = Math.max(
            0,
            Number(this._petrifyingGazeCfg.cooldown) || 14000
        );
        this._frozenForCast = true;
        this._animState = 'petrify';
        this._animStateTimer = 0;
        this._attackTimer = duration;
        this._attackAnimTimer = duration;
        this._animFrame = 0;
        this._animTimer = 0;
        this.rotation = this._petrifyingGazeAngle;
        this._lastHorizontalFacing = Math.cos(this._petrifyingGazeAngle) < 0 ? 'left' : 'right';
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.aiTimer = 0;
        playSoundFrom(this, 'petrify');
    }

    _updatePetrifyingGaze(dt, entities) {
        const cfg = this._petrifyingGazeCfg;
        const duration = Math.max(100, Number(cfg.durationMs) || 1500);
        this._petrifyingGazeTimer = Math.max(
            0,
            this._petrifyingGazeTimer - Math.max(0, Number(dt) || 0)
        );
        const frameCount = Math.max(1, Math.floor(Number(cfg.frameCount) || 21));
        const releaseFrame = Math.max(
            0,
            Math.min(frameCount - 1, Math.floor(Number(cfg.releaseFrame) || 0))
        );
        const releaseAtMs = duration * releaseFrame / frameCount;
        const elapsed = duration - this._petrifyingGazeTimer;
        if (!this._petrifyingGazeReleased && elapsed >= releaseAtMs) {
            this._petrifyingGazeReleased = true;
            this._releasePetrifyingGaze(entities);
        }
        this._frozenForCast = true;
        this._animState = 'petrify';
        this.rotation = this._petrifyingGazeAngle;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._petrifyingGazeTimer <= 0) this._cancelPetrifyingGaze();
    }

    _releasePetrifyingGaze(entities) {
        const cfg = this._petrifyingGazeCfg;
        const range = Math.max(1, Number(cfg.range) || 500);
        const arcDegrees = Math.max(1, Number(cfg.arcDegrees) || 80);
        const halfArc = arcDegrees * Math.PI / 360;
        const originX = this.collider?.x ?? this.x;
        const originY = this.collider?.y ?? this.y;
        const damage = Math.max(1, Math.round(
            (this.data?.matk || this.data?.int || 20) * (Number(cfg.damageMultiplier) || 1.25)
        ));
        const petrifyDuration = Math.max(0, Number(cfg.petrifyDurationMs) || 5000);
        const magicDamageTakenMultiplier = Math.max(
            1,
            Number(cfg.magicDamageTakenMultiplier) || 1.5
        );
        const frameCount = Math.max(1, Math.floor(Number(cfg.frameCount) || 21));
        const releaseFrame = Math.max(
            0,
            Math.min(frameCount - 1, Math.floor(Number(cfg.releaseFrame) || 0))
        );
        const castDuration = Math.max(100, Number(cfg.durationMs) || 1500);
        const remainingCastMs = Math.max(
            160,
            castDuration - castDuration * releaseFrame / frameCount
        );
        if (this._petrifyingGazeFx?.active) this._petrifyingGazeFx.requestFadeOut(80);
        this._petrifyingGazeFx = new MedusaPetrifyingGazeFx(this, {
            angle: this._petrifyingGazeAngle,
            range,
            arcDegrees,
            durationMs: remainingCastMs,
            visual: cfg.visualEffect,
        });
        EffectManager.add(this._petrifyingGazeFx);
        const values = new Set(entities?.values ? entities.values() : (entities || []));
        for (const member of PartySystem.members || []) values.add(member);
        for (const friendly of (typeof window !== 'undefined' && window.Game?.friendlyUnits) || []) {
            values.add(friendly);
        }

        for (const target of values) {
            if (!target || target === this || !target.active || target._isDead
                || target.hittable === false || !['player', 'companion'].includes(target._faction)
                || target._isDefenseStructure || !(target.hp > 0)) continue;
            const targetX = target.collider?.x ?? target.x;
            const targetY = target.collider?.y ?? target.y;
            if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) continue;
            const dx = targetX - originX;
            const dy = targetY - originY;
            const distance = Math.hypot(dx, dy);
            const targetRadius = Math.max(
                0,
                Number(target.collisionRadius ?? target.collider?.radius) || 0
            );
            if (distance - targetRadius > range) continue;
            let diff = Math.atan2(dy, dx) - this._petrifyingGazeAngle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const angularPadding = distance > targetRadius && distance > 0
                ? Math.asin(Math.min(1, targetRadius / distance))
                : Math.PI;
            if (Math.abs(diff) > halfArc + angularPadding) continue;
            const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
            if (!hasRangedLineOfSight(this, target, 8, ignore)) continue;

            const result = DamagePipeline.applyHit(this, target, {
                damage,
                damageType: cfg.damageType || 'magic',
                isMelee: false,
                confirmedHitContext: { skillId: 'petrifyingGaze' },
            });
            if (result.hit && target.active && !target._isDead && target.hp > 0) {
                target.applyPetrify?.(petrifyDuration, magicDamageTakenMultiplier);
            }
        }
    }

    _cancelPetrifyingGaze() {
        if (this._petrifyingGazeFx?.active) this._petrifyingGazeFx.requestFadeOut(140);
        this._petrifyingGazeActive = false;
        this._petrifyingGazeTimer = 0;
        this._petrifyingGazeReleased = false;
        this._frozenForCast = false;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._animState = 'idle';
        this._animStateTimer = 0;
        this._animFrame = 0;
        this.aiTimer = 0;
    }

    onDeath(source) {
        if (this._petrifyingGazeFx?.active) this._petrifyingGazeFx.requestFadeOut(120);
        this._petrifyingGazeActive = false;
        this._petrifyingGazeTimer = 0;
        this._petrifyingGazeReleased = false;
        this._frozenForCast = false;
        super.onDeath(source);
    }
}

function createMedusa(x, y, overrides = {}) {
    const base = enemyConfigData.medusa || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new MedusaEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

/**
 * 狼人王领主：前方扇形爪击 + 突变体-3同口径的锁定目标飞扑。
 * 嚎叫结束后只通过 alpha 渐隐进入潜行，实体、碰撞和受击体始终保留；
 * 潜行中的第一次攻击会破隐并携带 2 倍伤害与 3 秒致残。
 */
class WerewolfKingEnemy extends ZombieDogEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.werewolfKing,
            ...config,
        });
        this._pounceCfg = this.config?.attackSkills?.pounce || {};
        this._stealthCfg = this.config?.attackSkills?.stealth || {};
        this._pounceCooldown = Math.max(0, Number(this._pounceCfg.initialCooldownMs) || 0);
        this._pounceState = 'idle'; // idle | prepare | charge
        this._pounceTimer = 0;
        this._pounceTarget = null;
        this._pounceTargetPos = null;
        this._pounceDir = { x: 0, y: 0 };
        this._pounceSpeed = 0;
        this._pounceDamaged = false;
        this._pounceGhostTimer = 0;

        this._stealthCooldown = Math.max(0, Number(this._stealthCfg.initialCooldownMs) || 0);
        this._stealthPhase = 'idle'; // idle | howling | fadingOut | hidden | fadingIn
        this._stealthTimer = 0;
        this._stealthHiddenTimer = 0;
        this._stealthVisualAlpha = 1;
        this._stealthDustTimer = 0;
        this._pendingStealthStrike = null;

        // 通用逐帧普通攻击继续负责起手与接触帧，命中改为狼人王专属扇形。
        const meleeAttack = this.attacks?.melee;
        if (meleeAttack?.checkTriangleHit) {
            const fallbackCheck = meleeAttack.checkTriangleHit.bind(meleeAttack);
            meleeAttack.checkTriangleHit = (source) => {
                if (source === this) {
                    this._resolveClawSweepAoe();
                    return;
                }
                fallbackCheck(source);
            };
        }
    }

    _getWerewolfVisualState(state = this._animState) {
        if (state === 'walk' || state === 'run') return 'running';
        if (state === 'death') return 'dying';
        return state;
    }

    _getFrameLayout(state = this._animState) {
        return super._getFrameLayout(this._getWerewolfVisualState(state));
    }

    _getTextureKey() {
        return `enemy_werewolf_king_${this._getWerewolfVisualState()}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        const visualState = this._getWerewolfVisualState();
        options.alpha = this._stealthVisualAlpha;
        options.animState = this._animState === 'death' ? 'death' : visualState;
        options.animKey = `enemy_werewolf_king_${visualState}_v1`;
        return options;
    }

    update(dt, entities) {
        super.update(dt, entities);
        if (!this.active) return;

        const delta = Math.max(0, Number(dt) || 0);
        const attackDt = this.getAttackIntervalDelta(delta);
        this._pounceCooldown = Math.max(0, this._pounceCooldown - attackDt);
        this._stealthCooldown = Math.max(0, this._stealthCooldown - attackDt);

        const controlled = this.hasStatusEffect
            && (this.hasStatusEffect('stun')
                || this.hasStatusEffect('frozen')
                || this.hasStatusEffect('petrified')
                || this.hasStatusEffect('fear'));
        if (controlled) {
            if (this._pounceState !== 'idle') this._endPounce();
            if (this._stealthPhase === 'howling' || this._stealthPhase === 'fadingOut') {
                this._cancelStealthCast();
            }
            this._applyStealthAlpha();
            return;
        }

        if (this._pounceState !== 'idle') {
            this._updatePounce(delta);
            this._updateStealthVisual(delta);
            this._applyStealthAlpha();
            return;
        }

        if (this._stealthPhase !== 'idle') {
            this._updateStealth(delta);
            if (this._stealthPhase === 'howling' || this._stealthPhase === 'fadingOut') {
                this._applyStealthAlpha();
                return;
            }
        }

        if (this._stealthPhase === 'hidden'
            && this._pounceCooldown <= 0
            && this._canStartPounce(this.target)) {
            // 潜行组合技：飞扑可用时跳过普通攻击判定并优先发动。
            this._startPounce(this.target);
            this._applyStealthAlpha();
            return;
        }

        if (this._stealthPhase === 'idle'
            && this._stealthCooldown <= 0
            && this._canStartStealth(this.target)) {
            this._startStealthHowl();
            this._applyStealthAlpha();
            return;
        }

        if (this._stealthPhase === 'idle'
            && this._pounceCooldown <= 0
            && this._canStartPounce(this.target)) {
            this._tryAttackTelegraph(() => this._startPounce(this.target));
        }
        this._applyStealthAlpha();
    }

    triggerWeaponAnim() {
        if (this._stealthPhase === 'hidden' || this._stealthPhase === 'fadingOut') {
            this._armStealthStrike('basic');
        }
        super.triggerWeaponAnim();
    }

    _resolveClawSweepAoe() {
        const pending = this._pendingThrust;
        if (!pending?.active || pending.werewolfSweepResolved) return;
        pending.werewolfSweepResolved = true;
        // 与正式攻击表的接触帧绑定；无论命中与否，每次横扫只播放一次爪击声。
        playSoundFrom(this, 'claw');

        const cfg = this.config?.basicMelee?.area || {};
        const range = Math.max(1, Number(cfg.range) || 245);
        const arcDegrees = Math.max(1, Number(cfg.arcDegrees) || 135);
        const originX = Number.isFinite(Number(pending.x))
            ? Number(pending.x) : (this.collider?.x ?? this.x);
        const originY = Number.isFinite(Number(pending.y))
            ? Number(pending.y) : (this.collider?.y ?? this.y);
        const angle = Number.isFinite(Number(pending.angle))
            ? Number(pending.angle) : (this.rotation || 0);
        const shape = new GroundSector(
            originX,
            originY,
            angle,
            range,
            arcDegrees * Math.PI / 180,
            surfaceEffectFromEntity(this)
        );
        const candidates = new Set(pending.entities || []);
        for (const member of PartySystem.members || []) candidates.add(member);
        for (const friendly of (typeof window !== 'undefined' && window.Game?.friendlyUnits) || []) {
            candidates.add(friendly);
        }

        const baseDamage = Math.max(1, Math.floor(
            ((Number(pending.damage?.min) || 0) + (Number(pending.damage?.max) || 0)) / 2
            + (Number(pending.damageBonus) || 0)
        ));
        const stealthStrike = this._pendingStealthStrike?.attackType === 'basic'
            ? this._pendingStealthStrike : null;
        const damage = Math.max(1, Math.floor(
            baseDamage
            * Math.max(0, Number(cfg.damageMultiplier) || 1)
            * (stealthStrike?.damageMultiplier || 1)
        ));
        const knockback = Number.isFinite(Number(cfg.knockback))
            ? Number(cfg.knockback) : pending.knockback;

        for (const target of candidates) {
            if (!target || target === this || !target.active || target._isDead
                || target.hittable === false || !(target.hp > 0) || pending.hitSet.has(target)) continue;
            if (isFriendlyFire(this, target)
                || (this._faction === 'enemy' && target._faction === 'enemy')) continue;
            if (!shape.intersectsEntity(target)) continue;

            const targetX = target.collider?.x ?? target.x;
            const targetY = target.collider?.y ?? target.y;
            const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
            if (WallSystem?.blocked?.(originX, originY, targetX, targetY, ignore)) {
                const structureInReach = target._isDefenseStructure
                    && distanceToEntityShape(target, originX, originY) <= range;
                if (!structureInReach) continue;
            }

            const result = DamagePipeline.applyHit(this, target, {
                damage,
                damageType: pending.damageType || 'physical',
                knockback,
                angle: Math.atan2(targetY - originY, targetX - originX),
                isMelee: true,
                confirmedHitContext: { skillId: 'werewolfKingClawSweep' },
            });
            if (!result.hit) continue;
            pending.hitSet.add(target);
            if (stealthStrike && target.active && !target._isDead && target.hp > 0
                && !(target.shieldSystem && target.shieldSystem._lastParried)) {
                target.applyCripple?.(stealthStrike.crippleMs);
            }
            if (result.skillExpEligible) {
                pending.totalHitCount += 1;
                if (result.killed && !target._summoned) pending.totalKillCount += 1;
            }
        }
        if (stealthStrike) this._pendingStealthStrike = null;
    }

    _isReadyForSkill() {
        return !this._deathStarted
            && this._pounceState === 'idle'
            && this._attackTimer <= 0
            && this._attackAnimTimer <= 0
            && !this._pendingThrust?.active
            && this._attackTelegraphTimer <= 0
            && !this._frozenForCast;
    }

    _canStartStealth(target) {
        if (!this._isReadyForSkill() || !target?.active || target._isDead
            || target.hittable === false || !(target.hp > 0)) return false;
        const triggerRange = Math.max(0, Number(this._stealthCfg.triggerRange) || 900);
        return distanceToEntityShape(target, this.x, this.y) <= triggerRange;
    }

    _startStealthHowl() {
        const duration = Math.max(100, Number(this._stealthCfg.howlDurationMs) || 5000);
        this._stealthPhase = 'howling';
        this._stealthTimer = duration;
        this._stealthVisualAlpha = 1;
        this._stealthCooldown = Math.max(0, Number(this._stealthCfg.cooldown) || 18000);
        this._frozenForCast = true;
        this._animState = 'howl';
        this._animStateTimer = 0;
        this._attackTimer = duration;
        this._attackAnimTimer = duration;
        this._animFrame = 0;
        this._animTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.aiTimer = 0;
        playSoundFrom(this, 'howl');
    }

    _updateStealth(dt) {
        if (this._stealthPhase === 'howling') {
            this._stealthTimer = Math.max(0, this._stealthTimer - dt);
            this._frozenForCast = true;
            this._animState = 'howl';
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            if (this._stealthTimer <= 0) {
                this._stealthPhase = 'fadingOut';
                this._stealthTimer = Math.max(1, Number(this._stealthCfg.fadeOutMs) || 650);
                this._attackTimer = this._stealthTimer;
                this._attackAnimTimer = this._stealthTimer;
            }
            return;
        }
        if (this._stealthPhase === 'fadingOut') {
            const duration = Math.max(1, Number(this._stealthCfg.fadeOutMs) || 650);
            this._stealthTimer = Math.max(0, this._stealthTimer - dt);
            this._stealthVisualAlpha = Math.max(0, Math.min(1, this._stealthTimer / duration));
            this._frozenForCast = true;
            this._animState = 'howl';
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            if (this._stealthTimer <= 0) {
                this._stealthPhase = 'hidden';
                this._stealthVisualAlpha = Math.max(0, Math.min(1,
                    Number(this._stealthCfg.hiddenAlpha) || 0));
                this._stealthHiddenTimer = Math.max(0, Number(this._stealthCfg.durationMs) || 10000);
                this._stealthDustTimer = 0;
                this._frozenForCast = false;
                this._attackTimer = 0;
                this._attackAnimTimer = 0;
                this._animState = 'idle';
                this._animStateTimer = 0;
                this.aiTimer = 0;
            }
            return;
        }
        if (this._stealthPhase === 'hidden') {
            this._stealthHiddenTimer = Math.max(0, this._stealthHiddenTimer - dt);
            this._spawnStealthDust(dt);
            if (this._stealthHiddenTimer <= 0) {
                this._pendingStealthStrike = null;
                this._beginReveal();
            }
            return;
        }
        this._updateStealthVisual(dt);
    }

    _updateStealthVisual(dt) {
        if (this._stealthPhase !== 'fadingIn') return;
        const duration = Math.max(1, Number(this._stealthCfg.fadeInMs) || 250);
        this._stealthTimer = Math.max(0, this._stealthTimer - dt);
        this._stealthVisualAlpha = Math.max(0, Math.min(1, 1 - this._stealthTimer / duration));
        if (this._stealthTimer <= 0) {
            this._stealthPhase = 'idle';
            this._stealthVisualAlpha = 1;
        }
    }

    _armStealthStrike(attackType) {
        this._pendingStealthStrike = {
            attackType,
            damageMultiplier: Math.max(1, Number(this._stealthCfg.damageMultiplier) || 2),
            crippleMs: Math.max(0, Number(this._stealthCfg.crippleMs) || 3000),
        };
        this._beginReveal();
    }

    _beginReveal() {
        if (this._stealthPhase === 'idle' || this._stealthPhase === 'fadingIn') return;
        this._stealthPhase = 'fadingIn';
        this._stealthTimer = Math.max(1, Number(this._stealthCfg.fadeInMs) || 250);
        this._stealthDustTimer = 0;
        this._frozenForCast = false;
    }

    _cancelStealthCast() {
        this._stealthPhase = 'idle';
        this._stealthTimer = 0;
        this._stealthVisualAlpha = 1;
        this._stealthDustTimer = 0;
        this._pendingStealthStrike = null;
        this._frozenForCast = false;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._animState = 'idle';
    }

    _applyStealthAlpha() {
        if (this._phaserSprite?.active) this._phaserSprite.setAlpha(this._stealthVisualAlpha);
    }

    _spawnStealthDust(dt) {
        const speed = Math.hypot(this.vx || 0, this.vy || 0);
        if (speed <= 1 || !this.isMoving) {
            this._stealthDustTimer = 0;
            return;
        }
        this._stealthDustTimer += dt;
        const interval = Math.max(40, Number(this._stealthCfg.dustIntervalMs) || 70);
        while (this._stealthDustTimer >= interval) {
            this._stealthDustTimer -= interval;
            const offsetX = -this.vx * (dt / 1000) * 1.5 + (Math.random() - 0.5) * 8;
            const offsetY = -this.vy * (dt / 1000) * 1.5 + (Math.random() - 0.5) * 4;
            EffectFactory.createDustEffect(
                (this.collider?.x ?? this.x) + offsetX,
                (this.collider?.y ?? this.y) + offsetY - 5,
                1.5
            );
        }
    }

    _canStartPounce(target) {
        if (!this._isReadyForSkill() || !target?.active || target._isDead
            || target.hittable === false || !(target.hp > 0)) return false;
        const range = Math.max(1, Number(this._pounceCfg.triggerRange) || 500);
        return distanceToEntityShape(target, this.x, this.y) <= range;
    }

    _startPounce(target) {
        if (!this._canStartPounce(target)) return false;
        if (this._stealthPhase === 'hidden' || this._stealthPhase === 'fadingOut') {
            this._armStealthStrike('pounce');
        }
        const prepareMs = Math.max(0, Number(this._pounceCfg.prepareMs) || 1000);
        const chargeMs = Math.max(1, Number(this._pounceCfg.chargeMs) || 1000);
        this._pounceState = 'prepare';
        this._pounceTimer = prepareMs;
        this._pounceTarget = target;
        this._pounceTargetPos = null;
        this._pounceDamaged = false;
        this._pounceGhostTimer = 0;
        this._pounceCooldown = Math.max(0, Number(this._pounceCfg.cooldown) || 12000);
        this._frozenForCast = true;
        this._animState = 'pounce';
        this._animStateTimer = 0;
        this._attackTimer = prepareMs + chargeMs;
        this._attackAnimTimer = prepareMs + chargeMs;
        this._animFrame = 0;
        this._animTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
        this._lastHorizontalFacing = Math.cos(this.rotation) < 0 ? 'left' : 'right';
        this.aiTimer = 0;
        playSoundFrom(this, 'pouncePrepare');
        return true;
    }

    _updatePounce(dt) {
        this._frozenForCast = true;
        this._animState = 'pounce';
        if (this._pounceState === 'prepare') {
            this._pounceTimer = Math.max(0, this._pounceTimer - dt);
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            if (this._pounceTarget?.active) {
                this.rotation = Math.atan2(
                    this._pounceTarget.y - this.y,
                    this._pounceTarget.x - this.x
                );
                this._lastHorizontalFacing = Math.cos(this.rotation) < 0 ? 'left' : 'right';
            }
            if (this._pounceTimer <= 0) this._startPounceCharge();
            return;
        }

        const target = this._pounceTarget;
        const fromX = this.x;
        const fromY = this.y;
        const distToEnd = this._pounceTargetPos
            ? Math.hypot(this._pounceTargetPos.x - this.x, this._pounceTargetPos.y - this.y)
            : 0;
        let intendedX = fromX;
        let intendedY = fromY;
        if (distToEnd > 10 && this._pounceSpeed > 0) {
            const step = Math.min(this._pounceSpeed * dt / 1000, distToEnd);
            intendedX += this._pounceDir.x * step;
            intendedY += this._pounceDir.y * step;
            const resolved = WallSystem.resolve(
                fromX, fromY, intendedX, intendedY, this.groundRadius
            );
            this.x = resolved.x;
            this.y = resolved.y;
        }
        const motionBlocked = straightMotionWasBlocked(
            fromX, fromY, intendedX, intendedY, this.x, this.y
        );

        if (!this._pounceDamaged && target?.active && target.hittable !== false
            && sweptMotionMeleeHits(
                this,
                target,
                fromX,
                fromY,
                this.x,
                this.y,
                Math.max(1, Number(this._pounceCfg.hitDistance) || 130),
                { blocked: motionBlocked, skill: '狼人王飞扑' }
            )) {
            const stealthStrike = this._pendingStealthStrike?.attackType === 'pounce'
                ? this._pendingStealthStrike : null;
            const baseDamage = Math.max(1, Number(this.data?.atk || this.data?.str) || 20);
            const damage = Math.max(1, Math.floor(
                baseDamage
                * Math.max(0, Number(this._pounceCfg.damageMultiplier) || 2)
                * (stealthStrike?.damageMultiplier || 1)
            ));
            const result = DamagePipeline.applyHit(this, target, {
                damage,
                damageType: this._pounceCfg.damageType || 'physical',
                isMelee: true,
                confirmedHitContext: { skillId: 'werewolfKingPounce' },
            });
            this._pounceDamaged = result.hit;
            if (result.hit) playSoundFrom(this, 'pounceHit');
            const parried = target.shieldSystem && target.shieldSystem._lastParried;
            if (result.hit && !parried && target.active && !target._isDead && target.hp > 0) {
                target.applyStun?.(Math.max(0, Number(this._pounceCfg.stunMs) || 2000));
                if (stealthStrike) target.applyCripple?.(stealthStrike.crippleMs);
            }
            if (stealthStrike) this._pendingStealthStrike = null;
            if (result.hit) {
                this._endPounce();
                return;
            }
        }

        this._pounceGhostTimer -= dt;
        if (this._pounceGhostTimer <= 0) {
            this._spawnPounceGhost();
            this._pounceGhostTimer = Math.max(30, Number(this._pounceCfg.ghostIntervalMs) || 60);
        }
        this._pounceTimer = Math.max(0, this._pounceTimer - dt);
        if (motionBlocked || !target?.active || target._isDead
            || this._pounceTimer <= 0 || distToEnd <= 10) {
            this._endPounce();
        }
    }

    _startPounceCharge() {
        const target = this._pounceTarget;
        if (!target?.active || target._isDead || !(target.hp > 0)) {
            this._endPounce();
            return;
        }
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0) {
            this._endPounce();
            return;
        }
        const maxDistance = Math.max(1, Number(this._pounceCfg.maxDistance) || 1200);
        const overshoot = Math.max(0, Number(this._pounceCfg.overshoot) || 300);
        const chargeDistance = Math.min(distance + overshoot, maxDistance);
        const chargeMs = Math.max(1, Number(this._pounceCfg.chargeMs) || 1000);
        this._pounceState = 'charge';
        this._pounceTimer = chargeMs;
        this._pounceDir = { x: dx / distance, y: dy / distance };
        this._pounceTargetPos = {
            x: this.x + this._pounceDir.x * chargeDistance,
            y: this.y + this._pounceDir.y * chargeDistance,
        };
        this._pounceSpeed = chargeDistance / (chargeMs / 1000);
        this.rotation = Math.atan2(this._pounceDir.y, this._pounceDir.x);
        this._lastHorizontalFacing = Math.cos(this.rotation) < 0 ? 'left' : 'right';
        this._pounceGhostTimer = 0;
        playSoundFrom(this, 'pounce');
    }

    _spawnPounceGhost() {
        const sprite = this._phaserSprite;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!sprite?.active || !scene?.textures?.exists?.(this._getTextureKey())) return;
        const ghost = scene.add.sprite(
            this.x,
            this.y,
            this._getTextureKey(),
            sprite.frame?.name ?? 0
        )
            .setAlpha(0.35)
            .setDisplaySize(sprite.displayWidth, sprite.displayHeight)
            .setFlipX(sprite.flipX)
            .setDepth((sprite.depth || 0) - 1);
        scene.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: 250,
            onComplete: () => ghost?.active && ghost.destroy(),
        });
    }

    _endPounce() {
        this._pounceState = 'idle';
        this._pounceTimer = 0;
        this._pounceTarget = null;
        this._pounceTargetPos = null;
        this._pounceSpeed = 0;
        this._pounceDamaged = false;
        this._pounceGhostTimer = 0;
        this._frozenForCast = false;
        this._attackTimer = 0;
        // 防止外部 CombatSystem 在飞扑结束的同一帧立刻再补一次普通攻击。
        this._attackAnimTimer = Math.max(0, Number(this._pounceCfg.recoveryMs) || 450);
        this._animState = 'idle';
        this.aiTimer = 0;
        if (this._pendingStealthStrike?.attackType === 'pounce') {
            this._pendingStealthStrike = null;
        }
    }

    onDeath(source) {
        this._endPounce();
        this._stealthPhase = 'idle';
        this._stealthTimer = 0;
        this._stealthVisualAlpha = 1;
        this._stealthDustTimer = 0;
        this._pendingStealthStrike = null;
        this._applyStealthAlpha();
        super.onDeath(source);
    }
}

function createWerewolfKing(x, y, overrides = {}) {
    const base = enemyConfigData.werewolfKing || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new WerewolfKingEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

/**
 * 黑熊领主：初始为黑袍德鲁伊，轮流施放冰锥、闪电与火球；半血后
 * 播放人变熊动画并进入强化四足近战阶段。两种形态共用同一生命链，
 * 只在变熊完成时应用一次既有属性倍率。
 */
class BlackBearEnemy extends ZombieDogEnemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            showWeapon: false,
            ...enemyConfigData.blackBear,
            ...config,
        });
        this._transformCfg = this.config?.transform || {};
        this._isTransforming = false;
        this._isTransformed = false;
        this._transformTriggered = false;
        this._transformTimer = 0;
        this._spellCfg = this.config?.attackSkills?.spellcasting || {};
        this._spellCycle = Array.isArray(this._spellCfg.cycle) && this._spellCfg.cycle.length
            ? this._spellCfg.cycle.slice()
            : ['iceSpike', 'lightningStrike', 'fireball'];
        this._spellIndex = 0;
        this._spellCooldown = 0;
        this._castActive = false;
        this._castTimer = 0;
        this._castReleased = false;
        this._pendingSpell = null;
        this._pendingSpellTarget = null;

        this._iceSpikeActive = false;
        this._iceSpikeCooldown = 0;
        this._iceSpikeTimer = 0;
        this._iceSpikeSpikes = [];
        this._iceSpikeImg = null;
        this._fireballActive = false;
        this._fireballCooldown = 0;
        this._fireballTimer = 0;
        this._fireballSpikes = [];
        this._fireball = null;
        this._fireballImg = null;
        this._lightningStrikeCooldown = 0;

        const configuredSkills = this.config?.attackSkills || {};
        if (!this.skills || Array.isArray(this.skills)) this.skills = {};
        const makeSkill = (id, name) => ({
            id,
            name,
            level: 1,
            getEffect: () => ({ ...(configuredSkills[id] || {}) }),
        });
        this.skills.iceSpike = makeSkill('iceSpike', '冰锥');
        this.skills.lightningStrike = makeSkill('lightningStrike', '闪电');
        this.skills.fireball = makeSkill('fireball', '火球');
        this._iceSpikeSystem = new IceSpikeSystem(this);
        this._lightningStrikeSystem = new LightningStrikeSystem(this);
        this._fireballSystem = new FireballSystem(this);

        // 德鲁伊阶段由自管施法链负责攻击；保留原 ThrustAttack 实例，变熊后原样恢复。
        const melee = this.attacks?.melee;
        if (melee && typeof melee.canUse === 'function') {
            const canUseBearMelee = melee.canUse.bind(melee);
            melee.canUse = () => this._isTransformed && canUseBearMelee();
        }
        this._applyDruidBody();
    }

    _getBlackBearVisualState(state = this._animState) {
        return state === 'run' ? 'walk' : state;
    }

    _getBlackDruidVisualState(state = this._animState) {
        if (state === 'death') return 'dying';
        if (state === 'attack') return 'attacking';
        if (state === 'ritual') return 'ritual';
        if (state === 'run' || state === 'walk' || state === 'pacing') return 'walking';
        return 'idle';
    }

    _cancelPhaseActions() {
        this._cancelDruidCast();
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._lungeActive = false;
        if (this._pendingThrust) this._pendingThrust.active = false;
        if (this.weaponAnim) {
            this.weaponAnim.state = 'idle';
            this.weaponAnim.timer = 0;
        }
        if (typeof this._clearAttackTelegraph === 'function') this._clearAttackTelegraph();
        delete this._forcedHitCritical;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
    }

    update(dt, entities) {
        if (!this.active) {
            super.update(dt, entities);
            return;
        }

        const attackDt = this.getAttackIntervalDelta(dt);
        this._iceSpikeSystem.update(dt, entities);
        this._lightningStrikeSystem.update(attackDt);
        this._fireballSystem.update(dt, entities);
        if (this._spellCooldown > 0) {
            this._spellCooldown = Math.max(0, this._spellCooldown - attackDt);
        }

        if (!this._transformTriggered && this.maxHp > 0
            && this.hp / this.maxHp <= (this._transformCfg.hpThreshold ?? 0.5)) {
            this._transformTriggered = true;
            this._isTransforming = true;
            this._transformTimer = this._transformCfg.duration ?? 2000;
            this._cancelPhaseActions();
            this._frozenForCast = true;
            this._animState = 'idle';
        }

        if (this._isTransforming) {
            this._cancelPhaseActions();
            this._frozenForCast = true;
            this._transformTimer = Math.max(0, this._transformTimer - dt);
            if (this._transformTimer <= 0) {
                this._isTransforming = false;
                this._isTransformed = true;
                this._frozenForCast = false;
                this._applyBearTransform();
            }
        }

        const controlled = this.hasStatusEffect
            && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen') || this.hasStatusEffect('fear'));
        if (controlled && this._castActive) {
            this._cancelDruidCast();
        } else if (this._castActive && !this._isTransforming && !this._isTransformed) {
            this._updateDruidCast(dt, entities);
        }

        super.update(dt, entities);

        if (!this._isTransformed && !this._isTransforming && !this._castActive
            && !controlled && this._spellCooldown <= 0 && this._canCastAt(this.target)) {
            this._startDruidCast(this.target);
        }

        // ZombieDog 的速度状态机不认识施法态；基类更新后重新锁回攻击母版。
        if (this._castActive) this._animState = 'attack';
        else if (this._isTransforming) this._animState = 'idle';

        // 普攻命中/失效后立即清掉一次性暴击结果，绝不污染下一次攻击。
        if (this._forcedHitCritical !== undefined && !this._pendingThrust?.active) {
            delete this._forcedHitCritical;
        }
    }

    _applyDruidBody() {
        const druidRender = this._transformCfg.druidRender || {};
        this.collisionRadius = druidRender.collisionRadius ?? 30;
        this.groundRadius = this.collisionRadius;
        this.collisionWidth = druidRender.collisionWidth ?? 57.5;
        this.collisionHeight = druidRender.collisionHeight ?? 158.8;
        this.collisionBodyHeight = this.collisionHeight;
        this._hitboxOverride = {
            width: this.collisionWidth,
            height: this.collisionHeight,
            offsetX: 0,
            bottom: 0,
        };
        if (this.collider) {
            this.collider.radius = this.collisionRadius;
            this.collider.height = this.collisionHeight;
            this.collider.syncPosition();
        }
        const body = this._phaserSprite?.body;
        if (body && typeof body.setSize === 'function') {
            body.setSize(this.collisionWidth, this.collisionHeight);
        }
        const castRange = this._spellCfg.castRange ?? 720;
        this.attackRange = castRange;
        this.attackDistance = castRange;
        this._usesDirectedBasicMelee = false;
        this._attackDuration = this.config?.textures?.druid?.frameLayouts?.attacking?.duration ?? 1000;
    }

    _applyBearTransform() {
        const multiplier = this._transformCfg.statMultiplier ?? 1.5;
        for (const key of ['str', 'dex', 'con', 'int', 'wis', 'luck', 'atk', 'def', 'matk', 'mdef', 'crit', 'critRes']) {
            if (typeof this.data?.[key] === 'number') {
                this.data[key] = Math.round(this.data[key] * multiplier);
            }
        }
        this.maxHp = Math.max(1, Math.round(this.maxHp * multiplier));
        this.data.maxHp = this.maxHp;
        if (this._transformCfg.healToFull !== false) this.hp = this.maxHp;
        this.data.hp = this.hp;
        for (const key of ['speed', 'maxSpeed', '_baseSpeed']) {
            if (typeof this[key] === 'number' && this[key] > 0) this[key] *= multiplier;
        }
        this.data.crit = (this._transformCfg.criticalChance ?? 0.5) * 100;

        const bearRender = this.config?.render || {};
        this.collisionRadius = this.config?.collisionRadius ?? 45;
        this.groundRadius = this.collisionRadius;
        this.collisionWidth = bearRender.collisionWidth ?? 132;
        this.collisionHeight = bearRender.collisionHeight ?? 82;
        this.collisionBodyHeight = this.collisionHeight;
        this._hitboxOverride = {
            width: this.collisionWidth,
            height: this.collisionHeight,
            offsetX: 0,
            bottom: 0,
        };
        if (this.collider) {
            this.collider.radius = this.collisionRadius;
            this.collider.height = this.collisionHeight;
            this.collider.syncPosition();
        }
        const body = this._phaserSprite?.body;
        if (body && typeof body.setSize === 'function') {
            body.setSize(this.collisionWidth, this.collisionHeight);
        }
        this.attackRange = this.config?.attackRange ?? 220;
        this.attackDistance = this.config?.attackDistance ?? this.attackRange;
        this._usesDirectedBasicMelee = true;
        this._attackDuration = this.config?.textures?.frameLayouts?.attack?.duration ?? 950;
        this._animState = 'idle';
        this._animStateTimer = 0;
    }

    _canCastAt(target) {
        if (!target?.active || !target.hittable || target._faction === 'enemy') return false;
        const range = this._spellCfg.castRange ?? 720;
        return Math.hypot(target.x - this.x, target.y - this.y) <= range
            && hasRangedLineOfSight(this, target);
    }

    _selectNextDruidSpell() {
        const cooldownFields = {
            iceSpike: '_iceSpikeCooldown',
            lightningStrike: '_lightningStrikeCooldown',
            fireball: '_fireballCooldown',
        };
        for (let offset = 0; offset < this._spellCycle.length; offset++) {
            const index = (this._spellIndex + offset) % this._spellCycle.length;
            const spell = this._spellCycle[index];
            const field = cooldownFields[spell];
            if (!field || (Number(this[field]) || 0) > 0) continue;
            this._spellIndex = (index + 1) % this._spellCycle.length;
            return spell;
        }
        return null;
    }

    _startDruidCast(target) {
        const spell = this._selectNextDruidSpell();
        if (!spell) return;
        const duration = this._spellCfg.castDuration ?? 1000;
        this._castActive = true;
        this._castTimer = duration;
        this._castReleased = false;
        this._pendingSpell = spell;
        this._pendingSpellTarget = target;
        this._spellCooldown = this._spellCfg.cooldown ?? 1800;
        this._frozenForCast = true;
        this._animState = 'attack';
        this._animStateTimer = 0;
        this._attackTimer = duration;
        this._animFrame = 0;
        this._animTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.target = target;
        this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
        this._lastHorizontalFacing = target.x < this.x ? 'left' : 'right';
    }

    _updateDruidCast(dt, entities) {
        const duration = this._spellCfg.castDuration ?? 1000;
        this._castTimer = Math.max(0, this._castTimer - dt);
        const releaseRatio = Math.max(0, Math.min(1, this._spellCfg.releaseRatio ?? 0.56));
        if (!this._castReleased && duration - this._castTimer >= duration * releaseRatio) {
            this._castReleased = true;
            this._releaseDruidSpell(entities);
        }
        this._frozenForCast = true;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._castTimer <= 0) {
            this._cancelDruidCast();
        }
    }

    _releaseDruidSpell(_entities) {
        const target = this._pendingSpellTarget;
        if (!this._canCastAt(target)) return;
        this.target = target;
        if (this._pendingSpell === 'iceSpike') {
            this._iceSpikeSystem.trigger();
            this._iceSpikeSystem.trigger();
        } else if (this._pendingSpell === 'lightningStrike') {
            this._lightningStrikeSystem.trigger();
        } else if (this._pendingSpell === 'fireball') {
            this._fireballSystem.trigger();
            this._fireballSystem.trigger();
        }
    }

    _cancelDruidCast() {
        this._castActive = false;
        this._castTimer = 0;
        this._castReleased = false;
        this._pendingSpell = null;
        this._pendingSpellTarget = null;
        this._frozenForCast = false;
        if (!this._isTransforming) this._animState = 'idle';
    }

    triggerWeaponAnim() {
        if (this._isTransforming || !this._isTransformed) {
            if (this._pendingThrust) this._pendingThrust.active = false;
            return;
        }
        const attackAlreadyPlaying = this._attackTimer > 0;
        super.triggerWeaponAnim();
        if (attackAlreadyPlaying) return;
        if (!this._pendingThrust?.active) {
            delete this._forcedHitCritical;
            return;
        }
        const isCritical = Math.random() < (this._transformCfg.criticalChance ?? 0.5);
        this._forcedHitCritical = isCritical;
        if (!isCritical) return;
        const multiplier = this._transformCfg.criticalDamageMultiplier ?? 2.5;
        this._pendingThrust.damage.min *= multiplier;
        this._pendingThrust.damage.max *= multiplier;
    }

    takeDamage(damage, source, damageType = 'physical', isMelee = true, hitContext = null) {
        if (this._isTransforming) {
            const reduction = this._transformCfg.damageReduction ?? 0.9;
            damage = Math.max(0, Math.round(damage * (1 - reduction)));
        }
        return super.takeDamage(damage, source, damageType, isMelee, hitContext);
    }

    _getDeathConfig() {
        if (!this._isTransformed) return this._transformCfg.druidDeath || {};
        return super._getDeathConfig();
    }

    onDeath(source) {
        this._isTransforming = false;
        this._transformTimer = 0;
        this._frozenForCast = true;
        this._cancelPhaseActions();
        this._frozenForCast = true;
        super.onDeath(source);
    }

    _getFrameLayout(state = this._animState) {
        if (this._isTransforming) {
            const layouts = this.config?.textures?.transformations?.frameLayouts || {};
            return layouts.toBear || {
                frameWidth: 768,
                frameHeight: 512,
                frameCount: 20,
                footY: 500,
            };
        }
        if (this._isTransformed) {
            return super._getFrameLayout(this._getBlackBearVisualState(state));
        }
        {
            const layouts = this.config?.textures?.druid?.frameLayouts || {};
            const visualState = this._getBlackDruidVisualState(state);
            return layouts[visualState] || layouts.idle || {
                frameWidth: 512,
                frameHeight: 512,
                frameCount: 1,
                footY: 489,
            };
        }
    }

    _getTextureKey() {
        if (this._isTransforming) {
            return 'enemy_black_bear_transform_toBear';
        }
        if (this._isTransformed) {
            return `enemy_black_bear_${this._getBlackBearVisualState()}`;
        }
        return `enemy_black_druid_${this._getBlackDruidVisualState()}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        if (this._isTransforming) {
            options.animState = 'toBear';
            options.animKey = 'enemy_black_bear_transform_toBear_v1';
            options.dynamicSpriteSize = true;
            return options;
        }
        if (this._isTransformed) {
            const visualState = this._getBlackBearVisualState();
            options.animState = visualState;
            options.animKey = `enemy_black_bear_${visualState}_v1`;
            return options;
        }
        {
            const visualState = this._getBlackDruidVisualState();
            const layout = this._getFrameLayout();
            const druidTextures = this.config?.textures?.druid || {};
            const referenceCell = druidTextures.referenceCell ?? 512;
            const frameWidth = layout.frameWidth ?? referenceCell;
            const frameHeight = layout.frameHeight ?? referenceCell;
            const render = this._transformCfg.druidRender || {};
            const baseSpriteSize = render.spriteSize ?? 167.3;
            const pixelScale = baseSpriteSize / referenceCell;
            options.spriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
            options.collisionWidth = render.collisionWidth ?? 57.5;
            options.collisionHeight = render.collisionHeight ?? 158.8;
            options.textOffsetY = -baseSpriteSize / 2 - 10;
            options.animState = this._animState;
            options.animKey = `enemy_black_druid_${visualState}_v1`;
            options.dynamicSpriteSize = true;
            this.footOffsetY = ((layout.footY ?? frameHeight) - frameHeight / 2) * pixelScale;
            return options;
        }
    }
}

function createBlackBear(x, y, overrides = {}) {
    const base = enemyConfigData.blackBear || {};
    const baseTextures = base.textures || {};
    const overrideTextures = overrides.textures || {};
    return new BlackBearEnemy(x, y, {
        ...overrides,
        ai: { ...(base.ai || {}), ...(overrides.ai || {}) },
        textures: {
            ...baseTextures,
            ...overrideTextures,
            frameLayouts: {
                ...(baseTextures.frameLayouts || {}),
                ...(overrideTextures.frameLayouts || {}),
            },
        },
    });
}

export { BlackWolf, RedWolfKing, CircleEnemy, ZombieDogEnemy, createZombieDog, BrownBearEnemy, createBrownBear, EvilTreantEnemy, createEvilTreant, PurpleBlightAncientEnemy, createPurpleBlightAncient, CarnivorousPitcherEnemy, createCarnivorousPitcher, BrownSnakeEnemy, createBrownSnake, SwampVampireMosquitoEnemy, createSwampVampireMosquito, BlackKingCobraEnemy, createBlackKingCobra, MedusaEnemy, createMedusa, WerewolfKingEnemy, createWerewolfKing, BlackBearEnemy, createBlackBear, ZombieWizard, Mutant3, SpitterZombie, FatZombie, Zombie, AmalgamZombie, ArmoredKnight, Shounao, FlySwarm, FlyHand, TimeAgentAssault, TimeAgentShield, PoisonMaggot, MinerZombie, LanternMinerZombie, BombZombie, SupportBeamBrute, CoreDrillWorm, ForemanZombie, MineCave, Tombstone, OreSpider, Witch, Cauldron };
