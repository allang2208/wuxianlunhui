// ===== 坐标系统诊断工具 =====
// 复制到浏览器控制台执行

(function diagnose() {
    const p = Game.player;
    const cam = Camera;
    const renderer = Renderer;
    const vw = CONFIG.VIEW_WIDTH;
    const vh = CONFIG.VIEW_HEIGHT;
    const origin = renderer._getSceneOrigin();
    
    console.log('========== 坐标系统诊断 ==========');
    console.log('');
    
    // 1. 玩家实际世界坐标
    console.log('【玩家实际世界坐标】');
    console.log('  player.x:', Math.round(p.x));
    console.log('  player.y:', Math.round(p.y));
    console.log('  注意：Canvas 渲染用此坐标');
    console.log('');
    
    // 2. 屏幕上方显示坐标（uiPos）
    const dp = renderer.worldToDisplay(p.x, p.y);
    console.log('【屏幕上方显示坐标】（uiPos）');
    console.log('  显示 x:', Math.round(dp.x));
    console.log('  显示 y:', Math.round(dp.y));
    console.log('  转换公式：display = world - origin');
    console.log('  原点(origin):', origin);
    console.log('');
    
    // 3. Camera 坐标
    console.log('【Camera 坐标】');
    console.log('  Camera.x:', Math.round(cam.x));
    console.log('  Camera.y:', Math.round(cam.y));
    console.log('  Camera.shakeX:', Math.round(cam.shakeX));
    console.log('  Camera.shakeY:', Math.round(cam.shakeY));
    console.log('  VIEW_WIDTH:', vw);
    console.log('  VIEW_HEIGHT:', vh);
    console.log('');
    
    // 4. 屏幕中心世界坐标
    const screenCenter = renderer.screenToWorld(vw/2, vh/2);
    console.log('【屏幕中心世界坐标】');
    console.log('  screenToWorld(VIEW_WIDTH/2, VIEW_HEIGHT/2):', 
        Math.round(screenCenter.x) + ', ' + Math.round(screenCenter.y));
    console.log('  理论值应等于 Camera 坐标（因为 Camera 跟随玩家）');
    console.log('');
    
    // 5. 玩家屏幕位置
    const sp = renderer.worldToScreen(p.x, p.y);
    console.log('【玩家屏幕位置】');
    console.log('  worldToScreen(player.x, player.y):', 
        Math.round(sp.x) + ', ' + Math.round(sp.y));
    console.log('  理论值应约等于 (VIEW_WIDTH/2, VIEW_HEIGHT/2) = (' + vw/2 + ', ' + vh/2 + ')');
    console.log('');
    
    // 6. 武器生成坐标 (-874, -136) 的屏幕位置
    const weaponScreen = renderer.worldToScreen(-874, -136);
    const weaponDisplay = renderer.worldToDisplay(-874, -136);
    console.log('【武器生成坐标 (-874, -136)】');
    console.log('  屏幕位置 worldToScreen:', 
        Math.round(weaponScreen.x) + ', ' + Math.round(weaponScreen.y));
    console.log('  显示坐标 worldToDisplay:', 
        Math.round(weaponDisplay.x) + ', ' + Math.round(weaponDisplay.y));
    console.log('  是否在视野内:', 
        weaponScreen.x >= 0 && weaponScreen.x <= vw && weaponScreen.y >= 0 && weaponScreen.y <= vh ? '✅ 是' : '❌ 否');
    console.log('');
    
    // 7. 玩家到武器的距离
    const dist = Math.sqrt((p.x + 874)**2 + (p.y + 136)**2);
    console.log('【玩家到武器距离】');
    console.log('  距离:', Math.round(dist), 'px');
    console.log('  视野半径:', Math.round(Math.sqrt(vw*vw + vh*vh)/2), 'px');
    console.log('  武器是否在视野:', dist < Math.sqrt(vw*vw + vh*vh)/2 ? '✅ 可能可见' : '❌ 在视野外');
    console.log('');
    
    // 8. 检查所有 DropItem 的坐标
    console.log('【所有 DropItem 坐标】');
    let dropCount = 0;
    Game.entities.forEach((e, key) => {
        if (e && key.startsWith('drop_')) {
            dropCount++;
            const es = renderer.worldToScreen(e.x, e.y);
            const ed = renderer.worldToDisplay(e.x, e.y);
            const inView = es.x >= 0 && es.x <= vw && es.y >= 0 && es.y <= vh;
            console.log('  ', key, 
                'world:', Math.round(e.x) + ',' + Math.round(e.y),
                'screen:', Math.round(es.x) + ',' + Math.round(es.y),
                'display:', Math.round(ed.x) + ',' + Math.round(ed.y),
                inView ? '✅' : '❌');
        }
    });
    if (dropCount === 0) console.log('  没有 DropItem！');
    console.log('');
    
    // 9. 诊断结论
    console.log('========== 诊断结论 ==========');
    const dx = p.x - cam.x;
    const dy = p.y - cam.y;
    const centerX = vw/2;
    const centerY = vh/2;
    const offsetX = sp.x - centerX;
    const offsetY = sp.y - centerY;
    
    if (Math.abs(offsetX) > 5 || Math.abs(offsetY) > 5) {
        console.log('⚠️ 玩家不在屏幕中心！');
        console.log('  偏移量:', offsetX.toFixed(2), ',', offsetY.toFixed(2));
    } else {
        console.log('✅ 玩家屏幕位置正确（在中心）');
    }
    
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        console.log('⚠️ Camera 未正确跟随玩家！');
        console.log('  差值:', dx.toFixed(2), ',', dy.toFixed(2));
    } else {
        console.log('✅ Camera 跟随正确');
    }
    
    if (dropCount === 0) {
        console.log('❌ 没有武器掉落物！可能 spawnAllWeapons 未执行或生成失败');
    } else if (dist > Math.sqrt(vw*vw + vh*vh)/2) {
        console.log('❌ 武器在玩家视野外，需要移动到', Math.round(-874), ',', Math.round(-136), '附近');
    }
    
    console.log('');
    console.log('【坐标系说明】');
    console.log('  世界坐标：原始坐标，player.x/player.y 使用此坐标系');
    console.log('  显示坐标：world - origin，uiPos 使用此坐标系');
    console.log('  屏幕坐标：world - Camera + VIEW_CENTER，渲染使用此坐标系');
    console.log('  原点(origin):', origin, '(主神空间中心)');
})();
