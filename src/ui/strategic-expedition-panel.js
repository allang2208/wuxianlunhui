import { BasePanel, closeBasePanels } from './panels/base-panel.js';
import { mountRightSidebarPanel } from './right-sidebar-panel-layer.js';
import { WorldStrategySystem as Strategy } from '../world/world-strategy-system.js';
import { WorldProgressionSystem as Progression } from '../world/world-progression-system.js';
import { getUnitKind, UNIT_KIND_CFG } from '../world/unit-upgrade-store.js';
import { getHamsterUnitIcon } from '../config/hamster-unit-icons.js';
import { Input } from './input.js';

const setText = (el, value) => { if (el.textContent !== String(value)) el.textContent = String(value); };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only a selection draft lives here. Strategy.depart remains the sole packing boundary.
export const StrategicExpeditionPanel = {
    open(camp, { onReturn = null } = {}) {
        if (this._departing) return false;
        if (this._panel?.isOpen) return true;
        const blocked = Strategy.departureBlockReason(camp);
        if (blocked) { Strategy.notify(blocked); return false; }
        this._previousFocus = document.activeElement;
        this._camp = camp;
        this._originSceneId = window.SceneManager.currentScene;
        this._onReturn = onReturn;
        this._selected = new Set();
        this._filter = 'all'; this._query = ''; this._message = ''; this._tone = '';
        closeBasePanels('buildingDetail');
        window.Game?.BuildingSystem?.close?.();
        this._ensurePanel();
        this._panel.open();
        return true;
    },

    _ensurePanel() {
        if (this._panel) return;
        this._panel = new BasePanel({
            id: 'strategicExpeditionPanel', className: 'strategic-expedition-panel',
            stateKey: 'strategicExpedition', panelGroup: 'rightSidebar', closeOnEscape: true,
            mountElement: (el) => mountRightSidebarPanel(el, 'modal', { bringToFront: true }),
        });
        this._rows = new Map();
        this._panel.buildContent = (el) => this._build(el);
        this._panel.onOpen = () => {
            this._clearInput();
            this._panel.el.setAttribute('aria-hidden', 'false');
            this._panel.el.querySelector('[data-search]').value = this._query;
            this.refresh();
            this._timer = setInterval(() => this.refresh(), 1000);
            this._panel.el.querySelector('[data-search]').focus({ preventScroll: true });
        };
        this._panel.onClose = () => {
            clearInterval(this._timer); this._timer = null;
            this._panel.el.setAttribute('aria-hidden', 'true');
            this._clearInput();
            this._rows.clear(); this._entries = [];
            this._panel.el.querySelector('[data-roster]').replaceChildren();
            if (this._departing) return;
            const canReturn = window.SceneManager?.currentScene === this._originSceneId
                && !Strategy.departureBlockReason(this._camp);
            if (canReturn && this._onReturn) {
                this._onReturn();
                document.getElementById('pbStrategicExpedition')?.focus({ preventScroll: true });
            } else if (canReturn && this._previousFocus?.isConnected) {
                this._previousFocus.focus({ preventScroll: true });
            }
            this._selected.clear(); this._camp = null; this._onReturn = null;
        };
    },

    _build(el) {
        el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'strategyPrepTitle');
        el.setAttribute('aria-describedby', 'strategyPrepSubtitle');
        el.innerHTML = `
            <div class="sx-shell">
                <header class="bp-panel-header sx-header">
                    <div><div class="sx-kicker">战略指挥 / EXPEDITION</div><h2 class="sx-title" id="strategyPrepTitle">位面出征</h2><p class="sx-subtitle" id="strategyPrepSubtitle" data-origin-title></p></div>
                    <button type="button" class="bp-panel-close" data-close aria-label="取消出征准备">×</button>
                </header>
                <ol class="sx-flow" aria-label="战略行动流程">
                    <li aria-current="step"><b>01</b><span>编组出征</span></li><li><b>02</b><span>接敌战斗</span></li><li><b>03</b><span>摧毁目标</span></li><li><b>04</b><span>撤军回归</span></li>
                </ol>
                <div class="sx-metrics">
                    <div><span>出征士兵 / 上限</span><b data-troop-count></b></div><div><span>本位面留守士兵</span><b data-stay-count></b></div><div><span>随行 / 在场队友</span><b data-companion-count></b></div><div><span>亲征军团</span><b>1 支</b></div>
                </div>
                <main class="sx-main">
                    <section class="sx-roster" aria-labelledby="strategyRosterTitle">
                        <div class="sx-section-heading"><h3 id="strategyRosterTitle">本位面部队</h3><small data-roster-count></small></div>
                        <div class="sx-toolbar"><div class="sx-filters" role="group" aria-label="筛选部队">
                            <button type="button" class="bp-button" data-filter="all" aria-pressed="true">全部</button><button type="button" class="bp-button" data-filter="troop" aria-pressed="false">士兵</button><button type="button" class="bp-button" data-filter="companion" aria-pressed="false">队友</button>
                        </div><label class="sx-search"><span>查找单位</span><input type="search" data-search placeholder="查找名称 / 兵种" autocomplete="off"></label><button type="button" class="bp-button sx-secondary" data-refresh title="保留有效选择并更新名册">刷新名册</button></div>
                        <div class="sx-roster-actions"><button type="button" class="bp-button sx-secondary" data-add-visible>编入当前列表</button><button type="button" class="bp-button sx-quiet" data-clear>清空编组</button><small data-selection-hint>点击单位：编入 / 留守</small></div>
                        <div class="sx-unit-list" data-roster tabindex="0" role="group" aria-label="可选部队；点击卡片编入或留守"></div>
                        <p class="sx-empty" data-empty hidden></p>
                    </section>
                    <aside class="sx-brief" aria-label="远征编制与行动说明" tabindex="0">
                        <section class="sx-origin"><div class="sx-origin-heading"><img data-camp-image alt="" hidden><div><strong data-camp-name></strong><small data-origin-name></small></div></div>
                            <dl class="sx-facts"><dt>出发信标</dt><dd data-origin-cell></dd><dt>返营方式</dt><dd>返回信标，撤军入营</dd><dt>出征消耗</dt><dd>不消耗地牢钥匙</dd></dl>
                            <p class="sx-travel-note">世界时间与其他模式一致。基础半天走一格，地形修正行军耗时。</p>
                        </section>
                        <section class="sx-manifest"><h3>本次远征编制</h3><div class="sx-leader"><strong>玩家 · 亲征领队</strong><small>亲征时随军；分遣军不携玩家或队友</small></div><ul class="sx-selected-groups" data-selected-groups aria-label="已选兵种与队友"></ul><p class="sx-empty" data-selection-empty>尚未编入士兵或队友，可在左侧选择；也可由玩家单独亲征。</p></section>
                        <details class="sx-rules"><summary>行动须知 <span>出征 / 战损 / 回归</span></summary><ul><li>确认后进入大地图选择目标；未选单位留守，取消不会移走部队。</li><li>名册每秒更新，失效单位移出编组；世界时间继续流逝。</li><li>遭遇战沿用真实战损；攻城胜利后只进行摧毁结算。</li><li>幸存部队返回；外派军事人口仍由原兵营占用，返营不复制士兵。</li></ul></details>
                    </aside>
                </main>
                <footer class="sx-footer"><div class="sx-feedback"><p data-summary></p><p id="strategyPrepFeedback" data-feedback role="status" aria-live="polite"></p></div><div class="sx-footer-actions"><button type="button" class="bp-button sx-secondary" data-close>取消并返回</button><button type="button" class="bp-button sx-primary" data-depart aria-describedby="strategyPrepFeedback">玩家亲征</button></div></footer>
            </div>`;
        el.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => this._panel.close(); });
        el.querySelector('[data-search]').oninput = (event) => { this._query = event.target.value; this._renderRoster(); this._renderSummary(); };
        el.querySelectorAll('[data-filter]').forEach((button) => {
            button.onclick = () => { this._filter = button.dataset.filter; this._renderRoster(); this._renderSummary(); };
        });
        el.querySelector('[data-add-visible]').onclick = () => this._addVisible();
        el.querySelector('[data-clear]').onclick = () => { this._selected.clear(); this._message = ''; this._tone = ''; this._renderRoster(); this._renderSummary(); };
        el.querySelector('[data-refresh]').onclick = () => { this._message = '名册已刷新，仍然有效的选择已保留。'; this._tone = ''; this.refresh(); };
        el.querySelector('[data-roster]').onclick = (event) => {
            const button = event.target.closest('[data-unit-key]');
            if (!button || button.disabled) return;
            const key = button.dataset.unitKey;
            if (this._selected.has(key)) this._selected.delete(key); else this._selected.add(key);
            this._message = ''; this._tone = ''; this._renderRoster(); this._renderSummary();
        };
        el.querySelector('[data-depart]').onclick = () => this._depart();
        const detach = document.createElement('button');
        detach.type = 'button'; detach.className = 'bp-button sx-secondary'; detach.dataset.detach = '';
        detach.textContent = '派出分遣军'; detach.setAttribute('aria-describedby', 'strategyPrepFeedback');
        detach.onclick = () => this._depart(true);
        el.querySelector('[data-depart]').before(detach);
        el.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab') return;
            const controls = Array.from(el.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')).filter((control) => control.getClientRects().length && !control.closest('[hidden]'));
            if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
            else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        });
    },

    _clearInput() {
        Input.keys.clear(); Input.mouse.leftDown = Input.mouse.rightDown = false;
        Input.mouse.leftPressed = Input.mouse.rightPressed = false;
        window.Game?.player?._rtsController?.hold?.();
    },

    refresh() {
        if (!this._panel.isOpen || this._departing) return 0;
        const { troops, companions } = Strategy.candidates();
        this._entries = [['troop', troops], ['companion', companions]].flatMap(([kind, units]) => units.map((unit) => {
            const unitKind = getUnitKind(unit);
            return { key: `${kind}:${unit.id}`, kind, unit, unitKind,
                name: unit.name || unit.data?.name || UNIT_KIND_CFG[unitKind]?.name || (kind === 'troop' ? '军事单位' : '队友'),
                icon: kind === 'troop' ? getHamsterUnitIcon(unitKind) : '' };
        }));
        const available = new Set(this._entries.map((entry) => entry.key));
        let removed = 0;
        for (const key of this._selected) if (!available.has(key)) { this._selected.delete(key); removed++; }
        for (const [key] of this._rows) if (!available.has(key)) this._rows.delete(key);
        if (removed) {
            const removedMessage = `${removed} 个已选单位已离场或无法出征，已移出编组。请确认剩余兵力。`;
            if (this._tone === 'danger') this._message += ` ${removedMessage}`;
            else { this._message = removedMessage; this._tone = 'warning'; }
        }
        this._renderOrigin(); this._renderRoster(); this._renderSummary();
        return removed;
    },

    _renderOrigin() {
        const el = this._panel.el, camp = this._camp, tier = camp.getBuildingVisualTier?.();
        const campName = tier?.name || camp.name || camp._cfg?.name || '指挥所';
        const worldName = Progression.getWorldConfig(this._originSceneId)?.name || this._originSceneId;
        const entry = Progression.getWorldMapDiscovery(this._originSceneId);
        setText(el.querySelector('[data-origin-title]'), `${worldName} · ${campName} / 选择本次随军部队`);
        setText(el.querySelector('[data-camp-name]'), campName); setText(el.querySelector('[data-origin-name]'), worldName);
        setText(el.querySelector('[data-origin-cell]'), entry?.cell ? `${entry.cell.q}, ${entry.cell.r}` : '暂无有效出发信标');
        const image = el.querySelector('[data-camp-image]'), src = tier?.visual?.thumbnailPath || camp._cfg?.thumbnailPath;
        if (src && image.getAttribute('src') !== src) { image.hidden = false; image.onerror = () => { image.hidden = true; }; image.src = src; }
    },

    _visibleEntries() {
        const query = this._query.trim().toLocaleLowerCase();
        return this._entries.filter((entry) => (this._filter === 'all' || entry.kind === this._filter)
            && (!query || `${entry.name} ${UNIT_KIND_CFG[entry.unitKind]?.name || ''} ${entry.unit.title || ''}`.toLocaleLowerCase().includes(query)));
    },

    _renderRoster() {
        const el = this._panel.el, list = el.querySelector('[data-roster]'), visible = this._visibleEntries();
        const troopCount = this._entries.filter((entry) => entry.kind === 'troop' && this._selected.has(entry.key)).length;
        el.querySelectorAll('[data-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === this._filter)));
        const availableTroops = this._entries.filter((entry) => entry.kind === 'troop').length;
        setText(el.querySelector('[data-roster-count]'), `本位面 ${availableTroops} 名士兵 · ${this._entries.length - availableTroops} 名队友 · 当前显示 ${visible.length}`);
        const previousFocus = document.activeElement;
        let cursor = list.firstElementChild;
        for (const entry of visible) {
            let row = this._rows.get(entry.key);
            if (!row) {
                row = document.createElement('button'); row.type = 'button'; row.className = 'sx-unit'; row.dataset.unitKey = entry.key;
                row.innerHTML = '<span class="sx-unit-icon"><img alt="" hidden><span></span></span><span class="sx-unit-copy"><strong></strong><small></small><span class="sx-health-text"></span><span class="sx-health-track" aria-hidden="true"><span></span></span></span><span class="sx-unit-state"></span>';
                const image = row.querySelector('img'), fallback = row.querySelector('.sx-unit-icon > span');
                setText(fallback, entry.kind === 'troop' ? '士兵' : '队友');
                if (entry.icon) { image.hidden = false; fallback.hidden = true; image.onerror = () => { image.hidden = true; fallback.hidden = false; }; image.src = entry.icon; }
                this._rows.set(entry.key, row);
            }
            const selected = this._selected.has(entry.key), hp = Math.max(0, Number(entry.unit.data?.hp) || 0);
            const maxHp = Math.max(1, Number(entry.unit.data?.maxHp || entry.unit.maxHp) || 1), ratio = Math.min(1, hp / maxHp);
            const full = !selected && entry.kind === 'troop' && troopCount >= Strategy.config.maxTroops;
            row.disabled = full;
            row.title = full ? '士兵编制已满，请先移出其他士兵' : selected ? '点击取消随军，留在本位面' : '点击编入本次远征';
            row.setAttribute('aria-pressed', String(selected));
            row.setAttribute('aria-label', `${entry.name}，生命 ${Math.ceil(hp)}/${Math.ceil(maxHp)}，${selected ? '已编入，点击留守' : full ? '编制已满' : '留守，点击编入'}`);
            row.classList.toggle('is-wounded', ratio < 0.35);
            setText(row.querySelector('strong'), entry.name);
            setText(row.querySelector('small'), `${entry.kind === 'troop' ? '士兵' : '队友'} · ${entry.unit.title || `编号 ${String(entry.unit.id).slice(-6)}`}`);
            setText(row.querySelector('.sx-health-text'), `生命 ${Math.ceil(hp)} / ${Math.ceil(maxHp)}${ratio < 0.35 ? ' · 重伤' : ''}`);
            row.querySelector('.sx-health-track > span').style.width = `${ratio * 100}%`;
            setText(row.querySelector('.sx-unit-state'), selected ? '已编入' : '留守');
            // Keep unchanged rows in place: live refresh must not reset focus or scrolling.
            if (row === cursor) cursor = cursor.nextElementSibling; else list.insertBefore(row, cursor);
        }
        while (cursor) { const next = cursor.nextElementSibling; cursor.remove(); cursor = next; }
        if (previousFocus?.classList.contains('sx-unit') && !previousFocus.isConnected) el.querySelector('[data-search]').focus({ preventScroll: true });
        const empty = el.querySelector('[data-empty]'); empty.hidden = visible.length > 0;
        setText(empty, this._entries.length ? '没有符合筛选的单位。可切换分类或清空查找条件。' : '本位面暂无可选士兵或队友。可返回募兵，也可由玩家单独亲征。');
    },

    _renderSummary() {
        const el = this._panel.el, selected = this._entries.filter((entry) => this._selected.has(entry.key));
        const troops = selected.filter((entry) => entry.kind === 'troop').length, companions = selected.length - troops;
        const availableTroops = this._entries.filter((entry) => entry.kind === 'troop').length, stay = availableTroops - troops;
        const blocked = Strategy.departureBlockReason(this._camp);
        setText(el.querySelector('[data-troop-count]'), `${troops} / ${Strategy.config.maxTroops}`);
        setText(el.querySelector('[data-stay-count]'), stay);
        setText(el.querySelector('[data-companion-count]'), `${companions} / ${this._entries.length - availableTroops}`);
        setText(el.querySelector('[data-summary]'), `亲征携粮 ${Strategy.supplyQuote(1 + troops + companions)}；分遣军携粮 ${Strategy.supplyQuote(troops)} · 均为 ${Strategy.config.supply.initialDays} 天口粮，从本基地扣除。分遣军 ${Strategy.state.detachments.length}/${Strategy.config.playerArmies.maxDetachments}`);
        const feedback = el.querySelector('[data-feedback]');
        const caution = availableTroops > 0 && stay === 0 ? '当前可选士兵全部随军，请留意出发位面的防守。'
            : !selected.length ? '当前为玩家单独亲征；确认后进入大地图，不会直接传送到敌方城镇。' : '确认前不会移动部队。出征后在大地图选择行军、摧毁或返营目标。';
        setText(feedback, blocked || this._message || caution);
        feedback.dataset.tone = blocked ? 'danger' : this._message ? this._tone : stay === 0 && availableTroops > 0 ? 'warning' : '';
        el.querySelector('[data-depart]').disabled = !!blocked || troops > Strategy.config.maxTroops || !!this._departing;
        el.querySelector('[data-depart]').title = blocked || '确认编组并进入大地图；之后再选择行军目标';
        el.querySelector('[data-detach]').disabled = !!blocked || !troops || troops > Strategy.config.maxTroops || !!companions
            || Strategy.state.detachments.length >= Strategy.config.playerArmies.maxDetachments || !!this._departing;
        el.querySelector('[data-detach]').title = companions ? '分遣军仅携士兵，请取消队友选择' : '玩家留在基地，选中士兵组成独立军团';
        el.querySelector('[data-clear]').disabled = !selected.length;
        el.querySelector('[data-add-visible]').disabled = !this._visibleEntries().some((entry) => !this._selected.has(entry.key) && (entry.kind === 'companion' || troops < Strategy.config.maxTroops));
        setText(el.querySelector('[data-selection-hint]'), troops >= Strategy.config.maxTroops
            ? '士兵编制已满，先取消已选士兵才能替换' : `已选 ${selected.length} 个单位 · 点击卡片编入 / 留守`);
        const groups = new Map();
        for (const entry of selected) { const name = `${entry.kind === 'companion' ? '队友 · ' : ''}${entry.name}`; groups.set(name, (groups.get(name) || 0) + 1); }
        const markup = Array.from(groups, ([name, count]) => `<li><span>${escapeHtml(name)}</span><b>×${count}</b></li>`).join('');
        const groupList = el.querySelector('[data-selected-groups]'); if (groupList.innerHTML !== markup) groupList.innerHTML = markup;
        el.querySelector('[data-selection-empty]').hidden = selected.length > 0;
    },

    _addVisible() {
        let troops = this._entries.filter((entry) => entry.kind === 'troop' && this._selected.has(entry.key)).length, skipped = 0;
        for (const entry of this._visibleEntries()) {
            if (this._selected.has(entry.key)) continue;
            if (entry.kind === 'troop' && troops >= Strategy.config.maxTroops) { skipped++; continue; }
            this._selected.add(entry.key); if (entry.kind === 'troop') troops++;
        }
        this._message = skipped ? `已编入可用名额，另有 ${skipped} 名士兵因编制上限保持留守。` : ''; this._tone = skipped ? 'warning' : '';
        this._renderRoster(); this._renderSummary();
    },

    async _depart(detached = false) {
        if (this._departing) return;
        // Never silently dispatch a smaller army when a choice expires at confirmation time.
        if (this.refresh() > 0 || this._panel.el.querySelector(detached ? '[data-detach]' : '[data-depart]').disabled) return;
        const selected = this._entries.filter((entry) => this._selected.has(entry.key));
        const ids = (kind) => selected.filter((entry) => entry.kind === kind).map((entry) => entry.unit.id);
        this._departing = true;
        this._panel.close(); // The existing scene loader owns the transition; no second submit is exposed.
        try {
            const result = detached ? Strategy.dispatchDetachment(this._camp, ids('troop')) : await Strategy.depart(this._camp, ids('troop'), ids('companion'));
            if (result.ok) {
                if (detached) {
                    await Strategy.openMap();
                    const { WorldSwitchPanel } = await import('./world-switch-panel.js');
                    try { WorldSwitchPanel._selectArmy(result.id, true); }
                    catch (error) { Strategy.notify(`分遣军已出发，地图定位未完成：${error.message}`); }
                }
                this._selected.clear(); this._camp = null; this._onReturn = null; return;
            }
            this._message = result.reason || '出征未完成，请确认编组后重试。';
        } catch (error) { this._message = `出征未完成：${error.message || '请检查当前状态后重试'}`; }
        finally { this._departing = false; }
        this._tone = 'danger';
        if (window.SceneManager?.currentScene === this._originSceneId && !Strategy.active) this._panel.open();
        else Strategy.notify(this._message);
    },
};
