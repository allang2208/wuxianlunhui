import { WorldStrategySystem as Strategy } from '../world/world-strategy-system.js';
import { WorldProgressionSystem as Progression } from '../world/world-progression-system.js';
import { TroopLineSystem as Troops } from '../world/troop-line-system.js';
import { PLAYER_ARMY_MARKER_ID } from './world-map-army-visuals.js';
import { formatStrategicTravelTime } from '../world/strategic-march.js';
import './world-map-support.css';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function supportArmyHtml(controlledId, targetCell, sources) {
    const bases = Progression.getWorldIds().map((id) => Strategy.baseEntry(id)).filter(Boolean);
    const select = (id, origin) => {
        const source = sources[id] || origin || bases[0]?.sceneId;
        return `<label class="wm-supply-source">补给 / 接收基地<select data-supply-source="${esc(id)}" aria-label="选择补给或接收基地">${bases.map((base) => `<option value="${esc(base.sceneId)}" ${source === base.sceneId ? 'selected' : ''}>${esc(Progression.getWorldConfig(base.sceneId)?.name)}</option>`).join('')}</select></label>`;
    };
    const button = (action, id, label, disabled = false) => `<button type="button" class="ws-go is-secondary" data-support-action="${action}" data-support-id="${esc(id)}" ${disabled ? 'disabled' : ''}>${label}</button>`;
    const busy = Strategy._busy || window.SceneManager?.isLoading;
    return `<strong>我方军团与补给 · ${Strategy.playerArmies().length}</strong>
        <p class="wm-hint">点选军团后右键下令。分遣军独立行军和数值作战；到达亲征战场后从边缘增援，并入亲征编队。</p>
        ${Strategy.playerArmies().map((army) => {
            const primary = army === Strategy.state.army, supply = Strategy.supplyStatus(army);
            const units = primary ? Strategy.troopCount() : Troops.getArmyPower(army.id).units;
            const preview = !primary && Strategy.previewDetachmentOrder(army.id, targetCell);
            const march = Strategy.marchStatus(army);
            return `<article class="wm-support-card ${controlledId === army.id ? 'is-controlled' : ''}">
                <button type="button" class="wm-destination" data-select-army="${primary ? PLAYER_ARMY_MARKER_ID : esc(army.id)}" aria-pressed="${controlledId === army.id}"><span>${esc(army.name)} · ${units} 兵</span><small>${controlledId === army.id ? '正在控制' : '点选控制'}</small></button>
                <p class="wm-hint">${esc(army.orderNote || '驻留待命')}${march ? ` · 本段剩余 ${formatStrategicTravelTime(march.remainingMs)}` : ''}</p>
                <p class="${supply.food ? 'wm-hint' : 'wm-tone-warning'}">粮食 ${supply.food} / ${supply.capacity} · 约 ${supply.days.toFixed(1)} 天 · 每天 ${supply.daily}</p>
                ${!primary ? `<div class="wm-actions">${button('order', army.id, preview.order?.label || '向所选地格行军', busy || !preview.ok)}${button(army.battle ? 'retreat' : 'hold', army.id, army.battle ? '沿来路撤退' : '停止', busy)}${button('home', army.id, '返回出发基地', busy || !!army.battle)}</div>` : ''}
                ${select(army.id, army.originSceneId)}
                <div class="wm-actions">${button('supply', army.id, '派运输队', busy || !bases.length)}${button(army.supplyLine ? 'line-off' : 'line-on', army.id, army.supplyLine ? '关闭自动补给线' : '建立自动补给线', busy || !bases.length)}${!primary ? button('base', army.id, '向所选基地归营', busy || !!army.battle || !bases.length) : ''}</div>
                ${army.supplyLine ? `<p class="wm-hint">补给线：${esc(army.supplyLine.note)}</p>` : ''}
            </article>`;
        }).join('') || '<p class="wm-hint">在己方指挥建筑选兵，派出分遣军或亲征。</p>'}
        <strong>运输队 · ${Strategy.state.convoys.length}</strong>
        ${Strategy.state.convoys.map((convoy) => `<article class="wm-support-card"><button type="button" class="wm-destination" data-select-army="${esc(convoy.id)}"><span>运输队 · ${convoy.food} 粮</span><small>${convoy.returning ? '返航 / 卸货' : '运往军团'}</small></button><p class="wm-hint">${esc(convoy.orderNote)}</p>${select(convoy.id, convoy.origin?.sceneId)}<div class="wm-actions">${button('convoy-return', convoy.id, '返回原基地', busy)}${button('convoy-redirect', convoy.id, '向所选基地卸货', busy || !bases.length)}</div></article>`).join('')}`;
}
