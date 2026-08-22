import structureGroundFits from '../../data/structure-ground-fits.json';
import { registerStructureGroundFitManifest } from '../world/structure-visual-anchor.js';

// 单一注册入口：纯数学/Node 工具仍可直接导入 structure-visual-anchor.js，
// 浏览器运行时则在场景或建筑系统加载时注入离线派生结果。
export const STRUCTURE_GROUND_FIT_ENTRY_COUNT =
    registerStructureGroundFitManifest(structureGroundFits);

