const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const cleanup = JSON.parse(fs.readFileSync(path.join(root, 'cleanup-manifest-20260901.json'), 'utf8'));
const removed = new Set(cleanup.files.map((entry) => entry.path.replaceAll('\\', '/')));

function read(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function write(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function clearRemovedLinks(value, baseRelative = '', seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const item = value[index];
      if (typeof item === 'string') {
        const resolved = path.posix.normalize(path.posix.join(baseRelative, item.replaceAll('\\', '/')));
        if (removed.has(resolved)) value.splice(index, 1);
      } else clearRemovedLinks(item, baseRelative, seen);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      const resolved = path.posix.normalize(path.posix.join(baseRelative, item.replaceAll('\\', '/')));
      if (removed.has(resolved)) {
        value[`${key}RemovedDuringCleanup`] = item;
        value[key] = null;
      }
    } else {
      clearRemovedLinks(item, baseRelative, seen);
    }
  }
}

const pleat = read('animations-pleat-v03-20260831/manifest.json');
clearRemovedLinks(pleat, 'animations-pleat-v03-20260831');
pleat.stage = 'runtime_integrated_pending_user_validation';
pleat.verificationBoundary = '正式图集、实体、双份配置、Boot登记和恐怖地牢候选池已接入；只做静态差异与离线素材检查，未运行测试、构建、浏览器或游戏验证。';
pleat.previewReport = null;
pleat.previewReportRemovedDuringCleanup = 'previews/preview-report.json';
pleat.spriteProduction.runtimeIntegrated = true;
pleat.spriteProduction.status = 'runtime_integrated_pending_user_validation';
pleat.cleanupManifest = '../cleanup-manifest-20260901.json';
write('animations-pleat-v03-20260831/manifest.json', pleat);

const hollow = read('animations-hollow-v01-20260901/manifest.json');
clearRemovedLinks(hollow, 'animations-hollow-v01-20260901');
hollow.status = 'runtime_integrated_pending_user_validation';
hollow.runtimeIntegrationActive = true;
hollow.verificationBoundary = '五动作正式图集、HollowOvum状态机、双份配置、Boot登记和恐怖地牢候选池已接入；未运行测试、构建、浏览器或游戏验证。';
hollow.spriteProduction = {
  path: 'sprite-production-v01',
  status: 'runtime_integrated_pending_user_validation',
  manifest: 'sprite-production-v01/sprite-manifest.json',
  overview: 'sprite-production-v01/previews/all-actions-fixed-root.png',
  runtimeIntegration: 'sprite-production-v01/runtime-integration.json',
  totalDecodedMiB: 54.8119,
  runtimeIntegrated: true,
};
hollow.cleanupManifest = '../cleanup-manifest-20260901.json';
write('animations-hollow-v01-20260901/manifest.json', hollow);

for (const relativePath of [
  'animations-hollow-v01-20260901/sprite-production-v01/composition.json',
  'animations-hollow-v01-20260901/sprite-production-v01/selection.json',
  'animations-pleat-v03-20260831/sprite-production-v01/composition.json',
  'animations-pleat-v03-20260831/sprite-production-v01/selection.json',
]) {
  const record = read(relativePath);
  record.runtimeIntegrated = true;
  write(relativePath, record);
}

const hollowParameters = read('animations-hollow-v01-20260901/sprite-production-v01/animation-parameters.json');
write('animations-hollow-v01-20260901/sprite-production-v01/runtime-integration.json', {
  date: '2026-09-01',
  unitKey: 'hollowOvum',
  status: 'integrated_pending_user_validation',
  authorization: {
    userRequest: '导入游戏设计状态机和数值；继续对空腔之卵生成并按动画标准工作流处理。',
    scope: '空腔之卵五动作入库、双技能状态机、数值、恐怖地牢领主池；不包括测试或EXE发布。',
  },
  entity: 'src/entities/enemy-types/hollow-ovum.js',
  config: 'data/enemy-config.json#hollowOvum',
  assets: 'assets/enemies/hollow_ovum',
  orientation: {
    orientationInvariant: true,
    flipX: false,
    camera: '固定略俯视三分之四镜头；无头胸胯、面部或左右行进轴。',
    root: '共同中心悬浮根点；世界移动由Collider负责，素材保留自然升降。',
  },
  displaySize: hollowParameters.displaySize,
  collision: hollowParameters.collision,
  actions: Object.fromEntries(Object.entries(hollowParameters.actions).map(([key, action]) => [key, {
    textureKey: action.textureKey,
    texture: `assets/enemies/hollow_ovum/${key}.png`,
    frameCount: action.frameCount,
    durationMs: action.duration,
    frameWidth: action.frameWidth,
    frameHeight: action.frameHeight,
    footX: action.footX,
    footY: action.footY,
  }])),
  skills: hollowParameters.skills,
  dungeonRegistration: {
    pools: 5,
    statProfile: 'horror',
    invasionEnabled: false,
  },
  dependencyNote: 'Five unique animation textures, 54.8119 MiB decoded. No summons, projectiles or separate VFX textures; this is not a scene-performance measurement.',
  cleanupManifest: '../../cleanup-manifest-20260901.json',
  userFinalRuntimeAcceptance: false,
  testsRun: false,
  runtimeValidationRun: false,
  pending: [
    'C/B/A体量、碰撞和同级战斗手感',
    '真空牵引多阈值、同层、墙体遮挡与目标离开范围',
    '壳脉冲击退/眩晕、控制打断和石化姿态',
    '死亡动画、留尸和淡出',
  ],
});

const task = read('task-index.json');
clearRemovedLinks(task, '');
task.status = 'both_runtime_integrated_pending_user_validation';
task.generationNote = '百褶噬团与空腔之卵均已完成正式透明图集、状态机、数值、Boot与恐怖地牢候选池接入。空腔之卵移动和壳脉冲沿用结构安全派生版；判退视频与重复缓存已按清理清单移除，提示词、供应方JSON、逐帧统计和判退原因保留。未运行测试或游戏验证。';
task.approved = true;
task.approvedDate = '2026-09-01';
task.acceptedPreview = 'animations-hollow-v01-20260901/sprite-production-v01/previews/all-actions-fixed-root.png';
task.acceptedPreviews = [
  'animations-pleat-v03-20260831/sprite-production-v01/previews/all-actions-fixed-root.png',
  'animations-hollow-v01-20260901/sprite-production-v01/previews/all-actions-fixed-root.png',
];
task.presentation = '两只抽象领主已接入恐怖地牢，等待用户游戏验收。';
task.cleanupManifest = 'cleanup-manifest-20260901.json';
for (const asset of task.assets) {
  asset.status = 'runtime_integrated_pending_user_validation';
  asset.approved = true;
  asset.runtimeIntegrationActive = true;
  if (asset.unitKey === 'hollow_ovum') {
    asset.spriteManifest = 'animations-hollow-v01-20260901/sprite-production-v01/sprite-manifest.json';
    asset.spritePreview = 'animations-hollow-v01-20260901/sprite-production-v01/previews/all-actions-fixed-root.png';
    asset.runtimeIntegration = 'animations-hollow-v01-20260901/sprite-production-v01/runtime-integration.json';
  }
}
task.constraints = [
  '两只领主只加入恐怖地牢指定领主候选和horror数值白名单，不进入其他地牢或随机来袭。',
  '运行时保留各自单一手动动画时钟、同层与墙体遮挡复查；不修改既有波次数量和A级最终Boss。',
  '未运行测试、构建或游戏运行时验证；按约定由用户测试。',
  '来源记录不代表第三方权利审核。',
];
write('task-index.json', task);

console.log('Updated finalized runtime metadata.');
