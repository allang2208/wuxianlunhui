import { DamageableEntity } from './damageable-entity.js';
import { ThrustAttack, RangedAttack } from '../combat/attack.js';
import { isGunWeapon, getAmmoConfig, isMachineGun } from '../config/gun-ammo.js';
import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { WEAPON_ANIM } from '../config/math-utils.js';
import { Projectile } from '../combat/projectile.js';
import { Renderer } from '../world/renderer.js';

/**
 * Combatant 基类 — 通用战斗者接口
 * Player 和 Enemy 都继承此类，共享武器/弹药/散布/过热系统
 * 
 * 设计原则：
 * 1. 默认行为：弹药无限、体力无限、散布和过热不生效
 * 2. Player 覆盖：弹药检查、体力消耗、Input 处理
 * 3. Enemy 覆盖：简化装备槽位（通常只有 weapon），AI 控制开火
 */
class Combatant extends DamageableEntity {
    constructor(x, y, config = {}) {
        super(x, y, {
            faction: config.faction || 'neutral',
            hp: config.hp || 100,
            maxHp: config.maxHp || 100,
            size: config.size || 14,
            collisionRadius: config.collisionRadius || 12,
            name: config.name || '战斗者'
        });

        // ===== 六维属性 + 战斗属性 =====
        this.data = {
            name: config.name || this.name,
            level: config.level || 1,
            hp: config.hp || 100,
            maxHp: config.maxHp || 100,
            mp: config.mp || 100,
            maxMp: config.maxMp || 100,
            stamina: config.stamina !== undefined ? config.stamina : 9999,
            maxStamina: config.maxStamina !== undefined ? config.maxStamina : 9999,
            str: config.str || 10,
            dex: config.dex || 10,
            int: config.int || 10,
            con: config.con || 10,
            wis: config.wis || 10,
            luck: config.luck || 10,
            atk: 0, def: 0, matk: 0, mdef: 0,
            hit: 0, dodge: 0, crit: 0, critRes: 0, aspd: 0, speed: 0
        };

        // ===== 装备系统 =====
        this.equipments = {};
        this.weaponMode = 'weapon'; // 当前武器槽位
        this.weaponAnim = { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle, nextSpin: 0 };
        this.offhandWeaponAnim = { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle, nextSpin: 0 };
        this.animTimingMul = 1.0;
        this.rangedFireData = null;
        this.rangedFired = false;
        this.staminaRegenDelay = 0;

        // ===== 攻击系统 =====
        this.attacks = {
            melee: new ThrustAttack({ cooldown: 600, range: 80, width: 20, damage: { min: 8, max: 15 }, knockback: 15 })
        };

        // ===== 武器贴图（子类可覆盖） =====
        this.weaponImages = {}; // { weaponType: Image }
        this._lastWeaponType = null;

        // ===== 弹药系统 =====
        this._ammoState = {
            weapon: null,
            offhand: null,
            weapon2: null,
            ring2: null
        };

        // ===== 散布系统 =====
        this._gunSpreadTimer = 0;
        this._gunSpreadTimerOff = 0;
        this._gunSpreadWeapon = null;
        this._gunSpreadWeaponOff = null;
        this._currentSpreadFactor = 0;
        this._currentSpreadMaxAngle = 0;
        this._currentSpreadFactorOff = 0;
        this._currentSpreadMaxAngleOff = 0;

        // ===== 过热系统 =====
        this._overheatValue = 0;
        this._overheatMax = 1;
        this._overheatOverheated = false;
        this._overheatRecoverTimer = 0;
        this._overheatActive = false;
        this._overheatWeaponType = null;

        // ===== 能量轻机枪射速系统 =====
        this._energyLMGFireTime = 0;
        this._energyLMGIsFiring = false;
        this._energyLMGDefaults = {
            baseCooldown: 333, maxCooldown: 50, rampUpTime: 2500,
            overheatTime: 5000, overheatRecoverTime: 4000, overheatCooldownTime: 4000,
            spreadMaxTime: 2500, maxSpreadAngle: 15
        };

        // ===== 状态效果（通用） =====
        this.isStunned = false;
        this.stunTimer = 0;
        this._stunEffectId = null;
        this._poisonStacks = 0;
        this._poisonTimer = 0;
        this._poisonTickTimer = 0;
        this._poisonEffectId = null;
        this._droneVulnerabilityStacks = 0;
        this._droneVulnerabilityTimer = 0;

        // ===== 计算初始战斗属性 =====
        this.calculateCombatStats();
    }

    // ==================== 装备/武器接口 ====================

    /** 获取当前武器对象 */
    getCurrentWeapon() {
        return this.equipments[this.weaponMode] || null;
    }

    /** 获取当前武器槽位 */
    getCurrentSlot() {
        return this.weaponMode;
    }

    /** 获取当前武器贴图 Image */
    getWeaponImage() {
        const weapon = this.getCurrentWeapon();
        if (!weapon) return null;
        const wt = weapon.weaponType || weapon.rangedType;
        return this.weaponImages[wt] || null;
    }

    /** 加载武器贴图（子类调用） */
    _loadWeaponImage(weaponType, src) {
        if (!this.weaponImages[weaponType]) {
            this.weaponImages[weaponType] = new Image();
            this.weaponImages[weaponType].src = src;
        }
    }

    // ==================== 弹药系统 ====================

    /** 初始化指定槽位的弹药 */
    _initAmmoForSlot(slot) {
        const item = this.equipments[slot];
        if (!item || !isGunWeapon(item)) {
            this._ammoState[slot] = null;
            return;
        }
        const ammoConfig = getAmmoConfig(item);
        if (!ammoConfig) {
            this._ammoState[slot] = null;
            return;
        }
        let maxAmmo = ammoConfig.max;
        let reloadTime = ammoConfig.reloadTime;
        // 应用改造效果
        if (item._craftEffects) {
            const ce = item._craftEffects;
            if (ce.magazineOverride) maxAmmo = ce.magazineOverride;
            else if (ce.magazineDelta) maxAmmo += ce.magazineDelta;
            if (ce.reloadTimeDelta) reloadTime += ce.reloadTimeDelta;
            if (maxAmmo < 1) maxAmmo = 1;
            if (reloadTime < 100) reloadTime = 100;
        }
        if (!this._ammoState[slot] || this._ammoState[slot].weaponId !== item.weaponId) {
            this._ammoState[slot] = {
                weaponId: item.weaponId,
                current: maxAmmo,
                max: maxAmmo,
                reloading: false,
                reloadTimer: 0,
                reloadTime: reloadTime
            };
        } else {
            this._ammoState[slot].max = maxAmmo;
            this._ammoState[slot].reloadTime = reloadTime;
            if (this._ammoState[slot].current > maxAmmo) {
                this._ammoState[slot].current = maxAmmo;
            }
        }
    }

    /** 获取指定槽位的弹药状态 */
    _getAmmoState(slot) {
        return this._ammoState[slot] || null;
    }

    /** 检查指定槽位是否正在换弹 */
    _isReloading(slot) {
        const state = this._ammoState[slot];
        return state && state.reloading;
    }

    /** 检查指定槽位是否有弹药（默认：无限弹药，子类可覆盖） */
    _hasAmmo(slot) {
        // 默认实现：弹药无限（适用于怪物）
        // Player 覆盖此方法来检查实际弹药
        return true;
    }

    /** 消耗指定槽位1发弹药（默认：不消耗，子类可覆盖） */
    _consumeAmmo(slot) {
        // 默认实现：不消耗弹药（适用于怪物）
        // Player 覆盖此方法来实际扣弹药
        return true;
    }

    /** 开始换弹（默认实现：所有子类共享基础换弹逻辑，Player 覆盖加入 UI/音效） */
    _startReload(slot) {
        const state = this._ammoState[slot];
        if (!state) return false;
        const weapon = this.equipments[slot];
        if (!weapon) return false;
        const ammoCfg = getAmmoConfig(weapon);
        if (!ammoCfg) return false;
        state.reloading = true;
        state.reloadTimer = ammoCfg.reloadTime || 1000;
        state.reloadTime = ammoCfg.reloadTime || 1000;
        return true;
    }

    /** 打断换弹 */
    _interruptReload(slot) {
        const state = this._ammoState[slot];
        if (!state || !state.reloading || !state.singleReloadMode) return false;
        state.reloading = false;
        state.reloadTimer = 0;
        return true;
    }

    /** 更新所有槽位的换弹进度（默认实现：所有子类共享基础换弹逻辑，Player 覆盖加入 UI/音效） */
    _updateReload(dt) {
        for (const slot of ['weapon', 'offhand', 'weapon2', 'ring2']) {
            const state = this._ammoState[slot];
            if (!state || !state.reloading) continue;
            state.reloadTimer -= dt;
            if (state.reloadTimer <= 0) {
                const weapon = this.equipments[slot];
                const ammoCfg = getAmmoConfig(weapon);
                state.current = ammoCfg ? ammoCfg.max : 30;
                state.reloading = false;
                state.reloadTimer = 0;
            }
        }
    }

    // ==================== 散布系统 ====================

    /** 计算当前散布参数（供子类调用） */
    _computeSpreadForWeapon(weapon, spreadTimer, isAiming = false) {
        if (!weapon || !isGunWeapon(weapon)) {
            return { factor: 0, maxAngle: 0 };
        }
        const wt = weapon.weaponType;
        const craftEffects = weapon._craftEffects;

        // 独头弹模式
        if (wt === 'shotgun' && craftEffects && craftEffects.slugMode) {
            const layers = this._slugRecoilLayers || 0;
            return {
                factor: 1,
                maxAngle: layers * 5 + (craftEffects.maxSpreadAngleDelta || 0)
            };
        }

        let spreadStartDelay = 500;
        let spreadMaxTime = 4000;
        let maxSpreadAngle = 25;

        const sp = weapon.spreadParams;
        if (sp) {
            if (sp.startDelay !== undefined) spreadStartDelay = sp.startDelay;
            if (sp.maxTime !== undefined) spreadMaxTime = sp.maxTime;
            if (sp.maxAngle !== undefined) maxSpreadAngle = sp.maxAngle;
        }

        // 能量轻机枪动态散布
        if (wt === 'energy_lmg') {
            const elp = this._getEnergyLMGParams ? this._getEnergyLMGParams() : this._energyLMGDefaults;
            spreadMaxTime = elp.spreadMaxTime;
            maxSpreadAngle = elp.maxSpreadAngle;
        }

        // 瞄准模式：散布开始延迟 +1s
        if (isAiming) spreadStartDelay += 1000;

        // 改造效果
        if (craftEffects) {
            spreadStartDelay += craftEffects.spreadStartDelta || 0;
            if (spreadStartDelay < 0) spreadStartDelay = 0;
            spreadMaxTime += craftEffects.spreadTimeDelta || 0;
            if (spreadMaxTime < 500) spreadMaxTime = 500;
            maxSpreadAngle += craftEffects.maxSpreadAngleDelta || 0;
        }

        const factor = (spreadMaxTime <= 0)
            ? (spreadTimer > spreadStartDelay ? 1 : 0)
            : Math.min(1, Math.max(0, spreadTimer - spreadStartDelay) / spreadMaxTime);

        return { factor, maxAngle: maxSpreadAngle };
    }

    /** 更新散布计时器（供子类调用） */
    _updateSpreadTimers(dt, isFiring, isFiringOffhand) {
        const weapon = this.getCurrentWeapon();
        const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
        const offhandItem = this.equipments[offhandSlot];

        // 主手散布
        if (weapon && isGunWeapon(weapon) && isFiring) {
            this._gunSpreadTimer += dt;
            this._gunSpreadWeapon = weapon.weaponType;
        } else {
            this._gunSpreadTimer = 0;
            this._gunSpreadWeapon = null;
        }

        // 副手散布
        if (offhandItem && isGunWeapon(offhandItem) && isFiringOffhand) {
            this._gunSpreadTimerOff += dt;
            this._gunSpreadWeaponOff = offhandItem.weaponType;
        } else {
            this._gunSpreadTimerOff = 0;
            this._gunSpreadWeaponOff = null;
        }

        // 预计算散布因子
        const isAiming = this._aimModeActive || false;
        const mainSpread = this._computeSpreadForWeapon(weapon, this._gunSpreadTimer, isAiming);
        this._currentSpreadFactor = mainSpread.factor;
        this._currentSpreadMaxAngle = mainSpread.maxAngle;

        const offSpread = this._computeSpreadForWeapon(offhandItem, this._gunSpreadTimerOff, isAiming);
        this._currentSpreadFactorOff = offSpread.factor;
        this._currentSpreadMaxAngleOff = offSpread.maxAngle;
    }

    /** 重置散布 */
    _resetSpread() {
        this._gunSpreadTimer = 0;
        this._gunSpreadTimerOff = 0;
        this._gunSpreadWeapon = null;
        this._gunSpreadWeaponOff = null;
        this._currentSpreadFactor = 0;
        this._currentSpreadMaxAngle = 0;
        this._currentSpreadFactorOff = 0;
        this._currentSpreadMaxAngleOff = 0;
    }

    // ==================== 过热系统 ====================

    /** 更新过热值（供子类调用） */
    _updateOverheat(dt, isFiring) {
        const weapon = this.getCurrentWeapon();
        if (!weapon || weapon.weaponType !== 'pkm' && weapon.weaponType !== 'qjb201' && weapon.weaponType !== 'energy_lmg') {
            this._overheatValue = 0;
            this._overheatOverheated = false;
            this._overheatActive = false;
            return;
        }

        if (isFiring && !this._overheatOverheated) {
            // 开火时累积过热
            const overheatRate = 0.0002; // 每毫秒累积0.0002
            this._overheatValue += dt * overheatRate;
            if (this._overheatValue >= this._overheatMax) {
                this._overheatValue = this._overheatMax;
                this._overheatOverheated = true;
                this._overheatRecoverTimer = 3000; // 3秒冷却
            }
        } else {
            // 停止开火时恢复
            if (this._overheatOverheated) {
                this._overheatRecoverTimer -= dt;
                if (this._overheatRecoverTimer <= 0) {
                    this._overheatOverheated = false;
                    this._overheatValue = 0;
                }
            } else {
                this._overheatValue = Math.max(0, this._overheatValue - dt * 0.0005);
            }
        }
        this._overheatActive = this._overheatValue > 0.1;
        this._overheatWeaponType = weapon.weaponType;
    }

    // ==================== 体力系统 ====================

    /** 获取当前体力（默认：9999，子类可覆盖） */
    getStamina() {
        return this.data.stamina || 9999;
    }

    /** 消耗体力（默认：不消耗，子类可覆盖） */
    consumeStamina(amount) {
        // 默认实现：不消耗体力（适用于怪物）
        // Player 覆盖此方法来实际扣体力
        return true;
    }

    // ==================== 开火接口 ====================

    /**
     * 通用开火检查
     * @param {string} slot - 武器槽位
     * @param {boolean} isFiring - 是否正在开火
     * @returns {boolean} 是否可以开火
     */
    canFire(slot, isFiring = true) {
        if (!isFiring) return false;
        const item = this.equipments[slot];
        if (!item || !item.name) return false;

        // 检查弹药（不足时自动触发换弹）
        if (isGunWeapon(item) && !this._hasAmmo(slot)) {
            this._startReload(slot);
            return false;
        }
        // 检查换弹
        if (this._isReloading(slot)) return false;
        // 检查过热
        if (this._overheatOverheated && item.weaponType === this._overheatWeaponType) return false;
        // 检查冷却
        const attackKey = item.attackKey || item.weaponType;
        if (this.attacks[attackKey] && !this.attacks[attackKey].canUse()) return false;

        return true;
    }

    /**
     * 通用发射弹丸
     * @param {number} targetX - 目标X坐标
     * @param {number} targetY - 目标Y坐标
     * @param {Map} entities - 所有实体
     * @param {object} config - 发射配置
     */
    fireProjectile(targetX, targetY, entities, config = {}) {
        const slot = config.slot || this.weaponMode;
        const item = this.equipments[slot];
        if (!item) return false;

        const attackKey = item.attackKey || item.weaponType;
        const attack = this.attacks[attackKey];
        if (!attack || !attack.canUse()) return false;

        // 检查开火条件（弹药、换弹、过热）
        if (!this.canFire(slot, true)) return false;

        // 获取散布参数
        let spreadAngle = 0;
        if (isGunWeapon(item)) {
            const isOffhand = slot === 'offhand' || slot === 'ring2';
            const factor = isOffhand ? this._currentSpreadFactorOff : this._currentSpreadFactor;
            const maxAngle = isOffhand ? this._currentSpreadMaxAngleOff : this._currentSpreadMaxAngle;
            spreadAngle = (Math.random() - 0.5) * 2 * factor * maxAngle * (Math.PI / 180);
        }

        // 计算发射方向
        const angle = Math.atan2(targetY - this.y, targetX - this.x) + spreadAngle;

        // 获取武器配置
        const weaponType = item.weaponType;
        const damage = attack.config.damage || { min: 1, max: 3 };
        const speed = attack.config.projectileSpeed || 2000;
        const range = attack.config.projectileRange || 800;
        const size = attack.config.projectileSize || 4;
        const piercing = attack.config.piercing || false;

        // 获取弹丸贴图（默认绿色曳光弹）
        let projectileImage = null;
        if (this.weaponImages[weaponType]) {
            projectileImage = this.weaponImages[weaponType];
        }

        // 创建弹丸
        // 敌人使用曳光弹效果，确保弹道可见
        const isEnemy = this._faction === 'enemy';
        const projectile = new Projectile(
            this.x, this.y, angle, speed, range, size,
            damage, piercing, this, entities, projectileImage,
            isEnemy, // isTracer：敌人使用曳光弹
            isMachineGun(weaponType), // isGold（机枪类金色曳光弹）
            weaponType === 'deagle', // isDarkGold
            'physical', // damageType
            false, // noRender
            false // isGreen
        );

        // 将弹丸添加到实体管理
        if (typeof Game !== 'undefined' && Game.entities) {
            Game.entities.set(`projectile_${Date.now()}_${Math.random()}`, projectile);
        }

        // 触发武器动画
        this.triggerWeaponAnim();

        // 播放开火音效
        if (typeof SoundManager !== 'undefined') {
            const fireSound = item.fireSound;
            if (fireSound) {
                if (fireSound.startsWith('assets/')) {
                    SoundManager.playFile(fireSound);
                } else {
                    SoundManager.play(fireSound);
                }
            }
            // 注：AI 的 fireSound 已在 data/humanoid-squad-config.json 中配置，无需硬编码 fallback
        }

        // 消耗弹药
        this._consumeAmmo(slot);

        // 设置冷却
        attack.cooldown = attack.maxCooldown;

        return true;
    }

    // ==================== 武器动画 ====================

    /** 触发武器攻击动画 */
    triggerWeaponAnim() {
        this.weaponAnim.state = 'swing';
        this.weaponAnim.timer = 0;
        this.rangedFired = false;
    }

    /** 触发副手武器攻击动画 */
    triggerOffhandWeaponAnim() {
        if (this.offhandWeaponAnim) {
            this.offhandWeaponAnim.state = 'swing';
            this.offhandWeaponAnim.timer = 0;
        }
    }

    // ==================== 战斗属性 ====================

    /** 计算战斗属性（默认：基于六维属性，子类可覆盖） */
    calculateCombatStats() {
        const d = this.data;
        d.atk = Math.round(10 + d.str * 0.05 + d.dex * 0.1);
        d.def = Math.floor(d.con * 1.2 + d.str * 0.3);
        d.matk = Math.round(10 + d.int * 1.5 + d.wis * 0.5);
        d.mdef = Math.floor(d.wis * 1.2 + d.int * 0.3);
        d.hit = Math.round(d.dex * 0.5);
        d.dodge = Math.round(d.dex * 0.3);
        d.crit = Math.round(d.luck * 1.0);
        d.critRes = Math.round(d.con * 1.0);
        d.aspd = Math.round(d.dex * 0.02);
        d.speed = this.maxSpeed || 0;
    }

    /** 获取当前武器攻击力 */
    getCurrentWeaponAtk(itemOverride) {
        const weapon = itemOverride || this.getCurrentWeapon();
        if (!weapon) return 0;
        // 默认：返回武器基础伤害
        if (weapon.damage) {
            return Math.floor((weapon.damage.min + weapon.damage.max) / 2);
        }
        return this.data.atk || 0;
    }

    // ==================== 基础渲染 ====================

    /** 基础武器渲染（子类可覆盖） */
    renderWeapon(ctx) {
        const weapon = this.getCurrentWeapon();
        if (!weapon) return;

        const img = this.getWeaponImage();
        if (!img || !img.complete || img.naturalWidth === 0) return;

        const wt = weapon.weaponType;
        const s = 20; // 基础尺寸

        ctx.save();
        ctx.translate(0, 0);
        ctx.rotate(this.rotation + Math.PI / 2);

        if (wt === 'pistol' || wt === 'deagle' || wt === 'p4040') {
            ctx.drawImage(img, -s * 0.3, -s * 0.5, s * 0.6, s);
        } else if (wt === 'pkm' || wt === 'akm' || wt === 'qbz191' || wt === 'qjb201' || wt === 'energy_lmg') {
            ctx.drawImage(img, -s * 0.4, -s * 0.6, s * 0.8, s * 1.2);
        } else {
            ctx.drawImage(img, -s * 0.3, -s * 0.5, s * 0.6, s);
        }

        ctx.restore();
    }

    // ==================== 更新 ====================

    update(dt, entities) {
        super.update(dt);

        // 更新武器动画（只累加 timer，state 转换由子类 updateWeaponAnim 控制）
        if (this.weaponAnim && this.weaponAnim.state !== 'idle') {
            this.weaponAnim.timer += dt;
        }

        // 更新换弹
        this._updateReload(dt);

        // 更新散布恢复
        if (this._gunSpreadTimer > 0) {
            this._gunSpreadTimer -= dt * 2; // 散布恢复速度
            if (this._gunSpreadTimer < 0) this._gunSpreadTimer = 0;
        }
        if (this._gunSpreadTimerOff > 0) {
            this._gunSpreadTimerOff -= dt * 2;
            if (this._gunSpreadTimerOff < 0) this._gunSpreadTimerOff = 0;
        }

        // 更新过热恢复
        if (!this._overheatOverheated && this._overheatValue > 0) {
            this._overheatValue = Math.max(0, this._overheatValue - dt * 0.0005);
        }
    }

    // ==================== 受击 ====================

    takeDamage(damage, source, damageType = 'physical', isMelee = false) {
        // 计算暴击
        const critRate = (source && source.data && source.data.crit) || 0;
        const critRes = (this.data && this.data.critRes) || 0;
        let enchantCritBonus = 0;
        if (source && source.getCurrentWeapon) {
            const weapon = source.getCurrentWeapon();
            if (weapon && weapon._enchantEffects && weapon._enchantEffects.critRate) {
                enchantCritBonus = weapon._enchantEffects.critRate * 100;
            }
        }
        const finalCritRate = Math.max(0, critRate + enchantCritBonus - critRes);
        const isCrit = Math.random() * 100 < finalCritRate;

        let finalDamage = damage;
        if (isCrit && source && source.skills && source.skills.criticalStrike) {
            const csEffect = source.skills.criticalStrike.getEffect(source.skills.criticalStrike.level);
            finalDamage = Math.floor(damage * (1 + csEffect.damageBonus));
        }

        // 无人机易伤
        if (this._droneVulnerabilityStacks > 0) {
            let droneBonus = 0.10 * this._droneVulnerabilityStacks;
            if (source && source.skills && source.skills.droneSkill) {
                const effect = source.skills.droneSkill.getEffect(source.skills.droneSkill.level);
                droneBonus = (effect.damageBonusPercent / 100) * this._droneVulnerabilityStacks;
            }
            finalDamage = Math.floor(finalDamage * (1 + droneBonus));
        }

        super.takeDamage(finalDamage, source, damageType);

        if (typeof EffectManager !== 'undefined') {
            EffectManager.createDamageText(this.x, this.y - this.size, finalDamage, isCrit);
        }
    }
}

export { Combatant };
