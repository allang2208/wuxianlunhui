import { WallSystem } from './world/wall-system.js';
import { NPCDialogue } from './ui/npc-dialogue.js';
import { BackpackDialogManager } from './ui/backpack-dialog-manager.js';
import { EquipDataManager } from './ui/equip-data-manager.js';
import { GameUIManager } from './ui/game-ui-manager.js';
import { EnchantScrollItems, MagicDustItem } from './config/enchant-config.js';

export const Game = {
    VERSION: '0.192', // 游戏版本号（每次更新必须递增）
    isRunning: false, _paused: false, lastTime: 0, fps: 0, frameCount: 0, fpsTimer: 0, player: null, entities: new Map(), _pickupNearbyFlag: false,
    showAttackRange: false, // 攻击范围显示开关
    showHitbox: false, // 六边形碰撞盒调试显示开关
    _npcDialoguePaused: false,
    _gameStartTime: null, // 游戏开始时间戳
    _timerInterval: null, // 秒表定时器ID
    _portalCooldown: 0, // 传送门冷却时间戳
    init() { SoundManager.init(); Input.init(); Renderer.init(); SystemUI.init(); QuickBar.init(); GameUIManager.init(this.player); GameUIManager.initHitboxToggle(); GameUIManager.initAttackRangeToggle(); },
    async start() {
        try {
            // 自动同步版本号到页面
            const versionBadge = document.getElementById('versionBadge');
            if (versionBadge) versionBadge.textContent = 'V' + this.VERSION;
            // 防止重复启动：游戏已在运行时直接返回
            if (this.isRunning) {
                console.log('[Game.start] Already running, skipping');
                return;
            }
            console.log('[Game.start] Starting...');
            const menuLayer = document.getElementById('menuLayer'); const uiLayer = document.getElementById('uiLayer'); const gameLayer = document.getElementById('gameLayer'); if (menuLayer) menuLayer.classList.add('hidden'); if (uiLayer) uiLayer.style.display = 'block'; if (gameLayer) gameLayer.style.display = 'block';
            Renderer.generateWorld();
            // 初始化 Phaser 渲染系统（渐进式迁移）
            if (typeof PhaserGame !== 'undefined' && !PhaserGame.isReady) {
                PhaserGame.init();
            }
            await this.spawnPlayer();
            this.spawnTargets(); this.spawnEnemy(); this.spawnTestTargets(); this.spawnNPC();
            GameUIManager.startTimer();
            // 在主角右边地上生成手枪
            this.dropItem(CONFIG.WORLD_WIDTH/2 + 120, CONFIG.WORLD_HEIGHT/2, EquipDataManager.G18_PISTOL_ITEM);
            this.dropItem(CONFIG.WORLD_WIDTH/2 + 160, CONFIG.WORLD_HEIGHT/2, EquipDataManager.SAIGA12K_ITEM);
            // 在预设位置生成测试用弓、G18和骑士长剑、符文长剑
            this.spawnWeapon(EquipDataManager.TEST_BOW_ITEM);
            this.spawnWeapon(EquipDataManager.G18_PISTOL_ITEM);
            this.spawnWeapon(EquipDataManager.DESERT_EAGLE_ITEM);
            this.spawnWeapon(EquipDataManager.KINGHTS_SWORD_ITEM);
            this.spawnWeapon(EquipDataManager.RUNE_SWORD_ITEM);
            this.spawnWeapon(EquipDataManager.NIGHT_FLAME_SWORD_ITEM);
            this.spawnWeapon(EquipDataManager.PKM_ITEM);
            this.spawnWeapon(EquipDataManager.AKM_ITEM);
            this.spawnWeapon(EquipDataManager.QBZ191_ITEM);
            this.spawnWeapon(EquipDataManager.QJB201_ITEM);
            this.spawnWeapon(EquipDataManager.SUPER90_ITEM);
            // 在出生点附近生成所有附魔卷轴（供测试拾取）
            const scrollBaseX = CONFIG.WORLD_WIDTH / 2 + 200;
            const scrollBaseY = CONFIG.WORLD_HEIGHT / 2;
            this.dropItem(scrollBaseX, scrollBaseY, EnchantScrollItems.enchant_scroll_heavy);
            this.dropItem(scrollBaseX + 40, scrollBaseY, EnchantScrollItems.enchant_scroll_sharp);
            this.dropItem(scrollBaseX + 80, scrollBaseY, EnchantScrollItems.enchant_scroll_tarantula);
            this.dropItem(scrollBaseX + 120, scrollBaseY, EnchantScrollItems.enchant_scroll_skeleton);
            // 生成一些魔法晶尘（供测试）
            this.dropItem(CONFIG.WORLD_WIDTH / 2 + 200, CONFIG.WORLD_HEIGHT / 2 + 40, MagicDustItem);
            this.dropItem(CONFIG.WORLD_WIDTH / 2 + 240, CONFIG.WORLD_HEIGHT / 2 + 40, { ...MagicDustItem, stack: 999 });
            // EventBus 解耦：订阅 Player 的拾取事件（使用具名回调以便 toMenu 中取消订阅）
            this._onPickup = this._onPickup || ((px, py, range) => this.tryPickupItem(px, py, range));
            EventBus.off('player:pickup', this._onPickup); EventBus.on('player:pickup', this._onPickup);
            GameUIManager.setupWeaponSwitchButtons();
            // 生成左到右渐进显示参考特效（在 3478, 2363 位置），同时生成黑色测试区域标记
            EffectManager.add(new SweepEffect(3478, 2363, 100, 100, 10, 5000));
            EffectManager.add(new FloatingTextEffect(3478, 2363 - 20, '测试区域', '#000000'));
            // 初始化场景管理器
            SceneManager.init();
            // 在当前地图测试区域左边生成5个传送门（场景二至六）
            const portalBaseX = 3478;
            const portalBaseY = 2363;
            const portalSpacing = 100;
            const portalLabels = ['场景二', '场景三', '场景四', '场景五', '场景六'];
            const portalTargets = ['scene2', 'scene3', 'scene4', null, null];
            for (let i = 0; i < 5; i++) {
                const px = portalBaseX - (i + 1) * portalSpacing;
                const py = portalBaseY;
                const portal = new Portal(px, py, portalTargets[i], portalLabels[i]);
                this.entities.set(`portal_scene_${i + 2}`, portal);
                EffectManager.add(new FloatingTextEffect(px, py - 30, portalLabels[i], '#5a9a8a'));
            }
            this.isRunning = true; this.lastTime = performance.now(); this.loop(this.lastTime);
        } catch(e) {
            const el = document.createElement('div');
            el.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;bottom:10px;z-index:99999;background:rgba(0,0,0,0.95);color:#ff4444;font-family:monospace;font-size:14px;padding:20px;overflow:auto;white-space:pre-wrap;';
            el.textContent = 'ERROR: ' + e.message + '\n\nStack:\n' + e.stack;
            document.body.appendChild(el);
        }
    },
    async spawnPlayer() {
        const startX = CONFIG.WORLD_WIDTH / 2 + 120 - 200;
        const startY = CONFIG.WORLD_HEIGHT / 2 - 150;
        this.player = new Player(startX, startY);
        this.entities.set('player', this.player);
        // 修复：player 创建后才初始化 GameUIManager，否则 updateUI 会因 player 为 null 而直接返回
        GameUIManager.init(this.player);
        Camera.follow(this.player);
        await EquipManager.init(this.player);
        CodexManager.init();
    },
    spawnTargets() {
        // 靶子放在迷宫下方的开放平原（上方相对出生点）
        const cx = CONFIG.WORLD_WIDTH / 2;
        const mazeEndY = WallSystem.mazeEndY || CONFIG.WORLD_HEIGHT * 0.37;
        const startX = 3821, startY = 2365;
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
        // DPS测试靶子：无限生命值，显示DPS和总伤害（显示坐标 -581, 7 → 世界坐标 3244, 1879）
        const dpsTarget = new TargetDummy(3244, 1879, {
            hp: 999999, maxHp: 999999,
            size: 32, collisionRadius: 28,
            name: 'DPS测试靶',
            expValue: 0,
            dpsTracking: true
        });
        this.entities.set('dps_target', dpsTarget);
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
        // 在小鼠大王右侧生成5棵不同类型的树木（普通场景合集）
        const treeRadius = 25;
        const treeImages = ['assets/tree.png', 'assets/tree2.png', 'assets/tree3.png', 'assets/tree4.png', 'assets/tree5.png'];
        for (let i = 0; i < 5; i++) {
            const tx = npcX + 300 + i * 300;
            const ty = npcY + (i % 2 === 0 ? -20 : 20);
            WallSystem.addTree(tx, ty, treeRadius, i, treeImages[i], 'normal', Math.random() * Math.PI * 2);
        }
        // 在5棵旧树下方300px处生成3棵新雪地树木（雪地场景合集）
        const snowTreeImages = ['assets/scenes/snowtree1.png', 'assets/scenes/snowtree2.png', 'assets/scenes/snowtree3.png'];
        for (let i = 0; i < 3; i++) {
            const tx = npcX + 300 + i * 300;
            const ty = npcY + (i % 2 === 0 ? -20 : 20) + 300;
            WallSystem.addTree(tx, ty, treeRadius, 5 + i, snowTreeImages[i], 'snow', Math.random() * Math.PI * 2);
        }
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
        const baseX = -1356, baseY = 3;
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
                    if (EquipManager.backpackItems.length >= EquipManager.maxBackpackSlots) {
                        BackpackDialogManager._showBackpackFullNotice();
                        return false;
                    }
                    const added = EquipManager.addToBackpack(entity.itemData);
                    if (added) {
                        entity.active = false;
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                        picked = true;
                    }
                }
            }
        });
        return picked;
    },
    loop(timestamp) {
        if (!this.isRunning) return;
        if (this._paused) { this.lastTime = timestamp; requestAnimationFrame(t => this.loop(t)); return; }
        try {
            const dt = Math.max(0, Math.min(timestamp - this.lastTime, 100)); this.lastTime = timestamp;
            this.frameCount++; this.fpsTimer += dt;
            if (this.fpsTimer >= 1000) { this.fps = this.frameCount; this.frameCount = 0; this.fpsTimer = 0; }
            this.update(dt); this.render(); GameUIManager.updateUI(); Input.update();
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
                        const added = EquipManager.addToBackpack(entity.itemData);
                        if (added) {
                            entity.active = false;
                            this.entities.delete(key);
                            EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                            clickedPickup = true;
                            Input.mouse.leftPressed = false;
                        } else {
                            BackpackDialogManager._showBackpackFullNotice();
                        }
                    }
                }
            });
        }
        this.entities.forEach(e => { if (e.active) e.update(dt, this.entities); });
        // ===== 金币自动拾取 =====
        this.entities.forEach((entity, key) => {
            if (entity instanceof DropItem && entity.active && entity.itemData && entity.itemData.category === 'gold') {
                const dist = Math.sqrt((entity.x - this.player.x) ** 2 + (entity.y - this.player.y) ** 2);
                // 新增：扔出的金币需要先离开范围再回来才能拾取
                if (entity.itemData._droppedByPlayer) {
                    if (dist > 80) {
                        entity.itemData._wasOutOfRange = true;
                    }
                    if (!entity.itemData._wasOutOfRange) {
                        return; // 还在范围内，不拾取
                    }
                }
                if (dist <= 80) {
                    // Check if we can stack with existing gold
                    let stacked = false;
                    for (const bpItem of EquipManager.backpackItems) {
                        if (bpItem.category === 'gold' && bpItem.stack < (bpItem.maxStack || 999)) {
                            bpItem.stack += entity.itemData.stack;
                            entity.active = false;
                            this.entities.delete(key);
                            EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `+${entity.itemData.stack} 金币`, '#ffd700'));
                            if (typeof SoundManager !== 'undefined') {
                                SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                            }
                            stacked = true;
                            break;
                        }
                    }
                    if (!stacked) {
                        if (EquipManager.backpackItems.length >= EquipManager.maxBackpackSlots) {
                            BackpackDialogManager._showBackpackFullNotice();
                            return;
                        }
                        EquipManager.addToBackpack(entity.itemData);
                        entity.active = false;
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `+${entity.itemData.stack} 金币`, '#ffd700'));
                        if (typeof SoundManager !== 'undefined') {
                            SoundManager.playFile('assets/sounds/coins_wood_sharp.mp3');
                        }
                    }
                }
            }
        });
        // ===== 清理死亡实体（尸体）=====
        const now = Date.now();
        this.entities.forEach((entity, key) => {
            if (!entity.active && entity._deathTime && now - entity._deathTime > (entity._deathRemoveDelay || 0)) {
                this.entities.delete(key);
            }
        });
        this.resolveCollisions();
        EffectManager.update();
        // ===== 状态栏更新 =====
        if (typeof StatusBar !== 'undefined') {
            StatusBar.update(dt);
        }
        // 传送门检测：走入传送门范围（30px）自动传送，无碰撞体积，冷却2秒
        if (this.player && !SceneManager.isLoading) {
            const now = Date.now();
            if (now > this._portalCooldown) {
                this.entities.forEach(entity => {
                    if (entity.active && entity.targetScene) {
                        const dx = entity.x - this.player.x, dy = entity.y - this.player.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < 30) {
                            this._portalCooldown = now + 2000; // 2秒冷却
                            SceneManager.switchScene(entity.targetScene, this.player);
                        }
                    }
                });
            }
        }
        NPCDialogue.update();
        QuickBar.updateCooldowns(dt);
        // NPC 距离检测：离开 200px 自动关闭所有相关界面
        this._checkNPCDistance();
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
                        // 检查背包是否已满
                        if (EquipManager.backpackItems.length >= EquipManager.maxBackpackSlots) {
                            BackpackDialogManager._showBackpackFullNotice();
                            clickedPickup = true;
                            return;
                        }
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
        // NPC 距离检测：离开 200px 自动关闭所有相关界面
        this._checkNPCDistance();
        // NPC 对话逐字更新
        NPCDialogue.update();
        // 列车场景滚动背景
        if (SceneManager.currentScene === 'scene3') {
            if (!this._trainScrollOffset) this._trainScrollOffset = 0;
            this._trainScrollOffset += 500 * (dt / 1000);
        }
        // 雪地场景怪物定时生成
        if (SceneManager.currentScene === 'scene2') {
            if (!this._scene2SpawnTimer) this._scene2SpawnTimer = 0;
            this._scene2SpawnTimer += dt;
            if (this._scene2SpawnTimer >= 5000) {
                this._scene2SpawnTimer = 0;
                // 每次生成3只僵尸，在主角周围2000px范围内随机位置
                const spawnRadius = 2000;
                for (let i = 0; i < 3; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = spawnRadius; // 固定半径，圆周上生成
                    const sx = this.player.x + Math.cos(angle) * dist;
                    const sy = this.player.y + Math.sin(angle) * dist;
                    // 限制在地图边界内
                    const mx = Math.max(100, Math.min(CONFIG.WORLD_WIDTH - 100, sx));
                    const my = Math.max(100, Math.min(CONFIG.WORLD_HEIGHT - 100, sy));
                    // 概率：普通45%、奔跑20%、毒液10%、胖子10%、蜘蛛8%、狼蛛5%、育母3%
                    const rand = Math.random();
                    let monster;
                    if (rand < 0.45) monster = new window.Zombie(mx, my);
                    else if (rand < 0.65) monster = new window.RunnerZombie(mx, my);
                    else if (rand < 0.75) monster = new window.SpitterZombie(mx, my);
                    else if (rand < 0.85) monster = new window.FatZombie(mx, my);
                    else if (rand < 0.93) monster = new window.Spider(mx, my);
                    else if (rand < 0.98) monster = new window.WolfSpider(mx, my);
                    else monster = new window.BroodmotherSpider(mx, my);
                    Game.entities.set(`scene2_monster_${Date.now()}_${i}_${Math.random()}`, monster);
                }
            }
        }
    },
    _checkNPCDistance() {
        if (!this.player) return;
        let activeNPC = NPCDialogue._currentNPC;
        if (!activeNPC && ShopSystem._currentNPC) activeNPC = ShopSystem._currentNPC;
        if (!activeNPC && EnhanceSystem._currentNPC) activeNPC = EnhanceSystem._currentNPC;
        if (!activeNPC) return;
        const dx = activeNPC.x - this.player.x;
        const dy = activeNPC.y - this.player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 200) {
            NPCDialogue.close();
            ShopSystem.close();
            EnhanceSystem.close();
            SystemUI.close();
            LevelUpEffectQueue.clear();
        }
    },

    pickupNearbyItems() {
        const px = this.player.x, py = this.player.y;
        const range = 75; // 半径75px，直径150px的圆
        // 检查背包是否已满
        if (EquipManager.backpackItems.length >= EquipManager.maxBackpackSlots) {
            BackpackDialogManager._showBackpackFullNotice();
            return;
        }
        let pickedCount = 0;
        this.entities.forEach((entity, key) => {
            if (entity instanceof DropItem && entity.active) {
                const dx = entity.x - px, dy = entity.y - py;
                if (Math.sqrt(dx * dx + dy * dy) <= range) {
                    const added = EquipManager.addToBackpack(entity.itemData);
                    if (added) {
                        entity.active = false;
                        this.entities.delete(key);
                        EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                        pickedCount++;
                    }
                }
            }
        });
        if (pickedCount > 0) { EffectManager.add(new FloatingTextEffect(px, py - 40, `范围拾取 ${pickedCount} 件物品`)); } else { EffectManager.add(new FloatingTextEffect(px, py - 40, '范围内无物品')); }
    },
    // 实体碰撞体积解析：防止目标间堆叠（兼容六边形与圆形）
    resolveCollisions() {
        const entities = Array.from(this.entities.values()).filter(e => e.active && (e.size || e.collisionRadius || e.hitbox) && !e.noCollision);
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                const a = entities[i], b = entities[j];
                // 使用 getCollisionShape 获取兼容半径
                const shapeA = a.getCollisionShape ? a.getCollisionShape() : { type: 'circle', radius: a.size || a.collisionRadius || 10 };
                const shapeB = b.getCollisionShape ? b.getCollisionShape() : { type: 'circle', radius: b.size || b.collisionRadius || 10 };
                const aRadius = shapeA.radius;
                const bRadius = shapeB.radius;
                const minDist = aRadius + bRadius;
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0 && dist < minDist) {
                    const overlap = minDist - dist;
                    const ratio = overlap / dist / 2;
                    const moveX = dx * ratio, moveY = dy * ratio;
                    const wallRadiusA = a.collisionRadius || (a.hitbox ? a.hitbox.getApproxRadius() : aRadius * 0.6);
                    const wallRadiusB = b.collisionRadius || (b.hitbox ? b.hitbox.getApproxRadius() : bRadius * 0.6);
                    const na = WallSystem.resolve(a.x, a.y, a.x - moveX, a.y - moveY, wallRadiusA);
                    const nb = WallSystem.resolve(b.x, b.y, b.x + moveX, b.y + moveY, wallRadiusB);
                    a.x = na.x; a.y = na.y;
                    b.x = nb.x; b.y = nb.y;
                }
            }
        }
    },
    render() {
        if (SceneManager.currentScene === 'scene3') {
            Renderer.renderTrainBackground();
        } else {
            Renderer.clear();
        }
        // 重置 Canvas 变换矩阵，防止 Phaser 同步导致的 ctx 状态累积
        if (Renderer.ctx) Renderer.ctx.setTransform(1, 0, 0, 1, 0, 0);
        Renderer.renderTerrain();
        if (SceneManager.currentScene !== 'scene3' && SceneManager.currentScene !== 'scene2') {
            Renderer.renderGrid();
            MazeGenerator.render(Renderer.ctx, Camera.x - CONFIG.VIEW_WIDTH/2, Camera.y - CONFIG.VIEW_HEIGHT/2);
        }
        const sorted = Array.from(this.entities.values()).filter(e => e.active).sort((a, b) => a.y - b.y);
        // 实体渲染：每个实体自行处理 Phaser/Canvas 分层（body 由 Phaser 渲染，overlay 由 Canvas 渲染）
        sorted.forEach(e => e.render(Renderer.ctx));
        // 六边形碰撞盒调试渲染（showHitbox 开关控制）
        if (this.showHitbox) {
            sorted.forEach(e => {
                if (e.hitbox || e.renderCollisionRadius) {
                    e.renderCollisionRadius(Renderer.ctx);
                }
            });
        }
        EffectManager.render(Renderer.ctx);
        // 实体受击白光效果（统一渲染，覆盖所有怪物）
        sorted.forEach(e => {
            if (e.hitFlash > 0 && e !== this.player) {
                const flashAlpha = e.hitFlash / e.hitFlashDuration;
                const pos = Renderer.worldToScreen(e.x, e.y);
                Renderer.ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.6})`;
                Renderer.ctx.beginPath();
                Renderer.ctx.arc(pos.x, pos.y, e.size + 2, 0, Math.PI * 2);
                Renderer.ctx.fill();
            }
        });
        // 玩家受击屏幕红光效果
        if (this.player && this.player.hitFlash > 0) {
            const flashAlpha = this.player.hitFlash / this.player.hitFlashDuration;
            Renderer.ctx.fillStyle = `rgba(255, 30, 30, ${flashAlpha * 0.25})`;
            Renderer.ctx.fillRect(0, 0, CONFIG.VIEW_WIDTH, CONFIG.VIEW_HEIGHT);
        }
        // 树木在实体上方渲染（覆盖人物，但排除人物位置形成透视效果）
        if (SceneManager.currentScene !== 'scene3') {
            MazeGenerator.renderTrees(Renderer.ctx, Camera.x - CONFIG.VIEW_WIDTH/2, Camera.y - CONFIG.VIEW_HEIGHT/2);
        }
        // 绘制准星
        Renderer.drawCrosshair();
        Renderer.renderMinimap();
    },
};
