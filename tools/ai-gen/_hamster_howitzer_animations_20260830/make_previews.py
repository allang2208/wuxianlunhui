"""Produce original-timing GIF previews for completed howitzer video candidates."""
import json
import argparse
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--revision', choices=['v01','v02','v03','v04'], default='v01')
parser.add_argument('--action', choices=['attack','die'], default='attack')
options = parser.parse_args()
revision, target_action = options.revision, options.action
index_path = ROOT/('task-index.json' if revision == 'v01' else f'{target_action}-{revision}-index.json')
index = json.loads(index_path.read_text(encoding='utf-8-sig'))
ready = {kind:action for kind,action in index['actions'].items()
         if action.get('sourceVideo') and (ROOT/action['sourceVideo']).is_file()}
if not ready:
    raise SystemExit('No completed source video; do not generate placeholder previews.')
for kind,action in ready.items():
    video = cv2.VideoCapture(str(ROOT/action['sourceVideo']))
    fps = video.get(cv2.CAP_PROP_FPS)
    frames = []
    while True:
        ok,bgr = video.read()
        if not ok:
            break
        frames.append(Image.fromarray(cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)))
    video.release()
    if not frames or fps <= 0:
        raise RuntimeError(f'Cannot decode video: {kind}')
    ends = np.rint(np.arange(1,len(frames)+1)/fps*100).astype(int)
    durations = (np.diff(np.r_[0,ends])*10).tolist()
    thumbnails = [frame.resize((640,360),Image.Resampling.LANCZOS) for frame in frames]
    palette_source = Image.new('RGB',(128,72*len(frames)))
    for i,frame in enumerate(thumbnails):
        palette_source.paste(frame.resize((128,72),Image.Resampling.LANCZOS),(0,72*i))
    palette = palette_source.quantize(colors=255)
    indexed = [frame.quantize(palette=palette) for frame in thumbnails]
    output = ROOT/f'previews/{kind}-source-loop-{revision}.gif'
    indexed[0].save(output,save_all=True,append_images=indexed[1:],duration=durations,
                    loop=0,disposal=2,optimize=False)
    contact = Image.new('RGB',(1280,600),'#242830')
    draw = ImageDraw.Draw(contact)
    for j,frame_id in enumerate(np.linspace(0,len(frames)-1,12,dtype=int)):
        x,y = j%4*320,j//4*200
        contact.paste(frames[frame_id].resize((320,180),Image.Resampling.LANCZOS),(x,y+20))
        draw.text((x+6,y+4),f'{kind} / f{frame_id} / {frame_id/fps:.2f}s',fill='white')
    contact_path = ROOT/f'previews/{kind}-source-contact-{revision}.jpg'
    contact.save(contact_path,quality=92)
    if kind == 'die':
        final_pose = ROOT/f'previews/die-final-pose-{revision}.png'
        frames[-1].save(final_pose)
        action['finalPose'] = final_pose.relative_to(ROOT).as_posix()
    action.update(preview=output.relative_to(ROOT).as_posix(),previewLoop=True,
                  contactSheet=contact_path.relative_to(ROOT).as_posix(),
                  sourceFrames=len(frames),sourceFps=fps,sourceDurationMs=len(frames)/fps*1000,
                  previewSize=[640,360],previewDurationMs=sum(durations),previewFrameDurationsMs=durations)
    acceptance = action.get('userAcceptance',{})
    accepted = acceptance.get('sourceVideo')==action['sourceVideo'] and acceptance.get('promptId')==action.get('promptId')
    action['status'] = 'user_accepted_source_video' if accepted else 'candidate_preview_ready'
    if index.get('productionReviewStatus') == 'rejected':
        action['status'] = 'rejected_candidate_preview'
    print(f'{kind}: {len(frames)} frames @ {fps:g}fps -> {output}',flush=True)
if len(ready)==len(index['actions']):
    accepted = all(a['status']=='user_accepted_source_video' for a in index['actions'].values())
    if not index.get('spriteManifest') and not index.get('runtimeIntegrationActive') and index.get('productionReviewStatus') != 'rejected':
        accepted_status = 'four_source_animations_user_accepted' if len(index['actions']) == 4 else 'source_animation_user_accepted'
        index['status'] = accepted_status if accepted else 'candidate_previews_ready_awaiting_user_review'
    index['generation'].update(uploaded=True,submitted=True,generated=True)
    index_path.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    labels = {'idle':'待机','run':'移动','attack':'攻击','die':'死亡'}
    lines = [f'# 仓鼠榴弹炮组：{revision} H3 视频候选','',
             f'{len(ready)}段源视频及循环GIF已完成；当前只交付视频候选，不代表已制作透明图集或导入游戏。','',
             '| 动作 | 源帧数 | 源帧率 | 源时长 | 模式 |','|---|---:|---:|---:|---|']
    for kind,action in index['actions'].items():
        lines.append(f'| {labels[kind]} | {action["sourceFrames"]} | {action["sourceFps"]:g}fps | '
                     f'{action["sourceDurationMs"]/1000:.4f}s | {action["actionMode"]} |')
    loop_note = ('死亡源动作仍为单次倒下。' if 'die' in index['actions'] else
                 '本段为单次开火后装填，结尾空手；重播不代表已完成下一发取弹或无缝衔接。')
    review_scope = ('断口结构、两名炮手完整倒地和全程无开火须根据成片审阅。' if set(index['actions']) == {'die'} else
                    '炮管/炮口与待装弹的比例、后坐方向、两人完整性和移动步态需以成片审阅为准。')
    lines += ['',f'所有GIF保留全部源姿态并累计量化到10ms精度；循环仅方便查看，{loop_note}','',
              '候选已知问题与待确认项见 [REVIEW-NOTES.md](REVIEW-NOTES.md)，不要将生成完成视为视觉定稿。','',
              review_scope+'未运行测试或运行时验证，按约定由用户测试。','',
              '没有修改招募、科技、战斗、数值、存档或固定EXE；制作档位为crowd，尚未生成正式图集，未宣称运行时预算通过。','']
    for kind,action in index['actions'].items():
        lines += [f'### {labels[kind]}','',
                  f'[H3原视频]({(ROOT/action["sourceVideo"]).as_posix()}) · [来源记录]({(ROOT/action["provenance"]).as_posix()})','',
                  f'![{labels[kind]}]({(ROOT/action["preview"]).as_posix()})','']
        if action.get('finalPose'):
            lines += [f'[源视频最终倒地画面]({(ROOT/action["finalPose"]).as_posix()})','']
    if index.get('detailPreview'):
        lines += ['### 后膛局部预览','',
                  '仅放大后膛区域便于查看退壳/装填，不改源视频；保持完整8秒时长。','',
                  f'![后膛局部]({(ROOT/index["detailPreview"]).as_posix()})','']
    delivery_name = 'DELIVERY.md' if revision == 'v01' else f'{target_action.upper()}-{revision.upper()}-DELIVERY.md'
    (ROOT/delivery_name).write_text('\n'.join(lines),encoding='utf-8')
else:
    print('Partial preview saved; live generation index is unchanged.',flush=True)
