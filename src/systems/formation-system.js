// formation-system.js
// 编队系统：管理敌人的编队阵型、移动与变换
// 使用方式：FormationSystem.update(enemy, dt, entities) 或 FormationSystem.update(dt, entities)

const FORMATION_TEMPLATES = {
    wedge: {
        name: 'wedge',
        offsets: [
            { x: 0, y: 0 },
            { x: -40, y: -40 },
            { x: 40, y: -40 },
            { x: -80, y: -80 },
            { x: 80, y: -80 }
        ]
    },
    line: {
        name: 'line',
        offsets: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: -50, y: 0 },
            { x: 100, y: 0 },
            { x: -100, y: 0 }
        ]
    },
    diamond: {
        name: 'diamond',
        offsets: [
            { x: 0, y: 0 },
            { x: 0, y: -50 },
            { x: 50, y: 0 },
            { x: 0, y: 50 },
            { x: -50, y: 0 }
        ]
    },
    square: {
        name: 'square',
        offsets: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 0, y: 40 },
            { x: 40, y: 40 },
            { x: 20, y: 20 }
        ]
    },
    scatter: {
        name: 'scatter',
        offsets: [
            { x: 0, y: 0 },
            { x: -60, y: -30 },
            { x: 60, y: 30 },
            { x: -30, y: 60 },
            { x: 30, y: -60 }
        ]
    }
};

const FORMATION_STATE = {
    FORMING: 'forming',
    FORMED: 'formed',
    MOVING: 'moving',
    CHANGING: 'changing',
    BREAKING: 'breaking',
    BROKEN: 'broken'
};

class FormationSystemClass {
    constructor() {
        this.formations = new Map();
        this._nextId = 1;
    }

    createFormation(leader, type = 'wedge', members = []) {
        const template = FORMATION_TEMPLATES[type];
        if (!template) return null;

        const allMembers = [leader, ...members].filter(m => m && !m._destroyed);
        if (allMembers.length === 0) return null;

        const formation = {
            id: this._nextId++,
            leader: leader,
            type: type,
            members: allMembers,
            state: FORMATION_STATE.FORMING,
            targetPosition: null,
            targetEntity: null,
            formationAngle: 0,
            spacing: 1.0,
            timer: 0,
            memberSlots: new Map()
        };

        this._assignSlots(formation);
        this.formations.set(formation.id, formation);

        for (const member of allMembers) {
            member._formationId = formation.id;
            member._formationRole = member === leader ? 'leader' : 'follower';
        }

        return formation.id;
    }

    _assignSlots(formation) {
        const template = FORMATION_TEMPLATES[formation.type];
        if (!template) return;

        formation.memberSlots.clear();
        for (let i = 0; i < formation.members.length && i < template.offsets.length; i++) {
            const member = formation.members[i];
            if (member) {
                formation.memberSlots.set(member, i);
            }
        }
    }

    disbandFormation(formationId) {
        const formation = this.formations.get(formationId);
        if (!formation) return;

        for (const member of formation.members) {
            if (member) {
                member._formationId = null;
                member._formationRole = null;
                member._tacticalTarget = null;
            }
        }

        this.formations.delete(formationId);
    }

    changeFormation(formationId, newType) {
        const formation = this.formations.get(formationId);
        if (!formation || !FORMATION_TEMPLATES[newType]) return false;

        formation.type = newType;
        formation.state = FORMATION_STATE.CHANGING;
        formation.timer = 0;
        this._assignSlots(formation);
        return true;
    }

    setTargetPosition(formationId, x, y) {
        const formation = this.formations.get(formationId);
        if (!formation) return;

        formation.targetPosition = { x, y };
        formation.targetEntity = null;
        formation.state = FORMATION_STATE.MOVING;
    }

    setTargetEntity(formationId, entity) {
        const formation = this.formations.get(formationId);
        if (!formation) return;

        formation.targetEntity = entity;
        formation.targetPosition = null;
        formation.state = FORMATION_STATE.MOVING;
    }

    // 单实体更新接口：update(enemy, dt, entities)
    update(enemy, dt, entities) {
        if (!enemy || !enemy._formationId) return;
        if (enemy._destroyed) return;

        const formation = this.formations.get(enemy._formationId);
        if (!formation) {
            enemy._formationId = null;
            enemy._formationRole = null;
            enemy._tacticalTarget = null;
            return;
        }

        if (enemy._formationRole === 'leader') {
            this._updateLeader(enemy, formation, dt, entities);
        } else {
            this._updateFollower(enemy, formation, dt, entities);
        }
    }

    // 批量更新接口：update(dt, entities)
    update(dt, entities) {
        for (const [id, formation] of this.formations) {
            formation.members = formation.members.filter(m => m && !m._destroyed);

            if (formation.members.length === 0) {
                this.formations.delete(id);
                continue;
            }

            if (formation.leader && formation.leader._destroyed) {
                this._handleLeaderLost(formation);
            }

            this._updateFormationState(formation, dt, entities);
        }
    }

    _updateFormationState(formation, dt, entities) {
        formation.timer += dt;

        switch (formation.state) {
            case FORMATION_STATE.FORMING:
                if (this._isFormationReady(formation)) {
                    formation.state = FORMATION_STATE.FORMED;
                }
                break;
            case FORMATION_STATE.CHANGING:
                if (formation.timer > 1000) {
                    formation.state = FORMATION_STATE.FORMED;
                }
                break;
            case FORMATION_STATE.BREAKING:
                if (formation.timer > 500) {
                    formation.state = FORMATION_STATE.BROKEN;
                }
                break;
            case FORMATION_STATE.MOVING:
                if (formation.targetEntity && formation.targetEntity._destroyed) {
                    formation.targetEntity = null;
                    formation.state = FORMATION_STATE.FORMED;
                }
                break;
        }
    }

    _isFormationReady(formation) {
        const template = FORMATION_TEMPLATES[formation.type];
        if (!template) return false;

        for (const [member, slotIndex] of formation.memberSlots) {
            if (!member || member._destroyed) continue;

            const offset = template.offsets[slotIndex];
            if (!offset) continue;

            const leader = formation.leader;
            if (!leader || leader._destroyed) return false;

            const targetX = leader.x + offset.x * formation.spacing;
            const targetY = leader.y + offset.y * formation.spacing;
            const dx = targetX - member.x;
            const dy = targetY - member.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 20) return false;
        }

        return true;
    }

    _updateLeader(enemy, formation, dt, entities) {
        if (formation.state === FORMATION_STATE.BROKEN) return;

        if (formation.targetPosition) {
            const dx = formation.targetPosition.x - enemy.x;
            const dy = formation.targetPosition.y - enemy.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 5) {
                const speed = (enemy._speed || 100) * 0.001;
                // [FIX] 移除直接移动，由 MovementSystem 统一处理墙壁碰撞
                // enemy.x += (dx / dist) * speed * dt;
                // enemy.y += (dy / dist) * speed * dt;
                formation.formationAngle = Math.atan2(dy, dx);
            } else {
                formation.state = FORMATION_STATE.FORMED;
            }
        } else if (formation.targetEntity) {
            const target = formation.targetEntity;
            if (target && !target._destroyed) {
                const dx = target.x - enemy.x;
                const dy = target.y - enemy.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > 100) {
                    const speed = (enemy._speed || 100) * 0.001;
                    // [FIX] 移除直接移动，由 MovementSystem 统一处理墙壁碰撞
                    // enemy.x += (dx / dist) * speed * dt;
                    // enemy.y += (dy / dist) * speed * dt;
                    formation.formationAngle = Math.atan2(dy, dx);
                }
            }
        }
    }

    _updateFollower(enemy, formation, dt, entities) {
        if (formation.state === FORMATION_STATE.BROKEN) {
            enemy._tacticalTarget = null;
            return;
        }

        const template = FORMATION_TEMPLATES[formation.type];
        if (!template) return;

        const slotIndex = formation.memberSlots.get(enemy);
        if (slotIndex === undefined) return;

        const offset = template.offsets[slotIndex];
        if (!offset) return;

        const leader = formation.leader;
        if (!leader || leader._destroyed) {
            this._handleLeaderLost(formation);
            return;
        }

        const cos = Math.cos(formation.formationAngle);
        const sin = Math.sin(formation.formationAngle);
        const rotX = offset.x * cos - offset.y * sin;
        const rotY = offset.x * sin + offset.y * cos;

        const targetX = leader.x + rotX * formation.spacing;
        const targetY = leader.y + rotY * formation.spacing;

        enemy._tacticalTarget = { x: targetX, y: targetY };

        const dx = targetX - enemy.x;
        const dy = targetY - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 5) {
            const speed = (enemy._speed || 100) * 0.001;
            // [FIX] 移除直接移动，由 MovementSystem 统一处理墙壁碰撞
            // enemy.x += (dx / dist) * speed * dt;
            // enemy.y += (dy / dist) * speed * dt;
        }
    }

    _handleLeaderLost(formation) {
        formation.state = FORMATION_STATE.BREAKING;
        formation.timer = 0;

        const newLeader = formation.members.find(
            m => m && !m._destroyed && m !== formation.leader
        );

        if (newLeader) {
            formation.leader = newLeader;
            newLeader._formationRole = 'leader';
            formation.state = FORMATION_STATE.FORMING;
            this._assignSlots(formation);
        } else {
            formation.state = FORMATION_STATE.BROKEN;
        }
    }

    addMember(formationId, member) {
        const formation = this.formations.get(formationId);
        if (!formation || !member) return false;
        if (formation.members.includes(member)) return false;

        formation.members.push(member);
        member._formationId = formation.id;
        member._formationRole = 'follower';
        this._assignSlots(formation);
        return true;
    }

    removeMember(formationId, member) {
        const formation = this.formations.get(formationId);
        if (!formation || !member) return false;

        const index = formation.members.indexOf(member);
        if (index === -1) return false;

        formation.members.splice(index, 1);
        member._formationId = null;
        member._formationRole = null;
        member._tacticalTarget = null;

        if (member === formation.leader) {
            this._handleLeaderLost(formation);
        } else {
            this._assignSlots(formation);
        }

        if (formation.members.length === 0) {
            this.formations.delete(formationId);
        }

        return true;
    }

    getFormation(formationId) {
        return this.formations.get(formationId) || null;
    }

    getEntityFormation(entity) {
        if (!entity || !entity._formationId) return null;
        return this.formations.get(entity._formationId) || null;
    }

    scatterFormation(formationId) {
        const formation = this.formations.get(formationId);
        if (!formation) return;

        formation.state = FORMATION_STATE.BREAKING;
        formation.timer = 0;
    }

    rotateFormation(formationId, angle) {
        const formation = this.formations.get(formationId);
        if (!formation) return;
        formation.formationAngle = angle;
    }

    scaleFormation(formationId, spacing) {
        const formation = this.formations.get(formationId);
        if (!formation) return;
        formation.spacing = Math.max(0.5, Math.min(3.0, spacing));
    }

    getAllFormationIds() {
        return Array.from(this.formations.keys());
    }

    getFormationCount() {
        return this.formations.size;
    }
}

const FormationSystem = new FormationSystemClass();

export default FormationSystem;
