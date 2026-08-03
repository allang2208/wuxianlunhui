import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { playSoundFrom } from './_shared/enemy-utils.js';
import { AimHelper } from '../../utils/aim-helper.js';
import { ProjectileFactory } from '../../utils/projectile-factory.js';
import { summonMonster } from './_shared/summon-helper.js';
import { throwVenomBottle, updateVenomZones, destroyVenomZones } from './_shared/venom-bottle.js';

/**
 * 巫婆（领主，僵尸 family）
 * - 远程魔法：距离判定 800px，1.5s 播放 attacking 14 帧，第 5 帧发射 3 个投射物
 *   （毒蛆同款投射物贴图，扇形展开，AimHelper.lead 预判瞄准）并播放 attacking.mp3；
 *   每个投射物造成 魔法攻击×0.75 魔法伤害；冷却 4s；攻击期间不可移动
 * - 投掷毒液瓶：1.5s 播放 attacking-2 18 帧，第 8 帧播放 throwing.mp3、第 9 帧掷出毒液瓶
 *   （抛物线 1.5s 落地、每秒 360° 旋转）→ 落点 200px 椭圆毒液区持续 6s（绿色烟雾填满），
 *   每 0.5s 魔法攻击×0.75 魔法伤害并叠 1 层中毒；机制与煮锅共用 _shared/venom-bottle.js
 * - 伴生：首次 update 时在附近可行走落点生成一个煮锅（_createCauldron 工厂注入，
 *   避免实体层反向依赖 world 层；唯一 key 防 Map 覆盖）
 * - 死亡：dying 17 帧 → 定格 1s → 淡出消失
 * 所有数值均来自 enemy-config.json witch.attackSkills，类内不硬编码
 */
export class Witch extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.witch,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 攻击决策完全自管：关闭 CombatSystem 的通用近战触发（同矿工提灯僵尸模式）
        this.aiInterval = Number.MAX_SAFE_INTEGER;
        // 纯环绕 AI：不主动靠近目标，只在过近时后退（同僵尸巫师）
        this._circleNoApproach = true;

        // 动画状态：idle | walk | magic | venom | death
        this._animState = 'idle';
        this._animStateTimer = 0;

        // 攻击状态：null | 'magic' | 'venom'
        this._attackType = null;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._hitDone = false;      // 投射物出手
        this._soundDone = false;    // 攻击音效
        this._magicCd = 0;
        this._venomCd = 0;

        // 毒液区（_shared/venom-bottle.js 管理）
        this._venomZones = [];

        // 伴生煮锅（首次 update 生成）
        this._cauldronSpawned = false;
        this._createCauldron = config.createCauldron || null;

        // 死亡三段式（动画 → 定格 → 淡出）
        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
    }

    _getMagicConfig() {
        return this.config?.attackSkills?.magic || {};
    }

    _getVenomConfig() {
        return this.config?.attackSkills?.venom || {};
    }

    _getDeathConfig() {
        return this.config?.death || {};
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathSequence(dt);
            return;
        }

        super.update(dt, entities);

        // 伴生煮锅：首次 update 生成（此时 entities/墙体系统均已就绪）
        if (!this._cauldronSpawned) {
            this._cauldronSpawned = true;
            this._spawnCompanionCauldron();
        }

        // 冷却推进
        if (this._magicCd > 0) this._magicCd -= dt;
        if (this._venomCd > 0) this._venomCd -= dt;

        // 眩晕时中断攻击动作
        if (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            this._attackType = null;
            this._attackTimer = 0;
            this._attackAnimTimer = 0;
            this.vx = 0; this.vy = 0; this.isMoving = false;
            updateVenomZones(this, dt, entities);
            return;
        }

        // 恐惧时中断攻击决策（移动由 MovementSystem 恐惧分支接管逃跑）
        if (this.hasStatusEffect && this.hasStatusEffect('fear')) {
            return;
        }

        // 攻击帧推进（投射物出手 / 攻击音效帧）
        if (this._attackType) {
            this._updateAttack(dt, entities);
        } else {
            this._attackAnimTimer = 0;
        }

        // 状态切换
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let nextState;
        if (this._attackType === 'magic') {
            nextState = 'magic';
        } else if (this._attackType === 'venom') {
            nextState = 'venom';
        } else {
            const maxSpd = this.maxSpeed ?? this.speed ?? 130;
            nextState = speed > maxSpd * 0.05 ? 'walk' : 'idle';
        }
        this._animStateTimer = (this._animStateTimer || 0) + dt;
        if (nextState !== this._animState && this._animStateTimer >= 80) {
            this._animState = nextState;
            this._animStateTimer = 0;
        }

        // 朝向
        const t = this.target && this.target.active ? this.target : null;
        if (this._attackType && t) {
            this.rotation = Math.atan2(t.y - this.y, t.x - this.x);
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }

        // 攻击决策：毒液瓶优先（区域控制），其次远程魔法（均为 800px 距离判定）
        if (!this._attackType && t) {
            const dist = Math.hypot(t.x - this.x, t.y - this.y);
            const magic = this._getMagicConfig();
            const venom = this._getVenomConfig();
            if (this._venomCd <= 0 && dist <= (venom.throwRange ?? 800)) {
                this._tryAttackTelegraph(() => this._startAttack('venom'));
            } else if (this._magicCd <= 0 && dist <= (magic.range ?? 800)) {
                this._tryAttackTelegraph(() => this._startAttack('magic'));
            }
        }

        // 毒液区 tick 与清理
        updateVenomZones(this, dt, entities);
    }

    // ========== 伴生煮锅 ==========

    /**
     * 在巫婆四周找一个可行走的落点生成煮锅（统一走 summon-helper）；
     * 全部失败则放弃（不影响巫婆本体），保证煮锅不卡墙
     */
    _spawnCompanionCauldron() {
        const cauldronCfg = enemyConfigData.cauldron || {};
        const created = summonMonster(this, {
            factory: this._createCauldron,
            count: 1,
            mode: 'radial',
            radius: cauldronCfg.collisionRadius || 70,
            distance: 120,
            tag: 'cauldron',
            playFx: true,
            setAnchor: true,
        });
        // 煮锅自身构造里已调用 applyStatusImmune，无需额外标记
        if (created.length > 0) {
            const cauldron = created[0];
            cauldron._anchorX = cauldron.x;
            cauldron._anchorY = cauldron.y;
        }
    }

    // ========== 攻击 ==========

    _startAttack(type) {
        const cfg = type === 'magic' ? this._getMagicConfig() : this._getVenomConfig();
        const duration = cfg.duration ?? 1500;
        this._attackType = type;
        this._attackTimer = duration;
        this._attackAnimTimer = duration; // MovementSystem 锁定（攻击时不可移动）
        this._hitDone = false;
        this._soundDone = false;
        this._animState = type;
        this._animStateTimer = 0;
        this.vx = 0; this.vy = 0; this.isMoving = false;
        if (type === 'magic') {
            this._magicCd = cfg.cooldown ?? 4000;
        } else {
            this._venomCd = cfg.cooldown ?? 8000;
        }
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    _updateAttack(dt, entities) {
        this._attackTimer -= dt;
        this._attackAnimTimer = Math.max(0, this._attackTimer);
        this.vx = 0; this.vy = 0; this.isMoving = false;

        const isMagic = this._attackType === 'magic';
        const cfg = isMagic ? this._getMagicConfig() : this._getVenomConfig();
        const duration = cfg.duration ?? 1500;
        const frames = cfg.frames ?? (isMagic ? 14 : 18);
        const elapsed = duration - this._attackTimer;

        // 攻击音效帧（配置 sounds.magicFrame / venomFrame）
        const soundFrame = isMagic ? this.config?.sounds?.magicFrame : this.config?.sounds?.venomFrame;
        if (!this._soundDone && typeof soundFrame === 'number' && elapsed >= (soundFrame / frames) * duration) {
            this._soundDone = true;
            playSoundFrom(this, isMagic ? 'magic' : 'venom');
        }

        // 帧事件：投射物出手（配置 fireFrame）
        const fireFrame = cfg.fireFrame ?? (isMagic ? 5 : 9);
        if (!this._hitDone && elapsed >= (fireFrame / frames) * duration) {
            this._hitDone = true;
            if (isMagic) this._fireMagicProjectiles(entities);
            else this._throwVenom();
        }

        if (this._attackTimer <= 0) {
            this._attackTimer = 0;
            this._attackType = null;
        }
    }

    /** 远程魔法：真实发射点 AimHelper.lead 预判瞄准，扇形发射 projectileCount 个投射物 */
    _fireMagicProjectiles(entities) {
        const cfg = this._getMagicConfig();
        const matk = this.data?.matk || 0;
        const damage = Math.max(1, Math.round(matk * (cfg.damageMul ?? 0.75)));
        const t = this.target && this.target.active ? this.target : null;

        // 发射口：贴图前方（配置驱动，与毒蛆 _getHeadWorldPosition 同口径）
        const opts = this._getPhaserOptions();
        const dirX = opts.flipX ? -1 : 1;
        let mx = this.x + dirX * (cfg.muzzleForward ?? 60);
        let my = this.y - (cfg.muzzleUpY ?? 80);
        if (!opts.flipX) {
            mx += cfg.muzzleRightDx ?? 0;
            my += cfg.muzzleRightDy ?? 0;
        }

        // 预判瞄准（真实发射点调用；无有效解回退目标当前位置）
        let aimX = this.x + dirX * 100, aimY = this.y;
        if (t) {
            aimX = t.x; aimY = t.y;
            if (t.vx !== undefined) {
                const lead = AimHelper.lead(mx, my, t.x, t.y, t.vx || 0, t.vy || 0, cfg.projectileSpeed ?? 500);
                aimX = lead.x; aimY = lead.y;
            }
        }
        const baseAngle = Math.atan2(aimY - my, aimX - mx);

        const count = Math.max(1, cfg.projectileCount ?? 3);
        const fan = cfg.fanAngle ?? (Math.PI / 6);
        for (let i = 0; i < count; i++) {
            // 扇形均匀展开（1 个时正对预判点）
            const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * fan;
            ProjectileFactory.create({
                x: mx, y: my,
                angle: baseAngle + offset,
                speed: cfg.projectileSpeed ?? 500,
                maxRange: cfg.projectileRange ?? 900,
                size: cfg.projectileSize ?? 20,
                damage: { min: damage, max: damage },
                piercing: 0,
                source: this,
                entities,
                textureKey: 'projectile_poison_maggot', // 毒蛆同款投射物贴图
                damageType: cfg.damageType || 'magic',
                knockback: 0
            });
        }
    }

    /** 投掷毒液瓶：预判落点（固定飞行时间线性外推，提灯同口径），机制走共享模块 */
    _throwVenom() {
        const cfg = this._getVenomConfig();
        const t = this.target && this.target.active ? this.target : null;
        // 预判落点：抛物线固定飞行时间 flyS，线性外推目标在 flyS 秒后的位置。
        // 不用 AimHelper.lead（匀速直线弹体模型与固定时长抛物线不匹配，提灯教训）
        const flyS = (cfg.flyDuration ?? 1500) / 1000;
        let tx = this.x, ty = this.y;
        if (t) {
            tx = t.x + (t.vx || 0) * flyS;
            ty = t.y + (t.vy || 0) * flyS;
        }
        throwVenomBottle(this, cfg, tx, ty);
    }

    /** 统一特效清理（game.js removeEntity / onDeath 约定入口） */
    _destroyCustomEffects() {
        destroyVenomZones(this);
    }

    // ========== 死亡三段式（动画 → 定格 → 淡出；无死亡音效素材） ==========

    _updateDeathSequence(dt) {
        const D = this._getDeathConfig();
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer -= dt;
            if (this._deathAnimTimer <= 0) {
                this._deathAnimTimer = 0;
                this._corpseTimer = D.holdMs ?? 1000;
            }
        } else if (this._corpseTimer > 0) {
            this._corpseTimer -= dt;
            if (this._corpseTimer <= 0) {
                this._corpseTimer = 0;
                this._fadeTimer = D.fadeMs ?? 300;
            }
        } else if (this._fadeTimer > 0) {
            this._fadeTimer -= dt;
            const fadeMs = D.fadeMs ?? 300;
            if (this._phaserSprite && this._phaserSprite.active) {
                this._phaserSprite.setAlpha(Math.max(0, this._fadeTimer / fadeMs));
            }
            if (this._fadeTimer <= 0) {
                this._fadeTimer = 0;
                if (this._phaserSprite && this._phaserSprite.active) {
                    this._phaserSprite.destroy();
                    this._phaserSprite = null;
                }
            }
        }
    }

    onDeath(source) {
        this.active = false;
        this._animState = 'death';
        this._attackType = null;
        this._deathAnimTimer = this._getDeathConfig().animMs ?? 1500;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        if (typeof super.onDeath === 'function') {
            super.onDeath(source);
        }
    }

    // ========== 动画 ==========

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_witch_walk';
            case 'magic': return 'enemy_witch_attack';
            case 'venom': return 'enemy_witch_attack2';
            case 'death': return 'enemy_witch_death';
            default: return 'enemy_witch_idle';
        }
    }

    _getPhaserOptions() {
        // 原始素材面向右，目标/移动方向朝左时翻转
        let flipX = false;
        if (this._attackType && this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }

        const renderCfg = this.config?.render || {};
        const spriteSize = renderCfg.spriteSize || 250;
        // animState 映射：攻击/死亡均为一次性动画（GameScene 依 isLoopAnim 规则不重播；
        // 两种攻击都必须报 'attack'，否则会被当循环动画重播）
        const animStateMap = { magic: 'attack', venom: 'attack', death: 'death' };
        const animState = animStateMap[this._animState] || this._animState;
        return {
            spriteSize,
            collisionWidth: renderCfg.collisionWidth || 62.5,
            collisionHeight: renderCfg.collisionHeight || 137.5,
            textOffsetY: -spriteSize / 2 - 10,
            flipX,
            animState,
            animKey: this._getTextureKey(),
        };
    }
}
