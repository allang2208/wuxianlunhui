import { ItemDatabase } from '../items/item-database.js';
/* ================================================================
 *  CodexManager — 图鉴系统（装备 + 怪物分类）
 * ================================================================ */
import { isGunWeapon, getAmmoConfig, getFireMode } from '../config/gun-ammo.js';
import { EquipDataManager } from './equip-data-manager.js';
import { ENEMY_DATA } from '../systems/data-loader.js';
import { queryAllElements, getElement } from '../utils/dom-utils.js';

const CodexManager = {
    // 当前主分类: 'equipment' | 'monster'
    currentSection: 'equipment',
    // 装备子分类
    equipCategories: [
        { key: 'all', label: '全部' },
        { key: 'weapon_melee', label: '近战武器' },
        { key: 'weapon_ranged', label: '远程武器' },
        { key: 'armor', label: '防具' },
        { key: 'accessory', label: '饰品' },
        { key: 'consumable', label: '消耗品' }
    ],
    // 怪物子分类（动态生成，见 _buildMonsterCategories）
    monsterCategories: [],
    currentMonsterCategory: 'all',
    currentEquipCategory: 'all',
    detailItem: null,

    /* ---- 运行时数据库 ---- */
    equipDatabase: {},
    monsterDatabase: {},

    init() {
        this.syncEquipDatabase();
        this.syncMonsterDatabase();
        this.renderMainTabs();
        this.renderEquipCategoryTabs();
        this.renderEquipGrid();
        this.renderMonsterCategoryTabs();
        this.renderMonsterGrid();
        const backBtn = getElement('codexBackBtn');
        if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());
    },

    refresh() {
        this.syncEquipDatabase();
        this.syncMonsterDatabase();
        this.renderMainTabs();
        this.renderEquipCategoryTabs();
        this.renderEquipGrid();
        this.renderMonsterCategoryTabs();
        this.renderMonsterGrid();
    },

    syncEquipDatabase() {
        this.equipDatabase = {};
        const items = ItemDatabase.items || {};
        for (const [id, item] of Object.entries(items)) {
            if (!item.category) continue;
            const entry = { ...item };
            if (entry.stats) {
                entry.stats = entry.stats.map(s => ({
                    label: s.label || s.name,
                    value: s.value,
                    pos: s.pos
                }));
            }
            this.equipDatabase[id] = entry;
        }
    },

    syncMonsterDatabase() {
        this.monsterDatabase = {};
        if (ENEMY_DATA) {
            for (const [id, data] of Object.entries(ENEMY_DATA)) {
                this.monsterDatabase[id] = { ...data, id };
            }
        }
    },

    renderMainTabs() {
        const tabs = queryAllElements('.codex-main-tab');
        tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.section === this.currentSection);
            tab.onclick = () => {
                this.currentSection = tab.dataset.section;
                this.renderMainTabs();
                this.showSection(this.currentSection);
            };
        });
    },

    showSection(section) {
        getElement('codexEquipLayout').classList.toggle('active', section === 'equipment');
        getElement('codexMonsterLayout').classList.toggle('active', section === 'monster');
    },

    renderEquipCategoryTabs() {
        const container = getElement('codexCatTabs');
        if (!container) return;
        container.innerHTML = this.equipCategories.map(c =>
            `<div class="codex-cat-tab ${c.key === this.currentEquipCategory ? 'active' : ''}" data-cat="${c.key}">${c.label}</div>`
        ).join('');
        container.querySelectorAll('.codex-cat-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.currentEquipCategory = tab.dataset.cat;
                this.renderEquipCategoryTabs();
                this.renderEquipGrid();
            });
        });
    },

    renderEquipGrid() {
        const grid = getElement('codexGrid');
        if (!grid) return;
        const items = this.getEquipByCategory(this.currentEquipCategory);
        grid.innerHTML = items.map(item => {
            const iconHtml = item.iconImage
                ? `<img src="${item.iconImage}" alt="${item.icon}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon}';">`
                : item.icon;
            return `<div class="codex-card" data-id="${item.name}" onclick="CodexManager.openEquipDetail('${item.name}')">
                <div class="cc-icon">${iconHtml}</div>
                <div class="cc-name">${item.name}</div>
                <div class="cc-type">${item.type}</div>
            </div>`;
        }).join('');
    },

    _buildMonsterCategories() {
        const families = new Set();
        if (ENEMY_DATA) {
            Object.values(ENEMY_DATA).forEach(e => {
                if (e.family) families.add(e.family);
            });
        }
        const categories = [{ key: 'all', label: '全部' }];
        Array.from(families).sort().forEach(f => categories.push({ key: f, label: f }));
        this.monsterCategories = categories;
    },

    renderMonsterCategoryTabs() {
        this._buildMonsterCategories();
        const container = getElement('codexMonsterCatTabs');
        if (!container) return;
        container.innerHTML = this.monsterCategories.map(c =>
            `<div class="codex-cat-tab ${c.key === this.currentMonsterCategory ? 'active' : ''}" data-cat="${c.key}">${c.label}</div>`
        ).join('');
        container.querySelectorAll('.codex-cat-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.currentMonsterCategory = tab.dataset.cat;
                this.renderMonsterCategoryTabs();
                this.renderMonsterGrid();
            });
        });
    },

    renderMonsterGrid() {
        const grid = getElement('codexMonsterGrid');
        if (!grid) return;
        const items = this.getMonsterByCategory(this.currentMonsterCategory);
        grid.innerHTML = items.map(item => {
            const iconHtml = `<div style="width:36px;height:36px;border-radius:50%;background:${item.color};box-shadow:0 0 8px ${item.color}80;"></div>`;
            return `<div class="codex-card codex-monster-card" data-id="${item.id}" onclick="CodexManager.openMonsterDetail('${item.id}')">
                <div class="cc-icon">${iconHtml}</div>
                <div class="cc-name">${item.name}</div>
                <div class="cc-type">${item.type}</div>
            </div>`;
        }).join('');
    },

    getMonsterByCategory(cat) {
        const items = Object.values(this.monsterDatabase);
        if (cat === 'all') return items;
        return items.filter(i => i.family === cat);
    },

    getEquipByCategory(cat) {
        const items = Object.values(this.equipDatabase);
        if (cat === 'all') return items;
        return items.filter(i => i.category === cat);
    },
    getEquipByName(name) {
        return Object.values(this.equipDatabase).find(i => i.name === name) || null;
    },
    getMonsterById(id) {
        return this.monsterDatabase[id] || null;
    },

    openEquipDetail(itemName) {
        const item = this.getEquipByName(itemName);
        if (!item) return;
        this.detailItem = item;
        const title = getElement('codexDetailTitle');
        if (title) title.textContent = item.name;
        this.renderEquipDetail(item);
    },

    openMonsterDetail(monsterId) {
        const item = this.getMonsterById(monsterId);
        if (!item) return;
        this.detailItem = item;
        const title = getElement('codexDetailTitle');
        if (title) title.textContent = item.name;
        this.renderMonsterDetail(item);
    },

    closeDetail() {
        this.detailItem = null;
        const body = getElement('codexDetailBody');
        const title = getElement('codexDetailTitle');
        if (body) body.innerHTML = '<div style="color:#8a7d6b;text-align:center;padding:40px 20px;">点击左侧条目查看详情</div>';
        if (title) title.textContent = '详情';
    },

    renderEquipDetail(item) {
        const body = getElement('codexDetailBody');
        if (!body) return;

        // 从 ItemDatabase 实时获取最新数据
        const liveItem = this._getLiveEquipData(item);
        const d = liveItem || item;

        const rarityClass = d.rarity || 'common';
        const rarityLabel = { common: '普通', uncommon: '优质', rare: '稀有', epic: '史诗' }[d.rarity] || d.rarity;
        let html = '';
        const iconHtml = d.iconImage
            ? `<img src="${d.iconImage}" alt="${d.icon}" onerror="this.style.display='none';this.parentElement.textContent='${d.icon}';">`
            : d.icon;
        html += `<div class="cd-hero">
            <div class="cd-hero-icon">${iconHtml}</div>
            <div class="cd-hero-info">
                <div class="cd-hero-name">${d.name}</div>
                <div class="cd-hero-type">${d.type}${d.equipSlot ? ' · ' + this.slotLabel(d.equipSlot) : ''} · Lv.${d.level || 1}</div>
                <span class="cd-hero-rarity ${rarityClass}">${rarityLabel}</span>
            </div>
        </div>`;

        // 枪械类武器：固定15字段显示格式
        const isGun = isGunWeapon(d);
        if (isGun) {
            html += `<div class="cd-section">`;
            html += this.detailRow('名称', d.name);
            html += this.detailRow('类型', d.type);
            html += this.detailRow('双手/单手', d.isTwoHanded ? '双手' : '单手');
            html += this.detailRow('稀有度', rarityLabel);
            html += this.detailRow('攻击力公式', this._getAtkFormula(d));
            html += this.detailRow('武器强化后攻击力公式', this._getEnhancedAtkFormula(d));
            html += this.detailRow('射程', d.attack && d.attack.range ? `${d.attack.range}px` : '');
            html += this.detailRow('子弹飞行速度', d.attack && d.attack.projectileSpeed ? `${d.attack.projectileSpeed} px/s` : '');
            const ammoCap = getAmmoConfig(d);
            html += this.detailRow('弹夹子弹数', ammoCap ? ammoCap.max : '');
            html += this.detailRow('换弹时间', ammoCap ? `${ammoCap.reloadTime}ms` : '');
            html += this.detailRow('攻击间隔', d.attack && d.attack.attackInterval ? `${d.attack.attackInterval}ms` : '');
            html += this.detailRow('伤害类型', d.attack && d.attack.damageType ? d.attack.damageType : '');
            html += this.detailRow('击退距离', d.attack && d.attack.knockback !== undefined ? `${d.attack.knockback}px` : '');
            // 散布参数：根据武器类型和改造状态显示不同格式
            const ce = d._craftEffects || {};
            if (d.weaponType === 'shotgun' && ce.slugMode) {
                // 独头弹模式：显示每次射击散布增加和后坐力恢复时间
                const baseShotSpread = 5;
                const shotSpread = Math.max(0, baseShotSpread + (ce.shotSpreadDelta || 0));
                const baseRecovery = 500;
                const recovery = Math.max(100, baseRecovery + (ce.slugRecoilRecovery || 0));
                html += this.detailRow('每次射击散布增加', `+${shotSpread}°`);
                html += this.detailRow('后坐力恢复时间', `${recovery}ms`);
            } else if (getFireMode(d) === 'semiAuto') {
                // 半自动武器：显示每次射击散布增加和后坐力恢复时间
                const baseShotSpread = 5;
                const shotSpread = Math.max(0, baseShotSpread + (ce.shotSpreadDelta || 0));
                const baseRecovery = 500;
                const recovery = Math.max(100, baseRecovery + (ce.recoilRecoveryDelta || 0));
                html += this.detailRow('每次射击散布增加', `+${shotSpread}°`);
                html += this.detailRow('后坐力恢复时间', `${recovery}ms`);
            } else {
                html += this.detailRow('射击散布开始时间', this._getSpreadStart(d));
                html += this.detailRow('达到最大散布时间', this._getSpreadMax(d));
                html += this.detailRow('最大散布角度', this._getSpreadAngle(d));
            }
            // 机枪类：显示过热时间
            const overheatTime = this._getOverheatTime(d);
            if (overheatTime) html += this.detailRow('过热时间', overheatTime);
            // 能量轻机枪：显示达到最大射速时间
            const rampUpTime = this._getRampUpTime(d);
            if (rampUpTime) html += this.detailRow('达到最大射速时间', rampUpTime);
            html += `</div>`;
            if (d.desc) html += `<div class="cd-section"><div class="cd-desc">${d.desc}</div></div>`;
        } else {
            // 非枪械：弓类 / 近战 / 其他武器
            html += `<div class="cd-section"><h4>基本信息</h4>`;
            html += this.detailRow('名称', d.name);
            html += this.detailRow('类型', d.type);
            html += this.detailRow('装备槽', d.equipSlot ? this.slotLabel(d.equipSlot) : '不可装备');
            html += this.detailRow('稀有度', rarityLabel);
            html += this.detailRow('需求等级', 'Lv.' + (d.level || 1));
            html += `</div>`;
            if (d.attack) {
                html += `<div class="cd-section"><h4>攻击参数</h4>`;
                let atkFormula = this._getAtkFormula(d);
                if (atkFormula) html += this.detailRow('攻击力公式', atkFormula);
                let enhancedFormula = this._getEnhancedAtkFormula(d);
                if (enhancedFormula) html += this.detailRow('强化后攻击力公式', enhancedFormula);
                if (d.attack.range) html += this.detailRow('攻击距离', `${d.attack.range}px`);
                if (d.attack.attackInterval) html += this.detailRow('攻击间隔', `${d.attack.attackInterval}ms`);
                if (d.attack.projectileSpeed) html += this.detailRow('弹道速度', `${d.attack.projectileSpeed}px/s`);
                if (d.attack.hitType) html += this.detailRow('命中类型', d.attack.hitType);
                if (d.attack.damageType) html += this.detailRow('伤害类型', d.attack.damageType);
                if (d.attack.knockback !== undefined) html += this.detailRow('击退', `${d.attack.knockback}px`);
                html += `</div>`;
            }
            // 弓类武器：统一动画参数模板
            if (d.weaponType === 'bow' && d.animation) {
                html += `<div class="cd-section"><h4>动画参数</h4>`;
                const anim = d.animation;
                if (anim.rotateMs) html += this.detailRow('旋转前摇', `${anim.rotateMs}ms（逆时针${anim.rotateAngle || '14°'}）`);
                if (anim.windupMs && anim.swingMs && anim.recoverMs) {
                    const totalAnim = anim.windupMs + anim.swingMs + anim.recoverMs;
                    html += this.detailRow('攻击动画', `${totalAnim}ms（蓄力${anim.windupMs} + 释放${anim.swingMs} + 收回${anim.recoverMs}）`);
                }
                if (anim.returnMs) html += this.detailRow('旋转后摇', `${anim.returnMs}ms（回正待机角度）`);
                if (anim.frameCount) html += this.detailRow('帧数', `${anim.frameCount} 帧`);
                if (anim.soundEffects) {
                    if (anim.soundEffects.rotateComplete) html += this.detailRow('前摇音效', '拉弓音效');
                    if (anim.soundEffects.attackEnd) html += this.detailRow('射出音效', '箭矢飞行音效');
                }
                if (anim.description) html += this.detailRow('攻击流程', anim.description);
                html += `</div>`;
            }
            if (d.desc) html += `<div class="cd-section"><h4>描述</h4><div class="cd-desc">${d.desc}</div></div>`;
        }
        body.innerHTML = html;
    },

    // 从 EquipDataManager 查找完整配置（用于补充 ItemDatabase 中缺失的字段）
    _findEquipConfig(item) {
        if (!item) return null;
        const configs = Object.values(EquipDataManager || {});
        if (item.weaponId) {
            const match = configs.find(c => c && c.weaponId === item.weaponId);
            if (match) return match;
        }
        if (item.name) {
            const match = configs.find(c => c && c.name === item.name);
            if (match) return match;
        }
        return null;
    },

    // 合并 EquipDataManager 配置到图鉴数据
    _mergeEquipConfig(item) {
        if (!item) return item;
        const equipConfig = this._findEquipConfig(item);
        if (!equipConfig) return item;
        const result = { ...item };
        const fieldsToMerge = [
            'attackFormula', 'ammoConfig', 'spreadParams', 'heatParams',
            'energyLMGParams', 'fireMode', 'animConfigKey', 'attackKey',
            'offhandAttackKey', 'canvasImageProp', 'specialAttackType',
            'weaponEffect', 'skillOverrides', 'craftConfig', 'chargeAttack',
            'sound', 'pelletCount', 'equipSound', 'renderParams', 'fireSound'
        ];
        for (const field of fieldsToMerge) {
            if (equipConfig[field] !== undefined && result[field] === undefined) {
                result[field] = equipConfig[field];
            }
        }
        return result;
    },

    // 从 ItemDatabase 实时获取装备数据
    _getLiveEquipData(item) {
        if (!item) return null;
        const items = ItemDatabase.items || {};
        let result = null;
        // 优先通过 weaponId 查找
        if (item.weaponId) {
            for (const [, data] of Object.entries(items)) {
                if (data.weaponId === item.weaponId) {
                    result = { ...data };
                    break;
                }
            }
        }
        // 其次通过 name 查找
        if (!result && item.name) {
            for (const [, data] of Object.entries(items)) {
                if (data.name === item.name) {
                    result = { ...data };
                    break;
                }
            }
        }
        // 如果找不到，回退到传入的 item
        if (!result && item) {
            result = { ...item };
        }
        // 补充 EquipDataManager 中的完整配置
        return result ? this._mergeEquipConfig(result) : null;
    },

    // 获取攻击力公式文本
    _getAtkFormula(item) {
        if (!item || !item.attackFormula) return '';
        const formula = item.attackFormula;
        let effectiveFormula = formula;
        const ce = item._craftEffects;
        if (ce && ce.slugMode && formula.variants && formula.variants.slugMode) {
            effectiveFormula = formula.variants.slugMode;
        }
        const base = effectiveFormula.base || 0;
        const parts = [`${base}`];
        const attrNames = { str: '力量', dex: '敏捷', int: '智力', con: '体质', wis: '精神' };
        for (const attr of effectiveFormula.attrs || []) {
            if (Math.abs(attr.base) < 0.001) continue;
            const name = attrNames[attr.key] || attr.key;
            parts.push(`${attr.base >= 0 ? '+' : '-'} ${name}×${Math.abs(attr.base).toFixed(2)}`);
        }
        return parts.join(' ');
    },

    // 获取武器强化后攻击力公式
    _getEnhancedAtkFormula(item) {
        if (!item || !item.attackFormula) {
            const baseFormula = this._getAtkFormula(item);
            if (!baseFormula) return '';
            return `(${baseFormula}) × (1 + 强化等级 × 0.1)`;
        }
        const formula = item.attackFormula;
        let effectiveFormula = formula;
        const ce = item._craftEffects;
        if (ce && ce.slugMode && formula.variants && formula.variants.slugMode) {
            effectiveFormula = formula.variants.slugMode;
        }
        const base = effectiveFormula.base || 0;
        const enhanceFlat = effectiveFormula.enhanceFlat || 0;
        const parts = [];
        if (base !== 0 || enhanceFlat !== 0) {
            if (enhanceFlat === 0) {
                parts.push(`${base}`);
            } else {
                parts.push(`${base} + 强化等级×${enhanceFlat}`);
            }
        }
        const attrNames = { str: '力量', dex: '敏捷', int: '智力', con: '体质', wis: '精神' };
        for (const attr of effectiveFormula.attrs || []) {
            if (Math.abs(attr.base) < 0.001 && Math.abs(attr.perEnhance) < 0.001) continue;
            const name = attrNames[attr.key] || attr.key;
            if (Math.abs(attr.perEnhance) < 0.001) {
                parts.push(`${attr.base >= 0 ? '+' : '-'} ${name}×${Math.abs(attr.base).toFixed(2)}`);
            } else {
                parts.push(`${attr.base >= 0 ? '+' : '-'} ${name}×(${Math.abs(attr.base).toFixed(2)} + 强化等级×${Math.abs(attr.perEnhance).toFixed(2)})`);
            }
        }
        return parts.join(' ');
    },

    // 获取散布开始时间
    _getSpreadStart(item) {
        const sp = item && item.spreadParams;
        if (!sp || sp.startDelay === undefined) return '';
        const val = sp.startDelay;
        if (val === 0) return '即时';
        return (val / 1000).toFixed(1) + '秒';
    },

    // 获取达到最大散布时间
    _getSpreadMax(item) {
        const sp = item && item.spreadParams;
        if (!sp || sp.maxTime === undefined) return '';
        return (sp.maxTime / 1000).toFixed(1) + '秒';
    },

    // 获取最大散布角度
    _getSpreadAngle(item) {
        const sp = item && item.spreadParams;
        if (!sp || sp.maxAngle === undefined) return '';
        return '±' + sp.maxAngle + '°';
    },

    // 获取过热时间（机枪类）
    _getOverheatTime(item) {
        const heat = item && (item.heatParams || item.energyLMGParams);
        if (!heat || heat.overheatTime === undefined) return '';
        return (heat.overheatTime / 1000).toFixed(1) + '秒';
    },

    // 获取达到最大射速时间（能量轻机枪专用）
    _getRampUpTime(item) {
        const elp = item && item.energyLMGParams;
        if (!elp || elp.rampUpTime === undefined) return '';
        return (elp.rampUpTime / 1000).toFixed(1) + '秒';
    },

    renderMonsterDetail(item) {
        const body = getElement('codexDetailBody');
        if (!body) return;
        body.style.overflowY = 'auto';
        body.style.maxHeight = 'calc(100vh - 200px)';

        const liveData = (ENEMY_DATA && item.id && ENEMY_DATA[item.id]) ? ENEMY_DATA[item.id] : {};
        const d = { ...item, ...liveData };

        let html = '';
        const iconHtml = `<div style="width:64px;height:64px;border-radius:50%;background:${d.color || '#8a4a4a'};box-shadow:0 0 16px ${d.color || '#8a4a4a'}80;"></div>`;
        // 家族标签
        const familyTag = d.family ? `<span class="cd-family-tag">${d.family}类</span>` : '';
        html += `<div class="cd-hero">
            <div class="cd-hero-icon">${iconHtml}</div>
            <div class="cd-hero-info">
                <div class="cd-hero-name">${d.name || '-'}${familyTag}</div>
                <div class="cd-hero-type">${d.type || '怪物'} · ${d.category === 'monster' ? '怪物' : '敌人'}</div>
                <span class="cd-hero-rarity common">${d.type || '普通'}</span>
            </div>
        </div>`;

        // 基本信息
        html += `<div class="cd-section"><h4>基本信息</h4>`;
        html += this.detailRow('名称', d.name);
        html += this.detailRow('类型', d.type);
        let level = d.level;
        if (level === undefined || level === null) {
            const sixAttrs = (d.str || 0) + (d.dex || 0) + (d.int || 0) + (d.con || 0) + (d.wis || 0) + (d.luck || 0);
            level = Math.round(sixAttrs / 8);
        }
        html += this.detailRow('等级', level);
        html += this.detailRow('生命值', `${d.hp || 0} / ${d.maxHp || 0}`);
        html += this.detailRow('经验值', d.expValue || (10 + (level || 1) * 5));
        if (d.collisionRadius) html += this.detailRow('碰撞半径', `${d.collisionRadius}px`);
        html += `</div>`;

        // 六维属性
        html += `<div class="cd-section"><h4>六维属性</h4>`;
        html += this.detailRow('力量', d.str || 0);
        html += this.detailRow('敏捷', d.dex || 0);
        html += this.detailRow('智力', d.int || 0);
        html += this.detailRow('体质', d.con || 0);
        html += this.detailRow('精神', d.wis || 0);
        html += this.detailRow('幸运', d.luck || 0);
        html += `</div>`;

        // 战斗属性
        html += `<div class="cd-section"><h4>战斗属性</h4>`;
        const str = d.str || 0, dex = d.dex || 0, int = d.int || 0, con = d.con || 0, wis = d.wis || 0, luck = d.luck || 0;
        const calcAtk = Math.round(10 + str * 0.05 + dex * 0.1);
        const calcDef = Math.floor((con * 1.2 + str * 0.3) * 0.67 * 0.65);
        const calcMatk = Math.floor(int * 1.5 + wis * 0.5);
        const calcMdef = Math.floor(wis * 1.2 + int * 0.3);
        const _calcHit = 80 + Math.floor(dex * 0.5);
        const _calcDodge = 5 + Math.floor(dex * 0.3);
        const calcCrit = 2 + Math.floor(luck * 1.0);
        const calcCritRes = Math.floor(con * 1.0);
        html += this.detailRow('物理攻击', calcAtk);
        html += this.detailRow('物理防御', calcDef);
        html += this.detailRow('魔法攻击', calcMatk);
        html += this.detailRow('魔法防御', calcMdef);
        html += this.detailRow('暴击率', calcCrit + '%');
        html += this.detailRow('暴击抵抗', calcCritRes + '%');
        html += this.detailRow('攻击距离', `${d.attackRange || 0}px`);
        html += this.detailRow('攻击冷却', `${d.attackCooldown || 0}ms`);
        html += this.detailRow('攻击方式', d.attackType || '-');
        if (d.damageMin !== undefined && d.damageMax !== undefined) {
            html += this.detailRow('伤害范围', `${d.damageMin} ~ ${d.damageMax}`);
        }
        html += this.detailRow('击退', d.knockback ? `${d.knockback}px` : '无');
        html += `</div>`;

        // 移动属性
        html += `<div class="cd-section"><h4>移动属性</h4>`;
        html += this.detailRow('移动速度', d.speed || 0);
        html += this.detailRow('体型', `${d.size || 0}px`);
        html += `</div>`;

        // 特殊机制（放在基础属性下面）
        const mechanics = [];
        if (d.skills && d.skills.length > 0) {
            for (const skill of d.skills) mechanics.push(skill);
        }
        if (d.equipShield) {
            mechanics.push({ name: '持盾防御', desc: '受到非魔法伤害时，有50%概率举起盾牌格挡，减少50%伤害' });
        }
        if (d.transform) {
            const t = d.transform;
            const parts = [];
            if (t.hpThreshold) parts.push(`生命值低于 ${Math.round(t.hpThreshold * 100)}% 时变身`);
            if (t.damageMultiplier) parts.push(`伤害提升 ${Math.round((t.damageMultiplier - 1) * 100)}%`);
            if (t.hpRecover) parts.push('恢复生命值');
            if (t.howlDuration) parts.push(`嚎叫持续 ${t.howlDuration / 1000} 秒`);
            mechanics.push({ name: '变身', desc: parts.join('；') });
        }
        if (d.aiPhases && d.aiPhases.length > 0) {
            const phaseDesc = d.aiPhases.map(p => {
                let s = `${p.name}（HP≤${Math.round(p.hpThreshold * 100)}%）`;
                const effects = [];
                if (p.speedMul) effects.push(`移速x${p.speedMul}`);
                if (p.attackSpeedMul) effects.push(`攻速x${p.attackSpeedMul}`);
                if (p.attackRangeMul) effects.push(`射程x${p.attackRangeMul}`);
                if (p.newSkill) effects.push(`习得 ${p.newSkill}`);
                if (effects.length) s += '：' + effects.join('，');
                return s;
            }).join('；');
            mechanics.push({ name: '阶段转换', desc: phaseDesc });
        }
        if (mechanics.length > 0) {
            html += `<div class="cd-section"><h4>特殊机制</h4>`;
            for (const m of mechanics) {
                html += this.detailRow(m.name, m.desc);
            }
            html += `</div>`;
        }

        if (d.description) html += `<div class="cd-section"><h4>描述</h4><div class="cd-desc">${d.description}</div></div>`;
        body.innerHTML = html;
    },

    detailRow(label, value, cls = '') {
        return `<div class="cd-stat-row"><span class="cd-stat-label">${label}</span><span class="cd-stat-val ${cls}">${value !== undefined && value !== null ? value : '-'}</span></div>`;
    },
    slotLabel(slot) {
        const map = { weapon: '主手1', weapon2: '主手2', helmet: '头盔', armor: '盔甲', gloves: '手套', boots: '靴子', necklace: '项链', ring1: '戒指1', ring2: '副手2', earring: '耳环', cloak: '披风', belt: '腰带', offhand: '副手1', extra: '额外', backpack: '背包' };
        return map[slot] || slot;
    }
};

if (typeof window !== 'undefined') {
    window.CodexManager = CodexManager;
}

export { CodexManager };
