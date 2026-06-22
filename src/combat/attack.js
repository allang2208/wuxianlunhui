        class Attack {
            constructor(config) { this.config = config; this.cooldown = 0; this.maxCooldown = config.cooldown || 1000; this.range = config.range || 0; this.width = config.width || 0; this.projectileSpeed = config.projectileSpeed || 0; this.projectileRange = config.projectileRange || 0; this.active = true; }
            canUse() { return this.cooldown <= 0; }
            use(source, targetX, targetY, entities) { if (!this.canUse()) return false; const success = this.execute(source, targetX, targetY, entities); if (success) this.cooldown = this.maxCooldown; return success; }
            execute(source, targetX, targetY, entities) {}
            update(dt) { if (this.cooldown > 0) this.cooldown -= dt; }
            getCooldownPercent() { return Math.max(0, this.cooldown / this.maxCooldown); }
        }

        class SlashAttack extends Attack {
            constructor(config = {}) {
                super({ cooldown: config.cooldown || 500, range: config.range || 80, arc: config.arc || Math.PI / 2.5, damage: config.damage || { min: 10, max: 18 }, knockback: config.knockback || 25, ...config });
            }
            execute(source, targetX, targetY, entities) {
                if (source.data.stamina < CONFIG.STAMINA_MELEE_COST) return false;
                source.data.stamina -= CONFIG.STAMINA_MELEE_COST;
                const range = this.config.range, arc = this.config.arc;
                const attackAngle = Math.atan2(targetY - source.y, targetX - source.x);
                if (!isFinite(attackAngle)) {
                    console.warn('SlashAttack: invalid attack angle', { targetX, targetY, sx: source.x, sy: source.y });
                    return true;
                }
                EffectManager.add(new AttackRangeEffect(source.x, source.y, attackAngle, range, arc, 'sector'));
                let hitCount = 0, killCount = 0;
                entities.forEach(entity => {
                    if (entity === source || !entity.active || !entity.hittable) return;
                    if (MathUtils.pointInSector(entity.x, entity.y, source.x, source.y, attackAngle, range, arc)) {
                        const damage = Math.floor(MathUtils.randomRange(this.config.damage.min, this.config.damage.max));
                        const wasAlive = entity.hp > 0;
                        entity.takeDamage(damage, source);
                        if (wasAlive && entity.hp <= 0) killCount++;
                        hitCount++;
                        entity.applyKnockback(attackAngle, this.config.knockback);
                    }
                });
                // 剑精通经验（普通斩击命中）
                SkillManager.addMeleeExp(source, hitCount, killCount);
                return true;
            }
        }

        class ThrustAttack extends Attack {
            constructor(config = {}) {
                super({ cooldown: config.cooldown || 600, range: config.range || 125, width: config.width || 25, damage: config.damage || { min: 12, max: 20 }, knockback: config.knockback || 15, ...config });
            }
            execute(source, targetX, targetY, entities) {
                if (source.data.stamina < CONFIG.STAMINA_MELEE_COST) return false;
                source.data.stamina -= CONFIG.STAMINA_MELEE_COST;
                const attackAngle = Math.atan2(targetY - source.y, targetX - source.x);
                if (!isFinite(attackAngle)) {
                    console.warn('ThrustAttack: invalid attack angle', { targetX, targetY, sx: source.x, sy: source.y });
                    return true;
                }
                // 计算剑精通伤害加成
                let damageBonus = 0;
                if (source.skills && source.skills.swordMastery) {
                    const sm = source.skills.swordMastery;
                    const effect = sm.getEffect(sm.level);
                    damageBonus = effect.atkBonus;
                }
                // 白色攻击范围可视化：正方形，持续1秒
                if (Game.showAttackRange) {
                    EffectManager.add(new AttackRangeEffect(source.x, source.y, attackAngle, this.config.range, this.config.width, 'triangle', 1000));
                }
                // 存储攻击数据，供swing阶段进行正方形攻击判定
                source._pendingThrust = {
                    x: source.x,                   // 攻击起始位置（固定，不随移动变化）
                    y: source.y,
                    range: this.config.range,      // 165px
                    width: this.config.width,      // 35px
                    angle: attackAngle,
                    hitSet: new Set(),             // 已命中目标
                    damage: this.config.damage,
                    damageBonus: damageBonus,
                    knockback: this.config.knockback,
                    entities: entities,
                    active: true,
                    startTime: Date.now(),         // 判定开始时间
                    totalHitCount: 0,              // 整个攻击累计命中数
                    totalKillCount: 0,           // 整个攻击累计击杀数
                    expGiven: false                // 是否已发放经验
                };
                return true;
            }
            // 在swing阶段调用，进行三角形攻击判定
            checkTriangleHit(source) {
                const pt = source._pendingThrust;
                if (!pt || !pt.active) return;
                // 攻击判定持续时间：200ms
                if (Date.now() - pt.startTime > 200) { pt.active = false; return; }
                const range = pt.range, width = pt.width, angle = pt.angle;
                const halfW = width / 2;
                const cos = Math.cos(angle), sin = Math.sin(angle);
                const ax = pt.x, ay = pt.y; // 使用攻击起始时的固定位置
                let hitCount = 0, killCount = 0;
                pt.entities.forEach(entity => {
                    if (entity === source || !entity.active || !entity.hittable) return;
                    if (pt.hitSet.has(entity)) return; // 已命中过
                    // 墙壁视线检测：不能攻击墙后的目标
                    if (WallSystem.blocked(ax, ay, entity.x, entity.y)) return;
                    // 矩形命中判定：考虑目标碰撞半径，只要碰撞圆与矩形有重叠就命中
                    const entityRadius = entity.collisionRadius || entity.size * 0.6 || 10;
                    const dx = entity.x - ax, dy = entity.y - ay;
                    const forward = dx * cos + dy * sin;  // 沿攻击方向投影
                    const lateral = dx * (-sin) + dy * cos; // 垂直方向投影
                    if (forward >= -entityRadius && forward <= range + entityRadius && 
                        lateral >= -halfW - entityRadius && lateral <= halfW + entityRadius) {
                        pt.hitSet.add(entity);
                        hitCount++;
                        let baseDamage = Math.floor(MathUtils.randomRange(pt.damage.min, pt.damage.max));
                        // 使用统一方法计算当前武器攻击力
                        baseDamage = source.getCurrentWeaponAtk();
                        const damage = baseDamage + pt.damageBonus;
                        const wasAlive = entity.hp > 0;
                        entity.takeDamage(damage, source);
                        if (wasAlive && entity.hp <= 0) killCount++;
                        entity.applyKnockback(angle, pt.knockback);
                        // 击中特效：在目标位置播放，随机使用1.png或2.png，800ms淡出
                        EffectManager.add(new HitEffect(entity.x, entity.y));
                    }
                });
                // 累计命中/击杀数（不直接给经验，经验在swing结束时统一发放）
                pt.totalHitCount += hitCount;
                pt.totalKillCount += killCount;
            }
            // 在swing阶段结束时调用，统一发放经验（只计算一次）
            giveExp(source) {
                const pt = source._pendingThrust;
                if (!pt || pt.expGiven) return;
                pt.expGiven = true;
                if (source.skills && source.skills.swordMastery) {
                    SkillManager.addMeleeExp(source, pt.totalHitCount, pt.totalKillCount);
                }
            }
        }

        class RangedAttack extends Attack {
            constructor(config = {}) {
                super({ cooldown: config.cooldown || 800, projectileSpeed: config.projectileSpeed || 10, projectileRange: config.projectileRange || 500, projectileSize: config.projectileSize || 5, damage: config.damage || { min: 6, max: 14 }, piercing: config.piercing || false, ...config });
            }
            execute(source, targetX, targetY, entities) {
                if (source.data.stamina < CONFIG.STAMINA_RANGED_COST) return false;
                source.data.stamina -= CONFIG.STAMINA_RANGED_COST;
                const wType = source.equippedRangedType;
                // SoundManager.play(wType === 'pistol' ? 'gun_fire' : 'bow_fire');
                const angle = Math.atan2(targetY - source.y, targetX - source.x);
                { let p = EffectManager._acquire('Projectile');
                        if (p) { p.x = source.x; p.y = source.y; p.angle = angle; p.speed = this.config.projectileSpeed; p.maxRange = this.config.projectileRange; p.size = this.config.projectileSize; p.damage = this.config.damage; p.piercing = this.config.piercing; p.source = source; p.entities = entities; p.image = source.arrowImage; p.traveled = 0; p.active = true; p.hitTargets = new Set(); }
                        else p = new Projectile(source.x, source.y, angle, this.config.projectileSpeed, this.config.projectileRange, this.config.projectileSize, this.config.damage, this.config.piercing, source, entities, source.arrowImage);
                        EffectManager.add(p); }
                return true;
            }
        }

export { Attack, SlashAttack, ThrustAttack, RangedAttack };
