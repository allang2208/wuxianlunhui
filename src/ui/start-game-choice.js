export const StartGameChoice = {
    _overlay: null,
    _panel: null,
    _menuContent: null,
    _startButton: null,
    _newGameButton: null,
    _backButton: null,
    _onNewGame: null,
    _open: false,

    init({ onNewGame } = {}) {
        if (this._overlay) return;
        this._overlay = document.getElementById('startGameChoice');
        this._panel = this._overlay?.querySelector('.start-game-choice-panel') || null;
        this._menuContent = document.querySelector('#menuLayer .menu-content');
        this._startButton = document.getElementById('startGameBtn');
        this._newGameButton = document.getElementById('newGameChoiceBtn');
        this._backButton = document.getElementById('closeStartGameChoiceBtn');
        this._onNewGame = onNewGame;
        if (!this._overlay || !this._panel || !this._startButton || !this._newGameButton) return;

        this._startButton.addEventListener('click', () => {
            const loadButton = document.getElementById('loadGameChoiceBtn');
            if (!loadButton || loadButton.disabled) {
                this._startNewGame({ fromMainMenu: true });
                return;
            }
            this.open();
        });
        this._backButton?.addEventListener('click', () => this.close());
        this._overlay.addEventListener('click', (event) => {
            if (event.target === this._overlay) this.close();
        });
        this._overlay.addEventListener('keydown', (event) => this._onKeyDown(event));
        this._newGameButton.addEventListener('click', () => this._startNewGame());
    },

    open() {
        if (!this._overlay || this._open) return;
        this._open = true;
        if (this._menuContent) this._menuContent.inert = true;
        this._overlay.hidden = false;
        this._overlay.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            this._overlay?.classList.add('active');
            this._newGameButton?.focus({ preventScroll: true });
        });
    },

    close({ restoreFocus = true } = {}) {
        if (!this._overlay || !this._open) return;
        this._open = false;
        this._overlay.classList.remove('active');
        this._overlay.hidden = true;
        this._overlay.setAttribute('aria-hidden', 'true');
        if (this._menuContent) this._menuContent.inert = false;
        if (restoreFocus) this._startButton?.focus({ preventScroll: true });
    },

    _startNewGame({ fromMainMenu = false } = {}) {
        if ((!this._open && !fromMainMenu) || this._newGameButton?.disabled) return;
        this._newGameButton.disabled = true;
        this._newGameButton.setAttribute('aria-busy', 'true');
        this._newGameButton.textContent = '正在建立新轮回…';
        if (this._open) this.close({ restoreFocus: false });
        if (fromMainMenu) {
            this._startButton.disabled = true;
            this._startButton.setAttribute('aria-busy', 'true');
            this._startButton.textContent = '正在建立新轮回…';
        }
        Promise.resolve(this._onNewGame?.()).catch((error) => {
            console.error('新游戏启动失败:', error);
            this._newGameButton.disabled = false;
            this._newGameButton.removeAttribute('aria-busy');
            this._newGameButton.textContent = '新游戏';
            if (fromMainMenu) {
                this._startButton.disabled = false;
                this._startButton.removeAttribute('aria-busy');
                this._startButton.textContent = '开始游戏';
            }
        });
    },

    _onKeyDown(event) {
        if (!this._open) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...this._panel.querySelectorAll('button:not(:disabled)')]
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
};
