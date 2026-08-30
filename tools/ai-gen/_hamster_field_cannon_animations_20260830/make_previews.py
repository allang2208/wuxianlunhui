"""Create looping review GIFs from completed H3 videos; no game files are changed."""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
index_path = ROOT/'task-index.json'
index = json.loads(index_path.read_text(encoding='utf-8'))
ready = {kind: action for kind, action in index['actions'].items()
         if action.get('sourceVideo') and (ROOT/action['sourceVideo']).is_file()}
if not ready:
    raise SystemExit('No completed source video; generation must finish first.')

for kind, action in ready.items():
    video = cv2.VideoCapture(str(ROOT/action['sourceVideo']))
    fps = video.get(cv2.CAP_PROP_FPS)
    frames = []
    while True:
        ok, bgr = video.read()
        if not ok:
            break
        frames.append(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    video.release()
    if not frames or fps <= 0:
        raise RuntimeError(f'Cannot decode completed source: {kind}')
    # Keep every source pose, including very brief muzzle flashes.
    indices = list(range(len(frames)))
    ends = np.rint(np.array(indices[1:]+[len(frames)])/fps*100).astype(int)
    durations = (np.diff(np.r_[0, ends])*10).tolist()
    thumbnails = [frames[i].resize((640, 360), Image.Resampling.LANCZOS) for i in indices]
    # Use colors across the action so muzzle flashes are represented as well.
    samples = [frame.resize((128,72), Image.Resampling.LANCZOS) for frame in thumbnails]
    palette_source = Image.new('RGB', (128, 72*len(samples)))
    for i, frame in enumerate(samples):
        palette_source.paste(frame, (0, 72*i))
    palette = palette_source.quantize(colors=255)
    indexed = [frame.quantize(palette=palette) for frame in thumbnails]
    output = ROOT/f'previews/{kind}-source-loop-v01.gif'
    indexed[0].save(output, save_all=True, append_images=indexed[1:],
                    duration=durations, disposal=2, optimize=False, loop=0)
    action['preview'] = output.relative_to(ROOT).as_posix()
    action['previewLoop'] = True
    action['sourceFrames'] = len(frames)
    action['sourceFps'] = fps
    action['sourceDurationMs'] = len(frames)/fps*1000
    action['previewSize'] = [640, 360]
    action['previewDurationMs'] = sum(durations)
    action['previewFrameDurationsMs'] = durations
    acceptance = action.get('userAcceptance', {})
    accepted = (acceptance.get('sourceVideo') == action['sourceVideo']
                and acceptance.get('promptId') == action.get('promptId'))
    action['status'] = 'user_accepted_source_video' if accepted else 'candidate_preview_ready'
    print(f'{kind}: {len(frames)} frames @ {fps:g} fps -> {output}', flush=True)
if len(ready) == len(index['actions']):
    accepted = all(a['status'] == 'user_accepted_source_video' for a in index['actions'].values())
    has_sprites = bool(index.get('spriteManifest'))
    if not has_sprites and not index.get('runtimeIntegrationActive'):
        index['status'] = 'four_source_animations_user_accepted' if accepted else 'candidate_previews_ready_awaiting_user_review'
    index['generation'].update(uploaded=True, submitted=True, generated=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    labels = {'idle': '待机', 'run': '移动', 'attack': '攻击', 'die': '死亡'}
    lines = ['# 仓鼠野战炮组：四动作 H3 视频候选', '',
             ('用户已确认四个源动作可用，保留当前姿态和时长。' if accepted else '四段源视频及可循环 GIF 已制作，等待用户确认。')
             + ('透明精灵图及RIFE插帧已制作，见SPRITES-DELIVERY.md；本页保留源视频预览。' if has_sprites
                else '尚未制作透明精灵图、RIFE 插帧或导入游戏。'), '',
             '全部动作沿用同一获准母图、1024×576固定画布与等比留边。GIF保留全部源姿态，并以10ms累计量化保留原动作时长。', '',
             '| 动作 | 源帧数 | 源帧率 | 源时长 | 动作语义 |',
             '|---|---:|---:|---:|---|']
    for kind, action in index['actions'].items():
        lines.append(f'| {labels[kind]} | {action["sourceFrames"]} | {action["sourceFps"]:g}fps | '
                     f'{action["sourceDurationMs"]/1000:.4f}s | {action["actionMode"]} |')
    lines += ['', 'GIF全部设置循环，便于反复查看；死亡源动作仍为一次性倒下，GIF重新播放不表示游戏中复活。', '',
              '## 候选边界', '',
              '- 攻击：炮口火焰比要求更长，伸至画面右边缘，尚未作为正式战斗特效采用。',
              '- 死亡：两名炮手倒地并保持末姿；右侧炮手部分身体被炮架遮挡。',
              '- 其他动作表现与用户验收状态见 `candidate-review-notes.json`；源动画验收不等于游戏运行时验收。',
              '- 未修改游戏招募、战斗、科技树、数值或正式资产。未运行测试或运行时验证，按约定由用户测试。',
              '- 制作预算为crowd，32MiB目标/64MiB准入上限；透明图集预算见spritesheet-manifest.json（若已制作），本页不宣称游戏运行时预算已通过。', '',
              '## 视频与 GIF', '']
    for kind, action in index['actions'].items():
        lines += [f'### {labels[kind]}', '',
                  f'[H3 原视频]({(ROOT/action["sourceVideo"]).as_posix()}) · '
                  f'[来源记录]({(ROOT/action["provenance"]).as_posix()})', '',
                  f'![{labels[kind]}]({(ROOT/action["preview"]).as_posix()})', '']
    (ROOT/'DELIVERY.md').write_text('\n'.join(lines), encoding='utf-8')
else:
    # The generation supervisor still owns task-index.json until all jobs finish.
    print('Partial preview files saved; generation index left unchanged.', flush=True)
