"""Approved headsman sources -> BiRefNet + RIFE, with fixed camera transforms.

Offline asset production only. Does not start or test the game.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import math
import subprocess
import sys

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parents[2]
BUILD = ROOT / 'sprite-build-v01'
ACTIONS = ('idle', 'walking', 'attacking', 'dying')
VIDEOS = {a: ROOT/'videos'/f'{a}-doubao-v{6 if a == "walking" else 1:02d}.mp4' for a in ACTIONS}
spec = importlib.util.spec_from_file_location('headsman_pack', ROOT/'producer/sprite_packing.py')
packing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packing)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def frames(action):
    with av.open(str(VIDEOS[action])) as container:
        return [frame.to_image().convert('RGB') for frame in container.decode(video=0)]


def prepare():
    selected = {}
    for action in ACTIONS:
        imgs = frames(action)
        if len(imgs) != 121 or imgs[0].size != (1280, 720):
            raise RuntimeError(f'Unexpected approved source: {action}')
        candidates = []
        if action in ('idle', 'walking'):
            step = 4 if action == 'idle' else 2
            masks = [cv2.resize((np.asarray(img)[110:640,350:950].mean(axis=2)<155).astype(np.float32), (150,133), interpolation=cv2.INTER_AREA) for img in imgs]
            for start in range(12, 65, step):
                for period in range(48 if action == 'idle' else 36, 81 if action == 'idle' else 65, step):
                    end = start+period
                    if end > 116:
                        continue
                    pose = float(np.abs(masks[start]-masks[end]).mean())
                    velocity = float(np.abs((masks[start+step]-masks[start])-(masks[end]-masks[end-step])).mean())
                    candidates.append(dict(start=start,endExclusive=end,score=pose+.35*velocity))
            candidates.sort(key=lambda x:x['score'])
            start,end = candidates[0]['start'],candidates[0]['endExclusive']
            indices = list(range(start,end,step))
            times = [(i-start)/24*1000 for i in indices]
            duration = (end-start)/24*1000
        elif action == 'attacking':
            # Keep every native strike frame; sparse keys only during slow preparation/hold.
            indices = sorted(set(range(0,49,4)) | set(range(49,59)) | set(range(60,121,4)))
            # 600ms anticipation, 300ms readable chop, 600ms follow-through/recovery.
            # Retiming only: all original poses and their order remain unchanged.
            times = [float(np.interp(i,[0,49,58,121],[0,600,900,1500])) for i in indices]
            start,end,duration = 0,121,1500
        else:
            # Preserve kneel/fall and settled corpse; omit only redundant final still tail.
            indices = sorted(set(range(0,73,3)) | set(range(45,65)))
            times = [i/24*1000 for i in indices]
            start,end,duration = 0,73,73/24*1000
        selected[action] = dict(sourceVideo=VIDEOS[action].relative_to(ROOT).as_posix(),
            sourceFrameIndices=indices, keyTimesMs=times, durationMs=duration,
            sourceFps=24, sourceStartFrame=start, sourceEndExclusive=end,
            mode='loop' if action in ('idle','walking') else 'one-shot',
            cycleCandidates=candidates[:5],
            timingPolicy='Attack: source f0/49/58/121 map to 0/600/900/1500ms; other states retain source time. No pose changes.')
        print(action, json.dumps(selected[action],ensure_ascii=False),flush=True)
    write(BUILD/'selection.json', selected)


def clean(rgb, alpha):
    alpha = np.asarray(alpha, dtype=np.uint8)
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha,(rgb.shape[1],rgb.shape[0]))
    count,labels,stats,_ = cv2.connectedComponentsWithStats((alpha>24).astype(np.uint8),8)
    main = 1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))
    main_mask = labels==main
    distance = distance_transform_edt(~main_mask)
    keep = main_mask.copy()
    # Keep nearby chain links / blade pieces; remove isolated background logo components.
    for label in range(1,count):
        mask = labels==label
        if stats[label,cv2.CC_STAT_AREA] >= 12 and float(distance[mask].min()) <= 35:
            keep |= mask
    keep = cv2.dilate(keep.astype(np.uint8),np.ones((3,3),np.uint8))>0
    alpha = np.where(keep,alpha,0).astype(np.uint8)
    opaque = alpha>=224
    _,nearest = distance_transform_edt(~opaque, return_indices=True)
    output = rgb.copy()
    edge = (alpha>0)&~opaque
    output[edge] = rgb[nearest[0][edge],nearest[1][edge]]
    output[alpha==0]=0
    return np.dstack((output,alpha))


def cutouts(reference_only=False):
    sys.path.insert(0,str(TOOLS))
    from rmbg_cutout import get_model,predict_alpha
    model = get_model()
    selected = json.loads((BUILD/'selection.json').read_text(encoding='utf-8'))
    reference_tiles=[]
    for action in ACTIONS:
        imgs = frames(action)
        indices = [0] if reference_only else sorted(set(selected[action]['sourceFrameIndices'])|{0})
        for n,index in enumerate(indices):
            path=BUILD/'cutouts'/action/f'f{index:03d}.png'
            if not path.exists():
                rgba=clean(np.asarray(imgs[index]),predict_alpha(model,imgs[index]))
                path.parent.mkdir(parents=True,exist_ok=True)
                Image.fromarray(rgba).save(path)
            if n%8==0 or n==len(indices)-1:
                print(f'[BiRefNet] {action} {n+1}/{len(indices)}',flush=True)
        ref=Image.open(BUILD/'cutouts'/action/'f000.png').convert('RGBA')
        box=ref.getbbox()
        print('[reference]',action,box,flush=True)
        tile=Image.new('RGB',(640,390),(45,48,54))
        tile.paste(packing.checker(np.asarray(ref.resize((640,360)))),(0,25))
        ImageDraw.Draw(tile).text((12,8),f'{action} f0 | bbox {box}',fill='white')
        reference_tiles.append(tile)
    contact=Image.new('RGB',(1280,780))
    for i,tile in enumerate(reference_tiles):contact.paste(tile,((i%2)*640,(i//2)*390))
    contact.save(BUILD/'camera-reference.png')


def resample_key(path, matrix, size):
    rgba = np.asarray(Image.open(path).convert('RGBA'))
    # Suppress the source video's fine red/green chroma bands; retain luma and alpha.
    ycc = cv2.cvtColor(rgba[...,:3], cv2.COLOR_RGB2YCrCb)
    for channel in (1, 2):
        ycc[...,channel] = cv2.GaussianBlur(ycc[...,channel], (0,0), 3.2)
    rgb = cv2.cvtColor(ycc, cv2.COLOR_YCrCb2RGB).astype(np.float32)
    alpha = rgba[...,3].astype(np.float32)/255
    premult = cv2.warpAffine(rgb*alpha[...,None], matrix, size, flags=cv2.INTER_LANCZOS4)
    warped_alpha = cv2.warpAffine(alpha, matrix, size, flags=cv2.INTER_LANCZOS4)
    rgb_out = np.clip(np.rint(premult/np.maximum(warped_alpha[...,None],1e-6)),0,255).astype(np.uint8)
    # Use the original uint8 alpha resampling exactly, preserving all existing cell bounds.
    alpha_out = cv2.warpAffine(rgba[...,3], matrix, size, flags=cv2.INTER_LANCZOS4)
    rgb_out[alpha_out==0]=0
    return np.dstack((rgb_out,alpha_out))


def compose():
    selected=json.loads((BUILD/'selection.json').read_text(encoding='utf-8'))
    calibration=json.loads((BUILD/'calibration.json').read_text(encoding='utf-8'))
    records=[]
    for action in ACTIONS:
        s,c=selected[action],calibration['actions'][action]
        scale=calibration['preparedBodyHeightPx']/c['bodyHeightPx']
        source_size=(round(1280*scale),round(720*scale))
        # Single scalar, including rounding, applied uniformly to X and Y by affine resize.
        matrix=np.array([[scale,0,0],[0,scale,0]],np.float32)
        imgs=[resample_key(BUILD/'cutouts'/action/f'f{i:03d}.png',matrix,source_size) for i in s['sourceFrameIndices']]
        boxes=[Image.fromarray(img).getbbox() for img in imgs]
        rootx=c['rootX']*scale
        radius=math.ceil(max(max(rootx-box[0],box[2]-rootx) for box in boxes))+10
        left=round(rootx)-radius
        top=min(box[1] for box in boxes)-10
        bottom=max(box[3] for box in boxes)+10
        width,height=radius*2,bottom-top
        cells=[]
        for img in imgs:
            cell=np.zeros((height,width,4),np.uint8)
            sx0,sy0,sx1,sy1=max(0,left),max(0,top),min(source_size[0],left+width),min(source_size[1],bottom)
            cell[sy0-top:sy1-top,sx0-left:sx1-left]=img[sy0:sy1,sx0:sx1]
            cell[cell[...,3]==0,:3]=0
            cells.append(cell)
        count=len(cells)*2-(s['mode']=='one-shot')
        incols,inrows=packing.layout(len(cells),width,height)
        outcols,outrows=packing.layout(count,width,height)
        sheet=BUILD/'source-sheets'/f'{action}.png'
        packing.pack(cells,incols,sheet)
        times=s['keyTimesMs']
        durations=[]
        for i,t in enumerate(times):
            interval=(times[i+1] if i+1<len(times) else s['durationMs'])-t
            durations.extend([interval/2,interval/2] if i+1<len(times) or s['mode']=='loop' else [interval])
        rec={**s,'sourceScale':scale,'sourceRootX':c['rootX'],'sourceGroundY':c['groundY'],
             'sourceSheet':sheet.relative_to(ROOT).as_posix(),'sourceCols':incols,'sourceKeyCount':len(cells),
             'frameWidth':width,'frameHeight':height,'frameCount':count,'endFrame':count-1,
             'cols':outcols,'rows':outrows,'footX':width/2,'footY':c['groundY']*scale-top,
             'cropScaled':[left,top,left+width,bottom],'frameDurationsMs':durations,
             'outputFps':count/(s['durationMs']/1000),'rgbaMiB':width*height*outcols*outrows*4/1048576}
        if action=='attacking':
            rec['contactSourceFrame']=56
            rec['contactFrame']=2*s['sourceFrameIndices'].index(56)
            rec['contactMs']=sum(durations[:rec['contactFrame']])
        state={'walking':'walk','attacking':'attack','dying':'death'}.get(action,action)
        rec['sheet']=f'../../../../../assets/enemies/stitchface_headsman/{state}.png'
        rec['textureKey']=f'enemy_stitchface_headsman_{state}'
        records.append(dict(action=action,**rec))
        print('[compose]',action,width,height,count,round(rec['rgbaMiB'],3),'MiB',flush=True)
    total=sum(r['rgbaMiB'] for r in records)
    if total>64:raise RuntimeError(f'Elite target budget exceeded: {total} MiB')
    previous=json.loads((BUILD/'manifest.json').read_text(encoding='utf-8')) if (BUILD/'manifest.json').exists() else {}
    write(BUILD/'manifest.json',dict(**{k:v for k,v in previous.items() if k not in ['actor','sourceApproval','transformPolicy','calibration','rgbaMiB','targetMiB','testsRun','runtimeVerified','actions']},actor='stitchfaceHeadsman',sourceApproval='User: 可用继续 (walking v06)',
        transformPolicy='Fixed uniform camera scale per video calibrated from standing body; fixed foot root and symmetric action crop; no per-frame centering or vertical correction.',
        calibration=calibration,rgbaMiB=total,targetMiB=64,testsRun=False,runtimeVerified=False,actions=records))


def interpolate():
    manifest=json.loads((BUILD/'manifest.json').read_text(encoding='utf-8'))
    for r in manifest['actions']:
        action=r['action']; target=(ROOT/r['sheet']).resolve(); report=BUILD/'reports'/f'{action}-rife.json'
        report.parent.mkdir(parents=True,exist_ok=True)
        cmd=[sys.executable,'-X','utf8',str(ROOT/'producer/rife-spritesheet-interpolate.py'),'--sheet',str(ROOT/r['sourceSheet']),
             '--rife',str(TOOLS.parents[2]/'_tmp/elise_audit/rife/rife-ncnn-vulkan-20221029-windows/rife-ncnn-vulkan.exe'),
             '--out',str(target),'--name',f'stitchface-headsman-{action}','--frame-width',str(r['frameWidth']),
             '--frame-height',str(r['frameHeight']),'--cols',str(r['sourceCols']),'--frame-count',str(r['sourceKeyCount']),
             '--frame-rate',str(r['outputFps']/2),'--mode',r['mode'],'--out-cols',str(r['cols']),
             '--preview-dir',str(BUILD/'previews/rife'),'--report',str(report),'--repair-red-outliers','--preserve-vertical-motion']
        print('[RIFE begin]',action,flush=True)
        with report.with_suffix('.log').open('w',encoding='utf-8') as log:subprocess.run(cmd,check=True,stdout=log,stderr=subprocess.STDOUT)
        print('[RIFE complete]',action,flush=True)


def finish():
    manifest=json.loads((BUILD/'manifest.json').read_text(encoding='utf-8'))
    sequences={}
    for r in manifest['actions']:
        a=r['action'];sheet=(ROOT/r['sheet']).resolve()
        img=np.asarray(Image.open(sheet).convert('RGBA'));w,h,cols=r['frameWidth'],r['frameHeight'],r['cols']
        cells=[img[i//cols*h:(i//cols+1)*h,i%cols*w:(i%cols+1)*w].copy() for i in range(r['frameCount'])]
        sequences[a]=cells
        gif=BUILD/'previews/final'/f'{a}.gif'
        r['gifDurationMs']=packing.save_preview(cells,r['frameDurationsMs'],gif)
        r['gif']=gif.relative_to(ROOT).as_posix()
    panels=[]
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18)
    labels=dict(idle='待机',walking='移动 v06',attacking='蓄力斩骨',dying='死亡')
    for n in range(96):
        panel=Image.new('RGB',(720,640),(28,31,37));draw=ImageDraw.Draw(panel)
        for k,r in enumerate(manifest['actions']):
            a=r['action'];t=n/24*1000
            if r['mode']=='loop':t%=r['durationMs']
            else:t=min(t,r['durationMs']-1e-6)
            index=int(np.searchsorted(np.cumsum(r['frameDurationsMs']),t,side='right'))
            cell=sequences[a][index];x=k%2*360;y=k//2*320
            tile=packing.checker(cell);px=x+180-round(r['footX']);py=y+250-round(r['footY'])
            panel.paste(tile,(px,py));draw.text((x+12,y+8),labels[a],font=font,fill='white')
            draw.text((x+12,y+298),f'{r["frameCount"]} 帧 / {r["durationMs"]/1000:.3f}s',font=font,fill=(190,196,210))
        panels.append(panel)
    overview=BUILD/'previews/final/four-actions-overview.gif'
    panels[0].save(overview,save_all=True,append_images=panels[1:],duration=packing.gif_durations([1000/24]*96),loop=0,optimize=False)
    write(BUILD/'manifest.json',manifest)
    print('[finish]',overview,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('stage',nargs='?',default='rebuild',choices=['prepare','references','cutouts','compose','interpolate','finish','rebuild']);args=parser.parse_args()
    if args.stage=='references':cutouts(True)
    elif args.stage=='rebuild':
        interpolate()
        finish()
    else:globals()[args.stage]()
