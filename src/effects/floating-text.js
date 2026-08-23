        const PHASER_TEXT_POOL = [];
        const PHASER_TEXT_POOL_LIMIT = 64;

        class FloatingTextEffect {
            constructor(x, y, text, color, fontSize = 14) {
                this.x = x; this.y = y; this.text = text;
                this.color = color || '#d4c5a9';
                this.fontSize = fontSize;
                this.life = 1200; this.maxLife = 1200; this.active = true;
                this.vy = -0.8;
                this._createPhaserText();
            }
            getFogVisuals() { return this._phaserText; }
            update(dt = 16.67) {
                this.life -= dt;
                this.y += this.vy * (dt / 1000);
                this._syncPhaserText();
                if (this.life <= 0) {
                    this.active = false;
                    this._destroyPhaserText();
                }
            }
            
            _createPhaserText() {
                const phaserScene = window.__phaserScene;
                if (!phaserScene) return;
                let text = null;
                while (PHASER_TEXT_POOL.length && !text) {
                    const candidate = PHASER_TEXT_POOL.pop();
                    if (candidate?.active && candidate.scene === phaserScene) text = candidate;
                    else candidate?.destroy?.();
                }
                if (!text) {
                    text = phaserScene.add.text(this.x, this.y, this.text, {
                        fontFamily: 'SimHei, "Microsoft YaHei", "黑体", sans-serif',
                        fontSize: `${this.fontSize}px`,
                        color: this.color,
                        // 黑描边（宝箱倒计时同款）：彩色浮字在亮地板上也可读，字号不变
                        stroke: '#000000', strokeThickness: 3,
                    });
                    text.setOrigin(0.5, 0.5);
                } else {
                    text.setText(this.text);
                    text.setFontSize(this.fontSize);
                    text.setColor(this.color);
                    text.setAlpha(1);
                    text.setVisible(true);
                }
                text.setDepth(this.y + 1000);
                this._phaserText = text;
                this._syncPhaserText();
            }

            setText(text) {
                this.text = String(text);
                this._phaserText?.setText?.(this.text);
            }

            _syncPhaserText() {
                if (!this._phaserText || !this._phaserText.active) return;
                const alpha = Math.max(0, this.life / this.maxLife);
                this._phaserText.setPosition(this.x, this.y);
                this._phaserText.setAlpha(alpha);
                this._phaserText.setDepth(this.y + 1000);
                this._phaserText.setVisible(true);
            }

            _destroyPhaserText() {
                if (this._phaserText) {
                    const text = this._phaserText;
                    text.setVisible(false);
                    text.setAlpha(0);
                    if (text.active && PHASER_TEXT_POOL.length < PHASER_TEXT_POOL_LIMIT) {
                        PHASER_TEXT_POOL.push(text);
                    } else {
                        text.destroy();
                    }
                    this._phaserText = null;
                }
            }
        }


export { FloatingTextEffect };
