/**
 * ============================================================
 * TypewriterText — 通用逐字显示文本组件
 * ============================================================
 *
 * 提供“文字逐字显示 + 点击立即显示全部”的通用能力。
 * 不依赖具体 DOM 结构，任何对话框只需传入文本元素即可使用。
 *
 * 用法：
 *   const tw = new TypewriterText(textElement, {
 *       speed: 40,                       // 每字符间隔 ms
 *       clickTarget: overlayElement,     // 点击触发 skip 的元素（默认 textElement）
 *       highlight: '关键词',              // 需要高亮（red-bold-shake）的子串
 *       onComplete: () => {},            // 全部显示完成回调
 *   });
 *   tw.setText('要显示的文本');
 */

export class TypewriterText {
    /**
     * @param {HTMLElement|null} element - 显示文本的目标元素
     * @param {Object} [options]
     */
    constructor(element, options = {}) {
        this._element = element;
        this._speed = options.speed ?? 40;
        this._clickTarget = options.clickTarget || element;
        this._highlight = options.highlight || null;
        this._onComplete = options.onComplete || null;

        this._text = '';
        this._charIndex = 0;
        this._lastCharTime = 0;
        this._active = false;
        this._rafId = null;

        this._clickHandler = (e) => this._onClick(e);
        if (this._clickTarget) {
            this._clickTarget.addEventListener('mousedown', this._clickHandler);
            this._clickTarget.addEventListener('click', this._clickHandler);
        }
    }

    /**
     * 设置新文本并重新开始逐字显示
     * @param {string} text
     */
    setText(text) {
        this._text = String(text ?? '');
        this._charIndex = 0;
        this._lastCharTime = Date.now();
        this._active = true;
        this._render();
        this._startLoop();
    }

    /**
     * 外部驱动更新（也可依赖内部 requestAnimationFrame）
     */
    update() {
        if (!this._active || this._charIndex >= this._text.length) return;

        const now = Date.now();
        if (now - this._lastCharTime >= this._speed) {
            this._charIndex++;
            this._lastCharTime = now;
            this._render();

            if (this._charIndex >= this._text.length) {
                this._finish();
            }
        }
    }

    /**
     * 立即显示全部文字
     */
    skip() {
        if (this._charIndex >= this._text.length) return;
        this._charIndex = this._text.length;
        this._render();
        this._finish();
    }

    /**
     * 是否已完整显示
     * @returns {boolean}
     */
    isComplete() {
        return this._charIndex >= this._text.length;
    }

    /**
     * 清理事件与动画
     */
    destroy() {
        this._stopLoop();
        if (this._clickTarget) {
            this._clickTarget.removeEventListener('mousedown', this._clickHandler);
            this._clickTarget.removeEventListener('click', this._clickHandler);
        }
        this._element = null;
        this._clickTarget = null;
        this._active = false;
    }

    // ===== 内部 =====

    _onClick(e) {
        if (!this.isComplete()) {
            e.preventDefault();
            e.stopPropagation();
            this.skip();
        }
    }

    _startLoop() {
        if (this._rafId) return;
        const loop = () => {
            this.update();
            if (this._active) {
                this._rafId = requestAnimationFrame(loop);
            } else {
                this._rafId = null;
            }
        };
        this._rafId = requestAnimationFrame(loop);
    }

    _stopLoop() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    _finish() {
        this._active = false;
        this._stopLoop();
        if (this._onComplete) {
            this._onComplete();
        }
    }

    _render() {
        if (!this._element) return;
        const raw = this._text.substring(0, this._charIndex);

        if (this._highlight && raw.includes(this._highlight)) {
            const idx = raw.indexOf(this._highlight);
            const before = raw.substring(0, idx);
            const after = raw.substring(idx + this._highlight.length);
            this._element.innerHTML = before +
                '<span class="red-bold-shake">' + this._highlight + '</span>' +
                after;
        } else {
            this._element.textContent = raw;
        }
    }
}
