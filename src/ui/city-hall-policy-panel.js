import { BasePanel, closeBasePanels } from './panels/base-panel.js';
import { mountRightSidebarPanel } from './right-sidebar-panel-layer.js';
import { Input } from './input.js';
import {
    CITY_POLICIES, POLICY_BY_ID, normalizeCityHallPolicyPlan, policyCost,
    policyBlockReason, allocatePolicy, refundPolicy, planPolicyTarget,
    movePolicyInQueue, removePolicyFromQueue,
} from '../world/city-hall-policy-plan.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

/** Civ-style branch planning. Draft points are deliberately isolated from the economy. */
export const CityHallPolicyPanel = {
    open(building, { isValid, onReturn }) {
        if (!isValid()) return;
        if (this.panel?.isOpen) return;
        this.building = building;
        this.isValid = isValid;
        this.onReturn = onReturn;
        this.draft = normalizeCityHallPolicyPlan(building._cityHallPolicyPlan, building.level);
        this.saved = JSON.stringify(this.draft);
        this.selected = this.draft.queue[0] || CITY_POLICIES.nodes[0].id;
        this.returnToDetail = false;
        closeBasePanels('buildingDetail');
        window.Game?.BuildingSystem?.close?.();
        this.ensurePanel();
        this.panel.open();
    },

    ensurePanel() {
        if (this.panel) return;
        this.panel = new BasePanel({
            id: 'cityHallPolicyPanel', className: 'city-hall-policy-panel',
            stateKey: 'cityHallPolicies', panelGroup: 'rightSidebar', closeOnEscape: true,
            mountElement: (el) => mountRightSidebarPanel(el, 'modal', { bringToFront: true }),
        });
        this.panel.buildContent = (el) => this.build(el);
        this.keepFocus = (event) => {
            if (this.panel.isOpen && !this.panel.el.contains(event.target)) {
                this.panel.el.querySelector('[data-return]')?.focus({ preventScroll: true });
            }
        };
        this.panel.onOpen = () => {
            this.clearInput(); this.panel.el.setAttribute('aria-hidden', 'false');
            document.addEventListener('focusin', this.keepFocus, true);
            this.render(); this.message('模拟点数仅用于规划，不消耗资源，也不授予收益。');
            this.timer = setInterval(() => {
                if (!this.isValid?.()) { this.reset(); return; }
                this.text('actual-era', `当前基地 LV${this.building.level}`);
            }, 750);
            this.panel.el.querySelector('[data-policy-id]')?.focus({ preventScroll: true });
        };
        this.panel.onClose = () => {
            clearInterval(this.timer); this.timer = null;
            document.removeEventListener('focusin', this.keepFocus, true);
            this.panel.el.setAttribute('aria-hidden', 'true'); this.clearInput();
            const callback = this.returnToDetail && this.isValid?.() ? this.onReturn : null;
            this.building = null; this.draft = null; this.onReturn = null; this.isValid = null;
            this.returnToDetail = false;
            callback?.();
        };
    },

    reset() {
        this.returnToDetail = false;
        this.panel?.close();
    },

    clearInput() {
        Input.keys.clear();
        Input.mouse.leftDown = Input.mouse.rightDown = false;
        Input.mouse.leftPressed = Input.mouse.rightPressed = false;
        window.Game?.entities?.get('player')?._rtsController?.hold?.();
    },

    build(el) {
        el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'chPolicyTitle');
        el.setAttribute('aria-describedby', 'chPolicyNotice');
        el.innerHTML = `
            <div class="cp-shell">
                <header class="cp-header"><div><p class="ch-kicker">市政厅 / SOCIAL POLICIES</p><h2 id="chPolicyTitle">社会政策与发展路线</h2><p class="ch-muted"><span data-actual-era></span> · 当前位面的独立规划</p></div><button type="button" class="ch-button" data-return>返回市政厅</button></header>
                <div class="cp-notice" id="chPolicyNotice"><b>规划未生效</b><span>点数为模拟预算；所有收益均为设计草案。保存路线不会扣除资源、解锁科技或改变实际产出。</span></div>
                <div class="cp-toolbar"><label>模拟政务点<input type="number" min="1" max="99" step="1" data-budget></label><label>预览时代<select data-era><option value="1">LV1 · 古典</option><option value="2">LV2 · 自治</option><option value="3">LV3 · 现代</option></select></label><div class="cp-metric"><span>已用 / 剩余</span><strong data-points></strong></div><div class="cp-metric"><span>待规划成本</span><strong data-route-cost></strong></div><span class="ch-badge" data-dirty></span></div>
                <main class="cp-main">
                    <section class="cp-tree-pane" aria-label="政策分支与前置关系"><div class="cp-tree-heading"><h3>选择你的发展路线</h3><p class="ch-muted">由上至下推进 · 分叉后汇合 · 跨分支自由安排</p><div class="cp-legend"><span>○ 未采纳</span><span>◇ 已入路线</span><span>✓ 模拟采纳</span><span>锁 前置 / 时代 / 点数不足</span></div></div><div class="cp-tree-scroll" tabindex="0" aria-label="政策树，可横向滚动"><div class="cp-branches">${CITY_POLICIES.branches.map((branch) => `
                        <section class="cp-branch" aria-label="${branch.name}"><header><span class="cp-branch-mark">${branch.mark}</span><h3>${branch.name}</h3><p>${branch.summary}</p><button type="button" class="ch-button" data-route-target="${branch.target}">规划完整分支</button></header><div class="cp-graph"><svg class="cp-links" viewBox="0 0 100 520" preserveAspectRatio="none" aria-hidden="true"><path d="M50 56 V122 H25 V188 M50 122 H75 V188 M25 188 V254 H50 V320 M75 188 V254 H50 M50 320 V452" /></svg>${CITY_POLICIES.nodes.filter((node) => node.branch === branch.id).map((node) => `
                            <button type="button" class="cp-node cp-node--${node.position}" data-policy-id="${node.id}" aria-pressed="false"><span class="cp-node-meta">LV${node.era} · ${node.cost} 点</span><strong>${node.name}</strong><span class="cp-node-state" data-node-state></span></button>`).join('')}</div></section>`).join('')}</div></div></section>
                    <aside class="cp-inspector" aria-label="政策详情与发展队列">
                        <section class="cp-detail"><div class="ch-section-heading"><span class="ch-kicker" data-selected-branch></span><span class="ch-badge" data-selected-cost></span></div><h3 data-selected-name></h3><p data-selected-description></p><div class="cp-proposal"><small>预期设计 · 未实装收益</small><p data-selected-proposal></p></div><dl class="ch-facts"><dt>前置政策</dt><dd data-prerequisites></dd><dt>时代条件</dt><dd data-selected-era></dd><dt>当前状态</dt><dd data-selected-state></dd></dl><div class="cp-detail-actions"><button type="button" class="ch-button" data-allocate>模拟采纳</button><button type="button" class="ch-button" data-refund title="一并退回依赖此项的已模拟政策">退回本项及后续</button><button type="button" class="ch-button" data-add-target>加入发展路线</button></div></section>
                        <section class="cp-route"><div class="ch-section-heading"><h3>发展队列</h3><strong data-queue-count></strong></div><p class="ch-muted">自动补齐前置。上移 / 下移调整顺序；移除前置会同时移除依赖项。可先规划未来时代。</p><ol data-queue></ol><p class="ch-empty" data-queue-empty>从左侧选择政策，加入你的第一条路线。</p><button type="button" class="ch-button" data-advance>模拟推进下一项</button><p class="ch-muted" data-next-block></p></section>
                        <details class="cp-adopted"><summary>已模拟采纳 <span data-adopted-count></span></summary><ul data-adopted></ul></details>
                    </aside>
                </main>
                <footer class="cp-footer"><div><p class="ch-feedback" data-feedback role="status" aria-live="polite"></p><small class="ch-muted">保存到基地后随游戏存档持久化；返回 / Esc 丢弃未保存改动。世界继续运行。</small></div><div class="cp-footer-actions"><button type="button" class="ch-button" data-reset>清空模拟与路线</button><button type="button" class="ch-button ch-primary" data-save>保存规划</button></div></footer>
            </div>`;
        el.addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (!button || button.disabled || !this.draft) return;
            if (!this.isValid?.()) { this.reset(); return; }
            if (button.hasAttribute('data-return')) { this.returnToDetail = true; this.panel.close(); return; }
            if (button.dataset.policyId) this.selected = button.dataset.policyId;
            else if (button.dataset.routeTarget) {
                planPolicyTarget(this.draft, button.dataset.routeTarget);
                this.message('已加入完整分支；保留原有路线，并自动补齐前置。');
            } else if (button.dataset.queueAction) {
                const id = button.dataset.queueId;
                if (button.dataset.queueAction === 'select') this.selected = id;
                else if (button.dataset.queueAction === 'remove') {
                    removePolicyFromQueue(this.draft, id); this.message('已移除本项及依赖它的排队政策。');
                } else if (!movePolicyInQueue(this.draft, id, button.dataset.queueAction === 'up' ? -1 : 1)) {
                    this.message('不能越过前置关系或队列边界。');
                }
            } else if (button.hasAttribute('data-add-target')) {
                planPolicyTarget(this.draft, this.selected); this.message('已加入发展路线，前置政策已自动补齐。');
            } else if (button.hasAttribute('data-allocate') || button.hasAttribute('data-advance')) {
                const id = button.hasAttribute('data-advance') ? this.draft.queue[0] : this.selected;
                const result = allocatePolicy(this.draft, id);
                this.message(result.ok ? `已模拟采纳「${POLICY_BY_ID.get(id).name}」；实际收益未生效。` : result.reason);
            } else if (button.hasAttribute('data-refund')) {
                const count = refundPolicy(this.draft, this.selected); this.message(`已退回 ${count} 项模拟政策及对应点数；路线所需前置已补回。`);
            } else if (button.hasAttribute('data-reset')) {
                this.draft.allocated = []; this.draft.queue = []; this.message('已清空当前草稿；保存前不影响基地原有规划。');
            } else if (button.hasAttribute('data-save')) {
                this.draft = normalizeCityHallPolicyPlan(this.draft, this.building.level);
                this.building._cityHallPolicyPlan = normalizeCityHallPolicyPlan(this.draft);
                this.saved = JSON.stringify(this.draft);
                this.message('规划已保存到当前基地；随下次游戏存档持久化。实际产出不变。');
            }
            this.render();
        });
        el.querySelector('[data-budget]').onchange = (event) => {
            if (!this.panel.isOpen || !this.draft || !this.isValid?.()) return;
            const budget = Number(event.target.value);
            if (Number.isInteger(budget) && budget >= 1 && budget <= 99 && budget >= policyCost(this.draft.allocated)) {
                this.draft.budget = budget; this.message('已调整模拟预算；不会增加实际资源。');
            } else this.message('预算需为1～99的整数，且不能少于已用点数；请先退回模拟政策。');
            this.render();
        };
        el.querySelector('[data-era]').onchange = (event) => {
            if (!this.panel.isOpen || !this.draft || !this.isValid?.()) return;
            const era = Number(event.target.value);
            if (this.draft.allocated.some((id) => POLICY_BY_ID.get(id).era > era)) {
                this.message('已模拟采纳更高时代的政策；请先退回这些政策再降低预览时代。');
            } else { this.draft.era = era; this.message('已切换预览时代；不会提升基地等级或解锁科技。'); }
            this.render();
        };
        el.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab') return;
            const controls = [...el.querySelectorAll('button:not(:disabled), input, select, summary, [tabindex="0"]')].filter((control) => control.getClientRects().length && !control.closest('[hidden]'));
            if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
            else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        });
    },

    text(key, value) {
        const element = this.panel.el.querySelector(`[data-${key}]`);
        if (element.textContent !== String(value)) element.textContent = String(value);
    },
    message(value) { this.text('feedback', value); },

    render() {
        const el = this.panel.el;
        const plan = this.draft;
        const node = POLICY_BY_ID.get(this.selected);
        const spent = policyCost(plan.allocated);
        this.text('actual-era', `当前基地 LV${this.building.level}`);
        this.text('points', `${spent} / ${plan.budget - spent}`);
        this.text('route-cost', `${policyCost(plan.queue)} 点`);
        this.text('dirty', JSON.stringify(plan) === this.saved ? '已与基地规划同步' : '草稿未保存');
        el.querySelector('[data-budget]').value = plan.budget;
        el.querySelector('[data-era]').value = plan.era;
        for (const button of el.querySelectorAll('[data-policy-id]')) {
            const id = button.dataset.policyId;
            const adopted = plan.allocated.includes(id);
            const queued = plan.queue.includes(id);
            const reason = policyBlockReason(plan, id);
            button.setAttribute('aria-pressed', String(id === this.selected));
            button.classList.toggle('is-adopted', adopted);
            button.classList.toggle('is-queued', queued);
            button.classList.toggle('is-locked', !adopted && !!reason);
            button.querySelector('[data-node-state]').textContent = adopted ? '✓ 模拟采纳' : queued ? `◇ 路线第 ${plan.queue.indexOf(id) + 1} 项` : reason ? '锁 · 条件未满足' : '○ 可模拟采纳';
            button.title = `${POLICY_BY_ID.get(id).name}：${reason || '可模拟采纳'}${queued ? '；已加入路线' : ''}`;
        }
        this.text('selected-branch', CITY_POLICIES.branches.find((branch) => branch.id === node.branch).name);
        this.text('selected-name', node.name); this.text('selected-cost', `${node.cost} 模拟点`);
        this.text('selected-description', node.description); this.text('selected-proposal', node.proposal);
        this.text('prerequisites', node.requires.map((id) => POLICY_BY_ID.get(id).name).join(' + ') || '无，分支起点');
        this.text('selected-era', `LV${node.era} · 预览为 LV${plan.era}`);
        const reason = policyBlockReason(plan, node.id);
        this.text('selected-state', reason || '条件满足，可模拟采纳');
        el.querySelector('[data-allocate]').disabled = !!reason;
        el.querySelector('[data-allocate]').title = reason;
        el.querySelector('[data-refund]').disabled = !plan.allocated.includes(node.id);
        el.querySelector('[data-add-target]').disabled = plan.allocated.includes(node.id) || plan.queue.includes(node.id);
        this.text('queue-count', `${plan.queue.length} 项`);
        this.text('adopted-count', `${plan.allocated.length} 项`);
        const focus = document.activeElement;
        const focusAction = focus?.dataset.queueAction;
        const focusId = focus?.dataset.queueId;
        el.querySelector('[data-queue]').innerHTML = plan.queue.map((id, index) => {
            const entry = POLICY_BY_ID.get(id);
            return `<li><div class="cp-queue-copy"><span class="cp-queue-number">${String(index + 1).padStart(2, '0')}</span><button type="button" class="cp-queue-name" data-queue-action="select" data-queue-id="${id}">${entry.name}<small>LV${entry.era} · ${entry.cost} 点</small></button></div><div class="cp-queue-actions"><button type="button" class="ch-button" data-queue-action="up" data-queue-id="${id}" aria-label="上移${entry.name}"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" class="ch-button" data-queue-action="down" data-queue-id="${id}" aria-label="下移${entry.name}"${index === plan.queue.length - 1 ? ' disabled' : ''}>↓</button><button type="button" class="ch-button" data-queue-action="remove" data-queue-id="${id}" aria-label="移除${entry.name}及依赖项">移除</button></div></li>`;
        }).join('');
        if (focusAction) {
            const nextFocus = [...el.querySelectorAll('[data-queue-action]')].find((button) => button.dataset.queueId === focusId && button.dataset.queueAction === focusAction && !button.disabled);
            (nextFocus || el.querySelector(`[data-policy-id="${this.selected}"]`)).focus({ preventScroll: true });
        }
        el.querySelector('[data-queue-empty]').hidden = plan.queue.length > 0;
        const nextReason = plan.queue.length ? policyBlockReason(plan, plan.queue[0]) : '尚未规划路线';
        el.querySelector('[data-advance]').disabled = !!nextReason;
        this.text('next-block', nextReason || `下一项：${POLICY_BY_ID.get(plan.queue[0]).name}。仅模拟推进，仍需保存。`);
        el.querySelector('[data-adopted]').innerHTML = plan.allocated.length ? plan.allocated.map((id) => `<li><b>${POLICY_BY_ID.get(id).name}</b><p>${escapeHtml(POLICY_BY_ID.get(id).proposal)}</p></li>`).join('') : '<li>尚未模拟采纳政策。</li>';
        el.querySelector('[data-save]').disabled = JSON.stringify(plan) === this.saved;
    },
};
