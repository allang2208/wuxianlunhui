// 在浏览器控制台运行此代码来诊断纹理问题
// 1. 检查纹理是否存在
console.log('=== 纹理诊断 ===');
const game = window.__phaserScene?.game;
if (game) {
    const textures = game.textures.list;
    const zombieTextures = [
        'enemy_zombie',
        'enemy_runner_zombie',
        'enemy_fat_zombie',
        'enemy_spitter_zombie',
        'enemy_zombie_dog'
    ];
    
    zombieTextures.forEach(key => {
        const tex = textures[key];
        if (tex) {
            console.log(`✅ ${key}: 存在`);
            console.log(`   - 帧数: ${tex.frameTotal}`);
            console.log(`   - 尺寸: ${tex.source?.[0]?.width}x${tex.source?.[0]?.height}`);
        } else {
            console.log(`❌ ${key}: 不存在`);
        }
    });
} else {
    console.log('❌ Phaser 游戏实例未找到');
}

// 2. 检查敌人 sprite 是否创建
console.log('\n=== 敌人 Sprite 诊断 ===');
if (window.__phaserScene) {
    const enemies = window.__phaserScene.enemies;
    if (enemies) {
        enemies.getChildren().forEach((sprite, i) => {
            const name = sprite.getData('enemyId') || 'unknown';
            const texture = sprite.texture?.key || 'none';
            const visible = sprite.visible;
            console.log(`敌人 ${i}: name=${name}, texture=${texture}, visible=${visible}`);
        });
    } else {
        console.log('❌ enemies 组未找到');
    }
} else {
    console.log('❌ __phaserScene 未找到');
}

// 3. 检查实体 _useStickFigure 设置
console.log('\n=== 实体 _useStickFigure 诊断 ===');
if (window.Game?.entities) {
    window.Game.entities.forEach((entity, id) => {
        if (entity.name && entity.name.toLowerCase().includes('zombie')) {
            console.log(`${entity.name}: _useStickFigure=${entity._useStickFigure}`);
        }
    });
} else {
    console.log('❌ Game.entities 未找到');
}
