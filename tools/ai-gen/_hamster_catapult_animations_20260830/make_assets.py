"""Offline catapult asset production; never writes runtime assets/configuration.

Video generation is handled separately by ai-asset.py. This task-local adapter
keeps both crew and the machine, and uses one fixed canvas transform throughout.
"""
from __future__ import annotations
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parent
KINDS = ('idle', 'run', 'attack', 'die')
SCALE = 0.35
ANCHOR = (512, 460)
SPECS = json.loads((ROOT/'action-specs.json').read_text(encoding='utf-8')) if (ROOT/'action-specs.json').exists() else {}


def video_path(kind):
    return ROOT/SPECS.get(kind,{}).get('video',f'videos/{kind}-v01.mp4')


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def read_video(path):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        frames.append(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    cap.release()
    if not frames or fps <= 0:
        raise RuntimeError(f'No decoded video frames: {path}')
    return frames, fps


def gif_durations(durations):
    # Distribute GIF's 10ms quantization without accumulating timing drift.
    ends = np.rint(np.cumsum(durations)/10).astype(int)
    return (np.diff(np.r_[0, ends])*10).tolist()


def save_gif(frames, durations, out, loop=True):
    palette = frames[0].convert('RGB').quantize(colors=255)
    indexed = [f.convert('RGB').quantize(palette=palette) for f in frames]
    kwargs = {'loop': 0} if loop else {}
    indexed[0].save(out, save_all=True, append_images=indexed[1:],
                    duration=gif_durations(durations), disposal=2,
                    optimize=False, **kwargs)


def looping_review_copy(source, out):
    """Add review-only repetition without re-encoding frames or their timing."""
    data = source.read_bytes()
    with Image.open(source) as gif:
        if gif.format != 'GIF' or 'loop' in gif.info:
            raise ValueError('Expected a one-shot GIF for the review copy')
    # The application extension goes after the header and global color table.
    table_bytes = 3 * (2 ** ((data[10] & 7) + 1)) if data[10] & 0x80 else 0
    offset = 13 + table_bytes
    extension = b'\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00'
    out.write_bytes(b'GIF89a' + data[6:offset] + extension + data[offset:])


def source_preview(kind):
    video = video_path(kind)
    frames, fps = read_video(video)
    indices = list(range(0, len(frames), 2))
    durations = [(b-a)/fps*1000 for a,b in zip(indices, indices[1:]+[len(frames)])]
    (ROOT/'previews').mkdir(exist_ok=True)
    save_gif([frames[i].resize((640,360), Image.Resampling.LANCZOS) for i in indices],
             durations, ROOT/f'previews/{kind}-source.gif', loop=kind!='die')
    print(f'{kind}: source GIF, {len(frames)} frames @ {fps:g} fps', flush=True)


def layout(count, width, height):
    candidates = []
    for cols in range(1, min(count,4096//width)+1):
        rows = math.ceil(count/cols)
        if rows*height <= 4096:
            candidates.append((cols*rows-count, abs(cols*width-rows*height), cols))
    if not candidates:
        raise RuntimeError('No single-sheet layout within 4096 pixels')
    return min(candidates)[2]


def sheet_from(frames, cols):
    width,height = frames[0].size
    out = Image.new('RGBA', (cols*width, math.ceil(len(frames)/cols)*height))
    for i,frame in enumerate(frames):
        out.paste(frame, ((i%cols)*width,(i//cols)*height))
    return out


def remove_white_matte(cut):
    """Replace only excess white RGB at the edge; retain the BiRefNet alpha.

    Compare to foreground at most four source pixels away. White fur remains
    white because its nearest interior colour is also white. Thin disconnected
    objects without a nearby interior are left alone.
    """
    rgba=np.array(cut)
    alpha=rgba[...,3]
    inside=ndimage.distance_transform_edt(alpha>8)
    core=(alpha>=250)&(inside>2.5)
    if not core.any():
        return cut
    distance,nearest=ndimage.distance_transform_edt(~core,return_indices=True)
    rgb=rgba[...,:3].astype(np.int16)
    interior=rgb[nearest[0],nearest[1]]
    excess=rgb.min(axis=2)-interior.min(axis=2)
    edge=(alpha>0)&(inside<=2.5)&(distance<=4)&(excess>20)
    rgba[edge,:3]=interior[edge].astype(np.uint8)
    rgba[alpha==0,:3]=0
    return Image.fromarray(rgba,'RGBA')


def separate_stone(cut,source_frame,scale):
    """Separate the visually identified airborne stone in attack v02 f42/f43.

    Explicit source frames and region prevent filtering either crew member.
    The unit and stone retain the exact original alpha partition.
    """
    rgba=np.array(cut)
    labels,count=ndimage.label(rgba[...,3]>8)
    candidates=[]
    for label in range(1,count+1):
        ys,xs=np.where(labels==label)
        if not len(xs): continue
        w=int(xs.max()-xs.min()+1);h=int(ys.max()-ys.min()+1)
        if xs.mean()>760 and ys.mean()<260 and 20<=w<=85 and 20<=h<=85 and 0.6<w/h<1.5:
            candidates.append(label)
    if len(candidates)!=1:
        raise RuntimeError(f'attack f{source_frame}: expected one known airborne stone; got {len(candidates)}')
    mask=ndimage.binary_dilation(labels==candidates[0],iterations=3)&(rgba[...,3]>0)
    stone=rgba.copy();stone[~mask]=0
    unit=rgba.copy();unit[mask]=0
    stone_image=Image.fromarray(stone,'RGBA')
    bbox=stone_image.getchannel('A').getbbox()
    source=stone_image.crop(bbox)
    (ROOT/'source-sheets').mkdir(exist_ok=True)
    source.save(ROOT/f'source-sheets/attack-stone-source-{source_frame}.png')
    if source_frame==42:
        size=tuple(round(v*scale) for v in source.size)
        tile=source.resize(size,Image.Resampling.LANCZOS)
        final=Image.new('RGBA',(size[0]+6,size[1]+6));final.paste(tile,(3,3))
        (ROOT/'final').mkdir(exist_ok=True)
        final.save(ROOT/'final/stone.png')
    return Image.fromarray(unit,'RGBA'),{'sourceFrame':source_frame,'sourceBBox':list(bbox)}


def keyframes(kinds):
    sys.path.insert(0, str(TOOLS))
    from rmbg_cutout import get_model, predict_alpha
    model = get_model()
    cache = ROOT/'cache/birefnet'
    cache.mkdir(parents=True, exist_ok=True)
    (ROOT/'source-sheets').mkdir(exist_ok=True)
    for kind in kinds:
        spec=SPECS.get(kind,{})
        reference_scale=spec.get('referenceScaleFromCommonCanvas',1)
        reference_offset=spec.get('referenceOffset',[0,0])
        output_scale=SCALE/reference_scale
        anchor=[ANCHOR[i]*reference_scale+reference_offset[i] for i in (0,1)]
        frames,fps = read_video(video_path(kind))
        indices = list(range(0,len(frames),4))
        indices=sorted(set(indices+[i for i in spec.get('extraSourceFrameIndices',[]) if 0<=i<len(frames)]))
        dense=spec.get('denseSourceFrameRange')
        if dense:
            indices=sorted(set(indices+list(range(dense[0],min(dense[1]+1,len(frames))))))
        if kind not in ('idle','run') and indices[-1] != len(frames)-1:
            indices.append(len(frames)-1)
        scaled = []
        projectile_parts=[]
        for j,i in enumerate(indices):
            cached = cache/f'{video_path(kind).stem}-{i:04}.png'
            if cached.exists():
                cut = Image.open(cached).convert('RGBA')
            else:
                rgb = np.asarray(frames[i])
                alpha = np.asarray(predict_alpha(model,frames[i]), dtype=np.uint8)
                # Keep ALL subjects and detached gear/projectiles. Never apply
                # the older single-largest-component cleanup to this crew.
                alpha[alpha < 4] = 0
                rgba = np.dstack([rgb,alpha])
                rgba[alpha == 0,:3] = 0
                cut = Image.fromarray(rgba,'RGBA')
                cut.save(cached)
            cut=remove_white_matte(cut)
            if i in spec.get('separateProjectileSourceFrames',[]):
                cut,part=separate_stone(cut,i,output_scale)
                projectile_parts.append(part)
            size = tuple(round(v*output_scale) for v in cut.size)
            scaled.append(cut.resize(size,Image.Resampling.LANCZOS))
            print(f'{kind}: BiRefNet key {j+1}/{len(indices)} (video {i})',flush=True)
        bounds = [f.getchannel('A').getbbox() for f in scaled]
        if any(b is None for b in bounds):
            raise RuntimeError(f'{kind}: empty cutout; retain source and stop')
        cx = round(anchor[0]*output_scale)
        radius = max(max(cx-b[0],b[2]-cx) for b in bounds)+3
        top = min(b[1] for b in bounds)-3
        bottom = max(b[3] for b in bounds)+3
        crop = (cx-radius,top,cx+radius,bottom)
        cells = []
        for f in scaled:
            arr = np.array(f.crop(crop))
            arr[arr[...,3]==0,:3] = 0
            cells.append(Image.fromarray(arr,'RGBA'))
        width,height = cells[0].size
        cols = layout(len(cells),width,height)
        out = ROOT/f'source-sheets/{kind}-keys.png'
        sheet_from(cells,cols).save(out)
        durations = [(b-a)/fps*1000 for a,b in zip(indices,indices[1:]+[len(frames)])]
        metadata = {
            'kind':kind,'assetOnly':True,'runtimeIntegrationActive':False,
            'video':str(video_path(kind).relative_to(ROOT)).replace('\\','/'),'sourceFrames':len(frames),
            'sourceFps':fps,'sourceFrameIndices':indices,'sourceDurationsMs':durations,
            'durationMs':len(frames)/fps*1000,'sourceScale':output_scale,
            'referenceScaleFromCommonCanvas':reference_scale,'referenceOffset':reference_offset,
            'effectiveScaleFromCommonCanvas':SCALE,
            'canvasTransform':'uniform scale only; no per-frame recentering/foot alignment',
            'anchorInVideo':anchor,'actionCropInScaledCanvas':list(crop),
            'footX':cx-crop[0],'footY':anchor[1]*output_scale-crop[1],
            'frameWidth':width,'frameHeight':height,'frameCount':len(cells),
            'cols':cols,'rows':math.ceil(len(cells)/cols),'loop':kind in ('idle','run'),
            'sourceSheet':str(out.relative_to(ROOT)).replace('\\','/'),
            'cutout':'ComfyUI-RMBG BiRefNet-general; all components retained; local white-matte RGB cleanup preserves alpha',
            'keyEvents':({'projectileReleaseSourceFrame':spec['releaseSourceFrame'],
                          'projectileReleaseOutputFrame':indices.index(spec['releaseSourceFrame'])*2,
                          'sourceVisualEventOnly':True} if 'releaseSourceFrame' in spec else None),
            'projectileParts':projectile_parts,'runtimeScale':None,
        }
        write_json(ROOT/f'source-sheets/{kind}-keys.json',metadata)
        print(f'{kind}: source sheet {width}x{height}, {len(cells)} keys',flush=True)


def interpolate(kinds):
    for kind in kinds:
        meta=json.loads((ROOT/f'source-sheets/{kind}-keys.json').read_text(encoding='utf-8'))
        count=meta['frameCount']*2-(0 if meta['loop'] else 1)
        cols=layout(count,meta['frameWidth'],meta['frameHeight'])
        cmd=[sys.executable,str(TOOLS/'rife-spritesheet-interpolate.py'),
             '--sheet',str(ROOT/meta['sourceSheet']), '--out',str(ROOT/f'final/{kind}.png'),
             '--name',f'catapult-{kind}','--frame-width',str(meta['frameWidth']),
             '--frame-height',str(meta['frameHeight']),'--cols',str(meta['cols']),
             '--frame-count',str(meta['frameCount']),'--frame-rate',str(meta['sourceFps']/4),
             '--mode','loop' if meta['loop'] else 'one-shot','--out-cols',str(cols),
             '--preview-dir',str(ROOT/f'cache/rife-preview/{kind}'),
             '--report',str(ROOT/f'final/{kind}-rife.json'),'--repair-red-outliers',
             '--preserve-vertical-motion']
        # The fixed common ground anchor is in metadata. Do not translate the
        # whole cart when a falling body changes the frame's alpha bottom.
        subprocess.run(cmd,check=True)


def package(kinds):
    manifest={'unitKey':'hamster_catapult_crew','assetOnly':True,
              'runtimeIntegrationActive':False,'status':'animation_candidates_pending_user_review',
              'profile':'crowd','sourceScale':SCALE,'runtimeScale':None,'actions':{},
              'testsRun':False,'formalBudgetCheckRun':False,
              'notes':['No runtime registration or gameplay changes.',
                       'Attack separates the airborne stone. The visual release event is recorded, but game projectile spawning/ballistics are not implemented.',
                       'Native source poses are retained; no geometric correction of body motion.']}
    total=0
    for kind in kinds:
        meta=json.loads((ROOT/f'source-sheets/{kind}-keys.json').read_text(encoding='utf-8'))
        report=json.loads((ROOT/f'final/{kind}-rife.json').read_text(encoding='utf-8'))
        count=report['outputFrameCount']; cols=report['cols']
        sheet=Image.open(ROOT/f'final/{kind}.png').convert('RGBA')
        cells=[]
        for i in range(count):
            x=(i%cols)*meta['frameWidth']; y=(i//cols)*meta['frameHeight']
            cells.append(sheet.crop((x,y,x+meta['frameWidth'],y+meta['frameHeight'])))
        durations=[]
        for i,duration in enumerate(meta['sourceDurationsMs']):
            durations += [duration/2,duration/2] if meta['loop'] or i<len(meta['sourceDurationsMs'])-1 else [duration]
        preview=[]
        for cell in cells:
            bg=Image.new('RGB',cell.size,(45,50,57))
            draw=ImageDraw.Draw(bg)
            for y in range(0,cell.height,16):
                for x in range(0,cell.width,16):
                    if (x//16+y//16)%2: draw.rectangle((x,y,x+15,y+15),fill=(54,59,66))
            bg.paste(cell,(0,0),cell)
            preview.append(bg.resize((cell.width*2,cell.height*2),Image.Resampling.NEAREST))
        save_gif(preview,durations,ROOT/f'previews/{kind}-final.gif',loop=kind!='die')
        preview_path = f'previews/{kind}-final.gif'
        if kind == 'die':
            preview_path = 'previews/die-preview-loop-v02.gif'
            looping_review_copy(ROOT/'previews/die-final.gif', ROOT/preview_path)
        selected=np.linspace(0,count-1,12,dtype=int).tolist()
        tilew,tileh=meta['frameWidth'],meta['frameHeight']+22
        contact=Image.new('RGB',(tilew*4,tileh*3),(45,50,57))
        d=ImageDraw.Draw(contact)
        for j,i in enumerate(selected):
            x=(j%4)*tilew;y=(j//4)*tileh
            contact.paste(cells[i],(x,y+22),cells[i])
            d.text((x+5,y+4),f'{kind} f{i}',fill='white')
        contact.save(ROOT/f'previews/{kind}-final-contact.png')
        mib=sheet.width*sheet.height*4/1024**2; total+=mib
        manifest['actions'][kind]={**meta,'sheet':f'final/{kind}.png',
             'frameCount':count,'endFrame':count-1,'cols':cols,'rows':report['rows'],
             'sheetSize':list(sheet.size),'decodedMiB':mib,
             'frameDurationsMs':durations,'gifDurationsMs':gif_durations(durations),
             'preview':preview_path,'report':f'final/{kind}-rife.json',
             'sourceKeyMapping':'outputIndex=sourceKeyIndex*2'}
    if 'attack' in manifest['actions']:
        stone=Image.open(ROOT/'final/stone.png')
        stone_mib=stone.width*stone.height*4/1024**2
        total+=stone_mib
        manifest['projectile']={'path':'final/stone.png','size':list(stone.size),
            'decodedMiB':stone_mib,'source':'source-sheets/attack-stone-source-42.png',
            'sourceVideoFrame':42,'gameplayIntegrated':False}
    manifest['decodedMiB']=total
    manifest['budgetScope']='Listed candidate sheets and separated stone only; source sheets, GIFs and MP4s are not runtime textures.'
    write_json(ROOT/'spritesheet-manifest.json',manifest)
    budget={'version':1,'id':'hamster_catapult_crew','profile':'crowd',
            'runtimeIntegrationActive':False,'textureKeysAreProposedOnly':True,
            'dependencies':[],'sheets':[]}
    for kind,action in manifest['actions'].items():
        budget['sheets'].append({
            'textureKey':f'candidate_hamster_catapult_crew_{kind}',
            'path':str((ROOT/action['sheet']).relative_to(TOOLS.parents[1])).replace('\\','/'),
            **{key:action[key] for key in ('frameWidth','frameHeight','frameCount','endFrame','footX','footY')}})
    if 'projectile' in manifest:
        budget['sheets'].append({'kind':'image','textureKey':'candidate_hamster_catapult_stone',
            'path':str((ROOT/'final/stone.png').relative_to(TOOLS.parents[1])).replace('\\','/')})
    write_json(ROOT/'sprite-budget-manifest.json',budget)
    index=json.loads((ROOT/'task-index.json').read_text(encoding='utf-8-sig'))
    for kind,action in manifest['actions'].items():
        index['actions'][kind].update(status='transparent_rife_candidate_ready',
            sourceVideo=action['video'],sourceSheet=action['sourceSheet'],
            finalSheet=action['sheet'],preview=action['preview'])
    complete=len(manifest['actions'])==len(KINDS)
    index['status']='four_action_candidates_ready_for_user_review' if complete else 'partial_candidates_remaining_generation'
    index['generationGate']['generated']=True
    index['generationGate']['allFourActionsCompleted']=complete
    index['budget']['actualDecodedMiB']=total
    index['finalManifest']='spritesheet-manifest.json'
    index['runtimeNotes']=[
        'No recruitment, combat, technology or animation-config changes.',
        'Airborne stone is a separate candidate image; visual release is source frame 42 / output frame 32. Game spawning and ballistics are not implemented.',
        'Attack ends empty-handed; next-shot loading continuity and runtime display scale remain integration work.']
    write_json(ROOT/'task-index.json',index)
    labels={'idle':'待机','run':'移动','attack':'攻击','die':'死亡'}
    lines=['# 仓鼠投石组动画候选交付', '',
           f'已完成 {len(manifest["actions"])} 套透明动画候选；未接入游戏、未开放招募。', '',
           '| 动作 | 有效帧 | 每格尺寸 | 图集尺寸 | RGBA MiB | 时长 | 脚点 x/y |',
           '|---|---:|---|---|---:|---:|---|']
    for kind,action in manifest['actions'].items():
        lines.append(f'| {labels[kind]} | {action["frameCount"]} | {action["frameWidth"]}×{action["frameHeight"]} | '
                     f'{action["sheetSize"][0]}×{action["sheetSize"][1]} | {action["decodedMiB"]:.2f} | '
                     f'{action["durationMs"]/1000:.3f}s | {action["footX"]}/{action["footY"]:.2f} |')
    lines += ['',f'当前候选图集合计 **{total:.2f} MiB**。crowd 目标 32 MiB、准入上限 64 MiB。',
              '双人、宽器械及完整摆臂/倒地范围使本组高于 32 MiB 目标；该数值是图集 RGBA 像素容量，不是 PNG 文件体积或实机性能结果。',
              '运行时仍需按最终弹体实现确认依赖闭包；本轮没有运行正式预算检查或同场压力测试。', '',
              '## 文件', '',
              '- `spritesheet-manifest.json`：最终动作表、源帧映射、逐帧时长、裁框、脚点和来源。',
              '- `sprite-budget-manifest.json`：候选预算清单，纹理键只是提案，尚未注册。',
              '- `source-sheets/`：未插帧透明关键帧；`final/`：RIFE 成品表与生成报告。',
              '- `prompts/`、`reference/`、视频同名 `.json`：不可变提示词、参考图和 H3 provenance。', '',
              '## 预览与源视频', '']
    for kind,action in manifest['actions'].items():
        lines += [f'### {labels[kind]}', '', f'[H3 原视频]({(ROOT/action["video"]).as_posix()}) · [透明图集]({(ROOT/action["sheet"]).as_posix()})', '',
                  f'![{labels[kind]}]({(ROOT/action["preview"]).as_posix()})', '']
        if kind=='attack':
            lines += [f'石弹已独立拆分；[含石弹的原视频 GIF 演示]({(ROOT/"previews/attack-source.gif").as_posix()})。', '']
    lines += ['## 制作与接入边界', '',
              '- 两只仓鼠及器械全程保留；不使用单一最大连通域清理。白底污染只做局部边缘 RGB 修复，不侵蚀 Alpha。',
              '- 同一母图的有效制作比例为 0.35；攻击 v02 的参考缩小 0.7 倍后，通过已知变换恢复该比例，未逐帧自适应缩放。较早期 0.375 候选统一缩小约 7%，保持全套低于 64 MiB 准入上限，未删帧或改变时长。',
              '- 播放时钟以 manifest 的 `frameDurationsMs` 为准，保留 124 帧@24fps 的 5.1667 秒源时长；GIF 采用 10ms 累计量化，约 5.17 秒。不要使用 cache 内 RIFE 工具的统一帧率预览作为最终时钟。',
              '- 待机/移动插首尾回绕；攻击/死亡只在相邻帧间插值。攻击和死亡 GIF 循环预览方便观察，实际动作元数据仍为一次性。死亡循环预览只添加播放重复标记，不修改帧或时长；原单次版保留在 `previews/die-final.gif`。',
              '- 攻击 v01 因摆臂越出源画布判废，活动版本由 `action-specs.json` 指定。',
              '- 离勺石弹已拆为 `final/stone.png`；攻击透明表只保留装填和摆臂。原视频第42帧是首次明确离勺，输出事件帧见 manifest；源视频/GIF保留完整投掷演示。游戏内发射、弹道、下一轮补石、世界尺寸与状态切换尚未接入。',
              '- 未运行测试或运行时验证，按约定由用户测试；本轮只有离线生成、抠图、插帧和预览制作。', '']
    (ROOT/'DELIVERY.md').write_text('\n'.join(lines),encoding='utf-8')
    print(f'Candidate sheets: {total:.2f} MiB; no runtime integration',flush=True)


if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('stage',choices=('preview','keys','interpolate','package'))
    ap.add_argument('--kinds',nargs='+',choices=KINDS,default=list(KINDS))
    args=ap.parse_args()
    if args.stage=='preview':
        for kind in args.kinds: source_preview(kind)
    elif args.stage=='keys': keyframes(args.kinds)
    elif args.stage=='interpolate': interpolate(args.kinds)
    else: package(args.kinds)
