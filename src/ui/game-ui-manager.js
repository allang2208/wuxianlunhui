import { EventBus } from '../core/event-bus.js';
import { Game } from '../game.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { EffectManager } from '../effects/effect-manager.js';
import { queryAllElements, getElement, getElementIfExists } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { CONFIG } from '../config/config.js';
import { NPCDialogue } from './npc-dialogue.js';
import { ShopSystem } from './shop-system.js';
import { EnhanceSystem } from './enhance-system.js';
import { SystemUI, UI_DATA_CONFIG } from './system-ui.js';

// Game UI Manager - Extracted from Game.js
// Handles UI updates, save/load, timers, and menu operations

export const GameUIManager = {
    player: null,
    showAttackRange: false,
    _gameStartTime: null,
    _timerInterval: null,

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
        // 底部状态条更新
        const hpBar = getElementIfExists('hpBar'), hpText = getElementIfExists('hpText');
        const staminaBar = getElementIfExists('staminaBar'), staminaText = getElementIfExists('staminaText');
        if (hpBar) hpBar.style.width = (d.maxHp ? ((d.hp || 0) / d.maxHp * 100) : 0) + '%';
        if (hpText) hpText.textContent = `${Math.ceil(d.hp || 0)}/${d.maxHp || 0}`;
        if (staminaBar) staminaBar.style.width = (d.maxStamina ? ((d.stamina || 0) / d.maxStamina * 100) : 0) + '%';
        if (staminaText) staminaText.textContent = `${Math.ceil(d.stamina || 0)}/${d.maxStamina || 0}`;
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
                // 移动速度：px/s（假设60fps，每帧速度*60）
                const speed = p.data.speed || 0;
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
                case 'detailStaminaRegen': el.textContent = CONFIG.STAMINA_REGEN + item.unit; break;
                case 'detailHpRegen': el.textContent = d.hpRegen + item.unit; break;
                case 'detailMpRegen': el.textContent = d.mpRegen + item.unit; break;
                case 'detailCollisionRadius': el.textContent = (p.collisionRadius || 10) + item.unit; break;
                case 'detailMoveSpeed': el.textContent = CONFIG.PLAYER_SPEED + item.unit; break;
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
        if (save) { let data; try { data = JSON.parse(save); } catch (e) { console.error('Load failed:', e); EffectManager.add(new FloatingTextEffect(this.player ? this.player.x : CONFIG.WORLD_WIDTH/2, this.player ? this.player.y - 20 : CONFIG.WORLD_HEIGHT/2, '读档失败: 存档损坏')); return; } alert(`读取存档: ${data.player?.name || '未知'}\n等级: ${data.player?.level || 1}`); }
        else alert('没有找到存档');
    },
    save() {
        if (!this.player) return;
        const saveData = { version: '1.0', timestamp: Date.now(), player: this.player.data, position: { x: this.player.x, y: this.player.y } };
        try { localStorage.setItem('infiniteLoop_save', JSON.stringify(saveData)); alert('已保存至主神空间'); } catch (e) { console.error('Save failed:', e); alert('存档失败: 存储空间不足'); }
    },
    showHelp() { alert('WASD移动 | 鼠标瞄准 | 左键攻击 | F切换武器\nC打开装备栏 | 空格闪避 | Shift冲刺'); },
    startTimer() {
        this._gameStartTime = Date.now();
        const timerEl = getElementIfExists('gameTimer');
        if (timerEl) timerEl.style.display = 'flex';
        const textEl = getElementIfExists('timerText');
        if (textEl) textEl.textContent = '00:00:00';
        this._timerInterval = TimerManager.setInterval(() => {
            if (!this._gameStartTime) return;
            const elapsed = Date.now() - this._gameStartTime;
            const tEl = getElementIfExists('timerText');
            if (tEl) tEl.textContent = this._formatTime(elapsed);
        }, 1000);
    },
    stopTimer() {
        if (this._timerInterval) { TimerManager.clearInterval(this._timerInterval); this._timerInterval = null; }
        this._gameStartTime = null;
        const timerEl = getElementIfExists('gameTimer');
        if (timerEl) timerEl.style.display = 'none';
        const textEl = getElementIfExists('timerText');
        if (textEl) textEl.textContent = '00:00:00';
    },
    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const pad = n => n.toString().padStart(2, '0');
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    },
    toMenu() {
        this.stopTimer();
        this.isRunning = false; this.entities.clear(); this.player = null; SystemUI.close();
        if (NPCDialogue) NPCDialogue.close();
        if (ShopSystem) ShopSystem.close();
        if (EnhanceSystem) EnhanceSystem.close();
        // EventBus 解耦：取消拾取事件订阅，避免重复
        if (this._onPickup) EventBus.off('player:pickup', this._onPickup);
        const menuLayer = getElement('menuLayer'); const uiLayer = getElement('uiLayer'); const gameLayer = getElement('gameLayer'); if (menuLayer) menuLayer.classList.remove('hidden'); if (uiLayer) uiLayer.style.display = 'none'; if (gameLayer) gameLayer.style.display = 'none';
    },
    setupWeaponSwitchButtons() {
        // quickMelee/quickRanged buttons are optional; weapon switching via F key always works
    }

};
