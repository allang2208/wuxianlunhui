import { WeaponAnimConfig } from '../items/weapon-anim-config.js';
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
        anim: 'idle',        // 当前动画
        weaponType: 'sword', // 当前武器类型
        mode: 'move',        // 'move'=移动+缩放, 'rotate'=旋转
        weaponOnCanvas: false, // 武器是否已放到画布上
        frameIndex: 0,      // 当前帧索引
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
            content.classList.toggle('active', content.dataset.tabContent === tabName);
        });
        // 显示/隐藏 AI 开发工具
        if (tabName === 'ai') {
            AIDevTool.show();
        } else {
            AIDevTool.hide();
        }
        // 怪物贴图调整工具无需显式 show/hide，只需重绘
        if (tabName === 'enemy') {
            EnemySpriteTool._draw();
        }
        // 如果切换回武器 tab，重新绘制 Canvas
        if (tabName === 'weapon') {
            this._draw();
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
                this.state.frameIndex = 0; // 切换动画时重置到第1帧
                this.state.isPlaying = false;
                this._stopFrameAnimation();
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
            el.addEventListener('change', () => {
                const keys = ['offsetX', 'offsetY', 'rotation', 'scale'];
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
                this.state.isPlaying = false; // 拖动时暂停
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
        });

        // 武器图片拖放
        const weaponImg = document.getElementById('devToolWeaponImg');
        if (weaponImg) {
            weaponImg.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', 'weapon');
                e.dataTransfer.effectAllowed = 'move';
            });
        }

        // Canvas 接收拖放（从右侧武器预览拖到 canvas）
        this._canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this._canvas.style.cursor = 'copy';
        });
        this._canvas.addEventListener('dragleave', () => {
            this._canvas.style.cursor = this.state.mode === 'rotate' ? 'ew-resize' : 'grab';
        });
        this._canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            this._canvas.style.cursor = this.state.mode === 'rotate' ? 'ew-resize' : 'grab';
            const data = e.dataTransfer.getData('text/plain');
            if (data === 'weapon') {
                const rect = this._canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const cx = this._canvas.width / 2;
                const cy = this._canvas.height / 2;
                this.state.weaponOnCanvas = true;
                this.weaponParams.offsetX = mx - cx;
                this.weaponParams.offsetY = cy - my;
                this._syncInputs();
                this._draw();
            }
        });

        // 初始状态
        this._updateStatus();
        this._updateModeHint();
    },

    // 加载帧图片
    _loadFrameImages(type) {
        const cfg = this.WEAPON_MAP[type];
        if (!cfg || !cfg.frames) {
            this._frameImages = null;
            return;
        }
        this._frameImages = {};
        for (const animName in cfg.frames) {
            const paths = cfg.frames[animName];
            this._frameImages[animName] = paths.map(p => {
                const img = new Image();
                img.src = p;
                return img;
            });
        }
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
        if (!slider) return;
        const currentAnim = this.state.anim;
        const frameData = this._charFrames[currentAnim];
        if (frameData && frameData.count && frameData.count > 1) {
            slider.max = frameData.count - 1;
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
        if ((currentAnim === 'walk' || currentAnim === 'running') && this._charFrames[currentAnim]) {
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
        const wp = this.weaponParams;

        // 武器中心在屏幕上的位置（Y轴反转，与绿色箭头Y+向上约定一致）
        const weaponScreenX = cx + wp.offsetX;
        const weaponScreenY = cy - wp.offsetY;

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
                // 屏幕偏移 = 鼠标位置 - 玩家中心（Y轴反转，与绿色箭头Y+向上约定一致）
                wp.offsetX = mx - cx;
                wp.offsetY = cy - my;
                this._syncInputs();
                this._draw();
            }
        }
    },

    // 鼠标移动
    _onMouseMove(e) {
        if (!this.drag.active) return;
        const rect = this._canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const dx = mx - this.drag.startX;
        const dy = my - this.drag.startY;

        // 武器跟随鼠标：Y轴反转，与绿色箭头Y+向上约定一致
        this.weaponParams.offsetX = this.drag.startOffsetX + dx;
        this.weaponParams.offsetY = this.drag.startOffsetY - dy;
        this._syncInputs();
        this._draw();
    },

    // 鼠标释放
    _onMouseUp() {
        this.drag.active = false;
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
                // 待机状态：使用行走第一帧，需逆时针旋转90度（与游戏一致）
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(-Math.PI / 2);
                ctx.drawImage(charImg, -spriteSize / 2, -spriteSize / 2, spriteSize, spriteSize);
                ctx.restore();
            } else if (currentAnim === 'walk' || currentAnim === 'running') {
                // 从 sprite sheet 提取帧
                const frameData = this._charFrames[currentAnim];
                if (frameData && frameData.sheet && frameData.sheet.complete && frameData.sheet.naturalWidth > 0) {
                    const idx = this.state.frameIndex;
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

        // 绘制帧参考点（右手位置，帮助对齐武器）
        const _currentAnim = this.state.anim;
        if (_currentAnim === 'walk' || _currentAnim === 'running') {
            const handRefX = cx + 25; // 角色右侧，参考点
            const handRefY = cy - 15; // 略高于中心
            ctx.fillStyle = 'rgba(255, 200, 50, 0.6)';
            ctx.beginPath();
            ctx.arc(handRefX, handRefY, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 200, 50, 0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();
            // 标签
            ctx.fillStyle = 'rgba(255, 200, 50, 0.8)';
            ctx.font = '10px monospace';
            ctx.fillText('右手', handRefX + 8, handRefY - 8);
        }

        // 武器绘制（如果已在画布上）- 使用与游戏 renderWeapon 完全一致的变换链
        if (this.state.weaponOnCanvas && this.weaponImage && this.weaponImage.complete) {
            const wp = this.weaponParams;
            const s = 105; // 与游戏中 WEAPON_ANIM.size 一致
            const ms = s * 0.75;
            
            // 获取当前武器类型
            const weaponType = this.WEAPON_MAP[this.state.weaponType]?.type || 'melee';
            const isMelee = weaponType === 'melee';
            const isBow = weaponType === 'bow';
            const isGun = ['pistol', 'machinegun', 'rifle', 'shotgun'].includes(weaponType);
            
            // 将屏幕偏移转换为 holdOffset（与 renderWeapon 变换链兼容）
            // 注意：不同武器类型的变换链不同！
            // 剑类：ctx.translate(0, -ms * 0.85) 在 rotate(π/2) 之后，mainBaseX = -7
            // 弓类：没有 translate(0, -ms * 0.85) 这个偏移，mainBaseX = -7
            // 枪械类：ctx.translate(0, -s * 0.42) 在 rotate(π/2) 之后，mainBaseX = 8
            let mainBaseX = -7;
            let holdOffsetX, holdOffsetY;
            if (isMelee) {
                holdOffsetX = wp.offsetX - ms * 0.85 + 7;
                holdOffsetY = -wp.offsetY;
            } else if (isGun) {
                mainBaseX = 8;
                holdOffsetX = wp.offsetX - 104.6; // 0.92*s + 8 = 96.6 + 8
                holdOffsetY = -wp.offsetY;
            } else {
                // 弓类
                holdOffsetX = wp.offsetX + 7;
                holdOffsetY = -wp.offsetY;
            }
            
            ctx.save();
            
            // 0. 移动到玩家中心
            ctx.translate(cx, cy);
            
            // 1. 主手基础偏移（与游戏中 mainBaseX/Y 一致）
            ctx.translate(mainBaseX, 0);
            
            // 2. holdOffset（WeaponAnimConfig 参数）
            ctx.translate(holdOffsetX, holdOffsetY);
            
            // 3. 基础旋转（让武器水平朝右，与游戏中 Math.PI / 2 一致）
            ctx.rotate(Math.PI / 2);
            
            // 4. 武器中心偏移
            if (isMelee) {
                ctx.translate(0, -ms * 0.85);
            } else if (isGun) {
                ctx.translate(0, -s * 0.42);
            }
            
            // 5. 最终角度（含 idleRotation + 呼吸效果）
            let finalAngle = 0;
            // 呼吸效果（与游戏中一致）
            if (this.state.anim === 'idle') {
                finalAngle += Math.sin(Date.now() / 400) * 0.06;
            }
            // idleRotation（WeaponAnimConfig 参数）
            if (wp.rotation) {
                finalAngle += wp.rotation * Math.PI / 180;
            }
            ctx.rotate(finalAngle);
            
            // 6. 绘制武器（不同武器类型尺寸不同）
            const scale = wp.scale || 1;
            if (isMelee) {
                const w = ms * 0.63 * scale;
                const h = ms * scale;
                ctx.drawImage(this.weaponImage, -w / 2, -h / 2, w, h);
            } else if (isGun) {
                const w = s * 0.75 * scale;
                const h = s * scale;
                ctx.drawImage(this.weaponImage, -w / 2, 0, w, h);
            } else {
                // 弓类：根据图片宽高比绘制
                const imgW = this.weaponImage.naturalWidth || 1024;
                const imgH = this.weaponImage.naturalHeight || 1024;
                const aspect = imgW / imgH;
                const h = s * scale;
                const w = h * aspect;
                ctx.drawImage(this.weaponImage, -w / 2, -h / 2, w, h);
            }
            
            // 绘制旋转中心（黄点）- 在变换后的坐标系原点
            ctx.fillStyle = '#FFD700';
            ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
            
            ctx.restore();
            
            // 武器中心在屏幕上的位置（Y轴反转，与绿色箭头Y+向上约定一致）
            const weaponScreenX = cx + wp.offsetX;
            const weaponScreenY = cy - wp.offsetY;
            
            // 绘制坐标标注（Canvas坐标系，与游戏渲染一致）
            ctx.fillStyle = '#d4c5a9';
            ctx.font = '11px monospace';
            ctx.fillText(`屏幕偏移: (${Math.round(wp.offsetX)}, ${Math.round(wp.offsetY)})`, weaponScreenX + 8, weaponScreenY - 8);
            ctx.fillText(`idleRotation: ${Math.round(wp.rotation)}°`, weaponScreenX + 8, weaponScreenY + 12);
        } else if (!this.state.weaponOnCanvas) {
            // 提示文字
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
        
        // 将屏幕偏移转换为 holdOffset（与 renderWeapon 变换链兼容）
        // 注意：不同武器类型的转换公式不同！
        // 剑类：holdOffsetX = offsetX - ms*0.85 + 7
        // 弓类：holdOffsetX = offsetX + 7
        // 枪械类：holdOffsetX = offsetX - (0.92*s + 8) = offsetX - 104.6
        let holdOffsetX, holdOffsetY;
        if (isMelee) {
            holdOffsetX = this.weaponParams.offsetX - ms * 0.85 + 7;
            holdOffsetY = -this.weaponParams.offsetY;
        } else if (isGun) {
            holdOffsetX = this.weaponParams.offsetX - 104.6;
            holdOffsetY = -this.weaponParams.offsetY;
        } else {
            // 弓类
            holdOffsetX = this.weaponParams.offsetX + 7;
            holdOffsetY = -this.weaponParams.offsetY;
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
            // 剑类：检查是否有状态子配置
            const swordCfg = WeaponAnimConfig[this.state.weaponType] || WeaponAnimConfig.sword;
            const hasStateConfig = swordCfg && swordCfg.idle && typeof swordCfg.idle === 'object';
            let targetCfg;
            if (hasStateConfig && (currentAnim === 'idle' || currentAnim === 'walk' || currentAnim === 'running') && swordCfg[currentAnim]) {
                targetCfg = swordCfg[currentAnim];
            } else {
                targetCfg = swordCfg;
            }
            // 反向推导屏幕偏移
            const ms = 105 * 0.75;
            this.weaponParams = {
                offsetX: Math.round((targetCfg.holdOffsetX !== undefined ? targetCfg.holdOffsetX : (ms * 0.85 - 7)) - ms * 0.85 + 7),
                offsetY: Math.round(-(targetCfg.holdOffsetY !== undefined ? targetCfg.holdOffsetY : 4)),
                rotation: targetCfg.idleRotation || 0,
                scale: targetCfg.idleScale || 1.0
            };
        } else if (isGun) {
            // 枪械类：使用 WeaponAnimConfig 当前配置反向推导
            const gunCfg = WeaponAnimConfig[this.state.weaponType] || WeaponAnimConfig.pkm;
            // holdOffsetX = wp.offsetX - 104.6 → wp.offsetX = holdOffsetX + 104.6
            this.weaponParams = {
                offsetX: Math.round((gunCfg.holdOffsetX || 0) + 104.6),
                offsetY: Math.round(-(gunCfg.holdOffsetY || 0)),
                rotation: gunCfg.idleRotation || 0,
                scale: gunCfg.idleScale || 1.0
            };
        } else {
            // 弓类：使用 WeaponAnimConfig.bow 当前配置
            const bowCfg = WeaponAnimConfig.bow;
            this.weaponParams = { 
                offsetX: Math.round((bowCfg.holdOffsetX || 0) - 7), 
                offsetY: Math.round(-(bowCfg.holdOffsetY || 0)), 
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
    switchTab(tabName) {
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

    // ===== 坐标工具 =====
    _startCoordTool() {
        this.hide(); // 关闭交互开发工具

        const overlay = document.getElementById('coordOverlay');
        const panel = document.getElementById('coordPanel');
        if (!overlay || !panel) return;

        overlay.classList.add('active');
        panel.classList.add('active');

        // 创建鼠标坐标标签
        const label = document.createElement('div');
        label.className = 'mouse-label';
        label.id = 'coordMouseLabel';
        overlay.appendChild(label);

        // 创建矩形预览
        const rectPreview = document.createElement('div');
        rectPreview.className = 'rect-preview';
        rectPreview.id = 'coordRectPreview';
        rectPreview.style.display = 'none';
        overlay.appendChild(rectPreview);

        // 创建起始点标记
        const startMarker = document.createElement('div');
        startMarker.className = 'start-marker';
        startMarker.id = 'coordStartMarker';
        startMarker.style.display = 'none';
        overlay.appendChild(startMarker);

        // 状态
        const state = {
            dragging: false,
            startX: 0, startY: 0,
            currentX: 0, currentY: 0,
        };

        const updateLabel = (x, y) => {
            label.textContent = `X:${Math.round(x)} Y:${Math.round(y)}`;
            label.style.left = (x + 12) + 'px';
            label.style.top = (y - 12) + 'px';
        };

        const updateRect = (x1, y1, x2, y2) => {
            const left = Math.min(x1, x2);
            const top = Math.min(y1, y2);
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);
            rectPreview.style.left = left + 'px';
            rectPreview.style.top = top + 'px';
            rectPreview.style.width = width + 'px';
            rectPreview.style.height = height + 'px';
        };

        const onMouseDown = (e) => {
            if (e.button !== 0) return; // 只响应左键
            if (e.target.closest && e.target.closest('#coordPanel')) return; // 点击面板内元素不开始记录
            e.preventDefault();
            state.dragging = true;
            state.startX = e.clientX;
            state.startY = e.clientY;
            state.currentX = e.clientX;
            state.currentY = e.clientY;

            rectPreview.style.display = 'block';
            startMarker.style.display = 'block';
            startMarker.style.left = (state.startX - 4) + 'px';
            startMarker.style.top = (state.startY - 4) + 'px';

            const startEl = document.getElementById('coordStart');
            if (startEl) startEl.textContent = `X:${state.startX}, Y:${state.startY}`;
            const endEl = document.getElementById('coordEnd');
            if (endEl) endEl.textContent = '拖动中...';
            const sizeEl = document.getElementById('coordSize');
            if (sizeEl) sizeEl.textContent = '--';
        };

        const onMouseMove = (e) => {
            updateLabel(e.clientX, e.clientY);
            if (!state.dragging) return;
            state.currentX = e.clientX;
            state.currentY = e.clientY;
            updateRect(state.startX, state.startY, state.currentX, state.currentY);
        };

        const onMouseUp = (e) => {
            if (!state.dragging) return;
            state.dragging = false;
            state.currentX = e.clientX;
            state.currentY = e.clientY;

            const endX = state.currentX;
            const endY = state.currentY;
            const width = Math.abs(endX - state.startX);
            const height = Math.abs(endY - state.startY);

            // 如果拖动距离很小，视为点击而非拖动
            if (width < 5 && height < 5) {
                rectPreview.style.display = 'none';
                startMarker.style.display = 'none';
                const endEl = document.getElementById('coordEnd');
                if (endEl) endEl.textContent = '点击了位置（未拖动）';
                const sizeEl = document.getElementById('coordSize');
                if (sizeEl) sizeEl.textContent = '--';
                return;
            }

            // 创建最终矩形
            const finalRect = document.createElement('div');
            finalRect.className = 'final-rect';
            const left = Math.min(state.startX, endX);
            const top = Math.min(state.startY, endY);
            finalRect.style.left = left + 'px';
            finalRect.style.top = top + 'px';
            finalRect.style.width = width + 'px';
            finalRect.style.height = height + 'px';
            overlay.appendChild(finalRect);

            rectPreview.style.display = 'none';
            startMarker.style.display = 'none';

            // 更新控制栏
            const endEl = document.getElementById('coordEnd');
            if (endEl) endEl.textContent = `X:${endX}, Y:${endY}`;
            const sizeEl = document.getElementById('coordSize');
            if (sizeEl) sizeEl.textContent = `${width}px × ${height}px`;

            // 自动复制到剪贴板
            const text = `起始点: X:${state.startX}, Y:${state.startY}\n结束点: X:${endX}, Y:${endY}\n尺寸: ${width}px × ${height}px`;
            navigator.clipboard.writeText(text).catch(() => {});
        };

        const onContextMenu = (e) => {
            e.preventDefault();
            // 退出坐标工具
            overlay.classList.remove('active');
            panel.classList.remove('active');

            // 清理元素
            const labelEl = document.getElementById('coordMouseLabel');
            const rectEl = document.getElementById('coordRectPreview');
            const markerEl = document.getElementById('coordStartMarker');
            const finalRects = overlay.querySelectorAll('.final-rect');
            if (labelEl) labelEl.remove();
            if (rectEl) rectEl.remove();
            if (markerEl) markerEl.remove();
            finalRects.forEach(el => el.remove());

            // 移除事件监听
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('contextmenu', onContextMenu);
        };

        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('contextmenu', onContextMenu);

        // 复制按钮
        const copyBtn = document.getElementById('coordCopyBtn');
        if (copyBtn) {
            copyBtn.onclick = () => {
                const startEl = document.getElementById('coordStart');
                const endEl = document.getElementById('coordEnd');
                const sizeEl = document.getElementById('coordSize');
                const text = `起始点: ${startEl ? startEl.textContent : '--'}\n结束点: ${endEl ? endEl.textContent : '--'}\n尺寸: ${sizeEl ? sizeEl.textContent : '--'}`;
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.textContent = '✅ 已复制';
                    setTimeout(() => { copyBtn.textContent = '📋 复制坐标'; }, 1500);
                }).catch(() => {
                    copyBtn.textContent = '❌ 复制失败';
                    setTimeout(() => { copyBtn.textContent = '📋 复制坐标'; }, 1500);
                });
            };
        }
    },
};

export default DevTool;
