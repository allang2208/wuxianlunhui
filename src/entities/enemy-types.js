import { WallSystem } from '../world/wall-system.js';
import { Enemy } from './enemy.js';
import { distanceToEntityShape } from '../utils/collision-helpers.js';
import { canMeleeShareSurface } from '../combat/melee-surface.js';
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
                if (this.target && this.target.active) {
                    this._facing = this.target.x >= this.x ? 'right' : 'left';
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
                // bite 触发与命中同口径（边缘距 ≤ biteRange），避免"触发严格于命中"的空窗
                if (this._biteCooldown <= 0 && hasLOS && this._isTargetInRange(this.target, this.config?.biteRange ?? 150)) {
                    this._startBite();
                    return;
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

    // 飞扑冲锋阶段：锁方向位移 + 命中检测 + 残影（红狼王共享，参照 mutant-3）
    _updatePounceCharge(dt) {
        const dtSec = dt / 1000;
        this._facing = this._pounceDir.x >= 0 ? 'right' : 'left';
        this._lastHorizontalFacing = this._facing;
        this._facingDir = this._facing;
        this._animState = 'attack';

        // 向终点移动（穿过目标 overshoot 或最远 maxDist），冲锋阶段固定 1 秒
        const distToEnd = this._pounceTargetPos
            ? Math.hypot(this._pounceTargetPos.x - this.x, this._pounceTargetPos.y - this.y)
            : 0;
        if (distToEnd > 10 && this._pounceSpeed > 0) {
            const step = Math.min(this._pounceSpeed * dtSec, distToEnd);
            const nextX = this.x + this._pounceDir.x * step;
            const nextY = this.y + this._pounceDir.y * step;
            const resolved = WallSystem.resolve(this.x, this.y, nextX, nextY, this.groundRadius);
            this.x = resolved.x;
            this.y = resolved.y;
        }

        // 命中检测（飞扑专用判定距离 pounceHitDistance）
        const hitTarget = this._pounceTarget && this._pounceTarget.active ? this._pounceTarget : this.target;
        if (!this._pounceDamaged && hitTarget && hitTarget.active && hitTarget.hittable) {
            if (this._isTargetInRange(hitTarget, this.config?.pounceHitDistance ?? 100)
                && canMeleeShareSurface(this, hitTarget)) {
                hitTarget.takeDamage(this._getPounceDamage(), this, 'physical', true);
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

        // 冲锋速度线条（色块链风格，参考 LightningBoltEffect；替代残影）
        this._pounceGhostTimer -= dt;
        if (this._pounceGhostTimer <= 0) {
            this._spawnSpeedLine();
            this._pounceGhostTimer = 80;
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
                // 普通撕咬：6 帧匀速推进（100ms/帧）
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
    _startBite() {
        if (this._biteState !== 'idle') return;
        this._biteState = 'attacking';
        this._animState = 'attack';
        this._frozenForCast = true; // 攻击期间锁定移动（防边攻击边漂移）
        this._biteTimer = this._attackTypes?.bite?.durationMs ?? 600;
        this._biteCooldown = this.config?.biteCooldown ?? 1200;
        this._biteTarget = this.target;
        this._biteDamaged = false;
        this._animFrame = 0;
        this._animTimer = 0;
        if (this.target && this.target.active) {
            this._facing = this.target.x >= this.x ? 'right' : 'left';
            this._lastHorizontalFacing = this._facing;
        }
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
            const t = this._biteTarget && this._biteTarget.active ? this._biteTarget : this.target;
            if (t && t.active && t.hittable
                && this._isTargetInRange(t, this.config?.biteHitDistance ?? 90)
                && canMeleeShareSurface(this, t)) {
                t.takeDamage(this._getBiteDamage(), this, 'physical', true);
                this._biteDamaged = true;
            }
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
        this._biteDamaged = false;
        this._animState = 'idle';
        this._animFrame = 0;
    }

    _getBiteDamage() {
        // 普通撕咬：物理攻击基础伤害（无致残/眩晕附加）
        return this.data.atk || this.data.str || 20;
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
        this._pounceGhostTimer = 0;
        this._pounceDamaged = false;

        const maxDist = this.config?.pounceMaxDist ?? 1000;
        const overshoot = this.config?.pounceOvershoot ?? 200;
        const target = this._pounceTarget && this._pounceTarget.active ? this._pounceTarget : this.target;
        if (target && target.active) {
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
                this._pounceDir = { x: dx / dist, y: dy / dist };
                const clamped = Math.min(dist + overshoot, maxDist);
                this._pounceTargetPos = {
                    x: this.x + this._pounceDir.x * clamped,
                    y: this.y + this._pounceDir.y * clamped
                };
                this._pounceChargeDistance = clamped;
            } else {
                this._pounceDir = { x: 1, y: 0 };
                this._pounceTargetPos = { x: this.x + Math.min(overshoot, maxDist), y: this.y };
                this._pounceChargeDistance = Math.min(overshoot, maxDist);
            }
        } else {
            this._pounceDir = { x: 1, y: 0 };
            this._pounceTargetPos = { x: this.x + Math.min(overshoot, maxDist), y: this.y };
            this._pounceChargeDistance = Math.min(overshoot, maxDist);
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
        this._pounceGhostTimer = 0;
        this._pounceTargetPos = null;
        this._pounceDamaged = false;
        this._pounceTarget = null;
        this._animState = 'idle';
        this._animFrame = 0;
    }

    _getPounceDamage() {
        // 飞扑只造成一次等于物理攻击的伤害（参照 mutant-3）
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

    // 冲锋速度线条：狼身后沿反方向拖出短色块链（参考 LightningBoltEffect 的
    // 圆块辉光风格——线条感强于纯粒子、柔于纯线条，折中方案）
    _spawnSpeedLine() {
        const scene = window.__phaserScene;
        if (!scene || !this._pounceDir) return;
        const dirX = -this._pounceDir.x; // 反方向 = 狼身后
        const dirY = -this._pounceDir.y;
        const len = 55 + Math.random() * 35;
        const perp = Math.random() < 0.5 ? -1 : 1; // 上下随机偏移，避免整齐呆板
        const off = 6 + Math.random() * 10;
        const sx = this.x + dirX * 25 + (-dirY * perp * off);
        const sy = this.y + dirY * 25 + (dirX * perp * off);
        const n = 6;
        const life = { t: 0, max: 170 };
        const g = scene.add.graphics();
        g.setBlendMode('ADD');
        const spriteDepth = this._phaserSprite ? this._phaserSprite.depth : 0;
        g.setDepth(spriteDepth + 1);
        if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(g);
        const onUpdate = () => {
            life.t += 16;
            const p = Math.max(0, 1 - life.t / life.max);
            g.clear();
            for (let i = 0; i < n; i++) {
                const f = i / (n - 1);
                const x = sx + dirX * len * f;
                const y = sy + dirY * len * f;
                const r = Math.max(1, (4.5 - 2 * f) * p);
                g.fillStyle(0xffffff, 0.65 * p);
                g.fillCircle(x, y, r + 2); // 外层辉光
                g.fillStyle(0x9fd4ff, 0.85 * p);
                g.fillCircle(x, y, r); // 内芯
            }
            if (life.t >= life.max) {
                g.destroy();
                scene.events.off('update', onUpdate);
            }
        };
        scene.events.on('update', onUpdate);
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
 * 红狼王（elite，2026-08-06 贴图升级重建，H3 视频→精灵图管线）：
 * - 狼形态：idle / walk / run + 双攻击（飞扑挥爪 pounceClaw / 飞扑撕咬 pounceBite）+ 变身 transform；
 * - HP ≤ 阈值（默认 0.5）触发变身：2s transform 动画 → 红狼人形态（伤害 ×2、回血），
 *   变身完成先仰天嚎叫（howl）；
 * - 红狼人形态：idle / run / 挥爪攻击 attack / 嚎叫 howl；
 * - 动画走 Phaser setFrame 帧索引路径（同黑狼），贴图/网格由 animation-config redWolfKing 驱动。
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
        const tPaths = this._animCfg.transformedSprites || {};
        // 帧网格/帧率必须重取红狼王自己的配置：BlackWolf 构造器已按 blackWolf 配置
        // 填过 _frameLayouts/_frameDurations，不重取会导致 attack 帧数落回黑狼表
        // （pounceClaw/pounceBite 键不存在 → 兜底 8 帧，撕咬只播前 8 帧、扑咬爆发段永远放不出来）。
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
        // 狼形态贴图
        this._wolfSprites = {
            side: loadImage(spritePaths.side || 'assets/enemies/red_wolf_king_run.png'),
            walk: loadImage(spritePaths.walk || 'assets/enemies/red_wolf_king_pacing.png'),
            run: loadImage(spritePaths.run || 'assets/enemies/red_wolf_king_run.png'),
            pounceClaw: loadImage(spritePaths.pounceClaw || 'assets/enemies/red_wolf_king_pounce_claw.png'),
            pounceBite: loadImage(spritePaths.pounceBite || 'assets/enemies/red_wolf_king_pounce_bite.png'),
            pacing: loadImage(spritePaths.pacing || 'assets/enemies/red_wolf_king_pacing.png'),
            idle: loadImage(spritePaths.idle || 'assets/enemies/red_wolf_king_idle.png'),
            transform: loadImage(spritePaths.transform || 'assets/enemies/red_wolf_king_change.png'),
            howl: loadImage(spritePaths.howl || 'assets/enemies/red_wolf_king_howl.png'),
        };
        // 红狼人形态贴图
        this._humanSprites = {
            idle: loadImage(tPaths.idle || 'assets/enemies/red_wolf_king_transformed_idle.png'),
            run: loadImage(tPaths.run || tPaths.side || 'assets/enemies/red_wolf_king_changed_run.png'),
            attack: loadImage(tPaths.attack || 'assets/enemies/red_wolf_king_changed_attack.png'),
            howl: loadImage(tPaths.howl || 'assets/enemies/red_wolf_king_changed_howl.png'),
        };
        this._sprites = this._wolfSprites;
        // 变身配置
        this._transformCfg = this._animCfg.transform || {};
        this._isTransforming = false;
        this._isTransformed = false;
        this._transformTriggered = false;
        this._transformTimer = 0;
        this._howlTimer = 0;
        // 狼形态双攻击（近咬 / 中距离飞扑挥爪）
        this._attackTypes = anim.attackTypes || {
            pounceClaw: { range: 210, duration: 1100, dash: 220 },
            pounceBite: { range: 170, duration: 1000, dash: 60 },
        };
        this._attackType = 'pounceBite';
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
        this._pounceGhostTimer = 0;
        // 嚎叫技能（红狼人形态主动释放，给场上全体怪物激励 30s）
        this._howlCd = 0;
    }

    update(dt, entities) {
        // 变身触发：HP 阈值
        if (!this._transformTriggered && this.maxHp > 0 && this.hp / this.maxHp <= (this._transformCfg.hpThreshold ?? 0.5)) {
            this._transformTriggered = true;
            this._isTransforming = true;
            this._transformTimer = this._transformCfg.duration ?? 2000;
        }
        if (this._isTransforming) {
            this.vx = 0;
            this.vy = 0;
            // 变身期不可移动、不可攻击：先终止进行中的撕咬/飞扑（_endBite/_endPounce 会清
            // _frozenForCast），再锁移动，避免变身期间边漂移边咬人。
            if (this._biteState === 'attacking') this._endBite();
            if (this._pounceState !== 'idle') this._endPounce();
            this._frozenForCast = true;
            this._transformTimer -= dt;
            if (this._transformTimer <= 0) {
                this._isTransforming = false;
                this._isTransformed = true;
                this._frozenForCast = false;
                this._applyTransform();
                // 变身完成不再自动嚎叫（原逻辑自动接红狼嚎叫动画，用户反馈
                // "变身有重复动画、变身完还有嚎叫"）——嚎叫改为独立技能，
                // 由红狼人形态 AI 主动释放（见 _startHowl）。
                this._howlTimer = 0;
                // 首次嚎叫延迟：避免变身动画后立即接嚎叫（视觉重复），
                // 先正常行动 5s 再释放技能；后续按 cooldown 30s 循环。
                this._howlCd = Math.min(this._getHowlConfig().cooldown ?? 30000, 5000);
            }
        }
        if (this._howlTimer > 0) {
            this._howlTimer -= dt;
            this.vx = 0;
            this.vy = 0;
            // 嚎叫期同锁移动/禁攻击（变身流程的延续）
            if (this._biteState === 'attacking') this._endBite();
            if (this._pounceState !== 'idle') this._endPounce();
            this._frozenForCast = true;
            if (this._howlTimer <= 0) this._frozenForCast = false;
        }
        super.update(dt, entities);
        // 嚎叫技能冷却递减
        if (this._howlCd > 0) this._howlCd -= dt;
        // 嚎叫技能触发：红狼人形态 + 冷却就绪 + 有目标 + 无进行中攻击/变身/嚎叫
        // （_attackType 初始即 'pounceBite' 且不随咬/扑结束重置，不能用它判断空闲，
        //   改看 _biteState/_pounceState）
        if (this._isTransformed && this._howlCd <= 0 && this.target && this.target.active
            && this._biteState === 'idle' && this._pounceState === 'idle'
            && !this._isTransforming && this._howlTimer <= 0) {
            this._startHowl(entities);
        }
        // 覆盖动画状态：变身/嚎叫期间锁定
        if (this._isTransforming) {
            this._animState = 'transform';
            this._animFrame = this._timerFrame(this._transformTimer, this._transformCfg.duration ?? 2000);
        } else if (this._howlTimer > 0) {
            this._animState = 'howl';
            const howlTotal = this._getHowlConfig().duration ?? 3000;
            this._animFrame = this._timerFrame(this._howlTimer, howlTotal);
        }
        // 红狼人形态切换贴图组
        this._sprites = this._isTransformed ? this._humanSprites : this._wolfSprites;
    }

    _getHowlConfig() {
        return this.config?.attackSkills?.howl || {};
    }

    // 嚎叫技能：3s 动画 + 锁定，释放后场上全体敌方怪物获得激励 buff
    // （参照 foreman-zombie _startHowl；激励 = 移速×speedMul、物攻×atkMul）
    _startHowl(entities) {
        const cfg = this._getHowlConfig();
        const duration = cfg.duration ?? 3000;
        // 终止进行中的咬/扑，避免嚎叫动画与攻击重叠
        if (this._biteState === 'attacking') this._endBite();
        if (this._pounceState !== 'idle') this._endPounce();
        this._howlTimer = duration;
        this._howlCd = cfg.cooldown ?? 30000;
        this._animState = 'howl';
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

    _applyTransform() {
        // 伤害 ×2（transform.damageMultiplier）
        const atk = this.attacks && this.attacks.melee;
        if (atk && atk.config && atk.config.damage) {
            const d = atk.config.damage;
            atk.config.damage = typeof d === 'object'
                ? { min: (d.min || 0) * 2, max: (d.max || 0) * 2 }
                : (typeof d === 'number' ? d * 2 : d);
        }
        // 回血（hpRecover 比例，1=回满）
        const recover = this._transformCfg.hpRecover ?? 0;
        if (recover && this.maxHp) {
            this.hp = Math.min(this.maxHp, this.hp + this.maxHp * recover);
        }
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

    // 狼形态双攻击绑定：黑狼状态机的 _startBite/_startPounce 不会设置 _attackType，
    // 导致 pounceClaw（远/飞扑挥爪）永远播不出来、近咬也错播成 pounce_bite。
    // 这里把 近距离撕咬 → pounceBite、中距离飞扑 → pounceClaw，贴图/网格随之正确切换。
    _startBite() {
        // 嚎叫技能进行中禁止撕咬（避免嚎叫期黑狼 AI 又触发 bite）
        if (this._howlTimer > 0) return;
        this._attackType = 'pounceBite';
        super._startBite();
    }

    _startPounce() {
        // 嚎叫技能进行中禁止飞扑
        if (this._howlTimer > 0) return;
        this._attackType = 'pounceClaw';
        super._startPounce();
    }

    // 撕咬 1.2s（12 帧 @100ms/帧），伤害判定落在扑咬爆发段（约 42%~75% 时长，对应帧 5~9），
    // 避免命中落在蓄力前段。
    _updateBite(dt) {
        this._biteTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this._animState = 'attack';
        if (this._biteTarget && this._biteTarget.active) {
            this._facing = this._biteTarget.x >= this.x ? 'right' : 'left';
            this._lastHorizontalFacing = this._facing;
        }
        const duration = this._attackTypes?.bite?.durationMs ?? 600;
        const elapsed = duration - this._biteTimer;
        const hitStart = Math.round(duration * 0.42);
        const hitEnd = Math.round(duration * 0.75);
        if (!this._biteDamaged && elapsed >= hitStart && elapsed <= hitEnd) {
            const t = this._biteTarget && this._biteTarget.active ? this._biteTarget : this.target;
            if (t && t.active && t.hittable
                && this._isTargetInRange(t, this.config?.biteHitDistance ?? 100)
                && canMeleeShareSurface(this, t)) {
                t.takeDamage(this._getBiteDamage(), this, 'physical', true);
                this._biteDamaged = true;
            }
        }
        if (this._biteTimer <= 0) {
            this._endBite();
        }
    }

    _getTextureKey() {
        const frozen = this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'));
        if (this._isTransforming) return 'enemy_red_wolf_king_change';
        if (this._isTransformed) {
            if (frozen) return 'enemy_red_wolf_king_transformed_idle';
            if (this._howlTimer > 0) return 'enemy_red_wolf_king_changed_howl';
            if (this._animState === 'attack') return 'enemy_red_wolf_king_changed_attack';
            if (this._animState === 'run') return 'enemy_red_wolf_king_changed_run';
            return 'enemy_red_wolf_king_transformed_idle';
        }
        if (frozen) return 'enemy_red_wolf_king_idle';
        if (this._animState === 'attack') {
            return this._attackType === 'pounceClaw'
                ? 'enemy_red_wolf_king_pounce_claw'
                : 'enemy_red_wolf_king_pounce_bite';
        }
        if (this._animState === 'pacing') return 'enemy_red_wolf_king_pacing';
        if (this._animState === 'run') return 'enemy_red_wolf_king_run';
        if (this._animState === 'idle') return 'enemy_red_wolf_king_idle';
        return 'enemy_red_wolf_king_pacing';
    }

    _getFrameLayout(state) {
        const layouts = this._frameLayouts || {};
        if (this._isTransformed) {
            const tf = this._animCfg?.render?.transformedFrameLayout || {};
            const key = state === 'attack' ? 'attack' : state;
            return tf[key] || { cols: 4, rows: 2, frames: 8 };
        }
        if (this._animState === 'transform') return layouts.transform || { cols: 4, rows: 2, frames: 8 };
        if (this._animState === 'howl') return layouts.howl || { cols: 4, rows: 2, frames: 8 };
        if (this._animState === 'attack') {
            return layouts[this._attackType] || layouts.pounceBite || { cols: 4, rows: 2, frames: 8 };
        }
        return super._getFrameLayout(state);
    }

    _getStateFrameCount() {
        const layouts = this._frameLayouts || {};
        if (this._isTransformed) {
            const tf = this._animCfg?.render?.transformedFrameLayout || {};
            const key = this._animState === 'attack' ? 'attack' : this._animState;
            return (tf[key] && tf[key].frames) || (tf[key] && tf[key].cols * tf[key].rows) || 8;
        }
        if (this._animState === 'transform') return (layouts.transform && layouts.transform.frames) || 8;
        if (this._animState === 'howl') return (layouts.howl && layouts.howl.frames) || 8;
        if (this._animState === 'attack') {
            return (layouts[this._attackType] && layouts[this._attackType].frames) || 8;
        }
        return super._getStateFrameCount();
    }

    // 红狼人形态独立显示尺寸：狼形态 151，红狼人按 render.transformedSpriteSize
    // （默认 200，比狼更魁梧；Phaser 纹理切换时会按此重算 displaySize）。
    _getPhaserOptions() {
        const opts = super._getPhaserOptions();
        if (this._isTransformed) {
            // 默认 200；JSON 里 render.transformedSpriteSize 可覆盖
            // （vite 对 data/*.json 的模块缓存可能滞后，代码兜底保证生效）
            opts.spriteSize = this._animCfg?.render?.transformedSpriteSize ?? 200;
        }
        return opts;
    }

    _drawBody(ctx) {
        if (this._isTransforming) {
            this._drawSheetFrame(ctx, this._wolfSprites.transform, this._frameLayouts.transform);
            return;
        }
        if (this._howlTimer > 0 && this._isTransformed) {
            this._drawSheetFrame(ctx, this._humanSprites.howl, this._frameLayouts.howl);
            return;
        }
        if (this._animState === 'attack') {
            // Canvas 兜底路径：黑狼 _drawBody 只认 _sprites.bite/pounce（红狼王没有），
            // 攻击态会掉成火柴人——这里按 _attackType 直接画撕咬/挥爪（狼形态），
            // 红狼人形态画 changed_attack。
            const img = this._isTransformed
                ? this._humanSprites.attack
                : (this._sprites[this._attackType] || this._sprites.pounceBite);
            const layout = this._isTransformed
                ? (this._animCfg?.render?.transformedFrameLayout || {}).attack
                : (this._frameLayouts[this._attackType] || this._frameLayouts.pounceBite);
            const shouldFlip = this._facing === 'left' ||
                ((this._facing === 'up' || this._facing === 'down') && (
                    (Math.abs(this.vx) > 0.1 && this.vx < 0) ||
                    (Math.abs(this.vx) <= 0.1 && this._lastHorizontalFacing === 'left')
                ));
            ctx.save();
            if (shouldFlip) ctx.scale(-1, 1);
            this._drawSheetFrame(ctx, img, layout);
            ctx.restore();
            return;
        }
        super._drawBody(ctx);
    }

    _drawSheetFrame(ctx, img, layout) {
        if (!img || !img.complete || !img.naturalWidth) return;
        const lay = layout || { cols: 4, rows: 2 };
        const frameW = img.naturalWidth / lay.cols;
        const frameH = img.naturalHeight / lay.rows;
        const col = this._animFrame % lay.cols;
        const row = Math.floor(this._animFrame / lay.cols);
        const renderCfg = this._animCfg?.render || {};
        const baseSize = renderCfg.spriteSize ?? 151;
        const spriteSize = this._isTransformed
            ? (renderCfg.transformedSpriteSize ?? 200)
            : baseSize;
        const spriteOffset = (renderCfg.spriteOffset ?? -76) * (spriteSize / baseSize);
        ctx.drawImage(img, col * frameW, row * frameH, frameW, frameH, spriteOffset, spriteOffset, spriteSize, spriteSize);
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
