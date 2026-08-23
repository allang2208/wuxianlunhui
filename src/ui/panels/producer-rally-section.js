// 出兵建筑详情内的集结部署分区。
// 只读取 TroopLineSystem 的权威状态；设置集结点仍由 RTSCommand 的地图右键流程负责。
import { TroopLineSystem } from '../../world/troop-line-system.js';
import { TechnologySystem } from '../../world/technology-system.js';

function worldLabel(sceneId) {
    if (!sceneId) return '当前位面';
    return window.WorldProgressionSystem?.getWorldConfig?.(sceneId)?.name || sceneId;
}

function pointLabel(point) {
    if (!point) return '';
    return `${worldLabel(point.sceneId)} · X ${Math.round(point.x)} / Y ${Math.round(point.y)}`;
}

function globalLineLabel(state) {
    if (state.mode === 'rally' && state.rally) return `全局自订 · ${pointLabel(state.rally)}`;
    if (state.mode === 'hold') return '全局待命 · 新兵留在建筑出口';
    return '全局跟随 · 新兵跟随玩家';
}

export function renderProducerRallySection() {
    return `
        <section class="producer-rally-section bp-panel-section" data-producer-rally-section hidden aria-label="集结部署">
            <div class="producer-rally-section__head">
                <div>
                    <div class="troop-panel-section-title">集结部署</div>
                    <div class="producer-rally-section__meta">本建筑后续生成单位的出发路线</div>
                </div>
                <span class="producer-rally-section__badge" data-producer-rally-badge></span>
            </div>
            <div class="producer-rally-route" aria-label="当前集结路线">
                <div class="producer-rally-route__node">
                    <span>起点</span>
                    <strong>本建筑出口</strong>
                </div>
                <span class="producer-rally-route__arrow" aria-hidden="true">→</span>
                <div class="producer-rally-route__node producer-rally-route__node--target">
                    <span>目的地</span>
                    <strong data-producer-rally-target></strong>
                    <small data-producer-rally-priority></small>
                </div>
            </div>
            <div class="producer-rally-section__global" data-producer-rally-global></div>
            <div class="producer-rally-section__hint" data-producer-rally-hint></div>
        </section>`;
}

/** 原地刷新集结文案，不重建建筑详情或生产/升级 DOM。 */
export function refreshProducerRallySection(root, producer, sceneId) {
    const section = root?.matches?.('[data-producer-rally-section]')
        ? root
        : root?.querySelector?.('[data-producer-rally-section]');
    if (!section || !producer || !TroopLineSystem.isTroopProducer(producer)) {
        if (section) section.hidden = true;
        return false;
    }

    section.hidden = false;
    const independent = TroopLineSystem.getProducerRally(producer, sceneId);
    const state = TroopLineSystem.getState();
    const unlocked = TechnologySystem.isUnlocked('mechanic', 'troop_rally');
    const inheritedTarget = state.mode === 'rally' ? state.rally : null;
    const target = independent || inheritedTarget;
    const signature = [
        producer.id,
        unlocked ? 1 : 0,
        independent ? 1 : 0,
        target?.sceneId || '',
        Number(target?.x) || 0,
        Number(target?.y) || 0,
        state.mode,
        state.rally?.sceneId || '',
        Number(state.rally?.x) || 0,
        Number(state.rally?.y) || 0,
    ].join('|');
    if (section.dataset.rallySignature === signature) return true;
    section.dataset.rallySignature = signature;

    section.classList.toggle('is-independent', !!independent);
    section.classList.toggle('is-locked', !unlocked);

    const badge = section.querySelector('[data-producer-rally-badge]');
    const targetEl = section.querySelector('[data-producer-rally-target]');
    const priority = section.querySelector('[data-producer-rally-priority]');
    const global = section.querySelector('[data-producer-rally-global]');
    const hint = section.querySelector('[data-producer-rally-hint]');

    if (badge) badge.textContent = independent ? '独立优先' : (unlocked ? '继承兵线' : '科技未解锁');
    if (targetEl) {
        targetEl.textContent = target
            ? pointLabel(target)
            : (state.mode === 'hold' ? '建筑出口待命' : '跟随玩家');
    }
    if (priority) {
        priority.textContent = independent
            ? '仅接管本建筑之后生成的单位'
            : '当前没有独立集结点';
    }
    if (global) global.textContent = independent
        ? `全局后备：${globalLineLabel(state)}`
        : `当前采用：${globalLineLabel(state)}`;
    if (hint) hint.textContent = unlocked
        ? '指挥模式选中本建筑后，右键地图中的可达位置即可更新独立集结点。'
        : '研发“集结战术”后，可为本建筑设置独立集结点。';
    return true;
}
