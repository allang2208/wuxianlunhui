// === 完整黑狼排查代码 ===
// 在浏览器控制台 F12 中运行

console.log('===== 1. 检查 entities 中所有黑狼 =====');
Game.entities.forEach((e, key) => {
    if (e instanceof BlackWolf) {
        console.log('key:', key, '| pos:', Math.round(e.x), Math.round(e.y), '| active:', e.active, '| hp:', e.hp);
        console.log('  _sprite:', e._sprite.complete, e._sprite.naturalWidth, 'x', e._sprite.naturalHeight);
        console.log('  _frame:', e._animFrame, '| _animState:', e._animState);
        console.log('  _frameW/H:', e._frameW, e._frameH);
        console.log('  距离玩家:', Math.round(Math.sqrt((e.x - Game.player.x)**2 + (e.y - Game.player.y)**2)), 'px');
    }
});

console.log('\n===== 2. 检查 Phaser 纹理 =====');
const scene = window.__phaserScene;
if (scene) {
    const tex = scene.textures.get('enemy_black_wolf');
    console.log('纹理存在:', tex ? true : false);
    if (tex && tex.getSourceImage) {
        const src = tex.getSourceImage();
        console.log('纹理尺寸:', src.width, 'x', src.height);
    }
    // 检查所有 Phaser 敌人 sprite
    console.log('\n--- 所有 Phaser 敌人 Sprite ---');
    const allSprites = scene.children.list.filter(c => c.name && c.name.includes('enemy'));
    allSprites.forEach(s => {
        console.log('  sprite name:', s.name, '| visible:', s.visible, '| pos:', Math.round(s.x), Math.round(s.y), '| scale:', s.scaleX, s.scaleY, '| alpha:', s.alpha);
    });
}

console.log('\n===== 3. 强制在玩家正前方生成一只可见黑狼 =====');
if (Game.player) {
    const wx = Game.player.x + 100;
    const wy = Game.player.y;
    const wolf = new BlackWolf(wx, wy);
    Game.entities.set('test_wolf_v2', wolf);
    console.log('已生成黑狼在:', wx, wy, '| 距离玩家:', 100, 'px');
    // 强制设置它面向玩家方向
    wolf.rotation = Math.PI; 
}

console.log('\n===== 4. 检查 Phaser sprite 创建后的状态（延迟500ms）=====');
setTimeout(() => {
    if (scene) {
        const sprite = scene.children.list.find(c => c.name === 'enemy_black_wolf_test_wolf_v2');
        console.log('Phaser sprite 存在:', !!sprite);
        if (sprite) {
            console.log('  visible:', sprite.visible, '| alpha:', sprite.alpha, '| scale:', sprite.scaleX, sprite.scaleY);
            console.log('  pos:', sprite.x, sprite.y, '| angle:', sprite.angle);
            console.log('  texture width:', sprite.texture.getSourceImage().width);
        }
    }
}, 500);

console.log('\n===== 5. 检查图片是否实际被 Canvas 裁剪正确 =====');
const img = new Image();
img.onload = () => {
    console.log('图片加载OK:', img.width, img.height);
    const frameW = img.width / 4;
    const frameH = img.height / 2;
    console.log('单帧尺寸:', frameW, 'x', frameH);
    console.log('帧0位置:', 0, 0, frameW, frameH);
    console.log('帧1位置:', frameW, 0, frameW, frameH);
    console.log('帧4位置:', 0, frameH, frameW, frameH);
};
img.src = 'assets/enemies/black_wolf.png';
