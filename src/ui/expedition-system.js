import { Game } from '../game.js';
import { SceneManager } from '../world/scene-manager.js';
/**
 * ExpeditionSystem — 出征准备系统
 * 全黑背景覆盖，选择地牢和3个队友槽位；出征时自动从背包/仓库校验并消耗对应钥匙。
 */

import { UIState } from './ui-state.js';
import { getElement } from '../utils/dom-utils.js';
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
import {
    countDungeonKeys,
    getDungeonKeyRequirement,
    isDungeonKeyItem,
} from '../config/dungeon-key-config.js';

export const ExpeditionSystem = {
    _isOpen: false,
    // 打开出征准备面板
    open(player) {
        if (UIState.isOpen('expedition')) return;
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
        const defaultDungeon = this._getFirstUnlockedDungeon() || 'zombieBeginner';
        this.selectedDungeon = defaultDungeon;
        const select = getElement('expeditionDungeonSelect');
        if (select) select.value = defaultDungeon;
        this._updateDungeonInfo(defaultDungeon);

        // 出征条件说明弹窗（左侧）
        this._showRulePanel();

        // 更新UI
        this._subscribeParty();
        this._renderMemberBar(player);
        this._showMessage('出征时将自动从背包或仓库消耗对应等级钥匙');

    },

    // 关闭出征准备面板
    close() {
        if (!UIState.isOpen('expedition')) return;
        UIState.close('expedition');
        this._isOpen = false;

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
        if (!this.isDungeonUnlocked(value)) {
            this._showMessage(this._getDungeonLockMessage(value), 'error');
            const select = getElement('expeditionDungeonSelect');
            if (select) select.value = this.selectedDungeon || this._getFirstUnlockedDungeon() || '';
            return;
        }
        this.selectedDungeon = value;
        this._updateDungeonInfo(value);
        this._updateRulePanelCurrent();
    },

    isDungeonUnlocked(dungeonType) {
        const required = DungeonConfig.getDungeonUnlockRequirement(dungeonType);
        return !required || WorldProgressionSystem.hasCompletedDungeon(required);
    },

    _getDungeonLockMessage(dungeonType) {
        const list = DungeonConfig.getDungeonList();
        const required = DungeonConfig.getDungeonUnlockRequirement(dungeonType);
        const currentName = list[dungeonType]?.name || dungeonType;
        const requiredName = list[required]?.name || required;
        return required ? `需先通关${requiredName}，才能解锁${currentName}` : '';
    },

    _refreshDungeonOptions() {
        const select = getElement('expeditionDungeonSelect');
        if (!select) return;
        const list = DungeonConfig.getDungeonList();
        select.querySelectorAll('option').forEach((option) => {
            const required = DungeonConfig.getDungeonUnlockRequirement(option.value);
            const locked = !this.isDungeonUnlocked(option.value);
            const baseLabel = option.dataset.baseLabel || list[option.value]?.name || option.value;
            option.disabled = locked;
            option.textContent = locked
                ? `${baseLabel}（未解锁：先通关${list[required]?.name || required}）`
                : baseLabel;
            option.title = locked ? this._getDungeonLockMessage(option.value) : '';
        });
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
        if (isDungeonKeyCostIgnored()) return true;
        const backpack = EquipManager.backpackItems || [];
        const bpIndex = backpack.findIndex((item) => isDungeonKeyItem(item, grade));
        if (bpIndex >= 0) {
            const item = backpack[bpIndex];
            if ((item.stack || 1) > 1) item.stack -= 1;
            else backpack.splice(bpIndex, 1);
            EquipManager.updateInventorySlots?.();
            return true;
        }
        return WarehouseSystem.consumeMaterial((item) => isDungeonKeyItem(item, grade), 1) === 1;
    },

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
    },

    _hideRulePanel() {
        const panel = getElement('expeditionRulePanel');
        if (panel) panel.style.display = 'none';
    },

    _buildRulePanel() {
        if (getElement('expeditionRulePanel')) return;
        const panel = document.createElement('div');
        panel.id = 'expeditionRulePanel';
        panel.className = 'expedition-rule-panel';
        const rows = GRADE_ORDER.map((g, i) => {
            const rarity = RARITY_ORDER[i];
            const color = RARITY_COLORS[rarity] || '#c0c0c0';
            // 推荐等级段（与经验系统 bands 同源：combat-formulas enemy.expValue.bands）
            const expCfg = COMBAT_FORMULAS.enemy?.expValue || {};
            const band = (expCfg.bands || {})[g];
            const bandText = band ? ` · 推荐Lv.${band[0]}~${band[1] - 1}` : '';
            // 衰减预警：玩家等级超该档锚定等级+宽限 → 标红（防误刷低级本）
            const playerLv = (typeof Game !== 'undefined' && Game.player && Game.player.data && Game.player.data.level) || 1;
            const anchor = (expCfg.anchors || {})[g] ?? 3;
            const grace = expCfg.decay?.graceLevels ?? 5;
            const decayText = (playerLv - anchor > grace) ? ' <b style="color:#c0392b">⚠经验衰减</b>' : '';
            const key = getDungeonKeyRequirement(g);
            return `<div class="rule-item" style="color:${color}">${g} 级地牢 — ${key.name}${bandText}${decayText}</div>`;
        }).join('');
        panel.innerHTML = `
            <div class="rule-title">⚠ 出征条件</div>
            <div class="rule-desc" id="expeditionKeyRuleDescription"></div>
            ${rows}
            <div class="rule-current" id="expeditionRuleCurrent"></div>
            <div class="rule-rewards" id="expeditionRuleRewards"></div>
        `;
        document.body.appendChild(panel);
    },

    /** 更新说明弹窗中的当前需求高亮 */
    _updateRulePanelCurrent() {
        const el = getElement('expeditionRuleCurrent');
        if (!el) return;
        const ignoreKeyCost = isDungeonKeyCostIgnored();
        const description = getElement('expeditionKeyRuleDescription');
        if (description) description.textContent = ignoreKeyCost
            ? '开发调试：进入地牢无需持有或消耗钥匙，地牢解锁条件仍生效。以下为正常模式对应钥匙：'
            : '进入地牢会自动检测并消耗背包或仓库中的对应等级钥匙：';
        const list = DungeonConfig.getDungeonList();
        const d = list[this.selectedDungeon] || {};
        const grade = d.grade || 'F';
        const rarity = RARITY_ORDER[Math.max(0, GRADE_ORDER.indexOf(grade))] || 'common';
        const color = RARITY_COLORS[rarity] || '#c0c0c0';
        const key = getDungeonKeyRequirement(grade);
        const keyCount = ignoreKeyCost ? 0 : this._getKeyCount(grade);
        const band = (COMBAT_FORMULAS.enemy?.expValue?.bands || {})[grade];
        const bandText = band ? ` · 推荐等级 Lv.${band[0]}~${band[1] - 1}` : '';
        const keyRequirement = ignoreKeyCost
            ? '开发调试：免钥匙进入，不检查或消耗代币'
            : `需要 <b style="color:${color}">${key.name} ×1</b> · 持有 <b style="color:${keyCount > 0 ? '#7affc8' : '#ff6b6b'}">${keyCount}</b>`;
        el.innerHTML = `当前：<b style="color:#d4c5a9">${d.name || this.selectedDungeon}（${grade} 级）</b> ${keyRequirement}${bandText}`;
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
        if (levelEl) levelEl.textContent = d.level || '';
        if (rewardEl) rewardEl.textContent = d.reward || '';
    },

    // 确认出征 — 自动从背包优先、仓库其次消耗对应等级钥匙
    async depart() {
        if (SceneManager?.isLoading) return;
        const dungeonType = this.selectedDungeon || 'zombieBeginner';
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
        const dungeonEnemyTypes = resolveDungeonEnemyPreloadTypes(dungeonType);
        SceneManager?.showLoadingScreen?.({ sceneId: 'scene7', dungeonType });
        SceneManager?.setProgress?.(10);
        // 先让浏览器绘制 loading，再执行地牢资源预载。
        if (SceneManager?.delay) await SceneManager.delay(50);

        // 入场只校验整个生态的资源登记；贴图由战斗系统按实际波次加载并驻留。
        // 这样仍能在扣钥匙前拦截配置缺失，又不会把所有候选怪物一次上传到显存。
        try {
            RuntimeAssetManager.validateEnemyTypes(dungeonEnemyTypes, { required: true });
            RuntimeAssetManager.setDungeonEnemyTypes([]);
            SceneManager?.setProgress?.(45);
        } catch (error) {
            RuntimeAssetManager.setDungeonEnemyTypes([]);
            SceneManager?.hideLoadingScreen?.();
            console.error('[ExpeditionSystem] 地牢怪物资源登记校验失败:', dungeonType, error);
            const detail = error?.message || '未知资源登记错误';
            this._showMessage(`地牢怪物资源登记失败：${detail}（未消耗钥匙）`, 'error');
            return;
        }
        // loading 的异步等待后重新读取开关，提示与此刻实际扣费行为保持一致。
        const ignoreKeyCost = isDungeonKeyCostIgnored();
        if (!this._consumeDungeonKey(grade)) {
            RuntimeAssetManager.setDungeonEnemyTypes([]);
            SceneManager?.hideLoadingScreen?.();
            this._showMessage(`${key.name} 消耗失败，请重试`, 'error');
            this._updateRulePanelCurrent();
            return;
        }

        this._showMessage(ignoreKeyCost
            ? '开发调试：免钥匙进入地牢，未消耗代币，准备出征...'
            : `${key.name} 已消耗，准备出征...`, 'success');

        // 关闭面板和覆盖层
        this._isOpen = false;
        const panel = getElement('expeditionPanel');
        if (panel) panel.classList.remove('active');
        const overlay = getElement('expeditionOverlay');
        if (overlay) overlay.classList.remove('active');
        UIState.close('expedition');
        this._hideRulePanel(); // 出征后左侧条件栏一并隐藏（面板清理完整还原）
        document.body.classList.remove('expedition-preparing');

        SceneManager?.setProgress?.(55);

        // 初始化地牢（传入选中的地牢类型）+ 切换场景状态到 scene7
        if (DungeonMapSystem) {
            const player = Game.player;

            // 仅允许在主神空间现场保存主场景快照。正常流程已由 main -> scene7 的
            // switchScene 保存过一次；若此处处于出征准备场景仍重复保存，会用 scene7
            // 的精简实体覆盖主神空间，导致资源失败或撤离后返回到错误空间。
            if (SceneManager?.currentScene === 'main'
                && typeof SceneManager._saveMainSceneState === 'function') {
                SceneManager._saveMainSceneState();
            }
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

            DungeonMapSystem.init('scene7', player, dungeonType);
            SceneManager.currentScene = 'scene7';
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
        }
        if (SceneManager?.waitForMinimumLoadingDuration) {
            await SceneManager.waitForMinimumLoadingDuration();
        }
        SceneManager?.setProgress?.(100);
        if (SceneManager?.delay) await SceneManager.delay(100);
        SceneManager?.hideLoadingScreen?.();
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
