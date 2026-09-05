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
        text: '别被这个称号吓到，我原本也只是一只普通仓鼠。经历许多次轮回与修炼，才终于化形，成为如今的小鼠大王。',
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
        text: '等你踏进主神空间，就来找我。我会给你一枚 F 级钥匙——也就是时空锚点。先从一次能够活着回来的探索开始。',
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
    _skipChoice: null,
    _skipPreviousFocus: null,

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

        const skipActions = document.createElement('div');
        skipActions.className = 'opening-dialogue-skip-actions';

        const skipStoryButton = document.createElement('button');
        skipStoryButton.type = 'button';
        skipStoryButton.className = 'opening-dialogue-skip';
        skipStoryButton.dataset.openingDialogueAction = 'skip-story';
        skipStoryButton.textContent = '跳过剧情';
        skipStoryButton.setAttribute('aria-label', '跳过当前剧情对话，保留新手教程');

        const skipTutorialsButton = document.createElement('button');
        skipTutorialsButton.type = 'button';
        skipTutorialsButton.className = 'opening-dialogue-skip opening-dialogue-skip--tutorials';
        skipTutorialsButton.dataset.openingDialogueAction = 'skip-tutorials';
        skipTutorialsButton.textContent = '跳过所有教程';
        skipTutorialsButton.setAttribute('aria-label', '跳过全部新手教程并选择自由开局方式');
        skipActions.append(skipStoryButton, skipTutorialsButton);

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
        overlay.append(backdrop, portrait, skipActions, panel);
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
        if (action === 'skip-story') {
            event.preventDefault();
            event.stopPropagation();
            this.finish({ skipped: true });
            return;
        }
        if (action === 'skip-tutorials') {
            event.preventDefault();
            event.stopPropagation();
            this._openSkipChoice();
            return;
        }
        if (action === 'skip-free-play' || action === 'skip-direct-founding') {
            event.preventDefault();
            event.stopPropagation();
            this.finish({
                skipped: true,
                tutorialSkipMode: action === 'skip-direct-founding' ? 'direct_founding' : 'starter_funds',
            });
            return;
        }
        if (action === 'skip-cancel') {
            event.preventDefault();
            event.stopPropagation();
            this._closeSkipChoice();
            return;
        }
        if (this._skipChoice) return;
        this._advance();
    },

    _openSkipChoice() {
        if (!this._overlay || this._skipChoice || this._finished) return;
        const choice = document.createElement('section');
        choice.className = 'opening-dialogue-skip-choice';
        choice.setAttribute('role', 'alertdialog');
        choice.setAttribute('aria-modal', 'true');
        choice.setAttribute('aria-labelledby', 'openingDialogueSkipTitle');
        choice.setAttribute('aria-describedby', 'openingDialogueSkipDescription');
        choice.innerHTML = `
            <span class="opening-dialogue-skip-choice__eyebrow">TUTORIAL OVERRIDE // 新局分流</span>
            <h2 id="openingDialogueSkipTitle">跳过所有教程后，选择你的开局</h2>
            <p id="openingDialogueSkipDescription">两种路线都会发放 200 金币并关闭后续新手任务提示，也不会伪造地牢通关、经验或战利品。</p>
            <div class="opening-dialogue-skip-choice__options">
                <button type="button" data-opening-dialogue-action="skip-free-play">
                    <strong>领取 200 金币，自由探索</strong>
                    <span>足够购买 1 枚 F 级钥匙；大地图仍按正常探索进度解锁。</span>
                </button>
                <button type="button" data-opening-dialogue-action="skip-direct-founding">
                    <strong>领取 200 金币，直接开启首城选址</strong>
                    <span>进入主神空间后与小鼠大王交谈，直接打开位面航图；不发地牢经验与战利品。</span>
                </button>
            </div>
            <button type="button" class="opening-dialogue-skip-choice__cancel" data-opening-dialogue-action="skip-cancel">返回剧情</button>`;
        this._skipPreviousFocus = document.activeElement;
        this._skipChoice = choice;
        this._overlay.classList.add('is-skip-choice-open');
        this._overlay.appendChild(choice);
        choice.querySelector('button')?.focus({ preventScroll: true });
    },

    _closeSkipChoice() {
        if (!this._skipChoice) return;
        const previousFocus = this._skipPreviousFocus;
        this._skipChoice.remove();
        this._skipChoice = null;
        this._skipPreviousFocus = null;
        this._overlay?.classList.remove('is-skip-choice-open');
        previousFocus?.focus?.({ preventScroll: true });
    },

    _onKeyDown(event) {
        if (!this._overlay || this._finished) return;
        if (this._skipChoice) {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this._closeSkipChoice();
                return;
            }
            if (event.key === 'Tab') {
                const focusable = [...this._skipChoice.querySelectorAll('button:not(:disabled)')];
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
            return;
        }
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

    finish({ skipped = false, tutorialSkipMode = null } = {}) {
        if (this._finished) return;
        this._finished = true;
        this._typewriter?.destroy();
        this._typewriter = null;
        document.body.classList.remove('opening-dialogue-active');
        if (this._gameContainer) this._gameContainer.inert = this._gameContainerWasInert;

        const onComplete = this._onComplete;
        this._onComplete = null;
        Promise.resolve(onComplete?.({ skipped, tutorialSkipMode })).catch((error) => {
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
            this._skipChoice = null;
            this._skipPreviousFocus = null;
        }, 360);
    },
};
