// === 检查 offPC 和弹丸创建 ===
// 贴到控制台，右键点击一次

const origFireRanged = Game.player._fireRanged.bind(Game.player);
Game.player._fireRanged = function(hand) {
    if (hand === 'offhand') {
        const d = this.rangedFireData;
        const offhandSlot = d.offhandSlot || (this.weaponMode === 'weapon' ? 'offhand' : 'ring2');
        const offhandItem = this.equipments[offhandSlot];
        const offhandAttackKey = offhandItem.offhandAttackKey || 'pistolOffhand';
        const offPC = this.attacks[offhandAttackKey].config;
        console.log('offPC:', offPC);
        console.log('offPC.projectileSpeed:', offPC ? offPC.projectileSpeed : 'N/A');
        console.log('offPC.projectileRange:', offPC ? offPC.projectileRange : 'N/A');
        console.log('offPC.projectileSize:', offPC ? offPC.projectileSize : 'N/A');
        console.log('offPC.damage:', offPC ? offPC.damage : 'N/A');
        
        // 检查弹丸是否被创建
        const origResult = origFireRanged(hand);
        
        // 检查 EffectManager 中是否有新弹丸
        const projectiles = [];
        if (EffectManager.effects) {
            EffectManager.effects.forEach(e => {
                if (e.constructor && e.constructor.name === 'Projectile' && e.active) {
                    projectiles.push({ x: e.x, y: e.y, angle: e.angle, speed: e.speed, active: e.active });
                }
            });
        }
        console.log('Active Projectiles after _fireRanged:', projectiles.length);
        if (projectiles.length > 0) {
            console.log('Last projectile:', projectiles[projectiles.length - 1]);
        }
        
        return origResult;
    }
    return origFireRanged(hand);
};

console.log('✅ 诊断已注入。右键点击一次，检查 offPC 和弹丸。');
