import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
import { WEAPON_ANIM } from '../config/math-utils.js';
import { AIDevTool } from './ai-dev-tool.js';
import { EnemySpriteTool } from './enemy-sprite-tool.js';

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
        handStartX: 0, handStartY: 0,
        handAnchorStartX: 0, handAnchorStartY: 0,
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
        pistol:     { name: 'G18',        img: 'assets/weapons/g18_pistol.png',       type: 'pistol' },
        deagle:     { name: '沙漠之鹰',   img: 'assets/weapons/Desert eagle-eqiup.png',  type: 'pistol' },
        pkm:        { name: 'PKM',        img: 'assets/weapons/pkm_topdown.png',      type: 'machinegun' },
        akm:        { name: 'AKM',        img: 'assets/weapons/akm_topdown_lowpoly_v2.png', type: 'rifle' },
        qbz191:     { name: 'QBZ-191',    img: 'assets/weapons/akm_topdown_lowpoly_v2.png', type: 'rifle' },
        qjb201:     { name: 'QJB-201',    img: 'assets/weapons/pkm_topdown.png',      type: 'machinegun' },
        super90:    { name: 'Super90',    img: 'assets/weapons/M4s90_equip.png',      type: 'shotgun' },
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
        this._panel = document.getElementById('devToolPanel');
        this._canvas = document.getElementById('devToolCanvas');
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
        document.querySelectorAll('.dev-tool-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        // 更新 tab 内容显示
        document.querySelectorAll('.dev-tool-tab-content').forEach(content => {
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
            const img = new Image();
            img.src = this.WEAPON_MAP[key].img;
            this.images[key] = img;
        }

        // 加载默认武器
        this._loadWeapon(this.state.weaponType);
    },

    _loadWeapon(type) {
        const cfg = this.WEAPON_MAP[type];
        if (!cfg) return;
        this.weaponImage = this.images[type];
        if (!this.weaponImage) {
            this.weaponImage = new Image();
            this.weaponImage.src = cfg.img;
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
            this._updateFrameStrip();
            this._draw();
        };
        this._updateWeaponPreview();
    },

    _updateWeaponPreview() {
        const preview = document.getElementById('devToolWeaponPreview');
        const img = document.getElementById('devToolWeaponImg');
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
        const nameEl = document.getElementById('devToolWeaponName');
        if (nameEl) nameEl.textContent = this.WEAPON_MAP[this.state.weaponType]?.name || '无';
    },

    // 绑定事件
    _bindEvents() {
        // 触发按钮
        const trigger = document.getElementById('devToolTrigger');
        if (trigger) trigger.addEventListener('click', () => this.toggle());

        // 关闭按钮
        const closeBtn = document.getElementById('devToolClose');
        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());

        // 动画选择
        const animSelect = document.getElementById('devToolAnimSelect');
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
                this._updateFrameStrip();
                this._draw();
            });
        }

        // 武器选择
        const weaponSelect = document.getElementById('devToolWeaponSelect');
        if (weaponSelect) {
            weaponSelect.addEventListener('change', (e) => {
                this.state.weaponType = e.target.value;
                this._loadWeapon(this.state.weaponType);
                // 如果武器已在画布上，保持位置但换新图
                if (this.state.weaponOnCanvas) this._draw();
            });
        }

        // 保存按钮
        const saveBtn = document.getElementById('devToolSave');
        if (saveBtn) saveBtn.addEventListener('click', () => this._save());

        // 重置按钮
        const resetBtn = document.getElementById('devToolReset2');
        if (resetBtn) resetBtn.addEventListener('click', () => this._reset());

        // 坐标工具按钮
        const coordBtn = document.getElementById('devToolCoord');
        if (coordBtn) coordBtn.addEventListener('click', () => this._startCoordTool());

        // 缩放按钮
        const zoomInBtn = document.getElementById('devToolZoomIn');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this._zoomIn());
        
        const zoomOutBtn = document.getElementById('devToolZoomOut');
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this._zoomOut());
        
        const zoomResetBtn = document.getElementById('devToolZoomReset');
        if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => this._zoomReset());

        // 设置手部挂载点按钮
        const handAnchorBtn = document.getElementById('devToolSetHandAnchor');
        if (handAnchorBtn) handAnchorBtn.addEventListener('click', () => this._toggleHandAnchorMode());

        // Canvas 鼠标交互
        this._canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this._canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this._canvas.addEventListener('mouseup', () => this._onMouseUp());
        this._canvas.addEventListener('mouseleave', () => this._onMouseUp());
        this._canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

        // 输入框实时同步
        ['devToolOffX', 'devToolOffY', 'devToolRot', 'devToolScl'].forEach((id, idx) => {
            const el = document.getElementById(id);
            if (!el) return;
            const keys = ['offsetX', 'offsetY', 'rotation', 'scale'];
            el.addEventListener('input', () => {
                const val = parseFloat(el.value);
                if (!isNaN(val)) {
                    this.weaponParams[keys[idx]] = val;
                    this._draw();
                }
            });
        });

        // 帧滑块
        const frameSlider = document.getElementById('devToolFrameSlider');
        if (frameSlider) {
            frameSlider.addEventListener('input', (e) => {
                this.state.frameIndex = parseInt(e.target.value);
                this.state.isPlaying = false;
                this._updateFrameLabel();
                this._updatePlayBtn();
                this._draw();
            });
        }

        // 播放/暂停按钮
        const playBtn = document.getElementById('devToolPlayBtn');
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

        // 关键帧按钮事件
        const addKfBtn = document.getElementById('devToolAddKeyframe');
        if (addKfBtn) addKfBtn.addEventListener('click', () => {
            if (this.state.anim === 'attack' || this.state.anim === 'walk') {
                const progress = this.state.frameIndex / this._charFrames[this.state.anim].count;
                this._addKeyframe(progress);
                this._showToast(`✅ 关键帧已添加 @ ${Math.round(progress * 100)}%`);
            } else {
                this._showToast('请在攻击或行走动画模式下添加关键帧');
            }
        });

        const interpolateBtn = document.getElementById('devToolInterpolate');
        if (interpolateBtn) interpolateBtn.addEventListener('click', () => this._autoInterpolate());

        const clearKfBtn = document.getElementById('devToolClearKf');
        if (clearKfBtn) clearKfBtn.addEventListener('click', () => this._clearKeyframes());

        // 武器图片拖放
        const weaponImg = document.getElementById('devToolWeaponImg');
        if (weaponImg) {
            weaponImg.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('weapon', this.state.weaponType);
            });
        }

        // Tab 切换
        document.querySelectorAll('.dev-tool-tab').forEach(tab => {
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

    // 更新帧展示条（角色帧 + 武器帧）
    _updateFrameStrip() {
        const strip = document.getElementById('devToolFrameStrip');
        if (!strip) return;
        strip.innerHTML = '';
        const currentAnim = this.state.anim;

        // 角色帧展示
        const charFrames = this._charFrames && this._charFrames[currentAnim];
        if (charFrames) {
            let hasFrames = false;
            if (Array.isArray(charFrames) && charFrames.length > 1) {
                // 多帧数组（如旧版帧序列）
                this._showFrameItem(strip, charFrames[0].src, '第1帧', '角色-' + (this.ANIM_NAME[currentAnim] || currentAnim));
                this._showFrameItem(strip, charFrames[charFrames.length - 1].src, `第${charFrames.length}帧`, '角色-' + (this.ANIM_NAME[currentAnim] || currentAnim));
                hasFrames = true;
            } else if (charFrames.sheet && charFrames.sheet.complete) {
                // Sprite sheet：展示第1帧和最后一帧
                this._showFrameItem(strip, charFrames.sheet.src, '第1帧', '角色-' + (this.ANIM_NAME[currentAnim] || currentAnim));
                this._showFrameItem(strip, charFrames.sheet.src, `第${charFrames.count}帧`, '角色-' + (this.ANIM_NAME[currentAnim] || currentAnim));
                hasFrames = true;
            }
        }

        // 武器帧展示
        const cfg = this.WEAPON_MAP[this.state.weaponType];
        if (cfg && cfg.frames && cfg.frames[currentAnim] && cfg.frames[currentAnim].length > 1) {
            const paths = cfg.frames[currentAnim];
            this._showFrameItem(strip, paths[0], '第1帧', '武器-' + (this.ANIM_NAME[currentAnim] || currentAnim));
            this._showFrameItem(strip, paths[paths.length - 1], `第${paths.length}帧`, '武器-' + (this.ANIM_NAME[currentAnim] || currentAnim));
        }
    },

    _showFrameItem(strip, src, label, animLabel) {
        const item = document.createElement('div');
        item.className = 'dev-tool-frame-item';
        const img = document.createElement('img');
        img.src = src;
        img.alt = label;
        const lbl = document.createElement('span');
        lbl.className = 'frame-label';
        lbl.textContent = label;
        const anim = document.createElement('span');
        anim.className = 'frame-anim';
        anim.textContent = animLabel;
        item.appendChild(img);
        item.appendChild(lbl);
        item.appendChild(anim);
        strip.appendChild(item);
    },

    // 更新帧滑块范围
    _updateFrameSlider() {
        const slider = document.getElementById('devToolFrameSlider');
        if (!slider) { console.log('[DevTool] _updateFrameSlider: slider not found'); return; }
        const currentAnim = this.state.anim;
        const frameData = this._charFrames[currentAnim];
        console.log('[DevTool] _updateFrameSlider:', currentAnim, frameData);
        if (frameData && frameData.count && frameData.count > 1) {
            slider.max = frameData.count - 1;
            slider.min = 0;
            slider.value = this.state.frameIndex;
            slider.disabled = false;
            console.log('[DevTool] _updateFrameSlider: enabled, count=', frameData.count);
        } else {
            slider.max = 0;
            slider.min = 0;
            slider.value = 0;
            slider.disabled = true;
            console.log('[DevTool] _updateFrameSlider: disabled');
        }
    },

    // 更新帧编号显示
    _updateFrameLabel() {
        const label = document.getElementById('devToolFrameLabel');
        if (!label) return;
        const currentAnim = this.state.anim;
        const frameData = this._charFrames[currentAnim];
        const total = frameData && frameData.count ? frameData.count : 1;
        const current = this.state.frameIndex + 1;
        label.textContent = `${current} / ${total}`;
    },

    // 更新播放按钮文字
    _updatePlayBtn() {
        const btn = document.getElementById('devToolPlayBtn');
        if (!btn) return;
        btn.textContent = this.state.isPlaying ? '⏸ 暂停' : '▶ 播放';
    },

    // 启动帧动画循环
    _startFrameAnimation() {
        if (this._frameAnimId) cancelAnimationFrame(this._frameAnimId);
        
        const frameData = this._charFrames[this.state.anim];
        if (!frameData || !frameData.count || frameData.count <= 1) return;
        
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
                const slider = document.getElementById('devToolFrameSlider');
                if (slider) slider.value = this.state.frameIndex;
                this._draw();
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
        let prevIdx = 0, nextIdx = kfs.length - 1;
        
        for (let i = 0; i < kfs.length - 1; i++) {
            if (progress >= kfs[i].progress && progress <= kfs[i + 1].progress) {
                prev = kfs[i];
                next = kfs[i + 1];
                prevIdx = i;
                nextIdx = i + 1;
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
    
    // 从 WeaponAnimConfig 加载关键帧
    _loadKeyframes() {
        const wt = this.state.weaponType;
        const anim = this.state.anim;
        const cfg = WeaponAnimConfig.keyframes;
        
        if (cfg && cfg[wt] && cfg[wt][anim]) {
            this.keyframeSystem.keyframes = JSON.parse(JSON.stringify(cfg[wt][anim]));
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
        console.log('[DevTool] 关键帧已添加:', kf);
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
        console.log('[DevTool] 关键帧已清空');
    },
    
    // 更新关键帧UI
    _updateKeyframeUI() {
        const listEl = document.getElementById('devToolKeyframeList');
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
        
        const btn = document.getElementById('devToolSetHandAnchor');
        if (btn) {
            btn.style.background = sys.enabled ? '#4a7c59' : '';
            btn.textContent = sys.enabled ? '✋ 退出挂载点编辑' : '✋ 设置手部挂载点';
        }
        
        // 更新提示
        const canvasHint = document.getElementById('devToolHint');
        if (canvasHint) {
            canvasHint.innerHTML = sys.enabled
                ? `挂载点模式：拖动黄色圆点调整手部位置 · 武器自动跟随`
                : `拖动武器到人物位置 → 按 <kbd>R</kbd> 进入调整模式`;
        }
        
        this._draw();
    },

    _updateModeHint() {
        const hint = document.getElementById('devToolModeHint');
        if (!hint) return;
        const isRotate = this.state.mode === 'rotate';
        hint.innerHTML = `
            <div class="${isRotate ? '' : 'mode-active'}">🖱 左键拖动</div>
            <div class="${isRotate ? 'mode-active' : ''}">🔄 滚轮 = ${isRotate ? '旋转' : '缩放'}</div>
            <div>按 <kbd>R</kbd> 切换${isRotate ? '缩放' : '旋转'}模式</div>
        `;
        // 也更新浮层提示
        const canvasHint = document.getElementById('devToolHint');
        if (canvasHint) {
            canvasHint.innerHTML = isRotate
                ? `旋转模式：滚轮旋转 · 左键拖动 · <kbd>R</kbd> 切换`
                : `拖动武器到人物位置 → 按 <kbd>R</kbd> 进入调整模式`;
        }
    },

    _updateStatus() {
        const statusEl = document.getElementById('devToolStatus');
        if (statusEl) statusEl.textContent = this.ANIM_NAME[this.state.anim] || this.state.anim;
    },

    // 鼠标按下
    _onMouseDown(e) {
        const rect = this._canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cx = this._canvas.width / 2;
        const cy = this._canvas.height / 2;
        
        // ===== 挂载点模式：拖动手部位置 =====
        if (this.handAnchorSystem.enabled) {
            const sys = this.handAnchorSystem;
            const currentAnim = this.state.anim;
            const anchor = sys.handAnchors[currentAnim] || sys.handAnchors.idle;
            
            // 手部位置在屏幕上的坐标
            const handScreenX = cx + anchor.x;
            const handScreenY = cy + anchor.y;
            
            // 检查是否点击在手部附近
            const hitRadius = 20;
            const dist = Math.sqrt((mx - handScreenX) ** 2 + (my - handScreenY) ** 2);
            
            if (dist < hitRadius) {
                sys.dragHand = true;
                sys.handStartX = mx;
                sys.handStartY = my;
                sys.handAnchorStartX = anchor.x;
                sys.handAnchorStartY = anchor.y;
                console.log('[DevTool] Hand anchor drag started');
                return;
            }
        }
        
        const wp = this.weaponParams;

        // 武器中心在屏幕上的位置（Canvas坐标系：Y向下为正）
        const weaponScreenX = cx + wp.offsetX;
        const weaponScreenY = cy + wp.offsetY;

        // 检查是否点击在武器区域内
        const hitRadius = 60;
        const dist = Math.sqrt((mx - weaponScreenX) ** 2 + (my - weaponScreenY) ** 2);

        if (dist < hitRadius) {
            this.drag.active = true;
            this.drag.startX = mx;
            this.drag.startY = my;
            this.drag.startOffsetX = wp.offsetX;
            this.drag.startOffsetY = wp.offsetY;
            this.state.weaponOnCanvas = true;
            console.log('[DevTool] Drag started');
        } else {
            // 点击空白区域：直接设置武器位置为鼠标位置
            if (!this.state.weaponOnCanvas) {
                this.state.weaponOnCanvas = true;
                // 屏幕偏移 = 鼠标位置 - 玩家中心（Canvas坐标系，Y向下为正）
                wp.offsetX = mx - cx;
                wp.offsetY = my - cy;
                this._syncInputs();
                this._draw();
            }
        }
    },

    // 鼠标移动
    _onMouseMove(e) {
        const rect = this._canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cx = this._canvas.width / 2;
        const cy = this._canvas.height / 2;
        
        // ===== 挂载点模式：拖动手部 =====
        if (this.handAnchorSystem.dragHand) {
            const sys = this.handAnchorSystem;
            const dx = mx - sys.handStartX;
            const dy = my - sys.handStartY;
            
            const currentAnim = this.state.anim;
            const anchor = sys.handAnchors[currentAnim] || sys.handAnchors.idle;
            
            // 更新挂载点位置（相对于玩家中心）
            anchor.x = sys.handAnchorStartX + dx;
            anchor.y = sys.handAnchorStartY + dy;
            
            // 同步更新武器位置（武器跟随手部）
            this.weaponParams.offsetX = anchor.x;
            this.weaponParams.offsetY = anchor.y;
            
            this._syncInputs();
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
        this._draw();
    },

    // 鼠标释放
    _onMouseUp() {
        this.drag.active = false;
        this.handAnchorSystem.dragHand = false;
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
        this._draw();
    },

    // 同步输入框
    _syncInputs() {
        const elX = document.getElementById('devToolOffX');
        const elY = document.getElementById('devToolOffY');
        const elR = document.getElementById('devToolRot');
        const elS = document.getElementById('devToolScl');
        if (elX) elX.value = Math.round(this.weaponParams.offsetX);
        if (elY) elY.value = Math.round(this.weaponParams.offsetY);
        if (elR) elR.value = Math.round(this.weaponParams.rotation);
        if (elS) elS.value = this.weaponParams.scale.toFixed(2);
        
        // 更新缩放信息面板
        this._updateScaleInfo();
    },
    
    // 更新缩放信息面板
    _updateScaleInfo() {
        const panel = document.getElementById('devToolScaleInfo');
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
    _syncInputs() {
        const elX = document.getElementById('devToolOffX');
        const elY = document.getElementById('devToolOffY');
        const elR = document.getElementById('devToolRot');
        const elS = document.getElementById('devToolScl');
        if (elX) elX.value = Math.round(this.weaponParams.offsetX);
        if (elY) elY.value = Math.round(this.weaponParams.offsetY);
        if (elR) elR.value = Math.round(this.weaponParams.rotation);
        if (elS) elS.value = this.weaponParams.scale.toFixed(2);
        
        // 更新缩放信息面板
        this._updateScaleInfo();
    },
    
    // 更新缩放信息面板
    _updateScaleInfo() {
        const panel = document.getElementById('devToolScaleInfo');
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
    _syncInputs() {
        const elX = document.getElementById('devToolOffX');
        const elY = document.getElementById('devToolOffY');
        const elR = document.getElementById('devToolRot');
        const elS = document.getElementById('devToolScl');
        if (elX) elX.value = Math.round(this.weaponParams.offsetX);
        if (elY) elY.value = Math.round(this.weaponParams.offsetY);
        if (elR) elR.value = Math.round(this.weaponParams.rotation);
        if (elS) elS.value = this.weaponParams.scale.toFixed(2);
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
        const label = document.getElementById('devToolZoomLabel');
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
                    const idx = this.state.frameIndex % frameData.count;
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
            const ms = s * 0.75;
            const weaponType = this.WEAPON_MAP[this.state.weaponType]?.type || 'melee';
            const isMelee = weaponType === 'melee';
            const isGun = ['pistol', 'machinegun', 'rifle', 'shotgun'].includes(weaponType);
            
            // ===== 统一武器参数计算 =====
            // 所有动画统一使用 weaponParams（支持鼠标拖动和滚轮调整）
            // 关键帧仅用于保存和导出，不实时覆盖 weaponParams
            const drawParams = {
                offsetX: this.weaponParams.offsetX,
                offsetY: this.weaponParams.offsetY,
                rotation: this.weaponParams.rotation,
                scale: this.weaponParams.scale
            };
            
            // 关键帧系统状态（仅用于显示指示器，不覆盖绘制参数）
            const useKeyframes = this.keyframeSystem.enabled && this.keyframeSystem.keyframes.length > 0;
            
            // ===== 攻击/行走状态指示器 =====
            if ((this.state.anim === 'attack' || this.state.anim === 'walk') && isMelee) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                
                if (this.state.anim === 'attack' || this.state.anim === 'walk') {
                    // 攻击/行走动画进度指示器（统一）
                    const currentAnim = this.state.anim;
                    const frameData = this._charFrames[currentAnim];
                    const progress = this.state.frameIndex / frameData.count;
                    const animName = currentAnim === 'attack' ? '攻击' : '行走';
                    ctx.fillStyle = currentAnim === 'attack' ? 'rgba(255,80,80,0.8)' : 'rgba(100,200,100,0.8)';
                    ctx.font = 'bold 14px monospace';
                    ctx.textAlign = 'center';
                    const kfIndicator = useKeyframes ? ' [关键帧]' : '';
                    ctx.fillText(`${animName}: 帧 ${this.state.frameIndex + 1}/${frameData.count}${kfIndicator}`, cx, 30);
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
            
            // ===== 统一武器绘制 =====
            ctx.save();
            ctx.translate(cx, cy);
            
            // 使用统一参数偏移（支持拖动 + 关键帧覆盖）
            ctx.translate(drawParams.offsetX, drawParams.offsetY);
            
            // 基础旋转
            ctx.rotate(Math.PI / 2);
            
            // 武器类型相关的中心偏移
            if (isMelee) {
                ctx.translate(0, -ms * 0.85);
            } else if (isGun) {
                ctx.translate(0, -s * 0.42);
            }
            
            // 应用旋转
            ctx.rotate(drawParams.rotation * Math.PI / 180);
            
            // 绘制武器
            const scale = drawParams.scale;
            if (isMelee) {
                const w = ms * 0.63 * scale;
                const h = ms * scale;
                ctx.drawImage(this.weaponImage, -w / 2, -h / 2, w, h);
            } else if (isGun) {
                const w = s * 0.75 * scale;
                const h = s * scale;
                ctx.drawImage(this.weaponImage, -w / 2, 0, w, h);
            } else {
                const imgW = this.weaponImage.naturalWidth || 1024;
                const imgH = this.weaponImage.naturalHeight || 1024;
                const aspect = imgW / imgH;
                const h = s * scale;
                const w = h * aspect;
                ctx.drawImage(this.weaponImage, -w / 2, -h / 2, w, h);
            }
            
            // 绘制旋转中心
            ctx.fillStyle = '#FFD700';
            ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
            
            // 绘制手部挂载点（如果启用）
            if (this.handAnchorSystem.enabled && isMelee) {
                const sys = this.handAnchorSystem;
                const currentAnim = this.state.anim;
                const anchor = sys.handAnchors[currentAnim] || sys.handAnchors.idle;
                
                // 挂载点位置（相对于玩家中心）
                const handX = anchor.x;
                const handY = anchor.y;
                
                // 绘制挂载点指示器（黄色圆点）
                ctx.fillStyle = 'rgba(255, 200, 50, 0.8)';
                ctx.strokeStyle = 'rgba(255, 200, 50, 1)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(handX, handY, 8, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(handX, handY, 10, 0, Math.PI * 2); ctx.stroke();
                
                // 绘制连线到武器中心
                ctx.strokeStyle = 'rgba(255, 200, 50, 0.4)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(handX, handY); ctx.lineTo(0, 0); ctx.stroke();
                ctx.setLineDash([]);
                
                // 标签
                ctx.fillStyle = 'rgba(255, 200, 50, 0.9)';
                ctx.font = '10px monospace';
                ctx.fillText(`手 (${Math.round(handX)}, ${Math.round(handY)})`, handX + 12, handY - 8);
            }
            
            ctx.restore();
            
            // ===== 坐标标注（所有状态都显示） =====
            const wp = this.weaponParams;
            const weaponScreenX = cx + wp.offsetX;
            const weaponScreenY = cy + wp.offsetY;
            ctx.fillStyle = '#d4c5a9';
            ctx.font = '11px monospace';
            ctx.fillText(`屏幕偏移: (${Math.round(wp.offsetX)}, ${Math.round(wp.offsetY)})`, weaponScreenX + 8, weaponScreenY - 8);
            ctx.fillText(`Rotation: ${Math.round(wp.rotation)}°`, weaponScreenX + 8, weaponScreenY + 12);
            if (this.state.anim === 'attack' && useKeyframes) {
                ctx.fillStyle = '#90d070';
                ctx.fillText(`[关键帧模式]`, weaponScreenX + 8, weaponScreenY + 28);
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
        const s = 105;
        const ms = s * 0.75; // 78.75
        const wt = this.state.weaponType;
        const weaponType = this.WEAPON_MAP[wt]?.type || 'melee';
        const isMelee = weaponType === 'melee';
        const isGun = ['pistol', 'machinegun', 'rifle', 'shotgun'].includes(weaponType);
        
        // 将 weaponParams 转换为 holdOffset（与新的 _draw 变换链一致）
        // 新的 _draw 变换链：
        //   translate(cx, cy) → translate(offsetX, offsetY) → rotate(π/2) → translate(0, -ms*0.85)
        // WeaponTransform 变换链：
        //   baseX(-7) + holdOffsetX + afterX(ms*0.85) → rotate(π/2) → translate(0, -afterX)
        // 所以：offsetX = baseX + holdOffsetX = -7 + holdOffsetX
        //      holdOffsetX = offsetX + 7
        //      holdOffsetY = offsetY
        let holdOffsetX, holdOffsetY;
        if (isMelee) {
            holdOffsetX = this.weaponParams.offsetX + 7;
            holdOffsetY = this.weaponParams.offsetY;
        } else if (isGun) {
            // 枪械类：baseX = 8 (pkm/akm) 或 -15 (pistol)
            const gunBaseX = (wt === 'pistol' || wt === 'deagle') ? -15 : 8;
            holdOffsetX = this.weaponParams.offsetX - gunBaseX;
            holdOffsetY = this.weaponParams.offsetY;
        } else {
            // 弓类：baseX = -7
            holdOffsetX = this.weaponParams.offsetX + 7;
            holdOffsetY = this.weaponParams.offsetY;
        }
        
        // 直接修改 WeaponAnimConfig（实时生效，无需重新构建）
        const cfg = WeaponAnimConfig[wt];
        if (cfg) {
            // 获取当前动画状态
            const currentAnim = this.state.anim;
            // 判断是否有状态子配置（支持多状态独立配置）
            const hasStateConfig = cfg.idle && typeof cfg.idle === 'object';
            
            if (hasStateConfig && (currentAnim === 'idle' || currentAnim === 'walk' || currentAnim === 'running')) {
                // 保存到对应状态的子配置
                if (!cfg[currentAnim]) cfg[currentAnim] = {};
                cfg[currentAnim].holdOffsetX = Math.round(holdOffsetX);
                cfg[currentAnim].holdOffsetY = Math.round(holdOffsetY);
                cfg[currentAnim].idleRotation = Math.round(this.weaponParams.rotation);
                cfg[currentAnim].idleScale = parseFloat(this.weaponParams.scale.toFixed(2));
                console.log('[DevTool] WeaponAnimConfig[' + wt + '].' + currentAnim + ' updated:', {
                    holdOffsetX: cfg[currentAnim].holdOffsetX,
                    holdOffsetY: cfg[currentAnim].holdOffsetY,
                    idleRotation: cfg[currentAnim].idleRotation,
                    idleScale: cfg[currentAnim].idleScale,
                });
            } else if (currentAnim === 'attack' || currentAnim === 'walk') {
                // 攻击/行走动画：保存关键帧配置
                if (this.keyframeSystem.enabled && this.keyframeSystem.keyframes.length > 0) {
                    // 保存关键帧到 WeaponAnimConfig
                    if (!WeaponAnimConfig.keyframes) WeaponAnimConfig.keyframes = {};
                    if (!WeaponAnimConfig.keyframes[wt]) WeaponAnimConfig.keyframes[wt] = {};
                    WeaponAnimConfig.keyframes[wt][currentAnim] = JSON.parse(JSON.stringify(this.keyframeSystem.keyframes));
                    console.log('[DevTool] 关键帧已保存:', wt, currentAnim, this.keyframeSystem.keyframes);
                }
            } else {
                // 传统保存：保存到全局配置
                cfg.holdOffsetX = Math.round(holdOffsetX);
                cfg.holdOffsetY = Math.round(holdOffsetY);
                cfg.idleRotation = Math.round(this.weaponParams.rotation);
                cfg.idleScale = parseFloat(this.weaponParams.scale.toFixed(2));
                console.log('[DevTool] WeaponAnimConfig updated:', wt, {
                    holdOffsetX: cfg.holdOffsetX,
                    holdOffsetY: cfg.holdOffsetY,
                    idleRotation: cfg.idleRotation,
                    idleScale: cfg.idleScale,
                });
            }
            
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
        }
        
        const output = {
            weaponType: wt,
            weaponName: this.WEAPON_MAP[wt]?.name,
            anim: this.state.anim,
            holdOffsetX: Math.round(holdOffsetX),
            holdOffsetY: Math.round(holdOffsetY),
            rotation: Math.round(this.weaponParams.rotation),
            scale: parseFloat(this.weaponParams.scale.toFixed(2)),
        };
        
        // 如果有关键帧，添加到输出
        if (this.keyframeSystem.enabled && this.keyframeSystem.keyframes.length > 0) {
            output.keyframes = this.keyframeSystem.keyframes;
        }
        
        const json = JSON.stringify(output, null, 2);

        const outputEl = document.getElementById('devToolDataOutput');
        if (outputEl) {
            outputEl.textContent = json;
            outputEl.style.display = 'block';
        }

        // 复制到剪贴板
        navigator.clipboard.writeText(json).then(() => {
            console.log('[DevTool] 数据已复制:', json);
            this._showToast('✅ 已应用到游戏并复制到剪贴板');
        }).catch(() => {
            console.log('[DevTool] 复制失败');
            this._showToast('✅ 已应用到游戏（复制失败）');
        });
    },

    // 显示 Toast 提示
    _showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(40,60,30,0.95);color:#90d070;padding:10px 20px;border-radius:6px;font-size:14px;z-index:10000;pointer-events:none;animation:toastFade 2s ease-out forwards;font-family:SimHei,"Microsoft YaHei",sans-serif;border:1px solid rgba(144,208,112,0.3);';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2000);
    },

    // 重置
    _reset() {
        const weaponType = this.WEAPON_MAP[this.state.weaponType]?.type || 'melee';
        const isMelee = weaponType === 'melee';
        const isGun = ['pistol', 'machinegun', 'rifle', 'shotgun'].includes(weaponType);
        const currentAnim = this.state.anim;
        
        if (isMelee) {
            // 剑类：从 WeaponAnimConfig 读取 holdOffsetX/Y，反向推导到 weaponParams
            // 新的变换链：offsetX = baseX + holdOffsetX = -7 + holdOffsetX
            //              offsetY = holdOffsetY
            const swordCfg = WeaponAnimConfig[this.state.weaponType] || WeaponAnimConfig.sword;
            const hasStateConfig = swordCfg && swordCfg.idle && typeof swordCfg.idle === 'object';
            let targetCfg;
            if (hasStateConfig && (currentAnim === 'idle' || currentAnim === 'walk' || currentAnim === 'running') && swordCfg[currentAnim]) {
                targetCfg = swordCfg[currentAnim];
            } else {
                targetCfg = swordCfg;
            }
            this.weaponParams = {
                offsetX: Math.round(-7 + (targetCfg.holdOffsetX !== undefined ? targetCfg.holdOffsetX : -35)),
                offsetY: Math.round(targetCfg.holdOffsetY !== undefined ? targetCfg.holdOffsetY : 4),
                rotation: targetCfg.idleRotation || 0,
                scale: targetCfg.idleScale || 1.0
            };
        } else if (isGun) {
            // 枪械类：从 WeaponAnimConfig 读取
            // offsetX = baseX + holdOffsetX
            const gunCfg = WeaponAnimConfig[this.state.weaponType] || WeaponAnimConfig.pkm;
            const gunBaseX = (this.state.weaponType === 'pistol' || this.state.weaponType === 'deagle') ? -15 : 8;
            this.weaponParams = {
                offsetX: Math.round(gunBaseX + (gunCfg.holdOffsetX || 0)),
                offsetY: Math.round(gunCfg.holdOffsetY || 0),
                rotation: gunCfg.idleRotation || 0,
                scale: gunCfg.idleScale || 1.0
            };
        } else {
            // 弓类：baseX = -7
            const bowCfg = WeaponAnimConfig.bow;
            this.weaponParams = { 
                offsetX: Math.round(-7 + (bowCfg.holdOffsetX || 0)), 
                offsetY: Math.round(bowCfg.holdOffsetY || 0), 
                rotation: bowCfg.idleRotation || 0, 
                scale: bowCfg.idleScale || 1.0 
            };
        }
        this.state.weaponOnCanvas = false;
        this.state.mode = 'move';
        this._canvas.classList.remove('mode-rotate');
        this._syncInputs();
        this._updateModeHint();
        this._draw();
    },

    // 显示/隐藏/切换
    show() {
        this._active = true;
        if (this._panel) this._panel.classList.add('active');
        const trigger = document.getElementById('devToolTrigger');
        if (trigger) trigger.classList.add('active');
        // 默认切换到武器 tab
        this.switchTab('weapon');
        this._draw();
    },
    hide() {
        this._active = false;
        if (this._panel) this._panel.classList.remove('active');
        const trigger = document.getElementById('devToolTrigger');
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
        this.hide(); // 关闭交互开发工具

        const overlay = document.getElementById('coordOverlay');
        const panel = document.getElementById('coordPanel');
        if (overlay) overlay.style.display = 'block';
        if (panel) panel.style.display = 'flex';

        // 清除之前的元素
        overlay.querySelectorAll('.rect-preview, .mouse-label, .start-marker, .final-rect').forEach(el => el.remove());

        // 重置显示
        document.getElementById('coordStart').textContent = '--';
        document.getElementById('coordEnd').textContent = '--';
        document.getElementById('coordSize').textContent = '--';

        // 获取游戏容器的边界和缩放比例
        const gameContainer = document.getElementById('gameContainer');
        const gameCanvas = document.getElementById('gameCanvas');
        const getGameScale = () => {
            const container = gameContainer || document.body;
            const containerRect = container.getBoundingClientRect();
            if (!gameCanvas) return { scaleX: 1, scaleY: 1, rect: containerRect };
            const canvasRect = gameCanvas.getBoundingClientRect();
            return {
                scaleX: gameCanvas.width / canvasRect.width || 1,
                scaleY: gameCanvas.height / canvasRect.height || 1,
                rect: containerRect
            };
        };

        let isDragging = false;
        let startX = 0, startY = 0;
        let rectPreview = null;
        let mouseLabel = null;
        let startMarker = null;

        // 鼠标按下 - 开始框选
        const onMouseDown = (e) => {
            if (e.button !== 0) return; // 只响应左键
            isDragging = true;
            const scale = getGameScale();
            startX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
            startY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);

            // 创建起始标记（使用屏幕坐标显示）
            startMarker = document.createElement('div');
            startMarker.className = 'start-marker';
            startMarker.style.left = (e.clientX - 4) + 'px';
            startMarker.style.top = (e.clientY - 4) + 'px';
            overlay.appendChild(startMarker);

            // 创建矩形预览
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
                mouseLabel.textContent = `${gameX}, ${Math.round(scale.rect.height * scale.scaleY - gameY)}`;
                mouseLabel.style.left = (e.clientX + 12) + 'px';
                mouseLabel.style.top = (e.clientY + 12) + 'px';
                return;
            }

            const scale = getGameScale();
            const currentX = Math.round((e.clientX - scale.rect.left) * scale.scaleX);
            const currentY = Math.round((e.clientY - scale.rect.top) * scale.scaleY);
            const left = Math.min(startX, currentX);
            const top = Math.min(startY, currentY);
            const width = Math.abs(currentX - startX);
            const height = Math.abs(currentY - startY);

            rectPreview.style.left = (e.clientX - (currentX - left)) + 'px';
            rectPreview.style.top = (e.clientY - (currentY - top)) + 'px';
            rectPreview.style.width = width + 'px';
            rectPreview.style.height = height + 'px';

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
            const top = Math.min(startY, endY);
            const width = Math.abs(endX - startX);
            const height = Math.abs(endY - startY);

            // 移除预览元素
            if (rectPreview) rectPreview.remove();
            if (mouseLabel) mouseLabel.remove();
            if (startMarker) startMarker.remove();

            // 创建最终矩形
            const finalRect = document.createElement('div');
            finalRect.className = 'final-rect';
            finalRect.style.left = left + 'px';
            finalRect.style.top = top + 'px';
            finalRect.style.width = width + 'px';
            finalRect.style.height = height + 'px';
            overlay.appendChild(finalRect);

            // 更新面板显示（显示游戏坐标 - left/bottom 模式）
            const containerHeight = scale.rect.height * scale.scaleY;
            const startBottom = Math.round(containerHeight - startY);
            const endBottom = Math.round(containerHeight - endY);
            const bottom = Math.min(startBottom, endBottom);
            
            document.getElementById('coordStart').textContent = `${left}, ${bottom}`;
            document.getElementById('coordEnd').textContent = `${left + width}, ${bottom + height}`;
            document.getElementById('coordSize').textContent = `${width} x ${height}`;
        };

        // 右键退出
        const onContextMenu = (e) => {
            e.preventDefault();
            this._stopCoordTool();
        };

        // 绑定事件
        overlay.addEventListener('mousedown', onMouseDown);
        overlay.addEventListener('mousemove', onMouseMove);
        overlay.addEventListener('mouseup', onMouseUp);
        overlay.addEventListener('contextmenu', onContextMenu);

        // 复制按钮
        const copyBtn = document.getElementById('coordCopyBtn');
        if (copyBtn) {
            copyBtn.onclick = () => {
                const start = document.getElementById('coordStart').textContent;
                const end = document.getElementById('coordEnd').textContent;
                const size = document.getElementById('coordSize').textContent;
                const text = `left: ${start.split(',')[0].trim()}px; bottom: ${start.split(',')[1].trim()}px; width: ${size.split('x')[0].trim()}px; height: ${size.split('x')[1].trim()}px;`;
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.textContent = '✅ 已复制';
                    setTimeout(() => copyBtn.textContent = '📋 复制坐标', 1500);
                }).catch(() => {
                    // fallback
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    copyBtn.textContent = '✅ 已复制';
                    setTimeout(() => copyBtn.textContent = '📋 复制坐标', 1500);
                });
            };
        }

        // 保存引用以便后续清理
        this._coordToolCleanup = () => {
            overlay.removeEventListener('mousedown', onMouseDown);
            overlay.removeEventListener('mousemove', onMouseMove);
            overlay.removeEventListener('mouseup', onMouseUp);
            overlay.removeEventListener('contextmenu', onContextMenu);
            overlay.querySelectorAll('.rect-preview, .mouse-label, .start-marker, .final-rect').forEach(el => el.remove());
            if (overlay) overlay.style.display = 'none';
            if (panel) panel.style.display = 'none';
            if (copyBtn) copyBtn.onclick = null;
        };
    },

    _stopCoordTool() {
        if (this._coordToolCleanup) {
            this._coordToolCleanup();
            this._coordToolCleanup = null;
        }
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
                        const img = new Image();
                        img.src = path;
                        this.images[path] = img;
                    }
                });
            }
        }
    }
};

export default DevTool;
export { DevTool };
