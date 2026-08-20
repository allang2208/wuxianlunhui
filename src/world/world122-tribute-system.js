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

const BUFF_NAME = '基地献祭';

function remainingText(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}分${String(total % 60).padStart(2, '0')}秒`;
}

function effectsText(item) {
    const stats = (item && item.stats) || [];
    if (stats.length) return stats.map((stat) => `${stat.name}${stat.value}`).join(' · ');
    return item && item.desc ? item.desc : '获得该祭品对应效果';
}

export const World122TributeSystem = {
    active: false,
    player: null,
    base: null,
    _panel: null,
    _statusIds: new Map(),
    _nextExpiry: Infinity,

    setup(player, base) {
        this.player = player || null;
        this.base = base || null;
        this.active = true;
        activateWorld122Tributes();
        this._sync();
    },

    teardown() {
        this.active = false;
        deactivateWorld122Tributes();
        if (this._panel?.isOpen) this._panel.close();
        this._clearStatus();
        this._clearMoonshadow();
        this._recalculate();
        this.player = null;
        this.base = null;
    },

    update() {
        if (this.active && Date.now() >= this._nextExpiry) this._sync();
    },

    serialize() {
        return serializeWorld122Tributes();
    },

    restore(data) {
        restoreWorld122Tributes(data);
        if (this.active) this._sync();
    },

    openFor(base, player) {
        if (!this.active) return false;
        this.base = base || this.base;
        this.player = player || this.player;
        const panel = this._ensurePanel();
        panel.open();
        this._render();
        return true;
    },

    _ensurePanel() {
        if (this._panel) return this._panel;
        const panel = new BasePanel({
            id: 'world122BasePanel',
            className: 'world122-base-panel',
            stateKey: 'world122Base',
            panelGroup: 'buildingDetail',
            closeOnEscape: true,
            closeOnOutsidePointer: true,
            mountElement: (el) => mountRightSidebarPanel(el, 'panel', { bringToFront: true }),
        });
        panel.buildContent = (el) => {
            el.style.cssText = [
                'position:fixed;right:26px;top:50%;transform:translateY(-50%);width:420px;',
                'max-height:88vh;overflow-y:auto;background:rgba(16,15,13,0.97);',
                'border:2px solid #6a5a3a;border-radius:10px;padding:16px 18px;color:#d4c5a9;',
                'font-family:SimHei,"Microsoft YaHei",sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.65);z-index:9000;',
            ].join('');
            el.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <div style="font-size:18px;font-weight:700;color:#7ab8ff;">基地核心详情</div>
                    <button data-action="close" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:pointer;">关闭</button>
                </div>
                <div data-role="base-detail" style="border:1px solid #4a6a7a;border-radius:8px;padding:10px;margin-bottom:10px;background:rgba(20,40,55,0.26);"></div>
                <div style="font-size:12px;color:#9a8a6a;margin-bottom:10px;">献祭祭品后获得对应 Buff，统一持续30分钟；同名祭品再次献祭会刷新时长。</div>
                <div data-role="active" style="border:1px solid #6a5a3a;border-radius:8px;padding:10px;margin-bottom:10px;background:rgba(40,32,18,0.22);"></div>
                <div style="font-size:14px;font-weight:700;color:#ffd700;margin:8px 0 6px;">背包祭品</div>
                <div data-role="tributes" style="border:1px solid #3a3528;border-radius:8px;padding:6px;"></div>
            `;
            el.addEventListener('click', (event) => {
                const button = event.target.closest('button[data-action]');
                if (!button) return;
                if (button.dataset.action === 'close') panel.close();
                if (button.dataset.action === 'sacrifice') this._sacrifice(Number(button.dataset.slot));
            });
        };
        panel.onOpen = () => this._render();
        this._panel = panel;
        return panel;
    },

    _sacrifice(slot) {
        const items = EquipManager.backpackItems || [];
        const item = items.find((entry) => entry.slot === slot);
        if (!item || item.category !== 'tribute') return;
        const result = sacrificeWorld122Tribute(item);
        if (!result.ok) {
            this._notify(result.reason, '#ff6666');
            return;
        }
        if ((item.stack || 1) > 1) item.stack -= 1;
        else {
            const index = items.indexOf(item);
            if (index >= 0) items.splice(index, 1);
        }
        EquipManager.updateInventorySlots?.();
        this._sync();
        this._notify(`${item.name} 已献祭：${result.refreshed ? 'Buff时长已刷新' : '获得30分钟Buff'}`, '#7affc8');
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
        if (!el) return;
        el.style.display = 'block';
        const base = this.base;
        const detail = el.querySelector('[data-role="base-detail"]');
        if (detail && base) {
            const state = base._sinking ? '已损毁' : (base.active ? '守备正常' : '不可用');
            detail.innerHTML = `
                ${renderBuildingDetailHeader({
                    texture: 'defense_base',
                    name: '基地核心',
                    hp: base.hp,
                    maxHp: base.maxHp,
                    accent: '#7ab8ff',
                    status: state,
                    statusColor: base.active ? '#7fd47f' : '#ff6666',
                })}
                <div style="font-size:13px;font-weight:700;color:#7ab8ff;margin:4px 0 6px;">特殊功能 · 防守核心与献祭</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 12px;margin-top:10px;font-size:12px;color:#b8b0a0;">
                    <div>占地：<b style="color:#d4c5a9;">4×4 菱形格</b></div>
                    <div>状态：<b style="color:${base.active ? '#7fd47f' : '#ff6666'};">${state}</b></div>
                    <div>物理防御：<b style="color:#7ab8ff;">${base.def ?? base.data?.def ?? 0}</b></div>
                    <div>魔法防御：<b style="color:#c9a0ff;">${base.mdef ?? base.data?.mdef ?? 0}</b></div>
                    <div>受击槽位：<b style="color:#d4c5a9;">${base._attackSlots ?? 0}</b></div>
                    <div>用途：<b style="color:#d4c5a9;">防守目标 / 献祭核心</b></div>
                </div>`;
        }

        const active = el.querySelector('[data-role="active"]');
        const entries = getWorld122TributeEntries();
        active.innerHTML = `<div style="font-size:14px;font-weight:700;color:#ffd700;margin-bottom:6px;">生效中的献祭 (${entries.length}/10)</div>`
            + (entries.length
                ? entries.map((entry) => `<div style="padding:6px 0;border-top:1px solid #3a3528;"><b>${entry.item.icon || '🕯️'} ${entry.item.name}</b><span style="float:right;color:#7affc8">${remainingText(entry.expiresAt - Date.now())}</span><div style="font-size:12px;color:#b8b0a0;margin-top:3px;">${effectsText(entry.item)}</div></div>`).join('')
                : '<div style="font-size:12px;color:#8a8a8a;">尚未献祭祭品</div>');

        const list = el.querySelector('[data-role="tributes"]');
        const tributes = (EquipManager.backpackItems || []).filter((item) => item.category === 'tribute');
        list.innerHTML = tributes.length
            ? tributes.map((item) => `<div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid #2e2a22;"><span style="font-size:22px;">${item.icon || '🕯️'}</span><div style="flex:1;min-width:0;"><div style="font-weight:700;">${item.name}${(item.stack || 1) > 1 ? ` ×${item.stack}` : ''}</div><div style="font-size:12px;color:#a8a090;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${effectsText(item)}</div></div><button data-action="sacrifice" data-slot="${item.slot}" style="background:#2d5a66;color:#d5ffff;border:1px solid #4a8a9a;border-radius:6px;padding:5px 9px;cursor:pointer;">献祭</button></div>`).join('')
            : '<div style="padding:8px;color:#8a8a8a;font-size:13px;">背包中没有祭品</div>';
    },
};
