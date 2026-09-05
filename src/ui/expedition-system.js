import { Game } from '../game.js';
import { SceneManager } from '../world/scene-manager.js';
/**
 * ExpeditionSystem — 出征准备系统
 * 全黑背景覆盖，选择地牢和3个队友槽位；出征时自动从背包/仓库校验并消耗对应钥匙。
 */

import { UIState } from './ui-state.js';
import { getElement, getElementIfExists } from '../utils/dom-utils.js';
import { EquipManager } from './equip-manager.js';
import { WarehouseSystem } from './warehouse-system.js';
import { SystemUI } from './system-ui.js';
import { SoundManager } from './sound-manager.js';
import { DungeonMapSystem } from '../world/dungeon-map-system.js';
import { WorldProgressionSystem } from '../world/world-progression-system.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { PartySystem } from '../systems/party-system.js';
import { RecruitUI } from './recruit-ui.js';
import { CompanionPanel } from './companion-panel.js';
import { EventBus } from '../core/event-bus.js';
import { syncTributeBuffs } from '../config/tribute-effects.js';
import { RARITY_ORDER, RARITY_COLORS, RARITY_LABELS } from '../config/rarity.js';
import { GRADE_ORDER, RESTRICTED_EVENT_META } from '../world/dungeon-event-definitions.js';
import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { EffectManager } from '../effects/effect-manager.js';
import { CONFIG } from '../config/config.js';
import { RuntimeAssetManager } from '../phaser/assets/runtime-asset-manager.js';
import { resolveDungeonEnemyPreloadTypes } from '../world/dungeon-enemy-preload.js';
import { isDungeonKeyCostIgnored } from '../config/dev-cheats.js';
import { MailStore } from '../systems/mail-store.js';
import { PlayerRewardDelivery } from '../systems/player-reward-delivery.js';
import {
    countDungeonKeys,
    getDungeonKeyRequirement,
    isDungeonKeyItem,
} from '../config/dungeon-key-config.js';

export const ExpeditionSystem = {
    _isOpen: false,
    _worldTarget: null,

    getDepartureBlockReason({ allowLoading = false } = {}) {
        if (getElementIfExists('dungeonExitRetryBtn')) return '上次返回尚未完成，请先重试返回主神空间';
        if (this._departing && !allowLoading) return '正在准备出征，请稍候';
        if (window.WorldStrategySystem?.active) return '亲征军团尚在外，请先撤军，再准备普通地牢';
        if (SceneManager.isLoading && !allowLoading) return '场景正在加载，请稍候';
        if (!Game.player || Game.player.data?.hp <= 0) return '角色当前无法出征';
        if (SceneManager.isDungeonRunActive()) return '当前地牢尚未结算，请先结束本次探险';
        if (MailStore.run?.status === 'active') return '上次探险战利品尚未结算，暂时不能出征';
        if (Game._observerMode) return '当前为观察视野，请先返回本体，再回到主神空间准备远征';
        if (SceneManager.isQuestInstance()) return '请先完成或撤离当前调查任务';
        if (!['main', 'scene7'].includes(SceneManager.currentScene)) return '请先通过原有离场入口返回主神空间，目标会保留';
        return '';
    },

    // 打开出征准备面板
    open(player, { worldId = null } = {}) {
        if (UIState.isOpen('expedition')) return false;
        // scene7's original preparation room opens during switchScene's loading phase.
        const blocked = this.getDepartureBlockReason({ allowLoading: true });
        const binding = worldId ? WorldProgressionSystem.getWorldExpeditionTarget(worldId) : null;
        if (blocked || (binding && !binding.ok)) {
            SceneManager.showTopNotification(blocked || binding.reason, { color: '#ff7766' });
            return false;
        }
        this._worldTarget = binding?.target || null;
        this._preparationVersion = (this._preparationVersion || 0) + 1;
        if (worldId) this._anchorNPC = null;
        UIState.open('expedition');
        this._isOpen = true;
        // 打开出征面板时关闭组队面板
        EventBus.emit('ui:panel-open', { panel: 'expedition' });

        // 打开面板时刷新玩家属性，确保没有残留祭品加成
        if (player && typeof player.calculateCombatStats === 'function') {
            player.calculateCombatStats();
        }

        // 出征使用两栏布局：左侧钥匙/奖励说明，中部地牢与队伍选择。
        // body 状态只控制显隐和点击层，不改变任何 HUD 的预设坐标。
        if (SystemUI) SystemUI.close();
        document.body.classList.add('expedition-preparing');

        // 显示全黑背景覆盖层
        const overlay = getElement('expeditionOverlay');
        if (overlay) overlay.classList.add('active');

        // 显示出征准备面板
        const panel = getElement('expeditionPanel');
        if (panel) panel.classList.add('active');

        // 刷新逐级解锁状态，并默认选中第一个已解锁的低级地牢。
        this._refreshDungeonOptions();
        const defaultDungeon = this._worldTarget?.dungeonType || this._getFirstUnlockedDungeon() || 'abandonedMineBeginner';
        this.selectedDungeon = defaultDungeon;
        const select = getElement('expeditionDungeonSelect');
        if (select) select.value = defaultDungeon;
        this._updateDungeonInfo(defaultDungeon);

        // 出征条件说明弹窗（左侧）
        this._showRulePanel();

        // 更新UI
        this._subscribeParty();
        this._renderMemberBar(player);
        this._renderWorldTarget();
        this.refreshDungeonKeyRequirement();
        return true;
    },

    // 关闭出征准备面板
    close() {
        if (!UIState.isOpen('expedition')) return;
        UIState.close('expedition');
        this._isOpen = false;
        this._worldTarget = null;
        this._anchorNPC = null;
        this._preparationVersion = (this._preparationVersion || 0) + 1;

        // 隐藏面板和覆盖层
        const panel = getElement('expeditionPanel');
        if (panel) panel.classList.remove('active');
        const overlay = getElement('expeditionOverlay');
        if (overlay) overlay.classList.remove('active');
        this._hideRulePanel();
        document.body.classList.remove('expedition-preparing');
    },

    // 切换面板
    toggle(player) {
        if (UIState.isOpen('expedition')) this.close();
        else this.open(player);
    },

    // 出征面板打开期间跟随正式队伍变化刷新；只订阅一次，避免重复监听。
    _subscribeParty() {
        if (this._partyUnsub) return;
        this._partyUnsub = PartySystem.onChange(() => {
            if (this._isOpen) this._renderMemberBar(Game.player);
        });
    },

    // 玩家固定 + 最多 3 名正式队友。仓鼠兵种不读取 Game.friendlyUnits，因此不会进入此栏。
    _renderMemberBar(player) {
        const bar = getElement('expeditionMemberBar');
        if (!bar) return;
        const members = PartySystem.members;
        const maxSize = PartySystem.maxSize;
        const count = getElement('expeditionPartyCount');
        if (count) count.textContent = `${members.length}/${maxSize}`;

        let html = `
            <div class="expedition-member-circle expedition-member-circle--player" title="玩家固定随行">
                <div class="expedition-member-avatar">🧙</div>
                <div class="expedition-member-name">主角</div>
                <div class="expedition-member-level">Lv.${player ? player.data.level : '?'}</div>
            </div>`;
        for (let i = 0; i < maxSize; i++) {
            const member = members[i];
            if (member) {
                html += `<button type="button" class="expedition-member-circle expedition-member-circle--member" data-companion="${member.id}" title="管理 ${member.name}；移出后可从空位选择替换">
                    <span class="expedition-member-avatar">${member.avatar}</span>
                    <span class="expedition-member-name">${member.name}</span>
                    <span class="expedition-member-level">Lv.${member.data.level}</span>
                </button>`;
            } else {
                html += `<button type="button" class="expedition-member-circle expedition-member-circle--empty" data-recruit="1" title="选择一名正式队友加入出征队伍">
                    <span class="expedition-member-plus">＋</span>
                    <span class="expedition-member-name">选择队友</span>
                </button>`;
            }
        }
        bar.innerHTML = html;
        bar.querySelectorAll('[data-recruit]').forEach((element) => {
            element.onclick = () => RecruitUI.open();
        });
        bar.querySelectorAll('[data-companion]').forEach((element) => {
            element.onclick = () => CompanionPanel.open(element.dataset.companion);
        });
    },

    // 显示消息
    _showMessage(text, type = 'normal') {
        const el = getElement('expeditionMessage');
        if (!el) return;
        el.textContent = text;
        el.className = 'expedition-message' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
    },

    // 地牢选择变更
    onDungeonSelect(value) {
        if (this._worldTarget) {
            const binding = WorldProgressionSystem.getWorldExpeditionTarget(this._worldTarget.sceneId, value);
            if (!binding.ok) {
                this._showMessage(binding.reason, 'error');
                const select = getElement('expeditionDungeonSelect');
                if (select) select.value = this.selectedDungeon;
                return;
            }
            this._worldTarget = binding.target;
        }
        if (!this.isDungeonUnlocked(value)) {
            this._showMessage(this._getDungeonLockMessage(value), 'error');
            const select = getElement('expeditionDungeonSelect');
            if (select) select.value = this.selectedDungeon || this._getFirstUnlockedDungeon() || '';
            return;
        }
        this.selectedDungeon = value;
        this._preparationVersion = (this._preparationVersion || 0) + 1;
        this._updateDungeonInfo(value);
        this._updateRulePanelCurrent();
        this._renderWorldTarget();
    },

    isDungeonUnlocked(dungeonType) {
        return WorldProgressionSystem.getDungeonUnlockStatus(dungeonType).ok;
    },

    _getDungeonLockMessage(dungeonType) {
        return WorldProgressionSystem.getDungeonUnlockStatus(dungeonType).reason;
    },

    _refreshDungeonOptions() {
        const select = getElement('expeditionDungeonSelect');
        if (!select) return;
        const list = DungeonConfig.getDungeonList();
        const targetTypes = this._worldTarget ? new Set(WorldProgressionSystem.getWorldExpeditionDungeons(this._worldTarget.sceneId)) : null;
        select.querySelectorAll('option').forEach((option) => {
            const locked = !this.isDungeonUnlocked(option.value);
            const outsideTarget = targetTypes && !targetTypes.has(option.value);
            const baseLabel = option.dataset.baseLabel || list[option.value]?.name || option.value;
            option.hidden = !!outsideTarget;
            option.disabled = locked || !!outsideTarget;
            option.textContent = locked
                ? `${baseLabel}（未解锁：${this._getDungeonLockMessage(option.value)}）`
                : baseLabel;
            option.title = locked ? this._getDungeonLockMessage(option.value) : '';
        });
        select.querySelectorAll('optgroup').forEach((group) => {
            group.hidden = Array.from(group.querySelectorAll('option')).every((option) => option.hidden);
        });
    },

    _renderWorldTarget() {
        const info = getElement('expeditionPanel')?.querySelector('.expedition-info');
        if (!info) return;
        let card = getElement('expeditionWorldTarget');
        if (!card) {
            card = document.createElement('section');
            card.id = 'expeditionWorldTarget';
            card.className = 'expedition-world-target';
            card.setAttribute('aria-label', '本次远征的世界目标');
            info.appendChild(card);
        }
        card.replaceChildren();
        card.hidden = !this._worldTarget;
        if (!this._worldTarget) return;
        const target = this._worldTarget;
        const world = WorldProgressionSystem.getWorldConfig(target.sceneId);
        const title = document.createElement('strong');
        title.textContent = `目标：${world?.name || target.sceneId} · 地块 ${target.cellId}`;
        const description = document.createElement('p');
        description.textContent = target.purpose === 'connect'
            ? '完成所选地牢，获得此处的接通资格；失败或撤离仍保留原目标格。'
            : '再次探索此位面的地牢，获取原有战利品；不会重复生成位面或自动重建传送门。';
        const free = document.createElement('button');
        free.type = 'button';
        free.className = 'bp-button bp-button--muted';
        free.textContent = '解除本次目标，自由选本';
        free.onclick = () => {
            if (SceneManager.isLoading) return;
            this._worldTarget = null;
            this._preparationVersion++;
            this._refreshDungeonOptions();
            this._renderWorldTarget();
            getElement('expeditionDungeonSelect')?.focus({ preventScroll: true });
            this._showMessage('已切换为自由探索；地图中的信标位置仍保留');
        };
        card.append(title, description, free);
    },

    _getFirstUnlockedDungeon() {
        for (const group of DungeonConfig.getDungeonGroups()) {
            const first = group.items.find((item) => this.isDungeonUnlocked(item.type));
            if (first) return first.type;
        }
        return null;
    },

    /** 当前选择地牢的配置等级。 */
    _getSelectedGrade() {
        const list = DungeonConfig.getDungeonList();
        const d = list[this.selectedDungeon] || {};
        return d.grade || 'F';
    },

    _getKeyCount(grade = this._getSelectedGrade()) {
        return countDungeonKeys(EquipManager.backpackItems, grade)
            + countDungeonKeys(WarehouseSystem.items, grade);
    },

    _consumeDungeonKey(grade) {
        if (isDungeonKeyCostIgnored()) return { refund() {} };
        // 提交区内不刷新 UI、不 await；失败回执只还原这一次同步扣费。
        for (const items of [EquipManager.backpackItems || [], WarehouseSystem.items || []]) {
            const index = items.findIndex(item => isDungeonKeyItem(item, grade));
            if (index < 0) continue;
            const item = items[index];
            const stack = item.stack || 1;
            let refunded = false;
            const receipt = { refund() {
                if (refunded) return;
                item.stack = stack;
                if (!items.includes(item)) items.splice(index, 0, item);
                refunded = true;
            } };
            if (stack > 1) item.stack = stack - 1;
            else items.splice(index, 1);
            return receipt;
        }
        return null;
    },

    /** 当前选择地牢的配置等级。 */






    /** 开发开关切换时同步已打开的出征说明，不改变选择或解锁状态。 */
    refreshDungeonKeyRequirement() {
        if (!this._isOpen) return;
        this._updateRulePanelCurrent();
        this._showMessage(isDungeonKeyCostIgnored()
            ? '开发调试：地牢免钥匙已开启，不检查、不消耗对应等级代币'
            : '出征时将自动从背包或仓库消耗对应等级钥匙');
    },

    /** 出征条件说明弹窗：创建（一次）并显示 */
    _showRulePanel() {
        this._buildRulePanel();
        const panel = getElement('expeditionRulePanel');
        if (panel) panel.style.display = 'block';
        this._updateRulePanelCurrent();
        this._showMessage(isDungeonKeyCostIgnored()
            ? '开发调试：地牢免钥匙已开启，不检查、不消耗对应等级代币'
            : '出征时将自动从背包或仓库消耗对应等级钥匙');
    },

    /** 出征条件说明弹窗：创建（一次）并显示 */


    _hideRulePanel() {
        const panel = getElement('expeditionRulePanel');
        if (panel) panel.style.display = 'none';
        const help = getElement('expeditionRuleHelp');
        if (help?.open) help.close();
    },

    _buildRulePanel() {
        if (getElement('expeditionRulePanel')) return;
        const panel = document.createElement('div');
        panel.id = 'expeditionRulePanel';
        panel.className = 'expedition-rule-panel';
        panel.innerHTML = `
            <header class="expedition-rule-header">
                <span class="expedition-grade-badge" id="expeditionGradeBadge">F</span>
                <div><div class="rule-title" id="expeditionGradeTitle">F级地牢</div>
                <div class="rule-desc" id="expeditionDungeonTier"></div></div>
            </header>
            <div class="rule-current" id="expeditionRuleCurrent"></div>
            <div class="rule-rewards" id="expeditionRuleRewards"></div>
            <div class="expedition-unlock-preview" id="expeditionUnlockPreview"></div>
            <div class="expedition-risk" id="expeditionRuleRisk"></div>
            <button type="button" class="bp-button expedition-help-button" id="expeditionRuleHelpButton">详细规则与奖励说明</button>
        `;
        panel.querySelector('#expeditionRuleHelpButton').onclick = () => this._openRuleHelp();
        document.body.appendChild(panel);
    },

    _openRuleHelp() {
        let dialog = getElement('expeditionRuleHelp');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'expeditionRuleHelp';
            dialog.className = 'expedition-rule-help';
            dialog.setAttribute('aria-labelledby', 'expeditionRuleHelpTitle');
            const expCfg = COMBAT_FORMULAS.enemy?.expValue || {};
            const rows = GRADE_ORDER.map((grade) => {
                const band = expCfg.bands?.[grade];
                const key = getDungeonKeyRequirement(grade);
                return `<li><strong>${grade}级</strong> · ${key.name}${band ? ` · 推荐 Lv.${band[0]}~${band[1] - 1}` : ''}</li>`;
            }).join('');
            dialog.innerHTML = `<form method="dialog" class="expedition-help-shell">
                <header><div><small>EXPEDITION PROTOCOL</small><h2 id="expeditionRuleHelpTitle">地牢出征规则</h2></div>
                <button type="submit" class="bp-button bp-button--muted" aria-label="关闭帮助">关闭</button></header>
                <section><h3>双重解锁</h3><p>地牢必须同时满足两项条件：全局等级已从 F 逐级解锁到目标等级；同一地牢系列的前置难度已经成功通关。失败、安全撤离和放弃均不会解锁新等级。</p></section>
                <section><h3>钥匙与推荐等级</h3><ul>${rows}</ul><p>玩家等级明显超过低级地牢时，怪物经验会进入衰减区间。</p></section>
                <section><h3>结算差异</h3><p>成功通关会登记系列进度并解锁下一全局等级；失败、安全撤离或放弃不解锁。无论结果如何，本次出征都会按地牢等级推进入侵集结周期，世界时间也会继续流逝。</p></section>
                <section><h3>奖励构成</h3><p>左侧摘要显示当前配置的基础通关奖励、祭品品质范围、宝箱材料、武器品质与事件档位。实际掉落仍以本次房间、敌人和事件结算为准。</p></section>
            </form>`;
            document.body.appendChild(dialog);
        }
        if (!dialog.open) dialog.showModal();
        dialog.querySelector('button')?.focus({ preventScroll: true });
    },

    /** 更新说明弹窗中的当前需求高亮 */
    _updateRulePanelCurrent() {
        const el = getElement('expeditionRuleCurrent');
        if (!el) return;
        const ignoreKeyCost = isDungeonKeyCostIgnored();
        const list = DungeonConfig.getDungeonList();
        const d = list[this.selectedDungeon] || {};
        const grade = d.grade || 'F';
        const key = getDungeonKeyRequirement(grade);
        const keyCount = ignoreKeyCost ? 0 : this._getKeyCount(grade);
        const band = (COMBAT_FORMULAS.enemy?.expValue?.bands || {})[grade];
        const bandText = d.recLevel ? ` · 推荐等级 ${d.recLevel}` : band ? ` · 推荐等级 Lv.${band[0]}~${band[1] - 1}` : '';
        const keyRequirement = ignoreKeyCost
            ? '开发调试：免钥匙进入，不检查或消耗代币'
            : `需要 <b>${key.name} ×1</b> · 持有 <b class="${keyCount > 0 ? 'rule-ok' : 'rule-danger'}">${keyCount}</b>`;
        const badge = getElement('expeditionGradeBadge');
        const title = getElement('expeditionGradeTitle');
        const tier = getElement('expeditionDungeonTier');
        if (badge) { badge.textContent = grade; badge.dataset.grade = grade; }
        if (title) title.textContent = `${grade}级地牢`;
        if (tier) tier.textContent = `${d.name || this.selectedDungeon}${d.tier ? ` · ${d.tier}` : ''}`;
        el.innerHTML = `<div>${keyRequirement}</div><div>${bandText.replace(/^ · /, '') || `推荐等级 ${d.recLevel || '未标注'}`}</div><div>基础通关奖励：${d.reward || '按结算表发放'}</div>`;
        const risk = getElement('expeditionRuleRisk');
        const fraction = WorldProgressionSystem.config.invasion?.dungeonProgressByGrade?.[grade] || 0;
        if (risk) risk.textContent = `风险：任何结局都会推进入侵集结 ${Math.round(fraction * 100)}%，世界时间持续流逝。`;
        const unlockPreview = getElement('expeditionUnlockPreview');
        if (unlockPreview) {
            const hypotheticalGrade = GRADE_ORDER[Math.min(GRADE_ORDER.length - 1, GRADE_ORDER.indexOf(grade) + 1)];
            const unlocked = Object.entries(list).filter(([type, info]) => {
                const gradeReady = GRADE_ORDER.indexOf(info.grade || 'F') <= GRADE_ORDER.indexOf(hypotheticalGrade);
                const seriesReady = !info.unlockAfter || info.unlockAfter === this.selectedDungeon
                    || WorldProgressionSystem.hasCompletedDungeon(info.unlockAfter);
                return type !== this.selectedDungeon && gradeReady && seriesReady && !this.isDungeonUnlocked(type);
            }).map(([, info]) => info.name);
            unlockPreview.textContent = unlocked.length
                ? `成功后解锁：${unlocked.join('、')}`
                : '成功后：登记本系列通关进度；若已到最高等级则不再开放新等级。';
        }
        this._updateRulePanelRewards(grade);
    },

    /** 稀有度中文+颜色行内渲染 */
    _rarityText(rarity) {
        const zh = RARITY_LABELS[rarity] || rarity;
        const color = RARITY_COLORS[rarity] || '#c0c0c0';
        return `<b style="color:${color}">${zh}</b>`;
    },

    /** 出征条件下方：当前地牢奖励情况（祭品品质/装备/事件等级，稀有度配色） */
    _updateRulePanelRewards(grade) {
        const el = getElement('expeditionRuleRewards');
        if (!el) return;
        const lines = [];
        // 祭品掉落品质：按难度表的稀有度封顶
        const table = (COMBAT_FORMULAS.tributes && COMBAT_FORMULAS.tributes.dropTables && COMBAT_FORMULAS.tributes.dropTables[grade]) || null;
        if (table) {
            const cap = table.maxRarity || 'legendary';
            lines.push(`祭品掉落：${this._rarityText('common')} ~ ${this._rarityText(cap)}`);
            const normalChance = Math.round(((table.normal && table.normal.chance) || 0) * 1000) / 10;
            lines.push(`<span class="rule-sub">精英/领主/首领必掉 · 普通怪 ${normalChance}%</span>`);
        }
        // 宝箱房奖励（精英战限时宝箱，按地牢等级读 universalEventRewards.treasureChest）
        const chestGrade = ((COMBAT_FORMULAS.universalEventRewards || {}).treasureChest || {})[grade];
        if (chestGrade) {
            lines.push(`宝箱房(${grade}级)：必得强化石×${chestGrade.enhancementStone ?? 1} + 改造券×${chestGrade.reforgeTicket ?? 1}`);
            lines.push(`<span class="rule-sub">75% 金币 ${chestGrade.gold} / 25% 粉尘 ${chestGrade.materialDust}</span>`);
        }
        // 通关奖励面板实际从 RewardSystem 的优质武器池抽取 rare / epic。
        lines.push(`通关奖励武器：${this._rarityText('rare')} ~ ${this._rarityText('epic')}`);
        // 事件等级：通用事件（奖励按当前难度档）+ 限定事件 ±1 范围内的等级跨度
        const idx = Math.max(0, GRADE_ORDER.indexOf(grade));
        const inRange = Object.values(RESTRICTED_EVENT_META)
            .map(m => GRADE_ORDER.indexOf(m.grade))
            .filter(i => i >= 0 && Math.abs(i - idx) <= 1);
        if (inRange.length > 0) {
            const minG = GRADE_ORDER[Math.min(...inRange)];
            const maxG = GRADE_ORDER[Math.max(...inRange)];
            lines.push(`事件：通用事件（${grade} 级奖励档）· 限定事件 ${minG}~${maxG} 级`);
        } else {
            lines.push(`事件：通用事件（${grade} 级奖励档）`);
        }
        el.innerHTML = `<div class="rule-rewards-title">✦ 奖励情况</div>` + lines.map(t => `<div class="rule-reward-line">${t}</div>`).join('');
    },

    // 更新地牢信息面板（展示元数据来自 data/dungeon-config.json 的 dungeonList）
    _updateDungeonInfo(_dungeonType) {
        const nameEl = getElement('expeditionDungeonName');
        const nodeCountEl = getElement('expeditionNodeCount');
        const battleRatioEl = getElement('expeditionBattleRatio');
        const levelEl = getElement('expeditionLevel');
        const rewardEl = getElement('expeditionReward');

        const list = DungeonConfig.getDungeonList();
        const d = list[_dungeonType] || list.zombie || {};
        if (nameEl) nameEl.textContent = d.name || '';
        if (nodeCountEl) nodeCountEl.textContent = d.nodeCount || '';
        if (battleRatioEl) battleRatioEl.textContent = d.battleRatio || '';
        if (levelEl) levelEl.textContent = `${d.grade || 'F'} 级${d.recLevel ? ` · 推荐 ${d.recLevel}` : ''}`;
        if (rewardEl) rewardEl.textContent = d.reward || '';
    },

    // 确认出征 — 自动从背包优先、仓库其次消耗对应等级钥匙
    async depart() {
        if (this._departing || SceneManager?.isLoading) return;
        if (!this._isOpen || !UIState.isOpen('expedition')) return;
        const blocked = this.getDepartureBlockReason();
        if (blocked) { this._showMessage(blocked, 'error'); return; }
        const preparationVersion = this._preparationVersion;
        const target = this._worldTarget ? { ...this._worldTarget } : null;
        const dungeonType = this.selectedDungeon || this._getFirstUnlockedDungeon() || 'abandonedMineBeginner';
        if (!this.isDungeonUnlocked(dungeonType)) {
            this._refreshDungeonOptions();
            this._showMessage(this._getDungeonLockMessage(dungeonType), 'error');
            return;
        }
        const grade = this._getSelectedGrade();
        const key = getDungeonKeyRequirement(grade);
        if (!isDungeonKeyCostIgnored() && this._getKeyCount(grade) <= 0) {
            this._showMessage(`背包和仓库中都没有 ${key.name}`, 'error');
            this._updateRulePanelCurrent();
            return;
        }
        const player = Game.player;
        const previousRun = MailStore.run;
        let entryRunId = null;
        let runtimeStarted = false;
        let keyReceipt = null;
        let committed = false;
        this._departing = true;
        try {
            const dungeonEnemyTypes = resolveDungeonEnemyPreloadTypes(dungeonType);
            SceneManager.showLoadingScreen({ sceneId: 'scene7', dungeonType });
            SceneManager.setProgress(10);
            await SceneManager.delay(50);
            // 登记校验和资源准备均在扣费之前；怪物贴图仍由实际战斗波次加载。
            RuntimeAssetManager.validateEnemyTypes(dungeonEnemyTypes, { required: true });
            RuntimeAssetManager.setDungeonEnemyTypes([]);
            SceneManager.setProgress(45);
            const changed = preparationVersion !== this._preparationVersion || !this._isOpen
                || !UIState.isOpen('expedition') || this.selectedDungeon !== dungeonType;
            const lateBlock = this.getDepartureBlockReason({ allowLoading: true });
            const currentTarget = target ? WorldProgressionSystem.getWorldExpeditionTarget(target.sceneId, dungeonType) : null;
            const staleTarget = currentTarget && (!currentTarget.ok
                || currentTarget.target.cellId !== target.cellId || currentTarget.target.worldEpoch !== target.worldEpoch);
            if (changed || lateBlock || staleTarget) {
                throw new Error(lateBlock || (staleTarget ? '世界目标已变化，请重新选择' : '出征准备已变更，请重新确认'));
            }
            // 先保存主城，再把后续部分初始化明确标为 scene7，失败回城不能覆盖主城快照。
            if (SceneManager.currentScene === 'main') SceneManager._saveMainSceneState();
            runtimeStarted = true;
            SceneManager.currentScene = 'scene7';
            this.close();
            SceneManager.setProgress(55);
            // 仓鼠兵种及其他场景友军留在主神空间：只从地牢运行态暂存，不销毁、不改坐标。
            // 正式队友由 PartySystem.members 独立管理，继续随玩家进入地牢。
            if (SceneManager && typeof SceneManager.parkFriendlyUnitsForDungeon === 'function') {
                SceneManager.parkFriendlyUnitsForDungeon();
            }

            // 清理主神空间实体（传送门/NPC/怪物/掉落物），防止地图模式下小地图泄露残留蓝点
            const phaserScene = typeof window !== 'undefined' ? window.__phaserScene : null;
            if (phaserScene) {
                if (phaserScene.clearCombatView) phaserScene.clearCombatView();
                if (phaserScene.clearAllEntitySprites) phaserScene.clearAllEntitySprites();
            }
            if (EffectManager && EffectManager.clearFloatingTexts) EffectManager.clearFloatingTexts();
            // 冰墙动态障碍/待生成队列：出征前清理（主场景坐标不得带入地牢）
            if (player && player.iceWallSystem && typeof player.iceWallSystem.breakdown === 'function') {
                player.iceWallSystem.breakdown();
            }
            Game.entities.clear();
            Game.entities.set('player', player);
            if (Game._tacticalSquadAI) Game._tacticalSquadAI.clear();
            // 地图模式使用地牢世界尺寸（2048 网格），小地图正确缩放
            CONFIG.WORLD_WIDTH = 2048;
            CONFIG.WORLD_HEIGHT = 2048;
            // 玩家移至地牢世界中央（主神空间坐标在 2048 世界内超界，小地图会画出框外）
            player.x = 1024;
            player.y = 1024;

            try {
                // 加载遮罩下只保留目标说明；世界探险记录在资源就绪后才提交。
                DungeonMapSystem.init('scene7', player, dungeonType, { worldExpedition: target });
            } finally {
                if (MailStore.run !== previousRun) entryRunId = MailStore.run?.id;
            }
            // 地牢 active=true 后重算全局30分钟献祭效果，并登记地牢特效图标。
            if (player?.calculateCombatStats) player.calculateCombatStats();
            if (player) syncTributeBuffs(player);
            await SceneManager.prepareRuntimeVisualAssets?.({ startProgress: 80, endProgress: 92 });
            SceneManager.setProgress(92);
            // BGM 场景切换：depart 绕开 switchScene（其尾部不会执行），需手动补发；
            // scene7 按 dungeonType 选子类型音轨，未配置类型继续回退普通地牢音轨。
            if (SoundManager && typeof SoundManager.playBgmForScene === 'function') {
                SoundManager.playBgmForScene('scene7', { dungeonType });
            }
            await SceneManager.waitForMinimumLoadingDuration();
            SceneManager.setProgress(100);
            await SceneManager.delay(100);
            if (!DungeonMapSystem.active || SceneManager.currentScene !== 'scene7'
                || MailStore.run?.id !== entryRunId || player !== Game.player || player.data.hp <= 0) {
                throw new Error('出征现场已变化，未提交本次出征');
            }
            // 扣费到绑定之间没有异步等待或 UI 回调；任何未提交错误立即使用回执退还。
            keyReceipt = this._consumeDungeonKey(grade);
            if (!keyReceipt) throw new Error(`${key.name} 不足，请重新准备`);
            const binding = target ? WorldProgressionSystem.beginWorldExpedition(target) : null;
            if (binding && !binding.ok) throw new Error(binding.reason);
            DungeonMapSystem.worldExpedition = binding ? Object.freeze({ ...binding.target }) : null;
            committed = true;
        } catch (error) {
            if (!committed) keyReceipt?.refund();
            console.error('[ExpeditionSystem] 出征未完成:', dungeonType, error);
            const detail = `出征未完成：${error?.message || '未知错误'}（未消耗钥匙）`;
            if (!runtimeStarted) {
                this._showMessage(detail, 'error');
            } else {
                // 回城使用与其他出口相同的重试界面，初始化失败不计作完成过一局。
                SceneManager.hideLoadingScreen();
                await DungeonMapSystem._returnToMainWithRetry('entry_failure', {
                    player, detail,
                    beforeSettle: () => {
                        if (entryRunId && MailStore.run?.id === entryRunId) {
                            PlayerRewardDelivery.finishRun('load_failure');
                            MailStore.state = { ...MailStore.state, run: previousRun };
                            MailStore.notify();
                        }
                    },
                    onReturned: (returnedPlayer) => {
                        if (this.open(returnedPlayer, { worldId: target?.sceneId || null })) {
                            this.onDungeonSelect(dungeonType);
                            const select = getElement('expeditionDungeonSelect');
                            if (select) select.value = this.selectedDungeon;
                            this._showMessage(detail, 'error');
                        }
                    },
                });
            }
        } finally {
            this._departing = false;
            try { if (!committed) RuntimeAssetManager.setDungeonEnemyTypes([]); }
            finally { SceneManager.hideLoadingScreen(); }
            if (keyReceipt) {
                try { EquipManager.updateInventorySlots?.(); } catch (error) { console.warn('[Expedition] 背包刷新失败', error); }
                try { WarehouseSystem._refreshAll?.(); } catch (error) { console.warn('[Expedition] 仓库刷新失败', error); }
            }
        }
    },

    // 从出征准备返回主神空间（保留，用于外部调用）
    returnToMain() {
        this.close();
        if (SystemUI) SystemUI.close();
        if (SceneManager) {
            SceneManager.switchScene('main', Game.player);
        }
    }
};

// 将 ExpeditionSystem 挂载到全局
if (typeof window !== 'undefined' && !window.ExpeditionSystem) {
    window.ExpeditionSystem = ExpeditionSystem;
}
