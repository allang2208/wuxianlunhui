import { GameSaveStorage } from '../systems/game-save-storage.js';
import { MailStore } from '../systems/mail-store.js';
import { Game } from '../game.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { EffectManager } from '../effects/effect-manager.js';
import { queryAllElements, getElementIfExists } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { CONFIG } from '../config/config.js';
import { EquipManager } from './equip-manager.js';
import { UI_DATA_CONFIG } from './system-ui.js';
import { getTributeHpRegenMultiplier, getTributeHpRegenFlat } from '../config/tribute-effects.js';
import { completeWeaponFields } from './equip-data-manager.js';
import { serializeUnitUpgrades, restoreUnitUpgrades } from '../world/unit-upgrade-store.js';
import { serializeAbilityLevels, restoreAbilityLevels } from '../world/ability-store.js';
import { ResearchSystem } from '../world/research-system.js';
import { GoldManager } from '../systems/gold-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { World122TributeSystem } from '../world/world122-tribute-system.js';
import {
    serializeWorld122Scene,
    restoreWorld122Scene,
    serializeWorldScenes,
    restoreWorldScenes,
    reconcileWorldContinuousUpgrades,
} from '../world/world122-snapshot.js';
import { EnvironmentLightingSystem } from '../world/environment-lighting-system.js';
import { TroopLineSystem } from '../world/troop-line-system.js';
import { WorldStrategySystem } from '../world/world-strategy-system.js';
import { applyWorldMap, prepareWorldMap, serializeWorldMap } from '../world/world-map-cells.js';
import { PartySystem } from '../systems/party-system.js';
import { TechnologySystem } from '../world/technology-system.js';
import { WarehouseSystem } from './warehouse-system.js';
import { QuestStore } from '../quest/quest-store.js';
import { MilitaryPopulationSystem } from '../world/military-population-system.js';
import { EconomyHudSystem } from '../world/economy-hud-system.js';
import { EconomyFlowSystem, ECONOMY_RESOURCES } from '../world/economy-flow-system.js';
import { isGunWeapon } from '../config/gun-ammo.js';

function getDisplayAttackKey(item) {
    if (item?.attackKey) return item.attackKey;
    if (item?.weaponType === 'pistol' || item?.rangedType === 'pistol') return 'pistol';
    if (item?.weaponType === 'shotgun') return 'super90';
    if (isGunWeapon(item)) return item.weaponType || 'pistol';
    return item?.weaponType === 'bow' ? 'ranged' : 'melee';
}

// Game UI Manager - Extracted from Game.js
// Handles UI updates, save/load, timers, and menu operations

const TIMELINE_PROGRESS_COLORS = [
    { at: 0, rgb: [61, 196, 91] },
    { at: 1 / 3, rgb: [65, 139, 231] },
    { at: 2 / 3, rgb: [241, 193, 63] },
    { at: 1, rgb: [229, 65, 62] },
];

function timelineProgressColor(value) {
    const progress = Math.max(0, Math.min(1, Number(value) || 0));
    const upperIndex = TIMELINE_PROGRESS_COLORS.findIndex((stop) => progress <= stop.at);
    const upper = TIMELINE_PROGRESS_COLORS[Math.max(1, upperIndex)];
    const lower = TIMELINE_PROGRESS_COLORS[Math.max(0, upperIndex - 1)];
    const span = Math.max(Number.EPSILON, upper.at - lower.at);
    const t = Math.max(0, Math.min(1, (progress - lower.at) / span));
    const rgb = lower.rgb.map((channel, index) =>
        Math.round(channel + (upper.rgb[index] - channel) * t));
    return `rgb(${rgb.join(', ')})`;
}

function assignTimelineEventLanes(events, minimumGap = 0.14) {
    const lastPositionByLane = [-Infinity, -Infinity];
    return events.map((event) => {
        const position = Math.max(0, Math.min(1, Number(event.position) || 0));
        let lane = lastPositionByLane.findIndex((lastPosition) =>
            position - lastPosition >= minimumGap);
        if (lane < 0) lane = lastPositionByLane[0] <= lastPositionByLane[1] ? 0 : 1;
        lastPositionByLane[lane] = position;
        return lane;
    });
}

function clusterTimelineEvents(events, maximumPositionGap = 0.08) {
    const groups = [];
    for (const event of events) {
        const position = Math.max(0, Math.min(1, Number(event.position) || 0));
        const current = groups[groups.length - 1];
        if (!current || position - current.anchorPosition > maximumPositionGap) {
            groups.push({ anchorPosition: position, events: [event] });
        } else {
            current.events.push(event);
        }
    }
    return groups.flatMap((group) => {
        if (group.events.length <= 2) return group.events;
        const ids = group.events.map((event) => event.id).sort();
        const position = group.events.reduce((sum, event) =>
            sum + Math.max(0, Math.min(1, Number(event.position) || 0)), 0) / group.events.length;
        const timeLabels = new Set(group.events.map((event) => event.timeLabel));
        return [{
            id: `cluster:${ids.join('|')}`,
            type: 'cluster',
            typeLabel: '事件簇',
            label: `${group.events.length}个同期事件`,
            timeLabel: timeLabels.size === 1 ? group.events[0].timeLabel : '同一时段',
            position,
            status: group.events.some((event) => event.status === 'active') ? 'active' : 'upcoming',
            clusterEvents: group.events,
        }];
    });
}

function closeTimelinePopover() {
    const popover = getElementIfExists('worldTimelinePopover');
    if (!popover) return;
    popover.hidden = true;
    popover.removeAttribute('data-source-id');
}

function prepareTimelinePopover(sourceId, title) {
    const popover = getElementIfExists('worldTimelinePopover');
    const heading = getElementIfExists('worldTimelinePopoverTitle');
    const content = getElementIfExists('worldTimelinePopoverContent');
    if (!popover || !heading || !content) return null;
    if (!popover.hidden && popover.dataset.sourceId === sourceId) {
        closeTimelinePopover();
        return null;
    }
    popover.dataset.sourceId = sourceId;
    heading.textContent = title;
    content.replaceChildren();
    popover.hidden = false;
    return content;
}

function appendTimelineEventIcon(container, event) {
    const icon = document.createElement('span');
    icon.className = 'world-timeline-list-icon';
    if (event.iconPath) {
        const image = document.createElement('img');
        image.src = event.iconPath;
        image.alt = '';
        image.draggable = false;
        image.addEventListener('error', () => {
            image.remove();
            icon.textContent = event.icon || '◆';
        }, { once: true });
        icon.appendChild(image);
    } else {
        icon.textContent = event.icon || '◆';
    }
    container.appendChild(icon);
}

function appendTimelineDetailRow(container, label, value) {
    const row = document.createElement('div');
    row.className = 'world-timeline-detail-row';
    const name = document.createElement('span');
    name.textContent = label;
    const detail = document.createElement('strong');
    detail.textContent = value || '—';
    row.append(name, detail);
    container.appendChild(row);
}

function timelineEventHoverCopy(event) {
    const activeLabel = event.status === 'active' ? '正在发生' : '即将发生';
    if (Array.isArray(event.clusterEvents)) {
        const typeLabels = [...new Set(event.clusterEvents.map((child) =>
            child.typeLabel || child.type || '事件'))];
        return {
            title: event.label,
            meta: `${event.clusterEvents.length}个事件 · ${typeLabels.join(' / ')}`,
            timing: event.timeLabel,
            hint: '点击展开完整事件列表',
        };
    }
    if (event.type === 'weather') {
        const timing = event.startsAtLabel && event.endsAtLabel
            ? `${event.startsAtLabel} 至 ${event.endsAtLabel}`
            : event.timeLabel;
        const detailParts = [
            event.worldName || event.sceneId || '未知位面',
            event.intensityName || event.intensityId || '降雨',
            event.durationLabel ? `持续 ${event.durationLabel}` : '',
            event.warningLabel || '',
        ].filter(Boolean);
        return {
            title: event.label,
            meta: detailParts.join(' · '),
            timing,
            hint: `${activeLabel} · 点击查看完整预报`,
        };
    }
    return {
        title: event.label,
        meta: `${event.typeLabel || event.type || '事件'} · ${activeLabel}`,
        timing: event.timeLabel,
        hint: event.status === 'active' ? '事件已经触发' : '当前游标抵达竖线时触发',
    };
}

function appendTimelineHoverTooltip(marker, copy) {
    const tooltip = document.createElement('span');
    tooltip.className = 'world-timeline-event-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.textContent = copy.title;
    const meta = document.createElement('span');
    meta.className = 'world-timeline-event-tooltip-meta';
    meta.textContent = copy.meta;
    const timing = document.createElement('span');
    timing.textContent = copy.timing;
    const hint = document.createElement('small');
    hint.textContent = copy.hint;
    tooltip.append(title, meta, timing, hint);
    marker.appendChild(tooltip);
}

function openWeatherTimelineDetail(event) {
    const content = prepareTimelinePopover(`weather:${event.id}`, '天气预报详情');
    if (!content) return;
    const summary = document.createElement('div');
    summary.className = 'world-timeline-detail-summary';
    appendTimelineEventIcon(summary, event);
    const summaryText = document.createElement('span');
    summaryText.textContent = event.label;
    summary.appendChild(summaryText);
    content.appendChild(summary);
    const rows = document.createElement('div');
    rows.className = 'world-timeline-detail-grid';
    appendTimelineDetailRow(rows, '位面', event.worldName || event.sceneId || '未知位面');
    appendTimelineDetailRow(rows, '强度', event.intensityName || event.intensityId || '降雨');
    appendTimelineDetailRow(rows, '开始', event.startsAtLabel);
    appendTimelineDetailRow(rows, '结束', event.endsAtLabel);
    appendTimelineDetailRow(rows, '持续', event.durationLabel);
    appendTimelineDetailRow(rows,
        event.weatherKind === 'special' ? '灾害预警' : '强度提示',
        event.warningLabel);
    appendTimelineDetailRow(rows, '状态', event.status === 'active' ? '正在发生' : '预测中');
    content.appendChild(rows);
}

function openTimelineCluster(cluster) {
    const content = prepareTimelinePopover(cluster.id, `${cluster.clusterEvents.length}个同期事件`);
    if (!content) return;
    const list = document.createElement('div');
    list.className = 'world-timeline-cluster-list';
    cluster.clusterEvents.forEach((event) => {
        const interactive = event.type === 'weather';
        const item = document.createElement(interactive ? 'button' : 'div');
        item.className = `world-timeline-cluster-item is-${event.type || 'generic'}`;
        if (interactive) {
            item.type = 'button';
            item.addEventListener('click', () => openWeatherTimelineDetail(event));
        }
        appendTimelineEventIcon(item, event);
        const text = document.createElement('span');
        text.className = 'world-timeline-cluster-item-text';
        const label = document.createElement('strong');
        label.textContent = event.label;
        const time = document.createElement('small');
        time.textContent = `${event.typeLabel} · ${event.timeLabel}`;
        text.append(label, time);
        item.appendChild(text);
        list.appendChild(item);
    });
    content.appendChild(list);
}

// 统计只跟随当前现场与游戏时钟；战略地图/切场期间不把后台入账算成本地产出。
EconomyFlowSystem.setContextProvider(() => ({
    key: `${globalThis.SceneManager?.currentScene || ''}:${EconomyHudSystem.getPopulationSnapshot().viewRevision}`,
    timeMs: EnvironmentLightingSystem.serializeTime().elapsedMs,
    enabled: Game.isRunning && !globalThis.SceneManager?.isLoading
        && !WorldStrategySystem.inMap && !WorldStrategySystem._busy,
}));

export const GameUIManager = {
    player: null,
    showAttackRange: false,
    _timelineFilterType: 'all',
    _economyRateSamples: [],
    _economyRates: { gold: 0, energy: 0, food: 0 },
    _economyStorageSignature: '',

    init(player) {
        this.player = player;
        // 简版 HUD 恢复为 DOM 显示：检测到顶部栏存在即视为 DOM HUD 可用
        this._domSimpleHudAvailable = !!getElementIfExists('topBar');
    },

    updateEquipmentUI() {
        // 装备UI更新已由 updateUI 统一处理
        // 此方法保持兼容性，供外部调用
        this.updateUI();
    },

    initAttackRangeToggle() {
        queryAllElements('.attack-range-toggle').forEach(btn => {
            btn.onclick = () => {
                this.showAttackRange = !this.showAttackRange;
                if (Game) Game.showAttackRange = this.showAttackRange;
                queryAllElements('.attack-range-toggle').forEach(b => b.classList.toggle('active', this.showAttackRange));
            };
        });
    },
    updateUI() {
        if (!this.player) return;
        this.refreshGameTime();
        const d = this.player.data, p = this.player;
        // 简版 HUD 已迁移到 Phaser：若 DOM 简单 HUD 存在才更新，否则跳过
        if (this._domSimpleHudAvailable) {
            // 数据驱动更新顶部栏
            UI_DATA_CONFIG.topBar.forEach(item => {
                const el = getElementIfExists(item.id);
                if (el) el.textContent = item.getValue(p);
            });
            // 数据驱动更新顶部状态栏 (HP/MP)
            UI_DATA_CONFIG.topStatus.forEach(item => {
                const bar = getElementIfExists(item.barId);
                const val = getElementIfExists(item.valId);
                if (bar) bar.style.width = item.getPercent(d);
                if (val) val.textContent = item.getValue(d);
            });

            // 攻击冷却指示器
        const currentItem = p.equipments[p.weaponMode];
        const currentAttack = p.attacks[getDisplayAttackKey(currentItem)] || p.attacks.melee;
        const attackCD = currentAttack.getCooldownPercent();
        const cdOverlay = getElementIfExists('cdAttackOverlay');
        if (cdOverlay) cdOverlay.style.height = (attackCD * 100) + '%';
        const cdAttack = getElementIfExists('cdAttack');
        if (cdAttack) cdAttack.classList.toggle('ready', attackCD <= 0);
        let attackIcon = '⚔';
        if (currentItem) {
            if (isGunWeapon(currentItem)) attackIcon = '🔫';
            else if (currentItem.weaponType === 'bow') attackIcon = '🏹';
        }
        const attackLabel = p.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
        if (cdAttack && cdAttack.childNodes[0]) cdAttack.childNodes[0].textContent = attackIcon;
        const attackLabelEl = getElementIfExists('attackLabel');
        if (attackLabelEl) attackLabelEl.textContent = attackLabel;
        // 武器信息显示
        const weaponModeEl = getElementIfExists('weaponMode'), weaponNameEl = getElementIfExists('weaponName');
        if (weaponModeEl) weaponModeEl.textContent = p.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
        // 武器栏指示器（红色边框表示当前使用的武器栏）
        if (weaponModeEl) {
            weaponModeEl.style.color = p.weaponMode === 'weapon' ? '#7a9a6a' : '#7a8aaa';
            weaponModeEl.style.fontWeight = '700';
        }
        if (weaponNameEl) {
            const weaponItem = p.equipments[p.weaponMode];
            weaponNameEl.textContent = weaponItem ? weaponItem.name : '空手';
        }
        // 经验值条（屏幕底部金色细线）
            const expBar = getElementIfExists('expBar');
            if (expBar) {
                const expPercent = d.maxExp ? (d.exp / d.maxExp * 100) : 0;
                expBar.style.width = Math.min(100, expPercent) + '%';
            }
        }

        // 头部信息（面板可能未打开，使用静默查询避免警告）
        const charNameEl = getElementIfExists('charName');
        const charClassEl = getElementIfExists('charClass');
        const charLevelEl = getElementIfExists('charLevel');
        if (charNameEl) charNameEl.textContent = d.name;
        if (charClassEl) charClassEl.textContent = d.class;
        if (charLevelEl) charLevelEl.textContent = 'Lv.' + d.level;
        // 显示属性点
        const attrPointsEl = getElementIfExists('attrPoints');
        if (attrPointsEl) attrPointsEl.textContent = '属性点: ' + d.attrPoints;
        // 显示/隐藏属性加号按钮
        const attrPlusBtns = queryAllElements('.attr-plus');
        attrPlusBtns.forEach(btn => {
            btn.style.display = (d.attrPoints > 0) ? 'inline-flex' : 'none';
        });
        // 显示/隐藏右侧属性点按钮
        const addPointBtn = getElementIfExists('addPointBtn');
        if (addPointBtn) {
            addPointBtn.classList.toggle('hidden', d.attrPoints <= 0);
        }
        UI_DATA_CONFIG.statusPage.bars.forEach(item => {
            const bar = getElementIfExists(item.barId);
            const val = getElementIfExists(item.valId);
            if (bar) bar.style.width = item.getPercent(d);
            if (val) val.textContent = item.getValue(d);
        });
        UI_DATA_CONFIG.statusPage.baseAttrs.forEach(item => {
            const el = getElementIfExists(item.id);
            if (el) el.textContent = d[item.key];
        });
        UI_DATA_CONFIG.statusPage.combatAttrs.forEach(item => {
            const el = getElementIfExists(item.id);
            if (!el) return;
            if (item.id === 'combatAtk') {
                // 物理攻击：从当前武器实时计算
                el.textContent = p.getCurrentWeaponAtk();
            } else if (item.id === 'combatCrit') {
                // 暴击率：基础值 + 武器加成 + 暴击技能加成
                const baseCrit = p.data.crit || 0;
                const currentWpn = p.equipments[p.weaponMode];
                let weaponCrit = 0;
                if (currentWpn && currentWpn.stats) {
                    const critStat = currentWpn.stats.find(s => (s.name || s.label) === '暴击率');
                    if (critStat && critStat.value) {
                        const match = String(critStat.value).match(/\d+/);
                        if (match) weaponCrit = parseInt(match[0]);
                    }
                }
                el.textContent = (baseCrit + weaponCrit) + '%';
            } else if (item.id === 'combatCritRes') {
                // 暴击抵抗：每1点体质增加1%
                el.textContent = (d.critRes || 0) + '%';
            } else if (item.id === 'combatAspd') {
                // 攻击间隔：根据当前武器显示实际毫秒数
                const currentWpn = p.equipments[p.weaponMode];
                const attackKey = getDisplayAttackKey(currentWpn);
                const attack = p.attacks[attackKey] || p.attacks.melee;
                const cd = isGunWeapon(currentWpn) && p._getEffectiveGunAttackInterval
                    ? p._getEffectiveGunAttackInterval(currentWpn, attackKey) : attack.maxCooldown;
                el.textContent = Math.round(cd) + 'ms';
            } else if (item.id === 'combatSpd') {
                // 移动速度：使用实际最大移动速度（px/s）
                const speed = p.maxSpeed || p.data.speed || 0;
                el.textContent = speed.toFixed(0) + 'px/s';
            } else {
                el.textContent = item.suffix ? d[item.key] + item.suffix : (item.fixed ? d[item.key].toFixed(item.fixed) : d[item.key]);
            }
        });
        UI_DATA_CONFIG.statusPage.loopInfo.forEach(item => {
            const el = getElementIfExists(item.id);
            if (el) el.textContent = d[item.key];
        });
        // 详细属性渲染
        UI_DATA_CONFIG.statusPage.detailAttrs.forEach(item => {
            const el = getElementIfExists(item.id);
            if (!el) return;
            const currentWpn = p.equipments[p.weaponMode];
            const pa = p.attacks[getDisplayAttackKey(currentWpn)] || p.attacks.melee;
            switch (item.id) {
                case 'detailStaminaRegen': {
                    const staminaBase = CONFIG.STAMINA_REGEN || 1;
                    const mul = p._staminaRegenMul || 1;
                    el.textContent = (staminaBase * mul).toFixed(2) + item.unit;
                    break;
                }
                case 'detailHpRegen': {
                    // 与实战同口径：固定加值（麦穗 hpRegenFlat）后再乘祭品恢复百分比
                    const regen = ((d.hpRegen || 0) + getTributeHpRegenFlat()) * getTributeHpRegenMultiplier();
                    el.textContent = (Math.round(regen * 100) / 100) + item.unit;
                    break;
                }
                case 'detailMpRegen': el.textContent = `${Math.round((d.mpRegen || 0) * 100) / 100}/秒`; break;
                case 'detailCollisionRadius': el.textContent = (p.collisionRadius || 10) + item.unit; break;
                case 'detailMoveSpeed': {
                    const speed = p.maxSpeed || CONFIG.PLAYER_SPEED || 0;
                    el.textContent = speed.toFixed(0) + item.unit;
                    break;
                }
                case 'detailDodgeCooldown': el.textContent = CONFIG.DODGE_COOLDOWN + item.unit; break;
                case 'detailAttackRange': {
                    let displayRange = pa ? pa.config.range : 100;
                    if (currentWpn && (currentWpn.weaponType === 'sword' || currentWpn.category === 'weapon_melee')) {
                        const hitBox = WeaponAnimConfig.sword.hitBox;
                        const configuredRange = currentWpn.attack && currentWpn.attack.range;
                        const explicitBonus = currentWpn.attack && currentWpn.attack.rangeBonus;
                        let baseRange = typeof configuredRange === 'number'
                            ? configuredRange + (typeof explicitBonus === 'number' ? explicitBonus : 0)
                            : (hitBox ? hitBox.forwardRange : 155) + (typeof explicitBonus === 'number' ? explicitBonus : 50);
                        if (currentWpn._craftEffects && currentWpn._craftEffects.rangeDelta) {
                            baseRange += currentWpn._craftEffects.rangeDelta;
                        }
                        baseRange = Math.max(baseRange, Number(hitBox?.minimumBaseRange) || 0);
                        const stageKeys = ['attack', 'attack2', 'attack3'];
                        displayRange = stageKeys.map(key => {
                            const mul = WeaponAnimConfig.sword[key]?.hitCheck?.rangeMul;
                            return Math.round(baseRange * (typeof mul === 'number' ? mul : 1));
                        }).join('/');
                    }
                    el.textContent = displayRange + item.unit;
                    break;
                }
                case 'detailKnockback': el.textContent = (pa ? pa.config.knockback : 20) + item.unit; break;
                case 'detailViewRange': el.textContent = CONFIG.VIEW_WIDTH + item.unit; break;
            }
        });
    },
    async load() {
        if (this._saveBusy || this._loadBusy) return;
        if (window.DungeonMapSystem?.active || MailStore.run?.status === 'active') {
            alert('请先结束地牢探险再读档；本版本不支持地牢断点续玩');
            return;
        }
        if (this.player?.shieldSystem?.hasCausalDebt?.()) {
            alert('逆命劫债尚未结清，不能直接读档清除；请先完成偿还或通过换盾立即结算');
            return;
        }
        if (window.SceneManager?.isLoading || WorldStrategySystem._busy || WorldStrategySystem.inBattle) {
            alert('请在场景加载完成、遭遇战结束后读档');
            return;
        }
        this._loadBusy = true;
        let strategyLoadLock = false;
        const wasStrategic = WorldStrategySystem.active;
        try {
        let data;
        let restoredMail;
        let restoredMap;
        try {
            data = await GameSaveStorage.read();
            if (!data) { alert('没有找到存档'); return; }
            restoredMail = MailStore.prepareRestore(data.mailbox);
            restoredMap = prepareWorldMap(data.worlds?.map);
            if (window.DungeonMapSystem?.active || window.SceneManager?.isLoading || WorldStrategySystem.inBattle) {
                throw new Error('读取期间场景状态已变化，请在场景稳定后重试');
            }
        } catch (error) {
            console.error('Load failed:', error);
            alert(`读档失败，当前地图、进度、背包与信箱未被替换：${error.message || '存档损坏'}`);
            return;
        }
        window.MailboxPanel?.reset();
        if (!this.player) return;
        const { SceneManager } = await import('../world/scene-manager.js');
        const currentWorldId = SceneManager.getCurrentWorldId?.() || SceneManager.currentScene;
        const currentWorldConfig = window.WorldProgressionSystem?.getWorldConfig?.(currentWorldId);
        const inWorldInstance = String(currentWorldId || '').startsWith('world-instance:');
        if (inWorldInstance || currentWorldConfig?.templatePreviewOnly) {
            const switched = await SceneManager.switchScene('main', this.player);
            if (switched !== true) {
                alert('读档前无法安全退出当前位面，请返回主神空间后重试');
                return;
            }
        }
        const positionBeforeLoad = { x: this.player.x, y: this.player.y };
        if (data.worlds?.strategy?.army && (SceneManager.isDungeonRunActive() || SceneManager.isQuestInstance())) {
            alert('请先结束当前地牢或调查，再读取亲征军团存档');
            return;
        }
        // 地图是位面、据点、路线和军团恢复的权威前置。
        WorldStrategySystem._busy = true;
        strategyLoadLock = true;
        WorldStrategySystem._resetMarchScheduler();
        applyWorldMap(restoredMap);
        const requestedWorldId = typeof data.worlds?.currentWorldId === 'string'
            ? data.worlds.currentWorldId : null;
        // 玩家落点要等位面注册表和目标场景恢复后再应用，避免把实例坐标写进主神空间。
        if (data.player) Object.assign(this.player.data, data.player);
        EnvironmentLightingSystem.restoreTime(data.gameTime);
        // 位面注册表必须先于进度、天气和快照恢复；这些系统都需要用实例ID解析模板。
        window.WorldInstanceSystem?.restore?.(data.worlds?.instances);
        window.World122SandstormSystem?.restore?.(data.worlds?.sandstorm ?? data.world122?.sandstorm);
        window.World122DroughtSystem?.restore?.(data.worlds?.drought);
        window.World125FogTideSystem?.restore?.(data.worlds?.fogTide);
        window.World126WeatherSystem?.restore?.(data.worlds?.mineWeather);
        window.WorldWeatherSystem?.restore?.(data.worlds?.weather);
        // 恢复装备与背包（附魔/强化/改造数据随物品一并恢复）
        if (data.equipments) this.player.equipments = data.equipments;
        restoreUnitUpgrades(data.world122?.unitUpgrades);
        restoreAbilityLevels(data.world122?.abilityLevels);
        const savedScenes = data.worlds?.scenes;
        const expeditionSnapshots = [data.world122?.scene,
            ...(Array.isArray(savedScenes?.structures) ? [savedScenes] : Object.values(savedScenes || {}))];
        const legacyExpeditionEstablished = !!data.worlds?.strategy?.army
            || expeditionSnapshots.some((snapshot) => Array.isArray(snapshot?.structures)
                && snapshot.structures.some((structure) => structure?.kind === 'producer'
                    && structure.cfgKey === 'expedition_camp'));
        const savedTechnology = data.technologyTree;
        const savedTouchedTechnologyIds = new Set([
            ...(savedTechnology?.completed || []),
            ...(savedTechnology?.researchQueue || []),
            ...Object.entries(savedTechnology?.progressById || {})
                .filter(([, progress]) => Number(progress) > 0).map(([id]) => id),
            savedTechnology?.activeTechId,
            savedTechnology?.targetTechId,
        ].filter(Boolean));
        const legacyCapturedWorldIds = TechnologySystem.getPlaneResearchNodes()
            .filter((node) => !savedTechnology || savedTouchedTechnologyIds.has(node.id))
            .map((node) => node.requiredWorldId)
            .filter(Boolean);
        WarehouseSystem.restore(data.warehouseStorage || { pageCount: 5, items: [] });
        MailStore.restorePrepared(restoredMail);
        QuestStore.restore(data.quests);
        ResearchSystem.refreshWorld();
        EnergyManager.restoreStorage(data.world122?.energyStorage);
        World122TributeSystem.restore(data.world122?.tributeBuffs);
        if (data.worlds?.scenes) restoreWorldScenes(data.worlds.scenes);
        else restoreWorld122Scene(data.world122?.scene);
        window.WorldProgressionSystem?.setStrategicSiteCells?.(data.worlds?.strategy?.sites || []);
        window.WorldProgressionSystem?.restore?.(data.worlds?.progression);
        // 旧档只要已经触碰过位面科技，就视为早已取得对应特色建筑控制权。
        // 新版存档以自己的事件状态为准，不能再从科技结果反向覆盖。
        if (!data.worlds?.progression?.specialBuildingEvents) {
            window.WorldProgressionSystem?.grandfatherSpecialBuildingEvents?.(legacyCapturedWorldIds);
        }
        // 科技恢复必须晚于事件进度，否则合法的位面研究会被未就绪门槛移出队列。
        TechnologySystem.restore(savedTechnology, {
            legacyUnlockAll: !savedTechnology,
            legacyExpeditionEstablished,
        });
        TechnologySystem.notifyWorldRequirementChanged('world-special-building-restore');
        window.WorldProgressionSystem?.ensureConstructedWorldSnapshots?.();
        reconcileWorldContinuousUpgrades();
        PartySystem.restoreState(data.party);
        TroopLineSystem.restore(data.worlds?.troopLines, {
            deferSceneEntry: !!data.worlds?.strategy?.army || wasStrategic,
        });
        window.WorldInvasionSystem?.restore?.(data.worlds?.invasion, {
            deferLive: !!data.worlds?.strategy?.army || wasStrategic,
        });
        window.WorldDestructionChallengeSystem?.restore?.(data.worlds?.destructionChallenges);
        if (Array.isArray(data.backpack) && typeof EquipManager !== 'undefined') {
            // 原地替换内容而非换数组：init 时旧数组引用已注入 EquipTooltipManager/
            // GoldManager/BackpackDialogManager/dragDropManager，换数组会让这些引用失效
            if (!EquipManager.backpackItems) EquipManager.backpackItems = [];
            EquipManager.backpackItems.length = 0;
            EquipManager.backpackItems.push(...data.backpack);
            GoldManager.setBackpackRef(EquipManager.backpackItems); // 旧档多格金币合并为单格无限堆叠
            EnergyManager.setBackpackRef(EquipManager.backpackItems); // 迁移旧存档背包能源到待入库
            if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
            if (EquipManager.updateEquipSlots) EquipManager.updateEquipSlots();
        }
        // 旧存档武器统一回归 EquipDataManager 静态定义；强化/改造/附魔等实例状态保留。
        if (this.player.equipments) {
            for (const item of Object.values(this.player.equipments)) completeWeaponFields(item);
        }
        if (typeof EquipManager !== 'undefined' && Array.isArray(EquipManager.backpackItems)) {
            for (const item of EquipManager.backpackItems) completeWeaponFields(item);
        }
        // 旧存档副手迁移：现规则仅允许盾牌/魔法书，枪械、法杖等迁回背包或安全掉落。
        if (typeof EquipManager !== 'undefined' && typeof EquipManager.enforceOffhandRules === 'function') {
            EquipManager.enforceOffhandRules();
        }
        // 重算派生状态（属性/弹药/附魔攻击间隔/技能覆盖）
        if (this.player.calculateCombatStats) this.player.calculateCombatStats();
        if (this.player.updateMaxStats) this.player.updateMaxStats();
        const curWeapon = (this.player.equipments && this.player.weaponMode) ? this.player.equipments[this.player.weaponMode] : null;
        if (this.player._applySkillOverrides) this.player._applySkillOverrides(curWeapon);
        if (this.player._initAmmoForSlot && this.player.weaponMode) this.player._initAmmoForSlot(this.player.weaponMode);
        const restoredWorldPositions = {};
        for (const [worldId, position] of Object.entries(data.worlds?.playerPositions || {})) {
            const mayPersist = worldId === 'main'
                || window.WorldInstanceSystem?.isPersistentInstance?.(worldId);
            if (!mayPersist || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) continue;
            restoredWorldPositions[worldId] = { x: position.x, y: position.y };
        }
        const legacyPosition = data.position
            && Number.isFinite(data.position.x) && Number.isFinite(data.position.y)
            ? { x: data.position.x, y: data.position.y }
            : null;
        const targetWorldExists = requestedWorldId === 'main'
            || window.WorldInstanceSystem?.isPersistentInstance?.(requestedWorldId);
        const targetWorldId = targetWorldExists ? requestedWorldId : 'main';
        if (!restoredWorldPositions[targetWorldId] && legacyPosition) {
            restoredWorldPositions[targetWorldId] = legacyPosition;
        }
        Game._worldPlayerPos = restoredWorldPositions;
        let restoredPersistentWorld = false;
        if (targetWorldId !== 'main') {
            const mainPosition = restoredWorldPositions.main;
            if (mainPosition) {
                this.player.x = mainPosition.x;
                this.player.y = mainPosition.y;
            }
            const switched = await SceneManager.enterWorldInstance(targetWorldId, this.player);
            if (switched !== true) {
                alert('存档数据已恢复，但保存时所在位面无法重新进入，已停留在主神空间');
            } else {
                restoredPersistentWorld = true;
            }
        } else {
            const mainPosition = restoredWorldPositions.main || legacyPosition || positionBeforeLoad;
            this.player.x = mainPosition.x;
            this.player.y = mainPosition.y;
        }
        // 任务实例中的原地读档必须重建裂隙/返回门实体；若存档没有活动会话则安全退回主城。
        // 非任务场景读到活动会话时不强制传送，仍由小鼠侍从入口继续该任务。
        try {
            const restoredQuestId = QuestStore.getActiveQuestId();
            const inQuestInstance = SceneManager.isQuestInstance();
            if (restoredQuestId && !inQuestInstance && !restoredPersistentWorld) {
                // 任务中保存的坐标属于瞬态雪原；在主城/永久世界读档时保留当前落点，等待侍从续接。
                this.player.x = positionBeforeLoad.x;
                this.player.y = positionBeforeLoad.y;
            }
            if (inQuestInstance) {
                let switched = false;
                if (restoredQuestId) {
                    const { QuestState } = await import('./quest-system.js');
                    switched = await QuestState.startQuest(restoredQuestId, { forceReload: true });
                } else {
                    switched = await SceneManager.switchScene('main', this.player);
                }
                if (switched !== true) throw new Error('任务场景读档重建失败');
            }
        } catch (error) {
            WorldStrategySystem._busy = false;
            console.error('[GameUIManager] quest load reconciliation failed:', error);
            alert('读档数据已恢复，但任务场景重建失败，请返回主神空间后重试');
            return;
        }
        if (this.updateUI) this.updateUI();
        try {
            await WorldStrategySystem.restore(data.worlds?.strategy);
        } catch (error) {
            console.error('[WorldStrategy] restore failed', error);
            alert('军团存档已读取，但地图加载失败，请重试读档');
            return;
        }
        alert(`读档成功: ${this.player.data?.name || '未知'} Lv.${this.player.data?.level || 1}`);
        } finally {
            if (strategyLoadLock) WorldStrategySystem._busy = false;
            this._loadBusy = false;
        }
    },
    async save() {
        if (this._saveBusy || this._loadBusy) return;
        if (window.DungeonMapSystem?.active || MailStore.run?.status === 'active') {
            alert('请通关、安全撤离或结束地牢后保存；探险暂存不能脱离本次探险单独存档');
            return;
        }
        if (this.player?.shieldSystem?.hasCausalDebt?.()) {
            alert('逆命劫债尚未结清，不能保存并绕过偿还；请先完成偿还或通过换盾立即结算');
            return;
        }
        if (!this.player) return;
        const sceneManager = globalThis.SceneManager;
        const currentWorldId = sceneManager?.getCurrentWorldId?.() || sceneManager?.currentScene;
        if (window.WorldInstanceSystem?.isDevPreview?.(currentWorldId)
            || window.WorldProgressionSystem?.getWorldConfig?.(currentWorldId)?.templatePreviewOnly) {
            alert('测试位面不写入正式存档，请先返回主神空间');
            return;
        }
        if (sceneManager?.isLoading || WorldStrategySystem._busy || WorldStrategySystem.inBattle) {
            alert('请在遭遇战结算并返回大地图后保存；军团行军中可以保存');
            return;
        }
        const testWorldIds = (window.WorldProgressionSystem?.getWorldIds?.() || [])
            .filter((sceneId) => window.WorldProgressionSystem?.isDevWorldUnlocked?.(sceneId));
        const testWorldIdSet = new Set(testWorldIds);
        // 存档是后台账本的权威边界：先结算到当前时刻，再序列化。
        window.WorldSimDriver?.flushAll?.({ notify: false, reason: 'save' });
        window.WorldInvasionSystem?.settleBackgroundNow?.(null, { includeTest: false });
        window.WorldInvasionSystem?.syncLivePortal?.(true);
        const serializableWorldPositions = {};
        for (const [worldId, position] of Object.entries(Game._worldPlayerPos || {})) {
            const mayPersist = worldId === 'main'
                || window.WorldInstanceSystem?.isPersistentInstance?.(worldId);
            if (!mayPersist || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) continue;
            serializableWorldPositions[worldId] = { x: position.x, y: position.y };
        }
        const persistentCurrentWorldId = currentWorldId === 'main'
            || window.WorldInstanceSystem?.isPersistentInstance?.(currentWorldId)
            ? currentWorldId : null;
        if (persistentCurrentWorldId) {
            serializableWorldPositions[persistentCurrentWorldId] = {
                x: this.player.x,
                y: this.player.y,
            };
        }
        // 存档是后台账本的权威读取边界：先一次性结算连续资源与到期队列，再序列化。
        window.WorldSimDriver?.flushAll?.({ notify: false, reason: 'save' });
        window.WorldInvasionSystem?.settleBackgroundNow?.(null, { includeTest: false });
        window.WorldInvasionSystem?.syncLivePortal?.(true);
        // 劫债不能通过存档冻结或读档清除；序列化前按最终伤害直接结清。
        this.player.shieldSystem?.settleCausalDebt?.('save');
        const saveData = {
            version: '1.0',
            timestamp: Date.now(),
            player: this.player.data,
            position: { x: this.player.x, y: this.player.y },
            gameTime: EnvironmentLightingSystem.serializeTime(),
            technologyTree: TechnologySystem.serialize(),
            warehouseStorage: WarehouseSystem.serialize(),
            quests: QuestStore.serialize(),
            party: PartySystem.serializeState(),
            // 装备与背包一并持久化（附魔/强化/改造数据在物品字段上）
            equipments: this.player.equipments,
            backpack: (typeof EquipManager !== 'undefined') ? EquipManager.backpackItems : [],
            world122: {
                unitUpgrades: serializeUnitUpgrades(),
                abilityLevels: serializeAbilityLevels(),
                energyStorage: EnergyManager.serializeStorage(),
                tributeBuffs: World122TributeSystem.serialize(),
                scene: serializeWorld122Scene(),
            },
            worlds: {
                map: serializeWorldMap(),
                currentWorldId: persistentCurrentWorldId,
                playerPositions: serializableWorldPositions,
                instances: window.WorldInstanceSystem?.serialize?.() || null,
                progression: window.WorldProgressionSystem?.serialize?.() || null,
                troopLines: TroopLineSystem.serialize({ excludeSceneIds: testWorldIds }),
                strategy: WorldStrategySystem.serialize(),
                invasion: window.WorldInvasionSystem?.serialize?.() || null,
                sandstorm: testWorldIdSet.has('scene8') ? null : window.World122SandstormSystem?.serialize?.() || null,
                drought: testWorldIdSet.has('scene8') ? null : window.World122DroughtSystem?.serialize?.() || null,
                fogTide: testWorldIdSet.has('scene11') ? null : window.World125FogTideSystem?.serialize?.() || null,
                mineWeather: testWorldIdSet.has('scene12') ? null : window.World126WeatherSystem?.serialize?.() || null,
                weather: window.WorldWeatherSystem?.serialize?.({ excludeSceneIds: testWorldIds }) || null,
                destructionChallenges: window.WorldDestructionChallengeSystem?.serialize?.({ excludeSceneIds: testWorldIds }) || null,
                scenes: serializeWorldScenes(),
            },
        };
        this._saveBusy = true;
        try {
            await GameSaveStorage.write(saveData, MailStore.serialize());
            alert('已保存至主神空间（含背包、仓库和信箱）');
        } catch (error) {
            console.error('Save failed:', error);
            alert(`保存失败，上一份存档仍保留：${error.message || '存储空间不足'}`);
        } finally {
            this._saveBusy = false;
        }
    },
    showHelp() { alert('WASD移动 | 鼠标瞄准 | 左键攻击 | F切换武器\nC打开装备栏 | 空格闪避 | Shift冲刺'); },
    _formatEconomyCompactNumber(valueRaw) {
        const value = Math.max(0, Number(valueRaw) || 0);
        if (value < 10000) return value.toLocaleString('zh-CN');
        if (value < 1000000) {
            const compact = Math.round((value / 1000) * 10) / 10;
            return `${compact.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`;
        }
        const compact = Math.round((value / 1000000) * 10) / 10;
        return `${compact.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}M`;
    },
    _formatEconomyInteger(valueRaw) {
        return Math.max(0, Math.floor(Number(valueRaw) || 0)).toLocaleString('zh-CN');
    },
    _sampleEconomyRates(values, storageSignature) {
        const now = globalThis.performance?.now?.() ?? Date.now();
        if (storageSignature !== this._economyStorageSignature) {
            this._economyStorageSignature = storageSignature;
            this._economyRateSamples = [];
            this._economyRates = { gold: 0, energy: 0, food: 0 };
        }
        this._economyRateSamples.push({ at: now, ...values });
        const cutoff = now - 5000;
        while (this._economyRateSamples.length > 2 && this._economyRateSamples[1].at <= cutoff) {
            this._economyRateSamples.shift();
        }
        const oldest = this._economyRateSamples[0];
        const elapsedSeconds = Math.max(0, (now - oldest.at) / 1000);
        if (elapsedSeconds < 1) return;
        this._economyRates = {
            gold: (values.gold - oldest.gold) / elapsedSeconds,
            energy: (values.energy - oldest.energy) / elapsedSeconds,
            food: (values.food - oldest.food) / elapsedSeconds,
        };
    },
    _updateEconomyCapacityMeter(prefix, currentRaw, capacityRaw, freeRaw) {
        const current = Math.max(0, Number(currentRaw) || 0);
        const capacity = Math.max(0, Number(capacityRaw) || 0);
        const free = Math.max(0, Number(freeRaw) || 0);
        const format = (value) => {
            const rounded = Math.round(value * 10) / 10;
            return rounded.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
        };
        const text = getElementIfExists(`economy${prefix}CapacityText`);
        if (text) text.textContent = `${format(current)} / ${format(capacity)} · 余 ${format(free)}`;
        const track = getElementIfExists(`economy${prefix}CapacityTrack`);
        if (track) {
            track.setAttribute('aria-valuenow', String(Math.min(current, capacity)));
            track.setAttribute('aria-valuemax', String(capacity));
            track.setAttribute('aria-valuetext', `${format(current)} / ${format(capacity)}，剩余 ${format(free)}`);
        }
        const fill = getElementIfExists(`economy${prefix}CapacityFill`);
        if (fill) fill.style.width = `${capacity > 0 ? Math.min(100, current / capacity * 100) : 0}%`;
    },
    _updateEconomyRate(resource, flow, accounting) {
        const prefix = `economy${resource[0].toUpperCase()}${resource.slice(1)}`;
        const numeric = Number(flow.net) || 0;
        const value = Math.abs(numeric) < 0.005 ? 0 : numeric;
        const el = getElementIfExists(`${prefix}Rate`);
        if (!el) return;
        el.textContent = `${value > 0 ? '+' : ''}${value.toFixed(2)}/秒`;
        el.classList.toggle('is-positive', value > 0);
        el.classList.toggle('is-negative', value < 0);
        const format = (amount) => (Number(amount) || 0).toFixed(2);
        const income = getElementIfExists(`${prefix}Income`);
        const expense = getElementIfExists(`${prefix}Expense`);
        if (income) income.textContent = `收入 +${format(flow.income)}/秒`;
        if (expense) expense.textContent = `消耗 −${format(flow.expense)}/秒`;
        const sources = accounting.details.filter((entry) => entry.resource === resource)
            .map((entry) => `${entry.label || entry.providerId}：收入 ${format(entry.income)}，消耗 ${format(entry.expense)}/秒`);
        el.parentElement.title = [
            `净收支 = 收入 ${format(flow.income)} − 消耗 ${format(flow.expense)}/秒`,
            ...sources,
            `物流与临时收支：收入 ${format(flow.observedIncome)}，消耗 ${format(flow.observedExpense)}/秒`,
            `实收支窗口：近${accounting.windowMs / 1000}游戏秒；当前已统计${(accounting.observedMs / 1000).toFixed(1)}秒。`,
            '周期经营按现有岗位与开工条件折算；居民口粮按足额需求计入，短缺仍显示供粮压力。',
        ].join('\n');
    },
    refreshBasicResources() {
        const values = {
            gold: Math.max(0, Number(GoldManager?.getGold?.()) || 0),
            energy: Math.max(0, Number(EnergyManager?.getEnergy?.()) || 0),
            food: Math.max(0, Number(EnergyManager?.getFood?.()) || 0),
        };
        const totals = {
            resourceGoldTotal: values.gold,
            resourceEnergyTotal: values.energy,
            resourceFoodTotal: values.food,
        };
        for (const [id, rawValue] of Object.entries(totals)) {
            const el = getElementIfExists(id);
            if (!el) continue;
            const value = Math.max(0, Math.floor(Number(rawValue) || 0));
            const compact = this._formatEconomyCompactNumber(value);
            const full = this._formatEconomyInteger(value);
            const label = {
                resourceGoldTotal: '金币',
                resourceEnergyTotal: '能源',
                resourceFoodTotal: '食物',
            }[id];
            if (el.dataset.value === String(value)) continue;
            const initialized = el.dataset.value !== undefined;
            el.dataset.value = String(value);
            el.textContent = compact;
            if (label) {
                el.title = `${label}：${full}`;
                el.setAttribute('aria-label', `${label}：${full}`);
            }
            if (initialized) {
                el.classList.remove('is-resource-changing');
                void el.offsetWidth;
                el.classList.add('is-resource-changing');
            }
        }

        const warehouses = EnergyManager?.getWarehouses?.() || [];
        const storageCapacity = Math.max(0, Number(EnergyManager?.getCapacity?.()) || 0);
        const storageFree = Math.max(0, Number(EnergyManager?.getFreeCapacity?.()) || 0);
        const storageUsed = Math.max(0, storageCapacity - storageFree);

        const energyFree = warehouses.reduce((sum, warehouse) => sum + Math.floor(
            EnergyManager.getWarehouseFreeCapacity(warehouse)
                / EnergyManager.getWarehouseEnergyFactor(warehouse)
        ), 0);
        const foodFree = warehouses.reduce((sum, warehouse) => sum + Math.floor(
            EnergyManager.getWarehouseFreeCapacity(warehouse)
                / EnergyManager.getWarehouseFoodFactor(warehouse)
        ), 0);
        this._updateEconomyCapacityMeter('Storage', storageUsed, storageCapacity, storageFree);
        this._updateEconomyCapacityMeter('Energy', values.energy, values.energy + energyFree, energyFree);
        this._updateEconomyCapacityMeter('Food', values.food, values.food + foodFree, foodFree);
        const goldCapacity = getElementIfExists('economyGoldCapacityText');
        if (goldCapacity) goldCapacity.textContent = `${Math.floor(values.gold).toLocaleString('zh-CN')} · 无上限`;
        const warehouseCount = getElementIfExists('economyWarehouseCount');
        if (warehouseCount) warehouseCount.textContent = `${warehouses.length}座`;

        const military = MilitaryPopulationSystem.getSnapshot();
        const militaryEl = getElementIfExists('resourceMilitaryPopulation');
        if (militaryEl) {
            const used = Math.max(0, Math.floor(Number(military.used) || 0));
            const capacity = Math.max(0, Math.floor(Number(military.capacity) || 0));
            const usedDisplay = this._formatEconomyCompactNumber(used);
            const capacityDisplay = this._formatEconomyCompactNumber(capacity);
            const value = `${used}/${capacity}`;
            const valueDisplay = `${usedDisplay} / ${capacityDisplay}`;
            if (militaryEl.dataset.value !== value) {
                const initialized = militaryEl.dataset.value !== undefined;
                militaryEl.dataset.value = value;
                militaryEl.textContent = valueDisplay;
                militaryEl.title = `兵力：${this._formatEconomyInteger(used)} / ${this._formatEconomyInteger(capacity)}`;
                militaryEl.setAttribute('aria-label', `兵力：${this._formatEconomyInteger(used)} / ${this._formatEconomyInteger(capacity)}`);
                if (initialized) {
                    militaryEl.classList.remove('is-resource-changing');
                    void militaryEl.offsetWidth;
                    militaryEl.classList.add('is-resource-changing');
                }
            }
        }
        const working = EconomyHudSystem.getPopulationSnapshot();
        const workingEl = getElementIfExists('resourceWorkingPopulation');
        if (workingEl) {
            const total = Math.max(0, Math.floor(Number(working.total) || 0));
            const revision = String(working.viewRevision);
            const samePopulation = workingEl.dataset.populationRevision === revision
                && workingEl.dataset.value !== undefined;
            const previous = Number(workingEl.dataset.value);
            // 概览只显示实际居民；岗位调配、扩容以及切场/读档不触发人口增减闪动。
            if (!samePopulation || workingEl.dataset.value !== String(total)) {
                workingEl.classList.remove('is-resource-changing', 'is-population-increasing', 'is-population-decreasing');
                workingEl.dataset.populationRevision = revision;
                workingEl.dataset.value = String(total);
                workingEl.textContent = this._formatEconomyCompactNumber(total);
                if (samePopulation && total !== previous) {
                    void workingEl.offsetWidth;
                    workingEl.classList.add(total > previous ? 'is-population-increasing' : 'is-population-decreasing');
                }
            }
            const details = `本位面实际人口：${this._formatEconomyInteger(total)} 人；已用岗位：${this._formatEconomyInteger(working.used)}；空闲人口：${this._formatEconomyInteger(working.free)}；住房容量：${this._formatEconomyInteger(working.capacity)}`
                + (working.overcrowded > 0 ? `；超额人口：${this._formatEconomyInteger(working.overcrowded)}` : '');
            workingEl.title = details;
            workingEl.setAttribute('aria-label', details);
            workingEl.parentElement.title = details;
        }
        this._updateEconomyCapacityMeter('Military', military.used, military.capacity, military.free);
        this._updateEconomyCapacityMeter('Working', working.used, working.total, working.free);
        const workingCapacity = getElementIfExists('economyWorkingCapacityText');
        if (workingCapacity) workingCapacity.textContent = `${this._formatEconomyInteger(working.used)} / ${this._formatEconomyInteger(working.total)} · 空闲 ${this._formatEconomyInteger(working.free)}`;
        this._updateEconomyCapacityMeter('Housing', working.total, working.capacity, Math.max(0, working.capacity - working.total));
        const housingText = getElementIfExists('economyHousingCapacityText');
        const housingTrack = getElementIfExists('economyHousingCapacityTrack');
        if (working.overcrowded > 0) {
            const description = `${this._formatEconomyInteger(working.total)} / ${this._formatEconomyInteger(working.capacity)} · 超额 ${this._formatEconomyInteger(working.overcrowded)}`;
            if (housingText) housingText.textContent = description;
            housingTrack?.setAttribute('aria-valuetext', description);
            const housingFill = getElementIfExists('economyHousingCapacityFill');
            if (housingFill) housingFill.style.width = '100%';
        }
        const accounting = EconomyFlowSystem.getSnapshot();
        for (const resource of ECONOMY_RESOURCES) {
            this._updateEconomyRate(resource, accounting.resources[resource], accounting);
        }
        const rateWindow = getElementIfExists('economyRateWindow');
        if (rateWindow) rateWindow.textContent = accounting.unavailable.length
            ? '部分收支来源暂不可用'
            : `周期均摊 / 近${accounting.windowMs / 1000}秒实收支`;
    },
    refreshGameTime() {
        this.refreshBasicResources();
        const gameTime = EnvironmentLightingSystem.getGameTime();
        const icon = getElementIfExists('gameTimeIcon');
        const text = getElementIfExists('gameTimeText');
        if (icon) icon.textContent = gameTime.icon;
        if (text) {
            const pad = (n) => String(n).padStart(2, '0');
            text.textContent = `第${gameTime.day}日 · ${pad(gameTime.hour)}:${pad(gameTime.minute)} · ${gameTime.period}`;
        }
        // 24h 太阳针：phase=0 日出指左(−90°)、0.25 正午指上(0°)、0.5 日落指右(+90°)。
        const hand = getElementIfExists('gameTimeDialHand');
        if (hand) {
            const phase = EnvironmentLightingSystem.getSun()?.phase ?? 0.25;
            hand.setAttribute('transform', `rotate(${(phase * 360 - 90).toFixed(2)} 24 24)`);
        }
        const invasion = window.WorldInvasionSystem?.getHudModel?.();
        const invasionHud = getElementIfExists('worldInvasionHud');
        const invasionText = getElementIfExists('worldInvasionText');
        const invasionDetail = getElementIfExists('worldInvasionDetail');
        const invasionSupport = getElementIfExists('worldInvasionSupport');
        const invasionBar = getElementIfExists('worldInvasionBar');
        const timelineEvents = getElementIfExists('worldTimelineEvents');
        const timelineCursor = getElementIfExists('worldTimelineCursor');
        const timelineWindow = getElementIfExists('worldTimelineWindow');
        const timelineFilters = getElementIfExists('worldTimelineFilters');
        const timeline = window.WorldEventTimelineSystem?.getHudModel?.();
        const allTimelineEvents = Array.isArray(timeline?.events) ? timeline.events : [];
        let visibleTimelineEvents = allTimelineEvents;
        if (invasionHud && invasion) {
            invasionHud.classList.toggle('active', !!invasion.active);
            for (const severity of ['warning', 'critical', 'evacuation']) {
                invasionHud.classList.toggle(severity, invasion.severity === severity);
            }
        }
        if (invasionText && invasion) invasionText.textContent = invasion.text;
        if (invasionDetail && invasion) {
            invasionDetail.textContent = invasion.detail || '';
            invasionDetail.style.display = invasion.detail ? '' : 'none';
        }
        if (invasionSupport && invasion) {
            invasionSupport.style.display = invasion.active && invasion.canSupport ? '' : 'none';
        }
        if (invasionBar && timeline) {
            invasionBar.style.width = '100%';
            invasionBar.style.setProperty('--invasion-gradient-start', timelineProgressColor(1));
            invasionBar.style.setProperty('--invasion-gradient-end', timelineProgressColor(0));
        }
        if (timelineCursor && timeline) {
            const nowPosition = Math.max(0, Math.min(1, Number(timeline.nowPosition) || 0));
            timelineCursor.style.left = `${Math.round(nowPosition * 10000) / 100}%`;
        }
        if (timelineFilters && timeline) {
            const typeMap = new Map();
            allTimelineEvents.forEach((event) => {
                const type = event.type || 'generic';
                if (!typeMap.has(type)) typeMap.set(type, {
                    type,
                    label: event.typeLabel || type,
                    count: 0,
                });
                typeMap.get(type).count++;
            });
            if (this._timelineFilterType !== 'all' && !typeMap.has(this._timelineFilterType)) {
                this._timelineFilterType = 'all';
            }
            const filterOptions = [
                { type: 'all', label: '全部', count: allTimelineEvents.length },
                ...typeMap.values(),
            ];
            const filterSignature = JSON.stringify([
                this._timelineFilterType,
                ...filterOptions.map((option) => [option.type, option.label, option.count]),
            ]);
            if (timelineFilters.dataset.renderSignature !== filterSignature) {
                timelineFilters.dataset.renderSignature = filterSignature;
                timelineFilters.replaceChildren();
                filterOptions.forEach((option) => {
                    const button = document.createElement('button');
                    const active = this._timelineFilterType === option.type;
                    button.type = 'button';
                    button.className = `world-timeline-filter${active ? ' active' : ''}`;
                    button.textContent = `${option.label} ${option.count}`;
                    button.dataset.eventType = option.type;
                    button.setAttribute('aria-pressed', String(active));
                    button.addEventListener('click', () => {
                        if (this._timelineFilterType === option.type) return;
                        this._timelineFilterType = option.type;
                        closeTimelinePopover();
                        if (timelineEvents) delete timelineEvents.dataset.renderSignature;
                        this.refreshGameTime();
                    });
                    timelineFilters.appendChild(button);
                });
            }
            if (this._timelineFilterType !== 'all') {
                visibleTimelineEvents = allTimelineEvents.filter((event) =>
                    (event.type || 'generic') === this._timelineFilterType);
            }
        }
        if (timelineWindow && timeline) {
            const durationDays = Math.max(0, Number(timeline.durationDays) || 0);
            const durationLabel = Number.isInteger(durationDays)
                ? String(durationDays)
                : durationDays.toFixed(1);
            const countLabel = this._timelineFilterType === 'all'
                ? `${allTimelineEvents.length}个事件`
                : `显示${visibleTimelineEvents.length}/${allTimelineEvents.length}个事件`;
            const summary = `未来${durationLabel}日 · ${countLabel}`;
            if (timelineWindow.textContent !== summary) timelineWindow.textContent = summary;
        }
        if (timelineEvents && timeline) {
            const displayEvents = clusterTimelineEvents(visibleTimelineEvents);
            const lanes = assignTimelineEventLanes(displayEvents);
            const renderSignature = JSON.stringify(displayEvents.map((event, index) => [
                event.id,
                event.type,
                event.status,
                event.label,
                event.timeLabel,
                event.icon,
                event.iconPath,
                event.typeLabel,
                event.worldName,
                event.intensityName,
                event.startsAtLabel,
                event.endsAtLabel,
                event.durationLabel,
                event.warningLevel,
                event.warningLabel,
                event.detail,
                lanes[index],
                event.clusterEvents?.map((child) => [child.id, child.type, child.typeLabel, child.status, child.timeLabel]),
            ]));
            if (timelineEvents.dataset.renderSignature !== renderSignature) {
                timelineEvents.dataset.renderSignature = renderSignature;
                timelineEvents.replaceChildren();
                displayEvents.forEach((event, index) => {
                    const position = Math.max(0, Math.min(1, Number(event.position) || 0));
                    const isCluster = Array.isArray(event.clusterEvents);
                    const isWeather = event.type === 'weather';
                    const pulseType = isCluster
                        ? (event.clusterEvents.some((child) => child.type === 'invasion')
                            ? 'invasion'
                            : (event.clusterEvents.some((child) => child.type === 'weather') ? 'weather' : 'generic'))
                        : (event.type || 'generic');
                    const interactive = isCluster || isWeather;
                    const marker = document.createElement(interactive ? 'button' : 'span');
                    if (interactive) marker.type = 'button';
                    marker.className = `world-timeline-event is-${event.type || 'generic'} pulse-${pulseType}${event.status === 'active' ? ' active' : ''}${interactive ? ' is-clickable' : ''}${event.warningLevel ? ` weather-warning-${event.warningLevel}` : ''}`;
                    if (position <= 0.08) marker.classList.add('at-start-edge');
                    if (position >= 0.92) marker.classList.add('at-end-edge');
                    marker.style.left = `${Math.round(position * 10000) / 100}%`;
                    marker.style.setProperty('--timeline-event-lane', String(lanes[index]));
                    if (!interactive) {
                        marker.setAttribute('role', 'img');
                        marker.tabIndex = 0;
                    }
                    const actionLabel = isCluster ? '，点击展开事件簇'
                        : (isWeather ? '，点击查看天气预报详情' : '');
                    const hoverCopy = timelineEventHoverCopy(event);
                    marker.setAttribute('aria-label', `${hoverCopy.title}，${hoverCopy.meta}，${hoverCopy.timing}${actionLabel}`);
                    const icon = document.createElement('span');
                    icon.className = 'world-timeline-event-icon';
                    const fallbackIcon = event.icon || (isCluster ? `+${event.clusterEvents.length}` : '◆');
                    if (isCluster) {
                        icon.classList.add('is-cluster-count');
                        icon.textContent = `+${event.clusterEvents.length}`;
                    } else if (event.iconPath) {
                        const image = document.createElement('img');
                        image.src = event.iconPath;
                        image.alt = '';
                        image.draggable = false;
                        image.decoding = 'async';
                        image.addEventListener('error', () => {
                            image.remove();
                            icon.textContent = fallbackIcon;
                        }, { once: true });
                        icon.appendChild(image);
                    } else {
                        icon.textContent = fallbackIcon;
                    }
                    const time = document.createElement('span');
                    time.className = 'world-timeline-event-time';
                    time.textContent = event.timeLabel;
                    marker.append(icon, time);
                    appendTimelineHoverTooltip(marker, hoverCopy);
                    const progressLine = document.createElement('span');
                    progressLine.className = `world-timeline-event-line pulse-${pulseType}${event.status === 'active' ? ' active' : ''}${event.warningLevel ? ` weather-warning-${event.warningLevel}` : ''}`;
                    progressLine.style.left = `${Math.round(position * 10000) / 100}%`;
                    progressLine.setAttribute('aria-hidden', 'true');
                    if (isCluster) {
                        marker.addEventListener('click', () => openTimelineCluster(event));
                    } else if (isWeather) {
                        marker.addEventListener('click', () => openWeatherTimelineDetail(event));
                    }
                    timelineEvents.append(progressLine, marker);
                });
            }
            const markers = timelineEvents.getElementsByClassName('world-timeline-event');
            const progressLines = timelineEvents.getElementsByClassName('world-timeline-event-line');
            displayEvents.forEach((event, index) => {
                const position = Math.max(0, Math.min(1, Number(event.position) || 0));
                const left = `${Math.round(position * 10000) / 100}%`;
                const marker = markers[index];
                const progressLine = progressLines[index];
                if (marker) {
                    marker.style.left = left;
                    marker.classList.toggle('at-start-edge', position <= 0.08);
                    marker.classList.toggle('at-end-edge', position >= 0.92);
                }
                if (progressLine) progressLine.style.left = left;
            });
        }
    },
    setupWeaponSwitchButtons() {
        // quickMelee/quickRanged buttons are optional; weapon switching via F key always works
    }

};
