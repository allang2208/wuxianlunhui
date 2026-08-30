// 已选 v9 探索台。只消费地图运行态；可达、进入、奖励与撤离仍由原系统持有。
export class DungeonExplorationConsole {
    constructor(system, { invasion, describeNode, grade, dossierImage, isCurrentScene }) {
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
            <header class="dxc-heading">
                <h1>探索规划</h1><span class="dxc-dungeon-name"></span>
                <div class="dxc-progress"><span id="dungeonRouteHeaderProgress"></span><progress aria-label="探索进度"></progress></div>
                <div id="dungeonRouteTopIntel"><div id="dungeonRouteInfoStack"><span class="dxc-invasion-idle"></span></div></div>
            </header>
            <div class="dxc-planning">
                <section class="dxc-route" aria-label="探索路线">
                    <nav class="dxc-toolbar" aria-label="路线视图">
                        <span class="dxc-sector-label"></span>
                        <select class="dxc-destinations" aria-label="选择相邻可前往节点"></select>
                        <button type="button" class="bp-button bp-button--muted" data-action="overview">路线总览</button>
                        <button type="button" class="bp-button bp-button--muted" data-action="focus">当前位置</button>
                    </nav>
                    <div class="dxc-map" tabindex="0" role="group" aria-label="房间路线，可拖动或用方向键平移">
                        <canvas aria-hidden="true"></canvas><div class="dxc-nodes"></div>
                    </div>
                    <div class="dxc-overview" aria-label="路线区段总览" hidden></div>
                    <nav class="dxc-route-footer" aria-label="区段与缩放">
                        <button type="button" class="bp-button bp-button--muted" data-action="previous">上一段</button>
                        <div class="dxc-sector-index"></div>
                        <button type="button" class="bp-button bp-button--muted" data-action="next">下一段</button>
                        <span class="dxc-map-hint">先选房间，再进入 · 拖动查看</span>
                        <button type="button" class="bp-button bp-button--muted" data-action="out" aria-label="缩小路线">缩小</button>
                        <button type="button" class="bp-button bp-button--muted" data-action="in" aria-label="放大路线">放大</button>
                    </nav>
                </section>
                <aside class="dxc-dossier" aria-label="节点档案">
                    <h2>节点档案</h2><img class="dxc-vignette" alt="" aria-hidden="true">
                    <div class="dxc-node-heading"><img class="dxc-dossier-icon" alt=""><div><h3></h3><span class="dxc-node-state"></span></div></div>
                    <p class="dxc-clue"></p>
                    <dl><div><dt>风险</dt><dd class="dxc-risk"></dd></div><div><dt>收益</dt><dd class="dxc-reward"></dd></div></dl>
                    <p class="dxc-dossier-note"></p>
                </aside>
            </div>
            <section class="dxc-rewards" aria-label="预期收益"><header><h2>预期收益</h2><span>地牢规则预览 · 非已获得</span></header><div class="dxc-reward-host"></div></section>
            <footer class="dxc-actions">
                <div class="dxc-enter-group"><button id="dungeonRouteEnter" type="button" class="bp-button dxc-enter" disabled>进入节点</button><span class="dxc-enter-hint" aria-live="polite"></span></div>
                <div id="dungeonRouteTopActions" class="dxc-exits"></div>
            </footer>`;
        this.$ = selector => this.root.querySelector(selector);
        this.$('.dxc-dungeon-name').textContent = `${system.dungeonName} · ${grade}级`;
        this.$('.dxc-vignette').src = dossierImage;
        this.map = this.$('.dxc-map');
        this.canvas = this.map.querySelector('canvas');
        this.rewardHost = this.$('.dxc-reward-host');
        this.infoStack = this.$('#dungeonRouteInfoStack');
        document.body.appendChild(this.root);
        document.body.classList.add('dungeon-exploration-mode');
        const theme = getComputedStyle(this.root);
        this.colors = {
            ink: theme.getPropertyValue('--dxc-ink').trim(),
            line: theme.getPropertyValue('--dxc-line').trim(),
            cyan: theme.getPropertyValue('--dxc-cyan').trim(),
            blue: theme.getPropertyValue('--dxc-blue').trim(),
            visited: theme.getPropertyValue('--bp-ui-accent').trim(),
        };
        this.root.addEventListener('click', event => {
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (!action || !this.canInteract()) return;
            if (action === 'overview') system._fitRouteMap();
            else if (action === 'focus') system._focusOnCurrentNode({ restoreDefaultZoom: true });
            else if (action === 'previous') system._focusRouteSector(system.routeSectorIndex - 1);
            else if (action === 'next') system._focusRouteSector(system.routeSectorIndex + 1);
            else if (action === 'in' || action === 'out') this.zoom(action === 'in' ? 1.15 : 1 / 1.15);
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
        this.resizeObserver = new ResizeObserver(() => {
            if (!this.canInteract() || this.map.clientWidth <= 0 || this.map.clientHeight <= 0) return;
            this.measure();
            system._focusRouteSector(system.routeSectorIndex, { focusNodeId: system.currentNodeId });
        });
        this.resizeObserver.observe(this.map);
        this.onScroll = () => { this.measure(); this.drawKey = null; };
        this.root.addEventListener('scroll', this.onScroll, true);
        this.measure();
    }

    canInteract() {
        const system = this.system;
        return system.active && system.state === 'map' && !system._observerSuspended && this.isCurrentScene()
            && this.root.isConnected && this.root.style.display !== 'none'
            && !document.getElementById('dungeonExitConfirm') && !document.getElementById('dungeonVictoryOverlay');
    }

    measure() {
        const rect = this.map.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        this.bannerBottom = Math.max(0, this.root.getBoundingClientRect().top);
        if (this.view) {
            // 窄窗滚动整块台面时，房间跟随自身窗口，不停留在原屏幕坐标。
            this.system.mapOffsetX += rect.left - this.view.left;
            this.system.mapOffsetY += rect.top - this.view.top;
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
        if (this.system.routeViewMode === 'overview' || !this.view) return;
        const system = this.system, oldScale = system.mapScale;
        const cx = this.view.left + this.view.width / 2, cy = this.view.top + this.view.height / 2;
        system.mapScale = Math.max(0.8, Math.min(1.6, oldScale * factor));
        system.mapOffsetX = cx - (cx - system.mapOffsetX) / oldScale * system.mapScale;
        system.mapOffsetY = cy - (cy - system.mapOffsetY) / oldScale * system.mapScale;
        system._clampMapOffset();
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
        const sectors = system._getRouteSectors();
        const overview = system.routeViewMode === 'overview';
        this.map.hidden = overview;
        this.$('.dxc-overview').hidden = !overview;
        this.$('[data-action="overview"]').setAttribute('aria-pressed', String(overview));
        this.$('[data-action="previous"]').disabled = system.routeSectorIndex <= 0;
        this.$('[data-action="next"]').disabled = system.routeSectorIndex >= sectors.length - 1;
        this.$('[data-action="out"]').disabled = overview;
        this.$('[data-action="in"]').disabled = overview;
        this.$('.dxc-sector-label').textContent = overview ? '路线总览' : `区段 ${system.routeSectorIndex + 1} / ${sectors.length}`;
        this.$('#dungeonRouteHeaderProgress').textContent = `探索进度 ${system.visitedNodeIds.size} / ${system.nodes.length}`;
        const progress = this.$('progress');
        progress.max = Math.max(1, system.nodes.length); progress.value = system.visitedNodeIds.size;
        const idle = this.$('.dxc-invasion-idle');
        idle.textContent = !this.invasion.eligible ? '本级无特工入侵' : '';
        idle.hidden = !idle.textContent;
        const choices = this.$('.dxc-destinations');
        choices.replaceChildren(new Option(`${this.available.size} 处可前往 · 选择房间`, ''));
        for (const node of system.getAvailableNodes()) {
            const detail = this.describeNode(node);
            choices.add(new Option(`${detail.number} · ${detail.title}`, String(node.id)));
        }
        choices.value = this.available.has(this.selectedId) ? String(this.selectedId) : '';
        this.refreshSectors(sectors);
        const selected = system.nodes.find(node => node.id === this.selectedId) || system.getCurrentNode();
        if (selected) this.refreshDossier(selected);
        this.refreshNodes(overview ? [] : system._getActiveRouteNodes());
        this.measure();
        this.drawKey = null;
    }

    refreshSectors(sectors) {
        const system = this.system;
        const current = system._getSectorIndexForNode(system.getCurrentNode());
        const agent = system.nodes.find(node => node.id === this.invasion.agentNodeId);
        const agentSector = this.invasion.triggered && agent ? system._getSectorIndexForNode(agent) : -1;
        const index = this.$('.dxc-sector-index'), overview = this.$('.dxc-overview');
        index.replaceChildren(); overview.replaceChildren();
        for (const sector of sectors) {
            for (const full of [false, true]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = full ? 'dxc-sector-card' : 'dxc-sector-dot';
                button.textContent = full
                    ? `区段 ${String(sector.index + 1).padStart(2, '0')} · 已探索 ${sector.visitedCount}/${sector.nodes.length}${sector.index === current ? ' · 当前位置' : ''}${sector.index === agentSector ? ' · 入侵者' : ''}`
                    : String(sector.index + 1).padStart(2, '0');
                button.setAttribute('aria-label', `查看区段${sector.index + 1}，已探索${sector.visitedCount}/${sector.nodes.length}${sector.index === agentSector ? '，入侵者所在区段' : ''}`);
                button.setAttribute('aria-pressed', String(sector.index === system.routeSectorIndex && system.routeViewMode !== 'overview'));
                if (sector.index === current) button.setAttribute('aria-current', 'location');
                if (sector.index === agentSector) button.classList.add('has-agent');
                button.addEventListener('click', () => { if (this.canInteract()) system._focusRouteSector(sector.index); });
                (full ? overview : index).appendChild(button);
            }
        }
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
        this.$('#dungeonRouteEnter').disabled = !canEnter;
        this.$('#dungeonRouteEnter').setAttribute('aria-label', canEnter ? `进入节点：${detail.title}` : '请先选择相邻可前往节点');
        this.$('.dxc-enter-hint').textContent = canEnter ? `已选择：${detail.title}` : '请先选择一个相邻的可前往房间';
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
                button.innerHTML = '<img alt=""><span class="dxc-node-label"></span><span class="dxc-agent" hidden>入侵者</span>';
                button.addEventListener('click', () => this.select(node));
                this.$('.dxc-nodes').appendChild(button);
                this.nodeButtons.set(node.id, button);
            }
            const detail = this.describeNode(node);
            button.querySelector('img').src = detail.icon;
            button.setAttribute('aria-label', `节点${detail.number}，${detail.title}，${detail.state}`);
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
        if (!this.view || this.system.routeViewMode === 'overview' || !this.canInteract()) return;
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
        for (const [id, button] of this.nodeButtons) {
            const point = screen(layout.points.get(id));
            const visible = point.x >= 26 && point.x <= view.width - 26 && point.y >= 26 && point.y <= view.height - 44;
            button.style.visibility = visible ? 'visible' : 'hidden';
            button.tabIndex = visible ? 0 : -1;
            button.style.left = `${point.x}px`; button.style.top = `${point.y}px`;
            button.querySelector('.dxc-agent').hidden = !(this.invasion.triggered && this.invasion.agentNodeId === id);
        }
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
        this.endDrag();
        this.resizeObserver.disconnect();
        this.root.removeEventListener('scroll', this.onScroll, true);
        this.root.remove(); this.nodeButtons.clear();
        document.body.classList.remove('dungeon-exploration-mode');
    }
}
