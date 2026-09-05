import { TypewriterText } from './typewriter-text.js';

const OPENING_DIALOGUE_LINES = [
    {
        speaker: '小鼠大王',
        text: '你醒啦。先别急着起身，灵魂刚落进新的躯壳，总会有一点眩晕。',
    },
    {
        speaker: '小鼠大王',
        text: '我是小鼠大王。这里是主神空间——漂浮在无数世界之外，也是每一次轮回开始和结束的地方。',
    },
    {
        speaker: '小鼠大王',
        text: '你的旧世界已经把你判作死者，但轮回印记选择了你。换句话说，你就是被召来的天选之子。',
    },
    {
        speaker: '小鼠大王',
        text: '从现在起，你会被送往一个个濒临崩坏的位面。探索、战斗、收集资源，把还能拯救的东西带回来。',
    },
    {
        speaker: '小鼠大王',
        text: '先记住最基础的行动：WASD 移动，鼠标瞄准，左键攻击，右键发动武器特殊攻击；空格闪避，Shift 冲刺。',
    },
    {
        speaker: '小鼠大王',
        text: '主神空间是你的安全落脚点。靠近我或其他人物后，用鼠标左键点击我们，就能交谈、接取任务或处理物资。',
    },
    {
        speaker: '小鼠大王',
        text: '先去熟悉这具身体和你的装备。准备好后再来找我——你的第一次轮回，会从这里真正开始。',
    },
];

const PORTRAIT_SRC = './assets/ui/npc_portrait.png';
const BACKGROUND_SRC = './assets/scenes/opening/08-main-hub-arrival.png';

export const OpeningDialogue = {
    _overlay: null,
    _panel: null,
    _speaker: null,
    _text: null,
    _counter: null,
    _advanceLabel: null,
    _advanceButton: null,
    _typewriter: null,
    _typewriterInputSink: null,
    _gameContainer: null,
    _gameContainerWasInert: false,
    _lineIndex: 0,
    _finished: false,
    _onComplete: null,

    play({ onComplete = null } = {}) {
        if (this._overlay) return false;
        this._lineIndex = 0;
        this._finished = false;
        this._onComplete = onComplete;
        this._build();
        this._showLine(0);
        document.body.classList.add('opening-dialogue-active');
        requestAnimationFrame(() => {
            this._overlay?.classList.add('is-visible');
            this._advanceButton?.focus({ preventScroll: true });
        });
        return true;
    },

    _build() {
        const overlay = document.createElement('section');
        overlay.className = 'opening-dialogue';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'openingDialogueSpeaker');
        overlay.setAttribute('aria-describedby', 'openingDialogueText');
        overlay.style.setProperty('--opening-dialogue-background', `url("${BACKGROUND_SRC}")`);

        const backdrop = document.createElement('div');
        backdrop.className = 'opening-dialogue-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');

        const portrait = document.createElement('img');
        portrait.className = 'opening-dialogue-portrait';
        portrait.src = PORTRAIT_SRC;
        portrait.alt = '小鼠大王';
        portrait.draggable = false;
        portrait.addEventListener('error', () => overlay.classList.add('has-missing-portrait'), { once: true });

        const skipButton = document.createElement('button');
        skipButton.type = 'button';
        skipButton.className = 'opening-dialogue-skip';
        skipButton.dataset.openingDialogueAction = 'skip';
        skipButton.textContent = '跳过引导';
        skipButton.setAttribute('aria-label', '跳过小鼠大王的新手引导');

        const panel = document.createElement('div');
        panel.className = 'opening-dialogue-panel';

        const header = document.createElement('div');
        header.className = 'opening-dialogue-header';

        const identity = document.createElement('div');
        identity.className = 'opening-dialogue-identity';
        const eyebrow = document.createElement('span');
        eyebrow.className = 'opening-dialogue-eyebrow';
        eyebrow.textContent = '主神空间 // 初次接触';
        const speaker = document.createElement('h2');
        speaker.id = 'openingDialogueSpeaker';
        speaker.className = 'opening-dialogue-speaker';
        identity.append(eyebrow, speaker);

        const counter = document.createElement('span');
        counter.className = 'opening-dialogue-counter';
        counter.setAttribute('aria-label', '对话进度');
        header.append(identity, counter);

        const text = document.createElement('p');
        text.id = 'openingDialogueText';
        text.className = 'opening-dialogue-text';
        text.setAttribute('aria-live', 'polite');

        const footer = document.createElement('div');
        footer.className = 'opening-dialogue-footer';
        const hint = document.createElement('span');
        hint.className = 'opening-dialogue-hint';
        hint.textContent = '单击画面显示全文 / 继续';
        const advanceButton = document.createElement('button');
        advanceButton.type = 'button';
        advanceButton.className = 'opening-dialogue-advance';
        advanceButton.dataset.openingDialogueAction = 'advance';
        const advanceLabel = document.createElement('span');
        const advanceArrow = document.createElement('i');
        advanceArrow.setAttribute('aria-hidden', 'true');
        advanceButton.append(advanceLabel, advanceArrow);
        footer.append(hint, advanceButton);

        panel.append(header, text, footer);
        overlay.append(backdrop, portrait, skipButton, panel);
        overlay.addEventListener('click', (event) => this._onClick(event));
        overlay.addEventListener('keydown', (event) => this._onKeyDown(event));
        document.body.appendChild(overlay);

        this._overlay = overlay;
        this._panel = panel;
        this._speaker = speaker;
        this._text = text;
        this._counter = counter;
        this._advanceLabel = advanceLabel;
        this._advanceButton = advanceButton;
        this._gameContainer = document.getElementById('gameContainer');
        this._gameContainerWasInert = this._gameContainer?.inert ?? false;
        if (this._gameContainer) this._gameContainer.inert = true;

        // TypewriterText 默认监听鼠标；这里由整层的单一点击入口决定“补全文/下一句”，
        // 避免一次点击同时触发 mousedown 补全文和 click 跳到下一句。
        this._typewriterInputSink = document.createElement('span');
        this._typewriter = new TypewriterText(text, {
            speed: 30,
            clickTarget: this._typewriterInputSink,
            onComplete: () => this._overlay?.classList.add('is-text-complete'),
        });
    },

    _showLine(index) {
        if (!this._overlay || this._finished) return;
        if (index >= OPENING_DIALOGUE_LINES.length) {
            this.finish();
            return;
        }
        this._lineIndex = index;
        const line = OPENING_DIALOGUE_LINES[index];
        this._overlay.classList.remove('is-text-complete');
        this._panel?.classList.remove('is-line-visible');
        if (this._speaker) this._speaker.textContent = line.speaker;
        if (this._counter) this._counter.textContent = `${index + 1} / ${OPENING_DIALOGUE_LINES.length}`;
        if (this._advanceLabel) {
            this._advanceLabel.textContent = index === OPENING_DIALOGUE_LINES.length - 1
                ? '踏入主神空间'
                : '继续';
        }
        this._typewriter?.setText(line.text);
        requestAnimationFrame(() => this._panel?.classList.add('is-line-visible'));
    },

    _advance() {
        if (!this._overlay || this._finished) return;
        if (!this._typewriter?.isComplete()) {
            this._typewriter?.skip();
            return;
        }
        this._showLine(this._lineIndex + 1);
    },

    _onClick(event) {
        const action = event.target.closest('[data-opening-dialogue-action]')?.dataset.openingDialogueAction;
        if (action === 'skip') {
            event.preventDefault();
            event.stopPropagation();
            this.finish({ skipped: true });
            return;
        }
        this._advance();
    },

    _onKeyDown(event) {
        if (!this._overlay || this._finished) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.finish({ skipped: true });
            return;
        }
        if (event.key === 'Tab') {
            const focusable = [...this._overlay.querySelectorAll('button:not(:disabled)')];
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
            return;
        }
        if ((event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight')
            && !event.target.closest('button')) {
            event.preventDefault();
            this._advance();
        }
    },

    finish({ skipped = false } = {}) {
        if (this._finished) return;
        this._finished = true;
        this._typewriter?.destroy();
        this._typewriter = null;
        document.body.classList.remove('opening-dialogue-active');
        if (this._gameContainer) this._gameContainer.inert = this._gameContainerWasInert;

        const onComplete = this._onComplete;
        this._onComplete = null;
        Promise.resolve(onComplete?.({ skipped })).catch((error) => {
            console.error('[OpeningDialogue] 新手序章对话结束后的游戏启动失败:', error);
        });

        const overlay = this._overlay;
        overlay?.classList.add('is-exiting');
        window.setTimeout(() => {
            overlay?.remove();
            if (this._overlay !== overlay) return;
            this._overlay = null;
            this._panel = null;
            this._speaker = null;
            this._text = null;
            this._counter = null;
            this._advanceLabel = null;
            this._advanceButton = null;
            this._typewriterInputSink = null;
            this._gameContainer = null;
        }, 360);
    },
};
