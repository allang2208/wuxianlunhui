import { Portal } from './portal.js';
import { BlackWolf } from '../entities/enemy-types.js';
import FormationSystem from '../systems/formation-system.js';
import { DungeonMapSystem } from './dungeon-map-system.js';
import { ExpeditionSystem } from '../ui/expedition-system.js';

export const SceneManager = {
    currentScene: null,
    scenes: {},
    isLoading: false,
    loadProgress: 0,
    _sceneLabel: null, // 当前场景名称标签

    init() {
        this.scenes = {
            main: { name: '主神空间', type: 'main', label: '场景一', origin: { x: 3825, y: 1886 } },
            scene2: { name: '雪地', type: 'instance', width: 9000, height: 9000, background: '#b8c0c8', label: '场景二', origin: { x: 4500, y: 4500 } },
            scene3: { name: '列车上', type: 'instance', width: 3000, height: 1200, background: '#4a4538', label: '场景三', origin: { x: 1500, y: 600 } },
            scene4: { name: '古堡', type: 'instance', width: 9000, height: 9000, background: '#000000', label: '场景四', origin: { x: 4500, y: 4500 } },
            scene5: { name: 'AI测试场', type: 'instance', width: 6120, height: 3040, background: '#3a3a3a', label: '场景五', origin: { x: 3060, y: 1520 } },
            scene7: { name: '僵尸地牢', type: 'dungeon', width: 1024, height: 1024, background: '#000000', label: '场景七', origin: { x: 512, y: 512 }, dungeonType: 'zombie' }
        };
    },

    showLoadingScreen() {
        this.isLoading = true;
        this.loadProgress = 0;
        let overlay = document.getElementById('loadingOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loadingOverlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#1a1a1a;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity 0.3s;font-family:SimHei, "Microsoft YaHei", sans-serif;';
            overlay.innerHTML = `
                <div style="color:#d4c5a9;font-size:28px;margin-bottom:30px;">场景加载中...</div>
                <div style="width:400px;height:20px;background:#3a3a3a;border-radius:10px;overflow:hidden;border:2px solid #5a4a3a;">
                    <div id="loadingProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg, #6a8a5a, #8aaa7a);transition:width 0.2s;"></div>
                </div>
                <div id="loadingProgressText" style="color:#8a8a8a;font-size:14px;margin-top:10px;">0%</div>
            `;
            document.body.appendChild(overlay);
        } else {
            overlay.style.display = 'flex';
            overlay.style.opacity = '1';
        }
    },

    hideLoadingScreen() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.style.display = 'none'; }, 300);
        }
        this.isLoading = false;
    },

    setProgress(pct) {
        this.loadProgress = Math.min(100, Math.max(0, pct));
        const bar = document.getElementById('loadingProgressBar');
        const text = document.getElementById('loadingProgressText');
        if (bar) bar.style.width = this.loadProgress + '%';
        if (text) text.textContent = Math.floor(this.loadProgress) + '%';
    },

    async switchScene(sceneId, player, mode) {
        console.log('[switchScene] sceneId=', sceneId, 'currentScene=', this.currentScene, 'mode=', mode, '_enterMode=', this._enterMode);
        if (this.isLoading || this.currentScene === sceneId) {
            console.log('[switchScene] blocked: isLoading=', this.isLoading, 'currentScene===sceneId=', this.currentScene === sceneId);
            return;
        }
        try {
            this.showLoadingScreen();
            this._enterMode = mode || 'explore'; // 'quest' | 'explore'

            const scene = this.scenes[sceneId];
            if (!scene) {
                console.error('Scene not found:', sceneId);
                this.hideLoadingScreen();
                return;
            }

            this.setProgress(10);
            await this.delay(100);
            this.setProgress(30);

            // 保存当前场景状态
            if (this.currentScene === 'main') {
                this._saveMainSceneState();
            }

            // 离开列车场景时解锁相机Y轴
            if (this.currentScene === 'scene3') {
                Camera.lockY = false;
                Camera.yLockedValue = 0;
            }

            this.setProgress(50);
            await this.delay(100);

            // 清理当前场景
            Game.entities.clear();
            EffectManager.effects = [];
            // 清除战术小队AI
            if (Game._tacticalSquadAI) Game._tacticalSquadAI.clear();
            // 清除 Phaser 层的旧 Sprite
            const phaserScene = window.__phaserScene;
            if (phaserScene && phaserScene.clearAllEntitySprites) {
                phaserScene.clearAllEntitySprites();
            }
            // 清除裂隙系统
            if (typeof RiftSystem !== 'undefined') RiftSystem.clear();

            // 销毁无人机并触发CD
            if (player && player.droneSystem && player.droneSystem.active) {
                player.droneSystem._deactivate();
                // 设置无人机技能CD
                if (typeof QuickBar !== 'undefined' && player.skills && player.skills.droneSkill) {
                    const effect = player.skills.droneSkill.getEffect(player.skills.droneSkill.level);
                    QuickBar.cooldowns['droneSkill'] = (effect.cooldown || 15) * 1000;
                }
            }

            this.setProgress(70);
            await this.delay(100);

            // 加载新场景
            if (sceneId === 'scene2') {
                this._loadScene2(player, this._enterMode);
            } else if (sceneId === 'scene3') {
                this._loadScene3(player);
            } else if (sceneId === 'scene4') {
                this._loadScene4(player);
            } else if (sceneId === 'scene5') {
                this._loadScene5(player);
            } else if (sceneId === 'scene7') {
                this._loadScene7(player, 'zombie');
            } else if (sceneId === 'main') {
                this._loadMainScene(player);
            }

            this.setProgress(100);
            await this.delay(200);

            this.currentScene = sceneId;
            this.hideLoadingScreen();
            // 显示场景名称
            this._showSceneLabel(scene.name);
        } catch (err) {
            console.error('[switchScene] ERROR:', err);
            this.isLoading = false;
            this.hideLoadingScreen();
            // 恢复当前场景的实体（如果 _mainEntities 存在）
            if (this._mainEntities) {
                Game.entities = this._mainEntities;
                if (player) Game.entities.set('player', player);
            }
            throw err;
        }
    },

    _showSceneLabel(name) {
        // 移除旧标签
        if (this._sceneLabel) {
            this._sceneLabel.remove();
            this._sceneLabel = null;
        }
        const label = document.createElement('div');
        label.style.cssText = 'position:fixed;top:210px;left:50%;transform:translateX(-50%);color:#d4c5a9;font-size:48px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,0.8);z-index:5000;pointer-events:none;animation:sceneLabelFade 3s ease-out forwards;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;';
        label.textContent = name;
        document.body.appendChild(label);
        this._sceneLabel = label;
        setTimeout(() => { if (label && label.parentNode) label.remove(); }, 3000);
    },

    _saveMainSceneState() {
        this._mainEntities = new Map(Game.entities);
        this._mainPlayerPos = Game.player ? { x: Game.player.x, y: Game.player.y } : null;
        // 保存所有树木（不限于 sceneGroup，避免遗漏）
        this._mainTrees = WallSystem.trees ? WallSystem.trees.map(t => ({ ...t })) : [];
    },

    _loadScene2(player, mode) {
        console.log('[_loadScene2] player=', player, 'mode=', mode, 'isQuestMode=', mode === 'quest');
        const scene = this.scenes.scene2;
        const isQuestMode = mode === 'quest';
        CONFIG.WORLD_WIDTH = scene.width;
        CONFIG.WORLD_HEIGHT = scene.height;

        // 雪地地形纹理
        const canvas = document.createElement('canvas');
        canvas.width = scene.width;
        canvas.height = scene.height;
        const ctx = canvas.getContext('2d');
        // 白色雪地背景（降低亮度）
        ctx.fillStyle = '#b8c0c8';
        ctx.fillRect(0, 0, scene.width, scene.height);
        // 雪地纹理噪点
        for (let i = 0; i < 20000; i++) {
            const x = Math.random() * scene.width, y = Math.random() * scene.height;
            const size = Math.random() * 2 + 1;
            const alpha = Math.random() * 0.1 + 0.05;
            ctx.fillStyle = Math.random() > 0.5 ? `rgba(200, 210, 220, ${alpha})` : `rgba(180, 190, 200, ${alpha})`;
            ctx.fillRect(x, y, size, size);
        }
        // 雪地中的暗色区域（模仿阴影）
        for (let i = 0; i < 500; i++) {
            const x = Math.random() * scene.width, y = Math.random() * scene.height;
            const rx = 20 + Math.random() * 60, ry = 10 + Math.random() * 30;
            ctx.fillStyle = `rgba(160, 170, 180, ${Math.random() * 0.15 + 0.05})`;
            ctx.beginPath(); ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
        }
        Renderer.terrainTexture = canvas;

        // 重置墙壁系统并添加边界
        WallSystem.init(scene.width, scene.height);
        WallSystem.walls = [
            { x: -10, y: -10, w: scene.width + 20, h: 10 },
            { x: -10, y: scene.height, w: scene.width + 20, h: 10 },
            { x: -10, y: -10, w: 10, h: scene.height + 20 },
            { x: scene.width, y: -10, w: 10, h: scene.height + 20 }
        ];

        // 生成石块障碍物（墙壁） — 雪地场景已移除，改为树木
        /* for (let i = 0; i < 60; i++) { ... } */
        // 生成树枝/树干障碍物 — 雪地场景已移除
        /* for (let i = 0; i < 40; i++) { ... } */

        // 雪地场景：随机生成100棵雪地树木（最小距离500px，随机朝向）
        const treeRadius = 25;
        const snowTrees = [];
        for (let i = 0; i < 100; i++) {
            let tx, ty, distOk;
            let attempts = 0;
            do {
                tx = 200 + Math.random() * (scene.width - 400);
                ty = 200 + Math.random() * (scene.height - 400);
                distOk = true;
                for (const t of snowTrees) {
                    const dx = t.x - tx, dy = t.y - ty;
                    if (Math.sqrt(dx * dx + dy * dy) < 500) { distOk = false; break; }
                }
                const dxCenter = tx - scene.width / 2, dyCenter = ty - scene.height / 2;
                if (Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter) < 800) distOk = false;
                attempts++;
            } while (!distOk && attempts < 50);
            if (distOk) {
                const treeType = Math.floor(Math.random() * 3);
                const rotation = Math.random() * Math.PI * 2;
                WallSystem.addTree(tx, ty, treeRadius, treeType, 'snow', rotation);
                snowTrees.push({ x: tx, y: ty });
            }
        }

        // 放置玩家到中心
        if (player) {
            player.x = scene.width / 2;
            player.y = scene.height / 2;
            Game.entities.set('player', player);
            Camera.follow(player);
        }

        if (!isQuestMode) {
            console.log('free explore mode');
            // 自由探索模式：添加返回传送门、生成所有怪物和区域BOSS
            const portal = new Portal(scene.width / 2, scene.height - 100, 'main', '返回主神空间');
            Game.entities.set('portal_return', portal);

            const monsterTypes = [BlackWolf];
            const typeNames = ['black_wolf'];
            const playerX = player ? player.x : scene.width / 2;
            const playerY = player ? player.y : scene.height / 2;
            for (let t = 0; t < monsterTypes.length; t++) {
                for (let i = 0; i < 20; i++) {
                    let mx, my, distToPlayer;
                    let attempts = 0;
                    do {
                        const angle = Math.random() * Math.PI * 2;
                        const radius = 3000 + Math.random() * 1000;
                        mx = playerX + Math.cos(angle) * radius;
                        my = playerY + Math.sin(angle) * radius;
                        mx = Math.max(100, Math.min(scene.width - 100, mx));
                        my = Math.max(100, Math.min(scene.height - 100, my));
                        const dx = mx - playerX;
                        const dy = my - playerY;
                        distToPlayer = Math.sqrt(dx * dx + dy * dy);
                        attempts++;
                    } while (distToPlayer < 2500 && attempts < 10);
                    const monster = new monsterTypes[t](mx, my);
                    Game.entities.set(`monster_${typeNames[t]}_${i}`, monster);
                }
            }

            // 生成区域BOSS (BlackWolf)
            const bigBossAngle = Math.random() * Math.PI * 2;
            const bigBossDist = 2000;
            let bbx = playerX + Math.cos(bigBossAngle) * bigBossDist;
            let bby = playerY + Math.sin(bigBossAngle) * bigBossDist;
            bbx = Math.max(100, Math.min(scene.width - 100, bbx));
            bby = Math.max(100, Math.min(scene.height - 100, bby));
            const bigBoss = new BlackWolf(bbx, bby);
            Game.entities.set('big_boss', bigBoss);
        } else {
            console.log('quest mode');
            // 任务模式：不生成传送门和怪物，生成时空裂隙
            if (typeof RiftSystem !== 'undefined') {
                RiftSystem.spawnRifts(scene.width, scene.height);
            }
            // 初始化任务模式怪物生成计时器
            Game._questSpawnTimer = 0;
            Game._questFirstSpawnDelay = 15000; // 15秒后首次生成
            Game._questSpawnInterval = 15000; // 每15秒生成一次
            Game._questSpawnCount = 5; // 每次5只
        }

        // 同步快捷栏特殊攻击图标
        if (player) {
            QuickBar.refreshSpecialAttack(player);
        }
    },

    _loadMainScene(player) {
        if (this._mainEntities) {
            // 主神空间使用固定大小，不随分辨率变化
            Renderer.generateWorld();
            Game.entities = this._mainEntities;
            // 恢复主神空间的树木障碍物
            if (this._mainTrees && this._mainTrees.length > 0) {
                WallSystem.trees = this._mainTrees.map(t => ({ ...t }));
                // 同步树木到 Phaser（恢复碰撞体）
                WallSystem._syncTreesToPhaser();
            }
        } else {
            // 兜底：如果主场景状态未保存（比如测试场景直接进入），重新生成主场景基础环境
            Renderer.generateWorld();
            // 确保玩家实体在 entities 中
            if (player) {
                Game.entities.set('player', player);
            }
        }

        if (player) {
            Game.entities.set('player', player);
            // 优先使用死亡重生位置，其次使用之前保存的主神空间位置
            if (this._respawnPos) {
                player.x = this._respawnPos.x;
                player.y = this._respawnPos.y;
                this._respawnPos = null; // 使用后清除
            } else if (this._mainPlayerPos) {
                player.x = this._mainPlayerPos.x;
                player.y = this._mainPlayerPos.y;
            }
            Camera.follow(player);
            QuickBar.refreshSpecialAttack(player);
        }

        // 确保关键实体（靶子）存在，如果不存在则重新生成
        if (typeof Game !== 'undefined' && Game.spawnTargets && Game.spawnEnemy) {
            let hasTargets = false, hasDpsTarget = false;
            Game.entities.forEach(e => {
                if (e instanceof TargetDummy && e.name && e.name.startsWith('训练靶')) hasTargets = true;
                if (e instanceof TargetDummy && e.name === 'DPS测试靶') hasDpsTarget = true;
            });
            if (!hasTargets) Game.spawnTargets();
            if (!hasDpsTarget) Game.spawnEnemy();
        }
    },

    _loadScene3(player) {
        const scene = this.scenes.scene3;
        const carriageWidth = 500;
        const carriageHeight = 300;
        const numCarriages = 6;
        const totalWidth = carriageWidth * numCarriages;
        const wallThickness = 20;

        CONFIG.WORLD_WIDTH = totalWidth;
        CONFIG.WORLD_HEIGHT = scene.height;

        // 列车内部地形纹理（透明 outside，车内内容在中间）
        const canvas = document.createElement('canvas');
        canvas.width = CONFIG.WORLD_WIDTH;
        canvas.height = CONFIG.WORLD_HEIGHT;
        const ctx = canvas.getContext('2d');

        const interiorTop = (CONFIG.WORLD_HEIGHT - carriageHeight) / 2;
        const interiorBottom = interiorTop + carriageHeight;

        // 地板
        ctx.fillStyle = '#3d3528';
        ctx.fillRect(0, interiorTop, CONFIG.WORLD_WIDTH, carriageHeight);

        // 地板纹理
        for (let x = 0; x < CONFIG.WORLD_WIDTH; x += 20) {
            ctx.strokeStyle = 'rgba(80, 70, 55, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, interiorTop);
            ctx.lineTo(x, interiorBottom);
            ctx.stroke();
        }

        // 绘制每个车厢
        for (let c = 0; c < numCarriages; c++) {
            const cx = c * carriageWidth;

            // 车厢分隔线
            if (c > 0) {
                ctx.strokeStyle = 'rgba(120, 110, 90, 0.6)';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(cx, interiorTop);
                ctx.lineTo(cx, interiorBottom);
                ctx.stroke();
            }

            // 车厢编号
            ctx.fillStyle = 'rgba(180, 170, 140, 0.3)';
            ctx.font = '20px SimHei, "Microsoft YaHei", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`第${c + 1}节车厢`, cx + carriageWidth / 2, interiorTop + 30);

            // 两侧座椅
            const seatColor = '#5a5040';
            const seatW = 40, seatH = 25;
            const seatSpacing = 80;
            const seatMargin = 15;

            for (let sx = cx + 30; sx < cx + carriageWidth - 30; sx += seatSpacing) {
                // 上方座椅
                ctx.fillStyle = seatColor;
                ctx.fillRect(sx, interiorTop + seatMargin, seatW, seatH);
                ctx.strokeStyle = 'rgba(100, 90, 75, 0.5)';
                ctx.strokeRect(sx, interiorTop + seatMargin, seatW, seatH);

                // 下方座椅
                ctx.fillStyle = seatColor;
                ctx.fillRect(sx, interiorBottom - seatMargin - seatH, seatW, seatH);
                ctx.strokeStyle = 'rgba(100, 90, 75, 0.5)';
                ctx.strokeRect(sx, interiorBottom - seatMargin - seatH, seatW, seatH);
            }

            // 中央过道虚线
            ctx.strokeStyle = 'rgba(100, 90, 75, 0.2)';
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 10]);
            ctx.beginPath();
            ctx.moveTo(cx + 20, CONFIG.WORLD_HEIGHT / 2);
            ctx.lineTo(cx + carriageWidth - 20, CONFIG.WORLD_HEIGHT / 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 车厢外壁
        ctx.fillStyle = 'rgba(60, 55, 45, 0.3)';
        ctx.fillRect(0, interiorTop - 10, CONFIG.WORLD_WIDTH, 10);
        ctx.fillRect(0, interiorBottom, CONFIG.WORLD_WIDTH, 10);

        Renderer.terrainTexture = canvas;

        // 设置墙壁系统
        WallSystem.init(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
        WallSystem.walls = [];

        // 车厢内壁（上下边界，防止走出车外）
        WallSystem.walls.push({ x: 0, y: interiorTop - wallThickness, w: CONFIG.WORLD_WIDTH, h: wallThickness });
        WallSystem.walls.push({ x: 0, y: interiorBottom, w: CONFIG.WORLD_WIDTH, h: wallThickness });

        // 左右端墙
        WallSystem.walls.push({ x: -wallThickness, y: 0, w: wallThickness, h: CONFIG.WORLD_HEIGHT });
        WallSystem.walls.push({ x: CONFIG.WORLD_WIDTH, y: 0, w: wallThickness, h: CONFIG.WORLD_HEIGHT });

        // 座椅碰撞体
        const seatW = 40, seatH = 25;
        const seatSpacing = 80;
        const seatMargin = 15;
        for (let c = 0; c < numCarriages; c++) {
            const cx = c * carriageWidth;
            for (let sx = cx + 30; sx < cx + carriageWidth - 30; sx += seatSpacing) {
                WallSystem.walls.push({ x: sx, y: interiorTop + seatMargin, w: seatW, h: seatH });
                WallSystem.walls.push({ x: sx, y: interiorBottom - seatMargin - seatH, w: seatW, h: seatH });
            }
        }

        // 放置玩家到第一节车厢
        if (player) {
            player.x = carriageWidth / 2;
            player.y = CONFIG.WORLD_HEIGHT / 2;
            Game.entities.set('player', player);
            Camera.follow(player);
            // 列车场景锁定相机Y轴，只允许左右移动
            Camera.lockY = true;
            Camera.yLockedValue = CONFIG.WORLD_HEIGHT / 2;
        }

        // 返回传送门（在列车最后一节）
        const portal = new Portal(CONFIG.WORLD_WIDTH - 50, CONFIG.WORLD_HEIGHT / 2, 'main', '返回主神空间');
        Game.entities.set('portal_return', portal);

        // 同步快捷栏
        if (player) {
            QuickBar.refreshSpecialAttack(player);
        }

        // 初始化列车滚动背景偏移
        if (Game) Game._trainScrollOffset = 0;
    },

    _loadScene4(player) {
        const scene = this.scenes.scene4;
        CONFIG.WORLD_WIDTH = scene.width;
        CONFIG.WORLD_HEIGHT = scene.height;

        // 古堡地形纹理：深灰色地板，黑色墙壁
        const canvas = document.createElement('canvas');
        canvas.width = scene.width;
        canvas.height = scene.height;
        const ctx = canvas.getContext('2d');

        // 深灰色石质地板（默认可移动区域）
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, scene.width, scene.height);

        // 石质纹理噪点
        for (let i = 0; i < 30000; i++) {
            const x = Math.random() * scene.width, y = Math.random() * scene.height;
            const size = Math.random() * 3 + 1;
            const alpha = Math.random() * 0.1 + 0.02;
            ctx.fillStyle = Math.random() > 0.5 ? `rgba(60, 60, 60, ${alpha})` : `rgba(80, 80, 80, ${alpha})`;
            ctx.fillRect(x, y, size, size);
        }

        // 墙壁（黑色不可移动区域）
        ctx.fillStyle = '#000000';
        const walls = [
            // 外边界
            { x: -50, y: -50, w: 9100, h: 50 },
            { x: -50, y: 9000, w: 9100, h: 50 },
            { x: -50, y: -50, w: 50, h: 9100 },
            { x: 9000, y: -50, w: 50, h: 9100 },
            // 中央大厅（3000x3000）上墙（门4000-5000）
            { x: 3000, y: 3000, w: 1000, h: 100 },
            { x: 5000, y: 3000, w: 1000, h: 100 },
            // 中央大厅下墙（门4000-5000）
            { x: 3000, y: 6000, w: 1000, h: 100 },
            { x: 5000, y: 6000, w: 1000, h: 100 },
            // 中央大厅左墙（门4000-5000）
            { x: 3000, y: 3000, w: 100, h: 1000 },
            { x: 3000, y: 5000, w: 100, h: 1000 },
            // 中央大厅右墙（门4000-5000）
            { x: 5900, y: 3000, w: 100, h: 1000 },
            { x: 5900, y: 5000, w: 100, h: 1000 },
            // 上方房间（3000x2500）
            { x: 3000, y: 500, w: 3000, h: 100 },
            { x: 3000, y: 500, w: 100, h: 2500 },
            { x: 5900, y: 500, w: 100, h: 2500 },
            // 下方房间（3000x2500）
            { x: 3000, y: 8400, w: 3000, h: 100 },
            { x: 3000, y: 6000, w: 100, h: 2500 },
            { x: 5900, y: 6000, w: 100, h: 2500 },
            // 左侧房间（2500x3000）
            { x: 500, y: 3000, w: 2500, h: 100 },
            { x: 500, y: 6000, w: 2500, h: 100 },
            { x: 500, y: 3000, w: 100, h: 3000 },
            // 右侧房间（2500x3000）
            { x: 6000, y: 3000, w: 2500, h: 100 },
            { x: 6000, y: 6000, w: 2500, h: 100 },
            { x: 8400, y: 3000, w: 100, h: 3000 },
            // 左上房间（2500x2500）
            { x: 500, y: 500, w: 2500, h: 100 },
            { x: 500, y: 500, w: 100, h: 2500 },
            { x: 3000, y: 500, w: 100, h: 2500 },
            // 左下房间（2500x2500）
            { x: 500, y: 8400, w: 2500, h: 100 },
            { x: 500, y: 6000, w: 100, h: 2500 },
            { x: 3000, y: 6000, w: 100, h: 2500 },
            // 右上房间（2500x2500）
            { x: 6000, y: 500, w: 2500, h: 100 },
            { x: 8400, y: 500, w: 100, h: 2500 },
            { x: 6000, y: 500, w: 100, h: 2500 },
            // 右下房间（2500x2500）
            { x: 6000, y: 8400, w: 2500, h: 100 },
            { x: 8400, y: 6000, w: 100, h: 2500 },
            { x: 6000, y: 6000, w: 100, h: 2500 },
        ];
        for (const w of walls) {
            ctx.fillRect(w.x, w.y, w.w, w.h);
        }

        Renderer.terrainTexture = canvas;

        // 设置墙壁系统
        WallSystem.init(scene.width, scene.height);
        WallSystem.walls = walls;

        // 放置玩家到中心
        if (player) {
            player.x = scene.width / 2;
            player.y = scene.height / 2;
            Game.entities.set('player', player);
            Camera.follow(player);
        }

        // 添加返回传送门
        const portal = new Portal(scene.width / 2, scene.height - 100, 'main', '返回主神空间');
        Game.entities.set('portal_return', portal);

        // 古堡怪物：以玩家为中心，半径3000~4000px环形区域随机生成，每种5个
        const monsterTypes = [BlackWolf];
        const typeNames = ['black_wolf'];
        const playerX = player ? player.x : scene.width / 2;
        const playerY = player ? player.y : scene.height / 2;
        for (let t = 0; t < monsterTypes.length; t++) {
            for (let i = 0; i < 25; i++) {
                let mx, my, distToPlayer;
                let attempts = 0;
                do {
                    const angle = Math.random() * Math.PI * 2;
                    const radius = 3000 + Math.random() * 1000;
                    mx = playerX + Math.cos(angle) * radius;
                    my = playerY + Math.sin(angle) * radius;
                    mx = Math.max(100, Math.min(scene.width - 100, mx));
                    my = Math.max(100, Math.min(scene.height - 100, my));
                    const dx = mx - playerX;
                    const dy = my - playerY;
                    distToPlayer = Math.sqrt(dx * dx + dy * dy);
                    attempts++;
                } while (distToPlayer < 2500 && attempts < 10);
                const monster = new monsterTypes[t](mx, my);
                Game.entities.set(`scene4_${typeNames[t]}_${i}`, monster);
            }
        }

        // 同步快捷栏
        if (player) {
            QuickBar.refreshSpecialAttack(player);
        }
    },

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    _loadScene5(player) {
        const scene = this.scenes.scene5;
        CONFIG.WORLD_WIDTH = scene.width;
        CONFIG.WORLD_HEIGHT = scene.height;

        // 灰色地形纹理
        const canvas = document.createElement('canvas');
        canvas.width = scene.width;
        canvas.height = scene.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(0, 0, scene.width, scene.height);
        // 网格纹理
        ctx.strokeStyle = 'rgba(100, 100, 100, 0.1)';
        ctx.lineWidth = 1;
        for (let x = 0; x < scene.width; x += 50) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, scene.height); ctx.stroke();
        }
        for (let y = 0; y < scene.height; y += 50) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(scene.width, y); ctx.stroke();
        }
        Renderer.terrainTexture = canvas;

        // 墙壁系统
        WallSystem.init(scene.width, scene.height);
        WallSystem.walls = [
            { x: -10, y: -10, w: scene.width + 20, h: 10 },
            { x: -10, y: scene.height, w: scene.width + 20, h: 10 },
            { x: -10, y: -10, w: 10, h: scene.height + 20 },
            { x: scene.width, y: -10, w: 10, h: scene.height + 20 }
        ];
        // 添加一些障碍物（方块），数量随场景面积等比例增加
        const obstacleCount = Math.floor(15 * (scene.width * scene.height) / (1530 * 760));
        for (let i = 0; i < obstacleCount; i++) {
            const wx = 200 + Math.random() * (scene.width - 400);
            const wy = 100 + Math.random() * (scene.height - 200);
            const ww = 40 + Math.random() * 80;
            const wh = 40 + Math.random() * 80;
            WallSystem.walls.push({ x: wx, y: wy, w: ww, h: wh });
        }

        // 放置玩家
        if (player) {
            let px = scene.width / 2;
            let py = scene.height / 2;
            // 检查玩家位置是否在墙壁内，如果是则重新选择
            if (typeof WallSystem !== 'undefined' && WallSystem.canMoveTo) {
                const playerRadius = player.collisionRadius || player.size || 15;
                let attempts = 0;
                while (!WallSystem.canMoveTo(px, py, playerRadius) && attempts < 50) {
                    px = 100 + Math.random() * (scene.width - 200);
                    py = 100 + Math.random() * (scene.height - 200);
                    attempts++;
                }
                if (attempts >= 50) {
                    console.warn('[scene5] 无法为玩家找到安全位置，使用默认位置');
                }
            }
            player.x = px;
            player.y = py;
            Game.entities.set('player', player);
            Camera.follow(player);
        }

        // 返回传送门
        const portal = new Portal(scene.width / 2, scene.height - 50, 'main', '返回主神空间');
        Game.entities.set('portal_return', portal);

        // 仅生成战术小队，删除其他怪物
        // ===== 6人战术小队测试生成 =====
        const spawnTacticalSquad = (centerX, centerY, radius) => {
            // 先清空旧的战术小队AI成员和FormationSystem编队
            if (Game._tacticalSquadAI) Game._tacticalSquadAI.clear();
            if (typeof FormationSystem !== 'undefined') {
                FormationSystem.getAllFormationIds().forEach(id => FormationSystem.disbandFormation(id));
            }
            const roles = [
                { Class: Commander, role: 'commander', name: 'commander' },
                { Class: MachineGunner, role: 'machineGunner', name: 'machineGunner' },
                { Class: Rifleman, role: 'rifleman', name: 'rifleman' },
                { Class: FlankRifleman, role: 'flankRifleman', name: 'flankRifleman' },
                { Class: ShieldBearer, role: 'shieldBearer', name: 'shieldBearer_A' },
                { Class: ShieldBearer, role: 'shieldBearer', name: 'shieldBearer_B' }
            ];
            const members = [];
            let commander = null;
            // 以 centerX, centerY 为圆心，radius 为半径环形排列
            for (let i = 0; i < roles.length; i++) {
                const angle = (Math.PI * 2 / roles.length) * i;
                let sx = centerX + Math.cos(angle) * radius;
                let sy = centerY + Math.sin(angle) * radius;

                // 检查生成位置是否在墙壁内，如果是则重新选择
                if (typeof WallSystem !== 'undefined' && WallSystem.canMoveTo) {
                    let attempts = 0;
                    const checkRadius = 25; // 最小安全半径
                    while (!WallSystem.canMoveTo(sx, sy, checkRadius) && attempts < 20) {
                        sx = centerX + (Math.random() - 0.5) * radius * 3;
                        sy = centerY + (Math.random() - 0.5) * radius * 3;
                        attempts++;
                    }
                    if (attempts >= 20) {
                        console.warn(`[spawnTacticalSquad] 无法为 ${roles[i].name} 找到安全生成位置，使用默认位置`);
                    }
                }

                const member = new roles[i].Class(sx, sy);
                Game.entities.set(`tactical_squad_${roles[i].name}_${i}`, member);
                members.push(member);
                if (roles[i].role === 'commander') commander = member;
                // 绑定到战术小队AI
                if (Game._tacticalSquadAI) {
                    Game._tacticalSquadAI.addMember(member, roles[i].role);
                }
            }
            // 创建阵型编队（指挥官为leader，其他为成员）
            if (typeof FormationSystem !== 'undefined' && commander && members.length > 1) {
                const followers = members.filter(m => m !== commander);
                const fid = FormationSystem.createFormation(commander, 'wedge', followers);
                if (fid) {
                    FormationSystem.setTargetPosition(fid, centerX, centerY);
                }
            }
        };
        // 在场景五右上角生成战术小队（与原有怪物错开位置）
        spawnTacticalSquad(scene.width * 0.75, scene.height * 0.25, 80);

        if (player) QuickBar.refreshSpecialAttack(player);
    },

    _loadScene7(player, dungeonType = 'zombie') {
        // 重置 Camera 状态，避免从其他场景带入偏移
        Camera.aimOffsetX = 0;
        Camera.aimOffsetY = 0;
        Camera.shakeX = 0;
        Camera.shakeY = 0;
        Camera.shakeIntensity = 0;
        Camera.lockY = false;
        Camera.yLockedValue = 0;

        // 僵尸地牢：1024x1024 简单地图，无墙壁
        CONFIG.WORLD_WIDTH = 1024;
        CONFIG.WORLD_HEIGHT = 1024;

        // 创建地形纹理（1024x1024 全石砖地板，无边框黑背景）
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // 全屏深灰色地板
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, 1024, 1024);

        // 地板纹理（石砖）
        ctx.strokeStyle = 'rgba(50, 50, 50, 0.3)';
        ctx.lineWidth = 1;
        for (let bx = 0; bx < 1024; bx += 20) {
            ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, 1024); ctx.stroke();
        }
        for (let by = 0; by < 1024; by += 20) {
            ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(1024, by); ctx.stroke();
        }

        // 全地图边缘高光
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, 1024, 1024);

        Renderer.terrainTexture = canvas;
        console.log('[scene7] terrainTexture set:', canvas.width, 'x', canvas.height, 'Renderer.terrainTexture:', Renderer.terrainTexture ? 'OK' : 'NULL');

        // 添加边界墙壁，防止玩家走出地图
        WallSystem.init(1024, 1024);
        WallSystem.walls = [
            { x: 0, y: 0, w: 1024, h: 20 },      // 上边界
            { x: 0, y: 1004, w: 1024, h: 20 },   // 下边界
            { x: 0, y: 0, w: 20, h: 1024 },      // 左边界
            { x: 1004, y: 0, w: 20, h: 1024 },   // 右边界
        ];
        // 同步到 Phaser（确保物理碰撞体也更新）
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        // 玩家放在地板中央
        if (player) {
            player.x = 512;
            player.y = 512;
            Game.entities.set('player', player);
            Camera.follow(player);
            console.log('[scene7] Player at', player.x, player.y, 'Camera at', Camera.x, Camera.y);
        }

        // 同步快捷栏
        if (player) {
            QuickBar.refreshSpecialAttack(player);
        }

        // 打开背包和出征准备面板（两者同时从右侧弹出，出征在背包左边）
        if (typeof SystemUI !== 'undefined') {
            SystemUI.open('equip');
        }
        if (typeof ExpeditionSystem !== 'undefined') {
            ExpeditionSystem.open(player);
        }

        // 地牢地图系统由出征面板的 depart() 调用，这里不再自动初始化
    },

};

// 传送门实体

