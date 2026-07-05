// === 黑狼排查代码 v3（修复 getFrameAt 错误）===
// 在浏览器控制台运行

// 1. 检查纹理
const tex = window.__phaserScene.textures.get('enemy_black_wolf');
console.log('纹理:', tex ? '存在' : '不存在', '| type:', tex.type, '| totalFrames:', Object.keys(tex.frames).length);
console.log('frames 键:', Object.keys(tex.frames).slice(0, 10));

// 2. 检查所有敌人 sprite
const enemies = window.__phaserScene.enemies.getChildren();
console.log('所有 Phaser 敌人数量:', enemies.length);
enemies.forEach((s, i) => {
    console.log('  [', i, ']', 'name:', s.name, '| visible:', s.visible, '| scale:', s.scaleX.toFixed(4), s.scaleY.toFixed(4), '| pos:', Math.round(s.x), Math.round(s.y), '| alpha:', s.alpha, '| frame:', s.frame.name, '| displayW:', s.displayWidth.toFixed(2), 'displayH:', s.displayHeight.toFixed(2));
});

// 3. 查找所有名字包含 wolf 的 sprite
const wolfSprites = window.__phaserScene.children.list.filter(c => c.name && c.name.includes('wolf'));
console.log('包含 wolf 的 sprite 数量:', wolfSprites.length);
wolfSprites.forEach(s => {
    console.log('  name:', s.name, '| visible:', s.visible, '| active:', s.active, '| scale:', s.scaleX.toFixed(4), '| pos:', Math.round(s.x), Math.round(s.y), '| alpha:', s.alpha, '| frame:', s.frame.name, '| texture:', s.texture.key);
});

// 4. 检查逻辑层黑狼
const wolf = Game.entities.get('test_black_wolf') || Game.entities.get('test_wolf_v2') || Game.entities.get('test_wolf_v3');
console.log('逻辑层黑狼:', wolf ? '存在' : '不存在');
if (wolf) {
    console.log('  pos:', wolf.x, wolf.y, '| active:', wolf.active, '| hp:', wolf.hp);
    console.log('  _phaserSprite:', wolf._phaserSprite ? '有' : '无', '| _phaserSprite.active:', wolf._phaserSprite?.active);
    console.log('  _animFrame:', wolf._animFrame);
}

// 5. 强制在玩家正上方生成
if (Game.player) {
    const w = new BlackWolf(Game.player.x, Game.player.y - 150);
    Game.entities.set('test_wolf_now', w);
    console.log('已在玩家上方150px生成黑狼');
}
