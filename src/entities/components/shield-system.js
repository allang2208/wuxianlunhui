import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import { isGunWeapon } from '../../config/gun-ammo.js';
import { getShieldDefenseValues } from '../../config/shield-config.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SanctuaryDomainFx } from '../../effects/sanctuary-domain-fx.js';
import {
    registerLegendaryShieldWard,
    unregisterLegendaryShieldWard,
} from '../../combat/legendary-shield-ward.js';
export class ShieldSystem {
    constructor(player) {
        this.player = player;
        this.active = false;        // 是否装备盾
        this.defending = false;     // 是否正在防御
        this.defenseElapsedMs = 0; // 与玩家更新共用游戏dt，暂停不消耗时窗
        this._equippedShield = null;
        this._equippedSlot = null;
        this._lastParried = false; // 本次受击结果，由 Player.takeDamage 入口重置
        this._afterBlockGuard = null;
        this._afterBlockCooldownMs = 0;
        this._passiveCooldownMs = { melee: 0, projectile: 0 };
        this._parryReflectionCooldownMs = 0;
        this._arcaneRetortCooldownMs = 0;
        this._returnGuardStacks = 0;
        this._returnGuardStackRemainingMs = 0;
        this._returnGuardReadyRemainingMs = 0;
        this._returnGuardBoostStacks = 0;
        this._returnGuardCooldownMs = 0;
        this._nullFieldRemainingMs = 0;
        this._nullFieldCooldownMs = 0;
        this._causalDebts = [];
        this._oathReserve = 0;
        this._oathReserveDecayRemainingMs = 0;
        this._oathSanctifyRemainingMs = 0;
        this._oathWardRemainingMs = 0;
        this._oathWardAnchor = null;
        this._oathWardFx = null;
        this._oathWardConfig = null;
        this._sceneMarker = undefined;
    }

    // 进入防御状态
    enterDefense() {
        if (!this.checkEquipped() || this.defending || !this.canDefend()) return;
        // 耗空体力后不能反复松按右键，以零体力重开免费弹反窗。
        if (!(this.player.data.stamina > 0)) return;
        this.defending = true;
        this.defenseElapsedMs = 0;
        const returnGuard = this.getDefenseValues().returnGuard;
        if (returnGuard && this._returnGuardReadyRemainingMs > 0
            && this._returnGuardCooldownMs <= 0) {
            this._returnGuardBoostStacks = returnGuard.requiredStacks;
            this._returnGuardReadyRemainingMs = 0;
        }
    }

    // 退出防御状态
    exitDefense(reason = 'forced') {
        if (this.defending) {
            const defense = this.getDefenseValues();
            this._finishReturnGuardDefense(reason, defense.returnGuard);
            this._collapseNullField(defense.nullField);
            this._finishOathDefense(reason, defense.oathReserve);
        }
        this.defending = false;
        this.defenseElapsedMs = 0;
    }

    update(dt) {
        const sceneMarker = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (this._sceneMarker !== undefined && this._sceneMarker !== sceneMarker) {
            this.settleCausalDebt('scene');
            this.resetTransientState({ discardDebt: true });
        }
        this._sceneMarker = sceneMarker;
        this.checkEquipped();
        const elapsed = Math.max(0, Number(dt) || 0);
        this._afterBlockCooldownMs = Math.max(0, this._afterBlockCooldownMs - elapsed);
        this._passiveCooldownMs.melee = Math.max(0, this._passiveCooldownMs.melee - elapsed);
        this._passiveCooldownMs.projectile = Math.max(0, this._passiveCooldownMs.projectile - elapsed);
        this._parryReflectionCooldownMs = Math.max(0, this._parryReflectionCooldownMs - elapsed);
        this._arcaneRetortCooldownMs = Math.max(0, this._arcaneRetortCooldownMs - elapsed);
        this._returnGuardCooldownMs = Math.max(0, this._returnGuardCooldownMs - elapsed);
        this._nullFieldCooldownMs = Math.max(0, this._nullFieldCooldownMs - elapsed);
        if (this._returnGuardStackRemainingMs > 0) {
            this._returnGuardStackRemainingMs = Math.max(0, this._returnGuardStackRemainingMs - elapsed);
            if (this._returnGuardStackRemainingMs <= 0) this._clearReturnGuardStacks();
        }
        if (this._returnGuardReadyRemainingMs > 0) {
            this._returnGuardReadyRemainingMs = Math.max(0, this._returnGuardReadyRemainingMs - elapsed);
            if (this._returnGuardReadyRemainingMs <= 0) {
                const cfg = this.getDefenseValues().returnGuard;
                this._returnGuardCooldownMs = Math.max(this._returnGuardCooldownMs, cfg?.cooldownMs || 0);
            }
        }
        if (this._nullFieldRemainingMs > 0) {
            this._nullFieldRemainingMs = Math.max(0, this._nullFieldRemainingMs - elapsed);
            if (this._nullFieldRemainingMs <= 0) {
                const cfg = this.getDefenseValues().nullField;
                this._nullFieldCooldownMs = Math.max(this._nullFieldCooldownMs, cfg?.cooldownMs || 0);
            }
        }
        if (this._afterBlockGuard) {
            this._afterBlockGuard.remainingMs -= elapsed;
            if (this._afterBlockGuard.remainingMs <= 0) {
                this._afterBlockCooldownMs = Math.max(
                    this._afterBlockCooldownMs,
                    this._afterBlockGuard.cooldownMs
                );
                this._afterBlockGuard = null;
            }
        }
        this._updateCausalDebt(elapsed);
        this._updateOathState(elapsed);
        if (!this.defending) return;
        if (!this.canDefend()) {
            this.exitDefense('forced');
            return;
        }
        this.defenseElapsedMs += elapsed;
    }

    syncInput(held) {
        if (!held) this.exitDefense('voluntary');
        else if (!this.canDefend()) this.exitDefense('forced');
        else this.enterDefense();
    }

    canDefend() {
        const p = this.player;
        if (!this.getShieldData() || p._isDead || p._frozenAbyssFalling || p.isStunned
            || p.isDodging || p._isDashing || p._dashRecoverAt || p._dashResetAnim
            || p._isWhirlwind || p._whirlwindRecovering || p._isPushStrike
            || p._specialAttackActive || p._runeSwordSpecialActive
            || p._castState === 'casting' || p._castState === 'recover') return false;
        if (['stun', 'frozen', 'petrified', 'fear'].some(type => p.hasStatusEffect?.(type))) return false;
        const main = p.equipments?.[p.weaponMode];
        const pistol = main && (main.weaponType === 'pistol' || main.rangedType === 'pistol');
        if (isGunWeapon(main) && !pistol) return false;
        // 保留手枪+盾开火；近战出手与收势期间不能叠加格挡。
        return pistol || !(p.weaponAnim?.isAttacking
            || (p.weaponAnim?.state && p.weaponAnim.state !== 'idle'));
    }

    getDefenseValues() {
        const skill = this.player.skills?.shieldDefense;
        return getShieldDefenseValues(this.getShieldData(), skill?.getEffect?.(skill.level));
    }

    // 本次举盾起算；配置0表示禁用弹反，不会被默认值覆盖。
    canParry() {
        const defense = this.getDefenseValues();
        const windowMs = defense.parryWindow
            + (defense.returnGuard?.parryWindowPerStackMs || 0) * this._returnGuardBoostStacks;
        return this.defending && windowMs > 0 && this.defenseElapsedMs <= windowMs;
    }

    // 处理受伤：返回 { damage, parried, blocked }
    // 在 player.takeDamage 中调用
    onDamageTaken(damage, attacker, isMelee, damageType = 'physical', hitContext = null) {
        this._lastParried = false; // 兼容直接调用；不是跨帧状态
        this.checkEquipped();
        if (!this.canDefend()) this.exitDefense('forced');
        if (!this.defending || !(damage > 0)) {
            return { damage, parried: false, blocked: false };
        }
        const defense = this.getDefenseValues();

        // 弹反判定：防御后弹反窗口内 + 面朝角度限制（不再限制仅近战可弹反）
        if (this.canParry() && Number.isFinite(attacker?.x) && Number.isFinite(attacker?.y)) {
            // 检查面朝角度：只有面朝攻击者一定角度内才能弹反
            const parryAngle = defense.parryHalfAngle * Math.PI / 180;
            const angleToAttacker = Math.atan2(attacker.y - this.player.y, attacker.x - this.player.x);
            const playerFacing = this._getPlayerFacingAngle();
            let angleDiff = Math.abs(angleToAttacker - playerFacing);
            while (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

            if (angleDiff <= parryAngle) {
                this._handleMythicParrySuccess(defense);
                if (hitContext?.disableLegendaryShieldEffects !== true) {
                    this._handleLegendaryParrySuccess(defense);
                }
                this._triggerEpicParryEffects(damage, attacker, isMelee, damageType, hitContext, defense);
                this.triggerParry(attacker, isMelee);
                this._addShieldExp(isMelee, true);
                this._lastParried = true;
                return { damage: 0, parried: true, blocked: false };
            }
            // 面朝角度不足：回退到普通防御
        }

        // 归墟吞星镜“事件视界”：只接管敌方直接投射物，且判定排在成功弹反之后。
        // 首击消耗独立触发体力并归零；短场内后续投射物按专属比例承伤，不再扣普通格挡体力。
        const directEnemyHit = this._isDirectEnemyHit(attacker, hitContext);
        const nullField = defense.nullField;
        if (directEnemyHit && hitContext?.isProjectile === true && nullField) {
            if (this._nullFieldRemainingMs > 0) {
                this._playSound('assets/sounds/shield/wood_hit_crisp_cavity_1s.wav');
                this._addShieldExp(false, false);
                return {
                    damage: damage * nullField.remainingDamageRatio,
                    parried: false,
                    blocked: true,
                    nullField: true,
                    nullified: false,
                };
            }
            if (this._nullFieldCooldownMs <= 0 && nullField.durationMs > 0
                && this.player.data.stamina >= nullField.triggerStamina) {
                this.player.data.stamina -= nullField.triggerStamina;
                this._nullFieldRemainingMs = nullField.durationMs;
                this._playSound('assets/sounds/shield/wood_thud_1s.wav');
                this._addShieldExp(false, false);
                return {
                    damage: 0,
                    parried: false,
                    blocked: true,
                    nullField: true,
                    nullified: true,
                };
            }
        }

        // 正常防御：减伤 + 扣体力
        const magicDamage = damageType === 'magic' || damageType === 'electric';
        const reducedDamage = damage * (magicDamage
            ? defense.magicRemainingDamageRatio
            : defense.remainingDamageRatio);
        const staminaCost = defense.staminaCost;

        // 播放防御受击音效（非弹反）
        this._playSound('assets/sounds/shield/wood_hit_crisp_cavity_1s.wav');

        if (this.player.data.stamina < staminaCost) {
            // 体力不足 → 眩晕，取消防御
            this.player.data.stamina = 0;
            this.exitDefense('forced');
            if (defense.stunOnExhaustion > 0) this.player.applyStun(defense.stunOnExhaustion);
            return { damage: reducedDamage, parried: false, blocked: true };
        }

        this.player.data.stamina -= staminaCost;
        // 防御经验读取技能 expRewards（当前配置：近战+2，远程+5）。
        this._addShieldExp(isMelee, false);
        this._recordReturnGuardBlock(attacker, hitContext, defense.returnGuard);
        this._recordOathReserve(
            damage,
            reducedDamage,
            attacker,
            isMelee,
            hitContext,
            defense.oathReserve
        );
        const eligibleLegendaryHit = this._isEligibleDirectHit(attacker, isMelee, hitContext);
        return {
            damage: reducedDamage,
            parried: false,
            blocked: true,
            causalDebt: eligibleLegendaryHit ? defense.causalDebt : null,
        };
    }

    /**
     * 为一次合格的非防御直击判定盾牌被动。只返回候选，不立刻写冷却，
     * 由玩家伤害链与主手/护甲候选比较后提交最强的一项。
     */
    rollPassiveBlock(isMelee, hitContext = null) {
        if (this.defending || !this.checkEquipped()) return null;
        const kind = isMelee === true
            ? 'melee'
            : (hitContext?.isProjectile === true ? 'projectile' : null);
        if (!kind || this._passiveCooldownMs[kind] > 0) return null;
        const defense = this.getDefenseValues();
        const cfg = kind === 'melee'
            ? defense.passiveMeleeBlock
            : defense.passiveProjectileBlock;
        if (!cfg || Math.random() >= cfg.chance) return null;
        return {
            source: 'shield',
            kind,
            reductionPercent: cfg.reductionPercent,
            remainingDamageRatio: 1 - cfg.reductionPercent,
            cooldownMs: cfg.cooldownMs,
        };
    }

    commitPassiveBlock(candidate) {
        if (!candidate || candidate.source !== 'shield') return;
        const kind = candidate.kind;
        if (kind !== 'melee' && kind !== 'projectile') return;
        this._passiveCooldownMs[kind] = Math.max(
            this._passiveCooldownMs[kind],
            Math.max(0, Number(candidate.cooldownMs) || 0)
        );
    }

    armAfterBlockGuard() {
        if (this._afterBlockGuard || this._afterBlockCooldownMs > 0) return false;
        const cfg = this.getDefenseValues().afterBlockGuard;
        if (!cfg) return false;
        this._afterBlockGuard = {
            reductionPercent: cfg.reductionPercent,
            remainingMs: cfg.durationMs,
            cooldownMs: cfg.cooldownMs,
            charges: cfg.charges,
        };
        return true;
    }

    consumeAfterBlockGuard(damage, eligible) {
        if (!eligible || !(damage > 0) || !this._afterBlockGuard) {
            return { damage, triggered: false };
        }
        const guard = this._afterBlockGuard;
        const reduced = Math.max(0, Math.floor(damage * (1 - guard.reductionPercent)));
        guard.charges -= 1;
        if (guard.charges <= 0) {
            this._afterBlockCooldownMs = Math.max(this._afterBlockCooldownMs, guard.cooldownMs);
            this._afterBlockGuard = null;
        }
        return { damage: reduced, triggered: true };
    }

    resetTransientState({ discardDebt = false } = {}) {
        this.exitDefense('reset');
        this._afterBlockGuard = null;
        this._afterBlockCooldownMs = 0;
        this._passiveCooldownMs.melee = 0;
        this._passiveCooldownMs.projectile = 0;
        this._parryReflectionCooldownMs = 0;
        this._arcaneRetortCooldownMs = 0;
        this._returnGuardStacks = 0;
        this._returnGuardStackRemainingMs = 0;
        this._returnGuardReadyRemainingMs = 0;
        this._returnGuardBoostStacks = 0;
        this._returnGuardCooldownMs = 0;
        this._nullFieldRemainingMs = 0;
        this._nullFieldCooldownMs = 0;
        this._collapseOathWard();
        this._oathReserve = 0;
        this._oathReserveDecayRemainingMs = 0;
        this._oathSanctifyRemainingMs = 0;
        if (discardDebt) this._causalDebts = [];
        this._lastParried = false;
    }

    onCraftEffectsChanged(item) {
        if (item !== this.getShieldData()) return;
        this.settleCausalDebt('craft');
        this.resetTransientState({ discardDebt: true });
    }

    // 触发弹反效果：近战攻击才会眩晕 + 击退；远程/魔法只抵消伤害、不耗体力
    triggerParry(attacker, isMelee) {
        if (!attacker) return;
        const defense = this.getDefenseValues();

        // 播放弹反音效
        this._playSound('assets/sounds/shield/wood_thud_1s.wav');

        // 史诗返击/还击在这里之前结算；目标已死亡时不再追加控制或击退。
        if (!this._isAliveTarget(attacker)) return;

        // 只有近战攻击才施加眩晕、击退、打断冲刺
        if (!isMelee) return;

        // 弹反免疫单位（如集合体）：弹反不造成眩晕/打断/击退，动作不被打断；
        // 玩家侧收益（免伤/免体力/弹反音效/防御经验）不受影响，照常生效
        if (attacker._parryImmune) return;

        // 攻击者眩晕（基础时间 + 持盾防御技能加成）
        if (defense.parryStun > 0) attacker.applyStun?.(defense.parryStun);

        // 立即停止冲刺攻击（修复：黑狼冲刺不停止）
        if (attacker._attackTimer > 0) {
            attacker._attackTimer = 0;
            attacker._attackDashOffset = 0;
            attacker._dashBlocked = false;
            attacker._animState = 'idle';
            if (attacker._pendingThrust) attacker._pendingThrust.active = false;
        }

        // 攻击者被击退（使用统一的击退系统）
        const angle = Math.atan2(attacker.y - this.player.y, attacker.x - this.player.x);
        if (defense.parryKnockback > 0) attacker.applyKnockback?.(angle, defense.parryKnockback);
    }

    _triggerEpicParryEffects(damage, attacker, isMelee, damageType, hitContext, defense) {
        if (!this._isDirectEnemyHit(attacker, hitContext)) return;
        const retaliationContext = {
            isShieldRetaliation: true,
            ignoreMagicVulnerability: true,
            magicPenetrationPercent: 0,
            _resolvedCritTarget: attacker,
            _resolvedCrit: false,
        };

        const reflection = defense.parryReflection;
        if (isMelee === true && reflection && this._parryReflectionCooldownMs <= 0
            && reflection.damageRatio > 0 && reflection.maxHpCapRatio > 0
            && typeof attacker.takeDamage === 'function') {
            const reflectedByDamage = Math.floor(damage * reflection.damageRatio);
            const maxHp = Math.max(0, Number(this.player.data?.maxHp) || 0);
            const reflectedCap = Math.floor(maxHp * reflection.maxHpCapRatio);
            const reflectedDamage = Math.max(0, Math.min(reflectedByDamage, reflectedCap));
            if (reflectedDamage > 0) {
                attacker.takeDamage(reflectedDamage, this.player, 'physical', true, retaliationContext);
                this._parryReflectionCooldownMs = reflection.cooldownMs;
            }
        }

        const magicHit = damageType === 'magic' || damageType === 'electric';
        const retort = defense.arcaneRetort;
        if (!magicHit || !retort || this._arcaneRetortCooldownMs > 0
            || typeof attacker.takeDamage !== 'function') return;
        const matk = Math.max(0, Number(this.player.data?.matk) || 0);
        const rawDamage = Math.floor(retort.baseDamage
            + matk * retort.matkRatio
            + damage * retort.preventedDamageRatio);
        const damageCap = Math.floor(retort.capBaseDamage + matk * retort.capMatkRatio);
        const arcaneDamage = Math.max(0, Math.min(rawDamage, damageCap));
        if (!(arcaneDamage > 0)) return;
        attacker.takeDamage(arcaneDamage, this.player, 'magic', false, retaliationContext);
        if (this._isAliveTarget(attacker) && retort.magicResistanceShred > 0
            && retort.shredDurationMs > 0) {
            attacker.applyMagicResistanceShred?.(
                retort.magicResistanceShred,
                retort.shredDurationMs,
                this.player
            );
        }
        this._arcaneRetortCooldownMs = retort.cooldownMs;
    }

    _recordReturnGuardBlock(attacker, hitContext, cfg) {
        if (!cfg || this._returnGuardBoostStacks > 0 || this._returnGuardReadyRemainingMs > 0
            || this._returnGuardCooldownMs > 0 || !this._isDirectEnemyHit(attacker, hitContext)) return;
        this._returnGuardStacks = Math.min(cfg.requiredStacks, this._returnGuardStacks + 1);
        this._returnGuardStackRemainingMs = cfg.stackDurationMs;
    }

    _clearReturnGuardStacks() {
        this._returnGuardStacks = 0;
        this._returnGuardStackRemainingMs = 0;
    }

    _finishReturnGuardDefense(reason, cfg) {
        if (!cfg) {
            this._clearReturnGuardStacks();
            this._returnGuardBoostStacks = 0;
            this._returnGuardReadyRemainingMs = 0;
            return;
        }
        if (this._returnGuardBoostStacks > 0) {
            this._returnGuardBoostStacks = 0;
            this._returnGuardCooldownMs = Math.max(this._returnGuardCooldownMs, cfg.cooldownMs);
        }
        if (this._returnGuardStacks <= 0) return;
        if (reason === 'voluntary' && this._returnGuardStacks >= cfg.requiredStacks
            && this._returnGuardCooldownMs <= 0) {
            this._returnGuardReadyRemainingMs = cfg.readyDurationMs;
        } else if (reason !== 'voluntary') {
            this._returnGuardCooldownMs = Math.max(this._returnGuardCooldownMs, cfg.cooldownMs);
        }
        this._clearReturnGuardStacks();
    }

    _handleMythicParrySuccess(defense) {
        const returnGuard = defense.returnGuard;
        if (returnGuard && this._returnGuardBoostStacks > 0) {
            const refund = returnGuard.staminaRefundPerStack * this._returnGuardBoostStacks;
            const maxStamina = Math.max(0, Number(this.player.data?.maxStamina) || 0);
            this.player.data.stamina = Math.min(maxStamina, this.player.data.stamina + refund);
            this._returnGuardBoostStacks = 0;
            this._returnGuardCooldownMs = Math.max(this._returnGuardCooldownMs, returnGuard.cooldownMs);
        }
        const nullField = defense.nullField;
        if (nullField?.parryCooldownRefundMs > 0 && this._nullFieldCooldownMs > 0) {
            this._nullFieldCooldownMs = Math.max(
                0,
                this._nullFieldCooldownMs - nullField.parryCooldownRefundMs
            );
        }
    }

    _handleLegendaryParrySuccess(defense) {
        const debt = defense.causalDebt;
        if (debt?.eraseOnParryRatio > 0 && this._causalDebts.length > 0) {
            const erased = this._eraseCausalDebt(debt.eraseOnParryRatio);
            if (erased > 0) {
                EffectManager.add(new FloatingTextEffect(
                    this.player.x,
                    this.player.y - this.player.size - 34,
                    `逆命抹债 ${erased}`,
                    '#e7bd62'
                ));
            }
        }
        const oath = defense.oathReserve;
        if (oath && this._oathReserve > 0 && oath.sanctifyDurationMs > 0) {
            this._oathSanctifyRemainingMs = oath.sanctifyDurationMs;
            EffectManager.add(new FloatingTextEffect(
                this.player.x,
                this.player.y - this.player.size - 34,
                '终誓圣化：主动收盾展开庇护',
                '#ffe3a0'
            ));
        }
    }

    convertFinalDamageToCausalDebt(damage, cfg) {
        const safeDamage = Math.max(0, Number(damage) || 0);
        if (!(safeDamage > 0) || !cfg || !(cfg.splitRatio > 0)
            || !(cfg.maxHpCapRatio > 0)) {
            return { damage: safeDamage, deferred: 0 };
        }
        const maxHp = Math.max(0, Number(this.player.data?.maxHp) || 0);
        const capacity = Math.floor(maxHp * cfg.maxHpCapRatio);
        const unpaid = this._getUnpaidCausalDebt();
        const available = Math.max(0, capacity - unpaid);
        const requested = Math.floor(safeDamage * cfg.splitRatio);
        const deferred = Math.max(0, Math.min(requested, available));
        if (!(deferred > 0)) return { damage: safeDamage, deferred: 0 };
        this._causalDebts.push({
            total: deferred,
            paid: 0,
            delayMs: Math.max(0, Number(cfg.graceMs) || 0),
            elapsedMs: 0,
            durationMs: Math.max(1, Number(cfg.repayDurationMs) || 1),
        });
        EffectManager.add(new FloatingTextEffect(
            this.player.x,
            this.player.y - this.player.size - 18,
            `逆命劫债 +${deferred}`,
            '#d6a84d'
        ));
        return { damage: safeDamage - deferred, deferred };
    }

    settleCausalDebt(_reason = 'settle') {
        const amount = this._getUnpaidCausalDebt();
        this._causalDebts = [];
        if (!(amount > 0) || this.player._isDead || !(this.player.data?.hp > 0)) return amount;
        this._applyCausalDebtDamage(amount, true);
        return amount;
    }

    hasCausalDebt() {
        return this._getUnpaidCausalDebt() > 0;
    }

    _updateCausalDebt(elapsed) {
        if (this.player._isDead || !(this.player.data?.hp > 0)) {
            this._causalDebts = [];
            return;
        }
        if (!(elapsed > 0) || this._causalDebts.length === 0) return;
        for (const debt of this._causalDebts) {
            let activeElapsed = elapsed;
            if (debt.delayMs > 0) {
                const consumed = Math.min(debt.delayMs, activeElapsed);
                debt.delayMs -= consumed;
                activeElapsed -= consumed;
            }
            if (!(activeElapsed > 0)) continue;
            debt.elapsedMs = Math.min(debt.durationMs, debt.elapsedMs + activeElapsed);
            const targetPaid = debt.elapsedMs >= debt.durationMs
                ? debt.total
                : Math.floor(debt.total * debt.elapsedMs / debt.durationMs);
            const due = Math.max(0, targetPaid - debt.paid);
            if (!(due > 0)) continue;
            debt.paid += due;
            this._applyCausalDebtDamage(due, false);
            if (this.player._isDead || !(this.player.data?.hp > 0)) break;
        }
        this._causalDebts = this._causalDebts.filter(debt => debt.paid < debt.total);
    }

    _applyCausalDebtDamage(amount, settled) {
        const damage = Math.max(0, Math.floor(Number(amount) || 0));
        if (!(damage > 0) || !this.player.data) return;
        this.player.data.hp = Math.max(0, this.player.data.hp - damage);
        this.player.hitFlash = this.player.hitFlashDuration;
        EffectManager.add(new FloatingTextEffect(
            this.player.x,
            this.player.y - this.player.size,
            `${settled ? '劫债结算' : '劫债偿还'} -${damage}`,
            settled ? '#c1764d' : '#c99a58'
        ));
        if (this.player.data.hp <= 0 && !this.player._isDead) {
            this.player.onDeath?.();
        }
    }

    _getUnpaidCausalDebt() {
        return this._causalDebts.reduce(
            (sum, debt) => sum + Math.max(0, (Number(debt.total) || 0) - (Number(debt.paid) || 0)),
            0
        );
    }

    _eraseCausalDebt(ratio) {
        const clamped = Math.max(0, Math.min(0.95, Number(ratio) || 0));
        if (!(clamped > 0)) return 0;
        const before = this._getUnpaidCausalDebt();
        for (const debt of this._causalDebts) {
            const remaining = Math.max(0, debt.total - debt.paid);
            debt.total = debt.paid + Math.floor(remaining * (1 - clamped));
        }
        this._causalDebts = this._causalDebts.filter(debt => debt.paid < debt.total);
        return Math.max(0, before - this._getUnpaidCausalDebt());
    }

    _recordOathReserve(damage, reducedDamage, attacker, isMelee, hitContext, cfg) {
        if (!cfg || !(cfg.conversionRatio > 0) || !(cfg.maxHpCapRatio > 0)
            || !this._isEligibleDirectHit(attacker, isMelee, hitContext)) return;
        const prevented = Math.max(0, (Number(damage) || 0) - (Number(reducedDamage) || 0));
        const gained = Math.floor(prevented * cfg.conversionRatio);
        if (!(gained > 0)) return;
        const maxHp = Math.max(0, Number(this.player.data?.maxHp) || 0);
        const cap = Math.floor(maxHp * cfg.maxHpCapRatio);
        this._oathReserve = Math.min(cap, this._oathReserve + gained);
        this._oathReserveDecayRemainingMs = cfg.decayAfterMs;
    }

    _finishOathDefense(reason, cfg) {
        if (!cfg) return;
        if (reason === 'voluntary' && this._oathReserve > 0
            && this._oathSanctifyRemainingMs > 0) {
            this._deployOathWard(cfg);
        }
    }

    _deployOathWard(cfg) {
        if (!(cfg?.wardDurationMs > 0) || !(cfg.wardRadius > 0)
            || !(cfg.wardReductionRatio > 0) || !(this._oathReserve > 0)) return;
        this._collapseOathWard();
        this._oathWardAnchor = {
            x: this.player.x,
            y: this.player.y,
            active: true,
        };
        this._oathWardConfig = { ...cfg };
        this._oathWardRemainingMs = cfg.wardDurationMs;
        this._oathSanctifyRemainingMs = 0;
        this._oathWardFx = new SanctuaryDomainFx(
            this._oathWardAnchor,
            { radius: cfg.wardRadius }
        );
        EffectManager.add(this._oathWardFx);
        registerLegendaryShieldWard(this);
        EffectManager.add(new FloatingTextEffect(
            this.player.x,
            this.player.y - this.player.size - 26,
            `终誓庇护展开（储备 ${Math.floor(this._oathReserve)}）`,
            '#ffe3a0'
        ));
    }

    _updateOathState(elapsed) {
        if (this._oathSanctifyRemainingMs > 0) {
            this._oathSanctifyRemainingMs = Math.max(
                0,
                this._oathSanctifyRemainingMs - elapsed
            );
        }
        if (this._oathWardRemainingMs > 0) {
            this._oathWardRemainingMs = Math.max(0, this._oathWardRemainingMs - elapsed);
            if (this._oathWardRemainingMs <= 0 || !(this._oathReserve > 0)) {
                this._collapseOathWard();
                this._oathReserve = 0;
            }
            return;
        }
        if (this._oathReserve > 0 && this._oathReserveDecayRemainingMs <= 0) {
            this._oathReserve = 0;
            this._oathSanctifyRemainingMs = 0;
        } else if (this._oathReserve > 0) {
            this._oathReserveDecayRemainingMs = Math.max(
                0,
                this._oathReserveDecayRemainingMs - elapsed
            );
            if (this._oathReserveDecayRemainingMs <= 0) {
                this._oathReserve = 0;
                this._oathSanctifyRemainingMs = 0;
            }
        }
    }

    applyOathWardDamage(target, damage, source, isMelee, hitContext) {
        const safeDamage = Math.max(0, Number(damage) || 0);
        const cfg = this._oathWardConfig;
        const friendlyFaction = ['player', 'companion', 'ally', 'friendly']
            .includes(target?._faction);
        const distance = Number.isFinite(target?.x) && Number.isFinite(target?.y)
            && this._oathWardAnchor
            ? Math.hypot(target.x - this._oathWardAnchor.x, target.y - this._oathWardAnchor.y)
            : Infinity;
        if (!(this._oathWardRemainingMs > 0) || !(this._oathReserve > 0)
            || !cfg || !friendlyFaction || distance > cfg.wardRadius
            || !this._isEligibleDirectHit(source, isMelee, hitContext)) {
            return { damage: safeDamage, prevented: 0, triggered: false };
        }
        const prevented = Math.max(0, Math.min(
            this._oathReserve,
            Math.floor(safeDamage * cfg.wardReductionRatio)
        ));
        if (!(prevented > 0)) {
            return { damage: safeDamage, prevented: 0, triggered: false };
        }
        this._oathReserve -= prevented;
        if (!(this._oathReserve > 0)) {
            this._oathReserve = 0;
            this._collapseOathWard();
        }
        return { damage: safeDamage - prevented, prevented, triggered: true };
    }

    _collapseOathWard() {
        unregisterLegendaryShieldWard(this);
        if (this._oathWardAnchor) this._oathWardAnchor.active = false;
        this._oathWardFx?.destroy?.();
        this._oathWardFx = null;
        this._oathWardAnchor = null;
        this._oathWardConfig = null;
        this._oathWardRemainingMs = 0;
    }

    _collapseNullField(cfg) {
        if (this._nullFieldRemainingMs <= 0) return;
        this._nullFieldRemainingMs = 0;
        this._nullFieldCooldownMs = Math.max(this._nullFieldCooldownMs, cfg?.cooldownMs || 0);
    }

    _isDirectEnemyHit(attacker, hitContext) {
        return !!attacker
            && attacker !== this.player
            && attacker._faction === 'enemy'
            && hitContext?.isDot !== true
            && hitContext?.isEnvironment !== true
            && hitContext?.isSelfDamage !== true
            && hitContext?.isShieldRetaliation !== true;
    }

    _isEligibleDirectHit(attacker, isMelee, hitContext) {
        return this._isDirectEnemyHit(attacker, hitContext)
            && (isMelee === true || hitContext?.isProjectile === true)
            && hitContext?.disableLegendaryShieldEffects !== true
            && attacker?._nonLethalDamage !== true;
    }

    _isAliveTarget(target) {
        if (!target || target._isDead || target.active === false) return false;
        const hp = Number(target.data?.hp ?? target.hp);
        return !Number.isFinite(hp) || hp > 0;
    }

    // 获取玩家当前面朝角度（弧度）
    _getPlayerFacingAngle() {
        // 使用同帧鼠标的世界方向，不把连续瞄准量化为四方向。
        if (Number.isFinite(this.player._shieldFacingAngle)) return this.player._shieldFacingAngle;
        if (Number.isFinite(this.player.rotation)) return this.player.rotation;
        const dir = this.player._facingDir || 'down';
        switch (dir) {
            case 'right': return 0;
            case 'left':  return Math.PI;
            case 'down':  return Math.PI / 2;
            case 'up':    return -Math.PI / 2;
            default:      return 0;
        }
    }

    // 辅助：获取副手槽位
    _getOffhandSlot() {
        const currentMode = this.player.weaponMode;
        return currentMode === 'weapon' ? 'offhand' : 'ring2';
    }

    // 辅助：安全播放音效
    _playSound(path) {
        if (SoundManager && SoundManager.playFile) {
            SoundManager.playFile(path);
        }
    }

    // 辅助：安全添加防御经验
    _addShieldExp(isMelee, isParry) {
        if (SkillManager && SkillManager.addShieldDefenseExp) {
            SkillManager.addShieldDefenseExp(this.player, isMelee, isParry);
        }
    }

    // 检查是否装备盾（只检查当前武器模式对应的副手槽）
    checkEquipped() {
        const offhandSlot = this._getOffhandSlot();
        const item = this.getShieldData();
        const newActive = !!item;
        if (item !== this._equippedShield || offhandSlot !== this._equippedSlot) {
            this.settleCausalDebt('switch');
            this.resetTransientState({ discardDebt: true });
        }
        this._equippedShield = item;
        this._equippedSlot = offhandSlot;
        if (this.active !== newActive) {
            this.active = newActive;
            if (this.player.calculateCombatStats) {
                this.player.calculateCombatStats();
            }
        }
        return this.active;
    }

    // 获取当前装备的盾数据（只取当前武器模式对应的副手槽）
    getShieldData() {
        const offhandSlot = this._getOffhandSlot();
        const item = this.player.equipments?.[offhandSlot];
        return item?.weaponType === 'shield' ? item : null;
    }
}
