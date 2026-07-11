import { Game } from '../../game.js';
import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';

import { Input } from '../../ui/input.js';
// 无人机技能系统
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { EffectManager } from '../../effects/effect-manager.js';
export class DroneSystem {
    constructor(player) {
        this.player = player;
        this.active = false;
        this.controlling = false;
        this.x = 0;
        this.y = 0;
        this.duration = 0;
        this.maxDuration = 0;
        this.checkTimer = 0;
        this.vx = 0;
        this.vy = 0;
        this.speed = 500;
        this.radius = 300;
        this.image = new Image();
        this.image.src = 'assets/skills/drone.png';
        // 保存玩家原始镜头目标
        this._savedCameraTarget = null;
        // 跟踪当前被无人机影响的实体
        this._affectedEntities = new Set();
    }

    // 切换无人机状态
    toggle() {
        if (!this.active) {
            // 释放无人机
            this._deploy();
        } else if (this.active && !this.controlling) {
            // 进入操控模式
            this._enterControl();
        } else if (this.controlling) {
            // 退出操控模式，不收回无人机，让无人机持续存在
            this._exitControl();
        }
    }

    _deploy() {
        const skill = this.player.skills && this.player.skills.droneSkill;
        if (!skill) return;
        const effect = skill.getEffect(skill.level);
        this.active = true;
        this.controlling = false;
        this.maxDuration = (effect.duration || 30) * 1000;
        this.duration = this.maxDuration;
        this.speed = effect.moveSpeed || 500;
        this.radius = effect.radius || 300;
        this.checkTimer = 0;
        // 放置在玩家正前方50px
        const angle = this.player.rotation;
        this.x = this.player.x + Math.cos(angle) * 50;
        this.y = this.player.y + Math.sin(angle) * 50;
        this.vx = 0;
        this.vy = 0;
        // 显示提示
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 20, '🛸 无人机已部署', '#5a7a9a'));
    }

    _enterControl() {
        this.controlling = true;
        this._savedCameraTarget = Renderer.cameraTarget || null;
        Renderer.cameraTarget = { x: this.x, y: this.y, isDrone: true };
        EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, '🛸 进入无人机操控', '#5a7a9a'));
    }

    _exitControl() {
        this.controlling = false;
        if (this._savedCameraTarget) {
            Renderer.cameraTarget = this._savedCameraTarget;
        } else {
            Renderer.cameraTarget = null;
        }
        this._savedCameraTarget = null;
        EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, '🛸 退出无人机操控', '#5a7a9a'));
    }

    _deactivate() {
        this.active = false;
        this.controlling = false;
        if (this._savedCameraTarget) {
            Renderer.cameraTarget = this._savedCameraTarget;
        } else {
            Renderer.cameraTarget = null;
        }
        this._savedCameraTarget = null;
        // 清除所有受影响实体的 debuff
        this._affectedEntities.forEach(entity => {
            if (entity && entity.removeDroneVulnerability) {
                entity.removeDroneVulnerability();
            }
        });
        this._affectedEntities.clear();
        EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, '🛸 无人机已回收', '#5a7a9a'));
    }

    update(dt, entities) {
        if (!this.active) return;
        this.duration -= dt;
        if (this.duration <= 0) {
            this._deactivate();
            return;
        }

        const dtSec = dt / 1000;

        if (this.controlling) {
            // WASD 控制无人机（使用 Set 的 has 方法，Input.keys 是 Set 不是对象）
            let moveX = 0, moveY = 0;
            if (Input.isPressed('KeyW') || Input.isPressed('ArrowUp')) moveY -= 1;
            if (Input.isPressed('KeyS') || Input.isPressed('ArrowDown')) moveY += 1;
            if (Input.isPressed('KeyA') || Input.isPressed('ArrowLeft')) moveX -= 1;
            if (Input.isPressed('KeyD') || Input.isPressed('ArrowRight')) moveX += 1;
            const len = Math.sqrt(moveX * moveX + moveY * moveY);
            if (len > 0) {
                moveX /= len;
                moveY /= len;
            }
            this.vx += (moveX * this.speed - this.vx) * 0.7;
            this.vy += (moveY * this.speed - this.vy) * 0.7;
            if (moveX === 0) this.vx *= 0.82;
            if (moveY === 0) this.vy *= 0.82;

            // 更新位置
            const nextX = this.x + this.vx * dtSec;
            const nextY = this.y + this.vy * dtSec;
            // 墙壁碰撞
            if (typeof WallSystem !== 'undefined') {
                const resolved = WallSystem.resolve(this.x, this.y, nextX, nextY, 10);
                this.x = resolved.x;
                this.y = resolved.y;
            } else {
                this.x = nextX;
                this.y = nextY;
            }
            // 更新镜头目标
            if (Renderer.cameraTarget && Renderer.cameraTarget.isDrone) {
                Renderer.cameraTarget.x = this.x;
                Renderer.cameraTarget.y = this.y;
            }
        } else {
            // 非操控模式：保持当前位置，不跟随玩家
            this.vx *= 0.9;
            this.vy *= 0.9;
        }

        // 每0.25s检测范围内敌人并施加debuff
        this.checkTimer -= dt;
        if (this.checkTimer <= 0) {
            this.checkTimer = 250;
            this._applyDebuff(entities);
        }
    }

    _applyDebuff(entities) {
        const skill = this.player.skills && this.player.skills.droneSkill;
        if (!skill) return;
        const effect = skill.getEffect(skill.level);
        const baseDamageBonus = effect.damageBonusPercent || 10;
        const baseCritBonus = effect.critBonusPercent || 10;
        // 先收集当前在范围内的实体
        const inRangeEntities = new Set();
        entities.forEach(entity => {
            if (entity === this.player || !entity.active || !entity.hittable) return;
            const dist = Math.sqrt((entity.x - this.x) ** 2 + (entity.y - this.y) ** 2);
            if (dist <= this.radius) {
                inRangeEntities.add(entity);
            }
        });
        // 新进入范围的实体：施加 debuff，播放特效
        inRangeEntities.forEach(entity => {
            if (!this._affectedEntities.has(entity)) {
                if (entity.applyDroneVulnerability) {
                    entity.applyDroneVulnerability(1);
                }
                this._affectedEntities.add(entity);
            } else {
                // 已在范围内的：刷新计时器
                entity._droneVulnerabilityTimer = 5000;
            }
        });
        // 离开范围的实体：移除 debuff
        this._affectedEntities.forEach(entity => {
            if (!inRangeEntities.has(entity)) {
                if (entity && entity.removeDroneVulnerability) {
                    entity.removeDroneVulnerability();
                }
            }
        });
        // 清理已离开范围的实体引用
        this._affectedEntities.forEach(entity => {
            if (!inRangeEntities.has(entity)) {
                this._affectedEntities.delete(entity);
            }
        });
    }

    render(ctx) {
        if (!this.active) return;
        const screenPos = Renderer.worldToScreen(this.x, this.y);
        // 绘制无人机
        if (this.image && this.image.complete && this.image.naturalWidth > 0) {
            const size = 32;
            ctx.drawImage(this.image, screenPos.x - size / 2, screenPos.y - size / 2, size, size);
        } else {
            ctx.fillStyle = '#5a7a9a';
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, 12, 0, Math.PI * 2);
            ctx.fill();
        }
        // 操控模式下显示范围圈
        if (this.controlling && Game.showAttackRange) {
            const radiusScreen = this.radius * Renderer.zoom;
            ctx.strokeStyle = 'rgba(90, 122, 154, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, radiusScreen, 0, Math.PI * 2);
            ctx.stroke();
        }
        // 显示剩余时间
        const remainingSec = Math.ceil(this.duration / 1000);
        ctx.fillStyle = '#d4c5a9';
        ctx.font = '10px SimHei, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${remainingSec}s`, screenPos.x, screenPos.y - 18);
    }
}
