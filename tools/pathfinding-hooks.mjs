// 寻路基准专用加载钩子：把 src/game.js 替换为最小桩。
// dynamic-obstacle-map.js 静态导入 Game，而 game.js 的 Phaser 链无法在 Node 加载。
export async function load(url, context, nextLoad) {
    if (typeof url === 'string' && url.includes('/src/game.js')) {
        return {
            format: 'module',
            source: 'export const Game = { entities: new Map(), _battleCommander: null };',
            shortCircuit: true
        };
    }
    return nextLoad(url, context);
}
