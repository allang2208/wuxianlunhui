// === 黑狼排查控制台代码 ===
// 在浏览器控制台 F12 中运行这些代码

// 1. 检查测试黑狼是否在 entities 中
console.log('=== 测试黑狼排查 ===');
const wolf = Game.entities.get('test_black_wolf');
console.log('黑狼存在:', !!wolf);
if (wolf) {
    console.log('位置:', wolf.x, wolf.y);
    console.log('active:', wolf.active);
    console.log('hp:', wolf.hp, '/', wolf.maxHp);
    console.log('animState:', wolf._animState);
    console.log('animFrame:', wolf._animFrame);
    console.log('精灵图加载完成:', wolf._sprite.complete);
    console.log('精灵图尺寸:', wolf._sprite.naturalWidth, 'x', wolf._sprite.naturalHeight);
    console.log('帧尺寸:', wolf._frameW, 'x', wolf._frameH);
}

// 2. 检查所有 BlackWolf 类型的实体
console.log('\n=== 所有 BlackWolf 实体 ===');
Game.entities.forEach((e, key) => {
    if (e instanceof BlackWolf) {
        console.log('key:', key, 'pos:', e.x, e.y, 'active:', e.active, 'visible in screen:', Math.abs(e.x - Camera.x) < 500 && Math.abs(e.y - Camera.y) < 500);
    }
});

// 3. 检查 Phaser 是否劫持了渲染
console.log('\n=== Phaser 状态 ===');
console.log('phaserScene 存在:', !!window.__phaserScene);
console.log('Camera 位置:', Camera.x, Camera.y);
console.log('玩家位置:', Game.player ? {x: Game.player.x, y: Game.player.y} : '无玩家');

// 4. 强制在玩家位置生成一只可见的黑狼（测试用）
if (Game.player) {
    const testWolf = new BlackWolf(Game.player.x + 100, Game.player.y + 100);
    Game.entities.set('test_wolf_debug', testWolf);
    console.log('\n已在玩家旁边生成测试黑狼:', Game.player.x + 100, Game.player.y + 100);
}

// 5. 检查图片是否加载成功
const img = new Image();
img.onload = () => console.log('\n图片加载成功:', img.src, img.width, img.height);
img.onerror = () => console.log('\n图片加载失败:', img.src);
img.src = 'assets/enemies/black_wolf.png';

// 6. 检查 Phaser 中是否有 enemy_black_wolf 纹理
if (window.__phaserScene) {
    const tex = window.__phaserScene.textures.get('enemy_black_wolf');
    console.log('\nPhaser 纹理 enemy_black_wolf 存在:', tex ? true : false);
    if (tex) {
        const src = tex.getSourceImage();
        console.log('纹理尺寸:', src.width, 'x', src.height);
    }
}
