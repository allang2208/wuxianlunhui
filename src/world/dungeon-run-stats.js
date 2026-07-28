/**
 * 地牢单局统计（通关结算面板数据源；无依赖纯状态模块）
 * DungeonMapSystem.init 重置；击杀结算（damageable-entity）记录；_showVictory 读取快照。
 */
export const DungeonRunStats = {
    kills: { normal: 0, elite: 0, lord: 0, boss: 0 },
    exp: 0,
    combatStreak: 0,   // 连战计数（连续清空战斗节点；事件节点清零，empty 不计不断）
    roomExp: 0,        // 当前战斗房内累计的击杀经验（清房结算连战加成后归零）

    reset() {
        this.kills = { normal: 0, elite: 0, lord: 0, boss: 0 };
        this.exp = 0;
        this.combatStreak = 0;
        this.roomExp = 0;
    },

    /** 记录一次击杀（rank 非法时归入 normal） */
    recordKill(rank) {
        const r = (rank && this.kills[rank] !== undefined) ? rank : 'normal';
        this.kills[r]++;
    },

    /** 记录实际获得的经验（衰减/加成后的实收值；同时计入当前战斗房） */
    recordExp(amount) {
        if (amount > 0) {
            this.exp += amount;
            this.roomExp += amount;
        }
    },

    /** 记录非击杀来源的经验（清剿奖/连战加成，只计总局不计房间） */
    recordBonusExp(amount) {
        if (amount > 0) this.exp += amount;
    },

    /** 取出当前战斗房累计击杀经验并清零（清房结算用） */
    settleRoomExp() {
        const v = this.roomExp;
        this.roomExp = 0;
        return v;
    },

    totalKills() {
        return this.kills.normal + this.kills.elite + this.kills.lord + this.kills.boss;
    },
};
