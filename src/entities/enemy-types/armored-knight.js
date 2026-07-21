import { Enemy } from '../enemy.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { WallSystem } from '../../world/wall-system.js';
import { SoundManager } from '../../ui/sound-manager.js';
import enemyConfigData from '../../../data/enemy-config.json';

/**
 * 铠甲骑士（精英）
 * 技能（数值全部由 enemy-config.json 的 attackSkills 驱动）：
 * - 二连击挥砍（combo）：32 帧动画，hitFrames 帧各判定一次，物理攻击 ×damageMul
 * - 持盾冲锋（charge）：瞬间发动，speed 追踪目标，命中伤害×damageMul + 击退 + 眩晕；
 *   目标弹反成功则不受伤不眩晕只击退；冲锋期间自身弹反免疫（与集合体同机制）
 * - 举盾格挡（block）：玩家攻击动作临近时面对目标举盾，期间所有来袭判定为弹反
 *   （复制玩家盾系统语义：免伤，近战攻击者被眩晕击退）
 */
export class ArmoredKnight extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.armoredKnight,
            ...config
        });
        this._useStickFigure = false;
        this._animState = 'idle'; // idle | walk | combo | charge | defend
        // 动作期间锁定 MovementSystem 的通用通道（与集合体/突变体-3 同机制）：
        // >0 时 MovementSystem 不驱动移动/朝向，combo/charge/block 期间必须设置，否则外部系统会推着骑士走
        this._attackAnimTimer = 0;

        // 自定义技能逻辑，关闭通用 CombatSystem 近战攻击
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 二连击状态
        this._comboTimer = 0;
        this._comboCooldown = 0;
        this._comboHitsDone = new Set();
        this._comboTarget = null;

        // 冲锋状态
        this._chargeTarget = null;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._chargeCooldown = 0;
        // 冲锋期间的弹反免疫需要事后还原（配置本身不带 parryImmune）
        this._baseParryImmune = !!this._parryImmune;

        // 格挡状态
        this._blockTimer = 0;
        this._blockCooldown = 0;
        // 格挡前摇：先播放 defending 动画，windup(ms) 后格挡判定才生效
        this._blockWindup = 0;

        // 冲锋状态碰撞标记：冲锋时无视实体碰撞（穿人），结束时恢复（noCollision 由 resolveCollisions 过滤）
        this.noCollision = false;
        this._prevNoCollision = false;

        // 弹反管线代理：格挡期间命中按弹反处理（供 DamagePipeline 抑制击退/craft 命中效果）
        this.shieldSystem = { _lastParried: false };

        // 音效计时（enemy-config.json 的 sounds 块驱动）
        this._walkSoundTimer = 0;
        this._chargeSoundTimer = 0;
        this._comboSoundsDone = new Set();
        // 冲锋扬尘计时（与玩家奔跑同款 DustEffect）
        this._chargeDustTimer = 0;
        // 头部蓝色浮动粒子（符文长剑蓝 0x3282ff，持续向上漂浮）
        this._headParticles = null;
        // 冲锋朝向死区：|dx| 过小时保持上次朝向，防止贴身抖动回头
        this._chargeFaceDir = 1;
    }

    _getSkillConfigs() {
        const s = this.config?.attackSkills || {};
        return {
            combo: s.combo || {},
            charge: s.charge || {},
            block: s.block || {},
        };
    }

    // 播放配置音效（enemy-config.json 的 sounds 块驱动）
    _playSound(key) {
        const path = this.config?.sounds?.[key];
        if (path && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(path);
        }
    }

    update(dt, entities) {
        if (this._comboCooldown > 0) this._comboCooldown -= dt;
        if (this._chargeCooldown > 0) this._chargeCooldown -= dt;
        if (this._blockCooldown > 0) this._blockCooldown -= dt;
        if (this._attackAnimTimer > 0) this._attackAnimTimer = Math.max(0, this._attackAnimTimer - dt);
        this.updateStatusEffects(dt);

        // 眩晕时强制中断所有动作
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            this._endCombo();
            this._endCharge();
            this._endBlock();
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            this._animState = 'idle';
            return;
        }

        // 恐惧时技能/动作中断（移动由 MovementSystem 恐惧分支接管逃跑）
        if (this.hasStatusEffect && this.hasStatusEffect('fear')) {
            return;
        }

        // 动作状态推进（进行中的动作优先；同步粒子后 return，保证冲锋/连击/格挡期间粒子跟随）
        if (this._animState === 'combo') { this._updateCombo(dt); this._syncHeadParticles(); return; }
        if (this._animState === 'charge') { this._updateCharge(dt); this._syncHeadParticles(); return; }
        if (this._animState === 'defend') { this._updateBlock(dt); this._syncHeadParticles(); return; }

        // 普通 AI 移动
        super.update(dt, entities);

        // 技能决策：格挡（反应） > 冲锋 > 连击
        if (this.target && this.target.active) {
            this._decideSkills();
        }
        if (this._animState !== 'combo' && this._animState !== 'charge' && this._animState !== 'defend') {
            this._animState = this.isMoving ? 'walk' : 'idle';
        }

        // 移动音效：walk 状态按间隔持续播放脚步声
        if (this._animState === 'walk') {
            this._walkSoundTimer -= dt;
            if (this._walkSoundTimer <= 0) {
                this._walkSoundTimer = this.config?.sounds?.walkInterval ?? 500;
                this._playSound('walk');
            }
        } else {
            this._walkSoundTimer = 0;
        }

        // 头部蓝色浮动粒子（符文蓝，持续向上漂浮）
        this._syncHeadParticles();
    }

    /** 头部蓝色浮动粒子：符文长剑蓝 0x3282ff，贴图头顶持续向上漂浮 */
    _syncHeadParticles() {
        // 死亡即停（尸体不再飘粒子）
        if (this.hp <= 0) { this._destroyHeadParticles(); return; }
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const sprite = this._phaserSprite;
        if (!scene || !scene.add || !sprite || !sprite.active) {
            if (this._headParticles) { this._destroyHeadParticles(); }
            return;
        }
        if (!this._headParticles) {
            // 白色圆点纹理 + 蓝色 tint（与受击粒子同纹理，tint 乘算显色）
            if (!scene.textures.exists('impact_dot') && typeof scene._ensureImpactDotTexture === 'function') {
                scene._ensureImpactDotTexture();
            }
            if (!scene.textures.exists('impact_dot')) return;
            this._headParticles = scene.add.particles(0, 0, 'impact_dot', {
                speed: { min: 15, max: 40 },
                angle: { min: 255, max: 285 }, // 向上（270° 为正上方）
                gravityY: -40,                 // 负重力持续上浮
                lifespan: 1400,
                frequency: 90,                 // 粒子数翻倍（180→90ms）
                quantity: 1,
                scale: { start: 0.7, end: 0 },
                alpha: { start: 0.85, end: 0 },
                tint: 0x3282ff,
                blendMode: 'ADD',
                emitting: true
            });
            this._headParticles.setDepth(sprite.y + 1000);
        }
        // 发射点跟随贴图头顶（强绑定模型位置）+ 上移 10px（下移 100 基础上），水平轴 ±5px 抖动
        const charging = this._animState === 'charge';
        const combo = this._animState === 'combo';
        // 方向性偏移（面朝右为基准，朝左镜像）：二连击 +10px、冲锋 +20px
        const faceDir = charging ? this._chargeFaceDir : (Math.cos(this.rotation ?? 0) >= 0 ? 1 : -1);
        const offsetX = charging ? faceDir * 20 : (combo ? faceDir * 10 : 0);
        const headY = sprite.y - sprite.displayHeight / 2 + 90;
        const jitterX = (Math.random() - 0.5) * 10;
        this._headParticles.setPosition(sprite.x + offsetX + jitterX, headY);
        this._headParticles.setDepth(headY + 1000);
        // 冲锋状态：粒子向身后近水平喷出且速度加快（切换时重配，角度每帧跟随冲锋朝向）
        if (charging !== this._headParticlesCharging) {
            this._headParticlesCharging = charging;
            this._chargeBackDeg = undefined; // 进入/退出冲锋都强制重配
            if (!charging) {
                this._headParticles.setConfig({
                    speed: { min: 15, max: 40 },
                    angle: { min: 255, max: 285 },
                    gravityY: -40,
                    lifespan: 1400,
                    frequency: 90,
                    quantity: 1,
                    scale: { start: 0.7, end: 0 },
                    alpha: { start: 0.85, end: 0 },
                    tint: 0x3282ff,
                    blendMode: 'ADD',
                    emitting: true
                });
            }
        }
        if (charging) {
            // 喷出角度 = 冲锋反方向 ±12°（接近水平向后），角度变化超 15° 才重配（避免每帧 setConfig 开销）
            const back = (this.rotation ?? 0) + Math.PI;
            const backDeg = back * 180 / Math.PI;
            if (this._chargeBackDeg === undefined || Math.abs(backDeg - this._chargeBackDeg) > 15) {
                this._chargeBackDeg = backDeg;
                this._headParticles.setConfig({
                    speed: { min: 60, max: 130 },
                    angle: { min: backDeg - 12, max: backDeg + 12 },
                    gravityY: 0,
                    lifespan: 1100,
                    frequency: 45,
                    quantity: 1,
                    scale: { start: 0.8, end: 0 },
                    alpha: { start: 0.9, end: 0 },
                    tint: 0x3282ff,
                    blendMode: 'ADD',
                    emitting: true
                });
            }
            // 重力沿冲锋反方向后拉，强化水平拖尾
            this._headParticles.setParticleGravity(Math.cos(back) * 110, 0);
        } else if (this._headParticlesCharging === false) {
            this._headParticles.setParticleGravity(0, -40);
        }
    }

    _destroyHeadParticles() {
        if (this._headParticles) {
            if (this._headParticles.active) this._headParticles.destroy();
            this._headParticles = null;
        }
    }

    /** 统一特效清理（game.js removeEntity 约定入口） */
    _destroyCustomEffects() {
        this._destroyHeadParticles();
    }

    _decideSkills() {
        const t = this.target;
        const cfg = this._getSkillConfigs();


        // 格挡：目标正在攻击动作且临近时，面对目标举盾
        if (this._blockCooldown <= 0 && cfg.block.duration) {
            const targetAttacking = t.weaponAnim && t.weaponAnim.state && t.weaponAnim.state !== 'idle';
            if (targetAttacking && this._isTargetInRange(t, cfg.block.triggerRange ?? 260)) {
                this._startBlock();
                return;
            }
        }

        // 冲锋：CD 就绪且目标在触发范围内，瞬间发动（无蓄力；精英预警后再启动）
        if (this._chargeCooldown <= 0 && cfg.charge.maxSpeed) {
            if (this._isTargetInRange(t, cfg.charge.triggerRange ?? 550)) {
                this._tryAttackTelegraph(() => this._startCharge());
                return;
            }
        }

        // 连击：近身才发动（triggerRange 比伤害判定 range 小，避免空挥；精英预警后再启动）
        if (this._comboCooldown <= 0 && cfg.combo.duration) {
            if (this._isTargetInRange(t, cfg.combo.triggerRange ?? 75)) {
                this._tryAttackTelegraph(() => this._startCombo());
            }
        }
    }

    // ========== 二连击挥砍 ==========

    _startCombo() {
        const cfg = this._getSkillConfigs().combo;
        this._animState = 'combo';
        this._comboTimer = cfg.duration ?? 2000;
        this._attackAnimTimer = cfg.duration ?? 2000; // 锁定 MovementSystem，二连击期间不可移动
        this._comboCooldown = cfg.cooldown ?? 4000;
        this._comboHitsDone = new Set();
        this._comboSoundsDone = new Set();
        this._comboTarget = this.target;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    _updateCombo(dt) {
        const cfg = this._getSkillConfigs().combo;
        this._comboTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        if (this._comboTarget && this._comboTarget.active) {
            this.rotation = Math.atan2(this._comboTarget.y - this.y, this._comboTarget.x - this.x);
        }
        const elapsed = (cfg.duration || 0) - this._comboTimer;
        const frames = cfg.frames || 1;
        // 挥砍音效帧（独立于伤害帧，互不干扰）
        const soundFrames = this.config?.sounds?.comboSoundFrames || [];
        for (let i = 0; i < soundFrames.length; i++) {
            if (this._comboSoundsDone.has(i)) continue;
            const st = ((soundFrames[i] - 1) / frames) * (cfg.duration || 0);
            if (elapsed >= st) {
                this._comboSoundsDone.add(i);
                this._playSound('combo');
            }
        }
        const hitFrames = cfg.hitFrames || [];
        for (let i = 0; i < hitFrames.length; i++) {
            if (this._comboHitsDone.has(i)) continue;
            const t = ((hitFrames[i] - 1) / frames) * (cfg.duration || 0);
            if (elapsed >= t) {
                this._comboHitsDone.add(i);
                this._dealComboHit();
            }
        }
        if (this._comboTimer <= 0) this._endCombo();
    }

    _dealComboHit() {
        const cfg = this._getSkillConfigs().combo;
        const t = this._comboTarget;
        if (!t || !t.active || !t.hittable) return;
        if (!this._isTargetInRange(t, cfg.range ?? 125)) return;
        const atk = this.data?.atk || 0;
        t.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 1))), this, 'physical', true);
    }

    _endCombo() {
        if (this._animState === 'combo') this._animState = 'idle';
        this._comboTimer = 0;
        this._comboTarget = null;
        this._comboHitsDone = new Set();
        this._attackAnimTimer = 0;
    }

    // ========== 持盾冲锋 ==========

    _startCharge() {
        const cfg = this._getSkillConfigs().charge;
        this._animState = 'charge';
        this._chargeTarget = this.target;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._chargeCooldown = cfg.cooldown ?? 10000;
        this._attackAnimTimer = cfg.maxDuration ?? 4500; // 锁定 MovementSystem，冲锋移动完全自驱
        this._chargeSoundTimer = 0;
        this._chargeElapsed = 0; // 线性加速计时（0 → accelDuration 内由 0 加速到 maxSpeed）
        this._chargeDustTimer = 0; // 扬尘计时（与玩家奔跑同款 DustEffect）
        // 冲锋期间弹反免疫（与集合体同机制），结束后还原
        this._parryImmune = true;
        // 冲锋期间无视实体碰撞体积（穿过单位；墙壁仍由 WallSystem 解析，不可穿过）
        this._prevNoCollision = this.noCollision;
        this.noCollision = true;
        this.vx = 0;
        this.vy = 0;
        if (this.target && this.target.active) {
            const dx = this.target.x - this.x;
            this.rotation = Math.atan2(this.target.y - this.y, dx);
            // 冲锋朝向初始锁定目标侧（死区更新，见 _updateCharge）
            if (Math.abs(dx) > 1e-3) this._chargeFaceDir = dx > 0 ? 1 : -1;
        }
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '🛡️ 冲锋！', '#7a8a9a'));
    }

    _updateCharge(dt) {
        const cfg = this._getSkillConfigs().charge;
        const dtSec = dt / 1000;
        this._chargeElapsed += dt;
        // 线性加速：释放开始 accelDuration 内由 0 逐步加速到 maxSpeed
        const maxSpeed = cfg.maxSpeed ?? 400;
        const accelDur = cfg.accelDuration ?? 1500;
        const maxDur = cfg.maxDuration ?? 3500;
        const speed = maxSpeed * Math.min(1, this._chargeElapsed / accelDur);
        const maxDist = cfg.maxDistance ?? 1800;
        // 冲锋脚步声：按间隔循环播放
        this._chargeSoundTimer -= dt;
        if (this._chargeSoundTimer <= 0) {
            this._chargeSoundTimer = this.config?.sounds?.chargeStepInterval ?? 300;
            this._playSound('walk');
        }
        // 冲锋扬尘：与玩家奔跑同款 DustEffect（冲刺档 70ms 间隔，向后方脚下生成）
        this._chargeDustTimer -= dt;
        if (this._chargeDustTimer <= 0 && speed > 0) {
            this._chargeDustTimer = 70;
            const backX = -Math.cos(this.rotation) * 12 + (Math.random() - 0.5) * 10;
            const backY = -Math.sin(this.rotation) * 12 + (Math.random() - 0.5) * 6;
            EffectFactory.createDustEffect(this.x + backX, this.y + backY + 10, 1.2);
        }
        const t = this._chargeTarget && this._chargeTarget.active ? this._chargeTarget : this.target;

        // 直接追踪目标单位
        if (t && t.active) {
            const dx = t.x - this.x;
            const dy = t.y - this.y;
            const d = Math.hypot(dx, dy);
            if (d > 0) {
                this.rotation = Math.atan2(dy, dx);
                // 朝向死区：|dx| > 20px 才更新水平朝向，防止贴身/正上下方时 flipX 抖动回头
                if (Math.abs(dx) > 20) this._chargeFaceDir = dx > 0 ? 1 : -1;
                // 步长限制在接触面之前：不与目标重合——否则命中后恢复实体碰撞时
                // 分离系统会把骑士从目标体内瞬间挤出，视觉上像贴图闪没/跳走
                const targetR = t.groundRadius || t.collisionRadius || 0;
                const contactDist = (this.groundRadius || 0) + targetR;
                const step = Math.min(speed * dtSec, Math.max(0, d - contactDist));
                const nx = this.x + (dx / d) * step;
                const ny = this.y + (dy / d) * step;
                const r = WallSystem.resolve(this.x, this.y, nx, ny, this.groundRadius);
                this._chargeTraveled += Math.hypot(r.x - this.x, r.y - this.y);
                this.x = r.x;
                this.y = r.y;
            }
        }

        // 命中判定：撞到目标立即结算并停止
        if (!this._chargeDamaged && t && t.active && t.hittable && this._isTargetInRange(t, cfg.hitRange ?? 60)) {
            this._chargeDamaged = true;
            this._dealChargeHit(t);
        }

        // 停止条件：命中 / 超出最大范围 / 超时未命中
        if (this._chargeDamaged || this._chargeTraveled >= maxDist || this._chargeElapsed >= maxDur || !t || !t.active) {
            this._endCharge();
        }
    }

    _dealChargeHit(t) {
        const cfg = this._getSkillConfigs().charge;
        this._playSound('block'); // 撞击到目标：播放一次盾击音
        const atk = this.data?.atk || 0;
        t.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 2))), this, 'physical', true);
        // 目标弹反成功：不受伤（takeDamage 已免伤）不眩晕，只保留击退；
        // 骑士冲锋期间 _parryImmune，不受弹反的眩晕/击退/打断影响
        const parried = t.shieldSystem && t.shieldSystem._lastParried;
        const angle = Math.atan2(t.y - this.y, t.x - this.x);
        if (t.applyKnockback) t.applyKnockback(angle, cfg.knockback ?? 200);
        if (!parried && t.applyStun) t.applyStun(cfg.stunMs ?? 2500);
    }

    _endCharge() {
        if (this._animState === 'charge') this._animState = 'idle';
        this._chargeTarget = null;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._parryImmune = this._baseParryImmune;
        this._attackAnimTimer = 0;
        // 恢复实体碰撞：与实体重叠时由 resolveCollisions 逐帧挤出（带墙壁解析，不瞬移不卡墙）
        this.noCollision = this._prevNoCollision;
        this.vx = 0;
        this.vy = 0;
    }

    // ========== 举盾格挡 ==========

    _startBlock() {
        const cfg = this._getSkillConfigs().block;
        this._animState = 'defend';
        const windup = cfg.windup ?? 500;
        // 前摇 + 防御时长：动画先播 windup(ms)，之后格挡判定才生效
        this._blockWindup = windup;
        this._blockTimer = windup + (cfg.duration ?? 2000);
        this._attackAnimTimer = windup + (cfg.duration ?? 2000); // 锁定 MovementSystem，格挡期间不可移动
        this._blockCooldown = cfg.cooldown ?? 6000;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        // 面对目标释放
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    _updateBlock(dt) {
        if (this._blockWindup > 0) this._blockWindup -= dt;
        this._blockTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._blockTimer <= 0) this._endBlock();
    }

    _endBlock() {
        if (this._animState === 'defend') this._animState = 'idle';
        this._blockTimer = 0;
        this._blockWindup = 0;
        this._attackAnimTimer = 0;
    }

    // ========== 格挡弹反（复制玩家盾系统语义） ==========

    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        // 格挡期间（前摇结束后）：所有玩家来源伤害判定为弹反——免伤，近战攻击者被眩晕击退
        if (this._animState === 'defend' && this._blockWindup <= 0 && source && source._faction === 'player') {
            this.shieldSystem._lastParried = true;
            this._triggerBlockParry(source, isMelee);
            return;
        }
        if (this.shieldSystem) this.shieldSystem._lastParried = false;
        super.takeDamage(damage, source, damageType, isMelee);
    }

    _triggerBlockParry(attacker, isMelee) {
        // 格挡受击音效（防御状态每次受击播放）
        this._playSound('block');
        // 与玩家盾系统 triggerParry 同口径：远程/魔法只抵消伤害；近战才眩晕+击退；弹反免疫单位不受影响
        if (!isMelee) return;
        if (!attacker || attacker._parryImmune) return;
        const cfg = this._getSkillConfigs().block;
        if (attacker.applyStun) attacker.applyStun(cfg.parryStunMs ?? 2000);
        const angle = Math.atan2(attacker.y - this.y, attacker.x - this.x);
        if (attacker.applyKnockback) attacker.applyKnockback(angle, cfg.parryKnockback ?? 100);
    }

    // ========== 工具 ==========

    /**
     * 判定目标是否在指定范围内（统一使用 Collider 地面 footprint 半径）。
     */
    _isTargetInRange(target, range) {
        if (!target) return false;
        const r = Math.max(0, range);
        const targetR = target.groundRadius || target.collisionRadius || target.size * 0.6 || 0;
        const dist = Math.hypot(target.x - this.x, target.y - this.y);
        return dist <= r + targetR;
    }

    // ========== 渲染 ==========

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_armored_knight_walk';
            case 'combo': return 'enemy_armored_knight_combo';
            case 'charge': {
                // 两段式：首段完整一轮后切换 9~19 帧循环段（animIntroMs 配置驱动）
                const introMs = this._getSkillConfigs().charge.animIntroMs ?? 2000;
                return (this._chargeElapsed ?? 0) >= introMs
                    ? 'enemy_armored_knight_charge_loop'
                    : 'enemy_armored_knight_charge';
            }
            case 'defend': return 'enemy_armored_knight_defend';
            default: return 'enemy_armored_knight_idle';
        }
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        let flipX = false;
        if (this._animState === 'charge') {
            // 冲锋期间：使用死区朝向（避免追踪 flipX 抖动回头）
            flipX = this._chargeFaceDir < 0;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }
        return {
            spriteSize: renderCfg.spriteSize || 150,
            flipX,
            animState: this._animState,
            animKey: this._getTextureKey(),
        };
    }
}
