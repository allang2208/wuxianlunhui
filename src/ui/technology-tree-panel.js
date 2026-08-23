import { Game } from '../game.js';
import { PhaserGame } from '../phaser/PhaserGame.js';
import { EventBus } from '../core/event-bus.js';
import { TimerManager } from '../utils/timer-manager.js';
import { TechnologySystem } from '../world/technology-system.js';
import { UIState } from './ui-state.js';
import { mountRightSidebarPanel } from './right-sidebar-panel-layer.js';

const CARD_W = 210;
const CARD_H = 88;
const COL_GAP = 80;
const LANE_GAP = 22;
const CARD_ORIGIN_X = 52;
const CARD_ORIGIN_Y = 74;
const BRANCHES = Object.freeze(['工程', '军事指挥', '经济与位面', '位面独特科技']);

function positionOf(node) {
    return {
        x: CARD_ORIGIN_X + (Number(node.column) || 0) * (CARD_W + COL_GAP),
        y: CARD_ORIGIN_Y + (Number(node.lane) || 0) * (CARD_H + LANE_GAP),
    };
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function renderTechnologyIcon(node, className) {
    const fallback = escapeHtml(node?.icon || '◆');
    const iconPath = String(node?.iconPath || '').trim();
    if (!iconPath) return `<span class="${className}">${fallback}</span>`;
    return `<span class="${className} has-image">
        <span class="technology-icon-fallback" aria-hidden="true">${fallback}</span>
        <img src="${escapeHtml(iconPath)}" alt="" draggable="false">
    </span>`;
}

function formatEta(seconds) {
    if (seconds == null || !Number.isFinite(seconds)) return '无科研产出';
    const total = Math.max(0, Math.ceil(seconds));
    if (total < 60) return `${total}秒`;
    const minutes = Math.floor(total / 60);
    const remainSeconds = total % 60;
    if (minutes < 60) return `${minutes}分${String(remainSeconds).padStart(2, '0')}秒`;
    const hours = Math.floor(minutes / 60);
    return `${hours}时${String(minutes % 60).padStart(2, '0')}分`;
}

function researchModeLabel(mode) {
    if (mode === 'target') return '目标队列';
    if (mode === 'auto') return '自动随机';
    return '等待研究';
}

export const TechnologyTreePanel = {
    _el: null,
    _selectedId: null,
    _selectedBranch: BRANCHES[0],
    _initialized: false,
    _open: false,
    _pausedByPanel: false,
    _sideMenuStates: [],
    _progressTimer: null,
    _lastProgressAt: 0,
    _panState: null,
    _suppressPanClick: false,
    _panClickResetTimer: null,

    init() {
        if (this._initialized) return;
        this._initialized = true;
        window.addEventListener('keydown', (event) => {
            if (!this.isOpen || event.code !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.close();
        }, true);
        window.addEventListener('electron-esc', (event) => {
            if (!this.isOpen) return;
            event.preventDefault?.();
            event.stopImmediatePropagation?.();
            this.close();
        }, true);
        EventBus.on('technology:changed', (payload) => {
            if (!this.isOpen) return;
            if (payload?.reason === 'progress') this._refreshLiveProgress();
            else this.render();
        });
    },

    get isOpen() {
        return this._open;
    },

    open() {
        this.init();
        if (this.isOpen || !Game?.isRunning) return;
        this._open = true;
        this._ensureElement();
        const initial = TechnologySystem.getNode(TechnologySystem.state.targetTechId)
            || TechnologySystem.getNode(TechnologySystem.state.activeTechId)
            || TechnologySystem.getAvailableNodes()[0]
            || TechnologySystem.getTreeNodes()[0]
            || null;
        this._selectedId = initial?.id || null;
        this._selectedBranch = BRANCHES.includes(initial?.branch) ? initial.branch : BRANCHES[0];
        this.render();
        this._pausedByPanel = !Game._paused;
        if (this._pausedByPanel) {
            Game._paused = true;
            TimerManager.pause();
            try { PhaserGame.game?.pause?.(); } catch (error) { console.error('[TechnologyTreePanel] pause failed:', error); }
        }
        this._startProgressTicker();
        this._sideMenuStates = Array.from(document.querySelectorAll('.side-menu'))
            .map((menu) => ({ menu, wasHidden: menu.classList.contains('hidden') }));
        this._sideMenuStates.forEach(({ menu }) => menu.classList.add('hidden'));
        UIState.open('technologyTree');
        EventBus.emit('ui:panel-open', 'technologyTree');
        requestAnimationFrame(() => {
            if (this._open) this._el?.classList.add('active');
        });
    },

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    },

    close() {
        if (!this.isOpen) return;
        this._open = false;
        this._stopProgressTicker();
        this._el.classList.remove('active');
        this._sideMenuStates.forEach(({ menu, wasHidden }) => {
            if (!wasHidden) menu.classList.remove('hidden');
        });
        this._sideMenuStates = [];
        UIState.close('technologyTree');
        if (this._pausedByPanel) {
            this._pausedByPanel = false;
            TimerManager.resume();
            Game._paused = false;
            try { PhaserGame.game?.resume?.(); } catch (error) { console.error('[TechnologyTreePanel] resume failed:', error); }
        }
    },

    _startProgressTicker() {
        this._stopProgressTicker();
        this._lastProgressAt = performance.now();
        this._progressTimer = window.setInterval(() => {
            if (!this.isOpen) return;
            const now = performance.now();
            const elapsedMs = Math.max(0, now - this._lastProgressAt);
            this._lastProgressAt = now;
            // 科技页会冻结战斗与世界计时；研究是显式被动例外，由本面板接管这一段时间，
            // 避免 WorldSimDriver 停止后进度条看似实时、实际数值却不动。
            if (this._pausedByPanel) {
                const instituteCount = TechnologySystem.lastInstituteCount || this._countLiveInstitutes();
                TechnologySystem.update(elapsedMs, instituteCount, TechnologySystem.lastResearchRate);
            }
            this._refreshLiveProgress();
        }, 100);
    },

    _stopProgressTicker() {
        if (this._progressTimer != null) window.clearInterval(this._progressTimer);
        this._progressTimer = null;
        this._lastProgressAt = 0;
    },

    _refreshLiveProgress() {
        if (!this._el || !this.isOpen) return;
        const active = TechnologySystem.getNode(TechnologySystem.state.activeTechId);
        const renderedActive = this._el.querySelector('.technology-card.active-tech')?.dataset.techId || null;
        const activeVisible = active && this._nodesForBranch(this._selectedBranch)
            .some((node) => node.id === active.id);
        if ((activeVisible ? active.id : null) !== renderedActive) {
            this.render();
            return;
        }
        const instituteCount = TechnologySystem.lastInstituteCount || this._countLiveInstitutes();
        const rate = Math.max(0, Number(TechnologySystem.lastResearchRate) || 0);
        const queue = TechnologySystem.getResearchQueue();
        const etaIds = queue.length ? queue : (active ? [active.id] : []);
        const eta = TechnologySystem.getEstimatedSeconds(etaIds, rate);
        const setText = (role, value) => {
            const element = this._el.querySelector(`[data-live-role="${role}"]`);
            if (element) element.textContent = value;
        };
        setText('institute-count', `研究院 ${instituteCount}`);
        setText('research-rate', `研究速度 +${rate.toFixed(1)}/秒`);
        setText('research-mode', `模式 ${researchModeLabel(TechnologySystem.getResearchMode())}`);
        setText('research-current', `${active ? `${active.name} ${Math.floor(TechnologySystem.getProgress(active.id))}/${active.researchCost}` : '等待自动选择'} · ETA ${formatEta(eta)}`);
        if (active) {
            const progress = TechnologySystem.getProgress(active.id);
            const percent = Math.min(100, progress / Math.max(1, active.researchCost) * 100);
            const card = this._el.querySelector(`[data-tech-id="${active.id}"]`);
            const bar = card?.querySelector('[data-live-role="card-progress"]');
            const state = card?.querySelector('[data-live-role="card-state"]');
            if (bar) bar.style.width = `${percent}%`;
            if (state) state.textContent = `研发中 · ${active.researchCost}`;
        }
        const selected = TechnologySystem.getNode(this._selectedId);
        if (selected && selected.id === active?.id) {
            const progress = TechnologySystem.getProgress(selected.id);
            const percent = Math.min(100, progress / Math.max(1, selected.researchCost) * 100);
            const detailBar = this._el.querySelector('[data-live-role="detail-progress-bar"]');
            if (detailBar) detailBar.style.width = `${percent}%`;
            setText('detail-progress-text', `${Math.floor(progress)} / ${selected.researchCost}`);
            setText('detail-eta', `预计 ${formatEta(TechnologySystem.getEstimatedSeconds(TechnologySystem.getResearchPlan(selected.id), rate))}`);
        }
    },

    _ensureElement() {
        if (this._el) {
            mountRightSidebarPanel(this._el, 'modal', { bringToFront: true });
            return;
        }
        const panel = document.createElement('section');
        panel.id = 'technologyTreePanel';
        panel.className = 'technology-tree-panel';
        panel.setAttribute('aria-label', '科技树');
        panel.innerHTML = `
            <header class="technology-tree-header">
                <div>
                    <div class="technology-tree-kicker">文明发展 / 全局研究</div>
                    <h2>科技树</h2>
                </div>
                <div class="technology-tree-summary" data-role="summary"></div>
                <button class="technology-tree-close" type="button" aria-label="关闭科技树" title="关闭 (ESC)">×</button>
            </header>
            <nav class="technology-tree-branch-tabs" data-role="branches" aria-label="科技分支"></nav>
            <div class="technology-tree-body">
                <div class="technology-tree-viewport" aria-label="科技树画布，按住鼠标左键拖动查看" title="按住鼠标左键拖动查看完整科技树">
                    <div class="technology-tree-canvas" data-role="canvas"></div>
                </div>
                <aside class="technology-tree-detail" data-role="detail"></aside>
            </div>`;
        panel.querySelector('.technology-tree-close')?.addEventListener('click', () => this.close());
        this._bindViewportPanning(panel.querySelector('.technology-tree-viewport'));
        this._el = mountRightSidebarPanel(panel, 'modal', { bringToFront: true });
    },

    _bindViewportPanning(viewport) {
        if (!viewport) return;
        const dragThreshold = 6;
        const finishPan = (event) => {
            const pan = this._panState;
            if (!pan || (event.pointerId != null && event.pointerId !== pan.pointerId)) return;
            if (pan.dragging) {
                this._suppressPanClick = true;
                if (this._panClickResetTimer != null) window.clearTimeout(this._panClickResetTimer);
                this._panClickResetTimer = window.setTimeout(() => {
                    this._suppressPanClick = false;
                    this._panClickResetTimer = null;
                }, 0);
            }
            viewport.classList.remove('is-panning');
            try {
                if (pan.captureTarget?.hasPointerCapture?.(pan.pointerId)) {
                    pan.captureTarget.releasePointerCapture(pan.pointerId);
                }
            } catch (_) { /* pointer capture may already be released */ }
            this._panState = null;
        };

        viewport.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.isPrimary === false) return;
            if (event.target.closest?.('a, input, textarea, select, [contenteditable="true"]')) return;
            if (this._panClickResetTimer != null) window.clearTimeout(this._panClickResetTimer);
            this._panClickResetTimer = null;
            this._suppressPanClick = false;
            const captureTarget = event.target.closest?.('.technology-card') || viewport;
            this._panState = {
                pointerId: event.pointerId,
                captureTarget,
                startX: event.clientX,
                startY: event.clientY,
                scrollLeft: viewport.scrollLeft,
                scrollTop: viewport.scrollTop,
                dragging: false,
            };
            try { captureTarget.setPointerCapture?.(event.pointerId); } catch (_) { /* optional enhancement */ }
        });

        viewport.addEventListener('pointermove', (event) => {
            const pan = this._panState;
            if (!pan || event.pointerId !== pan.pointerId) return;
            const deltaX = event.clientX - pan.startX;
            const deltaY = event.clientY - pan.startY;
            if (!pan.dragging && Math.hypot(deltaX, deltaY) < dragThreshold) return;
            if (!pan.dragging) {
                pan.dragging = true;
                viewport.classList.add('is-panning');
            }
            event.preventDefault();
            viewport.scrollLeft = pan.scrollLeft - deltaX;
            viewport.scrollTop = pan.scrollTop - deltaY;
        });

        viewport.addEventListener('click', (event) => {
            if (!this._suppressPanClick) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this._suppressPanClick = false;
        }, true);
        window.addEventListener('pointerup', finishPan, true);
        window.addEventListener('pointercancel', finishPan, true);
    },

    _nodesForBranch(branch) {
        const baseNodes = TechnologySystem.getTreeNodes().filter((node) => node.branch === branch);
        if (branch !== '位面独特科技') return baseNodes;
        return TechnologySystem.getPlaneResearchNodes();
    },

    _selectBranch(branch) {
        if (!BRANCHES.includes(branch) || branch === this._selectedBranch) return;
        this._selectedBranch = branch;
        const nodes = this._nodesForBranch(branch);
        const preferred = nodes.find((node) => node.id === TechnologySystem.state.targetTechId)
            || nodes.find((node) => node.id === TechnologySystem.state.activeTechId)
            || nodes.find((node) => TechnologySystem.isAvailable(node.id))
            || nodes[0]
            || null;
        this._selectedId = preferred?.id || null;
        this.render();
    },

    _renderBranchTabs() {
        const tabs = this._el?.querySelector('[data-role="branches"]');
        if (!tabs) return;
        tabs.innerHTML = BRANCHES.map((branch) => {
            const nodes = this._nodesForBranch(branch);
            const completed = nodes.filter((node) => TechnologySystem.isCompleted(node.id)).length;
            const active = nodes.some((node) => node.id === TechnologySystem.state.activeTechId);
            return `<button type="button" class="technology-tree-branch-tab${branch === this._selectedBranch ? ' active' : ''}" data-branch="${escapeHtml(branch)}">
                <span>${escapeHtml(branch)}</span>
                <small>${completed}/${nodes.length}${active ? ' · 研发中' : ''}</small>
            </button>`;
        }).join('');
        tabs.querySelectorAll('[data-branch]').forEach((button) => {
            button.addEventListener('click', () => this._selectBranch(button.dataset.branch));
        });
    },

    render() {
        if (!this._el) return;
        const nodes = this._nodesForBranch(this._selectedBranch);
        if (!nodes.some((node) => node.id === this._selectedId)) {
            this._selectedId = nodes.find((node) => node.id === TechnologySystem.state.targetTechId)?.id
                || nodes.find((node) => node.id === TechnologySystem.state.activeTechId)?.id
                || nodes.find((node) => TechnologySystem.isAvailable(node.id))?.id
                || nodes[0]?.id
                || null;
        }
        this._renderBranchTabs();

        const active = TechnologySystem.getNode(TechnologySystem.state.activeTechId);
        const instituteCount = TechnologySystem.lastInstituteCount || this._countLiveInstitutes();
        const rate = Math.max(0, Number(TechnologySystem.lastResearchRate) || 0);
        const queue = TechnologySystem.getResearchQueue();
        const mode = TechnologySystem.getResearchMode();
        const etaIds = queue.length ? queue : (active ? [active.id] : []);
        const eta = TechnologySystem.getEstimatedSeconds(etaIds, rate);
        const summary = this._el.querySelector('[data-role="summary"]');
        if (summary) {
            const current = active
                ? `${escapeHtml(active.name)} ${Math.floor(TechnologySystem.getProgress(active.id))}/${active.researchCost}`
                : '等待自动选择';
            summary.innerHTML = `
                <span data-live-role="institute-count">研究院 ${instituteCount}</span>
                <span data-live-role="research-rate">研究速度 +${rate.toFixed(1)}/秒</span>
                <span data-live-role="research-mode">模式 ${researchModeLabel(mode)}</span>
                <strong data-live-role="research-current">${current} · ETA ${formatEta(eta)}</strong>`;
        }

        const canvas = this._el.querySelector('[data-role="canvas"]');
        if (!canvas) return;
        const selectedPath = new Set(TechnologySystem.getDependencyPath(this._selectedId, { includeCompleted: true }));
        const queueIndex = new Map(queue.map((id, index) => [id, index + 1]));
        const visibleIds = new Set(nodes.map((node) => node.id));
        const maxColumn = Math.max(0, ...nodes.map((node) => Number(node.column) || 0));
        const maxLane = Math.max(0, ...nodes.map((node) => Number(node.lane) || 0));
        canvas.style.width = `${100 + (maxColumn + 1) * (CARD_W + COL_GAP)}px`;
        canvas.style.height = `${Math.max(420, CARD_ORIGIN_Y + (maxLane + 1) * (CARD_H + LANE_GAP) + 40)}px`;

        const lines = nodes.flatMap((node) => (node.prerequisites || []).map((requiredId) => {
            if (!visibleIds.has(requiredId)) return '';
            const from = TechnologySystem.getNode(requiredId);
            if (!from) return '';
            const a = positionOf(from);
            const b = positionOf(node);
            const done = TechnologySystem.isCompleted(requiredId) && TechnologySystem.isCompleted(node.id);
            const selected = selectedPath.has(requiredId) && selectedPath.has(node.id);
            const linkClass = `technology-link${done ? ' completed' : ''}${selected ? ' selected-path' : ''}`;
            if ((Number(from.column) || 0) === (Number(node.column) || 0)) {
                const x = a.x + CARD_W / 2;
                const targetBelow = b.y >= a.y;
                const y1 = targetBelow ? a.y + CARD_H : a.y;
                const y2 = targetBelow ? b.y : b.y + CARD_H;
                return `<path class="${linkClass}" d="M ${x} ${y1} V ${y2}" />`;
            }
            const x1 = a.x + CARD_W;
            const y1 = a.y + CARD_H / 2;
            const x2 = b.x;
            const y2 = b.y + CARD_H / 2;
            const mid = (x1 + x2) / 2;
            return `<path class="${linkClass}" d="M ${x1} ${y1} H ${mid} V ${y2} H ${x2}" />`;
        })).join('');

        const cards = nodes.map((node) => {
            const pos = positionOf(node);
            const completed = TechnologySystem.isCompleted(node.id);
            const activeNode = TechnologySystem.state.activeTechId === node.id;
            const available = TechnologySystem.isAvailable(node.id);
            // 已完成状态优先于位面遮蔽：开发工具/旧档可以在位面尚未开放时
            // 合法写入位面专项科技完成项，不能再被 UI 伪装成“未知科技”。
            const worldMasked = !completed && !TechnologySystem.isWorldRequirementMet(node.id);
            const stateClass = completed ? 'completed' : activeNode ? 'active-tech' : available ? 'available' : 'locked';
            const progress = TechnologySystem.getProgress(node.id);
            const percent = completed ? 100 : Math.min(100, (progress / node.researchCost) * 100);
            const queuedAt = queueIndex.get(node.id);
            const stateText = worldMasked ? '未知位面科技' : completed ? '已完成' : activeNode ? '研发中'
                : queuedAt ? `队列 ${queuedAt}` : available ? '可研究' : '前置未满足';
            const pathClass = selectedPath.has(node.id) ? ' path-node' : '';
            const targetClass = TechnologySystem.state.targetTechId === node.id ? ' path-target' : '';
            const crossPrerequisite = (node.prerequisites || []).some((id) => !visibleIds.has(id));
            return `<button type="button" class="technology-card ${stateClass}${worldMasked ? ' world-masked' : ''}${node.section === 'plane' ? ' plane-research' : ''}${crossPrerequisite ? ' cross-prerequisite' : ''}${this._selectedId === node.id ? ' selected' : ''}${pathClass}${targetClass}"
                data-tech-id="${escapeHtml(node.id)}" style="left:${pos.x}px;top:${pos.y}px">
                ${queuedAt ? `<span class="technology-card-queue-index">${queuedAt}</span>` : ''}
                ${renderTechnologyIcon(node, 'technology-card-icon')}
                <span class="technology-card-copy"><strong>${escapeHtml(node.name)}</strong><small data-live-role="card-state">${stateText} · ${node.researchCost}</small></span>
                <span class="technology-card-progress"><i data-live-role="card-progress" style="width:${percent}%"></i></span>
            </button>`;
        }).join('');

        const sectionTitle = this._selectedBranch === '位面独特科技'
            ? this._selectedBranch
            : `${this._selectedBranch}科技`;
        const label = `<div class="technology-section-label${this._selectedBranch === '位面独特科技' ? ' plane' : ''}" style="top:28px">${escapeHtml(sectionTitle)}</div>`;
        canvas.innerHTML = `<svg class="technology-links" width="100%" height="100%">${lines}</svg>${label}${cards}`;
        canvas.querySelectorAll('[data-tech-id]').forEach((card) => {
            card.addEventListener('click', () => {
                this._selectedId = card.dataset.techId;
                this.render();
            });
        });
        this._renderDetail();
    },

    _renderDetail() {
        const detail = this._el?.querySelector('[data-role="detail"]');
        const node = TechnologySystem.getNode(this._selectedId);
        if (!detail) return;
        if (!node) {
            detail.innerHTML = '<div class="technology-detail-empty">选择一个科技查看详情</div>';
            return;
        }
        const completed = TechnologySystem.isCompleted(node.id);
        // 与卡片保持同一口径；已完成的位面科技必须显示真实详情与解锁内容。
        const worldMasked = !completed && !TechnologySystem.isWorldRequirementMet(node.id);
        const active = TechnologySystem.state.activeTechId === node.id;
        const isTarget = TechnologySystem.state.targetTechId === node.id;
        const progress = TechnologySystem.getProgress(node.id);
        const prerequisiteNames = (node.prerequisites || []).map((id) => TechnologySystem.getNode(id)?.name || id);
        const plan = completed ? [] : TechnologySystem.getResearchPlan(node.id);
        const eta = TechnologySystem.getEstimatedSeconds(plan, TechnologySystem.lastResearchRate);
        const planNames = plan.map((id) => TechnologySystem.getNode(id)?.name || id);
        if (worldMasked) {
            detail.innerHTML = `
                <div class="technology-detail-icon">▦</div>
                <div class="technology-detail-branch">未知位面科技</div>
                <h3>资料受到位面干扰</h3>
                <p>解锁对应位面后，该科技项目才会解除马赛克并允许查看与研究。</p>
                <button class="technology-research-button" type="button" disabled>位面尚未解锁</button>`;
            return;
        }
        detail.innerHTML = `
            ${renderTechnologyIcon(node, 'technology-detail-icon')}
            <div class="technology-detail-branch">${escapeHtml(node.section === 'plane' ? '位面独特科技' : `${node.branch}科技`)}</div>
            <h3>${escapeHtml(node.name)}</h3>
            <p>${escapeHtml(node.description)}</p>
            <div class="technology-detail-progress"><span><i data-live-role="detail-progress-bar" style="width:${completed ? 100 : (progress / node.researchCost) * 100}%"></i></span><b data-live-role="detail-progress-text">${completed ? '已完成' : `${Math.floor(progress)} / ${node.researchCost}`}</b></div>
            <h4>前置科技</h4>
            <div class="technology-detail-prerequisites">${prerequisiteNames.length ? prerequisiteNames.map(escapeHtml).join('、') : (node.section === 'plane' ? '对应位面已解锁' : '无')}</div>
            <h4>解锁内容</h4>
            <ul>${(node.unlocks || []).map((unlock) => `<li>${escapeHtml(unlock.label || unlock.id)}</li>`).join('')}</ul>
            <h4>研究计划</h4>
            <div class="technology-detail-plan">
                ${completed
                    ? '该科技已经完成'
                    : `${planNames.map(escapeHtml).join(' → ')}<b data-live-role="detail-eta">预计 ${formatEta(eta)}</b>`}
            </div>
            <button class="technology-research-button${isTarget ? ' secondary' : ''}" type="button" ${completed ? 'disabled' : ''}>
                ${completed ? '已完成' : isTarget ? '取消目标并恢复自动研究' : active && !TechnologySystem.state.targetTechId ? '转为研究目标' : '设为研究目标'}
            </button>`;
        detail.querySelector('.technology-research-button')?.addEventListener('click', () => {
            const changed = isTarget
                ? TechnologySystem.clearResearchTarget()
                : TechnologySystem.setResearchTarget(node.id);
            if (changed) this.render();
        });
    },

    _countLiveInstitutes() {
        const buildings = Game?.ProducerBuildingSystem?.buildings || [];
        return buildings.filter((building) => building?.active !== false
            && building?.cfgKey === 'research_institute'
            && Number(building?.data?.hp ?? building?.hp ?? 1) > 0).length;
    },
};
