        class FloatingTextEffect {
            constructor(x, y, text, color, fontSize = 14) {
                this.x = x; this.y = y; this.text = text;
                this.color = color || '#d4c5a9';
                this.fontSize = fontSize;
                this.life = 1200; this.maxLife = 1200; this.active = true;
                this.vy = -0.8;
                this._createPhaserText();
            }
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
                const text = phaserScene.add.text(this.x, this.y, this.text, {
                    fontFamily: 'SimHei, "Microsoft YaHei", "黑体", sans-serif',
                    fontSize: `${this.fontSize}px`,
                    color: this.color
                });
                text.setOrigin(0.5, 0.5);
                text.setDepth(this.y + 1000);
                this._phaserText = text;
                this._syncPhaserText();
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
                    this._phaserText.destroy();
                    this._phaserText = null;
                }
            }
        }


export { FloatingTextEffect };
