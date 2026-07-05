// ============================================================
// 智能寻路系统排查控制台代码
// 在浏览器 DevTools 控制台中逐行运行
// ============================================================

// --- 1. 检查 PathManager 是否生效 ---
(function checkPathManager() {
    console.log('=== 智能寻路系统排查 ===');
    
    // 检查 PathManager 类是否可用
    console.log('PathManager 类可用:', typeof PathManager !== 'undefined');
    console.log('pathFinder 可用:', typeof pathFinder !== 'undefined');
    
    // 检查所有敌人的 PathManager 状态
    const enemies = Array.from(Game.entities.values()).filter(e => e instanceof Enemy);
    console.log('敌人总数:', enemies.length);
    
    enemies.forEach((e, i) => {
        const pm = e._pathManager;
        console.log(`\n--- 敌人 ${i}: ${e.name} (${e.id}) ---`);
        console.log('  PathManager 存在:', !!pm);
        if (pm) {
            console.log('  有有效路径:', pm.hasValidPath());
            console.log('  路径长度:', pm.path ? pm.path.length : 0);
            console.log('  当前索引:', pm.pathIdx);
            console.log('  路径有效:', pm.isValid);
            console.log('  检查计时器:', pm.checkTimer.toFixed(0), 'ms');
            console.log('  卡住计数:', pm.stuckCount);
        } else {
            console.log('  旧路径存在:', !!e._path);
            console.log('  旧路径长度:', e._path ? e._path.length : 0);
        }
    });
})();

// --- 2. 实时追踪黑狼移动状态（每 500ms 打印）---
let trackInterval = null;
function startTracking() {
    if (trackInterval) clearInterval(trackInterval);
    trackInterval = setInterval(() => {
        const wolf = Game.entities.get('test_black_wolf') || 
                     Array.from(Game.entities.values()).find(e => e instanceof BlackWolf);
        if (!wolf) { console.log('黑狼未找到'); return; }
        
        const pm = wolf._pathManager;
        const target = wolf.target;
        console.log(`\n[${Date.now()}] ${wolf.name}: pos=(${wolf.x.toFixed(0)},${wolf.y.toFixed(0)})`);
        console.log(`  target: ${target ? target.name : 'null'}, dist=${target ? Math.hypot(target.x-wolf.x, target.y-wolf.y).toFixed(0) : 'N/A'}`);
        console.log(`  PathManager: ${!!pm}, hasPath=${pm ? pm.hasValidPath() : 'N/A'}`);
        if (pm && pm.hasValidPath()) {
            const wp = pm.getCurrentWaypoint();
            console.log(`  pathLen=${pm.path.length}, idx=${pm.pathIdx}, valid=${pm.isValid}`);
            console.log(`  nextWaypoint: (${wp.x.toFixed(0)}, ${wp.y.toFixed(0)})`);
        } else if (wolf._path) {
            console.log(`  OLD path: len=${wolf._path.length}, idx=${wolf._pathIdx}`);
        } else {
            console.log('  无路径: 直线移动');
        }
        console.log(`  vx=${wolf.vx.toFixed(1)}, vy=${wolf.vy.toFixed(1)}, moving=${wolf.isMoving}`);
    }, 500);
    console.log('开始追踪黑狼（每 500ms），停止请运行: stopTracking()');
}
function stopTracking() {
    if (trackInterval) { clearInterval(trackInterval); trackInterval = null; console.log('已停止追踪'); }
}
startTracking();

// --- 3. 强制黑狼重新寻路并观察 ---
function forceWolfRecalc() {
    const wolf = Game.entities.get('test_black_wolf') || 
                 Array.from(Game.entities.values()).find(e => e instanceof BlackWolf);
    if (!wolf) { console.log('黑狼未找到'); return; }
    if (!wolf.target) { console.log('黑狼无目标'); return; }
    
    console.log('强制黑狼重新寻路...');
    console.log('起点:', wolf.x.toFixed(0), wolf.y.toFixed(0));
    console.log('终点:', wolf.target.x.toFixed(0), wolf.target.y.toFixed(0));
    
    if (wolf._pathManager) {
        wolf._pathManager.forceRecalc(pathFinder, wolf.target.x, wolf.target.y);
        console.log('forceRecalc 后:', wolf._pathManager.hasValidPath());
        if (wolf._pathManager.path) {
            console.log('新路径长度:', wolf._pathManager.path.length);
            console.log('路径前3点:', wolf._pathManager.path.slice(0, 3).map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`));
        }
    } else {
        console.log('PathManager 不存在，使用旧系统');
        wolf._path = pathFinder.findPath(wolf.x, wolf.y, wolf.target.x, wolf.target.y, wolf.collisionRadius || 12);
        wolf._pathIdx = 0;
        console.log('旧路径:', wolf._path ? wolf._path.length : 'null');
    }
}

// --- 4. 检查树木/墙壁碰撞体分布 ---
function checkObstacles(wolfId) {
    const wolf = typeof wolfId === 'string' ? Game.entities.get(wolfId) : 
                 Array.from(Game.entities.values()).find(e => e instanceof BlackWolf);
    if (!wolf) { console.log('未找到黑狼'); return; }
    
    console.log('=== 黑狼附近障碍物 ===');
    console.log('黑狼位置:', wolf.x.toFixed(0), wolf.y.toFixed(0), '半径:', wolf.collisionRadius);
    
    // 附近树木
    if (WallSystem.trees) {
        const nearbyTrees = WallSystem.trees.filter(t => {
            const d = Math.hypot(t.x - wolf.x, t.y - wolf.y);
            return d < 200;
        });
        console.log('200px 内树木数:', nearbyTrees.length);
        nearbyTrees.forEach((t, i) => {
            const d = Math.hypot(t.x - wolf.x, t.y - wolf.y);
            console.log(`  树${i}: (${t.x.toFixed(0)},${t.y.toFixed(0)}) r=${t.radius}, collisionR=${t.collisionRadius || t.radius*0.6}, 距离=${d.toFixed(0)}`);
        });
    }
    
    // 附近墙壁
    if (WallSystem.walls) {
        const nearbyWalls = WallSystem.walls.filter(w => {
            const cx = w.x + w.w/2, cy = w.y + w.h/2;
            const d = Math.hypot(cx - wolf.x, cy - wolf.y);
            return d < 200;
        });
        console.log('200px 内墙壁数:', nearbyWalls.length);
    }
}

// --- 5. 测试路径缓存 ---
function testPathCache() {
    if (!pathFinder) { console.log('pathFinder 不可用'); return; }
    console.log('路径缓存大小:', pathFinder._pathCache ? pathFinder._pathCache.size : 'N/A');
    if (pathFinder._pathCache && pathFinder._pathCache.size > 0) {
        console.log('缓存条目:', Array.from(pathFinder._pathCache.keys()).slice(0, 3));
    }
}

// --- 6. 一键诊断 ---
function diagnose() {
    console.log('\n============= 智能寻路诊断 =============');
    checkPathManager();
    const wolf = Array.from(Game.entities.values()).find(e => e instanceof BlackWolf);
    if (wolf) checkObstacles(wolf);
    testPathCache();
    console.log('=====================================\n');
}

// 在控制台运行 diagnose() 查看完整诊断
console.log('排查脚本已加载。可用命令:');
console.log('  startTracking() / stopTracking() - 追踪黑狼');
console.log('  forceWolfRecalc() - 强制重新寻路');
console.log('  checkObstacles() - 检查附近障碍物');
console.log('  testPathCache() - 检查路径缓存');
console.log('  diagnose() - 一键诊断');
