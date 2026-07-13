
// ============================================================
// HudScene - 屏幕空间 HUD 场景
// ============================================================
import { Scene } from 'phaser';
import { GameUIManager } from '../../ui/game-ui-manager.js';

import { getElement } from '../../utils/dom-utils.js';
import { EffectManager } from '../../effects/effect-manager.js';

export class HudScene extends Scene {
    constructor() {
        super({ key: 'HudScene' });
    }

    create() {
        window.__phaserHudScene = this;

        // 屏幕空间特效层
        this._critFlashRect = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0xffffff, 0);
        this._critFlashRect.setOrigin(0, 0);
        this._critFlashRect.setDepth(100000);
        this._critFlashRect.setScrollFactor(0);

        this._damageOverlay = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0xff1e1e, 0);
        this._damageOverlay.setOrigin(0, 0);
        this._damageOverlay.setDepth(99999);
        this._damageOverlay.setScrollFactor(0);

        this._createSimpleHud();
        this._hideDomHud();
    }

    update() {
        this._syncScreenEffects();
        this._syncSimpleHud();
    }

    // ---- 简单 HUD 创建 ----

    _createSimpleHud() {
        const w = this.scale.width;
        const h = this.scale.height;

        // 仅保留经验条（DOM 经验条已隐藏，避免重复）
        const expY = h - 8;
        this._expBarBg = this.add.rectangle(w / 2, expY, w - 24, 4, 0x3a3a3a, 0.8);
        this._expBarBg.setOrigin(0.5, 1);
        this._expBarBg.setDepth(101);
        this._expBarBg.setScrollFactor(0);
        this._expBarFill = this.add.rectangle(12, expY, 0, 4, 0xffd700, 0.9);
        this._expBarFill.setOrigin(0, 1);
        this._expBarFill.setDepth(102);
        this._expBarFill.setScrollFactor(0);
    }

    _hideDomHud() {
        // 顶部栏、计时器、武器信息、操作提示恢复为 DOM 显示；
        // 仅隐藏与 Phaser 重复的经验条容器，避免重叠
        const ids = [
            'expBarContainer'
        ];
        ids.forEach(id => {
            const el = getElement(id);
            if (el) el.style.display = 'none';
        });
    }

    _syncSimpleHud() {
        const player = GameUIManager.player || (window.Game && window.Game.player);
        if (!player) return;
        const d = player.data;
        const w = this.scale.width;
        const h = this.scale.height;

        // 仅同步经验条（其余 HUD 已恢复为 DOM 显示）
        // 使用固定像素 bottom 定位，并在窗口缩放时重新对齐
        const expPercent = d.maxExp ? Math.min(1, d.exp / d.maxExp) : 0;
        const barW = Math.max(0, w - 24);
        this._expBarBg.setPosition(w / 2, h - 8);
        this._expBarBg.setSize(barW, 4);
        this._expBarFill.setPosition(12, h - 8);
        this._expBarFill.setSize(barW * expPercent, 4);
    }

    // ---- 屏幕特效 ----

    _syncScreenEffects() {
        const viewW = this.scale.width || window.innerWidth || 1920;
        const viewH = this.scale.height || window.innerHeight || 1080;

        // 暴击屏幕闪光
        let critAlpha = 0;
        if (typeof EffectManager.critFlash === 'number') {
            critAlpha = EffectManager.critFlash * 0.4;
        }
        if (critAlpha > 0) {
            this._critFlashRect.setSize(viewW, viewH);
            this._critFlashRect.setFillStyle(0xffffff, critAlpha);
            this._critFlashRect.setVisible(true);
        } else {
            this._critFlashRect.setVisible(false);
        }

        // 玩家受击红屏
        let damageAlpha = 0;
        const Game = window.Game;
        if (Game && Game.player && Game.player.hitFlash > 0) {
            damageAlpha = (Game.player.hitFlash / Game.player.hitFlashDuration) * 0.25;
        }
        if (damageAlpha > 0) {
            this._damageOverlay.setSize(viewW, viewH);
            this._damageOverlay.setFillStyle(0xff1e1e, damageAlpha);
            this._damageOverlay.setVisible(true);
        } else {
            this._damageOverlay.setVisible(false);
        }
    }

}
