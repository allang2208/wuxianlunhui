"""Import the selected howitzer family; derive animation config from its manifest."""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
UNIT = 'hamster_howitzer_crew'

def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def write(path,value): path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

manifest = read(ROOT/'spritesheet-manifest.json')
scale = 75.684 / (260 * manifest['sourceScale'])
cfg = read(REPO/'data/hamster-catapult-crew-config.json')
cfg.update(id=UNIT,name='仓鼠榴弹炮组',title='载具工厂三级·双人现代火炮',
    desc='两名仓鼠工程师操作牵引榴弹炮。抬炮开火后退壳装弹，以远程抛射压制密集目标；近身敌人进入最小射程时后撤展开。',
    role=UNIT,weaponType='howitzer',baseMaxHp=620,
    baseData={'str':30,'dex':16,'int':8,'con':28,'wis':8,'luck':6},
    sounds={key:f'assets/sounds/friendly/{UNIT}_{key}_video.mp3' for key in ['attack','casing','reload']},
    displaySize=512*scale)
cfg['ai'].update(walkSpeed=60,runSpeed=60,attackInterval=10000,attackDamage=420,
    attackRange=1150,minimumRange=250,engageRange=1350,projectileSpeed=1000,
    arcHeight=100,splashRadius=125,splashFalloff=0.5,expectedExtraTargets=2,
    attackReleaseFrame=manifest['actions']['attack']['keyEvents']['muzzleFlashOutputFrame'],
    attackSoundIsGunshot=True,
    attackSoundEvents=[{'atMs':3960,'key':'casing'},{'atMs':6080,'key':'reload'}])
idle = manifest['actions']['idle']
footOffset = (idle['footY']-idle['frameHeight']/2)*scale
cfg['spriteOffsetY'] = -footOffset
cfg['render'].update(footOffsetY=footOffset,corpseHoldMs=1500,
    projectileReleaseOffsetX=(856-512)*manifest['sourceScale'],
    projectileReleaseHeight=(420-206)*manifest['sourceScale'],
    projectileDisplaySize=28,projectileTipDirection='right')
cfg['animations'] = {}
for a in manifest['actions'].values():
    cfg['animations'][a['runtimeKey']] = {
        'src':a['runtimePath'],**{k:a[k] for k in ['frameWidth','frameHeight','cols','rows','frameCount','footX','footY']},
        'frames':[0,a['endFrame']],'frameRate':a['frameCount']*1000/a['durationMs'],
        'frameDurations':a['frameDurationsMs'],'durationMs':a['durationMs'],
        'repeat':-1 if a['loop'] else 0}
p = manifest['projectile']
cfg['animations']['projectile'] = {'src':p['runtimePath'],
    **{k:p[k] for k in ['frameWidth','frameHeight','cols','rows','frameCount']},
    'frames':[0,0],'frameRate':1,'repeat':0}
runtime = REPO/f'assets/companions/{UNIT}'
runtime.mkdir(parents=True,exist_ok=True)
for a in [*manifest['actions'].values(),p]: shutil.copy2(ROOT/a['sheet'],REPO/a['runtimePath'])
shutil.copy2(ROOT/'final/unit-icon.png',REPO/'assets/ui/unit-icons/hamster-howitzer-crew.png')
write(REPO/'data/hamster-howitzer-crew-config.json',cfg)
manifest.update(status='imported_pending_user_runtime_test',runtimeIntegrationActive=True,
    runtimeScale=scale,displaySize=cfg['displaySize'],
    bodyCalibration={'method':'Manual head-to-sole span of accepted idle source; cannon and shell excluded.',
        'sourceBodyHeight':260,'normalViewBodyPixels':75.684,'maximumPlannedBodyPixels':113.526},
    runtimeConfig='data/hamster-howitzer-crew-config.json',
    uiIcon={'path':'assets/ui/unit-icons/hamster-howitzer-crew.png','size':[256,256],
        'usage':'DOM UI only; not loaded as an additional Phaser texture'})
write(ROOT/'spritesheet-manifest.json',manifest)
budget = read(ROOT/'sprite-budget-manifest.json')
budget['runtimeIntegrationActive'] = True
write(ROOT/'sprite-budget-manifest.json',budget)
selection = read(ROOT/'runtime-source-selection.json')
selection.update(runtimeIntegrationActive=True,runtimeManifest='spritesheet-manifest.json')
write(ROOT/'runtime-source-selection.json',selection)
index = read(ROOT/'task-index.json')
index.update(status='imported_pending_user_runtime_test',runtimeIntegrationActive=True,assetOnly=False,
    activeRuntimeSourceSelection='runtime-source-selection.json',spriteManifest='spritesheet-manifest.json')
index['budget'].update(actualDecodedMiB=manifest['decodedMiB'],runtimeScale=scale)
write(ROOT/'task-index.json',index)
plan = read(ROOT/'sprite-production-plan.json')
plan.update(runtimeIntegrationActive=True,productionStatus='imported_pending_user_runtime_test',runtimeScale=scale)
plan['viewPlanning'].update(hamsterBodySpritePixelsApprox=260*manifest['sourceScale'],runtimeCalibrationPending=False)
write(ROOT/'sprite-production-plan.json',plan)
for kind,revision in [('attack','v02'),('die','v04')]:
    path=ROOT/f'{kind}-{revision}-index.json'
    index=read(path)
    index.update(runtimeIntegrationActive=True,assetOnly=False,status='imported_pending_user_runtime_test',
        runtimeManifest='spritesheet-manifest.json')
    write(path,index)
print(f'Imported {UNIT}: {manifest["decodedMiB"]:.3f} MiB; attack release frame {cfg["ai"]["attackReleaseFrame"]}; no runtime tests.')
