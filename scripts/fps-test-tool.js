// ========================================
// 帧率控制 & 速度测试工具
// 复制到浏览器控制台执行，然后按说明使用
// ========================================

(function() {
    // ---- 1. 帧率限制（覆盖 requestAnimationFrame）----
    if (!window.__originalRAF) {
        window.__originalRAF = window.requestAnimationFrame;
    }
    
    window.__targetFPS = 60;
    window.__frameInterval = 1000 / 60;
    window.__lastFrameTime = 0;
    
    function limitedRAF(callback) {
        const now = performance.now();
        const elapsed = now - window.__lastFrameTime;
        
        if (elapsed < window.__frameInterval) {
            // 还没到下一帧，延迟执行
            return setTimeout(() => {
                window.__lastFrameTime = performance.now();
                callback(window.__lastFrameTime);
            }, window.__frameInterval - elapsed);
        }
        
        window.__lastFrameTime = now;
        return window.__originalRAF(callback);
    }
    
    // 应用限制
    window.requestAnimationFrame = limitedRAF;
    
    // 设置目标帧率
    window.setTargetFPS = function(fps) {
        window.__targetFPS = fps;
        window.__frameInterval = 1000 / fps;
        window.__lastFrameTime = 0; // 重置，避免突变卡顿
        console.log(`✅ 帧率已限制到 ${fps}fps，请移动角色测试速度`);
    };
    
    // 恢复无限制
    window.resetFPS = function() {
        window.requestAnimationFrame = window.__originalRAF;
        window.__lastFrameTime = 0;
        console.log('✅ 帧率已恢复（跟随显示器刷新率）');
    };
    
    // ---- 2. 实时 FPS 显示 ----
    const fpsDiv = document.createElement('div');
    fpsDiv.id = '__fps_display';
    fpsDiv.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.8);color:#0f0;padding:8px 14px;font-family:monospace;font-size:13px;z-index:99999;border-radius:4px;pointer-events:none;';
    document.body.appendChild(fpsDiv);
    
    let frameCount = 0;
    let lastFPSTime = performance.now();
    
    function countFPS() {
        frameCount++;
        const now = performance.now();
        if (now - lastFPSTime >= 1000) {
            fpsDiv.textContent = `FPS: ${frameCount} | 目标: ${window.__targetFPS}`;
            frameCount = 0;
            lastFPSTime = now;
        }
        window.__originalRAF(countFPS); // 用原始RAF计数，避免被限制影响
    }
    countFPS();
    
    // ---- 3. 移动速度测量工具 ----
    window.measureSpeed = function(durationSec = 5) {
        const game = window.game;
        if (!game || !game.player) {
            console.error('❌ 游戏未初始化，请进入游戏后执行');
            return null;
        }
        
        const p = game.player;
        const startX = p.x;
        const startY = p.y;
        const startTime = performance.now();
        
        console.log(`\n🚀 开始测速（${durationSec}秒）...`);
        console.log(`   起点: (${startX.toFixed(1)}, ${startY.toFixed(1)})`);
        console.log(`   请按住 W/A/S/D 或方向键移动！`);
        
        setTimeout(() => {
            const dx = p.x - startX;
            const dy = p.y - startY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const time = (performance.now() - startTime) / 1000;
            const speed = dist / time;
            
            console.log(`\n📊 测速结果:`);
            console.log(`   移动距离: ${dist.toFixed(1)} px`);
            console.log(`   实际耗时: ${time.toFixed(2)} s`);
            console.log(`   平均速度: ${speed.toFixed(1)} px/s`);
            console.log(`   当前帧率: ${window.__targetFPS} fps`);
            console.log(`\n💡 对比方法：切换不同帧率，保持相同操作，速度应该接近`);
        }, durationSec * 1000);
    };
    
    // ---- 4. 快速对比测试 ----
    window.runFPSCompare = async function() {
        const fpsList = [30, 60];
        const results = [];
        
        for (const fps of fpsList) {
            setTargetFPS(fps);
            console.log(`\n=== 测试 ${fps}fps ===`);
            
            // 等待用户确认
            await new Promise(resolve => {
                const ok = confirm(`已切换到 ${fps}fps\n请按住方向键移动，然后点击确定记录结果`);
                resolve(ok);
            });
            
            const p = window.game.player;
            const startX = p.x, startY = p.y;
            const startTime = performance.now();
            
            // 测量3秒
            await new Promise(r => setTimeout(r, 3000));
            
            const dx = p.x - startX;
            const dy = p.y - startY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const time = (performance.now() - startTime) / 1000;
            
            results.push({ fps, dist, time, speed: dist/time });
            console.log(`   ${fps}fps: ${dist.toFixed(1)}px / ${time.toFixed(2)}s = ${(dist/time).toFixed(1)} px/s`);
        }
        
        resetFPS();
        
        // 汇总
        console.log('\n========== 对比结果 ==========');
        results.forEach(r => {
            console.log(`${r.fps}fps: ${r.speed.toFixed(1)} px/s`);
        });
        const diff = Math.abs(results[0].speed - results[1].speed);
        const avg = (results[0].speed + results[1].speed) / 2;
        const error = (diff / avg * 100).toFixed(1);
        console.log(`差异: ${error}%（<5% 说明帧率独立修复成功）`);
    };
    
    console.log('====================================');
    console.log('  帧率控制工具已加载！');
    console.log('====================================');
    console.log('用法：');
    console.log('  setTargetFPS(30)   // 限制到 30fps');
    console.log('  setTargetFPS(60)   // 限制到 60fps');
    console.log('  setTargetFPS(120)  // 限制到 120fps');
    console.log('  resetFPS()         // 恢复无限制');
    console.log('  measureSpeed(5)    // 测量5秒移动速度（默认5秒）');
    console.log('  runFPSCompare()    // 自动对比30/60fps（需手动移动）');
    console.log('====================================');
})();
