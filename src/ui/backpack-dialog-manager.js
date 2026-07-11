import { Input } from '../ui/input.js';
// Backpack Dialog Manager - Extracted from EquipManager
// Handles split dialog and backpack full notifications

export const BackpackDialogManager = {
    backpackItems: null,
    callbacks: {},

    init(options) {
        this.backpackItems = options.backpackItems || null;
        this.maxBackpackSlots = options.maxBackpackSlots || 10;
        this.callbacks = {
            addToBackpack: options.addToBackpack || (() => {}),
            updateInventorySlots: options.updateInventorySlots || (() => {}),
            showBackpackFullNotice: options.showBackpackFullNotice || (() => {})
        };
    },

    // 显示背包已满的系统提示（位于屏幕上方，与场景切换提示风格一致）
    _showBackpackFullNotice() {
        let el = document.getElementById('backpackFullNotice');
        if (el) { el.remove(); }
        el = document.createElement('div');
        el.id = 'backpackFullNotice';
        // 使用与场景切换提示一致的样式和位置（top:210px，居中，大字体）
        el.style.cssText = 'position:fixed;top:210px;left:50%;transform:translateX(-50%);color:#d4c5a9;font-size:48px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,0.8);z-index:5000;pointer-events:none;animation:sceneLabelFade 3s ease-out forwards;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;';
        el.textContent = '背包已满！';
        document.body.appendChild(el);
        setTimeout(() => { if (el && el.parentNode) el.remove(); }, 3000);
    },
    
    _showSplitDialog(item, slotIdx) {
        const self = this;
        // Remove existing dialog if any
        const existing = document.getElementById('splitDialog');
        if (existing) existing.remove();
        
        const dialog = document.createElement('div');
        dialog.id = 'splitDialog';
        dialog.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:320px;background:linear-gradient(135deg,rgba(45,40,35,0.98),rgba(35,30,25,0.99));border:2px solid #7a6a5a;border-radius:12px;padding:20px;z-index:10000;box-shadow:0 8px 32px rgba(0,0,0,0.6);font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;';
        dialog.innerHTML = `
            <div style="color:#d4c5a9;font-size:18px;font-weight:700;margin-bottom:16px;text-align:center;">拆分物品</div>
            <div style="color:#8a7d6b;font-size:14px;margin-bottom:12px;text-align:center;">${item.name} (堆叠: ${item.stack})</div>
            <div style="margin-bottom:12px;">
                <input type="range" id="splitSlider" min="1" max="${item.stack - 1}" value="${Math.floor(item.stack / 2)}" style="width:100%;cursor:pointer;">
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
                <span style="color:#8a7d6b;font-size:13px;">数量:</span>
                <input type="number" id="splitInput" min="1" max="${item.stack - 1}" value="${Math.floor(item.stack / 2)}" style="width:80px;padding:6px 10px;background:rgba(30,30,30,0.8);border:1px solid #5a4d3f;border-radius:6px;color:#d4c5a9;font-size:14px;text-align:center;">
                <span style="color:#6b5d4f;font-size:12px;">/ ${item.stack}</span>
            </div>
            <div style="display:flex;gap:10px;">
                <button id="splitConfirmBtn" style="flex:1;padding:8px;background:#5a7a4a;color:#d4c5a9;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">确认</button>
                <button id="splitCancelBtn" style="flex:1;padding:8px;background:#7a5a4a;color:#d4c5a9;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">取消</button>
            </div>
        `;
        document.body.appendChild(dialog);
        
        const slider = document.getElementById('splitSlider');
        const input = document.getElementById('splitInput');
        const confirmBtn = document.getElementById('splitConfirmBtn');
        const cancelBtn = document.getElementById('splitCancelBtn');
        
        slider.oninput = () => { input.value = slider.value; };
        input.oninput = () => { 
            const val = Math.min(item.stack - 1, Math.max(1, parseInt(input.value) || 1));
            input.value = val; slider.value = val; 
        };
        confirmBtn.onclick = () => {
            const count = parseInt(input.value);
            if (count >= 1 && count < item.stack) {
                if (self.backpackItems.length >= self.maxBackpackSlots) {
                    self._showBackpackFullNotice();
                    dialog.remove(); return;
                }
                const usedSlots = new Set(self.backpackItems.map(i => i.slot));
                let newSlot = 0;
                while (usedSlots.has(newSlot) && newSlot < self.maxBackpackSlots) newSlot++;
                if (newSlot >= self.maxBackpackSlots) {
                    self._showBackpackFullNotice();
                    dialog.remove(); return;
                }
                item.stack -= count;
                const newItem = JSON.parse(JSON.stringify(item));
                newItem.stack = count;
                newItem.slot = newSlot;
                self.backpackItems.push(newItem);
                self.callbacks.updateInventorySlots();
            }
            dialog.remove();
        };
        cancelBtn.onclick = () => { dialog.remove(); };
    }
};
