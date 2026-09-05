/**
 * 游戏菜单与开始界面共用设置：仅游戏内入口暂停/恢复游戏。
 * 全屏覆盖层包含四个入口：
 *   - 返回游戏：关闭菜单、恢复游戏
 *   - 操作说明：集中展示移动、战斗与面板快捷键
 *   - 设置：声音、单位显示、环境光影、居民动画、后台运行与窗口模式
 *   - 退出游戏：Electron 打包版经 preload IPC 退出；浏览器环境回退 window.close
 */
import { Game } from '../game.js';
import { GameRuntime } from '../utils/game-runtime.js';
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
import { TopNotificationQueue } from './top-notification-queue.js';
import { UnitDisplaySettings } from './unit-display-settings.js';
import { EnvironmentLightingSettings } from './environment-lighting-settings.js';
import { CivilianVisualSettings } from '../world/civilian-visual-runtime.js';

const CONTROL_GUIDE = [
    ['WASD / 鼠标', '移动 / 瞄准'],
    ['鼠标左键 / 右键', '攻击 / 特殊攻击'],
    ['空格 / Shift', '闪避 / 冲刺'],
    ['F / R', '切换武器 / 换弹'],
    ['1~4', '快捷栏'],
    ['Q / E / X / C', '技能'],
    ['Z', '范围拾取'],
    ['CapsLock', '状态栏'],
    ['Tab / K / U / L', '背包 / 技能 / 图鉴 / 任务'],
    ['P / O', '队员管理 / 世界'],
    ['Esc', '打开或关闭暂停菜单'],
];

export const GameMenu = {
    _overlay: null,
    _open: false,
    _origin: 'game',
    _view: 'main',
    _returnFocus: null,

    init() {
        if (this._overlay) return;
        this._build();
        // 原生 button 默认会把 Space 当作激活键。菜单已有 Esc 快捷键，
        // 因此即使玩家用 Tab 聚焦左上角按钮，也让 Space 继续进入游戏动作链。
        document.getElementById('backMenuBtn')?.addEventListener('keydown', (event) => {
            if (event.code === 'Space') event.preventDefault();
        });
    },

    _build() {
        const overlay = document.createElement('div');
        overlay.id = 'gameMenuOverlay';
        overlay.className = 'game-menu-overlay';
        overlay.style.display = 'none';

        const panel = document.createElement('div');
        panel.className = 'game-menu-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'gameMenuTitle');
        panel.tabIndex = -1;

        const header = document.createElement('div');
        header.className = 'game-menu-header';
        const title = document.createElement('h2');
        title.id = 'gameMenuTitle';
        title.className = 'game-menu-title';
        title.textContent = '游戏菜单';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'game-menu-btn game-menu-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => this.close());
        header.append(title, closeBtn);
        panel.appendChild(header);

        // ===== 主菜单视图 =====
        const mainView = document.createElement('div');
        mainView.className = 'game-menu-view';
        mainView.id = 'gameMenuMainView';
        const actions = [
            { label: '▶ 返回游戏', action: 'resume' },
            { label: '⌨ 操作说明', action: 'controls' },
            { label: '⚙ 设置', action: 'settings' },
            { label: '✕ 退出游戏', action: 'exit', danger: true },
        ];
        for (const a of actions) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'game-menu-btn' + (a.danger ? ' danger' : '');
            btn.textContent = a.label;
            btn.addEventListener('click', () => this._onAction(a.action));
            mainView.appendChild(btn);
        }
        panel.appendChild(mainView);

        // ===== 操作说明视图 =====
        const controlsView = document.createElement('div');
        controlsView.className = 'game-menu-view hidden';
        controlsView.id = 'gameMenuControlsView';

        const controlsList = document.createElement('div');
        controlsList.className = 'game-menu-controls';
        for (const [key, description] of CONTROL_GUIDE) {
            const row = document.createElement('div');
            row.className = 'game-menu-control-row';

            const keyLabel = document.createElement('span');
            keyLabel.className = 'game-menu-control-key';
            keyLabel.textContent = key;

            const actionLabel = document.createElement('span');
            actionLabel.className = 'game-menu-control-action';
            actionLabel.textContent = description;

            row.append(keyLabel, actionLabel);
            controlsList.appendChild(row);
        }
        controlsView.appendChild(controlsList);

        const controlsBackBtn = document.createElement('button');
        controlsBackBtn.type = 'button';
        controlsBackBtn.className = 'game-menu-btn';
        controlsBackBtn.textContent = '← 返回';
        controlsBackBtn.addEventListener('click', () => this._onAction('back'));
        controlsView.appendChild(controlsBackBtn);

        panel.appendChild(controlsView);

        // ===== 设置视图 =====
        const settingsView = document.createElement('div');
        settingsView.className = 'game-menu-view hidden';
        settingsView.id = 'gameMenuSettingsView';

        const settingsScroll = document.createElement('div');
        settingsScroll.className = 'game-menu-settings-scroll';
        const audioSection = this._buildSettingsSection('声音', '音量调整即时生效');
        audioSection.appendChild(this._buildSlider('master', '主音量', '控制所有音效与音乐'));
        audioSection.appendChild(this._buildSlider('music', '背景音量', '控制场景与地牢背景音乐'));
        settingsScroll.append(audioSection, this._buildUnitDisplaySettings(), this._buildEnvironmentLightingSettings());

        const settingsSide = document.createElement('div');
        settingsSide.className = 'game-menu-settings-side';
        settingsSide.appendChild(this._buildBackgroundRunSettings());
        settingsSide.appendChild(this._buildCivilianVisualSettings());
        const windowSection = this._buildSettingsSection('窗口模式', '全屏切换仅在打包版中可用');

        // 全屏切换（Electron 打包版经 preload IPC；浏览器开发环境禁用）
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.type = 'button';
        fullscreenBtn.className = 'game-menu-btn';
        fullscreenBtn.id = 'gameMenuFullscreenBtn';
        fullscreenBtn.addEventListener('click', () => {
            if (window.electronAPI && typeof window.electronAPI.toggleFullscreen === 'function') {
                window.electronAPI.toggleFullscreen();
            }
        });
        windowSection.appendChild(fullscreenBtn);
        settingsSide.appendChild(windowSection);
        settingsScroll.appendChild(settingsSide);
        settingsView.appendChild(settingsScroll);

        const settingsFooter = document.createElement('div');
        settingsFooter.className = 'game-menu-settings-footer';
        const settingsHint = document.createElement('p');
        settingsHint.className = 'game-menu-settings-hint';
        settingsHint.textContent = '调整立即生效，无需另行确认';
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'game-menu-btn game-menu-back';
        backBtn.addEventListener('click', () => this._onAction('back'));
        settingsFooter.append(settingsHint, backBtn);
        settingsView.appendChild(settingsFooter);

        panel.appendChild(settingsView);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        this._overlay = overlay;
        this._panel = panel;
        this._title = title;
        this._closeBtn = closeBtn;
        this._settingsBackBtn = backBtn;
        this._settingsScroll = settingsScroll;
        this._mainView = mainView;
        this._controlsView = controlsView;
        this._settingsView = settingsView;
        this._masterSlider = overlay.querySelector('#gameMenuMasterVol');
        this._masterVal = overlay.querySelector('#gameMenuMasterVal');
        this._musicSlider = overlay.querySelector('#gameMenuMusicVol');
        this._musicVal = overlay.querySelector('#gameMenuMusicVal');
        GameRuntime.subscribeSettings(() => this._syncBackgroundRunSettings());
        this._syncBackgroundRunSettings();
        // GameMenu.init 早于 Input.init；菜单开启时独占此链，空白区失焦也不穿透。
        // 不阻止原生控件的默认行为，保留方向键、空格与下拉框操作。
        window.addEventListener('keydown', (event) => {
            if (!this._open) return;
            event.stopImmediatePropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                if (!event.repeat) this._onAction('back');
            } else if (event.key === 'Tab') {
                this._trapFocus(event);
            }
        });
        // 开始界面也能处理 EXE 转发的 Esc，消费后不再落入游戏 MENU 链。
        window.addEventListener('electron-esc', (event) => {
            if (!this._open) return;
            event.stopImmediatePropagation();
            this._onAction('back');
        }, true);
        // Electron 打包版：主进程全屏状态变化 → 按钮文案同步
        window.addEventListener('electron-fullscreen-change', (e) => {
            this._syncFullscreenLabel(!!e.detail);
        });
    },

    _buildSettingsSection(label, description) {
        const section = document.createElement('section');
        section.className = 'game-menu-settings-section';
        const title = document.createElement('h3');
        title.className = 'game-menu-unit-display-title';
        title.textContent = label;
        const hint = document.createElement('p');
        hint.className = 'game-menu-unit-display-hint';
        hint.textContent = description;
        section.append(title, hint);
        return section;
    },

    _buildSlider(key, label, desc) {
        const row = document.createElement('div');
        row.className = 'game-menu-setting-row';

        const lab = document.createElement('label');
        lab.className = 'game-menu-setting-label';
        lab.textContent = label;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.01';
        slider.id = key === 'master' ? 'gameMenuMasterVol' : 'gameMenuMusicVol';
        lab.htmlFor = slider.id;
        const hint = document.createElement('span');
        hint.className = 'game-menu-setting-description';
        hint.id = slider.id + 'Hint';
        hint.textContent = desc;
        slider.setAttribute('aria-describedby', hint.id);

        const val = document.createElement('span');
        val.className = 'game-menu-setting-value';
        val.id = key === 'master' ? 'gameMenuMasterVal' : 'gameMenuMusicVal';

        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            if (key === 'master') SoundManager.setVolume(v);
            else SoundManager.setChannelVolume('music', v);
            val.textContent = Math.round(v * 100) + '%';
            slider.setAttribute('aria-valuetext', val.textContent);
        });

        row.append(lab, val, slider, hint);
        return row;
    },

    _buildUnitDisplaySettings() {
        const section = this._buildSettingsSection('单位显示', '分别控制怪物与友军的名称、血条');
        section.classList.add('game-menu-unit-display');

        const options = [
            ['enemy', '怪物'],
            ['friendly', '友军'],
        ];
        const labels = [
            ['showHealthBar', '显示血条'],
            ['showName', '显示名称'],
            ['showFullHealth', '满血显示'],
        ];
        for (const [faction, factionLabel] of options) {
            const group = document.createElement('fieldset');
            group.className = 'game-menu-unit-display-group';
            const legend = document.createElement('legend');
            legend.textContent = factionLabel;
            group.appendChild(legend);

            for (const [key, label] of labels) {
                const row = document.createElement('label');
                row.className = 'game-menu-unit-display-option';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.dataset.unitDisplayFaction = faction;
                input.dataset.unitDisplayKey = key;
                input.addEventListener('change', () => {
                    UnitDisplaySettings.set(faction, key, input.checked);
                });
                const text = document.createElement('span');
                text.textContent = label;
                row.append(input, text);
                group.appendChild(row);
            }
            section.appendChild(group);
        }
        return section;
    },

    _buildEnvironmentLightingSettings() {
        const section = this._buildSettingsSection('环境光影', '接触阴影与树木、建筑投影共用太阳状态');

        const group = document.createElement('fieldset');
        group.className = 'game-menu-unit-display-group';
        const legend = document.createElement('legend');
        legend.textContent = '阴影';
        group.appendChild(legend);

        const options = [
            ['enabled', '启用阴影'],
            ['animateSun', '太阳移动'],
            ['staticEnabled', '树木/建筑投影'],
            ['ambientEnabled', '昼夜环境色'],
            ['localGlowEnabled', '火把/枪火亮光'],
        ];
        for (const [key, label] of options) {
            const row = document.createElement('label');
            row.className = 'game-menu-unit-display-option';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.environmentLightingKey = key;
            input.addEventListener('change', () => {
                EnvironmentLightingSettings.set(key, input.checked);
            });
            const text = document.createElement('span');
            text.textContent = label;
            row.append(input, text);
            group.appendChild(row);
        }
        const qualityRow = document.createElement('label');
        qualityRow.className = 'game-menu-unit-display-option';
        const qualityText = document.createElement('span');
        qualityText.textContent = '阴影质量';
        const quality = document.createElement('select');
        quality.dataset.environmentLightingQuality = 'true';
        for (const [value, label] of [['low', '低'], ['medium', '中'], ['high', '高']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            quality.appendChild(option);
        }
        quality.addEventListener('change', () => {
            EnvironmentLightingSettings.set('quality', quality.value);
        });
        qualityRow.append(qualityText, quality);
        group.appendChild(qualityRow);
        section.appendChild(group);
        return section;
    },

    _buildCivilianVisualSettings() {
        const section = this._buildSettingsSection('居民动画与内存', '只影响非战斗仓鼠精灵；房屋、岗位与生产逻辑继续运行');
        const group = document.createElement('fieldset');
        group.className = 'game-menu-unit-display-group';
        const legend = document.createElement('legend');
        legend.textContent = '性能选项';
        group.appendChild(legend);
        const row = document.createElement('label');
        row.className = 'game-menu-unit-display-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.civilianAnimationsDisabled = 'true';
        input.addEventListener('change', () => CivilianVisualSettings.setDisabled(input.checked));
        const text = document.createElement('span');
        text.textContent = '取消非战斗居民动画（释放内存）';
        row.append(input, text);
        group.appendChild(row);
        section.appendChild(group);
        return section;
    },

    _buildBackgroundRunSettings() {
        const section = this._buildSettingsSection('后台运行', '切到其他窗口或最小化后，仍推进战斗、生产、世界时间与位面入侵；会继续占用电脑资源');
        const group = document.createElement('fieldset');
        group.className = 'game-menu-unit-display-group';
        const legend = document.createElement('legend');
        legend.textContent = '运行策略';
        const row = document.createElement('label');
        row.className = 'game-menu-unit-display-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'gameMenuBackgroundRun';
        input.setAttribute('aria-describedby', 'gameMenuBackgroundRunHint gameMenuBackgroundRunStatus');
        input.addEventListener('change', () => GameRuntime.setBackgroundRunning(input.checked));
        const label = document.createElement('span');
        label.textContent = '游戏在后台时仍然保持运行';
        row.append(input, label);
        group.append(legend, row);
        const hint = document.createElement('p');
        hint.id = 'gameMenuBackgroundRunHint';
        hint.className = 'game-menu-unit-display-hint';
        hint.textContent = '默认开启并自动保存。关闭后，进入后台自动暂停，回到前台继续。暂停菜单与科技树原有暂停规则始终保留；不支持睡眠、休眠或关闭游戏后继续运行。';
        const status = document.createElement('p');
        status.id = 'gameMenuBackgroundRunStatus';
        status.className = 'game-menu-settings-hint';
        status.setAttribute('role', 'status');
        section.append(group, hint, status);
        this._backgroundRunInput = input;
        this._backgroundRunStatus = status;
        return section;
    },

    _syncBackgroundRunSettings() {
        if (!this._backgroundRunInput) return;
        this._backgroundRunInput.checked = GameRuntime.isBackgroundRunningEnabled();
        const messages = {
            pending: '正在应用窗口运行设置…',
            ready: this._backgroundRunInput.checked ? '桌面版后台运行已开启。' : '桌面版已设为后台自动暂停。',
            browser: '浏览器版会尝试继续运行，但标签页节流或冻结仍可能使游戏减速或停止；完整支持需使用更新后的桌面版。',
            unavailable: '当前桌面壳尚未包含后台运行接口，需要更新桌面版后才能完整生效。',
            failed: '桌面后台运行设置未应用成功，请重试；当前无法保证后台持续运行。',
        };
        this._backgroundRunStatus.textContent = messages[GameRuntime.desktopStatus];
    },

    /** 打开菜单时同步滑块与当前音量（含持久化读回的数值） */
    _syncSliders() {
        if (!this._masterSlider) return;
        const mv = SoundManager.masterVolume ?? 0.6;
        this._masterSlider.value = String(mv);
        this._masterVal.textContent = Math.round(mv * 100) + '%';
        this._masterSlider.setAttribute('aria-valuetext', this._masterVal.textContent);
        const mu = SoundManager.getChannelVolume('music');
        this._musicSlider.value = String(mu);
        this._musicVal.textContent = Math.round(mu * 100) + '%';
        this._musicSlider.setAttribute('aria-valuetext', this._musicVal.textContent);
        this._syncUnitDisplaySettings();
        this._syncCivilianVisualSettings();
        this._syncEnvironmentLightingSettings();
        this._syncBackgroundRunSettings();
    },

    _syncUnitDisplaySettings() {
        if (!this._overlay) return;
        for (const input of this._overlay.querySelectorAll('input[data-unit-display-faction]')) {
            const faction = input.dataset.unitDisplayFaction;
            const key = input.dataset.unitDisplayKey;
            input.checked = !!UnitDisplaySettings.get(faction)[key];
        }
    },

    _syncEnvironmentLightingSettings() {
        if (!this._overlay) return;
        const settings = EnvironmentLightingSettings.get();
        for (const input of this._overlay.querySelectorAll('input[data-environment-lighting-key]')) {
            input.checked = !!settings[input.dataset.environmentLightingKey];
        }
        const quality = this._overlay.querySelector('select[data-environment-lighting-quality]');
        if (quality) quality.value = settings.quality || 'high';
    },

    _syncCivilianVisualSettings() {
        const input = this._overlay?.querySelector('input[data-civilian-animations-disabled]');
        if (input) input.checked = CivilianVisualSettings.isDisabled();
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

    /** 开始面板直达设置；复用相同控件、设置存储和刷新逻辑。 */
    openSettings(trigger = null) {
        if (this._open) {
            this._showView('settings');
            return;
        }
        this.open({ view: 'settings', trigger });
    },

    open({ view = 'main', trigger = null } = {}) {
        if (this._open) return;
        this.init();
        this._open = true;
        this._origin = Game.isRunning ? 'game' : 'start';
        const fallback = document.getElementById(this._origin === 'start' ? 'startSettingsBtn' : 'backMenuBtn');
        this._returnFocus = trigger || (document.activeElement !== document.body ? document.activeElement : fallback);
        this._overlay.dataset.origin = this._origin;
        if (this._origin === 'game') this._closePanels();
        this._closeBtn.setAttribute('aria-label', this._origin === 'start' ? '关闭设置，返回开始界面' : '关闭菜单，返回游戏');
        this._settingsBackBtn.textContent = this._origin === 'start' ? '返回开始界面' : '返回游戏菜单';
        this._syncSliders();
        this._syncFullscreenLabel();
        this._overlay.style.display = 'flex';
        this._showView(this._origin === 'start' ? 'settings' : view);
        this._settingsScroll.scrollTop = 0;
        if (this._origin === 'start') {
            // 不隐藏背景，也不触碰尚未开始的游戏循环/计时器。
            this._startContent = document.querySelector('#menuLayer .menu-content');
            this._startContentWasInert = this._startContent?.inert ?? false;
            if (this._startContent) this._startContent.inert = true;
            return;
        }
        // 单独持有菜单暂停原因；窗口恢复/设置切换不能释放它。
        GameRuntime.setPaused('menu', true);
        const btn = document.getElementById('backMenuBtn');
        if (btn) btn.classList.add('active');
    },

    close() {
        if (!this._open) return;
        this._open = false;
        if (this._overlay) this._overlay.style.display = 'none';
        const returnFocus = this._returnFocus;
        this._returnFocus = null;
        if (this._origin === 'game') {
            GameRuntime.setPaused('menu', false);
            document.getElementById('backMenuBtn')?.classList.remove('active');
            // 回到游戏后不把焦点交还给原生菜单按钮：浏览器会用 Space
            // 激活聚焦按钮，导致玩家闪避时重新打开菜单。
            document.activeElement?.blur?.();
        } else {
            if (this._startContent) {
                this._startContent.inert = this._startContentWasInert;
                this._startContent = null;
            }
            if (returnFocus?.isConnected && returnFocus.getClientRects().length) {
                returnFocus.focus({ preventScroll: true });
            }
        }
    },

    _showView(name) {
        if (!this._mainView || !this._controlsView || !this._settingsView) return;
        this._mainView.classList.toggle('hidden', name !== 'main');
        this._controlsView.classList.toggle('hidden', name !== 'controls');
        this._settingsView.classList.toggle('hidden', name !== 'settings');
        this._view = name;
        this._overlay.dataset.view = name;
        this._title.textContent = { main: '游戏菜单', controls: '操作说明', settings: '设置' }[name];
        const view = name === 'settings' ? this._settingsView : name === 'controls' ? this._controlsView : this._mainView;
        if (this._open) (view.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled)') || this._panel).focus({ preventScroll: true });
    },

    _trapFocus(event) {
        const focusable = [...this._panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
            .filter((node) => node.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) {
            event.preventDefault();
            this._panel.focus();
        } else if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    },

    _onAction(action) {
        switch (action) {
            case 'resume': this.close(); break;
            case 'controls': this._showView('controls'); break;
            case 'settings': this._showView('settings'); break;
            case 'back':
                if (this._origin === 'start' || this._view === 'main') this.close();
                else this._showView('main');
                break;
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
        TopNotificationQueue.clear();
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
