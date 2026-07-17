import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { loadImage } from '../../utils/image-loader.js';
import { RuneSwordExplodeEffect } from '../../effects/particle-effects.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { QuickBar } from '../../ui/quick-bar.js';
import { GroundCircle } from '../../physics/skill-shapes.js';
import { pointHitsTorso } from '../../physics/torso-hitbox.js';
export class RuneSwordSystem {
    constructor(player) {
        this.player = player;
    }

    trigger() {
        const currentItem = this.player.equipments[this.player.weaponMode];
        if (!currentItem || currentItem.specialAttackType !== 'runeSword') return;
        if (this.player._specialAttackCooldowns['runeSword'] > 0 || this.player._runeSwordSpecialActive) return;
        this.player._runeSwordSpecialActive = true;
        this.player._runeSwordSpecialTimer = 0;
        // 基础4把剑：左右两侧50px/100px偏移
        const offsets = [
            { side: 'left', offsetX: -50 },
            { side: 'left', offsetX: -100 },
            { side: 'right', offsetX: 50 },
            { side: 'right', offsetX: 100 }
        ];
        // 符文重构：额外生成魔法剑，依次向外40px
        const ce = currentItem._craftEffects || {};
        const extraCount = ce.runeRestructureCount || 0;
        for (let i = 0; i < extraCount; i++) {
            const step = Math.floor(i / 2) + 1;
            if (i % 2 === 0) {
                offsets.push({ side: 'left', offsetX: -100 - step * 40 });
            } else {
                offsets.push({ side: 'right', offsetX: 100 + step * 40 });
            }
        }
        this.player._runeSwordSwords = offsets.map((o, i) => ({
            id: i,
            side: o.side,
            offsetX: o.offsetX,
            offsetY: 0,
            active: true,
            launched: false,
            fading: false,
            fadeTimer: 0,
            flyX: 0, flyY: 0,
            flyAngle: 0,
            flySpeed: 1200, // 1200px/s
            flyDistance: 0, // 已飞行距离
            flyActive: false,
            currentAngle: 0, // 当前朝向角度（用于平滑旋转）
            swayTimer: i * 0.5, // 每把剑不同的初始相位，避免同步
            swayFreqX: 2.0 + Math.random() * 0.5,
            swayFreqY: 1.5 + Math.random() * 0.5,
            swayAmpX: 3,   // 左右摇摆幅度 3px
            swayAmpY: 2    // 前后摇摆幅度 2px
        }));
        // 加载蓝色能量剑贴图
        if (!this.player._runeSwordBladeImg) {
            this.player._runeSwordBladeImg = loadImage('assets/weapons/blue_energy_sword_pure.png');
        }
    }

    update(dt, entities) {
        if (!this.player._runeSwordSpecialActive) return;
        this.player._runeSwordSpecialTimer += dt;
        // 30秒超时：强制结束
        if (this.player._runeSwordSpecialTimer >= 30000) {
            this._end(true);
            return;
        }
        // 检查是否还有未发射的剑（不包括正在淡出的）
        const remaining = this.player._runeSwordSwords.filter(s => s.active && !s.launched && !s.fading).length;
        const stillFading = this.player._runeSwordSwords.some(s => s.fading && s.fadeTimer < 300);
        if (remaining === 0 && !stillFading && this.player._runeSwordSwords.every(s => !s.flyActive)) {
            // 全部发射完毕且飞行结束且无淡出的剑
            this._end(false);
            return;
        }
        // 更新飞行中的剑
        this._updateFlyingBlades(dt, entities);
        // 更新悬浮剑的摇摆效果
        const now = Date.now() / 1000;
        this.player._runeSwordSwords.forEach(s => {
            if (s.active && !s.launched && !s.fading) {
                s.swayTimer = now + s.id * 0.5; // 不同初始相位
            }
        });
        // 更新淡出中的剑
        this.player._runeSwordSwords.forEach(s => {
            if (s.fading) {
                s.fadeTimer += dt;
                if (s.fadeTimer >= 300) s.active = false;
            }
        });
    }

    _launchBlade() {
        if (!this.player._runeSwordSpecialActive) return;
        const available = this.player._runeSwordSwords.filter(s => s.active && !s.launched && !s.fading);
        if (available.length === 0) return;
        // 随机选择一把
        const idx = Math.floor(Math.random() * available.length);
        const sword = available[idx];
        sword.launched = true;
        sword.flyActive = true;
        // 计算发射起点（剑当前世界坐标）
        const cos = Math.cos(this.player.rotation), sin = Math.sin(this.player.rotation);
        const perpX = -sin, perpY = cos;
        sword.flyX = this.player.x + sword.offsetX * perpX;
        sword.flyY = this.player.y + sword.offsetX * perpY;
        // 每把剑独立计算朝向：从剑位置到鼠标位置
        const sp = Renderer.worldToScreen(this.player.x, this.player.y);
        let mouseWorldX = this.player.x, mouseWorldY = this.player.y;
        if (Input.mouse && typeof Input.mouse.x === 'number' && typeof Input.mouse.y === 'number' && sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
            mouseWorldX = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y).x;
            mouseWorldY = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y).y;
        }
        sword.flyAngle = Math.atan2(mouseWorldY - sword.flyY, mouseWorldX - sword.flyX);
    }

    _updateFlyingBlades(dt, entities) {
        const dtSec = dt / 1000;
        this.player._runeSwordSwords.forEach(sword => {
            if (!sword.flyActive) return;
            const cos = Math.cos(sword.flyAngle), sin = Math.sin(sword.flyAngle);
            // 移动：速度 600px/s
            const moveDist = sword.flySpeed * dtSec;
            const nextX = sword.flyX + cos * moveDist;
            const nextY = sword.flyY + sin * moveDist;
            sword.flyDistance += moveDist;
            // 最大飞行距离：基础1000px + 鹰眼符文加成
            const currentItem = this.player.equipments[this.player.weaponMode];
            const ce = currentItem && currentItem._craftEffects || {};
            const maxFlyDistance = 1000 + (ce.specialRangeDelta || 0);
            if (sword.flyDistance >= maxFlyDistance) {
                EffectManager.add(new RuneSwordExplodeEffect(sword.flyX, sword.flyY));
                sword.flyActive = false;
                sword.active = false;
                return;
            }
            // 墙壁碰撞检测
            const resolved = WallSystem.resolve(sword.flyX, sword.flyY, nextX, nextY, 8);
            const hitWall = Math.abs(resolved.x - nextX) > 1 || Math.abs(resolved.y - nextY) > 1;
            if (hitWall) {
                EffectManager.add(new RuneSwordExplodeEffect(sword.flyX, sword.flyY));
                sword.flyActive = false;
                sword.active = false;
                return;
            }
            sword.flyX = resolved.x;
            sword.flyY = resolved.y;
            // 目标碰撞检测
            const hitShape = new GroundCircle(sword.flyX, sword.flyY, 15);
            entities.forEach(entity => {
                if (entity === this.player || !entity.active || !entity.hittable) return;
                // 地面 footprint 或 躯干矩形（投射物贴图身体位置）任一命中即算命中
                if (!hitShape.intersectsEntity(entity) && !pointHitsTorso(entity, sword.flyX, sword.flyY, 15)) return;
                const d = this.player.data;
                const physAtk = this.player.getCurrentWeaponAtk();
                const magicAtk = d.matk || 0;
                const damage = Math.floor((physAtk + magicAtk) * 1.2);
                const wasAlive = entity.hp > 0;
                entity.takeDamage(damage, this.player, 'magic');
                if (wasAlive && entity.hp <= 0) {
                    this._triggerCooldownReduction();
                }
                // 毁灭符文：击中后附加魔力易伤
                if (ce.magicVulnerabilityOnHit && entity.applyMagicVulnerability) {
                    const stacks = ce.magicVulnerabilityStacks || 2;
                    entity.applyMagicVulnerability(stacks);
                }
                EffectManager.add(new RuneSwordExplodeEffect(sword.flyX, sword.flyY));
                sword.flyActive = false;
                sword.active = false;
            });
        });
    }

    _end(forced) {
        if (!this.player._runeSwordSpecialActive) return;
        if (forced) {
            // 强制结束：未发射的剑淡出消失
            this.player._runeSwordSwords.forEach(s => {
                if (s.active && !s.launched) {
                    s.fading = true;
                    s.fadeTimer = 0;
                }
            });
            // 检查是否所有淡出都完成
            const stillFading = this.player._runeSwordSwords.some(s => s.fading && s.fadeTimer < 300);
            const stillFlying = this.player._runeSwordSwords.some(s => s.flyActive);
            if (stillFading || stillFlying) return; // 还有动画在进行，不立即结束
        }
        // 触发复位动画
        this.player._runeSwordResetAnim = {
            startOffset: 0,
            startAngle: 0,
            startRotation: this.player.rotation,
            targetRotation: (() => { const sp = Renderer.worldToScreen(this.player.x, this.player.y); return Math.atan2(Input.mouse.y - sp.y, Input.mouse.x - sp.x); })(),
            startTime: Date.now(),
            duration: (WeaponAnimConfig.stab && WeaponAnimConfig.stab.recoverMs) || 500
        };
        this.player._runeSwordSpecialActive = false;
        this.player._runeSwordSpecialTimer = 0;
        this.player._runeSwordSwords = [];
        this.player._specialAttackCooldowns['runeSword'] = 15000; // 15秒冷却
        // 不关闭图标！图标保持显示，冷却期间显示遮罩
    }

    _triggerCooldownReduction() {
        const currentItem = this.player.equipments[this.player.weaponMode];
        if (!currentItem || currentItem.specialAttackType !== 'runeSword') return;
        // 减少所有快捷栏技能CD 0.5秒
        for (const skillId in QuickBar.cooldowns) {
            if (QuickBar.cooldowns[skillId] > 0) {
                QuickBar.cooldowns[skillId] = Math.max(0, QuickBar.cooldowns[skillId] - 500);
            }
        }
        // 同时减少所有特殊攻击自身CD 0.5秒
        for (const type in this.player._specialAttackCooldowns) {
            if (this.player._specialAttackCooldowns[type] > 0) {
                this.player._specialAttackCooldowns[type] = Math.max(0, this.player._specialAttackCooldowns[type] - 500);
            }
        }
        // 触发白色闪烁特效
        QuickBar._flashAllCooldownSlots();
    }
}
