import { Renderer } from '../world/renderer.js';

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
        // 确保 _droneReady 有默认值
        if (cmd._droneReady === undefined) cmd._droneReady = true;
        const dist = Math.sqrt((player.x - cmd.x) ** 2 + (player.y - cmd.y) ** 2);
        const angle = Math.atan2(player.y - cmd.y, player.x - cmd.x);
        let desiredDist = 700;
        if (dist < 650) desiredDist = 750;
        else if (dist > 750) desiredDist = 650;
        cmd._tacticalTarget = { x: player.x - Math.cos(angle) * desiredDist, y: player.y - Math.sin(angle) * desiredDist };
        // ===== 指挥官无人机技能 =====
        if (cmd._droneReady) {
            const droneRadius = 800; // 覆盖指挥官战斗距离（650-750px），确保始终生效
            if (dist <= droneRadius) {
                if (!cmd._droneActive) {
                    cmd._droneActive = true;
                    if (player.applyDroneVulnerability) {
                        player.applyDroneVulnerability(1);
                    }
                }
            } else {
                if (cmd._droneActive) {
                    cmd._droneActive = false;
                    if (player.removeDroneVulnerability) {
                        player.removeDroneVulnerability();
                    }
                }
            }
        }
    }

    _updateMachineGunner(dt, player, entities) {
        const mg = this.members.find(m => m._tacticalRole === 'machineGunner');
        if (!mg || !mg.active) return;
        // 机枪手不再设置 _tacticalTarget，由 FormationSystem 控制其阵型位置
        // 保留此方法用于未来扩展（如特殊武器技能）
    }

    _updateRiflemen(dt, player, entities) {
        const rifleman = this.members.find(m => m._tacticalRole === 'rifleman');
        if (rifleman && rifleman.active) {
            const dist = Math.sqrt((player.x - rifleman.x) ** 2 + (player.y - rifleman.y) ** 2);
            const angle = Math.atan2(player.y - rifleman.y, player.x - rifleman.x);
            const targetDist = 700;
            let baseX = player.x - Math.cos(angle) * targetDist;
            let baseY = player.y - Math.sin(angle) * targetDist;
            rifleman._evadeTimer -= dt;
            if (rifleman._evadeTimer <= 0) {
                rifleman._evadeTimer = 1000 + Math.random() * 1000;
                rifleman._evadeDirection = Math.random() > 0.5 ? 1 : -1;
                rifleman._evadeOffset = 10 + Math.random() * 20;
            }
            const perpAngle = angle + Math.PI / 2;
            baseX += Math.cos(perpAngle) * (rifleman._evadeOffset || 15) * rifleman._evadeDirection;
            baseY += Math.sin(perpAngle) * (rifleman._evadeOffset || 15) * rifleman._evadeDirection;
            if (dist < 400) {
                baseX = player.x - Math.cos(angle) * (targetDist + 100);
                baseY = player.y - Math.sin(angle) * (targetDist + 100);
            }
            // 使用 _specialTacticalTarget 避免覆盖 FormationSystem 的阵型目标
            rifleman._specialTacticalTarget = { x: baseX, y: baseY };
        }
        const flanker = this.members.find(m => m._tacticalRole === 'flankRifleman');
        if (flanker && flanker.active) {
            const angle = Math.atan2(player.y - flanker.y, player.x - flanker.x);
            const targetDist = 700;
            flanker._flankAngle = (flanker._flankAngle || 0) + 0.3 * (dt / 1000);
            const flankAngle = angle + Math.sin(flanker._flankAngle) * (Math.PI / 2);
            // 使用 _specialTacticalTarget 避免覆盖 FormationSystem 的阵型目标
            flanker._specialTacticalTarget = { x: player.x + Math.cos(flankAngle) * targetDist, y: player.y + Math.sin(flankAngle) * targetDist };
        }
    }

    _updateShieldBearers(dt, player, entities) {
        const shieldBearers = this.members.filter(m => m._tacticalRole === 'shieldBearer');
        if (shieldBearers.length === 0) return;
        const isPlayerRanged = this._isPlayerUsingRanged(player);
        const protectRoles = ['commander', 'machineGunner', 'rifleman', 'flankRifleman'];
        const teammates = protectRoles.map(role => this.members.find(m => m._tacticalRole === role && m.active)).filter(Boolean);
        for (let i = 0; i < shieldBearers.length; i++) {
            const sb = shieldBearers[i];
            if (!sb.active) continue;
            const dist = Math.sqrt((player.x - sb.x) ** 2 + (player.y - sb.y) ** 2);
            if (isPlayerRanged && dist < 500) {
                sb._shieldDefenseActive = true;
                if (!sb._originalMaxSpeed) sb._originalMaxSpeed = sb.maxSpeed;
                sb.maxSpeed = sb._originalMaxSpeed * 0.5;
            } else {
                sb._shieldDefenseActive = false;
                if (sb._originalMaxSpeed) sb.maxSpeed = sb._originalMaxSpeed;
            }
            // 盾卫不再设置 _tacticalTarget，由 FormationSystem 控制其阵型位置
            // 保留防御速度逻辑（举盾减速）
        }
    }

    // 渲染指挥官无人机范围圈（无论 _droneReady 状态，只要指挥官存在就画）
    renderDrone(ctx) {
        const cmd = this.members.find(m => m._tacticalRole === 'commander');
        if (!cmd || !cmd.active) return;
        // 调试：如果 _droneReady 未设置，设置默认值
        if (cmd._droneReady === undefined) cmd._droneReady = true;
        const screenPos = Renderer.worldToScreen(cmd.x, cmd.y);
        const radiusScreen = 800; // 与 _updateCommander 中的 droneRadius 保持一致
        // 范围圈（根据 _droneReady 状态改变颜色：就绪=红色，未就绪=灰色）
        if (cmd._droneReady) {
            ctx.strokeStyle = 'rgba(255, 60, 60, 0.5)';
            ctx.fillStyle = 'rgba(255, 60, 60, 0.1)';
        } else {
            ctx.strokeStyle = 'rgba(150, 150, 150, 0.3)';
            ctx.fillStyle = 'rgba(150, 150, 150, 0.05)';
        }
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, radiusScreen, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fill();
        // 中心无人机标记
        ctx.fillStyle = cmd._droneReady ? 'rgba(255, 60, 60, 0.7)' : 'rgba(150, 150, 150, 0.3)';
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, 8, 0, Math.PI * 2);
        ctx.fill();
        // 指挥官位置标记（小圆点）
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, 3, 0, Math.PI * 2);
        ctx.fill();
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
