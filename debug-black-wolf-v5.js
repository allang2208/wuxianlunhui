// === 黑狼排查 v5：让 sprite 变得明显可见 ===
// 运行这段代码后，黑狼会变大、变红、出现在玩家正中心

if (Game.player) {
    const w = new BlackWolf(Game.player.x, Game.player.y - 100);
    Game.entities.set('test_wolf_visible', w);
    const dummy = document.createElement('canvas').getContext('2d');
    w.render(dummy);
    
    if (w._phaserSprite) {
        const s = w._phaserSprite;
        // 变大 3 倍
        s.setScale(0.3);
        // 变红色（非常显眼）
        s.setTint(0xff0000);
        // 确保在最顶层
        s.setDepth(9999);
        console.log('已生成明显可见的黑狼！');
        console.log('位置:', s.x, s.y, '| 尺寸:', s.displayWidth, 'x', s.displayHeight, '| depth:', s.depth);
    }
}

// 检查已有的所有 wolf sprite
console.log('\n=== 所有 wolf sprite 汇总 ===');
window.__phaserScene.children.list.filter(c => c.name && c.name.includes('wolf')).forEach((s, i) => {
    console.log('  [', i, ']', s.name, 'visible:', s.visible, 'scale:', s.scaleX.toFixed(4), 'tint:', s.tintTopLeft ? '0x'+s.tintTopLeft.toString(16) : 'none', 'pos:', Math.round(s.x), Math.round(s.y));
});
