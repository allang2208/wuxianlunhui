// ============================================================
// 寻找帮手界面（RecruitUI，2026-08-12 框架）
// 需求：类似小鼠侍从的寻找帮手界面——卡片选择，选择对应助手加入队伍。
// 数据源：PartySystem.candidates（companion-config.json）；满员/已招募禁用。
// ============================================================

import { PartySystem } from '../systems/party-system.js';
import { mountRightSidebarPanel } from './right-sidebar-panel-layer.js';

export const RecruitUI = {
    _overlay: null,
    _previousFocus: null,

    get isOpen() { return !!this._overlay?.isConnected && this._overlay.style.display === 'flex'; },

    open() {
        if (!this.isOpen) this._previousFocus = document.activeElement;
        this._ensureElement();
        this._render();
        this._overlay.style.display = 'flex';
        this._overlay.querySelector('.recruit-close').focus({ preventScroll: true });
    },

    close() {
        if (!this.isOpen) return;
        if (this._overlay) this._overlay.style.display = 'none';
        const previousFocus = this._previousFocus;
        this._previousFocus = null;
        if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus({ preventScroll: true });
    },

    _ensureElement() {
        if (this._overlay) return;
        const overlay = document.createElement('div');
        overlay.id = 'recruitOverlay';
        overlay.className = 'recruit-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'recruitTitle');
        // 拦截新操作，释放事件仍交给全局输入清除已有按键/拖动状态。
        for (const type of ['pointerdown', 'mousedown', 'click']) {
            overlay.addEventListener(type, event => event.stopPropagation());
        }
        overlay.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
            if (event.key !== 'Tab') return;
            const buttons = [...overlay.querySelectorAll('button:not(:disabled)')];
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (!buttons.includes(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
                event.preventDefault(); (event.shiftKey ? last : first)?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first?.focus();
            }
        });
        // EXE 会把当前窗口的 Esc 作为 electron-esc 转发；从属模态需要先于
        // 全局面板链消费它，避免关闭背后的队员/出征页面而留下招募层。
        window.addEventListener('electron-esc', event => {
            if (!this.isOpen) return;
            event.preventDefault?.();
            event.stopImmediatePropagation?.();
            this.close();
        }, true);
        // 事件委托：点背景关闭；点卡片按钮加入（重建卡片后绑定不丢失）
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { this.close(); return; }
            // 点卡片任意位置（含按钮）都触发加入——避免用户点卡片空白区"没反应"
            if (e.target.closest('.recruit-card')) { this._handleCardClick(e); }
        });
        overlay.innerHTML = `
            <div class="recruit-panel">
                <div class="recruit-header">
                    <span class="recruit-title" id="recruitTitle">🔍 寻找帮手</span>
                    <button type="button" class="recruit-close" aria-label="关闭寻找帮手">✕</button>
                </div>
                <div class="recruit-sub">选择一位助手加入队伍（最多 ${PartySystem.maxSize} 名侍从）</div>
                <div class="recruit-status" id="recruitStatus"></div>
                <div class="recruit-cards" id="recruitCards"></div>
            </div>
        `;
        overlay.querySelector('.recruit-close').onclick = () => this.close();
        // 队员面板的子模态，仍在统一层内但高于普通右栏面板。
        mountRightSidebarPanel(overlay, 'modal');
        this._overlay = overlay;
    },

    _render() {
        const cards = this._overlay.querySelector('#recruitCards');
        const restoreFocus = this.isOpen && cards.contains(document.activeElement);
        const status = this._overlay.querySelector('#recruitStatus');
        if (status) status.textContent = '';
        const candidates = PartySystem.candidates;
        const full = PartySystem.isFull;
        cards.innerHTML = candidates.map(a => {
            // 已在队：禁用；已解锁：再次加入继承历史状态；未解锁：新招募
            const disabled = full || a.inParty;
            const btnText = a.inParty ? '已在队'
                : (a.unlocked ? '再次加入（继承状态）' : (full ? '队伍已满' : '加入队伍'));
            return `
                <div class="recruit-card ${disabled ? 'recruit-card--disabled' : ''}" data-id="${a.id}">
                    <div class="recruit-card-avatar">${a.avatar}</div>
                    <div class="recruit-card-name">${a.name}</div>
                    <div class="recruit-card-title">${a.title}</div>
                    <div class="recruit-card-desc">${a.desc}</div>
                    <div class="recruit-card-growth">成长：${a.growthRule}</div>
                    <button type="button" class="recruit-card-btn" ${disabled ? 'disabled' : ''}>
                        ${btnText}
                    </button>
                </div>
            `;
        }).join('');
        if (restoreFocus) this._overlay.querySelector('.recruit-close').focus({ preventScroll: true });
    },

    /** 卡片点击（事件委托：overlay 级统一监听，重建卡片后绑定不丢失，防"点了没反应"） */
    _handleCardClick(e) {
        const card = e.target.closest('.recruit-card');
        if (!card || card.classList.contains('recruit-card--disabled')) return;
        const btn = card.querySelector('.recruit-card-btn');
        if (btn && btn.disabled) return;
        e.stopPropagation();
        const id = card && card.dataset.id;
        if (!id) return;
        const status = this._overlay.querySelector('#recruitStatus');
        const name = card.querySelector('.recruit-card-name')?.textContent || id;
        try {
            const ok = PartySystem.addCompanion(id);
            if (ok) {
                // 成功反馈 + 延迟关闭（让用户看到结果；组队栏/出征栏已随 onChange 刷新）
                if (status) {
                    status.textContent = `✅ ${name} 已加入队伍`;
                    status.className = 'recruit-status recruit-status--ok';
                }
                setTimeout(() => this.close(), 500);
            } else {
                const reason = PartySystem.isFull ? '队伍已满'
                    : (PartySystem.members.some(m => m.id === id) ? '已在队中'
                        : '加入失败（未知档案）');
                if (status) {
                    status.textContent = `⚠️ ${reason}`;
                    status.className = 'recruit-status recruit-status--warn';
                }
                if (btn) { btn.textContent = reason; btn.disabled = true; }
                setTimeout(() => this._render(), 1200);
            }
        } catch (err) {
            console.error('[RecruitUI] addCompanion failed:', id, err);
            if (status) {
                status.textContent = `❌ 加入出错：${String(err && err.message ? err.message : err)}`;
                status.className = 'recruit-status recruit-status--err';
            }
            if (btn) btn.textContent = '加入出错';
            setTimeout(() => this._render(), 1500);
        }
    },
};
