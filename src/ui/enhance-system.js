import { Game } from '../game.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { UIState } from './ui-state.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { ShopSystem } from './shop-system.js';
import { EquipManager } from './equip-manager.js';
import { buildFormulaDisplay } from '../config/attack-formula.js';
import { SystemUI } from './system-ui.js';
import { GAME_CONFIG } from '../config/game-config.js';
const EnhanceSystem = {
    _isOpen: false,
    _currentNPC: null,
    _equippedItem: null,

    // 强化参数统一读 data/game-config.json 的 enhance 节（?? 回退仅为配置缺失兜底）
    _getEnhanceConfig() {
        const cfg = (GAME_CONFIG && GAME_CONFIG.enhance) || {};
        return {
            maxLevel: cfg.maxLevel ?? 15,
            baseCost: cfg.baseCost ?? 100,
            costGrowth: cfg.costGrowth ?? 1.5,
        };
    },

    // 计算当前等级的强化金币消耗
    _getEnhanceCost(level) {
        const cfg = this._getEnhanceConfig();
        return Math.floor(cfg.baseCost * Math.pow(cfg.costGrowth, level));
    },

    // 强化石匹配：优先按物品 id，无 id 的旧实例回退按名称
    _isEnhanceStone(item) {
        return item && (item.id === 'enhancement_stone' || (!item.id && item.name === '强化石'));
    },

    open(npc) {
        UIState.open('enhance');
        this._isOpen = true;
        this._currentNPC = npc;
        SystemUI.open('equip');
        const panel = getElement('enhancePanel');
        if (panel) panel.classList.add('active');
        this._setupDragDrop();
        this._updateUI();
    },

    close() {
        UIState.close('enhance');
        this._isOpen = false;
        this._currentNPC = null;
        this._returnEquippedItem();
        const panel = getElement('enhancePanel');
        if (panel) panel.classList.remove('active');
        TimerManager.setTimeout(() => {
            if (!UIState.isOpen('enhance') && !UIState.isOpen('shop') && !UIState.isOpen('craft') && !UIState.isOpen('enchant')) {
                SystemUI.close();
            }
        }, 300);
    },

    toggle() {
        if (UIState.isOpen('enhance')) this.close();
        else this.open();
    },

    _setupDragDrop() {
        const slot = getElement('enhanceSlot');
        if (!slot) return;
        slot.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            slot.classList.add('drag-over');
        };
        slot.ondragleave = (_e) => {
            slot.classList.remove('drag-over');
        };
        slot.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            slot.classList.remove('drag-over');
            const src = EquipManager._dragDropManager._dragSrc;
            if (!src) return;
            EquipManager._dragDropManager._dropHandled = true;
            if (src.type === 'inventory') {
                const idx = parseInt(src.slot);
                const item = EquipManager.backpackItems.find(i => i.slot === idx);
                if (item && item.category !== 'gold') {
                    this.equipFromBackpack(idx);
                }
            } else if (src.type === 'equip') {
                const slotKey = src.slot;
                const item = Game.player.equipments[slotKey];
                if (item) {
                    this.equipFromSlot(slotKey);
                }
            }
            EquipManager._dragDropManager._dragSrc = null;
        };
        // 强化槽中的物品可拖出
        slot.draggable = true;
        slot.ondragstart = (e) => {
            if (!this._equippedItem) return;
            EquipManager._dragDropManager._dragSrc = { type: 'enhance', slot: 'enhance' };
            EquipManager._dragDropManager._dropHandled = false;
            e.dataTransfer.setData('text/plain', 'enhance');
            e.dataTransfer.effectAllowed = 'move';
            slot.classList.add('dragging');
        };
        slot.ondragend = (_e) => {
            slot.classList.remove('dragging');
            if (!EquipManager._dragDropManager._dropHandled && EquipManager._dragDropManager._dragSrc) {
                // 拖到空白处：归还到背包
                this._returnEquippedItem();
                this._updateUI();
            }
            EquipManager._dragDropManager._dropHandled = false;
            EquipManager._dragDropManager._dragSrc = null;
        };
    },

    equipFromBackpack(index) {
        if (this._equippedItem) {
            this._returnEquippedItem();
        }
        const bp = EquipManager.backpackItems || [];
        const item = bp.find(i => i.slot === index);
        if (!item) return;
        if (item.category === 'gold' || item.name === '金币') {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, '金币不能强化！', '#ff4444'));
            return;
        }
        // 从背包移除（移动容器）
        const itemIdx = bp.indexOf(item);
        if (itemIdx >= 0) bp.splice(itemIdx, 1);
        this._equippedItem = { item: JSON.parse(JSON.stringify(item)), source: 'backpack', index };
        EquipManager.updateInventorySlots();
        this._updateUI();
    },

    equipFromSlot(slotKey) {
        if (this._equippedItem) {
            this._returnEquippedItem();
        }
        const item = Game.player.equipments[slotKey];
        if (!item) return;
        // 从装备栏移除（移动容器）
        Game.player.equipments[slotKey] = null;
        EquipManager._clearWeaponState(slotKey);
        this._equippedItem = { item: JSON.parse(JSON.stringify(item)), source: 'equip', slotKey };
        EquipManager.updateEquipSlots();
        this._updateUI();
    },

    _returnEquippedItem() {
        if (!this._equippedItem) return;
        const { item, source, slotKey } = this._equippedItem;
        // 如果来自装备槽，优先归还到装备槽
        if (source === 'equip' && slotKey && Object.prototype.hasOwnProperty.call(Game.player.equipments, slotKey)) {
            // 检查装备槽是否为空
            if (!Game.player.equipments[slotKey] || !Game.player.equipments[slotKey].name) {
                Game.player.equipments[slotKey] = JSON.parse(JSON.stringify(item));
                this._equippedItem = null;
                EquipManager.updateEquipSlots();
                EquipManager.updateInventorySlots();
                return;
            }
        }
        // 归还到背包
        const usedSlots = new Set((EquipManager.backpackItems || []).map(i => i.slot));
        let slot = 0;
        while (usedSlots.has(slot) && slot < EquipManager.maxBackpackSlots) slot++;
        if (slot >= EquipManager.maxBackpackSlots) {
            // 背包满，装备掉落在地上
            if (Game.player && Game.dropItem) {
                Game.dropItem(Game.player.x, Game.player.y, item);
            }
            EquipManager._showBackpackFullNotice();
            this._equippedItem = null;
            EquipManager.updateEquipSlots();
            EquipManager.updateInventorySlots();
            return;
        }
        const clone = JSON.parse(JSON.stringify(item));
        clone.slot = slot;
        if (!EquipManager.backpackItems) EquipManager.backpackItems = [];
        EquipManager.backpackItems.push(clone);
        this._equippedItem = null;
        EquipManager.updateInventorySlots();
        EquipManager.updateEquipSlots();
    },

    enhance() {
        if (!this._equippedItem) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, '请先放入装备！', '#ff4444'));
            return;
        }
        const { item } = this._equippedItem;
        const player = Game.player;
        if (!player) return;

        const currentLevel = item.enhanceLevel || 0;
        if (currentLevel >= this._getEnhanceConfig().maxLevel) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '已达最高强化等级！', '#ff4444'));
            return;
        }

        // 检查强化石存在（先不消耗）
        const bp = EquipManager.backpackItems || [];
        const stoneIdx = bp.findIndex(i => this._isEnhanceStone(i));
        if (stoneIdx === -1) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '强化石不足！需要1颗强化石', '#ff4444'));
            return;
        }

        // 先校验并扣除金币，成功后再消耗强化石（修复：金币不足时强化石被白扣）
        const cost = this._getEnhanceCost(currentLevel);
        if (!ShopSystem._deductGold(cost)) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `金币不足！需要 ${cost} 金币`, '#ff4444'));
            return;
        }
        // 消耗1颗强化石
        const stoneItem = bp[stoneIdx];
        if (stoneItem.stack > 1) {
            stoneItem.stack -= 1;
        } else {
            bp.splice(stoneIdx, 1);
        }
        EquipManager.updateInventorySlots();
        item.enhanceLevel = (item.enhanceLevel || 0) + 1;

        // 强化加成统一由 getCurrentWeaponAtk()/computeWeaponAttack 按 attackFormula 派生，
        // 不再改写 item.stats 显示值（修复：stats 被反复改写导致基础值滚动累加；
        // 无 attackFormula 武器经 getAttackFormula 回退把污染值当 base 参与实战，造成平方级膨胀）

        this._playEnhanceEffect();

        TimerManager.setTimeout(() => {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `强化成功！+${item.enhanceLevel}`, '#ffd700'));
            this._updateUI();
            EquipManager.updateEquipSlots();
            EquipManager.updateInventorySlots();
        }, 800);
    },

    _playEnhanceEffect() {
        const slot = getElement('enhanceSlot');
        if (!slot) return;
        slot.classList.add('enhancing');
        TimerManager.setTimeout(() => slot.classList.remove('enhancing'), 900);
    },

    removeItem() {
        this._returnEquippedItem();
        this._updateUI();
    },

    _updateUI() {
        const player = Game.player;
        const moneyEl = getElement('enhanceMoney');
        if (moneyEl && player) moneyEl.textContent = `💰 ${ShopSystem._getBackpackGold()}`;

        const slot = getElement('enhanceSlot');
        const slotInfo = getElement('enhanceSlotInfo');
        const enhanceBtn = getElement('enhanceBtn');
        const costEl = getElement('enhanceCost');

        if (!slot || !slotInfo || !enhanceBtn || !costEl) return;

        if (this._equippedItem) {
            const item = this._equippedItem.item;
            const level = item.enhanceLevel || 0;
            const cost = this._getEnhanceCost(level);
            const bp = EquipManager.backpackItems || [];
            const _hasStone = bp.some(i => this._isEnhanceStone(i));
            slot.innerHTML = `
                <div class="slot-icon">${item.iconImage ? `<img src="${item.iconImage}" alt="${item.icon || '❓'}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon || '❓'}';">` : (item.icon || '❓')}</div>
                <div class="slot-name">${item.name}</div>
                <div class="slot-level">+${level}</div>
            `;
            slot.classList.add('has-item');
            slotInfo.innerHTML = `
                <div class="enhance-info-name">${item.name}</div>
                <div class="enhance-info-level">当前强化等级: +${level} / ${this._getEnhanceConfig().maxLevel}</div>
                ${this._buildPredictedStats(item)}
            `;
            costEl.innerHTML = `💰 ${cost} + 💎 强化石×1`;
            enhanceBtn.disabled = false;
            enhanceBtn.onclick = () => this.enhance();
            slot.onclick = () => this.removeItem();
            slot.ondblclick = () => this.removeItem();
            slot.oncontextmenu = (e) => { e.preventDefault(); this.removeItem(); };
        } else {
            slot.innerHTML = '<div class="enhance-slot-placeholder">拖入装备</div>';
            slot.classList.remove('has-item');
            slotInfo.innerHTML = '<div class="enhance-info-placeholder">请将装备拖入上方强化槽</div>';
            costEl.textContent = '💰 0';
            enhanceBtn.disabled = true;
            enhanceBtn.onclick = null;
            slot.onclick = null;
            slot.ondblclick = null;
            slot.oncontextmenu = null;
        }
    },

    _formatStats(item) {
        if (!item.stats || item.stats.length === 0) return '';
        return item.stats.map(s => `${s.name}: ${s.value}`).join(' | ');
    },

    _buildFormulaDisplay(formula, el, craftEffects) {
        // 统一委托共享实现（config/attack-formula.js），消除三处复制漂移
        return buildFormulaDisplay(formula, el, craftEffects);
    },

    _buildPredictedStats(item) {
        if (!item.weaponId || !Game.player || !Game.player.getCurrentWeaponAtk) return '';
        const currentLevel = item.enhanceLevel || 0;
        if (currentLevel >= this._getEnhanceConfig().maxLevel) {
            return '<div class="enhance-predicted" style="margin-top:8px;color:#7a9a6a;font-size:12px;">已达到最高强化等级</div>';
        }
        // 计算当前攻击力
        const currentAtk = Game.player.getCurrentWeaponAtk(item);
        // 模拟下一级攻击力
        const nextItem = JSON.parse(JSON.stringify(item));
        nextItem.enhanceLevel = currentLevel + 1;
        const nextAtk = Game.player.getCurrentWeaponAtk(nextItem);
        const diff = nextAtk - currentAtk;
        const diffSign = diff > 0 ? '+' : '';
        // 构建攻击力公式（从 attackFormula 动态生成）
        const el = currentLevel + 1;
        let formula = this._buildFormulaDisplay(item.attackFormula, el, item._craftEffects);
        return `<div class="enhance-predicted" style="margin-top:8px;padding:6px 8px;background:rgba(255,215,0,0.08);border-radius:6px;border:1px solid rgba(255,215,0,0.2);">
            <div style="color:#ffd700;font-size:12px;font-weight:600;margin-bottom:2px;">📈 预计强化效果 (+${currentLevel + 1})</div>
            <div style="color:#d4c5a9;font-size:11px;">物理攻击: ${currentAtk} → <span style="color:#ffd700;font-weight:700;">${nextAtk}</span> <span style="color:#7a9a6a;">(${diffSign}${diff})</span></div>
            ${formula ? `<div style="color:#8a9a7a;font-size:10px;margin-top:2px;">公式: ${formula}</div>` : ''}
        </div>`;
    }
};

export { EnhanceSystem };
