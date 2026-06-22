import { NPC } from './entities/npc.js';
import { NPCDialogue } from './ui/npc-dialogue.js';

export const Game = {
    isRunning: false, lastTime: 0, fps: 0, frameCount: 0, fpsTimer: 0, player: null, entities: new Map(), _pickupNearbyFlag: false,
    showAttackRange: false, // 攻击范围显示开关
    _npcDialoguePaused: false,
    _gameStartTime: null, // 游戏开始时间戳
    _timerInterval: null, // 秒表定时器ID
    init() { SoundManager.init(); Input.init(); Renderer.init(); SystemUI.init(); QuickBar.init(); this.initAttackRangeToggle(); },
    initAttackRangeToggle() {
        document.querySelectorAll('.attack-range-toggle').forEach(btn => {
            btn.onclick = () => {
                this.showAttackRange = !this.showAttackRange;
                document.querySelectorAll('.attack-range-toggle').forEach(b => b.classList.toggle('active', this.showAttackRange));
            };
        });
    },
    start() {
        try {
            // 防止重复启动：游戏已在运行时直接返回
            if (this.isRunning) {
                console.log('[Game.start] Already running, skipping');
                return;
            }
            console.log('[Game.start] Starting...');
            const menuLayer = document.getElementById('menuLayer'); const uiLayer = document.getElementById('uiLayer'); const gameLayer = document.getElementById('gameLayer'); if (menuLayer) menuLayer.classList.add('hidden'); if (uiLayer) uiLayer.style.display = 'block'; if (gameLayer) gameLayer.style.display = 'block';
            Renderer.generateWorld();
            this.spawnPlayer();
            this.spawnTargets(); this.spawnEnemy(); this.spawnTestTargets(); this.spawnNPC();
            this.startTimer();
            // 在主角右边地上生成手枪
            this.dropItem(CONFIG.WORLD_WIDTH/2 + 120, CONFIG.WORLD_HEIGHT/2, EquipManager.G18_PISTOL_ITEM);
            // 在预设位置生成测试用弓、G18和骑士长剑、符文长剑
            this.spawnWeapon(EquipManager.TEST_BOW_ITEM);
            this.spawnWeapon(EquipManager.G18_PISTOL_ITEM);
            this.spawnWeapon(EquipManager.KINGHTS_SWORD_ITEM);
            this.spawnWeapon(EquipManager.RUNE_SWORD_ITEM);
            this.spawnWeapon(EquipManager.NIGHT_FLAME_SWORD_ITEM);
            // EventBus 解耦：订阅 Player 的拾取事件（使用具名回调以便 toMenu 中取消订阅）
            this._onPickup = this._onPickup || ((px, py, range) => this.tryPickupItem(px, py, range));
            EventBus.off('player:pickup', this._onPickup); EventBus.on('player:pickup', this._onPickup);
            this.setupWeaponSwitchButtons();
            // 生成左到右渐进显示参考特效（在 3478, 2363 位置），同时生成黑色测试区域标记
            EffectManager.add(new SweepEffect(3478, 2363, 100, 100, 10, 5000));
            EffectManager.add(new FloatingTextEffect(3478, 2363 - 20, '测试区域', '#000000'));
            this.isRunning = true; this.lastTime = performance.now(); this.loop(this.lastTime);
        } catch(e) {
            const el = document.createElement('div');
            el.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;bottom:10px;z-index:99999;background:rgba(0,0,0,0.95);color:#ff4444;font-family:monospace;font-size:14px;padding:20px;overflow:auto;white-space:pre-wrap;';
            el.textContent = 'ERROR: ' + e.message + '\n\nStack:\n' + e.stack;
            document.body.appendChild(el);
        }
    },
    spawnPlayer() {
        const startX = 5104;
        const startY = 2520;
        this.player = new Player(startX, startY);
        this.entities.set('player', this.player);
        Camera.follow(this.player);
        EquipManager.init(this.player);
        CodexManager.init();
    },
    spawnTargets() {
        // 靶子放在迷宫下方的开放平原（上方相对出生点）
        const cx = CONFIG.WORLD_WIDTH / 2;
        const mazeEndY = WallSystem.mazeEndY || CONFIG.WORLD_HEIGHT * 0.37;
        const startX = cx - 120, startY = mazeEndY + 200;
        const cols = 3, rows = 3, spacing = 120;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c;
                const tx = startX + c * spacing, ty = startY + r * spacing;
                const target = new TargetDummy(tx, ty, { hp: 150 + i * 30, maxHp: 150 + i * 30, name: `训练靶 ${i + 1}` });
                this.entities.set(`target_${i}`, target);
            }
        }
    },
    spawnEnemy() {
        // 敌人放在出生点右侧，优先从 JSON 加载配置
        const cx = CONFIG.WORLD_WIDTH / 2, cy = CONFIG.WORLD_HEIGHT / 2;
        let enemyConfig = { hp: 200, maxHp: 200, speed: 0.25, name: '测试敌人' };
        if (typeof window !== 'undefined' && window.ENEMY_DATA) {
            const keys = Object.keys(window.ENEMY_DATA);
            if (keys.length > 0) {
                const data = window.ENEMY_DATA[keys[0]];
                enemyConfig = {
                    hp: data.hp || 200, maxHp: data.maxHp || 200,
                    speed: data.speed || 0.25, name: data.name || '测试敌人',
                    size: data.size, expValue: data.expValue
                };
            }
        }
        const enemy = new Enemy(cx + 500, cy, enemyConfig);
        this.entities.set('enemy', enemy);
    },
    spawnNPC() {
        const npcX = CONFIG.WORLD_WIDTH / 2 + 120;
        const npcY = CONFIG.WORLD_HEIGHT / 2 - 150;
        const npc = new NPC(npcX, npcY, {
            name: '小鼠大王',
            size: 20,
            collisionRadius: 14,
            color: '#c4a35a',
            portrait: 'assets/ui/npc_portrait.png',
            greetings: [
                '你好，冒险者！欢迎来到无限轮回。',
                '今天的天空格外晴朗呢。',
                '你看起来很强，要不要来商店看看？',
                '我听说最近在附近出现了一些奇怪的怪物。',
                '如果你需要强化装备，我可以帮你。',
                '你收集了多少战利品了？',
                '这个地方有时候会很危险，要小心。',
                '新鲜的货物刚到，快来看看！',
                '循环的世界永远不会无聊，对吧？',
                '你看起来需要帮助，有什么我可以做的吗？'
            ]
        });
        this.entities.set('npc_test', npc);
    },
    spawnTestTargets() {
        // 在坐标(4379, 2411)生成20个10HP不会移动的测试目标
        const baseX = 4379, baseY = 2411;
        const spacing = 60; // 间隔60px，避免堆叠
        const perRow = 5;
        for (let i = 0; i < 20; i++) {
            const row = Math.floor(i / perRow);
            const col = i % perRow;
            const tx = baseX + col * spacing;
            const ty = baseY + row * spacing;
            const target = new TargetDummy(tx, ty, { hp: 10, maxHp: 10, size: 14, collisionRadius: 10, name: `测试目标${i + 1}`, expValue: 10 });
            this.entities.set(`test_target_${i}`, target);
        }
    },
    dropItem(x, y, itemTemplate) {
        // 通过 ItemFactory 创建独立物品实例
        const itemInstance = ItemFactory.create(itemTemplate);
        const drop = new DropItem(x, y, itemInstance);
        this.entities.set('drop_' + Date.now() + '_' + Math.floor(Math.random() * 1000), drop);
    },
    // 武器生成位置管理器：从(5461, 2613)开始，向右排列，每10件向下200单位
    _weaponSpawnIndex: 0,
    spawnWeapon(itemTemplate) {
        const baseX = 5461, baseY = 2613;
        const col = this._weaponSpawnIndex % 10;
        const row = Math.floor(this._weaponSpawnIndex / 10);
        const x = baseX + col * 100;
        const y = baseY + row * 200;
        this.dropItem(x, y, itemTemplate);
        this._weaponSpawnIndex++;
        return { x, y };
    },
    tryPickupItem(px, py, range) {
        let picked = false;
        this.entities.forEach((entity, key) => {
            if (picked) return;
            if (entity instanceof DropItem && entity.active) {
                const dx = entity.x - px, dy = entity.y - py;
                if (Math.sqrt(dx * dx + dy * dy) <= range) {
                    // 添加到背包
                    EquipManager.addToBackpack(entity.itemData);
                    entity.active = false;
                    this.entities.delete(key);
                    // SoundManager.play('pickup');
                    // 显示拾取提示
                    EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                    picked = true;
                }
            }
        });
        return picked;
    },
    loop(timestamp) {
        if (!this.isRunning) return;
        try {
            const dt = Math.max(0, Math.min(timestamp - this.lastTime, 100)); this.lastTime = timestamp;
            this.frameCount++; this.fpsTimer += dt;
            if (this.fpsTimer >= 1000) { this.fps = this.frameCount; this.frameCount = 0; this.fpsTimer = 0; }
            this.update(dt); this.render(); this.updateUI(); Input.update();
        } catch (e) {
            console.error('Game loop error:', e);
        }
        requestAnimationFrame(t => this.loop(t));
    },
    update(dt) {
        Camera.update(this.player);
        if (Input.mouse.leftPressed) {
            // NPC 对话检测（优先于拾取）
            if (NPCDialogue.active) {
                NPCDialogue.skip();
                Input.mouse.leftPressed = false;
                return;
            }
            let clickedNPC = false;
            this.entities.forEach((entity) => {
                if (clickedNPC) return;
                if (entity instanceof NPC && entity.active) {
                    const pdx = entity.x - this.player.x, pdy = entity.y - this.player.y;
                    const playerDist = Math.sqrt(pdx * pdx + pdy * pdy);
                    if (playerDist > 200) return;
                    const pos = Renderer.worldToScreen(entity.x, entity.y);
                    const mx = Input.mouse.x, my = Input.mouse.y;
                    const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - pos.y) * (my - pos.y)) < 40;
                    if (hover) {
                        NPCDialogue.open(entity);
                        clickedNPC = true;
                        Input.mouse.leftPressed = false;
                    }
                }
            });
            if (clickedNPC) return;
        }
        // === 拾取逻辑优先：在 entities 更新之前处理，避免 Player.update() 消耗 leftPressed ===
        if (Input.mouse.leftPressed) {
            let clickedPickup = false;
            // NPC 点击检测（第二处）
            let clickedNPC2 = false;
            this.entities.forEach((entity) => {
                if (clickedNPC2) return;
                if (entity instanceof NPC && entity.active) {
                    const pdx = entity.x - this.player.x, pdy = entity.y - this.player.y;
                    const playerDist = Math.sqrt(pdx * pdx + pdy * pdy);
                    if (playerDist > 200) return;
                    const pos = Renderer.worldToScreen(entity.x, entity.y);
                    const mx = Input.mouse.x, my = Input.mouse.y;
                    const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - pos.y) * (my - pos.y)) < 40;
                    if (hover) {
                        NPCDialogue.open(entity);
                        clickedNPC2 = true;
                    }
                }
            });
            if (clickedNPC2) return;
            this.entities.forEach((entity, key) => {
                if (clickedPickup) return;
                if (entity instanceof DropItem && entity.active) {
                    // 检查玩家与装备距离是否 <= 150px
                    const pdx = entity.x - this.player.x, pdy = entity.y - this.player.y;
                    const playerDist = Math.sqrt(pdx * pdx + pdy * pdy);
                    if (playerDist > 150) return;
                    // 检查鼠标是否悬停在装备上（金色特效区域，与render中的hover一致）
                    const pos = Renderer.worldToScreen(entity.x, entity.y);
                    const bobY = Math.sin(entity.bobOffset) * 4;
                    const mx = Input.mouse.x, my = Input.mouse.y;
                    const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - (pos.y + bobY)) * (my - (pos.y + bobY))) < 35;
                    if (hover) {
                        EquipManager.addToBackpack(entity.itemData);
                        entity.active = false;
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                        clickedPickup = true;
                        Input.mouse.leftPressed = false; // 拾取成功，消耗左键点击
                    }
                }
            });
        }
        this.entities.forEach(e => { if (e.active) e.update(dt, this.entities); });
        this.resolveCollisions();
        EffectManager.update();
        NPCDialogue.update();
        QuickBar.updateCooldowns(dt);
        // 鼠标悬停+点击拾取：鼠标移动到装备上触发金色特效，且在150px范围内，点击左键拾取
        if (Input.mouse.leftPressed) {
            let clickedPickup = false;
            this.entities.forEach((entity, key) => {
                if (clickedPickup) return;
                if (entity instanceof DropItem && entity.active) {
                    // 检查玩家与装备距离是否 <= 150px
                    const pdx = entity.x - this.player.x, pdy = entity.y - this.player.y;
                    const playerDist = Math.sqrt(pdx * pdx + pdy * pdy);
                    if (playerDist > 150) return;
                    // 检查鼠标是否悬停在装备上（金色特效区域，与render中的hover一致）
                    const pos = Renderer.worldToScreen(entity.x, entity.y);
                    const bobY = Math.sin(entity.bobOffset) * 4;
                    const mx = Input.mouse.x, my = Input.mouse.y;
                    const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - (pos.y + bobY)) * (my - (pos.y + bobY))) < 35;
                    if (hover) {
                        EquipManager.addToBackpack(entity.itemData);
                        entity.active = false;
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                        clickedPickup = true;
                    }
                }
            });
        }
        // Z键范围拾取：检测并执行
        if (this._pickupNearbyFlag) { this._pickupNearbyFlag = false; this.pickupNearbyItems(); }
        // NPC 对话逐字更新
        NPCDialogue.update();
    },
    pickupNearbyItems() {
        const px = this.player.x, py = this.player.y;
        const range = 75; // 半径75px，直径150px的圆
        let pickedCount = 0;
        this.entities.forEach((entity, key) => {
            if (entity instanceof DropItem && entity.active) {
                const dx = entity.x - px, dy = entity.y - py;
                if (Math.sqrt(dx * dx + dy * dy) <= range) {
                    EquipManager.addToBackpack(entity.itemData);
                    entity.active = false;
                    this.entities.delete(key);
                    EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                    pickedCount++;
                }
            }
        });
        if (pickedCount > 0) { EffectManager.add(new FloatingTextEffect(px, py - 40, `范围拾取 ${pickedCount} 件物品`)); } else { EffectManager.add(new FloatingTextEffect(px, py - 40, '范围内无物品')); }
    },
    // 实体碰撞体积解析：防止目标间堆叠
    resolveCollisions() {
        const entities = Array.from(this.entities.values()).filter(e => e.active && (e.size || e.collisionRadius));
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                const a = entities[i], b = entities[j];
                const aRadius = a.size || a.collisionRadius || 10;
                const bRadius = b.size || b.collisionRadius || 10;
                const minDist = aRadius + bRadius;
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0 && dist < minDist) {
                    const overlap = minDist - dist;
                    const ratio = overlap / dist / 2;
                    const moveX = dx * ratio, moveY = dy * ratio;
                    // 使用 WallSystem.resolve 确保新位置不卡在墙里
                    const na = WallSystem.resolve(a.x, a.y, a.x - moveX, a.y - moveY, a.collisionRadius || aRadius * 0.6);
                    const nb = WallSystem.resolve(b.x, b.y, b.x + moveX, b.y + moveY, b.collisionRadius || bRadius * 0.6);
                    a.x = na.x; a.y = na.y;
                    b.x = nb.x; b.y = nb.y;
                }
            }
        }
    },
    render() {
        Renderer.clear(); Renderer.renderTerrain(); Renderer.renderGrid();
        MazeGenerator.render(Renderer.ctx, Camera.x - CONFIG.VIEW_WIDTH/2, Camera.y - CONFIG.VIEW_HEIGHT/2);
        const sorted = Array.from(this.entities.values()).filter(e => e.active).sort((a, b) => a.y - b.y);
        sorted.forEach(e => e.render(Renderer.ctx)); EffectManager.render(Renderer.ctx);
    },
    updateUI() {
        if (!this.player) return;
        const d = this.player.data, p = this.player;
        // 数据驱动更新顶部栏
        UI_DATA_CONFIG.topBar.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) el.textContent = item.getValue(p);
        });
        // 数据驱动更新顶部状态栏 (HP/MP)
        UI_DATA_CONFIG.topStatus.forEach(item => {
            const bar = document.getElementById(item.barId);
            const val = document.getElementById(item.valId);
            if (bar) bar.style.width = item.getPercent(d);
            if (val) val.textContent = item.getValue(d);
        });
        // 攻击冷却指示器
        const currentItem = p.equipments[p.weaponMode];
        let attackType = 'melee';
        if (currentItem) {
            if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackType = 'pistol';
            else if (currentItem.weaponType === 'bow') attackType = 'ranged';
        }
        const currentAttack = p.attacks[attackType];
        const attackCD = currentAttack.getCooldownPercent();
        const cdOverlay = document.getElementById('cdAttackOverlay');
        if (cdOverlay) cdOverlay.style.height = (attackCD * 100) + '%';
        const cdAttack = document.getElementById('cdAttack');
        if (cdAttack) cdAttack.classList.toggle('ready', attackCD <= 0);
        let attackIcon = '⚔';
        if (currentItem) {
            if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackIcon = '🔫';
            else if (currentItem.weaponType === 'bow') attackIcon = '🏹';
        }
        const attackLabel = p.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
        if (cdAttack && cdAttack.childNodes[0]) cdAttack.childNodes[0].textContent = attackIcon;
        const attackLabelEl = document.getElementById('attackLabel');
        if (attackLabelEl) attackLabelEl.textContent = attackLabel;
        // 底部状态条更新
        const hpBar = document.getElementById('hpBar'), hpText = document.getElementById('hpText');
        const staminaBar = document.getElementById('staminaBar'), staminaText = document.getElementById('staminaText');
        if (hpBar) hpBar.style.width = (d.maxHp ? (d.hp / d.maxHp * 100) : 0) + '%';
        if (hpText) hpText.textContent = `${Math.ceil(d.hp)}/${d.maxHp}`;
        if (staminaBar) staminaBar.style.width = (d.maxStamina ? (d.stamina / d.maxStamina * 100) : 0) + '%';
        if (staminaText) staminaText.textContent = `${Math.ceil(d.stamina)}/${d.maxStamina}`;
        // 武器信息显示
        const weaponModeEl = document.getElementById('weaponMode'), weaponNameEl = document.getElementById('weaponName');
        if (weaponModeEl) weaponModeEl.textContent = p.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
        // 武器栏指示器（红色边框表示当前使用的武器栏）
        if (weaponModeEl) {
            weaponModeEl.style.color = p.weaponMode === 'weapon' ? '#7a9a6a' : '#7a8aaa';
            weaponModeEl.style.fontWeight = '700';
        }
        if (weaponNameEl) {
            const weaponItem = p.equipments[p.weaponMode];
            weaponNameEl.textContent = weaponItem ? weaponItem.name : '空手';
        }
        // 数据驱动更新状态面板
        const sp = UI_DATA_CONFIG.statusPage;
        // 头部信息（面板可能未打开，元素可能为null）
        const charNameEl = document.getElementById('charName');
        const charClassEl = document.getElementById('charClass');
        const charLevelEl = document.getElementById('charLevel');
        if (charNameEl) charNameEl.textContent = d.name;
        if (charClassEl) charClassEl.textContent = d.class;
        if (charLevelEl) charLevelEl.textContent = 'Lv.' + d.level;
        // 显示属性点
        const attrPointsEl = document.getElementById('attrPoints');
        if (attrPointsEl) attrPointsEl.textContent = '属性点: ' + d.attrPoints;
        // 显示/隐藏属性加号按钮
        const attrPlusBtns = document.querySelectorAll('.attr-plus');
        attrPlusBtns.forEach(btn => {
            btn.style.display = (d.attrPoints > 0) ? 'inline-flex' : 'none';
        });
        sp.bars.forEach(item => {
            const bar = document.getElementById(item.barId);
            const val = document.getElementById(item.valId);
            if (bar) bar.style.width = item.getPercent(d);
            if (val) val.textContent = item.getValue(d);
        });
        sp.baseAttrs.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) el.textContent = d[item.key];
        });
        sp.combatAttrs.forEach(item => {
            const el = document.getElementById(item.id);
            if (!el) return;
            if (item.id === 'combatAtk') {
                // 物理攻击：从当前武器实时计算
                el.textContent = p.getCurrentWeaponAtk();
            } else if (item.id === 'combatCrit') {
                // 暴击率：基础值 + 武器加成
                const baseCrit = p.data.crit || 0;
                const currentWpn = p.equipments[p.weaponMode];
                let weaponCrit = 0;
                if (currentWpn && currentWpn.stats) {
                    const critStat = currentWpn.stats.find(s => (s.name || s.label) === '暴击率');
                    if (critStat && critStat.value) {
                        const match = String(critStat.value).match(/\d+/);
                        if (match) weaponCrit = parseInt(match[0]);
                    }
                }
                el.textContent = (baseCrit + weaponCrit) + '%';
            } else if (item.id === 'combatAspd') {
                // 攻击间隔：根据当前武器显示实际毫秒数
                const currentWpn = p.equipments[p.weaponMode];
                let cd = p.attacks.melee.maxCooldown; // 默认近战
                if (currentWpn) {
                    if (currentWpn.weaponType === 'pistol' || currentWpn.rangedType === 'pistol') cd = p.attacks.pistol.maxCooldown;
                    else if (currentWpn.weaponType === 'bow') cd = p.attacks.ranged.maxCooldown;
                }
                el.textContent = Math.round(cd) + 'ms';
            } else if (item.id === 'combatSpd') {
                // 移动速度：px/s（假设60fps，每帧速度*60）
                const speed = p.data.speed || 0;
                el.textContent = (speed * 60).toFixed(0) + 'px/s';
            } else {
                el.textContent = item.suffix ? d[item.key] + item.suffix : (item.fixed ? d[item.key].toFixed(item.fixed) : d[item.key]);
            }
        });
        sp.loopInfo.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) el.textContent = d[item.key];
        });
        // 详细属性渲染
        sp.detailAttrs.forEach(item => {
            const el = document.getElementById(item.id);
            if (!el) return;
            const currentWpn = p.equipments[p.weaponMode];
            let paType = 'melee';
            if (currentWpn) {
                if (currentWpn.weaponType === 'pistol' || currentWpn.rangedType === 'pistol') paType = 'pistol';
                else if (currentWpn.weaponType === 'bow') paType = 'ranged';
            }
            const pa = p.attacks[paType];
            switch (item.id) {
                case 'detailStaminaRegen': el.textContent = CONFIG.STAMINA_REGEN + item.unit; break;
                case 'detailCollisionRadius': el.textContent = (p.collisionRadius || 10) + item.unit; break;
                case 'detailMoveSpeed': el.textContent = CONFIG.PLAYER_SPEED + item.unit; break;
                case 'detailDodgeCooldown': el.textContent = CONFIG.DODGE_COOLDOWN + item.unit; break;
                case 'detailAttackRange': el.textContent = (pa ? pa.config.range : 100) + item.unit; break;
                case 'detailKnockback': el.textContent = (pa ? pa.config.knockback : 20) + item.unit; break;
                case 'detailViewRange': el.textContent = CONFIG.VIEW_WIDTH + item.unit; break;
            }
        });
    },
    load() {
        const save = localStorage.getItem('infiniteLoop_save');
        if (save) { let data; try { data = JSON.parse(save); } catch (e) { console.error('Load failed:', e); EffectManager.add(new FloatingTextEffect(this.player ? this.player.x : CONFIG.WORLD_WIDTH/2, this.player ? this.player.y - 20 : CONFIG.WORLD_HEIGHT/2, '读档失败: 存档损坏')); return; } alert(`读取存档: ${data.player?.name || '未知'}\n等级: ${data.player?.level || 1}`); }
        else alert('没有找到存档');
    },
    save() {
        if (!this.player) return;
        const saveData = { version: '1.0', timestamp: Date.now(), player: this.player.data, position: { x: this.player.x, y: this.player.y } };
        try { localStorage.setItem('infiniteLoop_save', JSON.stringify(saveData)); alert('已保存至主神空间'); } catch (e) { console.error('Save failed:', e); alert('存档失败: 存储空间不足'); }
    },
    showHelp() { alert('WASD移动 | 鼠标瞄准 | 左键攻击 | F切换武器\nC打开装备栏 | 空格闪避 | Shift冲刺'); },
    startTimer() {
        this._gameStartTime = Date.now();
        const timerEl = document.getElementById('gameTimer');
        if (timerEl) timerEl.style.display = 'flex';
        const textEl = document.getElementById('timerText');
        if (textEl) textEl.textContent = '00:00:00';
        this._timerInterval = setInterval(() => {
            if (!this._gameStartTime) return;
            const elapsed = Date.now() - this._gameStartTime;
            const tEl = document.getElementById('timerText');
            if (tEl) tEl.textContent = this._formatTime(elapsed);
        }, 1000);
    },
    stopTimer() {
        if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
        this._gameStartTime = null;
        const timerEl = document.getElementById('gameTimer');
        if (timerEl) timerEl.style.display = 'none';
        const textEl = document.getElementById('timerText');
        if (textEl) textEl.textContent = '00:00:00';
    },
    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const pad = n => n.toString().padStart(2, '0');
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    },
    toMenu() {
        this.stopTimer();
        this.isRunning = false; this.entities.clear(); this.player = null; SystemUI.close();
        if (typeof NPCDialogue !== 'undefined') NPCDialogue.close();
        if (typeof ShopSystem !== 'undefined') ShopSystem.close();
        if (typeof EnhanceSystem !== 'undefined') EnhanceSystem.close();
        // EventBus 解耦：取消拾取事件订阅，避免重复
        if (this._onPickup) EventBus.off('player:pickup', this._onPickup);
        const menuLayer = document.getElementById('menuLayer'); const uiLayer = document.getElementById('uiLayer'); const gameLayer = document.getElementById('gameLayer'); if (menuLayer) menuLayer.classList.remove('hidden'); if (uiLayer) uiLayer.style.display = 'none'; if (gameLayer) gameLayer.style.display = 'none';
    },
    setupWeaponSwitchButtons() {
        // quickMelee/quickRanged buttons are optional; weapon switching via F key always works
    }
};
