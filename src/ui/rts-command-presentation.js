/** 左栏与轮盘共用的展示定义；能力检查和执行仍由 RTSCommand 负责。 */
export const RTS_ORDER_UI = Object.freeze({
    move: { name: '移动', cell: 0, target: 'point', cursor: 'move', hint: '左键指定位置；沿现有寻路移动，不主动接敌。Shift可追加。' },
    attack: { name: '指定攻击', cell: 1, target: 'enemy', cursor: 'attack_target', hint: '左键点击可见敌人，追击并攻击该目标。Shift可追加；小地图不能指定敌人。' },
    attack_move: { name: '移动攻击', cell: 2, target: 'point', cursor: 'attack_move', hint: '左键指定终点，沿途接敌，战斗结束后继续前进。Shift可追加；玩家不支持。', wheelHint: '以轮盘开启处为终点，沿途接敌，战斗结束后继续前进。Shift可追加；玩家不支持。' },
    patrol: { name: '巡逻', cell: 3, target: 'point', cursor: 'patrol', hint: '左键指定另一端，在当前位置与目标间往返接敌。Shift可追加；玩家不支持。', wheelHint: '以轮盘开启处为另一端，往返巡逻接敌。Shift可追加；玩家不支持。' },
    stop: { name: '停止', cell: 4, hint: '中止当前指令并清空队列；仓鼠士兵恢复自动接敌，可追击。玩家和正式队友原地待命。' },
    hold: { name: '坚守', cell: 5, hint: '清空队列并原地待命；仓鼠士兵只攻击当前位置能打到的敌人，不追击。玩家和正式队友不自动攻击。' },
    follow: { name: '跟随玩家', cell: 6, hint: '清空原指令和队列，恢复跟随玩家；不需要再选择目标，玩家自身不支持。' },
    gather: { name: '采集', cell: 7, target: 'point', cursor: 'gather', hint: '左键指定采集区域，正式队友寻找附近能源节点。替换原命令，不追加队列；没有资源时跟随玩家。', wheelHint: '以轮盘开启处为采集区域，正式队友寻找附近能源节点。替换原命令，不追加队列。' },
    explore: { name: '开始探险', cell: 8, hint: '仅探险家可执行，耗时12分钟，完成后结算一次。探险期间只能使用停止探险。' },
    stealth: { name: '烟遁隐身', cell: 9, hint: '让已冷却且未隐身的忍者施放烟遁；隐身期间移速增加30%，攻击会解除。' },
    reveal: { name: '解除隐身', cell: 10, hint: '让选中单位中正在隐身或施放烟遁的忍者解除隐身。' },
    rally: { name: '自订集结', cell: 11, hint: '为新生产士兵设置兵线集结点，不给当前选中单位下令。' },
    stop_explore: { name: '停止探险', cell: 4, hint: '取消选中探险家的当前探险，不结算未完成奖励。' },
});

/** 图集为4列3行。只裁切背景视窗，不额外创建或复制12张纹理。 */
export function rtsOrderIcon(mode) {
    const { cell } = RTS_ORDER_UI[mode];
    return `<span class="rts-order-icon" aria-hidden="true" style="background-position:${(cell % 4) * 100 / 3}% ${Math.floor(cell / 4) * 50}%"></span>`;
}
