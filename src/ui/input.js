        export const Input = {
            keys: new Set(),
            mouse: { x: 0, y: 0, leftDown: false, rightDown: false, leftPressed: false, rightPressed: false },
            init() {
                window.addEventListener('keydown', e => { this.keys.add(e.code); this.handleKey(e.code); });
                window.addEventListener('keyup', e => this.keys.delete(e.code));
                window.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
                window.addEventListener('mousedown', e => {
                    const isSystemUI = e.target.closest('.system-panel, .panel-overlay, .side-menu, .back-menu-btn, .menu-btn');
                    if (e.button === 0) { this.mouse.leftDown = true; if (!isSystemUI) this.mouse.leftPressed = true; }
                    if (e.button === 2) { this.mouse.rightDown = true; if (!isSystemUI) this.mouse.rightPressed = true; }
                });
                window.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.leftDown = false; if (e.button === 2) this.mouse.rightDown = false; });
                window.addEventListener('contextmenu', e => e.preventDefault());
            },
            handleKey(code) {
                if (code === CONFIG.KEYS.MENU) { if (SystemUI.isOpen) SystemUI.close(); else Game.toMenu(); return; }
                if (SystemUI.isOpen) {
                    // 面板打开时：允许Tab切换快捷键，允许F切换武器，允许Z范围拾取，其他按键拦截
                    if (code === CONFIG.KEYS.INVENTORY || code === CONFIG.KEYS.EQUIP || code === 'KeyB') { SystemUI.toggle('equip'); return; }
                    if (code === CONFIG.KEYS.SKILL) { SystemUI.toggle('skill'); return; }
                    if (code === CONFIG.KEYS.CODEX) { SystemUI.toggle('codex'); return; }
                    if (code === 'KeyF' && Game.player) { Game.player.switchWeaponMode(); return; }
                    if (code === 'KeyZ' && Game.isRunning) { Game._pickupNearbyFlag = true; return; }
                    return; // 其他按键在面板打开时忽略
                }
                if (code === CONFIG.KEYS.INVENTORY) SystemUI.toggle('equip');
                if (code === CONFIG.KEYS.EQUIP || code === 'KeyB') SystemUI.toggle('equip');
                if (code === CONFIG.KEYS.SKILL) SystemUI.toggle('skill');
                if (code === CONFIG.KEYS.CODEX) SystemUI.toggle('codex');
                if (code === CONFIG.KEYS.SKILL_Q || code === CONFIG.KEYS.SKILL_E || code === CONFIG.KEYS.SKILL_R) QuickBar.useSlot(code);
                if (code === CONFIG.KEYS.ITEM_1 || code === CONFIG.KEYS.ITEM_2 || code === CONFIG.KEYS.ITEM_3 || code === CONFIG.KEYS.ITEM_4) QuickBar.useSlot(code);
                if (code === 'KeyF' && Game.player) {
                    Game.player.switchWeaponMode();
                }
                if (code === 'KeyZ' && Game.isRunning) {
                    Game._pickupNearbyFlag = true;
                }
            },
            update() { this.mouse.leftPressed = false; this.mouse.rightPressed = false; },
            isPressed(key) { return this.keys.has(key); },
            getMovement() {
                let dx = 0, dy = 0;
                if (this.isPressed(CONFIG.KEYS.W)) dy -= 1;
                if (this.isPressed(CONFIG.KEYS.S)) dy += 1;
                if (this.isPressed(CONFIG.KEYS.A)) dx -= 1;
                if (this.isPressed(CONFIG.KEYS.D)) dx += 1;
                if (dx !== 0 && dy !== 0) { const len = Math.sqrt(dx*dx + dy*dy); dx /= len; dy /= len; }
                return { x: dx, y: dy };
            },
            isSprint() { return this.isPressed(CONFIG.KEYS.SHIFT); }
        };
