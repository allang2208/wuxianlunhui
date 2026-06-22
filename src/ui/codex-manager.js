/* ================================================================
 *  CodexManager — 装备图鉴系统（自动从 ItemDatabase 同步）
 *  数据驱动：所有装备数据来自 JSON 配置，无需硬编码
 *  新增装备只需在 data/equipment.json 中添加条目
 * ================================================================ */
export const CodexManager = {
    categories: [
        { key: 'all', label: '全部' },
        { key: 'weapon_melee', label: '近战武器' },
        { key: 'weapon_ranged', label: '远程武器' },
        { key: 'armor', label: '防具' },
        { key: 'accessory', label: '饰品' },
        { key: 'consumable', label: '消耗品' }
    ],
    currentCategory: 'all',
    detailItem: null,

    /* ---- 运行时数据库（从 ItemDatabase 合并生成，attack/animation 在 JSON 中）---- */
    database: {},

    /** 从 ItemDatabase 同步基础数据（attack/animation 已在 JSON 中） */
    syncFromItemDatabase() {
        const items = ItemDatabase.items;
        for (const [id, item] of Object.entries(items)) {
            if (!item.category) continue;
            const entry = { ...item };
            // 统一 stats 字段名格式（JSON 中已统一为 label，保留兼容）
            if (entry.stats) {
                entry.stats = entry.stats.map(s => ({
                    label: s.label || s.name,
                    value: s.value,
                    pos: s.pos
                }));
            }
            this.database[id] = entry;
        }
    },

    /** 新增装备后调用此方法刷新图鉴 */
    refresh() {
        this.syncFromItemDatabase();
        this.currentCategory = 'all';
        this.renderCategoryTabs();
        this.renderGrid();
    },

    init() {
        this.syncFromItemDatabase();
        this.renderCategoryTabs();
        this.renderGrid();
        const backBtn = document.getElementById('codexBackBtn'); if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());
    },

    getItemsByCategory(cat) {
        const items = Object.values(this.database);
        if (cat === 'all') return items;
        return items.filter(i => i.category === cat);
    },
    getItemByName(name) {
        return Object.values(this.database).find(i => i.name === name) || null;
    },

    renderCategoryTabs() {
        const container = document.getElementById('codexCatTabs');
        if (!container) return;
        container.innerHTML = this.categories.map(c =>
            `<div class="codex-cat-tab ${c.key === this.currentCategory ? 'active' : ''}" data-cat="${c.key}">${c.label}</div>`
        ).join('');
        container.querySelectorAll('.codex-cat-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.currentCategory = tab.dataset.cat;
                this.renderCategoryTabs();
                this.renderGrid();
            });
        });
    },

    renderGrid() {
        const grid = document.getElementById('codexGrid');
        if (!grid) return;
        const items = this.getItemsByCategory(this.currentCategory);
        grid.innerHTML = items.map(item => {
            const iconHtml = item.iconImage
                ? `<img src="${item.iconImage}" alt="${item.icon}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon}';">`
                : item.icon;
            return `<div class="codex-card" data-id="${item.name}" onclick="CodexManager.openDetail('${item.name}')">
                <div class="cc-icon">${iconHtml}</div>
                <div class="cc-name">${item.name}</div>
                <div class="cc-type">${item.type}</div>
            </div>`;
        }).join('');
    },

    openDetail(itemName) {
        const item = Object.values(this.database).find(i => i.name === itemName);
        if (!item) return;
        this.detailItem = item;
        const layout = document.getElementById('codexLayout');
        const detail = document.getElementById('codexDetail');
        const title = document.getElementById('codexDetailTitle');
        if (layout) layout.style.display = 'none';
        if (detail) detail.style.display = 'flex';
        if (title) title.textContent = item.name;
        this.renderDetail(item);
    },

    closeDetail() {
        this.detailItem = null;
        const detail = document.getElementById('codexDetail');
        const layout = document.getElementById('codexLayout');
        if (detail) detail.style.display = 'none';
        if (layout) layout.style.display = 'flex';
    },

    renderDetail(item) {
        const body = document.getElementById('codexDetailBody');
        if (!body) return;
        const rarityClass = item.rarity || 'common';
        const rarityLabel = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic' }[item.rarity] || item.rarity;

        let html = '';

        // Hero 头部
        const iconHtml = item.iconImage
            ? `<img src="${item.iconImage}" alt="${item.icon}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon}';">`
            : item.icon;
        html += `<div class="cd-hero">
            <div class="cd-hero-icon">${iconHtml}</div>
            <div class="cd-hero-info">
                <div class="cd-hero-name">${item.name}</div>
                <div class="cd-hero-type">${item.type}${item.equipSlot ? ' · ' + this.slotLabel(item.equipSlot) : ''} · Lv.${item.level || 1}</div>
                <span class="cd-hero-rarity ${rarityClass}">${rarityLabel}</span>
            </div>
        </div>`;

        // 基本信息
        html += `<div class="cd-section"><h4>📋 基本信息</h4>`;
        html += this.detailRow('名称', item.name);
        html += this.detailRow('类型', item.type);
        html += this.detailRow('装备槽', item.equipSlot ? this.slotLabel(item.equipSlot) : '不可装备');
        html += this.detailRow('稀有度', rarityLabel);
        html += this.detailRow('需求等级', 'Lv.' + (item.level || 1));
        html += this.detailRow('堆叠上限', item.stack || '1');
        html += `</div>`;

        // 武器特性（武器特有）
        if (item.category && item.category.includes('weapon')) {
            html += `<div class="cd-section"><h4>⚔ 武器特性</h4>`;
            if (item.weaponId) html += this.detailRow('武器ID', item.weaponId);
            if (item.weaponTypeTag) html += this.detailRow('武器类型', item.weaponTypeTag);
            if (item.weaponType) html += this.detailRow('武器细分', item.weaponType);
            if (item.weaponCategory) html += this.detailRow('武器类别', item.weaponCategory);
            if (item.rangedType) html += this.detailRow('远程类型', item.rangedType);
            if (item.weaponAsset && item.weaponAsset.framePrefix) html += this.detailRow('动画前缀', item.weaponAsset.framePrefix);
            if (item.weaponAsset && item.weaponAsset.frameCount) html += this.detailRow('动画帧数', item.weaponAsset.frameCount);
            html += `</div>`;
        }

        // 素材信息（武器特有）
        if (item.equipImage || item.dropImage || item.iconImage) {
            html += `<div class="cd-section"><h4>📁 素材信息</h4>`;
            if (item.equipImage) html += this.detailRow('装备贴图', item.equipImage);
            if (item.dropImage) html += this.detailRow('掉落贴图', item.dropImage);
            if (item.iconImage) html += this.detailRow('图标贴图', item.iconImage);
            html += `</div>`;
        }

        // 面板属性
        if (item.stats && item.stats.length) {
            html += `<div class="cd-section"><h4>⚔ 面板属性</h4>`;
            item.stats.forEach(s => {
                let value = s.value;
                // weapon1/weapon2/weapon3/weapon4/weapon5 动态计算攻击力
                if ((item.weaponId === 'weapon1' || item.weaponId === 'weapon2' || item.weaponId === 'weapon3' || item.weaponId === 'weapon4' || item.weaponId === 'weapon5') && s.label === '物理攻击' && Game.player && Game.player.data) {
                    const d = Game.player.data;
                    if (item.weaponId === 'weapon3') {
                        value = Math.round(6 + d.dex * 0.35);
                    } else if (item.weaponId === 'weapon4') {
                        value = Math.round(40 + d.str * 0.1 + d.dex * 0.1);
                    } else if (item.weaponId === 'weapon5') {
                        value = Math.round(60 + d.str * 1.5 + d.dex * 1.25);
                    } else {
                        const baseAtk = item.weaponId === 'weapon2' ? 23 : 10;
                        value = Math.round(baseAtk + d.str * 0.05 + d.dex * 0.1);
                    }
                }
                html += this.detailRow(s.label, value, s.pos ? 'pos' : '');
            });
            // 武器：追加攻击力公式
            if (item.weaponId) {
                let formula = '';
                if (item.weaponId === 'weapon3') formula = '6 + 敏捷×0.35';
                else if (item.weaponId === 'weapon4') formula = '40 + 力量×0.1 + 敏捷×0.1';
                else if (item.weaponId === 'weapon5') formula = '60 + 力量×1.5 + 敏捷×1.25';
                else if (item.weaponId === 'weapon2') formula = '23 + 力量×0.05 + 敏捷×0.1';
                else if (item.weaponId === 'weapon1') formula = '10 + 力量×0.05 + 敏捷×0.1';
                if (formula) html += this.detailRow('攻击力公式', formula);
            }
            html += `</div>`;
        }

        // 攻击参数（武器特有）：优先从 Player 实际攻击配置获取（自动反显）
        let atkParams = item.attack;
        if (Game.player && Game.player.equipments[Game.player.weaponMode] && Game.player.equipments[Game.player.weaponMode].name === item.name) {
            const currentItem = Game.player.equipments[Game.player.weaponMode];
            const isMelee = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
            const isBow = currentItem.weaponType === 'bow';
            const isPistol = currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol';
            if (isMelee && Game.player.attacks.melee) {
                atkParams = { range: Game.player.attacks.melee.range, attackInterval: Game.player.attacks.melee.maxCooldown, knockback: item.attack ? item.attack.knockback : 8, hitType: '突刺（扇形判定）', damageType: '物理' };
            } else if (isBow && Game.player.attacks.ranged) {
                atkParams = { range: Game.player.attacks.ranged.projectileRange, attackInterval: Game.player.attacks.ranged.maxCooldown, knockback: 0, hitType: '箭矢（直线弹道）', damageType: '物理' };
            } else if (isPistol && Game.player.attacks.pistol) {
                atkParams = { range: Game.player.attacks.pistol.projectileRange, attackInterval: Game.player.attacks.pistol.maxCooldown, knockback: 8, hitType: '黄色曳光弹（直线弹道）', damageType: '物理' };
            }
        }
        if (atkParams) {
            html += `<div class="cd-section"><h4>🎯 攻击参数</h4>`;
            html += this.detailRow('攻击距离', atkParams.range + 'px');
            html += this.detailRow('攻击间隔', atkParams.attackInterval + 'ms');
            html += this.detailRow('击退距离', (atkParams.knockback || 0) + 'px');
            html += this.detailRow('命中类型', atkParams.hitType || '-');
            html += this.detailRow('伤害类型', atkParams.damageType || '-');
            const atkStat = item.stats && item.stats.find(s => s.label === '物理攻击');
            if (atkStat) html += this.detailRow('物理攻击', atkStat.value);
            html += `</div>`;
        }

        // 动画参数（武器特有）
        if (item.animation) {
            html += `<div class="cd-section"><h4>🎬 动画参数</h4>`;
            html += this.detailRow('动画类型', item.animation.type);
            html += this.detailRow('总时长', item.animation.totalMs);
            if (item.animation.windupMs) html += this.detailRow('windup（预备）', item.animation.windupMs + 'ms');
            if (item.animation.swingMs) html += this.detailRow('swing（攻击）', item.animation.swingMs + 'ms');
            if (item.animation.recoveryMs) html += this.detailRow('recovery（回位）', item.animation.recoveryMs + 'ms');
            html += this.detailRow('待机角度', item.animation.idleAngle || '-');
            html += this.detailRow('预备角度', item.animation.windupAngle || '-');
            html += this.detailRow('挥击角度', item.animation.swingAngle || '-');
            html += this.detailRow('持握偏移', item.animation.holdOffset || '-');
            html += this.detailRow('武器尺寸', (item.animation.weaponSize || '-') + 'px');
            html += this.detailRow('时间倍率', item.animation.timingMul || '-');
            if (item.animation.recoilAmount) html += this.detailRow('后坐力幅度', item.animation.recoilAmount);
            html += `</div>`;

            html += `<div class="cd-section"><h4>💡 动画说明</h4>`;
            html += `<div style="color:#8a7d6b;font-size:12px;line-height:1.8;">${item.animation.description}</div>`;
            html += `</div>`;
        }

        // 描述
        html += `<div class="cd-section"><h4>📝 描述</h4>`;
        html += `<div style="color:#a0907a;font-size:13px;line-height:1.8;font-style:italic;">${item.desc}</div>`;
        html += `</div>`;

        body.innerHTML = html;
    },

    detailRow(label, value, cssClass) {
        return `<div class="cd-row"><span class="cd-label">${label}</span><span class="cd-value ${cssClass}">${value}</span></div>`;
    },

    slotLabel(slot) {
        const map = {
            weapon: '主手', weapon2: '副手', offhand: '副手',
            helmet: '头盔', armor: '盔甲', gloves: '手套',
            boots: '靴子', belt: '腰带', necklace: '项链',
            ring1: '戒指', ring2: '戒指'
        };
        return map[slot] || slot;
    }
};
