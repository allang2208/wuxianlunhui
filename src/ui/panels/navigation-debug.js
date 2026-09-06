import { ElevatedNavigationController } from '../../ai/elevated-navigation-controller.js';
import { ElevatedNavigationDiagnostics, navigationEntityKey } from '../../ai/elevated-navigation-diagnostics.js';
import { getWallCollapseDiagnostics, clearWallCollapseDiagnostics } from '../../world/wall-collapse.js';
import { PerformanceMonitor } from '../../systems/performance-monitor.js';

const STATUS_LABELS = {
    inactive: '单位已失效', controlled: '受控 / 击退中', action: '攻击 / 施法中',
    portal_queue: '正常等待楼梯通行', path_pending: '等待寻路预算',
    unreachable: '路线不可达，等待重试', route_following: '正在执行高架路线',
    ground_move: '地面移动命令', idle: '待机 / 无高架路线',
};
const EVENT_LABELS = {
    progress_timeout: '路线进度超时', queue_timeout: '楼梯队列超时',
    route_unreachable: '规划目标不可达',
    ground_entry_unreachable: '地面入口不可达', topology_replan_failed: '拓扑变化后重算失败',
    replan_failed: '恢复重算失败',
};
const SURFACE_LABELS = { ground: '地面', stairs: '楼梯', wall_walk: '墙顶 / 塔顶' };
const value = (input) => input ?? '—';
const position = (point) => point ? `(${value(point.x)}, ${value(point.y)}, z=${value(point.z)})` : '—';
const describeUnit = (unit) => `${unit.name || unit.type || '单位'} [${unit.id ?? unit.key}]`;
const time = (at) => new Date(at).toLocaleTimeString();

/** 复用T面板生命周期；此模块不注册定时器、不启用RTS、不选择/移动实体。 */
export function createNavigationDebug({ copyText, showPerformance }) {
    const content = document.createElement('div');
    content.className = 'dev-tool-tab-content';
    content.dataset.tabContent = 'navigation';
    content.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'dev-tool-page';
    wrap.innerHTML = `
        <div class="dev-tool-page-intro">
            <p>导航诊断 · 城墙 / 塔楼 / 楼梯</p>
            <p class="dev-tool-help">先在游戏中用 RTS 选中真实单位，再到本页查看；没有选择时可切换“主角”。只读状态，不改变路径、碰撞或通行顺序。</p>
        </div>
        <div class="dev-tool-actions">
            <label>观察对象 <select data-nav="target"></select></label>
            <label><input data-nav="auto" type="checkbox" checked> 自动刷新（500ms）</label>
            <button data-nav="refresh" class="dev-tool-menu-btn">刷新</button>
        </div>
        <div class="dev-tool-actions">
            <label><input data-nav="record" type="checkbox"> 记录导航异常</label>
            <button data-nav="clear" class="dev-tool-menu-btn">清空诊断记录</button>
            <button data-nav="copy" class="dev-tool-menu-btn">复制诊断报告</button>
            <button data-nav="download" class="dev-tool-menu-btn">下载 JSON</button>
            <button data-nav="performance" class="dev-tool-menu-btn">查看性能页</button>
        </div>
        <div class="dev-tool-help">
            异常记录默认关闭，开启后关面板仍记录，最多64条；坍塌失败沿用现有32条记录。场景重置会清空历史，复现后请先导出。开关不写入存档。<br>
            普通排队、等待寻路及攻击/控制停步不会作为进度超时记录；超时和阻挡样本是排查线索，不代表已确认卡死原因。
        </div>
        <div data-nav="status" class="dev-tool-status" role="status" aria-live="polite"></div>
        <div class="dev-tool-card-grid">
            <section class="dev-tool-card dev-tool-span-all"><h3>当前单位</h3><pre data-nav="unit"></pre>
                <details><summary>当前单位原始快照</summary><pre data-nav="raw"></pre></details>
            </section>
            <section class="dev-tool-card"><h3>导航异常</h3><pre data-nav="events"></pre></section>
            <section class="dev-tool-card"><h3>坍塌落地失败</h3><pre data-nav="landings"></pre></section>
            <section class="dev-tool-card dev-tool-span-all"><h3>城防即时计数</h3><pre data-nav="counters"></pre>
                <div class="dev-tool-help">分离对数是最近逻辑帧；落地次数自性能采样重置起累计。耗时分布请看性能页，导出包含最近120帧。</div>
            </section>
        </div>
        <textarea data-nav="fallback" class="dev-tool-report-output" readonly aria-label="手动复制诊断报告" style="display:none;"></textarea>`;
    content.appendChild(wrap);
    const control = (name) => wrap.querySelector(`[data-nav="${name}"]`);
    const targetSelect = control('target');
    let optionSignature = '';

    const getSelectedUnits = () => {
        // 不调用RTS清理/选择方法，不扫描Game.entities，更不使用碰撞编辑器纸面预览。
        const selection = window.Game?.RTSCommand?._selection || [];
        return selection.filter((entry) => (entry.kind === 'ally' || entry.kind === 'enemy')
            && entry.ref && entry.ref.active !== false && !entry.ref._collisionPreview)
            .slice(0, 32).map((entry) => entry.ref);
    };
    const getObserved = () => {
        const units = getSelectedUnits();
        const game = window.Game;
        const player = !game?._observerMode && game?.entities?.get('player') === game?.player
            ? game?.player : null;
        const choices = [
            ['rts', 'RTS 当前首个单位'], ['player', player ? '主角' : '主角（不在当前地图）'],
            ...units.map((unit) => [navigationEntityKey(unit), `${unit.name || unit.title || unit.constructor?.name || '单位'} [${unit.id ?? navigationEntityKey(unit)}]`]),
        ];
        const signature = JSON.stringify(choices);
        if (signature !== optionSignature) {
            const previous = targetSelect.value;
            targetSelect.replaceChildren(...choices.map(([key, label]) => {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = label;
                return option;
            }));
            targetSelect.value = choices.some(([key]) => key === previous) ? previous : 'rts';
            optionSignature = signature;
        }
        const entity = targetSelect.value === 'player' ? player
            : targetSelect.value === 'rts' ? units[0]
                : units.find((unit) => navigationEntityKey(unit) === targetSelect.value);
        return entity?.active !== false && !entity?._collisionPreview ? entity : null;
    };
    const getUnitSnapshot = () => ElevatedNavigationController.debugEntity(getObserved());
    const getCounters = () => Object.fromEntries(Object.entries(PerformanceMonitor.getCounters())
        .filter(([name]) => name.startsWith('wallCollapse.')
            || name === 'collision.separationPairs' || name === 'collision.coincidentPairs'));

    const refresh = (force = false) => {
        if (!force && !control('auto').checked) return;
        const snapshot = getUnitSnapshot();
        control('record').checked = ElevatedNavigationDiagnostics.enabled;
        if (snapshot) {
            const { unit, surface, command, traffic, groundPath } = snapshot;
            control('unit').textContent = [
                `${describeUnit(unit)} · ${STATUS_LABELS[snapshot.status] || snapshot.status} · ${time(snapshot.at)}`,
                `位置 ${position(unit)} · 生命 ${value(unit.hp)} / ${value(unit.maxHp)}`,
                `承载面 ${SURFACE_LABELS[surface.kind] || surface.kind} · 承载物 ${value(surface.carrierId)} · 楼梯 ${value(surface.staircaseId)} · 阶段 ${value(surface.stage)}`,
                `命令 ${value(command.mode)}${command.exitRoute ? '（优先离梯）' : ''} · 航点 ${command.routeLength ? command.routeIndex + 1 : 0}/${command.routeLength} · 下一点 ${position(command.nextWaypoint)}`,
                `路线版本 ${value(command.revision)} / 当前 ${command.currentRevision} · 恢复次数 ${command.recoveries} · 距上次进展 ${value(command.progressAgeMs)}ms`,
                `地面路径 ${value(groundPath.index)}/${groundPath.length} · 下一点 ${position(groundPath.nextWaypoint)} · ${snapshot.pending ? '等待寻路' : '无排队寻路任务'}`,
                traffic ? `通行 ${traffic.role} / ${value(traffic.direction)} · 队列 ${traffic.queuePosition}/${traffic.queueLength} · 持有者 ${traffic.holders} · 已等待 ${traffic.waitingMs}ms`
                    : '通行：无窄梯预约（宽梯或尚未进入入口也会如此）',
                `失败原因 ${value(command.failure)} · 重试等待 ${command.retryInMs}ms · 落地局部受阻 ${surface.landingBlocked ? '是' : '否'}`,
            ].join('\n');
        } else {
            control('unit').textContent = targetSelect.value === 'player'
                ? '主角不在当前地图，或当前处于观察模式；不会读取其他地图中的主角状态。'
                : '未选中有效单位。请用 RTS 选中友军或怪物，或在观察对象中选择“主角”。多选时列出前32个单位。';
        }
        control('raw').textContent = JSON.stringify(snapshot, null, 2);
        const events = ElevatedNavigationDiagnostics.getRecords(8);
        control('events').textContent = `${ElevatedNavigationDiagnostics.enabled ? '记录已开启（关面板仍记录）' : '记录已关闭'} · ${ElevatedNavigationDiagnostics.count}/64 条 · 显示最近8条\n`
            + (events.slice().reverse().map((item) => `${time(item.at)} ${EVENT_LABELS[item.event] || item.event} · ${describeUnit(item.unit)}\n  ${position(item.unit)} → ${position(item.command.nextWaypoint)} · ${STATUS_LABELS[item.status] || item.status}`)
                .join('\n') || '暂无记录；请在复现前开启“记录导航异常”。');
        const landings = getWallCollapseDiagnostics();
        control('landings').textContent = `${landings.length}/32 条 · 显示最近6条\n`
            + (landings.slice(-6).reverse().map((item) => `${time(item.at)} ${item.unitType || '单位'} [${value(item.unitId)}] · ${item.reason}\n  ${position(item.origin)} → ${position(item.landing)} · 阻挡样本 ${item.blocker?.kind || '未知'} [${value(item.blocker?.id)}] · ${item.elapsedMs.toFixed(2)}ms`)
                .join('\n') || '暂无落地失败记录。');
        control('counters').textContent = Object.entries(getCounters()).map(([name, count]) => `${name}：${typeof count === 'number' ? Math.round(count * 100) / 100 : count}`).join('\n') || '暂无城防计数；发生移动分离或坍塌后再查看。';
    };

    const buildReport = () => JSON.stringify({
        schema: 'world122-navigation-diagnostics-v1', exportedAt: new Date().toISOString(),
        recordingEnabled: ElevatedNavigationDiagnostics.enabled,
        notes: '快照与事件为排查线索；普通停步不等于卡死。导航最多64条，落地最多32条。不会修改路径或自动脱困。',
        selectedUnit: getUnitSnapshot(),
        navigationEvents: ElevatedNavigationDiagnostics.getRecords(),
        collapseFailures: getWallCollapseDiagnostics(),
        performance: PerformanceMonitor.getSnapshot(120),
    }, null, 2);
    control('record').addEventListener('change', () => {
        ElevatedNavigationDiagnostics.setEnabled(control('record').checked);
        refresh(true);
    });
    control('auto').addEventListener('change', () => refresh(true));
    control('refresh').addEventListener('click', () => refresh(true));
    targetSelect.addEventListener('change', () => refresh(true));
    control('clear').addEventListener('click', () => {
        ElevatedNavigationDiagnostics.clear();
        clearWallCollapseDiagnostics();
        control('status').textContent = '诊断历史已清空；未重置性能采样或当前单位状态。';
        control('fallback').value = '';
        control('fallback').style.display = 'none';
        refresh(true);
    });
    control('performance').addEventListener('click', showPerformance);
    control('copy').addEventListener('click', async () => {
        const report = buildReport();
        const button = control('copy');
        button.disabled = true;
        try {
            await copyText(report);
            control('status').textContent = '已复制单位、导航异常、坍塌失败及性能报告，可直接发给开发排查。';
            control('fallback').value = '';
            control('fallback').style.display = 'none';
        } catch (_error) {
            control('status').textContent = '剪贴板不可用，可从下方文本框手动复制，或点击“下载 JSON”。';
            control('fallback').value = report;
            control('fallback').style.display = 'block';
        } finally {
            button.disabled = false;
        }
    });
    control('download').addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([buildReport()], { type: 'application/json;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `navigation-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(link);
        try {
            link.click();
            control('status').textContent = '已发起 JSON 下载；若当前容器拦截下载，请使用“复制诊断报告”。';
        } finally {
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    });
    return { content, refresh };
}
