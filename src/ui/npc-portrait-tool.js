import { getElement } from '../utils/dom-utils.js';

// ============================================
// NPC 立绘调整工具（NpcPortraitTool，2026-07-30 重构）
// 交互：点击「调整立绘」后直接拖对话左侧立绘（X/Y 自由拖动）；
// 调整面板只负责缩放/旋转（镜像/重置/保存保留）；
// 保存直接写 data/npc-portrait-params.json（Electron save-json IPC /
// Vite __save-json 双写 public+data，浏览器下载兜底）——不再手工抄回代码
// ============================================

// 参数模型：{ x, y, scale, rotation, flipX }——x/y 为相对默认锚点的偏移（屏幕 px）
// 每个 NPC 的立绘参数 { [npcId]: { x, y, scale, rotation, flipX } }
const npcPortraitSettings = {};
const PARAMS_REL = 'data/npc-portrait-params.json'; // save-json 管道要求 data/ 前缀（中间件校验 rel.startsWith('data/')）
const PARAMS_URL = '/data/npc-portrait-params.json';

// 默认立绘参数：按NPC肖像路径匹配（首次打开时自动应用；x/y 为 2026-07-30 前
// offsetX/bottom 旧模型的迁移值：x=offsetX，y=0，锚 bottom 保留为各 NPC 默认值）
const DEFAULT_PORTRAIT_PARAMS = {
    // 小鼠侍从：锚 bottom 200px
    'mouse_attendant': { x: -1009, y: 0, scale: 2.04, rotation: 0, flipX: false, anchorBottom: 200 },
    // 小鼠大王：锚 bottom 220px
    'npc_portrait': { x: -1010, y: 0, scale: 1.56, rotation: 0, flipX: false, anchorBottom: 220 }
};

export const NpcPortraitTool = {
    // --------------- 状态字段 ---------------
    _active: false,
    _npcId: null,
    _params: { x: 0, y: 0, scale: 1.0, rotation: 0, flipX: false },
    _anchorBottom: 220, // 当前 NPC 锚定 bottom（默认值，不随拖动改变）
    _drag: { active: false, startClientX: 0, startClientY: 0, startX: 0, startY: 0 },
    _panel: null,
    _boundDragMove: null,
    _boundDragUp: null,
    _loaded: false,

    // --------------- 初始化 ---------------
    // 在 main.js 中游戏启动时调用
    init() {
        this._panel = getElement('npcPortraitTool');

        // 加载持久化参数（data/npc-portrait-params.json；失败则以硬编码默认兜底）
        this._loadParams();

        // 立绘自由拖动（mousedown 在立绘上，move/up 在 document——可拖出立绘框）
        const portrait = getElement('npcPortrait');
        if (portrait) {
            this._boundDragMove = this._onDragMove.bind(this);
            this._boundDragUp = this._onDragUp.bind(this);
            portrait.addEventListener('mousedown', (e) => this._onPortraitMouseDown(e));
            portrait.style.pointerEvents = 'auto';
        }

        // 缩放滑动条
        const scaleInput = getElement('npcPortraitScale');
        if (scaleInput) {
            scaleInput.addEventListener('input', (e) => {
                this._params.scale = parseFloat(e.target.value);
                this._syncInputs();
                this.applyToDom(this._params);
            });
        }

        // 旋转滑动条
        const rotInput = getElement('npcPortraitRotation');
        if (rotInput) {
            rotInput.addEventListener('input', (e) => {
                this._params.rotation = parseInt(e.target.value, 10);
                this._syncInputs();
                this.applyToDom(this._params);
            });
        }

        // 镜像按钮
        const flipBtn = getElement('npcPortraitFlipX');
        if (flipBtn) {
            flipBtn.addEventListener('click', () => {
                this._params.flipX = !this._params.flipX;
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
                // 立绘工具是对话的子界面：ESC 只关工具，不传给 Input 的全局 ESC——
                // 否则一次 ESC 会同时关掉工具和整个对话（两级退出：再按一次才退出对话）。
                e.stopPropagation();
            } else if (e.key === 'r' || e.key === 'R') {
                this.reset();
            }
        });
    },

    /** 读取 data/npc-portrait-params.json（含旧模型 offsetX→x 迁移） */
    async _loadParams() {
        try {
            const r = await fetch(PARAMS_URL + '?t=' + Date.now());
            if (!r.ok) throw new Error(String(r.status));
            const data = await r.json();
            for (const [npcId, p] of Object.entries(data || {})) {
                npcPortraitSettings[npcId] = this._migrateParams(p);
            }
        } catch (_e) {
            // 文件不存在/读取失败：保持空表，全部走硬编码默认
        }
        this._loaded = true;
    },

    /** 旧参数模型迁移（offsetX/bottom → x/y；anchorBottom 不入库，仅打开时按 NPC 默认恢复） */
    _migrateParams(p) {
        if (!p || typeof p !== 'object') return { x: 0, y: 0, scale: 1.0, rotation: 0, flipX: false };
        return {
            x: (typeof p.x === 'number') ? p.x : (p.offsetX || 0),
            y: (typeof p.y === 'number') ? p.y : 0,
            scale: p.scale ?? 1.0,
            rotation: p.rotation ?? 0,
            flipX: !!p.flipX,
        };
    },

    /** 持久化到 data/npc-portrait-params.json（Electron IPC → Vite 中间件 → 下载兜底） */
    async _persistParams() {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveJson) {
            try {
                await window.electronAPI.saveJson(PARAMS_REL, npcPortraitSettings);
                return true;
            } catch (_e) { /* 落到下一通道 */ }
        }
        try {
            const r = await fetch('/__save-json', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ rel: PARAMS_REL, data: npcPortraitSettings }),
            });
            if (r.ok) return true;
        } catch { /* 落到下载兜底 */ }
        const blob = new Blob([JSON.stringify(npcPortraitSettings, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = PARAMS_REL;
        a.click();
        URL.revokeObjectURL(a.href);
        console.warn('[NpcPortraitTool] 保存管道不可用，已下载 JSON，请手动放回 data/ 与 public/data/');
        return false;
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

        // 锚定 bottom：已保存参数不含锚（按 NPC 默认恢复）
        const defaults = this.getDefaultParams(portraitSrc);
        this._anchorBottom = defaults?.anchorBottom ?? 220;

        // 参数：已保存 > 硬编码默认 > 零值
        if (npcPortraitSettings[npcId]) {
            this._params = { ...npcPortraitSettings[npcId] };
        } else if (defaults) {
            this._params = { x: defaults.x, y: defaults.y, scale: defaults.scale, rotation: defaults.rotation, flipX: defaults.flipX };
        } else {
            this._params = { x: 0, y: 0, scale: 1.0, rotation: 0, flipX: false };
        }

        this._syncInputs();

        // 显示面板
        if (this._panel) {
            this._panel.classList.add('active');
        }
        // 立绘进入可拖状态（拖动期间禁用 transform 过渡，否则 0.3s transition 拖拽滞后）
        const portrait = getElement('npcPortrait');
        if (portrait) {
            portrait.style.cursor = 'grab';
            portrait.style.transition = 'none';
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
        const portrait = getElement('npcPortrait');
        if (portrait) {
            portrait.style.cursor = '';
            portrait.style.transition = '';
        }
        this._drag.active = false;
        this._removeDragListeners();
    },

    // 切换显示/隐藏（供NPC对话按钮调用）
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
    // 变换：水平居中 + x/y 偏移 + 缩放 + 旋转 + 镜像；bottom 为 NPC 默认锚值
    formatTransform(params) {
        return `translateX(-50%) translate(${params.x || 0}px, ${params.y || 0}px) ` +
            `scale(${params.scale}) rotate(${params.rotation}deg) ` +
            `scaleX(${params.flipX ? -1 : 1})`;
    },

    applyToDom(params) {
        const npcPortrait = getElement('npcPortrait');
        if (!npcPortrait) return;
        npcPortrait.style.transform = this.formatTransform(params);
        npcPortrait.style.bottom = this._anchorBottom + 'px';
    },

    // --------------- 保存 ---------------
    // 保存当前参数并直接写文件（用户可自行反复调整，无需再手工抄回代码）
    save() {
        if (!this._npcId) return;
        npcPortraitSettings[this._npcId] = { ...this._params };
        const json = JSON.stringify(this._params, null, 2);
        console.log(`[NpcPortraitTool] 已保存 NPC(${this._npcId}) 立绘参数:`, json);
        this._persistParams();
        // 按钮反馈
        const saveBtn = getElement('npcPortraitSave');
        if (saveBtn) {
            const old = saveBtn.textContent;
            saveBtn.textContent = '✓ 已写入文件';
            setTimeout(() => { saveBtn.textContent = old; }, 1200);
        }
    },

    // --------------- 重置 ---------------
    // 重置为该 NPC 默认参数（同时清除已保存条目），并刷新立绘
    reset() {
        const npcPortrait = getElement('npcPortrait');
        const defaults = this.getDefaultParams(npcPortrait ? npcPortrait.src : '');
        if (defaults) {
            this._params = { x: defaults.x, y: defaults.y, scale: defaults.scale, rotation: defaults.rotation, flipX: defaults.flipX };
            this._anchorBottom = defaults.anchorBottom ?? 220;
        } else {
            this._params = { x: 0, y: 0, scale: 1.0, rotation: 0, flipX: false };
            this._anchorBottom = 220;
        }
        if (this._npcId && npcPortraitSettings[this._npcId]) {
            delete npcPortraitSettings[this._npcId];
            this._persistParams();
        }
        this._syncInputs();
        this.applyToDom(this._params);
    },

    // --------------- 立绘自由拖动 ---------------
    // mousedown 在立绘上（仅工具打开时生效；stopPropagation 防止对话框/画布抢事件）
    _onPortraitMouseDown(e) {
        if (!this._active) return;
        e.stopPropagation();
        e.preventDefault();
        this._drag.active = true;
        this._drag.startClientX = e.clientX;
        this._drag.startClientY = e.clientY;
        this._drag.startX = this._params.x || 0;
        this._drag.startY = this._params.y || 0;
        const portrait = getElement('npcPortrait');
        if (portrait) portrait.style.cursor = 'grabbing';
        document.addEventListener('mousemove', this._boundDragMove);
        document.addEventListener('mouseup', this._boundDragUp);
    },

    _onDragMove(e) {
        if (!this._drag.active) return;
        this._params.x = this._drag.startX + (e.clientX - this._drag.startClientX);
        this._params.y = this._drag.startY + (e.clientY - this._drag.startClientY);
        this.applyToDom(this._params);
    },

    _onDragUp() {
        this._drag.active = false;
        const portrait = getElement('npcPortrait');
        if (portrait && this._active) portrait.style.cursor = 'grab';
        this._removeDragListeners();
    },

    _removeDragListeners() {
        document.removeEventListener('mousemove', this._boundDragMove);
        document.removeEventListener('mouseup', this._boundDragUp);
    },

    // --------------- 同步输入控件 ---------------
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
