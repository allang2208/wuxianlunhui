"""Append authorized H3 recovery source keys, preserving the complete attack v02.

keys: local BiRefNet cutout and unsmoothed composite keys.
interpolate: existing 2x RIFE tool, with its Python environment.
package: candidate manifest/GIF only. import: replace only the howitzer attack.
"""
import argparse
import copy
import importlib.util
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
FAMILY=ROOT.parent/'_hamster_howitzer_animations_20260830'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v): p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def production():
    spec=importlib.util.spec_from_file_location('howitzer_production',FAMILY/'make_sprites.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def snapshot():
    base=ROOT/'before-resupply'
    base.mkdir(exist_ok=True)
    for src in ['source-sheets/attack-keys.json','source-sheets/attack-keys.png',
                'spritesheet-manifest.json','final/attack.png','final/attack-rife.json']:
        target=base/Path(src).name
        if not target.exists(): shutil.copy2(FAMILY/src,target)
    target=base/'hamster-howitzer-crew-config.json'
    if not target.exists(): shutil.copy2(REPO/'data/hamster-howitzer-crew-config.json',target)
    return base

def keys():
    p=production();base=snapshot()
    old=read(base/'attack-keys.json')
    original_sheet=Image.open(base/'attack-keys.png').convert('RGBA')
    frames,fps=p.read_video(ROOT/'resupply-v01.mp4')
    indices=sorted(set(range(0,len(frames),4))|{len(frames)-1})
    cache=ROOT/'cache/resupply';cache.mkdir(parents=True,exist_ok=True)
    sys.path.insert(0,str(ROOT.parent))
    from rmbg_cutout import get_model,predict_alpha
    model=None;new=[]
    for i in indices:
        path=cache/f'{i:04d}.png'
        if path.exists(): cut=Image.open(path).convert('RGBA')
        else:
            if model is None: model=get_model()
            alpha=np.asarray(predict_alpha(model,frames[i]),dtype=np.uint8)
            alpha[alpha<4]=0
            rgba=np.dstack([np.asarray(frames[i]),alpha]);rgba[alpha==0,:3]=0
            cut=Image.fromarray(rgba);cut.save(path)
        cut=p.remove_white_matte(cut)
        cut=cut.resize(tuple(round(v*p.SCALE) for v in cut.size),Image.Resampling.LANCZOS)
        rgba=np.array(cut);rgba[rgba[...,3]<4]=0
        new.append(Image.fromarray(rgba))
        print('resupply source key',i,flush=True)
    bounds=[im.getchannel('A').getbbox() for im in new]
    center=round(p.ANCHOR[0]*p.SCALE);old_crop=old['actionCropInScaledCanvas']
    radius=max(center-old_crop[0],max(max(center-b[0],b[2]-center)+3 for b in bounds))
    crop=(center-radius,min(old_crop[1],min(b[1] for b in bounds)-3),
          center+radius,max(old_crop[3],max(b[3] for b in bounds)+3))
    size=(crop[2]-crop[0],crop[3]-crop[1]);cells=[]
    for i in range(old['frameCount']):
        w,h=old['frameWidth'],old['frameHeight'];cols=old['cols']
        cell=original_sheet.crop((i%cols*w,i//cols*h,(i%cols+1)*w,(i//cols+1)*h))
        target=Image.new('RGBA',size)
        target.paste(cell,(old_crop[0]-crop[0],old_crop[1]-crop[1]))
        cells.append(target)
    cells.extend(im.crop(crop) for im in new)
    count=len(cells);w,h=size;cols=p.layout(count,w,h)
    output_count=2*count-1;output_cols=p.layout(output_count,w,h)
    other=read(base/'spritesheet-manifest.json')
    other_bytes=sum(a['decodedMiB'] for k,a in other['actions'].items() if k!='attack')+other['projectile']['decodedMiB']
    estimate=other_bytes+output_cols*w*math.ceil(output_count/output_cols)*h*4/1024**2
    if estimate>64: raise ValueError(f'Proposed complete family {estimate:.3f} MiB exceeds 64; no runtime write')
    p.sheet_from(cells,cols).save(ROOT/'attack-resupplied-keys.png')
    durations=old['sourceDurationsMs']+[(b-a)/fps*1000 for a,b in zip(indices,indices[1:]+[len(frames)])]
    meta={**old,'sourceSegments':[
        {'video':old['video'],'promptId':old['promptId'],'sourceFrames':old['sourceFrames'],
         'sourceFrameIndices':old['sourceFrameIndices'],'startMs':0,'durationMs':old['durationMs']},
        {'video':'../_engineering_line_completion_20260830/resupply-v01.mp4',
         'provenance':'../_engineering_line_completion_20260830/resupply-v01.mp4.json',
         'sourceFrames':len(frames),'sourceFrameIndices':indices,'startMs':old['durationMs'],'durationMs':len(frames)/fps*1000}],
        'sourceFrameIndices':old['sourceFrameIndices']+[old['sourceFrames']+i for i in indices],
        'sourceFrames':old['sourceFrames']+len(frames),'sourceDurationsMs':durations,
        'durationMs':sum(durations),'frameCount':count,'frameWidth':w,'frameHeight':h,
        'cols':cols,'rows':math.ceil(count/cols),'actionCropInScaledCanvas':list(crop),
        'footX':center-crop[0],'footY':p.ANCHOR[1]*p.SCALE-crop[1],
        'sourceSheet':'source-sheets/attack-keys.png','resupplyStartMs':old['durationMs'],
        'resupplyStartOutputFrame':old['frameCount']*2,'estimatedFamilyMiB':estimate,
        'resupplyProvenance':'../_engineering_line_completion_20260830/resupply-production.json'}
    write(ROOT/'attack-resupplied-keys.json',meta)
    p.contact(cells[-len(new):],'resupply',ROOT/'resupply-keys-contact.png',indices)
    print('Composite keys',count,'output frames',output_count,'size',size,'family MiB',estimate,flush=True)

def interpolate():
    p=production();m=read(ROOT/'attack-resupplied-keys.json')
    cmd=[sys.executable,str(ROOT.parent/'rife-spritesheet-interpolate.py'),
        '--sheet',str(ROOT/'attack-resupplied-keys.png'),'--out',str(ROOT/'attack-resupplied.png'),
        '--name','howitzer-attack-resupplied','--frame-width',str(m['frameWidth']),
        '--frame-height',str(m['frameHeight']),'--cols',str(m['cols']),'--frame-count',str(m['frameCount']),
        '--frame-rate','6','--mode','one-shot','--out-cols',str(p.layout(m['frameCount']*2-1,m['frameWidth'],m['frameHeight'])),
        '--preview-dir',str(ROOT/'cache/rife'),'--report',str(ROOT/'attack-resupplied-rife.json'),
        '--repair-red-outliers','--preserve-vertical-motion']
    with (ROOT/'resupply-rife.log').open('w',encoding='utf-8') as log:
        subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,check=True)

def package():
    p=production();meta=read(ROOT/'attack-resupplied-keys.json');r=read(ROOT/'attack-resupplied-rife.json')
    m=read(ROOT/'before-resupply/spritesheet-manifest.json')
    sheet=Image.open(ROOT/'attack-resupplied.png').convert('RGBA');w,h=meta['frameWidth'],meta['frameHeight']
    cols=r['cols'];count=r['outputFrameCount'];durations=[]
    for i,d in enumerate(meta['sourceDurationsMs']): durations.extend([d/2,d/2] if i<meta['frameCount']-1 else [d])
    a={**m['actions']['attack'],**meta,'frameCount':count,'endFrame':count-1,'cols':cols,'rows':r['rows'],
        'sheetSize':list(sheet.size),'decodedMiB':sheet.width*sheet.height*4/1024**2,
        'frameDurationsMs':durations,'preview':'previews/attack-resupplied.gif'}
    m['actions']['attack']=a;m['decodedMiB']=sum(x['decodedMiB'] for x in m['actions'].values())+m['projectile']['decodedMiB']
    if m['decodedMiB']>64: raise ValueError('Complete family exceeds 64 MiB; no runtime write')
    m['knownSourceLimits']=[];m['resupplyCompleted']=True
    m['status']='resupply_candidate_ready';m['runtimeIntegrationActive']=False
    write(ROOT/'resupplied-manifest.json',m)
    cells=[sheet.crop((i%cols*w,i//cols*h,(i%cols+1)*w,(i//cols+1)*h)) for i in range(count)]
    images=[p.checker(c).resize((w*2,h*2),Image.Resampling.NEAREST) for c in cells]
    colors=Image.new('RGB',(128,72*len(images)))
    for i,im in enumerate(images): colors.paste(im.resize((128,72)),(0,72*i))
    palette=colors.quantize(colors=255);images=[im.quantize(palette=palette) for im in images]
    images[0].save(ROOT/'attack-resupplied.gif',save_all=True,append_images=images[1:],duration=p.gif_durations(durations),loop=0,disposal=2,optimize=False)
    p.contact(cells,'attack-resupplied',ROOT/'attack-resupplied-contact.png')
    p.contact(cells[a['resupplyStartOutputFrame']:],'resupply',ROOT/'resupply-final-contact.png')
    print('Packaged',count,'frames',a['durationMs'],'ms',m['decodedMiB'],'MiB',flush=True)

def import_runtime():
    m=read(ROOT/'resupplied-manifest.json');a=m['actions']['attack']
    for src,dest in [('attack-resupplied.png','final/attack.png'),('attack-resupplied-rife.json','final/attack-rife.json'),
                     ('attack-resupplied-keys.png','source-sheets/attack-keys.png'),('attack-resupplied-keys.json','source-sheets/attack-keys.json'),
                     ('attack-resupplied.gif','previews/attack-resupplied.gif')]: shutil.copy2(ROOT/src,FAMILY/dest)
    shutil.copy2(ROOT/'attack-resupplied.png',REPO/a['runtimePath'])
    cfg_path=REPO/'data/hamster-howitzer-crew-config.json';cfg=read(cfg_path)
    cfg['animations']['attack']={'src':a['runtimePath'],
        **{k:a[k] for k in ['frameWidth','frameHeight','cols','rows','frameCount','footX','footY']},
        'frames':[0,a['endFrame']],'frameRate':a['frameCount']*1000/a['durationMs'],
        'frameDurations':a['frameDurationsMs'],'durationMs':a['durationMs'],'repeat':0}
    write(cfg_path,cfg)
    m.update(status='imported_pending_user_runtime_test',runtimeIntegrationActive=True)
    a['runtimeIntegrationActive']=True;write(FAMILY/'spritesheet-manifest.json',m)
    budget=read(FAMILY/'sprite-budget-manifest.json')
    entry=next(e for e in budget['sheets'] if e['textureKey']=='companion_hamster_howitzer_crew_attack')
    entry.update({k:a[k] for k in ['frameWidth','frameHeight','frameCount','endFrame']});write(FAMILY/'sprite-budget-manifest.json',budget)
    for name in ['task-index.json','sprite-production-plan.json']:
        data=read(FAMILY/name);data.update(resupplyCompleted=True,completionRecord='../_engineering_line_completion_20260830/RESUPPLY-DELIVERY.md')
        if name=='task-index.json':
            data['budget']['actualDecodedMiB']=m['decodedMiB']
            data['actions']['attack']['transparentPreview']=a['preview']
        else: data['actualDecodedMiB']=m['decodedMiB']
        write(FAMILY/name,data)
    selection=read(FAMILY/'runtime-source-selection.json')
    selection['actions']['attack']['sourceSegments']=a['sourceSegments']
    selection['actions']['attack']['activeCompositeManifest']='spritesheet-manifest.json'
    write(FAMILY/'runtime-source-selection.json',selection)
    record=read(ROOT/'resupply-production.json')
    record.update(status='imported_pending_user_runtime_test',runtimeIntegrationActive=True,
        sourceSegments=a['sourceSegments'],outputFrameCount=a['frameCount'],durationMs=a['durationMs'],decodedFamilyMiB=m['decodedMiB'],
        visualReview='Source and sprite contact sheets reviewed for two crew, quiet resupply and stable cannon; user runtime acceptance pending.')
    write(ROOT/'resupply-production.json',record)
    print('Imported resupply; original firing and sound times, other three actions and base 10s cooldown unchanged.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('stage',choices=['keys','interpolate','package','import'])
    stage=parser.parse_args().stage
    {'keys':keys,'interpolate':interpolate,'package':package,'import':import_runtime}[stage]()
