"""Import accepted engineering sprites and action cues; no game/test execution."""
from pathlib import Path
import importlib.util
import json
import shutil
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]

def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def write(path,value): path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def cues():
    mod=load_module('extract_audio',ROOT.parent/'extract-hamster-soldier-audio.py')
    specs=[('field_cannon','attack','attack-v01',2.30,4.25),
           ('field_cannon','walk','run-v01',0.45,0.76),
           ('howitzer','attack','attack-v02',2.11,3.85),
           ('howitzer','casing','attack-v02',3.96,4.25),
           ('howitzer','reload','attack-v02',6.08,7.43)]
    results=[]
    for unit,key,revision,start,end in specs:
        source=ROOT.parent/f'_hamster_{unit}_animations_20260830/videos/{revision}.mp4'
        output=REPO/f'assets/sounds/friendly/hamster_{unit}_crew_{key}_video.mp3'
        clip=mod.prepare_clip(mod.decode_stereo(source),start,end)
        mod.encode_mp3(output,clip)
        results.append({'unit':f'hamster_{unit}_crew','key':key,
            'source':source.relative_to(REPO).as_posix(),'trimSeconds':[start,end],
            'output':output.relative_to(REPO).as_posix(),'durationSeconds':clip.shape[1]/44100,
            'rmsDbfs':mod.dbfs(float(np.sqrt(np.mean(clip**2)))),
            'peakDbfs':mod.dbfs(float(np.max(np.abs(clip))))})
    write(ROOT/'audio-cues.json',{'sources':'Actual videos used by runtime sprite manifests.',
        'method':'100ms level envelope and action timeline; 12ms fades, DC removal, -16dBFS RMS target / -1dBFS ceiling, stereo 44.1kHz MP3.',
        'listeningOrRuntimeTestPerformed':False,'clips':results,
        'excluded':[{'source':'_hamster_howitzer_animations_20260830/videos/run-v01.mp4',
            'reason':'Continuous sound bed; no isolated movement cue suitable for repeated events.'}]})

def portrait(unit):
    folder=ROOT.parent/f'_hamster_{unit}_animations_20260830'
    manifest=read(folder/'spritesheet-manifest.json')
    a=manifest['actions']['idle']
    # First approved sprite pose; retain both crew and complete equipment.
    source=folder/a['sheet']
    im=Image.open(source).convert('RGBA').crop((0,0,a['frameWidth'],a['frameHeight']))
    im=im.crop(im.getbbox())
    im.thumbnail((240,240),Image.Resampling.LANCZOS)
    canvas=Image.new('RGBA',(256,256))
    canvas.alpha_composite(im,((256-im.width)//2,(256-im.height)//2))
    output=REPO/f'assets/ui/unit-icons/hamster-{unit.replace("_","-")}-crew.png'
    canvas.save(output)
    icon={'path':output.relative_to(REPO).as_posix(),'sourceSheet':source.relative_to(REPO).as_posix(),
        'sourceFrame':0,'size':[256,256],'usage':'DOM UI only; not a separate Phaser texture.'}
    manifest['uiIcon']=icon
    write(folder/'spritesheet-manifest.json',manifest)
    return icon

def field_cannon():
    unit='hamster_field_cannon_crew'
    folder=ROOT.parent/'_hamster_field_cannon_animations_20260830'
    manifest=read(folder/'spritesheet-manifest.json')
    scale=75.684/(276*manifest['sourceScale'])
    cfg=read(REPO/'data/hamster-catapult-crew-config.json')
    cfg.update(id=unit,name='仓鼠野战炮组',title='工程工坊二级·双人古典火炮',role=unit,
        desc='两名仓鼠工程师操作青铜野战炮，以铁弹轰击远处密集敌人。近身目标进入最小射程时后撤展开；一次攻击只在炮口闪光时发射一枚铁弹。',
        weaponType='field_cannon',baseMaxHp=480,displaySize=512*scale,
        baseData={'str':25,'dex':16,'int':8,'con':23,'wis':8,'luck':6},
        sounds={'attack':f'assets/sounds/friendly/{unit}_attack_video.mp3',
                'walk':f'assets/sounds/friendly/{unit}_walk_video.mp3','walkInterval':580})
    cfg['ai'].update(walkSpeed=62,runSpeed=62,attackInterval=8000,attackDamage=280,
        attackRange=1000,minimumRange=220,engageRange=1200,projectileSpeed=800,
        arcHeight=80,splashRadius=95,splashFalloff=0.5,expectedExtraTargets=1.5,
        attackSoundIsGunshot=True,
        attackReleaseFrame=manifest['actions']['attack']['keyEvents']['muzzleFlashOutputFrame'])
    idle=manifest['actions']['idle']
    foot=(idle['footY']-idle['frameHeight']/2)*scale
    cfg['spriteOffsetY']=-foot
    cfg['render'].update(footOffsetY=foot,corpseHoldMs=1500,
        projectileReleaseOffsetX=(826-512)*manifest['sourceScale'],
        projectileReleaseHeight=(450-292)*manifest['sourceScale'],projectileDisplaySize=22)
    cfg['animations']={}
    files={'idle':('idle','idle.png'),'run':('walk','running.png'),
           'attack':('attack','attacking.png'),'die':('dying','dying.png')}
    runtime=REPO/f'assets/companions/{unit}'
    runtime.mkdir(parents=True,exist_ok=True)
    for kind,a in manifest['actions'].items():
        key,filename=files[kind]
        a.update(runtimeKey=key,runtimePath=f'assets/companions/{unit}/{filename}',runtimeIntegrationActive=True)
        cfg['animations'][key]={'src':a['runtimePath'],
            **{k:a[k] for k in ['frameWidth','frameHeight','cols','rows','frameCount','footX','footY']},
            'frames':[0,a['endFrame']],'frameRate':a['frameCount']*1000/a['durationMs'],
            'frameDurations':a['frameDurationsMs'],'durationMs':a['durationMs'],'repeat':-1 if a['loop'] else 0}
        shutil.copy2(folder/a['sheet'],REPO/a['runtimePath'])
    projectile={'runtimeKey':'projectile','runtimePath':f'assets/companions/{unit}/iron-ball.svg',
        'frameWidth':64,'frameHeight':64,'cols':1,'rows':1,'frameCount':1,'endFrame':0,
        'decodedMiB':64*64*4/1024**2,'source':'Authored SVG iron sphere; no external or borrowed unit artwork.'}
    cfg['animations']['projectile']={'src':projectile['runtimePath'],
        **{k:projectile[k] for k in ['frameWidth','frameHeight','cols','rows','frameCount']},
        'frames':[0,0],'frameRate':1,'repeat':0}
    manifest.update(projectile=projectile,decodedMiB=sum(a['decodedMiB'] for a in manifest['actions'].values())+projectile['decodedMiB'],
        status='imported_pending_user_runtime_test',assetOnly=False,runtimeIntegrationActive=True,
        runtimeScale=scale,displaySize=cfg['displaySize'],runtimeConfig='data/hamster-field-cannon-crew-config.json',
        bodyCalibration={'sourceBodyHeight':276,'normalViewBodyPixels':75.684,
            'method':'Headwear-to-sole span of left engineer; ramrod, barrel and equipment excluded.'},
        budgetScope='All four action textures plus the 64x64 iron sphere; no dependent unit textures.')
    if manifest['decodedMiB']>64: raise ValueError('Field cannon exceeds crowd admission budget')
    write(REPO/'data/hamster-field-cannon-crew-config.json',cfg)
    write(folder/'spritesheet-manifest.json',manifest)
    update_indexes(folder,manifest)
    print(unit,manifest['decodedMiB'],'MiB',flush=True)

def update_indexes(folder,manifest):
    budget={'version':1,'id':manifest['unitKey'],'profile':'crowd','runtimeIntegrationActive':True,
        'dependencies':[],'sheets':[]}
    for a in [*manifest['actions'].values(),manifest['projectile']]:
        budget['sheets'].append({'textureKey':f'companion_{manifest["unitKey"]}_{a["runtimeKey"]}',
            'path':a['runtimePath'],**{k:a[k] for k in ['frameWidth','frameHeight','frameCount','endFrame']}})
    write(folder/'sprite-budget-manifest.json',budget)
    index=read(folder/'task-index.json')
    index.update(status='imported_pending_user_runtime_test',assetOnly=False,runtimeIntegrationActive=True,
        spriteManifest='spritesheet-manifest.json',completionRecord='../_engineering_line_completion_20260830/DELIVERY.md')
    index['budget'].update(actualDecodedMiB=manifest['decodedMiB'],runtimeScale=manifest['runtimeScale'])
    for kind,a in manifest['actions'].items():
        index['actions'][kind].update(preview=a['preview'], transparentPreview=a['preview'],
            sourceSheet=a['sourceSheet'], finalSheet=a['sheet'],
            status='accepted_source_imported_runtime_untested',
            spriteStatus='imported_pending_user_runtime_test')
    if manifest['unitKey']=='hamster_field_cannon_crew':
        index['approvalScope']='User accepted all four source animations and requested completion/import of the entire engineering line.'
    write(folder/'task-index.json',index)
    plan=read(folder/'sprite-production-plan.json')
    plan.update(runtimeIntegrationActive=True,productionStatus='imported_pending_user_runtime_test',
        actualDecodedMiB=manifest['decodedMiB'],runtimeScale=manifest['runtimeScale'])
    write(folder/'sprite-production-plan.json',plan)

def howitzer():
    folder=ROOT.parent/'_hamster_howitzer_animations_20260830'
    manifest=read(folder/'spritesheet-manifest.json')
    cfg=read(REPO/'data/hamster-howitzer-crew-config.json')
    cfg['sounds']={key:f'assets/sounds/friendly/hamster_howitzer_crew_{key}_video.mp3' for key in ['attack','casing','reload']}
    cfg['ai'].update(attackSoundIsGunshot=True,
        attackSoundEvents=[{'atMs':3960,'key':'casing'},{'atMs':6080,'key':'reload'}])
    a=manifest['actions']['attack']
    cfg['animations']['attack'].update({k:a[k] for k in ['frameWidth','frameHeight','cols','rows','frameCount','footX','footY']})
    write(REPO/'data/hamster-howitzer-crew-config.json',cfg)
    shutil.copy2(folder/a['sheet'],REPO/a['runtimePath'])
    manifest.update(status='imported_pending_user_runtime_test',runtimeIntegrationActive=True)
    a['runtimeIntegrationActive']=True
    write(folder/'spritesheet-manifest.json',manifest)
    update_indexes(folder,manifest)
    print('hamster_howitzer_crew',manifest['decodedMiB'],'MiB',flush=True)

if __name__=='__main__':
    cues()
    field_cannon()
    icons=[portrait('catapult'),portrait('field_cannon')]
    write(ROOT/'unit-icon-sources.json',icons)
    howitzer()
