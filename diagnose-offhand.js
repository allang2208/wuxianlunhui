// === 副手P4040诊断脚本 === 直接复制到浏览器控制台运行

// 1. 监听右键点击时 Player.update 中的关键状态
const origUpdate = Game.player.update.bind(Game.player);
let frameCount = 0;
Game.player.update = function(dt, entities) {
    frameCount++;
    const mouseWorld = window.Renderer ? Renderer.screenToWorld(Input.mouse.x, Input.mouse.y) : {x:0,y:0};
    const currentSlot = this.weaponMode;
    const currentItem = this.equipments[currentSlot];
    const offhandSlot = currentSlot === 'weapon' ? 'offhand' : 'ring2';
    const offhandItem = this.equipments[offhandSlot];
    const isPistol = currentItem && (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol');
    const isDualWield = offhandItem && offhandItem.weaponType === 'pistol' && !this._useOffhand;
    
    // 只在右键按下时打印
    if (Input.mouse.rightPressed || Input.mouse.rightDown) {
        console.log('=== 右键帧 #' + frameCount + ' ===');
        console.log('rightPressed:', Input.mouse.rightPressed, 'rightDown:', Input.mouse.rightDown);
        console.log('weaponMode:', currentSlot, 'effectiveItem:', currentItem ? currentItem.name : null);
        console.log('offhandItem:', offhandItem ? offhandItem.name : null);
        console.log('isPistol:', isPistol, 'isDualWield:', isDualWield);
        console.log('offhandHasAmmo:', this._hasAmmo ? this._hasAmmo(offhandSlot) : 'N/A');
        console.log('offhandReloading:', this._isReloading ? this._isReloading(offhandSlot) : 'N/A');
        console.log('weaponSwitchCooldown:', this.weaponSwitchCooldown);
        console.log('rangedFireData BEFORE update:', this.rangedFireData);
        console.log('offhandWeaponAnim BEFORE:', this.offhandWeaponAnim ? this.offhandWeaponAnim.state : 'N/A');
    }
    
    const result = origUpdate(dt, entities);
    
    if (Input.mouse.rightPressed || Input.mouse.rightDown) {
        console.log('rangedFireData AFTER update:', this.rangedFireData);
        console.log('offhandWeaponAnim AFTER:', this.offhandWeaponAnim ? this.offhandWeaponAnim.state : 'N/A');
    }
    
    return result;
};

// 2. 拦截 _fireRanged 查看入口
const origFireRanged = Game.player._fireRanged.bind(Game.player);
Game.player._fireRanged = function(hand) {
    console.log('>>> _fireRanged called hand=' + hand, 'rangedFireData=', this.rangedFireData);
    const d = this.rangedFireData;
    if (hand === 'offhand') {
        console.log('  offhandSlot:', d ? d.offhandSlot : 'N/A', 'fireOffhand:', d ? d.fireOffhand : 'N/A');
    }
    return origFireRanged(hand);
};

// 3. 拦截 updateWeaponAnim 的 offhand swing
const origUpdateWeaponAnim = Game.player.updateWeaponAnim.bind(Game.player);
Game.player.updateWeaponAnim = function(dt) {
    const beforeOffhand = this.offhandWeaponAnim ? { ...this.offhandWeaponAnim } : null;
    const result = origUpdateWeaponAnim(dt);
    const afterOffhand = this.offhandWeaponAnim ? { ...this.offhandWeaponAnim } : null;
    
    if (beforeOffhand && afterOffhand && beforeOffhand.state !== afterOffhand.state) {
        console.log('offhandWeaponAnim state change:', beforeOffhand.state, '->', afterOffhand.state, 'rangedFireData:', this.rangedFireData);
    }
    
    return result;
};

console.log('✅ 诊断脚本已注入。现在按右键，观察控制台输出。');
