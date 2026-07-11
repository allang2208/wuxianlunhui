import { SkillLevelSystem } from '../../combat/skill-level-system.js';
import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { EffectManager } from '../../effects/effect-manager.js';
export class IceSpikeSystem {
    constructor(player) {
        this.player = player;
    }

    trigger() {
        // 如果有飞行中的冰锥，禁止再次操作（直到所有冰锥消失）
        if (this.player._iceSpikeSpikes && this.player._iceSpikeSpikes.some(s => s.flyActive)) {
            return;
        }
        // 如果已有悬浮冰锥，发射它们
        if (this.player._iceSpikeActive && this.player._iceSpikeSpikes && this.player._iceSpikeSpikes.some(s => s.active && !s.launched)) {
            this._launchAll();
            return;
        }
        // 检查冷却
        if (this.player._iceSpikeCooldown > 0) return;
        // 检查魔法值（消耗30 MP）
        const skill = this.player.skills.iceSpike;
        if (!skill) return;
        if (this.player.data.mp < 30) {
            EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 30, '魔法不足！', '#5a8aaa'));
            return;
        }
        this.player.data.mp -= 30;
        this._spawnSpikes();
    }

    _spawnSpikes() {
        const skill = this.player.skills.iceSpike;
        if (!skill) return;
        const level = skill.level;
        const count = 2 + Math.floor((level - 1) / 5); // 2 at lv1, 3 at lv5, 4 at lv10, 5 at lv15, 6 at lv20
        this.player._iceSpikeActive = true;
        this.player._iceSpikeTimer = 0;
        this.player._iceSpikeSpikes = [];
        for (let i = 0; i < count; i++) {
            const side = i % 2 === 0 ? -1 : 1; // 左右交替
            const row = Math.floor(i / 2); // 0, 0, 1, 1, 2, 2...
            const offsetX = -30 - row * 30; // 身后，每对向后30px
            const offsetY = side * 30; // 左右30px
            this.player._iceSpikeSpikes.push({
                id: i,
                offsetX: offsetX,
                offsetY: offsetY,
                active: true,
                launched: false,
                flyX: 0, flyY: 0,
                flyAngle: 0,
                flySpeed: 1600,
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
        // 注意：如果图片已加载但路径不正确（如旧版技能栏图标），需要重新加载
        const GAME_ICE_SPIKE_SRC = 'assets/skills/icearrow.png';
        if (!this.player._iceSpikeImg || this.player._iceSpikeImg.naturalWidth === 0 ||
            this.player._iceSpikeImg.src !== GAME_ICE_SPIKE_SRC) {
            this.player._iceSpikeImg = new Image();
            this.player._iceSpikeImg.src = GAME_ICE_SPIKE_SRC;
        }
        EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 40, `❄ 冰锥凝聚 x${count}`, '#5a8aaa'));
    }

    _launchAll() {
        if (!this.player._iceSpikeSpikes || this.player._iceSpikeSpikes.length === 0) return;
        const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
        const mx = mouseWorld.x, my = mouseWorld.y;
        this.player._iceSpikeSpikes.forEach(spike => {
            if (!spike.active || spike.launched) return;
            spike.launched = true;
            spike.flyActive = true;
            // 计算起点（世界坐标）
            const cos = Math.cos(this.player.rotation);
            const sin = Math.sin(this.player.rotation);
            // 将本地偏移转换为世界坐标
            spike.flyX = this.player.x + spike.offsetX * cos - spike.offsetY * sin;
            spike.flyY = this.player.y + spike.offsetX * sin + spike.offsetY * cos;
            // 朝向鼠标
            spike.flyAngle = Math.atan2(my - spike.flyY, mx - spike.flyX);
        });
        // 发射后保持技能进行中状态（飞行状态仍受保护）
        this.player._iceSpikeTimer = 0;
    }

    update(dt, entities) {
        // 更新悬浮计时
        if (this.player._iceSpikeActive) {
            this.player._iceSpikeTimer += dt;
            // 30秒超时：只在悬浮状态（有未发射冰锥）下强制结束
            const hasUnlaunched = this.player._iceSpikeSpikes && this.player._iceSpikeSpikes.some(s => s.active && !s.launched);
            if (hasUnlaunched && this.player._iceSpikeTimer >= 30000) {
                this._end(true);
                return;
            }
            // 更新悬浮冰锥的摇摆效果
            const now = Date.now() / 1000;
            this.player._iceSpikeSpikes.forEach(spike => {
                if (spike.active && !spike.launched) {
                    spike.swayTimer = now + spike.id * 0.5;
                }
            });
        }
        // 更新飞行中的冰锥
        this._updateFlyingSpikes(dt, entities);
        // 检查是否全部结束：所有冰锥都已发射且没有飞行中的
        const hasFlying = this.player._iceSpikeSpikes && this.player._iceSpikeSpikes.some(s => s.flyActive);
        const hasUnlaunched = this.player._iceSpikeSpikes && this.player._iceSpikeSpikes.some(s => s.active && !s.launched);
        if (!hasUnlaunched && !hasFlying && this.player._iceSpikeSpikes.length > 0) {
            // 全部飞行结束，清理并设置冷却
            this._end(false);
        }
    }

    _updateFlyingSpikes(dt, entities) {
        if (!this.player._iceSpikeSpikes) return;
        const dtSec = dt / 1000;
        const skill = this.player.skills.iceSpike;
        const level = skill ? skill.level : 1;
        const d = this.player.data;
        const baseDamage = 30 + level * 5;
        const magicMul = 1.2 + 0.25 * level;
        const intMul = 1.2 + 0.25 * level;
        const damage = Math.floor(baseDamage + d.matk * magicMul + d.int * intMul);

        this.player._iceSpikeSpikes.forEach(spike => {
            if (!spike.flyActive) return;
            const cos = Math.cos(spike.flyAngle), sin = Math.sin(spike.flyAngle);
            const moveDist = spike.flySpeed * dtSec;
            const nextX = spike.flyX + cos * moveDist;
            const nextY = spike.flyY + sin * moveDist;
            spike.flyDistance += moveDist;
            // 最大飞行距离800px
            if (spike.flyDistance >= 800) {
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
            entities.forEach(entity => {
                if (entity === this.player || !entity.active || !entity.hittable) return;
                const dist = Math.sqrt((entity.x - spike.flyX) ** 2 + (entity.y - spike.flyY) ** 2);
                if (dist < entity.size + 12) {
                    const wasAlive = entity.hp > 0;
                    entity.takeDamage(damage, this.player, 'magic');
                    hitCount++;
                    if (wasAlive && entity.hp <= 0) killCount++;
                    // 冰锥破碎特效
                    this._spawnIceBreakEffect(spike.flyX, spike.flyY);
                    spike.flyActive = false;
                    spike.active = false;
                }
            });
            // 经验（每个冰锥独立计算）
            if (hitCount > 0 && skill) {
                let exp = hitCount * 3 + killCount * 10;
                SkillLevelSystem.addExp(skill, exp, this.player);
                SkillLevelSystem.refreshUI(skill.id);
            }
        });
    }

    _spawnIceBreakEffect(x, y) {
        // 简单白色冰屑特效
        for (let i = 0; i < 5; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 50 + Math.random() * 100;
            EffectManager.add(new FloatingTextEffect(x, y, '❄', '#aaddff'));
        }
    }

    _end(forced) {
        if (forced) {
            // 强制结束：未发射的冰锥消失
            if (this.player._iceSpikeSpikes) {
                this.player._iceSpikeSpikes.forEach(s => {
                    if (s.active && !s.launched) {
                        s.active = false;
                    }
                });
            }
        }
        // 检查是否还有飞行中的冰锥
        const stillFlying = this.player._iceSpikeSpikes && this.player._iceSpikeSpikes.some(s => s.flyActive);
        if (stillFlying) return;
        // 全部结束，设置冷却
        this.player._iceSpikeActive = false;
        this.player._iceSpikeTimer = 0;
        this.player._iceSpikeSpikes = [];
        this.player._iceSpikeCooldown = 10000; // 10秒冷却
    }
}
