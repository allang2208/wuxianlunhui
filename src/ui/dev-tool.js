import { Game } from '../game.js';

import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { WeaponTransform } from '../combat/weapon-transform.js';
import { loadImage } from '../utils/image-loader.js';

import { AIDevTool } from './ai-dev-tool.js';
import { EnemySpriteTool } from './enemy-sprite-tool.js';
import { queryAllElements, getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';

// 交互式开发工具 - 武器定位与动画调试面板
const DevTool = {
    _active: false,
    _canvas: null,
    _ctx: null,
    _panel: null,
    _currentTab: 'weapon', // 当前选中的 tab

    // 状态
    state: {
        anim: 'idle',        // 当前动画: idle/walk/running/attack
        weaponType: 'sword', // 当前武器类型
        mode: 'move',        // 'move'=移动+缩放, 'rotate'=旋转
        weaponOnCanvas: false, // 武器是否已放到画布上
        frameIndex: 0,      // 当前帧索引（walk/running/attack）
        playProgress: 0,    // 当前动画播放进度 0~1（用于逐帧插值）
        isPlaying: false,   // 是否正在播放动画
    },

    // 武器参数（可调整）
    weaponParams: {
        offsetX: 0,   // 相对于角色中心的偏移
        offsetY: 30,  // 默认在角色上方（Y+向上，与绿色箭头一致）
        rotation: 0,  // 旋转角度（度）
        scale: 1.0,   // 缩放
    },

    // 拖拽状态
    drag: {
        active: false,
        startX: 0, startY: 0,
        startOffsetX: 0, startOffsetY: 0,
    },

    // 画布缩放
    zoom: {
        scale: 1.0,
        min: 0.5,
        max: 3.0,
        step: 0.25,
    },

    // 关键帧系统（攻击动画每帧武器位置）
    keyframeSystem: {
        enabled: false,           // 是否启用关键帧模式
        keyframes: [],            // 当前关键帧数组 [{progress, offsetX, offsetY, rotation, scale}]
        selectedIndex: -1,        // 当前选中的关键帧索引
        isRecording: false,       // 是否正在录制关键帧
    },

    // 挂载点编辑系统
    handAnchorSystem: {
        enabled: false,       // 是否启用挂载点编辑模式
        handAnchors: {        // 当前编辑的挂载点（相对于玩家中心）
            idle:    { x: 8,  y: -5 },
            walk:    { x: 10, y: -3 },
            running: { x: 12, y: -8 },
            attack:  { x: 15, y: -12 },
        },
        gripOffset: { x: 0, y: 32 }, // 握把偏移
        dragHand: false,      // 是否正在拖动手图标
        dragWeapon: false,    // 是否正在挂载点模式下拖动武器（调整 gripOffset）
        handStartX: 0, handStartY: 0,
        handAnchorStartX: 0, handAnchorStartY: 0,
        gripStartX: 0, gripStartY: 0,
    },

    // 图片缓存
    images: {},
    charImage: null,
    weaponImage: null,

    // 武器配置映射
    WEAPON_MAP: {
        sword:      { name: '生锈长剑',   img: 'assets/weapons/1-rusty_sword_euip.png', type: 'melee' },
        bow:        { name: '训练弓',     img: 'assets/weapons/trainingBOW.png',        type: 'bow',
                       frames: {
                           idle: ['assets/weapons/trainingBOW.png'],
                           bow_draw: Array.from({length: 8}, (_, i) => `assets/weapons/bow_frame_${String(i+1).padStart(2, '0')}.png`),
                           bow_release: ['assets/weapons/trainingBOW.png'],
                       }
                     },
        pistol:     { name: 'G18',        img: 'assets/weapons/G18equip.png',         type: 'pistol' },
        deagle:     { name: '沙漠之鹰',   img: 'assets/weapons/Desert eagle-eqiup.png',  type: 'pistol' },
        pkm:        { name: 'PKM',        img: 'assets/weapons/pkm_topdown.png',      type: 'machinegun' },
        akm:        { name: 'AKM',        img: 'assets/weapons/akm_topdown_lowpoly_v2长枪管.png', type: 'rifle' },
        qbz191:     { name: 'QBZ-191',    img: 'assets/weapons/191equip_clean.png',   type: 'rifle' },
        qjb201:     { name: 'QJB-201',    img: 'assets/weapons/201equip.png',         type: 'machinegun' },
        super90:    { name: 'Super90',    img: 'assets/weapons/M4s90_equip.png',      type: 'shotgun' },
        saiga12k:   { name: 'S12K',       img: 'assets/weapons/S12k-equip.png',       type: 'shotgun' },
        energy_lmg: { name: '能量轻机枪', img: 'assets/weapons/devotion-equip.png', type: 'machinegun' },
    },

    // 动画状态映射
    ANIM_NAME: {
        idle: '待机', walk: '移动', attack: '攻击',
        bow_draw: '拉弓', bow_release: '射箭',
        gun_idle: '持枪待机', gun_fire: '射击',
        reload: '换弹', hurt: '受击', death: '死亡',
    },

    init() {
        this._panel = getElement('devToolPanel');
        this._canvas = getElement('devToolCanvas');
        // 增大画布以容纳与游戏一致的角色缩放（703px）
        this._canvas.width = 640;
        this._canvas.height = 520;
        this._ctx = this._canvas.getContext('2d');
        this._loadImages();
        this._bindEvents();
        this._syncInputs();
        this._draw();
        this._updateFrameSlider();
        this._updateFrameLabel();
        this._updatePlayBtn();
        // 初始化 AI 开发工具
        AIDevTool.init();
        // 初始化怪物贴图调整工具
        EnemySpriteTool.init();
        window.EnemySpriteTool = EnemySpriteTool; // 挂载到全局，供游戏代码读取
    },

    // Tab 切换
    switchTab(tabName) {
        this._currentTab = tabName;
        // 更新 tab 按钮状态
        queryAllElements('.dev-tool-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        // 更新 tab 内容显示
        queryAllElements('.dev-tool-tab-content').forEach(content => {
            const contentTab = content.dataset.tabContent || content.dataset.tab;
            content.style.display = contentTab === tabName ? 'flex' : 'none';
            content.classList.toggle('active', contentTab === tabName);
        });
        // 显示/隐藏 AI 开发工具
        if (tabName === 'ai') {
            AIDevTool.show();
        } else {
            AIDevTool.hide();
        }
    },

    // 加载图片
    _loadImages() {
        // 使用新版角色待机贴图
        this.charImage = new Image();
        this.charImage.src = 'assets/character/idle.png';
        this.charImage.onload = () => this._draw();

        // 加载角色动画帧（使用新版奔跑帧）
        this._loadCharacterFrames();

        // 预加载所有武器图片
        for (const key in this.WEAPON_MAP) {
            this.images[key] = loadImage(this.WEAPON_MAP[key].img);
        }

        // 加载默认武器
        this._loadWeapon(this.state.weaponType);
    },

    _loadWeapon(type) {
        const cfg = this.WEAPON_MAP[type];
        if (!cfg) return;
        this.weaponImage = this.images[type];
        if (!this.weaponImage) {
            this.weaponImage = loadImage(cfg.img);
            this.images[type] = this.weaponImage;
        }
        this.weaponImage.onload = () => {
            // 计算基准缩放：让武器在 canvas 上显示约 80 像素
            const BASE_SIZE = 80;
            const imgW = this.weaponImage.naturalWidth;
            const imgH = this.weaponImage.naturalHeight;
            this._baseWeaponScale = Math.min(BASE_SIZE / imgW, BASE_SIZE / imgH, 1);
            // 预加载帧图片
            this._loadFrameImages(type);
            this._updateWeaponPreview();
            this._draw();
        };
        this._updateWeaponPreview();
        this._loadHandAnchorsFromConfig();
    },

    // 从 WeaponAnimConfig 加载 handAnchors / gripOffset
    _loadHandAnchorsFromConfig() {
        const wt = this.state.weaponType;
        const cfg = WeaponAnimConfig[wt];
        const sys = this.handAnchorSystem;
        if (cfg && cfg.handAnchors && typeof cfg.handAnchors === 'object') {
            sys.handAnchors = JSON.parse(JSON.stringify(cfg.handAnchors));
            sys.gripOffset = cfg.gripOffset ? { ...cfg.gripOffset } : { x: 0, y: 32 };
        } else {
            // 保持默认空白挂载点，避免污染未启用武器
            sys.handAnchors = { idle: { x: 0, y: 0 }, walk: { x: 0, y: 0 }, running: { x: 0, y: 0 }, attack: { x: 0, y: 0 } };
            sys.gripOffset = { x: 0, y: 32 };
        }
    },

    // 获取当前武器在 WeaponTransform 中的基础/旋转后偏移（用于反向计算）
    _getWeaponTransformBase() {
        return WeaponTransform.getWeaponBaseOffset(this.state.weaponType, false, false);
    },

    // 根据当前面板参数构造 WeaponTransform 的 overrides
    _buildPreviewOverrides() {
        const _animState = this.state.anim;
        const sys = this.handAnchorSystem;
        const overrides = {
            idleRotation: this.weaponParams.rotation,
            idleScale: this.weaponParams.scale,
        };

        if (sys.enabled) {
            // 挂载点模式：使用 handAnchors / gripOffset（weaponParams 不再覆盖手锚点）
            overrides.handAnchors = JSON.parse(JSON.stringify(sys.handAnchors));
            overrides.gripOffset = { ...sys.gripOffset };
        } else {
            // 传统模式：weaponParams.offsetX/Y 表示武器中心/握把位置
            const { baseX, baseY, afterX, afterY } = this._getWeaponTransformBase();
            overrides.holdOffsetX = this.weaponParams.offsetX - baseX - afterX;
            overrides.holdOffsetY = this.weaponParams.offsetY - baseY - afterY;
        }
        return overrides;
    },

    // 持久化 WeaponAnimConfig 到 Electron 文件系统（如果可用）
    _persistWeaponConfig() {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveWeaponConfig) {
            window.electronAPI.saveWeaponConfig(WeaponAnimConfig).catch(err => {
                console.error('[DevTool] Failed to persist weapon config:', err);
            });
        }
    },

    /**
     * 把当前配置（含关键帧、挂载点）直接加载到预览画布上
     * 切换动画/武器/按重置/拖动滑块时调用，避免用户每次都从空白开始拖动
     */
    _applyCurrentConfigToPreview() {
        const wt = this.state.weaponType;
        const anim = this.state.anim;
        const cfg = WeaponAnimConfig[wt];
        if (!cfg) return;

        const sys = this.handAnchorSystem;
        let offsetX, offsetY, rotation, scale;

        const perFrame = cfg && cfg.attack && cfg.attack.type === 'perFrame' ? cfg.attack.frames : null;
        if (perFrame && anim === 'attack') {
            // 逐帧模式：weaponParams 直接表示当前帧的武器状态
            const idx = Math.max(0, Math.min(this.state.frameIndex, perFrame.length - 1));
            const frame = perFrame[idx];
            offsetX = frame.offsetX || 0;
            offsetY = frame.offsetY || 0;
            rotation = frame.rotation || 0;
            scale = frame.scale !== undefined ? frame.scale : 1;
            this.state.playProgress = perFrame.length > 1 ? idx / (perFrame.length - 1) : 0;
        } else if (sys.enabled) {
            // 挂载点模式：weaponParams 表示手部挂载点 + 基础旋转/缩放
            const anchor = sys.handAnchors[anim] || sys.handAnchors.idle || { x: 0, y: 0 };
            const stateCfg = cfg[anim] || cfg;
            offsetX = anchor.x;
            offsetY = anchor.y;
            rotation = stateCfg.idleRotation !== undefined ? stateCfg.idleRotation : (cfg.idleRotation || 0);
            scale = stateCfg.idleScale !== undefined ? stateCfg.idleScale : (cfg.idleScale || 1);
        } else {
            // 传统模式：weaponParams 表示武器中心位置 + 基础旋转/缩放
            const overrides = this._buildPreviewOverrides();
            const localOffset = WeaponTransform.getWeaponLocalOffset(wt, 105, false, false, anim, true, overrides);
            offsetX = localOffset.x;
            offsetY = localOffset.y;
            rotation = (localOffset.idleRotation || 0) * 180 / Math.PI;
            scale = localOffset.scale || 1;
        }

        this.weaponParams = {
            offsetX: Math.round(offsetX),
            offsetY: Math.round(offsetY),
            rotation: Math.round(rotation),
            scale: parseFloat(scale.toFixed(2)),
        };
        this.state.weaponOnCanvas = true;
        this._syncInputs();
        this._draw();
    },

    // 根据当前 frameIndex 插值运行时关键帧，返回 { local, rotation }
    _getRuntimeKeyframeTransform() {
        const wt = this.state.weaponType;
        const anim = this.state.anim;
        const cfg = WeaponAnimConfig[wt];
        const runtimeKeyframes = cfg && cfg.keyframes && cfg.keyframes[wt] && cfg.keyframes[wt][anim];
        if (!runtimeKeyframes || runtimeKeyframes.length === 0) return null;

        const frameData = this._charFrames[anim];
        const frameCount = frameData && frameData.count ? frameData.count : 1;
        const progress = frameCount > 1 ? this.state.frameIndex / frameCount : 0;

        let prev = runtimeKeyframes[0], next = runtimeKeyframes[runtimeKeyframes.length - 1];
        for (let i = 0; i < runtimeKeyframes.length - 1; i++) {
            if (progress >= runtimeKeyframes[i].progress && progress <= runtimeKeyframes[i + 1].progress) {
                prev = runtimeKeyframes[i];
                next = runtimeKeyframes[i + 1];
                break;
            }
        }

        const segmentDuration = next.progress - prev.progress;
        const t = segmentDuration > 0 ? (progress - prev.progress) / segmentDuration : 0;

        const prevOffsetX = prev.handOffsetX !== undefined ? prev.handOffsetX : prev.holdOffsetX;
        const nextOffsetX = next.handOffsetX !== undefined ? next.handOffsetX : next.holdOffsetX;
        const prevOffsetY = prev.handOffsetY !== undefined ? prev.handOffsetY : prev.holdOffsetY;
        const nextOffsetY = next.handOffsetY !== undefined ? next.handOffsetY : next.holdOffsetY;

        const offsetX = (prevOffsetX !== undefined ? prevOffsetX : 0) +
            ((nextOffsetX !== undefined ? nextOffsetX : 0) - (prevOffsetX !== undefined ? prevOffsetX : 0)) * t;
        const offsetY = (prevOffsetY !== undefined ? prevOffsetY : 0) +
            ((nextOffsetY !== undefined ? nextOffsetY : 0) - (prevOffsetY !== undefined ? prevOffsetY : 0)) * t;
        const rot = (prev.rotation !== undefined ? prev.rotation : 0) +
            ((next.rotation !== undefined ? next.rotation : 0) - (prev.rotation !== undefined ? prev.rotation : 0)) * t;
        const scl = (prev.scale !== undefined ? prev.scale : 1) +
            ((next.scale !== undefined ? next.scale : 1) - (prev.scale !== undefined ? prev.scale : 1)) * t;

        const kfPos = WeaponTransform.getKeyframedWeaponPosition(
            { x: 0, y: 0, rotation: 0 }, wt, anim,
            { offsetX, offsetY, rotation: rot, scale: scl },
            0, true
        );

        const wSize = WeaponTransform.getWeaponSize(wt, scl, anim);
        return {
            local: { x: kfPos.x, y: kfPos.y, size: wSize.height / scl, scale: scl },
            rotation: kfPos.rotation,
        };
    },

    // 根据当前 playProgress 平滑插值逐帧配置
    _getPerFrameTransform() {
        const wt = this.state.weaponType;
        const anim = this.state.anim;
        const cfg = WeaponAnimConfig[wt];
        const perFrame = cfg && cfg.attack && cfg.attack.type === 'perFrame' ? cfg.attack.frames : null;
        if (!perFrame || anim !== 'attack') return null;

        const pos = WeaponTransform.getInterpolatedPerFramePosition(
            { x: 0, y: 0, rotation: 0 }, wt, this.state.playProgress || 0, true
        );
        if (!pos) return null;
        const wSize = WeaponTransform.getWeaponSize(wt, pos.scale, anim);
        return {
            local: { x: pos.x, y: pos.y, size: wSize.height / pos.scale, scale: pos.scale },
            rotation: pos.rotation,
        };
    },

    // 将当前 weaponParams 同步回逐帧配置
    _syncPerFrameFromWeaponParams() {
        const wt = this.state.weaponType;
        const anim = this.state.anim;
        const cfg = WeaponAnimConfig[wt];
        const perFrame = cfg && cfg.attack && cfg.attack.type === 'perFrame' ? cfg.attack.frames : null;
        if (!perFrame || anim !== 'attack') return;

        const idx = Math.max(0, Math.min(this.state.frameIndex, perFrame.length - 1));
        perFrame[idx] = {
            offsetX: this.weaponParams.offsetX,
            offsetY: this.weaponParams.offsetY,
            rotation: this.weaponParams.rotation,
            scale: this.weaponParams.scale,
        };
    },

    _updateWeaponPreview() {
        const preview = getElement('devToolWeaponPreview');
        const img = getElement('devToolWeaponImg');
        const placeholder = preview.querySelector('.dev-tool-weapon-placeholder');
        if (this.weaponImage && this.weaponImage.complete && this.weaponImage.naturalWidth > 0) {
            img.src = this.weaponImage.src;
            img.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        } else {
            img.style.display = 'none';
            if (placeholder) placeholder.style.display = 'block';
        }
        // 更新武器名称
        const nameEl = getElement('devToolWeaponName');
        if (nameEl) nameEl.textContent = this.WEAPON_MAP[this.state.weaponType]?.name || '无';
    },

    // 绑定事件
    _bindEvents() {
        // 触发按钮
        const trigger = getElement('devToolTrigger');
        if (trigger) trigger.addEventListener('click', () => this.toggle());

        // 关闭按钮
        const closeBtn = getElement('devToolClose');
        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());

        // 动画选择
        const animSelect = getElement('devToolAnimSelect');
        if (animSelect) {
            animSelect.addEventListener('change', (e) => {
                this.state.anim = e.target.value;
                this.state.frameIndex = 0;
                this.state.isPlaying = false;
                this._stopFrameAnimation();
                this._loadKeyframes(); // 加载关键帧
                this._updateFrameSlider();
                this._updateFrameLabel();
                this._updatePlayBtn();
                this._updateStatus();
                // 直接加载当前配置到预览画布，避免空白/错位
                this._applyCurrentConfigToPreview();
            });
        }

        // 武器选择
        const weaponSelect = getElement('devToolWeaponSelect');
        if (weaponSelect) {
            weaponSelect.addEventListener('change', (e) => {
                this.state.weaponType = e.target.value;
                this._loadWeapon(this.state.weaponType);
                // 直接加载当前配置到预览画布
                this._applyCurrentConfigToPreview();
            });
        }

        // 保存按钮
        const saveBtn = getElement('devToolSave');
        if (saveBtn) saveBtn.addEventListener('click', () => this._save());

        // 重置按钮
        const resetBtn = getElement('devToolReset2');
        if (resetBtn) resetBtn.addEventListener('click', () => this._reset());

        // 坐标工具按钮
        const coordBtn = getElement('devToolCoord');
        if (coordBtn) coordBtn.addEventListener('click', () => this._startCoordTool());

        // 缩放按钮
        const zoomInBtn = getElement('devToolZoomIn');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this._zoomIn());
        
        const zoomOutBtn = getElement('devToolZoomOut');
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this._zoomOut());
        
        const zoomResetBtn = getElement('devToolZoomReset');
        if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => this._zoomReset());

        // 设置手部挂载点按钮
        const handAnchorBtn = getElement('devToolSetHandAnchor');
        if (handAnchorBtn) handAnchorBtn.addEventListener('click', () => this._toggleHandAnchorMode());

        // Canvas 鼠标交互
        this._canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this._canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this._canvas.addEventListener('mouseup', () => this._onMouseUp());
        this._canvas.addEventListener('mouseleave', () => this._onMouseUp());
        this._canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

        // 输入框实时同步
        ['devToolOffX', 'devToolOffY', 'devToolRot', 'devToolScl'].forEach((id, idx) => {
            const el = getElement(id);
            if (!el) return;
            const keys = ['offsetX', 'offsetY', 'rotation', 'scale'];
            el.addEventListener('input', () => {
                const val = parseFloat(el.value);
                if (!isNaN(val)) {
                    this.weaponParams[keys[idx]] = val;
                    this._syncPerFrameFromWeaponParams();
                    this._draw();
                }
            });
        });

        // 帧滑块
        const frameSlider = getElement('devToolFrameSlider');
        if (frameSlider) {
            frameSlider.addEventListener('input', (e) => {
                this.state.frameIndex = parseInt(e.target.value);
                this.state.isPlaying = false;
                this._stopFrameAnimation();
                this._applyCurrentConfigToPreview();
                this._updateFrameLabel();
                this._updatePlayBtn();
                // 拖动滑块时同步更新武器位置（关键帧/挂载点都会反映）
                this._applyCurrentConfigToPreview();
            });
        }

        // 播放/暂停按钮
        const playBtn = getElement('devToolPlayBtn');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                this.state.isPlaying = !this.state.isPlaying;
                this._updatePlayBtn();
                if (this.state.isPlaying) {
                    this._startFrameAnimation();
                } else {
                    this._stopFrameAnimation();
                }
            });
        }

        // 键盘事件（R键切换模式）
        document.addEventListener('keydown', (e) => {
            if (!this._active) return;
            if (e.key.toLowerCase() === 'r') {
                e.preventDefault();
                this._toggleMode();
            }
            if (e.key === 'Escape') {
                this.hide();
            }
            // 关键帧快捷键
            if ((this.state.anim === 'attack' || this.state.anim === 'walk') && this.keyframeSystem.enabled) {
                if (e.key === 'k' || e.key === 'K') {
                    // K键：在当前进度添加关键帧
                    e.preventDefault();
                    const progress = this.state.frameIndex / this._charFrames[this.state.anim].count;
                    this._addKeyframe(progress);
                    this._showToast(`✅ 关键帧已添加 @ ${Math.round(progress * 100)}%`);
                }
            }
        });

        // 应用到所有帧
        const applyAllBtn = getElement('devToolApplyAll');
        if (applyAllBtn) applyAllBtn.addEventListener('click', () => this._applyToAllKeyframes());

        // 关键帧按钮事件
        const addKfBtn = getElement('devToolAddKeyframe');
        if (addKfBtn) addKfBtn.addEventListener('click', () => {
            if (this.state.anim === 'attack' || this.state.anim === 'walk') {
                const progress = this.state.frameIndex / this._charFrames[this.state.anim].count;
                this._addKeyframe(progress);
                this._showToast(`✅ 关键帧已添加 @ ${Math.round(progress * 100)}%`);
            } else {
                this._showToast('请在攻击或行走动画模式下添加关键帧');
            }
        });

        const interpolateBtn = getElement('devToolInterpolate');
        if (interpolateBtn) interpolateBtn.addEventListener('click', () => this._autoInterpolate());

        const clearKfBtn = getElement('devToolClearKf');
        if (clearKfBtn) clearKfBtn.addEventListener('click', () => this._clearKeyframes());

        // 武器图片拖放
        const weaponImg = getElement('devToolWeaponImg');
        if (weaponImg) {
            weaponImg.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('weapon', this.state.weaponType);
            });
        }

        // Tab 切换
        queryAllElements('.dev-tool-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });
    },

    // 加载角色动画帧
    _loadCharacterFrames() {
        this._charFrames = {};
        
        // 待机：单帧
        this._charFrames.idle = [this.charImage];
        
        // 行走：walk.png 3×8=21帧，每帧 512×516
        this._charFrames.walk = { sheet: new Image(), cols: 8, rows: 3, frameW: 512, frameH: 516, count: 21 };
        this._charFrames.walk.sheet.src = 'assets/character/walk.png';
        this._charFrames.walk.sheet.onload = () => { this._draw(); };
        
        // 奔跑：running.png 2×8=16帧，每帧 512×512
        this._charFrames.running = { sheet: new Image(), cols: 8, rows: 2, frameW: 512, frameH: 512, count: 16 };
        this._charFrames.running.sheet.src = 'assets/character/running.png';
        this._charFrames.running.sheet.onload = () => { this._draw(); };
        
        // 剑攻击：attack_sword.png 8帧，每帧 512×516（或 512×1548 总高度）
        this._charFrames.attack = { sheet: new Image(), cols: 8, rows: 1, frameW: 512, frameH: 516, count: 8 };
        this._charFrames.attack.sheet.src = 'assets/player/attack_sword.png';
        this._charFrames.attack.sheet.onload = () => { this._draw(); };
    },

    // 更新帧滑块范围
    _updateFrameSlider() {
        const slider = getElement('devToolFrameSlider');
        if (!slider) { return; }
        const currentAnim = this.state.anim;
        const perFrameTotal = this._getPerFrameTotal();
        const total = perFrameTotal > 1 ? perFrameTotal : (
            (this._charFrames[currentAnim] && this._charFrames[currentAnim].count) || 1
        );

        if (total > 1) {
            slider.max = total - 1;
            slider.min = 0;
            slider.value = this.state.frameIndex;
            slider.disabled = false;
        } else {
            slider.max = 0;
            slider.min = 0;
            slider.value = 0;
            slider.disabled = true;
        }
    },

    // 当前逐帧配置的总帧数（仅 attack perFrame 模式）
    _getPerFrameTotal() {
        const wt = this.state.weaponType;
        const anim = this.state.anim;
        const cfg = WeaponAnimConfig[wt];
        const perFrame = cfg && cfg.attack && cfg.attack.type === 'perFrame' ? cfg.attack.frames : null;
        return (perFrame && anim === 'attack') ? perFrame.length : 0;
    },

    // 更新帧编号显示
    _updateFrameLabel() {
        const label = getElement('devToolFrameLabel');
        if (!label) return;
        const perFrameTotal = this._getPerFrameTotal();
        const total = perFrameTotal > 1 ? perFrameTotal : (
            (this._charFrames[this.state.anim] && this._charFrames[this.state.anim].count) || 1
        );
        const current = this.state.frameIndex + 1;
        label.textContent = `${current} / ${total}`;
    },

    // 更新播放按钮文字
    _updatePlayBtn() {
        const btn = getElement('devToolPlayBtn');
        if (!btn) return;
        btn.textContent = this.state.isPlaying ? '⏸ 暂停' : '▶ 播放';
    },

    // 启动帧动画循环
    _startFrameAnimation() {
        if (this._frameAnimId) cancelAnimationFrame(this._frameAnimId);

        const frameData = this._charFrames[this.state.anim];
        if (!frameData || !frameData.count || frameData.count <= 1) return;

        const wt = this.state.weaponType;
        const cfg = WeaponAnimConfig[wt];
        const perFrame = cfg && cfg.attack && cfg.attack.type === 'perFrame' ? cfg.attack.frames : null;
        const isPerFrame = perFrame && this.state.anim === 'attack';

        // 逐帧模式：使用连续进度做 0~1 的平滑插值，和普通逐帧预览区分
        if (isPerFrame) {
            // 与游戏中 player_attack_sword 一致：8 帧 @ 12fps ≈ 667ms
            const duration = 1000 * frameData.count / 12;
            const startTime = performance.now();
            const loop = (timestamp) => {
                if (!this.state.isPlaying) return;
                const elapsed = timestamp - startTime;
                const progress = (elapsed % duration) / duration;
                this.state.playProgress = progress;
                this.state.frameIndex = Math.min(perFrame.length - 1, Math.floor(progress * (perFrame.length - 1)));
                this._updateFrameLabel();
                const slider = getElement('devToolFrameSlider');
                if (slider) slider.value = this.state.frameIndex;
                this._draw();
                this._frameAnimId = requestAnimationFrame(loop);
            };
            this._frameAnimId = requestAnimationFrame(loop);
            return;
        }

        const frameDuration = 60; // 每帧60ms（与游戏中一致）
        let lastTime = 0;

        const loop = (timestamp) => {
            if (!this.state.isPlaying) return;
            if (!lastTime) lastTime = timestamp;
            const elapsed = timestamp - lastTime;

            if (elapsed >= frameDuration) {
                this.state.frameIndex = (this.state.frameIndex + 1) % frameData.count;
                this._updateFrameLabel();
                // 同步滑块
                const slider = getElement('devToolFrameSlider');
                if (slider) slider.value = this.state.frameIndex;
                // 播放时让武器跟随当前帧配置，方便对比现状
                if (!this.drag.active && !this.handAnchorSystem.dragHand && !this.handAnchorSystem.dragWeapon) {
                    this._applyCurrentConfigToPreview();
                } else {
                    this._draw();
                }
                lastTime = timestamp;
            }

            this._frameAnimId = requestAnimationFrame(loop);
        };

        this._frameAnimId = requestAnimationFrame(loop);
    },

    // ===== 关键帧系统 =====
    
    // 线性插值：根据进度计算当前武器位置
    _interpolateKeyframes(progress) {
        const kfs = this.keyframeSystem.keyframes;
        if (!kfs || kfs.length === 0) return null;
        
        // 边界处理
        if (progress <= 0) return kfs[0];
        if (progress >= 1) return kfs[kfs.length - 1];
        
        // 找到前后关键帧
        let prev = kfs[0], next = kfs[kfs.length - 1];
        for (let i = 0; i < kfs.length - 1; i++) {
            if (progress >= kfs[i].progress && progress <= kfs[i + 1].progress) {
                prev = kfs[i];
                next = kfs[i + 1];
                break;
            }
        }
        
        // 计算插值比例
        const segmentDuration = next.progress - prev.progress;
        if (segmentDuration === 0) return prev;
        
        const t = (progress - prev.progress) / segmentDuration;
        
        // 线性插值
        return {
            offsetX: prev.offsetX + (next.offsetX - prev.offsetX) * t,
            offsetY: prev.offsetY + (next.offsetY - prev.offsetY) * t,
            rotation: prev.rotation + (next.rotation - prev.rotation) * t,
            scale: prev.scale + (next.scale - prev.scale) * t,
        };
    },
    
    // 从 WeaponAnimConfig 加载关键帧（转换为屏幕坐标）
    _loadKeyframes() {
        const wt = this.state.weaponType;
        const anim = this.state.anim;
        const cfg = WeaponAnimConfig.keyframes;
        const weaponCfg = WeaponAnimConfig[wt];

        if (cfg && cfg[wt] && cfg[wt][anim]) {
            const hasHandAnchors = weaponCfg && weaponCfg.handAnchors && typeof weaponCfg.handAnchors === 'object';
            const anchor = hasHandAnchors ? (weaponCfg.handAnchors[anim] || weaponCfg.handAnchors.idle || { x: 0, y: 0 }) : null;
            const { baseX, baseY, afterX, afterY } = this._getWeaponTransformBase();

            this.keyframeSystem.keyframes = cfg[wt][anim].map(kf => {
                let offsetX = kf.offsetX;
                let offsetY = kf.offsetY;
                if (kf.handOffsetX !== undefined && kf.handOffsetY !== undefined && anchor) {
                    offsetX = anchor.x + kf.handOffsetX;
                    offsetY = anchor.y + kf.handOffsetY;
                } else if (kf.holdOffsetX !== undefined && kf.holdOffsetY !== undefined) {
                    offsetX = baseX + kf.holdOffsetX + afterX;
                    offsetY = baseY + kf.holdOffsetY + afterY;
                }
                return {
                    progress: kf.progress,
                    offsetX,
                    offsetY,
                    rotation: kf.rotation,
                    scale: kf.scale,
                };
            });
            this.keyframeSystem.enabled = true;
        } else {
            // 没有关键帧时，从当前 weaponParams 创建一个默认关键帧
            this.keyframeSystem.keyframes = [];
            this.keyframeSystem.enabled = false;
        }
        this.keyframeSystem.selectedIndex = -1;
    },
    
    // 添加关键帧（当前位置）
    _addKeyframe(progress) {
        const kf = {
            progress: Math.max(0, Math.min(1, progress)),
            offsetX: this.weaponParams.offsetX,
            offsetY: this.weaponParams.offsetY,
            rotation: this.weaponParams.rotation,
            scale: this.weaponParams.scale,
        };
        
        // 按 progress 排序插入
        const kfs = this.keyframeSystem.keyframes;
        let inserted = false;
        for (let i = 0; i < kfs.length; i++) {
            if (kf.progress < kfs[i].progress) {
                kfs.splice(i, 0, kf);
                this.keyframeSystem.selectedIndex = i;
                inserted = true;
                break;
            } else if (Math.abs(kf.progress - kfs[i].progress) < 0.01) {
                // 更新已有关键帧
                kfs[i] = kf;
                this.keyframeSystem.selectedIndex = i;
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            kfs.push(kf);
            this.keyframeSystem.selectedIndex = kfs.length - 1;
        }
        
        this.keyframeSystem.enabled = true;
        this._updateKeyframeUI();
        
    },
    
    // 删除选中关键帧
    _deleteKeyframe() {
        const idx = this.keyframeSystem.selectedIndex;
        if (idx >= 0 && idx < this.keyframeSystem.keyframes.length) {
            this.keyframeSystem.keyframes.splice(idx, 1);
            this.keyframeSystem.selectedIndex = -1;
            this._updateKeyframeUI();
        }
    },
    
    // 清空所有关键帧
    _clearKeyframes() {
        this.keyframeSystem.keyframes = [];
        this.keyframeSystem.selectedIndex = -1;
        this.keyframeSystem.enabled = false;
        this._updateKeyframeUI();
        
    },
    
    // 更新关键帧UI
    _updateKeyframeUI() {
        const listEl = getElement('devToolKeyframeList');
        if (!listEl) return;
        
        const kfs = this.keyframeSystem.keyframes;
        if (kfs.length === 0) {
            listEl.innerHTML = '<div style="color:#888;text-align:center;padding:10px;">暂无关键帧</div>';
            return;
        }
        
        listEl.innerHTML = kfs.map((kf, i) => {
            const isSelected = i === this.keyframeSystem.selectedIndex;
            return `<div class="keyframe-item ${isSelected ? 'selected' : ''}" data-index="${i}" style="
                padding: 4px 8px; margin: 2px 0; border-radius: 4px; cursor: pointer; font-size: 12px;
                background: ${isSelected ? 'rgba(144,208,112,0.2)' : 'rgba(60,60,60,0.5)'};
                border: 1px solid ${isSelected ? 'rgba(144,208,112,0.5)' : 'transparent'};
            ">
                <span style="color:#d4c5a9;">#${i+1}</span> 
                <span style="color:#90d070;">${Math.round(kf.progress * 100)}%</span>
                <span style="color:#888;">XY(${Math.round(kf.offsetX)},${Math.round(kf.offsetY)})</span>
                <span style="color:#888;">R${Math.round(kf.rotation)}°</span>
                <span style="color:#888;">S${kf.scale.toFixed(2)}</span>
            </div>`;
        }).join('');
        
        // 绑定点击事件
        listEl.querySelectorAll('.keyframe-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.index);
                this.keyframeSystem.selectedIndex = idx;
                this._applyKeyframeToWeapon(idx);
                this._updateKeyframeUI();
            });
        });
    },
    
    // 应用关键帧到武器参数
    _applyKeyframeToWeapon(index) {
        const kf = this.keyframeSystem.keyframes[index];
        if (!kf) return;
        
        this.weaponParams.offsetX = kf.offsetX;
        this.weaponParams.offsetY = kf.offsetY;
        this.weaponParams.rotation = kf.rotation;
        this.weaponParams.scale = kf.scale;
        this._syncInputs();
        this._draw();
    },
    
    // 将当前武器参数应用到所有关键帧
    _applyToAllKeyframes() {
        const kfs = this.keyframeSystem.keyframes;
        if (kfs.length === 0) {
            this._showToast('没有关键帧可应用');
            return;
        }
        for (const kf of kfs) {
            kf.offsetX = this.weaponParams.offsetX;
            kf.offsetY = this.weaponParams.offsetY;
            kf.rotation = this.weaponParams.rotation;
            kf.scale = this.weaponParams.scale;
        }
        this._updateKeyframeUI();
        this._draw();
        this._showToast(`✅ 已应用到 ${kfs.length} 个关键帧`);
    },

    // 自动插值生成中间帧
    _autoInterpolate() {
        const kfs = this.keyframeSystem.keyframes;
        if (kfs.length < 2) {
            this._showToast('需要至少2个关键帧才能插值');
            return;
        }
        
        // 在关键帧之间均匀插入中间帧
        const newKeyframes = [];
        for (let i = 0; i < kfs.length - 1; i++) {
            const prev = kfs[i];
            const next = kfs[i + 1];
            newKeyframes.push(prev);
            
            // 如果间隔大于 0.15，插入中间帧
            if (next.progress - prev.progress > 0.15) {
                const midProgress = (prev.progress + next.progress) / 2;
                const mid = this._interpolateKeyframes(midProgress);
                if (mid) {
                    mid.progress = midProgress;
                    newKeyframes.push(mid);
                }
            }
        }
        newKeyframes.push(kfs[kfs.length - 1]);
        
        this.keyframeSystem.keyframes = newKeyframes;
        this._updateKeyframeUI();
        this._showToast(`✅ 已生成 ${newKeyframes.length} 个关键帧`);
    },

    // 缓动函数（与 Easing 模块一致）
    _easeInCubic(t) { return t * t * t; },
    _easeOutQuad(t) { return t * (2 - t); },
    _easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); },

    // 停止帧动画
    _stopFrameAnimation() {
        if (this._frameAnimId) {
            cancelAnimationFrame(this._frameAnimId);
            this._frameAnimId = null;
        }
    },

    // 获取当前角色显示图片（根据动画状态）
    _getCharacterImage() {
        const currentAnim = this.state.anim;
        if (currentAnim === 'idle') {
            return this.charImage;
        }
        if ((currentAnim === 'walk' || currentAnim === 'running' || currentAnim === 'attack') && this._charFrames[currentAnim]) {
            const frameData = this._charFrames[currentAnim];
            if (frameData.sheet && frameData.sheet.complete && frameData.sheet.naturalWidth > 0) {
                // 返回可绘制的帧数据对象
                return frameData;
            }
        }
        return this.charImage;
    },

    // 切换模式（缩放/旋转）
    _toggleMode() {
        this.state.mode = this.state.mode === 'move' ? 'rotate' : 'move';
        this._updateModeHint();
        // 更新Canvas光标
        if (this.state.mode === 'rotate') {
            this._canvas.classList.add('mode-rotate');
        } else {
            this._canvas.classList.remove('mode-rotate');
        }
    },

    _toggleHandAnchorMode() {
        const sys = this.handAnchorSystem;
        sys.enabled = !sys.enabled;

        const wt = this.state.weaponType;
        const currentAnim = this.state.anim;
        const cfg = WeaponAnimConfig[wt];

        if (sys.enabled) {
            // 进入挂载点模式时，从配置同步挂载点
            this._loadHandAnchorsFromConfig();
            // 如果当前动画有挂载点，把 weaponParams 切到该挂载点位置（便于拖动）
            const anchor = sys.handAnchors[currentAnim] || sys.handAnchors.idle || { x: 0, y: 0 };
            this.weaponParams.offsetX = anchor.x;
            this.weaponParams.offsetY = anchor.y;
            // 保持当前旋转/缩放
            if (cfg) {
                const stateCfg = cfg[currentAnim] || cfg;
                this.weaponParams.rotation = stateCfg.idleRotation !== undefined ? stateCfg.idleRotation : (cfg.idleRotation || 0);
                this.weaponParams.scale = stateCfg.idleScale !== undefined ? stateCfg.idleScale : (cfg.idleScale || 1);
            }
            this.state.weaponOnCanvas = true;
        } else {
            // 退出挂载点模式时，先根据当前手锚点算出武器实际位置，再切回普通模式
            const overrides = {
                idleRotation: this.weaponParams.rotation,
                idleScale: this.weaponParams.scale,
                handAnchors: sys.handAnchors,
                gripOffset: sys.gripOffset,
            };
            const local = WeaponTransform.getWeaponLocalOffset(wt, 105, false, false, currentAnim, true, overrides);
            this.weaponParams.offsetX = local.x;
            this.weaponParams.offsetY = local.y;
        }

        this._syncInputs();
        this._draw();

        const btn = getElement('devToolSetHandAnchor');
        if (btn) {
            btn.style.background = sys.enabled ? '#4a7c59' : '';
            btn.textContent = sys.enabled ? '✋ 退出挂载点编辑' : '✋ 设置手部挂载点';
        }

        // 更新提示
        const canvasHint = getElement('devToolHint');
        if (canvasHint) {
            canvasHint.innerHTML = sys.enabled
                ? `挂载点模式：黄点=手 · 拖动黄点移手 · 拖动武器调 gripOffset · 滚轮调旋转/缩放`
                : `拖动武器到人物位置 → 按 <kbd>R</kbd> 进入调整模式`;
        }
    },

    _updateModeHint() {
        const hint = getElement('devToolModeHint');
        if (!hint) return;
        const isRotate = this.state.mode === 'rotate';
        hint.innerHTML = `
            <div class="${isRotate ? '' : 'mode-active'}">🖱 左键拖动</div>
            <div class="${isRotate ? 'mode-active' : ''}">🔄 滚轮 = ${isRotate ? '旋转' : '缩放'}</div>
            <div>按 <kbd>R</kbd> 切换${isRotate ? '缩放' : '旋转'}模式</div>
        `;
        // 也更新浮层提示
        const canvasHint = getElement('devToolHint');
        if (canvasHint) {
            canvasHint.innerHTML = isRotate
                ? `旋转模式：滚轮旋转 · 左键拖动 · <kbd>R</kbd> 切换`
                : `拖动武器到人物位置 → 按 <kbd>R</kbd> 进入调整模式`;
        }
    },

    _updateStatus() {
        const statusEl = getElement('devToolStatus');
        if (statusEl) statusEl.textContent = this.ANIM_NAME[this.state.anim] || this.state.anim;
    },

    // 鼠标按下
    _onMouseDown(e) {
        const rect = this._canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cx = this._canvas.width / 2;
        const cy = this._canvas.height / 2;
        const wp = this.weaponParams;
        const sys = this.handAnchorSystem;

        // 计算武器当前在屏幕上的中心位置（用于命中测试）
        let weaponScreenX, weaponScreenY;
        if (this.state.weaponOnCanvas && this.weaponImage && this.weaponImage.complete) {
            const local = WeaponTransform.getWeaponLocalOffset(
                this.state.weaponType, 105, false, false, this.state.anim, true, this._buildPreviewOverrides()
            );
            weaponScreenX = cx + local.x;
            weaponScreenY = cy + local.y;
        }

        // ===== 挂载点模式：优先检查手部标记 =====
        if (sys.enabled) {
            const currentAnim = this.state.anim;
            const anchor = sys.handAnchors[currentAnim] || sys.handAnchors.idle;
            const handScreenX = cx + anchor.x;
            const handScreenY = cy + anchor.y;

            if (Math.hypot(mx - handScreenX, my - handScreenY) < 20) {
                sys.dragHand = true;
                sys.handStartX = mx;
                sys.handStartY = my;
                sys.handAnchorStartX = anchor.x;
                sys.handAnchorStartY = anchor.y;
                this._stopFrameAnimation();
                this.state.isPlaying = false;
                this._updatePlayBtn();
                return;
            }
        }

        // 检查是否点击在武器区域内
        if (weaponScreenX !== undefined) {
            const dist = Math.hypot(mx - weaponScreenX, my - weaponScreenY);
            if (dist < 60) {
                if (sys.enabled) {
                    // 挂载点模式下拖动武器 = 调整 gripOffset
                    sys.dragWeapon = true;
                    sys.handStartX = mx;
                    sys.handStartY = my;
                    sys.gripStartX = sys.gripOffset.x;
                    sys.gripStartY = sys.gripOffset.y;
                } else {
                    this.drag.active = true;
                    this.drag.startX = mx;
                    this.drag.startY = my;
                    this.drag.startOffsetX = wp.offsetX;
                    this.drag.startOffsetY = wp.offsetY;
                }
                this.state.weaponOnCanvas = true;
                this._stopFrameAnimation();
                this.state.isPlaying = false;
                this._updatePlayBtn();
                return;
            }
        }

        // 点击空白区域：放置武器/手部标记
        if (!this.state.weaponOnCanvas) {
            this.state.weaponOnCanvas = true;
            if (sys.enabled) {
                const currentAnim = this.state.anim;
                const anchor = sys.handAnchors[currentAnim] || sys.handAnchors.idle;
                anchor.x = mx - cx;
                anchor.y = my - cy;
                wp.offsetX = anchor.x;
                wp.offsetY = anchor.y;
            } else {
                wp.offsetX = mx - cx;
                wp.offsetY = my - cy;
            }
            this._syncInputs();
            this._syncPerFrameFromWeaponParams();
            this._draw();
        }
    },

    // 鼠标移动
    _onMouseMove(e) {
        const rect = this._canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const sys = this.handAnchorSystem;

        // ===== 挂载点模式：拖动手部 =====
        if (sys.dragHand) {
            const dx = mx - sys.handStartX;
            const dy = my - sys.handStartY;

            const currentAnim = this.state.anim;
            const anchor = sys.handAnchors[currentAnim] || sys.handAnchors.idle;

            // 更新挂载点位置（相对于玩家中心）
            anchor.x = sys.handAnchorStartX + dx;
            anchor.y = sys.handAnchorStartY + dy;

            // 同步到 weaponParams，使输入框/坐标标注显示手部位置
            this.weaponParams.offsetX = anchor.x;
            this.weaponParams.offsetY = anchor.y;
            this._syncInputs();

            this._draw();
            return;
        }

        // ===== 挂载点模式：拖动武器 = 调整 gripOffset =====
        if (sys.dragWeapon) {
            const dx = mx - sys.handStartX;
            const dy = my - sys.handStartY;
            sys.gripOffset.x = sys.gripStartX + dx;
            sys.gripOffset.y = sys.gripStartY + dy;
            this._draw();
            return;
        }

        if (!this.drag.active) return;

        const dx = mx - this.drag.startX;
        const dy = my - this.drag.startY;

        // 武器跟随鼠标：Canvas坐标系，Y向下为正
        this.weaponParams.offsetX = this.drag.startOffsetX + dx;
        this.weaponParams.offsetY = this.drag.startOffsetY + dy;
        this._syncInputs();
        this._syncPerFrameFromWeaponParams();
        this._draw();
    },

    // 鼠标释放
    _onMouseUp() {
        this.drag.active = false;
        this.handAnchorSystem.dragHand = false;
        this.handAnchorSystem.dragWeapon = false;
    },

    // 滚轮
    _onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;

        if (this.state.mode === 'rotate') {
            // 旋转模式：滚轮旋转（顺时针/逆时针）
            this.weaponParams.rotation += delta * 5;
        } else {
            // 缩放模式：滚轮缩放
            const scaleDelta = delta * 0.05;
            this.weaponParams.scale = Math.max(0.1, Math.min(5.0, this.weaponParams.scale + scaleDelta));
        }
        this._syncInputs();
        this._syncPerFrameFromWeaponParams();
        this._draw();
    },

    _syncInputs() {
        const elX = getElement('devToolOffX');
        const elY = getElement('devToolOffY');
        const elR = getElement('devToolRot');
        const elS = getElement('devToolScl');
        if (elX) elX.value = Math.round(this.weaponParams.offsetX);
        if (elY) elY.value = Math.round(this.weaponParams.offsetY);
        if (elR) elR.value = Math.round(this.weaponParams.rotation);
        if (elS) elS.value = this.weaponParams.scale.toFixed(2);
        
        // 更新缩放信息面板
        this._updateScaleInfo();
    },
    
    // 更新缩放信息面板
    _updateScaleInfo() {
        const panel = getElement('devToolScaleInfo');
        if (!panel) return;
        
        const wt = this.state.weaponType;
        const cfg = WeaponAnimConfig[wt];
        if (!cfg) return;
        
        // 获取各状态的缩放值
        const globalScale = cfg.idleScale !== undefined ? cfg.idleScale : 1.0;
        const idleScale = cfg.idle && cfg.idle.idleScale !== undefined ? cfg.idle.idleScale : globalScale;
        const walkScale = cfg.walk && cfg.walk.idleScale !== undefined ? cfg.walk.idleScale : globalScale;
        const runningScale = cfg.running && cfg.running.idleScale !== undefined ? cfg.running.idleScale : globalScale;
        
        // 计算实际像素尺寸
        const s = 105;
        const ms = s * 0.75;
        const weaponType = this.WEAPON_MAP[wt]?.type || 'melee';
        const isMelee = weaponType === 'melee';
        
        let baseW, baseH;
        if (isMelee) {
            baseW = ms * 0.63;
            baseH = ms;
        } else if (weaponType === 'bow') {
            baseW = s * 1.10;
            baseH = s * 1.10;
        } else if (weaponType === 'pistol') {
            baseW = s * 0.275;
            baseH = s * 0.5;
        } else {
            baseW = s * 0.75;
            baseH = s;
        }
        
        // 当前调整的缩放值
        const currentScale = this.weaponParams.scale;
        
        panel.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px;color:#d4c5a9;">📐 缩放比例参考</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;">
                <div style="color:#888;">当前调整:</div>
                <div style="color:#90d070;font-weight:bold;">${currentScale.toFixed(2)}x</div>
                
                <div style="color:#888;">全局默认:</div>
                <div style="color:#d4c5a9;">${globalScale.toFixed(2)}x (${Math.round(baseW * globalScale)}×${Math.round(baseH * globalScale)}px)</div>
                
                <div style="color:#888;">待机 (idle):</div>
                <div style="color:#d4c5a9;">${idleScale.toFixed(2)}x (${Math.round(baseW * idleScale)}×${Math.round(baseH * idleScale)}px)</div>
                
                <div style="color:#888;">行走 (walk):</div>
                <div style="color:#d4c5a9;">${walkScale.toFixed(2)}x (${Math.round(baseW * walkScale)}×${Math.round(baseH * walkScale)}px)</div>
                
                <div style="color:#888;">奔跑 (running):</div>
                <div style="color:#d4c5a9;">${runningScale.toFixed(2)}x (${Math.round(baseW * runningScale)}×${Math.round(baseH * runningScale)}px)</div>
            </div>
            <div style="margin-top:6px;font-size:11px;color:#888;border-top:1px solid #444;padding-top:4px;">
                基础尺寸: ${Math.round(baseW)}×${Math.round(baseH)}px
            </div>
        `;
    },

    // 画布缩放控制
    _zoomIn() {
        if (this.zoom.scale < this.zoom.max) {
            this.zoom.scale = Math.min(this.zoom.max, this.zoom.scale + this.zoom.step);
            this._applyZoom();
        }
    },
    _zoomOut() {
        if (this.zoom.scale > this.zoom.min) {
            this.zoom.scale = Math.max(this.zoom.min, this.zoom.scale - this.zoom.step);
            this._applyZoom();
        }
    },
    _zoomReset() {
        this.zoom.scale = 1.0;
        this._applyZoom();
    },
    _applyZoom() {
        // 更新画布 CSS 缩放
        if (this._canvas) {
            this._canvas.style.transform = `scale(${this.zoom.scale})`;
            this._canvas.style.transformOrigin = 'center center';
        }
        // 更新标签
        const label = getElement('devToolZoomLabel');
        if (label) label.textContent = `${Math.round(this.zoom.scale * 100)}%`;
    },

    // 绘制
    _draw() {
        const ctx = this._ctx;
        const canvas = this._canvas;
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        ctx.clearRect(0, 0, w, h);

        // 背景网格
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i < w; i += 20) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
        for (let i = 0; i < h; i += 20) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }

        // 坐标轴（Canvas坐标系：X向右，Y向下，与游戏渲染一致）
        // X轴 - 红色，右侧箭头
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
        // X轴右侧箭头
        ctx.fillStyle = 'rgba(255, 80, 80, 0.85)';
        ctx.beginPath();
        ctx.moveTo(w - 12, cy - 6);
        ctx.lineTo(w, cy);
        ctx.lineTo(w - 12, cy + 6);
        ctx.closePath();
        ctx.fill();
        // X+ 文字标注
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('X+', w - 18, cy - 10);
        ctx.textAlign = 'left';

        // Y轴 - 绿色，上方箭头（游戏Y+方向为向上，即Canvas Y-方向）
        ctx.strokeStyle = 'rgba(80, 200, 80, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
        // Y轴上方箭头（指向游戏Y+）
        ctx.fillStyle = 'rgba(80, 200, 80, 0.85)';
        ctx.beginPath();
        ctx.moveTo(cx - 6, 12);
        ctx.lineTo(cx, 0);
        ctx.lineTo(cx + 6, 12);
        ctx.closePath();
        ctx.fill();
        // Y+ 文字标注
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('Y+', cx + 10, 18);

        // 辅助标注（Canvas坐标系，Y向下为正）
        ctx.fillStyle = 'rgba(200, 180, 150, 0.6)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('游戏X- ←', 45, cy + 20);
        ctx.fillText('↓ 游戏Y-', cx + 40, h - 12);
        ctx.textAlign = 'left';

        // 原点标注
        ctx.fillStyle = 'rgba(200, 180, 150, 0.9)';
        ctx.font = '11px monospace';
        ctx.fillText('玩家位置 (0, 0) | 参数: Canvas坐标系 (Y向下)', cx + 5, cy - 5);

        // 角色碰撞圆
        const charRadius = 60; // 120 / 2 = 60
        ctx.strokeStyle = 'rgba(100, 200, 100, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, charRadius, 0, Math.PI * 2); ctx.stroke();

        // 角色贴图（根据动画状态选择）
        const charImg = this._getCharacterImage();
        const isImage = charImg && charImg instanceof Image;
        const isFrameData = charImg && charImg.sheet && charImg.sheet instanceof Image;
        const isReady = isImage ? charImg.complete : (isFrameData ? charImg.sheet.complete : false);
        if (isReady) {
            // 与游戏中一致的缩放：size * 6.25 = 703.125
            const spriteSize = 120;
            const currentAnim = this.state.anim;
            if (currentAnim === 'idle') {
                // 待机状态：idle.png 本身是朝右的（脸朝右），无需旋转
                ctx.drawImage(charImg, cx - spriteSize / 2, cy - spriteSize / 2, spriteSize, spriteSize);
            } else if (currentAnim === 'walk' || currentAnim === 'running' || currentAnim === 'attack') {
                // 从 sprite sheet 提取帧（walk/running/attack）
                const frameData = this._charFrames[currentAnim];
                if (frameData && frameData.sheet && frameData.sheet.complete && frameData.sheet.naturalWidth > 0) {
                    let idx;
                    // 逐帧攻击模式：武器按 30 帧插值，角色贴图必须按相同进度映射到 8 帧
                    const wt = this.state.weaponType;
                    const cfg = WeaponAnimConfig[wt];
                    const perFrame = cfg && cfg.attack && cfg.attack.type === 'perFrame' ? cfg.attack.frames : null;
                    if (currentAnim === 'attack' && perFrame) {
                        const spriteProgress = this.state.playProgress || 0;
                        idx = Math.floor(spriteProgress * (frameData.count - 1));
                    } else {
                        idx = this.state.frameIndex % frameData.count;
                    }
                    const col = idx % frameData.cols;
                    const row = Math.floor(idx / frameData.cols);
                    const sx = col * frameData.frameW;
                    const sy = row * frameData.frameH;
                    ctx.drawImage(
                        frameData.sheet,
                        sx, sy, frameData.frameW, frameData.frameH,
                        cx - spriteSize/2, cy - spriteSize/2, spriteSize, spriteSize
                    );
                } else {
                    // 回退到待机图
                    ctx.drawImage(this.charImage, cx - spriteSize/2, cy - spriteSize/2, spriteSize, spriteSize);
                }
            } else {
                // 其他状态：使用待机图
                ctx.drawImage(charImg, cx - spriteSize / 2, cy - spriteSize / 2, spriteSize, spriteSize);
            }
        } else {
            ctx.fillStyle = 'rgba(100, 200, 100, 0.3)';
            ctx.fillRect(cx - 40, cy - 40, 80, 80);
        }

        // 绘制角色方向指示（根据动画状态）
        ctx.strokeStyle = 'rgba(200, 180, 100, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 60, cy); ctx.stroke();

        // 武器绘制
        if (this.state.weaponOnCanvas && this.weaponImage && this.weaponImage.complete) {
            const s = 105;
            const weaponType = this.WEAPON_MAP[this.state.weaponType]?.type || 'melee';
            const isMelee = weaponType === 'melee';
            const isGun = ['pistol', 'machinegun', 'rifle', 'shotgun'].includes(weaponType);
            
            // 关键帧系统状态（仅用于显示指示器，不覆盖绘制参数）
            const useKeyframes = this.keyframeSystem.enabled && this.keyframeSystem.keyframes.length > 0;
            
            // ===== 攻击/行走状态指示器 =====
            if ((this.state.anim === 'attack' || this.state.anim === 'walk') && isMelee) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                
                if (this.state.anim === 'attack' || this.state.anim === 'walk') {
                    // 攻击/行走动画进度指示器（统一）
                    const currentAnim = this.state.anim;
                    const perFrameTotal = this._getPerFrameTotal();
                    const frameData = this._charFrames[currentAnim];
                    const total = perFrameTotal > 1 ? perFrameTotal : (frameData && frameData.count || 1);
                    const progress = total > 1 ? this.state.frameIndex / (total - 1) : 0;
                    const animName = currentAnim === 'attack' ? '攻击' : '行走';
                    ctx.fillStyle = currentAnim === 'attack' ? 'rgba(255,80,80,0.8)' : 'rgba(100,200,100,0.8)';
                    ctx.font = 'bold 14px monospace';
                    ctx.textAlign = 'center';
                    const kfIndicator = useKeyframes ? ' [关键帧]' : '';
                    ctx.fillText(`${animName}: 帧 ${this.state.frameIndex + 1}/${total}${kfIndicator}`, cx, 30);
                    ctx.fillStyle = 'rgba(80,60,40,0.8)';
                    ctx.fillRect(cx - 100, 40, 200, 8);
                    ctx.fillStyle = currentAnim === 'attack' ? 'rgba(255,80,80,0.9)' : 'rgba(100,200,100,0.9)';
                    ctx.fillRect(cx - 100, 40, 200 * progress, 8);
                    
                    // 绘制关键帧标记
                    if (useKeyframes) {
                        ctx.fillStyle = 'rgba(144,208,112,0.9)';
                        this.keyframeSystem.keyframes.forEach(kf => {
                            const x = cx - 100 + 200 * kf.progress;
                            ctx.fillRect(x - 1, 36, 2, 16);
                        });
                    }
                }
                ctx.restore();
            }
            
            // ===== 统一武器绘制（使用 WeaponTransform 的变换链）=====
            const wt = this.state.weaponType;
            const animState = this.state.anim;
            const overrides = this._buildPreviewOverrides();
            let local, rotation;
            // 优先使用逐帧配置（exact per-frame state），其次运行时关键帧插值
            const pfTransform = this._getPerFrameTransform();
            if (pfTransform) {
                local = pfTransform.local;
                rotation = pfTransform.rotation;
            } else {
                const kfTransform = this._getRuntimeKeyframeTransform();
                if (kfTransform) {
                    local = kfTransform.local;
                    rotation = kfTransform.rotation;
                } else {
                    local = WeaponTransform.getWeaponLocalOffset(wt, 105, false, false, animState, true, overrides);
                    rotation = WeaponTransform.getWeaponRotation(0, wt, 0, animState, true, overrides);
                }
            }

            ctx.save();
            ctx.translate(cx + local.x, cy + local.y);
            ctx.rotate(rotation);

            // 绘制武器
            const drawScale = local.scale;
            if (isMelee) {
                const w = local.size * 0.63 * drawScale;
                const h = local.size * drawScale;
                ctx.drawImage(this.weaponImage, -w / 2, -h / 2, w, h);
            } else if (isGun) {
                const isPistol = weaponType === 'pistol';
                const w = (isPistol ? s * 0.275 : s * 0.75) * drawScale;
                const h = (isPistol ? s * 0.5 : s) * drawScale;
                ctx.drawImage(this.weaponImage, -w / 2, 0, w, h);
            } else {
                const imgW = this.weaponImage.naturalWidth || 1024;
                const imgH = this.weaponImage.naturalHeight || 1024;
                const aspect = imgW / imgH;
                const h = local.size * drawScale;
                const w = h * aspect;
                ctx.drawImage(this.weaponImage, -w / 2, -h / 2, w, h);
            }

            // 绘制旋转中心
            ctx.fillStyle = '#FFD700';
            ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();

            ctx.restore();
            
            // 绘制手部挂载点（如果启用）- 在武器坐标系之外绘制，避免随武器移动
            if (this.handAnchorSystem.enabled && isMelee) {
                const sys = this.handAnchorSystem;
                const currentAnim = this.state.anim;
                const anchor = sys.handAnchors[currentAnim] || sys.handAnchors.idle;
                
                // 挂载点位置（相对于玩家中心）
                const handX = cx + anchor.x;
                const handY = cy + anchor.y;

                // 武器中心位置（由 WeaponTransform 计算）
                const weaponX = cx + local.x;
                const weaponY = cy + local.y;
                
                // 绘制连线到武器中心
                ctx.strokeStyle = 'rgba(255, 200, 50, 0.4)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(handX, handY); ctx.lineTo(weaponX, weaponY); ctx.stroke();
                ctx.setLineDash([]);
                
                // 绘制挂载点指示器（黄色圆点）
                ctx.fillStyle = 'rgba(255, 200, 50, 0.8)';
                ctx.strokeStyle = 'rgba(255, 200, 50, 1)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(handX, handY, 8, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(handX, handY, 10, 0, Math.PI * 2); ctx.stroke();
                
                // 标签
                ctx.fillStyle = 'rgba(255, 200, 50, 0.9)';
                ctx.font = '10px monospace';
                ctx.fillText(`手 (${Math.round(anchor.x)}, ${Math.round(anchor.y)})`, handX + 12, handY - 8);
            }
            
            // ===== 坐标标注（所有状态都显示） =====
            const wp = this.weaponParams;
            const sys = this.handAnchorSystem;
            ctx.fillStyle = '#d4c5a9';
            ctx.font = '11px monospace';
            if (sys.enabled) {
                const handScreenX = cx + wp.offsetX;
                const handScreenY = cy + wp.offsetY;
                ctx.fillText(`手锚点: (${Math.round(wp.offsetX)}, ${Math.round(wp.offsetY)})`, handScreenX + 12, handScreenY - 8);
                ctx.fillText(`握把偏移: (${Math.round(sys.gripOffset.x)}, ${Math.round(sys.gripOffset.y)})`, handScreenX + 12, handScreenY + 12);
                ctx.fillText(`Rotation: ${Math.round(wp.rotation)}°`, handScreenX + 12, handScreenY + 28);
            } else {
                const weaponScreenX = cx + wp.offsetX;
                const weaponScreenY = cy + wp.offsetY;
                ctx.fillText(`屏幕偏移: (${Math.round(wp.offsetX)}, ${Math.round(wp.offsetY)})`, weaponScreenX + 8, weaponScreenY - 8);
                ctx.fillText(`Rotation: ${Math.round(wp.rotation)}°`, weaponScreenX + 8, weaponScreenY + 12);
            }
            if (this.state.anim === 'attack') {
                const cfg = WeaponAnimConfig[this.state.weaponType];
                const isPerFrame = cfg && cfg.attack && cfg.attack.type === 'perFrame';
                if (isPerFrame || useKeyframes) {
                    ctx.fillStyle = '#90d070';
                    const labelX = sys.enabled ? (cx + wp.offsetX + 12) : (cx + wp.offsetX + 8);
                    const labelY = sys.enabled ? (cy + wp.offsetY + 44) : (cy + wp.offsetY + 28);
                    ctx.fillText(isPerFrame ? `[逐帧模式]` : `[关键帧模式]`, labelX, labelY);
                }
            }
            
        } else if (!this.state.weaponOnCanvas) {
            ctx.fillStyle = '#5a4d3f';
            ctx.font = '14px SimHei';
            ctx.textAlign = 'center';
            ctx.fillText('点击放置武器', cx, cy - 70);
            ctx.fillText('或从右侧选择武器后点击此处', cx, cy - 50);
            ctx.textAlign = 'left';
        }
    },

    // 保存数据
    _save() {
        const wt = this.state.weaponType;
        const currentAnim = this.state.anim;
        const cfg = WeaponAnimConfig[wt];

        if (!cfg) return;

        // 逐帧模式：weaponParams 直接对应当前帧，保存当前帧即可
        if (cfg.attack && cfg.attack.type === 'perFrame' && currentAnim === 'attack') {
            this._syncPerFrameFromWeaponParams();
            this._persistWeaponConfig();

            const phaserScene = window.__phaserScene;
            if (phaserScene && phaserScene.playerSprite) {
                const player = window.player || Game.player;
                if (player) {
                    const weaponAnim = player._getWeaponAnimParams();
                    phaserScene.syncWeapon(player, weaponAnim);
                    phaserScene.syncOffhandWeapon(player, weaponAnim);
                }
            }

            const json = JSON.stringify({
                weaponType: wt,
                weaponName: this.WEAPON_MAP[wt]?.name,
                anim: currentAnim,
                mode: 'perFrame',
                frameIndex: this.state.frameIndex,
                frames: cfg.attack.frames,
            }, null, 2);
            const outputEl = getElement('devToolDataOutput');
            if (outputEl) {
                outputEl.textContent = json;
                outputEl.style.display = 'block';
            }
            navigator.clipboard.writeText(json).then(() => {
                this._showToast('✅ 已保存逐帧配置并复制到剪贴板');
            }).catch(() => {
                this._showToast('✅ 已保存逐帧配置');
            });
            return;
        }

        // 通用旋转/缩放
        const rotation = Math.round(this.weaponParams.rotation);
        const scale = parseFloat(this.weaponParams.scale.toFixed(2));

        // 判断是否有状态子配置（支持多状态独立配置）
        const hasStateConfig = cfg.idle && typeof cfg.idle === 'object';
        const targetState = (hasStateConfig && (currentAnim === 'idle' || currentAnim === 'walk' || currentAnim === 'running')) ? currentAnim : null;

        if (this.handAnchorSystem.enabled) {
            // ===== 挂载点模式：保存 handAnchors / gripOffset =====
            if (!cfg.handAnchors) cfg.handAnchors = {};
            cfg.handAnchors[currentAnim] = {
                x: Math.round(this.weaponParams.offsetX),
                y: Math.round(this.weaponParams.offsetY),
            };
            cfg.gripOffset = { ...this.handAnchorSystem.gripOffset };

            // 同时保存旋转/缩放到对应状态配置
            if (targetState) {
                if (!cfg[targetState]) cfg[targetState] = {};
                cfg[targetState].idleRotation = rotation;
                cfg[targetState].idleScale = scale;
            } else {
                cfg.idleRotation = rotation;
                cfg.idleScale = scale;
            }

            // 关键帧（挂载点模式下保存为相对 handAnchor 的 handOffsetX/Y）
            if ((currentAnim === 'attack' || currentAnim === 'walk') && this.keyframeSystem.enabled && this.keyframeSystem.keyframes.length > 0) {
                const anchor = cfg.handAnchors[currentAnim] || cfg.handAnchors.idle || { x: 0, y: 0 };
                if (!WeaponAnimConfig.keyframes) WeaponAnimConfig.keyframes = {};
                if (!WeaponAnimConfig.keyframes[wt]) WeaponAnimConfig.keyframes[wt] = {};
                WeaponAnimConfig.keyframes[wt][currentAnim] = this.keyframeSystem.keyframes.map(kf => ({
                    progress: kf.progress,
                    handOffsetX: Math.round(kf.offsetX - anchor.x),
                    handOffsetY: Math.round(kf.offsetY - anchor.y),
                    rotation: kf.rotation,
                    scale: kf.scale,
                }));
            }
        } else {
            // ===== 传统模式：反推 holdOffsetX/Y =====
            const { baseX, baseY, afterX, afterY } = this._getWeaponTransformBase();
            const holdOffsetX = Math.round(this.weaponParams.offsetX - baseX - afterX);
            const holdOffsetY = Math.round(this.weaponParams.offsetY - baseY - afterY);

            if (targetState) {
                if (!cfg[targetState]) cfg[targetState] = {};
                cfg[targetState].holdOffsetX = holdOffsetX;
                cfg[targetState].holdOffsetY = holdOffsetY;
                cfg[targetState].idleRotation = rotation;
                cfg[targetState].idleScale = scale;
            } else if (currentAnim === 'attack' || currentAnim === 'walk') {
                // 关键帧模式下：将当前屏幕偏移保存为 holdOffsetX/Y
                if (this.keyframeSystem.enabled && this.keyframeSystem.keyframes.length > 0) {
                    if (!WeaponAnimConfig.keyframes) WeaponAnimConfig.keyframes = {};
                    if (!WeaponAnimConfig.keyframes[wt]) WeaponAnimConfig.keyframes[wt] = {};
                    WeaponAnimConfig.keyframes[wt][currentAnim] = this.keyframeSystem.keyframes.map(kf => ({
                        progress: kf.progress,
                        holdOffsetX: Math.round(kf.offsetX - baseX - afterX),
                        holdOffsetY: Math.round(kf.offsetY - baseY - afterY),
                        rotation: kf.rotation,
                        scale: kf.scale,
                    }));
                }
            } else {
                cfg.holdOffsetX = holdOffsetX;
                cfg.holdOffsetY = holdOffsetY;
                cfg.idleRotation = rotation;
                cfg.idleScale = scale;
            }
        }

        // 持久化到 Electron 文件系统（如果可用）
        this._persistWeaponConfig();

        // 通知 Phaser 重新同步武器
        const phaserScene = window.__phaserScene;
        if (phaserScene && phaserScene.playerSprite) {
            const player = window.player || Game.player;
            if (player) {
                const weaponAnim = player._getWeaponAnimParams();
                phaserScene.syncWeapon(player, weaponAnim);
                phaserScene.syncOffhandWeapon(player, weaponAnim);
            }
        }

        // 输出面板展示当前保存的数据片段
        const output = {
            weaponType: wt,
            weaponName: this.WEAPON_MAP[wt]?.name,
            anim: currentAnim,
            mode: this.handAnchorSystem.enabled ? 'handAnchor' : 'holdOffset',
            rotation,
            scale,
        };
        if (this.handAnchorSystem.enabled) {
            output.handAnchor = cfg.handAnchors[currentAnim];
            output.gripOffset = cfg.gripOffset;
        } else {
            const { baseX, baseY, afterX, afterY } = this._getWeaponTransformBase();
            output.holdOffsetX = Math.round(this.weaponParams.offsetX - baseX - afterX);
            output.holdOffsetY = Math.round(this.weaponParams.offsetY - baseY - afterY);
        }
        if (this.keyframeSystem.enabled && this.keyframeSystem.keyframes.length > 0) {
            output.keyframeCount = this.keyframeSystem.keyframes.length;
            // 输出已经转换为运行时语义（handOffset/holdOffset）的关键帧，便于直接合并到 JSON
            if (WeaponAnimConfig.keyframes && WeaponAnimConfig.keyframes[wt] && WeaponAnimConfig.keyframes[wt][this.state.anim]) {
                output.keyframes = WeaponAnimConfig.keyframes[wt][this.state.anim];
            }
        }

        const json = JSON.stringify(output, null, 2);
        const outputEl = getElement('devToolDataOutput');
        if (outputEl) {
            outputEl.textContent = json;
            outputEl.style.display = 'block';
        }

        // 复制到剪贴板
        navigator.clipboard.writeText(json).then(() => {
            this._showToast('✅ 已应用到游戏并复制到剪贴板');
        }).catch(() => {
            this._showToast('✅ 已应用到游戏（复制失败）');
        });
    },

    // 显示 Toast 提示
    _showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(40,60,30,0.95);color:#90d070;padding:10px 20px;border-radius:6px;font-size:14px;z-index:10000;pointer-events:none;animation:toastFade 2s ease-out forwards;font-family:SimHei,"Microsoft YaHei",sans-serif;border:1px solid rgba(144,208,112,0.3);';
        toast.textContent = message;
        document.body.appendChild(toast);
        TimerManager.setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2000);
    },

    // 重置：把当前配置直接加载到预览画布
    _reset() {
        this._loadHandAnchorsFromConfig();
        this._applyCurrentConfigToPreview();
        this.state.mode = 'move';
        this._canvas.classList.remove('mode-rotate');
        this._updateModeHint();
    },

    // 显示/隐藏/切换
    show() {
        this._active = true;
        if (this._panel) this._panel.classList.add('active');
        const trigger = getElement('devToolTrigger');
        if (trigger) trigger.classList.add('active');
        // 默认切换到武器 tab
        this.switchTab('weapon');
        this._draw();
    },
    hide() {
        this._active = false;
        if (this._panel) this._panel.classList.remove('active');
        const trigger = getElement('devToolTrigger');
        if (trigger) trigger.classList.remove('active');
        AIDevTool.hide();
    },
    toggle() {
        if (this._active) this.hide(); else this.show();
    },

    // ===== Tab 切换 =====
    // switchTab 已定义在上面

    // ===== 坐标工具 =====
    _startCoordTool() {
        console.log('[DevTool] _startCoordTool called');

        // 先清理旧状态，防止重复绑定事件
        if (this._coordToolCleanup) {
            this._coordToolCleanup();
            this._coordToolCleanup = null;
        }

        this.hide(); // 关闭交互开发工具

        const overlay = getElement('coordOverlay');
        const panel = getElement('coordPanel');
        if (!overlay || !panel) {
            console.error('[DevTool] coordOverlay or coordPanel not found', { overlay: !!overlay, panel: !!panel });
            this._showToast('❌ 坐标工具 DOM 缺失');
            this.show();
            return;
        }

        // 将坐标层移动到 body，避免受 uiLayer pointer-events:none 影响
        if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
        if (panel.parentElement !== document.body) document.body.appendChild(panel);

        overlay.classList.add('active');
        panel.classList.add('active');
        overlay.style.display = 'block';
        panel.style.display = 'flex';

        // 清除之前的元素
        overlay.querySelectorAll('.rect-preview, .mouse-label, .start-marker, .final-rect').forEach(el => el.remove());

        // 重置显示
        getElement('coordStart').textContent = '--';
        getElement('coordEnd').textContent = '--';
        getElement('coordSize').textContent = '--';

        console.log('[DevTool] coord tool activated');

        // 获取游戏容器的边界和缩放比例
        // 注意：原始 gameCanvas 在非地牢模式下会被 Renderer 设为 display:none，
        // 因此必须检测 rect 尺寸，避免除以 0 得到 Infinity/NaN。
        const gameContainer = getElement('gameContainer');
        const gameCanvas = getElement('gameCanvas');
        const getGameScale = () => {
            const container = gameContainer || document.body;
            const containerRect = container.getBoundingClientRect();
            if (!gameCanvas) return { scaleX: 1, scaleY: 1, rect: containerRect };
            const canvasRect = gameCanvas.getBoundingClientRect();
            let scaleX = 1;
            let scaleY = 1;
            if (canvasRect.width > 0 && canvasRect.height > 0) {
                const sx = gameCanvas.width / canvasRect.width;
                const sy = gameCanvas.height / canvasRect.height;
                if (Number.isFinite(sx) && sx > 0) scaleX = sx;
                if (Number.isFinite(sy) && sy > 0) scaleY = sy;
            }
            return { scaleX, scaleY, rect: containerRect };
        };

        let isDragging = false;
        let startX = 0, startY = 0;
        let startClientX = 0, startClientY = 0;
        let rectPreview = null;
        let mouseLabel = null;
        let startMarker = null;

        // 鼠标按下 - 开始框选
        const onMouseDown = (e) => {
            if (e.button !== 0) return; // 只响应左键
            isDragging = true;
            startClientX = e.clientX;
            startClientY = e.clientY;
            const scale = getGameScale();
            startX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
            startY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);

            // 创建起始标记（使用屏幕坐标显示）
            startMarker = document.createElement('div');
            startMarker.className = 'start-marker';
            startMarker.style.left = (e.clientX - 4) + 'px';
            startMarker.style.top = (e.clientY - 4) + 'px';
            overlay.appendChild(startMarker);

            // 创建矩形预览（屏幕坐标）
            rectPreview = document.createElement('div');
            rectPreview.className = 'rect-preview';
            rectPreview.style.left = e.clientX + 'px';
            rectPreview.style.top = e.clientY + 'px';
            rectPreview.style.width = '0px';
            rectPreview.style.height = '0px';
            overlay.appendChild(rectPreview);

            // 创建鼠标标签
            mouseLabel = document.createElement('div');
            mouseLabel.className = 'mouse-label';
            overlay.appendChild(mouseLabel);
        };

        // 鼠标移动 - 更新预览
        const onMouseMove = (e) => {
            if (!isDragging) {
                // 显示当前鼠标坐标（游戏坐标）
                const scale = getGameScale();
                const gameX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
                const gameY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);
                if (!mouseLabel) {
                    mouseLabel = document.createElement('div');
                    mouseLabel.className = 'mouse-label';
                    overlay.appendChild(mouseLabel);
                }
                const labelY = Number.isFinite(scale.scaleY) ? Math.round(scale.rect.height * scale.scaleY - gameY) : Math.round(scale.rect.height - gameY);
                mouseLabel.textContent = `${gameX}, ${labelY}`
                mouseLabel.style.left = (e.clientX + 12) + 'px';
                mouseLabel.style.top = (e.clientY + 12) + 'px';
                return;
            }

            const scale = getGameScale();
            const currentX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
            const currentY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);
            const width = Math.abs(currentX - startX);
            const height = Math.abs(currentY - startY);

            // 预览矩形使用屏幕像素，避免缩放时偏离框选区域
            const screenLeft = Math.min(startClientX, e.clientX);
            const screenTop = Math.min(startClientY, e.clientY);
            const screenW = Math.abs(e.clientX - startClientX);
            const screenH = Math.abs(e.clientY - startClientY);
            rectPreview.style.left = screenLeft + 'px';
            rectPreview.style.top = screenTop + 'px';
            rectPreview.style.width = screenW + 'px';
            rectPreview.style.height = screenH + 'px';

            mouseLabel.textContent = `${width} x ${height}`;
            mouseLabel.style.left = (e.clientX + 12) + 'px';
            mouseLabel.style.top = (e.clientY + 12) + 'px';
        };

        // 鼠标释放 - 完成框选
        const onMouseUp = (e) => {
            if (!isDragging) return;
            isDragging = false;

            const scale = getGameScale();
            const endX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
            const endY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);
            const left = Math.min(startX, endX);
            const _top = Math.min(startY, endY);
            const width = Math.abs(endX - startX);
            const height = Math.abs(endY - startY);

            // 移除预览元素
            if (rectPreview) rectPreview.remove();
            if (mouseLabel) mouseLabel.remove();
            if (startMarker) startMarker.remove();

            // 最终矩形使用屏幕坐标绘制
            const screenLeft = Math.min(startClientX, e.clientX);
            const screenTop = Math.min(startClientY, e.clientY);
            const screenW = Math.abs(e.clientX - startClientX);
            const screenH = Math.abs(e.clientY - startClientY);

            const finalRect = document.createElement('div');
            finalRect.className = 'final-rect';
            finalRect.style.left = screenLeft + 'px';
            finalRect.style.top = screenTop + 'px';
            finalRect.style.width = screenW + 'px';
            finalRect.style.height = screenH + 'px';
            overlay.appendChild(finalRect);

            // 更新面板显示（显示游戏坐标 - left/bottom 模式）
            const containerHeight = scale.rect.height * scale.scaleY;
            const startBottom = Math.round(containerHeight - startY);
            const endBottom = Math.round(containerHeight - endY);
            const bottom = Math.min(startBottom, endBottom);

            const safe = (n) => Number.isFinite(n) ? Math.round(n) : 0;
            getElement('coordStart').textContent = `${safe(left)}, ${safe(bottom)}`;
            getElement('coordEnd').textContent = `${safe(left + width)}, ${safe(bottom + height)}`;
            getElement('coordSize').textContent = `${safe(width)} x ${safe(height)}`;

            console.log('[DevTool] coord recorded:', { left: safe(left), bottom: safe(bottom), width: safe(width), height: safe(height) });
        };

        // 右键退出
        const onContextMenu = (e) => {
            e.preventDefault();
            this._stopCoordTool();
        };

        // 绑定事件（overlay 负责 mousedown/move/contextmenu；window 负责 mouseup，防止拖出窗口丢失）
        overlay.addEventListener('mousedown', onMouseDown);
        overlay.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        overlay.addEventListener('contextmenu', onContextMenu);

        // 复制按钮
        const copyBtn = getElement('coordCopyBtn');
        if (copyBtn) {
            copyBtn.onclick = () => {
                const start = getElement('coordStart').textContent;
                const _end = getElement('coordEnd').textContent;
                const size = getElement('coordSize').textContent;
                const text = `left: ${start.split(',')[0].trim()}px; bottom: ${start.split(',')[1].trim()}px; width: ${size.split('x')[0].trim()}px; height: ${size.split('x')[1].trim()}px;`;
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.textContent = '✅ 已复制';
                    TimerManager.setTimeout(() => copyBtn.textContent = '📋 复制坐标', 1500);
                }).catch(() => {
                    // fallback
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    copyBtn.textContent = '✅ 已复制';
                    TimerManager.setTimeout(() => copyBtn.textContent = '📋 复制坐标', 1500);
                });
            };
        }

        // 保存引用以便后续清理
        this._coordToolCleanup = () => {
            overlay.removeEventListener('mousedown', onMouseDown);
            overlay.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            overlay.removeEventListener('contextmenu', onContextMenu);
            overlay.querySelectorAll('.rect-preview, .mouse-label, .start-marker, .final-rect').forEach(el => el.remove());
            overlay.classList.remove('active');
            panel.classList.remove('active');
            if (overlay) overlay.style.display = 'none';
            if (panel) panel.style.display = 'none';
            if (copyBtn) copyBtn.onclick = null;
        };
    },

    _stopCoordTool() {
        console.log('[DevTool] _stopCoordTool called');
        if (this._coordToolCleanup) {
            this._coordToolCleanup();
            this._coordToolCleanup = null;
        }
        // 退出坐标工具后自动重新打开开发工具
        this.show();
    },

    // 加载帧图片
    _loadFrameImages(type) {
        const cfg = this.WEAPON_MAP[type];
        if (!cfg || !cfg.frames) return;
        for (const anim in cfg.frames) {
            const paths = cfg.frames[anim];
            if (Array.isArray(paths)) {
                paths.forEach(path => {
                    if (!this.images[path]) {
                        this.images[path] = loadImage(path);
                    }
                });
            }
        }
    }
};

export default DevTool;
export { DevTool };
