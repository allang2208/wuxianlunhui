import motion from '../../data/world-map-command-feedback.json';

export const COMMAND_BADGE_URLS = {
    move: new URL('../../assets/ui/world-map/command-badges/move.png', import.meta.url).href,
    attack: new URL('../../assets/ui/world-map/command-badges/attack.png', import.meta.url).href,
    enter: new URL('../../assets/ui/world-map/command-badges/enter.png', import.meta.url).href,
    blocked: new URL('../../assets/ui/world-map/command-badges/blocked.png', import.meta.url).href,
};
const urls = COMMAND_BADGE_URLS;
export const commandKind = (preview) => !preview?.ok ? 'blocked'
    : preview.order?.action === 'enter' ? 'enter'
    : ['pursue', 'destroy', 'relieve', 'reinforce'].includes(preview.order?.action) ? 'attack' : 'move';
export const commandBadge = (kind, className = '') => `<img class="wm-command-badge ${className}" src="${urls[kind] || urls.move}" alt="" aria-hidden="true" draggable="false">`;

// DOM compositor effects only. Never animate the native pointer/hotspot or run a map RAF loop.
export class WorldMapCommandFeedback {
    constructor(stage) {
        this.stage = stage;
        this.pointer = this._create('wm-pointer-badge');
        this.confirm = this._create('wm-command-confirm');
        this.pointer.style.setProperty('--wm-badge-size', `${motion.badgeSize}px`);
    }

    _create(className) {
        const node = document.createElement('div');
        node.className = className;
        node.setAttribute('aria-hidden', 'true');
        node.hidden = true;
        const halo = document.createElement('span');
        halo.className = 'wm-command-halo';
        const img = document.createElement('img');
        img.alt = ''; img.draggable = false;
        // The native arrow and text hint remain usable if an art file fails.
        img.onerror = () => { img.hidden = true; };
        img.onload = () => { img.hidden = false; };
        node.append(halo, img);
        this.stage.append(node);
        return node;
    }

    _setKind(node, kind) {
        if (node.dataset.kind === kind) return;
        node.dataset.kind = kind;
        node.querySelector('img').src = urls[kind];
        node.style.setProperty('--wm-hover-period', `${motion.hoverPeriodMs[kind] || 1400}ms`);
    }

    move(point) {
        this.point = point;
        if (!point) { this.pointer.hidden = true; return; }
        // Clamp the badge only. The native cursor continues to mark the exact mouse coordinate.
        const x = Math.min(Math.max(0, this.stage.clientWidth - motion.badgeSize), point.x + motion.pointerOffset[0]);
        const y = Math.min(Math.max(0, this.stage.clientHeight - motion.badgeSize), point.y + motion.pointerOffset[1]);
        this.pointer.style.transform = `translate(${x}px, ${y}px)`;
    }

    show(kind, append = false) {
        if (!this.point) return;
        this._setKind(this.pointer, kind);
        this.pointer.dataset.append = String(append);
        this.pointer.hidden = false;
    }

    hide() { this.pointer.hidden = true; }

    acknowledge(point, kind, append = false) {
        if (!point) return;
        clearTimeout(this.confirmTimer);
        this.confirm.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
        this._setKind(this.confirm, kind);
        this.confirm.dataset.append = String(append);
        this.confirm.style.left = `${point.x}px`;
        this.confirm.style.top = `${point.y}px`;
        this.confirm.hidden = false;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduced) {
            this.confirm.animate([{ opacity: 1 }, { opacity: 1, offset: .5 }, { opacity: 0 }],
                { duration: motion.confirmDurationMs, easing: 'ease-out', fill: 'forwards' });
            this.confirm.querySelector('.wm-command-halo').animate([
                { transform: 'scale(.7)', opacity: .9 }, { transform: 'scale(1.45)', opacity: 0 },
            ], { duration: motion.confirmDurationMs, easing: 'ease-out', fill: 'forwards' });
        }
        this.confirmTimer = setTimeout(() => { this.confirm.hidden = true; },
            reduced ? motion.reducedConfirmDurationMs : motion.confirmDurationMs);
    }

    destroy() {
        clearTimeout(this.confirmTimer);
        for (const node of [this.pointer, this.confirm]) {
            node.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
            node.querySelector('img').onload = node.querySelector('img').onerror = null;
            node.remove();
        }
    }
}
