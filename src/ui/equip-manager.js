        export const EquipManager = {
            TEST_EQUIPMENTS: {
                helmet: { name: '新手布帽', type: '头盔', icon: '⛑', iconImage: 'assets/icons/helmet_icon.png', equipSlot: 'helmet', stats: [{ name: '物理防御', value: '+2', pos: true }, { name: '最大生命', value: '+15', pos: true }], desc: '一件破旧的头巾', level: 1, rarity: 'common' },
                necklace: { name: '粗制项链', type: '项链', icon: '📿', iconImage: '', equipSlot: 'necklace', stats: [{ name: '最大生命值', value: '+10', pos: true }, { name: '法力回复', value: '+1/秒', pos: true }], desc: '用绳子串起来的小石头', level: 1, rarity: 'common' },
                weapon: { weaponId: 'weapon1', name: '生锈的长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/1-rusty_sword_macro.png', equipImage: 'assets/weapons/1-rusty_sword_euip.png', category: 'weapon_melee', equipSlot: 'weapon', stats: [{ name: '物理攻击', value: '12-18' }, { name: '暴击率', value: '+3%', pos: true }], desc: '一把锈迹斑斑的旧剑', level: 1, rarity: 'common', weaponType: 'sword' },
                armor: { name: '旧皮甲', type: '盔甲', icon: '🛡', iconImage: 'assets/icons/armor_icon.png', equipSlot: 'armor', stats: [{ name: '物理防御', value: '+5', pos: true }, { name: '最大生命', value: '+25', pos: true }, { name: '韧性', value: '+2', pos: true }], desc: '不知道传了多少手的皮甲', level: 1, rarity: 'common' },
                offhand: { name: '旧木盾', type: '副手', icon: '🛡', iconImage: 'assets/icons/shield_icon.png', category: 'armor', weaponCategory: 'offhand', equipSlot: 'offhand', stats: [{ name: '物理防御', value: '+3', pos: true }, { name: '格挡率', value: '+5%', pos: true }], desc: '用木板拼成的盾牌', level: 1, rarity: 'common' },
                weapon2: { weaponId: 'weapon3', name: '训练用弓', type: '弓', icon: '🏹', iconImage: 'assets/icons/bow_icon.png', category: 'weapon_ranged', rarity: 'common', level: 1, weaponCategory: 'mainhand', weaponType: 'bow', weaponAsset: { framePrefix: 'assets/weapons/bow_frame_', frameCount: 8, framePad: 2 }, stats: [{ name: '物理攻击', value: '8-14' }, { name: '射程', value: '600' }], desc: '一把简陋的弓，勉强能射出箭，适合初学者练习', equipSlot: 'weapon2' },
                ring1: { name: '铜戒指', type: '戒指', icon: '💍', iconImage: 'assets/icons/ring_icon.png', equipSlot: 'ring1', stats: [{ name: '幸运', value: '+1', pos: true }, { name: '金币获取', value: '+5%', pos: true }], desc: '一枚生锈的铜戒指', level: 1, rarity: 'common' },
                gloves: { name: '皮手套', type: '手套', icon: '🧤', iconImage: 'assets/icons/gloves_icon.png', equipSlot: 'gloves', stats: [{ name: '物理攻击', value: '+2', pos: true }, { name: '攻击速度', value: '+3%', pos: true }], desc: '保护双手的皮手套', level: 1, rarity: 'common' },
                ring2: { name: '铁戒指', type: '戒指', icon: '💍', iconImage: 'assets/icons/ring_icon.png', equipSlot: 'ring2', stats: [{ name: '力量', value: '+1', pos: true }, { name: '物理攻击', value: '+2', pos: true }], desc: '简单的铁戒指', level: 1, rarity: 'common' },
                belt: { name: '腰带', type: '腰带', icon: '⛓', iconImage: 'assets/icons/belt_icon.png', equipSlot: 'belt', stats: [{ name: '最大体力', value: '+5', pos: true }, { name: '负重', value: '+10', pos: true }], desc: '一根普通的腰带', level: 1, rarity: 'common' },
                boots: { name: '旧皮靴', type: '靴子', icon: '👢', iconImage: 'assets/icons/boot_icon.png', equipSlot: 'boots', stats: [{ name: '移动速度', value: '+5%', pos: true }, { name: '闪避', value: '+2%', pos: true }], desc: '磨破了的旧靴子', level: 1, rarity: 'common' }
            },
            TEST_BACKPACK_ITEMS: [
                { slot: 0, name: '治疗药水', type: '消耗品', icon: '🧪', category: 'consumable', stats: [{ name: '恢复生命', value: '+30' }], desc: '一瓶红色的药水，味道有点甜', stack: 5 },
                { slot: 1, name: '魔力药水', type: '消耗品', icon: '💧', category: 'consumable', stats: [{ name: '恢复魔法', value: '+25' }], desc: '一瓶蓝色的药水，冒着冷气', stack: 3 }
            ],
            init(player) {
                this.player = player;
                // 初始化背包数组
                if (!this.backpackItems || this.backpackItems.length === 0) {
                    this.backpackItems = JSON.parse(JSON.stringify(this.TEST_BACKPACK_ITEMS));
                }
                // 深拷贝 TEST_EQUIPMENTS，避免多个玩家共享引用
                if (player.equipments) {
                    const copy = JSON.parse(JSON.stringify(this.TEST_EQUIPMENTS));
                    Object.assign(player.equipments, copy);
                }
                // 加载 weapon2 槽的武器状态
                const w2 = player.equipments && player.equipments.weapon2;
                if (w2 && w2.bowFrames) {
                    const frames = [];
                    for (let i = 0; i < w2.bowFrames.length; i++) {
                        const img = new Image(); img.src = w2.bowFrames[i]; frames.push(img);
                    }
                    player.equippedBowFrames = frames;
                    player.equippedRangedType = 'bow';
                } else if (w2 && w2.weaponAsset && w2.weaponAsset.framePrefix) {
                    // 从 weaponAsset 加载弓帧动画
                    const frames = [];
                    for (let i = 1; i <= w2.weaponAsset.frameCount; i++) {
                        const num = String(i).padStart(w2.weaponAsset.framePad || 2, '0');
                        const img = new Image(); img.src = w2.weaponAsset.framePrefix + num + '.png'; frames.push(img);
                    }
                    player.equippedBowFrames = frames;
                    player.equippedRangedType = 'bow';
                } else if (w2 && (w2.rangedType === 'pistol' || w2.weaponType === 'pistol')) {
                    player.equippedRangedType = 'pistol';
                }
                // 同步当前武器栏的近战武器贴图
                const currentWeapon = player.equipments[player.weaponMode];
                if (currentWeapon && currentWeapon.equipImage) {
                    player.meleeImage.src = currentWeapon.equipImage;
                }
                // 应用当前装备的技能覆盖
                if (player._applySkillOverrides) {
                    player._applySkillOverrides(currentWeapon);
                }
                // ===== FIX 1: 先创建背包格子，再更新显示 =====
                const grid = document.getElementById('inventoryGrid');
                if (grid && grid.children.length === 0) {
                    for (let i = 0; i < 36; i++) {
                        const cell = document.createElement('div');
                        cell.className = 'inv-cell';
                        cell.dataset.slot = i;
                        grid.appendChild(cell);
                    }
                }
                this.updateEquipSlots();
                this.updateInventorySlots();
                this.bindEquipTooltip();
                this.bindInventoryTooltip();
                this.setupDragAndDrop();
            },
            // === 触发装备动画 ===
            triggerEquipFlash(slotKey) {
                if (!slotKey) return;
                const slot = document.querySelector(`.equip-grid .diablo-slot[data-slot="${slotKey}"]`);
                if (!slot) return;
                slot.classList.remove('equip-flash', 'equip-pop');
                void slot.offsetWidth; // 强制重绘，重置动画
                slot.classList.add('equip-flash');
                setTimeout(() => slot.classList.remove('equip-flash'), 650);
            },
            // === 触发背包格子动画 ===
            triggerBackpackFlash(slotIdx) {
                const cell = document.querySelector(`.gear-inventory-col .inv-cell[data-slot="${slotIdx}"]`);
                if (!cell) return;
                cell.classList.remove('equip-pop');
                void cell.offsetWidth;
                cell.classList.add('equip-pop');
                setTimeout(() => cell.classList.remove('equip-pop'), 550);
            },
            /** 设置拖放事件 */
            setupDragAndDrop() {
                this._dragSrc = null;
                // === 装备栏事件委托（所有槽位统一处理，包括空槽位） ===
                const equipGrid = document.querySelector('.equip-grid');
                if (equipGrid) {
                    equipGrid.ondragover = function(e) { e.preventDefault(); };
                    equipGrid.ondragenter = function(e) {
                        const slot = e.target.closest('.diablo-slot');
                        if (slot) slot.classList.add('drag-over');
                    };
                    equipGrid.ondragleave = function(e) {
                        const slot = e.target.closest('.diablo-slot');
                        if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove('drag-over');
                    };
                    const self = this;
                    equipGrid.ondrop = function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const slot = e.target.closest('.diablo-slot');
                        document.querySelectorAll('.equip-grid .diablo-slot').forEach(s => s.classList.remove('drag-over'));
                        self._dropHandled = true;
                        if (!slot) return;
                        const src = self._dragSrc;
                        if (!src || src.slot === slot.dataset.slot) return;
                        self.handleDrop(src, 'equip', slot.dataset.slot);
                        self._dragSrc = null;
                    };
                }
                // 一次性绑定所有装备栏和背包格子的拖放事件
                document.querySelectorAll('.diablo-slot, .inv-cell').forEach(cell => {
                    this.bindDragToCell(cell);
                });
                // 绑定画布丢弃事件：拖到游戏画面上 = 扔到地上
                this.bindCanvasDiscard();
            },
            /** 清除玩家手上持有的武器状态（与 loadWeaponAssets 逆操作对应）
             *  卸下 weapon（武器栏1）或 weapon2（武器栏2）槽后同步清除手上状态
             */
            _clearWeaponState(slotKey) {
                const player = this.player;
                if (!player) return;
                // 新设计：weaponMode 只是当前使用的栏位，不区分近战/远程
                // 卸下装备时，如果当前正在使用这个栏位，尝试切换到另一个有装备的栏位
                if (player.weaponMode === slotKey) {
                    const otherSlot = slotKey === 'weapon' ? 'weapon2' : 'weapon';
                    const otherItem = player.equipments[otherSlot];
                    if (otherItem && otherItem.name) {
                        player.weaponMode = otherSlot;
                    }
                    // 如果另一栏位也没装备，保持原值（空手状态）
                }
                // 根据当前 weaponMode 的装备重新同步视觉状态
                const currentItem = player.equipments[player.weaponMode];
                if (currentItem && currentItem.name) {
                    // 有装备，重新设置状态
                    if (currentItem.equipImage) {
                        player.meleeImage.src = currentItem.equipImage;
                    }
                    if (currentItem.bowFrames || (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix)) {
                        const frames = [];
                        if (currentItem.bowFrames) {
                            for (let i = 0; i < currentItem.bowFrames.length; i++) { const im = new Image(); im.src = currentItem.bowFrames[i]; frames.push(im); }
                        } else if (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix) {
                            for (let i = 1; i <= currentItem.weaponAsset.frameCount; i++) {
                                const num = String(i).padStart(currentItem.weaponAsset.framePad || 2, '0');
                                const im = new Image(); im.src = currentItem.weaponAsset.framePrefix + num + '.png'; frames.push(im);
                            }
                        }
                        player.equippedBowFrames = frames;
                        player.equippedRangedType = 'bow';
                    } else if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') {
                        player.equippedRangedType = 'pistol';
                    } else if (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword') {
                        player.hasMeleeWeapon = true;
                    }
                } else {
                    // 空手状态：清空所有武器视觉状态
                    player.hasMeleeWeapon = false;
                    player.equippedRangedType = null;
                    player.equippedBowFrames = null;
                    player.meleeImage.src = 'assets/weapons/1-rusty_sword_euip.png';
                }
                player.weaponAnim.state = 'idle';
                player.weaponAnim.timer = 0;
                player.weaponAnim.nextSpin = Date.now() + 150; // 触发待机动画2（旋转动画）
                // 夜与火之剑：禁用特殊攻击图标
                if (!currentItem || currentItem.weaponId !== 'weapon5') {
                    QuickBar.disableSpecialAttack();
                }
            },
            /** 执行丢弃物品到地上的核心逻辑 */
            _doDiscard() {
                const src = this._dragSrc;
                if (!src || !Game.player) return false;
                let item = null;
                if (src.type === 'inventory') {
                    const idx = parseInt(src.slot);
                    item = this.backpackItems.find(i => i.slot === idx);
                    if (item) this.backpackItems = this.backpackItems.filter(i => i.slot !== idx);
                } else if (src.type === 'equip') {
                    item = Game.player.equipments[src.slot];
                    if (item) {
                        Game.player.equipments[src.slot] = null;
                        // 同步清除手上武器状态
                        this._clearWeaponState(src.slot);
                        // 清除技能覆盖（如果丢弃的是当前武器栏的装备）
                        if (src.slot === Game.player.weaponMode && Game.player._clearSkillOverrides) {
                            Game.player._clearSkillOverrides();
                            // 刷新技能栏显示
                            if (typeof SkillManager !== 'undefined' && SkillManager.renderSkillGrid) {
                                SkillManager.renderSkillGrid();
                            }
                        }
                    }
                }
                if (item) {
                    const dropDist = 60 + Math.random() * 40;
                    const dropAngle = Game.player.rotation + (Math.random() - 0.5) * 0.5;
                    const dropX = Game.player.x + Math.cos(dropAngle) * dropDist;
                    const dropY = Game.player.y + Math.sin(dropAngle) * dropDist;
                    Game.dropItem(dropX, dropY, item);
                    EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 30, '已丢弃: ' + item.name));
                    this.updateEquipSlots();
                    this.updateInventorySlots();
                    this._dragSrc = null;
                    return true;
                }
                return false;
            },
            /** 检查鼠标位置是否在红线区域（游戏画面内，不含右侧面板） */
            _isInGameArea(clientX) {
                const panel = document.getElementById('systemPanel');
                // 面板未打开时，整个屏幕都是游戏区域
                if (!panel || !panel.classList.contains('active')) return true;
                // 面板打开时，获取面板左边界（屏幕宽度的 55% 处，因为面板宽 45vw 从右边推出）
                const panelLeft = window.innerWidth * 0.55;
                return clientX < panelLeft;
            },
            /** 绑定画布丢弃：拖放到游戏画面区域 = 扔出物品
             * 采用 drop-标记法：dragstart 时标记 _dropHandled=false
             * 任何成功的 drop（到面板格子）标记 _dropHandled=true
             * dragend 时如果 _dropHandled 仍为 false，说明 drop 到游戏区域，执行丢弃
             */
            bindCanvasDiscard() {
                const self = this;
                // === 丢弃区域：drop 到这些元素上 = 执行丢弃 ===
                const canvas = document.getElementById('gameCanvas');
                if (canvas) {
                    canvas.ondragover = function(e) { e.preventDefault(); };
                    canvas.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true;
                        self._doDiscard();
                    };
                }
                const overlay = document.getElementById('panelOverlay');
                if (overlay) {
                    overlay.ondragover = function(e) { e.preventDefault(); };
                    overlay.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true;
                        self._doDiscard();
                    };
                }
                // === 非丢弃区域：drop 到面板和 UI 上 = 标记已处理，不丢弃 ===
                const panel = document.getElementById('systemPanel');
                if (panel) {
                    panel.ondragover = function(e) { e.preventDefault(); };
                    panel.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true; // 标记已处理，不丢弃
                    };
                }
                const uiLayer = document.getElementById('uiLayer');
                if (uiLayer) {
                    uiLayer.ondragover = function(e) { e.preventDefault(); };
                    uiLayer.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true; // 标记已处理，不丢弃
                    };
                }
                // === 面板内所有子容器也标记为非丢弃区域 ===
                document.querySelectorAll('.equip-panel, .inventory-panel, .tabs, .panel-header, .panel-footer, .diablo-paperdoll, .equip-slot-group, .inv-grid').forEach(el => {
                    el.ondragover = function(e) { e.preventDefault(); };
                    el.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true; // 标记已处理，不丢弃
                    };
                });
                // document 级别 dragover（确保 drop 事件能触发）
                document.addEventListener('dragover', function _discardAllowDrop(e) {
                    if (self._dragSrc) e.preventDefault();
                });
            },
            /** 绑定单个格子的拖放事件 */
            bindDragToCell(cell) {
                const self = this;
                cell.ondragstart = function(e) {
                    self._dragSrc = {
                        type: cell.classList.contains('inv-cell') ? 'inventory' : 'equip',
                        slot: cell.dataset.slot
                    };
                    self._dropHandled = false; // drop 标记：false = 尚未处理
                    e.dataTransfer.setData('text/plain', cell.dataset.slot);
                    e.dataTransfer.effectAllowed = 'move';
                    cell.classList.add('dragging');
                    // 拖拽开始时自动隐藏属性浮窗
                    const tooltip = document.getElementById('equipTooltip');
                    if (tooltip) {
                        tooltip.classList.remove('visible', 'pinned');
                        tooltip._pinned = false;
                    }
                };
                cell.ondragend = function(e) {
                    cell.classList.remove('dragging');
                    document.querySelectorAll('.inv-cell, .diablo-slot').forEach(s => s.classList.remove('drag-over'));
                    // 丢弃条件：drop 没被任何已知区域处理（所有面板/UI区域都已绑定ondrop标记_dropHandled）
                    // 如果 _dropHandled 仍为 false，说明拖到了浏览器外部或未知区域，执行丢弃
                    if (!self._dropHandled && self._dragSrc && self._isInGameArea(e.clientX)) {
                        self._doDiscard();
                    }
                    self._dropHandled = false;
                    self._dragSrc = null;
                };
                cell.ondragover = function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                };
                cell.ondragenter = function(e) {
                    cell.classList.add('drag-over');
                };
                cell.ondragleave = function(e) {
                    cell.classList.remove('drag-over');
                };
                cell.ondrop = function(e) {
                    e.preventDefault();
                    // 装备栏槽位的 drop 由 equipGrid 事件委托处理，这里直接返回不阻止冒泡
                    if (!cell.classList.contains('inv-cell')) {
                        cell.classList.remove('drag-over');
                        return;
                    }
                    // 背包格子的 drop 自行处理
                    e.stopPropagation();
                    cell.classList.remove('drag-over');
                    self._dropHandled = true;
                    const src = self._dragSrc;
                    if (!src || src.slot === cell.dataset.slot) return;
                    self.handleDrop(src, 'inventory', cell.dataset.slot);
                    self._dragSrc = null;
                };
            },
/** 处理拖放放下逻辑 */
            handleDrop(src, targetType, targetSlot) {
                if (!src || !targetType) return;
                // 背包 -> 背包：交换位置
                if (src.type === 'inventory' && targetType === 'inventory') {
                    const sIdx = parseInt(src.slot), tIdx = parseInt(targetSlot);
                    if (isNaN(sIdx) || isNaN(tIdx) || sIdx === tIdx) return;
                    const sItem = this.backpackItems.find(i => i.slot === sIdx);
                    const tItem = this.backpackItems.find(i => i.slot === tIdx);
                    if (sItem) sItem.slot = tIdx;
                    if (tItem) tItem.slot = sIdx;
                    // SoundManager.play('equip');
                    this.updateInventorySlots(); return;
                }
                // 背包 -> 装备栏：装备物品（通用武器槽设计）
                if (src.type === 'inventory' && targetType === 'equip') {
                    const sIdx = parseInt(src.slot);
                    const item = this.backpackItems.find(i => i.slot === sIdx);
                    if (!item) return;
                    // 非武器槽位需要 equipSlot 匹配；武器槽位（weapon/weapon2）只能放武器
                    const isWeaponSlot = (targetSlot === 'weapon' || targetSlot === 'weapon2');
                    const isWeaponItem = item.weaponType || (item.category && item.category.includes('weapon')) || item.rangedType;
                    if (isWeaponItem && !isWeaponSlot) return; // 武器只能放入武器槽
                    if (isWeaponSlot && !isWeaponItem) return; // 非武器不能放入武器槽
                    if (!isWeaponSlot && item.equipSlot !== targetSlot) return;
                    const cur = this.player.equipments[targetSlot];
                    // 先移除背包中原物品
                    this.backpackItems = this.backpackItems.filter(i => i.slot !== sIdx);
                    // 如果槽位有旧装备，卸下放到背包
                    if (cur && cur.name) {
                        const oldClone = JSON.parse(JSON.stringify(cur));
                        oldClone.slot = sIdx;
                        this.backpackItems.push(oldClone);
                    }
                    // 装备新物品
                    this.player.equipments[targetSlot] = JSON.parse(JSON.stringify(item));
                    // 只在装备到当前武器栏时应用技能覆盖（非当前栏位等切换时再应用）
                    if (targetSlot === this.player.weaponMode && this.player._applySkillOverrides) {
                        this.player._applySkillOverrides(item);
                        // 刷新技能栏显示
                        if (typeof SkillManager !== 'undefined' && SkillManager.renderSkillGrid) {
                            SkillManager.renderSkillGrid();
                        }
                    }
                    // 更新武器状态
                    if (targetSlot === 'weapon' || targetSlot === 'weapon2') {
                        if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                            const frames = [];
                            if (item.bowFrames) {
                                for (let i = 0; i < item.bowFrames.length; i++) { const im = new Image(); im.src = item.bowFrames[i]; frames.push(im); }
                            } else if (item.weaponAsset && item.weaponAsset.framePrefix) {
                                for (let i = 1; i <= item.weaponAsset.frameCount; i++) {
                                    const num = String(i).padStart(item.weaponAsset.framePad || 2, '0');
                                    const im = new Image(); im.src = item.weaponAsset.framePrefix + num + '.png'; frames.push(im);
                                }
                            }
                            this.player.equippedBowFrames = frames;
                            this.player.equippedRangedType = 'bow';
                        } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                            this.player.equippedRangedType = 'pistol';
                        } else if (item.category === 'weapon_melee' || item.weaponType === 'sword') {
                            this.player.hasMeleeWeapon = true;
                        }
                        // 同步当前武器视觉状态（确保贴图正确更新）
                        this._syncWeaponVisual();
                    }
                    this.updateEquipSlots(); this.updateInventorySlots();
                    // 触发装备动画
                    this.triggerEquipFlash(targetSlot);
                    if (cur && cur.name) {
                        this.triggerBackpackFlash(sIdx);
                    }
                    return;
                }
                // 装备栏 -> 背包：卸下装备到指定格子
                if (src.type === 'equip' && targetType === 'inventory') {
                    const eKey = src.slot, tIdx = parseInt(targetSlot);
                    const existing = this.player.equipments[eKey];
                    if (!existing) return;
                    const bpItem = this.backpackItems.find(i => i.slot === tIdx);
                    if (bpItem && bpItem.equipSlot === eKey) {
                        // 交换：背包物品装备到栏位，旧装备放到被交换物品的格子
                        const oldClone = JSON.parse(JSON.stringify(existing));
                        oldClone.slot = tIdx;
                        this.player.equipments[eKey] = bpItem;
                        bpItem.slot = -1; // 临时标记，避免被filter掉
                        this.backpackItems = this.backpackItems.filter(i => i.slot !== tIdx);
                        this.backpackItems.push(oldClone);
                        if (eKey === 'weapon2' && bpItem.weaponAsset) this.player.loadWeaponAssets(bpItem);
                        // 如果交换的是当前武器槽，同步视觉状态
                        if (eKey === 'weapon' || eKey === 'weapon2') this._syncWeaponVisual();
                        // 应用技能覆盖（如果新装备有 skillOverrides）
                        if (this.player._applySkillOverrides) {
                            this.player._applySkillOverrides(bpItem);
                        }
                    } else {
                        // 目标格子有物品（类型不匹配）或为空：统一处理
                        this.backpackItems = this.backpackItems.filter(i => i.slot !== tIdx);
                        const clone = JSON.parse(JSON.stringify(existing));
                        clone.slot = tIdx;
                        clone.backpackSlot = tIdx;
                        this.backpackItems.push(clone);
                        this.player.equipments[eKey] = null;
                        this._clearWeaponState(eKey);
                        // 清除技能覆盖（只在卸下当前武器栏时）
                        if (eKey === this.player.weaponMode && this.player._clearSkillOverrides) {
                            this.player._clearSkillOverrides();
                        }
                        // 夜与火之剑：禁用特殊攻击图标
                        if (existing.weaponId === 'weapon5') {
                            QuickBar.disableSpecialAttack();
                        }
                    }
                    this.updateEquipSlots(); this.updateInventorySlots();
                    // 触发动画
                    this.triggerEquipFlash(eKey);
                    this.triggerBackpackFlash(tIdx);
                    return;
                }
                // 装备栏 -> 装备栏：交换（需类型验证）
                if (src.type === 'equip' && targetType === 'equip') {
                    const sKey = src.slot, tKey = targetSlot;
                    if (sKey === tKey) return;
                    const sItem = this.player.equipments[sKey];
                    const tItem = this.player.equipments[tKey];
                    if (!sItem && !tItem) return;
                    // 类型验证：检查源物品能否放入目标槽，目标物品能否放入源槽
                    if (!this._canEquipSlot(sItem, tKey)) return;
                    if (!this._canEquipSlot(tItem, sKey)) return;
                    this.player.equipments[sKey] = tItem || null;
                    this.player.equipments[tKey] = sItem || null;
                    // 应用技能覆盖（以目标槽位优先）
                    if (this.player._applySkillOverrides) {
                        const activeItem = this.player.equipments[this.player.weaponMode];
                        this.player._applySkillOverrides(activeItem);
                    }
                    // 如果交换涉及武器槽位，重新同步视觉状态（不切换 weaponMode，保持当前使用的武器）
                    if (sKey === 'weapon' || sKey === 'weapon2' || tKey === 'weapon' || tKey === 'weapon2') {
                        this._syncWeaponVisual();
                    }
                    // 拖入目标槽时加载新武器资源
                    if ((tKey === 'weapon' || tKey === 'weapon2') && sItem && sItem.weaponAsset) this.player.loadWeaponAssets(sItem);
                    EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, `已交换: ${sItem.name} ↔ ${tItem ? tItem.name : '空'}`, '#d4c5a9'));
                    this.updateEquipSlots();
                    // 触发交换动画
                    this.triggerEquipFlash(sKey);
                    this.triggerEquipFlash(tKey);
                    return;
                }
            },
            _canEquipSlot(item, slot) {
                if (!item || !slot) return true;
                const isWeaponSlot = (slot === 'weapon' || slot === 'weapon2');
                const isWeaponItem = item.weaponType || (item.category && item.category.includes('weapon')) || item.rangedType;
                if (isWeaponItem && !isWeaponSlot) return false;
                if (isWeaponSlot && !isWeaponItem) return false;
                if (!isWeaponSlot && item.equipSlot !== slot) return false;
                return true;
            },
            /** 同步当前武器视觉状态：根据 weaponMode 重新设置 meleeImage、弓/手枪状态、特殊攻击图标 */
            _syncWeaponVisual() {
                const player = this.player;
                if (!player) return;
                const currentItem = player.equipments[player.weaponMode];
                if (currentItem && currentItem.name) {
                    // 同步近战武器贴图
                    if (currentItem.equipImage) {
                        player.meleeImage.src = currentItem.equipImage;
                    }
                    // 同步弓/远程武器状态
                    if (currentItem.bowFrames || (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix)) {
                        const frames = [];
                        if (currentItem.bowFrames) {
                            for (let i = 0; i < currentItem.bowFrames.length; i++) { const im = new Image(); im.src = currentItem.bowFrames[i]; frames.push(im); }
                        } else if (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix) {
                            for (let i = 1; i <= currentItem.weaponAsset.frameCount; i++) {
                                const num = String(i).padStart(currentItem.weaponAsset.framePad || 2, '0');
                                const im = new Image(); im.src = currentItem.weaponAsset.framePrefix + num + '.png'; frames.push(im);
                            }
                        }
                        player.equippedBowFrames = frames;
                        player.equippedRangedType = 'bow';
                    } else if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') {
                        player.equippedRangedType = 'pistol';
                    } else if (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword') {
                        player.hasMeleeWeapon = true;
                    }
                    // 同步夜与火之剑特殊攻击图标
                    if (currentItem.weaponId === 'weapon5') {
                        QuickBar.enableSpecialAttack(currentItem);
                    } else {
                        QuickBar.disableSpecialAttack();
                    }
                    // 触发待机动画2（旋转动画）
                    player.weaponAnim.nextSpin = Date.now() + 150;
                } else {
                    // 空手状态：清空所有武器视觉状态
                    player.hasMeleeWeapon = false;
                    player.equippedRangedType = null;
                    player.equippedBowFrames = null;
                    player.meleeImage.src = 'assets/weapons/1-rusty_sword_euip.png';
                    QuickBar.disableSpecialAttack();
                }
                player.weaponAnim.state = 'idle';
                player.weaponAnim.timer = 0;
            },
            updateEquipSlots() {
                const eq = this.player.equipments;
                const rarityLabelMap = { common: '普通', uncommon: '优质', rare: '稀有', epic: '史诗' };
                document.querySelectorAll('.diablo-slot').forEach(slot => {
                    const key = slot.dataset.slot;
                    const item = eq[key];
                    const iconEl = slot.querySelector('.slot-icon');
                    const nameEl = slot.querySelector('.slot-name');
                    const rarityEl = slot.querySelector('.slot-rarity');
                    slot.draggable = !!item;
                    if (item) {
                        slot.classList.add('equipped');
                        const imgSrc = item.slotImage || item.iconImage;
                        nameEl.textContent = item.name;
                        // 稀有度显示
                        const rarityKey = item.rarity || 'common';
                        const rarityLabel = rarityLabelMap[rarityKey] || rarityKey;
                        if (rarityEl) {
                            rarityEl.textContent = rarityLabel;
                            rarityEl.className = 'slot-rarity rarity-' + rarityKey;
                        }
                        if (imgSrc) {
                            iconEl.innerHTML = `<img src="${imgSrc}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${item.icon || '❓'}';">`;
                        } else {
                            iconEl.textContent = item.icon || '⚔';
                        }
                    } else {
                        slot.classList.remove('equipped');
                        iconEl.innerHTML = '';
                        nameEl.textContent = nameEl.dataset.default || '';
                        if (rarityEl) {
                            rarityEl.textContent = '';
                            rarityEl.className = 'slot-rarity';
                        }
                    }
                    // 为装备栏槽位绑定 dragstart/dragend（drop 由 equipGrid 事件委托处理）
                    const self = this;
                    slot.ondragstart = function(e) {
                        // 拖拽开始时自动隐藏属性浮窗
                        const tooltip = document.getElementById('equipTooltip');
                        if (tooltip) {
                            tooltip.classList.remove('visible', 'pinned');
                            tooltip._pinned = false;
                        }
                        if (!item) return;
                        self._dragSrc = { type: 'equip', slot: key };
                        self._dropHandled = false;
                        e.dataTransfer.setData('text/plain', key);
                        e.dataTransfer.effectAllowed = 'move';
                        slot.classList.add('dragging');
                    };
                    slot.ondragend = function(e) {
                        slot.classList.remove('dragging');
                        document.querySelectorAll('.diablo-slot').forEach(s => s.classList.remove('drag-over'));
                        if (!self._dropHandled && self._dragSrc && self._isInGameArea(e.clientX)) {
                            self._doDiscard();
                        }
                        self._dropHandled = false;
                        self._dragSrc = null;
                    };
                });
            },
            unequip(slotKey) {
                const equipped = this.player.equipments[slotKey];
                if (!equipped || !equipped.name) return false;
                // 如果背包已满，不能卸下
                if (this.backpackItems.length >= 36) {
                    EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, '背包已满！'));
                    return false;
                }
                // 使用原装备中的 backpackSlot 记忆字段，若无则分配第一个空位
                let targetSlot = equipped.backpackSlot;
                if (targetSlot === undefined || targetSlot < 0 || this.backpackItems.some(i => i.slot === targetSlot)) {
                    const used = new Set(this.backpackItems.map(i => i.slot));
                    targetSlot = 0;
                    while (used.has(targetSlot) && targetSlot < 36) targetSlot++;
                    if (targetSlot >= 36) return false;
                }
                const clone = JSON.parse(JSON.stringify(equipped));
                clone.slot = targetSlot;
                if (!clone.weaponCategory) {
                    if (slotKey === 'weapon' || slotKey === 'weapon2') clone.weaponCategory = 'mainhand';
                    else if (slotKey === 'offhand' || slotKey === 'ring2') clone.weaponCategory = 'offhand';
                }
                this.backpackItems.push(clone);
                this.player.equipments[slotKey] = null;
                this._clearWeaponState(slotKey);
                // 清除技能覆盖
                if (this.player._clearSkillOverrides) {
                    this.player._clearSkillOverrides();
                }
                this.updateEquipSlots();
                this.updateInventorySlots();
                return true;
            },
            bindEquipTooltip() {
                const tooltip = document.getElementById('equipTooltip');
                const ttName = document.getElementById('ttName');
                const ttType = document.getElementById('ttType');
                const ttStats = document.getElementById('ttStats');
                const ttExtra = document.getElementById('ttExtra');
                const ttDesc = document.getElementById('ttDesc');
                const self = this;
                let _ttMoveHandler = null;
                // 关闭按钮
                const closeBtn = document.getElementById('ttCloseBtn');
                if (closeBtn) {
                    closeBtn.onclick = function(e) {
                        e.stopPropagation();
                        tooltip.classList.remove('visible', 'pinned');
                        tooltip._pinned = false;
                    };
                }
                // 点击外部关闭
                document.addEventListener('click', function(e) {
                    if (tooltip._pinned && !tooltip.contains(e.target) && !e.target.closest('.diablo-slot') && !e.target.closest('.inv-cell')) {
                        tooltip.classList.remove('visible', 'pinned');
                        tooltip._pinned = false;
                    }
                });
                function buildTooltip(item) {
                    // 从 CodexManager 合并完整的武器数据
                    const codexItem = (typeof CodexManager !== 'undefined' && CodexManager.getItemByName) ? CodexManager.getItemByName(item.name) : null;
                    // 核心策略：以 codexItem 为完整数据基准（包含 attack、animation、weaponCategory 等所有字段），
                    // 然后只覆盖 item 中需要动态计算的字段（如 stats 中的物理攻击值）和运行时字段（如 slot、backpackSlot）
                    const fullItem = codexItem ? { ...codexItem } : { ...item };
                    if (codexItem && item) {
                        // 用 item 的 stats 值覆盖 codexItem 的 stats 值（如动态计算后的物理攻击）
                        if (item.stats && Array.isArray(item.stats) && fullItem.stats && Array.isArray(fullItem.stats)) {
                            const itemStatsMap = new Map();
                            for (const s of item.stats) {
                                const key = (s.name || s.label || '').trim();
                                if (key) itemStatsMap.set(key, s);
                            }
                            for (let i = 0; i < fullItem.stats.length; i++) {
                                const fs = fullItem.stats[i];
                                const key = (fs.label || fs.name || '').trim();
                                if (key && itemStatsMap.has(key)) {
                                    const itemStat = itemStatsMap.get(key);
                                    fullItem.stats[i] = { ...fs, value: itemStat.value, pos: itemStat.pos };
                                }
                            }
                        }
                        // 保留 item 中独有的运行时字段（如 slot、backpackSlot、itemId 等）
                        for (const key of Object.keys(item)) {
                            if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
                                if (fullItem[key] === undefined || fullItem[key] === null || fullItem[key] === '') {
                                    fullItem[key] = item[key];
                                }
                            }
                        }
                    }
                    // 稀有度颜色绑定
                    const rarityColorMap = { common: '#c0c0c0', uncommon: '#7aff7a', rare: '#7a9aff', epic: '#c67aff' };
                    const rarityLabelMap = { common: '普通', uncommon: '优质', rare: '稀有', epic: '史诗' };
                    const rarityKey = fullItem.rarity || 'common';
                    const rarityLabel = rarityLabelMap[rarityKey] || rarityKey;
                    const rarityColor = rarityColorMap[rarityKey] || '#ffffff';
                    ttName.textContent = fullItem.name;
                    ttType.innerHTML = fullItem.type + (fullItem.rarity ? ` | <span style="color:${rarityColor};font-weight:700;">${rarityLabel}</span>` : '') + (fullItem.level ? ` | Lv.${fullItem.level}` : '');
                    // 属性列表
                    let statsHtml = '';
                    if (fullItem.stats && fullItem.stats.length > 0) {
                        statsHtml = fullItem.stats.map(s => {
                            const statName = s.name || s.label;
                            if (!statName) return '';
                            let value = s.value;
                            // 近战武器物理攻击显示公式，远程武器显示固定数值
                            if (statName === '物理攻击' && fullItem.weaponId && fullItem.category === 'weapon_melee') {
                                const formulas = {
                                    weapon1: '6 + 力量×0.8 + 敏捷×0.5',
                                    weapon2: '12 + 力量×1 + 敏捷×0.5',
                                    weapon4: '15 + 力量×1.5 + 敏捷×0.8',
                                    weapon5: '20 + 力量×1.8 + 敏捷×1'
                                };
                                if (formulas[fullItem.weaponId]) value = formulas[fullItem.weaponId];
                            }
                            return `<div class="tt-stat"><span class="tt-stat-name">${statName}</span><span class="tt-stat-val ${s.pos ? 'pos' : ''}">${value}</span></div>`;
                        }).join('');
                    }
                    ttStats.innerHTML = statsHtml;
                    // 额外属性
                    let extraHtml = '';
                    if (fullItem.category) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">分类</span><span class="tt-stat-val">${fullItem.category}</span></div>`;
                    if (fullItem.weaponType) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器类型</span><span class="tt-stat-val">${fullItem.weaponType}</span></div>`;
                    if (fullItem.weaponTypeTag) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器类型</span><span class="tt-stat-val">${fullItem.weaponTypeTag}</span></div>`;
                    if (fullItem.equipSlot) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">装备槽位</span><span class="tt-stat-val">${fullItem.equipSlot}</span></div>`;
                    if (fullItem.weaponId) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器ID</span><span class="tt-stat-val">${fullItem.weaponId}</span></div>`;
                    if (fullItem.weaponCategory) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器分类</span><span class="tt-stat-val">${fullItem.weaponCategory}</span></div>`;
                    // 武器攻击参数：仅从图鉴/原始数据获取，不读取玩家动态配置
                    let attackParams = null;
                    const codexAttack = codexItem ? codexItem.attack : null;
                    if (codexAttack) {
                        attackParams = codexAttack;
                    } else if (fullItem.attack) {
                        attackParams = fullItem.attack;
                    }
                    if (attackParams) {
                        extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🎯 攻击参数</span></div>`;
                        if (attackParams.range) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击距离</span><span class="tt-stat-val">${attackParams.range}px</span></div>`;
                        if (attackParams.attackInterval) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击间隔</span><span class="tt-stat-val">${attackParams.attackInterval}ms</span></div>`;
                        if (attackParams.hitType) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">命中类型</span><span class="tt-stat-val">${attackParams.hitType}</span></div>`;
                        if (attackParams.damageType) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害类型</span><span class="tt-stat-val">${attackParams.damageType}</span></div>`;
                    }
                    // 武器动画参数：优先从 codexItem 获取，再回退到 fullItem
                    const animSource = (codexItem && codexItem.animation) ? codexItem.animation : fullItem.animation;
                    if (animSource) {
                        extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🎬 动画参数</span></div>`;
                        if (animSource.type) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">动画类型</span><span class="tt-stat-val">${animSource.type}</span></div>`;
                        if (animSource.totalMs) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">总时长</span><span class="tt-stat-val">${animSource.totalMs}</span></div>`;
                        if (animSource.windupMs) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">预备(windup)</span><span class="tt-stat-val">${animSource.windupMs}ms</span></div>`;
                        if (animSource.swingMs) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击(swing)</span><span class="tt-stat-val">${animSource.swingMs}ms</span></div>`;
                        if (animSource.recoveryMs) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">回位(recovery)</span><span class="tt-stat-val">${animSource.recoveryMs}ms</span></div>`;
                    }
                    // 武器素材
                    if (fullItem.weaponAsset) {
                        extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">📁 素材</span></div>`;
                        if (fullItem.weaponAsset.framePrefix) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">帧前缀</span><span class="tt-stat-val">${fullItem.weaponAsset.framePrefix}</span></div>`;
                        if (fullItem.weaponAsset.frameCount) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">帧数</span><span class="tt-stat-val">${fullItem.weaponAsset.frameCount}</span></div>`;
                    }
                    if (fullItem.equipImage) extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name">装备贴图</span><span class="tt-stat-val" style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;">${fullItem.equipImage}</span></div>`;
                    if (fullItem.iconImage) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">图标贴图</span><span class="tt-stat-val" style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;">${fullItem.iconImage}</span></div>`;
                    ttExtra.innerHTML = extraHtml;
                    ttDesc.textContent = fullItem.desc || '';
                }
                function positionTooltip(e) {
                    const tw = 360;
                    let left = e.clientX - tw - 10;
                    let top = e.clientY + 10;
                    // 先临时设置位置并获取实际高度
                    tooltip.style.left = left + 'px';
                    tooltip.style.top = top + 'px';
                    const th = tooltip.offsetHeight || 280;
                    // 水平边界检测：默认在鼠标左侧，若左侧空间不足则放右侧
                    if (left < 10) left = e.clientX + 10;
                    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
                    // 垂直边界检测：优先在鼠标下方，若下方空间不足则放上方
                    if (top + th > window.innerHeight - 10) {
                        top = e.clientY - th - 10;
                    }
                    // 若上方也超出，则强制限制在视口内
                    if (top < 10) top = 10;
                    tooltip.style.left = left + 'px';
                    tooltip.style.top = top + 'px';
                    // 保存固定位置
                    tooltip._fixedLeft = left;
                    tooltip._fixedTop = top;
                }
                function removeMoveHandler(slot) {
                    if (slot._ttMoveHandler) {
                        document.removeEventListener('mousemove', slot._ttMoveHandler);
                        slot._ttMoveHandler = null;
                    }
                }
                document.querySelectorAll('.diablo-slot').forEach(slot => {
                    slot.onmouseenter = function(e) {
                        if (tooltip._pinned) return; // 固定时不响应hover
                        const key = slot.dataset.slot;
                        const item = self.player.equipments[key];
                        if (!item) return;
                        buildTooltip(item);
                        tooltip.classList.add('visible');
                        positionTooltip(e);
                        slot._ttMoveHandler = positionTooltip;
                        document.addEventListener('mousemove', slot._ttMoveHandler);
                    };
                    slot.onmouseleave = function() {
                        if (tooltip._pinned) return; // 固定时不隐藏
                        tooltip.classList.remove('visible');
                        removeMoveHandler(slot);
                    };
                    slot.onmousedown = function(e) {
                        if (e.button !== 0) return; // 仅左键
                        const key = slot.dataset.slot;
                        const item = self.player.equipments[key];
                        if (!item) return;
                        e.stopPropagation();
                        if (tooltip._pinned) {
                            // 再次点击已固定的项，取消固定
                            tooltip.classList.remove('visible', 'pinned');
                            tooltip._pinned = false;
                        } else {
                            // 固定显示
                            buildTooltip(item);
                            tooltip.classList.add('visible', 'pinned');
                            tooltip._pinned = true;
                            positionTooltip(e);
                            // 固定后移除mousemove监听器，不再跟随鼠标
                            removeMoveHandler(slot);
                        }
                    };
                    slot.oncontextmenu = function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const key = slot.dataset.slot;
                        if (self.unequip(key)) {
                            EffectManager.add(new FloatingTextEffect(self.player.x, self.player.y - 20, '已卸下装备'));
                        }
                    };
                });
            },
            bindInventoryTooltip() {
                const tooltip = document.getElementById('equipTooltip');
                const ttName = document.getElementById('ttName');
                const ttType = document.getElementById('ttType');
                const ttStats = document.getElementById('ttStats');
                const ttExtra = document.getElementById('ttExtra');
                const ttDesc = document.getElementById('ttDesc');
                const self = this;
                function buildTooltip(item) {
                    // 从 CodexManager 合并完整的武器数据（与装备栏版本完全一致）
                    const codexItem = (typeof CodexManager !== 'undefined' && CodexManager.getItemByName) ? CodexManager.getItemByName(item.name) : null;
                    const fullItem = codexItem ? { ...codexItem } : { ...item };
                    if (codexItem && item) {
                        // 用 item 的 stats 值覆盖 codexItem 的 stats 值（动态计算后的物理攻击等）
                        if (item.stats && Array.isArray(item.stats) && fullItem.stats && Array.isArray(fullItem.stats)) {
                            const itemStatsMap = new Map();
                            for (const s of item.stats) {
                                const key = (s.name || s.label || '').trim();
                                if (key) itemStatsMap.set(key, s);
                            }
                            for (let i = 0; i < fullItem.stats.length; i++) {
                                const fs = fullItem.stats[i];
                                const key = (fs.label || fs.name || '').trim();
                                if (key && itemStatsMap.has(key)) {
                                    const itemStat = itemStatsMap.get(key);
                                    fullItem.stats[i] = { ...fs, value: itemStat.value, pos: itemStat.pos };
                                }
                            }
                        }
                        // 保留 item 中独有的运行时字段
                        for (const key of Object.keys(item)) {
                            if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
                                if (fullItem[key] === undefined || fullItem[key] === null || fullItem[key] === '') {
                                    fullItem[key] = item[key];
                                }
                            }
                        }
                    }
                    // 稀有度颜色绑定（背包浮窗）
                    const rarityColorMap2 = { common: '#c0c0c0', uncommon: '#7aff7a', rare: '#7a9aff', epic: '#c67aff' };
                    const rarityLabelMap2 = { common: '普通', uncommon: '优质', rare: '稀有', epic: '史诗' };
                    const rarityKey2 = fullItem.rarity || 'common';
                    const rarityLabel2 = rarityLabelMap2[rarityKey2] || rarityKey2;
                    const rarityColor2 = rarityColorMap2[rarityKey2] || '#ffffff';
                    ttName.textContent = fullItem.name;
                    ttType.innerHTML = fullItem.type + (fullItem.rarity ? ` | <span style="color:${rarityColor2};font-weight:700;">${rarityLabel2}</span>` : '') + (fullItem.level ? ` | Lv.${fullItem.level}` : '');
                    let statsHtml = '';
                    if (fullItem.stats && fullItem.stats.length > 0) {
                        statsHtml = fullItem.stats.map(s => {
                            const statName = s.name || s.label;
                            if (!statName) return '';
                            let value = s.value;
                            // 近战武器物理攻击显示公式，远程武器显示固定数值
                            if (statName === '物理攻击' && fullItem.weaponId && fullItem.category === 'weapon_melee') {
                                const formulas = {
                                    weapon1: '6 + 力量×0.8 + 敏捷×0.5',
                                    weapon2: '12 + 力量×1 + 敏捷×0.5',
                                    weapon4: '15 + 力量×1.5 + 敏捷×0.8',
                                    weapon5: '20 + 力量×1.8 + 敏捷×1'
                                };
                                if (formulas[fullItem.weaponId]) value = formulas[fullItem.weaponId];
                            }
                            return `<div class="tt-stat"><span class="tt-stat-name">${statName}</span><span class="tt-stat-val ${s.pos ? 'pos' : ''}">${value}</span></div>`;
                        }).join('');
                    }
                    ttStats.innerHTML = statsHtml;
                    let extraHtml = '';
                    if (fullItem.category) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">分类</span><span class="tt-stat-val">${fullItem.category}</span></div>`;
                    if (fullItem.weaponType) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器类型</span><span class="tt-stat-val">${fullItem.weaponType}</span></div>`;
                    if (fullItem.weaponTypeTag) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器类型</span><span class="tt-stat-val">${fullItem.weaponTypeTag}</span></div>`;
                    if (fullItem.equipSlot) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">装备槽位</span><span class="tt-stat-val">${fullItem.equipSlot}</span></div>`;
                    if (fullItem.weaponId) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器ID</span><span class="tt-stat-val">${fullItem.weaponId}</span></div>`;
                    if (fullItem.weaponCategory) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器分类</span><span class="tt-stat-val">${fullItem.weaponCategory}</span></div>`;
                    // 攻击参数：仅从图鉴/原始数据获取，不读取玩家动态配置
                    let attackParams = null;
                    const codexAttack = codexItem ? codexItem.attack : null;
                    if (codexAttack) {
                        attackParams = codexAttack;
                    } else if (fullItem.attack) {
                        attackParams = fullItem.attack;
                    }
                    if (attackParams) {
                        extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🎯 攻击参数</span></div>`;
                        if (attackParams.range) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击距离</span><span class="tt-stat-val">${attackParams.range}px</span></div>`;
                        if (attackParams.attackInterval) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击间隔</span><span class="tt-stat-val">${attackParams.attackInterval}ms</span></div>`;
                        if (attackParams.hitType) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">命中类型</span><span class="tt-stat-val">${attackParams.hitType}</span></div>`;
                        if (attackParams.damageType) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害类型</span><span class="tt-stat-val">${attackParams.damageType}</span></div>`;
                    }
                    // 动画参数：优先从 codexItem 获取，确保背包和装备栏一致
                    const animSource = (codexItem && codexItem.animation) ? codexItem.animation : fullItem.animation;
                    if (animSource) {
                        extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🎬 动画参数</span></div>`;
                        if (animSource.type) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">动画类型</span><span class="tt-stat-val">${animSource.type}</span></div>`;
                        if (animSource.totalMs) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">总时长</span><span class="tt-stat-val">${animSource.totalMs}</span></div>`;
                        if (animSource.windupMs) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">预备(windup)</span><span class="tt-stat-val">${animSource.windupMs}ms</span></div>`;
                        if (animSource.swingMs) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击(swing)</span><span class="tt-stat-val">${animSource.swingMs}ms</span></div>`;
                        if (animSource.recoveryMs) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">回位(recovery)</span><span class="tt-stat-val">${animSource.recoveryMs}ms</span></div>`;
                    }
                    // 武器素材
                    if (fullItem.weaponAsset) {
                        extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">📁 素材</span></div>`;
                        if (fullItem.weaponAsset.framePrefix) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">帧前缀</span><span class="tt-stat-val">${fullItem.weaponAsset.framePrefix}</span></div>`;
                        if (fullItem.weaponAsset.frameCount) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">帧数</span><span class="tt-stat-val">${fullItem.weaponAsset.frameCount}</span></div>`;
                    }
                    if (fullItem.equipImage) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">装备贴图</span><span class="tt-stat-val">${fullItem.equipImage}</span></div>`;
                    if (fullItem.iconImage) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">图标贴图</span><span class="tt-stat-val">${fullItem.iconImage}</span></div>`;
                    if (fullItem.stack > 1) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">堆叠数量</span><span class="tt-stat-val">${fullItem.stack}</span></div>`;
                    ttExtra.innerHTML = extraHtml;
                    ttDesc.textContent = fullItem.desc || '';
                }
                function positionTooltip(e) {
                    const tw = 360;
                    let left = e.clientX - tw - 10;
                    let top = e.clientY + 10;
                    // 先临时设置位置并获取实际高度
                    tooltip.style.left = left + 'px';
                    tooltip.style.top = top + 'px';
                    const th = tooltip.offsetHeight || 280;
                    // 水平边界检测：默认在鼠标左侧，若左侧空间不足则放右侧
                    if (left < 10) left = e.clientX + 10;
                    if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
                    // 垂直边界检测：优先在鼠标下方，若下方空间不足则放上方
                    if (top + th > window.innerHeight - 10) {
                        top = e.clientY - th - 10;
                    }
                    // 若上方也超出，则强制限制在视口内
                    if (top < 10) top = 10;
                    tooltip.style.left = left + 'px';
                    tooltip.style.top = top + 'px';
                }
                function removeMoveHandler(cell) {
                    if (cell._ttMoveHandler) {
                        document.removeEventListener('mousemove', cell._ttMoveHandler);
                        cell._ttMoveHandler = null;
                    }
                }
                document.querySelectorAll('.inv-cell').forEach(cell => {
                    cell.onmouseenter = function(e) {
                        if (tooltip._pinned) return;
                        const idx = parseInt(cell.dataset.slot);
                        const item = self.backpackItems.find(i => i.slot === idx);
                        if (!item) return;
                        buildTooltip(item);
                        tooltip.classList.add('visible');
                        positionTooltip(e);
                        cell._ttMoveHandler = positionTooltip;
                        document.addEventListener('mousemove', cell._ttMoveHandler);
                    };
                    cell.onmouseleave = function() {
                        if (tooltip._pinned) return;
                        tooltip.classList.remove('visible');
                        removeMoveHandler(cell);
                    };
                    cell.onmousedown = function(e) {
                        if (e.button !== 0) return;
                        const idx = parseInt(cell.dataset.slot);
                        const item = self.backpackItems.find(i => i.slot === idx);
                        if (!item) return;
                        e.stopPropagation();
                        if (tooltip._pinned) {
                            tooltip.classList.remove('visible', 'pinned');
                            tooltip._pinned = false;
                        } else {
                            buildTooltip(item);
                            tooltip.classList.add('visible', 'pinned');
                            tooltip._pinned = true;
                            positionTooltip(e);
                            // 固定后移除mousemove监听器，不再跟随鼠标
                            removeMoveHandler(cell);
                        }
                    };
                });
            },
            equipFromBackpack(backpackIdx) {
                const item = this.backpackItems.find(i => i.slot === backpackIdx);
                if (!item) return;
                const player = this.player;

                // ===== 消耗品：直接使用 =====
                if (item.category === 'consumable') {
                    if (item.name === '治疗药水') {
                        player.hp = Math.min(player.hp + 30, player.maxHp);
                        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, '+30 HP', '#7a9a6a'));
                    } else if (item.name === '魔力药水') {
                        player.mp = Math.min(player.mp + 25, player.maxMp);
                        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, '+25 MP', '#5a8aaa'));
                    }
                    // 减少堆叠数量
                    if (item.stack > 1) { item.stack--; }
                    else { this.backpackItems = this.backpackItems.filter(i => i.slot !== backpackIdx); }
                    this.updateInventorySlots();
                    return;
                }

                // 目标槽位
                let targetSlot = item.equipSlot;
                // 判断是否是武器
                const isWeapon = item.category === 'weapon_melee' || item.category === 'weapon_ranged'
                    || item.weaponType || item.rangedType || item.weaponAsset || item.bowFrames;
                // 武器类：统一按空槽位填充逻辑，忽略 equipSlot
                // 栏1空 → 栏1，栏1有栏2空 → 栏2，都满 → 替换当前使用的武器栏
                if (isWeapon) {
                    const w1Empty = !player.equipments.weapon || !player.equipments.weapon.name;
                    const w2Empty = !player.equipments.weapon2 || !player.equipments.weapon2.name;
                    if (w1Empty) {
                        targetSlot = 'weapon';
                    } else if (w2Empty) {
                        targetSlot = 'weapon2';
                    } else {
                        // 两个都满，替换当前正在使用的武器栏
                        targetSlot = player.weaponMode;
                    }
                }
                if (!targetSlot || !player.equipments.hasOwnProperty(targetSlot)) return;

                const replacedItem = player.equipments[targetSlot];
                // 先从背包移除原物品
                this.backpackItems = this.backpackItems.filter(i => i.slot !== backpackIdx);
                // 如果目标槽位有旧装备，卸下并记录其来源格子
                if (replacedItem && replacedItem.name) {
                    const oldClone = JSON.parse(JSON.stringify(replacedItem));
                    oldClone.slot = backpackIdx;
                    oldClone.backpackSlot = backpackIdx; // 记忆，下次卸下时优先回到此格
                    this.backpackItems.push(oldClone);
                }
                // 装备新物品
                const equippedClone = JSON.parse(JSON.stringify(item));
                equippedClone.backpackSlot = backpackIdx; // 记录来源格子
                player.equipments[targetSlot] = equippedClone;

                // 根据槽位处理武器状态（加载武器资源，不修改 weaponMode）
                if (targetSlot === 'weapon' || targetSlot === 'weapon2') {
                    if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                        const frames = [];
                        const framePaths = item.bowFrames || [];
                        for (let i = 0; i < framePaths.length; i++) {
                            const img = new Image(); img.src = framePaths[i]; frames.push(img);
                        }
                        player.equippedBowFrames = frames;
                        player.equippedRangedType = 'bow';
                    } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                        player.equippedRangedType = 'pistol';
                        if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                            player.muzzleFlashImg = new Image(); player.muzzleFlashImg.src = item.weaponAsset.muzzleImage;
                        }
                    } else if (item.category === 'weapon_melee' || item.weaponType === 'sword') {
                        player.hasMeleeWeapon = true;
                    }
                    // 安全：装备到当前武器栏时，设置切换冷却，防止装备后立即攻击
                    if (targetSlot === player.weaponMode && (item.weaponType === 'pistol' || item.rangedType === 'pistol')) {
                        player.weaponSwitchCooldown = 300;
                    }
                    // 同步当前武器视觉状态（贴图、弓/手枪状态、特殊攻击图标、旋转动画）
                    this._syncWeaponVisual();
                }
                // 只在装备到当前武器栏时应用技能覆盖
                if (targetSlot === player.weaponMode && player._applySkillOverrides) {
                    player._applySkillOverrides(equippedClone);
                }
                this.updateEquipSlots();
                this.updateInventorySlots();
                // 触发装备成功动画
                this.triggerEquipFlash(targetSlot);
                // 如果原装备回背包，触发背包格子动画
                if (replacedItem && replacedItem.name) {
                    this.triggerBackpackFlash(backpackIdx);
                }
            },
            addToBackpack(item) {
                const existingSlot = this.backpackItems.map(i => i.slot);
                let slot = 0;
                while (existingSlot.includes(slot)) slot++;
                if (slot >= 36) return; // 背包已满
                item.slot = slot;
                this.backpackItems.push(item);
                this.updateInventorySlots();
            },
            STEEL_BOW_ITEM: {
                name: '精钢长弓', type: '远程武器', icon: '🏹', iconImage: 'assets/icons/bow_icon.png',
                dropImage: 'assets/items/steel_bow_dropped.png',
                bowFrames: ['assets/weapons/steel_bow_frame_01.png','assets/weapons/steel_bow_frame_02.png','assets/weapons/steel_bow_frame_03.png','assets/weapons/steel_bow_frame_04.png','assets/weapons/steel_bow_frame_05.png','assets/weapons/steel_bow_frame_06.png','assets/weapons/steel_bow_frame_07.png','assets/weapons/steel_bow_frame_08.png'],
                stats: [{ name: '物理攻击', value: '15-25' }, { name: '射程', value: '800' }],
                desc: '由精钢打造的长弓，射程远，威力大',
                equipSlot: 'weapon2'
            },
            TEST_BOW_ITEM: {
                name: '训练用弓', type: '远程武器', icon: '🏹', iconImage: 'assets/icons/bow_icon.png',
                category: 'weapon_ranged', rarity: 'common', level: 1,
                weaponCategory: 'mainhand', weaponType: 'bow',
                weaponAsset: { framePrefix: 'assets/weapons/bow_frame_', frameCount: 8, framePad: 2 },
                stats: [{ name: '物理攻击', value: '8-14' }, { name: '射程', value: '600' }],
                desc: '一把简陋的弓，勉强能射出箭，适合初学者练习',
                equipSlot: 'weapon2'
            },
            G18_PISTOL_ITEM: {
                name: 'G18 手枪', type: '远程武器', icon: '🔫', iconImage: 'assets/icons/pistol_icon.png',
                dropImage: 'assets/weapons/g18_topdown_v2.png',
                category: 'weapon_ranged',
                weaponType: 'pistol',
                weaponAsset: { image: 'assets/weapons/g18_topdown_v2.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
                rangedType: 'pistol',
                stats: [{ name: '物理攻击', value: '6-12' }, { name: '射程', value: '500' }],
                desc: 'G18 全自动手枪，1100发/分钟，黄色曳光弹',
                equipSlot: 'weapon2'
            },
            KINGHTS_SWORD_ITEM: {
                weaponId: 'weapon2',
                name: '骑士长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/knights_sword_v3_macro.png',
                dropImage: 'assets/weapons/knights_sword_v3_equip.png',
                equipImage: 'assets/weapons/knights_sword_v3_equip.png',
                category: 'weapon_melee', rarity: 'uncommon', level: 5,
                weaponCategory: 'mainhand', weaponType: 'sword',
                weaponTypeTag: '近战武器',
                stats: [{ name: '物理攻击', value: '18-23' }],
                desc: '骑士团的标准制式长剑，剑身修长，锋利且坚韧。适合有一定基础的剑士使用。',
                equipSlot: 'weapon2',
                skillOverrides: {
                    dashAttackThrust: {
                        animation: {
                            totalMs: 600,
                            dashDist: 173,
                            chargeMs: 0,
                            thrustMs: 600,
                            recoverMs: 0
                        },
                        hitCheck: {
                            shape: 'rectangle',
                            width: 75,
                            length: 350,
                            hitArc: 0
                        }
                    }
                }
            },
            RUNE_SWORD_ITEM: {
                weaponId: 'weapon4',
                name: '符文长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/EXsword_icon.png',
                dropImage: 'assets/weapons/EXsword_equipped_v2_.png',
                equipImage: 'assets/weapons/EXsword_equipped_v2_.png',
                category: 'weapon_melee', rarity: 'uncommon', level: 5,
                weaponCategory: 'mainhand', weaponType: 'sword',
                weaponTypeTag: '近战武器',
                stats: [{ name: '物理攻击', value: '45-55' }, { name: '暴击率', value: '+5%', pos: true }],
                desc: '剑身上铭刻着上古符文的传奇长剑，符文之力蕴含其中，持有者能感受到符文中流淌的力量。剑刃在挥动时会留下淡蓝色的符文残影，威力远超凡铁。',
                equipSlot: 'weapon'
            },
            NIGHT_FLAME_SWORD_ITEM: {
                weaponId: 'weapon5',
                name: '夜与火之剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/Nightandflame_macro.png',
                dropImage: 'assets/weapons/Nightandflame_equip.png',
                equipImage: 'assets/weapons/Nightandflame_equip.png',
                category: 'weapon_melee', rarity: 'rare', level: 10,
                weaponCategory: 'mainhand', weaponType: 'sword',
                weaponTypeTag: '近战武器',
                stats: [{ name: '物理攻击', value: '60-75' }, { name: '暴击率', value: '+5%', pos: true }],
                desc: '一把在暗夜中燃烧着淡蓝色火焰的传奇之剑，传说中它同时寄宿着夜之力与火之力。持有者可以释放其中的火焰之力，发射毁灭性的光柱。',
                equipSlot: 'weapon',
                specialAttack: { cooldown: 10, damageMul: 0.25, width: 30, length: 700, duration: 3000, tickInterval: 200 }
            },
            backpackItems: [],
            updateInventorySlots() {
                const rarityLabelMap = { common: '普通', uncommon: '优质', rare: '稀有', epic: '史诗' };
                document.querySelectorAll('.inv-cell').forEach((cell, idx) => {
                    cell.classList.remove('occupied');
                    cell.innerHTML = '';
                    cell.dataset.itemName = '';
                    cell.dataset.slot = idx;
                    cell.draggable = false;
                    const item = this.backpackItems.find(i => i.slot === idx);
                    if (item) {
                        cell.classList.add('occupied');
                        cell.draggable = true;
                        cell.dataset.dragType = 'inventory';
                        cell.dataset.dragId = item.itemId || idx;
                        const imgSrc = item.slotImage || item.iconImage;
                        const rarityKey = item.rarity || 'common';
                        const rarityLabel = rarityLabelMap[rarityKey] || rarityKey;
                        if (imgSrc) {
                            cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div><img src="${imgSrc}" style="width:32px;height:32px;object-fit:cover;pointer-events:none;border-radius:4px;"><span class="inv-name">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack">${item.stack}</span>` : ''}`;
                        } else {
                            cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div>${item.icon || '❓'}<span class="inv-name">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack">${item.stack}</span>` : ''}`;
                        }
                        cell.dataset.itemName = item.name;
                    }
                    // 绑定拖放事件（所有格子都可作为放置目标）
                    this.bindDragToCell(cell);
                    // 右键事件：使用直接赋值覆盖旧值，避免 addEventListener 重复绑定导致卡死
                    const self = this;
                    cell.oncontextmenu = function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const idx = parseInt(cell.dataset.slot);
                        const item = self.backpackItems.find(i => i.slot === idx);
                        if (item) {
                            self.equipFromBackpack(idx);
                        }
                    };
                });
                const invCountEl = document.getElementById('invCount'); if (invCountEl) invCountEl.textContent = `${this.backpackItems.length}/36`;
                // 重新绑定tooltip（使用 onmouseenter/onmouseleave 直接赋值覆盖旧值）
                this.bindInventoryTooltip();
            }
        };
