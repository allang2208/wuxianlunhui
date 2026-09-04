import { HamsterMiner } from './hamster-miner.js';
import expertConfig from '../../data/hamster-mining-expert-config.json';

/** 工会拥有的自动经济单位；复用矿工采矿/返营/死亡清理，不注册军事招募与 RTS。 */
export class HamsterMiningExpert extends HamsterMiner {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...expertConfig,
            ...overrides,
            ai: { ...expertConfig.ai, ...overrides.ai },
            animations: { ...expertConfig.animations, ...overrides.animations },
        });
        this.animId = expertConfig.id;
        this._isHamsterMiningExpert = true;
        // 父类合并默认矿工动画；专家必须只用已确认的自身动作，不能借用普通矿工死亡图。
        this.animations = { ...expertConfig.animations, ...overrides.animations };
        this._rtsSelectable = false;
        this._rtsCanAttack = false;
    }
}
