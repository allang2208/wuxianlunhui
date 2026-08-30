"""Select user-approved sources and prepare fixed-transform sprite production."""
import json
from pathlib import Path
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

index = json.loads((ROOT/'task-index.json').read_text(encoding='utf-8-sig'))
selected = {}
for kind, revision in [('idle','v01'),('run','v01'),('attack','v02'),('die','v04')]:
    source = index if revision == 'v01' else json.loads((ROOT/f'{kind}-{revision}-index.json').read_text(encoding='utf-8-sig'))
    action = dict(source['actions'][kind])
    action['revision'] = revision
    action['userAcceptance'] = {'sourceVideo':action['sourceVideo'], 'promptId':action['promptId'],
        'message':'可用，接入游戏', 'scope':'Current howitzer set selected for integration; latest death v04 explicitly accepted.'}
    selected[kind] = action
    if revision != 'v01':
        source['actions'][kind]['userAcceptance'] = action['userAcceptance']
        source['visualAcceptance'] = 'accepted_for_game_integration'
        write(ROOT/f'{kind}-{revision}-index.json',source)
write(ROOT/'runtime-source-selection.json', {'unitKey':'hamster_howitzer_crew', 'actions':selected,
    'approval':'可用，接入游戏','preserveRejectedCandidates':True,'runtimeIntegrationActive':False})
write(ROOT/'sprite-production-plan.json', {
    'unitKey':'hamster_howitzer_crew','profile':'crowd','sourceScale':0.31,'anchorInVideo':[512,420],
    'referenceCell':512, 'allActionsShareTransform':True, 'perFrameRecentering':False,
    'targetMiB':32,'admissionLimitMiB':64,'provisionalSheetEstimateMiB':[48,63],
    'viewPlanning':{'referenceUnit':'hamster_priest','normalViewPlannedBodyPixels':75.684,
        'maximumViewPlannedBodyPixels':113.526,'hamsterBodySourcePixelsApprox':260,
        'hamsterBodySpritePixelsApprox':80.6,'runtimeCalibrationPending':True},
    'sourceSelection':'Full source durations; step4 slow keys, native discharge and fall poses, step2 reload poses.',
    'sourceAcceptancePreserved':True,'runtimeIntegrationActive':False,'formalBudgetCheckRun':False})
for folder in ['source-sheets','final','cache/source-frames','previews','logs']:
    (ROOT/folder).mkdir(parents=True,exist_ok=True)
cap = cv2.VideoCapture(str(ROOT/'videos/attack-v02.mp4'))
page = Image.new('RGB',(1024, (192+20)*4),'#20242a')
draw = ImageDraw.Draw(page)
for n,i in enumerate(range(52,68)):
    cap.set(cv2.CAP_PROP_POS_FRAMES,i)
    ok,bgr = cap.read()
    if not ok: raise RuntimeError(f'Missing frame {i}')
    frame = Image.fromarray(cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB))
    frame.save(ROOT/f'cache/source-frames/attack-{i:04}.png')
    x,y = n%4*256,n//4*212
    page.paste(frame.resize((256,144)),(x,y+20))
    draw.text((x+5,y+3),f'source {i} / {i/24:.3f}s',fill='white')
cap.release()
page.save(ROOT/'previews/attack-release-source-contact.png')
print('Selected idle v01 / run v01 / attack v02 / die v04; prepared source contact and budget plan.')
