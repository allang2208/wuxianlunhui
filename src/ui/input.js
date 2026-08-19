import { Game } from '../game.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { UIState } from './ui-state.js';
import { EffectManager } from '../effects/effect-manager.js';
import { CONFIG } from '../config/config.js';
import { NPCDialogue } from './npc-dialogue.js';
import { ShopSystem } from './shop-system.js';
import { EnhanceSystem } from './enhance-system.js';
import { CraftSystem } from './craft-system.js';
import { EnchantSystem } from './enchant-system.js';
import { QuestSystem } from './quest-system.js';
import { QuickBar } from './quick-bar.js';
import { WarehouseSystem } from './warehouse-system.js';
import { FusionSystem } from './fusion-system.js';
import { SystemUI } from './system-ui.js';
import { ExpeditionSystem } from './expedition-system.js';
import { GameMenu } from './game-menu.js';
import DevTool from './dev-tool.js';
import { TimerManager } from '../utils/timer-manager.js';
        export const Input = {
            keys: new Set(),
            mouse: { x: 0, y: 0, leftDown: false, rightDown: false, leftPressed: false, rightPressed: false },
            _droneKeyHeldCode: null, // 正在按住无人机技能键的 keyCode（长按检测）
            _chargeKeyHeldCode: null, // 正在按住雷枪蓄力键的 keyCode（长按蓄力检测）
            init() {
    window.addEventListener('keydown', e => { this.keys.add(e.code); this.handleKey(e.code, e.altKey); });
                window.addEventListener('keyup', e => {
                    this.keys.delete(e.code);
                    // 无人机技能键松开：短按/长按在 QuickBar 侧判定
                    if (this._droneKeyHeldCode === e.code) {
                        this._droneKeyHeldCode = null;
                        QuickBar.droneKeyUp(e.code);
                    }
                    // 雷枪蓄力键松开：蓄力时长满足则释放，不足则失败（QuickBar/系统侧判定）
                    if (this._chargeKeyHeldCode === e.code) {
                        this._chargeKeyHeldCode = null;
                        QuickBar.thunderLanceKeyUp(e.code);
                    } else if (QuickBar.isThunderLanceKey(e.code)) {
                        // 兜底：第一次进入游戏时绑定可能尚未就绪（keydown 走了 useSlot 未记录长按键），
                        // 松开时只要该键已绑定雷枪且正在蓄力，一律释放，避免蓄力到满
                        const _p = window.Game && window.Game.player;
                        if (_p && _p.thunderLanceSystem && _p.thunderLanceSystem.isCharging()) {
                            _p.thunderLanceSystem.release();
                        }
                    }
                });
                window.addEventListener('blur', () => {
                    this.keys.clear(); this.mouse.leftDown = false; this.mouse.rightDown = false; this._droneKeyHeldCode = null;
                    // 失焦视同松开：雷枪蓄力按当前时长释放（不足最短蓄力则失败）
                    if (this._chargeKeyHeldCode) {
                        const code = this._chargeKeyHeldCode;
                        this._chargeKeyHeldCode = null;
                        QuickBar.thunderLanceKeyUp(code);
                    }
                });
                window.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
                window.addEventListener('mousedown', e => {
                    if (Game._wallEditMode || Game._collisionEditMode || Game._buildMode) return; // 墙壁/碰撞/建筑编辑模式：鼠标交给编辑器，不触发攻击
                    // DOM 覆盖层点击不进入世界点击（组队栏/队员面板/招募界面等）：
                    // 并行新增 BuildingSystem.tryInteract 后，漏拦截会误开建筑面板
                    const isSystemUI = e.target.closest('.system-panel, .panel-overlay, .side-menu, .back-menu-btn, .menu-btn, .party-bar, .companion-overlay, .recruit-overlay, .rts-command-btn, .rts-unit-panel');
                    if (e.button === 0) { this.mouse.leftDown = true; if (!isSystemUI) this.mouse.leftPressed = true; }
                    if (e.button === 2) { this.mouse.rightDown = true; if (!isSystemUI) this.mouse.rightPressed = true; }
                });
                window.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.leftDown = false; if (e.button === 2) this.mouse.rightDown = false; });
                window.addEventListener('contextmenu', e => e.preventDefault());
                // Electron 打包版：主进程 ESC 全局快捷键转发（globalShortcut 拦截系统级 ESC，
                // keydown 到不了渲染进程）——等效于本地按 ESC，走完整 MENU 键处理链
                window.addEventListener('electron-esc', () => this.handleKey(CONFIG.KEYS.MENU));
            },
    handleKey(code, altKey = false) {
                if (Game._wallEditMode || Game._collisionEditMode || Game._buildMode) return; // 墙壁/碰撞/建筑编辑模式：按键交给编辑器（捕获监听先处理）
                if (code === CONFIG.KEYS.PAUSE) {
                    Game._paused = !Game._paused;
                    // P 键暂停与菜单暂停同口径：冻结全部定时器（波次/计时/冷却等）
                    TimerManager.setPaused(Game._paused);
                    EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 50, Game._paused ? '游戏暂停' : '游戏继续', '#ffdd00'));
                    return;
                }
                if (code === CONFIG.KEYS.MENU) {
                    // 任务栏打开时按ESC关闭任务栏
                    if (UIState.isOpen('quest')) {
                        QuestSystem.close();
                        return;
                    }
                    // 有子页面打开：按 Esc 回到初始对话
                    if (UIState.isOpen('shop') || UIState.isOpen('enhance') || UIState.isOpen('craft') || UIState.isOpen('enchant') || UIState.isOpen('warehouse') || UIState.isOpen('fusion')) {
                        if (UIState.isOpen('shop')) ShopSystem.close();
                        if (UIState.isOpen('enhance')) EnhanceSystem.close();
                        if (UIState.isOpen('craft')) CraftSystem.close();
                        if (UIState.isOpen('enchant')) EnchantSystem.close();
                        if (UIState.isOpen('warehouse')) WarehouseSystem.close();
                        if (UIState.isOpen('fusion')) FusionSystem.close();
                        if (NPCDialogue._active) {
                            // 子页面（商店/强化/附魔/改造等）ESC 只退回对话主界面：
                            // 同步关闭子页面配套的背包面板——各子系统 close() 里的
                            // SystemUI.close() 有 300ms 延迟，不立即关会让紧接着的
                            // 第二次 ESC 仍被下方 SystemUI 分支拦截（需按第三次才退出对话）。
                            SystemUI.close();
                            NPCDialogue.exitCompactMode();
                        }
                        return;
                    }
                    if (SystemUI.isOpen) {
                    // 如果出征面板打开，ESC返回主城
                    if (UIState.isOpen('expedition')) {
                        ExpeditionSystem.returnToMain();
                        return;
                    }
                    SystemUI.close(); return;
                }
                    if (NPCDialogue._active) { NPCDialogue.goodbye(); return; }
                    if (Game.isRunning) GameMenu.toggle(); return;
                }
                if (SystemUI.isOpen) {
                    // 面板打开时：允许Tab切换快捷键，允许F切换武器，允许Z范围拾取，其他按键拦截
                    if (code === CONFIG.KEYS.INVENTORY || code === CONFIG.KEYS.BACKPACK) { SystemUI.toggle('equip'); return; }
                    if (code === CONFIG.KEYS.STATUS) { SystemUI.toggle('status'); return; }
                    if (code === CONFIG.KEYS.SKILL) { SystemUI.toggle('skill'); return; }
                    if (code === CONFIG.KEYS.CODEX) { SystemUI.toggle('codex'); return; }
                    if (code === CONFIG.KEYS.QUEST) { if (QuestSystem) QuestSystem.toggle(); return; }
                    if (code === 'KeyF' && Game.player) { Game.player.switchWeaponMode(); return; }
                    if (code === 'KeyZ' && Game.isRunning) { Game._pickupNearbyFlag = true; return; }
                    return; // 其他按键在面板打开时忽略
                }
                if (code === CONFIG.KEYS.INVENTORY || code === CONFIG.KEYS.BACKPACK) SystemUI.toggle('equip');
                if (code === CONFIG.KEYS.STATUS) SystemUI.toggle('status');
                if (code === CONFIG.KEYS.SKILL) SystemUI.toggle('skill');
                if (code === CONFIG.KEYS.CODEX) SystemUI.toggle('codex');
                if (code === CONFIG.KEYS.QUEST) { if (QuestSystem) QuestSystem.toggle(); }
                if (code === CONFIG.KEYS.SKILL_Q || code === CONFIG.KEYS.SKILL_E || code === CONFIG.KEYS.SKILL_R || code === CONFIG.KEYS.SKILL_C) {
                    // 雷枪蓄力键：按下即开始蓄力，松开/满蓄释放（<0.5s 失败不进 CD）
                    if (QuickBar.isThunderLanceKey(code)) {
                        if (!this._chargeKeyHeldCode) {
                            this._chargeKeyHeldCode = code;
                            QuickBar.thunderLanceKeyDown(code);
                        }
                    } else if (QuickBar.isDroneSkillKey(code)) {
                        // 无人机技能键：按下只记录，松开时按持有时长区分短按(toggle)/长按(指挥飞行)
                        if (!this._droneKeyHeldCode) {
                            this._droneKeyHeldCode = code;
                            QuickBar.droneKeyDown(code);
                        }
                    } else {
                        QuickBar.useSlot(code, altKey);
                    }
                }
                // 指挥模式下数字键归编队（Ctrl 编/Shift 加/直按选中），快捷栏让位（2026-08-19 RTS 化）
                const _rtsDigits = Game.RTSCommand && Game.RTSCommand.enabled;
                if (!_rtsDigits && (code === CONFIG.KEYS.ITEM_1 || code === CONFIG.KEYS.ITEM_2 || code === CONFIG.KEYS.ITEM_3 || code === CONFIG.KEYS.ITEM_4)) QuickBar.useSlot(code);
                if (code === 'KeyF' && Game.player) {
                    Game.player.switchWeaponMode();
                }
                if (code === 'KeyR' && Game.player) {
                    Game.player.reloadCurrentWeapon();
                }
                if (code === 'KeyZ' && Game.isRunning) {
                    Game._pickupNearbyFlag = true;
                }
                if (code === CONFIG.KEYS.DEV_TOOL) {
                    DevTool.toggle();
                }
            },
            update() { this.mouse.leftPressed = false; this.mouse.rightPressed = false; },
            isPressed(key) { return this.keys.has(key); },
            getMovement() {
                let dx = 0, dy = 0;
                if (this.isPressed(CONFIG.KEYS.W)) dy -= 1;
                if (this.isPressed(CONFIG.KEYS.S)) dy += 1;
                if (this.isPressed(CONFIG.KEYS.A)) dx -= 1;
                if (this.isPressed(CONFIG.KEYS.D)) dx += 1;
                if (dx !== 0 && dy !== 0) { const len = Math.sqrt(dx*dx + dy*dy); dx /= len; dy /= len; }
                return { x: dx, y: dy };
            },
            isSprint() { return this.isPressed(CONFIG.KEYS.SHIFT); }
        };
