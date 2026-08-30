import { Portal } from '../world/portal.js';
import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { SceneManager } from '../world/scene-manager.js';
// Rift System - 时空裂隙系统
import { FloatingTextEffect } from '../effects/floating-text.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement, getElementIfExists } from '../utils/dom-utils.js';
import { QuestState } from '../ui/quest-system.js';
export const RiftSystem = {
    rifts: [], // { x, y, id, progress, completed, active }
    _progressBarEl: null,
    _progressBarFillEl: null,
    _activeRiftIndex: -1,
    _investigateTime: 10000, // 10秒（毫秒）
    _expectedRiftCount: 3,
    _placementValidator: null,
    _clearPlacements: null,
    _sceneWidth: 0,
    _sceneHeight: 0,

    /** 场景事务回滚快照：保留任务裂隙运行态及场景注入的放置规则。 */
    captureState() {
        return {
            rifts: this.rifts.map((rift) => ({ ...rift })),
            activeRiftIndex: this._activeRiftIndex,
            investigateTime: this._investigateTime,
            expectedRiftCount: this._expectedRiftCount,
            placementValidator: this._placementValidator,
            clearPlacements: this._clearPlacements,
            sceneWidth: this._sceneWidth,
            sceneHeight: this._sceneHeight,
        };
    },

    restoreState(state) {
        this.clear();
        if (!state) return;
        this.rifts = Array.isArray(state.rifts)
            ? state.rifts.map((rift) => ({ ...rift }))
            : [];
        this._activeRiftIndex = Number.isInteger(state.activeRiftIndex)
            ? state.activeRiftIndex
            : -1;
        this._investigateTime = Math.max(1000, Number(state.investigateTime) || 10000);
        this._expectedRiftCount = Math.max(1, Number(state.expectedRiftCount) || 3);
        this._placementValidator = typeof state.placementValidator === 'function'
            ? state.placementValidator
            : null;
        this._clearPlacements = typeof state.clearPlacements === 'function'
            ? state.clearPlacements
            : null;
        this._sceneWidth = Math.max(0, Number(state.sceneWidth) || 0);
        this._sceneHeight = Math.max(0, Number(state.sceneHeight) || 0);
        const activeRift = this.rifts[this._activeRiftIndex];
        if (activeRift && !activeRift.completed) this._showProgressBar(activeRift.progress);
    },

    // 在任务场景中生成时空裂隙；位置规则由场景注入，避免任务系统绑定具体地形。
    spawnRifts(sceneWidth, sceneHeight, options = {}) {
        this.rifts = [];
        this._sceneWidth = Math.max(0, Number(sceneWidth) || 0);
        this._sceneHeight = Math.max(0, Number(sceneHeight) || 0);
        const definition = QuestState?.getActiveDefinition?.();
        const count = Math.max(1, Math.floor(Number(options.count)
            || Number(definition?.runtime?.riftCount)
            || 3));
        this._expectedRiftCount = count;
        this._investigateTime = Math.max(1000, Number(options.investigateMs)
            || Number(definition?.runtime?.investigateMs)
            || 10000);
        this._placementValidator = typeof options.isValidPosition === 'function'
            ? options.isValidPosition
            : null;
        this._clearPlacements = typeof options.clearPlacements === 'function'
            ? options.clearPlacements
            : null;
        const savedPositions = Array.isArray(QuestState?.riftPositions)
            ? QuestState.riftPositions.slice(0, count)
            : [];
        const canRestorePositions = savedPositions.length === count
            && savedPositions.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
                && (!this._placementValidator || this._placementValidator(point.x, point.y)));
        const positions = canRestorePositions
            ? savedPositions
            : this._generateRiftPositions(sceneWidth, sceneHeight, {
                count,
                isValidPosition: this._placementValidator,
            });
        if (QuestState) QuestState.riftPositions = positions;
        positions.forEach((pos, idx) => {
            this.rifts.push({
                id: idx,
                x: pos.x,
                y: pos.y,
                progress: 0, // 0-1
                completed: false,
                active: false
            });
        });
        if (this._clearPlacements && positions.length) this._clearPlacements(positions);
        // 加载保存的进度
        if (QuestState && QuestState.riftProgress) {
            this.rifts.forEach((rift, idx) => {
                rift.progress = QuestState.riftProgress[idx] || 0;
                rift.completed = QuestState.riftCompleted[idx] || false;
            });
        }
        if (QuestState?.questCompleted) {
            this._spawnReturnPortal({ restore: QuestState.returnPortalSpawned });
        }
    },

    // 生成彼此分离、满足当前场景可行走规则的随机位置。
    _generateRiftPositions(width, height, options = {}) {
        const positions = [];
        const count = Math.max(1, Math.floor(Number(options.count) || 3));
        const minDist = Math.max(0, Number(options.minDistance) || 1000);
        const margin = Math.max(0, Number(options.margin) || 500);
        const isValidPosition = typeof options.isValidPosition === 'function'
            ? options.isValidPosition
            : null;
        let attempts = 0;
        while (positions.length < count && attempts < 2000) {
            const x = margin + Math.random() * (width - margin * 2);
            const y = margin + Math.random() * (height - margin * 2);
            let valid = !isValidPosition || isValidPosition(x, y);
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
        // 极端情况下返回已找到的位置；任务目标不会被伪造为完成。
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
                if (QuestState) QuestState.setRiftProgress(i, rift.progress);
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
        if (QuestState && !QuestState.questCompleted) {
            const allCompleted = this.rifts.every(r => r.completed);
            if (allCompleted && this.rifts.length === this._expectedRiftCount) {
                QuestState.questCompleted = true;
                this._onAllRiftsComplete();
            }
        }
    },

    // 显示进度条
    _showProgressBar(progress) {
        let container = getElementIfExists('riftProgressBar');
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
        const container = getElementIfExists('riftProgressBar');
        if (container) container.style.display = 'none';
    },

    // 单个裂隙完成
    _onRiftComplete(index) {
        if (QuestState) {
            QuestState.completeRift(index);
        }
        this._hideProgressBar();
        // 显示提示
        SceneManager.showTopNotification('时空裂隙已调查', { tone: 'success', emphasis: 'headline' });
    },

    // 所有裂隙完成
    _onAllRiftsComplete() {
        // 显示裂隙调查完成提示，告知玩家需要撤离
        SceneManager.showTopNotification('返回传送门已开启，请撤离！', { tone: 'success', emphasis: 'headline', duration: 4000 });

        // 生成返回传送门
        this._spawnReturnPortal();
    },

    // 生成返回传送门
    _spawnReturnPortal({ restore = false } = {}) {
        if (QuestState) {
            if (QuestState.returnPortalSpawned && !restore) return;
            if (Game.entities.has('quest_return_portal')) return;
            QuestState.returnPortalSpawned = true;
        }
        if (!Game.player) return;
        const scene = SceneManager.scenes[SceneManager.currentScene];
        const sceneWidth = this._sceneWidth || scene?.width;
        const sceneHeight = this._sceneHeight || scene?.height;
        if (!(sceneWidth > 0) || !(sceneHeight > 0)) return;
        // 在距离主角3000px+且满足任务场景放置规则的位置生成。
        const savedPosition = restore ? QuestState?.returnPortalPosition : null;
        let px = savedPosition?.x;
        let py = savedPosition?.y;
        let dist = Number.isFinite(px) && Number.isFinite(py)
            ? Math.hypot(px - Game.player.x, py - Game.player.y)
            : 0;
        let attempts = 0;
        while ((!Number.isFinite(px) || !Number.isFinite(py)
            || dist < 3000
            || (this._placementValidator && !this._placementValidator(px, py)))
            && attempts < 200) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 3000 + Math.random() * 1000;
            px = Game.player.x + Math.cos(angle) * radius;
            py = Game.player.y + Math.sin(angle) * radius;
            px = Math.max(100, Math.min(sceneWidth - 100, px));
            py = Math.max(100, Math.min(sceneHeight - 100, py));
            const dx = px - Game.player.x;
            const dy = py - Game.player.y;
            dist = Math.sqrt(dx * dx + dy * dy);
            attempts++;
        }

        if (this._placementValidator && !this._placementValidator(px, py)) {
            px = Game.player.x;
            py = Game.player.y;
        }
        if (this._clearPlacements) this._clearPlacements([{ x: px, y: py }]);
        if (QuestState) QuestState.returnPortalPosition = { x: px, y: py };

        const portal = new Portal(px, py, 'main', '返回主神空间');
        portal._isQuestReturn = true; // 标记为任务返回传送门
        Game.entities.set('quest_return_portal', portal);
        // 提示
        EffectManager.add(new FloatingTextEffect(px, py - 30, '返回传送门已开启', '#ffd700'));
    },

    // 清除所有裂隙
    clear() {
        this.rifts = [];
        this._activeRiftIndex = -1;
        this._expectedRiftCount = 3;
        this._placementValidator = null;
        this._clearPlacements = null;
        this._sceneWidth = 0;
        this._sceneHeight = 0;
        this._hideProgressBar();
        const container = getElementIfExists('riftProgressBar');
        if (container && container.parentNode) container.remove();
    }
};
