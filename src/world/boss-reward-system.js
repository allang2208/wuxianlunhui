/**
 * BossRewardSystem — Boss战与奖励系统（地牢模式重构 Stage 4）
 * ============================================================
 * 
 * 职责：
 *   1. Boss 战管理：4096 固定场地、大块头 Boss 生成与战斗
 *   2. 奖励节点管理：复用雪地场景 RewardSystem 界面
 *   3. Buff 系统：女神祝福、恶魔祈祷（与现有 StatusBar 兼容）
 * 
 * 集成点：
 *   - dungeon-map-system.js _enterBoss() → BossRewardSystem.enterBossBattle()
 *   - dungeon-map-system.js _enterNode() reward 类型 → BossRewardSystem.enterRewardNode()
 *   - 战斗完成后 → BossRewardSystem.showReward() → RewardSystem.open()
 */

import { Enemy } from '../entities/enemy.js';
import { RewardSystem } from '../ui/reward-system.js';

// ==================== 配置对象 ====================

export const BOSS_REWARD_CONFIG = {
    // Boss 场地配置
    arena: {
        size: 4096,           // 固定场地大小
        wallThickness: 40,    // 边界墙壁厚度
        margin: 60,           // 玩家/怪物生成边距
        playerOffset: 80,     // 玩家从边界向内偏移
    },

    // Boss 配置（大块头）
    boss: {
        name: '大块头',
        id: 'bigBoss',
        // 基础属性（基于 PROJECT_STATE.md 记录）
        hp: 160000,           // 8000 × 20
        maxHp: 160000,
        size: 160,            // 40 × 4
        collisionRadius: 80,
        speed: 45,            // 较慢但沉重
        level: 20,
        color: '#5a3a2a',
        headColor: '#7a5a4a',
        highlightColor: 'rgba(90, 58, 42, 0.3)',
        // 六维属性
        str: 153,             // 51 × 3
        dex: 30,
        con: 114,             // 影响 HP 和防御
        int: 10,
        wis: 20,
        luck: 15,
        rank: 'boss',
        attackRange: 200,
        aiInterval: 2000,
        // 攻击配置
        attack: {
            type: 'thrust',
            cooldown: 1200,
            dynamicRange: 200,
            width: 40,
            damageMin: 45,
            damageMax: 75,
            knockback: 25,
        },
        // AI 配置
        ai: {
            aggroRange: 1200,
            pacingRange: 300,
            loseTimeout: 5000,
        },
        // 技能配置
        skills: {
            // 蓄力扇形斩
            fanSlash: {
                name: '蓄力扇形斩',
                range: 150,
                angle: 120,           // 度
                damageMultiplier: 2,
                cooldown: 6000,
                windupTime: 1500,     // 蓄力时间
            },
            // 蓄力冲锋
            charge: {
                name: '蓄力冲锋',
                speed: 400,           // px/s
                damageMultiplier: 3,
                cooldown: 25000,
                minDistance: 800,     // 优先在 800px 以上使用
                windupTime: 1000,
            },
            // 召唤小僵尸
            summon: {
                name: '召唤小僵尸',
                count: 2,
                cooldown: 60000,
                summonHpPercent: 0.5, // 50% HP 以下才召唤
            },
        },
    },

    // 奖励配置
    reward: {
        // 基础奖励（击败 Boss 后）
        baseGold: 2000,
        goldVariance: 500,
        // 奖励卡牌额外奖励（在 RewardSystem 基础上追加）
        bonusCards: [
            {
                id: 'boss_card_1',
                title: 'Boss 战利品',
                icon: '👑',
                rewards: [
                    { type: 'gold', count: 3000 },
                    { type: 'stone', count: 5 },
                ],
                desc: '获得 3000 金币和 5 颗强化石',
            },
            {
                id: 'boss_card_2',
                title: '稀有附魔',
                icon: '🔮',
                rewards: [
                    { type: 'scroll', grade: 'D', count: 1 },
                    { type: 'dust', count: 500 },
                ],
                desc: '获得 D 级附魔卷轴和 500 魔法晶尘',
            },
            {
                id: 'boss_card_3',
                title: '传说装备',
                icon: '⚔️',
                rewards: [
                    { type: 'weapon', rarity: 'epic', count: 1 },
                    { type: 'gold', count: 2000 },
                ],
                desc: '获得史诗武器和 2000 金币',
            },
        ],
    },

    // Buff 配置
    buffs: {
        // 女神祝福
        goddessBlessing: {
            name: '女神祝福',
            icon: '✨',
            color: '#e8c878',
            // 属性加成
            atkBonusPercent: 15,      // +15% 物攻
            matkBonusPercent: 15,     // +15% 魔攻
            duration: -1,             // 按战斗次数计算，非时间
            maxBattles: 3,            // 持续 3 场战斗
        },
        // 恶魔祈祷
        demonPrayer: {
            name: '恶魔祈祷',
            icon: '🔥',
            color: '#9a3a3a',
            // 属性加成
            atkBonusPercent: 33,      // +33% 物攻
            matkBonusPercent: 33,     // +33% 魔攻
            // 代价
            hpCostPercent: 50,        // 扣 50% 当前 HP
            mpCostPercent: 50,        // 扣 50% 当前 MP
            duration: -1,             // 永久（直到地牢结束）
        },
    },
};

// ==================== 大块头 Boss 类 ====================

export class BigBoss extends Enemy {
    constructor(x, y, config = {}) {
        const mergedConfig = { ...BOSS_REWARD_CONFIG.boss, ...config };
        super(x, y, mergedConfig);

        // 覆盖火柴人绘制，使用自定义大型渲染
        this._useStickFigure = true;
        this._showWeapon = false;

        // 技能状态
        this._skills = {
            fanSlash: { lastUsed: -Infinity, isWindingUp: false, windupTimer: 0 },
            charge: { lastUsed: -Infinity, isWindingUp: false, windupTimer: 0, isCharging: false, chargeDir: null, chargeSpeed: 0 },
            summon: { lastUsed: -Infinity, hasSummoned: false },
        };

        // 动画状态
        this._animState = 'idle'; // idle, windup_fan, windup_charge, fan_slash, charge_dash, summon
        this._animTimer = 0;
        this._animFrame = 0;

        // 视觉效果
        this._glowIntensity = 0;
        this._glowDirection = 1;

        // 召唤的小僵尸追踪
        this._summonedMinions = [];

        console.log(`[BigBoss] 生成: ${this.name} HP=${this.hp}/${this.maxHp} 位置=(${x.toFixed(0)}, ${y.toFixed(0)})`);
    }

    update(dt, entities) {
        // 技能蓄力中：锁定移动
        if (this._skills.fanSlash.isWindingUp) {
            this._updateFanSlashWindup(dt, entities);
            return;
        }
        if (this._skills.charge.isWindingUp) {
            this._updateChargeWindup(dt, entities);
            return;
        }
        if (this._skills.charge.isCharging) {
            this._updateChargeDash(dt, entities);
            return;
        }

        // 召唤动画中
        if (this._animState === 'summon') {
            this._animTimer += dt;
            if (this._animTimer >= 2000) {
                this._animState = 'idle';
                this._animTimer = 0;
            }
            return;
        }

        // 正常 AI 更新
        super.update(dt, entities);

        // 更新技能 CD 和触发条件
        this._updateSkills(dt, entities);

        // 更新视觉发光效果
        this._updateGlow(dt);
    }

    // --- 技能系统 ---

    _updateSkills(dt, entities) {
        const now = Date.now();
        const player = this._findPlayer(entities);
        if (!player) return;

        const dist = Math.sqrt((player.x - this.x) ** 2 + (player.y - this.y) ** 2);
        const hpPercent = this.hp / this.maxHp;

        // 1. 蓄力冲锋（优先在远距离使用）
        const chargeConfig = BOSS_REWARD_CONFIG.boss.skills.charge;
        if (now - this._skills.charge.lastUsed >= chargeConfig.cooldown &&
            dist >= chargeConfig.minDistance &&
            !this._skills.charge.isWindingUp && !this._skills.charge.isCharging) {
            this._startChargeWindup(player);
            return;
        }

        // 2. 蓄力扇形斩（近距离）
        const fanConfig = BOSS_REWARD_CONFIG.boss.skills.fanSlash;
        if (now - this._skills.fanSlash.lastUsed >= fanConfig.cooldown &&
            dist <= fanConfig.range + 50 &&
            !this._skills.fanSlash.isWindingUp && !this._skills.charge.isCharging) {
            this._startFanSlashWindup(player);
            return;
        }

        // 3. 召唤小僵尸（50% HP 以下，只召唤一次）
        const summonConfig = BOSS_REWARD_CONFIG.boss.skills.summon;
        if (hpPercent <= summonConfig.summonHpPercent &&
            !this._skills.summon.hasSummoned &&
            now - this._skills.summon.lastUsed >= summonConfig.cooldown) {
            this._startSummon(entities);
            return;
        }
    }

    _findPlayer(entities) {
        const arr = entities.values ? Array.from(entities.values()) : entities;
        for (const e of arr) {
            if (e && e._faction === 'player' && e.active) return e;
        }
        return null;
    }

    // --- 蓄力扇形斩 ---

    _startFanSlashWindup(player) {
        this._skills.fanSlash.isWindingUp = true;
        this._skills.fanSlash.windupTimer = BOSS_REWARD_CONFIG.boss.skills.fanSlash.windupTime;
        this._animState = 'windup_fan';
        this._animTimer = 0;
        this.vx = 0;
        this.vy = 0;

        // 面向玩家
        this.rotation = Math.atan2(player.y - this.y, player.x - this.x);

        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 40, '⚔️ 蓄力扇形斩！', '#ff4444'));
        console.log(`[BigBoss] 开始蓄力扇形斩`);
    }

    _updateFanSlashWindup(dt, entities) {
        this._skills.fanSlash.windupTimer -= dt;
        this._animTimer += dt;

        // 蓄力期间：红色警告圈扩大
        if (this._skills.fanSlash.windupTimer <= 0) {
            this._executeFanSlash(entities);
        }
    }

    _executeFanSlash(entities) {
        const config = BOSS_REWARD_CONFIG.boss.skills.fanSlash;
        const player = this._findPlayer(entities);

        this._skills.fanSlash.isWindingUp = false;
        this._skills.fanSlash.lastUsed = Date.now();
        this._animState = 'fan_slash';
        this._animTimer = 0;

        // 扇形范围检测
        const angleRad = config.angle * Math.PI / 180;
        const halfAngle = angleRad / 2;
        const facingAngle = this.rotation;

        const arr = entities.values ? Array.from(entities.values()) : entities;
        for (const e of arr) {
            if (!e || !e.active || e._faction !== 'player') continue;

            const dx = e.x - this.x;
            const dy = e.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > config.range) continue;

            const angleToTarget = Math.atan2(dy, dx);
            const angleDiff = Math.abs(this._normalizeAngle(angleToTarget - facingAngle));
            if (angleDiff <= halfAngle) {
                // 在扇形范围内：造成伤害
                const damage = this._calculateSkillDamage(config.damageMultiplier);
                if (e.takeDamage) {
                    e.takeDamage(damage, this, 'physical');
                }
                // 击退效果
                if (e.applyKnockback) {
                    e.applyKnockback(angleToTarget, 50);
                }
            }
        }

        // 屏幕震动
        if (typeof Camera !== 'undefined' && Camera.shake) {
            Camera.shake(8, 300);
        }

        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 40, '💥 扇形斩！', '#ff0000'));
        console.log(`[BigBoss] 扇形斩释放`);
    }

    // --- 蓄力冲锋 ---

    _startChargeWindup(player) {
        this._skills.charge.isWindingUp = true;
        this._skills.charge.windupTimer = BOSS_REWARD_CONFIG.boss.skills.charge.windupTime;
        this._animState = 'windup_charge';
        this._animTimer = 0;
        this.vx = 0;
        this.vy = 0;

        // 记录冲锋方向
        this._skills.charge.chargeDir = Math.atan2(player.y - this.y, player.x - this.x);
        this.rotation = this._skills.charge.chargeDir;

        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 40, '🐂 蓄力冲锋！', '#ff8800'));
        console.log(`[BigBoss] 开始蓄力冲锋`);
    }

    _updateChargeWindup(dt, entities) {
        this._skills.charge.windupTimer -= dt;
        this._animTimer += dt;

        if (this._skills.charge.windupTimer <= 0) {
            this._executeCharge();
        }
    }

    _executeCharge() {
        const config = BOSS_REWARD_CONFIG.boss.skills.charge;
        this._skills.charge.isWindingUp = false;
        this._skills.charge.isCharging = true;
        this._skills.charge.lastUsed = Date.now();
        this._skills.charge.chargeSpeed = config.speed;
        this._animState = 'charge_dash';
        this._animTimer = 0;

        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 40, '💨 冲锋！', '#ff6600'));
        console.log(`[BigBoss] 冲锋释放`);
    }

    _updateChargeDash(dt, entities) {
        const config = BOSS_REWARD_CONFIG.boss.skills.charge;
        const sc = dt / 1000;

        // 沿冲锋方向移动
        const moveX = Math.cos(this._skills.charge.chargeDir) * this._skills.charge.chargeSpeed * sc;
        const moveY = Math.sin(this._skills.charge.chargeDir) * this._skills.charge.chargeSpeed * sc;

        // 墙壁碰撞检测
        const newX = this.x + moveX;
        const newY = this.y + moveY;

        if (typeof WallSystem !== 'undefined' && WallSystem.resolve) {
            const resolved = WallSystem.resolve(this.x, this.y, newX, newY, this.collisionRadius || 80);
            // 如果撞墙，停止冲锋
            if (Math.abs(resolved.x - newX) > 5 || Math.abs(resolved.y - newY) > 5) {
                this._endCharge(entities, true);
                return;
            }
            this.x = resolved.x;
            this.y = resolved.y;
        } else {
            this.x = newX;
            this.y = newY;
        }

        // 碰撞检测：撞到玩家造成伤害
        const arr = entities.values ? Array.from(entities.values()) : entities;
        for (const e of arr) {
            if (!e || !e.active || e._faction !== 'player') continue;
            const dx = e.x - this.x;
            const dy = e.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const collisionDist = (this.collisionRadius || 80) + (e.collisionRadius || 15);
            if (dist < collisionDist) {
                const damage = this._calculateSkillDamage(config.damageMultiplier);
                if (e.takeDamage) {
                    e.takeDamage(damage, this, 'physical');
                }
                if (e.applyKnockback) {
                    e.applyKnockback(this._skills.charge.chargeDir, 100);
                }
                this._endCharge(entities, false);
                return;
            }
        }

        // 冲锋持续时间（最多 2 秒）
        this._animTimer += dt;
        if (this._animTimer >= 2000) {
            this._endCharge(entities, false);
        }
    }

    _endCharge(entities, hitWall) {
        this._skills.charge.isCharging = false;
        this._skills.charge.chargeSpeed = 0;
        this._animState = 'idle';
        this._animTimer = 0;

        if (hitWall) {
            // 撞墙：屏幕震动 + 眩晕自己短暂时间
            if (typeof Camera !== 'undefined' && Camera.shake) {
                Camera.shake(12, 400);
            }
            EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 40, '💢 撞墙！', '#888888'));
        }
    }

    // --- 召唤小僵尸 ---

    _startSummon(entities) {
        this._skills.summon.hasSummoned = true;
        this._skills.summon.lastUsed = Date.now();
        this._animState = 'summon';
        this._animTimer = 0;
        this.vx = 0;
        this.vy = 0;

        const config = BOSS_REWARD_CONFIG.boss.skills.summon;

        // 在 Boss 周围生成小僵尸
        for (let i = 0; i < config.count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 200 + Math.random() * 150;
            const sx = this.x + Math.cos(angle) * dist;
            const sy = this.y + Math.sin(angle) * dist;

            // 使用现有的僵尸配置
            import('./zombie-dungeon.js').then(mod => {
                const zombie = mod.createBasicZombie ? mod.createBasicZombie(sx, sy) : null;
                if (zombie && Game.entities) {
                    const key = `boss_minion_${Date.now()}_${i}`;
                    Game.entities.set(key, zombie);
                    this._summonedMinions.push({ key, entity: zombie });
                }
            }).catch(() => {
                // 如果 zombie-dungeon.js 不可用，使用基础 Enemy
                const zombie = new Enemy(sx, sy, {
                    name: '小僵尸',
                    hp: 60,
                    maxHp: 60,
                    size: 12,
                    speed: 31.25,
                    color: '#4a9a4a',
                    str: 10,
                    dex: 15,
                    con: 10,
                    attackRange: 60,
                    attack: { type: 'thrust', cooldown: 800, dynamicRange: 60, width: 18, damageMin: 3, damageMax: 7, knockback: 5 },
                    ai: { aggroRange: 9999, pacingRange: 80, loseTimeout: 3000 },
                });
                if (Game.entities) {
                    const key = `boss_minion_${Date.now()}_${i}`;
                    Game.entities.set(key, zombie);
                    this._summonedMinions.push({ key, entity: zombie });
                }
            });
        }

        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 40, '☠️ 召唤小僵尸！', '#44ff44'));
        console.log(`[BigBoss] 召唤 ${config.count} 只小僵尸`);
    }

    // --- 辅助方法 ---

    _calculateSkillDamage(multiplier) {
        const baseAtk = this.data ? this.data.atk : 50;
        return Math.floor(baseAtk * multiplier);
    }

    _normalizeAngle(angle) {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
    }

    _updateGlow(dt) {
        // Boss 呼吸发光效果
        this._glowIntensity += dt * 0.002 * this._glowDirection;
        if (this._glowIntensity >= 1) {
            this._glowIntensity = 1;
            this._glowDirection = -1;
        } else if (this._glowIntensity <= 0.3) {
            this._glowIntensity = 0.3;
            this._glowDirection = 1;
        }
    }

    // --- 自定义渲染 ---

    _drawBody(ctx) {
        // 大块头：巨型火柴人，带有红色威胁光环
        const hitWhite = this.hitFlash > 0;
        const headColor = hitWhite ? '#ffffff' : (this._headColor || '#7a5a4a');
        const bodyColor = hitWhite ? '#ffffff' : (this._color || '#5a3a2a');
        const lw = hitWhite ? 8 : 5;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = lw;

        const t = this.animTime;
        const walking = this.isMoving;
        const s = walking ? Math.sin(t * 6) : 0;
        const bob = walking ? Math.sin(t * 12) * 3 : Math.sin(t * 1.5) * 1;

        // 大型比例
        const scale = 2.5;
        ctx.save();
        ctx.scale(scale, scale);

        const head = { x: 0, y: -23 + bob };
        const neck = { x: 0, y: -17 + bob };
        const shoulder = { x: 0, y: -15 + bob };
        const hip = { x: 0, y: 2 + bob };

        // 威胁光环（蓄力时更亮）
        const isWindingUp = this._skills.fanSlash.isWindingUp || this._skills.charge.isWindingUp;
        const glowAlpha = isWindingUp ? 0.4 + this._glowIntensity * 0.3 : this._glowIntensity * 0.2;
        ctx.fillStyle = `rgba(255, 60, 60, ${glowAlpha})`;
        ctx.beginPath();
        ctx.arc(0, 0, 35, 0, Math.PI * 2);
        ctx.fill();

        // 头部
        ctx.fillStyle = headColor;
        ctx.beginPath(); ctx.arc(head.x, head.y, 8, 0, Math.PI * 2); ctx.fill();

        // 身体
        ctx.strokeStyle = bodyColor;
        ctx.beginPath(); ctx.moveTo(neck.x, neck.y); ctx.lineTo(hip.x, hip.y); ctx.stroke();

        // 手臂（更粗壮）
        const lElbow = { x: -8 + s * 4, y: -10 + bob };
        const lHand = { x: -12 + s * 6, y: -2 + bob };
        ctx.beginPath(); ctx.moveTo(shoulder.x, shoulder.y); ctx.lineTo(lElbow.x, lElbow.y); ctx.lineTo(lHand.x, lHand.y); ctx.stroke();

        const rElbow = { x: 9 - s * 4, y: -10 + bob };
        const rHand = { x: 14 - s * 6, y: -2 + bob };
        ctx.beginPath(); ctx.moveTo(shoulder.x, shoulder.y); ctx.lineTo(rElbow.x, rElbow.y); ctx.lineTo(rHand.x, rHand.y); ctx.stroke();

        // 腿部
        const lKnee = { x: -5 + s * 6, y: 12 + bob };
        const lFoot = { x: -7 + s * 8, y: 24 + bob };
        ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(lKnee.x, lKnee.y); ctx.lineTo(lFoot.x, lFoot.y); ctx.stroke();

        const rKnee = { x: 5 - s * 6, y: 12 + bob };
        const rFoot = { x: 7 - s * 8, y: 24 + bob };
        ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(rKnee.x, rKnee.y); ctx.lineTo(rFoot.x, rFoot.y); ctx.stroke();

        // 关节点
        ctx.fillStyle = bodyColor;
        [lHand, rHand, lFoot, rFoot].forEach(j => {
            ctx.beginPath(); ctx.arc(j.x, j.y, 2.5, 0, Math.PI * 2); ctx.fill();
        });

        // 蓄力指示器
        if (isWindingUp) {
            ctx.strokeStyle = 'rgba(255, 80, 80, 0.8)';
            ctx.lineWidth = 3;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(0, 0, 30 + Math.sin(t * 10) * 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    _drawShadow(ctx, x, y, size) {
        const r = this.collisionRadius || size;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.5 + 20, r * 1.2, r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    renderHealthBar(ctx) {
        // Boss 血条：更大，带阶段标记
        if (this.hp >= this.maxHp) return;
        const screenPos = Renderer.worldToScreen(this.x, this.y);
        const barWidth = 80;
        const barHeight = 8;
        const border = 2;
        const x = screenPos.x - barWidth / 2;
        const y = screenPos.y - this.size - 50;
        const hpPercent = this.hp / this.maxHp;

        // 背景
        ctx.fillStyle = '#1a0a0a';
        ctx.fillRect(x - border, y - border, barWidth + border * 2, barHeight + border * 2);
        // 底色
        ctx.fillStyle = '#3a1010';
        ctx.fillRect(x, y, barWidth, barHeight);
        // 当前血量
        ctx.fillStyle = hpPercent > 0.5 ? '#c04040' : hpPercent > 0.25 ? '#a03030' : '#ff2020';
        ctx.fillRect(x, y, barWidth * hpPercent, barHeight);

        // 召唤阶段标记线
        const summonThreshold = BOSS_REWARD_CONFIG.boss.skills.summon.summonHpPercent;
        const summonX = x + barWidth * summonThreshold;
        ctx.strokeStyle = '#44ff44';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(summonX, y - 2);
        ctx.lineTo(summonX, y + barHeight + 2);
        ctx.stroke();

        // HP 数值
        ctx.fillStyle = '#d4c5a9';
        ctx.font = 'bold 11px SimHei, "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.floor(this.hp)}/${this.maxHp}`, screenPos.x, y - 6);
    }

    _renderNameTag(ctx, x, y) {
        ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';
        ctx.font = 'bold 14px SimHei, "Microsoft YaHei", "黑体", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, x, y - 48);
        // 等级标记
        ctx.fillStyle = 'rgba(212, 197, 169, 0.7)';
        ctx.font = '11px SimHei, sans-serif';
        ctx.fillText(`Lv.${this.level} 首领`, x, y - 34);
    }

    onDeath(source) {
        super.onDeath(source);
        // 清理召唤的小僵尸
        for (const minion of this._summonedMinions) {
            if (minion.entity && minion.entity.active) {
                minion.entity.active = false;
            }
            if (Game.entities && Game.entities.has(minion.key)) {
                Game.entities.delete(minion.key);
            }
        }
        this._summonedMinions = [];
        console.log(`[BigBoss] ${this.name} 被击败！`);
    }
}

// ==================== Buff 系统 ====================

export class DungeonBuffSystem {
    constructor() {
        this.activeBuffs = new Map(); // playerId -> { type, remainingBattles, data }
    }

    /**
     * 应用女神祝福
     * @param {Object} player - 玩家实体
     * @returns {Object} 效果信息
     */
    applyGoddessBlessing(player) {
        if (!player || !player.data) return null;

        const config = BOSS_REWARD_CONFIG.buffs.goddessBlessing;
        const buffId = `goddess_${Date.now()}`;

        // 计算加成后的攻击力
        const originalAtk = player.data.atk || 0;
        const originalMatk = player.data.matk || 0;
        const atkBonus = Math.floor(originalAtk * config.atkBonusPercent / 100);
        const matkBonus = Math.floor(originalMatk * config.matkBonusPercent / 100);

        // 应用加成
        player.data.atk += atkBonus;
        player.data.matk += matkBonus;

        // 记录 buff
        const buff = {
            id: buffId,
            type: 'goddessBlessing',
            name: config.name,
            icon: config.icon,
            color: config.color,
            remainingBattles: config.maxBattles,
            maxBattles: config.maxBattles,
            atkBonus,
            matkBonus,
            playerId: player.id || 'player',
        };

        this.activeBuffs.set(buff.playerId, buff);

        // 添加到状态栏
        if (typeof StatusBar !== 'undefined') {
            StatusBar.addEffect('buff', -1, {
                icon: config.icon,
                name: `${config.name} (${config.maxBattles}场)`,
                color: config.color,
            });
        }

        EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `✨ 女神祝福！物攻+${config.atkBonusPercent}%`, config.color));
        console.log(`[DungeonBuffSystem] 女神祝福 applied: ATK+${atkBonus}, MATK+${matkBonus}, ${config.maxBattles}场战斗`);

        return buff;
    }

    /**
     * 应用恶魔祈祷
     * @param {Object} player - 玩家实体
     * @param {string} choice - 'attack' 或 'materials'
     * @returns {Object} 效果信息
     */
    applyDemonPrayer(player, choice = 'attack') {
        if (!player || !player.data) return null;

        const config = BOSS_REWARD_CONFIG.buffs.demonPrayer;
        const buffId = `demon_${Date.now()}`;

        // 扣除 HP 和 MP
        const hpCost = Math.floor(player.data.hp * config.hpCostPercent / 100);
        const mpCost = Math.floor((player.data.mp || 0) * config.mpCostPercent / 100);
        player.data.hp = Math.max(1, player.data.hp - hpCost);
        player.data.mp = Math.max(0, (player.data.mp || 0) - mpCost);

        // 计算加成
        const originalAtk = player.data.atk || 0;
        const originalMatk = player.data.matk || 0;
        const atkBonus = Math.floor(originalAtk * config.atkBonusPercent / 100);
        const matkBonus = Math.floor(originalMatk * config.matkBonusPercent / 100);

        // 应用加成
        player.data.atk += atkBonus;
        player.data.matk += matkBonus;

        // 记录 buff
        const buff = {
            id: buffId,
            type: 'demonPrayer',
            name: config.name,
            icon: config.icon,
            color: config.color,
            remainingBattles: Infinity, // 永久
            atkBonus,
            matkBonus,
            hpCost,
            mpCost,
            choice,
            playerId: player.id || 'player',
        };

        this.activeBuffs.set(buff.playerId, buff);

        // 添加到状态栏（永久效果，不显示倒计时）
        if (typeof StatusBar !== 'undefined') {
            StatusBar.addEffect('buff', 999999999, {
                icon: config.icon,
                name: config.name,
                color: config.color,
            });
        }

        EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `🔥 恶魔祈祷！物攻+${config.atkBonusPercent}% 但失去 ${config.hpCostPercent}% HP`, config.color));
        console.log(`[DungeonBuffSystem] 恶魔祈祷 applied: ATK+${atkBonus}, MATK+${matkBonus}, HP-${hpCost}, MP-${mpCost}`);

        return buff;
    }

    /**
     * 战斗结束后减少 buff 层数
     * @param {Object} player - 玩家实体
     */
    onBattleEnd(player) {
        if (!player) return;
        const playerId = player.id || 'player';
        const buff = this.activeBuffs.get(playerId);
        if (!buff) return;

        if (buff.type === 'goddessBlessing') {
            buff.remainingBattles--;
            // 更新状态栏显示
            if (typeof StatusBar !== 'undefined') {
                StatusBar.removeEffectByType('buff');
                if (buff.remainingBattles > 0) {
                    StatusBar.addEffect('buff', -1, {
                        icon: buff.icon,
                        name: `${buff.name} (${buff.remainingBattles}场)`,
                        color: buff.color,
                    });
                }
            }

            if (buff.remainingBattles <= 0) {
                this.removeBuff(player);
                EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '✨ 女神祝福消失', '#888888'));
            }
        }
        // 恶魔祈祷是永久的，不减少
    }

    /**
     * 移除玩家身上的所有地牢 buff
     * @param {Object} player - 玩家实体
     */
    removeBuff(player) {
        if (!player || !player.data) return;
        const playerId = player.id || 'player';
        const buff = this.activeBuffs.get(playerId);
        if (!buff) return;

        // 恢复原始属性
        if (buff.atkBonus) player.data.atk -= buff.atkBonus;
        if (buff.matkBonus) player.data.matk -= buff.matkBonus;

        this.activeBuffs.delete(playerId);

        // 从状态栏移除
        if (typeof StatusBar !== 'undefined') {
            StatusBar.removeEffectByType('buff');
        }

        console.log(`[DungeonBuffSystem] Buff removed: ${buff.name}`);
    }

    /**
     * 清理所有 buff（地牢结束时）
     */
    clearAllBuffs() {
        for (const [playerId, buff] of this.activeBuffs) {
            // 无法直接获取 player 对象，只清理记录
            this.activeBuffs.delete(playerId);
        }
        if (typeof StatusBar !== 'undefined') {
            StatusBar.removeEffectByType('buff');
        }
        console.log('[DungeonBuffSystem] All buffs cleared');
    }

    /**
     * 获取玩家当前 buff 信息
     * @param {Object} player - 玩家实体
     * @returns {Object|null}
     */
    getBuff(player) {
        if (!player) return null;
        return this.activeBuffs.get(player.id || 'player') || null;
    }
}

// ==================== Boss 战斗管理器 ====================

export class BossBattleManager {
    constructor() {
        this.active = false;
        this.boss = null;
        this.bossKey = null;
        this._backupWalls = [];
        this._backupCameraFollow = null;
        this._onCompleteCallback = null;
        this._combatCheckTimer = 0;
    }

    /**
     * 开始 Boss 战
     * @param {Object} player - 玩家实体
     * @param {Function} onComplete - 战斗完成回调
     */
    start(player, onComplete) {
        if (this.active) {
            console.warn('[BossBattleManager] Boss 战已在进行中');
            return;
        }

        this.active = true;
        this._onCompleteCallback = onComplete;
        this._combatCheckTimer = 0;

        // 保存原始墙壁和相机
        this._backupWalls = [...WallSystem.walls];
        this._backupCameraFollow = Camera.follow.bind(Camera);

        // 设置 4096 场地
        this._setupArena();

        // 放置玩家（四边随机）
        this._placePlayer(player);

        // 生成 Boss（对边位置）
        this._spawnBoss(player);

        // 恢复相机跟随
        Camera.follow = this._backupCameraFollow;
        if (player) Camera.follow(player);

        console.log('[BossBattleManager] Boss 战开始！场地=4096x4096');
    }

    _setupArena() {
        const cfg = BOSS_REWARD_CONFIG.arena;
        const size = cfg.size;
        const wt = cfg.wallThickness;

        // 设置世界尺寸
        CONFIG.WORLD_WIDTH = size;
        CONFIG.WORLD_HEIGHT = size;

        // 生成地形纹理
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // 深色石质地板
        ctx.fillStyle = '#1a1814';
        ctx.fillRect(0, 0, size, size);

        // 石砖纹理
        ctx.strokeStyle = 'rgba(50, 45, 40, 0.4)';
        ctx.lineWidth = 1;
        const brickSize = 80;
        for (let bx = 0; bx < size; bx += brickSize) {
            ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, size); ctx.stroke();
        }
        for (let by = 0; by < size; by += brickSize) {
            ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(size, by); ctx.stroke();
        }

        // 边缘高光
        ctx.strokeStyle = 'rgba(120, 80, 60, 0.6)';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, size - 4, size - 4);

        // Boss 区域标记（中央）
        ctx.strokeStyle = 'rgba(180, 60, 60, 0.3)';
        ctx.lineWidth = 2;
        ctx.setLineDash([20, 20]);
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, 600, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        Renderer.terrainTexture = canvas;

        // 设置墙壁系统
        WallSystem.init(size, size);
        WallSystem.walls = [
            { x: 0, y: 0, w: size, h: wt },           // 上
            { x: 0, y: size - wt, w: size, h: wt },   // 下
            { x: 0, y: 0, w: wt, h: size },           // 左
            { x: size - wt, y: 0, w: wt, h: size },   // 右
        ];

        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        // 标记路径缓存失效
        if (typeof pathFinder !== 'undefined') {
            pathFinder.invalidateCache();
        }
    }

    _placePlayer(player) {
        if (!player) return;
        const cfg = BOSS_REWARD_CONFIG.arena;
        const size = cfg.size;
        const offset = cfg.playerOffset;
        const margin = cfg.margin;

        // 随机选择四边之一
        const edge = Math.floor(Math.random() * 4);
        let px, py;

        switch (edge) {
            case 0: // 上边
                px = margin + Math.random() * (size - margin * 2);
                py = offset;
                break;
            case 1: // 右边
                px = size - offset;
                py = margin + Math.random() * (size - margin * 2);
                break;
            case 2: // 下边
                px = margin + Math.random() * (size - margin * 2);
                py = size - offset;
                break;
            case 3: // 左边
                px = offset;
                py = margin + Math.random() * (size - margin * 2);
                break;
        }

        player.x = px;
        player.y = py;

        // 确保玩家在 entities 中
        if (Game.entities && !Game.entities.has('player')) {
            Game.entities.set('player', player);
        }
    }

    _spawnBoss(player) {
        if (!player) return;
        const cfg = BOSS_REWARD_CONFIG.arena;
        const size = cfg.size;

        // Boss 在场地中央区域
        const bx = size / 2 + (Math.random() - 0.5) * 400;
        const by = size / 2 + (Math.random() - 0.5) * 400;

        this.boss = new BigBoss(bx, by);
        this.bossKey = `dungeon_boss_${Date.now()}`;

        if (Game.entities) {
            Game.entities.set(this.bossKey, this.boss);
        }

        EffectManager.add(new FloatingTextEffect(bx, by - 100, '☠️ 大块头 出现！', '#ff0000'));
    }

    update(dt) {
        if (!this.active) return;

        // 检查 Boss 是否死亡
        this._combatCheckTimer += dt;
        if (this._combatCheckTimer >= 500) {
            this._combatCheckTimer = 0;
            this._checkBossDefeated();
        }
    }

    _checkBossDefeated() {
        if (!this.boss || this.boss.hp <= 0 || !this.boss.active) {
            this._onBossDefeated();
        }
    }

    _onBossDefeated() {
        console.log('[BossBattleManager] Boss 被击败！');

        // 发放基础奖励
        const gold = BOSS_REWARD_CONFIG.reward.baseGold + Math.floor(Math.random() * BOSS_REWARD_CONFIG.reward.goldVariance);
        if (typeof GoldManager !== 'undefined') {
            GoldManager.addGold(gold);
        }

        const player = Game.player;
        if (player) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `🎉 击败 Boss！获得 ${gold} 金币`, '#ffd700'));
        }

        // 清理
        this.cleanup();

        // 回调
        if (this._onCompleteCallback) {
            this._onCompleteCallback();
        }
    }

    cleanup() {
        if (!this.active) return;

        // 删除 Boss 实体
        if (this.bossKey && Game.entities) {
            Game.entities.delete(this.bossKey);
        }
        this.boss = null;
        this.bossKey = null;

        // 恢复墙壁
        WallSystem.walls = [...this._backupWalls];
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        if (typeof pathFinder !== 'undefined') {
            pathFinder.invalidateCache();
        }

        this.active = false;
        this._onCompleteCallback = null;

        console.log('[BossBattleManager] 清理完成');
    }

    isActive() {
        return this.active;
    }
}

// ==================== 奖励节点管理器 ====================

export class RewardNodeManager {
    constructor() {
        this._isShowingReward = false;
    }

    /**
     * 进入奖励节点
     * @param {Object} player - 玩家实体
     * @param {Function} onComplete - 奖励选择完成回调
     */
    enterRewardNode(player, onComplete) {
        if (this._isShowingReward) return;

        this._isShowingReward = true;

        // 使用现有的 RewardSystem，但替换为 Boss 奖励卡牌
        this._setupBossRewardCards();

        // 打开奖励面板
        if (typeof RewardSystem !== 'undefined') {
            RewardSystem.open();
        }

        // 监听面板关闭
        this._waitForRewardClose(onComplete);

        console.log('[RewardNodeManager] 奖励节点打开');
    }

    _setupBossRewardCards() {
        // 保存原始卡牌
        this._originalCards = RewardSystem.CARDS ? [...RewardSystem.CARDS] : null;

        // 复用剧情模式 RewardSystem 的原始卡牌（不追加额外卡牌）
        // 用户要求：复用剧情模式下雪地场景完成后奖励界面
        // 因此不修改 CARDS，直接使用 RewardSystem 原有的三张卡牌
    }

    _waitForRewardClose(onComplete) {
        const checkInterval = setInterval(() => {
            if (!RewardSystem._isOpen) {
                clearInterval(checkInterval);
                this._isShowingReward = false;

                // 恢复原始卡牌
                if (this._originalCards && RewardSystem.CARDS) {
                    RewardSystem.CARDS = this._originalCards;
                    this._originalCards = null;
                }

                if (onComplete) onComplete();
            }
        }, 300);
    }

    /**
     * 直接发放奖励（不显示选择界面）
     * @param {Object} player - 玩家实体
     * @param {Object} rewards - 奖励配置
     */
    giveReward(player, rewards) {
        if (!rewards) return;

        for (const reward of rewards) {
            switch (reward.type) {
                case 'gold':
                    if (typeof GoldManager !== 'undefined') {
                        GoldManager.addGold(reward.count);
                    }
                    break;
                case 'stone':
                    // 强化石
                    if (typeof EnhancementItems !== 'undefined' && EnhancementItems.enhance_stone) {
                        const stone = { ...EnhancementItems.enhance_stone, stack: reward.count };
                        this._addToBackpackOrDrop(stone);
                    }
                    break;
                case 'dust':
                    // 魔法晶尘
                    if (typeof MagicDustItem !== 'undefined') {
                        const dust = { ...MagicDustItem, stack: reward.count };
                        this._addToBackpackOrDrop(dust);
                    }
                    break;
                case 'scroll':
                    // 附魔卷轴
                    if (typeof EnchantConfig !== 'undefined') {
                        const scrolls = EnchantConfig.getAllScrolls().filter(s => s.grade === reward.grade);
                        if (scrolls.length > 0) {
                            const scroll = scrolls[Math.floor(Math.random() * scrolls.length)];
                            const item = EnchantScrollItems ? EnchantScrollItems[`enchant_scroll_${scroll.id}`] : null;
                            if (item) this._addToBackpackOrDrop({ ...item, stack: reward.count });
                        }
                    }
                    break;
                case 'weapon':
                    // 随机武器
                    this._giveRandomWeapon(reward.rarity);
                    break;
            }
        }
    }

    _addToBackpackOrDrop(item) {
        if (!item) return;
        if (typeof EquipManager !== 'undefined' && EquipManager.backpackItems &&
            EquipManager.backpackItems.length < EquipManager.maxBackpackSlots) {
            EquipManager.addToBackpack(item);
        } else if (Game.player && Game.dropItem) {
            Game.dropItem(Game.player.x, Game.player.y, item);
        }
    }

    _giveRandomWeapon(rarity) {
        if (typeof ItemDatabase === 'undefined' || !ItemDatabase.items) return;
        const weapons = Object.values(ItemDatabase.items).filter(item =>
            item.rarity === rarity && (item.type === 'weapon' || item.category === 'weapon')
        );
        if (weapons.length === 0) return;
        const weapon = weapons[Math.floor(Math.random() * weapons.length)];
        const instance = ItemDatabase.createInstance ? ItemDatabase.createInstance(weapon.id || weapon._id) : { ...weapon };
        this._addToBackpackOrDrop(instance);
    }
}

// ==================== 主入口：BossRewardSystem ====================

export const BossRewardSystem = {
    // 子系统实例
    bossBattle: new BossBattleManager(),
    rewardNode: new RewardNodeManager(),
    buffSystem: new DungeonBuffSystem(),

    // 配置
    config: BOSS_REWARD_CONFIG,

    /**
     * 进入 Boss 战
     * 由 DungeonMapSystem._enterBoss() 调用
     */
    enterBossBattle(player, onComplete) {
        this.bossBattle.start(player, onComplete);
    },

    /**
     * 进入奖励节点
     * 由 DungeonMapSystem._enterNode() reward 类型调用
     */
    enterRewardNode(player, onComplete) {
        this.rewardNode.enterRewardNode(player, onComplete);
    },

    /**
     * 更新（每帧调用）
     */
    update(dt) {
        this.bossBattle.update(dt);
    },

    /**
     * 检查 Boss 战是否进行中
     */
    isBossBattleActive() {
        return this.bossBattle.isActive();
    },

    /**
     * 应用女神祝福
     */
    applyGoddessBlessing(player) {
        return this.buffSystem.applyGoddessBlessing(player);
    },

    /**
     * 应用恶魔祈祷
     */
    applyDemonPrayer(player, choice) {
        return this.buffSystem.applyDemonPrayer(player, choice);
    },

    /**
     * 战斗结束（减少 buff 层数）
     */
    onBattleEnd(player) {
        this.buffSystem.onBattleEnd(player);
    },

    /**
     * 清理所有资源（地牢结束时）
     */
    cleanup() {
        this.bossBattle.cleanup();
        this.buffSystem.clearAllBuffs();
        this._isShowingReward = false;
        console.log('[BossRewardSystem] 全部清理完成');
    },
};

// 全局挂载
if (typeof window !== 'undefined' && !window.BossRewardSystem) {
    window.BossRewardSystem = BossRewardSystem;
    window.BigBoss = BigBoss;
    window.BossBattleManager = BossBattleManager;
    window.RewardNodeManager = RewardNodeManager;
    window.DungeonBuffSystem = DungeonBuffSystem;
}

// 默认导出
export default {
    BossRewardSystem,
    BigBoss,
    BossBattleManager,
    RewardNodeManager,
    DungeonBuffSystem,
    BOSS_REWARD_CONFIG,
};
