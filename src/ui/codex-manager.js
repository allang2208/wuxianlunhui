import { ItemDatabase } from '../items/item-database.js';
import { getRarityLabel } from '../config/rarity.js';
/* ================================================================
 *  CodexManager — 图鉴系统（装备 + 怪物分类）
 * ================================================================ */
import { isGunWeapon, getAmmoConfig } from '../config/gun-ammo.js';
import { EquipDataManager } from './equip-data-manager.js';
import { ENEMY_DATA } from '../systems/data-loader.js';
import { queryAllElements, getElement } from '../utils/dom-utils.js';
import { CodexFormulaHelper } from './codex-formula-helper.js';
import { WEAPON_FX_CONFIG } from '../config/weapon-fx-config.js';
import { UNIT_KIND_CFG } from '../world/unit-upgrade-store.js';
import hamsterMinerCfg from '../../data/hamster-miner-config.json';
import producerBuildingsJson from '../../data/producer-buildings.json';
import { buildFormulaDisplay, buildEnhancedFormulaDisplay } from '../config/attack-formula.js';
import { getEnemyFamilies, hasEnemyFamily } from '../config/enemy-family.js';

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
        this.renderAllyGrid();
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
        this.renderAllyGrid();
        if (this.detailItem && this.currentSection === 'monster') {
            const current = this.getMonsterById(this.detailItem.id);
            if (current) {
                this.detailItem = current;
                this.renderMonsterDetail(current);
            }
        }
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
            const isActive = tab.dataset.section === this.currentSection;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
            tab.tabIndex = 0;
            tab.onclick = () => {
                if (this.currentSection !== tab.dataset.section) this.closeDetail();
                this.currentSection = tab.dataset.section;
                this.renderMainTabs();
                this.showSection(this.currentSection);
            };
        });
    },

    showSection(section) {
        const equip = getElement('codexEquipLayout');
        const monster = getElement('codexMonsterLayout');
        if (equip) equip.classList.toggle('active', section === 'equipment');
        if (monster) monster.classList.toggle('active', section === 'monster');
        const ally = getElement('codexAllyLayout');
        if (ally) ally.classList.toggle('active', section === 'ally');
    },

    renderEquipCategoryTabs() {
        const container = getElement('codexCatTabs');
        if (!container) return;
        container.innerHTML = this.equipCategories.map(c =>
            `<button type="button" role="tab" aria-selected="${c.key === this.currentEquipCategory}" class="codex-cat-tab ${c.key === this.currentEquipCategory ? 'active' : ''}" data-cat="${this._escapeHtml(c.key)}">${this._escapeHtml(c.label)}</button>`
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
        if (!items.length) {
            grid.innerHTML = '<div class="codex-empty-state">此分类暂无装备档案</div>';
            return;
        }
        grid.innerHTML = items.map(item => {
            const iconHtml = item.iconImage
                ? `<img src="${this._escapeHtml(item.iconImage)}" alt="${this._escapeHtml(item.icon || '')}">`
                : this._escapeHtml(item.icon || '');
            return `<button type="button" class="codex-card" data-id="${this._escapeHtml(item.name)}" aria-label="查看${this._escapeHtml(item.name)}详情">
                <div class="cc-icon">${iconHtml}</div>
                <div class="cc-name">${this._escapeHtml(item.name)}</div>
                <div class="cc-type">${this._escapeHtml(item.type || '')}</div>
            </button>`;
        }).join('');
        grid.querySelectorAll('.cc-icon img').forEach(img => {
            img.addEventListener('error', () => {
                if (img.parentElement) img.parentElement.textContent = img.alt || '·';
            }, { once: true });
        });
        grid.querySelectorAll('.codex-card').forEach(card => {
            card.addEventListener('click', () => this.openEquipDetail(card.dataset.id));
        });
    },

    _buildMonsterCategories() {
        const families = new Set();
        if (this.monsterDatabase) {
            Object.values(this.monsterDatabase).forEach(e => {
                for (const family of getEnemyFamilies(e)) families.add(family);
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
            `<button type="button" role="tab" aria-selected="${c.key === this.currentMonsterCategory}" class="codex-cat-tab ${c.key === this.currentMonsterCategory ? 'active' : ''}" data-cat="${this._escapeHtml(c.key)}">${this._escapeHtml(c.label)}</button>`
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
        if (!items.length) {
            grid.innerHTML = '<div class="codex-empty-state">此分类暂无怪物档案</div>';
            return;
        }
        grid.innerHTML = items.map(item => {
            const iconHtml = this._renderCodexIcon(item, 36);
            const combatLevel = CodexFormulaHelper.calculateCombatStats(item).combatLevel;
            return `<button type="button" class="codex-card codex-monster-card" data-id="${this._escapeHtml(item.id)}" aria-label="查看${this._escapeHtml(item.name)}详情">
                <div class="cc-icon">${iconHtml}</div>
                <div class="cc-name">${this._escapeHtml(item.name)}</div>
                <div class="cc-type">${this._escapeHtml(item.type || '')} · 战力 Lv.${combatLevel}</div>
            </button>`;
        }).join('');
        grid.querySelectorAll('.codex-card').forEach(card => {
            card.addEventListener('click', () => this.openMonsterDetail(card.dataset.id));
        });
    },

    getMonsterByCategory(cat) {
        const items = Object.values(this.monsterDatabase);
        if (cat === 'all') return items;
        return items.filter(i => hasEnemyFamily(i, cat));
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

    // ==================== 友军栏目（2026-08-19：仓鼠部队独立成栏） ====================

    /** 友军数据唯一真源：兵种全局登记表（unit-upgrade-store）+ 矿工配置；禁止另抄数值 */
    _allyList() {
        const list = Object.values(UNIT_KIND_CFG || {});
        if (hamsterMinerCfg && hamsterMinerCfg.id) list.push(hamsterMinerCfg);
        return list.filter((c) => c && c.id);
    },

    /** 产出建筑名（数据驱动：产兵配置 unitTypes 反查 + 军营/矿场两个独立系统固定项） */
    _allyProducerNames(id) {
        // 产兵配置 unitTypes 用短 key（militia），登记表值对象的 id 是全名（hamster_militia）——先反查短 key
        const kind = Object.keys(UNIT_KIND_CFG || {}).find((k) => UNIT_KIND_CFG[k] && UNIT_KIND_CFG[k].id === id) || id;
        const names = [];
        for (const cfg of Object.values(producerBuildingsJson || {})) {
            if (!cfg || typeof cfg !== 'object' || !cfg.id) continue;
            if ((cfg.unitTypes || []).some((u) => u.key === kind)) names.push(cfg.name);
        }
        // 军营（战士/盾卫）与矿场（矿工）不走产兵配置表，属独立系统
        const BARRACKS_UNITS = ['warrior', 'guard'];
        if (BARRACKS_UNITS.includes(kind)) names.push('仓鼠军营');
        if (id === 'hamster_miner') names.push('仓鼠矿场');
        return names;
    },

    renderAllyGrid() {
        const grid = getElement('codexAllyGrid');
        if (!grid) return;
        const allies = this._allyList();
        if (!allies.length) {
            grid.innerHTML = '<div class="codex-empty-state">暂无友军档案</div>';
            return;
        }
        grid.innerHTML = allies.map((c) => {
            const anim = c.animations && c.animations.idle;
            const iconHtml = anim
                ? this._renderCodexIcon({ idleTexture: anim.src, idleFrameWidth: anim.frameWidth, idleSheetColumns: anim.cols, color: '#4a7a8a' }, 36)
                : `<span>${this._escapeHtml(c.avatar || '🐹')}</span>`;
            return `<button type="button" class="codex-card codex-ally-card" data-id="${this._escapeHtml(c.id)}" aria-label="查看${this._escapeHtml(c.name)}详情">
                <div class="cc-icon">${iconHtml}</div>
                <div class="cc-name">${this._escapeHtml(c.name)}</div>
                <div class="cc-type">${this._escapeHtml(c.title || '友军')}</div>
            </button>`;
        }).join('');
        grid.querySelectorAll('.codex-card').forEach(card => {
            card.addEventListener('click', () => this.openAllyDetail(card.dataset.id));
        });
    },

    openAllyDetail(id) {
        const c = this._allyList().find((x) => x.id === id);
        if (!c) return;
        this.detailItem = c;
        const title = getElement('codexDetailTitle');
        if (title) title.textContent = c.name;
        this.renderAllyDetail(c);
        this._openDetailShell();
    },

    renderAllyDetail(c) {
        const body = getElement('codexDetailBody');
        if (!body) return;
        const base = c.baseData || {};
        const ai = c.ai || {};
        const stats = CodexFormulaHelper.calculateCombatStats(base); // statFormula:'enemy' 同口径
        const anim = c.animations && c.animations.idle;
        const iconHtml = anim
            ? this._renderCodexIcon({ idleTexture: anim.src, idleFrameWidth: anim.frameWidth, idleSheetColumns: anim.cols, color: '#4a7a8a' }, 64)
            : `<span style="font-size:48px;">${c.avatar || '🐹'}</span>`;
        let html = `<div class="cd-hero">
            <div class="cd-hero-icon">${iconHtml}</div>
            <div class="cd-hero-info">
                <div class="cd-hero-name">${c.name}<span class="cd-family-tag ally">友军</span></div>
                <div class="cd-hero-type">${c.title || ''} · ${c.role || c.id}</div>
            </div>
        </div>`;
        html += `<div class="cd-section"><h4>基本信息</h4>`;
        html += this.detailRow('名称', c.name);
        html += this.detailRow('生命值', c.baseMaxHp ?? '-');
        html += this.detailRow('移动速度', ai.walkSpeed ?? '-');
        const producers = this._allyProducerNames(c.id);
        if (producers.length) html += this.detailRow('产出建筑', producers.join('、'));
        html += `</div>`;
        html += `<div class="cd-section"><h4>六维属性</h4>`;
        html += this.detailRow('力量', base.str ?? 0);
        html += this.detailRow('敏捷', base.dex ?? 0);
        html += this.detailRow('智力', base.int ?? 0);
        html += this.detailRow('体质', base.con ?? 0);
        html += this.detailRow('精神', base.wis ?? 0);
        html += this.detailRow('幸运', base.luck ?? 0);
        html += `</div>`;
        html += `<div class="cd-section"><h4>战斗属性（怪物公式派生）</h4>`;
        html += this.detailRow('物理攻击', stats.atk);
        html += this.detailRow('物理防御', stats.def);
        html += this.detailRow('魔法攻击', stats.matk);
        html += this.detailRow('魔法防御', stats.mdef);
        html += this.detailRow('暴击率', stats.crit + '%');
        html += this.detailRow('暴击抵抗', stats.critRes + '%');
        html += `</div>`;
        if (ai.attackDamage !== undefined) {
            html += `<div class="cd-section"><h4>攻击参数</h4>`;
            html += this.detailRow(c.role === 'miner' ? '采矿伤害' : '攻击伤害', ai.attackDamage);
            html += this.detailRow('攻击间隔', `${ai.attackInterval}ms`);
            if (ai.attackRange) html += this.detailRow(ai.miningRange !== undefined && c.role === 'miner' ? '近战距离' : '射程', `${ai.attackRange}px`);
            if (ai.attackDamageFrame) html += this.detailRow('伤害判定帧', `第 ${ai.attackDamageFrame} 帧`);
            if (ai.attackLaunchFrame) html += this.detailRow('投射物出膛帧', `第 ${ai.attackLaunchFrame} 帧`);
            if (ai.projectileSpeed) html += this.detailRow('弹道速度', `${ai.projectileSpeed}px/s`);
            html += `</div>`;
        }
        if (c.desc) html += `<div class="cd-section"><h4>描述</h4><div class="cd-desc">${c.desc}</div></div>`;
        body.innerHTML = html;
    },

    openEquipDetail(itemName) {
        const item = this.getEquipByName(itemName);
        if (!item) return;
        this.detailItem = item;
        const title = getElement('codexDetailTitle');
        if (title) title.textContent = item.name;
        this.renderEquipDetail(item);
        this._openDetailShell();
    },

    openMonsterDetail(monsterId) {
        const item = this.getMonsterById(monsterId);
        if (!item) return;
        this.detailItem = item;
        const title = getElement('codexDetailTitle');
        if (title) title.textContent = item.name;
        this.renderMonsterDetail(item);
        this._openDetailShell();
    },

    closeDetail() {
        this.detailItem = null;
        const body = getElement('codexDetailBody');
        const title = getElement('codexDetailTitle');
        const wrapper = getElement('codexWrapper');
        if (wrapper) wrapper.classList.remove('is-detail-open');
        if (body) body.innerHTML = '<div class="codex-empty-state">从左侧选择条目查看档案详情</div>';
        if (title) title.textContent = '详情';
    },

    _openDetailShell() {
        const wrapper = getElement('codexWrapper');
        if (wrapper) wrapper.classList.add('is-detail-open');
        const body = getElement('codexDetailBody');
        if (body) body.scrollTop = 0;
    },

    renderEquipDetail(item) {
        const body = getElement('codexDetailBody');
        if (!body) return;

        // 从 ItemDatabase 实时获取最新数据
        const liveItem = this._getLiveEquipData(item);
        const d = liveItem || item;

        const rarityClass = d.rarity || 'common';
        const rarityLabel = getRarityLabel(d.rarity);
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
            // 散布参数（2026-08-19 硬编码清除）：spreadParams 为逐武器真源（半自动同样有
            // 爬升参数，与全自动同口径展示）；独头弹逐层散布走 weapon-fx-config 真源。
            // 原 '+5°' / '500ms' 两行无任何数据源支撑（纯展示硬编码），已移除。
            if (d.spreadParams) {
                html += this.detailRow('射击散布开始时间', this._getSpreadStart(d));
                html += this.detailRow('达到最大散布时间', this._getSpreadMax(d));
                html += this.detailRow('最大散布角度', this._getSpreadAngle(d));
            }
            if (d.weaponType === 'shotgun') {
                const perLayer = WEAPON_FX_CONFIG.shotgun && WEAPON_FX_CONFIG.shotgun.slugRecoilAnglePerLayer;
                if (perLayer !== undefined) html += this.detailRow('独头弹每层散布增加', `+${perLayer}°`);
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
            // 装备属性：数据驱动（stats 数组来自 equipment.json / ItemDatabase，禁止硬编码）
            if (d.stats && d.stats.length) {
                html += `<div class="cd-section"><h4>属性</h4>`;
                for (const s of d.stats) {
                    if (!s) continue;
                    const statName = s.label || s.name;
                    const statVal = s.value !== undefined && s.value !== null ? s.value : '';
                    if (!statName && !statVal) continue;
                    html += this.detailRow(statName, statVal);
                }
                html += `</div>`;
            }
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

    // 获取攻击力公式文本（委托 attack-formula.js 唯一实现：buildFormulaDisplay el=0 口径）
    _getAtkFormula(item) {
        return (item && item.attackFormula) ? buildFormulaDisplay(item.attackFormula, 0) : '';
    },

    // 获取武器强化后攻击力公式（委托 attack-formula.js 唯一实现）
    _getEnhancedAtkFormula(item) {
        if (!item || !item.attackFormula) {
            const baseFormula = this._getAtkFormula(item);
            if (!baseFormula) return '';
            // 与 getAttackFormula 回退口径一致：enhanceFlat 1（无 attackFormula 武器强化 +1/级）
            return `(${baseFormula}) + 强化等级×1`;
        }
        return buildEnhancedFormulaDisplay(item.attackFormula);
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

        const liveData = (item.id && this.monsterDatabase[item.id]) ? this.monsterDatabase[item.id] : {};
        const d = { ...item, ...liveData };
        const stats = CodexFormulaHelper.calculateCombatStats(d);
        const combatLevel = CodexFormulaHelper.calculateCombatLevelBreakdown(d);
        const movement = CodexFormulaHelper.calculateEffectiveSpeed(d);

        let html = '';
        const iconHtml = this._renderCodexIcon(d, 64);
        // 家族标签
        const familyTags = getEnemyFamilies(d)
            .map(family => `<span class="cd-family-tag">${this._escapeHtml(family)}类</span>`)
            .join('');
        html += `<div class="cd-hero">
            <div class="cd-hero-icon">${iconHtml}</div>
            <div class="cd-hero-info">
                <div class="cd-hero-name">${this._escapeHtml(d.name || '-')}${familyTags}</div>
                <div class="cd-hero-type">${this._escapeHtml(d.type || '怪物')} · ${d.category === 'monster' ? '怪物' : '敌人'}</div>
                <span class="cd-hero-rarity common">${this._escapeHtml(d.type || '普通')}</span>
            </div>
        </div>`;
        html += '<div class="codex-data-source"><span>DATA</span> enemy-config.json · combat-formulas.json · combat-config.json</div>';

        // 基本信息
        html += `<div class="cd-section"><h4>基本信息</h4>`;
        html += this.detailRow('名称', d.name);
        html += this.detailRow('类型', d.type);
        html += this.detailRow('配置等级（成长/经验）', d.level ?? 1);
        html += this.detailRow('综合战斗等级', stats.combatLevel);
        html += this.detailRow(
            '战斗等级构成',
            `基础 ${combatLevel.baseScore.toFixed(1)} + 六维 ${combatLevel.attributeScore.toFixed(1)} + 生命 ${combatLevel.hpScore.toFixed(1)} + 移速 ${combatLevel.speedScore.toFixed(1)} + 阶级 ${combatLevel.rankBonus.toFixed(1)}`
        );
        html += this.detailRow('生命值', `${d.hp ?? 0} / ${d.maxHp ?? d.hp ?? 0}`);
        html += this.detailRow('经验结算', '按位面、阶级与等级差动态结算');
        if (d.render?.collisionWidth && d.render?.collisionHeight) {
            html += this.detailRow('碰撞体积', `${d.render.collisionWidth}×${d.render.collisionHeight}px`);
        } else if (d.collisionRadius) {
            html += this.detailRow('碰撞半径', `${d.collisionRadius}px`);
        }
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

        const ignoredConfigRows = [];
        if (d.def != null && Number(d.def) !== stats.def) ignoredConfigRows.push(['def', d.def, stats.def]);
        if (d.crit != null && Number(d.crit) !== stats.crit) ignoredConfigRows.push(['crit', d.crit, stats.crit]);
        if (d.critRes != null && Number(d.critRes) !== stats.critRes) ignoredConfigRows.push(['critRes', d.critRes, stats.critRes]);
        if (d.expValue != null) ignoredConfigRows.push(['expValue', d.expValue, '动态结算']);
        if (ignoredConfigRows.length) {
            html += `<details class="cd-config-warning"><summary><span>配置兼容提示</span><span>${ignoredConfigRows.length} 项旧字段</span></summary><div class="cd-config-warning-body"><div class="cd-config-note">下列旧字段当前不会直接覆盖怪物运行时结果；图鉴以实际运行时口径为准。</div>`;
            for (const [key, configured, runtime] of ignoredConfigRows) {
                html += this.detailRow(`${key} 配置值`, `${configured}（运行时 ${runtime}）`);
            }
            html += '</div></details>';
        }

        // 战斗属性（使用与运行时一致的公式，避免硬编码）
        html += `<div class="cd-section"><h4>战斗属性</h4>`;
        const attackType = (d.attack && d.attack.damageType) || 'physical';
        const normalDamage = attackType === 'magic' ? stats.matk : stats.atk;
        const hitDistance = d.attackDistance ?? d.attack?.range ?? d.attackRange;
        const attackCooldown = d.attackCooldown ?? d.attack?.cooldown;
        const knockback = d.attack?.knockback ?? d.knockback ?? 0;
        html += this.detailRow('物理攻击', stats.atk);
        html += this.detailRow('物理防御', stats.def);
        html += this.detailRow('魔法攻击', stats.matk);
        html += this.detailRow('魔法防御', stats.mdef);
        html += this.detailRow('暴击率', stats.crit + '%');
        html += this.detailRow('暴击抵抗', stats.critRes + '%');
        html += this.detailRow('AI 交战距离', `${d.attackRange ?? 0}px`);
        html += this.detailRow('命中判定距离', hitDistance != null ? `${hitDistance}px` : '由技能配置决定');
        html += this.detailRow('普攻冷却', attackCooldown != null ? `${attackCooldown}ms` : '由技能配置决定');
        html += this.detailRow('攻击方式', d.attackType || '-');
        html += this.detailRow(attackType === 'magic' ? '普攻魔法伤害' : '普攻物理伤害', normalDamage);
        html += this.detailRow('击退', knockback ? `${knockback}px` : '无');
        if (d.rangedDamageReduction) html += this.detailRow('远程物理减伤', `${Math.round(d.rangedDamageReduction * 100)}%`);
        html += `</div>`;

        // 移动属性
        html += `<div class="cd-section"><h4>移动属性</h4>`;
        html += this.detailRow('常规有效移速', movement.speed);
        if (movement.configuredSpeed !== movement.speed) {
            html += this.detailRow('配置基础移速', `${movement.configuredSpeed}（全局 ×${movement.globalMultiplier}）`);
        }
        html += this.detailRow('体型', `${d.size ?? 0}px`);
        html += `</div>`;

        // 特殊机制说明来自配置；数值参数另行读取 attackSkills，避免说明文本随数值调整后失真。
        const mechanics = [];
        if (d.skills && d.skills.length > 0) {
            for (const skill of d.skills) mechanics.push(skill);
        }
        if (d.transform) {
            const t = d.transform;
            const parts = [];
            if (t.hpThreshold) parts.push(`生命值低于 ${Math.round(t.hpThreshold * 100)}% 时变身`);
            if (t.damageMultiplier) parts.push(`伤害提升 ${Math.round((t.damageMultiplier - 1) * 100)}%`);
            if (t.statMultiplier) parts.push(`全属性提升 ${Math.round((t.statMultiplier - 1) * 100)}%`);
            if (t.hpRecover) parts.push('恢复生命值');
            if (t.healToFull) parts.push('恢复至满生命值');
            if (t.damageReduction) parts.push(`变身期间减伤 ${Math.round(t.damageReduction * 100)}%`);
            if (t.criticalChance && t.criticalDamageMultiplier) {
                parts.push(`${Math.round(t.criticalChance * 100)}% 暴击造成 ${t.criticalDamageMultiplier} 倍伤害`);
            }
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
            html += `<div class="cd-section"><h4>机制说明</h4>`;
            for (const m of mechanics) {
                html += this.detailRow(m.name, m.desc);
            }
            html += `</div>`;
        }

        html += this._renderMonsterConfigParameters(d.attackSkills);

        if (d.description) html += `<div class="cd-section"><h4>描述</h4><div class="cd-desc">${this._escapeHtml(d.description)}</div></div>`;
        body.innerHTML = html;
    },

    _renderMonsterConfigParameters(attackSkills) {
        if (!attackSkills || typeof attackSkills !== 'object') return '';
        const cards = Object.entries(attackSkills).map(([skillKey, config]) => {
            const rows = this._flattenConfigParameters(config);
            if (!rows.length) return '';
            const rowHtml = rows.map(([path, value]) => this.detailRow(this._configLabel(path), this._formatConfigValue(path, value))).join('');
            return `<details class="cd-config-skill">
                <summary><span>${this._escapeHtml(this._configSkillLabel(skillKey))}</span><span>${rows.length} 项实时参数</span></summary>
                <div class="cd-config-skill-body">${rowHtml}</div>
            </details>`;
        }).join('');
        if (!cards) return '';
        return `<div class="cd-section cd-config-section"><h4>技能配置参数</h4><div class="cd-config-note">以下数值直接读取 enemy-config.json；调整配置并重新载入游戏后会同步更新。</div>${cards}</div>`;
    },

    _flattenConfigParameters(value, prefix = '', depth = 0) {
        if (!value || typeof value !== 'object' || depth > 3) return [];
        const rows = [];
        for (const [key, child] of Object.entries(value)) {
            if (key === 'comment' || child == null || Array.isArray(child)) continue;
            const path = prefix ? `${prefix}.${key}` : key;
            if (typeof child === 'object') rows.push(...this._flattenConfigParameters(child, path, depth + 1));
            else if (['string', 'number', 'boolean'].includes(typeof child)) rows.push([path, child]);
        }
        return rows;
    },

    _configSkillLabel(skillKey) {
        const labels = {
            howl: '嚎叫', corrosionAura: '腐蚀毒域', slam: '砸击', lantern: '提灯', whip: '鞭击',
            spawn: '召唤', throw: '投掷', summon: '召唤增援', combo: '连击', charge: '冲锋', block: '格挡',
            hammer: '重锤', grandSlam: '强力砸击', forms: '姿态', shoot: '射击', flashbang: '闪光弹',
            axe: '战斧', bash: '盾击', defend: '防御', spit: '喷吐', magic: '远程魔法', venom: '毒液瓶',
            bottle: '毒液泼洒', poisonOnHit: '毒牙', venomSpray: '紫雾毒液喷射',
            corrosionOnHit: '腐蚀撕咬'
        };
        return labels[skillKey] || skillKey;
    },

    _configLabel(path) {
        const key = path.split('.').pop();
        const labels = {
            cooldown: '冷却', duration: '持续时间', intervalMs: '间隔', range: '范围', radius: '半径',
            damageMultiplier: '伤害倍率', damageMul: '伤害倍率', speedMul: '移速倍率', attackSpeedMul: '攻速倍率',
            atkMul: '物攻倍率', buffDuration: '增益持续', frames: '动画帧数',
            hpThreshold: '生命阈值', hitFrame: '命中帧', launchFrame: '发射帧', knockback: '击退', count: '数量',
            stacks: '叠加层数', poisonStacks: '中毒层数', triggerRange: '触发范围', arcDegrees: '扇形角度',
            releaseFrame: '释放帧', releaseSourceFrame: '视频源帧', frameCount: '动画帧数',
            initialCooldownMs: '初始冷却', effectDurationMs: '毒雾持续', particleCount: '粒子数量',
            damage: '伤害', width: '宽度', height: '高度', deathAnimMs: '死亡动画时长',
            corpseDuration: '尸体毒域持续', corpseWidth: '尸体毒域宽度', corpseHeight: '尸体毒域高度',
            corpseOffsetY: '尸体毒域纵向偏移', durationMs: '持续时间',
            defenseReductionPerStack: '每层物理减防'
        };
        const label = labels[key] || key;
        return path.includes('.') ? `${path.slice(0, path.lastIndexOf('.'))} · ${label}` : label;
    },

    _formatConfigValue(path, value) {
        if (typeof value === 'boolean') return value ? '是' : '否';
        if (typeof value !== 'number') return value;
        const key = path.split('.').pop();
        if (/(Ms|cooldown|duration|interval|delay|timeout|windup|recover|hold)$/i.test(key)) return `${value}ms`;
        if (key === 'defenseReductionPerStack' && value >= 0 && value <= 1) return `${value * 100}%`;
        if (/(Multiplier|Mul)$/i.test(key)) return `×${value}`;
        if (/(Chance|Threshold)$/i.test(key) && value >= 0 && value <= 1) return `${Math.round(value * 10000) / 100}%`;
        if (/Degrees$/i.test(key)) return `${value}°`;
        if (/(Range|Radius|Distance|Width|Height|Knockback)$/i.test(key)) return `${value}px`;
        if (/Frame$/i.test(key)) return `第 ${value} 帧`;
        return value;
    },

    /**
     * 渲染图鉴图标：若 idle 是 spritesheet，则只截取第一帧并放大显示
     */
    _renderCodexIcon(d, size) {
        if (!d.idleTexture) {
            return `<div class="codex-icon-missing" style="width:${size}px;height:${size}px" title="缺少图鉴贴图" aria-label="缺少图鉴贴图">缺图</div>`;
        }
        const isSheet = d.idleFrameWidth && d.idleSheetColumns && d.idleSheetColumns > 0;
        if (!isSheet) {
            return `<img src="${d.idleTexture}" style="width:${size}px;height:${size}px;object-fit:contain;filter:drop-shadow(0 0 4px ${d.color || '#8a4a4a'});" alt="">`;
        }
        // 只显示 spritesheet 第一帧：按列数缩放，使单帧填满容器
        const fw = d.idleFrameWidth;
        const scale = size / fw;
        const bgW = fw * d.idleSheetColumns * scale;
        return `<div style="width:${size}px;height:${size}px;background-image:url('${d.idleTexture}');background-repeat:no-repeat;background-size:${bgW}px auto;background-position:0 0;filter:drop-shadow(0 0 4px ${d.color || '#8a4a4a'});" title=""></div>`;
    },

    detailRow(label, value, cls = '') {
        const safeClass = String(cls || '').replace(/[^a-z0-9_-]/gi, '');
        const displayValue = value !== undefined && value !== null ? value : '-';
        return `<div class="cd-stat-row"><span class="cd-stat-label">${this._escapeHtml(label)}</span><span class="cd-stat-val ${safeClass}">${this._escapeHtml(displayValue)}</span></div>`;
    },
    _escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[char]);
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
