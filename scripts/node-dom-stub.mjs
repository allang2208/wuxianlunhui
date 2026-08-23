/**
 * node-dom-stub.mjs — Node 环境最小 DOM 桩
 *
 * 用途：让契约测试/基准脚本可以 import 到携带 Phaser 依赖的模块（如 MovementSystem
 * 经 game.js 传递依赖 Phaser）。Phaser 4 的 ESM 包在 import 期会探测 window/document/
 * canvas 2D 上下文；本桩提供恰好够导入通过的最小接口（2D 上下文用吸收代理）。
 *
 * 只保证"模块可加载"，不模拟任何真实渲染行为；需要真实画布语义的测试请走 CDP 探针。
 * 用法：在所有业务 import 之前 `await import('./node-dom-stub.mjs')`（或相对路径等价物）。
 */

if (typeof globalThis.window === 'undefined') {
    // 吸收代理：任何属性读写/调用都安全吞掉（canvas 2D 上下文等深接口用）
    const absorb = new Proxy(function () {}, {
        get: (t, p) => (p === Symbol.toPrimitive ? 0 : absorb),
        set: () => true,
        apply: () => absorb,
    });

    class FakeCanvas {
        constructor() { this.style = {}; this.width = 0; this.height = 0; }
        getContext() { return absorb; }
        addEventListener() {}
        removeEventListener() {}
        setAttribute() {}
        toDataURL() { return ''; }
    }

    globalThis.HTMLCanvasElement = FakeCanvas;
    globalThis.HTMLVideoElement = class {};
    globalThis.HTMLElement = class {};
    globalThis.window = {
        cordova: undefined,
        location: { href: '' },
        navigator: globalThis.navigator,
        screen: {},
        addEventListener() {},
        removeEventListener() {},
        setTimeout,
        clearTimeout,
        requestAnimationFrame: (f) => setTimeout(f, 16),
        devicePixelRatio: 1,
        innerWidth: 1280,
        innerHeight: 720,
        HTMLCanvasElement: FakeCanvas,
    };
    globalThis.document = {
        createElement: (tag) => (tag === 'canvas'
            ? new FakeCanvas()
            : { style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, appendChild() {} }),
        documentElement: { style: {} },
        addEventListener() {},
        removeEventListener() {},
        hidden: false,
        visibilityState: 'visible',
        readyState: 'complete',
        body: { appendChild() {} },
    };
    globalThis.location = { href: '' };
    globalThis.screen = {};
    globalThis.Image = class { set src(v) {} };
    globalThis.Audio = class {};
}
