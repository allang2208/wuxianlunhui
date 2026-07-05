// ============================================
// 地牢地图角色贴图排查脚本
// 复制以下内容到浏览器控制台（F12 → Console）执行
// ============================================

(function() {
    console.clear();
    console.log('========== 地牢地图角色贴图排查 ==========');

    // 1. 检查当前场景
    console.log('\n【1】当前场景:', typeof SceneManager !== 'undefined' ? SceneManager.currentScene : 'SceneManager 未定义');

    // 2. 检查 DungeonMapSystem 状态
    const dms = window.DungeonMapSystem || (typeof DungeonMapSystem !== 'undefined' ? DungeonMapSystem : null);
    if (dms) {
        console.log('DungeonMapSystem.active:', dms.active);
        console.log('DungeonMapSystem.state:', dms.state);
    } else {
        console.log('DungeonMapSystem: 未定义（未挂载到 window）');
    }

    // 3. 检查 Phaser 场景
    const scene = window.__phaserScene;
    if (!scene) {
        console.log('\n【2】__phaserScene: 未定义！Phaser 场景未挂载到 window');
        console.log('尝试通过 PhaserGame.scene 获取:', typeof PhaserGame !== 'undefined' ? PhaserGame.scene : 'PhaserGame 未定义');
        return;
    }
    console.log('\n【2】Phaser 场景已找到:', scene.scene ? scene.scene.key : '无 key');

    // 4. 检查 playerSprite
    const ps = scene.playerSprite;
    console.log('\n【3】playerSprite:');
    if (ps) {
        console.log('  - visible:', ps.visible);
        console.log('  - active:', ps.active);
        console.log('  - position:', ps.x, ps.y);
        console.log('  - alpha:', ps.alpha);
        console.log('  - renderFlags:', ps.renderFlags);
    } else {
        console.log('  - 未定义！');
    }

    // 5. 检查 weaponSprite
    const ws = scene.weaponSprite;
    console.log('\n【4】weaponSprite:');
    if (ws) {
        console.log('  - visible:', ws.visible);
        console.log('  - active:', ws.active);
        console.log('  - position:', ws.x, ws.y);
    } else {
        console.log('  - 未定义');
    }

    // 6. 检查 offhandWeaponSprite
    const ows = scene.offhandWeaponSprite;
    console.log('\n【5】offhandWeaponSprite:');
    if (ows) {
        console.log('  - visible:', ows.visible);
        console.log('  - active:', ows.active);
        console.log('  - position:', ows.x, ows.y);
    } else {
        console.log('  - 未定义');
    }

    // 7. 检查 Phaser 场景中是否还有其他可能显示角色的精灵
    console.log('\n【6】Phaser 场景中所有子对象（children）:');
    if (scene.children) {
        const sprites = scene.children.list.filter(c => c.type === 'Sprite' || c.type === 'Image');
        console.log('  Sprite/Image 总数:', sprites.length);
        sprites.forEach((s, i) => {
            console.log(`  [${i}] ${s.texture ? s.texture.key : 'no-texture'} visible=${s.visible} pos=(${Math.round(s.x)},${Math.round(s.y)})`);
        });
    }

    // 8. 检查 player.js 中是否在用 Canvas 渲染角色
    console.log('\n【7】Player 的 _usePhaserSprite 标记:');
    if (Game && Game.player) {
        console.log('  Game.player._usePhaserSprite:', Game.player._usePhaserSprite);
    } else {
        console.log('  Game.player 未定义');
    }

    // 9. 提供一键手动隐藏按钮
    console.log('\n========== 手动隐藏按钮 ==========');
    console.log('执行以下代码手动隐藏所有角色贴图：');
    console.log(`
if (window.__phaserScene) {
    const s = window.__phaserScene;
    if (s.playerSprite) s.playerSprite.setVisible(false);
    if (s.weaponSprite) s.weaponSprite.setVisible(false);
    if (s.offhandWeaponSprite) s.offhandWeaponSprite.setVisible(false);
    console.log('手动隐藏完成');
}
`);

    // 10. 检查 GameScene.update 是否被调用
    console.log('========== 排查 GameScene.update 是否生效 ==========');
    console.log('在控制台执行以下代码，持续 3 秒监听 update 的隐藏逻辑：');
    console.log(`
let count = 0;
const interval = setInterval(() => {
    count++;
    const scene = window.__phaserScene;
    const dms = window.DungeonMapSystem || (typeof DungeonMapSystem !== 'undefined' ? DungeonMapSystem : null);
    const isMap = SceneManager.currentScene === 'scene6' && dms && dms.active && dms.state === 'map';
    console.log('Tick', count, '| scene6=', SceneManager.currentScene === 'scene6', '| dms.active=', dms ? dms.active : null, '| state=', dms ? dms.state : null, '| isMap=', isMap, '| playerSprite.visible=', scene ? scene.playerSprite.visible : 'no scene');
    if (count >= 6) clearInterval(interval);
}, 500);
`);

})();
