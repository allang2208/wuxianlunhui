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
 * 冰锥系统（通用版）
 * 支持玩家与敌人作为施法者（source）。
 * 玩家通过鼠标瞄准；非玩家单位自动瞄准 source.target。
 */
export class IceSpikeSystem {
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

    /**
     * 获取瞄准目标的世界坐标
     * @returns {{x:number, y:number}|null}
     */
    _getAimTarget() {
        if (this._isPlayer()) {
            return Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
        }
        const target = this.source.target;
        if (!target || !target.active) return null;
        const skill = this.source.skills && this.source.skills.iceSpike;
        const effect = skill ? skill.getEffect(skill.level) : {};
        const speed = effect.flySpeed || 1600;
        return AimHelper.lead(this.source.x, this.source.y, target.x, target.y, target.vx || 0, target.vy || 0, speed);
    }

    trigger() {
        // 如果有飞行中的冰锥，禁止再次操作（直到所有冰锥消失）
        if (this.source._iceSpikeSpikes && this.source._iceSpikeSpikes.some(s => s.flyActive)) {
            return;
        }
        // 如果已有悬浮冰锥，发射它们
        if (this.source._iceSpikeActive && this.source._iceSpikeSpikes && this.source._iceSpikeSpikes.some(s => s.active && !s.launched)) {
            this._launchAll();
            return;
        }
        // 检查冷却
        if (this.source._iceSpikeCooldown > 0) return;

        const skill = this.source.skills && this.source.skills.iceSpike;
        if (!skill) return;
        const effect = skill.getEffect(skill.level);

        // 玩家消耗魔法值；敌人不消耗
        if (this._isPlayer()) {
            if (this.source.data.mp < effect.mpCost) {
                EffectManager.add(new FloatingTextEffect(this.source.x, this.source.y - 30, '魔法不足！', '#5a8aaa'));
                return;
            }
            this.source.data.mp -= effect.mpCost;
        }
        this._spawnSpikes(effect);
    }

    _spawnSpikes(effect) {
        const skill = this.source.skills.iceSpike;
        if (!skill) return;
        const count = effect.spikeCount;
        this.source._iceSpikeActive = true;
        this.source._iceSpikeTimer = 0;
        this.source._iceSpikeSpikes = [];
        for (let i = 0; i < count; i++) {
            const side = i % 2 === 0 ? -1 : 1; // 左右交替
            const row = Math.floor(i / 2); // 0, 0, 1, 1, 2, 2...
            const offsetX = -30 - row * 30; // 身后，每对向后30px
            const offsetY = side * 30; // 左右30px
            this.source._iceSpikeSpikes.push({
                id: i,
                offsetX: offsetX,
                offsetY: offsetY,
                active: true,
                launched: false,
                flyX: 0, flyY: 0,
                flyAngle: 0,
                flySpeed: effect.flySpeed,
                flyDistance: 0,
                flyActive: false,
                swayTimer: i * 0.5,
                swayFreqX: 2.0 + Math.random() * 0.5,
                swayFreqY: 1.5 + Math.random() * 0.5,
                swayAmpX: 3,
                swayAmpY: 2
            });
        }
        // 加载冰锥贴图（游戏内冰锥贴图，非技能栏图标）
        const GAME_ICE_SPIKE_SRC = 'assets/skills/icearrow.png';
        if (!this.source._iceSpikeImg || this.source._iceSpikeImg.naturalWidth === 0 ||
            this.source._iceSpikeImg.src !== GAME_ICE_SPIKE_SRC) {
            this.source._iceSpikeImg = loadImage(GAME_ICE_SPIKE_SRC);
        }
        EffectManager.add(new FloatingTextEffect(this.source.x, this.source.y - 40, `❄ 冰锥凝聚 x${count}`, '#5a8aaa'));
    }

    _launchAll() {
        if (!this.source._iceSpikeSpikes || this.source._iceSpikeSpikes.length === 0) return;
        const target = this._getAimTarget();
        if (!target) return;
        const mx = target.x, my = target.y;
        this.source._iceSpikeSpikes.forEach(spike => {
            if (!spike.active || spike.launched) return;
            spike.launched = true;
            spike.flyActive = true;
            // 计算起点（世界坐标）
            const cos = Math.cos(this.source.rotation || 0);
            const sin = Math.sin(this.source.rotation || 0);
            // 将本地偏移转换为世界坐标
            spike.flyX = this.source.x + spike.offsetX * cos - spike.offsetY * sin;
            spike.flyY = this.source.y + spike.offsetX * sin + spike.offsetY * cos;
            // 朝向目标
            spike.flyAngle = Math.atan2(my - spike.flyY, mx - spike.flyX);
        });
        // 发射后保持技能进行中状态（飞行状态仍受保护）
        this.source._iceSpikeTimer = 0;
    }

    update(dt, entities) {
        const skill = this.source.skills && this.source.skills.iceSpike;
        const effect = skill ? skill.getEffect(skill.level) : {};
        // 更新悬浮计时
        if (this.source._iceSpikeActive) {
            this.source._iceSpikeTimer += dt;
            // 配置时长超时：只在悬浮状态（有未发射冰锥）下强制结束
            const hasUnlaunched = this.source._iceSpikeSpikes && this.source._iceSpikeSpikes.some(s => s.active && !s.launched);
            if (hasUnlaunched && this.source._iceSpikeTimer >= effect.duration * 1000) {
                this._end(true);
                return;
            }
            // 更新悬浮冰锥的摇摆效果
            const now = Date.now() / 1000;
            this.source._iceSpikeSpikes.forEach(spike => {
                if (spike.active && !spike.launched) {
                    spike.swayTimer = now + spike.id * 0.5;
                }
            });
        }
        // 更新飞行中的冰锥
        this._updateFlyingSpikes(dt, entities);
        // 检查是否全部结束：所有冰锥都已发射且没有飞行中的
        const hasFlying = this.source._iceSpikeSpikes && this.source._iceSpikeSpikes.some(s => s.flyActive);
        const hasUnlaunched = this.source._iceSpikeSpikes && this.source._iceSpikeSpikes.some(s => s.active && !s.launched);
        if (!hasUnlaunched && !hasFlying && this.source._iceSpikeSpikes.length > 0) {
            // 全部飞行结束，清理并设置冷却
            this._end(false);
        }
    }

    _updateFlyingSpikes(dt, entities) {
        if (!this.source._iceSpikeSpikes) return;
        const dtSec = dt / 1000;
        const skill = this.source.skills.iceSpike;
        const effect = skill ? skill.getEffect(skill.level) : {};
        const d = this.source.data;
        const baseDamage = effect.damageBase;
        const magicMul = effect.magicMul;
        const intMul = effect.intMul;
        const damage = Math.floor(baseDamage + d.matk * magicMul + d.int * intMul);

        this.source._iceSpikeSpikes.forEach(spike => {
            if (!spike.flyActive) return;
            const cos = Math.cos(spike.flyAngle), sin = Math.sin(spike.flyAngle);
            const moveDist = spike.flySpeed * dtSec;
            const nextX = spike.flyX + cos * moveDist;
            const nextY = spike.flyY + sin * moveDist;
            spike.flyDistance += moveDist;
            // 最大飞行距离
            if (spike.flyDistance >= effect.maxRange) {
                spike.flyActive = false;
                spike.active = false;
                return;
            }
            // 墙壁碰撞检测
            const resolved = WallSystem.resolve(spike.flyX, spike.flyY, nextX, nextY, 8);
            const hitWall = Math.abs(resolved.x - nextX) > 1 || Math.abs(resolved.y - nextY) > 1;
            if (hitWall) {
                // 冰锥破碎特效
                this._spawnIceBreakEffect(spike.flyX, spike.flyY);
                spike.flyActive = false;
                spike.active = false;
                return;
            }
            spike.flyX = resolved.x;
            spike.flyY = resolved.y;
            // 目标碰撞检测
            let hitCount = 0;
            let killCount = 0;
            const entityList = Array.from(entities.values ? entities.values() : entities);
            const hitShape = new GroundCircle(spike.flyX, spike.flyY, 12);
            entityList.forEach(entity => {
                if (!this._isHostile(entity) || !entity.active || !entity.hittable) return;
                // 地面 footprint 或 躯干矩形（投射物贴图身体位置）任一命中即算命中
                if (!hitShape.intersectsEntity(entity) && !pointHitsTorso(entity, spike.flyX, spike.flyY, 12)) return;
                const wasAlive = entity.hp > 0;
                entity.takeDamage(damage, this.source, 'magic');
                hitCount++;
                if (wasAlive && entity.hp <= 0 && !entity._summoned) killCount++;
                // 冰锥破碎特效
                this._spawnIceBreakEffect(spike.flyX, spike.flyY);
                spike.flyActive = false;
                spike.active = false;
            });
            // 经验（仅玩家获得）
            if (hitCount > 0 && skill && this._isPlayer()) {
                SkillManager.addIceSpikeExp(this.source, hitCount, killCount);
            }
        });
    }

    _spawnIceBreakEffect(x, y) {
        // 简单白色冰屑特效
        for (let i = 0; i < 5; i++) {
            const _angle = Math.random() * Math.PI * 2;
            const _speed = 50 + Math.random() * 100;
            EffectManager.add(new FloatingTextEffect(x, y, '❄', '#aaddff'));
        }
    }

    _end(forced) {
        if (forced) {
            // 强制结束：未发射的冰锥消失
            if (this.source._iceSpikeSpikes) {
                this.source._iceSpikeSpikes.forEach(s => {
                    if (s.active && !s.launched) {
                        s.active = false;
                    }
                });
            }
        }
        // 检查是否还有飞行中的冰锥
        const stillFlying = this.source._iceSpikeSpikes && this.source._iceSpikeSpikes.some(s => s.flyActive);
        if (stillFlying) return;
        // 全部结束，设置冷却
        const skill = this.source.skills.iceSpike;
        const effect = skill ? skill.getEffect(skill.level) : {};
        this.source._iceSpikeActive = false;
        this.source._iceSpikeTimer = 0;
        this.source._iceSpikeSpikes = [];
        this.source._iceSpikeCooldown = effect.cooldown * 1000;
    }
}
