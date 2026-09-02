import { HamsterWingedHussar } from './hamster-winged-hussar.js';
import configData from '../../data/hamster-industrial-heavy-lancer-config.json';


/** 近代骑兵学院三级重骑：传统长矛普攻与冲锋，无爆炸、火箭或范围伤害。 */
export class HamsterIndustrialHeavyLancer extends HamsterWingedHussar {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterIndustrialHeavyLancer = true;
        this.animId = configData.id;
        this.name = configData.name;
        this.configureCollisionFromArchive(archive);
    }

    getAnimationVisualScale() {
        return 1;
    }

    getAnimationFootY(textureKey) {
        const prefix = `companion_${this.animId}_`;
        const action = String(textureKey || '').startsWith(prefix)
            ? String(textureKey).slice(prefix.length) : '';
        const footY = Number(this.animations?.[action]?.footY);
        return Number.isFinite(footY) ? footY : undefined;
    }
}
