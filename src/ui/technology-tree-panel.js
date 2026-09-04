import { Game } from '../game.js';
import { PhaserGame } from '../phaser/PhaserGame.js';
import { EventBus } from '../core/event-bus.js';
import { TimerManager } from '../utils/timer-manager.js';
import { TechnologySystem } from '../world/technology-system.js';
import { isInstantTechnologyResearchEnabled } from '../config/dev-cheats.js';
import { CONFIG } from '../config/config.js';
import { UIState } from './ui-state.js';
import { mountRightSidebarPanel } from './right-sidebar-panel-layer.js';

const CARD_W = 210;
const CARD_H = 88;
const COL_GAP = 80;
const LANE_GAP = 22;
const ROUTED_LANE_GAP = 44;
const CARD_ORIGIN_X = 52;
const CARD_ORIGIN_Y = 74;
const BRANCHES = Object.freeze(['工程', '军事指挥', '经济与位面', '位面独特科技']);
const MILITARY_BRANCH = '军事指挥';
const ECONOMY_BRANCH = '经济与位面';
const MILITARY_CARD_ORIGIN_X = 210;
const ECONOMY_CARD_ORIGIN_X = 180;
const MILITARY_SUB_BRANCH_ROWS = Object.freeze([
    Object.freeze({ label: '草屋→特战', lane: 0, span: 1 }),
    Object.freeze({ label: '军营', lane: 1, span: 1 }),
    Object.freeze({ label: '黑火药→靶场', lane: 2, span: 1 }),
    Object.freeze({ label: '骑兵学院', lane: 3, span: 1 }),
    Object.freeze({ label: '教堂', lane: 4, span: 1 }),
    Object.freeze({ label: '指挥', lane: 5, span: 1 }),
    Object.freeze({ label: '军事支援', lane: 6, span: 2 }),
]);
const ECONOMY_SUB_BRANCH_ROWS = Object.freeze([
    Object.freeze({ label: '住房', lane: 0, span: 1 }),
    Object.freeze({ label: '农业', lane: 1, span: 3 }),
    Object.freeze({ label: '金币', lane: 4, span: 2 }),
    Object.freeze({ label: '能源', lane: 6, span: 3 }),
    Object.freeze({ label: '仓储', lane: 9, span: 1 }),
]);
const PREREQUISITE_ROUTE_COLORS = Object.freeze([
    '#69d4dc',
    '#e4b45d',
    '#b58be3',
    '#76c98f',
]);

function prerequisiteRouteColor(index, total) {
    if (total <= 1) return '';
    return PREREQUISITE_ROUTE_COLORS[index % PREREQUISITE_ROUTE_COLORS.length];
}

function cardOriginX(branch) {
    if (branch === MILITARY_BRANCH) return MILITARY_CARD_ORIGIN_X;
    if (branch === ECONOMY_BRANCH) return ECONOMY_CARD_ORIGIN_X;
    return CARD_ORIGIN_X;
}

function subBranchRows(branch) {
    if (branch === MILITARY_BRANCH) return MILITARY_SUB_BRANCH_ROWS;
    if (branch === ECONOMY_BRANCH) return ECONOMY_SUB_BRANCH_ROWS;
    return [];
}

function positionOf(node) {
    const originX = cardOriginX(node?.branch);
    return {
        x: originX + (Number(node.column) || 0) * (CARD_W + COL_GAP),
        y: CARD_ORIGIN_Y + (Number(node.lane) || 0) * (CARD_H + laneGap(node?.branch)),
    };
}

function laneGap(branch) {
    return branch === ECONOMY_BRANCH || branch === MILITARY_BRANCH ? ROUTED_LANE_GAP : LANE_GAP;
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

function renderRecruitmentTierLines(plan) {
    const lines = Array.isArray(plan?.lines) ? plan.lines : [];
    if (!lines.length) {
        return `<li>${escapeHtml(plan?.note || '本级兵种路线尚未规划')}</li>`;
    }
    return lines.map((line) => {
        const route = line.fromUnitName
            ? `${line.fromUnitName} → ${line.unitName}`
            : line.unitName;
        const status = line.placeholder === true ? '待开发' : '已开发';
        const profile = line.profile ? ` · ${line.profile}` : '';
        return `<li><b>${escapeHtml(line.role || '兵种')}</b>：${escapeHtml(route)}${escapeHtml(profile)} <span>${status}</span></li>`;
    }).join('');
}

function renderPrerequisiteRequirements(node, emptyLabel = '无') {
    const status = TechnologySystem.getPrerequisiteStatus(node.id);
    if (!status.totalCount) {
        return `<div class="technology-detail-prerequisites">${escapeHtml(emptyLabel)}</div>`;
    }
    const rule = status.totalCount > 1
        ? `<div class="technology-prerequisite-rule"><b>AND</b><span>全部完成后解锁 · ${status.completedCount}/${status.totalCount}</span></div>`
        : '';
    const items = status.requiredIds.map((requiredId, index) => {
        const required = TechnologySystem.getNode(requiredId);
        const completed = TechnologySystem.isCompleted(requiredId);
        const routeColor = prerequisiteRouteColor(index, status.totalCount) || '#69d4dc';
        return `<div class="technology-prerequisite-item ${completed ? 'completed' : 'pending'}" style="--technology-route-color:${routeColor}">
            <span class="technology-prerequisite-route-index">${index + 1}</span>
            <span>${escapeHtml(required?.name || requiredId)}</span>
            <small>${completed ? '已完成' : '待研发'}</small>
        </div>`;
    }).join('');
    return `${rule}<div class="technology-prerequisite-list">${items}</div>`;
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
            if (!this.isOpen || (event.code !== 'Escape' && event.code !== CONFIG.KEYS.TECHNOLOGY)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) this.close();
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
                TechnologySystem.update(
                    elapsedMs,
                    instituteCount,
                    TechnologySystem.lastResearchRate,
                    TechnologySystem.lastRawResearchRate
                );
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
        const rawRate = Math.max(rate, Number(TechnologySystem.lastRawResearchRate) || 0);
        const queue = TechnologySystem.getResearchQueue();
        const etaIds = queue.length ? queue : (active ? [active.id] : []);
        const eta = TechnologySystem.getEstimatedSeconds(etaIds, rate);
        const setText = (role, value) => {
            const element = this._el.querySelector(`[data-live-role="${role}"]`);
            if (element) element.textContent = value;
        };
        setText('institute-count', `科研设施 ${instituteCount}`);
        setText('research-rate', rawRate > rate + 0.05
            ? `研究速度 +${rate.toFixed(1)}/秒（原始 ${rawRate.toFixed(1)}）`
            : `研究速度 +${rate.toFixed(1)}/秒`);
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
            <div class="technology-prerequisite-legend" data-role="legend" aria-label="科技连线图例"></div>
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
            const researchableNodes = nodes.filter((node) => node.placeholder !== true);
            const baselineCount = nodes.filter((node) => node.baseline === true).length;
            const plannedCount = nodes.filter((node) =>
                node.placeholder === true && node.baseline !== true).length;
            const completed = researchableNodes
                .filter((node) => TechnologySystem.isCompleted(node.id)).length;
            const active = nodes.some((node) => node.id === TechnologySystem.state.activeTechId);
            return `<button type="button" class="technology-tree-branch-tab${branch === this._selectedBranch ? ' active' : ''}" data-branch="${escapeHtml(branch)}">
                <span>${escapeHtml(branch)}</span>
                <small>${completed}/${researchableNodes.length}${baselineCount ? ` · ${baselineCount}基线` : ''}${plannedCount ? ` · ${plannedCount}规划` : ''}${active ? ' · 研发中' : ''}</small>
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
        const rawRate = Math.max(rate, Number(TechnologySystem.lastRawResearchRate) || 0);
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
                <span data-live-role="institute-count">科研设施 ${instituteCount}</span>
                <span data-live-role="research-rate">${rawRate > rate + 0.05
                    ? `研究速度 +${rate.toFixed(1)}/秒（原始 ${rawRate.toFixed(1)}）`
                    : `研究速度 +${rate.toFixed(1)}/秒`}</span>
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
        const originX = cardOriginX(this._selectedBranch);
        canvas.style.width = `${originX + (maxColumn + 1) * (CARD_W + COL_GAP) + 48}px`;
        const rowGap = laneGap(this._selectedBranch);
        canvas.style.height = `${Math.max(420, CARD_ORIGIN_Y + (maxLane + 1) * (CARD_H + rowGap) + 40)}px`;

        const pathFocusActive = selectedPath.size > 1;
        const focusRoutes = [];
        const focusJunctions = new Map();
        const addFocusRoute = (path, marker = false) => focusRoutes.push({ path, marker });
        const addFocusJunction = (x, y) => {
            focusJunctions.set(`${x}:${y}`,
                `<circle class="technology-link-focus-junction" cx="${x}" cy="${y}" r="4.5" />`);
        };
        const prerequisiteEntries = nodes.flatMap((node) => {
            const prerequisites = TechnologySystem.getPrerequisiteStatus(node.id).requiredIds;
            return prerequisites.map((requiredId, prerequisiteIndex) => ({
                node,
                prerequisites,
                requiredId,
                prerequisiteIndex,
                from: TechnologySystem.getNode(requiredId),
            })).filter((entry) => visibleIds.has(entry.requiredId) && entry.from);
        });
        const outgoingBySource = new Map();
        for (const entry of prerequisiteEntries) {
            if (!outgoingBySource.has(entry.requiredId)) outgoingBySource.set(entry.requiredId, []);
            outgoingBySource.get(entry.requiredId).push(entry);
        }
        // 时代门槛同时通往三项以上右侧科技时使用共享总线，避免多根长线叠成一束。
        const sharedBusSourceIds = new Set([...outgoingBySource.entries()]
            .filter(([sourceId, entries]) => entries.filter((entry) =>
                Number(entry.node.column) > Number(entry.from.column)).length >= 3
                && (this._selectedBranch === ECONOMY_BRANCH
                    || (this._selectedBranch === MILITARY_BRANCH && sourceId === 'gunpowder')))
            .map(([sourceId]) => sourceId));
        const isSharedBusEntry = (entry) => sharedBusSourceIds.has(entry.requiredId)
            && Number(entry.node.column) > Number(entry.from.column);
        const busSourcesByColumn = new Map();
        for (const sourceId of sharedBusSourceIds) {
            const column = Number(TechnologySystem.getNode(sourceId)?.column) || 0;
            if (!busSourcesByColumn.has(column)) busSourcesByColumn.set(column, []);
            busSourcesByColumn.get(column).push(sourceId);
        }
        for (const sourceIds of busSourcesByColumn.values()) {
            sourceIds.sort((leftId, rightId) =>
                (Number(TechnologySystem.getNode(leftId)?.lane) || 0)
                - (Number(TechnologySystem.getNode(rightId)?.lane) || 0));
        }
        const sharedBusX = (sourceId) => {
            const source = TechnologySystem.getNode(sourceId);
            const ids = busSourcesByColumn.get(Number(source?.column) || 0) || [];
            const index = Math.max(0, ids.indexOf(sourceId));
            return positionOf(source).x + CARD_W + 8 + index * 10;
        };
        const gateTarget = (entry) => {
            const b = positionOf(entry.node);
            const count = entry.prerequisites.length;
            if (count <= 1) {
                if (Number(entry.node.column) === Number(entry.from.column)) {
                    const targetBelow = b.y >= positionOf(entry.from).y;
                    return {
                        usesGate: false,
                        x: b.x + CARD_W * (entry.prerequisiteIndex + 1) / (count + 1),
                        y: targetBelow ? b.y : b.y + CARD_H,
                    };
                }
                return { usesGate: false, x: b.x, y: b.y + CARD_H / 2 };
            }
            const spacing = Math.min(12, 38 / Math.max(1, count - 1));
            return {
                usesGate: true,
                x: b.x - 42,
                y: b.y + CARD_H / 2
                    + (entry.prerequisiteIndex - (count - 1) / 2) * spacing,
            };
        };
        const edgeState = (entry, extraClass = '') => {
            const satisfied = TechnologySystem.isCompleted(entry.requiredId);
            const selected = selectedPath.has(entry.requiredId) && selectedPath.has(entry.node.id);
            const muted = pathFocusActive && !selected;
            const routeColor = prerequisiteRouteColor(
                entry.prerequisiteIndex,
                entry.prerequisites.length
            );
            return {
                satisfied,
                selected,
                muted,
                className: `technology-link${entry.prerequisites.length > 1 ? ' multi-prerequisite' : ''}${satisfied ? ' prerequisite-satisfied' : ''}${muted ? ' path-muted' : ''}${extraClass}`,
                style: routeColor ? ` style="--technology-link-color:${routeColor}"` : '',
            };
        };
        const routePath = (entry, target) => {
            const a = positionOf(entry.from);
            const b = positionOf(entry.node);
            const columnDelta = Number(entry.node.column) - Number(entry.from.column);
            if (columnDelta === 0) {
                const targetBelow = b.y >= a.y;
                const x1 = a.x + CARD_W / 2;
                const y1 = targetBelow ? a.y + CARD_H : a.y;
                const midY = (y1 + target.y) / 2;
                return `M ${x1} ${y1} V ${midY} H ${target.x} V ${target.y}`;
            }
            const direction = Math.sign(columnDelta);
            const x1 = a.x + (direction > 0 ? CARD_W : 0);
            const y1 = a.y + CARD_H / 2;
            if (Math.abs(columnDelta) > 1) {
                const departX = x1 + direction * 18;
                const arrivalX = target.x - direction * 12;
                const gutterY = direction > 0 ? a.y + CARD_H + 12 : a.y - 12;
                return `M ${x1} ${y1} H ${departX} V ${gutterY} H ${arrivalX} V ${target.y} H ${target.x}`;
            }
            const midX = (x1 + target.x) / 2;
            return `M ${x1} ${y1} H ${midX} V ${target.y} H ${target.x}`;
        };

        const busMarkup = [];
        const branchMarkup = [];
        for (const sourceId of sharedBusSourceIds) {
            const entries = (outgoingBySource.get(sourceId) || [])
                .filter(isSharedBusEntry);
            const source = TechnologySystem.getNode(sourceId);
            const a = positionOf(source);
            const sourceX = a.x + CARD_W;
            const sourceY = a.y + CARD_H / 2;
            const busX = sharedBusX(sourceId);
            const routes = entries.map((entry) => {
                const target = gateTarget(entry);
                const b = positionOf(entry.node);
                const trackY = Number(entry.node.column) - Number(source.column) > 1
                    ? b.y - rowGap * (entry.prerequisiteIndex + 1)
                        / (entry.prerequisites.length + 1)
                    : target.y;
                const arrivalX = target.x - 12;
                const path = `M ${busX} ${trackY} H ${arrivalX} V ${target.y} H ${target.x}`;
                return { entry, target, trackY, path };
            });
            const busTop = Math.min(sourceY, ...routes.map((route) => route.trackY));
            const busBottom = Math.max(sourceY, ...routes.map((route) => route.trackY));
            const busSatisfied = TechnologySystem.isCompleted(sourceId);
            const busClass = `technology-link technology-link-bus${busSatisfied ? ' prerequisite-satisfied' : ''}${pathFocusActive ? ' path-muted' : ''}`;
            const junctionClass = `technology-link-junction${busSatisfied ? ' prerequisite-satisfied' : ''}${pathFocusActive ? ' path-muted' : ''}`;
            busMarkup.push(`<path class="${busClass}" d="M ${sourceX} ${sourceY} H ${busX} M ${busX} ${busTop} V ${busBottom}" />
                <circle class="${junctionClass}" cx="${busX}" cy="${sourceY}" r="3" />`);
            for (const route of routes) {
                const state = edgeState(route.entry, ' technology-link-branch');
                const marker = route.target.usesGate ? '' : ' marker-end="url(#technology-arrow)"';
                const port = route.target.usesGate
                    ? `<circle class="technology-link-port${state.satisfied ? ' prerequisite-satisfied' : ''}${state.muted ? ' path-muted' : ''}" cx="${route.target.x}" cy="${route.target.y}" r="4"${state.style} />`
                    : '';
                branchMarkup.push(`<path class="${state.className}" d="${route.path}"${marker}${state.style} />${port}
                    <circle class="technology-link-junction${state.satisfied ? ' prerequisite-satisfied' : ''}${state.muted ? ' path-muted' : ''}" cx="${busX}" cy="${route.trackY}" r="3" />`);
                if (state.selected) {
                    addFocusRoute(`M ${sourceX} ${sourceY} H ${busX} V ${route.trackY} ${route.path.slice(route.path.indexOf('H'))}`,
                        !route.target.usesGate);
                    addFocusJunction(busX, sourceY);
                    addFocusJunction(busX, route.trackY);
                    if (route.target.usesGate) addFocusJunction(route.target.x, route.target.y);
                }
            }
        }

        const routedMarkup = prerequisiteEntries
            .filter((entry) => !isSharedBusEntry(entry))
            .map((entry) => {
                const target = gateTarget(entry);
                const state = edgeState(entry);
                const path = routePath(entry, target);
                const marker = target.usesGate ? '' : ' marker-end="url(#technology-arrow)"';
                const port = target.usesGate
                    ? `<circle class="technology-link-port${state.satisfied ? ' prerequisite-satisfied' : ''}${state.muted ? ' path-muted' : ''}" cx="${target.x}" cy="${target.y}" r="4"${state.style} />`
                    : '';
                if (state.selected) {
                    addFocusRoute(path, !target.usesGate);
                    if (target.usesGate) addFocusJunction(target.x, target.y);
                }
                return `<path class="${state.className}" d="${path}"${marker}${state.style} />${port}`;
            }).join('');

        const gateMarkup = nodes.filter((node) =>
            TechnologySystem.getPrerequisiteStatus(node.id).totalCount > 1).map((node) => {
            const status = TechnologySystem.getPrerequisiteStatus(node.id);
            const b = positionOf(node);
            const x = b.x - 42;
            const y = b.y + CARD_H / 2 - 12;
            const satisfied = status.completedCount === status.totalCount;
            const selected = selectedPath.has(node.id);
            const muted = pathFocusActive && !selected;
            const gateClass = `technology-convergence-gate${satisfied ? ' prerequisite-satisfied' : ''}${muted ? ' path-muted' : ''}`;
            const outputClass = `technology-link technology-link-gate-output${satisfied ? ' prerequisite-satisfied' : ''}${muted ? ' path-muted' : ''}`;
            const outputPath = `M ${x + 28} ${y + 12} H ${b.x}`;
            if (pathFocusActive && selected) addFocusRoute(outputPath, true);
            return `<g class="${gateClass}"><rect x="${x}" y="${y}" width="28" height="24" rx="5" /><text x="${x + 14}" y="${y + 15}" text-anchor="middle">AND</text></g>
                <path class="${outputClass}" d="${outputPath}" marker-end="url(#technology-arrow)" />`;
        }).join('');
        const focusHalos = focusRoutes.map(({ path }) =>
            `<path class="technology-link-focus-halo" d="${path}" />`).join('');
        const focusCores = focusRoutes.map(({ path, marker }) =>
            `<path class="technology-link-focus" d="${path}"${marker ? ' marker-end="url(#technology-focus-arrow)"' : ''} />`).join('');
        const focusJunctionMarkup = [...focusJunctions.values()].join('');

        const cards = nodes.map((node) => {
            const pos = positionOf(node);
            const placeholder = node.placeholder === true;
            const baseline = node.baseline === true;
            const completed = TechnologySystem.isCompleted(node.id);
            const activeNode = TechnologySystem.state.activeTechId === node.id;
            const available = TechnologySystem.isAvailable(node.id);
            const prerequisiteStatus = TechnologySystem.getPrerequisiteStatus(node.id);
            const convergenceTech = prerequisiteStatus.totalCount > 1;
            // 已完成状态优先于位面遮蔽：开发工具/旧档可以在位面尚未开放时
            // 合法写入位面专项科技完成项，不能再被 UI 伪装成“未知科技”。
            const worldRequirementLocked = !completed
                && !TechnologySystem.isWorldRequirementMet(node.id);
            const worldMasked = worldRequirementLocked && !!node.requiredWorldId;
            const worldCountLocked = worldRequirementLocked
                && Math.max(0, Number(node.requiredWorldCount) || 0) > 0;
            const stateClass = completed ? 'completed' : baseline ? 'baseline' : placeholder ? 'planned'
                : activeNode ? 'active-tech' : available ? 'available' : 'locked';
            const progress = TechnologySystem.getProgress(node.id);
            const percent = completed ? 100 : Math.min(100, (progress / node.researchCost) * 100);
            const queuedAt = queueIndex.get(node.id);
            const stateText = completed ? (node.initiallyCompleted === true ? '初始解锁' : '已完成')
                : baseline ? '现役一级'
                : placeholder ? `规划占位 · ${node.researchCost}`
                : worldMasked ? '未知位面科技'
                : worldCountLocked ? `需要${node.requiredWorldCount}个位面`
                : activeNode ? '研发中'
                : queuedAt ? `队列 ${queuedAt}` : available ? '可研究'
                : convergenceTech ? `前置 ${prerequisiteStatus.completedCount}/${prerequisiteStatus.totalCount}`
                : '前置未满足';
            const pathClass = selectedPath.has(node.id) ? ' path-node' : '';
            const targetClass = TechnologySystem.state.targetTechId === node.id ? ' path-target' : '';
            const crossPrerequisiteIds = (node.prerequisites || [])
                .filter((id) => !visibleIds.has(id));
            const crossPrerequisite = crossPrerequisiteIds.length > 0;
            const crossPrerequisiteLabel = crossPrerequisiteIds.map((id) => {
                const required = TechnologySystem.getNode(id);
                const masked = required?.requiredWorldId
                    && !TechnologySystem.isCompleted(id)
                    && !TechnologySystem.isWorldRequirementMet(id);
                return masked ? '未知位面科技' : required?.name || id;
            }).join(' + ');
            return `<button type="button" class="technology-card ${stateClass}${convergenceTech ? ' convergence-tech' : ''}${node.militaryTrunk === true ? ' military-trunk' : ''}${worldMasked ? ' world-masked' : ''}${node.section === 'plane' ? ' plane-research' : ''}${crossPrerequisite ? ' cross-prerequisite' : ''}${this._selectedId === node.id ? ' selected' : ''}${pathClass}${targetClass}"
                data-tech-id="${escapeHtml(node.id)}" style="left:${pos.x}px;top:${pos.y}px">
                ${queuedAt ? `<span class="technology-card-queue-index">${queuedAt}</span>` : ''}
                ${crossPrerequisite ? `<span class="technology-card-cross-prerequisite${selectedPath.has(node.id) ? ' selected-path' : ''}" title="跨分支前置：${escapeHtml(crossPrerequisiteLabel)}"><span>↗ ${escapeHtml(crossPrerequisiteLabel)}</span></span>` : ''}
                ${convergenceTech ? `<span class="technology-card-prerequisite-gate" aria-label="全部前置完成后解锁，已完成 ${prerequisiteStatus.completedCount} 项，共 ${prerequisiteStatus.totalCount} 项"><b>AND</b>${prerequisiteStatus.completedCount}/${prerequisiteStatus.totalCount}</span>` : ''}
                ${renderTechnologyIcon(node, 'technology-card-icon')}
                <span class="technology-card-copy"><strong>${escapeHtml(node.name)}</strong><small data-live-role="card-state">${stateText}${placeholder || node.initiallyCompleted === true ? '' : ` · ${node.researchCost}`}</small></span>
                <span class="technology-card-progress"><i data-live-role="card-progress" style="width:${percent}%"></i></span>
            </button>`;
        }).join('');

        const sectionTitle = this._selectedBranch === '位面独特科技'
            ? this._selectedBranch
            : `${this._selectedBranch}科技`;
        const branchRows = subBranchRows(this._selectedBranch);
        const label = `<div class="technology-section-label${this._selectedBranch === '位面独特科技' ? ' plane' : ''}" style="top:${branchRows.length ? 8 : 28}px">${escapeHtml(sectionTitle)}</div>`;
        const subBranchLabels = branchRows.length
            ? branchRows.map((row) => {
                const top = CARD_ORIGIN_Y + row.lane * (CARD_H + rowGap);
                const height = row.span * (CARD_H + rowGap) - rowGap;
                return `<div class="technology-subbranch-label row-label" style="left:28px;top:${top}px;width:${originX - 64}px;height:${height}px">${escapeHtml(row.label)}</div>`;
            }).join('')
            : '';
        const legend = this._el.querySelector('[data-role="legend"]');
        if (legend) {
            legend.innerHTML = `<b>线路图例</b><span><i></i>已完成</span><span><i class="pending"></i>待研发</span><span><i class="focus"></i>当前选中路线</span><span><i class="bus"></i>共享时代总线</span>${this._selectedBranch === MILITARY_BRANCH ? '<span><i class="trunk"></i>纵向建筑骨架</span>' : ''}<span>AND = 前置全部完成</span><span>↗ = 跨分支前置</span>`;
        }
        const svgDefs = `<defs>
            <marker id="technology-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 7 3.5 L 0 7 z" class="technology-arrow-head" /></marker>
            <marker id="technology-focus-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 7 3.5 L 0 7 z" class="technology-focus-arrow-head" /></marker>
        </defs>`;
        canvas.innerHTML = `<svg class="technology-links" width="100%" height="100%">${svgDefs}${busMarkup.join('')}${branchMarkup.join('')}${routedMarkup}${gateMarkup}${focusHalos}${focusCores}${focusJunctionMarkup}</svg>${label}${subBranchLabels}${cards}`;
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
        const worldRequirementLocked = !completed
            && !TechnologySystem.isWorldRequirementMet(node.id);
        const worldMasked = worldRequirementLocked && !!node.requiredWorldId;
        const worldCountLocked = worldRequirementLocked
            && Math.max(0, Number(node.requiredWorldCount) || 0) > 0;
        const active = TechnologySystem.state.activeTechId === node.id;
        const isTarget = TechnologySystem.state.targetTechId === node.id;
        const progress = TechnologySystem.getProgress(node.id);
        const prerequisiteStatus = TechnologySystem.getPrerequisiteStatus(node.id);
        const prerequisiteHeading = prerequisiteStatus.totalCount > 1
            ? '前置科技 · 全部完成后解锁'
            : '前置科技';
        const plan = completed ? [] : TechnologySystem.getResearchPlan(node.id);
        const instantResearch = isInstantTechnologyResearchEnabled();
        const eta = TechnologySystem.getEstimatedSeconds(plan, TechnologySystem.lastResearchRate);
        const planNames = plan.map((id) => TechnologySystem.getNode(id)?.name || id);
        const planMarkup = prerequisiteStatus.totalCount > 1
            ? `<div class="technology-detail-plan-rule"><b>AND</b><span>系统会先完成所有未满足前置，再研究目标科技</span></div>
                <div class="technology-detail-plan-queue">${planNames.map((name, index) => `<span><b>${index + 1}</b>${escapeHtml(name)}</span>`).join('')}</div>`
            : planNames.map(escapeHtml).join(' → ');
        const recruitmentTierPlan = TechnologySystem.getRecruitmentTierPlan(
            node.recruitmentTierId
        );
        if (worldMasked) {
            detail.innerHTML = `
                <div class="technology-detail-icon">▦</div>
                <div class="technology-detail-branch">未知位面科技</div>
                <h3>资料受到位面干扰</h3>
                <p>解锁对应位面后，该科技项目才会解除马赛克并允许查看与研究。</p>
                <button class="technology-research-button" type="button" disabled>位面尚未解锁</button>`;
            return;
        }
        if (node.placeholder === true) {
            const baseline = node.baseline === true;
            detail.innerHTML = `
                ${renderTechnologyIcon(node, 'technology-detail-icon')}
                <div class="technology-detail-branch">${escapeHtml(`${node.branch}科技 · ${node.subBranch || '规划'}`)}</div>
                <h3>${escapeHtml(node.name)}</h3>
                <p>${escapeHtml(node.description)}</p>
                <h4>${prerequisiteHeading}</h4>
                ${renderPrerequisiteRequirements(node)}
                <h4>${baseline ? '一级现役路线' : '升级替换路线'}</h4>
                <ul class="technology-tier-route">${renderRecruitmentTierLines(recruitmentTierPlan)}</ul>
                <h4>科研预算</h4>
                <div class="technology-detail-prerequisites">${baseline
                    ? '一级编制随建筑投入使用，无需额外科研'
                    : `基础科研 ${node.baseResearchCost} · 成本曲线折算 ${node.researchCost} 点`}</div>
                <p>${baseline
                    ? '一级卡用于展示现役兵种基线；未开发的同级兵种仍保持占位。'
                    : '整级兵种资源全部闭环后才会开放研究；完成时自动替换本建筑可招募兵种，已经出兵的旧单位不变。'}</p>
                <button class="technology-research-button" type="button" disabled>${baseline ? '现役一级' : '规划占位'}</button>`;
            return;
        }
        detail.innerHTML = `
            ${renderTechnologyIcon(node, 'technology-detail-icon')}
            <div class="technology-detail-branch">${escapeHtml(node.section === 'plane' ? '位面独特科技' : `${node.branch}科技`)}</div>
            <h3>${escapeHtml(node.name)}</h3>
            <p>${escapeHtml(node.description)}</p>
            <div class="technology-detail-progress"><span><i data-live-role="detail-progress-bar" style="width:${completed ? 100 : (progress / node.researchCost) * 100}%"></i></span><b data-live-role="detail-progress-text">${completed ? (node.initiallyCompleted === true ? '初始解锁' : '已完成') : `${Math.floor(progress)} / ${node.researchCost}`}</b></div>
            <h4>${prerequisiteHeading}</h4>
            ${renderPrerequisiteRequirements(node, node.section === 'plane' ? '对应位面已解锁' : '无')}
            ${node.requiredWorldCount ? `<div class="technology-world-requirement ${worldCountLocked ? 'pending' : 'completed'}">控制至少${node.requiredWorldCount}个位面 · ${worldCountLocked ? '未满足' : '已满足'}</div>` : ''}
            <h4>解锁内容</h4>
            <ul>${(node.unlocks || []).map((unlock) => `<li>${escapeHtml(unlock.label || unlock.id)}</li>`).join('')}</ul>
            ${recruitmentTierPlan ? `
                <h4>${node.baseline === true ? '一级现役路线' : '升级替换路线'}</h4>
                <ul class="technology-tier-route">${renderRecruitmentTierLines(recruitmentTierPlan)}</ul>
                <p>${node.baseline === true
                    ? '一级编制随游戏开始直接生效；各兵种仍分别服从自己的科技解锁。'
                    : '建筑名称与贴图在科研完成后立即升级；本级两条兵种线全部开发并登记后，后续招募自动换代，已经出兵的旧单位不变。'}</p>` : ''}
            <h4>研究计划</h4>
            <div class="technology-detail-plan">
                ${completed
                    ? (node.initiallyCompleted === true ? '该科技为新游戏与旧存档默认完成的初始节点' : '该科技已经完成')
                    : `${planMarkup}<b data-live-role="detail-eta">预计 ${formatEta(eta)}</b>`}
            </div>
            <button class="technology-research-button${isTarget && !instantResearch ? ' secondary' : ''}" type="button" ${completed || worldCountLocked ? 'disabled' : ''}>
                ${completed ? (node.initiallyCompleted === true ? '初始解锁' : '已完成') : worldCountLocked ? `需要控制${node.requiredWorldCount}个位面`
                    : instantResearch ? (plan.length > 1 ? `瞬间研发该科技（含 ${plan.length - 1} 项前置）` : '瞬间研发该科技')
                    : isTarget ? '取消目标并恢复自动研究' : active && !TechnologySystem.state.targetTechId ? '转为研究目标' : '设为研究目标'}
            </button>`;
        detail.querySelector('.technology-research-button')?.addEventListener('click', () => {
            if (instantResearch) {
                TechnologySystem.completeResearchNow(node.id);
                this.render();
                return;
            }
            const changed = isTarget
                ? TechnologySystem.clearResearchTarget()
                : TechnologySystem.setResearchTarget(node.id);
            if (changed) this.render();
        });
    },

    _countLiveInstitutes() {
        const buildings = Game?.ProducerBuildingSystem?.buildings || [];
        return buildings.filter((building) => building?.active !== false
            && (building?._economyType === 'research'
                || building?._economyType === 'weather_forecast'
                || building?._economyType === 'advanced_research')
            && Number(building?.data?.hp ?? building?.hp ?? 1) > 0).length;
    },
};
