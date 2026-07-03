// === 检查副手 swing 是否调用 _fireRanged('offhand') ===
// 贴完后右键点击一次，看控制台输出

// 1. 检查 updateWeaponAnim 的 offhand swing 阶段
const origUpdateWeaponAnim = Game.player.updateWeaponAnim.bind(Game.player);
Game.player.updateWeaponAnim = function(dt) {
    const result = origUpdateWeaponAnim(dt);
    
    if (this.offhandWeaponAnim && this.offhandWeaponAnim.state === 'swing') {
        const hasPending = this.rangedFireData && this.rangedFireData.fireOffhand;
        console.log('[SWING] offhandWeaponAnim state=swing, timer=' + this.offhandWeaponAnim.timer.toFixed(1) + 
                    ', hasPendingOffhand=' + hasPending + 
                    ', rangedFireData=' + (this.rangedFireData ? JSON.stringify(this.rangedFireData) : 'null'));
    }
    
    return result;
};

// 2. 检查 _fireRanged('offhand') 内部
const origFireRanged = Game.player._fireRanged.bind(Game.player);
Game.player._fireRanged = function(hand) {
    console.log('>>> _fireRanged(' + hand + ') called');
    console.log('    rangedFireData:', this.rangedFireData);
    
    if (hand === 'offhand') {
        const d = this.rangedFireData;
        const offhandSlot = d && d.offhandSlot ? d.offhandSlot : (this.weaponMode === 'weapon' ? 'offhand' : 'ring2');
        const offhandItem = this.equipments[offhandSlot];
        console.log('    offhandSlot:', offhandSlot, 'offhandItem:', offhandItem ? offhandItem.name : 'null');
        console.log('    d.fireOffhand:', d ? d.fireOffhand : 'N/A');
        if (offhandItem && d && d.fireOffhand) {
            console.log('    offhandHasAmmo:', this._hasAmmo(offhandSlot));
            const offhandAttackKey = offhandItem.offhandAttackKey || 'pistolOffhand';
            console.log('    offhandAttackKey:', offhandAttackKey, 'attacks[key]:', this.attacks[offhandAttackKey] ? 'exists' : 'MISSING');
            if (this.attacks[offhandAttackKey]) {
                console.log('    config:', this.attacks[offhandAttackKey].config);
            }
        }
    }
    
    return origFireRanged(hand);
};

console.log('✅ 诊断已注入。右键点击一次，检查 _fireRanged(offhand) 是否被调用。');
