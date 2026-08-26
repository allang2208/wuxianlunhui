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
} from '../world/world122-snapshot.js';
import { EnvironmentLightingSystem } from '../world/environment-lighting-system.js';
import { TroopLineSystem } from '../world/troop-line-system.js';
import { TechnologySystem } from '../world/technology-system.js';
import { WarehouseSystem } from './warehouse-system.js';
import { QuestStore } from '../quest/quest-store.js';
import { MilitaryPopulationSystem } from '../world/military-population-system.js';
import { EconomyHudSystem } from '../world/economy-hud-system.js';

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
        return {
            title: event.label,
            meta: `${event.worldName || event.sceneId || '未知位面'} · ${event.intensityName || event.intensityId || '降雨'}`,
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
        let attackType = 'melee';
        if (currentItem) {
            if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackType = 'pistol';
            else if (currentItem.weaponType === 'bow') attackType = 'ranged';
        }
        const currentAttack = p.attacks[attackType];
        const attackCD = currentAttack.getCooldownPercent();
        const cdOverlay = getElementIfExists('cdAttackOverlay');
        if (cdOverlay) cdOverlay.style.height = (attackCD * 100) + '%';
        const cdAttack = getElementIfExists('cdAttack');
        if (cdAttack) cdAttack.classList.toggle('ready', attackCD <= 0);
        let attackIcon = '⚔';
        if (currentItem) {
            if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackIcon = '🔫';
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
                let cd = p.attacks.melee.maxCooldown; // 默认近战
                if (currentWpn) {
                    if (currentWpn.weaponType === 'pistol' || currentWpn.rangedType === 'pistol') cd = p.attacks.pistol.maxCooldown;
                    else if (currentWpn.weaponType === 'bow') cd = p.attacks.ranged.maxCooldown;
                }
                el.textContent = Math.round(cd) + 'ms';
            } else if (item.id === 'combatSpd') {
                // 移动速度：使用实际最大移动速度（px/s）
                const speed = p.maxSpeed || p.data.speed || 0;
                el.textContent = (speed * 60).toFixed(0) + 'px/s';
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
            let paType = 'melee';
            if (currentWpn) {
                if (currentWpn.weaponType === 'pistol' || currentWpn.rangedType === 'pistol') paType = 'pistol';
                else if (currentWpn.weaponType === 'bow') paType = 'ranged';
            }
            const pa = p.attacks[paType];
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
                    el.textContent = (speed * 60).toFixed(0) + item.unit;
                    break;
                }
                case 'detailDodgeCooldown': el.textContent = CONFIG.DODGE_COOLDOWN + item.unit; break;
                case 'detailAttackRange': {
                    let displayRange = pa ? pa.config.range : 100;
                    if (currentWpn && (currentWpn.weaponType === 'sword' || currentWpn.category === 'weapon_melee')) {
                        const hitBox = WeaponAnimConfig.sword.hitBox;
                        const rangeBonus = (currentWpn.attack && currentWpn.attack.rangeBonus) ?? 50;
                        displayRange = (hitBox ? hitBox.forwardRange : 155) + rangeBonus;
                        if (currentWpn._craftEffects && currentWpn._craftEffects.rangeDelta) {
                            displayRange += currentWpn._craftEffects.rangeDelta;
                        }
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
        const save = localStorage.getItem('infiniteLoop_save');
        if (!save) { alert('没有找到存档'); return; }
        let data;
        try { data = JSON.parse(save); } catch (e) {
            console.error('Load failed:', e);
            EffectManager.add(new FloatingTextEffect(this.player ? this.player.x : CONFIG.WORLD_WIDTH/2, this.player ? this.player.y - 20 : CONFIG.WORLD_HEIGHT/2, '读档失败: 存档损坏'));
            return;
        }
        if (!this.player) return;
        const positionBeforeLoad = { x: this.player.x, y: this.player.y };
        // 恢复玩家数据与位置
        if (data.player) Object.assign(this.player.data, data.player);
        if (data.position && Number.isFinite(data.position.x) && Number.isFinite(data.position.y)) {
            this.player.x = data.position.x;
            this.player.y = data.position.y;
        }
        EnvironmentLightingSystem.restoreTime(data.gameTime);
        window.World122SandstormSystem?.restore?.(data.worlds?.sandstorm ?? data.world122?.sandstorm);
        window.WorldWeatherSystem?.restore?.(data.worlds?.weather);
        // 恢复装备与背包（附魔/强化/改造数据随物品一并恢复）
        if (data.equipments) this.player.equipments = data.equipments;
        restoreUnitUpgrades(data.world122?.unitUpgrades);
        restoreAbilityLevels(data.world122?.abilityLevels);
        TechnologySystem.restore(data.technologyTree, { legacyUnlockAll: !data.technologyTree });
        WarehouseSystem.restore(data.warehouseStorage);
        QuestStore.restore(data.quests);
        ResearchSystem.refreshWorld();
        EnergyManager.restoreStorage(data.world122?.energyStorage);
        World122TributeSystem.restore(data.world122?.tributeBuffs);
        if (data.worlds?.scenes) restoreWorldScenes(data.worlds.scenes);
        else restoreWorld122Scene(data.world122?.scene);
        window.WorldProgressionSystem?.restore?.(data.worlds?.progression);
        TroopLineSystem.restore(data.worlds?.troopLines);
        window.WorldInvasionSystem?.restore?.(data.worlds?.invasion);
        window.WorldDestructionChallengeSystem?.restore?.(data.worlds?.destructionChallenges);
        if (Array.isArray(data.backpack) && typeof EquipManager !== 'undefined') {
            // 原地替换内容而非换数组：init 时旧数组引用已注入 EquipTooltipManager/
            // GoldManager/BackpackDialogManager/dragDropManager，换数组会让这些引用失效
            if (!EquipManager.backpackItems) EquipManager.backpackItems = [];
            EquipManager.backpackItems.length = 0;
            EquipManager.backpackItems.push(...data.backpack);
            EnergyManager.setBackpackRef(EquipManager.backpackItems); // 迁移旧存档背包能源到待入库
            if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
            if (EquipManager.updateEquipSlots) EquipManager.updateEquipSlots();
        }
        // 旧存档实例统一经 completeWeaponFields 补全缺失字段（与 main.js 启动合并同口径）
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
        // 任务实例中的原地读档必须重建裂隙/返回门实体；若存档没有活动会话则安全退回主城。
        // 非任务场景读到活动会话时不强制传送，仍由小鼠侍从入口继续该任务。
        try {
            const { SceneManager } = await import('../world/scene-manager.js');
            const restoredQuestId = QuestStore.getActiveQuestId();
            const inQuestInstance = SceneManager.isQuestInstance();
            if (restoredQuestId && !inQuestInstance) {
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
            console.error('[GameUIManager] quest load reconciliation failed:', error);
            alert('读档数据已恢复，但任务场景重建失败，请返回主神空间后重试');
            return;
        }
        if (this.updateUI) this.updateUI();
        alert(`读档成功: ${this.player.data?.name || '未知'} Lv.${this.player.data?.level || 1}`);
    },
    save() {
        if (!this.player) return;
        // 存档是后台账本的权威读取边界：先一次性结算连续资源与到期队列，再序列化。
        window.WorldSimDriver?.flushAll?.({ notify: false, reason: 'save' });
        window.WorldInvasionSystem?.settleBackgroundNow?.();
        window.WorldInvasionSystem?.syncLivePortal?.();
        const saveData = {
            version: '1.0',
            timestamp: Date.now(),
            player: this.player.data,
            position: { x: this.player.x, y: this.player.y },
            gameTime: EnvironmentLightingSystem.serializeTime(),
            technologyTree: TechnologySystem.serialize(),
            warehouseStorage: WarehouseSystem.serialize(),
            quests: QuestStore.serialize(),
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
                progression: window.WorldProgressionSystem?.serialize?.() || null,
                troopLines: TroopLineSystem.serialize(),
                invasion: window.WorldInvasionSystem?.serialize?.() || null,
                sandstorm: window.World122SandstormSystem?.serialize?.() || null,
                weather: window.WorldWeatherSystem?.serialize?.() || null,
                destructionChallenges: window.WorldDestructionChallengeSystem?.serialize?.() || null,
                scenes: serializeWorldScenes(),
            },
        };
        try { localStorage.setItem('infiniteLoop_save', JSON.stringify(saveData)); alert('已保存至主神空间'); } catch (e) { console.error('Save failed:', e); alert('存档失败: 存储空间不足'); }
    },
    showHelp() { alert('WASD移动 | 鼠标瞄准 | 左键攻击 | F切换武器\nC打开装备栏 | 空格闪避 | Shift冲刺'); },
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
    _updateEconomyRate(id, valueRaw) {
        const numeric = Number(valueRaw) || 0;
        const value = Math.abs(numeric) < 0.005 ? 0 : numeric;
        const el = getElementIfExists(id);
        if (!el) return;
        el.textContent = `${value > 0 ? '+' : ''}${value.toFixed(2)}/秒`;
        el.classList.toggle('is-positive', value > 0);
        el.classList.toggle('is-negative', value < 0);
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
            if (el.dataset.value === String(value)) continue;
            const initialized = el.dataset.value !== undefined;
            el.dataset.value = String(value);
            el.textContent = value.toLocaleString('zh-CN');
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
        const storageSignature = warehouses
            .map((warehouse) => `${warehouse?.id ?? ''}:${Number(warehouse?.storageCapacity) || 0}`)
            .sort()
            .join('|');
        this._sampleEconomyRates(values, storageSignature);

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
            const value = `${military.used}/${military.capacity}`;
            if (militaryEl.dataset.value !== value) {
                const initialized = militaryEl.dataset.value !== undefined;
                militaryEl.dataset.value = value;
                militaryEl.textContent = value;
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
            const value = `${working.used}/${working.capacity}`;
            if (workingEl.dataset.value !== value) {
                const initialized = workingEl.dataset.value !== undefined;
                workingEl.dataset.value = value;
                workingEl.textContent = value;
                if (initialized) {
                    workingEl.classList.remove('is-resource-changing');
                    void workingEl.offsetWidth;
                    workingEl.classList.add('is-resource-changing');
                }
            }
        }
        this._updateEconomyCapacityMeter('Military', military.used, military.capacity, military.free);
        this._updateEconomyCapacityMeter('Working', working.used, working.capacity, working.free);
        this._updateEconomyRate('economyGoldRate', this._economyRates.gold);
        this._updateEconomyRate('economyEnergyRate', this._economyRates.energy);
        this._updateEconomyRate('economyFoodRate', this._economyRates.food);
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
                    marker.className = `world-timeline-event is-${event.type || 'generic'} pulse-${pulseType}${event.status === 'active' ? ' active' : ''}${interactive ? ' is-clickable' : ''}`;
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
                    progressLine.className = `world-timeline-event-line pulse-${pulseType}${event.status === 'active' ? ' active' : ''}`;
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
