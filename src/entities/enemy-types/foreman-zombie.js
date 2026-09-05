import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { playSoundFrom } from './_shared/enemy-utils.js';
import {
    canImpactBasicMelee,
    canStartBasicMelee,
    createBasicMeleeSnapshot,
    rebaseBasicMeleeSnapshot,
} from '../../combat/melee-attack-resolver.js';
import { summonMonster } from './_shared/summon-helper.js';
import { attackFrameAt, attackFrameStartMs } from './_shared/attack-timing.js';

/**
 * 僵尸工头（领主，僵尸 family）
 * - 鞭击：方向性单目标判定 320px，1.5s 动作（逐帧时长/命中帧读配置，物理×2 + 1层流血），
 *   完整攻击图或旧分层图均与伤害共用逻辑时钟和锁向，冷却4.5s，攻击时不可移动
 * - 号召：3s 播放 24 帧，释放后场上全体僵尸方怪物获得激励（移速 ×1.33、物攻 ×1.5，15s），冷却 30s
 * - 死亡：dying 14 帧 → 定格 1s → 淡出；死亡音效第 8 帧
 * 所有数值均来自 enemy-config.json foremanZombie.attackSkills，类内不硬编码
 */
export class ForemanZombie extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.foremanZombie,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 攻击决策完全自管：关闭 CombatSystem 的通用近战触发
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 动画状态：idle | walk | whip | howl | death
        this._animState = 'idle';
        this._animStateTimer = 0;

        // 攻击状态：null | 'whip' | 'howl'
        this._attackType = null;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._hitDone = false;
        this._soundDone = false;
        this._whipCd = 0;
        this._howlCd = 0;
        this._whipTarget = null;
        this._whipSnapshot = null;
        this._whipStrikeHeight = 0;
        this._foremanActionSerial = 0;
        this._foremanActionDuration = 0;
        this._whipImpactPosePending = false;
        this._petrifiedWhipPose = null;

        // 工头登场时建立一个全场唯一矿洞；安全落点失败时短间隔重试。
        // 已成功生成或已发现现存矿洞后，本工头不再补建，玩家摧毁矿洞不会无限刷新。
        this._mineCaveFactory = config.mineCaveFactory || null;
        this._mineCaveSpawnResolved = false;
        this._mineCaveSpawnRetry = 0;

        // 移动音效计时
        this._walkSoundTimer = 0;

        // 死亡三段式 + 死亡音效帧
        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._deathSoundDone = false;
        this._syncVisualMetrics();
    }

    _getWhipConfig() {
        return this.config?.attackSkills?.whip || {};
    }

    _getHowlConfig() {
        return this.config?.attackSkills?.howl || {};
    }

    _getDeathConfig() {
        return this.config?.death || {};
    }

    _getMineCaveSpawnConfig() {
        return this.config?.attackSkills?.mineCaveSpawn || {};
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathSequence(dt);
            return;
        }

        const actionAtTickStart = this._attackType;
        const serialAtTickStart = this._foremanActionSerial;
        super.update(dt, entities);
        if (!this.active || this._isDead) return;

        this._ensureSingleMineCave(dt);

        const attackDt = this.getAttackIntervalDelta(dt);
        if (this._whipCd > 0) this._whipCd -= attackDt;
        if (this._howlCd > 0) this._howlCd -= attackDt;

        if (this.isCombatActionBlocked()) {
            if (this.hasStatusEffect?.('fear')) this._setVisualState('walk');
            else if (!this.hasStatusEffect?.('petrified')) this._setVisualState('idle');
            return;
        }
        if (this._petrifiedWhipPose && !this._attackType) this._setVisualState('idle');
        this._petrifiedWhipPose = null;

        // 攻击帧推进
        // 预警可能在super.update内启动动作；新动作不能立即吃掉创建前的整段dt。
        if (this._attackType && actionAtTickStart && serialAtTickStart === this._foremanActionSerial) {
            this._updateAttack(dt);
        } else if (!this._attackType) {
            this._attackAnimTimer = 0;
        }

        // 状态切换
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        let nextState;
        if (this._attackType === 'whip') {
            nextState = 'whip';
        } else if (this._attackType === 'howl') {
            nextState = 'howl';
        } else {
            const maxSpd = this.maxSpeed ?? this.speed ?? 160;
            nextState = speed > maxSpd * 0.05 ? 'walk' : 'idle';
        }
        this._animStateTimer = (this._animStateTimer || 0) + dt;
        if (nextState !== this._animState && this._animStateTimer >= 80) {
            this._setVisualState(nextState);
        }

        // 朝向
        const t = this.target && this.target.active ? this.target : null;
        if (this._attackType === 'whip' && this._whipSnapshot) {
            this.rotation = this._whipSnapshot.worldAngle;
        } else if (this._attackType && t) {
            this.rotation = Math.atan2(t.y - this.y, t.x - this.x);
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }

        // 移动音效（配置 sounds.walk，按 walkInterval 间隔循环播放）
        if (this._animState === 'walk') {
            this._walkSoundTimer -= dt;
            if (this._walkSoundTimer <= 0) {
                this._walkSoundTimer = this.config?.sounds?.walkInterval ?? 700;
                playSoundFrom(this, 'walk');
            }
        } else {
            this._walkSoundTimer = 0;
        }

        // 攻击决策：号召（冷却就绪且有敌对目标）优先，其次单目标方向性鞭击。
        if (!this._attackType && t) {
            if (this._howlCd <= 0) {
                this._tryAttackTelegraph(() => this._startHowl(entities));
            } else if (this._whipCd <= 0 && this._canStartWhip(t)) {
                this._tryAttackTelegraph(() => this._startAttack('whip'));
            }
        }
    }

    // ========== 鞭击 ==========

    _startAttack(type) {
        const cfg = this._getWhipConfig();
        const target = this.target;
        if (this.isCombatActionBlocked() || this._attackType || type !== 'whip' || !this._canStartWhip(target)) return false;
        const duration = cfg.duration ?? 1500;
        this._foremanActionSerial += 1;
        this._foremanActionDuration = duration;
        this._attackType = type;
        this._attackTimer = duration;
        this._attackAnimTimer = duration; // MovementSystem 锁定（攻击时不可移动）
        this._hitDone = false;
        this._soundDone = false;
        this._whipImpactPosePending = false;
        this._petrifiedWhipPose = null;
        this._setVisualState(type);
        this.vx = 0; this.vy = 0; this.isMoving = false;
        this._whipCd = cfg.cooldown ?? 4500;
        this._whipTarget = target;
        this._whipSnapshot = createBasicMeleeSnapshot(this, target, this._getWhipAttackConfig());
        // 高度在起手锁定，不随目标移动追踪；低矮目标不会被画成鞭子从头顶越过。
        const handHeight = this.config?.attackSkills?.whip?.handHeight ?? 127.394366;
        const targetHeight = target.collider?.height ?? target.collisionBodyHeight ?? target.config?.height ?? 80;
        const relativeZ = (target.collider?.z ?? target.z ?? 0) - (this.collider?.z ?? this.z ?? 0);
        this._whipStrikeHeight = Math.max(8, Math.min(handHeight, relativeZ + targetHeight * 0.6));
        this.rotation = this._whipSnapshot.worldAngle;
        return true;
    }

    _updateAttack(dt) {
        this._whipImpactPosePending = false;
        this._attackTimer = Math.max(0, this._attackTimer - Math.max(0, dt));
        this._attackAnimTimer = Math.max(0, this._attackTimer);
        this.vx = 0; this.vy = 0; this.isMoving = false;

        if (this._attackType === 'howl') {
            if (this._attackTimer <= 0) {
                this._attackTimer = 0;
                this._attackType = null;
                this._clearWhipLock();
                this._setVisualState('idle');
            }
            return;
        }

        const cfg = this._getWhipConfig();
        const duration = this._foremanActionDuration || cfg.duration || 1500;
        const layout = this._getFrameLayout('whip');
        const elapsed = duration - this._attackTimer;

        // 鞭击音效帧（配置 sounds.whipFrame）
        const soundFrame = this.config?.sounds?.whipFrame;
        if (!this._soundDone && typeof soundFrame === 'number' && elapsed >= attackFrameStartMs(layout, soundFrame, duration)) {
            this._soundDone = true;
            playSoundFrom(this, 'whip');
        }

        // 第 hitFrame 帧伤害判定
        if (!this._hitDone && elapsed >= attackFrameStartMs(layout, cfg.hitFrame ?? 21, duration)) {
            this._hitDone = true;
            this._whipImpactPosePending = true;
            this._dealWhipHit();
            // 弹反/受击回调可能同步中断工头，不继续保留已取消的攻击画面。
            if (this._attackType !== 'whip') return;
        }

        // 长帧跨过整个接触窗口时，至少呈现一次接触姿势；下一逻辑帧再收尾。
        if (this._attackTimer <= 0 && !this._whipImpactPosePending) {
            this._attackTimer = 0;
            this._attackType = null;
            this._clearWhipLock();
            this._setVisualState('idle');
        }
    }

    _getWhipAttackConfig() {
        const cfg = this._getWhipConfig();
        return {
            range: cfg.range ?? this.attackDistance ?? 320,
            width: cfg.width ?? this.config?.attack?.width ?? 26,
        };
    }

    getBasicMeleeApproachConfig() {
        return this._getWhipAttackConfig();
    }

    _canStartWhip(target) {
        return canStartBasicMelee(this, target, this._getWhipAttackConfig());
    }

    _clearWhipLock() {
        this._whipTarget = null;
        this._whipSnapshot = null;
        this._whipImpactPosePending = false;
    }

    /** 只结算起手锁定目标；重锚当前脚点但绝不重新瞄准。鞭层由场景统一绘制。 */
    _dealWhipHit() {
        const cfg = this._getWhipConfig();
        const target = this._whipTarget;
        const atk = this.data?.atk || 0;
        const bleedStacks = cfg.bleedStacks ?? 1;
        const snapshot = rebaseBasicMeleeSnapshot(this, this._whipSnapshot);
        if (canImpactBasicMelee(this, target, snapshot)) {
            target.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 2))), this, 'physical', true);
            const parried = target.shieldSystem && target.shieldSystem._lastParried;
            if (!parried && typeof target.applyBleeding === 'function') {
                target.applyBleeding(bleedStacks);
            }
        }
    }

    // ========== 号召 ==========

    _startHowl(entities) {
        if (this.isCombatActionBlocked() || this._attackType) return false;
        const cfg = this._getHowlConfig();
        this._clearWhipLock();
        const duration = cfg.duration ?? 3000;
        this._foremanActionSerial += 1;
        this._foremanActionDuration = duration;
        this._attackType = 'howl';
        this._attackTimer = duration;
        this._attackAnimTimer = duration; // MovementSystem 锁定
        this._setVisualState('howl');
        this.vx = 0; this.vy = 0; this.isMoving = false;
        this._howlCd = cfg.cooldown ?? 30000;
        // 号召音效（直接播放）
        playSoundFrom(this, 'howl');
        // 场上与僵尸工头同阵营（_faction === 'enemy'）的友方单位获得激励（含自身）。
        // 矿洞、煮锅等站桩召唤器通常持有 statusImmune，applyInspire 开头会主动拦截，故不会获得激励。
        const list = Array.isArray(entities) ? entities : (entities ? Array.from(entities.values()) : []);
        for (const e of list) {
            if (!e || !e.active || e._faction !== 'enemy') continue;
            if (typeof e.applyInspire === 'function') {
                e.applyInspire(cfg.buffDuration ?? 15000, {
                    speedMul: cfg.speedMul ?? 1.33,
                    atkMul: cfg.atkMul ?? 1.5,
                });
            }
        }
        return true;
    }

    // ========== 死亡三段式（动画 → 定格 → 淡出；死亡音效在第 8 帧） ==========

    _updateDeathSequence(dt) {
        const D = this._getDeathConfig();
        const animMs = D.animMs ?? 1400;
        const previousAnimTimer = this._deathAnimTimer;
        if (this._deathAnimTimer > 0) this._deathAnimTimer = Math.max(0, this._deathAnimTimer - dt);
        if (!this._deathSoundDone && previousAnimTimer > 0) {
            const soundFrame = this.config?.sounds?.deathFrame;
            if (typeof soundFrame === 'number') {
                const elapsed = animMs - this._deathAnimTimer;
                if (elapsed >= attackFrameStartMs(this._getFrameLayout('death'), soundFrame, animMs)) {
                    this._deathSoundDone = true;
                    playSoundFrom(this, 'death');
                }
            } else {
                this._deathSoundDone = true;
            }
        }
        if (previousAnimTimer > 0) {
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
        this._setVisualState('death');
        this._attackType = null;
        this._clearWhipLock();
        this._petrifiedWhipPose = null;
        this._deathAnimTimer = this._getDeathConfig().animMs ?? 1400;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._deathSoundDone = false;
        // 最后一名工头死亡时同步清除矿洞；仍有其他工头在场则保留共享矿洞。
        if (!this._hasOtherActiveForeman()) this._killAllMineCaves(source);
        if (typeof super.onDeath === 'function') {
            super.onDeath(source);
        }
    }

    _ensureSingleMineCave(dt) {
        if (this._mineCaveSpawnResolved || typeof this._mineCaveFactory !== 'function') return;
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game || !game.entities) return;

        for (const e of game.entities.values()) {
            if (e && e.active && e.id === 'mineCave') {
                this._mineCaveSpawnResolved = true;
                return;
            }
        }

        this._mineCaveSpawnRetry -= dt;
        if (this._mineCaveSpawnRetry > 0) return;

        const cfg = this._getMineCaveSpawnConfig();
        const created = summonMonster(this, {
            factory: this._mineCaveFactory,
            count: 1,
            mode: 'radial',
            radius: cfg.radius ?? 64,
            distance: cfg.distance ?? 180,
            tag: 'foreman_mine_cave',
            setAnchor: true,
            statusImmune: true,
            playFx: true,
        });
        if (created.length > 0) {
            const cave = created[0];
            cave._spawnDirX = cave.x >= this.x ? 1 : -1;
            this._mineCaveSpawnResolved = true;
        } else {
            this._mineCaveSpawnRetry = cfg.retryMs ?? 500;
        }
    }

    _hasOtherActiveForeman() {
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game || !game.entities) return false;
        for (const e of game.entities.values()) {
            if (e && e !== this && e.active && e.id === 'foremanZombie') return true;
        }
        return false;
    }

    _killAllMineCaves(source) {
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game || !game.entities) return;
        for (const e of game.entities.values()) {
            if (!e || !e.active || e.id !== 'mineCave') continue;
            // 矿洞同步死亡（走正常死亡流程，避免残留）
            if (typeof e.onDeath === 'function') {
                e.onDeath(source);
            } else if (typeof e.takeDamage === 'function') {
                // 这是首领死亡时的结构联动清理，不是空间近战命中，不能被承载面门禁拦截。
                e.takeDamage(99999, source, 'physical', false);
            }
        }
    }

    // ========== 动画 ==========

    _getFrameLayout(state = this._animState) {
        const key = state === 'whip' ? 'attack' : state;
        return this.config?.textures?.frameLayouts?.[key] || {
            frameWidth: 512, frameHeight: 512, frameCount: 1, footX: 256, footY: 414,
        };
    }

    _setVisualState(state) {
        if (this._animState !== state) {
            this._animState = state;
            this._animStateTimer = 0;
        }
        // GameScene先同步位置再选帧，状态变化时立即换算脚点。
        this._syncVisualMetrics();
    }

    _syncVisualMetrics(layout = this._getFrameLayout()) {
        const scale = (this.config?.render?.spriteSize ?? 480) / (this.config?.textures?.referenceCell ?? 512);
        const offsetY = this.colliderOffsetY ?? this.config?.render?.colliderOffsetY ?? 0;
        this.footOffsetY = (layout.footY - layout.frameHeight / 2) * scale - offsetY;
    }

    _getWhipVisualFrame() {
        if (this.hasStatusEffect?.('petrified') && this._petrifiedWhipPose) return this._petrifiedWhipPose.frame;
        if (this._whipImpactPosePending) return this._getWhipConfig().hitFrame ?? 21;
        const duration = this._foremanActionDuration || this._getWhipConfig().duration || 1500;
        return attackFrameAt(this._getFrameLayout('whip'), duration - this._attackTimer, duration);
    }

    getWhipVisualState() {
        if (this.hasStatusEffect?.('petrified') && this._petrifiedWhipPose) {
            return { ...this._petrifiedWhipPose, petrified: true };
        }
        if (!this.active || this._attackType !== 'whip' || !this._whipSnapshot) return null;
        return {
            frame: this._getWhipVisualFrame(),
            angle: this._whipSnapshot.angle,
            reach: this._whipSnapshot.reach,
            strikeHeight: this._whipStrikeHeight,
            flipX: Math.cos(this._whipSnapshot.worldAngle) < 0,
        };
    }

    _onCombatActionInterruptedByControl() {
        const petrified = this.hasStatusEffect?.('petrified');
        this._petrifiedWhipPose = petrified ? this.getWhipVisualState() : null;
        // 石化冻结的是已经显示的帧；不能用本逻辑帧尚未渲染的进度替换。
        const sprite = this._phaserSprite;
        const visibleFrame = Number(sprite?.frame?.name);
        if (this._petrifiedWhipPose && sprite?.texture?.key === 'enemy_foreman_attack'
            && Number.isInteger(visibleFrame) && visibleFrame >= 0
            && visibleFrame < this._getFrameLayout('whip').frameCount) {
            this._petrifiedWhipPose.frame = visibleFrame;
            this._petrifiedWhipPose.flipX = sprite.flipX;
        }
        super._onCombatActionInterruptedByControl();
        this._attackType = null;
        this._clearWhipLock();
        if (!petrified) this._setVisualState(this.hasStatusEffect?.('fear') ? 'walk' : 'idle');
    }

    _syncPetrifiedBodyAnchor(sprite) {
        const key = sprite.texture?.key?.replace('enemy_foreman_', '');
        const layout = this._getFrameLayout(key === 'attack' ? 'whip' : key);
        const scaleX = Math.abs(sprite.scaleX), scaleY = Math.abs(sprite.scaleY);
        const mirror = sprite.flipX ? -1 : 1;
        const offsetX = this.colliderOffsetX ?? this.config?.render?.colliderOffsetX ?? 0;
        const offsetY = this.colliderOffsetY ?? this.config?.render?.colliderOffsetY ?? 0;
        sprite.x += (layout.frameWidth / 2 - layout.footX) * scaleX * mirror + offsetX;
        sprite.y += this.footOffsetY - (layout.footY - layout.frameHeight / 2) * scaleY + offsetY;
    }

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_foreman_walk';
            case 'whip': return 'enemy_foreman_attack';
            case 'howl': return 'enemy_foreman_howl';
            case 'death': return 'enemy_foreman_death';
            default: return 'enemy_foreman_idle';
        }
    }

    _getPhaserOptions() {
        // 原始素材面向右，目标/移动方向朝左时翻转
        let flipX = false;
        if (this.hasStatusEffect?.('petrified') && this._petrifiedWhipPose) {
            flipX = this._petrifiedWhipPose.flipX;
        } else if (this._attackType === 'whip' && this._whipSnapshot) {
            flipX = Math.cos(this._whipSnapshot.worldAngle) < 0;
        } else if (this._attackType && this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }

        const renderCfg = this.config?.render || {};
        const baseSize = renderCfg.spriteSize ?? 480;
        const scale = baseSize / (this.config?.textures?.referenceCell ?? 512);
        const layout = this._getFrameLayout();
        const spriteSize = Math.max(layout.frameWidth, layout.frameHeight) * scale;
        this._syncVisualMetrics(layout);
        let frame;
        if (this._animState === 'whip') frame = this._getWhipVisualFrame();
        else if (this._animState === 'howl') frame = attackFrameAt(layout,
            this._foremanActionDuration - this._attackTimer, this._foremanActionDuration);
        else if (this._animState === 'death') frame = attackFrameAt(layout,
            (this._getDeathConfig().animMs ?? 1400) - this._deathAnimTimer, this._getDeathConfig().animMs ?? 1400);
        // animState 映射：攻击/号召/死亡均为一次性动画（防重播）
        const animStateMap = { whip: 'attack', howl: 'attack', death: 'death' };
        const animState = animStateMap[this._animState] || this._animState;
        return {
            spriteSize,
            dynamicSpriteSize: true,
            frameAnchorX: layout.footX - (this.colliderOffsetX ?? renderCfg.colliderOffsetX ?? 0) / scale * (flipX ? -1 : 1),
            ...(frame !== undefined ? { manualFrame: true, frame } : {}),
            collisionWidth: renderCfg.collisionWidth || 60,
            collisionHeight: renderCfg.collisionHeight || 120,
            textOffsetY: -baseSize / 2 - 10,
            flipX,
            animState,
            animKey: this._getTextureKey(),
        };
    }
}
