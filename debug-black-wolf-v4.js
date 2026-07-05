// === 黑狼排查 v4（强制调用 render 创建 sprite）===

// 1. 先在玩家位置生成黑狼
if (Game.player) {
    const w = new BlackWolf(Game.player.x, Game.player.y - 100);
    Game.entities.set('test_wolf_render', w);
    console.log('生成黑狼在', w.x, w.y);
    
    // 强制调用 render 创建 Phaser sprite
    const dummyCtx = document.createElement('canvas').getContext('2d');
    w.render(dummyCtx);
    console.log('render 后 _phaserSprite:', w._phaserSprite ? '存在' : '不存在');
    
    if (w._phaserSprite) {
        const s = w._phaserSprite;
        console.log('sprite visible:', s.visible, 'alpha:', s.alpha, 'scale:', s.scaleX, s.scaleY);
        console.log('sprite pos:', s.x, s.y, 'displayW:', s.displayWidth, 'displayHeight:', s.displayHeight);
        console.log('sprite frame:', s.frame.name, 'texture:', s.texture.key);
        console.log('sprite active:', s.active, 'depth:', s.depth);
        
        // 检查是否在 enemies group 中
        const inGroup = window.__phaserScene.enemies.contains(s);
        console.log('在 enemies group 中:', inGroup);
    }
}

// 2. 列出所有场景中的 sprite（不管名字）
console.log('\n=== 所有场景 sprite ===');
const allSprites = window.__phaserScene.children.list.filter(c => c.type === 'Sprite');
console.log('总数:', allSprites.length);
allSprites.forEach((s, i) => {
    console.log('  [', i, ']', 'texture:', s.texture.key, 'visible:', s.visible, 'scale:', s.scaleX.toFixed(4), 'pos:', Math.round(s.x), Math.round(s.y));
});

// 3. 检查是否有 enemy_black_wolf 纹理的 sprite
const wolfTexSprites = allSprites.filter(s => s.texture.key === 'enemy_black_wolf');
console.log('\n=== enemy_black_wolf 纹理的 sprite ===');
console.log('数量:', wolfTexSprites.length);
wolfTexSprites.forEach(s => {
    console.log('  visible:', s.visible, 'scale:', s.scaleX, s.scaleY, 'pos:', s.x, s.y, 'alpha:', s.alpha, 'frame:', s.frame.name);
});

// 4. 检查 Phaser enemies group
console.log('\n=== enemies group ===');
const groupChildren = window.__phaserScene.enemies.getChildren();
console.log('group 数量:', groupChildren.length);
