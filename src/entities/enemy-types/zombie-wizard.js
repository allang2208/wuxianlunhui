import { Enemy } from '../enemy.js';
import { IceSpikeSystem } from '../components/ice-spike-system.js';
import { FireballSystem } from '../components/fireball-system.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { ProjectileFactory } from '../../utils/projectile-factory.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { WallSystem } from '../../world/wall-system.js';
import { AimHelper } from '../../utils/aim-helper.js';
import enemyConfigData from '../../../data/enemy-config.json';

/**
 * 僵尸巫师（精英）
 * AI 循环：冰锥 → 火球 → 等待
 * 额外技能：每 30 秒召唤 3 只僵尸犬
 */
export class ZombieWizard extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.zombieWizard,
            ...config
        });
        this._useStickFigure = false;
        this._castState = 'idle'; // idle | ice | fire | wait
        this._castTimer = 0;
        this._summonCooldown = 0;

        // 初始化冰锥/火球状态字段（与玩家保持一致）
        this._iceSpikeActive = false;
        this._iceSpikeCooldown = 0;
        this._iceSpikeTimer = 0;
        this._iceSpikeSpikes = [];
        this._iceSpikeImg = null;

        this._fireballActive = false;
        this._fireballCooldown = 0;
        this._fireballTimer = 0;
        this._fireball = null;
        this._fireballImg = null;

        // 构造技能对象（与玩家 skills.iceSpike/fireball 结构兼容）
        this.skills = this.skills || {};
        this.skills.iceSpike = this.skills.iceSpike || {
            id: 'iceSpike', name: '冰锥', level: 1,
            getEffect(level) {
                return {
                    damageBase: 30 + level * 5,
                    magicMul: 1.2 + 0.25 * level,
                    intMul: 1.2 + 0.25 * level,
                    cooldown: 10,
                    mpCost: 30,
                    spikeCount: 2 + Math.floor((level - 1) / 5),
                    duration: 30,
                    flySpeed: 1600,
                    maxRange: 800
                };
            }
        };
        this.skills.fireball = this.skills.fireball || {
            id: 'fireball', name: '火球', level: 1,
            getEffect(level) {
                return {
                    damageBase: 80 + level * 10,
                    magicMul: 2 + 0.5 * level,
                    intMul: 2.5 + 0.75 * level,
                    explosionRadius: 80 + level * 5,
                    cooldown: 20,
                    mpCost: 50,
                    duration: 30,
                    flySpeed: 1600,
                    maxRange: 1200
                };
            }
        };

        // 玩家属性兼容（IceSpikeSystem/FireballSystem 会读取 data.matk/data.int）
        this.data.matk = this.data.matk || this.data.int * 1.5;
        this.data.mp = this.data.mp || 9999;
        this.data.maxMp = this.data.maxMp || 9999;

        this._iceSpikeSystem = new IceSpikeSystem(this);
        this._fireballSystem = new FireballSystem(this);

        this._frozenForCast = false;

        // 纯环绕 AI：不主动靠近目标，只在过近时后退
        this._circleNoApproach = true;

        // 把普通远程攻击改成“动画播放到一半（300ms）时才发射投射物”
        this._pendingWizardAttack = null;
        const rangedAttack = this.attacks && this.attacks.ranged;
        if (rangedAttack) {
            const cfg = rangedAttack.config;
            rangedAttack.execute = (source, targetX, targetY, entities) => {
                source._pendingWizardAttack = {
                    targetX,
                    targetY,
                    entities,
                    timer: 300,
                    cfg
                };
                return true;
            };
        }

        // 帧动画状态
        this._animState = 'idle'; // idle | walk | attack | summon
        this._summonAnimPhase = 0; // 0=未播放, 1=正放, 2=倒放
        this._summonAnimTimer = 0;
        this._attackAnimTimer = 0; // 攻击动画剩余时间（ms）
    }

    update(dt, entities) {
        // 召唤/技能冷却
        if (this._summonCooldown > 0) this._summonCooldown -= dt;
        if (this._iceSpikeCooldown > 0) this._iceSpikeCooldown -= dt;
        if (this._fireballCooldown > 0) this._fireballCooldown -= dt;

        // 召唤动画状态机：2 秒内先正放再倒放，期间无法移动/攻击
        if (this._animState === 'summon') {
            this._pendingWizardAttack = null;
            this._summonAnimTimer -= dt;
            this.vx = 0;
            this.vy = 0;
            if (this._summonAnimTimer <= 0) {
                if (this._summonAnimPhase === 1) {
                    this._summonAnimPhase = 2;
                    this._summonAnimTimer = 1000;
                } else {
                    this._animState = 'idle';
                    this._summonAnimPhase = 0;
                    this._frozenForCast = false;
                }
            }
            this.updateWeaponAnim(dt);
            return;
        }

        // 更新冰锥/火球系统
        this._iceSpikeSystem.update(dt, entities);
        this._fireballSystem.update(dt, entities);

        // 施法状态机
        if (this._castState !== 'idle') {
            this._pendingWizardAttack = null;
            this._castTimer -= dt;
            if (this._castTimer <= 0) {
                this._transitionCastState();
            }
            // 攻击动画只持续 600ms，播放完毕后切回 idle，但施法期间仍禁止移动
            if (this._attackAnimTimer > 0) {
                this._attackAnimTimer -= dt;
                if (this._attackAnimTimer <= 0) {
                    this._attackAnimTimer = 0;
                    this._animState = 'idle';
                }
            }
            this.vx = 0;
            this.vy = 0;
            this.updateWeaponAnim(dt);
            return;
        }

        // 普通 AI 更新
        super.update(dt, entities);

        // 处理延迟发射的普通攻击（动画播放到一半才出投射物）
        if (this._pendingWizardAttack) {
            this._pendingWizardAttack.timer -= dt;
            if (this._pendingWizardAttack.timer <= 0) {
                this._firePendingWizardAttack();
                this._pendingWizardAttack = null;
            }
        }

        // 尝试召唤
        if (this._summonCooldown <= 0 && this.target && this.target.active) {
            this._summonZombieDogs(entities);
        }

        // 召唤一旦开始，本帧不再进入施法，避免 summon 动画被 attack 覆盖
        if (this._animState === 'summon') {
            this.updateWeaponAnim(dt);
            return;
        }

        // 尝试进入施法循环
        if (this.target && this.target.active) {
            if (this._iceSpikeCooldown <= 0 && this._castState === 'idle') {
                this._startIceCast();
            }
        }

        // 普通状态下根据移动切换 idle/walk
        // 攻击动画有独立的 600ms 计时器；计时结束后必须切回 idle/walk，避免被锁死在 attack
        if (this._animState === 'attack') {
            if (this._attackAnimTimer > 0) {
                this._attackAnimTimer -= dt;
                if (this._attackAnimTimer <= 0) this._attackAnimTimer = 0;
            }
            if (this._attackAnimTimer <= 0) {
                this._animState = this.isMoving ? 'walk' : 'idle';
            }
        } else {
            this._animState = this.isMoving ? 'walk' : 'idle';
        }
    }

    _startIceCast() {
        this._castState = 'ice';
        this._castTimer = 2000; // 2 秒施法
        this._frozenForCast = true;
        this._animState = 'attack';
        this._attackAnimTimer = 600;
        this.vx = 0;
        this.vy = 0;
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '❄ 冰锥术', '#5a8aaa'));
        this._iceSpikeSystem.trigger();
    }

    _startFireCast() {
        this._castState = 'fire';
        this._castTimer = 2000;
        this._frozenForCast = true;
        this._animState = 'attack';
        this._attackAnimTimer = 600;
        this.vx = 0;
        this.vy = 0;
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '🔥 火球术', '#ff6b35'));
        this._fireballSystem.trigger();
    }

    _transitionCastState() {
        if (this._castState === 'ice') {
            // 冰锥施法结束，尝试火球
            this._castState = 'wait';
            this._castTimer = 500;
            this._animState = 'attack';
            this._iceSpikeSystem.trigger(); // 发射已凝聚的冰锥
            if (this._fireballCooldown <= 0) {
                this._startFireCast();
            }
        } else if (this._castState === 'fire') {
            this._fireballSystem.trigger(); // 发射火球
            this._castState = 'idle';
            this._frozenForCast = false;
            this._castTimer = 0;
            this._animState = 'idle';
        } else if (this._castState === 'wait') {
            this._castState = 'idle';
            this._frozenForCast = false;
            this._animState = 'idle';
            this._attackAnimTimer = 0;
        }
    }

    _firePendingWizardAttack() {
        const pending = this._pendingWizardAttack;
        if (!pending) return;
        const { targetX, targetY, cfg } = pending;

        // [ENHANCE] 延迟 300ms 的普攻也做预判瞄准，extraDelayS=0.3 把前摇纳入计算
        let aimX = targetX, aimY = targetY;
        const target = this.target;
        if (target && target.active && target.vx !== undefined) {
            const lead = AimHelper.lead(this.x, this.y, target.x, target.y, target.vx || 0, target.vy || 0, cfg.projectileSpeed, 0.3);
            aimX = lead.x; aimY = lead.y;
        }
        const angle = Math.atan2(aimY - this.y, aimX - this.x);
        const baseDamage = this.getCurrentWeaponAtk
            ? this.getCurrentWeaponAtk()
            : Math.floor((cfg.damage.min + cfg.damage.max) / 2);
        const damage = { min: baseDamage, max: baseDamage };
        const projectileSpeed = cfg.projectileSpeed;
        const projectileRange = cfg.projectileRange;
        const projectileSize = cfg.projectileSize;
        ProjectileFactory.create({
            x: this.x, y: this.y, angle,
            speed: projectileSpeed, maxRange: projectileRange, size: projectileSize,
            damage, piercing: cfg.piercing, source: this, entities: pending.entities,
            image: this.arrowImage,
            damageType: cfg.damageType || 'physical',
            isSpit: this.name === '毒液僵尸' || cfg.isSpit
        });
        SoundManager.play('bow_fire');
    }

    _summonZombieDogs(entities) {
        this._summonCooldown = 30000;
        this._animState = 'summon';
        this._summonAnimPhase = 1;
        this._summonAnimTimer = 1000;
        this._frozenForCast = true;
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '🐕 召唤僵尸犬', '#8a8a4a'));

        const angle = this.rotation || 0;
        const distance = 100;
        const offsets = [-Math.PI / 6, 0, Math.PI / 6]; // -30°, 0°, +30°
        const dogCfg = enemyConfigData.zombieDog || {};
        const dogRadius = dogCfg.collisionRadius || 30;
        const placed = [];

        for (let i = 0; i < 3; i++) {
            const a = angle + offsets[i];
            const tx = this.x + Math.cos(a) * distance;
            const ty = this.y + Math.sin(a) * distance;
            const pos = this._findValidSummonPosition(tx, ty, dogRadius, placed);
            placed.push(pos);

            // 通过运行时工厂创建（在 zombie-dungeon.js 中注入）
            const dog = this._createZombieDog ? this._createZombieDog(pos.x, pos.y) : null;
            if (dog) {
                // [FIX] 每只召唤犬必须有唯一 key，否则会覆盖 entities map 中的同一条记录
                const dogId = `zombieDog_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
                dog.id = dogId;
                if (entities && typeof entities.set === 'function') {
                    entities.set(dogId, dog);
                } else if (Array.isArray(entities)) {
                    entities.push(dog);
                }
            }
        }
    }

    /**
     * 寻找合法的召唤位置：不能卡在墙里，也不要和其他召唤物过度重叠。
     * 优先使用目标位置；若被墙挡住，则沿“巫师→目标”射线往回找，
     * 再不行就在目标点附近做螺旋搜索，最后回退到巫师周围搜索。
     */
    _findValidSummonPosition(tx, ty, radius, existing = []) {
        const canPlace = (x, y) => {
            if (!WallSystem || typeof WallSystem.canMoveTo !== 'function') return true;
            if (!WallSystem.canMoveTo(x, y, radius)) return false;
            for (const p of existing) {
                if (Math.hypot(x - p.x, y - p.y) < radius * 2.2) return false;
            }
            return true;
        };

        if (canPlace(tx, ty)) return { x: tx, y: ty };

        // 沿射线往回找，确保与巫师在同一侧墙面
        const dx = tx - this.x;
        const dy = ty - this.y;
        const dist = Math.hypot(dx, dy);
        const step = Math.max(4, radius * 0.25);
        for (let d = dist - step; d > 0; d -= step) {
            const t = d / dist;
            const x = this.x + dx * t;
            const y = this.y + dy * t;
            if (canPlace(x, y)) return { x, y };
        }

        // 在目标点附近螺旋搜索
        const maxR = 160;
        const ringStep = Math.max(8, radius * 0.3);
        const angleStep = Math.PI / 4;
        for (let r = ringStep; r <= maxR; r += ringStep) {
            for (let a = 0; a < Math.PI * 2; a += angleStep) {
                const x = tx + Math.cos(a) * r;
                const y = ty + Math.sin(a) * r;
                if (canPlace(x, y)) return { x, y };
            }
        }

        // 最终回退：巫师附近螺旋搜索
        for (let r = ringStep; r <= maxR; r += ringStep) {
            for (let a = 0; a < Math.PI * 2; a += angleStep) {
                const x = this.x + Math.cos(a) * r;
                const y = this.y + Math.sin(a) * r;
                if (canPlace(x, y)) return { x, y };
            }
        }

        return { x: this.x, y: this.y };
    }

    triggerWeaponAnim() {
        super.triggerWeaponAnim();
        // 普通远程攻击（毒液/法球）也播放 attacking 精灵图动画
        // 不要打断施法/召唤动画，避免视觉冲突
        if (this._castState === 'idle' && this._animState !== 'summon') {
            this._animState = 'attack';
            this._attackAnimTimer = 600;
        }
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_zombie_wizard_walk';
            case 'attack': return 'enemy_zombie_wizard_attack';
            case 'summon': return 'enemy_zombie_wizard_summon';
            default: return 'enemy_zombie_wizard_idle';
        }
    }

    _getPhaserOptions() {
        let flipX = false;
        if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }
        const options = {
            spriteSize: 120,
            collisionWidth: 30,
            collisionHeight: 90,
            textOffsetY: -70,
            flipX,
            animState: this._animState,
            animKey: `enemy_zombie_wizard_${this._animState}`,
        };
        if (this._animState === 'summon' && this._summonAnimPhase === 2) {
            options.summonReverse = true;
        }
        return options;
    }
}
