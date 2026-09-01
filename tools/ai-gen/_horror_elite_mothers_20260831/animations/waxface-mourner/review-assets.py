"""Explicitly requested offline animation review. Never loads game modules."""
from pathlib import Path
import json
import subprocess
import sys
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[4]
BUILD=ROOT/'sprite-build-v01'
OUT=BUILD/'review-20260831'
manifest=json.loads((BUILD/'manifest.json').read_text(encoding='utf-8'))
configs=[json.loads((REPO/p).read_text(encoding='utf-8'))['waxfaceMourner'] for p in ['data/enemy-config.json','public/data/enemy-config.json']]
OUT.mkdir(parents=True, exist_ok=True)
errors=[];records=[]
if configs[0]!=configs[1]:errors.append('runtime config copies disagree')
state_map={'idle':'idle','walking':'walk','attacking':'attack','dying':'death'}
panels=[]
for r in manifest['actions']:
    state=state_map[r['action']];layout=configs[0]['textures']['frameLayouts'][state]
    png=Image.open(ROOT/r['sheet']);sheet=np.asarray(png.convert('RGBA'))
    keys=np.asarray(Image.open(ROOT/r['sourceSheet']).convert('RGBA'))
    w,h,cols=r['frameWidth'],r['frameHeight'],r['cols']
    bad=[];margins=[];cells=[]
    if png.mode!='RGBA' or png.size!=(cols*w,r['rows']*h):bad.append('PNG mode or dimensions')
    for i in range(r['frameCount']):
        cell=sheet[i//cols*h:(i//cols+1)*h,i%cols*w:(i%cols+1)*w]
        cells.append(cell)
        ys,xs=np.nonzero(cell[...,3])
        if not len(xs):bad.append(f'empty frame {i}');continue
        margins.append(min(xs.min(),ys.min(),w-1-xs.max(),h-1-ys.max()))
        if np.any(cell[...,:3][cell[...,3]==0]):bad.append(f'transparent RGB {i}')
        if i%2==0:
            j=i//2;c=r['sourceCols']
            key=keys[j//c*h:(j//c+1)*h,j%c*w:(j%c+1)*w]
            if not np.array_equal(cell,key):bad.append(f'RIFE key changed {i}')
    before=OUT/'before/source-sheets'/f'{r["action"]}.png'
    same_alpha=None
    if before.exists():
        old=np.asarray(Image.open(before).convert('RGBA'))
        same_alpha=old.shape==keys.shape and np.array_equal(old[...,3],keys[...,3])
        if not same_alpha:bad.append('source alpha/pose changed during color repair')
    if min(margins)<2:bad.append('transparent safety margin < 2px')
    if layout['frameDurations']!=r['frameDurationsMs'] or layout['frameCount']!=r['frameCount']:bad.append('runtime clock differs')
    gif=Image.open(ROOT/r['gif']);durations=[]
    for i in range(gif.n_frames):gif.seek(i);durations.append(gif.info.get('duration',0))
    if min(durations)<20 or abs(sum(durations)-r['durationMs'])>5.001:bad.append('GIF clock invalid')
    if not (ROOT/r['sourceVideo']).exists() or not (ROOT/(r['sourceVideo']+'.json')).exists():bad.append('source/provenance missing')
    report=json.loads((BUILD/'reports'/f'{r["action"]}-rife.json').read_text(encoding='utf-8'))['validation']
    for k in ['emptyFrames','touchingFrames','middleFrameHeldSourceKeyFallbacks','visibleDarkOutlierFrames','visibleRedOutlierFrames']:
        if report.get(k):bad.append(f'RIFE {k}')
    records.append(dict(action=r['action'],frames=r['frameCount'],minimumMargin=int(min(margins)),
        sourceAlphaUnchanged=same_alpha,gifMinimumMs=min(durations),gifTotalMs=sum(durations),durationMs=r['durationMs'],errors=bad))
    errors.extend(f'{r["action"]}: {b}' for b in bad)
    # Every valid frame, with explicit indices, for offline visual reading.
    contact=Image.new('RGB',(w*10,(h+18)*int(np.ceil(len(cells)/10))),(39,43,50));draw=ImageDraw.Draw(contact)
    for i,cell in enumerate(cells):
        im=Image.fromarray(cell);x=i%10*w;y=i//10*(h+18)
        contact.paste(im,(x,y+18),im);draw.text((x+4,y+2),str(i),fill='white')
    contact.save(OUT/f'{r["action"]}-all-frames.png')
attack=next(r for r in manifest['actions'] if r['action']=='attacking')
event=sum(attack['frameDurationsMs'][:attack['contactFrame']])
if abs(event-configs[0]['attackSkills']['primary']['eventMs'])>1e-5:errors.append('event time mismatch')
budget=subprocess.run([sys.executable,'-X','utf8',str(REPO/'tools/ai-gen/check-character-sprite-budget.py'),str(ROOT/'sprite-budget-manifest.json')],capture_output=True,text=True,encoding='utf-8')
budget_report=json.loads(budget.stdout)
(OUT/'budget-report.json').write_text(budget.stdout,encoding='utf-8')
if not budget_report['budgetPassed']:errors.extend(budget_report['errors'])
result=dict(scope='User requested offline sprite/workflow review, no game modules or runtime tests',
    passed=not errors,errors=errors,actions=records,releaseFrame=attack['contactFrame'],releaseMs=event,
    budgetPassed=budget_report['budgetPassed'],runtimeVerified=False,gameTestsRun=False)
(OUT/'asset-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
sys.exit(bool(errors))
