"""Pad the selected modern howitzer mother without repainting or stretching."""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent/'_hamster_engineering_mothers_20260830/mother/hamster_howitzer_crew-mother-v06-infantry-camera.png'
for folder in ('reference','prompts','videos','previews','logs'):
    (ROOT/folder).mkdir(exist_ok=True)
source = Image.open(SOURCE).convert('RGB')
scale = min(800/source.width,460/source.height)
size = tuple(round(v*scale) for v in source.size)
offset = ((1024-size[0])//2,(576-size[1])//2)
canvas = Image.new('RGB',(1024,576),'white')
canvas.paste(source.resize(size,Image.Resampling.LANCZOS),offset)
reference = 'reference/howitzer-v06-padded-1024x576.png'
canvas.save(ROOT/reference)
index = {
    'unitKey':'hamster_howitzer_crew','unitName':'仓鼠榴弹炮组','level':3,'building':'载具工厂',
    'date':'2026-08-30','assetOnly':True,'runtimeIntegrationActive':False,
    'status':'prepared','provider':'h3',
    'mother':SOURCE.relative_to(ROOT.parent).as_posix(),
    'approvalScope':'User requested the next engineering unit after field-cannon sprites. Prepare/generate four H3 video candidates from the previously accepted modern mother; no runtime acceptance inferred.',
    'reference':{'path':reference,'sourceSize':list(source.size),'size':[1024,576],
                 'uniformScale':scale,'offset':list(offset),'repainted':False},
    'viewContract':'Fixed mildly elevated right-facing three-quarter view; two equally sized hamster engineers, one modern howitzer, one held reserve shell.',
    'budget':{'profile':'crowd','targetMiB':32,'admissionLimitMiB':64,
              'runtimeScale':None,'actualDecodedMiB':None,'formalChecksRun':False},
    'generation':{'endpoint':'http://192.168.3.142:8188',
                  'authorization':'Continuation of the requested H3 unit sequence; this new howitzer payload is explicitly identified in the execution approval request.',
                  'size':[1024,576],'frames':124,'fps':24,'steps':20,'candidatesPerAction':1,
                  'uploaded':False,'submitted':False,'generated':False},
    'actions':{kind:{'prompt':f'prompts/{kind}-v01.txt','status':'prepared','seed':830301+i,
                    'loop':kind in ('idle','run'),
                    'actionMode':{'idle':'loop','run':'loop','attack':'recover','die':'one-way'}[kind],
                    'sourceVideo':None,'sourceSheet':None,'finalSheet':None,'preview':None}
               for i,kind in enumerate(('idle','run','attack','die'))},
    'runtimeNotes':['Video candidates only; no source-video acceptance or runtime import inferred.',
                    'One preloaded shot; the loader keeps the visible reserve shell, no duplicated ammunition or reload reset.',
                    'The muzzle brake, shield, wheels and shell proportions stay fixed; recoil is barrel movement along its existing axis.',
                    'No technology, recruitment, combat, balance, save or fixed EXE changes.']
}
path = ROOT/'task-index.json'
if not path.exists():
    path.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(ROOT/reference,flush=True)
