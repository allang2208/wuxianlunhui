import { EquipManager } from '../ui/equip-manager.js';
import { StatusBar } from '../ui/status-bar.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { BasePanel } from '../ui/panels/base-panel.js';
import { renderBuildingDetailHeader } from '../ui/panels/building-detail-header.js';
import { mountRightSidebarPanel } from '../ui/right-sidebar-panel-layer.js';
import {
    activateWorld122Tributes,
    deactivateWorld122Tributes,
    getWorld122TributeEntries,
    sacrificeWorld122Tribute,
    serializeWorld122Tributes,
    restoreWorld122Tributes,
} from './world122-tribute-store.js';
import { syncTributeBuffs } from '../config/tribute-effects.js';

const BUFF_NAME = '位面献祭';

function remainingText(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}分${String(total % 60).padStart(2, '0')}秒`;
}

function effectsText(item) {
    const stats = (item && item.stats) || [];
    if (stats.length) return stats.map((stat) => `${stat.name}${stat.value}`).join(' · ');
    return item && item.desc ? item.desc : '获得该祭品对应效果';
}

function isUsableAltar(altar) {
    return !!altar
        && altar.active !== false
        && !altar._sinking
        && Number(altar.hp) > 0
        && altar._cfg?.panelMode === 'tribute';
}

export const World122TributeSystem = {
    active: false,
    player: null,
    altar: null,
    _panel: null,
    _statusIds: new Map(),
    _nextExpiry: Infinity,

    setup(player) {
        this.player = player || null;
        this.altar = null;
        this.active = true;
        activateWorld122Tributes();
        this._sync();
    },

    teardown() {
        this.active = false;
        deactivateWorld122Tributes();
        if (this._panel?.isOpen) this._panel.close();
        this._clearStatus();
        this._syncPausedStatus();
        this._clearMoonshadow();
        this._recalculate();
        this.player = null;
        this.altar = null;
    },

    update() {
        if (this._panel?.isOpen && !isUsableAltar(this.altar)) this.closePanel();
        if (this.active && Date.now() >= this._nextExpiry) this._sync();
    },

    serialize() {
        return serializeWorld122Tributes();
    },

    restore(data) {
        restoreWorld122Tributes(data);
        if (this.active) this._sync();
        else {
            this._clearStatus();
            this._syncPausedStatus();
        }
    },

    openFor(altar, player) {
        if (!this.active) return false;
        this.player = player || this.player;
        if (!isUsableAltar(altar)) {
            this._notify('该位面祭坛当前不可用', '#ff6666');
            return false;
        }
        this.altar = altar;
        const panel = this._ensurePanel();
        panel.open();
        this._render();
        return true;
    },

    isOpenFor(altar) {
        return !!this._panel?.isOpen && this.altar === altar;
    },

    closePanel() {
        if (this._panel?.isOpen) this._panel.close();
        else this.altar = null;
    },

    detachAltar(altar) {
        if (this.altar !== altar) return;
        this.closePanel();
        this.altar = null;
    },

    _ensurePanel() {
        if (this._panel) return this._panel;
        const panel = new BasePanel({
            // 保留旧 id/class 供存量探针与统一建筑面板样式兼容；altar class 表达当前职责。
            id: 'world122BasePanel',
            className: 'world122-base-panel world122-altar-panel bp-right-column',
            stateKey: 'world122Base',
            panelGroup: 'buildingDetail',
            closeOnEscape: true,
            closeOnOutsidePointer: true,
            mountElement: (el) => mountRightSidebarPanel(el, 'panel', { bringToFront: true }),
        });
        panel.buildContent = (el) => {
            el.innerHTML = `
                <header class="bp-panel-header altar-panel-header">
                    <div class="bp-panel-header-copy">
                        <div class="altar-panel-eyebrow bp-type-caption">WORLD-122 · TRIBUTE FACILITY</div>
                        <h2 class="bp-type-title">位面祭坛</h2>
                    </div>
                    <div class="altar-panel-header-actions">
                        <button data-action="sell" class="bp-button altar-panel-sell" type="button">出售</button>
                        <button data-action="close" class="bp-panel-close" type="button" aria-label="关闭位面祭坛详情">×</button>
                    </div>
                </header>
                <div class="bp-panel-body altar-panel-body">
                    <div data-role="altar-detail"></div>
                    <section class="bp-panel-section altar-panel-protocol">
                        <h3 class="bp-panel-section-title bp-type-subtitle">献祭协议</h3>
                        <p class="altar-panel-copy bp-type-body">将背包中的祭品献给位面意志，获得对应增益。所有增益在世界模式累计持续30分钟，进入主神空间或地牢时暂停；同名祭品再次献祭只刷新持续时间，不重复占用祭品栏。</p>
                    </section>
                    <section class="bp-panel-section altar-panel-active">
                        <div class="altar-panel-section-heading">
                            <h3 class="bp-panel-section-title bp-type-subtitle">生效中的献祭</h3>
                            <span data-role="active-count" class="altar-panel-count bp-type-meta">0/10</span>
                        </div>
                        <div data-role="active"></div>
                    </section>
                    <section class="bp-panel-section altar-panel-backpack">
                        <div class="altar-panel-section-heading">
                            <h3 class="bp-panel-section-title bp-type-subtitle">背包祭品</h3>
                            <span class="altar-panel-meta bp-type-meta">点击献祭后立即消耗 1 件</span>
                        </div>
                        <div data-role="tributes"></div>
                    </section>
                </div>`;
            el.addEventListener('click', (event) => {
                const button = event.target.closest('button[data-action]');
                if (!button) return;
                if (button.dataset.action === 'close') panel.close();
                if (button.dataset.action === 'sell') this._sellAltar();
                if (button.dataset.action === 'sacrifice') this._sacrifice(Number(button.dataset.slot));
            });
        };
        panel.onOpen = () => this._render();
        panel.onClose = () => {
            this.altar = null;
        };
        this._panel = panel;
        return panel;
    },

    _sellAltar() {
        const altar = this.altar;
        if (!isUsableAltar(altar) || typeof altar.sell !== 'function') return;
        const result = altar.sell();
        this._notify(
            result.ok ? `位面祭坛已出售（+${result.refund || 0} 能源）` : (result.reason || '出售失败'),
            result.ok ? '#ffd700' : '#ff5555'
        );
        if (result.ok) this.closePanel();
    },

    _sacrifice(slot) {
        if (!isUsableAltar(this.altar)) {
            this._notify('需要一座可用的位面祭坛才能献祭', '#ff6666');
            this.closePanel();
            return;
        }
        const items = EquipManager.backpackItems || [];
        const item = items.find((entry) => entry.slot === slot);
        if (!item || item.category !== 'tribute') return;
        const result = sacrificeWorld122Tribute(item);
        if (!result.ok) {
            this._notify(result.reason, '#ff6666');
            return;
        }
        // 世界模式蟠桃次数只由新的世界献祭刷新，不与地牢的单次使用标记共用。
        if ((Number(item.effects?.revivePercent) || 0) > 0 && this.player) {
            this.player._worldPeachReviveUsed = false;
        }
        if ((item.stack || 1) > 1) item.stack -= 1;
        else {
            const index = items.indexOf(item);
            if (index >= 0) items.splice(index, 1);
        }
        EquipManager.updateInventorySlots?.();
        this._sync();
        if (this.player) syncTributeBuffs(this.player); // 献祭集合变化：刷新特效 buff 图标与友军生命
        this._notify(`${item.name} 已献祭：${result.refreshed ? '增益时长已刷新' : '获得30分钟增益'}`, '#7affc8');
    },

    _sync() {
        const entries = getWorld122TributeEntries();
        this._nextExpiry = entries.length
            ? Math.min(...entries.map((entry) => entry.expiresAt))
            : Infinity;
        this._syncStatus(entries);
        this._syncMoonshadow(entries);
        this._recalculate();
        if (this._panel?.isOpen) this._render();
    },

    _syncStatus(entries) {
        const keep = new Set();
        for (const entry of entries) {
            const type = `world122Tribute_${entry.key}`;
            keep.add(type);
            const remaining = Math.max(1, entry.expiresAt - Date.now());
            const id = StatusBar.addEffect(type, remaining, {
                icon: entry.item.icon || '🕯️',
                name: `${BUFF_NAME}·${entry.item.name}`,
                color: '#7ab8ff',
            });
            this._statusIds.set(type, id);
        }
        for (const [type, id] of this._statusIds) {
            if (!keep.has(type)) {
                StatusBar.removeEffect(id);
                this._statusIds.delete(type);
            }
        }
    },

    _clearStatus() {
        for (const id of this._statusIds.values()) StatusBar.removeEffect(id);
        this._statusIds.clear();
    },

    _syncPausedStatus() {
        for (const entry of getWorld122TributeEntries()) {
            const type = `world122TributePaused_${entry.key}`;
            const remaining = Math.max(0, Number(entry.remainingMs) || 0);
            const id = StatusBar.addEffect(type, 0, {
                icon: entry.item.icon || '⏸️',
                name: `${BUFF_NAME}·${entry.item.name}（已暂停）`,
                color: '#7f8fa6',
                persistent: true,
                durationText: `暂停·剩余${remainingText(remaining)}`,
            });
            this._statusIds.set(type, id);
        }
    },

    _syncMoonshadow(entries) {
        const moon = entries.find((entry) => entry.item.special?.moonshadowDuration !== undefined);
        if (!this.player) return;
        if (moon) {
            this.player._moonshadowTimer = Math.max(0, moon.expiresAt - Date.now());
            this.player._moonshadowBoostActive = true;
        } else {
            this._clearMoonshadow();
        }
    },

    _clearMoonshadow() {
        if (!this.player) return;
        this.player._moonshadowTimer = 0;
        this.player._moonshadowBoostActive = false;
    },

    _recalculate() {
        if (this.player?.calculateCombatStats) this.player.calculateCombatStats();
    },

    _notify(text, color) {
        if (!this.player || !EffectManager) return;
        EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 48, text, color));
    },

    _render() {
        const el = this._panel?.el;
        const altar = this.altar;
        if (!el || !isUsableAltar(altar)) {
            if (this._panel?.isOpen) this.closePanel();
            return;
        }

        const state = '祭坛可用';
        const detail = el.querySelector('[data-role="altar-detail"]');
        if (detail) {
            detail.innerHTML = `
                ${renderBuildingDetailHeader({
                    texture: altar.spriteCfg?.idleKey || 'defense_base',
                    name: '位面祭坛',
                    hp: altar.hp,
                    maxHp: altar.maxHp,
                    accent: '#dbe7ec',
                    status: state,
                    statusColor: '#7fd47f',
                })}
                <section class="bp-panel-section altar-panel-properties">
                    <h3 class="bp-panel-section-title bp-type-subtitle">特殊功能 · 祭品转化</h3>
                    <div class="altar-panel-stat-grid bp-type-meta">
                        <div><span>占地</span><b>${altar._buildingFootprintCells || 2}×${altar._buildingFootprintCells || 2} 菱形格</b></div>
                        <div><span>状态</span><b class="is-operational">${state}</b></div>
                        <div><span>物理防御</span><b>${altar.def ?? altar.data?.def ?? 0}</b></div>
                        <div><span>魔法防御</span><b>${altar.mdef ?? altar.data?.mdef ?? 0}</b></div>
                        <div><span>祭品槽位</span><b>10</b></div>
                        <div><span>用途</span><b>献祭 / 位面祝福</b></div>
                    </div>
                </section>`;
        }

        const entries = getWorld122TributeEntries();
        const count = el.querySelector('[data-role="active-count"]');
        if (count) count.textContent = `${entries.length}/10`;
        const active = el.querySelector('[data-role="active"]');
        if (active) {
            active.innerHTML = entries.length
                ? entries.map((entry) => `
                    <article class="altar-panel-entry">
                        <div class="altar-panel-entry-title bp-type-body"><b>${entry.item.icon || '🕯️'} ${entry.item.name}</b><span>${remainingText(entry.expiresAt - Date.now())}</span></div>
                        <div class="altar-panel-entry-effect bp-type-meta">${effectsText(entry.item)}</div>
                    </article>`).join('')
                : '<div class="altar-panel-empty bp-type-meta">尚未献祭祭品</div>';
        }

        const list = el.querySelector('[data-role="tributes"]');
        const tributes = (EquipManager.backpackItems || []).filter((item) => item.category === 'tribute');
        if (list) {
            list.innerHTML = tributes.length
                ? tributes.map((item) => `
                    <article class="altar-panel-item">
                        <span class="altar-panel-item-icon" aria-hidden="true">${item.icon || '🕯️'}</span>
                        <div class="altar-panel-item-copy">
                            <div class="altar-panel-item-name bp-type-body">${item.name}${(item.stack || 1) > 1 ? ` ×${item.stack}` : ''}</div>
                            <div class="altar-panel-item-effect bp-type-meta">${effectsText(item)}</div>
                        </div>
                        <button data-action="sacrifice" data-slot="${item.slot}" class="bp-button altar-panel-sacrifice" type="button">献祭</button>
                    </article>`).join('')
                : '<div class="altar-panel-empty bp-type-meta">背包中没有祭品</div>';
        }
    },
};
