

// ============================================================
// Phaser Game 实例 - 无限轮回 Phaser 迁移入口
// ============================================================
import { Game as PhaserGameClass, AUTO, Scale } from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { getElement } from '../utils/dom-utils.js';

let _phaserGame = null;

export const PhaserGame = {
    /**
     * 初始化 Phaser 游戏实例
     * 调用时机：在原有 Game.start() 之后，替换原有的 Canvas 渲染
     */
    init(config = {}) {
        if (_phaserGame) {
            console.warn('[PhaserGame] Already initialized');
            return _phaserGame;
        }

        const parentEl = getElement('gameCanvas')?.parentElement || document.body;

        _phaserGame = new PhaserGameClass({
            type: AUTO,           // 自动选择 WebGL / Canvas
            parent: parentEl,            // 挂载到现有游戏容器
            width: window.innerWidth || 1920,
            height: window.innerHeight || 1080,
            transparent: true,         // 透明背景，让 HTML UI 层显示
            backgroundColor: 'rgba(0,0,0,0)',
            scale: {
                mode: Scale.RESIZE,
                autoCenter: Scale.CENTER_BOTH,
            },
            fps: {
                target: 60,          // 限制目标帧率为 60 FPS
                forceSetTimeOut: false, // 使用 requestAnimationFrame
                min: 30,             // 最低 30 FPS
            },
            physics: {
                default: 'arcade',
                arcade: {
                    gravity: { x: 0, y: 0 }, // 俯视角无重力
                    debug: false,
                }
            },
            input: {
                keyboard: false,  // 禁用 Phaser 键盘插件，防止拦截原有 Input 系统的键盘事件
                mouse: false,     // 禁用 Phaser 鼠标插件，防止拦截原有 Input 系统的鼠标事件
            },
            scene: [BootScene, GameScene],
            ...config,
        });

        // 设置 Phaser Canvas 的 CSS：覆盖在原有 Canvas 上方，透明背景，让鼠标事件穿透
        const _setupCanvasCSS = () => {
            const canvases = parentEl.querySelectorAll('canvas');
            let phaserCanvas = null;
            for (const c of canvases) {
                if (c.id !== 'gameCanvas') { phaserCanvas = c; break; }
            }
            if (phaserCanvas) {
                phaserCanvas.style.position = 'fixed';
                phaserCanvas.style.top = '0';
                phaserCanvas.style.left = '0';
                phaserCanvas.style.width = '100%';
                phaserCanvas.style.height = '100%';
                phaserCanvas.style.zIndex = '2'; // 高于原有 gameCanvas (z-index: 1)
                phaserCanvas.style.pointerEvents = 'none'; // 鼠标事件穿透到原有 Canvas
                // 关键：移除 tabindex，防止 Phaser Canvas 捕获键盘焦点
                phaserCanvas.removeAttribute('tabindex');
                phaserCanvas.setAttribute('tabindex', '-1');
                // 确保 document 获得焦点，让键盘事件冒泡到 window
                if (document.activeElement === phaserCanvas) {
                    document.body.focus();
                }
                console.log('[PhaserGame] Canvas CSS set: z-index=2, pointer-events=none, tabindex=-1');
                return true;
            }
            return false;
        };
        // 尝试多次，确保 Phaser Canvas 已创建
        let attempts = 0;
        const trySetup = () => {
            if (_setupCanvasCSS()) return;
            attempts++;
            if (attempts < 10) setTimeout(trySetup, 100);
            else console.warn('[PhaserGame] Failed to find Phaser canvas after 10 attempts');
        };
        setTimeout(trySetup, 100);

        console.log('[PhaserGame] Phaser initialized');
        return _phaserGame;
    },

    /**
     * 获取当前 Phaser Game 实例
     */
    get game() { return _phaserGame; },

    /**
     * 获取当前活跃场景
     */
    get scene() {
        if (!_phaserGame) return null;
        return _phaserGame.scene.getScene('GameScene');
    },

    /**
     * 销毁 Phaser 实例
     */
    destroy() {
        if (_phaserGame) {
            _phaserGame.destroy(true);
            _phaserGame = null;
        }
    },

    /**
     * 检查是否已初始化
     */
    get isReady() { return _phaserGame !== null; },
};

export default PhaserGame;
