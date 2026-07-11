import { Game } from '../game.js';
import { getElement } from '../utils/dom-utils.js';
// Skill Level System - Extracted from SkillManager
// Handles generic experience gain and level-up logic for skills

export const SkillLevelSystem = {
    // Add experience to a skill and check for level-ups
    addExp(skill, amount, player) {
        if (!skill || skill.level >= skill.maxLevel || amount <= 0) return false;
        skill.exp += amount;
        let leveledUp = false;
        while (skill.exp >= skill.maxExp && skill.level < skill.maxLevel) {
            skill.exp -= skill.maxExp;
            skill.level++;
            skill.maxExp = skill.getExpForNext(skill.level);
            if (typeof SkillManager !== 'undefined' && SkillManager.onLevelUp) {
                SkillManager.onLevelUp(player, skill);
            }
            leveledUp = true;
        }
        if (skill.level >= skill.maxLevel) skill.exp = 0;
        return leveledUp;
    },

    // Refresh skill UI if panels are open
    refreshUI(currentSkillId, extraSkillId) {
        const detail = getElement('skillDetail');
        const detailOpen = detail && detail.style.display !== 'none' && detail.style.display !== '';
        if (detailOpen || (typeof SystemUI !== 'undefined' && SystemUI.isOpen && SystemUI.currentTab === 'skill')) {
            if (typeof SkillManager !== 'undefined') {
                SkillManager.renderSkillGrid();
                if (SkillManager._currentDetailSkillId === currentSkillId ||
                    (extraSkillId && SkillManager._currentDetailSkillId === extraSkillId)) {
                    const skill = this._getSkillById(currentSkillId);
                    if (skill) SkillManager.renderSkillDetail(skill);
                }
            }
        }
    },

    _getSkillById(id) {
        if (typeof Game !== 'undefined' && Game.player && Game.player.skills) {
            return Game.player.skills[id] || null;
        }
        return null;
    }
};
