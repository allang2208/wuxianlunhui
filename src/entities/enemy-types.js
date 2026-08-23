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
import { ForemanZombie } from './enemy-types/foreman-zombie.js';
import { MineCave } from './enemy-types/mine-cave.js';
import { Tombstone } from './enemy-types/tombstone.js';
import { OreSpider } from './enemy-types/ore-spider.js';
import { Witch } from './enemy-types/witch.js';
import { Cauldron } from './enemy-types/cauldron.js';

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
 * - 攻击与飞扑使用 640 格，运行时按 512 基准归一化显示尺寸与脚底；
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
        // 首尾帧视频导出的 20 帧序列，不复用已经退出运行时的旧狼人资产。
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
            howl: loadImage(spritePaths.werewolfHowl || 'assets/enemies/red_wolf_king/werewolf_howling.png'),
            dying: loadImage(spritePaths.werewolfDying || 'assets/enemies/red_wolf_king/werewolf_dying.png'),
        };
        this._sprites = this._wolfSprites;
        // 二阶段配置：全属性强化、变身减伤和专属暴击，完成后切入狼人五动作。
        this._transformCfg = this._animCfg.transform || {};
        this._werewolfVisualScaleTarget = this._transformCfg.werewolfVisualScale ?? 1.25;
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
        // 变身期完整播放20帧；完成后保留 BlackWolf 的真实 idle/run/attack 状态，
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
        // 二阶段只使用狼人普通攻击与嚎叫；狼人没有飞扑母版，也不再进入狼形飞扑状态。
        this._usesPounce = false;
        this._pounceCooldown = 0;
        // 运行时面板同步显示二阶段的真实暴击率；伤害倍率在专属命中入口结算。
        this.data.crit = (this._transformCfg.criticalChance ?? 0.5) * 100;
    }

    // 变身期减伤（默认 90%，transform.damageReduction 可配）：
    // 在暴击计算前先砍掉伤害，让变身动画期间站着挨打也站得住。
    takeDamage(damage, source, damageType = 'physical', _isMelee = true) {
        if (this._isTransforming) {
            const reduction = this._transformCfg?.damageReduction ?? 0.9;
            damage = Math.max(0, Math.round(damage * (1 - reduction)));
        }
        return super.takeDamage(damage, source, damageType, _isMelee);
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
        if (!this.active || this._deathStarted || this._isTransforming || this._isTransformed || this._howlTimer > 0) return;
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
            ? (this._frameLayouts?.werewolfDying || { cols: 5, rows: 4, frames: 20 })
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
            if (this._animState === 'attack') return 'enemy_red_wolf_king_werewolf_attack';
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
            ? (layouts.werewolfDying || { cols: 5, rows: 4, frames: 20, frameWidth: 640, frameHeight: 640, footY: 590 })
            : (layouts.dying || { cols: 4, rows: 3, frames: 12 });
        if (this._isTransforming || state === 'transform') {
            return layouts.transform || { cols: 5, rows: 4, frames: 20, frameWidth: 640, frameHeight: 640, footY: 590 };
        }
        if (this._isTransformed) {
            if (this._isAnimationFrozen() || state === 'idle' || this._animState === 'idle') {
                return layouts.werewolfIdle || { cols: 5, rows: 4, frames: 20, frameWidth: 640, frameHeight: 640, footY: 590 };
            }
            if (this._howlTimer > 0 || state === 'howl' || this._animState === 'howl') {
                return layouts.werewolfHowl || { cols: 5, rows: 4, frames: 20, frameWidth: 640, frameHeight: 640, footY: 590 };
            }
            if (this._animState === 'attack') {
                return layouts.werewolfAttack || { cols: 6, rows: 4, frames: 21, frameWidth: 640, frameHeight: 640, footY: 590 };
            }
            return layouts.werewolfRun || { cols: 8, rows: 6, frames: 12, frameWidth: 640, frameHeight: 640, footY: 606 };
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
        // 普通攻击素材各帧水平内容中心漂移较大；只在咬击阶段启用逐帧 X 校正。
        // 飞扑保留真实位移与素材自身动态，不复用这组偏移。
        if (!this._isTransformed && this._animState === 'attack' && this._attackType === 'bite') {
            opts.frameOffsetKey = 'enemy_red_wolf_king_attack';
        }
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
            else if (this._animState === 'attack') werewolf = this._werewolfSprites.attack;
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
        this._lastHorizontalFacing = 'right';
        // [FIX] 僵尸犬攻击动画时长，与 BootScene 中 zombie_dog_attack 动画匹配
        // 6 帧 @ 10fps = 600ms
        this._attackDuration = 600;
    }

    update(dt, entities) {
        super.update(dt, entities);
        // 递减攻击动画计时器；计时器归零后不再显示 attack 动画
        if (this._attackTimer > 0) {
            this._attackTimer -= dt;
            if (this._attackTimer < 0) this._attackTimer = 0;
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
    }

    /**
     * 僵尸犬攻击动画触发入口。
     * 只在 CombatSystem 真正触发攻击后调用；若当前仍处于上一段 attack 动画（600ms）中，
     * 则忽略重复触发，因此不会以 600ms 为周期循环播放攻击动画。
     */
    triggerWeaponAnim() {
        if (this._attackTimer > 0) return;
        super.triggerWeaponAnim();
        this._attackTimer = this._attackDuration || 600;
        this._animFrame = 0;
        this._animTimer = 0;
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'attack': return 'enemy_zombie_dog_attack';
            case 'run':    return 'enemy_zombie_dog_run';
            case 'walk':   return 'enemy_zombie_dog_walk';
            default:       return 'enemy_zombie_dog_idle';
        }
    }

    _getPhaserOptions() {
        const spriteSize = 90;
        return {
            spriteSize,
            textOffsetY: -spriteSize / 2 - 10,
            flipX: this._lastHorizontalFacing === 'left',
            animState: this._animState
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

export { BlackWolf, RedWolfKing, CircleEnemy, ZombieDogEnemy, createZombieDog, ZombieWizard, Mutant3, SpitterZombie, FatZombie, Zombie, AmalgamZombie, ArmoredKnight, Shounao, FlySwarm, FlyHand, TimeAgentAssault, TimeAgentShield, PoisonMaggot, MinerZombie, LanternMinerZombie, ForemanZombie, MineCave, Tombstone, OreSpider, Witch, Cauldron };
