export const SkillManager = {
    _currentDetailSkillId: null, // 追踪当前打开的技能详情ID
    addMeleeExp(player, hitCount, killCount) {
        if (!player || !player.skills) return;
        // 检查当前武器是否为剑类（剑精通只对剑类武器生效）
        const currentWeapon = player.equipments[player.weaponMode];
        if (!currentWeapon || currentWeapon.weaponType !== 'sword') return;
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
        sm.exp += gained;
        // 检查升级
        while (sm.exp >= sm.maxExp && sm.level < sm.maxLevel) {
            sm.exp -= sm.maxExp;
            sm.level++;
            sm.maxExp = sm.getExpForNext(sm.level);
            this.onLevelUp(player, sm);
        }
        // 确保经验不超过最大值（满级时）
        if (sm.level >= sm.maxLevel) sm.exp = 0;
        // 如果技能面板或详情面板正在打开，同步刷新UI
        const detail = document.getElementById('skillDetail');
        const detailOpen = detail && detail.style.display !== 'none' && detail.style.display !== '';
        if (detailOpen || (SystemUI.isOpen && SystemUI.currentTab === 'skill')) {
            this.renderSkillGrid();
            if (this._currentDetailSkillId === sm.id) {
                this.renderSkillDetail(sm);
            }
        }
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
        da.exp += gained;
        while (da.exp >= da.maxExp && da.level < da.maxLevel) {
            da.exp -= da.maxExp;
            da.level++;
            da.maxExp = da.getExpForNext(da.level);
            this.onLevelUp(player, da);
        }
        if (da.level >= da.maxLevel) da.exp = 0;
        // 同步 dashAttackThrust 的等级和经验
        const dt = player.skills.dashAttackThrust;
        if (dt) {
            dt.level = da.level;
            dt.exp = da.exp;
            dt.maxExp = da.maxExp;
        }
        const detail = document.getElementById('skillDetail');
        const detailOpen = detail && detail.style.display !== 'none' && detail.style.display !== '';
        if (detailOpen || (SystemUI.isOpen && SystemUI.currentTab === 'skill')) {
            this.renderSkillGrid();
            if (this._currentDetailSkillId === da.id || this._currentDetailSkillId === 'dashAttackThrust') {
                this.renderSkillDetail(da);
            }
        }
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
        da.exp += gained;
        while (da.exp >= da.maxExp && da.level < da.maxLevel) {
            da.exp -= da.maxExp;
            da.level++;
            da.maxExp = da.getExpForNext(da.level);
            this.onLevelUp(player, da);
        }
        if (da.level >= da.maxLevel) da.exp = 0;
        // 同步到 dashAttackThrust
        dt.level = da.level;
        dt.exp = da.exp;
        dt.maxExp = da.maxExp;
        const detail = document.getElementById('skillDetail');
        const detailOpen = detail && detail.style.display !== 'none' && detail.style.display !== '';
        if (detailOpen || (SystemUI.isOpen && SystemUI.currentTab === 'skill')) {
            this.renderSkillGrid();
            if (this._currentDetailSkillId === da.id || this._currentDetailSkillId === dt.id) {
                this.renderSkillDetail(da);
            }
        }
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
        ww.exp += gained;
        while (ww.exp >= ww.maxExp && ww.level < ww.maxLevel) {
            ww.exp -= ww.maxExp;
            ww.level++;
            ww.maxExp = ww.getExpForNext(ww.level);
            this.onLevelUp(player, ww);
        }
        if (ww.level >= ww.maxLevel) ww.exp = 0;
        const detail = document.getElementById('skillDetail');
        const detailOpen = detail && detail.style.display !== 'none' && detail.style.display !== '';
        if (detailOpen || (SystemUI.isOpen && SystemUI.currentTab === 'skill')) {
            this.renderSkillGrid();
            if (this._currentDetailSkillId === ww.id) {
                this.renderSkillDetail(ww);
            }
        }
    },
    onLevelUp(player, skill) {
        // 屏幕闪光
        const flash = document.createElement('div');
        flash.className = 'screen-flash';
        document.body.appendChild(flash);
        setTimeout(() => { if (flash && flash.parentNode) flash.remove(); }, 500);
        // 升级提示文字
        const effect = skill.getEffect(skill.level);
        let effectText = '';
        if (skill.id === 'swordMastery') {
            player.data.dex += 1;
            player.calculateCombatStats();
            effectText = `剑攻击+${effect.atkBonus}  冷却-${(effect.cooldownReduction * 100).toFixed(0)}%  敏捷+${effect.dexBonus}`;
            this.updateMeleeCooldown(player);
        } else if (skill.id === 'dashAttack') {
            effectText = `伤害倍率×${effect.damageMul.toFixed(2)}  冷却-${(effect.cooldownReduction * 100).toFixed(0)}%`;
        } else if (skill.id === 'dashAttackThrust') {
            effectText = `伤害倍率×${effect.damageMul.toFixed(2)}  冷却-${(effect.cooldownReduction * 100).toFixed(0)}%`;
        } else if (skill.id === 'whirlwind') {
            player.data.str += 1;
            player.calculateCombatStats();
            effectText = `伤害倍率×${effect.damageMul.toFixed(2)}  力量+${effect.strBonus}  范围${effect.radius}px`;
        }
        const text = document.createElement('div');
        text.className = 'level-up-text';
        text.innerHTML = `
            <span class="lu-icon">${skill.icon}</span>
            <span class="lu-title">${skill.name} 升级！Lv.${skill.level}</span>
            <span class="lu-effect">${effectText}</span>
        `;
        document.body.appendChild(text);
        setTimeout(() => { if (text && text.parentNode) text.remove(); }, 2500);
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
    updateMeleeCooldown(player) {
        if (!player || !player.skills) return;
        const sm = player.skills.swordMastery;
        const effect = sm.getEffect(sm.level);
        const baseCooldown = 500;
        const reducedCooldown = baseCooldown * (1 - effect.cooldownReduction);
        player.attacks.melee.maxCooldown = Math.max(200, reducedCooldown);
        player.animTimingMul = 1 - effect.cooldownReduction;
    },
    renderSkillGrid() {
        const grid = document.getElementById('skillGrid');
        if (!grid) return;
        const player = Game.player;
        if (!player || !player.skills) { grid.innerHTML = '<p style="color:#8a7d6b;text-align:center;padding:40px;">技能系统加载中...</p>'; return; }
        grid.innerHTML = '';
        // 根据当前装备决定显示 dashAttack 还是 dashAttackThrust
        const currentWeapon = player.equipments[player.weaponMode];
        const hasThrustSkill = currentWeapon && currentWeapon.skillOverrides && currentWeapon.skillOverrides.dashAttackThrust;
        let skillList;
        if (hasThrustSkill && player.skills.dashAttackThrust) {
            skillList = [player.skills.swordMastery, player.skills.dashAttackThrust, player.skills.whirlwind];
        } else {
            skillList = [player.skills.swordMastery, player.skills.dashAttack, player.skills.whirlwind];
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
                <div class="skill-icon">${skill.icon}</div>
                <div class="skill-name">${skill.name}</div>
                <div class="skill-level">Lv.${displaySkill.level} / ${displaySkill.maxLevel}</div>
                <div class="skill-exp-bar"><div class="skill-exp-fill" style="width:${expPercent}%"></div></div>
            `;
            card.onclick = () => this.renderSkillDetail(skill);
            if (isActive) {
                card.ondragstart = (e) => {
                    e.dataTransfer.setData('text/plain', skill.id);
                    card.classList.add('dragging');
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
        } else if (skill.id === 'dashAttack' || skill.id === 'dashAttackThrust') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害倍率</span><span class="sd-stat-val pos">×${effect.damageMul.toFixed(2)}</span></div>`;
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
                }
            }
        } else if (skill.id === 'whirlwind') {
            html += `<div class="sd-stat-row"><span class="sd-stat-name">伤害倍率</span><span class="sd-stat-val pos">×${effect.damageMul.toFixed(2)}</span></div>`;
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
        } else if (skill.id === 'whirlwind') {
            html += `<p>• 每次击中敌人积累 1 点经验</p>`;
            html += `<p>• 同时攻击到两个以上敌人时，额外获得 3 点经验</p>`;
            html += `<p>• 每次击杀目标增加 15 点经验</p>`;
            html += `<p style="margin-top:6px;color:#a0907a;font-size:12px;">触发条件：按快捷键触发技能，需装备近战武器且消耗体力</p>`;
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
