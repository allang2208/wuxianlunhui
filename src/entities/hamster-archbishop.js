import { HamsterBishop } from './hamster-bishop.js';
import { HamsterArchbishopAI } from '../ai/hamster-archbishop-ai.js';
import configData from '../../data/hamster-archbishop-config.json';

/** 教堂三级法术支援：强化圣光，并周期性展开圣辉领域。 */
export class HamsterArchbishop extends HamsterBishop {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(x, y, archive);
        this._isHamsterArchbishop = true;
        this.animId = configData.id;
        this.name = configData.name;
        if (this.skills?.sanctuaryDomain) {
            this.skills.sanctuaryDomain.level = Math.max(
                1,
                Math.floor(Number(this.aiConfig?.sanctuaryDomainLevel) || 1)
            );
        }
        this._ai = new HamsterArchbishopAI(this);
        this.configureCollisionFromArchive(archive);
    }

    _startDying() {
        this._ai?.clear?.();
        super._startDying();
    }
}
