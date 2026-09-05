import { WorldStrategySystem as Strategy } from '../world/world-strategy-system.js';
import { SETTLER_PIECE_URL } from './world-map-army-visuals.js';
import { formatStrategicTravelTime } from '../world/strategic-march.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function settlersHtml(controlledId, targetCell) {
    const cfg = Strategy.config.settlers;
    return `<strong>移民拓城 · ${Strategy.state.settlers.length} / ${cfg.maxTeams}</strong>
        <p class="wm-hint">在指挥所、司令部或国防部组建：${cfg.population} 空闲居民、${cfg.food} 粮食、${cfg.energy} 能量。点选移民旗后右键行军。</p>
        ${Strategy.state.settlers.map((unit) => {
            const status = Strategy.foundingStatus(unit.id), march = Strategy.marchStatus(unit);
            const preview = Strategy.previewSettlerOrder(unit.id, targetCell);
            const target = targetCell && targetCell !== unit.cellId ? Strategy.foundingStatus(unit.id, targetCell, { preview: true }) : null;
            const button = (action, label, disabled, title = '') => `<button type="button" class="ws-go ${action === 'found' ? 'is-primary' : 'is-secondary'}" data-settler-action="${action}" data-settler-id="${esc(unit.id)}" ${disabled ? 'disabled' : ''} title="${esc(title)}">${label}</button>`;
            return `<article class="wm-support-card wm-settler-card ${controlledId === unit.id ? 'is-controlled' : ''}">
                <button type="button" class="wm-destination" data-select-army="${esc(unit.id)}" aria-pressed="${controlledId === unit.id}"><img class="wm-settler-portrait" src="${SETTLER_PIECE_URL}" alt="家园双叶移民旗"><span>${esc(unit.name)} · ${unit.population} 人<small>${controlledId === unit.id ? '正在控制' : '点选控制'}</small></span></button>
                <p class="wm-hint">${esc(unit.orderNote)}${march ? ` · 本段剩余 ${formatStrategicTravelTime(march.remainingMs)}` : ''}</p>
                <p class="${status.ok ? 'wm-tone-success' : 'wm-hint'}">${status.ok ? (status.recoverySceneId ? '当前位置为已崩塌位面的旧城址，可恢复市政厅' : `当前位置可建城 · 距最近城址 ${status.nearest} 格`) : esc(status.reason)}</p>
                ${target ? `<p class="wm-hint">所选目标：${target.ok ? (target.recoverySceneId ? '抵达后可由移民恢复该位面' : `可选址，最近城址 ${target.nearest} 格（抵达后建城）`) : esc(target.reason)}</p>` : ''}
                <div class="wm-actions">${button('move', '向所选地格行军', !preview.ok, preview.reason)}${button('hold', '停止', Strategy.supportCommandBlocked())}${button('found', status.recoverySceneId ? '恢复位面市政厅' : '在驻留格建立城市', !status.ok, status.reason)}</div>
            </article>`;
        }).join('')}
        ${Strategy.state.settlers.length ? '<p class="wm-hint">最低城距按六边格距离计算，5格可建、4格不可建；营地和废墟不能重叠。移民遇敌停驻，不参与战斗，也不自动归营。</p>' : ''}`;
}
