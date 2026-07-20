/**
 * slot-renderer.js — 背包/装备槽渲染（从 equip-manager.js 拆分）
 * 纯渲染职责：按 EquipManager 当前状态重建槽位 DOM。
 * 注意：消耗品右键使用由 document 级委托（_onInventoryContextMenu）统一处理，
 * 不在渲染时绑定格子级行为（历史遗留的三套消耗公式已统一为 useEffect 数据驱动）。
 */

import { RARITY_LABELS } from '../../config/rarity.js';
import { getElement, queryAllElements } from '../../utils/dom-utils.js';
import { EquipTooltipManager } from '../equip-tooltip-manager.js';

/** 渲染装备槽（.diablo-slot） */
export function updateEquipSlots(em) {
    const eq = em.player.equipments;
    queryAllElements('.diablo-slot').forEach(slot => {
        const key = slot.dataset.slot;
        const item = eq[key];
        const iconEl = slot.querySelector('.slot-icon');
        const nameEl = slot.querySelector('.slot-name');
        const rarityEl = slot.querySelector('.slot-rarity');
        slot.draggable = !!item;
        // ===== 双手武器锁定状态：weapon1→offhand, weapon2→ring2 =====
        const isOffhandLocked = (key === 'offhand') && (eq['weapon'] && eq['weapon'].isTwoHanded);
        const isRing2Locked = (key === 'ring2') && (eq['weapon2'] && eq['weapon2'].isTwoHanded);
        const isLocked = isOffhandLocked || isRing2Locked;
        // 清除旧状态
        slot.classList.remove('two-handed-locked');
        const oldX = slot.querySelector('.two-handed-x');
        if (oldX) oldX.remove();
        if (isLocked) {
            slot.classList.add('two-handed-locked');
            const xEl = document.createElement('div');
            xEl.className = 'two-handed-x';
            xEl.textContent = '✕';
            slot.appendChild(xEl);
        }
        if (item) {
            slot.classList.add('equipped');
            const imgSrc = item.slotImage || item.iconImage;
            nameEl.textContent = item.name;
            // 稀有度显示
            const rarityKey = item.rarity || 'common';
            const rarityLabel = RARITY_LABELS[rarityKey] || rarityKey;
            if (rarityEl) {
                rarityEl.textContent = rarityLabel;
                rarityEl.className = 'slot-rarity rarity-' + rarityKey;
            }
            if (imgSrc) {
                iconEl.innerHTML = `<img src="${imgSrc}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${item.icon || '❓'}';">`;
            } else {
                iconEl.textContent = item.icon || '⚔';
            }
            // 已强化标签
            let enhancedEl = slot.querySelector('.slot-enhanced');
            if (!enhancedEl) {
                enhancedEl = document.createElement('div');
                enhancedEl.className = 'slot-enhanced';
                slot.appendChild(enhancedEl);
            }
            enhancedEl.textContent = (item.enhanceLevel || 0) > 0 ? '已强化' : '';
            enhancedEl.style.display = (item.enhanceLevel || 0) > 0 ? 'flex' : 'none';
            // 已改造标签
            const isCrafted = item._isCrafted || (item._craftData && Object.keys(item._craftData).length > 0);
            let craftedEl = slot.querySelector('.slot-crafted');
            if (!craftedEl) {
                craftedEl = document.createElement('div');
                craftedEl.className = 'slot-crafted';
                slot.appendChild(craftedEl);
            }
            craftedEl.textContent = isCrafted ? '已改造' : '';
            craftedEl.style.display = isCrafted ? 'flex' : 'none';
            // 已附魔标签
            const isEnchanted = item._isEnchanted || (item._enchantData && (item._enchantData.prefix || item._enchantData.suffix));
            let enchantedEl = slot.querySelector('.slot-enchanted');
            if (!enchantedEl) {
                enchantedEl = document.createElement('div');
                enchantedEl.className = 'slot-enchanted';
                slot.appendChild(enchantedEl);
            }
            enchantedEl.textContent = isEnchanted ? '已附魔' : '';
            enchantedEl.style.display = isEnchanted ? 'flex' : 'none';
        } else {
            slot.classList.remove('equipped');
            iconEl.innerHTML = '';
            nameEl.textContent = nameEl.dataset.default || '';
            if (rarityEl) {
                rarityEl.textContent = '';
                rarityEl.className = 'slot-rarity';
            }
            const enhancedEl = slot.querySelector('.slot-enhanced');
            if (enhancedEl) enhancedEl.style.display = 'none';
            const craftedEl = slot.querySelector('.slot-crafted');
            if (craftedEl) craftedEl.style.display = 'none';
            const enchantedEl = slot.querySelector('.slot-enchanted');
            if (enchantedEl) enchantedEl.style.display = 'none';
        }
    });
}

/** 渲染背包格（.inv-cell） */
export function updateInventorySlots(em) {
    // 仅渲染背包容器内的格子（.inventory-grid）——仓库格子（.warehouse-grid .wh-cell）虽共享
    // .inv-cell 类，但由 WarehouseSystem._renderGrid 自绘，不能在此被清空/重绘
    queryAllElements('.inventory-grid .inv-cell').forEach((cell, idx) => {
        cell.classList.remove('occupied');
        cell.innerHTML = '';
        cell.dataset.itemName = '';
        cell.dataset.slot = idx;
        cell.draggable = false;
        const item = em.backpackItems.find(i => i.slot === idx);
        if (item) {
            cell.classList.add('occupied');
            cell.draggable = true;
            cell.dataset.dragType = 'inventory';
            cell.dataset.dragId = item.itemId || idx;
            const imgSrc = item.slotImage || item.iconImage;
            const rarityKey = item.rarity || 'common';
            const rarityLabel = RARITY_LABELS[rarityKey] || rarityKey;
            const enhancedTag = (item.enhanceLevel || 0) > 0 ? `<div class="inv-enhanced">已强化</div>` : '';
            const isCrafted = item._isCrafted || (item._craftData && Object.keys(item._craftData).length > 0);
            const craftedTag = isCrafted ? `<div class="inv-crafted">已改造</div>` : '';
            const isEnchanted = item._isEnchanted || (item._enchantData && (item._enchantData.prefix || item._enchantData.suffix));
            const enchantedTag = isEnchanted ? `<div class="inv-enchanted">已附魔</div>` : '';
            if (imgSrc) {
                cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div>${enhancedTag}${craftedTag}${enchantedTag}<img src="${imgSrc}" draggable="false" ondragstart="return false;" style="width:32px;height:32px;object-fit:cover;pointer-events:none;border-radius:4px;user-select:none;-webkit-user-drag:none;"><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack" style="pointer-events:none;user-select:none;">${item.stack}</span>` : ''}`;
            } else {
                cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div>${enhancedTag}${craftedTag}${enchantedTag}<span style="pointer-events:none;user-select:none;">${item.icon || '❓'}</span><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack" style="pointer-events:none;user-select:none;">${item.stack}</span>` : ''}`;
            }
            cell.dataset.itemName = item.name;
        }
        // 绑定拖放事件（所有格子都可作为放置目标）
        if (em._dragDropManager && typeof em._dragDropManager.bindDragToCell === 'function') {
            em._dragDropManager.bindDragToCell(cell);
        }
    });
    const invCountEl = getElement('invCount'); if (invCountEl) invCountEl.textContent = `${em.backpackItems.length}/${em.maxBackpackSlots}`;
    // 重新绑定tooltip（使用 onmouseenter/onmouseleave 直接赋值覆盖旧值）
    EquipTooltipManager.bindInventoryTooltip();
}
