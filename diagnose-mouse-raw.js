// === 简单诊断：直接检查浏览器原始鼠标事件 ===
// 粘贴后按住右键，看是否触发事件

window.addEventListener('mousedown', function(e) {
    console.log('RAW mousedown event:', 'button=' + e.button, 'target=' + e.target.tagName, 'class=' + e.target.className);
    console.log('  Input.mouse BEFORE mousedown:', 'rightDown=' + Input.mouse.rightDown, 'rightPressed=' + Input.mouse.rightPressed);
    setTimeout(function() {
        console.log('  Input.mouse AFTER mousedown:', 'rightDown=' + Input.mouse.rightDown, 'rightPressed=' + Input.mouse.rightPressed);
    }, 10);
}, true);

window.addEventListener('mouseup', function(e) {
    console.log('RAW mouseup event:', 'button=' + e.button);
    console.log('  Input.mouse BEFORE mouseup:', 'rightDown=' + Input.mouse.rightDown);
}, true);

window.addEventListener('contextmenu', function(e) {
    console.log('RAW contextmenu event (should be prevented):', e.defaultPrevented);
}, true);

console.log('✅ 鼠标事件监听器已安装。现在按住右键，看是否有 RAW mousedown 输出。');
