import { Portal } from '../world/portal.js';
import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { Renderer } from '../world/renderer.js';
import { SceneManager } from '../world/scene-manager.js';
// Rift System - 时空裂隙系统
import { FloatingTextEffect } from '../effects/floating-text.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { QuestState } from '../ui/quest-system.js';
export const RiftSystem = {
    rifts: [], // { x, y, id, progress, completed, active }
    _progressBarEl: null,
    _progressBarFillEl: null,
    _activeRiftIndex: -1,
    _investigateTime: 10000, // 10秒（毫秒）

    // 在场景中生成3个时空裂隙
    spawnRifts(sceneWidth, sceneHeight) {
        this.rifts = [];
        const positions = this._generateRiftPositions(sceneWidth, sceneHeight);
        positions.forEach((pos, idx) => {
            this.rifts.push({
                id: idx,
                x: pos.x,
                y: pos.y,
                progress: 0, // 0-1
                completed: false,
                active: false
            });
            // 绿圈范围内（200px半径）摧毁障碍物（树木）
            if (typeof WallSystem !== 'undefined' && WallSystem.removeTreesInRadius) {
                const removed = WallSystem.removeTreesInRadius(pos.x, pos.y, 200);
                if (removed > 0) {
                    console.log('[RiftSystem] 裂隙', idx, '清除树木:', removed, '棵');
                }
            }
        });
        // 加载保存的进度
        if (typeof QuestState !== 'undefined' && QuestState.riftProgress) {
            this.rifts.forEach((rift, idx) => {
                rift.progress = QuestState.riftProgress[idx] || 0;
                rift.completed = QuestState.riftCompleted[idx] || false;
            });
        }
    },

    // 生成3个相距≥2000px的随机位置
    _generateRiftPositions(width, height) {
        const positions = [];
        const minDist = 1000;
        const margin = 500; // 距离边界
        let attempts = 0;
        while (positions.length < 3 && attempts < 1000) {
            const x = margin + Math.random() * (width - margin * 2);
            const y = margin + Math.random() * (height - margin * 2);
            let valid = true;
            for (const p of positions) {
                const dx = p.x - x;
                const dy = p.y - y;
                if (Math.sqrt(dx * dx + dy * dy) < minDist) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                positions.push({ x, y });
            }
            attempts++;
        }
        // 如果无法生成3个，就返回已有的
        return positions;
    },

    // 更新裂隙系统（每帧调用）
    update(dt, player) {
        if (!player) return;
        let playerInAnyRift = false;
        let activeIdx = -1;

        for (let i = 0; i < this.rifts.length; i++) {
            const rift = this.rifts[i];
            if (rift.completed) continue;

            const dx = player.x - rift.x;
            const dy = player.y - rift.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // 玩家在绿色圆圈内（200px半径）
            if (dist <= 200) {
                playerInAnyRift = true;
                activeIdx = i;
                rift.progress += dt / this._investigateTime;
                if (rift.progress >= 1) {
                    rift.progress = 1;
                    rift.completed = true;
                    this._onRiftComplete(i);
                }
                // 保存进度到QuestState
                if (typeof QuestState !== 'undefined') {
                    QuestState.riftProgress[i] = rift.progress;
                }
            }
        }

        if (playerInAnyRift && activeIdx !== -1) {
            this._activeRiftIndex = activeIdx;
            this._showProgressBar(this.rifts[activeIdx].progress);
        } else {
            this._activeRiftIndex = -1;
            this._hideProgressBar();
        }

        // 检查是否所有裂隙完成
        if (typeof QuestState !== 'undefined' && !QuestState.questCompleted) {
            const allCompleted = this.rifts.every(r => r.completed);
            if (allCompleted && this.rifts.length > 0) {
                QuestState.questCompleted = true;
                this._onAllRiftsComplete();
            }
        }
    },

    // 渲染裂隙（在游戏渲染循环中调用）
    render(ctx) {
        for (const rift of this.rifts) {
            if (rift.completed) continue;
            const sp = Renderer.worldToScreen(rift.x, rift.y);
            // 浅蓝色实心圆（半径100px）
            ctx.fillStyle = 'rgba(135, 206, 250, 0.6)';
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 100, 0, Math.PI * 2);
            ctx.fill();
            // 绿色外圈（半径200px）
            ctx.strokeStyle = 'rgba(50, 205, 50, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 200, 0, Math.PI * 2);
            ctx.stroke();
        }
    },

    // 显示进度条
    _showProgressBar(progress) {
        let container = getElement('riftProgressBar');
        if (!container) {
            container = document.createElement('div');
            container.id = 'riftProgressBar';
            container.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);width:300px;height:20px;background:rgba(30,30,30,0.9);border:2px solid #5a7a5a;border-radius:10px;z-index:6000;overflow:hidden;';
            container.innerHTML = '<div id="riftProgressFill" style="width:0%;height:100%;background:linear-gradient(90deg, #5a9a5a, #7aba7a);transition:width 0.1s linear;border-radius:8px;"></div><div id="riftProgressText" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#d4e8c5;font-size:12px;font-family:SimHei,"Microsoft YaHei",sans-serif;">时空裂隙调查中...</div>';
            document.body.appendChild(container);
        }
        container.style.display = 'block';
        const fill = getElement('riftProgressFill');
        if (fill) fill.style.width = (progress * 100) + '%';
    },

    // 隐藏进度条
    _hideProgressBar() {
        const container = getElement('riftProgressBar');
        if (container) container.style.display = 'none';
    },

    // 单个裂隙完成
    _onRiftComplete(index) {
        if (typeof QuestState !== 'undefined') {
            QuestState.completeRift(index);
        }
        this._hideProgressBar();
        // 显示提示
        const label = document.createElement('div');
        label.style.cssText = 'position:fixed;top:210px;left:50%;transform:translateX(-50%);color:#5a9a5a;font-size:32px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,0.8);z-index:5000;pointer-events:none;animation:sceneLabelFade 3s ease-out forwards;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;';
        label.textContent = '时空裂隙已调查';
        document.body.appendChild(label);
        TimerManager.setTimeout(() => { if (label && label.parentNode) label.remove(); }, 3000);
    },

    // 所有裂隙完成
    _onAllRiftsComplete() {
        // 显示裂隙调查完成提示，告知玩家需要撤离
        const label = document.createElement('div');
        label.style.cssText = 'position:fixed;top:210px;left:50%;transform:translateX(-50%);color:#ffd700;font-size:48px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,0.8);z-index:5000;pointer-events:none;animation:sceneLabelFade 4s ease-out forwards;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;';
        label.textContent = '返回传送门已开启，请撤离！';
        document.body.appendChild(label);
        TimerManager.setTimeout(() => { if (label && label.parentNode) label.remove(); }, 4000);

        // 生成返回传送门
        this._spawnReturnPortal();
    },

    // 生成返回传送门
    _spawnReturnPortal() {
        if (typeof QuestState !== 'undefined') {
            if (QuestState.returnPortalSpawned) return;
            QuestState.returnPortalSpawned = true;
        }
        if (!Game.player) return;
        const scene = SceneManager.scenes[SceneManager.currentScene];
        if (!scene) return;
        // 在距离主角3000px+的随机位置
        let px, py, dist;
        let attempts = 0;
        do {
            const angle = Math.random() * Math.PI * 2;
            const radius = 3000 + Math.random() * 1000;
            px = Game.player.x + Math.cos(angle) * radius;
            py = Game.player.y + Math.sin(angle) * radius;
            px = Math.max(100, Math.min(scene.width - 100, px));
            py = Math.max(100, Math.min(scene.height - 100, py));
            const dx = px - Game.player.x;
            const dy = py - Game.player.y;
            dist = Math.sqrt(dx * dx + dy * dy);
            attempts++;
        } while (dist < 3000 && attempts < 50);

        const portal = new Portal(px, py, 'main', '返回主神空间');
        portal._isQuestReturn = true; // 标记为任务返回传送门
        Game.entities.set('quest_return_portal', portal);
        // 提示
        EffectManager.add(new FloatingTextEffect(px, py - 30, '返回传送门已开启', '#ffd700'));
    },

    // 清除所有裂隙
    clear() {
        this.rifts = [];
        this._hideProgressBar();
        const container = getElement('riftProgressBar');
        if (container && container.parentNode) container.remove();
    }
};
