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

// Game UI Manager - Extracted from Game.js
// Handles UI updates, save/load, timers, and menu operations

const INVASION_DANGER_COLORS = [
    { at: 0, rgb: [61, 196, 91] },
    { at: 1 / 3, rgb: [65, 139, 231] },
    { at: 2 / 3, rgb: [241, 193, 63] },
    { at: 1, rgb: [229, 65, 62] },
];

function invasionDangerColor(value) {
    const progress = Math.max(0, Math.min(1, Number(value) || 0));
    const upperIndex = INVASION_DANGER_COLORS.findIndex((stop) => progress <= stop.at);
    const upper = INVASION_DANGER_COLORS[Math.max(1, upperIndex)];
    const lower = INVASION_DANGER_COLORS[Math.max(0, upperIndex - 1)];
    const span = Math.max(Number.EPSILON, upper.at - lower.at);
    const t = Math.max(0, Math.min(1, (progress - lower.at) / span));
    const rgb = lower.rgb.map((channel, index) =>
        Math.round(channel + (upper.rgb[index] - channel) * t));
    return `rgb(${rgb.join(', ')})`;
}

export const GameUIManager = {
    player: null,
    showAttackRange: false,

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
                case 'detailMpRegen': el.textContent = d.mpRegen + item.unit; break;
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
    load() {
        const save = localStorage.getItem('infiniteLoop_save');
        if (!save) { alert('没有找到存档'); return; }
        let data;
        try { data = JSON.parse(save); } catch (e) {
            console.error('Load failed:', e);
            EffectManager.add(new FloatingTextEffect(this.player ? this.player.x : CONFIG.WORLD_WIDTH/2, this.player ? this.player.y - 20 : CONFIG.WORLD_HEIGHT/2, '读档失败: 存档损坏'));
            return;
        }
        if (!this.player) return;
        // 恢复玩家数据与位置
        if (data.player) Object.assign(this.player.data, data.player);
        if (data.position && Number.isFinite(data.position.x) && Number.isFinite(data.position.y)) {
            this.player.x = data.position.x;
            this.player.y = data.position.y;
        }
        EnvironmentLightingSystem.restoreTime(data.gameTime);
        // 恢复装备与背包（附魔/强化/改造数据随物品一并恢复）
        if (data.equipments) this.player.equipments = data.equipments;
        restoreUnitUpgrades(data.world122?.unitUpgrades);
        restoreAbilityLevels(data.world122?.abilityLevels);
        TechnologySystem.restore(data.technologyTree, { legacyUnlockAll: !data.technologyTree });
        WarehouseSystem.restore(data.warehouseStorage);
        ResearchSystem.refreshWorld();
        EnergyManager.restoreStorage(data.world122?.energyStorage);
        World122TributeSystem.restore(data.world122?.tributeBuffs);
        if (data.worlds?.scenes) restoreWorldScenes(data.worlds.scenes);
        else restoreWorld122Scene(data.world122?.scene);
        window.WorldProgressionSystem?.restore?.(data.worlds?.progression);
        TroopLineSystem.restore(data.worlds?.troopLines);
        window.WorldInvasionSystem?.restore?.(data.worlds?.invasion);
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
        // 重算派生状态（属性/弹药/附魔攻击间隔/技能覆盖）
        if (this.player.calculateCombatStats) this.player.calculateCombatStats();
        if (this.player.updateMaxStats) this.player.updateMaxStats();
        const curWeapon = (this.player.equipments && this.player.weaponMode) ? this.player.equipments[this.player.weaponMode] : null;
        if (this.player._applySkillOverrides) this.player._applySkillOverrides(curWeapon);
        if (this.player._initAmmoForSlot && this.player.weaponMode) this.player._initAmmoForSlot(this.player.weaponMode);
        if (this.updateUI) this.updateUI();
        alert(`读档成功: ${this.player.data?.name || '未知'} Lv.${this.player.data?.level || 1}`);
    },
    save() {
        if (!this.player) return;
        window.WorldInvasionSystem?.syncLivePortal?.();
        const saveData = {
            version: '1.0',
            timestamp: Date.now(),
            player: this.player.data,
            position: { x: this.player.x, y: this.player.y },
            gameTime: EnvironmentLightingSystem.serializeTime(),
            technologyTree: TechnologySystem.serialize(),
            warehouseStorage: WarehouseSystem.serialize(),
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
                scenes: serializeWorldScenes(),
            },
        };
        try { localStorage.setItem('infiniteLoop_save', JSON.stringify(saveData)); alert('已保存至主神空间'); } catch (e) { console.error('Save failed:', e); alert('存档失败: 存储空间不足'); }
    },
    showHelp() { alert('WASD移动 | 鼠标瞄准 | 左键攻击 | F切换武器\nC打开装备栏 | 空格闪避 | Shift冲刺'); },
    refreshGameTime() {
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
        if (invasionBar && invasion) {
            const progress = Math.max(0, Math.min(1, Number(invasion.progress) || 0));
            // 倒计时越满越危险；入侵发生后 progress 改表示传送门剩余耐久，危险度方向相反。
            const danger = invasion.active ? 1 - progress : progress;
            invasionBar.style.width = `${Math.round(progress * 100)}%`;
            invasionBar.style.setProperty('--invasion-gradient-start', invasionDangerColor(danger - 0.08));
            invasionBar.style.setProperty('--invasion-gradient-end', invasionDangerColor(danger + 0.08));
        }
    },
    setupWeaponSwitchButtons() {
        // quickMelee/quickRanged buttons are optional; weapon switching via F key always works
    }

};
