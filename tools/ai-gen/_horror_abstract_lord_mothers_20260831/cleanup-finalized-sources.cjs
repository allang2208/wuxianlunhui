const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const apply = process.argv.includes('--apply');
const manifestPath = path.join(root, 'cleanup-manifest-20260901.json');

if (path.basename(root) !== '_horror_abstract_lord_mothers_20260831') {
  throw new Error(`Refusing cleanup outside the expected task root: ${root}`);
}

const groups = [
  {
    reason: '可由保留的源片、选段和生产脚本重建的逐帧 BiRefNet 缓存',
    targets: [
      'animations-pleat-v03-20260831/sprite-production-v01/cutouts',
      'animations-hollow-v01-20260901/sprite-production-v01/cutouts',
    ],
  },
  {
    reason: '与最终预览重复的生产中间联系图和源帧快照',
    targets: [
      'animations-pleat-v03-20260831/sprite-production-v01/contacts',
      'animations-pleat-v03-20260831/sprite-production-v01/references',
      'animations-hollow-v01-20260901/sprite-production-v01/contacts',
      'animations-hollow-v01-20260901/sprite-production-v01/references',
    ],
  },
  {
    reason: '已被当前定稿 GIF 和图集取代的默认时钟 RIFE 预览',
    targets: [
      'animations-pleat-v03-20260831/sprite-production-v01/previews/rife-default-clock',
      'animations-hollow-v01-20260901/sprite-production-v01/previews/rife-default-clock',
    ],
  },
  {
    reason: '原视频重复 GIF/联系图；正式源片、最终透明 GIF 与审核文字均已保留',
    targets: [
      'animations-pleat-v03-20260831/previews',
      'animations-hollow-v01-20260901/previews',
    ],
  },
  {
    reason: '百褶噬团已判退攻击原片；保留不可变提示词、供应方 JSON 和判退原因',
    targets: [
      'animations-pleat-v03-20260831/videos/attack-v01.mp4',
      'animations-pleat-v03-20260831/videos/attack-v02.mp4',
      'animations-pleat-v03-20260831/videos/attack-v03.mp4',
    ],
  },
  {
    reason: '空腔之卵已判退 H3 原片；保留提示词、供应方 JSON、逐帧统计和判退原因',
    targets: [
      'animations-hollow-v01-20260901/videos/hollow-ovum-hover-motion-v01.mp4',
      'animations-hollow-v01-20260901/videos/hollow-ovum-hover-motion-v02.mp4',
      'animations-hollow-v01-20260901/videos/hollow-ovum-vacuum-draw-v01.mp4',
      'animations-hollow-v01-20260901/videos/hollow-ovum-shell-pulse-v01.mp4',
    ],
  },
  {
    reason: '原视频联系图和抽帧副本；审核概览、JSON 与最终动作联系图已保留',
    targets: [
      'animations-hollow-v01-20260901/videos/keyframes',
      'animations-hollow-v01-20260901/audit/keyframes',
      'animations-hollow-v01-20260901/audit/adjusted/keyframes',
      'animations-hollow-v01-20260901/audit/regeneration/keyframes',
    ],
    files: [
      'animations-hollow-v01-20260901/videos/hollow-ovum-collapse-v01_contact.png',
      'animations-hollow-v01-20260901/videos/hollow-ovum-hover-motion-adjusted-v03_contact.png',
      'animations-hollow-v01-20260901/videos/hollow-ovum-hover-motion-v01_contact.png',
      'animations-hollow-v01-20260901/videos/hollow-ovum-hover-motion-v02_contact.png',
      'animations-hollow-v01-20260901/videos/hollow-ovum-idle-v01_contact.png',
      'animations-hollow-v01-20260901/videos/hollow-ovum-shell-pulse-adjusted-v02_contact.png',
      'animations-hollow-v01-20260901/videos/hollow-ovum-shell-pulse-v01_contact.png',
      'animations-hollow-v01-20260901/videos/hollow-ovum-vacuum-draw-v01_contact.png',
      'animations-hollow-v01-20260901/videos/hollow-ovum-vacuum-draw-v02_contact.png',
    ],
  },
  {
    reason: 'Python 字节码缓存',
    targets: [
      'animations-pleat-v03-20260831/sprite-production-v01/__pycache__',
    ],
  },
];

function safeAbsolute(relativePath) {
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing target outside task root: ${relativePath}`);
  }
  return absolute;
}

function listFiles(absolutePath) {
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [absolutePath];
  return fs.readdirSync(absolutePath, { withFileTypes: true })
    .flatMap((entry) => listFiles(path.join(absolutePath, entry.name)));
}

const planned = [];
for (const group of groups) {
  for (const relativePath of [...(group.targets || []), ...(group.files || [])]) {
    const absolutePath = safeAbsolute(relativePath);
    for (const filePath of listFiles(absolutePath)) {
      const stat = fs.statSync(filePath);
      planned.push({
        path: path.relative(root, filePath).replaceAll('\\', '/'),
        bytes: stat.size,
        reason: group.reason,
      });
    }
  }
}

planned.sort((a, b) => a.path.localeCompare(b.path));
const totalBytes = planned.reduce((sum, item) => sum + item.bytes, 0);

const manifest = {
  task: '恐怖地牢抽象领主正式素材清理',
  createdDate: '2026-09-01',
  mode: apply ? 'applied' : 'plan',
  root: 'tools/ai-gen/_horror_abstract_lord_mothers_20260831',
  safety: '所有目标在删除前均经过绝对路径前缀校验；不触碰任务目录以外文件。',
  retained: [
    '获准母图及其直接编辑祖先、参考图和提示词',
    '每个正式动作使用的源视频与来源 JSON',
    '结构安全派生视频及逐帧操作来源',
    '未插帧关键图集 keys、最终透明图集 final、最终 GIF/联系图/总览',
    '生产脚本、参数、透明/RIFE 报告、运行时登记与设计报告',
  ],
  deletedFileCount: planned.length,
  deletedBytes: totalBytes,
  deletedMiB: Number((totalBytes / 1024 / 1024).toFixed(2)),
  files: planned,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

if (apply) {
  for (const group of groups) {
    for (const relativePath of [...(group.targets || []), ...(group.files || [])]) {
      const absolutePath = safeAbsolute(relativePath);
      if (fs.existsSync(absolutePath)) fs.rmSync(absolutePath, { recursive: true, force: false });
    }
  }
}

console.log(JSON.stringify({ mode: manifest.mode, deletedFileCount: planned.length, deletedBytes: totalBytes, deletedMiB: manifest.deletedMiB }, null, 2));
