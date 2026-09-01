"""Install only the approved headsman; preserve concurrent unrelated file content."""
from pathlib import Path
import copy
import json
import shutil

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[4]
BUILD=ROOT/'sprite-build-v01'
MANIFEST=json.loads((BUILD/'manifest.json').read_text(encoding='utf-8'))
STATES={'idle':'idle','walking':'walk','attacking':'attack','dying':'death'}


def write_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def edit(path,old,new):
    content=path.read_text(encoding='utf-8')
    if new in content:return
    if content.count(old)!=1:raise RuntimeError(f'Ambiguous edit: {path}')
    path.write_text(content.replace(old,new,1),encoding='utf-8')


def install():
    cfg=json.loads((REPO/'data/enemy-config.json').read_text(encoding='utf-8'))
    base=copy.deepcopy(cfg['shroudThrall'])
    scale=MANIFEST['calibration']['runtimeBodyHeightPx']/208
    attack=next(r for r in MANIFEST['actions'] if r['action']=='attacking')
    base.update(id='stitchfaceHeadsman',name='缝面刽子手',type='精英',rank='elite',level=6,
        hp=780,maxHp=780,speed=110,str=54,dex=24,con=38,int=5,wis=12,luck=8,
        color='#70584a',attackRange=70,attackDistance=70,
        description='恐怖地牢专属精英。缝面铁罩与厚刃斩骨刀，缓步逼近，停步锁定单体后蓄力下劈。后撤、侧移、绕后、隔墙或换层可避开落刀；没有范围横扫、追踪或额外突进。',
        attackType='物理（单体蓄力下劈）')
    base['attack']=dict(type='thrust',cooldown=3000,range=70,dynamicRange=70,width=36,knockback=42)
    base['attackSkills']={'primary':dict(range=70,damageMul=2,knockback=42,cooldown=3000,duration=1500,
        frames=attack['frameCount'],eventFrame=attack['contactFrame'],eventMs=attack['contactMs'],sourceEventFrame=56,
        comment='源视频f56下劈接触姿态对应正式0-based第40帧；600ms蓄力、300ms下劈、600ms收招。逐帧时长驱动动画与一次性命中，共用时间轴。')}
    base['basicMelee']=dict(approachReach=70,impactReach=70,width=36,forwardOffset=0,backExtension=0,
        requiresSameSurface=True,requiresLosAtImpact=True,
        timeline=dict(durationMs=1500,frameCount=attack['frameCount'],contactFrame=attack['contactFrame'],
            activeFrames=[attack['contactFrame'],attack['contactFrame']+1],rebaseOnImpact=True))
    base['render'].update(spriteSize=256*scale,bodyDisplayHeight=MANIFEST['calibration']['runtimeBodyHeightPx'])
    base['death']=dict(animMs=next(r['durationMs'] for r in MANIFEST['actions'] if r['action']=='dying'),holdMs=1000,fadeMs=300)
    base['skills']=[dict(name='蓄力斩骨',desc='锁定目标与方向，1.5秒动作在约833ms落刀，造成物攻×2物理伤害并击退42；起手冷却3秒。只结算一次，不横扫、不追踪、不突进。眩晕、冻结、石化、恐惧和冲刺眩晕可打断未释放攻击。')]
    textures={'referenceCell':256,'frameLayouts':{}}
    for r in MANIFEST['actions']:
        state=STATES[r['action']]
        target=f'assets/enemies/stitchface_headsman/{state}.png'
        textures[state]=target
        layout=dict(frameWidth=r['frameWidth'],frameHeight=r['frameHeight'],frameCount=r['frameCount'],
            endFrame=r['endFrame'],footX=r['footX'],footY=r['footY'],columns=r['cols'],rows=r['rows'],
            duration=r['durationMs'],frameRate=r['outputFps'],repeat=-1 if r['mode']=='loop' else 0,
            frameDurations=r['frameDurationsMs'])
        textures['frameLayouts'][state]=layout
        dest=REPO/target;dest.parent.mkdir(parents=True,exist_ok=True)
        if (ROOT/r['sheet']).resolve()!=dest.resolve():
            shutil.copyfile(ROOT/r['sheet'],dest)
    idle=textures['frameLayouts']['idle']
    textures.update(idleFrameWidth=idle['frameWidth'],idleFrameHeight=idle['frameHeight'],
        idleFrameCount=idle['frameCount'],idleSheetColumns=idle['columns'])
    base['textures']=textures
    base['render']['footOffsetY']=(idle['footY']-idle['frameHeight']/2)*scale
    write_json(BUILD/'runtime-config.json',base)
    # Append one object, retaining the existing objects/formatting byte-for-byte.
    for relative in ['data/enemy-config.json','public/data/enemy-config.json']:
        path=REPO/relative;content=path.read_text(encoding='utf-8')
        existing=json.loads(content)
        if 'stitchfaceHeadsman' in existing:
            if existing['stitchfaceHeadsman']!=base:raise RuntimeError(f'Existing headsman differs: {path}')
            continue
        entry=json.dumps({'stitchfaceHeadsman':base},ensure_ascii=False,indent=2)[2:-2]
        path.write_text(content.rstrip()[:-1].rstrip()+',\n'+entry+'\n}\n',encoding='utf-8')
    # These eight pools belong exclusively to the horror dungeon. Rank matching remains intact.
    for relative in ['data/dungeon-config.json','public/data/dungeon-config.json']:
        path=REPO/relative;content=path.read_text(encoding='utf-8')
        if '"stitchfaceHeadsman"' in content:continue
        import re
        pattern=r'(?m)^( +)"knellAttendant",$'
        matches=list(re.finditer(pattern,content))
        if len(matches)!=8:raise RuntimeError(f'Horror pool layout changed: {relative}')
        content=re.sub(pattern,lambda m:m[0]+'\n'+m[1]+'"stitchfaceHeadsman",',content)
        path.write_text(content,encoding='utf-8')
    edit(REPO/'src/entities/enemy-types.js',
         "export { ShroudThrall } from './enemy-types/shroud-thrall.js';",
         "export { ShroudThrall } from './enemy-types/shroud-thrall.js';\nexport { StitchfaceHeadsman } from './enemy-types/stitchface-headsman.js';")
    edit(REPO/'src/world/zombie-dungeon.js',
         "import { ShroudThrall } from '../entities/enemy-types/shroud-thrall.js';",
         "import { ShroudThrall } from '../entities/enemy-types/shroud-thrall.js';\nimport { StitchfaceHeadsman } from '../entities/enemy-types/stitchface-headsman.js';")
    edit(REPO/'src/world/zombie-dungeon.js',
         'export function createOssuaryCaster(x, y) {',
         "export function createStitchfaceHeadsman(x, y) {\n    return new StitchfaceHeadsman(x, y, { ai: { aggroRange: 9999, loseTimeout: 999999, alertRange: 9999 } });\n}\n\nexport function createOssuaryCaster(x, y) {")
    edit(REPO/'src/world/zombie-dungeon.js','    shroudThrall: createShroudThrall,',
         '    shroudThrall: createShroudThrall,\n    stitchfaceHeadsman: createStitchfaceHeadsman,')
    edit(REPO/'src/phaser/scenes/BootScene.js',
         "            ['shroudThrall', 'shroud_thrall'],",
         "            ['shroudThrall', 'shroud_thrall'],\n            ['stitchfaceHeadsman', 'stitchface_headsman'],")
    edit(REPO/'src/phaser/scenes/BootScene.js',
         '// 恐怖地牢普通怪：按配置登记目录族，交给现有驻留管理器按需加载。',
         '// 恐怖地牢人形怪：按配置登记目录族，交给现有驻留管理器按需加载。')
    write_json(BUILD/'runtime-installation.json',dict(id='stitchfaceHeadsman',status='installed_pending_user_runtime_test',
        runtimeIntegrationActive=True,runtimeVerified=False,testsRun=False,profile='specialist',rgbaMiB=MANIFEST['rgbaMiB'],
        reference=MANIFEST['calibration'],collision=dict(radius=36.3,width=57.5,height=158.8),
        reachMeasurement=dict(sourceFrame=56,rootX=615,bladeTipX=914,worldPerSourcePixel=139.515234375/609,
            visualForwardReach=(914-615)*139.515234375/609,configuredReach=70,groundWidth=36),
        sourceManifest='manifest.json',runtimeFiles=list(textures[s] for s in STATES.values())))
    print('Installed headsman assets, config, loader and horror-only factory/pools. No tests run.')


if __name__=='__main__':install()
