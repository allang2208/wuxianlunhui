import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';

import { Input } from '../../ui/input.js';
import { loadImage } from '../../utils/image-loader.js';
// 无人机技能系统
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { GroundCircle } from '../../physics/skill-shapes.js';
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
        this.image = loadImage('assets/skills/drone.png');
        // 保存玩家原始镜头目标
        this._savedCameraTarget = null;
        // 跟踪当前被无人机影响的实体
        this._affectedEntities = new Set();
        // 长按技能键命令的飞行目标点（null=无命令）
        this._moveTarget = null;
        this._moveStallMs = 0; // 被墙挡停累积时间（防卡死）
        // 长按命令后悬停：到达目标点后原地停留，不再跟随玩家（再次长按重新定位）
        this._holdPosition = false;
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

    // 长按技能键：命令无人机飞往鼠标指针位置（未部署则先部署）
    commandFlyToMouse() {
        const mw = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
        if (!this.active) this._deploy();
        if (!this.active) return; // 技能缺失等防御
        this._moveTarget = { x: mw.x, y: mw.y };
        this._moveStallMs = 0;
        this._holdPosition = true; // 到达后悬停，不再跟随玩家
        EffectManager.add(new FloatingTextEffect(mw.x, mw.y - 12, '🛸 飞往目标点', '#5a7a9a'));
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
        this._moveTarget = null;
        this._moveStallMs = 0;
        this._holdPosition = false; // 重新部署时清除悬停状态
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

        // 长按命令飞行：操控模式下 WASD 输入立即取消命令（手动优先）
        if (this._moveTarget && this.controlling) {
            const manual = Input.isPressed('KeyW') || Input.isPressed('ArrowUp') ||
                Input.isPressed('KeyS') || Input.isPressed('ArrowDown') ||
                Input.isPressed('KeyA') || Input.isPressed('ArrowLeft') ||
                Input.isPressed('KeyD') || Input.isPressed('ArrowRight');
            if (manual) this._moveTarget = null;
        }
        if (this._moveTarget) {
            // 长按命令：自动飞往目标点，到达或被挡停超时后结束
            const dx = this._moveTarget.x - this.x;
            const dy = this._moveTarget.y - this.y;
            const dist = Math.hypot(dx, dy);
            const arriveRadius = 12;
            if (dist <= arriveRadius) {
                this._moveTarget = null;
                this.vx = 0;
                this.vy = 0;
            } else {
                const step = Math.min(dist, this.speed * dtSec);
                const nx = this.x + (dx / dist) * step;
                const ny = this.y + (dy / dist) * step;
                let rx = nx, ry = ny;
                if (WallSystem) {
                    const resolved = WallSystem.resolve(this.x, this.y, nx, ny, 10);
                    rx = resolved.x;
                    ry = resolved.y;
                }
                // 防卡死：被墙挡住几乎无进展超过0.5s则放弃目标点
                const moved = Math.hypot(rx - this.x, ry - this.y);
                if (moved < 0.5) {
                    this._moveStallMs += dt;
                    if (this._moveStallMs > 500) this._moveTarget = null;
                } else {
                    this._moveStallMs = 0;
                }
                this.x = rx;
                this.y = ry;
            }
            // 操控模式下镜头同步
            if (this.controlling && Renderer.cameraTarget && Renderer.cameraTarget.isDrone) {
                Renderer.cameraTarget.x = this.x;
                Renderer.cameraTarget.y = this.y;
            }
        } else if (this.controlling) {
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
            if (WallSystem) {
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
        } else if (this._holdPosition) {
            // 长按命令后悬停：原地停留（再次长按重新定位）
            this.vx *= 0.82;
            this.vy *= 0.82;
        } else {
            // 非操控模式：跟随玩家，保持在其正前方
            const followAngle = this.player.rotation;
            const targetX = this.player.x + Math.cos(followAngle) * 50;
            const targetY = this.player.y + Math.sin(followAngle) * 50;
            const dx = targetX - this.x;
            const dy = targetY - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 5) {
                const maxMove = this.speed * dtSec;
                const move = Math.min(dist, maxMove);
                this.x += (dx / dist) * move;
                this.y += (dy / dist) * move;
            }
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
        const _baseDamageBonus = (effect && effect.damageBonusPercent) || 10;
        const _baseCritBonus = (effect && effect.critBonusPercent) || 10;
        // 先收集当前在范围内的实体
        const inRangeEntities = new Set();
        const shape = new GroundCircle(this.x, this.y, this.radius);
        entities.forEach(entity => {
            if (entity === this.player || !entity.active || !entity.hittable) return;
            if (shape.intersectsEntity(entity)) {
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

}
