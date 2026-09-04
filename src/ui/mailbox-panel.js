import { Game } from '../game.js';
import { GAME_CONFIG } from '../config/game-config.js';
import { MailStore } from '../systems/mail-store.js';
import { PlayerRewardDelivery } from '../systems/player-reward-delivery.js';
import { EquipManager } from './equip-manager.js';
import { EquipTooltipManager } from './equip-tooltip-manager.js';
import { WarehouseSystem } from './warehouse-system.js';
import { SystemUI } from './system-ui.js';
import { Input } from './input.js';
import { BasePanel } from './panels/base-panel.js';
import { mountRightSidebarPanel } from './right-sidebar-panel-layer.js';
import { SceneManager } from '../world/scene-manager.js';
import { TimerManager } from '../utils/timer-manager.js';
import { RARITY_LABELS } from '../config/rarity.js';

const PAGE_SIZE = 20;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => Number(value || 0).toLocaleString('zh-CN');

export const MailboxPanel = {
    _panel: null, _anchorNPC: null, _watch: null, _organizing: false, _busy: false,
    _generation: 0, _page: 0, _attachmentPage: 0, _selected: null, _filter: 'pending', _status: '',
    get isOpen() { return !!this._panel?.isOpen; },
    get isOrganizing() { return this._organizing; },
    _valid() {
        const npc = this._anchorNPC, player = Game.player;
        return SceneManager.currentScene === 'main' && !SceneManager.isLoading && npc && player
            && [...Game.entities.values()].includes(npc)
            && Math.hypot(npc.x - player.x, npc.y - player.y) <= (GAME_CONFIG.interactionDistances?.npcAutoClose || 200);
    },
    _ensure() {
        if (this._panel) return;
        this._backdrop = document.createElement('div');
        this._backdrop.className = 'mailbox-backdrop';
        this._backdrop.hidden = true;
        this._backdrop.onclick = event => { event.stopPropagation(); this.close(); };
        mountRightSidebarPanel(this._backdrop, 'backdrop');
        this._panel = new BasePanel({ id: 'mailboxPanel', className: 'mailbox-panel', stateKey: 'mailbox',
            panelGroup: 'rightSidebar', mountElement: el => mountRightSidebarPanel(el, 'panel', { bringToFront: true }) });
        this._panel.buildContent = el => {
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-label', '小鼠大王的战利品信箱');
            el.innerHTML = `<header class="mailbox-header"><div><h2>战利品信箱</h2><p data-count></p></div><button type="button" data-action="close" aria-label="关闭信箱">关闭</button></header>
                <nav class="mailbox-toolbar" aria-label="信件筛选"><button type="button" data-filter="pending">待领取</button><button type="button" data-filter="all">全部</button><button type="button" data-action="clear">清理已领空信</button></nav>
                <div class="mailbox-body"><section class="mailbox-list-column"><div class="mailbox-list" data-list></div><div class="mailbox-pager"><button type="button" data-action="prev">上一页</button><span data-page></span><button type="button" data-action="next">下一页</button></div></section>
                <section class="mailbox-detail" data-detail aria-label="信件详情"></section></div>
                <footer class="mailbox-footer"><p data-capacity></p><p data-status role="status" aria-live="polite"></p><div class="mailbox-actions"><button type="button" class="mailbox-primary" data-action="claim">领取本封</button><button type="button" data-action="all">全部领取</button><button type="button" data-action="bag">打开背包</button><button type="button" data-action="warehouse">打开仓库</button></div><p class="mailbox-note">未领附件永久保管 · 请手动保存游戏 · 未领金币不可消费</p></footer>`;
            el.onclick = event => {
                event.stopPropagation();
                const button = event.target.closest('button');
                if (!button || button.disabled) return;
                if (button.dataset.filter) {
                    this._filter = button.dataset.filter; this._page = 0; this._selected = null; this._render();
                } else this._action(button.dataset.action);
            };
            for (const type of ['mousedown', 'pointerdown', 'contextmenu']) el.addEventListener(type, event => { event.stopPropagation(); if (type === 'contextmenu') event.preventDefault(); });
            el.onkeydown = event => {
                if (event.key !== 'Tab') return;
                const buttons = [...el.querySelectorAll('button:not(:disabled)')].filter(button => button.getClientRects().length);
                const index = buttons.indexOf(document.activeElement);
                const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
                event.preventDefault(); buttons[next]?.focus();
            };
        };
        this._panel.onOpen = () => { this._backdrop.hidden = false; this._render(); this._panel.el.querySelector('[data-action="close"]').focus(); };
        this._panel.onClose = () => {
            this._backdrop.hidden = true; this._hideTooltip();
            if (!this._organizing) this._endSession();
        };
        MailStore.subscribe(() => { if (this.isOpen && !this._busy) this._render(); });
    },
    open(npc) {
        this._anchorNPC = npc;
        if (!this._valid()) { this._anchorNPC = null; return false; }
        this._ensure();
        this._organizing = false; this._status = '';
        SystemUI.close(); WarehouseSystem.close();
        Input.keys.clear(); Input.mouse.leftDown = Input.mouse.rightDown = Input.mouse.leftPressed = Input.mouse.rightPressed = false;
        this._panel.open();
        if (!this._watch) this._watch = TimerManager.setInterval(() => {
            if (!this._valid()) { this.reset(); return; }
            this._anchorNPC._interactionHoldMs = 350;
        }, 200);
        return true;
    },
    openAt(id, npc) {
        const mail = MailStore.state.mails.find(entry => entry.id === id && entry.attachments.length);
        if (!mail || !this.open(npc)) return false;
        this._filter = 'pending';
        this._attachmentPage = 0;
        this._selected = id;
        const pending = MailStore.state.mails
            .filter(entry => entry.attachments.length)
            .sort((a, b) => b.createdAt - a.createdAt);
        this._page = Math.max(0, Math.floor(pending.findIndex(entry => entry.id === id) / PAGE_SIZE));
        MailStore.read(id);
        this._render();
        this._panel.el.classList.add('show-detail');
        this._panel.el.querySelector('[data-detail] button')?.focus();
        return true;
    },
    close() { this._panel?.close(); },
    _endSession() {
        this._generation++; this._busy = false; this._anchorNPC = null;
        if (this._watch) TimerManager.clearInterval(this._watch);
        this._watch = null;
    },
    reset() {
        const organizing = this._organizing;
        this._organizing = false; this._returnButton?.remove(); this._returnButton = null;
        this.close(); this._endSession(); this._hideTooltip();
        if (organizing) { WarehouseSystem.close(); SystemUI.close(); }
    },
    _action(action) {
        if (action === 'close') { this.close(); return; }
        if (this._busy) return;
        if (action === 'prev' || action === 'next') { this._page += action === 'next' ? 1 : -1; this._render(); }
        if (action === 'clear') MailStore.clearClaimed();
        if (action === 'claim') this._claim(this._selected);
        if (action === 'all') this._claimAll();
        if (action === 'bag' || action === 'warehouse') this._organize(action);
    },
    _claim(id, attachmentId = null) {
        if (!this._valid() || this._busy) return;
        this._busy = true;
        try {
            const result = PlayerRewardDelivery.claim(id, attachmentId);
            this._status = result.received ? `已领取 ${result.received} 项，本封仍有 ${result.remaining} 项待领` : '空间不足，附件继续保管；可打开背包或仓库整理';
        } catch (error) { this._status = `领取未完成：${error.message}`; }
        finally { this._busy = false; this._render(); }
    },
    async _claimAll() {
        if (!this._valid() || this._busy) return;
        this._busy = true;
        const generation = ++this._generation;
        const ids = MailStore.state.mails.filter(mail => mail.attachments.length).sort((a, b) => a.createdAt - b.createdAt).map(mail => mail.id);
        let received = 0;
        this._status = '正在按投递顺序领取，关闭可停止后续批次…'; this._render();
        try {
            for (let index = 0; index < ids.length; index++) {
                if (generation !== this._generation || !this._valid() || !this.isOpen) return;
                received += PlayerRewardDelivery.claim(ids[index]).received;
                if (index % 10 === 9) await new Promise(resolve => requestAnimationFrame(resolve));
            }
            this._status = `已领取 ${received} 项，仍有 ${MailStore.pendingCount} 封待领；放不下的附件继续保管`;
        } catch (error) { this._status = `已完成 ${received} 项，后续领取停止：${error.message}`; }
        finally { if (generation === this._generation) { this._busy = false; if (this.isOpen) this._render(); } }
    },
    _organize(which) {
        if (!this._valid()) return;
        if (which === 'warehouse') {
            const npc = Game.entities.get('npc_warehouse');
            if (!npc || Math.hypot(npc.x - Game.player.x, npc.y - Game.player.y) > (GAME_CONFIG.interactionDistances?.npcAutoClose || 200)) {
                this._status = '请先靠近小鼠大王旁的仓库，再打开仓库整理'; this._render(); return;
            }
            WarehouseSystem._anchorNPC = npc;
        }
        this._organizing = true;
        this._panel.close();
        if (which === 'warehouse') WarehouseSystem.open(); else SystemUI.open('equip');
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'mailbox-return'; button.textContent = '整理完成 · 返回信箱';
        button.onmousedown = event => event.stopPropagation();
        button.onclick = event => {
            event.stopPropagation();
            if (!this._valid()) { this.reset(); return; }
            WarehouseSystem.close(); SystemUI.close();
            button.remove(); this._returnButton = null; this._organizing = false;
            this._panel.open();
        };
        this._returnButton = button; mountRightSidebarPanel(button, 'panel', { bringToFront: true });
    },
    _hideTooltip() { const tooltip = document.getElementById('equipTooltip'); if (tooltip) tooltip.style.display = 'none'; },
    _tooltip(item, event, button) {
        const tooltip = document.getElementById('equipTooltip');
        if (!tooltip) return;
        EquipTooltipManager.renderTooltip(item);
        mountRightSidebarPanel(tooltip, 'modal', { bringToFront: true });
        tooltip.style.display = 'block';
        const rect = button.getBoundingClientRect();
        EquipTooltipManager._positionTooltip(event.clientX ? event : { clientX: rect.left, clientY: rect.top });
    },
    _render() {
        const el = this._panel?.el;
        if (!el) return;
        const list = el.querySelector('[data-list]'), detail = el.querySelector('[data-detail]');
        const listScroll = list.scrollTop, detailScroll = detail.scrollTop;
        const mails = MailStore.state.mails.filter(mail => this._filter === 'all' || mail.attachments.length).sort((a, b) => b.createdAt - a.createdAt);
        const pages = Math.max(1, Math.ceil(mails.length / PAGE_SIZE));
        this._page = Math.max(0, Math.min(pages - 1, this._page));
        el.querySelector('[data-count]').textContent = `待领取 ${number(MailStore.pendingCount)} 封 · 容量不限`;
        el.querySelector('[data-page]').textContent = `${this._page + 1} / ${pages}`;
        el.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === this._filter)));
        el.querySelector('[data-action="prev"]').disabled = this._page === 0 || this._busy;
        el.querySelector('[data-action="next"]').disabled = this._page >= pages - 1 || this._busy;
        list.replaceChildren();
        if (!mails.length) list.textContent = '暂无信件。放不下的已结算战利品会送到这里。';
        for (const mail of mails.slice(this._page * PAGE_SIZE, (this._page + 1) * PAGE_SIZE)) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'mailbox-letter';
            button.setAttribute('aria-pressed', String(mail.id === this._selected));
            const status = !mail.attachments.length ? '已领完' : mail.claimed ? '部分领取' : '待领取';
            button.innerHTML = `<strong>${esc(mail.title)}</strong><span>${esc(new Date(mail.createdAt).toLocaleString('zh-CN'))}</span><span>${status} · ${number(mail.attachments.length)} 项${mail.read ? '' : ' · 未读'}</span>`;
            button.disabled = this._busy;
            button.onclick = event => { event.stopPropagation(); this._selected = mail.id; this._attachmentPage = 0; MailStore.read(mail.id); el.classList.add('show-detail'); this._render(); detail.querySelector('button')?.focus(); };
            list.appendChild(button);
        }
        const mail = MailStore.state.mails.find(entry => entry.id === this._selected);
        detail.replaceChildren();
        if (!mail) {
            detail.textContent = '选择一封信，查看附件和领取数量。';
            el.classList.remove('show-detail');
        }
        else {
            const heading = document.createElement('div');
            heading.innerHTML = `<button type="button" class="mailbox-detail-back">返回列表</button><h3>${esc(mail.title)}</h3><p>寄件人：小鼠大王</p><p>放不下的战利品，我替你收好了。腾出地方再来领。</p>`;
            heading.querySelector('button').onclick = event => { event.stopPropagation(); el.classList.remove('show-detail'); list.querySelector('button')?.focus(); };
            detail.appendChild(heading);
            const attachmentPages = Math.max(1, Math.ceil(mail.attachments.length / PAGE_SIZE));
            this._attachmentPage = Math.min(this._attachmentPage, attachmentPages - 1);
            const pageStart = this._attachmentPage * PAGE_SIZE;
            for (const [offset, attachment] of mail.attachments.slice(pageStart, pageStart + PAGE_SIZE).entries()) {
                const item = attachment.item;
                const row = document.createElement('div'); row.className = 'mailbox-attachment';
                const icon = document.createElement('span'); icon.className = 'mailbox-item-icon';
                if (item.slotImage || item.iconImage) { const image = document.createElement('img'); image.src = item.slotImage || item.iconImage; image.alt = ''; icon.appendChild(image); }
                else icon.textContent = item.icon || '◇';
                row.appendChild(icon);
                const description = document.createElement('button'); description.type = 'button'; description.className = 'mailbox-item-description';
                description.innerHTML = `<strong>${esc(item.name)}</strong><span>${esc(RARITY_LABELS[item.rarity] || item.rarity || '普通')} · <b>${number(item.stack)}</b></span>`;
                description.onmouseenter = event => this._tooltip(item, event, description);
                description.onfocus = event => this._tooltip(item, event, description);
                description.onmouseleave = description.onblur = () => this._hideTooltip();
                row.appendChild(description);
                const quantity = PlayerRewardDelivery.preview([item])[0];
                const claim = document.createElement('button'); claim.type = 'button'; claim.textContent = `领取 ${number(quantity)}`;
                claim.disabled = this._busy || quantity <= 0;
                claim.onclick = event => { event.stopPropagation(); this._claim(mail.id, attachment.id); };
                row.appendChild(claim); detail.appendChild(row);
            }
            if (!mail.attachments.length) detail.append('附件已全部领取，可以清理这封空信。');
            if (attachmentPages > 1) {
                const pager = document.createElement('div'); pager.className = 'mailbox-pager';
                for (const delta of [-1, 1]) {
                    const button = document.createElement('button'); button.type = 'button'; button.textContent = delta < 0 ? '上一组附件' : '下一组附件';
                    button.disabled = this._busy || (delta < 0 ? this._attachmentPage === 0 : this._attachmentPage === attachmentPages - 1);
                    button.onclick = event => { event.stopPropagation(); this._attachmentPage += delta; this._render(); };
                    pager.appendChild(button);
                }
                detail.appendChild(pager);
            }
        }
        el.querySelector('[data-capacity]').textContent = `背包空位 ${Math.max(0, EquipManager.maxBackpackSlots - EquipManager.backpackItems.length)} · 仓库空位 ${Math.max(0, WarehouseSystem.capacity - WarehouseSystem.items.length)} · 已有堆叠仍可合并`;
        el.querySelector('[data-status]').textContent = this._status || '先放背包，再放仓库；放不下的仍留在原信中。';
        el.querySelector('[data-action="claim"]').disabled = this._busy || !mail?.attachments.length;
        el.querySelector('[data-action="all"]').disabled = this._busy || !MailStore.pendingCount;
        for (const action of ['bag', 'warehouse', 'clear']) el.querySelector(`[data-action="${action}"]`).disabled = this._busy;
        list.scrollTop = listScroll; detail.scrollTop = detailScroll;
    },
};
if (typeof window !== 'undefined') window.MailboxPanel = MailboxPanel;
