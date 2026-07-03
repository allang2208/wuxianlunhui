/**
 * 指挥AI（BattleCommander）- 第一层：整体战术决策
 * 不控制单个怪物的具体动作，只决定整体战术和分配目标位置
 */

export class BattleCommander {
    constructor() {
        this.tactics = {
            swarm: { name: '蜂群战术', minEnemies: 5, target: 'player' },
            pincer: { name: '钳形攻势', minEnemies: 3, target: 'player', flankAngle: 60 },
            press: { name: '压制追击', playerHpThreshold: 0.3, cutoffRetreat: true },
            harass: { name: '骚扰战术', default: true }
        };
        this.decisionInterval = 1000; // 1秒决策一次
        this._timer = 0;
        this.currentTactic = 'harass';
        this._assignments = new Map(); // enemyId -> { targetX, targetY, tactic }
    }

    update(dt, player, enemies) {
        this._timer += dt;
        if (this._timer < this.decisionInterval) return;
        this._timer -= this.decisionInterval;

        const count = enemies.length;
        const playerHp = player.hp / player.maxHp;

        // 选择战术：根据怪物数量和玩家血量动态切换
        let newTactic = 'harass';
        if (count >= 5) newTactic = 'swarm';
        else if (count >= 3) newTactic = 'pincer';
        else if (playerHp < 0.3) newTactic = 'press';

        if (newTactic !== this.currentTactic) {
            console.log(`[BattleCommander] 切换战术: ${this.tactics[newTactic].name}`);
            this.currentTactic = newTactic;
        }

        // 分配目标位置
        this._assignTargets(newTactic, player, enemies);
    }

    _assignTargets(tactic, player, enemies) {
        const px = player.x, py = player.y;
        const activeIds = new Set(enemies.map(e => e.id));

        // 清理已不存在的敌人分配
        for (const id of this._assignments.keys()) {
            if (!activeIds.has(id)) {
                this._assignments.delete(id);
            }
        }

        switch (tactic) {
            case 'swarm':
                // 所有怪物直接扑向玩家
                enemies.forEach(e => {
                    this._assignments.set(e.id, { targetX: px, targetY: py, tactic: 'swarm' });
                });
                break;

            case 'pincer':
                // 分两路包抄：左半包左，右半包右
                enemies.forEach((e, i) => {
                    const side = i < enemies.length / 2 ? -1 : 1;
                    const angle = Math.atan2(py - e.y, px - e.x) + side * Math.PI / 3;
                    const dist = 200;
                    this._assignments.set(e.id, {
                        targetX: px + Math.cos(angle) * dist,
                        targetY: py + Math.sin(angle) * dist,
                        tactic: 'pincer'
                    });
                });
                break;

            case 'press':
                // 切断玩家退路方向（朝玩家反方向包围）
                enemies.forEach(e => {
                    const angle = Math.atan2(e.y - py, e.x - px);
                    this._assignments.set(e.id, {
                        targetX: px - Math.cos(angle) * 100,
                        targetY: py - Math.sin(angle) * 100,
                        tactic: 'press'
                    });
                });
                break;

            case 'harass':
            default:
                // 默认：直接朝玩家
                enemies.forEach(e => {
                    this._assignments.set(e.id, { targetX: px, targetY: py, tactic: 'harass' });
                });
                break;
        }
    }

    // 获取怪物的目标位置
    getTarget(enemyId) {
        return this._assignments.get(enemyId);
    }

    // 获取当前战术名称
    getCurrentTacticName() {
        return this.tactics[this.currentTactic]?.name || '未知';
    }

    // 获取当前战术信息（供AI开发工具显示）
    getTacticInfo() {
        return {
            id: this.currentTactic,
            name: this.tactics[this.currentTactic].name,
            enemyCount: this._assignments.size
        };
    }

    // 获取所有分配（供AI开发工具显示）
    getAssignments() {
        return Array.from(this._assignments.entries());
    }

    // 渲染战术标记（可选，开发工具中显示）
    render(ctx) {
        // 在场景中显示当前战术名称
        // 可由开发工具调用
    }
}
