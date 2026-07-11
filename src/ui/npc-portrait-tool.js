import { getElement } from '../utils/dom-utils.js';

// ============================================
// NPC 立绘调整工具（NpcPortraitTool）
// 参考 dev-tool.js 的 Canvas 拖动模式设计
// 功能：拖动、缩放、旋转、镜像翻转 NPC 立绘
// ============================================

// 全局存储：每个NPC的立绘参数 { [npcId]: { offsetX, offsetY, scale, rotation, flipX } }
const npcPortraitSettings = {};

// 默认立绘参数：按NPC肖像路径匹配（用于首次打开时自动应用）
const DEFAULT_PORTRAIT_PARAMS = {
    // 小鼠侍从：默认偏移，使立绘在对话框中位置合适
    'mouse_attendant': { offsetX: -42, offsetY: -113, scale: 1.0, rotation: 0, flipX: false }
};

export const NpcPortraitTool = {
    // --------------- 状态字段 ---------------
    _active: false,
    _npcId: null,
    _params: { offsetX: 0, offsetY: 0, scale: 1.0, rotation: 0, flipX: false },
    _drag: { active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 },
    _canvas: null,
    _ctx: null,
    _image: null,
    _panel: null,

    // --------------- 初始化 ---------------
    // 在 main.js 中游戏启动时调用
    // 获取DOM元素、绑定事件监听器
    init() {
        this._canvas = getElement('npcPortraitCanvas');
        this._ctx = this._canvas ? this._canvas.getContext('2d') : null;
        this._panel = getElement('npcPortraitTool');

        // 绑定 Canvas 鼠标事件（拖动）
        if (this._canvas) {
            this._canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
            this._canvas.addEventListener('mousemove', this._onMouseMove.bind(this));
            this._canvas.addEventListener('mouseup', this._onMouseUp.bind(this));
            this._canvas.addEventListener('mouseleave', this._onMouseUp.bind(this));
            this._canvas.addEventListener('wheel', this._onWheel.bind(this));
        }

        // 缩放滑动条
        const scaleInput = getElement('npcPortraitScale');
        if (scaleInput) {
            scaleInput.addEventListener('input', (e) => {
                this._params.scale = parseFloat(e.target.value);
                this._syncInputs();
                this._draw();
                this.applyToDom(this._params);
            });
        }

        // 旋转滑动条
        const rotInput = getElement('npcPortraitRotation');
        if (rotInput) {
            rotInput.addEventListener('input', (e) => {
                this._params.rotation = parseInt(e.target.value, 10);
                this._syncInputs();
                this._draw();
                this.applyToDom(this._params);
            });
        }

        // 镜像按钮
        const flipBtn = getElement('npcPortraitFlipX');
        if (flipBtn) {
            flipBtn.addEventListener('click', () => {
                this._params.flipX = !this._params.flipX;
                this._draw();
                this.applyToDom(this._params);
            });
        }

        // 重置按钮
        const resetBtn = getElement('npcPortraitReset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.reset());
        }

        // 保存按钮
        const saveBtn = getElement('npcPortraitSave');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        // 关闭按钮
        const closeBtn = getElement('npcPortraitToolClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        // 快捷键：Escape 关闭，R 重置
        document.addEventListener('keydown', (e) => {
            if (!this._active) return;
            if (e.key === 'Escape') {
                this.hide();
            } else if (e.key === 'r' || e.key === 'R') {
                this.reset();
            }
        });
    },

    // 获取指定NPC的默认立绘参数（通过肖像路径匹配）
    getDefaultParams(portraitSrc) {
        if (!portraitSrc) return null;
        for (const [key, params] of Object.entries(DEFAULT_PORTRAIT_PARAMS)) {
            if (portraitSrc.includes(key)) return { ...params };
        }
        return null;
    },

    // --------------- 打开/关闭 ---------------
    // 打开工具面板，传入NPC ID和立绘图片路径
    show(npcId, portraitSrc) {
        this._npcId = npcId;
        this._active = true;

        // 加载已保存的参数，若存在则使用；否则使用默认参数；否则使用默认值
        if (npcPortraitSettings[npcId]) {
            this._params = { ...npcPortraitSettings[npcId] };
        } else {
            const defaults = this.getDefaultParams(portraitSrc);
            this._params = defaults || { offsetX: 0, offsetY: 0, scale: 1.0, rotation: 0, flipX: false };
        }

        // 加载立绘图片
        this._image = new Image();
        this._image.onload = () => {
            this._syncInputs();
            this._draw();
        };
        this._image.src = portraitSrc;

        // 显示面板
        if (this._panel) {
            this._panel.classList.add('active');
        }

        // 应用当前参数到 DOM 立绘
        this.applyToDom(this._params);
    },

    // 关闭工具面板
    hide() {
        this._active = false;
        if (this._panel) {
            this._panel.classList.remove('active');
        }
        this._drag.active = false;
    },

    // 切换显示/隐藏（供NPC对话按钮调用）
    // 如果已打开则关闭，否则使用当前 _npcId 打开
    toggle() {
        if (this._active) {
            this.hide();
        } else if (this._npcId) {
            const npcPortrait = getElement('npcPortrait');
            const src = npcPortrait ? npcPortrait.src : '';
            if (src) {
                this.show(this._npcId, src);
            }
        }
    },

    // --------------- 参数应用 ---------------
    // 将当前参数实时应用到 NPC 立绘 DOM 元素（#npcPortrait）
    // 使用 CSS transform: translateX(...) translateY(...) scale(...) rotate(...) scaleX(...)
    applyToDom(params) {
        const npcPortrait = getElement('npcPortrait');
        if (!npcPortrait) return;
        npcPortrait.style.transform =
            `translateX(${params.offsetX}px) translateY(${params.offsetY}px) ` +
            `scale(${params.scale}) rotate(${params.rotation}deg) ` +
            `scaleX(${params.flipX ? -1 : 1})`;
    },

    // --------------- 保存 ---------------
    // 保存当前参数到全局存储，并输出到控制台
    // 输出格式：JSON.stringify({ offsetX, offsetY, scale, rotation, flipX }, null, 2)
    // 同时尝试 navigator.clipboard.writeText
    save() {
        if (!this._npcId) return;

        // 保存到全局存储
        npcPortraitSettings[this._npcId] = { ...this._params };

        const json = JSON.stringify(this._params, null, 2);
        console.log(`[NpcPortraitTool] 已保存 NPC "${this._npcId}" 的立绘参数：`);
        console.log(json);

        // 尝试复制到剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json).catch(() => {});
        }
    },

    // --------------- 重置 ---------------
    // 重置所有参数为默认值，并刷新UI和立绘
    reset() {
        this._params = { offsetX: 0, offsetY: 0, scale: 1.0, rotation: 0, flipX: false };
        this._syncInputs();
        this._draw();
        this.applyToDom(this._params);
    },

    // --------------- Canvas 绘制 ---------------
    // 绘制背景网格（20px间距灰色线）+ 中心十字线 + 立绘图片
    // 立绘位置：canvas中心 + offsetX + offsetY
    // 立绘变换：scale * (flipX?-1:1) + rotation
    _draw() {
        const ctx = this._ctx;
        const canvas = this._canvas;
        if (!ctx || !canvas) return;

        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        // 清空画布
        ctx.clearRect(0, 0, w, h);

        // 背景网格（20px间距）
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i < w; i += 20) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
            ctx.stroke();
        }
        for (let i = 0; i < h; i += 20) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(w, i);
            ctx.stroke();
        }

        // 中心十字线
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 15, cy);
        ctx.lineTo(cx + 15, cy);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(80, 200, 80, 0.5)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 15);
        ctx.lineTo(cx, cy + 15);
        ctx.stroke();

        // 绘制立绘图片
        if (this._image && this._image.complete) {
            ctx.save();
            // 平移到中心 + 偏移
            ctx.translate(cx + this._params.offsetX, cy + this._params.offsetY);
            // 旋转
            ctx.rotate(this._params.rotation * Math.PI / 180);
            // 缩放（包含水平翻转）
            const scaleX = this._params.scale * (this._params.flipX ? -1 : 1);
            ctx.scale(scaleX, this._params.scale);
            // 绘制图片，居中
            ctx.drawImage(this._image, -this._image.width / 2, -this._image.height / 2);
            ctx.restore();
        }
    },

    // --------------- 拖动事件 ---------------
    // 参考 dev-tool.js 的 _onMouseDown / _onMouseMove / _onMouseUp
    // mousedown：检测点击位置是否在立绘区域内（基于当前参数计算的矩形）
    // mousemove：如果拖动中，更新 offsetX/offsetY，调用 _draw() 和 applyToDom()
    // mouseup：停止拖动
    _onMouseDown(e) {
        // 修复Bug：阻止事件冒泡到NPC对话框，防止拖动时对话框消失
        e.stopPropagation();
        e.preventDefault();
        if (!this._canvas || !this._image) return;

        const rect = this._canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const cx = this._canvas.width / 2 + this._params.offsetX;
        const cy = this._canvas.height / 2 + this._params.offsetY;

        // 检测半径：以立绘中心为圆心，半径 = Math.max(宽, 高) * scale / 2 * 0.5
        const imgW = this._image.width * this._params.scale;
        const imgH = this._image.height * this._params.scale;
        const hitRadius = Math.max(imgW, imgH) / 2 * 0.5;

        const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
        if (dist < hitRadius) {
            this._drag.active = true;
            this._drag.startX = mx;
            this._drag.startY = my;
            this._drag.startOffsetX = this._params.offsetX;
            this._drag.startOffsetY = this._params.offsetY;
        }
    },

    _onMouseMove(e) {
        if (!this._drag.active) return;

        const rect = this._canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const dx = mx - this._drag.startX;
        const dy = my - this._drag.startY;

        // 更新偏移量（Canvas 坐标系，无需 Y 轴反转）
        this._params.offsetX = this._drag.startOffsetX + dx;
        this._params.offsetY = this._drag.startOffsetY + dy;

        this._syncInputs();
        this._draw();
        this.applyToDom(this._params);
    },

    _onMouseUp() {
        this._drag.active = false;
    },

    // --------------- 滚轮缩放 ---------------
    // 阻止默认滚动行为
    // 向上滚轮：scale += 0.05
    // 向下滚轮：scale -= 0.05
    // 限制范围 0.1 ~ 5.0
    _onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        this._params.scale = Math.max(0.1, Math.min(5.0, this._params.scale + delta * 0.05));
        this._syncInputs();
        this._draw();
        this.applyToDom(this._params);
    },

    // --------------- 同步输入控件 ---------------
    // 将 _params 的值同步到 range input 和 span 显示
    _syncInputs() {
        const scaleInput = getElement('npcPortraitScale');
        const scaleVal = getElement('npcPortraitScaleVal');
        const rotInput = getElement('npcPortraitRotation');
        const rotVal = getElement('npcPortraitRotationVal');

        if (scaleInput) scaleInput.value = this._params.scale;
        if (scaleVal) scaleVal.textContent = this._params.scale.toFixed(2);
        if (rotInput) rotInput.value = this._params.rotation;
        if (rotVal) rotVal.textContent = this._params.rotation + '°';
    }
};

// 将设置存储暴露在 NpcPortraitTool 上，供其他模块（如 npc-dialogue.js）读取
NpcPortraitTool._settings = npcPortraitSettings;
