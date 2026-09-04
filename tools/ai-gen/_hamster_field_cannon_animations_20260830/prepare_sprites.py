"""Extract production references and record the fixed sprite transform."""
import json
from pathlib import Path
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
for folder in ('cache/source-frames', 'source-sheets', 'final', 'previews'):
    (ROOT/folder).mkdir(parents=True, exist_ok=True)
index = json.loads((ROOT/'task-index.json').read_text(encoding='utf-8-sig'))
for kind, action in index['actions'].items():
    if action['userAcceptance']['sourceVideo'] != action['sourceVideo']:
        raise SystemExit(f'Unaccepted source: {kind}')
    video = cv2.VideoCapture(str(ROOT/action['sourceVideo']))
    frames = []
    while True:
        ok, bgr = video.read()
        if not ok:
            break
        frames.append(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    video.release()
    if kind == 'idle':
        frames[0].save(ROOT/'cache/source-frames/idle-0000.png')
    if kind not in ('attack', 'die'):
        continue
    selected = list(range(52,65)) if kind == 'attack' else list(range(36,59,2))
    width, height = 384, 216
    rows = (len(selected)+3)//4
    contact = Image.new('RGB', (width*4, (height+22)*rows), '#20242a')
    draw = ImageDraw.Draw(contact)
    for j,i in enumerate(selected):
        frames[i].save(ROOT/f'cache/source-frames/{kind}-{i:04}.png')
        x, y = j%4*width, j//4*(height+22)
        contact.paste(frames[i].resize((width,height)), (x,y+22))
        draw.text((x+5,y+4), f'{kind} source {i} / {i/24:.3f}s', fill='white')
    contact.save(ROOT/f'previews/{kind}-source-detail.png')
plan = {
    'unitKey': 'hamster_field_cannon_crew', 'profile': 'crowd',
    'sourceScale': 0.35, 'anchorInVideo': [512,450],
    'anchorMeaning': 'Fixed art-space ground anchor just below the reference wheels, not runtime placement/collision calibration.',
    'sourceSelection': 'Whole 124-frame span: every fourth source frame for slow motion; all native poses in discharge/recoil and falling phases, plus final one-shot pose.',
    'allActionsShareTransform': True, 'perFrameRecentering': False,
    'referenceCell': 512, 'runtimeScale': None,
    'viewPlanning': {'referenceUnit': 'hamster_catapult_crew',
                     'referenceDisplaySize': 345.6,
                     'hamsterBodyPixelHeightAtSourceApprox': 280,
                     'hamsterBodyPixelHeightAtSpriteApprox': 98,
                     'normalViewPlannedBodyPixels': 70,
                     'maximumViewPlannedBodyPixels': 105,
                     'runtimeCalibrationPending': True},
    'targetMiB': 32, 'admissionLimitMiB': 64,
    'provisionalSheetEstimateMiB': [45,64],
    'productionStatus': 'prepared', 'formalBudgetCheckRun': False,
    'sourceAcceptancePreserved': True, 'runtimeIntegrationActive': False,
    'effects': 'Retain accepted muzzle flash and smoke to the extent present in the source; source right-edge clipping must remain documented, never regenerate the accepted motion.'
}
(ROOT/'sprite-production-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Prepared fixed transform and source detail sheets.', flush=True)
