import { WallSystem } from '../world/wall-system.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { Renderer } from '../world/renderer.js';
import { EffectManager } from '../effects/effect-manager.js';

/**
 * 战术小队AI系统
 * 管理6人战术小队的协同行动：指挥官、机枪手、步枪手A、步枪手B、盾卫A、盾卫B
 * 特性：死追到底 + 共享视野 + 附近搜索
 */
export class TacticalSquadAI {
    constructor() {
        this.members = [];
        // 全队共享视野：最后已知目标位置 + 是否有人能看到目标
        this._sharedTargetPos = null;
        this._sharedTargetTimer = 0; // 共享信息过期计时
        this._sharedExpireMs = 30000; // 30秒内全队共享目标位置
        // 搜索状态
        this._searchRadius = 200; // 搜索半径（到达最后位置后开始绕圈搜索）
        // [DRONE] 指挥官无人机状态
        this._drone = {
            active: false,
            x: 0, y: 0,
            vx: 0, vy: 0,
            speed: 500,
            radius: 300,
            duration: 0,       // 剩余持续时间(ms)
            maxDuration: 30000, // 30秒
            cooldown: 0,      // 冷却计时(ms)
            cooldownMs: 20000,  // 20秒冷却
            checkTimer: 0,    // debuff检测计时
            _affectedEntities: new Set(), // 当前被影响的目标
            _image: null
        };
        // 预加载无人机贴图
        const img = new Image();
        img.src = 'assets/skills/drone.png';
        this._drone._image = img;
    }

    addMember(member, role) {
        member._tacticalRole = role;
        this.members.push(member);
        if (role === 'commander') {
            member._droneReady = true;
            member._droneActive = false;
        }
    }

    clear() {
        this.members = [];
        this._sharedTargetPos = null;
        this._sharedTargetTimer = 0;
    }

    update(dt, player, entities) {
        if (!player || !player.active) return;
        if (this.members.length === 0) return;
        // ===== 共享视野：检测谁有视线，广播给全队 =====
        this._updateSharedVision(dt, player, entities);
        // 各角色AI（使用共享目标）
        this._updateCommander(dt, player, entities);
        this._updateMachineGunner(dt, player, entities);
        this._updateRiflemen(dt, player, entities);
        this._updateShieldBearers(dt, player, entities);
    }

    // ===== 共享视野系统 =====
    _updateSharedVision(dt, player, entities) {
        let someoneHasLOS = false;
        let bestPos = null;
        // 检查每个成员是否有视线
        for (const m of this.members) {
            if (!m.active || !m.target) continue;
            const hasLOS = typeof WallSystem === 'undefined' || !WallSystem.blocked(m.x, m.y, player.x, player.y);
            if (hasLOS) {
                someoneHasLOS = true;
                bestPos = { x: player.x, y: player.y };
                break; // 有人看到就够了
            }
        }
        if (someoneHasLOS) {
            // 有人看到玩家：更新共享位置，重置计时，广播给所有成员
            this._sharedTargetPos = bestPos;
            this._sharedTargetTimer = this._sharedExpireMs;
            for (const m of this.members) {
                if (m.active) {
                    m.target = player;
                    m._lastKnownTargetPos = { x: player.x, y: player.y };
                    m._lostSightTimer = 0;
                    m._sharedTargetTimer = this._sharedTargetTimer;
                }
            }
        } else {
            // 没人看到：递减共享计时
            this._sharedTargetTimer -= dt;
            if (this._sharedTargetTimer > 0) {
                // 共享信息仍在有效期内：给没有目标的成员重新分配目标，并同步计时器
                for (const m of this.members) {
                    if (m.active && (!m.target || !m.target.active)) {
                        m.target = player;
                        m._lastKnownTargetPos = this._sharedTargetPos ? { ...this._sharedTargetPos } : null;
                    }
                    m._sharedTargetTimer = this._sharedTargetTimer;
                }
            } else {
                // 共享过期：清除成员的共享计时器，进入搜索模式
                for (const m of this.members) {
                    if (m.active) {
                        m._sharedTargetTimer = 0;
                    }
                }
                this._updateSearchMode(dt, player);
            }
        }
    }

    // 搜索模式：所有成员以 _sharedTargetPos 为圆心，在附近巡逻搜索
    _updateSearchMode(dt, player) {
        if (!this._sharedTargetPos) return;
        // 每5秒重新随机一次搜索点
        this._searchTimer = (this._searchTimer || 0) - dt;
        if (this._searchTimer <= 0) {
            this._searchTimer = 5000;
            for (let i = 0; i < this.members.length; i++) {
                const m = this.members[i];
                if (!m.active) continue;
                const angle = (Math.PI * 2 / this.members.length) * i + Math.random() * 0.5;
                const dist = this._searchRadius * (0.5 + Math.random() * 0.5);
                m._searchTarget = {
                    x: this._sharedTargetPos.x + Math.cos(angle) * dist,
                    y: this._sharedTargetPos.y + Math.sin(angle) * dist
                };
            }
        }
        // 应用搜索目标
        for (const m of this.members) {
            if (m.active && m._searchTarget) {
                m._lastKnownTargetPos = { ...m._searchTarget };
            }
        }
    }

    _updateCommander(dt, player, entities) {
        const cmd = this.members.find(m => m._tacticalRole === 'commander');
        if (!cmd || !cmd.active) return;
        const dist = Math.sqrt((player.x - cmd.x) ** 2 + (player.y - cmd.y) ** 2);
        const angle = Math.atan2(player.y - cmd.y, player.x - cmd.x);
        let desiredDist = 700;
        if (dist < 650) desiredDist = 750;
        else if (dist > 750) desiredDist = 650;
        cmd._tacticalTarget = { x: player.x - Math.cos(angle) * desiredDist, y: player.y - Math.sin(angle) * desiredDist };
        // ===== [DRONE] 指挥官自动追踪无人机 =====
        this._updateCommanderDrone(dt, cmd, player, entities, dist);
    }

    // [DRONE] 自动追踪无人机系统
    _updateCommanderDrone(dt, cmd, player, entities, dist) {
        const drone = this._drone;
        // 更新冷却
        if (drone.cooldown > 0) {
            drone.cooldown -= dt;
        }
        // 如果无人机已激活，更新追踪逻辑
        if (drone.active) {
            drone.duration -= dt;
            if (drone.duration <= 0) {
                // 回收无人机
                this._deactivateDrone();
                return;
            }
            // 追踪玩家：向玩家方向移动
            const toPlayerAngle = Math.atan2(player.y - drone.y, player.x - drone.x);
            const toPlayerDist = Math.sqrt((player.x - drone.x) ** 2 + (player.y - drone.y) ** 2);
            const sc = dt / 1000;
            // 保持300px范围（范围内绕圈，范围外追赶）
            if (toPlayerDist > drone.radius * 0.8) {
                drone.vx += (Math.cos(toPlayerAngle) * drone.speed - drone.vx) * 0.7;
                drone.vy += (Math.sin(toPlayerAngle) * drone.speed - drone.vy) * 0.7;
            } else {
                // 范围内：环绕玩家（减少靠近趋势）
                const tangentAngle = toPlayerAngle + Math.PI / 2;
                drone.vx += (Math.cos(tangentAngle) * drone.speed * 0.6 - drone.vx) * 0.3;
                drone.vy += (Math.sin(tangentAngle) * drone.speed * 0.6 - drone.vy) * 0.3;
            }
            // 墙壁碰撞：[FIX] 无人机无碰撞体积，直接穿过障碍物
            drone.x = drone.x + drone.vx * sc;
            drone.y = drone.y + drone.vy * sc;
            // 每0.25s检测范围内敌人并施加debuff
            drone.checkTimer -= dt;
            if (drone.checkTimer <= 0) {
                drone.checkTimer = 250;
                this._applyDroneDebuff(entities, player);
            }
            return;
        }
        // 无人机未激活：检查是否释放
        if (drone.cooldown <= 0 && dist <= 1500 && cmd.active) {
            // 释放无人机
            this._deployDrone(cmd, player);
        }
    }

    _deployDrone(cmd, player) {
        const drone = this._drone;
        drone.active = true;
        drone.duration = drone.maxDuration;
        drone.cooldown = drone.cooldownMs;
        drone.checkTimer = 0;
        // 从指挥官正前方50px释放
        const angle = Math.atan2(player.y - cmd.y, player.x - cmd.x);
        drone.x = cmd.x + Math.cos(angle) * 50;
        drone.y = cmd.y + Math.sin(angle) * 50;
        drone.vx = 0;
        drone.vy = 0;
        // 初始化受影响集合
        if (!drone._affectedEntities) drone._affectedEntities = new Set();
        else drone._affectedEntities.clear();
        // 释放提示
        if (typeof EffectManager !== 'undefined' && EffectManager.add) {
            EffectManager.add(new FloatingTextEffect(drone.x, drone.y - 20, '🛸 无人机已部署', '#5a7a9a'));
        }
    }

    _deactivateDrone() {
        const drone = this._drone;
        drone.active = false;
        // 清除所有受影响实体的 debuff
        if (drone._affectedEntities) {
            drone._affectedEntities.forEach(entity => {
                if (entity && entity.removeDroneVulnerability) {
                    entity.removeDroneVulnerability();
                }
            });
            drone._affectedEntities.clear();
        }
        if (typeof EffectManager !== 'undefined' && EffectManager.add) {
            EffectManager.add(new FloatingTextEffect(drone.x, drone.y - 20, '🛸 无人机已回收', '#5a7a9a'));
        }
    }

    _applyDroneDebuff(entities, player) {
        const drone = this._drone;
        if (!drone._affectedEntities) drone._affectedEntities = new Set();
        const inRangeEntities = new Set();
        // 收集范围内实体（排除友军：_faction === 'enemy'）
        entities.forEach(entity => {
            if (!entity.active || !entity.hittable) return;
            if (entity._faction === 'enemy') return; // [FIX] 敌我识别：排除友军
            const dist = Math.sqrt((entity.x - drone.x) ** 2 + (entity.y - drone.y) ** 2);
            if (dist <= drone.radius) {
                inRangeEntities.add(entity);
            }
        });
        // 玩家检查（排除友军身份的玩家）
        if (player && player.active && player._faction !== 'enemy') {
            const playerDist = Math.sqrt((player.x - drone.x) ** 2 + (player.y - drone.y) ** 2);
            if (playerDist <= drone.radius) {
                inRangeEntities.add(player);
            }
        }
        // 新进入范围：施加debuff（[FIX] 不再刷新5秒计时器，只判定范围）
        inRangeEntities.forEach(entity => {
            if (!drone._affectedEntities.has(entity)) {
                if (entity.applyDroneVulnerability) {
                    entity.applyDroneVulnerability(1);
                }
                drone._affectedEntities.add(entity);
            }
        });
        // 离开范围：移除debuff
        drone._affectedEntities.forEach(entity => {
            if (!inRangeEntities.has(entity)) {
                if (entity && entity.removeDroneVulnerability) {
                    entity.removeDroneVulnerability();
                }
            }
        });
        // 清理集合
        drone._affectedEntities.forEach(entity => {
            if (!inRangeEntities.has(entity)) {
                drone._affectedEntities.delete(entity);
            }
        });
    }

    _updateMachineGunner(dt, player, entities) {
        const mg = this.members.find(m => m._tacticalRole === 'machineGunner');
        if (!mg || !mg.active) return;
        // [ENHANCE] 机枪手跟随指挥官，形成火力组
        const cmd = this.members.find(m => m._tacticalRole === 'commander');
        if (cmd && cmd.active) {
            // 机枪手在指挥官侧翼 100px 处（垂直于玩家-指挥官方向）
            const toPlayerAngle = Math.atan2(player.y - cmd.y, player.x - cmd.x);
            const perpAngle = toPlayerAngle + Math.PI / 2;
            mg._specialTacticalTarget = {
                x: cmd.x + Math.cos(perpAngle) * 100,
                y: cmd.y + Math.sin(perpAngle) * 100
            };
        } else {
            // 无指挥官时独立行动：玩家后方 700px
            const angle = Math.atan2(player.y - mg.y, player.x - mg.x);
            const targetDist = 700;
            mg._specialTacticalTarget = { x: player.x - Math.cos(angle) * targetDist, y: player.y - Math.sin(angle) * targetDist };
        }
    }

    _updateRiflemen(dt, player, entities) {
        const rifleman = this.members.find(m => m._tacticalRole === 'rifleman');
        if (rifleman && rifleman.active) {
            const dist = Math.sqrt((player.x - rifleman.x) ** 2 + (player.y - rifleman.y) ** 2);
            const angle = Math.atan2(player.y - rifleman.y, player.x - rifleman.x);
            const targetDist = 500;
            rifleman._evadeTimer -= dt;
            if (rifleman._evadeTimer <= 0) {
                rifleman._evadeTimer = 1000 + Math.random() * 1000;
                rifleman._evadeDirection = Math.random() > 0.5 ? 1 : -1;
            }
            const sideDir = rifleman._evadeDirection || 1;
            const flankAngle = angle + Math.PI / 3 * sideDir;
            let baseX = player.x + Math.cos(flankAngle) * targetDist;
            let baseY = player.y + Math.sin(flankAngle) * targetDist;
            if (dist < 300) {
                baseX = player.x - Math.cos(angle) * (targetDist + 100);
                baseY = player.y - Math.sin(angle) * (targetDist + 100);
            }
            // 使用 _specialTacticalTarget 避免覆盖 FormationSystem 的阵型目标
            rifleman._specialTacticalTarget = { x: baseX, y: baseY };
        }
        const flanker = this.members.find(m => m._tacticalRole === 'flankRifleman');
        if (flanker && flanker.active) {
            const dist = Math.sqrt((player.x - flanker.x) ** 2 + (player.y - flanker.y) ** 2);
            const angle = Math.atan2(player.y - flanker.y, player.x - flanker.x);
            const targetDist = 500;
            const sideDir = flanker._flankSide || 1;
            if (!flanker._flankSide) flanker._flankSide = sideDir;
            const flankAngle = angle + Math.PI / 2 * sideDir;
            let baseX = player.x + Math.cos(flankAngle) * targetDist;
            let baseY = player.y + Math.sin(flankAngle) * targetDist;
            if (dist < 300) {
                baseX = player.x - Math.cos(angle) * (targetDist + 100);
                baseY = player.y - Math.sin(angle) * (targetDist + 100);
            }
            // 使用 _specialTacticalTarget 避免覆盖 FormationSystem 的阵型目标
            flanker._specialTacticalTarget = { x: baseX, y: baseY };
        }
    }

    _updateShieldBearers(dt, player, entities) {
        const shieldBearers = this.members.filter(m => m._tacticalRole === 'shieldBearer');
        if (shieldBearers.length === 0) return;
        for (let i = 0; i < shieldBearers.length; i++) {
            const sb = shieldBearers[i];
            if (!sb.active) continue;
            // [FIX] 初始化原始速度（只一次），确保所有速度计算有基准
            if (!sb._originalMaxSpeed) sb._originalMaxSpeed = sb.maxSpeed;
            const dist = Math.sqrt((player.x - sb.x) ** 2 + (player.y - sb.y) ** 2);
            const angle = Math.atan2(player.y - sb.y, player.x - sb.x);
            // [ENHANCE] 盾位更贴身：120px（更激进，进攻性更强）
            const targetDist = 120;
            sb._specialTacticalTarget = { x: player.x - Math.cos(angle) * targetDist, y: player.y - Math.sin(angle) * targetDist };
            if (dist < 200) {
                // [ENHANCE] 防御状态减速从50%降到30%，保持机动性
                sb._shieldDefenseActive = true;
                sb.maxSpeed = sb._originalMaxSpeed * 0.7;
            } else {
                sb._shieldDefenseActive = false;
                sb.maxSpeed = sb._originalMaxSpeed;
            }
            // [ENHANCE] 冲锋机制：远距离时额外加速20%（基于原始速度，避免无限加速）
            if (dist > 400) {
                sb.maxSpeed = sb._originalMaxSpeed * 1.2;
            }
        }
    }

    // 渲染指挥官无人机（实体）
    renderDrone(ctx) {
        const drone = this._drone;
        if (!drone.active) {
            // 无人机未激活，显示冷却状态（如果指挥官存在）
            const cmd = this.members.find(m => m._tacticalRole === 'commander');
            if (cmd && cmd.active && drone.cooldown > 0) {
                const screenPos = Renderer.worldToScreen(cmd.x, cmd.y);
                const cdSec = Math.ceil(drone.cooldown / 1000);
                ctx.fillStyle = 'rgba(150, 150, 150, 0.5)';
                ctx.font = '12px SimHei, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`🛸 ${cdSec}s`, screenPos.x, screenPos.y - 25);
            }
            return;
        }
        // 绘制无人机实体
        const screenPos = Renderer.worldToScreen(drone.x, drone.y);
        if (drone._image && drone._image.complete && drone._image.naturalWidth > 0) {
            const size = 32;
            ctx.drawImage(drone._image, screenPos.x - size / 2, screenPos.y - size / 2, size, size);
        } else {
            ctx.fillStyle = '#5a7a9a';
            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, 12, 0, Math.PI * 2);
            ctx.fill();
        }
        // 绘制范围圈（300px半径）
        const radiusScreen = drone.radius * Renderer.zoom;
        ctx.strokeStyle = 'rgba(90, 122, 154, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, radiusScreen, 0, Math.PI * 2);
        ctx.stroke();
        // 显示剩余时间
        const remainingSec = Math.ceil(drone.duration / 1000);
        ctx.fillStyle = '#d4c5a9';
        ctx.font = '10px SimHei, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${remainingSec}s`, screenPos.x, screenPos.y - 18);
        // 绘制连线到指挥官（如果指挥官存在）
        const cmd = this.members.find(m => m._tacticalRole === 'commander');
        if (cmd && cmd.active) {
            const cmdScreen = Renderer.worldToScreen(cmd.x, cmd.y);
            ctx.strokeStyle = 'rgba(90, 122, 154, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(screenPos.x, screenPos.y);
            ctx.lineTo(cmdScreen.x, cmdScreen.y);
            ctx.stroke();
        }
    }

    _isPlayerUsingRanged(player) {
        if (!player.equipments) return false;
        for (const slot of ['weapon', 'offhand', 'weapon2', 'ring2']) {
            const equip = player.equipments[slot];
            if (!equip) continue;
            const wt = equip.weaponType, rt = equip.rangedType;
            if (wt === 'pkm' || wt === 'akm' || wt === 'qbz191' || wt === 'qjb201' ||
                wt === 'pistol' || wt === 'bow' || wt === 'energy_lmg' || wt === 'deagle' || wt === 'p4040' ||
                rt === 'pistol' || rt === 'machine_gun' || rt === 'rifle' || rt === 'shotgun') return true;
        }
        return false;
    }
}
