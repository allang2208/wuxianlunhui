import { Entity } from './entity.js';
import { ThrustAttack, RangedAttack } from '../combat/attack.js';
import { WeaponAnimConfig } from '../items/weapon-anim-config.js';

        class Player extends Entity {
            constructor(x, y) {
                super(x, y); this.size = CONFIG.PLAYER_SIZE; this.collisionRadius = 12; this.speed = CONFIG.PLAYER_SPEED; this.maxSpeed = CONFIG.PLAYER_SPEED; this.accel = 0.7; this.friction = 0.82; this.animTime = 0; this.isMoving = false; this.hittable = true;
                this.isDodging = false; this.dodgeTimer = 0; this.dodgeCooldown = 0; this.dodgeDirection = { x: 0, y: 0 }; this.dodgeInvincible = false;
                this.weaponSwitchCooldown = 0; // 武器切换冷却：切换 G18 后防止立即开火
                this._sprintDuration = 0; // 冲刺持续时间（长按Shift计时）
                this._isDashing = false; // 是否正在执行冲刺攻击
                this._dashState = 'idle'; // dash状态: idle/charge/slash/recover
                this._dashTimer = 0; // 冲刺攻击计时器
                this._dashDirection = { x: 0, y: 0 }; // 冲刺方向
                this._dashStartPos = { x: 0, y: 0 }; // 冲刺起始位置
                this._dashHitSet = new Set(); // 冲刺攻击已命中目标
            this._dashKillCount = 0; // 冲刺攻击击杀计数
                this._dashConvergeAuraActive = false; // 冲刺就绪金色光环
                this._dashConvergeShown = false; // 冲刺汇聚特效已播放标记
                this._dashBounceApplied = false; // 撞墙弹回是否已应用
                this._dashSlashShown = false; // 白色扇形特效已播放标记
                this._dashSlashEffect = null; // 扇形特效实例引用
                this._dashParticles = []; // 冲刺攻击粒子数组
                this._dashResetAnim = null; // 冲刺攻击后复位动画
                this._isWhirlwind = false; // 是否正在执行风车
                this._whirlwindTimer = 0; // 风车计时器
                this._whirlwindHitSet = new Set(); // 风车已命中目标
                this._whirlwindDuration = 800; // 风车总时长 800ms
                this._whirlwindHitChecked = false; // 风车攻击判定是否已执行
                this._whirlwindRangeEffect = null; // 风车范围提示效果引用
                // ===== 夜与火之剑特殊攻击状态 =====
                this._specialAttackActive = false; // 是否正在释放特殊攻击
                this._specialAttackTimer = 0; // 特殊攻击计时器
                this._specialAttackCooldown = 0; // 特殊攻击冷却（ms）
                this._specialAttackHitSet = new Set(); // 特殊攻击已命中目标
                this._specialAttackLastTick = 0; // 上次伤害判定时间
                this._specialAttackAngle = 0; // 光柱方向
                this._specialAttackBeam = null; // 光柱特效实例
                this._specialAttackLockedAngle = 0; // 特殊攻击锁定朝向
                this._specialAttackClampedLength = 1200; // 特殊攻击被障碍物截断后的长度
                this._specialResetAnim = null; // 特殊攻击后复位动画
                // ===== 装备-技能联动系统 =====
                this._skillOverrides = {}; // 当前装备的技能覆盖 { skillId: overrideData }
                this.attacks = {
                    melee: new ThrustAttack({ cooldown: 500, range: 165, width: 35, damage: { min: 12, max: 20 }, knockback: 8 }),
                    ranged: new RangedAttack({ cooldown: 600, projectileSpeed: 5, projectileRange: 800, projectileSize: 7, damage: { min: 8, max: 16 }, piercing: false }),
                    pistol: new RangedAttack({ cooldown: 55, projectileSpeed: 22, projectileRange: 600, projectileSize: 3, damage: { min: 4, max: 8 }, piercing: false })
                };
                // 应用剑精通的冷却缩减
                SkillManager.updateMeleeCooldown(this);
                this.gameStartCooldown = 500; // 游戏开始后500ms内禁止攻击，防止点击"开始游戏"的鼠标事件携带到游戏中
                this.weaponMode = 'weapon'; // 'weapon' or 'weapon2'
                this.data = {
                    name: '轮回者', level: 1, class: '初心者', hp: 100, maxHp: 100, mp: 100, maxMp: 100,
                    stamina: CONFIG.STAMINA_MAX, maxStamina: CONFIG.STAMINA_MAX, exp: 0, maxExp: 20,
                    money: 500, // 测试金币
                    str: 10, dex: 10, int: 10, con: 10, wis: 10, luck: 10,
                    atk: 0, def: 0, matk: 0, mdef: 0, hit: 0, dodge: 0, crit: 0, aspd: 0, speed: 0,
                    loopCount: 0, surviveDays: 1, kills: 0, quests: 0, geneLock: '未开启', rank: 'F',
                    attrPoints: 0
                };
                this.skills = this._initSkills();
                this.equipments = {};
                this.hasMeleeWeapon = true; // 是否有主武器（剑），false = 空手
                this.meleeImage = new Image(); this.meleeImage.src = 'assets/weapons/1-rusty_sword_euip.png';
                this.bowFrames = [];
                for (let i = 1; i <= 8; i++) { const img = new Image(); img.src = `assets/weapons/bow_frame_${String(i).padStart(2, '0')}.png`; this.bowFrames.push(img); }
                this.equippedBowFrames = null; // 装备后的弓贴图，null表示使用默认弓
                this.pistolImage = new Image(); this.pistolImage.src = 'assets/weapons/g18_topdown_v2.png';
                this.equippedRangedType = null; // 'bow' | 'pistol' | null，装备副武器时设置
                this.arrowImage = new Image(); this.arrowImage.src = 'assets/ammo/arrow.png';
                this.weaponAnim = { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle, nextSpin: 0 };
                this.animTimingMul = 1.0; // 动画时间倍率，随攻击间隔同步调整
                this.rangedFireData = null; this.rangedFired = false;
                this.staminaRegenDelay = 0;
                this.weaponGlowParticles = []; // 武器符文发光粒子（weapon4 蓝色特效）
                this._glowLastState = false;     // 记录上一次粒子状态（待机/移动）
                this._glowTransitionStart = 0;   // 状态改变时的过渡开始时间戳（0=无活跃过渡）
                this.calculateCombatStats();
                this.updateMaxStats();
            }
            calculateCombatStats() {
                const d = this.data;
                d.atk = Math.round(10 + d.str * 0.05 + d.dex * 0.1); d.def = Math.floor(d.con * 1.2 + d.str * 0.3);
                d.matk = Math.floor(d.int * 1.5 + d.wis * 0.5); d.mdef = Math.floor(d.wis * 1.2 + d.int * 0.3);
                d.hit = 80 + Math.floor(d.dex * 0.5); d.dodge = 5 + Math.floor(d.dex * 0.3);
                d.crit = 2 + Math.floor(d.luck * 0.2); d.aspd = 1.0 + d.dex * 0.02;
                d.speed = CONFIG.PLAYER_SPEED + d.dex * 0.05;
            }
            // 获取当前武器攻击力（状态栏同步计算）
            getCurrentWeaponAtk() {
                const currentWpn = this.equipments[this.weaponMode];
                let weaponAtk = 0;
                if (currentWpn && currentWpn.weaponId) {
                    const d = this.data;
                    if (currentWpn.weaponId === 'weapon1') {
                        weaponAtk = Math.round(6 + d.str * 0.8 + d.dex * 0.5);
                    } else if (currentWpn.weaponId === 'weapon2') {
                        weaponAtk = Math.round(12 + d.str * 1 + d.dex * 0.5);
                    } else if (currentWpn.weaponId === 'weapon3') {
                        weaponAtk = Math.round(6 + d.dex * 0.35);
                    } else if (currentWpn.weaponId === 'weapon4') {
                        weaponAtk = Math.round(15 + d.str * 1.5 + d.dex * 0.8);
                    } else if (currentWpn.weaponId === 'weapon5') {
                        weaponAtk = Math.round(20 + d.str * 1.8 + d.dex * 1);
                    }
                    // 剑精通加成
                    if (this.skills && this.skills.swordMastery) {
                        weaponAtk += this.skills.swordMastery.getEffect(this.skills.swordMastery.level).atkBonus;
                    }
                }
                return weaponAtk;
            }
            // ===== 经验值系统 =====
            getExpForLevel(level) { return 20 + level * 20 + level * 12; }
            gainExp(amount) {
                if (amount <= 0) return;
                const d = this.data;
                d.exp += amount;
                // 显示获得经验浮动文字
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, `+${amount} EXP`, '#ffd700'));
                // 检查升级（支持溢出连续升级）
                while (d.exp >= d.maxExp) {
                    d.exp -= d.maxExp;
                    d.level++;
                    d.maxExp = this.getExpForLevel(d.level);
                    d.attrPoints += 2;
                    this.onLevelUp(d.level);
                }
            }
            onLevelUp(level) {
                // 升级动画：屏幕闪光 + 文字提示
                const flash = document.createElement('div');
                flash.className = 'screen-flash';
                document.body.appendChild(flash);
                setTimeout(() => { if (flash && flash.parentNode) flash.remove(); }, 500);
                // 升级文字提示
                const text = document.createElement('div');
                text.className = 'level-up-text';
                text.innerHTML = `
                    <span class="lu-icon">⭐</span>
                    <span class="lu-title">等级提升！Lv.${level}</span>
                    <span class="lu-effect">获得2点属性点</span>
                `;
                document.body.appendChild(text);
                setTimeout(() => { if (text && text.parentNode) text.remove(); }, 2500);
                // 更新战斗属性
                this.calculateCombatStats();
                // 更新最大生命/魔法值
                this.updateMaxStats();
                // 如果面板正在打开，同步刷新UI
                if (SystemUI.isOpen && SystemUI.currentTab === 'status') {
                    Game.updateUI();
                }
            }
            // ===== 属性点系统 =====
            // 体质+10 HP, 精神+10 MP, 智力+5 MP, 敏捷+1% 体力恢复速度
            updateMaxStats() {
                const d = this.data;
                const oldMaxHp = d.maxHp;
                const oldMaxMp = d.maxMp;
                d.maxHp = 100 + d.con * 10;
                d.maxMp = 100 + d.wis * 10 + d.int * 5;
                // HP/MP 按比例缩放，避免满血时增加属性反而掉血
                if (oldMaxHp > 0) d.hp = Math.min(d.maxHp, d.hp + (d.maxHp - oldMaxHp));
                else d.hp = d.maxHp;
                if (oldMaxMp > 0) d.mp = Math.min(d.maxMp, d.mp + (d.maxMp - oldMaxMp));
                else d.mp = d.maxMp;
                // 体力恢复速度：每点敏捷 +1%
                const staminaRegenMul = 1.0 + d.dex * 0.01;
                // 保存倍率供 update 使用
                this._staminaRegenMul = staminaRegenMul;
            }
            // 分配属性点
            _initSkills() {
                // 优先从 JSON 数据加载技能配置
                if (typeof window !== 'undefined' && window.SKILL_DATA) {
                    const skills = {};
                    for (const [id, data] of Object.entries(window.SKILL_DATA)) {
                        if (typeof DataLoader !== 'undefined' && DataLoader.buildSkillFromJSON) {
                            skills[id] = DataLoader.buildSkillFromJSON(id, data);
                        } else {
                            // fallback: 手动构建技能对象
                            skills[id] = {
                                id: id,
                                name: data.name || id,
                                icon: data.icon || '✦',
                                description: data.description || '',
                                level: 1,
                                maxLevel: data.maxLevel || 20,
                                exp: 0,
                                maxExp: 10,
                                tags: data.tags || [],
                                getEffect(level) {
                                    const result = {};
                                    if (data.effectFormula) {
                                        for (const [key, formula] of Object.entries(data.effectFormula)) {
                                            try { result[key] = new Function('level', `return ${formula}`)(level); }
                                            catch (e) { result[key] = 0; }
                                        }
                                    }
                                    return result;
                                },
                                getExpForNext(level) {
                                    if (data.expFormula) {
                                        try { return new Function('level', `return ${data.expFormula}`)(level); }
                                        catch (e) { return 10; }
                                    }
                                    return 10 + (level - 1) * 10;
                                }
                            };
                        }
                    }
                    return skills;
                }
                // 兜底：硬编码默认技能（JSON 加载失败时）
                return {
                    swordMastery: {
                        id: 'swordMastery', name: '剑精通', icon: '⚔',
                        description: '精通剑术，每次挥舞都更加致命',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 10,
                        tags: [{ name: '剑类武器', type: 'weapon' }, { name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { atkBonus: level, cooldownReduction: level * 0.01, dexBonus: level }; },
                        getExpForNext(level) { return 10 + (level - 1) * 10; }
                    },
                    dashAttack: {
                        id: 'dashAttack', name: '冲刺攻击', icon: '💨',
                        description: '在冲刺状态下发动强力突进挥砍，对路径上的敌人造成毁灭性打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 10,
                        tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageMul: 1.75 + level * 0.05, cooldownReduction: level * 0.02 }; },
                        getExpForNext(level) { return 10 + (level - 1) * 10; }
                    },
                    dashAttackThrust: {
                        id: 'dashAttackThrust', name: '冲刺攻击-突刺', icon: '⚔',
                        description: '骑士长剑专属：冲刺后向前突刺，对路径上敌人造成多次伤害',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 10,
                        tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageMul: 0.80 + level * 0.03, cooldownReduction: level * 0.02 }; },
                        getExpForNext(level) { return 10 + (level - 1) * 10; }
                    },
                    whirlwind: {
                        id: 'whirlwind', name: '风车', icon: '🌀',
                        description: '以自身为中心高速旋转武器，对周围敌人造成毁灭性打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 10,
                        tags: [{ name: '近战', type: 'melee' }, { name: '主动', type: 'active' }],
                        getEffect(level) { return { damageMul: 1.5 + level * 0.10, strBonus: level, cooldown: 10 - level * 0.2, staminaCost: 20 + level * 1, radius: 150 + level * 5, knockback: 250 }; },
                        getExpForNext(level) { return 10 + (level - 1) * 10; }
                    }
                };
            }
            // ===== 装备-技能联动系统 =====
            /** 应用装备的技能覆盖 */
            _applySkillOverrides(item) {
                console.log('[SkillOverride] _applySkillOverrides called with:', item ? { name: item.name, hasOverrides: !!item.skillOverrides, overrideKeys: item.skillOverrides ? Object.keys(item.skillOverrides) : [] } : 'null item');
                if (!item || !item.skillOverrides) {
                    console.log('[SkillOverride] Clearing overrides (no skillOverrides on item)');
                    this._clearSkillOverrides();
                    return;
                }
                this._skillOverrides = JSON.parse(JSON.stringify(item.skillOverrides));
                console.log(`[SkillOverride] ✅ 应用 ${item.name} 的技能覆盖:`, JSON.parse(JSON.stringify(item.skillOverrides)));
            }
            /** 清除所有技能覆盖 */
            _clearSkillOverrides() {
                if (Object.keys(this._skillOverrides).length > 0) {
                    console.log('[SkillOverride] 恢复默认技能');
                }
                this._skillOverrides = {};
            }
            /** 获取技能覆盖参数（优先覆盖值，否则默认值） */
            _getSkillParam(skillId, paramPath, defaultValue) {
                const override = this._skillOverrides[skillId];
                if (!override) return defaultValue;
                const keys = paramPath.split('.');
                let val = override;
                for (const k of keys) {
                    val = val?.[k];
                    if (val === undefined) return defaultValue;
                }
                return val;
            }
            _getActiveDashSkillId() {
                const currentItem = this.equipments[this.weaponMode];
                if (currentItem && currentItem.skillOverrides && currentItem.skillOverrides.dashAttackThrust) {
                    return 'dashAttackThrust';
                }
                return 'dashAttack';
            }
            _isFacingMouse() {
                const moveDir = Input.getMovement();  // 修正：使用 getMovement 而非 getMoveDir
                if (moveDir.x === 0 && moveDir.y === 0) return false;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                const mx = Input.mouse.x - screenPos.x;
                const my = Input.mouse.y - screenPos.y;
                const len = Math.sqrt(mx * mx + my * my);
                if (len === 0) return true;
                return (moveDir.x * mx + moveDir.y * my) / len > 0;
            }
            addAttribute(attr) {
                if (this.data.attrPoints <= 0) return false;
                const validAttrs = ['str', 'dex', 'int', 'con', 'wis', 'luck'];
                if (!validAttrs.includes(attr)) return false;
                this.data.attrPoints--;
                this.data[attr]++;
                this.calculateCombatStats();
                this.updateMaxStats();
                return true;
            }
            update(dt, entities) {
                const move = Input.getMovement();
                if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;
                if (this.weaponSwitchCooldown > 0) this.weaponSwitchCooldown -= dt;
                if (this.isDodging) {
                    this.dodgeTimer -= dt;
                    if (this.dodgeTimer <= 0) { this.isDodging = false; this.dodgeInvincible = false; }
                    else {
                        const dnx = this.x + this.dodgeDirection.x * CONFIG.DODGE_SPEED, dny = this.y + this.dodgeDirection.y * CONFIG.DODGE_SPEED;
                        const dr = WallSystem.resolve(this.x, this.y, dnx, dny, this.collisionRadius);
                        this.x = dr.x; this.y = dr.y;
                        this.x = Math.max(10, Math.min(CONFIG.WORLD_WIDTH - 10, this.x)); this.y = Math.max(10, Math.min(CONFIG.WORLD_HEIGHT - 10, this.y));
                        this.animTime += 0.4;
                    }
                } else {
                    const sprint = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse();
                    let targetSpeed = sprint ? CONFIG.PLAYER_SPRINT : this.maxSpeed;
                    // 冲刺攻击动画期间：移动速度为0.1px/帧（结束后恢复）
                    if (this._isDashing) targetSpeed = 0.1;
                    // 风车攻击动画期间：移动速度为0.1px/帧（结束后恢复）
                    if (this._isWhirlwind) targetSpeed = 0.1;
                    // 特殊攻击动画期间：完全不能移动
                    if (this._specialAttackActive) targetSpeed = 0;
                    this.vx += (move.x * targetSpeed - this.vx) * this.accel; this.vy += (move.y * targetSpeed - this.vy) * this.accel;
                    if (move.x === 0) this.vx *= this.friction; if (move.y === 0) this.vy *= this.friction;
                    const nx = this.x + this.vx, ny = this.y + this.vy;
                    const resolved = WallSystem.resolve(this.x, this.y, nx, ny, this.collisionRadius);
                    // 墙壁碰撞音效：速度较大且位置被阻挡时
                    if ((Math.abs(this.vx) > 1.5 || Math.abs(this.vy) > 1.5) && (Math.abs(resolved.x - nx) > 1 || Math.abs(resolved.y - ny) > 1)) {
                        // SoundManager.play('wall_hit');
                    }
                    this.x = resolved.x; this.y = resolved.y;
                    this.x = Math.max(20, Math.min(CONFIG.WORLD_WIDTH - 20, this.x)); this.y = Math.max(20, Math.min(CONFIG.WORLD_HEIGHT - 20, this.y));
                    if (sprint && this.isMoving) { this.data.stamina -= CONFIG.STAMINA_SPRINT_COST * (dt / 1000); if (this.data.stamina < 0) this.data.stamina = 0; }
                    if (Input.isPressed(CONFIG.KEYS.SPACE) && this.dodgeCooldown <= 0 && this.data.stamina >= CONFIG.STAMINA_DODGE_COST) this.triggerDodge(move);
                }
                const screenPos = Renderer.worldToScreen(this.x, this.y), dx = Input.mouse.x - screenPos.x, dy = Input.mouse.y - screenPos.y;
                if (this._isDashing) {
                    this.rotation = Math.atan2(this._dashDirection.y, this._dashDirection.x);
                } else if (this._specialAttackActive) {
                    this.rotation = this._specialAttackLockedAngle;
                } else if (!this._isWhirlwind) {
                    this.rotation = Math.atan2(dy, dx);
                }
                this.isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1;
                if (this.isMoving && !this.isDodging) {
                    this.animTime += 0.15;
                    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    const sprint = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse();
                    if (speed > 1.0) {
                        if (!this.dustTimer) this.dustTimer = 0;
                        this.dustTimer += dt;
                        const interval = sprint ? 70 : 140;
                        if (this.dustTimer >= interval) {
                            this.dustTimer -= interval;
                            // SoundManager.play('step');
                            const offsetX = -this.vx * 1.5 + (Math.random() - 0.5) * 8;
                            const offsetY = -this.vy * 1.5 + (Math.random() - 0.5) * 4;
                            { let d = EffectManager._acquire('DustEffect');
                            const dInt = sprint ? 1.5 : 0.8;
                            if (d) { d.x = this.x + offsetX; d.y = this.y + offsetY + 10; d.life = d.maxLife; d.active = true;
                                d.particles.forEach(p => { const pa = Math.PI+(Math.random()-0.5)*Math.PI; const ps = 0.8+Math.random()*2+dInt*0.8; p.vx = Math.cos(pa)*ps*0.6; p.vy = Math.sin(pa)*ps*0.4-0.3-Math.random()*0.6; p.alpha = 0.4+Math.random()*0.35; }); }
                            else d = new DustEffect(this.x + offsetX, this.y + offsetY + 10, dInt);
                            EffectManager.add(d); }
                        }
                    } else {
                        this.dustTimer = 0;
                    }
                }
                const isAttacking = this.weaponAnim.state !== 'idle';
                const isSprinting = Input.isSprint() && this.data.stamina > 0 && this.isMoving && this._isFacingMouse();
                // 冲刺攻击计时：追踪长按Shift持续时间
                if (isSprinting && !this._isDashing) {
                    this._sprintDuration += dt;
                    // 计算触发时间：基础333ms，每级减少3%
                    const activeDashSkill = this._getActiveDashSkillId();
                    const dashLevel = (this.skills && this.skills[activeDashSkill] && this.skills[activeDashSkill].level) || 1;
                    const triggerTime = 333 * (1 - (dashLevel - 1) * 0.03);
                    // 单次触发金光汇聚特效，触发后激活跟随光环
                    if (this._sprintDuration >= triggerTime && this.skills && this.skills[activeDashSkill]) {
                        // 检查当前武器是否为近战武器
                        const currentWeapon = this.equipments[this.weaponMode];
                        const isMeleeWeapon = currentWeapon && (currentWeapon.category === 'weapon_melee' || currentWeapon.weaponType === 'sword');
                        if (isMeleeWeapon) {
                            if (!this._dashConvergeShown) {
                                // 首次触发：播放汇聚特效一次，并激活跟随光环
                                this._dashConvergeShown = true;
                                EffectManager.add(new DashConvergeEffect(this.x, this.y, this));
                                this._dashConvergeAuraActive = true;
                            }
                        }
                    }
                } else if (!Input.isSprint()) {
                    // 仅当Shift松开时重置计数，方向切换不重置
                    this._sprintDuration = 0;
                    this._dashConvergeShown = false;
                    this._dashConvergeAuraActive = false;
                }
                if (!this.isDodging && !isAttacking && !isSprinting && this.data.stamina < this.data.maxStamina) {
                    this.staminaRegenDelay -= dt;
                    if (this.staminaRegenDelay <= 0) {
                        const mul = this._staminaRegenMul || 1.0;
                        this.data.stamina += CONFIG.STAMINA_REGEN * (dt / 1000) * mul;
                        if (this.data.stamina > this.data.maxStamina) this.data.stamina = this.data.maxStamina;
                    }
                } else {
                    this.staminaRegenDelay = 500;
                }
                Object.values(this.attacks).forEach(a => a.update(dt));
                this.updateWeaponAnim(dt);
                // ===== 武器符文发光粒子更新（仅 weapon4） =====
                const _currentWep = this.equipments[this.weaponMode];
                if (_currentWep && _currentWep.weaponId === 'weapon4') {
                    this._updateWeaponGlow(dt, WEAPON_ANIM.size);
                } else {
                    this.weaponGlowParticles = [];
                }
                const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                // ===== 冲刺攻击更新 =====
                if (this._isDashing) {
                    this.updateDashAttack(dt, entities);
                }
                // ===== 风车技能更新 =====
                if (this._isWhirlwind) {
                    this.updateWhirlwind(dt, entities);
                }
                // ===== 夜与火之剑特殊攻击更新 =====
                if (this._specialAttackActive) {
                    this.updateSpecialAttack(dt, entities);
                }
                // 特殊攻击冷却
                if (this._specialAttackCooldown > 0) {
                    this._specialAttackCooldown -= dt;
                    if (this._specialAttackCooldown < 0) this._specialAttackCooldown = 0;
                }
                // 冲刺攻击复位动画更新
                if (this._dashResetAnim) {
                    const elapsed = Date.now() - this._dashResetAnim.startTime;
                    if (elapsed >= this._dashResetAnim.duration) {
                        this._dashResetAnim = null;
                    }
                }
                // 特殊攻击复位动画更新
                if (this._specialResetAnim) {
                    const elapsed = Date.now() - this._specialResetAnim.startTime;
                    if (elapsed >= this._specialResetAnim.duration) {
                        this._specialResetAnim = null;
                    }
                }
                // 左键拾取地面物品已取消 — 现在仅在鼠标悬停触发金色特效时自动拾取
                // （逻辑移至 Game.update() 的悬停检测中）
                if (!this.isDodging && !this._isDashing && !this._isWhirlwind) {
                    // 游戏开始冷却：防止点击"开始游戏"按钮的鼠标事件携带到游戏中导致自动攻击
                    if (this.gameStartCooldown > 0) {
                        this.gameStartCooldown -= dt;
                        Input.mouse.leftPressed = false;
                        Input.mouse.leftDown = false;
                    }
                    // === 攻击输入处理 ===
                    // BUG FIX：装备面板打开时，完全禁止攻击输入
                    // 防止用户在面板中装备武器时，因之前按住左键导致自动攻击
                    if (SystemUI.isOpen) {
                        Input.mouse.leftPressed = false;
                        // 注意：不重置 leftDown，避免面板关闭后立即攻击
                        return;
                    }
                    // 游戏开始冷却期间禁止攻击
                    if (this.gameStartCooldown > 0) {
                        Input.mouse.leftPressed = false;
                        Input.mouse.leftDown = false;
                        return;
                    }
                    // 新设计：根据当前武器栏的实际装备类型决定攻击方式
                    const currentSlot = this.weaponMode; // 'weapon' or 'weapon2'
                    const currentItem = this.equipments[currentSlot];
                    const isWeaponEquipped = currentItem && currentItem.name;
                    // 判断当前栏位武器的类型
                    const isPistol = isWeaponEquipped && (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol');
                    const isBow = isWeaponEquipped && currentItem.weaponType === 'bow';
                    const isMelee = isWeaponEquipped && currentItem.category === 'weapon_melee';
                    
                    if (isPistol) {
                        // G18 全自动模式：按住 leftDown 持续射击
                        if (this.weaponSwitchCooldown <= 0 && Input.mouse.leftDown && this.attacks.pistol.canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities };
                            this.attacks.pistol.cooldown = this.attacks.pistol.maxCooldown;
                            this.triggerWeaponAnim();
                        }
                    } else if (Input.mouse.leftPressed) {
                        // 计算冲刺攻击触发时间：基础333ms，每级减少3%
                        const activeDashSkill = this._getActiveDashSkillId();
                        const dashLevel = (this.skills && this.skills[activeDashSkill] && this.skills[activeDashSkill].level) || 1;
                        const triggerTime = 333 * (1 - (dashLevel - 1) * 0.03);
                        if (isMelee && this._sprintDuration >= triggerTime && !this._isDashing) {
                            // 冲刺攻击触发
                            this.triggerDashAttack(entities);
                        } else if (isMelee) {
                            // 近战攻击：使用 ThrustAttack
                            const atk = this.attacks.melee;
                            if (atk.canUse()) {
                                const success = atk.execute(this, mouseWorld.x, mouseWorld.y, entities);
                                if (success) {
                                    atk.cooldown = atk.maxCooldown;
                                    this.triggerWeaponAnim();
                                }
                            }
                        } else if (isBow) {
                            // 弓矢攻击：使用 RangedAttack
                            const atk = this.attacks.ranged;
                            if (atk.canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities };
                                atk.cooldown = atk.maxCooldown;
                                this.triggerWeaponAnim();
                            }
                        }
                        Input.mouse.leftPressed = false;
                    }
                    // ===== 右键特殊攻击：夜与火之剑 =====
                    if (Input.mouse.rightPressed && isMelee && currentItem && currentItem.weaponId === 'weapon5') {
                        if (this._specialAttackCooldown <= 0 && !this._specialAttackActive) {
                            this.triggerSpecialAttack(mouseWorld.x, mouseWorld.y, entities);
                        }
                        Input.mouse.rightPressed = false;
                    }
                }
            }
            triggerDodge(moveInput) {
                let dirX = moveInput.x, dirY = moveInput.y;
                if (dirX === 0 && dirY === 0) { dirX = Math.cos(this.rotation); dirY = Math.sin(this.rotation); }
                const len = Math.sqrt(dirX*dirX + dirY*dirY); if (len > 0) { dirX /= len; dirY /= len; }
                this.dodgeDirection = { x: dirX, y: dirY }; this.isDodging = true; this.dodgeTimer = CONFIG.DODGE_DURATION;
                this.dodgeCooldown = CONFIG.DODGE_COOLDOWN; this.dodgeInvincible = true; this.data.stamina -= CONFIG.STAMINA_DODGE_COST;
                // SoundManager.play('dodge');
                this.vx = 0; this.vy = 0; { let d = EffectManager._acquire('DodgeEffect');
                if (d) { d.x = this.x; d.y = this.y; d.dirX = dirX; d.dirY = dirY; d.life = 300; d.active = true;
                    d.trails.forEach((t,i) => { t.x = this.x - dirX*i*8; t.y = this.y - dirY*i*8; t.alpha = 1-i*0.15; }); }
                else d = new DodgeEffect(this.x, this.y, dirX, dirY);
                EffectManager.add(d); }
            }
            triggerDashAttack(entities) {
                // 使用鼠标方向（当前朝向）作为冲刺方向
                let dirX = Math.cos(this.rotation), dirY = Math.sin(this.rotation);
                this._isDashing = true;
                this._dashState = 'charge';
                this._dashTimer = 0;
                this._dashDirection = { x: dirX, y: dirY };
                this._dashStartPos = { x: this.x, y: this.y };
                this._dashHitSet = new Set();
                this._dashKillCount = 0;
                this._dashRangeShown = false;
                this._dashSlashShown = false;
                this._dashBounceApplied = false;
                this._dashSlashPos = null;
                this._dashSlashEffect = null; // 重置扇形特效引用
                this._sprintDuration = 0;
                this.data.stamina -= 20;
                if (this.data.stamina < 0) this.data.stamina = 0;
                this.weaponAnim.state = 'idle';
                this._dashConvergeShown = false;
                this._dashConvergeAuraActive = false;
                // 初始化矩形突刺持续判定状态
                this._dashThrustPhase = null;
            }
            _getDashWeaponStateAt(timer, skillId) {
                // 未传入 skillId 时，根据当前装备自动判断
                const activeSkillId = skillId || this._getActiveDashSkillId();
                const dashProgress = timer / 800;
                let dashOffset = 0, dashAngle = 0;
                if (activeSkillId === 'dashAttackThrust') {
                    // === 突刺动画（骑士长剑专属） ===
                    // 坐标系：rotate(Math.PI/2) 后，Y轴向左（屏幕左），X轴向下
                    // dashOffset > 0 = 向左（靠近玩家）= "后"
                    // dashOffset < 0 = 向右（远离玩家）= "前"
                    const totalMs = this._getSkillParam('dashAttackThrust', 'animation.totalMs', 600);
                    const t = Math.min(1, timer / totalMs * 2); // 速度翻倍
                    dashOffset = -95 * easeOutQuad(t);
                    dashAngle = 0;
                } else {
                    // === 默认 dashAttack：武器挥砍（原始 slash 动画） ===
                    if (dashProgress < 0.4375) {
                        const t = dashProgress / 0.4375;
                        if (t < 0.142857) {
                            const pt = t / 0.142857;
                            dashOffset = 15 * easeOutQuad(pt);
                            dashAngle = 0;
                        } else {
                            const pt = (t - 0.142857) / 0.857143;
                            dashOffset = 15;
                            dashAngle = Math.PI / 2 * easeInOutCubic(pt);
                        }
                    } else {
                        const t = (dashProgress - 0.4375) / 0.5625;
                        if (t < 0.111111) {
                            const pt = t / 0.111111;
                            dashOffset = 15 - 60 * easeOutQuad(pt);
                            dashAngle = Math.PI / 2;
                        } else {
                            const pt = (t - 0.111111) / 0.888889;
                            dashAngle = Math.PI / 2 - Math.PI * 4/3 * easeOutQuad(pt);
                            dashOffset = -45 - 30 * (1 - easeInOutCubic(pt));
                        }
                    }
                }
                return { dashOffset, dashAngle };
            }
            triggerWhirlwind() {
                // 打断冲刺状态（如果正在冲刺）
                if (this._isDashing) {
                    this._isDashing = false;
                    this._dashState = 'idle';
                    this._dashTimer = 0;
                    this._dashBounceApplied = false;
                    this._dashSlashPos = null;
                    this._dashSlashEffect = null;
                    this._sprintDuration = 0;
                }
                this._isWhirlwind = true;
                this._whirlwindTimer = 0;
                this._whirlwindHitSet = new Set();
                this._whirlwindHitChecked = false;
                this.weaponAnim.state = 'idle';
                // 显示风车范围提示（当范围提示开启时）
                if (Game.showAttackRange) {
                    const skill = this.skills.whirlwind;
                    if (skill) {
                        const effect = skill.getEffect(skill.level);
                        this._whirlwindRangeEffect = new AttackRangeEffect(this.x, this.y, 0, effect.radius, 0, 'circle', 100, 0.5, true);
                        this._whirlwindRangeEffect.maxLife = 100;
                        this._whirlwindRangeEffect.life = 100;
                        EffectManager.add(this._whirlwindRangeEffect);
                    }
                }
            }
            updateWhirlwind(dt, entities) {
                if (!this._isWhirlwind) return;
                this._whirlwindTimer += dt;
                // 更新风车范围提示位置（如果开启了范围提示）
                if (this._whirlwindRangeEffect) {
                    if (Game.showAttackRange) {
                        this._whirlwindRangeEffect.x = this.x;
                        this._whirlwindRangeEffect.y = this.y;
                        this._whirlwindRangeEffect.life = 100; // 重置生命周期，防止消失
                        this._whirlwindRangeEffect.active = true;
                    } else {
                        // 用户中途关闭了范围提示
                        this._whirlwindRangeEffect.active = false;
                        this._whirlwindRangeEffect = null;
                    }
                }
                // 攻击判定：从50ms开始，每帧持续检查
                if (this._whirlwindTimer >= 50 && this._whirlwindTimer <= this._whirlwindDuration) {
                    this._checkWhirlwindHit(entities);
                }
                // 风车结束
                if (this._whirlwindTimer >= this._whirlwindDuration) {
                    this._isWhirlwind = false;
                    this._whirlwindTimer = 0;
                    // 清理范围提示
                    if (this._whirlwindRangeEffect) {
                        this._whirlwindRangeEffect.active = false;
                        this._whirlwindRangeEffect = null;
                    }
                    SkillManager.addWhirlwindExp(this, this._whirlwindHitSet.size, 0);
                }
            }
            _checkWhirlwindHit(entities) {
                const skill = this.skills.whirlwind;
                if (!skill) return;
                const effect = skill.getEffect(skill.level);
                const radius = effect.radius;
                const knockback = effect.knockback;
                const damageMul = effect.damageMul;
                const baseDamage = this.getCurrentWeaponAtk();
                const finalDamage = Math.round(baseDamage * damageMul);
                let hitCount = 0, killCount = 0;
                entities.forEach(entity => {
                    if (entity === this || !entity.active || !entity.hittable) return;
                    if (this._whirlwindHitSet.has(entity)) return;
                    const dx = entity.x - this.x, dy = entity.y - this.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= radius) {
                        this._whirlwindHitSet.add(entity);
                        const wasAlive = entity.hp > 0;
                        entity.takeDamage(finalDamage, this);
                        if (wasAlive && entity.hp <= 0) killCount++;
                        hitCount++;
                        const kbAngle = Math.atan2(dy, dx);
                        entity.applyKnockback(kbAngle, knockback);
                    }
                });
                // 剑精通经验（风车攻击命中）
                SkillManager.addMeleeExp(this, hitCount, killCount);
            }
            triggerSpecialAttack(targetX, targetY, entities) {
                const currentItem = this.equipments[this.weaponMode];
                if (!currentItem || currentItem.weaponId !== 'weapon5') return;
                if (this._specialAttackCooldown > 0 || this._specialAttackActive) return;
                this._specialAttackActive = true;
                this._specialAttackTimer = 0;
                this._specialAttackHitSet = new Set();
                this._specialAttackLastTick = 0;
                this._specialAttackAngle = Math.atan2(targetY - this.y, targetX - this.x);
                this._specialAttackLockedAngle = this._specialAttackAngle; // 锁定朝向为鼠标方向
                this._specialAttackCooldown = 5000; // 5秒冷却
                // 计算武器贴图中心世界坐标（标准旋转，与渲染一致）
                const wa = WEAPON_ANIM;
                const s = wa.size;
                const cos = Math.cos(this._specialAttackAngle);
                const sin = Math.sin(this._specialAttackAngle);
                // 本地偏移：base(-12, 17) + rotate(90°) * (0, -101.4) = (89.4, 17)
                const localCenterX = wa.holdX + 8 + s * 0.85 + 30;
                const localCenterY = wa.holdY + 6;
                const centerX = this.x + localCenterX * cos - localCenterY * sin;
                const centerY = this.y + localCenterX * sin + localCenterY * cos;
                // 计算特效终点（1200px 沿武器方向）
                const maxLength = 1200;
                const endX = centerX + maxLength * cos;
                const endY = centerY + maxLength * sin;
                // 障碍物判定：起点到终点间如果有障碍物则截断
                let clampedLength = maxLength;
                if (typeof WallSystem !== 'undefined' && WallSystem.walls) {
                    for (const w of WallSystem.walls) {
                        const hit = this._lineRectIntersection(centerX, centerY, endX, endY, w);
                        if (hit !== null && hit > 0 && hit < 1) {
                            const hitLength = hit * maxLength;
                            if (hitLength < clampedLength) clampedLength = hitLength;
                        }
                    }
                }
                this._specialAttackClampedLength = clampedLength;
                // 创建脉冲式蓝色线条射波特效（使用截断后的长度）
                const beam = new NightFlameBeamEffect(centerX, centerY, this._specialAttackAngle, 45, clampedLength, 3000);
                this._specialAttackBeam = beam;
                EffectManager.add(beam);
                // 显示范围提示（从武器贴图中心开始，使用截断后的长度）
                if (Game.showAttackRange) {
                    EffectManager.add(new AttackRangeEffect(centerX, centerY, this._specialAttackAngle, clampedLength, 45, 'triangle', 3000, 0.4, true));
                }
            }
            updateSpecialAttack(dt, entities) {
                if (!this._specialAttackActive) return;
                this._specialAttackTimer += dt;
                // 锁定朝向
                this.rotation = this._specialAttackLockedAngle;
                // 更新特效位置（跟随武器贴图中心，使用锁定角度）
                if (this._specialAttackBeam && this._specialAttackBeam.active) {
                    const wa = WEAPON_ANIM;
                    const s = wa.size;
                    const cos = Math.cos(this._specialAttackLockedAngle);
                    const sin = Math.sin(this._specialAttackLockedAngle);
                    const localCenterX = wa.holdX + 8 + s * 0.85 + 30;
                    const localCenterY = wa.holdY + 6;
                    this._specialAttackBeam.x = this.x + localCenterX * cos - localCenterY * sin;
                    this._specialAttackBeam.y = this.y + localCenterX * sin + localCenterY * cos;
                }
                // 范围提示持续显示（从武器贴图中心开始，使用截断后的长度）
                if (Game.showAttackRange) {
                    const wa = WEAPON_ANIM;
                    const s = wa.size;
                    const cos = Math.cos(this._specialAttackAngle), sin = Math.sin(this._specialAttackAngle);
                    const localCenterX = wa.holdX + 8 + s * 0.85 + 30;
                    const localCenterY = wa.holdY + 6;
                    const effectX = this.x + localCenterX * cos - localCenterY * sin;
                    const effectY = this.y + localCenterX * sin + localCenterY * cos;
                    const length = this._specialAttackClampedLength || 1200;
                    EffectManager.add(new AttackRangeEffect(effectX, effectY, this._specialAttackAngle, length, 45, 'triangle', 100, 0.4, true));
                }
                // 每200ms进行一次伤害判定
                if (this._specialAttackTimer - this._specialAttackLastTick >= 200) {
                    this._specialAttackLastTick = this._specialAttackTimer;
                    this._checkSpecialAttackHit(entities);
                }
                // 3000ms后结束，触发复位动画
                if (this._specialAttackTimer >= 3000) {
                    const stab = WeaponAnimConfig.stab;
                    this._specialResetAnim = {
                        startOffset: -30, // 30px 前伸
                        startAngle: 0,
                        startTime: Date.now(),
                        duration: (WeaponAnimConfig.stab && WeaponAnimConfig.stab.recoverMs) || 500
                    };
                    this._specialAttackActive = false;
                    this._specialAttackTimer = 0;
                    this._specialAttackBeam = null;
                    this._specialAttackLockedAngle = null;
                    this._specialAttackClampedLength = 1200; // 重置截断长度
                }
            }
            _lineRectIntersection(x1, y1, x2, y2, rect) {
                // Liang-Barsky 线段裁剪算法，返回线段进入矩形时的参数 t (0~1)，无交点返回 null
                const dx = x2 - x1, dy = y2 - y1;
                let u1 = 0, u2 = 1;
                const p = [-dx, dx, -dy, dy], q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];
                for (let i = 0; i < 4; i++) {
                    if (p[i] === 0) { if (q[i] < 0) return null; }
                    else { const t = q[i] / p[i]; if (p[i] < 0) { if (t > u1) u1 = t; } else { if (t < u2) u2 = t; } }
                }
                return u1 < u2 ? u1 : null;
            }
            _checkSpecialAttackHit(entities) {
                const currentItem = this.equipments[this.weaponMode];
                if (!currentItem || currentItem.weaponId !== 'weapon5') return;
                // 计算武器基础伤害
                const d = this.data;
                const baseDamage = Math.round(60 + d.str * 1.5 + d.dex * 1.25);
                const damage = Math.round(baseDamage * 0.25);
                const angle = this._specialAttackAngle;
                const cos = Math.cos(angle), sin = Math.sin(angle);
                const halfW = 22.5; // 45/2
                // 使用截断后的长度
                const length = this._specialAttackClampedLength || 1200;
                // 计算武器贴图中心世界坐标（与渲染一致）
                const wa = WEAPON_ANIM;
                const s = wa.size;
                const localCenterX = wa.holdX + 8 + s * 0.85 + 30;
                const localCenterY = wa.holdY + 6;
                const effectX = this.x + localCenterX * cos - localCenterY * sin;
                const effectY = this.y + localCenterX * sin + localCenterY * cos;
                // 矩形区域检测：以特效圆心为中心，沿angle方向延伸length，宽度45px
                // 每200ms对范围内所有目标造成伤害（持续判定，非一次性）
                entities.forEach(entity => {
                    if (entity === this || !entity.active || !entity.hittable) return;
                    // 将实体坐标转换到光柱局部坐标系
                    const dx = entity.x - effectX, dy = entity.y - effectY;
                    // 投影到光柱方向
                    const proj = dx * cos + dy * sin;
                    // 投影到垂直方向
                    const perp = -dx * sin + dy * cos;
                    // 检测是否在矩形内：0 <= proj <= length, -halfW <= perp <= halfW
                    if (proj >= 0 && proj <= length && perp >= -halfW && perp <= halfW) {
                        entity.takeDamage(damage, this);
                    }
                });
            }
            updateDashAttack(dt, entities) {
                if (!this._isDashing) return;
                const activeSkillId = this._getActiveDashSkillId();
                const isThrust = activeSkillId === 'dashAttackThrust';
                const currentWeapon = this.equipments[this.weaponMode];
                const isMeleeWeapon = currentWeapon && (currentWeapon.category === 'weapon_melee' || currentWeapon.weaponType === 'sword');
                const hasDashSkill = this.skills && this.skills[activeSkillId];
                if (!isMeleeWeapon || !hasDashSkill) {
                    this._isDashing = false;
                    this._dashState = 'idle';
                    this._dashTimer = 0;
                    this._dashBounceApplied = false;
                    this._dashSlashPos = null;
                    this._dashSlashEffect = null;
                    this._dashThrustPhase = null;
                    if (isThrust) SkillManager.addDashThrustExp(this, this._dashHitSet.size, 0);
                    else SkillManager.addDashExp(this, this._dashHitSet.size, 0);
                    return;
                }
                this._dashTimer += dt;
                const skill = this.skills[activeSkillId];
                const effect = skill.getEffect(skill.level);
                if (isThrust) {
                    // === 冲刺攻击-突刺（骑士长剑专属）===
                    const totalMs = this._getSkillParam('dashAttackThrust', 'animation.totalMs', 600);
                    const progress = this._dashTimer / totalMs;
                    const chargeMs = this._getSkillParam('dashAttackThrust', 'animation.chargeMs', 0);
                    const chargeRatio = chargeMs / totalMs;
                    if (progress < chargeRatio) {
                        this._dashState = 'rotate';
                    } else if (progress < 1.0) {
                        if (this._dashState !== 'slash') {
                            this._dashSlashPos = { x: this.x, y: this.y };
                            // 生成金色汇聚特效（在剑尖位置，使用 _dashSlashPos 作为基准）
                            const leftDirX = -this._dashDirection.y;
                            const leftDirY = this._dashDirection.x;
                            const tipX = this._dashSlashPos.x + this._dashDirection.x * 320 + leftDirX * 17.5;
                            const tipY = this._dashSlashPos.y + this._dashDirection.y * 320 + leftDirY * 17.5;
                            EffectManager.add(new GoldenConvergeEffect(tipX, tipY, this._dashDirection.x, this._dashDirection.y, this));
                            if (Game.showAttackRange) {
                                const attackAngle = Math.atan2(this._dashDirection.y, this._dashDirection.x);
                                const rectWidth = this._getSkillParam('dashAttackThrust', 'hitCheck.width', 60);
                                const rectLength = this._getSkillParam('dashAttackThrust', 'hitCheck.length', 400);
                                EffectManager.add(new AttackRangeEffect(this._dashSlashPos.x, this._dashSlashPos.y, attackAngle, rectLength, rectWidth, 'triangle', 1000, 0.5, true));
                            }
                        }
                        this._dashState = 'slash';
                    } else {
                        const endState = this._getDashWeaponStateAt(this._dashTimer, activeSkillId);
                        this._isDashing = false;
                        this._dashState = 'idle';
                        this._dashTimer = 0;
                        this._dashBounceApplied = false;
                        this._dashParticles = [];
                        this._dashSlashEffect = null;
                        this._dashThrustPhase = null;
                        this._dashResetAnim = {
                            startOffset: endState.dashOffset,
                            startAngle: endState.dashAngle,
                            startTime: Date.now(),
                            duration: (WeaponAnimConfig.stab && WeaponAnimConfig.stab.recoverMs) || 500
                        };
                        SkillManager.addDashThrustExp(this, this._dashHitSet.size, 0);
                        // 剑精通经验（突刺攻击命中）
                        if (this._dashThrustPhase) {
                            SkillManager.addMeleeExp(this, this._dashThrustPhase.totalHitCount, this._dashThrustPhase.totalKillCount);
                        }
                        return;
                    }
                    // 移动：前40%时间完成150px位移，速度递减
                    const dashDist = this._getSkillParam('dashAttackThrust', 'animation.dashDist', 150);
                    if (progress < 0.40) {
                        const moveProgress = progress / 0.40;
                        const easedProgress = easeOutQuad(moveProgress);
                        const speedMul = 0.75;
                        const targetX = this._dashStartPos.x + this._dashDirection.x * dashDist * speedMul * easedProgress;
                        const targetY = this._dashStartPos.y + this._dashDirection.y * dashDist * speedMul * easedProgress;
                        const resolved = WallSystem.resolve(this._dashStartPos.x, this._dashStartPos.y, targetX, targetY, this.collisionRadius);
                        const hitWall = Math.abs(resolved.x - targetX) > 1 || Math.abs(resolved.y - targetY) > 1;
                        if (hitWall && !this._dashBounceApplied) {
                            this._dashBounceApplied = true;
                            const bounceDist = dashDist * speedMul * easedProgress * 0.3;
                            const bounceX = this.x - this._dashDirection.x * bounceDist;
                            const bounceY = this.y - this._dashDirection.y * bounceDist;
                            const br = WallSystem.resolve(this.x, this.y, bounceX, bounceY, this.collisionRadius);
                            this.x = br.x; this.y = br.y;
                            EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                        } else {
                            this.x = resolved.x; this.y = resolved.y;
                        }
                    }
                    // 突刺阶段：判定窗口
                    if (this._dashState === 'slash') {
                        const thrustMs = this._getSkillParam('dashAttackThrust', 'animation.thrustMs', 600);
                        const slashStart = chargeMs;
                        const slashEnd = chargeMs + thrustMs;
                        if (this._dashTimer >= slashStart && this._dashTimer <= slashEnd) {
                            this._checkDashHit(entities, activeSkillId);
                        }
                    }
                } else {
                    // === 原始冲刺攻击（dashAttack）===
                    const totalMs = 800;
                    const progress = this._dashTimer / totalMs;
                    const chargeRatio = 350 / 800;
                    if (progress < chargeRatio) {
                        this._dashState = 'charge';
                    } else if (progress < 1.0) {
                        if (this._dashState !== 'slash') {
                            this._dashSlashPos = { x: this.x, y: this.y };
                            if (Game.showAttackRange) {
                                const currentItem = this.equipments[this.weaponMode];
                                const baseRange = (currentItem && currentItem.attack && currentItem.attack.range)
                                    || (this.attacks.melee && this.attacks.melee.config && this.attacks.melee.config.range)
                                    || 165;
                                const skillLevel = skill.level;
                                const range = baseRange + 25 + skillLevel * 5;
                                const attackAngle = Math.atan2(this._dashDirection.y, this._dashDirection.x);
                                const hitArc = 2 * Math.PI / 3;
                                EffectManager.add(new AttackRangeEffect(this._dashSlashPos.x, this._dashSlashPos.y, attackAngle, range, hitArc, 'sector', 1000, 0.5, true));
                            }
                        }
                        this._dashState = 'slash';
                    } else {
                        const endState = this._getDashWeaponStateAt(this._dashTimer, activeSkillId);
                        this._isDashing = false;
                        this._dashState = 'idle';
                        this._dashTimer = 0;
                        this._dashBounceApplied = false;
                        this._dashParticles = [];
                        this._dashSlashEffect = null;
                        this._dashThrustPhase = null;
                        this._dashResetAnim = {
                            startOffset: endState.dashOffset,
                            startAngle: endState.dashAngle,
                            startTime: Date.now(),
                            duration: (WeaponAnimConfig.stab && WeaponAnimConfig.stab.recoverMs) || 500
                        };
                        SkillManager.addDashExp(this, this._dashHitSet.size, this._dashKillCount);
                        // 剑精通经验（冲刺攻击命中，只在攻击结束时发放一次）
                        SkillManager.addMeleeExp(this, this._dashHitSet.size, this._dashKillCount);
                        return;
                    }
                    // 移动：前40%时间完成位移，速度递减
                    const dashDist = 150;
                    if (progress < 0.40) {
                        const moveProgress = progress / 0.40;
                        const easedProgress = easeOutQuad(moveProgress);
                        const speedMul = 0.75;
                        const targetX = this._dashStartPos.x + this._dashDirection.x * dashDist * speedMul * easedProgress;
                        const targetY = this._dashStartPos.y + this._dashDirection.y * dashDist * speedMul * easedProgress;
                        const resolved = WallSystem.resolve(this._dashStartPos.x, this._dashStartPos.y, targetX, targetY, this.collisionRadius);
                        const hitWall = Math.abs(resolved.x - targetX) > 1 || Math.abs(resolved.y - targetY) > 1;
                        if (hitWall && !this._dashBounceApplied) {
                            this._dashBounceApplied = true;
                            const bounceDist = dashDist * speedMul * easedProgress * 0.3;
                            const bounceX = this.x - this._dashDirection.x * bounceDist;
                            const bounceY = this.y - this._dashDirection.y * bounceDist;
                            const br = WallSystem.resolve(this.x, this.y, bounceX, bounceY, this.collisionRadius);
                            this.x = br.x; this.y = br.y;
                            EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                        } else {
                            this.x = resolved.x; this.y = resolved.y;
                        }
                        if (this._dashBounceApplied && progress > 0.1) {
                            const moved = Math.abs(resolved.x - this._dashStartPos.x) + Math.abs(resolved.y - this._dashStartPos.y);
                            if (moved < 2) {
                                const endState = this._getDashWeaponStateAt(this._dashTimer, activeSkillId);
                                this._isDashing = false;
                                this._dashState = 'idle';
                                this._dashTimer = 0;
                                this._dashBounceApplied = false;
                                this._dashSlashPos = null;
                                this._dashSlashEffect = null;
                                this._dashThrustPhase = null;
                                this._dashResetAnim = {
                                    startOffset: endState.dashOffset,
                                    startAngle: endState.dashAngle,
                                    startTime: Date.now(),
                                    duration: (WeaponAnimConfig.stab && WeaponAnimConfig.stab.recoverMs) || 500
                                };
                                SkillManager.addDashExp(this, this._dashHitSet.size, 0);
                                return;
                            }
                        }
                    }
                    // 挥砍阶段：单次扇形判定
                    if (this._dashState === 'slash') {
                        this._checkDashHit(entities, activeSkillId);
                    }
                }
            }
            _checkDashHit(entities, skillId) {
                const activeSkillId = skillId || this._getActiveDashSkillId();
                const isThrust = activeSkillId === 'dashAttackThrust';
                const attackAngle = Math.atan2(this._dashDirection.y, this._dashDirection.x);
                const currentItem = this.equipments[this.weaponMode];
                const baseKnockback = (currentItem && currentItem.attack && currentItem.attack.knockback)
                    || (this.attacks.melee && this.attacks.melee.config && this.attacks.melee.config.knockback)
                    || 8;
                const skill = this.skills[activeSkillId];
                const skillLevel = skill.level;
                const knockback = baseKnockback + 150 + skillLevel * 5;
                const baseRange = (currentItem && currentItem.attack && currentItem.attack.range)
                    || (this.attacks.melee && this.attacks.melee.config && this.attacks.melee.config.range)
                    || 165;
                const range = baseRange + 25 + skillLevel * 5;
                if (isThrust) {
                    // === 矩形持续判定（冲刺攻击-突刺）===
                    const rectWidth = this._getSkillParam('dashAttackThrust', 'hitCheck.width', 75);
                    const rectLength = this._getSkillParam('dashAttackThrust', 'hitCheck.length', 350);
                    const cos = Math.cos(attackAngle), sin = Math.sin(attackAngle);
                    const halfW = rectWidth / 2;
                    if (!this._dashThrustPhase) {
                        this._dashThrustPhase = { startTime: Date.now(), lastHitIndex: -1, totalHitCount: 0, totalKillCount: 0, hitTargets: new Set() };
                    }
                    const phase = this._dashThrustPhase;
                    const elapsed = Date.now() - phase.startTime;
                    const hitIndex = Math.floor(elapsed / 199);
                    if (hitIndex >= 3 || hitIndex <= phase.lastHitIndex) return;
                    phase.lastHitIndex = hitIndex;
                    const baseAtk = this.getCurrentWeaponAtk();
                    let damageMul, levelBonus;
                    if (hitIndex === 0 || hitIndex === 1) {
                        damageMul = 0.80; levelBonus = skillLevel * 0.05;
                    } else {
                        damageMul = 0.90; levelBonus = skillLevel * 0.10;
                    }
                    const damage = Math.floor(baseAtk * damageMul + levelBonus);
                    let hitCount = 0;
                    if (hitIndex === 0) {
                        // 第一次判定：矩形范围判定，记录命中目标
                        entities.forEach(entity => {
                            if (entity === this || !entity.active || !entity.hittable) return;
                            const dx = entity.x - this._dashSlashPos.x;
                            const dy = entity.y - this._dashSlashPos.y;
                            const forward = dx * cos + dy * sin;
                            const lateral = dx * (-sin) + dy * cos;
                            if (forward >= 0 && forward <= rectLength && lateral >= -halfW && lateral <= halfW) {
                                hitCount++;
                                phase.hitTargets.add(entity);
                                if (!this._dashHitSet.has(entity)) this._dashHitSet.add(entity);
                                const wasAlive = entity.hp > 0;
                                const isCrit = Math.random() * 100 < this.data.crit;
                                const finalDamage = isCrit ? Math.floor(damage * 1.5) : damage;
                                entity.takeDamage(finalDamage, this);
                                if (wasAlive && entity.hp <= 0) phase.totalKillCount++;
                                phase.totalHitCount++;
                                entity._dashStunned = true;
                                entity._dashStunTimer = 500;
                                // 击退距离 = 主角突刺移动距离（173 * 0.75 = 130px）
                                const thrustMoveDist = this._getSkillParam('dashAttackThrust', 'animation.dashDist', 173) * 0.75;
                                entity.applyKnockback(attackAngle, thrustMoveDist);
                                EffectManager.add(new HitEffect(entity.x, entity.y));
                                EffectManager.createDamageText(entity.x, entity.y - entity.size, finalDamage, isCrit);
                            }
                        });
                    } else {
                        // 第二、三次判定：不再做范围判定，直接对第一次命中的目标造成伤害
                        phase.hitTargets.forEach(entity => {
                            if (entity === this || !entity.active || !entity.hittable) return;
                            hitCount++;
                            if (!this._dashHitSet.has(entity)) this._dashHitSet.add(entity);
                            const wasAlive = entity.hp > 0;
                            const isCrit = Math.random() * 100 < this.data.crit;
                            const finalDamage = isCrit ? Math.floor(damage * 1.5) : damage;
                            entity.takeDamage(finalDamage, this);
                            if (wasAlive && entity.hp <= 0) phase.totalKillCount++;
                            phase.totalHitCount++;
                            entity._dashStunned = true;
                            entity._dashStunTimer = 500;
                            EffectManager.add(new HitEffect(entity.x, entity.y));
                            EffectManager.createDamageText(entity.x, entity.y - entity.size, finalDamage, isCrit);
                        });
                    }
                } else {
                    // === 扇形单次判定（原始冲刺攻击）===
                    const hitArc = 2 * Math.PI / 3;
                    entities.forEach(entity => {
                        if (entity === this || !entity.active || !entity.hittable) return;
                        if (this._dashHitSet.has(entity)) return;
                        if (MathUtils.pointInSector(entity.x, entity.y, this._dashSlashPos.x, this._dashSlashPos.y, attackAngle, range, hitArc)) {
                            this._dashHitSet.add(entity);
                            const effect = skill.getEffect(skillLevel);
                            const baseDamage = this.getCurrentWeaponAtk();
                            const damage = Math.floor(baseDamage * effect.damageMul);
                            const isCrit = Math.random() * 100 < this.data.crit;
                            const finalDamage = isCrit ? Math.floor(damage * 2) : damage;
                            const wasAlive = entity.hp > 0;
                            entity.takeDamage(finalDamage, this);
                            if (wasAlive && entity.hp <= 0) this._dashKillCount++;
                            const kbAngle = Math.atan2(entity.y - this.y, entity.x - this.x);
                            entity.applyKnockback(kbAngle, knockback);
                            EffectManager.add(new HitEffect(entity.x, entity.y));
                            EffectManager.createDamageText(entity.x, entity.y - entity.size, finalDamage, isCrit);
                            if (isCrit) EffectManager.add(new CritEffect(entity.x, entity.y - entity.size * 1.5));
                            this._dashParticles.push(new DashParticle(entity.x, entity.y, attackAngle, 0.5, 100, 0.8));
                        }
                    });
                }
            }
            triggerWeaponAnim() {
                // 动画打断机制：直接跳到 swing 阶段，跳过 windup 预备阶段
                this.weaponAnim.state = 'swing';
                this.weaponAnim.timer = 0;
                this.rangedFired = false;
                // 注意：_pendingThrust 在 execute() 中设置，不在此处清除
                // swing 阶段会消费 _pendingThrust 并触发 ThrustEffect，消费后设为 null
            }
            switchWeaponMode() {
                // === 新设计：weaponMode 只是表示当前使用哪个栏位 ===
                // 'weapon' = 武器栏1, 'weapon2' = 武器栏2
                // 按 F 键切换：weapon <-> weapon2
                const nextMode = this.weaponMode === 'weapon' ? 'weapon2' : 'weapon';
                const nextItem = this.equipments[nextMode];
                if (!nextItem || !nextItem.name) {
                    // 目标栏位为空，显示提示
                    const hint = document.createElement('div');
                    hint.id = '_weaponSwitchHint';
                    hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(120,50,50,0.9);color:#d4c5a9;font-size:18px;padding:10px 24px;border-radius:8px;border:2px solid #9a5a5a;z-index:99999;pointer-events:none;font-family:SimHei, "Microsoft YaHei", "黑体", sans-serif;white-space:nowrap;transition:opacity 0.5s;';
                    hint.textContent = '⚠ 无可用武器栏';
                    document.body.appendChild(hint);
                    requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 800); });
                    return;
                }
                this.weaponMode = nextMode;
                // G18 切换保护：切换到 pistol 后 300ms 内不能开火
                if (nextItem && (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol')) {
                    this.weaponSwitchCooldown = 300;
                }
                // 视觉反馈：屏幕中央显示切换提示
                const oldHint = document.getElementById('_weaponSwitchHint');
                if (oldHint) oldHint.remove();
                const hint = document.createElement('div');
                hint.id = '_weaponSwitchHint';
                hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(60,50,40,0.9);color:#d4c5a9;font-size:22px;padding:12px 28px;border-radius:8px;border:2px solid #7a6a5a;z-index:99999;pointer-events:none;font-family:SimHei, "Microsoft YaHei", "黑体", sans-serif;white-space:nowrap;transition:opacity 0.5s;';
                const modeName = this.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
                // 图标根据当前栏位的实际装备类型决定
                let modeIcon = '⚔';
                if (nextItem) {
                    if (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol') modeIcon = '🔫';
                    else if (nextItem.weaponType === 'bow') modeIcon = '🏹';
                }
                hint.textContent = `${modeIcon} ${modeName}`;
                document.body.appendChild(hint);
                requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 600); });
                // 切换武器后150ms触发一次待机动画2（旋转动画）
                this.weaponAnim.nextSpin = Date.now() + 150;
                // 更新近战武器贴图：如果当前装备是剑类，切换对应的手持贴图
                if (nextItem && nextItem.equipImage) {
                    this.meleeImage.src = nextItem.equipImage;
                }
                // 更新弓的帧动画
                if (nextItem && nextItem.bowFrames) {
                    const frames = [];
                    for (let i = 0; i < nextItem.bowFrames.length; i++) {
                        const img = new Image(); img.src = nextItem.bowFrames[i]; frames.push(img);
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                } else if (nextItem && nextItem.weaponAsset && nextItem.weaponAsset.framePrefix) {
                    const frames = [];
                    for (let i = 1; i <= nextItem.weaponAsset.frameCount; i++) {
                        const num = String(i).padStart(nextItem.weaponAsset.framePad || 2, '0');
                        const img = new Image(); img.src = nextItem.weaponAsset.framePrefix + num + '.png'; frames.push(img);
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                } else if (nextItem && (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol')) {
                    this.equippedRangedType = 'pistol';
                } else {
                    this.equippedRangedType = null;
                    this.equippedBowFrames = null;
                }
                // 切换武器时同步特殊攻击图标
                if (nextItem && nextItem.weaponId === 'weapon5') {
                    QuickBar.enableSpecialAttack(nextItem);
                } else {
                    QuickBar.disableSpecialAttack();
                }
                // 应用/恢复装备的技能覆盖
                console.log('[SkillOverride] switchWeaponMode: nextItem =', nextItem ? { name: nextItem.name, slot: nextMode, hasOverrides: !!nextItem.skillOverrides } : 'null');
                this._applySkillOverrides(nextItem);
                // 刷新技能栏显示（根据当前武器显示对应的冲刺攻击技能）
                if (typeof SkillManager !== 'undefined' && SkillManager.renderSkillGrid) {
                    SkillManager.renderSkillGrid();
                }
            }
            loadWeaponAssets(item) {
                if (!item) return;
                this.equippedRangedType = null;
                this.equippedBowFrames = null;
                const wt = item.weaponType;
                const wa = item.weaponAsset;
                if (!wt || !wa) return;
                if (wt === 'bow' && wa.framePrefix && wa.frameCount) {
                    const frames = [];
                    for (let i = 1; i <= wa.frameCount; i++) {
                        const num = String(i).padStart(wa.framePad || 2, '0');
                        const img = new Image(); img.src = wa.framePrefix + num + '.png'; frames.push(img);
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                } else if (wt === 'pistol' && wa.image) {
                    this.pistolImage = new Image(); this.pistolImage.src = wa.image;
                    this.equippedRangedType = 'pistol';
                    if (wa.muzzleImage) { this.muzzleFlashImg = new Image(); this.muzzleFlashImg.src = wa.muzzleImage; }
                }
            }
            // ===== weapon4 符文长剑：蓝色发光粒子系统 =====
            _spawnWeaponGlowParticle(s) {
                const colors = ['#4a9eff', '#5bb8ff', '#6ec8ff', '#3d8bfa', '#2a7af5', '#7ad0ff', '#a0e0ff', '#5599ff'];
                const hiltX = (Math.random() - 0.5) * 4;
                const hiltY = (Math.random() - 0.5) * 4;
                const theta = this.rotation;
                const floatSpeed = 0.3 + Math.random() * 0.2;
                // 将世界方向转换为武器局部坐标系方向（武器局部 = 世界旋转 -(theta + PI/2)）
                // cos(-(theta+PI/2)) = -sin(theta), sin(-(theta+PI/2)) = -cos(theta)
                const cosA = -Math.sin(theta);
                const sinA = -Math.cos(theta);
                let pvx, pvy;
                if (this.isMoving) {
                    // 移动状态：粒子向鼠标指针反方向±15度内随机浮动
                    const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                    const dx = mouseWorld.x - this.x;
                    const dy = mouseWorld.y - this.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 0) {
                        const baseAngle = Math.atan2(-dy, -dx); // 远离鼠标的基础角度
                        const randomOffset = (Math.random() - 0.5) * (Math.PI / 6); // ±15度 = ±π/12
                        const finalAngle = baseAngle + randomOffset;
                        const wx = Math.cos(finalAngle);
                        const wy = Math.sin(finalAngle);
                        pvx = (wx * cosA - wy * sinA) * floatSpeed;
                        pvy = (wx * sinA + wy * cosA) * floatSpeed;
                    } else {
                        // 鼠标恰好在玩家位置，默认向上
                        pvx = -sinA * floatSpeed;
                        pvy = -cosA * floatSpeed;
                    }
                } else {
                    // 待机状态：粒子向四周随机扩散
                    const angle = Math.random() * Math.PI * 2;
                    const wx = Math.cos(angle);
                    const wy = Math.sin(angle);
                    pvx = (wx * cosA - wy * sinA) * floatSpeed;
                    pvy = (wx * sinA + wy * cosA) * floatSpeed;
                }
                this.weaponGlowParticles.push({
                    x: hiltX,
                    y: hiltY,
                    vx: pvx,
                    vy: pvy,
                    size: 0.3 + Math.random() * 0.2,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    life: 1200 + Math.random() * 600,          // 生命周期：原始值延长50%（原800+400→1200+600）
                    maxLife: 1200 + Math.random() * 600,
                    pulseOffset: Math.random() * Math.PI * 2,
                    createdAt: Date.now()                     // 标记粒子生成时间，用于状态过渡
                });
            }
            _updateWeaponGlow(dt, s) {
                const now = Date.now();
                
                // 攻击或技能期间：不生成新粒子，但已生成的粒子继续播放
                const isAttacking = this.weaponAnim.state !== 'idle';
                const isUsingSkill = this._isWhirlwind || this._isDashing || this._specialAttackActive;
                const isInCombat = isAttacking || isUsingSkill;
                
                // 检测状态是否改变（待机 ↔ 移动）
                if (this._glowLastState !== this.isMoving) {
                    this._glowTransitionStart = now;    // 标记过渡开始
                    this._glowLastState = this.isMoving; // 同步新状态
                }
                
                const transitionElapsed = this._glowTransitionStart > 0 ? now - this._glowTransitionStart : 0;
                
                // 生成新粒子（按当前状态）——攻击/技能期间暂停生成
                if (!isInCombat) {
                    if (!this.isMoving) {
                        // 待机状态：粒子数量翻倍
                        if (Math.random() < 0.7) {
                            this._spawnWeaponGlowParticle(s);
                            this._spawnWeaponGlowParticle(s);
                        }
                    } else {
                        if (Math.random() < 0.7) this._spawnWeaponGlowParticle(s);
                    }
                }
                
                // 更新粒子（攻击/技能期间继续播放已生成的粒子）
                this.weaponGlowParticles.forEach(p => {
                    p.life -= dt;
                    p.y += p.vy;
                    p.x += p.vx;
                    p.size *= 0.998;
                });
                
                // 过渡1s后，清除旧粒子（状态改变前产生的粒子）
                if (this._glowTransitionStart > 0 && transitionElapsed > 1000) {
                    this.weaponGlowParticles = this.weaponGlowParticles.filter(p => p.createdAt >= this._glowTransitionStart);
                    this._glowTransitionStart = 0; // 重置过渡标记
                } else {
                    this.weaponGlowParticles = this.weaponGlowParticles.filter(p => p.life > 0);
                }
            }
            _renderWeaponGlow(ctx) {
                const now = Date.now();
                const transitionElapsed = this._glowTransitionStart > 0 ? now - this._glowTransitionStart : 0;
                const transitionRatio = Math.min(1, transitionElapsed / 1000);
                // 旧粒子生命周期衰减因子：从100%（1.0）逐步减少到20%（0.2）
                const oldLifeFactor = Math.max(0.2, 1 - 0.8 * transitionRatio);
                
                this.weaponGlowParticles.forEach(p => {
                    const isOld = this._glowTransitionStart > 0 && p.createdAt < this._glowTransitionStart;
                    
                    let lifeRatio = p.life / p.maxLife;
                    if (isOld && transitionElapsed <= 1000) {
                        // 过渡期间，旧粒子的生命周期显示效果从100%逐步减少到20%
                        lifeRatio = lifeRatio * oldLifeFactor;
                    }
                    
                    const fadeIn = Math.min(1, (1 - lifeRatio) * 3);
                    const fadeOut = Math.min(1, lifeRatio * 2);
                    const alpha = Math.min(fadeIn, fadeOut) * 0.5;
                    const pulse = 1 + Math.sin(now * 0.003 + p.pulseOffset) * 0.15;
                    const size = p.size * pulse;
                    ctx.globalAlpha = alpha;
                    // 主粒子（小圆）
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
                    ctx.fill();
                    // 火焰光晕层（椭圆，略大更淡，火焰形状）
                    ctx.globalAlpha = alpha * 0.35;
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.ellipse(p.x, p.y - size * 0.5, size * 1.8, size * 2.8, 0, 0, Math.PI * 2);
                    ctx.fill();
                    // 外层光晕（更大更淡）
                    ctx.globalAlpha = alpha * 0.15;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, size * 3.5, 0, Math.PI * 2);
                    ctx.fill();
                    // 核心亮点（极小极亮）
                    ctx.globalAlpha = alpha * 0.9;
                    ctx.fillStyle = '#e0f0ff';
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, size * 0.3, 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.globalAlpha = 1;
            }
            _getAnimMs(baseMs) {
                // 根据当前装备的实际类型选择动画配置
                const currentItem = this.equipments[this.weaponMode];
                let cfgKey = 'sword'; // 默认
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') cfgKey = 'pistol';
                    else if (currentItem.weaponType === 'bow') cfgKey = 'bow';
                }
                const cfg = WeaponAnimConfig[cfgKey];
                const mul = (cfg ? cfg.timingMul : 1) * (this.animTimingMul || 1);
                return Math.round(baseMs * mul);
            }
            _fireRanged() {
                const d = this.rangedFireData;
                const c = Math.cos(this.rotation), sin = Math.sin(this.rotation);
                const currentItem = this.equipments[this.weaponMode];
                const isPistol = currentItem && (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol');
                const isBow = currentItem && currentItem.weaponType === 'bow';
                const wac = WeaponAnimConfig[isPistol ? 'pistol' : (isBow ? 'bow' : 'sword')];
                const holdX = wac ? wac.holdOffsetX : WEAPON_ANIM.holdX;
                const holdY = wac ? wac.holdOffsetY : WEAPON_ANIM.holdY;
                if (isPistol) {
                    // 枪口在枪身正前方
                    const gunLX = this.size + 20, gunLY = holdY;
                    // 子弹从枪口发射
                    const spawnX = this.x + c * (gunLX + 22) - sin * gunLY;
                    const spawnY = this.y + sin * (gunLX + 22) + c * gunLY;
                    const angle = Math.atan2(d.targetY - this.y, d.targetX - this.x);
                    const pc = this.attacks.pistol.config;
                    // 创建黄色曳光弹（isTracer = true）
                    { let p = EffectManager._acquire('Projectile');
                    if (p) { p.x = spawnX; p.y = spawnY; p.angle = angle; p.speed = pc.projectileSpeed; p.maxRange = pc.projectileRange; p.size = pc.projectileSize; p.damage = pc.damage; p.piercing = pc.piercing; p.source = this; p.entities = d.entities; p.image = null; p.isTracer = true; p.traveled = 0; p.active = true; p.hitTargets = new Set(); }
                    else p = new Projectile(spawnX, spawnY, angle, pc.projectileSpeed, pc.projectileRange, pc.projectileSize, pc.damage, pc.piercing, this, d.entities, null, true);
                    EffectManager.add(p); }
                    // 枪口火焰特效
                    const flashX = this.x + c * (gunLX + 28) - sin * gunLY;
                    const flashY = this.y + sin * (gunLX + 28) + c * gunLY;
                    { let m = EffectManager._acquire('MuzzleFlashEffect');
                    if (m) { m.x = flashX; m.y = flashY; m.angle = angle; m.life = m.maxLife; m.active = true; }
                    else m = new MuzzleFlashEffect(flashX, flashY, angle);
                    EffectManager.add(m); }
                    // 弹壳从抛壳窗弹出（枪身右侧后方）
                    { const cSX = this.x + c * (gunLX - 8) - sin * (gunLY + 6), cSY = this.y + sin * (gunLX - 8) + c * (gunLY + 6);
                    let s = EffectManager._acquire('ShellCasingEffect');
                    if (s) { s.x = cSX; s.y = cSY; s.life = s.maxLife; s.active = true; }
                    else s = new ShellCasingEffect(cSX, cSY, angle);
                    EffectManager.add(s); }
                } else if (isBow) {
                    const cfg = this.attacks.ranged.config;
                    const bowLX = this.size + 15, bowLY = holdY;
                    const spawnX = this.x + c * bowLX - sin * bowLY;
                    const spawnY = this.y + sin * bowLX + c * bowLY;
                    const angle = Math.atan2(d.targetY - spawnY, d.targetX - spawnX);
                    { let p = EffectManager._acquire('Projectile');
                    if (p) { p.x = spawnX; p.y = spawnY; p.angle = angle; p.speed = cfg.projectileSpeed; p.maxRange = cfg.projectileRange; p.size = cfg.projectileSize; p.damage = cfg.damage; p.piercing = cfg.piercing; p.source = this; p.entities = d.entities; p.image = this.arrowImage; p.traveled = 0; p.active = true; p.hitTargets = new Set(); }
                    else p = new Projectile(spawnX, spawnY, angle, cfg.projectileSpeed, cfg.projectileRange, cfg.projectileSize, cfg.damage, cfg.piercing, this, d.entities, this.arrowImage);
                    EffectManager.add(p); }
                }
                this.rangedFired = true; this.rangedFireData = null;
            }
            updateWeaponAnim(dt) {
                const wa = WEAPON_ANIM, anim = this.weaponAnim;
                switch (anim.state) {
                    case 'idle':
                        if (anim.spinEnd && Date.now() < anim.spinEnd) {
                            const t = 1 - (anim.spinEnd - Date.now()) / anim.spinDuration;
                            anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06 + t * Math.PI * 8;
                            break;
                        }
                        anim.spinEnd = 0;
                        anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06;
                        if (!anim.nextSpin) anim.nextSpin = Date.now() + 3000 + Math.random() * 3000;
                        if (Date.now() >= anim.nextSpin) {
                            anim.spinDuration = 650; // 650ms内完成4圈旋转
                            anim.spinEnd = Date.now() + anim.spinDuration;
                            anim.nextSpin = Date.now() + anim.spinDuration + 3000 + Math.random() * 3000;
                        }
                        break;
                    case 'windup':
                        anim.spinEnd = 0; // 攻击打断旋转动画
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.windupMs)) { anim.state = 'swing'; anim.timer = 0; }
                        else anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * easeInQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        break;
                    case 'swing':
                        // swing阶段：进行三角形攻击判定
                        if (anim.timer === 0 && this._pendingThrust) {
                            // swing阶段开始：标记攻击为活跃状态
                            this._pendingThrust.active = true;
                        }
                        // 每帧进行三角形命中判定（仅近战武器），判定窗口200ms
                        if (this._pendingThrust && this._pendingThrust.active) {
                            if (Date.now() - this._pendingThrust.startTime <= 200) {
                                this.attacks.melee.checkTriangleHit(this);
                            } else {
                                this._pendingThrust.active = false;
                            }
                        }
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.swingMs)) {
                            anim.state = 'recover';
                            anim.timer = 0;
                            // swing阶段结束：统一发放经验（只计算一次）
                            if (this._pendingThrust) {
                                this._pendingThrust.active = false;
                                this.attacks.melee.giveExp(this);
                            }
                        }
                        else {
                            anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * easeOutQuad(anim.timer / this._getAnimMs(wa.swingMs));
                            // swing阶段：根据当前装备类型决定发射逻辑
                            const currentItem = this.equipments[this.weaponMode];
                            const isRangedWeapon = currentItem && (currentItem.weaponType === 'bow' || currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol');
                            if (!this.rangedFired && isRangedWeapon && this.rangedFireData) this._fireRanged();
                        }
                        break;
                    case 'recover':
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.recoverMs)) {
                            anim.state = 'idle';
                            anim.timer = 0;
                            // 恢复阶段结束，完全清除攻击数据
                            this._pendingThrust = null;
                        }
                        else anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * easeInOutCubic(anim.timer / this._getAnimMs(wa.recoverMs));
                        break;
                }
            }
            renderStaminaBar(ctx, x, y) {
                const barWidth = 36, barHeight = 5, staminaPercent = this.data.stamina / this.data.maxStamina;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(x - barWidth/2, y + this.size + 6, barWidth, barHeight);
                const staminaColor = staminaPercent > 0.5 ? '#a09060' : staminaPercent > 0.25 ? '#a08040' : '#8a4a4a';
                ctx.fillStyle = staminaColor; ctx.fillRect(x - barWidth/2, y + this.size + 6, barWidth * staminaPercent, barHeight);
                ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)'; ctx.lineWidth = 1; ctx.strokeRect(x - barWidth/2, y + this.size + 6, barWidth, barHeight);
            }
            renderWeapon(ctx) {
                const wa = WEAPON_ANIM;
                const s = wa.size;
                // 获取当前武器栏位的装备
                const currentItem = this.equipments[this.weaponMode];
                if (!currentItem || !currentItem.name) return; // 当前栏位无装备，不渲染
                // 判断当前装备类型
                const isPistol = currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol';
                const isBow = currentItem.weaponType === 'bow';
                const isMelee = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
                const anim = this.weaponAnim;
                const isAttacking = anim.state !== 'idle';
                ctx.save();
                // === 手枪渲染 ===
                if (isPistol) {
                    if (isAttacking) {
                        const pCfg = WeaponAnimConfig.pistol;
                        let recoil = 0, shakeY = 0;
                        if (anim.state === 'windup') {
                            recoil = -s * 0.04 * easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        } else if (anim.state === 'swing') {
                            const st = anim.timer / this._getAnimMs(wa.swingMs);
                            recoil = s * 0.1 * (1 - st);
                            shakeY = (Math.random() - 0.5) * 3 * (1 - st);
                        } else {
                            const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                            recoil = -s * 0.04 * (1 - rt);
                        }
                        const gunX = this.size + 12 + recoil;
                        ctx.translate(gunX, (pCfg.holdOffsetY || 0) + shakeY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        // 枪口火焰
                        if (anim.state === 'swing' && anim.timer < this._getAnimMs(wa.swingMs) * 0.5) {
                            const flashAlpha = 1 - anim.timer / (this._getAnimMs(wa.swingMs) * 0.5);
                            ctx.save();
                            ctx.globalAlpha = flashAlpha;
                            const mImg = this.muzzleFlashImg || (this.muzzleFlashImg = Object.assign(new Image(), { src: 'assets/effects/muzzle_flash_01.png' })); if (mImg && mImg.complete && mImg.naturalWidth > 0) ctx.drawImage(mImg, s * 0.92, -s * 0.15, s * 0.35, s * 0.3);
                            ctx.restore();
                        }
                        const w = s * 0.55;
                        if (this.pistolImage && this.pistolImage.complete && this.pistolImage.naturalWidth > 0) ctx.drawImage(this.pistolImage, -w / 2, 0, w, s);
                    } else {
                        // 手枪待机
                        const pCfg = WeaponAnimConfig.pistol;
                        ctx.translate(this.size + 12, (pCfg.holdOffsetY || 0));
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        let finalAngle = anim.angle;
                        if (this.isMoving && anim.state === 'idle' && !anim.spinEnd) {
                            const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                            finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                        }
                        ctx.rotate(finalAngle);
                        const w = s * 0.55;
                        if (this.pistolImage && this.pistolImage.complete && this.pistolImage.naturalWidth > 0) ctx.drawImage(this.pistolImage, -w / 2, 0, w, s);
                    }
                }
                // === 弓渲染 ===
                else if (isBow) {
                    if (isAttacking) {
                        let t = 0;
                        if (anim.state === 'windup') t = easeOutQuad(anim.timer / wa.windupMs);
                        else if (anim.state === 'swing') t = 1;
                        else if (anim.state === 'recover') t = 1 - easeInQuad(anim.timer / wa.recoverMs);
                        const startX = wa.holdX;
                        const endX = this.size + 15;
                        const curX = startX + (endX - startX) * t;
                        ctx.translate(curX, wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        ctx.rotate(Math.PI / 2 * t);
                        // 8帧弓动画
                        const frames = this.equippedBowFrames || this.bowFrames;
                        let frameIdx = 0;
                        const totalMs = wa.windupMs + wa.swingMs + wa.recoverMs;
                        let attackProgress = 0;
                        if (anim.state === 'windup') attackProgress = anim.timer / totalMs;
                        else if (anim.state === 'swing') attackProgress = (wa.windupMs + anim.timer) / totalMs;
                        else if (anim.state === 'recover') attackProgress = (wa.windupMs + wa.swingMs + anim.timer) / totalMs;
                        frameIdx = Math.min(7, Math.floor(attackProgress * 8));
                        const bowImg = frames[frameIdx] || frames[0];
                        const w = s * 0.6;
                        if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) ctx.drawImage(bowImg, -w / 2, -s / 2, w, s);
                        else { ctx.fillStyle = '#8a7d6b'; ctx.fillRect(-2, -s/2, 4, s); ctx.fillRect(-w/2, -s/2, w, 3); ctx.fillRect(-w/2, s/2-3, w, 3); }
                    } else {
                        // 弓待机（待机动画2）：武器以自身对称中心旋转
                        const bowCfg = WeaponAnimConfig.bow;
                        ctx.translate(bowCfg.holdOffsetX || wa.holdX, bowCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s / 2); // 移到武器中心，使旋转中心在武器对称中心
                        let finalAngle = anim.angle;
                        if (this.isMoving && anim.state === 'idle' && !anim.spinEnd) {
                            const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                            finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                        }
                        ctx.rotate(finalAngle); // 绕武器中心旋转
                        const frames = this.equippedBowFrames || this.bowFrames;
                        const bowImg = frames[0];
                        const w = s * 0.6;
                        if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) ctx.drawImage(bowImg, -w / 2, -s / 2, w, s);
                        else { ctx.fillStyle = '#8a7d6b'; ctx.fillRect(-2, -s/2, 4, s); ctx.fillRect(-w/2, -s/2, w, 3); ctx.fillRect(-w/2, s/2-3, w, 3); }
                    }
                }
                // === 近战（剑等）渲染 ===
                else if (isMelee) {
                    if (this._isWhirlwind) {
                        // 风车技能：武器跟随人物整体旋转（旋转在 render() 中已处理）
                        // 前50ms：武器远离人物平移15px；之后保持15px偏移
                        const w = s * 0.84;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        let whirlwindOffset = 0;
                        if (this._whirlwindTimer <= 50) {
                            whirlwindOffset = 15 * easeOutQuad(this._whirlwindTimer / 50);
                        } else {
                            whirlwindOffset = 15;
                        }
                        ctx.translate(0, whirlwindOffset);
                        ctx.translate(0, -s * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -s / 2, w, s);
                        }
                        if (currentItem && currentItem.weaponId === 'weapon4') {
                            this._renderWeaponGlow(ctx);
                        }
                    } else if (this._isDashing) {
                        // ===== 冲刺攻击武器动画 =====
                        const activeSkillId = this._getActiveDashSkillId();
                        const state = this._getDashWeaponStateAt(this._dashTimer, activeSkillId);
                        const w = s * 0.84;
                        // 旋转中心在剑柄位置（主角处），与待机/攻击动画一致
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2); // 基础旋转，使待机时武器水平朝右
                        ctx.translate(0, state.dashOffset);
                        ctx.rotate(state.dashAngle);

                        ctx.translate(0, -s * 0.85); // 移到武器中心，确保位置与待机/攻击一致
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -s / 2, w, s);
                        }
                        // weapon4 粒子：在武器变换后绘制，但粒子本身不旋转
                        if (currentItem && currentItem.weaponId === 'weapon4') {
                            this._renderWeaponGlow(ctx);
                        }
                    } else if (this._dashResetAnim) {
                        // 冲刺攻击后复位动画：复用突刺攻击 recover 动画曲线
                        const elapsed = Date.now() - this._dashResetAnim.startTime;
                        const t = Math.min(1, elapsed / this._dashResetAnim.duration);
                        const stab = WeaponAnimConfig.stab;
                        const snapRatio = 0.15;
                        let resetOffset;
                        if (t < snapRatio) {
                            const pt = t / snapRatio;
                            // 快速从冲刺结束位置瞬移到接近待机位置
                            resetOffset = this._dashResetAnim.startOffset + (-stab.recoverSnapDist - this._dashResetAnim.startOffset) * pt;
                        } else {
                            const pt = (t - snapRatio) / (1 - snapRatio);
                            // 平滑 easeOutQuad 从接近待机位置回到 0
                            resetOffset = -stab.recoverSnapDist * (1 - easeOutQuad(pt));
                        }
                        // 角度使用 easeOutQuad 平滑回到 0
                        const angleT = easeOutQuad(t);
                        const resetAngle = this._dashResetAnim.startAngle * (1 - angleT);
                        const w = s * 0.84;
                        ctx.translate(wa.holdX + 8 * (1 - t), wa.holdY + 6 * (1 - t));
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, resetOffset);
                        ctx.rotate(resetAngle);
                        ctx.translate(0, -s * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -s / 2, w, s);
                        }
                        if (currentItem && currentItem.weaponId === 'weapon4') {
                            this._renderWeaponGlow(ctx);
                        }
                    } else if (this._specialResetAnim) {
                        // 特殊攻击后复位动画：复用突刺攻击 recover 动画曲线
                        const elapsed = Date.now() - this._specialResetAnim.startTime;
                        const t = Math.min(1, elapsed / this._specialResetAnim.duration);
                        const stab = WeaponAnimConfig.stab;
                        const snapRatio = 0.15;
                        let resetOffset;
                        if (t < snapRatio) {
                            const pt = t / snapRatio;
                            resetOffset = this._specialResetAnim.startOffset + (-stab.recoverSnapDist - this._specialResetAnim.startOffset) * pt;
                        } else {
                            const pt = (t - snapRatio) / (1 - snapRatio);
                            resetOffset = -stab.recoverSnapDist * (1 - easeOutQuad(pt));
                        }
                        const angleT = easeOutQuad(t);
                        const resetAngle = this._specialResetAnim.startAngle * (1 - angleT);
                        const w = s * 0.84;
                        ctx.translate(wa.holdX + 8 * (1 - t), wa.holdY + 6 * (1 - t));
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, resetOffset);
                        ctx.rotate(resetAngle);
                        ctx.translate(0, -s * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -s / 2, w, s);
                        }
                        if (currentItem && currentItem.weaponId === 'weapon4') {
                            this._renderWeaponGlow(ctx);
                        }
                    } else if (this._specialAttackActive) {
                        // 特殊攻击期间：武器前伸30px
                        const w = s * 0.84;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.85);
                        ctx.translate(0, -30); // 武器前伸 30px
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -s / 2, w, s);
                        }
                        if (currentItem && currentItem.weaponId === 'weapon4') {
                            this._renderWeaponGlow(ctx);
                        }
                    } else if (isAttacking) {
                        // 使用刺击动画配置（Stab Animation），可被所有剑类武器复用
                        const stab = WeaponAnimConfig.stab;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        // 移动到武器中心（旋转中心在武器中心）
                        ctx.translate(0, -s * 0.85);
                        let thrustOffset = 0;
                        if (anim.state === 'windup') {
                            const t = anim.timer / this._getAnimMs(wa.windupMs);
                            // 蓄力：回退（靠近角色），使用正值
                            thrustOffset = s * stab.windupDist * easeInCubic(t);
                        } else if (anim.state === 'swing') {
                            const t = anim.timer / this._getAnimMs(wa.swingMs);
                            // 攻击：前刺（远离角色），使用负值
                            if (t < 0.6) {
                                const pt = t / 0.6;
                                // 从回退位置 (+29.4) 快速前刺到 -151.2
                                thrustOffset = s * stab.windupDist - s * (stab.stabDist + stab.windupDist) * easeOutQuad(pt);
                            } else {
                                thrustOffset = -s * stab.stabDist;
                            }
                        } else {
                            const t = anim.timer / this._getAnimMs(wa.recoverMs);
                            // 后摇：先瞬移回待机位置附近，再平滑过渡
                            const snapRatio = 0.15; // 15%时间完成瞬移
                            if (t < snapRatio) {
                                const pt = t / snapRatio;
                                // 线性快速从最远点瞬移到 -8px
                                thrustOffset = -s * stab.stabDist + (s * stab.stabDist - stab.recoverSnapDist) * pt;
                            } else {
                                const pt = (t - snapRatio) / (1 - snapRatio);
                                // 平滑 easeOut 从 -8px 到 0
                                thrustOffset = -stab.recoverSnapDist * (1 - easeOutQuad(pt));
                            }
                        }
                        ctx.translate(0, thrustOffset);
                        ctx.rotate(anim.angle);
                        const w = s * 0.84;
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) ctx.drawImage(this.meleeImage, -w / 2, -s / 2, w, s);
                        // weapon4 符文长剑：绘制蓝色发光粒子（紧密贴合剑身，50%透明度）
                        if (currentItem && currentItem.weaponId === 'weapon4') {
                            this._renderWeaponGlow(ctx);
                        }
                    } else {
                        // 近战待机：武器绕自身中心旋转（呼吸效果 + 旋转动画）
                        const swordCfg = WeaponAnimConfig.sword;
                        ctx.translate(swordCfg.holdOffsetX || wa.holdX, swordCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        // 先移动到武器中心，使旋转中心在武器中心
                        ctx.translate(0, -s * 0.85);
                        // weapon4 符文长剑：在呼吸旋转前绘制粒子（不随待机动画旋转）
                        if (currentItem && currentItem.weaponId === 'weapon4') {
                            this._renderWeaponGlow(ctx);
                        }
                        // 使用 anim.angle（包含呼吸和旋转动画）
                        let finalAngle = anim.angle;
                        if (this.isMoving && anim.state === 'idle' && !anim.spinEnd) {
                            const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                            // 移动时旋转幅度稍大，配合步伐
                            finalAngle += Math.sin(this.animTime * 0.5) * Math.min(0.2, mSpeed * 0.06);
                        }
                        ctx.rotate(finalAngle);
                        const w = s * 0.84;
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) ctx.drawImage(this.meleeImage, -w / 2, -s / 2, w, s);
                    }
                }
                ctx.restore();
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y), x = pos.x, y = pos.y + (this.isDodging ? 0 : Math.sin(this.animTime) * 2);
                this.renderStaminaBar(ctx, x, y); ctx.save(); ctx.translate(x, y);
                if (this.isDodging) { const tilt = Math.atan2(this.dodgeDirection.y, this.dodgeDirection.x); ctx.rotate(tilt + Math.PI/2); }
                else ctx.rotate(this.rotation);
                const currentItem = this.equipments[this.weaponMode];
                let attackType = 'melee';
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackType = 'pistol';
                    else if (currentItem.weaponType === 'bow') attackType = 'ranged';
                }
                const attack = this.attacks[attackType];
                if (this.isDodging) ctx.globalAlpha = 0.7;
                if (this._isDashing) {
                    // 冲刺攻击：角色发光 + 拖尾效果
                    const dashProgress = this._dashTimer / 800;
                    const glowAlpha = dashProgress < 0.40 ? 0.6 : 0.6 * (1 - (dashProgress - 0.40) / 0.60);
                    ctx.fillStyle = `rgba(74, 158, 255, ${glowAlpha})`;
                    ctx.beginPath(); ctx.arc(0, 0, this.size + 3, 0, Math.PI*2); ctx.fill();
                    // 冲刺方向指示器
                    ctx.save();
                    const dashAngle = Math.atan2(this._dashDirection.y, this._dashDirection.x);
                    ctx.rotate(dashAngle);
                    ctx.fillStyle = `rgba(74, 158, 255, ${glowAlpha * 0.5})`;
                    ctx.beginPath(); ctx.moveTo(this.size + 8, 0); ctx.lineTo(this.size - 4, -5); ctx.lineTo(this.size - 4, 5); ctx.closePath(); ctx.fill();
                    ctx.restore();
                }
                if (this._dashConvergeAuraActive) {
                    // 冲刺就绪金色光点：亮度闪烁
                    const flicker = 0.4 + Math.sin(Date.now() / 120) * 0.25;
                    ctx.fillStyle = `rgba(255, 230, 100, ${flicker * 0.35})`;
                    ctx.beginPath(); ctx.arc(0, 0, this.size + 7, 0, Math.PI * 2); ctx.fill();
                }
                // 阴影在风车旋转之前绘制（地面投影不旋转）
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 8, 4, 0, 0, Math.PI*2); ctx.fill();
                if (this._isWhirlwind) {
                    // 风车技能：人物和武器整体旋转（叠加在基础旋转之上）
                    // 前50ms不旋转（武器平移阶段），后750ms旋转4圈，使用easeOutQuad使速度逐步放慢
                    let spinAngle = 0;
                    if (this._whirlwindTimer > 50) {
                        const t = Math.min(1, (this._whirlwindTimer - 50) / (this._whirlwindDuration - 50));
                        spinAngle = easeOutQuad(t) * 4 * Math.PI * 2;
                    }
                    ctx.rotate(spinAngle);
                }
                ctx.fillStyle = this.isDodging ? '#a0c0a0' : CONFIG.PLAYER_COLOR; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = 'rgba(154, 186, 138, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                this.renderWeapon(ctx);
                ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.moveTo(this.size + 5, 0); ctx.lineTo(this.size - 1, -4); ctx.lineTo(this.size - 1, 4); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = 'rgba(122, 154, 106, 0.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, this.size + 5 + Math.sin(Date.now()/300)*1.5, 0, Math.PI*2); ctx.stroke();
                ctx.restore();
                ctx.globalAlpha = 1;
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.data.name, x, y - 32);
                this.renderCollisionRadius(ctx);
            }
        }

export { Player };
