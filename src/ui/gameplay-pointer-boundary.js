// ============================================================
// 游戏世界指针边界
// 只有实际游戏渲染表面可以产生攻击、选中或地图指令；所有 DOM 栏目默认隔离。
// ============================================================

/**
 * 判断鼠标事件是否真正落在游戏画面上。
 *
 * Phaser 画布当前 pointer-events:none，普通世界点击通常会穿透到 #gameContainer；
 * #gameCanvas 仅在地牢路线页显示。这里保留画布本身作为合法表面，便于后续渲染层调整，
 * 但 map-mode 始终排除，避免路线页输入进入角色/指挥链。
 */
export function isGameplayPointerEvent(event) {
    const target = event?.target;
    if (!target || typeof document === 'undefined') return false;
    if (document.body?.classList?.contains('map-mode')) return false;
    if (document.getElementById('strategicExpeditionPanel')?.classList.contains('active')) return false;
    if (document.getElementById('cityHallPolicyPanel')?.classList.contains('active')) return false;
    // DOM 物品拖动越过画布时，不能触发世界命令或被世界准星覆盖握手指针。
    if (document.documentElement?.classList.contains('item-drag-active')) return false;

    const gameContainer = document.getElementById('gameContainer');
    const gameLayer = document.getElementById('gameLayer');
    const fallbackCanvas = document.getElementById('gameCanvas');
    if (target === gameContainer || target === gameLayer || target === fallbackCanvas) return true;

    return !!target.classList?.contains('phaser-game-canvas');
}
