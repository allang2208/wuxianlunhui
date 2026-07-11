
// ============================================================
// HudScene - 屏幕空间 HUD 场景
// ============================================================
import { Scene } from 'phaser';
import { StatusBar } from '../../ui/status-bar.js';
import { GameUIManager } from '../../ui/game-ui-manager.js';

import { getElement } from '../../utils/dom-utils.js';
import { EffectManager } from '../../effects/effect-manager.js';

export class HudScene extends Scene {
    constructor() {
        super({ key: 'HudScene' });
    }

    create() {
        window.__phaserHudScene = this;
        this._statusBarReady = false;

        // 状态效果对象缓存：id -> { icon, name, time, bar }
        this._statusItems = new Map();
        this._statusBarGraphics = this.add.graphics();
        this._statusBarGraphics.setDepth(100);
        this._statusBarGraphics.setScrollFactor(0);

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

        // 隐藏 DOM 状态栏容器
        StatusBar.init();
        if (StatusBar.container) {
            StatusBar.container.style.display = 'none';
        }
    }

    update() {
        this._syncStatusBar();
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
        // 仅隐藏与 Phaser 重复的状态条容器和经验条容器，避免重叠
        const ids = [
            'statusBar', 'statusBarContainer', 'expBarContainer'
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

        // 仅同步经验条（其余 HUD 已恢复为 DOM 显示）
        const expPercent = d.maxExp ? Math.min(1, d.exp / d.maxExp) : 0;
        this._expBarFill.setSize((w - 24) * expPercent, 4);
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

    // ---- 状态栏 Buff/Debuff ----

    _syncStatusBar() {
        const effects = StatusBar.effects || [];
        const activeIds = new Set();
        // 与 DOM 状态栏容器原位置对齐，避免与顶部栏重叠
        const startX = 130;
        const startY = 12;
        const itemW = 90;
        const itemH = 32;
        const gap = 6;

        for (let i = 0; i < effects.length; i++) {
            const effect = effects[i];
            activeIds.add(effect.id);
            let item = this._statusItems.get(effect.id);
            if (!item) {
                item = this._createStatusItem(effect);
                this._statusItems.set(effect.id, item);
            }
            const x = startX + i * (itemW + gap);
            const y = startY;
            const seconds = Math.ceil(effect.remaining / 1000);
            const progress = effect.duration > 0 ? (effect.remaining / effect.duration) : 0;

            item.bg.setPosition(x, y);
            item.bg.setSize(itemW, itemH);
            item.bg.setFillStyle(this._parseColor(effect.color || '#8a7d6b').color, 0.15);

            item.icon.setPosition(x + 4, y + itemH / 2);
            item.icon.setText(effect.icon || '❓');

            item.name.setPosition(x + 22, y + 10);
            item.name.setText(effect.name || '');

            item.time.setPosition(x + itemW - 4, y + 10);
            item.time.setText(`${seconds}s`);

            item.bar.setPosition(x + 22, y + 22);
            item.bar.setSize((itemW - 26) * progress, 4);
            item.bar.setFillStyle(this._parseColor(effect.color || '#8a7d6b').color, 0.8);

            item.icon.setVisible(true);
            item.name.setVisible(true);
            item.time.setVisible(true);
            item.bg.setVisible(true);
            item.bar.setVisible(true);
        }

        // 清理已失效的状态效果
        for (const [id, item] of this._statusItems.entries()) {
            if (!activeIds.has(id)) {
                item.icon.destroy();
                item.name.destroy();
                item.time.destroy();
                item.bg.destroy();
                item.bar.destroy();
                this._statusItems.delete(id);
            }
        }

        this._statusBarReady = true;
    }

    _createStatusItem(effect) {
        const color = this._parseColor(effect.color || '#8a7d6b').color;
        const bg = this.add.rectangle(0, 0, 90, 32, color, 0.15);
        bg.setOrigin(0, 0);
        bg.setDepth(100);
        bg.setScrollFactor(0);

        const icon = this.add.text(0, 0, effect.icon || '❓', {
            fontSize: '16px',
            color: '#ffffff'
        });
        icon.setOrigin(0, 0.5);
        icon.setDepth(101);
        icon.setScrollFactor(0);

        const name = this.add.text(0, 0, effect.name || '', {
            fontFamily: 'SimHei, "Microsoft YaHei", sans-serif',
            fontSize: '10px',
            color: '#d4c5a9'
        });
        name.setOrigin(0, 0.5);
        name.setDepth(101);
        name.setScrollFactor(0);

        const time = this.add.text(0, 0, '', {
            fontFamily: 'SimHei, "Microsoft YaHei", sans-serif',
            fontSize: '10px',
            color: '#ffffff'
        });
        time.setOrigin(1, 0.5);
        time.setDepth(101);
        time.setScrollFactor(0);

        const bar = this.add.rectangle(0, 0, 64, 4, color, 0.8);
        bar.setOrigin(0, 0.5);
        bar.setDepth(101);
        bar.setScrollFactor(0);

        return { bg, icon, name, time, bar };
    }

    _parseColor(str) {
        if (!str) return { color: 0xffffff };
        if (str[0] === '#') {
            let hex = str.slice(1);
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            return { color: parseInt(hex, 16) || 0xffffff };
        }
        const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*/i);
        if (m) {
            return { color: (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]) };
        }
        return { color: 0xffffff };
    }
}
