// 已选 v9 探索台。只消费地图运行态；可达、进入、奖励与撤离仍由原系统持有。
import { PartySystem } from '../systems/party-system.js';
import { RecruitUI } from './recruit-ui.js';
import { CompanionPanel } from './companion-panel.js';

export class DungeonExplorationConsole {
    constructor(system, { invasion, describeNode, grade, isCurrentScene }) {
        this.system = system;
        this.invasion = invasion;
        this.describeNode = describeNode;
        this.isCurrentScene = isCurrentScene;
        this.nodeButtons = new Map();
        this.selectedId = null;
        this.currentId = null;
        this.root = document.createElement('section');
        this.root.id = 'dungeonRouteTopHud';
        this.root.className = 'dungeon-exploration-console';
        this.root.dataset.routeTopUiVersion = 'cold-steel-exploration-v9';
        this.root.setAttribute('aria-label', '地牢探索规划');
        this.root.innerHTML = `
            <div class="dxc-resize" tabindex="0" role="separator" aria-orientation="horizontal" aria-label="背景与指挥台分界：上下拖动或按方向键调整" title="上下拖动调整背景高度 · 方向键微调 · 双击还原"><span></span></div>
            <header class="dxc-heading">
                <h1>探索规划</h1><span class="dxc-dungeon-name"></span>
                <div class="dxc-progress"><span id="dungeonRouteHeaderProgress"></span><progress aria-label="探索进度"></progress></div>
                <div id="dungeonRouteTopIntel"><div id="dungeonRouteInfoStack"><span class="dxc-invasion-idle"></span></div></div>
            </header>
            <aside class="dxc-party" aria-label="探索队伍">
                <header><h2>探索队伍</h2><span class="dxc-party-count"></span></header>
                <div class="dxc-party-cards"></div>
                <p class="dxc-party-hint" title="装备与背包从右侧管理队员进入">点击选择 · Shift 多选</p>
            </aside>
            <div class="dxc-planning">
                <section class="dxc-route" aria-label="探索路线">
                    <nav class="dxc-toolbar" aria-label="路线视图">
                        <div class="dxc-view-actions" role="group" aria-label="查看路线">
                            <h2 class="dxc-sector-label">路线选择</h2>
                            <button type="button" class="bp-button bp-button--muted" data-action="overview">完整路线</button>
                            <button type="button" class="bp-button bp-button--muted" data-action="focus" title="恢复可读视角，查看当前位置及相邻可前往房间">当前位置</button>
                        </div>
                        <label class="dxc-next-node"><span class="dxc-available-count"></span><select class="dxc-destinations" aria-label="选择相邻可前往节点"></select></label>
                    </nav>
                    <div class="dxc-map" tabindex="0" role="group" aria-label="房间路线，可拖动或用方向键平移" aria-describedby="dxcMapHint">
                        <canvas aria-hidden="true"></canvas><div class="dxc-nodes"></div>
                    </div>
                    <nav class="dxc-route-footer" aria-label="连续路线缩放">
                        <span class="dxc-map-hint" id="dxcMapHint" role="status" aria-live="polite">单击房间查看档案 · 拖动或滚轮平移</span>
                        <div class="dxc-zoom-controls" role="group" aria-label="路线缩放" title="滚轮平移 · Shift＋滚轮横移 · Ctrl＋滚轮缩放">
                            <button type="button" class="bp-button bp-button--muted" data-action="out" aria-label="缩小路线">缩小</button>
                            <span class="dxc-zoom-value" aria-label="当前缩放比例"></span>
                            <button type="button" class="bp-button bp-button--muted" data-action="in" aria-label="放大路线">放大</button>
                        </div>
                    </nav>
                </section>
                <aside class="dxc-dossier" aria-label="节点档案">
                    <h2>节点档案</h2>
                    <div class="dxc-node-heading"><img class="dxc-dossier-icon" alt=""><div><h3></h3><span class="dxc-node-state"></span></div></div>
                    <p class="dxc-clue"></p>
                    <dl><div><dt>风险</dt><dd class="dxc-risk"></dd></div><div><dt>收益</dt><dd class="dxc-reward"></dd></div></dl>
                    <p class="dxc-dossier-note"></p>
                </aside>
            </div>
            <section class="dxc-rewards" aria-label="预期收益"><header><h2>预期收益</h2><span class="dxc-reward-summary">地牢规则预览 · 非已获得</span><button type="button" class="bp-button bp-button--muted" data-action="rewards" aria-expanded="false" aria-controls="dxcRewardDetails">展开详情</button></header><div class="dxc-reward-host" id="dxcRewardDetails" hidden></div></section>
            <footer id="dungeonRouteTopActions" class="dxc-actions" aria-label="房间与撤离操作">
                <div class="dxc-enter-group"><button id="dungeonRouteEnter" type="button" class="bp-button dxc-enter" aria-describedby="dxcEnterHint" disabled><strong class="dxc-enter-label">选择一个房间</strong><span class="dxc-enter-hint" id="dxcEnterHint" aria-live="polite"></span></button></div>
            </footer>`;
        this.$ = selector => this.root.querySelector(selector);
        this.$('.dxc-dungeon-name').textContent = `${system.dungeonName} · ${grade}级`;
        this.map = this.$('.dxc-map');
        this.map.title = '拖动或滚轮平移 · Shift＋滚轮横移 · Ctrl＋滚轮缩放 · 方向键平移';
        this.canvas = this.map.querySelector('canvas');
        this.nodeLayer = this.$('.dxc-nodes');
        this.rewardHost = this.$('.dxc-reward-host');
        this.infoStack = this.$('#dungeonRouteInfoStack');
        this.partyCards = [];
        // 背景和台面共用上下两行；不再靠底层Canvas的缓存高度拼接。
        this.stage = document.createElement('div');
        this.stage.className = 'dxc-stage';
        const background = document.createElement('img');
        background.className = 'dxc-background';
        background.alt = '';
        background.setAttribute('aria-hidden', 'true');
        background.draggable = false;
        background.src = system._getMapBackgroundPath();
        this.stage.append(background, this.root);
        document.body.appendChild(this.stage);
        document.body.classList.add('dungeon-exploration-mode');
        this.refreshParty();
        this.unsubscribeParty = PartySystem.onChange(() => this.refreshParty());
        const theme = getComputedStyle(this.root);
        this.colors = {
            ink: theme.getPropertyValue('--dxc-ink').trim(),
            line: theme.getPropertyValue('--dxc-line').trim(),
            cyan: theme.getPropertyValue('--dxc-cyan').trim(),
            blue: theme.getPropertyValue('--dxc-blue').trim(),
            visited: theme.getPropertyValue('--bp-ui-accent').trim(),
            backdropTop: theme.getPropertyValue('--bp-ui-charcoal').trim(),
            backdropBottom: theme.getPropertyValue('--bp-ui-black').trim(),
        };
        this.root.addEventListener('click', event => {
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (!action || !this.canInteract()) return;
            if (action === 'overview') system._fitRouteMap();
            else if (action === 'focus') system._focusOnCurrentNode({ restoreDefaultZoom: true });
            else if (action === 'in' || action === 'out') this.zoom(action === 'in' ? 1.15 : 1 / 1.15);
            else if (action === 'rewards') {
                this.rewardHost.hidden = !this.rewardHost.hidden;
                this.$('[data-action="rewards"]').setAttribute('aria-expanded', String(!this.rewardHost.hidden));
                this.$('[data-action="rewards"]').textContent = this.rewardHost.hidden ? '展开详情' : '收起详情';
            }
        });
        this.$('.dxc-destinations').addEventListener('change', event => {
            if (!this.canInteract()) return;
            const node = system.nodes.find(candidate => String(candidate.id) === event.target.value);
            if (node && system.isNodeClickable(node)) this.select(node, true);
        });
        this.$('#dungeonRouteEnter').addEventListener('click', () => {
            const node = system.nodes.find(candidate => candidate.id === this.selectedId);
            // 每次点击都重查真实邻接关系，不能使用创建按钮时的可走快照。
            if (this.canInteract() && node && system.isNodeClickable(node)) system._enterNode(node);
        });
        // 操作规划台不穿透到角色攻击、RTS 或全局空格/方向键控制。
        for (const type of ['pointerdown', 'mousedown', 'click']) {
            this.root.addEventListener(type, event => event.stopPropagation());
        }
        this.root.addEventListener('keydown', event => {
            if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) event.stopPropagation();
        });
        this.bindMapInput();
        this.bindResizeInput();
        this.bindSideMenu();
        this.resizeObserver = new ResizeObserver(() => {
            if (!this.root.isConnected || this.root.style.display === 'none') return;
            const oldView = this.view;
            const centerX = oldView ? (oldView.left + oldView.width / 2 - system.mapOffsetX) / system.mapScale : 0;
            const centerY = oldView ? (oldView.top + oldView.height / 2 - system.mapOffsetY) / system.mapScale : 0;
            this.measure();
            if (this.map.clientWidth <= 0 || this.map.clientHeight <= 0) return;
            // 尺寸变化只维持观察中心并钳制边界；不触发重新缩放或回到角色当前位置。
            if (oldView) {
                system.mapOffsetX = this.view.left + this.view.width / 2 - centerX * system.mapScale;
                system.mapOffsetY = this.view.top + this.view.height / 2 - centerY * system.mapScale;
            }
            system._clampMapOffset();
        });
        this.resizeObserver.observe(this.map);
        this.resizeObserver.observe(this.root);
        this.onScroll = () => { this.measure(); this.drawKey = null; };
        this.root.addEventListener('scroll', this.onScroll, true);
        this.measure();
    }

    canInteract({ allowMenu = false } = {}) {
        const system = this.system;
        return system.active && system.state === 'map' && !system._observerSuspended && this.isCurrentScene()
            && this.root.isConnected && this.root.style.display !== 'none'
            && !RecruitUI.isOpen && (allowMenu || !this.menuOpen)
            && !document.getElementById('dungeonExitConfirm') && !document.getElementById('dungeonVictoryOverlay');
    }

    setVisible(visible) {
        this.setMenuOpen(false);
        this.stage.hidden = !visible;
        this.root.style.display = visible ? 'grid' : 'none';
        document.body.classList.toggle('dungeon-exploration-mode', visible);
        if (visible) { this.measure(); this.refreshParty(); }
        else { this.endDrag(); this.endResize(); }
    }

    bindSideMenu() {
        // 鼠标靠右展开正常模式原栏目；不增加入口按钮、感应遮罩或另一套栏目布局。
        this.sideMenu = document.querySelector('.side-menu');
        if (!this.sideMenu) return;
        this.menuItemAttributes = new Map([...this.sideMenu.querySelectorAll('.side-menu-btn')].map(item =>
            [item, ['tabindex', 'role', 'aria-label'].map(name => [name, item.getAttribute(name)])]));
        this.onMenuPointerMove = event => {
            if (event.pointerType !== 'mouse') return;
            if (!this.canInteract({ allowMenu: true }) || this.sideMenu.classList.contains('hidden')) {
                if (this.menuOpen) this.setMenuOpen(false);
                return;
            }
            // 拖动路线或分界线经过屏幕边缘时，不突然弹出栏目打断操作。
            if (event.buttons !== 0 || this.drag || this.resizeDrag) return;
            const nearEdge = event.clientX >= window.innerWidth - 16;
            const rect = this.menuOpen ? this.sideMenu.getBoundingClientRect() : null;
            // 保留右侧间隙及底部栏目文字的悬停空间，跨按钮间隔不会收起。
            const overMenu = rect && event.clientX >= rect.left - 12
                && event.clientY >= rect.top - 12 && event.clientY <= rect.bottom + 24;
            if (nearEdge || overMenu) {
                clearTimeout(this.menuCloseTimer);
                this.menuCloseTimer = null;
                if (!this.menuOpen) this.setMenuOpen(true);
            } else if (this.menuOpen && this.menuCloseTimer == null) {
                this.menuCloseTimer = setTimeout(() => this.setMenuOpen(false), 180);
            }
        };
        this.onMenuPointerLeave = () => this.setMenuOpen(false);
        this.onMenuClick = event => {
            if (!this.menuOpen || !event.target.closest('.side-menu-btn')) return;
            // 按钮自己的原处理先执行，再收起栏目，不抢走新面板焦点。
            this.setMenuOpen(false);
            event.stopPropagation();
        };
        this.onMenuOutsidePointer = event => {
            if (this.menuOpen && !this.sideMenu.contains(event.target)) this.setMenuOpen(false);
        };
        this.onMenuKeyDown = event => {
            if (!this.menuOpen) return;
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation();
                this.setMenuOpen(false, true);
            } else if (event.key === 'Tab') {
                // 只有焦点已进入栏目时才接管Tab；单纯鼠标悬停仍沿用正常模式背包快捷键。
                if (this.sideMenu.contains(event.target)) event.stopPropagation();
                else this.setMenuOpen(false);
            } else if (['CapsLock', 'KeyK', 'KeyU', 'KeyL', 'KeyO', 'KeyP', 'KeyY'].includes(event.code)) {
                this.setMenuOpen(false); // 继续交给原快捷键处理器打开对应栏目。
            } else if (this.sideMenu.contains(event.target) && ['Enter', ' '].includes(event.key)) {
                const item = event.target.closest('.side-menu-btn');
                if (item) { event.preventDefault(); event.stopPropagation(); item.click(); }
            }
        };
        this.onMenuElectronEscape = event => {
            if (!this.menuOpen) return;
            event.stopImmediatePropagation();
            this.setMenuOpen(false, true);
        };
        window.addEventListener('electron-esc', this.onMenuElectronEscape, true);
        window.addEventListener('blur', this.onMenuPointerLeave);
        document.documentElement.addEventListener('pointerleave', this.onMenuPointerLeave);
        this.sideMenu.addEventListener('click', this.onMenuClick);
        document.addEventListener('pointermove', this.onMenuPointerMove, { capture: true, passive: true });
        document.addEventListener('pointerdown', this.onMenuOutsidePointer, true);
        document.addEventListener('keydown', this.onMenuKeyDown, true);
        this.setMenuOpen(false);
    }

    setMenuOpen(open, restoreFocus = false) {
        clearTimeout(this.menuCloseTimer);
        this.menuCloseTimer = null;
        const wasOpen = this.menuOpen;
        const menuHadFocus = this.sideMenu?.contains(document.activeElement);
        if (open && !wasOpen) {
            this.menuPreviousFocus = document.activeElement !== document.body ? document.activeElement : null;
        }
        this.menuOpen = !!open;
        document.body.classList.toggle('dxc-menu-open', this.menuOpen);
        if (!this.menuItemAttributes) return;
        for (const [item, attributes] of this.menuItemAttributes) {
            if (open) {
                item.tabIndex = 0;
                item.setAttribute('role', 'button');
                item.setAttribute('aria-label', item.title);
            } else {
                for (const [name, value] of attributes) {
                    if (value === null) item.removeAttribute(name);
                    else item.setAttribute(name, value);
                }
            }
        }
        // 悬停展开不抢焦点；只有焦点仍在被收起的栏目中或按Esc时才恢复。
        if (!open && wasOpen && (restoreFocus || menuHadFocus) && this.canInteract()) {
            const target = this.menuPreviousFocus?.isConnected ? this.menuPreviousFocus : this.map;
            target.focus({ preventScroll: true });
        }
        if (!open) this.menuPreviousFocus = null;
    }

    measure() {
        this.bannerBottom = Math.max(0, this.root.getBoundingClientRect().top);
        const limits = this.bannerLimits();
        const separator = this.$('.dxc-resize');
        separator.setAttribute('aria-valuemin', String(Math.round(limits.min)));
        separator.setAttribute('aria-valuemax', String(Math.round(limits.max)));
        separator.setAttribute('aria-valuenow', String(Math.round(this.bannerBottom)));
        separator.setAttribute('aria-valuetext', `背景高度 ${Math.round(this.bannerBottom)} 像素`);
        // 与Canvas/节点实际铺满的内层同源，不把外框或外侧留白算进路线坐标。
        const rect = this.nodeLayer.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        if (this.view) {
            // 尺寸变化保持窗口中心所对应的地图点；仅滚动时跟随窗口位移。
            this.system.mapOffsetX += rect.left - this.view.left + (rect.width - this.view.width) / 2;
            this.system.mapOffsetY += rect.top - this.view.top + (rect.height - this.view.height) / 2;
        }
        this.view = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w; this.canvas.height = h;
        }
        this.dpr = dpr;
        this.drawKey = null;
    }

    bannerLimits() {
        const height = window.innerHeight;
        const min = Math.min(144, height * 0.28);
        return { min, max: Math.max(min, Math.min(height * 0.60, height - 360)) };
    }

    bindResizeInput() {
        const handle = this.$('.dxc-resize');
        const resize = height => {
            const { min, max } = this.bannerLimits();
            this.stage.style.setProperty('--dxc-banner-height', `${Math.max(min, Math.min(max, height)) / window.innerHeight * 100}vh`);
        };
        handle.addEventListener('pointerdown', event => {
            if (!this.canInteract() || event.button !== 0) return;
            event.preventDefault();
            this.resizeDrag = { id: event.pointerId, y: event.clientY, top: this.root.getBoundingClientRect().top };
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener('pointermove', event => {
            if (!this.resizeDrag || this.resizeDrag.id !== event.pointerId) return;
            if (!this.canInteract() || (event.buttons & 1) === 0) { this.endResize(); return; }
            resize(this.resizeDrag.top + event.clientY - this.resizeDrag.y);
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, () => this.endResize());
        handle.addEventListener('dblclick', () => {
            if (this.canInteract()) this.stage.style.removeProperty('--dxc-banner-height');
        });
        handle.addEventListener('keydown', event => {
            if (!this.canInteract() || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const { min, max } = this.bannerLimits();
            resize(event.key === 'Home' ? min : event.key === 'End' ? max
                : this.root.getBoundingClientRect().top + (event.key === 'ArrowUp' ? -12 : 12));
        });
    }

    endResize() {
        if (!this.resizeDrag) return;
        const { id } = this.resizeDrag;
        this.resizeDrag = null;
        const handle = this.$('.dxc-resize');
        if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    }

    refreshParty() {
        const slots = [this.system.player, ...Array.from({ length: PartySystem.maxSize }, (_, index) => PartySystem.members[index])];
        const host = this.$('.dxc-party-cards');
        this.$('.dxc-party-count').textContent = `${PartySystem.size + 1} / ${PartySystem.maxSize + 1} 人`;
        while (this.partyCards.length > slots.length) this.partyCards.pop().remove();
        slots.forEach((member, index) => {
            let card = this.partyCards[index];
            if (!card) {
                card = document.createElement('button');
                card.type = 'button'; card.className = 'dxc-party-card';
                card.innerHTML = `<span class="dxc-party-avatar" aria-hidden="true"></span>
                    <span class="dxc-party-identity"><strong></strong><span class="dxc-party-level"></span></span>
                    <span class="dxc-party-role"></span><span class="dxc-party-state"></span>
                    <span class="dxc-party-vitals"><span class="dxc-party-vital dxc-party-hp"><span class="dxc-party-value"></span><span class="dxc-party-track"><i></i></span></span>
                    <span class="dxc-party-vital dxc-party-mp"><span class="dxc-party-value"></span><span class="dxc-party-track"><i></i></span></span></span>`;
                card.addEventListener('click', event => {
                    if (!this.canInteract()) return;
                    // 保留原组队栏的选择与招募入口，不触发移动/攻击，也不修改队员数据。
                    if (index === 0) { PartySystem.clearSelection(); CompanionPanel._memberId = null; }
                    else {
                        const current = PartySystem.members[index - 1];
                        if (!current) { RecruitUI.open(); return; }
                        if (event.shiftKey) PartySystem.toggleSelected(current.id);
                        else PartySystem.setSelected([current.id]);
                        CompanionPanel._memberId = current.id;
                    }
                });
                host.appendChild(card); this.partyCards.push(card);
            }
            const isPlayer = index === 0, empty = !member && !isPlayer;
            const data = member?.data;
            const hp = Number.isFinite(data?.hp) ? Math.max(0, Math.ceil(data.hp)) : null;
            const maxHp = Number.isFinite(data?.maxHp) ? Math.max(0, Math.ceil(data.maxHp)) : null;
            const mp = Number.isFinite(data?.mp) ? Math.max(0, Math.ceil(data.mp)) : null;
            const maxMp = Number.isFinite(data?.maxMp) ? Math.max(0, Math.ceil(data.maxMp)) : null;
            const ratio = maxHp > 0 && hp !== null ? hp / maxHp : null;
            const state = empty ? '点击招募' : hp === null ? '状态待同步' : hp <= 0 ? '已倒下'
                : ratio !== null && ratio <= 0.3 ? '生命危急' : ratio !== null && ratio < 0.65 ? '受伤' : '状态良好';
            const name = isPlayer ? '主角' : member?.name || '空位';
            const avatar = isPlayer ? '🧙' : member?.avatar || '＋';
            const role = isPlayer ? '队伍领队' : member?.title || (empty ? '添加侍从' : '队伍成员');
            const selected = !empty && !isPlayer && PartySystem.isSelected(member.id);
            const key = JSON.stringify([member?.id, name, avatar, role, data?.level, hp, maxHp, mp, maxMp, state, selected]);
            if (card._partyKey === key) return;
            card._partyKey = key;
            card.classList.toggle('is-empty', empty);
            card.classList.toggle('is-hurt', !empty && hp !== null && ratio !== null && ratio <= 0.3);
            card.setAttribute('aria-pressed', String(selected));
            card.querySelector('.dxc-party-avatar').textContent = avatar;
            card.querySelector('strong').textContent = name;
            card.querySelector('.dxc-party-level').textContent = empty ? '' : `Lv.${data?.level ?? '—'}`;
            card.querySelector('.dxc-party-role').textContent = role;
            card.querySelector('.dxc-party-state').textContent = state;
            card.querySelector('.dxc-party-vitals').hidden = empty;
            for (const [kind, label, value, max] of [['hp', '生命', hp, maxHp], ['mp', '魔法', mp, maxMp]]) {
                const row = card.querySelector(`.dxc-party-${kind}`);
                row.querySelector('.dxc-party-value').textContent = `${label} ${value ?? '—'} / ${max ?? '—'}`;
                row.querySelector('i').style.width = `${max > 0 && value !== null ? Math.min(100, value / max * 100) : 0}%`;
            }
            const label = empty ? '空位，点击添加侍从' : `${name}，${role}，等级${data?.level ?? '待同步'}，${state}，生命${hp ?? '未知'}/${maxHp ?? '未知'}，魔法${mp ?? '未知'}/${maxMp ?? '未知'}${selected ? '，已选中' : ''}`;
            card.setAttribute('aria-label', label); card.title = label;
        });
    }

    bindMapInput() {
        this.map.addEventListener('pointerdown', event => {
            if (!this.canInteract() || event.button !== 0) return;
            this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
                offsetX: this.system.mapOffsetX, offsetY: this.system.mapOffsetY, moved: false };
            this.suppressClick = false;
        });
        this.map.addEventListener('pointermove', event => {
            const drag = this.drag;
            if (!drag || drag.id !== event.pointerId) return;
            if (!this.canInteract() || (event.buttons & 1) === 0) { this.endDrag(); return; }
            const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) > 6) {
                drag.moved = true;
                this.map.setPointerCapture(event.pointerId);
                this.map.classList.add('is-dragging');
            }
            if (drag.moved) {
                this.system.mapOffsetX = drag.offsetX + dx;
                this.system.mapOffsetY = drag.offsetY + dy;
                this.system._clampMapOffset();
                // 到边界后用实际钳制位置续拖，反向移动立即响应，不累计越界距离。
                drag.x = event.clientX; drag.y = event.clientY;
                drag.offsetX = this.system.mapOffsetX; drag.offsetY = this.system.mapOffsetY;
            }
        });
        this.map.addEventListener('pointerup', () => this.endDrag());
        this.map.addEventListener('pointercancel', () => this.endDrag());
        this.map.addEventListener('lostpointercapture', () => this.endDrag());
        this.map.addEventListener('click', event => {
            if (!this.suppressClick) return;
            event.preventDefault(); event.stopImmediatePropagation();
            this.suppressClick = false;
        }, true);
        this.map.addEventListener('wheel', event => {
            if (!this.canInteract()) return;
            event.preventDefault(); event.stopPropagation();
            if (event.ctrlKey) this.zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
            else {
                this.system.mapOffsetX -= event.shiftKey ? event.deltaY : event.deltaX;
                this.system.mapOffsetY -= event.shiftKey ? 0 : event.deltaY;
                this.system._clampMapOffset();
            }
        }, { passive: false });
        this.map.addEventListener('keydown', event => {
            if (event.target !== this.map || !this.canInteract()) return;
            const delta = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[event.key];
            if (!delta) return;
            event.preventDefault();
            this.system.mapOffsetX += delta[0]; this.system.mapOffsetY += delta[1];
            this.system._clampMapOffset();
        });
    }

    endDrag() {
        if (!this.drag) return;
        const { id, moved } = this.drag;
        this.drag = null;
        this.suppressClick = moved;
        this.map.classList.remove('is-dragging');
        if (this.map.hasPointerCapture(id)) this.map.releasePointerCapture(id);
    }

    zoom(factor) {
        if (!this.view) return;
        const system = this.system, oldScale = system.mapScale;
        const cx = this.view.left + this.view.width / 2, cy = this.view.top + this.view.height / 2;
        system.mapScale = Math.max(0.1, Math.min(1.6, oldScale * factor));
        system.mapOffsetX = cx - (cx - system.mapOffsetX) / oldScale * system.mapScale;
        system.mapOffsetY = cy - (cy - system.mapOffsetY) / oldScale * system.mapScale;
        system._clampMapOffset();
        this.syncZoomControls();
    }

    syncZoomControls() {
        const scale = this.system.mapScale;
        if (this.zoomControlKey === scale) return;
        this.zoomControlKey = scale;
        this.$('.dxc-zoom-value').textContent = `${Math.round(scale * 100)}%`;
        this.$('[data-action="out"]').disabled = scale <= 0.1;
        this.$('[data-action="in"]').disabled = scale >= 1.6;
        this.map.style.setProperty('--dxc-node-scale', String(Math.min(1, scale / 0.8)));
        this.map.classList.toggle('is-zoomed-out', scale < 0.6);
    }

    refreshRewardSummary() {
        // 使用原奖励面板已经生成的真实数值，不另算或复制奖励规则。
        const rows = [...this.rewardHost.querySelectorAll('.dungeon-route-reward-row')];
        const summary = rows.slice(0, 2).map(row => `${row.querySelector('span').textContent} ${row.querySelector('strong').textContent}`).join(' · ');
        const label = this.$('.dxc-reward-summary');
        label.textContent = summary ? `规则预览 · ${summary} · 非已获得` : '地牢规则预览 · 非已获得';
        label.title = label.textContent;
    }

    select(node, locate = false) {
        if (!this.canInteract()) return;
        if (locate) this.system._focusRouteSector(this.system._getSectorIndexForNode(node), { focusNodeId: node.id });
        this.selectedId = node.id;
        this.refresh();
    }

    refresh() {
        const system = this.system;
        if (!this.root.isConnected) return;
        if (this.currentId !== system.currentNodeId) {
            this.currentId = system.currentNodeId;
            this.selectedId = system.currentNodeId;
        }
        this.available = new Set(system.getAvailableNodes().map(node => node.id));
        this.syncZoomControls();
        this.$('#dungeonRouteHeaderProgress').textContent = `探索进度 ${system.visitedNodeIds.size} / ${system.nodes.length}`;
        const progress = this.$('progress');
        progress.max = Math.max(1, system.nodes.length); progress.value = system.visitedNodeIds.size;
        const idle = this.$('.dxc-invasion-idle');
        idle.textContent = !this.invasion.eligible ? '本级无特工入侵' : '';
        idle.hidden = !idle.textContent;
        const choices = this.$('.dxc-destinations');
        this.$('.dxc-available-count').textContent = `${this.available.size} 处可前往`;
        choices.replaceChildren(new Option('选择目标房间', ''));
        for (const node of system.getAvailableNodes()) {
            const detail = this.describeNode(node);
            choices.add(new Option(`${detail.number} · ${detail.title}`, String(node.id)));
        }
        choices.value = this.available.has(this.selectedId) ? String(this.selectedId) : '';
        const selected = system.nodes.find(node => node.id === this.selectedId) || system.getCurrentNode();
        if (selected) this.refreshDossier(selected);
        this.refreshNodes(system.nodes);
        this.measure();
        this.drawKey = null;
    }

    refreshDossier(node) {
        const detail = this.describeNode(node);
        this.$('.dxc-dossier h3').textContent = detail.title;
        this.$('.dxc-node-state').textContent = `节点 ${detail.number} · ${detail.state}`;
        this.$('.dxc-clue').textContent = detail.clue;
        this.$('.dxc-risk').textContent = detail.risk;
        this.$('.dxc-reward').textContent = detail.reward;
        this.$('.dxc-dossier-note').textContent = detail.note;
        this.$('.dxc-dossier-icon').src = detail.icon;
        this.$('.dxc-dossier').dataset.danger = detail.danger ? 'true' : 'false';
        const canEnter = this.available.has(node.id);
        const current = node.id === this.system.currentNodeId;
        const enter = this.$('#dungeonRouteEnter');
        enter.disabled = !canEnter;
        const enterLabel = canEnter ? `进入 · ${detail.title}` : current ? '选择一个房间' : '当前不可前往';
        this.$('.dxc-enter-label').textContent = enterLabel;
        enter.setAttribute('aria-label', canEnter ? `进入节点 ${detail.number}：${detail.title}` : enterLabel);
        this.$('.dxc-enter-hint').textContent = canEnter ? `目标 ${detail.number} · ${detail.risk}`
            : current ? '在路线图或上方列表选择相邻房间' : '此处仅供查看，请选择相邻可前往房间';
    }

    refreshNodes(nodes) {
        const ids = new Set(nodes.map(node => node.id));
        for (const [id, button] of this.nodeButtons) {
            if (!ids.has(id)) { button.remove(); this.nodeButtons.delete(id); }
        }
        for (const node of nodes) {
            let button = this.nodeButtons.get(node.id);
            if (!button) {
                button = document.createElement('button');
                button.type = 'button'; button.className = 'dxc-node';
                button.innerHTML = '<img alt=""><span class="dxc-node-number" aria-hidden="true"></span><span class="dxc-node-label"></span><span class="dxc-agent" hidden>入侵者</span>';
                button.addEventListener('click', () => this.select(node));
                this.nodeLayer.appendChild(button);
                this.nodeButtons.set(node.id, button);
            }
            const detail = this.describeNode(node);
            button.querySelector('img').src = detail.icon;
            button.setAttribute('aria-label', `节点${detail.number}，${detail.title}，${detail.state}`);
            button.title = `节点 ${detail.number} · ${detail.title} · ${detail.state}`;
            button.querySelector('.dxc-node-number').textContent = detail.number;
            button.setAttribute('aria-pressed', String(node.id === this.selectedId));
            button.classList.toggle('is-current', node.id === this.system.currentNodeId);
            button.classList.toggle('is-available', this.available.has(node.id));
            button.classList.toggle('is-unknown', !detail.revealed);
            button.classList.toggle('is-complete', !!node.completed);
            button.querySelector('.dxc-node-label').textContent = node.id === this.system.currentNodeId
                ? '当前位置' : this.available.has(node.id) ? (node.id === this.selectedId ? '已选择 · 可前往' : '可前往') : node.completed ? '已完成' : '';
        }
    }

    render() {
        if (!this.canInteract()) return;
        this.syncZoomControls();
        // 复用地图渲染节拍，不新增常驻定时器或逐帧重建卡片。
        const now = performance.now();
        if (!this.partyRefreshAt || now - this.partyRefreshAt >= 250) {
            this.refreshParty(); this.partyRefreshAt = now;
        }
        if (!this.view) return;
        const system = this.system, view = this.view;
        const key = [system.mapOffsetX, system.mapOffsetY, system.mapScale, this.selectedId,
            this.invasion.triggered, this.invasion.agentNodeId, view.left, view.top, view.width, view.height].join('|');
        if (key === this.drawKey) return;
        this.drawKey = key;
        const layout = system._getExpeditionLayout();
        const ctx = this.canvas.getContext('2d');
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, view.width, view.height);
        const screen = point => ({ x: point.x * system.mapScale + system.mapOffsetX - view.left,
            y: point.y * system.mapScale + system.mapOffsetY - view.top });
        const activeIds = new Set(this.nodeButtons.keys());
        const edges = [...layout.edgePaths.entries()].filter(([id]) => {
            const edge = system.edges.find(candidate => [candidate.from, candidate.to].sort().join('::') === id);
            return edge && activeIds.has(edge.from) && activeIds.has(edge.to);
        }).map(([id, path]) => {
            const edge = system.edges.find(candidate => [candidate.from, candidate.to].sort().join('::') === id);
            const available = (edge.from === system.currentNodeId && this.available.has(edge.to))
                || (edge.to === system.currentNodeId && this.available.has(edge.from));
            const selected = available && this.selectedId !== system.currentNodeId
                && (edge.from === this.selectedId || edge.to === this.selectedId);
            const visited = system.visitedNodeIds.has(edge.from) && system.visitedNodeIds.has(edge.to);
            const vertical = path.length === 2 && path[0].x === path[1].x;
            return { path, available, selected, visited, vertical };
        }).sort((a, b) => Number(a.available) - Number(b.available) || Number(a.selected) - Number(b.selected));
        for (const edge of edges) {
            const path = edge.path.map(screen);
            // 原网格的横线/竖线直接连接房间，仅真正需要绕行的边保留折线。
            this.traceCorridor(ctx, path); ctx.setLineDash([]);
            ctx.lineWidth = edge.available ? 6 : 4; ctx.strokeStyle = this.colors.ink; ctx.stroke();
            this.traceCorridor(ctx, path);
            ctx.lineWidth = edge.selected ? 2.6 : edge.available ? 1.8 : edge.vertical ? 1 : 1.2;
            ctx.strokeStyle = edge.selected ? this.colors.cyan : edge.available ? this.colors.blue
                : edge.visited ? this.colors.visited : this.colors.line;
            ctx.globalAlpha = edge.available || edge.visited ? 1 : 0.55;
            ctx.setLineDash(edge.available || edge.visited ? [] : [6, 5]); ctx.stroke();
            ctx.globalAlpha = 1;
        }
        ctx.setLineDash([]);
        const nodeScale = Math.min(1, system.mapScale / 0.8);
        const radius = (this.nodeLayer.firstElementChild?.offsetWidth || 48) * nodeScale / 2;
        let offscreenChoices = 0;
        for (const [id, button] of this.nodeButtons) {
            const point = screen(layout.points.get(id));
            // 只用图标与真实视窗的交集决定键盘入口/视野外提示，不整体隐藏节点。
            // 图标、外侧编号与名称交给同一个CSS视窗逐步裁切，允许各自部分露出。
            const iconVisible = point.x + radius > 0 && point.x - radius < view.width
                && point.y + radius > 0 && point.y - radius < view.height;
            if (!iconVisible && this.available.has(id)) offscreenChoices++;
            button.tabIndex = iconVisible ? 0 : -1;
            button.style.left = `${point.x}px`; button.style.top = `${point.y}px`;
            button.querySelector('.dxc-agent').hidden = !(this.invasion.triggered && this.invasion.agentNodeId === id);
        }
        // 仍保留真实完整路线；有限窗口放不下分岔时明确告知，不让消失的徽记冒充断路。
        const hint = offscreenChoices
            ? `${offscreenChoices} 处可前往房间在视野外，可从上方列表定位`
            : system.mapScale < 0.6 ? '全图概览 · 点击“当前位置”恢复可读视角'
                : '单击房间查看档案 · 拖动或滚轮平移';
        const hintElement = this.$('.dxc-map-hint');
        if (hintElement.textContent !== hint) hintElement.textContent = hint;
        hintElement.classList.toggle('has-offscreen-choices', offscreenChoices > 0);
    }

    traceCorridor(ctx, points) {
        ctx.beginPath(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length - 1; index++) {
            const a = points[index - 1], b = points[index], c = points[index + 1];
            const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y);
            if (!ab || !bc) { ctx.lineTo(b.x, b.y); continue; }
            const radius = Math.min(10, ab / 2, bc / 2);
            ctx.lineTo(b.x + (a.x - b.x) / ab * radius, b.y + (a.y - b.y) / ab * radius);
            ctx.quadraticCurveTo(b.x, b.y, b.x + (c.x - b.x) / bc * radius, b.y + (c.y - b.y) / bc * radius);
        }
        const end = points[points.length - 1]; ctx.lineTo(end.x, end.y);
    }

    destroy() {
        this.setMenuOpen(false);
        if (this.sideMenu) {
            this.sideMenu.removeEventListener('click', this.onMenuClick);
        }
        document.removeEventListener('pointermove', this.onMenuPointerMove, true);
        document.documentElement.removeEventListener('pointerleave', this.onMenuPointerLeave);
        window.removeEventListener('blur', this.onMenuPointerLeave);
        document.removeEventListener('pointerdown', this.onMenuOutsidePointer, true);
        document.removeEventListener('keydown', this.onMenuKeyDown, true);
        window.removeEventListener('electron-esc', this.onMenuElectronEscape, true);
        this.endDrag();
        this.endResize();
        this.unsubscribeParty?.();
        this.resizeObserver.disconnect();
        this.root.removeEventListener('scroll', this.onScroll, true);
        this.stage.remove(); this.nodeButtons.clear();
        document.body.classList.remove('dungeon-exploration-mode');
    }
}
