// ============================================================
// 世界切换面板（2026-08-18，多世界并行 M1 配套）
// - 侧边菜单注入「🌐 世界」按钮，随时打开；列出各世界与状态，一键传送。
// - 世界-122 行显示快照概况 + 离线预估战报（previewWorld122Report，纯预览无副作用）。
// - 传送 = SceneManager.switchWorld（离场捕获/入场恢复由快照系统自动完成）。
// ============================================================
import { BasePanel } from './panels/base-panel.js';
import { SceneManager } from '../world/scene-manager.js';
import { Game } from '../game.js';
import { RTSCommand } from './rts-command.js';
import { captureWorld, getWorldSnapshot, isWorldLive, previewWorld122Report } from '../world/world122-snapshot.js';
import { WorldProgressionSystem } from '../world/world-progression-system.js';
import { WorldInstanceSystem } from '../world/world-instance-system.js';
import { mountRightSidebarPanel } from './right-sidebar-panel-layer.js';
import { EventBus } from '../core/event-bus.js';
import { Input } from './input.js';
import { WorldMapView, WORLD_MAP_PLANES } from './world-map-view.js';
import { WORLD_MAP_LENSES, readWorldMapDisplay, saveWorldMapDisplay } from './world-map-display.js';
import { WorldMapCommandFeedback, commandKind, commandBadge } from './world-map-command-feedback.js';
import { WorldMapAudio } from './world-map-audio.js';
import commandMotion from '../../data/world-map-command-feedback.json';
import { ARMY_FLAG_ATLAS_URL, PLAYER_ARMY_MARKER_ID, armyFlagPortrait } from './world-map-army-visuals.js';
import producerBuildings from '../../data/producer-buildings.json';
import { WorldStrategySystem as Strategy } from '../world/world-strategy-system.js';
import { supportArmyHtml } from './world-map-support.js';
import { settlersHtml } from './world-map-settlers.js';
import { strategicTerrainLabel } from '../world/strategic-terrain.js';
import { TroopLineSystem } from '../world/troop-line-system.js';
import { TechnologySystem } from '../world/technology-system.js';
import { strategicCell, worldMapInfo } from '../world/world-map-cells.js';
import {
    strategicTerrain, strategicStepDays, strategicStepMs,
    formatStrategicDuration, formatStrategicTravelTime, strategicClockHint, strategicNow,
} from '../world/strategic-march.js';
import './world-strategy.css';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const WORLDS = [
    { id: 'main', icon: '🏛️', desc: '轮回者营地' },
    { id: 'scene8', icon: '🏜️', desc: '基地防守 · 能源采集' },
    { id: 'scene9', icon: '❄️', desc: '雪覆山脊 · 寒地针林' },
    { id: 'scene10', icon: '🌲', desc: '阔叶密林 · 林间空地' },
    { id: 'scene11', icon: '🕯️', desc: '断柱残垣 · 风化石坪' },
    { id: 'scene12', icon: '⛏️', desc: '层状岩脊 · 露天矿脉' },
];
const visibleWorlds = ({ includeFirstFoundingCandidates = false } = {}) => {
    const foundingCandidates = includeFirstFoundingCandidates
        ? new Set(WorldProgressionSystem.getFirstFoundingCandidates().map((entry) => entry.sceneId))
        : new Set();
    const templateWorlds = WORLDS.filter((world) => world.id === 'main'
        || foundingCandidates.has(world.id)
        || WorldProgressionSystem.isWorldPlayerVisible(world.id));
    const instanceWorlds = includeFirstFoundingCandidates ? []
        : WorldInstanceSystem.listInstances({ persistentOnly: true }).map((instance) => {
            const template = WorldInstanceSystem.getTemplate(instance.templateId);
            return {
                id: instance.instanceId,
                icon: template?.icon || '🌀',
                desc: template?.description || `${template?.name || instance.templateId}实例`,
            };
        }).filter((world) => WorldProgressionSystem.isWorldPlayerVisible(world.id));
    return [...templateWorlds, ...instanceWorlds];
};

export const WorldSwitchPanel = {
    _panel: null,
    _firstFoundingSelection: false,
    _foundingCelebration: null,

    _getPanel() {
        if (!this._panel) {
            this._panel = new BasePanel({
                id: 'worldSwitchPanel',
                className: 'world-switch-panel world-map-panel',
                stateKey: 'worldSwitch',
                panelGroup: 'rightSidebar',
                closeOnEscape: true,
                closeOnOutsidePointer: true,
            });
            this._panel.buildContent = (el) => this._buildContent(el);
            EventBus.on('world-map:changed', () => {
                if (this._panel.isOpen) this._panel.close();
                this._selectedCellId = this._selectedArmyId = this._controlledArmyId = null;
                this._controlledDetachmentId = this._controlledSettlerId = null; this._supplySources = {};
                this._selectedEventId = this._lastOpenedArmyId = this._requestedWorldId = this._requestedEventId = null;
                this._panel.el?.querySelector('[data-coordinate-status]')?.replaceChildren();
            });
            this._panel.onOpen = () => {
                this._previousFocus = document.activeElement;
                this._commandFeedback = '';
                mountRightSidebarPanel(this._panel.el, 'panel', { bringToFront: true });
                EventBus.emit('ui:panel-open', { panel: 'worldSwitch' });
                this._setPanelChrome(true);
                this._clearHeldInput();
                const arrivingArmy = Strategy.inMap && Strategy.state.army && (Strategy._busy || this._lastOpenedArmyId !== Strategy.state.army.id);
                const requestedEvent = Strategy.state.events.find((event) => event.id === this._requestedEventId);
                this._sidebarTab = this._firstFoundingSelection ? 'worlds'
                    : arrivingArmy ? 'army' : requestedEvent ? 'events' : this._requestedWorldId ? 'worlds' : this._sidebarTab || (Strategy.state.army ? 'army' : 'worlds');
                const receiptEvent = !Strategy.active && !this._requestedWorldId && !requestedEvent && Strategy.state.events.slice().reverse().find((event) => event.kind === 'base_entry' && event.phase === 'complete' && !event.read);
                if (requestedEvent) this._selectedEventId = requestedEvent.id;
                else if (receiptEvent) { this._sidebarTab = 'events'; this._selectedEventId = receiptEvent.id; }
                if (arrivingArmy) {
                    this._selectedArmyId = PLAYER_ARMY_MARKER_ID;
                    this._selectedCellId = Strategy.state.army.cellId;
                }
                this._lastOpenedArmyId = Strategy.state.army?.id || null;
                const requestedWorldId = this._requestedWorldId;
                this._requestedWorldId = null;
                this._requestedEventId = null;
                this._panel.el.setAttribute('aria-hidden', 'false');
                const el = this._panel.el;
                el.classList.toggle('is-first-founding-selection', this._firstFoundingSelection);
                const hover = el.querySelector('#wmHover');
                hover.hidden = true;
                hover.textContent = '';
                hover._content = '';
                this._hoverTarget = null;
                this._feedback = new WorldMapCommandFeedback(el.querySelector('.wm-stage'));
                this._map = new WorldMapView(el.querySelector('#wmCanvas'), {
                    onSelect: (id) => this._selectWorld(id),
                    onCellSelect: (cell) => this._selectCell(cell),
                    onSiteSelect: (cell) => this._selectCell(cell, false, 'campaign'),
                    onArmySelect: (id) => this._selectArmy(id),
                    onCommand: (cell, enemyId, options) => this._commandMap(cell, enemyId, options),
                    onHover: (cell, target) => this._hoverChanged(cell, target),
                    onPointer: (point) => this._feedback?.move(point),
                    readMarch: (unit) => Strategy.marchStatus(unit),
                    readClock: strategicNow,
                    readCellCost: (cell) => ({ multiplier: strategicTerrain(cell).multiplier, hours: strategicStepDays(null, cell) * 24 }),
                    onZoom: (percent, density) => {
                        el.querySelector('#wmZoom').textContent = `${percent}%`;
                        el.querySelector('#wmDensity').textContent = { compact: '远景 · 精简标记', normal: '中景 · 标准标记', detail: '近景 · 详细信息' }[density];
                    },
                    onHistory: (available) => { el.querySelector('[data-map-action="back"]').disabled = !available; },
                    onLoadState: (state) => {
                        const status = el.querySelector('#wmLoadStatus');
                        status.hidden = state === 'ready';
                        status.classList.toggle('is-error', state === 'error');
                        status.innerHTML = state === 'error'
                            ? '地貌贴图加载失败，位面目录仍可使用。 <button type="button" data-map-action="retry">重新加载</button>'
                            : '正在载入位面地貌…';
                    },
                });
                this._map.restoreDisplayState(readWorldMapDisplay());
                this._syncMapDisplay();
                this._syncAudioControls();
                // 打开面板时才把连续经济结算到“现在”；之后仅重绘到期事件推送后的快照。
                window.WorldSimDriver?.flushAll?.({ notify: false, reason: 'world-panel-open' });
                window.WorldInvasionSystem?.settleBackgroundNow?.();
                const eventCell = strategicCell(requestedEvent?.cellId);
                const openingFocus = eventCell
                    ? { sceneId: eventCell.planeSceneId, cellId: eventCell.id }
                    : this._openingFocus(arrivingArmy ? null : (requestedEvent?.sceneId || requestedWorldId));
                this._selectedId = openingFocus.sceneId;
                if (!arrivingArmy) {
                    this._selectedArmyId = null;
                    this._selectedCellId = openingFocus.cellId
                        || WorldProgressionSystem.getWorldMapDiscovery(openingFocus.sceneId)?.cellId || null;
                }
                this._render();
                // 只在真正打开时定位；周期刷新、切页和地图拖动不会再次抢回镜头。
                const focusOptions = { minScale: 32, remember: false };
                if (openingFocus.cellId) this._map.focusCell(openingFocus.cellId, focusOptions);
                else this._map.focusPlane(openingFocus.sceneId, focusOptions);
                this._onOpenRefresh();
                el.querySelector('#wsClose').focus({ preventScroll: true });
            };
            this._panel.onClose = () => {
                this._clearRefresh();
                clearTimeout(this._hoverTimer);
                this._hoverTarget = null;
                this._feedback?.destroy(); this._feedback = null;
                if (this._map) saveWorldMapDisplay(this._map.getDisplayState());
                this._map?.destroy();
                this._map = null;
                this._clearHeldInput();
                this._panel.el.setAttribute('aria-hidden', 'true');
                this._panel.el.classList.remove('is-first-founding-selection');
                if (WorldProgressionSystem.getFoundingState().status === 'founded') {
                    this._foundingCelebration = null;
                }
                this._setPanelChrome(false);
                if (this._previousFocus?.isConnected) this._previousFocus.focus({ preventScroll: true });
                this._previousFocus = null;
            };
        }
        return this._panel;
    },

    _hasOtherActiveRightPanel() {
        const layer = document.getElementById('rightSidebarPanelLayer');
        if (!layer) return false;
        return Array.from(layer.querySelectorAll('.right-sidebar-layer-item--panel')).some((item) => {
            if (item === this._panel?.el) return false;
            if (item.matches('.system-panel.active, .quest-panel.active, .world-switch-panel.active')) return true;
            return !!item.querySelector('.system-panel.active, .quest-panel.active, .world-switch-panel.active');
        });
    },

    _setPanelChrome(open) {
        const overlay = document.getElementById('panelOverlay');
        if (open) {
            overlay?.classList.add('active');
            document.querySelectorAll('.side-menu').forEach((menu) => menu.classList.add('hidden'));
            return;
        }
        if (this._hasOtherActiveRightPanel()) return;
        overlay?.classList.remove('active');
        document.querySelectorAll('.side-menu').forEach((menu) => menu.classList.remove('hidden'));
    },

    /** 侧边菜单按钮已由 hud-panels-misc.js 静态构建（2026-08-19 侧栏改版，
     *  图标 assets/ui/icons/world_switch.png + O 快捷键徽标），本模块不再注入。 */

    refreshAccessState() {
        const unlocked = WorldProgressionSystem.isWorldMapUnlocked();
        const button = document.getElementById('worldSwitchBtn');
        button?.classList.toggle('is-progression-locked', !unlocked);
        button?.setAttribute('aria-disabled', String(!unlocked));
        if (button) {
            button.title = unlocked
                ? '世界与大地图 (O)'
                : '大地图未解锁：先从祭坛成功通关废弃矿洞·初级';
        }
        return unlocked;
    },
    _allowOpen() {
        if (this.refreshAccessState()) return true;
        SceneManager.showTopNotification('大地图尚未解锁：先领取 F 级钥匙，并从祭坛成功通关废弃矿洞·初级', { tone: 'warning' });
        return false;
    },
    toggle() {
        if (this._panel?.isOpen) { this.close(); return true; }
        return this.open();
    },
    open(sceneId = null) {
        if (!this._allowOpen()) return false;
        this._firstFoundingSelection = WorldProgressionSystem.getFoundingState().status === 'selecting';
        if (this._panel?.isOpen) {
            if (Strategy.inMap && Strategy._busy && Strategy.state.army) this._selectArmy(PLAYER_ARMY_MARKER_ID, true);
            else if (sceneId) this._selectWorld(sceneId, true);
            return true;
        }
        this._requestedWorldId = sceneId;
        this._getPanel().open();
        return true;
    },
    openFirstFoundingSelection() {
        if (WorldProgressionSystem.getFoundingState().status !== 'selecting') return false;
        Strategy.ensureCampaign();
        const candidates = WorldProgressionSystem.getFirstFoundingCandidates();
        if (!candidates.length) {
            SceneManager.showTopNotification('当前没有满足条件的首城位面，请稍后重试', { tone: 'warning' });
            return false;
        }
        this._firstFoundingSelection = true;
        this._foundingCelebration = null;
        const recommendation = WorldProgressionSystem.ensureFirstFoundingRecommendation();
        if (recommendation?.cellId) {
            Strategy.revealMapArea(recommendation.cellId,
                WorldProgressionSystem.config.firstFounding?.initialVisionRadius || 3,
                { key: 'first_founding_recommendation' });
        }
        this._selectedCellId = recommendation?.cellId || null;
        const opened = this.open(recommendation?.sceneId || candidates[0].sceneId);
        if (opened && this._panel?.isOpen && recommendation?.cell) {
            this._selectCell(recommendation.cell, true, 'worlds');
        }
        return opened;
    },
    openAtEvent(id) {
        if (!this._allowOpen()) return false;
        const event = Strategy.state.events.find((entry) => entry.id === Number(id));
        if (!event) return false;
        if (this._panel?.isOpen) {
            this._inspectEvent(event.id);
            if (strategicCell(event.cellId)) this._map?.focusCell(event.cellId);
            return true;
        }
        this._requestedEventId = event.id;
        this._getPanel().open();
        Strategy.readEvent(event.id);
        if (this._panel?.isOpen) this._render();
        return true;
    },
    close() { this._getPanel().close(); },
    get isOpen() { return this._getPanel().isOpen; },

    _openingFocus(requestedWorldId) {
        if (this._firstFoundingSelection) {
            Strategy.ensureCampaign();
            const recommendation = WorldProgressionSystem.ensureFirstFoundingRecommendation();
            if (recommendation?.cellId) {
                return { sceneId: recommendation.sceneId, cellId: recommendation.cellId };
            }
        }
        const worlds = visibleWorlds({ includeFirstFoundingCandidates: this._firstFoundingSelection });
        const visibleIds = new Set(worlds.map((world) => world.id));
        const focusForWorld = (worldId) => ({
            sceneId: worldId,
            cellId: WorldProgressionSystem.getWorldMapDiscovery(worldId)?.cellId || null,
        });
        if (visibleIds.has(requestedWorldId)) return focusForWorld(requestedWorldId);
        const inDungeon = SceneManager.isDungeonRunActive();
        const armyCell = !inDungeon && (Strategy.inMap || Strategy.inBattle)
            ? strategicCell(Strategy.state.army?.cellId) : null;
        if (armyCell) {
            const armyWorld = worlds.find((world) =>
                WorldProgressionSystem.getWorldMapDiscovery(world.id)?.cellId === armyCell.id)
                || (this._firstFoundingSelection && world.id === armyCell.planeSceneId);
            if (armyWorld) return { sceneId: armyWorld.id, cellId: armyCell.id };
        }
        const home = Game._observerMode ? Game._observerHomeScene : SceneManager.getCurrentWorldId();
        if (!inDungeon && visibleIds.has(home)) return focusForWorld(home);

        const ranked = worlds.filter((world) => world.id !== 'main'
            && WorldProgressionSystem.isPortalConstructed(world.id)
            && !WorldProgressionSystem.getPortalState(world.id).destroyed).map((world) => {
            const snapshot = isWorldLive(world.id) ? captureWorld(world.id) : getWorldSnapshot(world.id);
            const buildings = (snapshot?.structures || []).filter((building) => building.hp > 0
                && ['producer', 'hut'].includes(building.kind));
            return {
                id: world.id,
                development: buildings.reduce((total, building) => total
                    + Math.max(1, Number(building.economyLevel) || 1), 0),
                population: Math.max(0, Number(snapshot?.populationEconomy?.total) || 0),
                count: buildings.length,
            };
        });
        ranked.sort((a, b) => b.development - a.development || b.population - a.population
            || b.count - a.count);
        const fallback = ranked[0]?.id
            || worlds.find((world) => WorldProgressionSystem.getWorldMapDiscovery(world.id))?.id
            || worlds.find((world) => world.id !== 'main')?.id
            || 'main';
        return focusForWorld(fallback);
    },

    /** 前往世界（2026-08-19 口径：仅相机跳转，玩家不瞬移）：
     *  目标 ≠ 本体所在世界 → 观察模式（该世界不生成玩家）+ 自动进入指挥模式；
     *  目标 = 本体所在世界 → 返回本体（正常生成玩家 + 世界坐标记忆原位恢复）。 */


    /** 入侵支援是明确的本体转移，不沿用世界面板的观察模式。 */


    /** 前往世界（2026-08-19 口径：仅相机跳转，玩家不瞬移）：
     *  目标 ≠ 本体所在世界 → 观察模式（该世界不生成玩家）+ 自动进入指挥模式；
     *  目标 = 本体所在世界 → 返回本体（正常生成玩家 + 世界坐标记忆原位恢复）。 */
    async _travel(target) {
        if (!target || target === SceneManager.getCurrentWorldId()) return true;
        const runtimeSceneId = WorldProgressionSystem.getRuntimeSceneId(target);
        if (!SceneManager.scenes?.[runtimeSceneId]) {
            SceneManager.showTopNotification('目标世界不存在，无法切换', { tone: 'danger' });
            return false;
        }
        if (WorldProgressionSystem.getWorldConfig(target)
            && !WorldProgressionSystem.isPortalConstructed(target)) {
            SceneManager.showTopNotification('该世界位面尚未搭建传送门', { tone: 'warning' });
            return false;
        }
        if (SceneManager.isLoading) {
            SceneManager.showTopNotification('世界正在切换，请稍候', { tone: 'warning' });
            return false;
        }
        this.close();
        const home = Game._observerMode ? Game._observerHomeScene : SceneManager.getCurrentWorldId();
        const observer = target !== home;
        try {
            const switched = await SceneManager.switchWorld(target, Game.player, undefined, { observer });
            if (!switched || SceneManager.getCurrentWorldId() !== target) {
                SceneManager.showTopNotification('世界切换未完成，请重试', { tone: 'danger' });
                return false;
            }
            // 只有真实切场成功后才同步指挥模式；失败回滚时保持原状态。
            RTSCommand.setEnabled(!!Game._observerMode);
            return true;
        } catch (_err) {
            SceneManager.showTopNotification('世界加载失败，已返回原世界', { tone: 'danger' });
            return false;
        }
    },

    /** 入侵支援是明确的本体转移，不沿用世界面板的观察模式。 */
    async supportActiveInvasion(sceneId = null) {
        if (SceneManager.isDungeonRunActive()) {
            SceneManager.showDungeonIsolationNotice();
            return false;
        }
        const active = sceneId ? window.WorldInvasionSystem?.getBattleForWorld?.(sceneId) : window.WorldInvasionSystem?.getState?.().active;
        if (Strategy.active) {
            const result = Strategy.relieveWar(active?.id);
            if (!result.ok) Strategy.notify(result.reason);
            this._render();
            return result.ok;
        }
        const target = active?.targetWorld;
        if (!target || target === SceneManager.getCurrentWorldId()) return false;
        if (!WorldProgressionSystem.isPortalConstructed(target)) return false;
        if (SceneManager.isLoading) return false;
        this.close();
        try {
            const switched = await SceneManager.switchWorld(target, Game.player, undefined, { observer: false });
            if (!switched || SceneManager.getCurrentWorldId() !== target) return false;
            RTSCommand.setEnabled(false);
            return true;
        } catch (_err) {
            SceneManager.showTopNotification('支援世界加载失败，已返回原世界', { tone: 'danger' });
            return false;
        }
    },

    _buildContent(el) {
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'wmTitle');
        el.setAttribute('aria-hidden', 'true');
        el.style.setProperty('--wm-flag-atlas', `url("${ARMY_FLAG_ATLAS_URL}")`);
        el.innerHTML = `
            <div class="ws-header">
                <div class="wm-heading"><span class="wm-kicker">战略指挥 / WORLD</span><span class="ws-title" id="wmTitle">世界</span></div>
                <span id="wmContext" class="wm-context"></span>
                <button type="button" class="ws-close" id="wsClose" aria-label="关闭世界地图（Esc / O）">✕</button>
            </div>
            <div class="wm-layout">
                <aside class="wm-sidebar">
                    <div id="wmBrief" class="wm-brief" aria-label="战略概览"></div>
                    <div class="wm-sidebar-tabs" role="tablist" aria-label="战略指挥分类">
                        ${[['army', '军团'], ['campaign', '战事'], ['worlds', '位面'], ['events', '动态']].map(([id, label]) => `<button type="button" class="wm-sidebar-tab" role="tab" id="wmTab-${id}" data-sidebar-tab="${id}" aria-controls="wmPage-${id}" aria-selected="false" tabindex="-1"><span>${label}</span><b data-tab-count="${id}">0</b></button>`).join('')}
                    </div>
                    <section id="wmPage-army" class="wm-sidebar-page" role="tabpanel" aria-labelledby="wmTab-army" data-sidebar-page="army" tabindex="0" hidden>
                        <section id="wmArmy" class="wm-army" aria-label="我方军团与行军指令"></section>
                        <section id="wmSupportArmies" class="wm-army" aria-label="多军团与补给运输"></section>
                        <section id="wmRoute" class="wm-route" aria-label="途经点与行军队列"></section>
                        <details id="wmCoordinates" class="wm-coordinate-picker" hidden><summary data-focus-key="coordinates">按坐标选择目标</summary><label>行军目标格 <input data-army-target type="text" maxlength="16" placeholder="例如 -12,8" aria-label="输入目标格坐标 q,r"></label><button type="button" data-locate-cell>定位目标</button><span data-coordinate-status role="status"></span></details>
                        <section id="wmEnemies" class="wm-enemies" aria-label="敌方军团"></section>
                    </section>
                    <section id="wmPage-campaign" class="wm-sidebar-page" role="tabpanel" aria-labelledby="wmTab-campaign" data-sidebar-page="campaign" tabindex="0" hidden>
                        <section id="wmCampaign" class="wm-campaign" aria-label="城镇目标与各城战事"></section>
                    </section>
                    <section id="wmPage-worlds" class="wm-sidebar-page" role="tabpanel" aria-labelledby="wmTab-worlds" data-sidebar-page="worlds" tabindex="0" hidden>
                        <section id="wmObjective" class="wm-objective" aria-label="当前战略目标"></section>
                        <nav id="wmDestinations" class="wm-destinations" aria-label="位面目录"></nav>
                        <section id="wmDetails" class="wm-details" aria-label="所选位面详情"></section>
                        <div id="wmEmergency" class="wm-emergency"></div>
                    </section>
                    <section id="wmPage-events" class="wm-sidebar-page" role="tabpanel" aria-labelledby="wmTab-events" data-sidebar-page="events" tabindex="0" hidden>
                        <section id="wmEventDetail" aria-label="所选事件与部队接收清单"></section>
                        <section id="wmEventList" aria-label="最近战略事件"></section>
                    </section>
                </aside>
                <section class="wm-stage" aria-label="世界地貌地图">
                    <canvas id="wmCanvas" class="wm-canvas" tabindex="0" aria-label="位面地图。左键选择或拖动，右键重新下令，Shift加右键追加途经点；空地行军、敌军追击、己方基地入营。方向键平移，加减键缩放，Home查看全图。也可使用底部固定按钮下令。"></canvas>
                    <p class="wm-map-caption">深黑未探索 · 灰暗已探索 · 青色当前视野 · Shift＋右键追加 · 白色段须先走完</p>
                    <p id="wmLoadStatus" class="wm-load-status" role="status"></p>
                    <div class="wm-map-tools">
                      <div id="wmHover" class="wm-hover" hidden></div>
                      <div class="wm-toolbar" role="group" aria-label="地图显示控制">
                        <label class="wm-lens-control">图层<select id="wmLens" aria-describedby="wmLensLegend">${WORLD_MAP_LENSES.map((lens) => `<option value="${lens.id}">${lens.label}</option>`).join('')}</select></label>
                        <div class="wm-zoom-controls" role="group" aria-label="地图缩放">
                          <button type="button" data-map-action="out" aria-label="缩小地图">−</button>
                          <span id="wmZoom" class="wm-zoom">100%</span>
                          <button type="button" data-map-action="in" aria-label="放大地图">＋</button>
                        </div>
                        <button type="button" data-map-action="fit">全图</button>
                        <button type="button" data-map-action="back" disabled title="返回上次定位或全图操作前的视角，不撤销军令">返回视角</button>
                        <button type="button" data-map-action="grid" aria-pressed="true">六边格</button>
                        <div class="wm-audio-controls" role="group" aria-label="大地图提示音设置" title="仅控制命令、抵达和警报；仍受主音量与界面声道控制">
                          <button type="button" id="wmAudioToggle" data-ui-click-sound="off" aria-pressed="true">提示音：开</button>
                          <label>音量<input id="wmAudioVolume" type="range" min="0" max="100" step="5" aria-label="大地图提示音音量" aria-describedby="wmAudioHint"><output id="wmAudioValue" for="wmAudioVolume"></output></label>
                          <span id="wmAudioHint" hidden>仅命令、抵达和警报；受主音量与界面声道控制，不影响普通按钮点击音。</span>
                        </div>
                      </div>
                      <p class="wm-lens-legend"><span id="wmDensity"></span><span id="wmLensLegend"></span></p>
                    </div>
                </section>
            </div>
            <section id="wmCommandDock" class="wm-command-dock" aria-label="当前控制军团与固定指令栏" hidden></section>
            <div class="wm-footer"><span id="wmCommandStatus" role="status" aria-live="polite"></span><span>O / Esc 关闭</span></div>`;
        el.querySelector('#wsClose').onclick = () => this.close();
        el.querySelector('#wmAudioToggle').onclick = () => {
            WorldMapAudio.set({ enabled: !WorldMapAudio.read().enabled }); this._syncAudioControls();
        };
        el.querySelector('#wmAudioVolume').oninput = (event) => {
            WorldMapAudio.set({ volume: Number(event.target.value) / 100 }); this._syncAudioControls();
        };
        el.querySelector('#wmLens').onchange = (event) => {
            this._map?.setLens(event.target.value); this._syncMapDisplay();
        };
        // Persist once on close/page exit, never on every animation frame or world tick.
        window.addEventListener('pagehide', () => {
            if (this._map) saveWorldMapDisplay(this._map.getDisplayState());
        });
        const locateCell = () => {
            const value = el.querySelector('[data-army-target]').value.trim().replace(/，/g, ',');
            const match = /^(-?\d+)\s*[,\s]\s*(-?\d+)$/.exec(value);
            const cell = match && strategicCell(`${Number(match[1])},${Number(match[2])}`);
            el.querySelector('[data-coordinate-status]').textContent = cell ? '' : '该坐标不在本局地图内';
            if (cell) this._selectCell(cell, true);
        };
        el.querySelector('[data-locate-cell]').onclick = locateCell;
        el.querySelector('[data-army-target]').onchange = locateCell;
        el.addEventListener('toggle', (event) => {
            if (!event.target.matches?.('[data-invasion-catalog]') || this._invasionCatalogOpen === event.target.open) return;
            this._invasionCatalogOpen = event.target.open;
            this._render();
        }, true);
        el.addEventListener('change', (event) => {
            if (event.target.dataset.supplySource) {
                this._supplySources ||= {}; this._supplySources[event.target.dataset.supplySource] = event.target.value;
            }
        });
        el.addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (!button || button.disabled) return;
            if (button.dataset.sidebarTab) { this._setSidebarTab(button.dataset.sidebarTab); return; }
            if (button.dataset.eventId) { this._inspectEvent(Number(button.dataset.eventId)); return; }
            if (button.dataset.eventsRead) { Strategy.readAllEvents(); this._render(); return; }
            if (button.dataset.routeLocate) { this._selectCell(strategicCell(button.dataset.routeLocate), true); return; }
            if (button.dataset.routeEnd != null) {
                this._showOrderResult(Strategy.truncateRouteAfter(Number(button.dataset.routeEnd), button.dataset.routePlan)); return;
            }
            if (button.dataset.eventLocate) {
                const entry = Strategy.state.events.find((item) => item.id === Number(button.dataset.eventLocate));
                if (strategicCell(entry?.cellId)) {
                    this._selectedCellId = entry.cellId; this._selectedArmyId = null;
                    this._map?.focusCell(entry.cellId); this._render();
                }
                return;
            }
            if (button.dataset.eventRetry) {
                this._retryEvent(Number(button.dataset.eventRetry)); return;
            }
            if (button.dataset.selectArmy) { this._selectArmy(button.dataset.selectArmy, true); return; }
            if (button.dataset.supportAction) { this._supportAction(button.dataset.supportAction, button.dataset.supportId); return; }
            if (button.dataset.settlerAction) {
                const action = button.dataset.settlerAction, id = button.dataset.settlerId;
                const result = action === 'found' ? Strategy.foundCity(id) : action === 'hold' ? Strategy.haltSettler(id)
                    : Strategy.orderSettler(id, this._selectedCellId);
                if (result.ok && action === 'found') {
                    this._controlledSettlerId = null; this._selectedArmyId = null;
                    this._selectedCellId = result.cellId; this._setSidebarTab('campaign');
                }
                this._showOrderResult(result); return;
            }
            if (button.dataset.campaignAction) {
                const action = button.dataset.campaignAction, id = button.dataset.targetId;
                let result;
                if (this._controlledDetachmentId && ['destroy', 'pursue', 'relieve', 'enter'].includes(action)) {
                    const target = action === 'enter' ? Strategy.baseEntry(id) : Strategy.getMapSettlements().find((site) => site.id === id)
                        || Strategy.getMapVisibleEnemies().find((enemy) => enemy.id === id) || Strategy.getMapWars().find((war) => war.id === id);
                    result = Strategy.orderDetachment(this._controlledDetachmentId, target?.cellId, action === 'pursue' ? id : null);
                }
                else if (action === 'destroy') result = Strategy.attackSettlement(id, 'destroy');
                else if (action === 'pursue') result = Strategy.pursueEnemy(id);
                else if (action === 'relieve') result = Strategy.relieveWar(id);
                else if (action === 'enter') result = Strategy.orderBaseEntry(id);
                else if (action === 'repair') result = Strategy.repairSettlement(id, JSON.parse(button.dataset.repairQuote));
                else if (action === 'loot') result = Strategy.claimLoot();
                this._showOrderResult(result); return;
            }
            if (button.dataset.armyAction) {
                const action = button.dataset.armyAction;
                if (action === 'move') { this._commandMap(strategicCell(this._selectedCellId), this._selectedArmyId === PLAYER_ARMY_MARKER_ID ? null : this._selectedArmyId); return; }
                if (action === 'append') { this._commandMap(strategicCell(this._selectedCellId), this._selectedArmyId === PLAYER_ARMY_MARKER_ID ? null : this._selectedArmyId, { append: true }); return; }
                if (action === 'hold') { this._showOrderResult(Strategy.halt()); return; }
                if (action === 'home') { this._returnHome(); return; }
                if (action === 'locate') this._selectArmy(PLAYER_ARMY_MARKER_ID, true);
                this._render(); return;
            }
            if (button.dataset.armyCell) { this._selectCell(strategicCell(button.dataset.armyCell), true, 'campaign'); return; }
            if (button.dataset.firstFoundingRecommendation) {
                this._selectCell(strategicCell(button.dataset.firstFoundingRecommendation), true, 'worlds'); return;
            }
            if (button.dataset.firstFoundingCell) this._claimFirstFoundingCell(button.dataset.firstFoundingCell);
            else if (button.dataset.enterFirstFounding) this._enterFirstFoundingWorld(button.dataset.enterFirstFounding);
            else if (button.dataset.selectWorld) this._selectWorld(button.dataset.selectWorld, true);
            else if (button.dataset.world) this._travel(button.dataset.world);
            else if (button.dataset.rebuildWorld) this._emergencyRebuild(button.dataset.rebuildWorld);
            else if (button.dataset.repairPortal) this._repairPortal(button.dataset.repairPortal);
            else if (button.dataset.rebuildHall) this._rebuildPlayerBase(button.dataset.rebuildHall);
            else if (button.dataset.discoverWorld) this._discoverWorld(button.dataset.discoverWorld);
            else if (button.dataset.expeditionWorld) this._prepareWorldExpedition(button.dataset.expeditionWorld);
            else if (button.dataset.connectWorld) this._connectWorld(button.dataset.connectWorld);
            else if (button.dataset.supportWorld) this.supportActiveInvasion(button.dataset.supportWorld);
            else if (button.dataset.mapAction && this._map) {
                switch (button.dataset.mapAction) {
                    case 'in': this._map.zoom(1.25); break;
                    case 'out': this._map.zoom(.8); break;
                    case 'fit': this._map.fit(); break;
                    case 'back': this._map.back(); break;
                    case 'retry': this._map.load(); break;
                    case 'grid': {
                        const visible = !this._map.grid;
                        this._map.setGrid(visible);
                        button.setAttribute('aria-pressed', String(visible));
                        break;
                    }
                }
            }
        });
        window.addEventListener('keydown', (event) => {
            if (!this._panel?.isOpen) return;
            if (event.code === 'Escape' || event.code === 'KeyO') {
                event.preventDefault(); event.stopImmediatePropagation();
                if (!event.repeat) this.close();
                return;
            }
            if (event.code === 'Tab') {
                const focusable = Array.from(el.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')).filter((node) => node.tabIndex >= 0 && node.getClientRects().length);
                const index = focusable.indexOf(document.activeElement);
                if (!el.contains(document.activeElement) || (index >= 0 && (event.shiftKey ? index === 0 : index === focusable.length - 1))) {
                    event.preventDefault();
                    focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
                }
            } else if (event.target.matches?.('[data-army-target]') && event.code === 'Enter') {
                event.preventDefault();
                locateCell();
            } else if (event.target.matches?.('[data-sidebar-tab]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.code)) {
                event.preventDefault();
                const tabs = ['army', 'campaign', 'worlds', 'events'];
                const index = tabs.indexOf(event.target.dataset.sidebarTab);
                const next = event.code === 'Home' ? 0 : event.code === 'End' ? tabs.length - 1 : (index + (event.code === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
                this._setSidebarTab(tabs[next], true);
            } else if (event.target === el.querySelector('#wmCanvas')) {
                const delta = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[event.code];
                if (delta) { event.preventDefault(); this._map?.pan(...delta); }
                if (['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Home'].includes(event.code)) {
                    event.preventDefault();
                    if (event.code === 'Home') this._map?.fit();
                    else this._map?.zoom(['Equal', 'NumpadAdd'].includes(event.code) ? 1.15 : 1 / 1.15);
                }
            }
            // Preserve native Tab/Enter/Space activation inside the dialog, but no game shortcuts.
            if (!el.contains(event.target)) event.preventDefault();
            event.stopPropagation();
        }, true);
    },

    _syncMapDisplay() {
        if (!this._map) return;
        const el = this._panel.el;
        const lens = WORLD_MAP_LENSES.find((item) => item.id === this._map.lens);
        el.querySelector('#wmLens').value = lens.id;
        el.querySelector('#wmLensLegend').textContent = lens.legend;
        el.querySelector('[data-map-action="grid"]').setAttribute('aria-pressed', String(this._map.grid));
        this._map.resize();
    },

    _clearHeldInput() {
        Input.keys.clear();
        Input.mouse.leftDown = Input.mouse.rightDown = false;
        Input.mouse.leftPressed = Input.mouse.rightPressed = false;
    },

    _selectWorld(id, focus = false) {
        this._selectedId = id;
        this._selectedArmyId = null; // Inspecting a base never changes the controlled expedition.
        const foundingCell = this._firstFoundingSelection ? strategicCell(this._selectedCellId) : null;
        const discoveryCellId = WorldProgressionSystem.getWorldMapDiscovery(id)?.cellId || null;
        this._selectedCellId = foundingCell?.planeSceneId === WorldProgressionSystem.getRuntimeSceneId(id)
            ? foundingCell.id : discoveryCellId;
        this._setSidebarTab('worlds');
        this._render();
        if (focus) {
            if (this._selectedCellId) this._map?.focusCell(this._selectedCellId);
            else this._map?.focusPlane(WorldProgressionSystem.getRuntimeSceneId(id));
        }
    },

    _commandMap(cell, enemyId = null, { append = false } = {}) {
        if (!cell) return;
        if (!Strategy.getMapVisibleEnemies().some((enemy) => enemy.id === enemyId)) enemyId = null;
        const preview = this._previewOrder(cell.id, enemyId, { append });
        const result = this._controlledSettlerId ? Strategy.orderSettler(this._controlledSettlerId, cell.id, { append })
            : this._controlledDetachmentId ? Strategy.orderDetachment(this._controlledDetachmentId, cell.id, enemyId, { append })
            : Strategy.issueMapOrder(cell.id, enemyId, { append });
        this._feedback?.acknowledge(this._map?.screenPoint(preview.order?.cellId || cell.id), result.ok ? commandKind(preview) : 'blocked', append && result.ok);
        this._selectedCellId = Strategy.getMapVisibleEnemies().find((enemy) => enemy.id === enemyId)?.cellId || cell.id;
        this._selectedArmyId = enemyId;
        this._setSidebarTab('army');
        this._showOrderResult(result);
    },

    _previewOrder(cellId, enemyId, options) {
        return this._controlledSettlerId ? Strategy.previewSettlerOrder(this._controlledSettlerId, cellId, options)
            : this._controlledDetachmentId ? Strategy.previewDetachmentOrder(this._controlledDetachmentId, cellId, enemyId, options)
            : Strategy.previewMapOrder(cellId, enemyId, options);
    },
    _supportAction(action, id) {
        const source = this._panel.el.querySelector(`[data-supply-source="${id}"]`)?.value;
        const army = Strategy.playerArmy(id);
        let result;
        if (action === 'order') result = Strategy.orderDetachment(id, this._selectedCellId);
        else if (action === 'hold') result = Strategy.haltDetachment(id);
        else if (action === 'retreat') result = Strategy.retreatDetachment(id);
        else if (action === 'home' || action === 'base') {
            const base = Strategy.baseEntry(action === 'home' ? army?.originSceneId : source);
            result = base ? Strategy.orderDetachment(id, base.cellId) : { ok: false, reason: '接收基地不可用，请重新选择。' };
        } else if (action === 'supply') result = Strategy.dispatchSupply(id, source);
        else if (action === 'line-on' || action === 'line-off') result = Strategy.setSupplyLine(id, action === 'line-on' ? source : null);
        else if (action === 'convoy-return') result = Strategy.returnConvoy(id);
        else if (action === 'convoy-redirect') result = Strategy.redirectConvoy(id, source);
        this._showOrderResult(result);
    },

    _hoverChanged(cell, target = {}) {
        clearTimeout(this._hoverTimer);
        this._hoverTimer = null;
        this._hoverTarget = cell ? { ...target, cell } : null;
        this._feedback?.hide();
        const canvas = this._panel.el.querySelector('#wmCanvas');
        canvas.removeAttribute('data-command-kind');
        this._panel.el.querySelector('#wmHover').hidden = true;
        this._map?.setPreview(null);
        if (cell) this._hoverTimer = setTimeout(() => {
            this._hoverTimer = null;
            if (this._panel?.isOpen) this._renderHover();
        }, commandMotion.previewDelayMs);
    },

    _renderHover() {
        const target = this._hoverTarget;
        if (!target?.cell) return;
        const cell = target.cell, terrain = strategicTerrain(cell);
        const intel = Strategy.mapCellIntel(cell.id);
        const el = this._panel.el, hover = el.querySelector('#wmHover');
        const append = !!target.append, isOwn = !!target.friendly;
        const own = isOwn && !append && !(target.armyId === PLAYER_ARMY_MARKER_ID && this._controlledDetachmentId);
        const enemy = Strategy.getMapVisibleEnemies().find((unit) => unit.id === target.enemyId || (!target.enemyId && unit.cellId === cell.id));
        const site = Strategy.getMapSettlements().find((item) => item.cellId === cell.id);
        const owner = site ? site.status === 'destroyed' ? '已毁' : site.owner === 'player' ? '我方' : '敌方' : '';
        const preview = this._previewOrder(cell.id, target.enemyId, { append });
        const active = !!this._controlledArmyId;
        const kind = commandKind(preview);
        el.querySelector('#wmCanvas').dataset.commandKind = own ? 'select' : active ? kind : 'inspect';
        if (active && !own) {
            this._feedback?.show(kind, append && preview.ok);
            this._map?.setPreview({ cellId: preview.order?.cellId || cell.id, route: preview.route, stops: preview.stops, append, ok: preview.ok, kind });
        } else {
            this._feedback?.hide(); this._map?.setPreview(null);
        }
        const label = isOwn ? (target.armyId === PLAYER_ARMY_MARKER_ID ? Strategy.state.army : Strategy.playerArmy(target.armyId) || Strategy.settler(target.armyId))?.name || '我方运输队'
            : !intel.explored ? '未知地格' : enemy?.name || site?.name || terrain.name;
        const action = own ? '点选此军团；运输队可在列表中返航或改派卸货基地。' : preview.ok
            ? `${append ? 'Shift＋右键追加' : '右键重排'}：${preview.order.label} · ${preview.stops.length}站 / ${preview.route.length}格 · ${formatStrategicTravelTime(preview.durationMs)}` : preview.reason;
        const founding = this._controlledSettlerId && Strategy.foundingStatus(this._controlledSettlerId, cell.id, { preview: true });
        const terrainLine = !intel.explored && !isOwn ? '战争迷雾：地貌与目标尚未探索'
            : `${terrain.name} ×${terrain.multiplier} · ${strategicTerrainLabel(cell)}${enemy ? ` · 敌军${enemy.roster.length}单位` : ''}`;
        const html = `<strong>${escapeHtml(label)} · ${cell.q}, ${cell.r}${owner ? ` · ${owner}` : ''}</strong>
            <span>${escapeHtml(terrainLine)}</span>
            <b class="${!preview.ok && !own ? 'wm-tone-warning' : ''}">${escapeHtml(action)}</b>
            ${founding ? `<small>建城选址：${founding.ok ? `满足最小城距 ${founding.minDistance} 格，停稳后可建城` : escapeHtml(founding.reason)}</small>` : ''}
            ${!own && preview.ok ? `<small>${strategicClockHint()}</small>` : ''}
            ${!own && preview.ok && Strategy.state.army?.march ? '<small>包含当前路段剩余时间；改令后仍须先走完白色粗段。</small>' : ''}
            ${!own && append && preview.ok ? '<small>保留前方途经点；接战或受阻会取消后续计划。</small>' : ''}`;
        if (hover._content !== html) { hover.innerHTML = html; hover._content = html; }
        hover.hidden = false;
    },

    _showOrderResult(result) {
        // Announce the command once; periodic ETA refreshes do not replace this node.
        this._commandFeedback = result && !result.ok ? result.reason : '';
        if (result && !result.ok) {
            Strategy.recordEvent('order_rejected', '操作未执行', result.reason, { cellId: this._selectedCellId });
            Strategy.notify(result.reason);
        }
        if (result?.ok) WorldMapAudio.play('accepted');
        if (this._panel?.isOpen) this._render();
    },

    async _returnHome() {
        this._commandFeedback = '';
        const returned = await Strategy.returnHome();
        // Entry completion already has an arrival cue; only acknowledge a new march here.
        if (returned && Strategy.active) WorldMapAudio.play('accepted');
        else if (!returned) WorldMapAudio.play('rejected');
        if (this._panel?.isOpen) this._render();
    },

    _syncAudioControls() {
        const { enabled, volume } = WorldMapAudio.read(), el = this._panel.el;
        const button = el.querySelector('#wmAudioToggle'), slider = el.querySelector('#wmAudioVolume');
        button.setAttribute('aria-pressed', String(enabled));
        button.textContent = `提示音：${enabled ? '开' : '关'}`;
        slider.value = Math.round(volume * 100);
        slider.disabled = !enabled;
        el.querySelector('#wmAudioValue').textContent = `${Math.round(volume * 100)}%`;
    },

    _setSidebarTab(tab, focus = false) {
        if (this._firstFoundingSelection) tab = 'worlds';
        if (!['army', 'campaign', 'worlds', 'events'].includes(tab)) return;
        this._sidebarTab = tab;
        const el = this._panel.el;
        el.querySelectorAll('[data-sidebar-tab]').forEach((button) => {
            const selected = button.dataset.sidebarTab === tab;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            if (selected && focus) button.focus({ preventScroll: true });
        });
        el.querySelectorAll('[data-sidebar-page]').forEach((page) => { page.hidden = page.dataset.sidebarPage !== tab; });
    },

    _selectCell(cell, focus = false, tab = 'army') {
        if (!cell) return;
        this._selectedCellId = cell.id;
        this._selectedArmyId = null;
        if (this._firstFoundingSelection) this._selectedId = cell.planeSceneId;
        this._setSidebarTab(tab);
        this._render();
        if (focus) this._map?.focusCell(cell.id);
    },

    _selectArmy(id, focus = false) {
        const army = id === PLAYER_ARMY_MARKER_ID ? Strategy.state.army : Strategy.playerArmy(id)
            || Strategy.settler(id)
            || Strategy.state.convoys.find((unit) => unit.id === id) || Strategy.getMapVisibleEnemies().find((enemy) => enemy.id === id);
        if (!army) return;
        if (id === PLAYER_ARMY_MARKER_ID) this._controlledDetachmentId = this._controlledSettlerId = null;
        else if (army.kind === 'detachment') { this._controlledDetachmentId = id; this._controlledSettlerId = null; }
        else if (army.kind === 'settler') { this._controlledSettlerId = id; this._controlledDetachmentId = null; }
        this._selectedArmyId = id;
        this._selectedCellId = army.cellId;
        this._setSidebarTab('army');
        this._render();
        this._panel.el.querySelector('#wmPage-army').scrollTop = 0;
        if (focus) {
            this._map?.focusCell(army.cellId);
            this._panel.el.querySelector('.wm-order-target')?.focus({ preventScroll: true });
        }
    },

    // Do not replace unchanged DOM every 1.2s: preserve keyboard focus and screen-reader state.
    _setSectionHtml(id, html) {
        const node = this._panel.el.querySelector(`#${id}`);
        if (node._worldMapHtml === html) return;
        const active = document.activeElement;
        const data = node.contains(active) ? { ...active.dataset } : null;
        const page = node.closest('[data-sidebar-page]');
        const scrollTop = page?.scrollTop;
        node.innerHTML = html;
        // These buttons play a result cue after admission; suppress the generic click
        // so accepted/rejected commands never produce two copies of the click sound.
        node.querySelectorAll('[data-army-action], [data-route-end], [data-event-retry], [data-settler-action], [data-campaign-action]:not([data-campaign-action="loot"])')
            .forEach((button) => { button.dataset.uiClickSound = 'off'; });
        if (Strategy.inMap) node.querySelectorAll('[data-expedition-world]')
            .forEach((button) => { button.dataset.uiClickSound = 'off'; });
        node._worldMapHtml = html;
        if (data) {
            const replacement = Array.from(node.querySelectorAll('button, select, summary, [data-focus-key]')).find((button) =>
                Object.keys(data).length && Object.entries(data).every(([key, value]) => button.dataset[key] === value));
            (replacement || this._panel.el.querySelector('#wsClose')).focus({ preventScroll: true });
        }
        if (page) page.scrollTop = scrollTop;
    },

    /** 打开期间 1.2s 只刷新显示；后台账本没有到期事件时不会为面板反复扫描位面。 */
    _onOpenRefresh() {
        this._clearRefresh();
        this._refreshTimer = setInterval(() => { if (this._panel?.isOpen) this._render(); }, 1200);
    },
    _clearRefresh() {
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    },

    _worldName(id) {
        if (id === 'scene7' && window.DungeonMapSystem?.active) {
            return window.DungeonMapSystem.dungeonName || SceneManager.scenes?.scene7?.name || id;
        }
        const progressionName = WorldProgressionSystem.getWorldDisplayName?.(id);
        return (progressionName && progressionName !== id ? progressionName : '')
            || WorldInstanceSystem.getDisplayName(id)
            || SceneManager.scenes?.[WorldProgressionSystem.getRuntimeSceneId(id)]?.name
            || id;
    },

    /** 常驻世界状态文案（当前/快照实况/传送门状态）。 */
    _worldStatus(sceneId, current) {
        if (current) return '<span class="ws-current">当前所在</span>';
        const portal = WorldProgressionSystem.getPortalState(sceneId);
        if (portal.destroyed) return '<b style="color:#ff5555">传送门已摧毁，等待重建</b>';
        const protection = WorldProgressionSystem.getPortalProtection(sceneId);
        const protectionText = protection.active
            ? `<b style="color:#7fe0c8">新生保护 ${protection.remainingDays.toFixed(1)} 天</b> · `
            : '';
        const snap = getWorldSnapshot(sceneId);
        if (!snap) return '<span class="ws-dim">尚未建设（首次进入从零开始）</span>';
        const structures = snap.structures || [];
        const buildings = structures.length;
        const lost = structures.filter((s) => !(s.hp > 0)).length;
        const energy = structures.reduce((sum, s) => sum + (s.storedEnergy || 0), 0);
        const invasion = window.WorldInvasionSystem?.getBattleForWorld?.(sceneId);
        const invasionText = invasion?.targetWorld === sceneId
            ? `<b style="color:#ff775f">入侵第 ${invasion.waveIndex}/${invasion.waveCount} 波</b> · `
            : '';
        let html = `<span>${protectionText}${invasionText}建筑 ${buildings} 座${lost ? `（损 ${lost}）` : ''} · 仓库能源 ${Math.round(energy)}</span>`;
        const preview = previewWorld122Report(sceneId);
        if (preview) {
            const parts = [];
            if (preview.defeated) parts.push('<b style="color:#ff5555">⚠ 预估已失守</b>');
            if (preview.wavesCleared.length) parts.push(`预估击退至第 ${Math.max(...preview.wavesCleared)} 波`);
            if (preview.victory) parts.push('预估防守胜利');
            if (preview.energyMined > 0) parts.push(`离线采矿 +${Math.round(preview.energyMined)}`);
            if (preview.deepDrillEnergyMined > 0) {
                parts.push(`深钻采掘 +${Math.round(preview.deepDrillEnergyMined)}`);
            }
            if (preview.resonatorEnergyProduced > 0) {
                parts.push(`位面谐振 +${preview.resonatorEnergyProduced}`);
            }
            if (preview.steamEnergyProduced > 0) {
                parts.push(`蒸汽发电 +${preview.steamEnergyProduced}`);
            }
            if (preview.titheEnergy > 0) parts.push(`什一税 +${preview.titheEnergy}`);
            if (preview.unitsProduced > 0) parts.push(`新兵 +${preview.unitsProduced}`);
            if (preview.abilitiesCompleted.length) parts.push(`研究完成 ${preview.abilitiesCompleted.length} 项`);
            if (preview.modulesCompleted?.length) parts.push(`兵种升级完成 ${preview.modulesCompleted.length} 项`);
            if (preview.structuresLost > 0) parts.push(`<span style="color:#ff8855">预估损失建筑 ${preview.structuresLost}</span>`);
            if (parts.length) html += `<div class="ws-preview">⏱ ${parts.join('；')}</div>`;
        }
        return html;
    },

    _discoverWorld(sceneId) {
        if (SceneManager.isLoading) return;
        const result = WorldProgressionSystem.discoverWorld(sceneId);
        if (!result.ok) {
            SceneManager.showTopNotification(result.reason, { tone: 'danger' });
            return;
        }
        this._selectWorld(sceneId, true);
    },

    _prepareWorldExpedition(sceneId) {
        WorldProgressionSystem.discoverWorld(sceneId);
        Strategy.ensureSignalGuards();
        const entry = WorldProgressionSystem.getWorldMapDiscovery(sceneId);
        this._selectedCellId = entry?.cellId;
        if (Strategy.inMap) { this._commandMap(entry?.cell); return; }
        else Strategy.notify('目标已追踪。请在当前建设位面的指挥建筑内选择部队，确认出征。');
        this._render();
    },

    _constructionBlockReason(sceneId) {
        const founding = WorldProgressionSystem.getFoundingState();
        if (['awaiting_king', 'selecting'].includes(founding.status) && !founding.giftConsumed) {
            return founding.status === 'awaiting_king'
                ? '请先返回小鼠大王处开启首城选址'
                : '请在大地图点击合法地格，再用“确认在所选地格建立首城”完成免费授予';
        }
        if (Strategy.active) {
            if (Strategy.state.army.defeated) return '亲征已失败，请先撤回主神空间';
            const entry = WorldProgressionSystem.getWorldMapDiscovery(sceneId);
            return Strategy.inMap && !Strategy._busy && !SceneManager.isLoading
                && Strategy.state.army.cellId === entry?.cellId
                ? '' : '请率军抵达此信标格，结束战斗后接通';
        }
        if (SceneManager.isLoading) return '场景正在加载，请稍候';
        if (SceneManager.isDungeonRunActive()) return '请先完成当前地牢结算，再接通位面';
        if (Game._observerMode || SceneManager.isQuestInstance()) return '请先返回本体的主神空间或已接通位面';
        if (!Game.player || Game.player.data?.hp <= 0) return '角色当前无法操作传送网络';
        if (!TechnologySystem.isUnlocked('building', 'portal')) return '需要先完成科技：位面门工程';
        const current = SceneManager.getCurrentWorldId();
        if (current !== 'main' && (!WorldProgressionSystem.getWorldConfig(current)
            || !WorldProgressionSystem.isPortalConstructed(current))) return '请返回主神空间或已接通位面操作';
        if (!WorldProgressionSystem.getTravelWorlds().length) return '所有位面均已断线，请先应急重建旧传送门';
        return '';
    },

    _connectWorld(sceneId) {
        const blocked = this._constructionBlockReason(sceneId);
        const candidate = WorldProgressionSystem.getConstructableWorlds().find((entry) => entry.sceneId === sceneId && entry.firstConstruction);
        if (blocked || !candidate || !WorldProgressionSystem.getWorldMapDiscovery(sceneId)) {
            SceneManager.showTopNotification(blocked || '该目标尚不满足首次接通条件', { tone: 'warning' });
            this._render();
            return;
        }
        const result = WorldProgressionSystem.constructPortal(sceneId);
        if (!result.ok) {
            SceneManager.showTopNotification(result.reason || '接通失败', { tone: 'danger' });
        } else {
            Game.syncMainHubWorldPortals?.();
            WorldProgressionSystem.discoverWorld(sceneId);
        }
        this._selectWorld(sceneId, true);
    },

    _claimFirstFoundingCell(cellId) {
        if (!this._firstFoundingSelection || SceneManager.isLoading) return;
        const result = WorldProgressionSystem.claimFirstFoundingAtCell(cellId);
        if (!result.ok) {
            SceneManager.showTopNotification(result.reason || '首城选址失败', { tone: 'warning' });
            this._render();
            return;
        }
        const sceneId = result.sceneId;
        const name = WorldProgressionSystem.getWorldDisplayName(sceneId);
        const terrain = WorldProgressionSystem.getWorldTerrainLabel(sceneId);
        this._firstFoundingSelection = false;
        this._selectedId = sceneId;
        this._foundingCelebration = { sceneId, name, terrain };
        this._panel?.el?.classList.remove('is-first-founding-selection');
        Game.syncMainHubWorldPortals?.();
        SceneManager.showTopNotification(`首城落成：${name}｜市政厅、首座传送门与位面航图已启用`, {
            tone: 'success', emphasis: 'headline', duration: 6000,
        });
        this._render();
    },

    async _enterFirstFoundingWorld(sceneId) {
        if (!sceneId || SceneManager.isLoading || !WorldProgressionSystem.isPortalConstructed(sceneId)) return;
        this.close();
        try {
            const entered = await SceneManager.switchWorld(sceneId, Game.player, undefined, { observer: false });
            if (!entered || SceneManager.getCurrentWorldId() !== sceneId) {
                SceneManager.showTopNotification('首城已建立，但本次传送未完成；可从主神空间传送门重试', { tone: 'warning' });
            }
        } catch (error) {
            console.error('[WorldSwitchPanel] 首城传送失败:', error);
            SceneManager.showTopNotification('首城已完整登记，但本次传送失败；请从主神空间传送门重试', { tone: 'warning' });
        }
    },

    _emergencyRebuild(sceneId) {
        // Recheck the original emergency boundary at click time, including observer state.
        if (SceneManager.isLoading || SceneManager.isDungeonRunActive() || Game._observerMode
            || SceneManager.getCurrentWorldId() !== 'main' || WorldProgressionSystem.getTravelWorlds().length
            || !WorldProgressionSystem.getConstructableWorlds().some((entry) => entry.sceneId === sceneId && entry.rebuild)) return;
        const result = WorldProgressionSystem.constructPortal(sceneId);
        if (!result.ok) {
            SceneManager.showTopNotification(result.reason || '传送门重建失败', { tone: 'danger' });
            this._render();
            return;
        }
        Game.syncMainHubWorldPortals?.();
        this._render();
    },

    _repairPortal(sceneId) {
        if (SceneManager.isLoading || SceneManager.isDungeonRunActive() || Game._observerMode) return;
        const result = WorldProgressionSystem.constructPortal(sceneId);
        SceneManager.showTopNotification(result.ok ? '传送门已接通，位面重新接入网络'
            : result.reason || '传送门修复失败', { tone: result.ok ? 'success' : 'danger' });
        if (result.ok) Game.syncMainHubWorldPortals?.();
        this._render();
    },

    _rebuildPlayerBase(sceneId) {
        if (SceneManager.isLoading || SceneManager.isDungeonRunActive() || Game._observerMode) return;
        const result = WorldProgressionSystem.requestPlayerBaseRebuild(sceneId);
        SceneManager.showTopNotification(result.ok
            ? (SceneManager.getCurrentWorldId() === sceneId ? '市政厅已重建' : '市政厅重建已登记，进入该位面时自动落成')
            : result.reason || '市政厅重建失败', { tone: result.ok ? 'success' : 'danger' });
        this._render();
    },

    _objectiveHtml(world) {
        if (!world?.persistent) return '<strong>选择你的下一处位面</strong><p>选择未接通区域，定位信标，查看对应远征与接通收益。定位不消耗钥匙，也不会自动出征。</p>';
        let next = '定位信标，确定这次远征要打通的地块。';
        if (world.destroyed && world.hallAlive) next = world.endpointExists
            ? '传送门已毁，但市政厅仍在；可支付资源原址修复。'
            : '移民已恢复市政厅；完成位面门工程后，可支付资源建造新门。';
        else if (world.destroyed) next = '市政厅与传送门均已毁，位面已崩塌；只能派移民队抵达旧城址恢复。';
        else if (world.connected) next = Strategy.inMap ? '据点已接通。军团行军抵达此信标后可自动入营；围城期间需先解围。' : '据点已接通。可观察建设状况；本体经传送门前往建设、研究和驻防。';
        else if (world.eligible && world.entryCell) next = '接通资格已具备。首城赠送门不收费；后续新建传送门需要位面门工程与建造资源。';
        else if (world.entryCell) next = '在指挥建筑内编组出征，率军抵达信标格，击败守军后接通。';
        return `<strong>${escapeHtml(this._worldName(world.id))}</strong><p>${escapeHtml(next)}</p>`;
    },

    _worldExpeditionHtml(world) {
        if (!world.persistent) return '';
        const founding = WorldProgressionSystem.getFoundingState();
        if (founding.status === 'awaiting_king' && !founding.giftConsumed) {
            return `
                <ol class="wm-progress" aria-label="首城授予进度">
                    <li class="is-complete">首次探索资格 · 已完成</li>
                    <li class="is-current" aria-current="step">返回小鼠大王开启首城选址</li>
                    <li>从合法候选确认首城</li>
                </ol>
                <p class="wm-hint">位面航图已经解锁，可先查看地貌；首城定位、远征与建造操作会在小鼠大王批准选址后开放。</p>`;
        }
        if (this._firstFoundingSelection) {
            const cfg = WorldProgressionSystem.getWorldConfig(world.id);
            const site = WorldProgressionSystem.inspectFirstFoundingCell(this._selectedCellId);
            const recommendation = WorldProgressionSystem.ensureFirstFoundingRecommendation();
            const selectedHere = site.runtimeSceneId === world.id;
            const canConfirm = selectedHere && site.ok;
            const isRecommendation = canConfirm && site.cellId === recommendation?.cellId;
            const siteText = !selectedHere ? '请在地图中点击一个地格作为首城位置。'
                : canConfirm ? `已选择 (${site.cell.q}, ${site.cell.r}) · ${site.terrainLabel || '当前地貌'}，满足建城条件${isRecommendation ? '（系统建议位置）' : ''}。`
                    : `当前地格不可建城：${site.reason}`;
            return `
                <ol class="wm-progress" aria-label="首城授予内容">
                    <li class="is-complete">首次探索资格 · 已完成</li>
                    <li class="is-current" aria-current="step">在大地图点击首城地格</li>
                    <li>免费建立市政厅与首座传送门</li>
                </ol>
                <p class="wm-hint">${escapeHtml(cfg?.description || world.desc || '')}作为该地貌的生成模板；系统已揭开建议点周边视野，正式城市坐标仍以你最后确认的地格为准。</p>
                <p class="wm-result">${escapeHtml(siteText)}</p>
                <ul class="wm-benefits"><li>本次首城建造费用为 0。</li><li>确认后可立即进入首城，也可稍后从主神空间传送门前往。</li></ul>
                <div class="wm-actions">
                    ${recommendation?.cellId && this._selectedCellId !== recommendation.cellId
                        ? `<button type="button" class="ws-go is-secondary" data-first-founding-recommendation="${escapeHtml(recommendation.cellId)}">返回系统建议位置</button>` : ''}
                    <button type="button" class="ws-go is-primary" data-first-founding-cell="${selectedHere ? escapeHtml(site.cellId) : ''}" ${canConfirm ? '' : 'disabled'}>确认在所选地格建立首城</button>
                </div>`;
        }
        const worldConfig = WorldProgressionSystem.getWorldConfig(world.id);
        const constructionBlocked = this._constructionBlockReason(world.id);
        const constructionCost = WorldProgressionSystem.config.portal?.constructionCost || {};
        const guard = Strategy.getMapVisibleEnemies().find((enemy) => enemy.objective?.sceneId === world.id);
        const order = world.entryCell && Strategy.mapOrder(world.entryCell.id);
        const featureName = producerBuildings[worldConfig.featureBuilding?.cfgKey]?.name;
        const featureEvent = WorldProgressionSystem.getSpecialBuildingEvent?.(world.id);
        const featureBenefit = featureEvent?.suppressedByFirstCapital
            ? '<li>首座主城是安全建设实例，不会在城内刷新中立特色建筑夺取事件。</li>'
            : featureName
                ? `<li>特色事件目标：${escapeHtml(featureName)}；夺取控制权后才开放对应特色科技。</li>` : '';
        const steps = [
            { label: '定位信标', done: !!world.entryCell },
            { label: '击败信标守军 / 已有通关资格', done: world.eligible },
            { label: world.destroyed ? '接通位面（当前已断线）' : '接通位面', done: world.connected },
        ];
        const currentStep = steps.findIndex((step) => !step.done);
        return `
            ${steps.length ? `<ol class="wm-progress" aria-label="位面接通进度">${steps.map((step, index) => `<li class="${step.done ? 'is-complete' : index === currentStep ? 'is-current' : ''}"${index === currentStep ? ' aria-current="step"' : ''}>${escapeHtml(step.label)}${step.done ? ' · 已完成' : ''}</li>`).join('')}</ol>` : ''}
            <p class="wm-hint">出征入口：当前位面的指挥所、司令部或国防部。编组后以军团行军，接触敌军进入独立位面遭遇战。普通地牢仍由原NPC入口进入。</p>
            ${guard ? `<p class="wm-result">信标守军：${escapeHtml(guard.name)} · ${guard.roster.length} 个单位</p>` : ''}
            <ul class="wm-benefits"><li>接通后可建设、生产与驻防；观察不移动本体。</li>${featureBenefit}</ul>
            <div class="wm-actions">
                ${!world.entryCell ? `<button type="button" class="ws-go is-primary" data-discover-world="${world.id}" ${SceneManager.isLoading ? 'disabled' : ''}>定位此区域的信标</button>` : ''}
                ${world.entryCell && WorldProgressionSystem.getTrackedWorldId() !== world.id ? `<button type="button" class="ws-go is-secondary" data-discover-world="${world.id}" ${SceneManager.isLoading ? 'disabled' : ''}>追踪此目标</button>` : ''}
                ${world.entryCell && world.eligible && !world.connected && !world.destroyed ? `<button type="button" class="ws-go is-primary" data-connect-world="${world.id}" ${constructionBlocked ? 'disabled' : ''}>建造传送门 · ${constructionCost.gold || 0}金 + ${constructionCost.energy || 0}能</button>` : ''}
                ${world.entryCell ? `<button type="button" class="ws-go is-secondary" data-expedition-world="${world.id}" ${Strategy._busy || SceneManager.isLoading || Strategy.state.army?.defeated ? 'disabled' : ''}>${Strategy.inMap ? escapeHtml(order?.label || '行军至此信标') : '记录营地出征目标'}</button>` : ''}
            </div>
            ${world.entryCell && world.eligible && !world.connected && !world.destroyed && constructionBlocked ? `<p class="wm-hint">${escapeHtml(constructionBlocked)}</p>` : ''}`;
    },

    _baseMilitaryHtml(world) {
        if (!world.persistent) return '';
        const summary = TroopLineSystem.getBaseMilitarySummary(world.id, getWorldSnapshot(world.id));
        if (!summary.known) return `<section class="wm-base-military"><h3>基地兵力</h3><p class="wm-hint">${SceneManager.isLoading ? '正在切场，兵力登记完成后更新。' : world.destroyed ? '旧基地已失效，不沿用旧世代兵力。' : '尚无本世代驻军记录，进入基地后查看。'}</p></section>`;
        const army = Strategy.state.army;
        const fromHere = army?.originSceneId === world.id && army.originEpoch === WorldProgressionSystem.getWorldEpoch(world.id);
        const expedition = fromHere ? Strategy.troopSummary().total : 0;
        const reason = Strategy.active ? '已有亲征军团，请先让现有军团入营，再重新编组。' : !summary.live || Game._observerMode
            ? '请先让本体进入此基地，再到指挥建筑编组；观察视野不能出征。'
            : Strategy.departureBlockReason(Strategy.currentCamp())
                || (!WorldProgressionSystem.getWorldMapDiscovery(world.id)?.cell ? '请先定位本位面的大地图入口。' : '');
        const available = reason ? 0 : summary.selectable;
        const latest = Strategy.state.events.slice().reverse().find((event) => event.kind === 'base_entry'
            && event.phase === 'complete' && event.sceneId === world.id
            && event.worldEpoch === WorldProgressionSystem.getWorldEpoch(world.id));
        return `<section class="wm-base-military" aria-label="基地兵力状态">
            <div class="wm-section-heading"><h3>基地兵力</h3><small>${summary.live ? '当前现场' : '后台登记'}</small></div>
            <dl class="wm-base-troops">
                <div><dt>驻留士兵</dt><dd>${summary.stationed}</dd></div>
                <div><dt>${summary.healthUnknown ? '已知伤员' : '伤员'}</dt><dd>${summary.wounded}</dd></div>
                <div><dt>本次从此出征</dt><dd>${expedition}</dd></div>
                <div><dt>当前可编组</dt><dd>${available ?? '待入场'}</dd></div>
            </dl>
            <p class="wm-hint">${summary.live ? '已登记待落地' : '兵线驻留记录'} ${summary.pending}（已含在驻留人数内） · 调入途中 ${summary.incoming}（未计入驻留）。队友另行编组。</p>
            ${summary.healthUnknown ? `<p class="wm-hint">${summary.healthUnknown}名后台或缺少生命上限的士兵未记录完整伤势，不能视为满血；伤员数只统计已知记录。</p>` : '<p class="wm-hint">伤员包含在驻留人数中，仍可按原规则出征；伤势随军保留。</p>'}
            <p class="wm-result">${escapeHtml(reason || (available ? `可从${available}名现场士兵中选择，单军团上限${Strategy.config.maxTroops}名；待落地记录不进入选择名单。` : '当前没有可选的现场士兵；待落地记录须成功生成后才能编组。'))}</p>
            ${latest ? `<button type="button" class="ws-go is-secondary" data-event-id="${latest.id}">查看最近归营批次（历史回执）</button>` : ''}
            <p class="wm-hint">驻留按当前所在地统计，出征不再计入基地驻军；原兵营人口占用不等于驻留人数。后台建筑名册为最近结算记录。</p>
        </section>`;
    },

    _armyHtml() {
        const army = Strategy.state.army;
        const target = strategicCell(this._selectedCellId);
        const enemy = Strategy.getMapVisibleEnemies().find((entry) => entry.id === this._selectedArmyId);
        const march = army && Strategy.marchStatus(army);
        const preview = Strategy.previewMapOrder(target?.id, enemy?.id);
        const order = preview.order;
        const place = (cell) => cell ? `${WORLD_MAP_PLANES.find((plane) => plane.sceneId === cell.planeSceneId)?.label || '地图'} · ${cell.q}, ${cell.r}` : '点击地图选择地格';
        const estimate = preview.ok ? preview : null;
        const terrain = strategicTerrain(target);
        const selection = `<article class="wm-order-target" tabindex="-1" data-focus-key="army-target" aria-label="所选目标与行军指令">
            <p class="wm-detail-kicker">${enemy ? '已选敌军 · 跟踪当前位置' : '行军目标'}</p>
            ${enemy ? `<div class="wm-army-identity is-hostile">${armyFlagPortrait(enemy)}<div><strong>${escapeHtml(enemy.name)}</strong><small>${enemy.objective ? '信标守军' : '敌方军团'} · ${enemy.roster.length} 单位 · ${escapeHtml(this._enemyOrder(enemy))}</small></div></div>` : `<strong>${escapeHtml(place(target))}</strong>`}
            ${enemy ? `<p class="wm-hint">${escapeHtml(place(target))}${enemy.warId ? ' · 正在围攻城镇' : ''}</p>` : ''}
            ${enemy?.invasion ? `<p class="wm-result">${escapeHtml(enemy.invasion.composition)}</p><p class="wm-hint">${escapeHtml(enemy.invasion.discoverySource)} · 目标：${escapeHtml(WorldProgressionSystem.getWorldConfig(enemy.invasion.targetWorld)?.name || enemy.invasion.targetWorld)}。拦截可消耗后备或解除本次入侵，撤退保留敌军伤势。</p>` : ''}
            <p class="wm-hint">${enemy ? '追击会跟随这支军团；接触后进入位面战斗。' : order?.action === 'enter' ? '抵达已接通的己方基地后自动入营，本体与幸存部队一起进入该位面。' : '左键选格，右键或按钮下令。普通行军避开已知敌军、敌城和围城格；途中仍可能遭遇移动敌军。'}</p>
            ${target ? `<p class="wm-hint">${escapeHtml(terrain.name)} · 地貌耗时 ×${terrain.multiplier} · 不跨河进入该格需 ${formatStrategicTravelTime(strategicStepMs(null, target))}</p><p class="wm-hint">渡河无需桥梁，跨河路段耗时 ×${Strategy.config.terrainRules.riverCrossingMultiplier}；沿岸移动不加罚，预计行程已计入渡河代价。</p>` : ''}
            ${estimate ? `<p class="wm-result">预计行程 ${estimate.route.length} 格 · ${formatStrategicTravelTime(estimate.durationMs)}${enemy ? ' · 按敌军当前位置估算' : ''}${march ? ' · 已计入当前路段剩余时间' : ''}</p><p class="wm-hint">${strategicClockHint()}</p>` : army && target ? `<p class="wm-result">${escapeHtml(preview.reason)}</p>` : ''}
            ${army ? '<p class="wm-hint">此处查看目标；正在控制的我军和操作按钮始终保留在底部。</p>' : ''}
        </article>`;
        if (!army) return `<article class="wm-empty"><div class="wm-army-identity">${armyFlagPortrait({ friendly: true })}<div><p class="wm-detail-kicker">尚无出征军团</p><strong>在指挥建筑中编组</strong></div></div><p class="wm-hint">研究“军事指挥 → 指挥所”，在已接通位面建造指挥所；选择当地士兵和队友，确认出征后军团才会出现在大地图。</p><p class="wm-hint">司令部、国防部沿用同一出征入口。</p></article>${enemy || target ? selection : ''}`;
        return `${selection}
            <p class="wm-hint">可右键任一已接通且无战事的己方基地入营；敌方城镇与营地仅能摧毁，不变为己方基地。出发基地失效或亲征失败时，可撤回主神空间。</p>
            ${Strategy.state.lastResult ? `<p class="wm-result">${escapeHtml(Strategy.state.lastResult)}</p>` : ''}`;
    },

    _routeHtml() {
        const army = Strategy.state.army;
        if (!army) return '';
        const stops = Strategy.routeStops(), estimate = Strategy.estimateCurrentRoute();
        const sites = Strategy.getMapSettlements(), planKey = Strategy.routePlanKey();
        const disabled = !Strategy.inMap || Strategy._busy || SceneManager.isLoading || army.defeated;
        const terminal = army.entryTarget ? '入营终点' : army.pursueId || army.targetId || army.reliefWarId || army.allowHostileTarget ? '接战终点' : '待命终点';
        return `<div class="wm-section-heading"><h3>行军路线</h3><small>${stops.length} / ${Strategy.config.march.maxRouteStops}站</small></div>
            <p class="wm-hint">Shift＋右键或底部“追加路线”依次安排；普通右键重新规划。攻击与入营只能是最后一站。</p>
            ${stops.length ? `<ol class="wm-route-list">${stops.map((cellId, index) => {
                const final = index === stops.length - 1;
                const enemy = final && Strategy.getMapVisibleEnemies().find((unit) => unit.id === army.pursueId);
                const name = enemy?.name || sites.find((site) => site.cellId === cellId)?.name || `地格 ${cellId}`;
                const eta = estimate?.stops[index];
                return `<li><button type="button" class="wm-route-location" data-route-locate="${escapeHtml(cellId)}" title="在地图定位此站">
                    <b>${index + 1}</b><span><strong>${escapeHtml(name)}</strong><small>${final ? terminal : '途经点'} · ${eta ? `累计 ${formatStrategicTravelTime(eta.durationMs)}` : '路线待复核'}</small></span></button>
                    ${!final ? `<button type="button" class="wm-route-end" data-route-end="${index}" data-route-plan="${escapeHtml(planKey)}" title="删除此站之后的所有节点，并取消后续攻击或入营" ${disabled ? 'disabled' : ''}>在此结束</button>` : ''}</li>`;
            }).join('')}</ol><p class="wm-hint">${estimate ? `累计耗时包含当前路段剩余时间，经过一站后更新。${strategicClockHint()}` : '后续路线当前不可达；当前段完成后复核，仍不可达则停止。'}</p>`
                : '<p class="wm-hint">尚无后续路线，选择地格即可安排。</p>'}`;
    },

    _commandDockHtml() {
        const army = Strategy.state.army;
        if (!army) return '';
        const march = Strategy.marchStatus(army), troops = Strategy.troopSummary();
        const disabled = !Strategy.inMap || Strategy._busy || SceneManager.isLoading;
        const enemyId = this._selectedArmyId === PLAYER_ARMY_MARKER_ID ? null : this._selectedArmyId;
        const preview = Strategy.previewMapOrder(this._selectedCellId, enemyId);
        const appendPreview = Strategy.previewMapOrder(this._selectedCellId, enemyId, { append: true });
        const kind = commandKind(preview);
        const returnToMain = army.defeated || !WorldProgressionSystem.isPortalConstructed(army.originSceneId)
            || !WorldProgressionSystem.isWorldEpochCurrent(army.originSceneId, army.originEpoch);
        const currentTarget = army.entryTarget?.cellId || Strategy.getMapVisibleEnemies().find((enemy) => enemy.id === army.pursueId)?.cellId || army.destination;
        const underway = Strategy.estimateCurrentRoute();
        const state = Strategy.inBattle ? '接战中' : army.defeated ? '战败待撤回' : disabled ? '正在切场' : army.mapStatus === 'blocked' ? '受阻待命' : army.entryTarget ? '行军入营' : army.pursueId ? '追击敌军' : army.route.length ? '行军中' : '待命';
        const targetName = Strategy.getMapSettlements().find((site) => site.cellId === currentTarget)?.name || (currentTarget ? `地格 ${currentTarget}` : '当前格');
        const selectedName = Strategy.getMapVisibleEnemies().find((enemy) => enemy.id === enemyId)?.name
            || Strategy.getMapSettlements().find((site) => site.cellId === this._selectedCellId)?.name
            || (this._selectedCellId ? `地格 ${this._selectedCellId}` : '请选择目标');
        return `<div class="wm-dock-army"><div class="wm-army-identity is-friendly">${armyFlagPortrait({ friendly: true })}<div><small>${this._controlledArmyId ? '正在控制' : '亲征军团'} · ${state}</small><strong>${escapeHtml(army.name)}</strong><span>士兵 ${troops.total} · 伤员 ${troops.wounded} · 队友 ${army.companionIds.length}</span></div></div>
            <p>${underway ? `当前命令 → ${escapeHtml(targetName)}${army.waypoints?.length ? ` · 经${army.waypoints.length}站` : ''} · ${formatStrategicTravelTime(underway.durationMs)}` : escapeHtml(army.orderNote || '军团待命，右键地格下令。')}</p>
            ${march ? `<progress class="wm-march-progress" value="${march.progress}" max="1" aria-label="当前路段行军进度"></progress><small>当前路段 ${Math.floor(march.progress * 100)}% · 余 ${formatStrategicTravelTime(march.remainingMs)} · 改令先走完本段</small>` : ''}<small>${strategicClockHint()}</small></div>
            <div class="wm-dock-orders"><div class="wm-dock-target"><strong>所选目标：${escapeHtml(selectedName)}</strong><span>${preview.ok ? `重新规划：${preview.route.length}格 · ${formatStrategicTravelTime(preview.durationMs)}` : escapeHtml(preview.reason)}</span>
            ${appendPreview.ok && appendPreview.waypoints.length ? `<span>追加后：${appendPreview.stops.length}站 · ${formatStrategicTravelTime(appendPreview.durationMs)}</span>` : ''}</div>
            <div class="wm-actions wm-dock-buttons">
                <button type="button" class="ws-go is-primary" data-army-action="move" ${preview.ok ? '' : 'disabled'}>${commandBadge(kind)}<span>${escapeHtml(preview.order?.label || '选择目标')}</span></button>
                <button type="button" class="ws-go is-secondary" data-army-action="append" title="${escapeHtml(appendPreview.ok ? '保留现有途经点，在路线末尾追加所选目标（同Shift＋右键）' : appendPreview.reason)}" ${appendPreview.ok ? '' : 'disabled'}>追加路线</button>
                <button type="button" class="ws-go is-secondary" data-army-action="hold" title="取消后续命令，走完当前路段后停止" ${disabled || army.defeated ? 'disabled' : ''}>${march ? '到下一格停止' : '停止行军'}</button>
                <button type="button" class="ws-go is-secondary" data-select-army="${PLAYER_ARMY_MARKER_ID}">定位我军</button>
                <button type="button" class="ws-go is-secondary" data-army-action="home" ${disabled ? 'disabled' : ''}>${returnToMain ? '撤回主神空间' : !march && army.cellId === army.originCellId ? '进入出发基地' : '返回出发基地'}</button>
            </div></div>`;
    },

    _enemyOrder(enemy) {
        if (enemy.invasion) return `入侵行军 · 预计${formatStrategicTravelTime(Math.max(0, Strategy.invasionArrivalAt(enemy) - strategicNow()))}抵达`;
        return { hold: '驻守', wander: '游荡', patrol: '巡逻', hunt: '搜索追击', move: '指令移动', siege: enemy.warId ? '围攻中' : '行军攻城' }[enemy.order] || '行动中';
    },

    _inspectEvent(id) {
        this._selectedEventId = id; Strategy.readEvent(id);
        this._setSidebarTab('events'); this._render();
    },
    async _retryEvent(id) {
        const result = await Strategy.retryEntryEvent(id);
        if (this._panel?.isOpen) this._showOrderResult(result);
    },
    _eventKind(event) {
        return ['blocked', 'order_rejected', 'target_lost'].includes(event.kind) || event.phase === 'failed' ? 'blocked'
            : ['battle', 'battle_result', 'siege'].includes(event.kind) ? 'attack'
            : ['base_entry', 'engineering_report'].includes(event.kind) ? 'enter' : 'move';
    },
    _eventsHtml() {
        const events = Strategy.state.events.slice().reverse();
        return `<div class="wm-section-heading"><h3>最近动态</h3><small>保留最近40条</small></div>
            <div class="wm-actions"><button type="button" data-events-read="all" ${events.some((event) => !event.read) ? '' : 'disabled'}>全部标为已读</button></div>
            <div class="wm-event-list">${events.map((event) => `<button type="button" class="wm-event-item ${event.read ? '' : 'is-unread'}" data-event-id="${event.id}" aria-pressed="${event.id === this._selectedEventId}">
                ${commandBadge(this._eventKind(event))}<span><strong>${escapeHtml(event.title)}</strong><small>${event.read ? '已读' : '未读'} · 世界时间 ${formatStrategicDuration(event.at)}</small></span></button>`).join('') || '<p class="wm-hint">尚无动态。抵达、遇敌、受阻、围城和入营结果会保留在这里。</p>'}</div>`;
    },
    _eventDetailHtml() {
        const event = Strategy.state.events.find((item) => item.id === this._selectedEventId);
        if (!event) return '<p class="wm-hint">选择一条动态查看详情；定位不会下达行军命令。</p>';
        const receipt = event.receipt;
        const engineering = event.kind === 'engineering_report' ? event.report : null;
        const expedition = event.kind === 'expedition_report' ? event.report : null;
        const battle = event.kind === 'battle_result' ? event : null;
        const number = (value) => Math.max(0, Math.floor(Number(value) || 0));
        const retry = event.kind === 'base_entry' && event.phase === 'failed';
        const reason = retry && Strategy.entryRetryReason(event);
        const kicker = event.kind === 'engineering_report' ? '位面工程报告' : event.kind === 'expedition_report' ? '探险结算报告'
            : event.kind === 'battle_result' ? '军团战斗报告' : event.kind === 'base_entry' ? '基地接收记录' : '战略事件';
        return `<article class="wm-event-detail"><p class="wm-detail-kicker">${kicker}</p><strong>${escapeHtml(event.title)}</strong>
            <p class="wm-hint">${escapeHtml(event.detail)}</p>
            ${engineering ? `<dl class="wm-receipt-grid">${[['建筑升级', engineering.buildingUpgrades?.length], ['持续升级阶段', engineering.continuousStages?.length], ['完成招募', engineering.recruits], ['传送门工程', engineering.portals?.length]].map(([label, value]) => `<div><dt>${label}</dt><dd>${number(value)}</dd></div>`).join('')}</dl>
                ${[...(engineering.buildingUpgrades || []), ...(engineering.continuousStages || []), ...(engineering.portals || [])].length ? `<ul>${[...(engineering.buildingUpgrades || []), ...(engineering.continuousStages || []), ...(engineering.portals || [])].map((label) => `<li>${escapeHtml(label)}</li>`).join('')}</ul>` : ''}` : ''}
            ${expedition ? `<dl class="wm-receipt-grid">${[['归来批次', expedition.runs], ['战利品件数', expedition.itemCount], ['金币', expedition.gold], ['信箱附件', expedition.mailed]].map(([label, value]) => `<div><dt>${label}</dt><dd>${number(value)}</dd></div>`).join('')}</dl>` : ''}
            ${battle ? `<dl class="wm-receipt-grid">${[['出战士兵', number(battle.survivors) + number(battle.casualties)], ['幸存', battle.survivors], ['伤亡', battle.casualties], ['待领取战利品', battle.lootCount]].map(([label, value]) => `<div><dt>${label}</dt><dd>${number(value)}</dd></div>`).join('')}</dl>` : ''}
            ${receipt ? `<dl class="wm-receipt-grid">${[['本次士兵', receipt.expected], ['已登记', receipt.accepted], ['已落地', receipt.deployed], ['等待落地', receipt.pending], ['伤员（含待落地）', receipt.wounded], ['归队队友', receipt.companions]].map(([label, value]) => `<div><dt>${label}</dt><dd>${number(value)}</dd></div>`).join('')}</dl>
                ${receipt.unaccounted ? `<p class="wm-tone-warning">有${number(receipt.unaccounted)}名记录待核对；未计为已落地或等待落地。</p>` : ''}<p class="wm-hint">以上是接收时的清单，不是当前基地总兵力；不会因查看记录重新生成士兵。</p>` : ''}
            <div class="wm-actions">${strategicCell(event.cellId) ? `<button type="button" data-event-locate="${event.id}">定位事发地格</button>` : ''}
            ${battle && Strategy.state.pendingLoot.length ? `<button type="button" class="is-primary" data-campaign-action="loot" ${Strategy._busy || Strategy.inBattle || SceneManager.isLoading ? 'disabled' : ''}>领取待领战利品</button>` : ''}
            ${retry ? `<button type="button" class="is-primary" data-event-retry="${event.id}" ${reason ? 'disabled' : ''}>重新下达入营</button>` : ''}</div>
            ${reason ? `<p class="wm-hint">${escapeHtml(reason)}</p>` : ''}</article>`;
    },

    _invasionCatalogHtml() {
        const catalog = window.WorldInvasionSystem?.getInvasionCatalog?.();
        if (!catalog) return '';
        const roleNames = { normal: '普通', elite: '精锐', leader: '首领' };
        const groups = this._invasionCatalogOpen ? catalog.families.map((family) => {
            const entries = catalog.entries.filter((entry) => entry.seriesId === family.id);
            return `<article class="wm-detail-card"><h4>${escapeHtml(family.name)} · ${entries.length}种</h4>
                ${entries.map((entry) => `<p><strong>${escapeHtml(entry.name)}</strong> · ${roleNames[entry.role] || '特殊对象'}
                    <small class="wm-hint">${escapeHtml(entry.formationStatus)} · 最早第${entry.minDay}天</small>
                    <small class="wm-hint">${escapeHtml(entry.basis)} · ${entry.assetBudget
                        ? `已知整套 ${(entry.assetBudget.bytes / 1048576).toFixed(1)}MiB` : '资源预算在集结选型时读取'}</small></p>`).join('')}</article>`;
        }).join('') + catalog.entries.filter((entry) => !entry.seriesId).map((entry) =>
            `<p class="wm-hint">${escapeHtml(entry.name)}：${escapeHtml(entry.reasons.join('；'))}
                ${escapeHtml(entry.suggestions.map((suggestion) => `建议${suggestion.name}(${suggestion.score}分，待确认)`).join('；'))}</p>`).join('') : '';
        return `<details data-invasion-catalog ${this._invasionCatalogOpen ? 'open' : ''}>
            <summary>入侵类别目录 · ${catalog.entries.length}种 / ${catalog.families.length}类</summary>
            <p class="wm-hint">这是类别与准入目录，不披露未发现军团。每场只选一种普通怪、一种精锐和一种首领；缺角色或适配的类别不会强行混编。</p>${groups}</details>`;
    },

    _enemiesHtml() {
        const enemies = Strategy.getMapVisibleEnemies();
        return `<div class="wm-section-heading"><h3>敌方军团</h3><small>${enemies.length} 支</small></div>
            <p class="wm-hint">仅显示当前视野中的敌军。青色亮区为战略视野：普通部队1格，携斥候2格；有岗位的气象塔2格、位面观测阵列3格。已经看过的地貌保留为灰暗探索区，移动敌军离开视野后不继续显示精确位置；入侵预警事件仍然保留。</p>
            ${this._invasionCatalogHtml()}
            <div class="wm-enemy-list">${enemies.map((enemy) => {
                const cell = strategicCell(enemy.cellId);
                return `<button type="button" class="wm-enemy-item" data-select-army="${escapeHtml(enemy.id)}" aria-pressed="${enemy.id === this._selectedArmyId}">${armyFlagPortrait(enemy)}<span class="wm-enemy-copy"><strong>${escapeHtml(enemy.name)}${enemy.objective ? ' · 守' : ''}</strong><small>${enemy.roster.length} 单位 · ${escapeHtml(this._enemyOrder(enemy))} · ${cell?.q}, ${cell?.r}</small></span></button>`;
            }).join('') || '<p class="wm-hint">当前没有敌方军团。</p>'}</div>`;
    },

    _campaignHtml() {
        const wars = Strategy.getMapWars();
        const selected = Strategy.getMapSettlements().find((site) => site.cellId === this._selectedCellId);
        const repair = selected?.owner === 'player' && selected.kind !== 'world' ? Strategy.settlementRepairQuote(selected.id) : null;
        const disabled = (!Strategy.inMap && !this._controlledDetachmentId) || Strategy._busy || SceneManager.isLoading
            || !!this._controlledSettlerId
            || (!this._controlledDetachmentId && Strategy.state.army?.defeated);
        const action = (name, label, id, blocked = disabled) => {
            const style = name === 'destroy' ? 'is-danger' : ['relieve', 'enter'].includes(name) ? 'is-primary' : 'is-secondary';
            const quote = name === 'repair' ? ` data-repair-quote="${JSON.stringify(repair.price)}" title="${escapeHtml(repair.reason || '按当前报价修复城防')}"` : '';
            return `<button type="button" class="ws-go ${style}" data-campaign-action="${name}" data-target-id="${id}"${quote} ${blocked ? 'disabled' : ''}>${label}</button>`;
        };
        const owner = (site) => site.status === 'destroyed' ? '废墟' : site.owner === 'player' ? '我方' : '敌方';
        const repairBlocked = disabled || !repair?.ok;
        const repairCost = repair?.free ? '调试免费' : repair ? `${repair.gold}金币 / ${repair.energy}能源${repair.food ? ` / ${repair.food}粮食` : ''}` : '';
        const repairHint = repair?.free ? '当前调试设置免除修复费用。' : repair?.remote
            ? `报价已含跨位面附加费用 ${Math.round((repair.multiplier - 1) * 100)}%；点击时重新核价，费用变化不扣款。`
            : '按当前仓储报价修复，点击时重新核价。';
        const entry = selected?.kind === 'world' && selected.owner === 'player' && selected.status === 'active'
            ? Strategy.baseEntry(selected.sceneId) : null;
        const siteDescription = selected?.kind === 'world' ? '建设位面：毁灭与重建沿用原有建筑、资源和传送门规则。'
            : selected?.foundedBy === 'settler' ? `移民新城：${selected.population} 名居民已定居，城防参与战略围城；人口暂作为定居人数保存。独立基地场景、城内建设和人口生产尚未接通。`
            : '战略据点：破门或拆侧墙进入；清除驻军与关键设施后摧毁，无需拆光城墙。撤退保留驻军、设施和城防损伤；拆掉兵营后停止补兵。敌方据点不提供占领；新城需由移民队建立。';
        return `<strong>各城战事 · ${wars.length}</strong>
            ${wars.length ? wars.map((war) => `<article class="wm-war"><button type="button" class="wm-destination" data-army-cell="${war.cellId || ''}"><span>${escapeHtml(war.name)}</span><small class="wm-tone-warning">${war.suspended ? '我军正在解围' : '遭到围攻'}</small></button><p class="wm-hint">${war.source === 'world' ? `第${war.waveIndex}/${war.waveCount}波 · 城镇核心 ${Math.ceil(WorldProgressionSystem.getPortalState(war.targetWorld).hp)}` : '据点设施持续受损'} · 其他城市独立结算</p><div class="wm-actions">${action('relieve', '军团行军解围', war.id)}${!Strategy.active && war.source === 'world' ? `<button type="button" class="ws-support" data-support-world="${war.targetWorld}" ${SceneManager.isLoading || SceneManager.isDungeonRunActive() || SceneManager.getCurrentWorldId() === war.targetWorld ? 'disabled' : ''}>本体支援此城</button>` : ''}</div></article>`).join('') : '<p class="wm-hint">当前没有围城战。敌方城镇会补充军团，敌军会选择我方城镇行军攻城。</p>'}
            ${selected ? `<article class="wm-site-detail"><strong>${escapeHtml(selected.name)} · ${owner(selected)}</strong><p class="wm-hint">${siteDescription}</p>${selected.structures ? `<ul>${selected.structures.map((record) => `<li>${escapeHtml(record.name)}：${Math.ceil(record.hp)} / ${record.maxHp}</li>`).join('')}</ul><p class="wm-hint">驻军 ${selected.roster.length} 名</p>` : ''}<div class="wm-actions">${selected.owner === 'enemy' && selected.status !== 'destroyed' ? action('destroy', '行军摧毁', selected.id) : ''}${repair ? action('repair', `修复 +${Math.round(Strategy.config.campaign.repairRatio * 100)}% · ${repairCost}`, selected.id, repairBlocked) : ''}</div>${repair ? `<p class="wm-hint">${escapeHtml(repair.reason || repairHint)}</p>` : ''}</article>` : '<p class="wm-hint">点击地图上的城镇或据点查看设施详情。</p>'}
            ${entry ? `<div class="wm-actions">${action('enter', Strategy.mapOrder(entry.cellId)?.action === 'enter' ? Strategy.mapOrder(entry.cellId).label : '行军并入营（须先解围）', entry.sceneId, disabled || !!Strategy.baseEntryBlockReason(entry))}</div><p class="wm-hint">入营后兵旗收起，幸存部队在基地落点附近恢复为单位；不会自动塞回兵营生产队列。</p>` : ''}
            <div class="wm-loot"><strong>待领取战利品 · ${Strategy.state.pendingLoot.length}</strong><p class="wm-hint">领取时优先进入背包和仓库；装不下的物品会独立转入小鼠大王奖励信箱。</p>${action('loot', '领取战利品', '', Strategy._busy || Strategy.inBattle || SceneManager.isLoading || !Strategy.state.pendingLoot.length)}</div>`;
    },

    _render() {
        const el = this._panel?.el;
        if (!el) return;
        const current = SceneManager.getCurrentWorldId();
        Strategy.ensureCampaign();
        const foundingRecommendation = this._firstFoundingSelection
            ? WorldProgressionSystem.ensureFirstFoundingRecommendation() : null;
        if (foundingRecommendation?.cellId) {
            Strategy.revealMapArea(foundingRecommendation.cellId,
                WorldProgressionSystem.config.firstFounding?.initialVisionRadius || 3,
                { key: 'first_founding_recommendation' });
            if (!this._selectedCellId) {
                this._selectedCellId = foundingRecommendation.cellId;
                this._selectedId = foundingRecommendation.sceneId;
            }
        }
        const mapIntel = Strategy.refreshMapIntel();
        const army = Strategy.state.army, enemies = Strategy.getMapVisibleEnemies(), wars = Strategy.getMapWars();
        const detached = Strategy.state.detachments.find((unit) => unit.id === this._controlledDetachmentId);
        const settler = Strategy.settler(this._controlledSettlerId), controlledSupport = settler || detached;
        if (!detached) this._controlledDetachmentId = null;
        if (!settler) this._controlledSettlerId = null;
        this._controlledArmyId = controlledSupport?.id || (Strategy.inMap && army && !army.defeated ? army.id : null);
        const commandStatus = el.querySelector('#wmCommandStatus');
        const feedback = this._commandFeedback || controlledSupport?.orderNote || army?.orderNote || (army ? '右键下令 · 己方基地可行军入营 · 世界时间继续运行' : '选择分遣军或移民队可独立下令 · 地图打开期间世界继续运行');
        if (commandStatus.textContent !== feedback) commandStatus.textContent = feedback;
        const selectedArmy = this._selectedArmyId === PLAYER_ARMY_MARKER_ID ? army : Strategy.playerArmy(this._selectedArmyId)
            || Strategy.settler(this._selectedArmyId)
            || Strategy.state.convoys.find((unit) => unit.id === this._selectedArmyId) || enemies.find((enemy) => enemy.id === this._selectedArmyId);
        if (this._selectedArmyId && !selectedArmy) this._selectedArmyId = null;
        if (selectedArmy) this._selectedCellId = selectedArmy.cellId;
        if (Strategy.state.army && !this._selectedCellId) this._selectedCellId = Strategy.state.army.cellId;
        this._setSidebarTab(this._sidebarTab || 'worlds');
        this._setSectionHtml('wmBrief', this._firstFoundingSelection
            ? '<strong>首城授予</strong><span>点击大地图合法地格，免费建立市政厅与首座传送门</span><div class="wm-brief-stats"><span><b>0</b><small>本次费用</small></span><span><b>1</b><small>授予城市</small></span><span><b>永久</b><small>确认结果</small></span></div>'
            : `<strong>战略总览</strong><span>${Strategy.inBattle ? '位面接战中' : army ? '军团已出征' : '等待编组出征'}</span><div class="wm-brief-stats"><span><b>${Strategy.playerArmies().length}</b><small>我方军团</small></span><span><b>${enemies.length}</b><small>敌方军团</small></span><span><b>${wars.length}</b><small>进行中战事</small></span></div>`);
        el.querySelector('[data-tab-count="army"]').textContent = Strategy.playerArmies().length + Strategy.state.settlers.length + enemies.length;
        el.querySelector('[data-tab-count="campaign"]').textContent = wars.length;
        const unread = Strategy.state.events.filter((event) => !event.read).length;
        el.querySelector('[data-tab-count="events"]').textContent = unread;
        el.querySelector('[data-sidebar-tab="events"]').classList.toggle('has-alert', unread > 0);
        if (!Strategy.state.events.some((event) => event.id === this._selectedEventId)) this._selectedEventId = null;
        this._setSectionHtml('wmEventDetail', this._eventDetailHtml());
        this._setSectionHtml('wmEventList', this._eventsHtml());
        el.querySelector('[data-sidebar-tab="campaign"]').classList.toggle('has-alert', wars.length > 0);
        this._setSectionHtml('wmArmy', settler ? '' : this._armyHtml());
        this._setSectionHtml('wmSupportArmies', settlersHtml(this._controlledArmyId, this._selectedCellId)
            + supportArmyHtml(this._controlledArmyId, this._selectedCellId, this._supplySources ||= {}));
        this._setSectionHtml('wmRoute', controlledSupport ? '' : this._routeHtml());
        el.querySelector('#wmCommandDock').hidden = !army || !!controlledSupport;
        this._setSectionHtml('wmCommandDock', this._commandDockHtml());
        this._setSectionHtml('wmEnemies', this._enemiesHtml());
        this._setSectionHtml('wmCampaign', this._campaignHtml());
        const armyTarget = el.querySelector('[data-army-target]');
        el.querySelector('#wmCoordinates').hidden = !army && !Strategy.state.detachments.length && !Strategy.state.settlers.length;
        if (document.activeElement !== armyTarget) armyTarget.value = this._selectedCellId || '';
        // UI-only interpolation; logical occupancy/contact commits on completed edges.
        const visualArmy = (unit) => ({ ...unit, marchProgress: Strategy.marchStatus(unit)?.progress || 0 });
        this._map?.setArmies(army && visualArmy(army), enemies.map(visualArmy), this._selectedCellId, this._selectedArmyId, !!this._controlledArmyId,
            [...Strategy.state.detachments, ...Strategy.state.convoys, ...Strategy.state.settlers].map(visualArmy), this._controlledArmyId);
        this._map?.setRouteStops(controlledSupport ? [...(controlledSupport.waypoints || []), ...(controlledSupport.destination ? [controlledSupport.destination] : [])] : Strategy.routeStops());
        this._map?.setSettlements(Strategy.getMapSettlements(), wars);
        this._map?.setFoundingRecommendation(foundingRecommendation?.cellId || null);
        this._map?.setMapIntel(mapIntel);
        if (this._hoverTarget && !this._hoverTimer) this._renderHover();
        const home = Game._observerMode ? Game._observerHomeScene : current;
        const dungeonActive = SceneManager.isDungeonRunActive();
        const invasions = window.WorldInvasionSystem?.getBattles?.() || [];
        const playerWorlds = visibleWorlds({
            includeFirstFoundingCandidates: this._firstFoundingSelection,
        });
        let candidates = dungeonActive
            ? [{ id: 'scene7', icon: '🗺️', desc: '当前地牢探险' }, ...playerWorlds]
            : playerWorlds;
        if (this._firstFoundingSelection) {
            const allowed = new Set(WorldProgressionSystem.getFirstFoundingCandidates().map((entry) => entry.sceneId));
            candidates = playerWorlds.filter((world) => allowed.has(world.id));
        }
        const selectedFoundingCell = this._firstFoundingSelection ? strategicCell(this._selectedCellId) : null;
        const selectedFoundingSite = this._firstFoundingSelection
            ? WorldProgressionSystem.inspectFirstFoundingCell(this._selectedCellId) : null;
        const states = candidates.map((world) => {
            const persistent = !!WorldProgressionSystem.getWorldConfig(world.id);
            const portal = persistent ? WorldProgressionSystem.getPortalState(world.id) : null;
            const connected = !persistent || WorldProgressionSystem.isPortalConstructed(world.id);
            const discovery = persistent ? WorldProgressionSystem.getWorldMapDiscovery(world.id) : null;
            const entryCell = discovery?.cell
                || (selectedFoundingCell?.planeSceneId === WorldProgressionSystem.getRuntimeSceneId(world.id)
                    ? selectedFoundingCell : null);
            const eligible = persistent && WorldProgressionSystem.isWorldEligible(world.id);
            const rawSpecialEvent = persistent && connected
                ? WorldProgressionSystem.getSpecialBuildingEvent?.(world.id) : null;
            const specialEvent = rawSpecialEvent?.suppressedByFirstCapital ? null : rawSpecialEvent;
            const hallAlive = persistent && SceneManager._hasLiveWorldAnchor?.(world.id, 'city_hall');
            const isCurrent = current === world.id;
            const isHome = Game._observerMode && home === world.id;
            const badge = this._firstFoundingSelection
                ? selectedFoundingCell?.planeSceneId === WorldProgressionSystem.getRuntimeSceneId(world.id)
                    ? (selectedFoundingSite.ok ? '已选城址' : '选址无效') : '可选地貌'
                : specialEvent && specialEvent.status !== 'completed'
                    ? `？ ${specialEvent.status === 'active' ? '夺取事件进行中' : '夺取特色建筑'}`
                : isCurrent ? '当前视野' : isHome ? '本体所在'
                : portal?.destroyed ? '传送门已毁'
                : !connected ? (eligible ? '可接通' : entryCell ? '信标待打通' : '信标未定位')
                : invasions.some((war) => war.targetWorld === world.id) ? '入侵中' : '已接通';
            return { ...world, persistent, connected, isCurrent, isHome, badge, entryCell, discovery, eligible, specialEvent,
                destroyed: !!portal?.destroyed, hallAlive: !!hallAlive,
                endpointExists: !!portal?.endpointExists };
        });
        if (!states.some((world) => world.id === this._selectedId)) this._selectedId = states[0]?.id || 'main';
        const selected = states.find((world) => world.id === this._selectedId);
        if (!selected) return;
        const tracked = states.find((world) => world.id === WorldProgressionSystem.getTrackedWorldId());
        const awaitingFirstFounding = WorldProgressionSystem.getFoundingState().status === 'awaiting_king';
        const registeredPlaneCount = states.filter((world) => world.persistent).length;
        const connectedPlaneCount = states.filter((world) => world.persistent && world.connected).length;
        el.querySelector('[data-tab-count="worlds"]').textContent = this._firstFoundingSelection
            ? String(states.length)
            : String(connectedPlaneCount);
        const celebration = this._foundingCelebration?.sceneId === selected.id ? this._foundingCelebration : null;
        this._setSectionHtml('wmObjective', celebration ? `
            <strong>首城落成 · ${escapeHtml(celebration.name)}</strong>
            <p>${escapeHtml(celebration.terrain || '新位面')}已完成登记：市政厅、首座传送门和大地图权限均已启用。</p>
            <button type="button" class="ws-go is-primary" data-enter-first-founding="${celebration.sceneId}">进入首座位面</button>`
            : this._firstFoundingSelection
                ? `<strong>小鼠大王的首城授予</strong><p>已随机标出一处安全建议位置并揭开周边视野；你仍可在 ${states.length} 种地貌中自由查看，改选任意合法地格。确认后免费建立市政厅与首座传送门。</p>`
                : awaitingFirstFounding
                    ? '<strong>大地图已解锁</strong><p>返回主神空间与小鼠大王交谈，开启首城选址；批准前可查看航图，但不能提前定位、远征或建造。</p>'
                    : this._objectiveHtml(tracked || selected));
        const map = worldMapInfo();
        el.querySelector('#wmContext').textContent = this._firstFoundingSelection
            ? `首城选址：已提供初始视野与建议点 · 可改选任意合法地格 · 确认后不可更改`
            : `${Game._observerMode ? '观察视野' : '当前所在'}：${this._worldName(current)} · 已接通 ${connectedPlaneCount}${registeredPlaneCount > connectedPlaneCount ? ` · 已登记 ${registeredPlaneCount}` : ''} · ${map.cellCount}格`;
        el.querySelector('#wmContext').title = `${map.kind === 'generated' ? '随机大陆' : '旧版大陆'} · 地图种子 ${map.seed}`;
        this._setSectionHtml('wmDestinations', states.map((world) => `
            <button type="button" class="wm-destination${world.isCurrent ? ' is-current' : ''}${world.connected ? '' : ' is-offline'}"
                data-select-world="${world.id}" aria-pressed="${selected.id === world.id}">
                <span class="wm-destination-name">${world.icon} ${escapeHtml(this._firstFoundingSelection
                    ? `${WorldProgressionSystem.getWorldTerrainLabel(world.id)}模板` : this._worldName(world.id))}</span>
                <small class="wm-destination-state">${escapeHtml(world.badge)}</small>
            </button>`).join(''));
        let status;
        if (this._firstFoundingSelection) {
            status = !selectedFoundingCell
                || selectedFoundingCell.planeSceneId !== WorldProgressionSystem.getRuntimeSceneId(selected.id)
                ? '请在中央大地图点击一个平地；点击其他地貌会自动切换对应生成模板。'
                : selectedFoundingSite.ok
                    ? `首城将建立在 (${selectedFoundingCell.q}, ${selectedFoundingCell.r})，使用${selectedFoundingSite.terrainLabel || '当前地貌'}模板生成。`
                    : selectedFoundingSite.reason;
        } else if (!selected.connected && !selected.isCurrent) {
            status = selected.destroyed && selected.hallAlive ? (selected.endpointExists
                ? '传送门已毁，市政厅仍维持位面；修复旧门后恢复观察与通行。'
                : '移民已恢复市政厅；研究位面门工程并建造新门后恢复通行。')
                : selected.destroyed ? '市政厅与传送门均已毁，位面已经崩塌；请派移民队前往旧城址。'
                : selected.eligible ? (selected.entryCell ? '已获得接通资格，可在此格首次接通。' : '已获得接通资格，定位信标后可首次接通。')
                    : selected.entryCell ? '信标已定位。率军击败此格守军后接通；原有地牢通关资格仍然有效。' : '区域地貌已知，但入口尚未定位。先定位信标再在营地编组出征。';
        } else if (selected.id === 'scene7') {
            status = selected.isCurrent ? '探险进行中' : '地牢现场已保留，可返回继续探险。';
        } else if (selected.id === 'main') {
            status = selected.isCurrent ? '当前位于轮回者营地' : '轮回者营地 · 主神空间';
        } else status = this._worldStatus(selected.id, selected.isCurrent);
        const canObserve = !Strategy.active && selected.connected && !selected.isCurrent && !SceneManager.isLoading;
        const observeText = selected.isCurrent ? '当前视野' : selected.isHome ? '返回本体' : selected.connected ? '观察位面' : '传送门未接通';
        const support = !Strategy.active && !dungeonActive && !selected.isCurrent && selected.connected && invasions.some((war) => war.targetWorld === selected.id);
        const portalRepair = selected.endpointExists
            ? (WorldProgressionSystem.config.portal?.rebuildCost || {})
            : (WorldProgressionSystem.config.portal?.constructionCost || {});
        const hallRebuild = WorldProgressionSystem.config.playerBase?.rebuildCost || {};
        this._setSectionHtml('wmDetails', `
            <h2 class="wm-detail-title">${escapeHtml(this._firstFoundingSelection
                ? `${WorldProgressionSystem.getWorldTerrainLabel(selected.id)}建城模板` : this._worldName(selected.id))}</h2>
            ${selected.entryCell ? `<p class="wm-hint">${this._firstFoundingSelection ? '玩家所选地格'
                : selected.destroyed ? '旧入口地块' : selected.connected ? '接通地块' : '目标地块'}：${selected.entryCell.q}, ${selected.entryCell.r}</p>` : ''}
            <div class="ws-status">${status}</div>
            ${selected.specialEvent && selected.specialEvent.status !== 'completed' ? `
                <div class="ws-status is-warning"><strong>❓ 随机事件 · ${escapeHtml(selected.specialEvent.name)}</strong><br>
                进入该位面后，特色建筑会以中立状态生成；清理领主、精英与普通守军即可取得控制权，并解锁该位面的特色科技研究。</div>` : ''}
            ${this._baseMilitaryHtml(selected)}
            ${this._worldExpeditionHtml(selected)}
            ${this._firstFoundingSelection || celebration ? '' : `<div class="wm-actions">
                <button type="button" class="ws-go ${canObserve ? 'is-primary' : 'is-secondary'}${selected.isHome ? ' home' : ''}" data-world="${selected.id}" ${canObserve ? '' : 'disabled'}>${observeText}</button>
                ${support ? `<button type="button" class="ws-support" data-support-world="${selected.id}" ${SceneManager.isLoading ? 'disabled' : ''}>本体支援入侵</button>` : ''}
                ${selected.persistent && selected.destroyed && selected.hallAlive ? `<button type="button" class="ws-rebuild is-primary" data-repair-portal="${selected.id}">${selected.endpointExists ? '修复传送门' : '建造新传送门'} · ${portalRepair.gold || 0}金 + ${portalRepair.energy || 0}能</button>` : ''}
                ${selected.persistent && selected.connected && !selected.hallAlive ? `<button type="button" class="ws-rebuild is-primary" data-rebuild-hall="${selected.id}">重建市政厅 · ${hallRebuild.gold || 0}金 + ${hallRebuild.energy || 0}能</button>` : ''}
            </div>
            <p class="wm-hint">${selected.isHome ? '返回后恢复本体所在位置与正常操控。' : '观察只切换视野，不传送本体；本体支援会实际转移角色。'}</p>`}
            ${dungeonActive ? '<p class="wm-hint">地牢探险仍按原有隔离规则执行，暂不可本体支援。</p>' : ''}`);
        // 全网断线时仅允许修复仍有市政厅锚定的旧门遗迹；已崩塌位面必须走移民恢复。
        const emergencyRebuilds = current === 'main' && !Game._observerMode && !dungeonActive && WorldProgressionSystem.getTravelWorlds().length === 0
            ? WorldProgressionSystem.getConstructableWorlds().filter((entry) => entry.rebuild)
            : [];
        this._setSectionHtml('wmEmergency', emergencyRebuilds.length ? `
            <h3>传送网络应急修复</h3>
            <p class="wm-hint">仍有市政厅维持位面坐标，可在主神空间远程修复旧门遗迹。</p>
            ${emergencyRebuilds.map((entry) => `
                <button type="button" class="ws-rebuild is-primary" data-rebuild-world="${entry.sceneId}">
                    ${escapeHtml(entry.name || entry.sceneId)} · ${entry.cost.gold || 0} 金币 + ${entry.cost.energy || 0} 能源
                </button>`).join('')}` : '');
        this._map?.setState(states.map(({ id, connected, badge, entryCell, specialEvent }) => ({
            id, connected, badge, entryCell,
            specialEvent: specialEvent && specialEvent.status !== 'completed' ? {
                eventId: specialEvent.eventId,
                name: specialEvent.name,
                status: specialEvent.status,
            } : null,
        })), selected.id);
    },
};
