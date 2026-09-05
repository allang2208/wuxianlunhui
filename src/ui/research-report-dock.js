import { EventBus } from '../core/event-bus.js';
import { Game } from '../game.js';
import { MailStore } from '../systems/mail-store.js';
import { SceneManager } from '../world/scene-manager.js';
import { TechnologySystem } from '../world/technology-system.js';
import { WorldStrategySystem } from '../world/world-strategy-system.js';
import { MailboxPanel } from './mailbox-panel.js';
import { TechnologyTreePanel } from './technology-tree-panel.js';
import { WorldSwitchPanel } from './world-switch-panel.js';

const TOAST_DURATION_MS = 6000;
const COLLAPSE_ANIMATION_MS = 260;
const OPEN_WORLD_COMBAT_RADIUS = 900;
const TECHNOLOGY_ICON = 'assets/ui/icons/technology_tree.png';
const MAIL_ICON = 'assets/ui/icons/quest.png';
const WEATHER_ICON = 'assets/ui/technology-icons/weather_forecasting.png';
const ENGINEERING_ICON = 'assets/ui/technology-icons/engineering_drafting.png';
const EXPEDITION_ICON = 'assets/ui/technology-icons/expedition_logistics.png';
const MILITARY_ICON = 'assets/ui/technology-icons/tactical_command.png';

function unlockSummary(node) {
    const labels = (node?.unlocks || [])
        .map((unlock) => unlock.label || unlock.id)
        .filter(Boolean);
    if (!labels.length) return '科研档案已归档';
    const visible = labels.slice(0, 2).join('、');
    return `解锁 ${visible}${labels.length > 2 ? `等 ${labels.length} 项` : ''}`;
}

function mailSummary(mail) {
    const totals = new Map();
    for (const attachment of mail?.attachments || []) {
        const item = attachment?.item;
        if (!item?.name) continue;
        totals.set(item.name, (totals.get(item.name) || 0) + Math.max(1, Number(item.stack) || 1));
    }
    const entries = [...totals.entries()];
    const visible = entries.slice(0, 2)
        .map(([name, stack]) => `${name}${stack > 1 ? ` ×${stack}` : ''}`)
        .join('、');
    return `${visible || '战利品'}${entries.length > 2 ? `等 ${entries.length} 种物品` : ''}已进入信箱，请领取`;
}

function isDangerousMoment() {
    if (!Game?.isRunning || Game._paused || SceneManager.isLoading) return true;
    if (document.body?.classList?.contains('map-mode')) return true;
    const dungeon = globalThis.window?.DungeonMapSystem;
    if (dungeon?.active && (dungeon.state === 'combat' || dungeon.state === 'boss')) return true;

    const player = Game.player;
    if (!player || !(player.hp > 0)) return true;
    const weaponBusy = player.weaponAnim?.state && player.weaponAnim.state !== 'idle';
    if (weaponBusy || player.isDodging || player._attackRecovering
        || player._isWhirlwind || player._whirlwindRecovering || player._isPushStrike
        || player._isDashing || player._dashRecoverAt || player._dashResetAnim
        || player._specialAttackActive || player._specialResetAnim
        || player._runeSwordSpecialActive || player._runeSwordResetAnim) return true;

    for (const entity of Game.entities?.values?.() || []) {
        if (!entity || entity._faction !== 'enemy' || entity.active === false || !(entity.hp > 0)) continue;
        const targetFaction = entity.target?._faction;
        const engaging = entity._aiState === 'chasing' || entity._attackTimer > 0
            || targetFaction === 'player' || targetFaction === 'companion';
        if (!engaging) continue;
        if (Math.hypot(entity.x - player.x, entity.y - player.y) <= OPEN_WORLD_COMBAT_RADIUS) return true;
    }
    return false;
}

const technologyKey = id => `technology:${id}`;
const mailKey = id => `mail:${id}`;
const strategyKey = id => `strategy:${id}`;

function isImportantStrategyEvent(event) {
    return event?.kind === 'engineering_report' || event?.kind === 'expedition_report'
        || (event?.kind === 'battle_result' && (event?.casualties != null || event?.lootCount != null))
        || (event?.kind === 'base_entry' && event?.phase === 'complete');
}

function compactSummary(value) {
    const text = String(value || '报告已归档').trim();
    return text.length > 112 ? `${text.slice(0, 109)}…` : text;
}

export const ResearchReportDock = {
    _initialized: false,
    _root: null,
    _toast: null,
    _inbox: null,
    _activeKey: null,
    _collapseTimer: null,
    _dangerTimer: null,
    _releasedKeys: new Set(),
    _weatherAlerts: new Map(),
    _animationToken: 0,

    init() {
        if (this._initialized || typeof document === 'undefined') return;
        const uiLayer = document.getElementById('uiLayer');
        if (!uiLayer) return;
        this._initialized = true;

        const root = document.createElement('section');
        root.id = 'researchReportDock';
        root.className = 'research-report-dock';
        root.setAttribute('aria-label', '重要信息');
        root.setAttribute('aria-live', 'polite');
        root.innerHTML = `
            <button type="button" class="research-report-toast" data-report-toast hidden>
                <span class="research-report-icon"><img data-report-icon src="${TECHNOLOGY_ICON}" alt=""></span>
                <span class="research-report-copy">
                    <small data-report-eyebrow></small>
                    <strong data-report-title></strong>
                    <span data-report-summary></span>
                </span>
                <span class="research-report-action" data-report-action></span>
            </button>
            <button type="button" class="research-report-inbox" data-report-inbox hidden>
                <img data-report-inbox-icon src="${TECHNOLOGY_ICON}" alt="">
                <span class="research-report-unread" data-report-unread></span>
                <span class="research-report-inbox-label">重要信息</span>
            </button>`;
        uiLayer.appendChild(root);
        this._root = root;
        this._toast = root.querySelector('[data-report-toast]');
        this._inbox = root.querySelector('[data-report-inbox]');
        for (const id of TechnologySystem.getUnreadReportIds()) this._releasedKeys.add(technologyKey(id));
        for (const mail of this._unreadMails()) this._releasedKeys.add(mailKey(mail.id));
        for (const event of WorldStrategySystem.state.events) {
            if (!event.read && isImportantStrategyEvent(event)) this._releasedKeys.add(strategyKey(event.id));
        }
        this._toast.addEventListener('click', () => this._openEntry(this._activeKey));
        this._inbox.addEventListener('click', () => this._openEntry(this._latestEntry()?.key));

        EventBus.on('technology:report-ready', ({ technologyId } = {}) => this.revealTechnology(technologyId));
        EventBus.on('mailbox:report-ready', ({ mailIds } = {}) => this.revealMail(mailIds));
        EventBus.on('weather:report-ready', (alert) => this.revealWeather(alert));
        EventBus.on('weather:report-clear', ({ id } = {}) => this.clearWeather(id));
        EventBus.on('strategy:journal-event', ({ eventId, silent = false } = {}) => {
            const event = WorldStrategySystem.state.events.find((entry) => entry.id === eventId);
            if (!event || event.read || !isImportantStrategyEvent(event)) return;
            const key = strategyKey(event.id);
            this._releasedKeys.add(key);
            if (silent) this._sync();
            else this._revealKey(key);
        });
        EventBus.on('strategy:journal-read', ({ eventIds } = {}) => {
            for (const id of Array.isArray(eventIds) ? eventIds : []) this._releasedKeys.delete(strategyKey(id));
            if (this._activeKey?.startsWith('strategy:') && !this._releasedKeys.has(this._activeKey)) this._collapse(true);
            else this._sync();
        });
        EventBus.on('strategy:journal-restored', () => {
            this._dropReleasedType('strategy:');
            for (const event of WorldStrategySystem.state.events) {
                if (!event.read && isImportantStrategyEvent(event)) this._releasedKeys.add(strategyKey(event.id));
            }
            this._collapse(true);
            this._sync();
        });
        EventBus.on('technology:changed', ({ reason } = {}) => {
            if (reason === 'reset' || reason === 'restore') {
                this._dropReleasedType('technology:');
                if (reason === 'restore') {
                    for (const id of TechnologySystem.getUnreadReportIds()) this._releasedKeys.add(technologyKey(id));
                }
                this._collapse(true);
            }
            this._sync();
        });
        MailStore.subscribe((reason) => {
            if (reason === 'restore') {
                this._dropReleasedType('mail:');
                for (const mail of this._unreadMails()) this._releasedKeys.add(mailKey(mail.id));
                this._collapse(true);
            }
            this._sync();
        });
        this._sync();
    },

    revealTechnology(technologyId) {
        if (!technologyId || !TechnologySystem.getUnreadReportIds().includes(technologyId)) return;
        const key = technologyKey(technologyId);
        this._releasedKeys.add(key);
        this._revealKey(key);
    },

    revealMail(mailIds) {
        const keys = [];
        for (const id of Array.isArray(mailIds) ? mailIds : []) {
            const mail = MailStore.state.mails.find(entry => entry.id === id && !entry.read && entry.attachments.length);
            if (!mail) continue;
            const key = mailKey(id);
            this._releasedKeys.add(key);
            keys.push(key);
        }
        if (keys.length) this._revealKey(keys[0]);
    },

    revealWeather(alert) {
        if (!alert?.id || !alert.title || !alert.summary) return;
        const key = `weather:${alert.id}`;
        this._weatherAlerts.set(alert.id, { ...alert });
        this._releasedKeys.add(key);
        this._revealKey(key);
    },

    clearWeather(id) {
        if (!id) return;
        const key = `weather:${id}`;
        this._weatherAlerts.delete(id);
        this._releasedKeys.delete(key);
        if (this._activeKey === key) this._collapse(true);
        else this._sync();
    },

    _revealKey(key) {
        this._sync();
        if (this._activeKey || isDangerousMoment()) return;
        const entry = this._entryForKey(key);
        if (entry) this._showToast(entry);
    },

    _unreadMails() {
        return MailStore.state.mails
            .filter((mail) => !mail.read && mail.attachments.length)
            .sort((a, b) => a.createdAt - b.createdAt);
    },

    _dropReleasedType(prefix) {
        for (const key of this._releasedKeys) {
            if (key.startsWith(prefix)) this._releasedKeys.delete(key);
        }
    },

    _entryForKey(key) {
        if (key?.startsWith('technology:')) {
            const id = key.slice('technology:'.length);
            if (!TechnologySystem.getUnreadReportIds().includes(id)) return null;
            const node = TechnologySystem.getNode(id);
            if (!node) return null;
            return { key, type: 'technology', id, icon: TECHNOLOGY_ICON,
                eyebrow: '研究院来函 / RESEARCH', title: node.name,
                summary: unlockSummary(node), action: '查看简报 →' };
        }
        if (key?.startsWith('mail:')) {
            const id = key.slice('mail:'.length);
            const mail = MailStore.state.mails.find(entry => entry.id === id && !entry.read && entry.attachments.length);
            if (!mail) return null;
            return { key, type: 'mail', id, icon: MAIL_ICON,
                eyebrow: '小鼠大王来函 / MAIL', title: mail.title || '战利品已寄存',
                summary: mailSummary(mail), action: '前往信箱领取 →' };
        }
        if (key?.startsWith('weather:')) {
            const id = key.slice('weather:'.length);
            const alert = this._weatherAlerts.get(id);
            if (!alert) return null;
            return { key, type: 'weather', id, icon: alert.iconPath || WEATHER_ICON,
                eyebrow: alert.eyebrow || '位面气象警报 / WEATHER', title: alert.title,
                summary: alert.summary, action: '确认预警 →' };
        }
        if (key?.startsWith('strategy:')) {
            const id = Number(key.slice('strategy:'.length));
            const event = WorldStrategySystem.state.events.find((entry) => entry.id === id && !entry.read);
            if (!isImportantStrategyEvent(event)) return null;
            if (event.kind === 'engineering_report') {
                return { key, type: 'engineering', id, icon: ENGINEERING_ICON,
                    eyebrow: '位面工程处 / ENGINEERING', title: event.title,
                    summary: compactSummary(event.detail), action: '打开工程报告 →' };
            }
            if (event.kind === 'expedition_report') {
                return { key, type: 'expedition', id, icon: EXPEDITION_ICON,
                    eyebrow: '探险营地回报 / EXPEDITION', title: event.title,
                    summary: compactSummary(event.detail), action: '打开结算报告 →' };
            }
            return { key, type: 'military', id, icon: MILITARY_ICON,
                eyebrow: event.kind === 'base_entry' ? '军团归营回执 / RETURN' : '军团战报 / CAMPAIGN',
                title: event.title, summary: compactSummary(event.detail), action: '打开结算报告 →' };
        }
        return null;
    },

    _entries() {
        const entries = [];
        for (const key of this._releasedKeys) {
            const entry = this._entryForKey(key);
            if (entry) entries.push(entry);
            else this._releasedKeys.delete(key);
        }
        return entries;
    },

    _latestEntry() {
        const entries = this._entries();
        return entries[entries.length - 1] || null;
    },

    _showToast(entry) {
        if (!entry || !this._toast) return;
        this._activeKey = entry.key;
        const token = ++this._animationToken;
        this._toast.dataset.kind = entry.type;
        this._toast.querySelector('[data-report-icon]').src = entry.icon;
        this._toast.querySelector('[data-report-eyebrow]').textContent = entry.eyebrow;
        this._toast.querySelector('[data-report-title]').textContent = entry.title;
        this._toast.querySelector('[data-report-summary]').textContent = entry.summary;
        this._toast.querySelector('[data-report-action]').textContent = entry.action;
        this._toast.setAttribute('aria-label', `${entry.eyebrow}：${entry.title}，${entry.summary}。${entry.action}`);
        this._toast.hidden = false;
        requestAnimationFrame(() => {
            if (token === this._animationToken) this._toast.classList.add('is-visible');
        });
        if (this._collapseTimer !== null) window.clearTimeout(this._collapseTimer);
        this._collapseTimer = window.setTimeout(() => this._collapse(), TOAST_DURATION_MS);
        if (this._dangerTimer !== null) window.clearInterval(this._dangerTimer);
        this._dangerTimer = window.setInterval(() => {
            if (this._activeKey && isDangerousMoment()) this._collapse();
        }, 250);
        this._sync();
    },

    _collapse(immediate = false) {
        if (this._collapseTimer !== null) window.clearTimeout(this._collapseTimer);
        if (this._dangerTimer !== null) window.clearInterval(this._dangerTimer);
        this._collapseTimer = null;
        this._dangerTimer = null;
        this._activeKey = null;
        const token = ++this._animationToken;
        if (!this._toast) return;
        this._toast.classList.remove('is-visible');
        const finish = () => {
            if (token !== this._animationToken) return;
            this._toast.hidden = true;
            this._sync();
        };
        if (immediate) finish();
        else window.setTimeout(finish, COLLAPSE_ANIMATION_MS);
    },

    _openEntry(key) {
        const entry = this._entryForKey(key);
        if (!entry) return;
        if (entry.type === 'technology') {
            if (!TechnologyTreePanel.openAt(entry.id)) return;
            TechnologySystem.markReportRead(entry.id);
            this._collapse(true);
            return;
        }
        if (entry.type === 'weather') {
            this._weatherAlerts.delete(entry.id);
            this._releasedKeys.delete(entry.key);
            this._collapse(true);
            return;
        }
        if (['engineering', 'expedition', 'military'].includes(entry.type)) {
            if (!WorldSwitchPanel.openAtEvent(entry.id)) return;
            this._releasedKeys.delete(entry.key);
            this._collapse(true);
            return;
        }
        const npc = Game.entities?.get?.('npc_mouse_king');
        if (!MailboxPanel.openAt(entry.id, npc)) {
            SceneManager.showTopNotification('请返回主神空间并靠近小鼠大王，再打开战利品信箱领取', { tone: 'warning' });
            this._collapse(true);
            return;
        }
        this._collapse(true);
    },

    _sync() {
        if (!this._inbox || !this._toast) return;
        const entries = this._entries();
        const activeEntry = entries.find(entry => entry.key === this._activeKey) || null;
        if (this._activeKey && !activeEntry) {
            this._collapse(true);
            return;
        }
        const unread = entries.length;
        const toastVisible = !!activeEntry && !this._toast.hidden;
        const latest = entries[entries.length - 1] || activeEntry;
        const badge = this._inbox.querySelector('[data-report-unread]');
        badge.textContent = unread > 99 ? '99+' : String(unread);
        this._inbox.hidden = unread <= 0 || toastVisible;
        this._inbox.dataset.kind = latest?.type || 'technology';
        this._inbox.querySelector('[data-report-inbox-icon]').src = latest?.icon || TECHNOLOGY_ICON;
        this._inbox.setAttribute('aria-label', `未读重要信息 ${unread} 条，点击查看最新一条`);
        if (toastVisible) {
            const summary = this._toast.querySelector('[data-report-summary]');
            const remaining = Math.max(0, unread - 1);
            summary.textContent = `${activeEntry.summary}${remaining ? ` · 另有 ${remaining} 条未读` : ''}`;
        }
    },
};
