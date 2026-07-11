/**
import { FloatingTextEffect } from '../effects/floating-text.js';
 * TacticalSquadRoleSwitch — 战术小队角色动态切换系统
 *
 * 职责：监控战术小队成员的生存状态，当关键角色缺失时，
 * 自动从存活成员中重新分配角色，保持小队战术完整性。
 *
 * 角色优先级（从高到低）：
 *   commander > shieldBearer > machineGunner > flankRifleman > rifleman
 *
 * 设计原则：
 * - 所有状态通过 enemy 实例属性共享
 * - 统一接口：update(dt, entities)
 * - 时间单位：毫秒
 * - 对全局对象使用 typeof 检查
 * - 玩家检测用 entity._faction === 'player'
 */

class TacticalSquadRoleSwitchImpl {
    constructor() {
        // 角色切换冷却（ms），防止频繁切换
        this._switchCooldown = 5000;
        // 上次切换时间戳
        this._lastSwitchTime = 0;
        // 角色优先级（数值越高越优先保留/继承）
        this._rolePriority = {
            commander: 5,
            shieldBearer: 4,
            machineGunner: 3,
            flankRifleman: 2,
            rifleman: 1
        };
        // 各角色预期人数（标准 6 人小队）
        this._expectedCounts = {
            commander: 1,
            machineGunner: 1,
            rifleman: 1,
            flankRifleman: 1,
            shieldBearer: 2
        };
    }

    /**
     * 主更新入口
     * @param {number} dt — 时间间隔（ms）
     * @param {Map|Array} entities — 实体集合
     */
    update(dt, entities) {
        if (!entities) return;

        // 收集所有带有战术角色的存活成员
        const squadMembers = this._collectSquadMembers(entities);
        if (squadMembers.length === 0) return;

        const activeMembers = squadMembers.filter(m => m.active && m.hp > 0);
        if (activeMembers.length === 0) return;

        // 检查是否需要进行角色切换
        const now = Date.now();
        if (now - this._lastSwitchTime < this._switchCooldown) return;

        // 评估当前角色分布
        const roleDistribution = this._getRoleDistribution(activeMembers);

        // 如果小队编制完整，无需切换
        if (this._isSquadIntact(roleDistribution)) return;

        // 执行角色重分配
        const changes = this._reassignRoles(activeMembers, roleDistribution);
        if (changes.length > 0) {
            this._applyRoleChanges(changes);
            this._lastSwitchTime = now;
        }
    }

    // ==================== 成员收集 ====================

    /**
     * 从实体集合中收集所有带有战术角色的敌人
     */
    _collectSquadMembers(entities) {
        const members = [];
        for (const e of entities.values()) {
            if (e && typeof e._tacticalRole === 'string' && e._tacticalRole.length > 0) {
                members.push(e);
            }
        }
        return members;
    }

    // ==================== 状态评估 ====================

    /**
     * 获取当前存活成员的角色分布
     */
    _getRoleDistribution(activeMembers) {
        const dist = {};
        for (const role of Object.keys(this._expectedCounts)) {
            dist[role] = activeMembers.filter(m => m._tacticalRole === role);
        }
        return dist;
    }

    /**
     * 检查小队编制是否完整
     */
    _isSquadIntact(dist) {
        for (const [role, expected] of Object.entries(this._expectedCounts)) {
            if ((dist[role] || []).length < expected) return false;
        }
        return true;
    }

    // ==================== 角色重分配 ====================

    /**
     * 重新分配角色，返回变更列表
     */
    _reassignRoles(activeMembers, dist) {
        const changes = [];
        const usedMembers = new Set();

        // 标记已保留的成员（各角色保留最健康的成员）
        for (const role of Object.keys(this._expectedCounts)) {
            const members = (dist[role] || []).slice();
            // 按 HP 比例从高到低排序
            members.sort((a, b) => {
                const ratioA = a.maxHp > 0 ? a.hp / a.maxHp : 0;
                const ratioB = b.maxHp > 0 ? b.hp / b.maxHp : 0;
                return ratioB - ratioA;
            });
            const keepCount = Math.min(members.length, this._expectedCounts[role]);
            for (let i = 0; i < keepCount; i++) {
                usedMembers.add(members[i]);
            }
        }

        // 按优先级从高到低填补空缺
        const priorityOrder = Object.entries(this._rolePriority)
            .sort((a, b) => b[1] - a[1])
            .map(([role]) => role);

        for (const role of priorityOrder) {
            const current = (dist[role] || []).filter(m => usedMembers.has(m));
            const needed = this._expectedCounts[role] - current.length;
            if (needed <= 0) continue;

            // 寻找可晋升的候选成员
            const candidates = this._findCandidates(activeMembers, usedMembers);
            for (let i = 0; i < Math.min(needed, candidates.length); i++) {
                const candidate = candidates[i];
                changes.push({
                    member: candidate,
                    newRole: role,
                    oldRole: candidate._tacticalRole
                });
                usedMembers.add(candidate);
            }
        }

        return changes;
    }

    /**
     * 寻找适合晋升的候选成员
     * 优先选择 HP 比例高的成员，排除已被使用的
     */
    _findCandidates(activeMembers, usedMembers) {
        const candidates = activeMembers.filter(m => !usedMembers.has(m));
        // 按 HP 比例从高到低排序
        candidates.sort((a, b) => {
            const ratioA = a.maxHp > 0 ? a.hp / a.maxHp : 0;
            const ratioB = b.maxHp > 0 ? b.hp / b.maxHp : 0;
            return ratioB - ratioA;
        });
        return candidates;
    }

    // ==================== 变更应用 ====================

    /**
     * 应用角色变更
     */
    _applyRoleChanges(changes) {
        for (const change of changes) {
            const { member, newRole, oldRole } = change;

            // 记录旧角色
            member._previousTacticalRole = oldRole;

            // 应用新角色
            member._tacticalRole = newRole;

            // 重置角色特定状态
            this._resetRoleState(member, newRole);

            // 视觉反馈
            if (typeof EffectManager !== 'undefined' && EffectManager.add) {
                const label = this._getRoleLabel(newRole);
                EffectManager.add(new FloatingTextEffect(
                    member.x, member.y - member.size - 10,
                    `\u21c4 ${label}`, '#ffcc00'
                ));
            }
        }
    }

    /**
     * 重置角色特定状态
     */
    _resetRoleState(member, newRole) {
        // 清除旧的战术目标
        member._tacticalTarget = null;

        // 根据新角色初始化状态
        switch (newRole) {
            case 'commander':
                // 指挥官：无人机准备就绪
                member._droneReady = true;
                member._desiredDistance = 700;
                break;
            case 'machineGunner':
                // 机枪手：保持远距离
                member._desiredDistance = 800;
                break;
            case 'shieldBearer':
                // 盾卫：初始化防御状态
                member._shieldDefenseActive = false;
                if (!member._originalMaxSpeed) member._originalMaxSpeed = member.maxSpeed;
                break;
            case 'flankRifleman':
                // 侧翼手：初始化侧翼角度
                member._flankAngle = 0;
                break;
            case 'rifleman':
                // 步枪手：初始化闪避状态
                member._evadeTimer = 1000 + Math.random() * 1000;
                member._evadeDirection = Math.random() > 0.5 ? 1 : -1;
                member._evadeOffset = 10 + Math.random() * 20;
                break;
        }
    }

    /**
     * 获取角色显示名称
     */
    _getRoleLabel(role) {
        const labels = {
            commander: 'Commander',
            machineGunner: 'MG',
            rifleman: 'Rifleman',
            flankRifleman: 'Flanker',
            shieldBearer: 'Shield'
        };
        return labels[role] || role;
    }
}

export const TacticalSquadRoleSwitch = new TacticalSquadRoleSwitchImpl();
