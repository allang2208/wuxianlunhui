"""Update archive metadata after explicit user-authorized task cleanup.

Does not remove files, generate pixels, run tests or modify gameplay configs.
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
REPO = ROOT.parents[3]


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


manifest = read(ROOT/'runtime-build/manifest.json')
manifest.update(assetOnly=False, runtimeIntegrationActive=True, archiveStatus='minimal-reproducible-source-set')
actions = {r['state']:r for r in manifest['actions']}
for state, rec in actions.items():
    rec['preInterpolationSheet'] = f'runtime-build/pre-interpolation/{state}.png'
    rec['preview'] = f'runtime-build/previews/{state}.gif'
    rec['rifeReport'] = f'runtime-build/rife-reports/{state}.json'
    contact = ROOT/f'runtime-build/rife-previews/deep-vein-mother-runtime-{state}-interpolated-contact.png'
    if contact.exists():
        shutil.copyfile(contact, ROOT/f'runtime-build/previews/{state}-contact.png')
    rec['contact'] = f'runtime-build/previews/{state}-contact.png'
    report_path = ROOT/rec['rifeReport']
    report = read(report_path)
    report['retainedRuntimeSheet'] = rec['asset']
    report['archiveNote'] = 'Original report paths are production history; retainedRuntimeSheet and the final manifest name the current files.'
    save(report_path, report)
save(ROOT/'runtime-build/manifest.json', manifest)

task = read(ROOT/'task-index.json')
for job in task['jobs']:
    state = job['state']
    rec = actions[state]
    job.update(status='source-approved-runtime-integrated-awaiting-user-test',
               spritesheet='../../../../'+rec['asset'],
               spritePreview=rec['preview'],gif=rec['preview'],contact=rec['contact'],
               previewClock='runtime-config-not-source-video',spriteFrameCount=rec['frameCount'],
               spriteFrameRate=rec['frameRate'],runtimeIntegrationActive=True)
    for rejected in job.get('rejectedCandidates', []):
        for key in ('video','gif','contact'):
            if key in rejected:
                rejected.setdefault('removedArtifacts', []).append(rejected.pop(key))
        rejected['status'] = 'rejected_archived_metadata_only'
        rejected['mediaRetainedInGit'] = False
task.update(assetOnly=False,runtimeIntegrationActive=True,sourceSpriteManifest='runtime-build/manifest.json',
            overview='runtime-build/previews/runtime-overview.gif',
            overviewNote='Current runtime-clock preview; seven approved MP4s retained, rejected videos metadata only.')
save(ROOT/'task-index.json', task)

mother = read(TASK/'task-index.json')
mother.update(assetOnly=False,runtimeIntegrationActive=True,sourceSpriteManifest='animations/runtime-build/manifest.json',
              approvalBasis='用户已确认v03母图与七段当前源视频，随后授权统一大小、优化插帧及接入高级废弃矿洞Boss；运行时尚未测试。')
for field in ('reviewNotes','deliveryNotes'):
    if field in mother:
        mother[field+'History'] = mother.pop(field)
for candidate in mother['candidates']:
    if not candidate['approved']:
        candidate['archiveRole'] = 'retained-direct-edit-ancestor-not-discarded'
mother['archivePolicy'] = 'Keep direct image edit ancestry, approved MP4s/prompts/provenance, current pre-RIFE sheets, runtime assets, reports and final GIF/contact previews. Retire rejected video pixels and reproducible intermediate caches.'
for context in mother.get('visualContextOnly', []):
    if '_abandoned_mine_lords_' in context.get('path',''):
        context['historicalExternalPath'] = context.pop('path')
        context['notRequiredForRebuild'] = True
save(TASK/'task-index.json', mother)

review = ROOT/'REVIEW.md'
text = review.read_text(encoding='utf-8')
for job in task['jobs']:
    stem = Path(job['video']).stem
    for suffix in ('-source.gif','-contact.png'):
        text = text.replace('previews/'+stem+suffix, job['gif'] if suffix.endswith('.gif') else job['contact'])
text = text.replace('previews/7-actions-source-overview.gif','runtime-build/previews/runtime-overview.gif')
notice = '> 归档更新：下文保留源片验收时的历史描述，当前仅保留七段定稿MP4；两段淘汰视频只保留提示词/provenance/失败原因。链接已更新为正式配置速度GIF，不再表示源视频速度。当前接入与资产状态以 INTEGRATION.md 和 runtime-build/manifest.json 为准。\n\n'
if notice not in text:
    text = text.replace('\n\n', '\n\n'+notice, 1)
review.write_text(text, encoding='utf-8')
(ROOT/'SPRITES.md').write_text('# 历史制作源阶段\n\n917帧、512px画布为已替换的制作中间结果，已按用户授权从活动目录移出。当前交付为299帧正式资源；原视频、母图编辑链与本轮未插帧输入保留，详见 [接入说明](INTEGRATION.md) 和 [最终清单](runtime-build/manifest.json)。\n\n未运行测试或运行时验证，按约定由用户测试。\n', encoding='utf-8')
integration = ROOT/'INTEGRATION.md'
text = integration.read_text(encoding='utf-8')
text = text.replace('原 MP4、BiRefNet 抠图、512px制作源和917帧旧表保留，没有重生成或恢复淘汰版本。',
                    '原MP4、母图直接编辑链和当前未插帧源表保留；BiRefNet逐帧缓存、512px旧制作表及917帧旧表已按用户授权可恢复移出活动目录，不进Git。没有重生成或恢复淘汰版本。')
text = text.replace('高分辨率源可重导', '高分辨率源视频可重导')
if '归档重建：' not in text:
    text += '\n归档重建：`build-runtime-sprites.py all`直接复用已保留的pre-interpolation七张表，无需逐帧抠图缓存；成品直接写入assets目录，避免复制两套正式PNG。重新从视频抠图属于另一次素材制作，先使用历史build-sprites.py的prepare/cutouts阶段，再显式执行build-runtime-sprites.py prepare-from-video-cache重新准备输入。最终报告原输出路径保留为生产历史，当前路径见retainedRuntimeSheet。\n'
integration.write_text(text, encoding='utf-8')
print('Archive indices and current source/output links updated; no gameplay or pixel changes.')
