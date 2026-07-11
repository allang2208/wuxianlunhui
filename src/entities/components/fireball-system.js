import { SkillLevelSystem } from '../../combat/skill-level-system.js';
import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { EffectManager } from '../../effects/effect-manager.js';
export class FireballSystem {
    constructor(player) {
        this.player = player;
    }

    trigger() {
        // 如果有飞行中的火球，禁止再次操作
        if (this.player._fireball && this.player._fireball.flyActive) {
            return;
        }
        // 如果已有悬浮火球，发射它
        if (this.player._fireballActive && this.player._fireball && !this.player._fireball.launched) {
            this._launch();
            return;
        }
        // 检查冷却
        if (this.player._fireballCooldown > 0) return;
        // 检查魔法值
        const skill = this.player.skills.fireball;
        if (!skill) return;
        const effect = skill.getEffect ? skill.getEffect(skill.level) : skill.effectFormula;
        const mpCost = effect.mpCost || 50;
        if (this.player.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 30, '魔法不足！', '#ff6b35'));
            return;
        }
        this.player.data.mp -= mpCost;
        this._spawnFireball();
    }

    _spawnFireball() {
        const skill = this.player.skills.fireball;
        if (!skill) return;
        this.player._fireballActive = true;
        this.player._fireballTimer = 0;
        // 在身前30px生成火球
        this.player._fireball = {
            active: true,
            launched: false,
            offsetX: 30, // 身前30px
            offsetY: 0,
            flyX: 0, flyY: 0,
            flyAngle: 0,
            flySpeed: 1600,
            flyDistance: 0,
            flyActive: false,
            animTimer: 0,
            frameIndex: 0,
            swayTimer: 0,
            swayFreqX: 1.5,
            swayAmpX: 2,
            scale: 1.0
        };
        // 加载火球贴图（sprite sheet）
        if (!this.player._fireballImg || this.player._fireballImg.naturalWidth === 0) {
            this.player._fireballImg = new Image();
            this.player._fireballImg.src = 'assets/skills/fireball_spritesheet.png';
        }
        EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 40, '🔥 火球凝聚', '#ff6b35'));
    }

    _launch() {
        if (!this.player._fireball || this.player._fireball.launched) return;
        const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
        const mx = mouseWorld.x, my = mouseWorld.y;
        const fb = this.player._fireball;
        fb.launched = true;
        fb.flyActive = true;
        // 计算起点（世界坐标）
        const cos = Math.cos(this.player.rotation);
        const sin = Math.sin(this.player.rotation);
        fb.flyX = this.player.x + fb.offsetX * cos - fb.offsetY * sin;
        fb.flyY = this.player.y + fb.offsetX * sin + fb.offsetY * cos;
        // 朝向鼠标
        fb.flyAngle = Math.atan2(my - fb.flyY, mx - fb.flyX);
        this.player._fireballTimer = 0;
    }

    update(dt, entities) {
        // 更新悬浮计时
        if (this.player._fireballActive) {
            this.player._fireballTimer += dt;
            // 30秒超时：只在悬浮状态（未发射）下强制结束
            const fb = this.player._fireball;
            if (fb && !fb.launched && this.player._fireballTimer >= 30000) {
                this._end(true);
                return;
            }
            // 更新悬浮火球的摇摆效果和动画帧
            if (fb && !fb.launched) {
                fb.swayTimer += dt / 1000;
                // 更新动画帧
                fb.animTimer = (fb.animTimer || 0) + dt;
                const totalFrames = 73;
                const frameDuration = 100; // ms per frame
                fb.frameIndex = Math.floor(fb.animTimer / frameDuration) % totalFrames;
            }
            // 更新飞行火球的动画帧
            if (fb && fb.flyActive) {
                fb.animTimer = (fb.animTimer || 0) + dt;
                const totalFrames = 73;
                const frameDuration = 50; // 飞行时更快
                fb.frameIndex = Math.floor(fb.animTimer / frameDuration) % totalFrames;
            }
        }
        // 更新飞行中的火球
        this._updateFlyingFireball(dt, entities);
        // 检查是否全部结束
        const fb = this.player._fireball;
        const hasFlying = fb && fb.flyActive;
        const hasUnlaunched = fb && fb.active && !fb.launched;
        if (!hasUnlaunched && !hasFlying && fb) {
            this._end(false);
        }
    }

    _updateFlyingFireball(dt, entities) {
        const fb = this.player._fireball;
        if (!fb || !fb.flyActive) return;
        const dtSec = dt / 1000;
        const skill = this.player.skills.fireball;
        const level = skill ? skill.level : 1;
        const d = this.player.data;
        const baseDamage = 80 + level * 10;
        const magicMul = 2 + 0.5 * level;
        const intMul = 2.5 + 0.75 * level;
        const damage = Math.floor(baseDamage + d.matk * magicMul + d.int * intMul);
        const explosionRadius = 80 + level * 5; // 爆炸范围随等级增加

        const cos = Math.cos(fb.flyAngle), sin = Math.sin(fb.flyAngle);
        const moveDist = fb.flySpeed * dtSec;
        const nextX = fb.flyX + cos * moveDist;
        const nextY = fb.flyY + sin * moveDist;
        fb.flyDistance += moveDist;

        // 最大飞行距离1200px
        if (fb.flyDistance >= 1200) {
            this._explode(fb.flyX, fb.flyY, damage, explosionRadius, entities, skill);
            fb.flyActive = false;
            fb.active = false;
            return;
        }

        // 墙壁碰撞检测
        const resolved = WallSystem.resolve(fb.flyX, fb.flyY, nextX, nextY, 12);
        const hitWall = Math.abs(resolved.x - nextX) > 1 || Math.abs(resolved.y - nextY) > 1;
        if (hitWall) {
            this._explode(resolved.x, resolved.y, damage, explosionRadius, entities, skill);
            fb.flyActive = false;
            fb.active = false;
            return;
        }
        fb.flyX = resolved.x;
        fb.flyY = resolved.y;

        // 目标碰撞检测（命中第一个目标就爆炸）
        let hitEntity = null;
        // entities 可能是 Map，需要转换为数组
        const entityList = Array.from(entities.values ? entities.values() : entities);
        for (const entity of entityList) {
            if (entity === this.player || !entity.active || !entity.hittable) continue;
            const dist = Math.sqrt((entity.x - fb.flyX) ** 2 + (entity.y - fb.flyY) ** 2);
            if (dist < (entity.size || entity.collisionRadius || 0) + 20) {
                hitEntity = entity;
                break;
            }
        }

        if (hitEntity) {
            // 在命中位置造成范围爆炸伤害
            this._explode(fb.flyX, fb.flyY, damage, explosionRadius, entityList, skill);
            fb.flyActive = false;
            fb.active = false;
        }
    }

    _explode(x, y, damage, radius, entities, skill) {
        // 爆炸特效
        this._spawnExplosionEffect(x, y, radius);
        // 范围伤害
        let hitCount = 0;
        let killCount = 0;
        entities.forEach(entity => {
            if (entity === this.player || !entity.active || !entity.hittable) return;
            const dist = Math.sqrt((entity.x - x) ** 2 + (entity.y - y) ** 2);
            if (dist < radius) {
                const wasAlive = entity.hp > 0;
                // 距离衰减：距离中心越近伤害越高
                const distRatio = 1 - Math.min(dist / radius, 1);
                const finalDamage = Math.floor(damage * (0.5 + 0.5 * distRatio));
                entity.takeDamage(finalDamage, this.player, 'magic');
                hitCount++;
                if (wasAlive && entity.hp <= 0) killCount++;
            }
        });
        // 经验
        if (hitCount > 0 && skill) {
            let exp = hitCount * 3 + killCount * 10;
            SkillLevelSystem.addExp(skill, exp, this.player);
            SkillLevelSystem.refreshUI(skill.id);
        }
    }

    _spawnExplosionEffect(x, y, radius) {
        // 爆炸中心特效
        EffectManager.add(new FloatingTextEffect(x, y - 10, '💥', '#ff6b35'));
        // 火焰粒子效果
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 / 8) * i + Math.random() * 0.5;
            const _speed = 100 + Math.random() * 200;
            const px = x + Math.cos(angle) * (radius * 0.3);
            const py = y + Math.sin(angle) * (radius * 0.3);
            EffectManager.add(new FloatingTextEffect(px, py, '🔥', '#ff8844'));
        }
        // 冲击波文字
        EffectManager.add(new FloatingTextEffect(x, y - 20, 'BOOM!', '#ffaa44'));
    }

    _end(forced) {
        if (forced) {
            const fb = this.player._fireball;
            if (fb && fb.active && !fb.launched) {
                fb.active = false;
            }
        }
        // 检查是否还有飞行中的火球
        const fb = this.player._fireball;
        if (fb && fb.flyActive) return;
        // 全部结束，设置冷却
        this.player._fireballActive = false;
        this.player._fireballTimer = 0;
        this.player._fireball = null;
        this.player._fireballCooldown = 20000; // 20秒冷却
    }
}
