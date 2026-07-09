import { computeWeaponAttack } from '../../config/attack-formula.js';

const baseMixin = {
calculateCombatStats() {
                const d = this.data;
                // 应用武器精通的属性加成
                let bonusStr = 0, bonusDex = 0, bonusWis = 0, bonusCon = 0;
                if (this.skills) {
                    if (this.skills.machineGunMastery) {
                        bonusStr += this.skills.machineGunMastery.getEffect(this.skills.machineGunMastery.level).strBonus;
                    }
                    if (this.skills.rifleMastery) {
                        bonusWis += this.skills.rifleMastery.getEffect(this.skills.rifleMastery.level).wisBonus;
                    }
                    if (this.skills.pistolMastery) {
                        bonusDex += this.skills.pistolMastery.getEffect(this.skills.pistolMastery.level).dexBonus;
                    }
                    if (this.skills.bowMastery) {
                        bonusDex += this.skills.bowMastery.getEffect(this.skills.bowMastery.level).dexBonus;
                    }
                    if (this.skills.shotgunMastery) {
                        bonusCon += this.skills.shotgunMastery.getEffect(this.skills.shotgunMastery.level).conBonus;
                    }
                }
                d.atk = Math.round(10 + (d.str + bonusStr) * 0.05 + (d.dex + bonusDex) * 0.1); d.def = Math.floor((d.con + bonusCon) * 1.2 + (d.str + bonusStr) * 0.3);
                // 应用改造效果：防御力变化
                if (this.equipments && this.weaponMode) {
                    const currentWpn = this.equipments[this.weaponMode];
                    if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.defensePercent) {
                        d.def = Math.floor(d.def * (1 + currentWpn._craftEffects.defensePercent));
                    }
                }
                // 应用持盾防御技能的防御力加成
                if (this.equipments && this.skills && this.skills.shieldDefense) {
                    const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                    const shield = this.equipments[offhandSlot];
                    if (shield && shield.weaponType === 'shield') {
                        const sdEffect = this.skills.shieldDefense.getEffect(this.skills.shieldDefense.level);
                        d.def = Math.floor(d.def * (1 + sdEffect.defBonusPercent));
                    }
                }
                // 祭品效果：大理石 - 防御力增加25%
                if (typeof DungeonMapSystem !== 'undefined' && DungeonMapSystem._carriedItems) {
                    const tributes = DungeonMapSystem._carriedItems;
                    const hasMarble = tributes.some(c => c && c.item && c.item.name === '大理石');
                    if (hasMarble) {
                        d.def = Math.floor(d.def * 1.25);
                    }
                    // 祭品效果：石头 - 防御力增加5%
                    const hasStone = tributes.some(c => c && c.item && c.item.name === '石头');
                    if (hasStone) {
                        d.def = Math.floor(d.def * 1.05);
                    }
                }
                d.matk = Math.floor(d.int * 1.5 + (d.wis + bonusWis) * 0.5); d.mdef = Math.floor((d.wis + bonusWis) * 1.2 + d.int * 0.3);
                d.hit = 80 + Math.floor((d.dex + bonusDex) * 0.5); d.dodge = 5 + Math.floor((d.dex + bonusDex) * 0.3);
                d.crit = 2 + Math.floor(d.luck * 1.0); d.aspd = 1.0 + (d.dex + bonusDex) * 0.02;
                d.speed = CONFIG.PLAYER_SPEED + (d.dex + bonusDex) * 0.05;
                // 祭品效果：石头 - 移动速度减少10%
                if (typeof DungeonMapSystem !== 'undefined' && DungeonMapSystem._carriedItems) {
                    const tributes = DungeonMapSystem._carriedItems;
                    const hasStone = tributes.some(c => c && c.item && c.item.name === '石头');
                    if (hasStone) {
                        d.speed = Math.floor(d.speed * 0.9);
                    }
                }
                d.critRes = Math.floor(d.con * 1.0); // 暴击抵抗：每1点体质增加1%
                if (typeof DungeonMapSystem !== 'undefined' && DungeonMapSystem._carriedItems) {
                    const tributes = DungeonMapSystem._carriedItems;
                    const hasMarble = tributes.some(c => c && c.item && c.item.name === '大理石');
                    if (hasMarble) {
                        d.def = Math.floor(d.def * 1.25);
                    }
                }
                d.matk = Math.floor(d.int * 1.5 + (d.wis + bonusWis) * 0.5); d.mdef = Math.floor((d.wis + bonusWis) * 1.2 + d.int * 0.3);
                d.hit = 80 + Math.floor((d.dex + bonusDex) * 0.5); d.dodge = 5 + Math.floor((d.dex + bonusDex) * 0.3);
                d.crit = 2 + Math.floor(d.luck * 1.0); d.aspd = 1.0 + (d.dex + bonusDex) * 0.02;
                d.speed = CONFIG.PLAYER_SPEED + (d.dex + bonusDex) * 0.05;
                d.critRes = Math.floor(d.con * 1.0); // 暴击抵抗：每1点体质增加1%
                // 保存加成供其他系统使用
                this._masteryBonus = { str: bonusStr, dex: bonusDex, wis: bonusWis };
            },

getCurrentWeaponAtk(itemOverride) {
                const currentWpn = itemOverride || this.equipments[this.weaponMode];
                if (!currentWpn) return 0;
                return computeWeaponAttack(currentWpn, this.data, this.skills);
            },

_getEnergyLMGParams() {
                const currentWpn = this.equipments[this.weaponMode];
                const params = currentWpn && currentWpn.energyLMGParams;
                const defaults = this._energyLMGDefaults || { baseCooldown: 333, maxCooldown: 50, rampUpTime: 2500, overheatTime: 4000, overheatRecoverTime: 2500, overheatCooldownTime: 4000, spreadMaxTime: 2500, maxSpreadAngle: 15 };
                if (!params) return defaults;
                return {
                    baseCooldown: params.baseCooldown ?? defaults.baseCooldown,
                    maxCooldown: params.maxCooldown ?? defaults.maxCooldown,
                    rampUpTime: params.rampUpTime ?? defaults.rampUpTime,
                    overheatTime: params.overheatTime ?? defaults.overheatTime,
                    overheatRecoverTime: params.overheatRecoverTime ?? defaults.overheatRecoverTime,
                    overheatCooldownTime: params.overheatCooldownTime ?? defaults.overheatCooldownTime,
                    spreadMaxTime: params.spreadMaxTime ?? defaults.spreadMaxTime,
                    maxSpreadAngle: params.maxSpreadAngle ?? defaults.maxSpreadAngle
                };
            },

getExpForLevel(level) { return (20 + level * 20 + level * 12) * 2; },

updateMaxStats() {
                const d = this.data;
                const oldMaxHp = d.maxHp;
                const oldMaxMp = d.maxMp;
                d.maxHp = 100 + d.con * 10;
                d.maxMp = 100 + d.wis * 10 + d.int * 5;
                // HP/MP 按比例缩放，避免满血时增加属性反而掉血
                if (oldMaxHp > 0) d.hp = Math.min(d.maxHp, d.hp + (d.maxHp - oldMaxHp));
                else d.hp = d.maxHp;
                if (oldMaxMp > 0) d.mp = Math.min(d.maxMp, d.mp + (d.maxMp - oldMaxMp));
                else d.mp = d.maxMp;
                // 体力恢复速度：每点敏捷 +1%
                const staminaRegenMul = 1.0 + d.dex * 0.01;
                // 保存倍率供 update 使用
                this._staminaRegenMul = staminaRegenMul;
            }
};

export { baseMixin };
