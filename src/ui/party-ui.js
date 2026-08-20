// ============================================================
// 组队栏（PartyUI，2026-08-12 框架）
// 需求：左侧显示 4 个组队槽位
//       （玩家固定 + 最多 3 名侍从）；空槽=加号（打开寻找帮手界面），
//       有成员=头像/名字/等级——点击名字=选中该单位（高亮模型贴图），
//       Shift+点击=多选；不再点击即弹队员面板（面板仍可从侧边菜单进入）。
// 挂载：game.js Game.init() 调用 PartyUI.init()
// ============================================================

import { PartySystem } from '../systems/party-system.js';
import { RecruitUI } from './recruit-ui.js';
import { CompanionPanel } from './companion-panel.js';

export const PartyUI = {
    _root: null,
    _grid: null,

    init() {
        this._createElement();
        PartySystem.onChange(() => this.render());
        this.render();
    },

    _createElement() {
        if (this._root) return;
        const root = document.createElement('div');
        root.id = 'partyBar';
        root.className = 'party-bar';
        root.innerHTML = `
            <div class="party-bar-title">👥 组队</div>
            <div class="party-bar-grid" id="partyBarGrid"></div>
        `;
        const container = document.getElementById('gameContainer');
        container.appendChild(root);
        this._root = root;
        this._grid = root.querySelector('#partyBarGrid');
    },

    render() {
        if (!this._grid) return;
        const members = PartySystem.members;
        const maxSize = PartySystem.maxSize;
        let html = '';
        // 槽位 0 = 玩家（固定，不可移除）
        html += this._slotHtml(null, true);
        // 槽位 1..maxSize = 侍从
        for (let i = 0; i < maxSize; i++) {
            const m = members[i];
            html += this._slotHtml(m, false);
        }
        this._grid.innerHTML = html;
        this._bindSlots();
    },

    _slotHtml(member, isPlayer) {
        if (isPlayer) {
            return `<div class="party-slot party-slot--player" data-player="1" title="玩家（主角）· 点击取消全部选中">
                <div class="party-slot-avatar">🧙</div>
                <div class="party-slot-name">主角</div>
            </div>`;
        }
        if (!member) {
            return `<div class="party-slot party-slot--empty" data-recruit="1" title="添加侍从">
                <div class="party-slot-plus">＋</div>
                <div class="party-slot-name">空位</div>
            </div>`;
        }
        const selected = PartySystem.isSelected(member.id);
        return `<div class="party-slot party-slot--member ${selected ? 'party-slot--selected' : ''}" data-companion="${member.id}" title="${member.name} · ${member.title}${selected ? ' · 已选中' : ''}">
            <div class="party-slot-avatar">${member.avatar}</div>
            <div class="party-slot-name">${member.name}</div>
            <div class="party-slot-level">Lv.${member.data.level}</div>
        </div>`;
    },

    _bindSlots() {
        this._grid.querySelectorAll('[data-recruit]').forEach(el => {
            el.onclick = () => RecruitUI.open();
        });
        this._grid.querySelectorAll('[data-companion]').forEach(el => {
            // 点击 = 选中该单位（高亮模型）；Shift+点击 = 多选切换。
            // 不再点击即打开队员面板（队员面板/装备背包走右侧边菜单「管理队员」）。
            el.onclick = (e) => {
                const id = el.dataset.companion;
                if (e.shiftKey) {
                    PartySystem.toggleSelected(id);
                } else {
                    PartySystem.setSelected([id]);
                }
                // 同步队员面板当前队员：之后从侧边菜单打开面板时显示被选中的单位
                if (CompanionPanel) CompanionPanel._memberId = id;
            };
        });
        const playerSlot = this._grid.querySelector('[data-player]');
        if (playerSlot) {
            playerSlot.onclick = () => {
                PartySystem.clearSelection();
                if (CompanionPanel) CompanionPanel._memberId = null;
            };
        }
    },
};
