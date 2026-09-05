import { EventBus } from '../core/event-bus.js';
import { FirstExpeditionTutorial } from '../quest/first-expedition-tutorial.js';
import { FirstPlaneSettlementTutorial } from '../quest/first-plane-settlement-tutorial.js';
import { QuestStore } from '../quest/quest-store.js';

const REFRESH_MS = 750;

export const FirstExpeditionGuide = {
    _root: null,
    _signature: '',
    _unsubscribe: null,
    _timer: null,
    _uiTarget: null,
    _announcer: null,
    _announcedStage: '',

    init() {
        if (this._root?.isConnected) return;
        const root = document.createElement('aside');
        root.id = 'firstExpeditionGuide';
        root.className = 'first-expedition-guide';
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', '当前新手目标');
        root.hidden = true;
        document.body.appendChild(root);
        const announcer = document.createElement('div');
        announcer.className = 'first-expedition-guide__announcer';
        announcer.setAttribute('role', 'status');
        announcer.setAttribute('aria-live', 'polite');
        announcer.setAttribute('aria-atomic', 'true');
        document.body.appendChild(announcer);
        this._root = root;
        this._announcer = announcer;
        this._unsubscribe ||= QuestStore.subscribe(() => this.refresh());
        EventBus.on('world:dungeon-run-recorded', () => this.refresh());
        EventBus.on('world:first-founding-selection-opened', () => this.refresh());
        this._timer ||= window.setInterval(() => this.refresh(), REFRESH_MS);
        this.refresh();
    },

    refresh() {
        if (!this._root?.isConnected) return;
        const guide = FirstExpeditionTutorial.getGuideState()
            || FirstPlaneSettlementTutorial.getGuideState();
        if (!guide) {
            this._root.hidden = true;
            this._signature = '';
            this._announcedStage = '';
            delete document.body.dataset.firstExpeditionTarget;
            delete document.body.dataset.firstTutorialDirectionTarget;
            delete document.body.dataset.firstTutorialSeries;
            delete document.body.dataset.firstTutorialStage;
            this._setUiTarget(null);
            document.body.classList.remove('first-expedition-guide-active');
            return;
        }
        if (guide.targetId) document.body.dataset.firstExpeditionTarget = guide.targetId;
        else delete document.body.dataset.firstExpeditionTarget;
        if (guide.directionTargetId) {
            document.body.dataset.firstTutorialDirectionTarget = guide.directionTargetId;
        } else {
            delete document.body.dataset.firstTutorialDirectionTarget;
        }
        this._setUiTarget(guide.domTargetSelector || null);
        document.body.classList.add('first-expedition-guide-active');
        const seriesLabel = guide.seriesLabel || '新手主线';
        document.body.dataset.firstTutorialSeries = seriesLabel;
        document.body.dataset.firstTutorialStage = guide.stage || '';
        const total = Math.max(1, Number(guide.total) || 4);
        const footer = guide.footer || `当前目标：${guide.targetLabel} · 按 L 查看任务档案`;
        const signature = [guide.stage, seriesLabel, guide.step, total, guide.title,
            guide.targetLabel, guide.detail, footer].join('|');
        if (signature !== this._signature) {
            this._signature = signature;
            this._root.innerHTML = `
                <span class="first-expedition-guide__eyebrow">${seriesLabel} <b>${String(guide.step).padStart(2, '0')} / ${String(total).padStart(2, '0')}</b></span>
                <strong class="first-expedition-guide__title">${guide.title}</strong>
                <span class="first-expedition-guide__detail">${guide.detail}</span>
                <small class="first-expedition-guide__target">${footer}</small>`;
        }
        if (guide.stage && guide.stage !== this._announcedStage) {
            this._announcedStage = guide.stage;
            if (this._announcer) {
                this._announcer.textContent = `${seriesLabel}，${guide.title}。${guide.detail}`;
            }
        }
        this._root.hidden = false;
    },

    _setUiTarget(selector) {
        const next = String(selector || '')
            .split(',')
            .map((candidate) => candidate.trim())
            .filter(Boolean)
            .map((candidate) => document.querySelector(candidate))
            .find((element) => element && !element.hidden && element.getClientRects().length > 0)
            || null;
        if (this._uiTarget === next) return;
        this._uiTarget?.classList?.remove('first-tutorial-ui-target');
        this._uiTarget = next;
        this._uiTarget?.classList?.add('first-tutorial-ui-target');
    },
};

export default FirstExpeditionGuide;
