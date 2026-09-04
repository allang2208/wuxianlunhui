import { HamsterCatapultCrewAI } from './hamster-catapult-crew-ai.js';
import { fireGroundShockwave, fireRadialBurst, resolveSkillEffectDepth } from '../effects/combat-fx.js';

/** 榴弹使用既有抛射/墙体/范围伤害链；炮口、射程和时序均来自本级配置。 */
export class HamsterHowitzerCrewAI extends HamsterCatapultCrewAI {
    _fireProjectile() {
        super._fireProjectile();
        const shell = this.m._basic;
        if (shell?.active) this._orientShell(shell);
    }

    _orientShell(shell) {
        const t = Math.min(1, shell.elapsedMs / shell.durationMs);
        // 旋转跟随屏幕投影后的弹道切线；炮弹不使用投石弹的滚转。
        const dx = shell.tx - shell.origin.x;
        const dy = shell.ty - shell.origin.y;
        const dz = shell.targetZ - shell.origin.z + 4 * shell.arcHeight * (1 - 2 * t);
        shell.visualAngle = Math.atan2(dy - dz, dx);
    }

    _updateProjectile(dt, entities) {
        super._updateProjectile(dt, entities);
        if (this.m._basic?.active) this._orientShell(this.m._basic);
    }

    _impact(shell, entities) {
        super._impact(shell, entities);
        const x = shell.x;
        const y = shell.y - shell.z;
        const radius = this.cfg.splashRadius;
        const depth = resolveSkillEffectDepth({ source: this.m, groundY: shell.y,
            groundOffset: 12, preferSourceDepth: false });
        // 落点视觉只在命中时创建，不给死亡动画添加烟火，也不重复结算伤害。
        fireGroundShockwave({ x, y, maxRadius: radius, strokeColor: 0xdcb26a,
            fillColor: 0xb77936, lineWidth: 4, duration: 330, depth });
        fireRadialBurst({ x, y, count: 12, color: 0xe2b56c, lenMin: 12,
            lenMax: radius * 0.55, widthMin: 1, widthMax: 3, duration: 280,
            perspective: true, depth: depth + 0.1 });
    }
}
