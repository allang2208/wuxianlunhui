import { SkillLevelSystem } from '../combat/skill-level-system.js';
import { isSwordCategory } from '../config/gun-ammo.js';
export const SkillManager = {
    _currentDetailSkillId: null, // 追踪当前打开的技能详情ID
    addMeleeExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        // 检查当前武器是否为剑类（剑精通只对剑类武器生效）
        const currentWeapon = player.equipments[player.weaponMode];
        if (!currentWeapon || !isSwordCategory(currentWeapon.weaponType)) return;
        const sm = player.skills.swordMastery;
        if (!sm || sm.level >= sm.maxLevel) return;
        let gained = 0;
        // 每次击中敌人积累1点经验，击中多个敌人则获得多次经验
        gained += hitCount * 1;
        // 同时攻击到两个以上敌人时，额外获得3点经验
        if (hitCount >= 2) gained += 3;
        // 每次击杀目标增加10点经验
        gained += killCount * 10;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(sm, gained, player);
        SkillLevelSystem.refreshUI(sm.id);
    },
    addDashExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const da = player.skills.dashAttack;
        if (!da || da.level >= da.maxLevel) return;
        let gained = 0;
        gained += hitCount * 1;
        if (hitCount >= 2) gained += 3;
        gained += killCount * 15;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(da, gained, player);
        // 同步 dashAttackThrust 和 dashAttackFire 的等级和经验
        const dt = player.skills.dashAttackThrust;
        if (dt) {
            dt.level = da.level;
            dt.exp = da.exp;
            dt.maxExp = da.maxExp;
        }
        const df = player.skills.dashAttackFire;
        if (df) {
            df.level = da.level;
            df.exp = da.exp;
            df.maxExp = da.maxExp;
        }
        SkillLevelSystem.refreshUI(da.id, 'dashAttackThrust', 'dashAttackFire');
    },
    addDashThrustExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        // dashAttackThrust 共享 dashAttack 的等级和经验
        const da = player.skills.dashAttack;
        const dt = player.skills.dashAttackThrust;
        if (!da || !dt || da.level >= da.maxLevel) return;
        let gained = 0;
        gained += hitCount * 1;
        if (hitCount >= 2) gained += 3;
        gained += killCount * 15;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(da, gained, player);
        // 同步到 dashAttackThrust 和 dashAttackFire
        dt.level = da.level;
        dt.exp = da.exp;
        dt.maxExp = da.maxExp;
        const df = player.skills.dashAttackFire;
        if (df) {
            df.level = da.level;
            df.exp = da.exp;
            df.maxExp = da.maxExp;
        }
        SkillLevelSystem.refreshUI(da.id, dt.id, 'dashAttackFire');
    },
    addWhirlwindExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const ww = player.skills.whirlwind;
        if (!ww || ww.level >= ww.maxLevel) return;
        let gained = 0;
        gained += hitCount * 1;
        if (hitCount >= 2) gained += 3;
        gained += killCount * 15;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(ww, gained, player);
        SkillLevelSystem.refreshUI(ww.id);
    },
    addPushStrikeExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        const ps = player.skills.pushStrike;
        if (!ps || ps.level >= ps.maxLevel) return;
        let gained = 0;
        gained += hitCount * 1;
        if (hitCount >= 2) gained += 3;
        if (hitCount >= 5) gained += 10;
        gained += killCount * 15;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(ps, gained, player);
        SkillLevelSystem.refreshUI(ps.id);
    },
    onLevelUp(player, skill) {
        const effect = skill.getEffect(skill.level);
        let effectText = '';
        let onShowCallback = null;
        if (skill.id === 'swordMastery') {
            onShowCallback = () => {
                player.data.dex += 1;
                player.calculateCombatStats();
                this.updateMeleeCooldown(player);
            };
            effectText = `剑攻击+${effect.atkBonus}  冷却-${(effect.cooldownReduction * 100).toFixed(0)}%  敏捷+${effect.dexBonus}`;
        } else if (skill.id === 'dashAttack' || skill.id === 'dashAttackThrust' || skill.id === 'dashAttackFire') {
            effectText = `伤害倍率×${effect.damageMul.toFixed(2)}  冷却-${(effect.cooldownReduction * 100).toFixed(0)}%`;
        } else if (skill.id === 'whirlwind') {
            onShowCallback = () => {
                player.data.str += 1;
                player.calculateCombatStats();
            };
            effectText = `伤害倍率×${effect.damageMul.toFixed(2)}  力量+${effect.strBonus}  范围${effect.radius}px`;
        } else if (skill.id === 'pushStrike') {
            onShowCallback = () => {
                player.data.str += 1;
                player.calculateCombatStats();
            };
            const curDamage = Math.round(player.data.str * effect.damageMul);
            effectText = `伤害${curDamage}  范围${effect.radius}px  击退${effect.knockback}px  冷却${effect.cooldown.toFixed(1)}秒`;
        } else if (skill.id === 'criticalStrike') {
            onShowCallback = () => {
                player.data.luck += 1;
                player.calculateCombatStats();
            };
            effectText = `暴击伤害+${(effect.damageBonus * 100).toFixed(0)}%  幸运+${effect.luckBonus}`;
        } else if (skill.id === 'machineGunMastery') {
            onShowCallback = () => {
                player.data.str += 1;
                player.calculateCombatStats();
            };
            effectText = `机枪伤害+${effect.damageBonus}  伤害+${(effect.damagePercent * 100).toFixed(0)}%  力量+${effect.strBonus}  散布延迟+${effect.spreadDelayBonus}s`;
        } else if (skill.id === 'rifleMastery') {
            onShowCallback = () => {
                player.data.wis += 1;
                player.calculateCombatStats();
            };
            effectText = `步枪伤害+${effect.damageBonus}  伤害+${(effect.damagePercent * 100).toFixed(0)}%  精神+${effect.wisBonus}  暴击率+${effect.critRateBonus}%`;
        } else if (skill.id === 'pistolMastery') {
            onShowCallback = () => {
                player.data.dex += 1;
                player.calculateCombatStats();
            };
            effectText = `手枪伤害+${effect.damageBonus}  伤害+${(effect.damagePercent * 100).toFixed(0)}%  敏捷+${effect.dexBonus}  移速+${(effect.speedPercent * 100).toFixed(0)}%`;
        } else if (skill.id === 'shotgunMastery') {
            onShowCallback = () => {
                player.data.con += 1;
                player.calculateCombatStats();
            };
            effectText = `散弹枪伤害+${(effect.damagePercent * 100).toFixed(0)}%  体质+${effect.conBonus}  击退+${effect.knockbackBonus}px`;
        } else if (skill.id === 'bowMastery') {
            onShowCallback = () => {
                player.data.dex += 1;
                player.calculateCombatStats();
                this.updateBowCooldown(player);
            };
            effectText = `弓攻击+${effect.damageBonus}  伤害+${(effect.damagePercent * 100).toFixed(0)}%  冷却-${(effect.cooldownReduction * 100).toFixed(0)}%  敏捷+${effect.dexBonus}`;
        } else if (skill.id === 'droneSkill') {
            effectText = `持续时间+${effect.duration}s  伤害加成+${effect.damageBonusPercent}%  暴击率+${effect.critBonusPercent}%  移速${effect.moveSpeed}px/s  范围${effect.radius}px`;
        }
        // 使用特效队列顺序播放
        LevelUpEffectQueue.add({
            type: 'skillLevelUp',
            level: skill.level,
            icon: skill.icon || '✦',
            iconImage: skill.iconImage || null,
            title: `${skill.name} 升级！Lv.${skill.level}`,
            effectText: effectText,
            onShow: onShowCallback
        });
        // 刷新UI
        const detail2 = document.getElementById('skillDetail');
        const detailOpen2 = detail2 && detail2.style.display !== 'none' && detail2.style.display !== '';
        if (detailOpen2 || (SystemUI.isOpen && SystemUI.currentTab === 'skill')) {
            this.renderSkillGrid();
            if (this._currentDetailSkillId === skill.id) {
                this.renderSkillDetail(skill);
            }
        }
    },
    addCriticalStrikeExp(player, isCrit, isKill) {
        if (!player || !player.skills) return;
        const cs = player.skills.criticalStrike;
        if (!cs || cs.level >= cs.maxLevel) return;
        let gained = 0;
        if (isCrit) gained += 1;
        if (isCrit && isKill) gained += 10;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(cs, gained, player);
        SkillLevelSystem.refreshUI(cs.id);
    },
    addMachineGunMasteryExp(player, isKill, isCrit) {
        if (!player || !player.skills) return;
        const mg = player.skills.machineGunMastery;
        if (!mg || mg.level >= mg.maxLevel) return;
        let gained = 0;
        if (isKill) gained += 10;
        if (isCrit) gained += 5;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(mg, gained, player);
        SkillLevelSystem.refreshUI(mg.id);
    },
    addRifleMasteryExp(player, isKill, isCrit) {
        if (!player || !player.skills) return;
        const rm = player.skills.rifleMastery;
        if (!rm || rm.level >= rm.maxLevel) return;
        let gained = 0;
        if (isKill) gained += 10;
        if (isCrit) gained += 5;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(rm, gained, player);
        SkillLevelSystem.refreshUI(rm.id);
    },
    addPistolMasteryExp(player, isKill, isCrit) {
        if (!player || !player.skills) return;
        const pm = player.skills.pistolMastery;
        if (!pm || pm.level >= pm.maxLevel) return;
        let gained = 0;
        if (isKill) gained += 10;
        if (isCrit) gained += 5;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(pm, gained, player);
        SkillLevelSystem.refreshUI(pm.id);
    },
    addShotgunMasteryExp(player, isKill, isCrit) {
        if (!player || !player.skills) return;
        const sm = player.skills.shotgunMastery;
        if (!sm || sm.level >= sm.maxLevel) return;
        let gained = 0;
        if (isKill) gained += 10;
        if (isCrit) gained += 5;
        if (gained <= 0) return;
        SkillLevelSystem.addExp(sm, gained, player);
        SkillLevelSystem.refreshUI(sm.id);
    },
    addBowExp(player, isHit, isCrit, isKill) {
        if (!player || !player.skills) return;
        const bm = player.skills.bowMastery;
        if (!bm || bm.level >= bm.maxLevel) return;
        let gained = 0;
        if (isHit) gained += 1;
        if (isCrit) gained += 4; // 暴击总计 5
        if (isKill) gained += 9; // 击杀总计 10
        if (gained <= 0) return;
        SkillLevelSystem.addExp(bm, gained, player);
        SkillLevelSystem.refreshUI(bm.id);
    },
    addDroneExp(player, entity) {
        if (!player || !player.skills) return;
        const ds = player.skills.droneSkill;
        if (!ds || ds.level >= ds.maxLevel) return;
        // 只有击杀被无人机影响的敌人才能获得经验
        if (entity && entity._droneVulnerabilityStacks > 0) {
            SkillLevelSystem.addExp(ds, 10, player);
            SkillLevelSystem.refreshUI(ds.id);
        }
    },
    updateMeleeCooldown(player) {
        if (!player || !player.skills) return;
        const sm = player.skills.swordMastery;
        const effect = sm.getEffect(sm.level);
        const baseCooldown = 500;
        const reducedCooldown = baseCooldown * (1 - effect.cooldownReduction);
        player.attacks.melee.maxCooldown = Math.max(200, reducedCooldown);
        player.animTimingMul = 1 - effect.cooldownReduction;
    },
    updateBowCooldown(player) {
        if (!player || !player.skills) return;
        const bm = player.skills.bowMastery;
        if (!bm) return;
        const effect = bm.getEffect(bm.level);
        const baseCooldown = 600;
        const reducedCooldown = baseCooldown * (1 - effect.cooldownReduction);
        player.attacks.ranged.maxCooldown = Math.max(200, reducedCooldown);
    },
    renderSkillGrid() {
        const grid = document.getElementById('skillGrid');
        if (!grid) return;
        const player = Game.player;
        if (!player || !player.skills) { grid.innerHTML = '<p style="color:#8a7d6b;text-align:center;padding:40px;">技能系统加载中...</p>'; return; }
        grid.innerHTML = '';
        // 根据当前装备决定显示 dashAttack 还是 dashAttackThrust 或 dashAttackFire
        const currentWeapon = player.equipments[player.weaponMode];
        const hasFireSkill = (player._skillOverrides && player._skillOverrides.dashAttackFire) || (currentWeapon && currentWeapon.skillOverrides && currentWeapon.skillOverrides.dashAttackFire);
        const hasThrustSkill = (player._skillOverrides && player._skillOverrides.dashAttackThrust) || (currentWeapon && currentWeapon.skillOverrides && currentWeapon.skillOverrides.dashAttackThrust);
        let skillList;
        if (hasFireSkill && player.skills.dashAttackFire) {
            skillList = [player.skills.swordMastery, player.skills.dashAttackFire, player.skills.whirlwind, player.skills.pushStrike, player.skills.criticalStrike, player.skills.machineGunMastery, player.skills.rifleMastery, player.skills.pistolMastery, player.skills.shotgunMastery, player.skills.bowMastery, player.skills.droneSkill];
        } else if (hasThrustSkill && player.skills.dashAttackThrust) {
            skillList = [player.skills.swordMastery, player.skills.dashAttackThrust, player.skills.whirlwind, player.skills.pushStrike, player.skills.criticalStrike, player.skills.machineGunMastery, player.skills.rifleMastery, player.skills.pistolMastery, player.skills.shotgunMastery, player.skills.bowMastery, player.skills.droneSkill];
        } else {
            skillList = [player.skills.swordMastery, player.skills.dashAttack, player.skills.whirlwind, player.skills.pushStrike, player.skills.criticalStrike, player.skills.machineGunMastery, player.skills.rifleMastery, player.skills.pistolMastery, player.skills.shotgunMastery, player.skills.bowMastery, player.skills.droneSkill];
        }
        skillList.forEach(skill => {
            if (!skill) return;
            const card = document.createElement('div');
            card.className = 'skill-card';
            // dashAttackThrust 显示 dashAttack 的等级和经验
            let displaySkill = skill;
            if (skill.id === 'dashAttackThrust' && player.skills.dashAttack) {
                displaySkill = player.skills.dashAttack;
            }
            const expPercent = displaySkill.level >= displaySkill.maxLevel ? 100 : Math.min(100, (displaySkill.exp / displaySkill.maxExp) * 100);
            const isActive = skill.tags && skill.tags.some(t => t.type === 'active');
            card.draggable = isActive;
            card.dataset.skillId = skill.id;
            card.innerHTML = `
                <div class="skill-icon">${skill.iconImage ? `<img src="${skill.iconImage}" style="width:48px;height:48px;object-fit:contain;" onerror="this.style.display='none';this.parentElement.textContent='${skill.icon}';">` : skill.icon}</div>
                <div class="skill-name">${skill.name}</div>
                <div class="skill-level">Lv.${displaySkill.level} / ${displaySkill.maxLevel}</div>
                <div class="skill-exp-bar"><div class="skill-exp-fill" style="width:${expPercent}%"></div></div>
            `;
            card.onclick = () => this.renderSkillDetail(skill);
            if (isActive) {
                card.ondragstart = (e) => {
                    e.dataTransfer.setData('text/plain', skill.id);
                    card.classList.add('dragging');
                    // 只拖动图标作为 drag image
                    const icon = card.querySelector('.skill-icon');
                    if (icon) {
                        e.dataTransfer.setDragImage(icon, icon.offsetWidth / 2, icon.offsetHeight / 2);
                    }
                    setTimeout(() => SystemUI.close(), 50);
                };
                card.ondragend = () => {
                    card.classList.remove('dragging');
                };
            }
            grid.appendChild(card);
        });
    },
    renderSkillDetail(skill) {
        this._currentDetailSkillId = skill.id;
        const detail = document.getElementById('skillDetail');
        const body = document.getElementById('sdBody');
        if (!detail || !body) return;
        // dashAttackThrust 共享 dashAttack 的等级和效果
        let displaySkill = skill;
        if (skill.id === 'dashAttackThrust') {
            displaySkill = Game.player.skills.dashAttack || skill;
        }
        const effect = displaySkill.getEffect(displaySkill.level);
        const nextEffect = displaySkill.level < displaySkill.maxLevel ? displaySkill.getEffect(displaySkill.level + 1) : null;
        const expPercent = displaySkill.level >= displaySkill.maxLevel ? 100 : Math.min(100, (displaySkill.exp / displaySkill.maxExp) * 100);
        let html = '';
        // 特性词条
        if (skill.tags && skill.tags.length > 0) {
            html += `<div class="sd-tags">`;
            skill.tags.forEach(tag => {
                html += `<span class="sd-tag tag-${tag.type}">${tag.name}</span>`;
            });
            html += `</div>`;
        }
        // 技能效果区域
        html += `<div class="sd-section"><h4>技能效果</h4>`;
        html += `<div class="sd-stat-row"><span class="sd-stat-name">当前等级</span><span class="sd-stat-val">Lv.${displaySkill.level}</span></div>`;
        if (skill.id === 'swordMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">剑攻击加成</span><span class="sd-stat-val pos">+${effect.atkBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">敏捷加成</span><span class="sd-stat-val pos">+${effect.dexBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">剑类攻击间隔缩短</span><span class="sd-stat-val pos">${(effect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级攻击加成</span><span class="sd-stat-val pos">+${nextEffect.atkBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级敏捷加成</span><span class="sd-stat-val pos">+${nextEffect.dexBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级剑类攻击间隔缩短</span><span class="sd-stat-val pos">${(nextEffect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            }
        } else if (skill.id === 'dashAttack' || skill.id === 'dashAttackThrust' || skill.id === 'dashAttackFire') {
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            if (skill.id === 'dashAttackThrust') {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">第1/2击</span><span class="sd-stat-val pos">= 基础攻击力 × 0.80 + 技能等级 × 0.05</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">第3击</span><span class="sd-stat-val pos">= 基础攻击力 × 0.90 + 技能等级 × 0.10</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">基础攻击力</span><span class="sd-stat-val pos">= 武器基础攻击 + 属性加成 + 强化加成 + 精通加成</span></div>`;
            } else if (skill.id === 'dashAttackFire') {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= (物理攻击力 + 魔法攻击力) × ${effect.damageMul.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">物理攻击力</span><span class="sd-stat-val pos">= 武器基础攻击 + 属性加成 + 强化加成 + 精通加成</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">魔法攻击力</span><span class="sd-stat-val pos">= 人物面板魔法攻击</span></div>`;
            } else {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= 基础武器攻击力 × ${effect.damageMul.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">基础武器攻击力</span><span class="sd-stat-val pos">= 武器基础攻击 + 属性加成 + 强化加成 + 精通加成</span></div>`;
            }
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却缩减</span><span class="sd-stat-val pos">${(effect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            // 计算击退距离和触发时间
            const baseKnockback = 8; // 默认武器击退
            const knockbackDist = baseKnockback + 150 + displaySkill.level * 5;
            const triggerTime = 333 * (1 - (displaySkill.level - 1) * 0.03);
            const baseRange = 165; // 默认武器攻击范围
            const attackRange = baseRange + 25 + displaySkill.level * 5;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退距离</span><span class="sd-stat-val pos">${knockbackDist}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">攻击范围</span><span class="sd-stat-val pos">${attackRange}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">触发时间</span><span class="sd-stat-val pos">${triggerTime.toFixed(0)}ms</span></div>`;
            if (skill.id === 'dashAttackThrust') {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">判定类型</span><span class="sd-stat-val pos">矩形（持续）</span></div>`;
            } else if (skill.id === 'dashAttackFire') {
                html += `<div class="sd-stat-row"><span class="sd-stat-name">判定类型</span><span class="sd-stat-val pos">扇形（火焰路径）</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">特效</span><span class="sd-stat-val pos">武器路径火焰轨迹</span></div>`;
            }
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级伤害倍率</span><span class="sd-stat-val pos">×${nextEffect.damageMul.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却缩减</span><span class="sd-stat-val pos">${(nextEffect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
                const nextKnockback = baseKnockback + 150 + (displaySkill.level + 1) * 5;
                const nextTrigger = 333 * (1 - displaySkill.level * 0.03);
                const nextRange = baseRange + 25 + (displaySkill.level + 1) * 5;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级击退距离</span><span class="sd-stat-val pos">${nextKnockback}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级攻击范围</span><span class="sd-stat-val pos">${nextRange}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级触发时间</span><span class="sd-stat-val pos">${nextTrigger.toFixed(0)}ms</span></div>`;
                if (skill.id === 'dashAttackThrust') {
                    html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级判定类型</span><span class="sd-stat-val pos">矩形（持续）</span></div>`;
                } else if (skill.id === 'dashAttackFire') {
                    html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级判定类型</span><span class="sd-stat-val pos">扇形（火焰路径）</span></div>`;
                }
            }
        } else if (skill.id === 'whirlwind') {
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= 基础武器攻击力 × ${effect.damageMul.toFixed(2)}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">基础武器攻击力</span><span class="sd-stat-val pos">= 武器基础攻击 + 属性加成 + 强化加成 + 精通加成</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">判定范围</span><span class="sd-stat-val pos">${effect.radius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退距离</span><span class="sd-stat-val pos">${effect.knockback}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown.toFixed(1)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">体力消耗</span><span class="sd-stat-val pos">${effect.staminaCost}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">力量加成</span><span class="sd-stat-val pos">+${effect.strBonus}</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级伤害倍率</span><span class="sd-stat-val pos">×${nextEffect.damageMul.toFixed(2)}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级判定范围</span><span class="sd-stat-val pos">${nextEffect.radius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown.toFixed(1)}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级体力消耗</span><span class="sd-stat-val pos">${nextEffect.staminaCost}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级力量加成</span><span class="sd-stat-val pos">+${nextEffect.strBonus}</span></div>`;
            }
        } else if (skill.id === 'pushStrike') {
            const curDamage = Game.player ? Math.round(Game.player.data.str * effect.damageMul) : Math.round(10 * effect.damageMul);
            html += `<div class="sd-section"><h4>🧮 伤害公式</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害</span><span class="sd-stat-val pos">= 力量 × ${effect.damageMul.toFixed(2)}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前力量</span><span class="sd-stat-val pos">${Game.player ? Game.player.data.str : 10}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">当前伤害</span><span class="sd-stat-val pos">${curDamage}</span></div>`;
            html += `</div>`;
            html += `<div class="sd-section"><h4>技能效果</h4>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">判定范围</span><span class="sd-stat-val pos">${effect.radius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退距离</span><span class="sd-stat-val pos">${effect.knockback}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">冷却时间</span><span class="sd-stat-val pos">${effect.cooldown.toFixed(1)}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">体力消耗</span><span class="sd-stat-val pos">${effect.staminaCost}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">眩晕时间</span><span class="sd-stat-val pos">1.5秒</span></div>`;
            if (nextEffect) {
                const nextDamage = Game.player ? Math.round(Game.player.data.str * nextEffect.damageMul) : Math.round(10 * nextEffect.damageMul);
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级伤害</span><span class="sd-stat-val pos">${nextDamage}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级判定范围</span><span class="sd-stat-val pos">${nextEffect.radius}px</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级冷却时间</span><span class="sd-stat-val pos">${nextEffect.cooldown.toFixed(1)}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级体力消耗</span><span class="sd-stat-val pos">${nextEffect.staminaCost}</span></div>`;
            }
        } else if (skill.id === 'criticalStrike') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">暴击伤害加成</span><span class="sd-stat-val pos">+${(effect.damageBonus * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">幸运加成</span><span class="sd-stat-val pos">+${effect.luckBonus}</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级暴击伤害加成</span><span class="sd-stat-val pos">+${(nextEffect.damageBonus * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级幸运加成</span><span class="sd-stat-val pos">+${nextEffect.luckBonus}</span></div>`;
            }
        } else if (skill.id === 'machineGunMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">机枪伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">机枪伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">力量加成</span><span class="sd-stat-val pos">+${effect.strBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">散布延迟加成</span><span class="sd-stat-val pos">+${effect.spreadDelayBonus}s</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级机枪伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级机枪伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级力量加成</span><span class="sd-stat-val pos">+${nextEffect.strBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级散布延迟加成</span><span class="sd-stat-val pos">+${nextEffect.spreadDelayBonus}s</span></div>`;
            }
        } else if (skill.id === 'rifleMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">步枪伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">步枪伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">精神加成</span><span class="sd-stat-val pos">+${effect.wisBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">步枪暴击率加成</span><span class="sd-stat-val pos">+${effect.critRateBonus}%</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级步枪伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级步枪伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级精神加成</span><span class="sd-stat-val pos">+${nextEffect.wisBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级步枪暴击率加成</span><span class="sd-stat-val pos">+${nextEffect.critRateBonus}%</span></div>`;
            }
        } else if (skill.id === 'pistolMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">手枪伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">手枪伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">敏捷加成</span><span class="sd-stat-val pos">+${effect.dexBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">手枪移速加成</span><span class="sd-stat-val pos">+${(effect.speedPercent * 100).toFixed(0)}%</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级手枪伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级手枪伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级敏捷加成</span><span class="sd-stat-val pos">+${nextEffect.dexBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级手枪移速加成</span><span class="sd-stat-val pos">+${(nextEffect.speedPercent * 100).toFixed(0)}%</span></div>`;
            }
        } else if (skill.id === 'shotgunMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">散弹枪伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">体质加成</span><span class="sd-stat-val pos">+${effect.conBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">击退加成</span><span class="sd-stat-val pos">+${effect.knockbackBonus}px</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级散弹枪伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级体质加成</span><span class="sd-stat-val pos">+${nextEffect.conBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级击退加成</span><span class="sd-stat-val pos">+${nextEffect.knockbackBonus}px</span></div>`;
            }
        } else if (skill.id === 'bowMastery') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">弓伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">弓伤害百分比</span><span class="sd-stat-val pos">+${(effect.damagePercent * 100).toFixed(0)}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">敏捷加成</span><span class="sd-stat-val pos">+${effect.dexBonus}</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">弓类攻击间隔缩短</span><span class="sd-stat-val pos">${(effect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级弓伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级弓伤害百分比</span><span class="sd-stat-val pos">+${(nextEffect.damagePercent * 100).toFixed(0)}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级敏捷加成</span><span class="sd-stat-val pos">+${nextEffect.dexBonus}</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级弓类攻击间隔缩短</span><span class="sd-stat-val pos">${(nextEffect.cooldownReduction * 100).toFixed(0)}%</span></div>`;
            }
        } else if (skill.id === 'droneSkill') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">持续时间</span><span class="sd-stat-val pos">${effect.duration}秒</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害加成</span><span class="sd-stat-val pos">+${effect.damageBonusPercent}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">暴击率加成</span><span class="sd-stat-val pos">+${effect.critBonusPercent}%</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">移速</span><span class="sd-stat-val pos">${effect.moveSpeed}px/s</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">影响范围</span><span class="sd-stat-val pos">${effect.radius}px</span></div>`;
            html += `<div class="sd-stat-row"><span class="sd-stat-name">判定间隔</span><span class="sd-stat-val pos">0.25秒</span></div>`;
            if (nextEffect) {
                html += `<div class="sd-stat-row" style="margin-top:8px;border-top:1px solid rgba(100,160,255,0.2);padding-top:8px;"><span class="sd-stat-name">下一级持续时间</span><span class="sd-stat-val pos">${nextEffect.duration}秒</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级伤害加成</span><span class="sd-stat-val pos">+${nextEffect.damageBonusPercent}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级暴击率加成</span><span class="sd-stat-val pos">+${nextEffect.critBonusPercent}%</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级移速</span><span class="sd-stat-val pos">${nextEffect.moveSpeed}px/s</span></div>`;
                html += `<div class="sd-stat-row"><span class="sd-stat-name">下一级范围</span><span class="sd-stat-val pos">${nextEffect.radius}px</span></div>`;
            }
        }
        if (!nextEffect) {
            html += `<div class="sd-stat-row" style="margin-top:8px;color:#7a9a6a;">已达到最高等级</div>`;
        }
        html += `</div>`;
        // 升级进度
        html += `<div class="sd-section"><h4>升级进度</h4>`;
        html += `<div class="sd-exp-track"><div class="sd-exp-bar"><div class="sd-exp-fill" style="width:${expPercent}%"></div></div><span class="sd-exp-text">${displaySkill.exp}/${displaySkill.maxExp}</span></div>`;
        html += `<p style="margin-top:8px;color:#a0a0a0;font-size:12px;">${displaySkill.level >= displaySkill.maxLevel ? '已满级' : `还需 ${displaySkill.maxExp - displaySkill.exp} 点经验升级`}</p>`;
        html += `</div>`;
        // 升级方式
        html += `<div class="sd-section"><h4>升级方式</h4>`;
        if (skill.id === 'swordMastery') {
            html += `<p>• 每次击中敌人积累 1 点经验（多敌人=多倍）</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 10 点经验</p>`;
        } else if (skill.id === 'dashAttack') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：长按Shift冲刺超过0.75秒后，使用近战武器左键攻击</p>`;
        } else if (skill.id === 'dashAttackThrust') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：装备骑士长剑时，长按Shift冲刺超过0.75秒后，使用近战武器左键攻击</p>`;
        } else if (skill.id === 'dashAttackFire') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：装备夜与火之剑时，长按Shift冲刺超过0.75秒后，使用近战武器左键攻击</p>`;
        } else if (skill.id === 'whirlwind') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：按快捷键触发技能，需装备近战武器且消耗体力</p>`;
        } else if (skill.id === 'pushStrike') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 同时攻击到五个以上敌人时，额外获得 10 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：按快捷键触发技能，需装备远程武器（手枪/机枪/步枪/弓）且消耗体力</p>`;
        } else if (skill.id === 'criticalStrike') {
            html += `<p>• 造成暴击时积累 1 点经验</p>`;
            html += `<p>• 暴击击杀敌人时增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：绑定所有暴击效果，暴击时自动触发</p>`;
        } else if (skill.id === 'machineGunMastery') {
            html += `<p>• 使用机枪击杀敌人增加 10 点经验</p>`;
            html += `<p>• 使用机枪暴击增加 5 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备机枪时自动生效</p>`;
        } else if (skill.id === 'rifleMastery') {
            html += `<p>• 使用步枪击杀敌人增加 10 点经验</p>`;
            html += `<p>• 使用步枪暴击增加 5 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备步枪时自动生效</p>`;
        } else if (skill.id === 'pistolMastery') {
            html += `<p>• 使用手枪击杀敌人增加 10 点经验</p>`;
            html += `<p>• 使用手枪暴击增加 5 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备手枪时自动生效</p>`;
        } else if (skill.id === 'shotgunMastery') {
            html += `<p>• 使用散弹枪击杀敌人增加 10 点经验</p>`;
            html += `<p>• 使用散弹枪暴击增加 5 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备散弹枪时自动生效</p>`;
        } else if (skill.id === 'bowMastery') {
            html += `<p>• 每次用弓击中敌人积累 1 点经验</p>`;
            html += `<p>• 用弓暴击时增加 5 点经验</p>`;
            html += `<p>• 击杀目标时增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">被动技能：装备弓时自动生效</p>`;
        } else if (skill.id === 'droneSkill') {
            html += `<p>• 击杀被无人机影响的敌人增加 10 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">主动技能：按快捷键释放/操控/回收无人机</p>`;
        }
        html += `</div>`;
        body.innerHTML = html;
        detail.style.display = 'block';
        const backBtn = document.getElementById('sdBackBtn');
        if (backBtn) {
            backBtn.onclick = () => {
                detail.style.display = 'none';
                this._currentDetailSkillId = null;
                this.renderSkillGrid();
            };
        }
    }
};
