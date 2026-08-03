/**
 * 游戏菜单（左上角菜单按钮）
 * 暂停游戏 + 全屏覆盖层，包含三个入口：
 *   - 返回游戏：关闭菜单、恢复游戏
 *   - 设置：音量（主音量）与背景音量（BGM）两个滚动条
 *   - 退出游戏：Electron 打包版经 preload IPC 退出；浏览器环境回退 window.close
 */
import { Game } from '../game.js';
import { PhaserGame } from '../phaser/PhaserGame.js';
import { SoundManager } from './sound-manager.js';
import { SystemUI } from './system-ui.js';
import { NPCDialogue } from './npc-dialogue.js';
import { ShopSystem } from './shop-system.js';
import { EnhanceSystem } from './enhance-system.js';
import { CraftSystem } from './craft-system.js';
import { EnchantSystem } from './enchant-system.js';
import { WarehouseSystem } from './warehouse-system.js';
import { ExpeditionSystem } from './expedition-system.js';
import { FusionSystem } from './fusion-system.js';
import { QuestSystem } from './quest-system.js';
import { UIState } from './ui-state.js';
import { TimerManager } from '../utils/timer-manager.js';

export const GameMenu = {
    _overlay: null,
    _open: false,

    init() {
        if (this._overlay) return;
        this._build();
    },

    _build() {
        const overlay = document.createElement('div');
        overlay.id = 'gameMenuOverlay';
        overlay.className = 'game-menu-overlay';
        overlay.style.display = 'none';

        const panel = document.createElement('div');
        panel.className = 'game-menu-panel';

        const title = document.createElement('div');
        title.className = 'game-menu-title';
        title.textContent = '游戏菜单';
        panel.appendChild(title);

        // ===== 主菜单视图 =====
        const mainView = document.createElement('div');
        mainView.className = 'game-menu-view';
        mainView.id = 'gameMenuMainView';
        const actions = [
            { label: '▶ 返回游戏', action: 'resume' },
            { label: '⚙ 设置', action: 'settings' },
            { label: '✕ 退出游戏', action: 'exit', danger: true },
        ];
        for (const a of actions) {
            const btn = document.createElement('button');
            btn.className = 'game-menu-btn' + (a.danger ? ' danger' : '');
            btn.textContent = a.label;
            btn.addEventListener('click', () => this._onAction(a.action));
            mainView.appendChild(btn);
        }
        panel.appendChild(mainView);

        // ===== 设置视图 =====
        const settingsView = document.createElement('div');
        settingsView.className = 'game-menu-view hidden';
        settingsView.id = 'gameMenuSettingsView';

        const subTitle = document.createElement('div');
        subTitle.className = 'game-menu-subtitle';
        subTitle.textContent = '设置';
        settingsView.appendChild(subTitle);

        settingsView.appendChild(this._buildSlider('master', '音量', '主音量，作用于所有声音'));
        settingsView.appendChild(this._buildSlider('music', '背景音量', '地牢模式中播放的 BGM'));

        // 全屏切换（Electron 打包版经 preload IPC；浏览器开发环境禁用）
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.className = 'game-menu-btn';
        fullscreenBtn.id = 'gameMenuFullscreenBtn';
        fullscreenBtn.addEventListener('click', () => {
            if (window.electronAPI && typeof window.electronAPI.toggleFullscreen === 'function') {
                window.electronAPI.toggleFullscreen();
            }
        });
        settingsView.appendChild(fullscreenBtn);

        const backBtn = document.createElement('button');
        backBtn.className = 'game-menu-btn';
        backBtn.textContent = '← 返回';
        backBtn.addEventListener('click', () => this._onAction('back'));
        settingsView.appendChild(backBtn);

        panel.appendChild(settingsView);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        this._overlay = overlay;
        this._mainView = mainView;
        this._settingsView = settingsView;
        this._masterSlider = overlay.querySelector('#gameMenuMasterVol');
        this._masterVal = overlay.querySelector('#gameMenuMasterVal');
        this._musicSlider = overlay.querySelector('#gameMenuMusicVol');
        this._musicVal = overlay.querySelector('#gameMenuMusicVal');
        // Electron 打包版：主进程全屏状态变化 → 按钮文案同步
        window.addEventListener('electron-fullscreen-change', (e) => {
            this._syncFullscreenLabel(!!e.detail);
        });
    },

    _buildSlider(key, label, desc) {
        const row = document.createElement('div');
        row.className = 'game-menu-setting-row';

        const lab = document.createElement('span');
        lab.className = 'game-menu-setting-label';
        lab.textContent = label;
        lab.title = desc;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.01';
        slider.id = key === 'master' ? 'gameMenuMasterVol' : 'gameMenuMusicVol';

        const val = document.createElement('span');
        val.className = 'game-menu-setting-value';
        val.id = key === 'master' ? 'gameMenuMasterVal' : 'gameMenuMusicVal';

        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            if (key === 'master') SoundManager.setVolume(v);
            else SoundManager.setChannelVolume('music', v);
            val.textContent = Math.round(v * 100) + '%';
        });

        row.appendChild(lab);
        row.appendChild(slider);
        row.appendChild(val);
        return row;
    },

    /** 打开菜单时同步滑块与当前音量（含持久化读回的数值） */
    _syncSliders() {
        if (!this._masterSlider) return;
        const mv = SoundManager.masterVolume ?? 0.6;
        this._masterSlider.value = String(mv);
        this._masterVal.textContent = Math.round(mv * 100) + '%';
        const mu = SoundManager.getChannelVolume('music');
        this._musicSlider.value = String(mu);
        this._musicVal.textContent = Math.round(mu * 100) + '%';
    },

    /** 同步"全屏切换"按钮：打包版显示当前状态，浏览器开发环境禁用 */
    _syncFullscreenLabel(isFullscreen) {
        const btn = this._overlay && this._overlay.querySelector('#gameMenuFullscreenBtn');
        if (!btn) return;
        const hasElectron = !!(window.electronAPI && typeof window.electronAPI.toggleFullscreen === 'function');
        if (!hasElectron) {
            btn.textContent = '⛶ 全屏模式（仅打包版可用）';
            btn.disabled = true;
            return;
        }
        btn.disabled = false;
        if (isFullscreen === undefined) {
            // 打开菜单时主动查询当前状态（did-finish-load 的初始事件可能与本模块初始化竞态）
            if (window.electronAPI && typeof window.electronAPI.getFullscreen === 'function') {
                window.electronAPI.getFullscreen()
                    .then((fs) => { btn.textContent = fs ? '⛶ 全屏模式：开' : '⛶ 全屏模式：关'; })
                    .catch(() => { btn.textContent = '⛶ 切换全屏'; });
            } else {
                btn.textContent = '⛶ 切换全屏';
            }
        } else {
            btn.textContent = isFullscreen ? '⛶ 全屏模式：开' : '⛶ 全屏模式：关';
        }
    },

    toggle() {
        if (this._open) this.close();
        else this.open();
    },

    open() {
        if (this._open) return;
        this._open = true;
        this._closePanels();
        this._showView('main');
        this._syncSliders();
        this._syncFullscreenLabel();
        if (this._overlay) this._overlay.style.display = 'flex';
        // 双重暂停：旧循环（实体逻辑） + Phaser 循环（渲染/动画）
        if (Game) Game._paused = true;
        // 冻结 JS 定时器（波次/冷却/计时等不随菜单继续跑）
        TimerManager.pause();
        try {
            if (PhaserGame && PhaserGame.game && typeof PhaserGame.game.pause === 'function') {
                PhaserGame.game.pause();
            }
        } catch (e) { console.error('Phaser pause failed:', e); }
        const btn = document.getElementById('backMenuBtn');
        if (btn) btn.classList.add('active');
    },

    close() {
        if (!this._open) return;
        this._open = false;
        if (this._overlay) this._overlay.style.display = 'none';
        TimerManager.resume();
        if (Game) Game._paused = false;
        try {
            if (PhaserGame && PhaserGame.game && typeof PhaserGame.game.resume === 'function') {
                PhaserGame.game.resume();
            }
        } catch (e) { console.error('Phaser resume failed:', e); }
        const btn = document.getElementById('backMenuBtn');
        if (btn) btn.classList.remove('active');
    },

    _showView(name) {
        if (!this._mainView || !this._settingsView) return;
        this._mainView.classList.toggle('hidden', name !== 'main');
        this._settingsView.classList.toggle('hidden', name !== 'settings');
    },

    _onAction(action) {
        switch (action) {
            case 'resume': this.close(); break;
            case 'settings': this._showView('settings'); break;
            case 'back': this._showView('main'); break;
            case 'exit': this._exitGame(); break;
        }
    },

    /** 菜单打开时收起所有交互面板（与 game.js 关闭面板同口径） */
    _closePanels() {
        // 单个面板关闭失败不阻断其余面板收起
        const safe = (fn) => { try { fn(); } catch (_e) { /* 忽略单个面板关闭异常 */ } };
        safe(() => NPCDialogue && NPCDialogue.close());
        safe(() => ShopSystem && ShopSystem.close());
        safe(() => EnhanceSystem && EnhanceSystem.close());
        safe(() => CraftSystem && CraftSystem.close());
        safe(() => EnchantSystem && EnchantSystem.close());
        safe(() => SystemUI && SystemUI.close());
        safe(() => WarehouseSystem && WarehouseSystem.close());
        safe(() => UIState.isOpen('quest') && QuestSystem && QuestSystem.close());
        safe(() => UIState.isOpen('expedition') && ExpeditionSystem && ExpeditionSystem.close());
        safe(() => UIState.isOpen('fusion') && FusionSystem && FusionSystem.close());
    },

    _exitGame() {
        // Electron 打包版：preload 暴露的 exitApp → IPC 'exit-app' → app.quit()
        // 浏览器开发环境：window.close()（多数浏览器会忽略，仅 Electron 保证生效）
        try {
            if (window.electronAPI && typeof window.electronAPI.exitApp === 'function') {
                window.electronAPI.exitApp();
            } else {
                window.close();
            }
        } catch (e) {
            console.error('退出游戏失败:', e);
        }
    },
};
