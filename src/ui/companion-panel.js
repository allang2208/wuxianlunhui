// ============================================================
// 队员面板（CompanionPanel，2026-08-12 框架）
// 需求：右侧栏目位置，全面复制玩家单位——属性栏 / 背包装备栏 / 技能栏；
//       队员背包打开时同步打开玩家背包；玩家背包/装备栏可拖入队员背包。
// 技能栏框架阶段为占位符（后续按指令添加技能）。
// ============================================================

import { PartySystem } from '../systems/party-system.js';
import { EventBus } from '../core/event-bus.js';
import { renderSkillList } from '../systems/skill-system.js';
import { RecruitUI } from './recruit-ui.js';
import { EquipTooltipManager } from './equip-tooltip-manager.js';
import { RARITY_LABELS } from '../config/rarity.js';
import { getConsumableEffect } from '../config/consumable.js';

// 玩家系统面板同款装备槽（15 槽，与 hud-panels-system-tabs.js equipSlots 完全一致）
const EQUIP_SLOTS = [
    ['earring', '左耳环'], ['helmet', '头盔'], ['ring1', '右耳环'], ['gloves', '手套'], ['necklace', '项链'],
    ['cloak', '披风'], ['weapon', '主手武器1'], ['armor', '盔甲'], ['offhand', '副手武器1'], ['weapon2', '主手武器2'],
    ['belt', '腰带'], ['ring2', '副手武器2'], ['extra', '额外物品'], ['boots', '靴子'], ['backpack', '背包装备'],
];

export const CompanionPanel = {
    _overlay: null,
    _memberId: null,
    _currentTab: 'status',

    open(companionId) {
        this._memberId = companionId;
        this._ensureElement();
        this._render();
        this._show();
        this._hideSideMenu();
    },

    /** 队员管理入口：打开面板并选中第一名队员（无队员显示空状态+招募） */
    openManage() {
        this._ensureElement();
        const first = PartySystem.members[0];
        this._memberId = first ? first.id : null;
        this._render();
        this._show();
        this._hideSideMenu();
    },

    close() {
        if (!this._overlay) return;
        // 与原生背包一致：先滑出动画，动画结束后隐藏
        const panel = this._overlay.querySelector('.companion-system-panel');
        const pack = this._overlay.querySelector('#companionPlayerPack');
        if (panel) panel.classList.remove('active');
        if (pack) pack.classList.remove('pack-active');
        clearTimeout(this._closeTimer);
        this._closeTimer = setTimeout(() => {
            if (this._overlay) this._overlay.style.display = 'none';
        }, 260);
        this._restoreSideMenu();
    },

    /** 显示（滑入动画：下一帧加 .active，与 .system-panel 原生动画同机制） */
    _show() {
        // 防止 close 的滑出定时器在快速重开时把 overlay 隐藏
        clearTimeout(this._closeTimer);
        this._overlay.style.display = 'block';
        const panel = this._overlay.querySelector('.companion-system-panel');
        const pack = this._overlay.querySelector('#companionPlayerPack');
        requestAnimationFrame(() => {
            if (panel) panel.classList.add('active');
            if (pack && pack.style.display === 'flex') pack.classList.add('pack-active');
        });
    },

    /** 打开时隐藏右侧侧边菜单（面板与 side-menu 同侧，避免重叠） */
    _hideSideMenu() {
        document.querySelectorAll('.side-menu').forEach(m => { m.style.display = 'none'; });
    },

    _restoreSideMenu() {
        document.querySelectorAll('.side-menu').forEach(m => { m.style.display = ''; });
    },

    _ensureElement() {
        if (this._overlay) return;
        const overlay = document.createElement('div');
        overlay.id = 'companionOverlay';
        overlay.className = 'companion-overlay';
        overlay.innerHTML = `
            <div class="companion-player-pack" id="companionPlayerPack">
                <!-- 与右侧 headbar+panel-tabs 等高占位，保证两侧装备栏/背包分界线水平对齐 -->
                <div class="companion-player-head">🎒 玩家装备背包</div>
                <!-- 与右侧队员面板 gear-layout 同构：装备栏 50% + 背包，水平位置对齐 -->
                <div class="gear-layout companion-player-gear">
                    <div class="gear-equip-col companion-player-equip-col">
                        <div class="gear-col-title">装备栏</div>
                        <div class="equip-grid companion-player-equip-grid" id="companionPlayerEquipGrid"></div>
                    </div>
                    <div class="gear-inventory-col companion-player-inv-col">
                        <div class="inventory-header"><span>背包</span><span id="companionPlayerCount"></span></div>
                        <div class="companion-player-grid" id="companionPlayerGrid"></div>
                    </div>
                </div>
            </div>
            <div class="system-panel companion-system-panel" id="companionSystemPanel">
                <div class="companion-headbar" id="companionHeadbar"></div>
                <div class="panel-tabs">
                    <div class="panel-tab active" data-tab="status">状态</div>
                    <div class="panel-tab" data-tab="equip">装备背包</div>
                    <div class="panel-tab" data-tab="skill">技能</div>
                </div>
                <div class="tab-page active" data-page="status" id="tab-status"></div>
                <div class="tab-page" data-page="equip" id="tab-equip"></div>
                <div class="tab-page" data-page="skill" id="tab-skill"></div>
            </div>
        `;
        overlay.querySelectorAll('.panel-tab').forEach(tab => {
            tab.onclick = () => {
                this._currentTab = tab.dataset.tab;
                overlay.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t === tab));
                overlay.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.dataset.page === tab.dataset.tab));
                this._renderBody();
            };
        });
        // 关闭按钮（headbar 里动态渲染，但面板空白处点击关闭也可）
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.close();
        });
        document.getElementById('gameContainer').appendChild(overlay);
        this._overlay = overlay;
        // 队员背包 → 玩家背包（EventBus 桥接，避免 drag-drop-manager ↔ 本模块循环依赖）
        EventBus.on('companion:moveToPlayerBackpack', this._onCompanionMoveToPlayer.bind(this));
        // 打开玩家背包/其他系统面板时关闭组队面板（system-ui / expedition 等 emit 'ui:panel-open'）
        EventBus.on('ui:panel-open', () => {
            if (this._overlay && this._overlay.style.display === 'block') this.close();
        });
        // 队伍变化时刷新（如队员升级）
        PartySystem.onChange(() => {
            if (!this._overlay || this._overlay.style.display !== 'block') return;
            // 空状态加入队员后自动选中第一名（否则 _memberId 仍为 null，面板继续显示"暂无侍从"）
            if (!this._member() && PartySystem.members.length) {
                this._memberId = PartySystem.members[0].id;
            }
            this._render();
        });
    },

    _member() {
        return PartySystem.getMember(this._memberId);
    },

    _render() {
        const m = this._member();
        this._renderHeadbar(m);
        if (!m) {
            // 空状态：暂无队员 + 招募入口
            this._hidePlayerPack();
            const statusTab = this._overlay.querySelector('#tab-status');
            statusTab.innerHTML = `
                <div class="companion-empty">
                    <div class="companion-empty-text">还没有侍从加入队伍</div>
                    <button class="companion-empty-recruit">🔍 寻找帮手</button>
                </div>`;
            const recruitBtn = statusTab.querySelector('.companion-empty-recruit');
            if (recruitBtn) recruitBtn.onclick = () => RecruitUI.open();
            return;
        }
        this._renderBody();
    },

    /** 头部栏：成员切换 chips + 当前队员信息 + 移出/关闭（system-panel 顶部） */
    _renderHeadbar(m) {
        const bar = this._overlay.querySelector('#companionHeadbar');
        if (!bar) return;
        const members = PartySystem.members;
        const chips = members.map(mm => `
            <div class="companion-member-chip ${m && mm.id === m.id ? 'active' : ''}" data-cid="${mm.id}" title="${mm.name} · ${mm.title}">
                <span class="companion-chip-avatar">${mm.avatar}</span>
                <span class="companion-chip-name">${mm.name}</span>
                <span class="companion-chip-level">Lv.${mm.data.level}</span>
            </div>`).join('');
        bar.innerHTML = `
            <div class="companion-headbar-chips">${chips || '<span class="companion-headbar-empty">暂无侍从</span>'}</div>
            ${m ? `<div class="companion-headbar-info"><span class="companion-headbar-avatar">${m.avatar}</span><span class="companion-headbar-name">${m.name}</span><span class="companion-title">${m.title}</span><span class="companion-headbar-level">Lv.${m.data.level}</span><span class="companion-headbar-exp">经验 ${m.data.exp}/${m.data.maxExp}</span></div>` : ''}
            ${m ? '<button class="companion-remove" title="移出队伍">移出</button>' : ''}
            <button class="companion-close">✕</button>
        `;
        bar.querySelector('.companion-close').onclick = () => this.close();
        if (m) bar.querySelector('.companion-remove').onclick = () => { PartySystem.removeCompanion(m.id); this.close(); };
        bar.querySelectorAll('[data-cid]').forEach(chip => {
            chip.onclick = () => {
                this._memberId = chip.dataset.cid;
                this._render();
            };
        });
    },

    _renderBody() {
        const m = this._member();
        if (!m) return;
        const statusTab = this._overlay.querySelector('#tab-status');
        const equipTab = this._overlay.querySelector('#tab-equip');
        const skillTab = this._overlay.querySelector('#tab-skill');
        if (this._currentTab === 'status') {
            statusTab.innerHTML = this._statusHtml(m);
            this._hidePlayerPack();
        } else if (this._currentTab === 'equip') {
            equipTab.innerHTML = this._equipPageHtml(m);
            this._bindEquipPage(m);
            // 打开队员背包时同步弹出玩家背包界面（贴合在队员背包栏左侧）
            this._renderPlayerPack();
        } else {
            skillTab.innerHTML = this._skillHtml(m);
            this._hidePlayerPack();
        }
    },

    /** 装备页：玩家系统面板同款 gear-layout（上方装备栏 3×5 网格 + 下方背包） */
    _equipPageHtml(m) {
        const slotsHtml = EQUIP_SLOTS.map(([key, label]) => `
            <div class="companion-diablo-slot" data-slot="${key}">
                <div class="slot-icon" data-default=""></div>
                <div class="slot-rarity" data-default=""></div>
                <div class="slot-name" data-default="${label}">${label}</div>
            </div>`).join('');
        let packCells = '';
        for (let i = 0; i < m.maxBackpackSlots; i++) {
            const item = m.backpack.find(b => b.slot === i);
            packCells += `<div class="companion-cell" data-slot="${i}" ${item ? 'draggable="true"' : ''} title="${item ? '双击装备 · 拖到玩家背包交换' : ''}">${item ? item.name : ''}</div>`;
        }
        // 消耗品使用设置（2026-08-15）：低 HP/MP 比例自动用药，默认低级→高级
        const cs = m.consumableSettings || {};
        const csItems = (m.backpack || [])
            .filter(b => b && b.category === 'consumable')
            .map(b => {
                const eff = getConsumableEffect(b);
                const parts = [];
                if (eff && eff.hp) parts.push(`HP+${eff.hp}`);
                if (eff && eff.mp) parts.push(`MP+${eff.mp}`);
                return `${b.icon || '🧪'} ${b.name}${parts.length ? `（${parts.join(' ')}）` : ''} ×${b.stack || 1}`;
            })
            .join('<br>');
        return `
            <div class="gear-layout">
                <div class="gear-equip-col">
                    <div class="gear-col-title">装备栏${m.equipNote ? `<span class="companion-equip-note">${m.equipNote}</span>` : ''}</div>
                    <div class="companion-equip-grid">${slotsHtml}</div>
                </div>
                <div class="gear-inventory-col">
                    <div class="inventory-header"><span>背包</span><span id="companionInvCount">${m.backpack.length}/${m.maxBackpackSlots}</span>
                        <button class="consumable-settings-btn" type="button" data-action="toggle-consumable-settings">⚙️ 消耗品设置</button>
                    </div>
                    <div class="companion-pack-grid" id="companionPackGrid">${packCells}</div>
                    <div class="consumable-settings" id="companionConsumableSettings" style="display:none">
                        <div class="cs-title">消耗品使用设置</div>
                        <label class="cs-row"><input type="checkbox" id="csEnabled" ${cs.enabled !== false ? 'checked' : ''}> 自动使用恢复药水</label>
                        <label class="cs-row">生命低于 <input type="number" id="csHp" min="1" max="99" value="${Math.round((cs.hpThreshold ?? 0.3) * 100)}"> % 时使用生命药水</label>
                        <label class="cs-row">魔法低于 <input type="number" id="csMp" min="1" max="99" value="${Math.round((cs.mpThreshold ?? 0.25) * 100)}"> % 时使用魔力药水</label>
                        <div class="cs-row cs-items">背包消耗品（按低级→高级使用）：<br>${csItems || '（无）'}</div>
                        <button class="cs-save" type="button" id="csSave">保存</button>
                    </div>
                </div>
            </div>`;
    },

    /** 填充装备槽（与玩家 updateEquipSlots 同格式：图标/稀有度竖条/名字） */
    _renderEquipSlots(m) {
        this._overlay.querySelectorAll('.companion-diablo-slot').forEach(slot => {
            const key = slot.dataset.slot;
            const item = m.equipments[key];
            const iconEl = slot.querySelector('.slot-icon');
            const nameEl = slot.querySelector('.slot-name');
            const rarityEl = slot.querySelector('.slot-rarity');
            slot.classList.toggle('equipped', !!item);
            if (item) {
                const imgSrc = item.slotImage || item.iconImage;
                nameEl.textContent = item.name;
                const rarityKey = item.rarity || 'common';
                rarityEl.textContent = RARITY_LABELS[rarityKey] || rarityKey;
                rarityEl.className = 'slot-rarity rarity-' + rarityKey;
                if (imgSrc) {
                    iconEl.innerHTML = `<img src="${imgSrc}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${item.icon || '❓'}';">`;
                } else {
                    iconEl.textContent = item.icon || '⚔';
                }
            } else {
                iconEl.innerHTML = '';
                nameEl.textContent = nameEl.dataset.default || '';
                rarityEl.textContent = '';
                rarityEl.className = 'slot-rarity';
            }
        });
    },

    /**
     * 玩家背包栏：与队员背包并排（左侧紧贴）。
     * 完全复刻玩家背包格渲染（与 slot-renderer.updateInventorySlots 同格式）：
     *   .inv-cell + inv-rarity 稀有度竖条 + 已强化/已改造/已附魔标签 + 图标 + inv-name + inv-stack
     * 复用 .inv-cell 类 → tooltip（bindInventoryTooltip 按 data-slot 解析）自动生效；
     * 容器用 .companion-player-grid（不用 .inventory-grid，避免 updateInventorySlots 全局索引错位）；
     * 格子只作拖拽源（dragstart 写 EquipManager._dragDropManager._dragSrc，与玩家背包格同口径）。
     */
    _renderPlayerPack() {
        const pack = this._overlay.querySelector('#companionPlayerPack');
        if (!pack) return;
        clearTimeout(this._packHideTimer);
        pack.style.display = 'flex';
        requestAnimationFrame(() => pack.classList.add('pack-active'));
        this._syncPlayerPackHook();
        const panel = this._overlay.querySelector('.companion-system-panel');
        if (panel) panel.classList.add('with-pack');
        const Game = window.Game;
        const eq = Game && Game.EquipManager;
        // ===== 玩家装备栏：与玩家系统面板同款（15 槽 .diablo-slot，复用玩家渲染器填充） =====
        const equipGrid = this._overlay.querySelector('#companionPlayerEquipGrid');
        if (equipGrid && equipGrid.children.length === 0) {
            for (const [key, label] of EQUIP_SLOTS) {
                const slot = document.createElement('div');
                slot.className = 'diablo-slot';
                slot.dataset.slot = key;
                slot.innerHTML = `<div class="slot-icon" data-default=""></div>
                    <div class="slot-rarity" data-default=""></div>
                    <div class="slot-name" data-default="${label}">${label}</div>`;
                equipGrid.appendChild(slot);
            }
        }
        // 复用玩家渲染器：updateEquipSlots 遍历所有 .diablo-slot 填充玩家装备（含本栏）
        if (eq && typeof eq.updateEquipSlots === 'function') eq.updateEquipSlots();
        // 玩家装备栏槽可拖出（拖到右侧队员装备槽/背包，dragSrc type='equip'）
        if (equipGrid) {
            equipGrid.querySelectorAll('.diablo-slot').forEach(slot => {
                slot.draggable = !!Game.player.equipments[slot.dataset.slot];
                slot.ondragstart = (e) => {
                    const ddm = eq && eq._dragDropManager;
                    if (ddm) ddm._dragSrc = { type: 'equip', slot: slot.dataset.slot };
                    e.dataTransfer.setData('text/plain', slot.dataset.slot);
                    e.dataTransfer.effectAllowed = 'move';
                };
            });
        }
        // 玩家装备栏 tooltip（bindEquipTooltip 按 .diablo-slot 遍历，本栏自动绑定）
        try { EquipTooltipManager.bindEquipTooltip(); } catch (_err) { /* 忽略 */ }

        // ===== 玩家背包格（复用玩家背包渲染格式，只作拖拽源） =====
        const grid = this._overlay.querySelector('#companionPlayerGrid');
        const items = (eq && eq.backpackItems) || [];
        const maxSlots = (eq && eq.maxBackpackSlots) || 10;
        grid.innerHTML = '';
        const count = this._overlay.querySelector('#companionPlayerCount');
        if (count) count.textContent = `${items.length}/${maxSlots}`;
        const cells = [];
        for (let i = 0; i < maxSlots; i++) {
            const item = items.find(it => it.slot === i);
            const cell = document.createElement('div');
            cell.className = 'inv-cell';
            cell.dataset.slot = i;
            cell.draggable = !!item;
            if (item) {
                // ===== 与 updateInventorySlots 完全同格式 =====
                cell.classList.add('occupied');
                cell.dataset.dragType = 'inventory';
                cell.dataset.dragId = item.itemId || i;
                cell.dataset.itemName = item.name;
                const imgSrc = item.slotImage || item.iconImage;
                const rarityKey = item.rarity || 'common';
                const rarityLabel = RARITY_LABELS[rarityKey] || rarityKey;
                const enhancedTag = (item.enhanceLevel || 0) > 0 ? '<div class="inv-enhanced">已强化</div>' : '';
                const isCrafted = item._isCrafted || (item._craftData && Object.keys(item._craftData).length > 0);
                const craftedTag = isCrafted ? '<div class="inv-crafted">已改造</div>' : '';
                const isEnchanted = item._isEnchanted || (item._enchantData && (item._enchantData.prefix || item._enchantData.suffix));
                const enchantedTag = isEnchanted ? '<div class="inv-enchanted">已附魔</div>' : '';
                if (imgSrc) {
                    cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div>${enhancedTag}${craftedTag}${enchantedTag}<img src="${imgSrc}" draggable="false" ondragstart="return false;" style="width:32px;height:32px;object-fit:cover;pointer-events:none;border-radius:4px;user-select:none;-webkit-user-drag:none;"><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack" style="pointer-events:none;user-select:none;">${item.stack}</span>` : ''}`;
                } else {
                    cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div>${enhancedTag}${craftedTag}${enchantedTag}<span style="pointer-events:none;user-select:none;">${item.icon || '❓'}</span><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack" style="pointer-events:none;user-select:none;">${item.stack}</span>` : ''}`;
                }
            }
            grid.appendChild(cell);
            cells.push(cell);
        }
        // 拖拽源（只作源，不作放置目标——放目标由右侧队员背包/装备槽承担）
        cells.forEach(cell => {
            if (!cell.draggable) return;
            cell.ondragstart = (e) => {
                const ddm = eq && eq._dragDropManager;
                if (ddm) ddm._dragSrc = { type: 'inventory', slot: parseInt(cell.dataset.slot, 10) };
                e.dataTransfer.setData('text/plain', cell.dataset.slot);
                e.dataTransfer.effectAllowed = 'move';
            };
            cell.ondragend = () => {
                const ddm = eq && eq._dragDropManager;
                if (ddm) ddm._dragSrc = null;
            };
            // 接收队员背包物品拖回（companion-item 源 → 移到玩家背包对应格）
            cell.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('drag-over'); };
            cell.ondragleave = () => cell.classList.remove('drag-over');
            cell.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cell.classList.remove('drag-over');
                const companionData = e.dataTransfer.getData('text/companion-item');
                if (!companionData) return;
                try {
                    const parsed = JSON.parse(companionData);
                    EventBus.emit('companion:moveToPlayerBackpack', {
                        memberId: parsed.memberId,
                        slot: parsed.slot,
                        targetSlot: parseInt(cell.dataset.slot, 10),
                    });
                } catch (_err) { /* 忽略非法数据 */ }
            };
        });
        // tooltip：复用玩家背包的 tooltip 绑定（按 data-slot 解析物品，复制格自动生效）
        try {
            EquipTooltipManager.bindInventoryTooltip();
        } catch (_err) { /* tooltip 环境缺失时忽略 */ }
    },

    /**
     * 玩家背包数据同步：包装 EquipManager.updateInventorySlots——
     * 玩家系统面板任何背包操作（拖动/使用/装备/掉落）刷新后，
     * 若队员面板打开且处于装备背包 tab，同步刷新左侧玩家背包栏。
     */
    _syncPlayerPackHook() {
        if (this._invHookDone) return;
        const Game = window.Game;
        const eq = Game && Game.EquipManager;
        if (!eq || typeof eq.updateInventorySlots !== 'function') return;
        const orig = eq.updateInventorySlots;
        eq.updateInventorySlots = (...args) => {
            const ret = orig.apply(eq, args);
            // 队员面板打开且装备背包 tab：刷新左侧玩家背包栏（玩家装备栏由 updateEquipSlots 自动同步）
            if (this._overlay && this._overlay.style.display === 'block' && this._currentTab === 'equip') {
                try { this._renderPlayerPack(); } catch (_err) { /* 忽略刷新异常 */ }
            }
            return ret;
        };
        this._invHookDone = true;
    },

    _hidePlayerPack() {
        const pack = this._overlay.querySelector('#companionPlayerPack');
        if (!pack) return;
        // 与弹出动画一致：先滑出（移除 pack-active），动画结束后隐藏
        pack.classList.remove('pack-active');
        clearTimeout(this._packHideTimer);
        this._packHideTimer = setTimeout(() => {
            if (pack) pack.style.display = 'none';
        }, 260);
        const panel = this._overlay.querySelector('.companion-system-panel');
        if (panel) panel.classList.remove('with-pack');
    },

    /**
     * 属性页：全面复制玩家状态页格式（.status-page 结构，与 system 面板同款：
     * 状态条 / 基础属性 / 战斗属性 / 详细信息 / 侍从档案），数据取队员。
     */
    _statusHtml(m) {
        const d = m.data;
        const bar = (label, cls, val, pct) => `
            <div class="status-bar">
                <span class="bar-label">${label}</span>
                <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
                <span class="status-value">${val}</span>
            </div>`;
        const item = (name, val) => `
            <div class="attr-item"><span class="attr-name">${name}</span><span class="attr-val">${val}</span></div>`;
        const hpPct = d.maxHp ? (d.hp / d.maxHp * 100) : 0;
        const mpPct = d.maxMp ? (d.mp / d.maxMp * 100) : 0;
        const expPct = d.maxExp ? Math.min(100, d.exp / d.maxExp * 100) : 0;
        const stamPct = d.maxStamina ? (d.stamina / d.maxStamina * 100) : 0;
        const baseAttrs = [
            ['力量', d.str], ['敏捷', d.dex], ['智力', d.int],
            ['体质', d.con], ['精神', d.wis], ['幸运', d.luck],
        ];
        const combatAttrs = [
            ['物理攻击', d.atk ?? 0], ['物理防御', d.def ?? 0],
            ['魔法攻击', d.matk ?? 0], ['魔法防御', 0],
            ['暴击率', '5%'], ['暴击抵抗', '0%'],
            ['攻击间隔', '400ms'], ['移动速度', '0px/s'],
        ];
        const detailAttrs = [
            ['体力恢复', '1/秒'], ['生命回复', '1/秒'], ['魔法回复', '1/3秒'],
            ['碰撞体积', '—'], ['移动速度', '—'], ['闪避冷却', '—'],
            ['攻击距离', '—'], ['击退距离', '—'], ['视野宽度', '—'],
        ];
        const infoAttrs = [
            ['成长规则', m.growthRule], ['武器类型', m.weaponType],
            ['角色定位', m.role], ['头像占位', m.avatar],
        ];
        const col1 = baseAttrs.slice(0, 3).map(([n, v]) => item(n, v)).join('');
        const col2 = baseAttrs.slice(3).map(([n, v]) => item(n, v)).join('');
        return `
            <div class="status-page">
                <h3 class="sp-title">${m.name} 状态</h3>
                <div class="status-char-layout">
                    <div class="status-header">
                        <span class="header-name">${m.name}</span>
                        <span class="header-class">${m.title}</span>
                        <span class="header-level">Lv.${d.level}</span>
                        <span class="header-attrpoints">成长:${m.growthRule}</span>
                    </div>
                    <div class="status-details">
                        <div class="status-section">
                            <h4>状态</h4>
                            ${bar('生命', 'hp', `${Math.ceil(d.hp)}/${d.maxHp}`, hpPct)}
                            ${bar('魔法', 'mp', `${Math.ceil(d.mp)}/${d.maxMp}`, mpPct)}
                            ${bar('体力', 'stamina', `${Math.ceil(d.stamina)}/${d.maxStamina}`, stamPct)}
                            ${bar('经验', 'exp', `${Math.floor(expPct)}%`, expPct)}
                        </div>
                        <div class="status-section">
                            <h4>基础属性</h4>
                            <div class="attr-list"><div class="attr-col">${col1}</div><div class="attr-col">${col2}</div></div>
                        </div>
                        <div class="status-section">
                            <h4>战斗属性</h4>
                            <div class="attr-list">${combatAttrs.map(([n, v]) => item(n, v)).join('')}</div>
                        </div>
                        <div class="status-section">
                            <h4>详细信息</h4>
                            <div class="attr-list">${detailAttrs.map(([n, v]) => item(n, v)).join('')}</div>
                        </div>
                        <div class="status-section">
                            <h4>侍从档案</h4>
                            <div class="attr-list">${infoAttrs.map(([n, v]) => item(n, v)).join('')}</div>
                        </div>
                        <div class="companion-note">经验：仅进入战斗时获取，与玩家同额、不设平分。</div>
                    </div>
                </div>
            </div>`;
    },

    _skillHtml(m) {
        // 通用技能列表渲染（与玩家同一套技能数据；当前配置 skills=[] → 占位）
        const wrap = document.createElement('div');
        wrap.className = 'companion-skill';
        renderSkillList(wrap, m.skills, { placeholder: '技能栏占位（后续按指令添加技能）' });
        return wrap.innerHTML;
    },

    _bindEquipPage(m) {
        this._renderEquipSlots(m);
        const cells = this._overlay.querySelectorAll('.companion-pack-grid .companion-cell');
        cells.forEach(cell => {
            // 双击装备（与玩家背包装备交互对齐）
            cell.ondblclick = () => {
                const slot = parseInt(cell.dataset.slot, 10);
                if (m.backpack.some(b => b.slot === slot)) {
                    m.equipFromBackpack(slot);
                    this._renderBody();
                }
            };
            // 拖回玩家背包：源标记（companion-item 由玩家背包格 drop 处理）
            cell.ondragstart = (e) => {
                e.dataTransfer.setData('text/companion-item', JSON.stringify({ memberId: m.id, slot: parseInt(cell.dataset.slot, 10) }));
                e.dataTransfer.effectAllowed = 'move';
            };
            // 接收玩家背包/装备栏物品
            cell.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('drag-over'); };
            cell.ondragleave = () => cell.classList.remove('drag-over');
            cell.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cell.classList.remove('drag-over');
                const targetSlot = parseInt(cell.dataset.slot, 10);
                this._moveFromPlayerToCompanion(m, targetSlot);
            };
        });
        // 装备槽：点击卸下；接收玩家背包/装备栏物品直接装备（canEquip 判定）
        this._overlay.querySelectorAll('.companion-diablo-slot').forEach(slotEl => {
            const slotKey = slotEl.dataset.slot;
            slotEl.onclick = () => {
                if (m.equipments[slotKey]) {
                    m.unequip(slotKey);
                    this._renderBody();
                }
            };
            slotEl.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; slotEl.classList.add('drag-over'); };
            slotEl.ondragleave = () => slotEl.classList.remove('drag-over');
            slotEl.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();
                slotEl.classList.remove('drag-over');
                this._equipFromPlayerToSlot(m, slotKey);
            };
        });
        // 消耗品使用设置：展开/收起 + 保存（2026-08-15）
        const csBtn = this._overlay.querySelector('[data-action="toggle-consumable-settings"]');
        if (csBtn) {
            csBtn.onclick = () => {
                const panel = this._overlay.querySelector('#companionConsumableSettings');
                if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            };
        }
        const csSave = this._overlay.querySelector('#csSave');
        if (csSave) {
            csSave.onclick = () => {
                const st = m.consumableSettings || (m.consumableSettings = {
                    enabled: true, hpThreshold: 0.3, mpThreshold: 0.25, useLowToHigh: true,
                });
                const enabledEl = this._overlay.querySelector('#csEnabled');
                const hpEl = this._overlay.querySelector('#csHp');
                const mpEl = this._overlay.querySelector('#csMp');
                if (enabledEl) st.enabled = enabledEl.checked;
                if (hpEl) st.hpThreshold = Math.max(0.01, Math.min(0.99, (parseFloat(hpEl.value) || 30) / 100));
                if (mpEl) st.mpThreshold = Math.max(0.01, Math.min(0.99, (parseFloat(mpEl.value) || 25) / 100));
                st.useLowToHigh = true;
                if (window.Game && window.Game.PartySystem) window.Game.PartySystem._notify();
                csSave.textContent = '已保存 ✓';
                setTimeout(() => { csSave.textContent = '保存'; }, 1200);
            };
        }
    },

    /**
     * 从玩家背包/装备栏拖入侍从背包（框架：玩家背包 inventory 全支持；
     * 装备栏 equip 先做"卸下入包"，换装/属性结算后续完善）。
     */
    _moveFromPlayerToCompanion(member, targetSlot) {
        const Game = window.Game;
        if (!Game || !Game.player) return;
        const eq = Game.player.equipments || {};
        const ddm = Game.EquipManager && Game.EquipManager._dragDropManager;
        const src = ddm ? ddm._dragSrc : null;
        if (!src) return;
        // 标记 drop 已消费（阻止 dragend 的丢弃逻辑）
        if (ddm) ddm._dropHandled = true;

        let item = null;
        if (src.type === 'inventory') {
            const idx = Game.EquipManager.backpackItems.findIndex(i => i.slot === parseInt(src.slot, 10));
            if (idx >= 0) item = Game.EquipManager.backpackItems.splice(idx, 1)[0];
        } else if (src.type === 'equip') {
            const slotKey = src.slot;
            if (eq[slotKey]) {
                item = eq[slotKey];
                delete eq[slotKey];
                // 玩家装备变动：刷新 UI（框架阶段简化，装备属性结算由后续接入）
                if (Game.EquipManager && Game.EquipManager.updateEquipSlots) Game.EquipManager.updateEquipSlots();
                if (Game.player && Game.player.calculateCombatStats) Game.player.calculateCombatStats();
                if (Game.player && Game.player.updateMaxStats) Game.player.updateMaxStats();
            }
        }
        if (!item) return;
        member.backpack = member.backpack || [];
        // 队员背包满：拒绝接收，物品还给玩家背包（防超容量/物品丢失）
        if (member.backpack.length >= member.maxBackpackSlots) {
            this._returnToPlayerBackpack(Game, item);
            if (Game.EquipManager && Game.EquipManager.updateInventorySlots) Game.EquipManager.updateInventorySlots();
            return;
        }
        // slot 必须最后写（源 item 可能自带 slot 字段，spread 会覆盖目标槽位）
        member.backpack.push({ ...JSON.parse(JSON.stringify(item)), slot: targetSlot });
        if (Game.EquipManager && Game.EquipManager.updateInventorySlots) Game.EquipManager.updateInventorySlots();
        this._renderBody();
    },

    /** 从玩家背包/装备栏拖入队员装备槽（走 canEquip 判定；不合法还回玩家背包） */
    _equipFromPlayerToSlot(member, slotKey) {
        const Game = window.Game;
        if (!Game || !Game.player) return;
        const ddm = Game.EquipManager && Game.EquipManager._dragDropManager;
        const src = ddm ? ddm._dragSrc : null;
        if (!src) return;
        if (ddm) ddm._dropHandled = true;
        let item = null;
        if (src.type === 'inventory') {
            const idx = Game.EquipManager.backpackItems.findIndex(i => i.slot === parseInt(src.slot, 10));
            if (idx >= 0) item = Game.EquipManager.backpackItems.splice(idx, 1)[0];
        } else if (src.type === 'equip') {
            if (Game.player.equipments[src.slot]) {
                item = Game.player.equipments[src.slot];
                delete Game.player.equipments[src.slot];
                if (Game.player.calculateCombatStats) Game.player.calculateCombatStats();
                if (Game.player.updateMaxStats) Game.player.updateMaxStats();
            }
        }
        if (!item) return;
        if (!member.canEquip(item, slotKey)) {
            // 规则不合法：物品还给玩家背包
            this._returnToPlayerBackpack(Game, item);
            if (Game.EquipManager.updateInventorySlots) Game.EquipManager.updateInventorySlots();
            return;
        }
        if (member.equipments[slotKey]) {
            // 替换前需有空位放旧装备；背包满 → 拒绝，物品还给玩家背包（防旧装备静默丢失）
            if (member._findFreeBackpackSlot() === -1) {
                this._returnToPlayerBackpack(Game, item);
                if (Game.EquipManager.updateInventorySlots) Game.EquipManager.updateInventorySlots();
                return;
            }
            member._stashToBackpack(member.equipments[slotKey]);
        }
        member.equipments[slotKey] = JSON.parse(JSON.stringify(item));
        member.calculateCombatStats();
        member.updateMaxStats();
        if (Game.EquipManager.updateInventorySlots) Game.EquipManager.updateInventorySlots();
        this._renderBody();
    },

    /** 物品还给玩家背包（找空位；玩家背包也满则掉在脚下，杜绝物品消失） */
    _returnToPlayerBackpack(Game, item) {
        const em = Game && Game.EquipManager;
        if (!em) return;
        const free = em._findFirstEmptySlot ? em._findFirstEmptySlot() : -1;
        if (free !== -1) {
            em.backpackItems.push({ ...JSON.parse(JSON.stringify(item)), slot: free });
        } else if (Game.player && typeof Game.dropItem === 'function') {
            Game.dropItem(Game.player.x + 30, Game.player.y + 30, JSON.parse(JSON.stringify(item)));
        }
    },

    /** 队员背包 → 玩家背包（drag-drop-manager inv-cell drop 触发） */
    _onCompanionMoveToPlayer({ memberId, slot, targetSlot }) {
        const Game = window.Game;
        const member = PartySystem.getMember(memberId);
        if (!member || !Game || !Game.EquipManager) return;
        const idx = member.backpack.findIndex(b => b.slot === slot);
        if (idx < 0) return;
        const item = member.backpack.splice(idx, 1)[0];
        const target = (targetSlot !== undefined && targetSlot !== null)
            ? targetSlot
            : (Game.EquipManager._findFirstEmptySlot ? Game.EquipManager._findFirstEmptySlot() : 0);
        Game.EquipManager.backpackItems.push({ ...JSON.parse(JSON.stringify(item)), slot: Math.max(0, target) });
        if (Game.EquipManager.updateInventorySlots) Game.EquipManager.updateInventorySlots();
        if (this._overlay && this._overlay.style.display === 'block') this._renderBody();
    },
};
