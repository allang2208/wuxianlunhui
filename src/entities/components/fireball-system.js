import { SkillManager } from '../../ui/skill-manager.js';
import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { loadImage } from '../../utils/image-loader.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { AimHelper } from '../../utils/aim-helper.js';
import { GroundCircle } from '../../physics/skill-shapes.js';
import { pointHitsTorso } from '../../physics/torso-hitbox.js';

/**
 * 火球系统（通用版）
 * 支持玩家与敌人作为施法者（source）。
 * 玩家通过鼠标瞄准；非玩家单位自动瞄准 source.target。
 */
export class FireballSystem {
    constructor(source, options = {}) {
        this.source = source;
        this.options = options;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    _isHostile(entity) {
        if (!entity || entity === this.source) return false;
        return entity._faction !== this.source._faction;
    }

    _getAimTarget() {
        if (this._isPlayer()) {
            return Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
        }
        const target = this.source.target;
        if (!target || !target.active) return null;
        const skill = this.source.skills && this.source.skills.fireball;
        const effect = skill ? skill.getEffect(skill.level) : {};
        const speed = effect.flySpeed || 1600;
        return AimHelper.lead(this.source.x, this.source.y, target.x, target.y, target.vx || 0, target.vy || 0, speed);
    }

    trigger() {
        // 如果有飞行中的火球，禁止再次操作
        if (this.source._fireball && this.source._fireball.flyActive) {
            return;
        }
        // 如果已有悬浮火球，发射它
        if (this.source._fireballActive && this.source._fireball && !this.source._fireball.launched) {
            this._launch();
            return;
        }
        // 检查冷却
        if (this.source._fireballCooldown > 0) return;

        const skill = this.source.skills && this.source.skills.fireball;
        if (!skill) return;

        const effect = skill.getEffect(skill.level);

        // 玩家消耗魔法值；敌人不消耗
        if (this._isPlayer()) {
            if (this.source.data.mp < effect.mpCost) {
                EffectManager.add(new FloatingTextEffect(this.source.x, this.source.y - 30, '魔法不足！', '#ff6b35'));
                return;
            }
            this.source.data.mp -= effect.mpCost;
        }
        this._spawnFireball(effect);
    }

    _spawnFireball(effect) {
        const skill = this.source.skills && this.source.skills.fireball;
        if (!skill) return;
        this.source._fireballActive = true;
        this.source._fireballTimer = 0;
        // 在身前30px生成火球
        this.source._fireball = {
            active: true,
            launched: false,
            offsetX: 30, // 身前30px（纯视觉偏移）
            offsetY: 0,
            flyX: 0, flyY: 0,
            flyAngle: 0,
            flySpeed: effect.flySpeed,
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
        if (!this.source._fireballImg || this.source._fireballImg.naturalWidth === 0) {
            this.source._fireballImg = loadImage('assets/skills/fireball_spritesheet.png');
        }
        EffectManager.add(new FloatingTextEffect(this.source.x, this.source.y - 40, '🔥 火球凝聚', '#ff6b35'));
    }

    _launch() {
        if (!this.source._fireball || this.source._fireball.launched) return;
        const target = this._getAimTarget();
        if (!target) return;
        const mx = target.x, my = target.y;
        const fb = this.source._fireball;
        fb.launched = true;
        fb.flyActive = true;
        // 计算起点（世界坐标）
        const cos = Math.cos(this.source.rotation || 0);
        const sin = Math.sin(this.source.rotation || 0);
        fb.flyX = this.source.x + fb.offsetX * cos - fb.offsetY * sin;
        fb.flyY = this.source.y + fb.offsetX * sin + fb.offsetY * cos;
        // 朝向目标
        fb.flyAngle = Math.atan2(my - fb.flyY, mx - fb.flyX);
        this.source._fireballTimer = 0;
    }

    update(dt, entities) {
        const skill = this.source.skills && this.source.skills.fireball;
        const effect = skill ? skill.getEffect(skill.level) : {};
        // 更新悬浮计时
        if (this.source._fireballActive) {
            this.source._fireballTimer += dt;
            // 配置时长超时：只在悬浮状态（未发射）下强制结束
            const fb = this.source._fireball;
            if (fb && !fb.launched && this.source._fireballTimer >= effect.duration * 1000) {
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
        const fb = this.source._fireball;
        const hasFlying = fb && fb.flyActive;
        const hasUnlaunched = fb && fb.active && !fb.launched;
        if (!hasUnlaunched && !hasFlying && fb) {
            this._end(false);
        }
    }

    _updateFlyingFireball(dt, entities) {
        const fb = this.source._fireball;
        if (!fb || !fb.flyActive) return;
        const dtSec = dt / 1000;
        const skill = this.source.skills && this.source.skills.fireball;
        const effect = skill ? skill.getEffect(skill.level) : {};
        const d = this.source.data;
        const baseDamage = effect.damageBase;
        const magicMul = effect.magicMul;
        const intMul = effect.intMul;
        const damage = Math.floor(baseDamage + d.matk * magicMul + d.int * intMul);
        const explosionRadius = effect.explosionRadius;

        const cos = Math.cos(fb.flyAngle), sin = Math.sin(fb.flyAngle);
        const moveDist = fb.flySpeed * dtSec;
        const nextX = fb.flyX + cos * moveDist;
        const nextY = fb.flyY + sin * moveDist;
        fb.flyDistance += moveDist;

        // 最大飞行距离
        if (fb.flyDistance >= effect.maxRange) {
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
        const hitShape = new GroundCircle(fb.flyX, fb.flyY, 20);
        for (const entity of entityList) {
            if (!this._isHostile(entity) || !entity.active || !entity.hittable) continue;
            // 地面 footprint 或 躯干矩形（投射物贴图身体位置）任一命中即算命中
            if (hitShape.intersectsEntity(entity) || pointHitsTorso(entity, fb.flyX, fb.flyY, 20)) {
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
        const entityList = Array.from(entities.values ? entities.values() : entities);
        const explosionShape = new GroundCircle(x, y, radius);
        entityList.forEach(entity => {
            if (!this._isHostile(entity) || !entity.active || !entity.hittable) return;
            if (!explosionShape.intersectsEntity(entity)) return;
            const wasAlive = entity.hp > 0;
            // 距离衰减：距离中心越近伤害越高
            const dist = Math.sqrt((entity.x - x) ** 2 + (entity.y - y) ** 2);
            const distRatio = 1 - Math.min(dist / radius, 1);
            const finalDamage = Math.floor(damage * (0.5 + 0.5 * distRatio));
            entity.takeDamage(finalDamage, this.source, 'magic');
            hitCount++;
            if (wasAlive && entity.hp <= 0 && !entity._summoned) killCount++;
        });
        // 经验（仅玩家获得）
        if (hitCount > 0 && skill && this._isPlayer()) {
            SkillManager.addFireballExp(this.source, hitCount, killCount);
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
        const skill = this.source.skills && this.source.skills.fireball;
        const effect = skill ? skill.getEffect(skill.level) : {};
        if (forced) {
            const fb = this.source._fireball;
            if (fb && fb.active && !fb.launched) {
                fb.active = false;
            }
        }
        // 检查是否还有飞行中的火球
        const fb = this.source._fireball;
        if (fb && fb.flyActive) return;
        // 全部结束，设置冷却
        this.source._fireballActive = false;
        this.source._fireballTimer = 0;
        this.source._fireball = null;
        this.source._fireballCooldown = effect.cooldown * 1000;
    }
}
