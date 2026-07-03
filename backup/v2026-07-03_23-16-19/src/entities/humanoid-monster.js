import { Enemy } from './enemy.js';
import { RangedAttack } from '../combat/attack.js';
import { Renderer } from '../world/renderer.js';
import { getTexture } from '../utils/texture-cache.js';
import { getAmmoConfig } from '../config/gun-ammo.js';

/**
 * 类人型怪物武器配置映射（回退配置）
 * 当外部配置不可用时使用此硬编码配置
 */
const _HUMANOID_WEAPON_DATA = {
    qjb201: {
        weaponType: 'qjb201',
        weaponAsset: { image: 'assets/weapons/201equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        attack: { range: 1200, knockback: 1, attackInterval: 60, projectileSpeed: 2808, damageType: '物理' },
        heatParams: { overheatTime: 4000, overheatRecoverTime: 1500, overheatCooldownTime: 1500 },
        ammoConfig: { max: 60, reloadTime: 2000 },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 30 },
        fireMode: 'fullAuto'
    },
    pkm: {
        weaponType: 'pkm',
        weaponAsset: { image: 'assets/weapons/pkm_topdown.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        attack: { range: 1200, knockback: 3, attackInterval: 92, projectileSpeed: 4680, damageType: '物理' },
        heatParams: { overheatTime: 5000, overheatRecoverTime: 1500, overheatCooldownTime: 1500 },
        ammoConfig: { max: 75, reloadTime: 3500 },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 25 },
        fireMode: 'fullAuto'
    },
    akm: {
        weaponType: 'akm',
        weaponAsset: { image: 'assets/weapons/akm_topdown_lowpoly_v2长枪管.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        attack: { range: 1200, knockback: 2, attackInterval: 100, projectileSpeed: 4680, damageType: '物理' },
        ammoConfig: { max: 30, reloadTime: 1150 },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 25 },
        fireMode: 'fullAuto'
    },
    qbz191: {
        weaponType: 'qbz191',
        weaponAsset: { image: 'assets/weapons/191equip_clean.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        attack: { range: 1200, knockback: 2, attackInterval: 70, projectileSpeed: 5616, damageType: '物理' },
        ammoConfig: { max: 30, reloadTime: 1000 },
        spreadParams: { startDelay: 500, maxTime: 4000, maxAngle: 25 },
        fireMode: 'fullAuto'
    },
    pistol: {
        weaponType: 'pistol',
        weaponAsset: { image: 'assets/weapons/G18equip.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
        attack: { range: 650, knockback: 0, attackInterval: 55, projectileSpeed: 2028, damageType: '物理' },
        ammoConfig: { max: 17, reloadTime: 1200 },
        spreadParams: { startDelay: 0, maxTime: 0, maxAngle: 1 },
        fireMode: 'fullAuto'
    }
};

/**
 * 获取当前生效的武器数据源
 * 优先使用外部 window.HUMANOID_SQUAD_CONFIG.weapons，回退到硬编码配置
 */
function getWeaponDataSource() {
    if (typeof window !== 'undefined' && window.HUMANOID_SQUAD_CONFIG && window.HUMANOID_SQUAD_CONFIG.weapons) {
        return window.HUMANOID_SQUAD_CONFIG.weapons;
    }
    return _HUMANOID_WEAPON_DATA;
}

/**
 * 获取指定战术角色的外部配置
 * @param {string} tacticalRole - 角色标识，如 'commander', 'machineGunner'
 * @returns {Object|null}
 */
function getRoleConfig(tacticalRole) {
    if (!tacticalRole) return null;
    const squadConfig = (typeof window !== 'undefined' && window.HUMANOID_SQUAD_CONFIG) ? window.HUMANOID_SQUAD_CONFIG : null;
    if (!squadConfig || !squadConfig.roles) return null;
    return squadConfig.roles[tacticalRole] || null;
}

/**
 * 类人型怪物基类
 * 特性：使用人类武器（枪械），六维属性与胖子僵尸相仿，使用真实武器系统
 * 全部使用实心圆绘制（无贴图），不同颜色区分不同兵种
 */
export class HumanoidMonster extends Enemy {
    constructor(x, y, config) {
        super(x, y, {
            ...config,
            showWeapon: true, // 类人型怪物显示武器
        });

        // 类人型怪物标识
        this._isHumanoid = true;

        // 武器类型（从外部传入，如 'qjb201', 'pkm', 'akm' 等）
        this._weaponType = config.weaponType || null;

        // 战术角色（对应外部配置的 roles 键，如 'commander', 'machineGunner' 等）
        this._tacticalRole = config.tacticalRole || null;

        // 装备真实武器系统
        if (this._weaponType) {
            this._setupRealWeapon();
        }

        // 初始化技能系统
        this._skills = [];
        this._activeSkillEffects = {};
        this._initSkills();

        // 战术目标（由TacticalSquadAI设置）
        this._tacticalTarget = null;
    }

    _setupRealWeapon() {
        const roleConfig = getRoleConfig(this._tacticalRole);

        // 外部配置可覆盖武器类型
        const weaponType = roleConfig && roleConfig.weaponType ? roleConfig.weaponType : this._weaponType;

        // 优先从外部配置加载武器数据，失败则回退到硬编码
        const weapons = getWeaponDataSource();
        const data = weapons[weaponType];
        if (!data) {
            console.warn(`[HumanoidMonster] 未知武器类型: ${weaponType} (role=${this._tacticalRole})`);
            return;
        }

        // 设置装备（添加 name 字段以满足 canFire() 检查）
        this.equipments.weapon = { ...data, name: data.weaponType || 'weapon' };
        this.weaponMode = 'weapon';

        // 初始化弹药
        this._initAmmoForSlot('weapon');

        // 创建对应的攻击对象（供 Combatant.fireProjectile 使用）
        const attackCfg = data.attack;
        this.attacks[data.weaponType] = new RangedAttack({
            cooldown: 0, // AI 的 aiInterval 控制射速，攻击对象不设冷却
            projectileSpeed: attackCfg.projectileSpeed || 2000,
            projectileRange: attackCfg.range || 800,
            projectileSize: 5,
            damage: { min: 1, max: 1 },
            piercing: false,
            knockback: attackCfg.knockback || 0
        });

        // 设置攻击参数
        if (data.attack) {
            this.attackRange = data.attack.range || 600;
            this.aiInterval = data.attack.attackInterval || 300;
        }

        // 应用角色配置的 AI 参数覆盖（外部配置优先）
        if (roleConfig && roleConfig.ai && roleConfig.ai.desiredDist !== undefined) {
            this.attackRange = roleConfig.ai.desiredDist;
        }

        // 加载武器贴图（使用全局缓存）
        if (data.weaponAsset && data.weaponAsset.image) {
            this.weaponImage = getTexture(data.weaponAsset.image);
            this.weaponImages[data.weaponType] = this.weaponImage;
        }
    }

    /**
     * 初始化技能系统
     * 从外部配置的角色 skills 数组中加载
     */
    _initSkills() {
        const roleConfig = getRoleConfig(this._tacticalRole);
        if (!roleConfig || !roleConfig.skills) return;

        this._skills = roleConfig.skills.map(s => ({
            ...s,
            currentCooldown: 0,
            active: false,
            activeTimer: 0
        }));
    }

    /**
     * 更新技能系统（每帧调用）
     * 处理技能冷却和持续时间倒计时
     * @param {number} dt - 帧间隔时间(ms)
     */
    _updateSkills(dt) {
        for (const skill of this._skills) {
            if (skill.currentCooldown > 0) {
                skill.currentCooldown -= dt;
                if (skill.currentCooldown < 0) skill.currentCooldown = 0;
            }
            if (skill.active && skill.duration) {
                skill.activeTimer -= dt;
                if (skill.activeTimer <= 0) {
                    skill.active = false;
                    this._onSkillEnd(skill);
                }
            }
        }
    }

    /**
     * 激活指定技能
     * @param {string} skillId - 技能ID，如 'drone', 'suppression'
     * @returns {boolean} 是否成功激活
     */
    activateSkill(skillId) {
        const skill = this._skills.find(s => s.id === skillId);
        if (!skill) return false;
        if (skill.currentCooldown > 0) return false;
        if (skill.active) return false;

        skill.active = true;
        skill.activeTimer = skill.duration || 0;
        skill.currentCooldown = skill.cooldown || 0;
        return true;
    }

    /**
     * 检查技能是否处于激活状态
     * @param {string} skillId - 技能ID
     * @returns {boolean}
     */
    isSkillActive(skillId) {
        const skill = this._skills.find(s => s.id === skillId);
        return skill ? skill.active : false;
    }

    /**
     * 获取指定技能的当前冷却时间
     * @param {string} skillId - 技能ID
     * @returns {number} 剩余冷却时间(ms)，0 表示就绪
     */
    getSkillCooldown(skillId) {
        const skill = this._skills.find(s => s.id === skillId);
        return skill ? skill.currentCooldown : 0;
    }

    /**
     * 技能结束时的回调，子类可覆盖以处理结束逻辑
     * @param {Object} skill - 技能对象
     */
    _onSkillEnd(skill) {
        // 子类可覆盖此方法处理技能结束后的清理逻辑
    }

    /**
     * 覆盖 update：在父类更新逻辑前处理技能冷却
     */
    update(dt, entities) {
        this._updateSkills(dt);
        super.update(dt, entities);
    }

    // 覆盖弹药检查：启用有限弹药
    _hasAmmo(slot) {
        const state = this._ammoState[slot];
        if (!state) return true;
        return state.current > 0;
    }

    // 覆盖弹药消耗：实际扣减
    _consumeAmmo(slot) {
        const state = this._ammoState[slot];
        if (!state) return true;
        if (state.current <= 0) return false;
        state.current--;
        return true;
    }

    // 覆盖开始换弹：防止重复重置计时器，无限备弹
    _startReload(slot) {
        const state = this._ammoState[slot];
        if (!state || state.reloading) return false;
        // 播放换弹音效（如果配置了 reloadSound）
        const weapon = this.equipments[slot];
        if (weapon && weapon.reloadSound && typeof SoundManager !== 'undefined') {
            if (weapon.reloadSound.startsWith('assets/')) {
                SoundManager.playFile(weapon.reloadSound);
            } else {
                SoundManager.play(weapon.reloadSound);
            }
        }
        return super._startReload(slot);
    }

    // 覆盖换弹更新：无限备弹，换弹完成后重置为满弹
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

    // 覆盖_updateAttack：使用真实武器系统（Combatant.fireProjectile）
    _updateAttack(dt, entities) {
        this.aiTimer += dt;
        if (this.aiTimer < this.aiInterval) return;

        const targetX = this.target.x, targetY = this.target.y;
        const dist = Math.sqrt((targetX - this.x) ** 2 + (targetY - this.y) ** 2);
        if (dist > this.attackRange) return;

        // 视线检测：如果视线被墙阻挡则不攻击
        const isBlocked = typeof WallSystem !== 'undefined' &&
            WallSystem.blocked(this.x, this.y, targetX, targetY);
        if (isBlocked) return;

        this.aiTimer = 0;

        // 重置攻击冷却，让 aiInterval 控制射速
        // 避免 RangedAttack 构造函数将 cooldown:0 覆盖为 800/1000
        const weaponType = this.equipments.weapon.weaponType;
        if (this.attacks[weaponType]) {
            this.attacks[weaponType].cooldown = 0;
        }

        // 使用 Combatant 通用发射系统（内部已包含 triggerWeaponAnim）
        this.fireProjectile(targetX, targetY, entities, { slot: 'weapon' });

        // fireProjectile 会设置 cooldown = maxCooldown，再次重置为 0
        if (this.attacks[weaponType]) {
            this.attacks[weaponType].cooldown = 0;
        }
    }

    // 覆盖_updateMovement：支持战术目标（由TacticalSquadAI设置）
    // Enemy._updateMovement 已内置 _tacticalTarget 检查，此处直接调用 super 即可
    _updateMovement(dx, dy, dist, dt) {
        super._updateMovement(dx, dy, dist, dt);
    }

    // 盾卫防御状态：减伤50%（在子类中通过设置 _shieldDefenseActive 启用）
    takeDamage(damage, source, damageType = 'physical') {
        if (this._shieldDefenseActive) {
            damage = Math.floor(damage * 0.5);
        }
        super.takeDamage(damage, source, damageType);
    }

    renderWeapon(ctx) {
        const weapon = this.getCurrentWeapon();
        if (!weapon) return;
        const img = this.getWeaponImage();
        if (!img || !img.complete || img.naturalWidth === 0) {
            // 回退：绘制简单线条表示武器
            ctx.save();
            ctx.translate(this.size * 0.8, 0);
            ctx.rotate(Math.PI / 2);
            ctx.strokeStyle = '#999';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(20, 0);
            ctx.stroke();
            ctx.restore();
            return;
        }

        const s = 60;
        const w = s * 0.75;
        const h = s;

        ctx.save();
        ctx.translate(this.size * 0.8, 0);
        ctx.rotate(Math.PI / 2);
        ctx.translate(0, -s * 0.42);
        ctx.drawImage(img, -w / 2, 0, w, h);
        ctx.restore();
    }

    calculateCombatStats() {
        super.calculateCombatStats();
        const d = this.data;
        // 血量公式：maxHp = 100 + 体质 * 10
        const oldMaxHp = this.maxHp;
        d.maxHp = 100 + d.con * 10;
        this.maxHp = d.maxHp;
        if (oldMaxHp > 0) {
            const hpDiff = this.maxHp - oldMaxHp;
            this.hp = Math.min(this.maxHp, this.hp + hpDiff);
            d.hp = Math.min(d.maxHp, d.hp + hpDiff);
        } else {
            this.hp = this.maxHp;
            d.hp = d.maxHp;
        }
    }

    render(ctx) {
        const pos = Renderer.worldToScreen(this.x, this.y);
        const x = pos.x, y = pos.y;
        this.renderHealthBar(ctx);

        // 类人型怪物：实心圆绘制，不同兵种不同颜色
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(this.rotation);

        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(0, 10, this.size * 0.8, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        // 身体（实心圆）
        ctx.fillStyle = this.color || '#8a8a8a';
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();

        // 高光
        ctx.fillStyle = this.highlightColor || 'rgba(180, 180, 180, 0.3)';
        ctx.beginPath();
        ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // 盾卫防御状态：绘制盾牌特效
        if (this._shieldDefenseActive) {
            ctx.strokeStyle = 'rgba(100, 160, 200, 0.6)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, this.size + 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(100, 160, 200, 0.15)';
            ctx.beginPath();
            ctx.arc(0, 0, this.size + 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // 武器方向指示（小线条，沿旋转后X轴方向）
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(this.size * 1.2, 0);
        ctx.stroke();

        // 绘制武器贴图（entity-local坐标，已旋转到目标方向）
        this.renderWeapon(ctx);

        ctx.restore();

        ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
        ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, x, y - this.size - 10);
        this.renderCollisionRadius(ctx);
    }
}

// ===== 6人战术小队成员 =====

/**
 * 指挥官：使用QJB201轻机枪
 */
export class Commander extends HumanoidMonster {
    constructor(x, y) {
        super(x, y, {
            name: '指挥官',
            hp: 350, maxHp: 350,
            size: 22, collisionRadius: 20,
            speed: 31.2,
            level: 5,
            color: '#c04040',
            highlightColor: 'rgba(200, 100, 100, 0.3)',
            str: 40, dex: 40, con: 45, int: 15, wis: 10, luck: 8,
            weaponType: 'qjb201',
            tacticalRole: 'commander'
        });
        this._rank = 'elite';
    }
}


/**
 * 机枪手：使用PKM，高射速持续压制
 */
export class MachineGunner extends HumanoidMonster {
    constructor(x, y) {
        super(x, y, {
            name: '机枪手',
            hp: 400, maxHp: 400,
            size: 24, collisionRadius: 22,
            speed: 23.4,
            level: 5,
            color: '#d06020',
            highlightColor: 'rgba(220, 120, 80, 0.3)',
            str: 50, dex: 30, con: 55, int: 5, wis: 5, luck: 5,
            weaponType: 'pkm',
            tacticalRole: 'machineGunner'
        });
        this._rank = 'elite';
    }
}

/**
 * 步枪手A：正面步枪手，左右移动规避子弹
 */
export class Rifleman extends HumanoidMonster {
    constructor(x, y) {
        super(x, y, {
            name: '步枪手',
            hp: 300, maxHp: 300,
            size: 20, collisionRadius: 18,
            speed: 39,
            level: 5,
            color: '#208040',
            highlightColor: 'rgba(100, 200, 120, 0.3)',
            str: 35, dex: 45, con: 40, int: 8, wis: 6, luck: 8,
            weaponType: 'akm',
            tacticalRole: 'rifleman'
        });
        this._rank = 'normal';
        // 左右移动规避参数
        this._evadeTimer = 0;
        this._evadeDirection = 1;
    }
}

/**
 * 步枪手B（侧翼步枪手）：绕到玩家侧面/背面攻击
 */
export class FlankRifleman extends HumanoidMonster {
    constructor(x, y) {
        super(x, y, {
            name: '侧翼步枪手',
            hp: 280, maxHp: 280,
            size: 20, collisionRadius: 18,
            speed: 46.8,
            level: 5,
            color: '#4080c0',
            highlightColor: 'rgba(120, 160, 220, 0.3)',
            str: 35, dex: 50, con: 35, int: 10, wis: 8, luck: 8,
            weaponType: 'qbz191',
            tacticalRole: 'flankRifleman'
        });
        this._rank = 'normal';
        // 侧翼包抄参数：目标位于玩家侧翼90度方向
        this._flankAngle = Math.PI / 2; // 90度侧翼
    }
}

/**
 * 盾卫：前排防御单位，使用G18手枪和盾牌
 */
export class ShieldBearer extends HumanoidMonster {
    constructor(x, y) {
        super(x, y, {
            name: '盾卫',
            hp: 450, maxHp: 450,
            size: 25, collisionRadius: 23,
            speed: 31.2,
            level: 5,
            color: '#808080',
            highlightColor: 'rgba(160, 160, 160, 0.3)',
            str: 45, dex: 25, con: 60, int: 5, wis: 5, luck: 5,
            weaponType: 'pistol',
            tacticalRole: 'shieldBearer'
        });
        this._rank = 'normal';
        // 盾牌防御状态：激活时减伤50%，移动速度减半
        this._shieldDefenseActive = false;
    }
}
